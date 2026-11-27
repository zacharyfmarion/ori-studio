//! A tuck whose strict reading has no order, read locally
//! (`compound::tuck`'s `Reading::Local`). A square has two flaps folded in at
//! its bottom left, and the same two mirrored at its top right. Its
//! bottom-right corner, folded up along x − y = 9/16, lands across both
//! sides. Tucked against a layer between each side's two flaps at once, it is
//! over-constrained when read strictly: each target's flaps "meet" the other
//! target too, so the block would have to go under and over the same layer.
//! Read only where the block, the layer and the target overlap together, it
//! lands between the flaps on both sides. This is the one order of the nine
//! that the tuck recipes never reached before (both sides between), the
//! independent-sides known gap in the web's tests.

mod support;

use oristudio_fold::{
    Direction, FaceId, Seed, Sheet, StartSide, State, TuckChoices, TuckFold, TuckOutcome,
};
use oristudio_geometry::Line;
use support::*;

/// The fold that takes `p` onto `q`: their perpendicular bisector.
fn onto(p: Point, q: Point) -> Line {
    let n = [q[0] - p[0], q[1] - p[1]];
    let len = n[0].hypot(n[1]);
    let n = [n[0] / len, n[1] / len];
    let m = [(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0];
    Line::new(n, n[0] * m[0] + n[1] * m[1]).unwrap_or_else(|| unreachable!())
}

/// Where the sheet point `p` of the face holding `inside` lies in the model
/// frame (`p` may be on that face's edge).
fn image(state: &State, p: Point, inside: Point) -> Point {
    let t = state
        .isometry(face(state, inside))
        .unwrap_or_else(|| unreachable!());
    t.apply(p)
}

/// A valley of only the flap at `seed`, taking the sheet point `p` (of the
/// seed's face) onto the sheet point `q`, both where they lie now.
fn flap(state: &State, p: Point, q: Point, seed: Point) -> State {
    let (p, q) = (image(state, p, seed), image(state, q, q));
    let op = all(onto(p, q), p, Direction::Valley).with_seed(Seed::Flaps { at: vec![seed] });
    fold(state, &op).state
}

/// The two flaps at each of two opposite corners.
fn sides() -> State {
    let sheet = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let s = flap(&sheet, [0.0, 0.0], [0.625, 0.25], [0.015625, 0.015625]);
    let s = flap(&s, [0.25, 0.0], [0.5625, 0.125], [0.265625, 0.015625]);
    let s = flap(&s, [1.0, 1.0], [0.75, 0.375], [0.984375, 0.984375]);
    flap(&s, [1.0, 0.75], [0.875, 0.4375], [0.984375, 0.734375])
}

/// The corner (1, 0) onto (9/16, 7/16): only its flap moves.
const CORNER: Point = [0.8125, 0.125];
/// A layer between the two flaps on each side, by a sheet point inside it.
const LEFT_BETWEEN: Point = [0.16062956353286398, 0.281937783767287];
const RIGHT_BETWEEN: Point = [0.6500810939984063, 0.8583818631067905];
/// Each side's two flaps, by a sheet point inside each.
const LEFT: [Point; 2] = [[0.015625, 0.015625], [0.265625, 0.015625]];
const RIGHT: [Point; 2] = [[0.984375, 0.984375], [0.984375, 0.734375]];

fn across(targets: &[Point]) -> TuckFold {
    let line = onto([1.0, 0.0], [0.5625, 0.4375]);
    TuckFold {
        line,
        side: side(&line, [1.0, 0.0]),
        direction: Direction::Valley,
        seed: Seed::Flaps { at: vec![CORNER] },
        target: targets[0],
        additional_targets: targets[1..].to_vec(),
    }
}

/// Whether the corner lies over some of a side's flap layers and under others
/// where it meets them: between them.
fn between(state: &State, corner: &[FaceId], flaps: &[Point]) -> bool {
    let flaps: Vec<FaceId> = flaps.iter().map(|&p| face(state, p)).collect();
    let mut over = false;
    let mut under = false;
    for &c in corner {
        for &f in &flaps {
            match state.above(c, f) {
                Some(true) => over = true,
                Some(false) => under = true,
                None => {}
            }
        }
    }
    over && under
}

#[test]
fn a_corner_tucks_between_the_flaps_on_both_sides_when_read_locally() {
    let parent = sides();
    let op = across(&[LEFT_BETWEEN, RIGHT_BETWEEN]);
    let folded = match parent.tuck_fold(&op, &TuckChoices::default()) {
        Ok(TuckOutcome::Landed(folded)) => *folded,
        Ok(TuckOutcome::ChooseOrder(choice)) => panic!("choose an order of {:?}", choice.count()),
        Err(e) => panic!("{e} {e:?}"),
    };
    let state = &folded.state;
    assert_valid(state);
    let corner: Vec<FaceId> = folded
        .report
        .fold
        .blocks
        .iter()
        .flatten()
        .copied()
        .collect();
    assert!(between(state, &corner, &LEFT), "between the left flaps");
    assert!(between(state, &corner, &RIGHT), "between the right flaps");
    // What the step stores replays to the same state.
    let again = match parent.tuck_fold(&op, &folded.report.stored) {
        Ok(TuckOutcome::Landed(again)) => again,
        other => panic!("replay: {:?}", other.err()),
    };
    assert_eq!(again.state.parts(), state.parts());
}

#[test]
fn each_side_alone_still_lands_as_its_strict_reading_puts_it() {
    // One target is not over-constrained: the strict reading lands it, so
    // the local one is never read. The corner goes between that side's flaps
    // and keeps out of the other side's, under both or over both.
    let parent = sides();
    for (target, near, far) in [(LEFT_BETWEEN, LEFT, RIGHT), (RIGHT_BETWEEN, RIGHT, LEFT)] {
        let folded = match parent.tuck_fold(&across(&[target]), &TuckChoices::default()) {
            Ok(TuckOutcome::Landed(folded)) => *folded,
            Ok(TuckOutcome::ChooseOrder(choice)) => {
                panic!("choose an order of {:?}", choice.count())
            }
            Err(e) => panic!("{e} {e:?}"),
        };
        assert_valid(&folded.state);
        let corner: Vec<FaceId> = folded
            .report
            .fold
            .blocks
            .iter()
            .flatten()
            .copied()
            .collect();
        assert!(between(&folded.state, &corner, &near));
        assert!(!between(&folded.state, &corner, &far));
    }
}
