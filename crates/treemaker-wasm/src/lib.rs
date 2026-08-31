//! `wasm-bindgen` wrapper around `treemaker-core`.
//!
//! The wasm API stores loaded trees behind integer handles so JavaScript can
//! call into the engine without copying the whole model for every operation.
//! Error values are serialized objects with the same stable `code` values as
//! native [`treemaker_core::TreeError`].

use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use treemaker_core::{
    FoldedBaseCrease, FoldedBaseFacet, FoldedBaseSnapshot, FoldedBaseVertex, Point, Tree,
    TreeDesign, TreeEdit, TreeError,
};
use treemaker_flatfold::{
    FlatFoldError, SolutionLimit, SolveOptions, infer_edge_assignments_from_face_orders,
    solve_flat_fold,
};
use treemaker_fold::{Assignment, FoldDocument};
use wasm_bindgen::prelude::*;

thread_local! {
    static TREES: RefCell<Vec<Option<Tree>>> = const { RefCell::new(Vec::new()) };
}

#[wasm_bindgen]
pub fn load_tmd(text: &str) -> std::result::Result<u32, JsValue> {
    let tree = Tree::from_tmd_str(text).map_err(to_js_error)?;
    store_tree(tree)
}

#[derive(Deserialize)]
struct NewDesignConfig {
    paper_width: Option<f64>,
    paper_height: Option<f64>,
}

#[wasm_bindgen]
pub fn new_design(config: JsValue) -> std::result::Result<u32, JsValue> {
    let config = if config.is_null() || config.is_undefined() {
        NewDesignConfig {
            paper_width: None,
            paper_height: None,
        }
    } else {
        serde_wasm_bindgen::from_value(config).map_err(to_js_value)?
    };
    let tree = Tree::new_design(
        config.paper_width.unwrap_or(1.0),
        config.paper_height.unwrap_or(1.0),
    )
    .map_err(to_js_error)?;
    store_tree(tree)
}

#[wasm_bindgen]
pub fn load_design(design: JsValue) -> std::result::Result<u32, JsValue> {
    let design: TreeDesign = serde_wasm_bindgen::from_value(design).map_err(to_js_value)?;
    let tree = Tree::from_design(design).map_err(to_js_error)?;
    store_tree(tree)
}

fn store_tree(tree: Tree) -> std::result::Result<u32, JsValue> {
    TREES.with(|trees| {
        let mut trees = trees.borrow_mut();
        if let Some((idx, slot)) = trees
            .iter_mut()
            .enumerate()
            .find(|(_, slot)| slot.is_none())
        {
            *slot = Some(tree);
            Ok(idx as u32)
        } else {
            trees.push(Some(tree));
            Ok((trees.len() - 1) as u32)
        }
    })
}

#[wasm_bindgen]
pub fn tree_summary(handle: u32) -> std::result::Result<JsValue, JsValue> {
    with_tree(handle, |tree| {
        serde_wasm_bindgen::to_value(&tree.summary()).map_err(to_js_value)
    })
}

#[wasm_bindgen]
pub fn tree_snapshot(handle: u32) -> std::result::Result<JsValue, JsValue> {
    with_tree(handle, |tree| {
        serde_wasm_bindgen::to_value(&tree.snapshot()).map_err(to_js_value)
    })
}

#[wasm_bindgen]
pub fn fold_artifacts(handle: u32) -> std::result::Result<JsValue, JsValue> {
    with_tree(handle, |tree| {
        let serializer = serde_wasm_bindgen::Serializer::json_compatible();
        tree.fold_artifacts()
            .map_err(to_js_error)?
            .serialize(&serializer)
            .map_err(to_js_value)
    })
}

#[derive(Deserialize)]
struct FlatFoldOptions {
    solution_limit: Option<usize>,
}

#[derive(Serialize)]
struct ImportedFoldArtifacts {
    fold: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    folded_base: Option<FoldedBaseSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    folded_base_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    simulation_model: Option<treemaker_fold::PreparedFoldModel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    simulation_model_error: Option<String>,
}

#[wasm_bindgen]
pub fn flat_fold_artifacts(
    fold_json: &str,
    options: JsValue,
) -> std::result::Result<JsValue, JsValue> {
    let options = if options.is_null() || options.is_undefined() {
        FlatFoldOptions {
            solution_limit: None,
        }
    } else {
        serde_wasm_bindgen::from_value(options).map_err(to_js_value)?
    };
    let document: FoldDocument = serde_json::from_str(fold_json).map_err(|error| {
        js_error(
            "invalid_input",
            format!("failed to parse FOLD document: {error}"),
        )
    })?;
    let solved = solve_flat_fold(
        &document,
        SolveOptions {
            solution_limit: SolutionLimit::Count(options.solution_limit.unwrap_or(10)),
            ..SolveOptions::default()
        },
    )
    .map_err(to_js_flatfold_error)?;
    let normalized = solved.analysis.normalized.document.clone();
    let mut fold_value = serde_json::to_value(&normalized).map_err(to_js_value)?;
    if let serde_json::Value::Object(ref mut object) = fold_value {
        object.insert(
            "face_orders".to_string(),
            serde_json::to_value(&solved.face_orders).map_err(to_js_value)?,
        );
    }
    let folded_base = flatfold_base_snapshot(
        &normalized,
        &solved.analysis.folded_vertices,
        &solved.face_orders,
    );
    let mut simulation_fold = normalized.clone();
    simulation_fold.edges_assignment =
        infer_edge_assignments_from_face_orders(&simulation_fold, &solved.face_orders);
    simulation_fold.edges_fold_angle = simulation_fold
        .edges_assignment
        .iter()
        .copied()
        .map(treemaker_fold::FoldAngle::default_for_assignment)
        .collect();
    let (simulation_model, simulation_model_error) =
        match treemaker_fold::prepare_simulation_model(&simulation_fold) {
            Ok(model) => (Some(model), None),
            Err(error) => (None, Some(error.to_string())),
        };
    let artifacts = ImportedFoldArtifacts {
        fold: fold_value,
        folded_base: Some(folded_base),
        folded_base_error: None,
        simulation_model,
        simulation_model_error,
    };
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    artifacts.serialize(&serializer).map_err(to_js_value)
}

#[wasm_bindgen]
pub fn tree_design(handle: u32) -> std::result::Result<JsValue, JsValue> {
    with_tree(handle, |tree| {
        serde_wasm_bindgen::to_value(&tree.to_design()).map_err(to_js_value)
    })
}

#[wasm_bindgen]
pub fn apply_edit(handle: u32, edit: JsValue) -> std::result::Result<JsValue, JsValue> {
    let edit: TreeEdit = serde_wasm_bindgen::from_value(edit).map_err(to_js_value)?;
    with_tree_mut(handle, |tree| {
        let report = tree.apply_edit(edit).map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&report).map_err(to_js_value)
    })
}

#[wasm_bindgen]
pub fn check(handle: u32) -> std::result::Result<JsValue, JsValue> {
    tree_summary(handle)
}

#[wasm_bindgen]
pub fn cp_status_report(handle: u32) -> std::result::Result<JsValue, JsValue> {
    with_tree(handle, |tree| {
        serde_wasm_bindgen::to_value(&tree.cp_status_report()).map_err(to_js_value)
    })
}

#[wasm_bindgen]
pub fn optimize_scale(handle: u32) -> std::result::Result<JsValue, JsValue> {
    with_tree_mut(handle, |tree| {
        let report = tree.optimize_scale().map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&report).map_err(to_js_value)
    })
}

#[wasm_bindgen]
pub fn optimize_edges(handle: u32) -> std::result::Result<JsValue, JsValue> {
    with_tree_mut(handle, |tree| {
        let report = tree.optimize_edges().map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&report).map_err(to_js_value)
    })
}

#[wasm_bindgen]
pub fn optimize_strain(handle: u32) -> std::result::Result<JsValue, JsValue> {
    with_tree_mut(handle, |tree| {
        let report = tree.optimize_strain().map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&report).map_err(to_js_value)
    })
}

#[wasm_bindgen]
pub fn build_crease_pattern(handle: u32) -> std::result::Result<JsValue, JsValue> {
    with_tree_mut(handle, |tree| {
        tree.build_polys_and_crease_pattern().map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&tree.summary()).map_err(to_js_value)
    })
}

#[wasm_bindgen]
pub fn save_tmd5(handle: u32) -> std::result::Result<String, JsValue> {
    with_tree(handle, |tree| Ok(tree.to_tmd5_string()))
}

#[wasm_bindgen]
pub fn export_v4(handle: u32) -> std::result::Result<String, JsValue> {
    with_tree(handle, |tree| Ok(tree.export_v4_string()))
}

#[wasm_bindgen]
pub fn export_fold(handle: u32) -> std::result::Result<String, JsValue> {
    with_tree(handle, |tree| {
        let fold = tree.to_fold_document().map_err(to_js_error)?;
        serde_json::to_string_pretty(&fold).map_err(to_js_value)
    })
}

#[wasm_bindgen]
pub fn free_tree(handle: u32) -> std::result::Result<(), JsValue> {
    TREES.with(|trees| {
        let mut trees = trees.borrow_mut();
        let slot = trees
            .get_mut(handle as usize)
            .ok_or_else(|| js_error("invalid_handle", "invalid TreeHandle"))?;
        *slot = None;
        Ok(())
    })
}

fn with_tree<T>(
    handle: u32,
    f: impl FnOnce(&Tree) -> std::result::Result<T, JsValue>,
) -> std::result::Result<T, JsValue> {
    TREES.with(|trees| {
        let trees = trees.borrow();
        let tree = trees
            .get(handle as usize)
            .and_then(Option::as_ref)
            .ok_or_else(|| js_error("invalid_handle", "invalid TreeHandle"))?;
        f(tree)
    })
}

fn with_tree_mut<T>(
    handle: u32,
    f: impl FnOnce(&mut Tree) -> std::result::Result<T, JsValue>,
) -> std::result::Result<T, JsValue> {
    TREES.with(|trees| {
        let mut trees = trees.borrow_mut();
        let tree = trees
            .get_mut(handle as usize)
            .and_then(Option::as_mut)
            .ok_or_else(|| js_error("invalid_handle", "invalid TreeHandle"))?;
        f(tree)
    })
}

#[derive(Serialize)]
struct JsErrorEnvelope {
    code: &'static str,
    message: String,
}

fn to_js_error(error: TreeError) -> JsValue {
    js_error(error.code(), error.to_string())
}

fn to_js_flatfold_error(error: FlatFoldError) -> JsValue {
    let message = error.to_string();
    let code = match &error {
        FlatFoldError::InvalidInput(_) => "invalid_input",
        FlatFoldError::PrecisionFailure(_) => "precision_failure",
        FlatFoldError::AssignmentConflict(_) => "assignment_conflict",
        FlatFoldError::UnsatisfiedComponent(_) => "unsatisfied_component",
        FlatFoldError::Unimplemented(_) => "unimplemented",
    };
    js_error(code, message)
}

fn to_js_value(error: impl std::fmt::Display) -> JsValue {
    js_error("js_value", error.to_string())
}

fn js_error(code: &'static str, message: impl Into<String>) -> JsValue {
    serde_wasm_bindgen::to_value(&JsErrorEnvelope {
        code,
        message: message.into(),
    })
    .unwrap_or_else(|_| JsValue::from_str(code))
}

fn flatfold_base_snapshot(
    fold: &FoldDocument,
    folded_vertices: &[[f64; 2]],
    face_orders: &[[i64; 3]],
) -> FoldedBaseSnapshot {
    let border_vertices = border_vertex_flags(fold);
    let layer_order = layer_order_from_face_orders(fold.faces_vertices.len(), face_orders);
    let vertex_count = fold.vertices_coords.len().max(folded_vertices.len());
    FoldedBaseSnapshot {
        vertices: (0..vertex_count)
            .map(|index| {
                let [x, y] = folded_vertices.get(index).copied().unwrap_or_else(|| {
                    let coords = fold.vertices_coords.get(index);
                    [
                        coords
                            .and_then(|coord| coord.first())
                            .copied()
                            .unwrap_or(0.0),
                        coords
                            .and_then(|coord| coord.get(1))
                            .copied()
                            .unwrap_or(0.0),
                    ]
                });
                let paper = fold
                    .vertices_coords
                    .get(index)
                    .and_then(|coords| {
                        (coords.len() >= 2).then(|| Point {
                            x: coords[0],
                            y: coords[1],
                        })
                    })
                    .unwrap_or(Point { x, y });
                FoldedBaseVertex {
                    id: index,
                    source_vertex: index,
                    loc: Point { x, y },
                    paper_loc: paper,
                    depth: 0.0,
                    elevation: 0.0,
                    is_border: border_vertices.get(index).copied().unwrap_or(false),
                }
            })
            .collect(),
        creases: fold
            .edges_vertices
            .iter()
            .enumerate()
            .map(|(index, vertices)| FoldedBaseCrease {
                id: index,
                source_crease: index,
                vertices: *vertices,
                kind: 0,
                fold: fold_number(fold.assignment_for_edge(index)),
            })
            .collect(),
        facets: fold
            .faces_vertices
            .iter()
            .enumerate()
            .map(|(index, vertices)| FoldedBaseFacet {
                id: index,
                source_facet: index,
                vertices: vertices.clone(),
                color: if index % 2 == 0 { 1 } else { 2 },
                order: layer_order.get(index).copied().unwrap_or(index),
            })
            .collect(),
    }
}

fn border_vertex_flags(fold: &FoldDocument) -> Vec<bool> {
    let mut flags = vec![false; fold.vertices_coords.len()];
    for (edge_index, [a, b]) in fold.edges_vertices.iter().copied().enumerate() {
        if fold.assignment_for_edge(edge_index) == Assignment::Boundary {
            if let Some(flag) = flags.get_mut(a) {
                *flag = true;
            }
            if let Some(flag) = flags.get_mut(b) {
                *flag = true;
            }
        }
    }
    flags
}

fn layer_order_from_face_orders(face_count: usize, face_orders: &[[i64; 3]]) -> Vec<usize> {
    let mut scores = vec![0isize; face_count];
    for [above, below, _orientation] in face_orders {
        if let Some(score) = usize::try_from(*above)
            .ok()
            .and_then(|face| scores.get_mut(face))
        {
            *score += 1;
        }
        if let Some(score) = usize::try_from(*below)
            .ok()
            .and_then(|face| scores.get_mut(face))
        {
            *score -= 1;
        }
    }
    let mut faces = (0..face_count).collect::<Vec<_>>();
    faces.sort_by_key(|face| (scores[*face], *face));
    let mut order = vec![0usize; face_count];
    for (rank, face) in faces.into_iter().enumerate() {
        order[face] = rank;
    }
    order
}

fn fold_number(assignment: Assignment) -> i32 {
    match assignment {
        Assignment::Mountain => 1,
        Assignment::Valley => 2,
        Assignment::Boundary => 3,
        Assignment::Flat => 0,
        Assignment::Unassigned | Assignment::Cut | Assignment::Join => 0,
    }
}
