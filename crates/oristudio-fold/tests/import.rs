//! Import CP (plan D16, D10's inverse, D8 completion, D6 stored choices) on
//! hand-built crease patterns: the bare square, a book fold, and the
//! preliminary and waterbomb bases with the sink spike's hand assignments
//! (research r2-spike-sinks, "Starting states: CP importer": 1 order with
//! their letters, 18 from the geometry alone). Also the shape and chord
//! refusals, witness replay under renumbering, the budget, the round trip
//! from folded states (the kite base, and seeded random sequences), and
//! Edit's folded figure through Oriedita's relations.

mod support;

use oristudio_fold::{
    Broken, CompletionLimits, CompletionRefusal, CreaseKind, CreasePatternInput, Direction, FaceId,
    ImportKind, ImportRefusal, ImportSegment, ImportSpace, ImportTarget, ImportedPattern, Letter,
    Sheet, SheetShape, StartSide, State, WitnessOrder, complete::BudgetLimit, random::Rng,
};
use support::*;

const MOUNTAIN: ImportKind = ImportKind::Mountain;
const VALLEY: ImportKind = ImportKind::Valley;
const UNKNOWN: ImportKind = ImportKind::Unassigned { hint: None };

fn flat(letter: Letter) -> ImportKind {
    ImportKind::Unassigned { hint: Some(letter) }
}

fn segment(from: Point, to: Point, kind: ImportKind) -> ImportSegment {
    ImportSegment { from, to, kind }
}

/// The border of `[0, w] × [0, h]`.
fn border(w: f64, h: f64) -> Vec<ImportSegment> {
    let c = [[0.0, 0.0], [w, 0.0], [w, h], [0.0, h]];
    (0..4)
        .map(|i| segment(c[i], c[(i + 1) % 4], ImportKind::Border))
        .collect()
}

fn sheet_input(segments: Vec<ImportSegment>) -> CreasePatternInput {
    CreasePatternInput {
        space: ImportSpace::Sheet,
        segments,
    }
}

/// The centre, the corners k1..k4 and the edge midpoints m1..m4 of the unit
/// square, as the spike numbers them.
const C: Point = [0.5, 0.5];
const SPOKE_ENDS: [Point; 8] = [
    [0.0, 0.0],
    [0.0, 0.5],
    [0.0, 1.0],
    [0.5, 1.0],
    [1.0, 1.0],
    [1.0, 0.5],
    [1.0, 0.0],
    [0.5, 0.0],
];

/// Interior points of the triangles T1..T8 around the centre: T1 = (C, k1,
/// m1), then counter-clockwise... in the spike's order.
const TRIANGLES: [Point; 8] = [
    [0.15, 0.4],
    [0.15, 0.6],
    [0.4, 0.85],
    [0.6, 0.85],
    [0.85, 0.6],
    [0.85, 0.4],
    [0.6, 0.15],
    [0.4, 0.15],
];

/// The square with its eight spokes C–k1, C–m1, C–k2, C–m2, C–k3, C–m3,
/// C–k4, C–m4 of the given kinds (`bases.mjs` `squareCP`).
fn spokes(kinds: [ImportKind; 8]) -> CreasePatternInput {
    let mut segments = border(1.0, 1.0);
    segments.extend(
        SPOKE_ENDS
            .iter()
            .zip(kinds)
            .map(|(&end, kind)| segment(C, end, kind)),
    );
    sheet_input(segments)
}

/// The preliminary (square) base: the midline halves M, the side quadrants'
/// half-diagonals C–k2 and C–k4 V, the front and back quadrants'
/// half-diagonals C–k1 and C–k3 flat remembering V (`bases.mjs:51`).
fn preliminary(letters: bool) -> CreasePatternInput {
    let (m, v) = if letters {
        (MOUNTAIN, VALLEY)
    } else {
        (UNKNOWN, UNKNOWN)
    };
    let f = flat(Letter::Valley);
    spokes([f, m, v, m, f, m, v, m])
}

/// The waterbomb base: the spokes with the roles swapped — the
/// half-diagonals M, the midline halves C–m2 and C–m4 V, C–m1 and C–m3 flat
/// remembering M (`bases.mjs` `waterbombBase`).
fn waterbomb(letters: bool) -> CreasePatternInput {
    let (m, v) = if letters {
        (MOUNTAIN, VALLEY)
    } else {
        (UNKNOWN, UNKNOWN)
    };
    let f = flat(Letter::Mountain);
    spokes([m, f, m, v, m, f, m, v])
}

fn empty() -> ImportTarget<'static> {
    ImportTarget::Empty {
        start: StartSide::Front,
    }
}

fn imported(input: &CreasePatternInput, target: ImportTarget<'_>) -> ImportedPattern {
    ImportedPattern::new(input, target).unwrap_or_else(|e| panic!("{} {e}", e.code()))
}

fn limits() -> CompletionLimits {
    CompletionLimits::default()
}

/// The pattern's only order, as a state.
fn only_state(pattern: &ImportedPattern) -> State {
    let completions = pattern
        .complete(&limits())
        .unwrap_or_else(|e| panic!("{} {e}", e.code()));
    assert!(
        completions.is_unique(),
        "{} orders",
        completions.count().orders
    );
    let order = completions
        .order(&vec![0; completions.components().len()])
        .unwrap_or_default();
    pattern
        .state(order)
        .unwrap_or_else(|e| panic!("{} {e}", e.code()))
}

#[test]
fn imported_flat_marks_follow_the_paper_without_changing_its_layer_order() {
    let mut segments = border(1.0, 1.0);
    segments.push(segment([0.5, 0.0], [0.5, 1.0], VALLEY));
    let bare = only_state(&imported(&sheet_input(segments.clone()), empty()));
    let mark = ImportKind::CreaseMark {
        letter: Letter::Valley,
    };
    segments.extend([
        segment([-0.2, 0.25], [1.2, 0.25], mark), // clipped across both layers
        segment([0.2, 0.65], [0.4, 0.65], mark),  // dangling inside a face
        segment([0.2, 0.65], [0.3, 0.65], mark),  // duplicate
        segment([0.5, 0.0], [0.5, 1.0], mark),    // active crease wins
        segment([0.0, 0.0], [1.0, 0.0], mark),    // border wins
    ]);
    let pattern = imported(&sheet_input(segments), empty());
    let state = only_state(&pattern);
    assert_valid(&state);
    assert_eq!(state.faces(), bare.faces());
    assert_eq!(state.vertices(), bare.vertices());
    assert_eq!(state.parts().order, bare.parts().order);
    assert_eq!(state.crease_marks().len(), 2);
    assert_eq!(pattern.summary().precreases, 2);
    assert!(pattern.summary().guides.is_empty());
    let scene = state.scene();
    assert_eq!(scene.crease_marks.len(), 2);
    assert_eq!(
        scene
            .crease_marks
            .iter()
            .map(|m| m.pieces.len())
            .sum::<usize>(),
        3
    );
    // Public-state roundtrip and a later fold carry marks, too.
    let replayed = only_state(&imported(&CreasePatternInput::of_state(&state), empty()));
    assert_eq!(replayed.crease_marks(), state.crease_marks());
    let next = fold(&state, &all(y_eq(0.25), [0.25, 0.1], Direction::Valley)).state;
    assert_valid(&next);
    assert!(
        next.crease_marks()
            .iter()
            .all(|m| (m.a[1] - 0.65).abs() < 1e-9)
    );
}

/// Every choice of a completion, in odometer order.
fn every_choice(sizes: &[usize]) -> Vec<Vec<usize>> {
    let mut out = vec![Vec::new()];
    for &n in sizes {
        out = out
            .into_iter()
            .flat_map(|prefix| {
                (0..n).map(move |k| {
                    let mut c = prefix.clone();
                    c.push(k);
                    c
                })
            })
            .collect();
    }
    out
}

/// Whether two states order every pair of faces alike, matching faces by
/// their witnesses (numbering-free).
fn same_order(a: &State, b: &State) -> bool {
    a.faces().len() == b.faces().len()
        && a.faces().iter().all(|f| {
            let Some(g) = a.face_witness(f.id).and_then(|p| b.face_at(p)) else {
                return false;
            };
            a.faces().iter().all(|h| {
                let Some(k) = a.face_witness(h.id).and_then(|p| b.face_at(p)) else {
                    return false;
                };
                a.above(f.id, h.id) == b.above(g, k)
            })
        })
}

/// Every crease letter of `state` at the sheet points of the input's
/// lettered segments' midpoints.
fn letters_reproduced(input: &CreasePatternInput, state: &State) -> bool {
    input.segments.iter().all(|s| {
        let mid = [(s.from[0] + s.to[0]) / 2.0, (s.from[1] + s.to[1]) / 2.0];
        let want = match s.kind {
            ImportKind::Mountain => CreaseKind::Folded(Letter::Mountain),
            ImportKind::Valley => CreaseKind::Folded(Letter::Valley),
            ImportKind::Unassigned { hint: Some(l) } => CreaseKind::Flat(l),
            _ => return true,
        };
        state.crease_at(mid).map(|c| c.kind) == Some(want)
    })
}

#[test]
fn the_bare_square_is_the_flat_sheet() {
    let pattern = imported(&sheet_input(border(1.0, 1.0)), empty());
    assert_eq!(pattern.summary().shape, SheetShape::Square);
    assert_eq!(pattern.summary().faces, 1);
    let state = only_state(&pattern);
    assert_eq!(state.faces().len(), 1);
    assert_eq!(state.step(), 1);
    assert_valid(&state);
}

#[test]
fn a_book_fold_has_one_order_with_its_letter_and_two_without() {
    for (kind, orders) in [(VALLEY, 1), (MOUNTAIN, 1), (UNKNOWN, 2)] {
        let mut segments = border(1.0, 1.0);
        segments.push(segment([0.5, 0.0], [0.5, 1.0], kind));
        let pattern = imported(&sheet_input(segments), empty());
        let completions = pattern
            .complete(&limits())
            .unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(completions.count().orders, orders, "{kind:?}");
        assert!(completions.count().exact);
    }
    // The valley as the front sees it: the front-up half lies below.
    let mut segments = border(1.0, 1.0);
    segments.push(segment([0.5, 0.0], [0.5, 1.0], VALLEY));
    let state = only_state(&imported(&sheet_input(segments), empty()));
    let up = state
        .faces()
        .iter()
        .find(|f| state.front_up(f.id) == Some(true))
        .map(|f| f.id)
        .unwrap_or_else(|| unreachable!());
    let down = state
        .faces()
        .iter()
        .find(|f| f.id != up)
        .map(|f| f.id)
        .unwrap_or_else(|| unreachable!());
    assert_eq!(state.above(down, up), Some(true));
    assert_eq!(
        kind_at(&state, [0.5, 0.5]),
        CreaseKind::Folded(Letter::Valley)
    );
}

#[test]
fn a_turned_import_lands_in_the_turned_view_and_nothing_else_moves() {
    // The Layer order dialog's Rotate on an import: the step it lands is seen
    // turned, from either start side, and its order and letters are the
    // untouched import's.
    for start in [StartSide::Front, StartSide::Back] {
        let input = preliminary(true);
        let plain = imported(&input, ImportTarget::Empty { start });
        let mut turned = imported(&input, ImportTarget::Empty { start });
        let quarter = std::f64::consts::FRAC_PI_2;
        turned.rotate_view(quarter);
        turned.rotate_view(quarter / 3.0);
        let (was, now) = (only_state(&plain), only_state(&turned));
        let want = was.view().rotated(quarter + quarter / 3.0);
        assert!(
            (now.view().rotation - want.rotation).abs() < 1e-12,
            "{start:?}: {:?}",
            now.view()
        );
        assert_eq!(now.view().flipped, was.view().flipped, "{start:?}");
        assert!(same_order(&was, &now), "{start:?}: the same order");
        assert!(
            letters_reproduced(&input, &now),
            "{start:?}: the same letters"
        );
        assert_eq!(now.step(), was.step(), "{start:?}: no step of its own");
        // Not a number is no turn.
        turned.rotate_view(f64::NAN);
        assert_eq!(only_state(&turned).view(), now.view(), "{start:?}");
    }
}

#[test]
fn the_bases_import_to_one_order_with_their_letters_and_eighteen_without() {
    for (name, base) in [
        ("preliminary", preliminary as fn(bool) -> CreasePatternInput),
        ("waterbomb", waterbomb),
    ] {
        let lettered = base(true);
        let pattern = imported(&lettered, empty());
        assert_eq!(pattern.summary().faces, 8, "{name}");
        assert_eq!(pattern.summary().precreases, 2, "{name}");
        let state = only_state(&pattern);
        assert_valid(&state);
        assert!(letters_reproduced(&lettered, &state), "{name}");
        // Maekawa at the centre: four of one letter, two of the other.
        let folded = state
            .creases()
            .iter()
            .filter(|c| c.kind.is_folded())
            .count();
        assert_eq!(folded, 6, "{name}");

        let open = imported(&base(false), empty());
        assert_eq!(open.summary().unknown_letters, 6, "{name}");
        let completions = open.complete(&limits()).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(completions.count().orders, 18, "{name}");
        assert!(completions.count().exact, "{name}");
        // Every one is a valid state, and exactly one has the base's letters.
        let sizes: Vec<usize> = completions
            .components()
            .iter()
            .map(|c| c.orders.len())
            .collect();
        let mut matching = 0;
        for choice in every_choice(&sizes) {
            let order = completions.order(&choice).unwrap_or_default();
            let candidate = open.state(order).unwrap_or_else(|e| panic!("{e}"));
            assert_valid(&candidate);
            if letters_reproduced(&lettered, &candidate) {
                matching += 1;
                assert!(same_order(&candidate, &state), "{name}");
            }
        }
        assert_eq!(matching, 1, "{name}");
    }
}

#[test]
fn the_bases_stack_as_the_spike_derived() {
    // The spike's orders (r2-spike-sinks, its table), top to bottom, with T1
    // front-up at the root: the preliminary base T1 > T2 > T3 > T4 on the
    // left half and T8 > T7 > T6 > T5 on the right; the waterbomb
    // T2 > T3 > T4 > T5 and T1 > T8 > T7 > T6. Our root is another face; a
    // root of the other orientation sees the model from behind, so every
    // "above" is reversed.
    for (name, base, chains) in [
        (
            "preliminary",
            preliminary as fn(bool) -> CreasePatternInput,
            [[0, 1, 2, 3], [7, 6, 5, 4]],
        ),
        ("waterbomb", waterbomb, [[1, 2, 3, 4], [0, 7, 6, 5]]),
    ] {
        let state = only_state(&imported(&base(true), empty()));
        let t = TRIANGLES.map(|p| face(&state, p));
        let root_up = state.front_up(t[0]) == Some(true);
        let seen_above = |f: FaceId, g: FaceId| above(&state, f, g) == root_up;
        for chain in chains {
            for pair in chain.windows(2) {
                assert!(
                    seen_above(t[pair[0]], t[pair[1]]),
                    "{name}: T{} > T{}",
                    pair[0] + 1,
                    pair[1] + 1
                );
            }
        }
    }
}

#[test]
fn a_back_start_keeps_the_front_relative_letters() {
    let mut segments = border(1.0, 1.0);
    segments.push(segment([0.5, 0.0], [0.5, 1.0], VALLEY));
    let back = ImportTarget::Empty {
        start: StartSide::Back,
    };
    let state = only_state(&imported(&sheet_input(segments), back));
    assert!(state.view().flipped);
    assert_eq!(
        kind_at(&state, [0.5, 0.5]),
        CreaseKind::Folded(Letter::Valley)
    );
}

#[test]
fn shapes_that_do_not_fit_the_sequence_are_refused() {
    // A 2:1 rectangle into a square sequence.
    let square = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let wide = sheet_input(border(2.0, 1.0));
    let refusal = ImportedPattern::new(&wide, ImportTarget::After(&square)).err();
    assert_eq!(
        refusal.as_ref().map(ImportRefusal::code),
        Some("import_shape_mismatch")
    );
    assert!(matches!(
        refusal,
        Some(ImportRefusal::ShapeMismatch { expected, found })
            if expected == [1.0, 1.0] && found == [1.0, 0.5]
    ));
    // A rectangle into a hexagon sequence with steps.
    let hexagon = State::flat(
        Sheet::regular(6).unwrap_or_else(|e| panic!("{e}")),
        StartSide::Front,
    )
    .unwrap_or_else(|e| panic!("{e}"));
    let folded = fold(&hexagon, &all(x_eq(0.5), [0.9, 0.5], Direction::Valley)).state;
    assert_eq!(
        ImportedPattern::new(&wide, ImportTarget::After(&folded))
            .err()
            .as_ref()
            .map(ImportRefusal::code),
        Some("import_shape_unsupported")
    );
    // An empty sequence of any shape adopts the pattern's rectangle; a
    // tall sequence takes the wide pattern turned a quarter.
    let adopted = imported(&wide, empty());
    assert_eq!(
        adopted.summary().shape,
        SheetShape::Rectangle {
            width: 1.0,
            height: 0.5
        }
    );
    let tall = State::flat(
        Sheet::rectangle(1.0, 2.0).unwrap_or_else(|e| panic!("{e}")),
        StartSide::Front,
    )
    .unwrap_or_else(|e| panic!("{e}"));
    let turned = imported(&wide, ImportTarget::After(&tall));
    assert!(turned.summary().quarter_turn);
    assert_eq!(turned.sheet(), tall.sheet());
}

#[test]
fn a_crease_that_stops_inside_the_paper_is_refused_where_the_file_draws_it() {
    // Oriedita's model space, y-down: a precrease from the left edge to the
    // centre, which is no chord of the face it would cut.
    let corners = [
        [-200.0, -200.0],
        [200.0, -200.0],
        [200.0, 200.0],
        [-200.0, 200.0],
    ];
    let mut segments: Vec<ImportSegment> = (0..4)
        .map(|i| segment(corners[i], corners[(i + 1) % 4], ImportKind::Border))
        .collect();
    segments.push(segment([-200.0, 0.0], [0.0, 0.0], flat(Letter::Mountain)));
    let input = CreasePatternInput {
        space: ImportSpace::Model,
        segments,
    };
    let refusal = ImportedPattern::new(&input, empty()).err();
    match refusal {
        Some(ImportRefusal::CreaseNotChord {
            segment,
            kind,
            point,
        }) => {
            assert_eq!(segment, 4);
            assert_eq!(kind, flat(Letter::Mountain));
            assert!(
                (point[0]).abs() < 1e-9 && (point[1]).abs() < 1e-9,
                "{point:?}"
            );
        }
        other => panic!("expected import_crease_not_chord, got {other:?}"),
    }
    // An unassigned line without a hint is held to the same rule.
    let mut segments = border(1.0, 1.0);
    segments.push(segment([0.5, 0.0], [0.5, 0.7], UNKNOWN));
    assert_eq!(
        ImportedPattern::new(&sheet_input(segments), empty())
            .err()
            .as_ref()
            .map(ImportRefusal::code),
        Some("import_crease_not_chord")
    );
}

#[test]
fn aux_lines_are_guides_and_a_pattern_that_cannot_fold_is_named() {
    let mut segments = border(1.0, 1.0);
    segments.push(segment([0.5, 0.0], [0.5, 1.0], VALLEY));
    segments.push(segment([0.0, 0.3], [1.0, 0.3], ImportKind::Aux));
    let pattern = imported(&sheet_input(segments), empty());
    assert_eq!(pattern.summary().faces, 2);
    assert_eq!(pattern.summary().guides, vec![[[0.0, 0.3], [1.0, 0.3]]]);

    // A single diagonal valley and a midline mountain meeting at the centre
    // do not fold flat there.
    let mut segments = border(1.0, 1.0);
    segments.push(segment([0.0, 0.0], [1.0, 1.0], VALLEY));
    segments.push(segment([0.0, 1.0], [0.5, 0.5], MOUNTAIN));
    segments.push(segment([0.5, 0.5], [1.0, 0.5], MOUNTAIN));
    let refusal = ImportedPattern::new(&sheet_input(segments), empty()).err();
    assert!(
        matches!(refusal, Some(ImportRefusal::NotFlatFoldable { ref points, .. }) if !points.is_empty()),
        "{refusal:?}"
    );
}

#[test]
fn a_stored_order_replays_under_renumbering() {
    let input = preliminary(true);
    let state = only_state(&imported(&input, empty()));
    let stored = WitnessOrder::of_state(&state).unwrap_or_else(|| unreachable!());
    // As a step stores it.
    let json = serde_json::to_string(&stored).unwrap_or_default();
    let stored: WitnessOrder = serde_json::from_str(&json).unwrap_or_else(|e| panic!("{e}"));

    // The same pattern written another way: in Oriedita's y-down model
    // space, segments reversed and backwards, a spoke split in two, and an
    // aux line across.
    let to_model = |p: Point| [400.0 * p[0] - 200.0, 200.0 - 400.0 * p[1]];
    let mut segments: Vec<ImportSegment> = input
        .segments
        .iter()
        .rev()
        .map(|s| segment(to_model(s.to), to_model(s.from), s.kind))
        .collect();
    // The spoke C–m4, first once reversed.
    let spoke = segments.remove(0);
    assert_eq!(spoke.kind, MOUNTAIN);
    let mid = [
        (spoke.from[0] + spoke.to[0]) / 2.0,
        (spoke.from[1] + spoke.to[1]) / 2.0,
    ];
    segments.insert(0, segment(spoke.from, mid, spoke.kind));
    segments.push(segment(mid, spoke.to, spoke.kind));
    segments.push(segment([-200.0, 100.0], [200.0, 100.0], ImportKind::Aux));
    let rewritten = CreasePatternInput {
        space: ImportSpace::Model,
        segments,
    };
    let again = imported(&rewritten, empty());
    let numbering_differs = state.faces().iter().any(|f| {
        state
            .face_witness(f.id)
            .and_then(|p| again.unordered().face_at(p))
            != Some(f.id)
    });
    assert!(numbering_differs, "the rewrite must renumber the faces");
    let replayed = again
        .replay(&stored, &limits())
        .unwrap_or_else(|e| panic!("{e}"));
    assert!(same_order(&state, &replayed));
    assert!(letters_reproduced(&input, &replayed));

    // Against the same faces with no letters, the stored order alone still
    // decides everything.
    let open = imported(&preliminary(false), empty());
    let from_open = open
        .replay(&stored, &limits())
        .unwrap_or_else(|e| panic!("{e}"));
    assert!(same_order(&state, &from_open));
    assert!(letters_reproduced(&input, &from_open));

    // A witness that now lies on a crease breaks the step.
    let mut moved = stored.clone();
    moved.faces[0] = C;
    assert!(matches!(
        again.replay(&moved, &limits()),
        Err(Broken::Witness { .. })
    ));
    // So does a stored order the letters contradict: the waterbomb's faces
    // are the same triangles, its letters are not.
    assert!(matches!(
        imported(&waterbomb(true), empty()).replay(&stored, &limits()),
        Err(Broken::Completion { .. })
    ));
}

#[test]
fn a_stored_pick_replays_to_the_order_it_chose() {
    // What a compound fold stores (plan D6): only the pairs the completion
    // left free, each face named by its witness. Replayed with the same
    // fixed pairs, every pick of the open preliminary base resolves to its
    // own order, renumbered or not.
    let open = imported(&preliminary(false), empty());
    let completions = open.complete(&limits()).unwrap_or_else(|e| panic!("{e}"));
    let sizes: Vec<usize> = completions
        .components()
        .iter()
        .map(|c| c.orders.len())
        .collect();
    let mut rewritten = preliminary(false);
    rewritten.segments.reverse();
    let renumbered = imported(&rewritten, empty());
    for choice in every_choice(&sizes) {
        let picked = completions.chosen_pairs(&choice).unwrap_or_default();
        let stored = open
            .unordered()
            .witness_order(&picked)
            .unwrap_or_else(|| unreachable!());
        let chosen = open
            .state(completions.order(&choice).unwrap_or_default())
            .unwrap_or_else(|e| panic!("{e}"));
        for pattern in [&open, &renumbered] {
            let replayed = pattern
                .replay(&stored, &limits())
                .unwrap_or_else(|e| panic!("{choice:?}: {e}"));
            assert!(same_order(&chosen, &replayed), "{choice:?}");
        }
    }
    // Storing nothing leaves all eighteen: broken, not guessed.
    let nothing = WitnessOrder {
        faces: Vec::new(),
        orders: Vec::new(),
    };
    assert!(matches!(
        open.replay(&nothing, &limits()),
        Err(Broken::NotUnique { orders }) if orders.orders == 18
    ));
}

#[test]
fn the_budget_stops_a_search_that_needs_more() {
    let open = imported(&waterbomb(false), empty());
    let short = CompletionLimits {
        max_nodes: Some(1),
        ..limits()
    };
    let refusal = open.complete(&short).err();
    assert_eq!(
        refusal.as_ref().map(ImportRefusal::code),
        Some("import_budget_exceeded")
    );
    assert!(matches!(
        refusal,
        Some(ImportRefusal::BudgetExceeded {
            limit: BudgetLimit::Nodes,
            nodes: 1
        })
    ));
    // Listing fewer than there are is reported, not hidden.
    let listed = open
        .complete(&CompletionLimits {
            per_component: 1,
            ..limits()
        })
        .unwrap_or_else(|e| panic!("{e}"));
    assert!(!listed.count().exact);
}

#[test]
fn a_folded_state_round_trips_through_its_crease_pattern() {
    // The kite base, with its diagonal precrease (classics.rs), then
    // imported after itself: the jump keeps the view and the root, so every
    // face lands where it was.
    let mut state =
        State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let diagonal = through([0.0, 0.0], [1.0, 1.0]);
    state = precrease(&state, &all(diagonal, [0.9, 0.1], Direction::Valley)).state;
    state = fold(
        &state,
        &all(at_angle([0.0, 0.0], 22.5), [0.9, 0.05], Direction::Valley),
    )
    .state;
    state = fold(
        &state,
        &all(at_angle([0.0, 0.0], 67.5), [0.05, 0.9], Direction::Valley),
    )
    .state;
    state = state.turn_over();

    let input = CreasePatternInput::of_state(&state);
    let pattern = imported(&input, ImportTarget::After(&state));
    assert_eq!(pattern.summary().faces, state.faces().len());
    assert_eq!(pattern.summary().precreases, 1);
    let stored = WitnessOrder::of_state(&state).unwrap_or_else(|| unreachable!());
    let jumped = pattern
        .replay(&stored, &limits())
        .unwrap_or_else(|e| panic!("{e}"));
    assert_valid(&jumped);
    assert_eq!(jumped.view(), state.view());
    assert_eq!(jumped.step(), state.step() + 1);
    assert!(same_order(&state, &jumped));
    assert!(letters_reproduced(&input, &jumped));
    for f in state.faces() {
        let p = state.face_witness(f.id).unwrap_or_else(|| unreachable!());
        let g = face(&jumped, p);
        let (a, b) = (
            state.image_of(p).unwrap_or_default(),
            jumped.image_of(p).unwrap_or_default(),
        );
        assert!(
            (a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9,
            "{f:?}"
        );
        assert_eq!(state.front_up(f.id), jumped.front_up(g));
    }
    // The letters alone leave the kite's order among the choices.
    let completions = pattern
        .complete(&limits())
        .unwrap_or_else(|e| panic!("{e}"));
    assert!(completions.choice_of(jumped.order()).is_some());
}

#[test]
fn edits_folded_figure_becomes_the_same_state() {
    let input = preliminary(true);
    let pattern = imported(&input, empty());
    let state = only_state(&pattern);
    // Oriedita's relations, relative to a starting face of each orientation,
    // named by interior points.
    for start in [TRIANGLES[0], TRIANGLES[1]] {
        let start_up = state.front_up(face(&state, start)) == Some(true);
        let relations: Vec<[Point; 2]> = state
            .order()
            .to_oriedita(start_up)
            .iter()
            .map(|r| {
                [
                    state.face_witness(r.upper_face).unwrap_or_default(),
                    state.face_witness(r.lower_face).unwrap_or_default(),
                ]
            })
            .collect();
        let from_edit = pattern
            .from_oriedita(start, &relations, &limits())
            .unwrap_or_else(|e| panic!("{} {e}", e.code()));
        assert!(same_order(&state, &from_edit));
        // Read with the opposite convention, they contradict the letters.
        let flipped: Vec<[Point; 2]> = relations.iter().map(|&[u, l]| [l, u]).collect();
        assert!(matches!(
            pattern.from_oriedita(start, &flipped, &limits()),
            Err(ImportRefusal::NoOrder {
                refusal: CompletionRefusal::FixedContradictory { .. },
                ..
            })
        ));
    }
    // Relations that leave pairs open offer a choice instead.
    let open = imported(&preliminary(false), empty());
    assert!(matches!(
        open.from_oriedita(TRIANGLES[0], &[], &limits()),
        Err(ImportRefusal::OrderOpen { orders }) if orders.orders == 18
    ));
    assert!(matches!(
        open.from_oriedita(C, &[], &limits()),
        Err(ImportRefusal::WitnessNotInFace { .. })
    ));
}

#[test]
fn import_refusals_serialize_with_their_code() {
    let square = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let mut dangling = border(1.0, 1.0);
    dangling.push(segment([0.5, 0.0], [0.5, 0.7], VALLEY));
    let refusals = [
        ImportedPattern::new(&sheet_input(Vec::new()), empty()).err(),
        ImportedPattern::new(&sheet_input(border(2.0, 1.0)), ImportTarget::After(&square)).err(),
        ImportedPattern::new(&sheet_input(dangling), empty()).err(),
    ];
    assert!(refusals.iter().all(Option::is_some));
    for r in refusals.into_iter().flatten() {
        let json = serde_json::to_value(&r).unwrap_or_default();
        assert_eq!(json["code"], r.code(), "{json}");
    }
}

/// A `cells × cells` grid of valley precreases on the unit square, every
/// line whole from border to border: `cells²` faces, none folded, so nothing
/// overlaps and the count alone is what an import weighs.
fn precrease_grid(cells: usize) -> Vec<ImportSegment> {
    let mut segments = border(1.0, 1.0);
    for k in 1..cells {
        let at = k as f64 / cells as f64;
        segments.push(segment([at, 0.0], [at, 1.0], flat(Letter::Valley)));
        segments.push(segment([0.0, at], [1.0, at], flat(Letter::Valley)));
    }
    segments
}

#[test]
fn a_pattern_over_the_face_cap_is_refused_once_its_faces_are_counted() {
    let cap = oristudio_layer_order::MAX_FACES;
    assert_eq!(cap, 64 * 64, "the grid below sits at the cap");
    // At the cap: the pattern's faces are built, and its order with them.
    let at = imported(&sheet_input(precrease_grid(64)), empty());
    assert_eq!(at.summary().faces, cap);
    assert_eq!(at.unordered().view().faces().len(), cap);

    // One diagonal more splits a cell: one face over. Into an empty
    // sequence and after a state alike, as a replay imports it.
    let mut over = precrease_grid(64);
    over.push(segment(
        [0.0, 0.0],
        [1.0 / 64.0, 1.0 / 64.0],
        flat(Letter::Valley),
    ));
    let over = sheet_input(over);
    let square = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    for target in [empty(), ImportTarget::After(&square)] {
        let refusal = ImportedPattern::new(&over, target).err();
        assert_eq!(
            refusal,
            Some(ImportRefusal::TooManyFaces {
                face_count: cap + 1,
                limit: cap
            })
        );
        let json = refusal.map(|r| serde_json::to_value(&r).unwrap_or_default());
        assert_eq!(
            json,
            Some(serde_json::json!({
                "code": "import_too_many_faces", "face_count": cap + 1, "limit": cap
            }))
        );
    }
}

/// `strips` vertical strips of the unit square folded back and forth along
/// lines of alternating letters: every face on one stack, `strips` deep.
fn accordion(strips: usize) -> CreasePatternInput {
    let mut segments = border(1.0, 1.0);
    for k in 1..strips {
        let at = k as f64 / strips as f64;
        let letter = if k % 2 == 0 { MOUNTAIN } else { VALLEY };
        segments.push(segment([at, 0.0], [at, 1.0], letter));
    }
    sheet_input(segments)
}

fn choose3(d: u64) -> u64 {
    d * (d - 1) * (d - 2) / 6
}

#[test]
fn a_pattern_stacked_past_the_cap_is_refused_before_its_order_is_looked_for() {
    let cap = oristudio_layer_order::MAX_STACKED_TRIPLES;
    // The deepest single stack the cap takes: every three of its layers
    // overlap one another.
    let deepest = (3..).take_while(|&d| choose3(d) <= cap).last().unwrap_or(3);
    assert_eq!(deepest, 417, "the accordions below sit at the cap");

    // At the cap: the pattern's faces, view and constraints are built.
    let at = imported(&accordion(417), empty());
    let unordered = at.unordered();
    assert_eq!(unordered.view().faces().len(), 417);
    let depth = unordered.problem().stack_depth(unordered.view());
    assert_eq!((depth.deepest, depth.triples), (417, choose3(417)));

    // One strip more is over: refused as the overlaps are counted, into an
    // empty sequence and after a state alike, as a replay imports it.
    let over = accordion(418);
    let square = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    for target in [empty(), ImportTarget::After(&square)] {
        let refusal = ImportedPattern::new(&over, target).err();
        assert_eq!(
            refusal,
            Some(ImportRefusal::StackedTooDeep {
                deepest: 418,
                triples: choose3(418),
                limit: cap
            })
        );
        let json = refusal.map(|r| serde_json::to_value(&r).unwrap_or_default());
        assert_eq!(
            json,
            Some(serde_json::json!({
                "code": "import_stacked_too_deep",
                "deepest": 418,
                "triples": choose3(418),
                "limit": cap
            }))
        );
    }
}

/// A plain fold of all layers along a line through a vertex image at a
/// sixteenth of a turn, or through two vertex images.
fn random_fold(state: &State, rng: &mut Rng) -> Option<oristudio_fold::PlainFold> {
    let images: Vec<Point> = (0..state.vertices().len())
        .filter_map(|v| state.vertex_image(oristudio_fold::VertexId(v as u32)))
        .collect();
    let p = images[rng.below(images.len())];
    let line = if rng.next_f64() < 0.5 {
        at_angle(p, 11.25 * rng.below(16) as f64)
    } else {
        let q = images[rng.below(images.len())];
        if (p[0] - q[0]).hypot(p[1] - q[1]) < 1e-3 {
            return None;
        }
        through(p, q)
    };
    let side = if rng.next_f64() < 0.5 {
        oristudio_fold::Side::Positive
    } else {
        oristudio_fold::Side::Negative
    };
    let direction = if rng.next_f64() < 0.5 {
        Direction::Valley
    } else {
        Direction::Mountain
    };
    Some(oristudio_fold::PlainFold::new(line, side, direction))
}

#[test]
fn random_folded_states_round_trip_through_their_crease_patterns() {
    // Every landed state of seeded plain-fold sequences, exported as its
    // crease pattern and imported after itself: the stored order replays to
    // the same state, every face where it was, and the letters alone offer
    // that order among their choices whenever the search lists them all.
    // On 2026-10-08 that was 129 states of 2 to 52 faces, every one listed in
    // full, in under two seconds in a debug build.
    let mut rng = Rng::new(0x5eed_1a90);
    let (mut checked, mut listed) = (0, 0);
    for sequence in 0..24 {
        let sheet = if sequence % 3 == 2 {
            Sheet::rectangle(1.0, 0.6 + 0.3 * rng.next_f64()).unwrap_or_else(|e| panic!("{e}"))
        } else {
            Sheet::square()
        };
        let mut state = State::flat(sheet, StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
        for _ in 0..12 {
            let Some(op) = random_fold(&state, &mut rng) else {
                continue;
            };
            let landed = if rng.next_f64() < 0.25 {
                state.precrease(&op)
            } else {
                state.fold(&op)
            };
            let Ok(folded) = landed else {
                continue;
            };
            state = folded.state;
            if rng.next_f64() < 0.2 {
                state = state.turn_over();
            }

            let input = CreasePatternInput::of_state(&state);
            let pattern = imported(&input, ImportTarget::After(&state));
            assert_eq!(pattern.summary().faces, state.faces().len());
            let stored = WitnessOrder::of_state(&state).unwrap_or_else(|| unreachable!());
            let jumped = pattern
                .replay(&stored, &limits())
                .unwrap_or_else(|e| panic!("sequence {sequence}: {e}"));
            assert!(same_order(&state, &jumped), "sequence {sequence}");
            assert!(letters_reproduced(&input, &jumped), "sequence {sequence}");
            for f in state.faces() {
                let p = state.face_witness(f.id).unwrap_or_else(|| unreachable!());
                let (a, b) = (
                    state.image_of(p).unwrap_or_default(),
                    jumped.image_of(p).unwrap_or_default(),
                );
                assert!(
                    (a[0] - b[0]).hypot(a[1] - b[1]) < 1e-9,
                    "sequence {sequence}"
                );
            }
            let budget = CompletionLimits {
                max_nodes: Some(20_000),
                ..limits()
            };
            if let Ok(completions) = pattern.complete(&budget)
                && completions.count().exact
            {
                assert!(
                    completions.choice_of(jumped.order()).is_some(),
                    "sequence {sequence}: the state's own order is not offered"
                );
                listed += 1;
            }
            checked += 1;
        }
    }
    assert!(checked >= 100, "only {checked} states");
    assert!(listed * 2 >= checked, "only {listed} of {checked} listed");
}
