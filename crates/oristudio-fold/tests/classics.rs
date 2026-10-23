//! Classic sequences (research §4.3: kite base, a flap unfold, a top-layer
//! corner after two folds, a precrease through 4 layers then refold, a tuck),
//! each built here with its own assertions and recorded as a fixture under
//! `tests/fixtures/classics/`: the operations as data and the canonical
//! outcome of every step. `classics_replay_from_their_fixtures` replays each
//! fixture from its JSON alone.
//!
//! Regenerate the fixtures with `ORISTUDIO_FOLD_BLESS=1 cargo test -p
//! oristudio-fold --test classics`; review the diff like any golden.

mod support;

use std::path::PathBuf;

use oristudio_fold::{
    CreaseKind, Direction, FoldRefusal, Folded, Letter, Placement, PlainFold, Seed, Sheet,
    SheetShape, StartSide, State,
};
use serde::{Deserialize, Serialize};
use support::*;

use Direction::{Mountain, Valley};

/// One recorded operation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "op")]
enum Op {
    Fold { fold: PlainFold },
    Precrease { fold: PlainFold },
    TurnOver,
}

/// A crease in canonical form: sheet endpoints rounded to 1e-9, smaller
/// first.
#[derive(Debug, Clone, PartialEq, PartialOrd, Serialize, Deserialize)]
struct CanonicalCrease {
    from: [f64; 2],
    to: [f64; 2],
    kind: CreaseKind,
    made_at: u32,
}

/// What a step must reproduce.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Outcome {
    faces: usize,
    pairs: usize,
    /// How many of the parent's faces moved (none for a turn-over).
    moved: usize,
    creases: Vec<CanonicalCrease>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Fixture {
    name: String,
    sheet: SheetShape,
    start: StartSide,
    steps: Vec<(Op, Outcome)>,
}

fn round(x: f64) -> f64 {
    let r = (x * 1e9).round() / 1e9;
    if r == 0.0 { 0.0 } else { r }
}

fn outcome(state: &State, moved: usize) -> Outcome {
    let mut creases: Vec<CanonicalCrease> = state
        .creases()
        .iter()
        .map(|c| {
            let [a, b] = c.vertices.map(|v| {
                let p = state.vertices()[v.0 as usize];
                [round(p[0]), round(p[1])]
            });
            let (from, to) = if a <= b { (a, b) } else { (b, a) };
            CanonicalCrease {
                from,
                to,
                kind: c.kind,
                made_at: c.made_at,
            }
        })
        .collect();
    creases.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    Outcome {
        faces: state.faces().len(),
        pairs: state.order().len(),
        moved,
        creases,
    }
}

/// Builds a sequence, checking every state with the full gate.
struct Recorder {
    fixture: Fixture,
    state: State,
}

impl Recorder {
    fn new(name: &str, sheet: SheetShape) -> Recorder {
        let state = State::flat(
            Sheet::new(&sheet).unwrap_or_else(|e| panic!("{e}")),
            StartSide::Front,
        )
        .unwrap_or_else(|e| panic!("{e}"));
        Recorder {
            fixture: Fixture {
                name: name.to_string(),
                sheet,
                start: StartSide::Front,
                steps: Vec::new(),
            },
            state,
        }
    }

    fn apply(&mut self, op: Op) -> Option<Folded> {
        let (next, folded) = run(&self.state, &op);
        assert_valid(&next);
        let moved = folded
            .as_ref()
            .map_or(0, |f| f.report.analysis.moving.len());
        self.fixture.steps.push((op, outcome(&next, moved)));
        self.state = next;
        folded
    }

    fn fold(&mut self, fold: PlainFold) -> Folded {
        self.apply(Op::Fold { fold })
            .unwrap_or_else(|| unreachable!())
    }

    fn precrease(&mut self, fold: PlainFold) -> Folded {
        self.apply(Op::Precrease { fold })
            .unwrap_or_else(|| unreachable!())
    }

    /// Compare with the fixture on disk, or write it when blessing.
    fn finish(self) {
        let path = fixture_path(&self.fixture.name);
        let json = serde_json::to_string_pretty(&self.fixture).unwrap_or_default() + "\n";
        if std::env::var_os("ORISTUDIO_FOLD_BLESS").is_some() {
            if let Some(dir) = path.parent()
                && let Err(e) = std::fs::create_dir_all(dir)
            {
                panic!("cannot create {}: {e}", dir.display());
            }
            if let Err(e) = std::fs::write(&path, json) {
                panic!("cannot write {}: {e}", path.display());
            }
            return;
        }
        // Compared as text, so a pass means blessing would leave the file
        // byte for byte as it is, field order and layout included.
        let stored = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{}: {e} (bless to create it)", path.display()));
        assert!(
            stored == json,
            "{} changed; rerun with ORISTUDIO_FOLD_BLESS=1 and review the diff",
            self.fixture.name
        );
    }
}

fn run(state: &State, op: &Op) -> (State, Option<Folded>) {
    match op {
        Op::Fold { fold: f } => {
            let r = fold(state, f);
            (r.state.clone(), Some(r))
        }
        Op::Precrease { fold: f } => {
            let r = precrease(state, f);
            (r.state.clone(), Some(r))
        }
        Op::TurnOver => (state.turn_over(), None),
    }
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/classics")
        .join(format!("{name}.json"))
}

fn count(state: &State, kind: CreaseKind) -> usize {
    state.creases().iter().filter(|c| c.kind == kind).count()
}

#[test]
fn kite_base_then_unfold_a_flap() {
    let mut r = Recorder::new("kite-base", SheetShape::Square);
    let diagonal = through([0.0, 0.0], [1.0, 1.0]);
    r.precrease(all(diagonal, [0.9, 0.1], Valley));
    assert_eq!(count(&r.state, CreaseKind::Flat(Letter::Valley)), 1);

    let bottom = at_angle([0.0, 0.0], 22.5);
    r.fold(all(bottom, [0.9, 0.05], Valley));
    let left = at_angle([0.0, 0.0], 67.5);
    r.fold(all(left, [0.05, 0.9], Valley));
    assert_eq!(count(&r.state, V), 2, "the kite's two valleys");
    assert_eq!(count(&r.state, M), 0);

    // Unfold the bottom flap: it lies above the 22.5° line now, on top.
    let at = top_sheet_point(&r.state, [0.7, 0.45]);
    let unfolded = r.fold(depth(bottom, [0.7, 0.45], Valley, at, 1));
    assert_eq!(
        unfolded.report.analysis.moving.len(),
        1,
        "only the flap moves"
    );
    assert_eq!(unfolded.report.unfolded.len(), 1);
    assert_eq!(count(&r.state, CreaseKind::Flat(Letter::Valley)), 2);
    assert_eq!(count(&r.state, V), 1);
    r.finish();
}

#[test]
fn a_top_layer_corner_after_two_folds() {
    let mut r = Recorder::new("top-layer-corner", SheetShape::Square);
    r.fold(all(x_eq(0.5), [0.75, 0.5], Valley));
    r.fold(all(y_eq(0.5), [0.25, 0.75], Valley));
    let at = top_sheet_point(&r.state, [0.03, 0.03]);
    let corner = r.fold(depth(
        through([0.0, 0.15], [0.15, 0.0]),
        [0.0, 0.0],
        Valley,
        at,
        1,
    ));
    assert_eq!(corner.report.analysis.moving.len(), 1);
    assert_eq!(made_at(&r.state, 3).len(), 1, "one chord");
    assert_eq!(
        made_at(&r.state, 3),
        vec![M],
        "the top layer shows its back"
    );
    // The bottom two layers' corner, mountain: it tucks behind.
    let at = top_sheet_point(&r.state, [0.02, 0.02]);
    let behind = r.fold(depth(
        through([0.0, 0.3], [0.3, 0.0]),
        [0.0, 0.0],
        Mountain,
        at,
        2,
    ));
    assert_eq!(behind.report.analysis.moving.len(), 2);
    assert!(behind.report.analysis.added.is_empty());
    r.finish();
}

#[test]
fn a_precrease_through_four_layers_then_refold() {
    let mut r = Recorder::new("precrease-four-layers", SheetShape::Square);
    r.fold(all(x_eq(0.5), [0.75, 0.5], Valley));
    r.fold(all(y_eq(0.5), [0.25, 0.75], Valley));
    let diagonal = through([0.0, 0.0], [0.5, 0.5]);
    let pre = r.precrease(all(diagonal, [0.1, 0.4], Valley));
    let flats: Vec<Letter> = r
        .state
        .creases()
        .iter()
        .filter_map(|c| match c.kind {
            CreaseKind::Flat(l) => Some(l),
            _ => None,
        })
        .collect();
    assert_eq!(flats.len(), 4, "one precrease segment per layer");
    assert!(flats.contains(&Letter::Valley) && flats.contains(&Letter::Mountain));
    assert_eq!(pre.report.created.len(), 4);
    let precreased = r.state.clone();

    // Refold as it was: every segment takes the letter it remembers.
    let refold = fold(&precreased, &all(diagonal, [0.1, 0.4], Valley));
    assert_valid(&refold.state);
    assert_eq!(refold.state.creases().len(), precreased.creases().len());
    assert_eq!(refold.report.refolded.len(), 4);
    assert!(
        refold
            .report
            .refolded
            .iter()
            .all(|f| f.letter == f.remembered)
    );
    // The other way: every segment takes the opposite letter.
    let opposite = fold(&precreased, &all(diagonal, [0.1, 0.4], Mountain));
    assert_valid(&opposite.state);
    assert!(
        opposite
            .report
            .refolded
            .iter()
            .all(|f| f.letter != f.remembered)
    );
    r.fold(all(diagonal, [0.1, 0.4], Valley));
    r.finish();
}

#[test]
fn a_tuck_under_the_top_layer() {
    let mut r = Recorder::new("tuck-under-top", SheetShape::Square);
    r.fold(all(x_eq(0.5), [0.75, 0.5], Valley));
    let line = through([0.0, 0.3], [0.3, 0.0]);
    // The bottom layer's corner, valley-folded up and inserted under the top
    // layer instead of over it.
    let tuck = all(line, [0.0, 0.0], Valley)
        .with_seed(Seed::Flaps {
            at: vec![[0.05, 0.05]],
        })
        .with_placement(Placement::Under { at: [0.75, 0.5] });
    let landed = r.fold(tuck);
    assert_eq!(
        landed.report.analysis.moving.len(),
        1,
        "only the bottom corner"
    );
    let corner = landed.report.moving_faces[0];
    let top = face(&r.state, [0.75, 0.5]);
    assert!(!above(&r.state, corner, top), "under the top layer");
    r.finish();

    // Negative: both corners inserted under the top layer interleave their
    // tacos, and the gate refuses it.
    let s = fold(
        &State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}")),
        &all(x_eq(0.5), [0.75, 0.5], Valley),
    )
    .state;
    let both = all(line, [0.0, 0.0], Valley)
        .with_seed(Seed::Depth {
            at: [0.03, 0.03],
            layers: 2,
        })
        .with_placement(Placement::Under { at: [0.75, 0.5] });
    let e = refused(&s, &both);
    assert!(
        matches!(e.refusal, FoldRefusal::LayerOrder { .. }),
        "{:?}",
        e.refusal
    );
}

#[test]
fn classics_replay_from_their_fixtures() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/classics");
    let mut seen = 0;
    let mut entries: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    entries.sort();
    for path in entries {
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        let fixture: Fixture =
            serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let mut state = State::flat(
            Sheet::new(&fixture.sheet).unwrap_or_else(|e| panic!("{e}")),
            fixture.start,
        )
        .unwrap_or_else(|e| panic!("{e}"));
        for (i, (op, expected)) in fixture.steps.iter().enumerate() {
            let (next, folded) = run(&state, op);
            let moved = folded.map_or(0, |f| f.report.analysis.moving.len());
            assert_eq!(
                &outcome(&next, moved),
                expected,
                "{} step {i}",
                fixture.name
            );
            state = next;
        }
        seen += 1;
    }
    assert!(seen >= 4, "only {seen} fixtures");
}
