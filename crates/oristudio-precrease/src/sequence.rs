//! The wire shape of a plan: `Step`, groups, totals, status, findings and
//! diagnostics — the contract in
//! `implementation-plans/reference-finder-integration.md`
//! ("Contracts an implementer needs"). Everything here serialises with
//! `serde` to plain JSON; the wasm bridge emits it `json_compatible`.

use serde::{Deserialize, Serialize};

use crate::closure::ClosureStats;
use crate::direction::{Direction, Side};
use crate::exactness::ExactnessClass;
use crate::line::Line;
use crate::pinch::Extent;
use crate::predicates::Witness;
use crate::sheet::Sheet;
use crate::state::LineTag;

/// A step folds a CP line or an auxiliary one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepKind {
    Cp,
    Aux,
}

/// One fold in the presentation order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Step {
    /// 1-based position in the presentation order.
    pub id: u32,
    pub kind: StepKind,
    /// `aux` or `rf_aux` for auxiliary steps, `cp` for CP steps.
    pub tag: LineTag,
    pub line: Line,
    /// State line id (what `Ref::Line { id }` in witnesses points at).
    pub line_id: usize,
    /// The in-paper segment of the line, for drawing.
    pub segment: [[f64; 2]; 2],
    pub extent: Extent,
    /// Every certified witness recorded at fold time.
    pub witnesses: Vec<Witness>,
    /// Index of the presentation witness in `witnesses`.
    pub chosen: Option<usize>,
    /// Ease penalty of the chosen witness.
    pub ease: u8,
    /// The chosen witness trips a legibility rule.
    pub hard: bool,
    /// Certificate residual of the chosen witness.
    pub err: f64,
    /// Which way this crease is made — **resolved**, so a step never carries
    /// two directions (plan decision D20). `Unassigned` for an auxiliary line,
    /// which the finished pattern does not assign either way.
    pub direction: Direction,
    /// The share of this line's creased length that `direction` gets right, in
    /// `[0, 1]`. Below 1 the line reverses in part when the model collapses;
    /// `0.0` when `direction` is `Unassigned`.
    pub direction_share: f64,
    /// The face of the sheet this fold is made from. Changes between
    /// consecutive steps are where the folder turns the paper over.
    pub side: Side,
    /// For an auxiliary step, the ids of the CP steps whose chosen witness
    /// uses this line (directly or through a mark on it).
    pub unlocks: Vec<u32>,
    /// The editor's 1-based crease ids this step realises.
    pub cp_line_ids: Vec<u32>,
    /// Where those creases are on the fold's chord, parallel to `cp_line_ids`.
    ///
    /// The fold crosses the whole sheet; the pattern usually wants only part of
    /// it, and a diagram that draws the full chord tells the folder to crease
    /// more than the pattern asks for. Empty for an auxiliary step, whose own
    /// [`Extent`] already says how much of it is pressed.
    pub cp_spans: Vec<[[f64; 2]; 2]>,
    /// An auxiliary crease that stays full-length after the pinch pass.
    pub visible: bool,
    /// The lander tier was evaluated when the witnesses were recorded.
    pub witnesses_complete: bool,
    /// Every mark the presentation witness sights is on the paper.
    ///
    /// A fold runs the width of the sheet, but the pattern usually wants only
    /// part of it, so the crossing of two *chords* need not be a crease
    /// crossing. When this is false the step is still correct, but the folder
    /// has to be told to make the mark rather than shown where it already is.
    pub marks_exist: bool,
    /// Where the marks this step sights but cannot find actually are, in the
    /// planner's unit frame. Empty exactly when `marks_exist`.
    ///
    /// `marks_exist` alone says a step is unperformable and leaves nothing to
    /// do about it. These are the coordinates a driver hands to ReferenceFinder
    /// to get a construction for each one, so the plan can gain the fold that
    /// puts the mark on the paper instead of the card asking for a point that
    /// is not there.
    #[serde(default)]
    pub missing_marks: Vec<[f64; 2]>,
    /// Hoisted to phase 0 by `landmarks_first`.
    pub hoisted: bool,
}

/// Consecutive steps of one side, direction, axiom and input pattern.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Group {
    pub kind: StepKind,
    /// The face the group is folded from. A sweep split into two side-blocks
    /// never merges across the turn-over between them.
    pub side: Side,
    /// Normal angle of the direction cluster, radians in `[0, π)`.
    pub direction_angle: f64,
    pub axiom: u8,
    /// `"O2:cp"`-style pattern: axiom and input kinds (`e` edge, `c`
    /// corner, `l` line, `p` point), `!` when the steps are hard.
    pub pattern: String,
    pub step_ids: Vec<u32>,
    pub count: u32,
}

/// Counts for the summary strip: "N folds = M creases + K auxiliary (J
/// visible)", never "minimum".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Totals {
    pub folds: u32,
    pub cp_lines: u32,
    pub aux: u32,
    pub visible_aux: u32,
    /// The exact lower bound within the flat-sheet model: distinct CP lines
    /// off the outline.
    pub lower_bound: u32,
    /// CP lines coinciding with the sheet outline (free).
    pub free_lines: u32,
    /// CP lines not yet folded.
    pub unsolved: u32,
}

/// The plan's status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Complete,
    PartialUnsolved,
    PartialOffLattice,
    RefusedSheet,
    InvalidInput,
}

/// Why a line is reported instead of folded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingReason {
    /// No construction found within the search budget.
    Unsolved,
    /// The component is off-lattice; the line is reported, never folded.
    OffLattice,
}

/// A summary of the raw facts about a remaining line, for `explain`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct FactsSummary {
    pub points_on: usize,
    pub perpendiculars: usize,
    pub o2_pairs: usize,
    pub o3_pairs: usize,
    pub landers: usize,
    pub landers_computed: bool,
}

/// A CP line the plan does not fold.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    pub line: Line,
    pub segment: Option<[[f64; 2]; 2]>,
    pub cp_line_ids: Vec<u32>,
    pub reason: FindingReason,
    pub facts: FactsSummary,
}

/// A point of `P` referenced by some witness.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PointEntry {
    pub id: usize,
    pub p: [f64; 2],
    /// State ids of the lines through it.
    pub lines: Vec<usize>,
    pub on_boundary: bool,
}

/// A state line, so `Ref::Line { id }` resolves to a step.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LineEntry {
    pub id: usize,
    pub tag: LineTag,
    /// The step that folds it (`None` for edges).
    pub step: Option<u32>,
}

/// What the exactness policy did.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExactnessSummary {
    pub class: ExactnessClass,
    /// The snap family used (snappable / off-lattice).
    pub family: Option<String>,
    pub max_displacement_unit: f64,
    pub max_displacement_model: f64,
    pub off_lattice_lines: u32,
    pub off_lattice_vertices: u32,
}

/// Counters and budget outcomes.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Diagnostics {
    pub closure: ClosureStats,
    pub stuck_events: u32,
    pub candidates_evaluated: u64,
    pub closures_run: u64,
    pub points: usize,
    pub lines: usize,
    pub elapsed_ms: f64,
    /// A `close` or search call stopped on its deadline at some point.
    pub budget_hit: bool,
    pub point_cap_hit: bool,
    /// The deepest search depth any stuck event reached.
    pub max_depth_searched: u8,
    /// Every stuck event's search was exhausted to its depth.
    pub search_exhausted: bool,
    /// Steps whose witness set lacks the lander tier.
    pub witnesses_incomplete_steps: u32,
    /// Externally supplied (ReferenceFinder) lines folded.
    pub rf_lines_folded: u32,
}

/// The whole plan.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sequence {
    pub status: Status,
    /// `"best_found_to_depth_<d>"` when every stuck event's search was
    /// exhausted to depth `d` (0 when there was none), else `"heuristic"`.
    pub certification: String,
    pub sheet: Sheet,
    pub landmarks_first: bool,
    pub steps: Vec<Step>,
    pub groups: Vec<Group>,
    pub totals: Totals,
    pub findings: Vec<Finding>,
    pub points: Vec<PointEntry>,
    pub lines: Vec<LineEntry>,
    pub exactness: Option<ExactnessSummary>,
    pub diagnostics: Diagnostics,
}
