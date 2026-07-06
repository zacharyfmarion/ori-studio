//! Generic FOLD document data structures and geometry helpers.
//!
//! This crate deliberately contains no TreeMaker model code. Applications can
//! store app-specific information in `extra` fields with namespaced keys such
//! as `tm:facetOrder`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Crate-local result type.
pub type Result<T> = std::result::Result<T, FoldError>;

/// Error returned by validation and geometry preparation.
#[derive(Debug, thiserror::Error, PartialEq)]
pub enum FoldError {
    #[error("FOLD document must contain at least one vertex")]
    EmptyVertices,
    #[error("edge {edge} references vertex {vertex}; valid range is 0..{max}")]
    BadEdgeVertex {
        edge: usize,
        vertex: usize,
        max: usize,
    },
    #[error("face {face} references vertex {vertex}; valid range is 0..{max}")]
    BadFaceVertex {
        face: usize,
        vertex: usize,
        max: usize,
    },
    #[error("edge {edge} must contain exactly two vertices")]
    BadEdgeArity { edge: usize },
    #[error("face {face} must contain at least three vertices")]
    BadFaceArity { face: usize },
    #[error("edges_assignment length {actual} does not match edges_vertices length {expected}")]
    AssignmentLength { expected: usize, actual: usize },
    #[error("edges_foldAngle length {actual} does not match edges_vertices length {expected}")]
    FoldAngleLength { expected: usize, actual: usize },
    #[error("face {face} edge [{a}, {b}] is missing from edges_vertices")]
    MissingFaceEdge { face: usize, a: usize, b: usize },
    #[error("edge {edge} is incident to more than two faces")]
    NonManifoldEdge { edge: usize },
    #[error("edge {edge} cannot provide crease parameters without two adjacent triangular faces")]
    BadCreaseTopology { edge: usize },
    #[error("face {face} could not be triangulated")]
    Triangulation { face: usize },
}

/// Common FOLD edge assignment values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Assignment {
    Boundary,
    Mountain,
    Valley,
    Flat,
    Unassigned,
    Cut,
    Join,
}

impl Assignment {
    pub fn as_str(self) -> &'static str {
        match self {
            Assignment::Boundary => "B",
            Assignment::Mountain => "M",
            Assignment::Valley => "V",
            Assignment::Flat => "F",
            Assignment::Unassigned => "U",
            Assignment::Cut => "C",
            Assignment::Join => "J",
        }
    }

    pub fn is_driven_crease(self) -> bool {
        matches!(
            self,
            Assignment::Mountain | Assignment::Valley | Assignment::Flat
        )
    }
}

impl TryFrom<&str> for Assignment {
    type Error = String;

    fn try_from(value: &str) -> std::result::Result<Self, Self::Error> {
        match value {
            "B" => Ok(Assignment::Boundary),
            "M" => Ok(Assignment::Mountain),
            "V" => Ok(Assignment::Valley),
            "F" => Ok(Assignment::Flat),
            "U" => Ok(Assignment::Unassigned),
            "C" => Ok(Assignment::Cut),
            "J" => Ok(Assignment::Join),
            other => Err(format!("unsupported FOLD assignment {other:?}")),
        }
    }
}

impl Serialize for Assignment {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for Assignment {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Assignment::try_from(value.as_str()).map_err(serde::de::Error::custom)
    }
}

/// Helpers for conventional simulator target fold angles in degrees.
pub struct FoldAngle;

impl FoldAngle {
    pub const FLAT: f64 = 0.0;
    pub const FULL_VALLEY: f64 = 180.0;
    pub const FULL_MOUNTAIN: f64 = -180.0;

    pub fn default_for_assignment(assignment: Assignment) -> Option<f64> {
        match assignment {
            Assignment::Mountain => Some(Self::FULL_MOUNTAIN),
            Assignment::Valley => Some(Self::FULL_VALLEY),
            Assignment::Flat => Some(Self::FLAT),
            Assignment::Boundary | Assignment::Unassigned | Assignment::Cut | Assignment::Join => {
                None
            }
        }
    }
}

/// FOLD document fields used by crease-pattern and simulator workflows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FoldDocument {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_spec: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_creator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_parent: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_inherit: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub frame_classes: Vec<String>,
    pub vertices_coords: Vec<Vec<f64>>,
    pub edges_vertices: Vec<[usize; 2]>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edges_assignment: Vec<Assignment>,
    #[serde(
        rename = "edges_foldAngle",
        default,
        skip_serializing_if = "Vec::is_empty"
    )]
    pub edges_fold_angle: Vec<Option<f64>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edges_faces: Vec<Vec<usize>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub faces_vertices: Vec<Vec<usize>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub faces_edges: Vec<Vec<usize>>,
    #[serde(
        rename = "faceOrders",
        alias = "face_orders",
        default,
        skip_serializing_if = "Vec::is_empty"
    )]
    pub face_orders: Vec<[i64; 3]>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub file_frames: Vec<FoldDocument>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl FoldDocument {
    pub fn new(vertices_coords: Vec<Vec<f64>>, edges_vertices: Vec<[usize; 2]>) -> Self {
        Self {
            file_spec: Some(1.2),
            file_creator: None,
            file_author: None,
            file_title: None,
            frame_title: None,
            frame_parent: None,
            frame_inherit: None,
            frame_classes: Vec::new(),
            vertices_coords,
            edges_vertices,
            edges_assignment: Vec::new(),
            edges_fold_angle: Vec::new(),
            edges_faces: Vec::new(),
            faces_vertices: Vec::new(),
            faces_edges: Vec::new(),
            face_orders: Vec::new(),
            file_frames: Vec::new(),
            extra: BTreeMap::new(),
        }
    }

    pub fn assignment_for_edge(&self, edge: usize) -> Assignment {
        self.edges_assignment
            .get(edge)
            .copied()
            .unwrap_or(Assignment::Unassigned)
    }

    pub fn fold_angle_for_edge(&self, edge: usize) -> Option<f64> {
        self.edges_fold_angle
            .get(edge)
            .copied()
            .flatten()
            .or_else(|| FoldAngle::default_for_assignment(self.assignment_for_edge(edge)))
    }
}

/// Simulator-ready crease metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreaseParameter {
    pub face1: usize,
    pub vertex1: usize,
    pub face2: usize,
    pub vertex2: usize,
    pub edge: usize,
    pub target_angle: f64,
}

/// Generic prepared model shape suitable for browser-side simulation packages.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PreparedFoldModel {
    pub fold: FoldDocument,
    pub crease_params: Vec<CreaseParameter>,
}

/// Validate a FOLD document's basic internal references.
pub fn validate_basic(fold: &FoldDocument) -> Result<()> {
    if fold.vertices_coords.is_empty() {
        return Err(FoldError::EmptyVertices);
    }
    let max = fold.vertices_coords.len();
    for (edge_index, edge) in fold.edges_vertices.iter().enumerate() {
        for vertex in edge {
            if *vertex >= max {
                return Err(FoldError::BadEdgeVertex {
                    edge: edge_index,
                    vertex: *vertex,
                    max,
                });
            }
        }
    }
    for (face_index, face) in fold.faces_vertices.iter().enumerate() {
        if face.len() < 3 {
            return Err(FoldError::BadFaceArity { face: face_index });
        }
        for vertex in face {
            if *vertex >= max {
                return Err(FoldError::BadFaceVertex {
                    face: face_index,
                    vertex: *vertex,
                    max,
                });
            }
        }
    }
    if !fold.edges_assignment.is_empty() && fold.edges_assignment.len() != fold.edges_vertices.len()
    {
        return Err(FoldError::AssignmentLength {
            expected: fold.edges_vertices.len(),
            actual: fold.edges_assignment.len(),
        });
    }
    if !fold.edges_fold_angle.is_empty() && fold.edges_fold_angle.len() != fold.edges_vertices.len()
    {
        return Err(FoldError::FoldAngleLength {
            expected: fold.edges_vertices.len(),
            actual: fold.edges_fold_angle.len(),
        });
    }
    Ok(())
}

/// Build `faces_edges` by matching each face boundary against `edges_vertices`.
pub fn build_faces_edges(fold: &FoldDocument) -> Result<Vec<Vec<usize>>> {
    validate_basic(fold)?;
    let mut faces_edges = Vec::with_capacity(fold.faces_vertices.len());
    for (face_index, face) in fold.faces_vertices.iter().enumerate() {
        let mut face_edges = Vec::with_capacity(face.len());
        for window in cyclic_pairs(face) {
            let edge = find_edge(&fold.edges_vertices, window[0], window[1]).ok_or(
                FoldError::MissingFaceEdge {
                    face: face_index,
                    a: window[0],
                    b: window[1],
                },
            )?;
            face_edges.push(edge);
        }
        faces_edges.push(face_edges);
    }
    Ok(faces_edges)
}

/// Build `edges_faces` from `faces_edges`.
pub fn build_edges_faces(fold: &FoldDocument) -> Result<Vec<Vec<usize>>> {
    let faces_edges = if fold.faces_edges.is_empty() {
        build_faces_edges(fold)?
    } else {
        fold.faces_edges.clone()
    };
    let mut edges_faces = vec![Vec::new(); fold.edges_vertices.len()];
    for (face_index, face_edges) in faces_edges.iter().enumerate() {
        for edge in face_edges {
            if *edge >= edges_faces.len() {
                return Err(FoldError::MissingFaceEdge {
                    face: face_index,
                    a: 0,
                    b: 0,
                });
            }
            let faces = &mut edges_faces[*edge];
            if faces.len() >= 2 {
                return Err(FoldError::NonManifoldEdge { edge: *edge });
            }
            faces.push(face_index);
        }
    }
    Ok(edges_faces)
}

/// Return a cloned document with all faces triangulated and adjacency fields rebuilt.
pub fn triangulate_faces(fold: &FoldDocument) -> Result<FoldDocument> {
    validate_basic(fold)?;
    let mut next = fold.clone();
    let original_edges = next.edges_vertices.clone();
    let original_faces = next.faces_vertices.clone();
    let mut triangulated = Vec::new();

    for (face_index, face) in original_faces.iter().enumerate() {
        match face.len() {
            0..=2 => return Err(FoldError::BadFaceArity { face: face_index }),
            3 => triangulated.push(face.clone()),
            4 => triangulate_quad(&mut next, face, &mut triangulated),
            _ => triangulate_polygon(&mut next, face_index, face, &mut triangulated)?,
        }
    }

    next.faces_vertices = triangulated;
    add_missing_flat_triangle_edges(&mut next, &original_edges);
    next.faces_edges = build_faces_edges(&next)?;
    next.edges_faces = build_edges_faces(&next)?;
    Ok(next)
}

/// Prepare triangulated FOLD geometry and crease parameters for a simulator.
pub fn prepare_simulation_model(fold: &FoldDocument) -> Result<PreparedFoldModel> {
    let triangulated = triangulate_faces(fold)?;
    let crease_params = build_crease_params(&triangulated)?;
    Ok(PreparedFoldModel {
        fold: triangulated,
        crease_params,
    })
}

fn build_crease_params(fold: &FoldDocument) -> Result<Vec<CreaseParameter>> {
    let edges_faces = if fold.edges_faces.is_empty() {
        build_edges_faces(fold)?
    } else {
        fold.edges_faces.clone()
    };
    let mut params = Vec::new();
    for (edge_index, faces) in edges_faces.iter().enumerate() {
        let assignment = fold.assignment_for_edge(edge_index);
        if !assignment.is_driven_crease() {
            continue;
        }
        let Some(target_angle) = fold.fold_angle_for_edge(edge_index) else {
            continue;
        };
        if faces.len() != 2 {
            if assignment == Assignment::Flat {
                continue;
            }
            return Err(FoldError::BadCreaseTopology { edge: edge_index });
        }
        let [a, b] = fold.edges_vertices[edge_index];
        let mut face1_index = faces[0];
        let mut face2_index = faces[1];
        let face1 = &fold.faces_vertices[face1_index];
        let face2 = &fold.faces_vertices[face2_index];
        if face1.len() != 3 || face2.len() != 3 {
            if assignment == Assignment::Flat {
                continue;
            }
            return Err(FoldError::BadCreaseTopology { edge: edge_index });
        }
        let Some(mut vertex1) = opposite_triangle_vertex(face1, a, b) else {
            if assignment == Assignment::Flat {
                continue;
            }
            return Err(FoldError::BadCreaseTopology { edge: edge_index });
        };
        let Some(mut vertex2) = opposite_triangle_vertex(face2, a, b) else {
            if assignment == Assignment::Flat {
                continue;
            }
            return Err(FoldError::BadCreaseTopology { edge: edge_index });
        };
        let Some(v1_index) = face2.iter().position(|vertex| *vertex == a) else {
            if assignment == Assignment::Flat {
                continue;
            }
            return Err(FoldError::BadCreaseTopology { edge: edge_index });
        };
        let Some(v2_index) = face2.iter().position(|vertex| *vertex == b) else {
            if assignment == Assignment::Flat {
                continue;
            }
            return Err(FoldError::BadCreaseTopology { edge: edge_index });
        };
        if v2_index as isize - v1_index as isize == 1 || v2_index as isize - v1_index as isize == -2
        {
            std::mem::swap(&mut face1_index, &mut face2_index);
            std::mem::swap(&mut vertex1, &mut vertex2);
        }
        params.push(CreaseParameter {
            face1: face1_index,
            vertex1,
            face2: face2_index,
            vertex2,
            edge: edge_index,
            target_angle,
        });
    }
    Ok(params)
}

fn triangulate_quad(fold: &mut FoldDocument, face: &[usize], out: &mut Vec<Vec<usize>>) {
    let d1 = distance_sq(fold, face[0], face[2]);
    let d2 = distance_sq(fold, face[1], face[3]);
    if d2 < d1 {
        push_flat_edge(fold, [face[1], face[3]]);
        out.push(vec![face[0], face[1], face[3]]);
        out.push(vec![face[1], face[2], face[3]]);
    } else {
        push_flat_edge(fold, [face[0], face[2]]);
        out.push(vec![face[0], face[1], face[2]]);
        out.push(vec![face[0], face[2], face[3]]);
    }
}

fn triangulate_polygon(
    fold: &mut FoldDocument,
    face_index: usize,
    face: &[usize],
    out: &mut Vec<Vec<usize>>,
) -> Result<()> {
    let mut coords = Vec::with_capacity(face.len() * 2);
    for vertex in face {
        let coord = &fold.vertices_coords[*vertex];
        coords.push(coord.first().copied().unwrap_or(0.0));
        coords.push(coord.get(1).copied().unwrap_or(0.0));
    }
    let triangles = earcutr::earcut(&coords, &[], 2)
        .map_err(|_| FoldError::Triangulation { face: face_index })?;
    if triangles.len() < 3 {
        return Err(FoldError::Triangulation { face: face_index });
    }
    for triangle in triangles.chunks_exact(3) {
        out.push(vec![
            face[triangle[0]],
            face[triangle[1]],
            face[triangle[2]],
        ]);
    }
    Ok(())
}

fn add_missing_flat_triangle_edges(fold: &mut FoldDocument, original_edges: &[[usize; 2]]) {
    let faces = fold.faces_vertices.clone();
    for face in faces {
        for pair in cyclic_pairs(&face) {
            let exists = find_edge(&fold.edges_vertices, pair[0], pair[1]).is_some()
                || original_edges
                    .iter()
                    .any(|edge| same_edge(*edge, pair[0], pair[1]));
            if !exists {
                push_flat_edge(fold, [pair[0], pair[1]]);
            }
        }
    }
}

fn push_flat_edge(fold: &mut FoldDocument, edge: [usize; 2]) {
    if find_edge(&fold.edges_vertices, edge[0], edge[1]).is_some() {
        return;
    }
    fold.edges_vertices.push(edge);
    if !fold.edges_assignment.is_empty() {
        fold.edges_assignment.push(Assignment::Flat);
    }
    if !fold.edges_fold_angle.is_empty() {
        fold.edges_fold_angle.push(Some(FoldAngle::FLAT));
    }
}

fn cyclic_pairs(face: &[usize]) -> impl Iterator<Item = [usize; 2]> + '_ {
    face.iter()
        .copied()
        .zip(face.iter().copied().cycle().skip(1))
        .take(face.len())
        .map(|(a, b)| [a, b])
}

fn find_edge(edges: &[[usize; 2]], a: usize, b: usize) -> Option<usize> {
    edges.iter().position(|edge| same_edge(*edge, a, b))
}

fn same_edge(edge: [usize; 2], a: usize, b: usize) -> bool {
    (edge[0] == a && edge[1] == b) || (edge[0] == b && edge[1] == a)
}

fn distance_sq(fold: &FoldDocument, a: usize, b: usize) -> f64 {
    let a = &fold.vertices_coords[a];
    let b = &fold.vertices_coords[b];
    let ax = a.first().copied().unwrap_or(0.0);
    let ay = a.get(1).copied().unwrap_or(0.0);
    let bx = b.first().copied().unwrap_or(0.0);
    let by = b.get(1).copied().unwrap_or(0.0);
    let dx = ax - bx;
    let dy = ay - by;
    dx * dx + dy * dy
}

fn opposite_triangle_vertex(face: &[usize], a: usize, b: usize) -> Option<usize> {
    face.iter()
        .copied()
        .find(|vertex| *vertex != a && *vertex != b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square_doc() -> FoldDocument {
        let mut doc = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
            ],
            vec![[0, 1], [1, 2], [2, 3], [3, 0]],
        );
        doc.edges_assignment = vec![Assignment::Boundary; 4];
        doc.edges_fold_angle = vec![None; 4];
        doc.faces_vertices = vec![vec![0, 1, 2, 3]];
        doc
    }

    #[test]
    fn assignment_serializes_as_fold_code() {
        let json = serde_json::to_string(&vec![Assignment::Mountain, Assignment::Valley]).unwrap();
        assert_eq!(json, r#"["M","V"]"#);
        let parsed: Vec<Assignment> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, vec![Assignment::Mountain, Assignment::Valley]);
    }

    #[test]
    fn fold_angle_defaults_match_simulator_signs() {
        assert_eq!(
            FoldAngle::default_for_assignment(Assignment::Mountain),
            Some(-180.0)
        );
        assert_eq!(
            FoldAngle::default_for_assignment(Assignment::Valley),
            Some(180.0)
        );
        assert_eq!(
            FoldAngle::default_for_assignment(Assignment::Flat),
            Some(0.0)
        );
    }

    #[test]
    fn fold_document_serializes_face_orders_with_spec_key() {
        let mut doc = square_doc();
        doc.face_orders = vec![[0, 1, 1]];

        let value = serde_json::to_value(&doc).unwrap();

        assert_eq!(value["faceOrders"], serde_json::json!([[0, 1, 1]]));
        assert!(value.get("face_orders").is_none());
    }

    #[test]
    fn fold_document_deserializes_legacy_snake_case_face_orders() {
        let doc: FoldDocument = serde_json::from_value(serde_json::json!({
            "file_spec": 1.2,
            "vertices_coords": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]],
            "edges_vertices": [[0, 1], [1, 2], [2, 0]],
            "faces_vertices": [[0, 1, 2]],
            "face_orders": [[0, 0, 0]]
        }))
        .unwrap();

        assert_eq!(doc.face_orders, vec![[0, 0, 0]]);
    }

    #[test]
    fn fold_document_deserializes_signed_face_order_orientation() {
        let doc: FoldDocument = serde_json::from_value(serde_json::json!({
            "file_spec": 1.2,
            "vertices_coords": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
            "edges_vertices": [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
            "faces_vertices": [[0, 1, 2], [0, 2, 3]],
            "faceOrders": [[0, 1, -1]]
        }))
        .unwrap();

        assert_eq!(doc.face_orders, vec![[0, 1, -1]]);
    }

    #[test]
    fn fold_document_preserves_embedded_file_frames() {
        let doc: FoldDocument = serde_json::from_value(serde_json::json!({
            "file_spec": 1.2,
            "file_title": "multi-frame sample",
            "file_classes": ["multiModel"],
            "frame_title": "root cp",
            "frame_classes": ["creasePattern"],
            "vertices_coords": [[0.0, 0.0], [1.0, 0.0]],
            "edges_vertices": [[0, 1]],
            "file_frames": [
                {
                    "frame_title": "working cp",
                    "frame_classes": ["creasePattern"],
                    "vertices_coords": [[0.0, 0.0], [2.0, 0.0]],
                    "edges_vertices": [[0, 1]]
                },
                {
                    "frame_title": "folded result",
                    "frame_classes": ["foldedForm"],
                    "frame_parent": 1,
                    "frame_inherit": true,
                    "vertices_coords": [[0.0, 0.0], [0.5, 0.0], [0.0, 0.5]],
                    "edges_vertices": [[0, 1], [1, 2], [2, 0]],
                    "faces_vertices": [[0, 1, 2]],
                    "faceOrders": [[0, 0, -1]],
                    "oriedita:folded_view": {"displayStyle": "paper"}
                }
            ]
        }))
        .unwrap();

        assert_eq!(doc.file_title.as_deref(), Some("multi-frame sample"));
        assert_eq!(doc.frame_classes, vec!["creasePattern"]);
        assert!(!doc.extra.contains_key("file_frames"));
        assert_eq!(doc.extra["file_classes"], serde_json::json!(["multiModel"]));
        assert_eq!(doc.file_frames.len(), 2);
        assert_eq!(
            doc.file_frames[1].frame_title.as_deref(),
            Some("folded result")
        );
        assert_eq!(doc.file_frames[1].frame_classes, vec!["foldedForm"]);
        assert_eq!(doc.file_frames[1].frame_parent, Some(1));
        assert_eq!(doc.file_frames[1].frame_inherit, Some(true));
        assert_eq!(doc.file_frames[1].face_orders, vec![[0, 0, -1]]);
        assert_eq!(
            doc.file_frames[1].extra["oriedita:folded_view"],
            serde_json::json!({"displayStyle": "paper"})
        );

        let value = serde_json::to_value(&doc).unwrap();
        assert_eq!(value["file_title"], "multi-frame sample");
        assert_eq!(value["file_frames"][1]["frame_parent"], 1);
        assert_eq!(value["file_frames"][1]["frame_inherit"], true);
        assert_eq!(
            value["file_frames"][1]["frame_classes"],
            serde_json::json!(["foldedForm"])
        );
        assert_eq!(
            value["file_frames"][1]["faceOrders"],
            serde_json::json!([[0, 0, -1]])
        );
        assert_eq!(
            value["file_frames"][1]["oriedita:folded_view"],
            serde_json::json!({"displayStyle": "paper"})
        );
    }

    #[test]
    fn fold_document_skips_empty_embedded_file_frames() {
        let value = serde_json::to_value(square_doc()).unwrap();

        assert!(value.get("file_frames").is_none());
    }

    #[test]
    fn triangulates_quad_and_builds_adjacency() {
        let doc = triangulate_faces(&square_doc()).unwrap();
        assert_eq!(doc.faces_vertices.len(), 2);
        assert_eq!(doc.edges_vertices.len(), 5);
        assert_eq!(doc.faces_edges.len(), 2);
        assert_eq!(doc.edges_faces[4], vec![0, 1]);
        assert_eq!(doc.edges_assignment[4], Assignment::Flat);
        assert_eq!(doc.edges_fold_angle[4], Some(0.0));
    }

    #[test]
    fn prepares_simulation_crease_params() {
        let mut doc = square_doc();
        doc.edges_vertices.push([0, 2]);
        doc.edges_assignment.push(Assignment::Mountain);
        doc.edges_fold_angle.push(Some(-180.0));
        doc.faces_vertices = vec![vec![0, 1, 2], vec![0, 2, 3]];

        let prepared = prepare_simulation_model(&doc).unwrap();
        assert_eq!(prepared.crease_params.len(), 1);
        assert_eq!(prepared.crease_params[0].edge, 4);
        assert_eq!(prepared.crease_params[0].face1, 1);
        assert_eq!(prepared.crease_params[0].vertex1, 3);
        assert_eq!(prepared.crease_params[0].face2, 0);
        assert_eq!(prepared.crease_params[0].vertex2, 1);
        assert_eq!(prepared.crease_params[0].target_angle, -180.0);
    }

    #[test]
    fn skips_one_sided_flat_edges_for_simulation_crease_params() {
        let mut doc = FoldDocument::new(
            vec![vec![0.0, 0.0], vec![1.0, 0.0], vec![0.0, 1.0]],
            vec![[0, 1], [1, 2], [2, 0]],
        );
        doc.edges_assignment = vec![Assignment::Flat, Assignment::Boundary, Assignment::Boundary];
        doc.edges_fold_angle = vec![Some(0.0), None, None];
        doc.faces_vertices = vec![vec![0, 1, 2]];

        let prepared = prepare_simulation_model(&doc).unwrap();

        assert!(prepared.crease_params.is_empty());
    }

    #[test]
    fn rejects_one_sided_mountain_edges_for_simulation_crease_params() {
        let mut doc = FoldDocument::new(
            vec![vec![0.0, 0.0], vec![1.0, 0.0], vec![0.0, 1.0]],
            vec![[0, 1], [1, 2], [2, 0]],
        );
        doc.edges_assignment = vec![
            Assignment::Mountain,
            Assignment::Boundary,
            Assignment::Boundary,
        ];
        doc.edges_fold_angle = vec![Some(-180.0), None, None];
        doc.faces_vertices = vec![vec![0, 1, 2]];

        let error = prepare_simulation_model(&doc).unwrap_err();

        assert_eq!(error, FoldError::BadCreaseTopology { edge: 0 });
    }
}
