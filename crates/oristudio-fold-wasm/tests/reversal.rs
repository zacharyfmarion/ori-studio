//! Recorded material restoration through the public bridge, across real compound sequences.
#![cfg(not(target_arch = "wasm32"))]
use oristudio_fold::{CreaseKind, State};
use oristudio_fold_wasm::{
    bridge::Bridge,
    wire::{Choices, Op, Outcome, Paper},
};
use oristudio_geometry::convex;
use serde_json::{Value, json};

fn pose(actual: &State, target: &State) {
    assert_eq!(actual.view(), target.view());
    let owner = |f| {
        let polygon: Vec<_> = actual
            .face(f)
            .unwrap()
            .ring
            .iter()
            .map(|v| actual.vertices()[v.0 as usize])
            .collect();
        let old = target.face_at(convex::centroid(&polygon).unwrap()).unwrap();
        assert!(
            actual
                .isometry(f)
                .unwrap()
                .distance_on(&target.isometry(old).unwrap(), polygon)
                < 1e-6
        );
        assert_eq!(actual.front_up(f), target.front_up(old));
        old
    };
    for f in actual.faces() {
        owner(f.id);
    }
    for (p, above) in actual.order().pairs() {
        assert_eq!(above, target.order().above(owner(p.lo()), owner(p.hi())));
    }
}
fn returned(bridge: &mut Bridge, current: u32, target: u32, history: &[u32]) -> u32 {
    match bridge.return_to(current, target, history).unwrap() {
        Outcome::Ok(a) => a.state,
        Outcome::Refused(r) => panic!("restore {current} to {target}: {r:?}"),
    }
}
#[test]
fn every_compound_fixture_can_return_each_step_and_the_whole_range() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures");
    let mut kinds = std::collections::BTreeSet::new();
    for name in [
        "fold-design-completion/cicada",
        "fold-design-completion/heart",
        "fold-design-completion/swan",
        "fold-design-completion/crane",
        "fold-examples/petal-fold",
        "fold-examples/swivel-fold",
        "fold-examples/swivel-inside",
        "fold-examples/swivel-on-edge",
        "fold-examples/rabbit-ear-precreased-whale.json",
    ] {
        let file: Value = serde_json::from_str(
            &std::fs::read_to_string(root.join(if name.ends_with(".json") {
                name.to_string()
            } else {
                format!("{name}.osf")
            }))
            .unwrap(),
        )
        .unwrap();
        let docs = if name.ends_with(".json") {
            vec![file.clone()]
        } else {
            file["workspace"]["foldSequences"]
                .as_array()
                .unwrap()
                .clone()
        };
        for mut doc in docs {
            if name.ends_with(".json") {
                for key in ["op", "second"] {
                    let parent = doc["steps"].as_array().unwrap().last().unwrap()["id"].clone();
                    let operation = doc[key].clone();
                    doc["steps"]
                        .as_array_mut()
                        .unwrap()
                        .push(json!({"id":key,"parent":parent,"op":operation}));
                }
            }
            let mut b = Bridge::new();
            let paper: Paper = serde_json::from_value(doc["paper"].clone()).unwrap();
            let Outcome::Ok(s) = b.sheet(&paper) else {
                panic!("sheet")
            };
            let mut paths = std::collections::BTreeMap::<String, Vec<u32>>::new();
            for step in doc["steps"].as_array().unwrap() {
                let op: Op = serde_json::from_value(step["op"].clone()).unwrap();
                let choices: Choices =
                    serde_json::from_value(step.get("choices").cloned().unwrap_or(json!({})))
                        .unwrap();
                let mut states = step["parent"]
                    .as_str()
                    .and_then(|id| paths.get(id))
                    .cloned()
                    .unwrap_or(vec![s.state]);
                let parent = *states.last().unwrap();
                let Outcome::Ok(a) = b.apply(parent, &op, &choices).unwrap() else {
                    panic!("{name}: {step}")
                };
                states.push(a.state);
                paths.insert(step["id"].as_str().unwrap().to_string(), states.clone());
                kinds.insert(step["op"]["kind"].as_str().unwrap().to_string());
                let r = returned(&mut b, a.state, parent, &states);
                pose(b.state(r).unwrap(), b.state(parent).unwrap());
                // Every current crease remains physically represented, including its interior.
                let actual = b.state(r).unwrap();
                let before = b.state(a.state).unwrap();
                for c in before
                    .creases()
                    .iter()
                    .filter(|c| c.kind != CreaseKind::Border)
                {
                    let [x, y] = c.vertices.map(|v| before.vertices()[v.0 as usize]);
                    for f in [0.1, 0.37, 0.7, 0.9] {
                        assert!(
                            actual
                                .crease_at([x[0] + f * (y[0] - x[0]), x[1] + f * (y[1] - x[1])])
                                .is_some(),
                            "{name}: lost crease"
                        );
                    }
                }
                let flat = returned(&mut b, a.state, s.state, &states);
                pose(b.state(flat).unwrap(), b.state(s.state).unwrap());
                assert!(
                    b.state(flat)
                        .unwrap()
                        .creases()
                        .iter()
                        .all(|c| !c.kind.is_folded())
                );
                // Repeating restoration must not introduce a new material graph.
                let twice = returned(
                    &mut b,
                    flat,
                    s.state,
                    &[states.clone(), vec![flat]].concat(),
                );
                assert_eq!(
                    b.canonical_keys(flat).unwrap(),
                    b.canonical_keys(twice).unwrap()
                );
            }
        }
    }
    for kind in [
        "tuck",
        "outside-reverse",
        "inside-reverse",
        "petal",
        "squash",
        "swivel",
        "rabbit-ear",
    ] {
        assert!(kinds.contains(kind), "missing {kind}: {kinds:?}");
    }
}
