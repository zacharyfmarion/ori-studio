//! Collapse (`implementation-plans/fold-collapse-existing-creases.md`): the
//! state folded again along creases it already has, on a hand-built square
//! precreased along both diagonals and both midlines, and along y = 0.25
//! (a precrease no collapse here names).
//!
//! What holds:
//!
//! - the creases a Collapse names fold (or open) with the letters given; the
//!   rest stay as they were, with the step that made them;
//! - the stretches are stored merged and in one order, however they were
//!   named;
//! - a stored order replays to the same state;
//! - letters that cannot fold flat are refused at the vertex that breaks
//!   Maekawa's or Kawasaki's theorem, and a stretch that is not the state's
//!   creases, or names one two ways, is refused before anything is derived.

use oristudio_fold::{
    CollapseCrease, CollapseError, CollapseRefusal, CollapseTo, Collapsing, CompletionLimits,
    CreaseKind, CreasePatternInput, ImportKind, ImportSegment, ImportSpace, ImportTarget,
    ImportedPattern, Letter, StartSide, State, VertexRule, WitnessOrder, collapse,
};

type Point = [f64; 2];

const C: Point = [0.5, 0.5];

fn flat(letter: Letter) -> ImportKind {
    ImportKind::Unassigned { hint: Some(letter) }
}

/// The precreased square, flat: the import of its pattern, its one order.
fn precreased() -> State {
    let corners: [Point; 4] = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
    let mut segments: Vec<ImportSegment> = (0..4)
        .map(|i| ImportSegment {
            from: corners[i],
            to: corners[(i + 1) % 4],
            kind: ImportKind::Border,
        })
        .collect();
    for (from, to, letter) in [
        ([0.0, 0.0], [1.0, 1.0], Letter::Valley),
        ([1.0, 0.0], [0.0, 1.0], Letter::Valley),
        ([0.5, 0.0], [0.5, 1.0], Letter::Mountain),
        ([0.0, 0.5], [1.0, 0.5], Letter::Mountain),
        ([0.0, 0.25], [1.0, 0.25], Letter::Valley),
    ] {
        segments.push(ImportSegment {
            from,
            to,
            kind: flat(letter),
        });
    }
    let input = CreasePatternInput {
        space: ImportSpace::Sheet,
        segments,
    };
    let pattern = ImportedPattern::new(
        &input,
        ImportTarget::Empty {
            start: StartSide::Front,
        },
    )
    .unwrap_or_else(|e| panic!("{} {e}", e.code()));
    let completions = pattern
        .complete(&limits())
        .unwrap_or_else(|e| panic!("{} {e}", e.code()));
    let order = completions
        .order(&vec![0; completions.components().len()])
        .unwrap_or_default();
    pattern
        .state(order)
        .unwrap_or_else(|e| panic!("{} {e}", e.code()))
}

fn limits() -> CompletionLimits {
    CompletionLimits::default()
}

fn stretch(a: Point, b: Point, to: CollapseTo) -> CollapseCrease {
    CollapseCrease { a, b, to }
}

/// A preliminary base: every diagonal half a mountain, three midline halves
/// valleys and the left half of the horizontal midline a mountain.
fn preliminary() -> Vec<CollapseCrease> {
    let m = CollapseTo::Mountain;
    let v = CollapseTo::Valley;
    vec![
        stretch(C, [0.0, 0.0], m),
        stretch(C, [1.0, 1.0], m),
        stretch(C, [1.0, 0.0], m),
        stretch(C, [0.0, 1.0], m),
        stretch(C, [0.5, 0.0], v),
        stretch(C, [0.5, 1.0], v),
        stretch(C, [0.0, 0.5], m),
        stretch(C, [1.0, 0.5], v),
    ]
}

/// The kind of the crease through a sheet point.
fn kind_at(state: &State, p: Point) -> CreaseKind {
    state
        .crease_at(p)
        .unwrap_or_else(|| panic!("no crease at {p:?}"))
        .kind
}

/// The one state a collapse lands, at its first order.
fn landed(parent: &State, creases: &[CollapseCrease]) -> (Collapsing, State) {
    let collapsing =
        Collapsing::new(parent, creases).unwrap_or_else(|e| panic!("collapse refused: {e}"));
    let completions = collapsing
        .pattern()
        .complete(&limits())
        .unwrap_or_else(|e| panic!("{} {e}", e.code()));
    let order = completions
        .order(&vec![0; completions.components().len()])
        .unwrap_or_default();
    let state = collapsing
        .pattern()
        .state(order)
        .unwrap_or_else(|e| panic!("{} {e}", e.code()));
    (collapsing, state)
}

#[test]
fn a_collapse_folds_what_it_names_and_leaves_the_rest() {
    let parent = precreased();
    let (_, state) = landed(&parent, &preliminary());
    assert_eq!(state.step(), parent.step() + 1);
    assert_eq!(
        kind_at(&state, [0.3, 0.3]),
        CreaseKind::Folded(Letter::Mountain)
    );
    assert_eq!(
        kind_at(&state, [0.5, 0.75]),
        CreaseKind::Folded(Letter::Valley)
    );
    assert_eq!(
        kind_at(&state, [0.25, 0.5]),
        CreaseKind::Folded(Letter::Mountain)
    );
    assert_eq!(
        kind_at(&state, [0.75, 0.5]),
        CreaseKind::Folded(Letter::Valley)
    );
    // The precrease along y = 0.25 is named by nothing: flat, as it was, and made when it was.
    for x in [0.1, 0.4, 0.6, 0.9] {
        assert_eq!(kind_at(&state, [x, 0.25]), CreaseKind::Flat(Letter::Valley));
        let before = parent.crease_at([x, 0.25]).map(|c| c.made_at);
        assert_eq!(state.crease_at([x, 0.25]).map(|c| c.made_at), before);
    }
    // What it folded is the Collapse's own.
    assert_eq!(
        state.crease_at([0.3, 0.3]).map(|c| c.made_at),
        Some(state.step())
    );
    // A quarter of the square, every layer stacked on it.
    let images: Vec<Point> = state
        .faces()
        .iter()
        .flat_map(|f| state.face_image(f.id).unwrap_or_default().to_vec())
        .collect();
    let span = |k: usize| {
        let (lo, hi) = images.iter().fold((f64::MAX, f64::MIN), |(lo, hi), p| {
            (lo.min(p[k]), hi.max(p[k]))
        });
        hi - lo
    };
    assert!(
        span(0) <= 0.5 + 1e-9 && span(1) <= 0.5 + 1e-9,
        "{} x {}",
        span(0),
        span(1)
    );
}

#[test]
fn the_stretches_are_stored_merged_and_in_one_order() {
    let parent = precreased();
    let v = CollapseTo::Valley;
    // One diagonal by its two halves, each named from its far end, the upper first.
    let named = [stretch([1.0, 1.0], C, v), stretch([0.0, 0.0], C, v)];
    let collapsing = Collapsing::new(&parent, &named).unwrap_or_else(|e| panic!("{e}"));
    let stored = collapsing.creases();
    assert_eq!(stored, [stretch([0.0, 0.0], [1.0, 1.0], v)]);
    let again = Collapsing::new(&parent, stored).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(again.creases(), stored);
}

#[test]
fn a_stored_order_replays_to_the_same_state() {
    let parent = precreased();
    let creases = preliminary();
    let (collapsing, state) = landed(&parent, &creases);
    let stored = WitnessOrder::of_state(&state).expect("witnesses");
    let replayed = collapse(&parent, collapsing.creases(), &stored, &limits())
        .unwrap_or_else(|e| panic!("{e}"))
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(replayed.creases(), state.creases());
    assert_eq!(replayed.order(), state.order());
    assert_eq!(replayed.view(), state.view());
}

#[test]
fn open_leaves_a_fold_flat_remembering_its_letter() {
    let parent = precreased();
    let (_, folded) = landed(&parent, &preliminary());
    let open: Vec<CollapseCrease> = preliminary()
        .into_iter()
        .map(|c| CollapseCrease {
            to: CollapseTo::Open,
            ..c
        })
        .collect();
    let (_, unfolded) = landed(&folded, &open);
    assert_eq!(
        kind_at(&unfolded, [0.3, 0.3]),
        CreaseKind::Flat(Letter::Mountain)
    );
    assert_eq!(
        kind_at(&unfolded, [0.5, 0.75]),
        CreaseKind::Flat(Letter::Valley)
    );
    assert!(unfolded.creases().iter().all(|c| !c.kind.is_folded()));
}

#[test]
fn letters_that_break_maekawa_are_refused_at_their_vertex() {
    let parent = precreased();
    // One diagonal half folded alone: a fold that ends inside the paper.
    match Collapsing::new(&parent, &[stretch(C, [1.0, 1.0], CollapseTo::Valley)]) {
        Err(CollapseError::Refused(CollapseRefusal::NotFlatAtVertex { rule, point })) => {
            assert_eq!(rule, VertexRule::Maekawa);
            assert!(
                (point[0] - 0.5).abs() < 1e-9 && (point[1] - 0.5).abs() < 1e-9,
                "{point:?}"
            );
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn letters_that_break_kawasaki_are_refused_at_their_vertex() {
    let parent = precreased();
    let m = CollapseTo::Mountain;
    // Three mountains and a valley, Maekawa's count, round angles of 45° and 135°.
    let creases = [
        stretch(C, [1.0, 1.0], m),
        stretch(C, [0.0, 0.0], m),
        stretch(C, [0.5, 1.0], m),
        stretch(C, [0.5, 0.0], CollapseTo::Valley),
    ];
    match Collapsing::new(&parent, &creases) {
        Err(CollapseError::Refused(CollapseRefusal::NotFlatAtVertex { rule, .. })) => {
            assert_eq!(rule, VertexRule::Kawasaki);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_stretch_that_is_not_the_states_creases_is_refused() {
    let parent = precreased();
    // No crease along y = 0.75: a Collapse draws no line.
    assert!(matches!(
        Collapsing::new(
            &parent,
            &[stretch([0.0, 0.75], [1.0, 0.75], CollapseTo::Valley)]
        ),
        Err(CollapseError::Refused(
            CollapseRefusal::CreaseMissing { .. }
        ))
    ));
    // The border is no crease.
    assert!(matches!(
        Collapsing::new(
            &parent,
            &[stretch([0.0, 0.0], [1.0, 0.0], CollapseTo::Valley)]
        ),
        Err(CollapseError::Refused(
            CollapseRefusal::CreaseMissing { .. }
        ))
    ));
    // One crease named two ways.
    assert!(matches!(
        Collapsing::new(
            &parent,
            &[
                stretch(C, [1.0, 1.0], CollapseTo::Valley),
                stretch([0.25, 0.25], [1.0, 1.0], CollapseTo::Mountain),
            ]
        ),
        Err(CollapseError::Refused(CollapseRefusal::CreaseTwice { .. }))
    ));
    assert!(matches!(
        Collapsing::new(&parent, &[]),
        Err(CollapseError::Refused(CollapseRefusal::Empty))
    ));
}
