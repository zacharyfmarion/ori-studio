//! Typed errors for malformed input. A well-formed state that breaks a
//! layer-order rule is not an error: the checker reports it
//! ([`crate::check::Violation`]).

use thiserror::Error;

use crate::order::FacePair;
use crate::view::FaceId;

/// Everything the view constructor and the order conversions refuse.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum LayerOrderError {
    /// More faces than [`crate::view::MAX_FACES`]: the tables over their
    /// pairs would not fit.
    #[error("the view has {face_count} faces, over the {limit} cap")]
    TooManyFaces { face_count: usize, limit: usize },

    /// More triples of faces overlapping one another than a bounded build
    /// takes ([`crate::problem::MAX_STACKED_TRIPLES`]): their order would
    /// take too long to work out.
    #[error(
        "the view stacks up to {deepest} faces deep, {triples} overlapping triples over the {limit} cap"
    )]
    StackedTooDeep {
        deepest: usize,
        triples: u64,
        limit: u64,
    },

    /// Two faces share an id.
    #[error("face {0} appears more than once")]
    DuplicateFace(FaceId),

    /// A face polygon has fewer than three distinct points or a non-finite
    /// coordinate.
    #[error("face {face} has an invalid polygon: {reason}")]
    InvalidPolygon { face: FaceId, reason: &'static str },

    /// A face polygon is not convex at the tolerance.
    #[error("face {0} is not convex")]
    NonConvexFace(FaceId),

    /// A face no wider than the tolerance: it can overlap nothing.
    #[error("face {0} is no wider than the tolerance")]
    DegenerateFace(FaceId),

    /// An edge names a face the view does not have.
    #[error("edge {edge} names face {face}, which is not in the view")]
    UnknownEdgeFace { edge: usize, face: FaceId },

    /// An edge joins a face to itself.
    #[error("edge {edge} joins face {face} to itself")]
    SelfEdge { edge: usize, face: FaceId },

    /// An edge segment is non-finite or no longer than the tolerance.
    #[error("edge {edge} is degenerate: {reason}")]
    DegenerateEdge { edge: usize, reason: &'static str },

    /// A face of an edge straddles the edge's line, so the edge is not on its
    /// boundary.
    #[error("edge {edge} does not lie on the boundary of face {face}")]
    EdgeOffFace { edge: usize, face: FaceId },

    /// A folded edge whose faces lie on opposite sides of it, or a flat edge
    /// whose faces lie on the same side.
    #[error("edge {edge} is {kind} but its faces lie on {sides} of it")]
    EdgeKindMismatch {
        edge: usize,
        kind: &'static str,
        sides: &'static str,
    },

    /// A face cannot be ordered against itself.
    #[error("face {0} cannot be ordered against itself")]
    SameFace(FaceId),

    /// A conversion needs a face the view does not have.
    #[error("face {0} is not in the view")]
    FaceNotInView(FaceId),

    /// A FOLD `faceOrders` entry that is not `[f, g, s]` with `s` in
    /// `{-1, 0, 1}` and `f`, `g` face ids.
    #[error("faceOrders entry {index} is invalid: {reason}")]
    InvalidFaceOrder { index: usize, reason: &'static str },

    /// Two entries give one pair opposite orders.
    #[error("pair {pair} is given two contradictory orders")]
    ContradictoryOrder { pair: FacePair },

    /// A constraint problem checked against a view it was not built from.
    #[error("the constraint problem was built from a view with other faces")]
    ProblemMismatch,
}
