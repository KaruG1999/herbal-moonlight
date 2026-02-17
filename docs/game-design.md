🌙 Herbal Moonlight - Game Design Document
🎯 One-Sentence Pitch
Asymmetric strategy game where Zero-Knowledge Proofs enable hidden garden defense - you prove you blocked your opponent without revealing your full strategy.

🎮 Core Concept
Genre: Asymmetric 2-player strategy (tower defense meets hidden information)
Aesthetic: Witchy cottage core with pixel art - cozy but competitive
Session Length: 5-7 turns (~5-10 minutes per game)
Platform: Web-based on Stellar blockchain with ZK proofs via RiscZero

👥 Players & Roles
Player 1: The Gardener 🌿

Goal: Defend your house by blocking the Creature's path
Setup: Place 7 medicinal plants secretly on a 5x5 grid
Mechanic: Generate ZK proofs to reveal cells when attacked
Win Condition: Reduce Creature HP to 0 OR block all possible paths

Player 2: The Creature 👻

Goal: Reach the Gardener's house (bottom row)
Setup: No setup - enters from top row
Mechanic: Choose path through fog of war, optionally use Spirit Sense
Win Condition: Reach row 4 (Gardener's house) with >0 HP


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

🌱 Plant Types (Defender Units)
🌸 Baby Lavender

Role: Support/Heal
Damage: 1 HP
Special: "Calming Mist" - reduces next attack damage
Visual: Purple flowers with sleepy face

🍃 Baby Mint

Role: DPS (Damage)
Damage: 2 HP
Special: "Fresh Blast" - standard attack
Visual: Green pointed leaves with alert eyes

🌰 Baby Mandrake

Role: Tank/Blocker
Damage: 1 HP
Special: "Root Shield" - high effective HP (counts as 3 HP toward blocking)
Visual: Round root body with crossed arms

Plant Placement: Gardener places 7 plants total during setup phase

👻 Creature Types
🦊 Spirit Fox (MVP - solo este)

Starting HP: 6
Movement: Standard (1 forward + optional 1 lateral per turn)
Special Abilities: Spirit Sense (costs HP)

Future creatures (post-MVP):

🦋 Moon Moth: Can skip cells (Flutter ability)
🐺 Shadow Wolf: Higher HP, slower


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
Implementation:
rustpub fn get_moon_phase(env: Env, session_id: u32) -> MoonPhase {
    let seed = (session_id as u64)
        .wrapping_mul(env.ledger().sequence() as u64);
    
    match seed % 100 {
        0..=19 => MoonPhase::FullMoon,
        20..=39 => MoonPhase::NewMoon,
        _ => MoonPhase::Balanced,
    }
}
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

## 🏆 Post-Game: Garden Autopsy

**"Among Us" style reveal moment:**
```
═══════════════════════════════════
🎉 GARDENER WINS! 🎉
═══════════════════════════════════

Final Garden Layout Revealed:
┌─┬─┬─┬─┬─┐
│ │🌸│ │ │ │  
├─┼─┼─┼─┼─┤
│ │ │🌱│ │ │  ← You hit this (Turn 2)
├─┼─┼─┼─┼─┤
│🌰│ │ │ │🌸│  ← Would've killed you!
├─┼─┼─┼─┼─┤
│ │🥜│ │🥜│ │  ← NEVER FOUND
├─┼─┼─┼─┼─┤
│ │ │🌰│ │ │  ← House
└─┴─┴─┴─┴─┘

💀 "You were 1 move from winning!"

📊 Stats:
- Cells revealed: 3/25 (12%)
- HP wasted on empty: 0
- Optimal path existed: ✅
- Bluff success rate: 2/3

[Rematch] [Share Replay]
Why this matters:

✅ Shareable "wow" moment
✅ Learning opportunity
✅ Showcases ZK magic (full reveal only AFTER game)


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

## 🛠️ Tech Stack

### **Blockchain Layer:**
- **Smart Contracts:** Soroban (Stellar)
- **Network:** Stellar Testnet
- **Game Hub:** `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`

### **Zero-Knowledge:**
- **zkVM:** RiscZero
- **Proof System:** Groth16 (via Nethermind verifier)
- **Hash Function:** SHA256 (ZK-friendly)

### **Frontend:**
- **Framework:** React + TypeScript (via Stellar Game Studio)
- **Styling:** TailwindCSS
- **Wallet:** Freighter / Stellar Wallets Kit
- **Build:** Vite

### **Backend:**
- **Prover Service:** Node.js
- **RiscZero Host:** Rust binary
- **API:** REST endpoints for proof generation

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
- ✅ Stellar-native payments (Spirit Sense)
- ✅ Community potential (strategy sharing)
- ✅ Extensible design (more plants/creatures)

---

## 🚀 MVP Feature List

### **MUST HAVE (Core):**
1. ✅ 5x5 grid gameplay
2. ✅ 3 plant types functional
3. ✅ 1 creature type (Spirit Fox)
4. ✅ ZK commitment + reveal working
5. ✅ Game Hub integration (start/end game)
6. ✅ Win/lose conditions enforced
7. ✅ Wallet switching (dev mode)

### **SHOULD HAVE (Differentiators):**
8. ✅ Spirit Sense (Peek/Smell abilities)
9. ✅ Moon Phases (3 types minimum)
10. ✅ Garden Autopsy (post-game reveal)
11. ✅ Emotes (5 basic reactions)

### **SKIP (Post-hackathon):**
- ❌ Strategy NFTs marketplace
- ❌ Spectator mode with betting
- ❌ Creature Journal (AI learning)
- ❌ Seasonal events
- ❌ Achievement system

---

## 🎬 Video Demo Structure (2:30)
```
0:00-0:20 HOOK
"What if you could prove you won without revealing your strategy?"
[Show garden commitment + selective reveal]

0:20-1:00 SETUP
Gardener places plants → generates commitment
Creature sees fog of war → must navigate blind

1:00-1:40 GAMEPLAY
Creature uses Spirit Sense → finds hints
Attacks cell → Gardener generates ZK proof
Reveal shows plant → damage dealt
Board state updates → only that cell visible

1:40-2:00 CLIMAX
Garden Autopsy reveal → "You were 1 move away!"
Full layout shown → Creature's path highlighted

2:00-2:30 TECH
"Built on Stellar Protocol 25 + RiscZero
Zero-Knowledge Proofs make this gameplay possible"
[GitHub link + Live demo]
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

📖 Glossary
Garden: The 5x5 grid where Gardener places plants
Commitment: Cryptographic hash of garden layout stored on-chain
Reveal: ZK proof showing contents of specific cell
Spirit Sense: Creature's HP-costing ability to gain information
Moon Phase: Random modifier affecting game rules
Autopsy: Post-game full garden reveal
Bluff: Unverified claim (psychological warfare)

Version: 1.0 (Final for MVP)
Last Updated: 2025-02-07
Status: Ready for implementation
