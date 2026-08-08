//! Oriedita-compatible import/export helpers.

pub mod cp;
pub mod dxf;
pub mod fold;
pub mod obj;
pub mod orh;
pub mod ori;

use crate::geometry::LineColorParseError;
use crate::model::ModelError;

pub type Result<T> = std::result::Result<T, IoError>;

#[derive(Debug, thiserror::Error)]
pub enum IoError {
    #[error("unsupported Oriedita format {0}")]
    UnsupportedFormat(&'static str),
    #[error("invalid {format} input at line {line}: {message}")]
    InvalidLine {
        format: &'static str,
        line: usize,
        message: String,
    },
    #[error("invalid Oriedita field {field}: {message}")]
    InvalidField {
        field: &'static str,
        message: String,
    },
    /// The file describes something this importer has no representation for.
    ///
    /// Distinct from [`Self::InvalidField`] on purpose: the file is well formed
    /// and says what it means, and we decline rather than build a nearby result
    /// out of the part of it we can read. See AGENTS.md → porting discipline.
    #[error("unsupported: {what} ({detail})")]
    Unsupported { what: &'static str, detail: String },
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("line color error: {0}")]
    LineColor(#[from] LineColorParseError),
    #[error("model error: {0}")]
    Model(#[from] ModelError),
}
