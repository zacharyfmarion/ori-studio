//! The computed 3D folded state.
//!
//! **Ori Studio native.** Oriedita's creases are always a full ±180, so there is
//! no upstream implementation of any of this to be faithful to and nothing here
//! is a divergence. See PORTING.md's Ori Studio native section.
//!
//! Eight pieces, in the order they run:
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
//! - [`planes`] groups the placed faces into planes and hands out the frame each
//!   one is read in, including the single place a stack's "up" is chosen.
//! - [`overlap`] is the exact polygon clip, shared with the census harness so
//!   the two implementations of the count cannot disagree about the primitive.
//! - [`census`] counts the coplanar-overlap pairs — the ordering variables — and
//!   detects where creases fold onto one line across a plane boundary.
//! - [`cells`] cuts each plane into the arrangement cells the ordering search
//!   consumes, and [`constraints`] and [`order`] decide which face is above
//!   which, per constraint component.
//! - [`model`] repacks the answer as view-independent geometry, [`snapshot`]
//!   as scalars, and [`wire`] gives every enum a stable code.
//! - [`session`] is the only place those are composed, and is what a handle
//!   holds.
//!
//! # Residuals in, verdict once
//!
//! The placement returns raw numbers and never a verdict. Every threshold lives
//! in [`Fold3dTolerances::DEFAULT`], applied once, in [`admit::admit`] — so
//! revising one stays a one-constant change, and a caller that wants the number
//! rather than the answer can have it. No tolerance is ever exposed to the user:
//! the right value depends on computed plane separation, which is information
//! the person being asked does not have.
//!
//! [`planes::plane_index`] is the same split one level down: it is **infallible**
//! and reports every tolerance violation as a [`ToleranceAlarm`], and
//! [`census::census`] is what turns one into a refusal. That is what makes the
//! alarms testable on the models the gate refuses, which is where they fire.

pub mod admit;
pub mod cells;
pub mod census;
pub mod constraints;
pub mod model;
pub mod order;
pub mod overlap;
pub mod placement;
pub mod planes;
pub mod session;
pub mod snapshot;
pub mod wire;

pub use admit::{Admission, Fold3dDiagnostics, Fold3dOutcome, admit, admit_with};
pub use cells::{Cell, CellError, CellIndex, cell_index};
pub use census::{
    CoplanarPair, Fold3dCensus, FoldedLineGroup, FoldedLineIndex, census, census_placement,
    folded_line_index, tolerance_refusal,
};
pub use constraints::{
    Coupling, Fold3dConstraints, Fold3dCrossing, Fold3dSeed, Interleaving, SeedKind,
    build_constraints, initial_hierarchy_3d, interleavings,
};
pub use model::{
    FOLDED_3D_CELL_ATTR_STRIDE, FOLDED_3D_EDGE_ATTR_STRIDE, FOLDED_3D_FACE_ATTR_STRIDE,
    FOLDED_3D_PLANE_FRAME_STRIDE, Folded3dRenderModel, RenderModelError,
};
pub use order::{
    Advance, Fold3dOrderEnumerator, Fold3dOrderError, Fold3dOrdering, OrderVariable,
    order_placement, order_segments,
};
pub use placement::{LoopGap, Placement3d, Rigid, place_segments};
pub use planes::{Plane3d, PlaneId, PlaneIndex, ToleranceAlarm, plane_index};
pub use session::{Fold3dSession, Fold3dSessionError};
pub use snapshot::{
    Fold3dCensusSummary, Fold3dDiagnosticsSummary, Fold3dPlaneSummary, Fold3dSnapshot,
};
pub use wire::{
    Fold3dCrossingWire, Fold3dOrderWire, Fold3dRefusalWire, Fold3dTolerancesWire, Fold3dVerdict,
};

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
/// already refuses. A constant nothing consults is worse than no constant, so it
/// was not declared until something needed one.
///
/// Phase 4 needed one, and it is an **area** rather than a length: the census's
/// question is whether two coplanar faces share paper, and two faces meeting
/// along a shared edge share an exact measure-zero sliver of it. So the fourth
/// bar below is `overlap_area_relative`, and the length bar still has no
/// referent.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Fold3dTolerances {
    /// Radians, on normals. Scale-free: two faces whose normals differ by less
    /// than this are parallel.
    pub angle_radians: f64,
    /// Relative to the paper span. The bar the placement's loop gap is held to,
    /// and the bar two coplanar faces' offsets are held to.
    pub distance_relative: f64,
    /// Degrees. A crease within this of a full fold is treated as a full fold —
    /// **in the gate's own copy of the segments, never written back**.
    pub flat_snap_degrees: f64,
    /// Relative to the paper span **squared**. Below this, two coplanar faces
    /// are touching rather than overlapping and carry no ordering variable.
    pub overlap_area_relative: f64,
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
    /// - `overlap_area_relative` sits in an empty band too, and for the same
    ///   reason it can: the two populations it separates are *touching* (an
    ///   exactly measure-zero sliver, reported as rounding noise) and *stacked*
    ///   (a real shared footprint, whose area is a fraction of a face). Asserted
    ///   by `the_overlap_area_bar_sits_in_an_empty_band`.
    pub const DEFAULT: Self = Self {
        angle_radians: 1e-7,
        distance_relative: 1e-6,
        flat_snap_degrees: crate::CLOSURE_RESIDUAL_BAR_DEGREES,
        overlap_area_relative: 1e-9,
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
    /// Two faces the plane partition put together are not within tolerance of
    /// each other, so coplanarity is not an equivalence relation on this model
    /// and the partition depends on how it was computed.
    ///
    /// The one refusal Phase 4 adds, and it covers what the plan listed twice —
    /// under `ToleranceWindowClosed` in Phase 4 and `PlanesTooClose` in Phase 5.
    /// They are one condition: a window too narrow to separate two planes and a
    /// window wide enough to chain three are the same statement about the same
    /// two numbers.
    ///
    /// Reachable in principle and reached by **nothing** in the 65-file external
    /// corpus or the committed fixtures — a plane ladder has to be constructed.
    /// `a_plane_ladder_inside_the_tolerance_window_is_refused` builds one.
    ToleranceWindowClosed {
        faces: (usize, usize),
        normal_radians: f64,
        offset_relative: f64,
        /// The side condition's upper bound, relative to the span. `None` means
        /// no two distinct planes are parallel at all, which certifies nothing —
        /// it is not an infinity.
        min_inter_separation: Option<f64>,
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
            Self::ToleranceWindowClosed {
                faces,
                normal_radians,
                offset_relative,
                ..
            } => write!(
                f,
                "faces {} and {} are in one plane but {normal_radians} rad and \
                 {offset_relative} of span apart",
                faces.0, faces.1
            ),
        }
    }
}

impl std::error::Error for Fold3dRefusal {}
