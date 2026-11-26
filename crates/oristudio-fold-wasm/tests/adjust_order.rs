//! Adjust order through the bridge, natively
//! (`implementation-plans/fold-adjust-order.md`): the Layer order dialog
//! opened on a held state's own paper (`io::reorder::opening`), and the order
//! its Apply chose landed as an `adjust-order` step (`io::reorder::pick`),
//! replayed as it is stored.
//!
//! The paper is a square with a valley precrease along y = 0.5, then its
//! left strip folded in along x = 0.3 and its right strip along x = 0.7, so
//! the strips overlap over [0.4, 0.6] with the right one on top. Edit folds
//! no precrease, so the dialog sees three faces where the state has six.
//!
//! What holds:
//!
//! - the opening matches Edit's three faces with the state's six;
//! - an Apply that swaps the strips lands them swapped, every crease, mark
//!   and the view kept, and the stored op replays to that state;
//! - an Apply of the state's own order lands its paper as it was;
//! - relations over another fold's faces, or not in pairs, are a caller's
//!   mistake.

#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeSet;

use oristudio_cp::folding::HierarchyRelation;
use oristudio_fold::steer::{LayerSource, StateFaces};
use oristudio_fold::{FaceId, KernelFrame, Reordering, State};
use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::canonical::canonical_keys;
use oristudio_fold_wasm::io::reorder::{opening, pick};
use oristudio_fold_wasm::io::{LayerOpening, ReorderOp, Reordered};
use oristudio_fold_wasm::wire::{Choices, Op, Outcome, Paper};
use serde_json::{Value, json};

fn op(value: Value) -> Op {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("op {value}: {e}"))
}

fn apply(bridge: &mut Bridge, state: u32, step: Op) -> u32 {
    match bridge.apply(state, &step, &Choices::default()) {
        Ok(Outcome::Ok(applied)) => applied.state,
        Ok(Outcome::Refused(r)) => panic!("refused: {:?}", r.refusal),
        Err(e) => panic!("{e}"),
    }
}

fn valley(through: [[f64; 2]; 2], moving: [f64; 2]) -> Op {
    op(json!({
        "kind": "valley",
        "line": { "via": "free", "through": through },
        "moving": moving,
        "seed": { "scope": "all" }
    }))
}

/// The two strips folded in over the precrease (see the module docs).
fn strips(bridge: &mut Bridge) -> u32 {
    let paper: Paper =
        serde_json::from_value(json!({ "shape": { "kind": "square" }, "startSide": "front" }))
            .unwrap_or_else(|e| panic!("{e}"));
    let sheet = match bridge.sheet(&paper) {
        Outcome::Ok(made) => made.state,
        Outcome::Refused(r) => panic!("{:?}", r.refusal),
    };
    let precreased = apply(
        bridge,
        sheet,
        op(json!({
            "kind": "precrease",
            "line": { "via": "free", "through": [[0.0, 0.5], [1.0, 0.5]] },
            "direction": "valley",
            "moving": [0.5, 0.75],
            "seed": { "scope": "all" }
        })),
    );
    let left = apply(
        bridge,
        precreased,
        valley([[0.3, 0.0], [0.3, 1.0]], [0.1, 0.25]),
    );
    apply(bridge, left, valley([[0.7, 0.0], [0.7, 1.0]], [0.9, 0.25]))
}

fn opened(state: &State) -> LayerOpening {
    match opening(state) {
        Outcome::Ok(opening) => opening,
        Outcome::Refused(r) => panic!("refused: {:?}", r.refusal),
    }
}

fn keys(state: &State) -> BTreeSet<String> {
    canonical_keys(state).into_iter().collect()
}

/// The keys of everything but the order.
fn paper_keys(state: &State) -> BTreeSet<String> {
    keys(state)
        .into_iter()
        .filter(|k| !k.starts_with("o:"))
        .collect()
}

fn face_at(state: &State, p: [f64; 2]) -> FaceId {
    state
        .face_at(p)
        .unwrap_or_else(|| panic!("no face at {p:?}"))
}

/// Whether the left strip lies above the right one, at both halves of the precrease.
fn left_on_top(state: &State) -> [Option<bool>; 2] {
    [0.25, 0.75].map(|y| state.above(face_at(state, [0.15, y]), face_at(state, [0.85, y])))
}

/// The dialog's view of `state`: its source's faces, the state's order over
/// them, and the Edit face at each sheet point.
struct Dialog {
    digest: String,
    relations: Vec<HierarchyRelation>,
    layer: LayerSource,
    frame: KernelFrame,
    /// The Edit face Oriedita's fold starts from.
    start: usize,
}

impl Dialog {
    fn of(state: &State) -> Dialog {
        let opening = opened(state);
        let layer = LayerSource::from_oriedita(&opening.source).unwrap_or_else(|e| panic!("{e}"));
        let reordering = Reordering::of(state).unwrap_or_else(|e| panic!("{e}"));
        let frame = KernelFrame::of(state.sheet());
        let faces = StateFaces::of(&layer, reordering.unordered(), &frame)
            .unwrap_or_else(|e| panic!("{e}"));
        let relations = faces
            .oriedita_relations(&layer, reordering.unordered(), state.order())
            .unwrap_or_else(|e| panic!("{e}"));
        let start = layer.render_inputs().wireframe().starting_face;
        Dialog {
            digest: opening.source.digest,
            relations,
            layer,
            frame,
            start,
        }
    }

    fn edit_face(&self, p: [f64; 2]) -> usize {
        self.layer
            .face_at_paper(self.frame.to_model(p))
            .unwrap_or_else(|| panic!("no Edit face at {p:?}"))
            .0 as usize
    }

    fn flat(relations: &[HierarchyRelation]) -> Vec<u32> {
        relations
            .iter()
            .flat_map(|r| [r.upper_face as u32, r.lower_face as u32])
            .collect()
    }
}

fn picked(bridge: &mut Bridge, state: u32, digest: &str, relations: &[u32]) -> Reordered {
    match pick(bridge, state, digest, relations) {
        Ok(Outcome::Ok(landed)) => landed,
        Ok(Outcome::Refused(r)) => panic!("refused: {:?}", r.refusal),
        Err(e) => panic!("{}: {e}", e.code()),
    }
}

#[test]
fn the_opening_matches_edits_faces_with_the_states_across_its_precrease() {
    let mut bridge = Bridge::new();
    let strips = strips(&mut bridge);
    let state = bridge.state(strips).expect("held").clone();
    assert_eq!(state.faces().len(), 6);
    let dialog = Dialog::of(&state);
    assert_eq!(dialog.layer.render_inputs().wireframe().faces.len(), 3);
    // Three overlapping pairs of Edit faces: each strip on the middle panel, and the strips.
    assert_eq!(dialog.relations.len(), 3);
    let (left, right) = (
        dialog.edit_face([0.15, 0.25]),
        dialog.edit_face([0.85, 0.25]),
    );
    assert_eq!(dialog.edit_face([0.15, 0.75]), left);
    // Oriedita's sense is its starting face's front, and it starts from the
    // right strip, folded front down: the left strip is "upper" from there,
    // so the right strip is on top as the viewer sees it.
    assert_eq!(dialog.edit_face([0.85, 0.75]), dialog.start);
    assert!(
        dialog
            .relations
            .iter()
            .any(|r| (r.upper_face, r.lower_face) == (left, right)),
        "the right strip is on top: {:?}",
        dialog.relations
    );
    // Oriedita draws its starting face front up, and Fold shows that strip
    // front down: the dialog opens on Oriedita's back, as Fold shows the
    // paper, unturned.
    let look = opened(&state).look;
    assert_eq!(
        serde_json::to_value(look).unwrap_or_default(),
        json!({ "side": "back", "turn_deg": 0.0 })
    );
}

#[test]
fn an_apply_that_swaps_the_strips_lands_them_swapped_on_the_same_paper() {
    let mut bridge = Bridge::new();
    let strips = strips(&mut bridge);
    let parent = bridge.state(strips).expect("held").clone();
    assert_eq!(left_on_top(&parent), [Some(false); 2]);
    let dialog = Dialog::of(&parent);
    let (left, right) = (
        dialog.edit_face([0.15, 0.25]),
        dialog.edit_face([0.85, 0.25]),
    );
    let swapped: Vec<HierarchyRelation> = dialog
        .relations
        .iter()
        .map(|r| {
            let strips = [r.upper_face, r.lower_face];
            if strips == [left, right] || strips == [right, left] {
                HierarchyRelation {
                    upper_face: r.lower_face,
                    lower_face: r.upper_face,
                }
            } else {
                *r
            }
        })
        .collect();
    assert_ne!(swapped, dialog.relations);
    let landed = picked(&mut bridge, strips, &dialog.digest, &Dialog::flat(&swapped));
    let ReorderOp::AdjustOrder(stored) = &landed.op;
    let state = bridge.state(landed.state).expect("held").clone();
    assert_eq!(left_on_top(&state), [Some(true); 2]);
    // Every crease, mark, the sheet and the view are the parent's.
    assert_eq!(paper_keys(&state), paper_keys(&parent));
    assert_ne!(keys(&state), keys(&parent));
    assert_eq!(state.creases(), parent.creases());
    assert_eq!(state.faces(), parent.faces());
    assert_eq!(state.step(), parent.step() + 1);
    assert_eq!(landed.summary.step, parent.step() + 1);
    // The op it stores replays to it.
    let replayed = apply(&mut bridge, strips, Op::AdjustOrder(stored.clone()));
    assert_eq!(keys(bridge.state(replayed).expect("held")), keys(&state));
    // And it is the document's shape.
    let written = serde_json::to_value(&landed.op).unwrap_or_default();
    assert_eq!(written["kind"], json!("adjust-order"));
    assert!(written["orderJson"].is_string());
}

#[test]
fn an_apply_of_the_states_own_order_lands_its_paper_as_it_was() {
    let mut bridge = Bridge::new();
    let strips = strips(&mut bridge);
    let parent = bridge.state(strips).expect("held").clone();
    let dialog = Dialog::of(&parent);
    let landed = picked(
        &mut bridge,
        strips,
        &dialog.digest,
        &Dialog::flat(&dialog.relations),
    );
    assert_eq!(
        keys(bridge.state(landed.state).expect("held")),
        keys(&parent)
    );
}

#[test]
fn relations_over_another_fold_or_not_in_pairs_are_a_callers_mistake() {
    let mut bridge = Bridge::new();
    let strips = strips(&mut bridge);
    let parent = bridge.state(strips).expect("held").clone();
    let dialog = Dialog::of(&parent);
    let flat = Dialog::flat(&dialog.relations);
    assert!(pick(&mut bridge, strips, "f1:another", &flat).is_err());
    assert!(pick(&mut bridge, strips, &dialog.digest, &flat[1..]).is_err());
    // A face the dialog's fold does not have.
    assert!(pick(&mut bridge, strips, &dialog.digest, &[0, 99]).is_err());
}

#[test]
fn a_stored_order_that_no_longer_reads_is_refused() {
    let mut bridge = Bridge::new();
    let strips = strips(&mut bridge);
    let unreadable = op(json!({ "kind": "adjust-order", "orderJson": "not json" }));
    match bridge.apply(strips, &unreadable, &Choices::default()) {
        Ok(Outcome::Refused(r)) => {
            let value = serde_json::to_value(&r.refusal).unwrap_or_default();
            assert_eq!(value["code"], json!("import_stored_unreadable"), "{value}");
        }
        other => panic!("{other:?}"),
    }
}
