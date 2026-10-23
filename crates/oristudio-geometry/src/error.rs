//! Typed errors for the crate's fallible constructors.

use thiserror::Error;

/// Everything the [`crate::frame::Frame`] constructors can refuse.
///
/// `oristudio-precrease` maps each variant onto the error it returned before
/// frames moved here (`DegenerateFrame`, and `InvalidPaperFallback` for the
/// only rectangle it frames, the paper fallback), so its messages and wire
/// codes are unchanged.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum GeometryError {
    /// A frame with a zero-length axis or a non-positive side.
    #[error("degenerate frame: {reason}")]
    DegenerateFrame { reason: &'static str },

    /// A model-space rectangle that is not a proper `[x0, y0, x1, y1]`.
    #[error("rectangle must be a finite [x0, y0, x1, y1] with x0 < x1 and y0 < y1")]
    InvalidRect,
}
