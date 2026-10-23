//! The Fold engine checked from outside (plan D8, D19): the states of seeded
//! random sequences, verified by two oracles that share no code with it.
//!
//! The sequences are the engine's own property-test draws
//! (`oristudio_fold::random`, the campaign `oristudio-fold`'s
//! `tests/random.rs` runs at seed 1): folds and precreases along lines through
//! landmarks, every kind of seed, turn-overs and rotations, on square,
//! rectangular and polygonal sheets. Every state a fold or precrease lands is
//! checked; a turn-over or rotation changes only the view.
//!
//! Each oracle reads a state the way the engine hands it out, so the way out
//! is checked with it:
//!
//! - **Oriedita, seeded** (`fold_support::oriedita`), in process, on the
//!   crease pattern `fold_cp_to_model` gives Edit (plan D10). It always runs.
//! - **Flat-Folder's `verify`** (`fold_support::flat_folder`), in Node, on the
//!   FOLD export's step frame of the state, gated on `FLATFOLDER_ORACLE`, with
//!   its arrangement validated and rebuilt at halved ε when wrong.
//!
//! Each has a negative control: one pair of a state's order flipped, where the
//! engine's own checker refuses the flip, must not verify. A flip the checker
//! accepts is another valid order (a lone pair either way round), and only
//! counted.

mod fold_support;
mod support;

use fold_support::flat_folder::{self, Job};
use fold_support::oriedita::{Seeded, Verdict};
use fold_support::{flipped, has_flat_creases, pick, verify_frame, verify_order};
use oristudio_fold::State;
use oristudio_fold::random::{Outcome, Sequence};
use oristudio_layer_order::{FacePair, LayerOrder, check};
use serde_json::Value;

/// The engine's property-test campaign: its seed, steps and face limit.
const CAMPAIGN_SEED: u64 = 1;
const STEPS: usize = 10;
const MAX_FACES: usize = 64;

/// Sequences checked against Oriedita: all of the engine's campaign.
const ORIEDITA_SEQUENCES: u64 = 160;

/// Sequences checked against Flat-Folder, one Node process per state and per
/// flip.
const FLAT_FOLDER_SEQUENCES: u64 = 32;

/// A state a fold or precrease landed.
struct Landed {
    label: String,
    sequence: u64,
    state: State,
}

fn landed(sequences: u64) -> Vec<Landed> {
    let mut out = Vec::new();
    for sequence in 0..sequences {
        let seed = CAMPAIGN_SEED.wrapping_mul(0x2545_f491_4f6c_dd1d) ^ sequence;
        let steps = Sequence::new(seed, STEPS, MAX_FACES)
            .unwrap_or_else(|e| panic!("sequence {sequence}: {e}"));
        for step in steps {
            if let Outcome::Landed(folded) = step.outcome {
                out.push(Landed {
                    label: format!("s{sequence:03}-t{:02}", folded.state.step()),
                    sequence,
                    state: folded.state,
                });
            }
        }
    }
    out
}

/// The pair a state's negative control flips, when the engine's checker
/// refuses the flipped order; none when the order is empty or the flip is
/// another valid order.
fn refused_flip(landed: &Landed) -> Option<(FacePair, LayerOrder)> {
    let order = landed.state.order();
    let pairs: Vec<FacePair> = order.pairs().map(|(pair, _)| pair).collect();
    if pairs.is_empty() {
        return None;
    }
    let pair = pairs[pick(landed.sequence, landed.state.step(), pairs.len())];
    let flip = flipped(order, pair)?;
    (!check(landed.state.folded_view(), &flip).is_valid()).then_some((pair, flip))
}

#[test]
fn every_random_state_verifies_against_seeded_oriedita() {
    let states = landed(ORIEDITA_SEQUENCES);
    let (mut verified, mut precreased, mut unrepresentable) = (0, 0, 0);
    let (mut seeded_pairs, mut max_faces) = (0, 0);
    let mut failures = Vec::new();
    for landed in &states {
        let seeded = Seeded::new(&landed.state).unwrap_or_else(|e| panic!("{}: {e}", landed.label));
        match seeded.verify(landed.state.order()) {
            Verdict::Verified { seeded } => {
                verified += 1;
                precreased += usize::from(has_flat_creases(&landed.state));
                seeded_pairs += seeded;
                max_faces = max_faces.max(landed.state.faces().len());
            }
            Verdict::Unrepresentable => unrepresentable += 1,
            other => failures.push(format!("{}: {other:?}", landed.label)),
        }
    }
    eprintln!(
        "{verified} of {} states verified ({precreased} with flat creases; {unrepresentable} \
         unrepresentable); {seeded_pairs} seeded pairs, up to {max_faces} faces",
        states.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
    // The campaign, so a change to the draws cannot quietly shrink the check.
    assert!(
        verified >= 700 && precreased >= 200 && seeded_pairs >= 40_000,
        "{verified} verified, {precreased} with flat creases, {seeded_pairs} pairs"
    );
}

/// Oriedita sees only folding colours, so the control runs where every face
/// is an Oriedita face of its own: no flat creases.
#[test]
fn seeded_oriedita_refuses_the_flips_the_checker_refuses() {
    let (mut refused, mut valid_flips) = (0, 0);
    let mut missed = Vec::new();
    for landed in landed(ORIEDITA_SEQUENCES) {
        if has_flat_creases(&landed.state) || landed.state.order().is_empty() {
            continue;
        }
        let Some((pair, flip)) = refused_flip(&landed) else {
            valid_flips += 1;
            continue;
        };
        let seeded = Seeded::new(&landed.state).unwrap_or_else(|e| panic!("{}: {e}", landed.label));
        assert!(seeded.one_to_one(), "{}", landed.label);
        match seeded.verify(&flip) {
            Verdict::Verified { .. } => missed.push(format!("{} {pair}", landed.label)),
            _ => refused += 1,
        }
    }
    eprintln!("{refused} flips refused; {valid_flips} flips valid");
    assert!(missed.is_empty(), "Oriedita verified flips: {missed:#?}");
    assert!(refused >= 300, "only {refused} flips tried");
}

#[test]
fn every_random_state_verifies_with_flat_folder_when_enabled() {
    let Some(oracle) = flat_folder::oracle() else {
        return;
    };
    let states = landed(FLAT_FOLDER_SEQUENCES);
    let mut jobs = Vec::new();
    let mut flips = Vec::new();
    for landed in &states {
        let frame = verify_frame(&landed.state).unwrap_or_else(|e| panic!("{}: {e}", landed.label));
        jobs.push(Job {
            name: landed.label.clone(),
            frame: frame.clone(),
            order: frame.face_orders.clone(),
        });
        if let Some((pair, flip)) = refused_flip(landed) {
            let order = verify_order(&landed.state, &flip)
                .unwrap_or_else(|e| panic!("{}: {e}", landed.label));
            flips.push(format!("{} {pair}", landed.label));
            jobs.push(Job {
                name: format!("{}-flip", landed.label),
                frame,
                order,
            });
        }
    }
    let records = flat_folder::verify_all(&oracle, &jobs);

    let (mut valid, mut refused, mut retried) = (0, 0, 0);
    let mut failures = Vec::new();
    for (Job { name, .. }, record) in jobs.iter().zip(&records) {
        let verdict = record["verify"]["verdict"].as_str().unwrap_or_default();
        retried += usize::from(record["arrangement"]["retries"].as_u64().unwrap_or(0) > 0);
        if name.ends_with("-flip") {
            if verdict == "valid" {
                failures.push(format!("{name}: Flat-Folder accepted the flip"));
            } else {
                refused += 1;
            }
        } else if record["status"] == "ok" && verdict == "valid" {
            valid += 1;
        } else {
            failures.push(format!("{name}: {}", compact(record)));
        }
    }
    let precreased = states
        .iter()
        .filter(|landed| has_flat_creases(&landed.state))
        .count();
    eprintln!(
        "{valid} of {} states valid ({precreased} with flat creases), {refused} of {} flips \
         refused; {retried} runs needed an ε retry",
        states.len(),
        flips.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
    assert_eq!(valid, states.len());
    assert!(
        valid >= 120 && precreased >= 30 && refused >= 100,
        "{valid} states, {precreased} with flat creases, {refused} flips"
    );
}

fn compact(record: &Value) -> String {
    let mut text = record.to_string();
    text.truncate(400);
    text
}
