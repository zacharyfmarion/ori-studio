//! A bound cancel actually stops a fold, and reports itself as a cancel.
//!
//! These do not need a slow input: the source cancels after a fixed number of
//! reads, so an ordinary grid reaches a checkpoint in milliseconds. What they
//! prove is the wiring — that checkpoints exist on the real path, that the
//! signal survives every absorber between there and the caller, and that it
//! arrives as `fold_cancelled` rather than as a verdict about the crease
//! pattern.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::cancel::{CancelHandle, CancelSource, RunId, bind};
use oristudio_cp::folding::{EstimationOrder, FoldedFigureModel, FoldingEstimateSession};
use oristudio_cp::folding3d::wire::Fold3dVerdict;
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::session::{CpSession, Fold3dFoldResult};

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

fn repo(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn load_3d_fixture(session: &mut CpSession, name: &str) -> u32 {
    let path = repo(&format!("tests/fixtures/fold-angle-3d/{name}.fold"));
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    session
        .load_fold(&raw, name)
        .unwrap_or_else(|error| panic!("load {name}: {error}"))
}

fn every_line(session: &CpSession, document: u32) -> Vec<usize> {
    let count = session
        .document_snapshot(document)
        .expect("document")
        .crease_pattern
        .line_segments
        .len();
    (1..=count).collect()
}

/// The verdict this fixture folds to with nothing bound.
///
/// The baseline is computed rather than written down because it is not the
/// subject: what the test asserts is that a cancel changes *nothing* about the
/// answer, and comparing to a hardcoded verdict would additionally pin what each
/// fixture folds to, which belongs to the folding3d tests instead.
fn uncancelled_3d_verdict(name: &str) -> Fold3dVerdict {
    let mut session = CpSession::new();
    let document = load_3d_fixture(&mut session, name);
    let lines = every_line(&session, document);
    match session.folded_figure_fold_3d(document, &lines, 1, FoldedFigureModel::default()) {
        Ok(Fold3dFoldResult::Placed { snapshot, .. }) => snapshot.verdict,
        other => panic!("{name}: uncancelled fold did not place: {other:?}"),
    }
}

/// A stopped 3D fold must **stop**, not conclude.
///
/// The arrangement stage is the expensive half and its failures are ordinarily
/// recoverable — the figure still draws, only the stacking is unknown. A cancel
/// arriving there was swallowed into that same "no layer order" verdict, so
/// pressing Stop produced a *placed figure* asserting something false about the
/// crease pattern, plus a kernel handle, a canvas entry, an undo step and a
/// dirty project. It is the R1 failure class in its purest form: a stop
/// converted into an answer.
///
/// **The assertion is equality with the unbound baseline, not inequality with a
/// named reason.** The earlier version asserted only that the verdict was not
/// `NoLayerOrder { reason: Cancelled }`, which is the shape a cancel takes when
/// it travels *labelled*. It says nothing about a cancel that has been
/// **relabelled**, and that is what `search_error` did: every non-contradiction
/// arm — including all four cancel arms — became `SearchFailed`, so the figure
/// was placed as `NoLayerOrder { reason: SearchFailed }` and sailed past the
/// guard. A cancel must not change the answer at all; anything weaker only
/// pins the one disguise somebody already thought of.
#[test]
fn a_cancelled_3d_fold_never_concludes_about_the_pattern() {
    for name in ["box_90", "spikes_small", "spikes_large"] {
        let baseline = uncancelled_3d_verdict(name);
        for reads in [0u32, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024] {
            let mut session = CpSession::new();
            let document = load_3d_fixture(&mut session, name);
            let lines = every_line(&session, document);

            let _bound = bind(Some(handle(reads)));
            match session.folded_figure_fold_3d(document, &lines, 1, FoldedFigureModel::default()) {
                Err(error) => assert_eq!(
                    error.code, "fold_cancelled",
                    "{name}: cancel after {reads} reads reached the frontend as {:?}",
                    error.code
                ),
                // Completing is fine — the cancel landed past the end of the
                // fold. Completing with a *different* answer is the bug,
                // whatever reason code the stop was dressed in.
                Ok(Fold3dFoldResult::Placed { snapshot, .. }) => assert_eq!(
                    snapshot.verdict, baseline,
                    "{name}: cancel after {reads} reads changed the verdict"
                ),
                Ok(Fold3dFoldResult::Refused { refusal }) => {
                    panic!("{name}: cancel after {reads} reads became a refusal: {refusal:?}")
                }
            }
        }
    }
}

/// The cancel that lands **inside the ordering search**, specifically.
///
/// The test above sweeps read counts and mostly stops in placement or in the
/// arrangement, which are the cheap stages on these fixtures. This one drives
/// the search itself: it folds once unbound to learn how many source reads a
/// whole fold costs, then stops just short of that, which is where
/// `possible_overlapping_search`'s own checkpoints live. Without it the sweep
/// can be green while every checkpoint in `order.rs` is misclassified, because
/// no `reads` value in the list happened to land there.
#[test]
fn a_cancel_inside_the_layer_order_search_is_a_stop() {
    for name in ["spikes_small", "spikes_large"] {
        let mut session = CpSession::new();
        let document = load_3d_fixture(&mut session, name);
        let lines = every_line(&session, document);

        // Never cancels; the run id it reports matches nothing.
        let counter = Arc::new(CancelAfter {
            run: 0,
            remaining: AtomicU32::new(u32::MAX),
        });
        {
            let _bound = bind(Some(CancelHandle::new(
                Arc::clone(&counter) as Arc<dyn CancelSource>,
                RunId::new(1).expect("non-zero"),
            )));
            session
                .folded_figure_fold_3d(document, &lines, 1, FoldedFigureModel::default())
                .unwrap_or_else(|error| panic!("{name}: baseline fold failed: {error}"));
        }
        let total = u32::MAX - counter.remaining.load(Ordering::Relaxed);
        assert!(
            total > 8,
            "{name}: a whole fold polled only {total} times — too few to stop inside the search"
        );

        // The last eighth of the fold is past placement and the arrangement on
        // these fixtures, so a stop here is a stop in the ordering search.
        for numerator in [7u32, 15] {
            let reads = total * numerator / (numerator + 1);
            let mut session = CpSession::new();
            let document = load_3d_fixture(&mut session, name);
            let lines = every_line(&session, document);

            let _bound = bind(Some(handle(reads)));
            let error = session
                .folded_figure_fold_3d(document, &lines, 1, FoldedFigureModel::default())
                .expect_err(&format!(
                    "{name}: a stop {reads} reads into a {total}-read fold produced a figure"
                ));
            assert_eq!(
                error.code, "fold_cancelled",
                "{name}: a stop {reads} reads into a {total}-read fold reported {:?}",
                error.code
            );
        }
    }
}

/// The fixture the rollback tests need: a document with more than one solution,
/// so seeking has somewhere to go.
fn multi_solution_session() -> FoldingEstimateSession {
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
        "the fixture must actually fold, or these tests prove nothing"
    );
    session
}

/// A cancelled **backwards** seek must leave the session usable.
///
/// Seeking back restarts the enumeration, and a restart replaces the worker
/// wholesale. The transaction's snapshot is narrow — it restores the mutable
/// fields of whatever worker is *there* — so a cancel during the rebuild used to
/// commit `worker: None` under a restored estimate that still advertised another
/// solution. `find another solution` then did nothing at all, silently, for the
/// rest of the session, while the UI went on offering it. `Debug` equality is
/// the assertion because the failure is a missing field, not a wrong value.
#[test]
fn a_cancelled_backwards_seek_restores_the_session() {
    let mut session = multi_solution_session();
    for _ in 0..2 {
        oristudio_cp::folding::fold_another(&mut session).expect("step forward");
    }
    let at_case = session.estimate().current_fold_case;
    assert!(at_case >= 3, "need a case to seek back from, got {at_case}");
    let before = format!("{session:?}");

    for reads in [0u32, 1, 2, 4, 8, 16, 32, 64, 128, 512] {
        let mut candidate = session.clone();
        {
            let _bound = bind(Some(handle(reads)));
            match oristudio_cp::folding::folding_estimate_to_case(
                &mut candidate,
                1,
                EstimationOrder::Order6,
            ) {
                Err(error) => {
                    assert!(error.is_cancelled(), "unexpected error {error:?}");
                    assert_eq!(
                        format!("{candidate:?}"),
                        before,
                        "a cancel after {reads} reads left the session changed"
                    );
                }
                // The seek completed before the cancel landed; it legitimately moved.
                Ok(_) => continue,
            }
        }
        // Unbound, as the next user action would be: the session must still be
        // able to advance. A restored estimate over a dropped worker passes the
        // `Debug` comparison above and fails right here.
        let advanced = oristudio_cp::folding::fold_another(&mut candidate)
            .expect("a rolled-back session must still fold another");
        assert!(
            advanced.current_fold_case != candidate_case_before(&before),
            "after a cancel at {reads} reads the session stopped advancing"
        );
    }
}

/// The `current_fold_case` recorded in a `Debug` rendering, for the assertion
/// that a rolled-back session actually moves when asked to.
fn candidate_case_before(debug: &str) -> usize {
    let marker = "current_fold_case: ";
    let start = debug.find(marker).expect("current_fold_case in Debug") + marker.len();
    let rest = &debug[start..];
    let end = rest
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(rest.len());
    rest[..end].parse().expect("a case number")
}

/// The same hazard through `fold_another`'s **wrap**, which is the other caller
/// of `restart`. At the last solution the step wraps by restarting, so a cancel
/// there hits exactly the path above — and the existing guard test, which runs
/// at case 1, never crosses it.
#[test]
fn a_cancelled_wrap_restores_the_session() {
    let mut session = multi_solution_session();
    // Walk to the last solution, where the next step is a wrap rather than a
    // search. Bounded so a fixture change cannot spin here.
    for _ in 0..64 {
        if !session.estimate().find_another_overlap_valid {
            break;
        }
        oristudio_cp::folding::fold_another(&mut session).expect("step forward");
    }
    assert!(
        !session.estimate().find_another_overlap_valid
            && session.estimate().discovered_fold_cases > 1,
        "the walk must end on a wrap, or this test proves nothing"
    );
    let before = format!("{session:?}");

    for reads in [0u32, 1, 2, 4, 8, 16, 32, 64, 128, 512] {
        let mut candidate = session.clone();
        {
            let _bound = bind(Some(handle(reads)));
            match oristudio_cp::folding::fold_another(&mut candidate) {
                Err(error) => {
                    assert!(error.is_cancelled(), "unexpected error {error:?}");
                    assert_eq!(
                        format!("{candidate:?}"),
                        before,
                        "a cancel after {reads} reads left the session changed"
                    );
                }
                Ok(_) => continue,
            }
        }
        oristudio_cp::folding::fold_another(&mut candidate)
            .expect("a rolled-back session must still wrap");
    }
}
