use thiserror::Error;

#[derive(Debug, Error)]
pub enum BpError {
    #[error("unsupported Box Pleating Studio operation at {upstream}: {reason}")]
    UnsupportedOperation {
        upstream: &'static str,
        reason: &'static str,
    },

    #[error("Box Pleating Studio upstream gap at {upstream}: {todo}")]
    UpstreamGap {
        upstream: &'static str,
        todo: &'static str,
    },

    #[error("invalid Box Pleating Studio input: {0}")]
    InvalidInput(String),

    #[error("incompatible Box Pleating Studio project: {0}")]
    IncompatibleProject(String),

    #[error("Box Pleating Studio optimization failed: {0}")]
    OptimizationFailed(String),

    #[error("Box Pleating Studio optimization cancelled")]
    OptimizationCancelled,

    #[error("Box Pleating Studio oracle mismatch: {0}")]
    OracleMismatch(String),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
}

pub type BpResult<T> = Result<T, BpError>;
