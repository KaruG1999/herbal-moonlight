# Herbal Moonlight Smart Contract

An asymmetric two-player strategy game on Stellar Soroban where the **Gardener** defends a 5×5 grid with hidden plants and the **Creature** must navigate to the house, using ZK proofs to verify the garden without revealing it.

## Game Overview

### Players
- **Gardener**: Places plants on a 5×5 grid with defensive properties
- **Creature**: Starts outside the grid and moves toward the house (bottom row)

### Game Flow
1. **Commitment Phase**: Gardener submits SHA256 hash of the garden layout
2. **Playing Phase**: Creature moves forward 1 row per turn (max ±1 column movement)
3. **Proof Phase**: Gardener reveals each cell using Groth16 ZK proof
4. **Win Conditions**:
   - Gardener wins if Creature HP reaches 0
   - Creature wins if it reaches row 4 (the house)

### Moon Phases
Affects creature starting HP and plant damage:
- **Full Moon** (20% chance): Creature +2 HP, Damage -1
- **New Moon** (20% chance): Creature base HP, Damage +1
- **Balanced** (60% chance): Standard values

## Contract Architecture

### Storage
- **Instance Storage**: Admin, GameHub address, verifier ID, circuit image ID
- **Temporary Storage**: Game sessions (30-day TTL, extended on every write)

### Key Methods

#### `__constructor(admin, game_hub, verifier_id, image_id)`
Initializes the contract with Game Hub and ZK verifier addresses.

#### `start_game(session_id, gardener, creature, gardener_points, creature_points)`
- Requires auth from both players
- Calls Game Hub to lock points
- Creates initial game session
- Prevents self-play

#### `commit_garden(session_id, garden_commitment)`
- Only Gardener can commit
- Stores SHA256 hash of the garden
- Transitions to Playing phase

#### `creature_move(session_id, new_x, new_y)`
- Only Creature can move
- Validates: move forward 1 row, max ±1 column
- Transitions to WaitingForProof phase

#### `reveal_cell(session_id, journal_bytes, journal_hash, seal)`
- Only Gardener can reveal
- Verifies journal against stored garden commitment
- Applies moon-adjusted damage based on plant type (contract authority)
- Checks win conditions
- Calls Game Hub `end_game` if game finished
- **Dev Mode:** SHA-256 verification only
- **Production Mode:** Groth16 proof verification via BN254 verifier (CAP-0074)

#### `get_session(session_id)`
Returns the complete game state for UI consumption.

#### `get_hub()`, `set_hub(new_hub)`
Manage the Game Hub contract address (admin only).

#### `upgrade(new_wasm_hash)`
Update contract code (admin only).

## Data Structures

### GamePhase
```
WaitingForCommitment → Playing ↔ WaitingForProof → Finished
```

### GameSession
- session_id, gardener, creature, points
- creature_x, creature_y, creature_hp
- garden_commitment (SHA256)
- phase, moon_phase, revealed_cells, turn_number

### CellRevealResult
- x, y: coordinates
- has_plant: bool
- plant_type, damage_dealt: u32

## ZK Proof Verification

**Dev Mode (Current - MVP):** Uses SHA-256 verification
- Verifies garden commitment integrity
- Validates journal against stored hash
- Ensures positional correctness

**Production Mode (Roadmap):** Uses Groth16 verification
- Integrates with RiscZero circuit (zk-prover module)
- Verifies proof using bn254_multi_pairing_check (CAP-0074 BN254 primitives)
- Extracts garden commitment and cell reveal data from journal

## Game Hub Integration

This contract is **Game Hub-aware**:
- Calls `game_hub.start_game()` before creating the session
- Calls `game_hub.end_game()` when game finishes
- Players must authenticate to commit points
- Game Hub is the single source of truth for lifecycle events

## Testing

Run tests with:
```bash
cargo test --lib -p herbal-moonlight
```

Test suite includes:
- Hub retrieval
- Self-play prevention
- Session not found errors
- Admin hub updates

## Build & Deploy

Build:
```bash
bun run build herbal-moonlight
```

Deploy to testnet:
```bash
bun run deploy herbal-moonlight
```

Generate TypeScript bindings:
```bash
bun run bindings herbal-moonlight
```

## Implementation Notes

- **Deterministic Randomness**: Moon phase derived from session_id via keccak256 (no ledger time)
- **TTL Management**: 30-day TTL (518,400 ledgers) with refresh on every write
- **Error Codes**: Comprehensive enum for game-specific errors
- **No Std**: Contract uses `#![no_std]` and only soroban-sdk imports
- **Grid Size**: 5×5 (0-4 inclusive)
- **Creature Starting Position**: x=2, y=0 (outside the board)
- **Creature Starting HP**: 6 (modified by moon phase)

## Future Work

1. Implement Groth16 proof verification against verifier contract
2. Add frontend bindings and UI
3. Deploy to stellar testnet/mainnet
4. Integrate with Game Studio catalog
