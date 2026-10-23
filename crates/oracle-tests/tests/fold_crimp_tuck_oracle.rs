//! The Fold engine's outside reverse folds, crimps and tucks checked from
//! outside (plan D8, D19, Phase 11): the states each lands, verified by the
//! two oracles `fold_oracle` and `fold_compound_oracle` use, which share no
//! code with the engine.
//!
//! - **Outside reverse folds**: the reverse spike's campaign
//!   (`campaign-reverse.mjs`) folded outside, every admissible opening of the
//!   first flap (four at most).
//! - **Crimps**: its crimp campaign (`campaign-crimp.mjs`), inside and
//!   outside, each flap at its first opening.
//! - **Tucks**: its tuck campaign (`campaign-tuck.mjs`), valley tucks under
//!   their target and mountain tucks over it.
//!
//! Every order a choice offers is checked. The draws are
//! `oristudio_fold::random`'s, as the engine's own `tests/reverse_outside.rs`,
//! `tests/crimp.rs` and `tests/tuck.rs` draw them. Seeded Oriedita
//! (`fold_support::oriedita`) runs in process; Flat-Folder's `verify`
//! (`fold_support::flat_folder`) when `FLATFOLDER_ORACLE` is set. Each has
//! its negative control: a pair of a state's order flipped where the
//! engine's checker refuses the flip must not verify.

mod fold_support;
mod support;

use fold_support::flat_folder::{self, Job};
use fold_support::oriedita::{Seeded, Verdict};
use fold_support::{flipped, has_flat_creases, pick, verify_frame, verify_order};
use oristudio_fold::random::{self, Rng};
use oristudio_fold::{
    CrimpFold, CrimpOutcome, ReverseChoices, ReverseFold, ReverseKind, ReverseOutcome, State,
    TuckChoices, TuckOutcome,
};
use oristudio_layer_order::check;

/// The campaigns' first seed and how many of its states each draws.
const SEED: u64 = 1;
const SETUPS: u64 = 300;

/// States of each family checked against Flat-Folder, one Node process each.
const FLAT_FOLDER_STATES: usize = 40;

/// A state a compound fold landed.
struct Landed {
    label: String,
    state: State,
}

/// Every choice of one order per component, given each component's count.
fn picks(sizes: &[usize]) -> Vec<Vec<usize>> {
    let mut picks = vec![Vec::new()];
    for &n in sizes {
        picks = picks
            .into_iter()
            .flat_map(|p: Vec<usize>| {
                (0..n).map(move |k| {
                    let mut q = p.clone();
                    q.push(k);
                    q
                })
            })
            .collect();
    }
    picks
}

/// The outside reverse folds of the reverse campaign.
fn outside_reverses() -> Vec<Landed> {
    let mut out = Vec::new();
    for i in 0..SETUPS {
        let mut rng = Rng::new(SEED * 7777 + i);
        let Ok(state) = random::folded(&mut rng) else {
            continue;
        };
        if state.faces().len() > 60 {
            continue;
        }
        let drawn = (0..6).find_map(|_| {
            let op = random::reverse_fold(&state, &mut rng, 0.2)?;
            let analysis = state.analyse_reverse(&op).ok()?;
            analysis
                .flaps
                .iter()
                .all(|f| !f.openings.is_empty())
                .then_some((op, analysis))
        });
        let Some((op, analysis)) = drawn else {
            continue;
        };
        let op = ReverseFold {
            kind: ReverseKind::Outside,
            ..op
        };
        if analysis.flaps.iter().skip(1).any(|f| f.openings.len() > 1) {
            continue;
        }
        let first = &analysis.flaps[0];
        for (k, opening) in first.openings.iter().enumerate().take(4) {
            let choices = ReverseChoices {
                openings: if first.openings.len() > 1 {
                    vec![opening.stored.clone()]
                } else {
                    Vec::new()
                },
                order: None,
            };
            let label = format!("outside-s{SEED}-{i:04}-o{k}");
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
                    for (j, pick) in picks(&sizes).iter().enumerate() {
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

/// The crimps of the crimp campaign, both kinds.
fn crimps() -> Vec<Landed> {
    let mut out = Vec::new();
    for i in 0..SETUPS {
        let mut rng = Rng::new(SEED * 4243 + i);
        let Ok(state) = random::folded(&mut rng) else {
            continue;
        };
        if state.faces().len() > 60 {
            continue;
        }
        let drawn = (0..8).find_map(|_| {
            let op = random::crimp_fold(&state, &mut rng, 0.2)?;
            let analysis = state.analyse_crimp(&op).ok()?;
            analysis
                .tip
                .flaps
                .iter()
                .all(|f| !f.openings.is_empty())
                .then_some((op, analysis))
        });
        let Some((op, analysis)) = drawn else {
            continue;
        };
        let choices = ReverseChoices {
            openings: analysis
                .tip
                .flaps
                .iter()
                .filter(|f| f.openings.len() > 1)
                .map(|f| f.openings[0].stored.clone())
                .collect(),
            order: None,
        };
        for kind in [ReverseKind::Inside, ReverseKind::Outside] {
            let op = CrimpFold { kind, ..op.clone() };
            let label = format!("crimp-{kind:?}-s{SEED}-{i:04}").to_lowercase();
            match state.crimp_fold(&op, &choices) {
                Ok(CrimpOutcome::Landed(folded)) => out.push(Landed {
                    label,
                    state: folded.state,
                }),
                Ok(CrimpOutcome::ChooseOrder(choice)) => {
                    let sizes: Vec<usize> = choice
                        .completions()
                        .components()
                        .iter()
                        .map(|c| c.orders.len())
                        .collect();
                    for (j, pick) in picks(&sizes).iter().enumerate() {
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

/// The tucks of the tuck campaign: twice the states, since only a third of
/// the drawn targets take the tuck.
fn tucks() -> Vec<Landed> {
    let mut out = Vec::new();
    for i in 0..2 * SETUPS {
        let mut rng = Rng::new(SEED * 9001 + i);
        let Ok(state) = random::folded_between(&mut rng, 2, 4) else {
            continue;
        };
        if state.faces().len() > 60 {
            continue;
        }
        let Some(op) = random::tuck_fold(&state, &mut rng) else {
            continue;
        };
        let label = format!("tuck-s{SEED}-{i:04}");
        match state.tuck_fold(&op, &TuckChoices::default()) {
            Ok(TuckOutcome::Landed(folded)) => out.push(Landed {
                label,
                state: folded.state,
            }),
            Ok(TuckOutcome::ChooseOrder(choice)) => {
                let sizes: Vec<usize> = choice
                    .completions()
                    .components()
                    .iter()
                    .map(|c| c.orders.len())
                    .collect();
                for (j, pick) in picks(&sizes).iter().enumerate() {
                    let folded = choice.pick(pick).unwrap_or_else(|e| panic!("{label}: {e}"));
                    out.push(Landed {
                        label: format!("{label}-c{j}"),
                        state: folded.state,
                    });
                }
            }
            Err(_) => {}
        }
    }
    out
}

fn families() -> [(&'static str, Vec<Landed>); 3] {
    [
        ("outside reverse", outside_reverses()),
        ("crimp", crimps()),
        ("tuck", tucks()),
    ]
}

#[test]
fn every_state_verifies_against_seeded_oriedita() {
    let mut failures = Vec::new();
    for (family, states) in families() {
        let (mut verified, mut unrepresentable, mut seeded_pairs, mut max_faces) = (0, 0, 0, 0);
        for landed in &states {
            let seeded =
                Seeded::new(&landed.state).unwrap_or_else(|e| panic!("{}: {e}", landed.label));
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
            "{family}: {verified} of {} states verified ({unrepresentable} unrepresentable); \
             {seeded_pairs} seeded pairs, up to {max_faces} faces",
            states.len()
        );
        assert!(
            verified >= 60 && seeded_pairs >= 1_000,
            "{family}: {verified} verified, {seeded_pairs} pairs"
        );
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

/// Oriedita sees only folding colours, so the control runs where every face
/// is an Oriedita face of its own.
#[test]
fn seeded_oriedita_refuses_flips() {
    let mut missed = Vec::new();
    for (family, states) in families() {
        let (mut refused, mut valid) = (0, 0);
        for (n, landed) in states.into_iter().enumerate() {
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
            let seeded =
                Seeded::new(&landed.state).unwrap_or_else(|e| panic!("{}: {e}", landed.label));
            match seeded.verify(&flip) {
                Verdict::Verified { .. } => missed.push(format!("{} {pair}", landed.label)),
                _ => refused += 1,
            }
        }
        eprintln!("{family}: {refused} flips refused; {valid} flips valid");
        assert!(refused >= 30, "{family}: only {refused} flips tried");
    }
    assert!(missed.is_empty(), "Oriedita verified flips: {missed:#?}");
}

#[test]
fn every_state_verifies_with_flat_folder_when_enabled() {
    let Some(oracle) = flat_folder::oracle() else {
        return;
    };
    let mut jobs = Vec::new();
    let mut states = 0;
    for (_, family) in families() {
        for (n, landed) in family.into_iter().take(FLAT_FOLDER_STATES).enumerate() {
            states += 1;
            let frame =
                verify_frame(&landed.state).unwrap_or_else(|e| panic!("{}: {e}", landed.label));
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
    eprintln!("{valid} of {states} states valid, {refused} flips refused");
    assert!(failures.is_empty(), "{failures:#?}");
    assert_eq!(valid, states);
}
