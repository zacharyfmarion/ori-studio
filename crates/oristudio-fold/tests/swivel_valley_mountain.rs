mod beloch;
mod support;
mod vertex;
use oristudio_fold::{
    CompoundRefused, CreaseKind, Direction, FoldRefusal, Letter, SegmentKind, State, SwivelByEdge,
    SwivelKind, SwivelRay, SwivelValleyMountain, VertexChoices, VertexFolded,
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

/// The folded square with its bottom left corner, both layers, valley
/// folded up along the line from (0, 3/4) to (3/8, 0): the corner lands at
/// (3/5, 3/10), past the folded edge, and the flap's raw edge from there to
/// (0, 3/4) crosses the folded edge at (1/2, 3/8), hiding it below there
/// down to (1/2, 1/6).
fn spine_crossed_by_a_flap() -> State {
    use support::*;
    let corner = through([0.0, 0.75], [0.375, 0.0]);
    fold(
        &folded_square(),
        &all(corner, [0.05, 0.05], Direction::Valley),
    )
    .state
}

/// Where the flap's edge crosses the folded edge.
const CROSSING: [f64; 2] = [0.5, 0.375];

/// The letter of the crease `after` has at the sheet point `at`, as the
/// viewer saw the face holding it `before` it folded: its own on a face
/// showing its front, the other on one showing its back (the view is not
/// turned over).
fn letter_seen(before: &State, after: &State, at: [f64; 2]) -> Letter {
    let crease = after
        .crease_at(at)
        .unwrap_or_else(|| panic!("no crease at {at:?}"));
    let CreaseKind::Folded(letter) = crease.kind else {
        panic!("the crease at {at:?} is not folded: {:?}", crease.kind);
    };
    let front_up = before
        .face_at(at)
        .and_then(|f| before.front_up(f))
        .unwrap_or_else(|| panic!("no face at {at:?}"));
    match (letter, front_up) {
        (letter, true) => letter,
        (Letter::Valley, false) => Letter::Mountain,
        (Letter::Mountain, false) => Letter::Valley,
    }
}

#[test]
fn the_lines_can_meet_where_a_layers_edge_crosses_the_folded_edge() {
    use support::*;
    let state = spine_crossed_by_a_flap();
    // The landmarks see the crossing, the corner the flap's edge makes with
    // the folded edge, though they measure the folded edge's visible part a
    // probe inside its layers, where it starts a little above the crossing.
    let landmarks = state.landmarks(&[]);
    let crossing = landmarks
        .points
        .iter()
        .find(|p| (p.at[0] - CROSSING[0]).hypot(p.at[1] - CROSSING[1]) < 1e-9)
        .expect("the crossing is a point");
    assert!(crossing.visible);
    let spine = landmarks
        .segments
        .iter()
        .find(|s| {
            s.kind == SegmentKind::Bend
                && s.at.iter().all(|p| (p[0] - 0.5).abs() < 1e-12)
                && s.at.iter().any(|p| p[1] > 0.9)
        })
        .expect("the folded edge above the crossing");
    let along = |y: f64| {
        let [a, b] = spine.at;
        (y - a[1]) / (b[1] - a[1])
    };
    let shown = spine
        .visible
        .iter()
        .find(|[lo, hi]| lo.min(*hi) < along(0.9) && along(0.9) < lo.max(*hi));
    let [lo, hi] = *shown.expect("the folded edge is in view above the crossing");
    let starts = if along(1.0) > along(0.0) { lo } else { hi };
    let gap = (starts - along(CROSSING[1])).abs() * (spine.at[1][1] - spine.at[0][1]).abs();
    assert!(gap > 1e-6 && gap < 1e-3 / 2.0, "{gap}");
    // On the layer in front, the mountain toward (3/8, 1) and the valley
    // toward (1/8, 1): the strip between them swung over, open.
    let op = SwivelValleyMountain {
        valley: through(CROSSING, [0.125, 1.0]),
        mountain: through(CROSSING, [0.375, 1.0]),
        kind: SwivelKind::Open,
    };
    let analysis = state
        .analyse_swivel_valley_mountain(&op)
        .unwrap_or_else(|e| panic!("refused: {:?}", e.refusal));
    assert!((analysis.vertex[0] - 0.5).abs() < 1e-12 && (analysis.vertex[1] - 0.375).abs() < 1e-12);
    let folds = landed(&state, &op);
    assert!(!folds.is_empty());
    for folded in &folds {
        // Flat: the full gate, from scratch.
        assert_valid(&folded.state);
        let after = &folded.state;
        // The front layer — the right half, turned over onto the left by the
        // book fold, so its sheet point is (1 − x, y) — creased as named, as
        // the viewer sees it.
        let front = |p: [f64; 2]| [1.0 - p[0], p[1]];
        let between = |p: [f64; 2], q: [f64; 2]| [(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0];
        let mountain_at = front(between(CROSSING, [0.375, 1.0]));
        let valley_at = front(between(CROSSING, [0.125, 1.0]));
        assert_eq!(letter_seen(&state, after, mountain_at), Letter::Mountain);
        assert_eq!(letter_seen(&state, after, valley_at), Letter::Valley);
        // The layer behind — the left half, which the book fold left where it
        // was, so its sheet point is (x, y) — creased along s = b − c from
        // the half of the folded edge that opens, the half above the crossing.
        let behind = analysis.creases[0].direction;
        let probe = [0.5 + 0.2 * behind[0], 0.375 + 0.2 * behind[1]];
        assert!(matches!(
            after.crease_at(probe).map(|c| c.kind),
            Some(CreaseKind::Folded(_))
        ));
        // The folded edge below the crossing, under the flap, still folded.
        assert!(matches!(kind_at(after, [0.5, 0.25]), CreaseKind::Folded(_)));
    }
}

/// The swivel the plain folded square takes in the tests above, open: on
/// the front layer the mountain down to the left and the valley up to the
/// left of the vertex (1/2, 1/2); the computed crease behind runs left and a
/// little down from it.
fn square_swivel() -> SwivelValleyMountain {
    SwivelValleyMountain {
        valley: Line::from_points([0.5, 0.5], [0.1, 0.8]).unwrap(),
        mountain: Line::from_points([0.5, 0.5], [0.05, 0.1]).unwrap(),
        kind: SwivelKind::Open,
    }
}

/// Whether a landed state has a folded crease through the sheet point `at`.
fn folded_at(state: &State, at: [f64; 2]) -> bool {
    matches!(
        state.crease_at(at).map(|c| c.kind),
        Some(CreaseKind::Folded(_))
    )
}

/// The layer behind folded back on itself first: its strip left of x = 1/5
/// mountain folded behind it. The crease the swivel computes behind runs
/// from the vertex into that fold, and the strip, hinged to the layer along
/// the whole fold, holds the wedge that swings and the paper that stays
/// together. It is creased along the same model ray — on its own sheet, the
/// ray reflected in the fold — and the swivel lands flat.
#[test]
fn a_crease_runs_on_through_a_layer_folded_back_where_it_meets_a_fold() {
    use support::*;
    let state = folded_square();
    let behind = state.stack_at([0.1, 0.5]).unwrap().len();
    let strip = fold(
        &state,
        &depth(x_eq(0.2), [0.1, 0.5], Direction::Mountain, [0.1, 0.5], 1),
    )
    .state;
    assert_eq!(behind, 2);
    let op = square_swivel();
    let analysis = strip
        .analyse_swivel_valley_mountain(&op)
        .unwrap_or_else(|e| panic!("refused: {:?}", e.refusal));
    // The crease behind ends at the fold, where the strip is folded back.
    let behind_to = analysis
        .creases
        .iter()
        .rev()
        .find(|c| c.ray == SwivelRay::Meet && c.hidden);
    assert!(behind_to.is_some());
    let folds = landed(&strip, &op);
    assert!(!folds.is_empty());
    // The ray meets the fold at height 1/2 − 3/10 · tan, and its reflection
    // in x = 1/5 crosses the strip to the raw edge: on the strip's sheet,
    // from (1/5, y0) to (0, y1).
    let s = analysis.creases[0].direction;
    let at = |x: f64| 0.5 + (x - 0.5) * s[1] / s[0];
    let (y0, y1) = (at(0.2), at(0.4));
    for folded in &folds {
        assert_valid(&folded.state);
        assert!(
            folded_at(&folded.state, [0.1, (y0 + y1) / 2.0]),
            "the strip is creased along the ray"
        );
        // Its fold to the layer stays folded on both sides of the crease.
        assert!(folded_at(&folded.state, [0.2, 0.2]));
        assert!(folded_at(&folded.state, [0.2, 0.8]));
        let replay = cases::every(strip.swivel_valley_mountain(&op, &folded.report.stored));
        assert!(same(&replay[0].state, &folded.state));
    }
    // Without the strip, the same swivel creases its two layers only.
    let plain = landed(&state, &op);
    assert!(plain.iter().all(|f| f.report.fold.created.len() == 3));
}

/// The square folded in quarters, the top half down and then the right half
/// over: along x = 1/2 two folded edges lie nested, the outer one joining
/// the top and bottom layers of the stack, the inner one the two between.
/// The swivel names the outer one's front layer; the inner pair is hinged
/// to the two layers along the half of the folded edge that opens and to the
/// paper that stays along the half that does not, so it opens with it, each
/// of its layers creased with the outer layer it lies against.
#[test]
fn a_fold_nested_in_the_folded_edge_opens_with_it() {
    use support::*;
    let flat = State::flat(
        oristudio_fold::Sheet::square(),
        oristudio_fold::StartSide::Front,
    )
    .unwrap();
    let half = fold(&flat, &all(y_eq(0.5), [0.5, 0.8], Direction::Valley)).state;
    let quarter = fold(&half, &all(x_eq(0.5), [0.8, 0.25], Direction::Valley)).state;
    assert_eq!(quarter.stack_at([0.25, 0.25]).unwrap().len(), 4);
    // On the front layer the valley down to the left and the mountain up to
    // the left of (1/2, 1/4): the half of the folded edge above opens.
    let op = SwivelValleyMountain {
        valley: Line::from_points([0.5, 0.25], [0.2, 0.0]).unwrap(),
        mountain: Line::from_points([0.5, 0.25], [0.1, 0.45]).unwrap(),
        kind: SwivelKind::Open,
    };
    let analysis = quarter
        .analyse_swivel_valley_mountain(&op)
        .unwrap_or_else(|e| panic!("refused: {:?}", e.refusal));
    assert_eq!(analysis.layers.len(), 2);
    let folds = landed(&quarter, &op);
    assert!(
        !folds.is_empty(),
        "{:?}",
        quarter.swivel_valley_mountain(&op, &VertexChoices::default())
    );
    for folded in &folds {
        assert_valid(&folded.state);
        // Every layer is creased: three creases in each pair's two layers.
        assert_eq!(folded.report.fold.created.len(), 6);
        // Both folds lie flat along the half that opens — the outer pair's
        // at sheet height 0.4, the inner pair's (its sheet turned down by
        // the first fold) at 0.6 — and stay folded along the other half.
        let state = &folded.state;
        assert!(!folded_at(state, [0.5, 0.4]) && !folded_at(state, [0.5, 0.6]));
        assert!(folded_at(state, [0.5, 0.05]) && folded_at(state, [0.5, 0.95]));
    }
}

/// The folded square with its front layer's left strip folded over along
/// x = 1/4, so that strip's raw edge lies along the folded edge and covers
/// it: no part of the folded edge is in view. The lines still meet on it,
/// and the strip, hinged to the front layer, is creased with it.
#[test]
fn the_lines_can_meet_on_a_folded_edge_hidden_under_a_layer() {
    use support::*;
    let book = folded_square();
    let covered = fold(
        &book,
        &depth(
            x_eq(0.25),
            [0.1, 0.5],
            Direction::Valley,
            top_sheet_point(&book, [0.1, 0.5]),
            1,
        ),
    )
    .state;
    let op = square_swivel();
    let analysis = covered
        .analyse_swivel_valley_mountain(&op)
        .unwrap_or_else(|e| panic!("refused: {:?}", e.refusal));
    assert!(support::close(analysis.vertex, [0.5, 0.5]));
    let folds = landed(&covered, &op);
    assert!(!folds.is_empty());
    for folded in &folds {
        assert_valid(&folded.state);
        // The two layers' three creases, and the strip's two along the
        // front layer's.
        assert_eq!(folded.report.fold.created.len(), 5);
    }
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

/// The paper stacked at the model point `p`, top first: each layer's sheet
/// point and whether it shows its front.
fn paper_at(state: &State, p: [f64; 2]) -> Vec<([f64; 2], bool)> {
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

/// Two states hold the same paper, whatever their creases: the same sheet
/// points stacked the same way at every sample point.
fn same_paper(a: &State, b: &State) -> bool {
    let near = |p: [f64; 2], q: [f64; 2]| (p[0] - q[0]).abs() < 1e-9 && (p[1] - q[1]).abs() < 1e-9;
    (0..60)
        .flat_map(|i| (0..60).map(move |j| (i, j)))
        .map(|(i, j)| [-0.19 + 0.0237 * i as f64, -0.21 + 0.0241 * j as f64])
        .all(|p| {
            let (x, y) = (paper_at(a, p), paper_at(b, p));
            x.len() == y.len() && x.iter().zip(&y).all(|(s, t)| near(s.0, t.0) && s.1 == t.1)
        })
}

/// The folded square swivelled at (1/2, 1/2) by its valley at `valley`
/// degrees and its mountain at `mountain`, open: four folds end there, the
/// strip between the front layer's two.
fn swivelled_square(valley: f64, mountain: f64) -> State {
    use support::at_angle;
    let op = SwivelValleyMountain {
        valley: at_angle([0.5, 0.5], valley),
        mountain: at_angle([0.5, 0.5], mountain),
        kind: SwivelKind::Open,
    };
    landed(&folded_square(), &op).remove(0).state
}

/// The model line of the sheet ray from (1/2, 1/2) at `degrees`, through
/// the paper it runs in.
fn sheet_ray(state: &State, degrees: f64) -> Line {
    let (s, c) = degrees.to_radians().sin_cos();
    let at = |r: f64| state.image_of([0.5 + r * c, 0.5 + r * s]).unwrap();
    Line::from_points(at(0.05), at(0.2)).unwrap()
}

fn turn(valley: f64, mountain: f64, kind: SwivelKind) -> SwivelValleyMountain {
    let first = swivelled_square(120.0, 200.0);
    SwivelValleyMountain {
        valley: sheet_ray(&first, valley),
        mountain: sheet_ray(&first, mountain),
        kind,
    }
}

#[test]
fn a_strip_turned_about_the_end_of_its_hinges_is_a_wider_swivel() {
    // The strip's hinges run at 340° and 60° on the sheet. Ten degrees
    // inside each, the strip turns 20° round the vertex: the swivel whose
    // lines lie 10° further round.
    let first = swivelled_square(120.0, 200.0);
    let wider = swivelled_square(130.0, 210.0);
    let op = turn(330.0, 50.0, SwivelKind::Open);
    let a = first.analyse_swivel_valley_mountain(&op).unwrap();
    assert!((a.vertex[0] - 0.5).abs() < 1e-9 && (a.vertex[1] - 0.5).abs() < 1e-9);
    // The crease on the strip, then the one in the layer it takes paper from.
    let letters: Vec<Letter> = a.creases.iter().map(|c| c.letter).collect();
    assert_eq!(letters, vec![Letter::Mountain, Letter::Valley]);
    assert!(!a.regions.is_empty());
    let turned = landed(&first, &op);
    assert_eq!(turned.len(), 1);
    support::assert_valid(&turned[0].state);
    assert!(same_paper(&turned[0].state, &wider));
    let replay = cases::every(first.swivel_valley_mountain(&op, &turned[0].report.stored));
    assert!(same(&replay[0].state, &turned[0].state));
}

#[test]
fn the_other_kind_turns_the_strip_the_other_way() {
    let first = swivelled_square(120.0, 200.0);
    let turned = landed(&first, &turn(330.0, 50.0, SwivelKind::Inside));
    assert_eq!(turned.len(), 1);
    support::assert_valid(&turned[0].state);
    assert!(!same_paper(
        &turned[0].state,
        &swivelled_square(130.0, 210.0)
    ));
}

#[test]
fn the_crease_in_the_layer_is_computed_from_the_one_on_the_strip() {
    // Open, the mountain is the crease on the strip and sets the turn; the
    // valley only has to run into the strip. Named 15° off, the turn and its
    // computed crease are the ones named exactly.
    let first = swivelled_square(120.0, 200.0);
    let exact = turn(330.0, 50.0, SwivelKind::Open);
    let rough = turn(345.0, 50.0, SwivelKind::Open);
    let a = first.analyse_swivel_valley_mountain(&exact).unwrap();
    let b = first.analyse_swivel_valley_mountain(&rough).unwrap();
    for (p, q) in a.creases.iter().zip(&b.creases) {
        assert!((p.direction[0] - q.direction[0]).abs() < 1e-9);
        assert!((p.direction[1] - q.direction[1]).abs() < 1e-9);
    }
    // The computed crease runs along the exact valley.
    let valley = exact.valley;
    let computed = Line::from_point_direction(b.vertex, b.creases[1].direction).unwrap();
    assert!(computed.approx_eq_within(&valley, 1e-9));
    let (x, y) = (landed(&first, &exact), landed(&first, &rough));
    assert!(same(&x[0].state, &y[0].state));
}

#[test]
fn the_crease_on_the_strip_keeps_its_hinges_letter() {
    let first = swivelled_square(120.0, 200.0);
    // The letters the other way round: the mountain at 330° would keep the
    // valley hinge's letter, so the strip does not turn. The mountain lies on
    // the layer in view across the strip's hinge at 340°, whose hinges (340°
    // and 190°) both show it mountains: that layer turns 10° round instead.
    let ray = |degrees: f64| {
        let (s, c) = degrees.to_radians().sin_cos();
        [0.5 + 0.1 * c, 0.5 + 0.1 * s]
    };
    let turned = landed(&first, &turn(50.0, 330.0, SwivelKind::Open));
    assert_eq!(turned.len(), 1);
    let after = &turned[0].state;
    support::assert_valid(after);
    assert!(folded_at(after, ray(60.0)) && !folded_at(after, ray(350.0)));
    assert!(folded_at(after, ray(330.0)) && folded_at(after, ray(180.0)));
    assert!(!folded_at(after, ray(340.0)) && !folded_at(after, ray(190.0)));
}
