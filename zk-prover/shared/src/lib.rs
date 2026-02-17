//! # Herbal Moonlight Shared Types
//!
//! This crate defines the shared data structures used across:
//! - The ZK Guest (circuit running inside RiscZero zkVM)
//! - The ZK Host (proof generator)
//! - The Soroban smart contract (proof verification)
//!
//! All types must be serializable with serde for cross-boundary communication.

#![no_std]

extern crate alloc;

use alloc::vec::Vec;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// ============================================================================
// Constants
// ============================================================================

/// Grid size (5x5 board)
pub const GRID_SIZE: usize = 5;

/// Total number of cells in the grid
pub const GRID_CELLS: usize = GRID_SIZE * GRID_SIZE; // 25 cells

/// Maximum number of plants allowed
pub const MAX_PLANTS: usize = 7;

/// Length of the salt for commitment
pub const SALT_LEN: usize = 16;

/// Length of the journal output in bytes
/// Layout: [commitment:32][x:1][y:1][has_plant:1][plant_type:1][damage:1][session_id:4][gardener_pubkey:32]
pub const JOURNAL_LEN: usize = 32 + 1 + 1 + 1 + 1 + 1 + 4 + 32; // = 73 bytes

// ============================================================================
// Plant Types
// ============================================================================

/// Types of plants that can be placed in the garden
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum PlantType {
    /// Empty cell (no plant)
    Empty = 0,
    /// Lavender - Support plant (1 HP damage)
    Lavender = 1,
    /// Mint - DPS plant (2 HP damage)
    Mint = 2,
    /// Mandrake - Tank plant (1 HP damage, counts as 3 HP block)
    Mandrake = 3,
}

impl PlantType {
    /// Convert from u8 to PlantType
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(PlantType::Empty),
            1 => Some(PlantType::Lavender),
            2 => Some(PlantType::Mint),
            3 => Some(PlantType::Mandrake),
            _ => None,
        }
    }

    /// Get the damage this plant deals
    pub fn damage(&self) -> u8 {
        match self {
            PlantType::Empty => 0,
            PlantType::Lavender => 1,
            PlantType::Mint => 2,
            PlantType::Mandrake => 1,
        }
    }

    /// Check if this is a valid plant (not empty)
    pub fn is_plant(&self) -> bool {
        !matches!(self, PlantType::Empty)
    }
}

impl Default for PlantType {
    fn default() -> Self {
        PlantType::Empty
    }
}

// ============================================================================
// Garden Layout
// ============================================================================

/// Represents the complete garden layout (5x5 grid)
///
/// The garden is stored as a flat array in row-major order:
/// - Index = y * GRID_SIZE + x
/// - (0,0) is top-left, (4,4) is bottom-right
///
/// Row 4 (indices 20-24) is the Gardener's house - no plants allowed
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GardenLayout {
    /// Cells in row-major order: cells[y * 5 + x]
    /// Each cell is a u8 representing PlantType
    pub cells: [u8; GRID_CELLS],

    /// Random salt to prevent rainbow table attacks on commitment
    pub salt: [u8; SALT_LEN],
}

impl GardenLayout {
    /// Create a new garden layout
    pub fn new(cells: [u8; GRID_CELLS], salt: [u8; SALT_LEN]) -> Self {
        Self { cells, salt }
    }

    /// Get the plant at a specific cell
    pub fn get_cell(&self, x: u8, y: u8) -> PlantType {
        if x >= GRID_SIZE as u8 || y >= GRID_SIZE as u8 {
            return PlantType::Empty;
        }
        let index = (y as usize) * GRID_SIZE + (x as usize);
        PlantType::from_u8(self.cells[index]).unwrap_or(PlantType::Empty)
    }

    /// Count the total number of plants in the garden
    pub fn plant_count(&self) -> usize {
        self.cells.iter().filter(|&&c| c != 0).count()
    }

    /// Serialize for hashing (cells + salt)
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(GRID_CELLS + SALT_LEN);
        bytes.extend_from_slice(&self.cells);
        bytes.extend_from_slice(&self.salt);
        bytes
    }

    /// Validate the garden layout
    pub fn validate(&self) -> Result<(), ValidationError> {
        let mut plant_count = 0;

        for (i, &cell) in self.cells.iter().enumerate() {
            // Validate plant type is valid
            if PlantType::from_u8(cell).is_none() {
                return Err(ValidationError::InvalidPlantType);
            }

            if cell != 0 {
                plant_count += 1;

                // Row 4 (indices 20-24) is the Gardener's house - no plants allowed
                let row = i / GRID_SIZE;
                if row == 4 {
                    return Err(ValidationError::PlantInHouseRow);
                }
            }
        }

        // Maximum 7 plants allowed
        if plant_count > MAX_PLANTS {
            return Err(ValidationError::TooManyPlants);
        }

        Ok(())
    }
}

impl Default for GardenLayout {
    fn default() -> Self {
        Self {
            cells: [0u8; GRID_CELLS],
            salt: [0u8; SALT_LEN],
        }
    }
}

// ============================================================================
// Validation Errors
// ============================================================================

/// Errors that can occur during garden validation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValidationError {
    /// Too many plants (max 7)
    TooManyPlants,
    /// Invalid plant type value
    InvalidPlantType,
    /// Plant placed in house row (row 4)
    PlantInHouseRow,
    /// Coordinates out of bounds
    CoordinatesOutOfBounds,
}

// ============================================================================
// Commitment
// ============================================================================

/// Garden commitment type (SHA256 hash)
pub type GardenCommitment = [u8; 32];

/// Compute the commitment (hash) of a garden layout
pub fn compute_garden_commitment(garden: &GardenLayout) -> GardenCommitment {
    let mut hasher = Sha256::new();
    hasher.update(&garden.to_bytes());
    let result = hasher.finalize();
    let mut commitment = [0u8; 32];
    commitment.copy_from_slice(&result);
    commitment
}

// ============================================================================
// ZK Circuit Input/Output
// ============================================================================

/// Input for the ZK circuit (Cell Reveal)
///
/// This is the PRIVATE input that only the Gardener knows.
/// The circuit will prove the reveal without exposing the full garden.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CellRevealInput {
    /// Complete garden layout (PRIVATE - never leaves the prover)
    pub garden: GardenLayout,

    /// X coordinate of the cell to reveal (public)
    pub x: u8,

    /// Y coordinate of the cell to reveal (public)
    pub y: u8,

    /// Expected commitment stored on-chain (public)
    pub expected_commitment: [u8; 32],

    /// Session ID of the game (public)
    pub session_id: u32,

    /// Public key of the Gardener (public)
    pub gardener_pubkey: [u8; 32],
}

/// Output from the ZK circuit (Journal)
///
/// This is the PUBLIC output that the contract can verify.
/// It proves the cell content without revealing the entire garden.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CellRevealOutput {
    /// Hash of the verified garden
    pub garden_commitment: [u8; 32],

    /// X coordinate that was revealed
    pub x: u8,

    /// Y coordinate that was revealed
    pub y: u8,

    /// Whether there is a plant in this cell
    pub has_plant: bool,

    /// Type of plant (0 = empty, 1-3 = plant type)
    pub plant_type: u8,

    /// Damage this plant deals
    pub damage: u8,

    /// Session ID this proof is for
    pub session_id: u32,

    /// Gardener who generated this proof
    pub gardener_pubkey: [u8; 32],
}

impl CellRevealOutput {
    /// Serialize the output to bytes for the journal
    /// This format must match what the contract expects
    pub fn to_bytes(&self) -> [u8; JOURNAL_LEN] {
        let mut out = [0u8; JOURNAL_LEN];
        let mut offset = 0;

        // Garden commitment (32 bytes)
        out[offset..offset + 32].copy_from_slice(&self.garden_commitment);
        offset += 32;

        // Coordinates (1 byte each)
        out[offset] = self.x;
        offset += 1;
        out[offset] = self.y;
        offset += 1;

        // Has plant flag (1 byte)
        out[offset] = if self.has_plant { 1 } else { 0 };
        offset += 1;

        // Plant type (1 byte)
        out[offset] = self.plant_type;
        offset += 1;

        // Damage (1 byte)
        out[offset] = self.damage;
        offset += 1;

        // Session ID (4 bytes, little-endian)
        out[offset..offset + 4].copy_from_slice(&self.session_id.to_le_bytes());
        offset += 4;

        // Gardener public key (32 bytes)
        out[offset..offset + 32].copy_from_slice(&self.gardener_pubkey);

        out
    }

    /// Deserialize from bytes
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() != JOURNAL_LEN {
            return None;
        }

        let mut offset = 0;

        // Garden commitment
        let mut garden_commitment = [0u8; 32];
        garden_commitment.copy_from_slice(&bytes[offset..offset + 32]);
        offset += 32;

        // Coordinates
        let x = bytes[offset];
        offset += 1;
        let y = bytes[offset];
        offset += 1;

        // Has plant
        let has_plant = bytes[offset] != 0;
        offset += 1;

        // Plant type
        let plant_type = bytes[offset];
        offset += 1;

        // Damage
        let damage = bytes[offset];
        offset += 1;

        // Session ID
        let session_id = u32::from_le_bytes(bytes[offset..offset + 4].try_into().ok()?);
        offset += 4;

        // Gardener public key
        let mut gardener_pubkey = [0u8; 32];
        gardener_pubkey.copy_from_slice(&bytes[offset..offset + 32]);

        Some(Self {
            garden_commitment,
            x,
            y,
            has_plant,
            plant_type,
            damage,
            session_id,
            gardener_pubkey,
        })
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plant_type_conversion() {
        assert_eq!(PlantType::from_u8(0), Some(PlantType::Empty));
        assert_eq!(PlantType::from_u8(1), Some(PlantType::Lavender));
        assert_eq!(PlantType::from_u8(2), Some(PlantType::Mint));
        assert_eq!(PlantType::from_u8(3), Some(PlantType::Mandrake));
        assert_eq!(PlantType::from_u8(4), None);
    }

    #[test]
    fn test_plant_damage() {
        assert_eq!(PlantType::Empty.damage(), 0);
        assert_eq!(PlantType::Lavender.damage(), 1);
        assert_eq!(PlantType::Mint.damage(), 2);
        assert_eq!(PlantType::Mandrake.damage(), 1);
    }

    #[test]
    fn test_garden_get_cell() {
        let mut cells = [0u8; GRID_CELLS];
        cells[0] = 1; // (0,0) = Lavender
        cells[6] = 2; // (1,1) = Mint
        cells[12] = 3; // (2,2) = Mandrake

        let garden = GardenLayout::new(cells, [0u8; SALT_LEN]);

        assert_eq!(garden.get_cell(0, 0), PlantType::Lavender);
        assert_eq!(garden.get_cell(1, 1), PlantType::Mint);
        assert_eq!(garden.get_cell(2, 2), PlantType::Mandrake);
        assert_eq!(garden.get_cell(0, 1), PlantType::Empty);
    }

    #[test]
    fn test_garden_validation_valid() {
        let mut cells = [0u8; GRID_CELLS];
        // Place 7 plants in rows 0-3
        cells[0] = 1;
        cells[1] = 2;
        cells[5] = 1;
        cells[6] = 2;
        cells[10] = 3;
        cells[11] = 1;
        cells[15] = 2;

        let garden = GardenLayout::new(cells, [0u8; SALT_LEN]);
        assert!(garden.validate().is_ok());
    }

    #[test]
    fn test_garden_validation_too_many_plants() {
        let mut cells = [0u8; GRID_CELLS];
        // Place 8 plants (max is 7)
        for i in 0..8 {
            cells[i] = 1;
        }

        let garden = GardenLayout::new(cells, [0u8; SALT_LEN]);
        assert_eq!(garden.validate(), Err(ValidationError::TooManyPlants));
    }

    #[test]
    fn test_garden_validation_plant_in_house() {
        let mut cells = [0u8; GRID_CELLS];
        cells[20] = 1; // Row 4 (house row)

        let garden = GardenLayout::new(cells, [0u8; SALT_LEN]);
        assert_eq!(garden.validate(), Err(ValidationError::PlantInHouseRow));
    }

    #[test]
    fn test_commitment_deterministic() {
        let cells = [1u8; GRID_CELLS];
        let salt = [42u8; SALT_LEN];
        let garden = GardenLayout::new(cells, salt);

        let commitment1 = compute_garden_commitment(&garden);
        let commitment2 = compute_garden_commitment(&garden);

        assert_eq!(commitment1, commitment2);
    }

    #[test]
    fn test_commitment_different_for_different_gardens() {
        let cells1 = [1u8; GRID_CELLS];
        let cells2 = [2u8; GRID_CELLS];
        let salt = [42u8; SALT_LEN];

        let garden1 = GardenLayout::new(cells1, salt);
        let garden2 = GardenLayout::new(cells2, salt);

        let commitment1 = compute_garden_commitment(&garden1);
        let commitment2 = compute_garden_commitment(&garden2);

        assert_ne!(commitment1, commitment2);
    }

    #[test]
    fn test_cell_reveal_output_serialization() {
        let output = CellRevealOutput {
            garden_commitment: [1u8; 32],
            x: 2,
            y: 3,
            has_plant: true,
            plant_type: 2,
            damage: 2,
            session_id: 42,
            gardener_pubkey: [7u8; 32],
        };

        let bytes = output.to_bytes();
        let parsed = CellRevealOutput::from_bytes(&bytes).unwrap();

        assert_eq!(output, parsed);
    }

    #[test]
    fn test_journal_length() {
        let output = CellRevealOutput {
            garden_commitment: [0u8; 32],
            x: 0,
            y: 0,
            has_plant: false,
            plant_type: 0,
            damage: 0,
            session_id: 0,
            gardener_pubkey: [0u8; 32],
        };

        let bytes = output.to_bytes();
        assert_eq!(bytes.len(), JOURNAL_LEN);
        assert_eq!(bytes.len(), 73);
    }
}
