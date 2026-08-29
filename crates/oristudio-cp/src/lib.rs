//! Oriedita-compatible crease-pattern editing kernel for Ori Studio.
//!
//! This crate is intentionally conservative while the port is in progress.
//! Every known non-UI Oriedita operation is represented in the registry, but
//! unsupported operations fail with a typed error instead of fabricating nearby
//! behavior.

pub mod cancel;
pub mod canonical;
pub mod checks;
pub mod checks_spatial;
mod crease_graph;
mod fold_graph;
pub mod fold_profiling;
pub mod folding;
pub mod folding3d;
pub mod geometry;
pub mod geometry_transport;
pub mod io;
pub mod model;
pub mod operations;
pub mod session;
pub mod share;
pub mod solve_fold_angles;
pub mod solve_k;
pub mod solve_spatial;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub use canonical::CanonicalCreasePattern;
/// The fold graph itself stays crate-private; its failure mode does not, because
/// it is carried by [`folding::FoldSetupError`] and named by a `fold_disconnected`
/// engine error the frontend branches on.
pub use fold_graph::FoldGraphError;
use geometry::{
    Circle, Epsilon, LineColor, LineSegment, Point, Polygon, RgbColor,
    determine_line_segment_distance, mid_point,
};
pub use model::CreasePatternModel;

const DEFAULT_SELECTION_DISTANCE: f64 = 1.0;
const ORIEDITA_PAPER_SIZE: f64 = 400.0;
const DEFAULT_ANGLE_SYSTEM_DIVIDER: i32 = 4;
const DEFAULT_ANGLE_SYSTEM_ANGLES: [f64; 6] = [40.0, 60.0, 80.0, 30.0, 50.0, 100.0];
const DEFAULT_LINE_DIVISION_COUNT: usize = 2;
const DEFAULT_LINE_RATIO: f64 = 1.0;
const DEFAULT_POLYGON_CORNERS: usize = 5;

/// Crate-local result type.
pub type Result<T> = std::result::Result<T, CommandError>;

/// Editable crease-pattern document state.
///
/// Stage 1 only defines the carrier type needed by the command contract.
/// Geometry, lines, circles, text, and Oriedita metadata are added by later
/// stages under the same type.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct CreasePatternDocument {
    /// Optional user-visible document title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Editable Oriedita-compatible crease-pattern model state.
    #[serde(default)]
    pub crease_pattern: CreasePatternModel,
    /// Transient Oriedita operation-frame state used by frame selection tools.
    #[serde(default)]
    pub operation_frame: operations::transform::OperationFrame,
    /// Namespaced metadata preserved before full model support lands.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl CreasePatternDocument {
    /// Return a canonical semantic view suitable for parity comparisons.
    pub fn canonical(&self, tolerance: f64) -> CanonicalCreasePattern {
        CanonicalCreasePattern::from_document(self, tolerance)
    }
}

/// A command request against a crease-pattern document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreasePatternCommand {
    /// Oriedita operation represented by this command.
    pub operation: OperationId,
    /// Resolved model-space inputs for the operation.
    #[serde(default)]
    pub payload: CreasePatternCommandPayload,
}

impl CreasePatternCommand {
    /// Create a command for an Oriedita operation.
    pub fn new(operation: OperationId) -> Self {
        Self {
            operation,
            payload: CreasePatternCommandPayload::default(),
        }
    }

    /// Attach resolved model-space inputs.
    pub fn with_payload(mut self, payload: CreasePatternCommandPayload) -> Self {
        self.payload = payload;
        self
    }
}

/// Resolved command inputs supplied by the UI after hit testing and selection.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct CreasePatternCommandPayload {
    /// One-based Oriedita line IDs resolved by the UI.
    #[serde(default)]
    pub line_ids: Vec<usize>,
    /// One-based Oriedita circle IDs resolved by the UI.
    #[serde(default)]
    pub circle_ids: Vec<usize>,
    /// One-based Oriedita text annotation IDs resolved by the UI.
    #[serde(default)]
    pub text_ids: Vec<usize>,
    /// Resolved model-space points, in the same order as the active tool steps.
    #[serde(default)]
    pub points: Vec<geometry::Point>,
    /// Optional active Oriedita line color for commands that use the current color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_color: Option<geometry::LineColor>,
    /// Fold magnitude in degrees for `CreaseSetFoldAngle`, `0..=180`.
    ///
    /// This is `|rho|`, not a signed angle: direction lives in the line colour.
    /// `Some(180.0)` and `None` both mean a classic crease.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fold_magnitude_degrees: Option<f64>,
    /// Optional model-space hit tolerance for point/line tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_distance: Option<f64>,
    /// Optional model-space tolerance for closing `FlatFoldableCheck`'s boundary
    /// loop. Absent means `Epsilon::UNKNOWN_1EN4` (which is `FACTOR * 1e-4`, so
    /// 1e-6 — a geometric epsilon, not a pointer radius).
    ///
    /// Upstream closes the loop at the mouse release, against the pointer radius
    /// (`MouseHandlerFlatFoldableCheck.java:68`), and a UI caller should send
    /// that same radius here: our last path sample *is* the release point, so the
    /// two tests are the same test. The field exists because we decide closure
    /// from a finished point list, which a caller with no cursor can also produce
    /// — the CLI, headless wasm, a detector import — and those must not inherit
    /// whatever radius a mouse happened to have. Stating it beats defaulting to
    /// a pointer radius seven orders of magnitude away from the epsilon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boundary_close_distance: Option<f64>,
    /// Optional override for what a kernel-side snap may land on.
    ///
    /// Oriedita gates its close-point search on grid visibility alone. Ori
    /// Studio's viewport also has a Snapping toggle, so the frontend states the
    /// effective policy here; absent means upstream — every vertex, and the
    /// grid the document itself declares.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snap_candidates: Option<model::SnapCandidates>,
    /// Optional UI-level replacement selection mode. Oriedita's primitive
    /// select operations are additive by default; callers set this when a
    /// normal click/box selection should replace the previous selected set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replace_selection: Option<bool>,
    /// Optional active grid width for grid-spaced construction tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid_width: Option<f64>,
    /// Whether a completion candidate may end on an auxiliary line. Off unless
    /// stated, because auxiliary lines are construction guides rather than
    /// creases; see `solve_spatial::CandidateStopTargets`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_on_auxiliary: Option<bool>,
    /// Optional active angle-system divider. Oriedita's default divider is 4.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angle_system_divider: Option<i32>,
    /// Optional custom angle-system values used when the divider is zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angles: Option<[f64; 6]>,
    /// Optional zero-based construction candidate selected by the UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_index: Option<usize>,
    /// Optional division count for line division tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub division_count: Option<usize>,
    /// Optional first ratio value for ratio division tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ratio_s: Option<f64>,
    /// Optional second ratio value for ratio division tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ratio_t: Option<f64>,
    /// Optional model-space width for parallel-width construction tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    /// Optional source custom line type for replace-type commands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_from_line_type: Option<model::CustomLineType>,
    /// Optional destination custom line type for replace-type commands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_to_line_type: Option<model::CustomLineType>,
    /// Optional custom line type for delete-type commands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_line_type: Option<model::CustomLineType>,
    /// Optional precision percentage for fix-inaccurate commands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fix_precision: Option<f64>,
    /// Fold angles the user has fixed by hand during a propagation draft, as
    /// `(one-based line id, signed degrees)` — the same id space as `line_ids`,
    /// and the same the preview hands back in
    /// [`CommandPreview::propagation_creases`].
    ///
    /// These are the draft's real input. Propagation treats them as known before
    /// its first solve and never re-derives them, which is what lets the user
    /// adjust one crease and re-run without the answer sliding back. A pin is
    /// therefore normally an id read straight out of the previous preview, which
    /// is why it must be the same base: the round trip is the loop.
    ///
    /// The same id twice is not an error — the last value wins — but it is
    /// reported once, so the draft's crease list stays a set.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pinned_angles: Vec<(usize, f64)>,
    /// Discard the mountain/valley direction as well when unassigning.
    ///
    /// Absent or `false` keeps it, because that is the common intent and the
    /// one the fold-angle chip performs; a hint is what lets the solver settle
    /// the mountain/valley question closure cannot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forget_direction: Option<bool>,
    /// What [`OperationId::CreaseSetDirectionHint`] writes to each selected
    /// unassigned crease. Required by that operation, ignored by every other.
    ///
    /// Spelled as a three-state change rather than an `Option<FoldDirection>`
    /// so that "clear the hint" and "the client forgot the field" are different
    /// messages on the wire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction_hint: Option<operations::native::direction_hint::DirectionHintChange>,
    /// Largest number of unknowns at a vertex a propagation commit may come
    /// from. `None` uses
    /// [`operations::native::fold_propagation::DEFAULT_MAX_COMMIT_K`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_commit_k: Option<usize>,
    /// Optional toggle for BP fix-inaccurate targets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fix_precision_use_bp: Option<bool>,
    /// Optional toggle for 22.5-degree fix-inaccurate targets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fix_precision_use_22_5: Option<bool>,
    /// Optional number of corners for regular polygon generator commands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub polygon_corners: Option<usize>,
    // --- Ori Studio native -------------------------------------------------
    /// Model-space bounding extent for `SquareGenerate`. The frontend owns the
    /// unit the user typed (grid cells or paper edges) and converts, exactly as
    /// it does for `width`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub square_extent: Option<f64>,
    /// Which way the generated square sits. Defaults to `Normal`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub square_orientation: Option<operations::native::square::SquareOrientation>,
    /// Where on the square's bounding box `points[0]` lands. Defaults to `TopLeft`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub square_anchor: Option<operations::native::square::SquareAnchor>,
    /// Optional custom color for circle and auxiliary-line recoloring commands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_circle_color: Option<geometry::RgbColor>,
    /// Optional text-annotation command action.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_action: Option<TextCommandAction>,
    /// Optional text content used by text creation and editing commands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_content: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TextCommandAction {
    Create,
    /// Append a text annotation at a point unconditionally.
    ///
    /// Unlike [`TextCommandAction::Create`] (which mirrors Oriedita's
    /// press-to-select-or-create semantics and no-ops when the point lands within
    /// an existing text's identity-camera bounds), this always creates. The web
    /// frontend hit-tests against the rendered DOM glyph bounds and is the sole
    /// authority on whether a click is "empty space", so the engine must not
    /// re-decide with its `FontMetrics`-less 25x3 model-space box.
    CreateAt,
    Move,
    SetContent,
    DeleteSelected,
    DeleteAt,
    DeleteBox,
}

/// Result returned by a successfully executed command.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandResult {
    /// Oriedita operation that was executed.
    pub operation: OperationId,
    /// Implementation status after execution.
    pub status: OperationStatus,
    /// Human-readable diagnostics emitted by the command.
    pub diagnostics: Vec<String>,
    /// Structured diagnostic markers emitted by non-mutating check commands.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostic_entries: Vec<CommandDiagnostic>,
    /// How many vertices a foldability check produced an answer for.
    ///
    /// `None` on every command that does not check vertices, so nothing else
    /// changes shape. Zero is not the same as "clean": it means the check
    /// affirmed nothing at all, which is what `known-good/airplane.fold` — every
    /// vertex on the paper edge — has always displayed as success.
    ///
    /// Carried beside `diagnostic_entries` rather than inside them because it is
    /// not a finding. It is the count the *absence* of findings is about, and
    /// there is no vertex to attach it to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_vertices: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandDiagnostic {
    pub id: String,
    pub kind: String,
    pub severity: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub point: Option<geometry::Point>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub segments: Vec<geometry::LineSegment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule: Option<String>,
    /// How far a spatial vertex is from closing, in degrees.
    ///
    /// Carried structurally rather than only inside `message`, because the
    /// sentence around it has to be translated and a Rust string literal cannot
    /// reach the eight-locale gate. `None` on every diagnostic that is not a
    /// closure failure, and skipped when serializing, so an all-classic
    /// `CheckCamv` result is byte-identical to what it was before this existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub residual_degrees: Option<f64>,
    /// The signed fold angle that would close an undecided vertex, in degrees —
    /// negative a mountain, matching every other fold angle the app displays.
    ///
    /// Deliberately **not** `residual_degrees`: one is how far a vertex is from
    /// closing and the other is a value to set, and a reader that cannot tell
    /// them apart would offer the user a number to type in that is the size of
    /// their mistake. Present only when exactly one angle closes the vertex;
    /// with a branch there is more than one answer and naming one of them would
    /// be a choice the app is not entitled to make.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fold_angle_degrees: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub violation_color: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub big_little_big: Vec<CommandDiagnosticBigLittleBigSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandDiagnosticBigLittleBigSegment {
    pub segment: geometry::LineSegment,
    pub violating: bool,
}

/// Transient candidate geometry for active construction tools.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct CommandPreview {
    /// Candidate, guide, or would-be committed line segments.
    pub segments: Vec<geometry::LineSegment>,
    /// Candidate, guide, or would-be committed circles.
    pub circles: Vec<geometry::Circle>,
    /// Candidate commit points, such as angle-restricted convergence points.
    pub points: Vec<geometry::Point>,
    /// Non-mutating measurement value (length or angle) for the measure tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measurement: Option<f64>,
    /// Human-readable diagnostics emitted by the preview query.
    pub diagnostics: Vec<String>,
    /// Why the active tool cannot act on the input so far, as a stable code the
    /// frontend turns into a sentence.
    ///
    /// Distinct from `diagnostics` on purpose: this is an *expected* answer
    /// ("no single crease closes this vertex"), not a complaint, and it has to
    /// survive translation, so it is a code rather than English.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unavailable: Option<String>,
    /// How many *isolated* solutions the active tool found, when it enumerates
    /// solutions at all.
    ///
    /// Only the isolated ones are counted, so a "2 of 3" readout means what it
    /// says. A rank-deficient triple has a continuous family of answers rather
    /// than a set of them, and putting a number on infinity would be a fiction —
    /// `candidate_is_family` marks that case instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_count: Option<usize>,
    /// Whether the previewed solution is one arbitrary member of a continuous
    /// family rather than a branch in its own right.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_is_family: Option<bool>,
    /// Whether the previewed solution is the state the document is already in,
    /// so the UI can say "this is what you have" rather than offering it as a
    /// change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_is_current: Option<bool>,
    /// Whether the previewed solution folds a crease against a direction the
    /// user marked on it.
    ///
    /// Applying replaces that hint with the opposite direction and there is no
    /// second chance to notice, so the surface has to say so first. It is a
    /// warning and never a refusal: see `AngleSolution::contradicts_hint` for
    /// why a hint does not get to veto a real answer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_contradicts_hint: Option<bool>,
    /// Whether the previewed solution leaves one of the picked creases
    /// undecided.
    ///
    /// The answer for it is zero, which names no direction, so the write has
    /// nothing to store on a crease that has none either — see
    /// `AngleSolution::leaves_undecided`. The preview segments already show it
    /// staying dashed, and this is what lets the tool *say* so: "one of your
    /// three does not move" is the thing a user is entitled to read before
    /// applying rather than work out from the canvas afterwards.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_leaves_undecided: Option<bool>,
    /// How many creases a propagation draft worked out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub propagation_solved: Option<usize>,
    /// How many creases are still free after the draft.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub propagation_free: Option<usize>,
    /// The creases the draft would set, and what it would set them to.
    ///
    /// Index-aligned with the entries this preview appends to `segments`, and
    /// pushed from the same loop so the two cannot drift. That alignment is the
    /// whole point: it is what lets a caller say *which document creases* the
    /// draft stands in for, and therefore stop drawing them, instead of painting
    /// the answer on top of the originals. `propagation_solved` is only a count
    /// and `segments` carries no identity, so before this existed a surface had
    /// no way to tell the two apart.
    ///
    /// The same discipline `VertexSolveFoldAngles` keeps for its pick order, for
    /// the same reason: matching a preview segment back to a document crease by
    /// its endpoints would be comparing coordinates that had round-tripped
    /// through a serialiser.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub propagation_creases: Vec<PropagationDraftCrease>,
    /// Vertices where propagation stopped and is waiting on the user.
    ///
    /// Deliberately **not** `points`, which is documented as candidate commit
    /// points and is drawn through the overlay channel. A stall is not a commit
    /// point, and there can be hundreds of them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub propagation_stalls: Vec<PropagationStall>,
    /// Vertices that ended fully known and do not close, so something the draft
    /// rests on is inconsistent.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub propagation_conflicts: Vec<geometry::Point>,
    /// What the run was scoped to. Absent when the scope named nothing, which
    /// is the case `unavailable` reports.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub propagation_scope: Option<PropagationScope>,
}

/// The scope a propagation draft ran in, so the tool can name it.
///
/// The user got the *scope* wrong, which is why the window has to say which one
/// it used rather than leaving it to be inferred from a count.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropagationScope {
    /// `selection` | `component` | `document`, as a stable code.
    pub kind: String,
    /// Creases the scope names.
    pub creases: usize,
    /// Vertices propagation was allowed to visit.
    pub vertices: usize,
    /// Unassigned creases still inside the scope after the draft. Scope-relative
    /// — the same number as `propagation_free`, and deliberately not a document
    /// total.
    pub free: usize,
    /// Vertices skipped because some of their unknowns were outside the scope.
    /// The one finding with an action attached: widen the selection, or clear it
    /// and click the pattern.
    pub out_of_scope: usize,
}

/// One crease a propagation draft would set.
///
/// Named fields rather than a tuple because this is a wire type a caller zips
/// against `CommandPreview::segments`, and `[7, -45.0]` says nothing about which
/// number is which. `PropagationStall` already made the same choice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropagationDraftCrease {
    /// **One-based** line id — the same space `payload.line_ids` and
    /// `payload.pinned_angles` use, and *not* the zero-based index the solver
    /// works in. The conversion happens once, in the preview arm, so that no
    /// consumer has to know there are two conventions.
    ///
    /// Getting this wrong is silent: an off-by-one names a real, adjacent crease
    /// and recolours it.
    pub line_id: usize,
    /// Signed fold angle in degrees; negative is a mountain.
    pub degrees: f64,
}

/// One place a propagation draft stopped, for the tool to show.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropagationStall {
    pub point: geometry::Point,
    /// `underdetermined` | `branching` | `unsolvable` | `above_cap`, as a stable
    /// code the frontend turns into a sentence. The two the user acts on
    /// differently are `branching` ("I have a question") and everything else
    /// ("I need another angle from you"), and they must not share copy.
    pub reason: String,
    pub unknowns: usize,
}

/// What a propagation command resolved to.
enum PropagationDraft {
    /// The scope named nothing to work on. The payload carries the stable code
    /// the frontend turns into a sentence; the commit path writes nothing.
    Declined(&'static str),
    Ready(operations::native::fold_propagation::Propagation),
}

/// The draft a propagation run produces, from a command's payload.
///
/// One helper for both dispatch paths, so the preview a user confirms and the
/// commit that lands cannot disagree about what the answer was — **including
/// about the scope**, which is the whole reason scope resolution lives here
/// rather than in either arm.
///
/// # One payload states one scope
///
/// `line_ids` means "these creases"; `points[0]` means "the pattern this click
/// landed in". A caller sends **one**, because the gesture is what states the
/// scope: a click says "this component" and the Propagate-in-selection button
/// says "the selection". Sending both asks this function to guess which the
/// user meant, and it cannot — a payload carrying a click *and* a selection
/// looks identical whether the selection was made a second ago or is left over
/// from another pattern ten minutes back. It was the latter that bit: the seed
/// click landed in one pattern and a forgotten selection solved a different one,
/// with nothing on screen to say so but the window title.
///
/// A caller that sends both anyway gets the selection, the same way
/// `CreaseToggleMv` and `CreaseSelect` prioritise `line_ids` over their box.
/// Neither key means the whole document: with no selection and no seed this
/// **declines**, because "no scope means the whole canvas" is exactly the
/// behaviour scoping exists to remove. `Scope::document` stays reachable from
/// Rust tests and headless callers only.
fn propagation_draft(
    document: &CreasePatternDocument,
    command: &CreasePatternCommand,
) -> Result<PropagationDraft> {
    let max_commit_k = command
        .payload
        .max_commit_k
        .unwrap_or(operations::native::fold_propagation::DEFAULT_MAX_COMMIT_K);
    // A pin is built from a line id the *preview* handed out, so the two ends of
    // the loop have to agree about what that id means. They do, because both are
    // one-based, and this is the single place the payload's ids become the
    // solver's zero-based indices. The alternative — a payload with two
    // conventions in it — has no symptom: an unconverted pin lands on the next
    // crease along and silently recolours it.
    let pins = command
        .payload
        .pinned_angles
        .iter()
        .map(|&(line_id, degrees)| {
            line_id
                .checked_sub(1)
                .map(|index| (index, degrees))
                .ok_or_else(|| CommandError::InvalidInput {
                    operation: command.operation,
                    message: "line IDs are one-based".to_string(),
                })
        })
        .collect::<Result<Vec<_>>>()?;
    // Both id lists are validated before anything is resolved: a zero id is a
    // malformed payload, not a scope that named nothing.
    let selected = optional_line_indices(command)?;

    let model = &document.crease_pattern;
    let scope = if selected.is_empty() {
        let Some(seed) = command.payload.points.first().copied() else {
            return Ok(PropagationDraft::Declined("PropagationNoScope"));
        };
        match operations::native::fold_propagation::Scope::component_at(
            model,
            seed,
            selection_distance(command),
        ) {
            Some(scope) => scope,
            None => return Ok(PropagationDraft::Declined("PropagationNoComponentAtPoint")),
        }
    } else {
        let named: Vec<usize> = selected
            .into_iter()
            .filter(|index| *index < model.line_segments.len())
            .collect();
        let scope = operations::native::fold_propagation::Scope::creases(model, &named);
        // An id list that names nothing must **not** fall through to the whole
        // document. That silent widening is the bug this scoping fixes.
        if scope.creases_named().is_empty() {
            return Ok(PropagationDraft::Declined("PropagationNothingInScope"));
        }
        scope
    };

    Ok(PropagationDraft::Ready(
        operations::native::fold_propagation::propagate(
            model,
            &scope,
            &pins,
            max_commit_k,
            CLOSURE_RESIDUAL_BAR_DEGREES.to_radians(),
        ),
    ))
}

/// Stable code per scope kind, for a window that has to name what it worked on.
fn scope_kind_code(kind: operations::native::fold_propagation::ScopeKind) -> &'static str {
    use operations::native::fold_propagation::ScopeKind;
    match kind {
        ScopeKind::Selection => "selection",
        ScopeKind::Component => "component",
        ScopeKind::Document => "document",
    }
}

/// Stable code per stall reason. The frontend turns these into sentences, and
/// `branching` must not share copy with the rest: it means "I have a question",
/// where the others mean "I need another angle from you". `answered_flat` is a
/// third: nothing is being asked for at all, the answer just happens to be that
/// these creases do not fold.
fn stall_reason_code(reason: operations::native::fold_propagation::StallReason) -> &'static str {
    use operations::native::fold_propagation::StallReason;
    match reason {
        StallReason::Underdetermined => "underdetermined",
        StallReason::Branching => "branching",
        StallReason::Unsolvable => "unsolvable",
        StallReason::AboveCap => "above_cap",
        StallReason::OutOfScope => "out_of_scope",
        StallReason::AnsweredFlat => "answered_flat",
    }
}

/// Error returned by command dispatch.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CommandError {
    /// The operation is known but has not been ported yet.
    #[error("Oriedita operation {operation:?} is not supported yet")]
    UnsupportedOperation {
        /// Unsupported operation.
        operation: OperationId,
    },
    /// The operation is actively tracked but has no executable implementation.
    #[error("Oriedita operation {operation:?} is not implemented yet")]
    NotImplemented {
        /// Not-yet-implemented operation.
        operation: OperationId,
    },
    /// The operation received invalid input.
    #[error("invalid input for Oriedita operation {operation:?}: {message}")]
    InvalidInput {
        /// Operation receiving invalid input.
        operation: OperationId,
        /// Explanation suitable for logs or user-facing diagnostics.
        message: String,
    },
}

/// High-level implementation state for a source-mapped Oriedita operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum OperationStatus {
    /// The operation is known but not available.
    Unsupported,
    /// Implementation work has started but parity is incomplete.
    Porting,
    /// Rust unit coverage exists, but oracle coverage is incomplete.
    UnitTested,
    /// Rust behavior matches the pinned Oriedita oracle for committed fixtures.
    OracleTested,
    /// Behavior intentionally differs and is documented.
    DocumentedDifference,
    /// Swing/UI-only behavior that does not belong in this crate.
    OutOfScopeUi,
}

/// Source-map classification for an operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum OperationCategory {
    /// Non-UI kernel behavior.
    Kernel,
    /// File import/export behavior.
    Io,
    /// Handler/service source used to define command intent.
    KernelIntent,
    /// Preview-producing behavior represented as model-space candidates.
    KernelPreview,
    /// UI preview behavior that is not a kernel mutation.
    UiPreviewOnly,
    /// Swing/UI-only behavior outside this crate.
    OutOfScopeUi,
}

/// Where an operation's behavior comes from, and therefore what it owes.
///
/// The distinction was a naming convention before it was a type: an original
/// operation was marked only by someone writing `"OriStudio…"` into
/// [`OperationDescriptor::upstream`], a field documented as a *pinned Oriedita
/// source element*. Conventions rot; this does not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum OperationOrigin {
    /// Ported from Oriedita. `upstream` pins the source element and the behavior
    /// is parity-bound: change it only against `third_party/oriedita`.
    Oriedita,
    /// Ori Studio original. `upstream` names our own action; there is no upstream
    /// to be in parity with, and no oracle covers it.
    OriStudio,
}

/// Identifier for every source-mapped Oriedita non-UI operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
pub enum OperationId {
    DrawCreaseFree,
    MoveCreasePattern,
    LineSegmentDelete,
    ChangeCreaseType,
    LengthenCrease,
    SquareBisector,
    Inward,
    PerpendicularDraw,
    SymmetricDraw,
    DrawCreaseRestricted,
    DrawCreaseSymmetric,
    DrawCreaseAngleRestricted,
    DrawPoint,
    DeletePoint,
    AngleSystem,
    DrawCreaseAngleRestricted3,
    CreaseSelect,
    CreaseUnselect,
    CreaseMove,
    CreaseCopy,
    CreaseMakeMountain,
    CreaseMakeValley,
    CreaseMakeEdge,
    CreaseSetLineColor,
    CreaseSetFoldAngle,
    VertexSolveFoldAngles,
    BackgroundChangePosition,
    LineSegmentDivision,
    LineSegmentRatioSet,
    PolygonSetNoCorners,
    CreaseAdvanceType,
    CreaseMove4p,
    CreaseCopy4p,
    FishBoneDraw,
    CreaseMakeMv,
    DoubleSymmetricDraw,
    CreasesAlternateMv,
    DrawCreaseAngleRestricted5,
    VertexMakeAngularlyFlatFoldable,
    FoldableLineInput,
    ParallelDraw,
    VertexDeleteOnCrease,
    CircleDraw,
    CircleDrawThreePoint,
    CircleDrawSeparate,
    CircleDrawTangentLine,
    CircleDrawInverted,
    CircleDrawFree,
    CircleDrawConcentric,
    CircleDrawConcentricSelect,
    CircleDrawConcentricTwoCircleSelect,
    ParallelDrawWidth,
    ContinuousSymmetricDraw,
    DisplayLengthBetweenPoints1,
    DisplayLengthBetweenPoints2,
    DisplayAngleBetweenThreePoints1,
    DisplayAngleBetweenThreePoints2,
    DisplayAngleBetweenThreePoints3,
    CreaseToggleMv,
    CircleChangeColor,
    CreaseMakeAux,
    CreaseMakeUnassigned,
    CreaseSetDirectionHint,
    PropagateFoldAngles,
    OperationFrameCreate,
    VoronoiCreate,
    FlatFoldableCheck,
    CreaseDeleteOverlapping,
    CreaseDeleteIntersecting,
    SelectPolygon,
    UnselectPolygon,
    SelectLineIntersecting,
    UnselectLineIntersecting,
    LengthenCreaseSameColor,
    FoldableLineDraw,
    ReplaceLineTypeSelect,
    DeleteLineTypeSelect,
    SelectLasso,
    UnselectLasso,
    Text,
    DrawBlintz,
    DrawFishBase,
    DrawDoveBase,
    DrawBirdBase,
    DrawFrogBase,
    ModifyCalculatedShape,
    MoveCalculatedShape,
    ChangeStandardFace,
    AddFoldingConstraint,
    Axiom5,
    Axiom7,
    FixInaccurate,
    ImportCp,
    ExportCp,
    ImportFold,
    ExportFold,
    ImportOri,
    ExportOri,
    ImportOrh,
    ExportOrh,
    ImportObj,
    ExportDxf,
    SaveConvert,
    SaveVersionDetect,
    CheckCamv,
    FoldingEstimate,
    FoldingEstimateSpecific,
    FoldingEstimateSave100,
    TwoColoredCp,
    Fold,
    FoldAnother,
    DuplicateFoldedModel,
    FoldedFigureSetModel,
    FoldedFigureSetDisplayStyle,
    FoldedFigureSetState,
    FoldedFigureSetStartingFace,
    FoldedFigureMoveCamera,
    FoldedFigureSelectCanvasPoint,
    FoldedFigureRenderSnapshot,
    FoldedFigureImportFoldFrame,
    FoldedFigureExportFoldFrames,
    Check1,
    Check2,
    Check3,
    Check4,
    Fix1,
    Fix2,
    DeleteExtraVertices,
    DeleteExtraVerticesIgnoreColor,
    OrganizeCircles,
    // Ori Studio originals (see `OperationOrigin`). Appended rather than filed
    // alongside their thematic neighbours, so this list keeps reading as
    // Oriedita's source map with our additions visible at the end.
    SquareGenerate,
    VertexInsertOnCreases,
}

/// Source-map descriptor for an Oriedita operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OperationDescriptor {
    /// Stable operation identifier.
    pub id: OperationId,
    /// Pinned Oriedita source element.
    pub upstream: &'static str,
    /// Planned Rust module/function home.
    pub target: &'static str,
    /// Source-map category.
    pub category: OperationCategory,
    /// Planned Oriedita port stage. Meaningful only for [`OperationOrigin::Oriedita`].
    pub stage: u8,
    /// Current implementation status.
    pub status: OperationStatus,
    /// Whether this is a port or an Ori Studio original.
    pub origin: OperationOrigin,
}

/// Declare an operation descriptor.
///
/// The bare form is a port, which is the overwhelming majority; an Ori Studio
/// original is written `descriptor!(native Foo, …)`. Leading with the word makes
/// the one thing a reviewer needs to notice the first token on the line, rather
/// than a prefix buried in a string three arguments in.
macro_rules! descriptor {
    (native $id:ident, $upstream:literal, $target:literal, $category:ident, $stage:literal, $status:ident) => {
        descriptor!(@build OriStudio, $id, $upstream, $target, $category, $stage, $status)
    };
    ($id:ident, $upstream:literal, $target:literal, $category:ident, $stage:literal, $status:ident) => {
        descriptor!(@build Oriedita, $id, $upstream, $target, $category, $stage, $status)
    };
    (@build $origin:ident, $id:ident, $upstream:literal, $target:literal, $category:ident, $stage:literal, $status:ident) => {
        OperationDescriptor {
            id: OperationId::$id,
            upstream: $upstream,
            target: $target,
            category: OperationCategory::$category,
            stage: $stage,
            status: OperationStatus::$status,
            origin: OperationOrigin::$origin,
        }
    };
}

const OPERATION_DESCRIPTORS: &[OperationDescriptor] = &[
    descriptor!(
        DrawCreaseFree,
        "MouseHandlerDrawCreaseFree",
        "operations::construction::draw_crease_segment",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        MoveCreasePattern,
        "MouseHandlerMoveCreasePattern",
        "runtime camera pan, no persisted CP mutation",
        UiPreviewOnly,
        0,
        OutOfScopeUi
    ),
    descriptor!(
        LineSegmentDelete,
        "MouseHandlerLineSegmentDelete",
        "operations::arrangement::delete_line_segments_for_indices",
        Kernel,
        5,
        OracleTested
    ),
    descriptor!(
        ChangeCreaseType,
        "MouseHandlerChangeCreaseType",
        "operations::color::change_crease_type",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        LengthenCrease,
        "MouseHandlerLengthenCrease",
        "operations::transform::lengthen_crease",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        SquareBisector,
        "MouseHandlerSquareBisector",
        "operations::construction::square_bisector_*",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        Inward,
        "MouseHandlerInward",
        "operations::construction::inward",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        PerpendicularDraw,
        "MouseHandlerPerpendicularDraw",
        "operations::construction::perpendicular_projection",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        SymmetricDraw,
        "MouseHandlerSymmetricDraw",
        "operations::construction::symmetric_draw",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        DrawCreaseRestricted,
        "MouseHandlerDrawCreaseRestricted",
        "operations::construction::draw_crease_segment",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        DrawCreaseSymmetric,
        "MouseHandlerDrawCreaseSymmetric",
        "operations::construction::mirror_selected_lines",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        DrawCreaseAngleRestricted,
        "MouseHandlerDrawCreaseAngleRestricted",
        "operations::construction::angle_restricted_converging_candidates",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        DrawPoint,
        "MouseHandlerDrawPoint",
        "operations::point::draw_point_on_segment",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        DeletePoint,
        "MouseHandlerDeletePoint",
        "operations::point::delete_point",
        Kernel,
        5,
        OracleTested
    ),
    descriptor!(
        AngleSystem,
        "MouseHandlerAngleSystem",
        "operations::construction::angle_system_candidates",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        DrawCreaseAngleRestricted3,
        "MouseHandlerDrawCreaseAngleRestricted3_2",
        "operations::construction::draw_crease_angle_restricted_3_candidates",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        CreaseSelect,
        "MouseHandlerCreaseSelect",
        "operations::selection::select_indices/select_box",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        CreaseUnselect,
        "MouseHandlerCreaseUnselect",
        "operations::selection::unselect_indices/unselect_box",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        CreaseMove,
        "MouseHandlerCreaseMove",
        "operations::transform::move_selected_lines",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        CreaseCopy,
        "MouseHandlerCreaseCopy",
        "operations::transform::copy_selected_lines",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        CreaseMakeMountain,
        "MouseHandlerCreaseMakeMountain",
        "operations::color::make_mountain",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        CreaseMakeValley,
        "MouseHandlerCreaseMakeValley",
        "operations::color::make_valley",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        CreaseMakeEdge,
        "MouseHandlerCreaseMakeEdge",
        "operations::color::make_edge",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        native CreaseSetLineColor,
        "OriStudioSetLineColor",
        "operations::color::set_line_color_for_indices",
        Kernel,
        8,
        UnitTested
    ),
    descriptor!(
        native CreaseSetFoldAngle,
        "OriStudioSetFoldAngle",
        "operations::color::set_fold_magnitude_for_indices",
        Kernel,
        8,
        UnitTested
    ),
    descriptor!(
        native VertexSolveFoldAngles,
        "OriStudioSolveVertexFoldAngles",
        "solve_fold_angles::vertex_angle_solutions",
        Kernel,
        8,
        UnitTested
    ),
    descriptor!(
        BackgroundChangePosition,
        "MouseHandlerBackgroundChangePosition",
        "none",
        OutOfScopeUi,
        0,
        OutOfScopeUi
    ),
    descriptor!(
        LineSegmentDivision,
        "MouseHandlerLineSegmentDivision",
        "operations::point::divide_segment_by_count",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        LineSegmentRatioSet,
        "MouseHandlerLineSegmentRatioSet",
        "operations::point::divide_segment_by_ratio",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        PolygonSetNoCorners,
        "MouseHandlerPolygonSetNoCorners",
        "operations::generators::regular_polygon",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        CreaseAdvanceType,
        "MouseHandlerCreaseAdvanceType",
        "operations::color::advance_line_type",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        CreaseMove4p,
        "MouseHandlerCreaseMove4p",
        "operations::transform::move_selected_lines_by_points",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        CreaseCopy4p,
        "MouseHandlerCreaseCopy4p",
        "operations::transform::copy_selected_lines_by_points",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        FishBoneDraw,
        "MouseHandlerFishBoneDraw",
        "operations::construction::fishbone_draw",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        CreaseMakeMv,
        "MouseHandlerCreaseMakeMV",
        "operations::color::alternate_mountain_valley_along",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        DoubleSymmetricDraw,
        "MouseHandlerDoubleSymmetricDraw",
        "operations::construction::double_symmetric_draw",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        CreasesAlternateMv,
        "MouseHandlerCreasesAlternateMV",
        "operations::color::alternate_mountain_valley_crossing",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        DrawCreaseAngleRestricted5,
        "MouseHandlerDrawCreaseAngleRestricted5",
        "operations::construction::draw_crease_angle_restricted_5",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        VertexMakeAngularlyFlatFoldable,
        "MouseHandlerVertexMakeAngularlyFlatFoldable",
        "operations::construction::make_vertex_flat_foldable_candidates",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        FoldableLineInput,
        "MouseHandlerFoldableLineInput",
        "operations::construction::foldable_line_input_candidates",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        ParallelDraw,
        "MouseHandlerParallelDraw",
        "operations::construction::parallel_draw",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        VertexDeleteOnCrease,
        "MouseHandlerVertexDeleteOnCrease",
        "operations::point::delete_vertex_on_crease",
        Kernel,
        5,
        OracleTested
    ),
    descriptor!(
        CircleDraw,
        "MouseHandlerCircleDraw",
        "operations::circle::draw",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        CircleDrawThreePoint,
        "MouseHandlerCircleDrawThreePoint",
        "operations::circle::through_three_points",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        CircleDrawSeparate,
        "MouseHandlerCircleDrawSeparate",
        "operations::circle::separate",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        CircleDrawTangentLine,
        "MouseHandlerCircleDrawTangentLine",
        "operations::circle::tangent_line",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        CircleDrawInverted,
        "MouseHandlerCircleDrawInverted",
        "operations::circle::inverted",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        CircleDrawFree,
        "MouseHandlerCircleDrawFree",
        "operations::circle::free",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        CircleDrawConcentric,
        "MouseHandlerCircleDrawConcentric",
        "operations::circle::concentric",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        CircleDrawConcentricSelect,
        "MouseHandlerCircleDrawConcentricSelect",
        "operations::circle::concentric_select",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        CircleDrawConcentricTwoCircleSelect,
        "MouseHandlerCircleDrawConcentricTwoCircleSelect",
        "operations::circle::concentric_two_circle_select",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        ParallelDrawWidth,
        "MouseHandlerParallelDrawWidth",
        "operations::construction::parallel_width_indicators",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        ContinuousSymmetricDraw,
        "MouseHandlerContinuousSymmetricDraw",
        "operations::construction::continuous_symmetric_draw",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        DisplayLengthBetweenPoints1,
        "MouseHandlerDisplayLengthBetweenPoints",
        "operations::measure::length_between_points",
        KernelPreview,
        7,
        OracleTested
    ),
    descriptor!(
        DisplayLengthBetweenPoints2,
        "MouseHandlerDisplayLengthBetweenPoints",
        "operations::measure::length_between_points",
        KernelPreview,
        7,
        OracleTested
    ),
    descriptor!(
        DisplayAngleBetweenThreePoints1,
        "MouseHandlerDisplayAngleBetweenThreePoints",
        "operations::measure::angle_between_three_points",
        KernelPreview,
        7,
        OracleTested
    ),
    descriptor!(
        DisplayAngleBetweenThreePoints2,
        "MouseHandlerDisplayAngleBetweenThreePoints",
        "operations::measure::angle_between_three_points",
        KernelPreview,
        7,
        OracleTested
    ),
    descriptor!(
        DisplayAngleBetweenThreePoints3,
        "MouseHandlerDisplayAngleBetweenThreePoints",
        "operations::measure::angle_between_three_points",
        KernelPreview,
        7,
        OracleTested
    ),
    descriptor!(
        CreaseToggleMv,
        "MouseHandlerCreaseToggleMV",
        "operations::color::toggle_mountain_valley",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        CircleChangeColor,
        "MouseHandlerCircleChangeColor",
        "operations::circle::change_color",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        CreaseMakeAux,
        "MouseHandlerCreaseMakeAux",
        "operations::color::make_aux",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        native CreaseMakeUnassigned,
        "OriStudioCreaseMakeUnassigned",
        "operations::native::unassign::make_unassigned",
        Kernel,
        6,
        UnitTested
    ),
    descriptor!(
        native CreaseSetDirectionHint,
        "OriStudioCreaseSetDirectionHint",
        "operations::native::direction_hint::set_direction_hint",
        Kernel,
        6,
        UnitTested
    ),
    descriptor!(
        native PropagateFoldAngles,
        "OriStudioPropagateFoldAngles",
        "operations::native::fold_propagation::propagate",
        Kernel,
        6,
        UnitTested
    ),
    descriptor!(
        OperationFrameCreate,
        "MouseHandlerOperationFrameCreate",
        "operations::transform::operation_frame_press/drag/release",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        VoronoiCreate,
        "MouseHandlerVoronoiCreate",
        "operations::generators::voronoi_press/apply",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        FlatFoldableCheck,
        "MouseHandlerFlatFoldableCheck",
        "checks::flat_foldable_boundary_check",
        Kernel,
        9,
        OracleTested
    ),
    descriptor!(
        CreaseDeleteOverlapping,
        "MouseHandlerCreaseDeleteOverlapping",
        "operations::arrangement::delete_overlapping",
        Kernel,
        5,
        OracleTested
    ),
    descriptor!(
        CreaseDeleteIntersecting,
        "MouseHandlerCreaseDeleteIntersecting",
        "operations::arrangement::delete_intersecting",
        Kernel,
        5,
        OracleTested
    ),
    descriptor!(
        SelectPolygon,
        "MouseHandlerSelectPolygon",
        "operations::selection::select_polygon",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        UnselectPolygon,
        "MouseHandlerUnselectPolygon",
        "operations::selection::unselect_polygon",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        SelectLineIntersecting,
        "MouseHandlerSelectLineIntersecting",
        "operations::selection::select_intersecting_line",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        UnselectLineIntersecting,
        "MouseHandlerUnselectLineIntersecting",
        "operations::selection::unselect_intersecting_line",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        LengthenCreaseSameColor,
        "MouseHandlerLengthenCreaseSameColor",
        "operations::transform::lengthen_crease",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        FoldableLineDraw,
        "MouseHandlerFoldableLineDraw",
        "operations::construction::foldable_line_draw_operation_mode",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        ReplaceLineTypeSelect,
        "MouseHandlerReplaceTypeSelect",
        "operations::color::replace_line_type_for_indices",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        DeleteLineTypeSelect,
        "MouseHandlerDeleteTypeSelect",
        "operations::color::delete_line_type_for_indices",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        SelectLasso,
        "MouseHandlerSelectLasso",
        "operations::selection::select_lasso",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        UnselectLasso,
        "MouseHandlerUnselectLasso",
        "operations::selection::unselect_lasso",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        Text,
        "MouseHandlerText",
        "operations::text",
        Kernel,
        6,
        OracleTested
    ),
    descriptor!(
        DrawBlintz,
        "MouseHandlerDrawBlintz",
        "operations::generators::default_molecule",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        DrawFishBase,
        "MouseHandlerDrawFishBase",
        "operations::generators::default_molecule",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        DrawDoveBase,
        "MouseHandlerDrawDoveBase",
        "operations::generators::default_molecule",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        DrawBirdBase,
        "MouseHandlerDrawBirdBase",
        "operations::generators::default_molecule",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        DrawFrogBase,
        "MouseHandlerDrawFrogBase",
        "operations::generators::default_molecule",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        ModifyCalculatedShape,
        "MouseHandlerModifyCalculatedShape",
        "folding::modify_calculated_shape",
        Kernel,
        10,
        Unsupported
    ),
    descriptor!(
        MoveCalculatedShape,
        "MouseHandlerMoveCalculatedShape",
        "folding::move_calculated_shape",
        Kernel,
        10,
        Unsupported
    ),
    descriptor!(
        ChangeStandardFace,
        "MouseHandlerChangeStandardFace",
        "folding::change_standard_face",
        Kernel,
        10,
        Unsupported
    ),
    descriptor!(
        AddFoldingConstraint,
        "MouseHandlerAddFoldingConstraints",
        "folding::constraints",
        Kernel,
        10,
        Unsupported
    ),
    descriptor!(
        Axiom5,
        "MouseHandlerAxiom5",
        "operations::construction::axiom5_indicators",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        Axiom7,
        "MouseHandlerAxiom7",
        "operations::construction::axiom7_*",
        Kernel,
        7,
        OracleTested
    ),
    descriptor!(
        FixInaccurate,
        "MouseHandlerCreaseFixInaccurate",
        "checks::fix_inaccurate_for_indices",
        Kernel,
        9,
        OracleTested
    ),
    descriptor!(ImportCp, "CpImporter", "io::cp::import", Io, 4, UnitTested),
    descriptor!(ExportCp, "CpExporter", "io::cp::export", Io, 4, UnitTested),
    descriptor!(
        ImportFold,
        "FoldImporter",
        "io::fold::import",
        Io,
        4,
        UnitTested
    ),
    descriptor!(
        ExportFold,
        "FoldExporter",
        "io::fold::export",
        Io,
        4,
        UnitTested
    ),
    descriptor!(
        ImportOri,
        "OriImporter",
        "io::ori::import",
        Io,
        4,
        UnitTested
    ),
    descriptor!(
        ExportOri,
        "OriExporter",
        "io::ori::export",
        Io,
        4,
        UnitTested
    ),
    descriptor!(
        ImportOrh,
        "OrhImporter",
        "io::orh::import",
        Io,
        4,
        OracleTested
    ),
    descriptor!(
        ExportOrh,
        "OrhExporter",
        "io::orh::export",
        Io,
        4,
        OracleTested
    ),
    descriptor!(
        ImportObj,
        "ObjImporter",
        "io::obj::import",
        Io,
        4,
        OracleTested
    ),
    descriptor!(
        ExportDxf,
        "DxfExporter",
        "io::dxf::export",
        Io,
        4,
        OracleTested
    ),
    descriptor!(
        SaveConvert,
        "SaveConverter",
        "io::save::convert",
        Io,
        4,
        UnitTested
    ),
    descriptor!(
        SaveVersionDetect,
        "FileVersionTester",
        "io::save::version",
        Io,
        4,
        UnitTested
    ),
    descriptor!(
        CheckCamv,
        "CheckCAMVTask",
        "checks::check_camv_task",
        Kernel,
        9,
        OracleTested
    ),
    descriptor!(
        FoldingEstimate,
        "FoldingEstimateTask",
        "folding::FoldingEstimateSession",
        Kernel,
        10,
        Porting
    ),
    descriptor!(
        FoldingEstimateSpecific,
        "FoldingEstimateSpecificTask",
        "folding::folding_estimate_to_case",
        Kernel,
        10,
        Porting
    ),
    descriptor!(
        FoldingEstimateSave100,
        "FoldingEstimateSave100Task",
        "folding::folding_estimate_save_batch",
        Kernel,
        10,
        Porting
    ),
    descriptor!(
        TwoColoredCp,
        "TwoColoredTask",
        "folding::two_colored_folding_estimate_from_segments",
        Kernel,
        10,
        Porting
    ),
    descriptor!(
        Fold,
        "FoldingServiceImpl.fold",
        "folding::commands::fold",
        KernelIntent,
        10,
        Unsupported
    ),
    descriptor!(
        FoldAnother,
        "FoldingServiceImpl.foldAnother",
        "folding::fold_another",
        KernelIntent,
        10,
        Porting
    ),
    descriptor!(
        DuplicateFoldedModel,
        "FoldingServiceImpl.duplicate",
        "folding::duplicate_estimation_order_for_display",
        KernelIntent,
        10,
        Porting
    ),
    descriptor!(
        FoldedFigureSetModel,
        "FoldedFigureModel",
        "folding::FoldedFigureModel",
        KernelIntent,
        10,
        Unsupported
    ),
    descriptor!(
        FoldedFigureSetDisplayStyle,
        "FoldedFigureModel.setDisplayStyle",
        "folding::FoldedFigureDisplayStyle",
        KernelIntent,
        10,
        Unsupported
    ),
    descriptor!(
        FoldedFigureSetState,
        "FoldedFigureModel.setState",
        "folding::FoldedFigureState",
        KernelIntent,
        10,
        Unsupported
    ),
    descriptor!(
        FoldedFigureSetStartingFace,
        "MouseHandlerChangeStandardFace",
        "folding::change_standard_face",
        KernelIntent,
        10,
        Unsupported
    ),
    descriptor!(
        FoldedFigureMoveCamera,
        "MouseHandlerMoveCalculatedShape",
        "folding::FoldedFigureCamera",
        UiPreviewOnly,
        10,
        OutOfScopeUi
    ),
    descriptor!(
        FoldedFigureSelectCanvasPoint,
        "FoldedFigureCanvasSelectService",
        "folding::FoldedFigureCanvasSelection",
        KernelIntent,
        10,
        Unsupported
    ),
    descriptor!(
        FoldedFigureRenderSnapshot,
        "FoldedFigure_Drawer.foldUp_draw",
        "folding::FoldedFigureRenderSnapshot",
        KernelPreview,
        10,
        Unsupported
    ),
    descriptor!(
        FoldedFigureImportFoldFrame,
        "FoldImporter.file_frames",
        "io::fold::import_folded_frames",
        Io,
        4,
        Unsupported
    ),
    descriptor!(
        FoldedFigureExportFoldFrames,
        "FoldExporter.file_frames",
        "io::fold::export_folded_frames",
        Io,
        4,
        Unsupported
    ),
    descriptor!(Check1, "Check1", "checks::check1", Kernel, 9, OracleTested),
    descriptor!(Check2, "Check2", "checks::check2", Kernel, 9, OracleTested),
    descriptor!(Check3, "Check3", "checks::check3", Kernel, 9, OracleTested),
    descriptor!(Check4, "Check4", "checks::check4", Kernel, 9, OracleTested),
    descriptor!(
        Fix1,
        "Fix1",
        "operations::arrangement::fix1",
        Kernel,
        9,
        OracleTested
    ),
    descriptor!(
        Fix2,
        "Fix2",
        "operations::arrangement::fix2",
        Kernel,
        9,
        OracleTested
    ),
    descriptor!(
        DeleteExtraVertices,
        "v_del_allAction",
        "operations::arrangement::del_v_all",
        Kernel,
        9,
        OracleTested
    ),
    descriptor!(
        DeleteExtraVerticesIgnoreColor,
        "v_del_all_ccAction",
        "operations::arrangement::del_v_all_color_change",
        Kernel,
        9,
        OracleTested
    ),
    descriptor!(
        OrganizeCircles,
        "OrganizeCircles",
        "operations::circle::organize",
        Kernel,
        8,
        OracleTested
    ),
    descriptor!(
        native SquareGenerate,
        "OriStudioSquareGenerate",
        "operations::native::square::square_at_anchor",
        Kernel,
        8,
        UnitTested
    ),
    descriptor!(
        native VertexInsertOnCreases,
        "OriStudioVertexInsertOnCreases",
        "operations::native::vertex_insert::insert_vertex_on_creases",
        Kernel,
        8,
        UnitTested
    ),
];

/// Return all source-mapped Oriedita operation descriptors.
pub fn operation_descriptors() -> &'static [OperationDescriptor] {
    OPERATION_DESCRIPTORS
}

/// Return the descriptor for one operation.
pub fn operation_descriptor(operation: OperationId) -> Option<&'static OperationDescriptor> {
    operation_descriptors()
        .iter()
        .find(|descriptor| descriptor.id == operation)
}

/// Return the current implementation status for one operation.
pub fn operation_status(operation: OperationId) -> OperationStatus {
    operation_descriptor(operation)
        .map(|descriptor| descriptor.status)
        .unwrap_or(OperationStatus::Unsupported)
}

/// Dispatch a command against a crease-pattern document.
pub fn execute_command(
    document: &mut CreasePatternDocument,
    command: CreasePatternCommand,
) -> Result<CommandResult> {
    let status = operation_status(command.operation);
    match status {
        OperationStatus::Unsupported | OperationStatus::OutOfScopeUi => {
            return Err(CommandError::UnsupportedOperation {
                operation: command.operation,
            });
        }
        OperationStatus::Porting
        | OperationStatus::UnitTested
        | OperationStatus::OracleTested
        | OperationStatus::DocumentedDifference => {}
    }

    let mut diagnostic_entries = Vec::new();
    let mut diagnostics_override = None;
    let mut checked_vertices = None;
    let changed = match command.operation {
        OperationId::DrawCreaseFree | OperationId::DrawCreaseRestricted => {
            let points = required_points(&command, 2)?;
            usize::from(operations::construction::draw_crease_segment(
                &mut document.crease_pattern,
                &LineSegment::with_color(points[0], points[1], active_line_color(&command)),
                operations::construction::DrawCreaseTarget::FoldLine,
            ))
        }
        OperationId::LineSegmentDelete => {
            // Oriedita `LINE_SEGMENT_DELETE_3` (the eraser): a single click erases
            // the primitive under the cursor, a dragged box erases everything it
            // encloses. The tool-options line-type filter restricts which creases
            // are removed (`Any` erases everything, matching the legacy behavior).
            //
            // `Any` also stands in for Oriedita's `BOTH_4` additional-input mode,
            // the only mode in which `MouseHandlerLineSegmentDelete` erases
            // circles; the four line-filtered modes leave circles untouched.
            let line_type = command
                .payload
                .custom_line_type
                .unwrap_or(model::CustomLineType::Any);
            let erases_circles = matches!(line_type, model::CustomLineType::Any);
            let explicit_targets =
                !command.payload.line_ids.is_empty() || !command.payload.circle_ids.is_empty();
            let (line_indices, circle_indices) = if explicit_targets {
                (
                    optional_line_indices(&command)?,
                    optional_circle_indices(&command)?,
                )
            } else {
                let polygon = required_selection_polygon(&command)?;
                let lines =
                    operations::selection::line_indices_in_box(&document.crease_pattern, &polygon);
                let circles = if erases_circles {
                    operations::selection::circle_indices_in_box(&document.crease_pattern, &polygon)
                } else {
                    Vec::new()
                };
                (lines, circles)
            };
            let mut deleted = if erases_circles {
                operations::arrangement::delete_line_segments_for_indices(
                    &mut document.crease_pattern,
                    &line_indices,
                )
            } else {
                operations::color::delete_line_type_for_indices(
                    &mut document.crease_pattern,
                    &line_indices,
                    line_type,
                )
            };
            let deleted_circles = if erases_circles {
                operations::circle::delete_circles_for_indices(
                    &mut document.crease_pattern,
                    &circle_indices,
                )
            } else {
                0
            };
            deleted += deleted_circles;
            // `deleteInsideBox` organizes circles unconditionally, so a boxed
            // crease deletion can also prune zero-radius circles that the crease
            // was holding in place. `deleteSingleLineOrCircle` organizes only when
            // it actually removed a circle.
            if !explicit_targets || deleted_circles > 0 {
                operations::circle::organize(&mut document.crease_pattern);
            }
            deleted
        }
        OperationId::ChangeCreaseType => {
            let line_indices = required_line_indices(&command)?;
            line_indices
                .iter()
                .filter(|index| {
                    operations::color::change_crease_type(&mut document.crease_pattern, **index)
                })
                .count()
        }
        OperationId::DeletePoint => {
            let points = required_points(&command, 1)?;
            let before = document.crease_pattern.line_segments.len();
            operations::arrangement::del_v_at_point(
                &mut document.crease_pattern,
                points[0],
                selection_distance(&command),
                Epsilon::UNKNOWN_1EN6,
            );
            before.abs_diff(document.crease_pattern.line_segments.len())
        }
        OperationId::DrawPoint => {
            let points = required_points(&command, 1)?;
            let (index, _) = nearest_line_segment(
                &document.crease_pattern,
                points[0],
                selection_distance(&command),
            )?;
            usize::from(operations::point::draw_point_on_segment(
                &mut document.crease_pattern,
                index,
                points[0],
                selection_distance(&command),
            ))
        }
        OperationId::CreaseSelect => {
            if command.payload.replace_selection.unwrap_or(false) {
                operations::selection::unselect_all(&mut document.crease_pattern);
            }
            if command.payload.line_ids.is_empty() {
                let polygon = required_selection_polygon(&command)?;
                operations::selection::select_box(&mut document.crease_pattern, &polygon)
            } else {
                let line_indices = required_line_indices(&command)?;
                operations::selection::select_indices(&mut document.crease_pattern, &line_indices)
            }
        }
        OperationId::CreaseUnselect => {
            if command.payload.line_ids.is_empty() {
                let polygon = required_selection_polygon(&command)?;
                operations::selection::unselect_box(&mut document.crease_pattern, &polygon)
            } else {
                let line_indices = required_line_indices(&command)?;
                operations::selection::unselect_indices(&mut document.crease_pattern, &line_indices)
            }
        }
        OperationId::CreaseMakeMountain => {
            let line_indices = required_line_indices(&command)?;
            operations::color::make_mountain(&mut document.crease_pattern, &line_indices)
        }
        OperationId::CreaseMakeValley => {
            let line_indices = required_line_indices(&command)?;
            operations::color::make_valley(&mut document.crease_pattern, &line_indices)
        }
        OperationId::CreaseMakeEdge => {
            let line_indices = required_line_indices(&command)?;
            operations::color::make_edge(&mut document.crease_pattern, &line_indices)
        }
        OperationId::CreaseSetLineColor => {
            let line_indices = required_line_indices(&command)?;
            let color = command
                .payload
                .line_color
                .ok_or_else(|| CommandError::InvalidInput {
                    operation: command.operation,
                    message: "expected active line color".to_string(),
                })?;
            operations::color::set_line_color_for_indices(
                &mut document.crease_pattern,
                &line_indices,
                color,
            )
        }
        OperationId::CreaseSetFoldAngle => {
            let line_indices = required_line_indices(&command)?;
            // Absent means "make classic"; a value out of 0..=180 is a caller
            // bug, so reject it rather than clamping to something plausible.
            let magnitude = match command.payload.fold_magnitude_degrees {
                None => None,
                Some(degrees) => Some(geometry::FoldMagnitude::from_degrees(degrees).ok_or_else(
                    || CommandError::InvalidInput {
                        operation: command.operation,
                        message: format!("fold magnitude {degrees} is outside 0..=180 degrees"),
                    },
                )?),
            };
            operations::color::set_fold_magnitude_for_indices(
                &mut document.crease_pattern,
                &line_indices,
                magnitude,
            )
        }
        OperationId::VertexSolveFoldAngles => {
            let solved = vertex_angle_solutions(document, &command)?;
            let solution = chosen_angle_solution(&command, &solved)?;
            operations::color::set_signed_fold_angles(
                &mut document.crease_pattern,
                &solution.creases,
            )
        }
        OperationId::CreaseMakeAux => {
            let line_indices = required_line_indices(&command)?;
            operations::color::make_aux(&mut document.crease_pattern, &line_indices)
        }
        OperationId::CreaseMakeUnassigned => {
            let line_indices = required_line_indices(&command)?;
            // One operation, two intents. Keeping the direction is the common
            // one — it is what the fold-angle chip performs — so it is the
            // default, and forgetting it as well is the explicit ask.
            if command.payload.forget_direction.unwrap_or(false) {
                operations::native::unassign::make_unassigned(
                    &mut document.crease_pattern,
                    &line_indices,
                )
            } else {
                operations::native::unassign::make_unassigned_keeping_direction(
                    &mut document.crease_pattern,
                    &line_indices,
                )
            }
        }
        OperationId::CreaseSetDirectionHint => {
            let line_indices = required_line_indices(&command)?;
            // No default. Mountain, valley and clear are three deliberate
            // intents and none of them is the obvious one to assume, so a
            // payload that omits the field is a caller bug rather than a
            // request to guess.
            let change =
                command
                    .payload
                    .direction_hint
                    .ok_or_else(|| CommandError::InvalidInput {
                        operation: command.operation,
                        message: "direction_hint is required (Mountain, Valley or Clear)"
                            .to_string(),
                    })?;
            operations::native::direction_hint::set_direction_hint(
                &mut document.crease_pattern,
                &line_indices,
                change,
            )
        }
        OperationId::PropagateFoldAngles => {
            // Commit is the *same* draft the preview showed, recomputed from the
            // same inputs rather than carried across the boundary. The solve is
            // deterministic, so the two agree; sending the draft back would mean
            // trusting a client-held answer about the document's geometry. That
            // includes the scope: both paths resolve it in `propagation_draft`,
            // so a commit cannot be wider than the draft the user confirmed.
            match propagation_draft(document, &command)? {
                PropagationDraft::Declined(_) => 0,
                PropagationDraft::Ready(draft) => operations::native::fold_propagation::apply(
                    &mut document.crease_pattern,
                    &draft.solved,
                ),
            }
        }
        OperationId::CreaseToggleMv => {
            // Oriedita `CREASE_TOGGLE_MV_58` is a box-select tool: a single crease
            // click flips that crease, a dragged box flips every mountain/valley
            // line it encloses. `toggle_mountain_valley` already ignores non-M/V
            // lines, matching Oriedita's `LineColor::changeMV` filter.
            //
            // The tool reverses a *stated* fold direction, and an unassigned
            // crease carrying a hint states one — so the flip reaches it too,
            // through an additive Ori Studio limb rather than by teaching the
            // ported filter about a concept upstream does not have. The two
            // gates are disjoint (`Red1`/`Blue2` against `LineColor::None`), so
            // the counts simply add and no line is flipped twice. Recorded in
            // PORTING.md; see `operations::native::direction_hint` for why a
            // *bare* unassigned crease is left alone.
            let line_indices = if command.payload.line_ids.is_empty() {
                let polygon = required_selection_polygon(&command)?;
                operations::selection::line_indices_in_box(&document.crease_pattern, &polygon)
            } else {
                required_line_indices(&command)?
            };
            operations::color::toggle_mountain_valley(&mut document.crease_pattern, &line_indices)
                + operations::native::direction_hint::flip_direction_hints(
                    &mut document.crease_pattern,
                    &line_indices,
                )
        }
        OperationId::CircleChangeColor => {
            let circle_indices = optional_circle_indices(&command)?;
            let aux_line_indices = optional_line_indices(&command)?;
            operations::circle::change_color(
                &mut document.crease_pattern,
                &circle_indices,
                &aux_line_indices,
                custom_circle_color(&command),
            )
        }
        OperationId::OrganizeCircles => operations::circle::organize(&mut document.crease_pattern),
        OperationId::CreaseAdvanceType => {
            let line_indices = required_line_indices(&command)?;
            line_indices
                .iter()
                .filter(|index| {
                    operations::color::advance_line_type(&mut document.crease_pattern, **index)
                })
                .count()
        }
        OperationId::CreaseMove => {
            let line_indices = required_line_indices(&command)?;
            let points = required_points(&command, 2)?;
            set_selected_line_flags(&mut document.crease_pattern, &line_indices);
            operations::transform::move_selected_lines(
                &mut document.crease_pattern,
                points[0].delta(points[1]),
            )
        }
        OperationId::CreaseCopy => {
            let line_indices = required_line_indices(&command)?;
            let points = required_points(&command, 2)?;
            set_selected_line_flags(&mut document.crease_pattern, &line_indices);
            operations::transform::copy_selected_lines(
                &mut document.crease_pattern,
                points[0].delta(points[1]),
            )
        }
        OperationId::CreaseMove4p => {
            let line_indices = required_line_indices(&command)?;
            let points = required_points(&command, 4)?;
            set_selected_line_flags(&mut document.crease_pattern, &line_indices);
            operations::transform::move_selected_lines_by_points(
                &mut document.crease_pattern,
                points[0],
                points[1],
                points[2],
                points[3],
            )
        }
        OperationId::CreaseCopy4p => {
            let line_indices = required_line_indices(&command)?;
            let points = required_points(&command, 4)?;
            set_selected_line_flags(&mut document.crease_pattern, &line_indices);
            operations::transform::copy_selected_lines_by_points(
                &mut document.crease_pattern,
                points[0],
                points[1],
                points[2],
                points[3],
            )
        }
        OperationId::LineSegmentDivision => {
            // Oriedita drags a new segment and splits *that* into N equal creases
            // (endpoints already point-snapped by the frontend), not an existing line.
            let points = required_points(&command, 2)?;
            operations::point::divide_segment_by_count(
                &mut document.crease_pattern,
                &LineSegment::with_color(points[0], points[1], active_line_color(&command)),
                division_count(&command),
            )
        }
        OperationId::LineSegmentRatioSet => {
            let points = required_points(&command, 2)?;
            operations::point::divide_segment_by_ratio(
                &mut document.crease_pattern,
                &LineSegment::with_color(points[0], points[1], active_line_color(&command)),
                ratio_s(&command),
                ratio_t(&command),
            )
        }
        OperationId::PolygonSetNoCorners => {
            let points = required_points(&command, 2)?;
            operations::generators::regular_polygon_no_corners(
                &mut document.crease_pattern,
                points[0],
                points[1],
                polygon_corners(&command),
                active_line_color(&command),
            )
        }
        OperationId::SquareGenerate => {
            required_points(&command, 1)?;
            let corners = square_corners_from_command(&command).ok_or_else(|| {
                CommandError::InvalidInput {
                    operation: command.operation,
                    message: "square_extent must be a finite, positive model-space size"
                        .to_string(),
                }
            })?;
            let color = active_line_color(&command);
            for edge in operations::native::square::square_edges(&corners, color) {
                operations::arrangement::add_line_segment_like_worker(
                    &mut document.crease_pattern,
                    &edge,
                );
            }
            corners.len()
        }
        OperationId::DrawBlintz
        | OperationId::DrawFishBase
        | OperationId::DrawDoveBase
        | OperationId::DrawBirdBase
        | OperationId::DrawFrogBase => {
            let points = required_points(&command, 2)?;
            let molecule = default_molecule_for_operation(command.operation).ok_or_else(|| {
                CommandError::InvalidInput {
                    operation: command.operation,
                    message: "operation is not a default molecule generator".to_string(),
                }
            })?;
            operations::generators::default_molecule(
                &mut document.crease_pattern,
                molecule,
                points[0],
                points[1],
                active_line_color(&command),
            )
            .map_err(|error| CommandError::InvalidInput {
                operation: command.operation,
                message: error.to_string(),
            })?
        }
        OperationId::VoronoiCreate => {
            required_points_at_least(&command, 1)?;
            let mut state = voronoi_state_from_points(&document.crease_pattern, &command);
            let result = operations::generators::voronoi_apply(
                &mut document.crease_pattern,
                &mut state,
                active_line_color(&command),
            );
            result.lines_added + result.circles_added
        }
        OperationId::CircleDraw => {
            let points = required_points(&command, 2)?;
            usize::from(operations::circle::draw(
                &mut document.crease_pattern,
                points[0],
                points[1],
            ))
        }
        OperationId::CircleDrawFree => {
            let points = required_points(&command, 2)?;
            usize::from(operations::circle::free(
                &mut document.crease_pattern,
                points[0],
                points[1],
            ))
        }
        OperationId::CircleDrawSeparate => {
            let points = required_points(&command, 3)?;
            usize::from(operations::circle::separate(
                &mut document.crease_pattern,
                points[0],
                points[1],
                points[2],
            ))
        }
        OperationId::CircleDrawThreePoint => {
            let points = required_points(&command, 3)?;
            usize::from(operations::circle::through_three_points(
                &mut document.crease_pattern,
                points[0],
                points[1],
                points[2],
            ))
        }
        OperationId::CircleDrawTangentLine => {
            let circle_indices = required_circle_indices_at_least(&command, 1)?;
            let candidates = if circle_indices.len() >= 2 {
                let circle1 = circle_for_operation(document, command.operation, circle_indices[0])?;
                let circle2 = circle_for_operation(document, command.operation, circle_indices[1])?;
                operations::circle::tangent_lines_two_circles(circle1, circle2)
            } else {
                let points = required_points(&command, 1)?;
                let circle = circle_for_operation(document, command.operation, circle_indices[0])?;
                operations::circle::tangent_lines_point_circle(
                    &document.crease_pattern,
                    points[0],
                    circle,
                )
            };
            usize::from(operations::circle::commit_tangent_line(
                &mut document.crease_pattern,
                &candidates,
                command.payload.candidate_index.unwrap_or(0),
                active_line_color(&command),
            ))
        }
        OperationId::CircleDrawInverted => {
            let circle_indices = required_circle_indices_at_least(&command, 1)?;
            if let Some(line_id) = command.payload.line_ids.first() {
                let line_index =
                    line_id
                        .checked_sub(1)
                        .ok_or_else(|| CommandError::InvalidInput {
                            operation: command.operation,
                            message: "line IDs are one-based".to_string(),
                        })?;
                let segment = line_segment_for_operation(document, command.operation, line_index)?;
                let inversion =
                    circle_for_operation(document, command.operation, circle_indices[0])?;
                usize::from(
                    operations::circle::invert_line_segment(
                        &mut document.crease_pattern,
                        &segment,
                        inversion,
                    ) != operations::circle::CircleInversionOutput::None,
                )
            } else {
                let circle_indices = required_circle_indices_at_least(&command, 2)?;
                let subject = circle_for_operation(document, command.operation, circle_indices[0])?;
                let inversion =
                    circle_for_operation(document, command.operation, circle_indices[1])?;
                usize::from(
                    operations::circle::invert_circle(
                        &mut document.crease_pattern,
                        subject,
                        inversion,
                    ) != operations::circle::CircleInversionOutput::None,
                )
            }
        }
        OperationId::CircleDrawConcentric => {
            let circle_indices = required_circle_indices_at_least(&command, 1)?;
            let points = required_points(&command, 2)?;
            let circle = circle_for_operation(document, command.operation, circle_indices[0])?;
            usize::from(operations::circle::concentric(
                &mut document.crease_pattern,
                circle,
                points[0],
                points[1],
            ))
        }
        OperationId::CircleDrawConcentricSelect => {
            let circle_indices = required_circle_indices_at_least(&command, 3)?;
            let target = circle_for_operation(document, command.operation, circle_indices[0])?;
            let reference1 = circle_for_operation(document, command.operation, circle_indices[1])?;
            let reference2 = circle_for_operation(document, command.operation, circle_indices[2])?;
            usize::from(operations::circle::concentric_select(
                &mut document.crease_pattern,
                target,
                reference1,
                reference2,
                command.payload.candidate_index.unwrap_or(0),
            ))
        }
        OperationId::CircleDrawConcentricTwoCircleSelect => {
            let circle_indices = required_circle_indices_at_least(&command, 2)?;
            let circle1 = circle_for_operation(document, command.operation, circle_indices[0])?;
            let circle2 = circle_for_operation(document, command.operation, circle_indices[1])?;
            operations::circle::concentric_two_circle_select(
                &mut document.crease_pattern,
                circle1,
                circle2,
            )
        }
        OperationId::SquareBisector => {
            if command.payload.line_ids.len() >= 2 {
                let line_indices = required_line_indices(&command)?;
                let first =
                    line_segment_for_operation(document, command.operation, line_indices[0])?;
                let second =
                    line_segment_for_operation(document, command.operation, line_indices[1])?;

                // Parallel sources are refused, and this is a **deliberate departure
                // from upstream** rather than a gap. Read this before "finishing" it.
                //
                // Upstream splits here on `checkIfParallel()` into a second
                // interaction: two parallel lines have no angle to bisect, so it
                // offers the midline between them as a purple indicator you either
                // take whole or cut between two crossing creases. Every piece of that
                // is ported and oracle-tested — `square_bisector_parallel_indicator`,
                // `commit_square_bisector_parallel_indicator`,
                // `square_bisector_parallel_between_destinations` — and it was wired
                // up here and then taken back out on purpose, because the behaviour
                // it produces is not behaviour we want:
                //
                // - The midline runs through `fullExtendUntilHit`, which does not
                //   stop at the creases it crosses. Upstream draws a ray straight
                //   through the pattern and off the paper; ours did the same.
                // - The two-destination arm intersects the indicator with each
                //   destination *without checking either is non-parallel to it*.
                //   Upstream's guard for that lives in `move_drag_select_destination_
                //   2L_P`, a hover handler — UI-side, and not ported. So the kernel
                //   function inherited the divide without its guard, and a
                //   destination parallel to the midline divides by ~0 exactly the way
                //   the original bug did. A real user file reached 8.2e12 this way.
                //
                // The port stays (it is parity-tested and describes what upstream
                // does); it is just not reachable from the product. If you want it
                // back, the two problems above are the price of admission.
                if operations::construction::square_bisector_parallel_indicator(
                    &document.crease_pattern,
                    &first,
                    &second,
                )
                .is_some()
                {
                    return Err(CommandError::InvalidInput {
                        operation: command.operation,
                        message: "Those two creases are parallel, so there is no angle between \
                                  them to bisect. Pick two creases that meet."
                            .to_string(),
                    });
                } else if line_indices.len() >= 3 {
                    let destination =
                        line_segment_for_operation(document, command.operation, line_indices[2])?;
                    usize::from(
                        operations::construction::square_bisector_from_lines_to_destination(
                            &mut document.crease_pattern,
                            &first,
                            &second,
                            &destination,
                            active_line_color(&command),
                        ),
                    )
                } else {
                    return Err(CommandError::InvalidInput {
                        operation: command.operation,
                        message: "Pick a crease for the bisector to end on.".to_string(),
                    });
                }
            } else {
                let points = required_points(&command, 4)?;
                let (_, destination) = nearest_line_segment(
                    &document.crease_pattern,
                    points[3],
                    selection_distance(&command),
                )?;
                usize::from(
                    operations::construction::square_bisector_from_points_to_destination(
                        &mut document.crease_pattern,
                        points[0],
                        points[1],
                        points[2],
                        &destination,
                        active_line_color(&command),
                    ),
                )
            }
        }
        OperationId::Inward => {
            let points = required_points(&command, 3)?;
            operations::construction::inward(
                &mut document.crease_pattern,
                points[0],
                points[1],
                points[2],
                active_line_color(&command),
            )
        }
        OperationId::PerpendicularDraw => {
            let points = required_points_at_least(&command, 2)?;
            let (_, base) = nearest_line_segment(
                &document.crease_pattern,
                points[1],
                selection_distance(&command),
            )?;
            if points.len() >= 3 {
                let (_, destination) = nearest_line_segment(
                    &document.crease_pattern,
                    points[2],
                    selection_distance(&command),
                )?;
                let indicator = operations::construction::perpendicular_indicator(
                    &document.crease_pattern,
                    points[0],
                    &base,
                )
                .unwrap_or_else(|| LineSegment::new(points[0], points[1]));
                usize::from(operations::construction::perpendicular_draw_to_destination(
                    &mut document.crease_pattern,
                    points[0],
                    &indicator,
                    &destination,
                    active_line_color(&command),
                ))
            } else if let Some(indicator) = operations::construction::perpendicular_indicator(
                &document.crease_pattern,
                points[0],
                &base,
            ) {
                usize::from(operations::construction::commit_perpendicular_indicator(
                    &mut document.crease_pattern,
                    &indicator,
                    active_line_color(&command),
                ))
            } else {
                usize::from(operations::construction::perpendicular_projection(
                    &mut document.crease_pattern,
                    points[0],
                    &base,
                    active_line_color(&command),
                ))
            }
        }
        OperationId::SymmetricDraw => {
            let points = required_points_at_least(&command, 2)?;
            let (source, mirror) =
                symmetric_draw_lines(&document.crease_pattern, &command, &points)?;
            usize::from(operations::construction::symmetric_draw(
                &mut document.crease_pattern,
                &source,
                &mirror,
                active_line_color(&command),
            ))
        }
        OperationId::DrawCreaseSymmetric => {
            let line_indices = required_line_indices(&command)?;
            let points = required_points(&command, 2)?;
            set_selected_line_flags(&mut document.crease_pattern, &line_indices);
            operations::construction::mirror_selected_lines(
                &mut document.crease_pattern,
                &LineSegment::new(points[0], points[1]),
            )
        }
        OperationId::DrawCreaseAngleRestricted => {
            let points = required_points(&command, 3)?;
            let segment = LineSegment::new(points[0], points[1]);
            let candidates = operations::construction::angle_restricted_converging_candidates(
                &segment,
                angle_system_divider(&command),
                angle_system_angles(&command),
            );
            let converge_point =
                nearest_candidate_point(&command, points[2], &candidates.intersections)?;
            operations::construction::draw_crease_angle_restricted_converging(
                &mut document.crease_pattern,
                &segment,
                converge_point,
                active_line_color(&command),
            )
        }
        OperationId::AngleSystem => {
            let points = required_points(&command, 3)?;
            let candidates = operations::construction::angle_system_candidates(
                points[0],
                points[1],
                angle_system_divider(&command),
                angle_system_angles(&command),
            );
            let selected = nearest_candidate_segment(&command, points[2], &candidates)?;
            let (_, destination) = nearest_line_segment(
                &document.crease_pattern,
                points[2],
                selection_distance(&command),
            )?;
            usize::from(operations::construction::angle_system_draw_to_destination(
                &mut document.crease_pattern,
                points[1],
                &selected,
                &destination,
                active_line_color(&command),
            ))
        }
        OperationId::DrawCreaseAngleRestricted3 => {
            let points = required_points(&command, 3)?;
            let candidates = operations::construction::draw_crease_angle_restricted_3_candidates(
                points[0],
                points[1],
                angle_system_divider(&command),
                angle_system_angles(&command),
            );
            let selected = nearest_candidate_segment(&command, points[2], &candidates)?;
            usize::from(
                operations::construction::draw_crease_angle_restricted_3_to_point(
                    &mut document.crease_pattern,
                    points[2],
                    points[1],
                    &selected,
                    selection_distance(&command),
                    active_line_color(&command),
                ),
            )
        }
        OperationId::FishBoneDraw => {
            let points = required_points(&command, 2)?;
            let grid_width = grid_width(&command, &document.crease_pattern);
            operations::construction::fishbone_draw(
                &mut document.crease_pattern,
                &LineSegment::new(points[0], points[1]),
                grid_width,
                active_line_color(&command),
                selection_distance(&command),
            )
        }
        OperationId::DoubleSymmetricDraw => {
            let points = required_points(&command, 2)?;
            operations::construction::double_symmetric_draw(
                &mut document.crease_pattern,
                &LineSegment::new(points[0], points[1]),
            )
        }
        OperationId::DrawCreaseAngleRestricted5 => {
            let points = required_points(&command, 2)?;
            let snap = snap_policy(&command, &document.crease_pattern);
            usize::from(operations::construction::draw_crease_angle_restricted_5(
                &mut document.crease_pattern,
                points[0],
                points[1],
                angle_system_divider(&command),
                angle_system_angles(&command),
                snap,
                active_line_color(&command),
            ))
        }
        OperationId::VertexMakeAngularlyFlatFoldable => {
            let points = required_points_at_least(&command, 2)?;
            let candidates = vertex_completion_candidates(document, &command, points[0]);
            let selected = nearest_candidate_segment(&command, points[1], &candidates.candidates)?;
            let destination = resolved_completion_destination(
                document,
                &command,
                &points[2..],
                &candidates,
                &selected,
            )?;
            let (color, fold_magnitude) = candidates.commit_style(&selected);
            usize::from(
                operations::construction::make_vertex_flat_foldable_to_destination(
                    &mut document.crease_pattern,
                    points[0],
                    &selected,
                    &destination,
                    color,
                    fold_magnitude,
                ),
            )
        }
        OperationId::FoldableLineInput => {
            let points = required_points(&command, 2)?;
            let input = LineSegment::new(points[0], points[1]);
            usize::from(operations::construction::foldable_line_input_direct(
                &mut document.crease_pattern,
                &input,
                active_line_color(&command),
            ))
        }
        OperationId::ParallelDraw => {
            let points = required_points(&command, 3)?;
            let (_, parallel_segment) = nearest_line_segment(
                &document.crease_pattern,
                points[1],
                selection_distance(&command),
            )?;
            let (_, destination_segment) = nearest_line_segment(
                &document.crease_pattern,
                points[2],
                selection_distance(&command),
            )?;
            usize::from(operations::construction::parallel_draw(
                &mut document.crease_pattern,
                points[0],
                &parallel_segment,
                &destination_segment,
                active_line_color(&command),
            ))
        }
        OperationId::ParallelDrawWidth => {
            let points = required_points(&command, 2)?;
            let selected_segment = required_or_nearest_line_segment(document, &command)?;
            let width = command
                .payload
                .width
                .filter(|width| width.is_finite() && *width > 0.0)
                .unwrap_or_else(|| determine_line_segment_distance(points[1], &selected_segment));
            let indicators =
                operations::construction::parallel_width_indicators(&selected_segment, width);
            let selected = nearest_candidate_segment(&command, points[1], &indicators)?;
            usize::from(operations::construction::commit_parallel_width_indicator(
                &mut document.crease_pattern,
                &selected,
                active_line_color(&command),
            ))
        }
        OperationId::ContinuousSymmetricDraw => {
            let points = required_points(&command, 2)?;
            operations::construction::continuous_symmetric_draw(
                &mut document.crease_pattern,
                points[0],
                points[1],
                active_line_color(&command),
            )
        }
        OperationId::FoldableLineDraw => {
            let points = required_points(&command, 2)?;
            let mode = operations::construction::foldable_line_draw_operation_mode(
                &document.crease_pattern,
                points[0],
                selection_distance(&command),
            );
            if mode == operations::construction::FoldableLineDrawOperationMode::DrawCreaseFree
                || operations::construction::foldable_line_draw_switches_to_free(
                    points[1],
                    points[0],
                    selection_distance(&command),
                )
            {
                usize::from(operations::construction::draw_crease_segment(
                    &mut document.crease_pattern,
                    &LineSegment::with_color(points[0], points[1], active_line_color(&command)),
                    operations::construction::DrawCreaseTarget::FoldLine,
                ))
            } else {
                let candidates = vertex_completion_candidates(document, &command, points[0]);
                let selected =
                    nearest_candidate_segment(&command, points[1], &candidates.candidates)?;
                let destination = resolved_completion_destination(
                    document,
                    &command,
                    &[],
                    &candidates,
                    &selected,
                )?;
                let (color, fold_magnitude) = candidates.commit_style(&selected);
                usize::from(
                    operations::construction::make_vertex_flat_foldable_to_destination(
                        &mut document.crease_pattern,
                        points[0],
                        &selected,
                        &destination,
                        color,
                        fold_magnitude,
                    ),
                )
            }
        }
        OperationId::Axiom5 => {
            let points = required_points_at_least(&command, 3)?;
            let (_, target_segment) = nearest_line_segment(
                &document.crease_pattern,
                points[1],
                selection_distance(&command),
            )?;
            let indicators = operations::construction::axiom5_indicators(
                &document.crease_pattern,
                points[0],
                &target_segment,
                points[2],
            )
            .ok_or_else(|| CommandError::InvalidInput {
                operation: command.operation,
                message: "resolved Axiom 5 inputs do not produce a fold candidate".to_string(),
            })?;
            if points.len() >= 4 {
                let (_, destination) = nearest_line_segment(
                    &document.crease_pattern,
                    points[3],
                    selection_distance(&command),
                )?;
                usize::from(operations::construction::axiom5_draw_to_destination(
                    &mut document.crease_pattern,
                    points[2],
                    &indicators[0],
                    &indicators[1],
                    &destination,
                    points[3],
                    active_line_color(&command),
                ))
            } else {
                let selected = nearest_candidate_segment(&command, points[2], &indicators)?;
                usize::from(operations::construction::commit_axiom5_indicator(
                    &mut document.crease_pattern,
                    &selected,
                    active_line_color(&command),
                ))
            }
        }
        OperationId::Axiom7 => {
            let points = required_points_at_least(&command, 3)?;
            let (_, target_segment) = nearest_line_segment(
                &document.crease_pattern,
                points[1],
                selection_distance(&command),
            )?;
            let (_, perpendicular_segment) = nearest_line_segment(
                &document.crease_pattern,
                points[2],
                selection_distance(&command),
            )?;
            let indicator = operations::construction::axiom7_indicator(
                &document.crease_pattern,
                points[0],
                &target_segment,
                &perpendicular_segment,
            )
            .ok_or_else(|| CommandError::InvalidInput {
                operation: command.operation,
                message: "resolved Axiom 7 inputs do not produce a fold candidate".to_string(),
            })?;
            if points.len() >= 4 {
                let (_, destination) = nearest_line_segment(
                    &document.crease_pattern,
                    points[3],
                    selection_distance(&command),
                )?;
                usize::from(operations::construction::axiom7_draw_to_destination(
                    &mut document.crease_pattern,
                    &indicator,
                    &destination,
                    active_line_color(&command),
                ))
            } else {
                usize::from(operations::construction::commit_axiom7_indicator(
                    &mut document.crease_pattern,
                    &indicator,
                    active_line_color(&command),
                ))
            }
        }
        OperationId::CreaseMakeMv => {
            let points = required_points(&command, 2)?;
            let guide = LineSegment::with_color(points[0], points[1], active_line_color(&command));
            operations::color::alternate_mountain_valley_along(
                &mut document.crease_pattern,
                &guide,
                active_line_color(&command),
            )
        }
        OperationId::CreasesAlternateMv => {
            let points = required_points(&command, 2)?;
            let guide = LineSegment::with_color(points[0], points[1], active_line_color(&command));
            operations::color::alternate_mountain_valley_crossing(
                &mut document.crease_pattern,
                &guide,
                active_line_color(&command),
            )
        }
        OperationId::VertexDeleteOnCrease => {
            let points = required_points(&command, 1)?;
            let before = document.crease_pattern.line_segments.len();
            operations::arrangement::del_v_at_point_color_change(
                &mut document.crease_pattern,
                points[0],
                selection_distance(&command),
                Epsilon::UNKNOWN_1EN6,
            );
            before.abs_diff(document.crease_pattern.line_segments.len())
        }
        // The inverse of the operation above, and the reason it sits here: that
        // one dissolves a vertex two creases share, this one inserts a vertex
        // every crease through the point comes to share. It takes no selection
        // distance — see `vertex_insert::ON_CREASE_TOLERANCE` for why the point
        // is the answer and not a query.
        OperationId::VertexInsertOnCreases => {
            let points = required_points(&command, 1)?;
            operations::native::vertex_insert::insert_vertex_on_creases(
                &mut document.crease_pattern,
                points[0],
            )
        }
        OperationId::OperationFrameCreate => {
            let points = required_points_at_least(&command, 2)?;
            let mut state = operations::transform::operation_frame_press(
                &document.crease_pattern,
                &mut document.operation_frame,
                points[0],
                selection_distance(&command),
            );
            for point in points
                .iter()
                .copied()
                .skip(1)
                .take(points.len().saturating_sub(2))
            {
                operations::transform::operation_frame_drag(
                    &document.crease_pattern,
                    &mut document.operation_frame,
                    &mut state,
                    point,
                    selection_distance(&command),
                );
            }
            operations::transform::operation_frame_release(
                &document.crease_pattern,
                &mut document.operation_frame,
                &state,
                points[points.len() - 1],
                selection_distance(&command),
            );
            usize::from(document.operation_frame.active)
        }
        OperationId::CreaseDeleteOverlapping => {
            let points = required_points(&command, 2)?;
            delete_lines_along(document, &points, false)
        }
        OperationId::CreaseDeleteIntersecting => {
            let points = required_points(&command, 2)?;
            delete_lines_along(document, &points, true)
        }
        OperationId::SelectLineIntersecting => {
            let points = required_points(&command, 2)?;
            let selection = geometry::LineSegment::new(points[0], points[1]);
            operations::selection::select_intersecting_line(
                &mut document.crease_pattern,
                &selection,
            )
        }
        OperationId::SelectPolygon => {
            let polygon = required_selection_polygon(&command)?;
            if command.payload.replace_selection.unwrap_or(false) {
                operations::selection::unselect_all(&mut document.crease_pattern);
            }
            operations::selection::select_polygon(&mut document.crease_pattern, &polygon)
        }
        OperationId::UnselectPolygon => {
            let polygon = required_selection_polygon(&command)?;
            operations::selection::unselect_polygon(&mut document.crease_pattern, &polygon)
        }
        OperationId::UnselectLineIntersecting => {
            let points = required_points(&command, 2)?;
            let selection = geometry::LineSegment::new(points[0], points[1]);
            operations::selection::unselect_intersecting_line(
                &mut document.crease_pattern,
                &selection,
            )
        }
        OperationId::Check1 => {
            diagnostic_entries = line_pair_diagnostics(
                OperationId::Check1,
                "Check1",
                "Overlapping or contained non-auxiliary creases",
                checks::check1(&document.crease_pattern),
            );
            0
        }
        OperationId::Check2 => {
            diagnostic_entries = line_pair_diagnostics(
                OperationId::Check2,
                "Check2",
                "Near T-intersection between non-auxiliary creases",
                checks::check2(&document.crease_pattern),
            );
            0
        }
        OperationId::Check3 => {
            diagnostic_entries =
                point_marker_diagnostics("Check3", checks::check3(&document.crease_pattern));
            0
        }
        OperationId::Check4 => {
            diagnostic_entries =
                flat_foldability_diagnostics("Check4", checks::check4(&document.crease_pattern));
            0
        }
        OperationId::CheckCamv => {
            // Per-vertex dispatch: flat vertices keep Oriedita's check verbatim,
            // vertices touching a non-classic crease take the closure path. A
            // mixed design therefore keeps its full flat diagnostics everywhere
            // it is still flat.
            let dispatched = checks_spatial::dispatched_camv(&document.crease_pattern);
            checked_vertices = Some(dispatched.checked_vertices);
            diagnostic_entries = flat_foldability_diagnostics("CheckCamv", dispatched.flat);
            diagnostic_entries.extend(spatial_closure_diagnostics(&dispatched.spatial));
            diagnostic_entries.extend(interior_border_diagnostics(
                &document.crease_pattern,
                &dispatched.interior_borders,
            ));
            0
        }
        OperationId::FlatFoldableCheck => {
            let (mut boundary, closed) = flat_foldable_boundary_from_points(
                &command.payload.points,
                command
                    .payload
                    .boundary_close_distance
                    .unwrap_or(Epsilon::UNKNOWN_1EN4),
            );
            if !closed {
                diagnostics_override = Some(vec![
                    "Flat-foldable boundary check needs a closed loop".to_string(),
                ]);
                diagnostic_entries = flat_foldable_boundary_input_diagnostics(
                    "Boundary loop is not closed",
                    "warning",
                    boundary,
                );
            } else if boundary.len() < 3 {
                diagnostics_override = Some(vec![
                    "Flat-foldable boundary check needs at least three boundary segments"
                        .to_string(),
                ]);
                diagnostic_entries = flat_foldable_boundary_input_diagnostics(
                    "Boundary loop needs at least three segments",
                    "warning",
                    boundary,
                );
            } else {
                let result =
                    checks::flat_foldable_boundary_check(&document.crease_pattern, &mut boundary);
                diagnostics_override =
                    Some(vec![flat_foldable_boundary_summary(result).to_string()]);
                diagnostic_entries = flat_foldable_boundary_result_diagnostics(result, boundary);
            }
            0
        }
        OperationId::Fix1 => {
            usize::from(operations::arrangement::fix1(&mut document.crease_pattern))
        }
        OperationId::Fix2 => {
            let before = document.crease_pattern.line_segments.clone();
            operations::arrangement::fix2(&mut document.crease_pattern);
            usize::from(document.crease_pattern.line_segments != before)
        }
        OperationId::DeleteExtraVertices => {
            let before = document.crease_pattern.line_segments.len();
            operations::arrangement::del_v_all(&mut document.crease_pattern);
            before.abs_diff(document.crease_pattern.line_segments.len())
        }
        OperationId::DeleteExtraVerticesIgnoreColor => {
            let before = document.crease_pattern.line_segments.len();
            operations::arrangement::del_v_all_color_change(&mut document.crease_pattern);
            before.abs_diff(document.crease_pattern.line_segments.len())
        }
        OperationId::FixInaccurate => {
            let line_indices = required_line_indices(&command)?;
            checks::fix_inaccurate_for_indices(
                &mut document.crease_pattern,
                &line_indices,
                fix_inaccurate_options(&command),
            )
            .num_fixed_lines
        }
        OperationId::LengthenCrease => {
            if command.payload.line_ids.len() >= 2 {
                let (selection_line, extension_point) =
                    lengthen_line_id_inputs(document, &command)?;
                operations::transform::lengthen_crease(
                    &mut document.crease_pattern,
                    selection_line,
                    extension_point,
                    selection_distance(&command),
                    operations::transform::LengthenColorMode::Current(active_line_color(&command)),
                )
            } else {
                let points = required_points(&command, 3)?;
                operations::transform::lengthen_crease(
                    &mut document.crease_pattern,
                    LineSegment::with_color(points[0], points[1], LineColor::Magenta5),
                    points[2],
                    selection_distance(&command),
                    operations::transform::LengthenColorMode::Current(active_line_color(&command)),
                )
            }
        }
        OperationId::LengthenCreaseSameColor => {
            if command.payload.line_ids.len() >= 2 {
                let (selection_line, extension_point) =
                    lengthen_line_id_inputs(document, &command)?;
                operations::transform::lengthen_crease(
                    &mut document.crease_pattern,
                    selection_line,
                    extension_point,
                    selection_distance(&command),
                    operations::transform::LengthenColorMode::SameAsOriginal,
                )
            } else {
                let points = required_points(&command, 3)?;
                operations::transform::lengthen_crease(
                    &mut document.crease_pattern,
                    LineSegment::with_color(points[0], points[1], LineColor::Magenta5),
                    points[2],
                    selection_distance(&command),
                    operations::transform::LengthenColorMode::SameAsOriginal,
                )
            }
        }
        OperationId::ReplaceLineTypeSelect => {
            let line_indices = required_line_indices(&command)?;
            operations::color::replace_line_type_for_indices(
                &mut document.crease_pattern,
                &line_indices,
                command
                    .payload
                    .custom_from_line_type
                    .unwrap_or(model::CustomLineType::Any),
                command
                    .payload
                    .custom_to_line_type
                    .unwrap_or(model::CustomLineType::Edge),
            )
        }
        OperationId::DeleteLineTypeSelect => {
            let line_indices = required_line_indices(&command)?;
            operations::color::delete_line_type_for_indices(
                &mut document.crease_pattern,
                &line_indices,
                command
                    .payload
                    .custom_line_type
                    .unwrap_or(model::CustomLineType::Any),
            )
        }
        OperationId::SelectLasso => {
            let polygon = required_selection_polygon(&command)?;
            // A plain lasso replaces the selection; a modified one adds to it
            // (matches CreaseSelect). The kernel select is otherwise additive.
            if command.payload.replace_selection.unwrap_or(false) {
                operations::selection::unselect_all(&mut document.crease_pattern);
            }
            operations::selection::select_lasso(&mut document.crease_pattern, &polygon)
        }
        OperationId::UnselectLasso => {
            let polygon = required_selection_polygon(&command)?;
            operations::selection::unselect_lasso(&mut document.crease_pattern, &polygon)
        }
        OperationId::Text => execute_text_command(document, &command)?,
        _ => {
            return Err(CommandError::NotImplemented {
                operation: command.operation,
            });
        }
    };

    let diagnostics = if let Some(diagnostics) = diagnostics_override {
        diagnostics
    } else if matches!(
        command.operation,
        OperationId::Check1
            | OperationId::Check2
            | OperationId::Check3
            | OperationId::Check4
            | OperationId::CheckCamv
            | OperationId::FlatFoldableCheck
    ) {
        vec![format!(
            "{} found {} issue(s)",
            diagnostic_operation_label(command.operation),
            diagnostic_entries.len()
        )]
    } else {
        vec![format!("Changed {changed} line(s)")]
    };

    Ok(CommandResult {
        operation: command.operation,
        status,
        diagnostics,
        diagnostic_entries,
        checked_vertices,
    })
}

fn diagnostic_operation_label(operation: OperationId) -> &'static str {
    match operation {
        OperationId::Check1 => "Check1",
        OperationId::Check2 => "Check2",
        OperationId::Check3 => "Check3",
        OperationId::Check4 => "Check4",
        OperationId::CheckCamv => "Check CAMV",
        _ => "Diagnostics",
    }
}

fn line_pair_diagnostics(
    operation: OperationId,
    kind: &str,
    message: &str,
    segments: Vec<LineSegment>,
) -> Vec<CommandDiagnostic> {
    segments
        .chunks(2)
        .enumerate()
        .map(|(index, pair)| CommandDiagnostic {
            id: format!("{kind}-{}", index + 1),
            kind: kind.to_string(),
            severity: "error".to_string(),
            message: message.to_string(),
            point: None,
            segments: pair.to_vec(),
            rule: Some(format!("{operation:?}")),
            residual_degrees: None,
            fold_angle_degrees: None,
            violation_color: None,
            big_little_big: Vec::new(),
        })
        .collect()
}

fn point_marker_diagnostics(kind: &str, markers: Vec<LineSegment>) -> Vec<CommandDiagnostic> {
    markers
        .into_iter()
        .enumerate()
        .map(|(index, marker)| CommandDiagnostic {
            id: format!("{kind}-{}", index + 1),
            kind: kind.to_string(),
            severity: "error".to_string(),
            message: "Invalid vertex flat-foldability marker".to_string(),
            point: Some(marker.a),
            segments: vec![marker],
            rule: Some("VertexFlatFoldability".to_string()),
            residual_degrees: None,
            fold_angle_degrees: None,
            violation_color: None,
            big_little_big: Vec::new(),
        })
        .collect()
}

fn flat_foldability_diagnostics(
    kind: &str,
    violations: Vec<checks::FlatFoldabilityViolation>,
) -> Vec<CommandDiagnostic> {
    violations
        .into_iter()
        .enumerate()
        .map(|(index, violation)| {
            let rule = flat_foldability_rule_label(violation.rule);
            let violation_color = flat_foldability_color_label(violation.color);
            let big_little_big = violation
                .big_little_big
                .into_iter()
                .map(|segment| CommandDiagnosticBigLittleBigSegment {
                    segment: segment.segment,
                    violating: segment.violating,
                })
                .collect::<Vec<_>>();
            let segments = big_little_big
                .iter()
                .map(|segment| segment.segment.clone())
                .collect();
            CommandDiagnostic {
                id: format!("{kind}-{}", index + 1),
                kind: kind.to_string(),
                severity: "error".to_string(),
                message: format!("Flat-foldability violation: {rule}"),
                point: Some(violation.point),
                segments,
                rule: Some(rule.to_string()),
                residual_degrees: None,
                fold_angle_degrees: None,
                violation_color: Some(violation_color.to_string()),
                big_little_big,
            }
        })
        .collect()
}

/// Closure residual bar, in degrees.
///
/// The same bar CAMV already uses. Deliberately strict: relaxing later is
/// reversible, tightening later would invalidate documents users already
/// consider valid. Measured over 124,217 vertices of real crease patterns, this
/// rejects ~42% of them -- which is the status quo, not a regression, since
/// those same patterns fail CAMV in Oriedita today for the same reason.
///
/// The checker itself returns a raw residual and never a verdict; the threshold
/// lives here, applied once, so revising it stays a one-constant change.
///
/// **Public because it was being copied.** Private, it had been redeclared in
/// five places — `examples/fold_corpus_scan.rs`, `examples/fold3d_census.rs`,
/// the since-deleted Spike A harness, `tests/verify_fold_fixtures.rs` and
/// `tests/non_flat_corpus.rs` — each with a comment saying so. Five copies of
/// one policy number is exactly what the "revising it is one constant" rule
/// above exists to prevent.
pub const CLOSURE_RESIDUAL_BAR_DEGREES: f64 = 1e-6;

/// Candidate rays for the vertex-completion tool, from whichever regime owns the
/// vertex under the cursor.
///
/// One helper for the commit and the preview, and for both gestures that offer
/// the tool (`VertexMakeAngularlyFlatFoldable`, `FoldableLineDraw`): a preview
/// that computed its candidates differently from the commit would let the user
/// pick a ray and get another.
fn vertex_completion_candidates(
    document: &CreasePatternDocument,
    command: &CreasePatternCommand,
    vertex: geometry::Point,
) -> solve_spatial::VertexCompletionCandidates {
    solve_spatial::vertex_completion_candidates(
        &document.crease_pattern,
        vertex,
        grid_width(command, &document.crease_pattern),
        active_line_color(command),
        CLOSURE_RESIDUAL_BAR_DEGREES.to_radians(),
        solve_spatial::CandidateStopTargets {
            auxiliary: command.payload.stop_on_auxiliary.unwrap_or(false),
        },
    )
}

/// What the chosen completion candidate runs to.
///
/// The tool used to ask: a third click naming the crease to extend to. It no
/// longer needs to, because the candidate was drawn to what stops it and carries
/// that line along — so the software answers its own question.
///
/// `explicit` is whatever points follow the candidate pick. **A caller that
/// still supplies one wins**, which keeps Oriedita's three-click flow working
/// for anything that asks for it — including the ability to run a crease *past*
/// the first thing in its way, which picking the nearest stop cannot express.
fn resolved_completion_destination(
    document: &CreasePatternDocument,
    command: &CreasePatternCommand,
    explicit: &[Point],
    candidates: &solve_spatial::VertexCompletionCandidates,
    selected: &LineSegment,
) -> Result<LineSegment> {
    if let Some(point) = explicit.first() {
        let (_, destination) = nearest_line_segment(
            &document.crease_pattern,
            *point,
            selection_distance(command),
        )?;
        return Ok(destination);
    }
    candidates
        .destination_for(selected)
        .cloned()
        .ok_or_else(|| CommandError::InvalidInput {
            operation: command.operation,
            message: "the chosen candidate has nothing to extend to".to_string(),
        })
}

/// The three-angle solve at the vertex under the cursor.
///
/// `line_ids` names the creases the user nominated as changeable; the solve
/// treats their current angles as unknown, so the answer does not depend on what
/// they currently say. One helper for the commit and the preview, for the same
/// reason [`vertex_completion_candidates`] is one: a preview that solved
/// differently from the commit would let the user step to one answer and apply
/// another.
fn vertex_angle_solutions(
    document: &CreasePatternDocument,
    command: &CreasePatternCommand,
) -> Result<solve_fold_angles::VertexAngleSolutions> {
    let chosen = required_line_indices(command)?;
    // The tool asks for three creases and no vertex click, because three
    // segments meeting at a point determine that point. A caller that supplies
    // one anyway wins — which is what keeps the door open for reaching this from
    // a closure diagnostic, where the vertex is what was marked.
    let vertex = match command.payload.points.first() {
        Some(point) => *point,
        None => solve_fold_angles::shared_vertex(&document.crease_pattern, &chosen).ok_or_else(
            || CommandError::InvalidInput {
                operation: command.operation,
                message: "the chosen creases do not all meet at one point".to_string(),
            },
        )?,
    };
    Ok(solve_fold_angles::vertex_angle_solutions(
        &document.crease_pattern,
        vertex,
        &chosen,
        CLOSURE_RESIDUAL_BAR_DEGREES.to_radians(),
    ))
}

/// The solution the UI is looking at, from `candidate_index`.
///
/// Defaults to the first, which is the nearest to the creases' current angles —
/// so a caller that never steps still gets the smallest change rather than
/// whichever branch the algebra emitted first.
fn chosen_angle_solution(
    command: &CreasePatternCommand,
    solved: &solve_fold_angles::VertexAngleSolutions,
) -> Result<solve_fold_angles::AngleSolution> {
    let index = command.payload.candidate_index.unwrap_or(0);
    solved
        .solutions
        .get(index)
        .copied()
        .ok_or_else(|| CommandError::InvalidInput {
            operation: command.operation,
            message: solved.no_solution.map_or_else(
                || format!("solution {index} is out of range"),
                |reason| format!("the chosen creases have no solution: {reason:?}"),
            ),
        })
}

/// Why the three-angle solve has nothing to offer, as a stable code.
///
/// Same division as [`no_completion_code`], for the same reason: eight locales
/// are gated in CI and a Rust string literal cannot pass that gate.
/// Every stable code [`no_solution_code`] can emit.
///
/// Exists so the frontend's closed union can be pinned against it. Without that,
/// the two drift silently and the user is told **nothing** — `CreasesDoNotMeet`
/// was emitted here and absent from `CP_TOOL_UNAVAILABLE_CODES` for exactly that
/// reason, and an unrecognised code returns `null` rather than complaining.
pub const NO_SOLUTION_CODES: &[&str] = &[
    "BoundaryVertex",
    "Indeterminate",
    "NotEnoughCreases",
    "CreaseNotInFan",
    "CreasesDoNotMeet",
    "TooManyUnknowns",
    "AnglesUnreachable",
];

#[cfg(test)]
pub(crate) fn no_solution_code_for_test(reason: solve_fold_angles::NoSolution) -> String {
    no_solution_code(reason)
}

fn no_solution_code(reason: solve_fold_angles::NoSolution) -> String {
    match reason {
        solve_fold_angles::NoSolution::BoundaryVertex => "BoundaryVertex",
        solve_fold_angles::NoSolution::Indeterminate => "Indeterminate",
        solve_fold_angles::NoSolution::NotEnoughCreases => "NotEnoughCreases",
        solve_fold_angles::NoSolution::CreaseNotInFan => "CreaseNotInFan",
        solve_fold_angles::NoSolution::CreasesDoNotMeet => "CreasesDoNotMeet",
        solve_fold_angles::NoSolution::TooManyUnknowns => "TooManyUnknowns",
        solve_fold_angles::NoSolution::Unreachable => "AnglesUnreachable",
    }
    .to_string()
}

/// Why the completion tool found nothing, as a stable code.
///
/// A code and not a sentence, for the reason `checks::FlatFoldabilityRule` is:
/// the frontend gates eight locales in CI and a Rust string literal cannot pass
/// that gate. Each of these is an ordinary answer rather than a failure, and each
/// wants a different next move, which is why there are four of them.
fn no_completion_code(reason: solve_spatial::NoCompletion) -> String {
    match reason {
        solve_spatial::NoCompletion::BoundaryVertex => "BoundaryVertex",
        solve_spatial::NoCompletion::Indeterminate => "Indeterminate",
        solve_spatial::NoCompletion::AlreadyClosed => "AlreadyClosed",
        solve_spatial::NoCompletion::ExceedsFullFold => "ExceedsFullFold",
        solve_spatial::NoCompletion::Overdetermined => "Overdetermined",
        solve_spatial::NoCompletion::RunsOffThePaper => "RunsOffThePaper",
    }
    .to_string()
}

/// Borders with paper on both sides.
///
/// Not a violation — a cut is a legitimate thing to draw, and kirigami is a real
/// technique. What it is, is the one place the closure check's silence does not
/// mean "this is fine": every vertex on such a loop is declined by
/// `is_interior_vertex` for touching a border, so the check returns CLEAN having
/// examined none of it. Saying so is the whole point of the entry.
///
/// A `warning`, and only on documents that carry a non-classic crease — which is
/// where the spatial check is the thing making the claim. An all-classic
/// document's `CheckCamv` output is unchanged, which is what the Oriedita oracle
/// gates.
fn interior_border_diagnostics(
    model: &CreasePatternModel,
    borders: &[checks_spatial::InteriorBorder],
) -> Vec<CommandDiagnostic> {
    borders
        .iter()
        .enumerate()
        .map(|(index, border)| CommandDiagnostic {
            id: format!("SpatialInteriorBorder-{}", index + 1),
            kind: "SpatialInteriorBorder".to_string(),
            severity: "warning".to_string(),
            message: "Border with paper on both sides: the vertices on it are not checked"
                .to_string(),
            point: Some(border.point),
            segments: model
                .line_segments
                .get(border.segment)
                .cloned()
                .into_iter()
                .collect(),
            rule: Some("InteriorBorder".to_string()),
            residual_degrees: None,
            fold_angle_degrees: None,
            violation_color: None,
            big_little_big: Vec::new(),
        })
        .collect()
}

/// The spatial half of `CheckCamv`, as diagnostic entries.
///
/// Driven by the verdict rather than by the residual, which is the change
/// `implementation-plans/never-report-silence.md` exists for. The residual test
/// alone could only say "these angles conflict"; a vertex with an undecided
/// crease has no residual to test, so it produced no entry, so the check came
/// back clean having declined to look. Both halves of that are now verdicts, and
/// one of them is an error.
///
/// # Three severities, because there are three kinds of thing to say
///
/// `error` is a vertex that cannot fold. `info` is everything the check *did not
/// decide*, and it is a separate severity rather than a quiet error because the
/// counts must not mix: a pattern a quarter of the way through design is about
/// 60% undecided, so folding those into the error count destroys the count —
/// and `countCpDiagnosticErrors`, which gates Oriedita's "continue to fold?"
/// modal, would raise it on every document mid-edit.
///
/// The `info` entries split again, and the split is the one that matters to a
/// user: [`checks_spatial::VertexVerdict::Undecided`] has an **action** — here
/// is the angle that closes it — and [`checks_spatial::VertexVerdict::Unknowable`]
/// has an **explanation**. Separate `rule` codes, so the frontend words them
/// separately and counts them separately.
///
/// [`checks_spatial::Unknowable::PaperEdge`] is the one verdict with no entry at
/// all, and it is not an oversight: it is the only one where no closure
/// condition exists, so there is nothing unexamined to report. Every 3D document
/// has a rim of them — 33 on `ALL-combined.fold` — and a row apiece saying "not
/// checked" would turn the honest answer "nothing to check here" into a standing
/// complaint. [`checks_spatial::DispatchedCamv::checked_vertices`] is where a
/// document made *entirely* of them gets caught.
fn spatial_closure_diagnostics(
    reports: &[checks_spatial::SpatialVertexReport],
) -> Vec<CommandDiagnostic> {
    let mut diagnostics = Vec::new();
    for (index, report) in reports.iter().enumerate() {
        match &report.verdict {
            // The vertex closes. Now ask the second, independent question: does
            // the paper pass through itself getting there? Only reachable once
            // closure holds, since a vertex that does not close has no folded
            // state whose geometry means anything.
            // `StackedLayers` deliberately falls through to no diagnostic: it
            // means the link cannot answer, not that anything is wrong.
            checks_spatial::VertexVerdict::Fine => {
                if report.link.is_some_and(|link| link.self_intersects()) {
                    diagnostics.push(CommandDiagnostic {
                        id: format!("SpatialSelfIntersection-{}", index + 1),
                        kind: "SpatialSelfIntersection".to_string(),
                        severity: "error".to_string(),
                        // No crossing count: it is a property of the link
                        // geometry, not something the user acts on one at a
                        // time. The fix is always to change the fold angles at
                        // this vertex.
                        message: "Paper passes through itself at this vertex".to_string(),
                        point: Some(report.point),
                        segments: Vec::new(),
                        rule: Some("SelfIntersection".to_string()),
                        residual_degrees: None,
                        fold_angle_degrees: None,
                        violation_color: None,
                        big_little_big: Vec::new(),
                    });
                }
            }
            // Rigidity is not a conflict. A degree-1 or developable degree-3
            // vertex has a unique solution and it is zero, so telling the user
            // their angles disagree would invite an adjustment that cannot help.
            // The link of a vertex is a closed spherical linkage, and a triangle
            // is a rigid truss. Worded without the degree, so the frontend can
            // translate it with no second structural field.
            checks_spatial::VertexVerdict::Broken(checks_spatial::Broken::Rigid) => {
                diagnostics.push(CommandDiagnostic {
                    id: format!("SpatialClosure-{}", index + 1),
                    kind: "SpatialClosure".to_string(),
                    severity: "error".to_string(),
                    message: "Vertex cannot fold: it is rigid, so every crease here must be 0 \
                              degrees"
                        .to_string(),
                    point: Some(report.point),
                    segments: Vec::new(),
                    rule: Some("Rigid".to_string()),
                    residual_degrees: None,
                    fold_angle_degrees: None,
                    violation_color: None,
                    big_little_big: Vec::new(),
                });
            }
            // The residual rides on `residual_degrees`, which is the one number
            // the closure sentence genuinely needs and cannot be recovered from
            // a formatted string.
            checks_spatial::VertexVerdict::Broken(checks_spatial::Broken::DoesNotClose) => {
                let residual_degrees = report.residual.unwrap_or_default().to_degrees();
                diagnostics.push(CommandDiagnostic {
                    id: format!("SpatialClosure-{}", index + 1),
                    kind: "SpatialClosure".to_string(),
                    severity: "error".to_string(),
                    message: format!("Creases do not close: {residual_degrees:.4} degrees off"),
                    point: Some(report.point),
                    segments: Vec::new(),
                    rule: Some("Closure".to_string()),
                    residual_degrees: Some(residual_degrees),
                    fold_angle_degrees: None,
                    violation_color: None,
                    big_little_big: Vec::new(),
                });
            }
            // **The entry that did not exist.** A separate rule from `Closure`,
            // because the two ask the user for different things: `Closure` says
            // the angles you set disagree, and the fix is to change one of them.
            // This says no value of the crease you have *not* set can help, and
            // the fix is elsewhere in the pattern. Reusing `Closure` would send
            // the user to adjust angles that are not the problem.
            checks_spatial::VertexVerdict::Broken(checks_spatial::Broken::NoAngleCloses {
                closest,
                ..
            }) => {
                diagnostics.push(CommandDiagnostic {
                    id: format!("SpatialClosureUnreachable-{}", index + 1),
                    kind: "SpatialClosure".to_string(),
                    severity: "error".to_string(),
                    message: match closest {
                        Some(degrees) => format!(
                            "No angle for the undecided crease here closes this vertex: the \
                             closest is {degrees:.4} degrees off"
                        ),
                        None => {
                            "No angle for the undecided crease here closes this vertex".to_string()
                        }
                    },
                    point: Some(report.point),
                    segments: Vec::new(),
                    rule: Some("ClosureUnreachable".to_string()),
                    residual_degrees: *closest,
                    fold_angle_degrees: None,
                    violation_color: None,
                    big_little_big: Vec::new(),
                });
            }
            // Not a problem: a vertex whose undecided crease has an answer. The
            // entry exists so the answer can be *read* — "set this crease to
            // -70.53 degrees" is the difference between a diagnostic and a nag,
            // and it is the sentence the owner of `failure_case.osf` needed at
            // every vertex propagation had already solved.
            checks_spatial::VertexVerdict::Undecided(undecided) => {
                // The creases are the same in every option — only the angles
                // differ — so the first option names them for all of them.
                let segments = undecided
                    .options
                    .first()
                    .map(|option| {
                        option
                            .angles
                            .iter()
                            .map(|(segment, _)| segment.clone())
                            .collect()
                    })
                    .unwrap_or_default();
                // One angle for one crease is the only shape that can be stated
                // as a value to apply. Anything else is a choice.
                let single = match undecided.options.as_slice() {
                    [only] => match only.angles.as_slice() {
                        [(_, degrees)] => Some(*degrees),
                        _ => None,
                    },
                    _ => None,
                };
                diagnostics.push(CommandDiagnostic {
                    id: format!("SpatialUndecided-{}", index + 1),
                    kind: "SpatialUndecided".to_string(),
                    severity: "info".to_string(),
                    message: match single {
                        Some(degrees) => format!(
                            "Undecided: setting this crease to {degrees:.4} degrees closes this \
                             vertex"
                        ),
                        None => "Undecided: more than one angle closes this vertex".to_string(),
                    },
                    point: Some(report.point),
                    segments,
                    rule: Some(
                        if single.is_some() {
                            "Undecided"
                        } else {
                            "UndecidedChoice"
                        }
                        .to_string(),
                    ),
                    residual_degrees: None,
                    fold_angle_degrees: single,
                    violation_color: None,
                    big_little_big: Vec::new(),
                });
            }
            // Nothing is wrong and nothing was learned. Each of these names a
            // different next move, which is why they are four rules and not one
            // — and why `PaperEdge` is none of them.
            checks_spatial::VertexVerdict::Unknowable(unknowable) => {
                let (rule, message) = match unknowable {
                    checks_spatial::Unknowable::PaperEdge => continue,
                    checks_spatial::Unknowable::UnsplitJunction => (
                        "UnsplitJunction",
                        "Not checked: a crease passes through this point without ending here",
                    ),
                    checks_spatial::Unknowable::NotEnoughCreases => (
                        "NotEnoughCreases",
                        "Not checked: fewer than three creases meet here",
                    ),
                    checks_spatial::Unknowable::TooManyUnknowns { .. } => (
                        "TooManyUnknowns",
                        "Not checked: too many undecided creases meet here",
                    ),
                    checks_spatial::Unknowable::NoUniqueAnswer { .. } => (
                        "NoUniqueAnswer",
                        "Not pinned down: many angles close this vertex",
                    ),
                };
                diagnostics.push(CommandDiagnostic {
                    id: format!("SpatialUnknowable-{}", index + 1),
                    kind: "SpatialUnknowable".to_string(),
                    severity: "info".to_string(),
                    message: message.to_string(),
                    point: Some(report.point),
                    segments: Vec::new(),
                    rule: Some(rule.to_string()),
                    residual_degrees: None,
                    fold_angle_degrees: None,
                    violation_color: None,
                    big_little_big: Vec::new(),
                });
            }
        }
    }
    diagnostics
}

fn flat_foldability_rule_label(rule: checks::FlatFoldabilityRule) -> &'static str {
    match rule {
        checks::FlatFoldabilityRule::NumberOfFolds => "NumberOfFolds",
        checks::FlatFoldabilityRule::Angles => "Angles",
        checks::FlatFoldabilityRule::Maekawa => "Maekawa",
        checks::FlatFoldabilityRule::BigLittleBig => "BigLittleBig",
        checks::FlatFoldabilityRule::None => "None",
    }
}

fn flat_foldability_color_label(color: checks::FlatFoldabilityColor) -> &'static str {
    match color {
        checks::FlatFoldabilityColor::NotEnoughMountain => "NotEnoughMountain",
        checks::FlatFoldabilityColor::NotEnoughValley => "NotEnoughValley",
        checks::FlatFoldabilityColor::Equal => "Equal",
        checks::FlatFoldabilityColor::Correct => "Correct",
        checks::FlatFoldabilityColor::Unknown => "Unknown",
    }
}

fn flat_foldable_boundary_from_points(
    points: &[Point],
    close_distance: f64,
) -> (Vec<LineSegment>, bool) {
    if points.len() < 2 {
        return (Vec::new(), false);
    }

    let mut path = Vec::new();
    for point in points {
        if path
            .last()
            .is_none_or(|last: &Point| last.distance(*point) > Epsilon::SWEET_DISTANCE)
        {
            path.push(*point);
        }
    }

    if path.len() < 2 {
        return (Vec::new(), false);
    }

    let first = path[0];
    let closed = path
        .last()
        .is_some_and(|last| first.distance(*last) <= close_distance.max(Epsilon::UNKNOWN_1EN4));
    if closed && let Some(last) = path.last_mut() {
        *last = first;
    }

    let boundary = path
        .windows(2)
        .filter_map(|window| {
            let [a, b] = window else {
                return None;
            };
            if a.distance(*b) <= Epsilon::SWEET_DISTANCE {
                return None;
            }
            Some(LineSegment::with_color(*a, *b, LineColor::Yellow7))
        })
        .collect();

    (boundary, closed)
}

fn flat_foldable_boundary_input_diagnostics(
    message: &str,
    severity: &str,
    segments: Vec<LineSegment>,
) -> Vec<CommandDiagnostic> {
    vec![CommandDiagnostic {
        id: "FlatFoldableCheck-1".to_string(),
        kind: "FlatFoldableCheck".to_string(),
        severity: severity.to_string(),
        message: message.to_string(),
        point: None,
        segments,
        rule: Some("BoundaryLoop".to_string()),
        residual_degrees: None,
        fold_angle_degrees: None,
        violation_color: None,
        big_little_big: Vec::new(),
    }]
}

fn flat_foldable_boundary_result_diagnostics(
    result: checks::FlatFoldableBoundaryCheck,
    segments: Vec<LineSegment>,
) -> Vec<CommandDiagnostic> {
    let (severity, message) = if !result.suitable_intersections {
        (
            "warning",
            "Boundary crosses existing creases at invalid intersections",
        )
    } else if result.color == LineColor::Cyan3 {
        ("info", "Boundary crossing order is flat-foldable")
    } else {
        ("error", "Boundary crossing order is not flat-foldable")
    };

    vec![CommandDiagnostic {
        id: "FlatFoldableCheck-1".to_string(),
        kind: "FlatFoldableCheck".to_string(),
        severity: severity.to_string(),
        message: message.to_string(),
        point: None,
        segments,
        rule: Some("FlatFoldableBoundary".to_string()),
        residual_degrees: None,
        fold_angle_degrees: None,
        violation_color: None,
        big_little_big: Vec::new(),
    }]
}

fn flat_foldable_boundary_summary(result: checks::FlatFoldableBoundaryCheck) -> &'static str {
    if !result.suitable_intersections {
        "Flat-foldable boundary check found invalid boundary intersections"
    } else if result.color == LineColor::Cyan3 {
        "Flat-foldable boundary check passed"
    } else {
        "Flat-foldable boundary check failed"
    }
}

/// Query transient candidate geometry for an active construction command.
pub fn preview_command(
    document: &CreasePatternDocument,
    command: CreasePatternCommand,
) -> Result<CommandPreview> {
    let status = operation_status(command.operation);
    match status {
        OperationStatus::Unsupported | OperationStatus::OutOfScopeUi => {
            return Err(CommandError::UnsupportedOperation {
                operation: command.operation,
            });
        }
        OperationStatus::Porting
        | OperationStatus::UnitTested
        | OperationStatus::OracleTested
        | OperationStatus::DocumentedDifference => {}
    }

    let mut preview = CommandPreview::default();
    let points = &command.payload.points;

    match command.operation {
        OperationId::DrawCreaseFree
        | OperationId::DrawCreaseRestricted
        | OperationId::DrawCreaseSymmetric
        | OperationId::DoubleSymmetricDraw
        | OperationId::ContinuousSymmetricDraw
        | OperationId::FishBoneDraw
        | OperationId::FoldableLineInput
        | OperationId::FoldableLineDraw
            if points.len() >= 2 =>
        {
            preview.segments.push(LineSegment::with_color(
                points[0],
                points[1],
                active_line_color(&command),
            ));
        }
        OperationId::PolygonSetNoCorners if points.len() >= 2 => {
            let mut model = CreasePatternModel::default();
            operations::generators::regular_polygon_no_corners(
                &mut model,
                points[0],
                points[1],
                polygon_corners(&command),
                active_line_color(&command),
            );
            preview.segments = model.line_segments;
        }
        // One point, so the square tracks the cursor from the moment the tool is
        // picked — which is the whole point of a tool whose result depends on
        // params you cannot read off the cursor position.
        OperationId::SquareGenerate if !points.is_empty() => {
            if let Some(corners) = square_corners_from_command(&command) {
                preview.segments =
                    operations::native::square::square_edges(&corners, active_line_color(&command))
                        .to_vec();
            }
        }
        // The defect this repairs is invisible in ink: the strokes are already
        // drawn and only the graph is wrong, so a preview that showed the
        // resulting geometry would show no change at all. What it reports
        // instead is *which* creases the click acts on — the halves, so the
        // surface can light up the affected span — and the vertex itself, only
        // when there is one to insert.
        OperationId::VertexInsertOnCreases if !points.is_empty() => {
            let splits = operations::native::vertex_insert::plan_vertex_insert(
                &document.crease_pattern,
                points[0],
            );
            if splits.is_empty() {
                preview.unavailable = Some("NoCreaseThroughPoint".to_owned());
            } else {
                preview.points.push(points[0]);
                preview.segments = splits
                    .into_iter()
                    .flat_map(|split| [split.first, split.second])
                    .collect();
            }
        }
        OperationId::DrawBlintz
        | OperationId::DrawFishBase
        | OperationId::DrawDoveBase
        | OperationId::DrawBirdBase
        | OperationId::DrawFrogBase
            if points.len() >= 2 =>
        {
            if let Some(molecule) = default_molecule_for_operation(command.operation) {
                let mut model = CreasePatternModel::default();
                if operations::generators::default_molecule(
                    &mut model,
                    molecule,
                    points[0],
                    points[1],
                    active_line_color(&command),
                )
                .is_ok()
                {
                    preview.segments = model.line_segments;
                }
            }
        }
        OperationId::VoronoiCreate if !points.is_empty() => {
            let state = voronoi_state_from_points(&document.crease_pattern, &command);
            preview.segments = state
                .line_segments
                .iter()
                .map(|line| line.line_segment.with_line_color(LineColor::Magenta5))
                .collect();
            preview.points = state.seed_points;
        }
        OperationId::CircleDraw | OperationId::CircleDrawFree if points.len() >= 2 => {
            preview.circles.push(Circle::from_center(
                points[0],
                points[0].distance(points[1]),
                LineColor::Cyan3,
            ));
        }
        OperationId::CircleDrawSeparate if points.len() >= 3 => {
            preview.circles.push(Circle::from_center(
                points[0],
                points[1].distance(points[2]),
                LineColor::Cyan3,
            ));
        }
        OperationId::CircleDrawThreePoint if points.len() >= 3 => {
            let mut model = CreasePatternModel::default();
            operations::circle::through_three_points(&mut model, points[0], points[1], points[2]);
            preview.circles = model.circles;
        }
        OperationId::CircleDrawTangentLine => {
            let circle_indices = optional_circle_indices(&command)?;
            if circle_indices.len() >= 2 {
                let circle1 = circle_for_operation(document, command.operation, circle_indices[0])?;
                let circle2 = circle_for_operation(document, command.operation, circle_indices[1])?;
                preview.segments = operations::circle::tangent_lines_two_circles(circle1, circle2);
            } else if circle_indices.len() == 1 && !points.is_empty() {
                let circle = circle_for_operation(document, command.operation, circle_indices[0])?;
                preview.segments = operations::circle::tangent_lines_point_circle(
                    &document.crease_pattern,
                    points[0],
                    circle,
                );
            }
        }
        OperationId::CircleDrawInverted => {
            let circle_indices = optional_circle_indices(&command)?;
            let mut model = CreasePatternModel::default();
            if let Some(line_id) = command.payload.line_ids.first() {
                if !circle_indices.is_empty() {
                    let line_index =
                        line_id
                            .checked_sub(1)
                            .ok_or_else(|| CommandError::InvalidInput {
                                operation: command.operation,
                                message: "line IDs are one-based".to_string(),
                            })?;
                    let segment =
                        line_segment_for_operation(document, command.operation, line_index)?;
                    let inversion =
                        circle_for_operation(document, command.operation, circle_indices[0])?;
                    operations::circle::invert_line_segment(&mut model, &segment, inversion);
                }
            } else if circle_indices.len() >= 2 {
                let subject = circle_for_operation(document, command.operation, circle_indices[0])?;
                let inversion =
                    circle_for_operation(document, command.operation, circle_indices[1])?;
                operations::circle::invert_circle(&mut model, subject, inversion);
            }
            preview.segments = model.line_segments;
            preview.circles = model.circles;
        }
        OperationId::CircleDrawConcentric if points.len() >= 2 => {
            let circle_indices = optional_circle_indices(&command)?;
            if let Some(index) = circle_indices.first() {
                let circle = circle_for_operation(document, command.operation, *index)?;
                preview.circles.push(Circle::from_center(
                    circle.determine_center(),
                    circle.r + points[0].distance(points[1]),
                    LineColor::Cyan3,
                ));
            }
        }
        OperationId::CircleDrawConcentricSelect => {
            let circle_indices = optional_circle_indices(&command)?;
            if circle_indices.len() >= 3 {
                let target = circle_for_operation(document, command.operation, circle_indices[0])?;
                let reference1 =
                    circle_for_operation(document, command.operation, circle_indices[1])?;
                let reference2 =
                    circle_for_operation(document, command.operation, circle_indices[2])?;
                preview.circles = operations::circle::concentric_select_candidates(
                    target, reference1, reference2,
                );
            }
        }
        OperationId::CircleDrawConcentricTwoCircleSelect => {
            let circle_indices = optional_circle_indices(&command)?;
            if circle_indices.len() >= 2 {
                let circle1 = circle_for_operation(document, command.operation, circle_indices[0])?;
                let circle2 = circle_for_operation(document, command.operation, circle_indices[1])?;
                let mut model = CreasePatternModel::default();
                operations::circle::concentric_two_circle_select(&mut model, circle1, circle2);
                preview.circles = model.circles;
            }
        }
        OperationId::Inward if points.len() >= 3 => {
            let center = geometry::center(points[0], points[1], points[2]);
            preview.segments.extend(
                points.iter().take(3).map(|point| {
                    LineSegment::with_color(*point, center, active_line_color(&command))
                }),
            );
        }
        OperationId::PerpendicularDraw if points.len() >= 2 => {
            let (_, base) = nearest_line_segment(
                &document.crease_pattern,
                points[1],
                selection_distance(&command),
            )?;
            if let Some(indicator) = operations::construction::perpendicular_indicator(
                &document.crease_pattern,
                points[0],
                &base,
            ) {
                preview.segments.push(indicator);
            } else {
                preview.segments.push(LineSegment::with_color(
                    points[0],
                    geometry::find_projection(
                        geometry::StraightLine::from_segment(&base),
                        points[0],
                    ),
                    active_line_color(&command),
                ));
            }
        }
        OperationId::DrawCreaseAngleRestricted if points.len() >= 2 => {
            let segment = LineSegment::new(points[0], points[1]);
            let candidates = operations::construction::angle_restricted_converging_candidates(
                &segment,
                angle_system_divider(&command),
                angle_system_angles(&command),
            );
            preview.segments = candidates.indicators;
            preview.points = candidates.intersections.clone();
            // Converge hover (3rd point): preview the two result creases to the
            // nearest intersection, matching Oriedita's live result lines.
            if points.len() >= 3
                && let Ok(converge) =
                    nearest_candidate_point(&command, points[2], &candidates.intersections)
            {
                let color = active_line_color(&command);
                preview
                    .segments
                    .push(LineSegment::with_color(segment.a, converge, color));
                preview
                    .segments
                    .push(LineSegment::with_color(segment.b, converge, color));
            }
        }
        OperationId::AngleSystem if points.len() >= 2 => {
            preview.segments = operations::construction::angle_system_candidates(
                points[0],
                points[1],
                angle_system_divider(&command),
                angle_system_angles(&command),
            );
        }
        OperationId::DrawCreaseAngleRestricted3 if points.len() >= 2 => {
            preview.segments = operations::construction::draw_crease_angle_restricted_3_candidates(
                points[0],
                points[1],
                angle_system_divider(&command),
                angle_system_angles(&command),
            );
        }
        OperationId::DrawCreaseAngleRestricted5 if points.len() >= 2 => {
            let release = operations::construction::snap_to_close_point_in_active_angle_system(
                &document.crease_pattern,
                points[0],
                points[1],
                angle_system_divider(&command),
                angle_system_angles(&command),
                snap_policy(&command, &document.crease_pattern),
            );
            preview.segments.push(LineSegment::with_color(
                points[0],
                release.point,
                active_line_color(&command),
            ));
            // Only when it landed on a real vertex or grid point: the surface
            // rings these, and a ring on the bare projection would promise a
            // snap that did not happen.
            if release.snapped {
                preview.points.push(release.point);
            }
        }
        OperationId::PropagateFoldAngles => {
            let draft = match propagation_draft(document, &command)? {
                PropagationDraft::Declined(code) => {
                    preview.propagation_solved = Some(0);
                    preview.unavailable = Some(code.to_owned());
                    return Ok(preview);
                }
                PropagationDraft::Ready(draft) => draft,
            };
            // The draft creases as they would become, carrying their solved
            // colour and magnitude so the canvas ramp and the angle badges show
            // what confirming would do — the same channel the three-crease
            // solver uses, and the reason this operation must be in
            // `CP_KERNEL_DECIDED_CANDIDATE_OPERATIONS` on the frontend.
            //
            // The id and the geometry are pushed together, from one loop, so a
            // skipped entry skips both and the caller can zip the two lists.
            // Two loops with a `continue` each is exactly how a parallel-array
            // contract rots.
            //
            // Order is the order the draft resolved in — pins first, then
            // outward from the seed — which is the order the user watched it
            // spread in.
            for &(index, degrees) in &draft.solved {
                let Some(segment) = document.crease_pattern.line_segments.get(index) else {
                    continue;
                };
                preview.propagation_creases.push(PropagationDraftCrease {
                    line_id: index + 1,
                    degrees,
                });
                // The commit's own write. Propagation applies through
                // `set_signed_fold_angles`, so previewing anything but
                // `with_signed_fold_angle` would be a second statement of the
                // same rule sitting next to the first — which is how the
                // three-angle solve's preview came to disagree with its commit.
                preview
                    .segments
                    .push(segment.with_signed_fold_angle(degrees));
            }
            // Counted off the emitted list rather than the draft, so the scalar
            // cannot claim more creases than the preview actually names.
            let named = preview.propagation_creases.len();
            // **Scope-relative.** Counted from the creases inside the scope, not
            // from the document: a window saying "still undecided: 40" over a
            // draft that covers one of five patterns is reporting the canvas.
            let still_free = draft.scope.free.saturating_sub(named);
            preview.propagation_solved = Some(named);
            preview.propagation_free = Some(still_free);
            preview.propagation_stalls = draft
                .stalls
                .iter()
                .map(|stall| PropagationStall {
                    point: stall.point,
                    reason: stall_reason_code(stall.reason).to_owned(),
                    unknowns: stall.unknowns,
                })
                .collect();
            preview.propagation_conflicts = draft.closure_failures.clone();
            // Vertices left alone because some of their unknowns sit outside the
            // scope. Computed once: the scope report carries it, and the
            // `unavailable` code below turns on it.
            let out_of_scope = draft
                .stalls
                .iter()
                .filter(|stall| {
                    stall.reason == operations::native::fold_propagation::StallReason::OutOfScope
                })
                .count();
            let answered_flat = draft
                .stalls
                .iter()
                .filter(|stall| {
                    stall.reason == operations::native::fold_propagation::StallReason::AnsweredFlat
                })
                .count();
            preview.propagation_scope = Some(PropagationScope {
                kind: scope_kind_code(draft.scope.kind).to_owned(),
                creases: draft.scope.creases,
                vertices: draft.scope.vertices,
                free: still_free,
                out_of_scope,
            });
            if named == 0 {
                use operations::native::fold_propagation::ScopeKind;
                preview.unavailable = Some(
                    match (draft.scope.free == 0, draft.scope.kind) {
                        // Not `PropagationNothingFree`: its sentence is "every
                        // crease already has a fold angle", which is a lie when
                        // the rest of the canvas is full of unassigned creases
                        // and the user simply selected the wrong ones. Different
                        // next move, different code.
                        (true, ScopeKind::Selection) => "PropagationSelectionNothingFree",
                        (true, _) => "PropagationNothingFree",
                        // The scope is *why* nothing came out: a vertex here has
                        // unknowns the scope excludes, and half a simultaneous
                        // answer is not an answer. The next move is to widen the
                        // selection, which the generic "give one more crease an
                        // angle" sentence sends the user away from — and this is
                        // the ordinary outcome of propagating in a small
                        // selection, not a corner. Ranked below the two above
                        // because with nothing free in scope there is nothing to
                        // solve here whatever lies outside it.
                        (false, _) if out_of_scope > 0 => "PropagationOutOfScope",
                        // Ahead of the generic sentence, which asks for another
                        // angle. Nothing more is wanted here: these vertices are
                        // solved, and their answer is that the creases do not
                        // fold, so there is no angle to give and no crease to
                        // decide. Ranked below `OutOfScope` because a vertex the
                        // scope excluded is a thing the user can still act on.
                        (false, _) if answered_flat > 0 => "PropagationAnsweredFlat",
                        (false, _) => "PropagationNothingDecidable",
                    }
                    .to_owned(),
                );
            }
        }
        OperationId::VertexSolveFoldAngles => {
            // Fewer than three creases picked is the *normal* state for the
            // first two steps, not a failure — the tool is still collecting, and
            // it previews nothing until it has something to say.
            //
            // **This must not hand back the existing creases.** An earlier
            // version returned the ones that would complete a solvable triple,
            // as a "these are pickable" affordance, and the frontend drew them
            // through the highlight channel — which strokes in the selection
            // accent, a blue. Every mountain at the vertex therefore read as a
            // valley for as long as two creases were picked. The affordance is
            // worth having; a channel whose only vocabulary is repainting the
            // crease is not the way to show it.
            // [`solve_fold_angles::solvable_partners`] still computes it, for
            // whatever surface finally does.
            let chosen = optional_line_indices(&command)?;
            if chosen.len() >= 3 {
                let solved = vertex_angle_solutions(document, &command)?;
                preview.unavailable = solved.no_solution.map(no_solution_code);
                preview.candidate_count = Some(solved.isolated_count);
                if let Ok(solution) = chosen_angle_solution(&command, &solved) {
                    preview.candidate_is_family = Some(!solution.isolated);
                    preview.candidate_is_current = Some(solution.is_current);
                    preview.candidate_contradicts_hint = Some(solution.contradicts_a_hint());
                    preview.candidate_leaves_undecided = Some(solution.leaves_any_undecided());
                    // The vertex the solve is about, so a UI anchored to it does
                    // not have to re-derive which endpoint the three creases
                    // share and risk disagreeing with the solve about it.
                    if let Some(vertex) =
                        solve_fold_angles::shared_vertex(&document.crease_pattern, &chosen)
                    {
                        preview.points.push(vertex);
                    }
                    // The three creases as they would become: same geometry,
                    // carrying the solved colour and angle, so the ramp and the
                    // angle badges say what applying would do.
                    //
                    // Emitted **in the order the creases were picked**, not in
                    // the fan order the solver works in, so a caller can zip
                    // them against its own `line_ids` without matching on
                    // geometry. Matching would be the alternative and it is a
                    // worse one: the segments are clones, so it would compare
                    // endpoints that round-tripped through a serialiser.
                    for line in &chosen {
                        let Some((index, degrees)) = solution
                            .creases
                            .iter()
                            .find(|(index, _)| index == line)
                            .copied()
                        else {
                            continue;
                        };
                        let Some(segment) = document.crease_pattern.line_segments.get(index) else {
                            continue;
                        };
                        // The commit's own write, not a restatement of it. A
                        // restatement is what this was, and it disagreed with
                        // the commit on the only inputs anyone noticed.
                        preview
                            .segments
                            .push(segment.with_signed_fold_angle(degrees));
                    }
                }
            }
        }
        OperationId::VertexMakeAngularlyFlatFoldable if !points.is_empty() => {
            let candidates = vertex_completion_candidates(document, &command, points[0]);
            // "Overdetermined" is the ordinary answer on a freely-angled vertex,
            // not an error, and an empty canvas would read as a broken tool.
            preview.unavailable = candidates.no_completion.map(no_completion_code);
            if points.len() >= 3 {
                // Step 3: a candidate ray is chosen — show only it, plus the crease
                // that would be committed to the hovered destination (best-effort).
                if let Ok(selected) =
                    nearest_candidate_segment(&command, points[1], &candidates.candidates)
                {
                    preview.segments.push(selected.clone());
                    if let Ok(destination) = resolved_completion_destination(
                        document,
                        &command,
                        &points[2..],
                        &candidates,
                        &selected,
                    ) {
                        let mut clone = document.clone();
                        let (color, fold_magnitude) = candidates.commit_style(&selected);
                        if operations::construction::make_vertex_flat_foldable_to_destination(
                            &mut clone.crease_pattern,
                            points[0],
                            &selected,
                            &destination,
                            color,
                            fold_magnitude,
                        ) {
                            preview.segments.extend(
                                clone
                                    .crease_pattern
                                    .line_segments
                                    .into_iter()
                                    .skip(document.crease_pattern.line_segments.len()),
                            );
                        }
                    }
                }
            } else {
                // Steps 1–2: show every candidate ray so the user can pick one.
                preview.segments = candidates.candidates;
            }
        }
        OperationId::ParallelDraw if points.len() >= 2 => {
            let (_, parallel_segment) = nearest_line_segment(
                &document.crease_pattern,
                points[1],
                selection_distance(&command),
            )?;
            preview.segments.push(LineSegment::with_color(
                points[0],
                Point::new(
                    points[0].x + parallel_segment.determine_bx() - parallel_segment.determine_ax(),
                    points[0].y + parallel_segment.determine_by() - parallel_segment.determine_ay(),
                ),
                active_line_color(&command),
            ));
        }
        OperationId::ParallelDrawWidth if points.len() >= 2 => {
            let selected_segment = required_or_nearest_line_segment(document, &command)?;
            let width = command
                .payload
                .width
                .filter(|width| width.is_finite() && *width > 0.0)
                .unwrap_or_else(|| determine_line_segment_distance(points[1], &selected_segment));
            preview.segments =
                operations::construction::parallel_width_indicators(&selected_segment, width)
                    .into_iter()
                    .collect();
        }
        OperationId::Axiom5 if points.len() >= 3 => {
            let (_, target_segment) = nearest_line_segment(
                &document.crease_pattern,
                points[1],
                selection_distance(&command),
            )?;
            if let Some(indicators) = operations::construction::axiom5_indicators(
                &document.crease_pattern,
                points[0],
                &target_segment,
                points[2],
            ) {
                preview.segments = indicators.into_iter().collect();
            }
        }
        OperationId::Axiom7 if points.len() >= 3 => {
            let (_, target_segment) = nearest_line_segment(
                &document.crease_pattern,
                points[1],
                selection_distance(&command),
            )?;
            let (_, perpendicular_segment) = nearest_line_segment(
                &document.crease_pattern,
                points[2],
                selection_distance(&command),
            )?;
            if let Some(indicator) = operations::construction::axiom7_indicator(
                &document.crease_pattern,
                points[0],
                &target_segment,
                &perpendicular_segment,
            ) {
                preview.segments.push(indicator);
            }
        }
        OperationId::SquareBisector if points.len() >= 3 => {
            // 3 points placed: show the bisector direction from the vertex (points[1])
            // through the incenter as you position them.
            let center = geometry::center(points[0], points[1], points[2]);
            preview.segments.push(LineSegment::with_color(
                points[1],
                center,
                active_line_color(&command),
            ));
            // Destination hover (4th point): preview the actual bisector crease drawn
            // to the nearest existing line.
            if points.len() >= 4
                && let Ok((_, destination)) = nearest_line_segment(
                    &document.crease_pattern,
                    points[3],
                    selection_distance(&command),
                )
            {
                let mut clone = document.clone();
                if operations::construction::square_bisector_from_points_to_destination(
                    &mut clone.crease_pattern,
                    points[0],
                    points[1],
                    points[2],
                    &destination,
                    active_line_color(&command),
                ) {
                    preview.segments.extend(
                        clone
                            .crease_pattern
                            .line_segments
                            .into_iter()
                            .skip(document.crease_pattern.line_segments.len()),
                    );
                }
            }
        }
        OperationId::SymmetricDraw if points.len() >= 2 => {
            // Best-effort: while a point-mode sequence is mid-placement it briefly
            // carries 2 points, which resolves as line mode and may find no crease —
            // skip the preview then rather than surfacing an error.
            if let Ok((source, mirror)) =
                symmetric_draw_lines(&document.crease_pattern, &command, points)
            {
                let mut clone = document.clone();
                if operations::construction::symmetric_draw(
                    &mut clone.crease_pattern,
                    &source,
                    &mirror,
                    active_line_color(&command),
                ) {
                    preview.segments = clone
                        .crease_pattern
                        .line_segments
                        .into_iter()
                        .skip(document.crease_pattern.line_segments.len())
                        .collect();
                }
            }
        }
        // Measure tools are non-mutating: the preview carries the length/angle value
        // (parity math from operations::measure) plus a guide line the surface dashes.
        OperationId::DisplayLengthBetweenPoints1 | OperationId::DisplayLengthBetweenPoints2
            if points.len() >= 2 =>
        {
            preview.measurement = Some(operations::measure::length_between_points(
                points[0], points[1],
            ));
            preview.segments.push(LineSegment::with_color(
                points[0],
                points[1],
                active_line_color(&command),
            ));
        }
        OperationId::DisplayAngleBetweenThreePoints1
        | OperationId::DisplayAngleBetweenThreePoints2
        | OperationId::DisplayAngleBetweenThreePoints3
            if points.len() >= 3 =>
        {
            // Vertex is the 2nd point; rays go to the 1st and 3rd.
            preview.measurement = Some(operations::measure::angle_between_three_points(
                points[0], points[1], points[2],
            ));
            let color = active_line_color(&command);
            preview
                .segments
                .push(LineSegment::with_color(points[1], points[0], color));
            preview
                .segments
                .push(LineSegment::with_color(points[1], points[2], color));
        }
        _ => {
            if points.len() >= 2 {
                preview.segments.push(LineSegment::with_color(
                    points[points.len() - 2],
                    points[points.len() - 1],
                    active_line_color(&command),
                ));
            }
        }
    }

    Ok(preview)
}

fn required_line_indices(command: &CreasePatternCommand) -> Result<Vec<usize>> {
    if command.payload.line_ids.is_empty() {
        return Err(CommandError::InvalidInput {
            operation: command.operation,
            message: "select at least one line".to_string(),
        });
    }

    command
        .payload
        .line_ids
        .iter()
        .map(|line_id| {
            line_id
                .checked_sub(1)
                .ok_or_else(|| CommandError::InvalidInput {
                    operation: command.operation,
                    message: "line IDs are one-based".to_string(),
                })
        })
        .collect()
}

fn lengthen_line_id_inputs(
    document: &CreasePatternDocument,
    command: &CreasePatternCommand,
) -> Result<(LineSegment, Point)> {
    let line_indices = required_line_indices(command)?;
    if line_indices.len() < 2 {
        return Err(CommandError::InvalidInput {
            operation: command.operation,
            message: "select a line to extend and a target line".to_string(),
        });
    }

    let source = line_segment_for_operation(document, command.operation, line_indices[0])?;
    let target = line_segment_for_operation(document, command.operation, line_indices[1])?;
    let source_point = mid_point(source.a, source.b);
    let target_point = mid_point(target.a, target.b);

    Ok((
        LineSegment::with_color(source_point, source_point, LineColor::Magenta5),
        target_point,
    ))
}

fn optional_line_indices(command: &CreasePatternCommand) -> Result<Vec<usize>> {
    command
        .payload
        .line_ids
        .iter()
        .map(|line_id| {
            line_id
                .checked_sub(1)
                .ok_or_else(|| CommandError::InvalidInput {
                    operation: command.operation,
                    message: "line IDs are one-based".to_string(),
                })
        })
        .collect()
}

fn optional_circle_indices(command: &CreasePatternCommand) -> Result<Vec<usize>> {
    command
        .payload
        .circle_ids
        .iter()
        .map(|circle_id| {
            circle_id
                .checked_sub(1)
                .ok_or_else(|| CommandError::InvalidInput {
                    operation: command.operation,
                    message: "circle IDs are one-based".to_string(),
                })
        })
        .collect()
}

fn required_circle_indices_at_least(
    command: &CreasePatternCommand,
    count: usize,
) -> Result<Vec<usize>> {
    if command.payload.circle_ids.len() < count {
        return Err(CommandError::InvalidInput {
            operation: command.operation,
            message: format!("select at least {count} circle(s)"),
        });
    }
    optional_circle_indices(command)
}

fn required_text_indices(command: &CreasePatternCommand) -> Result<Vec<usize>> {
    if command.payload.text_ids.is_empty() {
        return Err(CommandError::InvalidInput {
            operation: command.operation,
            message: "select at least one text annotation".to_string(),
        });
    }

    command
        .payload
        .text_ids
        .iter()
        .map(|text_id| {
            text_id
                .checked_sub(1)
                .ok_or_else(|| CommandError::InvalidInput {
                    operation: command.operation,
                    message: "text IDs are one-based".to_string(),
                })
        })
        .collect()
}

fn required_points(command: &CreasePatternCommand, count: usize) -> Result<Vec<geometry::Point>> {
    if command.payload.points.len() != count {
        return Err(CommandError::InvalidInput {
            operation: command.operation,
            message: format!("expected {count} resolved point(s)"),
        });
    }
    Ok(command.payload.points.clone())
}

fn required_points_at_least(
    command: &CreasePatternCommand,
    count: usize,
) -> Result<Vec<geometry::Point>> {
    if command.payload.points.len() < count {
        return Err(CommandError::InvalidInput {
            operation: command.operation,
            message: format!("expected at least {count} resolved point(s)"),
        });
    }
    Ok(command.payload.points.clone())
}

fn required_selection_polygon(command: &CreasePatternCommand) -> Result<Polygon> {
    let points = required_points_at_least(command, 2)?;
    if points.len() == 2 {
        return Ok(rectangle_polygon(points[0], points[1]));
    }
    Ok(Polygon::new(points))
}

fn rectangle_polygon(a: geometry::Point, b: geometry::Point) -> Polygon {
    let min_x = a.x.min(b.x);
    let max_x = a.x.max(b.x);
    let min_y = a.y.min(b.y);
    let max_y = a.y.max(b.y);
    Polygon::new(vec![
        geometry::Point::new(min_x, min_y),
        geometry::Point::new(max_x, min_y),
        geometry::Point::new(max_x, max_y),
        geometry::Point::new(min_x, max_y),
    ])
}

fn active_line_color(command: &CreasePatternCommand) -> LineColor {
    command.payload.line_color.unwrap_or(LineColor::Red1)
}

fn angle_system_divider(command: &CreasePatternCommand) -> i32 {
    command
        .payload
        .angle_system_divider
        .filter(|divider| *divider >= 0)
        .unwrap_or(DEFAULT_ANGLE_SYSTEM_DIVIDER)
}

fn angle_system_angles(command: &CreasePatternCommand) -> [f64; 6] {
    command
        .payload
        .angles
        .unwrap_or(DEFAULT_ANGLE_SYSTEM_ANGLES)
}

fn selection_distance(command: &CreasePatternCommand) -> f64 {
    command
        .payload
        .selection_distance
        .filter(|distance| distance.is_finite() && *distance > 0.0)
        .unwrap_or(DEFAULT_SELECTION_DISTANCE)
}

fn snap_policy(command: &CreasePatternCommand, model: &CreasePatternModel) -> model::SnapPolicy {
    model::SnapPolicy {
        selection_distance: selection_distance(command),
        candidates: command
            .payload
            .snap_candidates
            .unwrap_or_else(|| model::SnapCandidates::upstream(&model.grid)),
    }
}

fn grid_width(command: &CreasePatternCommand, model: &CreasePatternModel) -> f64 {
    command
        .payload
        .grid_width
        .filter(|width| width.is_finite() && *width > 0.0)
        .unwrap_or_else(|| {
            let grid_size = f64::from(model.grid.grid_size.max(1));
            ORIEDITA_PAPER_SIZE / grid_size
        })
}

fn division_count(command: &CreasePatternCommand) -> usize {
    command
        .payload
        .division_count
        .filter(|count| *count > 0)
        .unwrap_or(DEFAULT_LINE_DIVISION_COUNT)
}

fn ratio_s(command: &CreasePatternCommand) -> f64 {
    command
        .payload
        .ratio_s
        .filter(|ratio| ratio.is_finite() && *ratio >= 0.0)
        .unwrap_or(DEFAULT_LINE_RATIO)
}

fn ratio_t(command: &CreasePatternCommand) -> f64 {
    command
        .payload
        .ratio_t
        .filter(|ratio| ratio.is_finite() && *ratio >= 0.0)
        .unwrap_or(DEFAULT_LINE_RATIO)
}

fn polygon_corners(command: &CreasePatternCommand) -> usize {
    command
        .payload
        .polygon_corners
        .filter(|corners| *corners >= 3)
        .unwrap_or(DEFAULT_POLYGON_CORNERS)
}

/// The square a `SquareGenerate` command describes, or `None` when its extent is
/// unusable.
///
/// One resolver for both the commit and the preview, so the shape the user sees
/// under the cursor is the shape the click makes.
fn square_corners_from_command(command: &CreasePatternCommand) -> Option<[geometry::Point; 4]> {
    operations::native::square::square_corners(
        *command.payload.points.first()?,
        command.payload.square_extent?,
        command.payload.square_orientation.unwrap_or_default(),
        command.payload.square_anchor.unwrap_or_default(),
    )
}

fn default_molecule_for_operation(
    operation: OperationId,
) -> Option<operations::generators::DefaultMolecule> {
    match operation {
        OperationId::DrawBlintz => Some(operations::generators::DefaultMolecule::Blintz),
        OperationId::DrawFishBase => Some(operations::generators::DefaultMolecule::FishBase),
        OperationId::DrawDoveBase => Some(operations::generators::DefaultMolecule::DoveBase),
        OperationId::DrawBirdBase => Some(operations::generators::DefaultMolecule::BirdBase),
        OperationId::DrawFrogBase => Some(operations::generators::DefaultMolecule::FrogBase),
        _ => None,
    }
}

fn voronoi_state_from_points(
    model: &CreasePatternModel,
    command: &CreasePatternCommand,
) -> operations::generators::VoronoiState {
    let mut state = operations::generators::VoronoiState::default();
    let selection_distance = selection_distance(command);
    for point in &command.payload.points {
        operations::generators::voronoi_press(model, &mut state, *point, selection_distance);
    }
    state
}

fn execute_text_command(
    document: &mut CreasePatternDocument,
    command: &CreasePatternCommand,
) -> Result<usize> {
    match command
        .payload
        .text_action
        .unwrap_or(TextCommandAction::Create)
    {
        TextCommandAction::Create => {
            let points = required_points(command, 1)?;
            let before = document.crease_pattern.texts.len();
            let mut state = operations::text::TextSelectionState::default();
            operations::text::text_create_or_select_pressed(
                &mut document.crease_pattern,
                &mut state,
                points[0],
            );
            if document.crease_pattern.texts.len() > before {
                if let Some(content) = &command.payload.text_content
                    && let Some(text) = document.crease_pattern.texts.last_mut()
                {
                    text.text = content.clone();
                }
                return Ok(1);
            }
            Ok(0)
        }
        TextCommandAction::CreateAt => {
            let points = required_points(command, 1)?;
            let content = command.payload.text_content.clone().unwrap_or_default();
            document.crease_pattern.add_text(model::TextElement::new(
                points[0].x,
                points[0].y,
                content,
            ));
            Ok(1)
        }
        TextCommandAction::Move => {
            let text_indices = required_text_indices(command)?;
            let points = required_points(command, 2)?;
            let before = document.crease_pattern.texts.clone();
            let mut state = operations::text::TextSelectionState {
                selected: text_indices.first().copied(),
                is_selected: true,
                dirty: false,
                selection_start: Some(points[0]),
            };
            operations::text::text_drag_selected(
                &mut document.crease_pattern,
                &mut state,
                points[1],
            );
            Ok(usize::from(document.crease_pattern.texts != before))
        }
        TextCommandAction::SetContent => {
            let text_indices = required_text_indices(command)?;
            let content = command.payload.text_content.clone().unwrap_or_default();
            let mut changed = 0;
            for index in text_indices {
                let Some(text) = document.crease_pattern.texts.get_mut(index) else {
                    continue;
                };
                if text.text != content {
                    text.text = content.clone();
                    changed += 1;
                }
            }
            Ok(changed)
        }
        TextCommandAction::DeleteSelected => {
            let mut text_indices = required_text_indices(command)?;
            text_indices.sort_unstable();
            text_indices.dedup();
            let mut deleted = 0;
            for index in text_indices.into_iter().rev() {
                if index < document.crease_pattern.texts.len() {
                    document.crease_pattern.texts.remove(index);
                    deleted += 1;
                }
            }
            Ok(deleted)
        }
        TextCommandAction::DeleteAt => {
            let points = required_points(command, 1)?;
            let mut state = operations::text::TextSelectionState::default();
            Ok(usize::from(operations::text::text_delete_at(
                &mut document.crease_pattern,
                &mut state,
                points[0],
            )))
        }
        TextCommandAction::DeleteBox => {
            let points = required_points(command, 2)?;
            let mut state = operations::text::TextSelectionState::default();
            Ok(operations::text::text_delete_box(
                &mut document.crease_pattern,
                &mut state,
                points[0],
                points[1],
            ))
        }
    }
}

fn custom_circle_color(command: &CreasePatternCommand) -> RgbColor {
    command
        .payload
        .custom_circle_color
        .unwrap_or_else(|| RgbColor::new(100, 200, 200))
}

fn fix_inaccurate_options(command: &CreasePatternCommand) -> checks::FixInaccurateOptions {
    let defaults = checks::FixInaccurateOptions::default();
    checks::FixInaccurateOptions {
        fix_precision: command
            .payload
            .fix_precision
            .filter(|precision| precision.is_finite() && *precision >= 0.0)
            .unwrap_or(defaults.fix_precision),
        use_bp: command
            .payload
            .fix_precision_use_bp
            .unwrap_or(defaults.use_bp),
        use_22_5: command
            .payload
            .fix_precision_use_22_5
            .unwrap_or(defaults.use_22_5),
    }
}

fn set_selected_line_flags(model: &mut CreasePatternModel, line_indices: &[usize]) {
    operations::selection::unselect_all(model);
    operations::selection::select_indices(model, line_indices);
}

/// Resolve Mirror Line's two construction lines from the clicked points. Oriedita's
/// SymmetricDraw has two modes — the frontend picks by "first click decides":
/// 3 points ABC → mirror segment AB over the line BC (point mode; the segments meet
/// at B, so `symmetric_draw` reflects A across BC); 2 points → each resolves to the
/// nearest existing crease and we mirror source over mirror (line mode). Only the
/// point count differs, so both feed the same mode-agnostic `symmetric_draw`.
fn symmetric_draw_lines(
    model: &CreasePatternModel,
    command: &CreasePatternCommand,
    points: &[Point],
) -> Result<(LineSegment, LineSegment)> {
    if points.len() >= 3 {
        Ok((
            LineSegment::new(points[0], points[1]),
            LineSegment::new(points[1], points[2]),
        ))
    } else {
        let (_, source) = nearest_line_segment(model, points[0], selection_distance(command))?;
        let (_, mirror) = nearest_line_segment(model, points[1], selection_distance(command))?;
        Ok((source, mirror))
    }
}

fn nearest_line_segment(
    model: &CreasePatternModel,
    point: Point,
    max_distance: f64,
) -> Result<(usize, LineSegment)> {
    let mut best: Option<(usize, LineSegment, f64)> = None;
    for (index, segment) in model.line_segments.iter().enumerate() {
        let distance = determine_line_segment_distance(point, segment);
        if best
            .as_ref()
            .is_none_or(|(_, _, best_distance)| distance < *best_distance)
        {
            best = Some((index, segment.clone(), distance));
        }
    }

    let Some((index, segment, distance)) = best else {
        return Err(CommandError::InvalidInput {
            operation: OperationId::DrawPoint,
            message: "document has no line segment candidates".to_string(),
        });
    };

    if distance > max_distance {
        return Err(CommandError::InvalidInput {
            operation: OperationId::DrawPoint,
            message: format!(
                "nearest line is outside selection distance ({distance:.6} > {max_distance:.6})"
            ),
        });
    }

    Ok((index, segment))
}

fn required_or_nearest_line_segment(
    document: &CreasePatternDocument,
    command: &CreasePatternCommand,
) -> Result<LineSegment> {
    if let Some(line_id) = command.payload.line_ids.first() {
        let index = line_id
            .checked_sub(1)
            .ok_or_else(|| CommandError::InvalidInput {
                operation: command.operation,
                message: "line IDs are one-based".to_string(),
            })?;
        return line_segment_for_operation(document, command.operation, index);
    }

    let points = required_points_at_least(command, 1)?;
    nearest_line_segment(
        &document.crease_pattern,
        points[0],
        selection_distance(command),
    )
    .map(|(_, segment)| segment)
    .map_err(|_| CommandError::InvalidInput {
        operation: command.operation,
        message: "pick or select a line segment".to_string(),
    })
}

fn line_segment_for_operation(
    document: &CreasePatternDocument,
    operation: OperationId,
    index: usize,
) -> Result<LineSegment> {
    document
        .crease_pattern
        .line_segments
        .get(index)
        .cloned()
        .ok_or_else(|| CommandError::InvalidInput {
            operation,
            message: format!("line index {} is out of bounds", index + 1),
        })
}

fn circle_for_operation(
    document: &CreasePatternDocument,
    operation: OperationId,
    index: usize,
) -> Result<Circle> {
    document
        .crease_pattern
        .circles
        .get(index)
        .copied()
        .ok_or_else(|| CommandError::InvalidInput {
            operation,
            message: format!("circle index {} is out of bounds", index + 1),
        })
}

fn nearest_candidate_segment(
    command: &CreasePatternCommand,
    point: Point,
    candidates: &[LineSegment],
) -> Result<LineSegment> {
    if candidates.is_empty() {
        return Err(CommandError::InvalidInput {
            operation: command.operation,
            message: "no construction candidates are available".to_string(),
        });
    }

    if let Some(index) = command.payload.candidate_index {
        return candidates
            .get(index)
            .cloned()
            .ok_or_else(|| CommandError::InvalidInput {
                operation: command.operation,
                message: format!("candidate index {index} is out of bounds"),
            });
    }

    candidates
        .iter()
        .min_by(|left, right| {
            determine_line_segment_distance(point, left)
                .partial_cmp(&determine_line_segment_distance(point, right))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned()
        .ok_or_else(|| CommandError::InvalidInput {
            operation: command.operation,
            message: "no construction candidates are available".to_string(),
        })
}

fn nearest_candidate_point(
    command: &CreasePatternCommand,
    point: Point,
    candidates: &[Point],
) -> Result<Point> {
    if candidates.is_empty() {
        return Err(CommandError::InvalidInput {
            operation: command.operation,
            message: "no construction candidate points are available".to_string(),
        });
    }

    if let Some(index) = command.payload.candidate_index {
        return candidates
            .get(index)
            .copied()
            .ok_or_else(|| CommandError::InvalidInput {
                operation: command.operation,
                message: format!("candidate index {index} is out of bounds"),
            });
    }

    candidates
        .iter()
        .copied()
        .min_by(|left, right| {
            left.distance(point)
                .partial_cmp(&right.distance(point))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .ok_or_else(|| CommandError::InvalidInput {
            operation: command.operation,
            message: "no construction candidate points are available".to_string(),
        })
}

fn delete_lines_along(
    document: &mut CreasePatternDocument,
    points: &[geometry::Point],
    include_intersections: bool,
) -> usize {
    let before = document.crease_pattern.line_segments.len();
    let selection = geometry::LineSegment::new(points[0], points[1]);
    let deleted = if include_intersections {
        operations::arrangement::delete_intersecting_or_overlapping_lines_along(
            &mut document.crease_pattern,
            &selection,
        )
    } else {
        operations::arrangement::delete_overlapping_lines_along(
            &mut document.crease_pattern,
            &selection,
        )
    };

    if deleted {
        before.saturating_sub(document.crease_pattern.line_segments.len())
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::{Circle, FoldDirection, LineColor, Point, RgbColor};
    use std::collections::HashSet;

    /// A square sheet with `creases` radiating from the origin, and the
    /// zero-based line indices of those creases.
    fn document_with_vertex_fan(creases: &[(f64, f64)]) -> (CreasePatternDocument, Vec<usize>) {
        let mut document = CreasePatternDocument::default();
        let corners = [
            (-200.0, -200.0),
            (200.0, -200.0),
            (200.0, 200.0),
            (-200.0, 200.0),
        ];
        for index in 0..4 {
            let (ax, ay) = corners[index];
            let (bx, by) = corners[(index + 1) % 4];
            document
                .crease_pattern
                .line_segments
                .push(geometry::LineSegment::with_color(
                    Point::new(ax, ay),
                    Point::new(bx, by),
                    LineColor::Black0,
                ));
        }
        let mut indices = Vec::new();
        for (theta, rho) in creases {
            let radians = theta.to_radians();
            indices.push(document.crease_pattern.line_segments.len());
            document.crease_pattern.line_segments.push(
                geometry::LineSegment::with_color(
                    Point::new(0.0, 0.0),
                    Point::new(150.0 * radians.cos(), 150.0 * radians.sin()),
                    if *rho < 0.0 {
                        LineColor::Red1
                    } else {
                        LineColor::Blue2
                    },
                )
                .with_fold_magnitude(geometry::FoldMagnitude::from_degrees(rho.abs())),
            );
        }
        (document, indices)
    }

    /// `lines` are zero-based document indices, as the solver reports them;
    /// `line_ids` on the wire are one-based, as every other operation's are.
    fn solve_command(vertex: Point, lines: &[usize], index: Option<usize>) -> CreasePatternCommand {
        CreasePatternCommand::new(OperationId::VertexSolveFoldAngles).with_payload(
            CreasePatternCommandPayload {
                points: vec![vertex],
                line_ids: lines.iter().map(|line| line + 1).collect(),
                candidate_index: index,
                ..Default::default()
            },
        )
    }

    /// A real, fully-assigned crease pattern. Propagation needs a document that
    /// already closes to have anything to be about, and a synthetic fan does
    /// not: recovering a blanked crease is the k=1 contraction, and that needs
    /// neighbours whose angles are actually consistent.
    fn kabuto_document() -> CreasePatternDocument {
        let text = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../tests/fixtures/flat-folder/kabuto.fold"),
        )
        .expect("fixture");
        let fold: treemaker_fold::FoldDocument = serde_json::from_str(&text).expect("fold json");
        CreasePatternDocument {
            crease_pattern: io::fold::import_fold_document(&fold).expect("import"),
            ..Default::default()
        }
    }

    /// `pins` are zero-based document indices, as the solver reports them; the
    /// payload carries one-based ids, as `line_ids` does.
    ///
    /// A seed or a selection is now required — with neither, the command
    /// declines rather than falling back to the whole canvas.
    fn propagate_command(seed: Option<Point>, pins: &[(usize, f64)]) -> CreasePatternCommand {
        CreasePatternCommand::new(OperationId::PropagateFoldAngles).with_payload(
            CreasePatternCommandPayload {
                points: seed.into_iter().collect(),
                pinned_angles: pins
                    .iter()
                    .map(|(index, degrees)| (index + 1, *degrees))
                    .collect(),
                ..Default::default()
            },
        )
    }

    /// The same, scoped to a selection instead of a click.
    fn propagate_selection_command(lines: &[usize], pins: &[(usize, f64)]) -> CreasePatternCommand {
        CreasePatternCommand::new(OperationId::PropagateFoldAngles).with_payload(
            CreasePatternCommandPayload {
                line_ids: lines.iter().map(|index| index + 1).collect(),
                pinned_angles: pins
                    .iter()
                    .map(|(index, degrees)| (index + 1, *degrees))
                    .collect(),
                ..Default::default()
            },
        )
    }

    /// Any vertex of the document, for the tests that only need *a* scope. The
    /// fixture is a single connected pattern, so this is the whole of it.
    fn a_seed_on(document: &CreasePatternDocument) -> Point {
        document.crease_pattern.line_segments[0].a
    }

    /// Two copies of the fixture, translated apart — the reported bug in
    /// miniature. Returns the document and the offset of the second copy.
    fn two_kabutos() -> (CreasePatternDocument, f64) {
        const SHIFT: f64 = 1000.0;
        let one = kabuto_document();
        let mut both = one.clone();
        for segment in &one.crease_pattern.line_segments {
            let mut moved = segment.clone();
            moved.a = Point::new(segment.a.x + SHIFT, segment.a.y);
            moved.b = Point::new(segment.b.x + SHIFT, segment.b.y);
            both.crease_pattern.line_segments.push(moved);
        }
        (both, SHIFT)
    }

    /// Two disjoint patterns with one recoverable crease blanked in each.
    fn two_kabutos_with_one_blanked_crease_each() -> (CreasePatternDocument, usize, usize) {
        let (both, _) = two_kabutos();
        let half = both.crease_pattern.line_segments.len() / 2;
        for index in 0..half {
            let segment = both.crease_pattern.line_segments[index].clone();
            if model::crease_fold_angle(&segment).is_none() {
                continue;
            }
            let mut blanked = both.clone();
            for at in [index, index + half] {
                blanked.crease_pattern.line_segments[at] = blanked.crease_pattern.line_segments[at]
                    .clone()
                    .with_line_color(LineColor::None);
            }
            let seed = blanked.crease_pattern.line_segments[index].a;
            let preview = preview_command(&blanked, propagate_command(Some(seed), &[]))
                .expect("preview succeeds");
            if preview
                .propagation_creases
                .iter()
                .any(|crease| crease.line_id == index + 1)
            {
                return (blanked, index, index + half);
            }
        }
        panic!("no crease is recoverable in both copies");
    }

    /// Kabuto with two creases blanked at one shared vertex, such that a
    /// selection naming only one of them can work nothing out — the reviewer's
    /// repro, and the ordinary outcome of Propagate-in-selection on a small
    /// selection.
    ///
    /// The pair is *searched for* by that outcome and then *diagnosed* by the
    /// test, which is the split that keeps the test from asserting its own
    /// search: finding an empty draft is easy, and what the test pins is that
    /// the kernel says which move fixes it. The fixture also has to be genuinely
    /// fixable, so the search additionally requires that selecting both solves
    /// both — otherwise "select the other one too" would be advice that fails.
    fn kabuto_with_a_jointly_recoverable_vertex() -> (CreasePatternDocument, usize, usize) {
        let complete = kabuto_document();
        let count = complete.crease_pattern.line_segments.len();
        for left in 0..count {
            let left_segment = complete.crease_pattern.line_segments[left].clone();
            if model::crease_fold_angle(&left_segment).is_none() {
                continue;
            }
            for right in (left + 1)..count {
                let right_segment = complete.crease_pattern.line_segments[right].clone();
                if model::crease_fold_angle(&right_segment).is_none() {
                    continue;
                }
                let shares_a_vertex = [left_segment.a, left_segment.b].iter().any(|end| {
                    end.distance(right_segment.a) < 1e-9 || end.distance(right_segment.b) < 1e-9
                });
                if !shares_a_vertex {
                    continue;
                }
                let mut blanked = complete.clone();
                for at in [left, right] {
                    blanked.crease_pattern.line_segments[at] = blanked.crease_pattern.line_segments
                        [at]
                        .clone()
                        .with_line_color(LineColor::None);
                }
                let alone = preview_command(&blanked, propagate_selection_command(&[left], &[]))
                    .expect("preview succeeds");
                if !alone.propagation_creases.is_empty() {
                    continue;
                }
                let together =
                    preview_command(&blanked, propagate_selection_command(&[left, right], &[]))
                        .expect("preview succeeds");
                if together.propagation_creases.len() == 2 {
                    return (blanked, left, right);
                }
            }
        }
        panic!("no vertex in the fixture needs two creases solved together");
    }

    /// Kabuto with one crease blanked, chosen so that propagation can put it
    /// back — the smallest document that produces a non-empty draft.
    fn kabuto_with_one_blanked_crease() -> (CreasePatternDocument, usize) {
        let complete = kabuto_document();
        for index in 0..complete.crease_pattern.line_segments.len() {
            let segment = complete.crease_pattern.line_segments[index].clone();
            if model::crease_fold_angle(&segment).is_none() {
                continue;
            }
            let mut blanked = complete.clone();
            blanked.crease_pattern.line_segments[index] = segment.with_line_color(LineColor::None);
            let seed = a_seed_on(&blanked);
            let preview = preview_command(&blanked, propagate_command(Some(seed), &[]))
                .expect("preview succeeds");
            if !preview.propagation_creases.is_empty() {
                return (blanked, index);
            }
        }
        panic!("no crease in the fixture is recoverable by propagation");
    }

    /// The draft has to say *which* document creases it would change, not just
    /// how many and what they would look like.
    ///
    /// Without this the preview was a count plus anonymous geometry, so a
    /// surface could only draw the answer *over* the creases it replaces — which
    /// is how a draft that had changed nothing looked already applied. The ids
    /// are the mechanism that lets the document stop drawing them instead.
    #[test]
    fn the_propagation_preview_names_the_creases_it_would_change() {
        let (document, blanked) = kabuto_with_one_blanked_crease();
        let seed = a_seed_on(&document);
        let preview = preview_command(&document, propagate_command(Some(seed), &[]))
            .expect("preview succeeds");

        assert!(!preview.propagation_creases.is_empty());
        assert_eq!(
            preview.propagation_creases.len(),
            preview.segments.len(),
            "the ids and the geometry must be index-aligned"
        );
        // The redundant scalar cannot be allowed to drift from the list.
        assert_eq!(
            preview.propagation_solved,
            Some(preview.propagation_creases.len())
        );
        assert!(
            preview
                .propagation_creases
                .iter()
                .any(|crease| crease.line_id == blanked + 1),
            "the blanked crease must be named, one-based"
        );

        let mut seen = HashSet::new();
        for (crease, segment) in preview
            .propagation_creases
            .iter()
            .zip(preview.segments.iter())
        {
            assert!(
                seen.insert(crease.line_id),
                "line {} named twice, so the ids are not a set",
                crease.line_id
            );
            // One-based, and pointing at the crease whose geometry sits beside
            // it. An off-by-one lands on a real, adjacent crease, so only
            // comparing the endpoints catches it.
            let named = &document.crease_pattern.line_segments[crease.line_id - 1];
            assert_eq!(named.a, segment.a, "line {}", crease.line_id);
            assert_eq!(named.b, segment.b, "line {}", crease.line_id);
        }
    }

    /// The named creases are exactly what the commit writes, and nothing else
    /// moves.
    ///
    /// The frontend hides the creases this list names while the draft is up, so
    /// a list that named the wrong ones would blank geometry the draft never
    /// touched — and applying would then recolour creases the user never saw
    /// change.
    #[test]
    fn the_previewed_creases_are_exactly_what_the_commit_writes() {
        let (document, _) = kabuto_with_one_blanked_crease();
        let seed = a_seed_on(&document);
        let preview = preview_command(&document, propagate_command(Some(seed), &[]))
            .expect("preview succeeds");

        let mut applied = document.clone();
        execute_command(&mut applied, propagate_command(Some(seed), &[])).expect("commit succeeds");

        let named: HashSet<usize> = preview
            .propagation_creases
            .iter()
            .map(|crease| crease.line_id)
            .collect();
        for crease in &preview.propagation_creases {
            let written = &applied.crease_pattern.line_segments[crease.line_id - 1];
            // Asked of the write rather than restated as `degrees < 0.0`: that
            // restatement is what the preview used to carry, and it disagreed
            // with the commit on a zero angle — including on `-0.0`, which the
            // two spellings of "is it negative" read opposite ways.
            assert_eq!(
                *written,
                document.crease_pattern.line_segments[crease.line_id - 1]
                    .with_signed_fold_angle(crease.degrees),
                "line {}",
                crease.line_id
            );
            let angle = model::crease_fold_angle(written).expect("a written crease has an angle");
            assert!(
                (angle.abs() - crease.degrees.abs()).abs() < 1e-6,
                "line {} previewed {} and committed {angle}",
                crease.line_id,
                crease.degrees
            );
        }
        for index in 0..document.crease_pattern.line_segments.len() {
            if named.contains(&(index + 1)) {
                continue;
            }
            assert_eq!(
                document.crease_pattern.line_segments[index],
                applied.crease_pattern.line_segments[index],
                "line {} changed without being named",
                index + 1
            );
        }
    }

    /// A document with nothing free names nothing — no empty list dressed up as
    /// a draft, and the reason is a code the frontend can translate.
    #[test]
    fn a_complete_document_names_nothing() {
        let document = kabuto_document();
        let seed = a_seed_on(&document);
        let preview = preview_command(&document, propagate_command(Some(seed), &[]))
            .expect("preview succeeds");
        assert!(preview.propagation_creases.is_empty());
        assert_eq!(preview.propagation_solved, Some(0));
        assert_eq!(
            preview.unavailable.as_deref(),
            Some("PropagationNothingFree")
        );
    }

    /// A pin names a crease in the same one-based space the preview handed back,
    /// because that round trip *is* the adjust-and-re-propagate loop.
    ///
    /// If the two ends disagreed there would be no symptom: the pin would land
    /// on the next crease along and quietly recolour it.
    #[test]
    fn a_one_based_pin_reaches_the_crease_it_names() {
        let complete = kabuto_document();
        let mut blanked = complete.clone();
        let mut cleared = Vec::new();
        for index in 0..complete.crease_pattern.line_segments.len() {
            let segment = complete.crease_pattern.line_segments[index].clone();
            if model::crease_fold_angle(&segment).is_some() && cleared.len() < 6 {
                blanked.crease_pattern.line_segments[index] =
                    segment.with_line_color(LineColor::None);
                cleared.push(index);
            }
        }
        let pinned = cleared[0];
        // Deliberately an angle nothing else in the fixture carries. Kabuto is
        // flat-folded, so every other crease is +-180 and a neighbour would
        // otherwise stand in for the pinned crease and hide an off-by-one.
        let angle = -137.0;

        let seed = a_seed_on(&blanked);
        let preview = preview_command(&blanked, propagate_command(Some(seed), &[(pinned, angle)]))
            .expect("preview succeeds");
        let named = preview
            .propagation_creases
            .iter()
            .find(|crease| crease.line_id == pinned + 1)
            .expect("the pinned crease must be named by the id it was pinned with");
        assert!(
            (named.degrees - angle).abs() < 1e-9,
            "the pin must not be moved, got {}",
            named.degrees
        );
        assert!(
            !preview
                .propagation_creases
                .iter()
                .any(|crease| crease.line_id != pinned + 1
                    && (crease.degrees - angle).abs() < 1e-9),
            "the pin reached a crease other than the one it named"
        );

        // And the commit puts it on that same crease, which is what the id is
        // ultimately a promise about.
        let mut applied = blanked.clone();
        execute_command(
            &mut applied,
            propagate_command(Some(seed), &[(pinned, angle)]),
        )
        .expect("commit succeeds");
        let written = model::crease_fold_angle(&applied.crease_pattern.line_segments[pinned])
            .expect("the pinned crease is assigned after the commit");
        assert!(
            (written - angle).abs() < 1e-6,
            "line {} was pinned to {angle} and committed {written}",
            pinned + 1
        );
    }

    /// Zero is not a line id. Accepting it would make the pin space ambiguous —
    /// zero-based-index-0 and one-based-id-0 look identical on the wire.
    #[test]
    fn a_zero_pin_id_is_rejected() {
        let document = kabuto_document();
        // A real scope, so this tests the id validation rather than the scope
        // refusal — and it pins the order: a malformed payload is an error, not
        // a scope that named nothing.
        let mut command = propagate_command(Some(a_seed_on(&document)), &[]);
        command.payload.pinned_angles = vec![(0, 90.0)];
        assert!(preview_command(&document, command.clone()).is_err());
        assert!(execute_command(&mut document.clone(), command).is_err());
    }

    /// Zero is not a line id in the scope either.
    #[test]
    fn a_zero_scope_id_is_rejected() {
        let document = kabuto_document();
        let mut command = propagate_command(None, &[]);
        command.payload.line_ids = vec![0];
        assert!(preview_command(&document, command.clone()).is_err());
        assert!(execute_command(&mut document.clone(), command).is_err());
    }

    // -----------------------------------------------------------------------
    // Scope
    // -----------------------------------------------------------------------

    /// **The command-path regression test for the filed bug.** Two patterns on
    /// one canvas, a click in the first: the second must come out of the commit
    /// byte-identical.
    #[test]
    fn a_click_never_writes_into_another_pattern() {
        let (document, in_a, in_b) = two_kabutos_with_one_blanked_crease_each();
        let half = document.crease_pattern.line_segments.len() / 2;
        let seed = document.crease_pattern.line_segments[in_a].a;

        let preview = preview_command(&document, propagate_command(Some(seed), &[]))
            .expect("preview succeeds");
        assert!(
            preview
                .propagation_creases
                .iter()
                .any(|crease| crease.line_id == in_a + 1),
            "the clicked pattern must still be solved"
        );
        assert!(
            preview
                .propagation_creases
                .iter()
                .all(|crease| crease.line_id <= half),
            "the draft named a crease in the other pattern"
        );
        assert_eq!(
            preview
                .propagation_scope
                .as_ref()
                .map(|scope| scope.kind.as_str()),
            Some("component")
        );

        let mut applied = document.clone();
        execute_command(&mut applied, propagate_command(Some(seed), &[])).expect("commit succeeds");
        for index in half..document.crease_pattern.line_segments.len() {
            assert_eq!(
                document.crease_pattern.line_segments[index],
                applied.crease_pattern.line_segments[index],
                "line {} in the second pattern changed",
                index + 1
            );
        }
        assert!(
            model::crease_fold_angle(&applied.crease_pattern.line_segments[in_b]).is_none(),
            "the second pattern's blanked crease was solved by a click on the first"
        );
    }

    /// A selection names the scope in the same one-based space `line_ids`
    /// already uses. An off-by-one here scopes in the neighbouring crease, and
    /// nothing about the result would look wrong.
    ///
    /// Which is what happened to this test: it asserted only that every drafted
    /// crease was the selected one, and an off-by-one drafts *nothing* — a
    /// neighbouring crease already has an angle, so the scope has nothing free
    /// and the run declines. `all` over an empty list is true, so the assertion
    /// passed over the bug it was written for. It now names the crease it
    /// expects and demands it be there.
    #[test]
    fn a_one_based_scope_reaches_the_creases_it_names() {
        let (document, in_a, in_b) = two_kabutos_with_one_blanked_crease_each();
        let preview = preview_command(&document, propagate_selection_command(&[in_a], &[]))
            .expect("preview succeeds");

        assert_eq!(
            preview
                .propagation_scope
                .as_ref()
                .map(|scope| scope.kind.as_str()),
            Some("selection")
        );
        assert_eq!(
            preview
                .propagation_scope
                .as_ref()
                .map(|scope| scope.creases),
            Some(1)
        );
        // The crease the selection named, and only it. Stated as the whole
        // expected list rather than as a predicate over whatever came back, so
        // an empty draft is a failure rather than a vacuous pass.
        assert_eq!(
            preview
                .propagation_creases
                .iter()
                .map(|crease| crease.line_id)
                .collect::<Vec<_>>(),
            vec![in_a + 1],
            "the draft did not name exactly the crease the selection did"
        );
        assert_eq!(preview.propagation_solved, Some(1));
        assert_eq!(
            preview.unavailable, None,
            "a scoped run that lands declines nothing"
        );

        let mut applied = document.clone();
        execute_command(&mut applied, propagate_selection_command(&[in_a], &[]))
            .expect("commit succeeds");
        for index in 0..document.crease_pattern.line_segments.len() {
            if index == in_a {
                continue;
            }
            assert_eq!(
                document.crease_pattern.line_segments[index],
                applied.crease_pattern.line_segments[index],
                "line {} changed without being selected",
                index + 1
            );
        }
        assert!(model::crease_fold_angle(&applied.crease_pattern.line_segments[in_b]).is_none());
    }

    /// "Still undecided" is scope-relative. Reporting the canvas total under a
    /// draft that covers one pattern is reporting somebody else's problem.
    #[test]
    fn still_undecided_counts_only_the_scope() {
        let (document, in_a, _) = two_kabutos_with_one_blanked_crease_each();
        let half = document.crease_pattern.line_segments.len() / 2;
        // Blank a second crease in the first pattern that propagation cannot
        // recover, so the scope has a non-zero remainder of its own.
        let mut document = document;
        let extra = (0..half)
            .find(|index| {
                *index != in_a
                    && model::crease_fold_angle(&document.crease_pattern.line_segments[*index])
                        .is_some()
            })
            .expect("another assigned crease");
        document.crease_pattern.line_segments[extra] = document.crease_pattern.line_segments[extra]
            .clone()
            .with_line_color(LineColor::None);

        let seed = document.crease_pattern.line_segments[in_a].a;
        let preview = preview_command(&document, propagate_command(Some(seed), &[]))
            .expect("preview succeeds");
        let scope = preview
            .propagation_scope
            .as_ref()
            .expect("a resolved scope");
        let free_everywhere = document
            .crease_pattern
            .line_segments
            .iter()
            .filter(|segment| segment.color == LineColor::None)
            .count();
        assert!(
            preview.propagation_free.unwrap_or(usize::MAX) < free_everywhere,
            "the free count is the document's, not the scope's"
        );
        assert_eq!(preview.propagation_free, Some(scope.free));
    }

    /// A stall belongs to the pattern the user is looking at.
    #[test]
    fn stalls_are_reported_only_inside_the_scope() {
        let (mut document, shift) = two_kabutos();
        let half = document.crease_pattern.line_segments.len() / 2;
        for index in half..document.crease_pattern.line_segments.len() {
            let segment = document.crease_pattern.line_segments[index].clone();
            if model::crease_fold_angle(&segment).is_some() {
                document.crease_pattern.line_segments[index] =
                    segment.with_line_color(LineColor::None);
            }
        }
        let seed = document.crease_pattern.line_segments[0].a;
        let preview = preview_command(&document, propagate_command(Some(seed), &[]))
            .expect("preview succeeds");
        for stall in &preview.propagation_stalls {
            assert!(
                stall.point.x < shift / 2.0,
                "a stall at {:?} belongs to the other pattern",
                stall.point
            );
        }
    }

    /// Neither a selection nor a seed means the caller has not said what to work
    /// on. Falling back to the whole canvas is the bug.
    #[test]
    fn no_selection_and_no_seed_declines() {
        let (document, _) = kabuto_with_one_blanked_crease();
        let preview =
            preview_command(&document, propagate_command(None, &[])).expect("preview succeeds");
        assert_eq!(preview.unavailable.as_deref(), Some("PropagationNoScope"));
        assert_eq!(preview.propagation_solved, Some(0));
        assert!(preview.propagation_creases.is_empty());

        let mut applied = document.clone();
        execute_command(&mut applied, propagate_command(None, &[])).expect("the command succeeds");
        assert_eq!(
            document.crease_pattern.line_segments, applied.crease_pattern.line_segments,
            "a declined command must write nothing"
        );
    }

    /// A click on empty canvas names no pattern, and says so rather than
    /// silently picking one.
    #[test]
    fn a_seed_nowhere_near_anything_declines() {
        let (document, _) = kabuto_with_one_blanked_crease();
        let preview = preview_command(
            &document,
            propagate_command(Some(Point::new(1e6, 1e6)), &[]),
        )
        .expect("preview succeeds");
        assert_eq!(
            preview.unavailable.as_deref(),
            Some("PropagationNoComponentAtPoint")
        );
    }

    /// A selection of creases that all already have angles gets its own code.
    /// `PropagationNothingFree` says "every crease already has a fold angle",
    /// which is a lie when the rest of the canvas is full of unassigned ones.
    #[test]
    fn a_selection_of_only_assigned_creases_declines_with_its_own_code() {
        let (document, in_a, _) = two_kabutos_with_one_blanked_crease_each();
        let assigned = (0..document.crease_pattern.line_segments.len())
            .find(|index| {
                *index != in_a
                    && model::crease_fold_angle(&document.crease_pattern.line_segments[*index])
                        .is_some()
            })
            .expect("an assigned crease");
        let preview = preview_command(&document, propagate_selection_command(&[assigned], &[]))
            .expect("preview succeeds");
        assert_eq!(
            preview.unavailable.as_deref(),
            Some("PropagationSelectionNothingFree")
        );
    }

    /// A selection that stops because its vertex needs creases *outside* it must
    /// say so, not fall back to "give one more crease an angle".
    ///
    /// The two sentences send the user in different directions. The kernel has
    /// already worked out which applies — it counts the out-of-scope stalls for
    /// the scope report — and the frontend's actionable sentence ("select those
    /// too") is reachable only through this code: the note that carries it
    /// renders inside the draft window, and a draft that solved nothing opens
    /// none.
    #[test]
    fn a_selection_missing_half_a_joint_answer_says_so() {
        let (document, left, right) = kabuto_with_a_jointly_recoverable_vertex();

        let preview = preview_command(&document, propagate_selection_command(&[left], &[]))
            .expect("preview succeeds");
        assert_eq!(preview.propagation_solved, Some(0));
        assert_eq!(
            preview.unavailable.as_deref(),
            Some("PropagationOutOfScope"),
            "the user was told to set another angle when the move is to widen the selection"
        );
        // The code and the count travel together: the sentence interpolates the
        // number of vertices, and it comes from here.
        let scope = preview
            .propagation_scope
            .as_ref()
            .expect("a resolved scope");
        assert!(scope.out_of_scope > 0);
        assert_eq!(scope.kind.as_str(), "selection");

        // And the advice works: selecting the other crease too solves both.
        let widened = preview_command(&document, propagate_selection_command(&[left, right], &[]))
            .expect("preview succeeds");
        assert_eq!(widened.unavailable, None);
        assert_eq!(widened.propagation_solved, Some(2));
    }

    /// An id list that names nothing must refuse, not widen to the document.
    #[test]
    fn an_empty_after_filtering_scope_does_not_widen() {
        let (document, _) = kabuto_with_one_blanked_crease();
        let preview = preview_command(&document, propagate_selection_command(&[999_999], &[]))
            .expect("preview succeeds");
        assert_eq!(
            preview.unavailable.as_deref(),
            Some("PropagationNothingInScope")
        );
        assert!(preview.propagation_creases.is_empty());
    }

    /// The whole command path: a vertex that does not close, three creases
    /// nominated, applied — and the checker agrees afterwards.
    #[test]
    fn solving_three_fold_angles_closes_the_vertex() {
        let (mut document, lines) =
            document_with_vertex_fan(&[(0.0, 90.0), (45.0, 180.0), (90.0, -90.0), (225.0, 30.0)]);
        let vertex = Point::new(0.0, 0.0);
        let before = checks_spatial::vertex_closure_residual(&checks_spatial::vertex_fan_at(
            &document.crease_pattern,
            vertex,
        ));
        assert!(before.to_degrees() > 1.0, "the fixture must start broken");

        let chosen = [lines[0], lines[2], lines[3]];
        execute_command(&mut document, solve_command(vertex, &chosen, None))
            .expect("the solve applies");

        let after = checks_spatial::vertex_closure_residual(&checks_spatial::vertex_fan_at(
            &document.crease_pattern,
            vertex,
        ));
        assert!(
            after.to_degrees() < CLOSURE_RESIDUAL_BAR_DEGREES,
            "vertex still off by {} degrees",
            after.to_degrees()
        );
        // Untouched creases keep exactly what they had — the solve changes three
        // angles and nothing else, and it never moves geometry.
        let untouched = &document.crease_pattern.line_segments[lines[1]];
        assert_eq!(untouched.color, LineColor::Blue2);
        assert_eq!(untouched.fold_magnitude, None);
        for line in chosen {
            let segment = &document.crease_pattern.line_segments[line];
            assert_eq!(segment.a, Point::new(0.0, 0.0));
        }
    }

    /// The tool asks for three creases and no vertex click, because three
    /// segments meeting at a point determine that point. Solving with the vertex
    /// left out must reach the same answer as solving with it supplied — the
    /// explicit form is what keeps a closure-diagnostic entry point open.
    #[test]
    fn the_vertex_is_derived_from_the_chosen_creases() {
        let (document, lines) =
            document_with_vertex_fan(&[(0.0, 90.0), (45.0, 180.0), (90.0, -90.0), (225.0, 30.0)]);
        let chosen = [lines[0], lines[2], lines[3]];
        let vertex = Point::new(0.0, 0.0);

        let mut derived = document.clone();
        execute_command(&mut derived, solve_command(vertex, &chosen, None)).expect("with a point");
        let mut implied = document.clone();
        let mut without = solve_command(vertex, &chosen, None);
        without.payload.points.clear();
        execute_command(&mut implied, without).expect("without a point");
        assert_eq!(
            derived.crease_pattern.line_segments,
            implied.crease_pattern.line_segments
        );
    }

    /// Creases that do not all end at one point have no shared closure condition,
    /// so there is nothing for the solve to be about.
    #[test]
    fn creases_that_do_not_meet_are_refused() {
        let (mut document, lines) =
            document_with_vertex_fan(&[(0.0, 90.0), (90.0, -90.0), (225.0, 30.0)]);
        // A crease somewhere else entirely.
        let stray = document.crease_pattern.line_segments.len();
        document
            .crease_pattern
            .line_segments
            .push(geometry::LineSegment::with_color(
                Point::new(100.0, 100.0),
                Point::new(150.0, 100.0),
                LineColor::Blue2,
            ));
        let mut command = solve_command(Point::new(0.0, 0.0), &[lines[0], lines[1], stray], None);
        command.payload.points.clear();
        assert!(execute_command(&mut document, command).is_err());
    }

    /// The reported vertex, rebuilt: `failure_case.osf`'s degree-6 point at
    /// (550, 1450), with one unassigned crease hinted Valley.
    ///
    /// Its five decided creases are two full-fold valleys at 109.4712206, two
    /// mountains at 90 and a valley at 70.5287794 — real angles off a real
    /// design, kept rather than rounded because 109.47 and 70.53 are
    /// supplementary and the vertex closes on exactly that.
    fn reported_failure_case_vertex() -> (CreasePatternDocument, Vec<usize>) {
        const VERTEX: Point = Point {
            x: 550.0,
            y: 1450.0,
        };
        let mut document = CreasePatternDocument::default();
        let corners = [
            (450.0, 1350.0),
            (650.0, 1350.0),
            (650.0, 1550.0),
            (450.0, 1550.0),
        ];
        for index in 0..4 {
            let (ax, ay) = corners[index];
            let (bx, by) = corners[(index + 1) % 4];
            document
                .crease_pattern
                .line_segments
                .push(geometry::LineSegment::with_color(
                    Point::new(ax, ay),
                    Point::new(bx, by),
                    LineColor::Black0,
                ));
        }
        // `(bearing in degrees, signed fold angle)`, or `None` for the
        // unassigned crease. Bearings are the document's: the two 109.47 valleys
        // run along the axes and the unassigned one runs up out of the vertex.
        let creases: [(f64, Option<f64>); 6] = [
            (180.0, Some(109.4712206)),
            (-90.0, None),
            (0.0, Some(109.4712206)),
            (45.0, Some(-90.0)),
            (90.0, Some(70.5287794)),
            (135.0, Some(-90.0)),
        ];
        let mut indices = Vec::new();
        for (bearing, rho) in creases {
            let radians = bearing.to_radians();
            indices.push(document.crease_pattern.line_segments.len());
            let far = Point::new(
                VERTEX.x + 50.0 * radians.cos(),
                VERTEX.y + 50.0 * radians.sin(),
            );
            let segment = match rho {
                Some(degrees) => geometry::LineSegment::with_color(
                    VERTEX,
                    far,
                    if degrees < 0.0 {
                        LineColor::Red1
                    } else {
                        LineColor::Blue2
                    },
                )
                .with_fold_magnitude(geometry::FoldMagnitude::from_degrees(degrees.abs())),
                None => geometry::LineSegment::with_color(VERTEX, far, LineColor::None)
                    .with_direction_hint(Some(geometry::FoldDirection::Valley)),
            };
            document.crease_pattern.line_segments.push(segment);
        }
        (document, indices)
    }

    /// **The reported bug.** A solve that names an unassigned crease has to
    /// decide it, not skip it.
    ///
    /// The apply gated on `Red1`/`Blue2` — "only creases that already fold" —
    /// while the tool's fan deliberately keeps unassigned creases, because those
    /// are what a user nominates it to work out. So the commit wrote the two
    /// decided creases and dropped the third, leaving it undecided at a vertex
    /// the tool had just reported closed. On screen it kept the undecided dash
    /// and read as an auxiliary line.
    ///
    /// What makes this worth a test of its own rather than a line in another:
    /// the *preview* never had the guard, so it showed the crease folded
    /// correctly and the commit then wrote something else. Two write chains for
    /// one operation, and only one of them was wrong.
    #[test]
    fn a_solve_decides_the_unassigned_crease_it_was_given() {
        let (mut document, lines) = reported_failure_case_vertex();
        let vertex = Point::new(550.0, 1450.0);
        // The three the owner picked: the unassigned crease and the two 109.47
        // valleys opposite each other.
        let unassigned = lines[1];
        let chosen = [unassigned, lines[0], lines[2]];

        let solved = solve_fold_angles::vertex_angle_solutions(
            &document.crease_pattern,
            vertex,
            &chosen,
            CLOSURE_RESIDUAL_BAR_DEGREES.to_radians(),
        );
        assert_eq!(solved.no_solution, None);
        // "1 of 3" is what the tool reported, and all three are isolated.
        assert_eq!(solved.isolated_count, 3);
        let first = solved.solutions[0];

        execute_command(&mut document, solve_command(vertex, &chosen, None))
            .expect("the solve applies");

        let segment = &document.crease_pattern.line_segments[unassigned];
        assert_ne!(
            segment.color,
            LineColor::None,
            "the solved crease is still undecided: the apply skipped it"
        );
        // A solved angle names a direction, so the crease leaves with the colour
        // its sign implies — and without the hint, which the invariant forbids
        // on a decided crease.
        let slot = first
            .creases
            .iter()
            .position(|(line, _)| *line == unassigned)
            .expect("the answer names the crease");
        assert_eq!(
            Some(segment.color),
            first.direction(slot).map(FoldDirection::line_color)
        );
        assert_eq!(segment.fold_magnitude, first.fold_magnitude(slot));
        assert_eq!(segment.fold_direction_hint, None);
        // The measured answer: arccos(1/3), the same 70.5287794 the vertex's
        // remaining valley already carries.
        assert!((first.creases[slot].1 - 70.5287793).abs() < 1e-6);

        // And the other two land as well — the whole answer, not two thirds of
        // it. Both solve to a full fold, where "clear the magnitude" and "store
        // 180" are the same write.
        for (other, (line, degrees)) in first.creases.iter().enumerate() {
            if other == slot {
                continue;
            }
            let segment = &document.crease_pattern.line_segments[*line];
            assert_eq!(
                Some(segment.color),
                first.direction(other).map(FoldDirection::line_color),
                "line {line}"
            );
            assert_eq!(segment.fold_magnitude, None, "line {line} at {degrees}");
            assert_eq!(crate::model::crease_fold_angle(segment), Some(180.0));
        }
    }

    /// A hint is a belief about a crease, not a fact about the geometry, so it
    /// does not get to remove a branch that genuinely closes the vertex — but
    /// applying one that contradicts it destroys the mark, so the answer says so.
    ///
    /// On the reported vertex all three branches survive and exactly one folds
    /// the Valley-hinted crease into a mountain.
    #[test]
    fn a_hint_flags_the_branch_that_contradicts_it_without_removing_it() {
        let (document, lines) = reported_failure_case_vertex();
        let vertex = Point::new(550.0, 1450.0);
        let unassigned = lines[1];
        let chosen = [unassigned, lines[0], lines[2]];

        let solved = solve_fold_angles::vertex_angle_solutions(
            &document.crease_pattern,
            vertex,
            &chosen,
            CLOSURE_RESIDUAL_BAR_DEGREES.to_radians(),
        );
        assert_eq!(
            solved.solutions.len(),
            3,
            "the hint must not filter answers"
        );

        let mut contradicting = 0;
        for solution in &solved.solutions {
            let slot = solution
                .creases
                .iter()
                .position(|(line, _)| *line == unassigned)
                .expect("the answer names the crease");
            // The hint is Valley, so folding against it means folding *mountain*
            // — asked of the one sign predicate rather than restated here.
            let against_the_hint = solution.direction(slot) == Some(FoldDirection::Mountain);
            assert_eq!(
                solution.contradicts_hint[slot], against_the_hint,
                "{:?} disagrees with its own sign",
                solution.creases
            );
            assert_eq!(solution.contradicts_a_hint(), against_the_hint);
            // The two decided creases carry no hint, so nothing there can clash.
            for other in 0..3 {
                if other != slot {
                    assert!(!solution.contradicts_hint[other]);
                }
            }
            contradicting += usize::from(against_the_hint);
        }
        assert_eq!(
            contradicting, 1,
            "the mountain branch is a real answer and must still be offered"
        );

        // And it reaches the surface, which is the only thing that stops the
        // apply erasing the mark silently.
        let index = solved
            .solutions
            .iter()
            .position(solve_fold_angles::AngleSolution::contradicts_a_hint)
            .expect("one branch contradicts");
        let preview = preview_command(&document, solve_command(vertex, &chosen, Some(index)))
            .expect("preview succeeds");
        assert_eq!(preview.candidate_contradicts_hint, Some(true));
        let agreeing = (0..3).find(|slot| *slot != index).expect("another branch");
        let preview = preview_command(&document, solve_command(vertex, &chosen, Some(agreeing)))
            .expect("preview succeeds");
        assert_eq!(preview.candidate_contradicts_hint, Some(false));
    }

    /// The reported vertex, one edit along: the crease that *was* unassigned now
    /// carries its solved angle, and one of the 109.47 valleys is unassigned in
    /// its place, keeping its direction.
    ///
    /// This is where a zero answer reaches an unassigned crease. The first
    /// branch folds it by `-0.0`, and both halves of the old behaviour were
    /// wrong at once: the tool said *"this folds a crease the opposite way from
    /// the direction remembered for it"* — because `contradicts_hint` asked *not
    /// this direction* rather than *the other direction*, and zero is neither —
    /// and then the commit painted it Blue2, which is the direction the hint
    /// stated, at a magnitude of zero.
    fn a_zero_answer_at_the_reported_vertex() -> (CreasePatternDocument, Point, [usize; 3], usize) {
        let (mut document, lines) = reported_failure_case_vertex();
        let segments = &mut document.crease_pattern.line_segments;
        segments[lines[1]] = segments[lines[1]].with_signed_fold_angle(70.5287793);
        segments[lines[2]] = segments[lines[2]].with_direction_kept();
        (
            document,
            Point::new(550.0, 1450.0),
            [lines[0], lines[1], lines[2]],
            lines[2],
        )
    }

    /// Zero folds neither way, so it does not contradict a hint that says one.
    ///
    /// `contradicts_hint` was `!admits(degrees)` — *not this direction* — and
    /// `admits` answers no for zero by design. So a crease the answer declines
    /// to fold was reported as folding against the mark, in nine languages, on
    /// the branch `candidate_index: None` applies.
    #[test]
    fn a_zero_answer_does_not_contradict_a_hint() {
        let (document, vertex, chosen, undecided) = a_zero_answer_at_the_reported_vertex();
        let solved = solve_fold_angles::vertex_angle_solutions(
            &document.crease_pattern,
            vertex,
            &chosen,
            CLOSURE_RESIDUAL_BAR_DEGREES.to_radians(),
        );
        let slot = solved.solutions[0]
            .creases
            .iter()
            .position(|(line, _)| *line == undecided)
            .expect("the answer names the crease");
        assert_eq!(
            solved.solutions[0].creases[slot].1, 0.0,
            "this branch is the one that does not fold the hinted crease"
        );
        assert!(
            !solved.solutions[0].contradicts_hint[slot],
            "an answer that does not fold the crease cannot fold it the wrong way"
        );
        // The mark still earns its warning where it means something: another
        // branch folds the Valley-hinted crease to -180, and that one is a real
        // clash the apply would erase.
        assert!(
            solved
                .solutions
                .iter()
                .any(solve_fold_angles::AngleSolution::contradicts_a_hint),
            "the mountain branch is still flagged"
        );
        let preview = preview_command(&document, solve_command(vertex, &chosen, None))
            .expect("preview succeeds");
        assert_eq!(preview.candidate_contradicts_hint, Some(false));
    }

    /// A zero answer names no direction, so it does not decide an undecided
    /// crease — and the preview and the commit say the same thing about that.
    ///
    /// The alternative the fix rejects is what shipped: `Blue2` with magnitude
    /// zero, a decided valley that folds by nothing. `is_classic_crease` is
    /// false for it, so one such crease flips the whole document non-classic —
    /// `.cp` export blocked, the 2D folded view blocked, all three cost paths on
    /// — for a crease that does not fold, while `FoldDirection::admits` says
    /// elsewhere in this crate that it has no direction at all.
    #[test]
    fn a_zero_answer_leaves_an_unassigned_crease_undecided() {
        let (mut document, vertex, chosen, undecided) = a_zero_answer_at_the_reported_vertex();
        let before = document.crease_pattern.line_segments[undecided].clone();
        assert_eq!(before.color, LineColor::None);
        assert_eq!(before.fold_direction_hint, Some(FoldDirection::Valley));

        let solved = solve_fold_angles::vertex_angle_solutions(
            &document.crease_pattern,
            vertex,
            &chosen,
            CLOSURE_RESIDUAL_BAR_DEGREES.to_radians(),
        );
        let slot = solved.solutions[0]
            .creases
            .iter()
            .position(|(line, _)| *line == undecided)
            .expect("the answer names the crease");
        assert!(solved.solutions[0].leaves_undecided[slot]);
        assert!(solved.solutions[0].leaves_any_undecided());

        // The surface is told before Apply, rather than left to infer it from a
        // crease that did not move.
        let preview = preview_command(&document, solve_command(vertex, &chosen, None))
            .expect("preview succeeds");
        assert_eq!(preview.candidate_leaves_undecided, Some(true));
        // And the preview draws it as it will be: still undecided, hint intact.
        let shown = preview
            .segments
            .iter()
            .find(|segment| segment.a == before.a && segment.b == before.b)
            .expect("the preview shows all three picks");
        assert_eq!(*shown, before, "the preview promised a different crease");

        execute_command(&mut document, solve_command(vertex, &chosen, None))
            .expect("the solve applies");
        let after = &document.crease_pattern.line_segments[undecided];
        assert_eq!(
            *after, before,
            "a zero answer decided a crease it has no direction for"
        );
        assert_eq!(after.fold_direction_hint, Some(FoldDirection::Valley));
        assert!(
            model::is_classic_crease(after),
            "an undecided crease must not turn the document non-classic"
        );

        // The rest of the answer still lands — leaving one crease alone is not a
        // licence to skip the other two.
        for (line, degrees) in solved.solutions[0].creases {
            if line == undecided {
                continue;
            }
            assert_eq!(
                model::crease_fold_angle(&document.crease_pattern.line_segments[line])
                    .expect("a decided crease has an angle")
                    .abs(),
                degrees.abs(),
                "line {line}"
            );
        }
    }

    /// The same zero hole on the path that predates the unassigned one: a
    /// decided crease keeps the direction the user already gave it.
    ///
    /// `set_signed_fold_angles` served `Red1`/`Blue2` long before a solve could
    /// reach an unassigned crease, and `degrees < 0.0` turned every zero answer
    /// into a valley — silently flipping a mountain the solve never asked to
    /// move. `-0.0` flipped it too, because `-0.0 < 0.0` is false, so the
    /// solver's own sign was discarded on the one input where the two spellings
    /// of "negative" disagree.
    /// The same rule, for every angle that *stores* as zero rather than only
    /// the two that are spelled zero.
    ///
    /// The direction was read off the caller's float while the magnitude was
    /// written from the quantised value, and the two disagree on the band below
    /// one storage unit: `+1e-9` on a `Red1` named a valley and then stored a
    /// magnitude of zero, so the crease came out `Blue2` and flat. That is the
    /// mountain-turned-valley and the non-classic document the rule above
    /// exists to prevent, surviving one band along from the literal zeros it
    /// checked. Unreachable from either solver — both quantise before emitting
    /// — and reachable through `pinned_angles`, which does not.
    #[test]
    fn an_angle_that_stores_as_flat_names_no_direction_either() {
        let sub_unit = [1e-9_f64, -1e-9, 4.99e-8, -4.99e-8, f64::MIN_POSITIVE];
        for degrees in sub_unit {
            for (color, other) in [
                (LineColor::Red1, LineColor::Blue2),
                (LineColor::Blue2, LineColor::Red1),
            ] {
                let mut model = CreasePatternModel::default();
                model.line_segments.push(
                    geometry::LineSegment::with_color(
                        Point::new(0.0, 0.0),
                        Point::new(100.0, 0.0),
                        color,
                    )
                    .with_fold_magnitude(geometry::FoldMagnitude::from_degrees(120.0)),
                );
                operations::color::set_signed_fold_angles(&mut model, &[(0, degrees)]);
                let written = &model.line_segments[0];
                assert_ne!(
                    written.color, other,
                    "{color:?} flipped direction on {degrees:e}, which stores as flat"
                );
                assert_eq!(
                    written.fold_magnitude,
                    Some(geometry::FoldMagnitude::FLAT),
                    "{color:?} at {degrees:e}"
                );
            }
        }

        // The first angle that does *not* store as flat still takes its sign
        // from the caller, so the fix is a floor rather than a new rule.
        let mut model = CreasePatternModel::default();
        model.line_segments.push(
            geometry::LineSegment::with_color(
                Point::new(0.0, 0.0),
                Point::new(100.0, 0.0),
                LineColor::Red1,
            )
            .with_fold_magnitude(geometry::FoldMagnitude::from_degrees(120.0)),
        );
        operations::color::set_signed_fold_angles(&mut model, &[(0, 5.01e-8)]);
        assert_eq!(model.line_segments[0].color, LineColor::Blue2);
    }

    #[test]
    fn a_zero_answer_keeps_the_direction_a_decided_crease_already_has() {
        for zero in [0.0_f64, -0.0_f64] {
            for (color, hint) in [
                (LineColor::Red1, FoldDirection::Mountain),
                (LineColor::Blue2, FoldDirection::Valley),
            ] {
                let mut model = CreasePatternModel::default();
                model.line_segments.push(
                    geometry::LineSegment::with_color(
                        Point::new(0.0, 0.0),
                        Point::new(100.0, 0.0),
                        color,
                    )
                    .with_fold_magnitude(geometry::FoldMagnitude::from_degrees(120.0)),
                );
                let changed = operations::color::set_signed_fold_angles(&mut model, &[(0, zero)]);
                let written = &model.line_segments[0];
                assert_eq!(changed, 1, "{color:?} at {zero}");
                assert_eq!(
                    written.color, color,
                    "{color:?} changed direction on a {zero} answer"
                );
                assert_eq!(
                    written.fold_magnitude,
                    Some(geometry::FoldMagnitude::FLAT),
                    "{color:?} at {zero}"
                );
                // The colour still means what it meant: this crease is a `hint`
                // that happens to fold by nothing, not a crease of the opposite
                // family.
                assert_eq!(FoldDirection::from_line_color(written.color), Some(hint));
            }
        }
    }

    /// The colour and the magnitude have to land in one step. Closing a vertex
    /// can require a mountain to become a valley, and a two-operation apply
    /// would put a crease carrying the new angle with the old direction on the
    /// undo stack — a fold the solve never proposed.
    #[test]
    fn a_solved_crease_changes_direction_and_magnitude_together() {
        let (mut document, lines) =
            document_with_vertex_fan(&[(0.0, 90.0), (45.0, 180.0), (90.0, -90.0), (225.0, 30.0)]);
        let vertex = Point::new(0.0, 0.0);
        let chosen = [lines[0], lines[2], lines[3]];
        let solved = solve_fold_angles::vertex_angle_solutions(
            &document.crease_pattern,
            vertex,
            &chosen,
            CLOSURE_RESIDUAL_BAR_DEGREES.to_radians(),
        );
        let expected = solved
            .solutions
            .first()
            .copied()
            .expect("a solution exists");
        execute_command(&mut document, solve_command(vertex, &chosen, None))
            .expect("the solve applies");

        for (slot, (line, degrees)) in expected.creases.iter().enumerate() {
            let segment = &document.crease_pattern.line_segments[*line];
            assert_eq!(
                Some(segment.color),
                expected.direction(slot).map(FoldDirection::line_color),
                "line {line}"
            );
            assert_eq!(
                segment.fold_magnitude,
                expected.fold_magnitude(slot),
                "line {line} at {degrees} degrees"
            );
        }
    }

    /// `candidate_index` picks the branch, and it must pick the same one for the
    /// preview and for the commit — otherwise the user steps to one answer and
    /// applies another.
    ///
    /// Run over **two** fixtures, and the second is why the first was not
    /// enough. This assertion was already here and already right when the
    /// unassigned-crease bug shipped: the preview wrote through a chain with no
    /// colour gate and the commit through one with, so they disagreed on exactly
    /// one input — a crease that is `LineColor::None` — and every fan this test
    /// had was fully assigned. The invariant was fine; nothing ever handed it
    /// the case that breaks it.
    #[test]
    fn the_preview_and_the_commit_agree_on_which_solution_is_chosen() {
        let (fully_assigned, lines) =
            document_with_vertex_fan(&[(0.0, 90.0), (45.0, 180.0), (90.0, -90.0), (225.0, 30.0)]);
        let (with_an_unassigned_crease, reported) = reported_failure_case_vertex();
        for (document, vertex, chosen) in [
            (
                fully_assigned,
                Point::new(0.0, 0.0),
                [lines[0], lines[2], lines[3]],
            ),
            (
                with_an_unassigned_crease,
                Point::new(550.0, 1450.0),
                [reported[1], reported[0], reported[2]],
            ),
        ] {
            let solved = solve_fold_angles::vertex_angle_solutions(
                &document.crease_pattern,
                vertex,
                &chosen,
                CLOSURE_RESIDUAL_BAR_DEGREES.to_radians(),
            );
            assert!(solved.solutions.len() >= 2, "need a branch to step through");

            for index in 0..solved.solutions.len() {
                let preview =
                    preview_command(&document, solve_command(vertex, &chosen, Some(index)))
                        .expect("preview succeeds");
                assert_eq!(preview.segments.len(), 3);
                assert_eq!(preview.candidate_count, Some(solved.isolated_count));
                assert_eq!(
                    preview.candidate_is_family,
                    Some(!solved.solutions[index].isolated)
                );

                let mut applied = document.clone();
                execute_command(&mut applied, solve_command(vertex, &chosen, Some(index)))
                    .expect("commit succeeds");
                // Every previewed segment is exactly what the commit wrote.
                for segment in &preview.segments {
                    assert!(
                        applied
                            .crease_pattern
                            .line_segments
                            .iter()
                            .any(|written| written == segment),
                        "preview showed {segment:?}, which the commit did not write"
                    );
                }
            }
        }
    }

    /// The preview names the vertex and returns the creases in the order they
    /// were *picked*, not the fan order the solver works in.
    ///
    /// Both exist so a UI can render the answer without re-deriving anything.
    /// The alternative — matching preview segments back to line ids by their
    /// endpoints — would be comparing coordinates that had round-tripped through
    /// a serialiser, and re-deriving the vertex would let the window point
    /// somewhere the solve was not about.
    #[test]
    fn the_preview_names_the_vertex_and_keeps_the_pick_order() {
        let (document, lines) =
            document_with_vertex_fan(&[(0.0, 90.0), (45.0, 180.0), (90.0, -90.0), (225.0, 30.0)]);
        let vertex = Point::new(0.0, 0.0);
        // Deliberately not in fan order: the solver sorts by direction, and the
        // preview has to undo that.
        let chosen = [lines[3], lines[0], lines[2]];
        let mut command = solve_command(vertex, &chosen, None);
        command.payload.points.clear();
        let preview = preview_command(&document, command).expect("preview succeeds");

        assert_eq!(preview.points.len(), 1);
        assert!(preview.points[0].distance(vertex) < 1e-9);
        assert_eq!(preview.segments.len(), 3);
        for (segment, line) in preview.segments.iter().zip(chosen) {
            let original = &document.crease_pattern.line_segments[line];
            assert_eq!(segment.a, original.a, "row {line} is not the picked crease");
            assert_eq!(segment.b, original.b, "row {line} is not the picked crease");
        }
    }

    /// Before the third pick the tool has nothing to say, and in particular it
    /// must not hand back the *existing* creases.
    ///
    /// It used to: the ones that would complete a solvable triple were returned
    /// as a "these are pickable" hint, and the frontend drew them in the
    /// selection accent, so every mountain at the vertex read as a valley for as
    /// long as two creases were picked. `solvable_partners` still computes the
    /// same set — it is the *preview channel* that is the wrong way to show it,
    /// because repainting the crease is all that channel can do.
    #[test]
    fn a_partial_pick_previews_nothing() {
        let (document, lines) = document_with_vertex_fan(&[
            (0.0, 90.0),
            (45.0, 180.0),
            (90.0, -90.0),
            (225.0, 30.0),
            (300.0, -60.0),
        ]);
        let vertex = Point::new(0.0, 0.0);
        for picked in 0..3 {
            let preview =
                preview_command(&document, solve_command(vertex, &lines[0..picked], None))
                    .expect("preview succeeds");
            assert!(
                preview.segments.is_empty(),
                "{picked} picks previewed {} segments",
                preview.segments.len()
            );
        }
    }

    /// "These three cannot close this vertex" is an ordinary answer — 62% of
    /// randomly chosen triples on a freely-angled vertex — so it has to be said
    /// rather than left as an empty canvas.
    #[test]
    fn an_unsolvable_triple_reports_a_reason_rather_than_nothing() {
        let (document, lines) =
            document_with_vertex_fan(&[(0.0, 30.0), (70.0, -110.0), (200.0, 45.0), (300.0, 20.0)]);
        let vertex = Point::new(0.0, 0.0);
        let preview = preview_command(
            &document,
            solve_command(vertex, &[lines[0], lines[1], lines[2]], None),
        )
        .expect("preview succeeds");
        if preview.segments.is_empty() {
            assert_eq!(preview.unavailable.as_deref(), Some("AnglesUnreachable"));
        }
    }

    /// The two markers of an Ori Studio original — where its code lives and what
    /// its descriptor claims — must not drift apart.
    ///
    /// The module check is deliberately one-directional. `operations::native::`
    /// may hold nothing parity-bound, which is what protects new code; the
    /// converse does not hold yet, because the three originals that predate this
    /// tag still live in ported modules (`operations::color::…`,
    /// `solve_fold_angles::…`). Relocating them is its own change.
    #[test]
    fn native_operations_are_tagged_and_stay_out_of_ported_modules() {
        for descriptor in operation_descriptors() {
            if descriptor.target.starts_with("operations::native::") {
                assert_eq!(
                    descriptor.origin,
                    OperationOrigin::OriStudio,
                    "{:?} lives in operations::native:: but is tagged as a port",
                    descriptor.id
                );
            }
            if descriptor.origin == OperationOrigin::OriStudio {
                assert!(
                    descriptor.upstream.starts_with("OriStudio"),
                    "{:?} is an Ori Studio original but its upstream ({}) reads like an Oriedita source element",
                    descriptor.id,
                    descriptor.upstream
                );
            } else {
                assert!(
                    !descriptor.upstream.starts_with("OriStudio"),
                    "{:?} carries an OriStudio upstream but is tagged as a port",
                    descriptor.id
                );
            }
        }
    }

    fn square_command(
        anchor_point: Point,
        extent: Option<f64>,
        orientation: operations::native::square::SquareOrientation,
        anchor: operations::native::square::SquareAnchor,
    ) -> CreasePatternCommand {
        CreasePatternCommand::new(OperationId::SquareGenerate).with_payload(
            CreasePatternCommandPayload {
                points: vec![anchor_point],
                square_extent: extent,
                square_orientation: Some(orientation),
                square_anchor: Some(anchor),
                line_color: Some(LineColor::Black0),
                ..CreasePatternCommandPayload::default()
            },
        )
    }

    /// The tool is a one-click stamp, so the preview has to be the answer before
    /// the click rather than a hint towards it.
    #[test]
    fn the_square_preview_is_exactly_what_the_click_commits() {
        use operations::native::square::{SquareAnchor, SquareOrientation};

        let mut document = CreasePatternDocument::default();
        let command = square_command(
            Point::new(-40.0, -40.0),
            Some(80.0),
            SquareOrientation::Normal,
            SquareAnchor::TopLeft,
        );

        let preview = preview_command(&document, command.clone()).expect("preview succeeds");
        assert_eq!(preview.segments.len(), 4);

        execute_command(&mut document, command).expect("square commits");
        let committed = &document.crease_pattern.line_segments;
        assert_eq!(committed.len(), 4);
        for edge in &preview.segments {
            assert!(
                committed
                    .iter()
                    .any(|line| line.a == edge.a && line.b == edge.b && line.color == edge.color),
                "previewed edge {edge:?} is not among the committed lines"
            );
        }
    }

    #[test]
    fn a_square_with_no_usable_extent_is_refused_rather_than_drawn() {
        use operations::native::square::{SquareAnchor, SquareOrientation};

        let mut document = CreasePatternDocument::default();
        let result = execute_command(
            &mut document,
            square_command(
                Point::origin(),
                None,
                SquareOrientation::Normal,
                SquareAnchor::Center,
            ),
        );

        assert!(matches!(result, Err(CommandError::InvalidInput { .. })));
        assert!(document.crease_pattern.line_segments.is_empty());
    }

    /// Orientation and anchor are independent inputs, and the dispatch has to
    /// keep them that way: the same anchor with a different orientation must
    /// still put the bounding box in the same place.
    #[test]
    fn orientation_does_not_move_where_the_anchor_puts_the_square() {
        use operations::native::square::{SquareAnchor, SquareOrientation};

        let bounds = |orientation| {
            let document = CreasePatternDocument::default();
            let preview = preview_command(
                &document,
                square_command(
                    Point::new(10.0, 20.0),
                    Some(40.0),
                    orientation,
                    SquareAnchor::TopLeft,
                ),
            )
            .expect("preview succeeds");
            let xs: Vec<f64> = preview.segments.iter().map(|line| line.a.x).collect();
            let ys: Vec<f64> = preview.segments.iter().map(|line| line.a.y).collect();
            (
                xs.iter().copied().fold(f64::MAX, f64::min),
                ys.iter().copied().fold(f64::MAX, f64::min),
            )
        };

        assert_eq!(bounds(SquareOrientation::Normal), (10.0, 20.0));
        assert_eq!(bounds(SquareOrientation::Diagonal), (10.0, 20.0));
    }

    fn crossing_document() -> CreasePatternDocument {
        let mut document = CreasePatternDocument::default();
        document
            .crease_pattern
            .add_line_segment(LineSegment::with_color(
                Point::new(-10.0, 0.0),
                Point::new(10.0, 0.0),
                LineColor::Red1,
            ));
        document
            .crease_pattern
            .add_line_segment(LineSegment::with_color(
                Point::new(0.0, -10.0),
                Point::new(0.0, 10.0),
                LineColor::Blue2,
            ));
        document
    }

    fn insert_vertex_command(point: Point) -> CreasePatternCommand {
        CreasePatternCommand::new(OperationId::VertexInsertOnCreases).with_payload(
            CreasePatternCommandPayload {
                points: vec![point],
                ..CreasePatternCommandPayload::default()
            },
        )
    }

    /// The whole edit is one command, so it is one undo entry: a crossing that
    /// splits half way is a worse document than the one it started from.
    #[test]
    fn inserting_a_vertex_splits_every_crease_through_it_in_one_command() {
        let mut document = crossing_document();

        let result = execute_command(&mut document, insert_vertex_command(Point::origin()))
            .expect("vertex insert should execute through the command dispatcher");

        assert_eq!(result.status, OperationStatus::UnitTested);
        assert_eq!(document.crease_pattern.line_segments.len(), 4);
        assert!(
            document
                .crease_pattern
                .line_segments
                .iter()
                .all(|line| line.a == Point::origin() || line.b == Point::origin())
        );
    }

    #[test]
    fn inserting_a_vertex_where_no_crease_passes_reports_no_change() {
        let mut document = crossing_document();
        let before = document.crease_pattern.line_segments.clone();

        let result = execute_command(&mut document, insert_vertex_command(Point::new(4.0, 4.0)))
            .expect("a point on no crease is an ordinary answer, not an error");

        assert_eq!(result.diagnostics, vec!["Changed 0 line(s)".to_string()]);
        assert_eq!(document.crease_pattern.line_segments, before);
    }

    /// The defect is invisible in ink, so the preview has to name the creases
    /// rather than draw the change — and has to say plainly when there is none.
    #[test]
    fn the_vertex_insert_preview_names_the_creases_the_click_would_split() {
        let document = crossing_document();

        let preview = preview_command(&document, insert_vertex_command(Point::origin()))
            .expect("preview succeeds");
        assert_eq!(preview.segments.len(), 4);
        assert_eq!(preview.points, vec![Point::origin()]);
        assert_eq!(preview.unavailable, None);

        let empty = preview_command(&document, insert_vertex_command(Point::new(4.0, 4.0)))
            .expect("preview succeeds");
        assert!(empty.segments.is_empty());
        assert!(empty.points.is_empty());
        assert_eq!(empty.unavailable.as_deref(), Some("NoCreaseThroughPoint"));
    }

    #[test]
    fn registry_has_no_duplicate_operation_ids() {
        let mut ids = HashSet::new();

        for descriptor in operation_descriptors() {
            assert!(
                ids.insert(descriptor.id),
                "duplicate operation descriptor for {:?}",
                descriptor.id
            );
        }
    }

    #[test]
    fn registry_includes_representative_source_mapped_operations() {
        assert_eq!(
            operation_descriptor(OperationId::DrawCreaseFree).map(|descriptor| descriptor.target),
            Some("operations::construction::draw_crease_segment")
        );
        assert_eq!(
            operation_descriptor(OperationId::ImportFold).map(|descriptor| descriptor.category),
            Some(OperationCategory::Io)
        );
        assert_eq!(
            operation_descriptor(OperationId::Check4).map(|descriptor| descriptor.stage),
            Some(9)
        );
        assert_eq!(
            operation_status(OperationId::BackgroundChangePosition),
            OperationStatus::OutOfScopeUi
        );
    }

    #[test]
    fn registry_uses_dispatchable_status_values() {
        for descriptor in operation_descriptors() {
            assert!(
                matches!(
                    descriptor.status,
                    OperationStatus::Unsupported
                        | OperationStatus::Porting
                        | OperationStatus::UnitTested
                        | OperationStatus::OracleTested
                        | OperationStatus::DocumentedDifference
                        | OperationStatus::OutOfScopeUi
                ),
                "{:?} uses a status marker that command dispatch does not handle",
                descriptor.id
            );
        }
    }

    #[test]
    fn unsupported_dispatch_returns_typed_error_without_mutating_document() {
        let mut document = CreasePatternDocument {
            title: Some("fixture".to_string()),
            metadata: BTreeMap::new(),
            ..CreasePatternDocument::default()
        };
        let original = document.clone();

        let error = execute_command(&mut document, CreasePatternCommand::new(OperationId::Fold))
            .expect_err("stage one operations should be unsupported");

        assert_eq!(
            error,
            CommandError::UnsupportedOperation {
                operation: OperationId::Fold,
            }
        );
        assert_eq!(document, original);
    }

    #[test]
    fn command_dispatch_applies_oracle_tested_line_color_mutations() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            LineColor::Blue2,
        );
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(0.0, 1.0),
            LineColor::Red1,
        );

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CreaseMakeMountain).with_payload(
                CreasePatternCommandPayload {
                    line_ids: vec![1, 2],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("selected line color command should execute");

        assert_eq!(result.operation, OperationId::CreaseMakeMountain);
        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(result.diagnostics, vec!["Changed 1 line(s)"]);
        assert_eq!(
            document.crease_pattern.line_segments[0].color,
            LineColor::Red1
        );
        assert_eq!(
            document.crease_pattern.line_segments[1].color,
            LineColor::Red1
        );
    }

    #[test]
    fn command_dispatch_sets_selected_lines_to_arbitrary_line_color() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(0.0, 1.0),
            LineColor::Blue2,
        );

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CreaseSetLineColor).with_payload(
                CreasePatternCommandPayload {
                    line_ids: vec![1, 2],
                    line_color: Some(LineColor::Purple8),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("generic selected line color command should execute");

        assert_eq!(result.operation, OperationId::CreaseSetLineColor);
        assert_eq!(result.status, OperationStatus::UnitTested);
        assert_eq!(result.diagnostics, vec!["Changed 2 line(s)"]);
        assert!(
            document
                .crease_pattern
                .line_segments
                .iter()
                .all(|segment| segment.color == LineColor::Purple8)
        );
    }

    #[test]
    fn command_dispatch_can_replace_existing_box_selection() {
        let mut document = CreasePatternDocument::default();
        for x in [0.0, 5.0, 10.0] {
            document.crease_pattern.add_line(
                Point::new(x, 0.0),
                Point::new(x, 1.0),
                LineColor::Blue2,
            );
        }
        document.crease_pattern.line_segments[0].selected = 2;

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CreaseSelect).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(4.0, -1.0), Point::new(6.0, 2.0)],
                    replace_selection: Some(true),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("replace selection box command should execute");

        assert_eq!(result.operation, OperationId::CreaseSelect);
        assert_eq!(result.diagnostics, vec!["Changed 1 line(s)"]);
        assert_eq!(
            document
                .crease_pattern
                .line_segments
                .iter()
                .map(|line| line.selected)
                .collect::<Vec<_>>(),
            vec![0, 2, 0]
        );
    }

    #[test]
    fn command_dispatch_deletes_resolved_line_targets() {
        let mut document = CreasePatternDocument::default();
        for x in [0.0, 1.0, 2.0] {
            document.crease_pattern.add_line(
                Point::new(x, 0.0),
                Point::new(x, 1.0),
                LineColor::Black0,
            );
        }

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::LineSegmentDelete).with_payload(
                CreasePatternCommandPayload {
                    line_ids: vec![1, 3],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("delete command should execute");

        assert_eq!(result.diagnostics, vec!["Changed 2 line(s)"]);
        assert_eq!(document.crease_pattern.line_segments.len(), 1);
        assert_eq!(document.crease_pattern.line_segments[0].a.x, 1.0);
    }

    #[test]
    fn command_dispatch_moves_resolved_selected_lines() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(0.0, 2.0),
            Point::new(1.0, 2.0),
            LineColor::Blue2,
        );

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CreaseMove).with_payload(
                CreasePatternCommandPayload {
                    line_ids: vec![1],
                    points: vec![Point::new(0.0, 0.0), Point::new(2.0, 3.0)],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("move command should execute");

        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(result.diagnostics, vec!["Changed 1 line(s)"]);
        assert_eq!(document.crease_pattern.line_segments.len(), 2);
        assert_eq!(
            document.crease_pattern.line_segments[0].a,
            Point::new(0.0, 2.0)
        );
        assert_eq!(
            document.crease_pattern.line_segments[1].a,
            Point::new(2.0, 3.0)
        );
        assert_eq!(
            document.crease_pattern.line_segments[1].b,
            Point::new(3.0, 3.0)
        );
    }

    #[test]
    fn command_dispatch_copies_resolved_selected_lines() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            LineColor::Red1,
        );

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CreaseCopy).with_payload(
                CreasePatternCommandPayload {
                    line_ids: vec![1],
                    points: vec![Point::new(0.0, 0.0), Point::new(0.0, 2.0)],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("copy command should execute");

        assert_eq!(result.diagnostics, vec!["Changed 1 line(s)"]);
        assert_eq!(document.crease_pattern.line_segments.len(), 2);
        assert_eq!(
            document.crease_pattern.line_segments[0].a,
            Point::new(0.0, 0.0)
        );
        assert_eq!(
            document.crease_pattern.line_segments[1].a,
            Point::new(0.0, 2.0)
        );
        assert_eq!(
            document.crease_pattern.line_segments[1].b,
            Point::new(1.0, 2.0)
        );
    }

    #[test]
    fn command_dispatch_copies_resolved_selected_lines_by_four_points() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(1.0, 0.0),
            Point::new(1.0, 1.0),
            LineColor::Red1,
        );

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CreaseCopy4p).with_payload(
                CreasePatternCommandPayload {
                    line_ids: vec![1],
                    points: vec![
                        Point::new(0.0, 0.0),
                        Point::new(1.0, 0.0),
                        Point::new(0.0, 0.0),
                        Point::new(0.0, 2.0),
                    ],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("four-point copy command should execute");

        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(document.crease_pattern.line_segments.len(), 2);
        assert_close(document.crease_pattern.line_segments[1].a.x, 0.0);
        assert_close(document.crease_pattern.line_segments[1].a.y, 2.0);
        assert_close(document.crease_pattern.line_segments[1].b.x, -2.0);
        assert_close(document.crease_pattern.line_segments[1].b.y, 2.0);
    }

    #[test]
    fn command_dispatch_deletes_lines_overlapping_resolved_drag_segment() {
        let mut document = delete_along_fixture();

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CreaseDeleteOverlapping).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(2.0, 0.0), Point::new(8.0, 0.0)],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("overlapping-line delete command should execute");

        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(result.diagnostics, vec!["Changed 1 line(s)"]);
        assert_eq!(document.crease_pattern.line_segments.len(), 2);
        assert_eq!(
            document.crease_pattern.line_segments[0].a,
            Point::new(5.0, -5.0)
        );
        assert_eq!(
            document.crease_pattern.line_segments[1].a,
            Point::new(0.0, 1.0)
        );
    }

    #[test]
    fn command_dispatch_deletes_lines_intersecting_resolved_drag_segment() {
        let mut document = delete_along_fixture();

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CreaseDeleteIntersecting).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(2.0, 0.0), Point::new(8.0, 0.0)],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("intersecting-line delete command should execute");

        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(result.diagnostics, vec!["Changed 2 line(s)"]);
        assert_eq!(document.crease_pattern.line_segments.len(), 1);
        assert_eq!(
            document.crease_pattern.line_segments[0].a,
            Point::new(0.0, 1.0)
        );
    }

    #[test]
    fn command_dispatch_selects_lines_intersecting_resolved_drag_segment() {
        let mut document = delete_along_fixture();

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::SelectLineIntersecting).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(2.0, 0.0), Point::new(8.0, 0.0)],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("intersecting-line select command should execute");

        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(result.diagnostics, vec!["Changed 2 line(s)"]);
        assert_eq!(
            document
                .crease_pattern
                .line_segments
                .iter()
                .map(|line| line.selected)
                .collect::<Vec<_>>(),
            vec![2, 2, 0]
        );
    }

    #[test]
    fn command_dispatch_unselects_lines_intersecting_resolved_drag_segment() {
        let mut document = delete_along_fixture();
        for line in &mut document.crease_pattern.line_segments {
            *line = line.with_selected(2);
        }

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::UnselectLineIntersecting).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(2.0, 0.0), Point::new(8.0, 0.0)],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("intersecting-line unselect command should execute");

        assert_eq!(result.diagnostics, vec!["Changed 2 line(s)"]);
        assert_eq!(
            document
                .crease_pattern
                .line_segments
                .iter()
                .map(|line| line.selected)
                .collect::<Vec<_>>(),
            vec![0, 0, 2]
        );
    }

    #[test]
    fn command_dispatch_fixes_inaccurate_selected_lines_with_default_options() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.1954, 0.0),
            Point::new(10.0, 0.0),
            LineColor::Red1,
        );

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::FixInaccurate).with_payload(
                CreasePatternCommandPayload {
                    line_ids: vec![1],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("fix inaccurate command should execute");

        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(result.diagnostics, vec!["Changed 1 line(s)"]);
        assert_close(document.crease_pattern.line_segments[0].a.x, 0.1953125);
    }

    #[test]
    fn command_dispatch_uses_fix_inaccurate_payload_options() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.1954, 0.0),
            Point::new(10.0, 0.0),
            LineColor::Red1,
        );

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::FixInaccurate).with_payload(
                CreasePatternCommandPayload {
                    line_ids: vec![1],
                    fix_precision: Some(0.0),
                    fix_precision_use_bp: Some(false),
                    fix_precision_use_22_5: Some(false),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("fix inaccurate command should execute with explicit options");

        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(result.diagnostics, vec!["Changed 0 line(s)"]);
        assert_close(document.crease_pattern.line_segments[0].a.x, 0.1954);
    }

    #[test]
    fn command_dispatch_routes_stage_five_selection_polygons() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(10.0, 10.0),
            Point::new(11.0, 10.0),
            LineColor::Blue2,
        );

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::SelectPolygon).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(-1.0, -1.0), Point::new(2.0, 1.0)],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("polygon selection should execute");

        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(result.diagnostics, vec!["Changed 1 line(s)"]);
        assert_eq!(
            document
                .crease_pattern
                .line_segments
                .iter()
                .map(|line| line.selected)
                .collect::<Vec<_>>(),
            vec![2, 0]
        );

        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::UnselectLasso).with_payload(
                CreasePatternCommandPayload {
                    points: vec![
                        Point::new(-1.0, -1.0),
                        Point::new(2.0, -1.0),
                        Point::new(2.0, 1.0),
                        Point::new(-1.0, 1.0),
                    ],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("lasso unselection should execute");
        assert_eq!(document.crease_pattern.line_segments[0].selected, 0);
    }

    #[test]
    fn command_dispatch_routes_stage_five_type_and_vertex_commands() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(1.0, 0.0),
            Point::new(2.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(0.0, 1.0),
            Point::new(1.0, 1.0),
            LineColor::Blue2,
        );

        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::ReplaceLineTypeSelect).with_payload(
                CreasePatternCommandPayload {
                    line_ids: vec![1, 3],
                    custom_from_line_type: Some(model::CustomLineType::Valley),
                    custom_to_line_type: Some(model::CustomLineType::Edge),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("replace line type should execute");
        assert_eq!(
            document.crease_pattern.line_segments[2].color,
            LineColor::Black0
        );

        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::DeletePoint).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(1.0, 0.0)],
                    selection_distance: Some(1.0),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("delete point should execute");
        assert_eq!(document.crease_pattern.line_segments.len(), 2);
        assert_eq!(
            document.crease_pattern.line_segments[1].a,
            Point::new(0.0, 0.0)
        );
        assert_eq!(
            document.crease_pattern.line_segments[1].b,
            Point::new(2.0, 0.0)
        );
    }

    #[test]
    fn command_dispatch_lengthens_first_line_to_second_line_ids() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(2.0, -1.0),
            Point::new(2.0, 1.0),
            LineColor::Black0,
        );

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::LengthenCrease).with_payload(
                CreasePatternCommandPayload {
                    line_ids: vec![1, 2],
                    line_color: Some(LineColor::Blue2),
                    selection_distance: Some(1.0),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("line-id lengthen should execute");

        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(result.diagnostics, vec!["Changed 1 line(s)"]);
        assert!(
            document
                .crease_pattern
                .line_segments
                .iter()
                .any(|segment| segment.a == Point::new(2.0, 0.0)
                    && segment.b == Point::new(1.0, 0.0)
                    && segment.color == LineColor::Blue2)
        );
    }

    #[test]
    fn command_dispatch_lengthens_creases_a_drag_selection_line_crosses() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(2.0, -1.0),
            Point::new(2.0, 1.0),
            LineColor::Black0,
        );

        // A dragged selection line (points 0→1) crossing the red crease picks it to
        // extend; the extension point (point 2) lands on the vertical target.
        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::LengthenCrease).with_payload(
                CreasePatternCommandPayload {
                    points: vec![
                        Point::new(0.5, -0.5),
                        Point::new(0.5, 0.5),
                        Point::new(2.0, 0.0),
                    ],
                    line_color: Some(LineColor::Blue2),
                    selection_distance: Some(1.0),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("drag-select lengthen should execute");

        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(result.diagnostics, vec!["Changed 1 line(s)"]);
        assert!(
            document
                .crease_pattern
                .line_segments
                .iter()
                .any(|segment| segment.a == Point::new(2.0, 0.0)
                    && segment.b == Point::new(1.0, 0.0)
                    && segment.color == LineColor::Blue2)
        );
    }

    #[test]
    fn command_dispatch_routes_operation_frame_create() {
        let mut document = CreasePatternDocument::default();

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::OperationFrameCreate).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(0.0, 0.0), Point::new(4.0, 3.0)],
                    selection_distance: Some(0.5),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("operation frame create should execute");

        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(result.diagnostics, vec!["Changed 1 line(s)"]);
        assert!(document.operation_frame.active);
        assert_eq!(document.operation_frame.p1(), Point::new(0.0, 0.0));
        assert_eq!(document.operation_frame.p3(), Point::new(4.0, 3.0));
    }

    #[test]
    fn command_dispatch_requires_resolved_line_targets() {
        let mut document = CreasePatternDocument::default();

        let error = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CreaseMakeValley),
        )
        .expect_err("selected line commands require line IDs");

        assert_eq!(
            error,
            CommandError::InvalidInput {
                operation: OperationId::CreaseMakeValley,
                message: "select at least one line".to_string(),
            }
        );
    }

    #[test]
    fn command_dispatch_requires_resolved_points_for_transform_commands() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            LineColor::Red1,
        );

        let error = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CreaseMove).with_payload(
                CreasePatternCommandPayload {
                    line_ids: vec![1],
                    points: vec![Point::new(0.0, 0.0)],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect_err("move commands require a source and destination point");

        assert_eq!(
            error,
            CommandError::InvalidInput {
                operation: OperationId::CreaseMove,
                message: "expected 2 resolved point(s)".to_string(),
            }
        );
    }

    #[test]
    fn command_dispatch_requires_resolved_points_for_drag_delete_commands() {
        let mut document = delete_along_fixture();

        let error = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CreaseDeleteOverlapping),
        )
        .expect_err("drag-delete commands require a drag segment");

        assert_eq!(
            error,
            CommandError::InvalidInput {
                operation: OperationId::CreaseDeleteOverlapping,
                message: "expected 2 resolved point(s)".to_string(),
            }
        );
    }

    #[test]
    fn command_dispatch_requires_resolved_points_for_intersecting_selection_commands() {
        let mut document = delete_along_fixture();

        let error = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::SelectLineIntersecting),
        )
        .expect_err("intersecting-line selection commands require a drag segment");

        assert_eq!(
            error,
            CommandError::InvalidInput {
                operation: OperationId::SelectLineIntersecting,
                message: "expected 2 resolved point(s)".to_string(),
            }
        );
    }

    #[test]
    fn command_dispatch_routes_stage_six_draw_and_point_commands() {
        let mut document = CreasePatternDocument::default();

        let draw_result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::DrawCreaseFree).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(0.0, 0.0), Point::new(2.0, 0.0)],
                    line_color: Some(LineColor::Blue2),
                    selection_distance: Some(0.5),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("free draw should execute through the command dispatcher");

        assert_eq!(draw_result.status, OperationStatus::OracleTested);
        assert_eq!(document.crease_pattern.line_segments.len(), 1);
        assert_eq!(
            document.crease_pattern.line_segments[0].color,
            LineColor::Blue2
        );

        let point_result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::DrawPoint).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(1.0, 0.0)],
                    selection_distance: Some(0.5),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("draw point should split the nearest target segment");

        assert_eq!(point_result.status, OperationStatus::OracleTested);
        assert_eq!(document.crease_pattern.line_segments.len(), 2);
        assert!(
            document
                .crease_pattern
                .line_segments
                .iter()
                .any(|segment| segment.a == Point::new(1.0, 0.0)
                    || segment.b == Point::new(1.0, 0.0))
        );
    }

    #[test]
    fn command_dispatch_routes_stage_eight_circle_creation_commands() {
        let mut document = CreasePatternDocument::default();

        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CircleDraw).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(1.0, 2.0), Point::new(4.0, 6.0)],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("restricted circle draw should execute");
        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CircleDrawFree).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(0.0, 0.0), Point::new(0.0, 2.0)],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("free circle draw should execute");
        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CircleDrawSeparate).with_payload(
                CreasePatternCommandPayload {
                    points: vec![
                        Point::new(10.0, 10.0),
                        Point::new(1.0, 1.0),
                        Point::new(4.0, 5.0),
                    ],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("separate circle draw should execute");
        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CircleDrawThreePoint).with_payload(
                CreasePatternCommandPayload {
                    points: vec![
                        Point::new(1.0, 0.0),
                        Point::new(0.0, 1.0),
                        Point::new(-1.0, 0.0),
                    ],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("three-point circle draw should execute");

        assert_eq!(document.crease_pattern.circles.len(), 4);
        assert_eq!(document.crease_pattern.circles[0].r, 5.0);
        assert_eq!(document.crease_pattern.circles[1].r, 2.0);
        assert_eq!(document.crease_pattern.circles[2].r, 5.0);
        assert!(
            document
                .crease_pattern
                .circles
                .iter()
                .all(|circle| circle.color == LineColor::Cyan3)
        );
    }

    #[test]
    fn command_dispatch_routes_stage_eight_selected_circle_commands() {
        let mut document = CreasePatternDocument::default();
        document
            .crease_pattern
            .add_circle(Circle::new(0.0, 0.0, 1.0, LineColor::Cyan3));
        document
            .crease_pattern
            .add_circle(Circle::new(5.0, 0.0, 1.0, LineColor::Cyan3));
        document
            .crease_pattern
            .add_circle(Circle::new(10.0, 0.0, 2.0, LineColor::Cyan3));
        document
            .crease_pattern
            .add_circle(Circle::new(12.0, 0.0, 4.0, LineColor::Cyan3));
        document.crease_pattern.add_line(
            Point::new(2.0, -1.0),
            Point::new(2.0, 1.0),
            LineColor::Black0,
        );

        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CircleDrawConcentric).with_payload(
                CreasePatternCommandPayload {
                    circle_ids: vec![1],
                    points: vec![Point::new(0.0, 0.0), Point::new(0.0, 2.0)],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("concentric circle should execute");
        assert_eq!(
            document
                .crease_pattern
                .circles
                .last()
                .map(|circle| circle.r),
            Some(3.0)
        );

        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CircleDrawConcentricSelect).with_payload(
                CreasePatternCommandPayload {
                    circle_ids: vec![4, 1, 3],
                    candidate_index: Some(1),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("concentric select should execute");
        assert_eq!(
            document
                .crease_pattern
                .circles
                .last()
                .map(|circle| circle.r),
            Some(3.0)
        );

        let before_two_circle = document.crease_pattern.circles.len();
        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CircleDrawConcentricTwoCircleSelect)
                .with_payload(CreasePatternCommandPayload {
                    circle_ids: vec![1, 2],
                    ..CreasePatternCommandPayload::default()
                }),
        )
        .expect("two-circle concentric select should execute");
        assert_eq!(document.crease_pattern.circles.len(), before_two_circle + 2);

        let before_tangent = document.crease_pattern.line_segments.len();
        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CircleDrawTangentLine).with_payload(
                CreasePatternCommandPayload {
                    circle_ids: vec![1, 2],
                    candidate_index: Some(0),
                    line_color: Some(LineColor::Blue2),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("two-circle tangent line should execute");
        assert_eq!(
            document.crease_pattern.line_segments.len(),
            before_tangent + 1
        );
        assert_eq!(
            document
                .crease_pattern
                .line_segments
                .last()
                .map(|line| line.color),
            Some(LineColor::Blue2)
        );

        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CircleDrawTangentLine).with_payload(
                CreasePatternCommandPayload {
                    circle_ids: vec![1],
                    points: vec![Point::new(5.0, 0.0)],
                    candidate_index: Some(1),
                    line_color: Some(LineColor::Red1),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("point-circle tangent line should execute");
        assert_eq!(
            document
                .crease_pattern
                .line_segments
                .last()
                .map(|line| line.color),
            Some(LineColor::Red1)
        );

        let before_invert = document.crease_pattern.circles.len();
        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CircleDrawInverted).with_payload(
                CreasePatternCommandPayload {
                    circle_ids: vec![3, 1],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("circle inversion should execute");
        assert_eq!(document.crease_pattern.circles.len(), before_invert + 1);

        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CircleDrawInverted).with_payload(
                CreasePatternCommandPayload {
                    line_ids: vec![1],
                    circle_ids: vec![1],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("line inversion should execute");
        assert!(document.crease_pattern.circles.len() > before_invert + 1);
    }

    #[test]
    fn command_dispatch_routes_stage_eight_shape_generators() {
        let mut document = CreasePatternDocument::default();

        let polygon_result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::PolygonSetNoCorners).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(0.0, 0.0), Point::new(1.0, 0.0)],
                    line_color: Some(LineColor::Blue2),
                    polygon_corners: Some(4),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("regular polygon should execute");

        assert_eq!(polygon_result.status, OperationStatus::OracleTested);
        assert_eq!(document.crease_pattern.line_segments.len(), 4);
        assert!(
            document
                .crease_pattern
                .line_segments
                .iter()
                .all(|segment| segment.color == LineColor::Blue2)
        );

        let molecule_result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::DrawBlintz).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(-200.0, -200.0), Point::new(200.0, 200.0)],
                    line_color: Some(LineColor::Red1),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("default molecule should execute");

        assert_eq!(molecule_result.status, OperationStatus::OracleTested);
        assert_eq!(document.crease_pattern.line_segments.len(), 8);
        assert!(
            document.crease_pattern.line_segments[4..]
                .iter()
                .all(|segment| segment.color == LineColor::Red1)
        );
    }

    #[test]
    fn command_dispatch_routes_stage_eight_voronoi_generator() {
        let mut document = CreasePatternDocument::default();

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::VoronoiCreate).with_payload(
                CreasePatternCommandPayload {
                    points: vec![
                        Point::new(0.0, 0.0),
                        Point::new(2.0, 0.0),
                        Point::new(0.0, 2.0),
                    ],
                    line_color: Some(LineColor::Blue2),
                    selection_distance: Some(0.25),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("voronoi generator should execute");

        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(result.diagnostics, vec!["Changed 6 line(s)"]);
        assert_eq!(document.crease_pattern.line_segments.len(), 3);
        assert_eq!(document.crease_pattern.circles.len(), 3);
        assert!(
            document
                .crease_pattern
                .line_segments
                .iter()
                .all(|segment| segment.color == LineColor::Blue2)
        );
        assert!(
            document
                .crease_pattern
                .circles
                .iter()
                .all(|circle| circle.color == LineColor::Cyan3 && circle.r == 5.0)
        );
    }

    #[test]
    fn command_dispatch_routes_stage_eight_circle_color_changes() {
        let mut document = CreasePatternDocument::default();
        document
            .crease_pattern
            .add_circle(Circle::new(0.0, 0.0, 2.0, LineColor::Cyan3));
        document
            .crease_pattern
            .add_circle(Circle::new(2.0, 0.0, 1.0, LineColor::Cyan3));
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            LineColor::Cyan3,
        );
        document.crease_pattern.add_line(
            Point::new(0.0, 1.0),
            Point::new(1.0, 1.0),
            LineColor::Red1,
        );

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CircleChangeColor).with_payload(
                CreasePatternCommandPayload {
                    circle_ids: vec![2],
                    line_ids: vec![1, 2],
                    custom_circle_color: Some(RgbColor::new(10, 20, 30)),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("circle color command should execute");

        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(result.diagnostics, vec!["Changed 2 line(s)"]);
        assert_eq!(document.crease_pattern.circles[0].customized, 0);
        assert_eq!(document.crease_pattern.circles[1].customized, 1);
        assert_eq!(
            document.crease_pattern.circles[1].customized_color,
            RgbColor::new(10, 20, 30)
        );
        assert_eq!(document.crease_pattern.line_segments[0].customized, 1);
        assert_eq!(
            document.crease_pattern.line_segments[0].customized_color,
            RgbColor::new(10, 20, 30)
        );
        assert_eq!(document.crease_pattern.line_segments[1].customized, 0);
    }

    #[test]
    fn command_dispatch_routes_stage_eight_circle_organization() {
        let mut document = CreasePatternDocument::default();
        document
            .crease_pattern
            .add_circle(Circle::new(0.0, 0.0, 2.0, LineColor::Cyan3));
        document
            .crease_pattern
            .add_circle(Circle::new(2.0, 0.0, 0.0, LineColor::Cyan3));
        document
            .crease_pattern
            .add_circle(Circle::new(3.0, 0.0, 0.0, LineColor::Cyan3));

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::OrganizeCircles),
        )
        .expect("organize circles should execute");

        assert_eq!(result.status, OperationStatus::OracleTested);
        assert_eq!(result.diagnostics, vec!["Changed 2 line(s)"]);
        assert_eq!(document.crease_pattern.circles.len(), 1);
        assert_eq!(document.crease_pattern.circles[0].r, 2.0);
    }

    #[test]
    fn command_dispatch_routes_stage_nine_diagnostics_and_repairs() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(5.0, 0.0),
            Point::new(15.0, 0.0),
            LineColor::Blue2,
        );

        let before = document.clone();
        let check1 = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::Check1),
        )
        .expect("Check1 should execute");
        assert_eq!(document, before);
        assert_eq!(check1.diagnostics, vec!["Check1 found 1 issue(s)"]);
        assert_eq!(check1.diagnostic_entries.len(), 1);
        assert_eq!(check1.diagnostic_entries[0].segments.len(), 2);

        let fix1 = execute_command(&mut document, CreasePatternCommand::new(OperationId::Fix1))
            .expect("Fix1 should execute");
        assert_eq!(fix1.diagnostics, vec!["Changed 0 line(s)"]);
        assert!(
            document
                .crease_pattern
                .line_segments
                .iter()
                .any(|line| line.selected != 0)
        );

        document.crease_pattern.line_segments.clear();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(5.0, 0.0),
            Point::new(5.0, 5.0),
            LineColor::Blue2,
        );
        let check2 = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::Check2),
        )
        .expect("Check2 should execute");
        assert_eq!(check2.diagnostic_entries.len(), 1);
        let fix2 = execute_command(&mut document, CreasePatternCommand::new(OperationId::Fix2))
            .expect("Fix2 should execute");
        assert_eq!(fix2.diagnostics, vec!["Changed 1 line(s)"]);

        let check4 = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::Check4),
        )
        .expect("Check4 should execute");
        assert!(
            check4
                .diagnostic_entries
                .iter()
                .any(|entry| entry.point.is_some())
        );

        let mut boundary_document = CreasePatternDocument::default();
        let flat_check = execute_command(
            &mut boundary_document,
            CreasePatternCommand::new(OperationId::FlatFoldableCheck).with_payload(
                CreasePatternCommandPayload {
                    points: vec![
                        Point::new(-1.0, -1.0),
                        Point::new(1.0, -1.0),
                        Point::new(0.0, 1.0),
                        Point::new(-1.0, -1.0),
                    ],
                    boundary_close_distance: Some(0.01),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("FlatFoldableCheck should execute");
        assert_eq!(
            flat_check.diagnostics,
            vec!["Flat-foldable boundary check passed"]
        );
        assert_eq!(flat_check.diagnostic_entries[0].severity, "info");
        assert!(
            flat_check.diagnostic_entries[0]
                .segments
                .iter()
                .all(|segment| segment.color == LineColor::Cyan3)
        );

        let open_check = execute_command(
            &mut boundary_document,
            CreasePatternCommand::new(OperationId::FlatFoldableCheck).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(-1.0, -1.0), Point::new(1.0, -1.0)],
                    boundary_close_distance: Some(0.01),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("open FlatFoldableCheck should return a warning result");
        assert_eq!(
            open_check.diagnostics,
            vec!["Flat-foldable boundary check needs a closed loop"]
        );
        assert_eq!(open_check.diagnostic_entries[0].severity, "warning");
    }

    #[test]
    fn flat_foldable_check_closes_on_its_own_tolerance_not_the_pointer_radius() {
        // The frontend puts its pointer radius on every tool command, so the
        // triangle below arrives with a `selection_distance` wide enough to span
        // the 5-unit gap in its loop. Closure is a geometric question, so only
        // `boundary_close_distance` may answer it.
        let mut document = CreasePatternDocument::default();
        let almost_closed = vec![
            Point::new(-100.0, -100.0),
            Point::new(100.0, -100.0),
            Point::new(0.0, 100.0),
            Point::new(-95.0, -100.0),
        ];

        let pointer_radius = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::FlatFoldableCheck).with_payload(
                CreasePatternCommandPayload {
                    points: almost_closed.clone(),
                    selection_distance: Some(5.442177),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("FlatFoldableCheck should execute");
        assert_eq!(
            pointer_radius.diagnostics,
            vec!["Flat-foldable boundary check needs a closed loop"]
        );

        let stated_tolerance = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::FlatFoldableCheck).with_payload(
                CreasePatternCommandPayload {
                    points: almost_closed,
                    boundary_close_distance: Some(5.442177),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("FlatFoldableCheck should execute");
        assert_eq!(
            stated_tolerance.diagnostics,
            vec!["Flat-foldable boundary check passed"]
        );
    }

    #[test]
    fn command_dispatch_routes_delete_extra_vertices() {
        // Two collinear mountains sharing a vertex, plus one valley continuing
        // the same line. The same-colour sweep may only merge the mountain pair;
        // the ignore-colour sweep goes on to fold the valley in as well.
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(10.0, 0.0),
            Point::new(20.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(20.0, 0.0),
            Point::new(30.0, 0.0),
            LineColor::Blue2,
        );

        let same_colour = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::DeleteExtraVertices),
        )
        .expect("DeleteExtraVertices should execute");
        assert_eq!(same_colour.diagnostics, vec!["Changed 1 line(s)"]);
        assert_eq!(document.crease_pattern.line_segments.len(), 2);

        let ignore_colour = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::DeleteExtraVerticesIgnoreColor),
        )
        .expect("DeleteExtraVerticesIgnoreColor should execute");
        assert_eq!(ignore_colour.diagnostics, vec!["Changed 1 line(s)"]);
        assert_eq!(document.crease_pattern.line_segments.len(), 1);
        // Oriedita's colour matrix: mountain + valley resolves to an edge.
        assert_eq!(
            document.crease_pattern.line_segments[0].color,
            LineColor::Black0
        );

        // A no-op run reports zero rather than a phantom change.
        let repeat = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::DeleteExtraVerticesIgnoreColor),
        )
        .expect("a second sweep should execute");
        assert_eq!(repeat.diagnostics, vec!["Changed 0 line(s)"]);
    }

    #[test]
    fn delete_extra_vertices_leaves_genuine_corners_alone() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(10.0, 0.0),
            Point::new(10.0, 10.0),
            LineColor::Red1,
        );

        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::DeleteExtraVerticesIgnoreColor),
        )
        .expect("DeleteExtraVerticesIgnoreColor should execute");
        assert_eq!(result.diagnostics, vec!["Changed 0 line(s)"]);
        assert_eq!(document.crease_pattern.line_segments.len(), 2);
    }

    #[test]
    fn flat_foldability_command_diagnostics_include_oriedita_marker_metadata() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(-10.0, 0.0),
            LineColor::Blue2,
        );

        let camv = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CheckCamv),
        )
        .expect("CheckCamv should execute");
        let maekawa = camv
            .diagnostic_entries
            .iter()
            .find(|entry| entry.rule.as_deref() == Some("Maekawa"))
            .expect("Maekawa violation should be reported");
        assert_eq!(maekawa.violation_color.as_deref(), Some("Equal"));
        assert!(maekawa.big_little_big.is_empty());

        document.crease_pattern.line_segments.clear();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(8.660254037844386, 5.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(0.0, 10.0),
            LineColor::Blue2,
        );
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(-10.0, 0.0),
            LineColor::Blue2,
        );
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(-8.660254037844386, -5.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(0.0, -10.0),
            LineColor::Red1,
        );

        let check4 = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::Check4),
        )
        .expect("Check4 should execute");
        let big_little_big = check4
            .diagnostic_entries
            .iter()
            .find(|entry| entry.rule.as_deref() == Some("BigLittleBig"))
            .expect("Big-Little-Big violation should be reported");
        assert_eq!(big_little_big.violation_color.as_deref(), Some("Correct"));
        assert_eq!(
            big_little_big.segments.len(),
            big_little_big.big_little_big.len()
        );
        assert!(
            big_little_big
                .big_little_big
                .iter()
                .any(|sector| sector.violating)
        );
    }

    #[test]
    fn command_dispatch_routes_stage_eight_text_annotations() {
        let mut document = CreasePatternDocument::default();

        let create_result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::Text).with_payload(
                CreasePatternCommandPayload {
                    text_action: Some(TextCommandAction::Create),
                    points: vec![Point::new(10.0, 10.0)],
                    text_content: Some("note".to_string()),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("text create command should execute");

        assert_eq!(create_result.status, OperationStatus::OracleTested);
        assert_eq!(document.crease_pattern.texts.len(), 1);
        assert_eq!(document.crease_pattern.texts[0].text, "note");

        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::Text).with_payload(
                CreasePatternCommandPayload {
                    text_action: Some(TextCommandAction::Move),
                    text_ids: vec![1],
                    points: vec![Point::new(10.0, 10.0), Point::new(15.0, 12.0)],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("text move command should execute");
        assert_eq!(
            document.crease_pattern.texts[0].position(),
            Point::new(15.0, 12.0)
        );

        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::Text).with_payload(
                CreasePatternCommandPayload {
                    text_action: Some(TextCommandAction::SetContent),
                    text_ids: vec![1],
                    text_content: Some("updated".to_string()),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("text content command should execute");
        assert_eq!(document.crease_pattern.texts[0].text, "updated");

        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::Text).with_payload(
                CreasePatternCommandPayload {
                    text_action: Some(TextCommandAction::DeleteSelected),
                    text_ids: vec![1],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("text delete command should execute");
        assert!(document.crease_pattern.texts.is_empty());
    }

    #[test]
    fn command_dispatch_create_at_always_appends_text() {
        let mut document = CreasePatternDocument::default();

        // Seed an existing text; a plain `Create` press within its
        // identity-camera bounds would select instead of create.
        document
            .crease_pattern
            .add_text(model::TextElement::new(10.0, 10.0, "existing"));

        // A `Create` press near the existing text no-ops (selects, count unchanged).
        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::Text).with_payload(
                CreasePatternCommandPayload {
                    text_action: Some(TextCommandAction::Create),
                    points: vec![Point::new(12.0, 10.0)],
                    text_content: Some("blocked".to_string()),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("text create command should execute");
        assert_eq!(document.crease_pattern.texts.len(), 1);

        // `CreateAt` at the same point always appends.
        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::Text).with_payload(
                CreasePatternCommandPayload {
                    text_action: Some(TextCommandAction::CreateAt),
                    points: vec![Point::new(12.0, 10.0)],
                    text_content: Some("new".to_string()),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("text create-at command should execute");
        assert_eq!(document.crease_pattern.texts.len(), 2);
        assert_eq!(
            document.crease_pattern.texts[1].position(),
            Point::new(12.0, 10.0)
        );
        assert_eq!(document.crease_pattern.texts[1].text, "new");

        // `CreateAt` with no content creates a blank text (inline-editor start).
        execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::Text).with_payload(
                CreasePatternCommandPayload {
                    text_action: Some(TextCommandAction::CreateAt),
                    points: vec![Point::new(80.0, 80.0)],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("blank text create-at command should execute");
        assert_eq!(document.crease_pattern.texts.len(), 3);
        assert_eq!(document.crease_pattern.texts[2].text, "");
    }

    #[test]
    fn command_preview_returns_stage_eight_shape_candidates_without_mutating_document() {
        let mut document = CreasePatternDocument::default();
        document
            .crease_pattern
            .add_circle(Circle::new(0.0, 0.0, 1.0, LineColor::Cyan3));
        document
            .crease_pattern
            .add_circle(Circle::new(5.0, 0.0, 1.0, LineColor::Cyan3));
        document
            .crease_pattern
            .add_circle(Circle::new(10.0, 0.0, 2.0, LineColor::Cyan3));
        document
            .crease_pattern
            .add_circle(Circle::new(12.0, 0.0, 4.0, LineColor::Cyan3));
        let before = document.clone();

        let circle_preview = preview_command(
            &document,
            CreasePatternCommand::new(OperationId::CircleDraw).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(1.0, 2.0), Point::new(4.0, 6.0)],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("circle draw should expose a circle preview");

        assert!(circle_preview.segments.is_empty());
        assert_eq!(circle_preview.circles.len(), 1);
        assert_eq!(circle_preview.circles[0].r, 5.0);

        let tangent_preview = preview_command(
            &document,
            CreasePatternCommand::new(OperationId::CircleDrawTangentLine).with_payload(
                CreasePatternCommandPayload {
                    circle_ids: vec![1, 2],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("circle tangent should expose line candidates");
        assert_eq!(tangent_preview.segments.len(), 4);

        let concentric_preview = preview_command(
            &document,
            CreasePatternCommand::new(OperationId::CircleDrawConcentricSelect).with_payload(
                CreasePatternCommandPayload {
                    circle_ids: vec![4, 1, 3],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("concentric select should expose circle candidates");
        assert_eq!(concentric_preview.circles.len(), 2);

        let polygon_preview = preview_command(
            &document,
            CreasePatternCommand::new(OperationId::PolygonSetNoCorners).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(0.0, 0.0), Point::new(1.0, 0.0)],
                    polygon_corners: Some(3),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("regular polygon should expose line previews");

        assert_eq!(polygon_preview.segments.len(), 3);
        assert_eq!(document, before);

        let voronoi_preview = preview_command(
            &document,
            CreasePatternCommand::new(OperationId::VoronoiCreate).with_payload(
                CreasePatternCommandPayload {
                    points: vec![
                        Point::new(0.0, 0.0),
                        Point::new(2.0, 0.0),
                        Point::new(0.0, 2.0),
                    ],
                    selection_distance: Some(0.25),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("voronoi should expose line and seed previews");

        assert_eq!(voronoi_preview.segments.len(), 3);
        assert_eq!(voronoi_preview.points.len(), 3);
        assert_eq!(document, before);
    }

    #[test]
    fn command_preview_returns_stage_six_candidates_without_mutating_document() {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(-1.0, 1.0),
            Point::new(2.0, 1.0),
            LineColor::Black0,
        );
        let before = document.clone();

        let preview = preview_command(
            &document,
            CreasePatternCommand::new(OperationId::DrawCreaseAngleRestricted).with_payload(
                CreasePatternCommandPayload {
                    points: vec![Point::new(0.0, 0.0), Point::new(1.0, 0.0)],
                    angle_system_divider: Some(4),
                    line_color: Some(LineColor::Red1),
                    selection_distance: Some(0.5),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("angle-restricted construction should expose preview candidates");

        assert_eq!(document, before);
        assert!(!preview.segments.is_empty());
        assert!(!preview.points.is_empty());
        assert!(
            preview
                .segments
                .iter()
                .any(|segment| segment.color == LineColor::Orange4)
        );
    }

    fn delete_along_fixture() -> CreasePatternDocument {
        let mut document = CreasePatternDocument::default();
        document.crease_pattern.add_line(
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            LineColor::Red1,
        );
        document.crease_pattern.add_line(
            Point::new(5.0, -5.0),
            Point::new(5.0, 5.0),
            LineColor::Blue2,
        );
        document.crease_pattern.add_line(
            Point::new(0.0, 1.0),
            Point::new(10.0, 1.0),
            LineColor::Cyan3,
        );
        document
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {actual} to be within tolerance of {expected}"
        );
    }
}
