//! Swivels by their valleys and mountains whose lines meet where several
//! plies lie along one folded edge (`compound::swivel_valley_mountain`):
//! where the folds there do not settle the meeting — a ply that wraps the
//! fold on one side ends there on its raw edge, or every fold in view ends
//! there over a hidden one — the swivel folds on the fold that runs on
//! through the point. And two swivels made together whose wedges paper
//! beyond their four layers holds, read through the stack together. Read
//! either way, the plies nested in a swivel's folded edge through its vertex
//! open with it.
mod beloch;
mod support;
mod vertex;
use oristudio_fold::{
    Direction, Sheet, StartSide, State, SwivelKind, SwivelPair, SwivelValleyMountain,
    VertexChoices, VertexFolded,
};
use oristudio_geometry::Line;
use support::{all, depth, fold, through, top_sheet_point, x_eq, y_eq};
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

const LEFT: Point = [0.25, 0.25];
const RIGHT: Point = [0.75, 0.25];

/// The point `p` given for the left vertex, mirrored for the right one.
fn mirrored_for(v: Point, p: Point) -> Point {
    if v[0] > 0.5 { [1.0 - p[0], p[1]] } else { p }
}

/// #582's swivel with its flap in front: on the flap the valley up to the
/// middle and the mountain down to the bottom edge's middle; the crease
/// behind, y = 1/4, is shared.
fn shared_behind(v: Point) -> SwivelValleyMountain {
    op(
        v,
        mirrored_for(v, [0.5, 0.5]),
        mirrored_for(v, [0.5, 0.0]),
        SwivelKind::Open,
    )
}

fn pair_landed(state: &State, pair: &SwivelPair) -> Vec<VertexFolded> {
    cases::every(state.swivel_pair(pair, &VertexChoices::default()))
}

/// The figure is its own mirror image across x = 1/2.
fn mirror_symmetric(state: &State) -> bool {
    let mirror = |p: Point| [1.0 - p[0], p[1]];
    samples().all(|p| {
        let (x, y) = (paper_at(state, p), paper_at(state, mirror(p)));
        x.len() == y.len()
            && x.iter()
                .zip(&y)
                .all(|(s, t)| near(mirror(s.0), t.0) && s.1 == t.1)
    })
}

fn same_paper(a: &State, b: &State) -> bool {
    samples().all(|p| same_stacks(&paper_at(a, p), &paper_at(b, p)))
}

/// #582's cupboard — the square's sides folded to the middle in front on
/// x = 1/4 and x = 3/4 — then each flap's strip along its raw edge folded
/// over it on x = 0.45 and x = 0.55. Each swivel's hinge and mountain run
/// from its vertex into that fold, and the strip, hinged to its flap all
/// along, joins the flap's wedges and the paper that stays: beyond the
/// four layers, it holds them.
fn cupboard_with_strips() -> State {
    let flat = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let one = fold(&flat, &all(x_eq(0.25), [0.1, 0.5], Direction::Valley)).state;
    let mut state = fold(&one, &all(x_eq(0.75), [0.9, 0.5], Direction::Valley)).state;
    for (x, p) in [(0.45, [0.48, 0.5]), (0.55, [0.52, 0.5])] {
        let at = top_sheet_point(&state, p);
        state = fold(&state, &depth(x_eq(x), p, Direction::Valley, at, 1)).state;
    }
    state
}

/// Whether the landed state has a folded crease, not along x, crossing the
/// sheet's strip `x` in (lo, hi): the strip creased along a ray.
fn strip_creased(state: &State, lo: f64, hi: f64) -> bool {
    state.creases().iter().any(|c| {
        let [a, b] = c.vertices.map(|v| state.vertices()[v.0 as usize]);
        let mid = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
        c.kind.is_folded() && (a[0] - b[0]).abs() > 1e-9 && mid[0] > lo && mid[0] < hi
    })
}

#[test]
fn a_pair_held_beyond_its_four_layers_folds_through_the_stack() {
    let state = cupboard_with_strips();
    let pair = SwivelPair {
        swivels: [shared_behind(LEFT), shared_behind(RIGHT)],
    };
    let folds = pair_landed(&state, &pair);
    assert_eq!(folds.len(), 1);
    let folded = &folds[0].state;
    support::assert_valid(folded);
    assert!(mirror_symmetric(folded));
    // Each strip is creased along its swivel's rays (on the sheet, the
    // strips are x < 0.05 and x > 0.95).
    assert!(strip_creased(folded, 0.0, 0.05));
    assert!(strip_creased(folded, 0.95, 1.0));
    // Not the first swivel alone, which carries the other side's flap.
    let alone = landed(&state, &shared_behind(LEFT));
    assert!(alone.iter().all(|one| !same_paper(&one.state, folded)));
    // Named in the other order, the same fold; replayed, the same state.
    let swapped = SwivelPair {
        swivels: [shared_behind(RIGHT), shared_behind(LEFT)],
    };
    assert!(same_paper(&pair_landed(&state, &swapped)[0].state, folded));
    let replay = cases::every(state.swivel_pair(&pair, &folds[0].report.stored));
    assert!(same_paper(&replay[0].state, folded));
}

/// The sheet points of the plies folded along the model line at `m`, a
/// point of a folded edge whose paper lies on the side of `inward`: each
/// layer just inside the paper there, taken back to the sheet (a ply's two
/// layers meet at one sheet point).
fn plies_at(state: &State, m: Point, inward: Point) -> Vec<Point> {
    let probe = [m[0] + 1e-4 * inward[0], m[1] + 1e-4 * inward[1]];
    let mut points: Vec<Point> = Vec::new();
    for id in state.stack_at(probe).unwrap_or_default() {
        let s = state.isometry(id).unwrap().inverse().apply(m);
        if !points
            .iter()
            .any(|&q| (q[0] - s[0]).hypot(q[1] - s[1]) < 1e-7)
        {
            points.push(s);
        }
    }
    points
}

fn folded_at(state: &State, s: Point) -> bool {
    state.crease_at(s).is_some_and(|c| c.kind.is_folded())
}

/// Every ply's fold lies flat along the half of the folded edge that opens
/// (through `open`, `plies` of them) and stays folded along the other
/// (through `stays`, `folds` of them).
fn every_ply_opens(
    (before, after): (&State, &State),
    (open, plies): (Point, usize),
    (stays, folds): (Point, usize),
    inward: Point,
) {
    let opening = plies_at(before, open, inward);
    let staying = plies_at(before, stays, inward);
    assert_eq!(opening.len(), plies, "{opening:?}");
    assert_eq!(staying.len(), folds, "{staying:?}");
    assert!(opening.iter().all(|&s| folded_at(before, s)));
    assert!(opening.iter().all(|&s| !folded_at(after, s)), "{opening:?}");
    assert!(staying.iter().all(|&s| folded_at(after, s)), "{staying:?}");
}

/// The square folded in half twice, the top down each time, then both
/// sides to the middle through all four layers, in front or behind: four
/// plies nested in each side's folded edge, x = 1/4 and x = 3/4, over the
/// stack's height y in [0, 1/4].
fn four_ply_cupboard(direction: Direction) -> State {
    let flat = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let half = fold(&flat, &all(y_eq(0.5), [0.5, 0.8], Direction::Valley)).state;
    let quarter = fold(&half, &all(y_eq(0.25), [0.5, 0.4], Direction::Valley)).state;
    let one = fold(&quarter, &all(x_eq(0.25), [0.1, 0.125], direction)).state;
    fold(&one, &all(x_eq(0.75), [0.9, 0.125], direction)).state
}

#[test]
fn plies_nested_in_each_folded_edge_open_with_the_pair() {
    let (low, high) = ([0.25, 0.0625], [0.25, 0.1875]);
    // On the layer in front, the valley across to the middle (shared) and
    // the mountain down; inside with the flaps in front (the half above
    // each vertex opens), open with them behind (the half below).
    for (direction, kind, open, stays) in [
        (Direction::Valley, SwivelKind::Inside, high, low),
        (Direction::Mountain, SwivelKind::Open, low, high),
    ] {
        let state = four_ply_cupboard(direction);
        let swivel = |v: Point| {
            let v = [v[0], 0.125];
            op(
                v,
                mirrored_for(v, [0.5, 0.125]),
                mirrored_for(v, [0.375, 0.0]),
                kind,
            )
        };
        let pair = SwivelPair {
            swivels: [swivel(LEFT), swivel(RIGHT)],
        };
        let folds = pair_landed(&state, &pair);
        assert!(!folds.is_empty(), "{direction:?}");
        for folded in &folds {
            support::assert_valid(&folded.state);
            // All four plies at each vertex, the left's and the mirror image.
            let states = (&state, &folded.state);
            every_ply_opens(states, (open, 4), (stays, 4), [1.0, 0.0]);
            let mirror = |p: Point| [1.0 - p[0], p[1]];
            every_ply_opens(states, (mirror(open), 4), (mirror(stays), 4), [-1.0, 0.0]);
            let replay = cases::every(state.swivel_pair(&pair, &folded.report.stored));
            assert!(same_paper(&replay[0].state, &folded.state));
        }
        assert!(
            folds.iter().any(|f| mirror_symmetric(&f.state)),
            "{direction:?}"
        );
    }
}

/// U = (0.45, 0.85), where a corner's fold ends over four nested plies.
const U: Point = [0.45, 0.85];

/// Four layers on x in [1/4, 1/2] (the square folded in half on x = 1/2,
/// then that on x = 1/4); the top layer's corner folded over in front, its
/// raw edges landing on y = 0.8 and x = 0.45; then the top strip folded
/// behind on y = 0.85 through all of it. Along y = 0.85 four plies nested
/// in one another run on through U, and left of U the corner's fold wraps
/// them and ends at U on its raw edge.
fn plies_under_a_corner() -> State {
    let flat = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let half = fold(&flat, &all(x_eq(0.5), [0.8, 0.5], Direction::Valley)).state;
    let quarter = fold(&half, &all(x_eq(0.25), [0.1, 0.5], Direction::Valley)).state;
    let p = [0.27, 0.95];
    let at = top_sheet_point(&quarter, p);
    let corner = fold(
        &quarter,
        &depth(
            through([0.25, 0.8], [0.45, 1.0]),
            p,
            Direction::Valley,
            at,
            1,
        ),
    )
    .state;
    fold(&corner, &all(y_eq(0.85), [0.35, 0.95], Direction::Mountain)).state
}

#[test]
fn plies_nested_in_the_fold_through_the_vertex_open_with_it() {
    let state = plies_under_a_corner();
    // The two whose fold opens right of U, away from the corner: the line
    // nearer that half is the one off the hinge.
    let (steep, shallow) = ([0.25, 0.7], [0.35, 0.75]);
    for (valley, mountain, kind) in [
        (steep, shallow, SwivelKind::Open),
        (shallow, steep, SwivelKind::Inside),
    ] {
        let swivel = op(U, valley, mountain, kind);
        let a = state.analyse_swivel_valley_mountain(&swivel).unwrap();
        assert!(near(a.vertex, U));
        // The half right of U opens, away from the corner.
        assert!(a.fold.opens[1][0] > U[0], "{:?}", a.fold.opens);
        let folds = landed(&state, &swivel);
        assert!(!folds.is_empty(), "{valley:?} {kind:?}");
        for folded in &folds {
            support::assert_valid(&folded.state);
            // The four plies open right of U, and stay folded left of it,
            // where the corner's four plies wrap them too.
            every_ply_opens(
                (&state, &folded.state),
                ([0.475, 0.85], 4),
                ([0.4, 0.85], 8),
                [0.0, -1.0],
            );
            let replay = cases::every(state.swivel_valley_mountain(&swivel, &folded.report.stored));
            assert!(same_paper(&replay[0].state, &folded.state));
        }
    }
}
