//! The computed 3D folded state.
//!
//! **Ori Studio native.** Oriedita's creases are always a full ±180, so there is
//! no upstream implementation of any of this to be faithful to and nothing here
//! is a divergence. See PORTING.md's Ori Studio native section.
//!
//! Two pieces, in the order they run:
//!
//! - [`placement`] walks the shipped dual-graph spanning tree and composes one
//!   rigid rotation per crease. Everything topological — the arrangement, the
//!   tree, each face's parent and the crease it folds across — comes from
//!   [`crate::fold_graph`] unchanged. The **only** thing that differs from the
//!   flat path is the per-crease transform.
//! - [`admit`] decides whether that placement describes real paper, reusing the
//!   checks that already ship rather than re-deriving them:
//!   [`crate::checks_spatial::dispatched_camv`] for per-vertex closure,
//!   [`crate::checks_spatial::LinkVerdict`] for local self-intersection, and
//!   [`crate::checks_spatial::interior_border_segments`] for a cut drawn inside
//!   the sheet.
//!
//! # Residuals in, verdict once
//!
//! The placement returns raw numbers and never a verdict. Every threshold lives
//! in [`Fold3dTolerances::DEFAULT`], applied once, in [`admit::admit`] — so
//! revising one stays a one-constant change, and a caller that wants the number
//! rather than the answer can have it. No tolerance is ever exposed to the user:
//! the right value depends on computed plane separation, which is information
//! the person being asked does not have.

pub mod admit;
pub mod placement;

pub use admit::{Admission, Fold3dDiagnostics, Fold3dOutcome, admit, admit_with};
pub use placement::{LoopGap, Placement3d, Rigid, place_segments};

use crate::checks::FlatFoldabilityRule;
use crate::checks_spatial::Indeterminate;
use crate::geometry::Point;

/// The tolerances the 3D fold needs, kept dimensionally distinct.
///
/// One distance tolerance would be wrong: within-crease-pattern crease-length
/// range on real patterns is p50 24x / p90 79x / max 221x, which implies a
/// critical fold angle varying two decades inside a single document. So the
/// angle bar is scale-free and the distance bar is relative to the paper span.
///
/// The plan asked for a third, absolute **length** bar, for a crease too short
/// to have a direction worth rotating about. There is no such crease:
/// `FoldGraph::from_segments` merges endpoints within `Epsilon::POINT` (2.5e-4),
/// so anything that survives into the arrangement with two distinct endpoints is
/// at least that long, and anything that does not is an exact zero the walk
/// already refuses. A constant nothing consults is worse than no constant, so
/// it is not declared until Phase 4 has a use for it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Fold3dTolerances {
    /// Radians, on normals. Scale-free: two faces whose normals differ by less
    /// than this are parallel.
    pub angle_radians: f64,
    /// Relative to the paper span. The bar the placement's loop gap is held to.
    pub distance_relative: f64,
    /// Degrees. A crease within this of a full fold is treated as a full fold —
    /// **in the gate's own copy of the segments, never written back**.
    pub flat_snap_degrees: f64,
}

impl Fold3dTolerances {
    /// The one const block. Nothing else in the crate, the wasm bridge or the
    /// frontend may declare a 3D tolerance.
    ///
    /// - `angle_radians` is far above the 1e-8 conditioning floor of the naive
    ///   `acos` form and far below any real design angle.
    /// - `distance_relative` sits in an empty band. The worst loop gap over
    ///   every admitted committed fixture is 2.0e-10 of span
    ///   (`penguin_freeform`) and over the whole external corpus 6.8e-10
    ///   (`self-intersecting-vertex`, a hand-rounded toy); the smallest refused
    ///   is 1.1e-1 (`rabbit_unclosed`). Three decades of headroom either side,
    ///   asserted by `the_loop_gap_bar_sits_in_an_empty_band`.
    /// - `flat_snap_degrees` is [`crate::CLOSURE_RESIDUAL_BAR_DEGREES`]: below
    ///   the bar the rest of the pipeline holds a vertex to, a crease is
    ///   indistinguishable from a full fold, so treating it as one is not a
    ///   modelling choice. It matters because the constraint *type* is
    ///   discontinuous at 180 degrees — unary wall-forcing below, binary
    ///   taco-tortilla at — so an unsnapped near-flat crease would make the 3D
    ///   command disagree with the shipped flat `Fold` on a nominally flat
    ///   document.
    pub const DEFAULT: Self = Self {
        angle_radians: 1e-7,
        distance_relative: 1e-6,
        flat_snap_degrees: crate::CLOSURE_RESIDUAL_BAR_DEGREES,
    };
}

impl Default for Fold3dTolerances {
    fn default() -> Self {
        Self::DEFAULT
    }
}

/// Why a crease pattern has no computable 3D folded state.
///
/// A stable **code**, never a sentence: the eight-locale i18n gate cannot see a
/// Rust string literal, so the copy lives on the frontend and this is what keys
/// it.
///
/// One enum for the placement and the gate rather than two. The plan proposed a
/// separate `Placement3dError`, but every arm of it would have been copied into
/// this one and the two would drift; the walk's refusals are refusals.
///
/// # Which of these anyone actually meets
///
/// Measured through this gate, in this order, over the whole external non-flat
/// corpus (65 files): **21 `FlatFoldability`, 8 `VertexClosure`, 7
/// `InteriorCut`, 1 `Disconnected`, 26 admitted.** `NoFaces`,
/// `FacesUnresolved`, `NonCreaseJoin`, `VertexIndeterminate` and
/// `LoopNotClosed` were reached by **nothing**, because on every model that
/// would have hit one, a vertex check refuses first. Reproduce with
/// `corpus_admission_reports_every_verdict`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Fold3dRefusal {
    /// The segments enclose nothing to fold.
    NoFaces,
    /// The arrangement declined to trace: `FoldGraph::calculate_faces`'s Euler
    /// gate rejected the whole crease pattern.
    ///
    /// The Euler gate wipes the faces of 18 of the 36 published third-party
    /// models and 0 of the 11 authored in Ori Studio — but **not one of them
    /// reaches this arm**, because the closure check refuses them first. It is
    /// reachable in principle (no flat violation, no closure failure, no
    /// interior cut, and a failing Euler gate) and by nothing in the corpus.
    FacesUnresolved,
    /// The dual graph of faces is not connected, so no walk places all of them.
    ///
    /// A clean closure verdict does not rule this out: the check is per vertex
    /// and never asks about connectivity, and the corpus contains a naturally
    /// authored file (two designs on one canvas) that is clean and unplaceable.
    Disconnected { reached: usize, unreached: usize },
    /// Two faces meet across a segment that is not a crease, so its fold angle
    /// is unknown.
    ///
    /// Named for what it is rather than after
    /// [`Indeterminate::UnassignedCrease`], which is a different thing (an
    /// unassigned ray at a vertex) in the same crate.
    NonCreaseJoin { line: usize },
    /// A border segment with paper on **both** sides: a cut, not a hinge.
    ///
    /// [`crate::checks_spatial::is_interior_vertex`] declines every vertex
    /// touching a border, so the closure check returns CLEAN having examined
    /// none of the geometry around one. Detected by
    /// [`crate::checks_spatial::interior_border_segments`] and consumed here.
    InteriorCut { line: usize, point: Point },
    /// A vertex all of whose creases are full folds, which Oriedita's own flat
    /// check rejects.
    FlatFoldability {
        point: Point,
        rule: FlatFoldabilityRule,
    },
    /// A vertex the closure check cannot evaluate at all.
    VertexIndeterminate { point: Point, cause: Indeterminate },
    /// A vertex whose creases do not close: walking them in angular order and
    /// composing their rotations does not return you to where you started.
    VertexClosure { point: Point, residual_degrees: f64 },
    /// The placement is not path-independent: two routes through the dual graph
    /// put the same face in different places.
    ///
    /// On simply connected paper this is implied by per-vertex closure, so it is
    /// defence in depth rather than the common refusal — but the implication
    /// runs through a check that declines every vertex a border touches, and a
    /// gap here is the cheapest available signal that something upstream did not
    /// look.
    LoopNotClosed {
        worst_edge: Option<usize>,
        gap_radians: f64,
        gap_offset: f64,
    },
}

impl std::fmt::Display for Fold3dRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoFaces => write!(f, "the selection encloses no faces"),
            Self::FacesUnresolved => write!(f, "the arrangement could not be traced"),
            Self::Disconnected { reached, unreached } => write!(
                f,
                "the fold graph is disconnected: {reached} faces placed, {unreached} unreachable"
            ),
            Self::NonCreaseJoin { line } => write!(
                f,
                "two faces meet across segment {line}, which is not a crease"
            ),
            Self::InteriorCut { line, .. } => {
                write!(f, "segment {line} is a border with paper on both sides")
            }
            Self::FlatFoldability { rule, .. } => write!(f, "flat-foldability violation: {rule:?}"),
            Self::VertexIndeterminate { cause, .. } => {
                write!(f, "a vertex cannot be evaluated: {cause:?}")
            }
            Self::VertexClosure {
                residual_degrees, ..
            } => write!(f, "creases do not close: {residual_degrees} degrees"),
            Self::LoopNotClosed { gap_offset, .. } => {
                write!(
                    f,
                    "the placement is not path-independent: {gap_offset} units"
                )
            }
        }
    }
}

impl std::error::Error for Fold3dRefusal {}
