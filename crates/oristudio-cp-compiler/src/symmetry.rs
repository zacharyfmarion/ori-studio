//! Mirror symmetry of a detected pattern, for the exact solve to enforce.
//!
//! A designed pattern is very often symmetric about a line of its square — the
//! vertical midline most of all, then the horizontal one and the diagonals —
//! and a detection of it is symmetric only up to its noise. Solved on its own,
//! each half converges to its own exact answer, and the two differ by a pixel or
//! so: the pattern folds, but mirror one half over the other and nothing lines
//! up. Detecting the symmetry from the input and holding it during the solve
//! makes the halves one answer.
//!
//! Detection is on the unit square the solve works in: every fold vertex must
//! reflect onto another fold vertex (or lie on the axis) within a tolerance,
//! and every fold crease onto a crease of the same assignment, for at least
//! `min_fraction` of each. Every axis that qualifies is enforced — a base is
//! symmetric about all four — since the constraints of a true symmetry never
//! conflict with each other or with Kawasaki.

use crate::candidate_graph::{CandidateCreaseSpan, CandidateVertex};
use crate::candidates::{AssignmentLabel, Point2};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// A line of the unit square a pattern may be mirrored about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SymmetryAxis {
    /// `x = 0.5`.
    Vertical,
    /// `y = 0.5`.
    Horizontal,
    /// `y = x`.
    Diagonal,
    /// `x + y = 1`.
    AntiDiagonal,
}

impl SymmetryAxis {
    pub const ALL: [SymmetryAxis; 4] = [
        SymmetryAxis::Vertical,
        SymmetryAxis::Horizontal,
        SymmetryAxis::Diagonal,
        SymmetryAxis::AntiDiagonal,
    ];

    /// The mirror image of `point` across this axis.
    pub fn reflect(self, point: Point2) -> Point2 {
        match self {
            SymmetryAxis::Vertical => Point2::new(1.0 - point.x, point.y),
            SymmetryAxis::Horizontal => Point2::new(point.x, 1.0 - point.y),
            SymmetryAxis::Diagonal => Point2::new(point.y, point.x),
            SymmetryAxis::AntiDiagonal => Point2::new(1.0 - point.y, 1.0 - point.x),
        }
    }

    /// The reflection as `image = M·p + c`: `M`, row-major.
    pub fn reflection_matrix(self) -> [[f64; 2]; 2] {
        match self {
            SymmetryAxis::Vertical => [[-1.0, 0.0], [0.0, 1.0]],
            SymmetryAxis::Horizontal => [[1.0, 0.0], [0.0, -1.0]],
            SymmetryAxis::Diagonal => [[0.0, 1.0], [1.0, 0.0]],
            SymmetryAxis::AntiDiagonal => [[0.0, -1.0], [-1.0, 0.0]],
        }
    }

    /// Gradient of [`Self::distance_from`] with respect to the point.
    pub fn distance_gradient(self) -> [f64; 2] {
        let d = 1.0 / std::f64::consts::SQRT_2;
        match self {
            SymmetryAxis::Vertical => [1.0, 0.0],
            SymmetryAxis::Horizontal => [0.0, 1.0],
            SymmetryAxis::Diagonal => [d, -d],
            SymmetryAxis::AntiDiagonal => [d, d],
        }
    }

    /// Signed distance of `point` from the axis, in the unit square.
    pub fn distance_from(self, point: Point2) -> f64 {
        match self {
            SymmetryAxis::Vertical => point.x - 0.5,
            SymmetryAxis::Horizontal => point.y - 0.5,
            SymmetryAxis::Diagonal => (point.x - point.y) / std::f64::consts::SQRT_2,
            SymmetryAxis::AntiDiagonal => (point.x + point.y - 1.0) / std::f64::consts::SQRT_2,
        }
    }
}

/// One axis a pattern was found to be symmetric about, and how.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DetectedSymmetry {
    pub axis: SymmetryAxis,
    /// Vertex pairs that are each other's mirror image, lower id first; each
    /// vertex is in at most one pair.
    pub pairs: Vec<[usize; 2]>,
    /// Vertices that lie on the axis and are their own image.
    pub on_axis: Vec<usize>,
    /// Fold vertices matched, as a fraction of fold vertices.
    pub vertex_fraction: f64,
    /// Fold creases whose image is a crease of the same assignment, as a
    /// fraction of fold creases.
    pub crease_fraction: f64,
}

/// Every axis the pattern is symmetric about, best first. Empty when none
/// reaches the bar. `tolerance` is the largest distance between a vertex's
/// image and its partner, in the unit square.
pub fn detect_symmetries(
    vertices: &[CandidateVertex],
    spans: &[CandidateCreaseSpan],
    tolerance: f64,
    min_fraction: f64,
) -> Vec<DetectedSymmetry> {
    let mut found: Vec<DetectedSymmetry> = symmetry_candidates(vertices, spans, tolerance)
        .into_iter()
        .filter(|candidate| {
            candidate.vertex_fraction >= min_fraction && candidate.crease_fraction >= min_fraction
        })
        .collect();
    found.sort_by(|a, b| {
        b.vertex_fraction
            .min(b.crease_fraction)
            .total_cmp(&a.vertex_fraction.min(a.crease_fraction))
    });
    found
}

/// Every axis, scored, whether or not it reaches any bar — what a report says
/// about a pattern that was *nearly* symmetric.
pub fn symmetry_candidates(
    vertices: &[CandidateVertex],
    spans: &[CandidateCreaseSpan],
    tolerance: f64,
) -> Vec<DetectedSymmetry> {
    let fold_vertex_ids = fold_vertex_ids(vertices, spans);
    if fold_vertex_ids.is_empty() {
        return Vec::new();
    }
    SymmetryAxis::ALL
        .into_iter()
        .map(|axis| score_axis(axis, vertices, spans, &fold_vertex_ids, tolerance))
        .collect()
}

/// Vertices with at least one fold crease: the ones a symmetry is about.
fn fold_vertex_ids(vertices: &[CandidateVertex], spans: &[CandidateCreaseSpan]) -> BTreeSet<usize> {
    let mut ids = BTreeSet::new();
    for span in spans.iter().filter(|span| is_fold_span(span)) {
        for id in span.vertices {
            if id < vertices.len() {
                ids.insert(id);
            }
        }
    }
    ids
}

fn is_fold_span(span: &CandidateCreaseSpan) -> bool {
    !matches!(span.assignment_label(), AssignmentLabel::Boundary)
}

fn score_axis(
    axis: SymmetryAxis,
    vertices: &[CandidateVertex],
    spans: &[CandidateCreaseSpan],
    fold_vertex_ids: &BTreeSet<usize>,
    tolerance: f64,
) -> DetectedSymmetry {
    // Each fold vertex's image: the nearest other fold vertex to its
    // reflection, taken once and nearest first so a pair is not stolen by a
    // vertex with a worse claim; failing that, itself when it sits on the
    // axis. Pairing goes first because a junction the detector split into two
    // vertices straddling the axis is a pair, not two axis vertices — read as
    // the latter, every crease of the pair reflects onto a crease that is not
    // there.
    let mut image: BTreeMap<usize, usize> = BTreeMap::new();
    let mut taken: BTreeSet<usize> = BTreeSet::new();
    let mut candidates: Vec<(f64, usize, usize)> = Vec::new();
    for &id in fold_vertex_ids {
        let reflected = axis.reflect(vertices[id].point);
        for &other in fold_vertex_ids {
            if other == id {
                continue;
            }
            let gap = distance(reflected, vertices[other].point);
            if gap <= tolerance {
                candidates.push((gap, id, other));
            }
        }
    }
    candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut pairs = Vec::new();
    for (_, id, other) in candidates {
        if taken.contains(&id) || taken.contains(&other) {
            continue;
        }
        taken.insert(id);
        taken.insert(other);
        image.insert(id, other);
        image.insert(other, id);
        pairs.push([id.min(other), id.max(other)]);
    }
    let mut on_axis = Vec::new();
    for &id in fold_vertex_ids {
        if !taken.contains(&id) && axis.distance_from(vertices[id].point).abs() <= tolerance / 2.0 {
            on_axis.push(id);
            image.insert(id, id);
        }
    }
    let vertex_fraction = image.len() as f64 / fold_vertex_ids.len() as f64;

    // Every crease's image must be a crease, folded the same way.
    let mut by_ends: BTreeMap<[usize; 2], AssignmentLabel> = BTreeMap::new();
    let fold_spans: Vec<&CandidateCreaseSpan> =
        spans.iter().filter(|span| is_fold_span(span)).collect();
    for span in &fold_spans {
        let [a, b] = span.vertices;
        by_ends.insert([a.min(b), a.max(b)], span.assignment_label());
    }
    let crease_matches = |span: &CandidateCreaseSpan| {
        let [a, b] = span.vertices;
        let (Some(&a2), Some(&b2)) = (image.get(&a), image.get(&b)) else {
            return false;
        };
        by_ends.get(&[a2.min(b2), a2.max(b2)]) == Some(&span.assignment_label())
    };
    let matched_creases = fold_spans
        .iter()
        .filter(|span| crease_matches(span))
        .count();
    let crease_fraction = if fold_spans.is_empty() {
        0.0
    } else {
        matched_creases as f64 / fold_spans.len() as f64
    };
    // A pair is held only when its creases agree: most of the creases at either
    // vertex must reflect onto a crease at the other. Two distinct vertices that
    // happen to sit near each other's image would otherwise be pulled together
    // on the strength of position alone.
    pairs.retain(|&[a, b]| {
        let (mut total, mut matched) = (0usize, 0usize);
        for span in &fold_spans {
            if span.vertices.contains(&a) || span.vertices.contains(&b) {
                total += 1;
                if crease_matches(span) {
                    matched += 1;
                }
            }
        }
        total > 0 && matched * 2 >= total
    });
    pairs.sort_unstable();
    on_axis.sort_unstable();
    DetectedSymmetry {
        axis,
        pairs,
        on_axis,
        vertex_fraction,
        crease_fraction,
    }
}

fn distance(a: Point2, b: Point2) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

/// The largest departure from `symmetry` at `points`: over the pairs, the
/// distance between a vertex's image and its partner; over the axis vertices,
/// their distance from the axis.
pub fn mirror_error(symmetry: &DetectedSymmetry, points: &[Point2]) -> f64 {
    let pairs = symmetry.pairs.iter().filter_map(|&[a, b]| {
        Some(distance(
            symmetry.axis.reflect(*points.get(a)?),
            *points.get(b)?,
        ))
    });
    let axis = symmetry
        .on_axis
        .iter()
        .filter_map(|&id| Some(symmetry.axis.distance_from(*points.get(id)?).abs()));
    pairs.chain(axis).fold(0.0_f64, f64::max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reflections_are_involutions_and_fix_their_axis() {
        let p = Point2::new(0.2, 0.7);
        for axis in SymmetryAxis::ALL {
            let back = axis.reflect(axis.reflect(p));
            assert!((back.x - p.x).abs() < 1e-12 && (back.y - p.y).abs() < 1e-12);
        }
        assert_eq!(
            SymmetryAxis::Vertical.reflect(Point2::new(0.5, 0.3)),
            Point2::new(0.5, 0.3)
        );
        assert!((SymmetryAxis::Diagonal.distance_from(Point2::new(0.4, 0.4))).abs() < 1e-12);
        assert!((SymmetryAxis::AntiDiagonal.distance_from(Point2::new(0.3, 0.7))).abs() < 1e-12);
    }
}
