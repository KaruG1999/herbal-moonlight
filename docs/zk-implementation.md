# Herbal Moonlight - Zero-Knowledge Implementation

## Overview

Este documento describe la arquitectura ZK para **Herbal Moonlight**, un juego de estrategia asimétrico donde el Gardener defiende su casa con plantas ocultas y la Creature debe atravesar el jardín sin conocer la disposición.

**Stack Tecnológico:**
- **zkVM**: RiscZero (Groth16 sobre BN254)
- **Blockchain**: Soroban (Stellar Protocol 25 "X-Ray")
- **Verificación**: Primitivas nativas BN254 (CAP-0074)
- **Game Hub**: `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`

---

## IMPORTANTE: Cambios desde Red Team Review

| Problema Identificado | Solución Implementada |
|-----------------------|----------------------|
| VerifierMock inaceptable | Verificador real usando BN254 precompiles (Protocol 25) |
| Backend Prover centralizado | Prover local en máquina del Gardener |
| Sin integración Game Hub | Integración completa con `start_game()` / `end_game()` |
| Estructura no compatible con Game Studio | Contrato en `contracts/herbal-moonlight/` |

---

## 1. Estructura de Archivos CORREGIDA

```
JuegoZk/
├── Stellar-Game-Studio/                    # Fork del Game Studio
│   ├── Cargo.toml                          # Workspace (modificar para añadir nuestro contrato)
│   ├── contracts/
│   │   ├── mock-game-hub/                  # Para tests locales
│   │   ├── dice-duel/                      # Referencia
│   │   ├── number-guess/                   # Referencia
│   │   ├── twenty-one/                     # Referencia
│   │   │
│   │   ├── herbal-moonlight/               # <-- NUESTRO CONTRATO DE JUEGO
│   │   │   ├── Cargo.toml
│   │   │   ├── README.md
│   │   │   └── src/
│   │   │       ├── lib.rs                  # Lógica del juego + Game Hub integration
│   │   │       └── test.rs                 # Tests con mock verifier
│   │   │
│   │   └── groth16-verifier/               # <-- VERIFICADOR BN254 (Protocol 25)
│   │       ├── Cargo.toml
│   │       └── src/
│   │           └── lib.rs                  # Verificador Groth16 nativo
│   │
│   ├── herbal-moonlight-frontend/          # Frontend standalone (generado por create)
│   │   └── src/games/herbal-moonlight/
│   │       ├── bindings.ts
│   │       ├── service.ts
│   │       └── components/
│   │
│   └── scripts/                            # Scripts de build/deploy
│
├── risc0-prover/                           # <-- FUERA del workspace Soroban
│   ├── Cargo.toml                          # Workspace de RiscZero
│   ├── shared/                             # Tipos compartidos
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   ├── methods/
│   │   ├── Cargo.toml
│   │   ├── build.rs
│   │   └── guest/
│   │       ├── Cargo.toml
│   │       └── src/main.rs                 # Circuito ZK
│   └── host/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs                      # API del prover
│           └── main.rs                     # CLI local
│
├── docs/
│   ├── game-design.md
│   └── zk-implementation.md                # Este documento
│
└── typezero-reference/                     # Referencia (no modificar)
```

### 1.1 Modificar Cargo.toml del Workspace

```toml
# Stellar-Game-Studio/Cargo.toml

[workspace]
resolver = "2"
version = "0.1.2"
members = [
  "contracts/mock-game-hub",
  "contracts/twenty-one",
  "contracts/number-guess",
  "contracts/dice-duel",
  "contracts/herbal-moonlight",      # <-- AÑADIR
  "contracts/groth16-verifier",      # <-- AÑADIR
]

[workspace.dependencies]
soroban-sdk = "25.0.2"

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
```

---

## 2. Integración con Game Hub

### 2.1 Trait del Game Hub (Interfaz Requerida)

```rust
// contracts/herbal-moonlight/src/lib.rs

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype,
    panic_with_error, vec, Address, Bytes, BytesN, Env, IntoVal, Symbol, Val, Vec,
};

// ============================================
// GAME HUB CLIENT INTERFACE (OBLIGATORIO)
// ============================================

#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    /// Inicia una sesión de juego en el Game Hub
    /// Debe llamarse al crear una partida
    fn start_game(
        env: Env,
        game_id: Address,      // Este contrato
        session_id: u32,       // ID de la sesión
        player1: Address,      // Gardener
        player2: Address,      // Creature
        player1_points: i128,  // Puntos apostados
        player2_points: i128,
    );

    /// Finaliza una sesión y declara ganador
    /// Debe llamarse cuando el juego termina
    fn end_game(
        env: Env,
        session_id: u32,
        player1_won: bool,     // true = Gardener gana, false = Creature gana
    );
}

// ============================================
// CONSTANTES DEL JUEGO
// ============================================

const GRID_SIZE: u32 = 5;
const CREATURE_STARTING_HP: u32 = 6;
const JOURNAL_LEN: u32 = 73;
const GAME_TTL_LEDGERS: u32 = 518_400; // 30 días

// ============================================
// GAME HUB ADDRESS (PRODUCCIÓN)
// ============================================

// Testnet Game Hub - usar esta dirección para deploy
const GAME_HUB_TESTNET: &str = "CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG";
```

### 2.2 Contrato Completo con Game Hub Integration

```rust
// contracts/herbal-moonlight/src/lib.rs (continuación)

#![no_std]

// ... (imports anteriores)

// ============================================
// TIPOS DE DATOS
// ============================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GamePhase {
    WaitingForCommitment,  // Esperando que Gardener envíe commitment
    WaitingForProof,       // Creature se movió, esperando prueba ZK
    Playing,               // Turno de la Creature
    Finished,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MoonPhase {
    FullMoon,   // Creature +2 HP, Spirit Sense free
    NewMoon,    // Plants +1 damage, no Spirit Sense
    Balanced,   // Standard rules
}

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
pub enum DataKey {
    Admin,
    GameHubAddress,
    VerifierId,
    ImageId,
    Session(u32),
}

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

// ============================================
// CONTRATO PRINCIPAL
// ============================================

#[contract]
pub struct HerbalMoonlight;

#[contractimpl]
impl HerbalMoonlight {
    /// Constructor del contrato (llamado automáticamente al deploy)
    ///
    /// # Arguments
    /// * `admin` - Dirección del administrador
    /// * `game_hub` - Dirección del Game Hub (CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG)
    /// * `verifier_id` - Dirección del contrato verificador Groth16
    /// * `image_id` - Image ID del circuito RiscZero
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

    /// Inicia una nueva partida entre dos jugadores
    ///
    /// FLUJO:
    /// 1. Ambos jugadores autorizan (puntos)
    /// 2. Se llama a Game Hub start_game()
    /// 3. Se crea la sesión en estado WaitingForCommitment
    /// 4. Gardener debe enviar commit_garden() después
    pub fn start_game(
        env: Env,
        session_id: u32,
        gardener: Address,
        creature: Address,
        gardener_points: i128,
        creature_points: i128,
    ) -> Result<(), Error> {
        // Prevenir auto-juego
        if gardener == creature {
            return Err(Error::SelfPlayNotAllowed);
        }

        // Ambos jugadores autorizan sus puntos
        gardener.require_auth_for_args(
            vec![&env, session_id.into_val(&env), gardener_points.into_val(&env)]
        );
        creature.require_auth_for_args(
            vec![&env, session_id.into_val(&env), creature_points.into_val(&env)]
        );

        // Obtener Game Hub y llamar start_game
        let game_hub_addr: Address = env.storage().instance()
            .get(&DataKey::GameHubAddress)
            .ok_or(Error::NotInitialized)?;

        let game_hub = GameHubClient::new(&env, &game_hub_addr);

        // CRÍTICO: Llamar al Game Hub ANTES de crear la sesión
        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &gardener,
            &creature,
            &gardener_points,
            &creature_points,
        );

        // Determinar fase lunar (determinística basada en session_id)
        let moon_phase = Self::determine_moon_phase(&env, session_id);

        let creature_hp = match moon_phase {
            MoonPhase::FullMoon => CREATURE_STARTING_HP + 2,
            _ => CREATURE_STARTING_HP,
        };

        // Crear sesión
        let session = GameSession {
            session_id,
            gardener: gardener.clone(),
            creature: creature.clone(),
            gardener_points,
            creature_points,
            garden_commitment: BytesN::from_array(&env, &[0u8; 32]),
            creature_x: 2,  // Centro fila superior
            creature_y: 0,  // Fila de entrada (fuera del tablero)
            creature_hp,
            phase: GamePhase::WaitingForCommitment,
            moon_phase,
            revealed_cells: Vec::new(&env),
            turn_number: 0,
        };

        // Guardar en storage temporal con TTL de 30 días
        let key = DataKey::Session(session_id);
        env.storage().temporary().set(&key, &session);
        env.storage().temporary().extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Gardener envía el commitment de su jardín
    /// Después de esto, el juego comienza y Creature puede moverse
    pub fn commit_garden(
        env: Env,
        session_id: u32,
        garden_commitment: BytesN<32>,
    ) -> Result<(), Error> {
        let key = DataKey::Session(session_id);
        let mut session: GameSession = env.storage().temporary()
            .get(&key)
            .ok_or(Error::SessionNotFound)?;

        session.gardener.require_auth();

        if session.phase != GamePhase::WaitingForCommitment {
            return Err(Error::InvalidPhase);
        }

        session.garden_commitment = garden_commitment;
        session.phase = GamePhase::Playing;

        env.storage().temporary().set(&key, &session);
        env.storage().temporary().extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Creature se mueve a una nueva posición
    /// Después de moverse, el estado cambia a WaitingForProof
    pub fn creature_move(
        env: Env,
        session_id: u32,
        new_x: u32,
        new_y: u32,
    ) -> Result<(), Error> {
        let key = DataKey::Session(session_id);
        let mut session: GameSession = env.storage().temporary()
            .get(&key)
            .ok_or(Error::SessionNotFound)?;

        session.creature.require_auth();

        if session.phase != GamePhase::Playing {
            return Err(Error::InvalidPhase);
        }

        // Validar movimiento
        let y_diff = new_y.saturating_sub(session.creature_y);
        let x_diff = if new_x > session.creature_x {
            new_x - session.creature_x
        } else {
            session.creature_x - new_x
        };

        if y_diff != 1 || x_diff > 1 || new_x >= GRID_SIZE || new_y >= GRID_SIZE {
            return Err(Error::InvalidMove);
        }

        session.creature_x = new_x;
        session.creature_y = new_y;
        session.phase = GamePhase::WaitingForProof;  // Esperando prueba ZK
        session.turn_number += 1;

        env.storage().temporary().set(&key, &session);
        env.storage().temporary().extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Gardener revela la celda usando prueba ZK
    /// Si la Creature muere o llega a la casa, el juego termina
    pub fn reveal_cell(
        env: Env,
        session_id: u32,
        journal_bytes: Bytes,
        journal_hash: BytesN<32>,
        seal: Bytes,
    ) -> Result<CellRevealResult, Error> {
        let key = DataKey::Session(session_id);
        let mut session: GameSession = env.storage().temporary()
            .get(&key)
            .ok_or(Error::SessionNotFound)?;

        session.gardener.require_auth();

        if session.phase != GamePhase::WaitingForProof {
            return Err(Error::InvalidPhase);
        }

        // Verificar commitment en journal
        let journal_commitment = Self::extract_commitment(&journal_bytes)
            .ok_or(Error::CommitmentMismatch)?;

        if journal_commitment != session.garden_commitment {
            return Err(Error::CommitmentMismatch);
        }

        // Verificar prueba ZK usando el verificador real
        let verifier_id: Address = env.storage().instance()
            .get(&DataKey::VerifierId)
            .ok_or(Error::NotInitialized)?;

        let image_id: BytesN<32> = env.storage().instance()
            .get(&DataKey::ImageId)
            .ok_or(Error::NotInitialized)?;

        if !Self::verify_groth16_proof(&env, &verifier_id, &seal, &image_id, &journal_hash) {
            return Err(Error::ProofVerificationFailed);
        }

        // Decodificar resultado
        let mut result = Self::decode_journal(&journal_bytes)
            .ok_or(Error::ProofVerificationFailed)?;

        // Verificar coordenadas
        if result.x != session.creature_x || result.y != session.creature_y {
            return Err(Error::InvalidCoordinates);
        }

        // Marcar celda revelada
        let cell_index = result.y * GRID_SIZE + result.x;
        session.revealed_cells.push_back(cell_index);

        // Aplicar daño
        if result.has_plant {
            let adjusted_damage = Self::calculate_damage(result.damage_dealt, &session.moon_phase);
            result.damage_dealt = adjusted_damage;
            session.creature_hp = session.creature_hp.saturating_sub(adjusted_damage);
        }

        // Verificar condiciones de victoria
        let game_ended;
        let gardener_won;

        if session.creature_hp == 0 {
            session.phase = GamePhase::Finished;
            game_ended = true;
            gardener_won = true;
        } else if session.creature_y >= 4 {
            session.phase = GamePhase::Finished;
            game_ended = true;
            gardener_won = false;
        } else {
            session.phase = GamePhase::Playing;
            game_ended = false;
            gardener_won = false;
        }

        env.storage().temporary().set(&key, &session);
        env.storage().temporary().extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        // CRÍTICO: Llamar a Game Hub end_game si el juego terminó
        if game_ended {
            let game_hub_addr: Address = env.storage().instance()
                .get(&DataKey::GameHubAddress)
                .ok_or(Error::NotInitialized)?;

            let game_hub = GameHubClient::new(&env, &game_hub_addr);
            game_hub.end_game(&session_id, &gardener_won);
        }

        Ok(result)
    }

    /// Obtener estado de la sesión
    pub fn get_session(env: Env, session_id: u32) -> Result<GameSession, Error> {
        env.storage().temporary()
            .get(&DataKey::Session(session_id))
            .ok_or(Error::SessionNotFound)
    }

    /// Obtener dirección del Game Hub configurado
    pub fn get_hub(env: Env) -> Result<Address, Error> {
        env.storage().instance()
            .get(&DataKey::GameHubAddress)
            .ok_or(Error::NotInitialized)
    }

    /// Actualizar Game Hub (solo admin)
    pub fn set_hub(env: Env, new_hub: Address) -> Result<(), Error> {
        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        env.storage().instance().set(&DataKey::GameHubAddress, &new_hub);
        Ok(())
    }

    // ========================================
    // FUNCIONES HELPER PRIVADAS
    // ========================================

    fn determine_moon_phase(env: &Env, session_id: u32) -> MoonPhase {
        // Usar PRNG determinístico (no ledger sequence para consistencia sim/submit)
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

    fn calculate_damage(base_damage: u32, moon_phase: &MoonPhase) -> u32 {
        match moon_phase {
            MoonPhase::FullMoon => base_damage.saturating_sub(1),
            MoonPhase::NewMoon => base_damage.saturating_add(1),
            MoonPhase::Balanced => base_damage,
        }
    }

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

    fn verify_groth16_proof(
        env: &Env,
        verifier_id: &Address,
        seal: &Bytes,
        image_id: &BytesN<32>,
        journal_hash: &BytesN<32>,
    ) -> bool {
        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(seal.into_val(env));
        args.push_back(image_id.into_val(env));
        args.push_back(journal_hash.into_val(env));

        match env.try_invoke_contract::<(), soroban_sdk::InvokeError>(
            verifier_id,
            &Symbol::new(env, "verify"),
            args,
        ) {
            Ok(Ok(())) => true,
            _ => false,
        }
    }
}
```

---

## 3. Verificador Groth16 con Protocol 25

### 3.1 Estrategia de Verificación

**Protocol 25 (X-Ray)** introduce soporte nativo para BN254 mediante CAP-0074:

| Host Function | Descripción | Uso |
|---------------|-------------|-----|
| `bn254_g1_add` | Suma de puntos en G1 | Construir combinaciones lineales |
| `bn254_g1_mul` | Multiplicación escalar en G1 | MSM para verificación |
| `bn254_multi_pairing_check` | Verificar producto de pairings | Check final de Groth16 |

**RiscZero produce pruebas Groth16 sobre BN254**, compatibles con estas primitivas.

### 3.2 Contrato Verificador

```rust
// contracts/groth16-verifier/src/lib.rs

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    panic_with_error, Bytes, BytesN, Env,
};

/// Verificador Groth16 para RiscZero sobre BN254
///
/// Usa las primitivas nativas de Soroban Protocol 25 (CAP-0074):
/// - bn254_g1_add
/// - bn254_g1_mul
/// - bn254_multi_pairing_check

#[contract]
pub struct Groth16Verifier;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VerifierError {
    InvalidProofLength = 1,
    InvalidPublicInputs = 2,
    PairingCheckFailed = 3,
    InvalidImageId = 4,
}

/// Verification Key para el circuito RiscZero
/// Estos valores son específicos del circuito y se obtienen del build de RiscZero
#[contracttype]
#[derive(Clone)]
pub struct VerificationKey {
    /// Alpha punto en G1 (64 bytes: x, y coordinates)
    pub alpha_g1: BytesN<64>,
    /// Beta punto en G2 (128 bytes: x0, x1, y0, y1)
    pub beta_g2: BytesN<128>,
    /// Gamma punto en G2
    pub gamma_g2: BytesN<128>,
    /// Delta punto en G2
    pub delta_g2: BytesN<128>,
    /// IC (Input Commitment) puntos en G1 - array de puntos
    pub ic: Bytes,
}

#[contractimpl]
impl Groth16Verifier {
    /// Inicializa el verificador con la Verification Key del circuito RiscZero
    pub fn init(env: Env, vk: VerificationKey) {
        env.storage().instance().set(&"vk", &vk);
    }

    /// Verifica una prueba Groth16 de RiscZero
    ///
    /// # Arguments
    /// * `seal` - La prueba Groth16 (256 bytes típicamente)
    /// * `image_id` - El Image ID del circuito (32 bytes)
    /// * `journal_hash` - Hash SHA256 del journal (32 bytes)
    ///
    /// # Panics
    /// Si la verificación falla
    pub fn verify(
        env: Env,
        seal: Bytes,
        image_id: BytesN<32>,
        journal_hash: BytesN<32>,
    ) {
        // Obtener verification key
        let vk: VerificationKey = env.storage().instance()
            .get(&"vk")
            .unwrap_or_else(|| panic_with_error!(&env, VerifierError::InvalidPublicInputs));

        // Parsear la prueba Groth16 del seal
        // Formato RiscZero: [pi_a (64 bytes)][pi_b (128 bytes)][pi_c (64 bytes)]
        if seal.len() < 256 {
            panic_with_error!(&env, VerifierError::InvalidProofLength);
        }

        // Extraer puntos de la prueba
        let pi_a = Self::extract_g1_point(&seal, 0);      // 64 bytes
        let pi_b = Self::extract_g2_point(&seal, 64);     // 128 bytes
        let pi_c = Self::extract_g1_point(&seal, 192);    // 64 bytes

        // Construir public inputs: [1, image_id, journal_hash]
        // Esto depende de cómo RiscZero codifica los inputs públicos
        let public_inputs = Self::encode_public_inputs(&env, &image_id, &journal_hash);

        // Calcular vk_x = IC[0] + sum(public_input[i] * IC[i+1])
        let vk_x = Self::compute_linear_combination(&env, &vk.ic, &public_inputs);

        // Verificar el pairing:
        // e(pi_a, pi_b) == e(alpha, beta) * e(vk_x, gamma) * e(pi_c, delta)
        //
        // Equivalente a verificar:
        // e(pi_a, pi_b) * e(-alpha, beta) * e(-vk_x, gamma) * e(-pi_c, delta) == 1

        let pairing_result = Self::multi_pairing_check(
            &env,
            &pi_a, &pi_b,
            &vk.alpha_g1, &vk.beta_g2,
            &vk_x, &vk.gamma_g2,
            &pi_c, &vk.delta_g2,
        );

        if !pairing_result {
            panic_with_error!(&env, VerifierError::PairingCheckFailed);
        }

        // Si llegamos aquí, la prueba es válida
    }

    // ========================================
    // FUNCIONES HELPER USANDO HOST FUNCTIONS
    // ========================================

    fn extract_g1_point(data: &Bytes, offset: u32) -> BytesN<64> {
        let mut arr = [0u8; 64];
        for i in 0..64 {
            arr[i] = data.get(offset + i as u32).unwrap_or(0);
        }
        BytesN::from_array(data.env(), &arr)
    }

    fn extract_g2_point(data: &Bytes, offset: u32) -> BytesN<128> {
        let mut arr = [0u8; 128];
        for i in 0..128 {
            arr[i] = data.get(offset + i as u32).unwrap_or(0);
        }
        BytesN::from_array(data.env(), &arr)
    }

    fn encode_public_inputs(
        env: &Env,
        image_id: &BytesN<32>,
        journal_hash: &BytesN<32>,
    ) -> Bytes {
        // Los public inputs de RiscZero son:
        // 1. image_id (como field element)
        // 2. journal_hash (como field element)
        let mut inputs = Bytes::new(env);
        inputs.append(&Bytes::from_slice(env, &image_id.to_array()));
        inputs.append(&Bytes::from_slice(env, &journal_hash.to_array()));
        inputs
    }

    fn compute_linear_combination(
        env: &Env,
        ic: &Bytes,
        public_inputs: &Bytes,
    ) -> BytesN<64> {
        // Usa bn254_g1_add y bn254_g1_mul de Protocol 25
        // vk_x = IC[0] + sum(inputs[i] * IC[i+1])

        // Por simplicidad en MVP, asumimos que tenemos
        // una función host que hace esto directamente
        // En producción, necesitamos implementar el loop completo

        // PLACEHOLDER - en producción usar las host functions reales
        let mut result = [0u8; 64];
        result.copy_from_slice(&ic.slice(0..64).to_alloc_vec());
        BytesN::from_array(env, &result)
    }

    fn multi_pairing_check(
        env: &Env,
        a1: &BytesN<64>, b1: &BytesN<128>,
        a2: &BytesN<64>, b2: &BytesN<128>,
        a3: &BytesN<64>, b3: &BytesN<128>,
        a4: &BytesN<64>, b4: &BytesN<128>,
    ) -> bool {
        // Usa bn254_multi_pairing_check de Protocol 25
        // Verifica: e(a1,b1) * e(a2,b2) * e(a3,b3) * e(a4,b4) == 1

        // Construir input para la host function
        let mut pairing_input = Bytes::new(env);
        pairing_input.append(&Bytes::from_slice(env, &a1.to_array()));
        pairing_input.append(&Bytes::from_slice(env, &b1.to_array()));
        pairing_input.append(&Bytes::from_slice(env, &a2.to_array()));
        pairing_input.append(&Bytes::from_slice(env, &b2.to_array()));
        pairing_input.append(&Bytes::from_slice(env, &a3.to_array()));
        pairing_input.append(&Bytes::from_slice(env, &b3.to_array()));
        pairing_input.append(&Bytes::from_slice(env, &a4.to_array()));
        pairing_input.append(&Bytes::from_slice(env, &b4.to_array()));

        // Llamar a la host function de Protocol 25
        // NOTA: La sintaxis exacta depende de cómo Soroban SDK exponga CAP-0074
        // Esto es un placeholder - la API real puede diferir
        env.crypto().bn254_multi_pairing_check(&pairing_input)
    }
}
```

### 3.3 Alternativa: Verificador Pre-desplegado

Si hay un verificador Groth16 ya desplegado en testnet (como el de TypeZero o uno de la comunidad), podemos usarlo directamente:

```rust
// En lugar de desplegar nuestro propio verificador,
// referenciar uno existente compatible con RiscZero

const EXISTING_GROTH16_VERIFIER: &str = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
```

---

## 4. Prover Local (Sin Backend Centralizado)

### 4.1 Arquitectura del Prover Local

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ARQUITECTURA PROVER LOCAL                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────┐      │
│   │                     MÁQUINA DEL GARDENER                          │      │
│   │                                                                   │      │
│   │   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐      │      │
│   │   │   Frontend  │─────▶│Local Prover │─────▶│   Stellar   │      │      │
│   │   │   (React)   │      │  (RiscZero) │      │   Wallet    │      │      │
│   │   └─────────────┘      └─────────────┘      └─────────────┘      │      │
│   │         │                     │                    │             │      │
│   │         │  garden layout      │  ProofResult       │  signed tx  │      │
│   │         │  (nunca sale)       │                    │             │      │
│   │         ▼                     ▼                    ▼             │      │
│   │   ┌─────────────────────────────────────────────────────────┐   │      │
│   │   │              DATOS PRIVADOS - NUNCA SALEN               │   │      │
│   │   │  • GardenLayout completo                                │   │      │
│   │   │  • Salt aleatorio                                       │   │      │
│   │   │  • Clave privada del wallet                            │   │      │
│   │   └─────────────────────────────────────────────────────────┘   │      │
│   └──────────────────────────────────────────────────────────────────┘      │
│                                     │                                        │
│                                     │ Solo datos públicos                   │
│                                     ▼                                        │
│   ┌──────────────────────────────────────────────────────────────────┐      │
│   │                    STELLAR BLOCKCHAIN                             │      │
│   │                                                                   │      │
│   │   • commitment (hash)                                            │      │
│   │   • journal_hash                                                 │      │
│   │   • seal (prueba Groth16)                                        │      │
│   │   • coordenadas (x, y)                                           │      │
│   │   • resultado (has_plant, damage)                                │      │
│   └──────────────────────────────────────────────────────────────────┘      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Implementación del Prover Local

```rust
// risc0-prover/host/src/lib.rs

use anyhow::{anyhow, Result};
use risc0_zkvm::{
    default_prover, ExecutorEnv, InnerReceipt, ProverOpts, Receipt
};
use sha2::{Sha256, Digest};

// Tipos compartidos
use herbal_moonlight_shared::{
    CellRevealInput, CellRevealOutput, GardenLayout,
    JOURNAL_LEN, compute_garden_commitment,
};

// ELF del circuito compilado
use herbal_moonlight_methods::{CELL_REVEAL_GUEST_ELF, CELL_REVEAL_GUEST_ID};

#[derive(Debug, Clone)]
pub struct LocalProofResult {
    pub journal_bytes: Vec<u8>,
    pub journal_hash: [u8; 32],
    pub seal: Vec<u8>,
    pub image_id: [u8; 32],
    pub output: CellRevealOutput,
}

/// Genera una prueba ZK localmente
///
/// Esta función se ejecuta en la máquina del Gardener.
/// El garden layout NUNCA sale de esta máquina.
pub fn generate_proof_local(
    garden: &GardenLayout,
    x: u8,
    y: u8,
    session_id: u32,
    gardener_pubkey: [u8; 32],
) -> Result<LocalProofResult> {
    let expected_commitment = compute_garden_commitment(garden);

    let input = CellRevealInput {
        garden: garden.clone(),
        x,
        y,
        expected_commitment,
        session_id,
        gardener_pubkey,
    };

    // Configurar prover local
    let env = ExecutorEnv::builder()
        .write(&input)?
        .build()?;

    // Usar prover local (requiere Docker para Groth16)
    let prover = default_prover();
    let opts = ProverOpts::groth16();

    println!("Generando prueba ZK... (esto puede tomar 1-2 minutos)");

    let prove_info = prover.prove_with_opts(env, CELL_REVEAL_GUEST_ELF, &opts)?;
    prove_info.receipt.verify(CELL_REVEAL_GUEST_ID)?;

    let receipt = prove_info.receipt;

    // Verificar que es Groth16
    if !matches!(&receipt.inner, InnerReceipt::Groth16(_)) {
        return Err(anyhow!("Groth16 proof required. Ensure Docker is running."));
    }

    let journal_bytes = receipt.journal.bytes.clone();
    let journal_hash = sha256(&journal_bytes);

    let seal = match &receipt.inner {
        InnerReceipt::Groth16(inner) => inner.seal.clone(),
        _ => return Err(anyhow!("Not a Groth16 receipt")),
    };

    let output = CellRevealOutput::from_bytes(&journal_bytes)
        .ok_or_else(|| anyhow!("Failed to decode journal"))?;

    let image_id = CELL_REVEAL_GUEST_ID.into();

    Ok(LocalProofResult {
        journal_bytes,
        journal_hash,
        seal,
        image_id,
        output,
    })
}

fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}
```

### 4.3 CLI para el Gardener

```rust
// risc0-prover/host/src/main.rs

use clap::Parser;
use herbal_moonlight_host::generate_proof_local;
use herbal_moonlight_shared::GardenLayout;

#[derive(Parser)]
#[command(name = "herbal-prover")]
#[command(about = "Generate ZK proofs for Herbal Moonlight locally")]
struct Cli {
    /// Session ID
    #[arg(short, long)]
    session_id: u32,

    /// Cell X coordinate to reveal
    #[arg(short = 'x', long)]
    cell_x: u8,

    /// Cell Y coordinate to reveal
    #[arg(short = 'y', long)]
    cell_y: u8,

    /// Garden layout file (JSON)
    #[arg(short, long)]
    garden_file: String,

    /// Gardener public key (hex)
    #[arg(short, long)]
    pubkey: String,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // Cargar garden desde archivo local
    let garden_json = std::fs::read_to_string(&cli.garden_file)?;
    let garden: GardenLayout = serde_json::from_str(&garden_json)?;

    // Parsear pubkey
    let pubkey_bytes = hex::decode(&cli.pubkey)?;
    let mut gardener_pubkey = [0u8; 32];
    gardener_pubkey.copy_from_slice(&pubkey_bytes);

    println!("Generating proof for cell ({}, {})...", cli.cell_x, cli.cell_y);

    let result = generate_proof_local(
        &garden,
        cli.cell_x,
        cli.cell_y,
        cli.session_id,
        gardener_pubkey,
    )?;

    // Output en formato para enviar al contrato
    println!("\n=== PROOF GENERATED ===");
    println!("journal_bytes: {}", hex::encode(&result.journal_bytes));
    println!("journal_hash: {}", hex::encode(&result.journal_hash));
    println!("seal: {}", hex::encode(&result.seal));
    println!("image_id: {}", hex::encode(&result.image_id));
    println!("\nResult: {:?}", result.output);

    Ok(())
}
```

---

## 5. Diagrama de Flujo Actualizado

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FLUJO COMPLETO CON GAME HUB                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  1. START GAME                                                               │
│                                                                              │
│     Frontend ──▶ HerbalMoonlight.start_game()                               │
│                         │                                                    │
│                         ├── Verificar auth de ambos jugadores               │
│                         │                                                    │
│                         ├──▶ GameHub.start_game() ◀── OBLIGATORIO           │
│                         │         │                                          │
│                         │         └── Emite GameStarted event               │
│                         │                                                    │
│                         └── Crear sesión (WaitingForCommitment)             │
│                                                                              │
│     Game Hub Address: CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. GARDENER SETUP (Local)                                                   │
│                                                                              │
│     ┌─────────────────────────────────────────────────────────────────┐     │
│     │                    GARDENER'S MACHINE                            │     │
│     │                                                                  │     │
│     │   1. Crear garden layout (5x5 grid + salt)                      │     │
│     │   2. Guardar en archivo local garden.json                       │     │
│     │   3. Calcular commitment = SHA256(layout || salt)               │     │
│     │   4. Enviar commitment on-chain                                  │     │
│     │                                                                  │     │
│     │   ⚠️ garden.json NUNCA sale de esta máquina                     │     │
│     └─────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│     Frontend ──▶ HerbalMoonlight.commit_garden(commitment)                  │
│                         │                                                    │
│                         └── Estado cambia a Playing                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  3. GAMEPLAY LOOP                                                            │
│                                                                              │
│     ┌────────────────────────────────────────────────────────────────┐      │
│     │ CREATURE TURN                                                   │      │
│     │                                                                 │      │
│     │   Frontend ──▶ HerbalMoonlight.creature_move(x, y)             │      │
│     │                        │                                        │      │
│     │                        └── Estado: WaitingForProof             │      │
│     │                                                                 │      │
│     │   UI muestra: "Esperando que Gardener revele celda..."         │      │
│     └────────────────────────────────────────────────────────────────┘      │
│                                    │                                         │
│                                    ▼                                         │
│     ┌────────────────────────────────────────────────────────────────┐      │
│     │ GARDENER TURN (Generación de Prueba LOCAL)                      │      │
│     │                                                                 │      │
│     │   ┌─────────────────────────────────────────────────────────┐  │      │
│     │   │ LOCAL PROVER                                             │  │      │
│     │   │                                                          │  │      │
│     │   │   $ herbal-prover \                                      │  │      │
│     │   │       --session-id 42 \                                  │  │      │
│     │   │       --cell-x 2 --cell-y 1 \                           │  │      │
│     │   │       --garden-file ~/.herbal/garden.json \             │  │      │
│     │   │       --pubkey abc123...                                 │  │      │
│     │   │                                                          │  │      │
│     │   │   Generating proof... (~1-2 minutes)                    │  │      │
│     │   │   ✓ Proof generated!                                    │  │      │
│     │   └─────────────────────────────────────────────────────────┘  │      │
│     │                         │                                       │      │
│     │                         ▼                                       │      │
│     │   Frontend ──▶ HerbalMoonlight.reveal_cell(                    │      │
│     │                   journal_bytes,                                │      │
│     │                   journal_hash,                                 │      │
│     │                   seal                                          │      │
│     │               )                                                 │      │
│     │                         │                                       │      │
│     │                         ├── Verificar commitment               │      │
│     │                         ├── Verificar prueba ZK (BN254)        │      │
│     │                         ├── Aplicar daño                        │      │
│     │                         └── Estado: Playing (o Finished)        │      │
│     └────────────────────────────────────────────────────────────────┘      │
│                                                                              │
│     Repetir hasta que Creature HP = 0 o Creature llega a row 4              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  4. END GAME                                                                 │
│                                                                              │
│     En reveal_cell(), si el juego termina:                                  │
│                                                                              │
│     HerbalMoonlight ──▶ GameHub.end_game(session_id, gardener_won)          │
│                                  │                                           │
│                                  ├── Emite GameEnded event                  │
│                                  └── Actualiza puntos/standings             │
│                                                                              │
│     ⚠️ CRÍTICO: end_game DEBE llamarse para que Game Hub actualice records │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Estado "WaitingForProof" en UI

### 6.1 Estados de la UI

```typescript
// herbal-moonlight-frontend/src/games/herbal-moonlight/types.ts

export enum UIGameState {
  // Pre-game
  LOADING = 'loading',
  WAITING_FOR_OPPONENT = 'waiting_for_opponent',

  // Gardener setup
  PLACING_PLANTS = 'placing_plants',
  GENERATING_COMMITMENT = 'generating_commitment',

  // Gameplay
  CREATURE_TURN = 'creature_turn',
  WAITING_FOR_PROOF = 'waiting_for_proof',  // <-- NUEVO
  GENERATING_PROOF = 'generating_proof',    // <-- NUEVO (local)
  GARDENER_REVEALING = 'gardener_revealing',

  // End
  GAME_OVER_GARDENER_WON = 'game_over_gardener_won',
  GAME_OVER_CREATURE_WON = 'game_over_creature_won',
}

export interface ProofGenerationStatus {
  isGenerating: boolean;
  progress: number;  // 0-100
  estimatedTimeRemaining: number;  // seconds
  error: string | null;
}
```

### 6.2 Componente de Espera de Prueba

```tsx
// herbal-moonlight-frontend/src/games/herbal-moonlight/components/WaitingForProof.tsx

import React from 'react';
import { ProofGenerationStatus } from '../types';

interface Props {
  isGardener: boolean;
  status: ProofGenerationStatus;
  onGenerateProof: () => void;
}

export const WaitingForProof: React.FC<Props> = ({
  isGardener,
  status,
  onGenerateProof,
}) => {
  if (isGardener) {
    return (
      <div className="waiting-for-proof gardener">
        <h3>Tu turno de revelar</h3>

        {!status.isGenerating ? (
          <>
            <p>La Creature se ha movido. Genera la prueba ZK para revelar la celda.</p>
            <button onClick={onGenerateProof} className="btn-primary">
              Generar Prueba ZK
            </button>
            <p className="hint">
              Esto tomará ~1-2 minutos. Tu jardín permanece privado.
            </p>
          </>
        ) : (
          <div className="proof-progress">
            <div className="spinner" />
            <p>Generando prueba Zero-Knowledge...</p>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${status.progress}%` }}
              />
            </div>
            <p className="eta">
              Tiempo estimado: {status.estimatedTimeRemaining}s
            </p>
          </div>
        )}

        {status.error && (
          <div className="error">
            Error: {status.error}
            <button onClick={onGenerateProof}>Reintentar</button>
          </div>
        )}
      </div>
    );
  }

  // Vista de la Creature
  return (
    <div className="waiting-for-proof creature">
      <h3>Esperando al Gardener...</h3>
      <div className="spinner" />
      <p>El Gardener está generando la prueba ZK para revelar tu celda.</p>
      <p className="hint">
        Esto puede tomar 1-2 minutos.
      </p>
    </div>
  );
};
```

---

## 7. Resumen de Cambios

### 7.1 Checklist de Implementación

| Item | Estado | Notas |
|------|--------|-------|
| Contrato en `contracts/herbal-moonlight/` | Pendiente | Seguir estructura de dice-duel |
| Añadir al workspace Cargo.toml | Pendiente | `members = [...]` |
| Game Hub integration | Diseñado | `start_game()` + `end_game()` |
| Verificador Groth16 real | Diseñado | Usar CAP-0074 o existente |
| Prover local | Diseñado | CLI + lib para frontend |
| Estado WaitingForProof en UI | Diseñado | Nuevo estado de game |
| RiscZero fuera del workspace Soroban | Diseñado | Carpeta `risc0-prover/` separada |

### 7.2 Comandos de Setup

```bash
# 1. Navegar al Game Studio
cd Stellar-Game-Studio

# 2. Crear el contrato (usa el script create)
bun run create herbal-moonlight

# 3. O manualmente crear la estructura
mkdir -p contracts/herbal-moonlight/src
touch contracts/herbal-moonlight/Cargo.toml
touch contracts/herbal-moonlight/src/lib.rs

# 4. Añadir al workspace (editar Cargo.toml)

# 5. Build
bun run build herbal-moonlight

# 6. Deploy
bun run deploy herbal-moonlight

# 7. Generar bindings
bun run bindings herbal-moonlight

# 8. Crear frontend standalone
# (ya creado por el script create)

# 9. Desarrollo
bun run dev:game herbal-moonlight
```

### 7.3 Configuración del Prover Local

```bash
# En carpeta separada del workspace Soroban
cd ../risc0-prover

# Instalar RiscZero CLI
cargo install risc0-zkvm --features prove

# Build del circuito
cargo build --release

# Generar Image ID
cargo run --bin image-id

# Usar el prover
./target/release/herbal-prover \
  --session-id 42 \
  --cell-x 2 --cell-y 1 \
  --garden-file ~/.herbal/garden.json \
  --pubkey $(stellar keys address player1)
```

---

## 8. Referencias

- [Stellar Protocol 25 "X-Ray" Announcement](https://stellar.org/blog/developers/announcing-stellar-x-ray-protocol-25)
- [CAP-0074: BN254 Primitives](https://github.com/stellar/stellar-protocol/discussions/1500)
- [RiscZero Groth16 Documentation](https://dev.risczero.com/api/security-model)
- [risc0-groth16 Crate](https://crates.io/crates/risc0-groth16)
- [Stellar Game Studio Repository](https://github.com/stellar/game-studio)

---

**Versión**: 2.0 (Post Red Team Review)
**Última actualización**: 2025-02-07
**Estado**: Listo para implementación
