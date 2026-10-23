//! The bridge natively, through JSON shaped exactly as the web app sends it:
//! the document's ops resolve against their parent (free lines, creases and
//! axioms with their stored roots), refusals come back as codes with fixes and
//! never a sentence, narrow resolved overlaps retain their requested lines, the queries on a handle answer for the state they name, and the
//! engine's own classic sequences replay through the bridge — along model
//! lines, and along axioms — to the outcomes its fixtures record.
//! `tests/node.rs` covers the same calls across the wasm boundary.

#![cfg(not(target_arch = "wasm32"))]

use std::path::PathBuf;

use oristudio_fold::{State, VertexId};
use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::wire::{BridgeError, Choices, Op, Outcome, Paper};
use oristudio_geometry::Line;
use serde::Serialize;
use serde_json::{Value, json};

type Point = [f64; 2];

fn paper(value: Value) -> Paper {
    serde_json::from_value(value).unwrap_or_else(|e| panic!("paper: {e}"))
}

fn op(value: Value) -> Op {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("op {value}: {e}"))
}

fn choices(value: Value) -> Choices {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("choices {value}: {e}"))
}

fn none() -> Choices {
    Choices::default()
}

fn json_of(value: &impl Serialize) -> Value {
    serde_json::to_value(value).unwrap_or_else(|e| panic!("{e}"))
}

fn sheet_of(bridge: &mut Bridge, shape: Value) -> u32 {
    match bridge.sheet(&paper(json!({ "shape": shape, "startSide": "front" }))) {
        Outcome::Ok(made) => made.state,
        Outcome::Refused(r) => panic!("{:?}", r.refusal),
    }
}

fn square(bridge: &mut Bridge) -> u32 {
    sheet_of(bridge, json!({ "kind": "square" }))
}

/// Apply and expect a landing: the new handle and the whole result as JSON.
fn land(bridge: &mut Bridge, state: u32, step: Value) -> (u32, Value) {
    land_with(bridge, state, step, json!({}))
}

fn land_with(bridge: &mut Bridge, state: u32, step: Value, chosen: Value) -> (u32, Value) {
    match bridge.apply(state, &op(step.clone()), &choices(chosen)) {
        Ok(Outcome::Ok(applied)) => (applied.state, json_of(&applied)),
        Ok(Outcome::Refused(r)) => panic!("{step} refused: {}", json_of(&r)),
        Err(e) => panic!("{step}: {e}"),
    }
}

/// Apply and expect a refusal: its JSON.
fn refuse(bridge: &mut Bridge, state: u32, step: Value) -> Value {
    refuse_with(bridge, state, step, json!({}))
}

fn refuse_with(bridge: &mut Bridge, state: u32, step: Value, chosen: Value) -> Value {
    match bridge.apply(state, &op(step.clone()), &choices(chosen)) {
        Ok(Outcome::Refused(r)) => json_of(&Outcome::<()>::Refused(r)),
        Ok(Outcome::Ok(applied)) => panic!("{step} landed: {}", json_of(&applied)),
        Err(e) => panic!("{step}: {e}"),
    }
}

/// An answer that must be `ok`, as JSON.
fn ok<T: Serialize>(outcome: Result<Outcome<T>, BridgeError>) -> Value {
    let outcome = json_of(&outcome.unwrap_or_else(|e| panic!("{e}")));
    assert_eq!(outcome["status"], "ok", "{outcome}");
    outcome
}

fn line(n: Point, d: f64) -> Line {
    Line::new(n, d).unwrap_or_else(|| unreachable!())
}

/// G1's book fold, as the document stores it: x = 0.5, the right half over
/// the left.
fn book_step() -> Value {
    json!({
        "kind": "valley",
        "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] },
        "moving": [0.75, 0.5],
        "seed": { "scope": "all" }
    })
}

fn book(bridge: &mut Bridge) -> u32 {
    let sheet = square(bridge);
    land(bridge, sheet, book_step()).0
}

/// Every string in a JSON value, recursively.
fn strings(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::String(s) => out.push(s.clone()),
        Value::Array(items) => items.iter().for_each(|v| strings(v, out)),
        Value::Object(map) => map.values().for_each(|v| strings(v, out)),
        _ => {}
    }
}

fn number(value: &Value) -> f64 {
    value.as_f64().unwrap_or(f64::NAN)
}

fn near(value: &Value, expected: Point) -> bool {
    (number(&value[0]) - expected[0]).abs() < 1e-9 && (number(&value[1]) - expected[1]).abs() < 1e-9
}

#[test]
fn sheets_land_or_refuse_with_the_engines_codes() {
    let mut bridge = Bridge::new();
    let made = bridge.sheet(&paper(json!({ "shape": { "kind": "square" } })));
    let made = json_of(&made);
    assert_eq!(made["status"], "ok");
    assert_eq!(made["summary"]["faces"], 1);
    assert_eq!(made["summary"]["step"], 0);
    assert_eq!(made["summary"]["creases"]["border"], 4);
    assert_eq!(made["summary"]["view"]["flipped"], false);

    let back = json_of(&bridge.sheet(&paper(json!({
        "shape": { "kind": "rectangle", "aspect": [1.0, 0.5] },
        "startSide": "back"
    }))));
    assert_eq!(back["summary"]["view"]["flipped"], true);
    assert_eq!(back["summary"]["sheet"][2], json!([1.0, 0.5]));

    let hexagon = json_of(&bridge.sheet(&paper(json!({
        "shape": { "kind": "polygon", "points": [
            [0.5, 0.0], [1.0, 0.25], [1.0, 0.75], [0.5, 1.0], [0.0, 0.75], [0.0, 0.25]
        ] }
    }))));
    assert_eq!(hexagon["status"], "ok", "{hexagon}");

    for (shape, code) in [
        (
            json!({ "kind": "polygon", "points": [[0.0, 0.0], [1.0, 0.0], [0.5, 0.3], [0.5, 1.0]] }),
            "sheet_not_convex",
        ),
        (
            json!({ "kind": "rectangle", "aspect": [0.0, 1.0] }),
            "invalid_rectangle",
        ),
    ] {
        let refused = json_of(&bridge.sheet(&paper(json!({ "shape": shape }))));
        assert_eq!(refused["status"], "refused");
        assert_eq!(refused["refusal"]["code"], code, "{refused}");
    }
    assert_eq!(bridge.len(), 3, "only landed sheets are held");
}

#[test]
fn a_document_fold_resolves_its_anchors_in_the_parent() {
    let mut bridge = Bridge::new();
    let sheet = square(&mut bridge);
    let (state, applied) = land(&mut bridge, sheet, book_step());
    assert_ne!(state, sheet);
    assert_eq!(applied["state"], state);
    assert_eq!(applied["summary"]["step"], 1);
    assert_eq!(applied["summary"]["faces"], 2);
    assert_eq!(applied["summary"]["creases"]["valley"], 1);
    let report = &applied["report"];
    assert_eq!(report["moving"].as_array().map(Vec::len), Some(1));
    assert_eq!(report["created"].as_array().map(Vec::len), Some(1));
    assert_eq!(report["direction"], "valley");
    assert_eq!(report["line"], json!({ "n": [1.0, 0.0], "d": 0.5 }));

    // The second fold's free line is given by sheet points of the folded
    // form, on either layer: (0.75, 0.5) lies on the flap, whose image is
    // (0.25, 0.5), so with (0.1, 0.5) on the layer below the line is y = 0.5
    // in the model frame.
    let second = |through: Value| {
        json!({
            "kind": "valley",
            "line": { "via": "free", "through": through },
            "moving": [0.25, 0.75],
            "seed": { "scope": "all" }
        })
    };
    let (_, landed) = land(&mut bridge, state, second(json!([[0.1, 0.5], [0.75, 0.5]])));
    assert_eq!(landed["report"]["line"]["n"], json!([0.0, 1.0]));
    assert_eq!(landed["summary"]["faces"], 4);
    // (0.25, 0.5) lies under (0.75, 0.5): one point of the folded form.
    let same = refuse(
        &mut bridge,
        state,
        second(json!([[0.25, 0.5], [0.75, 0.5]])),
    );
    assert_eq!(same["refusal"]["code"], "free_line_too_short");
    // The parent is still held: a replay's cache keeps both.
    assert!(bridge.summary(state).is_ok());
}

#[test]
fn refusals_are_codes_with_fixes_and_never_sentences() {
    let mut bridge = Bridge::new();
    let book = book(&mut bridge);
    // Everything on the left of x = 0.5 is both layers: nothing stays.
    let refused = refuse(
        &mut bridge,
        book,
        json!({
            "kind": "valley",
            "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] },
            "moving": [0.25, 0.5],
            "seed": { "scope": "all" }
        }),
    );
    assert_eq!(refused["status"], "refused");
    assert_eq!(refused["refusal"], json!({ "code": "nothing_stays" }));
    let fixes = refused["fixes"].as_array().cloned().unwrap_or_default();
    assert_eq!(fixes.len(), 1, "{refused}");
    assert_eq!(fixes[0]["fix"], "pick_flap");
    assert_eq!(fixes[0]["flaps"].as_array().map(Vec::len), Some(2));
    assert!(refused["faces"].is_array() && refused["vertices"].is_array());

    // Every string in a refusal is a code or an enum, none a sentence.
    let mut text = Vec::new();
    strings(&refused, &mut text);
    assert!(text.iter().all(|s| !s.contains(' ')), "{text:?}");
}

#[test]
fn analysis_reports_the_moving_set_flaps_and_closure() {
    let mut bridge = Bridge::new();
    let book = book(&mut bridge);
    let analysed = ok(bridge.analyse(
        book,
        &op(json!({
            "kind": "valley",
            "line": { "via": "crease", "at": [0.5, 0.5] },
            "seed": { "scope": "flaps", "at": [[0.75, 0.5]] }
        })),
        &none(),
    ));
    let analysis = &analysed["analysis"];
    assert_eq!(analysis["flaps"].as_array().map(Vec::len), Some(2));
    assert_eq!(analysis["picked"].as_array().map(Vec::len), Some(1));
    assert_eq!(analysis["added"], json!([]));
    assert_eq!(analysis["moving"].as_array().map(Vec::len), Some(1));
    assert_eq!(bridge.len(), 2, "analysing lands nothing");

    // Turn and rotate move no paper.
    let turn = bridge.analyse(
        book,
        &op(json!({ "kind": "turn", "axis": "vertical" })),
        &none(),
    );
    assert!(matches!(turn, Err(BridgeError::InvalidInput(_))));
}

#[test]
fn unfold_and_refold_fold_along_an_existing_crease() {
    let mut bridge = Bridge::new();
    let book = book(&mut bridge);
    // G10: the top layer back along the bend, picked by depth.
    let (open, unfolded) = land(
        &mut bridge,
        book,
        json!({
            "kind": "unfold",
            "crease": [0.5, 0.5],
            "direction": "valley",
            "seed": { "scope": "depth", "at": [0.25, 0.5], "layers": 1 }
        }),
    );
    assert_eq!(
        unfolded["report"]["unfolded"].as_array().map(Vec::len),
        Some(1)
    );
    assert_eq!(unfolded["summary"]["creases"]["flat"], 1);
    assert_eq!(unfolded["summary"]["creases"]["valley"], 0);

    // Now the crease is flat: it refolds, and no longer unfolds.
    let again = refuse(
        &mut bridge,
        open,
        json!({
            "kind": "unfold", "crease": [0.5, 0.5], "direction": "valley",
            "seed": { "scope": "depth", "at": [0.25, 0.5], "layers": 1 }
        }),
    );
    assert_eq!(again["refusal"]["code"], "crease_not_folded");
    let (_, refolded) = land(
        &mut bridge,
        open,
        json!({
            "kind": "refold", "crease": [0.5, 0.5], "direction": "valley",
            "moving": [0.75, 0.5], "seed": { "scope": "all" }
        }),
    );
    let refold = &refolded["report"]["refolded"][0];
    assert_eq!(refold["remembered"], "valley");
    assert_eq!(refold["letter"], "valley");

    // A folded crease does not refold, and a point on no crease names none.
    let folded = refuse(
        &mut bridge,
        book,
        json!({
            "kind": "refold", "crease": [0.5, 0.5], "direction": "valley",
            "moving": [0.25, 0.5], "seed": { "scope": "all" }
        }),
    );
    assert_eq!(folded["refusal"]["code"], "crease_not_flat");
    // The sheet's border is neither flat nor folded.
    for (kind, code) in [
        ("refold", "crease_not_flat"),
        ("unfold", "crease_not_folded"),
    ] {
        let border = refuse(
            &mut bridge,
            book,
            json!({
                "kind": kind, "crease": [0.25, 0.0], "direction": "valley",
                "moving": [0.25, 0.5], "seed": { "scope": "all" }
            }),
        );
        assert_eq!(border["refusal"]["code"], code);
    }
    let nowhere = refuse(
        &mut bridge,
        book,
        json!({
            "kind": "valley", "line": { "via": "crease", "at": [0.3, 0.5] },
            "moving": [0.1, 0.5], "seed": { "scope": "all" }
        }),
    );
    assert_eq!(
        nowhere["refusal"],
        json!({ "code": "crease_not_found", "point": [0.3, 0.5] })
    );
}

#[test]
fn precrease_turn_and_rotate_are_one_step_each() {
    let mut bridge = Bridge::new();
    let sheet = square(&mut bridge);
    let (pre, precreased) = land(
        &mut bridge,
        sheet,
        json!({
            "kind": "precrease", "direction": "valley",
            "line": { "via": "free", "through": [[0.0, 0.0], [1.0, 1.0]] },
            "moving": [0.9, 0.1], "seed": { "scope": "all" }
        }),
    );
    assert_eq!(precreased["summary"]["creases"]["flat"], 1);
    assert_eq!(precreased["summary"]["faces"], 2);
    assert_eq!(precreased["summary"]["pairs"], 0, "flat again");

    let (turned, turn) = land(
        &mut bridge,
        pre,
        json!({ "kind": "turn", "axis": "horizontal" }),
    );
    assert_eq!(turn["report"], Value::Null);
    assert_eq!(turn["summary"]["step"], 2);
    assert_eq!(turn["summary"]["view"]["flipped"], true);
    let (_, rotate) = land(
        &mut bridge,
        turned,
        json!({ "kind": "rotate", "rotate": { "amount": "quarter", "direction": "cw" } }),
    );
    assert_eq!(rotate["summary"]["step"], 3);
    let rotation = number(&rotate["summary"]["view"]["rotation"]);
    // π (the horizontal turn) less a quarter turn.
    assert!(
        (rotation - std::f64::consts::FRAC_PI_2).abs() < 1e-12,
        "{rotation}"
    );

    let missing = bridge.apply(
        sheet,
        &op(json!({
            "kind": "precrease",
            "line": { "via": "free", "through": [[0.0, 0.0], [1.0, 1.0]] },
            "moving": [0.9, 0.1], "seed": { "scope": "all" }
        })),
        &none(),
    );
    assert!(matches!(missing, Err(BridgeError::InvalidInput(_))));
}

#[test]
fn a_rotation_by_an_exact_angle_turns_the_view_by_it() {
    let mut bridge = Bridge::new();
    let sheet = square(&mut bridge);
    // 30° clockwise is −π/6 in the engine's counter-clockwise sense.
    let (cw, clockwise) = land(
        &mut bridge,
        sheet,
        json!({ "kind": "rotate", "rotate": { "amount": "degrees", "degrees": 30.0, "direction": "cw" } }),
    );
    assert_eq!(clockwise["report"], Value::Null);
    assert_eq!(clockwise["summary"]["step"], 1);
    let rotation = number(&clockwise["summary"]["view"]["rotation"]);
    assert!(
        (rotation + std::f64::consts::FRAC_PI_6).abs() < 1e-12,
        "{rotation}"
    );
    // Then 22.5° counterclockwise: the turns add up.
    let (_, back) = land(
        &mut bridge,
        cw,
        json!({ "kind": "rotate", "rotate": { "amount": "degrees", "degrees": 22.5, "direction": "ccw" } }),
    );
    let rotation = number(&back["summary"]["view"]["rotation"]);
    assert!(
        (rotation - (22.5f64 - 30.0).to_radians()).abs() < 1e-12,
        "{rotation}"
    );
    // The same angle by its preset and by its degrees lands the same view.
    let (_, eighth) = land(
        &mut bridge,
        sheet,
        json!({ "kind": "rotate", "rotate": { "amount": "eighth", "direction": "ccw" } }),
    );
    assert!(
        (number(&eighth["summary"]["view"]["rotation"]) - std::f64::consts::FRAC_PI_4).abs()
            < 1e-12
    );

    // An exact angle that is none, or degrees beside a preset: the caller's mistake.
    for rotate in [
        json!({ "amount": "degrees", "direction": "cw" }),
        json!({ "amount": "degrees", "degrees": 0.0, "direction": "cw" }),
        json!({ "amount": "degrees", "degrees": -30.0, "direction": "cw" }),
        json!({ "amount": "degrees", "degrees": 200.0, "direction": "cw" }),
        json!({ "amount": "quarter", "degrees": 90.0, "direction": "cw" }),
    ] {
        let wrong = bridge.apply(
            sheet,
            &op(json!({ "kind": "rotate", "rotate": rotate })),
            &none(),
        );
        assert!(
            matches!(wrong, Err(BridgeError::InvalidInput(_))),
            "{rotate}"
        );
    }
}

#[test]
fn a_model_line_takes_its_side_against_the_normal_as_given() {
    let mut bridge = Bridge::new();
    let sheet = square(&mut bridge);
    // x = 0.5 written with the normal pointing left: its negative side is the
    // right half, which is what moves.
    let (_, right) = land(
        &mut bridge,
        sheet,
        json!({
            "kind": "valley",
            "line": { "via": "model", "line": { "n": [-1.0, 0.0], "d": -0.5 } },
            "side": "negative",
            "seed": { "scope": "all" }
        }),
    );
    let (_, book) = land(&mut bridge, sheet, book_step());
    assert_eq!(right["report"]["moving"], book["report"]["moving"]);
    assert_eq!(
        right["report"]["side"], "positive",
        "canonical in the report"
    );

    let refused = |bridge: &mut Bridge, step: Value| {
        matches!(
            bridge.apply(sheet, &op(step), &none()),
            Err(BridgeError::InvalidInput(_))
        )
    };
    // Both a side and a sheet point; a zero normal; a side of a line with no
    // normal given.
    assert!(refused(
        &mut bridge,
        json!({
            "kind": "valley",
            "line": { "via": "model", "line": { "n": [1.0, 0.0], "d": 0.5 } },
            "side": "positive", "moving": [0.75, 0.5],
            "seed": { "scope": "all" }
        })
    ));
    assert!(refused(
        &mut bridge,
        json!({
            "kind": "valley",
            "line": { "via": "model", "line": { "n": [0.0, 0.0], "d": 0.5 } },
            "side": "positive", "seed": { "scope": "all" }
        })
    ));
    assert!(refused(
        &mut bridge,
        json!({
            "kind": "valley",
            "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] },
            "side": "positive", "seed": { "scope": "all" }
        })
    ));
}

#[test]
fn anchors_that_do_not_resolve_are_refusals() {
    let mut bridge = Bridge::new();
    let sheet = square(&mut bridge);
    let along = |line: Value, moving: Value| json!({ "kind": "mountain", "line": line, "moving": moving, "seed": { "scope": "all" } });
    let cases = [
        (
            along(
                json!({ "via": "free", "through": [[0.5, 0.0], [0.5, 1.5]] }),
                json!([0.75, 0.5]),
            ),
            json!({ "code": "point_off_paper", "point": [0.5, 1.5] }),
        ),
        (
            along(
                json!({ "via": "free", "through": [[0.5, 0.5], [0.5, 0.5002]] }),
                json!([0.75, 0.5]),
            ),
            json!({
                "code": "free_line_too_short",
                "a": [0.5, 0.5], "b": [0.5, 0.5002], "distance": 0.0002
            }),
        ),
        (
            along(
                json!({ "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] }),
                json!([0.5, 0.25]),
            ),
            json!({ "code": "side_on_line", "point": [0.5, 0.25] }),
        ),
        (
            json!({
                "kind": "valley",
                "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] },
                "seed": { "scope": "all" }
            }),
            json!({ "code": "no_side" }),
        ),
        (
            json!({
                "kind": "valley",
                "line": { "via": "model", "line": { "n": [1.0, 0.0], "d": 0.5 } },
                "moving": [1.5, 0.5], "seed": { "scope": "all" }
            }),
            json!({ "code": "point_off_paper", "point": [1.5, 0.5] }),
        ),
        // A stored import whose order no longer reads (`tests/io.rs` has the rest).
        (
            json!({ "kind": "cp-jump", "cpJson": "{}", "orderJson": "{}", "origin": "cp" }),
            json!({ "code": "import_stored_unreadable", "field": "order_json" }),
        ),
    ];
    for (step, expected) in cases {
        let refused = refuse(&mut bridge, sheet, step.clone());
        let mut body = refused["refusal"].clone();
        // The distance is the engine's arithmetic, compared within rounding.
        if let Some(distance) = body.get_mut("distance") {
            assert!((number(distance) - 0.0002).abs() < 1e-12, "{refused}");
            *distance = json!(0.0002);
        }
        assert_eq!(body, expected, "{step}");
        assert_eq!(refused["fixes"], json!([]));
    }
    assert_eq!(bridge.len(), 1, "no refusal lands a state");
}

#[test]
fn a_choice_the_op_cannot_use_breaks_it() {
    let mut bridge = Bridge::new();
    let sheet = square(&mut bridge);
    // A compound fold's completion: its pairs as FOLD triples over
    // witnesses, as Import CP's `orderJson` stores an order.
    let refused = refuse_with(
        &mut bridge,
        sheet,
        book_step(),
        json!({ "completion": { "faces": [[0.1, 0.1], [0.9, 0.1]], "orders": [[0, 1, 1]] } }),
    );
    assert_eq!(
        refused["refusal"],
        json!({ "code": "unexpected_choice", "choice": "completion" })
    );
    let opening = refuse_with(
        &mut bridge,
        sheet,
        book_step(),
        json!({ "opening": [{ "upper": [[0.9, 0.1]] }] }),
    );
    assert_eq!(
        opening["refusal"],
        json!({ "code": "unexpected_choice", "choice": "opening" })
    );
    // A root is an axiom fold's choice only.
    let root = refuse_with(
        &mut bridge,
        sheet,
        book_step(),
        json!({ "root": { "n": [1.0, 0.0], "d": 0.5 } }),
    );
    assert_eq!(
        root["refusal"],
        json!({ "code": "unexpected_choice", "choice": "root" })
    );
    // A pocket is a closed sink's only.
    let pocket = refuse_with(
        &mut bridge,
        sheet,
        book_step(),
        json!({ "pocket": [[0.1, 0.1], [0.9, 0.1]] }),
    );
    assert_eq!(
        pocket["refusal"],
        json!({ "code": "unexpected_choice", "choice": "pocket" })
    );
    // An empty list is no choice, and nor is a completion that orders nothing.
    land_with(&mut bridge, sheet, book_step(), json!({ "opening": [] }));
    land_with(
        &mut bridge,
        sheet,
        book_step(),
        json!({ "completion": { "faces": [], "orders": [] } }),
    );
    land_with(
        &mut bridge,
        sheet,
        book_step(),
        json!({ "completion": { "faces": [], "orders": [] }, "opening": [] }),
    );
}

#[test]
fn handles_are_held_until_released() {
    let mut bridge = Bridge::new();
    let a = square(&mut bridge);
    let b = square(&mut bridge);
    assert!(a != 0 && b != 0 && a != b);
    assert!(bridge.release(a));
    assert!(!bridge.release(a));
    assert_eq!(bridge.summary(a), Err(BridgeError::UnknownState(a)));
    assert_eq!(BridgeError::UnknownState(a).code(), "unknown_state");
    let c = square(&mut bridge);
    assert!(c != a, "a released handle is never reused");
    assert!(matches!(
        bridge.apply(a, &op(book_step()), &none()),
        Err(BridgeError::UnknownState(_))
    ));
    bridge.clear();
    assert!(bridge.is_empty());
}

#[test]
fn the_fingerprint_keys_follow_the_state_not_its_numbering() {
    let mut one = Bridge::new();
    let mut two = Bridge::new();
    // Two engines, the second with handles already spent: the keys of the
    // same path agree.
    let _ = square(&mut two);
    let (a, b) = (book(&mut one), book(&mut two));
    let keys = |bridge: &Bridge, state: u32| {
        let mut keys = bridge
            .canonical_keys(state)
            .unwrap_or_else(|e| panic!("{e}"));
        keys.sort();
        keys
    };
    let book_keys = keys(&one, a);
    assert_eq!(book_keys, keys(&two, b));
    assert!(
        book_keys.iter().any(|k| k.starts_with("o:")),
        "{book_keys:?}"
    );
    assert!(book_keys.iter().any(|k| k.starts_with("v:")));

    // Four quarter turns are no turn; two turn-overs are none.
    let mut state = a;
    for _ in 0..4 {
        state = land(
            &mut one,
            state,
            json!({ "kind": "rotate", "rotate": { "amount": "quarter", "direction": "ccw" } }),
        )
        .0;
    }
    assert_eq!(keys(&one, state), book_keys);
    let turned = land(&mut one, a, json!({ "kind": "turn", "axis": "vertical" })).0;
    let turned_keys = keys(&one, turned);
    assert_ne!(turned_keys, book_keys);
    let changed: Vec<&String> = turned_keys
        .iter()
        .filter(|k| !book_keys.contains(k))
        .collect();
    assert!(
        changed.iter().all(|k| k.starts_with("v:")),
        "a turn changes the view alone: {changed:?}"
    );
    let back = land(
        &mut one,
        turned,
        json!({ "kind": "turn", "axis": "vertical" }),
    )
    .0;
    assert_eq!(keys(&one, back), book_keys);

    // The other direction is another state.
    let sheet = square(&mut one);
    let (mountain, _) = land(
        &mut one,
        sheet,
        json!({
            "kind": "mountain",
            "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] },
            "moving": [0.75, 0.5], "seed": { "scope": "all" }
        }),
    );
    assert_ne!(keys(&one, mountain), book_keys);
}

// --- Axioms ------------------------------------------------------------------

/// O2, corner onto corner: the line `y = x`, and the corner `(1, 0)` carried
/// across it, which says the side.
fn corner_to_corner() -> Value {
    json!({
        "via": "axiom", "axiom": 2,
        "inputs": [{ "kind": "point", "at": [1.0, 0.0] }, { "kind": "mark", "at": [0.0, 1.0], "mark": "fmark-1" }]
    })
}

#[test]
fn an_axiom_folds_along_its_stored_root() {
    let mut bridge = Bridge::new();
    let sheet = square(&mut bridge);
    let candidates = ok(bridge.axiom_candidates(
        sheet,
        &serde_json::from_value(corner_to_corner()).unwrap_or_else(|e| panic!("{e}")),
    ));
    let candidates = candidates["candidates"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(candidates.len(), 1, "{candidates:?}");
    let chosen = &candidates[0];
    assert_eq!(chosen["root"], 0);
    assert!(chosen["side"].is_string(), "O2 says who moves: {chosen}");
    let root = chosen["line"].clone();

    let step = json!({ "kind": "valley", "line": corner_to_corner(), "seed": { "scope": "all" } });
    let (folded, landed) = land_with(&mut bridge, sheet, step.clone(), json!({ "root": root }));
    assert_eq!(landed["summary"]["faces"], 2);
    let corner = bridge
        .state(folded)
        .ok()
        .and_then(|s| s.resolve_point([1.0, 0.0]))
        .unwrap_or_else(|| panic!("the corner"));
    assert!((corner[0]).abs() < 1e-12 && (corner[1] - 1.0).abs() < 1e-12);

    // Replay takes the nearest root: a stored line that drifted lands the
    // same state.
    let drifted = json!({ "n": root["n"], "d": number(&root["d"]) + 1e-5 });
    let (again, _) = land_with(&mut bridge, sheet, step.clone(), json!({ "root": drifted }));
    assert_eq!(
        bridge.canonical_keys(again).ok().map(sorted),
        bridge.canonical_keys(folded).ok().map(sorted)
    );

    // An axiom step needs its root; inputs that do not fit its slots are a
    // caller's mistake.
    let missing = refuse(&mut bridge, sheet, step);
    assert_eq!(missing["refusal"], json!({ "code": "root_missing" }));
    let wrong = bridge.apply(
        sheet,
        &op(json!({
            "kind": "valley",
            "line": { "via": "axiom", "axiom": 4, "inputs": [
                { "kind": "point", "at": [0.5, 0.5] }, { "kind": "point", "at": [0.2, 0.2] }
            ] },
            "moving": [0.9, 0.9], "seed": { "scope": "all" }
        })),
        &choices(json!({ "root": { "n": [1.0, 0.0], "d": 0.5 } })),
    );
    assert!(matches!(wrong, Err(BridgeError::InvalidInput(_))));
    let not_axiom = bridge.axiom_candidates(
        sheet,
        &serde_json::from_value(json!({ "via": "crease", "at": [0.5, 0.5] }))
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert!(matches!(not_axiom, Err(BridgeError::InvalidInput(_))));
}

/// O2, `p` onto `q`, and the first root the bridge names for it: its line
/// and the side it implies.
fn o2_root(bridge: &Bridge, state: u32, p: Point, q: Point) -> (Value, Value, Value) {
    let line = json!({
        "via": "axiom", "axiom": 2,
        "inputs": [{ "kind": "point", "at": p }, { "kind": "point", "at": q }]
    });
    let candidates = ok(bridge.axiom_candidates(
        state,
        &serde_json::from_value(line.clone()).unwrap_or_else(|e| panic!("{e}")),
    ));
    let root = candidates["candidates"][0].clone();
    assert!(root["side"].is_string(), "O2 says who moves: {root}");
    (line, root["line"].clone(), root["side"].clone())
}

/// Where a sheet point lies in a state's model frame.
fn image_of(bridge: &Bridge, state: u32, p: Point) -> Point {
    bridge
        .state(state)
        .ok()
        .and_then(|s| s.resolve_point(p))
        .unwrap_or_else(|| panic!("{p:?} is off the paper"))
}

fn close(a: Point, b: Point) -> bool {
    (a[0] - b[0]).hypot(a[1] - b[1]) < 1e-9
}

/// Swap over the bridge, the owner's case first: an axiom that carries a
/// point names the side that moves, and a stored `moving` on the other side
/// beats it — one rule, in the engine's anchored folds, for every op along a
/// line: a valley, a mountain, a precrease, an inside and an outside reverse
/// fold, a crimp's first line. The side comes back in each report, and the
/// stored step replays to the same state.
#[test]
fn a_stored_moving_point_beats_the_side_an_axiom_implies() {
    let mut bridge = Bridge::new();
    let other = |side: &Value| {
        json!(if side == "positive" {
            "negative"
        } else {
            "positive"
        })
    };

    // On the square: the top-left corner onto the bottom-right one, and,
    // swapped, the bottom-right onto the top-left.
    let sheet = square(&mut bridge);
    let (line, root, implied) = o2_root(&bridge, sheet, [0.0, 1.0], [1.0, 0.0]);
    let chosen = json!({ "root": root });
    for (kind, extra) in [
        ("valley", json!({})),
        ("mountain", json!({})),
        ("precrease", json!({ "direction": "valley" })),
    ] {
        let mut step = json!({ "kind": kind, "line": line, "seed": { "scope": "all" } });
        let mut swapped = step.clone();
        for value in [&mut step, &mut swapped] {
            if let (Some(op), Some(more)) = (value.as_object_mut(), extra.as_object()) {
                op.extend(more.clone());
            }
        }
        swapped["moving"] = json!([0.9, 0.1]);
        let (plain, landed) = land_with(&mut bridge, sheet, step, chosen.clone());
        assert_eq!(landed["report"]["side"], implied, "{kind}");
        let (moved, landed) = land_with(&mut bridge, sheet, swapped.clone(), chosen.clone());
        assert_eq!(landed["report"]["side"], other(&implied), "{kind}");
        if kind != "precrease" {
            // The top-left corner comes onto the bottom-right one, or, swapped,
            // stays while the bottom-right one comes onto it.
            for (state, corner, lands) in [
                (plain, [0.0, 1.0], [1.0, 0.0]),
                (plain, [1.0, 0.0], [1.0, 0.0]),
                (moved, [1.0, 0.0], [0.0, 1.0]),
                (moved, [0.0, 1.0], [0.0, 1.0]),
            ] {
                let at = image_of(&bridge, state, corner);
                assert!(close(at, lands), "{kind}: {corner:?} at {at:?}");
            }
        }
        // Replayed as the document stores it: the same state.
        let (again, _) = land_with(&mut bridge, sheet, swapped, chosen.clone());
        assert_eq!(
            bridge.canonical_keys(again).ok().map(sorted),
            bridge.canonical_keys(moved).ok().map(sorted),
            "{kind}"
        );
    }

    // On the triangle b c d (the square folded along bd, its spine): b onto
    // d is y = x, square to the spine at its middle, a tip either side. The
    // axiom says b's tip; swapped, d's is the one reversed or crimped.
    let tri = {
        let step = json!({
            "kind": "valley",
            "line": { "via": "free", "through": [[1.0, 0.0], [0.0, 1.0]] },
            "moving": [0.1, 0.1],
            "seed": { "scope": "all" }
        });
        land(&mut bridge, sheet, step).0
    };
    let (line, root, implied) = o2_root(&bridge, tri, [1.0, 0.0], [0.0, 1.0]);
    let chosen = json!({ "root": root });
    // A point of d's tip, and each tip's crimp line beyond y = x.
    let d_side = [0.2, 0.9];
    let beyond = |toward_d: bool| {
        let shift = if toward_d { 0.15 } else { -0.15 };
        json!({ "via": "free", "through": [[0.5 - shift, 0.5 + shift], [0.8 - shift, 0.8 + shift]] })
    };
    for kind in ["inside-reverse", "outside-reverse", "crimp"] {
        let step = |swapped: bool| {
            let mut step = json!({ "kind": kind, "line": line, "seed": { "scope": "all" } });
            if kind == "crimp" {
                step["second"] = beyond(swapped);
                step["crimp"] = json!("inside");
            }
            if swapped {
                step["moving"] = json!(d_side);
            }
            step
        };
        let (_, landed) = land_with(&mut bridge, tri, step(false), chosen.clone());
        assert_eq!(landed["compound"]["side"], implied, "{kind}");
        let (moved, landed) = land_with(&mut bridge, tri, step(true), chosen.clone());
        assert_eq!(landed["compound"]["side"], other(&implied), "{kind}");
        // d's corner moved, b's stayed.
        let [d, b] = [[0.0, 1.0], [1.0, 0.0]].map(|corner| image_of(&bridge, moved, corner));
        assert!(!close(d, [0.0, 1.0]) && close(b, [1.0, 0.0]), "{kind}");
        let (again, _) = land_with(&mut bridge, tri, step(true), chosen.clone());
        assert_eq!(
            bridge.canonical_keys(again).ok().map(sorted),
            bridge.canonical_keys(moved).ok().map(sorted),
            "{kind}"
        );
    }
}

fn sorted(mut keys: Vec<String>) -> Vec<String> {
    keys.sort();
    keys
}

#[test]
fn axioms_refuse_by_the_engines_codes() {
    let mut bridge = Bridge::new();
    let sheet = square(&mut bridge);
    // O1 carries nothing: the side is the step's to name.
    let o1 = json!({
        "kind": "valley",
        "line": { "via": "axiom", "axiom": 1, "inputs": [
            { "kind": "point", "at": [0.5, 0.0] }, { "kind": "point", "at": [0.5, 1.0] }
        ] },
        "seed": { "scope": "all" }
    });
    let root = json!({ "root": { "n": [1.0, 0.0], "d": 0.5 } });
    let no_side = refuse_with(&mut bridge, sheet, o1.clone(), root.clone());
    assert_eq!(no_side["refusal"], json!({ "code": "no_side" }));
    let mut toward = o1;
    toward["moving"] = json!([0.75, 0.5]);
    land_with(&mut bridge, sheet, toward, root);

    // O5 about (0, 0), carrying (0.1, 0) onto the top edge: no circle of
    // radius 0.1 reaches it.
    let o5 = json!({
        "via": "axiom", "axiom": 5,
        "inputs": [
            { "kind": "point", "at": [0.0, 0.0] }, { "kind": "point", "at": [0.1, 0.0] },
            { "kind": "edge", "a": [0.0, 1.0], "b": [1.0, 1.0] }
        ]
    });
    let none_here = ok(bridge.axiom_candidates(
        sheet,
        &serde_json::from_value(o5.clone()).unwrap_or_else(|e| panic!("{e}")),
    ));
    assert_eq!(none_here["candidates"], json!([]));
    let no_root = refuse_with(
        &mut bridge,
        sheet,
        json!({ "kind": "valley", "line": o5, "seed": { "scope": "all" } }),
        json!({ "root": { "n": [1.0, 0.0], "d": 0.5 } }),
    );
    assert_eq!(no_root["refusal"], json!({ "code": "no_root", "axiom": 5 }));

    // The mover must be on a layer that moves: the book's stacked corner at
    // (0, 0) folded onto (0.3, 0.3), the top layer only. Named by the top
    // layer's copy it lands; by the bottom layer's, which stays, it does not.
    let book = land(&mut bridge, sheet, book_step()).0;
    let carry = |p: Point| {
        json!({
            "kind": "valley",
            "line": { "via": "axiom", "axiom": 2, "inputs": [
                { "kind": "point", "at": p }, { "kind": "point", "at": [0.3, 0.3] }
            ] },
            "seed": { "scope": "depth", "at": [0.95, 0.05], "layers": 1 }
        })
    };
    let diagonal = std::f64::consts::FRAC_1_SQRT_2;
    let root = json!({ "root": { "n": [diagonal, diagonal], "d": 0.3 * diagonal } });
    land_with(&mut bridge, book, carry([1.0, 0.0]), root.clone());
    let stays = refuse_with(&mut bridge, book, carry([0.0, 0.0]), root.clone());
    assert_eq!(
        stays["refusal"],
        json!({ "code": "mover_stays", "point": [0.0, 0.0] })
    );
    let analysed = json_of(
        &bridge
            .analyse(book, &op(carry([0.0, 0.0])), &choices(root))
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert_eq!(analysed["refusal"]["code"], "mover_stays");
}

/// `oristudio-fold`'s sliver strip: a 1 × ½ strip with its left end folded
/// over at x = 0.3, covering x ∈ [0.3, 0.6]; folding the right end at
/// x = 0.79995 lands its corners 1e-4 inside that layer.
fn strip(bridge: &mut Bridge) -> u32 {
    let sheet = sheet_of(bridge, json!({ "kind": "rectangle", "aspect": [1.0, 0.5] }));
    land(
        bridge,
        sheet,
        json!({
            "kind": "valley",
            "line": { "via": "free", "through": [[0.3, 0.0], [0.3, 0.5]] },
            "moving": [0.1, 0.25], "seed": { "scope": "all" }
        }),
    )
    .0
}

#[test]
fn a_resolved_narrow_overlap_replays_without_a_line_correction() {
    let mut bridge = Bridge::new();
    let parent = strip(&mut bridge);
    let free = json!({ "kind": "valley",
        "line": { "via": "free", "through": [[0.79995, 0.0], [0.79995, 0.5]] },
        "moving": [0.9, 0.25], "seed": { "scope": "all" } });
    let axiom = json!({ "kind": "valley",
        "line": { "via": "axiom", "axiom": 4, "inputs": [
            { "kind": "point", "at": [0.79995, 0.25] },
            { "kind": "edge", "a": [0.3, 0.0], "b": [1.0, 0.0] }] },
        "moving": [0.9, 0.25], "seed": { "scope": "all" } });
    for (op, choices) in [
        (free, json!({})),
        (axiom, json!({ "root": { "n": [1.0, 0.0], "d": 0.79995 } })),
    ] {
        let (state, result) = land_with(&mut bridge, parent, op.clone(), choices.clone());
        assert_eq!(result["summary"]["pairs"], 3);
        assert_eq!(result["report"]["line"]["d"], 0.79995);
        let (replay, _) = land_with(&mut bridge, parent, op, choices);
        assert_eq!(
            bridge.state(state).unwrap().parts(),
            bridge.state(replay).unwrap().parts()
        );
    }
}

// --- Queries on a handle -----------------------------------------------------

#[test]
fn the_scene_is_the_kernels_with_folds_own_fields() {
    let mut bridge = Bridge::new();
    let book = book(&mut bridge);
    let scene = json_of(&bridge.scene(book).unwrap_or_else(|e| panic!("{e}")));
    assert_eq!(scene["schema_version"], 3);
    assert_eq!(scene["fold_schema"], 1);
    assert_eq!(scene["flipped"], false);
    assert_eq!(scene["faces"].as_array().map(Vec::len), Some(2));
    assert_eq!(scene["face_transforms"].as_array().map(Vec::len), Some(2));
    assert_eq!(scene["lineage"].as_array().map(Vec::len), Some(2));
    assert_eq!(
        scene["view_transform"],
        json!([1.0, 0.0, 0.0, 0.0, 1.0, 0.0])
    );
    assert_eq!(scene["sheet_points"].as_array().map(Vec::len), Some(6));
    assert_eq!(scene["aux_lines"], json!([]));
    let creases = scene["creases"].as_array().cloned().unwrap_or_default();
    let valley: Vec<&Value> = creases.iter().filter(|c| c["letter"] == "valley").collect();
    assert_eq!(valley.len(), 1);
    assert_eq!(valley[0]["kind"], "fold");
    assert_eq!(valley[0]["made_at"], 1);
    let stacked = scene["subfaces"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|s| s["faces_top_to_bottom"].as_array().map_or(0, Vec::len))
        .max();
    assert_eq!(stacked, Some(2));
}

#[test]
fn a_steps_picture_and_summary_are_asked_of_the_child() {
    let mut bridge = Bridge::new();
    let sheet = square(&mut bridge);

    // Before it lands: the line across the sheet, the right half moving.
    let preview = ok(bridge.action(sheet, &op(book_step()), &none()));
    let action = &preview["action"];
    assert_eq!(action["kind"], "fold");
    assert_eq!(action["direction"], "valley");
    assert_eq!(action["moving"].as_array().map(Vec::len), Some(1));
    assert_eq!(
        action["grip"]["hidden_image"],
        Value::Null,
        "nothing landed"
    );

    let (book, _) = land(&mut bridge, sheet, book_step());
    let landed = ok(bridge.step_action(book));
    assert_eq!(
        landed["action"]["grip"]["hidden_image"], 0,
        "it lands on top"
    );
    assert_eq!(landed["action"]["line"], action["line"]);
    let summary = ok(bridge.step_summary(book));
    let summary = &summary["summary"];
    assert_eq!(
        summary["counts"],
        json!({ "mountain": 0, "valley": 1, "flat": 0 })
    );
    assert_eq!(summary["diff"]["added"].as_array().map(Vec::len), Some(1));
    assert_eq!(summary["layers"], 1);

    // The sheet has no step; a turn has a summary with no layers and no
    // picture; a precrease's picture says so.
    assert_eq!(ok(bridge.step_summary(sheet))["summary"], Value::Null);
    assert_eq!(ok(bridge.step_action(sheet))["action"], Value::Null);
    let (turned, _) = land(
        &mut bridge,
        book,
        json!({ "kind": "turn", "axis": "vertical" }),
    );
    let turn = ok(bridge.step_summary(turned));
    assert_eq!(turn["summary"]["layers"], Value::Null);
    assert_eq!(turn["summary"]["diff"]["added"], json!([]));
    assert_eq!(ok(bridge.step_action(turned))["action"], Value::Null);
    let (pre, _) = land(
        &mut bridge,
        sheet,
        json!({
            "kind": "precrease", "direction": "mountain",
            "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] },
            "moving": [0.75, 0.5], "seed": { "scope": "all" }
        }),
    );
    let precreased = ok(bridge.step_action(pre));
    assert_eq!(precreased["action"]["kind"], "precrease");
    assert_eq!(precreased["action"]["grip"]["hidden_image"], Value::Null);
    assert_eq!(ok(bridge.step_summary(pre))["summary"]["counts"]["flat"], 1);

    // Both need the parent.
    assert!(bridge.release(sheet));
    for asked in [
        bridge.step_summary(book).err(),
        bridge.step_action(book).err(),
    ] {
        assert_eq!(
            asked,
            Some(BridgeError::ParentReleased {
                state: book,
                parent: sheet
            })
        );
    }
    assert_eq!(
        BridgeError::ParentReleased {
            state: book,
            parent: sheet
        }
        .code(),
        "parent_released"
    );
}

#[test]
fn the_cross_section_has_rows_and_the_bends_that_join_them() {
    let mut bridge = Bridge::new();
    let book = book(&mut bridge);
    // Across the bend: y = 0.5, the upper half moving. Two rows, one flap
    // (the bend's upper half joins them), joined where the bend meets the
    // line.
    let section =
        ok(bridge.cross_section(book, &line([0.0, 1.0], 0.5), oristudio_fold::Side::Positive));
    let section = &section["section"];
    assert_eq!(section["rows"].as_array().map(Vec::len), Some(2));
    assert_eq!(section["layers"], 2);
    assert_eq!(
        section["order"],
        json!({ "kind": "layered", "unordered": [] })
    );
    assert_eq!(section["flaps"].as_array().map(Vec::len), Some(1));
    let joins = section["joins"].as_array().cloned().unwrap_or_default();
    assert_eq!(joins.len(), 1, "{section}");
    assert_eq!(
        (&joins[0]["upper"], &joins[0]["lower"]),
        (&json!(0), &json!(1))
    );
    // The bend is at x = 0.5: half a sheet along from one end of the section.
    let from = &section["from"];
    let at = number(&joins[0]["at"]);
    let end = (number(&from["x"]) - 0.5).abs() < 1e-9;
    assert!((at - if end { 0.0 } else { 0.5 }).abs() < 1e-9, "{section}");

    // The same line written the other way, as the wire may bring it, its
    // side with it.
    let written = Line {
        n: [0.0, -1.0],
        d: -0.5,
    };
    let flipped = ok(bridge.cross_section(book, &written, oristudio_fold::Side::Negative));
    assert_eq!(flipped["section"], *section);

    // The section describes the layers before selection. Folding either
    // layer this close to the spine still refuses and offers its landmark.
    let inspection = ok(bridge.cross_section(
        book,
        &line([1.0, 0.0], 0.5 - 1e-4),
        oristudio_fold::Side::Negative,
    ));
    assert_eq!(inspection["section"]["layers"], 2);
    let near_miss = refuse(
        &mut bridge,
        book,
        json!({
            "kind": "valley",
            "line": { "via": "free", "through": [[0.4999, 0.0], [0.4999, 1.0]] },
            "moving": [0.25, 0.3], "seed": { "scope": "all" }
        }),
    );
    assert_eq!(near_miss["refusal"]["code"], "near_miss");
    assert_eq!(near_miss["fixes"][0]["fix"], "use_line");
    assert_eq!(
        near_miss["fixes"][0].get("step"),
        None,
        "a landmark, no step"
    );
}

#[test]
fn depth_choices_and_the_top_layer_under_a_pick() {
    let mut bridge = Bridge::new();
    let book = book(&mut bridge);
    let (quarters, _) = land(
        &mut bridge,
        book,
        json!({
            "kind": "valley",
            "line": { "via": "free", "through": [[0.1, 0.5], [0.4, 0.5]] },
            "moving": [0.25, 0.75], "seed": { "scope": "all" }
        }),
    );
    // The top layer at the stacked corner, as a pick finds it.
    let top = bridge
        .top_visible_at(quarters, [0.03, 0.03])
        .unwrap_or_else(|e| panic!("{e}"))
        .unwrap_or_else(|| panic!("paper under the pick"));
    let state = bridge.state(quarters).unwrap_or_else(|e| panic!("{e}"));
    let stack = state.stack_at([0.03, 0.03]).unwrap_or_default();
    assert_eq!(stack.first(), Some(&top.face));
    let image = state.resolve_point(top.sheet).unwrap_or_default();
    assert!((image[0] - 0.03).abs() < 1e-12 && (image[1] - 0.03).abs() < 1e-12);
    assert_eq!(
        bridge.top_visible_at(quarters, [2.0, 2.0]).ok(),
        Some(None),
        "off the paper"
    );

    // Four free corners, one per layer: four nested choices.
    let diagonal = std::f64::consts::FRAC_1_SQRT_2;
    let corner = op(json!({
        "kind": "valley",
        "line": { "via": "model", "line": { "n": [diagonal, diagonal], "d": 0.15 * diagonal } },
        "side": "negative", "seed": { "scope": "all" }
    }));
    let chosen = ok(bridge.depth_choices(quarters, &corner, &none(), top.sheet));
    let layers: Vec<(Value, usize)> = chosen["choices"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|c| {
            (
                c["layers"].clone(),
                c["moving"].as_array().map_or(0, Vec::len),
            )
        })
        .collect();
    assert_eq!(
        layers,
        vec![(json!(1), 1), (json!(2), 2), (json!(3), 3), (json!(4), 4)]
    );
    let off = json_of(
        &bridge
            .depth_choices(quarters, &corner, &none(), [0.4, 0.4])
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert_eq!(off["refusal"]["code"], "seed_not_on_moving_side");
}

#[test]
fn landmarks_carry_provenance_and_the_marks_passed_in() {
    let mut bridge = Bridge::new();
    let book = book(&mut bridge);
    let landmarks = json_of(
        &bridge
            .landmarks(book, &[[0.25, 0.5], [3.0, 3.0]])
            .unwrap_or_else(|e| panic!("{e}")),
    );
    let sources: Vec<Value> = landmarks["points"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .flat_map(|p| p["sources"].as_array().cloned().unwrap_or_default())
        .collect();
    let marks: Vec<&Value> = sources.iter().filter(|s| s["kind"] == "mark").collect();
    assert_eq!(marks.len(), 1, "a mark off the paper is left out");
    assert_eq!(marks[0]["mark"], 0);
    assert!(near(&marks[0]["sheet"], [0.25, 0.5]));
    // The corner (1, 0) sits on (0, 0) with the corner it covers.
    assert!(
        sources
            .iter()
            .any(|s| s["kind"] == "vertex" && near(&s["sheet"], [1.0, 0.0]))
    );
    let segments = landmarks["segments"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert!(segments.iter().any(|s| s["kind"] == "bend"));
    assert!(matches!(
        bridge.landmarks(book, &[[f64::NAN, 0.0]]),
        Err(BridgeError::InvalidInput(_))
    ));
}

// --- The engine's classic sequences, through the bridge ------------------

/// One recorded step of `oristudio-fold`'s classics fixtures, as the engine
/// serialised it, made a document op with a model line.
fn fixture_op(step: &Value) -> Value {
    let to_op = |fold: &Value, kind: &str| {
        let mut op = json!({
            "kind": kind,
            "line": { "via": "model", "line": fold["line"] },
            "side": fold["side"],
            "seed": seed_of(fold),
            "placement": fold["placement"],
            "closure": fold["closure"],
        });
        if kind == "precrease" {
            op["direction"] = fold["direction"].clone();
        }
        op
    };
    match step["op"].as_str() {
        Some("fold") => {
            let kind = step["fold"]["direction"].as_str().unwrap_or_default();
            to_op(&step["fold"], kind)
        }
        Some("precrease") => to_op(&step["fold"], "precrease"),
        Some("turn_over") => json!({ "kind": "turn", "axis": "vertical" }),
        other => panic!("op {other:?}"),
    }
}

/// The engine's seed as the document's.
fn seed_of(fold: &Value) -> Value {
    match fold["seed"]["seed"].as_str() {
        Some("all") => json!({ "scope": "all" }),
        Some("depth") => json!({
            "scope": "depth", "at": fold["seed"]["at"], "layers": fold["seed"]["layers"]
        }),
        Some("flaps") => json!({ "scope": "flaps", "at": fold["seed"]["at"] }),
        other => panic!("seed {other:?}"),
    }
}

/// The same recorded step as a fold along an axiom, as the tools store one:
/// O1 through two sheet points whose images lie on the recorded line, the
/// line itself as the chosen root, and — when the seed names no point — a
/// sheet point on the moving side.
fn fixture_axiom_op(state: &State, step: &Value) -> (Value, Value) {
    if step["op"] == "turn_over" {
        return (json!({ "kind": "turn", "axis": "vertical" }), json!({}));
    }
    let fold = &step["fold"];
    let n = [number(&fold["line"]["n"][0]), number(&fold["line"]["n"][1])];
    let recorded = line(n, number(&fold["line"]["d"]));
    let [p, q] = points_on(state, &recorded);
    let kind = if step["op"] == "precrease" {
        json!("precrease")
    } else {
        fold["direction"].clone()
    };
    let mut op = json!({
        "kind": kind,
        "line": { "via": "axiom", "axiom": 1, "inputs": [
            { "kind": "point", "at": p }, { "kind": "point", "at": q }
        ] },
        "seed": seed_of(fold),
        "placement": fold["placement"],
        "closure": fold["closure"],
    });
    if step["op"] == "precrease" {
        op["direction"] = fold["direction"].clone();
    }
    if fold["seed"]["seed"] == "all" {
        let positive = fold["side"] == "positive";
        op["moving"] = json!(on_side(state, &recorded, positive));
    }
    (op, json!({ "root": recorded }))
}

/// Two sheet points whose images lie on `line`, a quarter of the way in from
/// each end of the longest stretch of it one face covers.
fn points_on(state: &State, line: &Line) -> [Point; 2] {
    let mut best: Option<(f64, Point, Point, oristudio_fold::FaceId)> = None;
    for face in state.faces() {
        let Some(image) = state.face_image(face.id) else {
            continue;
        };
        let mut hits = Vec::new();
        for i in 0..image.len() {
            let (a, b) = (image[i], image[(i + 1) % image.len()]);
            let (da, db) = (line.signed_distance(a), line.signed_distance(b));
            if (da < 0.0) != (db < 0.0) {
                let u = da / (da - db);
                hits.push([a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])]);
            }
        }
        let along = |p: &Point| p[0] * -line.n[1] + p[1] * line.n[0];
        hits.sort_by(|a, b| along(a).total_cmp(&along(b)));
        let (Some(&a), Some(&b)) = (hits.first(), hits.last()) else {
            continue;
        };
        let length = (b[0] - a[0]).hypot(b[1] - a[1]);
        if best.is_none_or(|(l, ..)| length > l) {
            best = Some((length, a, b, face.id));
        }
    }
    let (_, a, b, face) = best.unwrap_or_else(|| panic!("{line:?} misses the paper"));
    let back = state
        .isometry(face)
        .unwrap_or_else(|| unreachable!())
        .inverse();
    let at = |u: f64| back.apply([a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])]);
    [at(0.25), at(0.75)]
}

/// The sheet vertex whose image lies furthest on one side of `line`.
fn on_side(state: &State, line: &Line, positive: bool) -> Point {
    let sign = if positive { 1.0 } else { -1.0 };
    (0..state.vertices().len())
        .filter_map(|v| {
            let image = state.vertex_image(VertexId(v as u32))?;
            Some((sign * line.signed_distance(image), state.vertices()[v]))
        })
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .filter(|(d, _)| *d > 1e-3)
        .map(|(_, p)| p)
        .unwrap_or_else(|| panic!("no paper on that side of {line:?}"))
}

/// The classics fixtures, and the shape each starts from.
fn classics() -> Vec<(PathBuf, Value)> {
    let dir =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../oristudio-fold/tests/fixtures/classics");
    let mut entries: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    entries.sort();
    assert!(entries.len() >= 4, "{entries:?}");
    entries
        .into_iter()
        .map(|path| {
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            let fixture: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{e}"));
            (path, fixture)
        })
        .collect()
}

/// Replay a classics fixture through the bridge, each step made by `make`
/// from the parent state and the recorded step, checking each landing
/// against what the fixture records.
fn replay_classic(
    path: &std::path::Path,
    fixture: &Value,
    make: impl Fn(&State, &Value) -> (Value, Value),
) {
    let mut bridge = Bridge::new();
    let shape = match fixture["sheet"]["shape"].as_str() {
        Some("square") => json!({ "kind": "square" }),
        Some("rectangle") => json!({
            "kind": "rectangle",
            "aspect": [fixture["sheet"]["width"], fixture["sheet"]["height"]]
        }),
        other => panic!("sheet {other:?}"),
    };
    let start = fixture["start"].clone();
    let Outcome::Ok(made) = bridge.sheet(&paper(json!({ "shape": shape, "startSide": start })))
    else {
        panic!("{}: the sheet", path.display())
    };
    let mut state = made.state;
    let steps = fixture["steps"].as_array().cloned().unwrap_or_default();
    for (i, step) in steps.iter().enumerate() {
        let (op, chosen) = make(
            bridge.state(state).unwrap_or_else(|e| panic!("{e}")),
            &step[0],
        );
        let (next, applied) = land_with(&mut bridge, state, op, chosen);
        let expected = &step[1];
        let summary = &applied["summary"];
        let name = format!("{} step {i}", path.display());
        assert_eq!(summary["faces"], expected["faces"], "{name}");
        assert_eq!(summary["pairs"], expected["pairs"], "{name}");
        let moved = applied["report"]["moving"].as_array().map_or(0, Vec::len);
        assert_eq!(Some(moved as u64), expected["moved"].as_u64(), "{name}");
        let creases = expected["creases"].as_array().cloned().unwrap_or_default();
        let count = |kind: &str, letter: Option<&str>| {
            creases
                .iter()
                .filter(|c| {
                    c["kind"]["kind"] == kind && letter.is_none_or(|l| c["kind"]["letter"] == l)
                })
                .count() as u64
        };
        let counts = &summary["creases"];
        assert_eq!(
            counts["border"].as_u64(),
            Some(count("border", None)),
            "{name}"
        );
        assert_eq!(
            counts["mountain"].as_u64(),
            Some(count("folded", Some("mountain"))),
            "{name}"
        );
        assert_eq!(
            counts["valley"].as_u64(),
            Some(count("folded", Some("valley"))),
            "{name}"
        );
        assert_eq!(counts["flat"].as_u64(), Some(count("flat", None)), "{name}");
        assert!(bridge.release(state));
        state = next;
    }
}

#[test]
fn the_classics_replay_through_the_bridge() {
    for (path, fixture) in classics() {
        replay_classic(&path, &fixture, |_, step| (fixture_op(step), json!({})));
    }
}

#[test]
fn the_classics_replay_along_axioms() {
    for (path, fixture) in classics() {
        replay_classic(&path, &fixture, fixture_axiom_op);
    }
}
