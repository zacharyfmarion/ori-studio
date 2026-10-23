//! The outside reverse fold (plan Phase 11, research §5.2): it lands through
//! the same code as the inside one (`compound/reverse.rs`), placing each
//! block against its own body the other way round, and ending at the same
//! completion. Here on its own: Beloch's `outside-reverse.fold` (and its
//! inside twin) folded and matched frame for frame, the spike's case 2c — a
//! flap inside a larger stack, where Beloch's literal outside rule (T1 at the
//! bottom, T2 on top) wraps the layers that are not part of it — and the
//! spike's seeded campaign of outside folds.

mod beloch;
mod compound;
mod support;

use std::collections::BTreeSet;

use oristudio_fold::{
    CompoundRefused, Direction, FaceId, ReverseChoices, ReverseFold, ReverseKind, ReverseOutcome,
    Seed, Sheet, StartSide, State,
};
use oristudio_geometry::Line;
use support::*;

use compound::{check, landed};

const INSIDE: ReverseKind = ReverseKind::Inside;
const OUTSIDE: ReverseKind = ReverseKind::Outside;

fn none() -> ReverseChoices {
    ReverseChoices::default()
}

/// Beloch's kite folded in half, then reversed along the line through its
/// named points s and e (`outside-reverse.fold` and `inside-reverse.fold`,
/// frames 3 and 4): the state before the reverse is frame 3 through Import
/// CP with its own order; the engine's reverse of the kite's point, of the
/// file's kind, is frame 4 exactly.
#[test]
fn beloch_s_kite_point_reverses_outside_and_inside_as_its_frames_show() {
    for (name, kind, e) in [
        (
            "outside-reverse.fold",
            OUTSIDE,
            [0.375, 0.155_330_085_889_910_65],
        ),
        (
            "inside-reverse.fold",
            INSIDE,
            [0.25, 0.103_553_390_593_273_76],
        ),
    ] {
        let doc = beloch::document(name);
        let before = beloch::frame(&doc, Some(3)).unwrap_or_else(|e| panic!("{name}: {e}"));
        let after = beloch::frame(&doc, Some(4)).unwrap_or_else(|e| panic!("{name}: {e}"));
        let state = beloch::replay(&before)
            .unwrap_or_else(|e| panic!("{name}: {e}"))
            .state;
        // The frame's table is the state's model frame after Φ.
        let phi = beloch::matches(&state, &before).unwrap_or_else(|e| panic!("{name}: {e}"));
        let model = |p: Point| phi.inverse().apply(p);
        let line = through(model([0.25, 0.25]), model(e));
        // The point is the kite's corner a, at the table's origin.
        let tip = model([0.0, 0.0]);
        let op = ReverseFold {
            line,
            side: side(&line, tip),
            anchor: Seed::All,
            kind,
        };
        assert_eq!(
            state.reverse_kinds(&op, &none()).unwrap_or_default(),
            vec![kind],
            "{name}"
        );
        let folded = landed(&state, &op, &none());
        check(&state, &op, &folded);
        beloch::matches(&folded.state, &after).unwrap_or_else(|e| panic!("{name}: {e}"));
    }
}

/// The triangle folded in half again: two two-layer flaps stacked over the
/// corner b (spike case 2b).
fn four_layer_triangle() -> State {
    let square = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let triangle = fold(
        &square,
        &all(
            through([1.0, 0.0], [0.0, 1.0]),
            [0.0, 0.0],
            Direction::Valley,
        ),
    )
    .state;
    fold(
        &triangle,
        &all(
            through([0.0, 0.0], [1.0, 1.0]),
            [0.4, 0.9],
            Direction::Valley,
        ),
    )
    .state
}

/// Spike case 2c: one of the two stacked flaps reversed outside, the other
/// staying where it is. Beloch's literal rule — T1 at the very bottom, T2 on
/// top — wraps the other flap between them (a taco-tortilla the spike's
/// verifiers refuse); each block placed against its own body, with the
/// completion deciding the rest, lands, and leaves the other flap outside.
#[test]
fn an_outside_reverse_of_a_flap_in_a_stack_leaves_the_other_flap_unwrapped() {
    let tri4 = four_layer_triangle();
    let line =
        Line::from_point_direction([0.75, 0.25], [1.0, 1.0]).unwrap_or_else(|| unreachable!());
    let stack = tri4.stack_at([0.97, 0.06]).unwrap_or_default();
    assert_eq!(stack.len(), 4);
    let sheet = |f: FaceId| {
        tri4.isometry(f)
            .unwrap_or_default()
            .inverse()
            .apply([0.97, 0.06])
    };
    let anchors = [
        (
            "top",
            Seed::Depth {
                at: sheet(stack[0]),
                layers: 2,
            },
        ),
        (
            "bottom",
            Seed::Flaps {
                at: vec![sheet(stack[3])],
            },
        ),
    ];
    for (name, anchor) in anchors {
        let op = ReverseFold {
            line,
            side: side(&line, [0.95, 0.1]),
            anchor,
            kind: OUTSIDE,
        };
        let folded = landed(&tri4, &op, &none());
        check(&tri4, &op, &folded);
        let state = &folded.state;
        let [lower, upper] = [&folded.report.fold.blocks[0], &folded.report.fold.blocks[1]];
        let opening = &folded.report.openings[0];
        let bodies: BTreeSet<FaceId> = opening
            .lower_body
            .iter()
            .chain(&opening.upper_body)
            .copied()
            .collect();
        // The other flap: what stays, beside the opening's own bodies (and
        // their pieces the fold split off).
        let unrelated: Vec<FaceId> = state
            .faces()
            .iter()
            .filter(|f| !lower.contains(&f.id) && !upper.contains(&f.id))
            .filter(|f| !bodies.contains(&f.parent.unwrap_or(f.id)) && !bodies.contains(&f.id))
            .map(|f| f.id)
            .collect();
        assert!(!unrelated.is_empty(), "{name}");
        for &o in &unrelated {
            for &a in lower {
                for &b in upper {
                    let wrapped =
                        state.above(o, a) == Some(true) && state.above(b, o) == Some(true);
                    assert!(!wrapped, "{name}: {o} lies between {a} and {b}");
                }
            }
        }
        // Each block around its own body: T1 under B1, T2 over B2.
        for (block, body, above) in [
            (lower, &opening.lower_body, false),
            (upper, &opening.upper_body, true),
        ] {
            for &a in block.iter() {
                for face in state.faces() {
                    let parent = face.parent.unwrap_or(face.id);
                    if (body.contains(&face.id) || body.contains(&parent))
                        && !lower.contains(&face.id)
                        && !upper.contains(&face.id)
                        && let Some(is_above) = state.above(a, face.id)
                    {
                        assert_eq!(is_above, above, "{name}: {a} against its body {}", face.id);
                    }
                }
            }
        }
    }
}

// --- The campaign ----------------------------------------------------------------

#[derive(Debug, Default)]
struct Tally {
    ops: usize,
    folds: usize,
    unique: usize,
    ambiguous: usize,
    no_order: usize,
    other_refusals: usize,
    letters: [usize; 3],
}

/// The spike's reverse campaign folded outside: every admissible opening
/// (four at most) of the first flap, every order a choice offers. Every
/// landed state passes the full gate and the letter rules (a new crease at
/// the spine takes the letter the body's spine does not), starts and ends
/// its motion exactly, and replays from what it stores.
fn campaign(seeds: std::ops::RangeInclusive<u64>, setups: u64) -> Tally {
    let mut tally = Tally::default();
    for seed in seeds {
        for i in 0..setups {
            let Some((state, op)) = compound::reverse_case(seed, i) else {
                continue;
            };
            let op = ReverseFold {
                kind: OUTSIDE,
                ..op
            };
            tally.ops += 1;
            let analysis = state.analyse_reverse(&op).unwrap_or_else(|e| panic!("{e}"));
            if analysis.flaps.iter().skip(1).any(|f| f.openings.len() > 1) {
                continue;
            }
            for k in 0..analysis.flaps[0].openings.len().min(4) {
                let Some(choices) = compound::first_flap_opened(&analysis, k) else {
                    continue;
                };
                tally.folds += 1;
                let mut folds = Vec::new();
                match state.reverse_fold(&op, &choices) {
                    Ok(ReverseOutcome::Landed(folded)) => {
                        tally.unique += 1;
                        folds.push(*folded);
                    }
                    Ok(ReverseOutcome::ChooseOrder(choice)) => {
                        tally.ambiguous += 1;
                        let sizes: Vec<usize> = choice
                            .completions()
                            .components()
                            .iter()
                            .map(|c| c.orders.len())
                            .collect();
                        for pick in compound::picks(&sizes) {
                            folds.push(
                                choice
                                    .pick(&pick)
                                    .unwrap_or_else(|e| panic!("s{seed}-{i}: {e}")),
                            );
                        }
                    }
                    Ok(ReverseOutcome::ChooseOpening(_)) => panic!("s{seed}-{i}: asks again"),
                    Err(CompoundRefused::Refused(refused)) => match refused.refusal.code() {
                        "reverse_kind_infeasible" | "reverse_tip_not_free" => tally.no_order += 1,
                        "sliver" | "short_crease" | "thin_piece" => tally.other_refusals += 1,
                        code => panic!("s{seed}-{i}: refused as {code}: {refused}"),
                    },
                    Err(CompoundRefused::Broken(broken)) => panic!("s{seed}-{i}: {broken}"),
                }
                for folded in &folds {
                    for (t, l) in tally.letters.iter_mut().zip(check(&state, &op, folded)) {
                        *t += l;
                    }
                    let again = landed(&state, &op, &folded.report.stored);
                    assert_eq!(again.state.parts(), folded.state.parts(), "s{seed}-{i}");
                }
            }
        }
    }
    tally
}

#[test]
fn the_seeded_campaign_lands_valid_outside_reverse_folds() {
    let tally = campaign(1..=1, 160);
    eprintln!("{tally:?}");
    assert!(tally.ops >= 150 && tally.unique >= 80, "{tally:?}");
    assert!(tally.no_order >= 50, "{tally:?}");
    assert!(tally.letters.iter().all(|&n| n >= 50), "{tally:?}");
    let feasible = tally.unique + tally.ambiguous;
    assert!(
        tally.unique as f64 >= 0.9 * feasible as f64,
        "{} unique of {feasible}",
        tally.unique
    );
}

/// The spike's campaign at its size: seeds 1–3, 1,500 states each. The spike
/// found the outside fold unique by these seeds and completion in 99.3% of
/// the cases where one landed (2,978 of 2,998).
///
/// `cargo test -p oristudio-fold --release --test reverse_outside -- --ignored --nocapture`
#[test]
#[ignore = "the spike's full campaign; run with --release --ignored"]
fn the_spikes_campaign() {
    let start = std::time::Instant::now();
    let tally = campaign(1..=3, 1500);
    let feasible = tally.unique + tally.ambiguous;
    eprintln!(
        "{tally:?}\nunique {} of {feasible} feasible ({:.2}%), in {:.1} s",
        tally.unique,
        100.0 * tally.unique as f64 / feasible as f64,
        start.elapsed().as_secs_f64()
    );
}
