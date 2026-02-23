# Herbal Moonlight — Technical Architecture

*A complete reference for the ZK commitment scheme, Soroban contract design, and the roadmap to full Groth16 on-chain verification.*

---

## Table of Contents

1. [14-Step Protocol Flow](#1-14-step-protocol-flow)
2. [Security and Privacy Model](#2-security-and-privacy-model)
3. [Soroban Contract Specifications](#3-soroban-contract-specifications)
4. [Data Structures](#4-data-structures)
5. [Moon Phase — Deterministic Randomness](#5-moon-phase--deterministic-randomness)
6. [Roadmap to Groth16 Production Mode](#6-roadmap-to-groth16-production-mode)

---

## 1. 14-Step Protocol Flow

The complete game lifecycle across four phases: Session Setup, Commitment, Gameplay Loop, and Settlement.

```mermaid
sequenceDiagram
    participant G as Gardener (Browser)
    participant C as Creature (Browser)
    participant LT as Launchtube
    participant HM as HerbalMoonlight Contract
    participant GH as Game Hub

    Note over G,C: Phase 1 — Session Setup (Multi-Sig)

    G->>G: 1. prepareStartGame() — build tx, sign own auth entry, export XDR
    G-->>C: share XDR auth entry blob (off-chain)
    C->>C: 2. importAndSignAuthEntry() — inject + countersign
    C->>LT: 3. finalizeStartGame() — submit via Launchtube (fee sponsored)
    LT->>HM: start_game(session_id, gardener, creature, points)
    HM->>GH: 4. GameHub.start_game() — points locked, session registered
    HM->>HM: 5. keccak256(session_id)[0] % 100 → Moon Phase (deterministic, immutable)

    Note over G,HM: Phase 2 — Commitment

    G->>G: 6. Arrange 5×5 garden (client-side only — never transmitted)
    G->>G: 7. SHA-256(layout[25]) → commitment[32]
    G->>HM: 8. commit_garden(commitment) — phase: WaitingForCommitment → Playing

    Note over G,C: Phase 3 — Gameplay Loop (repeats per turn)

    C->>C: 9. Select target cell under fog of war (blind navigation)
    C->>HM: 10. creature_move(x, y) — validate: Δy == +1, |Δx| ≤ 1, bounds check
    HM->>HM: phase: Playing → WaitingForProof

    G->>G: 11. Build journal[73] = commitment[32] ‖ x[1] ‖ y[1] ‖ has_plant[1] ‖ plant_type[1] ‖ damage[1] ‖ padding[36]
    G->>G: 12. Dev: SHA-256(journal) → journal_hash / Prod: RiscZero Groth16 → (journal_hash, seal)
    G->>HM: 13. reveal_cell(journal_bytes, journal_hash, seal)
    HM->>HM: assert journal[0:32] == commitment<br/>assert SHA-256(journal) == journal_hash<br/>assert journal[32:34] == (creature_x, creature_y)<br/>apply moon-adjusted damage; check HP and position

    Note over HM,GH: Phase 4 — Settlement (conditional on game end)

    HM->>GH: 14. GameHub.end_game(session_id, gardener_won) — points settled
```

### Phase Transition Table

| State | Trigger | Next State |
|---|---|---|
| `WaitingForCommitment` | `commit_garden()` succeeds | `Playing` |
| `Playing` | `creature_move()` succeeds | `WaitingForProof` |
| `WaitingForProof` | `reveal_cell()` succeeds, game continues | `Playing` |
| `WaitingForProof` | `reveal_cell()` succeeds, HP == 0 or y == 4 | `Finished` |

---

## 2. Security and Privacy Model

### The Commitment Scheme — Why the Gardener Cannot Cheat

The fundamental security guarantee rests on the binding property of SHA-256 and the atomicity of Soroban transactions.

**At commitment time**, the Gardener submits:

```
H = SHA-256(layout[0], layout[1], ..., layout[24])
```

where each `layout[i]` is a single byte: `0` (empty), `1` (Lavender), `2` (Mint), `3` (Mandrake). The contract stores `H` in temporary storage. The 25-byte array itself is discarded client-side after commitment — it never appears in any transaction.

**At reveal time**, the contract enforces three invariants atomically:

```rust
// 1. Commitment integrity — the reveal belongs to the committed garden
assert journal_bytes[0..32] == session.garden_commitment

// 2. Journal integrity — the reveal data has not been tampered with
assert SHA-256(journal_bytes) == journal_hash

// 3. Positional integrity — the reveal targets the current creature position
assert journal_bytes[32] == session.creature_x
assert journal_bytes[33] == session.creature_y
```

If any assertion fails, the contract returns `Error::CommitmentMismatch` or `Error::InvalidCoordinates` and reverts the transaction. The Gardener cannot:

- **Lie about plant presence**: the journal hash would not match.
- **Lie about plant type**: changing `journal[35]` changes `SHA-256(journal)`, breaking assertion 2.
- **Reveal the wrong cell**: assertion 3 checks against the creature's recorded position.
- **Switch the garden mid-game**: assertion 1 checks against the hash stored at commitment time, which is cryptographically bound to the original layout.

Critically, the contract **computes damage from `journal[35]` (plant type) using its own `PLANT_DAMAGE` table** — it never trusts the `damage` byte in the journal. The damage field is in the journal for the ZK circuit's output, not for the contract's arithmetic.

### Permanent Privacy — Why the Board Stays Hidden

The contract stores only:
- `garden_commitment` — a 32-byte hash
- `revealed_cells` — a list of cell indices that have been stepped on
- `creature_x`, `creature_y` — current position

The full 25-byte layout is never written to any Soroban storage key. There is no way to reconstruct the garden from on-chain state, even after the game ends. The `Never Reveal` principle is enforced by omission: the contract simply has nothing to reveal.

The Creature sees only:
- Its own position
- Whether a stepped cell had a plant (and its type), via the `CellRevealResult` return value
- HP damage dealt

All other cells remain in cryptographic fog for the entire game lifetime — and beyond, since there is no post-game disclosure mechanism.

### Cheat Resistance Summary

| Attack Vector | Defense |
|---|---|
| Gardener changes plant positions after commitment | SHA-256 binding — any layout change produces a different hash |
| Gardener lies about which plant is in a cell | Journal hash covers all bytes including plant type |
| Gardener reveals a different cell than the one stepped on | Positional integrity check against `creature_x` / `creature_y` |
| Gardener inflates or deflates damage | Contract recomputes damage from plant type using its own lookup table |
| Creature claims a different position than moved | `creature_move()` is the only way to update position; Creature must auth that call |
| Either player replays a valid proof for a different session | `session_id` is embedded in the auth flow; `DataKey::Session(session_id)` scopes all state |

---

## 3. Soroban Contract Specifications

**Contract ID:** `CCHDXLBZ73N7XHZKAEH3G6K3NQELAYASM3XU46A2TWHQX5AASEPN7WY2`

### `commit_garden`

Transitions the session from `WaitingForCommitment` to `Playing`. Called once per game by the Gardener immediately after session creation.

```rust
pub fn commit_garden(
    env: Env,
    session_id: u32,
    garden_commitment: BytesN<32>,  // SHA-256(layout[25])
) -> Result<(), Error>
```

**Authorization:** `session.gardener.require_auth()`

**Preconditions:**
- Session exists in temporary storage
- `session.phase == GamePhase::WaitingForCommitment`

**Effects:**
- Stores `garden_commitment` in `session.garden_commitment`
- Sets `session.phase = Playing`
- Extends TTL by `518,400 ledgers` (30 days)

**Error codes:** `SessionNotFound`, `InvalidPhase`, `NotYourTurn`

---

### `creature_move`

Advances the Creature's position by one row. Transitions to `WaitingForProof` after a valid move.

```rust
pub fn creature_move(
    env: Env,
    session_id: u32,
    new_x: u32,   // 0–4, |Δx| ≤ 1
    new_y: u32,   // creature_y + 1
) -> Result<(), Error>
```

**Authorization:** `session.creature.require_auth()`

**Movement constraints (enforced on-chain):**
```rust
let y_diff = new_y.saturating_sub(session.creature_y);
let x_diff = abs_diff(new_x, session.creature_x);

assert y_diff == 1           // must advance exactly one row
assert x_diff <= 1           // max one column lateral shift
assert new_x < GRID_SIZE     // column in bounds (0–4)
assert new_y < GRID_SIZE     // row in bounds (0–4)
```

**Effects:**
- Updates `(creature_x, creature_y)` and `turn_number`
- Sets `session.phase = WaitingForProof`
- Extends TTL

---

### `reveal_cell`

The core ZK reveal. Verifies the journal against the stored commitment, applies moon-adjusted damage, and conditionally calls `GameHub.end_game()`.

```rust
pub fn reveal_cell(
    env: Env,
    session_id: u32,
    journal_bytes: Bytes,     // 73-byte witness
    journal_hash: BytesN<32>, // SHA-256(journal_bytes)
    seal: Bytes,              // empty in dev mode; Groth16 proof in production
) -> Result<CellRevealResult, Error>
```

**Authorization:** `session.gardener.require_auth()`

**Journal format (73 bytes):**

| Offset | Length | Field |
|---|---|---|
| 0 | 32 | `garden_commitment` — must match on-chain stored hash |
| 32 | 1 | `x` — cell column (must match `creature_x`) |
| 33 | 1 | `y` — cell row (must match `creature_y`) |
| 34 | 1 | `has_plant` — `0x00` or `0x01` |
| 35 | 1 | `plant_type` — `0` empty, `1` Lavender, `2` Mint, `3` Mandrake |
| 36 | 1 | `damage` — raw damage before moon modifier (informational; contract recomputes) |
| 37 | 36 | padding — zero-filled |

**Verification sequence:**
1. Extract `journal_bytes[0..32]` → assert equals `session.garden_commitment`
2. Assert `SHA-256(journal_bytes) == journal_hash`
3. Assert `journal_bytes[32..34] == (creature_x, creature_y)`
4. In production: call `groth16_verifier.verify(seal, image_id, journal_hash)` — panics on failure

**Damage calculation (moon-adjusted):**
```rust
fn calculate_damage(base_damage: u32, moon_phase: &MoonPhase) -> u32 {
    match moon_phase {
        MoonPhase::FullMoon  => base_damage.saturating_sub(1),  // weakened plants
        MoonPhase::NewMoon   => base_damage.saturating_add(1),  // empowered plants
        MoonPhase::Balanced  => base_damage,                    // standard
    }
}
```

Base damage by plant type: Lavender = 1, Mint = 2, Mandrake = 3.

**Win condition checks:**
- `creature_hp == 0` → Gardener wins
- `creature_y >= 4` → Creature wins (reached the house row)

**On game end:** calls `GameHub.end_game(session_id, gardener_won)` before returning. This call is mandatory — the Game Hub is the single source of truth for point settlement.

---

## 4. Data Structures

### `GameSession`

All session state is stored in Soroban **temporary storage** under `DataKey::Session(session_id)`. TTL is extended to 30 days on every write.

```rust
pub struct GameSession {
    pub session_id:        u32,
    pub gardener:          Address,
    pub creature:          Address,
    pub gardener_points:   i128,
    pub creature_points:   i128,
    pub garden_commitment: BytesN<32>,  // SHA-256 of layout; set by commit_garden()
    pub creature_x:        u32,         // 0–4
    pub creature_y:        u32,         // 0–4; starts at 0, goal is 4
    pub creature_hp:       u32,         // 6 (Balanced/New Moon) or 8 (Full Moon)
    pub phase:             GamePhase,
    pub moon_phase:        MoonPhase,
    pub revealed_cells:    Vec<u32>,    // flat indices: y * 5 + x
    pub turn_number:       u32,
}
```

### `CellRevealResult` (return value of `reveal_cell`)

```rust
pub struct CellRevealResult {
    pub x:            u32,
    pub y:            u32,
    pub has_plant:    bool,
    pub plant_type:   u32,  // 0=empty, 1=Lavender, 2=Mint, 3=Mandrake
    pub damage_dealt: u32,  // moon-adjusted final damage applied to creature HP
}
```

### Error Codes

| Code | Value | Meaning |
|---|---|---|
| `NotInitialized` | 1 | Contract storage not set up |
| `InvalidPhase` | 3 | Call not valid in current game phase |
| `NotYourTurn` | 4 | Caller is not the authorized player for this action |
| `InvalidMove` | 5 | Movement violates row/column constraints |
| `CellAlreadyRevealed` | 6 | Creature re-entered a cell that was already stepped on |
| `ProofVerificationFailed` | 7 | Groth16 seal rejected by verifier contract |
| `CommitmentMismatch` | 8 | Journal commitment bytes do not match stored hash |
| `SessionNotFound` | 9 | No session exists for this `session_id` |
| `InvalidCoordinates` | 10 | Revealed coordinates do not match creature position |
| `GameAlreadyFinished` | 11 | Call on a session in `Finished` phase |
| `SelfPlayNotAllowed` | 12 | Gardener and Creature cannot be the same address |

---

## 5. Moon Phase — Deterministic Randomness

Moon phase is derived at `start_game()` time from `keccak256(session_id)` and stored permanently in the session. It never changes after the game starts.

```rust
fn determine_moon_phase(env: &Env, session_id: u32) -> MoonPhase {
    let mut seed = Bytes::new(env);
    seed.append(&Bytes::from_array(env, &session_id.to_be_bytes()));
    let hash = env.crypto().keccak256(&seed);

    match hash.to_array()[0] as u32 % 100 {
        0..=19  => MoonPhase::FullMoon,   // 20%
        20..=39 => MoonPhase::NewMoon,    // 20%
        _       => MoonPhase::Balanced,   // 60%
    }
}
```

**Why `keccak256(session_id)` and not ledger time or sequence?**

Soroban's simulation/submission model runs contract logic twice — once during simulation (to estimate fees and build the auth envelope) and once during submission (to execute on-chain). Any value that changes between those two runs — `env.ledger().sequence()`, `env.ledger().timestamp()` — would produce different results, causing `InvalidModifiedEntryError`. Session ID is chosen by the players, stable across both runs, and unique per game. This ensures the moon phase a player sees during simulation is exactly the phase that gets stored on-chain.

| Moon Phase | Probability | Creature HP | Plant Damage |
|---|---|---|---|
| Full Moon | 20% | +2 (starts at 8) | −1 per plant |
| New Moon | 20% | standard (6) | +1 per plant |
| Balanced | 60% | standard (6) | no modifier |

---

## 6. Roadmap to Groth16 Production Mode

The contract is architecturally prepared for full on-chain ZK proof verification. The upgrade path is additive — no changes to the game logic or the commitment scheme are required.

### Current State (Dev Mode)

The `seal` parameter in `reveal_cell()` is ignored when empty. Verification reduces to:

```
SHA-256(journal_bytes) == journal_hash   ∧   journal[0:32] == commitment
```

This provides full commit/reveal integrity with no ZK overhead. The game mechanic is cryptographically correct — the only missing property is *succinctness*: a malicious Gardener with unlimited compute could brute-force a fake journal that matches the hash. In practice, SHA-256 preimage resistance makes this computationally infeasible, but it is not formally proven to be zero-knowledge.

### Groth16 Integration Path (Production Mode)

**Protocol 25 (Stellar X-Ray)** introduced native BN254 elliptic curve operations via CAP-0074:

| Host Function | Description |
|---|---|
| `bn254_g1_add` | Point addition in G1 |
| `bn254_g1_mul` | Scalar multiplication in G1 |
| `bn254_multi_pairing_check` | Multi-pairing check over GT |

These primitives enable a Groth16 verifier written entirely in a Soroban smart contract — no trusted backend, no off-chain verifier.

**The upgrade is two components:**

1. **RiscZero Guest Circuit** (`zk-prover/`) — already implemented. Inputs: `(garden[25], x, y, claimed_commitment[32])`. Outputs: `journal[73]` as described above. The circuit asserts `SHA-256(garden) == claimed_commitment` inside the zkVM, generating a Groth16 proof (`seal`) that a Stellar contract can verify.

2. **Groth16 Verifier Contract** (`contracts/groth16-verifier/`) — deployed at `CCV7EJ77WV4PN5RXQ2O4HPIOCNZI3WFFDGMWGMPWS2WCQ2PSVQQE777T`. Implements `verify(seal, image_id, journal_hash)` using `bn254_multi_pairing_check`. Panics on invalid proof.

**Activation in `reveal_cell()`:**

When `seal.len() > 0`, the contract calls:

```rust
env.try_invoke_contract::<(), soroban_sdk::InvokeError>(
    &verifier_id,
    &Symbol::new(&env, "verify"),
    (seal, image_id, journal_hash),
)
```

A successful return proves that a valid Groth16 proof exists for the circuit with the given `image_id`, that the public outputs match `journal_hash`, and therefore that the Gardener knows a garden layout consistent with the stored commitment — without the layout ever being transmitted.

### What Changes in Production

| Property | Dev Mode | Production Mode |
|---|---|---|
| Privacy | Hash-binding only — layout never transmitted | Formally ZK — computationally infeasible to extract layout from proof |
| Prover compute | Instant (SHA-256 in browser) | ~60–120 seconds (Groth16 on Gardener's machine via `zk-prover/`) |
| On-chain verification cost | Minimal — one SHA-256 hash check | Higher — BN254 pairing check via Protocol 25 host functions |
| Cheat resistance | SHA-256 preimage resistance | Full ZK soundness — cryptographic proof of correct computation |

### Dependencies for Full Activation

1. Soroban SDK exposure of the CAP-0074 `bn254_*` host functions at stable API
2. RiscZero `CELL_REVEAL_GUEST_ID` (image ID) finalized and embedded in verifier deployment
3. Groth16 proof generation toolchain validated against the deployed verifier's verification key

The contract accepts the verifier address and image ID at construction time (`__constructor`) — switching from dev to production mode requires only redeploying with a non-zero `image_id` and a properly initialized verifier, with no changes to game logic.

---

*For game design rationale: [game-design.md](game-design.md)*
*For ZK circuit implementation detail: [zk-implementation.md](zk-implementation.md)*
*For UI component documentation: [CONTRIBUTING_UI.md](CONTRIBUTING_UI.md)*
