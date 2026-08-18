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
//! These assert ratios against `check4` rather than wall-clock numbers. That is
//! necessary but was not sufficient: a ratio cancels noise that scales both
//! measurements, and scheduling noise on a shared runner does not — a single
//! preemption adds a fixed number of milliseconds to whichever measurement is
//! unlucky. With a ~3ms denominator, one 20ms stall doubles the ratio on its own.
//!
//! Measured on an idle machine the non-flat ratio sits at 4.3-5.0 against a
//! threshold of 8; CI reported 8.4 and reddened `main`. So each pair is now
//! sampled several times, interleaved, and compared at its *fastest* observation
//! — see `fastest_pair`.

use oristudio_cp::checks::check4;
use oristudio_cp::checks_spatial::{dispatched_camv, spatial_vertex_reports};
use oristudio_cp::folding3d::admit;
use oristudio_cp::geometry::{FoldMagnitude, LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;
use std::time::{Duration, Instant};

/// How many times each pair is measured. The work here runs in single-digit
/// milliseconds, so this costs nothing and buys the whole margin back.
const SAMPLES: usize = 5;

/// Times two operations against each other and returns each one's fastest run.
///
/// The **minimum**, not the mean or the first: contention only ever *adds* to an
/// observation, so the smallest one is the sample closest to the work actually
/// being measured. A mean carries every stall into the answer, and a single
/// sample is a coin flip on a shared runner.
///
/// **Interleaved** rather than batched, because a load spike that lands during
/// one whole batch would skew the ratio in exactly the direction these tests
/// then assert on. Alternating means both sides meet the same conditions.
fn fastest_pair<A, B>(mut a: impl FnMut() -> A, mut b: impl FnMut() -> B) -> (Duration, Duration) {
    // One untimed pass first: the first call pays for cold caches and any
    // lazily-built state, which is not what is being compared.
    let _ = a();
    let _ = b();

    let mut best_a = Duration::MAX;
    let mut best_b = Duration::MAX;
    for _ in 0..SAMPLES {
        let start = Instant::now();
        let _ = a();
        best_a = best_a.min(start.elapsed());

        let start = Instant::now();
        let _ = b();
        best_b = best_b.min(start.elapsed());
    }
    (best_a, best_b)
}

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

    let (flat_cost, dispatched_cost) = fastest_pair(|| check4(&model), || dispatched_camv(&model));
    let baseline = check4(&model);
    let dispatched = dispatched_camv(&model);

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

/// The same grid, with a paper border and a non-classic crease.
///
/// The test above cannot see any of the spatial branch's cost: an all-classic
/// document short-circuits before `ThroughLineIndex` and before the arrangement,
/// so a regression in either is invisible there. This is the document that pays.
fn spatial_grid(n: usize) -> CreasePatternModel {
    let mut model = flat_grid(n);
    let span = n as f64 * 10.0;
    for segment in model.line_segments.iter_mut().step_by(7) {
        *segment = segment
            .clone()
            .with_fold_magnitude(FoldMagnitude::from_degrees(90.0));
    }
    for (a, b) in [
        ((0.0, 0.0), (span, 0.0)),
        ((span, 0.0), (span, span)),
        ((span, span), (0.0, span)),
        ((0.0, span), (0.0, 0.0)),
    ] {
        model.add_line_segment(LineSegment::with_color(
            Point::new(a.0, a.1),
            Point::new(b.0, b.1),
            LineColor::Black0,
        ));
    }
    model
}

/// A non-flat pattern pays for the spatial check, but within an order of
/// Oriedita's own.
///
/// `interior_border_segments` traces the whole arrangement, and `dispatched_camv`
/// reaches it on the 120 ms debounced post-edit path. When it landed it cost
/// 42 ms of a 53 ms check on the corpus's 9,162-segment `ALL-combined.fold`
/// against 5.5 ms for `check4` — a 9x check, four fifths of it in one call. The
/// ratio below is what stops that returning unseen.
#[test]
fn a_non_flat_pattern_pays_a_bounded_price_for_the_spatial_check() {
    let model = spatial_grid(40);

    let (flat_cost, dispatched_cost) = fastest_pair(|| check4(&model), || dispatched_camv(&model));
    let dispatched = dispatched_camv(&model);

    assert!(
        !dispatched.spatial.is_empty(),
        "this document is supposed to reach the spatial branch"
    );
    assert!(
        dispatched.interior_borders.is_empty(),
        "its border is the paper's own edge, so nothing has paper on both sides"
    );

    assert!(
        dispatched_cost < flat_cost * 8,
        "dispatched_camv took {dispatched_cost:?} against {flat_cost:?} for check4 alone \
         (fastest of {SAMPLES} interleaved samples each)"
    );
}

/// `admit` traces the arrangement once, not once per question that needs it.
///
/// Asserted as a budget rather than a call count: the gate's own closure pass
/// and its placement each need the arrangement, and building it twice put the
/// most expensive step in the function on the bill twice.
#[test]
fn the_3d_gate_traces_the_arrangement_once() {
    let model = spatial_grid(24);

    let (checked, admitted) = fastest_pair(
        || dispatched_camv(&model),
        || admit(&model.line_segments, 1),
    );

    // One arrangement is already inside `dispatched_camv` here, so a gate that
    // built a second would land near twice this. Generous, and still an order
    // below the regression it guards.
    assert!(
        admitted < checked * 3,
        "admit took {admitted:?} against {checked:?} for the check alone — \
         the arrangement is being traced more than once"
    );
}
