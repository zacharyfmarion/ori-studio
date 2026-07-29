//! Oriedita-compatible crease-pattern editing kernel for Ori Studio.
//!
//! This crate is intentionally conservative while the port is in progress.
//! Every known non-UI Oriedita operation is represented in the registry, but
//! unsupported operations fail with a typed error instead of fabricating nearby
//! behavior.

pub mod canonical;
pub mod checks;
pub mod checks_spatial;
mod fold_graph;
pub mod fold_profiling;
pub mod folding;
pub mod geometry;
pub mod geometry_transport;
pub mod io;
pub mod model;
pub mod operations;
pub mod session;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub use canonical::CanonicalCreasePattern;
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
    /// Optional UI-level replacement selection mode. Oriedita's primitive
    /// select operations are additive by default; callers set this when a
    /// normal click/box selection should replace the previous selected set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replace_selection: Option<bool>,
    /// Optional active grid width for grid-spaced construction tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid_width: Option<f64>,
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
    /// Optional toggle for BP fix-inaccurate targets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fix_precision_use_bp: Option<bool>,
    /// Optional toggle for 22.5-degree fix-inaccurate targets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fix_precision_use_22_5: Option<bool>,
    /// Optional number of corners for regular polygon generator commands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub polygon_corners: Option<usize>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub violation_color: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub little_big_little: Vec<CommandDiagnosticLittleBigLittleSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandDiagnosticLittleBigLittleSegment {
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
    OrganizeCircles,
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
    /// Planned Oriedita port stage.
    pub stage: u8,
    /// Current implementation status.
    pub status: OperationStatus,
}

macro_rules! descriptor {
    ($id:ident, $upstream:literal, $target:literal, $category:ident, $stage:literal, $status:ident) => {
        OperationDescriptor {
            id: OperationId::$id,
            upstream: $upstream,
            target: $target,
            category: OperationCategory::$category,
            stage: $stage,
            status: OperationStatus::$status,
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
        CreaseSetLineColor,
        "OriStudioSetLineColor",
        "operations::color::set_line_color_for_indices",
        Kernel,
        8,
        UnitTested
    ),
    descriptor!(
        CreaseSetFoldAngle,
        "OriStudioSetFoldAngle",
        "operations::color::set_fold_magnitude_for_indices",
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
        OrganizeCircles,
        "OrganizeCircles",
        "operations::circle::organize",
        Kernel,
        8,
        OracleTested
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
        OperationId::CreaseMakeAux => {
            let line_indices = required_line_indices(&command)?;
            operations::color::make_aux(&mut document.crease_pattern, &line_indices)
        }
        OperationId::CreaseToggleMv => {
            // Oriedita `CREASE_TOGGLE_MV_58` is a box-select tool: a single crease
            // click flips that crease, a dragged box flips every mountain/valley
            // line it encloses. `toggle_mountain_valley` already ignores non-M/V
            // lines, matching Oriedita's `LineColor::changeMV` filter.
            let line_indices = if command.payload.line_ids.is_empty() {
                let polygon = required_selection_polygon(&command)?;
                operations::selection::line_indices_in_box(&document.crease_pattern, &polygon)
            } else {
                required_line_indices(&command)?
            };
            operations::color::toggle_mountain_valley(&mut document.crease_pattern, &line_indices)
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
            if command.payload.line_ids.len() >= 3 {
                let line_indices = required_line_indices(&command)?;
                let first =
                    line_segment_for_operation(document, command.operation, line_indices[0])?;
                let second =
                    line_segment_for_operation(document, command.operation, line_indices[1])?;
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
            usize::from(operations::construction::draw_crease_angle_restricted_5(
                &mut document.crease_pattern,
                points[0],
                points[1],
                angle_system_divider(&command),
                angle_system_angles(&command),
                selection_distance(&command),
                active_line_color(&command),
            ))
        }
        OperationId::VertexMakeAngularlyFlatFoldable => {
            let points = required_points_at_least(&command, 2)?;
            let candidates = operations::construction::make_vertex_flat_foldable_candidates(
                &document.crease_pattern,
                points[0],
                grid_width(&command, &document.crease_pattern),
                active_line_color(&command),
            );
            // Oriedita's 3 clicks: vertex, candidate ray, then the existing crease it
            // extends to. Keep candidate (point[1]) and destination (point[2]) separate;
            // a legacy 2-point call reuses point[1] for both.
            let destination_point = if points.len() >= 3 {
                points[2]
            } else {
                points[1]
            };
            let selected = nearest_candidate_segment(&command, points[1], &candidates.candidates)?;
            let (_, destination) = nearest_line_segment(
                &document.crease_pattern,
                destination_point,
                selection_distance(&command),
            )?;
            usize::from(
                operations::construction::make_vertex_flat_foldable_to_destination(
                    &mut document.crease_pattern,
                    points[0],
                    &selected,
                    &destination,
                    candidates.commit_color,
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
                let candidates = operations::construction::make_vertex_flat_foldable_candidates(
                    &document.crease_pattern,
                    points[0],
                    grid_width(&command, &document.crease_pattern),
                    active_line_color(&command),
                );
                let selected =
                    nearest_candidate_segment(&command, points[1], &candidates.candidates)?;
                let (_, destination) = nearest_line_segment(
                    &document.crease_pattern,
                    points[1],
                    selection_distance(&command),
                )?;
                usize::from(
                    operations::construction::make_vertex_flat_foldable_to_destination(
                        &mut document.crease_pattern,
                        points[0],
                        &selected,
                        &destination,
                        candidates.commit_color,
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
            diagnostic_entries = flat_foldability_diagnostics("CheckCamv", dispatched.flat);
            diagnostic_entries.extend(spatial_closure_diagnostics(&dispatched.spatial));
            0
        }
        OperationId::FlatFoldableCheck => {
            let (mut boundary, closed) = flat_foldable_boundary_from_points(
                &command.payload.points,
                command
                    .payload
                    .selection_distance
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
            violation_color: None,
            little_big_little: Vec::new(),
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
            violation_color: None,
            little_big_little: Vec::new(),
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
            let little_big_little = violation
                .little_big_little
                .into_iter()
                .map(|segment| CommandDiagnosticLittleBigLittleSegment {
                    segment: segment.segment,
                    violating: segment.violating,
                })
                .collect::<Vec<_>>();
            let segments = little_big_little
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
                violation_color: Some(violation_color.to_string()),
                little_big_little,
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
const CLOSURE_RESIDUAL_BAR_DEGREES: f64 = 1e-6;

fn spatial_closure_diagnostics(
    reports: &[checks_spatial::SpatialVertexReport],
) -> Vec<CommandDiagnostic> {
    let mut diagnostics = Vec::new();
    for (index, report) in reports.iter().enumerate() {
        // An indeterminate vertex reports nothing. Both causes -- an unassigned
        // crease and an unsplit T-junction -- produce a residual identical to a
        // real parity failure, so reporting one would be a false positive.
        let Some(residual) = report.residual else {
            continue;
        };
        let residual_degrees = residual.to_degrees();
        if residual_degrees <= CLOSURE_RESIDUAL_BAR_DEGREES {
            // The vertex closes. Now ask the second, independent question:
            // does the paper pass through itself getting there? Only reachable
            // once closure holds, since a vertex that does not close has no
            // folded state whose geometry means anything.
            if report
                .contacts
                .is_some_and(|contacts| contacts.self_intersects())
            {
                diagnostics.push(CommandDiagnostic {
                    id: format!("SpatialSelfIntersection-{}", index + 1),
                    kind: "SpatialSelfIntersection".to_string(),
                    severity: "error".to_string(),
                    // No crossing count: it is a property of the link geometry,
                    // not something the user acts on one at a time. The fix is
                    // always to change the fold angles at this vertex.
                    message: "Paper passes through itself at this vertex".to_string(),
                    point: Some(report.point),
                    segments: Vec::new(),
                    rule: Some("SelfIntersection".to_string()),
                    violation_color: None,
                    little_big_little: Vec::new(),
                });
            }
            continue;
        }

        // Rigidity is not a conflict. A degree-1 or developable degree-3 vertex
        // has a unique solution and it is zero, so telling the user their angles
        // disagree would invite an adjustment that cannot help. The link of a
        // vertex is a closed spherical linkage, and a triangle is a rigid truss.
        let message = if report.is_rigid() {
            format!(
                "Vertex cannot fold: degree {} is rigid, so every crease here must be 0 degrees",
                report.degree
            )
        } else {
            format!("Creases do not close: {residual_degrees:.4} degrees off")
        };

        diagnostics.push(CommandDiagnostic {
            id: format!("SpatialClosure-{}", index + 1),
            kind: "SpatialClosure".to_string(),
            severity: "error".to_string(),
            message,
            point: Some(report.point),
            segments: Vec::new(),
            rule: Some(
                if report.is_rigid() {
                    "Rigid"
                } else {
                    "Closure"
                }
                .to_string(),
            ),
            violation_color: None,
            little_big_little: Vec::new(),
        });
    }
    diagnostics
}

fn flat_foldability_rule_label(rule: checks::FlatFoldabilityRule) -> &'static str {
    match rule {
        checks::FlatFoldabilityRule::NumberOfFolds => "NumberOfFolds",
        checks::FlatFoldabilityRule::Angles => "Angles",
        checks::FlatFoldabilityRule::Maekawa => "Maekawa",
        checks::FlatFoldabilityRule::LittleBigLittle => "LittleBigLittle",
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
        violation_color: None,
        little_big_little: Vec::new(),
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
        violation_color: None,
        little_big_little: Vec::new(),
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
            let snapped = operations::construction::snap_to_close_point_in_active_angle_system(
                &document.crease_pattern,
                points[0],
                points[1],
                angle_system_divider(&command),
                angle_system_angles(&command),
                selection_distance(&command),
            );
            preview.segments.push(LineSegment::with_color(
                points[0],
                snapped,
                active_line_color(&command),
            ));
        }
        OperationId::VertexMakeAngularlyFlatFoldable if !points.is_empty() => {
            let candidates = operations::construction::make_vertex_flat_foldable_candidates(
                &document.crease_pattern,
                points[0],
                grid_width(&command, &document.crease_pattern),
                active_line_color(&command),
            );
            if points.len() >= 3 {
                // Step 3: a candidate ray is chosen — show only it, plus the crease
                // that would be committed to the hovered destination (best-effort).
                if let Ok(selected) =
                    nearest_candidate_segment(&command, points[1], &candidates.candidates)
                {
                    preview.segments.push(selected.clone());
                    if let Ok((_, destination)) = nearest_line_segment(
                        &document.crease_pattern,
                        points[2],
                        selection_distance(&command),
                    ) {
                        let mut clone = document.clone();
                        if operations::construction::make_vertex_flat_foldable_to_destination(
                            &mut clone.crease_pattern,
                            points[0],
                            &selected,
                            &destination,
                            candidates.commit_color,
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
    use crate::geometry::{Circle, LineColor, Point, RgbColor};
    use std::collections::HashSet;

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
                    selection_distance: Some(0.01),
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
                    selection_distance: Some(0.01),
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
        assert!(maekawa.little_big_little.is_empty());

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
        let little_big_little = check4
            .diagnostic_entries
            .iter()
            .find(|entry| entry.rule.as_deref() == Some("LittleBigLittle"))
            .expect("Little-Big-Little violation should be reported");
        assert_eq!(
            little_big_little.violation_color.as_deref(),
            Some("Correct")
        );
        assert_eq!(
            little_big_little.segments.len(),
            little_big_little.little_big_little.len()
        );
        assert!(
            little_big_little
                .little_big_little
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
