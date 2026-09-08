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
use std::collections::{HashMap, HashSet};

use oristudio_precrease::predicates::Ref;
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

/// `direction_share` is the share of the line's creased length the step's own
/// direction gets right — recomputed here from the fixture's raw colours, so a
/// call site that passed the wrong majority in cannot pass.
///
/// This is the one number that goes wrong *silently*: swapping the arguments to
/// `share_of` leaves every side, every direction and every turn-over count
/// exactly as it was, and only misreports a weak line that the schedule creased
/// the other way — which is precisely the line D26's sentence exists for.
#[test]
fn the_share_is_the_share_that_direction_gets_right() {
    let mut reversed_seen = 0;
    for file in EVERY_FIXTURE {
        let cp = load(file);
        let seq = plan_component(&component_of(&cp), unbounded_options()).1;
        for step in seq.steps.iter().filter(|s| s.kind == StepKind::Cp) {
            let (mut mountain, mut valley) = (0.0, 0.0);
            for &id in &step.cp_line_ids {
                let base = (id as usize - 1) * 4;
                let Some(seg) = cp.segments.get(base..base + 4) else {
                    panic!("{file}: crease id {id} is not in the input")
                };
                let length = ((seg[2] - seg[0]).powi(2) + (seg[3] - seg[1]).powi(2)).sqrt();
                match cp.colors.get(id as usize - 1) {
                    Some(1) => mountain += length,
                    Some(2) => valley += length,
                    _ => {}
                }
            }
            let total = mountain + valley;
            if total <= 0.0 {
                continue;
            }
            let mine = match step.direction {
                Direction::Mountain => mountain / total,
                Direction::Valley => valley / total,
                Direction::Unassigned => continue,
            };
            // Model-space lengths, not unit-sheet ones: the crate measures in
            // the unit frame, but a share is a ratio and the frame's scale is
            // isotropic, so the two agree.
            assert!(
                (mine - step.direction_share).abs() < 1e-9,
                "{file}: step {} says {} of its length folds {:?}, the pattern says {mine}",
                step.id,
                step.direction_share,
                step.direction
            );
            if step.direction_share < 0.5 {
                reversed_seen += 1;
            }
        }
    }
    // The fixtures must actually contain a line the schedule creased against its
    // own majority, or the assertion above never exercises the branch.
    assert!(
        reversed_seen > 0,
        "no fixture has a weak line creased the other way"
    );
}

/// A CP step knows *where* on its chord the pattern wants creases.
///
/// The fold crosses the whole sheet, but a diagram that draws the whole chord
/// tells the folder to crease more than the pattern asks for — which is what
/// the step cards did before this. Every span has to lie on the fold's own line
/// and inside the sheet, or the card draws somewhere the paper is not.
#[test]
fn a_cp_step_says_where_on_its_chord_the_creases_are() {
    for file in EVERY_FIXTURE {
        let seq = plan(file);
        let sheet = seq.sheet;
        let mut partial = 0;
        for step in &seq.steps {
            if step.kind == StepKind::Aux {
                assert!(
                    step.cp_spans.is_empty(),
                    "{file}: aux step {} has spans",
                    step.id
                );
                continue;
            }
            assert_eq!(
                step.cp_spans.len(),
                step.cp_line_ids.len(),
                "{file}: step {} has {} spans for {} creases",
                step.id,
                step.cp_spans.len(),
                step.cp_line_ids.len()
            );
            let mut covered = 0.0;
            for [a, b] in &step.cp_spans {
                for p in [a, b] {
                    assert!(
                        step.line.distance_to_point(*p) < 1e-9,
                        "{file}: step {} has a span off its own line",
                        step.id
                    );
                    assert!(
                        p[0] >= -1e-9
                            && p[0] <= sheet.width + 1e-9
                            && p[1] >= -1e-9
                            && p[1] <= sheet.height + 1e-9,
                        "{file}: step {} has a span off the sheet: {p:?}",
                        step.id
                    );
                }
                covered += ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt();
            }
            let chord = {
                let [a, b] = step.segment;
                ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt()
            };
            assert!(
                covered <= chord + 1e-9,
                "{file}: step {} creases more than its chord",
                step.id
            );
            if covered < chord - 1e-6 {
                partial += 1;
            }
        }
        // If every step creased its whole chord there would be nothing to fix,
        // and this test would be watching nothing.
        if file.contains("markhor") || file.contains("iguana") {
            assert!(
                partial > 0,
                "{file}: no step creases only part of its chord"
            );
        }
    }
}

/// A step is described by marks that are actually on the paper.
///
/// A fold runs the width of the sheet, but the pattern usually wants only part
/// of it — so the crossing of two *chords* need not be a crease crossing, and
/// telling a folder to bring a corner to a point that is not there is not an
/// instruction. `State` cannot see this: it records a point at every in-sheet
/// crossing of two infinite lines, which is the right model for whether a fold
/// is constructible and the wrong one for whether it can be sighted.
///
/// The ordering pass prefers a recorded witness whose marks exist, and flags
/// the step when none does. Recompute both here from `cp_spans`, so a pass that
/// stopped checking cannot pass.
#[test]
fn a_step_is_sighted_from_marks_that_are_on_the_paper() {
    for file in EVERY_FIXTURE {
        let seq = plan(file);
        // Where the paper is creased, line by line, as the sequence proceeds.
        let mut creased: HashMap<usize, Vec<Span>> = HashMap::new();
        let mut whole: HashSet<usize> = HashSet::new();
        for entry in &seq.lines {
            if entry.step.is_none() {
                whole.insert(entry.id);
            }
        }
        let mut flagged = 0;
        for step in &seq.steps {
            let witness = step.chosen.and_then(|c| step.witnesses.get(c));
            if let Some(w) = witness {
                for input in &w.inputs {
                    let Ref::Point { id } = input else { continue };
                    let point = seq
                        .points
                        .iter()
                        .find(|p| p.id == *id)
                        .unwrap_or_else(|| panic!("{file}: step {} names point {id}", step.id));
                    let reach = |line: usize| {
                        if whole.contains(&line) {
                            return true;
                        }
                        creased.get(&line).is_some_and(|spans| {
                            spans.iter().any(|(a, b)| on_span(*a, *b, point.p))
                        })
                    };
                    let here = point.lines.iter().filter(|&&l| reach(l)).count();
                    if here < 2 {
                        assert!(
                            !step.marks_exist,
                            "{file}: step {} sights a mark that is not on the paper, unflagged",
                            step.id
                        );
                        flagged += 1;
                    }
                }
            }
            // Now this step's own crease is on the paper.
            if step.cp_spans.is_empty() {
                whole.insert(step.line_id);
            } else {
                creased
                    .entry(step.line_id)
                    .or_default()
                    .extend(step.cp_spans.iter().map(|[a, b]| (*a, *b)));
            }
        }
        // A flag that never fires is a flag nobody can trust.
        if file.contains("iguana") {
            assert!(
                flagged > 0,
                "{file}: expected some steps to need a mark made"
            );
        }
    }
}

/// One creased piece of a line: its two endpoints.
type Span = ([f64; 2], [f64; 2]);

/// Whether `p` lies on the segment `a`–`b`.
fn on_span(a: [f64; 2], b: [f64; 2], p: [f64; 2]) -> bool {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let length = dx.hypot(dy);
    if length <= 0.0 {
        return false;
    }
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (length * length);
    if !(-1e-9..=1.0 + 1e-9).contains(&t) {
        return false;
    }
    let (qx, qy) = (a[0] + t * dx, a[1] + t * dy);
    (p[0] - qx).hypot(p[1] - qy) < 1e-9
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
