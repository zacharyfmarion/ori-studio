//! The Fold engine's compound folds checked from outside (plan D8, D19,
//! Phase 9): the states its inside reverse fold lands, verified by the two
//! oracles `fold_oracle` uses, which share no code with it.
//!
//! - **The seeded campaign** of the reverse spike (`r2-spike-reverse-crimp-
//!   tuck`, `campaign-reverse.mjs`), drawn by `oristudio_fold::random` as the
//!   engine's own `tests/reverse.rs` draws it: every admissible opening of
//!   the tip folded inside, and every order a choice offers.
//! - **The crane** by Ida's route, which `tests/crane.rs` folds from the
//!   square and matches face for face against Beloch's `crane.fold`, and the
//!   bird base on the way (`bird-base-petal.fold`): here each frame is
//!   imported through Import CP with its own order, the same states.
//!
//! Seeded Oriedita (`fold_support::oriedita`) runs in process; Flat-Folder's
//! `verify` (`fold_support::flat_folder`) when `FLATFOLDER_ORACLE` is set.
//! Each has the negative control `fold_oracle` has: a pair of a state's order
//! flipped where the engine's checker refuses the flip must not verify.

#[path = "../../oristudio-fold/tests/beloch/mod.rs"]
mod beloch;
mod fold_support;
mod support;

use fold_support::flat_folder::{self, Job};
use fold_support::oriedita::{Seeded, Verdict};
use fold_support::{flipped, has_flat_creases, pick, verify_frame, verify_order};
use oristudio_fold::random::{self, Rng};
use oristudio_fold::{ReverseChoices, ReverseFold, ReverseOutcome, State};
use oristudio_layer_order::check;

/// The campaign's first seed and how many of its states; the engine's own
/// test runs the same draws.
const SEED: u64 = 1;
const SETUPS: u64 = 400;

/// States checked against Flat-Folder, one Node process each.
const FLAT_FOLDER_STATES: usize = 120;

/// A state a reverse fold landed.
struct Landed {
    label: String,
    state: State,
}

/// Draw `i` of the campaign (as `oristudio-fold`'s `tests/reverse.rs`
/// draws it).
fn case(seed: u64, i: u64) -> Option<(State, ReverseFold)> {
    let mut rng = Rng::new(seed * 7777 + i);
    let state = random::folded(&mut rng).ok()?;
    if state.faces().len() > 60 {
        return None;
    }
    for _ in 0..6 {
        let Some(op) = random::reverse_fold(&state, &mut rng, 0.2) else {
            continue;
        };
        let Ok(analysis) = state.analyse_reverse(&op) else {
            continue;
        };
        if analysis.flaps.iter().all(|f| !f.openings.is_empty()) {
            return Some((state, op));
        }
    }
    None
}

fn campaign() -> Vec<Landed> {
    let mut out = Vec::new();
    for i in 0..SETUPS {
        let Some((state, op)) = case(SEED, i) else {
            continue;
        };
        let Ok(analysis) = state.analyse_reverse(&op) else {
            continue;
        };
        let first = &analysis.flaps[0];
        if analysis.flaps.iter().skip(1).any(|f| f.openings.len() > 1) {
            continue;
        }
        for (k, opening) in first.openings.iter().enumerate().take(4) {
            let choices = ReverseChoices {
                openings: if first.openings.len() > 1 {
                    vec![opening.stored.clone()]
                } else {
                    Vec::new()
                },
                order: None,
            };
            let label = format!("s{SEED}-{i:04}-o{k}");
            match state.reverse_fold(&op, &choices) {
                Ok(ReverseOutcome::Landed(folded)) => out.push(Landed {
                    label,
                    state: folded.state,
                }),
                Ok(ReverseOutcome::ChooseOrder(choice)) => {
                    let sizes: Vec<usize> = choice
                        .completions()
                        .components()
                        .iter()
                        .map(|c| c.orders.len())
                        .collect();
                    let mut picks = vec![Vec::new()];
                    for n in sizes {
                        picks = picks
                            .into_iter()
                            .flat_map(|p: Vec<usize>| {
                                (0..n).map(move |j| {
                                    let mut q = p.clone();
                                    q.push(j);
                                    q
                                })
                            })
                            .collect();
                    }
                    for (j, pick) in picks.iter().enumerate() {
                        let folded = choice.pick(pick).unwrap_or_else(|e| panic!("{label}: {e}"));
                        out.push(Landed {
                            label: format!("{label}-c{j}"),
                            state: folded.state,
                        });
                    }
                }
                _ => {}
            }
        }
    }
    out
}

/// Beloch's bird base and crane, imported with their own orders.
fn crane_states() -> Vec<Landed> {
    ["bird-base-petal.fold", "crane.fold"]
        .into_iter()
        .map(|name| Landed {
            label: name.to_string(),
            state: beloch::final_state(&beloch::document(name))
                .unwrap_or_else(|e| panic!("{name}: {e}")),
        })
        .collect()
}

#[test]
fn every_reverse_fold_verifies_against_seeded_oriedita() {
    let states: Vec<Landed> = campaign().into_iter().chain(crane_states()).collect();
    let (mut verified, mut unrepresentable, mut seeded_pairs, mut max_faces) = (0, 0, 0, 0);
    let mut failures = Vec::new();
    for landed in &states {
        let seeded = Seeded::new(&landed.state).unwrap_or_else(|e| panic!("{}: {e}", landed.label));
        match seeded.verify(landed.state.order()) {
            Verdict::Verified { seeded } => {
                verified += 1;
                seeded_pairs += seeded;
                max_faces = max_faces.max(landed.state.faces().len());
            }
            Verdict::Unrepresentable => unrepresentable += 1,
            other => failures.push(format!("{}: {other:?}", landed.label)),
        }
    }
    eprintln!(
        "{verified} of {} reverse-fold states verified ({unrepresentable} unrepresentable); \
         {seeded_pairs} seeded pairs, up to {max_faces} faces",
        states.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
    assert!(
        verified >= 240 && seeded_pairs >= 10_000 && max_faces >= 60,
        "{verified} verified, {seeded_pairs} pairs, up to {max_faces} faces"
    );
}

/// Oriedita sees only folding colours, so the control runs where every face
/// is an Oriedita face of its own.
#[test]
fn seeded_oriedita_refuses_flips_of_reverse_folds() {
    let (mut refused, mut valid) = (0, 0);
    let mut missed = Vec::new();
    for (n, landed) in campaign().into_iter().enumerate() {
        if has_flat_creases(&landed.state) || landed.state.order().is_empty() {
            continue;
        }
        let order = landed.state.order();
        let pairs: Vec<_> = order.pairs().map(|(pair, _)| pair).collect();
        let pair = pairs[pick(n as u64, landed.state.step(), pairs.len())];
        let Some(flip) = flipped(order, pair) else {
            continue;
        };
        if check(landed.state.folded_view(), &flip).is_valid() {
            valid += 1;
            continue;
        }
        let seeded = Seeded::new(&landed.state).unwrap_or_else(|e| panic!("{}: {e}", landed.label));
        match seeded.verify(&flip) {
            Verdict::Verified { .. } => missed.push(format!("{} {pair}", landed.label)),
            _ => refused += 1,
        }
    }
    eprintln!("{refused} flips refused; {valid} flips valid");
    assert!(missed.is_empty(), "Oriedita verified flips: {missed:#?}");
    assert!(refused >= 100, "only {refused} flips tried");
}

#[test]
fn every_reverse_fold_verifies_with_flat_folder_when_enabled() {
    let Some(oracle) = flat_folder::oracle() else {
        return;
    };
    let states: Vec<Landed> = campaign()
        .into_iter()
        .take(FLAT_FOLDER_STATES)
        .chain(crane_states())
        .collect();
    let mut jobs = Vec::new();
    for (n, landed) in states.iter().enumerate() {
        let frame = verify_frame(&landed.state).unwrap_or_else(|e| panic!("{}: {e}", landed.label));
        jobs.push(Job {
            name: landed.label.clone(),
            frame: frame.clone(),
            order: frame.face_orders.clone(),
        });
        let order = landed.state.order();
        let pairs: Vec<_> = order.pairs().map(|(pair, _)| pair).collect();
        if pairs.is_empty() {
            continue;
        }
        let pair = pairs[pick(n as u64, landed.state.step(), pairs.len())];
        if let Some(flip) = flipped(order, pair)
            && !check(landed.state.folded_view(), &flip).is_valid()
        {
            jobs.push(Job {
                name: format!("{}-flip", landed.label),
                frame,
                order: verify_order(&landed.state, &flip)
                    .unwrap_or_else(|e| panic!("{}: {e}", landed.label)),
            });
        }
    }
    let records = flat_folder::verify_all(&oracle, &jobs);
    let (mut valid, mut refused) = (0, 0);
    let mut failures = Vec::new();
    for (Job { name, .. }, record) in jobs.iter().zip(&records) {
        let verdict = record["verify"]["verdict"].as_str().unwrap_or_default();
        if name.ends_with("-flip") {
            if verdict == "valid" {
                failures.push(format!("{name}: Flat-Folder accepted the flip"));
            } else {
                refused += 1;
            }
        } else if record["status"] == "ok" && verdict == "valid" {
            valid += 1;
        } else {
            let mut text = record.to_string();
            text.truncate(400);
            failures.push(format!("{name}: {text}"));
        }
    }
    eprintln!(
        "{valid} of {} reverse-fold states valid, {refused} flips refused",
        states.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
    assert_eq!(valid, states.len());
}
