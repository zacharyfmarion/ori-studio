//! The wire shape of a plan: `Step`, groups, totals, status, findings and
//! diagnostics — the contract in
//! `implementation-plans/reference-finder-integration.md`
//! ("Contracts an implementer needs"). Everything here serialises with
//! `serde` to plain JSON; the wasm bridge emits it `json_compatible`.

use serde::{Deserialize, Serialize};

use crate::closure::ClosureStats;
use crate::direction::{Direction, Side};
use crate::exactness::ExactnessClass;
use crate::grid::GridKind;
use crate::line::Line;
use crate::pinch::Extent;
use crate::predicates::{Ref, Witness};
use crate::sheet::{EdgeSide, Sheet};
use crate::state::{LineTag, State};

/// Whether a witness uses only exact lines and intersections of exact lines.
/// Shared by wire emission and the scheduling acceptance gate.
pub(crate) fn witness_is_exact(state: &State, exact_lines: &[bool], w: &Witness) -> bool {
    w.inputs.iter().all(|r| match r {
        Ref::Line { id } => exact_lines[*id],
        Ref::Point { id } => state
            .points()
            .get(*id)
            .is_some_and(|pt| pt.lines.iter().filter(|&&l| exact_lines[l]).count() >= 2),
        Ref::Edge { .. } | Ref::Corner { .. } => true,
    })
}

/// A step folds a CP line or an auxiliary one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepKind {
    /// Realises crease the pattern contains, on a new line.
    Cp,
    /// A new auxiliary line the pattern does not contain.
    Aux,
    /// More crease on a line already made, to put a reference mark on the
    /// paper where a later step needs one. Not a fold: the folder refolds
    /// along a crease that is already there and presses a little further.
    Press,
    /// One family of the precrease grid, pleated edge to edge, alternating
    /// mountain and valley. Many lines in one step; `Step::grid` lists them.
    Grid,
}

/// One line of a [`StepKind::Grid`] step.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GridStepLine {
    /// State line id.
    pub line_id: usize,
    pub line: Line,
    /// The in-paper segment, for drawing.
    pub segment: [[f64; 2]; 2],
    /// Where along the chord the line is creased, when not edge to edge: a
    /// band's extent, and anything a later step needed of it past that.
    /// Empty for a line creased along its whole chord. Every one of
    /// `cp_spans` lies within these.
    #[serde(default)]
    pub spans: Vec<[[f64; 2]; 2]>,
    /// Position in the family: the line is `n · p = phase + index · spacing`.
    pub index: i32,
    /// The direction the pleat gives it, read from the front.
    pub direction: Direction,
    /// The pattern's own direction for it: `Unassigned` when the pattern does
    /// not contain the line, or assigns it nothing.
    pub pattern_direction: Direction,
    /// The share of the line's creased length `pattern_direction` covers, in
    /// `[0, 1]`; `0` when the pattern does not contain the line. Below 1 the
    /// pattern creases the line both ways, whichever way it is pleated — the
    /// same fact `Step::direction_share` states for a step of its own.
    pub pattern_share: f64,
    /// The editor's 1-based crease ids on this line; empty when the pattern
    /// does not contain it.
    pub cp_line_ids: Vec<u32>,
    /// Where those creases are on the line, parallel to `cp_line_ids`.
    pub cp_spans: Vec<[[f64; 2]; 2]>,
}

/// A line a band of grid lines is bounded by, or the sheet's edge there.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GridBound {
    /// The family index of the bounding line: `0` or the family's cells for
    /// the sheet's edge.
    pub index: i32,
    /// Where it is across the sheet, as a share of the side the family
    /// crosses: `index / cells`.
    pub fraction: f64,
    /// Which edge of the sheet, when the bound is the edge rather than a
    /// line of the family.
    pub edge: Option<EdgeSide>,
    /// State line id of the bounding line, when it is a line — always one
    /// an earlier grid step made, so the folder can see it.
    pub line_id: Option<usize>,
}

/// A band of a [`GridStep`] that is not a pleat: a run of the level's lines
/// between two coarser lines the folder can see.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GridRegion {
    pub bounds: [GridBound; 2],
    /// How many of the step's lines lie in the band.
    pub lines: u32,
    /// How far along its lines the band is creased, as shares of the chord
    /// from `segment[0]` to `segment[1]`, when not edge to edge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extent: Option<[f64; 2]>,
    /// What the extent ends on — a whole pleat line of another family, or
    /// the sheet's edge — when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub along: Option<[GridBound; 2]>,
}

/// What a [`StepKind::Grid`] step pleats.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GridStep {
    pub kind: GridKind,
    /// Index of this family in the grid.
    pub family: usize,
    /// Cells across the side the grid is anchored to.
    pub n: u32,
    /// The family's unit normal.
    pub normal: [f64; 2],
    /// Distance between adjacent lines.
    pub spacing: f64,
    /// How many strips the family cuts the sheet into, when that is a whole
    /// number. For a pleat, what it pleats into — "pleat into 16ths": the
    /// finest level the pleat makes. `None` for an oblique family, or one
    /// whose spacing does not divide the side it crosses; the card then
    /// counts the lines instead.
    pub cells: Option<u32>,
    /// The halving level the step makes, as its cells across the side: a
    /// pleat's finest level, or a band step's level — "the 32nds". `0` for
    /// an oblique family.
    pub level: u32,
    /// Pleated edge to edge, every line of the level and of every coarser
    /// level of the family, in one step. Otherwise the step makes its level's
    /// lines in `regions` only.
    pub pleat: bool,
    /// The bands a step that is not a pleat makes its lines in, ascending.
    #[serde(default)]
    pub regions: Vec<GridRegion>,
    /// Every line the step makes, by ascending index.
    pub lines: Vec<GridStepLine>,
    /// How many of them the pattern contains.
    pub in_pattern: u32,
    /// How many of those the pattern wants the other way: they reverse as
    /// the model collapses.
    pub reversed: u32,
}

/// The grid a plan opens with, for the summary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GridSummary {
    pub kind: GridKind,
    pub n: u32,
    /// Families the grid makes lines of.
    pub families: u32,
    /// Grid steps: the pleats and the band steps.
    pub steps: u32,
    /// Lines made, over every family.
    pub lines: u32,
    /// Of those, lines the pattern contains.
    pub cp_lines: u32,
}

/// What a [`StepKind::Press`] step is for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StepPress {
    /// Where on the paper the press is for, in the planner's unit frame.
    pub at: [f64; 2],
    /// The state point being made, when the press is for a mark. A press that
    /// carries a line out to where a fold uses it has none.
    pub point: Option<usize>,
    /// The already-creased line the press is located by — the pinch goes
    /// where that crease crosses this step's line. `None` for a press that
    /// runs to a findable end and needs no sighting.
    pub sighted_from: Option<usize>,
}

fn default_true() -> bool {
    true
}

/// Which criterion of the card key the pick won on, when it was not a way
/// the reader might prefer (`order::ways`). In the key's order; `Accuracy`
/// is its numbers and the three-times-as-accurate override, and `Plan` a
/// way the key prefers that the plan passed over for the sequence as a
/// whole — a re-pick to vouch for a pinch, the optimiser, a twin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Criterion {
    CornerToCorner,
    Overlong,
    Visible,
    Precise,
    Local,
    Crossing,
    OneMotion,
    Ease,
    ThinFlap,
    Accuracy,
    Plan,
}

/// Another construction of a step's crease — from the paper as it stands
/// when the step is reached, leaving the paper as the plan has it, so the
/// reader can take it in place of the pick and nothing else in the sequence
/// changes (`order::ways`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Way {
    /// The construction.
    pub witness: Witness,
    /// Its own mirror alignment of the same fold, as `Step::also`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub also: Option<Witness>,
    /// As `Step::alignment`, for this way.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment: Option<f64>,
    /// What kind of fold it is (`order::ways::kind`): `O2:cp` for a corner
    /// onto a mark.
    pub kind: String,
    /// Why the pick is not this way; absent for the pick itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_by: Option<Criterion>,
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
    /// Everything the presentation witness sights is on the paper: every mark
    /// it names, and, for each crease it lines up with a crease, some overlap
    /// to line up.
    ///
    /// A fold runs the width of the sheet, but the pattern usually wants only
    /// part of it, so the crossing of two *chords* need not be a crease
    /// crossing, and a crease that stops at the fold has nothing across it to
    /// land on. When this is false the step is still correct, but the folder
    /// has to be told what is missing rather than shown where it already is.
    pub marks_exist: bool,
    /// Where the marks this step sights but cannot find actually are, in the
    /// planner's unit frame. Never non-empty when `marks_exist`; empty when
    /// it is false and the marks are there but no crease lines up.
    ///
    /// `marks_exist` alone says a step is unperformable and leaves nothing to
    /// do about it. These are the coordinates a driver hands to ReferenceFinder
    /// to get a construction for each one, so the plan can gain the fold that
    /// puts the mark on the paper instead of the card asking for a point that
    /// is not there.
    #[serde(default)]
    pub missing_marks: Vec<[f64; 2]>,
    /// Present exactly when `kind` is [`StepKind::Press`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub press: Option<StepPress>,
    /// A second witness of the same fold: the mirror image of the presented
    /// one about the sheet's centre line, sightable as the paper stands. Two
    /// alignments a sheet apart keep a long fold straight where one does
    /// not, so the card shows both — a second arrow, its own letters — and
    /// the sentence names both. Absent for most steps.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub also: Option<Witness>,
    /// The presented fold lines an interior point up on another — a fold the
    /// folder makes by sighting through the paper — and nothing else was on
    /// offer. The card says so.
    #[serde(default)]
    pub impractical: bool,
    /// Present exactly when `kind` is [`StepKind::Grid`]. The step's own
    /// `line`, `line_id` and `segment` are then the family's first line, so
    /// that a step always has one; the family is here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid: Option<GridStep>,
    /// The shortest stretch over which this step lines a crease up with a
    /// crease, in sheet units; absent when it lines up none. Below
    /// `marks::MIN_ALIGNMENT` — a pinch's length — the fold can be made but
    /// not precisely: a fold 0.02 from the sheet's edge lines up 0.04 of
    /// edge whatever is pressed, and the card should say to take care.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment: Option<f64>,
    /// For a line folded by the closest construction there was rather than
    /// an exact one: how far that construction lands from the pattern's line,
    /// in sheet units. Absent for a fold made exactly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approximation: Option<f64>,
    /// Whether this step is exact: made by an exact construction, from
    /// references that are themselves exact. False for a fold with an
    /// `approximation`, and for any fold sighted from an approximate crease,
    /// or from a mark that fewer than two exact creases pass through — the
    /// error does not go away by being inherited, and the card says so.
    #[serde(default = "default_true")]
    pub exact: bool,
    /// Crease this step makes past what the pattern asks for, as spans on its
    /// line in the planner's unit frame, because a later step uses the line
    /// there: a stretch a later step lines up against, whose far end is
    /// somewhere the folder can find at this point; or a pinch — a span a
    /// pinch long — at a crossing with a crease already there, for a mark a
    /// later step is sighted at. Rather than a press of its own, the folder
    /// makes it now, while the fold is being made. Empty for most steps.
    #[serde(default)]
    pub pressed_on: Vec<[[f64; 2]; 2]>,
    /// The crease this step leaves on its line, in the planner's unit frame:
    /// the pattern's pieces, each end carried outward to the nearest
    /// reference it can stop at — the sheet's edge, or a crease already
    /// there — and merged where they meet, so the folder is never told to
    /// stop on blank paper and never creases further than the nearest
    /// reference asks. Every one of `cp_spans` lies within them; the rest is
    /// crease the pattern does not contain, made so the fold can be made as
    /// a diagram would instruct it. Planned with the reach off, the
    /// pattern's own runs. Empty for an auxiliary step, a press, and a CP
    /// line creased along its whole chord, whose `extent` says how much of
    /// it is made.
    #[serde(default)]
    pub made: Vec<[[f64; 2]; 2]>,
    /// Hoisted to phase 0 by `landmarks_first`.
    pub hoisted: bool,
    /// The number the folder sees, 1-based in presentation order — shared
    /// by the two steps of a twin pair, which the card shows as one; every
    /// other step's own.
    #[serde(default)]
    pub card: u32,
    /// The `id` of the step made at once with this one: its mirror image
    /// about a symmetry of the sheet, line and witness alike, placed next
    /// to it. A diagram folds such a pair as one step, and so does the card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub twin: Option<u32>,
    /// The ways the reader can make this step instead, the presented witness
    /// first, one of each kind; empty unless there are at least two. A press
    /// that presents its fold's witness carries the fold's; a twin pair's two
    /// lists are index-aligned mirrors, switched together.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ways: Vec<Way>,
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
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Totals {
    /// Every crease made: CP lines, auxiliary folds and the grid's lines the
    /// pattern does not contain. A press is not a fold and is not here.
    pub folds: u32,
    /// CP lines realised, by a step of their own or by a grid step.
    pub cp_lines: u32,
    /// Auxiliary folds from the search or ReferenceFinder — not grid lines.
    pub aux: u32,
    pub visible_aux: u32,
    /// Lines of the precrease grid, over every family, the pattern's and the
    /// grid's own alike.
    #[serde(default)]
    pub grid_lines: u32,
    /// Of those, lines the pattern contains.
    #[serde(default)]
    pub grid_cp_lines: u32,
    /// Crease the grid's steps put on lines where the pattern has none, in
    /// sheet units: the whole chord of a grid-only line, and the stretch of
    /// a pattern line past the pattern's own creases. The number a grid made
    /// only where it is needed exists to lower.
    #[serde(default)]
    pub grid_unwanted_length: f64,
    /// Press steps: extra crease the pattern does not contain, made so a later
    /// step can be sighted. Counted apart from `aux` so "what the design asks
    /// for" and "what correctness cost" never blur.
    #[serde(default)]
    pub presses: u32,
    /// Crease the CP steps make past the pattern's own to be made from
    /// reference to reference (`Step::made` less `Step::cp_spans`), in sheet
    /// units: the blank between a line's pieces, and the stretch from the
    /// pattern's end out to the reference the crease stops at.
    #[serde(default)]
    pub reach_length: f64,
    /// The exact lower bound within the flat-sheet model: distinct CP lines
    /// off the outline.
    pub lower_bound: u32,
    /// Steps that are not exact: folded by an approximation, or sighted from
    /// one (`Step::exact`).
    #[serde(default)]
    pub approximate: u32,
    /// Cards the folder reads: every step its own, a twin pair one.
    #[serde(default)]
    pub cards: u32,
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
    /// The grid the plan opens with, when the design is pleated on one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid: Option<GridSummary>,
    pub steps: Vec<Step>,
    pub groups: Vec<Group>,
    pub totals: Totals,
    pub findings: Vec<Finding>,
    pub points: Vec<PointEntry>,
    pub lines: Vec<LineEntry>,
    pub exactness: Option<ExactnessSummary>,
    pub diagnostics: Diagnostics,
}

impl Sequence {
    /// `w`, a witness of this sequence's state, in the ids of `state` — a
    /// paper the sequence is being replayed onto: marks by where they are,
    /// creases by the line of the step that folded them, edges and corners
    /// by their own ids, which every state gives out first. `None` when
    /// something it names is not on `state` yet.
    pub fn witness_in(&self, state: &State, w: &Witness) -> Option<Witness> {
        let mut out = w.clone();
        for r in &mut out.inputs {
            *r = match *r {
                Ref::Edge { .. } | Ref::Corner { .. } => *r,
                Ref::Point { id } => Ref::Point {
                    id: state.find_point(self.points.iter().find(|p| p.id == id)?.p)?,
                },
                Ref::Line { id } => {
                    let step = self.lines.iter().find(|l| l.id == id)?.step?;
                    let line = self.steps.iter().find(|s| s.id == step)?.line;
                    Ref::Line {
                        id: state.find_line(&line)?,
                    }
                }
            };
        }
        Some(out)
    }
}
