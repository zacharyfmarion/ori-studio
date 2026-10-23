mod beloch;
mod support;
mod vertex;
use oristudio_fold::{
    CompoundRefused, Direction, FoldRefusal, Letter, State, SwivelByEdge, SwivelKind,
    SwivelValleyMountain, VertexChoices, VertexFolded,
};
use oristudio_geometry::Line;
use vertex::cases;

/// Two landed states are one: the same vertices, creases and layer order.
fn same(a: &State, b: &State) -> bool {
    a.vertices().len() == b.vertices().len()
        && a.vertices()
            .iter()
            .zip(b.vertices())
            .all(|(p, q)| support::close(*p, *q))
        && a.creases().len() == b.creases().len()
        && a.creases()
            .iter()
            .zip(b.creases())
            .all(|(c, d)| c.kind == d.kind && c.vertices == d.vertices)
        && a.order() == b.order()
}

fn landed(state: &State, op: &SwivelValleyMountain) -> Vec<VertexFolded> {
    cases::every(state.swivel_valley_mountain(op, &VertexChoices::default()))
}

/// The valley and the mountain a swivel by its edge makes on the layer that
/// faces the viewer: its other layer's two creases, by their letters as seen.
fn front_pair(state: &State, op: &SwivelByEdge) -> (Line, Line) {
    let a = state.analyse_swivel_by_edge(op).unwrap();
    let line = |k: usize| Line::from_point_direction(a.vertex, a.creases[k].direction).unwrap();
    match a.creases[1].letter {
        Letter::Valley => (line(1), line(2)),
        Letter::Mountain => (line(2), line(1)),
    }
}

#[test]
fn every_classic_swivel_on_a_folded_edge_is_its_valley_and_its_mountain() {
    let mut compared = 0;
    for c in cases::fold_swivel_cases() {
        for kind in [SwivelKind::Open, SwivelKind::Inside] {
            let edge = SwivelByEdge {
                kind,
                ..c.op.clone()
            };
            let expected = cases::every(c.state.swivel_by_edge(&edge, &VertexChoices::default()));
            if expected.is_empty() {
                continue;
            }
            let (valley, mountain) = front_pair(&c.state, &edge);
            let op = SwivelValleyMountain {
                valley,
                mountain,
                kind,
            };
            let analysis = c.state.analyse_swivel_valley_mountain(&op).unwrap();
            let by_edge = c.state.analyse_swivel_by_edge(&edge).unwrap();
            assert!(
                support::close(analysis.vertex, by_edge.vertex),
                "{}",
                c.name
            );
            let actual = landed(&c.state, &op);
            assert_eq!(actual.len(), expected.len(), "{} {kind:?}", c.name);
            for (a, b) in actual.iter().zip(&expected) {
                support::assert_valid(&a.state);
                assert!(same(&a.state, &b.state), "{} {kind:?}", c.name);
            }
            compared += 1;
        }
    }
    // Three swivels, each open and inside.
    assert_eq!(compared, 6);
}

/// The square valley folded on x = 1/2, the right half over the left: a
/// folded edge along x = 1/2, the front layer the half that moved.
fn folded_square() -> State {
    use support::*;
    let flat = State::flat(
        oristudio_fold::Sheet::square(),
        oristudio_fold::StartSide::Front,
    )
    .unwrap();
    fold(&flat, &all(x_eq(0.5), [0.8, 0.5], Direction::Valley)).state
}

#[test]
fn a_valley_and_a_mountain_on_the_front_layer_land_and_replay() {
    let state = folded_square();
    let low = Line::from_points([0.5, 0.5], [0.05, 0.1]).unwrap();
    let high = Line::from_points([0.5, 0.5], [0.1, 0.8]).unwrap();
    let mut landed_any = false;
    for (valley, mountain) in [(low, high), (high, low)] {
        for kind in [SwivelKind::Open, SwivelKind::Inside] {
            let op = SwivelValleyMountain {
                valley,
                mountain,
                kind,
            };
            let folds = landed(&state, &op);
            for folded in &folds {
                support::assert_valid(&folded.state);
                let replay = cases::every(state.swivel_valley_mountain(&op, &folded.report.stored));
                assert!(same(&replay[0].state, &folded.state));
            }
            landed_any |= !folds.is_empty();
        }
    }
    assert!(landed_any);
}

#[test]
fn the_crease_behind_is_computed_and_hidden_behind_the_front_layer() {
    let state = folded_square();
    let op = SwivelValleyMountain {
        valley: Line::from_points([0.5, 0.5], [0.1, 0.8]).unwrap(),
        mountain: Line::from_points([0.5, 0.5], [0.05, 0.1]).unwrap(),
        kind: SwivelKind::Open,
    };
    let a = state.analyse_swivel_valley_mountain(&op).unwrap();
    assert!(support::close(a.vertex, [0.5, 0.5]));
    let behind = &a.creases[0];
    assert!(behind.hidden && behind.letter == Letter::Valley);
    let named: Vec<_> = a.creases.iter().filter(|c| !c.hidden).collect();
    let letters: Vec<Letter> = named.iter().rev().take(2).map(|c| c.letter).collect();
    assert_eq!(letters, vec![Letter::Valley, Letter::Mountain]);
    // The front layer's creases are the two named: open, the hinge is the valley.
    let hinge = a.creases.last().unwrap();
    let toward = |p: [f64; 2]| {
        let d = [p[0] - 0.5, p[1] - 0.5];
        let l = d[0].hypot(d[1]);
        [d[0] / l, d[1] / l]
    };
    assert!(support::close(hinge.direction, toward([0.1, 0.8])));
    assert_eq!(a.layers.len(), 2);
    // s = b − c from the half that opens: strictly between it and the hinge.
    let [c, b] = [a.creases[a.creases.len() - 2].direction, hinge.direction];
    let s = behind.direction;
    let angle =
        |u: [f64; 2], w: [f64; 2]| (u[0] * w[1] - u[1] * w[0]).atan2(u[0] * w[0] + u[1] * w[1]);
    let opens = [
        a.fold.opens[1][0] - a.vertex[0],
        a.fold.opens[1][1] - a.vertex[1],
    ];
    let opens = [
        opens[0] / opens[0].hypot(opens[1]),
        opens[1] / opens[0].hypot(opens[1]),
    ];
    assert!((angle(opens, s) - (angle(opens, b) - angle(opens, c))).abs() < 1e-9);
}

#[test]
fn lines_that_meet_on_no_folded_edge_or_bound_no_flap_are_refused() {
    use support::*;
    let state = folded_square();
    let refusal = |valley: Line, mountain: Line| {
        let op = SwivelValleyMountain {
            valley,
            mountain,
            kind: SwivelKind::Open,
        };
        match state.swivel_valley_mountain(&op, &VertexChoices::default()) {
            Err(CompoundRefused::Refused(r)) => {
                assert_eq!(state.analyse_swivel_valley_mountain(&op).unwrap_err(), r);
                r.refusal
            }
            other => panic!("{other:?}"),
        }
    };
    let low = Line::from_points([0.5, 0.5], [0.05, 0.1]).unwrap();
    // Parallel, and meeting away from the folded edge.
    assert!(matches!(
        refusal(x_eq(0.2), x_eq(0.3)),
        FoldRefusal::SwivelLineMeeting
    ));
    assert!(matches!(
        refusal(x_eq(0.2), y_eq(0.2)),
        FoldRefusal::SwivelLineMeeting
    ));
    // One along the folded edge: no flap between them.
    assert!(matches!(
        refusal(x_eq(0.5), low),
        FoldRefusal::SwivelNoFlap { .. }
    ));
}

#[test]
fn two_existing_precreases_can_meet_at_a_folded_run_subdivision() {
    use support::*;
    let mut state = folded_square();
    let first = Line::from_points([0.5, 0.5], [0.05, 0.1]).unwrap();
    let second = Line::from_points([0.5, 0.5], [0.1, 0.8]).unwrap();
    for line in [first, second] {
        state = precrease(&state, &all(line, [0.1, 0.5], Direction::Valley)).state;
    }
    let mut landed_any = false;
    for (valley, mountain) in [(first, second), (second, first)] {
        for kind in [SwivelKind::Open, SwivelKind::Inside] {
            let op = SwivelValleyMountain {
                valley,
                mountain,
                kind,
            };
            for outcome in landed(&state, &op) {
                support::assert_valid(&outcome.state);
                landed_any = true;
            }
        }
    }
    assert!(landed_any);
}
