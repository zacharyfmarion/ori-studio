//! Tutorial regressions through the same public operations and saved choices
//! used by Fold. The controls were independently checked CP collapses.
#![cfg(not(target_arch = "wasm32"))]

use oristudio_fold::State;
use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::wire::{Choices, Op, Outcome, Paper};
use serde_json::{Value, json};

fn apply(bridge: &mut Bridge, state: u32, op: &Value, choices: &Value) -> u32 {
    let op: Op = serde_json::from_value(op.clone()).unwrap();
    let choices: Choices = serde_json::from_value(choices.clone()).unwrap();
    match bridge.apply(state, &op, &choices).unwrap() {
        Outcome::Ok(applied) => applied.state,
        Outcome::Refused(r) => panic!("{}", serde_json::to_string(&r).unwrap()),
    }
}

fn prefix(bridge: &mut Bridge, fixture: &Value) -> u32 {
    let paper: Paper = serde_json::from_value(fixture["paper"].clone()).unwrap();
    let mut state = match bridge.sheet(&paper) {
        Outcome::Ok(sheet) => sheet.state,
        Outcome::Refused(r) => panic!("{r:?}"),
    };
    for step in fixture["steps"].as_array().unwrap() {
        state = apply(
            bridge,
            state,
            &step["op"],
            step.get("choices").unwrap_or(&json!({})),
        );
    }
    state
}

fn close(a: [f64; 2], b: [f64; 2]) {
    assert!((a[0] - b[0]).hypot(a[1] - b[1]) < 1e-7, "{a:?} != {b:?}");
}

/// Compare material, paper side and whole stacks despite different flat
/// subdivisions. Both sets of cells contribute witnesses.
fn same_material_and_order(actual: &State, control: &State) {
    for (a, b) in [(actual, control), (control, actual)] {
        for face in a.faces() {
            let center = a.face_witness(face.id).unwrap();
            let (p, other) = std::iter::once(center)
                .chain(face.ring.iter().map(|v| {
                    let p = a.vertices()[v.0 as usize];
                    [center[0] * 0.9 + p[0] * 0.1, center[1] * 0.9 + p[1] * 0.1]
                }))
                .find_map(|p| b.face_at(p).map(|f| (p, f)))
                .unwrap();
            close(a.image_of(p).unwrap(), b.image_of(p).unwrap());
            for (x, y) in a
                .isometry(face.id)
                .unwrap()
                .0
                .into_iter()
                .zip(b.isometry(other).unwrap().0)
            {
                assert!((x - y).abs() < 1e-7, "material transform differs");
            }
            assert_eq!(a.front_up(face.id), b.front_up(other));
        }
        let scene = a.scene();
        let mut checked = 0;
        for cell in &scene.subfaces {
            let n = cell.polygon.len() as f64;
            let p = cell
                .polygon
                .iter()
                .fold([0.0, 0.0], |s, p| [s[0] + p.x / n, s[1] + p.y / n]);
            let p = scene.view_transform.inverse().apply(p);
            let stack = |s: &State| {
                s.stack_at(p)
                    .unwrap()
                    .into_iter()
                    .map(|f| s.isometry(f).unwrap().inverse().apply(p))
                    .collect::<Vec<_>>()
            };
            let (left, right) = (stack(a), stack(b));
            // A cell center can lie on an F subdivision in the other state.
            // A neighbor's interior checks that stack instead.
            if left.len() != right.len() {
                let (longer, shorter) = if left.len() > right.len() {
                    (&left, b)
                } else {
                    (&right, a)
                };
                assert!(
                    longer.iter().any(|p| shorter.face_at(*p).is_none()),
                    "missing material away from a subdivision"
                );
                continue;
            }
            for (x, y) in left.into_iter().zip(right) {
                close(x, y);
            }
            checked += 1;
        }
        assert!(checked >= 5, "nonvacuous stack comparison");
    }
}

fn verify(fixture: &str) {
    let fixture: Value = serde_json::from_str(fixture).unwrap();
    let mut bridge = Bridge::new();
    let before = prefix(&mut bridge, &fixture);
    let direct = apply(&mut bridge, before, &fixture["op"], &fixture["choices"]);
    let control = apply(&mut bridge, before, &fixture["control"], &json!({}));
    same_material_and_order(
        bridge.state(direct).unwrap(),
        bridge.state(control).unwrap(),
    );
    let mut reopened = Bridge::new();
    let parent = prefix(&mut reopened, &fixture);
    let replay = apply(&mut reopened, parent, &fixture["op"], &fixture["choices"]);
    assert_eq!(
        bridge.canonical_keys(direct).unwrap(),
        reopened.canonical_keys(replay).unwrap()
    );
}

#[test]
fn dove_reverses_both_nested_pairs_with_their_own_pocket_walls() {
    let source = include_str!("../../../tests/fixtures/fold-examples/reverse-nested-dove.json");
    verify(source);
    let mut fixture: Value = serde_json::from_str(source).unwrap();
    let mut bridge = Bridge::new();
    let before = prefix(&mut bridge, &fixture);
    let op: Op = serde_json::from_value(fixture["op"].clone()).unwrap();
    let choices: Choices = serde_json::from_value(fixture["choices"].clone()).unwrap();
    let analysis =
        serde_json::to_value(bridge.compound_analysis(before, &op, &choices).unwrap()).unwrap();
    assert!(
        analysis["kinds"]
            .as_array()
            .unwrap()
            .contains(&json!("inside"))
    );
    // The new coupling does not grant the outer pair permission to pass
    // through an unselected inner pair.
    fixture["op"]["seed"]["layers"] = json!(1);
    let partial: Op = serde_json::from_value(fixture["op"].clone()).unwrap();
    let Outcome::Refused(refusal) = bridge.apply(before, &partial, &Choices::default()).unwrap()
    else {
        panic!("the outer pair must not move through the inner pair");
    };
    let refusal = serde_json::to_value(refusal).unwrap();
    assert_eq!(refusal["refusal"]["code"], "reverse_tip_not_free");
}

#[test]
fn squirrel_crimps_at_the_shared_boundary_endpoint() {
    verify(include_str!(
        "../../../tests/fixtures/fold-examples/crimp-boundary-squirrel.json"
    ));
}
