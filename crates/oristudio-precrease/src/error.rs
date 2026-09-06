//! Typed errors for the crate's public entry points.

use thiserror::Error;

/// Everything `analyze`, the frame constructors and the planner can refuse.
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

    /// The planner state grew past its point cap (plan: working value 4 M).
    #[error("planner state exceeded {cap} points")]
    PointCap { cap: usize },

    /// A line handed to the planner is not a line: NaN, infinite, or a zero
    /// normal.
    #[error("line {index} is malformed: {reason}")]
    MalformedLine { index: usize, reason: &'static str },

    /// A flat line array is not a multiple of three (`[nx, ny, d]` triples).
    #[error("lines must be [nx, ny, d, …] triples; got {len} values")]
    MalformedLines { len: usize },

    /// A fold tag outside `{0: cp, 1: aux, 2: rf_aux}`.
    #[error("fold tag {tag} at index {index} is not one of cp (0), aux (1), rf_aux (2)")]
    InvalidTag { index: usize, tag: u8 },

    /// The tag array does not match the line array.
    #[error("expected {lines} fold tags (one per line), got {tags}")]
    TagCountMismatch { lines: usize, tags: usize },

    /// The component asked for does not exist in the analysis.
    #[error("component {id} does not exist ({count} components)")]
    NoSuchComponent { id: u32, count: usize },

    /// The planner options JSON did not parse.
    #[error("planner options: {reason}")]
    InvalidOptions { reason: String },

    /// Something asked of a planner whose component was refused.
    #[error("the component's sheet was refused; no plan exists")]
    RefusedSheet,
}
