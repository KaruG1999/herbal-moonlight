//! # Herbal Moonlight Prover CLI
//!
//! Command-line tool for generating ZK proofs locally.
//!
//! ## Usage
//!
//! ```bash
//! herbal-prover \
//!     --session-id 42 \
//!     --cell-x 2 --cell-y 1 \
//!     --garden-file ~/.herbal/garden.json \
//!     --pubkey abc123...
//! ```

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::fs;

use herbal_host::{generate_cell_reveal_proof, get_image_id};
use herbal_shared::{compute_garden_commitment, GardenLayout, GRID_CELLS, SALT_LEN};

#[derive(Parser)]
#[command(name = "herbal-prover")]
#[command(about = "Generate ZK proofs for Herbal Moonlight game")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate a cell reveal proof
    Prove {
        /// Session ID of the game
        #[arg(short, long)]
        session_id: u32,

        /// X coordinate of the cell to reveal (0-4)
        #[arg(short = 'x', long)]
        cell_x: u8,

        /// Y coordinate of the cell to reveal (0-4)
        #[arg(short = 'y', long)]
        cell_y: u8,

        /// Path to the garden layout JSON file
        #[arg(short, long)]
        garden_file: String,

        /// Gardener's public key (hex, 64 chars)
        #[arg(short, long)]
        pubkey: String,

        /// Output format: hex (default) or json
        #[arg(short, long, default_value = "hex")]
        output: String,
    },

    /// Compute the commitment hash for a garden layout
    Commit {
        /// Path to the garden layout JSON file
        #[arg(short, long)]
        garden_file: String,
    },

    /// Create a new garden layout interactively
    Create {
        /// Output file path
        #[arg(short, long, default_value = "garden.json")]
        output: String,
    },

    /// Get the image ID of the ZK circuit
    ImageId,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Prove {
            session_id,
            cell_x,
            cell_y,
            garden_file,
            pubkey,
            output,
        } => {
            prove_command(session_id, cell_x, cell_y, &garden_file, &pubkey, &output)
        }
        Commands::Commit { garden_file } => commit_command(&garden_file),
        Commands::Create { output } => create_command(&output),
        Commands::ImageId => image_id_command(),
    }
}

fn prove_command(
    session_id: u32,
    cell_x: u8,
    cell_y: u8,
    garden_file: &str,
    pubkey: &str,
    output_format: &str,
) -> Result<()> {
    // Validate coordinates
    if cell_x >= 5 || cell_y >= 5 {
        anyhow::bail!("Coordinates must be 0-4. Got ({}, {})", cell_x, cell_y);
    }

    // Load garden from file
    let garden_json = fs::read_to_string(garden_file)?;
    let garden: GardenLayout = serde_json::from_str(&garden_json)?;

    // Parse pubkey
    let pubkey_bytes = hex::decode(pubkey)?;
    if pubkey_bytes.len() != 32 {
        anyhow::bail!("Pubkey must be 32 bytes (64 hex chars)");
    }
    let mut gardener_pubkey = [0u8; 32];
    gardener_pubkey.copy_from_slice(&pubkey_bytes);

    println!("=== Herbal Moonlight Prover ===");
    #[cfg(feature = "dev")]
    println!("MODE: Development (mock proofs)");
    #[cfg(not(feature = "dev"))]
    println!("MODE: Production (Groth16 proofs)");
    println!("Session ID: {}", session_id);
    println!("Cell: ({}, {})", cell_x, cell_y);
    println!("Garden file: {}", garden_file);
    println!();

    // Generate proof
    let result = generate_cell_reveal_proof(&garden, cell_x, cell_y, session_id, gardener_pubkey)?;

    println!("=== PROOF GENERATED ===");
    if result.is_dev_mode {
        println!("WARNING: This is a DEV MODE proof with empty seal!");
        println!("         Contract must be in dev mode to accept this.");
    }
    println!();

    if output_format == "json" {
        // JSON output for programmatic use
        let json = serde_json::json!({
            "dev_mode": result.is_dev_mode,
            "journal_bytes": hex::encode(&result.journal_bytes),
            "journal_hash": hex::encode(&result.journal_hash),
            "seal": hex::encode(&result.seal),
            "image_id": hex::encode(&result.image_id),
            "output": {
                "x": result.output.x,
                "y": result.output.y,
                "has_plant": result.output.has_plant,
                "plant_type": result.output.plant_type,
                "damage": result.output.damage,
                "session_id": result.output.session_id,
            }
        });
        println!("{}", serde_json::to_string_pretty(&json)?);
    } else {
        // Hex output for manual use
        println!("journal_bytes: {}", hex::encode(&result.journal_bytes));
        println!("journal_hash: {}", hex::encode(&result.journal_hash));
        if result.seal.is_empty() {
            println!("seal: (empty - dev mode)");
        } else {
            println!("seal: {}", hex::encode(&result.seal));
        }
        println!("image_id: {}", hex::encode(&result.image_id));
        println!();
        println!("Result:");
        println!("  Cell ({}, {})", result.output.x, result.output.y);
        println!(
            "  Has Plant: {} (type: {})",
            result.output.has_plant, result.output.plant_type
        );
        println!("  Damage: {}", result.output.damage);
    }

    Ok(())
}

fn commit_command(garden_file: &str) -> Result<()> {
    // Load garden from file
    let garden_json = fs::read_to_string(garden_file)?;
    let garden: GardenLayout = serde_json::from_str(&garden_json)?;

    // Validate garden
    garden.validate().map_err(|e| anyhow::anyhow!("{:?}", e))?;

    // Compute commitment
    let commitment = compute_garden_commitment(&garden);

    println!("=== Garden Commitment ===");
    println!("File: {}", garden_file);
    println!("Plants: {}", garden.plant_count());
    println!();
    println!("Commitment (hex): {}", hex::encode(&commitment));
    println!();
    println!("Use this value for commit_garden() on-chain.");

    Ok(())
}

fn create_command(output_file: &str) -> Result<()> {
    use std::io::{self, Write};

    println!("=== Create Garden Layout ===");
    println!();
    println!("Enter plant positions (max 7 plants).");
    println!("Format: x,y,type (where type is 1=Lavender, 2=Mint, 3=Mandrake)");
    println!("Example: 0,0,1  (places Lavender at top-left)");
    println!("Enter 'done' when finished.");
    println!();
    println!("Grid (0-4 for both x and y, row 4 is the house - no plants):");
    println!("  0 1 2 3 4");
    println!("0 . . . . .");
    println!("1 . . . . .");
    println!("2 . . . . .");
    println!("3 . . . . .");
    println!("4 [HOUSE - no plants]");
    println!();

    let mut cells = [0u8; GRID_CELLS];
    let mut plant_count = 0;

    loop {
        print!("> ");
        io::stdout().flush()?;

        let mut input = String::new();
        io::stdin().read_line(&mut input)?;
        let input = input.trim();

        if input == "done" || input.is_empty() {
            break;
        }

        let parts: Vec<&str> = input.split(',').collect();
        if parts.len() != 3 {
            println!("Invalid format. Use: x,y,type");
            continue;
        }

        let x: usize = match parts[0].parse() {
            Ok(v) if v < 5 => v,
            _ => {
                println!("Invalid x (must be 0-4)");
                continue;
            }
        };

        let y: usize = match parts[1].parse() {
            Ok(v) if v < 5 => v,
            _ => {
                println!("Invalid y (must be 0-4)");
                continue;
            }
        };

        if y == 4 {
            println!("Cannot place plants in row 4 (house)");
            continue;
        }

        let plant_type: u8 = match parts[2].parse() {
            Ok(v) if v >= 1 && v <= 3 => v,
            _ => {
                println!("Invalid type (must be 1=Lavender, 2=Mint, 3=Mandrake)");
                continue;
            }
        };

        let index = y * 5 + x;
        if cells[index] != 0 {
            println!("Cell ({}, {}) already has a plant", x, y);
            continue;
        }

        if plant_count >= 7 {
            println!("Maximum 7 plants allowed");
            continue;
        }

        cells[index] = plant_type;
        plant_count += 1;

        let plant_name = match plant_type {
            1 => "Lavender",
            2 => "Mint",
            3 => "Mandrake",
            _ => "Unknown",
        };
        println!("Placed {} at ({}, {}). Total: {}/7", plant_name, x, y, plant_count);
    }

    // Generate random salt
    let mut salt = [0u8; SALT_LEN];
    // In production, use a proper random source
    // For now, use a simple counter-based approach
    for (i, byte) in salt.iter_mut().enumerate() {
        *byte = (i as u8).wrapping_mul(17).wrapping_add(42);
    }

    println!();
    println!("Enter a random salt (16 bytes hex, 32 chars) or press Enter for default:");
    print!("> ");
    io::stdout().flush()?;

    let mut salt_input = String::new();
    io::stdin().read_line(&mut salt_input)?;
    let salt_input = salt_input.trim();

    if !salt_input.is_empty() {
        let salt_bytes = hex::decode(salt_input)?;
        if salt_bytes.len() != 16 {
            anyhow::bail!("Salt must be 16 bytes (32 hex chars)");
        }
        salt.copy_from_slice(&salt_bytes);
    }

    let garden = GardenLayout::new(cells, salt);

    // Validate
    garden.validate().map_err(|e| anyhow::anyhow!("{:?}", e))?;

    // Save to file
    let json = serde_json::to_string_pretty(&garden)?;
    fs::write(output_file, &json)?;

    // Compute commitment
    let commitment = compute_garden_commitment(&garden);

    println!();
    println!("=== Garden Created ===");
    println!("Saved to: {}", output_file);
    println!("Plants: {}", plant_count);
    println!("Commitment: {}", hex::encode(&commitment));
    println!();
    println!("IMPORTANT: Keep this file SECRET. Only share the commitment.");

    Ok(())
}

fn image_id_command() -> Result<()> {
    let id = get_image_id();
    println!("=== ZK Circuit Image ID ===");
    println!("{}", hex::encode(&id));
    println!();
    println!("Use this value when deploying the contract.");
    Ok(())
}
