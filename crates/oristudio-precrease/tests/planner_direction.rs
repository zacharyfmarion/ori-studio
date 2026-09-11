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

use oristudio_precrease::marks::{Creased, crease_runs, end_is_found};
use oristudio_precrease::pinch::Extent;
use oristudio_precrease::planner::PlannerOptions;
use oristudio_precrease::predicates::Ref;
use oristudio_precrease::sequence::{Sequence, Step, StepKind};
use oristudio_precrease::state::{DEFAULT_POINT_CAP, State};
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

/// The plan with the grid off: every line folded one at a time.
fn plan_line_by_line(file: &str) -> Sequence {
    plan_component(&component_of(&load(file)), grid_off_options()).1
}

const EVERY_FIXTURE: [&str; 11] = [
    "tests/fixtures/precrease/grid6.fold",
    "tests/fixtures/precrease/iguana-c0.fold",
    "tests/fixtures/precrease/hex-14.fold",
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
            // A grid step pleats its family from the front, mountains and
            // valleys alternating: the step itself has no one direction, and
            // every line of it has one.
            if let Some(grid) = &step.grid {
                assert_eq!(step.kind, StepKind::Grid, "{file}: {step:?}");
                assert_eq!(step.side, Side::Front, "{file}: {step:?}");
                assert_eq!(step.direction, Direction::Unassigned, "{file}: {step:?}");
                for line in &grid.lines {
                    assert_ne!(line.direction, Direction::Unassigned, "{file}: {line:?}");
                }
                continue;
            }
            assert!(
                step.grid.is_none() && step.kind != StepKind::Grid,
                "{file}: {step:?}"
            );
            match step.direction {
                // A crease made from the front is a valley, one made from the
                // back is a mountain, and there is no third case. A press
                // included: it is made toward the folder from whichever face
                // is up when its mark is needed, so a crease first made from
                // the other face is then creased both ways — as precreasing
                // does — and the card never shows a mountain under "fold P
                // onto Q".
                Direction::Mountain => assert_eq!(step.side, Side::Back, "{file}: {step:?}"),
                Direction::Valley => assert_eq!(step.side, Side::Front, "{file}: {step:?}"),
                // Never: an auxiliary fold has no assignment in the pattern,
                // but it is made toward the folder like every other fold, and
                // its card says which way that is.
                Direction::Unassigned => panic!("{file}: {step:?} is made in no direction"),
            }
            if step.kind == StepKind::Aux {
                assert_eq!(step.direction_share, 0.0, "{file}: {step:?}");
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
/// the other way — which is precisely the line D26's sentence exists for. That
/// branch is covered by
/// [`a_weak_line_reports_the_share_the_side_it_was_folded_on_gets_right`]; this
/// sweep checks the agreement everywhere else.
#[test]
fn the_share_is_the_share_that_direction_gets_right() {
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
        }
    }
}

/// A weak line folded against its own majority reports the share the side it
/// was *made from* gets right — not the majority's share.
///
/// Built here rather than loaded, because no committed fixture reaches this
/// branch: they are small and their sweeps are single-sided. Real designs reach
/// it constantly — 151 steps over the 39 `curated/` designs that plan — which is
/// why the branch has to be covered at all.
#[test]
fn a_weak_line_reports_the_share_the_side_it_was_folded_on_gets_right() {
    // A square, a firmly-valley vertical midline, and a horizontal midline that
    // is 55% mountain — a weak majority, so it does not get to turn the sheet
    // over and is folded on whichever face the valley line put up.
    let (lo, hi) = (-200.0, 200.0);
    let segments = vec![
        lo, lo, hi, lo, // border
        hi, lo, hi, hi, //
        hi, hi, lo, hi, //
        lo, hi, lo, lo, //
        0.0, lo, 0.0, hi, // the valley midline
        lo, 0.0, 20.0, 0.0, // 220 of mountain
        20.0, 0.0, hi, 0.0, // 180 of valley
    ];
    let colors = vec![0, 0, 0, 0, 2, 1, 2];
    let cp = oristudio_precrease::fixture_io::LoadedCp { segments, colors };
    let seq = plan_component(&component_of(&cp), unbounded_options()).1;

    let weak = seq
        .steps
        .iter()
        .find(|s| s.line.n[1].abs() > 0.5)
        .expect("the horizontal midline");
    assert_eq!(weak.side, Side::Front, "{weak:?}");
    assert_eq!(weak.direction, Direction::Valley, "{weak:?}");
    // 220 of 400 is mountain, so the valley it is folded as gets 45% right.
    assert!(
        (weak.direction_share - 0.45).abs() < 1e-9,
        "{}",
        weak.direction_share
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
        // A grid step's spans are on its many lines; the step's own line is
        // the first of them. Check each line as its own chord.
        let chords: Vec<Chord> = seq
            .steps
            .iter()
            .flat_map(|step| match &step.grid {
                Some(grid) => grid
                    .lines
                    .iter()
                    .map(|l| (l.line, l.segment, l.cp_spans.clone(), l.cp_line_ids.clone()))
                    .collect::<Vec<_>>(),
                None if step.kind == StepKind::Aux => {
                    assert!(
                        step.cp_spans.is_empty(),
                        "{file}: aux step {} has spans",
                        step.id
                    );
                    Vec::new()
                }
                None => vec![(
                    step.line,
                    step.segment,
                    step.cp_spans.clone(),
                    step.cp_line_ids.clone(),
                )],
            })
            .collect();
        for (line, segment, cp_spans, cp_line_ids) in &chords {
            assert_eq!(
                cp_spans.len(),
                cp_line_ids.len(),
                "{file}: a chord has {} spans for {} creases",
                cp_spans.len(),
                cp_line_ids.len()
            );
            let mut covered = 0.0;
            for [a, b] in cp_spans {
                for p in [a, b] {
                    assert!(
                        line.distance_to_point(*p) < 1e-9,
                        "{file}: a chord has a span off its own line",
                    );
                    assert!(
                        p[0] >= -1e-9
                            && p[0] <= sheet.width + 1e-9
                            && p[1] >= -1e-9
                            && p[1] <= sheet.height + 1e-9,
                        "{file}: a chord has a span off the sheet: {p:?}",
                    );
                }
                covered += ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt();
            }
            let chord = {
                let [a, b] = segment;
                ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt()
            };
            assert!(
                covered <= chord + 1e-9,
                "{file}: a chord creases more than its length",
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
/// A flagged step says *which* marks it cannot find, and where they are.
///
/// `marks_exist` alone is a complaint with nothing to act on. The coordinates
/// are what a driver hands to ReferenceFinder to get a construction for the
/// mark, so the plan can gain the fold that puts it on the paper — and a
/// coordinate that does not match a point the witness actually names would send
/// it looking for the wrong thing.
#[test]
fn a_flagged_step_says_where_the_marks_it_cannot_find_are() {
    for file in EVERY_FIXTURE {
        let seq = plan(file);
        for step in &seq.steps {
            // A step that can be sighted has nothing missing. The converse
            // does not hold: a flagged step with no missing mark is one whose
            // marks are there but whose creases never line up.
            assert!(
                !step.marks_exist || step.missing_marks.is_empty(),
                "{file}: step {} says it can be sighted and names a missing mark",
                step.id
            );
            if step.missing_marks.is_empty() {
                continue;
            }
            let witness = step
                .chosen
                .and_then(|c| step.witnesses.get(c))
                .unwrap_or_else(|| panic!("{file}: step {} is flagged with no witness", step.id));
            // Every coordinate is one of the points this witness sights.
            let sighted: Vec<[f64; 2]> = witness
                .inputs
                .iter()
                .filter_map(|r| match r {
                    Ref::Point { id } => seq.points.iter().find(|p| p.id == *id).map(|p| p.p),
                    _ => None,
                })
                .collect();
            for mark in &step.missing_marks {
                assert!(
                    sighted
                        .iter()
                        .any(|p| (p[0] - mark[0]).abs() < 1e-9 && (p[1] - mark[1]).abs() < 1e-9),
                    "{file}: step {} reports a missing mark at {mark:?} that its witness \
                     does not sight",
                    step.id
                );
            }
            assert!(
                step.missing_marks.len() <= sighted.len(),
                "{file}: step {} reports more missing marks than it sights",
                step.id
            );
        }
    }
}

/// **Every step is sighted from marks that are on the paper.** Not most — all,
/// on every fixture.
///
/// A fold runs the width of the sheet, but the pattern usually wants only part
/// of it, so the crossing of two *chords* need not be a crease crossing, and
/// telling a folder to bring a corner to a point that is not there is not an
/// instruction. `State` cannot see this: it records a point at every in-sheet
/// crossing of two infinite lines, which is the right model for whether a fold
/// is constructible and the wrong one for whether it can be sighted.
///
/// The ordering pass now puts a **press** step ahead of any fold whose marks
/// are missing — more crease on a line already made, at the crossing — so the
/// mark is there by the time it is needed. This replays the finished plan onto
/// a bare sheet, using each step's *pressed* extent (a press's pinch, an
/// auxiliary line's pinches, a CP step's pattern spans), and recomputes mark
/// existence from that, so a pass that stopped checking cannot pass and a
/// press that pressed the wrong place cannot either.
#[test]
fn every_step_is_sighted_from_marks_that_are_on_the_paper() {
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
                    assert!(
                        here >= 2,
                        "{file}: step {} sights point {id} at {:?}, which has {here} crease(s) \
                         through it on the paper as it stands",
                        step.id,
                        point.p
                    );
                    assert!(
                        step.marks_exist && step.missing_marks.is_empty(),
                        "{file}: step {} sights marks that are on the paper but says otherwise",
                        step.id
                    );
                }
            }
            // Now this step's own crease is on the paper — what it actually
            // pressed, which for a CP step is the pattern's spans and for a
            // press or a pinched auxiliary line is its extent. A grid step
            // pleats every line of its family edge to edge.
            if let Some(grid) = &step.grid {
                for line in &grid.lines {
                    whole.insert(line.line_id);
                }
                continue;
            }
            match pressed_spans(step) {
                None => {
                    whole.insert(step.line_id);
                }
                Some(spans) => {
                    creased.entry(step.line_id).or_default().extend(spans);
                }
            }
        }
        // And the crate's own verdict agrees with the replay everywhere.
        assert!(
            seq.steps.iter().all(|s| s.marks_exist),
            "{file}: a step is still flagged as sighted from a mark that is not on the paper"
        );
    }
}

/// A press step is exactly a pinch on a line an earlier step made, placed
/// right before the step that needs the mark, and never claims pattern crease.
#[test]
fn a_press_is_a_pinch_on_a_line_already_made_and_claims_no_pattern_crease() {
    let mut seen_one = false;
    for file in EVERY_FIXTURE {
        let seq = plan(file);
        let made_at = |line: usize| seq.lines.iter().find(|l| l.id == line).and_then(|l| l.step);
        for (k, step) in seq.steps.iter().enumerate() {
            if step.kind != StepKind::Press {
                continue;
            }
            seen_one = true;
            let press = step
                .press
                .as_ref()
                .unwrap_or_else(|| panic!("{file}: press step {} carries no press", step.id));
            assert!(
                step.cp_spans.is_empty(),
                "{file}: step {} claims pattern crease",
                step.id
            );
            assert!(
                step.cp_line_ids.is_empty(),
                "{file}: step {} claims a CP line",
                step.id
            );
            assert!(
                matches!(step.extent, Extent::Pinches { .. }),
                "{file}: step {} is not a pinch",
                step.id
            );
            let made = made_at(step.line_id)
                .unwrap_or_else(|| panic!("{file}: step {} presses a line nobody made", step.id));
            assert!(
                made < step.id,
                "{file}: step {} presses a line made later",
                step.id
            );
            // A press that runs out to an end (no sighting line) must run to one
            // the folder can find — otherwise the defect has only moved from the
            // mark to the crease end. Replay up to here and ask.
            if press.sighted_from.is_none() {
                let Extent::Pinches { spans } = &step.extent else {
                    unreachable!()
                };
                let mut state = State::new(seq.sheet, DEFAULT_POINT_CAP);
                let mut creased = Creased::new(&state);
                for earlier in &seq.steps[..k] {
                    let Ok(o) = state.add_line(earlier.line, earlier.tag) else {
                        continue;
                    };
                    match pressed_spans(earlier) {
                        None => creased.add_whole(&state, o.id),
                        Some(v) => {
                            let v: Vec<[[f64; 2]; 2]> =
                                v.into_iter().map(|(a, b)| [a, b]).collect();
                            creased.add_spans(&state, o.id, &earlier.line, &v);
                        }
                    }
                }
                let id = state.add_line(step.line, step.tag).map(|o| o.id).ok();
                // The press starts at an end of crease already on this line
                // and runs to an end the folder can find. Which is which is
                // not "nearer the mark": the mark can sit a hair from the
                // findable end.
                let [p, q] = spans[0];
                let existing = |e: [f64; 2]| id.is_some_and(|l| creased.reaches(&state, l, e));
                let findable = |e: [f64; 2]| end_is_found(&state, &creased, &step.line, e);
                assert!(
                    (existing(p) && findable(q)) || (existing(q) && findable(p)),
                    "{file}: step {} presses {p:?}–{q:?}; one end must be crease already there \
                     and the other somewhere the folder can find",
                    step.id
                );
            }
            // The step that needs this mark follows, and the mark is what it sights.
            let needed_by = seq.steps[k + 1..].iter().find(|later| {
                later
                    .chosen
                    .and_then(|c| later.witnesses.get(c))
                    .is_some_and(|w| {
                        // The mark it makes, or the line it carries out.
                        w.inputs.iter().any(|r| match (r, press.point) {
                            (Ref::Point { id }, Some(point)) => *id == point,
                            (Ref::Line { id }, None) => *id == step.line_id,
                            _ => false,
                        })
                    })
            });
            assert!(
                needed_by.is_some(),
                "{file}: step {} presses something no later step uses",
                step.id
            );
        }
        assert_eq!(
            seq.totals.presses as usize,
            seq.steps
                .iter()
                .filter(|s| s.kind == StepKind::Press)
                .count(),
            "{file}: totals.presses"
        );
    }
    assert!(
        seen_one,
        "no fixture needed a press, so nothing above was exercised"
    );
}

/// What a step actually leaves on the paper, as spans; `None` for the whole
/// chord.
fn pressed_spans(step: &Step) -> Option<Vec<Span>> {
    match (&step.kind, &step.extent) {
        // The pattern's spans, and whatever the step pressed on past them.
        (StepKind::Cp, _) if !step.cp_spans.is_empty() => Some(
            step.cp_spans
                .iter()
                .chain(&step.pressed_on)
                .map(|[a, b]| (*a, *b))
                .collect(),
        ),
        (StepKind::Cp, _) => None,
        (_, Extent::Pinches { spans }) => Some(spans.iter().map(|[a, b]| (*a, *b)).collect()),
        (_, Extent::Full) => None,
    }
}

/// One creased piece of a line: its two endpoints.
type Span = ([f64; 2], [f64; 2]);

/// One line a step creases: the line, its chord, and the pattern's spans and
/// crease ids on it.
type Chord = (
    oristudio_precrease::Line,
    [[f64; 2]; 2],
    Vec<[[f64; 2]; 2]>,
    Vec<u32>,
);

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
/// line carrying both, so exactly one schedule is correct — folded line by
/// line, with the grid off.
#[test]
fn a_grid_folds_each_round_from_one_side() {
    let seq = plan_line_by_line("tests/fixtures/precrease/grid6.fold");
    assert_eq!(sides(&seq), "FBBBBFFFFFBBBBF", "grid6 schedule");
    assert_eq!(turn_overs(&seq), 4, "grid6 turn-overs");
    // The pattern's own lines; the one auxiliary fold is made toward the
    // folder like any other and is not counted against the pattern.
    let count = |d: Direction| {
        seq.steps
            .iter()
            .filter(|s| s.kind == StepKind::Cp && s.direction == d)
            .count()
    };
    assert_eq!(count(Direction::Mountain), 7, "grid6 mountains");
    assert_eq!(count(Direction::Valley), 7, "grid6 valleys");
}

/// With the grid on, grid6 opens with its two families pleated from the
/// front, and the four diagonals follow from their crossings: no auxiliary
/// fold, one turn-over where the line-by-line plan needed four.
#[test]
fn a_pleated_grid_opens_the_plan_and_the_diagonals_follow() {
    let seq = plan("tests/fixtures/precrease/grid6.fold");
    let grid = seq.grid.as_ref().expect("grid6 is pleated");
    assert_eq!(grid.n, 6);
    assert_eq!((grid.families, grid.lines, grid.cp_lines), (2, 10, 10));
    assert_eq!(sides(&seq), "FFFFBB", "grid6 schedule with the grid");
    assert_eq!(turn_overs(&seq), 1, "grid6 turn-overs with the grid");
    assert_eq!(seq.totals.aux, 0, "the diagonals need no auxiliary fold");
    assert_eq!(seq.totals.cp_lines, 14);
    assert_eq!(seq.totals.folds, 14);
    let families: Vec<_> = seq.steps.iter().filter_map(|s| s.grid.as_ref()).collect();
    assert_eq!(families.len(), 2);
    for family in &families {
        assert_eq!(family.lines.len(), 5);
        assert_eq!(family.in_pattern, 5);
        // grid6's axis lines alternate exactly as a pleat does.
        assert_eq!(family.reversed, 0);
        for pair in family.lines.windows(2) {
            assert_ne!(pair[0].direction, pair[1].direction);
        }
    }
    // Every step after the grid sights something on it.
    assert!(
        seq.steps[..2].iter().all(|s| !s.unlocks.is_empty()),
        "the grid steps unlock what follows"
    );
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

/// An 89-line real design. Pin the exact count rather than a bound, so a
/// regression that stops reading the evidence is loud rather than quietly
/// cheaper.
///
/// It was 6 before the closure learned to wait for a crease's ends to become
/// findable. Waiting costs sweeps — iguana goes from 7 to 13 — and a sweep
/// boundary is where the sheet gets turned over. This design is one that pays
/// without being paid: its 16 unfindable ends are unfindable either way, and
/// the wait costs it 3 turn-overs and 3 more steps sighted from a mark that is
/// not on the paper. The corpus as a whole goes the other way (see
/// `implementation-plans/precrease-step-ordering.md`), which is why the trade is
/// taken — but not everywhere, and this is the fixture that says so.
#[test]
fn a_real_design_turns_over_a_handful_of_times() {
    let seq = plan_line_by_line("tests/fixtures/precrease/iguana-c0.fold");
    let folds = seq
        .steps
        .iter()
        .filter(|s| s.kind != StepKind::Press)
        .count();
    assert_eq!(folds, 91, "iguana-c0 folds");
    // Presses for marks that were not on the paper and lines whose crease did
    // not reach where a fold used them. Sixteen while every fold was sighted
    // against the paper as its round began; six now that each is sighted at
    // its own place in the order, where the same round's earlier folds have
    // left their marks too.
    assert_eq!(seq.totals.presses, 6, "iguana-c0 presses");
    assert_eq!(seq.steps.len(), 97, "iguana-c0 steps");
    // 9 while hardness sorted before the ease order. The presentation
    // preference also feeds the stuck search's ease term, so changing it can
    // change which auxiliary fold the search takes and everything after it;
    // the auxiliary count is pinned by the manifest and did not move.
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

/// No crease is ever longer than the pattern asks for.
///
/// The closure may wait for a crease's ends to become findable; it may never
/// buy a landmark by creasing past what the design contains. That would be a
/// change to the model rather than an imprecision in performing it, and it is
/// the one repair this ordering work explicitly refuses.
///
/// Frame-agnostic: every step's creased length is compared to the length of the
/// input segments it names, and the ratio of the two is the component's frame
/// scale — one number for the whole plan. A step that creased further would
/// show up as a ratio of its own.
#[test]
fn no_step_creases_more_than_the_pattern_contains() {
    for file in EVERY_FIXTURE {
        let cp = load(file);
        let seq = plan_component(&component_of(&cp), unbounded_options()).1;
        let mut scales: Vec<(u32, f64)> = Vec::new();
        for step in seq.steps.iter().filter(|s| s.kind == StepKind::Cp) {
            let creased: f64 = step
                .cp_spans
                .iter()
                .map(|[a, b]| ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt())
                .sum();
            let wanted: f64 =
                step.cp_line_ids
                    .iter()
                    .map(|&id| {
                        let base = (id as usize - 1) * 4;
                        let s = cp.segments.get(base..base + 4).unwrap_or_else(|| {
                            panic!("{file}: crease id {id} is not in the input")
                        });
                        ((s[2] - s[0]).powi(2) + (s[3] - s[1]).powi(2)).sqrt()
                    })
                    .sum();
            if wanted > 0.0 {
                scales.push((step.id, creased / wanted));
            }
        }
        let Some(&(_, first)) = scales.first() else {
            continue;
        };
        for (id, scale) in &scales {
            assert!(
                (scale - first).abs() < 1e-9,
                "{file}: step {id} creases {scale} of its pattern length where the rest crease {first}"
            );
        }
    }
}

/// Waiting for findable ends never leaves *more* creases stopping nowhere, and
/// never changes which lines get folded.
///
/// The second half is the closure's own guarantee — the fixpoint is
/// order-independent (`closure.rs`, "# Monotonicity") — and it is what makes
/// the preference safe to apply at all: it can move a fold, never drop or add
/// one. The first half is the reason it exists.
#[test]
fn waiting_for_findable_ends_never_loses_a_landmark_or_a_line() {
    for file in EVERY_FIXTURE {
        let component = component_of(&load(file));
        let plans: Vec<Sequence> = [true, false]
            .into_iter()
            .map(|prefer| {
                let opts = PlannerOptions {
                    prefer_findable_ends: prefer,
                    ..unbounded_options()
                };
                plan_component(&component, opts).1
            })
            .collect();
        let [on, off] = [&plans[0], &plans[1]];
        // Folds, not presses: a press is the cost of making a fold sightable,
        // and the two orders may need different ones. What must not differ is
        // what gets folded.
        fn folds(seq: &Sequence) -> impl Iterator<Item = &Step> {
            seq.steps.iter().filter(|s| s.kind != StepKind::Press)
        }
        assert_eq!(folds(on).count(), folds(off).count(), "{file}: fold count");
        let lines = |seq: &Sequence| {
            let mut keys: Vec<String> = folds(seq)
                .map(|s| format!("{:.9},{:.9},{:.9}", s.line.n[0], s.line.n[1], s.line.d))
                .collect();
            keys.sort();
            keys
        };
        assert_eq!(lines(on), lines(off), "{file}: the set of folded lines");
        assert!(
            unfound_ends(on) <= unfound_ends(off),
            "{file}: {} crease ends with no landmark, up from {}",
            unfound_ends(on),
            unfound_ends(off)
        );
    }
}

/// Crease ends the folder cannot find, replaying the plan onto a bare sheet.
fn unfound_ends(seq: &Sequence) -> usize {
    let mut state = State::new(seq.sheet, DEFAULT_POINT_CAP);
    let mut creased = Creased::new(&state);
    let mut lost = 0;
    for step in &seq.steps {
        let spans: Vec<[[f64; 2]; 2]> = pressed_spans(step)
            .map(|v| v.into_iter().map(|(a, b)| [a, b]).collect())
            .unwrap_or_default();
        // A pinch has no ends a folder must find: it is pressed *at* a mark,
        // and where it peters out is incidental. A press's far end is findable
        // by construction (checked in its own test) and its near end is an
        // existing crease's end, already counted by the step that made it. So
        // only a crease has ends: a CP step's pattern spans, or a full
        // auxiliary line.
        let is_pinch =
            step.kind == StepKind::Press || matches!(step.extent, Extent::Pinches { .. });
        if !is_pinch {
            let ends: Vec<[f64; 2]> = crease_runs(&step.line, &spans)
                .into_iter()
                .flat_map(|(a, b)| [a, b])
                .collect();
            lost += ends
                .iter()
                .filter(|e| !end_is_found(&state, &creased, &step.line, **e))
                .count();
        }
        let Ok(outcome) = state.add_line(step.line, step.tag) else {
            continue;
        };
        if spans.is_empty() {
            creased.add_whole(&state, outcome.id);
        } else {
            creased.add_spans(&state, outcome.id, &step.line, &spans);
        }
    }
    lost
}
