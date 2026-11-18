//! The swivel at a hinge end, for a flap whose two hinges show it one
//! letter: it lies over the layers on both sides of it, and its valley and
//! mountain turn it as they turn a flap whose hinges show it two.
mod beloch;
mod support;
mod vertex;
use oristudio_fold::{
    CreaseKind, Direction, Letter, State, SwivelKind, SwivelValleyMountain, VertexChoices,
    VertexFolded,
};
use oristudio_geometry::Line;
use support::{all, at_angle, fold, through, x_eq};
use vertex::cases;

type Point = [f64; 2];

const V: Point = [0.5, 0.5];

/// The square folded in half on x = 1/2, the right half over the left, then
/// both layers folded along the line through (1/2, 1/2) at 22.5°, the part
/// below it up, and turned over. At (1/2, 1/2) four folds end: x = 1/2 up
/// (90°) and down (270°), and the second fold at 202.5° in the left half
/// and 337.5° in the right. The left half's upper part, between 90° and
/// 202.5°, lies on top, over the layers either side of it: both its hinges
/// are valleys, and it shows both as mountains.
///
/// First, `precrease` (a line through the vertex, creased flat) and a fold
/// of the right half's lower corner, which holds the layer under the flap
/// together across the line its own turn would crease: that layer cannot
/// turn, so the lines turn the flap on top.
fn corner(precrease: Option<f64>) -> State {
    let flat = State::flat(
        oristudio_fold::Sheet::square(),
        oristudio_fold::StartSide::Front,
    )
    .unwrap();
    let creased = match precrease {
        Some(degrees) => {
            support::precrease(
                &flat,
                &all(at_angle(V, degrees), [0.0, 1.0], Direction::Valley),
            )
            .state
        }
        None => flat,
    };
    let held = fold(
        &creased,
        &all(
            through([0.8, 0.0], [1.0, 0.75]),
            [0.99, 0.05],
            Direction::Valley,
        ),
    )
    .state;
    let half = fold(&held, &all(x_eq(0.5), [0.8, 0.5], Direction::Valley)).state;
    fold(
        &half,
        &all(at_angle(V, 22.5), [0.3, 0.2], Direction::Valley),
    )
    .state
    .turn_over()
}

/// The sheet point `r` from (1/2, 1/2) at `degrees`.
fn ray_point(degrees: f64, r: f64) -> Point {
    let (s, c) = degrees.to_radians().sin_cos();
    [V[0] + r * c, V[1] + r * s]
}

/// The model line of the sheet ray from (1/2, 1/2) at `degrees`, through
/// the paper it runs in.
fn sheet_ray(state: &State, degrees: f64) -> Line {
    let at = |r: f64| state.image_of(ray_point(degrees, r)).unwrap();
    Line::from_points(at(0.05), at(0.2)).unwrap()
}

fn swivel(state: &State, valley: f64, mountain: f64, kind: SwivelKind) -> SwivelValleyMountain {
    SwivelValleyMountain {
        valley: sheet_ray(state, valley),
        mountain: sheet_ray(state, mountain),
        kind,
    }
}

fn landed(state: &State, op: &SwivelValleyMountain) -> Vec<VertexFolded> {
    cases::every(state.swivel_valley_mountain(op, &VertexChoices::default()))
}

/// The kind of the crease a short way from (1/2, 1/2) along the sheet ray
/// at `degrees`; none off every crease.
fn kind_along(state: &State, degrees: f64) -> Option<CreaseKind> {
    state.crease_at(ray_point(degrees, 0.1)).map(|c| c.kind)
}

/// The paper stacked at the model point `p`, top first: each layer's sheet
/// point and whether it shows its front.
fn paper_at(state: &State, p: Point) -> Vec<(Point, bool)> {
    state
        .stack_at(p)
        .unwrap_or_default()
        .into_iter()
        .map(|id| {
            let t = state.isometry(id).unwrap();
            (t.inverse().apply(p), t.front_up())
        })
        .collect()
}

/// Two states hold the same paper, whatever their creases.
fn same_paper(a: &State, b: &State) -> bool {
    let near = |p: Point, q: Point| (p[0] - q[0]).abs() < 1e-9 && (p[1] - q[1]).abs() < 1e-9;
    (0..60)
        .flat_map(|i| (0..60).map(move |j| (i, j)))
        .map(|(i, j)| [-1.19 + 0.0437 * i as f64, -1.21 + 0.0441 * j as f64])
        .all(|p| {
            let (x, y) = (paper_at(a, p), paper_at(b, p));
            x.len() == y.len() && x.iter().zip(&y).all(|(s, t)| near(s.0, t.0) && s.1 == t.1)
        })
}

#[test]
fn a_flap_over_both_layers_turns_about_the_end_of_its_hinges() {
    let state = corner(None);
    let valley = |letter| CreaseKind::Folded(letter);
    assert_eq!(kind_along(&state, 90.0), Some(valley(Letter::Valley)));
    assert_eq!(kind_along(&state, 202.5), Some(valley(Letter::Valley)));
    // The mountain on the flap at 157.5°, continuing the right half's
    // second fold: the flap leaves its hinge at 202.5°, both hinges moving
    // 45° round, and turns 90° about the vertex. The valley at 45° is the
    // crease computed in the right half's upper part, which folds in with it.
    let op = swivel(&state, 45.0, 157.5, SwivelKind::Open);
    let a = state.analyse_swivel_valley_mountain(&op).unwrap();
    let letters: Vec<Letter> = a.creases.iter().map(|c| c.letter).collect();
    assert_eq!(letters, vec![Letter::Mountain, Letter::Valley]);
    let turned = landed(&state, &op);
    assert_eq!(turned.len(), 1);
    let after = &turned[0].state;
    support::assert_valid(after);
    // Both hinges open flat, and each new crease keeps its hinge's letter.
    assert!(matches!(kind_along(after, 90.0), Some(CreaseKind::Flat(_))));
    assert!(matches!(
        kind_along(after, 202.5),
        Some(CreaseKind::Flat(_))
    ));
    assert_eq!(kind_along(after, 157.5), Some(valley(Letter::Valley)));
    assert_eq!(kind_along(after, 45.0), Some(valley(Letter::Valley)));
    assert_eq!(kind_along(after, 270.0), kind_along(&state, 270.0));
    assert_eq!(kind_along(after, 337.5), kind_along(&state, 337.5));
    // The flap has turned a quarter turn about the vertex and is still the
    // paper the viewer sees (from below the model frame: it is turned over).
    let p = ray_point(120.0, 0.2);
    // Where the face holding `p` puts `q`.
    let through_p = |s: &State, q: Point| s.isometry(s.face_at(p).unwrap()).unwrap().apply(q);
    let (v0, v1) = (through_p(&state, V), through_p(after, V));
    let (p0, p1) = (through_p(&state, p), through_p(after, p));
    let (d0, d1) = (
        [p0[0] - v0[0], p0[1] - v0[1]],
        [p1[0] - v1[0], p1[1] - v1[1]],
    );
    let cos = (d0[0] * d1[0] + d0[1] * d1[1]) / (d0[0].hypot(d0[1]) * d1[0].hypot(d1[1]));
    assert!(cos.abs() < 1e-9, "the flap turned by acos({cos})");
    assert!(after.view().flipped);
    let seen = |s: &State, at: Point| paper_at(s, at).last().map(|layer| layer.0);
    let near = |q: Option<Point>| {
        q.is_some_and(|q| (q[0] - p[0]).abs() < 1e-9 && (q[1] - p[1]).abs() < 1e-9)
    };
    assert!(near(seen(&state, p0)) && near(seen(after, p1)));
    let replay = cases::every(state.swivel_valley_mountain(&op, &turned[0].report.stored));
    assert!(same_paper(&replay[0].state, after));
    assert_eq!(replay[0].state.order(), after.order());
}

#[test]
fn the_other_line_only_has_to_run_into_the_flap() {
    let state = corner(None);
    let exact = landed(&state, &swivel(&state, 45.0, 157.5, SwivelKind::Open));
    let rough = landed(&state, &swivel(&state, 100.0, 157.5, SwivelKind::Open));
    assert_eq!(rough.len(), 1);
    assert!(same_paper(&exact[0].state, &rough[0].state));
    assert_eq!(exact[0].state.order(), rough[0].state.order());
}

#[test]
fn a_flap_whose_hinges_show_it_mountains_takes_its_mountain_on_it() {
    // Inside, the valley would be the crease on the flap, which shows both
    // its hinges as mountains.
    let state = corner(None);
    assert!(
        state
            .swivel_valley_mountain(
                &swivel(&state, 157.5, 45.0, SwivelKind::Inside),
                &VertexChoices::default()
            )
            .is_err()
    );
    assert!(
        state
            .swivel_valley_mountain(
                &swivel(&state, 45.0, 157.5, SwivelKind::Inside),
                &VertexChoices::default()
            )
            .is_err()
    );
}

#[test]
fn a_precrease_along_the_crease_on_the_flap_is_folded() {
    // The line through the vertex at 157.5° creased flat first: its right
    // part is the second fold's, its left part the crease the turn folds.
    let creased = corner(Some(157.5));
    assert!(matches!(
        kind_along(&creased, 157.5),
        Some(CreaseKind::Flat(_))
    ));
    // The precrease moves no paper: the plain corner's lines are its lines.
    let plain = corner(None);
    let op = swivel(&plain, 45.0, 157.5, SwivelKind::Open);
    let turned = landed(&creased, &op);
    assert_eq!(turned.len(), 1);
    support::assert_valid(&turned[0].state);
    assert_eq!(
        kind_along(&turned[0].state, 157.5),
        Some(CreaseKind::Folded(Letter::Valley))
    );
    let without = landed(&plain, &op);
    assert!(same_paper(&turned[0].state, &without[0].state));
}
