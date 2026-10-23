//! The conversion to the CP kernel's model (plan D10), through the kernel's own
//! FOLD writer and reader (`oristudio_cp::io::fold`) and its Oriedita fold.
//!
//! - Through the FOLD document and through FOLD text the model comes back
//!   equal, coordinates to the bit, on the classics, a dyadic path and seeded
//!   random paths over square, rectangular and polygonal sheets. Text is exact
//!   because the workspace enables `serde_json`'s `float_roundtrip` (see
//!   `oristudio_fold::kernel`).
//! - The folding colours of every folded state fold to `Solved`.

#![cfg(feature = "kernel")]

mod paths;

use oristudio_cp::folding::{EstimationOrder, FoldOutcome, folding_estimate_from_segments};
use oristudio_cp::geometry::{FoldDirection, LineColor, LineSegment};
use oristudio_cp::io::fold::{
    export_fold_document, export_fold_json, import_fold_document, import_fold_json,
};
use oristudio_cp::model::CreasePatternModel;
use oristudio_fold::{CreaseKind, KernelFrame, Letter, State, fold_cp_to_model};
use paths::*;
use treemaker_fold::Assignment;

/// The classics, the dyadic path, and four random paths per test sheet.
fn test_paths() -> Vec<(String, Vec<State>)> {
    let mut paths = classic_paths();
    paths.push(("dyadic".to_string(), dyadic_path()));
    let mut rng = Rng::new(0x5eed);
    for (s, sheet) in sheets().into_iter().enumerate() {
        for i in 0..4 {
            let path = random_path(&mut rng, sheet.clone(), 10);
            paths.push((format!("random sheet {s} path {i}"), path));
        }
    }
    paths
}

fn document_round_trip(model: &CreasePatternModel) -> CreasePatternModel {
    import_fold_document(&export_fold_document(model, None))
        .unwrap_or_else(|e| panic!("the kernel refuses its own FOLD: {e}"))
}

fn text_round_trip(model: &CreasePatternModel) -> CreasePatternModel {
    let text = export_fold_json(model, None).unwrap_or_else(|e| panic!("{e}"));
    import_fold_json(&text).unwrap_or_else(|e| panic!("the kernel refuses its own FOLD: {e}"))
}

/// One segment per crease, in id order, coloured by its kind, at the state's
/// vertices.
fn assert_converts(state: &State) -> CreasePatternModel {
    let model = fold_cp_to_model(state);
    assert_eq!(model.line_segments.len(), state.creases().len());
    let frame = KernelFrame::of(state.sheet());
    for (crease, segment) in state.creases().iter().zip(&model.line_segments) {
        let (color, hint) = match crease.kind {
            CreaseKind::Border => (LineColor::Black0, None),
            CreaseKind::Folded(Letter::Mountain) => (LineColor::Red1, None),
            CreaseKind::Folded(Letter::Valley) => (LineColor::Blue2, None),
            CreaseKind::Flat(Letter::Mountain) => (LineColor::None, Some(FoldDirection::Mountain)),
            CreaseKind::Flat(Letter::Valley) => (LineColor::None, Some(FoldDirection::Valley)),
        };
        assert_eq!((segment.color, segment.fold_direction_hint), (color, hint));
        for (end, v) in [segment.a, segment.b].into_iter().zip(crease.vertices) {
            let p = state.vertices()[v.0 as usize];
            let q = frame.to_sheet([end.x, end.y]);
            assert!(
                (p[0] - q[0]).abs() < 1e-14 && (p[1] - q[1]).abs() < 1e-14,
                "{v}: {p:?} came back {q:?}"
            );
        }
    }
    model
}

#[test]
fn the_kernel_fold_writer_and_reader_return_the_model_exactly() {
    let mut states = 0;
    for (name, path) in test_paths() {
        for state in &path {
            let model = assert_converts(state);
            assert_eq!(
                document_round_trip(&model),
                model,
                "{name} step {} through the document",
                state.step()
            );
            assert_eq!(
                text_round_trip(&model),
                model,
                "{name} step {} through text",
                state.step()
            );
            states += 1;
        }
    }
    assert!(states > 150, "only {states} states");
}

/// Folded creases are written as M and V, precreases as U with the hint
/// extension, which the reader maps back to the remembered letter.
#[test]
fn precreases_cross_as_unassigned_with_their_letter() {
    let (_, path) = classic_paths()
        .into_iter()
        .find(|(name, _)| name == "precrease-four-layers")
        .unwrap_or_else(|| panic!("no precrease-four-layers fixture"));
    // After the precrease, before the refold.
    let state = &path[3];
    let fold = export_fold_document(&fold_cp_to_model(state), None);
    let hints = fold
        .extra
        .get("oristudio:edges_fold_direction_hint")
        .and_then(|v| v.as_array())
        .unwrap_or_else(|| panic!("no hint extension"));
    assert_eq!(hints.len(), state.creases().len());
    let mut flats = 0;
    for (k, crease) in state.creases().iter().enumerate() {
        let (assignment, hint) = match crease.kind {
            CreaseKind::Border => (Assignment::Boundary, 0),
            CreaseKind::Folded(Letter::Mountain) => (Assignment::Mountain, 0),
            CreaseKind::Folded(Letter::Valley) => (Assignment::Valley, 0),
            CreaseKind::Flat(letter) => {
                flats += 1;
                let code = if letter == Letter::Mountain { 1 } else { 2 };
                (Assignment::Unassigned, code)
            }
        };
        assert_eq!(fold.assignment_for_edge(k), assignment, "{}", crease.id);
        assert_eq!(hints[k].as_i64(), Some(hint), "{}", crease.id);
    }
    assert_eq!(flats, 4, "one precrease segment per layer");
}

/// Edit folds only the folding colours (`is_folding_line`), so the
/// precreases take no part: what remains is the state's folded crease
/// pattern, and Oriedita finds a layer order for it: on 2026-10-08, for all
/// 228 folded states here (19 from the classics and the dyadic path, 209
/// random).
#[test]
fn the_folding_colours_fold_to_solved() {
    let mut folded = 0;
    for (name, path) in test_paths() {
        for state in &path {
            if !state.creases().iter().any(|c| c.kind.is_folded()) {
                continue;
            }
            let model = fold_cp_to_model(state);
            let folding: Vec<LineSegment> = model
                .line_segments
                .iter()
                .filter(|s| s.color.is_folding_line())
                .cloned()
                .collect();
            let estimate = folding_estimate_from_segments(&folding, 1, EstimationOrder::Order5)
                .unwrap_or_else(|e| panic!("{name} step {}: {e:?}", state.step()));
            assert_eq!(
                estimate.outcome,
                FoldOutcome::Solved,
                "{name} step {}",
                state.step()
            );
            assert!(estimate.discovered_fold_cases >= 1);
            folded += 1;
        }
    }
    assert!(folded >= 200, "only {folded} folded states");
}
