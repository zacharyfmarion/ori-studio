//! Fold's Import CP choosing its order in the Layer order dialog, natively
//! (`implementation-plans/layer-order-dialog.md`, row H10): a held import
//! opened onto the dialog's faces (`Imports::layer_opening`), the dialog's
//! session on them (`LayerSessions`, as its worker holds it), and the order
//! its Apply chose landed back (`Imports::pick_layer_order`).
//!
//! What holds, on kabuto and `solution_sample_1`, from either start side:
//!
//! - the dialog opens on the import's default order, held whole, so an Apply
//!   that changed nothing is the import's default pick, state for state;
//! - every layer order the dialog steps through lands as a state whose order
//!   is that order, pair for pair, and the state the existing route by paper
//!   points (`ImportedPattern::from_oriedita`, Start from Edit's figure)
//!   makes of it;
//! - those orders are exactly the orders the import's own chooser lists;
//! - a pick that is not the dialog's is a caller's mistake, and relations
//!   that clash with the creases are a refusal that lands nothing;
//! - an import whose faces are not Edit's says so, and keeps its chooser.
//!
//! With `H10_IMPORT_CORPUS_DIR` set, every `<case>/truth.fold` under it (the
//! cpoogle layout) that imports with more than one order is opened onto the
//! dialog, the dialog's session opened on it, and its untouched Apply landed:
//! one row per case (the opening's time, whether the dialog held the default
//! order whole, whether the Apply landed the default pick), then a summary.
//! Run it in release:
//!
//! ```sh
//! H10_IMPORT_CORPUS_DIR=/path/to/cpoogle \
//!   cargo test -p oristudio-fold-wasm --release --test import_layer_order -- --nocapture corpus
//! ```
#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeSet;
use std::time::Instant;

use oristudio_cp::folding::HierarchyRelation;
use oristudio_fold::complete::CompletionLimits;
use oristudio_fold::steer::{ImportedFaces, LayerSource, StepBy, StepDirection, ViewSide};
use oristudio_fold::{ImportTarget, ImportedPattern, Sheet, StartSide, State};
use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::canonical::canonical_keys;
use oristudio_fold_wasm::io::kernel::input_of_cp_json;
use oristudio_fold_wasm::io::{
    CpFile, CpFormat, Imports, IoCallError, JumpOp, Landed, LayerOpening, Limits, Opened, Target,
};
use oristudio_fold_wasm::steer::{
    LayerLimits, LayerSessions, LayerSolutionCaps, OpenedOnWire, Opening, Stepping,
};
use oristudio_fold_wasm::wire::Outcome;
use serde_json::json;

fn repo(relative: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

const KABUTO: &str = "tests/fixtures/flat-folder/kabuto.fold";
const SAMPLE_1: &str = "tests/fixtures/oriedita/solution_sample_1.cp";

fn file_of(relative: &str) -> (CpFile, Vec<u8>) {
    let bytes = std::fs::read(repo(relative)).unwrap_or_else(|e| panic!("{relative}: {e}"));
    let format = if relative.ends_with(".fold") {
        CpFormat::Fold
    } else {
        CpFormat::Cp
    };
    (CpFile::of(format), bytes)
}

fn keys(state: &State) -> BTreeSet<String> {
    canonical_keys(state).into_iter().collect()
}

/// An import of `relative` into an empty sequence started from `start`.
struct Imported {
    bridge: Bridge,
    imports: Imports,
    opened: Opened,
}

fn import(relative: &str, start: StartSide) -> Imported {
    let (file, bytes) = file_of(relative);
    let bridge = Bridge::new();
    let mut imports = Imports::new();
    let opened = match imports.open(
        &bridge,
        file,
        &bytes,
        Target::Empty { start_side: start },
        &Limits::default(),
    ) {
        Ok(Outcome::Ok(opened)) => opened,
        other => panic!("{relative}: {other:?}"),
    };
    Imported {
        bridge,
        imports,
        opened,
    }
}

impl Imported {
    fn first_choice(&self) -> Vec<usize> {
        vec![0; self.opened.components.len()]
    }

    fn opening(&mut self) -> LayerOpening {
        let choice = self.first_choice();
        match self.imports.layer_opening(self.opened.import, &choice) {
            Ok(Outcome::Ok(opening)) => opening,
            other => panic!("{other:?}"),
        }
    }

    fn pick(&mut self, choice: &[usize]) -> Landed {
        match self
            .imports
            .pick(&mut self.bridge, self.opened.import, choice)
        {
            Ok(Outcome::Ok(landed)) => landed,
            other => panic!("{other:?}"),
        }
    }

    fn pick_layer_order(&mut self, digest: &str, relations: &[u32]) -> Outcome<Landed> {
        self.imports
            .pick_layer_order(&mut self.bridge, self.opened.import, digest, relations)
            .unwrap_or_else(|e| panic!("{}: {e}", e.code()))
    }

    fn state(&self, landed: &Landed) -> &State {
        self.bridge.state(landed.state).expect("held")
    }

    /// The `cpJson` the import stores, from a landed step.
    fn cp_json(landed: &Landed) -> String {
        let JumpOp::CpJump(jump) = &landed.op;
        jump.cp_json.clone()
    }
}

/// The import's pattern as the bridge made it for an empty sequence: after
/// the flat sheet it adopts (`imports.rs`'s `import`).
fn pattern_of(cp_json: &str, start: StartSide) -> ImportedPattern {
    let input = input_of_cp_json(cp_json).expect("cpJson");
    let found = ImportedPattern::new(&input, ImportTarget::Empty { start }).expect("import");
    let flat = Sheet::new(&found.summary().shape)
        .and_then(|sheet| State::flat(sheet, start))
        .expect("flat sheet");
    ImportedPattern::new(&input, ImportTarget::After(&flat)).expect("import after the sheet")
}

fn flat(relations: &[HierarchyRelation]) -> Vec<u32> {
    relations
        .iter()
        .flat_map(|r| [r.upper_face as u32, r.lower_face as u32])
        .collect()
}

fn pair_set(relations: &[u32]) -> BTreeSet<(u32, u32)> {
    relations.chunks_exact(2).map(|p| (p[0], p[1])).collect()
}

fn generous() -> LayerLimits {
    LayerLimits::default()
}

/// Every layer order the dialog's stepper reaches with X-ray on (decision
/// D5), from the one it opened on: its relations, each once.
fn every_dialog_order(layers: &mut LayerSessions, session: u32) -> Vec<Vec<u32>> {
    let cursor = layers
        .solutions_start(session, &LayerSolutionCaps::default())
        .expect("cursor");
    loop {
        let count = layers
            .solutions_advance(session, cursor, &generous())
            .expect("count");
        if count.done {
            break;
        }
    }
    let mut orders = vec![layers.oriedita_relations(session).expect("relations")];
    for direction in [StepDirection::Previous, StepDirection::Next] {
        loop {
            match layers
                .step(session, cursor, StepBy::LayerOrder, direction, &generous())
                .expect("step")
            {
                Stepping::Moved(_) => {
                    let relations = layers.oriedita_relations(session).expect("relations");
                    if !orders.contains(&relations) {
                        orders.push(relations);
                    }
                }
                Stepping::End => break,
                Stepping::TimedOut(out) => panic!("a step timed out: {out:?}"),
            }
        }
    }
    orders
}

/// Every order the import's own chooser lists, as the states they land.
fn every_chooser_state(imported: &mut Imported) -> BTreeSet<BTreeSet<String>> {
    assert!(imported.opened.count.exact, "the chooser lists every order");
    let sizes: Vec<usize> = imported
        .opened
        .components
        .iter()
        .map(|c| c.orders)
        .collect();
    let mut choices = vec![Vec::new()];
    for size in sizes {
        choices = choices
            .into_iter()
            .flat_map(|choice: Vec<usize>| {
                (0..size).map(move |k| {
                    let mut next = choice.clone();
                    next.push(k);
                    next
                })
            })
            .collect();
    }
    choices
        .iter()
        .map(|choice| {
            let landed = imported.pick(choice);
            keys(imported.state(&landed))
        })
        .collect()
}

#[test]
fn the_dialog_opens_on_the_imports_default_order_and_an_untouched_apply_is_that_pick() {
    for relative in [KABUTO, SAMPLE_1] {
        for start in [StartSide::Front, StartSide::Back] {
            let mut imported = import(relative, start);
            assert!(
                imported.opened.count.orders > 1,
                "{relative}: several orders to choose from"
            );
            let opening = imported.opening();
            assert_eq!(opening.source.starting_face_id, 1, "Edit's first face");
            assert!(!opening.shown.flipped, "the front pass");

            let mut layers = LayerSessions::new();
            let shown = flat(&oristudio_fold::steer::scene_relations(&opening.shown));
            let opened = match layers.open_showing(&opening.source, &shown, &generous()) {
                Ok(Opening::Opened(opened)) => opened,
                other => panic!("{relative}: {other:?}"),
            };
            assert_eq!(
                opened.opened_on,
                OpenedOnWire::Held { ignored: 0 },
                "{relative} {start:?}: held whole"
            );
            let relations = layers
                .oriedita_relations(opened.session)
                .expect("relations");
            assert_eq!(pair_set(&relations), pair_set(&shown), "{relative}");

            // `unchanged` imports the default pick; an Apply of the same
            // order through the dialog's relations lands the same state.
            let default = imported.pick(&imported.first_choice());
            let applied = match imported.pick_layer_order(&opening.source.digest, &relations) {
                Outcome::Ok(landed) => landed,
                Outcome::Refused(refusal) => panic!("{relative}: {refusal:?}"),
            };
            assert_eq!(
                keys(imported.state(&applied)),
                keys(imported.state(&default)),
                "{relative} {start:?}"
            );
            assert_eq!(
                applied.op, default.op,
                "{relative}: the same step, op for op"
            );
        }
    }
}

#[test]
fn every_order_the_dialog_reaches_lands_exactly_and_they_are_the_choosers_orders() {
    for relative in [KABUTO, SAMPLE_1] {
        for start in [StartSide::Front, StartSide::Back] {
            let mut imported = import(relative, start);
            let opening = imported.opening();
            let digest = opening.source.digest.clone();
            let layer = LayerSource::from_oriedita(&opening.source).expect("source");

            let mut layers = LayerSessions::new();
            let shown = flat(&oristudio_fold::steer::scene_relations(&opening.shown));
            let session = match layers.open_showing(&opening.source, &shown, &generous()) {
                Ok(Opening::Opened(opened)) => opened.session,
                other => panic!("{other:?}"),
            };
            let orders = every_dialog_order(&mut layers, session);
            assert_eq!(
                orders.len() as u64,
                imported.opened.count.orders,
                "{relative}: the dialog steps through as many orders as the import counts"
            );
            assert!(orders.len() > 1, "{relative}: the dialog steps");

            let mut landed_states = BTreeSet::new();
            for relations in &orders {
                let landed = match imported.pick_layer_order(&digest, relations) {
                    Outcome::Ok(landed) => landed,
                    Outcome::Refused(refusal) => panic!("{relative}: {refusal:?}"),
                };
                let state = imported.state(&landed).clone();

                // Pair for pair: the landed state's order, read back over
                // the dialog's faces, is the order the dialog chose.
                let pattern = pattern_of(&Imported::cp_json(&landed), start);
                let faces = ImportedFaces::of(&layer, &pattern).expect("faces match");
                let back = flat(&faces.oriedita_relations(&layer, &pattern, state.order()));
                assert_eq!(pair_set(&back), pair_set(relations), "{relative} {start:?}");

                // The same state as the route by paper points makes of it.
                let point = |k: u32| {
                    layer
                        .interior_point(oristudio_fold::FaceId(k))
                        .expect("an interior point")
                };
                let start_face = layer.render_inputs().wireframe().starting_face as u32;
                let by_points: Vec<[[f64; 2]; 2]> = relations
                    .chunks_exact(2)
                    .map(|p| [point(p[0]), point(p[1])])
                    .collect();
                let expected = pattern
                    .from_oriedita(point(start_face), &by_points, &CompletionLimits::default())
                    .unwrap_or_else(|e| panic!("{relative}: {}", e.code()));
                assert_eq!(keys(&state), keys(&expected), "{relative} {start:?}");
                landed_states.insert(keys(&state));
            }
            assert_eq!(
                landed_states.len(),
                orders.len(),
                "{relative}: one state per order"
            );
            assert_eq!(
                landed_states,
                every_chooser_state(&mut imported),
                "{relative} {start:?}: the dialog's orders are the chooser's"
            );
        }
    }
}

#[test]
fn the_look_is_the_side_fold_shows_and_turns_over_with_the_start_side() {
    for relative in [KABUTO, SAMPLE_1] {
        let front = import(relative, StartSide::Front).opening().look;
        let back = import(relative, StartSide::Back).opening().look;
        assert_ne!(front.side, back.side, "{relative}: {front:?} {back:?}");
        for look in [front, back] {
            assert!(
                (0.0..360.0).contains(&look.turn_deg),
                "{relative}: {look:?}"
            );
            // Fold's sheet is the crease pattern's, a whole number of
            // quarter turns from it.
            let quarters = look.turn_deg / 90.0;
            assert!(
                (quarters - quarters.round()).abs() < 1e-9,
                "{relative}: {look:?}"
            );
        }
    }
    // Kabuto from the front: Edit's first face is one Fold shows front up.
    assert_eq!(
        import(KABUTO, StartSide::Front).opening().look.side,
        ViewSide::Front
    );
}

/// A state's canonical keys but its view's (`v:`): its faces, creases and order.
fn unviewed(state: &State) -> BTreeSet<String> {
    keys(state)
        .into_iter()
        .filter(|key| !key.starts_with("v:"))
        .collect()
}

#[test]
fn a_turned_import_lands_turned_and_its_look_reads_the_turn_back() {
    // The dialog's Rotate on an import (Zach, 2026-10-27): the imported step
    // itself is stored at the turn, so no rotate step need follow it.
    for relative in [KABUTO, SAMPLE_1] {
        for start in [StartSide::Front, StartSide::Back] {
            let mut imported = import(relative, start);
            let opening = imported.opening();
            let plain = imported.pick(&imported.first_choice());
            let handle = imported.opened.import;
            // Rotate Right three times, from the side the dialog opened on.
            let want = (opening.look.turn_deg + 45.0) % 360.0;
            let look = imported.imports.turn(handle, want).expect("turned");
            assert_eq!(look.side, opening.look.side, "{relative} {start:?}");
            assert!(
                (look.turn_deg - want).abs() < 1e-9,
                "{relative} {start:?}: {look:?}"
            );
            assert_eq!(imported.opening().look, look, "a new opening reads it too");

            // An untouched Apply's pick and the dialog's own Apply both store the turn.
            let shown = flat(&oristudio_fold::steer::scene_relations(
                &imported.opening().shown,
            ));
            let digest = imported.opening().source.digest;
            for landed in [
                imported.pick(&imported.first_choice()),
                match imported.pick_layer_order(&digest, &shown) {
                    Outcome::Ok(landed) => landed,
                    Outcome::Refused(refusal) => panic!("{relative}: {refusal:?}"),
                },
            ] {
                let JumpOp::CpJump(jump) = &landed.op;
                assert!(
                    (jump.turn_deg - 45.0).abs() < 1e-9,
                    "{relative} {start:?}: {}",
                    jump.turn_deg
                );
                let (was, now) = (imported.state(&plain), imported.state(&landed));
                // Seen 45° clockwise more: the view's turn the other way.
                let turned = was.view().rotated(-45f64.to_radians());
                assert!(
                    (now.view().rotation - turned.rotation).abs() < 1e-9,
                    "{relative} {start:?}: {:?} {:?}",
                    was.view(),
                    now.view()
                );
                assert_eq!(now.view().flipped, was.view().flipped);
                assert_eq!(
                    unviewed(now),
                    unviewed(was),
                    "{relative}: only the view turns"
                );
                assert_ne!(keys(now), keys(was), "{relative}: the view's key says so");
            }

            // Back to where it opened: no turn is stored.
            imported
                .imports
                .turn(handle, opening.look.turn_deg)
                .expect("turned back");
            let JumpOp::CpJump(jump) = imported.pick(&imported.first_choice()).op;
            assert_eq!(jump.turn_deg, 0.0, "{relative} {start:?}");
        }
    }
    // Only an import opened onto the dialog turns, and only by a number.
    let mut imported = import(KABUTO, StartSide::Front);
    let handle = imported.opened.import;
    assert!(imported.imports.turn(handle, 15.0).is_err());
    imported.opening();
    assert!(imported.imports.turn(handle, f64::NAN).is_err());
}

#[test]
fn a_pick_that_is_not_the_dialogs_is_a_mistake_and_a_clash_lands_nothing() {
    let mut imported = import(KABUTO, StartSide::Front);
    let import_handle = imported.opened.import;
    let invalid = |result: Result<Outcome<Landed>, IoCallError>| match result {
        Err(error) => error.code(),
        Ok(other) => panic!("{other:?}"),
    };
    // Before any opening.
    assert_eq!(
        invalid(
            imported
                .imports
                .pick_layer_order(&mut imported.bridge, import_handle, "x", &[])
        ),
        "invalid_input"
    );
    let opening = imported.opening();
    let digest = opening.source.digest.clone();
    assert_eq!(
        invalid(imported.imports.pick_layer_order(
            &mut imported.bridge,
            import_handle,
            "0000000000000000",
            &[]
        )),
        "invalid_input",
        "another fold's faces"
    );
    assert_eq!(
        invalid(imported.imports.pick_layer_order(
            &mut imported.bridge,
            import_handle,
            &digest,
            &[1]
        )),
        "invalid_input",
        "half a pair"
    );
    assert_eq!(
        invalid(imported.imports.pick_layer_order(
            &mut imported.bridge,
            import_handle,
            &digest,
            &[0, 999]
        )),
        "invalid_input",
        "a face the fold lacks"
    );
    assert_eq!(
        invalid(
            imported
                .imports
                .pick_layer_order(&mut imported.bridge, 99, &digest, &[])
        ),
        "unknown_import"
    );

    // Every relation of the shown order turned over: the letters refuse it.
    let shown = flat(&oristudio_fold::steer::scene_relations(&opening.shown));
    let reversed: Vec<u32> = shown.chunks_exact(2).flat_map(|p| [p[1], p[0]]).collect();
    let before = imported.bridge.len();
    match imported.pick_layer_order(&digest, &reversed) {
        Outcome::Refused(refusal) => assert_eq!(refusal.code(), "import_no_order"),
        Outcome::Ok(landed) => panic!("landed {landed:?}"),
    }
    assert_eq!(imported.bridge.len(), before, "a refusal holds no state");

    // The opening is let go with the import.
    assert!(imported.imports.release(import_handle));
}

#[test]
fn an_import_whose_faces_are_not_edits_keeps_its_chooser() {
    // A square with a valley diagonal and an unassigned one: Fold folds the
    // unassigned crease, its letter the order's to decide; Edit folds only
    // what is coloured, so it traces two faces where the import has four.
    let cp = [
        "1 -200 -200 200 -200",
        "1 200 -200 200 200",
        "1 200 200 -200 200",
        "1 -200 200 -200 -200",
        "3 -200 -200 200 200",
    ]
    .join("\n");
    let unassigned = json!({
        "file_spec": 1.1,
        "vertices_coords": [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]],
        "edges_vertices": [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 2], [1, 4], [4, 3]],
        "edges_assignment": ["B", "B", "B", "B", "V", "V", "U", "U"]
    })
    .to_string();
    for (file, bytes, faces) in [
        (CpFile::of(CpFormat::Cp), cp.into_bytes(), true),
        (CpFile::of(CpFormat::Fold), unassigned.into_bytes(), false),
    ] {
        let bridge = Bridge::new();
        let mut imports = Imports::new();
        let opened = match imports.open(
            &bridge,
            file,
            &bytes,
            Target::Empty {
                start_side: StartSide::Front,
            },
            &Limits::default(),
        ) {
            Ok(Outcome::Ok(opened)) => opened,
            other => panic!("{other:?}"),
        };
        let choice = vec![0; opened.components.len()];
        match imports.layer_opening(opened.import, &choice) {
            Ok(Outcome::Ok(_)) => assert!(faces, "{file:?}: the faces should differ"),
            Ok(Outcome::Refused(refusal)) => {
                assert!(!faces, "{file:?}: {refusal:?}");
                assert_eq!(
                    json!(refusal)["refusal"],
                    json!({ "code": "import_layer_unavailable", "reason": "faces_differ" })
                );
            }
            Err(error) => panic!("{file:?}: {error}"),
        }
        // Either way the chooser still picks.
        let mut bridge = bridge;
        assert!(matches!(
            imports.pick(&mut bridge, opened.import, &choice),
            Ok(Outcome::Ok(_))
        ));
    }
}

/// What became of one corpus design (see the module docs).
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
enum CorpusRow {
    /// Import CP refused it, or it has one order: the dialog is never asked.
    NotAsked(&'static str),
    /// The opening refused: the import keeps its chooser.
    Fallback(String),
    /// The dialog's own open refused (the user would see why, and Cancel).
    DialogRefused(String),
    /// Opened; whether the dialog held the default whole, and whether its
    /// untouched Apply landed the default pick.
    Opened { held: bool, exact: bool },
}

#[test]
fn corpus() {
    let Some(dir) = std::env::var_os("H10_IMPORT_CORPUS_DIR") else {
        return;
    };
    let mut cases: Vec<_> = std::fs::read_dir(&dir)
        .expect("corpus dir")
        .filter_map(|entry| entry.ok().map(|e| e.path().join("truth.fold")))
        .filter(|path| path.exists())
        .collect();
    cases.sort();
    let mut rows = Vec::new();
    let mut openings_ms = Vec::new();
    for path in &cases {
        let name = path
            .parent()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let bytes = std::fs::read(path).expect("truth.fold");
        let mut bridge = Bridge::new();
        let mut imports = Imports::new();
        let row = (|| {
            let opened = match imports.open(
                &bridge,
                CpFile::of(CpFormat::Fold),
                &bytes,
                Target::Empty {
                    start_side: StartSide::Front,
                },
                &Limits::default(),
            ) {
                Ok(Outcome::Ok(opened)) => opened,
                _ => return CorpusRow::NotAsked("import refused"),
            };
            let choice = vec![0; opened.components.len()];
            if opened.count.exact
                && opened
                    .components
                    .iter()
                    .all(|c| c.orders <= 1 && !c.truncated)
            {
                return CorpusRow::NotAsked("one order");
            }
            let started = Instant::now();
            let opening = match imports.layer_opening(opened.import, &choice) {
                Ok(Outcome::Ok(opening)) => opening,
                Ok(Outcome::Refused(refusal)) => {
                    return CorpusRow::Fallback(json!(refusal)["refusal"]["reason"].to_string());
                }
                Err(error) => return CorpusRow::Fallback(error.code().to_string()),
            };
            openings_ms.push(started.elapsed().as_secs_f64() * 1000.0);
            let mut layers = LayerSessions::new();
            let shown = flat(&oristudio_fold::steer::scene_relations(&opening.shown));
            let opened_dialog = match layers.open_showing(&opening.source, &shown, &generous()) {
                Ok(Opening::Opened(opened)) => opened,
                Ok(Opening::Refused(refusal)) => {
                    let named = format!("{refusal:?}");
                    return CorpusRow::DialogRefused(
                        named
                            .split([' ', '(', '{'])
                            .next()
                            .unwrap_or_default()
                            .to_string(),
                    );
                }
                Err(error) => return CorpusRow::DialogRefused(format!("{error:?}")),
            };
            let held = opened_dialog.opened_on == OpenedOnWire::Held { ignored: 0 };
            let relations = layers
                .oriedita_relations(opened_dialog.session)
                .expect("relations");
            let default = match imports.pick(&mut bridge, opened.import, &choice) {
                Ok(Outcome::Ok(landed)) => landed,
                _ => return CorpusRow::Opened { held, exact: false },
            };
            let applied = imports.pick_layer_order(
                &mut bridge,
                opened.import,
                &opening.source.digest,
                &relations,
            );
            let exact = matches!(applied, Ok(Outcome::Ok(ref landed)) if landed.op == default.op);
            CorpusRow::Opened { held, exact }
        })();
        println!("{name}\t{row:?}");
        rows.push(row);
    }
    openings_ms.sort_by(f64::total_cmp);
    let at = |q: f64| {
        openings_ms
            .get(((openings_ms.len() as f64 - 1.0) * q).round() as usize)
            .copied()
            .unwrap_or(0.0)
    };
    let mut tally: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for row in &rows {
        let key = match row {
            CorpusRow::Fallback(reason) => format!("Fallback({reason})"),
            CorpusRow::DialogRefused(code) => format!("DialogRefused({code})"),
            other => format!("{other:?}"),
        };
        *tally.entry(key).or_default() += 1;
    }
    println!("{} designs: {tally:?}", rows.len());
    println!(
        "opening ms: p50 {:.0}, p95 {:.0}, max {:.0} ({} opened)",
        at(0.5),
        at(0.95),
        at(1.0),
        openings_ms.len()
    );
    assert!(
        rows.iter().all(|row| !matches!(
            row,
            CorpusRow::Opened { held: false, .. } | CorpusRow::Opened { exact: false, .. }
        )),
        "every opening holds the default whole and its untouched Apply lands it"
    );
}
