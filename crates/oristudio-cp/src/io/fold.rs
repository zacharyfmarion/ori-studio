use super::{IoError, Result};
use crate::CreasePatternDocument;
use crate::fold_graph::FoldGraph;
use crate::folding3d::interchange;
use crate::geometry::{
    Circle, FoldMagnitude, LineColor, LineSegment, Point, angle, point_rotate_scaled,
};
use crate::model::{
    CreasePatternModel, GridState, TextElement, crease_fold_angle, custom_color_from_hex,
    custom_color_hex, fold_angle_for_line_color, fold_assignment_for_line_color,
    line_color_for_fold_assignment,
};
use serde_json::{Value, json};
use treemaker_fold::FoldDocument;

const ORIEDITA_VERSION: &str = "dev";
const ORISTUDIO_EDGES_LINE_COLORS: &str = "oristudio:edges_line_colors";
pub const FOLD_FILE_METADATA_KEY: &str = "oristudio:fold:file";

/// Parse a full FOLD file document without flattening embedded frames.
pub fn import_fold_file_json(input: &str) -> Result<FoldDocument> {
    Ok(serde_json::from_str::<FoldDocument>(input)?)
}

/// Serialize a full FOLD file document without dropping embedded frames.
pub fn export_fold_file_json(fold: &FoldDocument) -> Result<String> {
    Ok(serde_json::to_string_pretty(fold)?)
}

/// Return embedded FOLD frames preserved on the root document.
pub fn import_folded_frames(fold: &FoldDocument) -> &[FoldDocument] {
    &fold.file_frames
}

/// Replace the root document's embedded FOLD frames before lossless export.
pub fn export_folded_frames(fold: &mut FoldDocument, frames: Vec<FoldDocument>) {
    fold.file_frames = frames;
}

/// Write this build's folded-form frames beside whatever frames the file
/// already carried.
///
/// Two rules, and the split between them is the whole point. A frame **we**
/// wrote (marked by [`interchange::FOLDED_FORM_MARKER`]) is regenerated on every
/// export: it describes a fold of the creases as they were, and keeping a stale
/// copy beside the fresh one is how a file grows a second, contradicting folded
/// form each time it is saved. A frame from anywhere else is preserved verbatim,
/// including another tool's `foldedForm` — dropping a user's data to make room
/// for ours is a worse trade than either of the alternatives.
///
/// Called **after** [`export_fold_file_document`], never from inside
/// [`export_fold_document`]: [`merge_fold_file_document`] assigns `file_frames`
/// rather than merging it, so a frame written earlier would be clobbered on
/// every file that was imported.
pub fn append_folded_form_frames(fold: &mut FoldDocument, frames: Vec<FoldDocument>) {
    fold.file_frames
        .retain(|frame| !interchange::is_ours(frame));
    fold.file_frames.extend(frames);
}

/// Import a full FOLD file as an editable crease-pattern document while
/// carrying the original file document for frame-preserving export.
pub fn import_fold_file_document_json(input: &str) -> Result<CreasePatternDocument> {
    let fold = import_fold_file_json(input)?;
    import_fold_file_document(&fold)
}

/// Whether a frame carries geometry this importer can build a document from.
///
/// Both arrays, because either alone describes nothing: vertices with no edges
/// is a point cloud, edges with no vertices cannot be resolved.
fn has_usable_geometry(frame: &FoldDocument) -> bool {
    !frame.vertices_coords.is_empty() && !frame.edges_vertices.is_empty()
}

/// How strongly a frame claims to be *the* crease pattern.
///
/// Mirrors the web importer's `frameScore` so a file opens to the same frame in
/// the kernel and in the read-only view: an explicit `creasePattern` class wins,
/// then having faces, then the earliest frame.
fn frame_score(frame: &FoldDocument) -> i32 {
    let is_crease_frame = frame
        .frame_classes
        .iter()
        .any(|class| class == "creasePattern");
    let has_faces = !frame.faces_vertices.is_empty();
    i32::from(is_crease_frame) * 100 + i32::from(has_faces) * 10
}

/// The frame to import from: the root when it carries geometry, otherwise the
/// best-scoring embedded frame.
///
/// The root is preferred outright rather than scored against the frames. A file
/// with root geometry *and* a folded-form frame is describing one crease
/// pattern plus a derived view of it, and the root is the pattern.
fn geometry_frame(fold: &FoldDocument) -> Option<&FoldDocument> {
    if has_usable_geometry(fold) {
        return Some(fold);
    }
    fold.file_frames
        .iter()
        .filter(|frame| has_usable_geometry(frame))
        .enumerate()
        .max_by_key(|(index, frame)| (frame_score(frame), -(*index as i32)))
        .map(|(_, frame)| frame)
}

pub fn import_fold_file_document(fold: &FoldDocument) -> Result<CreasePatternDocument> {
    // Geometry may live on the root or on an embedded frame; `vertices_coords`
    // and `edges_vertices` are optional per the spec, so "no geometry anywhere"
    // is a semantic failure to report here rather than a deserialization one.
    let source = geometry_frame(fold).ok_or_else(|| IoError::InvalidField {
        field: "file_frames",
        message: "FOLD document has no frame with both vertices and edges".to_string(),
    })?;
    let model = import_fold_document(source)?;
    let mut document = CreasePatternDocument {
        title: fold.frame_title.clone().or_else(|| fold.file_title.clone()),
        crease_pattern: model,
        operation_frame: Default::default(),
        metadata: Default::default(),
    };
    document.metadata.insert(
        FOLD_FILE_METADATA_KEY.to_string(),
        serde_json::to_value(fold)?,
    );
    Ok(document)
}

/// Export an editable document as a full FOLD file, preserving embedded frames
/// from the source FOLD document when one was imported.
pub fn export_fold_file_document(document: &CreasePatternDocument) -> Result<FoldDocument> {
    let current = export_fold_document(&document.crease_pattern, document.title.clone());
    let Some(original) = document.metadata.get(FOLD_FILE_METADATA_KEY) else {
        return Ok(current);
    };
    let original = serde_json::from_value::<FoldDocument>(original.clone())?;
    Ok(merge_fold_file_document(original, current))
}

pub fn export_fold_file_document_json(document: &CreasePatternDocument) -> Result<String> {
    export_fold_file_json(&export_fold_file_document(document)?)
}

/// Import a FOLD JSON document with Oriedita extension fields.
pub fn import_fold_json(input: &str) -> Result<CreasePatternModel> {
    let fold = serde_json::from_str::<FoldDocument>(input)?;
    import_fold_document(&fold)
}

/// Whether an `oristudio:edges_line_colors` entry is consistent with the edge's
/// `edges_assignment`.
///
/// Both encode the crease type, and the extension is the more expressive of the
/// two: the eight auxiliary colours all map to `Flat`, so `edges_assignment`
/// alone cannot round-trip them. That is why the extension is preferred — but
/// preferring it *unconditionally* means a stale array silently outvotes the
/// standard field, which is exactly how a rebuilt edge list has twice shipped
/// crease patterns with their borders turned into mountains and valleys. A
/// colour that contradicts the assignment describes some other edge, so the
/// caller falls back to the assignment rather than trusting it.
///
/// Only meaningful where `edges_assignment` actually covers the edge:
/// `assignment_for_edge` reports `Unassigned` for a missing or short array, so
/// checking against it unconditionally would discard every colour in a document
/// that carries only the extension.
fn line_color_agrees_with_assignment(fold: &FoldDocument, index: usize, color: LineColor) -> bool {
    let Some(assignment) = fold.edges_assignment.get(index) else {
        return true;
    };
    fold_assignment_for_line_color(color) == *assignment
}

/// Magnitude to import for one FOLD edge, from `edges_foldAngle`.
///
/// Only the *magnitude* is taken. Colour derivation is left exactly as it was —
/// it is oracle-tested against Oriedita, and for any well-formed FOLD the sign
/// of `edges_foldAngle` already agrees with `edges_assignment` (a valley is `V`
/// at every angle). Taking `|angle|` means a contradictory file keeps its
/// Oriedita-compatible colour rather than silently flipping.
///
/// A full +/-180 normalises to `None`, so a classic FOLD imports to a classic
/// crease and round-trips byte-identically.
fn imported_fold_magnitude(fold: &FoldDocument, index: usize) -> Option<FoldMagnitude> {
    let angle = fold.fold_angle_for_edge(index)?;
    let magnitude = FoldMagnitude::from_degrees(angle.abs())?;
    (!magnitude.is_full()).then_some(magnitude)
}

/// How far off the xy plane a vertex may sit and still be read as flat.
///
/// Deliberately tiny. This is not a modelling tolerance — it exists only so a
/// FOLD file that writes `[x, y, 0]` (or `0.0`, or `-0.0`) instead of `[x, y]`
/// imports the way `[x, y]` does. Anything above it is real out-of-plane
/// geometry and the importer has nowhere to put it.
const FLAT_Z_TOLERANCE: f64 = 1e-9;

/// Refuse geometry this importer would silently flatten.
///
/// [`vertex_point`] reads `coords[0]` and `coords[1]` and drops everything
/// after, so a folded form imports as its own shadow: a plausible-looking crease
/// pattern whose creases are wherever the projection put them. Measured on
/// `MoosersTrainRigid-Gardner.fold`, all 246 spatial vertices fail closure after
/// the round trip — the file is a valid folded state and the import is not a
/// crease pattern of it in any sense.
///
/// Two independent signals, because either can be present without the other: a
/// frame that *declares* `foldedForm` (which can still be flat in z — a
/// flat-folded state is a folded state), and any vertex actually off the plane
/// (which a file can carry without declaring a class at all).
///
/// Per AGENTS.md, an operation that has not been ported returns an explicit
/// unsupported-operation error rather than a nearby result.
fn reject_unrepresentable_geometry(fold: &FoldDocument) -> Result<()> {
    if fold.frame_classes.iter().any(|class| class == "foldedForm") {
        return Err(IoError::FoldedForm {
            what: "FOLD folded-form frames",
            detail: "this frame declares frame_classes: [\"foldedForm\"], which describes \
                     a folded state rather than a crease pattern"
                .to_string(),
        });
    }
    if let Some((index, z)) = fold
        .vertices_coords
        .iter()
        .enumerate()
        .find_map(|(index, coords)| {
            coords
                .get(2)
                .copied()
                .filter(|z| z.abs() > FLAT_Z_TOLERANCE)
                .map(|z| (index, z))
        })
    {
        return Err(IoError::FoldedForm {
            what: "FOLD geometry outside the paper plane",
            detail: format!(
                "vertex {index} has z = {z}, and a crease pattern has no third coordinate \
                 to keep it in"
            ),
        });
    }
    Ok(())
}

pub fn import_fold_document(fold: &FoldDocument) -> Result<CreasePatternModel> {
    reject_unrepresentable_geometry(fold)?;
    let mut model = CreasePatternModel::default();
    let edge_line_colors = line_color_array_extra(fold, ORISTUDIO_EDGES_LINE_COLORS)?;
    let edge_colors = string_array_extra(fold, "oriedita:edges_colors")?;
    let mut bounds = FoldImportBounds::default();

    for (index, edge) in fold.edges_vertices.iter().enumerate() {
        let a = vertex_point(fold, edge[0])?;
        let b = vertex_point(fold, edge[1])?;
        bounds.include(a);
        bounds.include(b);
        let line_color = edge_line_colors
            .as_ref()
            .and_then(|colors| colors.get(index).copied().flatten())
            .filter(|color| line_color_agrees_with_assignment(fold, index, *color))
            .unwrap_or_else(|| line_color_for_fold_assignment(fold.assignment_for_edge(index)));
        let mut segment = LineSegment::with_color(a, b, line_color)
            .with_fold_magnitude(imported_fold_magnitude(fold, index));

        if let Some(hex) = edge_colors.as_ref().and_then(|colors| colors.get(index))
            && !hex.is_empty()
        {
            segment = segment.with_customized_color(custom_color_from_hex(hex)?);
        }

        model.add_line_segment(segment);
    }
    normalize_imported_fold_lines(&mut model, bounds);

    import_circles(fold, &mut model)?;
    import_texts(fold, &mut model)?;
    import_grid(fold, &mut model)?;

    Ok(model)
}

/// Export a FOLD document with Oriedita extension fields.
pub fn export_fold_document(model: &CreasePatternModel, title: Option<String>) -> FoldDocument {
    let topology = FoldGraph::from_model_for_export(model);
    let mut assignments = Vec::new();
    let mut fold_angles = Vec::new();
    let mut edge_line_colors = Vec::new();
    let mut edge_custom_colors = Vec::new();

    for segment in &topology.segments {
        assignments.push(fold_assignment_for_line_color(segment.color));
        // `crease_fold_angle` is `None` for anything that is not a crease, which
        // is exactly where the old colour-only mapping produced 0.
        fold_angles.push(Some(
            crease_fold_angle(segment).unwrap_or_else(|| fold_angle_for_line_color(segment.color)),
        ));
        edge_line_colors.push(segment.color.number());
        edge_custom_colors.push(if segment.customized == 1 {
            custom_color_hex(segment.customized_color)
        } else {
            String::new()
        });
    }

    let mut fold = FoldDocument::new(
        topology
            .points
            .iter()
            .map(|point| vec![point.x, point.y])
            .collect(),
        topology.edges_vertices(),
    );
    fold.file_spec = Some(1.1);
    fold.file_creator = Some("oriedita".to_string());
    fold.frame_title = title;
    fold.edges_assignment = assignments;
    fold.edges_fold_angle = fold_angles;
    if topology.include_faces {
        fold.faces_vertices = topology.faces.clone();
        fold.faces_edges = topology.faces_edges();
    }

    fold.extra.insert(
        "oriedita:version".to_string(),
        Value::String(ORIEDITA_VERSION.to_string()),
    );
    fold.extra.insert(
        "oriedita:edges_colors".to_string(),
        json!(edge_custom_colors),
    );
    fold.extra.insert(
        ORISTUDIO_EDGES_LINE_COLORS.to_string(),
        json!(edge_line_colors),
    );
    export_circles(model, &mut fold);
    export_texts(model, &mut fold);
    fold.extra.insert(
        "oriedita:grid_size".to_string(),
        json!(model.grid.grid_size),
    );
    fold.extra.insert(
        "oriedita:grid_style".to_string(),
        json!(model.grid.base_state.state()),
    );

    fold
}

pub fn export_fold_json(model: &CreasePatternModel, title: Option<String>) -> Result<String> {
    Ok(serde_json::to_string_pretty(&export_fold_document(
        model, title,
    ))?)
}

fn merge_fold_file_document(original: FoldDocument, current: FoldDocument) -> FoldDocument {
    let mut merged = current;
    let mut extra = original.extra;
    extra.extend(merged.extra);

    merged.file_spec = original.file_spec.or(merged.file_spec);
    merged.file_creator = original.file_creator.or(merged.file_creator);
    merged.file_author = original.file_author.or(merged.file_author);
    merged.file_title = original.file_title.or(merged.file_title);
    merged.frame_title = merged.frame_title.or(original.frame_title);
    merged.frame_parent = original.frame_parent.or(merged.frame_parent);
    merged.frame_inherit = original.frame_inherit.or(merged.frame_inherit);
    if !original.frame_classes.is_empty() {
        merged.frame_classes = original.frame_classes;
    }
    merged.file_frames = original.file_frames;
    merged.extra = extra;
    merged
}

fn vertex_point(fold: &FoldDocument, index: usize) -> Result<Point> {
    let coords = fold
        .vertices_coords
        .get(index)
        .ok_or_else(|| IoError::InvalidField {
            field: "vertices_coords",
            message: format!("edge references missing vertex {index}"),
        })?;
    if coords.len() < 2 {
        return Err(IoError::InvalidField {
            field: "vertices_coords",
            message: format!("vertex {index} has fewer than two coordinates"),
        });
    }
    Ok(Point::new(coords[0], coords[1]))
}

#[derive(Debug, Clone, Copy)]
struct FoldImportBounds {
    min_x: f64,
    min_y: f64,
    max_y: f64,
    has_points: bool,
}

impl Default for FoldImportBounds {
    fn default() -> Self {
        Self {
            min_x: f64::MAX,
            min_y: f64::MAX,
            max_y: f64::from_bits(1),
            has_points: false,
        }
    }
}

impl FoldImportBounds {
    fn include(&mut self, point: Point) {
        self.min_x = self.min_x.min(point.x);
        self.min_y = self.min_y.min(point.y);
        self.max_y = self.max_y.max(point.y);
        self.has_points = true;
    }
}

fn normalize_imported_fold_lines(model: &mut CreasePatternModel, bounds: FoldImportBounds) {
    if !bounds.has_points {
        return;
    }

    let source_a = Point::new(bounds.min_x, bounds.min_y);
    let source_b = Point::new(bounds.min_x, bounds.max_y);
    let target_a = Point::new(-200.0, -200.0);
    let target_b = Point::new(-200.0, 200.0);
    let rotation = angle((source_a, source_b, target_a, target_b));
    let scale = target_a.distance(target_b) / source_a.distance(source_b);
    let delta = Point::new(target_a.x - source_a.x, target_a.y - source_a.y);

    for segment in &mut model.line_segments {
        segment.a = normalize_imported_fold_point(segment.a, source_a, rotation, scale, delta);
        segment.b = normalize_imported_fold_point(segment.b, source_a, rotation, scale, delta);
    }
}

fn normalize_imported_fold_point(
    point: Point,
    source_a: Point,
    rotation: f64,
    scale: f64,
    delta: Point,
) -> Point {
    point_rotate_scaled(source_a, point, rotation, scale).move_by(delta)
}

fn import_circles(fold: &FoldDocument, model: &mut CreasePatternModel) -> Result<()> {
    let Some(coords) = point_array_extra(fold, "oriedita:circles_coords")? else {
        return Ok(());
    };
    let radii = f64_array_extra(fold, "oriedita:circles_radii")?.unwrap_or_default();
    let colors = string_array_extra(fold, "oriedita:circles_colors")?.unwrap_or_default();
    let custom_colors =
        string_array_extra(fold, "oriedita:circles_custom_colors")?.unwrap_or_default();

    for (index, center) in coords.into_iter().enumerate() {
        let radius = radii.get(index).copied().unwrap_or_default();
        let color = colors
            .get(index)
            .and_then(|value| value.parse::<LineColor>().ok())
            .unwrap_or(LineColor::Black0);
        let mut circle = Circle::from_center(center, radius, color);

        if let Some(hex) = custom_colors.get(index)
            && !hex.is_empty()
        {
            circle = circle.with_customized_color(custom_color_from_hex(hex)?);
        }

        model.add_circle(circle);
    }

    Ok(())
}

fn import_texts(fold: &FoldDocument, model: &mut CreasePatternModel) -> Result<()> {
    let Some(coords) = point_array_extra(fold, "oriedita:texts_coords")? else {
        return Ok(());
    };
    let texts = string_array_extra(fold, "oriedita:texts_text")?.unwrap_or_default();

    for (index, position) in coords.into_iter().enumerate() {
        if let Some(text) = texts.get(index) {
            model.add_text(TextElement::new(position.x, position.y, text.clone()));
        }
    }

    Ok(())
}

fn import_grid(fold: &FoldDocument, model: &mut CreasePatternModel) -> Result<()> {
    model.grid.base_state = GridState::Hidden;
    if let Some(size) = integer_extra(fold, "oriedita:grid_size")? {
        model.grid.set_grid_size(size);
    }
    if let Some(style) = integer_extra(fold, "oriedita:grid_style")? {
        model.grid.base_state = GridState::from_state(style)?;
    }
    Ok(())
}

fn export_circles(model: &CreasePatternModel, fold: &mut FoldDocument) {
    if model.circles.is_empty() {
        return;
    }

    fold.extra.insert(
        "oriedita:circles_coords".to_string(),
        json!(
            model
                .circles
                .iter()
                .map(|circle| vec![circle.x, circle.y])
                .collect::<Vec<_>>()
        ),
    );
    fold.extra.insert(
        "oriedita:circles_radii".to_string(),
        json!(
            model
                .circles
                .iter()
                .map(|circle| circle.r)
                .collect::<Vec<_>>()
        ),
    );
    fold.extra.insert(
        "oriedita:circles_colors".to_string(),
        json!(
            model
                .circles
                .iter()
                .map(|circle| circle.color.to_string())
                .collect::<Vec<_>>()
        ),
    );
    fold.extra.insert(
        "oriedita:circles_custom_colors".to_string(),
        json!(
            model
                .circles
                .iter()
                .map(|circle| {
                    if circle.customized == 1 {
                        custom_color_hex(circle.customized_color)
                    } else {
                        String::new()
                    }
                })
                .collect::<Vec<_>>()
        ),
    );
}

fn export_texts(model: &CreasePatternModel, fold: &mut FoldDocument) {
    if model.texts.is_empty() {
        return;
    }

    fold.extra.insert(
        "oriedita:texts_coords".to_string(),
        json!(
            model
                .texts
                .iter()
                .map(|text| vec![text.x.0, text.y.0])
                .collect::<Vec<_>>()
        ),
    );
    fold.extra.insert(
        "oriedita:texts_text".to_string(),
        json!(
            model
                .texts
                .iter()
                .map(|text| text.text.clone())
                .collect::<Vec<_>>()
        ),
    );
}

fn string_array_extra(fold: &FoldDocument, key: &'static str) -> Result<Option<Vec<String>>> {
    let Some(value) = fold.extra.get(key) else {
        return Ok(None);
    };
    let array = value.as_array().ok_or_else(|| IoError::InvalidField {
        field: key,
        message: "expected array".to_string(),
    })?;
    array
        .iter()
        .map(|item| {
            item.as_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| IoError::InvalidField {
                    field: key,
                    message: "expected string array".to_string(),
                })
        })
        .collect::<Result<Vec<_>>>()
        .map(Some)
}

fn line_color_array_extra(
    fold: &FoldDocument,
    key: &'static str,
) -> Result<Option<Vec<Option<LineColor>>>> {
    let Some(value) = fold.extra.get(key) else {
        return Ok(None);
    };
    let Some(values) = value.as_array() else {
        return Err(IoError::InvalidField {
            field: key,
            message: "expected array".to_string(),
        });
    };

    values
        .iter()
        .map(|value| {
            if value.is_null() {
                return Ok(None);
            }
            let number = value.as_i64().ok_or_else(|| IoError::InvalidField {
                field: key,
                message: format!("expected integer line color, got {value}"),
            })?;
            let number = i32::try_from(number).map_err(|_| IoError::InvalidField {
                field: key,
                message: format!("line color {number} is outside i32 range"),
            })?;
            LineColor::from_number(number)
                .map(Some)
                .map_err(IoError::from)
        })
        .collect::<Result<Vec<_>>>()
        .map(Some)
}

fn f64_array_extra(fold: &FoldDocument, key: &'static str) -> Result<Option<Vec<f64>>> {
    let Some(value) = fold.extra.get(key) else {
        return Ok(None);
    };
    let array = value.as_array().ok_or_else(|| IoError::InvalidField {
        field: key,
        message: "expected array".to_string(),
    })?;
    array
        .iter()
        .map(|item| {
            item.as_f64().ok_or_else(|| IoError::InvalidField {
                field: key,
                message: "expected number array".to_string(),
            })
        })
        .collect::<Result<Vec<_>>>()
        .map(Some)
}

fn point_array_extra(fold: &FoldDocument, key: &'static str) -> Result<Option<Vec<Point>>> {
    let Some(value) = fold.extra.get(key) else {
        return Ok(None);
    };
    let array = value.as_array().ok_or_else(|| IoError::InvalidField {
        field: key,
        message: "expected array".to_string(),
    })?;
    array
        .iter()
        .map(|item| {
            let coords = item.as_array().ok_or_else(|| IoError::InvalidField {
                field: key,
                message: "expected coordinate array".to_string(),
            })?;
            if coords.len() < 2 {
                return Err(IoError::InvalidField {
                    field: key,
                    message: "coordinate array has fewer than two numbers".to_string(),
                });
            }
            let x = coords[0].as_f64().ok_or_else(|| IoError::InvalidField {
                field: key,
                message: "x coordinate is not a number".to_string(),
            })?;
            let y = coords[1].as_f64().ok_or_else(|| IoError::InvalidField {
                field: key,
                message: "y coordinate is not a number".to_string(),
            })?;
            Ok(Point::new(x, y))
        })
        .collect::<Result<Vec<_>>>()
        .map(Some)
}

fn integer_extra(fold: &FoldDocument, key: &'static str) -> Result<Option<i32>> {
    let Some(value) = fold.extra.get(key) else {
        return Ok(None);
    };
    let number = value.as_i64().ok_or_else(|| IoError::InvalidField {
        field: key,
        message: "expected integer".to_string(),
    })?;
    i32::try_from(number)
        .map(Some)
        .map_err(|error| IoError::InvalidField {
            field: key,
            message: error.to_string(),
        })
}
