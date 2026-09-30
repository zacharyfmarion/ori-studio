//! The other ways a card offers (`order::ways`), over every manifest fixture:
//! swapping any of them in for the pick leaves the replayed plan as it was,
//! and the emitted sequence carries them so the web can draw each one.

mod common;

use common::*;
use oristudio_precrease::closure::Closure;
use oristudio_precrease::order::ways;
use oristudio_precrease::order::{Placed, order_with};
use oristudio_precrease::pinch::placed_pinch_pass;
use oristudio_precrease::quality::{Quality, evaluate_with};
use oristudio_precrease::sequence::Way;
use oristudio_precrease::sequence::{Sequence, StepKind};
use serde_json::Value;

fn manifest_components() -> Vec<(String, u32)> {
    let path = fixture_dir().join("manifest.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let value: Value = serde_json::from_str(&text).expect("manifest json");
    value["fixtures"]
        .as_array()
        .expect("fixtures array")
        .iter()
        .map(|entry| {
            (
                entry["file"].as_str().expect("file").to_string(),
                entry["component"].as_u64().unwrap_or(0) as u32,
            )
        })
        .collect()
}

/// Every manifest fixture, planned: the file, the planner and its sequence.
fn planned() -> Vec<(String, oristudio_precrease::Planner, Sequence)> {
    manifest_components()
        .into_iter()
        .map(|(file, component)| {
            let analysis = analyze_cp(&load(&file));
            let comp = analysis
                .components
                .iter()
                .find(|c| c.id == component)
                .unwrap_or_else(|| panic!("{file}: no component {component}"));
            let (planner, seq) = plan_component(comp, unbounded_options());
            (file, planner, seq)
        })
        .collect()
}

fn substitute(closure: &Closure, placed: &mut [Placed], k: usize, way: &Way) {
    let f = &closure.folded()[placed[k].folded];
    placed[k].chosen = Some(f.witnesses.len());
    placed[k].found = Some(way.witness.clone());
    placed[k].also = way.also.clone();
    placed[k].alignment = way.alignment;
}

/// How `after` differs from `before` in anything a way must leave alone: the
/// folds, presses and cards, the crease and the marks each leaves, what is
/// exact — and in correctness, which a way may improve but never worsen.
fn regressions(before: &Quality, after: &Quality) -> Vec<String> {
    let unchanged = [
        ("folds", before.folds, after.folds),
        ("presses", before.presses, after.presses),
        ("cards", before.cards, after.cards),
        ("turnovers", before.turnovers, after.turnovers),
        ("lost_ends", before.lost_ends, after.lost_ends),
        ("uncovered", before.uncovered, after.uncovered),
        ("wrong_face", before.wrong_face, after.wrong_face),
        ("extra_marks", before.extra_marks, after.extra_marks),
    ];
    let no_worse = [
        ("unavailable", before.unavailable, after.unavailable),
        (
            "pinches_beyond",
            before.pinches_beyond,
            after.pinches_beyond,
        ),
        (
            "unknown_pinch_precision",
            before.unknown_pinch_precision,
            after.unknown_pinch_precision,
        ),
    ];
    let mut out: Vec<String> = unchanged
        .iter()
        .filter(|(_, a, b)| a != b)
        .chain(no_worse.iter().filter(|(_, a, b)| b > a))
        .map(|(name, a, b)| format!("{name}: {a} -> {b}"))
        .collect();
    if before.approximate_folds != after.approximate_folds {
        out.push(format!(
            "approximate_folds: {:?} -> {:?}",
            before.approximate_folds, after.approximate_folds
        ));
    }
    if !after
        .unavailable_folds
        .iter()
        .all(|i| before.unavailable_folds.contains(i))
    {
        out.push(format!(
            "unavailable_folds: {:?} -> {:?}",
            before.unavailable_folds, after.unavailable_folds
        ));
    }
    if (after.extra_length - before.extra_length).abs() > 1e-9 {
        out.push(format!(
            "extra_length: {} -> {}",
            before.extra_length, after.extra_length
        ));
    }
    out
}

/// Replayed with the plan's own auxiliary pinches, as the web shows every
/// other card: a way changes what one card presents, never another card.
#[test]
fn swapping_in_any_way_leaves_the_replayed_plan_as_it_was() {
    let mut failures = Vec::new();
    let mut checked = 0;
    for (file, planner, _) in planned() {
        let closure = planner.closure_ref().expect("closure");
        for merge_twins in [true, false] {
            let placed = order_with(closure, false, merge_twins);
            let verdicts = placed_pinch_pass(closure, &placed);
            let offered = ways::of(closure, &placed, &verdicts);
            let before = evaluate_with(closure, &placed, &verdicts);
            for (k, card) in offered.iter().enumerate() {
                if placed[k].twin_of.is_some() {
                    continue;
                }
                let twin = placed
                    .get(k + 1)
                    .is_some_and(|q| q.twin_of == Some(placed[k].folded))
                    .then_some(k + 1);
                for i in 1..card.len() {
                    let mut proposed = placed.clone();
                    substitute(closure, &mut proposed, k, &card[i]);
                    if let Some(t) = twin {
                        substitute(closure, &mut proposed, t, &offered[t][i]);
                    }
                    checked += 1;
                    let after = evaluate_with(closure, &proposed, &verdicts);
                    let problems = regressions(&before, &after);
                    if !problems.is_empty() {
                        failures.push(format!(
                            "{file} (twins {merge_twins}) step {k} way {i} {}: {problems:?}",
                            card[i].kind
                        ));
                    }
                }
            }
        }
    }
    assert!(checked > 0, "no fixture offered a second way");
    assert!(
        failures.is_empty(),
        "{checked} ways checked:\n{}",
        failures.join("\n")
    );
}

#[test]
fn the_emitted_sequence_carries_every_way_with_its_marks() {
    let mut cards_with_ways = 0;
    for (file, _, seq) in planned() {
        let points: Vec<usize> = seq.points.iter().map(|p| p.id).collect();
        for (k, step) in seq.steps.iter().enumerate() {
            if step.ways.is_empty() {
                continue;
            }
            cards_with_ways += 1;
            assert!(
                step.ways.len() >= 2,
                "{file} step {}: one way is no choice",
                step.id
            );
            assert_eq!(
                Some(&step.ways[0].witness),
                step.chosen.and_then(|c| step.witnesses.get(c)),
                "{file} step {}: the pick is way 1",
                step.id
            );
            assert_eq!(step.ways[0].decided_by, None);
            for way in &step.ways {
                for r in way
                    .witness
                    .inputs
                    .iter()
                    .chain(way.also.iter().flat_map(|a| &a.inputs))
                {
                    if r.is_point() {
                        assert!(
                            points.contains(&r.id()),
                            "{file} step {}: mark {} of a way is not in the table",
                            step.id,
                            r.id()
                        );
                    }
                }
            }
            for way in &step.ways[1..] {
                assert!(way.decided_by.is_some(), "{file} step {}", step.id);
            }
            if let Some(twin) = step.twin {
                let other = seq.steps.iter().find(|s| s.id == twin).expect("twin step");
                assert_eq!(
                    step.ways.len(),
                    other.ways.len(),
                    "{file} steps {} and {twin}: a twin card's ways switch together",
                    step.id
                );
            }
            // A press that shows its fold's witness offers the fold's ways.
            for press in seq.steps[k + 1..].iter().filter(|s| {
                s.kind == StepKind::Press && s.line_id == step.line_id && s.chosen == step.chosen
            }) {
                let kinds = |s: &oristudio_precrease::Step| {
                    s.ways.iter().map(|w| w.kind.clone()).collect::<Vec<_>>()
                };
                assert_eq!(kinds(press), kinds(step), "{file} press {}", press.id);
            }
        }
    }
    assert!(cards_with_ways > 0);
}
