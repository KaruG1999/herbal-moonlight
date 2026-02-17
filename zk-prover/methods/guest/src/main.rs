//! # Herbal Moonlight ZK Circuit - Cell Reveal
//!
//! This is the guest code that runs inside the RiscZero zkVM.
//! It proves that a specific cell in the garden contains a particular plant
//! WITHOUT revealing the entire garden layout.
//!
//! ## What this circuit proves:
//! 1. The garden layout hashes to the committed value
//! 2. The garden layout is valid (max 7 plants, no plants in house row)
//! 3. The cell at (x, y) contains a specific plant type
//! 4. This proof is bound to a specific session and gardener
//!
//! ## Privacy guarantees:
//! - The full garden layout is PRIVATE (never leaves the zkVM)
//! - Only the queried cell's content is revealed in the output
//! - The commitment ensures the gardener cannot change the garden mid-game

#![no_main]
#![no_std]

extern crate alloc;

use risc0_zkvm::guest::env;

use herbal_shared::{
    compute_garden_commitment, CellRevealInput, CellRevealOutput, GardenLayout, PlantType,
    GRID_SIZE,
};

risc0_zkvm::guest::entry!(main);

fn main() {
    // ========================================
    // STEP 1: Read private input
    // ========================================
    // The input contains the full garden layout (PRIVATE)
    // and the cell coordinates to reveal (PUBLIC)
    let input: CellRevealInput = env::read();

    // ========================================
    // STEP 2: Validate coordinates
    // ========================================
    // Ensure the requested cell is within bounds
    if input.x >= GRID_SIZE as u8 || input.y >= GRID_SIZE as u8 {
        panic!("coordinates out of bounds: ({}, {})", input.x, input.y);
    }

    // ========================================
    // STEP 3: Validate garden layout
    // ========================================
    // Check that the garden is valid:
    // - Max 7 plants
    // - Valid plant types only
    // - No plants in house row (row 4)
    if let Err(e) = input.garden.validate() {
        panic!("invalid garden layout: {:?}", e);
    }

    // ========================================
    // STEP 4: Compute and verify commitment
    // ========================================
    // The commitment is SHA256(cells || salt)
    // This ensures the gardener cannot cheat by changing the garden
    let computed_commitment = compute_garden_commitment(&input.garden);

    if computed_commitment != input.expected_commitment {
        panic!(
            "garden commitment mismatch - cheating detected! \
             computed: {:?}, expected: {:?}",
            &computed_commitment[..8],
            &input.expected_commitment[..8]
        );
    }

    // ========================================
    // STEP 5: Extract cell content
    // ========================================
    // Get the plant at the requested coordinates
    let plant = input.garden.get_cell(input.x, input.y);
    let has_plant = plant.is_plant();
    let damage = plant.damage();

    // ========================================
    // STEP 6: Build public output
    // ========================================
    // This output will be committed to the journal
    // and can be verified by the smart contract
    let output = CellRevealOutput {
        garden_commitment: computed_commitment,
        x: input.x,
        y: input.y,
        has_plant,
        plant_type: plant as u8,
        damage,
        session_id: input.session_id,
        gardener_pubkey: input.gardener_pubkey,
    };

    // ========================================
    // STEP 7: Commit to journal
    // ========================================
    // The journal is the PUBLIC output of the ZK proof
    // The smart contract will read this to get the revealed cell info
    env::commit_slice(&output.to_bytes());
}

// ============================================================================
// Circuit Verification Summary
// ============================================================================
//
// After execution, the verifier can be confident that:
//
// 1. CORRECTNESS: The circuit correctly computed the hash of the garden
//    and it matches the on-chain commitment
//
// 2. SOUNDNESS: It is computationally infeasible to produce a valid proof
//    for a garden that doesn't hash to the committed value
//
// 3. ZERO-KNOWLEDGE: The verifier learns ONLY the content of the single
//    revealed cell, not the other 24 cells
//
// 4. BINDING: The gardener is bound to the same garden throughout the game
//    (they cannot change it after committing)
//
// 5. SESSION BINDING: The proof is bound to a specific session_id and
//    gardener_pubkey, preventing replay attacks
