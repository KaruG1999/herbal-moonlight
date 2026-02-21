# Herbal Moonlight — Pending Features Implementation Guide

**For Claude Code:** This document lists features that are designed but NOT yet implemented.
Work through them in priority order. Each section includes exact files to modify and acceptance criteria.

**Guiding Principle:** Only implement what strengthens the hackathon submission.
The Never-Reveal garden design is SACRED — do not introduce any full-garden reveal.

---

## Priority 1 — High Impact, Low Effort (do these first)

---

### P1-A: Moon Phase Display at Game Start (UI Only) ✅ DONE

**What:** Show the active moon phase prominently when the game starts (during create or at the beginning of play), so both players know the modifiers before moving.

**Why:** Moon phases already exist in the contract and gardenUtils.ts. They just aren't surfaced visually in a clear, early moment. Judges need to SEE the mechanic to appreciate it.

**Files to touch:**
- `herbal-moonlight-frontend/src/games/herbal-moonlight/HerbalMoonlightGame.tsx`

**Where to add:** In the phase that shows after the game is created but before the creature's first move (the "waiting for commit" or "play starts" transition). Add a full-width moon phase announcement card.

**Design:**
```
┌─────────────────────────────────────┐
│  🌕 FULL MOON NIGHT                 │
│                                     │
│  The spirits are empowered tonight  │
│  Creature: +2 HP  |  Plants: -1 dmg │
└─────────────────────────────────────┘
```
Use `moonPhaseEmoji()`, `moonPhaseLabel()`, `moonPhaseEffect()` from `gardenUtils.ts` — these already exist.

**Acceptance criteria:**
- [x] Moon phase shown prominently at game start (not buried in a corner)
- [x] Both Gardener and Creature see the same info
- [x] HP bar and damage values reflect the modifier during play

---

### P1-B: ZK Proof Generation Progress UI ✅ DONE

**What:** During `handleRevealCell()`, show a visually engaging progress indicator that makes the ZK proof generation feel magical and important.

**Why:** ZK is invisible without UI feedback. Judges need to see it happening. Currently there's a generic loading spinner.

**Files to touch:**
- `herbal-moonlight-frontend/src/games/herbal-moonlight/HerbalMoonlightGame.tsx`

**Current behavior:** The button shows "Generating proof…" via `<span className="magic-loading">` but nothing more.

**Desired behavior:**
```
┌─────────────────────────────────────┐
│  🔮 Generating ZK Proof...          │
│                                     │
│  ✅ Garden hash verified            │
│  ✅ Cell coordinates encoded        │
│  ⏳ Creating Groth16 proof...       │
│  ████████████░░░░  75%              │
│                                     │
│  Proof: 128 bytes | ~0.0001 XLM     │
└─────────────────────────────────────┘
```

**Implementation notes:**
- Steps are simulated with `setTimeout` (actual proof is synchronous in dev mode)
- Use CSS animation for the progress bar
- Show proof size (73 bytes journal + seal) from the journal built in `buildJournal()`
- Duration: ~2-3 seconds total animation, regardless of actual compute time
- This is purely cosmetic — the actual `service.revealCell()` call happens in background

**Acceptance criteria:**
- [x] Multi-step progress shown during reveal
- [x] Animation feels smooth and "magical"
- [x] Disappears cleanly when proof completes
- [x] Works on mobile (doesn't overflow)

---

### P1-C: Post-Game Session Stats ✅ DONE

**What:** On the game-over screen, show stats for the session — only based on what was revealed (no full garden disclosure).

**Why:** Creates a memorable "wow" moment and reinforces the Never Reveal mechanic.

**Files to touch:**
- `herbal-moonlight-frontend/src/games/herbal-moonlight/HerbalMoonlightGame.tsx`
- Stats come from `gameState` (already fetched)

**Displayed stats:**
```
📊 Battle Report
─────────────────────────────
Cells stepped:     3 / 25  (12%)
Forever hidden:   22 / 25  (88%)  ← emphasize this
Damage dealt:      6 HP
Turns played:      5
Moon phase:        🌑 New Moon
─────────────────────────────
🔐 Garden hash: CCHDX...4J5 (permanent on-chain record)
```

**Implementation notes:**
- `gameState.revealed_cells` (Bytes from contract) tells you how many cells were stepped on
- Count bits set in `revealed_cells` for "cells stepped"
- `forever_hidden = 25 - cells_stepped`
- Garden hash is `gardenCommitment` (already in state)
- Show truncated contract address as "permanent record" proof

**Acceptance criteria:**
- [x] Stats visible on win/lose screen
- [x] "Forever hidden: X/25" displayed prominently (Never Reveal message)
- [x] Garden hash shown (truncated) with link to Stellar Expert
- [x] No full garden layout shown anywhere

---

## Priority 2 — Medium Impact, Medium Effort

---

### P2-A: Spirit Sense — Creature's Information Mechanic ✅ DONE (Demo Mode)

**What:** Allow the Creature to spend HP in exchange for spatial information about the garden, implemented as a ZK mini-proof.

**Why:** Spirit Sense is what makes the Creature role strategic (not just random walking). It creates risk/reward decisions and uses ZK in a second way.

**Design (from game-design.md):**

| Ability | HP Cost | Information Revealed |
|---------|---------|---------------------|
| Peek Adjacent | 1 HP | "Left cell: has plant YES/NO, Right cell: has plant YES/NO" |
| Smell Ahead | 1 HP | "Total plant count in next 2 rows: N" |

**Contract changes needed (`contracts/herbal-moonlight/src/lib.rs`):**
```rust
// New function — Creature spends HP, gets a signed/committed info reveal
pub fn spirit_sense_peek(
    env: Env,
    session_id: u32,
    creature: Address,
    // Gardener must call this with ZK proof covering left/right cells
) -> (bool, bool)  // (left_has_plant, right_has_plant)

pub fn spirit_sense_smell(
    env: Env,
    session_id: u32,
    creature: Address,
    // Gardener must call with ZK proof covering next 2 rows
) -> u32  // plant count
```

**Frontend changes needed:**
- Add "Spirit Sense" button panel visible during Creature's turn
- Show cost (1 HP) before confirming
- Display result with animation after Gardener responds
- Gardener gets a "Spirit Sense requested" notification + button to generate mini-proof

**Implementation complexity:** HIGH — requires contract changes + new ZK proofs + 2-player coordination.

**MVP simplification option:** Implement client-side only (Gardener reports honestly, no ZK enforcement). This is less secure but visually demonstrates the mechanic. Flag it clearly as "demo mode."

**Acceptance criteria:**
- [x] Creature can request Spirit Sense during their turn (panel visible only in Playing phase)
- [x] HP cost deducted client-side (displayed immediately; resets on move)
- [x] Result displayed clearly: Peek shows left/right cell status, Smell shows plant count
- [x] Demo mode: reads garden from localStorage (works same-browser); shows ZK narrative for separate browsers
- [x] Does not end the creature's turn — move separately after using ability

---

### P2-B: Lavender "Calming Mist" Special Effect ✅ DONE

**What:** When Creature steps on a Lavender cell, the damage from the NEXT plant they step on is reduced by 1.

**Current behavior:** Lavender just deals 1 HP damage with no special effect.

**Contract changes needed (`contracts/herbal-moonlight/src/lib.rs`):**
```rust
// Add to GameSession struct:
calming_mist_active: bool,  // set when lavender triggers

// In reveal_cell logic:
if plant_type == 1 {  // Lavender
    session.calming_mist_active = true;
}
// When applying damage:
if session.calming_mist_active && actual_damage > 0 {
    actual_damage = actual_damage.saturating_sub(1);
    session.calming_mist_active = false;  // consumed
}
```

**Frontend changes needed:**
- Show "Calming Mist active!" status indicator during play
- When mist triggers damage reduction: "🌸 Calming Mist absorbed 1 damage!"

**Acceptance criteria:**
- [x] Lavender hit sets damage_reduction on-chain (contract uses `damage_reduction: u32` — already implemented)
- [x] Next damage is reduced by 1 (minimum 1 enforced by contract)
- [x] UI shows mist status clearly (teal badge with 🌸, absorb message in reveal feedback)
- [x] Mist consumed after one use

---

### P2-C: Proof Generation Feedback — Show Journal Details ✅ DONE

**What:** After `revealCell()` completes, briefly show the proof details in a technical panel (for judges who want to see the ZK mechanic in action).

**Files to touch:**
- `herbal-moonlight-frontend/src/games/herbal-moonlight/HerbalMoonlightGame.tsx`

**Displayed after reveal (collapsible "ZK Details" panel):**
```
🔐 ZK Proof Details (expand)
├── Journal hash: 0xabc...def
├── Garden commitment: 0x123...456
├── Cell: (2, 3)
├── Result: Plant found (Mandrake, 3 dmg)
├── Proof mode: Dev (SHA-256 hash verification)
└── On-chain tx: [view on Stellar Expert →]
```

**Acceptance criteria:**
- [x] Collapsible panel after each reveal (collapsed by default)
- [x] Shows journal hash + commitment + cell + result + proof mode
- [x] Links to Stellar Expert contract page
- [x] Collapsed by default (doesn't clutter the UI)

---

## Priority 3 — Nice to Have (only if time allows)

---

### P3-A: Timeout / Forfeit Handling

**What:** If a player doesn't move within a time limit, the other player wins by default.

**Contract changes:**
- Store `last_action_ledger` in session
- Add `claim_timeout_win(session_id)` that checks if `current_ledger - last_action_ledger > TIMEOUT_LEDGERS`

**Frontend:** Show countdown timer. "Opponent must move in 5:00 or you win."

**Complexity:** Medium. Can skip for hackathon — judges won't test this.

---

### P3-B: Strategy Vault (Coming Soon) ✅ DONE

**What:** After winning, Gardener can "vault" their garden commitment hash on-chain. Others can challenge the vault by paying XLM. Winner gets 80% of pot. Garden layout NEVER revealed even after 100 challenges.

**Why it matters:** This is the economic layer that makes ZK genuinely valuable beyond a single game. The garden hash is a tradeable cryptographic asset.

**Status:** Design complete. Implementation deferred post-hackathon.

**For hackathon:** Show a "🔒 Vault this garden" button on the win screen that is disabled/greyed with tooltip "Coming soon — your strategy is already forever yours."

**Acceptance criteria for hackathon:**
- [x] Button visible on win screen (gardener wins)
- [x] Tooltip explains the concept
- [x] Does NOT need to be functional

---

### P3-C: Full Groth16 Proof Integration (zk-prover)

**What:** Connect `zk-prover/` (RiscZero host) to the frontend so actual Groth16 proofs are generated and verified on-chain via the `groth16-verifier` contract.

**Current state:** `zk-prover/` exists with host + methods + guest. The contract has a `verifier_id` stored. The frontend uses dev mode (empty seal, hash-only verification).

**Integration steps:**
1. `zk-prover/host/src/main.rs` needs to accept journal bytes and output seal
2. Frontend needs to call the local prover binary (or a local API) during `revealCell()`
3. The `seal` passed to the contract must be the actual Groth16 proof bytes
4. Contract switches from dev mode to production mode when `seal` is non-empty

**Complexity:** HIGH — this is the most technically ambitious remaining item.
**For hackathon:** Dev mode is acceptable. Document the path clearly in README.

---

## Implementation Order Recommendation

```
Week 1 priority:
  P1-A → Moon Phase Display     (1-2 hours, pure UI)
  P1-C → Post-Game Stats        (2-3 hours, pure UI)
  P1-B → ZK Progress Bar        (2-3 hours, pure UI)

Week 2 priority (if time):
  P2-B → Lavender Calming Mist  (3-4 hours, contract + UI)
  P2-C → ZK Proof Details panel (1-2 hours, pure UI)
  P2-A → Spirit Sense           (6-8 hours, contract + UI + coordination)

Post-hackathon:
  P3-A → Timeout handling
  P3-B → Strategy Vault
  P3-C → Full Groth16 integration
```

---

## Notes for Claude Code

- **Never Reveal is sacred.** No feature should expose the full garden layout. Period.
- **Game Hub integration must not break.** `start_game()` and `end_game()` are called in `lib.rs`. Do not remove or bypass these calls.
- **Dev mode seal is intentional.** `seal = Buffer.alloc(0)` tells the contract to use hash-only verification. This is the current working mode.
- **`sentTx.result` returns `Result<T>` wrapper** — always unwrap defensively: `if (typeof raw.isOk === 'function') return raw.isOk() ? raw.unwrap() : null`
- **Moon phase is already computed from session_id in contract** — do not add ledger-based randomness.
- **MAX_PLANTS = 8** in `gardenUtils.ts` — do not change without contract coordination.
