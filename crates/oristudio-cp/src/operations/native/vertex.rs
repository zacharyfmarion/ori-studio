//! Vertex drag: move a junction and carry every crease that ends on it.
//!
//! Ori Studio original. Oriedita's move handlers — `CREASE_MOVE_21`,
//! `CREASE_MOVE_4P_31`, `MOVE_CALCULATED_SHAPE`, `MOVE_CREASE_PATTERN` — all
//! translate whole segments or the whole pattern, so a junction shared with an
//! unselected crease tears apart under every one of them. There is nothing
//! upstream that edits a junction in place.
//!
//! The operation is deliberately not an in-place endpoint rewrite. A vertex
//! dragged across another crease creates a crossing, and "inserted geometry is
//! split against what it crosses" is an invariant the fold graph, the CAMV
//! checks and the FOLD exporter all assume. So the touched creases are removed
//! and re-inserted through the same splitter `move_selected_lines` uses, which
//! costs stable line ids and buys a pattern that stays well-formed.

use crate::geometry::{Epsilon, LineSegment, Point};
use crate::model::CreasePatternModel;
use crate::operations::selection::unselect_all;
use crate::operations::transform::append_and_split;

/// How close a crease endpoint must be to count as sitting *on* a vertex.
///
/// The same figure `del_v_pair` uses to decide two creases meet, which is the
/// nearest existing answer to the same question. It is an ε-ball rather than a
/// quantization on purpose: two coordinates a picometre apart can straddle a
/// rounding boundary, which would make "is this the same vertex" depend on where
/// the pattern happens to sit on the paper.
///
/// Mirrored in TypeScript for the drag preview
/// (`apps/web/src/cp-workspace/tools/vertexEndpoints.ts`) and pinned against
/// this implementation by `tests/vertex_move_match_golden.rs`.
pub const VERTEX_COINCIDENCE: f64 = Epsilon::UNKNOWN_1EN5;

/// Which end of a segment a match landed on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum EndpointSlot {
    A,
    B,
}

/// A crease endpoint sitting on a vertex.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct VertexEndpoint {
    /// Zero-based index into `model.line_segments`.
    pub segment: usize,
    pub slot: EndpointSlot,
}

/// Every crease endpoint within [`VERTEX_COINCIDENCE`] of `vertex`, in segment
/// order, `a` before `b`.
///
/// A segment with *both* endpoints on the vertex contributes two entries. That
/// is already-degenerate geometry, and reporting it truthfully is what lets the
/// mover drop it rather than move one end of a zero-length crease.
///
/// Public because the drag preview's TypeScript mirror is pinned against it.
pub fn vertex_endpoints_at(model: &CreasePatternModel, vertex: Point) -> Vec<VertexEndpoint> {
    let mut found = Vec::new();
    for (index, segment) in model.line_segments.iter().enumerate() {
        if segment.a.distance(vertex) <= VERTEX_COINCIDENCE {
            found.push(VertexEndpoint {
                segment: index,
                slot: EndpointSlot::A,
            });
        }
        if segment.b.distance(vertex) <= VERTEX_COINCIDENCE {
            found.push(VertexEndpoint {
                segment: index,
                slot: EndpointSlot::B,
            });
        }
    }
    found
}

/// Move the vertex at `from` to `to`, carrying every crease endpoint on it.
///
/// Returns the number of creases whose geometry changed — including any that
/// collapsed, since the caller's question is "did this do something".
///
/// Returns `0` rather than an error when nothing is at `from`: a press that
/// reached here with no vertex under it is a miss, not a failure.
///
/// Standalone points, circles and text at the same coordinates do **not** move.
/// That is the rule every kernel transform follows, and breaking it for one tool
/// would make "what does a move carry" a per-tool question.
pub fn move_vertex(model: &mut CreasePatternModel, from: Point, to: Point) -> usize {
    if !Epsilon::HIGH.gt0(from.distance(to)) {
        return 0;
    }

    let endpoints = vertex_endpoints_at(model, from);
    if endpoints.is_empty() {
        return 0;
    }

    // One entry per touched segment, carrying which of its ends move. Both, for
    // an already-degenerate crease with two endpoints on the vertex.
    let mut touched: Vec<(usize, bool, bool)> = Vec::new();
    for endpoint in &endpoints {
        match touched.last_mut() {
            Some((index, moves_a, moves_b)) if *index == endpoint.segment => match endpoint.slot {
                EndpointSlot::A => *moves_a = true,
                EndpointSlot::B => *moves_b = true,
            },
            _ => touched.push((
                endpoint.segment,
                endpoint.slot == EndpointSlot::A,
                endpoint.slot == EndpointSlot::B,
            )),
        }
    }

    let moved_count = touched.len();
    let mut relocated: Vec<LineSegment> = Vec::with_capacity(moved_count);
    for (index, moves_a, moves_b) in &touched {
        let Some(segment) = model.line_segments.get(*index) else {
            continue;
        };
        let a = if *moves_a { to } else { segment.a };
        let b = if *moves_b { to } else { segment.b };
        // A crease dragged onto its own far endpoint has collapsed. Dropping it
        // *is* the merge — the two creases that met at the collapsed one now
        // meet each other — and keeping it would leave a sliver, one of which is
        // enough to make the Euler check discard every face on export.
        if a.distance(b) > VERTEX_COINCIDENCE {
            relocated.push(segment.with_coordinates(a, b));
        }
    }

    // Descending, so each removal leaves the lower indices addressing the same
    // segments. `delete_line_segments_for_indices` matches by *value* and would
    // remove the wrong copy when a pattern holds two identical creases.
    for (index, _, _) in touched.iter().rev() {
        if *index < model.line_segments.len() {
            model.line_segments.remove(*index);
        }
    }

    append_and_split(model, relocated);
    unselect_all(model);
    moved_count
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::LineColor;

    fn point(x: f64, y: f64) -> Point {
        Point::new(x, y)
    }

    fn segment(model: &mut CreasePatternModel, a: Point, b: Point) {
        model
            .line_segments
            .push(LineSegment::with_color(a, b, LineColor::Red1));
    }

    /// Endpoints as an order-independent multiset of rounded coordinate pairs.
    fn endpoints_of(model: &CreasePatternModel) -> Vec<(i64, i64, i64, i64)> {
        let q = |v: f64| (v * 1e6).round() as i64;
        let mut out: Vec<_> = model
            .line_segments
            .iter()
            .map(|s| {
                let mut ends = [(q(s.a.x), q(s.a.y)), (q(s.b.x), q(s.b.y))];
                ends.sort();
                (ends[0].0, ends[0].1, ends[1].0, ends[1].1)
            })
            .collect();
        out.sort();
        out
    }

    #[test]
    fn moves_every_crease_of_a_degree_four_junction() {
        let mut model = CreasePatternModel::default();
        segment(&mut model, point(100.0, 100.0), point(0.0, 100.0));
        segment(&mut model, point(100.0, 100.0), point(200.0, 100.0));
        segment(&mut model, point(100.0, 100.0), point(100.0, 0.0));
        segment(&mut model, point(100.0, 100.0), point(100.0, 200.0));

        let moved = move_vertex(&mut model, point(100.0, 100.0), point(130.0, 140.0));

        assert_eq!(moved, 4);
        assert_eq!(model.line_segments.len(), 4);
        assert_eq!(
            endpoints_of(&model),
            vec![
                (0, 100_000_000, 130_000_000, 140_000_000),
                (100_000_000, 0, 130_000_000, 140_000_000),
                (100_000_000, 200_000_000, 130_000_000, 140_000_000),
                (130_000_000, 140_000_000, 200_000_000, 100_000_000),
            ]
        );
    }

    #[test]
    fn leaves_a_crease_that_only_passes_through_the_point() {
        let mut model = CreasePatternModel::default();
        // Ends on the vertex, heading away from the passer-by (y decreasing).
        segment(&mut model, point(100.0, 100.0), point(100.0, 0.0));
        // Passes through the vertex without ending there.
        segment(&mut model, point(0.0, 100.0), point(200.0, 100.0));

        // Kept on the far side of y = 100, so the moved crease never crosses the
        // passer-by — this test is about the match rule, not about splitting.
        let moved = move_vertex(&mut model, point(100.0, 100.0), point(130.0, 60.0));

        assert_eq!(moved, 1);
        assert!(
            model
                .line_segments
                .iter()
                .any(|s| s.a == point(0.0, 100.0) && s.b == point(200.0, 100.0)),
            "the crease that only passes through must not be carried: {:?}",
            model.line_segments
        );
        assert_eq!(model.line_segments.len(), 2);
    }

    /// The companion to the test above: once the moved crease *does* cross the
    /// passer-by, both must be divided at the new intersection. This is the
    /// invariant that rules out an in-place endpoint rewrite.
    #[test]
    fn splits_a_passer_by_the_moved_crease_now_crosses() {
        let mut model = CreasePatternModel::default();
        segment(&mut model, point(100.0, 100.0), point(100.0, 0.0));
        segment(&mut model, point(0.0, 100.0), point(200.0, 100.0));

        // Dragged to the other side of y = 100, so the crease sweeps across it.
        move_vertex(&mut model, point(100.0, 100.0), point(100.0, 150.0));

        assert_eq!(model.line_segments.len(), 4);
        assert_eq!(
            endpoints_of(&model),
            vec![
                (0, 100_000_000, 100_000_000, 100_000_000),
                (100_000_000, 0, 100_000_000, 100_000_000),
                (100_000_000, 100_000_000, 100_000_000, 150_000_000),
                (100_000_000, 100_000_000, 200_000_000, 100_000_000),
            ]
        );
    }

    #[test]
    fn dragging_onto_a_neighbour_collapses_that_crease_and_leaves_no_sliver() {
        let mut model = CreasePatternModel::default();
        segment(&mut model, point(100.0, 100.0), point(200.0, 100.0));
        segment(&mut model, point(100.0, 100.0), point(100.0, 200.0));

        // Straight onto the far end of the first crease.
        let moved = move_vertex(&mut model, point(100.0, 100.0), point(200.0, 100.0));

        assert_eq!(moved, 2);
        assert!(
            model
                .line_segments
                .iter()
                .all(|s| s.a.distance(s.b) > VERTEX_COINCIDENCE),
            "no zero-length crease may survive: {:?}",
            model.line_segments
        );
        assert_eq!(model.line_segments.len(), 1);
    }

    #[test]
    fn dragging_across_a_crease_splits_at_the_new_crossing() {
        let mut model = CreasePatternModel::default();
        // The crease being dragged, from a vertex at the origin corner.
        segment(&mut model, point(0.0, 0.0), point(0.0, 200.0));
        // A wall it will be dragged across.
        segment(&mut model, point(100.0, 0.0), point(100.0, 200.0));

        let moved = move_vertex(&mut model, point(0.0, 200.0), point(200.0, 200.0));

        assert_eq!(moved, 1);
        // The dragged crease now runs (0,0)->(200,200) and crosses the wall at
        // (100,100); the splitter must divide both.
        assert!(
            model.line_segments.len() >= 4,
            "expected both creases split at the crossing, got {:?}",
            model.line_segments
        );
        let q = |v: f64| (v * 1e6).round() as i64;
        assert!(
            model
                .line_segments
                .iter()
                .any(|s| (q(s.a.x), q(s.a.y)) == (100_000_000, 100_000_000)
                    || (q(s.b.x), q(s.b.y)) == (100_000_000, 100_000_000)),
            "expected a vertex at the new crossing: {:?}",
            model.line_segments
        );
    }

    #[test]
    fn a_point_with_no_vertex_moves_nothing() {
        let mut model = CreasePatternModel::default();
        segment(&mut model, point(0.0, 0.0), point(100.0, 0.0));
        let before = model.line_segments.clone();

        assert_eq!(
            move_vertex(&mut model, point(50.0, 50.0), point(60.0, 60.0)),
            0
        );
        assert_eq!(model.line_segments, before);
    }

    #[test]
    fn a_zero_length_move_changes_nothing() {
        let mut model = CreasePatternModel::default();
        segment(&mut model, point(0.0, 0.0), point(100.0, 0.0));
        let before = model.line_segments.clone();

        assert_eq!(move_vertex(&mut model, point(0.0, 0.0), point(0.0, 0.0)), 0);
        assert_eq!(model.line_segments, before);
    }

    #[test]
    fn matches_both_ends_of_an_already_degenerate_crease() {
        let mut model = CreasePatternModel::default();
        segment(&mut model, point(50.0, 50.0), point(50.0, 50.0));

        assert_eq!(
            vertex_endpoints_at(&model, point(50.0, 50.0)),
            vec![
                VertexEndpoint {
                    segment: 0,
                    slot: EndpointSlot::A
                },
                VertexEndpoint {
                    segment: 0,
                    slot: EndpointSlot::B
                },
            ]
        );

        // Moving it keeps it degenerate, so it is dropped rather than relocated.
        assert_eq!(
            move_vertex(&mut model, point(50.0, 50.0), point(80.0, 80.0)),
            1
        );
        assert!(model.line_segments.is_empty());
    }

    #[test]
    fn matches_inside_the_tolerance_and_not_outside_it() {
        let mut model = CreasePatternModel::default();
        segment(&mut model, point(0.0, 0.0), point(100.0, 0.0));
        segment(
            &mut model,
            point(VERTEX_COINCIDENCE * 0.5, 0.0),
            point(0.0, 100.0),
        );
        segment(
            &mut model,
            point(VERTEX_COINCIDENCE * 2.0, 0.0),
            point(0.0, -100.0),
        );

        let matched = vertex_endpoints_at(&model, point(0.0, 0.0));
        assert_eq!(
            matched,
            vec![
                VertexEndpoint {
                    segment: 0,
                    slot: EndpointSlot::A
                },
                VertexEndpoint {
                    segment: 1,
                    slot: EndpointSlot::A
                },
            ]
        );
    }

    #[test]
    fn clears_the_selection_because_ids_renumber() {
        let mut model = CreasePatternModel::default();
        segment(&mut model, point(100.0, 100.0), point(200.0, 100.0));
        segment(&mut model, point(0.0, 0.0), point(0.0, 100.0));
        model.line_segments[1].selected = 2;

        move_vertex(&mut model, point(100.0, 100.0), point(150.0, 150.0));

        assert!(model.line_segments.iter().all(|s| s.selected == 0));
    }
}
