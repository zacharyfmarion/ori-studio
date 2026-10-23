//! A vertex fold's picture (plan D12, per step; `compound::vertex`): the one
//! crease that tells the fold best, where the moving paper meets it, and the
//! arrow from paper that turns across it alone to where it lands — a squash's
//! with its push onto the spine — before the fold lands and once it has, on
//! the vertex spike's named cases and the squash campaign's.

mod beloch;
mod support;
mod vertex;

use oristudio_fold::random::{self, Rng};
use oristudio_fold::{
    ActionKind, Direction, FoldActionGeometry, Grip, RabbitEar, ScenePoint, State, Swivel,
    VertexChoices,
};
use oristudio_geometry::Line;
use support::Point;
use vertex::cases::{self, landed};

fn p(point: ScenePoint) -> Point {
    [point.x, point.y]
}

/// A model point in `state`'s scene frame, where its picture is drawn.
fn scene(state: &State, at: Point) -> Point {
    state.view().transform().apply(at)
}

fn close(a: Point, b: Point, tol: f64) -> bool {
    (a[0] - b[0]).hypot(a[1] - b[1]) <= tol
}

/// `line` in `state`'s scene frame.
fn scene_line(state: &State, line: &Line) -> Line {
    let foot = line.foot();
    let along = line.direction();
    let a = scene(state, foot);
    let b = scene(state, [foot[0] + along[0], foot[1] + along[1]]);
    Line::from_points(a, b).unwrap_or_else(|| unreachable!())
}

/// The reflection of `at` across `line`.
fn reflected(line: &Line, at: Point) -> Point {
    let d = line.signed_distance(at);
    [at[0] - 2.0 * d * line.n[0], at[1] - 2.0 * d * line.n[1]]
}

/// Every check a picture of a fold along `line` (in the scene frame) shares:
/// a fold, its line and spans on `line`, and its arrow from one side of it
/// to the mirror image on the other. The grip.
fn assert_along(action: &FoldActionGeometry, line: &Line, direction: Direction) -> Grip {
    assert_eq!(action.kind, ActionKind::Fold);
    assert_eq!(action.direction, direction);
    let Some([a, b]) = action.line else {
        panic!("no line: {action:?}");
    };
    for end in [a, b] {
        assert!(
            line.distance_to_point(p(end)) < 1e-9,
            "{end:?} off {line:?}"
        );
    }
    assert!(!action.spans.is_empty(), "{action:?}");
    for span in &action.spans {
        for end in [span.from, span.to] {
            assert!(line.distance_to_point(p(end)) < 1e-9);
        }
    }
    let Some(grip) = action.grip else {
        panic!("no grip: {action:?}");
    };
    assert!(line.signed_distance(p(grip.at)).abs() > 1e-3);
    assert!(
        close(p(grip.image), reflected(line, p(grip.at)), 1e-9),
        "{grip:?}"
    );
    assert!(action.pleat.is_none());
    grip
}

/// Whether `point` lies on the ray from `from` along `toward` (and not
/// behind it).
fn on_ray(from: Point, toward: Point, point: Point) -> bool {
    let d = [point[0] - from[0], point[1] - from[1]];
    d[0] * toward[0] + d[1] * toward[1] >= -1e-9
        && (d[0] * toward[1] - d[1] * toward[0]).abs() < 1e-9
}

/// The diagonal route's first squash (spike case 1b): the lower layer's
/// crease from the vertex across the flap, the arrow from the spine side
/// onto the target, and the push onto the spine from beyond it, square to it,
/// toward the flap; the same once it has landed, with the arrow's head under
/// the layers the landed state puts over it.
#[test]
fn a_squash_is_pictured_by_its_crease_its_arrow_and_its_push() {
    let start = cases::small_triangle(false);
    let op = cases::squash_op(&start, [0.1, 0.5], None);
    let analysis = start.analyse_squash(&op).unwrap_or_else(|e| panic!("{e}"));
    let crease = scene_line(&start, &analysis.lower_crease);
    let vertex = scene(&start, analysis.vertex);
    let action = start
        .squash_action(&op, None)
        .unwrap_or_else(|e| panic!("{e}"));
    let grip = assert_along(&action, &crease, Direction::Valley);
    // From the vertex, into the flap, never behind it.
    let [a, b] = action.line.map(|ends| ends.map(p)).unwrap_or_default();
    assert!(
        close(a, vertex, 1e-9) || close(b, vertex, 1e-9),
        "{a:?} {b:?}"
    );
    let into = if close(a, vertex, 1e-9) { b } else { a };
    let toward = [into[0] - vertex[0], into[1] - vertex[1]];
    for span in &action.spans {
        assert!(on_ray(vertex, toward, p(span.from)) && on_ray(vertex, toward, p(span.to)));
    }
    // The arrow starts on the spine side and lands on the hinge's.
    let spine = scene_line(&start, &analysis.spine);
    let hinge_side = [
        vertex[0] + analysis.hinge_direction[0],
        vertex[1] + analysis.hinge_direction[1],
    ];
    let on_spine_side = |q: Point| {
        crease.signed_distance(q)
            * crease.signed_distance(scene(
                &start,
                [
                    analysis.vertex[0] + analysis.spine_direction[0],
                    analysis.vertex[1] + analysis.spine_direction[1],
                ],
            ))
            > 0.0
    };
    assert!(on_spine_side(p(grip.at)));
    assert!(!on_spine_side(p(grip.image)));
    // The push: onto the spine, from the side away from the hinge.
    let Some(push) = action.push else {
        panic!("no push: {action:?}");
    };
    assert!(spine.distance_to_point(p(push.toward)) < 1e-9);
    assert!(
        spine.signed_distance(p(push.at)) * spine.signed_distance(scene(&start, hinge_side)) < 0.0,
        "{push:?}"
    );
    assert_eq!(grip.hidden_at, 0, "the flap is on top");
    assert_eq!(grip.hidden_image, None, "nothing landed yet");

    // Once landed: the same picture, the landed state read at the head.
    let folded = landed(start.squash(&op, &VertexChoices::default()));
    let pictured = start
        .squash_action(&op, Some(&folded.state))
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(pictured.line, action.line);
    assert_eq!(pictured.spans, action.spans);
    assert_eq!(pictured.push, action.push);
    assert_eq!(
        pictured.grip.map(|g| (g.at, g.image)),
        action.grip.map(|g| (g.at, g.image))
    );
    // The parent's faces that move are the flap's.
    let mut flap = analysis.upper.clone();
    flap.extend(&analysis.lower);
    flap.sort_unstable();
    assert_eq!(pictured.moving, flap);
}

/// The squash after a turn-over (the diagonal route's second): drawn in the
/// turned view, its arrow still across the crease and its push onto the
/// spine.
#[test]
fn a_squash_seen_turned_over_is_pictured_in_the_view() {
    let route = cases::preliminary(false);
    let (turned, _) = &route.steps[1];
    let op = cases::squash_op(turned, [0.1, 0.7], None);
    let analysis = turned.analyse_squash(&op).unwrap_or_else(|e| panic!("{e}"));
    let action = turned
        .squash_action(&op, None)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_along(
        &action,
        &scene_line(turned, &analysis.lower_crease),
        Direction::Valley,
    );
    let Some(push) = action.push else {
        panic!("no push");
    };
    assert!(scene_line(turned, &analysis.spine).distance_to_point(p(push.toward)) < 1e-9);
}

/// Spike case 2's first petal fold: H where the top layer meets it, and the
/// arrow lifting the petal across H from inside the kite.
#[test]
fn a_petal_fold_is_pictured_lifting_the_petal_across_h() {
    let route = cases::bird_base(false);
    let marks = cases::petal_marks(false);
    let (front, first) = &route.steps[0];
    let op = cases::petal_op(front, &marks);
    let analysis = front.analyse_petal(&op).unwrap_or_else(|e| panic!("{e}"));
    let h = scene_line(front, &analysis.line);
    let action = front
        .petal_action(&op, Some(&first.state))
        .unwrap_or_else(|e| panic!("{e}"));
    let grip = assert_along(&action, &h, Direction::Valley);
    // From inside the kite below H.
    let kite = [analysis.ends[0], analysis.ends[1], analysis.corner].map(|q| scene(front, q));
    let inside = |q: Point| {
        let signs: Vec<f64> = (0..3)
            .map(|i| {
                let (a, b) = (kite[i], kite[(i + 1) % 3]);
                (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])
            })
            .collect();
        signs.iter().all(|&s| s > 0.0) || signs.iter().all(|&s| s < 0.0)
    };
    assert!(inside(p(grip.at)), "{grip:?} outside {kite:?}");
    assert!(action.push.is_none());
    // The spans lie between H's ends.
    let [a, b] = [analysis.ends[0], analysis.ends[1]].map(|q| scene(front, q));
    let length = (b[0] - a[0]).hypot(b[1] - a[1]);
    for span in &action.spans {
        for end in [span.from, span.to] {
            let e = p(end);
            let (da, db) = (
                (e[0] - a[0]).hypot(e[1] - a[1]),
                (e[0] - b[0]).hypot(e[1] - b[1]),
            );
            assert!(da + db <= length + 1e-9, "{e:?} beyond H's ends");
        }
    }
    // The petal lands where the arrow says: one landed layer is the petal's
    // own at the head, as the landed state stacks it.
    assert!(grip.hidden_image.is_some(), "{grip:?}");
}

/// The fan folds: a rabbit ear's or a swivel's crease the far wedge turns
/// across last, from the center, and the arrow from the neighbour that turns
/// across it alone, which lands where that one reflection puts it.
fn assert_fan(state: &State, center: Point, action: &FoldActionGeometry, landed: Option<&State>) {
    let Some([a, b]) = action.line.map(|ends| ends.map(p)) else {
        panic!("no line: {action:?}");
    };
    let center = scene(state, center);
    let far = if close(a, center, 1e-9) {
        b
    } else {
        assert!(
            close(b, center, 1e-9),
            "the line {a:?}–{b:?} does not run from {center:?}"
        );
        a
    };
    let line = Line::from_points(center, far).unwrap_or_else(|| unreachable!());
    let grip = assert_along(action, &line, Direction::Valley);
    let toward = [far[0] - center[0], far[1] - center[1]];
    for span in &action.spans {
        assert!(on_ray(center, toward, p(span.from)) && on_ray(center, toward, p(span.to)));
    }
    if let Some(landed) = landed {
        // The neighbour's paper at the grip lands at its image.
        assert!(grip.hidden_image.is_some(), "{grip:?} on {landed:?}");
    }
}

/// The emergent rays of an ear that land, each with its op.
fn landing_ears(state: &State, op: &RabbitEar) -> Vec<RabbitEar> {
    cases::candidates_of(state, op)
        .into_iter()
        .map(|(_, emergent)| RabbitEar {
            emergent,
            ..op.clone()
        })
        .filter(|ear| state.rabbit_ear(ear, &VertexChoices::default()).is_ok())
        .collect()
}

#[test]
fn every_rabbit_ear_that_lands_is_pictured_from_its_center() {
    let mut pictured = 0;
    for case in cases::ear_cases() {
        for ear in landing_ears(&case.state, &case.op) {
            let center = case
                .state
                .analyse_rabbit_ear(&ear)
                .unwrap_or_else(|e| panic!("{}: {e}", case.name))
                .center;
            let before = case
                .state
                .rabbit_ear_action(&ear, None)
                .unwrap_or_else(|e| panic!("{}: {e}", case.name));
            assert_fan(&case.state, center, &before, None);
            for folded in cases::every(case.state.rabbit_ear(&ear, &VertexChoices::default())) {
                let after = case
                    .state
                    .rabbit_ear_action(&ear, Some(&folded.state))
                    .unwrap_or_else(|e| panic!("{}: {e}", case.name));
                assert_eq!(after.line, before.line, "{}", case.name);
                assert_fan(&case.state, center, &after, Some(&folded.state));
                pictured += 1;
            }
        }
    }
    assert!(pictured >= 5, "{pictured}");
}

#[test]
fn every_swivel_that_lands_is_pictured_from_its_vertex() {
    let (state, op) = cases::swivel_case();
    let candidates = state
        .analyse_swivel(&op)
        .unwrap_or_else(|e| panic!("{e}"))
        .candidates;
    let mut pictured = 0;
    for emergent in candidates {
        let swivel = Swivel {
            emergent,
            ..op.clone()
        };
        let Ok(outcome) = state.swivel(&swivel, &VertexChoices::default()) else {
            continue;
        };
        let folded = landed(Ok(outcome));
        let action = state
            .swivel_action(&swivel, Some(&folded.state))
            .unwrap_or_else(|e| panic!("{e}"));
        assert_fan(&state, swivel.vertex, &action, Some(&folded.state));
        pictured += 1;
    }
    assert!(pictured >= 2, "{pictured}");
}

/// The squash campaign's: every squash that lands is pictured, before and
/// once landed, with its crease, its arrow and its push.
#[test]
fn every_campaign_squash_that_lands_is_pictured() {
    let mut pictured = 0;
    for i in 0..400 {
        let mut rng = Rng::new(7919 + i);
        let Ok(state) = random::folded(&mut rng) else {
            continue;
        };
        if state.faces().len() > 60 {
            continue;
        }
        let Some(op) = random::squash(&state, &mut rng) else {
            continue;
        };
        for folded in cases::every(state.squash(&op, &VertexChoices::default())) {
            let analysis = state.analyse_squash(&op).unwrap_or_else(|e| panic!("{e}"));
            let action = state
                .squash_action(&op, Some(&folded.state))
                .unwrap_or_else(|e| panic!("s1-{i}: {e}"));
            assert_along(
                &action,
                &scene_line(&state, &analysis.lower_crease),
                op.direction,
            );
            assert!(action.push.is_some(), "s1-{i}");
            pictured += 1;
        }
    }
    assert!(pictured >= 40, "{pictured}");
}
