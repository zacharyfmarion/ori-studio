//! Adjust order (`implementation-plans/fold-adjust-order.md`): a step that
//! keeps its parent's paper and chooses the order again, on a hand-built
//! crease pattern with a real choice — a square whose left and right strips
//! are folded in along x = 0.3 and x = 0.7 and overlap in the middle, so
//! either strip can lie on top, with a precrease across them both.
//!
//! What holds:
//!
//! - the step keeps every vertex, crease (with the step that made it), face
//!   (with its lineage), crease mark, root and view, one step on;
//! - a stored order lands that order on the parent's paper, and the order a
//!   state stores of itself lands it again;
//! - seeds that decide every pair land the order they say; seeds that leave
//!   a choice, or a stored order that no longer names the faces, are refused,
//!   never guessed.

use oristudio_fold::{
    Broken, CompletionLimits, CreasePatternInput, FaceId, FixedKind, FixedPair, ImportKind,
    ImportSegment, ImportSpace, ImportTarget, ImportedPattern, Letter, Reordering, StartSide,
    State, WitnessOrder, reorder,
};

type Point = [f64; 2];

fn segment(from: Point, to: Point, kind: ImportKind) -> ImportSegment {
    ImportSegment { from, to, kind }
}

/// The two strips folded in, overlapping over [0.4, 0.6], with a valley
/// precrease along y = 0.5 across all three panels.
fn two_strips() -> ImportedPattern {
    let c: [Point; 4] = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
    let mut segments: Vec<ImportSegment> = (0..4)
        .map(|i| segment(c[i], c[(i + 1) % 4], ImportKind::Border))
        .collect();
    segments.push(segment([0.3, 0.0], [0.3, 1.0], ImportKind::Valley));
    segments.push(segment([0.7, 0.0], [0.7, 1.0], ImportKind::Valley));
    segments.push(segment(
        [0.0, 0.5],
        [1.0, 0.5],
        ImportKind::Unassigned {
            hint: Some(Letter::Valley),
        },
    ));
    let input = CreasePatternInput {
        space: ImportSpace::Sheet,
        segments,
    };
    ImportedPattern::new(
        &input,
        ImportTarget::Empty {
            start: StartSide::Front,
        },
    )
    .unwrap_or_else(|e| panic!("{} {e}", e.code()))
}

/// The pattern's two states: the left strip on top, and the right one.
fn both_orders() -> [State; 2] {
    let pattern = two_strips();
    let completions = pattern
        .complete(&CompletionLimits::default())
        .unwrap_or_else(|e| panic!("{} {e}", e.code()));
    assert_eq!(completions.count().orders, 2, "the strips' two orders");
    let sizes: Vec<usize> = completions
        .components()
        .iter()
        .map(|c| c.orders.len())
        .collect();
    let choice =
        |k: usize| -> Vec<usize> { sizes.iter().map(|&n| if n > 1 { k } else { 0 }).collect() };
    let [a, b] = [0, 1].map(|k| {
        let order = completions.order(&choice(k)).unwrap_or_default();
        pattern
            .state(order)
            .unwrap_or_else(|e| panic!("{} {e}", e.code()))
    });
    let (left, right) = (face_at(&a, [0.15, 0.25]), face_at(&a, [0.85, 0.25]));
    if a.above(left, right) == Some(true) {
        [a, b]
    } else {
        [b, a]
    }
}

fn face_at(state: &State, p: Point) -> FaceId {
    state
        .face_at(p)
        .unwrap_or_else(|| panic!("no face at {p:?}"))
}

/// Whether the left strip lies above the right one, at both halves of the precrease.
fn left_on_top(state: &State) -> [Option<bool>; 2] {
    [0.25, 0.75].map(|y| state.above(face_at(state, [0.15, y]), face_at(state, [0.85, y])))
}

fn limits() -> CompletionLimits {
    CompletionLimits::default()
}

#[test]
fn a_reordering_keeps_the_paper_and_lands_the_stored_order() {
    let [left, right] = both_orders();
    assert_eq!(left_on_top(&left), [Some(true); 2]);
    assert_eq!(left_on_top(&right), [Some(false); 2]);
    let stored = WitnessOrder::of_state(&right).expect("witnesses");
    let landed = reorder(&left, &stored, &limits()).unwrap_or_else(|e| panic!("{e}"));
    // The order the right-on-top state stores, on the left-on-top state's paper.
    assert_eq!(left_on_top(&landed), [Some(false); 2]);
    assert_eq!(landed.order(), right.order());
    // Everything else is the parent's, one step on.
    assert_eq!(landed.step(), left.step() + 1);
    assert_eq!(landed.vertices(), left.vertices());
    assert_eq!(landed.creases(), left.creases());
    assert_eq!(landed.faces(), left.faces());
    assert_eq!(landed.crease_marks(), left.crease_marks());
    assert_eq!(landed.root(), left.root());
    assert_eq!(landed.view(), left.view());
    for face in left.faces() {
        assert_eq!(
            landed.isometry(face.id),
            left.isometry(face.id),
            "face {}",
            face.id
        );
    }
    // A state's own order lands it again.
    let own = WitnessOrder::of_state(&left).expect("witnesses");
    let again = reorder(&left, &own, &limits()).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(again.order(), left.order());
}

#[test]
fn seeds_that_decide_every_pair_land_their_order_and_others_are_refused() {
    let [left, _] = both_orders();
    let reordering = Reordering::of(&left).unwrap_or_else(|e| panic!("{e}"));
    // With no seeds, the letters leave the strips' choice: refused, not guessed.
    match reordering.decided_by(&[], &limits()) {
        Err(Broken::NotUnique { orders }) => assert_eq!(orders.orders, 2),
        other => panic!("{other:?}"),
    }
    // The right strip above the left one at both halves decides the rest.
    let seeds: Vec<FixedPair> = [0.25, 0.75]
        .map(|y| FixedPair {
            upper: face_at(&left, [0.85, y]),
            lower: face_at(&left, [0.15, y]),
            kind: FixedKind::Seed,
        })
        .to_vec();
    let landed = reordering
        .decided_by(&seeds, &limits())
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(left_on_top(&landed), [Some(false); 2]);
    assert_eq!(landed.creases(), left.creases());
    // One half one way and the other the other way tears the strip along its precrease.
    let torn = [
        seeds[0],
        FixedPair {
            upper: seeds[1].lower,
            lower: seeds[1].upper,
            kind: FixedKind::Seed,
        },
    ];
    assert!(matches!(
        reordering.decided_by(&torn, &limits()),
        Err(Broken::Completion { .. })
    ));
}

#[test]
fn a_stored_order_whose_witness_lies_off_the_paper_is_broken() {
    let [left, right] = both_orders();
    let mut text = serde_json::to_value(WitnessOrder::of_state(&right).expect("witnesses"))
        .unwrap_or_default();
    // Move the first witness off the sheet.
    text["faces"][0] = serde_json::json!([5.0, 5.0]);
    let moved: WitnessOrder = serde_json::from_value(text).unwrap_or_else(|e| panic!("{e}"));
    assert!(matches!(
        reorder(&left, &moved, &limits()),
        Err(Broken::Witness { .. })
    ));
}
