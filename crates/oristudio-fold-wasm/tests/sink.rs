//! Sinks through the bridge (`ops_sinks`), in JSON shaped as the web app
//! sends it, on the preliminary and waterbomb samples imported as Import CP
//! imports them: open and closed sinks and the unsink back landed by
//! `apply` along the document's lines (free, existing crease, the tools'
//! model line); the closed sink's pocket asked for, stored and replayed; the
//! tilted line refused with the square line and the closed sink as fixes;
//! the choices a sink takes and the ones it does not; every landing
//! reported as the step's `compound`, family `sink`; and the queries — the
//! compound question, and a sink tool's own.

#![cfg(not(target_arch = "wasm32"))]

use std::path::PathBuf;

use oristudio_fold::{State, WitnessOrder};
use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::canonical::canonical_keys;
use oristudio_fold_wasm::io::{CpFile, CpFormat, Imports, Limits, Target};
use oristudio_fold_wasm::ops_sinks::{sink_orders, sink_pick, sunk_points};
use oristudio_fold_wasm::wire::{BridgeError, Choices, Op, Outcome};
use serde::Serialize;
use serde_json::{Value, json};

type Point = [f64; 2];

const C: Point = [0.5, 0.5];
const K: Point = [0.0, 0.0];
const M: Point = [0.0, 0.5];

fn json_of(value: &impl Serialize) -> Value {
    serde_json::to_value(value).unwrap_or_else(|e| panic!("{e}"))
}

fn op(value: Value) -> Op {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("op {value}: {e}"))
}

fn choices(value: Value) -> Choices {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("choices {value}: {e}"))
}

/// A sample imported into an empty sequence, as Import CP lands it.
fn sample(name: &str) -> (Bridge, u32) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/fold-samples")
        .join(format!("{name}.fold"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let mut bridge = Bridge::new();
    let mut imports = Imports::new();
    let file = CpFile {
        format: CpFormat::Fold,
        sample: true,
    };
    let target = Target::Empty {
        start_side: oristudio_fold::StartSide::Front,
    };
    let opened = match imports.open(&bridge, file, text.as_bytes(), target, &Limits::default()) {
        Ok(Outcome::Ok(opened)) => opened,
        other => panic!("{name}: {other:?}"),
    };
    let choice = vec![0; opened.components.len()];
    match imports.pick(&mut bridge, opened.import, &choice) {
        Ok(Outcome::Ok(landed)) => (bridge, landed.state),
        other => panic!("{name} pick: {other:?}"),
    }
}

fn at(p: Point, toward: Point, t: f64) -> Point {
    [p[0] + t * (toward[0] - p[0]), p[1] + t * (toward[1] - p[1])]
}

/// A base's sink line at depth `f` of its point's axis, through a sheet
/// point on a spoke along the axis and one on a spoke along a side; and a
/// sheet point of the tip near the centre, between the two spokes.
struct Base {
    name: &'static str,
    /// The spoke along the axis and the one along a side, and how far along
    /// each, per unit of depth, the ring crosses it.
    axis: (Point, f64),
    side: (Point, f64),
}

const PRELIMINARY: Base = Base {
    name: "preliminary-base",
    axis: (K, 1.0),
    side: (M, 2.0),
};

const WATERBOMB: Base = Base {
    name: "waterbomb-base",
    axis: (M, 1.0),
    side: (K, 1.0),
};

impl Base {
    fn ring(&self, f: f64) -> [Point; 2] {
        [
            at(C, self.axis.0, self.axis.1 * f),
            at(C, self.side.0, self.side.1 * f),
        ]
    }

    /// A sheet point of the tip piece between the two spokes.
    fn tip(&self, f: f64) -> Point {
        let [a, b] = self.ring(f);
        [(C[0] + a[0] + b[0]) / 3.0, (C[1] + a[1] + b[1]) / 3.0]
    }

    fn sink(&self, kind: &str, f: f64) -> Value {
        json!({
            "kind": kind,
            "line": { "via": "free", "through": self.ring(f) },
            "seed": { "scope": "flaps", "at": [self.tip(f)] },
        })
    }

    /// The unsink of a sink at depth `f`: along the ring crease between the
    /// two spokes, the sunk tip named by the same sheet point.
    fn unsink(&self, f: f64) -> Value {
        let [a, b] = self.ring(f);
        json!({
            "kind": "unsink",
            "line": { "via": "crease", "at": at(a, b, 0.5) },
            "seed": { "scope": "flaps", "at": [self.tip(f)] },
        })
    }
}

fn apply(bridge: &mut Bridge, state: u32, step: &Value, chosen: Value) -> Outcome<Value> {
    match bridge.apply(state, &op(step.clone()), &choices(chosen)) {
        Ok(Outcome::Ok(applied)) => Outcome::Ok(json_of(&applied)),
        Ok(Outcome::Refused(r)) => Outcome::Refused(r),
        Err(e) => panic!("{step}: {e}"),
    }
}

fn landed(bridge: &mut Bridge, state: u32, step: &Value, chosen: Value) -> (u32, Value) {
    match apply(bridge, state, step, chosen) {
        Outcome::Ok(applied) => (applied["state"].as_u64().unwrap_or(0) as u32, applied),
        Outcome::Refused(r) => panic!("{step} refused: {}", json_of(&r)),
    }
}

fn refused(bridge: &mut Bridge, state: u32, step: &Value, chosen: Value) -> Value {
    match apply(bridge, state, step, chosen) {
        Outcome::Refused(r) => json_of(&Outcome::<()>::Refused(r)),
        Outcome::Ok(applied) => panic!("{step} landed: {applied}"),
    }
}

fn state(bridge: &Bridge, handle: u32) -> &State {
    bridge.state(handle).unwrap_or_else(|e| panic!("{e}"))
}

fn ok(outcome: Outcome<impl Serialize>) -> Value {
    match outcome {
        Outcome::Ok(value) => json_of(&value),
        Outcome::Refused(r) => panic!("refused: {}", json_of(&r)),
    }
}

/// The compound question of a sink: its family's answer.
fn sink_analysis(
    bridge: &Bridge,
    state: u32,
    op: &Op,
    choices: &Choices,
) -> Result<Outcome<Value>, BridgeError> {
    Ok(match bridge.compound_analysis(state, op, choices)? {
        Outcome::Ok(asked) => {
            let asked = json_of(&asked);
            assert_eq!(asked["family"], "sink", "{asked}");
            Outcome::Ok(asked)
        }
        Outcome::Refused(refusal) => Outcome::Refused(refusal),
    })
}

/// A query that must be refused, as JSON.
fn ok_refused<T: Serialize>(outcome: Result<Outcome<T>, BridgeError>) -> Value {
    match outcome {
        Ok(Outcome::Refused(r)) => json_of(&Outcome::<()>::Refused(r)),
        Ok(Outcome::Ok(value)) => panic!("answered: {}", json_of(&value)),
        Err(e) => panic!("{e}"),
    }
}

/// An open sink lands through `apply` with its report beside no plain one:
/// its ring, its motion's two legs and what it stores (nothing). Its step
/// summary counts the ring's mountains and the layers it went through; it
/// has no picture yet. The unsink along a ring crease lands the base again,
/// the ring flat.
#[test]
fn a_sample_open_sinks_and_unsinks_through_apply() {
    for base in [PRELIMINARY, WATERBOMB] {
        let (mut bridge, start) = sample(base.name);
        let f = 0.3;
        let (sunk, applied) = landed(&mut bridge, start, &base.sink("open-sink", f), json!({}));
        assert_eq!(applied["report"], Value::Null, "{}", base.name);
        let report = &applied["compound"];
        assert_eq!(report["family"], "sink", "{}", base.name);
        assert_eq!(report["step"], "open", "{}", base.name);
        assert_eq!(report["ring"].as_array().map(Vec::len), Some(8));
        assert_eq!(report["motion"]["kind"], "visual");
        assert_eq!(report["motion"]["legs"].as_array().map(Vec::len), Some(2));
        assert_eq!(report["stored"], json!({}));
        assert_eq!(applied["summary"]["faces"], 16);
        let summary = ok(bridge.step_summary(sunk).unwrap_or_else(|e| panic!("{e}")));
        assert_eq!(
            summary["summary"]["diff"]["added"].as_array().map(Vec::len),
            Some(8)
        );
        assert!(
            summary["summary"]["layers"]
                .as_u64()
                .is_some_and(|l| l >= 4)
        );
        // Pictured as its preview was: pushed in at the tip, seen a mountain.
        let action = ok(bridge.step_action(sunk).unwrap_or_else(|e| panic!("{e}")));
        assert_eq!(action["action"]["direction"], "mountain", "{}", base.name);
        assert!(action["action"]["push"].is_object(), "{}", base.name);
        let preview = ok(bridge
            .action(start, &op(base.sink("open-sink", f)), &Choices::default())
            .unwrap_or_else(|e| panic!("{e}")));
        assert_eq!(action["action"]["push"], preview["action"]["push"]);

        let (back, applied) = landed(&mut bridge, sunk, &base.unsink(f), json!({}));
        assert_eq!(applied["compound"]["step"], "unsink");
        let pulled = ok(bridge.step_action(back).unwrap_or_else(|e| panic!("{e}")));
        assert_eq!(pulled["action"]["direction"], "valley");
        assert_eq!(pulled["action"].get("push"), None);
        assert_eq!(
            applied["compound"]["unfolded"].as_array().map(Vec::len),
            Some(8)
        );
        let unsunk = state(&bridge, back);
        assert_eq!(unsunk.faces().len(), 16);
        // The base's creases, each spoke now in two halves, and the ring's
        // eight flat beside its two precreases'.
        let base_state = state(&bridge, start);
        let count = |s: &State, folded: bool| {
            s.creases()
                .iter()
                .filter(|c| c.kind.is_folded() == folded && c.kind.letter().is_some())
                .count()
        };
        assert_eq!(
            count(unsunk, true),
            count(base_state, true) * 2,
            "{}",
            base.name
        );
        assert_eq!(
            count(unsunk, false),
            count(base_state, false) * 2 + 8,
            "{}",
            base.name
        );
    }
}

/// A closed sink with no pocket stored asks for one; the analysis lists the
/// two, each with what a step stores; stored, each lands and replays to the
/// same state; a stored pocket naming no face is broken.
#[test]
fn a_closed_sink_asks_for_its_pocket_and_replays_it() {
    let (mut bridge, start) = sample(PRELIMINARY.name);
    let step = PRELIMINARY.sink("closed-sink", 0.3);
    let missing = refused(&mut bridge, start, &step, json!({}));
    assert_eq!(
        missing["refusal"],
        json!({ "code": "choice_needed", "choice": "pocket" })
    );
    let analysis = ok(
        sink_analysis(&bridge, start, &op(step.clone()), &Choices::default())
            .unwrap_or_else(|e| panic!("{e}")),
    );
    let pockets = analysis["analysis"]["pockets"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(pockets.len(), 2);
    assert_eq!(analysis["analysis"]["exterior"], "mountain");
    assert_eq!(analysis["open"], Value::Null);
    let mut keys = Vec::new();
    for pocket in &pockets {
        let stored = &pocket["stored"];
        let chosen = json!({ "pocket": [stored["above"], stored["below"]] });
        let (first, applied) = landed(&mut bridge, start, &step, chosen.clone());
        assert_eq!(applied["compound"]["step"], "closed");
        assert_eq!(applied["compound"]["stored"]["pocket"], *stored);
        let (again, _) = landed(&mut bridge, start, &step, chosen);
        let first_keys = canonical_keys(state(&bridge, first));
        assert_eq!(first_keys, canonical_keys(state(&bridge, again)));
        keys.push(first_keys);
    }
    assert_ne!(keys[0], keys[1], "two pockets, two states");
    let broken = refused(
        &mut bridge,
        start,
        &step,
        json!({ "pocket": [[2.0, 2.0], [0.1, 0.1]] }),
    );
    assert_eq!(broken["refusal"]["code"], "choice_broken");
    // The engine's cause, flattened beside the code (`crate::compound`).
    assert_eq!(broken["refusal"]["broken"], "witness");
}

/// A tilted model line: the open sink is refused, offering the square line
/// (sent back as a model line, it lands) and the closed sink. The analysis
/// says the same.
#[test]
fn a_tilted_line_is_refused_with_the_square_line_and_the_closed_sink() {
    let (mut bridge, start) = sample(PRELIMINARY.name);
    let s = state(&bridge, start);
    let image = |p: Point| s.resolve_point(p).unwrap_or_else(|| panic!("{p:?}"));
    let [a, b] = PRELIMINARY.ring(0.3).map(image);
    let tip = image(PRELIMINARY.tip(0.3));
    // ℓ turned 5° about its point on the axis.
    let (d, t) = ([b[0] - a[0], b[1] - a[1]], 5f64.to_radians());
    let dir = [
        d[0] * t.cos() - d[1] * t.sin(),
        d[0] * t.sin() + d[1] * t.cos(),
    ];
    let n = [-dir[1], dir[0]];
    let line = json!({ "n": n, "d": n[0] * a[0] + n[1] * a[1] });
    let side = if n[0] * tip[0] + n[1] * tip[1] > n[0] * a[0] + n[1] * a[1] {
        "positive"
    } else {
        "negative"
    };
    let step = json!({
        "kind": "open-sink",
        "line": { "via": "model", "line": line },
        "side": side,
        "seed": { "scope": "all" },
    });
    let refusal = refused(&mut bridge, start, &step, json!({}));
    assert_eq!(refusal["refusal"]["code"], "sink_line_tilted");
    let fixes = refusal["fixes"].as_array().cloned().unwrap_or_default();
    assert_eq!(fixes.len(), 2, "{fixes:?}");
    assert_eq!(fixes[0]["fix"], "use_line");
    assert_eq!(fixes[1], json!({ "fix": "other_sink", "kind": "closed" }));
    assert!(!refusal["faces"].as_array().is_some_and(Vec::is_empty));
    let square = json!({
        "kind": "open-sink",
        "line": { "via": "model", "line": fixes[0]["line"] },
        "side": fixes[0]["side"],
        "seed": { "scope": "all" },
    });
    landed(&mut bridge, start, &square, json!({}));
    let analysis = ok(
        sink_analysis(&bridge, start, &op(step), &Choices::default())
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert_eq!(analysis["open"]["refusal"]["code"], "sink_line_tilted");
    assert_eq!(analysis["analysis"]["square"], fixes[0]["line"]);
}

/// The choices a sink takes: a closed sink's pocket, any sink's completion
/// (the engine's witness-keyed pairs, replayed); not a pocket for an open
/// sink, nor a root off an axis. A decided sink has one order and nothing
/// to pick.
#[test]
fn a_sink_takes_its_own_choices() {
    let (mut bridge, start) = sample(PRELIMINARY.name);
    let step = PRELIMINARY.sink("open-sink", 0.3);
    let (sunk, _) = landed(&mut bridge, start, &step, json!({}));
    let order = WitnessOrder::of_state(state(&bridge, sunk)).unwrap_or_else(|| unreachable!());
    let (again, applied) = landed(
        &mut bridge,
        start,
        &step,
        json!({ "completion": json_of(&order) }),
    );
    assert_eq!(
        canonical_keys(state(&bridge, sunk)),
        canonical_keys(state(&bridge, again))
    );
    assert_eq!(applied["compound"]["stored"]["order"], json_of(&order));
    for (chosen, choice) in [
        (json!({ "pocket": [[0.1, 0.1], [0.2, 0.2]] }), "pocket"),
        (json!({ "root": { "n": [1.0, 0.0], "d": 0.5 } }), "root"),
        (json!({ "opening": [{ "upper": [[0.1, 0.1]] }] }), "opening"),
    ] {
        let refusal = refused(&mut bridge, start, &step, chosen);
        assert_eq!(
            refusal["refusal"],
            json!({ "code": "unexpected_choice", "choice": choice })
        );
    }
    let orders = ok(
        sink_orders(&bridge, start, &op(step.clone()), &Choices::default())
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert_eq!(
        orders,
        json!({ "count": { "orders": 1, "exact": true }, "components": [] })
    );
    let picked = ok(
        sink_pick(&bridge, start, &op(step), &Choices::default(), &[])
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert_eq!(picked, json!({ "completion": null }));
}

/// A sink folds along one line, so a tool previews it with the plain fold's
/// queries: what moves (the moving side's flaps, the point's picked, its
/// faces moving), its picture (the push onto the tip) and the depth picker's
/// stacks. An unsink's analysis is its sunk tip, which the sunk points name
/// when the folder has named none.
#[test]
fn a_sink_answers_the_plain_fold_queries() {
    let (mut bridge, start) = sample(PRELIMINARY.name);
    let f = 0.3;
    for kind in ["open-sink", "closed-sink"] {
        let sink = op(json!({
            "kind": kind,
            "line": { "via": "free", "through": PRELIMINARY.ring(f) },
            "seed": { "scope": "all" },
            "moving": PRELIMINARY.tip(f),
        }));
        let analysed = ok(bridge
            .analyse(start, &sink, &Choices::default())
            .unwrap_or_else(|e| panic!("{kind}: {e}")));
        let analysis = &analysed["analysis"];
        assert_eq!(
            analysis["flaps"].as_array().map(Vec::len),
            Some(1),
            "{kind}"
        );
        assert_eq!(analysis["picked"], json!([0]), "{kind}");
        assert_eq!(analysis["moving"], analysis["flaps"][0]["faces"], "{kind}");
        let acted = ok(bridge
            .action(start, &sink, &Choices::default())
            .unwrap_or_else(|e| panic!("{kind}: {e}")));
        assert_eq!(acted["action"]["direction"], "mountain", "{kind}");
        assert!(acted["action"]["line"].is_array(), "{kind}");
        assert!(acted["action"]["push"].is_object(), "{kind}");
        let depths = ok(bridge
            .depth_choices(start, &sink, &Choices::default(), PRELIMINARY.tip(f))
            .unwrap_or_else(|e| panic!("{kind}: {e}")));
        assert!(
            depths["choices"].as_array().is_some_and(|c| !c.is_empty()),
            "{kind}"
        );
    }

    let (sunk, _) = landed(
        &mut bridge,
        start,
        &PRELIMINARY.sink("open-sink", f),
        json!({}),
    );
    let [a, b] = PRELIMINARY.ring(f);
    let unnamed = op(json!({
        "kind": "unsink",
        "line": { "via": "crease", "at": at(a, b, 0.5) },
        "seed": { "scope": "all" },
        "moving": PRELIMINARY.tip(f),
    }));
    let found =
        ok(sunk_points(&bridge, sunk, &unnamed, &Choices::default())
            .unwrap_or_else(|e| panic!("{e}")));
    let points = found["points"].as_array().cloned().unwrap_or_default();
    assert_eq!(points.len(), 1, "{points:?}");
    let named = op(named_json(&points[0]["witness"], a, b));
    let analysed = ok(bridge
        .analyse(sunk, &named, &Choices::default())
        .unwrap_or_else(|e| panic!("{e}")));
    assert_eq!(analysed["analysis"]["moving"], points[0]["faces"]);
    let picked = analysed["analysis"]["picked"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(picked.len(), 1, "{analysed}");
    let pulled = ok(bridge
        .action(sunk, &named, &Choices::default())
        .unwrap_or_else(|e| panic!("{e}")));
    assert_eq!(pulled["action"]["direction"], "valley");
    assert_eq!(pulled["action"].get("push"), None);
    landed(
        &mut bridge,
        sunk,
        &named_json(&points[0]["witness"], a, b),
        json!({}),
    );
    // Every layer on the side is all the paper, the sunk tip and the paper
    // round it: nothing would stay.
    let whole = ok_refused(bridge.analyse(sunk, &unnamed, &Choices::default()));
    assert_eq!(whole["refusal"]["code"], "nothing_stays");
    // On the base, no sunk point; and the sunk points are an unsink's.
    let base_unsink = op(json!({
        "kind": "unsink",
        "line": { "via": "free", "through": PRELIMINARY.ring(f) },
        "seed": { "scope": "all" },
        "moving": PRELIMINARY.tip(f),
    }));
    let none = ok(
        sunk_points(&bridge, start, &base_unsink, &Choices::default())
            .unwrap_or_else(|e| panic!("{e}")),
    );
    assert_eq!(none["points"], json!([]));
    assert!(matches!(
        sunk_points(
            &bridge,
            start,
            &op(PRELIMINARY.sink("open-sink", f)),
            &Choices::default()
        ),
        Err(BridgeError::InvalidInput(_))
    ));
}

/// The unsink along the ring crease between the base's two spokes, naming
/// the sunk tip by `witness`.
fn named_json(witness: &Value, a: Point, b: Point) -> Value {
    json!({
        "kind": "unsink",
        "line": { "via": "crease", "at": at(a, b, 0.5) },
        "seed": { "scope": "flaps", "at": [witness] },
    })
}

/// The sink queries are a sink op's: a plain op's, or an unsink's analysis,
/// is the caller's mistake.
#[test]
fn the_sink_queries_take_sink_ops() {
    let (mut bridge, start) = sample(PRELIMINARY.name);
    let (sunk, _) = landed(
        &mut bridge,
        start,
        &PRELIMINARY.sink("open-sink", 0.3),
        json!({}),
    );
    let plain = op(json!({
        "kind": "valley",
        "line": { "via": "free", "through": PRELIMINARY.ring(0.3) },
        "seed": { "scope": "flaps", "at": [PRELIMINARY.tip(0.3)] },
    }));
    assert!(matches!(
        sink_analysis(&bridge, start, &plain, &Choices::default()),
        Err(BridgeError::InvalidInput(_))
    ));
    let unsink = op(PRELIMINARY.unsink(0.3));
    assert!(matches!(
        sink_analysis(&bridge, sunk, &unsink, &Choices::default()),
        Err(BridgeError::InvalidInput(_))
    ));
    // On the base no crease is there to unsink along.
    let missing = ok_refused(sink_orders(&bridge, start, &unsink, &Choices::default()));
    assert_eq!(missing["refusal"]["code"], "crease_not_found");
}
