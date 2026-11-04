//! A squash of two pockets on one lower layer (`State::squash_other_reading`):
//! two doors over one panel, each joined to the panel on a spine of its own
//! and folded with it over a hinge of its own, opened and pressed flat
//! together. The configuration is synthetic (`cases::two_pockets`): a square
//! blintzed (its four corners folded to the centre) and collapsed into a
//! preliminary base, the blintz flaps lying over the base's front panel as
//! the two doors.

mod beloch;
mod support;
mod vertex;

use oristudio_fold::{CompoundRefused, Direction, FoldRefusal, Squash, State, VertexChoices};
use vertex::cases::{self, DOORS, landed, squash_op, two_pockets};
use vertex::check;

type Point = [f64; 2];

fn squash(parent: &State, at: Point) -> Result<oristudio_fold::VertexOutcome, CompoundRefused> {
    parent.squash(&squash_op(parent, at, None), &VertexChoices::default())
}

fn image(state: &State, sheet: Point) -> Point {
    let face = state
        .face_at(sheet)
        .unwrap_or_else(|| panic!("no face at {sheet:?}"));
    state.isometry(face).unwrap_or_default().apply(sheet)
}

fn near(a: Point, b: Point) -> bool {
    (a[0] - b[0]).hypot(a[1] - b[1]) < 1e-9
}

#[test]
fn two_pockets_on_one_panel_squash_together() {
    for mirror in [false, true] {
        let m = |p| cases::m(mirror, p);
        let parent = two_pockets(mirror);
        let first = landed(squash(&parent, m(DOORS[0])));
        check(&parent, &first);
        let replay =
            landed(parent.squash(&squash_op(&parent, m(DOORS[0]), None), &first.report.stored));
        assert_eq!(replay.state.parts(), first.state.parts());
        // Either door, either half: one fold.
        for at in &DOORS[1..] {
            let other = landed(squash(&parent, m(*at)));
            assert_eq!(other.state.parts(), first.state.parts(), "{at:?}");
        }
        // Both doors' vertices, the panel's side corners; the panel creases
        // on the diagonal through them, each door across its own spine and
        // hinge.
        let corners = [m([0.75, 0.75]), m([0.25, 0.75])];
        assert_eq!(first.report.vertices.len(), 2);
        assert!(
            first
                .report
                .vertices
                .iter()
                .all(|v| corners.iter().any(|c| near(*v, *c))),
            "{:?}",
            first.report.vertices
        );
        assert_eq!(first.report.creases.len(), 5);
        let state = &first.state;
        for (sheet, before, after) in [
            // The panel (the blintzed square's top quarter): its top half
            // turned down onto its lower half, which stays.
            ([0.45, 0.9], [0.45, 0.9], [0.45, 0.6]),
            ([0.45, 0.6], [0.45, 0.6], [0.45, 0.6]),
            // A door's part over the panel's top half: unfolded across its
            // spine (the panel's upper edge), then turned down with it.
            ([0.3, 0.9], [0.4, 0.8], [0.3, 0.6]),
            // Its part wrapped round the panel's lower edge: across that
            // hinge, onto the side, a corner of the 2:1 rectangle.
            ([0.1, 0.98], [0.48, 0.6], [0.4, 0.52]),
        ] {
            let (sheet, before, expected) = (m(sheet), m(before), m(after));
            assert!(near(image(&parent, sheet), before), "{sheet:?}");
            let actual = image(state, sheet);
            assert!(
                near(actual, expected),
                "{sheet:?}: {actual:?} != {expected:?}"
            );
        }
    }
}

#[test]
fn the_pockets_are_the_flap_the_analysis_shows() {
    let parent = two_pockets(false);
    let op = squash_op(&parent, DOORS[0], None);
    let analysis = parent.analyse_squash(&op).unwrap_or_else(|e| panic!("{e}"));
    // Both doors are the upper layer; the panel is the lower one.
    let door = |at: Point| {
        let sheet = cases::seen_top(&parent, at);
        parent.face_at(sheet).unwrap_or_else(|| panic!("no face"))
    };
    for at in DOORS {
        assert!(analysis.upper.contains(&door(at)), "{at:?}");
    }
    assert!((analysis.wedge.abs() - std::f64::consts::FRAC_PI_2).abs() < 1e-9);
}

#[test]
fn the_pockets_squash_together_from_behind() {
    let front = landed(squash(&two_pockets(false), DOORS[0]));
    // Turned over, the doors face away: a mountain squash names one by the
    // layer seen at the bottom, and makes the same fold.
    let parent = two_pockets(false).turn_over();
    let op = Squash {
        flap: cases::seen_bottom(&parent, DOORS[0]),
        direction: Direction::Mountain,
        ..squash_op(&parent, DOORS[0], None)
    };
    let behind = landed(parent.squash(&op, &VertexChoices::default()));
    check(&parent, &behind);
    assert_eq!(behind.state.vertices(), front.state.vertices());
    assert_eq!(behind.state.order(), front.state.order());
}

#[test]
fn only_the_symmetric_squash_takes_the_second_pocket() {
    let parent = two_pockets(false);
    let symmetric = parent
        .analyse_squash(&squash_op(&parent, DOORS[0], None))
        .unwrap_or_else(|e| panic!("{e}"));
    // A target off the hinge would crease the panel off the doors' shared
    // line: the flap alone is read, and the other door holds it.
    let h = symmetric.hinge_direction;
    let (s, c) = (0.3 * symmetric.wedge).sin_cos();
    let target = [c * h[0] - s * h[1], s * h[0] + c * h[1]];
    let op = squash_op(&parent, DOORS[0], Some(target));
    assert!(matches!(
        parent.squash(&op, &VertexChoices::default()),
        Err(CompoundRefused::Refused(r)) if matches!(r.refusal, FoldRefusal::SquashFlapNotFree { .. })
    ));
}
