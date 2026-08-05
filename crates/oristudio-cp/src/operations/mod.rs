//! Oriedita-compatible non-UI crease-pattern mutations.
//!
//! Every module here is a port and is parity-bound, with one exception:
//! [`native`] holds Ori Studio originals, which have no upstream to be in parity
//! with. See its module header.

pub mod arrangement;
pub mod circle;
pub mod color;
pub mod construction;
pub mod generators;
pub mod measure;
pub mod native;
pub mod point;
pub mod selection;
pub mod text;
pub mod transform;
