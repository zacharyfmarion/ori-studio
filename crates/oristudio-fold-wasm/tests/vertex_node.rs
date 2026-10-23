//! The vertex folds across the wasm boundary (`wasm-pack test --node`).
//! `tests/vertex.rs` covers the same natively.
//!
//! The petal fold: its H named by the two ends, as the document stores it,
//! arrives as a plain object; the compound question answers what the fold
//! creases; the fold lands through the tools' call and replays through
//! `apply` to the same state. Its sheet points are named on the same route
//! folded by the engine in process, as the tools name them from the scene.
//!
//! The swivel by its edge: the document's new form (`via: 'edge'`) arrives
//! as a plain JS object, its question and its landing leave as plain
//! objects, its refusals are values, and a `via` this build does not know is
//! a thrown `invalid_input` envelope. On a folded edge (`fold`, no seed) the
//! same, its question naming the folded edge, and a seed beside its `fold`
//! thrown.

#![cfg(target_arch = "wasm32")]

use oristudio_fold::{
    Direction, PlainFold, Sheet, Side, Squash, StartSide, State, VertexChoices, VertexOutcome,
};
use oristudio_geometry::Line;
use serde::Serialize;
use serde_json::{Value, json};
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

use oristudio_fold_wasm::FoldEngine;

type Point = [f64; 2];

fn js(value: Value) -> JsValue {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .expect("plain object")
}

fn json_of(value: JsValue) -> Value {
    serde_wasm_bindgen::from_value(value).expect("json-compatible value")
}

// ---------------------------------------------------------------------------
// The petal fold by its ends

/// The sheet point under the model point `p` on the layer the viewer sees on
/// top at `near`.
fn on_top(state: &State, p: Point, near: Point) -> Point {
    let mut stack = state.stack_at(near).expect("a stack");
    if state.view().flipped {
        stack.reverse();
    }
    state
        .isometry(stack[0])
        .expect("an isometry")
        .inverse()
        .apply(p)
}

fn valley(state: &State, p: Point, q: Point, toward: Point) -> State {
    let line = Line::from_points(p, q).expect("a line");
    let side = Side::of_point(&line, toward).expect("a side");
    state
        .fold(&PlainFold::new(line, side, Direction::Valley))
        .expect("a fold")
        .state
}

fn squash(state: &State, flap: Point) -> State {
    let op = Squash {
        flap,
        target: None,
        direction: Direction::Valley,
        hinge: None,
    };
    match state
        .squash(&op, &VertexChoices::default())
        .expect("a squash")
    {
        VertexOutcome::Landed(folded) => folded.state,
        VertexOutcome::ChooseOrder(_) => panic!("a choice of orders"),
    }
}

/// The preliminary base by the diagonal route (the vertex spike's case 1b),
/// folded in process, and the steps that fold it as the document stores
/// them.
fn preliminary() -> (State, Vec<Value>) {
    let flat = State::flat(Sheet::square(), StartSide::Front).expect("a sheet");
    let half = valley(&flat, [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]);
    let tri = valley(&half, [0.0, 0.0], [0.5, 0.5], [0.9, 0.1]);
    let first = on_top(&tri, [0.1, 0.5], [0.1, 0.5]);
    let one = squash(&tri, first);
    let turned = one.turn_over();
    let second = on_top(&turned, [0.1, 0.7], [0.1, 0.7]);
    let base = squash(&turned, second);
    let free = |through: [Point; 2], moving: Point| {
        json!({
            "kind": "valley",
            "line": { "via": "free", "through": through },
            "moving": moving,
            "seed": { "scope": "all" }
        })
    };
    let steps = vec![
        free([[1.0, 0.0], [0.0, 1.0]], [1.0, 1.0]),
        free([[0.0, 0.0], [0.5, 0.5]], [0.9, 0.1]),
        json!({ "kind": "squash", "flap": first, "direction": "valley" }),
        json!({ "kind": "turn", "axis": "vertical" }),
        json!({ "kind": "squash", "flap": second, "direction": "valley" }),
    ];
    (base, steps)
}

#[wasm_bindgen_test]
fn a_petal_fold_by_its_ends_crosses_the_boundary_and_replays() {
    let (base, steps) = preliminary();
    let mut engine = FoldEngine::new();
    let made = json_of(
        engine
            .sheet(js(
                json!({ "shape": { "kind": "square" }, "startSide": "front" }),
            ))
            .expect("sheet"),
    );
    let mut state = made["state"].as_u64().expect("handle") as u32;
    for step in steps {
        let applied = json_of(
            engine
                .apply(state, js(step.clone()), JsValue::UNDEFINED)
                .expect("apply"),
        );
        assert_eq!(applied["status"], "ok", "{step}: {applied}");
        state = applied["state"].as_u64().expect("handle") as u32;
    }
    let t22 = (std::f64::consts::PI / 8.0).tan() * 0.5;
    let petal = json!({
        "kind": "petal",
        "ends": [
            on_top(&base, [t22, 0.5], [0.2, 0.45]),
            on_top(&base, [0.5, t22], [0.45, 0.2]),
        ],
        "petal": on_top(&base, [0.26, 0.2], [0.26, 0.2]),
        "direction": "valley"
    });

    let asked = json_of(
        engine
            .compound_analysis(state, js(petal.clone()), JsValue::NULL)
            .expect("the question"),
    );
    assert_eq!(asked["status"], "ok", "{asked}");
    assert_eq!(asked["family"], "vertex");
    assert_eq!(asked["analysis"]["kind"], "petal");
    assert_eq!(asked["analysis"]["scores_line"], true);
    assert_eq!(asked["analysis"]["scores_kites"], json!([true, true]));

    let tried = json_of(
        engine
            .vertex_fold(state, js(petal.clone()), JsValue::UNDEFINED)
            .expect("vertex_fold"),
    );
    assert_eq!(tried["status"], "ok", "{tried}");
    assert_eq!(tried["result"], "landed");
    assert_eq!(tried["compound"]["kind"], "petal");
    assert_eq!(
        tried["compound"]["created"].as_array().map(Vec::len),
        Some(6)
    );
    let folded = tried["state"].as_u64().expect("handle") as u32;

    let replayed = json_of(
        engine
            .apply(state, js(petal), JsValue::UNDEFINED)
            .expect("apply"),
    );
    assert_eq!(replayed["status"], "ok", "{replayed}");
    let again = replayed["state"].as_u64().expect("handle") as u32;
    let keys = |engine: &FoldEngine, h: u32| {
        let mut keys = engine.canonical_keys(h).expect("keys");
        keys.sort();
        keys
    };
    assert_eq!(keys(&engine, again), keys(&engine, folded));
}

// ---------------------------------------------------------------------------
// The swivel by its edge

/// The flat square with its diagonal precreased.
fn diagonal_square(engine: &mut FoldEngine) -> u32 {
    let made = json_of(
        engine
            .sheet(js(
                json!({ "shape": { "kind": "square" }, "startSide": "front" }),
            ))
            .expect("sheet"),
    );
    let sheet = made["state"].as_u64().expect("handle") as u32;
    let precrease = json!({
        "kind": "precrease",
        "line": { "via": "free", "through": [[0.0, 0.0], [1.0, 1.0]] },
        "direction": "valley",
        "moving": [0.0, 1.0],
        "seed": { "scope": "all" }
    });
    let landed = json_of(
        engine
            .apply(sheet, js(precrease), JsValue::UNDEFINED)
            .expect("precrease"),
    );
    landed["state"].as_u64().expect("handle") as u32
}

fn swivel(edge: Point) -> Value {
    json!({
        "kind": "swivel",
        "via": "edge",
        "pivot": [0.8, 0.8 * (std::f64::consts::PI / 8.0).tan()],
        "edge": edge,
        "target": { "via": "crease", "at": [0.5, 0.5] },
        "seed": { "scope": "all" },
        "direction": "valley"
    })
}

#[wasm_bindgen_test]
fn a_swivel_by_its_edge_crosses_the_boundary_in_plain_objects() {
    let mut engine = FoldEngine::new();
    let parent = diagonal_square(&mut engine);
    let asked = json_of(
        engine
            .compound_analysis(parent, js(swivel([0.5, 0.0])), JsValue::UNDEFINED)
            .expect("question"),
    );
    assert_eq!(asked["status"], "ok", "{asked}");
    assert_eq!(asked["family"], "vertex");
    assert_eq!(asked["analysis"]["kind"], "swivel-by-edge");
    assert_eq!(
        asked["analysis"]["creases"]
            .as_array()
            .map(|c| c.iter().map(|c| c["letter"].clone()).collect::<Vec<_>>()),
        Some(vec![
            json!("valley"),
            json!("mountain"),
            json!("valley"),
            json!("valley")
        ])
    );
    assert_eq!(asked["emergents"], json!([true, true]));

    let applied = json_of(
        engine
            .apply(parent, js(swivel([0.5, 0.0])), JsValue::UNDEFINED)
            .expect("apply"),
    );
    assert_eq!(applied["status"], "ok", "{applied}");
    assert_eq!(applied["compound"]["kind"], "swivel");
    let tried = json_of(
        engine
            .vertex_fold(parent, js(swivel([0.5, 0.0])), JsValue::NULL)
            .expect("vertex fold"),
    );
    assert_eq!(tried["result"], "landed", "{tried}");

    // Inside the paper: no edge, a refusal value naming the point.
    let refused = json_of(
        engine
            .apply(parent, js(swivel([0.5, 0.3])), JsValue::UNDEFINED)
            .expect("refusal value"),
    );
    assert_eq!(refused["refusal"]["code"], "swivel_not_an_edge");

    // A `via` this build does not know: the caller's mistake, thrown.
    let mut sideways = swivel([0.5, 0.0]);
    sideways["via"] = json!("sideways");
    let thrown = engine
        .apply(parent, js(sideways), JsValue::UNDEFINED)
        .expect_err("an unknown via");
    assert_eq!(json_of(thrown)["code"], "invalid_input");
}

// ---------------------------------------------------------------------------
// The swivel on a folded edge

/// The kite base: the diagonal precreased, the bottom and left edges valley
/// folded onto it.
fn kite_base(engine: &mut FoldEngine) -> u32 {
    let t = (std::f64::consts::PI / 8.0).tan();
    let mut state = diagonal_square(engine);
    for (through, moving) in [
        ([[0.0, 0.0], [1.0, t]], [1.0, 0.0]),
        ([[0.0, 0.0], [t, 1.0]], [0.0, 1.0]),
    ] {
        let valley = json!({
            "kind": "valley",
            "line": { "via": "free", "through": through },
            "moving": moving,
            "seed": { "scope": "all" }
        });
        let landed = json_of(
            engine
                .apply(state, js(valley), JsValue::UNDEFINED)
                .expect("valley"),
        );
        state = landed["state"].as_u64().expect("handle") as u32;
    }
    state
}

/// The kite base's right edge above the kite crease onto the diagonal, the
/// creases meeting on that kite crease.
fn kite_swivel() -> Value {
    let t = (std::f64::consts::PI / 8.0).tan();
    json!({
        "kind": "swivel",
        "via": "edge",
        "fold": [0.5, t / 2.0],
        "edge": [1.0, (t + 1.0) / 2.0],
        "target": { "via": "crease", "at": [0.5, 0.5] },
        "direction": "valley"
    })
}

/// The swivel on a folded edge (`fold` for `pivot`, no seed) crosses the
/// boundary as a plain object: its question names the folded edge, it lands
/// through `apply` and the tools' call alike, and a `seed` beside its `fold`
/// is the caller's mistake, thrown.
#[wasm_bindgen_test]
fn a_swivel_on_a_folded_edge_crosses_the_boundary_in_plain_objects() {
    let mut engine = FoldEngine::new();
    let parent = kite_base(&mut engine);
    let asked = json_of(
        engine
            .compound_analysis(parent, js(kite_swivel()), JsValue::UNDEFINED)
            .expect("question"),
    );
    assert_eq!(asked["status"], "ok", "{asked}");
    assert_eq!(asked["analysis"]["kind"], "swivel-by-edge");
    assert!(asked["analysis"]["fold"].is_object(), "{asked}");
    assert_eq!(asked["analysis"]["ridges"], json!([]));
    let applied = json_of(
        engine
            .apply(parent, js(kite_swivel()), JsValue::UNDEFINED)
            .expect("apply"),
    );
    assert_eq!(applied["status"], "ok", "{applied}");
    assert_eq!(applied["compound"]["kind"], "swivel");
    let tried = json_of(
        engine
            .vertex_fold(parent, js(kite_swivel()), JsValue::NULL)
            .expect("vertex fold"),
    );
    assert_eq!(tried["result"], "landed", "{tried}");
    let mut seeded = kite_swivel();
    seeded["seed"] = json!({ "scope": "all" });
    let thrown = engine
        .apply(parent, js(seeded), JsValue::UNDEFINED)
        .expect_err("a seed beside a fold");
    assert_eq!(json_of(thrown)["code"], "invalid_input");
}

/// The inside swivel (`swivel: 'inside'`) crosses the boundary too: its
/// question says which ways land of both kinds and lists its two orders
/// (the strip over or under the other flap), the tools' call holds them,
/// and a kind the bridge does not know is thrown.
#[wasm_bindgen_test]
fn an_inside_swivel_crosses_the_boundary_in_plain_objects() {
    let mut engine = FoldEngine::new();
    let parent = kite_base(&mut engine);
    let mut inside = kite_swivel();
    inside["swivel"] = json!("inside");
    let asked = json_of(
        engine
            .compound_analysis(parent, js(inside.clone()), JsValue::UNDEFINED)
            .expect("question"),
    );
    assert_eq!(asked["status"], "ok", "{asked}");
    assert_eq!(asked["kinds"], json!([[true, false], [true, false]]));
    assert_eq!(asked["directions"], json!([true, false]));
    assert_eq!(asked["orders"]["count"]["orders"], 2, "{asked}");
    let tried = json_of(
        engine
            .vertex_fold(parent, js(inside), JsValue::NULL)
            .expect("vertex fold"),
    );
    assert_eq!(tried["result"], "choose", "{tried}");
    let mut closed = kite_swivel();
    closed["swivel"] = json!("closed");
    let thrown = engine
        .apply(parent, js(closed), JsValue::UNDEFINED)
        .expect_err("a kind it does not know");
    assert_eq!(json_of(thrown)["code"], "invalid_input");
}
