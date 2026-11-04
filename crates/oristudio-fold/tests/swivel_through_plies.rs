//! Swivels by their valleys and mountains whose lines meet where several
//! plies lie along one folded edge (`compound::swivel_valley_mountain`):
//! where the folds there do not settle the meeting — a ply that wraps the
//! fold on one side ends there on its raw edge, or every fold in view ends
//! there over a hidden one — the swivel folds on the fold that runs on
//! through the point.
mod beloch;
mod support;
mod vertex;
use oristudio_fold::{
    Direction, Sheet, StartSide, State, SwivelKind, SwivelValleyMountain, VertexChoices,
    VertexFolded,
};
use oristudio_geometry::Line;
use support::{all, fold, through, y_eq};
use vertex::cases;

type Point = [f64; 2];

fn op(v: Point, valley: Point, mountain: Point, kind: SwivelKind) -> SwivelValleyMountain {
    SwivelValleyMountain {
        valley: Line::from_points(v, valley).unwrap(),
        mountain: Line::from_points(v, mountain).unwrap(),
        kind,
    }
}

fn landed(state: &State, op: &SwivelValleyMountain) -> Vec<VertexFolded> {
    cases::every(state.swivel_valley_mountain(op, &VertexChoices::default()))
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

fn samples() -> impl Iterator<Item = Point> {
    (0..41)
        .flat_map(|i| (0..41).map(move |j| (i, j)))
        .map(|(i, j)| [-0.31 + 0.0413 * i as f64, -0.33 + 0.0419 * j as f64])
}

fn near(p: Point, q: Point) -> bool {
    (p[0] - q[0]).abs() < 1e-9 && (p[1] - q[1]).abs() < 1e-9
}

fn same_stacks(x: &[(Point, bool)], y: &[(Point, bool)]) -> bool {
    x.len() == y.len() && x.iter().zip(y).all(|(s, t)| near(s.0, t.0) && s.1 == t.1)
}

/// V = (0.4, 0.8), where a corner's fold ends on its raw edge.
const V: Point = [0.4, 0.8];

/// The top-left corner folded over in front onto (0.4, 0.6) (the corner's
/// raw edges land on y = 0.6 and x = 0.4), then the top strip folded behind
/// on y = 0.8 through it: left of V the corner's fold wraps the sheet's and
/// ends at V, on its raw edge x = 0.4; the sheet's runs on. Without the
/// corner, the sheet's fold alone.
fn corner_wrapping_one_side(corner: bool) -> State {
    let flat = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let base = if corner {
        fold(
            &flat,
            &all(
                through([0.0, 0.6], [0.4, 1.0]),
                [0.1, 0.9],
                Direction::Valley,
            ),
        )
        .state
    } else {
        flat
    };
    fold(&base, &all(y_eq(0.8), [0.5, 0.95], Direction::Mountain)).state
}

/// Whether the sheet point `s` is the corner's paper.
fn in_corner(s: Point) -> bool {
    s[1] - s[0] > 0.6 + 1e-9
}

#[test]
fn a_ply_that_ends_at_the_vertex_beside_the_fold_is_passed_over() {
    let state = corner_wrapping_one_side(true);
    let plain = corner_wrapping_one_side(false);
    let mut compared = 0;
    // The two whose fold opens on the right of V, away from the corner: the
    // line nearer the right half is the one off the hinge.
    let (steep, shallow) = ([0.5, 0.5], [0.6, 0.65]);
    for (valley, mountain, kind) in [
        (steep, shallow, SwivelKind::Open),
        (shallow, steep, SwivelKind::Inside),
    ] {
        let swivel = op(V, valley, mountain, kind);
        let a = state.analyse_swivel_valley_mountain(&swivel).unwrap();
        assert!(near(a.vertex, V));
        assert!(a.fold.opens[1][0] > V[0], "{:?}", a.fold.opens);
        // The sheet's fold, not the corner's.
        assert_eq!(a.layers.len(), 2);
        let folds = landed(&state, &swivel);
        let alone = landed(&plain, &swivel);
        assert!(!folds.is_empty(), "{valley:?} {kind:?}");
        assert!(!alone.is_empty(), "{valley:?} {kind:?}");
        let sheet_at = |state: &State, p: Point| -> Vec<(Point, bool)> {
            paper_at(state, p)
                .into_iter()
                .filter(|(s, _)| !in_corner(*s))
                .collect()
        };
        let corner_at = |state: &State, p: Point| -> Vec<(Point, bool)> {
            paper_at(state, p)
                .into_iter()
                .filter(|(s, _)| in_corner(*s))
                .collect()
        };
        for folded in &folds {
            support::assert_valid(&folded.state);
            // The swivel the sheet makes without the corner (in one of its
            // orders: the corner may add choices of its own), and the corner
            // left where it was.
            assert!(
                alone.iter().any(|without| samples().all(|p| same_stacks(
                    &sheet_at(&folded.state, p),
                    &sheet_at(&without.state, p)
                ))),
                "{valley:?} {kind:?}"
            );
            for p in samples() {
                assert!(
                    same_stacks(&corner_at(&folded.state, p), &corner_at(&state, p)),
                    "{valley:?} {kind:?} {p:?}"
                );
            }
            let replay = cases::every(state.swivel_valley_mountain(&swivel, &folded.report.stored));
            assert!(
                samples().all(|p| same_stacks(
                    &paper_at(&replay[0].state, p),
                    &paper_at(&folded.state, p)
                ))
            );
            compared += 1;
        }
    }
    assert!(compared >= 2);
}

/// W = (0.5, 0.8), where the two corners' folds end over the sheet's.
const W: Point = [0.5, 0.8];

/// Both top corners folded over in front, their raw edges meeting on x =
/// 1/2, then the top strip folded behind on y = 0.8 through them: at W
/// both corners' folds end, and the sheet's runs on hidden under them.
fn corners_over_the_fold() -> State {
    let flat = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let left = fold(
        &flat,
        &all(
            through([0.0, 0.5], [0.5, 1.0]),
            [0.1, 0.9],
            Direction::Valley,
        ),
    )
    .state;
    let right = fold(
        &left,
        &all(
            through([1.0, 0.5], [0.5, 1.0]),
            [0.9, 0.9],
            Direction::Valley,
        ),
    )
    .state;
    fold(&right, &all(y_eq(0.8), [0.5, 0.95], Direction::Mountain)).state
}

#[test]
fn where_every_fold_in_view_ends_the_hidden_fold_through_the_vertex_swivels() {
    let state = corners_over_the_fold();
    let swivel = op(W, [0.6, 0.6], [0.6, 0.7], SwivelKind::Open);
    let a = state.analyse_swivel_valley_mountain(&swivel).unwrap();
    assert!(near(a.vertex, W));
    // The sheet's two layers at the fold, hidden under the corners, not a
    // corner's.
    assert_eq!(a.layers.len(), 2);
    let corner = |s: Point| s[1] - s[0] > 0.5 + 1e-9 || s[1] + s[0] > 1.5 + 1e-9;
    for &id in &a.layers {
        let t = state.isometry(id).unwrap();
        assert!(!corner(t.inverse().apply([0.55, 0.75])), "{id:?}");
    }
    let folds = landed(&state, &swivel);
    assert!(!folds.is_empty());
    for folded in &folds {
        support::assert_valid(&folded.state);
        let replay = cases::every(state.swivel_valley_mountain(&swivel, &folded.report.stored));
        for p in samples() {
            assert!(same_stacks(
                &paper_at(&replay[0].state, p),
                &paper_at(&folded.state, p)
            ));
        }
    }
}
