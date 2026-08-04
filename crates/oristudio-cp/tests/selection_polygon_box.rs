//! The four-corner form of a drag box.
//!
//! `required_selection_polygon` reads two points as "AABB from this diagonal"
//! and three or more as a polygon verbatim. The frontend's marquee is
//! axis-aligned on *screen* — Oriedita's `BoxSelectStepNode` builds it in TV
//! coordinates and maps each corner through `Camera.TV2object` — so under a
//! rotated view it sends four corners of a rotated quadrilateral.
//!
//! That path already existed for the lasso tools, but no test covered a box
//! arriving as four corners. These pin the three things the frontend relies on:
//! the four-corner form agrees with the two-point form when the view is square,
//! it follows the rotated quad rather than its bounding box, and a degenerate
//! (straight-drag) box still selects what it sweeps.

use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::{
    CreasePatternCommand, CreasePatternCommandPayload, CreasePatternDocument, OperationId,
    execute_command,
};

/// A document with one crease per given endpoint pair.
fn document_with(segments: &[(f64, f64, f64, f64)]) -> CreasePatternDocument {
    let mut model = CreasePatternModel::default();
    for (ax, ay, bx, by) in segments {
        model.add_line_segment(LineSegment::with_color(
            Point::new(*ax, *ay),
            Point::new(*bx, *by),
            LineColor::Red1,
        ));
    }
    CreasePatternDocument {
        crease_pattern: model,
        ..Default::default()
    }
}

/// Erase with the given box points, returning the creases left behind.
fn erase_with(document: &mut CreasePatternDocument, points: Vec<Point>) -> usize {
    let command = CreasePatternCommand::new(OperationId::LineSegmentDelete).with_payload(
        CreasePatternCommandPayload {
            points,
            ..Default::default()
        },
    );
    execute_command(document, command).expect("box erase executes");
    document.crease_pattern.line_segments.len()
}

/// The four corners of the axis-aligned rect spanned by (ax, ay)-(bx, by), in
/// perimeter order — what the frontend sends when the view is unrotated.
fn corners(ax: f64, ay: f64, bx: f64, by: f64) -> Vec<Point> {
    vec![
        Point::new(ax, ay),
        Point::new(ax, by),
        Point::new(bx, by),
        Point::new(bx, ay),
    ]
}

#[test]
fn four_corners_match_the_two_point_diagonal_when_the_view_is_square() {
    // The regression guard for the overwhelmingly common case: at rotation 0 the
    // new four-corner payload must select exactly what the old two-point one did.
    let segments = [
        (1.0, 1.0, 3.0, 3.0),     // inside
        (20.0, 20.0, 30.0, 30.0), // outside
        (-5.0, 5.0, 15.0, 5.0),   // crosses the box
    ];

    let mut two_point = document_with(&segments);
    let left_by_diagonal = erase_with(
        &mut two_point,
        vec![Point::new(0.0, 0.0), Point::new(10.0, 10.0)],
    );

    let mut four_point = document_with(&segments);
    let left_by_corners = erase_with(&mut four_point, corners(0.0, 0.0, 10.0, 10.0));

    assert_eq!(left_by_diagonal, left_by_corners);
    assert_eq!(left_by_corners, 1);
}

#[test]
fn corner_order_may_wind_either_way() {
    // A drag runs in any direction, so the corners can arrive clockwise or
    // counter-clockwise. The predicates are winding-independent; pin that.
    let segments = [(1.0, 1.0, 3.0, 3.0), (20.0, 20.0, 30.0, 30.0)];

    let mut forward = document_with(&segments);
    let mut reversed_corners = corners(0.0, 0.0, 10.0, 10.0);
    reversed_corners.reverse();

    let mut backward = document_with(&segments);
    assert_eq!(
        erase_with(&mut forward, corners(0.0, 0.0, 10.0, 10.0)),
        erase_with(&mut backward, reversed_corners),
    );
}

#[test]
fn a_rotated_quad_selects_its_own_shape_not_its_bounding_box() {
    // The behaviour the whole change is for. A diamond of "radius" 10 about the
    // origin: a crease tucked into the corner of its bounding box is outside the
    // diamond and must survive, while one through the middle is erased.
    let mut document = document_with(&[
        (8.0, 8.0, 9.0, 9.0),  // inside the AABB, outside the diamond
        (-2.0, 0.0, 2.0, 0.0), // through the middle
    ]);

    let diamond = vec![
        Point::new(0.0, -10.0),
        Point::new(-10.0, 0.0),
        Point::new(0.0, 10.0),
        Point::new(10.0, 0.0),
    ];
    erase_with(&mut document, diamond);

    assert_eq!(document.crease_pattern.line_segments.len(), 1);
    let survivor = &document.crease_pattern.line_segments[0];
    assert_eq!(survivor.a, Point::new(8.0, 8.0));

    // The same drag read as an axis-aligned box would have taken both.
    let mut as_box = document_with(&[(8.0, 8.0, 9.0, 9.0), (-2.0, 0.0, 2.0, 0.0)]);
    assert_eq!(
        erase_with(&mut as_box, corners(-10.0, -10.0, 10.0, 10.0)),
        0
    );
}

#[test]
fn a_degenerate_box_from_a_straight_drag_still_erases_what_it_sweeps() {
    // A straight drag holds one screen axis exactly, so all four corners are
    // collinear. Oriedita commits that gesture (`selectionStart.distance > 0`),
    // and the box predicate asks whether a crease *touches* the box.
    let mut document = document_with(&[
        (0.0, 5.0, 6.0, 5.0),   // crosses the sweep line
        (0.0, 50.0, 6.0, 50.0), // far away, along the same infinite line
    ]);

    let flat = vec![
        Point::new(3.0, 1.0),
        Point::new(3.0, 9.0),
        Point::new(3.0, 9.0),
        Point::new(3.0, 1.0),
    ];
    erase_with(&mut document, flat);

    assert_eq!(document.crease_pattern.line_segments.len(), 1);
    assert_eq!(
        document.crease_pattern.line_segments[0].a,
        Point::new(0.0, 50.0)
    );
}

#[test]
fn box_select_takes_the_same_four_corner_polygon() {
    // Erase is not special: every drag-box tool resolves through
    // `required_selection_polygon`, so select sees the same shape.
    let mut document = document_with(&[(1.0, 1.0, 3.0, 3.0), (20.0, 20.0, 30.0, 30.0)]);
    let command = CreasePatternCommand::new(OperationId::CreaseSelect).with_payload(
        CreasePatternCommandPayload {
            points: corners(0.0, 0.0, 10.0, 10.0),
            replace_selection: Some(true),
            ..Default::default()
        },
    );
    execute_command(&mut document, command).expect("box select executes");

    let selected: Vec<usize> = document
        .crease_pattern
        .line_segments
        .iter()
        .enumerate()
        .filter(|(_, segment)| segment.selected != 0)
        .map(|(index, _)| index)
        .collect();
    assert_eq!(selected, vec![0]);
}
