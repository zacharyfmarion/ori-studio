//! Regressions from the plan's testing strategy: the prototype's false
//! positives (verify-claim2), the canonical-sign seam, corner reflections,
//! quantum-straddle points, the ±45° visibility bug, a fixture whose closure
//! exercises O3–O7, and a shuffle test.

mod common;

use common::*;
use oristudio_precrease::clock::{Deadline, frozen_clock};
use oristudio_precrease::closure::{Closure, FoldOutcome, Target};
use oristudio_precrease::predicates::{Witness, all_witnesses, tier1_facts};
use oristudio_precrease::sequence::{Status, StepKind};
use oristudio_precrease::state::{DEFAULT_POINT_CAP, LineTag, State};
use oristudio_precrease::{Line, Sheet, TOL};

fn v(x: f64) -> Line {
    Line::new([1.0, 0.0], x).expect("line")
}

fn h(y: f64) -> Line {
    Line::new([0.0, 1.0], y).expect("line")
}

fn closure_of(lines: &[Line]) -> Closure {
    let mut c = Closure::new(
        Sheet::unit_square(),
        lines
            .iter()
            .map(|l| Target::unassigned(*l, vec![]))
            .collect(),
        DEFAULT_POINT_CAP,
    );
    c.close(&Deadline::unbounded(frozen_clock()))
        .expect("close");
    c
}

/// A state holding exactly `lines` beside the sheet edges. `add_line` does
/// **not** ask whether a line is constructible, which is what these
/// regressions need: the prototype's counterexamples describe a state ("with
/// the top-left diagonal and a grid line folded…"), not a plan reaching it.
fn state_with(lines: &[Line]) -> State {
    let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
    for &l in lines {
        state.add_line(l, LineTag::Cp).expect("add");
    }
    state
}

/// Re-check the plan's executability conditions for one witness, from the
/// witness and the state alone — deliberately not through the forward
/// constructors that produced it, so this is an independent statement about
/// what the closure recorded rather than a restatement of `certify`.
fn executability_violation(state: &State, target: &Line, w: &Witness) -> Option<String> {
    let sheet = *state.sheet();
    let point = |i: usize| state.point(w.inputs[i].id());
    let line = |i: usize| *state.line(w.inputs[i].id());
    let on_sheet = |p: [f64; 2]| sheet.contains(p, 1e-6);
    let lands_on = |p: [f64; 2], m: &Line| {
        let r = target.reflect_point(p);
        on_sheet(r) && m.distance_to_point(r) <= 1e-6
    };
    let crossing_on_sheet = |m: &Line| target.intersect(m).is_some_and(on_sheet);
    match w.axiom {
        1 => {
            let (p, q) = (point(0), point(1));
            let far = (p[0] - q[0]).hypot(p[1] - q[1]) > TOL;
            let on = target.distance_to_point(p) <= 1e-6 && target.distance_to_point(q) <= 1e-6;
            (!far || !on).then(|| "O1: inputs are not two distinct points on the line".to_string())
        }
        2 => {
            let r = target.reflect_point(point(0));
            let q = point(1);
            ((r[0] - q[0]).hypot(r[1] - q[1]) > 1e-6)
                .then(|| "O2: the reflection of p is not q".to_string())
        }
        3 => {
            let (m1, m2) = (line(0), line(1));
            if m1.approx_eq(&m2) {
                return Some("O3: the two reference lines are the same".to_string());
            }
            let Some((a, b)) = sheet.clip(&m1) else {
                return Some("O3: m1 misses the sheet".to_string());
            };
            let Some((c0, c1)) = sheet.clip_parameters(&m2) else {
                return Some("O3: m2 misses the sheet".to_string());
            };
            let ta = m2.parameter(target.reflect_point(a));
            let tb = m2.parameter(target.reflect_point(b));
            let overlap = ta.max(tb).min(c1) - ta.min(tb).max(c0);
            (overlap <= TOL)
                .then(|| format!("O3: m1's in-paper material lands off m2's (overlap {overlap})"))
        }
        4 => {
            let m = line(1);
            if target.dot(&m).abs() > 1e-6 {
                return Some("O4: the reference line is not perpendicular".to_string());
            }
            if !crossing_on_sheet(&m) {
                return Some(
                    "O4: the crease meets its perpendicular reference off the sheet".to_string(),
                );
            }
            (target.distance_to_point(point(0)) > 1e-6)
                .then(|| "O4: the point is not on the crease".to_string())
        }
        5 => {
            let (pivot, p, m1) = (point(0), point(1), line(2));
            if target.distance_to_point(pivot) > 1e-6 {
                return Some("O5: the pivot is not on the crease".to_string());
            }
            if m1.distance_to_point(p) <= TOL {
                return Some("O5: the moved point already lies on its landing line".to_string());
            }
            (!lands_on(p, &m1)).then(|| "O5: the point does not land on m1 in-paper".to_string())
        }
        6 => {
            let (p1, m1, p2, m2) = (point(0), line(1), point(2), line(3));
            if w.inputs[0].id() == w.inputs[2].id() {
                return Some("O6: the same point twice".to_string());
            }
            if w.inputs[1].id() == w.inputs[3].id() {
                return Some("O6: the same line twice".to_string());
            }
            (!lands_on(p1, &m1) || !lands_on(p2, &m2))
                .then(|| "O6: a point does not land on its line in-paper".to_string())
        }
        7 => {
            let (p, m1, m2) = (point(0), line(1), line(2));
            if target.dot(&m2).abs() > 1e-6 {
                return Some("O7: the reference line is not perpendicular".to_string());
            }
            if !crossing_on_sheet(&m2) {
                return Some(
                    "O7: the crease meets its perpendicular reference off the sheet".to_string(),
                );
            }
            if m1.distance_to_point(p) <= TOL {
                return Some("O7: the moved point already lies on its landing line".to_string());
            }
            (!lands_on(p, &m1)).then(|| "O7: the point does not land on m1 in-paper".to_string())
        }
        other => Some(format!("axiom O{other} is not one of the seven")),
    }
}

#[test]
fn verify_claim2_o4_o7_crossings_outside_the_sheet_are_not_constructions() {
    // Case A/B2: box-pleat corner diagonals. With the top-left diagonal and a
    // steep grid line folded, the bottom-left diagonal is *not* constructible:
    // its only perpendicular reference meets it off the paper, which is what
    // the prototype's O4 and O7 conditions failed to check.
    let m = Line::from_points([0.0, 0.9], [0.1, 1.0]).expect("l");
    let steep = Line::from_points([0.1, 0.0], [0.1 + 0.9 / 3f64.sqrt(), 1.0]).expect("l");
    let state = state_with(&[m, steep]);
    let target = Line::from_points([0.0, 0.1], [0.1, 0.0]).expect("l");
    assert!(
        tier1_facts(&state, &target).perps.is_empty(),
        "the perpendicular reference meets the crease off the sheet"
    );
    assert!(
        all_witnesses(&state, &target).is_empty(),
        "{:?}",
        all_witnesses(&state, &target)
    );

    // Case B: the corner diagonal at 0.3 with x = 0.3 folded is a *genuine*
    // O5 — the corner (0,0) lands on x = 0.3 with the pivot (0.3, 0) — so it
    // must construct, and it does so through the closure from the bare sheet
    // once x = 0.3's own landmark exists. Here the state is stated directly.
    let state = state_with(&[v(0.3)]);
    let target = Line::from_points([0.0, 0.3], [0.3, 0.0]).expect("l");
    let ws = all_witnesses(&state, &target);
    assert!(
        ws.iter().any(|w| w.axiom == 5),
        "{:?}",
        ws.iter().map(|w| w.axiom).collect::<Vec<_>>()
    );
    for w in &ws {
        assert_eq!(executability_violation(&state, &target, w), None, "{w:?}");
    }
}

#[test]
fn verify_claim2_o3_external_bisector_is_refused() {
    // Two lines meeting at (−0.1, 0.5), off the sheet. Both bisectors cross
    // the sheet, but only the one that carries m's in-paper material onto
    // r's in-paper material is a fold that aligns anything; the prototype
    // accepted both.
    let x = [-0.1, 0.5];
    let m = Line::from_points(x, [1.0, 0.0]).expect("l");
    let r = Line::from_points(x, [0.2, 1.0]).expect("l");
    let u1 = m.direction();
    let u2 = r.direction();
    let b0 = Line::from_point_direction(x, [u1[0] + u2[0], u1[1] + u2[1]]).expect("l");
    let b1 = Line::from_point_direction(x, [u1[0] - u2[0], u1[1] - u2[1]]).expect("l");
    let state = state_with(&[m, r]);
    let with_o3: Vec<&Line> = [&b0, &b1]
        .into_iter()
        .filter(|b| all_witnesses(&state, b).iter().any(|w| w.axiom == 3))
        .collect();
    assert_eq!(with_o3.len(), 1, "exactly one bisector aligns material");
    for b in [&b0, &b1] {
        assert!(state.sheet().crosses(b), "both bisectors cross the sheet");
        for w in all_witnesses(&state, b) {
            assert_eq!(executability_violation(&state, b, &w), None, "{w:?}");
        }
    }
}

#[test]
fn every_recorded_witness_is_executable_on_real_fixtures() {
    // The plan's executability column, re-checked from the witness records of
    // real crease patterns rather than from a hand-built state: no O3 without
    // in-paper overlap, no O4/O7 whose crease meets its perpendicular
    // reference off the sheet, no vacuous lander.
    let mut counted = 0usize;
    let mut axioms = [0usize; 8];
    for file in [
        "tests/fixtures/precrease/grid6.fold",
        "tests/fixtures/flat-folder/kabuto.fold",
        "tests/fixtures/oriedita/solution_sample_1.cp",
        "crates/oristudio-cp/resources/default-molecules/bird_base.fold",
        "crates/oristudio-cp/resources/default-molecules/frog_base.fold",
        "tests/fixtures/precrease/g3d_x19.fold",
        "tests/fixtures/precrease/x13_x38.fold",
        "tests/fixtures/precrease/claim7-cand9.fold",
    ] {
        let cp = load(file);
        let analysis = analyze_cp(&cp);
        let (planner, _) = plan_component(&analysis.components[0], unbounded_options());
        let closure = planner.closure_ref().expect("closure");
        let state = closure.state();
        for folded in closure.folded() {
            for w in &folded.witnesses {
                assert_eq!(
                    executability_violation(state, &folded.line, w),
                    None,
                    "{file}: {w:?}"
                );
                axioms[w.axiom as usize] += 1;
                counted += 1;
            }
        }
    }
    assert!(counted > 200, "only {counted} witnesses checked");
    for a in 1..=7 {
        assert!(axioms[a] > 0, "axiom O{a} never exercised: {axioms:?}");
    }
}

#[test]
fn verify_claim2_o6_same_line_and_same_point_pairs_are_not_o6() {
    // Two corners onto the same edge is the midline (O2/O3), never an O6
    // witness; a corner onto two different edges is O2 onto the far corner.
    let state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
    let ws = all_witnesses(&state, &h(0.5));
    for w in ws.iter().filter(|w| w.axiom == 6) {
        assert_ne!(w.inputs[0].id(), w.inputs[2].id(), "same point: {w:?}");
        assert_ne!(w.inputs[1].id(), w.inputs[3].id(), "same line: {w:?}");
    }
    let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("l");
    for w in all_witnesses(&state, &diag).iter().filter(|w| w.axiom == 6) {
        assert_ne!(w.inputs[0].id(), w.inputs[2].id());
        assert_ne!(w.inputs[1].id(), w.inputs[3].id());
    }
}

#[test]
fn near_horizontal_canonical_seam_lines_are_one_line() {
    // Two representations of y = ½ straddling n.x = 0: canonicalisation flips
    // the second, so the stored normals point opposite ways. A target given
    // as one and a construction producing the other must still agree.
    let a = Line::new([1e-9, 1.0], 0.5).expect("l");
    let b = Line::new([-1e-9, 1.0], 0.5).expect("l");
    assert!(a.n[1] > 0.0 && b.n[1] < 0.0, "the two straddle the seam");
    assert!(a.approx_eq(&b));
    let mut c = closure_of(&[a]);
    // The O2 construction from the corners makes y = ½ exactly (n.x = 0);
    // its certificate must still recognise the tilted target.
    assert!(c.is_complete(), "{:?}", c.remaining());
    let folded = &c.folded()[0];
    assert_eq!(folded.chosen_witness().expect("w").axiom, 2);
    assert!(folded.chosen_witness().expect("w").err <= TOL);
    assert!(matches!(
        c.fold_line(b, LineTag::Aux).expect("fold"),
        FoldOutcome::AlreadyFolded { .. }
    ));
    // Duplicate targets across the seam are planned once.
    let c2 = closure_of(&[a, b]);
    assert!(c2.is_complete());
    assert_eq!(c2.folded().len(), 1);
}

#[test]
fn corner_reflection_o2_from_corner_to_corner_is_the_midline() {
    let state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
    let ws = all_witnesses(&state, &v(0.5));
    let o2 = ws.iter().find(|w| w.axiom == 2).expect("o2");
    assert!(
        o2.inputs
            .iter()
            .all(|r| matches!(r, oristudio_precrease::Ref::Corner { .. }))
    );
    assert!(!o2.hard && o2.visible);
    // Reflecting a corner across the diagonal lands on a corner: O2 for the
    // diagonal with corner inputs, and the reflection of (1,0) is (0,1).
    let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("l");
    let r = diag.reflect_point([1.0, 0.0]);
    assert!((r[0]).abs() < 1e-12 && (r[1] - 1.0).abs() < 1e-12);
    assert!(all_witnesses(&state, &diag).iter().any(|w| w.axiom == 2));
}

#[test]
fn quantum_straddle_points_are_one_mark() {
    // Three concurrent lines whose common point sits exactly on a grid-cell
    // boundary. Each pair computes it by different arithmetic, so the three
    // computed crossings land on either side of the boundary; the grid must
    // still return one mark with three incident lines, never two marks a
    // rounding apart. (Parallel lines cannot make this case: their crossings
    // with a third line are as far apart as their offsets, so two crossings
    // within TOL would mean two lines within TOL — one line.)
    let cell = oristudio_precrease::state::POINT_LOOKUP_RADIUS;
    let y = 250.0 * cell; // exactly on a cell boundary
    let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
    state.add_line(v(0.5), LineTag::Cp).expect("add");
    state.add_line(h(y), LineTag::Cp).expect("add");
    let before = state.point_count();
    // A third line through the same point, built from far-away endpoints so
    // its intersections are computed with different rounding.
    let diag = Line::from_points([0.5 - 0.4, y - 0.4], [0.5 + 0.4, y + 0.4]).expect("l");
    state.add_line(diag, LineTag::Cp).expect("add");
    let mark = state.find_point([0.5, y]).expect("mark");
    assert_eq!(state.points()[mark].lines.len(), 3, "one mark, three lines");
    assert_eq!(
        state.points_near([0.5, y]).len(),
        1,
        "no second mark a rounding away"
    );
    // The diagonal added only its two edge crossings.
    assert_eq!(state.point_count(), before + 2);
    // And a fresh line through the mark sees it (O1 with an edge mark).
    assert!(state.lines_through([0.5, y]).len() == 3);
}

#[test]
fn x_plus_y_half_is_visible_from_every_point_on_it() {
    let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
    let m1 = Line::from_points([0.5, 0.0], [0.0, 0.5]).expect("l");
    let id = state.add_line(m1, LineTag::Cp).expect("add").id;
    for t in [0.0, 0.1, 0.25, 0.4, 0.5] {
        let p = [t, 0.5 - t];
        assert!(state.lines_through(p).contains(&id), "{p:?}");
    }
    // ±45° lines through the marks they create: kabuto's five "invisible"
    // lines all fold from the bare sheet or after the midlines.
    let cp = load("tests/fixtures/flat-folder/kabuto.fold");
    let analysis = analyze_cp(&cp);
    let (_, seq) = plan_component(&analysis.components[0], unbounded_options());
    assert_eq!(seq.status, Status::Complete);
    let diagonal_steps = seq
        .steps
        .iter()
        .filter(|s| (s.line.n[0].abs() - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-9)
        .count();
    assert!(diagonal_steps >= 5, "{diagonal_steps}");
}

fn witness_axioms(seq: &oristudio_precrease::Sequence) -> Vec<u8> {
    let mut present: Vec<u8> = seq
        .steps
        .iter()
        .flat_map(|s| s.witnesses.iter().map(|w| w.axiom))
        .collect();
    present.sort_unstable();
    present.dedup();
    present
}

#[test]
fn bird_base_closes_from_the_bare_sheet_with_no_auxiliary_fold() {
    let cp = load("crates/oristudio-cp/resources/default-molecules/bird_base.fold");
    let analysis = analyze_cp(&cp);
    let (_, seq) = plan_component(&analysis.components[0], unbounded_options());
    assert_eq!(seq.status, Status::Complete);
    assert_eq!(seq.totals.aux, 0);
    assert_eq!(seq.totals.cp_lines, 10);
    // O2, O3 and O5 — not the O5/O6/O7 the plan's evidence table records for
    // the prototype. With only the four edges and the two midlines folded,
    // each 67.5° corner line has exactly one lander (the centre onto an
    // edge), and O6 needs two distinct ones; nothing in the state is
    // perpendicular to those lines, so there is no O7 either.
    assert_eq!(witness_axioms(&seq), vec![2, 3, 5], "{:?}", seq.steps.len());
    let o5 = seq
        .steps
        .iter()
        .filter(|s| s.witnesses.iter().any(|w| w.axiom == 5))
        .count();
    assert_eq!(o5, 8, "the eight corner lines are O5");
}

/// Every axiom's certification path is exercised by some fixture's closure.
///
/// This used to pin one fixture — Oriedita's `solution_sample_1` — as
/// recording all of O1–O7, and it did, until the presentation preference
/// changed which auxiliary fold the stuck search takes there and O5 stopped
/// coming up on it. Which fixture carries which axiom is incidental; that the
/// set carries all of them is the guarantee.
#[test]
fn the_fixtures_between_them_exercise_every_axiom() {
    let mut seen: Vec<u8> = Vec::new();
    for file in [
        "tests/fixtures/precrease/grid6.fold",
        "tests/fixtures/precrease/iguana-c0.fold",
        "tests/fixtures/flat-folder/kabuto.fold",
        "tests/fixtures/oriedita/solution_sample_1.cp",
        "crates/oristudio-cp/resources/default-molecules/bird_base.fold",
        "crates/oristudio-cp/resources/default-molecules/frog_base.fold",
    ] {
        let cp = load(file);
        let analysis = analyze_cp(&cp);
        let (_, seq) = plan_component(&analysis.components[0], unbounded_options());
        seen.extend(witness_axioms(&seq));
    }
    seen.sort_unstable();
    seen.dedup();
    assert_eq!(seen, vec![1, 2, 3, 4, 5, 6, 7]);
}

#[test]
fn solution_sample_1_closure_exercises_o3_through_o7() {
    // A real design that completes with several axioms in play, and whose
    // presentation does not collapse to one of them.
    let cp = load("tests/fixtures/oriedita/solution_sample_1.cp");
    let analysis = analyze_cp(&cp);
    let (_, seq) = plan_component(&analysis.components[0], unbounded_options());
    assert_eq!(seq.status, Status::Complete);
    let recorded = witness_axioms(&seq);
    for axiom in [3, 4, 6, 7] {
        assert!(recorded.contains(&axiom), "{recorded:?}");
    }
    // And the presentation picks more than one axiom.
    let mut chosen: Vec<u8> = seq
        .steps
        .iter()
        // A press has no witness; it is a pinch, not a construction.
        .filter_map(|s| s.chosen.map(|c| s.witnesses[c].axiom))
        .collect();
    chosen.sort_unstable();
    chosen.dedup();
    assert!(chosen.len() >= 3, "{chosen:?}");
    println!(
        "solution_sample_1: {} steps, chosen axioms {chosen:?}",
        seq.steps.len()
    );
}

#[test]
fn kabuto_shuffles_keep_the_auxiliary_count() {
    let cp = load("tests/fixtures/flat-folder/kabuto.fold");
    let base = analyze_cp(&cp);
    let (_, seq0) = plan_component(&base.components[0], unbounded_options());
    let aux0 = seq0
        .steps
        .iter()
        .filter(|s| s.kind == StepKind::Aux)
        .count();
    let mut rng = Rng(0x1234_5678_9abc_def0);
    for trial in 0..20 {
        let variant = shuffled(&cp, &mut rng);
        let analysis = analyze_cp(&variant);
        let (_, seq) = plan_component(&analysis.components[0], unbounded_options());
        let aux = seq.steps.iter().filter(|s| s.kind == StepKind::Aux).count();
        assert_eq!(aux, aux0, "trial {trial}");
        assert_eq!(seq.status, Status::Complete, "trial {trial}");
        // The prototype's greedy handler gave 1, 2 or 3 here.
        assert!(aux <= 1, "trial {trial}: {aux}");
    }
}

#[test]
fn a_line_a_hair_apart_from_a_folded_one_is_a_distinct_target() {
    // Tolerance policy: parallel lines 5·TOL apart are distinct lines.
    let c = closure_of(&[v(0.5), v(0.5 + 5.0 * TOL)]);
    assert_eq!(c.folded().len() + c.remaining().len(), 2);
}
