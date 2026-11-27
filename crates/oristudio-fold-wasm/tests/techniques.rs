//! Folding techniques through the public bridge, on the generated fixtures
//! (`tests/fixtures/fold-examples`, built by
//! `apps/web/src/fold/document/foldTechniqueFixtures.wasm.test.ts`):
//! acceptance checks the paper's identity, not only replay.
#![cfg(not(target_arch = "wasm32"))]

use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::wire::{Choices, Op, Outcome, Paper};
use serde_json::{Value, json};

fn project(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures")
        .join(format!("{name}.osf"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn sequence(name: &str) -> Value {
    project(name)["workspace"]["foldSequences"][0].clone()
}

fn apply(bridge: &mut Bridge, parent: u32, step: &Value) -> u32 {
    let op: Op = serde_json::from_value(step["op"].clone()).unwrap();
    let choices: Choices =
        serde_json::from_value(step.get("choices").cloned().unwrap_or(json!({}))).unwrap();
    match bridge.apply(parent, &op, &choices).unwrap() {
        Outcome::Ok(landed) => landed.state,
        Outcome::Refused(r) => panic!("{}: {:?}", step["note"], r),
    }
}

fn refusal(bridge: &mut Bridge, parent: u32, op: Value, choices: &Value) -> Value {
    let op: Op = serde_json::from_value(op).unwrap();
    let choices: Choices = serde_json::from_value(choices.clone()).unwrap();
    let Outcome::Refused(refused) = bridge.apply(parent, &op, &choices).unwrap() else {
        panic!("landed");
    };
    serde_json::to_value(refused).unwrap()["refusal"].clone()
}

fn sheet(bridge: &mut Bridge, doc: &Value) -> u32 {
    let paper: Paper = serde_json::from_value(doc["paper"].clone()).unwrap();
    match bridge.sheet(&paper) {
        Outcome::Ok(s) => s.state,
        _ => panic!("sheet"),
    }
}

/// The first `count` steps of a sequence whose steps each fold the one before.
fn prefix(bridge: &mut Bridge, doc: &Value, count: usize) -> u32 {
    let mut at = sheet(bridge, doc);
    for step in doc["steps"].as_array().unwrap().iter().take(count) {
        at = apply(bridge, at, step);
    }
    at
}

/// Every step of a sequence from its parent, branches included: its id and canonical keys.
fn replayed(bridge: &mut Bridge, doc: &Value) -> Vec<(String, Vec<String>)> {
    let root = sheet(bridge, doc);
    let mut at = std::collections::BTreeMap::<String, u32>::new();
    let mut keys = Vec::new();
    for step in doc["steps"].as_array().unwrap() {
        let parent = step["parent"].as_str().map_or(root, |id| at[id]);
        let landed = apply(bridge, parent, step);
        let id = step["id"].as_str().unwrap().to_string();
        at.insert(id.clone(), landed);
        keys.push((id, bridge.canonical_keys(landed).unwrap()));
    }
    keys
}

/// The chained sequences and every technique fixture replay to the same
/// paper at every step: twice through one bridge, and through a fresh one.
#[test]
fn the_chained_and_technique_sequences_replay_identically() {
    for name in [
        "fold-examples/chain-fish-base-outside-reverse",
        "fold-examples/chain-tuck-turn-fold",
        "fold-examples/rabbit-ear-precreased",
        "fold-examples/squash-precreased-flap",
        "fold-examples/kite-outside-reverse",
        "fold-examples/tuck-under-two-flaps",
        "fold-examples/inside-reverse-nested-pairs",
        "fold-examples/crimp-lines-meet-on-fold",
    ] {
        let doc = sequence(name);
        let mut bridge = Bridge::new();
        let first = replayed(&mut bridge, &doc);
        let again = replayed(&mut bridge, &doc);
        let fresh = replayed(&mut Bridge::new(), &doc);
        assert_eq!(first, again, "{name}");
        assert_eq!(first, fresh, "{name}");
        assert_eq!(
            first.len(),
            doc["steps"].as_array().unwrap().len(),
            "{name}"
        );
    }
}

/// A model point's sheet point on the paper a fold along the line through
/// `a` and `b` laid there: its reflection in that line.
fn reflected(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    let foot = [a[0] + t * dx, a[1] + t * dy];
    [2.0 * foot[0] - p[0], 2.0 * foot[1] - p[1]]
}

const TUCK: &str = "fold-examples/tuck-under-two-flaps";

#[test]
fn a_tuck_lands_under_both_flaps_without_splitting_or_moving_them() {
    let doc = sequence(TUCK);
    let mut bridge = Bridge::new();
    let at = prefix(&mut bridge, &doc, 2);
    let parent = bridge.state(at).unwrap().clone();
    let step = &doc["steps"][2];
    let points: Vec<[f64; 2]> =
        serde_json::from_value(step["op"]["landing"]["targets"].clone()).unwrap();
    assert_eq!(points.len(), 2);
    let ids: Vec<_> = points.iter().map(|&p| parent.face_at(p).unwrap()).collect();
    let landed = apply(&mut bridge, at, step);
    let child = bridge.state(landed).unwrap();
    assert_eq!(parent.faces().len(), 3);
    assert_eq!(child.faces().len(), 4); // only the sheet splits, along the tuck's line
    for id in ids {
        assert_eq!(
            parent.face(id),
            child.face(id),
            "a corner flap must stay one uncreased face"
        );
        assert_eq!(
            parent.isometry(id),
            child.isometry(id),
            "a corner flap must stay put"
        );
    }
    // A selected target connected to the moving flap cannot be arbitrarily held.
    let mut invalid = step["op"].clone();
    invalid["landing"]["targets"] = json!([points[0], step["op"]["seed"]["at"]]);
    assert_eq!(
        refusal(&mut bridge, at, invalid, &json!({}))["code"],
        "tuck_target_moves"
    );
}

#[test]
fn a_tuck_puts_each_flap_above_the_tucked_paper_where_the_outer_fold_does_not() {
    let doc = sequence(TUCK);
    let mut bridge = Bridge::new();
    let at = prefix(&mut bridge, &doc, 2);
    let step = &doc["steps"][2];
    let correct = apply(&mut bridge, at, step);
    // The same fold landing outer, over both flaps: admissible, the other paper on top.
    let mut wrong_step = step.clone();
    wrong_step["op"]["landing"] = json!({"kind": "outer"});
    let wrong = apply(&mut bridge, at, &wrong_step);
    // Where each flap's body overlaps the tucked top: its material, and the top's.
    let tuck_line = ([0.0, 0.64], [1.0, 0.64]);
    for (at_model, hinge) in [
        ([0.12, 0.31], ([0.0, 0.2], [0.5, 0.0])),
        ([0.88, 0.31], ([1.0, 0.2], [0.5, 0.0])),
    ] {
        let flap = reflected(at_model, hinge.0, hinge.1);
        let top = reflected(at_model, tuck_line.0, tuck_line.1);
        for (state, expected) in [(correct, true), (wrong, false)] {
            let child = bridge.state(state).unwrap();
            let a = child.image_of(flap).unwrap();
            let b = child.image_of(top).unwrap();
            assert!((a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9);
            assert_eq!(
                child.seen_above(child.face_at(flap).unwrap(), child.face_at(top).unwrap()),
                Some(expected),
                "the flap must cover the tucked paper at {at_model:?}"
            );
            if expected {
                assert_eq!(child.stack_at(a).unwrap()[0], child.face_at(flap).unwrap());
            }
        }
    }
}

#[test]
fn a_tuck_is_independent_of_target_order_and_duplicate_targets() {
    let doc = sequence(TUCK);
    let mut bridge = Bridge::new();
    let at = prefix(&mut bridge, &doc, 2);
    let original = &doc["steps"][2];
    let expected = apply(&mut bridge, at, original);
    let keys = bridge.canonical_keys(expected).unwrap();
    let targets = original["op"]["landing"]["targets"].clone();
    let mut swapped = original.clone();
    swapped["op"]["landing"]["targets"] = json!([targets[1], targets[0], targets[0]]);
    let landed = apply(&mut bridge, at, &swapped);
    assert_eq!(bridge.canonical_keys(landed).unwrap(), keys);
    // The same physical placement seen from the back uses the opposite direction.
    let turned = apply(
        &mut bridge,
        at,
        &json!({"op":{"kind":"turn","axis":"vertical"}}),
    );
    let mut back = original.clone();
    back["op"]["kind"] = json!("mountain");
    let tucked = apply(&mut bridge, turned, &back);
    let front = apply(
        &mut bridge,
        tucked,
        &json!({"op":{"kind":"turn","axis":"vertical"}}),
    );
    assert_eq!(bridge.canonical_keys(front).unwrap(), keys);
}

#[test]
fn an_outside_reverse_refuses_the_inside_kind_at_its_opening() {
    let doc = sequence("fold-examples/kite-outside-reverse");
    assert_eq!(doc["steps"][4]["op"]["kind"], "outside-reverse");
    assert_eq!(doc["steps"][5]["op"]["kind"], "outside-reverse");
    let mut bridge = Bridge::new();
    let at = prefix(&mut bridge, &doc, 4);
    let mut wrong = doc["steps"][4]["op"].clone();
    wrong["kind"] = json!("inside-reverse");
    assert_eq!(
        refusal(&mut bridge, at, wrong, &doc["steps"][4]["choices"])["code"],
        "reverse_kind_infeasible"
    );
}

/// Each swivel probe, valley and mountain, open and inside.
fn variants(op: &Value) -> Vec<Value> {
    let mut all = Vec::new();
    for direction in ["valley", "mountain"] {
        for inside in [false, true] {
            let mut probe = op.clone();
            probe["direction"] = json!(direction);
            if inside {
                probe["swivel"] = json!("inside");
            }
            all.push(probe);
        }
    }
    all
}

#[test]
fn swivels_on_a_folded_edge_keep_their_geometric_refusals() {
    // The squashed preliminary base of the swivel example, before its swivel.
    let doc = sequence("fold-examples/swivel-on-edge");
    let mut bridge = Bridge::new();
    let squashed = prefix(&mut bridge, &doc, 6);
    let swivel = doc["steps"][6]["op"].clone();
    assert_eq!(swivel["via"], "edge");
    let turned = apply(
        &mut bridge,
        squashed,
        &json!({"op":{"kind":"turn","axis":"vertical"}}),
    );
    // Its own swivel the other way, the paper behind: no order. As a
    // mountain from the front, and as a valley once the model is turned over.
    for probe in variants(&swivel) {
        let state = if probe["direction"] == "mountain" {
            squashed
        } else {
            turned
        };
        assert_eq!(
            refusal(&mut bridge, state, probe.clone(), &json!({}))["code"],
            "no_order",
            "{probe}"
        );
    }
    // The top layer's raw edge along the kite's middle onto the centre line:
    // the creases in the layer under it run into the fold down the centre.
    let h = std::f64::consts::FRAC_1_SQRT_2;
    let blocked = json!({
        "kind": "swivel", "via": "edge",
        "fold": [0.75, (0.5 + h) / 2.0],
        "edge": [1.0, 0.6],
        "target": {"via": "crease", "at": [0.75, 0.5]},
        "direction": "valley",
    });
    for probe in variants(&blocked) {
        assert_eq!(
            refusal(&mut bridge, squashed, probe.clone(), &json!({}))["code"],
            "fan_ray_blocked",
            "{probe}"
        );
    }
    // The square folded on its diagonal: the bottom layer's left edge onto
    // the bottom edge's line meets the folded edge at a right angle.
    let tri_doc = json!({"paper": doc["paper"], "steps": []});
    let flat = sheet(&mut bridge, &tri_doc);
    let tri = apply(
        &mut bridge,
        flat,
        &json!({"op": {"kind": "valley", "line": {"via": "free", "through": [[1, 0], [0, 1]]},
            "moving": [1, 1], "seed": {"scope": "all"}, "landing": {"kind": "outer"}}}),
    );
    let wide = json!({
        "kind": "swivel", "via": "edge",
        "fold": [0.5, 0.5],
        "edge": [0.0, 0.5],
        "target": {"via": "crease", "at": [0.5, 0.0]},
        "direction": "valley",
    });
    for probe in variants(&wide) {
        assert_eq!(
            refusal(&mut bridge, tri, probe.clone(), &json!({}))["code"],
            "swivel_fold_wide",
            "{probe}"
        );
    }
}
