//! A squash of a closed pocket (`squash_closed`): a paper hat opened from its
//! open edge and pressed flat into a square, and then the triangle that
//! square makes with its flaps folded up, opened and pressed flat again.
//! Synthetic: a 1 × 1.6 rectangle (`cases::paper_hat`).

mod beloch;
mod support;
mod vertex;

use oristudio_fold::{
    CompoundRefused, Direction, FoldRefusal, Squash, State, VertexChoices, VertexOutcome,
};
use vertex::cases::{self, HAT_BRIM, HAT_LEFT, HAT_RIGHT, HAT_WIDTH, TRIANGLE_HALF};
use vertex::check;

type Point = [f64; 2];

fn op(state: &State, at: Point, direction: Direction, opening: Option<usize>) -> Squash {
    let flap = match direction {
        Direction::Valley => cases::seen_top(state, at),
        Direction::Mountain => cases::seen_bottom(state, at),
    };
    Squash {
        flap,
        target: None,
        direction,
        hinge: None,
        opening,
    }
}

fn near(a: Point, b: Point) -> bool {
    (a[0] - b[0]).hypot(a[1] - b[1]) < 1e-9
}

/// The bounding box of every face's image.
fn bounds(state: &State) -> [f64; 4] {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for f in state.faces() {
        for p in state.face_image(f.id).unwrap_or_default() {
            b = [
                b[0].min(p[0]),
                b[1].min(p[1]),
                b[2].max(p[0]),
                b[3].max(p[1]),
            ];
        }
    }
    b
}

fn refusal(state: &State, op: &Squash) -> FoldRefusal {
    match state.squash(op, &VertexChoices::default()) {
        Err(CompoundRefused::Refused(refused)) => refused.refusal,
        Err(CompoundRefused::Broken(broken)) => panic!("broken {broken}"),
        Ok(_) => panic!("{op:?} landed"),
    }
}

#[test]
fn a_paper_hat_squashes_into_a_square_opened_between_its_walls() {
    let hat = cases::paper_hat();
    let (c, b) = (HAT_WIDTH / 2.0, HAT_BRIM);
    // As the squash always read it: the corner flap's own two layers, under the brim.
    assert!(matches!(
        refusal(&hat, &op(&hat, HAT_RIGHT, Direction::Valley, None)),
        FoldRefusal::SquashFlapCovered { .. }
    ));
    // Opened under its top three layers — the corner flap and the front wall —
    // the hat is a closed pocket: its walls are joined on both slanted edges.
    let squash = op(&hat, HAT_RIGHT, Direction::Valley, Some(3));
    let analysis = hat
        .analyse_squash(&squash)
        .unwrap_or_else(|e| panic!("{e}"));
    assert!(analysis.closed);
    assert_eq!((analysis.layers, analysis.opening), (4, 3));
    assert!(near(analysis.vertex, [c, 0.5]), "{:?}", analysis.vertex);
    let Ok(VertexOutcome::ChooseOrder(choice)) = hat.squash(&squash, &VertexChoices::default())
    else {
        panic!("the brims' ends leave no choice");
    };
    // Which brim end lies over the other, on each face.
    assert_eq!(choice.count().orders, 4);
    for folded in cases::every(hat.squash(&squash, &VertexChoices::default())) {
        check(&hat, &folded);
        // A square: the apex at one corner, the hat's two base corners met
        // at the other.
        let box_ = bounds(&folded.state);
        assert!(
            near([box_[0], box_[1]], [0.0, b]) && near([box_[2], box_[3]], [c, 0.5]),
            "{box_:?}"
        );
        for (sheet, expected) in [
            // The back wall's half on the far side stays; the half clicked
            // folds onto it, on the centre line.
            ([0.2, 0.3], [0.2, 0.3]),
            ([0.4, 0.3], [c - 0.0875, 0.3]),
            // The front wall swings across the other slanted edge, its
            // clicked half folded onto the far one first.
            ([0.2, 0.7], [0.1125, 0.3875]),
            ([0.4, 0.7], [0.1125, 0.4125]),
            // The brims ride with their walls.
            ([0.2, 0.9], [0.0875, 0.3875]),
            ([0.2, 0.1], [0.2, 0.275]),
        ] {
            let image = folded
                .state
                .image_of(sheet)
                .unwrap_or_else(|| panic!("no paper at {sheet:?}"));
            assert!(
                near(image, expected),
                "{sheet:?}: {image:?} != {expected:?}"
            );
        }
        let replay = cases::landed(hat.squash(&squash, &folded.report.stored));
        assert_eq!(replay.state.parts(), folded.state.parts());
    }
    // Clicked on the other half, the mirror fold: that half folds over.
    let mirror = cases::every(hat.squash(
        &op(&hat, HAT_LEFT, Direction::Valley, Some(3)),
        &VertexChoices::default(),
    ));
    assert_eq!(mirror.len(), 4);
    for folded in &mirror {
        let image = folded.state.image_of([0.4, 0.3]).unwrap_or_default();
        assert!(near(image, [0.4, 0.3]), "{image:?}");
    }
}

#[test]
fn a_closed_pocket_takes_no_spine_target_and_opens_only_between_its_walls() {
    let hat = cases::paper_hat();
    // Between the corner flap and the front wall: the corner flap would
    // tear from the front wall it is folded on.
    assert!(
        hat.squash(
            &op(&hat, HAT_RIGHT, Direction::Valley, Some(2)),
            &VertexChoices::default()
        )
        .is_err()
    );
    // An asymmetric target: no closed reading, today's refusal stands.
    let symmetric = hat
        .analyse_squash(&op(&hat, HAT_RIGHT, Direction::Valley, Some(3)))
        .unwrap_or_else(|e| panic!("{e}"));
    let h = symmetric.hinge_direction;
    let (s, c) = (0.3 * symmetric.wedge).sin_cos();
    let aimed = Squash {
        target: Some([c * h[0] - s * h[1], s * h[0] + c * h[1]]),
        ..op(&hat, HAT_RIGHT, Direction::Valley, Some(3))
    };
    assert!(hat.squash(&aimed, &VertexChoices::default()).is_err());
}

#[test]
fn the_triangle_squashes_into_a_square_each_wall_folded_under_carried() {
    let triangle = cases::hat_triangle();
    let depth = triangle
        .stack_at(TRIANGLE_HALF)
        .map(|s| s.len())
        .unwrap_or_default();
    assert_eq!(depth, 8);
    // Opened between its halves: four layers each side, the half seen from
    // the front over the other. Each wall is folded in half along a slanted
    // edge, the half under carried with it.
    for direction in [Direction::Valley, Direction::Mountain] {
        let squash = op(&triangle, TRIANGLE_HALF, direction, Some(4));
        let analysis = triangle
            .analyse_squash(&squash)
            .unwrap_or_else(|e| panic!("{direction:?}: {e}"));
        assert!(analysis.closed);
        let folded = cases::landed(triangle.squash(&squash, &VertexChoices::default()));
        check(&triangle, &folded);
        let box_ = bounds(&folded.state);
        let (w, h) = (box_[2] - box_[0], box_[3] - box_[1]);
        assert!(
            (w - h).abs() < 1e-9,
            "{direction:?}: not a square, {box_:?}"
        );
    }
}
