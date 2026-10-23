//! Independent square-sheet cases for line guards after layer selection.
mod support;

use oristudio_fold::{
    ActionKind, Direction, Extent, FoldRefusal, PlainFold, Seed, Sheet, StartSide, State,
};
use support::*;

fn book() -> State {
    let square = State::flat(Sheet::square(), StartSide::Front).unwrap();
    // Only the bottom layer has a subdivision near the later corner fold.
    let marked = precrease(&square, &all(x_eq(0.3005), [0.1, 0.4], Direction::Valley)).state;
    fold(&marked, &all(x_eq(0.5), [0.8, 0.4], Direction::Valley)).state
}

fn corner() -> PlainFold {
    depth(
        through([0.0, 0.3], [0.3, 0.0]),
        [0.1, 0.1],
        Direction::Valley,
        [0.9, 0.1],
        1,
    )
}

#[test]
fn untouched_bottom_vertex_does_not_block_front_precrease() {
    let state = book();
    let result = precrease(&state, &corner());
    assert_valid(&result.state);
    assert_eq!(result.report.analysis.moving.len(), 1);
}

#[test]
fn untouched_bottom_vertex_does_not_block_front_fold() {
    let state = book();
    let result = fold(&state, &corner());
    assert_valid(&result.state);
    assert_eq!(result.report.analysis.moving.len(), 1);
}

fn assert_material(before: &State, after: &State, folded: bool) {
    for i in 0..19 {
        for j in 0..19 {
            let p = [(i as f64 + 0.37) / 19.0, (j as f64 + 0.43) / 19.0];
            let old = before.isometry(face(before, p)).unwrap();
            let new = after.isometry(face(after, p)).unwrap();
            let image = old.apply(p);
            let moves = folded && p[0] > 0.5 && image[0] + image[1] < 0.3;
            let expected = if moves {
                [0.3 - image[1], 0.3 - image[0]]
            } else {
                image
            };
            assert!(close(new.apply(p), expected), "material {p:?}");
            assert_eq!(new.front_up(), old.front_up() != moves);
        }
    }
    // The two lower subdivisions retain their identity and position.
    for f in before.faces().iter().filter(|f| {
        f.ring
            .iter()
            .all(|v| before.vertices()[v.0 as usize][0] <= 0.5)
    }) {
        assert_eq!(before.face(f.id), after.face(f.id));
        assert_eq!(before.isometry(f.id), after.isometry(f.id));
    }
}

#[test]
fn direction_turnover_extent_queries_and_replay_agree() {
    for turned in [false, true] {
        let state = if turned { book().turn_over() } else { book() };
        let mut op = corner();
        if turned {
            op.direction = Direction::Mountain;
        }
        let analysis = state.analyse_fold(&op).unwrap();
        let section = state.cross_section(&op.line, op.side).unwrap();
        assert_eq!(section.layers, 2);
        let choices = state.depth_choices(&op, [0.9, 0.1]).unwrap();
        assert_eq!(choices.len(), 1, "unsafe lower depth must not be offered");
        assert_eq!((choices[0].layers, choices[0].through), (1, 1));
        assert_eq!(choices[0].moving, analysis.moving);
        for pre in [false, true] {
            let result = if pre {
                precrease(&state, &op)
            } else {
                fold(&state, &op)
            };
            assert_material(&state, &result.state, !pre);
            let replay = if pre {
                precrease(&state, &op)
            } else {
                fold(&state, &op)
            };
            assert_eq!(result.state.parts(), replay.state.parts());
            assert!(result.summary(&state).is_ok());
            assert!(
                result
                    .action(
                        &state,
                        if pre {
                            ActionKind::Precrease
                        } else {
                            ActionKind::Fold
                        }
                    )
                    .is_ok()
            );
        }
        let extent = Extent::Segment {
            from: [0.95, 0.25],
            to: [0.75, 0.05],
        };
        let mark = state.precrease_extent(&op, &extent).unwrap();
        assert_valid(&mark.state);
        assert_material(&state, &mark.state, false);
        assert_eq!(
            mark.state.parts(),
            state.precrease_extent(&op, &extent).unwrap().state.parts()
        );
    }
}

#[test]
fn selected_and_closure_added_near_vertices_still_refuse() {
    let state = book();
    for op in [
        corner().with_seed(Seed::All),
        corner().with_seed(Seed::Depth {
            at: [0.9, 0.1],
            layers: 2,
        }),
    ] {
        assert!(matches!(
            state.analyse_fold(&op).unwrap_err().refusal,
            FoldRefusal::NearMiss { .. }
        ));
        assert!(matches!(
            state.precrease(&op).unwrap_err().refusal,
            FoldRefusal::NearMiss { .. }
        ));
    }
    // Pick only the clean upper face, but put the book spine on the moving
    // side. Attachment closure now includes the subdivided lower material.
    let connected = depth(
        through([0.0, 0.3], [0.3, 0.0]),
        [0.45, 0.8],
        Direction::Valley,
        [0.55, 0.8],
        1,
    );
    assert!(matches!(
        state.analyse_fold(&connected).unwrap_err().refusal,
        FoldRefusal::NearMiss { .. }
    ));
    assert!(
        state
            .depth_choices(&connected, [0.55, 0.8])
            .unwrap()
            .is_empty()
    );
    // A mountain starting from the clean upper flap includes the lower
    // subdivision through overlap, even though the spine stays stationary.
    let mut swept = corner().with_seed(Seed::Flaps {
        at: vec![[0.9, 0.1]],
    });
    swept.direction = Direction::Mountain;
    assert!(matches!(
        state.analyse_fold(&swept).unwrap_err().refusal,
        FoldRefusal::NearMiss { .. }
    ));
    // Selecting the bottom flap also sweeps in the top one through overlap.
    let bottom = corner().with_seed(Seed::Flaps {
        at: vec![[0.1, 0.1]],
    });
    assert!(matches!(
        state.analyse_fold(&bottom).unwrap_err().refusal,
        FoldRefusal::NearMiss { .. }
    ));
}

#[test]
fn reverse_checks_the_complete_selected_tip_not_the_paper_under_it() {
    use oristudio_fold::{
        CompoundRefused, ReverseChoices, ReverseFold, ReverseKind, ReverseOutcome,
    };
    let square = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let marked = precrease(
        &square,
        &all(
            through([0.2995, 0.0], [0.0, 0.2995]),
            [0.1, 0.1],
            Direction::Valley,
        ),
    )
    .state;
    let book = fold(&marked, &all(x_eq(0.5), [0.8, 0.4], Direction::Valley)).state;
    let state = fold(
        &book,
        &depth(y_eq(0.5), [0.1, 0.1], Direction::Valley, [0.9, 0.1], 1),
    )
    .state;
    let line = x_eq(0.3);
    let choices = ReverseChoices::default();
    for turned in [false, true] {
        let state = if turned {
            state.turn_over()
        } else {
            state.clone()
        };
        let op = ReverseFold {
            line,
            side: side(&line, [0.1, 0.8]),
            anchor: Seed::Flaps {
                at: vec![[0.9, 0.1]],
            },
            kind: ReverseKind::Inside,
        };
        let analysis = state.analyse_reverse(&op).unwrap();
        assert_eq!(analysis.tip.len(), 2);
        let kinds = state.reverse_kinds(&op, &choices).unwrap();
        assert!(
            !kinds.is_empty(),
            "inside: {:?}, outside: {:?}",
            state.reverse_fold(&op, &choices),
            state.reverse_fold(
                &ReverseFold {
                    kind: ReverseKind::Outside,
                    ..op.clone()
                },
                &choices
            )
        );
        for kind in kinds {
            let op = ReverseFold { kind, ..op.clone() };
            let result = state.reverse_fold(&op, &choices).unwrap();
            let folded = match result {
                ReverseOutcome::Landed(folded) => folded,
                other => panic!("expected a unique reverse: {other:?}"),
            };
            assert_valid(&folded.state);
            assert!(state.reverse_action(&op, &choices).is_ok());
            // The lower material, including its near vertex, has not moved.
            for f in state
                .faces()
                .iter()
                .filter(|f| !analysis.tip.contains(&f.id))
            {
                assert_eq!(state.face(f.id), folded.state.face(f.id));
                assert_eq!(state.isometry(f.id), folded.state.isometry(f.id));
            }
            let replay = state.reverse_fold(&op, &choices).unwrap();
            let ReverseOutcome::Landed(replay) = replay else {
                panic!("replay asks again")
            };
            assert_eq!(folded.state.parts(), replay.state.parts());
        }
        let all = ReverseFold {
            anchor: Seed::All,
            ..op
        };
        assert!(
            matches!(state.analyse_reverse(&all), Err(r) if matches!(r.refusal, FoldRefusal::NearMiss { .. }))
        );
        assert!(
            matches!(state.reverse_fold(&all, &choices), Err(CompoundRefused::Refused(r)) if matches!(r.refusal, FoldRefusal::NearMiss { .. }))
        );
    }
}
