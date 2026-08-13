//! A bound cancel actually stops a fold, and reports itself as a cancel.
//!
//! These do not need a slow input: the source cancels after a fixed number of
//! reads, so an ordinary grid reaches a checkpoint in milliseconds. What they
//! prove is the wiring — that checkpoints exist on the real path, that the
//! signal survives every absorber between there and the caller, and that it
//! arrives as `fold_cancelled` rather than as a verdict about the crease
//! pattern.

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::cancel::{CancelHandle, CancelSource, RunId, bind};
use oristudio_cp::folding::{EstimationOrder, FoldingEstimateSession};
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::session::CpSession;

/// Reports `run` as cancelled once it has been read `reads` times.
///
/// A counter rather than an immediate cancel so a test can choose *how far* into
/// the fold to stop, which is what lets these reach checkpoints in different
/// stages.
/// Atomic rather than `Cell` because under `--features parallel` the rayon
/// bridge really does read this from several worker threads at once. A `Cell`
/// here would need an `unsafe impl Sync` that is not true, and the test would be
/// racy in exactly the configuration it exists to check.
struct CancelAfter {
    run: u32,
    remaining: AtomicU32,
}

impl CancelSource for CancelAfter {
    fn cancelled_run(&self) -> u32 {
        // Saturating decrement: once it reaches zero it stays there, so the
        // signal is a level and not a one-shot.
        let previous = self
            .remaining
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                Some(remaining.saturating_sub(1))
            })
            .unwrap_or(0);
        if previous == 0 { self.run } else { 0 }
    }
}

fn handle(reads: u32) -> CancelHandle {
    const RUN: u32 = 1;
    CancelHandle::new(
        Arc::new(CancelAfter {
            run: RUN,
            remaining: AtomicU32::new(reads),
        }),
        RunId::new(RUN).expect("non-zero"),
    )
}

/// An `n` x `n` grid, one cell edge at a time so the arrangement has vertices.
fn grid(n: usize) -> Vec<LineSegment> {
    let step = 400.0 / n as f64;
    let at = |i: usize| i as f64 * step;
    let mut segments = Vec::new();
    for i in 0..=n {
        for j in 0..n {
            segments.push(LineSegment::with_color(
                Point::new(at(i), at(j)),
                Point::new(at(i), at(j + 1)),
                LineColor::Black0,
            ));
            segments.push(LineSegment::with_color(
                Point::new(at(j), at(i)),
                Point::new(at(j + 1), at(i)),
                LineColor::Black0,
            ));
        }
    }
    segments
}

#[test]
fn an_unbound_fold_is_unaffected() {
    let segments = grid(4);
    let mut session = FoldingEstimateSession::new(&segments, 1);
    assert!(session.folding_estimated(EstimationOrder::Order5).is_ok());
}

/// The headline: a bound cancel stops the fold rather than running to
/// completion.
#[test]
fn a_bound_cancel_stops_the_fold() {
    let segments = grid(6);
    let _bound = bind(Some(handle(0)));
    let mut session = FoldingEstimateSession::new(&segments, 1);
    let error = session
        .folding_estimated(EstimationOrder::Order5)
        .expect_err("a cancelled fold must not return an estimate");
    assert!(
        error.is_cancelled(),
        "a cancel must be recognisable at any depth, got {error:?}"
    );
}

/// A cancel must never be reported as a *verdict about the crease pattern*.
///
/// This is the failure the error taxonomy exists to prevent: without the
/// `is_cancelled` short-circuit in `From<FoldingEstimateError> for EngineError`,
/// a checkpoint inside additional estimation arrives in the
/// `AdditionalEstimation(_)` wildcard and the user who pressed Stop is told
/// their pattern cannot be folded.
#[test]
fn a_cancel_never_reports_as_a_contradiction() {
    for reads in [0u32, 1, 4, 16, 64, 256, 1024] {
        let segments = grid(5);
        let _bound = bind(Some(handle(reads)));
        let mut session = FoldingEstimateSession::new(&segments, 1);
        let Err(error) = session.folding_estimated(EstimationOrder::Order5) else {
            // Cancelled past the end of the fold: nothing to check.
            continue;
        };
        assert!(
            error.is_cancelled(),
            "cancel after {reads} reads surfaced as {error:?}"
        );
        let engine = oristudio_cp::session::EngineError::from(error);
        assert_eq!(
            engine.code, "fold_cancelled",
            "cancel after {reads} reads reached the frontend as {:?}",
            engine.code
        );
    }
}

/// A cancel must not be absorbed into `Ok(false)` — "no stacking of this subface
/// exists" — nor into any other fabricated algorithmic answer. The three
/// absorbers on the search path are what this guards.
#[test]
fn a_cancel_is_never_absorbed_into_an_answer() {
    for reads in 0..48u32 {
        let segments = grid(5);
        let _bound = bind(Some(handle(reads)));
        let mut session = FoldingEstimateSession::new(&segments, 1);
        match session.folding_estimated(EstimationOrder::Order5) {
            Err(error) => assert!(
                error.is_cancelled(),
                "cancel after {reads} reads surfaced as {error:?}"
            ),
            Ok(estimate) => {
                // Completing is fine — the cancel landed past the end. What is
                // not fine is completing with a *contradiction*, which is a
                // verdict manufactured from a stop.
                assert!(
                    estimate.contradiction.is_none(),
                    "cancel after {reads} reads was converted into a contradiction"
                );
            }
        }
    }
}

/// The whole-session path, as the bridges call it: a cancelled fold must not
/// mint a folded-figure handle.
#[test]
fn a_cancelled_session_fold_yields_no_handle() {
    let segments = grid(5);
    let mut session = CpSession::new();
    let document = session.load_document(CreasePatternDocument {
        crease_pattern: CreasePatternModel {
            line_segments: segments,
            ..CreasePatternModel::default()
        },
        ..CreasePatternDocument::default()
    });

    let _bound = bind(Some(handle(0)));
    let error = session
        .folded_figure_fold(document, 1, EstimationOrder::Order5, Default::default())
        .expect_err("a cancelled fold must not produce a figure");
    assert_eq!(error.code, "fold_cancelled");
    // `fold_segments` only mints a handle after `folding_estimated` returns
    // `Ok`, so a cancelled fold cannot have stored one — freeing a handle that
    // was never allocated must therefore fail.
    assert!(
        session.free_folded_figure(0).is_err(),
        "a cancelled fold left a figure behind"
    );
}

/// The state-integrity invariant, stated as a test.
///
/// A cancelled `fold_another` must leave the session **exactly** as it was. The
/// comparison is over the whole `Debug` rendering rather than a chosen set of
/// fields, so a field added later and mutated by the search — but forgotten in
/// `snapshot_mutable` — fails here rather than silently returning solution N
/// labelled N+1.
#[test]
fn a_cancelled_fold_another_restores_the_session() {
    // A grid folds to *zero* solutions, so `fold_another` has nothing to
    // advance and the rollback would never be exercised — the first version of
    // this test passed with the transaction disabled for exactly that reason.
    // `solution_sample_1.cp` yields 15.
    let segments = oristudio_cp::io::cp::import_cp_str(include_str!(
        "../../../tests/fixtures/oriedita/solution_sample_1.cp"
    ))
    .expect("solution sample cp")
    .line_segments;
    let mut session = FoldingEstimateSession::new(&segments, 1);
    session
        .folding_estimated(EstimationOrder::Order5)
        .expect("the unbound fold should succeed");
    assert!(
        session.estimate().discovered_fold_cases > 0,
        "the fixture must actually fold, or this test proves nothing"
    );

    let before = format!("{session:?}");

    // Every stride from "cancel immediately" to "cancel deep in the search", so
    // the rollback is exercised at more than one checkpoint.
    for reads in [0u32, 1, 2, 4, 8, 16, 32, 64, 128, 512] {
        let mut candidate = session.clone();
        let _bound = bind(Some(handle(reads)));
        // An `Ok` means the fold completed before the cancel landed, and the
        // session legitimately moved; only the cancelled case must roll back.
        if let Err(error) = oristudio_cp::folding::fold_another(&mut candidate) {
            assert!(error.is_cancelled(), "unexpected error {error:?}");
            assert_eq!(
                format!("{candidate:?}"),
                before,
                "a cancel after {reads} reads left the session changed"
            );
        }
    }
}

/// The document is never at risk, on any path.
///
/// `folded_figure_fold` takes an immutable borrow and clones the segments, so
/// this holds by construction — but it is the single fact that makes aggressive
/// checkpointing safe to ship, and it should fail loudly if that ever changes.
#[test]
fn a_cancelled_fold_does_not_touch_the_document() {
    let segments = grid(5);
    let mut session = CpSession::new();
    let document = session.load_document(CreasePatternDocument {
        crease_pattern: CreasePatternModel {
            line_segments: segments,
            ..CreasePatternModel::default()
        },
        ..CreasePatternDocument::default()
    });
    let before = session.document_snapshot(document).expect("snapshot");

    let _bound = bind(Some(handle(0)));
    session
        .folded_figure_fold(document, 1, EstimationOrder::Order5, Default::default())
        .expect_err("the fold should have been cancelled");

    let after = session.document_snapshot(document).expect("snapshot");
    assert_eq!(
        format!("{before:?}"),
        format!("{after:?}"),
        "a cancelled fold modified the crease pattern"
    );
}
