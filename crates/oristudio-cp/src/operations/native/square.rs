//! One-click square generator.
//!
//! Ori Studio original. The nearest Oriedita tool is `POLYGON_SET_NO_CORNERS_29`
//! with four corners, which draws one *side* from two clicks and walks the rest —
//! the right tool for an arbitrary N-gon at an arbitrary angle, and the wrong one
//! for a grid-aligned square whose size you already know.

use crate::geometry::{LineColor, LineSegment, Point};
use crate::model::CreasePatternModel;
use crate::operations::arrangement::add_line_segment_like_worker;
use serde::{Deserialize, Serialize};

/// Which way the square sits on the paper.
///
/// Both are ordinary paper directions and neither is a special case of the
/// other, so this is the caller's choice rather than a default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum SquareOrientation {
    /// Edges along the axes.
    #[default]
    Normal,
    /// The same square, turned 45° — a diamond.
    Diagonal,
}

/// Where on the square's **bounding box** the caller's point lands.
///
/// Anchoring to the bounding box rather than to a corner is what keeps this
/// independent of [`SquareOrientation`]: the nine positions mean the same thing
/// whichever way the square is turned, so a UI can offer one unchanging 3×3
/// picker instead of a list that mutates when the orientation flips.
///
/// The square has four corners either way. All that changes is which of these
/// positions those corners land on — the four corner positions when `Normal`,
/// the four side positions when `Diagonal`.
///
/// `Top` is **smaller y**: model space is Oriedita's, where y grows downward.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum SquareAnchor {
    #[default]
    TopLeft,
    TopCenter,
    TopRight,
    MiddleLeft,
    Center,
    MiddleRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

impl SquareAnchor {
    /// How far the bounding box's center sits from the anchor point, as a
    /// fraction of `extent` along each axis.
    fn center_offset_fractions(self) -> (f64, f64) {
        let x = match self {
            Self::TopLeft | Self::MiddleLeft | Self::BottomLeft => 0.5,
            Self::TopCenter | Self::Center | Self::BottomCenter => 0.0,
            Self::TopRight | Self::MiddleRight | Self::BottomRight => -0.5,
        };
        let y = match self {
            Self::TopLeft | Self::TopCenter | Self::TopRight => 0.5,
            Self::MiddleLeft | Self::Center | Self::MiddleRight => 0.0,
            Self::BottomLeft | Self::BottomCenter | Self::BottomRight => -0.5,
        };
        (x, y)
    }
}

/// The square's four corners, in order around its perimeter.
///
/// `extent` is the **axis-aligned bounding extent** — the square's width, which
/// equals its height. For [`SquareOrientation::Normal`] that is the side length;
/// for `Diagonal` it is the full diagonal, i.e. how far the diamond reaches
/// across. The same number therefore describes the same footprint in both
/// orientations, which is what someone means by "an 8-square diamond" and what
/// keeps corners landing on grid intersections.
///
/// `None` when `extent` is not a usable size, so a caller cannot accidentally
/// commit a degenerate square.
pub fn square_corners(
    anchor_point: Point,
    extent: f64,
    orientation: SquareOrientation,
    anchor: SquareAnchor,
) -> Option<[Point; 4]> {
    if !extent.is_finite() || extent <= 0.0 {
        return None;
    }

    let half = extent / 2.0;
    let (offset_x, offset_y) = anchor.center_offset_fractions();
    let center = Point::new(
        anchor_point.x + offset_x * extent,
        anchor_point.y + offset_y * extent,
    );

    Some(match orientation {
        // The bounding box's own corners.
        SquareOrientation::Normal => [
            Point::new(center.x - half, center.y - half),
            Point::new(center.x + half, center.y - half),
            Point::new(center.x + half, center.y + half),
            Point::new(center.x - half, center.y + half),
        ],
        // The midpoints of the bounding box's sides.
        SquareOrientation::Diagonal => [
            Point::new(center.x, center.y - half),
            Point::new(center.x + half, center.y),
            Point::new(center.x, center.y + half),
            Point::new(center.x - half, center.y),
        ],
    })
}

/// The four edges joining `corners`, without touching a model — what a preview
/// needs.
pub fn square_edges(corners: &[Point; 4], color: LineColor) -> [LineSegment; 4] {
    [
        LineSegment::with_color(corners[0], corners[1], color),
        LineSegment::with_color(corners[1], corners[2], color),
        LineSegment::with_color(corners[2], corners[3], color),
        LineSegment::with_color(corners[3], corners[0], color),
    ]
}

/// Draw a square positioned by one point on its bounding box.
///
/// Returns how many segments were added, or `None` when `extent` is unusable.
///
/// Edges go in through `add_line_segment_like_worker`, the same primitive the
/// ported generators use, so a square dropped onto existing creases splits into
/// them exactly the way a polygon or a molecule does.
pub fn square_at_anchor(
    model: &mut CreasePatternModel,
    anchor_point: Point,
    extent: f64,
    orientation: SquareOrientation,
    anchor: SquareAnchor,
    color: LineColor,
) -> Option<usize> {
    let corners = square_corners(anchor_point, extent, orientation, anchor)?;
    for edge in square_edges(&corners, color) {
        add_line_segment_like_worker(model, &edge);
    }
    Some(4)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPS: f64 = 1e-9;

    fn assert_point(actual: Point, expected: (f64, f64)) {
        assert!(
            (actual.x - expected.0).abs() < EPS && (actual.y - expected.1).abs() < EPS,
            "expected ({}, {}), got ({}, {})",
            expected.0,
            expected.1,
            actual.x,
            actual.y
        );
    }

    fn corners(
        anchor_point: (f64, f64),
        extent: f64,
        orientation: SquareOrientation,
        anchor: SquareAnchor,
    ) -> [Point; 4] {
        square_corners(
            Point::new(anchor_point.0, anchor_point.1),
            extent,
            orientation,
            anchor,
        )
        .expect("usable extent")
    }

    #[test]
    fn a_normal_square_puts_its_corners_on_the_bounding_box_corners() {
        let square = corners(
            (0.0, 0.0),
            10.0,
            SquareOrientation::Normal,
            SquareAnchor::TopLeft,
        );
        assert_point(square[0], (0.0, 0.0));
        assert_point(square[1], (10.0, 0.0));
        assert_point(square[2], (10.0, 10.0));
        assert_point(square[3], (0.0, 10.0));
    }

    #[test]
    fn a_diagonal_square_puts_its_corners_on_the_bounding_box_side_midpoints() {
        let square = corners(
            (0.0, 0.0),
            10.0,
            SquareOrientation::Diagonal,
            SquareAnchor::TopLeft,
        );
        assert_point(square[0], (5.0, 0.0));
        assert_point(square[1], (10.0, 5.0));
        assert_point(square[2], (5.0, 10.0));
        assert_point(square[3], (0.0, 5.0));
    }

    /// Diagonal is the same square, turned — so its side is `extent / sqrt(2)`
    /// while its footprint stays `extent` wide. That relationship is the whole
    /// justification for measuring by bounding extent, so it is pinned.
    #[test]
    fn diagonal_keeps_the_footprint_and_shrinks_the_side() {
        let extent = 8.0;
        let normal = corners(
            (0.0, 0.0),
            extent,
            SquareOrientation::Normal,
            SquareAnchor::Center,
        );
        let diagonal = corners(
            (0.0, 0.0),
            extent,
            SquareOrientation::Diagonal,
            SquareAnchor::Center,
        );

        let side = |square: &[Point; 4]| square[0].distance(square[1]);
        assert!((side(&normal) - extent).abs() < EPS);
        assert!((side(&diagonal) - extent / 2.0_f64.sqrt()).abs() < EPS);

        for square in [&normal, &diagonal] {
            let min_x = square.iter().map(|p| p.x).fold(f64::MAX, f64::min);
            let max_x = square.iter().map(|p| p.x).fold(f64::MIN, f64::max);
            let min_y = square.iter().map(|p| p.y).fold(f64::MAX, f64::min);
            let max_y = square.iter().map(|p| p.y).fold(f64::MIN, f64::max);
            assert!((max_x - min_x - extent).abs() < EPS);
            assert!((max_y - min_y - extent).abs() < EPS);
        }
    }

    /// Every anchor places the same square; only where the click lands moves.
    /// Checked by asking each anchor for the box it produces and comparing
    /// against the box `Center` produces from the equivalent point.
    #[test]
    fn every_anchor_places_the_point_where_it_claims() {
        let extent = 4.0;
        let cases: [(SquareAnchor, (f64, f64)); 9] = [
            (SquareAnchor::TopLeft, (0.0, 0.0)),
            (SquareAnchor::TopCenter, (2.0, 0.0)),
            (SquareAnchor::TopRight, (4.0, 0.0)),
            (SquareAnchor::MiddleLeft, (0.0, 2.0)),
            (SquareAnchor::Center, (2.0, 2.0)),
            (SquareAnchor::MiddleRight, (4.0, 2.0)),
            (SquareAnchor::BottomLeft, (0.0, 4.0)),
            (SquareAnchor::BottomCenter, (2.0, 4.0)),
            (SquareAnchor::BottomRight, (4.0, 4.0)),
        ];

        // The one square every case must describe: bounding box (0,0)..(4,4).
        for orientation in [SquareOrientation::Normal, SquareOrientation::Diagonal] {
            for (anchor, point) in cases {
                let square = corners(point, extent, orientation, anchor);
                let min_x = square.iter().map(|p| p.x).fold(f64::MAX, f64::min);
                let min_y = square.iter().map(|p| p.y).fold(f64::MAX, f64::min);
                assert!(
                    min_x.abs() < EPS && min_y.abs() < EPS,
                    "{anchor:?} in {orientation:?} produced a box at ({min_x}, {min_y})"
                );
            }
        }
    }

    /// Whole-cell sizes have to land on grid intersections, or the tool is
    /// useless for the box pleating it is aimed at. Diagonal reaches `extent / 2`
    /// along each axis, so it lands for even sizes and on half-cells for odd —
    /// stated here so a change to the size semantics has to face it.
    #[test]
    fn diagonal_corners_land_on_the_grid_for_even_cell_counts() {
        let grid_width = 25.0; // 400 / 16
        let on_grid = |value: f64| (value / grid_width).fract().abs() < EPS;

        let even = corners(
            (0.0, 0.0),
            8.0 * grid_width,
            SquareOrientation::Diagonal,
            SquareAnchor::TopLeft,
        );
        assert!(even.iter().all(|p| on_grid(p.x) && on_grid(p.y)));

        let odd = corners(
            (0.0, 0.0),
            7.0 * grid_width,
            SquareOrientation::Diagonal,
            SquareAnchor::TopLeft,
        );
        assert!(odd.iter().any(|p| !on_grid(p.x) || !on_grid(p.y)));
    }

    #[test]
    fn an_unusable_extent_is_refused_rather_than_drawn_degenerate() {
        for extent in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(
                square_corners(
                    Point::origin(),
                    extent,
                    SquareOrientation::Normal,
                    SquareAnchor::Center
                )
                .is_none(),
                "extent {extent} should be refused"
            );
        }

        let mut model = CreasePatternModel::default();
        assert!(
            square_at_anchor(
                &mut model,
                Point::origin(),
                0.0,
                SquareOrientation::Normal,
                SquareAnchor::Center,
                LineColor::Black0,
            )
            .is_none()
        );
        assert!(model.line_segments.is_empty());
    }

    #[test]
    fn the_edges_close_the_perimeter_in_the_requested_colour() {
        let square = corners(
            (0.0, 0.0),
            6.0,
            SquareOrientation::Normal,
            SquareAnchor::TopLeft,
        );
        let edges = square_edges(&square, LineColor::Red1);

        for (index, edge) in edges.iter().enumerate() {
            assert_eq!(edge.color, LineColor::Red1);
            assert_point(edge.a, (square[index].x, square[index].y));
            let next = square[(index + 1) % 4];
            assert_point(edge.b, (next.x, next.y));
        }
    }

    #[test]
    fn committing_adds_four_edges_to_the_model() {
        let mut model = CreasePatternModel::default();
        let added = square_at_anchor(
            &mut model,
            Point::new(-50.0, -50.0),
            100.0,
            SquareOrientation::Normal,
            SquareAnchor::TopLeft,
            LineColor::Black0,
        );

        assert_eq!(added, Some(4));
        assert_eq!(model.line_segments.len(), 4);
    }
}
