//! The vertex folds on the bridge (`ops_squash_family`), natively, through
//! JSON shaped exactly as the web app sends it: the document's squash,
//! petal, rabbit-ear and swivel ops resolve their sheet anchors in the
//! parent; a stored step replays, or is refused by code (`choice_needed`,
//! `choice_broken` and the engine's own); a choice of orders is held, picked
//! and stored as the document's `completion`, which replays to the state it
//! was picked as; every landing reports as the step's `compound`, family
//! `vertex`; and the compound question names what a tool previews.

#![cfg(not(target_arch = "wasm32"))]

use oristudio_fold::random::{self, Rng};
use oristudio_fold::{PlainFold, Seed, Sheet, StartSide, State};
use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::ops_squash_family::Pending;
use oristudio_fold_wasm::wire::{BridgeError, Choices, Op, Outcome, Paper};
use serde::Serialize;
use serde_json::{Value, json};

type Point = [f64; 2];

fn op(value: Value) -> Op {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("op {value}: {e}"))
}

fn choices(value: Value) -> Choices {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("choices {value}: {e}"))
}

fn json_of(value: &impl Serialize) -> Value {
    serde_json::to_value(value).unwrap_or_else(|e| panic!("{e}"))
}

fn ok<T: Serialize>(outcome: Result<Outcome<T>, BridgeError>) -> Value {
    let outcome = json_of(&outcome.unwrap_or_else(|e| panic!("{e}")));
    assert_eq!(outcome["status"], "ok", "{outcome}");
    outcome
}

fn square(bridge: &mut Bridge) -> u32 {
    let paper: Paper =
        serde_json::from_value(json!({ "shape": { "kind": "square" }, "startSide": "front" }))
            .unwrap_or_else(|e| panic!("{e}"));
    match bridge.sheet(&paper) {
        Outcome::Ok(made) => made.state,
        Outcome::Refused(r) => panic!("{:?}", r.refusal),
    }
}

fn apply(bridge: &mut Bridge, state: u32, step: Value, chosen: Value) -> Value {
    json_of(
        &bridge
            .apply(state, &op(step.clone()), &choices(chosen))
            .unwrap_or_else(|e| panic!("{step}: {e}")),
    )
}

/// The compound question of a vertex op: its family's answer.
fn analysis(bridge: &Bridge, state: u32, step: Value) -> Value {
    let asked = ok(bridge.compound_analysis(state, &op(step), &Choices::default()));
    assert_eq!(asked["family"], "vertex", "{asked}");
    asked
}

fn land(bridge: &mut Bridge, state: u32, step: Value) -> u32 {
    let applied = apply(bridge, state, step.clone(), json!({}));
    assert_eq!(applied["status"], "ok", "{step}: {applied}");
    applied["state"].as_u64().unwrap_or_default() as u32
}

/// A valley through every layer on `toward`'s side of the line through two
/// sheet points, as the document stores it.
fn valley(through: [Point; 2], toward: Point) -> Value {
    json!({
        "kind": "valley",
        "line": { "via": "free", "through": through },
        "moving": toward,
        "seed": { "scope": "all" }
    })
}

/// The sheet point the viewer sees on top at the model point `p`.
fn seen_top(state: &State, p: Point) -> Point {
    seen(state, p, true)
}

/// The sheet point of the layer at the model point `p`, the one the viewer
/// sees on top or the one at the bottom.
fn seen(state: &State, p: Point, top: bool) -> Point {
    let mut stack = state.stack_at(p).unwrap_or_default();
    if state.view().flipped == top {
        stack.reverse();
    }
    state
        .isometry(stack[0])
        .unwrap_or_default()
        .inverse()
        .apply(p)
}

/// The diagonal route's four-layer triangle (the vertex spike's case 1b).
fn small_triangle(bridge: &mut Bridge) -> u32 {
    let sheet = square(bridge);
    let half = land(bridge, sheet, valley([[1.0, 0.0], [0.0, 1.0]], [1.0, 1.0]));
    // (1, 1) lies on (0, 0) now: the line through (0, 0) and the centre.
    land(bridge, half, valley([[0.0, 0.0], [0.5, 0.5]], [0.9, 0.1]))
}

/// The square valley-folded along b d: the two-layer triangle a b d.
fn two_layer_triangle(bridge: &mut Bridge) -> u32 {
    let sheet = square(bridge);
    land(bridge, sheet, valley([[1.0, 0.0], [0.0, 1.0]], [1.0, 1.0]))
}

/// The states `random::folded_between` draws, built through the bridge
/// with the same draws: each drawn plain fold landed by the engine is sent
/// as a valley or mountain along its model line (as `crimp_tuck.rs` builds
/// them; each test file here is a crate of its own).
fn drawn(bridge: &mut Bridge, rng: &mut Rng, least: usize, most: usize) -> (State, u32) {
    assert!(!rng.chance(0.2), "a rectangle; this test draws squares");
    let mut state =
        State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let mut handle = square(bridge);
    let want = least + rng.below(most - least + 1);
    let mut landed = 0;
    for _ in 0..10 {
        if landed >= want {
            break;
        }
        let Some(fold) = random::plain_fold(&state, rng) else {
            continue;
        };
        if let Ok(folded) = state.fold(&fold) {
            state = folded.state;
            handle = land(bridge, handle, plain_step(&fold));
            landed += 1;
        }
    }
    (state, handle)
}

fn plain_step(fold: &PlainFold) -> Value {
    json!({
        "kind": match fold.direction {
            oristudio_fold::Direction::Valley => "valley",
            oristudio_fold::Direction::Mountain => "mountain",
        },
        "line": { "via": "model", "line": json_of(&fold.line) },
        "side": json_of(&fold.side),
        "seed": match &fold.seed {
            Seed::All => json!({ "scope": "all" }),
            Seed::Depth { at, layers } => json!({ "scope": "depth", "at": at, "layers": layers }),
            Seed::Flaps { at } => json!({ "scope": "flaps", "at": at }),
        },
    })
}

/// The two-layer triangle's rabbit ear through both layers, its fourth
/// crease toward `emergent`, the paper inside it across from its right
/// angle staying.
fn ear(emergent: Value) -> Value {
    json!({
        "kind": "rabbit-ear",
        "corners": [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
        "emergent": emergent,
        "seed": { "scope": "all" },
        "stayer": [0.6, 0.35],
        "direction": "valley"
    })
}

#[test]
fn a_squash_lands_and_replays_with_its_report_and_motion() {
    let mut bridge = Bridge::new();
    let tri = small_triangle(&mut bridge);
    let flap = seen_top(
        bridge.state(tri).unwrap_or_else(|e| panic!("{e}")),
        [0.1, 0.5],
    );
    let squash = json!({ "kind": "squash", "flap": flap, "direction": "valley" });

    let analysed = analysis(&bridge, tri, squash.clone());
    assert_eq!(analysed["analysis"]["kind"], "squash");
    assert_eq!(analysed["analysis"]["share"], 0.0);

    let applied = apply(&mut bridge, tri, squash.clone(), json!({}));
    assert_eq!(applied["status"], "ok", "{applied}");
    assert!(applied["report"].is_null());
    let vertex = &applied["compound"];
    assert_eq!(vertex["family"], "vertex");
    assert_eq!(vertex["kind"], "squash");
    assert_eq!(vertex["created"].as_array().map(Vec::len), Some(2));
    assert_eq!(vertex["motion"]["kind"], "visual");
    assert_eq!(vertex["motion"]["legs"].as_array().map(Vec::len), Some(4));
    // Unique: nothing to store.
    assert!(vertex["stored"].as_object().is_some_and(|o| o.is_empty()));
    let child = applied["state"].as_u64().unwrap_or_default() as u32;
    // The step's summary is its diff from the parent.
    let summary = ok(bridge.step_summary(child));
    assert_eq!(
        summary["summary"]["diff"]["added"].as_array().map(Vec::len),
        Some(2)
    );
    // Its picture: the lower crease with its arrow and the push onto the
    // spine, the one the tool previewed, the landed cover at the head.
    let pictured = ok(bridge.step_action(child))["action"].clone();
    let previewed =
        ok(bridge.action(tri, &op(squash.clone()), &Choices::default()))["action"].clone();
    assert_eq!(pictured["kind"], "fold", "{pictured}");
    assert_eq!(pictured["direction"], "valley");
    assert!(
        pictured["line"].is_array() && pictured["push"].is_object(),
        "{pictured}"
    );
    assert!(
        pictured["grip"].is_object() && pictured["pleat"].is_null(),
        "{pictured}"
    );
    assert!(previewed["grip"]["hidden_image"].is_null(), "{previewed}");
    for key in ["line", "spans", "moving", "push"] {
        assert_eq!(pictured[key], previewed[key], "{key}");
    }
    // Every other plain fold's question is still the caller's mistake.
    assert!(matches!(
        bridge.analyse(tri, &op(squash.clone()), &Choices::default()),
        Err(BridgeError::InvalidInput(_))
    ));
    // The tools' call lands the same state, held and reported alike.
    let mut pending = Pending::new();
    let tried = ok(pending.try_fold(&mut bridge, tri, &op(squash), &Choices::default()));
    assert_eq!(tried["result"], "landed");
    assert_eq!(tried["compound"], applied["compound"]);
    let again = tried["state"].as_u64().unwrap_or_default() as u32;
    let parts = |h: u32| bridge.state(h).map(|s| s.parts().clone()).ok();
    assert_eq!(parts(again), parts(child));
    assert_eq!(ok(bridge.step_action(again))["action"], pictured);
    // Its summary and its picture are drawn on its parent, which must still
    // be held.
    assert!(bridge.release(tri));
    assert!(matches!(
        bridge.step_summary(child),
        Err(BridgeError::ParentReleased { .. })
    ));
    assert!(matches!(
        bridge.step_action(child),
        Err(BridgeError::ParentReleased { .. })
    ));
}

/// The two-layer triangle's rabbit ear with its 180° ray (the vertex
/// spike's case 3a) lands one ear — its fourth crease the ridge, so the
/// question lists no orders — and a step stored before kept a `ridge`, and
/// sometimes an order: neither is read, and the step lands the same ear.
#[test]
fn a_rabbit_ear_lands_one_ear_whatever_an_older_step_stored() {
    let mut bridge = Bridge::new();
    let tri = two_layer_triangle(&mut bridge);
    let asked = analysis(&bridge, tri, ear(json!([1.0, 0.0])));
    assert_eq!(asked["analysis"]["kind"], "rabbit-ear");
    assert_eq!(
        asked["analysis"]["candidates"].as_array().map(Vec::len),
        Some(3)
    );
    // Candidates at 180°, 270° and 45°: the 45° ray splits the paper that
    // stays; the other two land.
    assert_eq!(asked["emergents"], json!([true, true, false]), "{asked}");
    assert!(asked.get("ridges").is_none(), "{asked}");
    let step = ear(json!([-1.0, 0.0]));
    let asked = analysis(&bridge, tri, step.clone());
    assert!(asked["orders"].is_null(), "{asked}");

    let mut pending = Pending::new();
    let tried = ok(pending.try_fold(&mut bridge, tri, &op(step.clone()), &Choices::default()));
    assert_eq!(tried["result"], "landed", "{tried}");
    assert!(
        tried["compound"]["stored"]
            .as_object()
            .is_some_and(|o| o.is_empty())
    );
    let landed = tried["state"].as_u64().unwrap_or_default() as u32;
    // Pictured as a fan's crease from its center, with its arrow.
    let pictured = ok(bridge.step_action(landed))["action"].clone();
    assert!(
        pictured["line"].is_array() && pictured["grip"].is_object(),
        "{pictured}"
    );
    assert!(pictured["push"].is_null(), "{pictured}");
    let parts = |bridge: &Bridge, h: u32| bridge.state(h).map(|s| s.parts().clone()).ok();
    let ear_parts = parts(&bridge, landed);

    // An older step: its ridge on a corner's crease, which the folder could
    // pick before.
    let mut older = step.clone();
    older["ridge"] = json!([0.6, -0.3]);
    let replayed = land(&mut bridge, tri, older.clone());
    assert_eq!(parts(&bridge, replayed), ear_parts);
    // And an order over two faces that overlap, stored either way round.
    let state = bridge
        .state(landed)
        .unwrap_or_else(|e| panic!("{e}"))
        .clone();
    let (pair, _) = state
        .order()
        .pairs()
        .next()
        .unwrap_or_else(|| panic!("no pairs"));
    let witness = |f| {
        let ring = &state.face(f).unwrap_or_else(|| unreachable!()).ring;
        let n = ring.len() as f64;
        ring.iter().fold([0.0, 0.0], |c, v| {
            let p = state.vertices()[v.0 as usize];
            [c[0] + p[0] / n, c[1] + p[1] / n]
        })
    };
    let [f, g] = pair.faces();
    for s in [1, -1] {
        let stored = json!({
            "completion": { "faces": [witness(f), witness(g)], "orders": [[0, 1, s]] }
        });
        let replayed = apply(&mut bridge, tri, older.clone(), stored);
        assert_eq!(replayed["status"], "ok", "{replayed}");
        let handle = replayed["state"].as_u64().unwrap_or_default() as u32;
        assert_eq!(parts(&bridge, handle), ear_parts);
    }
}

/// A swivel through every layer of a four-layer stack (seed 6717's drawn
/// state; the vertex campaign's rare fan fold whose fourth crease rising
/// still leaves its layers' order open) leaves six orders: held, picked,
/// stored as `completion`, and replayed to the state picked; the question
/// lists them; without one the step needs a choice, with a witness off the
/// paper it is broken.
#[test]
fn a_swivels_choice_is_held_picked_stored_and_replayed() {
    let mut bridge = Bridge::new();
    let mut rng = Rng::new(6717);
    let (state, stack) = drawn(&mut bridge, &mut rng, 2, 6);
    let vertex = [0.4436590394786357, 0.7632986397979732];
    let toward = [
        [0.4753910246047879, 0.7240438743894912],
        [0.40464276139972694, 0.7953234041560532],
        [0.4843887832532005, 0.7931137946588755],
    ];
    let step = json!({
        "kind": "swivel",
        "vertex": seen_top(&state, vertex),
        "toward": toward.map(|p| seen_top(&state, p)),
        "emergent": [0.6707501901150905, 0.7416833437934075],
        "seed": { "scope": "all" },
        "stayer": seen(&state, [0.45737502364320937, 0.7697157086191782], false),
        "direction": "mountain"
    });

    let mut pending = Pending::new();
    let tried = ok(pending.try_fold(&mut bridge, stack, &op(step.clone()), &Choices::default()));
    assert_eq!(tried["result"], "choose", "{tried}");
    assert_eq!(tried["count"]["orders"], 6);
    assert_eq!(tried["components"], json!([6]));
    let handle = tried["pending"].as_u64().unwrap_or_default() as u32;
    let picked = ok(pending.pick(&mut bridge, handle, &[1]));
    assert_eq!(picked["compound"]["family"], "vertex");
    assert_eq!(picked["compound"]["kind"], "swivel");
    let stored = picked["compound"]["stored"].clone();
    // The document's completion: FOLD triples over witnesses.
    assert!(stored["completion"]["orders"][0].is_array(), "{stored}");
    let picked_state = picked["state"].as_u64().unwrap_or_default() as u32;
    // A pick that names no order.
    let none = json_of(
        &pending
            .pick(&mut bridge, handle, &[6])
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert_eq!(none["refusal"]["code"], "no_such_choice");
    assert!(pending.release(handle));
    assert!(!pending.release(handle));

    // The question lists the orders, each the completion it replays to.
    let asked = analysis(&bridge, stack, step.clone());
    assert_eq!(
        asked["orders"]["count"],
        json!({ "orders": 6, "exact": true })
    );
    let orders = asked["orders"]["orders"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert!(!orders.is_empty() && orders.len() <= 6);
    let parts = |bridge: &Bridge, h: u32| bridge.state(h).map(|s| s.parts().clone()).ok();
    let mut by_order = Vec::new();
    for completion in &orders {
        let landed = land_with(
            &mut bridge,
            stack,
            &step,
            json!({ "completion": completion }),
        );
        by_order.push(parts(&bridge, landed));
    }
    by_order.dedup();
    assert_eq!(by_order.len(), orders.len());

    // Replay with the stored choice: the state picked.
    let replayed = land_with(&mut bridge, stack, &step, stored.clone());
    assert_eq!(parts(&bridge, replayed), parts(&bridge, picked_state));
    // Without it: a choice the step does not store.
    let needed = apply(&mut bridge, stack, step.clone(), json!({}));
    assert_eq!(
        needed["refusal"],
        json!({ "code": "choice_needed", "choice": "completion" })
    );
    // A witness off the paper: broken.
    let mut off = stored.clone();
    off["completion"]["faces"][0] = json!([3.0, 3.0]);
    let broken = apply(&mut bridge, stack, step, off);
    assert_eq!(broken["refusal"]["code"], "choice_broken");
    assert_eq!(broken["refusal"]["broken"], "witness");
}

fn land_with(bridge: &mut Bridge, state: u32, step: &Value, chosen: Value) -> u32 {
    let applied = apply(bridge, state, step.clone(), chosen);
    assert_eq!(applied["status"], "ok", "{applied}");
    applied["state"].as_u64().unwrap_or_default() as u32
}

/// A squash with one order has none to list; a flap the analysis refuses
/// is refused by the question, with the engine's code.
#[test]
fn the_question_of_a_squash() {
    let mut bridge = Bridge::new();
    let small = small_triangle(&mut bridge);
    let flap = seen_top(
        bridge.state(small).unwrap_or_else(|e| panic!("{e}")),
        [0.1, 0.5],
    );
    let squash = analysis(
        &bridge,
        small,
        json!({ "kind": "squash", "flap": flap, "direction": "valley" }),
    );
    assert!(squash["orders"].is_null());
    assert_eq!(squash["emergents"], json!([]));
    // Seen from below, the layers over the flap cover it.
    let covered = json_of(
        &bridge
            .compound_analysis(
                small,
                &op(json!({ "kind": "squash", "flap": flap, "direction": "mountain" })),
                &Choices::default(),
            )
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert_eq!(
        covered["refusal"]["code"], "squash_flap_covered",
        "{covered}"
    );
}

#[test]
fn vertex_refusals_are_codes_with_fixes() {
    let mut bridge = Bridge::new();
    let sheet = square(&mut bridge);
    // One layer: no flap.
    let squash = json!({ "kind": "squash", "flap": [0.3, 0.3], "direction": "valley" });
    let refused = apply(&mut bridge, sheet, squash, json!({}));
    assert_eq!(refused["refusal"]["code"], "squash_no_flap");
    assert_eq!(refused["refusal"]["cause"], "single_layer");
    assert_eq!(refused["faces"], json!([0]));
    // No crease where the petal's H is named.
    let petal = json!({
        "kind": "petal", "crease": [0.3, 0.3], "petal": [0.2, 0.2], "direction": "valley"
    });
    let refused = apply(&mut bridge, sheet, petal, json!({}));
    assert_eq!(refused["refusal"]["code"], "crease_not_found");
    // A swivel's vertex off the paper.
    let swivel = |vertex: Point, emergent: Point| {
        json!({
            "kind": "swivel",
            "vertex": vertex,
            "toward": [[1.0, 0.6], [0.0, 0.6], [0.5, 0.0]],
            "emergent": emergent,
            "seed": { "scope": "all" },
            "stayer": [0.3, 0.9],
            "direction": "valley"
        })
    };
    let refused = apply(
        &mut bridge,
        sheet,
        swivel([1.5, 0.3], [0.0, 1.0]),
        json!({}),
    );
    assert_eq!(refused["refusal"]["code"], "point_off_paper");
    // Its fourth crease straight up splits the paper that stays: refused,
    // offering the two that land, each as one state.
    let refused = apply(
        &mut bridge,
        sheet,
        swivel([0.5, 0.3], [0.0, 1.0]),
        json!({}),
    );
    assert_eq!(
        refused["refusal"]["code"], "fan_fourth_beside_stayer",
        "{refused}"
    );
    let fixes = refused["fixes"].as_array().cloned().unwrap_or_default();
    assert_eq!(fixes.len(), 2);
    for fix in &fixes {
        assert_eq!(fix["fix"], "use_emergent");
        let direction: Point =
            serde_json::from_value(fix["direction"].clone()).unwrap_or_else(|e| panic!("{e}"));
        let landed = apply(&mut bridge, sheet, swivel([0.5, 0.3], direction), json!({}));
        assert_eq!(landed["compound"]["kind"], "swivel", "{landed}");
    }
    // The top layer's ear toward the folded edge runs into the layer
    // below: refused, offering the rays that land.
    let tri = two_layer_triangle(&mut bridge);
    let top = seen_top(
        bridge.state(tri).unwrap_or_else(|e| panic!("{e}")),
        [0.3, 0.3],
    );
    let ear = json!({
        "kind": "rabbit-ear",
        "corners": [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
        "emergent": [1.0, 1.0],
        "seed": { "scope": "depth", "at": top, "layers": 1 },
        "stayer": [0.6, 0.35],
        "direction": "valley"
    });
    let refused = apply(&mut bridge, tri, ear.clone(), json!({}));
    assert_eq!(refused["refusal"]["code"], "fan_ray_blocked", "{refused}");
    let fixes = refused["fixes"].as_array().cloned().unwrap_or_default();
    assert_eq!(fixes.len(), 2);
    assert!(fixes.iter().all(|f| f["fix"] == "use_emergent"));
    // The question says the same of every candidate: the two the fixes
    // offer land, the one asked for does not, and it lists no orders.
    let asked = analysis(&bridge, tri, ear);
    let candidates = asked["analysis"]["candidates"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let emergents = asked["emergents"].as_array().cloned().unwrap_or_default();
    assert_eq!(emergents.len(), candidates.len());
    let landing: Vec<&Value> = candidates
        .iter()
        .zip(&emergents)
        .filter(|(_, lands)| **lands == true)
        .map(|(candidate, _)| candidate)
        .collect();
    let offered: Vec<&Value> = fixes.iter().map(|f| &f["direction"]).collect();
    assert_eq!(landing, offered);
    let asked_for = asked["analysis"]["emergent"].as_u64().unwrap_or(9) as usize;
    assert_eq!(emergents[asked_for], false);
    assert!(asked["orders"].is_null());
    // A pending choice that was never held is the caller's mistake.
    let mut pending = Pending::new();
    assert!(pending.pick(&mut bridge, 7, &[0]).is_err());
}

// ---------------------------------------------------------------------------
// The petal fold, its H named by a precrease or by its two ends

/// The vertex spike's petal landmarks on the preliminary base, in the model
/// frame: H's ends a tan(π/8)/2 along the closed edges from the side
/// corners, the closed point, the open corner and the petal.
const T22: f64 = 0.207_106_781_186_547_5;
const ENDS: [Point; 2] = [[T22, 0.5], [0.5, T22]];
const CLOSED_POINT: Point = [0.5, 0.5];
const OPEN_CORNER: Point = [0.0, 0.0];
const PETAL: Point = [0.26, 0.2];

/// The sheet point under the model point `p` on the layer the viewer sees
/// on top at `near`: for a point on a crease, where no layer is on top.
fn sheet_on_top_near(state: &State, p: Point, near: Point) -> Point {
    let mut stack = state.stack_at(near).unwrap_or_default();
    if state.view().flipped {
        stack.reverse();
    }
    state
        .isometry(stack[0])
        .unwrap_or_default()
        .inverse()
        .apply(p)
}

/// The vertex spike's case 1b through the bridge: the diagonal route
/// squashed, turned over and squashed again.
fn preliminary(bridge: &mut Bridge) -> u32 {
    let squash = |bridge: &Bridge, state: u32, p: Point| {
        let flap = seen_top(bridge.state(state).unwrap_or_else(|e| panic!("{e}")), p);
        json!({ "kind": "squash", "flap": flap, "direction": "valley" })
    };
    let tri = small_triangle(bridge);
    let step = squash(bridge, tri, [0.1, 0.5]);
    let one = land(bridge, tri, step);
    let turned = land(bridge, one, json!({ "kind": "turn", "axis": "vertical" }));
    let step = squash(bridge, turned, [0.1, 0.7]);
    land(bridge, turned, step)
}

/// A valley precrease along a model line, `toward`'s side moving.
fn precrease(bridge: &mut Bridge, state: u32, line: [Point; 2], toward: Point, seed: Seed) -> u32 {
    let [p, q] = line;
    let line = oristudio_geometry::Line::from_points(p, q).unwrap_or_else(|| unreachable!());
    let side = oristudio_fold::Side::of_point(&line, toward).unwrap_or_else(|| unreachable!());
    let fold = PlainFold::new(line, side, oristudio_fold::Direction::Valley).with_seed(seed);
    let mut step = plain_step(&fold);
    step["kind"] = json!("precrease");
    step["direction"] = json!("valley");
    land(bridge, state, step)
}

/// The kite creases on the front flap, each through its top layer (and the
/// one hinged to it), as the engine's vertex cases precrease them.
fn kites(bridge: &mut Bridge, state: u32) -> u32 {
    let sides = [[0.0, 0.5], [0.5, 0.0]];
    let near = [[0.03, 0.44], [0.44, 0.03]];
    let mut s = state;
    for k in 0..2 {
        let at = seen_top(bridge.state(s).unwrap_or_else(|e| panic!("{e}")), near[k]);
        s = precrease(
            bridge,
            s,
            [OPEN_CORNER, ENDS[k]],
            sides[k],
            Seed::Depth { at, layers: 1 },
        );
    }
    s
}

/// The petal fold of the front flap with H through its two ends, as the
/// document stores it.
fn petal_by_ends(state: &State) -> Value {
    let ends = [
        sheet_on_top_near(state, ENDS[0], [0.2, 0.45]),
        sheet_on_top_near(state, ENDS[1], [0.45, 0.2]),
    ];
    json!({
        "kind": "petal",
        "ends": ends,
        "petal": seen_top(state, PETAL),
        "direction": "valley"
    })
}

// --- The swivel by its edge (`via: 'edge'`) --------------------------------

/// The flat square with its diagonal (0, 0)–(1, 1) precreased, as the
/// document stores the step.
fn diagonal_square(bridge: &mut Bridge) -> u32 {
    let sheet = square(bridge);
    land(
        bridge,
        sheet,
        json!({
            "kind": "precrease",
            "line": { "via": "free", "through": [[0.0, 0.0], [1.0, 1.0]] },
            "direction": "valley",
            "moving": [0.0, 1.0],
            "seed": { "scope": "all" }
        }),
    )
}

/// The bottom edge swivelled onto `target`, pivoting at `pivot`: the
/// document's new form.
fn edge_swivel(pivot: Point, target: Value) -> Value {
    json!({
        "kind": "swivel",
        "via": "edge",
        "pivot": pivot,
        "edge": [0.5, 0.0],
        "target": target,
        "seed": { "scope": "all" },
        "direction": "valley"
    })
}

/// H named by its two ends on the preliminary base, nothing precreased: the
/// question names the ends, the corner and what the fold creases; the fold
/// lands what the engine lands with the ends' images — H in the top layer
/// and the four kite creases scored, the closed edges below H unfolded —
/// and replays, through `apply` and the tools' call alike, to that state;
/// its picture is H's. Over precreases, the same ends fold exactly what the
/// precrease's own form folds.
#[test]
fn a_petal_fold_by_its_ends_creases_h_and_lands_as_the_engine_does() {
    let mut bridge = Bridge::new();
    let base = preliminary(&mut bridge);
    let state = bridge.state(base).unwrap_or_else(|e| panic!("{e}")).clone();
    let step = petal_by_ends(&state);

    let asked = analysis(&bridge, base, step.clone());
    let petal = &asked["analysis"];
    assert_eq!(petal["kind"], "petal", "{asked}");
    assert_eq!(petal["scores_line"], true);
    assert_eq!(petal["scores_kites"], json!([true, true]));
    let near = |v: &Value, p: Point| {
        let q: Point = serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{e}"));
        (q[0] - p[0]).hypot(q[1] - p[1]) < 1e-9
    };
    assert!(near(&petal["corner"], OPEN_CORNER), "{petal}");
    assert!(
        ENDS.iter()
            .all(|&e| (0..2).any(|k| near(&petal["ends"][k], e))),
        "{petal}"
    );
    assert!(asked["orders"].is_null());

    let applied = apply(&mut bridge, base, step.clone(), json!({}));
    assert_eq!(applied["status"], "ok", "{applied}");
    let vertex = &applied["compound"];
    assert_eq!(vertex["family"], "vertex");
    assert_eq!(vertex["kind"], "petal");
    assert_eq!(vertex["created"].as_array().map(Vec::len), Some(6));
    assert_eq!(vertex["unfolded"].as_array().map(Vec::len), Some(2));
    assert!(vertex["stored"].as_object().is_some_and(|o| o.is_empty()));
    let child = applied["state"].as_u64().unwrap_or_default() as u32;
    let parts = |bridge: &Bridge, h: u32| bridge.state(h).map(|s| s.parts().clone()).ok();
    // The engine's own fold of the ends' images.
    let engine = state
        .petal_fold(
            &oristudio_fold::PetalFold {
                hinge: oristudio_fold::PetalHinge::Points {
                    from: ENDS[0],
                    to: ENDS[1],
                },
                petal: seen_top(&state, PETAL),
                direction: oristudio_fold::Direction::Valley,
            },
            &oristudio_fold::VertexChoices::default(),
        )
        .unwrap_or_else(|e| panic!("{e}"));
    let oristudio_fold::VertexOutcome::Landed(engine) = engine else {
        panic!("a choice of orders");
    };
    let landed = parts(&bridge, child).unwrap_or_else(|| unreachable!());
    // The same faces, creases and order; the vertices to the last bits the
    // ends' sheet points round through.
    let want = engine.state.parts();
    assert_eq!(landed.faces, want.faces);
    assert_eq!(landed.creases, want.creases);
    assert_eq!(landed.order, want.order);
    assert_eq!(landed.vertices.len(), want.vertices.len());
    for (p, q) in landed.vertices.iter().zip(&want.vertices) {
        assert!((p[0] - q[0]).hypot(p[1] - q[1]) < 1e-12, "{p:?} {q:?}");
    }

    // Replayed, and through the tools' call: the same state.
    let again = land(&mut bridge, base, step.clone());
    assert_eq!(parts(&bridge, again), parts(&bridge, child));
    let mut pending = Pending::new();
    let tried = ok(pending.try_fold(&mut bridge, base, &op(step.clone()), &Choices::default()));
    assert_eq!(tried["result"], "landed");
    assert_eq!(tried["compound"], applied["compound"]);
    // Its picture: H, the one the tool previewed.
    let pictured = ok(bridge.step_action(child))["action"].clone();
    let previewed = ok(bridge.action(base, &op(step), &Choices::default()))["action"].clone();
    assert!(
        pictured["line"].is_array() && pictured["grip"].is_object(),
        "{pictured}"
    );
    for key in ["line", "spans", "moving"] {
        assert_eq!(pictured[key], previewed[key], "{key}");
    }

    // Over precreases (the kites through the top two layers, H through
    // every layer), H named by its ends folds what H named by the crease
    // folds, and the question says it creases nothing.
    let kited = kites(&mut bridge, base);
    let ready = precrease(&mut bridge, kited, ENDS, CLOSED_POINT, Seed::All);
    let ready_state = bridge
        .state(ready)
        .unwrap_or_else(|e| panic!("{e}"))
        .clone();
    let on_h = [
        ENDS[0][0] + 0.25 * (ENDS[1][0] - ENDS[0][0]),
        ENDS[0][1] + 0.25 * (ENDS[1][1] - ENDS[0][1]),
    ];
    let by_crease = json!({
        "kind": "petal",
        "crease": sheet_on_top_near(&ready_state, on_h, [on_h[0] - 0.01, on_h[1] - 0.02]),
        "petal": seen_top(&ready_state, PETAL),
        "direction": "valley"
    });
    let by_ends = petal_by_ends(&ready_state);
    for step in [&by_crease, &by_ends] {
        let asked = analysis(&bridge, ready, step.clone());
        assert_eq!(asked["analysis"]["scores_line"], false, "{asked}");
        assert_eq!(asked["analysis"]["scores_kites"], json!([false, false]));
    }
    let crease_landed = land(&mut bridge, ready, by_crease);
    let ends_landed = land(&mut bridge, ready, by_ends);
    assert_eq!(parts(&bridge, crease_landed), parts(&bridge, ends_landed));
}

/// H by its ends: an end off the paper or two ends together are refused as
/// a free line's points are; ends that miss the flap, or sit too near its
/// closed point, by the engine's codes; `crease` and `ends` together, or
/// neither, is the caller's mistake.
#[test]
fn a_petal_fold_by_its_ends_is_refused_by_code() {
    let mut bridge = Bridge::new();
    let base = preliminary(&mut bridge);
    let state = bridge.state(base).unwrap_or_else(|e| panic!("{e}")).clone();
    let petal = seen_top(&state, PETAL);
    let with_ends = |ends: [Point; 2]| json!({ "kind": "petal", "ends": ends, "petal": petal, "direction": "valley" });
    let code = |bridge: &mut Bridge, step: Value| {
        apply(bridge, base, step, json!({}))["refusal"]["code"].clone()
    };
    let a = sheet_on_top_near(&state, ENDS[0], [0.2, 0.45]);
    assert_eq!(
        code(&mut bridge, with_ends([a, [3.0, 3.0]])),
        "point_off_paper"
    );
    assert_eq!(code(&mut bridge, with_ends([a, a])), "free_line_too_short");
    // Across the open corner, from raw edge to raw edge: H meets neither
    // closed edge. (Every line through two points of this paper meets the
    // flap, which covers it all: the engine's own tests miss it.)
    let corner = [
        sheet_on_top_near(&state, [0.0, 0.02], [0.004, 0.012]),
        sheet_on_top_near(&state, [0.02, 0.0], [0.012, 0.004]),
    ];
    let refused = apply(
        &mut bridge,
        base,
        json!({
            "kind": "petal",
            "ends": corner,
            "petal": seen_top(&state, [0.009, 0.005]),
            "direction": "valley"
        }),
        json!({}),
    );
    assert_eq!(refused["refusal"]["code"], "petal_no_flap", "{refused}");
    assert_eq!(refused["refusal"]["cause"], "no_ends", "{refused}");
    // Too near the closed point: the flap reaches past the kites' corner.
    let high = [
        sheet_on_top_near(&state, [0.4, 0.5], [0.4, 0.45]),
        sheet_on_top_near(&state, [0.5, 0.4], [0.45, 0.4]),
    ];
    let refused = apply(&mut bridge, base, with_ends(high), json!({}));
    assert_eq!(refused["refusal"]["code"], "petal_no_flap", "{refused}");
    assert_eq!(refused["refusal"]["cause"], "no_corner");
    assert_eq!(refused["refusal"]["detail"]["kind"], "past_corner");
    assert!(
        refused["refusal"]["detail"]["corner"].is_array(),
        "{refused}"
    );
    // Both names of H, or neither: thrown.
    for step in [
        json!({ "kind": "petal", "crease": a, "ends": [a, a], "petal": petal, "direction": "valley" }),
        json!({ "kind": "petal", "petal": petal, "direction": "valley" }),
    ] {
        assert!(
            matches!(
                bridge.apply(base, &op(step), &Choices::default()),
                Err(BridgeError::InvalidInput(_))
            ),
            "both or neither"
        );
    }
}

/// The pivot past the incenter on the bisector from a, at x = 0.8.
fn past_the_incenter() -> Point {
    [0.8, 0.8 * (std::f64::consts::PI / 8.0).tan()]
}

/// A swivel by its edge resolves its anchors in the parent — the pivot's
/// image, the edge's sheet point, the target crease by a point on it or as
/// the line through two points — and lands the engine's state, reported as
/// a swivel. The question answers `swivel-by-edge`: the vertex, the four
/// creases with their letters as seen, where the edge lands, its ridges and
/// per ridge whether it lands. A ridge the step stores replays to its own
/// state.
#[test]
fn a_swivel_by_its_edge_lands_through_the_bridge() {
    let mut bridge = Bridge::new();
    let parent = diagonal_square(&mut bridge);
    let step = edge_swivel(
        past_the_incenter(),
        json!({ "via": "crease", "at": [0.5, 0.5] }),
    );
    let asked = analysis(&bridge, parent, step.clone());
    let a = &asked["analysis"];
    assert_eq!(a["kind"], "swivel-by-edge", "{asked}");
    let rays: Vec<&Value> = a["creases"]
        .as_array()
        .map(|c| c.iter().map(|c| &c["ray"]).collect())
        .unwrap_or_default();
    assert_eq!(rays, vec!["meet", "foot", "end", "hinge"]);
    let letters: Vec<&Value> = a["creases"]
        .as_array()
        .map(|c| c.iter().map(|c| &c["letter"]).collect())
        .unwrap_or_default();
    assert_eq!(letters, vec!["valley", "mountain", "valley", "valley"]);
    assert_eq!(a["creases"][1]["ridge"], true);
    assert_eq!(a["ridge"], 0);
    assert_eq!(a["ridges"].as_array().map(Vec::len), Some(2));
    assert_eq!(asked["emergents"], json!([true, true]));
    assert!(asked["orders"].is_null(), "{asked}");
    assert_eq!(a["landed"].as_array().map(Vec::len), Some(2));
    assert!(
        a["regions"]
            .as_array()
            .is_some_and(|r| r.iter().any(|r| r["wedge"] == "turn"))
    );

    let applied = apply(&mut bridge, parent, step.clone(), json!({}));
    assert_eq!(applied["status"], "ok", "{applied}");
    assert_eq!(applied["compound"]["family"], "vertex");
    assert_eq!(applied["compound"]["kind"], "swivel");
    assert!(
        applied["compound"]["stored"]
            .as_object()
            .is_some_and(|o| o.is_empty())
    );
    let landed_state = applied["state"].as_u64().unwrap_or_default() as u32;
    let parts = |bridge: &Bridge, h: u32| bridge.state(h).map(|s| s.parts().clone()).ok();
    // The engine's own swivel on the same parent.
    let engine_op = oristudio_fold::SwivelByEdge {
        pivot: past_the_incenter(),
        edge: [0.5, 0.0],
        target: oristudio_geometry::Line::from_points([0.0, 0.0], [1.0, 1.0])
            .unwrap_or_else(|| panic!("no line")),
        layers: Seed::All,
        ridge: None,
        direction: oristudio_fold::Direction::Valley,
        fold: None,
        kind: oristudio_fold::SwivelKind::Open,
    };
    let engine = match bridge
        .state(parent)
        .unwrap_or_else(|e| panic!("{e}"))
        .swivel_by_edge(&engine_op, &oristudio_fold::VertexChoices::default())
    {
        Ok(oristudio_fold::VertexOutcome::Landed(folded)) => folded.state.parts().clone(),
        _ => panic!("the engine did not land it"),
    };
    assert_eq!(parts(&bridge, landed_state), Some(engine));
    // Pictured from its vertex.
    let pictured = ok(bridge.step_action(landed_state))["action"].clone();
    assert!(
        pictured["line"].is_array() && pictured["grip"].is_object(),
        "{pictured}"
    );
    // The target as the line through two points on it: the same state.
    let free = edge_swivel(
        past_the_incenter(),
        json!({ "via": "free", "through": [[0.2, 0.2], [0.9, 0.9]] }),
    );
    let by_points = land(&mut bridge, parent, free);
    assert_eq!(parts(&bridge, by_points), parts(&bridge, landed_state));
    // The other ridge, stored as a direction: another state, and replay
    // takes the nearer far ray.
    let mut other = step.clone();
    other["ridge"] = a["ridges"][1].clone();
    let by_end = land(&mut bridge, parent, other.clone());
    assert_ne!(parts(&bridge, by_end), parts(&bridge, landed_state));
    let ridge = &a["ridges"][1];
    other["ridge"] = json!([
        ridge[0].as_f64().unwrap_or_default() * 2.0 + 0.01,
        ridge[1].as_f64().unwrap_or_default() * 2.0
    ]);
    let again = land(&mut bridge, parent, other);
    assert_eq!(parts(&bridge, again), parts(&bridge, by_end));
    // The tools' call lands it too.
    let mut pending = Pending::new();
    let tried = ok(pending.try_fold(&mut bridge, parent, &op(step), &Choices::default()));
    assert_eq!(tried["result"], "landed", "{tried}");
}

/// What the bridge refuses by code, and what it throws: a sheet point on no
/// edge (`swivel_not_an_edge`, naming it), a target crease that is not
/// there (`crease_not_found`), a target parallel to the edge (naming the
/// edge's face), an edge that ends before its foot (offering the plain fold
/// along the bisector), a pivot off the paper; and, thrown, a target named
/// by an axiom or a model line (the step could not store it), a `via` this
/// build does not know, and a ridge with no direction.
#[test]
fn a_swivel_by_its_edge_is_refused_by_code_or_thrown() {
    let mut bridge = Bridge::new();
    let parent = diagonal_square(&mut bridge);
    let diagonal = json!({ "via": "crease", "at": [0.5, 0.5] });
    let mut inside = edge_swivel(past_the_incenter(), diagonal.clone());
    inside["edge"] = json!([0.5, 0.3]);
    let refused = apply(&mut bridge, parent, inside, json!({}));
    assert_eq!(
        refused["refusal"],
        json!({ "code": "swivel_not_an_edge", "point": [0.5, 0.3] })
    );
    let nowhere = edge_swivel(
        past_the_incenter(),
        json!({ "via": "crease", "at": [0.5, 0.3] }),
    );
    let refused = apply(&mut bridge, parent, nowhere, json!({}));
    assert_eq!(refused["refusal"]["code"], "crease_not_found");
    let top = edge_swivel([0.5, 0.5], json!({ "via": "crease", "at": [0.5, 1.0] }));
    let refused = apply(&mut bridge, parent, top, json!({}));
    assert_eq!(refused["refusal"]["code"], "swivel_target_parallel");
    assert_eq!(refused["faces"].as_array().map(Vec::len), Some(1));
    // The right edge onto the bottom edge, pivoting at d: its foot is c, the
    // edge's far end; b d folds it there plainly.
    let mut short = edge_swivel([0.0, 1.0], json!({ "via": "crease", "at": [0.5, 0.0] }));
    short["edge"] = json!([1.0, 0.5]);
    let refused = apply(&mut bridge, parent, short, json!({}));
    assert_eq!(refused["refusal"]["code"], "swivel_edge_short", "{refused}");
    assert_eq!(refused["fixes"][0]["fix"], "use_line");
    let n = &refused["fixes"][0]["line"]["n"];
    let (nx, ny) = (n[0].as_f64().unwrap_or(0.0), n[1].as_f64().unwrap_or(0.0));
    assert!((nx - ny).abs() < 1e-12, "the fix is b d: {refused}");
    let off = edge_swivel([1.5, 0.3], diagonal.clone());
    let refused = apply(&mut bridge, parent, off, json!({}));
    assert_eq!(refused["refusal"]["code"], "point_off_paper");

    let axiom = json!({
        "via": "axiom", "axiom": 1,
        "inputs": [{ "kind": "point", "at": [0.0, 0.0] }, { "kind": "point", "at": [1.0, 1.0] }]
    });
    let model = json!({ "via": "model", "line": { "n": [1.0, -1.0], "d": 0.0 } });
    for target in [axiom, model] {
        let step = edge_swivel(past_the_incenter(), target);
        assert!(matches!(
            bridge.apply(parent, &op(step), &Choices::default()),
            Err(BridgeError::InvalidInput(_))
        ));
    }
    let mut zero = edge_swivel(past_the_incenter(), diagonal.clone());
    zero["ridge"] = json!([0.0, 0.0]);
    assert!(matches!(
        bridge.apply(parent, &op(zero), &Choices::default()),
        Err(BridgeError::InvalidInput(_))
    ));
    let mut sideways = edge_swivel(past_the_incenter(), diagonal);
    sideways["via"] = json!("sideways");
    assert!(serde_json::from_value::<Op>(sideways).is_err());
    // The rays form still reads without a `via`, and only without one.
    let rays = json!({
        "kind": "swivel",
        "vertex": [0.5, 0.3],
        "toward": [[1.0, 0.6], [0.0, 0.6], [0.5, 0.0]],
        "emergent": [0.8, -0.6],
        "seed": { "scope": "all" },
        "stayer": [0.3, 0.9],
        "direction": "valley"
    });
    assert!(serde_json::from_value::<Op>(rays.clone()).is_ok());
    let mut edged = rays;
    edged["via"] = json!("edge");
    assert!(serde_json::from_value::<Op>(edged).is_err());
}

/// The owner's `squash.osf`, the swivel-on-edge example's start, its steps
/// as the document stores them: the square valley-folded on b d, a c
/// precreased, two inside reverses (the preliminary base), turned 1/8 of a
/// turn, a flap squashed.
fn abrashi_squash(bridge: &mut Bridge) -> u32 {
    let point = |at: Point| json!({ "kind": "point", "at": at });
    let axiom2 =
        |a: Point, b: Point| json!({ "via": "axiom", "axiom": 2, "inputs": [point(a), point(b)] });
    let steps = [
        (
            json!({ "kind": "valley", "line": axiom2([0.0, 0.0], [1.0, 1.0]),
                    "moving": [0.6666666666666666, 0.6666666666666666], "seed": { "scope": "all" } }),
            json!({ "root": { "n": [0.7071067811865475, 0.7071067811865475], "d": 0.7071067811865475 } }),
        ),
        (
            json!({ "kind": "precrease", "line": axiom2([1.0, 0.0], [0.0, 1.0]),
                    "direction": "valley", "seed": { "scope": "all" } }),
            json!({ "root": { "n": [0.7071067811865475, -0.7071067811865475], "d": 0.0 } }),
        ),
        (
            json!({ "kind": "inside-reverse", "line": axiom2([1.0, 0.0], [1.0, 1.0]), "seed": { "scope": "all" } }),
            json!({ "root": { "n": [1.0, -2.2204460492503136e-16], "d": 0.5000000000000001 } }),
        ),
        (
            json!({ "kind": "inside-reverse", "line": axiom2([0.0, 1.0], [1.0, 1.0]), "seed": { "scope": "all" } }),
            json!({ "root": { "n": [2.2204460492503136e-16, -1.0], "d": -0.5000000000000001 } }),
        ),
        (
            json!({ "kind": "rotate", "rotate": { "amount": "eighth", "direction": "ccw" } }),
            json!({}),
        ),
        (
            json!({ "kind": "squash", "flap": [0.8521078475219173, 0.5697560410122267], "direction": "valley" }),
            json!({}),
        ),
    ];
    let mut state = square(bridge);
    for (step, chosen) in steps {
        let applied = apply(bridge, state, step.clone(), chosen);
        assert_eq!(applied["status"], "ok", "{step}: {applied}");
        state = applied["state"].as_u64().unwrap_or_default() as u32;
    }
    state
}

/// The swivel on a folded edge as the document stores it: the folded edge
/// by a sheet point on it, the edge, the target; no seed, no ridge.
fn fold_swivel(fold: Point, edge: Point, target: Value) -> Value {
    json!({
        "kind": "swivel",
        "via": "edge",
        "fold": fold,
        "edge": edge,
        "target": target,
        "direction": "valley"
    })
}

/// Abrashi's swivel on the owner's squashed preliminary base: the kite's
/// upper-left (folded) edge, its lower-left edge, the centre line's
/// precrease.
fn abrashi_swivel() -> Value {
    let k = std::f64::consts::FRAC_1_SQRT_2;
    fold_swivel(
        [0.75, (0.5 + k) / 2.0],
        [1.0, (k + 1.0) / 2.0],
        json!({ "via": "crease", "at": [0.75, 0.5] }),
    )
}

/// A swivel on a folded edge resolves the folded edge's point in the parent
/// (its image picks the bisector) and lands the engine's state, reported as
/// a swivel: the question answers `swivel-by-edge` with the folded edge and
/// its half that opens, three creases with their letters as seen, no ridge
/// to choose and one order; its picture runs from the vertex. The other
/// direction is refused offering this one.
#[test]
fn a_swivel_on_a_folded_edge_lands_through_the_bridge() {
    let mut bridge = Bridge::new();
    let parent = abrashi_squash(&mut bridge);
    let step = abrashi_swivel();
    let asked = analysis(&bridge, parent, step.clone());
    let a = &asked["analysis"];
    assert_eq!(a["kind"], "swivel-by-edge", "{asked}");
    assert_eq!(a["fold"]["faces"].as_array().map(Vec::len), Some(2), "{a}");
    assert_eq!(a["ridges"], json!([]));
    assert_eq!(asked["emergents"], json!([]));
    assert!(asked["orders"].is_null(), "{asked}");
    // Its choices besides the order: valley lands, mountain does not, of
    // both kinds, open and inside.
    assert_eq!(asked["directions"], json!([true, false]));
    assert_eq!(asked["kinds"], json!([[true, false], [true, false]]));
    let letters: Vec<&Value> = a["creases"]
        .as_array()
        .map(|c| c.iter().map(|c| &c["letter"]).collect())
        .unwrap_or_default();
    assert_eq!(letters, vec!["valley", "mountain", "valley"]);
    assert_eq!(
        a["regions"]
            .as_array()
            .map(|r| r.iter().filter(|r| r["wedge"] == "turn").count()),
        Some(1)
    );

    let applied = apply(&mut bridge, parent, step.clone(), json!({}));
    assert_eq!(applied["status"], "ok", "{applied}");
    assert_eq!(applied["compound"]["family"], "vertex");
    assert_eq!(applied["compound"]["kind"], "swivel");
    let landed_state = applied["state"].as_u64().unwrap_or_default() as u32;
    let parts = |bridge: &Bridge, h: u32| bridge.state(h).map(|s| s.parts().clone()).ok();
    // The engine's own swivel on the same parent.
    let parent_state = bridge.state(parent).unwrap_or_else(|e| panic!("{e}"));
    let fold: Point = serde_json::from_value(step["fold"].clone()).unwrap_or_default();
    let engine_op = oristudio_fold::SwivelByEdge {
        pivot: parent_state.resolve_point(fold).unwrap_or_default(),
        edge: serde_json::from_value(step["edge"].clone()).unwrap_or_default(),
        target: parent_state
            .crease_at([0.75, 0.5])
            .and_then(|c| parent_state.crease_line(c.id))
            .unwrap_or_else(|| panic!("no centre line")),
        layers: Seed::All,
        ridge: None,
        direction: oristudio_fold::Direction::Valley,
        fold: Some(fold),
        kind: oristudio_fold::SwivelKind::Open,
    };
    let engine =
        match parent_state.swivel_by_edge(&engine_op, &oristudio_fold::VertexChoices::default()) {
            Ok(oristudio_fold::VertexOutcome::Landed(folded)) => folded.state.parts().clone(),
            _ => panic!("the engine did not land it"),
        };
    assert_eq!(parts(&bridge, landed_state), Some(engine));
    let pictured = ok(bridge.step_action(landed_state))["action"].clone();
    assert!(
        pictured["line"].is_array() && pictured["grip"].is_object(),
        "{pictured}"
    );
    // The tools' call lands it too.
    let mut pending = Pending::new();
    let tried = ok(pending.try_fold(&mut bridge, parent, &op(step.clone()), &Choices::default()));
    assert_eq!(tried["result"], "landed", "{tried}");
    // The paper behind: refused for want of an order, offering the valley.
    let mut mountain = step;
    mountain["direction"] = json!("mountain");
    let refused = apply(&mut bridge, parent, mountain, json!({}));
    assert_eq!(refused["refusal"]["code"], "no_order", "{refused}");
    assert_eq!(refused["fixes"], json!([{ "fix": "opposite_direction" }]));
}

/// The inside swivel on the same folded edge (`swivel: 'inside'`): the
/// question answers the same vertex and creases with the inside letters as
/// seen — the swivel crease a valley in both layers, the second crease the
/// mountain — and the same ways landing; the step lands the engine's inside
/// swivel, with the open swivel's lines and another order. The other
/// direction is refused offering this one; an inside swivel at a free
/// vertex is refused by code; a kind the bridge does not know is thrown.
#[test]
fn an_inside_swivel_on_a_folded_edge_lands_through_the_bridge() {
    let mut bridge = Bridge::new();
    let parent = abrashi_squash(&mut bridge);
    let mut step = abrashi_swivel();
    step["swivel"] = json!("inside");
    let asked = analysis(&bridge, parent, step.clone());
    let a = &asked["analysis"];
    assert_eq!(a["kind"], "swivel-by-edge", "{asked}");
    let open = analysis(&bridge, parent, abrashi_swivel());
    assert_eq!(a["vertex"], open["analysis"]["vertex"]);
    let letters: Vec<(&Value, &Value)> = a["creases"]
        .as_array()
        .map(|c| c.iter().map(|c| (&c["letter"], &c["ridge"])).collect())
        .unwrap_or_default();
    assert_eq!(
        letters,
        vec![
            (&json!("valley"), &json!(false)),
            (&json!("valley"), &json!(false)),
            (&json!("mountain"), &json!(true)),
        ]
    );
    assert_eq!(asked["directions"], json!([true, false]));
    assert_eq!(asked["kinds"], json!([[true, false], [true, false]]));
    assert!(asked["orders"].is_null(), "{asked}");

    let applied = apply(&mut bridge, parent, step.clone(), json!({}));
    assert_eq!(applied["status"], "ok", "{applied}");
    assert_eq!(applied["compound"]["kind"], "swivel");
    let landed_state = applied["state"].as_u64().unwrap_or_default() as u32;
    let parent_state = bridge.state(parent).unwrap_or_else(|e| panic!("{e}"));
    let fold: Point = serde_json::from_value(step["fold"].clone()).unwrap_or_default();
    let engine_op = oristudio_fold::SwivelByEdge {
        pivot: parent_state.resolve_point(fold).unwrap_or_default(),
        edge: serde_json::from_value(step["edge"].clone()).unwrap_or_default(),
        target: parent_state
            .crease_at([0.75, 0.5])
            .and_then(|c| parent_state.crease_line(c.id))
            .unwrap_or_else(|| panic!("no centre line")),
        layers: Seed::All,
        ridge: None,
        direction: oristudio_fold::Direction::Valley,
        fold: Some(fold),
        kind: oristudio_fold::SwivelKind::Inside,
    };
    let engine =
        match parent_state.swivel_by_edge(&engine_op, &oristudio_fold::VertexChoices::default()) {
            Ok(oristudio_fold::VertexOutcome::Landed(folded)) => folded.state.parts().clone(),
            _ => panic!("the engine did not land it"),
        };
    let landed_parts = bridge
        .state(landed_state)
        .map(|s| s.parts().clone())
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(landed_parts, engine);
    // The open swivel's lines, another order.
    let opened = apply(&mut bridge, parent, abrashi_swivel(), json!({}));
    let opened_state = opened["state"].as_u64().unwrap_or_default() as u32;
    let opened_parts = bridge
        .state(opened_state)
        .map(|s| s.parts().clone())
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(landed_parts.vertices, opened_parts.vertices);
    assert_ne!(landed_parts.order, opened_parts.order);
    // The paper behind: refused for want of an order, offering the valley.
    let mut mountain = step.clone();
    mountain["direction"] = json!("mountain");
    let refused = apply(&mut bridge, parent, mountain, json!({}));
    assert_eq!(refused["refusal"]["code"], "no_order", "{refused}");
    assert_eq!(refused["fixes"], json!([{ "fix": "opposite_direction" }]));
    // An inside swivel needs a folded edge.
    let diagonal = diagonal_square(&mut bridge);
    let mut free = edge_swivel(
        past_the_incenter(),
        json!({ "via": "crease", "at": [0.5, 0.5] }),
    );
    free["swivel"] = json!("inside");
    let refused = apply(&mut bridge, diagonal, free, json!({}));
    assert_eq!(
        refused["refusal"]["code"], "swivel_inside_free",
        "{refused}"
    );
    // `'open'` is the open swivel, spelled out.
    let mut spelled = abrashi_swivel();
    spelled["swivel"] = json!("open");
    let spelled = apply(&mut bridge, parent, spelled, json!({}));
    let spelled_state = spelled["state"].as_u64().unwrap_or_default() as u32;
    assert_eq!(
        bridge.state(spelled_state).map(|s| s.parts().clone()).ok(),
        Some(opened_parts)
    );
    // A kind it does not know does not parse.
    let mut closed = abrashi_swivel();
    closed["swivel"] = json!("closed");
    assert!(serde_json::from_value::<Op>(closed).is_err());
}

/// A swivel on a folded edge refused by code — a point on no folded crease
/// (`swivel_not_a_fold`, naming it), a folded edge the bisector misses — and
/// thrown: a `fold` beside a `pivot`, a `seed` or a `ridge`, or neither.
#[test]
fn a_swivel_on_a_folded_edge_is_refused_by_code_or_thrown() {
    let mut bridge = Bridge::new();
    let parent = abrashi_squash(&mut bridge);
    let k = std::f64::consts::FRAC_1_SQRT_2;
    let mut flat = abrashi_swivel();
    flat["fold"] = json!([0.75, 0.5]);
    let refused = apply(&mut bridge, parent, flat, json!({}));
    assert_eq!(
        refused["refusal"],
        json!({ "code": "swivel_not_a_fold", "point": [0.75, 0.5] })
    );
    let mut missed = abrashi_swivel();
    missed["fold"] = json!([0.75, (0.5 + 1.0 - k) / 2.0]);
    let refused = apply(&mut bridge, parent, missed, json!({}));
    assert_eq!(
        refused["refusal"]["code"], "swivel_misses_fold",
        "{refused}"
    );
    assert_eq!(refused["faces"].as_array().map(Vec::len), Some(2));
    let thrown = |step: Value, bridge: &mut Bridge| {
        assert!(
            matches!(
                bridge.apply(parent, &op(step.clone()), &Choices::default()),
                Err(BridgeError::InvalidInput(_))
            ),
            "{step}"
        );
    };
    for (key, value) in [
        ("pivot", json!([0.8, 0.6])),
        ("seed", json!({ "scope": "all" })),
        ("ridge", json!([0.0, -1.0])),
    ] {
        let mut step = abrashi_swivel();
        step[key] = value;
        thrown(step, &mut bridge);
    }
    let mut neither = abrashi_swivel();
    if let Some(o) = neither.as_object_mut() {
        o.remove("fold");
    }
    thrown(neither, &mut bridge);
    // A free swivel without its seed is the caller's mistake too.
    let mut unseeded = edge_swivel(
        past_the_incenter(),
        json!({ "via": "crease", "at": [0.5, 0.5] }),
    );
    if let Some(o) = unseeded.as_object_mut() {
        o.remove("seed");
    }
    let diagonal = diagonal_square(&mut bridge);
    assert!(matches!(
        bridge.apply(diagonal, &op(unseeded), &Choices::default()),
        Err(BridgeError::InvalidInput(_))
    ));
}

/// A swivel by its valley and mountain, each a located line.
fn valley_mountain(valley: Value, mountain: Value, kind: &str) -> Value {
    let mut step = json!({ "kind": "swivel", "via": "valley-mountain", "valley": valley, "mountain": mountain });
    if kind == "inside" {
        step["swivel"] = json!("inside");
    }
    step
}

#[test]
fn a_swivel_by_its_valley_and_mountain_resolves_stored_roots_and_existing_precreases() {
    let mut bridge = Bridge::default();
    let flat = square(&mut bridge);
    let mut state = land(
        &mut bridge,
        flat,
        valley([[0.5, 0.0], [0.5, 1.0]], [0.8, 0.5]),
    );
    let low = [[0.5, 0.5], [0.05, 0.1]];
    let high = [[0.5, 0.5], [0.1, 0.8]];
    let located = |points: [Point; 2]| {
        let line = oristudio_geometry::Line::from_points(points[0], points[1]).unwrap();
        json!({"line":{"via":"axiom","axiom":1,"inputs":[{"kind":"point","at":points[0]},{"kind":"point","at":points[1]}]},"root":line})
    };
    let base = valley_mountain(located(high), located(low), "open");
    let described = analysis(&bridge, state, base.clone());
    let a = &described["analysis"];
    assert_eq!(a["kind"], "swivel-valley-mountain", "{described}");
    // The crease behind first, hidden; the two named after it, by their letters.
    assert_eq!(a["creases"][0]["hidden"], true);
    let named: Vec<&Value> = a["creases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c.get("hidden").is_none())
        .map(|c| &c["letter"])
        .collect();
    assert_eq!(
        named[named.len() - 2..],
        [&json!("mountain"), &json!("valley")]
    );
    // No direction to offer: per kind, only the valley column.
    for row in described["kinds"].as_array().unwrap() {
        assert_eq!(row[1], false);
    }
    assert_eq!(described["directions"][1], false);
    for side in ["valley", "mountain"] {
        let mut missing = base.clone();
        missing[side].as_object_mut().unwrap().remove("root");
        let rejected = apply(&mut bridge, state, missing, json!({}));
        assert_eq!(rejected["refusal"]["code"], "root_missing");
    }
    // A direction is no part of it: a step that names one is the caller's mistake.
    let mut directed = base.clone();
    directed["direction"] = json!("valley");
    assert!(serde_json::from_value::<Op>(directed).is_err());
    for points in [low, high] {
        state = land(
            &mut bridge,
            state,
            json!({"kind":"precrease","direction":"valley","line":{"via":"free","through":points},"moving":[0.1,0.5],"seed":{"scope":"all"}}),
        );
    }
    let existing = valley_mountain(
        json!({"line":{"via":"crease","at":[0.3,0.65]}}),
        json!({"line":{"via":"crease","at":[0.275,0.3]}}),
        "inside",
    );
    let a = analysis(&bridge, state, existing);
    assert_eq!(a["analysis"]["kind"], "swivel-valley-mountain");
}

#[test]
fn a_swivel_by_its_valley_and_mountain_is_refused_by_code() {
    let mut bridge = Bridge::default();
    let flat = square(&mut bridge);
    let state = land(
        &mut bridge,
        flat,
        valley([[0.5, 0.0], [0.5, 1.0]], [0.8, 0.5]),
    );
    let free = |a: Point, b: Point| json!({ "line": { "via": "free", "through": [a, b] } });
    let refused = |bridge: &mut Bridge, step: Value| {
        let applied = apply(bridge, state, step, json!({}));
        assert_eq!(applied["status"], "refused", "{applied}");
        applied["refusal"]["code"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    };
    // Lines that meet away from the folded edge, and one along it.
    let apart = valley_mountain(
        free([0.2, 0.0], [0.2, 1.0]),
        free([0.0, 0.2], [0.4, 0.2]),
        "open",
    );
    assert_eq!(refused(&mut bridge, apart), "swivel_line_meeting");
    let along = valley_mountain(
        free([0.5, 0.0], [0.5, 1.0]),
        free([0.5, 0.5], [0.05, 0.1]),
        "open",
    );
    assert_eq!(refused(&mut bridge, along), "swivel_no_flap");
}

/// Every saved swivel on a folded edge (the example projects) is made again,
/// to the same state, by the valley and the mountain it makes on the layer
/// in front: read off its own question, named by two sheet points each, and
/// folded with the step's own stored choices.
#[test]
fn every_saved_swivel_on_a_folded_edge_is_made_again_by_its_valley_and_mountain() {
    use oristudio_fold_wasm::canonical::canonical_keys;
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/fold-examples");
    let mut made = 0;
    for name in ["swivel-on-edge.osf", "swivel-inside.osf"] {
        let file: Value =
            serde_json::from_str(&std::fs::read_to_string(root.join(name)).unwrap()).unwrap();
        let doc = &file["workspace"]["foldSequences"][0];
        let mut bridge = Bridge::new();
        let paper: Paper = serde_json::from_value(doc["paper"].clone()).unwrap();
        let Outcome::Ok(sheet) = bridge.sheet(&paper) else {
            panic!("{name}: no sheet")
        };
        let mut at = std::collections::BTreeMap::<String, u32>::new();
        for step in doc["steps"].as_array().unwrap() {
            let parent = step["parent"].as_str().map_or(sheet.state, |id| at[id]);
            let chosen = step.get("choices").cloned().unwrap_or(json!({}));
            let applied = apply(&mut bridge, parent, step["op"].clone(), chosen.clone());
            assert_eq!(applied["status"], "ok", "{name}: {applied}");
            let landed = applied["state"].as_u64().unwrap() as u32;
            at.insert(step["id"].as_str().unwrap().to_string(), landed);
            if step["op"]["kind"] != "swivel" {
                continue;
            }
            let asked = analysis(&bridge, parent, step["op"].clone());
            let a = &asked["analysis"];
            let vertex: Point = serde_json::from_value(a["vertex"].clone()).unwrap();
            let front = oristudio_fold::FaceId(a["layers"][0].as_u64().unwrap() as u32);
            let isometry = bridge
                .state(parent)
                .unwrap()
                .isometry(front)
                .unwrap()
                .inverse();
            let sheet_of = |p: Point| isometry.apply(p);
            // The other layer's two creases, the swivel crease and the second.
            let line_of = |k: usize| {
                let d: Point =
                    serde_json::from_value(a["creases"][k]["direction"].clone()).unwrap();
                let p = [vertex[0] + 0.05 * d[0], vertex[1] + 0.05 * d[1]];
                json!({ "line": { "via": "free", "through": [sheet_of(vertex), sheet_of(p)] } })
            };
            let (v, m) = if a["creases"][1]["letter"] == "valley" {
                (1, 2)
            } else {
                (2, 1)
            };
            let kind = step["op"]["swivel"].as_str().unwrap_or("open");
            let again = apply(
                &mut bridge,
                parent,
                valley_mountain(line_of(v), line_of(m), kind),
                chosen,
            );
            assert_eq!(again["status"], "ok", "{name}: {again}");
            let again = again["state"].as_u64().unwrap() as u32;
            assert_eq!(
                canonical_keys(bridge.state(again).unwrap())
                    .into_iter()
                    .collect::<std::collections::BTreeSet<_>>(),
                canonical_keys(bridge.state(landed).unwrap())
                    .into_iter()
                    .collect(),
                "{name}"
            );
            made += 1;
        }
    }
    assert_eq!(made, 2);
}
