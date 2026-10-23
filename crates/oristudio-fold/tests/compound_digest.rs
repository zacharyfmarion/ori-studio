//! Digests of the compound folds' seeded campaigns: every operation and its
//! outcome — the landed parts to the bit and the report, each order a choice
//! offers, or the refusal with its fixes — hashed in order. A change meant to
//! leave the engine's answers alone (a faster completion, a cheaper refusal)
//! prints the same digests as the build before it:
//!
//! ```sh
//! cargo test -p oristudio-fold --release --test compound_digest -- --ignored --nocapture
//! ```
//!
//! Reports are hashed as the bridge sends them (JSON), so a field added with
//! nothing in it changes no digest; parts and refusals by `Debug`, which
//! prints every coordinate to the bit.

mod compound;
mod support;

use std::hash::{DefaultHasher, Hash, Hasher};

use oristudio_fold::{
    CompletionLimits, CompoundRefused, CrimpOutcome, ReverseFold, ReverseKind, ReverseOutcome,
    State, StateParts, TuckChoices, TuckOutcome,
};
use serde::Serialize;

fn landed(parts: &StateParts, report: &impl Serialize) -> String {
    format!(
        "{parts:?} {}",
        serde_json::to_string(report).unwrap_or_default()
    )
}

fn refused(refused: &CompoundRefused) -> String {
    format!("{refused:?}")
}

/// Every choice's landing, in pick order.
fn picks<T, E: std::fmt::Debug>(
    sizes: Vec<usize>,
    pick: impl Fn(&[usize]) -> Result<T, E>,
    key: impl Fn(&T) -> String,
    hasher: &mut DefaultHasher,
) {
    for choice in compound::picks(&sizes) {
        match pick(&choice) {
            Ok(folded) => key(&folded),
            Err(refusal) => format!("{refusal:?}"),
        }
        .hash(hasher);
    }
}

/// Every reverse fold of the spike's campaign (seeds 1–3, 1,500 states each)
/// that the engine's own campaign folds — each admissible opening of the
/// first flap, four at most — of both kinds, with the kinds that land.
#[test]
#[ignore = "prints a digest to compare between builds; run with --release --ignored"]
fn reverse_campaign_digest() {
    let mut hasher = DefaultHasher::new();
    let mut ops = 0;
    for seed in 1..=3 {
        for i in 0..1500 {
            let Some((state, op)) = compound::reverse_case(seed, i) else {
                continue;
            };
            let Ok(analysis) = state.analyse_reverse(&op) else {
                continue;
            };
            if analysis.flaps.iter().skip(1).any(|f| f.openings.len() > 1) {
                continue;
            }
            for k in 0..analysis.flaps[0].openings.len().min(4) {
                let Some(choices) = compound::first_flap_opened(&analysis, k) else {
                    continue;
                };
                format!("{:?}", state.reverse_kinds(&op, &choices)).hash(&mut hasher);
                for kind in [ReverseKind::Inside, ReverseKind::Outside] {
                    let op = ReverseFold { kind, ..op.clone() };
                    hash_reverse(&state, &op, &state.reverse_fold(&op, &choices), &mut hasher);
                    ops += 1;
                }
            }
        }
    }
    eprintln!("{ops} reverse folds, digest {:016x}", hasher.finish());
}

fn hash_reverse(
    state: &State,
    op: &ReverseFold,
    outcome: &Result<ReverseOutcome, CompoundRefused>,
    hasher: &mut DefaultHasher,
) {
    format!("{op:?} {}", state.faces().len()).hash(hasher);
    match outcome {
        Ok(ReverseOutcome::Landed(folded)) => {
            landed(folded.state.parts(), &folded.report).hash(hasher);
        }
        Ok(ReverseOutcome::ChooseOrder(choice)) => {
            format!("{:?}", choice.count()).hash(hasher);
            let sizes = choice
                .completions()
                .components()
                .iter()
                .map(|c| c.orders.len())
                .collect();
            picks(
                sizes,
                |pick| choice.pick(pick),
                |folded| landed(folded.state.parts(), &folded.report),
                hasher,
            );
        }
        Ok(ReverseOutcome::ChooseOpening(analysis)) => format!("{analysis:?}").hash(hasher),
        Err(refusal) => refused(refusal).hash(hasher),
    }
}

/// Every crimp of the spike's crimp campaign (seeds 1–2, 1,500 states each),
/// both kinds, each flap at its first opening, with the kinds that land.
#[test]
#[ignore = "prints a digest to compare between builds; run with --release --ignored"]
fn crimp_campaign_digest() {
    let mut hasher = DefaultHasher::new();
    let mut ops = 0;
    for seed in 1..=2 {
        for i in 0..1500 {
            let Some((state, op)) = compound::crimp_case(seed, i) else {
                continue;
            };
            let Some(choices) = compound::crimp_openings(&state, &op) else {
                continue;
            };
            format!("{:?}", state.crimp_kinds(&op, &choices)).hash(&mut hasher);
            for kind in [ReverseKind::Inside, ReverseKind::Outside] {
                let op = oristudio_fold::CrimpFold { kind, ..op.clone() };
                format!("{op:?} {}", state.faces().len()).hash(&mut hasher);
                match state.crimp_fold(&op, &choices) {
                    Ok(CrimpOutcome::Landed(folded)) => {
                        landed(folded.state.parts(), &folded.report).hash(&mut hasher);
                    }
                    Ok(CrimpOutcome::ChooseOrder(choice)) => {
                        format!("{:?}", choice.count()).hash(&mut hasher);
                        let sizes = choice
                            .completions()
                            .components()
                            .iter()
                            .map(|c| c.orders.len())
                            .collect();
                        picks(
                            sizes,
                            |pick| choice.pick(pick),
                            |folded| landed(folded.state.parts(), &folded.report),
                            &mut hasher,
                        );
                    }
                    Ok(CrimpOutcome::ChooseOpening(analysis)) => {
                        format!("{analysis:?}").hash(&mut hasher);
                    }
                    Err(refusal) => refused(&refusal).hash(&mut hasher),
                }
                ops += 1;
            }
        }
    }
    eprintln!("{ops} crimps, digest {:016x}", hasher.finish());
}

/// Every tuck of the spike's tuck campaign (seeds 1–2, 1,500 states each),
/// and every 25th state's listed targets.
#[test]
#[ignore = "prints a digest to compare between builds; run with --release --ignored"]
fn tuck_campaign_digest() {
    let mut hasher = DefaultHasher::new();
    let mut ops = 0;
    for seed in 1..=2 {
        for i in 0..1500 {
            let Some((state, op)) = compound::tuck_case(seed, i) else {
                continue;
            };
            format!("{op:?} {}", state.faces().len()).hash(&mut hasher);
            match state.tuck_fold(&op, &TuckChoices::default()) {
                Ok(TuckOutcome::Landed(folded)) => {
                    landed(folded.state.parts(), &folded.report).hash(&mut hasher);
                }
                Ok(TuckOutcome::ChooseOrder(choice)) => {
                    format!("{:?}", choice.count()).hash(&mut hasher);
                    let sizes = choice
                        .completions()
                        .components()
                        .iter()
                        .map(|c| c.orders.len())
                        .collect();
                    picks(
                        sizes,
                        |pick| choice.pick(pick),
                        |folded| landed(folded.state.parts(), &folded.report),
                        &mut hasher,
                    );
                }
                Err(refusal) => refused(&refusal).hash(&mut hasher),
            }
            if i % 25 == 0 {
                format!(
                    "{:?}",
                    state.analyse_tuck(&op, &CompletionLimits::default())
                )
                .hash(&mut hasher);
            }
            ops += 1;
        }
    }
    eprintln!("{ops} tucks, digest {:016x}", hasher.finish());
}
