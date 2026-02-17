# Herbal Moonlight

**Asymmetric strategy game where Zero-Knowledge Proofs protect your garden secrets forever.**

> *"In a world between twilight and dawn, a Gardener tends a moonlit garden of enchanted herbs.
> Each night, mischievous Spirit Creatures creep through the fog, seeking to reach the Gardener's cottage.
> But the garden fights back -- Lavender lulls, Mint stings, and Mandrake strikes from the shadows.
> The Creature sees nothing. The Gardener reveals nothing. Only cryptographic proof decides who survives the night."*

---

## The Game

Herbal Moonlight is a **2-player asymmetric strategy game** with a witchy cottagecore aesthetic, built on the Stellar blockchain for the [ZK Gaming on Stellar Hackathon](https://earn.superteam.fun/listings/hackathon/zk-gaming-on-stellar/).

| Role | Goal | Mechanic |
|------|------|----------|
| **The Gardener** | Defend the cottage by placing hidden plants on a 5x5 grid | Commits a SHA-256 hash of the garden layout on-chain. Reveals cells one by one using ZK proofs -- the full garden is **never** disclosed. |
| **The Creature** | Navigate from row 0 to row 4 (the cottage) with HP > 0 | Moves forward through fog of war, choosing paths without knowing what lies ahead. |

### Plant Types

| Plant | Damage | Special |
|-------|--------|---------|
| Baby Lavender | 1 | **Calming Mist** -- reduces damage of the next plant hit by 1 |
| Baby Mint | 2 | **Fresh Blast** -- straightforward damage |
| Baby Mandrake | 3 | **Root Strike** -- highest damage dealer |

### Moon Phases

Each session gets a deterministic moon phase (derived from `keccak256(session_id)`):

| Phase | Probability | Effect |
|-------|------------|--------|
| Full Moon | 20% | Creature gets +2 HP; plant damage -1 |
| New Moon | 20% | Plant damage +1 |
| Balanced | 60% | No modifiers |

---

## Technical Architecture

### Provably Fair: Commit / Reveal with Zero-Knowledge

Herbal Moonlight uses a **Hash Commitment + Selective Reveal** scheme to guarantee provably fair gameplay without trusting any server or revealing private information.

```
Setup Phase                           Play Phase (each turn)
===========                           =====================

Gardener places plants                Creature moves to (x, y)
         |                                     |
         v                                     v
  garden: [25 bytes]                  Contract records position
         |                            Phase -> WaitingForProof
         v                                     |
  SHA-256(garden)                               v
         |                            Gardener builds 73-byte journal:
         v                            [commitment:32][x:1][y:1]
  commit_garden(hash)                  [has_plant:1][plant_type:1]
  -> stored on-chain                   [damage:1][padding:36]
  -> garden NEVER leaves browser               |
                                               v
                                      SHA-256(journal) -> journal_hash
                                               |
                                               v
                                      reveal_cell(journal, hash, seal)
                                               |
                                               v
                                      Contract verifies:
                                      1. journal[0..32] == stored commitment
                                      2. sha256(journal) == journal_hash
                                      3. coordinates match creature position
                                      4. Applies damage (contract-authoritative)
```

**Why this architecture?**

The full garden layout **never leaves the Gardener's browser**. The contract only stores the 32-byte commitment hash. Each turn, the Gardener proves *what is in a single cell* without revealing the rest of the grid. The contract computes damage independently from the plant type (never trusting the journal's damage field), preventing the Gardener from lying about damage values.

### ZK Implementation: Dev Mode + Groth16 Roadmap

Following the [recommendations from James Bachini](https://jamesbachini.github.io/Stellar-Game-Studio/) for the hackathon, the contract implements a **dual-mode verification system** designed to stay well within the **400M CPU instruction limit** on Stellar Testnet:

- **Dev Mode** (current): Empty seal -> contract verifies `sha256(journal_bytes) == journal_hash` plus commitment integrity. This provides the full commit/reveal game mechanic with hash-based integrity verification, using minimal CPU budget.
- **Production Mode** (roadmap): Non-empty seal -> Groth16 proof verification using Protocol 25's BN254 elliptic curve primitives (CAP-0074) via a dedicated verifier contract. The contract architecture is already structured for this upgrade path.

The dev mode approach ensures the game is fully playable and demonstrably fair while keeping on-chain verification lightweight. The Groth16 path is architecturally prepared (verifier contract address and image ID are stored on-chain at deployment) for when tooling matures.

### Smart Contract Design

- **Soroban** (Rust) on Stellar Protocol 25
- **Game Hub integration**: Every game calls `start_game()` and `end_game()` on the [Game Hub contract](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG)
- **Temporary storage** with 30-day TTL (518,400 ledgers), extended on every write
- **Deterministic randomness**: Moon phase via `keccak256(session_id)` -- no ledger time/sequence
- **Multi-sig auth flow**: Both players sign `require_auth_for_args` before the game starts
- **35 unit tests** covering security, gameplay, win conditions, moon phases, and edge cases

### Frontend

- **React 19** + TypeScript + Tailwind CSS + Vite
- **Stellar SDK** v14 with generated TypeScript bindings
- **Dev wallet switcher** for local 2-player testing
- **Client-side cryptography**: SHA-256 commitment and journal building happen entirely in the browser
- **Multi-sig UX**: Create/Export auth entry -> Import/Sign -> Finalize (same pattern as Stellar Game Studio reference games)

---

## Running Locally

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli) (for contract operations)
- Rust + `wasm32v1-none` target (for contract compilation)

### Quick Start

```bash
# Clone the repository
git clone <repo-url>
cd Stellar-Game-Studio

# Install dependencies and deploy contracts to testnet
bun install
bun run setup

# Run the frontend (dev server on http://localhost:3000)
cd herbal-moonlight-frontend
bun install
bun run dev
```

### Contract Operations

```bash
# Build the contract
bun run build herbal-moonlight

# Run tests (35 tests)
cargo test -p herbal-moonlight

# Deploy to testnet
bun run deploy herbal-moonlight

# Regenerate TypeScript bindings
bun run bindings herbal-moonlight
```

---

## Deployed on Testnet

| Component | Address |
|-----------|---------|
| **Herbal Moonlight Contract** | [`CCHDXLBZ73N7XHZKAEH3G6K3NQELAYASM3XU46A2TWHQX5AASEPN7WY2`](https://stellar.expert/explorer/testnet/contract/CCHDXLBZ73N7XHZKAEH3G6K3NQELAYASM3XU46A2TWHQX5AASEPN7WY2) |
| **Game Hub** | [`CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG) |

---

## Project Structure

```
Stellar-Game-Studio/                   (this repo)
├── contracts/herbal-moonlight/        # Soroban smart contract (Rust)
│   └── src/
│       ├── lib.rs                     # Contract logic (~680 lines)
│       └── test.rs                    # 35 unit tests (~900 lines)
├── herbal-moonlight-frontend/         # React frontend
│   └── src/games/herbal-moonlight/
│       ├── HerbalMoonlightGame.tsx    # Main game component
│       ├── herbalMoonlightService.ts  # Contract interaction service
│       ├── gardenUtils.ts             # Commitment, journal builder, move logic
│       └── bindings.ts                # Generated TypeScript bindings
├── bindings/herbal_moonlight/         # Generated TypeScript bindings from WASM
├── scripts/                           # Build, deploy, and bindings scripts
└── docs/                              # Built documentation + design docs
```

---

## Credits

This project uses [**Stellar Game Studio**](https://github.com/jamesbachini/Stellar-Game-Studio) by James Bachini as the framework base. Stellar Game Studio provides the scaffolding for on-chain game development on Stellar, including the Game Hub integration pattern, multi-sig transaction flow, dev wallet tooling, and deployment scripts.

Built for the **ZK Gaming on Stellar Hackathon** (Feb 9-23, 2026).

---

## License

Open source. See individual files for license details.
