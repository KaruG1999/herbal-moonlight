//! # Herbal Moonlight Proof Generator (Host)
//!
//! This crate provides the API to generate ZK proofs for cell reveals.
//! It runs on the Gardener's machine and produces proofs
//! that can be verified on-chain.
//!
//! ## Modes
//!
//! - **Production Mode** (default): Generates real Groth16 proofs using RiscZero.
//!   Requires Docker and the RiscZero toolchain.
//!
//! - **Dev Mode** (`--features dev`): Generates mock proofs without ZK execution.
//!   Fast and works without Docker, but NOT cryptographically secure.
//!
//! ## Usage
//!
//! ```ignore
//! use herbal_host::generate_cell_reveal_proof;
//! use herbal_shared::GardenLayout;
//!
//! let garden = GardenLayout::new(cells, salt);
//! let result = generate_cell_reveal_proof(&garden, 2, 1, 42, pubkey)?;
//!
//! // Send result.seal, result.journal_bytes, result.journal_hash to the contract
//! ```

use anyhow::{anyhow, Result};
use sha2::{Digest, Sha256};

use herbal_shared::{
    compute_garden_commitment, CellRevealOutput, GardenLayout, PlantType, JOURNAL_LEN,
};

#[cfg(not(feature = "dev"))]
use herbal_shared::CellRevealInput;

// ============================================================================
// Proof Result
// ============================================================================

/// Result of generating a ZK proof
#[derive(Debug, Clone)]
pub struct ProofResult {
    /// Public output decoded from the journal
    pub output: CellRevealOutput,

    /// Raw journal bytes (for sending to contract)
    pub journal_bytes: Vec<u8>,

    /// SHA256 hash of the journal (for verification)
    pub journal_hash: [u8; 32],

    /// Groth16 proof seal (for on-chain verification)
    /// Empty in dev mode, contains real proof in production
    pub seal: Vec<u8>,

    /// Image ID of the circuit (must match contract's stored image_id)
    pub image_id: [u8; 32],

    /// Whether this is a dev mode proof (no cryptographic security)
    pub is_dev_mode: bool,
}

// ============================================================================
// Production Mode - Real ZK Proofs
// ============================================================================

#[cfg(not(feature = "dev"))]
pub fn generate_cell_reveal_proof(
    garden: &GardenLayout,
    x: u8,
    y: u8,
    session_id: u32,
    gardener_pubkey: [u8; 32],
) -> Result<ProofResult> {
    use risc0_zkvm::{default_prover, ExecutorEnv, InnerReceipt, ProverOpts};
    use herbal_methods::CELL_REVEAL_ELF;

    // Compute the expected commitment
    let expected_commitment = compute_garden_commitment(garden);

    // Build the input for the circuit
    let input = CellRevealInput {
        garden: garden.clone(),
        x,
        y,
        expected_commitment,
        session_id,
        gardener_pubkey,
    };

    // Configure the executor environment
    let env = ExecutorEnv::builder().write(&input)?.build()?;

    // Get prover and options
    let prover = default_prover();

    // Use Groth16 for on-chain verification
    // This requires Docker to be running
    let opts = ProverOpts::groth16();

    println!("Generating ZK proof... (this may take 1-2 minutes)");

    // Execute the guest and generate the proof
    let prove_info = prover.prove_with_opts(env, CELL_REVEAL_ELF, &opts)?;

    let receipt = prove_info.receipt;

    // Verify we got a Groth16 proof
    if !matches!(&receipt.inner, InnerReceipt::Groth16(_)) {
        return Err(anyhow!(
            "Expected Groth16 receipt. Ensure Docker is running for Groth16 proving."
        ));
    }

    // Extract journal bytes
    let journal_bytes = receipt.journal.bytes.clone();

    if journal_bytes.len() != JOURNAL_LEN {
        return Err(anyhow!(
            "Journal length mismatch: expected {}, got {}",
            JOURNAL_LEN,
            journal_bytes.len()
        ));
    }

    // Decode the output
    let output = CellRevealOutput::from_bytes(&journal_bytes)
        .ok_or_else(|| anyhow!("Failed to decode journal output"))?;

    // Extract the seal
    let seal = match &receipt.inner {
        InnerReceipt::Groth16(inner) => inner.seal.clone(),
        _ => return Err(anyhow!("Not a Groth16 receipt")),
    };

    // Compute journal hash
    let journal_hash = sha256(&journal_bytes);

    // Get image ID
    let image_id = get_image_id();

    Ok(ProofResult {
        output,
        journal_bytes,
        journal_hash,
        seal,
        image_id,
        is_dev_mode: false,
    })
}

// ============================================================================
// Dev Mode - Mock Proofs (No Docker Required)
// ============================================================================

#[cfg(feature = "dev")]
pub fn generate_cell_reveal_proof(
    garden: &GardenLayout,
    x: u8,
    y: u8,
    session_id: u32,
    gardener_pubkey: [u8; 32],
) -> Result<ProofResult> {
    generate_cell_reveal_proof_dev(garden, x, y, session_id, gardener_pubkey)
}

/// Generate a mock proof for development
///
/// This function simulates what the ZK circuit would do, but without
/// actually running the RISC-V guest. It produces valid journal output
/// that can be verified by the contract in dev mode.
///
/// **WARNING**: NOT cryptographically secure! Only use for development.
pub fn generate_cell_reveal_proof_dev(
    garden: &GardenLayout,
    x: u8,
    y: u8,
    session_id: u32,
    gardener_pubkey: [u8; 32],
) -> Result<ProofResult> {
    println!("=== DEV MODE ===");
    println!("Generating mock proof (no ZK execution)");
    println!();

    // Validate inputs (same as guest would do)
    if x >= 5 || y >= 5 {
        return Err(anyhow!("Invalid coordinates: ({}, {})", x, y));
    }

    // Validate garden
    garden.validate().map_err(|e| anyhow!("{:?}", e))?;

    // Compute commitment
    let commitment = compute_garden_commitment(garden);

    // Extract cell content (same logic as guest)
    let cell_index = (y as usize) * 5 + (x as usize);
    let cell_value = garden.cells[cell_index];
    let plant_type = PlantType::from_u8(cell_value).unwrap_or(PlantType::Empty);

    let (has_plant, plant_type_u8, damage) = match plant_type {
        PlantType::Empty => (false, 0u8, 0u8),
        PlantType::Lavender => (true, 1u8, 1u8),
        PlantType::Mint => (true, 2u8, 2u8),
        PlantType::Mandrake => (true, 3u8, 3u8),
    };

    // Build the output
    let output = CellRevealOutput {
        garden_commitment: commitment,
        x,
        y,
        has_plant,
        plant_type: plant_type_u8,
        damage,
        session_id,
        gardener_pubkey,
    };

    // Serialize to journal bytes
    let journal_bytes_arr = output.to_bytes();
    let journal_bytes: Vec<u8> = journal_bytes_arr.to_vec();

    if journal_bytes.len() != JOURNAL_LEN {
        return Err(anyhow!(
            "Journal length mismatch: expected {}, got {}",
            JOURNAL_LEN,
            journal_bytes.len()
        ));
    }

    // Compute journal hash
    let journal_hash = sha256(&journal_bytes);

    // Get image ID (mock in dev mode)
    let image_id = get_image_id();

    // Empty seal indicates dev mode
    let seal = Vec::new();

    Ok(ProofResult {
        output,
        journal_bytes,
        journal_hash,
        seal,
        image_id,
        is_dev_mode: true,
    })
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Get the image ID of the cell reveal circuit
pub fn get_image_id() -> [u8; 32] {
    use herbal_methods::CELL_REVEAL_ID;

    #[cfg(not(feature = "dev"))]
    {
        let digest: risc0_zkvm::sha::Digest = CELL_REVEAL_ID.into();
        let mut id = [0u8; 32];
        id.copy_from_slice(digest.as_bytes());
        id
    }

    #[cfg(feature = "dev")]
    {
        // In dev mode, CELL_REVEAL_ID is already [u32; 8]
        // Convert to [u8; 32]
        let mut id = [0u8; 32];
        for (i, word) in CELL_REVEAL_ID.iter().enumerate() {
            let bytes = word.to_le_bytes();
            id[i * 4..(i + 1) * 4].copy_from_slice(&bytes);
        }
        id
    }
}

/// Compute SHA256 hash
fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use herbal_shared::{GRID_CELLS, SALT_LEN};

    fn create_test_garden() -> GardenLayout {
        let mut cells = [0u8; GRID_CELLS];
        // Place some plants
        cells[0] = PlantType::Lavender as u8; // (0,0)
        cells[2] = PlantType::Mint as u8; // (2,0)
        cells[6] = PlantType::Mandrake as u8; // (1,1)
        cells[12] = PlantType::Mint as u8; // (2,2)

        GardenLayout::new(cells, [1u8; SALT_LEN])
    }

    #[test]
    fn test_image_id_is_valid() {
        let id = get_image_id();
        // Image ID should not be all zeros
        assert_ne!(id, [0u8; 32]);
    }

    #[test]
    fn test_dev_proof_generation() {
        let garden = create_test_garden();
        let pubkey = [42u8; 32];

        // Test revealing empty cell
        let result = generate_cell_reveal_proof_dev(&garden, 1, 0, 123, pubkey).unwrap();
        assert!(!result.output.has_plant);
        assert_eq!(result.output.x, 1);
        assert_eq!(result.output.y, 0);
        assert_eq!(result.output.session_id, 123);
        assert!(result.seal.is_empty()); // Dev mode has empty seal

        // Test revealing cell with plant
        let result = generate_cell_reveal_proof_dev(&garden, 0, 0, 456, pubkey).unwrap();
        assert!(result.output.has_plant);
        assert_eq!(result.output.plant_type, 1); // Lavender
        assert_eq!(result.output.damage, 1);
    }

    #[test]
    fn test_journal_hash() {
        let garden = create_test_garden();
        let pubkey = [42u8; 32];

        let result = generate_cell_reveal_proof_dev(&garden, 0, 0, 789, pubkey).unwrap();

        // Verify journal hash matches
        let computed_hash = sha256(&result.journal_bytes);
        assert_eq!(result.journal_hash, computed_hash);
    }
}
