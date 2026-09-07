//! Mountain and valley: one direction per step, and as few turn-overs as the
//! round structure allows.
//!
//! These assertions are deliberately two-sided. A turn-over *count* alone
//! cannot catch the ways this goes wrong — a path that forgets to read the
//! evidence, an inverted mountain-is-the-back convention, a majority taken by
//! count instead of by length — because every one of them makes the count go
//! **down**. A `<=` bound would pass while the plan was nonsense. So the exact
//! side of every step is pinned, on fixtures whose schedule is fully
//! determined by their creases.

mod common;

use common::*;
use oristudio_precrease::sequence::{Sequence, StepKind};
use oristudio_precrease::{Component, Direction, ExactnessClass, Side, analyze};

/// The side of every step in order: `"FFBBF"`.
fn sides(seq: &Sequence) -> String {
    seq.steps
        .iter()
        .map(|s| match s.side {
            Side::Front => 'F',
            Side::Back => 'B',
        })
        .collect()
}

/// How many times the folder turns the paper over to make these folds. The
/// sheet starts front side up, so a plan whose first step is on the back opens
/// with one.
fn turn_overs(seq: &Sequence) -> usize {
    let leading = usize::from(seq.steps.first().is_some_and(|s| s.side == Side::Back));
    leading
        + seq
            .steps
            .windows(2)
            .filter(|w| w[0].side != w[1].side)
            .count()
}

fn component_of(cp: &oristudio_precrease::fixture_io::LoadedCp) -> Component {
    analyze_cp(cp)
        .components
        .into_iter()
        .find(|c| c.id == 0)
        .expect("component 0")
}

fn plan(file: &str) -> Sequence {
    plan_component(&component_of(&load(file)), unbounded_options()).1
}

const EVERY_FIXTURE: [&str; 10] = [
    "tests/fixtures/precrease/grid6.fold",
    "tests/fixtures/precrease/iguana-c0.fold",
    "tests/fixtures/precrease/claim7-cand9.fold",
    "tests/fixtures/precrease/g3d_x19.fold",
    "tests/fixtures/precrease/x13_x38.fold",
    "tests/fixtures/precrease/divergence-1.cp",
    "crates/oristudio-cp/resources/default-molecules/bird_base.fold",
    "crates/oristudio-cp/resources/default-molecules/frog_base.fold",
    "tests/fixtures/flat-folder/kabuto.fold",
    "tests/fixtures/oriedita/solution_sample_1.cp",
];

/// D20, on every fixture: a step's crease has exactly one direction, and the
/// side it is made from is the one that direction needs.
#[test]
fn a_step_is_made_from_the_side_its_direction_needs() {
    for file in EVERY_FIXTURE {
        let seq = plan(file);
        assert!(!seq.steps.is_empty(), "{file}: no steps");
        for step in &seq.steps {
            match step.direction {
                // A crease made from the front is a valley, one made from the
                // back is a mountain, and there is no third case.
                Direction::Mountain => assert_eq!(step.side, Side::Back, "{file}: {step:?}"),
                Direction::Valley => assert_eq!(step.side, Side::Front, "{file}: {step:?}"),
                // Only a line the finished pattern assigns nothing.
                Direction::Unassigned => {
                    assert_eq!(step.kind, StepKind::Aux, "{file}: {step:?}");
                    assert_eq!(step.direction_share, 0.0, "{file}: {step:?}");
                }
            }
            assert!(
                (0.0..=1.0).contains(&step.direction_share),
                "{file}: {step:?}"
            );
        }
    }
}

/// Every CP step carries the creases of exactly one line, and the share it
/// reports is the share of that line's creased length it gets right — so a
/// pure line reports 1.0 and a mixed one reports less.
#[test]
fn a_pure_line_gets_all_of_itself_right() {
    let seq = plan("tests/fixtures/precrease/grid6.fold");
    for step in seq.steps.iter().filter(|s| s.kind == StepKind::Cp) {
        assert_eq!(
            step.direction_share, 1.0,
            "grid6 has no line carrying both: {step:?}"
        );
    }
    let iguana = plan("tests/fixtures/precrease/iguana-c0.fold");
    let mixed = iguana
        .steps
        .iter()
        .filter(|s| s.kind == StepKind::Cp && s.direction_share < 1.0)
        .count();
    assert!(
        mixed > 0,
        "a real design should have lines carrying both directions"
    );
    assert!(
        iguana
            .steps
            .iter()
            .all(|s| s.kind != StepKind::Cp || s.direction_share > 0.0),
        "a CP step always gets some of its line right"
    );
}

/// grid6 is the fully determined case: seven mountains, seven valleys, and no
/// line carrying both, so exactly one schedule is correct.
#[test]
fn a_grid_folds_each_round_from_one_side() {
    let seq = plan("tests/fixtures/precrease/grid6.fold");
    assert_eq!(sides(&seq), "FBBBBFFFFFBBBBF", "grid6 schedule");
    assert_eq!(turn_overs(&seq), 4, "grid6 turn-overs");
    let count = |d: Direction| seq.steps.iter().filter(|s| s.direction == d).count();
    assert_eq!(count(Direction::Mountain), 7, "grid6 mountains");
    assert_eq!(count(Direction::Valley), 7, "grid6 valleys");
}

/// The minimal mixed pattern, and the one that catches an inverted
/// mountain-is-the-back convention on two lines.
#[test]
fn the_smallest_mixed_pattern_turns_over_once() {
    let seq = plan("tests/fixtures/precrease/claim7-cand9.fold");
    assert_eq!(sides(&seq), "FFFB", "claim7-cand9 schedule");
    assert_eq!(turn_overs(&seq), 1, "claim7-cand9 turn-overs");
    let last = seq.steps.last().expect("a last step");
    assert_eq!(last.direction, Direction::Mountain);
    assert_eq!(last.side, Side::Back);
}

/// A pattern that is mountains all the way through is folded entirely from the
/// back — turned over once at the start, never again.
#[test]
fn an_all_mountain_pattern_turns_over_once_and_stays_there() {
    let seq = plan("crates/oristudio-cp/resources/default-molecules/bird_base.fold");
    assert!(
        seq.steps.iter().all(|s| s.direction == Direction::Mountain),
        "bird base is all mountain"
    );
    assert_eq!(sides(&seq), "B".repeat(seq.steps.len()));
    assert_eq!(turn_overs(&seq), 1, "bird base turn-overs");
}

/// An 89-line real design. The corpus this schedule was designed against
/// measured a median of 4 turn-overs per design and a p90 of 6; pin the exact
/// count rather than a bound, so a regression that stops reading the evidence
/// is loud rather than quietly cheaper.
#[test]
fn a_real_design_turns_over_a_handful_of_times() {
    let seq = plan("tests/fixtures/precrease/iguana-c0.fold");
    assert_eq!(seq.steps.len(), 91, "iguana-c0 steps");
    assert_eq!(turn_overs(&seq), 6, "iguana-c0 turn-overs");
}

/// The snappable path builds its targets from `SnappedLine`, which carries no
/// crease kinds of its own — the evidence has to be summed over its
/// `source_lines`. Nothing else covers that arm: every manifest fixture is
/// exact. Jittering grid6 off the lattice must not change a single side.
#[test]
fn a_snapped_component_folds_exactly_like_the_exact_one() {
    let cp = load("tests/fixtures/precrease/grid6.fold");
    let jittered = jitter_creases(&cp.segments, &cp.colors, 1e-3);
    let analysis = analyze(&jittered, &cp.colors, Some(ORIEDITA_PAPER)).expect("analysis");
    let component = analysis
        .components
        .iter()
        .find(|c| c.id == 0)
        .expect("component 0");
    assert_eq!(
        component.exactness.as_ref().map(|e| e.class),
        Some(ExactnessClass::Snappable),
        "the jitter should make this snappable, not exact or off-lattice"
    );
    let (_, seq) = plan_component(component, unbounded_options());
    assert_eq!(
        sides(&seq),
        sides(&plan("tests/fixtures/precrease/grid6.fold")),
        "a snapped component lost its directions"
    );
}

/// Groups never merge across a turn-over, so a group is something a folder can
/// do without putting the paper down.
#[test]
fn a_group_is_all_one_side() {
    for file in EVERY_FIXTURE {
        let seq = plan(file);
        for group in &seq.groups {
            let mut group_sides = group
                .step_ids
                .iter()
                .map(|&id| seq.steps[id as usize - 1].side);
            let first = group_sides.next().expect("a group is not empty");
            assert!(
                group_sides.all(|s| s == first),
                "{file}: group {group:?} spans a turn-over"
            );
            assert_eq!(group.side, first, "{file}: group {group:?}");
        }
    }
}
