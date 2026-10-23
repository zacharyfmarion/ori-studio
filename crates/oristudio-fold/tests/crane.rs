//! A real sequence through the reverse fold (plan Phase 9's fixtures;
//! research §5.2: "still untested: a real sequence beyond the preliminary
//! base"): the traditional crane by Ida's route (`tests/ida`), checked
//! against what Beloch commits for it.
//!
//! Every frame is matched exactly — the same faces, the same isometries
//! after one rigid map, the same layer order — numbering-free
//! (`beloch::matches`): `bird-base-petal.fold` step by step, and the finished
//! 60-face `crane.fold`. Every reverse fold on the way passes the compound
//! checks (`tests/compound`): the full gate, the letter rules, a plain
//! fold's geometry, the motion's endpoints. The neck, tail and head are also
//! folded on the bird base imported from `bird-base-petal.fold`'s crease
//! pattern through Import CP — the route a sequence takes while squash and
//! petal folds do not exist — and land on the same crane.

mod beloch;
mod compound;
mod ida;
mod support;

use ida::{A, B, C, D, Op, SQRT2, Sequence};
use oristudio_fold::{
    CompletionLimits, CreasePatternInput, Direction, ImportKind, ImportSegment, ImportTarget,
    ImportedPattern, Isometry, ReverseKind, Seed, Sheet, Side, StartSide, State,
};
use serde_json::{Value, json};
use support::assert_valid;

/// The checks every step passes.
fn check_steps(sequence: &Sequence) {
    for step in &sequence.steps {
        assert_valid(&step.state);
        if let (Op::Reverse(op, _), Some(folded)) = (&step.op, &step.reverse) {
            compound::check(&step.parent, op, folded);
            assert!(
                compound::assert_plain_fold_geometry(&step.parent, op, folded),
                "{}: the plain fold of the tip moves more",
                step.name
            );
        }
    }
}

/// The bird base from the square, each step matched against
/// `bird-base-petal.fold`'s frame.
fn bird_base() -> Sequence {
    let doc = beloch::document("bird-base-petal.fold");
    let square = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let mut sequence = Sequence::new(square, Isometry::IDENTITY);
    sequence.bird_base();
    for (k, step) in sequence.steps.iter().enumerate() {
        let frame = beloch::frame(&doc, Some(k + 1)).unwrap_or_else(|e| panic!("{e}"));
        let phi = beloch::matches(&step.state, &frame)
            .unwrap_or_else(|e| panic!("{} against frame {}: {e}", step.name, k + 1));
        assert!(
            phi.0
                .iter()
                .zip(&Isometry::IDENTITY.0)
                .all(|(a, b)| (a - b).abs() < 1e-9),
            "{}: the model frame is the table's",
            step.name
        );
    }
    check_steps(&sequence);
    sequence
}

/// The neck, tail and head from the sequence's bird base, matched against
/// `crane.fold`.
fn crane(sequence: &mut Sequence) -> State {
    let from = sequence.steps.len();
    let start = sequence.state().clone();
    sequence.neck_and_tail();
    assert_eq!(sequence.state().faces().len(), 52);
    let doc = beloch::document("crane.fold");
    let pattern = beloch::pattern(&doc).unwrap_or_else(|e| panic!("{e}"));
    let head = ida::new_crease_line(sequence.state(), &pattern);
    sequence.head(head);
    let tail = Sequence {
        start,
        steps: sequence.steps.split_off(from),
        to_model: sequence.to_model,
    };
    check_steps(&tail);
    let crane = tail.state().clone();
    let frame = beloch::frame(&doc, None).unwrap_or_else(|e| panic!("{e}"));
    beloch::matches(&crane, &frame).unwrap_or_else(|e| panic!("the crane: {e}"));
    crane
}

#[test]
fn the_bird_base_by_reverse_folds_is_belochs_frame_by_frame() {
    let bird = bird_base();
    let state = bird.state();
    assert_eq!(state.faces().len(), 16);
    // The legs b and d at (1, 1), the petals' points a and c past the
    // centre.
    for (corner, want) in [
        (B, [1.0, 1.0]),
        (D, [1.0, 1.0]),
        (A, [1.0 - SQRT2 / 2.0; 2]),
        (C, [1.0 - SQRT2 / 2.0; 2]),
    ] {
        let at = ida::vertex_image(state, corner);
        assert!(
            (at[0] - want[0]).abs() < 1e-12 && (at[1] - want[1]).abs() < 1e-12,
            "{corner:?} at {at:?}"
        );
    }
    // Six inside reverses, each unique: no step asked for an order.
    let reverses = bird.steps.iter().filter(|s| s.reverse.is_some()).count();
    assert_eq!(reverses, 6);
}

/// From the square: 16 steps, 60 faces, Beloch's crane.
#[test]
fn the_crane_from_the_square_is_belochs_crane() {
    let mut sequence = bird_base();
    let crane = crane(&mut sequence);
    assert_eq!(crane.faces().len(), 60);
}

/// The neck, tail and head on the bird base as the web app's Import CP lands
/// it — the crease pattern imported after a flat square (the root and frame
/// continuing the sheet's, plan D16), its flat creases guides to the CP
/// kernel's FOLD reader so it has no precreases, its order the letters' one
/// completion — as document steps along model lines, each passing the
/// compound checks: the web app's wasm test folds
/// `tests/fixtures/fold-crane/crane-on-bird-base.json` through the bridge.
/// The frame and the head's line are Beloch's, read off the base with its
/// precreases. The fixture must be what the engine folds now; a mismatch
/// prints the steps it folds.
#[test]
fn the_crane_steps_fixture_is_what_the_engine_folds() {
    let doc = beloch::document("bird-base-petal.fold");
    let frame = beloch::frame(&doc, None).unwrap_or_else(|e| panic!("{e}"));
    let flat = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let pattern = ImportedPattern::new(&frame.input, ImportTarget::After(&flat))
        .unwrap_or_else(|e| panic!("{e}"));
    let completions = pattern
        .complete(&CompletionLimits::default())
        .unwrap_or_else(|e| panic!("{e}"));
    // The import's pick that is Beloch's bird base, one listed order per component.
    let sizes: Vec<usize> = completions
        .components()
        .iter()
        .map(|c| c.orders.len())
        .collect();
    let mut picks: Vec<Vec<usize>> = vec![Vec::new()];
    for &size in &sizes {
        picks = picks
            .into_iter()
            .flat_map(|pick| {
                (0..size).map(move |k| {
                    let mut more = pick.clone();
                    more.push(k);
                    more
                })
            })
            .collect();
    }
    let (beloch_base, phi) = picks
        .into_iter()
        .find_map(|pick| {
            let state = pattern.state(completions.order(&pick)?).ok()?;
            let phi = beloch::matches(&state, &frame).ok()?;
            Some((state, phi))
        })
        .unwrap_or_else(|| panic!("no listed order is Beloch's bird base"));
    // The head's line is read off Beloch's crane on the base with its
    // precreases, whose crease pattern the finished crane's matches.
    let crane_pattern =
        beloch::pattern(&beloch::document("crane.fold")).unwrap_or_else(|e| panic!("{e}"));
    let head = {
        let mut belochs = Sequence::new(beloch_base, phi.inverse());
        belochs.neck_and_tail();
        ida::new_crease_line(belochs.state(), &crane_pattern)
    };
    // What the CP kernel's FOLD reader keeps of the file: its flat creases
    // are guides to it, never creases, so the bird base imports without its
    // precreases. It lands in the same model frame, after the same sheet.
    let read = CreasePatternInput {
        segments: frame
            .input
            .segments
            .iter()
            .map(|s| match s.kind {
                ImportKind::Unassigned { .. } => ImportSegment {
                    kind: ImportKind::Aux,
                    ..s.clone()
                },
                _ => s.clone(),
            })
            .collect(),
        ..frame.input.clone()
    };
    let read =
        ImportedPattern::new(&read, ImportTarget::After(&flat)).unwrap_or_else(|e| panic!("{e}"));
    let orders = read
        .complete(&CompletionLimits::default())
        .unwrap_or_else(|e| panic!("{e}"));
    assert!(
        orders.is_unique(),
        "the bird base's letters leave {:?}",
        orders.count()
    );
    let imported = read
        .state(orders.order(&[]).unwrap_or_default())
        .unwrap_or_else(|e| panic!("{e}"));
    let mut sequence = Sequence::new(imported, phi.inverse());
    sequence.neck_and_tail();
    sequence.head(head);
    check_steps(&sequence);
    let sizes: Vec<usize> = Vec::new();
    let choice: Vec<usize> = Vec::new();

    let steps: Vec<Value> = sequence.steps.iter().map(document_step).collect();
    let fresh = json!({
        "about": "Generated by crates/oristudio-fold/tests/crane.rs (the_crane_steps_fixture_is_what_the_engine_folds): the crane's narrowing folds, neck, tail and head by Ida's route on the bird base Import CP lands from tests/fixtures/beloch/bird-base-petal.fold (its flat creases read as guides, so without its precreases), as document steps along model lines.",
        "import": { "fixture": "beloch/bird-base-petal.fold", "orders": sizes, "choice": choice },
        "steps": steps,
    });
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/fold-crane/crane-on-bird-base.json");
    let stored: Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(Value::Null);
    assert!(
        same_json(&stored, &fresh),
        "{} is stale; the engine folds:\n{}",
        path.display(),
        serde_json::to_string_pretty(&fresh).unwrap_or_default()
    );
}

/// A step of the sequence as the document stores it along a model line.
fn document_step(step: &ida::Step) -> Value {
    let line = |line: &oristudio_geometry::Line| json!({ "via": "model", "line": { "n": line.n, "d": line.d } });
    let side = |side: Side| match side {
        Side::Positive => "positive",
        Side::Negative => "negative",
    };
    let seed = |seed: &Seed| match seed {
        Seed::All => json!({ "scope": "all" }),
        Seed::Depth { at, layers } => json!({ "scope": "depth", "at": at, "layers": layers }),
        Seed::Flaps { at } => json!({ "scope": "flaps", "at": at }),
    };
    let (op, choices) = match &step.op {
        ida::Op::Fold(fold) => (
            json!({
                "kind": match fold.direction { Direction::Valley => "valley", Direction::Mountain => "mountain" },
                "line": line(&fold.line),
                "side": side(fold.side),
                "seed": seed(&fold.seed),
            }),
            json!({}),
        ),
        ida::Op::Reverse(reverse, stored) => (
            json!({
                "kind": match reverse.kind { ReverseKind::Inside => "inside-reverse", ReverseKind::Outside => "outside-reverse" },
                "line": line(&reverse.line),
                "side": side(reverse.side),
                "seed": seed(&reverse.anchor),
            }),
            if stored.openings.is_empty() {
                json!({})
            } else {
                json!({ "opening": stored.openings })
            },
        ),
    };
    json!({
        "name": step.name,
        "op": op,
        "choices": choices,
        "faces": step.state.faces().len(),
    })
}

/// Equal JSON, numbers within 1e-9: the last bits of a sine differ between platforms.
fn same_json(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => match (x.as_f64(), y.as_f64()) {
            (Some(x), Some(y)) => (x - y).abs() <= 1e-9,
            _ => x == y,
        },
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same_json(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| same_json(v, w)))
        }
        _ => a == b,
    }
}

/// The neck, tail and head on the bird base imported from Beloch's crease
/// pattern (Import CP, its frame's order replayed by witnesses): the same
/// crane.
#[test]
fn the_crane_neck_reverses_on_an_imported_bird_base() {
    let doc = beloch::document("bird-base-petal.fold");
    let imported = beloch::final_state(&doc).unwrap_or_else(|e| panic!("{e}"));
    let frame = beloch::frame(&doc, None).unwrap_or_else(|e| panic!("{e}"));
    let phi = beloch::matches(&imported, &frame).unwrap_or_else(|e| panic!("{e}"));
    let mut sequence = Sequence::new(imported, phi.inverse());
    let crane = crane(&mut sequence);
    assert_eq!(crane.faces().len(), 60);
}
