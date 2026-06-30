use super::{IoError, Result};
use crate::CreasePatternDocument;
use crate::geometry::{ActiveState, Circle, LineColor, LineSegment, Point, RgbColor};
use crate::model::{CreasePatternModel, GridState, TextElement, custom_color_hex};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

pub const ORI_VERSION: &str = "v1.1";
pub const ORI_METADATA_PREFIX: &str = "oriedita:ori:";
pub const ORI_CREASE_PATTERN_CAMERA_FIELD: &str = "creasePatternCamera";
pub const ORI_CANVAS_MODEL_FIELD: &str = "canvasModel";
pub const ORI_FOLDED_FIGURE_MODEL_FIELD: &str = "foldedFigureModel";
pub const ORI_APPLICATION_MODEL_FIELD: &str = "applicationModel";

const ORI_EDITOR_MODEL_FIELDS: &[&str] = &[
    ORI_CREASE_PATTERN_CAMERA_FIELD,
    ORI_CANVAS_MODEL_FIELD,
    ORI_FOLDED_FIGURE_MODEL_FIELD,
    ORI_APPLICATION_MODEL_FIELD,
];
const KNOWN_TOP_LEVEL_FIELDS: &[&str] = &[
    "@version",
    "lineSegments",
    "circles",
    "texts",
    "title",
    "points",
    "auxLineSegments",
    "gridModel",
];

/// Oriedita editor save-model fields carried losslessly alongside editable CP
/// geometry until each model gets a native Rust representation.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct OrieditaEditorModels {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crease_pattern_camera: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvas_model: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folded_figure_model: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application_model: Option<Value>,
}

impl OrieditaEditorModels {
    pub fn from_document(document: &CreasePatternDocument) -> Self {
        Self {
            crease_pattern_camera: ori_metadata_field(document, ORI_CREASE_PATTERN_CAMERA_FIELD)
                .cloned(),
            canvas_model: ori_metadata_field(document, ORI_CANVAS_MODEL_FIELD).cloned(),
            folded_figure_model: ori_metadata_field(document, ORI_FOLDED_FIGURE_MODEL_FIELD)
                .cloned(),
            application_model: ori_metadata_field(document, ORI_APPLICATION_MODEL_FIELD).cloned(),
        }
    }

    pub fn apply_to_document(self, document: &mut CreasePatternDocument) {
        replace_ori_metadata_field(
            document,
            ORI_CREASE_PATTERN_CAMERA_FIELD,
            self.crease_pattern_camera,
        );
        replace_ori_metadata_field(document, ORI_CANVAS_MODEL_FIELD, self.canvas_model);
        replace_ori_metadata_field(
            document,
            ORI_FOLDED_FIGURE_MODEL_FIELD,
            self.folded_figure_model,
        );
        replace_ori_metadata_field(
            document,
            ORI_APPLICATION_MODEL_FIELD,
            self.application_model,
        );
    }

    pub fn is_empty(&self) -> bool {
        self.crease_pattern_camera.is_none()
            && self.canvas_model.is_none()
            && self.folded_figure_model.is_none()
            && self.application_model.is_none()
    }
}

pub fn ori_metadata_key(field: &str) -> String {
    format!("{ORI_METADATA_PREFIX}{field}")
}

pub fn ori_metadata_field<'a>(
    document: &'a CreasePatternDocument,
    field: &str,
) -> Option<&'a Value> {
    document.metadata.get(&ori_metadata_key(field))
}

pub fn set_ori_metadata_field(document: &mut CreasePatternDocument, field: &str, value: Value) {
    document.metadata.insert(ori_metadata_key(field), value);
}

pub fn clear_ori_metadata_field(document: &mut CreasePatternDocument, field: &str) {
    document.metadata.remove(&ori_metadata_key(field));
}

pub fn replace_ori_metadata_field(
    document: &mut CreasePatternDocument,
    field: &str,
    value: Option<Value>,
) {
    match value {
        Some(value) => set_ori_metadata_field(document, field, value),
        None => clear_ori_metadata_field(document, field),
    }
}

pub fn is_ori_editor_model_field(field: &str) -> bool {
    ORI_EDITOR_MODEL_FIELDS.contains(&field)
}

/// Import an Oriedita `.ori` JSON save file.
///
/// Oriedita prompts before opening unknown/newer save versions. This strict
/// entry point mirrors the non-confirming path by accepting only versions that
/// are source-mapped in this crate.
pub fn import_ori_json(input: &str) -> Result<CreasePatternDocument> {
    import_ori_json_with_unknown_version(input, false)
}

/// Import an Oriedita `.ori` JSON save file, optionally accepting unknown
/// version tags as if the user chose Oriedita's "open anyway" prompt.
pub fn import_ori_json_with_unknown_version(
    input: &str,
    accept_unknown_version: bool,
) -> Result<CreasePatternDocument> {
    let root = serde_json::from_str::<Value>(input)?;
    let object = root.as_object().ok_or_else(|| IoError::InvalidField {
        field: "ori",
        message: "expected JSON object".to_string(),
    })?;

    validate_version(object.get("@version"), accept_unknown_version)?;

    let mut document = CreasePatternDocument {
        title: string_field(object, "title")?.map(ToOwned::to_owned),
        crease_pattern: CreasePatternModel::default(),
        metadata: Default::default(),
        ..CreasePatternDocument::default()
    };

    document.crease_pattern.line_segments = line_segment_array(object, "lineSegments")?;
    document.crease_pattern.circles = circle_array(object, "circles")?;
    document.crease_pattern.texts = text_array(object, "texts")?;
    document.crease_pattern.points = point_string_array(object, "points")?;
    document.crease_pattern.aux_line_segments = line_segment_array(object, "auxLineSegments")?;

    if let Some(grid) = object.get("gridModel") {
        document.crease_pattern.grid = parse_grid(grid)?;
    }

    for (key, value) in object {
        if !KNOWN_TOP_LEVEL_FIELDS.contains(&key.as_str()) {
            document
                .metadata
                .insert(format!("{ORI_METADATA_PREFIX}{key}"), value.clone());
        }
    }

    Ok(document)
}

/// Export an Oriedita `.ori` JSON save file.
pub fn export_ori_json(document: &CreasePatternDocument) -> Result<String> {
    let mut object = Map::new();

    for (key, value) in &document.metadata {
        if let Some(ori_key) = key.strip_prefix(ORI_METADATA_PREFIX)
            && !KNOWN_TOP_LEVEL_FIELDS.contains(&ori_key)
        {
            object.insert(ori_key.to_string(), value.clone());
        }
    }

    object.insert(
        "@version".to_string(),
        Value::String(ORI_VERSION.to_string()),
    );
    object.insert(
        "lineSegments".to_string(),
        Value::Array(
            document
                .crease_pattern
                .line_segments
                .iter()
                .map(export_line_segment)
                .collect(),
        ),
    );
    object.insert(
        "circles".to_string(),
        Value::Array(
            document
                .crease_pattern
                .circles
                .iter()
                .map(export_circle)
                .collect(),
        ),
    );
    object.insert(
        "texts".to_string(),
        Value::Array(
            document
                .crease_pattern
                .texts
                .iter()
                .map(export_text)
                .collect(),
        ),
    );
    object.insert(
        "title".to_string(),
        Value::String(document.title.clone().unwrap_or_else(|| "_".to_string())),
    );
    object.insert(
        "points".to_string(),
        Value::Array(
            document
                .crease_pattern
                .points
                .iter()
                .map(|point| Value::String(export_point_string(*point)))
                .collect(),
        ),
    );
    object.insert(
        "auxLineSegments".to_string(),
        Value::Array(
            document
                .crease_pattern
                .aux_line_segments
                .iter()
                .map(export_line_segment)
                .collect(),
        ),
    );
    object.insert(
        "gridModel".to_string(),
        export_grid(document.crease_pattern.grid),
    );

    Ok(serde_json::to_string_pretty(&Value::Object(object))?)
}

fn validate_version(version: Option<&Value>, accept_unknown_version: bool) -> Result<()> {
    match version.and_then(Value::as_str) {
        Some("v1" | "v1.1") => Ok(()),
        _ if accept_unknown_version => Ok(()),
        Some(value) => Err(IoError::InvalidField {
            field: "@version",
            message: format!("unsupported .ori version {value:?}"),
        }),
        None => Err(IoError::InvalidField {
            field: "@version",
            message: "missing .ori version; use permissive import to mirror Oriedita's open-anyway prompt".to_string(),
        }),
    }
}

fn line_segment_array(
    object: &Map<String, Value>,
    field: &'static str,
) -> Result<Vec<LineSegment>> {
    let Some(value) = object.get(field) else {
        return Ok(Vec::new());
    };
    let array = value.as_array().ok_or_else(|| IoError::InvalidField {
        field,
        message: "expected array".to_string(),
    })?;
    array.iter().map(parse_line_segment).collect()
}

fn parse_line_segment(value: &Value) -> Result<LineSegment> {
    let object = value.as_object().ok_or_else(|| IoError::InvalidField {
        field: "lineSegments",
        message: "expected line segment object".to_string(),
    })?;

    let mut segment = LineSegment::with_color_and_active(
        parse_point_string(required_string(object, "a")?, "a")?,
        parse_point_string(required_string(object, "b")?, "b")?,
        parse_line_color(required_string(object, "color")?)?,
        parse_active_state(required_string(object, "active")?)?,
    );
    segment.selected = integer_field(object, "selected")?.unwrap_or_default();
    segment.customized = integer_field(object, "customized")?.unwrap_or_default();
    segment.customized_color =
        color_field(object, "customizedColor")?.unwrap_or_else(default_color);

    Ok(segment)
}

fn export_line_segment(segment: &LineSegment) -> Value {
    json!({
        "a": export_point_string(segment.a),
        "b": export_point_string(segment.b),
        "active": active_state_name(segment.active),
        "color": line_color_name(segment.color),
        "customized": segment.customized,
        "customizedColor": export_argb_hex(segment.customized_color),
        "selected": segment.selected,
    })
}

fn circle_array(object: &Map<String, Value>, field: &'static str) -> Result<Vec<Circle>> {
    let Some(value) = object.get(field) else {
        return Ok(Vec::new());
    };
    let array = value.as_array().ok_or_else(|| IoError::InvalidField {
        field,
        message: "expected array".to_string(),
    })?;
    array.iter().map(parse_circle).collect()
}

fn parse_circle(value: &Value) -> Result<Circle> {
    let object = value.as_object().ok_or_else(|| IoError::InvalidField {
        field: "circles",
        message: "expected circle object".to_string(),
    })?;
    let mut circle = Circle::new(
        required_number(object, "x")?,
        required_number(object, "y")?,
        required_number(object, "r")?,
        parse_line_color(required_string(object, "color")?)?,
    );
    circle.customized = integer_field(object, "customized")?.unwrap_or_default();
    circle.customized_color = color_field(object, "customizedColor")?.unwrap_or_else(default_color);
    Ok(circle)
}

fn export_circle(circle: &Circle) -> Value {
    json!({
        "x": circle.x,
        "y": circle.y,
        "r": circle.r,
        "color": line_color_name(circle.color),
        "customized": circle.customized,
        "customizedColor": export_argb_hex(circle.customized_color),
    })
}

fn text_array(object: &Map<String, Value>, field: &'static str) -> Result<Vec<TextElement>> {
    let Some(value) = object.get(field) else {
        return Ok(Vec::new());
    };
    let array = value.as_array().ok_or_else(|| IoError::InvalidField {
        field,
        message: "expected array".to_string(),
    })?;
    array.iter().map(parse_text).collect()
}

fn parse_text(value: &Value) -> Result<TextElement> {
    let object = value.as_object().ok_or_else(|| IoError::InvalidField {
        field: "texts",
        message: "expected text object".to_string(),
    })?;
    Ok(TextElement::new(
        required_number(object, "x")?,
        required_number(object, "y")?,
        required_string(object, "text")?,
    ))
}

fn export_text(text: &TextElement) -> Value {
    json!({
        "x": text.x.0,
        "y": text.y.0,
        "text": text.text,
    })
}

fn point_string_array(object: &Map<String, Value>, field: &'static str) -> Result<Vec<Point>> {
    let Some(value) = object.get(field) else {
        return Ok(Vec::new());
    };
    let array = value.as_array().ok_or_else(|| IoError::InvalidField {
        field,
        message: "expected array".to_string(),
    })?;
    array
        .iter()
        .map(|value| {
            let string = value.as_str().ok_or_else(|| IoError::InvalidField {
                field,
                message: "expected point string array".to_string(),
            })?;
            parse_point_string(string, field)
        })
        .collect()
}

fn parse_grid(value: &Value) -> Result<crate::model::GridMetadata> {
    let object = value.as_object().ok_or_else(|| IoError::InvalidField {
        field: "gridModel",
        message: "expected grid object".to_string(),
    })?;
    let mut grid = crate::model::GridMetadata::default();

    if let Some(value) = integer_field(object, "intervalGridSize")? {
        grid.set_interval_grid_size(value);
    }
    if let Some(value) = integer_field(object, "gridSize")? {
        grid.set_grid_size(value);
    }
    if let Some(value) = number_field(object, "gridXA")? {
        grid.grid_xa = value;
    }
    if let Some(value) = number_field(object, "gridXB")? {
        grid.grid_xb = value;
    }
    if let Some(value) = number_field(object, "gridXC")? {
        grid.grid_xc = value.max(0.0);
    }
    if let Some(value) = number_field(object, "gridYA")? {
        grid.grid_ya = value;
    }
    if let Some(value) = number_field(object, "gridYB")? {
        grid.grid_yb = value;
    }
    if let Some(value) = number_field(object, "gridYC")? {
        grid.grid_yc = value.max(0.0);
    }
    if let Some(value) = number_field(object, "gridAngle")? {
        grid.set_grid_angle(value);
    }
    if let Some(value) = string_field(object, "baseState")? {
        grid.base_state = parse_grid_state(value)?;
    }
    if let Some(value) = integer_field(object, "verticalScalePosition")? {
        grid.vertical_scale_position = value;
    }
    if let Some(value) = integer_field(object, "horizontalScalePosition")? {
        grid.horizontal_scale_position = value;
    }
    if let Some(value) = boolean_field(object, "drawDiagonalGridlines")? {
        grid.draw_diagonal_gridlines = value;
    }

    let x = (grid.grid_xa, grid.grid_xb, grid.grid_xc);
    grid.apply_grid_x(x.0, x.1, x.2);
    let y = (grid.grid_ya, grid.grid_yb, grid.grid_yc);
    grid.apply_grid_y(y.0, y.1, y.2);

    Ok(grid)
}

fn export_grid(grid: crate::model::GridMetadata) -> Value {
    json!({
        "intervalGridSize": grid.interval_grid_size,
        "gridSize": grid.grid_size,
        "gridXA": grid.grid_xa,
        "gridXB": grid.grid_xb,
        "gridXC": grid.grid_xc,
        "gridYA": grid.grid_ya,
        "gridYB": grid.grid_yb,
        "gridYC": grid.grid_yc,
        "gridAngle": grid.grid_angle,
        "baseState": grid_state_name(grid.base_state),
        "verticalScalePosition": grid.vertical_scale_position,
        "horizontalScalePosition": grid.horizontal_scale_position,
        "drawDiagonalGridlines": grid.draw_diagonal_gridlines,
    })
}

fn required_string<'a>(object: &'a Map<String, Value>, field: &'static str) -> Result<&'a str> {
    string_field(object, field)?.ok_or_else(|| IoError::InvalidField {
        field,
        message: "missing string field".to_string(),
    })
}

fn string_field<'a>(
    object: &'a Map<String, Value>,
    field: &'static str,
) -> Result<Option<&'a str>> {
    let Some(value) = object.get(field) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    value
        .as_str()
        .map(Some)
        .ok_or_else(|| IoError::InvalidField {
            field,
            message: "expected string".to_string(),
        })
}

fn required_number(object: &Map<String, Value>, field: &'static str) -> Result<f64> {
    number_field(object, field)?.ok_or_else(|| IoError::InvalidField {
        field,
        message: "missing number field".to_string(),
    })
}

fn number_field(object: &Map<String, Value>, field: &'static str) -> Result<Option<f64>> {
    let Some(value) = object.get(field) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    value
        .as_f64()
        .map(Some)
        .ok_or_else(|| IoError::InvalidField {
            field,
            message: "expected number".to_string(),
        })
}

fn integer_field(object: &Map<String, Value>, field: &'static str) -> Result<Option<i32>> {
    let Some(value) = object.get(field) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let integer = value.as_i64().ok_or_else(|| IoError::InvalidField {
        field,
        message: "expected integer".to_string(),
    })?;
    i32::try_from(integer)
        .map(Some)
        .map_err(|error| IoError::InvalidField {
            field,
            message: error.to_string(),
        })
}

fn boolean_field(object: &Map<String, Value>, field: &'static str) -> Result<Option<bool>> {
    let Some(value) = object.get(field) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    value
        .as_bool()
        .map(Some)
        .ok_or_else(|| IoError::InvalidField {
            field,
            message: "expected boolean".to_string(),
        })
}

fn color_field(object: &Map<String, Value>, field: &'static str) -> Result<Option<RgbColor>> {
    string_field(object, field)?.map(parse_argb_hex).transpose()
}

fn parse_point_string(value: &str, field: &'static str) -> Result<Point> {
    let mut coordinates = value.split(',');
    let x = coordinates
        .next()
        .ok_or_else(|| IoError::InvalidField {
            field,
            message: "point is missing x coordinate".to_string(),
        })?
        .parse::<f64>()
        .map_err(|error| IoError::InvalidField {
            field,
            message: error.to_string(),
        })?;
    let y = coordinates
        .next()
        .ok_or_else(|| IoError::InvalidField {
            field,
            message: "point is missing y coordinate".to_string(),
        })?
        .parse::<f64>()
        .map_err(|error| IoError::InvalidField {
            field,
            message: error.to_string(),
        })?;
    if coordinates.next().is_some() {
        return Err(IoError::InvalidField {
            field,
            message: "point contains more than two coordinates".to_string(),
        });
    }
    Ok(Point::new(x, y))
}

fn export_point_string(point: Point) -> String {
    format!(
        "{},{}",
        java_double_string(point.x),
        java_double_string(point.y)
    )
}

fn java_double_string(value: f64) -> String {
    if value.is_finite() && value.fract() == 0.0 {
        format!("{value:.1}")
    } else {
        value.to_string()
    }
}

fn parse_line_color(value: &str) -> Result<LineColor> {
    match value {
        "ANGLE" => Ok(LineColor::Angle),
        "NONE" => Ok(LineColor::None),
        "BLACK_0" => Ok(LineColor::Black0),
        "RED_1" => Ok(LineColor::Red1),
        "BLUE_2" => Ok(LineColor::Blue2),
        "CYAN_3" => Ok(LineColor::Cyan3),
        "ORANGE_4" => Ok(LineColor::Orange4),
        "MAGENTA_5" => Ok(LineColor::Magenta5),
        "GREEN_6" => Ok(LineColor::Green6),
        "YELLOW_7" => Ok(LineColor::Yellow7),
        "PURPLE_8" => Ok(LineColor::Purple8),
        "OTHER_9" => Ok(LineColor::Other9),
        "GREY_10" => Ok(LineColor::Grey10),
        _ => value.parse::<LineColor>().map_err(IoError::from),
    }
}

fn line_color_name(color: LineColor) -> &'static str {
    match color {
        LineColor::Angle => "ANGLE",
        LineColor::None => "NONE",
        LineColor::Black0 => "BLACK_0",
        LineColor::Red1 => "RED_1",
        LineColor::Blue2 => "BLUE_2",
        LineColor::Cyan3 => "CYAN_3",
        LineColor::Orange4 => "ORANGE_4",
        LineColor::Magenta5 => "MAGENTA_5",
        LineColor::Green6 => "GREEN_6",
        LineColor::Yellow7 => "YELLOW_7",
        LineColor::Purple8 => "PURPLE_8",
        LineColor::Other9 => "OTHER_9",
        LineColor::Grey10 => "GREY_10",
    }
}

fn parse_active_state(value: &str) -> Result<ActiveState> {
    match value {
        "INACTIVE_0" => Ok(ActiveState::Inactive0),
        "ACTIVE_A_1" => Ok(ActiveState::ActiveA1),
        "ACTIVE_B_2" => Ok(ActiveState::ActiveB2),
        "ACTIVE_BOTH_3" => Ok(ActiveState::ActiveBoth3),
        _ => Err(IoError::InvalidField {
            field: "active",
            message: format!("unknown active state {value:?}"),
        }),
    }
}

fn active_state_name(active: ActiveState) -> &'static str {
    match active {
        ActiveState::Inactive0 => "INACTIVE_0",
        ActiveState::ActiveA1 => "ACTIVE_A_1",
        ActiveState::ActiveB2 => "ACTIVE_B_2",
        ActiveState::ActiveBoth3 => "ACTIVE_BOTH_3",
    }
}

fn parse_grid_state(value: &str) -> Result<GridState> {
    match value {
        "HIDDEN" => Ok(GridState::Hidden),
        "WITHIN_PAPER" => Ok(GridState::WithinPaper),
        "FULL" => Ok(GridState::Full),
        _ => value
            .parse::<i32>()
            .map_err(|error| IoError::InvalidField {
                field: "baseState",
                message: error.to_string(),
            })
            .and_then(|state| GridState::from_state(state).map_err(IoError::from)),
    }
}

fn grid_state_name(state: GridState) -> &'static str {
    match state {
        GridState::Hidden => "HIDDEN",
        GridState::WithinPaper => "WITHIN_PAPER",
        GridState::Full => "FULL",
    }
}

fn parse_argb_hex(value: &str) -> Result<RgbColor> {
    let rgb = match value.len() {
        6 => value,
        8 => &value[2..],
        _ => {
            return Err(IoError::InvalidField {
                field: "customizedColor",
                message: format!("{value:?} is not a six- or eight-digit hex color"),
            });
        }
    };

    let red = parse_hex_channel(rgb, 0)?;
    let green = parse_hex_channel(rgb, 2)?;
    let blue = parse_hex_channel(rgb, 4)?;
    Ok(RgbColor::new(red, green, blue))
}

fn parse_hex_channel(rgb: &str, start: usize) -> Result<u8> {
    u8::from_str_radix(&rgb[start..start + 2], 16).map_err(|error| IoError::InvalidField {
        field: "customizedColor",
        message: error.to_string(),
    })
}

fn export_argb_hex(color: RgbColor) -> String {
    format!("ff{}", custom_color_hex(color))
}

fn default_color() -> RgbColor {
    RgbColor::new(100, 200, 200)
}
