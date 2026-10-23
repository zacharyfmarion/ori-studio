//! The engine's output and queries (plan D12, D14): the scene, a fold's
//! action geometry, the cross-section with its display layers, the
//! depth-choice preview and the per-step summaries.
//!
//! Hand-built states with exact expectations (the precrease-row cases D14
//! asks for among them), a golden scene for the kite base under
//! `tests/fixtures/scenes/` (regenerate with `ORISTUDIO_FOLD_BLESS=1` and
//! review the diff), and seeded random sequences that check every query
//! against the state it describes.

mod support;

use std::collections::BTreeSet;
use std::path::PathBuf;

use oristudio_fold::numerics::{MIN_FEATURE, TOL};
use oristudio_fold::random::Rng;
use oristudio_fold::{
    ActionKind, ClosurePolicy, CreaseKind, CrossSection, DepthChoice, Direction, FaceId,
    FoldRefusal, FoldScene, Folded, Isometry, PlainFold, RowOrder, ScenePoint, Seed, Sheet, Side,
    StartSide, State, VertexId,
};
use oristudio_geometry::Line;
use serde_json::Value;
use support::*;

use Direction::{Mountain, Valley};

fn square() -> State {
    State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"))
}

fn book() -> State {
    fold(&square(), &all(x_eq(0.5), [0.75, 0.5], Valley)).state
}

fn xy(p: ScenePoint) -> Point {
    p.into()
}

fn near(a: Point, b: Point) -> bool {
    (a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9
}

/// Within a few tolerances: the silhouette and the grip's reach are clipped
/// with the boundary grown by the tolerance.
fn about(a: Point, b: Point) -> bool {
    (a[0] - b[0]).abs() < 1e-5 && (a[1] - b[1]).abs() < 1e-5
}

fn section(state: &State, line: Line, toward: Point) -> CrossSection {
    state
        .cross_section(&line, side(&line, toward))
        .unwrap_or_else(|e| panic!("{e} ({:?})", e.refusal))
}

// --- The cross-section ----------------------------------------------------

/// D14's test: precrease a diagonal, then fold in half across it. The half
/// that folds is one physical layer of two faces, so it is one row.
#[test]
fn a_layer_crossed_by_a_precrease_is_one_row() {
    let diagonal = through([0.0, 0.0], [1.0, 1.0]);
    let pre = precrease(&square(), &all(diagonal, [0.9, 0.1], Valley)).state;
    assert_eq!(pre.faces().len(), 2);
    let s = section(&pre, x_eq(0.5), [0.75, 0.5]);
    assert_eq!(s.intervals.len(), 2, "cut where the diagonal crosses ℓ");
    assert_ne!(s.intervals[0].faces, s.intervals[1].faces);
    assert_eq!(s.rows.len(), 1);
    assert_eq!(s.rows[0].faces.len(), 2);
    assert_eq!(s.rows[0].spans, vec![[0.0, 1.0]]);
    assert!(s.intervals.iter().all(|i| i.rows == vec![0]));
    assert_eq!(s.layers, 1);
    assert_eq!(s.order, RowOrder::Layered { unordered: vec![] });
    // The section runs with the moving side (x > 0.5) on its left: downward.
    assert!(near(xy(s.from), [0.5, 1.0]) && near(xy(s.to), [0.5, 0.0]));
    // And the Step pane says the same of the fold.
    let folded = fold(&pre, &all(x_eq(0.5), [0.75, 0.5], Valley));
    let summary = folded.summary(&pre).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(summary.layers, Some(1));
}

/// Two layers, each crossed by one precrease: two rows of two faces, not
/// four rows.
#[test]
fn two_precreased_layers_are_two_rows() {
    // A book, precreased across both layers; sectioned on its free side,
    // away from the spine, so each layer is a flap of its own.
    let pre = precrease(&book(), &all(y_eq(0.5), [0.25, 0.75], Valley)).state;
    assert_eq!(pre.faces().len(), 4);
    let line = x_eq(0.25);
    let s = section(&pre, line, [0.1, 0.5]);
    assert_eq!(s.intervals.len(), 2);
    assert!(s.intervals.iter().all(|i| i.faces.len() == 2));
    assert_eq!(s.rows.len(), 2);
    assert!(s.rows.iter().all(|r| r.faces.len() == 2));
    assert_eq!(s.layers, 2);
    assert_eq!(s.order, RowOrder::Layered { unordered: vec![] });
    // The top row is the half the book fold moved: sheet x > 0.5.
    let top = &s.rows[0];
    for &f in &top.faces {
        let ring = &pre.face(f).unwrap_or_else(|| unreachable!()).ring;
        assert!(
            ring.iter()
                .all(|v| pre.vertices()[v.0 as usize][0] >= 0.5 - 1e-12)
        );
    }
    // Each row's faces share one isometry, and the rows are the two flaps.
    for row in &s.rows {
        let t: Vec<Isometry> = row.faces.iter().filter_map(|&f| pre.isometry(f)).collect();
        assert!(
            t.windows(2)
                .all(|w| w[0].distance_on(&w[1], [[0.0, 0.0], [1.0, 1.0]]) < 1e-12)
        );
        assert!(
            row.faces
                .iter()
                .all(|f| s.flaps[row.flap].faces.contains(f))
        );
    }
    assert_ne!(s.rows[0].flap, s.rows[1].flap);

    // "n of m layers moving": all, or the top one.
    let op = all(line, [0.1, 0.5], Valley);
    let everything = pre.analyse_fold(&op).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(s.moving_rows(&everything.moving), vec![0, 1]);
    let at = top_sheet_point(&pre, [0.1, 0.25]);
    let top_only = pre
        .analyse_fold(&op.clone().with_seed(Seed::Depth { at, layers: 1 }))
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(top_only.moving.len(), 2, "the top layer's two faces");
    assert_eq!(s.moving_rows(&top_only.moving), vec![0]);

    // The depth picker offers the same two choices.
    let choices = pre.depth_choices(&op, at).unwrap_or_else(|e| panic!("{e}"));
    let sizes: Vec<(usize, usize, usize)> = choices
        .iter()
        .map(|c| (c.layers, c.through, c.moving.len()))
        .collect();
    assert_eq!(sizes, vec![(1, 1, 2), (2, 2, 4)]);

    // Across the spine instead, the layers are hinged on the moving side:
    // still two rows, but one flap, and the top layer cannot go alone.
    let across = section(&pre, y_eq(0.25), [0.25, 0.1]);
    assert_eq!(across.rows.len(), 2);
    assert_eq!(across.rows[0].flap, across.rows[1].flap);
    let op = all(y_eq(0.25), [0.25, 0.1], Valley);
    let at = top_sheet_point(&pre, [0.25, 0.1]);
    let choices = pre.depth_choices(&op, at).unwrap_or_else(|e| panic!("{e}"));
    let sizes: Vec<(usize, usize, usize)> = choices
        .iter()
        .map(|c| (c.layers, c.through, c.moving.len()))
        .collect();
    assert_eq!(sizes, vec![(1, 2, 2)]);
    assert!(choices[0].added.is_empty(), "one flap, picked whole");
}

#[test]
fn turning_over_reverses_the_rows() {
    let pre = precrease(&book(), &all(x_eq(0.25), [0.1, 0.5], Valley)).state;
    let front = section(&pre, y_eq(0.5), [0.25, 0.75]);
    let back = section(&pre.turn_over(), y_eq(0.5), [0.25, 0.75]);
    assert_eq!(front.rows.len(), back.rows.len());
    assert_eq!(front.rows[0].faces, back.rows[1].faces);
    assert_eq!(front.rows[1].faces, back.rows[0].faces);
    // Still with the moving side on the left as seen: the scene is mirrored,
    // so the section runs the other way along ℓ.
    assert!(near(xy(front.from), [0.0, 0.5]) && near(xy(front.to), [0.5, 0.5]));
    assert!(near(xy(back.from), [-0.5, 0.5]) && near(xy(back.to), [0.0, 0.5]));
}

#[test]
fn layers_apart_along_the_line_are_unordered() {
    // Fold two corners up over the bottom edge, then section along y = 0.05:
    // the two folded corners are side by side over the bottom strip.
    let s0 = fold(
        &square(),
        &all(through([0.0, 0.2], [0.2, 0.0]), [0.0, 0.0], Valley),
    )
    .state;
    let s1 = fold(
        &s0,
        &all(through([0.8, 0.0], [1.0, 0.2]), [1.0, 0.0], Valley),
    )
    .state;
    let s = section(&s1, y_eq(0.05), [0.5, 0.0]);
    // Under ℓ: the sheet's middle face, with a folded corner over each end.
    assert_eq!(s.layers, 2);
    let RowOrder::Layered { unordered } = &s.order else {
        panic!("woven");
    };
    let rows = s.rows.len();
    assert_eq!(rows, 3, "{:?}", s.rows);
    // The sheet is under both corners; the corners are not ordered.
    assert_eq!(unordered.len(), 1);
    let [i, j] = unordered[0];
    assert_eq!(s.rows[i].spans.len(), 1);
    assert!(s.rows[i].spans[0][1] <= s.rows[j].spans[0][0] + 1e-12);
    assert_eq!(*s.rows.last().map(|r| &r.faces).unwrap_or(&vec![]), {
        let id = s1.face_at([0.5, 0.5]).unwrap_or_else(|| unreachable!());
        vec![id]
    });
}

#[test]
fn a_near_miss_can_be_inspected_but_not_selected() {
    let state = square();
    let op = all(x_eq(1.0 - 1e-4), [0.5, 0.5], Valley);
    let section = state.cross_section(&op.line, op.side).unwrap();
    assert_eq!(section.layers, 1);
    assert!(state.depth_choices(&op, [0.5, 0.5]).unwrap().is_empty());
    let e = state.analyse_fold(&op).unwrap_err();
    assert!(matches!(e.refusal, FoldRefusal::NearMiss { .. }));
    assert!(!e.fixes.is_empty(), "with its landmark line");
}

// --- The depth picker -------------------------------------------------------

/// The quarter fold's corner: four free corners, one per layer, so four
/// nested choices.
#[test]
fn depth_choices_at_a_four_layer_corner() {
    let quarters = fold(&book(), &all(y_eq(0.5), [0.25, 0.75], Valley)).state;
    let line = through([0.0, 0.15], [0.15, 0.0]);
    let op = all(line, [0.0, 0.0], Valley);
    let at = top_sheet_point(&quarters, [0.03, 0.03]);
    let choices = quarters
        .depth_choices(&op, at)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(choices.len(), 4);
    for (k, choice) in choices.iter().enumerate() {
        assert_eq!((choice.layers, choice.through), (k + 1, k + 1));
        assert_eq!(choice.moving.len(), k + 1);
        assert!(choice.added.is_empty());
    }
    for pair in choices.windows(2) {
        let (a, b): (BTreeSet<FaceId>, BTreeSet<FaceId>) = (
            pair[0].moving.iter().copied().collect(),
            pair[1].moving.iter().copied().collect(),
        );
        assert!(a.is_subset(&b));
    }
    // A mountain counts from the bottom: the bottom layer alone first.
    let bottom = quarters
        .depth_choices(&all(line, [0.0, 0.0], Mountain), at)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(bottom.len(), 4);
    let stack = quarters
        .stack_at([0.03, 0.03])
        .unwrap_or_else(|| unreachable!());
    assert_eq!(bottom[0].moving, vec![stack[3]]);
    assert_eq!(choices[0].moving, vec![stack[0]]);

    // The point must be on the paper, on the moving side.
    let off = quarters.depth_choices(&op, [0.4, 0.4]);
    assert!(matches!(
        off.map_err(|e| e.refusal),
        Err(FoldRefusal::SeedNotOnMovingSide { .. })
    ));
    let on_a_crease = quarters.depth_choices(&op, [0.5, 0.05]);
    assert!(matches!(
        on_a_crease.map_err(|e| e.refusal),
        Err(FoldRefusal::WitnessNotInFace { .. })
    ));
}

/// `State::depth_choices` by its definition: an analysis of every depth at
/// the point, its moving sets told apart. The engine grows one closure layer
/// by layer instead; the two must agree.
fn depth_choices_by_analysis(state: &State, op: &PlainFold, at: Point) -> Vec<DepthChoice> {
    let depth = state
        .image_of(at)
        .and_then(|p| state.stack_at(p))
        .map_or(0, |stack| stack.len());
    let mut choices: Vec<DepthChoice> = Vec::new();
    for layers in 1..=depth {
        let probe = op
            .clone()
            .with_seed(Seed::Depth { at, layers })
            .with_closure(ClosurePolicy::Include);
        let Ok(analysis) = state.analyse_fold(&probe) else {
            continue;
        };
        match choices.iter_mut().find(|c| c.moving == analysis.moving) {
            Some(choice) => choice.through = layers,
            None => choices.push(DepthChoice {
                layers,
                through: layers,
                moving: analysis.moving,
                picked: analysis.picked,
                added: analysis.added,
            }),
        }
    }
    choices
}

/// Stacks up to a few dozen layers deep, valley and mountain, plain and
/// tucked: the layer-by-layer closure gives what an analysis per depth gives.
/// (The random campaign above compares every depth seed it draws as well.)
#[test]
fn depth_choices_on_deep_stacks_match_an_analysis_per_depth() {
    use oristudio_fold::Placement;

    let (mut compared, mut several, mut deepest) = (0, 0, 0);
    for seed in 0..5u64 {
        let mut rng = Rng::new(0xdee9 + seed);
        let mut state = square();
        if seed == 1 {
            state = state.turn_over();
        }
        let mut tries = 0;
        while state.faces().len() < 24 && tries < 200 {
            tries += 1;
            let Some(line) = random_line(&state, &mut rng) else {
                continue;
            };
            let direction = if rng.chance(0.5) { Valley } else { Mountain };
            if let Ok(folded) = state.fold(&PlainFold::new(line, Side::Positive, direction)) {
                state = folded.state;
            }
        }
        // Free lines through the middle of the model cut the layers at
        // different places, so stacks split into more flaps than along a
        // landmark line.
        let images: Vec<Point> = (0..state.vertices().len())
            .filter_map(|v| state.vertex_image(VertexId(v as u32)))
            .collect();
        let [x0, y0, x1, y1] = oristudio_geometry::convex::bounding_box(&images);
        for _ in 0..10 {
            let c = [
                x0 + (0.3 + 0.4 * rng.next_f64()) * (x1 - x0),
                y0 + (0.3 + 0.4 * rng.next_f64()) * (y1 - y0),
            ];
            let a = rng.next_f64() * std::f64::consts::PI;
            let Some(line) = Line::from_point_direction(c, [a.cos(), a.sin()]) else {
                continue;
            };
            let side = if rng.chance(0.5) {
                Side::Positive
            } else {
                Side::Negative
            };
            let Some(at) = moving_point(&state, &line, side, &mut rng) else {
                continue;
            };
            for direction in [Valley, Mountain] {
                let mut op = PlainFold::new(line, side, direction);
                if rng.chance(0.4) {
                    let target = state.faces()[rng.below(state.faces().len())].ring.clone();
                    let ring: Vec<Point> = target
                        .iter()
                        .map(|v| state.vertices()[v.0 as usize])
                        .collect();
                    let n = ring.len() as f64;
                    let c = ring
                        .iter()
                        .fold([0.0, 0.0], |s, p| [s[0] + p[0] / n, s[1] + p[1] / n]);
                    op = op.with_placement(if rng.chance(0.5) {
                        Placement::Over { at: c }
                    } else {
                        Placement::Under { at: c }
                    });
                }
                let Ok(choices) = state.depth_choices(&op, at) else {
                    continue;
                };
                assert_eq!(choices, depth_choices_by_analysis(&state, &op, at));
                compared += 1;
                several += usize::from(choices.len() > 1);
                deepest = deepest.max(choices.last().map_or(0, |c| c.through));
            }
        }
    }
    eprintln!("{compared} points compared, {several} with several choices, deepest {deepest}");
    // 84, 7 and 32 when written.
    assert!(compared >= 60, "only {compared} points compared");
    assert!(several >= 5, "only {several} points offer several choices");
    assert!(deepest >= 16, "the deepest choice is {deepest} layers");
}

#[test]
fn a_depth_that_moves_everything_is_left_out() {
    // A book fold through one layer: the only depth moves everything that
    // can move, which is the whole right half; a fold of the flat sheet
    // keeps the left half, so it is offered.
    let op = all(x_eq(0.5), [0.75, 0.5], Valley);
    let choices = square()
        .depth_choices(&op, [0.75, 0.5])
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(choices.len(), 1);
    // Folding the book back along its own crease with every layer on the
    // left moving would leave nothing: refused, so no choice at depth 2.
    let b = book();
    let back = all(x_eq(0.5), [0.25, 0.5], Valley).with_seed(Seed::All);
    assert!(matches!(
        b.fold(&back).map_err(|e| e.refusal),
        Err(FoldRefusal::NothingStays)
    ));
    let choices = b
        .depth_choices(&back, top_sheet_point(&b, [0.25, 0.5]))
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(
        choices.iter().map(|c| c.layers).collect::<Vec<_>>(),
        vec![1],
        "the top layer alone unfolds the book; both layers would move everything"
    );
}

// --- The action geometry ----------------------------------------------------

#[test]
fn a_book_fold_arrow_crosses_the_sheet() {
    let parent = square();
    let folded = fold(&parent, &all(x_eq(0.5), [0.75, 0.5], Valley));
    let g = folded
        .action(&parent, ActionKind::Fold)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(g.kind, ActionKind::Fold);
    assert_eq!(g.direction, Valley);
    let [a, b] = g.line.unwrap_or_else(|| panic!("no line"));
    assert!(about(xy(a), [0.5, 1.0]) && about(xy(b), [0.5, 0.0]));
    assert_eq!(g.spans.len(), 1);
    assert!(!g.spans[0].hidden);
    assert!(near(xy(g.spans[0].from), [0.5, 1.0]) && near(xy(g.spans[0].to), [0.5, 0.0]));
    assert_eq!(g.moving, vec![FaceId(0)]);
    let grip = g.grip.unwrap_or_else(|| panic!("no grip"));
    assert!(about(xy(grip.at), [0.85, 0.5]), "{:?}", grip.at);
    assert!(about(xy(grip.image), [0.15, 0.5]));
    assert_eq!(grip.hidden_at, 0);
    assert_eq!(grip.hidden_image, Some(0), "it lands on top");
    assert!(g.push.is_none() && g.pleat.is_none());
    let json = serde_json::to_value(&g).unwrap_or_default();
    assert!(json.get("push").is_none(), "no push key for a plain fold");
}

/// A mountain fold of the bottom layer's corner: the crease is behind the
/// top layer, so its line is hidden, and the corner ends under everything.
#[test]
fn a_mountain_fold_behind_is_a_hidden_line() {
    let b = book();
    let line = through([0.0, 0.3], [0.3, 0.0]);
    // The bottom layer at the corner is the left half, unmoved.
    let op = depth(line, [0.0, 0.0], Mountain, [0.05, 0.05], 1);
    let folded = fold(&b, &op);
    assert_eq!(folded.report.analysis.moving.len(), 1);
    let g = folded
        .action(&b, ActionKind::Fold)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(g.direction, Mountain);
    assert!(!g.spans.is_empty() && g.spans.iter().all(|s| s.hidden));
    let grip = g.grip.unwrap_or_else(|| panic!("no grip"));
    assert_eq!(grip.hidden_at, 1, "under the top layer");
    assert_eq!(grip.hidden_image, Some(2), "under both layers once landed");
    let summary = folded.summary(&b).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(summary.layers, Some(2));
}

#[test]
fn a_precrease_arrow_has_no_landed_cover() {
    let parent = square();
    let pre = precrease(&parent, &all(x_eq(0.5), [0.75, 0.5], Mountain));
    let g = pre
        .action(&parent, ActionKind::Precrease)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(g.kind, ActionKind::Precrease);
    assert_eq!(g.direction, Mountain);
    let grip = g.grip.unwrap_or_else(|| panic!("no grip"));
    assert_eq!(grip.hidden_image, None, "it unfolds again");
    // Analysed only: the same geometry, no landed state.
    let analysis = parent
        .analyse_fold(&all(x_eq(0.5), [0.75, 0.5], Mountain))
        .unwrap_or_else(|e| panic!("{e}"));
    let preview = parent
        .fold_action(&analysis, ActionKind::Precrease, None)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(preview, g);
}

#[test]
fn a_fold_from_the_back_is_drawn_in_the_mirrored_scene() {
    let t = square().turn_over();
    // The viewer's right half is the sheet's left (model x < 0.5).
    let op = all(x_eq(0.5), [0.25, 0.5], Valley);
    let folded = fold(&t, &op);
    let g = folded
        .action(&t, ActionKind::Fold)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(g.direction, Valley, "as the viewer sees it");
    assert!(g.spans.iter().all(|s| !s.hidden));
    let grip = g.grip.unwrap_or_else(|| panic!("no grip"));
    // In the scene the moving half is on the viewer's right, x > −0.5.
    assert!(about(xy(grip.at), [-0.15, 0.5]), "{:?}", grip.at);
    assert!(about(xy(grip.image), [-0.85, 0.5]));
    assert_eq!(grip.hidden_image, Some(0));
}

// --- Summaries --------------------------------------------------------------

#[test]
fn the_kite_base_counts_and_diffs_each_step() {
    let s0 = square();
    let pre = precrease(
        &s0,
        &all(through([0.0, 0.0], [1.0, 1.0]), [0.9, 0.1], Valley),
    );
    let s1 = pre.state.clone();
    let bottom = fold(&s1, &all(kite_bottom(), [0.9, 0.05], Valley));
    let s2 = bottom.state.clone();
    let left = fold(&s2, &all(kite_left(), [0.05, 0.9], Valley));
    let mut summaries = Vec::new();
    for (parent, folded) in [(&s0, &pre), (&s1, &bottom), (&s2, &left)] {
        summaries.push(folded.summary(parent).unwrap_or_else(|e| panic!("{e}")));
    }
    let counts: Vec<[usize; 3]> = summaries
        .iter()
        .map(|s| [s.counts.mountain, s.counts.valley, s.counts.flat])
        .collect();
    assert_eq!(counts, vec![[0, 0, 1], [0, 1, 1], [0, 2, 1]]);
    assert!(summaries.iter().all(|s| s.diff.added.len() == 1));
    assert!(summaries.iter().all(|s| s.layers == Some(1)));
}

// --- The scene --------------------------------------------------------------

fn kite_bottom() -> Line {
    through([0.0, 0.0], [1.0, 2f64.sqrt() - 1.0])
}

fn kite_left() -> Line {
    through([0.0, 0.0], [2f64.sqrt() - 1.0, 1.0])
}

/// The kite base: precrease the diagonal, fold the two edges to it.
fn kite() -> State {
    let s = precrease(
        &square(),
        &all(through([0.0, 0.0], [1.0, 1.0]), [0.9, 0.1], Valley),
    )
    .state;
    let s = fold(&s, &all(kite_bottom(), [0.9, 0.05], Valley)).state;
    fold(&s, &all(kite_left(), [0.05, 0.9], Valley)).state
}

/// Every number rounded to 1e-9, so a golden survives the last bit of a
/// platform's arithmetic.
fn rounded(value: Value) -> Value {
    match value {
        Value::Number(n) if n.is_f64() => {
            let x = n.as_f64().unwrap_or_default();
            let r = (x * 1e9).round() / 1e9;
            serde_json::Number::from_f64(if r == 0.0 { 0.0 } else { r })
                .map_or(Value::Null, Value::Number)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(rounded).collect()),
        // Sorted here, not by serde_json: a workspace build turns on
        // `preserve_order` (oristudio-bp asks for it), which keeps field order.
        Value::Object(map) => {
            let mut entries: Vec<_> = map.into_iter().map(|(k, v)| (k, rounded(v))).collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            Value::Object(entries.into_iter().collect())
        }
        other => other,
    }
}

#[test]
fn the_kite_base_scene_matches_its_golden() {
    let s = kite();
    let front = s.scene();
    let back = s.turn_over().scene();
    // What the golden pins, said in words.
    assert_eq!(front.faces.len(), 4);
    assert_eq!(
        front.faces.iter().filter(|f| f.front_up).count(),
        2,
        "the two flaps show their backs"
    );
    assert!(
        front
            .faces
            .iter()
            .all(|f| f.points.len() == f.outline.len())
    );
    assert!(
        back.faces
            .iter()
            .zip(&front.faces)
            .all(|(b, f)| b.front_up != f.front_up)
    );

    let golden = serde_json::json!({
        "name": "kite-base",
        "front": serde_json::to_value(&front).unwrap_or_default(),
        "turned_over": serde_json::to_value(&back).unwrap_or_default(),
    });
    let text = serde_json::to_string_pretty(&rounded(golden)).unwrap_or_default() + "\n";
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/scenes/kite-base.json");
    if std::env::var_os("ORISTUDIO_FOLD_BLESS").is_some() {
        if let Some(dir) = path.parent()
            && let Err(e) = std::fs::create_dir_all(dir)
        {
            panic!("cannot create {}: {e}", dir.display());
        }
        if let Err(e) = std::fs::write(&path, &text) {
            panic!("cannot write {}: {e}", path.display());
        }
        return;
    }
    let stored = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{}: {e} (bless to create it)", path.display()));
    assert!(
        stored == text,
        "the kite base's scene changed; rerun with ORISTUDIO_FOLD_BLESS=1 and review the diff"
    );
    // The golden reads back as a scene.
    let parsed: Value = serde_json::from_str(&stored).unwrap_or_default();
    let scene: Result<FoldScene, _> = serde_json::from_value(parsed["front"].clone());
    assert!(scene.is_ok(), "{:?}", scene.err());
}

/// The fields and shapes of the kernel's `FoldedPaperScene` schema 3
/// (`crates/oristudio-cp/src/folding.rs`), which every Fold scene carries
/// with the same names.
#[test]
fn the_scene_carries_the_kernel_schema() {
    let json = serde_json::to_value(kite().scene()).unwrap_or_default();
    assert_eq!(json["schema_version"], 3);
    assert!(json["flipped"].is_boolean());
    assert!(json["sheet"].is_f64());
    let point =
        |p: &Value| p["x"].is_f64() && p["y"].is_f64() && p.as_object().map(|o| o.len()) == Some(2);
    for face in json["faces"].as_array().unwrap_or(&vec![]) {
        assert!(
            face["outline"]
                .as_array()
                .is_some_and(|o| o.iter().all(point))
        );
        assert!(
            face["points"]
                .as_array()
                .is_some_and(|o| o.iter().all(Value::is_u64))
        );
        assert!(face["front_up"].is_boolean());
        for edge in face["edges"].as_array().unwrap_or(&vec![]) {
            assert!(point(&edge["from"]) && point(&edge["to"]));
            assert!(["border", "fold", "flat"].contains(&edge["kind"].as_str().unwrap_or("")));
        }
    }
    let subfaces = json["subfaces"].as_array().cloned().unwrap_or_default();
    assert!(!subfaces.is_empty());
    for sub in &subfaces {
        assert!(
            sub["polygon"]
                .as_array()
                .is_some_and(|o| o.iter().all(point))
        );
        assert!(
            sub["faces_top_to_bottom"]
                .as_array()
                .is_some_and(|o| !o.is_empty() && o.iter().all(Value::is_u64))
        );
    }
    assert_eq!(json["aux_lines"], serde_json::json!([]));
    assert!(
        json["sheet_points"]
            .as_array()
            .is_some_and(|o| o.iter().all(point))
    );
}

// --- Seeded random sequences -----------------------------------------------

/// A line through landmarks: two vertex images, their perpendicular bisector,
/// or a crease's image.
fn random_line(state: &State, rng: &mut Rng) -> Option<Line> {
    let images: Vec<Point> = (0..state.vertices().len())
        .filter_map(|v| state.vertex_image(VertexId(v as u32)))
        .collect();
    let p = images[rng.below(images.len())];
    let q = images[rng.below(images.len())];
    match rng.below(3) {
        0 => Line::from_points(p, q),
        1 => Line::perpendicular_bisector(p, q),
        _ => {
            let crease = &state.creases()[rng.below(state.creases().len())];
            let [a, b] = crease.vertices.map(|v| state.vertex_image(v));
            Line::from_points(a?, b?)
        }
    }
}

/// A sheet point whose image is on the moving side, by at least μ.
fn moving_point(state: &State, line: &Line, side: Side, rng: &mut Rng) -> Option<Point> {
    for _ in 0..8 {
        let face = state.faces()[rng.below(state.faces().len())].id;
        let image = state.face_image(face)?;
        let w: Vec<f64> = image.iter().map(|_| rng.next_f64() + 0.05).collect();
        let total: f64 = w.iter().sum();
        let p = image.iter().zip(&w).fold([0.0, 0.0], |s, (q, w)| {
            [s[0] + q[0] * w / total, s[1] + q[1] * w / total]
        });
        let d = line.signed_distance(p) * if side == Side::Positive { 1.0 } else { -1.0 };
        if d > MIN_FEATURE {
            return Some(state.isometry(face)?.inverse().apply(p));
        }
    }
    None
}

#[derive(Default)]
struct Tally {
    folds: usize,
    intervals: usize,
    rows_merged: usize,
    hidden_spans: usize,
    depth_choices: usize,
}

/// Every query on one applied fold, checked against the states.
fn check_queries(
    parent: &State,
    op: &PlainFold,
    folded: &Folded,
    precreased: bool,
    tally: &mut Tally,
) {
    let a = &folded.report.analysis;
    let child = &folded.state;
    let to_model = parent.view().transform().inverse();
    let n = match a.side {
        Side::Positive => a.line.n,
        Side::Negative => [-a.line.n[0], -a.line.n[1]],
    };

    // The cross-section.
    let asked = parent
        .cross_section(&op.line, op.side)
        .unwrap_or_else(|e| panic!("no section for an applied fold: {e}"));
    assert_eq!(asked.flaps, a.flaps, "the section's flaps are the fold's");
    // Along the line folded along (snapped already, so snapping again moves
    // it by rounding at most): the same section.
    let s = parent
        .cross_section(&a.line, a.side)
        .unwrap_or_else(|e| panic!("no section along the folded line: {e}"));
    let faces = |s: &CrossSection| -> Vec<Vec<FaceId>> {
        s.intervals.iter().map(|i| i.faces.clone()).collect()
    };
    assert_eq!(faces(&s), faces(&asked));
    assert_eq!(s.rows.len(), asked.rows.len());
    assert!(
        matches!(s.order, RowOrder::Layered { .. }),
        "a valid state's section is woven"
    );
    let (from, to) = (to_model.apply(xy(s.from)), to_model.apply(xy(s.to)));
    let length = (to[0] - from[0]).hypot(to[1] - from[1]);
    let unit = if length > 0.0 {
        [(to[0] - from[0]) / length, (to[1] - from[1]) / length]
    } else {
        [0.0, 0.0]
    };
    for interval in &s.intervals {
        assert!(interval.end > interval.start);
        if interval.end - interval.start < 1e-4 {
            continue;
        }
        let d = (interval.start + interval.end) / 2.0;
        let q = [
            from[0] + d * unit[0] + 1e-5 * n[0],
            from[1] + d * unit[1] + 1e-5 * n[1],
        ];
        let Some(mut stack) = parent.stack_at(q) else {
            panic!("no stack at {q:?}");
        };
        if parent.view().flipped {
            stack.reverse();
        }
        assert_eq!(stack, interval.faces, "the interval's stack at {q:?}");
        tally.intervals += 1;
    }
    assert_eq!(
        s.layers,
        s.intervals.iter().map(|i| i.rows.len()).max().unwrap_or(0)
    );
    for row in &s.rows {
        tally.rows_merged += row.faces.len() - 1;
        let first = parent.isometry(row.faces[0]).unwrap_or_default();
        for &f in &row.faces {
            let t = parent.isometry(f).unwrap_or_default();
            assert!(t.distance_on(&first, [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]) < 1e-9);
            assert!(s.flaps[row.flap].faces.contains(&f), "a row in two flaps");
        }
    }
    let moving: BTreeSet<FaceId> = a.moving.iter().copied().collect();
    for r in s.moving_rows(&a.moving) {
        assert!(
            s.rows[r].faces.iter().all(|f| moving.contains(f)),
            "a row half moves"
        );
    }

    // The action geometry.
    let kind = if precreased {
        ActionKind::Precrease
    } else {
        ActionKind::Fold
    };
    let g = folded
        .action(parent, kind)
        .unwrap_or_else(|e| panic!("no action geometry: {e}"));
    assert!(g.line.is_some());
    assert!(!g.spans.is_empty(), "moving paper meets ℓ");
    for span in &g.spans {
        for p in [span.from, span.to] {
            assert!(a.line.signed_distance(to_model.apply(xy(p))).abs() < 1e-9);
        }
        tally.hidden_spans += usize::from(span.hidden);
    }
    if let Some(grip) = g.grip {
        let at = to_model.apply(xy(grip.at));
        let image = to_model.apply(xy(grip.image));
        let d = a.line.signed_distance(at) * if a.side == Side::Positive { 1.0 } else { -1.0 };
        assert!(d > TOL, "the grip is on the moving side");
        assert!(near(a.line.reflect_point(at), image));
        assert_eq!(grip.hidden_image.is_some(), !precreased);
    }

    // The summary.
    let summary = folded
        .summary(parent)
        .unwrap_or_else(|e| panic!("no summary: {e}"));
    let made: BTreeSet<_> = child
        .creases()
        .iter()
        .filter(|c| c.made_at == child.step())
        .map(|c| c.id)
        .collect();
    let added: BTreeSet<_> = summary.diff.added.iter().copied().collect();
    assert_eq!(added, made);
    let unfolded: BTreeSet<_> = summary.diff.unfolded.iter().copied().collect();
    let reported: BTreeSet<_> = folded.report.unfolded.iter().copied().collect();
    assert_eq!(unfolded, reported);
    let refolded: BTreeSet<_> = summary.diff.refolded.iter().map(|r| r.edge).collect();
    let reported: BTreeSet<_> = folded.report.refolded.iter().map(|r| r.edge).collect();
    assert_eq!(refolded, reported);
    if !precreased {
        assert!(
            summary.diff.reversed.is_empty(),
            "a plain fold reverses no letter"
        );
    } else {
        // Re-precreasing can change an existing flat crease's memory.
        let reversed: BTreeSet<_> = child
            .creases()
            .iter()
            .filter(|c| {
                let [a, b] = c.vertices.map(|v| child.vertices()[v.0 as usize]);
                let middle = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
                matches!((parent.crease_at(middle).map(|p| p.kind), c.kind),
                (Some(CreaseKind::Flat(was)), CreaseKind::Flat(now)) if was != now)
            })
            .map(|c| c.id)
            .collect();
        assert_eq!(
            summary
                .diff
                .reversed
                .iter()
                .copied()
                .collect::<BTreeSet<_>>(),
            reversed
        );
    }
    assert_eq!(summary.layers, Some(s.layers));

    // The depth picker, for a depth seed.
    if let Seed::Depth { at, .. } = op.seed {
        let choices = parent
            .depth_choices(op, at)
            .unwrap_or_else(|e| panic!("no depth choices: {e}"));
        assert_eq!(choices, depth_choices_by_analysis(parent, op, at));
        for pair in choices.windows(2) {
            assert!(pair[0].through < pair[1].layers);
            let (x, y): (BTreeSet<FaceId>, BTreeSet<FaceId>) = (
                pair[0].moving.iter().copied().collect(),
                pair[1].moving.iter().copied().collect(),
            );
            assert!(x.is_subset(&y) && x != y, "choices nest and differ");
        }
        tally.depth_choices += choices.len();
    }

    // The landed state's scene: every cell's top is what the state stacks
    // there.
    let scene = child.scene();
    assert_eq!(scene.faces.len(), child.faces().len());
    let to_child_model = child.view().transform().inverse();
    for sub in &scene.subfaces {
        let polygon: Vec<Point> = sub
            .polygon
            .iter()
            .map(|&p| to_child_model.apply(xy(p)))
            .collect();
        let n = polygon.len() as f64;
        let c = polygon
            .iter()
            .fold([0.0, 0.0], |s, p| [s[0] + p[0] / n, s[1] + p[1] / n]);
        let Some(mut stack) = child.stack_at(c) else {
            continue;
        };
        if child.view().flipped {
            stack.reverse();
        }
        let ids: Vec<FaceId> = sub
            .faces_top_to_bottom
            .iter()
            .map(|&i| scene.lineage[i].id)
            .collect();
        if stack.len() == ids.len() {
            assert_eq!(stack, ids, "the cell's stack");
        }
    }
}

#[test]
fn queries_hold_on_random_sequences() {
    let mut tally = Tally::default();
    for sequence in 0..90u64 {
        let mut rng = Rng::new(0x5eed ^ sequence.wrapping_mul(0x2545_f491_4f6c_dd1d));
        let sheet = match sequence % 3 {
            0 => Sheet::square(),
            1 => Sheet::rectangle(1.0, 0.6).unwrap_or_else(|e| panic!("{e}")),
            _ => Sheet::regular(6).unwrap_or_else(|e| panic!("{e}")),
        };
        let start = if sequence % 5 == 4 {
            StartSide::Back
        } else {
            StartSide::Front
        };
        let mut state = State::flat(sheet, start).unwrap_or_else(|e| panic!("{e}"));
        for _ in 0..10 {
            if state.faces().len() > 40 {
                break;
            }
            let x = rng.next_f64();
            if x < 0.08 {
                state = state.turn_over();
                continue;
            }
            let Some(line) = random_line(&state, &mut rng) else {
                continue;
            };
            let side = if rng.next_f64() < 0.5 {
                Side::Positive
            } else {
                Side::Negative
            };
            let direction = if rng.next_f64() < 0.5 {
                Valley
            } else {
                Mountain
            };
            let mut op = PlainFold::new(line, side, direction);
            if rng.next_f64() < 0.5
                && let Some(at) = moving_point(&state, &line, side, &mut rng)
                && let Some(stack) = state.image_of(at).and_then(|p| state.stack_at(p))
            {
                op = op.with_seed(Seed::Depth {
                    at,
                    layers: 1 + rng.below(stack.len()),
                });
            }
            let precreased = x < 0.25;
            let result = if precreased {
                state.precrease(&op)
            } else {
                state.fold(&op)
            };
            if let Ok(folded) = result {
                check_queries(&state, &op, &folded, precreased, &mut tally);
                tally.folds += 1;
                state = folded.state;
            }
        }
    }
    eprintln!(
        "folds {}, intervals {}, faces merged into rows {}, hidden spans {}, depth choices {}",
        tally.folds, tally.intervals, tally.rows_merged, tally.hidden_spans, tally.depth_choices
    );
    assert!(tally.folds >= 200, "only {} folds", tally.folds);
    assert!(tally.rows_merged > 0, "no precrease ever joined a row");
    assert!(tally.hidden_spans > 0, "no hidden span");
    assert!(tally.depth_choices > 0);
}
