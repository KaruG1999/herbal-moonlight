# Herbal Moonlight ZK Prover

Zero-Knowledge proof system for the Herbal Moonlight game using RiscZero.

## Structure

```
zk-prover/
├── Cargo.toml          # Workspace configuration
├── README.md           # This file
├── shared/             # Shared types (used by guest, host, and contract)
│   ├── Cargo.toml
│   └── src/lib.rs      # PlantType, GardenLayout, CellRevealInput/Output
├── methods/            # ZK circuit (guest code)
│   ├── Cargo.toml
│   ├── build.rs        # Compiles the guest
│   ├── src/lib.rs      # Exports ELF and ID
│   └── guest/
│       ├── Cargo.toml
│       └── src/main.rs # The ZK circuit logic
└── host/               # Proof generator
    ├── Cargo.toml
    └── src/
        ├── lib.rs      # Proof generation API
        └── main.rs     # CLI tool
```

## Prerequisites

- Rust 1.75+
- Docker (required for Groth16 proofs)
- RiscZero toolchain: `cargo install risc0-cli`

## Building

```bash
cd zk-prover

# Build all crates
cargo build --release

# Get the Image ID (needed for contract deployment)
cargo run --bin herbal-prover -- image-id
```

## Usage

### 1. Create a Garden Layout

```bash
cargo run --bin herbal-prover -- create --output my-garden.json
```

This interactive command helps you place plants on the 5x5 grid.

### 2. Get the Commitment

```bash
cargo run --bin herbal-prover -- commit --garden-file my-garden.json
```

Use the returned commitment hash when calling `commit_garden()` on the contract.

### 3. Generate a Cell Reveal Proof

```bash
cargo run --bin herbal-prover -- prove \
    --session-id 42 \
    --cell-x 2 \
    --cell-y 1 \
    --garden-file my-garden.json \
    --pubkey YOUR_PUBKEY_HEX_64_CHARS
```

This outputs:
- `journal_bytes`: Send to `reveal_cell()` as the journal
- `journal_hash`: Send to `reveal_cell()` for verification
- `seal`: The Groth16 proof for on-chain verification

## How It Works

### The ZK Circuit

The circuit (`methods/guest/src/main.rs`) proves:

1. **Commitment Binding**: The garden layout hashes to the committed value
2. **Layout Validity**: Max 7 plants, valid types, no plants in house row
3. **Cell Content**: The specific cell contains a particular plant
4. **Session Binding**: The proof is tied to a specific session_id

### Privacy Guarantees

- The full garden layout is **NEVER** revealed
- Only the queried cell's content is exposed
- The verifier learns nothing about the other 24 cells

### Proof Format

The journal output is 73 bytes:

| Offset | Length | Field |
|--------|--------|-------|
| 0 | 32 | garden_commitment |
| 32 | 1 | x |
| 33 | 1 | y |
| 34 | 1 | has_plant |
| 35 | 1 | plant_type |
| 36 | 1 | damage |
| 37 | 4 | session_id |
| 41 | 32 | gardener_pubkey |

## Integration with Contract

The contract expects:

```rust
pub fn reveal_cell(
    env: Env,
    session_id: u32,
    journal_bytes: Bytes,    // 73 bytes from prover
    journal_hash: BytesN<32>, // SHA256(journal_bytes)
    seal: Bytes,             // Groth16 proof
) -> Result<CellRevealResult, Error>
```

## Development

### Running Tests

```bash
# Test shared types
cd shared && cargo test

# Note: Full proof tests require Docker for RiscZero
```

### Generating Fake Proofs (Development Only)

For faster iteration during development, you can use the `dev` feature
which uses fake proofs (NOT cryptographically secure):

```bash
cargo build --features dev
```

## Security Notes

1. **Keep your garden file SECRET** - Only share the commitment hash
2. **Use random salt** - Prevents rainbow table attacks
3. **Groth16 proofs require Docker** - The RiscZero prover uses Docker containers
4. **Verify Image ID** - The contract must store the correct circuit image_id
