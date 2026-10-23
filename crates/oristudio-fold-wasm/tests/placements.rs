#![cfg(not(target_arch = "wasm32"))]
use oristudio_fold_wasm::{
    bridge::Bridge,
    order_selection::OrderQuery,
    wire::{Choices, Op, Outcome},
};
use serde_json::{Value, json};
fn op(v: Value) -> Op {
    serde_json::from_value(v).unwrap()
}
fn ok<T>(v: Outcome<T>) -> T {
    match v {
        Outcome::Ok(v) => v,
        Outcome::Refused(r) => panic!("{r:?}"),
    }
}
fn keys(bridge: &Bridge, state: u32) -> Vec<String> {
    let mut keys = bridge.canonical_keys(state).unwrap();
    keys.sort();
    keys
}

#[test]
fn an_explicit_single_flap_selection_cannot_offer_an_expanded_outer_fold() {
    let mut bridge = Bridge::new();
    let sheet = ok(bridge.sheet(
        &serde_json::from_value(json!({"shape":{"kind":"square"},"startSide":"front"})).unwrap(),
    ))
    .state;
    let book = op(
        json!({"kind":"valley", "line":{"via":"free","through":[[0.5,0.],[0.5,1.]]}, "moving":[0.75,0.5], "seed":{"scope":"all"}}),
    );
    let parent = ok(bridge.apply(sheet, &book, &Choices::default()).unwrap()).state;
    let mut raw = json!({"kind":"valley", "line":{"via":"free","through":[[0.,0.3],[0.3,0.]]}, "moving":[0.02,0.02], "seed":{"scope":"flaps","at":[[0.05,0.05]]}});
    let answer = ok(bridge
        .order_selection(
            parent,
            &op(raw.clone()),
            &Choices::default(),
            &OrderQuery::default(),
        )
        .unwrap());
    assert!(answer.count.exact);
    assert_eq!(answer.count.orders, 1);
    assert!(!answer.moving_varies);
    assert!(matches!(
        answer.landing,
        Some(oristudio_fold::FoldLanding::Against { .. })
    ));
    raw["landing"] = serde_json::to_value(answer.landing).unwrap();
    let choices = Choices {
        completion: answer.completion,
        ..Default::default()
    };
    let landed = ok(bridge.apply(parent, &op(raw.clone()), &choices).unwrap()).state;
    let before = bridge.state(parent).unwrap();
    let selected = before.face_at([0.05, 0.05]).unwrap();
    for face in before.faces().iter().filter(|f| f.id != selected) {
        assert_eq!(
            before.face(face.id),
            bridge.state(landed).unwrap().face(face.id)
        );
        assert_eq!(
            before.isometry(face.id),
            bridge.state(landed).unwrap().isometry(face.id)
        );
    }
    let replayed = ok(bridge.apply(parent, &op(raw), &choices).unwrap()).state;
    assert_eq!(keys(&bridge, landed), keys(&bridge, replayed));
}

#[test]
fn both_moving_directions_select_save_and_replay_insertions() {
    for direction in ["valley", "mountain"] {
        let mut bridge = Bridge::new();
        let sheet = ok(bridge.sheet(
            &serde_json::from_value(json!({"shape":{"kind":"square"},"startSide":"front"}))
                .unwrap(),
        ))
        .state;
        let first = op(
            json!({"kind":direction,"line":{"via":"free","through":[[0.,0.35],[1.,0.35]]},"moving":[0.5,0.1],"seed":{"scope":"all"}}),
        );
        let parent = ok(bridge.apply(sheet, &first, &Choices::default()).unwrap()).state;
        let raw = json!({"kind":direction,"line":{"via":"free","through":[[0.,0.8],[1.,0.8]]},"moving":[0.5,0.9],"seed":{"scope":"all"},"landing":{"kind":"outer"}});
        let input = op(raw.clone());
        let first = ok(bridge
            .order_selection(parent, &input, &Choices::default(), &OrderQuery::default())
            .unwrap());
        assert_eq!(first.count.orders, 2);
        assert!(first.count.exact);
        let mut fingerprints = Vec::new();
        for index in 0..2 {
            let chosen = ok(bridge
                .order_selection(
                    parent,
                    &input,
                    &Choices::default(),
                    &OrderQuery {
                        index,
                        ..Default::default()
                    },
                )
                .unwrap());
            let mut stored = raw.clone();
            stored["landing"] = serde_json::to_value(chosen.landing).unwrap();
            let choices = Choices {
                completion: chosen.completion,
                ..Default::default()
            };
            let saved = op(stored.clone());
            let result = ok(bridge.apply(parent, &saved, &choices).unwrap());
            let replay = ok(bridge
                .apply(
                    parent,
                    &op(serde_json::from_str(&stored.to_string()).unwrap()),
                    &choices,
                )
                .unwrap());
            assert_eq!(keys(&bridge, result.state), keys(&bridge, replay.state));
            assert!(matches!(
                bridge.analyse(parent, &saved, &choices).unwrap(),
                Outcome::Ok(_)
            ));
            assert!(matches!(
                bridge.action(parent, &saved, &choices).unwrap(),
                Outcome::Ok(_)
            ));
            fingerprints.push(keys(&bridge, result.state));
        }
        assert_ne!(fingerprints[0], fingerprints[1]);
        // A different line must create a fresh search, not reuse these two orders.
        let other = op(
            json!({"kind":direction,"line":{"via":"free","through":[[0.,0.9],[1.,0.9]]},"moving":[0.5,0.95],"seed":{"scope":"all"}}),
        );
        let changed = ok(bridge
            .order_selection(parent, &other, &Choices::default(), &OrderQuery::default())
            .unwrap());
        assert_eq!(changed.index, 0);
        assert!(changed.count.exact);
    }
}

#[test]
fn a_precreased_flat_sheet_folded_in_half_lands_without_a_chooser() {
    // A grid and both diagonals, as a precreased base is creased: the half
    // lands on dozens of faces, one order exists, and the first answer says
    // so — the tool then commits without asking.
    let mut bridge = Bridge::new();
    let mut state = ok(bridge.sheet(
        &serde_json::from_value(json!({"shape":{"kind":"square"},"startSide":"front"})).unwrap(),
    ))
    .state;
    let lines = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]
        .iter()
        .flat_map(|&c| {
            [
                ([[c, 0.], [c, 1.]], [0.99, 0.5]),
                ([[0., c], [1., c]], [0.5, 0.99]),
            ]
        })
        .chain([
            ([[0., 0.], [1., 1.]], [0.9, 0.1]),
            ([[1., 0.], [0., 1.]], [0.1, 0.1]),
        ]);
    for (through, moving) in lines {
        let precrease = op(
            json!({"kind":"precrease","line":{"via":"free","through":through},
            "moving":moving,"direction":"valley","seed":{"scope":"all"}}),
        );
        state = ok(bridge
            .apply(state, &precrease, &Choices::default())
            .unwrap())
        .state;
    }
    assert_eq!(bridge.state(state).unwrap().faces().len(), 80);
    for (direction, moving) in [("mountain", [0.9, 0.1]), ("valley", [0.1, 0.9])] {
        let half = op(
            json!({"kind":direction,"line":{"via":"free","through":[[0.,0.],[1.,1.]]},
            "moving":moving,"seed":{"scope":"all"},"landing":{"kind":"outer"}}),
        );
        let answer = ok(bridge
            .order_selection(state, &half, &Choices::default(), &OrderQuery::default())
            .unwrap());
        assert_eq!((answer.count.orders, answer.count.exact), (1, true));
        assert_eq!(answer.landing, Some(oristudio_fold::FoldLanding::Outer));
        assert!(answer.completion.is_none());
        assert!(!answer.moving_varies);
    }
}

#[test]
fn a_longer_press_searches_on_and_finds_what_a_shorter_one_could_not() {
    // Two separate flaps on paper precreased into many columns: outer, or
    // between the base and the first flap. The inserted landing is many
    // sets of targets into the search.
    let mut bridge = Bridge::new();
    let mut state = ok(bridge.sheet(
        &serde_json::from_value(json!({"shape":{"kind":"square"},"startSide":"front"})).unwrap(),
    ))
    .state;
    let columns = (1..16).map(|k| ([[k as f64 / 16., 0.], [k as f64 / 16., 1.]], [0.99, 0.5]));
    let rows = [0.62, 0.66, 0.7, 0.74].map(|c| ([[0., c], [1., c]], [0.5, 0.99]));
    for (through, moving) in columns.chain(rows) {
        let precrease = op(
            json!({"kind":"precrease","line":{"via":"free","through":through},
            "moving":moving,"direction":"valley","seed":{"scope":"all"}}),
        );
        state = ok(bridge
            .apply(state, &precrease, &Choices::default())
            .unwrap())
        .state;
    }
    let first = op(
        json!({"kind":"valley","line":{"via":"free","through":[[0.,0.35],[1.,0.35]]},"moving":[0.5,0.1],"seed":{"scope":"all"}}),
    );
    let parent = ok(bridge.apply(state, &first, &Choices::default()).unwrap()).state;
    let fold = op(
        json!({"kind":"valley","line":{"via":"free","through":[[0.,0.8],[1.,0.8]]},"moving":[0.5,0.9],"seed":{"scope":"all"},"landing":{"kind":"outer"}}),
    );
    let mut ask = |batch: u64, search_ms: f64| {
        ok(bridge
            .order_selection(
                parent,
                &fold,
                &Choices::default(),
                &OrderQuery {
                    batch,
                    search_ms: Some(search_ms),
                    ..Default::default()
                },
            )
            .unwrap())
    };
    // A millisecond's press tries a set or two: only the outer landing, and
    // asking again within the same press searches no further.
    let short = ask(0, 1.0);
    assert_eq!((short.count.orders, short.count.exact), (1, false));
    assert!(!short.searching);
    let again = ask(0, 1.0);
    assert_eq!((again.count.orders, again.searching), (1, false));
    // Nothing at all for a press with no time.
    assert_eq!(ask(1, 0.0).count.orders, 1);
    // A longer press, asked again while it says it is searching, as the
    // worker asks between slices: it finds the inserted landing, and then
    // says there is nothing more.
    let mut long = ask(2, 30_000.0);
    let mut calls = 1;
    while long.searching {
        assert!(!long.count.exact);
        long = ask(2, 30_000.0);
        calls += 1;
        assert!(calls < 1000, "the press never ended");
    }
    assert_eq!((long.count.orders, long.count.exact), (2, true));
}
