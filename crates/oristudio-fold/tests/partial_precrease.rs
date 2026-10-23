//! Partial precreases: a segment or a pinch of a precrease's line, which
//! leaves crease marks (`oristudio_fold::crease_marks`).
//!
//! - The classics a folder makes: the pinch at the middle of an edge, and the
//!   pinch through both layers of a sheet folded in half, unfolded.
//! - Subsumption by a later crease along a mark, whole or in part.
//! - The scene, the landmarks, the summary and the picture.
//! - A property campaign over random sequences: a partial precrease splits
//!   no face and changes nothing but the marks; its marks are the whole
//!   precrease's creases cut to the extent, letter for letter; later folds
//!   carry them, subsuming only what their creases cover; every state passes
//!   the full gate.
//! - With `kernel`: marks go to Edit, and to the FOLD export's crease
//!   pattern, as auxiliary lines.

mod support;

use oristudio_fold::random::{self, Rng, Sequence};
use oristudio_fold::{
    AnchoredFold, CreaseKind, CreaseMark, Direction, Extent, Feature, FoldLine, Folded, Letter,
    PlainFold, PointKind, Seed, Sheet, StartSide, State, default_pinch_length,
};
use oristudio_geometry::Line;
use support::*;

use Direction::{Mountain, Valley};

fn square() -> State {
    State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"))
}

fn partial(state: &State, op: &PlainFold, extent: Extent) -> Folded {
    state
        .precrease_extent(op, &extent)
        .unwrap_or_else(|e| panic!("refused: {e} ({:?}) fixes {:?}", e.refusal, e.fixes))
}

fn near(a: Point, b: Point, tol: f64) -> bool {
    (a[0] - b[0]).hypot(a[1] - b[1]) <= tol
}

/// The mark's ends, ordered by x then y.
fn ends(mark: &CreaseMark) -> [Point; 2] {
    let mut ends = [mark.a, mark.b];
    ends.sort_by(|p, q| p[0].total_cmp(&q[0]).then(p[1].total_cmp(&q[1])));
    ends
}

/// Whether the sheet point lies on the mark, within `tol`.
fn on_mark(mark: &CreaseMark, p: Point, tol: f64) -> bool {
    let length = mark.length();
    let d = [
        (mark.b[0] - mark.a[0]) / length,
        (mark.b[1] - mark.a[1]) / length,
    ];
    let along = (p[0] - mark.a[0]) * d[0] + (p[1] - mark.a[1]) * d[1];
    let off = ((p[0] - mark.a[0]) * d[1] - (p[1] - mark.a[1]) * d[0]).abs();
    off <= tol && along >= -tol && along <= length + tol
}

// ---------------------------------------------------------------------------
// Classics

/// "Pinch the middle of the left edge": fold bottom to top and crease only
/// the end of the fold. From the flat sheet, the precrease along y = 0.5
/// pinched at the edge: the mark runs in from the edge, half the pinch long,
/// and the paper is unchanged.
#[test]
fn a_pinch_marks_the_middle_of_an_edge() {
    let s = square();
    let op = all(y_eq(0.5), [0.5, 0.1], Valley);
    let length = default_pinch_length(s.sheet());
    assert_eq!(length, 1.0 / 16.0);
    let pinched = partial(
        &s,
        &op,
        Extent::Pinch {
            at: [0.0, 0.5],
            length,
        },
    );
    let marks = pinched.state.crease_marks();
    assert_eq!(marks.len(), 1);
    let [a, b] = ends(&marks[0]);
    assert!(near(a, [0.0, 0.5], 1e-12) && near(b, [length / 2.0, 0.5], 1e-12));
    assert_eq!(marks[0].letter, Letter::Valley);
    assert_eq!(pinched.state.faces().len(), 1);
    assert_eq!(pinched.state.creases(), s.creases());
    assert_valid(&pinched.state);
}

/// Fold in half along a diagonal, pinch the middle of the other diagonal
/// through both layers, unfold: two marks on the other diagonal at its
/// quarter points, one a valley and one a mountain, as a folder's pinch
/// through a folded sheet leaves them.
#[test]
fn a_pinch_through_both_layers_unfolds_to_marks_of_both_letters() {
    let diagonal = through([0.0, 0.0], [1.0, 1.0]);
    let folded = fold(&square(), &all(diagonal, [0.9, 0.1], Valley)).state;
    // The other diagonal, x + y = 1, runs from the centre to the corner
    // (0, 1) in the folded triangle; its middle is (0.25, 0.75).
    let other = through([1.0, 0.0], [0.0, 1.0]);
    let at = top_sheet_point(&folded, [0.25, 0.75]);
    let pinched = partial(
        &folded,
        &all(other, [0.1, 0.1], Valley),
        Extent::Pinch { at, length: 0.1 },
    );
    assert_eq!(pinched.state.faces(), folded.faces());
    assert_eq!(pinched.state.order(), folded.order());
    let marks = pinched.state.crease_marks().to_vec();
    assert_eq!(marks.len(), 2, "{marks:?}");

    // Unfold the top flap back along the diagonal.
    let crease = folded
        .crease_at([0.5, 0.5])
        .map(|c| c.id)
        .unwrap_or_else(|| panic!("no diagonal"));
    let line = pinched
        .state
        .crease_line(crease)
        .unwrap_or_else(|| unreachable!());
    // The flap on top swings back over: toward the viewer, a valley.
    let flap = top_sheet_point(&pinched.state, [0.2, 0.6]);
    let unfold = PlainFold::new(line, side(&line, [0.2, 0.6]), Valley)
        .with_seed(Seed::Flaps { at: vec![flap] });
    let open = fold(&pinched.state, &unfold).state;
    assert_valid(&open);
    assert_eq!(open.crease_marks(), marks.as_slice(), "marks never move");

    // On the other diagonal, at its quarter points, a sixteenth either side.
    let h = 0.1 / 2.0 / 2f64.sqrt();
    let mut seen = Vec::new();
    for mark in open.crease_marks() {
        let [a, b] = ends(mark);
        assert!((a[0] + a[1] - 1.0).abs() < 1e-12 && (b[0] + b[1] - 1.0).abs() < 1e-12);
        let mid = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
        assert!((mark.length() - 0.1).abs() < 1e-12);
        assert!(near(a, [mid[0] - h, mid[1] + h], 1e-12));
        seen.push((mid[0] < 0.5, mark.letter));
    }
    seen.sort();
    // The layer that stayed, front up (the upper-left half), is creased
    // valley; the one folded over it, back up, mountain from its front.
    assert_eq!(
        seen,
        vec![(false, Letter::Mountain), (true, Letter::Valley)]
    );
    for (mid, letter) in [
        ([0.25, 0.75], Letter::Valley),
        ([0.75, 0.25], Letter::Mountain),
    ] {
        assert!(
            open.crease_marks()
                .iter()
                .any(|m| on_mark(m, mid, 1e-12) && m.letter == letter)
        );
    }
}

/// A segment along a line already crossed by a flat crease is one mark: the
/// pieces on the two faces merge.
#[test]
fn a_segment_across_a_flat_crease_is_one_mark() {
    let s = precrease(&square(), &all(x_eq(0.5), [0.9, 0.5], Valley)).state;
    let marked = partial(
        &s,
        &all(y_eq(0.5), [0.5, 0.9], Mountain),
        Extent::Segment {
            from: [0.2, 0.5],
            to: [0.8, 0.5],
        },
    );
    let marks = marked.state.crease_marks();
    assert_eq!(marks.len(), 1, "{marks:?}");
    let [a, b] = ends(&marks[0]);
    assert!(near(a, [0.2, 0.5], 1e-12) && near(b, [0.8, 0.5], 1e-12));
    assert_eq!(marks[0].letter, Letter::Mountain);
    // Both faces carry a part of it in the scene.
    let scene = marked.state.scene();
    assert_eq!(scene.aux_lines.len(), 2);
    assert_eq!(scene.crease_marks.len(), 1);
    assert_eq!(scene.crease_marks[0].pieces.len(), 2);
}

/// A whole extent is the whole precrease.
#[test]
fn the_whole_extent_is_the_precrease() {
    let op = all(x_eq(0.5), [0.9, 0.5], Valley);
    let whole = partial(&square(), &op, Extent::Whole);
    let precreased = precrease(&square(), &op);
    assert_eq!(whole.state.parts(), precreased.state.parts());
    assert_eq!(whole.report, precreased.report);
    assert!(whole.extent.is_none());
}

// ---------------------------------------------------------------------------
// Subsumption

/// A fold along a mark's line takes the mark into its crease: the part the
/// crease covers goes, the rest stays.
#[test]
fn a_crease_along_a_mark_subsumes_what_it_covers() {
    // Folded in half, the right half on top; a segment along x = 0.25, the
    // hinge's parallel, through both layers, y ∈ [0.1, 0.4].
    let book = fold(&square(), &all(x_eq(0.5), [0.75, 0.5], Valley)).state;
    let marked = partial(
        &book,
        &all(x_eq(0.25), [0.1, 0.5], Valley),
        Extent::Segment {
            from: top_sheet_point(&book, [0.25, 0.1]),
            to: top_sheet_point(&book, [0.25, 0.4]),
        },
    )
    .state;
    assert_eq!(marked.crease_marks().len(), 2);
    let right = |m: &CreaseMark| m.a[0] > 0.5;
    // The right half's mark, on the top layer, is valley as seen: it shows
    // its back, so mountain from its front; the left's is valley.
    for m in marked.crease_marks() {
        let want = if right(m) {
            Letter::Mountain
        } else {
            Letter::Valley
        };
        assert_eq!(m.letter, want);
    }
    // Fold the top layer only along x = 0.25 (the hinge does not cross the
    // line, so nothing drags the bottom layer along): its crease covers the
    // right mark, which goes; the left one, under it, stays.
    let top = top_sheet_point(&marked, [0.1, 0.5]);
    let op = all(x_eq(0.25), [0.1, 0.5], Valley).with_seed(Seed::Depth { at: top, layers: 1 });
    let folded = fold(&marked, &op).state;
    assert_valid(&folded);
    let kept: Vec<&CreaseMark> = folded.crease_marks().iter().collect();
    assert_eq!(kept.len(), 1, "{kept:?}");
    assert!(!right(kept[0]));

    // A fold elsewhere leaves both alone.
    let elsewhere = fold(&marked, &all(y_eq(0.8), [0.25, 0.9], Valley)).state;
    assert_eq!(elsewhere.crease_marks(), marked.crease_marks());

    // A newer mark over part of an older one: on the flat sheet, a mark
    // along y = 0.5 for x ∈ [0.2, 0.8], then a pinch of the other letter
    // over its middle.
    let long = partial(
        &square(),
        &all(y_eq(0.5), [0.5, 0.9], Valley),
        Extent::Segment {
            from: [0.2, 0.5],
            to: [0.8, 0.5],
        },
    )
    .state;
    let pinch = partial(
        &long,
        &all(y_eq(0.5), [0.5, 0.9], Mountain),
        Extent::Pinch {
            at: [0.5, 0.5],
            length: 0.2,
        },
    )
    .state;
    // The newer pinch covers the middle of the older mark: three marks, the
    // older one's ends and the pinch, which won.
    let mut marks = pinch.crease_marks().to_vec();
    marks.sort_by(|p, q| ends(p)[0][0].total_cmp(&ends(q)[0][0]));
    assert_eq!(marks.len(), 3, "{marks:?}");
    assert!(near(ends(&marks[0])[1], [0.4, 0.5], 1e-12));
    assert_eq!(marks[1].letter, Letter::Mountain);
    assert_eq!(marks[1].made_at, 2);
    assert!(near(ends(&marks[2])[0], [0.6, 0.5], 1e-12));
    assert_valid(&pinch);
    // And a whole precrease along the line takes them all.
    let creased = precrease(&pinch, &all(y_eq(0.5), [0.5, 0.9], Valley)).state;
    assert!(creased.crease_marks().is_empty());
    assert_valid(&creased);
}

// ---------------------------------------------------------------------------
// Queries

#[test]
fn the_summary_counts_marks_and_the_layers_at_the_pinch() {
    // A corner folded over: along y = 0.1 there are two layers only near
    // the left edge.
    let corner = through([0.0, 0.3], [0.3, 0.0]);
    let s = fold(&square(), &all(corner, [0.0, 0.0], Valley)).state;
    let op = all(y_eq(0.1), [0.5, 0.0], Valley);
    // The corner lands on x ∈ [0.2, 0.3] along y = 0.1.
    let near_corner = partial(
        &s,
        &op,
        Extent::Pinch {
            at: top_sheet_point(&s, [0.25, 0.1]),
            length: 0.04,
        },
    );
    let summary = near_corner.summary(&s).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(summary.diff.marks_added, 2);
    assert!(summary.diff.added.is_empty());
    assert_eq!(summary.layers, Some(2));
    let far = partial(
        &s,
        &op,
        Extent::Pinch {
            at: [0.8, 0.1],
            length: 0.04,
        },
    );
    let summary = far.summary(&s).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(summary.diff.marks_added, 1);
    assert_eq!(summary.layers, Some(1));
    // The whole precrease's layers are the line's most.
    let whole = precrease(&s, &op)
        .summary(&s)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(whole.layers, Some(2));
    assert_eq!(whole.diff.marks_added, 0);
    // The JSON leaves the count out when there is none.
    let json = serde_json::to_value(&whole.diff).unwrap_or_default();
    assert!(json.get("marks_added").is_none(), "{json}");
    let json = serde_json::to_value(&summary.diff).unwrap_or_default();
    assert_eq!(json["marks_added"], 1);
}

#[test]
fn the_picture_draws_the_extent_only() {
    let s = square();
    let op = all(x_eq(0.5), [0.9, 0.5], Valley);
    let pinched = partial(
        &s,
        &op,
        Extent::Pinch {
            at: [0.5, 0.3],
            length: 0.2,
        },
    );
    let action = pinched
        .action(&s, oristudio_fold::ActionKind::Precrease)
        .unwrap_or_else(|e| panic!("{e}"));
    let [a, b] = action.line.unwrap_or_else(|| panic!("no line"));
    let (lo, hi) = (a.y.min(b.y), a.y.max(b.y));
    assert!(
        (lo - 0.2).abs() < 1e-12 && (hi - 0.4).abs() < 1e-12,
        "{a:?} {b:?}"
    );
    assert!(action.spans.iter().all(|span| {
        let y = [span.from.y, span.to.y];
        y.iter().all(|&y| (0.2 - 1e-12..=0.4 + 1e-12).contains(&y))
    }));
    let grip = action.grip.unwrap_or_else(|| panic!("no grip"));
    assert!((grip.at.y - 0.3).abs() < 1e-9, "{grip:?}");
    // The whole precrease's picture spans the sheet.
    let whole = precrease(&s, &op)
        .action(&s, oristudio_fold::ActionKind::Precrease)
        .unwrap_or_else(|e| panic!("{e}"));
    let [a, b] = whole.line.unwrap_or_else(|| panic!("no line"));
    assert!((a.y - b.y).abs() > 1.0 - 1e-12);
}

#[test]
fn the_scene_draws_marks_on_both_panes_with_the_letters_seen() {
    let book = fold(&square(), &all(x_eq(0.5), [0.75, 0.5], Valley)).state;
    let marked = partial(
        &book,
        &all(y_eq(0.5), [0.25, 0.9], Valley),
        Extent::Pinch {
            at: top_sheet_point(&book, [0.25, 0.5]),
            length: 0.1,
        },
    )
    .state;
    for (state, flipped) in [(marked.clone(), false), (marked.turn_over(), true)] {
        let scene = state.scene();
        assert_eq!(scene.crease_marks.len(), 2);
        assert_eq!(scene.aux_lines.len(), 2);
        for mark in &scene.crease_marks {
            let [piece] = mark.pieces[..] else {
                panic!("{:?}", mark.pieces);
            };
            // Both pieces lie at the pinch in the scene frame; each reads as
            // the valley the viewer folded from the front, mountain from the
            // back.
            let x = if flipped { -0.25 } else { 0.25 };
            assert!((piece.from.x + piece.to.x - 2.0 * x).abs() < 1e-12);
            let seen = if flipped {
                Letter::Mountain
            } else {
                Letter::Valley
            };
            assert_eq!(piece.seen, seen, "{mark:?}");
            assert!(
                scene.aux_lines.iter().any(|aux| aux.face == piece.face
                    && aux.from == piece.from
                    && aux.to == piece.to)
            );
        }
        // Letters do not depend on the view: the layer under, front up, a
        // valley; the one over it, back up, a mountain from its front.
        let mut letters: Vec<(bool, Letter)> = scene
            .crease_marks
            .iter()
            .map(|m| (m.from.x > 0.5, m.letter))
            .collect();
        letters.sort();
        assert_eq!(
            letters,
            vec![(false, Letter::Valley), (true, Letter::Mountain)]
        );
        // It reads back.
        let json = serde_json::to_value(&scene).unwrap_or_default();
        let back: oristudio_fold::FoldScene =
            serde_json::from_value(json).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(back, scene);
    }
    // A scene without marks writes no `crease_marks` key.
    let json = serde_json::to_value(book.scene()).unwrap_or_default();
    assert!(json.get("crease_marks").is_none());
    assert_eq!(json["aux_lines"], serde_json::json!([]));
}

#[test]
fn mark_ends_and_crossings_are_landmarks_with_provenance() {
    // A precrease at x = 0.5 and a mark along y = 0.5 across it, then the
    // left half folded over the right.
    let s = precrease(&square(), &all(x_eq(0.5), [0.9, 0.5], Valley)).state;
    let marked = partial(
        &s,
        &all(y_eq(0.5), [0.5, 0.9], Valley),
        Extent::Segment {
            from: [0.3, 0.5],
            to: [0.7, 0.5],
        },
    )
    .state;
    let l = marked.landmarks(&[]);
    assert_eq!(l.crease_marks.len(), 2, "one part per face");
    for end in [[0.3, 0.5], [0.7, 0.5]] {
        let p = l
            .point_at(end)
            .unwrap_or_else(|| panic!("no end at {end:?}"));
        assert!(p.visible);
        assert!(
            p.sources
                .iter()
                .any(|s| s.kind == PointKind::CreaseMarkEnd { crease_mark: 0 } && s.sheet == end)
        );
    }
    // Where it crosses the precrease: once, a source on each.
    let x = l
        .point_at([0.5, 0.5])
        .unwrap_or_else(|| panic!("no crossing"));
    let crossings: Vec<&PointKind> = x
        .sources
        .iter()
        .map(|s| &s.kind)
        .filter(|k| matches!(k, PointKind::CreaseMarkCrossing { .. }))
        .collect();
    assert_eq!(crossings.len(), 2, "{:?}", x.sources);
    assert!(crossings.iter().any(|k| matches!(
        k,
        PointKind::CreaseMarkCrossing {
            on: Feature::CreaseMark(0),
            other: Feature::Segment(_)
        }
    )));

    // Fold the left half over: the mark's left part is on top, its right
    // part under it, hidden.
    let folded = fold(&marked, &all(x_eq(0.5), [0.1, 0.5], Valley)).state;
    let l = folded.landmarks(&[]);
    let mut parts: Vec<(bool, bool)> = l
        .crease_marks
        .iter()
        .map(|m| (m.sheet.midpoint()[0] < 0.5, !m.visible.is_empty()))
        .collect();
    parts.sort();
    assert_eq!(parts, vec![(false, false), (true, true)]);
    // The right end, at (0.7, 0.5) under the left part's end at the same
    // place: both ends are one landmark, seen through the top one.
    let p = l.point_at([0.7, 0.5]).unwrap_or_else(|| panic!("no end"));
    let seen: Vec<(Point, bool)> = p
        .sources
        .iter()
        .filter(|s| matches!(s.kind, PointKind::CreaseMarkEnd { .. }))
        .map(|s| (s.sheet, s.visible))
        .collect();
    assert_eq!(seen.len(), 2, "{:?}", p.sources);
    assert!(seen.contains(&([0.3, 0.5], true)));
    assert!(seen.contains(&([0.7, 0.5], false)));
    // A JSON without marks has no `crease_marks` key.
    let json = serde_json::to_value(s.landmarks(&[])).unwrap_or_default();
    assert!(json.get("crease_marks").is_none());
}

#[test]
fn an_anchored_partial_precrease_resolves_its_line_and_its_extent() {
    let s = square();
    let op = AnchoredFold::new(
        FoldLine::Free {
            a: [0.5, 0.0],
            b: [0.5, 1.0],
        },
        Valley,
    )
    .toward([0.9, 0.5]);
    let pinch = Extent::Pinch {
        at: [0.5, 0.25],
        length: 0.1,
    };
    let folded = s
        .precrease_anchored_extent(&op, &pinch)
        .unwrap_or_else(|e| panic!("{e}"));
    let [a, b] = ends(&folded.state.crease_marks()[0]);
    assert!(near(a, [0.5, 0.2], 1e-12) && near(b, [0.5, 0.3], 1e-12));
    // The extent's anchor projects onto the line: a point beside it names
    // the same pinch.
    let beside = Extent::Pinch {
        at: [0.7, 0.25],
        length: 0.1,
    };
    let again = s
        .precrease_anchored_extent(&op, &beside)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(again.state.crease_marks(), folded.state.crease_marks());
    // A whole extent is the whole anchored precrease.
    let whole = s
        .precrease_anchored_extent(&op, &Extent::Whole)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(whole.report.created.len(), 1);
    assert!(whole.state.crease_marks().is_empty());
    // A refusal names its code.
    let off = Extent::Pinch {
        at: [1.5, 0.25],
        length: 0.1,
    };
    let refused = s.precrease_anchored_extent(&op, &off).err();
    assert_eq!(refused.map(|r| r.code()), Some("extent_off_paper"));
}

// ---------------------------------------------------------------------------
// The property campaign

/// A model-frame point on `line` inside the paper, and the sheet point of
/// the top layer there: what a pick on the line gives the tools.
fn point_on(state: &State, line: &Line, rng: &mut Rng) -> Option<(f64, Point)> {
    let images: Vec<Vec<Point>> = state
        .faces()
        .iter()
        .filter_map(|f| state.face_image(f.id).map(<[Point]>::to_vec))
        .collect();
    let chords: Vec<[f64; 2]> = images
        .iter()
        .filter_map(|image| chord(line, image))
        .filter(|[lo, hi]| hi - lo > 0.01)
        .collect();
    let [lo, hi] = *chords.get(rng.below(chords.len()))?;
    let t = lo + (0.05 + 0.9 * rng.next_f64()) * (hi - lo);
    let (_, sheet) = state.top_visible_at(line.point_at(t))?;
    Some((t, sheet))
}

/// The parameter interval of `line` inside a convex polygon.
fn chord(line: &Line, polygon: &[Point]) -> Option<[f64; 2]> {
    let ts: Vec<f64> = (0..polygon.len())
        .filter_map(|i| {
            let (p, q) = (polygon[i], polygon[(i + 1) % polygon.len()]);
            let (dp, dq) = (line.signed_distance(p), line.signed_distance(q));
            if (dp > 0.0) == (dq > 0.0) || dp == dq {
                return None;
            }
            let u = dp / (dp - dq);
            Some(line.parameter([p[0] + u * (q[0] - p[0]), p[1] + u * (q[1] - p[1])]))
        })
        .collect();
    let lo = ts.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = ts.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    (hi > lo).then_some([lo, hi])
}

/// A drawn extent along the op's line: a pinch, a short segment, or one
/// running from paper's end to end.
fn extent(state: &State, op: &PlainFold, rng: &mut Rng) -> Option<Extent> {
    let x = rng.next_f64();
    if x < 0.45 {
        let (_, at) = point_on(state, &op.line, rng)?;
        Some(Extent::Pinch {
            at,
            length: 0.02 + 0.15 * rng.next_f64(),
        })
    } else if x < 0.85 {
        let (_, from) = point_on(state, &op.line, rng)?;
        let (_, to) = point_on(state, &op.line, rng)?;
        Some(Extent::Segment { from, to })
    } else {
        // Paper's ends along the line: the farthest chord ends, on a layer
        // there.
        let mut ends: Vec<(f64, Point)> = Vec::new();
        for f in state.faces() {
            let (Some(image), Some(t)) = (state.face_image(f.id), state.isometry(f.id)) else {
                continue;
            };
            if let Some([lo, hi]) = chord(&op.line, image) {
                for p in [lo, hi] {
                    ends.push((p, t.inverse().apply(op.line.point_at(p))));
                }
            }
        }
        let first = ends.iter().min_by(|a, b| a.0.total_cmp(&b.0))?.1;
        let last = ends.iter().max_by(|a, b| a.0.total_cmp(&b.0))?.1;
        Some(Extent::Segment {
            from: first,
            to: last,
        })
    }
}

/// Everything but the marks and the step.
fn same_paper(a: &State, b: &State) -> bool {
    let (mut x, mut y) = (a.parts().clone(), b.parts().clone());
    x.marks.clear();
    y.marks.clear();
    x.step = 0;
    y.step = 0;
    x == y
}

#[derive(Default, Debug)]
struct Tally {
    marked: usize,
    marks: usize,
    checked_against_whole: usize,
    whole_line: usize,
    later: usize,
    subsumed: usize,
    refused: std::collections::BTreeMap<&'static str, usize>,
}

#[test]
fn random_partial_precreases_keep_every_invariant() {
    let mut tally = Tally::default();
    let mut rng = Rng::new(0x9a7c);
    for seed in 0..48u64 {
        // A random state from the campaign's own sequences.
        let Ok(sequence) = Sequence::new(seed, 1 + (seed % 6) as usize, 60) else {
            continue;
        };
        let mut state = sequence.state().clone();
        for step in sequence {
            if let Some(s) = step.state() {
                state = s.clone();
            }
        }
        for _ in 0..6 {
            let Some(op) = random::plain_fold(&state, &mut rng) else {
                continue;
            };
            let Some(extent) = extent(&state, &op, &mut rng) else {
                continue;
            };
            let marked = match state.precrease_extent(&op, &extent) {
                Ok(marked) => marked,
                Err(refused) => {
                    *tally.refused.entry(refused.refusal.code()).or_default() += 1;
                    continue;
                }
            };
            check_marked(&state, &op, &extent, &marked, &mut tally);
            // Later folds carry the marks.
            let mut now = marked.state.clone();
            for _ in 0..2 {
                let Some(next_op) = random::plain_fold(&now, &mut rng) else {
                    continue;
                };
                let Ok(next) = now.fold(&next_op) else {
                    continue;
                };
                check_carried(&now, &next.state, &mut tally);
                now = next.state;
            }
            state = marked.state;
        }
    }
    eprintln!("{tally:?}");
    assert!(tally.marked >= 80, "{tally:?}");
    assert!(tally.checked_against_whole >= 40, "{tally:?}");
    assert!(tally.whole_line >= 5, "{tally:?}");
    assert!(tally.later >= 60, "{tally:?}");
    for code in [
        "layer_order",
        "residual",
        "folded_image",
        "internal",
        "mark_on_crease",
        "marks_overlap",
    ] {
        assert!(
            !tally.refused.contains_key(code),
            "refused as {code}: {tally:?}"
        );
    }
}

fn check_marked(
    parent: &State,
    op: &PlainFold,
    extent: &Extent,
    marked: &Folded,
    tally: &mut Tally,
) {
    let child = &marked.state;
    tally.marked += 1;
    // No face split, nothing but the marks changed.
    assert!(same_paper(parent, child));
    assert_eq!(child.step(), parent.step() + 1);
    assert!(marked.report.created.is_empty() && marked.report.split == 0);
    assert_valid(child);
    let new: Vec<&CreaseMark> = child
        .crease_marks()
        .iter()
        .filter(|m| m.made_at == child.step())
        .collect();
    assert!(!new.is_empty());
    tally.marks += new.len();
    // Every new mark lies on the line, within the extent.
    let line = marked.report.analysis.line;
    let [e0, e1] = marked.extent.unwrap_or_else(|| panic!("no extent"));
    let (t0, t1) = (
        line.parameter(e0).min(line.parameter(e1)),
        line.parameter(e0).max(line.parameter(e1)),
    );
    for m in &new {
        for p in [m.a, m.b, m.at(0.5)] {
            let image = child
                .resolve_point(p)
                .unwrap_or_else(|| panic!("{p:?} off the paper"));
            assert!(line.distance_to_point(image) < 1e-9, "{m:?}");
            let t = line.parameter(image);
            assert!(t > t0 - 1e-9 && t < t1 + 1e-9, "{m:?} outside [{t0}, {t1}]");
        }
    }
    // The older marks keep their place, less what the new ones cover.
    for m in parent.crease_marks() {
        for k in 1..10 {
            let p = m.at(k as f64 / 10.0);
            assert!(
                child.crease_marks().iter().any(|n| on_mark(n, p, 1e-9)),
                "{m:?} lost {p:?}"
            );
        }
    }
    // The whole precrease's creases, cut to the extent, letter for letter
    // (at fractions that miss the crossings a symmetric fold puts at a
    // mark's middle).
    let Ok(whole) = parent.precrease(op) else {
        return;
    };
    tally.checked_against_whole += 1;
    for m in &new {
        for u in [0.13, 0.37, 0.61, 0.89] {
            let kind = made_through(&whole.state, m.at(u))
                .unwrap_or_else(|| panic!("{m:?} at {u} is on no crease of the whole precrease"));
            assert_eq!(kind, CreaseKind::Flat(m.letter), "{m:?}");
        }
    }
    // An extent over all the paper along the line marks every crease the
    // whole precrease makes, end to end.
    let created: Vec<[Point; 2]> = whole
        .state
        .creases()
        .iter()
        .filter(|c| c.made_at == whole.state.step())
        .map(|c| c.vertices.map(|v| whole.state.vertices()[v.0 as usize]))
        .collect();
    if let Extent::Segment { .. } = extent
        && t1 - t0 >= paper_along(parent, &line) - 1e-6
    {
        tally.whole_line += 1;
        let total: f64 = created
            .iter()
            .map(|[a, b]| (b[0] - a[0]).hypot(b[1] - a[1]))
            .sum();
        let marked: f64 = new.iter().map(|m| m.length()).sum();
        assert!((total - marked).abs() < 1e-6, "{total} {marked}");
    }
}

/// The kind of a crease the state's last step made through the sheet point.
fn made_through(state: &State, p: Point) -> Option<CreaseKind> {
    state
        .creases()
        .iter()
        .filter(|c| c.made_at == state.step())
        .find(|c| {
            let [a, b] = c.vertices.map(|v| state.vertices()[v.0 as usize]);
            segment_distance(p, a, b) < 1e-9
        })
        .map(|c| c.kind)
}

/// The length of `line` across the paper's silhouette.
fn paper_along(state: &State, line: &Line) -> f64 {
    let chords: Vec<[f64; 2]> = state
        .faces()
        .iter()
        .filter_map(|f| state.face_image(f.id).and_then(|image| chord(line, image)))
        .collect();
    let lo = chords.iter().map(|c| c[0]).fold(f64::INFINITY, f64::min);
    let hi = chords
        .iter()
        .map(|c| c[1])
        .fold(f64::NEG_INFINITY, f64::max);
    hi - lo
}

fn check_carried(parent: &State, child: &State, tally: &mut Tally) {
    tally.later += 1;
    assert_valid(child);
    // Each mark's sheet geometry stays, but for what a new crease covers.
    for m in parent.crease_marks() {
        for k in 1..20 {
            let p = m.at(k as f64 / 20.0);
            let kept = child
                .crease_marks()
                .iter()
                .any(|n| n.letter == m.letter && n.made_at == m.made_at && on_mark(n, p, 1e-9));
            if kept {
                continue;
            }
            let covered = made_through(child, p).is_some();
            // Within the minimum feature of a cut, a remnant too short to
            // keep goes too.
            let near_cut = child.creases().iter().any(|c| {
                c.made_at == child.step() && {
                    let [a, b] = c.vertices.map(|v| child.vertices()[v.0 as usize]);
                    segment_distance(p, a, b) < 2e-3
                }
            });
            assert!(
                covered || near_cut,
                "{m:?} lost {p:?} with no crease over it"
            );
            tally.subsumed += 1;
        }
    }
    // And no mark appears from nowhere.
    for n in child.crease_marks() {
        assert!(
            parent
                .crease_marks()
                .iter()
                .any(|m| m.letter == n.letter && on_mark(m, n.a, 1e-9) && on_mark(m, n.b, 1e-9)),
            "{n:?} is no part of a parent mark"
        );
    }
}

fn segment_distance(p: Point, a: Point, b: Point) -> f64 {
    let d = [b[0] - a[0], b[1] - a[1]];
    let len2 = d[0] * d[0] + d[1] * d[1];
    let t = if len2 == 0.0 {
        0.0
    } else {
        (((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len2).clamp(0.0, 1.0)
    };
    (p[0] - a[0] - t * d[0]).hypot(p[1] - a[1] - t * d[1])
}

/// The gate checks the marks of any parts it is handed, whatever made them.
#[test]
fn the_gate_refuses_marks_that_break_the_rules() {
    let s = partial(
        &square(),
        &all(y_eq(0.5), [0.5, 0.9], Valley),
        Extent::Pinch {
            at: [0.5, 0.5],
            length: 0.2,
        },
    )
    .state;
    let with = |edit: &dyn Fn(&mut Vec<CreaseMark>)| {
        let mut parts = s.parts().clone();
        edit(&mut parts.marks);
        State::make(parts).err().map(|e| e.code())
    };
    assert_eq!(with(&|_| {}), None);
    assert_eq!(with(&|m| m[0].b = [1.5, 0.5]), Some("mark_off_sheet"));
    assert_eq!(
        with(&|m| {
            m[0].a = [0.4, 0.5];
            m[0].b = [0.4 + 5e-4, 0.5];
        }),
        Some("mark_too_short")
    );
    assert_eq!(
        with(&|m| m.push(CreaseMark {
            a: [0.45, 0.5],
            b: [0.9, 0.5],
            letter: Letter::Valley,
            made_at: 1
        })),
        Some("marks_overlap")
    );
    // On a crease: precrease the line, then put the mark back.
    let creased = precrease(&s, &all(y_eq(0.5), [0.5, 0.9], Valley)).state;
    let mut parts = creased.parts().clone();
    parts.marks = s.crease_marks().to_vec();
    assert_eq!(
        State::make(parts).err().map(|e| e.code()),
        Some("mark_on_crease")
    );
    // A refused side of a pinch says why, and the other direction does not
    // help a pinch off the paper.
    let off = square()
        .precrease_extent(
            &all(y_eq(0.5), [0.5, 0.9], Valley),
            &Extent::Pinch {
                at: [0.5, 1.5],
                length: 0.1,
            },
        )
        .err()
        .unwrap_or_else(|| panic!("a pinch off the paper landed"));
    assert_eq!(off.refusal.code(), "extent_off_paper");
    assert!(off.fixes.is_empty());
}

// ---------------------------------------------------------------------------
// Edit and the FOLD export

#[cfg(feature = "kernel")]
mod kernel {
    use super::*;
    use oristudio_cp::geometry::LineColor;
    use oristudio_cp::io::fold::{export_fold_json, import_fold_json};
    use oristudio_fold::{export_fold_sequence, fold_cp_to_model};
    use serde_json::Value;

    fn pinched() -> (State, State) {
        let book = fold(&square(), &all(x_eq(0.5), [0.75, 0.5], Valley)).state;
        let marked = partial(
            &book,
            &all(y_eq(0.5), [0.25, 0.9], Valley),
            Extent::Pinch {
                at: top_sheet_point(&book, [0.25, 0.5]),
                length: 0.1,
            },
        )
        .state;
        (book, marked)
    }

    /// Both Send to Edit variants read one FOLD text: the marks are aux lines
    /// in it, whatever Edit then does with the unassigned precreases.
    #[test]
    fn marks_go_to_edit_as_auxiliary_lines() {
        let (book, marked) = pinched();
        let model = fold_cp_to_model(&marked);
        let creases = marked.creases().len();
        assert_eq!(model.line_segments.len(), creases + 2);
        assert!(
            model.line_segments[creases..]
                .iter()
                .all(|s| s.color == LineColor::Cyan3)
        );
        assert!(
            model.line_segments[..creases]
                .iter()
                .all(|s| s.color != LineColor::Cyan3)
        );
        // Without marks, nothing changes.
        assert_eq!(
            fold_cp_to_model(&book).line_segments.len(),
            book.creases().len()
        );
        // Through the kernel's FOLD writer and reader: still aux lines, at
        // the same places.
        let text = export_fold_json(&model, None).unwrap_or_else(|e| panic!("{e}"));
        let back = import_fold_json(&text).unwrap_or_else(|e| panic!("{e}"));
        let aux: Vec<_> = back
            .line_segments
            .iter()
            .filter(|s| s.color == LineColor::Cyan3)
            .collect();
        assert_eq!(aux.len(), 2);
        let json: Value = serde_json::from_str(&text).unwrap_or_default();
        let assignments = json["edges_assignment"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let colors = json["oristudio:edges_line_colors"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let aux_edges = colors.iter().filter(|c| c.as_i64() == Some(3)).count();
        assert_eq!(aux_edges, 2);
        for (assignment, color) in assignments.iter().zip(&colors) {
            if color.as_i64() == Some(3) {
                assert_eq!(assignment, "F");
            }
        }
    }

    /// The FOLD export's crease-pattern frame carries the last state's marks
    /// as aux lines; its step frames carry none.
    #[test]
    fn the_fold_export_root_carries_the_marks() {
        let (book, marked) = pinched();
        let path = vec![square(), book, marked];
        let document = export_fold_sequence(&path, Some("pinch")).unwrap_or_else(|e| panic!("{e}"));
        let json = serde_json::to_value(&document).unwrap_or_default();
        let colors = json["oristudio:edges_line_colors"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        assert_eq!(colors.iter().filter(|c| c.as_i64() == Some(3)).count(), 2);
        let frames = json["file_frames"].as_array().cloned().unwrap_or_default();
        assert_eq!(frames.len(), 3);
        let last = &frames[2];
        assert_eq!(
            last["edges_vertices"].as_array().map(Vec::len),
            Some(path[2].creases().len())
        );
    }
}
