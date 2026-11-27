//! Collapse through the bridge, natively
//! (`implementation-plans/fold-collapse-existing-creases.md`): a held state's
//! own crease pattern with some letters changed, opened as an import is
//! (`Imports::open_collapse`), an order of it as the op a step stores
//! (`Imports::collapse_op`), and that op landed as every replay lands it
//! (`Bridge::apply`).
//!
//! The paper is a square precreased along both diagonals and both midlines,
//! collapsed into a preliminary base.
//!
//! What holds:
//!
//! - the op is `{ kind: 'collapse', creases, orderJson }`, its stretches as
//!   the engine stores them, and it lands, and lands again the same from the
//!   same parent;
//! - a pick of a held Collapse lands the same op and state as `collapse_op`
//!   and `apply` do;
//! - letters that do not fold flat are refused with the vertex they break
//!   at, and the Layer order dialog does not open on a Collapse;
//! - a stored op whose order no longer reads, or whose stretch the parent no
//!   longer has, is refused.

#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeSet;

use oristudio_fold::{CollapseCrease, CollapseTo};
use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::canonical::canonical_keys;
use oristudio_fold_wasm::io::{Imports, JumpOp, Limits};
use oristudio_fold_wasm::wire::{Choices, Op, Outcome, Paper};
use serde_json::{Value, json};

fn op(value: Value) -> Op {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("op {value}: {e}"))
}

fn apply(bridge: &mut Bridge, state: u32, step: &Op) -> Outcome<u32> {
    match bridge.apply(state, step, &Choices::default()) {
        Ok(Outcome::Ok(applied)) => Outcome::Ok(applied.state),
        Ok(Outcome::Refused(r)) => Outcome::Refused(r),
        Err(e) => panic!("{e}"),
    }
}

fn landed(bridge: &mut Bridge, state: u32, step: &Op) -> u32 {
    match apply(bridge, state, step) {
        Outcome::Ok(state) => state,
        Outcome::Refused(r) => panic!("refused: {:?}", r.refusal),
    }
}

fn precrease(through: [[f64; 2]; 2], moving: [f64; 2], direction: &str) -> Op {
    op(json!({
        "kind": "precrease",
        "line": { "via": "free", "through": through },
        "direction": direction,
        "moving": moving,
        "seed": { "scope": "all" }
    }))
}

/// The square precreased along its diagonals and midlines.
fn precreased(bridge: &mut Bridge) -> u32 {
    let paper: Paper =
        serde_json::from_value(json!({ "shape": { "kind": "square" }, "startSide": "front" }))
            .unwrap_or_else(|e| panic!("{e}"));
    let mut state = match bridge.sheet(&paper) {
        Outcome::Ok(made) => made.state,
        Outcome::Refused(r) => panic!("{:?}", r.refusal),
    };
    for step in [
        precrease([[0.0, 0.0], [1.0, 1.0]], [0.9, 0.1], "valley"),
        precrease([[1.0, 0.0], [0.0, 1.0]], [0.1, 0.1], "valley"),
        precrease([[0.5, 0.0], [0.5, 1.0]], [0.9, 0.5], "mountain"),
        precrease([[0.0, 0.5], [1.0, 0.5]], [0.5, 0.1], "mountain"),
    ] {
        state = landed(bridge, state, &step);
    }
    state
}

const C: [f64; 2] = [0.5, 0.5];

fn stretch(b: [f64; 2], to: CollapseTo) -> CollapseCrease {
    CollapseCrease { a: C, b, to }
}

/// Every diagonal half a mountain, three midline halves valleys, the left
/// half of the horizontal midline a mountain: a preliminary base.
fn preliminary() -> Vec<CollapseCrease> {
    let (m, v) = (CollapseTo::Mountain, CollapseTo::Valley);
    vec![
        stretch([0.0, 0.0], m),
        stretch([1.0, 1.0], m),
        stretch([1.0, 0.0], m),
        stretch([0.0, 1.0], m),
        stretch([0.5, 0.0], v),
        stretch([0.5, 1.0], v),
        stretch([0.0, 0.5], m),
        stretch([1.0, 0.5], v),
    ]
}

fn keys(bridge: &Bridge, state: u32) -> BTreeSet<String> {
    canonical_keys(bridge.state(state).unwrap_or_else(|e| panic!("{e}")))
        .into_iter()
        .collect()
}

fn opened(imports: &mut Imports, bridge: &Bridge, state: u32, creases: &[CollapseCrease]) -> u32 {
    match imports.open_collapse(bridge, state, creases, &Limits::default()) {
        Ok(Outcome::Ok(opened)) => {
            assert!(opened.count.orders >= 1);
            opened.import
        }
        Ok(Outcome::Refused(r)) => panic!("refused: {:?}", r.refusal),
        Err(e) => panic!("{e}"),
    }
}

#[test]
fn an_order_of_a_held_collapse_is_the_op_a_step_stores_and_lands_again() {
    let mut bridge = Bridge::new();
    let parent = precreased(&mut bridge);
    let mut imports = Imports::new();
    let import = opened(&mut imports, &bridge, parent, &preliminary());
    let collapse = match imports.collapse_op(import, &[]) {
        Ok(Outcome::Ok(collapse)) => collapse,
        Ok(Outcome::Refused(r)) => panic!("refused: {:?}", r.refusal),
        Err(e) => panic!("{e}"),
    };
    // Spelled as the document stores it: the eight halves merged where one
    // continues another with its letter — both diagonals, the vertical
    // midline, and the horizontal midline's two halves.
    let written = serde_json::to_value(JumpOp::Collapse(collapse.clone())).unwrap_or_default();
    assert_eq!(written["kind"], "collapse");
    assert_eq!(written["creases"].as_array().map(Vec::len), Some(5));
    assert_eq!(written["creases"][0]["to"], "mountain");
    assert!(
        written["orderJson"]
            .as_str()
            .is_some_and(|s| s.contains("faces"))
    );
    // It lands, and the same op lands the same state again.
    let step = op(written);
    let first = landed(&mut bridge, parent, &step);
    let second = landed(&mut bridge, parent, &step);
    assert_eq!(keys(&bridge, first), keys(&bridge, second));
    // A pick of the held Collapse lands that op and that state.
    match imports.pick(&mut bridge, import, &[]) {
        Ok(Outcome::Ok(picked)) => {
            assert_eq!(picked.op, JumpOp::Collapse(collapse));
            assert_eq!(keys(&bridge, picked.state), keys(&bridge, first));
        }
        Ok(Outcome::Refused(r)) => panic!("refused: {:?}", r.refusal),
        Err(e) => panic!("{e}"),
    }
    // The Layer order dialog does not open on it; its own ‹ n of m › chooses.
    match imports.layer_opening(import, &[]) {
        Ok(Outcome::Refused(r)) => assert_eq!(r.code(), "import_layer_unavailable"),
        other => panic!("{other:?}"),
    }
    assert!(imports.release(import));
}

#[test]
fn letters_that_do_not_fold_flat_are_refused_at_their_vertex() {
    let mut bridge = Bridge::new();
    let parent = precreased(&mut bridge);
    let mut imports = Imports::new();
    match imports.open_collapse(
        &bridge,
        parent,
        &[stretch([1.0, 1.0], CollapseTo::Valley)],
        &Limits::default(),
    ) {
        Ok(Outcome::Refused(r)) => {
            assert_eq!(r.code(), "collapse_not_flat_at_vertex");
            let body = serde_json::to_value(&r).unwrap_or_default();
            assert_eq!(body["refusal"]["rule"], "maekawa");
            assert_eq!(body["refusal"]["point"], json!([0.5, 0.5]));
        }
        other => panic!("{other:?}"),
    }
    assert!(imports.is_empty());
}

#[test]
fn a_stored_collapse_the_parent_no_longer_fits_is_refused() {
    let mut bridge = Bridge::new();
    let parent = precreased(&mut bridge);
    let mut imports = Imports::new();
    let import = opened(&mut imports, &bridge, parent, &preliminary());
    let collapse = match imports.collapse_op(import, &[]) {
        Ok(Outcome::Ok(collapse)) => collapse,
        other => panic!("{other:?}"),
    };
    let mut written = serde_json::to_value(JumpOp::Collapse(collapse)).unwrap_or_default();
    // An order that no longer reads.
    let mut unreadable = written.clone();
    unreadable["orderJson"] = json!("not an order");
    match apply(&mut bridge, parent, &op(unreadable)) {
        Outcome::Refused(r) => assert_eq!(r.code(), "import_stored_unreadable"),
        Outcome::Ok(_) => panic!("landed an unreadable order"),
    }
    // A stretch the parent has no crease along.
    written["creases"][0] = json!({ "a": [0.0, 0.75], "b": [1.0, 0.75], "to": "valley" });
    match apply(&mut bridge, parent, &op(written)) {
        Outcome::Refused(r) => assert_eq!(r.code(), "collapse_crease_missing"),
        Outcome::Ok(_) => panic!("landed a stretch of no crease"),
    }
}
