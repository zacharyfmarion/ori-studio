//! The reverse fold through the bridge, in the JSON the web app sends (plan
//! Phase 9): the document's `inside-reverse` and `outside-reverse` ops land
//! the preliminary base from the triangle; the compound question
//! (`compound_analysis`) says which kinds land and what is still to choose;
//! a step lacking a choice it needs
//! is `choice_needed`, one whose stored choice no longer resolves is
//! `choice_broken`, and a kind that does not land offers the other; an
//! opening and an order chosen through the query land and replay; and a
//! landed reverse fold's summary and picture are asked of the child.

#![cfg(not(target_arch = "wasm32"))]

use oristudio_fold::random::{self, Rng};
use oristudio_fold::{PlainFold, ReverseFold, Seed, Side, State};
use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::canonical::canonical_keys;
use oristudio_fold_wasm::wire::{BridgeError, Choices, Op, Outcome, Paper};
use serde::Serialize;
use serde_json::{Value, json};

fn op(value: Value) -> Op {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("op {value}: {e}"))
}

fn choices(value: Value) -> Choices {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("choices {value}: {e}"))
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

fn applied(bridge: &mut Bridge, state: u32, step: Value, chosen: Value) -> Value {
    json_of(
        &bridge
            .apply(state, &op(step.clone()), &choices(chosen))
            .unwrap_or_else(|e| panic!("{step}: {e}")),
    )
}

/// Apply and expect a landing: the new handle and the result.
fn land(bridge: &mut Bridge, state: u32, step: Value, chosen: Value) -> (u32, Value) {
    let result = applied(bridge, state, step.clone(), chosen);
    assert_eq!(result["status"], "ok", "{step}: {result}");
    let handle = result["state"]
        .as_u64()
        .unwrap_or_else(|| panic!("{result}"));
    (
        u32::try_from(handle).unwrap_or_else(|e| panic!("{e}")),
        result,
    )
}

/// Apply and expect a refusal.
fn refuse(bridge: &mut Bridge, state: u32, step: Value, chosen: Value) -> Value {
    let result = applied(bridge, state, step.clone(), chosen);
    assert_eq!(result["status"], "refused", "{step}: {result}");
    result
}

/// The compound question of a reverse fold: its family's answer.
fn ask(bridge: &Bridge, state: u32, step: Value, chosen: Value) -> Value {
    let asked = json_of(
        &bridge
            .compound_analysis(state, &op(step.clone()), &choices(chosen))
            .unwrap_or_else(|e| panic!("{step}: {e}")),
    );
    if asked["status"] == "ok" {
        assert_eq!(asked["family"], "reverse", "{asked}");
    }
    asked
}

fn ok<T: Serialize>(outcome: Result<Outcome<T>, BridgeError>) -> Value {
    let outcome = json_of(&outcome.unwrap_or_else(|e| panic!("{e}")));
    assert_eq!(outcome["status"], "ok", "{outcome}");
    outcome
}

/// The square valley-folded along the diagonal bd, a = (0, 0) onto
/// c = (1, 1): the triangle b c d (the engine's spike case 1).
fn triangle(bridge: &mut Bridge) -> u32 {
    let square = sheet(bridge, json!({ "kind": "square" }));
    land(
        bridge,
        square,
        json!({
            "kind": "valley",
            "line": { "via": "free", "through": [[1.0, 0.0], [0.0, 1.0]] },
            "moving": [0.1, 0.1],
            "seed": { "scope": "all" }
        }),
        json!({}),
    )
    .0
}

/// A reverse fold of the triangle's corner b along y = ½, as the document
/// stores it: a free line through two sheet points on it, the tip side by a
/// sheet point.
fn corner_b(kind: &str) -> Value {
    json!({
        "kind": kind,
        "line": { "via": "free", "through": [[0.6, 0.5], [0.9, 0.5]] },
        "moving": [0.9, 0.2],
        "seed": { "scope": "all" }
    })
}

/// The triangle's corner b along x = ½, where only an outside fold lands
/// (the engine's case 1b).
fn corner_b_across(kind: &str) -> Value {
    json!({
        "kind": kind,
        "line": { "via": "free", "through": [[0.5, 0.6], [0.5, 0.9]] },
        "moving": [0.9, 0.5],
        "seed": { "scope": "all" }
    })
}

/// The triangle's corner d along x = ½.
fn corner_d(kind: &str) -> Value {
    json!({
        "kind": kind,
        "line": { "via": "free", "through": [[0.5, 0.6], [0.5, 0.9]] },
        "moving": [0.2, 0.9],
        "seed": { "scope": "all" }
    })
}

#[test]
fn two_inside_reverses_of_the_triangle_land_the_preliminary_base() {
    let mut bridge = Bridge::new();
    let tri = triangle(&mut bridge);
    let (first, landed) = land(&mut bridge, tri, corner_b("inside-reverse"), json!({}));
    assert_eq!(landed["report"], Value::Null);
    let report = &landed["compound"];
    assert_eq!(report["family"], "reverse");
    assert_eq!(report["kind"], "inside");
    assert_eq!(report["openings"].as_array().map(Vec::len), Some(1));
    // Its motion: a spread and a close, the blocks turning opposite ways.
    let legs = report["motion"]["legs"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(legs.len(), 2);
    assert_eq!(legs[0]["name"], "spread");
    assert_eq!(legs[1]["stacking"], "landed");
    assert_eq!(landed["summary"]["faces"], 4);

    let (base, landed) = land(&mut bridge, first, corner_d("inside-reverse"), json!({}));
    assert_eq!(landed["summary"]["faces"], 6);
    // The diagonal bd's halves and the four half midlines, every corner on c.
    let creases = &landed["summary"]["creases"];
    assert_eq!(creases["border"], 8);
    assert_eq!(creases["flat"], 0);
    assert_eq!(
        creases["mountain"].as_u64().unwrap_or(0) + creases["valley"].as_u64().unwrap_or(0),
        6
    );

    // The step's summary and picture, asked of the child.
    let summary = ok(bridge.step_summary(base));
    assert_eq!(summary["summary"]["layers"], 2);
    assert!(
        summary["summary"]["diff"]["reversed"]
            .as_array()
            .is_some_and(|r| !r.is_empty())
    );
    let action = ok(bridge.step_action(base));
    assert_eq!(action["action"]["direction"], "mountain");
    assert!(action["action"]["push"].is_object());
    assert!(action["action"]["grip"]["hidden_image"].is_number());
    // And before it lands, from its parent.
    let before = ok(bridge.action(first, &op(corner_d("inside-reverse")), &Choices::default()));
    assert_eq!(before["action"]["push"], action["action"]["push"]);
    // What moves, as a fold's analysis reads.
    let analysis = ok(bridge.analyse(first, &op(corner_d("inside-reverse")), &Choices::default()));
    assert_eq!(analysis["analysis"]["direction"], "mountain");
    assert_eq!(analysis["analysis"]["picked"], json!([0]));
}

#[test]
fn the_query_says_which_kinds_land_and_the_other_kind_is_the_fix() {
    let mut bridge = Bridge::new();
    let tri = triangle(&mut bridge);
    // Along y = ½ only the inside fold lands; along x = ½ only the outside.
    let asked = ask(&bridge, tri, corner_b("inside-reverse"), json!({}));
    assert_eq!(asked["status"], "ok", "{asked}");
    assert_eq!(asked["kinds"], json!(["inside"]));
    assert_eq!(asked["opening"], false);
    assert_eq!(asked["orders"], json!([]));
    assert_eq!(asked["analysis"]["flaps"].as_array().map(Vec::len), Some(1));
    // Of both kinds, whichever the op names.
    let other = ask(&bridge, tri, corner_b_across("inside-reverse"), json!({}));
    assert_eq!(other["kinds"], json!(["outside"]));

    let refused = refuse(
        &mut bridge,
        tri,
        corner_b_across("inside-reverse"),
        json!({}),
    );
    assert_eq!(refused["refusal"]["code"], "reverse_kind_infeasible");
    assert_eq!(refused["refusal"]["kind"], "inside");
    assert_eq!(
        refused["fixes"],
        json!([{ "fix": "other_kind", "kind": "outside" }])
    );
    assert!(refused["faces"].as_array().is_some_and(|f| !f.is_empty()));
    let (_, wrapped) = land(
        &mut bridge,
        tri,
        corner_b_across("outside-reverse"),
        json!({}),
    );
    assert_eq!(wrapped["compound"]["kind"], "outside");

    // A plain fold is not asked about here.
    let plain = bridge.compound_analysis(
        tri,
        &op(json!({
            "kind": "valley",
            "line": { "via": "free", "through": [[0.6, 0.5], [0.9, 0.5]] },
            "moving": [0.9, 0.2],
            "seed": { "scope": "all" }
        })),
        &Choices::default(),
    );
    assert!(matches!(plain, Err(BridgeError::InvalidInput(_))));
    // A single layer has no spine to open along.
    let square = sheet(&mut bridge, json!({ "kind": "square" }));
    let flat = refuse(&mut bridge, square, corner_b("inside-reverse"), json!({}));
    assert_eq!(flat["refusal"]["code"], "reverse_no_opening");
    assert_eq!(flat["refusal"]["cause"], "no_spine");
}

/// A book fold, then another: the strip [0, ¼] × [0, 1] in four layers, its
/// lower half reversed along y = ½ opens two ways (the engine's case 2a).
#[test]
fn an_opening_is_chosen_through_the_query_and_stored() {
    let mut bridge = Bridge::new();
    let square = sheet(&mut bridge, json!({ "kind": "square" }));
    let fold_at = |x: f64, moving: f64| {
        json!({
            "kind": "valley",
            "line": { "via": "free", "through": [[x, 0.1], [x, 0.9]] },
            "moving": [moving, 0.5],
            "seed": { "scope": "all" }
        })
    };
    let (book, _) = land(&mut bridge, square, fold_at(0.5, 0.9), json!({}));
    let (strip, _) = land(&mut bridge, book, fold_at(0.25, 0.4), json!({}));
    let step = json!({
        "kind": "inside-reverse",
        "line": { "via": "free", "through": [[0.05, 0.5], [0.2, 0.5]] },
        "moving": [0.1, 0.2],
        "seed": { "scope": "all" }
    });
    let asked = ask(&bridge, strip, step.clone(), json!({}));
    assert_eq!(asked["opening"], true);
    assert_eq!(asked["kinds"], json!([]));
    let openings = asked["analysis"]["flaps"][0]["openings"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(openings.len(), 2);

    let needed = refuse(&mut bridge, strip, step.clone(), json!({}));
    assert_eq!(
        needed["refusal"],
        json!({ "code": "choice_needed", "choice": "opening" })
    );

    let chosen = json!({ "opening": [openings[1]["stored"]] });
    let asked = ask(&bridge, strip, step.clone(), chosen.clone());
    assert_eq!(asked["kinds"], json!(["inside", "outside"]));
    assert_eq!(asked["opening"], false);
    assert_eq!(asked["orders"], json!([]));
    let (_, landed) = land(&mut bridge, strip, step.clone(), chosen.clone());
    assert_eq!(landed["compound"]["stored"]["openings"], chosen["opening"]);
    assert_eq!(landed["summary"]["faces"], 8);

    // A stored opening that names no opening of the tip breaks the step.
    let broken = refuse(
        &mut bridge,
        strip,
        step,
        json!({ "opening": [{ "upper": [[3.0, 3.0]] }] }),
    );
    assert_eq!(broken["refusal"]["code"], "choice_broken");
    assert_eq!(broken["refusal"]["broken"], "witness");
}

/// Case s1-287 of the engine's seeded campaign, landed through the bridge:
/// its plain folds as model-line steps, then the reverse fold that leaves
/// two orders.
#[test]
fn an_order_is_chosen_through_the_query_and_replays() {
    let (folds, reverse, state) = campaign_case(1, 287);
    let mut bridge = Bridge::new();
    let mut handle = sheet(&mut bridge, json!({ "kind": "square" }));
    for fold in &folds {
        handle = land(&mut bridge, handle, plain_step(fold), json!({})).0;
    }
    let mut want = canonical_keys(&state);
    let mut have = bridge
        .canonical_keys(handle)
        .unwrap_or_else(|e| panic!("{e}"));
    want.sort();
    have.sort();
    assert_eq!(have, want, "the bridge folds the campaign's state");

    let step = reverse_step(&reverse);
    let asked = ask(&bridge, handle, step.clone(), json!({}));
    let listed = asked["orders"]
        .as_array()
        .and_then(|per| per.iter().find(|o| o["kind"] == "inside"))
        .cloned()
        .unwrap_or_else(|| panic!("no inside orders: {asked}"));
    assert_eq!(listed["count"], json!({ "orders": 2, "exact": true }));
    assert_eq!(listed["more"], false);
    let orders = listed["orders"].as_array().cloned().unwrap_or_default();
    assert_eq!(orders.len(), 2);
    // The shared chooser addresses either witness directly, without a list cap.
    // Existing completion choices must not suppress the alternatives.
    use oristudio_fold_wasm::order_selection::OrderQuery;
    for index in 0..2 {
        let result = bridge
            .order_selection(
                handle,
                &op(step.clone()),
                &choices(json!({"completion": orders[0]})),
                &OrderQuery {
                    index,
                    ..Default::default()
                },
            )
            .unwrap();
        let value = json_of(&result);
        assert_eq!(value["count"], json!({"orders": 2, "exact": true}));
        assert_eq!(value["completion"], orders[index as usize]);
        let preserved = bridge
            .order_selection(
                handle,
                &op(step.clone()),
                &Choices::default(),
                &OrderQuery {
                    index: 1 - index,
                    prefer: Some(serde_json::from_value(value["relations"].clone()).unwrap()),
                    per_component: Some(4000),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(json_of(&preserved)["completion"], orders[index as usize]);
        assert_eq!(json_of(&preserved)["index"], index);
    }
    let limited = bridge
        .order_selection(
            handle,
            &op(step.clone()),
            &Choices::default(),
            &OrderQuery {
                per_component: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
    let limited = json_of(&limited);
    assert_eq!(
        limited["count"],
        json!({"orders": 1, "exact": false}),
        "a bounded single result is not unique"
    );

    // A stored order lists them still, for a chooser moving between them.
    let again = ask(
        &bridge,
        handle,
        step.clone(),
        json!({ "completion": orders[1] }),
    );
    assert_eq!(again["orders"], asked["orders"]);
    assert_eq!(
        refuse(&mut bridge, handle, step.clone(), json!({}))["refusal"],
        json!({ "code": "choice_needed", "choice": "completion" })
    );
    let mut landed = Vec::new();
    for order in &orders {
        let (child, result) = land(
            &mut bridge,
            handle,
            step.clone(),
            json!({ "completion": order }),
        );
        assert_eq!(&result["compound"]["stored"]["order"], order);
        landed.push(
            bridge
                .canonical_keys(child)
                .unwrap_or_else(|e| panic!("{e}")),
        );
    }
    assert_ne!(landed[0], landed[1], "each order lands a state of its own");
    // Replayed, the stored order lands the state it was chosen as.
    let (again, _) = land(
        &mut bridge,
        handle,
        step,
        json!({ "completion": orders[0] }),
    );
    assert_eq!(
        bridge
            .canonical_keys(again)
            .unwrap_or_else(|e| panic!("{e}")),
        landed[0]
    );
}

/// The draws of the engine's campaign case (`tests/reverse.rs`): the plain
/// folds `random::folded` lands — the same draws, recorded — and the reverse
/// fold drawn after them.
fn campaign_case(seed: u64, i: u64) -> (Vec<PlainFold>, ReverseFold, State) {
    let mut rng = Rng::new(seed * 7777 + i);
    assert!(!rng.chance(0.2), "case s{seed}-{i} starts from a rectangle");
    let mut state = State::flat(
        oristudio_fold::Sheet::square(),
        oristudio_fold::StartSide::Front,
    )
    .unwrap_or_else(|e| panic!("{e}"));
    let want = 1 + rng.below(4);
    let mut folds = Vec::new();
    for _ in 0..10 {
        if folds.len() >= want {
            break;
        }
        let Some(fold) = random::plain_fold(&state, &mut rng) else {
            continue;
        };
        if let Ok(folded) = state.fold(&fold) {
            state = folded.state;
            folds.push(fold);
        }
    }
    for _ in 0..6 {
        let Some(reverse) = random::reverse_fold(&state, &mut rng, 0.2) else {
            continue;
        };
        let Ok(analysis) = state.analyse_reverse(&reverse) else {
            continue;
        };
        if analysis.flaps.iter().all(|f| !f.openings.is_empty()) {
            return (folds, reverse, state);
        }
    }
    panic!("case s{seed}-{i} draws no reverse fold");
}

fn side_of(side: Side) -> &'static str {
    match side {
        Side::Positive => "positive",
        Side::Negative => "negative",
    }
}

fn seed_of(seed: &Seed) -> Value {
    match seed {
        Seed::All => json!({ "scope": "all" }),
        Seed::Depth { at, layers } => json!({ "scope": "depth", "at": at, "layers": layers }),
        Seed::Flaps { at } => json!({ "scope": "flaps", "at": at }),
    }
}

fn plain_step(fold: &PlainFold) -> Value {
    json!({
        "kind": json_of(&fold.direction),
        "line": { "via": "model", "line": { "n": fold.line.n, "d": fold.line.d } },
        "side": side_of(fold.side),
        "seed": seed_of(&fold.seed),
    })
}

fn reverse_step(reverse: &ReverseFold) -> Value {
    json!({
        "kind": "inside-reverse",
        "line": { "via": "model", "line": { "n": reverse.line.n, "d": reverse.line.d } },
        "side": side_of(reverse.side),
        "seed": seed_of(&reverse.anchor),
    })
}
