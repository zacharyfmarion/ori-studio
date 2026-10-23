//! Typed refusals (plan D4, D14): everything the engine declines to build,
//! naming the faces, vertices and creases involved, with the fixes it can
//! offer. A refusal is never a crash and never an approximation.
//!
//! [`FoldRefusal::code`] is the stable identifier the bridge, the UI and the
//! `fold refused` analytics event use (plan D18).

use oristudio_geometry::Line;
use oristudio_layer_order::Violation;
use serde::Serialize;
use thiserror::Error;

use crate::complete::BudgetLimit;
use crate::compound::petal::{NoPetal, NoPetalDetail, PetalCrease};
use crate::compound::reverse::{NoOpening, ReverseKind};
use crate::compound::sink::SinkKind;
use crate::compound::squash::NoFlap;
use crate::compound::tuck::TuckSide;
use crate::pattern::{EdgeId, FaceId, VertexId};

type Point = [f64; 2];

/// Why a near miss is one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NearMissCause {
    /// The vertex lies between the tolerance and the minimum feature from the
    /// line asked for or from the snapped line.
    Band,
    /// Snapping the line moved the vertex to the other side of it, or onto it.
    SnapChangesSide,
    /// The vertex was snapped onto the line, but the snapped line misses it by
    /// more than [`crate::numerics::EXACT`].
    SnapAmbiguous,
}

/// Everything the engine refuses.
#[derive(Debug, Clone, PartialEq, Serialize, Error)]
#[serde(rename_all = "snake_case", tag = "code")]
pub enum FoldRefusal {
    // --- The sheet -------------------------------------------------------
    #[error("a sheet outline needs at least three points, got {count}")]
    SheetTooFewPoints { count: usize },
    #[error("a sheet outline has a coordinate that is not finite")]
    SheetNotFinite,
    #[error("the sheet outline is not convex")]
    SheetNotConvex,
    #[error("side {index} of the sheet outline is {length}, shorter than the minimum feature")]
    SheetSideTooShort { index: usize, length: f64 },
    #[error(
        "the sheet outline is not in the unit frame (bounding box at the origin, longer side 1)"
    )]
    SheetNotInUnitFrame,
    #[error("a rectangle needs a finite, positive width and height")]
    InvalidRectangle,
    #[error("a regular polygon sheet cannot have {sides} sides")]
    InvalidSides { sides: u32 },

    // --- The state (State::make) -----------------------------------------
    /// More faces than the layer order's cap
    /// (`oristudio_layer_order::MAX_FACES`): checked before anything is
    /// derived, since its tables grow with the square of the faces.
    #[error("the state has {face_count} faces, over the {limit} cap")]
    TooManyFaces { face_count: usize, limit: usize },
    /// Layers stacked too deeply for their order to be worked out in time
    /// (`oristudio_layer_order::MAX_STACKED_TRIPLES`): `triples` faces
    /// overlapping one another three at a time, the deepest stack `deepest`
    /// layers. Checked once the faces' overlaps are known, before any
    /// constraint or order is derived from them.
    #[error(
        "the state stacks up to {deepest} layers deep, {triples} overlapping triples over the {limit} cap"
    )]
    StackedTooDeep {
        deepest: usize,
        triples: u64,
        limit: u64,
    },
    #[error("{what} {id} appears more than once")]
    DuplicateId { what: &'static str, id: u32 },
    #[error("face {face} names vertex {vertex}, which does not exist")]
    UnknownVertex { face: FaceId, vertex: VertexId },
    #[error("crease {edge} names vertex {vertex}, which does not exist")]
    CreaseUnknownVertex { edge: EdgeId, vertex: VertexId },
    #[error("vertex {vertex} is on no face")]
    UnusedVertex { vertex: VertexId },
    #[error("face {face} has fewer than three vertices")]
    FaceTooSmall { face: FaceId },
    #[error("face {face} has the side {vertices:?}, which is no crease")]
    MissingCrease {
        face: FaceId,
        vertices: [VertexId; 2],
    },
    #[error("crease {edge} borders {faces} faces")]
    CreaseFaceCount { edge: EdgeId, faces: usize },
    #[error("face {face} is not a convex counter-clockwise polygon")]
    NonConvexFace { face: FaceId },
    #[error("the faces cover {faces_area} of the sheet's {sheet_area}")]
    AreaMismatch { faces_area: f64, sheet_area: f64 },
    #[error("vertex {vertex} is not on the sheet")]
    VertexOffSheet { vertex: VertexId },
    #[error("border crease {edge} does not lie along a side of the sheet")]
    BorderOffOutline { edge: EdgeId },
    #[error("the root face {face}'s isometry is not a rigid motion")]
    RootNotRigid { face: FaceId },
    #[error("the view's rotation is not a finite angle")]
    ViewNotFinite,
    #[error("the root face {face} is not in the state")]
    UnknownRoot { face: FaceId },
    #[error("face {face} is not connected to the root face")]
    UnreachedFace { face: FaceId },
    #[error("vertex {vertex} lands {residual} apart through face {face} and the root's path")]
    Residual {
        vertex: VertexId,
        face: FaceId,
        residual: f64,
    },
    #[error("crease {edge} is {kind} between faces {faces:?} of the wrong orientations")]
    HingeOrientation {
        edge: EdgeId,
        faces: [FaceId; 2],
        kind: &'static str,
    },
    #[error("the folded image is malformed: {message}")]
    FoldedImage { message: String, faces: Vec<FaceId> },
    #[error("the layer order breaks {} rule(s)", violations.len())]
    LayerOrder { violations: Vec<Violation> },

    // --- A fold ---------------------------------------------------------
    #[error("the fold line misses the paper on the moving side")]
    NoMovingSide,
    #[error("the fold line passes {distance} from vertex {vertex}: a near miss")]
    NearMiss {
        vertex: VertexId,
        distance: f64,
        cause: NearMissCause,
    },
    #[error("the sheet point {point:?} is in no face (off the sheet, or on a crease)")]
    WitnessNotInFace { point: Point },
    #[error("the sheet point {point:?} is not on the moving side")]
    SeedNotOnMovingSide { point: Point },
    #[error("the seed names no layer on the moving side")]
    EmptySeed,
    #[error("everything would move: nothing stays put")]
    NothingStays,
    #[error("the fold also moves flaps {added:?}")]
    ClosureAddsFlaps { added: Vec<usize> },
    #[error("the tuck target {face} would move")]
    TuckTargetMoves { face: FaceId },
    #[error("face {face} does not split into two pieces along the fold line")]
    DegenerateSplit { face: FaceId },
    #[error("the new crease {vertices:?} is {length}, shorter than the minimum feature")]
    ShortCrease {
        vertices: [VertexId; 2],
        length: f64,
    },
    #[error(
        "splitting face {face} leaves a piece {width} wide, thinner than half the minimum feature"
    )]
    ThinPiece { face: FaceId, width: f64 },
    #[error("vertex {vertex} lands {penetration} inside face {face}: a sliver")]
    Sliver {
        vertex: VertexId,
        face: FaceId,
        penetration: f64,
    },
    #[error("face {face} lands {residual} from where the fold puts it")]
    PredictionMismatch { face: FaceId, residual: f64 },
    #[error("unfolding the precrease moved more than the folded layers")]
    PrecreaseUnfoldMovedMore,

    // --- A compound fold (plan D4) --------------------------------------
    /// No layer order puts the moved paper anywhere: the faces the conflict
    /// traces to, in the landed state.
    #[error("no layer order fits the fold; faces {faces:?} conflict")]
    NoOrder { faces: Vec<FaceId> },
    #[error("the layer-order search hit its {limit:?} budget after {nodes} nodes")]
    BudgetExceeded { limit: BudgetLimit, nodes: u64 },
    #[error("the choice {choice:?} names no listed order")]
    NoSuchChoice { choice: Vec<usize> },
    /// A flap of a reverse fold's tip cannot open: its faces, in the parent.
    #[error("flap {faces:?} has no opening to reverse it through ({cause:?})")]
    ReverseNoOpening {
        faces: Vec<FaceId>,
        cause: NoOpening,
    },
    /// The tip cannot swing: layers that are not part of it lie in its way.
    /// `blocking` are those layers' faces in the parent; `faces` every face
    /// the conflict traces to in the landed state.
    #[error("the tip is not free: faces {blocking:?} are in its way")]
    ReverseTipNotFree {
        blocking: Vec<FaceId>,
        faces: Vec<FaceId>,
    },
    /// No layer order fits a reverse fold of this kind: the faces the
    /// conflict traces to, in the landed state.
    #[error("no {kind:?} reverse fold fits; faces {faces:?} conflict")]
    ReverseKindInfeasible {
        kind: ReverseKind,
        faces: Vec<FaceId>,
    },

    // --- Tucks and crimps (plan Phase 11) -------------------------------
    /// No order puts the block immediately under (or over) its target: T,
    /// which stays, and the faces the conflict traces to in the landed
    /// state.
    #[error("the fold cannot be tucked {placement:?} face {target}; faces {faces:?} conflict")]
    TuckInfeasible {
        target: FaceId,
        placement: TuckSide,
        faces: Vec<FaceId>,
    },
    /// A crimp's second line meets its first over the paper it moves, or
    /// within the minimum feature of it: the tip's faces there, in the
    /// parent.
    #[error("the crimp's lines meet over faces {faces:?}")]
    CrimpLinesMeet { faces: Vec<FaceId> },
    /// A crimp's second line crosses none of the paper beyond its first: it
    /// would be a reverse fold.
    #[error("the crimp's second line misses the tip")]
    CrimpMissesTip,
    /// A flap that opens at the first line does not open at the second: one
    /// of its blocks reaches past the second line without the other, or
    /// with nothing there to hinge to. Its faces, in the parent.
    #[error("flap {faces:?} does not open at the crimp's second line")]
    CrimpNoOpening { faces: Vec<FaceId> },
    /// No order fits a crimp of this kind: the faces the conflict traces to,
    /// in the landed state.
    #[error("no {kind:?} crimp fits; faces {faces:?} conflict")]
    CrimpKindInfeasible {
        kind: ReverseKind,
        faces: Vec<FaceId>,
    },
    /// The crimped paper cannot swing: layers that are not part of it lie in
    /// its way. `blocking` are those layers' faces in the parent; `faces`
    /// every face the conflict traces to in the landed state.
    #[error("the crimp is not free: faces {blocking:?} are in its way")]
    CrimpTipNotFree {
        blocking: Vec<FaceId>,
        faces: Vec<FaceId>,
    },

    // --- The vertex folds (plan Phase 11, research §5.3) -----------------
    /// No two-layer flap to squash at the point: `faces` are the layers
    /// there, in the parent.
    #[error("there is no two-layer flap to squash at faces {faces:?} ({cause:?})")]
    SquashNoFlap { faces: Vec<FaceId>, cause: NoFlap },
    /// The flap is attached off its hinge line, to `faces`; `flap` is its
    /// own faces.
    #[error("the flap is not free: faces {faces:?} hold it off its hinge")]
    SquashFlapNotFree {
        faces: Vec<FaceId>,
        flap: Vec<FaceId>,
    },
    /// Other paper lies over the flap, or inside it, on the side it squashes
    /// toward: `faces`; `flap` is its own faces.
    #[error("the flap is covered by faces {faces:?}")]
    SquashFlapCovered {
        faces: Vec<FaceId>,
        flap: Vec<FaceId>,
    },
    /// The spine's target is outside the wedge between the hinge and the
    /// spine, or no direction.
    #[error("the spine cannot land there: outside the wedge between its hinge and itself")]
    SquashTargetOutside,
    /// A petal fold's line or kite crease crosses `faces` instead of
    /// bounding them: it must be precreased first. H named by a crease needs
    /// both there; H named by two points scores what is missing, except H
    /// across the second layer's paper outside a kite crease, which folds in
    /// below H (`missing: line`).
    #[error("the petal fold's {missing:?} is not precreased across faces {faces:?}")]
    PetalNotPrecreased {
        faces: Vec<FaceId>,
        missing: PetalCrease,
    },
    /// The top layer below the petal fold's line, `faces`, is no petal's;
    /// `detail` says more where the cause's name does not: the line misses
    /// the flap altogether, or the flap reaches past the kite creases'
    /// corner (`faces` then the paper beyond it).
    #[error("faces {faces:?} make no flap to petal fold ({cause:?}, {detail:?})")]
    PetalNoFlap {
        faces: Vec<FaceId>,
        cause: NoPetal,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<NoPetalDetail>,
    },
    /// A rabbit ear's or a swivel's center is not inside layer `faces` by
    /// half the minimum feature: on a crease, or off the layer.
    #[error("the fan's center is not inside faces {faces:?}")]
    FanCenter { faces: Vec<FaceId> },
    /// A ray crosses into paper that does not fold with the fan's layers,
    /// or paper joins two of its wedges: `faces`, which hold it.
    #[error("the fan's paper is held by faces {faces:?}")]
    FanRayBlocked { faces: Vec<FaceId> },
    /// The rays fold flat no way: no Kawasaki candidate for the fourth, or
    /// two rays coincide.
    #[error("the fan's rays cannot fold flat")]
    FanNotFlat,
    /// The fourth crease runs beside the paper that stays: a rabbit ear's
    /// (or a swivel's) fourth crease is the ridge its flap rises along, so it
    /// must lie across from that paper, one of the far wedge's two rays.
    #[error("the fourth crease runs beside the paper that stays")]
    FanFourthBesideStayer,
    /// The angles between the rays will not let the fourth crease fold
    /// opposite the other three: a narrowest angle lies between two creases
    /// that would fold alike (a swivel's; a rabbit ear's never does).
    #[error("the fourth crease cannot fold opposite the other three")]
    FanFourthCannotRise,
    /// The paper at the stayer point is joined to none of the fan's wedges.
    #[error("the paper at {point:?} holds none of the fan's wedges")]
    FanStayerDetached { point: Point },
    /// A swivel by its edge (`compound::swivel`): the sheet point names no
    /// raw edge or folded crease, so no edge of the folded form to move.
    #[error("no raw or folded edge passes through the sheet point {point:?}")]
    SwivelNotAnEdge { point: Point },
    /// The target line is parallel to the edge, or is its line: there is
    /// no point to turn the edge about onto it. `faces` bound the edge.
    #[error("the target line is parallel to the edge")]
    SwivelTargetParallel { faces: Vec<FaceId> },
    /// The vertex — the pivot moved square onto the nearer bisector of the
    /// edge and the target — lies within the minimum feature of the edge's
    /// line: a swivel's vertex is free, never on an edge. `faces` bound the
    /// edge.
    #[error("the swivel's vertex lies on the edge's line")]
    SwivelPivotOnEdge { faces: Vec<FaceId> },
    /// No part of the edge lies past the foot of the vertex, away from
    /// where the edge meets the target: none of it would swivel, and a
    /// plain fold along the bisector lands it (offered as a fix). `faces`
    /// bound the edge.
    #[error("the edge ends before the swivel's foot")]
    SwivelEdgeShort { faces: Vec<FaceId> },
    /// The edge's paper would not turn onto the target: the layers the
    /// creases cut leave it out, and what joins it stays (or folds across
    /// the hinge). `faces` bound the edge.
    #[error("the edge's paper does not swivel onto the target")]
    SwivelEdgeStays { faces: Vec<FaceId> },
    /// A swivel on a folded edge (`compound::swivel_on_edge`): the sheet
    /// point named for the folded edge its creases meet on lies on no
    /// folded crease.
    #[error("no folded edge passes through the sheet point {point:?}")]
    SwivelNotAFold { point: Point },
    /// A swivel by its valley and mountain (`compound::swivel_valley_mountain`):
    /// the two lines meet on no folded edge the viewer sees, or on several
    /// stacked ones that name different paper, or within the minimum feature
    /// of a folded edge's end; or they do not meet at all.
    #[error("the valley and the mountain do not meet on one folded edge")]
    SwivelLineMeeting,
    /// A swivel by its valley and mountain whose lines bound no flap: one of
    /// them runs along the folded edge they meet on, or the two lie along one
    /// line. `faces` are the two the folded edge joins.
    #[error("the valley and the mountain bound no flap")]
    SwivelNoFlap { faces: Vec<FaceId> },
    /// The line halfway between the edge and the target crosses the folded
    /// edge nowhere inside one of its creases, away from their ends (or
    /// runs parallel to it): the creases cannot meet on it. `faces` are the
    /// two the folded edge joins where it was named.
    #[error("the swivel's crease does not cross the folded edge")]
    SwivelMissesFold { faces: Vec<FaceId> },
    /// The swivel's crease meets the folded edge at a right angle or wider
    /// on the side of the edge that moves: the other layer's second crease,
    /// the folded edge reflected in the swivel's, would lie past the folded
    /// edge, outside its paper. `faces` are the two the folded edge joins.
    #[error("the swivel's crease meets the folded edge too steeply")]
    SwivelFoldWide { faces: Vec<FaceId> },
    /// An inside swivel at a free vertex: the strip it tucks lies between
    /// the two layers a folded edge joins, and a free vertex lies on none —
    /// its creases cut every layer alike, which move as one. `faces` bound
    /// the edge.
    #[error("an inside swivel's creases meet on a folded edge")]
    SwivelInsideFree { faces: Vec<FaceId> },

    // --- Sinks (plan Phase 11, research §5.4) ---------------------------
    /// The anchor names more than one of the moving side's flaps: a sink
    /// takes one point. `faces` are theirs, in the parent.
    #[error("the anchor names {flaps} points; a sink takes one")]
    SinkSeveralPoints { flaps: usize, faces: Vec<FaceId> },
    /// Raw edges lie on the point's outline at its crown, the paper farthest
    /// from ℓ: it is open (free corners), and nothing decides a sink of it.
    /// `faces` hold those edges.
    #[error("the point is open: faces {faces:?} have raw edges at its tip")]
    SinkPointOpen { faces: Vec<FaceId> },
    /// The point's outline creases carry both letters: it has no one
    /// outside, so it does not open-sink. `faces` are the point's.
    #[error("the point's outline creases carry both letters; it has no one outside")]
    SinkOutlineMixed { faces: Vec<FaceId> },
    /// The point's outline creases do not lie on two straight sides (beside
    /// a flat top square to them), so it has no axis for an open sink to be
    /// square to.
    #[error("the point's outline is not two straight sides; it has no axis")]
    SinkNoAxis { faces: Vec<FaceId> },
    /// ℓ meets the point's two sides `offset` apart in their distance from
    /// its tip: an open sink needs it exactly square to the point's axis.
    #[error("the sink line is {offset} off square to the point's axis")]
    SinkLineTilted { offset: f64, faces: Vec<FaceId> },
    /// No split of the point along its outline creases is a pocket a closed
    /// sink can go into. `faces` are the point's.
    #[error("the point has no pocket to sink into")]
    SinkNoPocket { faces: Vec<FaceId> },
    /// The paper grown from the anchor across every crease off the line is
    /// not a sunk point: it reaches across the line, or no folded crease on
    /// the line joins it to the rest. `faces` are those in the way, or the
    /// whole region.
    #[error("faces {faces:?} are not a sunk point on this line")]
    UnsinkNotSunk { faces: Vec<FaceId> },

    // --- Crease marks: partial precreases (`crate::crease_marks`) -------
    /// A crease mark (by its index in the state's marks) has an end that is
    /// not finite or not on the sheet (State::make).
    #[error("crease mark {mark} has an end off the sheet")]
    MarkOffSheet { mark: usize },
    #[error("crease mark {mark} is {length}, shorter than the minimum feature")]
    MarkTooShort { mark: usize, length: f64 },
    /// A crease mark lies along a crease: the crease should have subsumed it.
    #[error("crease mark {mark} lies along crease {edge}")]
    MarkOnCrease { mark: usize, edge: EdgeId },
    #[error("crease marks {marks:?} overlap")]
    MarksOverlap { marks: [usize; 2] },
    /// A sheet point naming a partial precrease's extent is off the paper.
    #[error("the sheet point {point:?} naming the extent is not on the paper")]
    ExtentOffPaper { point: Point },
    /// The extent is shorter than the minimum feature along the line: a
    /// segment's ends project that close, or a pinch is that short.
    #[error("the extent is {length} along the line, shorter than the minimum feature")]
    ExtentTooShort { length: f64 },
    /// No paper lies along the line within the extent.
    #[error("the extent misses the paper along the line")]
    ExtentMissesPaper,
    /// Paper lies along the line within the extent, but none of the layers
    /// the precrease goes through crosses it there.
    #[error("the extent crosses none of the layers the precrease goes through")]
    ExtentMissesLayers,

    /// A defect, never the input's fault.
    #[error("internal error: {message}")]
    Internal { message: String },
}

impl FoldRefusal {
    /// The stable snake_case code.
    pub fn code(&self) -> &'static str {
        match self {
            FoldRefusal::SheetTooFewPoints { .. } => "sheet_too_few_points",
            FoldRefusal::SheetNotFinite => "sheet_not_finite",
            FoldRefusal::SheetNotConvex => "sheet_not_convex",
            FoldRefusal::SheetSideTooShort { .. } => "sheet_side_too_short",
            FoldRefusal::SheetNotInUnitFrame => "sheet_not_in_unit_frame",
            FoldRefusal::InvalidRectangle => "invalid_rectangle",
            FoldRefusal::InvalidSides { .. } => "invalid_sides",
            FoldRefusal::TooManyFaces { .. } => "too_many_faces",
            FoldRefusal::StackedTooDeep { .. } => "stacked_too_deep",
            FoldRefusal::DuplicateId { .. } => "duplicate_id",
            FoldRefusal::UnknownVertex { .. } => "unknown_vertex",
            FoldRefusal::CreaseUnknownVertex { .. } => "crease_unknown_vertex",
            FoldRefusal::UnusedVertex { .. } => "unused_vertex",
            FoldRefusal::FaceTooSmall { .. } => "face_too_small",
            FoldRefusal::MissingCrease { .. } => "missing_crease",
            FoldRefusal::CreaseFaceCount { .. } => "crease_face_count",
            FoldRefusal::NonConvexFace { .. } => "non_convex_face",
            FoldRefusal::AreaMismatch { .. } => "area_mismatch",
            FoldRefusal::VertexOffSheet { .. } => "vertex_off_sheet",
            FoldRefusal::BorderOffOutline { .. } => "border_off_outline",
            FoldRefusal::RootNotRigid { .. } => "root_not_rigid",
            FoldRefusal::ViewNotFinite => "view_not_finite",
            FoldRefusal::UnknownRoot { .. } => "unknown_root",
            FoldRefusal::UnreachedFace { .. } => "unreached_face",
            FoldRefusal::Residual { .. } => "residual",
            FoldRefusal::HingeOrientation { .. } => "hinge_orientation",
            FoldRefusal::FoldedImage { .. } => "folded_image",
            FoldRefusal::LayerOrder { .. } => "layer_order",
            FoldRefusal::NoMovingSide => "no_moving_side",
            FoldRefusal::NearMiss { .. } => "near_miss",
            FoldRefusal::WitnessNotInFace { .. } => "witness_not_in_face",
            FoldRefusal::SeedNotOnMovingSide { .. } => "seed_not_on_moving_side",
            FoldRefusal::EmptySeed => "empty_seed",
            FoldRefusal::NothingStays => "nothing_stays",
            FoldRefusal::ClosureAddsFlaps { .. } => "closure_adds_flaps",
            FoldRefusal::TuckTargetMoves { .. } => "tuck_target_moves",
            FoldRefusal::DegenerateSplit { .. } => "degenerate_split",
            FoldRefusal::ShortCrease { .. } => "short_crease",
            FoldRefusal::ThinPiece { .. } => "thin_piece",
            FoldRefusal::Sliver { .. } => "sliver",
            FoldRefusal::PredictionMismatch { .. } => "prediction_mismatch",
            FoldRefusal::PrecreaseUnfoldMovedMore => "precrease_unfold_moved_more",
            FoldRefusal::NoOrder { .. } => "no_order",
            FoldRefusal::BudgetExceeded { .. } => "budget_exceeded",
            FoldRefusal::NoSuchChoice { .. } => "no_such_choice",
            FoldRefusal::ReverseNoOpening { .. } => "reverse_no_opening",
            FoldRefusal::ReverseTipNotFree { .. } => "reverse_tip_not_free",
            FoldRefusal::ReverseKindInfeasible { .. } => "reverse_kind_infeasible",
            FoldRefusal::TuckInfeasible { .. } => "tuck_infeasible",
            FoldRefusal::CrimpLinesMeet { .. } => "crimp_lines_meet",
            FoldRefusal::CrimpMissesTip => "crimp_misses_tip",
            FoldRefusal::CrimpNoOpening { .. } => "crimp_no_opening",
            FoldRefusal::CrimpKindInfeasible { .. } => "crimp_kind_infeasible",
            FoldRefusal::CrimpTipNotFree { .. } => "crimp_tip_not_free",
            FoldRefusal::SquashNoFlap { .. } => "squash_no_flap",
            FoldRefusal::SquashFlapNotFree { .. } => "squash_flap_not_free",
            FoldRefusal::SquashFlapCovered { .. } => "squash_flap_covered",
            FoldRefusal::SquashTargetOutside => "squash_target_outside",
            FoldRefusal::PetalNotPrecreased { .. } => "petal_not_precreased",
            FoldRefusal::PetalNoFlap { .. } => "petal_no_flap",
            FoldRefusal::FanCenter { .. } => "fan_center",
            FoldRefusal::FanRayBlocked { .. } => "fan_ray_blocked",
            FoldRefusal::FanNotFlat => "fan_not_flat",
            FoldRefusal::FanFourthBesideStayer => "fan_fourth_beside_stayer",
            FoldRefusal::FanFourthCannotRise => "fan_fourth_cannot_rise",
            FoldRefusal::FanStayerDetached { .. } => "fan_stayer_detached",
            FoldRefusal::SwivelNotAnEdge { .. } => "swivel_not_an_edge",
            FoldRefusal::SwivelTargetParallel { .. } => "swivel_target_parallel",
            FoldRefusal::SwivelPivotOnEdge { .. } => "swivel_pivot_on_edge",
            FoldRefusal::SwivelEdgeShort { .. } => "swivel_edge_short",
            FoldRefusal::SwivelEdgeStays { .. } => "swivel_edge_stays",
            FoldRefusal::SwivelNotAFold { .. } => "swivel_not_a_fold",
            FoldRefusal::SwivelLineMeeting => "swivel_line_meeting",
            FoldRefusal::SwivelNoFlap { .. } => "swivel_no_flap",
            FoldRefusal::SwivelMissesFold { .. } => "swivel_misses_fold",
            FoldRefusal::SwivelFoldWide { .. } => "swivel_fold_wide",
            FoldRefusal::SwivelInsideFree { .. } => "swivel_inside_free",
            FoldRefusal::SinkSeveralPoints { .. } => "sink_several_points",
            FoldRefusal::SinkPointOpen { .. } => "sink_point_open",
            FoldRefusal::SinkOutlineMixed { .. } => "sink_outline_mixed",
            FoldRefusal::SinkNoAxis { .. } => "sink_no_axis",
            FoldRefusal::SinkLineTilted { .. } => "sink_line_tilted",
            FoldRefusal::SinkNoPocket { .. } => "sink_no_pocket",
            FoldRefusal::UnsinkNotSunk { .. } => "unsink_not_sunk",
            FoldRefusal::MarkOffSheet { .. } => "mark_off_sheet",
            FoldRefusal::MarkTooShort { .. } => "mark_too_short",
            FoldRefusal::MarkOnCrease { .. } => "mark_on_crease",
            FoldRefusal::MarksOverlap { .. } => "marks_overlap",
            FoldRefusal::ExtentOffPaper { .. } => "extent_off_paper",
            FoldRefusal::ExtentTooShort { .. } => "extent_too_short",
            FoldRefusal::ExtentMissesPaper => "extent_misses_paper",
            FoldRefusal::ExtentMissesLayers => "extent_misses_layers",
            FoldRefusal::Internal { .. } => "internal",
        }
    }

    /// The faces the refusal names, ascending.
    pub fn faces(&self) -> Vec<FaceId> {
        let mut faces = match self {
            FoldRefusal::UnknownVertex { face, .. }
            | FoldRefusal::FaceTooSmall { face }
            | FoldRefusal::MissingCrease { face, .. }
            | FoldRefusal::NonConvexFace { face }
            | FoldRefusal::UnknownRoot { face }
            | FoldRefusal::RootNotRigid { face }
            | FoldRefusal::UnreachedFace { face }
            | FoldRefusal::Residual { face, .. }
            | FoldRefusal::TuckTargetMoves { face }
            | FoldRefusal::DegenerateSplit { face }
            | FoldRefusal::ThinPiece { face, .. }
            | FoldRefusal::Sliver { face, .. }
            | FoldRefusal::PredictionMismatch { face, .. } => vec![*face],
            FoldRefusal::HingeOrientation { faces, .. } => faces.to_vec(),
            FoldRefusal::FoldedImage { faces, .. }
            | FoldRefusal::NoOrder { faces }
            | FoldRefusal::ReverseNoOpening { faces, .. }
            | FoldRefusal::ReverseKindInfeasible { faces, .. }
            | FoldRefusal::CrimpLinesMeet { faces }
            | FoldRefusal::CrimpNoOpening { faces }
            | FoldRefusal::CrimpKindInfeasible { faces, .. }
            | FoldRefusal::SquashNoFlap { faces, .. }
            | FoldRefusal::SquashFlapNotFree { faces, .. }
            | FoldRefusal::SquashFlapCovered { faces, .. }
            | FoldRefusal::PetalNotPrecreased { faces, .. }
            | FoldRefusal::PetalNoFlap { faces, .. }
            | FoldRefusal::FanCenter { faces }
            | FoldRefusal::FanRayBlocked { faces }
            | FoldRefusal::SwivelTargetParallel { faces }
            | FoldRefusal::SwivelPivotOnEdge { faces }
            | FoldRefusal::SwivelEdgeShort { faces }
            | FoldRefusal::SwivelEdgeStays { faces }
            | FoldRefusal::SwivelNoFlap { faces }
            | FoldRefusal::SwivelMissesFold { faces }
            | FoldRefusal::SwivelFoldWide { faces }
            | FoldRefusal::SwivelInsideFree { faces }
            | FoldRefusal::SinkSeveralPoints { faces, .. }
            | FoldRefusal::SinkPointOpen { faces }
            | FoldRefusal::SinkOutlineMixed { faces }
            | FoldRefusal::SinkNoAxis { faces }
            | FoldRefusal::SinkLineTilted { faces, .. }
            | FoldRefusal::SinkNoPocket { faces }
            | FoldRefusal::UnsinkNotSunk { faces } => faces.clone(),
            FoldRefusal::ReverseTipNotFree { blocking, .. }
            | FoldRefusal::CrimpTipNotFree { blocking, .. } => blocking.clone(),
            FoldRefusal::TuckInfeasible { target, faces, .. } => {
                faces.iter().copied().chain([*target]).collect()
            }
            FoldRefusal::LayerOrder { violations } => {
                violations.iter().flat_map(Violation::faces).collect()
            }
            _ => Vec::new(),
        };
        faces.sort_unstable();
        faces.dedup();
        faces
    }

    /// The vertices the refusal names.
    pub fn vertices(&self) -> Vec<VertexId> {
        match self {
            FoldRefusal::UnknownVertex { vertex, .. }
            | FoldRefusal::CreaseUnknownVertex { vertex, .. }
            | FoldRefusal::UnusedVertex { vertex }
            | FoldRefusal::VertexOffSheet { vertex }
            | FoldRefusal::Residual { vertex, .. }
            | FoldRefusal::NearMiss { vertex, .. }
            | FoldRefusal::Sliver { vertex, .. } => vec![*vertex],
            FoldRefusal::MissingCrease { vertices, .. }
            | FoldRefusal::ShortCrease { vertices, .. } => vertices.to_vec(),
            _ => Vec::new(),
        }
    }
}

/// A side of a line, relative to its normal: `Positive` is where
/// `n · p > d`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Positive,
    Negative,
}

impl Side {
    pub fn opposite(self) -> Side {
        match self {
            Side::Positive => Side::Negative,
            Side::Negative => Side::Positive,
        }
    }

    /// The side of `line` that `p` lies on; none within the tolerance of it.
    pub fn of_point(line: &Line, p: Point) -> Option<Side> {
        let d = line.signed_distance(p);
        if d > crate::numerics::TOL {
            Some(Side::Positive)
        } else if d < -crate::numerics::TOL {
            Some(Side::Negative)
        } else {
            None
        }
    }
}

/// A flap: a connected part of the moving side, joined across creases with an
/// end on the moving side (the closure's adjacency rule, plan D3). A hinge on
/// the fold line separates two flaps.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Flap {
    /// Its faces, ascending.
    pub faces: Vec<FaceId>,
    /// An interior sheet point of one of its faces whose image is on the
    /// moving side: what a seed or a stored choice names it by.
    pub witness: Point,
}

/// A remedy the engine can offer with a refusal (plan D14).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "fix")]
pub enum Fix {
    /// Include these flaps, which the closure would move anyway.
    IncludeFlaps { flaps: Vec<usize> },
    /// The same fold the other way is valid.
    OppositeDirection,
    /// Everything would move: pick one of these flaps to fold.
    PickFlap { flaps: Vec<Flap> },
    /// Fold along this landmark line instead, with the same moving side.
    UseLine { line: Line, side: Side },
    /// The same reverse fold, or crimp, of the other kind is valid (plan
    /// D14).
    OtherKind { kind: ReverseKind },
    /// The same tuck against this layer instead is valid: its face, and the
    /// sheet point that names it.
    TuckTarget { face: FaceId, at: Point },
    /// The same rabbit ear or swivel with this emergent ray (a direction in
    /// the parent's model frame) lands; for a swivel by its edge, the same
    /// swivel with this ridge, its other far crease (its `ridge`).
    UseEmergent { direction: Point },
    /// The same point sinks the other way: closed where an open sink is
    /// refused, open where a closed one is.
    OtherSink { kind: SinkKind },
}

/// A refused operation and what could be done instead.
#[derive(Debug, Clone, PartialEq, Serialize, Error)]
#[error("{refusal}")]
pub struct Refused {
    pub refusal: FoldRefusal,
    pub fixes: Vec<Fix>,
}

impl From<FoldRefusal> for Refused {
    fn from(refusal: FoldRefusal) -> Refused {
        Refused {
            refusal,
            fixes: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_snake_case_and_name_their_faces() {
        let r = FoldRefusal::Sliver {
            vertex: VertexId(4),
            face: FaceId(9),
            penetration: 1e-4,
        };
        assert_eq!(r.code(), "sliver");
        assert_eq!(r.faces(), vec![FaceId(9)]);
        assert_eq!(r.vertices(), vec![VertexId(4)]);
    }

    #[test]
    fn the_serialized_tag_is_the_code() {
        let refusals = [
            FoldRefusal::NothingStays,
            FoldRefusal::SheetNotConvex,
            FoldRefusal::NearMiss {
                vertex: VertexId(1),
                distance: 1e-4,
                cause: NearMissCause::Band,
            },
            FoldRefusal::ClosureAddsFlaps { added: vec![2] },
            FoldRefusal::LayerOrder {
                violations: Vec::new(),
            },
        ];
        for r in refusals {
            let json = serde_json::to_value(&r).unwrap_or_default();
            assert_eq!(json["code"], r.code(), "{json}");
        }
    }

    #[test]
    fn side_of_point_respects_the_tolerance() {
        let Some(line) = Line::new([1.0, 0.0], 0.5) else {
            unreachable!()
        };
        assert_eq!(Side::of_point(&line, [0.9, 0.0]), Some(Side::Positive));
        assert_eq!(Side::of_point(&line, [0.1, 0.0]), Some(Side::Negative));
        assert_eq!(Side::of_point(&line, [0.5 + 1e-7, 0.0]), None);
        assert_eq!(Side::Positive.opposite(), Side::Negative);
    }
}
