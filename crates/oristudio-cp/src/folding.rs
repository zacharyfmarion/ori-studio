mod permutation;

use crate::fold_graph::{FacePositions, FoldGraph};
use crate::geometry::{
    Epsilon, LineColor, LineSegment, Point, Polygon, PolygonIntersection, RgbColor,
    determine_line_segment_intersection, equal, equal_with_radius,
};
use crate::model::CreasePatternModel;
use crate::operations::arrangement::divide_intersections;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fmt};

pub use permutation::{
    ChainPermutationGenerator, PermutationError, PermutationSnapshot, SubFacePermutationSearch,
    SubFacePriority, SubFaceSearchError, SubFaceSwapper, WorkerOverlapEnumerator,
    WorkerOverlapSearch, WorkerOverlapSearchError, possible_overlap_search_for_ordered_subfaces,
    possible_overlap_search_for_subfaces, possible_overlap_search_for_subfaces_with_swap,
    prioritize_subfaces,
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
}

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
    pub find_another_overlap_valid: bool,
    pub text_result: String,
    pub wireframe: Option<FoldedWireframe>,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoldingEstimate {
    pub estimation_step: EstimationStep,
    pub display_style: DisplayStyle,
    pub discovered_fold_cases: usize,
    pub find_another_overlap_valid: bool,
    pub text_result: String,
    pub overlap: Option<WorkerOverlapSearch>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoldingEstimateBatch {
    pub estimates: Vec<FoldingEstimate>,
    pub discovered_case_numbers: Vec<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FoldingEstimateError {
    InitialHierarchy(InitialHierarchyError),
    WorkerOverlap(WorkerOverlapSearchError),
}

#[derive(Debug, Clone)]
pub struct FoldingEstimateSession {
    segments: Vec<LineSegment>,
    starting_face_id: i32,
    estimate: FoldingEstimate,
    worker: Option<WorkerOverlapEnumerator>,
}

impl From<InitialHierarchyError> for FoldingEstimateError {
    fn from(error: InitialHierarchyError) -> Self {
        Self::InitialHierarchy(error)
    }
}

impl From<WorkerOverlapSearchError> for FoldingEstimateError {
    fn from(error: WorkerOverlapSearchError) -> Self {
        Self::WorkerOverlap(error)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdditionalEstimationError {
    InitialHierarchy(InitialHierarchyError),
    Contradiction {
        upper_face: usize,
        lower_face: usize,
    },
}

impl From<InitialHierarchyError> for AdditionalEstimationError {
    fn from(error: InitialHierarchyError) -> Self {
        Self::InitialHierarchy(error)
    }
}

/// Oriedita `WireFrame_Worker.folding()`: fold the line-set topology around a
/// starting face without solving layer overlap.
pub fn estimate_wireframe(
    model: &CreasePatternModel,
    starting_face_id: i32,
) -> Option<FoldedWireframe> {
    if model.line_segments.is_empty() {
        return None;
    }

    estimate_wireframe_from_segments(&model.line_segments, starting_face_id)
}

pub fn estimate_wireframe_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Option<FoldedWireframe> {
    if segments.is_empty() {
        return None;
    }

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return None;
    }

    let face_positions = graph.face_positions(starting_face_id);
    Some(wireframe_from_graph(
        &graph,
        &face_positions,
        graph.folded_points(&face_positions),
    ))
}

/// Oriedita `WireFrame_Worker.getFacePositions()`: compute face adjacency
/// depth without moving vertices. This is used by Oriedita's two-colored CP
/// path before later subface/hierarchy stages.
pub fn face_position_wireframe_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Option<FoldedWireframe> {
    if segments.is_empty() {
        return None;
    }

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return None;
    }

    let face_positions = graph.face_positions(starting_face_id);
    Some(wireframe_from_graph(
        &graph,
        &face_positions,
        graph.points.clone(),
    ))
}

/// Oriedita `LineSegmentSetWorker.split_arrangement_for_SubFace_generation()`.
///
/// This is the folded-model preprocessing pass before subface generation:
/// remove point-like line segments, remove duplicate endpoint-identical
/// segments with Oriedita's `UNKNOWN_001` tolerance, divide all intersections,
/// and run the point/duplicate cleanup again.
pub fn prepare_subface_segments(segments: &[LineSegment]) -> Vec<LineSegment> {
    let mut model = CreasePatternModel {
        line_segments: segments.to_vec(),
        ..CreasePatternModel::default()
    };
    remove_point_segments(&mut model.line_segments);
    remove_line_segment_set_duplicates(&mut model.line_segments);
    divide_intersections(&mut model);
    remove_point_segments(&mut model.line_segments);
    remove_line_segment_set_duplicates(&mut model.line_segments);
    model.line_segments
}

pub fn folded_subface_figure_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Option<FoldedSubfaceFigure> {
    if segments.is_empty() {
        return None;
    }

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return None;
    }

    let positions = graph.face_positions(starting_face_id);
    let folded = wireframe_from_graph(&graph, &positions, graph.folded_points(&positions));
    let folded_segments = folded_wireframe_segments(&folded);
    let prepared_segments = prepare_subface_segments(&folded_segments);
    let subface_graph = FoldGraph::from_segments(&prepared_segments, true);
    if subface_graph.faces.is_empty() {
        return None;
    }

    Some(FoldedSubfaceFigure {
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
    })
}

/// Oriedita two-color CP preparation through
/// `FoldedFigure.folding_estimated_02col()` and stage 03. Unlike normal folding
/// estimation, this keeps the original development-view coordinates and uses
/// only face-position topology before generating the subdivided subface
/// arrangement.
pub fn two_colored_subface_segments_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Option<Vec<LineSegment>> {
    let wireframe = face_position_wireframe_from_segments(segments, starting_face_id)?;
    let wireframe_segments = folded_wireframe_segments(&wireframe);
    Some(prepare_subface_segments(&wireframe_segments))
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
        find_another_overlap_valid: false,
        text_result: String::new(),
        overlap: None,
    };

    if segments.is_empty() {
        return Ok(estimate);
    }

    estimate.estimation_step = EstimationStep::Step1;
    estimate.display_style = DisplayStyle::Development1;
    if face_position_wireframe_from_segments(segments, starting_face_id).is_some() {
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
) -> Option<SubFaceConfiguration> {
    let folded = estimate_wireframe_from_segments(segments, starting_face_id)?;
    let folded_segments = folded_wireframe_segments(&folded);
    let prepared_segments = prepare_subface_segments(&folded_segments);
    let subface_graph = FoldGraph::from_segments(&prepared_segments, true);
    if subface_graph.faces.is_empty() {
        return None;
    }

    Some(configure_subfaces(&folded, &subface_graph))
}

/// Oriedita `FoldedFigure_Configurator.setupHierarchyList()` initial
/// mountain/valley-derived face order table.
pub fn initial_hierarchy_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<InitialHierarchy>, InitialHierarchyError> {
    if segments.is_empty() {
        return Ok(None);
    }

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return Ok(None);
    }

    let positions = graph.face_positions(starting_face_id);
    initial_hierarchy_from_graph(&graph, &positions).map(Some)
}

/// Oriedita equivalence-condition discovery from
/// `FoldedFigure_Configurator.setupEquivalenceConditions()` and
/// `setupUEquivalenceConditions()`, before AEA inference consumes conditions.
pub fn equivalence_condition_candidates_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Option<EquivalenceConditionSet>, InitialHierarchyError> {
    if segments.is_empty() {
        return Ok(None);
    }

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return Ok(None);
    }

    let positions = graph.face_positions(starting_face_id);
    let hierarchy = initial_hierarchy_from_graph(&graph, &positions)?;
    let folded = wireframe_from_graph(&graph, &positions, graph.folded_points(&positions));
    let folded_segments = folded_wireframe_segments(&folded);
    let prepared_segments = prepare_subface_segments(&folded_segments);
    let subface_graph = FoldGraph::from_segments(&prepared_segments, true);
    let subfaces = if subface_graph.faces.is_empty() {
        SubFaceConfiguration {
            subfaces: Vec::new(),
            reduced_subface_indices: Vec::new(),
            face_id_count_max: 0,
        }
    } else {
        configure_subfaces(&folded, &subface_graph)
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

    let positions = graph.face_positions(starting_face_id);
    let initial = initial_hierarchy_from_graph(&graph, &positions)?;
    let folded = wireframe_from_graph(&graph, &positions, graph.folded_points(&positions));
    let folded_segments = folded_wireframe_segments(&folded);
    let prepared_segments = prepare_subface_segments(&folded_segments);
    let subface_graph = FoldGraph::from_segments(&prepared_segments, true);
    if subface_graph.faces.is_empty() {
        return Ok(Some(AdditionalEstimation {
            hierarchy: initial,
            triple_conditions: Vec::new(),
            quadruple_conditions: Vec::new(),
        }));
    }

    let subfaces = configure_subfaces(&folded, &subface_graph);
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
                find_another_overlap_valid: false,
                text_result: String::new(),
                overlap: None,
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
    pub fn folding_estimated(
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
            && estimate_wireframe_from_segments(&self.segments, self.starting_face_id).is_some()
        {
            self.estimate.estimation_step = EstimationStep::Step2;
            self.estimate.display_style = DisplayStyle::Wire2;
        }
        if self.estimate.estimation_step == EstimationStep::Step2
            && order.is_at_least(EstimationOrder::Order3)
            && configure_subfaces_from_segments(&self.segments, self.starting_face_id).is_some()
        {
            self.estimate.estimation_step = EstimationStep::Step3;
            self.estimate.display_style = DisplayStyle::Transparent3;
        }
        if self.estimate.estimation_step == EstimationStep::Step3
            && order.is_at_least(EstimationOrder::Order4)
        {
            self.worker = overlap_enumerator_from_segments(&self.segments, self.starting_face_id)?;
            self.estimate.estimation_step = EstimationStep::Step4;
            self.estimate.display_style = DisplayStyle::Development4;
            self.estimate.find_another_overlap_valid = self.worker.is_some();
            self.estimate.discovered_fold_cases = 0;
        }
        if self.estimate.estimation_step == EstimationStep::Step4
            && order.is_at_least(EstimationOrder::Order5)
        {
            self.folding_estimated_05()?;
            self.estimate.estimation_step = EstimationStep::Step5;
            self.estimate.display_style = DisplayStyle::Paper5;
            if self.estimate.discovered_fold_cases == 0 && !self.estimate.find_another_overlap_valid
            {
                self.estimate.estimation_step = EstimationStep::Step3;
                self.estimate.display_style = DisplayStyle::Transparent3;
            }
        }
        if self.estimate.estimation_step == EstimationStep::Step5
            && order == EstimationOrder::Order6
        {
            self.folding_estimated_05()?;
            self.estimate.display_style = DisplayStyle::Paper5;
        }

        Ok(self.estimate.clone())
    }

    fn folding_estimated_05(&mut self) -> Result<(), WorkerOverlapSearchError> {
        run_folding_estimated_05(&mut self.estimate, self.worker.as_mut())
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

pub fn fold_another(
    session: &mut FoldingEstimateSession,
) -> Result<FoldingEstimate, FoldingEstimateError> {
    session.folding_estimated(EstimationOrder::Order6)
}

/// Oriedita `FoldingEstimateSpecificTask` without UI timing/dirty-state
/// side-effects: run a reusable folded figure until the requested discovered
/// case count is reached or no later overlap exists.
pub fn folding_estimate_to_case(
    session: &mut FoldingEstimateSession,
    objective: usize,
    initial_order: EstimationOrder,
) -> Result<FoldingEstimateBatch, FoldingEstimateError> {
    if objective == session.estimate.discovered_fold_cases {
        session.estimate.text_result = format!(
            "Number of found solutions = {}  ",
            session.estimate.discovered_fold_cases
        );
    }

    let mut estimates = Vec::new();
    let mut discovered_case_numbers = Vec::new();
    let mut order = initial_order;
    while objective > session.estimate.discovered_fold_cases {
        let estimate = session.folding_estimated(order)?;
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
        let estimate = session.folding_estimated(EstimationOrder::Order6)?;
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
    let wireframe = if estimate.estimation_step.is_at_least(EstimationStep::Step2) {
        estimate_wireframe_from_segments(&session.segments, session.starting_face_id)
    } else {
        None
    };
    FoldedFigureSnapshot {
        model,
        estimation_step: estimate.estimation_step,
        display_style: estimate.display_style,
        discovered_fold_cases: estimate.discovered_fold_cases,
        find_another_overlap_valid: estimate.find_another_overlap_valid,
        text_result: estimate.text_result.clone(),
        wireframe,
    }
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

pub fn folded_figure_paper_render_snapshot_from_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
    model: FoldedFigureModel,
) -> Result<Option<FoldedFigureRenderSnapshot>, FoldingEstimateError> {
    if segments.is_empty() {
        return Ok(None);
    }

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return Ok(None);
    }

    let positions = graph.face_positions(starting_face_id);
    let folded = wireframe_from_graph(&graph, &positions, graph.folded_points(&positions));
    let folded_segments = folded_wireframe_segments(&folded);
    let prepared_segments = prepare_subface_segments(&folded_segments);
    let subface_graph = FoldGraph::from_segments(&prepared_segments, true);
    if subface_graph.faces.is_empty() {
        return Ok(None);
    }
    let subfaces = configure_subfaces(&folded, &subface_graph);

    let Some(mut enumerator) = overlap_enumerator_from_segments(segments, starting_face_id)? else {
        return Ok(None);
    };
    let overlap = enumerator.possible_overlapping_search(true)?;
    if !overlap.found {
        return Ok(None);
    }
    let Some(pass_name) = paper_render_pass_name(model.state) else {
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
        ),
    }))
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

    let graph = FoldGraph::from_segments(segments, true);
    if graph.faces.is_empty() {
        return Ok(None);
    }

    let positions = graph.face_positions(starting_face_id);
    let initial = initial_hierarchy_from_graph(&graph, &positions)?;
    let folded = wireframe_from_graph(&graph, &positions, graph.folded_points(&positions));
    let folded_segments = folded_wireframe_segments(&folded);
    let prepared_segments = prepare_subface_segments(&folded_segments);
    let subface_graph = FoldGraph::from_segments(&prepared_segments, true);
    if subface_graph.faces.is_empty() {
        return WorkerOverlapEnumerator::from_ordered_subfaces(&[], &[], 0, &initial, None)
            .map(Some);
    }

    let subfaces = configure_subfaces(&folded, &subface_graph);
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

    let positions = graph.face_positions(starting_face_id);
    let initial = initial_hierarchy_from_graph(&graph, &positions)?;
    let folded = wireframe_from_graph(&graph, &positions, graph.points.clone());
    let folded_segments = folded_wireframe_segments(&folded);
    let prepared_segments = prepare_subface_segments(&folded_segments);
    let subface_graph = FoldGraph::from_segments(&prepared_segments, true);
    if subface_graph.faces.is_empty() {
        return WorkerOverlapEnumerator::from_ordered_subfaces(&[], &[], 0, &initial, None)
            .map(Some);
    }

    let subfaces = configure_subfaces(&folded, &subface_graph);
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
    fn folded_front(model: &FoldedFigureModel) -> Self {
        Self {
            camera_position: Point::origin(),
            angle_degrees: model.rotation,
            mirror: 1.0,
            zoom_x: model.scale,
            zoom_y: model.scale,
            display_position: Point::new(20.0, 20.0),
        }
    }

    fn folded_rear(model: &FoldedFigureModel) -> Self {
        Self {
            camera_position: Point::origin(),
            angle_degrees: model.rotation,
            mirror: -1.0,
            zoom_x: model.scale,
            zoom_y: model.scale,
            display_position: Point::new(40.0, 20.0),
        }
    }

    fn object_to_tv(self, point: Point) -> Point {
        let radians = self.angle_degrees * (3.14159265 / 180.0);
        let sin = radians.sin();
        let cos = radians.cos();
        let x1 = point.x - self.camera_position.x;
        let y1 = point.y - self.camera_position.y;
        let mut x2 = cos * x1 + sin * y1;
        let mut y2 = -sin * x1 + cos * y1;
        x2 *= self.mirror;
        x2 *= self.zoom_x;
        y2 *= self.zoom_y;
        recorded_point(Point::new(
            x2 + self.display_position.x,
            y2 + self.display_position.y,
        ))
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
}

fn recorded_point(point: Point) -> Point {
    Point::new(recorded_f64(point.x), recorded_f64(point.y))
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
}

impl Default for OrieditaRenderState {
    fn default() -> Self {
        Self {
            stroke: default_java2d_stroke(),
        }
    }
}

fn paper_render_pass_name(state: FoldedFigureState) -> Option<&'static str> {
    match state {
        FoldedFigureState::Front0 => Some("paper-front"),
        FoldedFigureState::Back1 => Some("paper-back"),
        FoldedFigureState::Both2 => Some("paper-both"),
        FoldedFigureState::Transparent3 => None,
    }
}

fn paper_render_passes(
    state: FoldedFigureState,
    model: &FoldedFigureModel,
    flat_points: &[Point],
    folded_points: &[Point],
) -> Option<Vec<OrieditaPaperRenderPass>> {
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

    match state {
        FoldedFigureState::Front0 => Some(vec![front]),
        FoldedFigureState::Back1 => Some(vec![rear]),
        FoldedFigureState::Both2 => Some(vec![front, rear]),
        FoldedFigureState::Transparent3 => None,
    }
}

fn paper_render_primitives(
    flat_graph: &FoldGraph,
    folded: &FoldedWireframe,
    subface_graph: &FoldGraph,
    subfaces: &SubFaceConfiguration,
    hierarchy: &InitialHierarchy,
    model: &FoldedFigureModel,
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
            pass,
            &mut render_state,
            &mut primitives,
        );
    }

    primitives
}

fn push_paper_render_pass_primitives(
    subface_graph: &FoldGraph,
    folded: &FoldedWireframe,
    subfaces: &SubFaceConfiguration,
    hierarchy: &HierarchyTable,
    model: &FoldedFigureModel,
    pass: OrieditaPaperRenderPass,
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
        render_state.stroke = folded_line_stroke(model);
        primitives.push(FoldedFigureRenderPrimitive {
            sequence: primitives.len(),
            kind: FoldedFigureRenderPrimitiveKind::StrokePath,
            style: FoldedFigureRenderStyle {
                paint: FoldedFigureRenderPaint::Color {
                    color: RgbaColor::from_rgb(model.line_color),
                },
                stroke: render_state.stroke.clone(),
                antialias: if model.anti_alias {
                    FoldedFigureRenderAntialias::On
                } else {
                    FoldedFigureRenderAntialias::Off
                },
            },
            geometry: FoldedFigureRenderGeometry::Path {
                commands: open_path_commands(&points),
            },
        });
    }
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
    for (line_index, line) in graph.lines.iter().enumerate() {
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
                && subfaces_contain_all(subfaces, [first_a, first_b, second_a, second_b])
            {
                let (a, b) = normalized_pair(&hierarchy, first_a, first_b);
                let (c, d) = normalized_pair(&hierarchy, second_a, second_b);
                quadruple_conditions.push(EquivalenceCondition { a, b, c, d });
            }
        }
    }

    Ok(EquivalenceConditionSet {
        triple_conditions,
        quadruple_conditions,
    })
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

fn configure_subfaces(folded: &FoldedWireframe, subface_graph: &FoldGraph) -> SubFaceConfiguration {
    let face_polygons = folded_face_polygons(folded);

    let mut frequency = vec![0usize; face_polygons.len()];
    let mut subfaces = Vec::with_capacity(subface_graph.faces.len());
    for subface in &subface_graph.faces {
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

    SubFaceConfiguration {
        subfaces,
        reduced_subface_indices,
        face_id_count_max,
    }
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

struct HierarchyTable {
    order: HashMap<(usize, usize), FaceOrder>,
}

impl HierarchyTable {
    fn from_initial(initial: &InitialHierarchy) -> Self {
        let mut table = Self {
            order: HashMap::new(),
        };
        for relation in &initial.relations {
            let _ = table.infer_above(relation.upper_face, relation.lower_face);
        }
        table
    }

    fn get(&self, first: usize, second: usize) -> Option<FaceOrder> {
        if first == second {
            return None;
        }
        if first < second {
            self.order.get(&(first, second)).copied()
        } else {
            self.order.get(&(second, first)).map(|order| match order {
                FaceOrder::Above => FaceOrder::Below,
                FaceOrder::Below => FaceOrder::Above,
            })
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

        if upper < lower {
            self.order.insert((upper, lower), FaceOrder::Above);
        } else {
            self.order.insert((lower, upper), FaceOrder::Below);
        }
        Ok(true)
    }

    fn into_initial_hierarchy(self, faces_total: usize) -> InitialHierarchy {
        let mut relations = self
            .order
            .into_iter()
            .map(|((first, second), order)| match order {
                FaceOrder::Above => HierarchyRelation {
                    upper_face: first,
                    lower_face: second,
                },
                FaceOrder::Below => HierarchyRelation {
                    upper_face: second,
                    lower_face: first,
                },
            })
            .collect::<Vec<_>>();
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
    loop {
        let mut changes = 0usize;
        changes += infer_subface_transitivity(table, subfaces)?;
        for condition in triple_conditions {
            changes += apply_triple_condition(table, *condition)?;
        }
        for condition in quadruple_conditions {
            changes += apply_quadruple_condition(table, *condition)?;
        }
        if changes == 0 {
            return Ok(());
        }
    }
}

fn run_additional_estimation_fast(
    table: &mut HierarchyTable,
    subfaces: &SubFaceConfiguration,
    triple_conditions: &[EquivalenceCondition],
    quadruple_conditions: &[EquivalenceCondition],
) -> Result<(), AdditionalEstimationError> {
    infer_subface_transitivity(table, subfaces)?;
    for condition in triple_conditions {
        apply_triple_condition(table, *condition)?;
    }
    for condition in quadruple_conditions {
        apply_quadruple_condition(table, *condition)?;
    }
    Ok(())
}

fn infer_subface_transitivity(
    table: &mut HierarchyTable,
    subfaces: &SubFaceConfiguration,
) -> Result<usize, AdditionalEstimationError> {
    let mut changes = 0usize;
    for subface_index in &subfaces.reduced_subface_indices {
        let Some(subface) = subfaces.subfaces.get(*subface_index) else {
            continue;
        };
        for upper in &subface.face_ids {
            for middle in &subface.face_ids {
                if table.get(*upper, *middle) != Some(FaceOrder::Above) {
                    continue;
                }
                for lower in &subface.face_ids {
                    if table.get(*middle, *lower) == Some(FaceOrder::Above)
                        && table.infer_above(*upper, *lower)?
                    {
                        changes += 1;
                    }
                }
            }
        }
    }
    Ok(changes)
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
