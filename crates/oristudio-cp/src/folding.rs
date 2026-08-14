mod additional_estimation;
mod combination;
mod permutation;
mod quad_tree;

use crate::fold_graph::{FacePositions, FoldGraph, FoldGraphError};
use crate::geometry::{
    Epsilon, LineColor, LineSegment, Point, Polygon, PolygonIntersection, RgbColor,
    determine_line_segment_intersection, equal, equal_with_radius, move_parallel,
};
use crate::model::CreasePatternModel;
use crate::operations::arrangement::divide_intersections;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fmt};

#[allow(clippy::approx_constant)]
const ORIEDITA_DEGREES_TO_RADIANS: f64 = 3.14159265 / 180.0;

/// Native-only, feature-gated phase timer: prints ms since the previous mark to
/// stderr. Compiles to nothing off the `fold-profiling` feature or on wasm
/// (which has no `Instant`).
#[cfg(all(feature = "fold-profiling", not(target_arch = "wasm32")))]
pub(crate) fn fold_phase_mark(label: &str) {
    use std::cell::Cell;
    use std::time::Instant;
    thread_local! {
        static LAST: Cell<Option<Instant>> = const { Cell::new(None) };
    }
    let now = Instant::now();
    let previous = LAST.with(|last| last.replace(Some(now)));
    if let Some(previous) = previous {
        eprintln!(
            "  [fold-phase] {label}: {:.1}ms",
            now.duration_since(previous).as_secs_f64() * 1000.0
        );
    } else {
        eprintln!("  [fold-phase] {label}: (start)");
    }
}

macro_rules! fold_phase_timer {
    ($label:expr) => {{
        #[cfg(all(feature = "fold-profiling", not(target_arch = "wasm32")))]
        $crate::folding::fold_phase_mark($label);
    }};
}

pub use permutation::{
    ChainPermutationGenerator, FOLD_3D_ITERATION_BUDGET, PermutationError, PermutationSnapshot,
    SubFacePermutationSearch, SubFacePriority, SubFaceSearchError, SubFaceSwapper,
    WorkerOverlapEnumerator, WorkerOverlapSearch, WorkerOverlapSearchError,
    possible_overlap_search_for_ordered_subfaces, possible_overlap_search_for_subfaces,
    possible_overlap_search_for_subfaces_with_swap, prioritize_subfaces,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FoldedWireframe {
    pub points: Vec<Point>,
    pub lines: Vec<FoldedWireframeLine>,
    pub faces: Vec<Vec<usize>>,
    pub starting_face: usize,
    pub face_positions: Vec<usize>,
    pub next_faces: Vec<Option<usize>>,
    pub associated_lines: Vec<Option<usize>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FoldedSubfaceFigure {
    pub points: Vec<Point>,
    pub lines: Vec<FoldedWireframeLine>,
    pub faces: Vec<Vec<usize>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FoldedWireframeLine {
    pub begin: usize,
    pub end: usize,
    pub color: LineColor,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubFace {
    pub face_ids: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubFaceConfiguration {
    pub subfaces: Vec<SubFace>,
    pub reduced_subface_indices: Vec<usize>,
    pub face_id_count_max: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitialHierarchy {
    pub faces_total: usize,
    pub relations: Vec<HierarchyRelation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HierarchyRelation {
    pub upper_face: usize,
    pub lower_face: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InitialHierarchyError {
    SameParityAdjacentFaces {
        line: usize,
        first_face: usize,
        second_face: usize,
    },
    /// The user stopped the fold. Never a statement about the crease pattern —
    /// see [`crate::cancel`].
    Cancelled,
}

impl From<crate::cancel::Cancelled> for InitialHierarchyError {
    fn from(_: crate::cancel::Cancelled) -> Self {
        Self::Cancelled
    }
}

/// Why a fold could not be set up from a line set, before any layer ordering.
///
/// Both arms are refusals of the *topology*: either the dual graph of faces is
/// not connected, so no walk describes the whole figure, or two faces adjacent
/// across a crease came back on the same side of the paper.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FoldSetupError {
    FoldGraph(FoldGraphError),
    InitialHierarchy(InitialHierarchyError),
    /// The user stopped the fold during setup.
    ///
    /// Its own arm rather than being folded into the two above, because
    /// `setup_code` maps those to `"fold_disconnected"` and `"fold_same_parity"`
    /// — verdicts about the crease pattern that a cancel must never produce.
    Cancelled,
}

impl From<crate::cancel::Cancelled> for FoldSetupError {
    fn from(_: crate::cancel::Cancelled) -> Self {
        Self::Cancelled
    }
}

impl FoldSetupError {
    /// Whether this is the user stopping, at any depth.
    pub fn is_cancelled(&self) -> bool {
        matches!(
            self,
            Self::Cancelled
                | Self::FoldGraph(FoldGraphError::Cancelled)
                | Self::InitialHierarchy(InitialHierarchyError::Cancelled)
        )
    }
}

impl From<FoldGraphError> for FoldSetupError {
    fn from(error: FoldGraphError) -> Self {
        Self::FoldGraph(error)
    }
}

impl From<InitialHierarchyError> for FoldSetupError {
    fn from(error: InitialHierarchyError) -> Self {
        Self::InitialHierarchy(error)
    }
}

impl fmt::Display for FoldSetupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled | Self::InitialHierarchy(InitialHierarchyError::Cancelled) => {
                write!(f, "the fold was cancelled")
            }
            Self::FoldGraph(error) => error.fmt(f),
            Self::InitialHierarchy(InitialHierarchyError::SameParityAdjacentFaces {
                line,
                first_face,
                second_face,
            }) => write!(
                f,
                "faces {first_face} and {second_face} are adjacent across crease \
                 {line} but folded to the same parity"
            ),
        }
    }
}

impl std::error::Error for FoldSetupError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EquivalenceConditionSet {
    pub triple_conditions: Vec<EquivalenceCondition>,
    pub quadruple_conditions: Vec<EquivalenceCondition>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EquivalenceCondition {
    pub a: usize,
    pub b: usize,
    pub c: usize,
    pub d: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdditionalEstimation {
    pub hierarchy: InitialHierarchy,
    pub triple_conditions: Vec<EquivalenceCondition>,
    pub quadruple_conditions: Vec<EquivalenceCondition>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EstimationOrder {
    Order0,
    Order1,
    Order2,
    Order3,
    Order4,
    Order5,
    Order6,
    Order51,
}

impl EstimationOrder {
    pub fn from_oriedita_value(value: i32) -> Self {
        match value {
            1 => Self::Order1,
            2 => Self::Order2,
            3 => Self::Order3,
            4 => Self::Order4,
            5 => Self::Order5,
            6 => Self::Order6,
            51 => Self::Order51,
            _ => Self::Order0,
        }
    }

    fn normalized(self) -> Self {
        if self == Self::Order51 {
            Self::Order5
        } else {
            self
        }
    }

    fn value(self) -> i32 {
        match self.normalized() {
            Self::Order0 => 0,
            Self::Order1 => 1,
            Self::Order2 => 2,
            Self::Order3 => 3,
            Self::Order4 => 4,
            Self::Order5 => 5,
            Self::Order6 => 6,
            Self::Order51 => 5,
        }
    }

    fn is_at_least(self, other: Self) -> bool {
        self.value() >= other.value()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EstimationStep {
    Step0,
    Step1,
    Step2,
    Step3,
    Step4,
    Step5,
    Step10,
}

impl EstimationStep {
    fn value(self) -> i32 {
        match self {
            Self::Step0 => 0,
            Self::Step1 => 1,
            Self::Step2 => 2,
            Self::Step3 => 3,
            Self::Step4 => 4,
            Self::Step5 => 5,
            Self::Step10 => 10,
        }
    }

    fn is_at_least(self, other: Self) -> bool {
        self.value() >= other.value()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DisplayStyle {
    None0,
    Development1,
    Wire2,
    Transparent3,
    Development4,
    Paper5,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FoldedFigureState {
    Front0,
    Back1,
    Both2,
    Transparent3,
}

impl FoldedFigureState {
    fn draws_front(self) -> bool {
        matches!(self, Self::Front0 | Self::Both2 | Self::Transparent3)
    }

    fn draws_back(self) -> bool {
        matches!(self, Self::Back1 | Self::Both2 | Self::Transparent3)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FoldedFigureModel {
    pub front_color: RgbColor,
    pub back_color: RgbColor,
    pub line_color: RgbColor,
    pub scale: f64,
    pub rotation: f64,
    pub anti_alias: bool,
    pub display_shadows: bool,
    pub state: FoldedFigureState,
    pub folded_cases: usize,
    pub transparent_transparency: u8,
    pub transparency_color: bool,
}

impl Default for FoldedFigureModel {
    fn default() -> Self {
        Self {
            front_color: RgbColor::new(255, 255, 50),
            back_color: RgbColor::new(233, 233, 233),
            line_color: RgbColor::new(0, 0, 0),
            scale: 1.0,
            rotation: 0.0,
            anti_alias: true,
            display_shadows: false,
            state: FoldedFigureState::Front0,
            folded_cases: 1,
            transparent_transparency: 16,
            transparency_color: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FoldedFigureSnapshot {
    pub model: FoldedFigureModel,
    pub estimation_step: EstimationStep,
    pub display_style: DisplayStyle,
    pub discovered_fold_cases: usize,
    /// 1-based index of the solution being shown. Defaults to
    /// `discovered_fold_cases` when absent, which is what it meant before
    /// backwards navigation split the two.
    #[serde(default)]
    pub current_fold_case: usize,
    pub find_another_overlap_valid: bool,
    pub text_result: String,
    pub wireframe: Option<FoldedWireframe>,
    /// Present when the layer-ordering estimate hit an unresolvable
    /// contradiction; carries the two faces to highlight (Feature B).
    #[serde(default)]
    pub contradiction: Option<FoldContradiction>,
    /// Flat CP polygons of the two contradicting faces (present iff
    /// `contradiction` is), for the editor's red-fill overlay.
    #[serde(default)]
    pub contradiction_faces: Option<ContradictionFaceGeometry>,
    /// Why the estimate stopped where it did. `#[serde(default)]` so a figure
    /// saved before this field existed reads back as [`FoldOutcome::NotAttempted`]
    /// rather than failing to load.
    #[serde(default)]
    pub outcome: FoldOutcome,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrieditaFoldedFigureCameraSet {
    pub folded: OrieditaFoldedFigureCamera,
    pub front: OrieditaFoldedFigureCamera,
    pub rear: OrieditaFoldedFigureCamera,
    pub transparent_front: OrieditaFoldedFigureCamera,
    pub transparent_rear: OrieditaFoldedFigureCamera,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrieditaFoldedFigureCamera {
    pub camera_position: Point,
    pub angle_degrees: f64,
    pub mirror: f64,
    pub zoom_x: f64,
    pub zoom_y: f64,
    pub display_position: Point,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrieditaFoldedFigureCameraTarget {
    All,
    Folded,
    Front,
    Rear,
    TransparentFront,
    TransparentRear,
}

/// Which shadow-band geometry the paper renderer draws.
///
/// Oriedita's Java2D drawer derives the shadow's offset length from
/// `getBegin(lineId)` — the 1-based *point id* — used as an x-coordinate
/// (`FoldedFigure_Worker_Drawer.java`). The band width therefore comes out as
/// `SHADOW_OFFSET · edgeLength / unrelatedNumber` rather than the constant
/// `SHADOW_OFFSET` the surrounding code reads as intending, which makes a
/// figure's bands vary several-fold in width with no relation to the light.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FoldedShadowGeometry {
    /// Constant-width bands: the offset uses the edge's true length.
    #[default]
    Refined,
    /// The upstream arithmetic reproduced verbatim, for oracle parity.
    OrieditaExact,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct FoldedFigureRenderOptions {
    pub display_mark: bool,
    pub selected: bool,
    pub index: usize,
    pub display_numbers: bool,
    pub selected_flat_point_indices: Vec<usize>,
    pub selected_folded_point_indices: Vec<usize>,
    pub custom_constraints: Vec<OrieditaCustomConstraint>,
    pub shadow_geometry: FoldedShadowGeometry,
}

impl Default for FoldedFigureRenderOptions {
    fn default() -> Self {
        Self {
            display_mark: false,
            selected: false,
            index: 1,
            display_numbers: false,
            selected_flat_point_indices: Vec::new(),
            selected_folded_point_indices: Vec::new(),
            custom_constraints: Vec::new(),
            shadow_geometry: FoldedShadowGeometry::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrieditaCustomConstraint {
    pub face_order: OrieditaCustomConstraintFaceOrder,
    pub constraint_type: OrieditaCustomConstraintType,
    pub position: Point,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrieditaCustomConstraintFaceOrder {
    Normal,
    Flipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrieditaCustomConstraintType {
    ColorBack,
    ColorFront,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FoldedFigureRenderSnapshot {
    pub schema_version: u32,
    pub fixture: Option<String>,
    pub pass: Option<String>,
    pub primitives: Vec<FoldedFigureRenderPrimitive>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FoldedFigureRenderPrimitive {
    pub sequence: usize,
    pub kind: FoldedFigureRenderPrimitiveKind,
    pub style: FoldedFigureRenderStyle,
    pub geometry: FoldedFigureRenderGeometry,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FoldedFigureRenderPrimitiveKind {
    FillPath,
    StrokePath,
    StrokeSegment,
    FillPolygon,
    StrokePolygon,
    FillRect,
    StrokeRect,
    FillEllipse,
    StrokeEllipse,
    Text,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FoldedFigureRenderStyle {
    pub paint: FoldedFigureRenderPaint,
    pub stroke: FoldedFigureRenderStroke,
    pub antialias: FoldedFigureRenderAntialias,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FoldedFigureRenderPaint {
    None,
    Color {
        color: RgbaColor,
    },
    Gradient {
        from: Point,
        from_color: RgbaColor,
        to: Point,
        to_color: RgbaColor,
        cyclic: bool,
    },
    Texture,
    Other {
        class_name: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FoldedFigureRenderStroke {
    None,
    Basic {
        width: f64,
        end_cap: i32,
        line_join: i32,
        miter_limit: f64,
    },
    Other {
        class_name: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FoldedFigureRenderAntialias {
    On,
    Off,
    Default,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FoldedFigureRenderGeometry {
    Path {
        commands: Vec<RenderPathCommand>,
    },
    Segment {
        from: Point,
        to: Point,
    },
    Polygon {
        points: Vec<Point>,
    },
    Rect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    Ellipse {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    Text {
        value: String,
        position: Point,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum RenderPathCommand {
    MoveTo {
        point: Point,
    },
    LineTo {
        point: Point,
    },
    QuadTo {
        control: Point,
        point: Point,
    },
    CubicTo {
        control_1: Point,
        control_2: Point,
        point: Point,
    },
    Close,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RgbaColor {
    pub red: u8,
    pub green: u8,
    pub blue: u8,
    pub alpha: u8,
}

impl RgbaColor {
    pub const fn new(red: u8, green: u8, blue: u8, alpha: u8) -> Self {
        Self {
            red,
            green,
            blue,
            alpha,
        }
    }

    pub const fn from_rgb(color: RgbColor) -> Self {
        Self::new(color.red, color.green, color.blue, 255)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoldedFigureRenderParseError {
    pub line: usize,
    pub message: String,
}

impl fmt::Display for FoldedFigureRenderParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "invalid folded render primitive output at line {}: {}",
            self.line, self.message
        )
    }
}

impl std::error::Error for FoldedFigureRenderParseError {}

pub fn parse_oriedita_render_primitives(
    input: &str,
) -> Result<FoldedFigureRenderSnapshot, FoldedFigureRenderParseError> {
    let mut schema_version = None;
    let mut fixture = None;
    let mut pass = None;
    let mut primitives = Vec::new();

    for (index, line) in input.lines().enumerate() {
        let line_number = index + 1;
        if line.is_empty() {
            continue;
        }

        let fields = line.split('|').collect::<Vec<_>>();
        match fields.first().copied() {
            Some("schema") => {
                if fields.len() != 3 || fields[1] != "folded-render-primitives" {
                    return Err(render_parse_error(line_number, "unknown schema line"));
                }
                schema_version = Some(parse_u32(fields[2], line_number, "schema version")?);
            }
            Some("fixture") => {
                if fields.len() != 3 {
                    return Err(render_parse_error(
                        line_number,
                        "fixture line must have name and pass",
                    ));
                }
                fixture = Some(fields[1].to_string());
                pass = Some(fields[2].to_string());
            }
            Some("primitive") => {
                primitives.push(parse_render_primitive(&fields, line_number)?);
            }
            Some(other) => {
                return Err(render_parse_error(
                    line_number,
                    format!("unknown record type {other:?}"),
                ));
            }
            None => {}
        }
    }

    let schema_version = schema_version
        .ok_or_else(|| render_parse_error(1, "missing folded-render-primitives schema line"))?;

    Ok(FoldedFigureRenderSnapshot {
        schema_version,
        fixture,
        pass,
        primitives,
    })
}

fn parse_render_primitive(
    fields: &[&str],
    line: usize,
) -> Result<FoldedFigureRenderPrimitive, FoldedFigureRenderParseError> {
    if fields.len() < 7 {
        return Err(render_parse_error(line, "primitive record is too short"));
    }

    let sequence = parse_usize(fields[1], line, "primitive sequence")?;
    let kind = parse_render_kind(fields[2], line)?;
    let mut offset = 3;
    let (paint, next) = parse_render_paint(fields, offset, line)?;
    offset = next;
    let (stroke, next) = parse_render_stroke(fields, offset, line)?;
    offset = next;
    let antialias = parse_render_antialias(
        fields
            .get(offset)
            .copied()
            .ok_or_else(|| render_parse_error(line, "missing antialias field"))?,
        line,
    )?;
    offset += 1;
    let payload = fields
        .get(offset..)
        .ok_or_else(|| render_parse_error(line, "missing primitive payload"))?
        .join("|");
    let geometry = parse_render_geometry(kind, &payload, line)?;

    Ok(FoldedFigureRenderPrimitive {
        sequence,
        kind,
        style: FoldedFigureRenderStyle {
            paint,
            stroke,
            antialias,
        },
        geometry,
    })
}

fn parse_render_kind(
    value: &str,
    line: usize,
) -> Result<FoldedFigureRenderPrimitiveKind, FoldedFigureRenderParseError> {
    match value {
        "fill_path" => Ok(FoldedFigureRenderPrimitiveKind::FillPath),
        "stroke_path" => Ok(FoldedFigureRenderPrimitiveKind::StrokePath),
        "stroke_segment" => Ok(FoldedFigureRenderPrimitiveKind::StrokeSegment),
        "fill_polygon" => Ok(FoldedFigureRenderPrimitiveKind::FillPolygon),
        "stroke_polygon" => Ok(FoldedFigureRenderPrimitiveKind::StrokePolygon),
        "fill_rect" => Ok(FoldedFigureRenderPrimitiveKind::FillRect),
        "stroke_rect" => Ok(FoldedFigureRenderPrimitiveKind::StrokeRect),
        "fill_ellipse" => Ok(FoldedFigureRenderPrimitiveKind::FillEllipse),
        "stroke_ellipse" => Ok(FoldedFigureRenderPrimitiveKind::StrokeEllipse),
        "text" => Ok(FoldedFigureRenderPrimitiveKind::Text),
        _ => Err(render_parse_error(
            line,
            format!("unknown primitive kind {value:?}"),
        )),
    }
}

fn parse_render_paint(
    fields: &[&str],
    offset: usize,
    line: usize,
) -> Result<(FoldedFigureRenderPaint, usize), FoldedFigureRenderParseError> {
    match fields.get(offset).copied() {
        Some("none") => Ok((FoldedFigureRenderPaint::None, offset + 1)),
        Some("texture") => Ok((FoldedFigureRenderPaint::Texture, offset + 1)),
        Some("paint") => Ok((
            FoldedFigureRenderPaint::Other {
                class_name: field(fields, offset + 1, line, "paint class")?.to_string(),
            },
            offset + 2,
        )),
        Some("color") => Ok((
            FoldedFigureRenderPaint::Color {
                color: parse_rgba(fields, offset + 1, line)?,
            },
            offset + 5,
        )),
        Some("gradient") => Ok((
            FoldedFigureRenderPaint::Gradient {
                from: Point::new(
                    parse_f64(
                        field(fields, offset + 1, line, "gradient x1")?,
                        line,
                        "gradient x1",
                    )?,
                    parse_f64(
                        field(fields, offset + 2, line, "gradient y1")?,
                        line,
                        "gradient y1",
                    )?,
                ),
                from_color: parse_rgba(fields, offset + 3, line)?,
                to: Point::new(
                    parse_f64(
                        field(fields, offset + 7, line, "gradient x2")?,
                        line,
                        "gradient x2",
                    )?,
                    parse_f64(
                        field(fields, offset + 8, line, "gradient y2")?,
                        line,
                        "gradient y2",
                    )?,
                ),
                to_color: parse_rgba(fields, offset + 9, line)?,
                cyclic: parse_bool(field(fields, offset + 13, line, "gradient cyclic")?, line)?,
            },
            offset + 14,
        )),
        Some(value) => Err(render_parse_error(
            line,
            format!("unknown paint kind {value:?}"),
        )),
        None => Err(render_parse_error(line, "missing paint kind")),
    }
}

fn parse_render_stroke(
    fields: &[&str],
    offset: usize,
    line: usize,
) -> Result<(FoldedFigureRenderStroke, usize), FoldedFigureRenderParseError> {
    match fields.get(offset).copied() {
        Some("none") => Ok((FoldedFigureRenderStroke::None, offset + 1)),
        Some("stroke") => Ok((
            FoldedFigureRenderStroke::Other {
                class_name: field(fields, offset + 1, line, "stroke class")?.to_string(),
            },
            offset + 2,
        )),
        Some("basic") => Ok((
            FoldedFigureRenderStroke::Basic {
                width: parse_f64(
                    field(fields, offset + 1, line, "stroke width")?,
                    line,
                    "stroke width",
                )?,
                end_cap: parse_i32(
                    field(fields, offset + 2, line, "stroke cap")?,
                    line,
                    "stroke cap",
                )?,
                line_join: parse_i32(
                    field(fields, offset + 3, line, "stroke join")?,
                    line,
                    "stroke join",
                )?,
                miter_limit: parse_f64(
                    field(fields, offset + 4, line, "stroke miter")?,
                    line,
                    "stroke miter",
                )?,
            },
            offset + 5,
        )),
        Some(value) => Err(render_parse_error(
            line,
            format!("unknown stroke kind {value:?}"),
        )),
        None => Err(render_parse_error(line, "missing stroke kind")),
    }
}

fn parse_render_antialias(
    value: &str,
    line: usize,
) -> Result<FoldedFigureRenderAntialias, FoldedFigureRenderParseError> {
    match value {
        "aa_on" => Ok(FoldedFigureRenderAntialias::On),
        "aa_off" => Ok(FoldedFigureRenderAntialias::Off),
        "aa_default" => Ok(FoldedFigureRenderAntialias::Default),
        _ => Err(render_parse_error(
            line,
            format!("unknown antialias value {value:?}"),
        )),
    }
}

fn parse_render_geometry(
    kind: FoldedFigureRenderPrimitiveKind,
    payload: &str,
    line: usize,
) -> Result<FoldedFigureRenderGeometry, FoldedFigureRenderParseError> {
    match kind {
        FoldedFigureRenderPrimitiveKind::FillPath | FoldedFigureRenderPrimitiveKind::StrokePath => {
            Ok(FoldedFigureRenderGeometry::Path {
                commands: parse_path_commands(payload, line)?,
            })
        }
        FoldedFigureRenderPrimitiveKind::StrokeSegment => {
            let values = payload_fields(payload);
            Ok(FoldedFigureRenderGeometry::Segment {
                from: Point::new(
                    parse_payload_f64(&values, 0, line, "segment x1")?,
                    parse_payload_f64(&values, 1, line, "segment y1")?,
                ),
                to: Point::new(
                    parse_payload_f64(&values, 2, line, "segment x2")?,
                    parse_payload_f64(&values, 3, line, "segment y2")?,
                ),
            })
        }
        FoldedFigureRenderPrimitiveKind::FillPolygon
        | FoldedFigureRenderPrimitiveKind::StrokePolygon => {
            Ok(FoldedFigureRenderGeometry::Polygon {
                points: parse_polygon_points(payload, line)?,
            })
        }
        FoldedFigureRenderPrimitiveKind::FillRect | FoldedFigureRenderPrimitiveKind::StrokeRect => {
            let (x, y, width, height) = parse_rect(payload, line)?;
            Ok(FoldedFigureRenderGeometry::Rect {
                x,
                y,
                width,
                height,
            })
        }
        FoldedFigureRenderPrimitiveKind::FillEllipse
        | FoldedFigureRenderPrimitiveKind::StrokeEllipse => {
            let (x, y, width, height) = parse_rect(payload, line)?;
            Ok(FoldedFigureRenderGeometry::Ellipse {
                x,
                y,
                width,
                height,
            })
        }
        FoldedFigureRenderPrimitiveKind::Text => {
            let values = payload_fields(payload);
            Ok(FoldedFigureRenderGeometry::Text {
                value: unescape_text(
                    values
                        .first()
                        .ok_or_else(|| render_parse_error(line, "missing text value"))?,
                ),
                position: Point::new(
                    parse_payload_f64(&values, 1, line, "text x")?,
                    parse_payload_f64(&values, 2, line, "text y")?,
                ),
            })
        }
    }
}

fn parse_path_commands(
    payload: &str,
    line: usize,
) -> Result<Vec<RenderPathCommand>, FoldedFigureRenderParseError> {
    if payload.is_empty() {
        return Ok(Vec::new());
    }

    payload
        .split(';')
        .map(|command| {
            let fields = payload_fields(command);
            match fields.first().copied() {
                Some("M") => Ok(RenderPathCommand::MoveTo {
                    point: payload_point(&fields, 1, line, "move")?,
                }),
                Some("L") => Ok(RenderPathCommand::LineTo {
                    point: payload_point(&fields, 1, line, "line")?,
                }),
                Some("Q") => Ok(RenderPathCommand::QuadTo {
                    control: payload_point(&fields, 1, line, "quad control")?,
                    point: payload_point(&fields, 3, line, "quad point")?,
                }),
                Some("C") => Ok(RenderPathCommand::CubicTo {
                    control_1: payload_point(&fields, 1, line, "cubic control 1")?,
                    control_2: payload_point(&fields, 3, line, "cubic control 2")?,
                    point: payload_point(&fields, 5, line, "cubic point")?,
                }),
                Some("Z") => Ok(RenderPathCommand::Close),
                Some(value) => Err(render_parse_error(
                    line,
                    format!("unknown path command {value:?}"),
                )),
                None => Err(render_parse_error(line, "empty path command")),
            }
        })
        .collect()
}

fn parse_polygon_points(
    payload: &str,
    line: usize,
) -> Result<Vec<Point>, FoldedFigureRenderParseError> {
    if payload.is_empty() {
        return Ok(Vec::new());
    }

    payload
        .split(';')
        .map(|point| {
            let fields = payload_fields(point);
            payload_point(&fields, 0, line, "polygon point")
        })
        .collect()
}

fn parse_rect(
    payload: &str,
    line: usize,
) -> Result<(f64, f64, f64, f64), FoldedFigureRenderParseError> {
    let values = payload_fields(payload);
    Ok((
        parse_payload_f64(&values, 0, line, "rect x")?,
        parse_payload_f64(&values, 1, line, "rect y")?,
        parse_payload_f64(&values, 2, line, "rect width")?,
        parse_payload_f64(&values, 3, line, "rect height")?,
    ))
}

fn payload_fields(payload: &str) -> Vec<&str> {
    payload.split('|').collect()
}

fn payload_point(
    fields: &[&str],
    offset: usize,
    line: usize,
    label: &str,
) -> Result<Point, FoldedFigureRenderParseError> {
    Ok(Point::new(
        parse_payload_f64(fields, offset, line, label)?,
        parse_payload_f64(fields, offset + 1, line, label)?,
    ))
}

fn parse_payload_f64(
    fields: &[&str],
    offset: usize,
    line: usize,
    label: &str,
) -> Result<f64, FoldedFigureRenderParseError> {
    parse_f64(
        fields
            .get(offset)
            .copied()
            .ok_or_else(|| render_parse_error(line, format!("missing {label} field")))?,
        line,
        label,
    )
}

fn parse_rgba(
    fields: &[&str],
    offset: usize,
    line: usize,
) -> Result<RgbaColor, FoldedFigureRenderParseError> {
    Ok(RgbaColor::new(
        parse_u8(field(fields, offset, line, "red")?, line, "red")?,
        parse_u8(field(fields, offset + 1, line, "green")?, line, "green")?,
        parse_u8(field(fields, offset + 2, line, "blue")?, line, "blue")?,
        parse_u8(field(fields, offset + 3, line, "alpha")?, line, "alpha")?,
    ))
}

fn field<'a>(
    fields: &'a [&str],
    offset: usize,
    line: usize,
    label: &str,
) -> Result<&'a str, FoldedFigureRenderParseError> {
    fields
        .get(offset)
        .copied()
        .ok_or_else(|| render_parse_error(line, format!("missing {label} field")))
}

fn parse_usize(
    value: &str,
    line: usize,
    label: &str,
) -> Result<usize, FoldedFigureRenderParseError> {
    value
        .parse()
        .map_err(|_| render_parse_error(line, format!("invalid {label} {value:?}")))
}

fn parse_u32(value: &str, line: usize, label: &str) -> Result<u32, FoldedFigureRenderParseError> {
    value
        .parse()
        .map_err(|_| render_parse_error(line, format!("invalid {label} {value:?}")))
}

fn parse_u8(value: &str, line: usize, label: &str) -> Result<u8, FoldedFigureRenderParseError> {
    value
        .parse()
        .map_err(|_| render_parse_error(line, format!("invalid {label} {value:?}")))
}

fn parse_i32(value: &str, line: usize, label: &str) -> Result<i32, FoldedFigureRenderParseError> {
    value
        .parse()
        .map_err(|_| render_parse_error(line, format!("invalid {label} {value:?}")))
}

fn parse_f64(value: &str, line: usize, label: &str) -> Result<f64, FoldedFigureRenderParseError> {
    value
        .parse()
        .map_err(|_| render_parse_error(line, format!("invalid {label} {value:?}")))
}

fn parse_bool(value: &str, line: usize) -> Result<bool, FoldedFigureRenderParseError> {
    value
        .parse()
        .map_err(|_| render_parse_error(line, format!("invalid bool {value:?}")))
}

fn unescape_text(value: &str) -> String {
    let mut output = String::new();
    let mut escaped = false;
    for ch in value.chars() {
        if escaped {
            match ch {
                'n' => output.push('\n'),
                'r' => output.push('\r'),
                other => output.push(other),
            }
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else {
            output.push(ch);
        }
    }
    if escaped {
        output.push('\\');
    }
    output
}

fn render_parse_error(line: usize, message: impl Into<String>) -> FoldedFigureRenderParseError {
    FoldedFigureRenderParseError {
        line,
        message: message.into(),
    }
}

/// What the layer-ordering search concluded — which the stage alone cannot say.
///
/// `Step3` / `Transparent3` with no solutions is the resting place of three
/// different things: a caller who only asked for `Order3`, a search that ran to
/// exhaustion and found no valid ordering (`folding_estimated`'s zero-solutions
/// fallback), and a search that hit a contradiction
/// ([`FoldingEstimateSession::conclude_with_contradiction`] rewinds it there on
/// purpose, mirroring Oriedita). Upstream never needed to tell them apart
/// because it drives its own UI from inside the estimate; a snapshot that
/// crosses a wire does.
///
/// **Ori Studio native**, and purely additive: nothing reads it to decide
/// anything the fold does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum FoldOutcome {
    /// The layer search never ran — the request stopped below `Order4`, or an
    /// earlier stage declined to produce what it needs.
    #[default]
    NotAttempted,
    /// The search produced at least one valid layer ordering.
    Solved,
    /// The search ran and there is no valid layer ordering.
    NoSolutions,
    /// Inference found two faces that each have to lie above the other.
    Contradiction,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoldingEstimate {
    pub estimation_step: EstimationStep,
    pub display_style: DisplayStyle,
    /// How many layer-ordering solutions the enumeration has found so far.
    ///
    /// Upstream this doubles as "which solution is on screen", because the only
    /// way to move is forward. Navigating backwards (see
    /// [`FoldingEstimateSession::restart`]) makes the two different numbers, so
    /// the one being shown lives in [`Self::current_fold_case`].
    pub discovered_fold_cases: usize,
    /// 1-based index of the solution currently rendered, or 0 before any is
    /// found. Never exceeds [`Self::discovered_fold_cases`].
    pub current_fold_case: usize,
    pub find_another_overlap_valid: bool,
    pub text_result: String,
    pub overlap: Option<WorkerOverlapSearch>,
    /// Set when the layer-ordering estimate hit an unresolvable contradiction
    /// (Oriedita `AdditionalEstimationAlgorithm` → `CONTRADICTED_*` + `errorPos`).
    /// The fold does not error out; instead it concludes at the transparent
    /// development so the caller can render the crease pattern with the two
    /// offending faces highlighted, matching Oriedita's `drawSelfIntersectingSubFaces`.
    pub contradiction: Option<FoldContradiction>,
    /// Why the estimate stopped where it did. See [`FoldOutcome`].
    pub outcome: FoldOutcome,
}

/// The two faces the layer-ordering estimate could not consistently stack — the
/// port's analog of Oriedita's `InferenceFailureException(i, j)`. Both are
/// 0-based indices into the folded wireframe's `faces` list (`graph.faces`);
/// index directly, no offset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FoldContradiction {
    pub upper_face: usize,
    pub lower_face: usize,
}

/// Flat crease-pattern polygons (CP model coordinates) of the two contradicting
/// faces, so the editor can fill them red without needing the CP face
/// decomposition (which lives only in the Rust `FoldGraph`). Oriedita's
/// `drawSelfIntersectingSubFaces` fills the equivalent flat faces.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContradictionFaceGeometry {
    pub upper: Vec<Point>,
    pub lower: Vec<Point>,
}

/// Flat CP polygons for a contradiction's two faces. The flat wireframe shares
/// the folded wireframe's face topology (both come from the same `FoldGraph`
/// faces), so the 0-based `upper_face`/`lower_face` index it directly.
fn contradiction_flat_faces(
    segments: &[LineSegment],
    starting_face_id: i32,
    contradiction: FoldContradiction,
) -> Option<ContradictionFaceGeometry> {
    let wireframe = face_position_wireframe_from_segments(segments, starting_face_id).ok()??;
    let face_polygon = |index: usize| -> Option<Vec<Point>> {
        let loop_indices = wireframe.faces.get(index)?;
        Some(
            loop_indices
                .iter()
                .filter_map(|&point_index| wireframe.points.get(point_index).copied())
                .collect(),
        )
    };
    Some(ContradictionFaceGeometry {
        upper: face_polygon(contradiction.upper_face)?,
        lower: face_polygon(contradiction.lower_face)?,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoldingEstimateBatch {
    pub estimates: Vec<FoldingEstimate>,
    pub discovered_case_numbers: Vec<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FoldingEstimateError {
    Setup(FoldSetupError),
    WorkerOverlap(WorkerOverlapSearchError),
    /// The user stopped the fold.
    Cancelled,
}

impl From<crate::cancel::Cancelled> for FoldingEstimateError {
    fn from(_: crate::cancel::Cancelled) -> Self {
        Self::Cancelled
    }
}

impl FoldingEstimateError {
    /// Whether this is the user stopping, at **any** depth.
    ///
    /// Recursive on purpose, and it must be tested *before* any classification
    /// by cause: a checkpoint deep in the search unwinds through whichever
    /// domain enum its enclosing function returns, so a cancel arrives wrapped
    /// in `WorkerOverlap(AdditionalEstimation(Cancelled))` rather than as the
    /// top-level `Cancelled` arm. `From<FoldingEstimateError> for EngineError`
    /// (`session.rs`) has a wildcard that would otherwise read that as
    /// `"fold_contradiction"`.
    pub fn is_cancelled(&self) -> bool {
        match self {
            Self::Cancelled => true,
            Self::Setup(setup) => setup.is_cancelled(),
            Self::WorkerOverlap(worker) => worker.is_cancelled(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct FoldingEstimateSession {
    segments: Vec<LineSegment>,
    starting_face_id: i32,
    estimate: FoldingEstimate,
    worker: Option<WorkerOverlapEnumerator>,
}

impl From<FoldSetupError> for FoldingEstimateError {
    fn from(error: FoldSetupError) -> Self {
        Self::Setup(error)
    }
}

impl From<FoldGraphError> for FoldingEstimateError {
    fn from(error: FoldGraphError) -> Self {
        Self::Setup(FoldSetupError::FoldGraph(error))
    }
}

impl From<InitialHierarchyError> for FoldingEstimateError {
    fn from(error: InitialHierarchyError) -> Self {
        Self::Setup(FoldSetupError::InitialHierarchy(error))
    }
}

impl From<WorkerOverlapSearchError> for FoldingEstimateError {
    fn from(error: WorkerOverlapSearchError) -> Self {
        Self::WorkerOverlap(error)
    }
}

impl WorkerOverlapSearchError {
    /// The offending face pair when this error is a layer-ordering contradiction,
    /// otherwise `None` (structural errors stay fatal).
    pub fn contradiction(&self) -> Option<FoldContradiction> {
        match self {
            Self::AdditionalEstimation(AdditionalEstimationError::Contradiction {
                upper_face,
                lower_face,
            }) => Some(FoldContradiction {
                upper_face: *upper_face,
                lower_face: *lower_face,
            }),
            _ => None,
        }
    }
}

impl FoldingEstimateError {
    /// The offending face pair when this error is a layer-ordering contradiction,
    /// otherwise `None` (structural errors stay fatal).
    pub fn contradiction(&self) -> Option<FoldContradiction> {
        // A cancel is never a contradiction. Callers use this to decide whether
        // to *conclude* the figure with a highlighted face pair rather than
        // surface an error, so a wrong `Some` here would draw a fabricated
        // verdict for a fold the user stopped.
        if self.is_cancelled() {
            return None;
        }
        match self {
            Self::WorkerOverlap(error) => error.contradiction(),
            Self::Setup(_) | Self::Cancelled => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdditionalEstimationError {
    Setup(FoldSetupError),
    Contradiction {
        upper_face: usize,
        lower_face: usize,
    },
    /// The user stopped the fold inside additional estimation.
    ///
    /// This arm is the single most important one in the taxonomy. Without it a
    /// cancel here converts into `Contradiction` to satisfy `?`, and
    /// `From<FoldingEstimateError> for EngineError` reports
    /// `"fold_contradiction"` — telling a user who pressed Stop that their
    /// crease pattern cannot be folded.
    Cancelled,
}

impl From<crate::cancel::Cancelled> for AdditionalEstimationError {
    fn from(_: crate::cancel::Cancelled) -> Self {
        Self::Cancelled
    }
}

impl AdditionalEstimationError {
    /// Whether this is the user stopping, at any depth.
    pub fn is_cancelled(&self) -> bool {
        match self {
            Self::Cancelled => true,
            Self::Setup(setup) => setup.is_cancelled(),
            Self::Contradiction { .. } => false,
        }
    }
}

impl From<FoldSetupError> for AdditionalEstimationError {
    fn from(error: FoldSetupError) -> Self {
        Self::Setup(error)
    }
}

impl From<FoldGraphError> for AdditionalEstimationError {
    fn from(error: FoldGraphError) -> Self {
        Self::Setup(FoldSetupError::FoldGraph(error))
    }
}

impl From<InitialHierarchyError> for AdditionalEstimationError {
    fn from(error: InitialHierarchyError) -> Self {
        Self::Setup(FoldSetupError::InitialHierarchy(error))
    }
}

/// Oriedita `WireFrame_Worker.folding()`: fold the line-set topology around a
/// starting face without solving layer overlap.
pub fn estimate_wireframe(
    model: &CreasePatternModel,
    starting_face_id: i32,
) -> Result<Option<FoldedWireframe>, FoldGraphError> {
    if model.line_segments.is_empty() {
        return Ok(None);
    }

    estimate_wireframe_from_segments(&model.line_segments, starting_face_id)
}

pub fn estimate_wireframe_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<FoldedWireframe>, FoldGraphError> {
    if segments.is_empty() {
        return Ok(None);
    }

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return Ok(None);
    }

    let face_positions = graph.face_positions(starting_face_id)?;
    Ok(Some(wireframe_from_graph(
        &graph,
        &face_positions,
        graph.folded_points(&face_positions),
    )))
}

/// Oriedita `WireFrame_Worker.getFacePositions()`: compute face adjacency
/// depth without moving vertices. This is used by Oriedita's two-colored CP
/// path before later subface/hierarchy stages.
pub fn face_position_wireframe_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<FoldedWireframe>, FoldGraphError> {
    if segments.is_empty() {
        return Ok(None);
    }

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return Ok(None);
    }

    let face_positions = graph.face_positions(starting_face_id)?;
    Ok(Some(wireframe_from_graph(
        &graph,
        &face_positions,
        graph.points.clone(),
    )))
}

/// Oriedita `LineSegmentSetWorker.split_arrangement_for_SubFace_generation()`.
///
/// This is the folded-model preprocessing pass before subface generation:
/// remove point-like line segments, remove duplicate endpoint-identical
/// segments with Oriedita's `UNKNOWN_001` tolerance, divide all intersections,
/// and run the point/duplicate cleanup again.
/// Fallible only to carry a cancel out of [`divide_intersections`]; the
/// preparation itself cannot fail.
pub fn prepare_subface_segments(
    segments: &[LineSegment],
) -> Result<Vec<LineSegment>, crate::cancel::Cancelled> {
    let mut model = CreasePatternModel {
        line_segments: segments.to_vec(),
        ..CreasePatternModel::default()
    };
    remove_point_segments(&mut model.line_segments);
    remove_line_segment_set_duplicates(&mut model.line_segments);
    divide_intersections(&mut model)?;
    remove_point_segments(&mut model.line_segments);
    remove_line_segment_set_duplicates(&mut model.line_segments);
    Ok(model.line_segments)
}

pub fn folded_subface_figure_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<FoldedSubfaceFigure>, FoldGraphError> {
    if segments.is_empty() {
        return Ok(None);
    }

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return Ok(None);
    }

    let positions = graph.face_positions(starting_face_id)?;
    let folded = wireframe_from_graph(&graph, &positions, graph.folded_points(&positions));
    let folded_segments = folded_wireframe_segments(&folded);
    let prepared_segments = prepare_subface_segments(&folded_segments)?;
    let subface_graph = FoldGraph::from_segments(&prepared_segments, true);
    if subface_graph.faces.is_empty() {
        return Ok(None);
    }

    Ok(Some(FoldedSubfaceFigure {
        points: subface_graph.points,
        lines: subface_graph
            .lines
            .into_iter()
            .map(|line| FoldedWireframeLine {
                begin: line.begin,
                end: line.end,
                color: line.color,
            })
            .collect(),
        faces: subface_graph.faces,
    }))
}

/// Oriedita two-color CP preparation through
/// `FoldedFigure.folding_estimated_02col()` and stage 03. Unlike normal folding
/// estimation, this keeps the original development-view coordinates and uses
/// only face-position topology before generating the subdivided subface
/// arrangement.
pub fn two_colored_subface_segments_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<Vec<LineSegment>>, FoldGraphError> {
    let Some(wireframe) = face_position_wireframe_from_segments(segments, starting_face_id)? else {
        return Ok(None);
    };
    let wireframe_segments = folded_wireframe_segments(&wireframe);
    Ok(Some(prepare_subface_segments(&wireframe_segments)?))
}

/// Oriedita `FoldedFigure.createTwoColorCreasePattern(...)` without UI camera
/// and timing side-effects.
pub fn two_colored_folding_estimate_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<FoldingEstimate, FoldingEstimateError> {
    let mut estimate = FoldingEstimate {
        estimation_step: EstimationStep::Step0,
        display_style: DisplayStyle::None0,
        discovered_fold_cases: 0,
        current_fold_case: 0,
        find_another_overlap_valid: false,
        text_result: String::new(),
        overlap: None,
        contradiction: None,
        outcome: FoldOutcome::NotAttempted,
    };

    if segments.is_empty() {
        return Ok(estimate);
    }

    estimate.estimation_step = EstimationStep::Step1;
    estimate.display_style = DisplayStyle::Development1;
    if face_position_wireframe_from_segments(segments, starting_face_id)?.is_some() {
        estimate.estimation_step = EstimationStep::Step2;
        estimate.display_style = DisplayStyle::Wire2;
    }
    let mut worker = two_colored_overlap_enumerator_from_segments(segments, starting_face_id)?;
    if worker.is_some() {
        estimate.estimation_step = EstimationStep::Step3;
        estimate.display_style = DisplayStyle::Transparent3;
    }
    estimate.estimation_step = EstimationStep::Step4;
    estimate.display_style = DisplayStyle::Development4;
    estimate.find_another_overlap_valid = worker.is_some();
    run_folding_estimated_05(&mut estimate, worker.as_mut())?;
    estimate.estimation_step = EstimationStep::Step5;
    estimate.display_style = DisplayStyle::Paper5;
    estimate.estimation_step = EstimationStep::Step10;

    Ok(estimate)
}

/// Oriedita `FoldedFigure_Configurator.configureSubFaces()` for the folded
/// wireframe and its subdivided subface arrangement, without hierarchy solving.
pub fn configure_subfaces_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<SubFaceConfiguration>, FoldGraphError> {
    let Some(folded) = estimate_wireframe_from_segments(segments, starting_face_id)? else {
        return Ok(None);
    };
    let folded_segments = folded_wireframe_segments(&folded);
    let prepared_segments = prepare_subface_segments(&folded_segments)?;
    let subface_graph = FoldGraph::from_segments(&prepared_segments, true);
    if subface_graph.faces.is_empty() {
        return Ok(None);
    }

    Ok(Some(configure_subfaces(&folded, &subface_graph)?))
}

/// Oriedita `FoldedFigure_Configurator.setupHierarchyList()` initial
/// mountain/valley-derived face order table.
pub fn initial_hierarchy_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<InitialHierarchy>, FoldSetupError> {
    if segments.is_empty() {
        return Ok(None);
    }

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return Ok(None);
    }

    let positions = graph.face_positions(starting_face_id)?;
    Ok(Some(initial_hierarchy_from_graph(&graph, &positions)?))
}

/// Oriedita equivalence-condition discovery from
/// `FoldedFigure_Configurator.setupEquivalenceConditions()` and
/// `setupUEquivalenceConditions()`, before AEA inference consumes conditions.
pub fn equivalence_condition_candidates_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<EquivalenceConditionSet>, FoldSetupError> {
    if segments.is_empty() {
        return Ok(None);
    }

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return Ok(None);
    }

    let positions = graph.face_positions(starting_face_id)?;
    let hierarchy = initial_hierarchy_from_graph(&graph, &positions)?;
    let folded = wireframe_from_graph(&graph, &positions, graph.folded_points(&positions));
    let folded_segments = folded_wireframe_segments(&folded);
    let prepared_segments = prepare_subface_segments(&folded_segments)?;
    let subface_graph = FoldGraph::from_segments(&prepared_segments, true);
    let subfaces = if subface_graph.faces.is_empty() {
        SubFaceConfiguration {
            subfaces: Vec::new(),
            reduced_subface_indices: Vec::new(),
            face_id_count_max: 0,
        }
    } else {
        configure_subfaces(&folded, &subface_graph)?
    };

    let face_polygons = folded_face_polygons(&folded);
    let mut triple_conditions = Vec::new();
    for line_index in 0..graph.lines.len() {
        let Some((first_face, second_face)) = graph.line_face_border(line_index) else {
            continue;
        };
        if first_face == second_face {
            continue;
        }
        let Some(segment) = folded_segments.get(line_index) else {
            continue;
        };
        for (face_index, polygon) in face_polygons.iter().enumerate() {
            if face_index != first_face
                && face_index != second_face
                && polygon.convex_inside(segment)
            {
                let (above, below) = normalized_pair(&hierarchy, first_face, second_face);
                triple_conditions.push(EquivalenceCondition {
                    a: face_index,
                    b: above,
                    c: face_index,
                    d: below,
                });
            }
        }
    }

    let mut quadruple_conditions = Vec::new();
    for first_line in 0..graph.lines.len().saturating_sub(1) {
        let Some((first_a, first_b)) = graph.line_face_border(first_line) else {
            continue;
        };
        if first_a == first_b {
            continue;
        }
        let Some(first_segment) = folded_segments.get(first_line) else {
            continue;
        };
        for second_line in (first_line + 1)..graph.lines.len() {
            let Some((second_a, second_b)) = graph.line_face_border(second_line) else {
                continue;
            };
            if second_a == second_b {
                continue;
            }
            let Some(second_segment) = folded_segments.get(second_line) else {
                continue;
            };
            if determine_line_segment_intersection(first_segment, second_segment)
                .is_segment_overlapping()
                && subfaces_contain_all(&subfaces, [first_a, first_b, second_a, second_b])
            {
                let (a, b) = normalized_pair(&hierarchy, first_a, first_b);
                let (c, d) = normalized_pair(&hierarchy, second_a, second_b);
                quadruple_conditions.push(EquivalenceCondition { a, b, c, d });
            }
        }
    }

    Ok(Some(EquivalenceConditionSet {
        triple_conditions,
        quadruple_conditions,
    }))
}

/// Oriedita `AdditionalEstimationAlgorithm` fixed-point inference over the
/// reduced SubFace set and generated equivalence conditions.
pub fn additional_estimation_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<AdditionalEstimation>, AdditionalEstimationError> {
    if segments.is_empty() {
        return Ok(None);
    }

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return Ok(None);
    }

    let positions = graph.face_positions(starting_face_id)?;
    let initial = initial_hierarchy_from_graph(&graph, &positions)?;
    let folded = wireframe_from_graph(&graph, &positions, graph.folded_points(&positions));
    let folded_segments = folded_wireframe_segments(&folded);
    let prepared_segments = prepare_subface_segments(&folded_segments)?;
    let subface_graph = FoldGraph::from_segments(&prepared_segments, true);
    if subface_graph.faces.is_empty() {
        return Ok(Some(AdditionalEstimation {
            hierarchy: initial,
            triple_conditions: Vec::new(),
            quadruple_conditions: Vec::new(),
        }));
    }

    let subfaces = configure_subfaces(&folded, &subface_graph)?;
    let conditions = equivalence_condition_candidates_from_parts(&graph, &folded, &subfaces)?;
    let mut table = HierarchyTable::from_initial(&initial);
    run_additional_estimation(
        &mut table,
        &subfaces,
        &conditions.triple_conditions,
        &conditions.quadruple_conditions,
    )?;

    Ok(Some(AdditionalEstimation {
        hierarchy: table.into_initial_hierarchy(initial.faces_total),
        triple_conditions: conditions.triple_conditions,
        quadruple_conditions: conditions.quadruple_conditions,
    }))
}

impl FoldingEstimateSession {
    pub fn new(segments: &[LineSegment], starting_face_id: i32) -> Self {
        Self {
            segments: segments.to_vec(),
            starting_face_id,
            estimate: FoldingEstimate {
                estimation_step: EstimationStep::Step0,
                display_style: DisplayStyle::None0,
                discovered_fold_cases: 0,
                current_fold_case: 0,
                find_another_overlap_valid: false,
                text_result: String::new(),
                overlap: None,
                contradiction: None,
                outcome: FoldOutcome::NotAttempted,
            },
            worker: None,
        }
    }

    pub fn estimate(&self) -> &FoldingEstimate {
        &self.estimate
    }

    /// Oriedita `FoldedFigure.folding_estimated(...)` on a reusable folded
    /// figure. Repeated calls preserve the worker permutation state required by
    /// `ORDER_6` and `foldAnother`.
    /// Run the estimate to `order`, rolling back if the user cancels.
    ///
    /// The public entry point is the transaction boundary; the recursive and
    /// looping paths call [`Self::folding_estimated_inner`] so a nested call can
    /// never take a second snapshot.
    pub fn folding_estimated(
        &mut self,
        order: EstimationOrder,
    ) -> Result<FoldingEstimate, FoldingEstimateError> {
        self.transactional(|session| session.folding_estimated_inner(order))
    }

    /// Snapshot the mutable state, run `f`, and restore it if `f` was cancelled.
    ///
    /// > **Invariant.** A cancelled fold leaves the session exactly as it was
    /// > before the call — no partial solution, no advanced enumerator, no stale
    /// > case counter.
    ///
    /// Three commit sequences in the search tear badly and all three fail
    /// silently: `valid_count += 1` before `set_guide_map` leaves a subface
    /// counted valid whose generator was never initialised; `set_guide_map`
    /// clears its conditions before refilling them; and
    /// `discovered_fold_cases += 1` lands before `estimate.overlap` is replaced.
    /// Upstream survives all three only by throwing the whole figure away
    /// (`FoldingEstimateTask.java:44-49`). Rolling back is strictly better for
    /// the user — a cancelled *find another* keeps the solution already on
    /// screen, which upstream structurally cannot do — and cheaper to reason
    /// about than making each sequence atomic.
    fn transactional<T>(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<T, FoldingEstimateError>,
    ) -> Result<T, FoldingEstimateError> {
        // No binding means no cancel can arrive, so no caller pays for the
        // snapshot: every oracle test, the CLI, a browser without cross-origin
        // isolation (no transport, so nothing to bind), and every background
        // fold — the 3D rehydrate and the export-dialog fold pass
        // `FOLD_RUN_NONE` rather than `RunId::BACKGROUND` for exactly this
        // reason. Nothing can stop them either way, and binding them would pay
        // the snapshot per replay step on the platform with the recorded
        // large-CP OOM.
        if crate::cancel::current().is_none() {
            return f(self);
        }
        let estimate = self.estimate.clone();
        let worker = self.worker.as_ref().map(|worker| worker.snapshot_mutable());
        let outcome = f(self);
        if matches!(&outcome, Err(error) if error.is_cancelled()) {
            self.estimate = estimate;
            if let (Some(worker), Some(restore)) = (self.worker.as_mut(), worker) {
                worker.restore_mutable(restore);
            }
        }
        outcome
    }

    fn folding_estimated_inner(
        &mut self,
        order: EstimationOrder,
    ) -> Result<FoldingEstimate, FoldingEstimateError> {
        let order = order.normalized();
        if self.segments.is_empty() {
            return Ok(self.estimate.clone());
        }

        if self.estimate.estimation_step == EstimationStep::Step0
            && order.is_at_least(EstimationOrder::Order1)
        {
            self.estimate.estimation_step = EstimationStep::Step1;
            self.estimate.display_style = DisplayStyle::Development1;
        }
        if self.estimate.estimation_step == EstimationStep::Step1
            && order.is_at_least(EstimationOrder::Order2)
            && estimate_wireframe_from_segments(&self.segments, self.starting_face_id)?.is_some()
        {
            self.estimate.estimation_step = EstimationStep::Step2;
            self.estimate.display_style = DisplayStyle::Wire2;
        }
        if self.estimate.estimation_step == EstimationStep::Step2
            && order.is_at_least(EstimationOrder::Order3)
            && configure_subfaces_from_segments(&self.segments, self.starting_face_id)?.is_some()
        {
            self.estimate.estimation_step = EstimationStep::Step3;
            self.estimate.display_style = DisplayStyle::Transparent3;
        }
        if self.estimate.estimation_step == EstimationStep::Step3
            && order.is_at_least(EstimationOrder::Order4)
        {
            match overlap_enumerator_from_segments(&self.segments, self.starting_face_id) {
                Ok(worker) => {
                    self.worker = worker;
                    self.estimate.estimation_step = EstimationStep::Step4;
                    self.estimate.display_style = DisplayStyle::Development4;
                    self.estimate.find_another_overlap_valid = self.worker.is_some();
                    self.estimate.discovered_fold_cases = 0;
                    self.estimate.current_fold_case = 0;
                }
                Err(error) => {
                    if let Some(contradiction) = error.contradiction() {
                        return Ok(self.conclude_with_contradiction(contradiction));
                    }
                    return Err(error.into());
                }
            }
        }
        if self.estimate.estimation_step == EstimationStep::Step4
            && order.is_at_least(EstimationOrder::Order5)
        {
            if let Err(error) = self.folding_estimated_05() {
                if let Some(contradiction) = error.contradiction() {
                    return Ok(self.conclude_with_contradiction(contradiction));
                }
                return Err(error.into());
            }
            self.estimate.estimation_step = EstimationStep::Step5;
            self.estimate.display_style = DisplayStyle::Paper5;
            self.estimate.outcome = FoldOutcome::Solved;
            if self.estimate.discovered_fold_cases == 0 && !self.estimate.find_another_overlap_valid
            {
                // Upstream's own fallback: no valid layer ordering exists, so
                // rewind to the transparent development rather than draw a paper
                // view with nothing behind it. That lands on the same stage a
                // contradiction lands on, and on the same stage an `Order3`
                // request stops at, which is why `outcome` exists.
                self.estimate.estimation_step = EstimationStep::Step3;
                self.estimate.display_style = DisplayStyle::Transparent3;
                self.estimate.outcome = FoldOutcome::NoSolutions;
            }
        }
        if self.estimate.estimation_step == EstimationStep::Step5
            && order == EstimationOrder::Order6
        {
            if let Err(error) = self.folding_estimated_05() {
                if let Some(contradiction) = error.contradiction() {
                    return Ok(self.conclude_with_contradiction(contradiction));
                }
                return Err(error.into());
            }
            self.estimate.display_style = DisplayStyle::Paper5;
        }

        Ok(self.estimate.clone())
    }

    /// Oriedita catches `InferenceFailureException` inside
    /// `AdditionalEstimationAlgorithm.run` and keeps the figure renderable rather
    /// than aborting. We mirror that: record the offending face pair and fall back
    /// to the transparent development (as the existing "no solutions" path already
    /// does), so the caller renders the crease pattern with the two faces
    /// highlighted instead of surfacing a raw error.
    fn conclude_with_contradiction(&mut self, contradiction: FoldContradiction) -> FoldingEstimate {
        self.estimate.contradiction = Some(contradiction);
        self.estimate.estimation_step = EstimationStep::Step3;
        self.estimate.display_style = DisplayStyle::Transparent3;
        self.estimate.discovered_fold_cases = 0;
        self.estimate.current_fold_case = 0;
        self.estimate.find_another_overlap_valid = false;
        self.estimate.overlap = None;
        self.estimate.outcome = FoldOutcome::Contradiction;
        self.estimate.clone()
    }

    fn folding_estimated_05(&mut self) -> Result<(), WorkerOverlapSearchError> {
        run_folding_estimated_05(&mut self.estimate, self.worker.as_mut())
    }

    /// Rewind the enumeration and run back to the first solution.
    ///
    /// The overlap enumerator is a forward-only stream — `possible_overlapping_search`
    /// advances search state and nothing retains a solution once it has moved
    /// past — so this is what makes an earlier case reachable at all. Because the
    /// enumeration is deterministic, replaying it from the start yields exactly
    /// the same solutions in the same order, which is what lets
    /// [`folding_estimate_to_case`] seek backwards by restarting and stepping
    /// forward again.
    ///
    /// Self-contained: the session already owns the segments and starting face,
    /// so the caller supplies nothing and a figure with no other provenance can
    /// still be navigated.
    ///
    /// **Not in Oriedita.** Upstream can only move forward
    /// (`FoldingServiceImpl.fold` re-folds or discards); this is an additive
    /// capability that leaves the search algorithm and its solution order
    /// untouched. See PORTING.md.
    pub fn restart(&mut self) -> Result<FoldingEstimate, FoldingEstimateError> {
        self.transactional(Self::restart_inner)
    }

    fn restart_inner(&mut self) -> Result<FoldingEstimate, FoldingEstimateError> {
        // Moved out, not dropped. [`Self::transactional`]'s snapshot is narrow —
        // it restores the *mutable* fields of whatever worker is present — and
        // it cannot put back a worker that was replaced wholesale. Every setup
        // checkpoint fires before Step 4 reassigns `self.worker`, so a cancelled
        // restart used to land with `worker: None` under a restored estimate
        // whose `find_another_overlap_valid` was still true: `find another
        // solution` then silently did nothing, for the rest of the session,
        // while the UI kept offering it. A move costs nothing, so this is
        // unconditional rather than gated on a binding.
        let previous_worker = self.worker.take();
        self.estimate = FoldingEstimate {
            estimation_step: EstimationStep::Step0,
            display_style: DisplayStyle::None0,
            discovered_fold_cases: 0,
            current_fold_case: 0,
            find_another_overlap_valid: false,
            text_result: String::new(),
            overlap: None,
            contradiction: None,
            outcome: FoldOutcome::NotAttempted,
        };
        // `_inner`, not the public method: `restart` is already inside the
        // transaction its own caller opened.
        let outcome = self.folding_estimated_inner(EstimationOrder::Order5);
        if matches!(&outcome, Err(error) if error.is_cancelled()) {
            // The original worker, not the half-rebuilt one: the enclosing
            // transaction's snapshot was taken from *this* object, so restoring
            // it is what makes that snapshot apply to the thing it came from.
            self.worker = previous_worker;
        }
        outcome
    }
}

fn run_folding_estimated_05(
    estimate: &mut FoldingEstimate,
    worker: Option<&mut WorkerOverlapEnumerator>,
) -> Result<(), WorkerOverlapSearchError> {
    if matches!(
        estimate.estimation_step,
        EstimationStep::Step4 | EstimationStep::Step5
    ) && estimate.find_another_overlap_valid
        && let Some(worker) = worker
    {
        let overlap = worker.possible_overlapping_search(estimate.discovered_fold_cases == 0)?;
        if overlap.found {
            estimate.discovered_fold_cases += 1;
            // A forward step always lands on the newest solution, so the two
            // stay equal here; they diverge only after a restart replays into
            // the middle of an enumeration already known to be longer.
            estimate.current_fold_case = estimate.discovered_fold_cases;
        }
        let next_subface = worker.next(worker.valid_count())?;
        estimate.find_another_overlap_valid = overlap.found && next_subface > 0;
        estimate.overlap = Some(overlap);
    }

    estimate.text_result = format!(
        "Number of found solutions = {}  ",
        estimate.discovered_fold_cases
    );
    if !estimate.find_another_overlap_valid {
        estimate
            .text_result
            .push_str(" There is no other solution. ");
    }
    Ok(())
}

/// Step to the next layer-ordering solution, wrapping to the first once the
/// enumeration is exhausted.
///
/// The wrap is a [`FoldingEstimateSession::restart`], which costs a re-fold
/// rather than a single search — acceptable for something that happens once per
/// lap, and it keeps the session free of any retained per-solution state.
///
/// **Wrapping is not in Oriedita**, where the action simply stops at the last
/// solution.
pub fn fold_another(
    session: &mut FoldingEstimateSession,
) -> Result<FoldingEstimate, FoldingEstimateError> {
    // Only wrap when there is somewhere else to land: with a single solution a
    // restart would re-fold to exactly where we already are.
    if !session.estimate.find_another_overlap_valid && session.estimate.discovered_fold_cases > 1 {
        return session.restart();
    }
    session.folding_estimated(EstimationOrder::Order6)
}

/// Oriedita `FoldingEstimateSpecificTask` without UI timing/dirty-state
/// side-effects: run a reusable folded figure until the requested case is
/// reached or no later overlap exists.
///
/// Extends upstream with **backwards** seeking: an objective behind the current
/// case restarts the enumeration and replays forward to it. Upstream can only
/// count up, so asking for an earlier case there does nothing at all.
pub fn folding_estimate_to_case(
    session: &mut FoldingEstimateSession,
    objective: usize,
    initial_order: EstimationOrder,
) -> Result<FoldingEstimateBatch, FoldingEstimateError> {
    // A *loop* of searches, so the transaction has to wrap the whole seek. Roll
    // back to before the first step, not to whichever step the cancel landed on
    // — a half-completed seek is exactly the "solution N labelled N+1" tear.
    session
        .transactional(|session| folding_estimate_to_case_inner(session, objective, initial_order))
}

fn folding_estimate_to_case_inner(
    session: &mut FoldingEstimateSession,
    objective: usize,
    initial_order: EstimationOrder,
) -> Result<FoldingEstimateBatch, FoldingEstimateError> {
    if objective == session.estimate.current_fold_case {
        session.estimate.text_result = format!(
            "Number of found solutions = {}  ",
            session.estimate.discovered_fold_cases
        );
    }

    let mut estimates = Vec::new();
    let mut discovered_case_numbers = Vec::new();
    let mut order = initial_order;

    // Behind the current case: rewind and replay. The enumeration is
    // deterministic, so the objective's solution is byte-identical to the one it
    // produced on the way out.
    if objective < session.estimate.current_fold_case && objective >= 1 {
        let restarted = session.restart_inner()?;
        discovered_case_numbers.push(restarted.discovered_fold_cases);
        let can_continue = restarted.find_another_overlap_valid;
        estimates.push(restarted);
        order = EstimationOrder::Order6;
        if !can_continue {
            return Ok(FoldingEstimateBatch {
                estimates,
                discovered_case_numbers,
            });
        }
    }

    while objective > session.estimate.current_fold_case {
        let estimate = session.folding_estimated_inner(order)?;
        discovered_case_numbers.push(estimate.discovered_fold_cases);
        let can_continue = estimate.find_another_overlap_valid;
        estimates.push(estimate);
        order = EstimationOrder::Order6;
        if !can_continue {
            break;
        }
    }

    Ok(FoldingEstimateBatch {
        estimates,
        discovered_case_numbers,
    })
}

/// Oriedita `FoldingEstimateSave100Task` enumeration loop without selecting an
/// export file or writing images. Each returned case number corresponds to the
/// suffix Oriedita would use for that image write.
pub fn folding_estimate_save_batch(
    session: &mut FoldingEstimateSession,
    limit: usize,
) -> Result<FoldingEstimateBatch, FoldingEstimateError> {
    let mut estimates = Vec::new();
    let mut discovered_case_numbers = Vec::new();
    let mut objective = limit;
    let mut index = 1usize;
    while index <= objective {
        let estimate = session.folding_estimated_inner(EstimationOrder::Order6)?;
        discovered_case_numbers.push(estimate.discovered_fold_cases);
        if !estimate.find_another_overlap_valid {
            objective = estimate.discovered_fold_cases;
        }
        estimates.push(estimate);
        index += 1;
    }

    Ok(FoldingEstimateBatch {
        estimates,
        discovered_case_numbers,
    })
}

/// Oriedita `FoldingEstimateSave100Task` filename rule: if the selected path
/// string contains a dot, insert `_<case>` before the final extension.
pub fn folding_estimate_case_filename(filename: &str, discovered_case: usize) -> String {
    if let Some(index) = filename.rfind('.') {
        format!(
            "{}_{}{}",
            &filename[..index],
            discovered_case,
            &filename[index..]
        )
    } else {
        filename.to_string()
    }
}

/// Oriedita `FoldingServiceImpl.duplicate` replay-order mapping for a duplicated
/// folded figure, without folded-list creation or task dispatch.
pub fn duplicate_estimation_order_for_display(display_style: DisplayStyle) -> EstimationOrder {
    match display_style {
        DisplayStyle::None0 => EstimationOrder::Order0,
        DisplayStyle::Development1 => EstimationOrder::Order1,
        DisplayStyle::Wire2 => EstimationOrder::Order2,
        DisplayStyle::Transparent3 => EstimationOrder::Order3,
        DisplayStyle::Development4 => EstimationOrder::Order4,
        DisplayStyle::Paper5 => EstimationOrder::Order5,
    }
}

/// Oriedita `FoldedFigure.folding_estimated(...)` stage summary from a fresh
/// folded figure. For `ORDER_6`, this follows Oriedita and asks the same worker
/// for the next overlap after the initial order-5 solution.
pub fn folding_estimate_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
    order: EstimationOrder,
) -> Result<FoldingEstimate, FoldingEstimateError> {
    let mut session = FoldingEstimateSession::new(segments, starting_face_id);
    session.folding_estimated(order)
}

pub fn folded_figure_snapshot_from_session(
    session: &FoldingEstimateSession,
    model: FoldedFigureModel,
) -> FoldedFigureSnapshot {
    let estimate = session.estimate();
    // The session only reaches Step2 by walking this graph successfully, so the
    // walk cannot newly fail here; a disconnected graph was already refused.
    let wireframe = if estimate.estimation_step.is_at_least(EstimationStep::Step2) {
        estimate_wireframe_from_segments(&session.segments, session.starting_face_id)
            .ok()
            .flatten()
    } else {
        None
    };
    let contradiction_faces = estimate.contradiction.and_then(|contradiction| {
        contradiction_flat_faces(&session.segments, session.starting_face_id, contradiction)
    });
    FoldedFigureSnapshot {
        model,
        estimation_step: estimate.estimation_step,
        display_style: estimate.display_style,
        discovered_fold_cases: estimate.discovered_fold_cases,
        current_fold_case: estimate.current_fold_case,
        find_another_overlap_valid: estimate.find_another_overlap_valid,
        text_result: estimate.text_result.clone(),
        wireframe,
        contradiction: estimate.contradiction,
        contradiction_faces,
        outcome: estimate.outcome,
    }
}

pub fn folded_figure_render_snapshot_from_session(
    session: &FoldingEstimateSession,
    display_style: DisplayStyle,
    model: FoldedFigureModel,
    options: FoldedFigureRenderOptions,
) -> Result<Option<FoldedFigureRenderSnapshot>, FoldingEstimateError> {
    // Reuse the layer ordering the session already solved rather than re-running
    // the whole fold estimation inside the renderer.
    let precomputed_hierarchy = session
        .estimate()
        .overlap
        .as_ref()
        .filter(|overlap| overlap.found)
        .map(|overlap| &overlap.hierarchy);
    render_snapshot_impl(
        &session.segments,
        session.starting_face_id,
        display_style,
        model,
        options,
        precomputed_hierarchy,
    )
}

pub fn folded_figure_snapshot_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
    order: EstimationOrder,
    model: FoldedFigureModel,
) -> Result<FoldedFigureSnapshot, FoldingEstimateError> {
    let mut session = FoldingEstimateSession::new(segments, starting_face_id);
    session.folding_estimated(order)?;
    Ok(folded_figure_snapshot_from_session(&session, model))
}

pub fn folded_figure_paper_front_render_snapshot_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
    model: FoldedFigureModel,
) -> Result<Option<FoldedFigureRenderSnapshot>, FoldingEstimateError> {
    let mut model = model;
    model.state = FoldedFigureState::Front0;
    folded_figure_paper_render_snapshot_from_segments(segments, starting_face_id, model)
}

/// Paper-style render of a fold, in a single pass, for oracle comparison.
///
/// Shadows use [`FoldedShadowGeometry::OrieditaExact`]: this entry point exists
/// to be diffed against the Oriedita render oracle, so it has to reproduce
/// upstream's shadow-width quirk rather than the product's corrected geometry.
/// The renderer the app drives is `folded_figure_render_snapshot_from_segments`,
/// which takes [`FoldedFigureRenderOptions`] and defaults to `Refined`.
pub fn folded_figure_paper_render_snapshot_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
    model: FoldedFigureModel,
) -> Result<Option<FoldedFigureRenderSnapshot>, FoldingEstimateError> {
    let Some((graph, folded)) =
        folded_graph_and_wireframe_from_segments(segments, starting_face_id)?
    else {
        return Ok(None);
    };
    let Some((subface_graph, subfaces)) = folded_subface_graph_and_config(&folded)? else {
        return Ok(None);
    };

    let Some(mut enumerator) = overlap_enumerator_from_segments(segments, starting_face_id)? else {
        return Ok(None);
    };
    let overlap = enumerator.possible_overlapping_search(true)?;
    if !overlap.found {
        return Ok(None);
    }
    let Some(pass_name) = paper_render_pass_name(model.state, model.display_shadows) else {
        return Ok(None);
    };

    Ok(Some(FoldedFigureRenderSnapshot {
        schema_version: 1,
        fixture: None,
        pass: Some(pass_name.to_string()),
        primitives: paper_render_primitives(
            &graph,
            &folded,
            &subface_graph,
            &subfaces,
            &overlap.hierarchy,
            &model,
            &[],
            FoldedShadowGeometry::OrieditaExact,
        ),
    }))
}

pub fn folded_figure_wire_render_snapshot_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
    model: FoldedFigureModel,
) -> Result<Option<FoldedFigureRenderSnapshot>, FoldingEstimateError> {
    let Some((graph, folded)) =
        folded_graph_and_wireframe_from_segments(segments, starting_face_id)?
    else {
        return Ok(None);
    };

    Ok(Some(FoldedFigureRenderSnapshot {
        schema_version: 1,
        fixture: None,
        pass: Some(wire_render_pass_name(model.state).to_string()),
        primitives: wire_render_primitives(&graph, &folded, &model),
    }))
}

pub fn folded_figure_transparent_render_snapshot_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
    model: FoldedFigureModel,
) -> Result<Option<FoldedFigureRenderSnapshot>, FoldingEstimateError> {
    let Some((graph, folded)) =
        folded_graph_and_wireframe_from_segments(segments, starting_face_id)?
    else {
        return Ok(None);
    };
    let Some((subface_graph, subfaces)) = folded_subface_graph_and_config(&folded)? else {
        return Ok(None);
    };

    Ok(Some(FoldedFigureRenderSnapshot {
        schema_version: 1,
        fixture: None,
        pass: Some(transparent_render_pass_name(model.state, model.transparency_color).to_string()),
        primitives: transparent_render_primitives(
            &graph,
            &folded,
            &subface_graph,
            &subfaces,
            &model,
            &[],
        ),
    }))
}

pub fn folded_figure_render_snapshot_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
    display_style: DisplayStyle,
    model: FoldedFigureModel,
    options: FoldedFigureRenderOptions,
) -> Result<Option<FoldedFigureRenderSnapshot>, FoldingEstimateError> {
    render_snapshot_impl(
        segments,
        starting_face_id,
        display_style,
        model,
        options,
        None,
    )
}

/// Shared render-snapshot builder. `precomputed_hierarchy`, when supplied, is the
/// solved layer ordering from the owning session — reusing it avoids re-running
/// the entire (expensive) fold estimation just to draw the solid `Paper5` view.
fn render_snapshot_impl(
    segments: &[LineSegment],
    starting_face_id: i32,
    display_style: DisplayStyle,
    model: FoldedFigureModel,
    options: FoldedFigureRenderOptions,
    precomputed_hierarchy: Option<&InitialHierarchy>,
) -> Result<Option<FoldedFigureRenderSnapshot>, FoldingEstimateError> {
    let Some((graph, folded)) =
        folded_graph_and_wireframe_from_segments(segments, starting_face_id)?
    else {
        return Ok(None);
    };

    let needs_subfaces = matches!(
        display_style,
        DisplayStyle::Transparent3 | DisplayStyle::Paper5
    );
    let subface_data = if needs_subfaces {
        let Some(data) = folded_subface_graph_and_config(&folded)? else {
            return Ok(None);
        };
        Some(data)
    } else {
        None
    };

    let hierarchy = if display_style == DisplayStyle::Paper5 {
        if let Some(precomputed) = precomputed_hierarchy {
            Some(HierarchyTable::from_initial(precomputed))
        } else {
            let Some(mut enumerator) =
                overlap_enumerator_from_segments(segments, starting_face_id)?
            else {
                return Ok(None);
            };
            let overlap = enumerator.possible_overlapping_search(true)?;
            if !overlap.found {
                return Ok(None);
            }
            Some(HierarchyTable::from_initial(&overlap.hierarchy))
        }
    } else {
        None
    };

    let mut primitives = Vec::new();
    let mut render_state = OrieditaRenderState::default();
    let (front, rear) = folded_front_rear_passes(&model, &graph.points, &folded.points);
    let transparent_front = OrieditaPaperRenderPass {
        camera: OrieditaRenderCamera::transparent_front(&model).fix_to_flat_bounds(
            &graph.points,
            &folded.points,
            Point::new(20.0, 0.0),
        ),
        flipped: false,
    };
    let transparent_rear = OrieditaPaperRenderPass {
        camera: OrieditaRenderCamera::transparent_rear(&model).fix_to_flat_bounds(
            &graph.points,
            &folded.points,
            Point::new(40.0, 0.0),
        ),
        flipped: true,
    };

    if display_style == DisplayStyle::Wire2 {
        match model.state {
            FoldedFigureState::Front0 => {
                push_wire_render_pass_primitives(&folded, front, &mut primitives)
            }
            FoldedFigureState::Back1 => {
                push_wire_render_pass_primitives(&folded, rear, &mut primitives)
            }
            FoldedFigureState::Both2 | FoldedFigureState::Transparent3 => {
                push_wire_render_interleaved_primitives(&folded, front, rear, &mut primitives);
            }
        }
    }

    if model.state.draws_front() {
        push_folded_display_style_pass_primitives(
            display_style,
            &folded,
            subface_data.as_ref(),
            hierarchy.as_ref(),
            &model,
            &options.custom_constraints,
            front,
            options.shadow_geometry,
            &mut render_state,
            &mut primitives,
        );
        if options.display_mark {
            push_cross_with_camera_primitives(
                front.camera,
                options.selected,
                options.index,
                options.display_numbers,
                &render_state,
                &mut primitives,
            );
        }
    }

    if model.state.draws_back() {
        push_folded_display_style_pass_primitives(
            display_style,
            &folded,
            subface_data.as_ref(),
            hierarchy.as_ref(),
            &model,
            &options.custom_constraints,
            rear,
            options.shadow_geometry,
            &mut render_state,
            &mut primitives,
        );
        if options.display_mark {
            push_cross_with_camera_primitives(
                rear.camera,
                options.selected,
                options.index,
                options.display_numbers,
                &render_state,
                &mut primitives,
            );
        }
    }

    if model.state == FoldedFigureState::Transparent3 && display_style == DisplayStyle::Paper5 {
        push_folded_transparency_pass_primitives(
            &folded,
            subface_data.as_ref(),
            &model,
            &options.custom_constraints,
            transparent_front,
            &mut render_state,
            &mut primitives,
        );
        if options.display_mark {
            push_cross_with_camera_primitives(
                transparent_front.camera,
                options.selected,
                options.index,
                options.display_numbers,
                &render_state,
                &mut primitives,
            );
        }

        push_folded_transparency_pass_primitives(
            &folded,
            subface_data.as_ref(),
            &model,
            &options.custom_constraints,
            transparent_rear,
            &mut render_state,
            &mut primitives,
        );
        if options.display_mark {
            push_cross_with_camera_primitives(
                transparent_rear.camera,
                options.selected,
                options.index,
                options.display_numbers,
                &render_state,
                &mut primitives,
            );
        }
    }

    push_selected_point_primitives(
        &graph,
        &folded,
        model.state,
        front,
        rear,
        &options,
        &render_state,
        &mut primitives,
    );

    Ok(Some(FoldedFigureRenderSnapshot {
        schema_version: 1,
        fixture: None,
        pass: Some(full_render_pass_name(
            display_style,
            model.state,
            model.transparency_color,
        )),
        primitives,
    }))
}

pub fn folded_figure_camera_set_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
    model: FoldedFigureModel,
) -> Option<OrieditaFoldedFigureCameraSet> {
    let (graph, folded) =
        folded_graph_and_wireframe_from_segments(segments, starting_face_id).ok()??;
    Some(folded_figure_camera_set(
        &graph.points,
        &folded.points,
        &model,
    ))
}

pub fn folded_figure_camera_set_scaled(
    mut cameras: OrieditaFoldedFigureCameraSet,
    magnification: f64,
    anchor_tv: Option<Point>,
) -> OrieditaFoldedFigureCameraSet {
    if let Some(anchor) = anchor_tv {
        for camera in cameras.iter_mut() {
            camera.camera_position_specify_from_tv(anchor);
        }
    }
    for camera in cameras.iter_mut() {
        camera.zoom_x *= magnification;
        camera.zoom_y *= magnification;
    }
    cameras
}

pub fn folded_figure_camera_set_display_position_moved(
    mut cameras: OrieditaFoldedFigureCameraSet,
    target: OrieditaFoldedFigureCameraTarget,
    delta_tv: Point,
) -> OrieditaFoldedFigureCameraSet {
    for camera in cameras.iter_target_mut(target) {
        camera.display_position_move(delta_tv);
    }
    cameras
}

pub fn folded_figure_camera_set_position_specified_from_tv(
    mut cameras: OrieditaFoldedFigureCameraSet,
    target: OrieditaFoldedFigureCameraTarget,
    point_tv: Point,
) -> OrieditaFoldedFigureCameraSet {
    for camera in cameras.iter_target_mut(target) {
        camera.camera_position_specify_from_tv(point_tv);
    }
    cameras
}

/// Oriedita `FoldedFigure_Worker.possible_overlapping_search(false)` after
/// folding stages 01-04 have prepared subfaces, hierarchy relations, and
/// equivalence conditions. This is the no-swap/no-realtime-AEA worker search
/// used after an initial solution has already been discovered.
pub fn overlap_search_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<WorkerOverlapSearch>, WorkerOverlapSearchError> {
    overlap_search_from_segments_impl(segments, starting_face_id, false)
}

/// Oriedita `FoldedFigure_Worker.possible_overlapping_search(true)` from folded
/// line segments. This enables the subface swapping path and realtime
/// additional-estimation checkpoints used during the initial exhaustive search.
pub fn overlap_search_from_segments_with_swap(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<WorkerOverlapSearch>, WorkerOverlapSearchError> {
    overlap_search_from_segments_impl(segments, starting_face_id, true)
}

fn overlap_search_from_segments_impl(
    segments: &[LineSegment],
    starting_face_id: i32,
    swap: bool,
) -> Result<Option<WorkerOverlapSearch>, WorkerOverlapSearchError> {
    let Some(mut enumerator) = overlap_enumerator_from_segments(segments, starting_face_id)? else {
        return Ok(None);
    };
    enumerator.possible_overlapping_search(swap).map(Some)
}

fn overlap_enumerator_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<WorkerOverlapEnumerator>, WorkerOverlapSearchError> {
    if segments.is_empty() {
        return Ok(None);
    }

    fold_phase_timer!("enumerator start");
    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return Ok(None);
    }
    fold_phase_timer!("fold graph built");

    let positions = graph.face_positions(starting_face_id)?;
    let initial = initial_hierarchy_from_graph(&graph, &positions)?;
    let folded = wireframe_from_graph(&graph, &positions, graph.folded_points(&positions));
    let folded_segments = folded_wireframe_segments(&folded);
    let prepared_segments = prepare_subface_segments(&folded_segments)?;
    let subface_graph = FoldGraph::from_segments(&prepared_segments, true);
    if subface_graph.faces.is_empty() {
        return WorkerOverlapEnumerator::from_ordered_subfaces(&[], &[], 0, &initial, None)
            .map(Some);
    }
    fold_phase_timer!("subface graph built");

    let subfaces = configure_subfaces(&folded, &subface_graph)?;
    fold_phase_timer!("subface config done");
    let mut conditions = equivalence_condition_candidates_from_parts(&graph, &folded, &subfaces)?;
    fold_phase_timer!("equivalence conditions built");
    let mut table = HierarchyTable::from_initial(&initial);
    // Oriedita's second AEA round runs with `removeMode`: close the hierarchy and
    // drop every equivalence condition that fires (it is then redundant, already
    // implied by the closed hierarchy). This shrinks the sets the search and the
    // per-subface guide maps must scan — the folded result is unchanged.
    run_additional_estimation_remove(
        &mut table,
        &subfaces,
        &mut conditions.triple_conditions,
        &mut conditions.quadruple_conditions,
    )?;
    fold_phase_timer!("additional estimation done");
    let configured_hierarchy = table.into_initial_hierarchy(initial.faces_total);
    let enumerator = WorkerOverlapEnumerator::from_subfaces(
        &subfaces.subfaces,
        &subfaces.reduced_subface_indices,
        &configured_hierarchy,
        Some(&conditions),
    )
    .map(Some);
    fold_phase_timer!("worker enumerator built");
    enumerator
}

fn two_colored_overlap_enumerator_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<WorkerOverlapEnumerator>, WorkerOverlapSearchError> {
    if segments.is_empty() {
        return Ok(None);
    }

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return Ok(None);
    }

    let positions = graph.face_positions(starting_face_id)?;
    let initial = initial_hierarchy_from_graph(&graph, &positions)?;
    let folded = wireframe_from_graph(&graph, &positions, graph.points.clone());
    let folded_segments = folded_wireframe_segments(&folded);
    let prepared_segments = prepare_subface_segments(&folded_segments)?;
    let subface_graph = FoldGraph::from_segments(&prepared_segments, true);
    if subface_graph.faces.is_empty() {
        return WorkerOverlapEnumerator::from_ordered_subfaces(&[], &[], 0, &initial, None)
            .map(Some);
    }

    let subfaces = configure_subfaces(&folded, &subface_graph)?;
    let conditions = equivalence_condition_candidates_from_parts(&graph, &folded, &subfaces)?;
    let mut table = HierarchyTable::from_initial(&initial);
    run_additional_estimation(
        &mut table,
        &subfaces,
        &conditions.triple_conditions,
        &conditions.quadruple_conditions,
    )?;
    let configured_hierarchy = table.into_initial_hierarchy(initial.faces_total);
    WorkerOverlapEnumerator::from_subfaces(
        &subfaces.subfaces,
        &subfaces.reduced_subface_indices,
        &configured_hierarchy,
        Some(&conditions),
    )
    .map(Some)
}

fn folded_graph_and_wireframe_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<(FoldGraph, FoldedWireframe)>, FoldGraphError> {
    if segments.is_empty() {
        return Ok(None);
    }

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return Ok(None);
    }

    let positions = graph.face_positions(starting_face_id)?;
    let folded = wireframe_from_graph(&graph, &positions, graph.folded_points(&positions));
    Ok(Some((graph, folded)))
}

/// `Ok(None)` means "this wireframe has no subfaces", which is a result;
/// `Err(Cancelled)` means the user stopped. Conflating them into a bare `None`
/// would silently render an empty figure for a cancelled fold.
fn folded_subface_graph_and_config(
    folded: &FoldedWireframe,
) -> Result<Option<(FoldGraph, SubFaceConfiguration)>, crate::cancel::Cancelled> {
    let folded_segments = folded_wireframe_segments(folded);
    let prepared_segments = prepare_subface_segments(&folded_segments)?;
    let subface_graph = FoldGraph::from_segments(&prepared_segments, true);
    if subface_graph.faces.is_empty() {
        return Ok(None);
    }
    let subfaces = configure_subfaces(folded, &subface_graph)?;
    Ok(Some((subface_graph, subfaces)))
}

impl OrieditaFoldedFigureCameraSet {
    fn iter_mut(&mut self) -> [&mut OrieditaFoldedFigureCamera; 5] {
        [
            &mut self.folded,
            &mut self.front,
            &mut self.rear,
            &mut self.transparent_front,
            &mut self.transparent_rear,
        ]
    }

    fn iter_target_mut(
        &mut self,
        target: OrieditaFoldedFigureCameraTarget,
    ) -> Vec<&mut OrieditaFoldedFigureCamera> {
        match target {
            OrieditaFoldedFigureCameraTarget::All => self.iter_mut().into_iter().collect(),
            OrieditaFoldedFigureCameraTarget::Folded => vec![&mut self.folded],
            OrieditaFoldedFigureCameraTarget::Front => vec![&mut self.front],
            OrieditaFoldedFigureCameraTarget::Rear => vec![&mut self.rear],
            OrieditaFoldedFigureCameraTarget::TransparentFront => {
                vec![&mut self.transparent_front]
            }
            OrieditaFoldedFigureCameraTarget::TransparentRear => vec![&mut self.transparent_rear],
        }
    }
}

impl OrieditaFoldedFigureCamera {
    fn display_position_move(&mut self, delta_tv: Point) {
        self.display_position = self.display_position.move_by(delta_tv);
    }

    fn camera_position_specify_from_tv(&mut self, point_tv: Point) {
        self.camera_position = self.tv_to_object(point_tv);
        self.display_position = point_tv;
    }

    fn tv_to_object(&self, point_tv: Point) -> Point {
        let radians = self.angle_degrees * ORIEDITA_DEGREES_TO_RADIANS;
        let sin = radians.sin();
        let cos = radians.cos();
        let mut x1 = point_tv.x - self.display_position.x;
        let mut y1 = point_tv.y - self.display_position.y;
        x1 /= self.zoom_x;
        y1 /= self.zoom_y;
        x1 *= self.mirror;
        let x2 = cos * x1 - sin * y1;
        let y2 = sin * x1 + cos * y1;
        Point::new(x2 + self.camera_position.x, y2 + self.camera_position.y)
    }
}

#[derive(Debug, Clone, Copy)]
struct OrieditaRenderCamera {
    camera_position: Point,
    angle_degrees: f64,
    mirror: f64,
    zoom_x: f64,
    zoom_y: f64,
    display_position: Point,
}

impl OrieditaRenderCamera {
    fn identity() -> Self {
        Self {
            camera_position: Point::origin(),
            angle_degrees: 0.0,
            mirror: 1.0,
            zoom_x: 1.0,
            zoom_y: 1.0,
            display_position: Point::origin(),
        }
    }

    fn folded(model: &FoldedFigureModel) -> Self {
        Self::from_oriedita_parts(model, 1.0, Point::new(20.0, 20.0))
    }

    fn folded_front(model: &FoldedFigureModel) -> Self {
        Self::from_oriedita_parts(model, 1.0, Point::new(20.0, 20.0))
    }

    fn folded_rear(model: &FoldedFigureModel) -> Self {
        Self::from_oriedita_parts(model, -1.0, Point::new(40.0, 20.0))
    }

    fn transparent_front(model: &FoldedFigureModel) -> Self {
        Self::from_oriedita_parts(model, 1.0, Point::new(20.0, 0.0))
    }

    fn transparent_rear(model: &FoldedFigureModel) -> Self {
        Self::from_oriedita_parts(model, -1.0, Point::new(40.0, 0.0))
    }

    fn from_oriedita_parts(
        model: &FoldedFigureModel,
        mirror: f64,
        display_position: Point,
    ) -> Self {
        Self {
            camera_position: Point::origin(),
            angle_degrees: model.rotation,
            mirror,
            zoom_x: model.scale,
            zoom_y: model.scale,
            display_position,
        }
    }

    fn object_to_tv(self, point: Point) -> Point {
        recorded_point(self.object_to_tv_raw(point))
    }

    fn object_to_tv_gradient(self, point: Point) -> Point {
        recorded_float_point(self.object_to_tv_raw(point))
    }

    fn object_to_tv_raw(self, point: Point) -> Point {
        let radians = self.angle_degrees * ORIEDITA_DEGREES_TO_RADIANS;
        let sin = radians.sin();
        let cos = radians.cos();
        let x1 = point.x - self.camera_position.x;
        let y1 = point.y - self.camera_position.y;
        let mut x2 = cos * x1 + sin * y1;
        let mut y2 = -sin * x1 + cos * y1;
        x2 *= self.mirror;
        x2 *= self.zoom_x;
        y2 *= self.zoom_y;
        Point::new(x2 + self.display_position.x, y2 + self.display_position.y)
    }

    fn fix_to_flat_bounds(
        mut self,
        flat_points: &[Point],
        folded_points: &[Point],
        offset: Point,
    ) -> Self {
        let Some(min_flat) = min_tv_point(flat_points, |point| point) else {
            return self;
        };
        let Some(min_folded) = min_tv_point(folded_points, |point| self.object_to_tv(point)) else {
            return self;
        };

        self.display_position = self
            .display_position
            .move_by(min_folded.delta(min_flat).move_by(offset));
        self
    }

    fn snapshot(self) -> OrieditaFoldedFigureCamera {
        OrieditaFoldedFigureCamera {
            camera_position: recorded_point(self.camera_position),
            angle_degrees: recorded_f64(self.angle_degrees),
            mirror: recorded_f64(self.mirror),
            zoom_x: recorded_f64(self.zoom_x),
            zoom_y: recorded_f64(self.zoom_y),
            display_position: recorded_point(self.display_position),
        }
    }
}

fn recorded_point(point: Point) -> Point {
    Point::new(recorded_f64(point.x), recorded_f64(point.y))
}

fn recorded_float_point(point: Point) -> Point {
    Point::new(
        recorded_f64(point.x as f32 as f64),
        recorded_f64(point.y as f32 as f64),
    )
}

fn recorded_f64(value: f64) -> f64 {
    if value.is_finite() {
        (value * 1_000_000_000.0).round() / 1_000_000_000.0
    } else {
        value
    }
}

fn min_tv_point(points: &[Point], transform: impl Fn(Point) -> Point) -> Option<Point> {
    // Oriedita's one-based loop uses i < getNumPoints(), so the last point is
    // intentionally excluded here.
    let mut iter = points
        .iter()
        .take(points.len().saturating_sub(1))
        .copied()
        .map(transform);
    let first = iter.next()?;
    Some(iter.fold(first, |min, point| {
        Point::new(min.x.min(point.x), min.y.min(point.y))
    }))
}

#[derive(Debug, Clone, Copy)]
struct OrieditaPaperRenderPass {
    camera: OrieditaRenderCamera,
    flipped: bool,
}

#[derive(Debug, Clone)]
struct OrieditaRenderState {
    stroke: FoldedFigureRenderStroke,
    antialias: FoldedFigureRenderAntialias,
}

impl Default for OrieditaRenderState {
    fn default() -> Self {
        Self {
            stroke: default_java2d_stroke(),
            antialias: FoldedFigureRenderAntialias::Off,
        }
    }
}

fn paper_render_pass_name(state: FoldedFigureState, shadows: bool) -> Option<&'static str> {
    match (state, shadows) {
        (FoldedFigureState::Front0, false) => Some("paper-front"),
        (FoldedFigureState::Back1, false) => Some("paper-back"),
        (FoldedFigureState::Both2, false) => Some("paper-both"),
        (FoldedFigureState::Front0, true) => Some("paper-front-shadows"),
        (FoldedFigureState::Back1, true) => Some("paper-back-shadows"),
        (FoldedFigureState::Both2, true) => Some("paper-both-shadows"),
        (FoldedFigureState::Transparent3, _) => None,
    }
}

fn paper_render_passes(
    state: FoldedFigureState,
    model: &FoldedFigureModel,
    flat_points: &[Point],
    folded_points: &[Point],
) -> Option<Vec<OrieditaPaperRenderPass>> {
    let (front, rear) = folded_front_rear_passes(model, flat_points, folded_points);

    match state {
        FoldedFigureState::Front0 => Some(vec![front]),
        FoldedFigureState::Back1 => Some(vec![rear]),
        FoldedFigureState::Both2 => Some(vec![front, rear]),
        FoldedFigureState::Transparent3 => None,
    }
}

fn transparent_or_wire_render_passes(
    state: FoldedFigureState,
    model: &FoldedFigureModel,
    flat_points: &[Point],
    folded_points: &[Point],
) -> Vec<OrieditaPaperRenderPass> {
    let (front, rear) = folded_front_rear_passes(model, flat_points, folded_points);

    match state {
        FoldedFigureState::Front0 => vec![front],
        FoldedFigureState::Back1 => vec![rear],
        FoldedFigureState::Both2 | FoldedFigureState::Transparent3 => vec![front, rear],
    }
}

fn folded_front_rear_passes(
    model: &FoldedFigureModel,
    flat_points: &[Point],
    folded_points: &[Point],
) -> (OrieditaPaperRenderPass, OrieditaPaperRenderPass) {
    let front = OrieditaPaperRenderPass {
        camera: OrieditaRenderCamera::folded_front(model).fix_to_flat_bounds(
            flat_points,
            folded_points,
            Point::new(20.0, 20.0),
        ),
        flipped: false,
    };
    let rear = OrieditaPaperRenderPass {
        camera: OrieditaRenderCamera::folded_rear(model).fix_to_flat_bounds(
            flat_points,
            folded_points,
            Point::new(40.0, 20.0),
        ),
        flipped: true,
    };

    (front, rear)
}

fn folded_figure_camera_set(
    flat_points: &[Point],
    folded_points: &[Point],
    model: &FoldedFigureModel,
) -> OrieditaFoldedFigureCameraSet {
    OrieditaFoldedFigureCameraSet {
        folded: OrieditaRenderCamera::folded(model)
            .fix_to_flat_bounds(flat_points, folded_points, Point::new(20.0, 20.0))
            .snapshot(),
        front: OrieditaRenderCamera::folded_front(model)
            .fix_to_flat_bounds(flat_points, folded_points, Point::new(20.0, 20.0))
            .snapshot(),
        rear: OrieditaRenderCamera::folded_rear(model)
            .fix_to_flat_bounds(flat_points, folded_points, Point::new(40.0, 20.0))
            .snapshot(),
        transparent_front: OrieditaRenderCamera::transparent_front(model)
            .fix_to_flat_bounds(flat_points, folded_points, Point::new(20.0, 0.0))
            .snapshot(),
        transparent_rear: OrieditaRenderCamera::transparent_rear(model)
            .fix_to_flat_bounds(flat_points, folded_points, Point::new(40.0, 0.0))
            .snapshot(),
    }
}

#[allow(clippy::too_many_arguments)]
fn paper_render_primitives(
    flat_graph: &FoldGraph,
    folded: &FoldedWireframe,
    subface_graph: &FoldGraph,
    subfaces: &SubFaceConfiguration,
    hierarchy: &InitialHierarchy,
    model: &FoldedFigureModel,
    custom_constraints: &[OrieditaCustomConstraint],
    shadow_geometry: FoldedShadowGeometry,
) -> Vec<FoldedFigureRenderPrimitive> {
    let hierarchy = HierarchyTable::from_initial(hierarchy);
    let mut primitives = Vec::new();
    let mut render_state = OrieditaRenderState::default();
    let Some(passes) = paper_render_passes(model.state, model, &flat_graph.points, &folded.points)
    else {
        return primitives;
    };

    for pass in passes {
        push_paper_render_pass_primitives(
            subface_graph,
            folded,
            subfaces,
            &hierarchy,
            model,
            custom_constraints,
            pass,
            shadow_geometry,
            &mut render_state,
            &mut primitives,
        );
    }

    primitives
}

fn wire_render_pass_name(state: FoldedFigureState) -> &'static str {
    match state {
        FoldedFigureState::Front0 => "wire-front",
        FoldedFigureState::Back1 => "wire-back",
        FoldedFigureState::Both2 => "wire-both",
        FoldedFigureState::Transparent3 => "wire-transparent-state",
    }
}

fn wire_render_primitives(
    flat_graph: &FoldGraph,
    folded: &FoldedWireframe,
    model: &FoldedFigureModel,
) -> Vec<FoldedFigureRenderPrimitive> {
    let mut primitives = Vec::new();
    let (front, rear) = folded_front_rear_passes(model, &flat_graph.points, &folded.points);
    match model.state {
        FoldedFigureState::Front0 => {
            push_wire_render_pass_primitives(folded, front, &mut primitives)
        }
        FoldedFigureState::Back1 => push_wire_render_pass_primitives(folded, rear, &mut primitives),
        FoldedFigureState::Both2 | FoldedFigureState::Transparent3 => {
            push_wire_render_interleaved_primitives(folded, front, rear, &mut primitives);
        }
    }
    primitives
}

fn push_wire_render_pass_primitives(
    folded: &FoldedWireframe,
    pass: OrieditaPaperRenderPass,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    let mut color = RgbaColor::new(0, 0, 0, 255);
    for line in &folded.lines {
        color = wire_line_color(color, line.color);
        push_wire_line_primitive(folded, line, pass, color, primitives);
    }
}

fn push_wire_render_interleaved_primitives(
    folded: &FoldedWireframe,
    front: OrieditaPaperRenderPass,
    rear: OrieditaPaperRenderPass,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    let mut color = RgbaColor::new(0, 0, 0, 255);
    for line in &folded.lines {
        color = wire_line_color(color, line.color);
        push_wire_line_primitive(folded, line, front, color, primitives);
        push_wire_line_primitive(folded, line, rear, color, primitives);
    }
}

fn push_wire_line_primitive(
    folded: &FoldedWireframe,
    line: &FoldedWireframeLine,
    pass: OrieditaPaperRenderPass,
    color: RgbaColor,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    let Some(begin) = folded.points.get(line.begin).copied() else {
        return;
    };
    let Some(end) = folded.points.get(line.end).copied() else {
        return;
    };
    primitives.push(FoldedFigureRenderPrimitive {
        sequence: primitives.len(),
        kind: FoldedFigureRenderPrimitiveKind::StrokeSegment,
        style: FoldedFigureRenderStyle {
            paint: FoldedFigureRenderPaint::Color { color },
            stroke: default_java2d_stroke(),
            antialias: FoldedFigureRenderAntialias::Off,
        },
        geometry: FoldedFigureRenderGeometry::Segment {
            from: java_draw_line_point(pass.camera.object_to_tv_raw(begin)),
            to: java_draw_line_point(pass.camera.object_to_tv_raw(end)),
        },
    });
}

fn wire_line_color(current: RgbaColor, color: LineColor) -> RgbaColor {
    match color {
        LineColor::Black0 => RgbaColor::new(0, 0, 0, 255),
        LineColor::Red1 => RgbaColor::new(255, 0, 0, 255),
        LineColor::Blue2 => RgbaColor::new(0, 0, 255, 255),
        _ => current,
    }
}

fn java_draw_line_point(point: Point) -> Point {
    Point::new(point.x.trunc(), point.y.trunc())
}

fn transparent_render_pass_name(state: FoldedFigureState, color: bool) -> &'static str {
    match (state, color) {
        (FoldedFigureState::Front0, false) => "transparent-grayscale-front",
        (FoldedFigureState::Back1, false) => "transparent-grayscale-back",
        (FoldedFigureState::Both2, false) => "transparent-grayscale-both",
        (FoldedFigureState::Transparent3, false) => "transparent-grayscale-transparent-state",
        (FoldedFigureState::Front0, true) => "transparent-color-front",
        (FoldedFigureState::Back1, true) => "transparent-color-back",
        (FoldedFigureState::Both2, true) => "transparent-color-both",
        (FoldedFigureState::Transparent3, true) => "transparent-color-transparent-state",
    }
}

fn full_render_pass_name(
    display_style: DisplayStyle,
    state: FoldedFigureState,
    transparency_color: bool,
) -> String {
    let base = match display_style {
        DisplayStyle::Wire2 => wire_render_pass_name(state),
        DisplayStyle::Transparent3 => transparent_render_pass_name(state, transparency_color),
        DisplayStyle::Paper5 => match state {
            FoldedFigureState::Front0 => "paper-front",
            FoldedFigureState::Back1 => "paper-back",
            FoldedFigureState::Both2 => "paper-both",
            FoldedFigureState::Transparent3 => "paper-transparent-state",
        },
        DisplayStyle::None0 => match state {
            FoldedFigureState::Front0 => "none-front",
            FoldedFigureState::Back1 => "none-back",
            FoldedFigureState::Both2 => "none-both",
            FoldedFigureState::Transparent3 => "none-transparent-state",
        },
        DisplayStyle::Development1 => match state {
            FoldedFigureState::Front0 => "development-front",
            FoldedFigureState::Back1 => "development-back",
            FoldedFigureState::Both2 => "development-both",
            FoldedFigureState::Transparent3 => "development-transparent-state",
        },
        DisplayStyle::Development4 => match state {
            FoldedFigureState::Front0 => "development4-front",
            FoldedFigureState::Back1 => "development4-back",
            FoldedFigureState::Both2 => "development4-both",
            FoldedFigureState::Transparent3 => "development4-transparent-state",
        },
    };
    format!("{base}-full")
}

fn transparent_render_primitives(
    flat_graph: &FoldGraph,
    folded: &FoldedWireframe,
    subface_graph: &FoldGraph,
    subfaces: &SubFaceConfiguration,
    model: &FoldedFigureModel,
    custom_constraints: &[OrieditaCustomConstraint],
) -> Vec<FoldedFigureRenderPrimitive> {
    let passes =
        transparent_or_wire_render_passes(model.state, model, &flat_graph.points, &folded.points);
    let mut primitives = Vec::new();
    let mut render_state = OrieditaRenderState::default();
    for pass in passes {
        if model.transparency_color {
            push_color_transparent_render_pass_primitives(
                folded,
                subface_graph,
                model,
                pass,
                &mut render_state,
                &mut primitives,
            );
        } else {
            push_grayscale_transparent_render_pass_primitives(
                subface_graph,
                subfaces,
                model,
                custom_constraints,
                pass,
                &mut render_state,
                &mut primitives,
            );
        }
    }
    primitives
}

#[allow(clippy::too_many_arguments)]
fn push_folded_display_style_pass_primitives(
    display_style: DisplayStyle,
    folded: &FoldedWireframe,
    subface_data: Option<&(FoldGraph, SubFaceConfiguration)>,
    hierarchy: Option<&HierarchyTable>,
    model: &FoldedFigureModel,
    custom_constraints: &[OrieditaCustomConstraint],
    pass: OrieditaPaperRenderPass,
    shadow_geometry: FoldedShadowGeometry,
    render_state: &mut OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    match display_style {
        DisplayStyle::Transparent3 => push_folded_transparency_pass_primitives(
            folded,
            subface_data,
            model,
            custom_constraints,
            pass,
            render_state,
            primitives,
        ),
        DisplayStyle::Paper5 => {
            let Some((subface_graph, subfaces)) = subface_data else {
                return;
            };
            let Some(hierarchy) = hierarchy else {
                return;
            };
            push_paper_render_pass_primitives(
                subface_graph,
                folded,
                subfaces,
                hierarchy,
                model,
                custom_constraints,
                pass,
                shadow_geometry,
                render_state,
                primitives,
            );
        }
        _ => {}
    }
}

fn push_folded_transparency_pass_primitives(
    folded: &FoldedWireframe,
    subface_data: Option<&(FoldGraph, SubFaceConfiguration)>,
    model: &FoldedFigureModel,
    custom_constraints: &[OrieditaCustomConstraint],
    pass: OrieditaPaperRenderPass,
    render_state: &mut OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    let Some((subface_graph, subfaces)) = subface_data else {
        return;
    };
    if model.transparency_color {
        push_color_transparent_render_pass_primitives(
            folded,
            subface_graph,
            model,
            pass,
            render_state,
            primitives,
        );
    } else {
        push_grayscale_transparent_render_pass_primitives(
            subface_graph,
            subfaces,
            model,
            custom_constraints,
            pass,
            render_state,
            primitives,
        );
    }
}

fn push_color_transparent_render_pass_primitives(
    folded: &FoldedWireframe,
    subface_graph: &FoldGraph,
    model: &FoldedFigureModel,
    pass: OrieditaPaperRenderPass,
    render_state: &mut OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    let fill_color = RgbaColor::new(
        model.front_color.red,
        model.front_color.green,
        model.front_color.blue,
        model.transparent_transparency,
    );
    for face in &folded.faces {
        push_transparent_fill(
            face,
            &folded.points,
            pass,
            fill_color,
            render_state,
            primitives,
        );
    }

    let line_color = RgbaColor::new(
        model.front_color.red,
        model.front_color.green,
        model.front_color.blue,
        model.transparent_transparency.saturating_mul(2),
    );
    push_transparent_lines(
        subface_graph,
        model,
        pass,
        line_color,
        render_state,
        primitives,
    );
}

fn push_grayscale_transparent_render_pass_primitives(
    subface_graph: &FoldGraph,
    subfaces: &SubFaceConfiguration,
    model: &FoldedFigureModel,
    custom_constraints: &[OrieditaCustomConstraint],
    pass: OrieditaPaperRenderPass,
    render_state: &mut OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    let step = 225usize
        .checked_div(subfaces.face_id_count_max)
        .unwrap_or(0);

    for (subface_index, face) in subface_graph.faces.iter().enumerate() {
        let face_count = subfaces
            .subfaces
            .get(subface_index)
            .map(|subface| subface.face_ids.len())
            .unwrap_or(0);
        let gray = (255i32 - (step * face_count) as i32).clamp(0, 255) as u8;
        push_transparent_fill(
            face,
            &subface_graph.points,
            pass,
            RgbaColor::new(gray, gray, gray, 255),
            render_state,
            primitives,
        );
    }

    push_custom_constraint_primitives(custom_constraints, pass, render_state, primitives);

    push_transparent_lines(
        subface_graph,
        model,
        pass,
        RgbaColor::new(0, 0, 0, 255),
        render_state,
        primitives,
    );
}

fn push_transparent_fill(
    face: &[usize],
    points: &[Point],
    pass: OrieditaPaperRenderPass,
    color: RgbaColor,
    render_state: &OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    let points = face
        .iter()
        .filter_map(|point_index| points.get(*point_index).copied())
        .map(|point| pass.camera.object_to_tv(point))
        .collect::<Vec<_>>();
    if points.len() < 3 {
        return;
    }
    primitives.push(FoldedFigureRenderPrimitive {
        sequence: primitives.len(),
        kind: FoldedFigureRenderPrimitiveKind::FillPath,
        style: FoldedFigureRenderStyle {
            paint: FoldedFigureRenderPaint::Color { color },
            stroke: render_state.stroke.clone(),
            antialias: render_state.antialias,
        },
        geometry: FoldedFigureRenderGeometry::Path {
            commands: closed_path_commands(&points),
        },
    });
}

fn push_transparent_lines(
    subface_graph: &FoldGraph,
    model: &FoldedFigureModel,
    pass: OrieditaPaperRenderPass,
    color: RgbaColor,
    render_state: &mut OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    render_state.stroke = folded_line_stroke(model);
    render_state.antialias = if model.anti_alias {
        FoldedFigureRenderAntialias::On
    } else {
        FoldedFigureRenderAntialias::Off
    };
    for line in &subface_graph.lines {
        let Some(begin) = subface_graph.points.get(line.begin).copied() else {
            continue;
        };
        let Some(end) = subface_graph.points.get(line.end).copied() else {
            continue;
        };
        let points = [
            pass.camera.object_to_tv(begin),
            pass.camera.object_to_tv(end),
        ];
        primitives.push(FoldedFigureRenderPrimitive {
            sequence: primitives.len(),
            kind: FoldedFigureRenderPrimitiveKind::StrokePath,
            style: FoldedFigureRenderStyle {
                paint: FoldedFigureRenderPaint::Color { color },
                stroke: render_state.stroke.clone(),
                antialias: render_state.antialias,
            },
            geometry: FoldedFigureRenderGeometry::Path {
                commands: open_path_commands(&points),
            },
        });
    }
}

fn push_custom_constraint_primitives(
    custom_constraints: &[OrieditaCustomConstraint],
    pass: OrieditaPaperRenderPass,
    render_state: &mut OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    for constraint in custom_constraints {
        if pass.flipped {
            if constraint.face_order == OrieditaCustomConstraintFaceOrder::Normal {
                continue;
            }
        } else if constraint.face_order == OrieditaCustomConstraintFaceOrder::Flipped {
            continue;
        }

        let (fill, border) =
            if constraint.constraint_type == OrieditaCustomConstraintType::ColorBack {
                (
                    RgbaColor::new(255, 255, 255, 255),
                    RgbaColor::new(0, 0, 0, 255),
                )
            } else {
                (
                    RgbaColor::new(0, 0, 0, 255),
                    RgbaColor::new(255, 255, 255, 255),
                )
            };

        render_state.stroke = default_java2d_stroke();
        let pos = pass.camera.object_to_tv_raw(constraint.position);
        let x = pos.x.trunc();
        let y = pos.y.trunc();
        push_fill_ellipse_rect(x - 4.0, y - 4.0, 8.0, 8.0, fill, render_state, primitives);
        push_stroke_ellipse_rect(x - 4.0, y - 4.0, 8.0, 8.0, border, render_state, primitives);
    }
}

fn push_cross_with_camera_primitives(
    camera: OrieditaRenderCamera,
    selected: bool,
    index: usize,
    display_numbers: bool,
    render_state: &OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    let point = camera.object_to_tv_raw(camera.camera_position);
    let orange = RgbaColor::new(255, 200, 0, 255);
    push_cross_width_line_polygon(
        LineSegment::new(
            Point::new(point.x - 5.0, point.y),
            Point::new(point.x + 5.0, point.y),
        ),
        orange,
        render_state,
        primitives,
    );
    push_cross_width_line_polygon(
        LineSegment::new(
            Point::new(point.x, point.y - 5.0),
            Point::new(point.x, point.y + 5.0),
        ),
        orange,
        render_state,
        primitives,
    );

    if selected {
        primitives.push(FoldedFigureRenderPrimitive {
            sequence: primitives.len(),
            kind: FoldedFigureRenderPrimitiveKind::FillEllipse,
            style: FoldedFigureRenderStyle {
                paint: FoldedFigureRenderPaint::Color {
                    color: RgbaColor::new(200, 50, 255, 90),
                },
                stroke: render_state.stroke.clone(),
                antialias: render_state.antialias,
            },
            geometry: FoldedFigureRenderGeometry::Ellipse {
                x: recorded_f64(point.x - 25.0),
                y: recorded_f64(point.y - 25.0),
                width: 50.0,
                height: 50.0,
            },
        });
    }

    if display_numbers {
        primitives.push(FoldedFigureRenderPrimitive {
            sequence: primitives.len(),
            kind: FoldedFigureRenderPrimitiveKind::Text,
            style: FoldedFigureRenderStyle {
                paint: FoldedFigureRenderPaint::Color { color: orange },
                stroke: render_state.stroke.clone(),
                antialias: render_state.antialias,
            },
            geometry: FoldedFigureRenderGeometry::Text {
                value: index.to_string(),
                position: Point::new(
                    recorded_f64((point.x as f32 + 25.0_f32) as f64),
                    recorded_f64((point.y as f32 + 25.0_f32) as f64),
                ),
            },
        });
    }
}

fn push_cross_width_line_polygon(
    segment: LineSegment,
    color: RgbaColor,
    render_state: &OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    let sp = move_parallel(&segment, 2.0);
    let sm = move_parallel(&segment, -2.0);
    let points = vec![
        java_draw_line_point(sp.a),
        java_draw_line_point(sp.b),
        java_draw_line_point(sm.b),
        java_draw_line_point(sm.a),
    ];
    primitives.push(FoldedFigureRenderPrimitive {
        sequence: primitives.len(),
        kind: FoldedFigureRenderPrimitiveKind::FillPolygon,
        style: FoldedFigureRenderStyle {
            paint: FoldedFigureRenderPaint::Color { color },
            stroke: render_state.stroke.clone(),
            antialias: render_state.antialias,
        },
        geometry: FoldedFigureRenderGeometry::Polygon { points },
    });
}

#[allow(clippy::too_many_arguments)]
fn push_selected_point_primitives(
    flat_graph: &FoldGraph,
    folded: &FoldedWireframe,
    state: FoldedFigureState,
    front: OrieditaPaperRenderPass,
    rear: OrieditaPaperRenderPass,
    options: &FoldedFigureRenderOptions,
    render_state: &OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    let flat_camera = OrieditaRenderCamera::identity();
    for index in &options.selected_flat_point_indices {
        let Some(point) = flat_graph.points.get(*index).copied() else {
            continue;
        };
        push_fill_ellipse_center_int(
            flat_camera.object_to_tv_raw(point),
            7.0,
            RgbaColor::new(0, 255, 255, 100),
            render_state,
            primitives,
        );
    }

    for index in &options.selected_folded_point_indices {
        if let Some(point) = flat_graph.points.get(*index).copied() {
            push_fill_ellipse_center_int(
                flat_camera.object_to_tv_raw(point),
                15.0,
                RgbaColor::new(0, 255, 0, 100),
                render_state,
                primitives,
            );
        }

        let Some(point) = folded.points.get(*index).copied() else {
            continue;
        };
        match state {
            FoldedFigureState::Front0 => push_fill_ellipse_center_int(
                front.camera.object_to_tv_raw(point),
                10.0,
                RgbaColor::new(0, 255, 0, 50),
                render_state,
                primitives,
            ),
            FoldedFigureState::Back1 => push_fill_ellipse_center_int(
                rear.camera.object_to_tv_raw(point),
                10.0,
                RgbaColor::new(0, 255, 0, 50),
                render_state,
                primitives,
            ),
            FoldedFigureState::Both2 | FoldedFigureState::Transparent3 => {
                push_fill_ellipse_center_int(
                    front.camera.object_to_tv_raw(point),
                    10.0,
                    RgbaColor::new(0, 255, 0, 50),
                    render_state,
                    primitives,
                );
                push_fill_ellipse_center_int(
                    rear.camera.object_to_tv_raw(point),
                    10.0,
                    RgbaColor::new(0, 255, 0, 50),
                    render_state,
                    primitives,
                );
            }
        }
    }
}

fn push_fill_ellipse_center_int(
    center: Point,
    radius: f64,
    color: RgbaColor,
    render_state: &OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    let x = center.x.trunc() - radius;
    let y = center.y.trunc() - radius;
    push_fill_ellipse_rect(
        x,
        y,
        2.0 * radius,
        2.0 * radius,
        color,
        render_state,
        primitives,
    );
}

fn push_fill_ellipse_rect(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    color: RgbaColor,
    render_state: &OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    primitives.push(FoldedFigureRenderPrimitive {
        sequence: primitives.len(),
        kind: FoldedFigureRenderPrimitiveKind::FillEllipse,
        style: FoldedFigureRenderStyle {
            paint: FoldedFigureRenderPaint::Color { color },
            stroke: render_state.stroke.clone(),
            antialias: render_state.antialias,
        },
        geometry: FoldedFigureRenderGeometry::Ellipse {
            x: recorded_f64(x),
            y: recorded_f64(y),
            width: recorded_f64(width),
            height: recorded_f64(height),
        },
    });
}

fn push_stroke_ellipse_rect(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    color: RgbaColor,
    render_state: &OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    primitives.push(FoldedFigureRenderPrimitive {
        sequence: primitives.len(),
        kind: FoldedFigureRenderPrimitiveKind::StrokeEllipse,
        style: FoldedFigureRenderStyle {
            paint: FoldedFigureRenderPaint::Color { color },
            stroke: render_state.stroke.clone(),
            antialias: render_state.antialias,
        },
        geometry: FoldedFigureRenderGeometry::Ellipse {
            x: recorded_f64(x),
            y: recorded_f64(y),
            width: recorded_f64(width),
            height: recorded_f64(height),
        },
    });
}

#[allow(clippy::too_many_arguments)]
fn push_paper_render_pass_primitives(
    subface_graph: &FoldGraph,
    folded: &FoldedWireframe,
    subfaces: &SubFaceConfiguration,
    hierarchy: &HierarchyTable,
    model: &FoldedFigureModel,
    custom_constraints: &[OrieditaCustomConstraint],
    pass: OrieditaPaperRenderPass,
    shadow_geometry: FoldedShadowGeometry,
    render_state: &mut OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    for (subface_index, face) in subface_graph.faces.iter().enumerate() {
        let Some(visible_face) =
            visible_subface_face(subface_index, subfaces, hierarchy, pass.flipped)
        else {
            continue;
        };
        let color = visible_face_color(visible_face, folded, model, pass.flipped);
        let points = face
            .iter()
            .filter_map(|point_index| subface_graph.points.get(*point_index).copied())
            .map(|point| pass.camera.object_to_tv(point))
            .collect::<Vec<_>>();
        if points.len() < 3 {
            continue;
        }
        primitives.push(FoldedFigureRenderPrimitive {
            sequence: primitives.len(),
            kind: FoldedFigureRenderPrimitiveKind::FillPath,
            style: FoldedFigureRenderStyle {
                paint: FoldedFigureRenderPaint::Color { color },
                stroke: render_state.stroke.clone(),
                antialias: FoldedFigureRenderAntialias::Off,
            },
            geometry: FoldedFigureRenderGeometry::Path {
                commands: closed_path_commands(&points),
            },
        });
    }

    if model.display_shadows {
        push_paper_shadow_primitives(
            subface_graph,
            subfaces,
            hierarchy,
            pass,
            shadow_geometry,
            render_state,
            primitives,
        );
    }

    render_state.stroke = folded_line_stroke(model);
    render_state.antialias = if model.anti_alias {
        FoldedFigureRenderAntialias::On
    } else {
        FoldedFigureRenderAntialias::Off
    };

    for line_index in 0..subface_graph.lines.len() {
        if !should_draw_paper_edge(line_index, subface_graph, subfaces, hierarchy, pass.flipped) {
            continue;
        }
        let line = subface_graph.lines[line_index];
        let Some(begin) = subface_graph.points.get(line.begin).copied() else {
            continue;
        };
        let Some(end) = subface_graph.points.get(line.end).copied() else {
            continue;
        };
        let points = [
            pass.camera.object_to_tv(begin),
            pass.camera.object_to_tv(end),
        ];
        primitives.push(FoldedFigureRenderPrimitive {
            sequence: primitives.len(),
            kind: FoldedFigureRenderPrimitiveKind::StrokePath,
            style: FoldedFigureRenderStyle {
                paint: FoldedFigureRenderPaint::Color {
                    color: RgbaColor::from_rgb(model.line_color),
                },
                stroke: render_state.stroke.clone(),
                antialias: render_state.antialias,
            },
            geometry: FoldedFigureRenderGeometry::Path {
                commands: open_path_commands(&points),
            },
        });
    }

    push_custom_constraint_primitives(custom_constraints, pass, render_state, primitives);
}

/// How far a shadow band reaches from its edge, in object units (Oriedita's `10.0`).
const SHADOW_OFFSET: f64 = 10.0;

fn push_paper_shadow_primitives(
    subface_graph: &FoldGraph,
    subfaces: &SubFaceConfiguration,
    hierarchy: &HierarchyTable,
    pass: OrieditaPaperRenderPass,
    geometry: FoldedShadowGeometry,
    render_state: &OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    for line_index in 0..subface_graph.lines.len() {
        let Some(shadow_subface) =
            shadow_subface_for_line(line_index, subface_graph, subfaces, hierarchy, pass.flipped)
        else {
            continue;
        };
        let Some(line) = subface_graph.lines.get(line_index).copied() else {
            continue;
        };
        let Some(begin) = subface_graph.points.get(line.begin).copied() else {
            continue;
        };
        let Some(end) = subface_graph.points.get(line.end).copied() else {
            continue;
        };
        let length = match geometry {
            // `(begin.x - end.x, begin.y - end.y)` rotated a quarter turn has the
            // edge's length, so dividing by that length is what makes the offset
            // a constant SHADOW_OFFSET across every band.
            FoldedShadowGeometry::Refined => begin.distance(end),
            // Oriedita's Java2D drawer accidentally uses getBegin(lineId), the
            // 1-based point id, as the x-coordinate when computing shadow length.
            // The rectangle coordinates still use the real point coordinates.
            FoldedShadowGeometry::OrieditaExact => {
                Point::new((line.begin + 1) as f64, begin.y).distance(end)
            }
        };
        if length == 0.0 {
            continue;
        }

        let offset = Point::new(
            -(begin.y - end.y) * SHADOW_OFFSET / length,
            (begin.x - end.x) * SHADOW_OFFSET / length,
        );
        let reverse_offset = Point::new(-offset.x, -offset.y);
        let midpoint = Point::new((begin.x + end.x) / 2.0, (begin.y + end.y) / 2.0);
        if shadow_offset_inside(subface_graph, shadow_subface, midpoint, offset, geometry) {
            push_shadow_rectangle(
                begin,
                end,
                offset,
                midpoint,
                midpoint.move_by(offset),
                pass,
                render_state,
                primitives,
            );
        }

        if shadow_offset_inside(
            subface_graph,
            shadow_subface,
            midpoint,
            reverse_offset,
            geometry,
        ) {
            push_shadow_rectangle(
                begin,
                end,
                reverse_offset,
                begin,
                begin.move_by(reverse_offset),
                pass,
                render_state,
                primitives,
            );
        }
    }
}

fn shadow_subface_for_line(
    line_index: usize,
    subface_graph: &FoldGraph,
    subfaces: &SubFaceConfiguration,
    hierarchy: &HierarchyTable,
    flipped: bool,
) -> Option<usize> {
    let (first, second) = subface_graph.line_face_border(line_index)?;
    let first_count = subfaces
        .subfaces
        .get(first)
        .map(|subface| subface.face_ids.len())
        .unwrap_or(0);
    let second_count = subfaces
        .subfaces
        .get(second)
        .map(|subface| subface.face_ids.len())
        .unwrap_or(0);
    if first_count == 0 || second_count == 0 || first == second {
        return None;
    }

    let first_visible = visible_subface_face(first, subfaces, hierarchy, flipped)?;
    let second_visible = visible_subface_face(second, subfaces, hierarchy, flipped)?;
    if first_visible == second_visible {
        return None;
    }

    let mut target = first;
    match hierarchy.get(first_visible, second_visible)? {
        FaceOrder::Above => target = second,
        FaceOrder::Below => {}
    }

    if flipped {
        if target == first {
            Some(second)
        } else {
            Some(first)
        }
    } else {
        Some(target)
    }
}

/// How far off an edge to sample when asking which side its subface lies on.
///
/// `Polygon::inside` reports `Border` within `Epsilon::UNKNOWN_001` of an edge,
/// so the sample has to clear that band by a wide margin to get a definite
/// answer. Two orders of magnitude does it while staying negligible against
/// subface sizes, which run in the tens of units.
const SHADOW_PROBE_DISTANCE: f64 = Epsilon::UNKNOWN_001 * 100.0;

/// Whether the shadow cast along `offset` falls inside the subface casting it.
///
/// Upstream samples at `midpoint + ε · offset` and accepts anything that is not
/// `Outside`. Both halves of that misfire once the band width is corrected: the
/// step scales with the band, and `Border` counts as a hit. Since the sample sits
/// within a hair of the edge it usually *is* on the border, so both directions
/// pass and the edge gets a shadow on each side — the doubled, muddy bands.
/// `Refined` samples a fixed distance along the unit normal and demands a strict
/// `Inside`, which is the actual question: which side is the paper on.
fn shadow_offset_inside(
    subface_graph: &FoldGraph,
    subface_index: usize,
    midpoint: Point,
    offset: Point,
    geometry: FoldedShadowGeometry,
) -> bool {
    let Some(face) = subface_graph.faces.get(subface_index) else {
        return false;
    };
    let polygon = subface_polygon(subface_graph, face);
    match geometry {
        FoldedShadowGeometry::Refined => {
            let length = offset.distance(Point::new(0.0, 0.0));
            if length == 0.0 {
                return false;
            }
            let step = SHADOW_PROBE_DISTANCE / length;
            polygon.inside(Point::new(
                midpoint.x + step * offset.x,
                midpoint.y + step * offset.y,
            )) == PolygonIntersection::Inside
        }
        FoldedShadowGeometry::OrieditaExact => {
            polygon.inside(Point::new(
                midpoint.x + Epsilon::UNKNOWN_001 * offset.x,
                midpoint.y + Epsilon::UNKNOWN_001 * offset.y,
            )) != PolygonIntersection::Outside
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn push_shadow_rectangle(
    begin: Point,
    end: Point,
    offset: Point,
    gradient_from: Point,
    gradient_to: Point,
    pass: OrieditaPaperRenderPass,
    render_state: &OrieditaRenderState,
    primitives: &mut Vec<FoldedFigureRenderPrimitive>,
) {
    let points = [
        pass.camera.object_to_tv(begin),
        pass.camera.object_to_tv(begin.move_by(offset)),
        pass.camera.object_to_tv(end.move_by(offset)),
        pass.camera.object_to_tv(end),
    ];
    primitives.push(FoldedFigureRenderPrimitive {
        sequence: primitives.len(),
        kind: FoldedFigureRenderPrimitiveKind::FillPath,
        style: FoldedFigureRenderStyle {
            paint: FoldedFigureRenderPaint::Gradient {
                from: pass.camera.object_to_tv_gradient(gradient_from),
                from_color: RgbaColor::new(0, 0, 0, 50),
                to: pass.camera.object_to_tv_gradient(gradient_to),
                to_color: RgbaColor::new(0, 0, 0, 0),
                cyclic: false,
            },
            stroke: render_state.stroke.clone(),
            antialias: FoldedFigureRenderAntialias::Off,
        },
        geometry: FoldedFigureRenderGeometry::Path {
            commands: closed_path_commands(&points),
        },
    });
}

fn visible_subface_face(
    subface_index: usize,
    subfaces: &SubFaceConfiguration,
    hierarchy: &HierarchyTable,
    flipped: bool,
) -> Option<usize> {
    let subface = subfaces.subfaces.get(subface_index)?;
    let ordered = subface_top_stack(subface, hierarchy);
    if flipped {
        ordered
            .last()
            .copied()
            .or_else(|| subface.face_ids.last().copied())
    } else {
        ordered
            .first()
            .copied()
            .or_else(|| subface.face_ids.first().copied())
    }
}

fn subface_top_stack(subface: &SubFace, hierarchy: &HierarchyTable) -> Vec<usize> {
    let face_count = subface.face_ids.len();
    let mut from_top_indices = vec![None; face_count];
    for (local_index, face) in subface.face_ids.iter().copied().enumerate() {
        let above_count = subface
            .face_ids
            .iter()
            .copied()
            .filter(|other| hierarchy.get(face, *other) == Some(FaceOrder::Above))
            .count();
        let position = face_count.saturating_sub(above_count);
        if (1..=face_count).contains(&position) {
            from_top_indices[position - 1] = Some(local_index);
        }
    }

    from_top_indices
        .into_iter()
        .filter_map(|index| index.and_then(|index| subface.face_ids.get(index).copied()))
        .collect()
}

fn visible_face_color(
    face: usize,
    folded: &FoldedWireframe,
    model: &FoldedFigureModel,
    flipped: bool,
) -> RgbaColor {
    let position = folded.face_positions.get(face).copied().unwrap_or(1);
    let front = if flipped {
        position % 2 == 0
    } else {
        position % 2 == 1
    };
    RgbaColor::from_rgb(if front {
        model.front_color
    } else {
        model.back_color
    })
}

fn should_draw_paper_edge(
    line_index: usize,
    subface_graph: &FoldGraph,
    subfaces: &SubFaceConfiguration,
    hierarchy: &HierarchyTable,
    flipped: bool,
) -> bool {
    let Some((first, second)) = subface_graph.line_face_border(line_index) else {
        return true;
    };
    let first_count = subfaces
        .subfaces
        .get(first)
        .map(|subface| subface.face_ids.len())
        .unwrap_or(0);
    let second_count = subfaces
        .subfaces
        .get(second)
        .map(|subface| subface.face_ids.len())
        .unwrap_or(0);
    if first_count == 0 || second_count == 0 || first == second {
        return true;
    }

    visible_subface_face(first, subfaces, hierarchy, flipped)
        != visible_subface_face(second, subfaces, hierarchy, flipped)
}

fn default_java2d_stroke() -> FoldedFigureRenderStroke {
    FoldedFigureRenderStroke::Basic {
        width: 1.0,
        end_cap: 2,
        line_join: 0,
        miter_limit: 10.0,
    }
}

fn folded_line_stroke(model: &FoldedFigureModel) -> FoldedFigureRenderStroke {
    FoldedFigureRenderStroke::Basic {
        width: if model.anti_alias { 1.200000048 } else { 1.0 },
        end_cap: 0,
        line_join: 0,
        miter_limit: 10.0,
    }
}

fn closed_path_commands(points: &[Point]) -> Vec<RenderPathCommand> {
    let mut commands = open_path_commands(points);
    if !commands.is_empty() {
        commands.push(RenderPathCommand::Close);
    }
    commands
}

fn open_path_commands(points: &[Point]) -> Vec<RenderPathCommand> {
    let Some(first) = points.first().copied() else {
        return Vec::new();
    };
    let mut commands = vec![RenderPathCommand::MoveTo { point: first }];
    commands.extend(
        points
            .iter()
            .skip(1)
            .copied()
            .map(|point| RenderPathCommand::LineTo { point }),
    );
    commands
}

fn initial_hierarchy_from_graph(
    graph: &FoldGraph,
    positions: &FacePositions,
) -> Result<InitialHierarchy, InitialHierarchyError> {
    let mut relations = Vec::new();
    let mut polled = 0u32;
    for (line_index, line) in graph.lines.iter().enumerate() {
        // Site 9. `line_face_border` is an array read since the incidence index
        // landed, so the body is cheap and this polls on a stride. It runs twice
        // per Order 4 over every line.
        crate::check_every!(polled, 8);
        let Some((first_face, second_face)) = graph.line_face_border(line_index) else {
            continue;
        };
        if first_face == second_face {
            continue;
        }

        let first_position = positions.face_position[first_face];
        let second_position = positions.face_position[second_face];
        if first_position % 2 == second_position % 2 {
            return Err(InitialHierarchyError::SameParityAdjacentFaces {
                line: line_index,
                first_face,
                second_face,
            });
        }

        let first_same_orientation = first_position % 2 == 1;
        let first_above_second = if line.color == LineColor::Red1 {
            first_same_orientation
        } else {
            !first_same_orientation
        };

        relations.push(if first_above_second {
            HierarchyRelation {
                upper_face: first_face,
                lower_face: second_face,
            }
        } else {
            HierarchyRelation {
                upper_face: second_face,
                lower_face: first_face,
            }
        });
    }

    Ok(InitialHierarchy {
        faces_total: graph.faces.len(),
        relations,
    })
}

fn equivalence_condition_candidates_from_parts(
    graph: &FoldGraph,
    folded: &FoldedWireframe,
    subfaces: &SubFaceConfiguration,
) -> Result<EquivalenceConditionSet, InitialHierarchyError> {
    let hierarchy = InitialHierarchy {
        faces_total: graph.faces.len(),
        relations: initial_hierarchy_from_graph(
            graph,
            &FacePositions {
                starting_face: folded.starting_face,
                face_position: folded.face_positions.clone(),
                next_face: folded.next_faces.clone(),
                associated_line: folded.associated_lines.clone(),
            },
        )?
        .relations,
    };
    let folded_segments = folded_wireframe_segments(folded);
    let face_polygons = folded_face_polygons(folded);

    // Oriedita prunes candidates with a QuadTree instead of scanning every face
    // (triple, `RectangleCollector` over folded faces) or every line pair (quad,
    // `getPotentialCollision` over folded lines). The collectors are supersets of
    // the geometric predicate that follows, and are returned in ascending index
    // order, so the produced condition set is identical to the brute-force scan.
    let degenerate = quad_tree::BBox {
        l: 0.0,
        r: 0.0,
        b: 0.0,
        t: 0.0,
    };
    let face_items: Vec<quad_tree::BBox> = face_polygons
        .iter()
        .map(|polygon| quad_tree::BBox::from_points(&polygon.vertices).unwrap_or(degenerate))
        .collect();
    let face_tree =
        quad_tree::QuadTree::new(face_items, &folded.points, quad_tree::Comparator::Expand);
    let line_items: Vec<quad_tree::BBox> = (0..graph.lines.len())
        .map(|line_index| {
            folded_segments
                .get(line_index)
                .map(|segment| quad_tree::BBox::from_segment(segment.a, segment.b))
                .unwrap_or(degenerate)
        })
        .collect();
    let line_tree =
        quad_tree::QuadTree::new(line_items, &folded.points, quad_tree::Comparator::Shrink);

    // Each line's candidates are independent, so these map+flatten passes run in
    // parallel on native builds (see `flat_map_conditions`). Order is preserved,
    // so the produced set is byte-identical to the sequential scan.
    let triple_conditions = flat_map_conditions(0..graph.lines.len(), |line_index| {
        let mut out = Vec::new();
        let Some((first_face, second_face)) = graph.line_face_border(line_index) else {
            return out;
        };
        if first_face == second_face {
            return out;
        }
        let Some(segment) = folded_segments.get(line_index) else {
            return out;
        };
        let query = quad_tree::BBox::from_segment(segment.a, segment.b);
        // Site 2. The closure returns `Vec`, not `Result`, so `check()?` does not
        // typecheck here — hence a latch and a `break`. A partial `out` is safe
        // at this one site *only* because the caller discards the entire collect
        // at the `check()?` below it, and nothing clears the signal mid-run. Do
        // not copy this shape anywhere the partial result is returned.
        let mut polled = 0u32;
        for face_index in face_tree.collect_rectangle(query) {
            polled = polled.wrapping_add(1);
            if polled & 0xFF == 0 && crate::cancel::check().is_err() {
                break;
            }
            let Some(polygon) = face_polygons.get(face_index) else {
                continue;
            };
            if face_index != first_face
                && face_index != second_face
                && polygon.convex_inside(segment)
            {
                let (above, below) = normalized_pair(&hierarchy, first_face, second_face);
                out.push(EquivalenceCondition {
                    a: face_index,
                    b: above,
                    c: face_index,
                    d: below,
                });
            }
        }
        out
    });

    let quadruple_conditions =
        flat_map_conditions(0..graph.lines.len().saturating_sub(1), |first_line| {
            let mut out = Vec::new();
            let Some((first_a, first_b)) = graph.line_face_border(first_line) else {
                return out;
            };
            if first_a == first_b {
                return out;
            }
            let Some(first_segment) = folded_segments.get(first_line) else {
                return out;
            };
            // Site 1 — the single most important checkpoint in the fold. This
            // loop carries ~85% of setup on a large crease pattern, so a design
            // that polls only the outer search would leave it uninterruptible.
            // Same latch-and-break shape, and same caveat, as site 2 above.
            for second_line in line_tree.collect_potential_collision(first_line) {
                if crate::cancel::check().is_err() {
                    break;
                }
                let Some((second_a, second_b)) = graph.line_face_border(second_line) else {
                    continue;
                };
                if second_a == second_b {
                    continue;
                }
                let Some(second_segment) = folded_segments.get(second_line) else {
                    continue;
                };
                if determine_line_segment_intersection(first_segment, second_segment)
                    .is_segment_overlapping()
                    && subfaces_contain_all(subfaces, [first_a, first_b, second_a, second_b])
                {
                    let (a, b) = normalized_pair(&hierarchy, first_a, first_b);
                    let (c, d) = normalized_pair(&hierarchy, second_a, second_b);
                    out.push(EquivalenceCondition { a, b, c, d });
                }
            }
            out
        });

    // The unwind for sites 1 and 2. Their `break` leaves a partial condition
    // list, and this is what guarantees it is never returned: nothing clears the
    // signal during a run, so a `break` above is always followed by this `Err`.
    crate::cancel::check()?;

    Ok(EquivalenceConditionSet {
        triple_conditions,
        quadruple_conditions,
    })
}

/// Map `range` to per-item equivalence-condition lists and flatten them, in
/// sequential (index) order. On native builds with the `parallel` feature this
/// runs across rayon's thread pool — the fold's condition generation is the
/// dominant single-threaded cost — while the wasm path (and non-feature builds)
/// stay sequential. Order preservation keeps the output byte-identical.
#[cfg(all(feature = "parallel", not(target_arch = "wasm32")))]
fn flat_map_conditions<F>(range: std::ops::Range<usize>, f: F) -> Vec<EquivalenceCondition>
where
    F: Fn(usize) -> Vec<EquivalenceCondition> + Sync + Send,
{
    use rayon::prelude::*;
    // The ONE place a cancel binding crosses a thread boundary. Rayon workers do
    // not inherit thread-locals, so without this the checkpoints inside `f` are
    // silently inert on desktop — in the phase that dominates a long fold. The
    // folding oracle builds *without* `parallel`, so nothing else would catch
    // it; `cargo test -p oristudio-cp --features parallel` is the gate.
    //
    // Captured here, on the thread that owns it, and re-installed per item on
    // whichever worker runs it.
    let handle = crate::cancel::current();
    range
        .into_par_iter()
        .flat_map_iter(|index| {
            let _bound = crate::cancel::bind(handle.clone());
            f(index)
        })
        .collect()
}

#[cfg(not(all(feature = "parallel", not(target_arch = "wasm32"))))]
fn flat_map_conditions<F>(range: std::ops::Range<usize>, f: F) -> Vec<EquivalenceCondition>
where
    F: Fn(usize) -> Vec<EquivalenceCondition>,
{
    range.flat_map(f).collect()
}

fn wireframe_from_graph(
    graph: &FoldGraph,
    face_positions: &FacePositions,
    points: Vec<Point>,
) -> FoldedWireframe {
    FoldedWireframe {
        points,
        lines: graph
            .lines
            .iter()
            .map(|line| FoldedWireframeLine {
                begin: line.begin,
                end: line.end,
                color: line.color,
            })
            .collect(),
        faces: graph.faces.clone(),
        starting_face: face_positions.starting_face,
        face_positions: face_positions.face_position.clone(),
        next_faces: face_positions.next_face.clone(),
        associated_lines: face_positions.associated_line.clone(),
    }
}

fn configure_subfaces(
    folded: &FoldedWireframe,
    subface_graph: &FoldGraph,
) -> Result<SubFaceConfiguration, crate::cancel::Cancelled> {
    let face_polygons = folded_face_polygons(folded);

    let mut frequency = vec![0usize; face_polygons.len()];
    let mut subfaces = Vec::with_capacity(subface_graph.faces.len());
    for subface in &subface_graph.faces {
        // Site 11. The inner scan is over every face, per subface.
        crate::cancel::check()?;
        let inside_point = subface_polygon(subface_graph, subface).inside_point_find();
        let mut face_ids = Vec::new();
        for (face_index, polygon) in face_polygons.iter().enumerate() {
            if polygon.inside(inside_point) == PolygonIntersection::Inside {
                face_ids.push(face_index);
                frequency[face_index] += 1;
            }
        }
        subfaces.push(SubFace { face_ids });
    }

    let face_id_count_max = subfaces
        .iter()
        .map(|subface| subface.face_ids.len())
        .max()
        .unwrap_or(0);
    let reduced_subface_indices = reduce_subface_set(&subfaces, &frequency);

    Ok(SubFaceConfiguration {
        subfaces,
        reduced_subface_indices,
        face_id_count_max,
    })
}

fn folded_face_polygons(folded: &FoldedWireframe) -> Vec<Polygon> {
    folded
        .faces
        .iter()
        .map(|face| {
            Polygon::new(
                face.iter()
                    .filter_map(|point| folded.points.get(*point).copied())
                    .collect(),
            )
        })
        .collect()
}

fn folded_wireframe_segments(folded: &FoldedWireframe) -> Vec<LineSegment> {
    folded
        .lines
        .iter()
        .filter_map(|line| {
            let a = folded.points.get(line.begin).copied()?;
            let b = folded.points.get(line.end).copied()?;
            Some(LineSegment::with_color(a, b, line.color))
        })
        .collect()
}

fn subface_polygon(graph: &FoldGraph, face: &[usize]) -> Polygon {
    Polygon::new(
        face.iter()
            .filter_map(|point| graph.points.get(*point).copied())
            .collect(),
    )
}

fn normalized_pair(hierarchy: &InitialHierarchy, first: usize, second: usize) -> (usize, usize) {
    for relation in &hierarchy.relations {
        if relation.upper_face == first && relation.lower_face == second {
            return (first, second);
        }
        if relation.upper_face == second && relation.lower_face == first {
            return (second, first);
        }
    }
    (first, second)
}

fn subfaces_contain_all(configuration: &SubFaceConfiguration, faces: [usize; 4]) -> bool {
    configuration.reduced_subface_indices.iter().any(|index| {
        configuration
            .subfaces
            .get(*index)
            .is_some_and(|subface| faces.iter().all(|face| subface.face_ids.contains(face)))
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FaceOrder {
    Above,
    Below,
}

/// Dense layer-ordering table, mirroring Oriedita's `SymmetricMatrix`
/// (`HierarchyList`). Cells are stored for the canonical `(lo, hi)` ordering
/// with `lo < hi`; queries with `first > second` flip the result. Backing it
/// with a flat `Vec` (O(1) index, no hashing) instead of a
/// `HashMap<(usize, usize), _>` is the key perf property: the additional-
/// estimation inference performs millions of `get`/`infer_above` calls per
/// pass, and hashing a tuple key each time was the dominant cost.
struct HierarchyTable {
    faces_total: usize,
    /// `faces_total * faces_total` cells. `CELL_ABOVE` at `[lo * n + hi]` means
    /// face `lo` is above face `hi`; `CELL_BELOW` means below; `CELL_NONE` means
    /// no determined relation (covers both "no overlap" and "undetermined",
    /// matching the previous `HashMap` absence semantics).
    cells: Vec<u8>,
}

const CELL_NONE: u8 = 0;
const CELL_ABOVE: u8 = 1;
const CELL_BELOW: u8 = 2;

/// Check that an initial hierarchy is internally consistent.
///
/// [`HierarchyTable::from_initial`] discards `infer_above`'s error with
/// `let _ =`, so a pair seeded both ways silently keeps whichever relation came
/// **first in the vector** and drops the other. On the flat path the seeds come
/// from one pass over the creases and can never disagree, so upstream's
/// behaviour is untouched and unobservable. The 3D path seeds from several
/// independent geometric rules at once, where a disagreement is a real finding
/// and a first-in-vector tie-break is a definite, silent, order-dependent wrong
/// answer — so it asks first.
///
/// **Ori Studio native**, and additive: the flat path keeps calling the
/// unchecked builder.
pub fn validate_initial_hierarchy(
    initial: &InitialHierarchy,
) -> Result<(), AdditionalEstimationError> {
    let mut table = HierarchyTable {
        faces_total: initial.faces_total,
        cells: vec![CELL_NONE; initial.faces_total.saturating_mul(initial.faces_total)],
    };
    for relation in &initial.relations {
        table.infer_above(relation.upper_face, relation.lower_face)?;
    }
    Ok(())
}

impl HierarchyTable {
    fn from_initial(initial: &InitialHierarchy) -> Self {
        crate::fold_profiling::bump_table_from_initial();
        let faces_total = initial.faces_total;
        let mut table = Self {
            faces_total,
            cells: vec![CELL_NONE; faces_total.saturating_mul(faces_total)],
        };
        for relation in &initial.relations {
            let _ = table.infer_above(relation.upper_face, relation.lower_face);
        }
        table
    }

    #[inline]
    fn cell_index(&self, lo: usize, hi: usize) -> Option<usize> {
        if hi >= self.faces_total {
            return None;
        }
        Some(lo * self.faces_total + hi)
    }

    /// True when the pair has no determined relation (Oriedita's `isEmpty`,
    /// covering both its `EMPTY` and `UNKNOWN` states — we collapse both to
    /// "absent").
    #[inline]
    fn is_empty(&self, first: usize, second: usize) -> bool {
        self.get(first, second).is_none()
    }

    /// Raw "set `upper` above `lower`" with no contradiction check. The
    /// `AdditionalEstimationAlgorithm` performs its own `BELOW` check before
    /// calling this (Oriedita's `HierarchyList.set(i, j, ABOVE)`).
    fn set_above(&mut self, upper: usize, lower: usize) {
        let (lo, hi, value) = if upper < lower {
            (upper, lower, CELL_ABOVE)
        } else {
            (lower, upper, CELL_BELOW)
        };
        if let Some(index) = self.cell_index(lo, hi) {
            self.cells[index] = value;
        }
    }

    fn get(&self, first: usize, second: usize) -> Option<FaceOrder> {
        if first == second {
            return None;
        }
        let (lo, hi, flip) = if first < second {
            (first, second, false)
        } else {
            (second, first, true)
        };
        let cell = self.cells[self.cell_index(lo, hi)?];
        match (cell, flip) {
            (CELL_ABOVE, false) | (CELL_BELOW, true) => Some(FaceOrder::Above),
            (CELL_BELOW, false) | (CELL_ABOVE, true) => Some(FaceOrder::Below),
            _ => None,
        }
    }

    fn infer_above(
        &mut self,
        upper: usize,
        lower: usize,
    ) -> Result<bool, AdditionalEstimationError> {
        if upper == lower || self.get(upper, lower) == Some(FaceOrder::Below) {
            return Err(AdditionalEstimationError::Contradiction {
                upper_face: upper,
                lower_face: lower,
            });
        }
        if self.get(upper, lower) == Some(FaceOrder::Above) {
            return Ok(false);
        }

        let (lo, hi, value) = if upper < lower {
            (upper, lower, CELL_ABOVE)
        } else {
            (lower, upper, CELL_BELOW)
        };
        if let Some(index) = self.cell_index(lo, hi) {
            self.cells[index] = value;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn into_initial_hierarchy(self, faces_total: usize) -> InitialHierarchy {
        let mut relations = Vec::new();
        let n = self.faces_total;
        for lo in 0..n {
            let row = lo * n;
            for hi in (lo + 1)..n {
                match self.cells[row + hi] {
                    CELL_ABOVE => relations.push(HierarchyRelation {
                        upper_face: lo,
                        lower_face: hi,
                    }),
                    CELL_BELOW => relations.push(HierarchyRelation {
                        upper_face: hi,
                        lower_face: lo,
                    }),
                    _ => {}
                }
            }
        }
        relations.sort_by_key(|relation| (relation.upper_face, relation.lower_face));
        InitialHierarchy {
            faces_total,
            relations,
        }
    }
}

fn run_additional_estimation(
    table: &mut HierarchyTable,
    subfaces: &SubFaceConfiguration,
    triple_conditions: &[EquivalenceCondition],
    quadruple_conditions: &[EquivalenceCondition],
) -> Result<(), AdditionalEstimationError> {
    crate::fold_profiling::record_estimation_inputs(
        triple_conditions.len() as u64,
        quadruple_conditions.len() as u64,
        subfaces
            .reduced_subface_indices
            .iter()
            .filter_map(|index| subfaces.subfaces.get(*index))
            .map(|subface| subface.face_ids.len())
            .max()
            .unwrap_or(0) as u64,
    );
    crate::fold_profiling::bump_additional_estimation_pass();
    additional_estimation::AdditionalEstimation::new(reduced_subface_face_ids(subfaces)).run(
        table,
        triple_conditions,
        quadruple_conditions,
        0,
    )
}

fn run_additional_estimation_fast(
    table: &mut HierarchyTable,
    subfaces: &SubFaceConfiguration,
    triple_conditions: &[EquivalenceCondition],
    quadruple_conditions: &[EquivalenceCondition],
) -> Result<(), AdditionalEstimationError> {
    crate::fold_profiling::bump_additional_estimation_pass();
    additional_estimation::AdditionalEstimation::new(reduced_subface_face_ids(subfaces)).fast_run(
        table,
        triple_conditions,
        quadruple_conditions,
    )
}

/// Oriedita's `removeMode` AEA round: close the hierarchy and prune every
/// equivalence condition that fires (leaving only the residual needed by the
/// search). Port of `AEA.run` with `removeMode == true`.
fn run_additional_estimation_remove(
    table: &mut HierarchyTable,
    subfaces: &SubFaceConfiguration,
    triple_conditions: &mut Vec<EquivalenceCondition>,
    quadruple_conditions: &mut Vec<EquivalenceCondition>,
) -> Result<(), AdditionalEstimationError> {
    crate::fold_profiling::record_estimation_inputs(
        triple_conditions.len() as u64,
        quadruple_conditions.len() as u64,
        subfaces
            .reduced_subface_indices
            .iter()
            .filter_map(|index| subfaces.subfaces.get(*index))
            .map(|subface| subface.face_ids.len())
            .max()
            .unwrap_or(0) as u64,
    );
    crate::fold_profiling::bump_additional_estimation_pass();
    let result =
        additional_estimation::AdditionalEstimation::new(reduced_subface_face_ids(subfaces))
            .run_with_removal(table, triple_conditions, quadruple_conditions, 0);
    fold_phase_timer!("removeMode reduced conditions");
    #[cfg(all(feature = "fold-profiling", not(target_arch = "wasm32")))]
    eprintln!(
        "  [fold-phase] conditions after removeMode: triple={} quad={}",
        triple_conditions.len(),
        quadruple_conditions.len()
    );
    result
}

/// Global face-id lists for the reduced subfaces, in reduced order — the subface
/// set the additional-estimation algorithm operates over.
fn reduced_subface_face_ids(subfaces: &SubFaceConfiguration) -> Vec<Vec<usize>> {
    subfaces
        .reduced_subface_indices
        .iter()
        .filter_map(|index| subfaces.subfaces.get(*index))
        .map(|subface| subface.face_ids.clone())
        .collect()
}

fn apply_triple_condition(
    table: &mut HierarchyTable,
    condition: EquivalenceCondition,
) -> Result<usize, AdditionalEstimationError> {
    let a = condition.a;
    let b = condition.b;
    let d = condition.d;
    if table.get(a, b) == Some(FaceOrder::Above) {
        return table.infer_above(a, d).map(usize::from);
    }
    if table.get(a, b) == Some(FaceOrder::Below) {
        return table.infer_above(d, a).map(usize::from);
    }
    if table.get(a, d) == Some(FaceOrder::Above) {
        return table.infer_above(a, b).map(usize::from);
    }
    if table.get(a, d) == Some(FaceOrder::Below) {
        return table.infer_above(b, a).map(usize::from);
    }
    Ok(0)
}

fn apply_quadruple_condition(
    table: &mut HierarchyTable,
    condition: EquivalenceCondition,
) -> Result<usize, AdditionalEstimationError> {
    let a = condition.a;
    let b = condition.b;
    let c = condition.c;
    let d = condition.d;
    let mut changes = 0usize;

    if table.get(a, c) == Some(FaceOrder::Above) && table.get(b, d) == Some(FaceOrder::Above) {
        changes += usize::from(table.infer_above(a, d)?);
        changes += usize::from(table.infer_above(b, c)?);
    }
    if table.get(a, d) == Some(FaceOrder::Above) && table.get(b, c) == Some(FaceOrder::Above) {
        changes += usize::from(table.infer_above(a, c)?);
        changes += usize::from(table.infer_above(b, d)?);
    }
    if table.get(a, c) == Some(FaceOrder::Below) && table.get(b, d) == Some(FaceOrder::Below) {
        changes += usize::from(table.infer_above(d, a)?);
        changes += usize::from(table.infer_above(c, b)?);
    }
    if table.get(a, d) == Some(FaceOrder::Below) && table.get(b, c) == Some(FaceOrder::Below) {
        changes += usize::from(table.infer_above(c, a)?);
        changes += usize::from(table.infer_above(d, b)?);
    }
    if table.get(a, c) == Some(FaceOrder::Above) && table.get(c, b) == Some(FaceOrder::Above) {
        changes += usize::from(table.infer_above(a, d)?);
        changes += usize::from(table.infer_above(d, b)?);
    }
    if table.get(a, d) == Some(FaceOrder::Above) && table.get(d, b) == Some(FaceOrder::Above) {
        changes += usize::from(table.infer_above(a, c)?);
        changes += usize::from(table.infer_above(c, b)?);
    }
    if table.get(c, a) == Some(FaceOrder::Above) && table.get(a, d) == Some(FaceOrder::Above) {
        changes += usize::from(table.infer_above(c, b)?);
        changes += usize::from(table.infer_above(b, d)?);
    }
    if table.get(c, b) == Some(FaceOrder::Above) && table.get(b, d) == Some(FaceOrder::Above) {
        changes += usize::from(table.infer_above(c, a)?);
        changes += usize::from(table.infer_above(a, d)?);
    }

    Ok(changes)
}

fn reduce_subface_set(subfaces: &[SubFace], frequency: &[usize]) -> Vec<usize> {
    let mut sorted = (0..subfaces.len()).collect::<Vec<_>>();
    sorted.sort_by(|a, b| {
        subfaces[*b]
            .face_ids
            .len()
            .cmp(&subfaces[*a].face_ids.len())
            .then_with(|| a.cmp(b))
    });

    let mut reduced_indices: Vec<usize> = Vec::new();
    let mut face_to_reduced = HashMap::<usize, Vec<usize>>::new();
    for subface_index in sorted {
        let subface = &subfaces[subface_index];
        if subface.face_ids.is_empty() {
            continue;
        }

        let mut ids = subface.face_ids.clone();
        ids.sort_by(|a, b| {
            frequency
                .get(*a)
                .copied()
                .unwrap_or_default()
                .cmp(&frequency.get(*b).copied().unwrap_or_default())
        });

        let mut is_not_subset = !face_to_reduced.contains_key(&ids[0]);
        if !is_not_subset && let Some(candidates) = face_to_reduced.get(&ids[0]) {
            is_not_subset = !candidates.iter().any(|candidate| {
                let reduced = &subfaces[reduced_indices[*candidate]];
                ids.iter().skip(1).all(|id| reduced.face_ids.contains(id))
            });
        }

        if is_not_subset {
            let reduced_index = reduced_indices.len();
            reduced_indices.push(subface_index);
            for id in ids {
                face_to_reduced.entry(id).or_default().push(reduced_index);
            }
        }
    }

    reduced_indices
}

fn remove_point_segments(segments: &mut Vec<LineSegment>) {
    segments.retain(|segment| !equal(segment.a, segment.b));
}

fn remove_line_segment_set_duplicates(segments: &mut Vec<LineSegment>) {
    let mut remove = vec![false; segments.len()];
    for i in 0..segments.len() {
        let si = &segments[i];
        for j in (i + 1)..segments.len() {
            let sj = &segments[j];
            if (equal_with_radius(si.a, sj.a, Epsilon::UNKNOWN_001)
                && equal_with_radius(si.b, sj.b, Epsilon::UNKNOWN_001))
                || (equal_with_radius(si.a, sj.b, Epsilon::UNKNOWN_001)
                    && equal_with_radius(si.b, sj.a, Epsilon::UNKNOWN_001))
            {
                remove[j] = true;
            }
        }
    }

    *segments = segments
        .iter()
        .enumerate()
        .filter_map(|(index, segment)| (!remove[index]).then_some(segment.clone()))
        .collect();
}
