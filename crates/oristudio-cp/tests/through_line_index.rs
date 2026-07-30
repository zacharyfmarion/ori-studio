//! A crease ending part-way along another one must be seen as a T-junction.
//!
//! The fan at such a point is missing the through-segment's two rays, so
//! evaluating it produces a residual indistinguishable from a real parity
//! failure — which is why [`Indeterminate::UnsplitJunction`] exists. The guard is
//! only as good as the spatial index that feeds it, and the first index barely
//! worked: it bucketed at the 1e-6 distance tolerance while stamping each
//! segment's *bounding box* on a lattice of `extent / 64`, so a 400-unit segment
//! landed in ~65 buckets six million buckets apart.
//!
//! The result was a 216-degree closure error reported on sound geometry at every
//! segment length from 0.01 upward.
//!
//! **These tests sweep the junction position deliberately.** The bug hid from a
//! midpoint probe, because the midpoint is exactly stamp 32 of 64 — the one place
//! the broken index did work.

use oristudio_cp::checks_spatial::{Indeterminate, spatial_vertex_reports};
use oristudio_cp::geometry::{FoldMagnitude, LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;

/// A long segment, plus three creases meeting it `at` units along — so the
/// visible fan is degree 3 and the through-segment's rays are missing.
fn t_junction(length: f64, at: f64) -> CreasePatternModel {
    let mut model = CreasePatternModel::default();
    let magnitude = FoldMagnitude::from_degrees(90.0);
    model.add_line_segment(
        LineSegment::with_color(
            Point::new(0.0, 0.0),
            Point::new(length, 0.0),
            LineColor::Red1,
        )
        .with_fold_magnitude(magnitude),
    );
    for (dx, dy) in [(0.0, 1.0), (-0.6, 0.8), (0.6, 0.8)] {
        model.add_line_segment(
            LineSegment::with_color(
                Point::new(at, 0.0),
                Point::new(at + dx * length * 0.1, dy * length * 0.1),
                LineColor::Blue2,
            )
            .with_fold_magnitude(magnitude),
        );
    }
    model
}

#[test]
fn a_t_junction_is_indeterminate_at_every_scale_and_position() {
    // Fractions chosen to land off any power-of-two lattice, plus 0.5 to keep the
    // case the old index happened to handle.
    for length in [0.01_f64, 0.1, 1.0, 10.0, 100.0, 400.0, 1000.0] {
        for fraction in [0.1137, 0.3137, 0.5, 0.6183, 0.8271] {
            let at = length * fraction;
            let model = t_junction(length, at);
            let report = spatial_vertex_reports(&model)
                .into_iter()
                .find(|report| (report.point.x - at).abs() < 1e-9 && report.point.y.abs() < 1e-9)
                .unwrap_or_else(|| panic!("length {length} at {fraction}: hub not reported"));
            assert_eq!(
                report.indeterminate,
                Some(Indeterminate::UnsplitJunction),
                "length {length} at {fraction}: evaluated a fan missing the through-line's \
                 rays instead of declining (residual {:?})",
                report.residual.map(f64::to_degrees)
            );
            assert!(
                report.residual.is_none(),
                "length {length} at {fraction}: an indeterminate fan must not report a residual"
            );
        }
    }
}

/// The complement: once the through-segment is actually split at the junction,
/// the fan is complete and must be evaluated rather than declined.
#[test]
fn a_split_junction_is_evaluated() {
    let magnitude = FoldMagnitude::from_degrees(90.0);
    let at = 400.0 * 0.3137;
    let mut model = CreasePatternModel::default();
    for (a, b) in [(0.0, at), (at, 400.0)] {
        model.add_line_segment(
            LineSegment::with_color(Point::new(a, 0.0), Point::new(b, 0.0), LineColor::Red1)
                .with_fold_magnitude(magnitude),
        );
    }
    for (dx, dy) in [(0.0, 1.0), (-0.6, 0.8)] {
        model.add_line_segment(
            LineSegment::with_color(
                Point::new(at, 0.0),
                Point::new(at + dx * 40.0, dy * 40.0),
                LineColor::Blue2,
            )
            .with_fold_magnitude(magnitude),
        );
    }
    let report = spatial_vertex_reports(&model)
        .into_iter()
        .find(|report| (report.point.x - at).abs() < 1e-9 && report.point.y.abs() < 1e-9)
        .expect("hub not reported");
    assert_eq!(
        report.indeterminate, None,
        "a split junction is fully determined"
    );
    assert_eq!(
        report.degree, 4,
        "both halves of the split segment are in the fan"
    );
}
