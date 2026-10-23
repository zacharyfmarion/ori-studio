//! The stacking cap (`oristudio_layer_order::MAX_STACKED_TRIPLES`) against
//! real models, through the bridge's own calls:
//!
//! - the five authored designs' Fold sequences (`fold-design-completion`),
//!   and two fold examples, fold far under it, step by step, and their last
//!   states import under it;
//! - the fixtures' real crease patterns import under it, the deepest a
//!   box-pleated iguana component that stacks 250 layers deep (10.2 million
//!   triples), which the cap of 4 million refused before the solver's
//!   rework.
//!
//! With `FOLD_STACKING_CORPUS_DIR` set, every `<case>/truth.fold` under it
//! (the layout of the cpoogle cases) is weighed, and imported and landed
//! when it is under the cap, one row printed per case: the measurement the
//! cap was chosen from (`MAX_STACKED_TRIPLES`'s docs). Run it in release:
//!
//! ```sh
//! FOLD_STACKING_CORPUS_DIR=/path/to/cpoogle \
//!   cargo test -p oristudio-fold-wasm --release --test stacking_corpus -- --nocapture
//! ```

#![cfg(not(target_arch = "wasm32"))]

use std::path::{Path, PathBuf};
use std::time::Instant;

use oristudio_fold::{ImportRefusal, ImportTarget, ImportedPattern, StartSide, State};
use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::io::kernel::{cp_json, input_of_cp_json, load};
use oristudio_fold_wasm::io::{CpFile, CpFormat, Imports, Limits, Target, send_to_edit_text};
use oristudio_fold_wasm::wire::{Choices, Op, Outcome, Paper};
use serde_json::{Value, json};

const CAP: u64 = oristudio_layer_order::MAX_STACKED_TRIPLES;

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures")
}

/// The triples of `state`'s faces that overlap one another.
fn triples(state: &State) -> u64 {
    state.problem().stack_depth(state.folded_view()).triples
}

/// A crease-pattern file weighed as Import CP weighs it: its stacking, or
/// the import's refusal.
fn weigh(format: CpFormat, bytes: &[u8]) -> Result<(usize, u64), ImportRefusal> {
    let input = load(format, bytes)
        .and_then(|model| cp_json(&model))
        .and_then(|json| input_of_cp_json(&json))
        .unwrap_or_else(|e| panic!("{}", e.code()));
    let pattern = ImportedPattern::new(
        &input,
        ImportTarget::Empty {
            start: StartSide::Front,
        },
    )?;
    let unordered = pattern.unordered();
    let depth = unordered.problem().stack_depth(unordered.view());
    Ok((depth.deepest, depth.triples))
}

/// Import CP's open into an empty sequence and its pick of the first order:
/// the milliseconds each took, or the refusal's code.
fn import(format: CpFormat, bytes: &[u8]) -> Result<(f64, f64), String> {
    let mut bridge = Bridge::new();
    let mut imports = Imports::new();
    let target = Target::Empty {
        start_side: StartSide::Front,
    };
    let t = Instant::now();
    let opened = imports.open(
        &bridge,
        CpFile::of(format),
        bytes,
        target,
        &Limits::default(),
    );
    let open = t.elapsed().as_secs_f64() * 1e3;
    let opened = match opened {
        Ok(Outcome::Ok(opened)) => opened,
        Ok(Outcome::Refused(refused)) => return Err(format!("{refused:?}")),
        Err(e) => return Err(format!("{e:?}")),
    };
    let choice = vec![0; opened.components.len()];
    let t = Instant::now();
    let picked = imports.pick(&mut bridge, opened.import, &choice);
    let pick = t.elapsed().as_secs_f64() * 1e3;
    match picked {
        Ok(Outcome::Ok(_)) => Ok((open, pick)),
        other => Err(format!("{other:?}")),
    }
}

/// Every step of a sequence document replayed from its parent; the most
/// triples any landed state has, and the last state.
fn replay(name: &str, doc: &Value) -> (u64, State) {
    let mut bridge = Bridge::new();
    let paper: Paper =
        serde_json::from_value(doc["paper"].clone()).unwrap_or_else(|e| panic!("{name}: {e}"));
    let Outcome::Ok(sheet) = bridge.sheet(&paper) else {
        panic!("{name}: no sheet")
    };
    let mut at = std::collections::BTreeMap::<String, u32>::new();
    let (mut most, mut last) = (0, sheet.state);
    for step in doc["steps"].as_array().cloned().unwrap_or_default() {
        let op: Op = serde_json::from_value(step["op"].clone()).unwrap_or_else(|e| panic!("{e}"));
        let choices: Choices =
            serde_json::from_value(step.get("choices").cloned().unwrap_or(json!({})))
                .unwrap_or_else(|e| panic!("{e}"));
        let parent = step["parent"]
            .as_str()
            .and_then(|id| at.get(id))
            .copied()
            .unwrap_or(sheet.state);
        let Ok(Outcome::Ok(applied)) = bridge.apply(parent, &op, &choices) else {
            panic!("{name}: step {} did not land", step["id"])
        };
        let state = bridge
            .state(applied.state)
            .unwrap_or_else(|e| panic!("{e:?}"));
        most = most.max(triples(state));
        at.insert(
            step["id"].as_str().unwrap_or_default().to_string(),
            applied.state,
        );
        last = applied.state;
    }
    let last = bridge
        .state(last)
        .unwrap_or_else(|e| panic!("{e:?}"))
        .clone();
    (most, last)
}

#[test]
fn the_fixture_sequences_fold_far_under_the_cap() {
    // The most triples of any step, on 2026-10-19: the crane's 10,440, under
    // a three-hundredth of the cap.
    for name in [
        "fold-design-completion/crane.osf",
        "fold-design-completion/heart.osf",
        "fold-design-completion/cicada.osf",
        "fold-design-completion/swan.osf",
        "fold-design-completion/box.osf",
        "fold-examples/petal-fold.osf",
        "fold-examples/swivel-inside.osf",
    ] {
        let file: Value = serde_json::from_str(
            &std::fs::read_to_string(fixtures().join(name)).unwrap_or_else(|e| panic!("{e}")),
        )
        .unwrap_or_else(|e| panic!("{e}"));
        let docs = file["workspace"]["foldSequences"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        assert!(!docs.is_empty(), "{name}");
        for doc in docs {
            let (most, last) = replay(name, &doc);
            assert!(most <= CAP / 100, "{name}: {most} triples");
            // Its crease pattern through Send to Edit and Import CP.
            let text = send_to_edit_text(&last, None).unwrap_or_else(|e| panic!("{e:?}"));
            let weighed = weigh(CpFormat::Fold, text.as_bytes());
            assert!(
                weighed.as_ref().is_ok_and(|&(_, t)| t <= CAP / 100),
                "{name}: {weighed:?}"
            );
            println!("{name}: at most {most} triples a step; imported, {weighed:?}");
        }
    }
}

#[test]
fn the_fixture_patterns_import_under_the_cap() {
    for name in ["flat-folder/kabuto.fold", "beloch/crane.fold"] {
        let bytes = std::fs::read(fixtures().join(name)).unwrap_or_else(|e| panic!("{e}"));
        let weighed = weigh(CpFormat::Fold, &bytes);
        assert!(
            weighed.as_ref().is_ok_and(|&(_, t)| t <= CAP / 100),
            "{name}: {weighed:?}"
        );
        assert!(import(CpFormat::Fold, &bytes).is_ok(), "{name}");
        println!("{name}: (deepest, triples) {weighed:?}");
    }
    // A component of a box-pleated iguana, 850 faces 250 layers deep:
    // 10,233,200 triples. It was over the cap of 4 million before the
    // solver's rework, when it took 15 s to open and 6 s to land natively;
    // now it opens in about 1.3 s and is under the cap. Weighed only:
    // landing it is the release-mode measurement's (`MAX_STACKED_TRIPLES`'s
    // docs), not a debug test's.
    let bytes = std::fs::read(fixtures().join("precrease/iguana-c0.fold"))
        .unwrap_or_else(|e| panic!("{e}"));
    // Weighed at all means under the cap: over it, `weigh` is the refusal.
    let weighed = weigh(CpFormat::Fold, &bytes);
    assert_eq!(weighed, Ok((250, 10_233_200)));
    println!("precrease/iguana-c0.fold: (deepest, triples) {weighed:?}, under {CAP}");
}

/// The external corpus, when `FOLD_STACKING_CORPUS_DIR` names one: a row per
/// case, and every case over the cap refused by it.
#[test]
fn the_external_corpus_under_and_over_the_cap() {
    let Some(dir) = std::env::var_os("FOLD_STACKING_CORPUS_DIR") else {
        return;
    };
    let mut cases: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map(|entries| entries.filter_map(|e| e.ok().map(|e| e.path())).collect())
        .unwrap_or_default();
    cases.sort();
    println!("| case | deepest | triples | open ms | land ms |");
    println!("|---|---|---|---|---|");
    let (mut under, mut over) = (0, 0);
    for case in cases {
        let Ok(bytes) = std::fs::read(case.join("truth.fold")) else {
            continue;
        };
        let name = case
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        match weigh(CpFormat::Fold, &bytes) {
            Ok((deepest, triples)) => {
                under += 1;
                let landed = match import(CpFormat::Fold, &bytes) {
                    Ok((open, pick)) => format!("{open:.0} | {pick:.0}"),
                    Err(refused) => {
                        format!("refused | {}", refused.chars().take(60).collect::<String>())
                    }
                };
                println!("| {name} | {deepest} | {triples} | {landed} |");
            }
            Err(ImportRefusal::StackedTooDeep {
                deepest, triples, ..
            }) => {
                over += 1;
                println!("| {name} | {deepest} | {triples} | over the cap | |");
            }
            Err(refusal) => println!("| {name} | refused {} | | | |", refusal.code()),
        }
    }
    println!("{under} under the cap, {over} over it");
}
