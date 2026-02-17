//! # Herbal Moonlight ZK Methods
//!
//! This crate contains the RiscZero guest methods (ZK circuits).
//! The actual circuit code is in `guest/src/main.rs`.
//!
//! After building, this crate exports:
//! - `CELL_REVEAL_ELF`: The compiled guest binary
//! - `CELL_REVEAL_ID`: The image ID of the circuit

include!(concat!(env!("OUT_DIR"), "/methods.rs"));
