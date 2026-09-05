//! Typed errors for the crate's public entry points.

use thiserror::Error;

/// Everything `analyze` and the frame constructors can refuse.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum PrecreaseError {
    /// The flat segment array is not a multiple of four coordinates.
    #[error("segments must be [x1, y1, x2, y2, …]; got {len} coordinates")]
    MalformedSegments { len: usize },

    /// One colour code per segment is required.
    #[error("expected {segments} colour codes (one per segment), got {colors}")]
    ColorCountMismatch { segments: usize, colors: usize },

    /// A coordinate is NaN or infinite.
    #[error("coordinate {index} is not finite")]
    NonFiniteCoordinate { index: usize },

    /// The paper fallback is not a proper `[x0, y0, x1, y1]` rectangle.
    #[error("paper fallback must be a finite [x0, y0, x1, y1] with x0 < x1 and y0 < y1")]
    InvalidPaperFallback,

    /// No border creases and no paper fallback: there is no sheet to frame.
    #[error("crease pattern has no border creases and no paper fallback was supplied")]
    NoSheet,

    /// A frame with a zero-length axis or a non-positive side.
    #[error("degenerate frame: {reason}")]
    DegenerateFrame { reason: &'static str },

    /// A component without a frame (refused sheet) cannot be probed or snapped.
    #[error("component {id} has no sheet frame ({reason})")]
    NoFrame { id: u32, reason: &'static str },
}
