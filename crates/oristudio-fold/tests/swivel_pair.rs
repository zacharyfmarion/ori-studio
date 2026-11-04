//! Two swivels by their valleys and mountains made together where they
//! share a crease (`compound::swivel_pair`): a square's side strips folded
//! to the middle, then the bottom strip swivelled up with a corner squashed
//! out on each side, the shared crease behind the flaps (they are in front)
//! or across the layer in front (they are behind).
mod beloch;
mod support;
mod vertex;
use oristudio_fold::{
    CompoundRefused, CreaseKind, Direction, FoldRefusal, Sheet, StartSide, State, SwivelKind,
    SwivelPair, SwivelShared, SwivelValleyMountain, VertexChoices, VertexFolded,
};
use oristudio_geometry::Line;
use support::{all, fold, x_eq};
use vertex::cases;

type Point = [f64; 2];

const LEFT: Point = [0.25, 0.25];
const RIGHT: Point = [0.75, 0.25];

/// The square with its two side strips folded to the middle on x = 1/4 and
/// x = 3/4: in front (valley) or behind (mountain). Its folded edges are
/// x = 1/4 and x = 3/4, and the figure is symmetric about x = 1/2.
fn cupboard(direction: Direction) -> State {
    let flat = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let one = fold(&flat, &all(x_eq(0.25), [0.1, 0.5], direction)).state;
    fold(&one, &all(x_eq(0.75), [0.9, 0.5], direction)).state
}

/// The line from the vertex `v` toward `to`, mirrored for the right vertex
/// when `to` is given for the left.
fn ray(v: Point, to: Point) -> Line {
    let to = if v == RIGHT { [1.0 - to[0], to[1]] } else { to };
    Line::from_points(v, to).unwrap()
}

/// With the flaps in front, each flap's valley runs up to the middle and its
/// mountain down to the bottom edge's middle: the crease behind them is the
/// one across, y = 1/4, shared.
fn shared_behind(v: Point) -> SwivelValleyMountain {
    SwivelValleyMountain {
        valley: ray(v, [0.5, 0.5]),
        mountain: ray(v, [0.5, 0.0]),
        kind: SwivelKind::Open,
    }
}

/// With the flaps behind, the valley runs across the layer in front from one
/// folded edge to the other, y = 1/4, shared, and each mountain down.
fn shared_in_front(v: Point) -> SwivelValleyMountain {
    SwivelValleyMountain {
        valley: ray(v, [0.5, 0.25]),
        mountain: ray(v, [0.5, 0.0]),
        kind: SwivelKind::Open,
    }
}

fn landed(state: &State, op: &SwivelPair) -> Vec<VertexFolded> {
    cases::every(state.swivel_pair(op, &VertexChoices::default()))
}

fn single(state: &State, op: &SwivelValleyMountain) -> State {
    let mut folds = cases::every(state.swivel_valley_mountain(op, &VertexChoices::default()));
    assert_eq!(folds.len(), 1);
    folds.remove(0).state
}

fn refusal(state: &State, op: &SwivelPair) -> FoldRefusal {
    match state.swivel_pair(op, &VertexChoices::default()) {
        Err(CompoundRefused::Refused(refused)) => refused.refusal,
        other => panic!("not refused: {:?}", other.map(|_| ())),
    }
}

/// Points along every folded crease of `state`, a quarter and three
/// quarters along, with the crease's kind.
fn crease_samples(state: &State) -> Vec<(Point, CreaseKind)> {
    state
        .creases()
        .iter()
        .filter(|c| c.kind.is_folded())
        .flat_map(|c| {
            let [a, b] = c.vertices.map(|v| state.vertices()[v.0 as usize]);
            [0.25, 0.75].map(|t| ([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], c.kind))
        })
        .collect()
}

fn kind_at(state: &State, p: Point) -> Option<CreaseKind> {
    state.crease_at(p).map(|c| c.kind).filter(|k| k.is_folded())
}

/// The pair's folded creases are, on each half of the sheet, the ones that
/// half's swivel makes alone: each swivel's own creases, and none of what a
/// single swivel does to the other side.
fn creases_are_each_swivels_own(pair: &State, left: &State, right: &State) {
    let own = |p: Point| if p[0] < 0.5 { left } else { right };
    for (p, kind) in crease_samples(pair) {
        assert_eq!(kind_at(own(p), p), Some(kind), "the pair's crease at {p:?}");
    }
    for (state, half) in [(left, true), (right, false)] {
        for (p, kind) in crease_samples(state) {
            if (p[0] < 0.5) == half && (p[0] - 0.5).abs() > 1e-9 {
                assert_eq!(kind_at(pair, p), Some(kind), "the swivel's crease at {p:?}");
            }
        }
    }
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
    (0..47)
        .flat_map(|i| (0..47).map(move |j| (i, j)))
        .map(|(i, j)| [-0.31 + 0.0337 * i as f64, -0.33 + 0.0341 * j as f64])
}

/// The figure is its own mirror image across x = 1/2: every stack the
/// mirror of the one across, layer for layer.
fn mirror_symmetric(state: &State) -> bool {
    let near = |p: Point, q: Point| (p[0] - q[0]).abs() < 1e-9 && (p[1] - q[1]).abs() < 1e-9;
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
    let near = |p: Point, q: Point| (p[0] - q[0]).abs() < 1e-9 && (p[1] - q[1]).abs() < 1e-9;
    samples().all(|p| {
        let (x, y) = (paper_at(a, p), paper_at(b, p));
        x.len() == y.len() && x.iter().zip(&y).all(|(s, t)| near(s.0, t.0) && s.1 == t.1)
    })
}

fn check_pair(state: &State, swivel: fn(Point) -> SwivelValleyMountain) {
    let pair = SwivelPair {
        swivels: [swivel(LEFT), swivel(RIGHT)],
    };
    let folds = landed(state, &pair);
    assert_eq!(folds.len(), 1);
    let folded = &folds[0];
    support::assert_valid(&folded.state);
    let (left, right) = (single(state, &swivel(LEFT)), single(state, &swivel(RIGHT)));
    creases_are_each_swivels_own(&folded.state, &left, &right);
    assert!(mirror_symmetric(&folded.state));
    // Made one at a time, the first swivel carries the other side's flap:
    // not the same fold.
    assert!(!same_paper(&folded.state, &left));
    assert!(!mirror_symmetric(&left));
    // Named in the other order, the same fold; replayed, the same state.
    let swapped = SwivelPair {
        swivels: [swivel(RIGHT), swivel(LEFT)],
    };
    assert!(same_paper(&landed(state, &swapped)[0].state, &folded.state));
    let replay = cases::every(state.swivel_pair(&pair, &folded.report.stored));
    assert!(same_paper(&replay[0].state, &folded.state));
}

#[test]
fn two_flaps_swivelled_out_share_the_crease_behind_them() {
    check_pair(&cupboard(Direction::Valley), shared_behind);
}

#[test]
fn two_corners_squashed_out_share_the_valley_in_front() {
    check_pair(&cupboard(Direction::Mountain), shared_in_front);
}

#[test]
fn the_second_swivel_after_the_first_is_refused() {
    // Why the pair is one fold: once the first swivel has carried the other
    // flap, the second's lines meet where four folds end.
    for (direction, swivel) in [
        (
            Direction::Valley,
            shared_behind as fn(Point) -> SwivelValleyMountain,
        ),
        (Direction::Mountain, shared_in_front),
    ] {
        let first = single(&cupboard(direction), &swivel(LEFT));
        let second = swivel(RIGHT);
        let refused = first.swivel_valley_mountain(&second, &VertexChoices::default());
        assert!(
            matches!(&refused, Err(CompoundRefused::Refused(r)) if r.refusal == FoldRefusal::SwivelLineMeeting),
            "{direction:?}"
        );
    }
}

#[test]
fn two_swivels_at_one_vertex_are_refused() {
    let state = cupboard(Direction::Valley);
    let pair = SwivelPair {
        swivels: [shared_behind(LEFT), shared_behind(LEFT)],
    };
    assert_eq!(refusal(&state, &pair), FoldRefusal::SwivelLineMeeting);
}

#[test]
fn a_swivel_whose_lines_meet_on_no_folded_edge_refuses_the_pair() {
    let state = cupboard(Direction::Valley);
    let off = SwivelValleyMountain {
        valley: Line::from_points([0.4, 0.3], [0.5, 0.5]).unwrap(),
        mountain: Line::from_points([0.4, 0.3], [0.5, 0.0]).unwrap(),
        kind: SwivelKind::Open,
    };
    let pair = SwivelPair {
        swivels: [shared_behind(LEFT), off],
    };
    assert_eq!(refusal(&state, &pair), FoldRefusal::SwivelLineMeeting);
}

#[test]
fn crossing_creases_behind_are_refused() {
    // Named the other way up, each crease behind runs from its vertex up
    // and in, and the two cross in the layer behind: no motion folds that.
    let state = cupboard(Direction::Valley);
    let up = |v: Point| SwivelValleyMountain {
        valley: ray(v, [0.5, 0.0]),
        mountain: ray(v, [0.5, 0.25]),
        kind: SwivelKind::Open,
    };
    assert!(
        state
            .swivel_valley_mountain(&up(LEFT), &VertexChoices::default())
            .is_ok()
    );
    let pair = SwivelPair {
        swivels: [up(LEFT), up(RIGHT)],
    };
    assert!(state.swivel_pair(&pair, &VertexChoices::default()).is_err());
}

fn near(a: Point, b: Point) -> bool {
    (a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9
}

#[test]
fn a_swivel_names_the_other_end_of_the_crease_it_can_share() {
    // The crease behind runs on to the other flap's folded edge; the valley
    // in front, to the other folded edge.
    for (direction, swivel, shared) in [
        (
            Direction::Valley,
            shared_behind as fn(Point) -> SwivelValleyMountain,
            SwivelShared::Behind,
        ),
        (Direction::Mountain, shared_in_front, SwivelShared::Valley),
    ] {
        let state = cupboard(direction);
        for (here, there) in [(LEFT, RIGHT), (RIGHT, LEFT)] {
            let a = state.analyse_swivel_valley_mountain(&swivel(here)).unwrap();
            let end = a
                .other_end
                .unwrap_or_else(|| panic!("{direction:?} {here:?}"));
            assert!(near(end.vertex, there), "{direction:?}: {:?}", end.vertex);
            assert_eq!(end.shared, shared);
        }
    }
    // A swivel whose creases all run to the paper's raw edge has none.
    let flat = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let half = fold(&flat, &all(x_eq(0.5), [0.8, 0.5], Direction::Valley)).state;
    let lone = SwivelValleyMountain {
        valley: Line::from_points([0.5, 0.5], [0.1, 0.8]).unwrap(),
        mountain: Line::from_points([0.5, 0.5], [0.05, 0.1]).unwrap(),
        kind: SwivelKind::Open,
    };
    assert!(
        half.analyse_swivel_valley_mountain(&lone)
            .unwrap()
            .other_end
            .is_none()
    );
}

#[test]
fn the_pair_previews_both_swivels_and_the_crease_they_share_once() {
    for (direction, swivel, shared) in [
        (
            Direction::Valley,
            shared_behind as fn(Point) -> SwivelValleyMountain,
            SwivelShared::Behind,
        ),
        (Direction::Mountain, shared_in_front, SwivelShared::Valley),
    ] {
        let state = cupboard(direction);
        let pair = SwivelPair {
            swivels: [swivel(LEFT), swivel(RIGHT)],
        };
        let a = state.analyse_swivel_pair(&pair).unwrap();
        assert!(near(a.vertex, LEFT));
        let end = a.other_end.unwrap();
        assert!(near(end.vertex, RIGHT) && end.shared == shared);
        // The two flaps, and the layer both share.
        assert_eq!(a.layers.len(), 3, "{direction:?}");
        assert!(!a.regions.is_empty());
        // Each swivel's two named creases, and the shared crease once along
        // the whole way between the vertices.
        let along_shared = |c: &oristudio_fold::SwivelCrease| {
            (c.from[1] - 0.25).abs() < 1e-9 && (c.to[1] - 0.25).abs() < 1e-9
        };
        let span: f64 = a
            .creases
            .iter()
            .filter(|c| along_shared(c))
            .map(|c| (c.to[0] - c.from[0]).abs())
            .sum();
        assert!((span - 0.5).abs() < 1e-9, "{direction:?}: {span}");
        let named = a.creases.iter().filter(|c| !along_shared(c)).count();
        assert!(named >= 4, "{direction:?}: {named}");
        // Its picture: the shared crease, the arrow from the strip across it.
        let picture = state.swivel_pair_action(&pair, None).unwrap();
        let [p, q] = picture.line.unwrap();
        assert!(
            (p.y - q.y).abs() < 1e-9,
            "{direction:?}: the picture's line is the shared crease"
        );
        assert!(picture.grip.is_some());
    }
}
