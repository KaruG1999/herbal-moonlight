#![no_std]

//! # Herbal Moonlight Game
//!
//! An asymmetric two-player strategy game where the Gardener defends with hidden plants
//! and the Creature must navigate a 5x5 grid to reach the house.
//!
//! **Game Hub Integration:**
//! This game is Game Hub-aware and enforces all games through the Game Hub contract.
//! Games cannot be started or completed without points involvement.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype,
    vec, Address, Bytes, BytesN, Env, IntoVal, Vec,
};

// ============================================================================
// Game Hub Client Interface (Required)
// ============================================================================

#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

// ============================================================================
// Enums
// ============================================================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GamePhase {
    WaitingForCommitment = 0,
    WaitingForProof = 1,
    Playing = 2,
    Finished = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MoonPhase {
    FullMoon = 0,
    NewMoon = 1,
    Balanced = 2,
}

// ============================================================================
// Data Structures
// ============================================================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameSession {
    pub session_id: u32,
    pub gardener: Address,
    pub creature: Address,
    pub gardener_points: i128,
    pub creature_points: i128,
    pub garden_commitment: BytesN<32>,
    pub creature_x: u32,
    pub creature_y: u32,
    pub creature_hp: u32,
    pub phase: GamePhase,
    pub moon_phase: MoonPhase,
    pub revealed_cells: Vec<u32>,
    pub turn_number: u32,
    pub damage_reduction: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CellRevealResult {
    pub x: u32,
    pub y: u32,
    pub has_plant: bool,
    pub plant_type: u32,
    pub damage_dealt: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    GameHubAddress,
    VerifierId,
    ImageId,
    Session(u32),
}

// ============================================================================
// Error Codes
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    InvalidPhase = 3,
    NotYourTurn = 4,
    InvalidMove = 5,
    CellAlreadyRevealed = 6,
    ProofVerificationFailed = 7,
    CommitmentMismatch = 8,
    SessionNotFound = 9,
    InvalidCoordinates = 10,
    GameAlreadyFinished = 11,
    SelfPlayNotAllowed = 12,
}

// ============================================================================
// Constants
// ============================================================================

const GRID_SIZE: u32 = 5;
const CREATURE_STARTING_HP: u32 = 6;
const JOURNAL_LEN: u32 = 73;
const GAME_TTL_LEDGERS: u32 = 518_400; // 30 days

// ============================================================================
// Contract Definition
// ============================================================================

#[contract]
pub struct HerbalMoonlight;

#[contractimpl]
impl HerbalMoonlight {
    /// Initialize the contract with GameHub address, admin, and ZK verifier
    ///
    /// # Arguments
    /// * `admin` - Admin address (can upgrade contract)
    /// * `game_hub` - Address of the GameHub contract
    /// * `verifier_id` - Address of the Groth16 verifier contract
    /// * `image_id` - Image ID of the RiscZero circuit (32 bytes)
    pub fn __constructor(
        env: Env,
        admin: Address,
        game_hub: Address,
        verifier_id: Address,
        image_id: BytesN<32>,
    ) {
        let storage = env.storage().instance();
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::GameHubAddress, &game_hub);
        storage.set(&DataKey::VerifierId, &verifier_id);
        storage.set(&DataKey::ImageId, &image_id);
    }

    /// Start a new game between Gardener and Creature
    ///
    /// **CRITICAL:** This method requires authorization from THIS contract.
    /// The Game Hub will call `game_id.require_auth()` which checks this contract's address.
    ///
    /// # Arguments
    /// * `session_id` - Unique session identifier
    /// * `gardener` - Address of the Gardener player
    /// * `creature` - Address of the Creature player
    /// * `gardener_points` - Points amount committed by Gardener
    /// * `creature_points` - Points amount committed by Creature
    pub fn start_game(
        env: Env,
        session_id: u32,
        gardener: Address,
        creature: Address,
        gardener_points: i128,
        creature_points: i128,
    ) -> Result<(), Error> {
        // Prevent self-play
        if gardener == creature {
            return Err(Error::SelfPlayNotAllowed);
        }

        // SECURITY: Prevent session ID collision - check if session already exists
        let game_key = DataKey::Session(session_id);
        if env.storage().temporary().has(&game_key) {
            return Err(Error::AlreadyInitialized);
        }

        // Require authentication from both players (they consent to committing points)
        gardener.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            gardener_points.into_val(&env),
        ]);
        creature.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            creature_points.into_val(&env),
        ]);

        // Get GameHub address
        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .ok_or(Error::NotInitialized)?;

        // Create GameHub client
        let game_hub = GameHubClient::new(&env, &game_hub_addr);

        // Call Game Hub to start the session and lock points
        // CRITICAL: Call Game Hub BEFORE creating the session
        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &gardener,
            &creature,
            &gardener_points,
            &creature_points,
        );

        // Determine moon phase (deterministic based on session_id)
        let moon_phase = Self::determine_moon_phase(&env, session_id);

        // Calculate starting HP based on moon phase
        let creature_hp = match moon_phase {
            MoonPhase::FullMoon => CREATURE_STARTING_HP + 2,
            _ => CREATURE_STARTING_HP,
        };

        // Create game session
        let session = GameSession {
            session_id,
            gardener: gardener.clone(),
            creature: creature.clone(),
            gardener_points,
            creature_points,
            garden_commitment: BytesN::from_array(&env, &[0u8; 32]),
            creature_x: 2,  // Center of top row
            creature_y: 0,  // Starting position (outside board)
            creature_hp,
            phase: GamePhase::WaitingForCommitment,
            moon_phase,
            revealed_cells: Vec::new(&env),
            turn_number: 0,
            damage_reduction: 0,
        };

        // Store game in temporary storage with 30-day TTL
        env.storage().temporary().set(&game_key, &session);
        env.storage()
            .temporary()
            .extend_ttl(&game_key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        // Event emitted by the Game Hub contract (GameStarted)

        Ok(())
    }

    /// Gardener submits the garden commitment hash
    /// After this, the game begins and Creature can move
    ///
    /// # Arguments
    /// * `session_id` - The session ID of the game
    /// * `garden_commitment` - SHA256 hash of the garden layout (32 bytes)
    pub fn commit_garden(
        env: Env,
        session_id: u32,
        garden_commitment: BytesN<32>,
    ) -> Result<(), Error> {
        let key = DataKey::Session(session_id);
        let mut session: GameSession = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::SessionNotFound)?;

        // Only Gardener can commit
        session.gardener.require_auth();

        // Must be in WaitingForCommitment phase
        if session.phase != GamePhase::WaitingForCommitment {
            return Err(Error::InvalidPhase);
        }

        // Store commitment and transition to Playing phase
        session.garden_commitment = garden_commitment;
        session.phase = GamePhase::Playing;

        env.storage().temporary().set(&key, &session);
        env.storage()
            .temporary()
            .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Creature moves to a new position
    /// After moving, state transitions to WaitingForProof
    ///
    /// # Arguments
    /// * `session_id` - The session ID of the game
    /// * `new_x` - New X coordinate (0-4)
    /// * `new_y` - New Y coordinate (0-4)
    pub fn creature_move(
        env: Env,
        session_id: u32,
        new_x: u32,
        new_y: u32,
    ) -> Result<(), Error> {
        let key = DataKey::Session(session_id);
        let mut session: GameSession = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::SessionNotFound)?;

        // Only Creature can move
        session.creature.require_auth();

        // Must be in Playing phase
        if session.phase != GamePhase::Playing {
            return Err(Error::InvalidPhase);
        }

        // Validate movement rules:
        // - Must advance exactly 1 row forward
        // - First move (from row 0): any column allowed (creature chooses entry)
        // - Subsequent moves: at most 1 column left/right
        let y_diff = new_y.saturating_sub(session.creature_y);
        if y_diff != 1 || new_x >= GRID_SIZE || new_y >= GRID_SIZE {
            return Err(Error::InvalidMove);
        }
        if session.creature_y > 0 {
            let x_diff = if new_x > session.creature_x {
                new_x - session.creature_x
            } else {
                session.creature_x - new_x
            };
            if x_diff > 1 {
                return Err(Error::InvalidMove);
            }
        }

        // Update creature position
        session.creature_x = new_x;
        session.creature_y = new_y;
        session.phase = GamePhase::WaitingForProof; // Waiting for ZK proof
        session.turn_number += 1;

        env.storage().temporary().set(&key, &session);
        env.storage()
            .temporary()
            .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Gardener reveals a cell using ZK proof
    /// If Creature dies or reaches the house, the game ends
    ///
    /// # Arguments
    /// * `session_id` - The session ID of the game
    /// * `journal_bytes` - The ZK proof journal bytes
    /// * `journal_hash` - SHA256 hash of the journal
    /// * `seal` - The Groth16 proof seal (empty for dev mode)
    ///
    /// # Dev Mode
    /// If the seal is empty, the contract operates in dev mode:
    /// - Only verifies that sha256(journal_bytes) == journal_hash
    /// - Does NOT provide cryptographic security
    /// - Use only for development and testing
    pub fn reveal_cell(
        env: Env,
        session_id: u32,
        journal_bytes: Bytes,
        journal_hash: BytesN<32>,
        seal: Bytes,
    ) -> Result<CellRevealResult, Error> {
        let key = DataKey::Session(session_id);
        let mut session: GameSession = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::SessionNotFound)?;

        // Only Gardener can reveal
        session.gardener.require_auth();

        // Must be in WaitingForProof phase
        if session.phase != GamePhase::WaitingForProof {
            return Err(Error::InvalidPhase);
        }

        // Verify commitment in journal
        let journal_commitment = Self::extract_commitment(&journal_bytes)
            .ok_or(Error::CommitmentMismatch)?;

        if journal_commitment != session.garden_commitment {
            return Err(Error::CommitmentMismatch);
        }

        // Verify proof based on mode
        if seal.is_empty() {
            // DEV MODE: Only verify journal hash
            // WARNING: No cryptographic security! Only for development.
            let computed_hash: BytesN<32> = env.crypto().sha256(&journal_bytes).into();
            if computed_hash != journal_hash {
                return Err(Error::ProofVerificationFailed);
            }
            // Dev mode passes - journal hash verified
        } else {
            // PRODUCTION MODE: Verify Groth16 proof
            // TODO: Implement when Groth16 verifier contract is ready
            // This will use Protocol 25 BN254 primitives (CAP-0074)
            //
            // let verifier_id: Address = env.storage().instance()
            //     .get(&DataKey::VerifierId)
            //     .ok_or(Error::NotInitialized)?;
            //
            // let image_id: BytesN<32> = env.storage().instance()
            //     .get(&DataKey::ImageId)
            //     .ok_or(Error::NotInitialized)?;
            //
            // if !Self::verify_groth16_proof(&env, &verifier_id, &seal, &image_id, &journal_hash) {
            //     return Err(Error::ProofVerificationFailed);
            // }

            // For now, also verify journal hash as basic check
            let computed_hash: BytesN<32> = env.crypto().sha256(&journal_bytes).into();
            if computed_hash != journal_hash {
                return Err(Error::ProofVerificationFailed);
            }
        }

        // Decode journal to extract cell reveal result
        let mut result = Self::decode_journal(&journal_bytes)
            .ok_or(Error::ProofVerificationFailed)?;

        // Verify coordinates match the creature's current position
        if result.x != session.creature_x || result.y != session.creature_y {
            return Err(Error::InvalidCoordinates);
        }

        // Mark cell as revealed
        let cell_index = result.y * GRID_SIZE + result.x;
        session.revealed_cells.push_back(cell_index);

        // Apply damage if plant exists
        if result.has_plant {
            // Validate plant type is known (1=Lavender, 2=Mint, 3=Mandrake)
            if result.plant_type < 1 || result.plant_type > 3 {
                return Err(Error::ProofVerificationFailed);
            }

            // Contract computes damage from plant type (authoritative)
            let base_damage = Self::base_damage_for_plant(result.plant_type);
            let moon_adjusted = Self::calculate_damage(base_damage, &session.moon_phase);

            // Apply Lavender calming mist reduction from previous hit
            let after_reduction = moon_adjusted.saturating_sub(session.damage_reduction);
            session.damage_reduction = 0;

            // Minimum 1 damage from any plant
            let final_damage = if after_reduction == 0 { 1 } else { after_reduction };

            // If this plant is Lavender, set calming mist for next hit
            if result.plant_type == 1 {
                session.damage_reduction = 1;
            }

            result.damage_dealt = final_damage;
            session.creature_hp = session.creature_hp.saturating_sub(final_damage);
        }

        // Check win conditions
        let game_ended: bool;
        let gardener_won: bool;

        if session.creature_hp == 0 {
            // Gardener wins - Creature dies
            session.phase = GamePhase::Finished;
            game_ended = true;
            gardener_won = true;
        } else if session.creature_y >= 4 {
            // Creature wins - Reached the house (bottom row)
            session.phase = GamePhase::Finished;
            game_ended = true;
            gardener_won = false;
        } else {
            // Game continues
            session.phase = GamePhase::Playing;
            game_ended = false;
            gardener_won = false;
        }

        env.storage().temporary().set(&key, &session);
        env.storage()
            .temporary()
            .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        // CRITICAL: Call Game Hub end_game if the game ended
        if game_ended {
            let game_hub_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::GameHubAddress)
                .ok_or(Error::NotInitialized)?;

            let game_hub = GameHubClient::new(&env, &game_hub_addr);
            game_hub.end_game(&session_id, &gardener_won);
        }

        Ok(result)
    }

    /// Get the current session state
    ///
    /// # Arguments
    /// * `session_id` - The session ID of the game
    ///
    /// # Returns
    /// * `GameSession` - The complete game state
    pub fn get_session(env: Env, session_id: u32) -> Result<GameSession, Error> {
        env.storage()
            .temporary()
            .get(&DataKey::Session(session_id))
            .ok_or(Error::SessionNotFound)
    }

    /// Get the configured Game Hub address
    ///
    /// # Returns
    /// * `Address` - The Game Hub contract address
    pub fn get_hub(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .ok_or(Error::NotInitialized)
    }

    /// Update the Game Hub address (admin only)
    ///
    /// # Arguments
    /// * `new_hub` - The new GameHub contract address
    pub fn set_hub(env: Env, new_hub: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &new_hub);
        Ok(())
    }

    /// Update the contract WASM hash (upgrade contract)
    ///
    /// # Arguments
    /// * `new_wasm_hash` - The hash of the new WASM binary
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    // ========================================================================
    // Internal Helper Functions
    // ========================================================================

    /// Determine moon phase deterministically based on session_id
    /// Ensures consistent randomness between simulation and submission
    fn determine_moon_phase(env: &Env, session_id: u32) -> MoonPhase {
        // Use deterministic PRNG with session_id as seed
        let mut seed_bytes = Bytes::new(env);
        seed_bytes.append(&Bytes::from_array(env, &session_id.to_be_bytes()));
        let hash = env.crypto().keccak256(&seed_bytes);

        let seed_val = hash.to_array()[0] as u32;
        match seed_val % 100 {
            0..=19 => MoonPhase::FullMoon,
            20..=39 => MoonPhase::NewMoon,
            _ => MoonPhase::Balanced,
        }
    }

    /// Get base damage for a plant type
    /// 1=Lavender (1), 2=Mint (2), 3=Mandrake (3)
    fn base_damage_for_plant(plant_type: u32) -> u32 {
        match plant_type {
            1 => 1,
            2 => 2,
            3 => 3,
            _ => 0,
        }
    }

    /// Calculate damage based on moon phase modifier
    fn calculate_damage(base_damage: u32, moon_phase: &MoonPhase) -> u32 {
        match moon_phase {
            MoonPhase::FullMoon => base_damage.saturating_sub(1),
            MoonPhase::NewMoon => base_damage.saturating_add(1),
            MoonPhase::Balanced => base_damage,
        }
    }

    /// Extract garden commitment (first 32 bytes of journal)
    fn extract_commitment(journal: &Bytes) -> Option<BytesN<32>> {
        if journal.len() < 32 {
            return None;
        }
        let mut arr = [0u8; 32];
        for i in 0..32 {
            arr[i] = journal.get(i as u32)?;
        }
        Some(BytesN::from_array(journal.env(), &arr))
    }

    /// Decode journal to extract cell reveal result
    fn decode_journal(journal: &Bytes) -> Option<CellRevealResult> {
        if journal.len() != JOURNAL_LEN {
            return None;
        }

        Some(CellRevealResult {
            x: journal.get(32)? as u32,
            y: journal.get(33)? as u32,
            has_plant: journal.get(34)? != 0,
            plant_type: journal.get(35)? as u32,
            damage_dealt: journal.get(36)? as u32,
        })
    }

    /// Verify Groth16 proof against verifier contract
    /// TODO: Implement when verifier contract is ready
    #[allow(dead_code)]
    fn verify_groth16_proof(
        _env: &Env,
        _verifier_id: &Address,
        _seal: &Bytes,
        _image_id: &BytesN<32>,
        _journal_hash: &BytesN<32>,
    ) -> bool {
        // This function would call the Groth16 verifier contract
        // using Protocol 25 BN254 primitives (CAP-0074)
        //
        // Example implementation pattern (pending verifier contract):
        // let mut args: Vec<Val> = Vec::new(env);
        // args.push_back(seal.into_val(env));
        // args.push_back(image_id.into_val(env));
        // args.push_back(journal_hash.into_val(env));
        //
        // match env.try_invoke_contract::<(), soroban_sdk::InvokeError>(
        //     verifier_id,
        //     &Symbol::new(env, "verify"),
        //     args,
        // ) {
        //     Ok(Ok(())) => true,
        //     _ => false,
        // }

        // Placeholder: return true for now
        true
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test;
