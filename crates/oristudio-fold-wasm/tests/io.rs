//! Import CP, Start from Edit's folded figure, Send to Edit and the FOLD
//! export, natively (`src/io.rs`; plan D10, D16):
//!
//! - the kernel round trip — Send to Edit, then Import CP, gives the same
//!   state, `fs1` keys equal — over the classic sequences and seeded random
//!   states, and the import's own completion offers that order;
//! - an Import-CP golden through `.cp` and `.fold`: the same state from
//!   both, its letters where the files draw them, front and back;
//! - the samples that ship with Fold each import to their one order;
//! - opening and picking through the bridge, an empty sequence adopting the
//!   pattern's sheet, the op a pick returns replaying to its state, stored
//!   ops that no longer land refused, a caller's mistakes thrown;
//! - Edit's folded figure, folded by the kernel itself, front and rear, as
//!   the state it was folded from.
//!
//! `tests/io_node.rs` covers the same calls across the wasm boundary.

#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeSet;
use std::path::PathBuf;

use oristudio_cp::folding::{
    FoldedFigureModel, FoldedFigureState, FoldedPaperScene, folded_figure_paper_scene_from_segments,
};
use oristudio_cp::geometry::LineSegment;
use oristudio_fold::complete::{CompletionLimits, Completions};
use oristudio_fold::random::Sequence;
use oristudio_fold::{
    CreaseKind, ImportTarget, ImportedPattern, Letter, PlainFold, Sheet, SheetShape, StartSide,
    State, fold_cp_to_model,
};
use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::canonical::canonical_keys;
use oristudio_fold_wasm::io::kernel::{cp_json, input_of_cp_json, load};
use oristudio_fold_wasm::io::{
    CpFile, CpFormat, CpJump, CpOrigin, Imports, IoCallError, JumpOp, Landed, Limits, Opened,
    Target, export_fold, import_figure, jump, land, send_to_edit, send_to_edit_text,
};
use oristudio_fold_wasm::wire::{Choices, Op, Outcome, Paper};
use oristudio_geometry::convex;
use serde::Deserialize;
use serde_json::{Value, json};

type Point = [f64; 2];

fn keys(state: &State) -> BTreeSet<String> {
    canonical_keys(state).into_iter().collect()
}

fn json_of(value: &impl serde::Serialize) -> Value {
    serde_json::to_value(value).unwrap_or_else(|e| panic!("{e}"))
}

/// Whether the sheet is one Import CP takes (V0): a square or a rectangle.
fn rectangular(state: &State) -> bool {
    let outline = state.sheet().outline();
    outline.len() == 4
        && (0..4).all(|i| {
            let [a, b] = [outline[i], outline[(i + 1) % 4]];
            (a[0] - b[0]).abs() < 1e-12 || (a[1] - b[1]).abs() < 1e-12
        })
}

/// The `cpJson` Import CP stores for the file Send to Edit writes of `state`.
fn sent(state: &State) -> String {
    let text = send_to_edit_text(state, None).unwrap_or_else(|e| panic!("{e}"));
    let model = load(CpFormat::Fold, text.as_bytes()).unwrap_or_else(|e| panic!("{e}"));
    cp_json(&model).unwrap_or_else(|e| panic!("{e}"))
}

/// Send to Edit, then the `cp-jump` Import CP stores for it — the sent
/// file and the state's own order — landed after the state itself.
fn round_trip(state: &State) -> State {
    let jump = CpJump {
        cp_json: sent(state),
        order_json: jump::order_json(state).unwrap_or_else(|e| panic!("{e}")),
        origin: CpOrigin::Fold,
    };
    land(state, &jump).unwrap_or_else(|e| panic!("{}: {e}", e.code()))
}

/// Import CP's completion of the sent pattern after `state`, its letters as
/// the seeds.
fn completions(state: &State) -> Completions {
    let input = input_of_cp_json(&sent(state)).unwrap_or_else(|e| panic!("{e}"));
    ImportedPattern::new(&input, ImportTarget::After(state))
        .and_then(|pattern| pattern.complete(&CompletionLimits::default()))
        .unwrap_or_else(|e| panic!("{}: {e}", e.code()))
}

/// The round trip lands the same state, and whenever Import CP's completion
/// lists every order the letters allow, the state's is among them. Returns
/// the completion.
fn assert_round_trips(name: &str, state: &State) -> Completions {
    let jumped = round_trip(state);
    assert_eq!(keys(&jumped), keys(state), "{name} step {}", state.step());
    let completions = completions(state);
    if completions.count().exact {
        // The jump's faces are the completion's: one import of one text.
        assert!(
            completions.choice_of(jumped.order()).is_some(),
            "{name} step {}: the letters do not offer the state's order",
            state.step()
        );
    }
    completions
}

// --- The classics, replayed natively -----------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case", tag = "op")]
enum ClassicOp {
    Fold { fold: PlainFold },
    Precrease { fold: PlainFold },
    TurnOver,
}

#[derive(Debug, Deserialize)]
struct Classic {
    name: String,
    sheet: SheetShape,
    start: StartSide,
    steps: Vec<(ClassicOp, Value)>,
}

/// `oristudio-fold`'s classic sequences, each as its path of states.
fn classic_paths() -> Vec<(String, Vec<State>)> {
    let dir =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../oristudio-fold/tests/fixtures/classics");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    let paths: Vec<(String, Vec<State>)> = files
        .iter()
        .map(|file| {
            let text = std::fs::read_to_string(file).unwrap_or_default();
            let classic: Classic = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{e}"));
            let sheet = Sheet::new(&classic.sheet).unwrap_or_else(|e| panic!("{e}"));
            let flat = State::flat(sheet, classic.start).unwrap_or_else(|e| panic!("{e}"));
            let mut path = vec![flat];
            for (op, _) in &classic.steps {
                let state = &path[path.len() - 1];
                let next = match op {
                    ClassicOp::Fold { fold } => state.fold(fold).map(|f| f.state),
                    ClassicOp::Precrease { fold } => state.precrease(fold).map(|f| f.state),
                    ClassicOp::TurnOver => Ok(state.turn_over()),
                }
                .unwrap_or_else(|e| panic!("{}: {e}", classic.name));
                path.push(next);
            }
            (classic.name, path)
        })
        .collect();
    assert!(paths.len() >= 4, "only {} classics", paths.len());
    paths
}

/// The landed states of seeded random sequences on square and rectangular
/// sheets (V0 imports no polygon).
fn random_states(
    seeds: std::ops::Range<u64>,
    steps: usize,
    max_faces: usize,
) -> Vec<(String, State)> {
    let mut states = Vec::new();
    for seed in seeds {
        let Ok(sequence) = Sequence::new(seed, steps, max_faces) else {
            continue;
        };
        if !rectangular(sequence.state()) {
            continue;
        }
        for step in sequence {
            if let Some(state) = step.state() {
                states.push((format!("seed {seed}"), state.clone()));
            }
        }
    }
    states
}

#[test]
fn send_to_edit_then_import_cp_gives_the_classics_back() {
    let mut states = 0;
    for (name, path) in classic_paths() {
        for state in &path {
            assert_round_trips(&name, state);
            states += 1;
        }
    }
    assert!(states >= 15, "only {states} states");
}

#[test]
fn send_to_edit_then_import_cp_gives_random_states_back() {
    // Turned, rotated by any angle, precreased, up to 64 faces. On
    // 2026-10-08: 364 states, the letters' orders listed in full for all.
    let states = random_states(0x5eed_0000..0x5eed_0040, 12, 64);
    let mut listed = 0;
    for (name, state) in &states {
        if assert_round_trips(name, state).count().exact {
            listed += 1;
        }
    }
    eprintln!("{} random states, {listed} listed in full", states.len());
    assert!(states.len() >= 100, "only {} states", states.len());
    assert!(listed * 2 >= states.len(), "{listed} listed in full");
}

#[test]
fn a_cp_json_is_a_fraction_of_the_kernel_models_own_serde() {
    // What `cpJson` saves over storing the kernel's model as its serde
    // writes it, on the larger random states: on 2026-10-08, 210 kB against
    // 1.4 MB.
    let (mut fold, mut serde) = (0, 0);
    for (_, state) in random_states(0x5eed_0000..0x5eed_0040, 12, 64) {
        if state.faces().len() < 16 {
            continue;
        }
        let model = load(
            CpFormat::Fold,
            send_to_edit_text(&state, None)
                .unwrap_or_default()
                .as_bytes(),
        )
        .unwrap_or_else(|e| panic!("{e}"));
        fold += cp_json(&model).unwrap_or_default().len();
        serde += serde_json::to_string(&model).unwrap_or_default().len();
    }
    eprintln!("cpJson {fold} B, the model's serde {serde} B");
    assert!(fold > 0 && fold * 4 < serde, "{fold} against {serde}");
}

// --- The golden: one pattern through `.cp` and `.fold` -----------------------

/// tan 22.5°: where the kite's valleys from the lower-left corner meet the
/// right and top edges.
fn t() -> f64 {
    22.5f64.to_radians().tan()
}

/// The kite base without its diagonal precrease, as Oriedita writes a `.cp`:
/// on its default paper (±200, y down, so the lower-left corner is
/// (−200, 200)); `1` border, `3` valley.
fn kite_cp() -> String {
    let t = t();
    [
        "1 -200 -200 200 -200".to_string(),
        "1 200 -200 200 200".to_string(),
        "1 200 200 -200 200".to_string(),
        "1 -200 200 -200 -200".to_string(),
        format!("3 -200 200 200 {}", 200.0 - 400.0 * t),
        format!("3 -200 200 {} -200", -200.0 + 400.0 * t),
    ]
    .join("\n")
}

/// The same kite as a FOLD file on the unit square, y down as Edit reads
/// FOLD, its edges in another order.
fn kite_fold() -> String {
    let t = t();
    json!({
        "file_spec": 1.1,
        "vertices_coords": [[0, 0], [1, 0], [1, 1], [0, 1], [1, 1.0 - t], [t, 0]],
        "edges_vertices": [[3, 4], [1, 4], [4, 2], [2, 3], [3, 0], [3, 5], [5, 1], [0, 5]],
        "edges_assignment": ["V", "B", "B", "B", "B", "V", "B", "B"]
    })
    .to_string()
}

/// An import into an empty sequence through the bridge, its first order
/// picked.
fn import_empty(format: CpFormat, text: &str, start: StartSide) -> (Bridge, Landed, Opened) {
    import_file(CpFile::of(format), text, start)
}

/// [`import_empty`] of a file described in full.
fn import_file(file: CpFile, text: &str, start: StartSide) -> (Bridge, Landed, Opened) {
    let format = file.format;
    let mut bridge = Bridge::new();
    let mut imports = Imports::new();
    let opened = match imports.open(
        &bridge,
        file,
        text.as_bytes(),
        Target::Empty { start_side: start },
        &Limits::default(),
    ) {
        Ok(Outcome::Ok(opened)) => opened,
        other => panic!("{format:?}: {other:?}"),
    };
    let choice = vec![0; opened.components.len()];
    let landed = match imports.pick(&mut bridge, opened.import, &choice) {
        Ok(Outcome::Ok(landed)) => landed,
        other => panic!("{format:?} pick: {other:?}"),
    };
    (bridge, landed, opened)
}

#[test]
fn an_import_reads_the_same_pattern_from_cp_and_fold_with_its_letters_and_sides() {
    let t = t();
    for start in [StartSide::Front, StartSide::Back] {
        let (cp_bridge, cp, opened) = import_empty(CpFormat::Cp, &kite_cp(), start);
        let (fold_bridge, fold, _) = import_empty(CpFormat::Fold, &kite_fold(), start);
        assert_eq!(json_of(&opened.paper), json!({ "kind": "square" }));
        assert_eq!((opened.count.orders, opened.count.exact), (1, true));
        assert_eq!((opened.summary.faces, opened.summary.valleys), (3, 2));

        let state = cp_bridge.state(cp.state).unwrap_or_else(|e| panic!("{e}"));
        let from_fold = fold_bridge
            .state(fold.state)
            .unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(keys(state), keys(from_fold), "{start:?}");
        assert_eq!(state.view().flipped, start == StartSide::Back);

        // The valleys where the files draw them, from the lower-left corner:
        // the picture as drawn. A mirrored import would find no crease here.
        for mid in [[0.5, t / 2.0], [t / 2.0, 0.5]] {
            let crease = state
                .crease_at(mid)
                .unwrap_or_else(|| panic!("no crease at {mid:?}"));
            assert_eq!(crease.kind, CreaseKind::Folded(Letter::Valley), "{mid:?}");
        }
        // A valley, seen from the pattern's front, folds the flaps toward
        // that viewer: each lies on the kite showing its back.
        let face = |p: Point| state.face_at(p).unwrap_or_else(|| panic!("{p:?}"));
        let kite = face([0.5, 0.5]);
        assert_eq!(state.front_up(kite), Some(true), "the root keeps the front");
        for flap in [face([0.9, 0.1]), face([0.1, 0.9])] {
            assert_eq!(state.front_up(flap), Some(false));
            assert_eq!(state.above(flap, kite), Some(true));
        }
    }
}

// --- The samples -------------------------------------------------------------

fn samples() -> Vec<(String, String)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/fold-samples");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "fold"))
        .collect();
    files.sort();
    files
        .iter()
        .map(|f| {
            let name = f
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            (name, std::fs::read_to_string(f).unwrap_or_default())
        })
        .collect()
}

#[test]
fn every_sample_imports_to_its_one_order() {
    let samples = samples();
    let names: Vec<&str> = samples.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(
        names,
        ["pleat-in-eighths", "preliminary-base", "waterbomb-base"]
    );
    for (name, text) in &samples {
        let fold: Value = serde_json::from_str(text).unwrap_or_else(|e| panic!("{name}: {e}"));
        for key in [
            "file_title",
            "file_author",
            "file_creator",
            "file_description",
        ] {
            assert!(fold[key].is_string(), "{name}: no {key}");
        }
        let sample = CpFile {
            format: CpFormat::Fold,
            sample: true,
        };
        let (bridge, landed, opened) = import_file(sample, text, StartSide::Front);
        let JumpOp::CpJump(op) = &landed.op;
        assert_eq!(op.origin, CpOrigin::Sample, "{name}");
        // Their letters decide one order (the spike's bases have 18 without).
        assert_eq!(
            (opened.count.orders, opened.count.exact),
            (1, true),
            "{name}"
        );
        assert_eq!(opened.summary.unknown_letters, 0, "{name}");
        assert_eq!(
            json_of(&opened.paper),
            json!({ "kind": "square" }),
            "{name}"
        );
        let state = bridge.state(landed.state).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(state.faces().len(), 8, "{name}");
        let flats = state
            .creases()
            .iter()
            .filter(|c| matches!(c.kind, CreaseKind::Flat(_)))
            .count();
        let precreases = if name == "pleat-in-eighths" { 0 } else { 2 };
        assert_eq!(flats, precreases, "{name}: the precreases");
    }
}

/// An import's step summary is the pattern it brings — its letters, no diff,
/// no layers — and needs no parent: a pick into an empty sequence lands it
/// after a sheet it has already let go, and one after a state outlives that
/// state.
#[test]
fn an_import_summarises_as_its_pattern_without_its_parent() {
    let expect_pattern = |bridge: &Bridge, state: u32, name: &str| {
        let summarised = match bridge.step_summary(state) {
            Ok(Outcome::Ok(summarised)) => json_of(&summarised),
            other => panic!("{name}: {other:?}"),
        };
        let held = bridge.state(state).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(
            summarised["summary"],
            json!({
                "counts": json_of(&held.crease_counts()),
                "diff": { "added": [], "reversed": [], "unfolded": [], "refolded": [] },
                "layers": null,
            }),
            "{name}"
        );
        assert!(
            summarised["summary"]["counts"]["valley"].as_u64() > Some(0),
            "{name}: its own creases"
        );
        let acted = match bridge.step_action(state) {
            Ok(Outcome::Ok(acted)) => json_of(&acted),
            other => panic!("{name}: {other:?}"),
        };
        assert_eq!(acted["action"], Value::Null, "{name}");
    };

    for (name, text) in samples() {
        let sample = CpFile {
            format: CpFormat::Fold,
            sample: true,
        };
        let (bridge, landed, _) = import_file(sample, &text, StartSide::Front);
        // The sheet the pick landed it after is gone already.
        assert_eq!(bridge.len(), 1, "{name}");
        expect_pattern(&bridge, landed.state, &name);
    }

    let mut bridge = Bridge::new();
    let flat = square(&mut bridge);
    let mut imports = Imports::new();
    let Ok(Outcome::Ok(opened)) = imports.open(
        &bridge,
        CpFile::of(CpFormat::Fold),
        kite_fold().as_bytes(),
        Target::After { state: flat },
        &Limits::default(),
    ) else {
        panic!("open");
    };
    let choice = vec![0; opened.components.len()];
    let Ok(Outcome::Ok(picked)) = imports.pick(&mut bridge, opened.import, &choice) else {
        panic!("pick");
    };
    assert!(bridge.release(flat));
    expect_pattern(&bridge, picked.state, "kite after a released sheet");
}

// --- Opening and picking through the bridge ----------------------------------

fn paper(value: Value) -> Paper {
    serde_json::from_value(value).unwrap_or_else(|e| panic!("paper: {e}"))
}

fn sheet(bridge: &mut Bridge, value: Value) -> u32 {
    match bridge.sheet(&paper(value)) {
        Outcome::Ok(made) => made.state,
        Outcome::Refused(r) => panic!("{:?}", r.refusal),
    }
}

fn square(bridge: &mut Bridge) -> u32 {
    sheet(bridge, json!({ "shape": { "kind": "square" } }))
}

fn apply(bridge: &mut Bridge, state: u32, op: Value) -> Outcome<u32> {
    let op: Op = serde_json::from_value(op).unwrap_or_else(|e| panic!("op: {e}"));
    match bridge.apply(state, &op, &Choices::default()) {
        Ok(Outcome::Ok(applied)) => Outcome::Ok(applied.state),
        Ok(Outcome::Refused(r)) => Outcome::Refused(r),
        Err(e) => panic!("{e}"),
    }
}

fn landed(outcome: Outcome<u32>) -> u32 {
    match outcome {
        Outcome::Ok(state) => state,
        Outcome::Refused(r) => panic!("refused: {}", json_of(&r.refusal)),
    }
}

fn refusal(outcome: Outcome<u32>) -> Value {
    match outcome {
        Outcome::Refused(r) => json_of(&r.refusal),
        Outcome::Ok(state) => panic!("landed {state}"),
    }
}

fn held_keys(bridge: &Bridge, state: u32) -> BTreeSet<String> {
    keys(bridge.state(state).unwrap_or_else(|e| panic!("{e}")))
}

/// The book fold, then the half folded again: four layers.
fn four_layers(bridge: &mut Bridge) -> u32 {
    let sheet = square(bridge);
    let book = landed(apply(
        bridge,
        sheet,
        json!({
            "kind": "valley",
            "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] },
            "moving": [0.75, 0.5], "seed": { "scope": "all" }
        }),
    ));
    landed(apply(
        bridge,
        book,
        json!({
            "kind": "mountain",
            "line": { "via": "free", "through": [[0.0, 0.5], [0.5, 0.5]] },
            "moving": [0.25, 0.75], "seed": { "scope": "all" }
        }),
    ))
}

/// Every choice of a completion's components, in odometer order.
fn every_choice(sizes: &[usize]) -> Vec<Vec<usize>> {
    let mut out = vec![Vec::new()];
    for &n in sizes {
        out = out
            .into_iter()
            .flat_map(|prefix| {
                (0..n).map(move |k| {
                    let mut c = prefix.clone();
                    c.push(k);
                    c
                })
            })
            .collect();
    }
    out
}

/// Send `state` to Edit and open the file after it: every order the
/// letters allow, each picked and landed as a step, exactly one of them the
/// state that was sent, and each op landing its state again from the parent.
/// Returns the import and the components' sizes.
fn assert_offers_itself(
    bridge: &mut Bridge,
    imports: &mut Imports,
    state: u32,
) -> (u32, Vec<usize>) {
    let text = send_to_edit(bridge, state, None).unwrap_or_default();
    let opened = match imports.open(
        bridge,
        CpFile::of(CpFormat::Fold),
        text.as_bytes(),
        Target::After { state },
        &Limits::default(),
    ) {
        Ok(Outcome::Ok(opened)) => opened,
        other => panic!("{other:?}"),
    };
    assert_eq!(
        opened.paper, None,
        "after a state the sheet is the sequence's"
    );
    let sizes: Vec<usize> = opened.components.iter().map(|c| c.orders).collect();
    let want = held_keys(bridge, state);
    let step = bridge.summary(state).map(|s| s.step).unwrap_or_default();
    let choices = every_choice(&sizes);
    assert!(opened.count.exact);
    assert_eq!(choices.len() as u64, opened.count.orders);
    let mut same = 0;
    for choice in &choices {
        let picked = match imports.pick(bridge, opened.import, choice) {
            Ok(Outcome::Ok(picked)) => picked,
            other => panic!("pick {choice:?}: {other:?}"),
        };
        let JumpOp::CpJump(op) = &picked.op;
        assert_eq!(op.origin, CpOrigin::Fold);
        assert_eq!(
            picked.summary.step,
            step + 1,
            "the jump is a step after its parent"
        );
        let picked_keys = held_keys(bridge, picked.state);
        same += usize::from(picked_keys == want);
        let replayed = landed(apply(bridge, state, json_of(&picked.op)));
        assert_eq!(held_keys(bridge, replayed), picked_keys);
    }
    assert_eq!(same, 1, "{} orders", choices.len());
    (opened.import, sizes)
}

#[test]
fn opening_after_a_state_offers_its_order_and_a_pick_lands_it() {
    let mut bridge = Bridge::new();
    let mut imports = Imports::new();
    let state = four_layers(&mut bridge);
    let text = send_to_edit(&bridge, state, Some("Four layers")).unwrap_or_default();
    assert!(text.contains("\"Four layers\""), "the title: {text}");
    // The four layers' letters decide their order.
    let (import, sizes) = assert_offers_itself(&mut bridge, &mut imports, state);
    assert!(sizes.is_empty());
    assert_eq!(imports.len(), 1);

    // A state whose letters leave a choice: the first such seeded one.
    let (name, several) = random_states(0xf16_0000..0xf16_0030, 6, 24)
        .into_iter()
        .find(|(_, s)| {
            let count = completions(s).count();
            count.exact && (3..=24).contains(&count.orders)
        })
        .unwrap_or_else(|| panic!("no state leaves a choice"));
    let held = hold(&mut bridge, &several);
    let (_, sizes) = assert_offers_itself(&mut bridge, &mut imports, held);
    assert!(sizes.iter().product::<usize>() >= 3, "{name}: {sizes:?}");

    // A caller's mistakes are thrown: a choice that names no order, an
    // import or a state that is not held.
    let code = |error: Option<IoCallError>| error.map(|e| e.code());
    assert_eq!(
        code(imports.pick(&mut bridge, import, &[0]).err()),
        Some("invalid_input")
    );
    assert_eq!(
        code(imports.pick(&mut bridge, import + 2, &[]).err()),
        Some("unknown_import")
    );
    let unknown = imports.open(
        &bridge,
        CpFile::of(CpFormat::Fold),
        text.as_bytes(),
        Target::After { state: 999 },
        &Limits::default(),
    );
    assert_eq!(code(unknown.err()), Some("unknown_state"));
    assert_eq!(imports.len(), 2);
    assert!(imports.release(import));
    assert!(!imports.release(import));
    imports.clear();
    assert!(imports.is_empty());
}

#[test]
fn an_empty_sequence_adopts_the_patterns_sheet_and_the_pick_replays_from_it() {
    // A 2 : 1 rectangle with a valley across its middle.
    let fold = json!({
        "vertices_coords": [[0, 0], [2, 0], [2, 1], [0, 1], [1, 0], [1, 1]],
        "edges_vertices": [[0, 4], [4, 1], [1, 2], [2, 5], [5, 3], [3, 0], [4, 5]],
        "edges_assignment": ["B", "B", "B", "B", "B", "B", "V"]
    })
    .to_string();
    let (mut bridge, picked, opened) = import_empty(CpFormat::Fold, &fold, StartSide::Back);
    let adopted = json_of(&opened.paper);
    assert_eq!(
        adopted,
        json!({ "kind": "rectangle", "aspect": [1.0, 0.5] })
    );
    assert_eq!(picked.summary.step, 1);
    assert!(picked.summary.view.flipped);
    assert_eq!(
        bridge.len(),
        1,
        "the sheet the step was landed from is released"
    );

    // The document stores the adopted paper, and a replay lands the step
    // from its flat sheet.
    let flat = sheet(
        &mut bridge,
        json!({ "shape": adopted, "startSide": "back" }),
    );
    let replayed = landed(apply(&mut bridge, flat, json_of(&picked.op)));
    assert_eq!(
        held_keys(&bridge, replayed),
        held_keys(&bridge, picked.state)
    );

    // After a square sheet the same op no longer fits: the step is broken.
    let other = sheet(
        &mut bridge,
        json!({ "shape": { "kind": "square" }, "startSide": "back" }),
    );
    let broken = refusal(apply(&mut bridge, other, json_of(&picked.op)));
    assert_eq!(broken["code"], "import_shape_mismatch", "{broken}");
}

/// A square creased with a plus, neither crease's letter known: an import
/// whose order needs a search.
fn plus_unknown() -> String {
    json!({
        "vertices_coords": [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5], [0.5, 0.5]],
        "edges_vertices": [[0, 4], [4, 1], [1, 5], [5, 2], [2, 6], [6, 3], [3, 7], [7, 0],
            [4, 8], [8, 6], [7, 8], [8, 5]],
        "edges_assignment": ["B", "B", "B", "B", "B", "B", "B", "B", "U", "U", "U", "U"]
    })
    .to_string()
}

#[test]
fn imports_that_cannot_land_are_refusals_with_import_codes() {
    let mut bridge = Bridge::new();
    let mut imports = Imports::new();
    let flat = square(&mut bridge);
    let after = Target::After { state: flat };
    let limits = Limits::default();
    let refused =
        |imports: &mut Imports, format, text: &[u8], target, limits: &Limits| match imports.open(
            &bridge,
            CpFile::of(format),
            text,
            target,
            limits,
        ) {
            Ok(Outcome::Refused(r)) => json_of(&r.refusal),
            other => panic!("{other:?}"),
        };

    // Unreadable, a folded form, no border.
    assert_eq!(
        refused(&mut imports, CpFormat::Cp, b"1 2 3", after, &limits),
        json!({ "code": "import_unreadable", "format": "cp" })
    );
    let folded = json!({
        "frame_classes": ["foldedForm"],
        "vertices_coords": [[0, 0], [1, 0]], "edges_vertices": [[0, 1]]
    })
    .to_string();
    let code = refused(
        &mut imports,
        CpFormat::Fold,
        folded.as_bytes(),
        after,
        &limits,
    );
    assert_eq!(code, json!({ "code": "import_folded_form" }));
    let code = refused(&mut imports, CpFormat::Cp, b"2 0 0 1 1", after, &limits);
    assert_eq!(code["code"], "import_no_border");

    // A rectangle after a square sheet; anything after a polygon sheet.
    let rectangle = b"1 0 0 2 0\n1 2 0 2 1\n1 2 1 0 1\n1 0 1 0 0\n";
    let code = refused(&mut imports, CpFormat::Cp, rectangle, after, &limits);
    assert_eq!(code["code"], "import_shape_mismatch");
    let hexagon = sheet(
        &mut bridge,
        json!({ "shape": { "kind": "polygon", "points": [
            [0.5, 0.0], [1.0, 0.25], [1.0, 0.75], [0.5, 1.0], [0.0, 0.75], [0.0, 0.25]
        ] } }),
    );
    let mut refused = |format, text: &[u8], target, limits: &Limits| match imports.open(
        &bridge,
        CpFile::of(format),
        text,
        target,
        limits,
    ) {
        Ok(Outcome::Refused(r)) => json_of(&r.refusal),
        other => panic!("{other:?}"),
    };
    let code = refused(
        CpFormat::Cp,
        rectangle,
        Target::After { state: hexagon },
        &limits,
    );
    assert_eq!(code["code"], "import_shape_unsupported");
    assert_eq!(code["which"], json!({ "source": "sequence" }));

    // A search that needs more than its budget.
    let tight = Limits {
        per_component: None,
        max_nodes: Some(0),
    };
    let code = refused(CpFormat::Fold, plus_unknown().as_bytes(), after, &tight);
    assert_eq!(code["code"], "import_budget_exceeded", "{code}");
    assert!(imports.is_empty(), "no refusal holds an import");

    // Within the budget the same pattern lists every order.
    let Ok(Outcome::Ok(opened)) = imports.open(
        &bridge,
        CpFile::of(CpFormat::Fold),
        plus_unknown().as_bytes(),
        after,
        &limits,
    ) else {
        panic!("open");
    };
    assert_eq!(opened.summary.unknown_letters, 4);
    assert!(opened.count.exact && opened.count.orders > 1, "{opened:?}");
}

#[test]
fn a_stored_import_whose_witnesses_no_longer_resolve_is_broken() {
    let mut bridge = Bridge::new();
    let flat = square(&mut bridge);
    let mut imports = Imports::new();
    let Ok(Outcome::Ok(opened)) = imports.open(
        &bridge,
        CpFile::of(CpFormat::Fold),
        plus_unknown().as_bytes(),
        Target::After { state: flat },
        &Limits::default(),
    ) else {
        panic!("open");
    };
    let choice = vec![0; opened.components.len()];
    let Ok(Outcome::Ok(picked)) = imports.pick(&mut bridge, opened.import, &choice) else {
        panic!("pick");
    };
    let JumpOp::CpJump(stored) = picked.op;
    let op = |cp_json: &str, order_json: &str| json!({ "kind": "cp-jump", "cpJson": cp_json, "orderJson": order_json, "origin": "fold" });
    landed(apply(
        &mut bridge,
        flat,
        op(&stored.cp_json, &stored.order_json),
    ));

    // Two witnesses in one face; one off the paper.
    let mut order: Value = serde_json::from_str(&stored.order_json).unwrap_or_default();
    order["faces"][1] = order["faces"][0].clone();
    let broken = refusal(apply(
        &mut bridge,
        flat,
        op(&stored.cp_json, &order.to_string()),
    ));
    assert_eq!(broken["code"], "import_order_broken");
    assert_eq!(broken["broken"]["broken"], "witness");
    assert_eq!(broken["broken"]["witness"]["cause"], "shared_face");
    order["faces"][1] = json!([3.0, 3.0]);
    let broken = refusal(apply(
        &mut bridge,
        flat,
        op(&stored.cp_json, &order.to_string()),
    ));
    assert_eq!(broken["broken"]["witness"]["cause"], "no_face");
    // No stored pairs: the unknown letters leave the order open.
    let open = json!({ "faces": [], "orders": [] }).to_string();
    let broken = refusal(apply(&mut bridge, flat, op(&stored.cp_json, &open)));
    assert_eq!(broken["broken"]["broken"], "not_unique", "{broken}");
    // Text that no longer reads.
    let unreadable = refusal(apply(&mut bridge, flat, op("[1, 2", &stored.order_json)));
    assert_eq!(
        unreadable,
        json!({ "code": "import_stored_unreadable", "field": "cp_json" })
    );
    // A jump moves no paper to analyse.
    let jump: Op = serde_json::from_value(op(&stored.cp_json, &stored.order_json))
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(
        bridge
            .analyse(flat, &jump, &Choices::default())
            .err()
            .map(|e| e.code()),
        Some("invalid_input")
    );
}

// --- Edit's folded figure ----------------------------------------------------

/// Edit's folded figure of `state`'s crease pattern: folded by the kernel
/// from the folding colours as Edit folds them, starting at face 1, its
/// paper scene from `pass`.
fn edit_figure(state: &State, pass: FoldedFigureState) -> Option<FoldedPaperScene> {
    let folding: Vec<LineSegment> = fold_cp_to_model(state)
        .line_segments
        .into_iter()
        .filter(|s| s.color.is_folding_line())
        .collect();
    let model = FoldedFigureModel {
        state: pass,
        ..FoldedFigureModel::default()
    };
    folded_figure_paper_scene_from_segments(&folding, &[], 1, &model)
        .unwrap_or_else(|e| panic!("{e:?}"))
}

/// `state`'s crease pattern and order held in `bridge` as a sequence's
/// step: its sheet, then the `cp-jump` Send to Edit and Import CP make.
fn hold(bridge: &mut Bridge, state: &State) -> u32 {
    let [x0, y0, x1, y1] = convex::bounding_box(state.sheet().outline());
    let (w, h) = (x1 - x0, y1 - y0);
    let shape = if (w - h).abs() < 1e-12 {
        json!({ "kind": "square" })
    } else {
        json!({ "kind": "rectangle", "aspect": [w, h] })
    };
    let flat = sheet(bridge, json!({ "shape": shape }));
    let op = json!({
        "kind": "cp-jump",
        "cpJson": sent(state),
        "orderJson": jump::order_json(state).unwrap_or_default(),
        "origin": "fold"
    });
    landed(apply(bridge, flat, op))
}

/// The crease keys: every crease where it is, with its letter.
fn creases(keys: &BTreeSet<String>) -> BTreeSet<&String> {
    keys.iter().filter(|k| k.starts_with("c:")).collect()
}

#[test]
fn edits_folded_figure_imports_as_the_state_it_was_folded_from() {
    // States without a precrease (Edit folds only the folding colours, so a
    // precrease would join faces) on square and rectangular sheets: the
    // classics' and seeded random ones. Each is held as a step, and Edit's
    // figure of its crease pattern imported after it, from the front pass
    // and the rear: the same state either way, with the same letters, and
    // the held state itself whenever the letters leave one order. On
    // 2026-10-08: 114 figures, 86 of them with one order.
    let mut candidates: Vec<(String, State)> = classic_paths()
        .into_iter()
        .flat_map(|(name, path)| path.into_iter().map(move |s| (name.clone(), s)))
        .collect();
    candidates.extend(random_states(0xf16_0000..0xf16_0030, 6, 24));
    let (mut figures, mut identical) = (0, 0);
    for (name, state) in candidates {
        let precreased = state
            .creases()
            .iter()
            .any(|c| matches!(c.kind, CreaseKind::Flat(_)));
        if precreased || !rectangular(&state) || state.faces().len() < 2 {
            continue;
        }
        let mut bridge = Bridge::new();
        let parent = hold(&mut bridge, &state);
        let want = held_keys(&bridge, parent);
        let unique = completions(&state).is_unique();
        let mut passes = Vec::new();
        for pass in [FoldedFigureState::Front0, FoldedFigureState::Back1] {
            let scene =
                edit_figure(&state, pass).unwrap_or_else(|| panic!("{name}: Edit finds no figure"));
            let target = Target::After { state: parent };
            let landed = match import_figure(&mut bridge, &scene, target, &Limits::default()) {
                Ok(Outcome::Ok(landed)) => landed,
                other => panic!("{name} {pass:?}: {other:?}"),
            };
            let JumpOp::CpJump(op) = &landed.op;
            assert_eq!(op.origin, CpOrigin::EditFoldedFigure);
            let got = held_keys(&bridge, landed.state);
            assert_eq!(
                creases(&got),
                creases(&want),
                "{name} {pass:?}: the letters"
            );
            if unique {
                assert_eq!(got, want, "{name} {pass:?}");
            }
            passes.push(got);
        }
        assert_eq!(passes[0], passes[1], "{name}: the passes agree");
        figures += 1;
        identical += usize::from(unique);
    }
    eprintln!("{figures} figures, {identical} with one order");
    assert!(figures >= 15, "only {figures} figures");
    assert!(identical >= 5, "only {identical} with one order");
}

// --- Export -------------------------------------------------------------------

#[test]
fn a_path_exports_as_one_fold_file_with_a_frame_per_state() {
    let mut bridge = Bridge::new();
    let flat = square(&mut bridge);
    let state = four_layers(&mut bridge);
    let Ok(Outcome::Ok(exported)) = export_fold(&bridge, &[flat, state], Some("Two steps")) else {
        panic!("export");
    };
    let fold: Value = serde_json::from_str(&exported.text).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(fold["file_title"], "Two steps");
    assert_eq!(fold["file_frames"].as_array().map(Vec::len), Some(2));
    // The root is the last state's crease pattern, which Edit opens.
    let root = load(CpFormat::Fold, exported.text.as_bytes()).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(
        root.line_segments.len(),
        fold_cp_to_model(bridge.state(state).unwrap_or_else(|e| panic!("{e}")))
            .line_segments
            .len()
    );

    let code = |error: Option<IoCallError>| error.map(|e| e.code());
    assert_eq!(
        code(export_fold(&bridge, &[], None).err()),
        Some("invalid_input")
    );
    assert_eq!(
        code(export_fold(&bridge, &[flat, 77], None).err()),
        Some("unknown_state")
    );
    assert_eq!(
        code(send_to_edit(&bridge, 77, None).err()),
        Some("unknown_state")
    );
}

/// A FOLD file of `corners` as its border, and `creases` (a, b, assignment) besides.
fn fold_file(corners: &[Point], creases: &[(Point, Point, &str)]) -> Vec<u8> {
    let mut vertices: Vec<Point> = corners.to_vec();
    let mut edges: Vec<[usize; 2]> = (0..corners.len())
        .map(|i| [i, (i + 1) % corners.len()])
        .collect();
    let mut assignments: Vec<&str> = vec!["B"; corners.len()];
    for &(a, b, assignment) in creases {
        vertices.push(a);
        vertices.push(b);
        edges.push([vertices.len() - 2, vertices.len() - 1]);
        assignments.push(assignment);
    }
    json!({
        "file_spec": 1.1,
        "frame_classes": ["creasePattern"],
        "vertices_coords": vertices,
        "edges_vertices": edges,
        "edges_assignment": assignments,
    })
    .to_string()
    .into_bytes()
}

#[test]
fn import_sheet_gives_the_border_whatever_the_creases() {
    let fold = CpFile::of(CpFormat::Fold);
    let sheet = |bytes: &[u8]| json_of(&oristudio_fold_wasm::io::starting_sheet(fold, bytes));
    // A square with a crease no fold could make: the sheet all the same.
    let square = fold_file(
        &[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        &[([0.2, 0.2], [0.3, 0.9], "M")],
    );
    assert_eq!(
        sheet(&square),
        json!({ "status": "ok", "sheet": { "shape": "square" } })
    );
    // A hexagon: a polygon, counter-clockwise in the unit frame.
    let h = 3f64.sqrt() / 2.0;
    let hexagon = fold_file(
        &[
            [-1.0, 0.0],
            [-0.5, -h],
            [0.5, -h],
            [1.0, 0.0],
            [0.5, h],
            [-0.5, h],
        ],
        &[],
    );
    let found = sheet(&hexagon);
    assert_eq!(found["status"], "ok");
    assert_eq!(found["sheet"]["shape"], "polygon");
    let points: Vec<Point> =
        serde_json::from_value(found["sheet"]["points"].clone()).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(points.len(), 6);
    assert!(convex::signed_area(&points) > 0.0);
    // An L is no sheet the engine folds; a file that does not read is no pattern.
    let ell = fold_file(
        &[
            [0.0, 0.0],
            [2.0, 0.0],
            [2.0, 1.0],
            [1.0, 1.0],
            [1.0, 2.0],
            [0.0, 2.0],
        ],
        &[],
    );
    assert_eq!(sheet(&ell)["refusal"]["code"], "sheet_not_convex");
    assert_eq!(
        sheet(b"not a fold file")["refusal"]["code"],
        "import_unreadable"
    );
}
