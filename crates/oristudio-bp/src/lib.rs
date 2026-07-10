//! Headless Box Pleating Studio compatibility layer for Ori Studio.

pub mod data;
pub mod engine;
pub mod error;
pub mod grid;
pub mod io;
pub mod layout;
pub mod math;
pub mod model;
pub mod optimizer;
pub mod shared;
pub mod status;
pub mod sweep;
pub mod tree;

pub use error::{BpError, BpResult};
pub use model::*;
pub use status::{PortArea, PortDescriptor, PortStatus, port_descriptors};
