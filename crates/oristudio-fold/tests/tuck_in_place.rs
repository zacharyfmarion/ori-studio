//! A tuck in place (`compound::tuck_in_place`): a flap already folded along
//! a line keeps its place and every crease, and only its order against the
//! paper that stays changes. Two strips folded over one another on a square:
//! the top strip tucked under the bottom one by its hinge (`InPlace::Flap`),
//! and the bottom strip, its corner folded onto it, tucked under the top one
//! by that corner's fold (`InPlace::Fold`). Each lands what an unfold and a
//! fold against the layer, or the flap read by its hinge, land; each keeps
//! every face's image and every crease; and each is listed by a valley's
//! layer-order chooser along the folded edge.

mod compound;
mod support;

use oristudio_fold::{
    CompletionLimits, CompoundRefused, Direction, FoldLanding, FoldPlacementSearch, FoldRefusal,
    InPlace, PlainFold, Seed, Sheet, StartSide, State, TuckChoices, TuckFold, TuckFolded,
    TuckInPlace, TuckOutcome, TuckSide,
};
use oristudio_geometry::Line;
use support::*;

fn square() -> State {
    State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"))
}

/// The bottom strip up (`U`, y in [0.3, 0.6]), then the top strip down over
/// it and the body (`T`, y in [0.3, 0.65]).
fn strips() -> State {
    let up = fold(&square(), &all(y_eq(0.3), [0.5, 0.1], Direction::Valley)).state;
    fold(&up, &all(y_eq(0.65), [0.5, 0.9], Direction::Valley)).state
}

/// The top strip down (`T`), then the bottom strip up over it (`U`), and
/// U's top-left corner folded down onto U (`C`).
fn cornered() -> State {
    let down = fold(&square(), &all(y_eq(0.65), [0.5, 0.9], Direction::Valley)).state;
    let up = fold(&down, &all(y_eq(0.3), [0.5, 0.1], Direction::Valley)).state;
    let corner =
        all(corner_line(), [0.02, 0.58], Direction::Valley).with_seed(Seed::Flaps { at: vec![C] });
    fold(&up, &corner).state
}

/// U's corner fold, through (0, 0.5) and (0.1, 0.6).
fn corner_line() -> Line {
    through([0.0, 0.5], [0.1, 0.6])
}

/// Sheet points inside T, U, C and the body.
const T: Point = [0.5, 0.8];
const U: Point = [0.5, 0.15];
const C: Point = [0.02, 0.02];
const BODY: Point = [0.5, 0.5];

fn in_place(
    line: Line,
    toward: Point,
    direction: Direction,
    seed: Point,
    moves: InPlace,
    target: Point,
) -> TuckInPlace {
    TuckInPlace {
        line,
        side: side(&line, toward),
        direction,
        seed: Seed::Flaps { at: vec![seed] },
        moves,
        target,
        additional_targets: Vec::new(),
    }
}

/// Every check on a landed tuck in place: the full gate from scratch, the
/// motion's endpoints, every face where it was with every crease as it was,
/// the order changed, and replay from what the step stores.
fn landed(parent: &State, op: &TuckInPlace) -> TuckFolded {
    let folded = match parent.tuck_in_place(op, &TuckChoices::default()) {
        Ok(TuckOutcome::Landed(folded)) => *folded,
        Ok(TuckOutcome::ChooseOrder(choice)) => {
            panic!("{op:?}: choose an order of {:?}", choice.count())
        }
        Err(e) => panic!("{op:?}: {e} {e:?}"),
    };
    let state = &folded.state;
    assert_valid(state);
    compound::assert_motion(parent, state, &folded.report.motion);
    assert_eq!(state.faces().len(), parent.faces().len());
    for face in parent.faces() {
        assert_eq!(
            state.isometry(face.id),
            parent.isometry(face.id),
            "{}",
            face.id
        );
    }
    let kinds = |s: &State| {
        s.creases()
            .iter()
            .map(|c| (c.id, c.kind))
            .collect::<Vec<_>>()
    };
    assert_eq!(kinds(state), kinds(parent));
    assert_ne!(state.order(), parent.order());
    assert!(folded.report.fold.created.is_empty());
    let again = match parent.tuck_in_place(op, &folded.report.stored) {
        Ok(TuckOutcome::Landed(again)) => again,
        other => panic!("replay: {:?}", other.err()),
    };
    assert_eq!(again.state.parts(), state.parts());
    folded
}

fn refusal(parent: &State, op: &TuckInPlace) -> FoldRefusal {
    match parent.tuck_in_place(op, &TuckChoices::default()) {
        Err(CompoundRefused::Refused(refused)) => refused.refusal,
        Err(CompoundRefused::Broken(broken)) => panic!("{op:?}: broken {broken}"),
        Ok(_) => panic!("{op:?} landed"),
    }
}

#[test]
fn a_flap_tucked_in_place_by_its_hinge_slides_under_the_layer() {
    let parent = strips();
    let (t, u, body) = (face(&parent, T), face(&parent, U), face(&parent, BODY));
    assert!(above(&parent, t, u));
    let op = in_place(
        y_eq(0.65),
        [0.5, 0.5],
        Direction::Valley,
        T,
        InPlace::Flap,
        U,
    );
    let folded = landed(&parent, &op);
    let state = &folded.state;
    assert_eq!(folded.report.placement, TuckSide::Under);
    assert_eq!(folded.report.fold.moving, vec![t]);
    assert!(above(state, u, t), "T under U");
    assert!(above(state, t, body), "T over the body");
}

#[test]
fn by_its_hinge_it_lands_as_an_unfold_and_a_tuck_against_the_layer() {
    let parent = strips();
    let tucked = landed(
        &parent,
        &in_place(
            y_eq(0.65),
            [0.5, 0.5],
            Direction::Valley,
            T,
            InPlace::Flap,
            U,
        ),
    );
    // The same flap laid flat again, then folded back down and tucked under U.
    let seed = Seed::Flaps { at: vec![T] };
    let flat = fold(
        &parent,
        &all(y_eq(0.65), [0.5, 0.5], Direction::Valley).with_seed(seed.clone()),
    )
    .state;
    let back = TuckFold {
        line: y_eq(0.65),
        side: side(&y_eq(0.65), [0.5, 0.9]),
        direction: Direction::Valley,
        seed,
        target: U,
        additional_targets: Vec::new(),
    };
    let refolded = match flat.tuck_fold(&back, &TuckChoices::default()) {
        Ok(TuckOutcome::Landed(folded)) => folded.state,
        other => panic!("unfold, then tuck: {:?}", other.err()),
    };
    assert_eq!(refolded.order(), tucked.state.order());
    let letters = |s: &State| s.creases().iter().map(|c| c.kind).collect::<Vec<_>>();
    assert_eq!(letters(&refolded), letters(&tucked.state));
}

#[test]
fn a_fold_tucked_in_place_takes_both_its_layers_where_its_flap_cannot_go() {
    let parent = cornered();
    let (t, u, c, body) = (
        face(&parent, T),
        face(&parent, U),
        face(&parent, C),
        face(&parent, BODY),
    );
    assert!(above(&parent, c, u) && above(&parent, u, t));
    // The corner alone cannot go under T: T would lie inside its fold.
    let alone = in_place(
        corner_line(),
        [0.5, 0.45],
        Direction::Valley,
        C,
        InPlace::Flap,
        T,
    );
    assert!(
        matches!(refusal(&parent, &alone), FoldRefusal::TuckInfeasible { .. }),
        "the corner alone"
    );
    // Its fold — the corner and the strip it is folded onto — goes under T.
    let op = in_place(
        corner_line(),
        [0.5, 0.45],
        Direction::Valley,
        C,
        InPlace::Fold,
        T,
    );
    let folded = landed(&parent, &op);
    let state = &folded.state;
    let mut moving = vec![u, c];
    moving.sort_unstable();
    assert_eq!(folded.report.fold.moving, moving);
    assert!(
        above(state, t, c) && above(state, c, u),
        "T over the corner over U"
    );
    assert!(above(state, u, body), "U over the body");
    // Read by the strip's own hinge, the same paper moves, and lands the same.
    let by_hinge = in_place(
        y_eq(0.3),
        [0.5, 0.45],
        Direction::Valley,
        U,
        InPlace::Flap,
        T,
    );
    assert_eq!(landed(&parent, &by_hinge).state.order(), state.order());
}

#[test]
fn a_line_along_no_folded_edge_of_the_flap_is_refused() {
    let parent = strips();
    // T's sheet point (0.5, 0.9) lies at y = 0.4 once folded, below the line.
    let op = in_place(
        y_eq(0.5),
        [0.5, 0.4],
        Direction::Valley,
        [0.5, 0.9],
        InPlace::Flap,
        U,
    );
    let refused = refusal(&parent, &op);
    assert!(
        matches!(&refused, FoldRefusal::TuckNotAtFold { faces } if *faces == [face(&parent, T)]),
        "{refused:?}"
    );
    assert_eq!(refused.code(), "tuck_not_at_fold");
    // A target that would move with the flap.
    let moves = in_place(
        y_eq(0.65),
        [0.5, 0.5],
        Direction::Valley,
        T,
        InPlace::Flap,
        T,
    );
    assert!(matches!(
        refusal(&parent, &moves),
        FoldRefusal::TuckTargetMoves { .. }
    ));
}

/// A valley's placement search to the end.
fn search(parent: &State, op: &PlainFold) -> FoldPlacementSearch {
    let mut search = FoldPlacementSearch::new(parent, op);
    for _ in 0..100 {
        search.advance(&CompletionLimits::default(), 128, 1024);
        if search.count().exact {
            return search;
        }
    }
    panic!("the placement search did not finish");
}

#[test]
fn a_valley_along_the_folded_edge_lists_its_tucks_in_place() {
    let parent = cornered();
    let op =
        all(corner_line(), [0.5, 0.45], Direction::Valley).with_seed(Seed::Flaps { at: vec![C] });
    let found = search(&parent, &op);
    let expected = landed(
        &parent,
        &in_place(
            corner_line(),
            [0.5, 0.45],
            Direction::Valley,
            C,
            InPlace::Fold,
            T,
        ),
    );
    let in_place: Vec<_> = found
        .candidates()
        .iter()
        .filter(|c| matches!(c.landing, FoldLanding::InPlace { .. }))
        .collect();
    assert!(!in_place.is_empty());
    let hit = in_place
        .iter()
        .find(|c| c.state.order() == expected.state.order())
        .unwrap_or_else(|| {
            panic!(
                "{:?}",
                in_place.iter().map(|c| &c.landing).collect::<Vec<_>>()
            )
        });
    assert!(matches!(
        hit.landing,
        FoldLanding::InPlace {
            moves: InPlace::Fold,
            ..
        }
    ));
    for candidate in found.candidates() {
        assert_valid(&candidate.state);
    }
    // A fold along a line with no fold there lists none.
    let fresh =
        all(y_eq(0.5), [0.5, 0.45], Direction::Valley).with_seed(Seed::Flaps { at: vec![T] });
    assert!(
        search(&strips(), &fresh)
            .candidates()
            .iter()
            .all(|c| !matches!(c.landing, FoldLanding::InPlace { .. }))
    );
}

#[test]
fn the_landing_round_trips_through_its_serde_spelling() {
    let landing = FoldLanding::InPlace {
        targets: vec![[0.25, 0.5]],
        moves: InPlace::Fold,
    };
    let text = serde_json::to_string(&landing).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(
        text,
        r#"{"kind":"in_place","targets":[[0.25,0.5]],"moves":"fold"}"#
    );
    let back: FoldLanding = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(back, landing);
}
