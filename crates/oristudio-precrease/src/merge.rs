//! Collinear segments become one line.
//!
//! The merge runs in **unit-sheet coordinates** (after the component's frame
//! is known) so that [`TOL`] means what the tolerance policy says it means.
//! `analyze` guarantees this; callers of [`merge_segments`] directly are
//! responsible for normalising first.

use serde::{Deserialize, Serialize};

use crate::line::{Line, LineIndex};
use crate::tol::TOL;

/// Oriedita colour codes mapped to what the planner cares about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineKind {
    /// Colour 0 (`Black0`): the sheet outline.
    Border,
    /// Colour 1.
    Mountain,
    /// Colour 2.
    Valley,
    /// Colour 3 (`Cyan3`) and every other positive colour: a guide line.
    Auxiliary,
    /// Negative codes: no assignment.
    Unassigned,
}

impl LineKind {
    /// From an Oriedita colour code: 0 border, 1 mountain, 2 valley, 3 and
    /// other positive values auxiliary, negative unassigned.
    pub fn from_color(color: i32) -> LineKind {
        match color {
            0 => LineKind::Border,
            1 => LineKind::Mountain,
            2 => LineKind::Valley,
            c if c < 0 => LineKind::Unassigned,
            _ => LineKind::Auxiliary,
        }
    }
}

/// One distinct infinite line and the segments that lie on it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MergedLine {
    /// The line in unit-sheet coordinates (the longest segment's line).
    pub line: Line,
    /// Indices of the segments on it, in the caller's numbering.
    pub segment_indices: Vec<u32>,
    /// Every segment on the line is a border segment.
    pub is_border: bool,
    /// Distinct kinds among the segments, sorted.
    pub kinds: Vec<LineKind>,
    /// Largest distance of any of its segments' endpoints from `line`.
    pub merge_residual: f64,
    /// The line coincides with one of the sheet's four edges (set by the
    /// component split; `false` from a bare merge).
    pub on_outline: bool,
    /// Length of the longest segment on the line, unit units.
    pub longest_segment: f64,
}

/// Result of a merge: the distinct lines plus, per input segment, the line
/// it went to (`None` for a zero-length segment that was skipped).
#[derive(Debug, Clone, PartialEq)]
pub struct MergeResult {
    pub lines: Vec<MergedLine>,
    pub segment_line: Vec<Option<u32>>,
    pub skipped_zero_length: Vec<u32>,
}

/// Merge `segments` (unit-sheet `[x1, y1, x2, y2]` each) into distinct lines
/// within `TOL`. `kinds[i]` and `indices[i]` (the caller's numbering)
/// describe segment `i`; `indices` may be `None` for identity numbering.
/// Segments shorter than `TOL` are skipped.
pub fn merge_segments(
    segments: &[[f64; 4]],
    kinds: &[LineKind],
    indices: Option<&[u32]>,
) -> MergeResult {
    let mut index = LineIndex::new(TOL);
    let mut lines: Vec<MergedLine> = Vec::new();
    let mut segment_line = vec![None; segments.len()];
    let mut skipped = Vec::new();

    for (i, seg) in segments.iter().enumerate() {
        let external = indices.map_or(i as u32, |ix| ix[i]);
        let kind = kinds.get(i).copied().unwrap_or(LineKind::Unassigned);
        let p = [seg[0], seg[1]];
        let q = [seg[2], seg[3]];
        let length = ((q[0] - p[0]).powi(2) + (q[1] - p[1]).powi(2)).sqrt();
        let Some(line) = Line::from_points(p, q) else {
            skipped.push(external);
            continue;
        };
        let (id, inserted) = index.insert(line);
        if inserted {
            lines.push(MergedLine {
                line,
                segment_indices: Vec::new(),
                is_border: true,
                kinds: Vec::new(),
                merge_residual: 0.0,
                on_outline: false,
                longest_segment: 0.0,
            });
        }
        let group = &mut lines[id];
        group.segment_indices.push(external);
        group.is_border &= kind == LineKind::Border;
        if !group.kinds.contains(&kind) {
            group.kinds.push(kind);
        }
        if length > group.longest_segment {
            group.longest_segment = length;
            group.line = line;
        }
        segment_line[i] = Some(id as u32);
    }

    // Residuals against the final representative of each group.
    for (i, seg) in segments.iter().enumerate() {
        if let Some(id) = segment_line[i] {
            let group = &mut lines[id as usize];
            let r = group
                .line
                .distance_to_point([seg[0], seg[1]])
                .max(group.line.distance_to_point([seg[2], seg[3]]));
            if r > group.merge_residual {
                group.merge_residual = r;
            }
        }
    }
    for group in &mut lines {
        group.kinds.sort();
    }

    MergeResult {
        lines,
        segment_line,
        skipped_zero_length: skipped,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_codes_map_like_oriedita() {
        assert_eq!(LineKind::from_color(0), LineKind::Border);
        assert_eq!(LineKind::from_color(1), LineKind::Mountain);
        assert_eq!(LineKind::from_color(2), LineKind::Valley);
        assert_eq!(LineKind::from_color(3), LineKind::Auxiliary);
        assert_eq!(LineKind::from_color(7), LineKind::Auxiliary);
        assert_eq!(LineKind::from_color(-1), LineKind::Unassigned);
    }

    #[test]
    fn collinear_pieces_with_noise_merge() {
        let segments = [
            [0.0, 0.5, 0.25, 0.5 + 1e-14],
            [0.25, 0.5 - 1e-14, 0.5, 0.5],
            [0.5, 0.5, 1.0, 0.5 + 3e-14],
            // Same line, reversed direction (the (n,d) ~ (−n,−d) twin).
            [0.75, 0.5, 0.6, 0.5],
        ];
        let kinds = [
            LineKind::Mountain,
            LineKind::Valley,
            LineKind::Mountain,
            LineKind::Mountain,
        ];
        let result = merge_segments(&segments, &kinds, None);
        assert_eq!(result.lines.len(), 1);
        let line = &result.lines[0];
        assert_eq!(line.segment_indices, vec![0, 1, 2, 3]);
        assert_eq!(line.kinds, vec![LineKind::Mountain, LineKind::Valley]);
        assert!(!line.is_border);
        assert!(line.merge_residual < 1e-13);
        assert!((line.longest_segment - 0.5).abs() < 1e-12);
    }

    #[test]
    fn parallel_lines_a_hair_apart_stay_distinct() {
        let segments = [[0.0, 0.5, 1.0, 0.5], [0.0, 0.5 + 5e-6, 1.0, 0.5 + 5e-6]];
        let kinds = [LineKind::Mountain, LineKind::Mountain];
        let result = merge_segments(&segments, &kinds, None);
        assert_eq!(result.lines.len(), 2);
    }

    #[test]
    fn zero_length_segments_are_skipped_and_reported() {
        let segments = [[0.3, 0.3, 0.3, 0.3], [0.0, 0.0, 1.0, 1.0]];
        let kinds = [LineKind::Mountain, LineKind::Border];
        let result = merge_segments(&segments, &kinds, Some(&[10, 11]));
        assert_eq!(result.skipped_zero_length, vec![10]);
        assert_eq!(result.segment_line, vec![None, Some(0)]);
        assert_eq!(result.lines[0].segment_indices, vec![11]);
        assert!(result.lines[0].is_border);
    }

    #[test]
    fn the_longest_segment_is_the_representative() {
        // A short noisy stub first, the long clean piece second: the group's
        // line follows the long piece so the residual is measured from it.
        let segments = [[0.0, 0.0, 1e-3, 1e-3 + 1e-10], [0.0, 0.0, 1.0, 1.0]];
        let kinds = [LineKind::Mountain, LineKind::Mountain];
        let result = merge_segments(&segments, &kinds, None);
        assert_eq!(result.lines.len(), 1);
        let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("line");
        assert!(result.lines[0].line.approx_eq_within(&diag, 1e-15));
    }
}
