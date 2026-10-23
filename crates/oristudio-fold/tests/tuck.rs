//! The tuck through the compound pipeline (plan Phase 11; research §4.4,
//! §5.2), on the reverse spike's named tucks (`cases.mjs` §4) and its seeded
//! campaign (`campaign-tuck.mjs`): Beloch's bounded closure, the strict
//! reading of "immediately under T", the targets listed with whether each
//! takes the tuck, stored choices and refusals with their fixes. Valley tucks
//! go under their target and mountain tucks over it, both in the campaign,
//! and every tuck that lands passes the full gate from scratch.

mod compound;
mod support;

use std::collections::BTreeSet;

use oristudio_fold::{
    CompletionLimits, CompoundRefused, Direction, FaceId, Fix, FoldRefusal, PlainFold, Seed, Sheet,
    StartSide, State, TuckChoices, TuckFold, TuckFolded, TuckOutcome, TuckSide,
};
use oristudio_geometry::Line;
use support::*;

fn square() -> State {
    State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"))
}

/// The book fold: the right half valley-folded over the left (`cases.mjs`
/// §4's `book`).
fn book() -> State {
    fold(&square(), &all(x_eq(0.5), [0.75, 0.5], Direction::Valley)).state
}

/// The corner line through (0, 0.3) and (0.3, 0).
fn corner() -> Line {
    through([0.0, 0.3], [0.3, 0.0])
}

fn tuck(line: Line, toward: Point, direction: Direction, seed: Seed, target: Point) -> TuckFold {
    TuckFold {
        line,
        side: side(&line, toward),
        direction,
        seed,
        target,
        additional_targets: Vec::new(),
    }
}

fn none() -> TuckChoices {
    TuckChoices::default()
}

/// Every check on a landed tuck: the full gate from scratch, the motion's
/// endpoints, the block immediately against T where they meet, and replay
/// from what the step stores.
fn check(parent: &State, op: &TuckFold, folded: &TuckFolded) {
    let landed = &folded.state;
    assert_valid(landed);
    compound::assert_motion(parent, landed, &folded.report.motion);
    let target = folded.report.target;
    assert_eq!(parent.face_at(op.target), Some(target));
    let block: BTreeSet<FaceId> = folded
        .report
        .fold
        .blocks
        .iter()
        .flatten()
        .copied()
        .collect();
    let under = folded.report.placement == TuckSide::Under;
    for &f in &block {
        if let Some(above) = landed.above(f, target) {
            assert_eq!(above, !under, "block face {f} on the wrong side of T");
        }
    }
    // The target stays where it was (re-derived from the root, so to the
    // tolerance rather than the bit).
    let (Some(now), Some(before)) = (landed.isometry(target), parent.isometry(target)) else {
        panic!("T {target} is gone");
    };
    assert!(
        now.0
            .iter()
            .zip(&before.0)
            .all(|(a, b)| (a - b).abs() < 1e-9)
    );
    let again = match parent.tuck_fold(op, &folded.report.stored) {
        Ok(TuckOutcome::Landed(again)) => again,
        other => panic!("replay: {:?}", other.err()),
    };
    assert_eq!(again.state.parts(), landed.parts());
}

fn landed(state: &State, op: &TuckFold) -> TuckFolded {
    match state.tuck_fold(op, &none()) {
        Ok(TuckOutcome::Landed(folded)) => {
            check(state, op, &folded);
            *folded
        }
        Ok(TuckOutcome::ChooseOrder(c)) => panic!("{op:?}: choose an order of {:?}", c.count()),
        Err(e) => panic!("{op:?}: {e} {e:?}"),
    }
}

fn refusal(state: &State, op: &TuckFold) -> oristudio_fold::Refused {
    match state.tuck_fold(op, &none()) {
        Err(CompoundRefused::Refused(refused)) => refused,
        Err(CompoundRefused::Broken(broken)) => panic!("{op:?}: broken {broken}"),
        Ok(_) => panic!("{op:?} landed"),
    }
}

/// Whether the analysis lists the face at `at` as a target that takes the
/// tuck.
fn listed(state: &State, op: &TuckFold) -> Option<bool> {
    let analysis = state
        .analyse_tuck(op, &CompletionLimits::default())
        .unwrap_or_else(|e| panic!("{e}"));
    let face = state.face_at(op.target)?;
    analysis
        .targets
        .iter()
        .find(|t| t.face == face)
        .and_then(|t| t.feasible)
}

// --- The spike's named tucks ---------------------------------------------------

/// Spike case 4a: the bottom layer's corner valley-folded up and tucked under
/// the top layer, which it would otherwise sweep along.
#[test]
fn the_bottom_corner_tucks_under_the_top_layer() {
    let book = book();
    let op = tuck(
        corner(),
        [0.02, 0.02],
        Direction::Valley,
        Seed::Flaps {
            at: vec![[0.05, 0.05]],
        },
        [0.75, 0.5],
    );
    let folded = landed(&book, &op);
    assert_eq!(folded.report.placement, TuckSide::Under);
    assert_eq!(folded.report.fold.moving, vec![face(&book, [0.25, 0.5])]);
    assert_eq!(listed(&book, &op), Some(true));
    // Without the tuck the closure takes the top layer's corner too.
    let plain = fold(
        &book,
        &PlainFold::new(op.line, op.side, Direction::Valley).with_seed(op.seed.clone()),
    );
    assert_eq!(plain.report.analysis.moving.len(), 2);
}

/// Spike case 4b: the top layer's corner mountain-folded into the pocket,
/// over the bottom layer.
#[test]
fn the_top_corner_tucks_over_the_bottom_layer() {
    let book = book();
    let op = tuck(
        corner(),
        [0.02, 0.02],
        Direction::Mountain,
        Seed::Flaps {
            at: vec![[0.95, 0.05]],
        },
        [0.25, 0.5],
    );
    let folded = landed(&book, &op);
    assert_eq!(folded.report.placement, TuckSide::Over);
    assert_eq!(folded.report.fold.moving, vec![face(&book, [0.75, 0.5])]);
    assert_eq!(listed(&book, &op), Some(true));
}

/// The top band folded down over the sheet: flap A, its raw edge at
/// y = 0.6 (`cases.mjs` §4c).
fn pocket() -> State {
    fold(&square(), &all(y_eq(0.8), [0.5, 0.9], Direction::Valley)).state
}

/// Spike case 4c: the bottom band valley-folded up along y = 0.35 and tucked
/// under A. Its crease pattern and letters allow two states (under A and on
/// top of it); the strict placement picks the one between the sheet and A.
#[test]
fn a_band_tucks_into_the_pocket_and_one_too_deep_does_not() {
    let pocket = pocket();
    let a = face(&pocket, [0.5, 0.9]);
    let sheet = face(&pocket, [0.5, 0.2]);
    let op = tuck(
        y_eq(0.35),
        [0.5, 0.1],
        Direction::Valley,
        Seed::All,
        [0.5, 0.9],
    );
    let folded = landed(&pocket, &op);
    let band = folded.report.fold.blocks[0].clone();
    assert!(!band.is_empty());
    let state = &folded.state;
    for &f in &band {
        assert_eq!(state.above(f, a), Some(false), "the band under A");
    }
    // Above the sheet's piece that stays, where the band lands on it.
    let stays: Vec<FaceId> = state
        .faces()
        .iter()
        .filter(|f| f.parent == Some(sheet) && !band.contains(&f.id))
        .map(|f| f.id)
        .collect();
    assert!(
        stays
            .iter()
            .any(|&s| band.iter().any(|&f| state.above(f, s) == Some(true)))
    );
    assert_eq!(listed(&pocket, &op), Some(true));

    // Case 4c3: folded at y = 0.45 the band reaches past A's hinge at 0.8,
    // inside the pocket.
    let deep = tuck(
        y_eq(0.45),
        [0.5, 0.1],
        Direction::Valley,
        Seed::All,
        [0.5, 0.9],
    );
    let refused = refusal(&pocket, &deep);
    let FoldRefusal::TuckInfeasible {
        target,
        placement,
        faces,
    } = &refused.refusal
    else {
        panic!("{refused:?}");
    };
    assert_eq!((*target, *placement), (a, TuckSide::Under));
    assert!(!faces.is_empty());
    assert!(refused.refusal.faces().contains(&a));
    assert_eq!(listed(&pocket, &deep), Some(false));
}

/// Spike case 4d: the top layer's upper half folded down over the corner
/// (T); the bottom layer's corner tucked under T brings the loose top-layer
/// corner between them along (Beloch's ADR 0052), which a closure by hinges
/// alone would leave inside the taco.
#[test]
fn a_loose_layer_between_the_flap_and_its_target_comes_along() {
    let book = book();
    let folded_down = fold(
        &book,
        &all(y_eq(0.4), [0.25, 0.7], Direction::Valley).with_seed(Seed::Depth {
            at: [0.75, 0.7],
            layers: 1,
        }),
    );
    let state = folded_down.state;
    let t = folded_down.report.moving_faces[0];
    let at = state.face_witness(t).unwrap_or_default();
    let op = tuck(
        corner(),
        [0.02, 0.02],
        Direction::Valley,
        Seed::Flaps {
            at: vec![[0.05, 0.05]],
        },
        at,
    );
    let folded = landed(&state, &op);
    let loose = face(&state, [0.95, 0.05]);
    assert!(
        folded.report.fold.moving.contains(&loose),
        "{:?}",
        folded.report.fold.moving
    );
    assert_eq!(folded.report.fold.moving.len(), 2);
}

/// A target the closure would take, or that is in the seed, is no target.
#[test]
fn a_target_that_would_move_is_refused() {
    let book = book();
    let op = tuck(
        corner(),
        [0.02, 0.02],
        Direction::Valley,
        Seed::Flaps {
            at: vec![[0.05, 0.05]],
        },
        [0.25, 0.5],
    );
    let refused = refusal(&book, &op);
    assert_eq!(refused.refusal.code(), "tuck_target_moves");
    // A target point off the paper names no face.
    let off = TuckFold {
        target: [1.5, 0.5],
        ..op
    };
    assert_eq!(refusal(&book, &off).refusal.code(), "witness_not_in_face");
}

/// A target the block lands nowhere on takes no tuck: no placement names it,
/// so a completion would land the plain fold and call it a tuck under T. It
/// is refused as a target no order fits, naming no conflict, and the listing
/// never offers it. The corner of a square folded up along x + y = 0.3, and
/// the far corner folded down along x + y = 1.7: that block lands on the
/// sheet's middle, never on the small corner flap.
#[test]
fn a_target_the_block_never_reaches_is_refused() {
    let corner = fold(&square(), &all(corner(), [0.02, 0.02], Direction::Valley)).state;
    let flap = face(&corner, [0.05, 0.05]);
    for direction in [Direction::Valley, Direction::Mountain] {
        let op = tuck(
            through([1.0, 0.7], [0.7, 1.0]),
            [0.98, 0.98],
            direction,
            Seed::Flaps {
                at: vec![[0.95, 0.95]],
            },
            [0.05, 0.05],
        );
        let analysis = corner
            .analyse_tuck(&op, &CompletionLimits::default())
            .unwrap_or_else(|e| panic!("{e}"));
        assert!(
            analysis.targets.iter().all(|t| t.face != flap),
            "{direction:?}: {:?}",
            analysis.targets
        );
        let refused = refusal(&corner, &op);
        assert_eq!(
            refused.refusal,
            FoldRefusal::TuckInfeasible {
                target: flap,
                placement: match direction {
                    Direction::Valley => TuckSide::Under,
                    Direction::Mountain => TuckSide::Over,
                },
                faces: Vec::new(),
            },
            "{direction:?}"
        );
        // Each fix is a listed target that lands.
        for fix in &refused.fixes {
            let Fix::TuckTarget { face, at } = fix else {
                panic!("{direction:?}: {fix:?}");
            };
            assert!(analysis.targets.iter().any(|t| t.face == *face));
            let other = TuckFold {
                target: *at,
                ..op.clone()
            };
            assert!(corner.tuck_fold(&other, &none()).is_ok(), "{direction:?}");
        }
        // What moves and its picture are refused alike.
        assert_eq!(
            corner
                .analyse_tuck_fold(&op)
                .map(|_| ())
                .map_err(|r| r.refusal.code()),
            Err("tuck_infeasible"),
            "{direction:?}"
        );
        assert!(corner.tuck_action(&op).is_err(), "{direction:?}");
    }
}

/// The square folded in half `folds` times, alternately across and down, each
/// time a valley: a stack of 2^folds layers in its corner.
fn stack(folds: usize) -> State {
    let lines = [
        (y_eq(0.5), [0.5, 0.75]),
        (x_eq(0.5), [0.75, 0.25]),
        (y_eq(0.25), [0.25, 0.4]),
        (x_eq(0.25), [0.4, 0.1]),
        (y_eq(0.125), [0.1, 0.2]),
        (x_eq(0.125), [0.2, 0.05]),
    ];
    lines
        .iter()
        .take(folds)
        .fold(square(), |state, &(line, toward)| {
            fold(&state, &all(line, toward, Direction::Valley)).state
        })
}

/// A tuck's listing reads its deadline before each target: one asked after
/// it decides none of them, where every target would otherwise be a
/// completion (seconds on a deep stack). The stack's bottom layer, its corner
/// folded up: every layer above is a target.
#[test]
fn the_targets_left_when_the_deadline_passes_are_undecided() {
    fn epoch() -> f64 {
        0.0
    }
    let state = stack(5);
    let line = through([0.0, 0.03], [0.03, 0.0]);
    let at = state.stack_at([0.01, 0.01]).unwrap_or_default();
    let bottom = *at.last().unwrap_or_else(|| panic!("no stack"));
    let seed = state
        .isometry(bottom)
        .unwrap_or_default()
        .inverse()
        .apply([0.01, 0.01]);
    for direction in [Direction::Valley, Direction::Mountain] {
        let op = tuck(
            line,
            [0.005, 0.005],
            direction,
            Seed::Flaps { at: vec![seed] },
            [0.5, 0.5],
        );
        let decided = state
            .analyse_tuck(&op, &CompletionLimits::default())
            .unwrap_or_else(|e| panic!("{e}"));
        assert!(decided.targets.len() >= 8, "{direction:?}: {decided:?}");
        assert!(decided.targets.iter().all(|t| t.feasible.is_some()));
        let late = CompletionLimits {
            deadline: Some(oristudio_fold::complete::Deadline {
                now_ms: epoch,
                at_ms: 0.0,
            }),
            ..CompletionLimits::default()
        };
        let undecided = state
            .analyse_tuck(&op, &late)
            .unwrap_or_else(|e| panic!("{e}"));
        // The same layers, none of them decided.
        let faces = |a: &oristudio_fold::TuckAnalysis| -> Vec<(FaceId, Point)> {
            a.targets.iter().map(|t| (t.face, t.at)).collect()
        };
        assert_eq!(faces(&undecided), faces(&decided), "{direction:?}");
        assert!(
            undecided.targets.iter().all(|t| t.feasible.is_none()),
            "{direction:?}: {:?}",
            undecided.targets
        );
        assert_eq!(undecided.moving, decided.moving);
    }
}

/// Plan D6: a tuck the completion leaves open stores the pairs it chose,
/// keyed by witnesses. The first such tuck of the campaign: each pick lands
/// a different state, each replays from what it stores, and a witness off
/// the paper breaks the step.
#[test]
fn a_tuck_with_two_orders_stores_its_choice() {
    let (state, op, choice) = (0..200)
        .find_map(|i| {
            let (state, op) = tuck_case(1, i)?;
            match state.tuck_fold(&op, &none()) {
                Ok(TuckOutcome::ChooseOrder(choice)) => Some((state, op, choice)),
                _ => None,
            }
        })
        .unwrap_or_else(|| panic!("no tuck of seed 1 leaves a choice"));
    assert!(choice.count().orders >= 2);
    let sizes: Vec<usize> = choice
        .completions()
        .components()
        .iter()
        .map(|c| c.orders.len())
        .collect();
    let picks: Vec<TuckFolded> = compound::picks(&sizes)
        .iter()
        .map(|pick| choice.pick(pick).unwrap_or_else(|e| panic!("{e}")))
        .collect();
    for folded in &picks {
        check(&state, &op, folded);
    }
    assert_ne!(picks[0].state.order(), picks[1].state.order());
    let Some(mut stored) = picks[0].report.stored.order.clone() else {
        panic!("no stored order");
    };
    stored.faces[0] = [5.0, 5.0];
    assert!(matches!(
        state.tuck_fold(
            &op,
            &TuckChoices {
                order: Some(stored)
            }
        ),
        Err(CompoundRefused::Broken(_))
    ));
}

// --- The campaign ----------------------------------------------------------------

/// Draw `i` of seed `seed` of the spike's campaign
/// ([`compound::tuck_case`]): T among the layers wholly on the side that
/// stays which a landed plain fold's block lies on; a valley is tucked under
/// T, a mountain over it.
fn tuck_case(seed: u64, i: u64) -> Option<(State, TuckFold)> {
    compound::tuck_case(seed, i)
}

#[derive(Debug, Default)]
struct Tally {
    tucks: usize,
    under: usize,
    over: usize,
    unique: usize,
    ambiguous: usize,
    infeasible: usize,
    fixes_offered: usize,
    other_refusals: usize,
    listed_agree: usize,
}

fn campaign(seeds: std::ops::RangeInclusive<u64>, setups: u64, list_every: u64) -> Tally {
    let mut tally = Tally::default();
    for seed in seeds {
        for i in 0..setups {
            let Some((state, op)) = tuck_case(seed, i) else {
                continue;
            };
            tally.tucks += 1;
            match state.view().model_direction(op.direction) {
                Direction::Valley => tally.under += 1,
                Direction::Mountain => tally.over += 1,
            }
            let feasible = match state.tuck_fold(&op, &none()) {
                Ok(TuckOutcome::Landed(folded)) => {
                    tally.unique += 1;
                    check(&state, &op, &folded);
                    true
                }
                Ok(TuckOutcome::ChooseOrder(choice)) => {
                    tally.ambiguous += 1;
                    let sizes: Vec<usize> = choice
                        .completions()
                        .components()
                        .iter()
                        .map(|c| c.orders.len())
                        .collect();
                    for pick in compound::picks(&sizes) {
                        let folded = choice
                            .pick(&pick)
                            .unwrap_or_else(|e| panic!("s{seed}-{i}: {e}"));
                        check(&state, &op, &folded);
                    }
                    true
                }
                Err(CompoundRefused::Refused(refused)) => match refused.refusal.code() {
                    "tuck_infeasible" => {
                        tally.infeasible += 1;
                        tally.fixes_offered += usize::from(!refused.fixes.is_empty());
                        for fix in &refused.fixes {
                            let Fix::TuckTarget { at, .. } = fix else {
                                panic!("s{seed}-{i}: {fix:?}");
                            };
                            let other = TuckFold {
                                target: *at,
                                ..op.clone()
                            };
                            assert!(
                                state.tuck_fold(&other, &none()).is_ok(),
                                "s{seed}-{i}: the fix does not land"
                            );
                        }
                        false
                    }
                    "sliver" | "short_crease" | "thin_piece" | "tuck_target_moves" => {
                        tally.other_refusals += 1;
                        continue;
                    }
                    code => panic!("s{seed}-{i}: refused as {code}: {refused}"),
                },
                Err(CompoundRefused::Broken(broken)) => panic!("s{seed}-{i}: {broken}"),
            };
            if i % list_every == 0 {
                assert_eq!(listed(&state, &op), Some(feasible), "s{seed}-{i}");
                tally.listed_agree += 1;
            }
        }
    }
    tally
}

#[test]
fn the_seeded_campaign_lands_valid_tucks_under_and_over() {
    let tally = campaign(1..=1, 200, 5);
    eprintln!("{tally:?}");
    assert!(tally.tucks >= 100, "{tally:?}");
    assert!(tally.under >= 40 && tally.over >= 40, "{tally:?}");
    let feasible = tally.unique + tally.ambiguous;
    assert!(feasible >= 30 && tally.infeasible >= 30, "{tally:?}");
    assert!(
        tally.unique as f64 >= 0.9 * feasible as f64,
        "{} unique of {feasible}",
        tally.unique
    );
    assert!(tally.fixes_offered >= 10, "{tally:?}");
    assert!(tally.listed_agree >= 20, "{tally:?}");
}

/// What the tools ask of a tuck before it lands (plan D12, D14), on spike
/// case 4a: what moves against T as a plain fold's analysis reads it — the
/// bounded closure, the bottom layer's corner alone, where the plain fold
/// would take the top layer's too — and a plain fold's picture of the block,
/// whose arrow the landed step's picture ends under T.
#[test]
fn a_tuck_reads_and_is_pictured_as_a_plain_fold_of_its_block() {
    let book = book();
    let op = tuck(
        corner(),
        [0.02, 0.02],
        Direction::Valley,
        Seed::Flaps {
            at: vec![[0.05, 0.05]],
        },
        [0.75, 0.5],
    );
    let analysis = book
        .analyse_tuck_fold(&op)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(analysis.moving, vec![face(&book, [0.25, 0.5])]);
    let plain = book
        .analyse_fold(&op.plain())
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(plain.moving.len(), 2);
    assert_eq!(
        (analysis.flaps.clone(), analysis.picked.clone()),
        (plain.flaps, plain.picked)
    );
    // Nothing beyond the seed's flap moves, so none is added.
    assert!(analysis.added.is_empty());
    assert_eq!(analysis.direction, Direction::Valley);

    let action = book.tuck_action(&op).unwrap_or_else(|e| panic!("{e}"));
    assert!(action.line.is_some());
    assert!(action.pleat.is_none() && action.push.is_none());
    let Some(grip) = action.grip else {
        panic!("no grip");
    };
    assert_eq!(grip.hidden_image, None);

    let folded = landed(&book, &op);
    let pictured = folded.action(&book).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(pictured.line, action.line);
    let Some(landed_grip) = pictured.grip else {
        panic!("no grip");
    };
    assert_eq!(landed_grip.at, grip.at);
    // Under T, the top layer: one layer over the corner where it lands.
    assert_eq!(landed_grip.hidden_image, Some(1));

    // A target that would move is refused, as the tuck is.
    let into_seed = TuckFold {
        target: [0.25, 0.5],
        ..op.clone()
    };
    assert_eq!(
        book.analyse_tuck_fold(&into_seed)
            .map(|_| ())
            .map_err(|refused| refused.refusal.code()),
        Err("tuck_target_moves")
    );
}

/// The spike's campaign at its size: seeds 1–2, 1,500 states each. The spike
/// found "immediately under T" feasible for 40% of the layers a plain fold
/// lands on (793 of 1,970) and unique in 99.1% of those (786).
///
/// `cargo test -p oristudio-fold --release --test tuck -- --ignored --nocapture`
#[test]
#[ignore = "the spike's full campaign; run with --release --ignored"]
fn the_spikes_campaign() {
    let start = std::time::Instant::now();
    let tally = campaign(1..=2, 1500, 25);
    let feasible = tally.unique + tally.ambiguous;
    eprintln!(
        "{tally:?}\nfeasible {feasible} of {} ({:.1}%), unique {} of {feasible} ({:.2}%), in {:.1} s",
        tally.tucks - tally.other_refusals,
        100.0 * feasible as f64 / (tally.tucks - tally.other_refusals) as f64,
        tally.unique,
        100.0 * tally.unique as f64 / feasible as f64,
        start.elapsed().as_secs_f64()
    );
}
