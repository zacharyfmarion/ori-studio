//! The crimp and the tuck through the bridge, as the web app sends them
//! (plan Phase 11): the document's `crimp` and `tuck` ops resolve their
//! anchors in the parent; their analyses (the compound question,
//! `compound_analysis`) list the kinds that land and the layers a tuck
//! takes; a fold lands, asks for an opening, or lands every order to choose
//! from with what its step stores, each held as `apply` holds a step; a
//! stored step replays through `apply` to the same state, with the same
//! report, and is refused `choice_needed` or `choice_broken` when its stored
//! choices do not decide it or no longer resolve; and a landed one keeps its
//! step's summary after its parent is released.

#![cfg(not(target_arch = "wasm32"))]

use oristudio_fold::random::{self, Rng};
use oristudio_fold::{PlainFold, Seed, Sheet, StartSide, State};
use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::ops_crimp_tuck::{CrimpOp, TuckOp};
use oristudio_fold_wasm::wire::{BridgeError, Choices, Op, Outcome, Paper};
use serde::Serialize;
use serde_json::{Value, json};

fn json_of(value: &impl Serialize) -> Value {
    serde_json::to_value(value).unwrap_or_else(|e| panic!("{e}"))
}

fn ok<T: Serialize>(outcome: Result<Outcome<T>, BridgeError>) -> Value {
    match outcome {
        Ok(Outcome::Ok(value)) => json_of(&value),
        Ok(Outcome::Refused(r)) => panic!("refused: {}", json_of(&r)),
        Err(e) => panic!("{e}"),
    }
}

fn refused<T: Serialize>(outcome: Result<Outcome<T>, BridgeError>) -> Value {
    match outcome {
        Ok(Outcome::Refused(r)) => json_of(&Outcome::<()>::Refused(r)),
        Ok(Outcome::Ok(value)) => panic!("landed: {}", json_of(&value)),
        Err(e) => panic!("{e}"),
    }
}

fn choices(value: Value) -> Choices {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("choices {value}: {e}"))
}

fn crimp_op(value: &Value) -> CrimpOp {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("crimp {value}: {e}"))
}

fn tuck_op(value: &Value) -> TuckOp {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("tuck {value}: {e}"))
}

fn op(value: &Value) -> Op {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("op {value}: {e}"))
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

fn apply(
    bridge: &mut Bridge,
    state: u32,
    step: &Value,
    chosen: Value,
) -> Outcome<oristudio_fold_wasm::wire::Applied> {
    bridge
        .apply(state, &op(step), &choices(chosen))
        .unwrap_or_else(|e| panic!("{step}: {e}"))
}

fn landed_state(bridge: &mut Bridge, state: u32, step: &Value, chosen: Value) -> u32 {
    match apply(bridge, state, step, chosen) {
        Outcome::Ok(applied) => applied.state,
        Outcome::Refused(r) => panic!("{step} refused: {}", json_of(&r)),
    }
}

/// The compound question of a crimp or a tuck: its family's answer.
fn question(bridge: &Bridge, state: u32, step: &Value, chosen: Value, family: &str) -> Value {
    let asked = ok(bridge.compound_analysis(state, &op(step), &choices(chosen)));
    assert_eq!(asked["family"], family, "{asked}");
    asked
}

/// The square valley-folded along bd: the triangle b c d.
fn triangle(bridge: &mut Bridge) -> u32 {
    let sheet = square(bridge);
    let step = json!({
        "kind": "valley",
        "line": { "via": "free", "through": [[1.0, 0.0], [0.0, 1.0]] },
        "moving": [0.1, 0.1],
        "seed": { "scope": "all" },
    });
    landed_state(bridge, sheet, &step, json!({}))
}

/// The triangle's crimp of corner b (spike case 3, "perp"): ℓ1 square to
/// the spine at (0.4, 0.6), ℓ2 through (0.62, 0.38) at 36.87°, by two sheet
/// points each (the layer at the corner is the sheet's own).
fn perp_crimp(kind: &str) -> Value {
    let second_dir = [36.87_f64.to_radians().cos(), 36.87_f64.to_radians().sin()];
    json!({
        "kind": "crimp",
        "line": { "via": "free", "through": [[0.4, 0.6], [0.6, 0.8]] },
        "second": {
            "via": "free",
            "through": [
                [0.62, 0.38],
                [0.62 + 0.3 * second_dir[0], 0.38 + 0.3 * second_dir[1]]
            ]
        },
        "crimp": kind,
        "moving": [0.97, 0.06],
        "seed": { "scope": "all" },
    })
}

#[test]
fn a_crimp_lands_replays_and_refuses_the_kind_that_does_not_fit() {
    let mut bridge = Bridge::new();
    let tri = triangle(&mut bridge);
    let inside = perp_crimp("inside");
    let analysed = question(&bridge, tri, &inside, json!({}), "crimp");
    assert_eq!(analysed["kinds"], json!(["inside"]));
    assert_eq!(
        analysed["analysis"]["tip"]["tip"].as_array().map(Vec::len),
        Some(2)
    );
    let folded = ok(bridge.crimp(tri, &crimp_op(&inside), &choices(json!({}))));
    assert_eq!(folded["outcome"], "landed");
    assert_eq!(folded["summary"]["faces"], 6);
    assert_eq!(folded["stored"], json!({}));
    // Held as `apply` holds a step: no plain report, the crimp's as `compound`.
    assert_eq!(folded["report"], Value::Null);
    assert_eq!(folded["compound"]["family"], "crimp");
    // Both lines fold together: a spread and a close, the tip's turn about
    // ℓ2 carried by its strip's about ℓ1.
    let legs = folded["compound"]["motion"]["legs"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(legs.len(), 2);
    assert!(
        legs[0]["groups"]
            .as_array()
            .is_some_and(|groups| groups.iter().any(|g| g["carrier"]["axis"].is_object())),
        "{legs:?}"
    );
    assert_eq!(folded["compound"]["kind"], "inside");
    // The step replays through `apply` to the same state and report, with
    // its summary.
    let (replayed, applied) = match apply(&mut bridge, tri, &inside, json!({})) {
        Outcome::Ok(applied) => (applied.state, json_of(&applied)),
        Outcome::Refused(r) => panic!("refused: {}", json_of(&r)),
    };
    assert_eq!(applied["compound"], folded["compound"]);
    let (a, b) = (
        bridge.canonical_keys(replayed).unwrap_or_default(),
        bridge
            .canonical_keys(folded["state"].as_u64().unwrap_or_default() as u32)
            .unwrap_or_default(),
    );
    assert_eq!(a, b);
    let step = ok(bridge.step_summary(replayed));
    assert_eq!(
        step["summary"]["diff"]["added"].as_array().map(Vec::len),
        Some(4)
    );
    // Its picture: ℓ1 across the paper, no grip — the tip lands by ρ1∘ρ2,
    // not across ℓ1 — and a pleat arrow across both lines.
    let pictured = ok(bridge.step_action(replayed));
    assert!(pictured["action"]["line"].is_array(), "{pictured}");
    assert_eq!(pictured["action"]["grip"], Value::Null);
    assert_eq!(pictured["action"]["pleat"]["kinks"], 1);
    assert_eq!(pictured["action"]["direction"], "mountain");
    // The other kind does not fit, and offers this one.
    let outside = perp_crimp("outside");
    let refusal = refused(bridge.crimp(tri, &crimp_op(&outside), &choices(json!({}))));
    assert_eq!(refusal["refusal"]["code"], "crimp_kind_infeasible");
    assert_eq!(
        refusal["fixes"],
        json!([{ "fix": "other_kind", "kind": "inside" }])
    );
    assert!(!refusal["faces"].as_array().is_none_or(Vec::is_empty));
    // A root goes with an axiom line only; a pocket with a sink.
    let root = refused(bridge.crimp(
        tri,
        &crimp_op(&inside),
        &choices(json!({ "root": { "n": [1.0, 0.0], "d": 0.5 } })),
    ));
    assert_eq!(
        root["refusal"],
        json!({ "code": "unexpected_choice", "choice": "root" })
    );
    // A plain fold's questions, of its tip at ℓ1: what moves is the tip, the
    // depth picker previews the stacks along ℓ1, and the picture before it
    // lands is the step's own.
    let moving = ok(bridge.analyse(tri, &op(&inside), &Choices::default()));
    assert_eq!(
        moving["analysis"]["moving"],
        analysed["analysis"]["tip"]["tip"]
    );
    assert_eq!(
        moving["analysis"]["picked"].as_array().map(Vec::len),
        Some(1)
    );
    let depths = ok(bridge.depth_choices(tri, &op(&inside), &Choices::default(), [0.95, 0.15]));
    assert!(
        depths["choices"].as_array().is_some_and(|c| !c.is_empty()),
        "{depths}"
    );
    let previewed = ok(bridge.action(tri, &op(&inside), &Choices::default()));
    assert_eq!(previewed["action"], pictured["action"]);
    // A crimp kept its step's summary as it landed: with its parent let go
    // it still has it (a fold's would be `parent_released`); its picture is
    // drawn on its parent, so that is gone with it.
    assert!(bridge.release(tri));
    assert_eq!(ok(bridge.step_summary(replayed)), step);
    assert!(matches!(
        bridge.step_action(replayed),
        Err(BridgeError::ParentReleased { .. })
    ));
}

/// Book fold, book fold again: the strip [0, ¼] × [0, 1] in four layers,
/// whose flap opens two ways.
fn strip(bridge: &mut Bridge) -> u32 {
    let sheet = square(bridge);
    let book = json!({
        "kind": "valley",
        "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] },
        "moving": [0.9, 0.5],
        "seed": { "scope": "all" },
    });
    let book = landed_state(bridge, sheet, &book, json!({}));
    let again = json!({
        "kind": "valley",
        "line": { "via": "free", "through": [[0.25, 0.0], [0.25, 1.0]] },
        "moving": [0.4, 0.5],
        "seed": { "scope": "all" },
    });
    landed_state(bridge, book, &again, json!({}))
}

#[test]
fn a_crimp_asks_for_its_opening_and_stores_it() {
    let mut bridge = Bridge::new();
    let strip = strip(&mut bridge);
    let step = json!({
        "kind": "crimp",
        "line": { "via": "free", "through": [[0.0, 0.5], [0.25, 0.5]] },
        "second": { "via": "free", "through": [[0.0, 0.3], [0.25, 0.3]] },
        "crimp": "inside",
        "moving": [0.1, 0.2],
        "seed": { "scope": "all" },
    });
    let asked = ok(bridge.crimp(strip, &crimp_op(&step), &choices(json!({}))));
    assert_eq!(asked["outcome"], "choose_opening");
    let openings = asked["analysis"]["tip"]["flaps"][0]["openings"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(openings.len(), 2);
    assert_eq!(
        question(&bridge, strip, &step, json!({}), "crimp")["kinds"],
        Value::Null
    );
    // Replayed without the opening, the step needs it.
    let needed = match apply(&mut bridge, strip, &step, json!({})) {
        Outcome::Refused(r) => json_of(&Outcome::<()>::Refused(r)),
        Outcome::Ok(_) => panic!("landed without its opening"),
    };
    assert_eq!(
        needed["refusal"],
        json!({ "code": "choice_needed", "choice": "opening" })
    );
    let chosen = json!({ "opening": [openings[0]["stored"]] });
    let kinds = question(&bridge, strip, &step, chosen.clone(), "crimp")["kinds"].clone();
    assert!(kinds.as_array().is_some_and(|k| !k.is_empty()), "{kinds}");
    let folded = ok(bridge.crimp(strip, &crimp_op(&step), &choices(chosen.clone())));
    let stored = match folded["outcome"].as_str() {
        Some("landed") => folded["stored"].clone(),
        Some("choose_order") => folded["candidates"][0]["stored"].clone(),
        other => panic!("{other:?}: {folded}"),
    };
    assert_eq!(stored["opening"], json!([openings[0]["stored"]]));
    landed_state(&mut bridge, strip, &step, stored);
}

/// The book fold: the right half over the left.
fn book(bridge: &mut Bridge) -> u32 {
    let sheet = square(bridge);
    let book = json!({
        "kind": "valley",
        "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] },
        "moving": [0.75, 0.5],
        "seed": { "scope": "all" },
    });
    landed_state(bridge, sheet, &book, json!({}))
}

#[test]
fn a_tuck_lists_its_targets_lands_and_replays() {
    let mut bridge = Bridge::new();
    let book = book(&mut bridge);
    // Spike case 4a: the bottom layer's corner valley-folded under the top.
    let step = json!({
        "kind": "tuck",
        "line": { "via": "free", "through": [[0.0, 0.3], [0.3, 0.0]] },
        "direction": "valley",
        "seed": { "scope": "flaps", "at": [[0.05, 0.05]] },
        "target": [0.75, 0.5],
    });
    let analysed = question(&bridge, book, &step, json!({}), "tuck");
    assert_eq!(analysed["analysis"]["placement"], "under");
    let targets = analysed["analysis"]["targets"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert!(
        targets
            .iter()
            .any(|t| t["feasible"] == json!(true) && t["at"] == json!([0.75, 0.5])),
        "{targets:?}"
    );
    let folded = ok(bridge.tuck(book, &tuck_op(&step), &choices(json!({}))));
    assert_eq!(folded["outcome"], "landed");
    assert_eq!(folded["compound"]["family"], "tuck");
    assert_eq!(folded["compound"]["placement"], "under");
    assert_eq!(
        folded["compound"]["motion"]["legs"]
            .as_array()
            .map(Vec::len),
        Some(2)
    );
    let replayed = match apply(&mut bridge, book, &step, json!({})) {
        Outcome::Ok(applied) => {
            assert_eq!(json_of(&applied)["compound"], folded["compound"]);
            applied.state
        }
        Outcome::Refused(r) => panic!("refused: {}", json_of(&r)),
    };
    // A plain fold's questions, of its block against its target: the
    // bottom layer's corner alone moves (the plain fold's closure would take
    // the top layer's too), the moving side's flaps are the plain fold's,
    // and its picture is a plain fold's, with an arrow.
    let moving = ok(bridge.analyse(book, &op(&step), &Choices::default()));
    assert_eq!(moving["analysis"]["moving"], folded["compound"]["moving"]);
    assert_eq!(
        moving["analysis"]["moving"].as_array().map(Vec::len),
        Some(1)
    );
    assert_eq!(
        moving["analysis"]["picked"].as_array().map(Vec::len),
        Some(1)
    );
    let depths = ok(bridge.depth_choices(book, &op(&step), &Choices::default(), [0.05, 0.05]));
    assert!(
        depths["choices"].as_array().is_some_and(|c| !c.is_empty()),
        "{depths}"
    );
    let previewed = ok(bridge.action(book, &op(&step), &Choices::default()));
    assert!(previewed["action"]["grip"].is_object(), "{previewed}");
    assert_eq!(previewed["action"]["direction"], "valley");
    assert_eq!(previewed["action"]["pleat"], Value::Null);
    // The step's picture is the preview's, with the landed cover at the
    // arrow's head: under the top layer.
    let pictured = ok(bridge.step_action(replayed));
    assert_eq!(pictured["action"]["line"], previewed["action"]["line"]);
    assert_eq!(
        pictured["action"]["grip"]["at"],
        previewed["action"]["grip"]["at"]
    );
    assert_eq!(pictured["action"]["grip"]["hidden_image"], 1);
    // The layer the seed names is no target.
    let mut into_seed = step.clone();
    into_seed["target"] = json!([0.25, 0.5]);
    let refusal = refused(bridge.tuck(book, &tuck_op(&into_seed), &choices(json!({}))));
    assert_eq!(refusal["refusal"]["code"], "tuck_target_moves");
    // An opening is a crimp's or a reverse fold's.
    let opening = refused(bridge.tuck(
        book,
        &tuck_op(&step),
        &choices(json!({ "opening": [{ "upper": [[0.1, 0.1]] }] })),
    ));
    assert_eq!(
        opening["refusal"],
        json!({ "code": "unexpected_choice", "choice": "opening" })
    );
}

#[test]
fn a_pocket_tuck_too_deep_is_refused_naming_its_target() {
    let mut bridge = Bridge::new();
    let sheet = square(&mut bridge);
    let band = json!({
        "kind": "valley",
        "line": { "via": "free", "through": [[0.0, 0.8], [1.0, 0.8]] },
        "moving": [0.5, 0.9],
        "seed": { "scope": "all" },
    });
    let pocket = landed_state(&mut bridge, sheet, &band, json!({}));
    let deep = json!({
        "kind": "tuck",
        "line": { "via": "free", "through": [[0.0, 0.45], [1.0, 0.45]] },
        "direction": "valley",
        "moving": [0.5, 0.1],
        "seed": { "scope": "all" },
        "target": [0.5, 0.9],
    });
    let refusal = refused(bridge.tuck(pocket, &tuck_op(&deep), &choices(json!({}))));
    assert_eq!(refusal["refusal"]["code"], "tuck_infeasible");
    assert_eq!(refusal["refusal"]["placement"], "under");
    assert!(!refusal["faces"].as_array().is_none_or(Vec::is_empty));
    for fix in refusal["fixes"].as_array().cloned().unwrap_or_default() {
        assert_eq!(fix["fix"], "tuck_target");
    }
}

/// The states `random::folded_between` draws, built through the bridge
/// with the same draws: each drawn plain fold landed by the engine is sent
/// as a valley or mountain along its model line.
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
            handle = landed_state(bridge, handle, &plain_step(&fold), json!({}));
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
        "seed": seed(&fold.seed),
    })
}

fn seed(seed: &Seed) -> Value {
    match seed {
        Seed::All => json!({ "scope": "all" }),
        Seed::Depth { at, layers } => json!({ "scope": "depth", "at": at, "layers": layers }),
        Seed::Flaps { at } => json!({ "scope": "flaps", "at": at }),
    }
}

/// The tuck campaign's first tuck to leave two orders (setup 167 of seed 1:
/// four faces): every order landed, each replaying from what it stores.
#[test]
fn a_tuck_with_two_orders_lands_both_and_stores_each() {
    let mut bridge = Bridge::new();
    let mut rng = Rng::new(9001 + 167);
    let (state, handle) = drawn(&mut bridge, &mut rng, 2, 4);
    let tuck = random::tuck_fold(&state, &mut rng).unwrap_or_else(|| panic!("no tuck drawn"));
    let step = json!({
        "kind": "tuck",
        "line": { "via": "model", "line": json_of(&tuck.line) },
        "side": json_of(&tuck.side),
        "direction": json_of(&tuck.direction),
        "seed": seed(&tuck.seed),
        "target": tuck.target,
    });
    let folded = ok(bridge.tuck(handle, &tuck_op(&step), &choices(json!({}))));
    assert_eq!(folded["outcome"], "choose_order", "{folded}");
    assert_eq!(
        (folded["orders"].as_u64(), folded["exact"].as_bool()),
        (Some(2), Some(true))
    );
    let candidates = folded["candidates"].as_array().cloned().unwrap_or_default();
    assert_eq!(candidates.len(), 2);
    let mut keys = Vec::new();
    for candidate in &candidates {
        let stored = candidate["stored"].clone();
        assert!(
            stored["completion"]["faces"]
                .as_array()
                .is_some_and(|f| !f.is_empty())
        );
        let replayed = landed_state(&mut bridge, handle, &step, stored);
        let held = candidate["state"].as_u64().unwrap_or_default() as u32;
        assert_eq!(
            bridge.canonical_keys(replayed).unwrap_or_default(),
            bridge.canonical_keys(held).unwrap_or_default()
        );
        keys.push(bridge.canonical_keys(held).unwrap_or_default());
    }
    assert_ne!(keys[0], keys[1]);
    // Without its order the stored step needs it; with a witness off the
    // paper it is broken.
    let needed = match apply(&mut bridge, handle, &step, json!({})) {
        Outcome::Refused(r) => json_of(&Outcome::<()>::Refused(r)),
        Outcome::Ok(_) => panic!("landed without its order"),
    };
    assert_eq!(
        needed["refusal"],
        json!({ "code": "choice_needed", "choice": "completion" })
    );
    let mut broken = candidates[0]["stored"].clone();
    broken["completion"]["faces"][0] = json!([5.0, 5.0]);
    let refusal = match apply(&mut bridge, handle, &step, broken) {
        Outcome::Refused(r) => json_of(&Outcome::<()>::Refused(r)),
        Outcome::Ok(_) => panic!("a broken order landed"),
    };
    assert_eq!(refusal["refusal"]["code"], "choice_broken");
    // The engine's cause, flattened beside the code (`crate::compound`).
    assert_eq!(refusal["refusal"]["broken"], "witness");
}
