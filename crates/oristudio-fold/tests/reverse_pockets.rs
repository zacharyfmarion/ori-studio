//! A folded pocket can have a bent boundary. The two front corner flaps
//! below cover disjoint halves of one continuous back panel: opening either
//! edge alone puts the other front panel into the back block.
mod support;

use oristudio_fold::{
    Direction, ReverseChoices, ReverseFold, ReverseKind, ReverseOutcome, Seed, Sheet, StartSide,
    State, TurnAxis,
};
use support::*;

fn roof_from(mut paper: State) -> State {
    for (edge, toward) in [([0.0, 0.5], [0.0, 1.0]), ([1.0, 0.5], [1.0, 1.0])] {
        paper = fold(
            &paper,
            &all(through([0.5, 1.0], edge), toward, Direction::Valley),
        )
        .state;
    }
    paper
}

fn operation() -> ReverseFold {
    ReverseFold {
        line: y_eq(0.75),
        side: side(&y_eq(0.75), [0.5, 1.0]),
        anchor: Seed::All,
        kind: ReverseKind::Inside,
    }
}

fn reverse_pocket(state: &State) -> State {
    let op = operation();
    let analysis = state.analyse_reverse(&op).unwrap();
    assert_eq!(analysis.flaps.len(), 1);
    let openings = &analysis.flaps[0].openings;
    assert_eq!(
        openings.len(),
        1,
        "the front halves border one pocket: {openings:?}"
    );
    assert!(!analysis.flaps[0].truncated);
    assert!(openings[0].spine.is_none());
    // Precreases can subdivide each of the two hinges, but both slopes must
    // reverse. Checking actual layer order below catches mixed/plain folds.
    assert!(openings[0].across.len() >= 2);
    let ReverseOutcome::Landed(folded) =
        state.reverse_fold(&op, &ReverseChoices::default()).unwrap()
    else {
        panic!("one connected pocket must land without an opening/order chooser");
    };
    assert_valid(&folded.state);
    assert_eq!(folded.report.fold.reversed.len(), openings[0].across.len());
    assert!(folded.report.stored.openings.is_empty());
    for x in [0.45, 0.55] {
        let tip = state.stack_at([x, 0.85]).unwrap();
        let body = state.stack_at([x, 0.65]).unwrap();
        assert_eq!(tip.len(), 2);
        assert_eq!(body.len(), 2);
        let stack = folded.state.stack_at([x, 0.65]).unwrap();
        let material: Vec<_> = stack
            .iter()
            .map(|&f| {
                // Use the exact probe, not the face's centroid (precreases can
                // split faces elsewhere without changing the local stack).
                let sheet = folded.state.isometry(f).unwrap().inverse().apply([x, 0.65]);
                let parent = state.face_at(sheet).unwrap();
                let was_moving = state.isometry(parent).unwrap().apply(sheet)[1] > 0.75;
                (parent, was_moving)
            })
            .collect();
        assert_eq!(
            material,
            vec![
                (body[0], false),
                (tip[0], true),
                (tip[1], true),
                (body[1], false)
            ]
        );
    }
    let ReverseOutcome::Landed(replayed) = state.reverse_fold(&op, &folded.report.stored).unwrap()
    else {
        panic!("saved pocket failed to replay");
    };
    assert_eq!(folded.state.parts(), replayed.state.parts());
    folded.state
}

#[test]
fn the_two_sides_of_one_pocket_reverse_together() {
    let roof = roof_from(State::flat(Sheet::square(), StartSide::Front).unwrap());
    reverse_pocket(&roof);
}

#[test]
fn precreases_and_view_changes_do_not_split_the_pocket() {
    let mut sheet = State::flat(Sheet::square(), StartSide::Front).unwrap();
    for line in [x_eq(0.5), y_eq(0.875), x_eq(0.375)] {
        sheet = precrease(&sheet, &all(line, [0.1, 0.1], Direction::Valley)).state;
    }
    let roof = roof_from(sheet);
    let folded = reverse_pocket(&roof);
    for view in [roof.rotate(0.7), roof.turn_over_about(TurnAxis::Vertical)] {
        let result = reverse_pocket(&view);
        assert_eq!(result.vertices(), folded.vertices());
        let faces = |s: &State| {
            s.faces()
                .iter()
                .map(|f| (f.id, f.ring.clone()))
                .collect::<Vec<_>>()
        };
        let creases = |s: &State| {
            s.creases()
                .iter()
                .map(|c| (c.vertices, c.kind))
                .collect::<Vec<_>>()
        };
        assert_eq!(faces(&result), faces(&folded));
        assert_eq!(creases(&result), creases(&folded));
        assert_eq!(result.order(), folded.order());
    }
}
