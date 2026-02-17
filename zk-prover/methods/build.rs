fn main() {
    #[cfg(not(feature = "dev"))]
    {
        // Production mode: compile the guest for RISC-V
        // This requires the RiscZero toolchain (rzup install) and Docker for Groth16
        risc0_build::embed_methods();
    }

    #[cfg(feature = "dev")]
    {
        // Dev mode: generate mock constants
        // This allows building without the RiscZero toolchain
        use std::env;
        use std::fs;
        use std::path::Path;

        let out_dir = env::var("OUT_DIR").unwrap();
        let dest_path = Path::new(&out_dir).join("methods.rs");

        // Generate mock ELF (empty) and mock ID (deterministic hash)
        let mock_methods = r#"
/// Mock ELF for development (empty binary)
pub const CELL_REVEAL_ELF: &[u8] = &[];

/// Mock Image ID for development (deterministic placeholder)
/// In production, this is the actual hash of the compiled circuit
pub const CELL_REVEAL_ID: [u32; 8] = [
    0xDEADBEEF, 0xCAFEBABE, 0x12345678, 0x9ABCDEF0,
    0xFEEDFACE, 0x0BADF00D, 0xDEADC0DE, 0xBADCAFE0
];
"#;

        fs::write(dest_path, mock_methods).expect("Failed to write mock methods.rs");
        println!("cargo:warning=Building in DEV mode - using mock ELF and ID");
    }
}
