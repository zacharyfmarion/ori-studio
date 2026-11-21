//! A swivel on one wall of a folded sheet. The reverse line goes through
//! the swivel vertex, separating two of its plies from the main flap.
mod support;

use oristudio_fold::{
    Direction, ReverseChoices, ReverseFold, ReverseKind, ReverseOutcome, Seed, Sheet, StartSide,
    State, SwivelByEdge, SwivelKind, VertexChoices, VertexOutcome,
};
use support::*;

fn pleated_wall() -> State {
    let square = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let diagonal = through([0.0, 0.5], [0.5, 0.0]);
    let corner = fold(&square, &all(diagonal, [0.0, 0.0], Direction::Valley)).state;
    // Bisect the left corner flap, then swivel its free edge onto the diagonal.
    let bisector = at_angle([0.5, 0.0], 112.5);
    let flap = all(bisector, [0.5, 0.5], Direction::Valley).with_seed(Seed::Flaps {
        at: vec![[0.125, 0.125]],
    });
    let doubled = fold(&corner, &flap).state;
    let grip = [0.125, 0.375 * (std::f64::consts::PI / 8.0).tan()];
    let op = SwivelByEdge {
        pivot: [0.5 - grip[1], 0.5 - grip[0]],
        fold: Some(grip),
        edge: [0.0, 0.35],
        target: diagonal,
        direction: Direction::Valley,
        ridge: None,
        layers: Seed::All,
        kind: SwivelKind::Open,
    };
    let VertexOutcome::Landed(pleat) = doubled
        .swivel_by_edge(&op, &VertexChoices::default())
        .unwrap()
    else {
        panic!("the swivel has a unique order");
    };
    fold(
        &pleat.state,
        &all(y_eq(0.5), [0.5, 0.9], Direction::Mountain),
    )
    .state
}

fn assert_reverse(parent: &State) {
    let line = through([0.0, 0.0], [0.5, 0.5]);
    let op = ReverseFold {
        line,
        side: side(&line, [0.0, 0.5]),
        kind: ReverseKind::Inside,
        anchor: Seed::All,
    };
    let analysis = parent.analyse_reverse(&op).unwrap();
    assert_eq!(analysis.flaps.len(), 2);
    let pocket = analysis
        .flaps
        .iter()
        .flat_map(|f| &f.openings)
        .find(|o| {
            o.spine.is_some_and(|s| {
                s.distance_to_point([0., 0.5]) < 1e-9 && s.distance_to_point([1., 0.5]) < 1e-9
            })
        })
        .unwrap();
    let choices = ReverseChoices {
        openings: vec![pocket.stored.clone()],
        order: None,
    };
    assert_eq!(
        parent.reverse_kinds(&op, &choices).unwrap(),
        vec![ReverseKind::Inside]
    );
    let ReverseOutcome::Landed(folded) = parent.reverse_fold(&op, &choices).unwrap() else {
        panic!("the pleated wall reverses into the pocket with one order");
    };
    assert_valid(&folded.state);
    assert_eq!(folded.report.openings.len(), 1);
    assert_eq!(folded.report.openings[0].stored, pocket.stored);
    assert_eq!(folded.report.fold.reversed.len(), 1);
    let spine = folded.state.crease(folded.report.fold.reversed[0]).unwrap();
    assert!(
        spine
            .vertices
            .iter()
            .all(|v| (folded.state.vertices()[v.0 as usize][1] - 0.5).abs() < 1e-9)
    );
    // Where the tip overlaps the body, compare the actual material in
    // stack order. The pleated half of the original sheet is on top.
    let tip = [0.24, 0.27];
    let body = line.reflect_point(tip);
    let stack = |state: &State, p| -> Vec<_> {
        state
            .stack_at(p)
            .unwrap()
            .into_iter()
            .map(|f| {
                let sheet = state.isometry(f).unwrap().inverse().apply(p);
                (sheet[1] < 0.5, sheet.map(|x| (x * 1e9).round() as i64))
            })
            .collect()
    };
    let body_stack = stack(parent, body);
    let tip_stack = stack(parent, tip);
    assert_eq!(tip_stack.iter().filter(|(upper, _)| *upper).count(), 5);
    let mut expected = Vec::new();
    expected.extend(body_stack.iter().filter(|(upper, _)| *upper));
    for wall in [true, false] {
        expected.extend(tip_stack.iter().rev().filter(|(upper, _)| *upper == wall));
    }
    expected.extend(body_stack.iter().filter(|(upper, _)| !*upper));
    assert_eq!(stack(&folded.state, body), expected);

    let ReverseOutcome::Landed(replayed) = parent.reverse_fold(&op, &folded.report.stored).unwrap()
    else {
        panic!("stored reverse must land")
    };
    assert_eq!(replayed.state.parts(), folded.state.parts());
}

#[test]
fn a_pleat_ending_at_the_reverse_hinge_turns_with_its_wall() {
    assert_reverse(&pleated_wall());
}

#[test]
fn a_precrease_through_the_vertex_preserves_the_same_pocket() {
    let parent = pleated_wall();
    let line = through([0.0, 0.0], [0.5, 0.5]);
    let scored = precrease(&parent, &all(line, [0.0, 0.5], Direction::Valley));
    assert_reverse(&scored.state);
}
