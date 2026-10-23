mod support;

use oristudio_fold::{
    ChoiceCount, CompletionLimits, Direction, FaceId, FoldLanding, FoldPlacementSearch, Seed,
    Sheet, StartSide, State,
};
use support::*;

fn complete(search: &mut FoldPlacementSearch) {
    for _ in 0..100 {
        search.advance(&CompletionLimits::default(), 128, 1024);
        if search.count().exact {
            return;
        }
    }
    panic!("small placement search did not finish");
}

#[test]
fn separate_flaps_offer_outer_and_inserted_landings() {
    for direction in [Direction::Valley, Direction::Mountain] {
        let sheet = State::flat(Sheet::square(), StartSide::Front).unwrap();
        let parent = fold(&sheet, &all(y_eq(0.35), [0.5, 0.1], direction)).state;
        let op = all(y_eq(0.8), [0.5, 0.9], direction);
        let mut search = FoldPlacementSearch::new(&parent, &op);
        complete(&mut search);
        assert_eq!(search.count().orders, 2);
        assert_eq!(search.candidates()[0].landing, FoldLanding::Outer);
        assert!(matches!(
            search.candidates()[1].landing,
            FoldLanding::Against { .. }
        ));
        for candidate in search.candidates() {
            assert_valid(&candidate.state);
        }
        assert_eq!(search.candidates()[0].moving, search.candidates()[1].moving);
        assert_ne!(
            search.candidates()[0].state.order(),
            search.candidates()[1].state.order()
        );
    }
}

#[test]
fn selecting_one_flap_offers_only_landings_of_that_flap() {
    let sheet = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let book = fold(&sheet, &all(x_eq(0.5), [0.75, 0.5], Direction::Valley)).state;
    let op = all(
        through([0., 0.3], [0.3, 0.]),
        [0.02, 0.02],
        Direction::Valley,
    )
    .with_seed(Seed::Flaps {
        at: vec![[0.05, 0.05]],
    });
    let mut search = FoldPlacementSearch::new(&book, &op);
    complete(&mut search);
    assert_eq!(search.count().orders, 1);
    let only = &search.candidates()[0];
    assert!(matches!(only.landing, FoldLanding::Against { .. }));
    assert_eq!(only.moving, vec![book.face_at([0.05, 0.05]).unwrap()]);
    assert_valid(&only.state);

    // Carrying the other flap remains possible when it is also selected.
    let mut both = FoldPlacementSearch::new(&book, &op.with_seed(Seed::All));
    complete(&mut both);
    assert!(
        both.candidates()
            .iter()
            .any(|c| c.landing == FoldLanding::Outer)
    );
    assert!(both.candidates().iter().all(|c| c.moving.len() == 2));
}

/// The envelope's top flaps: a precrease on the fold line splits the layer
/// the flap tucks against into the piece the flap lies on and the piece it
/// lands on. The piece it lies on meets no face of the target, but it is the
/// target's own flat layer, not a layer between them: it stays, and the
/// selected corner still lands inside the book, alone.
#[test]
fn a_precrease_on_the_line_does_not_split_the_target_layer() {
    let line = through([0., 0.3], [0.3, 0.]);
    // The precrease lies under the corner that folds: in the top layer for
    // a valley (the bottom corner tucks up under it), in the bottom layer
    // for a mountain (the top corner tucks down over it).
    for (direction, precrease_at, flap) in [
        (
            Direction::Valley,
            through([1., 0.3], [0.7, 0.]),
            [0.05, 0.05],
        ),
        (Direction::Mountain, line, [0.95, 0.05]),
    ] {
        let sheet = State::flat(Sheet::square(), StartSide::Front).unwrap();
        let toward = if direction == Direction::Valley {
            [0.98, 0.02]
        } else {
            [0.02, 0.02]
        };
        let creased = precrease(&sheet, &all(precrease_at, toward, Direction::Valley)).state;
        let book = fold(&creased, &all(x_eq(0.5), [0.75, 0.5], Direction::Valley)).state;
        let op = all(line, [0.02, 0.02], direction).with_seed(Seed::Flaps { at: vec![flap] });
        let mut search = FoldPlacementSearch::new(&book, &op);
        complete(&mut search);
        assert_eq!(
            search.count().orders,
            1,
            "{direction:?}: {:?}",
            search.refusal()
        );
        let only = &search.candidates()[0];
        assert!(matches!(only.landing, FoldLanding::Against { .. }));
        assert_eq!(only.moving, vec![book.face_at(flap).unwrap()]);
        assert_valid(&only.state);
    }
}

#[test]
fn a_limited_search_does_not_claim_its_outer_result_is_unique() {
    let sheet = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let parent = fold(&sheet, &all(y_eq(0.35), [0.5, 0.1], Direction::Valley)).state;
    let mut search =
        FoldPlacementSearch::new(&parent, &all(y_eq(0.8), [0.5, 0.9], Direction::Valley));
    assert_eq!(search.count().orders, 1);
    assert!(!search.count().exact);
    complete(&mut search);
    assert!(search.count().exact);
}

/// Exhaust the old public Tuck surface over *all* faces, independently of the
/// pool pruning, retaining only results whose new/refolded hinge letters match
/// the requested direction and selected flaps. Legacy Tuck also admits
/// opposite-direction folds and adds unselected flaps to reach some targets.
fn assert_legacy_union(parent: &State, op: &oristudio_fold::PlainFold) {
    use oristudio_fold::{CreaseKind, Letter, TuckChoices, TuckFold, TuckFolded, TuckOutcome};
    let mut search = FoldPlacementSearch::new(parent, op);
    complete(&mut search);
    let mut expected = Vec::new();
    let analysis = parent.analyse_fold(op).unwrap();
    let mut selected: Vec<_> = analysis
        .picked
        .iter()
        .flat_map(|&i| analysis.flaps[i].faces.iter().copied())
        .collect();
    selected.sort();
    selected.dedup();
    if let Ok(outer) = parent.fold(op)
        && outer.report.analysis.moving == selected
    {
        expected.push((outer.report.analysis.moving, outer.state));
    }
    let witnesses: Vec<_> = parent
        .faces()
        .iter()
        .map(|f| parent.face_witness(f.id).unwrap())
        .collect();
    assert!(witnesses.len() < 12);
    let mut keep = |folded: TuckFolded| {
        if folded.report.fold.moving != selected {
            return;
        }
        // Check front-relative crease letters independently of the production
        // admission check, which uses moving/stationary face-pair relations.
        let hinges = folded
            .report
            .fold
            .created
            .iter()
            .copied()
            .chain(folded.report.fold.refolded.iter().map(|r| r.edge));
        for id in hinges {
            let crease = folded.state.creases().iter().find(|c| c.id == id).unwrap();
            let face = folded
                .state
                .faces()
                .iter()
                .find(|f| crease.vertices.iter().all(|v| f.ring.contains(v)))
                .unwrap();
            let front = parent
                .front_up(face.id)
                .or_else(|| face.parent.and_then(|id| parent.front_up(id)))
                .unwrap();
            let valley = parent.view().model_direction(op.direction) == Direction::Valley;
            let expected = if front == valley {
                Letter::Valley
            } else {
                Letter::Mountain
            };
            if crease.kind != CreaseKind::Folded(expected) {
                return;
            }
        }
        expected.push((folded.report.fold.moving, folded.state));
    };
    for mask in 1..(1usize << witnesses.len()) {
        let targets: Vec<_> = witnesses
            .iter()
            .enumerate()
            .filter(|(i, _)| mask & (1 << i) != 0)
            .map(|(_, p)| *p)
            .collect();
        let tuck = TuckFold {
            line: op.line,
            side: op.side,
            direction: op.direction,
            seed: op.seed.clone(),
            target: targets[0],
            additional_targets: targets[1..].to_vec(),
        };
        match parent.tuck_fold(&tuck, &TuckChoices::default()) {
            Ok(TuckOutcome::Landed(folded)) => keep(*folded),
            Ok(TuckOutcome::ChooseOrder(choice)) => {
                assert!(choice.count().exact);
                for mut ordinal in 0..choice.count().orders {
                    let mut indices = vec![0; choice.completions().components().len()];
                    for (i, component) in choice.completions().components().iter().enumerate().rev()
                    {
                        indices[i] = (ordinal % component.orders.len() as u64) as usize;
                        ordinal /= component.orders.len() as u64;
                    }
                    keep(choice.pick(&indices).unwrap());
                }
            }
            Err(_) => {}
        }
    }
    for (moving, state) in &expected {
        assert!(
            search
                .candidates()
                .iter()
                .any(|candidate| candidate.moving == *moving
                    && candidate.state.parts() == state.parts()),
            "legacy result missing: {op:?}"
        );
    }
    for (i, candidate) in search.candidates().iter().enumerate() {
        assert_eq!(candidate.moving, selected);
        assert_valid(&candidate.state);
        assert!(
            expected
                .iter()
                .any(|(moving, state)| *moving == candidate.moving
                    && state.parts() == candidate.state.parts())
        );
        assert!(
            !search.candidates()[..i]
                .iter()
                .any(|other| other.moving == candidate.moving
                    && other.state.parts() == candidate.state.parts())
        );
    }
}

#[test]
fn exhaustively_preserves_directional_insertions_across_scopes_directions_and_views() {
    for start in [StartSide::Front, StartSide::Back] {
        let sheet = State::flat(Sheet::square(), start).unwrap();
        let book = fold(&sheet, &all(x_eq(0.5), [0.75, 0.5], Direction::Valley)).state;
        let separate = fold(&sheet, &all(y_eq(0.35), [0.5, 0.1], Direction::Valley)).state;
        for parent in [&book, &book.turn_over(), &book.rotate(0.7)] {
            for direction in [Direction::Valley, Direction::Mountain] {
                let op = all(through([0., 0.3], [0.3, 0.]), [0.02, 0.02], direction);
                for seed in [
                    Seed::All,
                    Seed::Flaps {
                        at: vec![[0.05, 0.05]],
                    },
                    Seed::Depth {
                        at: [0.05, 0.05],
                        layers: 1,
                    },
                    Seed::Depth {
                        at: [0.05, 0.05],
                        layers: 2,
                    },
                ] {
                    assert_legacy_union(parent, &op.clone().with_seed(seed));
                }
            }
        }
        assert_legacy_union(&separate, &all(y_eq(0.8), [0.5, 0.9], Direction::Valley));
        let creased = precrease(
            &book,
            &all(
                through([0., 0.3], [0.3, 0.]),
                [0.02, 0.02],
                Direction::Valley,
            ),
        )
        .state;
        assert_legacy_union(
            &creased,
            &all(
                through([0., 0.3], [0.3, 0.]),
                [0.02, 0.02],
                Direction::Valley,
            ),
        );
    }
}

#[test]
fn canceled_budget_keeps_candidates_and_resumes_without_reordering() {
    let sheet = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let parent = fold(&sheet, &all(y_eq(0.35), [0.5, 0.1], Direction::Valley)).state;
    let mut search =
        FoldPlacementSearch::new(&parent, &all(y_eq(0.8), [0.5, 0.9], Direction::Valley));
    let first = search.candidates()[0].state.parts().clone();
    search.advance(
        &CompletionLimits {
            max_nodes: Some(0),
            ..CompletionLimits::default()
        },
        128,
        1024,
    );
    assert!(!search.count().exact);
    assert_eq!(search.count().orders, 1);
    complete(&mut search);
    assert_eq!(search.candidates()[0].state.parts(), &first);
    assert_eq!(search.count().orders, 2);
}

#[test]
fn a_corner_fold_on_a_precreased_sheet_has_only_its_requested_direction() {
    for start in [StartSide::Front, StartSide::Back] {
        let mut grid = State::flat(Sheet::square(), start).unwrap();
        for c in [0.5, 0.75, 0.25] {
            for line in [x_eq(c), y_eq(c)] {
                grid = precrease(&grid, &all(line, [0.9, 0.9], Direction::Valley)).state;
            }
        }
        for parent in [&grid, &grid.turn_over(), &grid.rotate(0.7)] {
            for direction in [Direction::Valley, Direction::Mountain] {
                let op = all(through([0., 0.5], [0.5, 1.]), [0., 1.], direction);
                for seed in [
                    Seed::All,
                    Seed::Flaps {
                        at: vec![[0.1, 0.9]],
                    },
                    Seed::Depth {
                        at: [0.1, 0.9],
                        layers: 1,
                    },
                ] {
                    let op = op.clone().with_seed(seed);
                    let precreased = precrease(parent, &op).state;
                    // Both scoring a new attachment and refolding an existing
                    // one must preserve direction across the grid's faces.
                    for parent in [parent, &precreased] {
                        let mut search = FoldPlacementSearch::new(parent, &op);
                        complete(&mut search);
                        assert_eq!(
                            search.count().orders,
                            1,
                            "{start:?} {:?} {op:?}",
                            parent.view()
                        );
                        assert_eq!(search.candidates()[0].landing, FoldLanding::Outer);
                        assert_eq!(
                            search.candidates()[0].state.parts(),
                            fold(parent, &op).state.parts()
                        );
                    }
                }
            }
        }
    }
}

/// A flat sheet precreased along whole lines at `xs` and `ys`, and along
/// both diagonals when `diagonals`.
fn precreased(start: StartSide, xs: &[f64], ys: &[f64], diagonals: bool) -> State {
    let mut sheet = State::flat(Sheet::square(), start).unwrap();
    for &c in xs {
        sheet = precrease(&sheet, &all(x_eq(c), [0.99, 0.5], Direction::Valley)).state;
    }
    for &c in ys {
        sheet = precrease(&sheet, &all(y_eq(c), [0.5, 0.99], Direction::Valley)).state;
    }
    if diagonals {
        for (line, toward) in [
            (through([0., 0.], [1., 1.]), [0.9, 0.1]),
            (through([1., 0.], [0., 1.]), [0.1, 0.1]),
        ] {
            sheet = precrease(&sheet, &all(line, toward, Direction::Mountain)).state;
        }
    }
    sheet
}

/// Every face of `landed` turned over from `parent`, which a single fold moved.
fn turned(parent: &State, landed: &State) -> Vec<FaceId> {
    landed
        .faces()
        .iter()
        .filter(|f| {
            let before = parent
                .front_up(f.id)
                .or_else(|| f.parent.and_then(|id| parent.front_up(id)))
                .unwrap();
            landed.front_up(f.id).unwrap() != before
        })
        .map(|f| f.id)
        .collect()
}

#[test]
fn folding_a_precreased_flat_sheet_in_half_needs_no_search() {
    // The pool holds one target per stationary face the half lands on whole
    // — a dozen and more here — so the sets of targets run to the thousands,
    // more than a batch tries, and every one turns a tuck the wrong way round
    // at the hinge. One order exists, and the search knows it before trying
    // any. The first sheet folds along its own precreases, as a precreased
    // base does; the second's creases cross the line and land between the
    // other half's.
    let symmetric = [0.25, 0.5, 0.75];
    let xs = [0.15, 0.3, 0.45, 0.6, 0.8, 0.9];
    let ys = [0.1, 0.2, 0.35, 0.55, 0.7, 0.85];
    for start in [StartSide::Front, StartSide::Back] {
        for grid in [
            precreased(start, &symmetric, &symmetric, true),
            precreased(start, &xs, &ys, false),
        ] {
            for parent in [&grid, &grid.turn_over(), &grid.rotate(0.7)] {
                for direction in [Direction::Valley, Direction::Mountain] {
                    for op in [
                        all(through([0., 0.], [1., 1.]), [0.9, 0.1], direction),
                        all(through([1., 0.], [0., 1.]), [0.1, 0.1], direction),
                        all(x_eq(0.5), [0.9, 0.5], direction),
                    ] {
                        let mut search = FoldPlacementSearch::new(parent, &op);
                        let what = format!("{start:?} {:?} {op:?}", parent.view());
                        let forced = ChoiceCount {
                            orders: 1,
                            exact: true,
                        };
                        let before = search.count();
                        // One batch, as the bridge runs one per question.
                        search.advance(&CompletionLimits::default(), 128, 1024);
                        assert_eq!(search.count(), forced, "after a batch: {what}");
                        assert_eq!(before, forced, "before any: {what}");
                        let only = &search.candidates()[0];
                        assert_eq!(only.landing, FoldLanding::Outer, "{what}");
                        assert_eq!(
                            only.state.parts(),
                            fold(parent, &op).state.parts(),
                            "{what}"
                        );
                        // The half lies wholly on the side the fold names:
                        // in front for a valley, behind for a mountain.
                        let on_top = parent.view().model_direction(direction) == Direction::Valley;
                        let moved = turned(parent, &only.state);
                        assert!(!moved.is_empty(), "{what}");
                        let mut across = 0;
                        for pair in only.state.problem().variables() {
                            let [a, b] = pair.faces();
                            let (m, s) = match (moved.contains(&a), moved.contains(&b)) {
                                (true, false) => (a, b),
                                (false, true) => (b, a),
                                _ => continue,
                            };
                            across += 1;
                            assert_eq!(only.state.above(m, s), Some(on_top), "{what}");
                        }
                        assert!(across >= moved.len(), "{what}");
                    }
                }
            }
        }
    }
}

#[test]
fn a_fold_with_two_landings_on_precreased_paper_still_asks_and_then_finishes() {
    // Two separate flaps, one folded over the other's region: outer, or
    // between the base and the first flap. Precreases multiply the targets,
    // not the landings; the search ends once it has found both.
    for start in [StartSide::Front, StartSide::Back] {
        let grid = precreased(start, &[0.25, 0.5, 0.75], &[0.2, 0.5, 0.9], false);
        let parent = fold(&grid, &all(y_eq(0.35), [0.5, 0.1], Direction::Valley)).state;
        let mut search =
            FoldPlacementSearch::new(&parent, &all(y_eq(0.8), [0.5, 0.95], Direction::Valley));
        assert_eq!(
            search.count(),
            ChoiceCount {
                orders: 1,
                exact: false
            }
        );
        complete(&mut search);
        assert_eq!(search.count().orders, 2);
        for candidate in search.candidates() {
            assert_valid(&candidate.state);
        }
    }
}
