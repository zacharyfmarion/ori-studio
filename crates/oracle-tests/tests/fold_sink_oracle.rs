//! The Fold engine's sinks checked from outside (plan D8, D19, Phase 11):
//! every state the sink spike's named cases land — the open and closed sinks
//! of the preliminary and waterbomb bases at depths to past half the point,
//! closed sinks under tilt, the fan point's seven pockets, a precreased
//! ring, a second sink and the unsinks back (`oristudio-fold`'s
//! `tests/sinks`, shared through `#[path]` with its `tests/sink.rs`) —
//! verified by the two oracles `fold_oracle` uses, which share no code with
//! the engine.
//!
//! Seeded Oriedita (`fold_support::oriedita`) runs in process; Flat-Folder's
//! `verify` (`fold_support::flat_folder`) when `FLATFOLDER_ORACLE` is set.
//! Each has the negative control `fold_oracle` has: a pair of a state's order
//! flipped where the engine's checker refuses the flip must not verify.

mod fold_support;
#[path = "../../oristudio-fold/tests/sinks/mod.rs"]
mod sinks;
mod support;

use fold_support::flat_folder::{self, Job};
use fold_support::oriedita::{Seeded, Verdict};
use fold_support::{flipped, has_flat_creases, pick, verify_frame, verify_order};
use oristudio_layer_order::check;

/// The named cases' states, with labels a file can be named by.
fn states() -> Vec<(String, oristudio_fold::State)> {
    sinks::cases()
        .into_iter()
        .map(|(label, state)| {
            let label: String = label
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                .collect();
            (label, state)
        })
        .collect()
}

#[test]
fn every_sink_verifies_against_seeded_oriedita() {
    let states = states();
    let (mut verified, mut unrepresentable, mut seeded_pairs) = (0, 0, 0);
    let mut failures = Vec::new();
    for (label, state) in &states {
        let seeded = Seeded::new(state).unwrap_or_else(|e| panic!("{label}: {e}"));
        match seeded.verify(state.order()) {
            Verdict::Verified { seeded } => {
                verified += 1;
                seeded_pairs += seeded;
            }
            Verdict::Unrepresentable => unrepresentable += 1,
            other => failures.push(format!("{label}: {other:?}")),
        }
    }
    eprintln!(
        "{verified} of {} sink states verified ({unrepresentable} unrepresentable); \
         {seeded_pairs} seeded pairs",
        states.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
    assert!(
        verified >= 30 && seeded_pairs >= 1_000,
        "{verified} verified, {seeded_pairs} pairs"
    );
}

/// Flips of one pair tried per state for the Oriedita control: few states
/// have no precrease, so each gives several.
const FLIPS: u64 = 8;

/// Oriedita sees only folding colours, so the control runs where every face
/// is an Oriedita face of its own.
#[test]
fn seeded_oriedita_refuses_flips_of_sinks() {
    let (mut refused, mut valid) = (0, 0);
    let mut missed = Vec::new();
    for (n, (label, state)) in states().into_iter().enumerate() {
        if has_flat_creases(&state) || state.order().is_empty() {
            continue;
        }
        let seeded = Seeded::new(&state).unwrap_or_else(|e| panic!("{label}: {e}"));
        let order = state.order();
        let pairs: Vec<_> = order.pairs().map(|(pair, _)| pair).collect();
        for k in 0..FLIPS {
            let pair = pairs[pick(n as u64 * FLIPS + k, state.step(), pairs.len())];
            let Some(flip) = flipped(order, pair) else {
                continue;
            };
            if check(state.folded_view(), &flip).is_valid() {
                valid += 1;
                continue;
            }
            match seeded.verify(&flip) {
                Verdict::Verified { .. } => missed.push(format!("{label} {pair}")),
                _ => refused += 1,
            }
        }
    }
    eprintln!("{refused} flips refused; {valid} flips valid");
    assert!(missed.is_empty(), "Oriedita verified flips: {missed:#?}");
    assert!(refused >= 40, "only {refused} flips tried");
}

#[test]
fn every_sink_verifies_with_flat_folder_when_enabled() {
    let Some(oracle) = flat_folder::oracle() else {
        return;
    };
    let states = states();
    let mut jobs = Vec::new();
    for (n, (label, state)) in states.iter().enumerate() {
        let frame = verify_frame(state).unwrap_or_else(|e| panic!("{label}: {e}"));
        jobs.push(Job {
            name: format!("sink-{label}"),
            frame: frame.clone(),
            order: frame.face_orders.clone(),
        });
        let order = state.order();
        let pairs: Vec<_> = order.pairs().map(|(pair, _)| pair).collect();
        if pairs.is_empty() {
            continue;
        }
        let pair = pairs[pick(n as u64, state.step(), pairs.len())];
        if let Some(flip) = flipped(order, pair)
            && !check(state.folded_view(), &flip).is_valid()
        {
            jobs.push(Job {
                name: format!("sink-{label}-flip"),
                frame,
                order: verify_order(state, &flip).unwrap_or_else(|e| panic!("{label}: {e}")),
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
        "{valid} of {} sink states valid, {refused} flips refused",
        states.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
    assert_eq!(valid, states.len());
}
