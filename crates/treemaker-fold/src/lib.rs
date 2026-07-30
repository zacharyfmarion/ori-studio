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
}
