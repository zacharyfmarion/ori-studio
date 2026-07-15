use super::cp::number_string;
use crate::error::BpResult;
use crate::model::Project;
use crate::sweep::{CpLine, CreaseType};
use serde::Serialize;
use serde::Serializer;
use std::collections::BTreeMap;

pub fn to_fold(lines: &[CpLine], project: &Project) -> BpResult<String> {
    let mut vertices = VertexSet::default();
    let edges = lines
        .iter()
        .map(|line| {
            let assignment = assignment(line.crease_type);
            Edge {
                assignment,
                p1: vertices.add(line.p1.x, line.p1.y),
                p2: vertices.add(line.p2.x, line.p2.y),
            }
        })
        .collect::<Vec<_>>();

    Ok(serde_json::to_string(&FoldDocument {
        file_spec: 1.1,
        file_creator: "Box Pleating Studio",
        file_title: &project.design.title,
        file_description: project.design.description.as_deref(),
        vertices_coords: vertices.list(),
        edges_vertices: edges.iter().map(|edge| [edge.p1, edge.p2]).collect(),
        edges_assignment: edges.iter().map(|edge| edge.assignment).collect(),
        edges_fold_angle: edges
            .iter()
            .map(|edge| fold_angle(edge.assignment))
            .collect(),
    })?)
}

#[derive(Debug, Serialize)]
struct FoldDocument<'a> {
    file_spec: f64,
    file_creator: &'static str,
    file_title: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_description: Option<&'a str>,
    vertices_coords: Vec<[JsonNumber; 2]>,
    edges_vertices: Vec<[usize; 2]>,
    edges_assignment: Vec<Assignment>,
    #[serde(rename = "edges_foldAngle")]
    edges_fold_angle: Vec<i32>,
}

#[derive(Debug, Clone, Copy)]
struct Edge {
    assignment: Assignment,
    p1: usize,
    p2: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
enum Assignment {
    B,
    M,
    V,
    F,
    U,
}

#[derive(Debug, Default)]
struct VertexSet {
    keys: BTreeMap<String, usize>,
    vertices: Vec<[JsonNumber; 2]>,
}

impl VertexSet {
    fn add(&mut self, x: f64, y: f64) -> usize {
        let key = format!("{},{}", number_string(x), number_string(y));
        if let Some(index) = self.keys.get(&key) {
            return *index;
        }
        let index = self.vertices.len();
        self.vertices.push([JsonNumber(x), JsonNumber(y)]);
        self.keys.insert(key, index);
        index
    }

    fn list(self) -> Vec<[JsonNumber; 2]> {
        self.vertices
    }
}

#[derive(Debug, Clone, Copy)]
struct JsonNumber(f64);

impl Serialize for JsonNumber {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let value = if self.0 == 0.0 { 0.0 } else { self.0 };
        if value.is_finite()
            && value.fract() == 0.0
            && value >= i64::MIN as f64
            && value <= i64::MAX as f64
        {
            serializer.serialize_i64(value as i64)
        } else {
            serializer.serialize_f64(value)
        }
    }
}

fn assignment(crease_type: CreaseType) -> Assignment {
    match crease_type {
        CreaseType::Border => Assignment::B,
        CreaseType::None => Assignment::U,
        CreaseType::Auxiliary => Assignment::F,
        CreaseType::Mountain => Assignment::M,
        CreaseType::Valley => Assignment::V,
    }
}

fn fold_angle(assignment: Assignment) -> i32 {
    match assignment {
        Assignment::M => -180,
        Assignment::V => 180,
        _ => 0,
    }
}
