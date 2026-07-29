//! A flat crease pattern must not pay for the spatial check.
//!
//! `CheckCamv` is scheduled after every document mutation, so this sits on the
//! live edit path. Both `point_line_map` and the through-line index walk every
//! segment, and they used to run *before* the per-vertex filter — so a purely
//! flat pattern paid the whole bill to discover it had no spatial vertices.
//!
//! Measured on the grid below: **234ms** against 4.5ms for Oriedita's `check4`
//! alone, a 52x regression on every existing document for no result.
//!
//! This asserts a ratio against `check4` rather than a wall-clock number, so it
//! does not turn into a flaky timing test on a loaded CI runner.

use oristudio_cp::checks::check4;
use oristudio_cp::checks_spatial::{dispatched_camv, spatial_vertex_reports};
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;
use std::time::Instant;

/// A grid of crossing creases, none of them carrying a fold angle.
fn flat_grid(n: usize) -> CreasePatternModel {
    let mut model = CreasePatternModel::default();
    let step = 10.0;
    for i in 0..=n {
        for j in 0..n {
            let (x, y) = (i as f64 * step, j as f64 * step);
            let color = if (i + j) % 2 == 0 {
                LineColor::Red1
            } else {
                LineColor::Blue2
            };
            model.add_line_segment(LineSegment::with_color(
                Point::new(x, y),
                Point::new(x, y + step),
                color,
            ));
            model.add_line_segment(LineSegment::with_color(
                Point::new(y, x),
                Point::new(y + step, x),
                color,
            ));
        }
    }
    model
}

#[test]
fn a_flat_pattern_does_not_pay_for_the_spatial_check() {
    let model = flat_grid(40);
    assert!(
        model.line_segments.len() > 3000,
        "needs to be big enough to time"
    );

    // Nothing to find, and it must cost nothing to establish that.
    assert!(spatial_vertex_reports(&model).is_empty());

    let start = Instant::now();
    let baseline = check4(&model);
    let flat_cost = start.elapsed();

    let start = Instant::now();
    let dispatched = dispatched_camv(&model);
    let dispatched_cost = start.elapsed();

    assert_eq!(
        dispatched.flat.len(),
        baseline.len(),
        "dispatch must reproduce Oriedita exactly on a flat document"
    );
    assert!(dispatched.spatial.is_empty());

    // Generous: the regression this guards was 40-50x. Anything under 4x means
    // the early-out is intact.
    assert!(
        dispatched_cost < flat_cost * 4,
        "dispatched_camv took {dispatched_cost:?} against {flat_cost:?} for check4 alone — \
         the spatial path is being built for a document that has no spatial vertices"
    );
}
