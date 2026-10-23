//! Real flat authoring cases; acceptance checks paper identity, not only replay.
#![cfg(not(target_arch = "wasm32"))]

use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::wire::{Choices, Op, Outcome, Paper};
use serde_json::{Value, json};

fn project(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/fold-design-completion")
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
fn prefix(bridge: &mut Bridge, doc: &Value, count: usize) -> u32 {
    let paper: Paper = serde_json::from_value(doc["paper"].clone()).unwrap();
    let mut at = match bridge.sheet(&paper) {
        Outcome::Ok(s) => s.state,
        _ => panic!("sheet"),
    };
    for step in doc["steps"].as_array().unwrap().iter().take(count) {
        at = apply(bridge, at, step);
    }
    at
}

#[test]
fn every_delivered_flat_sequence_replays_deterministically() {
    for name in ["cicada", "swan", "heart", "box", "crane"] {
        let doc = sequence(name);
        let mut bridge = Bridge::new();
        let a = prefix(&mut bridge, &doc, usize::MAX);
        let b = prefix(&mut bridge, &doc, usize::MAX);
        assert_eq!(
            bridge.canonical_keys(a).unwrap(),
            bridge.canonical_keys(b).unwrap(),
            "{name}"
        );
    }
}

#[test]
fn heart_tucks_beneath_both_triangles_without_splitting_or_moving_them() {
    let doc = sequence("heart");
    let mut bridge = Bridge::new();
    let at = prefix(&mut bridge, &doc, 9);
    let parent = bridge.state(at).unwrap().clone();
    let step = &doc["steps"][9];
    let points: Vec<[f64; 2]> = vec![
        serde_json::from_value(step["op"]["target"].clone()).unwrap(),
        serde_json::from_value(step["op"]["additionalTargets"][0].clone()).unwrap(),
    ];
    let ids: Vec<_> = points.iter().map(|&p| parent.face_at(p).unwrap()).collect();
    let landed = apply(&mut bridge, at, step);
    let child = bridge.state(landed).unwrap();
    assert_eq!(parent.faces().len(), 16);
    assert_eq!(child.faces().len(), 20); // only the central flap's four faces split
    for id in ids {
        assert_eq!(
            parent.face(id),
            child.face(id),
            "side triangle must stay one uncreased face"
        );
        assert_eq!(
            parent.isometry(id),
            child.isometry(id),
            "side triangle must stay put"
        );
    }
    // A selected target connected to the moving flap cannot be arbitrarily held.
    let mut invalid = step["op"].clone();
    invalid["additionalTargets"] = json!([step["op"]["seed"]["at"]]);
    let op: Op = serde_json::from_value(invalid).unwrap();
    let Outcome::Refused(refusal) = bridge.apply(at, &op, &Choices::default()).unwrap() else {
        panic!("moving target accepted");
    };
    assert_eq!(
        serde_json::to_value(refusal).unwrap()["refusal"]["code"],
        "tuck_target_moves"
    );
}

#[test]
fn heart_tuck_exposes_the_lowered_flap_above_the_stationary_bottom_triangle() {
    let reference: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/fold-design-completion/heart-tuck-layer-order.json"
    ))
    .unwrap();
    let doc = sequence("heart");
    let mut bridge = Bridge::new();
    let at = prefix(&mut bridge, &doc, 9);
    let step = &doc["steps"][9];
    let correct = apply(&mut bridge, at, step);
    let mut wrong_step = step.clone();
    wrong_step["choices"] = reference["wrongChoices"].clone();
    // Both orders are admissible. Only one represents the tutorial's material
    // relationship; retaining the side triangles alone did not catch this.
    let wrong = apply(&mut bridge, at, &wrong_step);
    for witness in reference["witnesses"].as_array().unwrap() {
        let upper: [f64; 2] = serde_json::from_value(witness["loweredFlap"].clone()).unwrap();
        let lower: [f64; 2] = serde_json::from_value(witness["stationaryBottom"].clone()).unwrap();
        for (state, expected) in [(correct, true), (wrong, false)] {
            let child = bridge.state(state).unwrap();
            let a = child.image_of(upper).unwrap();
            let b = child.image_of(lower).unwrap();
            assert!((a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9);
            assert_eq!(
                child.seen_above(child.face_at(upper).unwrap(), child.face_at(lower).unwrap()),
                Some(expected),
                "the lowered flap must cover the bottom triangle at {upper:?}"
            );
            if expected {
                assert_eq!(child.stack_at(a).unwrap()[0], child.face_at(upper).unwrap());
            }
        }
    }
}

#[test]
fn swan_wraps_neck_and_head_outside_and_rejects_the_wrong_neck_kind() {
    let doc = sequence("swan");
    assert_eq!(doc["steps"][8]["op"]["kind"], "outside-reverse");
    assert_eq!(doc["steps"][9]["op"]["kind"], "outside-reverse");
    let mut bridge = Bridge::new();
    let at = prefix(&mut bridge, &doc, 8);
    let mut wrong = doc["steps"][8]["op"].clone();
    wrong["kind"] = json!("inside-reverse");
    let op: Op = serde_json::from_value(wrong).unwrap();
    let choices: Choices = serde_json::from_value(doc["steps"][8]["choices"].clone()).unwrap();
    let Outcome::Refused(refusal) = bridge.apply(at, &op, &choices).unwrap() else {
        panic!("wrong neck accepted");
    };
    assert_eq!(
        serde_json::to_value(refusal).unwrap()["refusal"]["code"],
        "reverse_kind_infeasible"
    );
}

#[test]
fn multi_target_tuck_is_independent_of_target_order_and_duplicate_witnesses() {
    let doc = sequence("heart");
    let mut bridge = Bridge::new();
    let at = prefix(&mut bridge, &doc, 9);
    let original = &doc["steps"][9];
    let expected = apply(&mut bridge, at, original);
    let keys = bridge.canonical_keys(expected).unwrap();
    let mut swapped = original.clone();
    swapped["op"]["target"] = original["op"]["additionalTargets"][0].clone();
    swapped["op"]["additionalTargets"] =
        json!([original["op"]["target"], original["op"]["target"]]);
    let landed = apply(&mut bridge, at, &swapped);
    assert_eq!(bridge.canonical_keys(landed).unwrap(), keys);
    // The same physical placement seen from the back uses the opposite direction.
    let turned = apply(
        &mut bridge,
        at,
        &json!({"op":{"kind":"turn","axis":"vertical"}}),
    );
    let mut back = original.clone();
    back["op"]["direction"] = json!("mountain");
    let tucked = apply(&mut bridge, turned, &back);
    let front = apply(
        &mut bridge,
        tucked,
        &json!({"op":{"kind":"turn","axis":"vertical"}}),
    );
    assert_eq!(bridge.canonical_keys(front).unwrap(), keys);
}

#[test]
fn tutorial_order_swivel_probes_keep_their_geometric_refusals() {
    let cases: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/fold-design-completion/bird-swivel-refusals.json"
    ))
    .unwrap();
    for name in ["swan", "crane"] {
        let mut bridge = Bridge::new();
        let at = prefix(&mut bridge, &cases["prefixes"][name], usize::MAX);
        for probe in cases["probes"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| p["model"] == name)
        {
            let op: Op = serde_json::from_value(probe["op"].clone()).unwrap();
            let Outcome::Refused(refusal) = bridge.apply(at, &op, &Choices::default()).unwrap()
            else {
                panic!("the guarded swivel probe unexpectedly landed: {name}");
            };
            assert_eq!(
                serde_json::to_value(refusal).unwrap()["refusal"]["code"],
                probe["refusal"]
            );
        }
    }
}
