//! Compact measurements from a source raster. These are observations, never
//! pins, topology edits, or permission to exceed the original movement budget.
use crate::{AssignmentLabel, Point2};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceLineFit {
    pub span_id: usize,
    pub vertices: [usize; 2],
    pub assignment: AssignmentLabel,
    /// Unit normal in paper coordinates; n · p = rho.
    pub normal: Point2,
    pub rho: f64,
    pub length_pixels: f64,
    pub sigma_pixels: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceImageEvidence {
    /// The graph positions used for measurement, for detecting stale evidence.
    pub observed_vertices: Vec<Point2>,
    pub pixels_per_unit: f64,
    pub lines: Vec<SourceLineFit>,
    /// A source-only least-squares starting point, not the final answer.
    pub fitted_vertices: Vec<Point2>,
}
