//! Partial precreases through the bridge, natively, in the document's own
//! shapes: a precrease with an `extent` lands crease marks that the
//! summaries, the scene, the landmarks and the `fs1` keys carry; `analyse`
//! and `action` answer it before it lands; a malformed extent is the
//! caller's mistake and an extent that does not resolve is a refusal.
//! `tests/partial_node.rs` crosses the wasm boundary.

#![cfg(not(target_arch = "wasm32"))]

use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::wire::{BridgeError, Choices, ExtentInput, Op, Outcome, Paper};
use serde::Serialize;
use serde_json::{Value, json};

fn op(value: Value) -> Op {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("op {value}: {e}"))
}

fn json_of(value: &impl Serialize) -> Value {
    serde_json::to_value(value).unwrap_or_else(|e| panic!("{e}"))
}

fn sheet(bridge: &mut Bridge, shape: Value) -> u32 {
    let paper: Paper = serde_json::from_value(json!({ "shape": shape, "startSide": "front" }))
        .unwrap_or_else(|e| panic!("{e}"));
    match bridge.sheet(&paper) {
        Outcome::Ok(made) => made.state,
        Outcome::Refused(r) => panic!("{:?}", r.refusal),
    }
}

/// A precrease along x = 0.5, the right side moving, with `extent`.
fn precrease(extent: Option<Value>) -> Value {
    let mut step = json!({
        "kind": "precrease",
        "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] },
        "direction": "valley",
        "moving": [0.9, 0.5],
        "seed": { "scope": "all" }
    });
    if let Some(extent) = extent {
        step["extent"] = extent;
    }
    step
}

fn pinch(at: [f64; 2], length: f64) -> Value {
    json!({ "kind": "pinch", "at": { "kind": "point", "at": at }, "length": length })
}

fn land(bridge: &mut Bridge, state: u32, step: Value, choices: Value) -> (u32, Value) {
    let chosen: Choices = serde_json::from_value(choices).unwrap_or_else(|e| panic!("{e}"));
    match bridge.apply(state, &op(step.clone()), &chosen) {
        Ok(Outcome::Ok(applied)) => (applied.state, json_of(&applied)),
        Ok(Outcome::Refused(r)) => panic!("{step} refused: {}", json_of(&r)),
        Err(e) => panic!("{step}: {e}"),
    }
}

fn refusal_code(bridge: &mut Bridge, state: u32, step: Value) -> Value {
    match bridge.apply(state, &op(step.clone()), &Choices::default()) {
        Ok(Outcome::Refused(r)) => json_of(&r)["refusal"]["code"].clone(),
        Ok(Outcome::Ok(applied)) => panic!("{step} landed: {}", json_of(&applied)),
        Err(e) => panic!("{step}: {e}"),
    }
}

fn mark_keys(bridge: &Bridge, state: u32) -> Vec<String> {
    let mut keys: Vec<String> = bridge
        .canonical_keys(state)
        .unwrap_or_else(|e| panic!("{e}"))
        .into_iter()
        .filter(|k| k.starts_with("m:"))
        .collect();
    keys.sort();
    keys
}

#[test]
fn a_pinch_lands_marks_every_query_carries() {
    let mut bridge = Bridge::new();
    let flat = sheet(&mut bridge, json!({ "kind": "square" }));
    let length = bridge
        .default_pinch_length(flat)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(length, 1.0 / 16.0);
    let (pinched, applied) = land(
        &mut bridge,
        flat,
        precrease(Some(pinch([0.5, 0.5], length))),
        json!({}),
    );
    // A plain fold's report with nothing created, and the marks counted.
    assert_eq!(applied["report"]["created"], json!([]));
    assert_eq!(applied["report"]["direction"], "valley");
    assert_eq!(applied["summary"]["crease_marks"], 1);
    assert_eq!(applied["summary"]["creases"]["flat"], 0);
    assert_eq!(applied["summary"]["faces"], 1);

    let summary = json_of(
        &bridge
            .step_summary(pinched)
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert_eq!(summary["summary"]["diff"]["marks_added"], 1);
    assert_eq!(summary["summary"]["diff"]["added"], json!([]));
    assert_eq!(summary["summary"]["layers"], 1);

    // The picture is the pinch.
    let acted = json_of(
        &bridge
            .step_action(pinched)
            .unwrap_or_else(|e| panic!("{e}")),
    );
    let line = &acted["action"]["line"];
    let ys = [
        line[0]["y"].as_f64().unwrap_or_default(),
        line[1]["y"].as_f64().unwrap_or_default(),
    ];
    assert!(((ys[0] - ys[1]).abs() - length).abs() < 1e-12, "{line}");

    // The scene and the landmarks carry the mark.
    let scene = json_of(&bridge.scene(pinched).unwrap_or_else(|e| panic!("{e}")));
    assert_eq!(scene["crease_marks"].as_array().map(Vec::len), Some(1));
    assert_eq!(scene["crease_marks"][0]["letter"], "valley");
    assert_eq!(scene["aux_lines"].as_array().map(Vec::len), Some(1));
    let landmarks = json_of(
        &bridge
            .landmarks(pinched, &[])
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert_eq!(landmarks["crease_marks"].as_array().map(Vec::len), Some(1));
    let ends = landmarks["points"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|p| p["sources"].as_array().cloned().unwrap_or_default())
        .filter(|s| s["kind"] == "crease_mark_end" && s["crease_mark"] == 0)
        .count();
    assert_eq!(ends, 2);

    // `fs1`: the sheet's keys and one for the mark.
    let mut before = bridge
        .canonical_keys(flat)
        .unwrap_or_else(|e| panic!("{e}"));
    let mut after = bridge
        .canonical_keys(pinched)
        .unwrap_or_else(|e| panic!("{e}"));
    let marks = mark_keys(&bridge, pinched);
    assert_eq!(marks.len(), 1);
    assert!(marks[0].ends_with(":V"), "{marks:?}");
    after.retain(|k| !k.starts_with("m:"));
    before.sort();
    after.sort();
    assert_eq!(after, before);
    // Another letter, or another place, is another key.
    let mut mountain = precrease(Some(pinch([0.5, 0.5], length)));
    mountain["direction"] = json!("mountain");
    let (other, _) = land(&mut bridge, flat, mountain, json!({}));
    assert_ne!(mark_keys(&bridge, other), marks);
    let (moved, _) = land(
        &mut bridge,
        flat,
        precrease(Some(pinch([0.5, 0.4], length))),
        json!({}),
    );
    assert_ne!(mark_keys(&bridge, moved), marks);

    // A later precrease of the whole line takes the mark into its crease.
    let (creased, applied) = land(&mut bridge, pinched, precrease(None), json!({}));
    assert!(
        applied["summary"].get("crease_marks").is_none(),
        "{applied}"
    );
    assert!(mark_keys(&bridge, creased).is_empty());
}

#[test]
fn a_whole_precrease_is_unchanged() {
    let mut bridge = Bridge::new();
    let flat = sheet(&mut bridge, json!({ "kind": "square" }));
    let (state, applied) = land(&mut bridge, flat, precrease(None), json!({}));
    assert_eq!(
        applied["report"]["created"].as_array().map(Vec::len),
        Some(1)
    );
    assert!(applied["summary"].get("crease_marks").is_none());
    assert!(mark_keys(&bridge, state).is_empty());
    let summary = json_of(&bridge.step_summary(state).unwrap_or_else(|e| panic!("{e}")));
    assert!(summary["summary"]["diff"].get("marks_added").is_none());
    let scene = json_of(&bridge.scene(state).unwrap_or_else(|e| panic!("{e}")));
    assert!(scene.get("crease_marks").is_none());
}

#[test]
fn segments_take_points_and_marks_and_axioms_their_roots() {
    let mut bridge = Bridge::new();
    let flat = sheet(
        &mut bridge,
        json!({ "kind": "rectangle", "aspect": [1.0, 0.5] }),
    );
    assert_eq!(
        bridge
            .default_pinch_length(flat)
            .unwrap_or_else(|e| panic!("{e}")),
        0.5 / 16.0
    );
    // A segment named by a mark's point and a sheet point, beside the line:
    // both project onto it.
    let step = json!({
        "kind": "precrease",
        "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 0.5]] },
        "direction": "valley",
        "moving": [0.9, 0.25],
        "seed": { "scope": "all" },
        "extent": {
            "kind": "segment",
            "from": { "kind": "mark", "at": [0.45, 0.1], "mark": "fmark-1" },
            "to": { "kind": "point", "at": [0.5, 0.4] }
        }
    });
    let (state, _) = land(&mut bridge, flat, step, json!({}));
    let scene = json_of(&bridge.scene(state).unwrap_or_else(|e| panic!("{e}")));
    let mark = &scene["crease_marks"][0];
    let ys = [
        mark["from"]["y"].as_f64().unwrap_or_default(),
        mark["to"]["y"].as_f64().unwrap_or_default(),
    ];
    assert!((ys[0].min(ys[1]) - 0.1).abs() < 1e-12 && (ys[0].max(ys[1]) - 0.4).abs() < 1e-12);
    assert!((mark["from"]["x"].as_f64().unwrap_or_default() - 0.5).abs() < 1e-12);

    // Along an axiom: O1 through a corner and a side's middle, its root
    // stored.
    let axiom = json!({
        "kind": "precrease",
        "line": {
            "via": "axiom", "axiom": 1,
            "inputs": [{ "kind": "point", "at": [0.0, 0.0] }, { "kind": "point", "at": [1.0, 0.5] }]
        },
        "direction": "mountain",
        "moving": [0.9, 0.1],
        "seed": { "scope": "all" },
        "extent": pinch([0.5, 0.25], 0.05)
    });
    let root =
        json!({ "root": { "n": [-0.5 / 1.25_f64.sqrt(), 1.0 / 1.25_f64.sqrt()], "d": 0.0 } });
    let (state, _) = land(&mut bridge, flat, axiom, root);
    let scene = json_of(&bridge.scene(state).unwrap_or_else(|e| panic!("{e}")));
    assert_eq!(scene["crease_marks"][0]["letter"], "mountain");
}

#[test]
fn an_extent_that_does_not_resolve_is_refused_by_code() {
    let mut bridge = Bridge::new();
    let flat = sheet(&mut bridge, json!({ "kind": "square" }));
    assert_eq!(
        refusal_code(&mut bridge, flat, precrease(Some(pinch([1.5, 0.5], 0.1)))),
        "extent_off_paper"
    );
    assert_eq!(
        refusal_code(&mut bridge, flat, precrease(Some(pinch([0.5, 0.5], 1e-4)))),
        "extent_too_short"
    );
    let segment = json!({
        "kind": "segment",
        "from": { "kind": "point", "at": [0.2, 0.5] },
        "to": { "kind": "point", "at": [0.8, 0.5] }
    });
    assert_eq!(
        refusal_code(&mut bridge, flat, precrease(Some(segment))),
        "extent_too_short"
    );
    // `analyse` and `action` refuse alike, as values.
    let step = op(precrease(Some(pinch([1.5, 0.5], 0.1))));
    let analysed = json_of(
        &bridge
            .analyse(flat, &step, &Choices::default())
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert_eq!(analysed["status"], "refused");
    assert_eq!(analysed["refusal"]["code"], "extent_off_paper");
    let acted = json_of(
        &bridge
            .action(flat, &step, &Choices::default())
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert_eq!(acted["refusal"]["code"], "extent_off_paper");
    // And answer one that resolves.
    let step = op(precrease(Some(pinch([0.5, 0.5], 0.1))));
    let analysed = json_of(
        &bridge
            .analyse(flat, &step, &Choices::default())
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert_eq!(analysed["status"], "ok");
    assert_eq!(analysed["analysis"]["moving"], json!([0]));
    let acted = json_of(
        &bridge
            .action(flat, &step, &Choices::default())
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert_eq!(acted["action"]["kind"], "precrease");
}

#[test]
fn a_malformed_extent_is_the_callers_mistake() {
    // Not an op at all: an unknown kind, or a key no extent has.
    for extent in [
        json!({ "kind": "half", "at": { "kind": "point", "at": [0.5, 0.5] } }),
        json!({ "kind": "pinch", "at": { "kind": "point", "at": [0.5, 0.5] }, "length": 0.1, "align": "start" }),
        json!({ "kind": "pinch", "at": [0.5, 0.5], "length": 0.1 }),
    ] {
        let step = precrease(Some(extent.clone()));
        assert!(serde_json::from_value::<Op>(step).is_err(), "{extent}");
    }
    // Reads, but names no point, or no finite length.
    let mut bridge = Bridge::new();
    let flat = sheet(&mut bridge, json!({ "kind": "square" }));
    let edge = op(precrease(Some(json!({
        "kind": "segment",
        "from": { "kind": "edge", "a": [0.0, 0.0], "b": [1.0, 0.0] },
        "to": { "kind": "point", "at": [0.5, 0.5] }
    }))));
    // JSON has no infinity; a JS caller can send one.
    let mut infinite = op(precrease(Some(pinch([0.5, 0.5], 0.1))));
    if let Op::Precrease(p) = &mut infinite
        && let Some(ExtentInput::Pinch { length, .. }) = &mut p.extent
    {
        *length = f64::INFINITY;
    }
    for step in [edge, infinite] {
        let thrown = bridge.apply(flat, &step, &Choices::default());
        assert!(
            matches!(thrown, Err(BridgeError::InvalidInput(_))),
            "{thrown:?}"
        );
    }
}

/// Over random states, a pinch's `fs1` keys are its parent's and one `m:`
/// key per mark, so `fs1` changes with the marks; a later fold's keep one
/// per mark it carries.
#[test]
fn fs1_keys_follow_the_marks_over_random_sequences() {
    use oristudio_fold::random::{self, Rng, Sequence};
    use oristudio_fold::{Extent, State};
    use oristudio_fold_wasm::canonical::canonical_keys;

    let keys = |state: &State| {
        let mut keys = canonical_keys(state);
        keys.sort();
        keys
    };
    let without_marks = |state: &State| {
        let mut keys = keys(state);
        keys.retain(|k| !k.starts_with("m:"));
        keys
    };
    // The marks as geometry: their ends, to a nanometre of the sheet, and
    // their letters.
    let signature = |state: &State| {
        let at = |p: [f64; 2]| ((p[0] * 1e9).round() as i64, (p[1] * 1e9).round() as i64);
        let mut marks: Vec<_> = state
            .crease_marks()
            .iter()
            .map(|m| {
                let (a, b) = (at(m.a), at(m.b));
                (a.min(b), a.max(b), format!("{:?}", m.letter))
            })
            .collect();
        marks.sort();
        marks
    };
    let mut rng = Rng::new(0x51);
    let (mut pinched, mut carried) = (0, 0);
    for seed in 0..40u64 {
        let Ok(sequence) = Sequence::new(seed, 1 + (seed % 5) as usize, 40) else {
            continue;
        };
        let mut state = sequence.state().clone();
        for step in sequence {
            if let Some(s) = step.state() {
                state = s.clone();
            }
        }
        for _ in 0..4 {
            let Some(op) = random::plain_fold(&state, &mut rng) else {
                continue;
            };
            // A pinch at a drawn face's centre, taken onto the line.
            let faces = state.faces();
            let Some(face) = faces.get(rng.below(faces.len())) else {
                continue;
            };
            let Some(image) = state.face_image(face.id) else {
                continue;
            };
            let n = image.len() as f64;
            let centre = image
                .iter()
                .fold([0.0, 0.0], |s, p| [s[0] + p[0] / n, s[1] + p[1] / n]);
            let Some((_, at)) = state.top_visible_at(op.line.project_point(centre)) else {
                continue;
            };
            let Ok(marked) = state.precrease_extent(&op, &Extent::Pinch { at, length: 0.05 })
            else {
                continue;
            };
            pinched += 1;
            let child = &marked.state;
            assert_eq!(without_marks(child), without_marks(&state));
            let marks = keys(child)
                .into_iter()
                .filter(|k| k.starts_with("m:"))
                .count();
            assert_eq!(marks, child.crease_marks().len());
            // The keys differ exactly when the marks do: a pinch over one just
            // like it (the same place, the same letter) lands the same state.
            assert_eq!(
                keys(child) != keys(&state),
                signature(child) != signature(&state)
            );
            // A later fold: one key per mark it carries.
            if let Some(next) = random::plain_fold(child, &mut rng)
                && let Ok(folded) = child.fold(&next)
            {
                carried += 1;
                let marks = keys(&folded.state)
                    .into_iter()
                    .filter(|k| k.starts_with("m:"))
                    .count();
                assert_eq!(marks, folded.state.crease_marks().len());
            }
            state = marked.state;
        }
    }
    assert!(
        pinched >= 40 && carried >= 30,
        "{pinched} pinched, {carried} carried"
    );
}
