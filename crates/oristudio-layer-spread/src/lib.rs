//! Original display-only geometry. No fold or layer-order search is changed.
//! Heights share material vertices; crossing penalties remain soft.
mod prepare;
mod qp;
mod reference;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const VERSION: &str = "normalized-50-v1";
pub const SPAN: f64 = 0.3;
pub const WARP: f64 = 0.05;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Cell {
    /// Top to bottom, as seen from the canonical front.
    pub faces: Vec<usize>,
    pub point: [f64; 2],
    pub area: f64,
}

/// Canonical folded coordinates, longest extent 2, Y up. Material IDs must
/// not be welded by folded position. Triangulation adds no material vertices.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Input {
    pub xy: Vec<[f64; 2]>,
    pub faces: Vec<Vec<usize>>,
    pub triangles: Vec<[usize; 3]>,
    #[serde(rename = "triangleFaces")]
    pub triangle_faces: Vec<usize>,
    /// Lower, upper. Cycles across different pairs are valid.
    pub orders: Vec<[usize; 2]>,
    pub cells: Vec<Cell>,
    /// Faces joined across flat creases share one plane; absent preserves the prototype.
    #[serde(
        default,
        rename = "planeGroups",
        skip_serializing_if = "Option::is_none"
    )]
    pub plane_groups: Option<Vec<usize>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Reference {
    pub plane: [f64; 3],
    pub center: [f64; 3],
    pub samples: usize,
    pub rms: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Diagnostics {
    pub status: String,
    pub iterations: u32,
    pub qp_seconds: f64,
    pub variables: usize,
    pub constraints: usize,
    pub overlap_regions: usize,
    pub crossing_weight: f64,
    pub opening_scale: f64,
    pub max_relative_warp: f64,
    pub max_slope: f64,
    pub max_crossing: f64,
    pub rms_crossing: f64,
    pub mean_gap: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Solution {
    pub version: String,
    pub heights: Vec<f64>,
    pub references: [Reference; 2],
    pub diagnostics: Diagnostics,
}

#[derive(Debug, Error)]
pub enum SpreadError {
    #[error("Invalid spread geometry: {0}")]
    Invalid(String),
    #[error("Spread resource limit exceeded: {0}")]
    Limit(&'static str),
    #[error("Spread solve failed: {0}")]
    Solve(String),
}

pub fn solve(input: &Input) -> Result<Solution, SpreadError> {
    let prepared = prepare::Prepared::new(input)?;
    qp::solve(input, &prepared)
}
