//! A line with no exact construction is folded by the closest one there is,
//! after every exact fold — and every step that is not exact says so, its
//! own or inherited.

mod common;

use common::*;
use oristudio_precrease::closure::FoldOutcome;
use oristudio_precrease::drive::{DriverState, LastStep, PlanAction};
use oristudio_precrease::planner::{Planner, PlannerOptions};
use oristudio_precrease::sequence::{Status, StepKind};
use oristudio_precrease::{Line, Sheet};

fn v(x: f64) -> Line {
    Line::new([1.0, 0.0], x).expect("line")
}

fn h(y: f64) -> Line {
    Line::new([0.0, 1.0], y).expect("line")
}

/// The midlines, a vertical no fold sequence reaches (x = 0.314…), and a
/// line the pattern draws from where that vertical crosses the horizontal
/// midline to the corner.
fn awkward() -> (Planner, Line, Line) {
    let off = v(0.3141592653589793);
    let through = Line::from_points([0.0, 0.0], [0.3141592653589793, 0.5]).expect("line");
    let planner = Planner::from_lines(
        Sheet::unit_square(),
        &[v(0.5), h(0.5), off, through],
        unbounded_options(),
    );
    (planner, off, through)
}

#[test]
fn without_reference_finder_the_awkward_lines_stay_findings() {
    let (mut planner, _, _) = awkward();
    let status = planner.plan_without_reference_finder().expect("plan");
    assert_eq!(status, Status::PartialUnsolved);
    let seq = planner.sequence(false);
    assert_eq!(seq.totals.cp_lines, 2, "the midlines");
    assert_eq!(seq.totals.unsolved, 2);
    assert!(seq.steps.iter().all(|s| s.exact));
    assert_eq!(seq.totals.approximate, 0);
}

/// Drive the rules by hand as a driver with ReferenceFinder would, standing
/// in for it: when told to approximate, fold the awkward vertical as x = 1/4
/// (which the state constructs exactly, the left edge onto the midline),
/// 0.064 of the sheet away. The line drawn from its crossing then closes
/// exactly relative to it — and is marked inexact all the same.
#[test]
fn an_approximation_is_folded_last_and_everything_sighted_from_it_says_so() {
    let (mut planner, off, through) = awkward();
    let mut driver = DriverState {
        reference_finder: true,
        max_rf_events: 4,
        approximate: true,
        ..DriverState::default()
    };
    let mut asked_exact = 0;
    let mut approximated = 0;
    loop {
        match planner.next_action(driver) {
            PlanAction::Close => {
                let out = planner.close(0.0).expect("close");
                driver.last = LastStep::Closed {
                    stalled: !out.fixpoint && out.folded == 0 && out.remaining > 0,
                };
            }
            PlanAction::StuckSearch => {
                let found = planner.stuck_search(2, 0.0).expect("search").is_some();
                driver.last = LastStep::Searched { found };
            }
            PlanAction::AskReferenceFinder => {
                asked_exact += 1;
                driver.rf_events += 1;
                driver.last = LastStep::AskedReferenceFinder { folded: false };
            }
            PlanAction::Approximate => {
                approximated += 1;
                let out = planner
                    .fold_approximation(&off, &v(0.25), 0.3141592653589793 - 0.25, 0.0)
                    .expect("fold");
                let folded = matches!(out, FoldOutcome::Folded { .. });
                driver.last = LastStep::Approximated { folded };
            }
            PlanAction::Stop { .. } => break,
        }
    }
    assert_eq!(
        asked_exact, 1,
        "exact ReferenceFinder is asked before any approximation"
    );
    assert_eq!(
        approximated, 1,
        "one approximation, then the rest closes exactly"
    );
    assert_eq!(planner.status(), Status::Complete);

    let seq = planner.sequence(false);
    let step_of = |line: &Line| {
        seq.steps
            .iter()
            .find(|s| {
                s.kind == StepKind::Cp
                    && (s.line.n[0] - line.n[0]).abs() < 1e-9
                    && (s.line.d - line.d).abs() < 1e-9
            })
            .unwrap_or_else(|| panic!("no step for {line:?}"))
    };
    let approximate = step_of(&off);
    assert!(!approximate.exact);
    assert!((approximate.approximation.expect("err") - 0.0641592653589793).abs() < 1e-12);
    // Its card shows the construction that was made — x = 1/4, the corner
    // onto the midline's foot or the left edge onto the midline — not the
    // pattern's line, which nothing constructs.
    let w = approximate
        .chosen
        .and_then(|c| approximate.witnesses.get(c))
        .expect("a witness");
    assert!(matches!(w.axiom, 2 | 3), "{w:?}");
    assert!(w.err < 1e-9, "exact for the line it makes: {w:?}");
    // The line drawn from its crossing closed exactly, relative to it, and is
    // not exact for that.
    let inherited = step_of(&through);
    assert!(!inherited.exact, "{inherited:?}");
    assert_eq!(inherited.approximation, None);
    // The midlines are.
    assert!(step_of(&v(0.5)).exact);
    assert!(step_of(&h(0.5)).exact);
    assert_eq!(seq.totals.approximate, 2);
    assert_eq!(seq.totals.unsolved, 0);
    // The approximation came after every exact fold.
    let first_inexact = seq.steps.iter().position(|s| !s.exact).expect("one");
    assert!(seq.steps[..first_inexact].iter().all(|s| s.exact));
    assert!(
        seq.steps[first_inexact..]
            .iter()
            .all(|s| !s.exact || s.kind == StepKind::Press)
    );
}

/// The search deepens to find a set of auxiliaries that *completes* the
/// closure. Once an approximation is on the paper there is no such set to
/// find — the pattern is off its lattice from here — and deepening only ran
/// the cap out: on a 332-line off-lattice design every search took the full
/// four seconds to unlock one target, twenty minutes a plan. So the same
/// root set the exact regime searches to the depth asked for (and promotes
/// to 3 when it is small) is searched to depth 1 once anything has been
/// approximated, whatever depth is asked for.
#[test]
fn once_an_approximation_is_on_the_paper_the_search_stops_deepening() {
    let off = v(0.3141592653589793);
    let through = Line::from_points([0.0, 0.0], [0.3141592653589793, 0.5]).expect("line");
    // A line from the awkward vertical's foot to nowhere the paper marks:
    // still stuck after the vertical is approximated, so a search runs.
    let stuck = Line::from_points([0.3141592653589793, 0.0], [0.7, 1.0]).expect("line");
    let mut planner = Planner::from_lines(
        Sheet::unit_square(),
        &[v(0.5), h(0.5), off, through, stuck],
        unbounded_options(),
    );
    planner.close(0.0).expect("close");
    assert!(planner.stuck_search(2, 0.0).expect("search").is_none());
    let exact_regime = planner.stuck_events().last().expect("an event");
    assert!(
        exact_regime.depth_reached >= 2,
        "the exact regime deepens to the depth asked for: {exact_regime:?}"
    );

    let out = planner
        .fold_approximation(&off, &v(0.25), 0.3141592653589793 - 0.25, 0.0)
        .expect("fold");
    assert!(matches!(out, FoldOutcome::Folded { .. }), "{out:?}");
    assert!(planner.remaining().iter().any(|r| r.line == stuck));

    planner.stuck_search(2, 0.0).expect("search");
    let after = planner.stuck_events().last().expect("an event");
    // Nothing completed at depth 1, so the exact regime would have gone on
    // to depth 2 here; the approximate regime does not.
    assert!(!after.complete && after.exhausted, "{after:?}");
    assert_eq!(
        after.depth_reached, 1,
        "with an approximation on the paper the search does not deepen: {after:?}"
    );
}

/// With more lines left than the cap once every exact avenue is exhausted,
/// the plan stops where it would have approximated, and says so. The cap is
/// the option or a tenth of the pattern's lines, whichever is more, and zero
/// is no cap.
#[test]
fn more_lines_than_the_cap_stop_the_plan_instead_of_being_approximated() {
    use oristudio_precrease::drive::StopReason;

    // Three awkward verticals no fold sequence reaches, beside the midlines.
    let lines = [
        v(0.5),
        h(0.5),
        v(0.3141592653589793),
        v(0.2718281828459045),
        v(0.1618033988749895),
    ];
    let planner_with_cap = |cap: usize| {
        Planner::from_lines(
            Sheet::unit_square(),
            &lines,
            PlannerOptions {
                approximate_lines_cap: cap,
                ..unbounded_options()
            },
        )
    };
    let exhaust = |planner: &mut Planner| {
        planner.close(0.0).expect("close");
        assert!(planner.stuck_search(2, 0.0).expect("search").is_none());
        assert_eq!(planner.remaining().len(), 3);
    };

    // Cap 2, three awkward lines left: the rules stop the plan.
    let mut planner = planner_with_cap(2);
    exhaust(&mut planner);
    assert!(planner.approximations_exceed_cap());
    let driver = DriverState {
        last: LastStep::AskedReferenceFinder { folded: false },
        reference_finder: true,
        max_rf_events: 4,
        approximate: true,
        ..DriverState::default()
    };
    assert_eq!(
        planner.next_action(driver),
        PlanAction::Stop {
            reason: StopReason::TooManyApproximations
        }
    );
    // The exact folds made before it are the plan; the rest are findings.
    let seq = planner.sequence(false);
    assert_eq!(seq.totals.cp_lines, 2);
    assert_eq!(seq.findings.len(), 3);

    // Cap 3: the same state approximates.
    let mut planner = planner_with_cap(3);
    exhaust(&mut planner);
    assert!(!planner.approximations_exceed_cap());
    assert_eq!(planner.next_action(driver), PlanAction::Approximate);

    // No cap.
    let mut planner = planner_with_cap(0);
    exhaust(&mut planner);
    assert!(!planner.approximations_exceed_cap());

    // The cap is never below a tenth of the pattern: thirty-one exact
    // horizontals (the thirty-seconds, which close by halving) and the same
    // three stray verticals make thirty-four lines, so a cap of 2 allows
    // three.
    let mut many: Vec<Line> = (1..=31).map(|i| h(i as f64 / 32.0)).collect();
    many.extend([
        v(0.3141592653589793),
        v(0.2718281828459045),
        v(0.1618033988749895),
    ]);
    let mut planner = Planner::from_lines(
        Sheet::unit_square(),
        &many,
        PlannerOptions {
            approximate_lines_cap: 2,
            ..unbounded_options()
        },
    );
    planner.close(0.0).expect("close");
    assert_eq!(
        planner.remaining().len(),
        3,
        "{:?}",
        planner.remaining().len()
    );
    assert!(!planner.approximations_exceed_cap());
}
