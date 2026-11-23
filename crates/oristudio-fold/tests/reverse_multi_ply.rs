//! A reverse fold whose walls are several plies: a corner of eight plies,
//! two halves of a fold in half each closed along a second edge by two wraps
//! nested on it. The tip has two flaps — the outer wraps and the inner ones,
//! each a vertex of the sheet folded in quarters — that interleave in both
//! halves: the inner flap's plies lie between the outer flap's. Reversed
//! between the halves, each half turns over as one packet of four plies.
mod support;

use oristudio_fold::{
    Direction, FaceId, ReverseChoices, ReverseFold, ReverseKind, ReverseOutcome, Seed, Sheet,
    StartSide, State,
};
use support::*;

/// A square folded in half (bottom up), in half again on y = 0.75 (top
/// down: the two plies wrap round each other on that line), and in half on
/// x = 0.5 (left over right): eight plies over [0.5, 1] × [0.5, 0.75].
fn eight_ply_corner(mut paper: State) -> State {
    for (line, toward) in [
        (y_eq(0.5), [0.5, 0.25]),
        (y_eq(0.75), [0.5, 0.9]),
        (x_eq(0.5), [0.25, 0.6]),
    ] {
        paper = fold(&paper, &all(line, toward, Direction::Valley)).state;
    }
    paper
}

/// The corner at (0.5, 0.75), cut off at 45°.
fn corner_line() -> oristudio_geometry::Line {
    through([0.5, 0.65], [0.6, 0.75])
}

fn reverse(kind: ReverseKind) -> ReverseFold {
    let line = corner_line();
    ReverseFold {
        line,
        side: side(&line, [0.51, 0.74]),
        anchor: Seed::All,
        kind,
    }
}

/// A body point and its mirror in the tip, across the corner line.
const BODY: Point = [0.57, 0.67];
const TIP: Point = [0.52, 0.72];

/// The parent's face and whether it was in the tip, for every layer of
/// `folded` at the model-frame point `p`, top first.
fn material(state: &State, folded: &State, p: Point) -> Vec<(FaceId, bool)> {
    let line = corner_line();
    let tip_side = side(&line, [0.51, 0.74]);
    folded
        .stack_at(p)
        .unwrap()
        .iter()
        .map(|&f| {
            let sheet = folded.isometry(f).unwrap().inverse().apply(p);
            let parent = state.face_at(sheet).unwrap();
            let image = state.isometry(parent).unwrap().apply(sheet);
            (parent, side(&line, image) == tip_side)
        })
        .collect()
}

fn reverse_corner(state: &State) -> State {
    let op = reverse(ReverseKind::Inside);
    let analysis = state.analyse_reverse(&op).unwrap();
    // Two flaps, each one opening between the halves of the fold in half,
    // along it (x = 0.5).
    assert_eq!(analysis.flaps.len(), 2, "{analysis:?}");
    for flap in &analysis.flaps {
        assert_eq!(flap.flap.faces.len(), 4);
        assert_eq!(flap.openings.len(), 1, "{flap:?}");
        let opening = &flap.openings[0];
        assert_eq!((opening.lower.len(), opening.upper.len()), (2, 2));
        let spine = opening.spine.unwrap();
        assert!(spine.signed_distance([0.5, 0.1]).abs() < 1e-9);
        assert!(spine.signed_distance([0.5, 0.9]).abs() < 1e-9);
    }
    // The halves interleave: the inner flap's plies lie between the outer
    // flap's in each.
    let tip = state.stack_at(TIP).unwrap();
    let body = state.stack_at(BODY).unwrap();
    assert_eq!((tip.len(), body.len()), (8, 8));
    let flap_of = |f: FaceId| {
        analysis
            .flaps
            .iter()
            .position(|flap| flap.flap.faces.contains(&f))
            .unwrap()
    };
    let flaps: Vec<usize> = tip.iter().map(|&f| flap_of(f)).collect();
    assert_eq!(flaps[0], flaps[3]);
    assert_eq!(flaps[1], flaps[2]);
    assert_ne!(flaps[0], flaps[1]);
    assert_eq!(flaps[4..], [flaps[0], flaps[1], flaps[1], flaps[0]]);

    assert_eq!(
        state
            .reverse_kinds(&op, &ReverseChoices::default())
            .unwrap(),
        vec![ReverseKind::Inside]
    );
    let ReverseOutcome::Landed(folded) =
        state.reverse_fold(&op, &ReverseChoices::default()).unwrap()
    else {
        panic!("the corner reverses between the halves with one order");
    };
    assert_valid(&folded.state);
    assert!(folded.report.stored.openings.is_empty());
    assert!(folded.report.stored.order.is_none());
    // The four creases of the fold in half in the tip turn (on the sheet's
    // x = 0.5); the wraps ride inside the packets with their letters.
    assert_eq!(folded.report.fold.reversed.len(), 4);
    for &edge in &folded.report.fold.reversed {
        let crease = folded.state.crease(edge).unwrap();
        let [p, q] = crease
            .vertices
            .map(|v| folded.state.vertices()[v.0 as usize]);
        assert!(
            (p[0] - 0.5).abs() < 1e-9 && (q[0] - 0.5).abs() < 1e-9,
            "{p:?} {q:?}"
        );
    }
    // Each half turns over as one packet between its body and the other's:
    // the upper half's body, its tip reversed, the lower half's tip
    // reversed, the lower half's body.
    let mut expected: Vec<(FaceId, bool)> = body[..4].iter().map(|&f| (f, false)).collect();
    expected.extend(tip[..4].iter().rev().map(|&f| (f, true)));
    expected.extend(tip[4..].iter().rev().map(|&f| (f, true)));
    expected.extend(body[4..].iter().map(|&f| (f, false)));
    assert_eq!(material(state, &folded.state, BODY), expected);

    let ReverseOutcome::Landed(replayed) = state.reverse_fold(&op, &folded.report.stored).unwrap()
    else {
        panic!("the step failed to replay");
    };
    assert_eq!(folded.state.parts(), replayed.state.parts());
    folded.state
}

#[test]
fn a_corner_of_interleaved_halves_reverses_between_them() {
    let corner = eight_ply_corner(State::flat(Sheet::square(), StartSide::Front).unwrap());
    reverse_corner(&corner);
}

#[test]
fn the_corner_reverses_the_same_on_its_precrease() {
    let corner = eight_ply_corner(State::flat(Sheet::square(), StartSide::Front).unwrap());
    let line = corner_line();
    let creased = precrease(&corner, &all(line, [0.51, 0.74], Direction::Valley)).state;
    let folded = reverse_corner(&creased);
    let plain = reverse_corner(&corner);
    for p in [BODY, [0.55, 0.7], [0.8, 0.6]] {
        let stack = |s: &State| {
            s.stack_at(p)
                .unwrap()
                .iter()
                .map(|&f| (s.isometry(f).unwrap().inverse().apply(p), s.front_up(f)))
                .map(|(q, up)| ([(q[0] * 1e9).round(), (q[1] * 1e9).round()], up))
                .collect::<Vec<_>>()
        };
        assert_eq!(stack(&folded), stack(&plain), "at {p:?}");
    }
}

#[test]
fn the_corner_does_not_reverse_outside() {
    let corner = eight_ply_corner(State::flat(Sheet::square(), StartSide::Front).unwrap());
    // Outside, the halves would wrap round the bodies, through the paper the
    // fold in half joins them by.
    assert!(
        corner
            .reverse_fold(&reverse(ReverseKind::Outside), &ReverseChoices::default())
            .is_err()
    );
}

#[test]
fn the_corner_folded_from_the_back_reverses_mirrored() {
    let front = eight_ply_corner(State::flat(Sheet::square(), StartSide::Front).unwrap());
    let back = eight_ply_corner(State::flat(Sheet::square(), StartSide::Back).unwrap());
    let (front, back) = (reverse_corner(&front), reverse_corner(&back));
    assert!(mirrored(&front, &back));
}
