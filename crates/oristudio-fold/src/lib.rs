//! The Fold workspace's engine: fold a sheet the way a person does
//! (`implementation-plans/fold-workspace.md`, D1–D6, D8, D10, D12, D14 and D16; the
//! evidence is `research/2026-10-08-fold-workspace.md`).
//!
//! - [`State`]: a flat folded state — the crease pattern with stable ids
//!   ([`pattern`]), convex faces with their lineage, every face's isometry
//!   derived from a root and checked, the pairwise layer order, and the
//!   [`View`] kept outside the model frame. [`State::make`] is the only
//!   constructor and refuses, naming faces and vertices, anything that is not
//!   a valid flat folded state ([`refusal`]).
//! - [`PlainFold`]: valley and mountain folds through all layers or down to
//!   picked flaps, closed-form with no solver call ([`fold`]); precrease,
//!   refold, unfold, turn over and rotate; and a precrease of part of its
//!   line, a segment or a pinch ([`State::precrease_extent`]), which leaves
//!   [`crease_marks`]: partial creases beside the face graph.
//! - [`sheet`]: convex sheets — square, rectangle, regular polygon.
//! - [`numerics`]: one tolerance, line snapping and the minimum feature.
//! - [`scene`]: what a painter draws a state from (plan D12), a superset of
//!   the kernel's folded paper scene (schema 3) with each face's transform,
//!   the crease pattern and the faces' lineage.
//! - Queries for the tools and panes (plan D14): [`State::cross_section`],
//!   the paper along a fold line as display layers, with its flaps and
//!   "Layers"; [`State::depth_choices`], the distinct moving sets of the top
//!   1, 2, … layers at a point; [`State::fold_action`], a step's fold line
//!   with its visible and hidden spans, the faces that move and the arrow's
//!   grip; and [`summary`], the M/V/F counts and the crease-pattern diff.
//! - With the `kernel` feature: `kernel`, the one conversion to the CP
//!   kernel's model (plan D10), and `fold_file`, the FOLD export of a
//!   sequence path built on the kernel's FOLD writer.
//! - [`Unordered`] and [`complete`]: parts whose layer order is still to be
//!   decided, and the one entry that completes it through Flat-Folder's
//!   search with a true ‹ n of m ›, for Import CP and the compound folds
//!   (around the faces a fold moved, [`complete::complete_around`]).
//! - [`compound`]: the one pipeline compound folds land through (plan D4:
//!   macro, score, hinge diff, derive, gate, carry, seed, complete, letters,
//!   validate), and on it [`State::reverse_fold`], the inside and outside
//!   reverse fold with per-flap openings, kind feasibility, refusals with
//!   fixes and stored choices; the vertex folds (research §5.3) —
//!   [`State::squash`] with per-layer creases, [`State::petal_fold`] over
//!   precreases or creasing its own, [`State::rabbit_ear`] and [`State::swivel`] with their
//!   fourth crease rising as the ridge, the odd letter out — each a
//!   direction-seeded completion with its preconditions refused up front; [`State::sink`] and [`State::unsink`], the open and closed sink
//!   of a closed point and the unsink back; and the [`StepMotion`] a
//!   compound step's animation draws (plan D15).
//! - [`import`]: Import CP — a crease pattern's sheet, faces and isometries,
//!   its order completed from its letters, and Edit's folded figure.
//! - [`witness`]: stored choices with faces named by sheet points, and their
//!   replay.
//! - The axioms on flat and folded forms (plan Phase 3): [`anchor`]s, the
//!   sheet points and segments a step names paper by; [`landmarks`] with
//!   provenance and visibility; the folded [`silhouette`] as the paper the
//!   constructions fold; [`axioms`] O1–O7 with who moves and replay;
//!   [`anchored`] folds along an axiom, an existing crease or a free line;
//!   and the sliver [`remedy`].
//!
//! The layer order, its constraint problem and the checker are
//! `oristudio-layer-order`'s; the tolerance and the convex-polygon primitives
//! are `oristudio-geometry`'s.
//!
//! # Conventions (research §3.1)
//!
//! | | |
//! |---|---|
//! | Frames | Sheet coordinates: the unit sheet frame (y-up, longer side 1). The model frame: the folded frame the root-carried isometries give; the viewer of an unturned view is at +z. |
//! | Orientation | `det T_f = +1`: face f shows its front (front-up). |
//! | Order | `above(f, g)`: f is nearer +z of the model frame where they overlap. |
//! | Direction | Valley: the moving part rotates toward the viewer and lands on top. Mountain: away, underneath. As the viewer sees it. |
//! | Letters | Front-relative: a folded crease is V iff its front-up face lies below. |
//! | Turn over | Mirrors the view; every `above` inverts *as seen*; no letter changes. |

pub mod anchor;
pub mod anchored;
pub mod axioms;
pub mod complete;
pub mod compound;
pub mod crease_marks;
mod flat_panels;
pub mod fold;
#[cfg(feature = "kernel")]
pub mod fold_file;
pub mod import;
mod index;
pub mod isometry;
#[cfg(feature = "kernel")]
pub mod kernel;
pub mod landmarks;
pub mod numerics;
pub mod pattern;
#[cfg(feature = "random-sequences")]
pub mod random;
pub mod refusal;
pub mod remedy;
pub mod reversal;
pub mod scene;
pub mod sheet;
pub mod silhouette;
pub mod state;
pub mod summary;
pub mod turn;
mod unordered;
pub mod view;
pub mod witness;

#[cfg(feature = "kernel")]
pub use fold_file::{FoldExportError, export_fold_sequence, export_fold_sequence_json};
#[cfg(feature = "kernel")]
pub use kernel::{KernelFrame, fold_cp_to_model};

pub use anchor::SheetSegment;
pub use anchored::{AnchoredFold, AnchoredRefused, FoldLine, LineRefusal, Resolved};
pub use axioms::{Axiom, AxiomCandidate, AxiomReplay};
pub use complete::{
    Check, CheckLimits, CheckStage, ChoiceCount, CompletionLimits, CompletionRefusal,
    CompletionSession, Completions, ComponentChoices, FixedKind, FixedPair,
};
pub use compound::crimp::{
    CrimpAnalysis, CrimpChoice, CrimpFold, CrimpFolded, CrimpOutcome, CrimpReport,
};
pub use compound::fan::FanAnalysis;
pub use compound::motion::{
    Carrier, LegName, MotionGroup, MotionKind, MotionLeg, Stacking, StepMotion,
};
pub use compound::petal::{
    NoPetal, NoPetalDetail, PetalAnalysis, PetalCrease, PetalFold, PetalHinge,
};
pub use compound::rabbit::{RabbitEar, incenter};
pub use compound::reverse::{
    NoOpening, Opening, ReverseAnalysis, ReverseChoice, ReverseChoices, ReverseFold, ReverseFolded,
    ReverseKind, ReverseOutcome, ReverseReport, StoredOpening, TipFlap,
};
pub use compound::sink::{
    Pocket, SinkChoice, SinkChoices, SinkFold, SinkFolded, SinkKind, SinkOutcome, SinkPoint,
    SinkReport, SinkStep, StoredPocket, SunkPoints, SunkTip, Unsink,
};
pub use compound::squash::{NoFlap, Squash, SquashAnalysis};
pub use compound::swivel::{
    Swivel, SwivelByEdge, SwivelCrease, SwivelEdgeAnalysis, SwivelFold, SwivelKind, SwivelRay,
    SwivelRegion, SwivelWedge,
};
pub use compound::swivel_valley_mountain::{SwivelValleyMountain, SwivelValleyMountainAnalysis};
pub use compound::tuck::{
    TuckAnalysis, TuckChoice, TuckChoices, TuckFold, TuckFolded, TuckOutcome, TuckReport, TuckSide,
    TuckTarget,
};
pub use compound::vertex::{
    VertexChoice, VertexChoices, VertexFoldKind, VertexFolded, VertexOutcome, VertexReport,
};
pub use compound::{CompoundFolded, CompoundRefused, CompoundReport};
pub use crease_marks::{CreaseMark, Extent, PINCH_FRACTION, default_pinch_length};
pub use fold::placements::{FoldLanding, FoldPlacement, FoldPlacementSearch};
pub use fold::{
    ActionKind, ClosurePolicy, CrossSection, DepthChoice, FoldActionGeometry, FoldAnalysis,
    FoldLineSpan, FoldReport, Folded, Grip, Placement, PlainFold, Pleat, Push, Refold, RowOrder,
    SectionInterval, SectionRow, Seed, Snap,
};
pub use import::{
    CreasePatternInput, ImportKind, ImportRefusal, ImportSegment, ImportSpace, ImportSummary,
    ImportTarget, ImportedPattern, starting_sheet,
};
pub use isometry::Isometry;
pub use landmarks::{
    CreaseMarkLandmark, Feature, Landmarks, LineLandmark, PointKind, PointLandmark, PointSource,
    SegmentKind, SegmentLandmark,
};
pub use pattern::{Crease, CreaseKind, EdgeId, Face, FaceId, Letter, VertexId};
pub use refusal::{Fix, Flap, FoldRefusal, NearMissCause, Refused, Side};
pub use remedy::{Pin, SliverRemedy};
pub use scene::{FoldScene, ScenePoint};
pub use sheet::{Sheet, SheetShape};
pub use silhouette::Silhouette;
pub use state::{State, StateParts};
pub use summary::{CreaseCounts, CreaseDiff, StepSummary};
pub use turn::TurnAxis;
pub use unordered::Unordered;
pub use view::{Direction, StartSide, View};
pub use witness::{Broken, BrokenWitness, WitnessOrder};

/// The engine's behaviour version: bumped when the same inputs can land a
/// different state. Stored beside replay caches and on Diagram links for
/// diagnostics only; a bump alone never marks a link stale (plan D17).
pub const FOLD_ENGINE_VERSION: u32 = 8;
