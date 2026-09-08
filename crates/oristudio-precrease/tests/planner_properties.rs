//! Property tests from the plan's testing strategy: completeness (a random
//! axiom application is found by the inverse), soundness (every witness
//! forward-verifies), permutation and duplicate invariance of the fixpoint
//! set and the auxiliary count, and the pinch pass invariants.

mod common;

use common::*;
use oristudio_precrease::clock::{Deadline, frozen_clock};
use oristudio_precrease::closure::{Closure, Target};
use oristudio_precrease::construct::Construction;
use oristudio_precrease::pinch::{Extent, pinch_pass};
use oristudio_precrease::predicates::{Ref, Witness, all_witnesses};
use oristudio_precrease::sequence::StepKind;
use oristudio_precrease::state::{DEFAULT_POINT_CAP, LineTag, State};
use oristudio_precrease::{Line, Sheet, TOL};

/// A random axiom application over the state, as a construction.
fn random_construction(state: &State, rng: &mut Rng) -> Option<Construction> {
    let points: Vec<[f64; 2]> = state.points().iter().map(|p| p.p).collect();
    let lines: Vec<Line> = state.lines().iter().map(|l| l.line).collect();
    let pick_p = |rng: &mut Rng| points[rng.below(points.len())];
    let pick_l = |rng: &mut Rng| lines[rng.below(lines.len())];
    Some(match rng.below(7) {
        0 => Construction::O1 {
            p: pick_p(rng),
            q: pick_p(rng),
        },
        1 => Construction::O2 {
            p: pick_p(rng),
            q: pick_p(rng),
        },
        2 => Construction::O3 {
            m1: pick_l(rng),
            m2: pick_l(rng),
        },
        3 => Construction::O4 {
            p: pick_p(rng),
            m: pick_l(rng),
        },
        4 => Construction::O5 {
            pivot: pick_p(rng),
            p: pick_p(rng),
            m1: pick_l(rng),
        },
        5 => Construction::O6 {
            p1: pick_p(rng),
            m1: pick_l(rng),
            p2: pick_p(rng),
            m2: pick_l(rng),
        },
        _ => Construction::O7 {
            p: pick_p(rng),
            m1: pick_l(rng),
            m2: pick_l(rng),
        },
    })
}

/// Rebuild the construction a witness names, from the state.
fn construction_of(state: &State, w: &Witness) -> Construction {
    let p = |r: &Ref| state.point(r.id());
    let l = |r: &Ref| *state.line(r.id());
    let i = &w.inputs;
    match w.axiom {
        1 => Construction::O1 {
            p: p(&i[0]),
            q: p(&i[1]),
        },
        2 => Construction::O2 {
            p: p(&i[0]),
            q: p(&i[1]),
        },
        3 => Construction::O3 {
            m1: l(&i[0]),
            m2: l(&i[1]),
        },
        4 => Construction::O4 {
            p: p(&i[0]),
            m: l(&i[1]),
        },
        5 => Construction::O5 {
            pivot: p(&i[0]),
            p: p(&i[1]),
            m1: l(&i[2]),
        },
        6 => Construction::O6 {
            p1: p(&i[0]),
            m1: l(&i[1]),
            p2: p(&i[2]),
            m2: l(&i[3]),
        },
        _ => Construction::O7 {
            p: p(&i[0]),
            m1: l(&i[1]),
            m2: l(&i[2]),
        },
    }
}

#[test]
fn completeness_a_random_axiom_application_is_found_by_the_inverse() {
    let sheet = Sheet::unit_square();
    let mut rng = Rng(0x5eed_1234_abcd_0001);
    let mut checked = 0;
    let mut by_axiom = [0usize; 8];
    // Two thirds of the draws are discarded (a degenerate construction, or
    // one whose line is already folded), so the loop count is well above the
    // number of cases the assertion below wants.
    for _ in 0..700 {
        let mut state = State::new(sheet, DEFAULT_POINT_CAP);
        // Grow a random state by up to three constructible folds.
        let folds = rng.below(4);
        let mut added = 0;
        let mut attempts = 0;
        while added < folds && attempts < 40 {
            attempts += 1;
            let Some(c) = random_construction(&state, &mut rng) else {
                continue;
            };
            let roots = c.lines(&sheet);
            if roots.is_empty() {
                continue;
            }
            let root = roots[rng.below(roots.len())];
            if state
                .add_line(root.line, LineTag::Aux)
                .expect("add")
                .inserted
            {
                added += 1;
            }
        }
        // One more application: the target.
        let Some(c) = random_construction(&state, &mut rng) else {
            continue;
        };
        let roots = c.lines(&sheet);
        if roots.is_empty() {
            continue;
        }
        let target = roots[rng.below(roots.len())].line;
        if state.has_line(&target) {
            continue;
        }
        let ws = all_witnesses(&state, &target);
        assert!(
            !ws.is_empty(),
            "inverse missed {c:?} → {target:?} in a state of {} lines / {} points",
            state.line_count(),
            state.point_count()
        );
        // The axiom used is among the witnesses (a stronger statement than
        // existence, and what the plan's table promises).
        assert!(
            ws.iter().any(|w| w.axiom == c.axiom()),
            "axiom O{} not among {:?} for {c:?}",
            c.axiom(),
            ws.iter().map(|w| w.axiom).collect::<Vec<_>>()
        );
        by_axiom[c.axiom() as usize] += 1;
        checked += 1;
    }
    assert!(checked > 200, "only {checked} cases");
    for a in 1..=7 {
        assert!(by_axiom[a] > 0, "axiom O{a} never exercised: {by_axiom:?}");
    }
}

#[test]
fn soundness_every_witness_forward_verifies() {
    let sheet = Sheet::unit_square();
    let mut rng = Rng(0x5eed_5678_abcd_0002);
    let mut witnesses_checked = 0;
    for _ in 0..200 {
        let mut state = State::new(sheet, DEFAULT_POINT_CAP);
        for _ in 0..rng.below(4) {
            if let Some(c) = random_construction(&state, &mut rng) {
                let roots = c.lines(&sheet);
                if let Some(root) = roots.first() {
                    let _ = state.add_line(root.line, LineTag::Aux);
                }
            }
        }
        // Targets: random constructions and random arbitrary lines.
        let target = if rng.below(2) == 0 {
            match random_construction(&state, &mut rng).map(|c| c.lines(&sheet)) {
                Some(roots) if !roots.is_empty() => roots[0].line,
                _ => continue,
            }
        } else {
            let a = [rng.unit(), rng.unit()];
            let b = [rng.unit(), rng.unit()];
            match Line::from_points(a, b) {
                Some(l) => l,
                None => continue,
            }
        };
        for w in all_witnesses(&state, &target) {
            let c = construction_of(&state, &w);
            let cert = c.certify(&sheet, &target);
            assert!(cert.is_some(), "witness {w:?} does not certify {target:?}");
            assert!(cert.expect("cert").err <= TOL);
            // The construction's inputs are what the witness says.
            assert_eq!(c.axiom(), w.axiom);
            witnesses_checked += 1;
        }
    }
    assert!(
        witnesses_checked > 100,
        "only {witnesses_checked} witnesses"
    );
}

fn closure_fixpoint(cp: &oristudio_precrease::fixture_io::LoadedCp) -> (Vec<Line>, Vec<Line>) {
    let analysis = analyze_cp(cp);
    let c = &analysis.components[0];
    let sheet = Sheet::from_frame(c.frame.as_ref().expect("frame"));
    let targets: Vec<Target> = c
        .merged_lines
        .iter()
        .map(|ml| {
            Target::new(
                ml.line,
                ml.segment_indices.iter().map(|&i| i + 1).collect(),
                Vec::new(),
                ml.mountain_length,
                ml.valley_length,
            )
        })
        .collect();
    let mut closure = Closure::new(sheet, targets, DEFAULT_POINT_CAP);
    closure
        .close(&Deadline::unbounded(frozen_clock()))
        .expect("close");
    let folded: Vec<Line> = closure.folded().iter().map(|f| f.line).collect();
    let remaining: Vec<Line> = closure
        .remaining_lines()
        .into_iter()
        .map(|(_, l)| l)
        .collect();
    (folded, remaining)
}

#[test]
fn fixpoint_set_and_aux_count_are_invariant_under_permutation_and_duplicates() {
    let mut rng = Rng(0x5eed_9abc_def0_0003);
    for file in [
        "tests/fixtures/precrease/grid6.fold",
        "tests/fixtures/flat-folder/kabuto.fold",
        "tests/fixtures/oriedita/solution_sample_1.cp",
        "crates/oristudio-cp/resources/default-molecules/bird_base.fold",
    ] {
        let cp = load(file);
        let (folded0, remaining0) = closure_fixpoint(&cp);
        let analysis0 = analyze_cp(&cp);
        let (_, seq0) = plan_component(&analysis0.components[0], unbounded_options());
        let aux0 = seq0
            .steps
            .iter()
            .filter(|s| s.kind == StepKind::Aux)
            .count();
        for trial in 0..6 {
            let variant = if trial % 2 == 0 {
                shuffled(&cp, &mut rng)
            } else {
                shuffled(&with_duplicates_and_splits(&cp, 3, 4), &mut rng)
            };
            let (folded, remaining) = closure_fixpoint(&variant);
            assert!(
                same_line_set(&folded0, &folded),
                "{file} trial {trial}: fixpoint set differs ({} vs {})",
                folded0.len(),
                folded.len()
            );
            assert!(
                same_line_set(&remaining0, &remaining),
                "{file} trial {trial}"
            );
            let analysis = analyze_cp(&variant);
            let (_, seq) = plan_component(&analysis.components[0], unbounded_options());
            let aux = seq.steps.iter().filter(|s| s.kind == StepKind::Aux).count();
            assert_eq!(aux, aux0, "{file} trial {trial}: auxiliary count changed");
            assert_eq!(seq.status, seq0.status, "{file} trial {trial}");
        }
    }
}

#[test]
fn pinch_pass_keeps_fold_count_and_confines_point_uses_to_spans() {
    for file in [
        "tests/fixtures/precrease/grid6.fold",
        "tests/fixtures/flat-folder/kabuto.fold",
        "tests/fixtures/precrease/g3d_x19.fold",
        "tests/fixtures/precrease/x13_x38.fold",
        "crates/oristudio-cp/resources/default-molecules/frog_base.fold",
    ] {
        let cp = load(file);
        let analysis = analyze_cp(&cp);
        let (planner, seq) = plan_component(&analysis.components[0], unbounded_options());
        let closure = planner.closure_ref().expect("closure");
        let state = closure.state();
        // Fold count: the pass reports one verdict per fold and changes nothing.
        let order: Vec<usize> = (0..closure.folded().len()).collect();
        let verdicts = pinch_pass(closure, &order);
        assert_eq!(verdicts.len(), closure.folded().len(), "{file}");
        assert_eq!(seq.steps.len(), closure.folded().len(), "{file}");
        // Every pinched step: later steps use it only through points inside
        // its spans.
        for (k, step) in seq.steps.iter().enumerate() {
            let Extent::Pinches { spans } = &step.extent else {
                continue;
            };
            assert_eq!(step.kind, StepKind::Aux, "{file}: CP line pinched");
            assert!(!step.visible);
            for later in &seq.steps[k + 1..] {
                let Some(w) = later.chosen.map(|c| &later.witnesses[c]) else {
                    continue;
                };
                for r in &w.inputs {
                    assert!(
                        !(r.is_line() && r.id() == step.line_id),
                        "{file}: pinched step {} used as a line by step {}",
                        step.id,
                        later.id
                    );
                    if r.is_point() {
                        let sp = &state.points()[r.id()];
                        if sp.lines.contains(&step.line_id) {
                            let inside = spans.iter().any(|[a, b]| {
                                let t = step.line.parameter(sp.p);
                                let ta = step.line.parameter(*a);
                                let tb = step.line.parameter(*b);
                                t >= ta.min(tb) - 1e-9 && t <= ta.max(tb) + 1e-9
                            });
                            assert!(
                                inside,
                                "{file}: point use of step {} by step {} outside its spans",
                                step.id, later.id
                            );
                        }
                    }
                }
            }
        }
        // The visible count is exactly the number of full-length aux steps.
        let visible = seq
            .steps
            .iter()
            .filter(|s| s.kind == StepKind::Aux && s.extent == Extent::Full)
            .count() as u32;
        assert_eq!(seq.totals.visible_aux, visible, "{file}");
    }
}
