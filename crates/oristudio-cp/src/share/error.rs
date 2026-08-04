//! Typed errors for the share codec.
//!
//! Every decode failure is one of these. The decoder never panics, never
//! allocates from an unvalidated count, and never partially applies a payload —
//! a share link either produces a whole document or an error naming why.

use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ShareError {
    #[error("payload is too short: need at least {need} bytes, got {got}")]
    Truncated { need: usize, got: usize },

    #[error("not an Ori Studio share payload (bad magic)")]
    BadMagic,

    /// A link from a newer Ori Studio. The UI must say so rather than showing a
    /// generic failure, because the user's link is not corrupt — it is future.
    #[error("share format version {0} is newer than this build understands")]
    UnknownVersion(u8),

    #[error("unknown compressor id {0}")]
    UnknownCompressor(u8),

    #[error("reserved frame flag bits are set; refusing to guess")]
    ReservedFrameFlags,

    #[error("declared body length {declared} exceeds the {limit} byte ceiling")]
    BodyTooLarge { declared: usize, limit: usize },

    /// Decompression bomb guard: a short payload must not be able to expand into
    /// an unbounded allocation.
    #[error("declared body length {declared} is {ratio}x the compressed size; refusing to expand")]
    ExpansionRatio { declared: usize, ratio: usize },

    #[error("decompression failed")]
    Decompress,

    #[error("body length {actual} does not match the declared {declared}")]
    LengthMismatch { declared: usize, actual: usize },

    #[error("body checksum mismatch: payload is corrupt")]
    ChecksumMismatch,

    #[error("version echo {echo} does not match frame version {frame}")]
    VersionEcho { echo: u8, frame: u8 },

    #[error("reserved body flag bits are set; refusing to guess")]
    ReservedBodyFlags,

    #[error("quantum exponent {0} is outside the supported 8..=60 range")]
    BadQuantum(i32),

    #[error("varint is unterminated or wider than 64 bits")]
    BadVarint,

    #[error("ran off the end of the body while reading {what}")]
    UnexpectedEnd { what: &'static str },

    /// Counts are checked against the remaining byte budget before anything is
    /// allocated, so a forged 13-byte header cannot request gigabytes.
    #[error("declared counts ({counts}) cannot fit in {remaining} remaining bytes")]
    ImplausibleCounts { counts: u64, remaining: usize },

    #[error("{what} index {index} is out of range (limit {limit})")]
    IndexOutOfRange {
        what: &'static str,
        index: u64,
        limit: u64,
    },

    /// Alphabets and column lists are strictly ascending by construction, so a
    /// zero or negative step is a corrupt payload, not a representable document.
    #[error("{what} is not strictly ascending at position {index}")]
    NotAscending { what: &'static str, index: usize },

    #[error("colour code {0} is reserved")]
    ReservedColour(u8),

    #[error("unknown critical extension tag {0:#06x}")]
    UnknownCriticalExtension(u16),

    #[error("extension tag {tag:#06x} is malformed: {reason}")]
    MalformedExtension { tag: u16, reason: &'static str },

    #[error("fold magnitude {0} is outside the representable 0..=1_800_000_000 range")]
    BadFoldMagnitude(u32),

    #[error("document is not representable in this format: {0}")]
    NotRepresentable(&'static str),

    /// The encoder verifies its own output before emitting (see `verify`). This
    /// is what a failure of that check looks like, and it is a bug rather than
    /// bad input.
    #[error("encoder self-check failed after {rounds} rounds: {reason}")]
    SelfCheck { rounds: usize, reason: &'static str },

    #[error("UTF-8 in extension tag {tag:#06x} is invalid")]
    BadUtf8 { tag: u16 },
}

pub type Result<T> = std::result::Result<T, ShareError>;
