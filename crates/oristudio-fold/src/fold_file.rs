//! FOLD export of a fold sequence (plan D10, Phase 2 "FOLD export"), behind
//! the `kernel` feature.
//!
//! One file per path through the step tree, `file_classes: ["diagrams",
//! "singleModel"]`:
//!
//! - **Frame 0, the root,** is the path's final crease pattern as the kernel's
//!   own FOLD writer writes it from [`fold_cp_to_model`]: Oriedita model
//!   space, precreases as `U` plus the `oristudio:edges_fold_direction_hint`
//!   extension, and crease marks (partial creases) as auxiliary lines, `F`
//!   with the aux colour in `oristudio:edges_line_colors`, as the kernel
//!   writes every aux line. Edit opens it exactly as it opens Send to Edit,
//!   and keeps the step frames when it saves the file again: only frames
//!   carrying the 3D writer's marker are regenerated
//!   (`append_folded_form_frames`).
//! - **One `foldedForm` frame per state**, in `file_frames`, in path order
//!   ([`step_frame`]): the state's own crease pattern, folded. Vertices sit at
//!   their images as the viewer sees them (the view applied, so a turned-over
//!   step is mirrored), `edges_assignment` has `F` for an unfolded crease,
//!   `faceOrders` is FOLD's convention through `oristudio-layer-order`, and
//!   each face's sheet → folded matrix is under [`FACES_MATRIX_KEY`] in
//!   Beloch's `beloch:faces_matrix` layout, so a reader that takes each frame
//!   by itself reads Beloch's goldens and these files alike.
//!   [`FOLD_STEP_MARKER`] marks the frame as ours and records the step and
//!   the view. A step frame carries no crease marks: they are no edges of
//!   its folded form, and the root holds the last state's.
//!
//! # Two frames of reference, mirror images
//!
//! A step frame is in the engine's frames, not the root's. Its coordinates
//! are the unit sheet frame, y up, with the view applied, and its matrices map
//! sheet coordinates (the unit sheet frame, y up) into them. The root is in
//! Oriedita's model space, y down, at the kernel's scale
//! ([`KernelFrame`](crate::kernel::KernelFrame)), where the kernel's writer
//! puts every pattern, so its faces wind clockwise there; a front-up face of
//! a step frame winds counter-clockwise.
//!
//! So the root and the step frames are mirror images of each other: a viewer
//! that draws the root's crease pattern beside a flat step of the same paper
//! shows one mirrored against the other.
//! [`KernelFrame::to_model`](crate::kernel::KernelFrame::to_model) takes a
//! flat frame's coordinates onto the root's. A reader that takes each frame
//! by itself — paper polygons from the frame's own coordinates and inverse
//! matrices, as `crates/oracle-tests/tests/beloch_frames.rs` reads Beloch's
//! files — reads every frame right; one that applies the matrices to the
//! root's coordinates, or matches a frame's faces to the root's by position,
//! must map through the kernel frame first. The `faceOrders` triples do not
//! depend on the choice: mirroring a whole frame shows the same state from
//! behind, which inverts every "above" and every orientation together.
//!
//! A step frame does not inherit (`frame_inherit: false`): every state has
//! its own topology, and the root's per-edge arrays are numbered by the
//! kernel's.
//!
//! The conventions are the 3D folded-form writer's (`interchange.rs`), whose
//! code is not shared because it builds from a 3D placement: `frame_parent:
//! 0`, a marker key, and the size cap with its types. Here the cap is held
//! against the whole file, the sum over every frame, since a long sequence of
//! modest frames weighs what one wide frame does.

use oristudio_cp::folding3d::interchange::{
    FOLDED_FORM_MAX_ELEMENTS, FoldedFormSize, FoldedFormTooLarge,
};
use oristudio_cp::io::IoError;
use oristudio_cp::io::fold::{export_fold_document, export_fold_file_json, export_folded_frames};
use oristudio_layer_order::{LayerOrder, LayerOrderError};
use serde_json::{Value, json};
use thiserror::Error;
use treemaker_fold::{Assignment, FoldDocument};

use crate::isometry::Isometry;
use crate::kernel::fold_cp_to_model;
use crate::pattern::{CreaseKind, FaceId, Letter};
use crate::state::State;

/// Marks a step frame this engine wrote: `{schema, step, view}`.
pub const FOLD_STEP_MARKER: &str = "oristudio:fold-step";

/// The current step-frame layout.
pub const FOLD_STEP_FRAME_SCHEMA_VERSION: u32 = 1;

/// Per face, in `faces_vertices` order, its sheet → folded isometry as
/// `[m00, m01, m10, m11, tx, ty]` (`x' = m00 x + m01 y + tx`,
/// `y' = m10 x + m11 y + ty`): Beloch's `beloch:faces_matrix` layout.
pub const FACES_MATRIX_KEY: &str = "oristudio:faces_matrix";

/// The file's classes: a sequence of steps of one model.
pub const FILE_CLASSES: [&str; 2] = ["diagrams", "singleModel"];

const FILE_CREATOR: &str = "Ori Studio (Fold)";

/// What every step frame is. `nonSelfIntersecting` is claimed because the
/// gate every state passed checks the complete facewise constraint set (the
/// 3D writer cannot claim it: its crossing test is sound but not complete).
const STEP_FRAME_ATTRIBUTES: [&str; 5] = [
    "2D",
    "manifold",
    "orientable",
    "convexFaces",
    "nonSelfIntersecting",
];

/// Why a sequence cannot be exported.
#[derive(Debug, Error)]
pub enum FoldExportError {
    #[error("a FOLD export needs at least one state")]
    EmptyPath,
    #[error(transparent)]
    TooLarge(#[from] FoldedFormTooLarge),
    #[error("the layer order cannot be written as faceOrders: {0}")]
    FaceOrders(#[from] LayerOrderError),
    #[error("the FOLD text cannot be written: {0}")]
    Text(#[from] IoError),
}

impl FoldExportError {
    /// The stable snake_case code the bridge and the UI use.
    pub fn code(&self) -> &'static str {
        match self {
            FoldExportError::EmptyPath => "fold_export_empty",
            FoldExportError::TooLarge(_) => "fold_export_too_large",
            FoldExportError::FaceOrders(_) => "fold_export_face_orders",
            FoldExportError::Text(_) => "fold_export_text",
        }
    }
}

/// The FOLD file of a path: the states from the first step shown to the last,
/// the last one's crease pattern as the root. Refused when the whole file
/// would exceed [`FOLDED_FORM_MAX_ELEMENTS`].
pub fn export_fold_sequence(
    path: &[State],
    title: Option<&str>,
) -> Result<FoldDocument, FoldExportError> {
    export_fold_sequence_with_cap(path, title, FOLDED_FORM_MAX_ELEMENTS)
}

/// [`export_fold_sequence`] with the cap supplied: the shipped cap is never
/// reached by a real sequence, so this is how the refusal is tested.
///
/// The size is counted before any step frame is built: the root (which the
/// kernel's writer has to build to be counted) plus [`step_frame_size`] of
/// every state.
pub fn export_fold_sequence_with_cap(
    path: &[State],
    title: Option<&str>,
    cap: usize,
) -> Result<FoldDocument, FoldExportError> {
    let last = path.last().ok_or(FoldExportError::EmptyPath)?;
    let mut root = export_fold_document(&fold_cp_to_model(last), title.map(str::to_owned));
    let size = path
        .iter()
        .map(step_frame_size)
        .fold(frame_size(&root), plus);
    if size.elements() > cap {
        return Err(FoldedFormTooLarge { size, cap }.into());
    }
    let frames = path.iter().map(step_frame).collect::<Result<Vec<_>, _>>()?;
    root.file_title = title.map(str::to_owned);
    root.file_creator = Some(FILE_CREATOR.to_string());
    root.frame_classes = vec!["creasePattern".to_string()];
    root.extra
        .insert("file_classes".to_string(), json!(FILE_CLASSES));
    export_folded_frames(&mut root, frames);
    Ok(root)
}

/// [`export_fold_sequence`] as text, through the kernel's FOLD file writer.
pub fn export_fold_sequence_json(
    path: &[State],
    title: Option<&str>,
) -> Result<String, FoldExportError> {
    Ok(export_fold_file_json(&export_fold_sequence(path, title)?)?)
}

/// One state as a flat `foldedForm` frame (see the module docs).
pub fn step_frame(state: &State) -> Result<FoldDocument, FoldExportError> {
    let view = state.view().transform();
    let geometry = state.geometry();
    let coords = geometry
        .vertex_images
        .iter()
        .map(|&p| view.apply(p).to_vec())
        .collect();
    let edges = state
        .creases()
        .iter()
        .map(|c| c.vertices.map(|v| v.index()))
        .collect();
    let mut frame = FoldDocument::new(coords, edges);
    frame.file_spec = None;
    frame.frame_classes = vec!["foldedForm".to_string()];
    frame.frame_parent = Some(0);
    // Not `true`: see the module docs.
    frame.frame_inherit = Some(false);
    frame.edges_assignment = state.creases().iter().map(|c| assignment(c.kind)).collect();
    frame.edges_fold_angle = state
        .creases()
        .iter()
        .map(|c| Some(fold_angle(c.kind)))
        .collect();
    // Rings are counter-clockwise on the sheet, so under each face's matrix
    // the right-hand normal is +z exactly when the viewer sees its front: the
    // normal `faceOrders` is signed against.
    frame.faces_vertices = state
        .faces()
        .iter()
        .map(|f| f.ring.iter().map(|v| v.index()).collect())
        .collect();
    frame.face_orders = fold_face_orders(state, state.order())?;
    let matrices: Vec<Value> = geometry
        .isometries
        .iter()
        .map(|t| Value::from(beloch_layout(&view.after(t)).to_vec()))
        .collect();
    let seen = state.view();
    frame
        .extra
        .insert("frame_attributes".to_string(), json!(STEP_FRAME_ATTRIBUTES));
    frame
        .extra
        .insert(FACES_MATRIX_KEY.to_string(), Value::Array(matrices));
    frame.extra.insert(
        FOLD_STEP_MARKER.to_string(),
        json!({
            "schema": FOLD_STEP_FRAME_SCHEMA_VERSION,
            "step": state.step(),
            "view": { "flipped": seen.flipped, "rotation": seen.rotation },
        }),
    );
    Ok(frame)
}

/// What [`step_frame`] emits, in the units the cap is stated in.
pub fn step_frame_size(state: &State) -> FoldedFormSize {
    FoldedFormSize {
        vertices: state.vertices().len(),
        face_ring_entries: state.faces().iter().map(|f| f.ring.len()).sum(),
        face_orders: state
            .order()
            .pairs()
            .filter(|(_, lo_above)| lo_above.is_some())
            .count(),
    }
}

/// Whether a frame was written by [`step_frame`].
pub fn is_step_frame(frame: &FoldDocument) -> bool {
    frame.extra.contains_key(FOLD_STEP_MARKER)
}

fn frame_size(frame: &FoldDocument) -> FoldedFormSize {
    FoldedFormSize {
        vertices: frame.vertices_coords.len(),
        face_ring_entries: frame.faces_vertices.iter().map(Vec::len).sum(),
        face_orders: frame.face_orders.len(),
    }
}

fn plus(a: FoldedFormSize, b: FoldedFormSize) -> FoldedFormSize {
    FoldedFormSize {
        vertices: a.vertices + b.vertices,
        face_ring_entries: a.face_ring_entries + b.face_ring_entries,
        face_orders: a.face_orders + b.face_orders,
    }
}

fn assignment(kind: CreaseKind) -> Assignment {
    match kind {
        CreaseKind::Border => Assignment::Boundary,
        CreaseKind::Folded(Letter::Mountain) => Assignment::Mountain,
        CreaseKind::Folded(Letter::Valley) => Assignment::Valley,
        CreaseKind::Flat(_) => Assignment::Flat,
    }
}

/// FOLD's sign: valley positive.
fn fold_angle(kind: CreaseKind) -> f64 {
    match kind {
        CreaseKind::Folded(Letter::Valley) => 180.0,
        CreaseKind::Folded(Letter::Mountain) => -180.0,
        CreaseKind::Border | CreaseKind::Flat(_) => 0.0,
    }
}

/// `[m00, m01, m10, m11, tx, ty]` from the engine's `[a, b, c, d, e, f]`
/// (`x' = a x + b y + c`, `y' = d x + e y + f`).
fn beloch_layout(t: &Isometry) -> [f64; 6] {
    let [a, b, c, d, e, f] = t.0;
    [a, b, d, e, c, f]
}

/// `order`, an order on `state`'s faces, as FOLD `faceOrders` with faces
/// named by their position in `faces_vertices`: what [`step_frame`] writes
/// for the state's own order. Another order is for a check that hands one
/// beside a frame (the Flat-Folder oracle's flipped pairs). The triples do not
/// depend on the view: turning over inverts both which face is above and
/// which way each one faces.
pub fn fold_face_orders(
    state: &State,
    order: &LayerOrder,
) -> Result<Vec<[i64; 3]>, LayerOrderError> {
    let triples = order.to_fold_face_orders(state.folded_view())?;
    let position = |index: usize, id: i64| {
        u32::try_from(id)
            .ok()
            .and_then(|id| state.face_position(FaceId(id)))
            .map(|p| p as i64)
            .ok_or(LayerOrderError::InvalidFaceOrder {
                index,
                reason: "a face is not in the state",
            })
    };
    triples
        .into_iter()
        .enumerate()
        .map(|(index, [f, g, s])| Ok([position(index, f)?, position(index, g)?, s]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_matrix_layout_is_belochs() {
        let t = Isometry([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        let [m00, m01, m10, m11, tx, ty] = beloch_layout(&t);
        let p = [0.25, -2.0];
        assert_eq!(
            [m00 * p[0] + m01 * p[1] + tx, m10 * p[0] + m11 * p[1] + ty],
            t.apply(p)
        );
    }

    #[test]
    fn kinds_map_to_fold_assignments_and_angles() {
        let cases = [
            (CreaseKind::Border, Assignment::Boundary, 0.0),
            (
                CreaseKind::Folded(Letter::Valley),
                Assignment::Valley,
                180.0,
            ),
            (
                CreaseKind::Folded(Letter::Mountain),
                Assignment::Mountain,
                -180.0,
            ),
            (CreaseKind::Flat(Letter::Valley), Assignment::Flat, 0.0),
            (CreaseKind::Flat(Letter::Mountain), Assignment::Flat, 0.0),
        ];
        for (kind, a, angle) in cases {
            assert_eq!((assignment(kind), fold_angle(kind)), (a, angle), "{kind:?}");
        }
    }

    #[test]
    fn codes_are_stable() {
        assert_eq!(FoldExportError::EmptyPath.code(), "fold_export_empty");
        let too_large = FoldedFormTooLarge {
            size: FoldedFormSize::default(),
            cap: 0,
        };
        assert_eq!(
            FoldExportError::from(too_large).code(),
            "fold_export_too_large"
        );
    }
}
