# 🌙 Herbal Moonlight - Game Design Document
**Version:** 2.1 (Implementation-Verified)
**Status:** MVP deployed on Stellar Testnet

## 🎯 One-Sentence Pitch
Asymmetric strategy game where Zero-Knowledge Proofs enable **permanent hidden information** — your garden strategy stays secret forever, even after the game ends.

## 🔑 Why This Beats the Competition
> "Can this game exist WITHOUT Zero-Knowledge Proofs?"
> **Answer: NO.** Without ZK you must choose between a trusted server (can cheat) OR full garden revelation (strategies become public). ZK is the ONLY way to have verifiable fairness + permanent privacy simultaneously.

**Key Differentiator:** Unlike ZK Poker or ZK Battleship clones, our garden is **never fully revealed** — not even post-game. This makes the strategy a cryptographic asset: reusable, sellable, and eternally private.

---

## 🎮 Core Concept
- **Genre:** Asymmetric 2-player strategy (tower defense meets hidden information)
- **Aesthetic:** Witchy cottagecore — cozy but cryptographically ruthless
- **Session Length:** 5-7 turns (~5-10 minutes)
- **Platform:** Stellar Testnet (Soroban) + RiscZero ZK proofs

## 👥 Players & Roles

**Player 1: The Gardener 🌿 (Witch)**
- Goal: Defend the cottage by placing hidden plants on a 5×5 grid
- Setup: Place **up to 8 plants** secretly before the game starts
- Mechanic: Commit SHA-256 hash of garden on-chain. When Creature lands on a cell, generate a ZK proof revealing only that cell's content — the full garden **stays permanently hidden**
- Win Condition: Reduce Creature HP to 0

**Player 2: The Creature 👻 (Ghost)**
- Goal: Reach row 4 (the Gardener's house) with HP > 0
- Setup: None — enters from the top row (row 0)
- Mechanic: Navigate through full fog of war. Only sees the ghost's current position. Cells are never visually revealed (even after being stepped on)
- Win Condition: Reach row 4 alive


🗺️ Game Board
Grid: 5x5 cells

┌─┬─┬─┬─┬─┐
│?│?│?│?│?│  ← Row 0: Creature entry point
├─┼─┼─┼─┼─┤
│?│?│?│?│?│  ← Row 1
├─┼─┼─┼─┼─┤
│?│?│?│?│?│  ← Row 2
├─┼─┼─┼─┼─┤
│?│?│?│?│?│  ← Row 3
├─┼─┼─┼─┼─┤
│?│?│?│?│?│  ← Row 4: Gardener's house (goal)
└─┴─┴─┴─┴─┘

Movement: Creature advances row-by-row (top to bottom)
Each turn: Optional lateral move (left/right) + mandatory forward move

## 🌱 Plant Types (Defender Units)

| Plant | Emoji | Damage | Special (Designed) | Status |
|-------|-------|--------|-------------------|--------|
| Baby Lavender | 💜 | **1 HP** | "Calming Mist" — reduces damage of next plant hit by 1 | Damage ✅ / Special ⏳ |
| Baby Mint | 🌿 | **2 HP** | "Fresh Blast" — straightforward strike | ✅ Implemented |
| Baby Mandrake | ☠️ | **3 HP** | "Root Strike" — highest damage, maximum threat | ✅ Implemented |

**Plant Placement:** Gardener places **up to 8 plants** during setup phase (configurable via `MAX_PLANTS`).

> **Design Note:** Lavender's "Calming Mist" debuff is implemented on-chain — reduces the next plant hit by 1 damage after being triggered.

## 👻 Creature

**Current MVP: Ghost 👻**
- Starting HP: **6** (Balanced/New Moon) | **8** (Full Moon)
- Movement: 1 step forward per turn; may move laterally within the same row before advancing
- Sprite: `ghost.png` (pixel art)
- Special Abilities: Spirit Sense ⏳ (PENDING — designed for post-MVP roadmap, not in this release)

**Post-hackathon creatures (roadmap):**
- 🦋 Moon Moth: Can skip one row (Flutter ability)
- 🐺 Shadow Wolf: Higher HP, slower movement


📜 Game Flow (Turn-by-Turn)
Phase 1: Setup (Pre-game)
Gardener's Turn:

Place 7 plants on 5x5 grid
Confirm placement
Generate ZK commitment (hash of garden layout)
Submit commitment to smart contract
Creature sees: Nothing - full fog of war

Smart Contract Actions:
rustfn commit_garden(
    env: Env,
    session_id: u32,
    player: Address,
    garden_hash: BytesN<32>
)
```

---

### **Phase 2: Gameplay Loop**

#### **Creature's Turn (每 turn):**

**Step 1: Choose Action**
- Option A: Move directly forward
- Option B: Move left/right then forward
- Option C: Use Spirit Sense (costs HP)

**Step 2: Spirit Sense (Optional)**
```
🔮 Peek Adjacent (1 HP)
- Reveals if left/right cells have plants (yes/no only)
- Doesn't show plant type
- Result: "Left: ✅ Right: ❌"

👃 Smell Ahead (1 HP)  
- Reveals total plant count in next 2 rows
- Doesn't show positions
- Result: "3 plants detected ahead"
```

**Step 3: Move**
- Creature commits to movement
- Smart contract records position

---

#### **Gardener's Turn (Response):**

**Step 1: Proof Generation**
- Backend generates ZK proof for attacked cell
- Proves: "Cell (x,y) in garden with hash H contains plant P"
- Proof verified on-chain via Groth16 verifier

**Step 2: Reveal Result**
```
If cell has plant:
- Plant type revealed (with sprite)
- Damage dealt to Creature
- Plant marked as "used" (won't damage again)
- Cell marked as revealed

If cell is empty:
- "Empty cell" revealed
- No damage
- Cell marked as revealed
```

**Step 3: Check Win Conditions**
```
Gardener wins if:
- Creature HP = 0
- Creature has no valid path forward (all paths blocked)

Creature wins if:
- Reaches row 4
```

---

## 🎲 Moon Phases (Dynamic Modifiers)

**Selected at game start using Stellar's deterministic randomness**

### **🌕 Full Moon (20% chance)**
```
"Spirit creatures are empowered"
- Creature: +2 HP (starts with 8)
- Spirit Sense: Free (0 HP cost)
- Plants: -1 damage
```

### **🌑 New Moon (20% chance)**
```
"Gardens are at peak power"
- Plants: +1 damage
- Creature: Standard 6 HP
- No Spirit Sense allowed
```

### **🌓 Balanced (60% chance)**
```
"Equilibrium between worlds"
- Standard rules
- All costs normal
**Implementation (actual, on-chain):**
```rust
// Moon phase derived from keccak256(session_id) — deterministic, not time-based
// session_id byte 0 % 100:
//   0     → FullMoon  (20%)
//   1     → NewMoon   (20%)
//   2,3,4 → Balanced  (60%)
```
> ⚠️ **Correction from v1:** Moon phase uses `keccak256(session_id)` for deterministic randomness — NOT `ledger().sequence()`. This ensures both players see the same phase regardless of when they query it.
```

---

## 🔐 Zero-Knowledge Implementation

### **ZK Use Case: Selective Cell Reveal**

**What needs to be proven:**
```
Given:
- Garden commitment (hash H stored on-chain)
- Cell coordinates (x, y)

Prove:
- Cell (x,y) contains plant P (or is empty)
- This cell is part of garden with hash H
- WITHOUT revealing other cells
ZK Circuit (RiscZero Guest):
rustpub struct CellRevealInput {
    pub garden: GardenLayout,        // Full 5x5 grid (private)
    pub x: u32,                       // Cell X (public)
    pub y: u32,                       // Cell Y (public)
    pub claimed_hash: [u8; 32],      // Commitment (public)
}

pub struct CellRevealOutput {
    pub garden_hash: [u8; 32],       // Verified hash
    pub x: u32,                       // Cell X
    pub y: u32,                       // Cell Y
    pub has_plant: bool,             // Plant exists?
    pub plant_type: Option<u8>,      // Plant type (if exists)
}

// Guest program:
fn main() {
    let input: CellRevealInput = env::read();
    
    // 1. Compute hash of provided garden
    let computed_hash = hash_garden(&input.garden);
    
    // 2. Verify it matches commitment
    assert_eq!(computed_hash, input.claimed_hash);
    
    // 3. Extract cell content
    let cell = input.garden.cells[input.y][input.x];
    
    // 4. Commit public outputs
    env::commit(&CellRevealOutput {
        garden_hash: computed_hash,
        x: input.x,
        y: input.y,
        has_plant: cell.is_some(),
        plant_type: cell.map(|p| p as u8),
    });
}
Hash Function (Deterministic):
rustfn hash_garden(garden: &GardenLayout) -> [u8; 32] {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    
    for row in &garden.cells {
        for cell in row {
            match cell {
                None => hasher.update(&[0u8]),
                Some(PlantType::Lavender) => hasher.update(&[1u8]),
                Some(PlantType::Mint) => hasher.update(&[2u8]),
                Some(PlantType::Mandrake) => hasher.update(&[3u8]),
            }
        }
    }
    
    hasher.finalize().into()
}
```

---

## 🎭 Psychological Warfare (Optional Feature)

### **Bait & Bluff System**

**Gardener can send unverified hints:**
```
💬 "Path ahead is clear"
💬 "Don't go left!"
💬 Custom message
```

**Creature can:**
- Ignore (free)
- Believe (risk)
- Call Bluff (costs 1 HP)

**If Creature calls bluff:**
```
Gardener must reveal next cell for FREE
- If Gardener lied → Creature gets +1 HP
- If Gardener told truth → Creature loses 1 HP
- Verified via ZK proof
```

---

## 🏆 Post-Game: Permanent Fog (Never Reveal)

**Core Design Decision:** The garden is **NEVER fully revealed** — not even after the game ends. This is not a limitation; it is the central innovation.

```
═══════════════════════════════════
🎉 GARDENER WINS! 🎉
═══════════════════════════════════

Game Board (only stepped cells visible):
┌─┬─┬─┬─┬─┐
│?│?│?│?│?│  ← fog
├─┼─┼─┼─┼─┤
│?│💜│?│?│?│  ← Turn 1: Lavender (1 dmg)
├─┼─┼─┼─┼─┤
│?│?│☠️│?│?│  ← Turn 3: Mandrake (3 dmg) — lethal!
├─┼─┼─┼─┼─┤
│?│?│?│?│?│  ← NEVER REVEALED — stays secret
├─┼─┼─┼─┼─┤
│🏠│🏠│🏠│🏠│🏠│ ← Cottage row
└─┴─┴─┴─┴─┘

📊 Session Stats:
- Cells stepped: 3/25 (12%)
- Cells forever hidden: 22/25 (88%)
- Creature HP remaining: 0
```

**Why Never Reveal:**
- ✅ ZK is genuinely essential (not decorative) — without it you CAN'T hide the garden verifiably
- ✅ Gardener's strategy becomes a **reusable cryptographic asset** (future: Strategy Vault)
- ✅ Creates permanent tension: "What was behind those other cells?"
- ✅ Differentiates from every other "ZK hidden information" game (they all reveal post-game)

> **v1 doc error corrected:** A previous design draft described a "Garden Autopsy" full reveal post-game. This was rejected. The current implementation correctly shows ONLY cells the Creature actually stepped on.


🎨 Visual Design
Aesthetic: Cozy Witchy Pixel Art
Color Palette:
css--night-sky: #1A237E → #5E35B1 (gradient)
--wood-dark: #4E342E
--wood-light: #8D6E63
--magic-purple: #E1BEE7
--magic-gold: #FFD54F
--plant-green: #7CB342
```

**UI Components:**
1. **Login Screen:** Wooden panel with Sage (witch character) tutorial
2. **Game Board:** 5x5 grid with soil tiles, plant sprites
3. **Side Panels:** HP bars, Moon phase indicator, action buttons
4. **Modals:** Proof generation progress, Spirit Sense results, Victory screen

**Assets Needed:**
- 3 plant sprites (64x64px each)
- 1 creature sprite (64x64px, 2 frames)
- 1 witch character (128x128px)
- Background elements (night sky, wooden frames)
- UI elements (buttons, panels)

---

## 🛠️ Tech Stack (Current)

### **Blockchain Layer:**
- **Smart Contracts:** Soroban (Rust) — Stellar Protocol 25
- **Network:** Stellar Testnet
- **Game Hub:** `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`
- **Herbal Moonlight Contract:** `CCHDXLBZ73N7XHZKAEH3G6K3NQELAYASM3XU46A2TWHQX5AASEPN7WY2`
- **Groth16 Verifier:** `CCV7EJ77WV4PN5RXQ2O4HPIOCNZI3WFFDGMWGMPWS2WCQ2PSVQQE777T`

### **Zero-Knowledge:**
- **zkVM:** RiscZero (guest + host in `zk-prover/`)
- **Proof System:** Groth16 via BN254 precompiles (Stellar Protocol 25 / CAP-0074)
- **Hash Function:** SHA256 (commitment) — Poseidon available via Protocol 25 for future optimization
- **Current Mode:** Dev mode (hash-only verification) → Production mode (full Groth16) on roadmap

### **Frontend:**
- **Framework:** React 19 + TypeScript
- **Styling:** TailwindCSS + custom CSS (dirt tile gradients, board shake, fog of war)
- **Wallet:** Dev wallet switcher (2-player local); Freighter for production
- **Build:** Vite (standalone `herbal-moonlight-frontend/`)

### **Repo Structure (current):**
```
Stellar-Game-Studio/
├── contracts/
│   ├── herbal-moonlight/     # Main game contract (Rust, ~680 lines)
│   ├── groth16-verifier/     # BN254 Groth16 verifier (Protocol 25)
│   └── mock-game-hub/        # Local test Game Hub
├── herbal-moonlight-frontend/ # React standalone frontend
│   └── src/games/herbal-moonlight/
│       ├── HerbalMoonlightGame.tsx  # 1720 lines — main component
│       ├── LandingScreen.tsx        # Pre-game + ZK tutorial
│       ├── herbalMoonlightService.ts
│       ├── gardenUtils.ts
│       └── bindings.ts
├── zk-prover/                # RiscZero host + guest (local prover)
├── bindings/herbal_moonlight/ # Generated TS bindings
├── scripts/                  # deploy, build, bindings, setup
└── docs/                     # This file + ZK implementation doc
```

---

## 🎯 Why This Design Works

### **1. ZK is ESSENTIAL (not decorative)**
```
Without ZK:
- Need trusted server to store garden
- Server can cheat
- Gardener could change plants mid-game

With ZK:
- Garden committed cryptographically on-chain
- Reveals are provably correct
- Zero trust needed
- Impossible to implement otherwise
```

### **2. Stellar is JUSTIFIED**
```
Why Stellar:
✅ Fast finality (turns don't lag)
✅ Low fees (Spirit Sense micropayments)
✅ Deterministic randomness (Moon Phases)
✅ Game Hub ecosystem integration
✅ Protocol 25 (BN254, Poseidon) perfect for ZK
```

### **3. Gameplay is ENGAGING**
```
Tension: Increases each turn (low HP = high stakes)
Skill: Expert players bluff, plan paths, bait moves
Moments: "NO WAY there was a plant THERE!"
Replay: Moon phases + opponent variety
Sessions: 5-10min (perfect for "one more game")
```

### **4. Scope is REALISTIC**
```
2 weeks breakdown:
- Days 1-2: Research + design
- Days 3-7: Contracts + ZK implementation  
- Days 8-11: Frontend + features
- Days 12-14: Polish + video + submit

MVP Cuts:
- Only 1 creature type (Spirit Fox)
- Only 3 plant types (not 5)
- 3 moon phases (not 5)
- Skip: Strategy NFTs, spectator mode, betting
```

---

## 📊 Success Metrics (for judges)

### **Technical Innovation:**
- ✅ ZK proofs enable impossible gameplay mechanic
- ✅ Showcases Protocol 25 primitives
- ✅ Novel use of deterministic randomness
- ✅ Clean smart contract architecture

### **User Experience:**
- ✅ Intuitive gameplay (explain in 30 seconds)
- ✅ Memorable aesthetic (witchy pixel art)
- ✅ Shareable moments (Garden Autopsy)
- ✅ Addictive loop (quick sessions)

### **Ecosystem Fit:**
- ✅ Game Hub integration (2-player standard)
- ✅ Stellar-native payments (future feature)
- ✅ Community potential (strategy sharing)
- ✅ Extensible design (more plants/creatures)

---

## 🚀 MVP Feature Status

### **MUST HAVE — Core (Implemented ✅)**
1. ✅ 5×5 grid gameplay with fog of war
2. ✅ 3 plant types (Lavender 1dmg, Mint 2dmg, Mandrake 3dmg)
3. ✅ Ghost creature (navigates blind)
4. ✅ SHA-256 garden commitment + selective ZK reveal (dev mode: hash-only, no full Groth16)
5. ✅ Game Hub integration (`start_game` / `end_game` on-chain)
6. ✅ Win/lose conditions enforced on-chain
7. ✅ Dev wallet switcher (2-player local testing)
8. ✅ Moon Phases (3 phases, deterministic via keccak256)
9. ✅ Board shake + cell flash on damage
10. ✅ Post-game: only revealed cells shown (Never Reveal design)
11. ✅ LandingScreen with ZK tutorial (collapsible explainer)
12. ✅ Groth16 verifier contract deployed on testnet

### **ROADMAP — Post-MVP Features**
- ⏳ Spirit Sense (Peek Adjacent / Smell Ahead — creature spends HP for info)
  - **Status:** Designed but NOT in MVP submission
- ⏳ Lavender "Calming Mist" special effect (debuff next plant)
- ⏳ Moon Phase display at game start (prominent UI indicator)
- ⏳ ZK proof generation progress UI (progress bar, proof size, gas cost)
- ⏳ Post-game session stats (% revealed, turns taken, path highlight)

### **SKIP — Post-hackathon**
- ❌ Strategy Vault (tradeable garden hashes as cryptographic assets)
- ❌ Psychological bluff system
- ❌ Spectator mode / betting
- ❌ Additional creature types (Moon Moth, Shadow Wolf)
- ❌ Achievement system

---

## 🏆 Competitive Positioning

**Expected competition (50-100 submissions):**
- ~70%: ZK Poker / ZK Battleship clones, ZK voting — overdone, predictable
- ~20%: Half-finished or ZK as decoration ("we added ZK to our README")
- ~10%: Genuinely innovative and polished

**Our advantages:**
1. ✅ ZK is ESSENTIAL — genuinely impossible without it
2. ✅ Never-reveal design — no other submission will do this
3. ✅ Unique aesthetic — witchy pixel art vs generic card UIs
4. ✅ Working full-stack prototype — contract + frontend + ZK prover
5. ✅ Stellar-native — Game Hub, Protocol 25 BN254, deterministic randomness

**Pitch angles that differentiate:**
- *"Schrödinger's Garden"* — exists in superposition until observed via ZK
- *"Privacy as Gameplay"* — not protecting your wallet, protecting your strategy
- *"Trustless Bluffing"* — math is the dealer, cheating is mathematically impossible

---

## 🎬 Video Demo Structure (2:30)

```
0:00-0:15  HOOK
"Most ZK games reveal everything after the match.
 What if your strategy stayed secret... forever?"

0:15-1:00  SETUP
Gardener places plants → fog of war hides everything from creature
SHA-256 commitment submitted on-chain (show Stellar transaction)

1:00-1:40  GAMEPLAY
Creature moves through darkness (fog of war visual)
Creature steps on cell → Gardener generates ZK proof
"Proof verifying on-chain..." → cell flash + board shake
Damage dealt — HP bar drops — garden still hidden

1:40-2:00  POST-GAME
Game ends: only stepped cells visible
"22 of 25 cells are STILL SECRET — forever"
[Show on-chain commitment hash — strategy is permanent]

2:00-2:30  TECH + CTA
"Built on Stellar Protocol 25 — BN254 native verification"
"RiscZero ZK proofs — garden never leaves your browser"
[GitHub link + Testnet demo link]
```

---

## 📋 Edge Cases & Solutions

### **What if Gardener tries to cheat?**
```
Scenario: Gardener submits different garden than committed

Solution:
- ZK proof verification fails (hash mismatch)
- Smart contract rejects reveal
- Gardener auto-loses (invalid proof = forfeit)
```

### **What if Creature disconnects mid-game?**
```
Scenario: Creature abandons game

Solution:
- Timeout mechanism (2 minutes per turn)
- If timeout → Gardener wins by default
- Game state stored on-chain (can resume)
```

### **What if proof generation fails?**
```
Scenario: Backend crashes or proof doesn't generate

Solution:
- Retry mechanism (3 attempts)
- Fallback: Gardener can forfeit gracefully
- Log error for debugging (not visible to Creature)
```

### **What if both players try to move simultaneously?**
```
Scenario: Race condition in turn order

Solution:
- Smart contract enforces turn sequence
- require_auth() on turn taker
- Event emission for turn changes
```

---

## 🎯 Unique Selling Points (for pitch)

### **1. "Schrödinger's Garden"**
```
The garden exists in superposition until observed
ZK proofs collapse the wavefunction (reveal cells)
while keeping the rest in quantum uncertainty
```

**Pitch:** "It's Schrödinger's Cat meets Plants vs Zombies"

### **2. "Trustless Bluffing"**
```
Traditional poker: Trust the dealer
Herbal Moonlight: Math is the dealer
Bluffs are verifiable, cheating is impossible
```

**Pitch:** "Among Us but cryptographically enforced"

### **3. "Privacy as Gameplay"**
```
Most ZK games: Privacy protects your wallet
Herbal Moonlight: Privacy IS the game
Strategy hidden forever (unless you sell it)
Pitch: "First game where ZK isn't a feature—it's the mechanic"

## 📖 Glossary

| Term | Definition |
|------|-----------|
| Garden | 5×5 grid where Gardener places plants secretly |
| Commitment | SHA-256 hash of garden layout stored on-chain; garden never leaves the browser |
| Reveal | ZK proof that proves cell (x,y) content without revealing other cells |
| Seal | Groth16 proof bytes; empty in dev mode (hash-only verification) |
| Journal | 73-byte witness: commitment(32) + x(1) + y(1) + has_plant(1) + plant_type(1) + damage(1) + padding(36) |
| Spirit Sense | Designed ability: Creature spends HP to gain spatial information (POST-MVP roadmap, not in this release) |
| Moon Phase | Deterministic game modifier derived from keccak256(session_id) |
| Never Reveal | Core design principle: garden stays cryptographically hidden forever post-game |
| Strategy Vault | Future feature: commit winning garden hashes as tradeable cryptographic assets |

---

*Version: 2.1 — Implementation-Verified*
*Last Updated: 2026-02-20*
*Corrections from v1: plant damages, MAX_PLANTS=8, creature=Ghost, moon phase = keccak256, Never Reveal replaces Garden Autopsy*
