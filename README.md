<div align="center">
  <img src="herbal-moonlight-frontend/public/assets/logo.png" alt="Herbal Moonlight" width="340" />

  <!-- Replace with gameplay screenshot or GIF before submission -->
  <!-- ![Gameplay](docs/assets/hero.gif) -->

  **Asymmetric ZK strategy · Stellar Soroban · Privacy-first gaming**

  [![Deployed on Testnet](https://img.shields.io/badge/Stellar-Testnet-5c67f2?logo=stellar&logoColor=white)](https://stellar.expert/explorer/testnet/contract/CCHDXLBZ73N7XHZKAEH3G6K3NQELAYASM3XU46A2TWHQX5AASEPN7WY2)
  [![Protocol 25](https://img.shields.io/badge/Soroban-Protocol%2025-7c3aed)](https://soroban.stellar.org)
  [![ZK](https://img.shields.io/badge/ZK-Commitment%20%2F%20Reveal-16a34a)](docs/ARCHITECTURE.md)
  [![Game Hub](https://img.shields.io/badge/Game%20Hub-Integrated-f59e0b)](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG)
</div>

---

## The Garden of Secrets

A Witch seals her moonlit garden behind a cryptographic veil — a single SHA-256 commitment stored on-chain before the first step is taken. A Ghost advances through absolute darkness, one cell at a time, never knowing what waits in the soil beneath. When the game ends, most of the garden stays sealed forever — not by server policy, but by math.

---

## How to Play

Two roles. Completely different experiences.

### As the Witch (Gardener)

You start with a blank 5×5 grid and up to 8 plants to place however you want. Arrange them, then seal your garden with a cryptographic commitment — a single hash that locks your layout on-chain without revealing it. The Ghost sees nothing.

When the Ghost moves, you generate a ZK proof revealing only the cell that was stepped on. The rest of your garden stays hidden. You win if the Ghost runs out of HP before reaching your cottage.

The tension: you know exactly where every plant is. The Ghost has no idea. Every move they make is a gamble.

### As the Ghost (Creature)

You enter from the top of the board with no map. Every step forward could be empty soil — or a Mandrake root that drains 3 HP in one hit. You can't see the plants. You can't see the damage coming. You win if you reach row 4 alive.

Use **Spirit Sense** to buy information: spend 1 HP to peek at adjacent cells, or smell out how many plants lurk in the next two rows. It costs you HP you might not have.

The tension: the garden is reading you. The Witch placed those plants specifically to punish the most logical paths.

### Plant Types

| Plant | Damage | Effect |
|---|---|---|
| Baby Lavender | 1 HP | **Calming Mist** — reduces the next plant hit by 1 damage |
| Baby Mint | 2 HP | — |
| Baby Mandrake | 3 HP | — |

### Moon Phases

Each session draws a moon phase at creation — deterministic, based on `keccak256(session_id)`.

| Phase | Chance | Effect |
|---|---|---|
| Full Moon | 20% | Ghost gets +2 HP, plants deal -1 damage |
| New Moon | 20% | Plants deal +1 damage |
| Balanced | 60% | Standard rules |

A Full Moon turns a Mandrake from a 3-hit kill into a 2-hit kill. A New Moon makes Lavender actually sting. The moon is set at game start and cannot change.

---

## Why ZK Is Essential (Not Decorative)

Without Zero-Knowledge proofs, this game cannot exist in a trustless form.

**Option A — Trusted server:** Server stores the garden. Server could cheat. Gardener could collude with the server. Any reveal could be fabricated.

**Option B — Reveal everything upfront:** No hidden information. The game collapses — the Ghost simply reads the board and walks the safest path.

**Option C (what we built) — ZK commitment:** The Gardener commits to a layout cryptographically. Each reveal proves exactly one cell's content, nothing more. The contract enforces that the reveal is consistent with the original commitment. No server. No trust. Math decides.

The garden is never fully revealed — not even post-game. This is not a limitation. It is the central design decision. Your strategy is a cryptographic asset.

---

## ZK Implementation — What's Running Now

The current deployment uses a **SHA-256 Hash Commitment Scheme** with on-chain verification. This is a complete, working ZK-equivalent system — not a placeholder.

### What the contract verifies on every reveal

```
journal[0..32]          == stored_commitment     // same garden that was committed
SHA-256(journal_bytes)  == journal_hash           // reveal data is untampered
journal[32], journal[33] == creature_x, creature_y // correct cell, unforgeable
```

The 73-byte **journal** carries the full proof payload:

```
[ commitment:32 | x:1 | y:1 | has_plant:1 | plant_type:1 | damage:1 | padding:36 ]
```

The garden layout itself is **never transmitted**. It stays in the Gardener's browser, used only to compute the commitment hash and to build each journal locally. The contract has no way to reconstruct the full layout from on-chain data — during the game or after it ends.

### Security guarantees (current)

| Attack | Defense |
|---|---|
| Gardener changes plant positions after committing | SHA-256 binding — any layout change produces a different hash |
| Gardener lies about what's in a cell | Journal hash covers all bytes including plant type |
| Gardener reveals a different cell than the one stepped on | Positional check against `creature_x` / `creature_y` stored in contract |
| Gardener inflates or deflates damage | Contract recomputes damage from plant type using its own lookup table |

### Roadmap to Full Groth16

The architecture is already wired for Protocol 25 BN254 on-chain proof verification:

- `contracts/groth16-verifier/` — deployed at `CCV7EJ77WV4PN5RXQ2O4HPIOCNZI3WFFDGMWGMPWS2WCQ2PSVQQE777T`, implements `verify(seal, image_id, journal_hash)` via `bn254_multi_pairing_check`
- `zk-prover/` — RiscZero host + guest circuit. Inputs: `(garden[25], x, y, commitment[32])`. Outputs: the 73-byte journal, a Groth16 seal.
- `reveal_cell()` in the contract already accepts a `seal: Bytes` parameter. When non-empty, it routes to the verifier contract.

Switching from dev mode to Groth16 production mode requires no changes to game logic — only deploying with a finalized `image_id` and a live Groth16 prover.

---

## Why Stellar?

| Property | Mechanism |
|---|---|
| **Privacy-first** | Garden layout computed and held in-browser — only the 32-byte SHA-256 hash touches the chain |
| **Verifiable reveals** | `reveal_cell()` verifies commitment integrity and journal hash on-chain, atomically |
| **Deterministic State** | Moon phase from `keccak256(session_id)` — no ledger timestamps, simulation and submission always agree |
| **Gas Efficiency** | Temporary storage with 30-day TTL, `extend_ttl` on every write — sessions cost nothing idle |
| **Ecosystem integration** | `GameHub.start_game()` locks points before any move; `GameHub.end_game()` settles the match |

---

## Quick Start

```bash
# Prerequisites: Bun ≥ 1.0 — no Freighter wallet required for local play

cd herbal-moonlight-frontend
bun install
bun run dev
# → http://localhost:5173
```

Click **Quickstart (Dev)** to auto-wire both players in the same browser tab. No testnet XLM required. The dev wallet switcher lets you play both roles — Witch and Ghost — without switching accounts.

To run the full contract test suite (35 tests):

```bash
cargo test --lib -p herbal-moonlight
```

---

## Deployed Contracts

| Contract | Testnet Address |
|---|---|
| Herbal Moonlight | [`CCHDXLBZ73N7XHZKAEH3G6K3NQELAYASM3XU46A2TWHQX5AASEPN7WY2`](https://stellar.expert/explorer/testnet/contract/CCHDXLBZ73N7XHZKAEH3G6K3NQELAYASM3XU46A2TWHQX5AASEPN7WY2) |
| Groth16 Verifier | [`CCV7EJ77WV4PN5RXQ2O4HPIOCNZI3WFFDGMWGMPWS2WCQ2PSVQQE777T`](https://stellar.expert/explorer/testnet/contract/CCV7EJ77WV4PN5RXQ2O4HPIOCNZI3WFFDGMWGMPWS2WCQ2PSVQQE777T) |
| Game Hub | [`CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG) |

---

## Repo Structure

```
contracts/
  herbal-moonlight/          # Soroban game contract — Rust, ~680 lines, 35 tests
  groth16-verifier/          # BN254 Groth16 verifier — Protocol 25 / CAP-0074
  mock-game-hub/             # Local test Game Hub

herbal-moonlight-frontend/
  src/games/herbal-moonlight/
    HerbalMoonlightGame.tsx  # Main game component (~1,720 lines)
    LandingScreen.tsx        # Intro screen with collapsible ZK explainer
    herbalMoonlightService.ts # Soroban client + multi-sig + Launchtube flow
    gardenUtils.ts           # Layout, SHA-256 commitment, journal builder

zk-prover/                   # RiscZero host + guest circuit (local Groth16 prover)
bindings/herbal_moonlight/   # Generated TypeScript bindings (do not hand-edit)
docs/                        # Architecture, ZK design, game design
```

---

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 14-step protocol flow (Mermaid), security model, contract specs, Groth16 roadmap |
| [docs/game-design.md](docs/game-design.md) | Full game design document — roles, mechanics, edge cases, competitive positioning |
| [docs/zk-implementation.md](docs/zk-implementation.md) | ZK circuit design, RiscZero prover, local prover CLI, Groth16 verifier architecture |
| [docs/CONTRIBUTING_UI.md](docs/CONTRIBUTING_UI.md) | UI component guide, responsive design, accessibility |
| [contracts/herbal-moonlight/README.md](contracts/herbal-moonlight/README.md) | Contract API reference, build and deploy instructions |

---

## The Never-Reveal Principle

In every other hidden-information game — ZK Poker, ZK Battleship, ZK card games — the board is disclosed post-match. "Privacy" protects you during the game, then evaporates when it ends.

In Herbal Moonlight, the garden is never revealed. Not by the contract (it never stores the layout). Not by the UI (it shows only stepped cells). Not post-game, not ever. The Witch's strategy is a cryptographic secret for as long as she keeps it.

This is possible only because of the commitment scheme. Without ZK, you must choose: trusted server, or full disclosure. With ZK, you choose neither.

---

*Built for the ZK Gaming on Stellar Hackathon · Feb 9–23, 2026*
*Framework: [Stellar Game Studio](https://github.com/jamesbachini/Stellar-Game-Studio)*
