//! Measure the other ways the cards of a plan offer (`order::ways`).
//!
//! ```sh
//! cargo run --release -p oristudio-precrease --example measure_ways -- <dir-or-file>...
//! ```
//!
//! Per design and in total: cards, cards with a second way, how many ways
//! they offer, which kinds are offered beside which picks, why the pick won
//! (`decided_by`), what finding them costs in time, and what they add to the
//! plan's JSON. Planned as `measure_ends` plans — the product's budgets,
//! without the ReferenceFinder fallback — and timed on the plan's own
//! placement before the optimiser, which has the same steps.
//!
//! `--check` also swaps every way in for its pick on that placement and
//! replays it with the plan's own auxiliary pinches (`quality::evaluate_with`)
//! — `tests/planner_ways.rs` over the corpus — and prints any way that
//! changes the plan.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use oristudio_precrease::analyze;
use oristudio_precrease::fixture_io::load_path;
use oristudio_precrease::order::{Placed, order_with, ways};
use oristudio_precrease::pinch::placed_pinch_pass;
use oristudio_precrease::planner::{Planner, PlannerOptions};
use oristudio_precrease::quality::evaluate_with;
use oristudio_precrease::sequence::{Sequence, StepKind};

const ORIEDITA_PAPER: [f64; 4] = [-200.0, -200.0, 200.0, 200.0];

#[derive(Default)]
struct Tally {
    cards: usize,
    cards_with_ways: usize,
    /// Cards by how many ways they offer.
    by_count: BTreeMap<usize, usize>,
    /// Alternatives offered, by the pick's kind and theirs.
    offered: BTreeMap<(String, String), usize>,
    decided_by: BTreeMap<String, usize>,
    ways_ms: f64,
    json_bytes: usize,
    json_bytes_without: usize,
    /// Ways swapped in by `--check`, and those that changed the plan.
    checked: usize,
    changed: Vec<String>,
}

impl Tally {
    fn add(&mut self, other: Tally) {
        self.cards += other.cards;
        self.cards_with_ways += other.cards_with_ways;
        for (k, v) in other.by_count {
            *self.by_count.entry(k).or_default() += v;
        }
        for (k, v) in other.offered {
            *self.offered.entry(k).or_default() += v;
        }
        for (k, v) in other.decided_by {
            *self.decided_by.entry(k).or_default() += v;
        }
        self.ways_ms += other.ways_ms;
        self.json_bytes += other.json_bytes;
        self.json_bytes_without += other.json_bytes_without;
        self.checked += other.checked;
        self.changed.extend(other.changed);
    }
}

fn measure(seq: &Sequence) -> Tally {
    let mut t = Tally::default();
    let mut seen_cards = Vec::new();
    for step in &seq.steps {
        if seen_cards.contains(&step.card) || step.kind == StepKind::Press {
            continue;
        }
        seen_cards.push(step.card);
        t.cards += 1;
        if step.ways.len() < 2 {
            continue;
        }
        t.cards_with_ways += 1;
        *t.by_count.entry(step.ways.len()).or_default() += 1;
        let pick = step.ways[0].kind.clone();
        for way in &step.ways[1..] {
            *t.offered
                .entry((pick.clone(), way.kind.clone()))
                .or_default() += 1;
            let why = way
                .decided_by
                .map_or("none".to_string(), |c| format!("{c:?}"));
            *t.decided_by.entry(why).or_default() += 1;
        }
    }
    t.json_bytes = serde_json::to_string(seq).map_or(0, |s| s.len());
    let mut without = seq.clone();
    for step in &mut without.steps {
        step.ways.clear();
    }
    t.json_bytes_without = serde_json::to_string(&without).map_or(0, |s| s.len());
    t
}

/// Swap each way in for its pick (both of a twin pair's together) and
/// replay with the plan's own pinches: the ways checked, and a line for
/// every one that changed what the replay measures.
fn check(closure: &oristudio_precrease::Closure, placed: &[Placed]) -> (usize, Vec<String>) {
    let verdicts = placed_pinch_pass(closure, placed);
    let offered = ways::of(closure, placed, &verdicts);
    let before = evaluate_with(closure, placed, &verdicts);
    let swap = |into: &mut Vec<Placed>, k: usize, way: &oristudio_precrease::sequence::Way| {
        let f = &closure.folded()[into[k].folded];
        into[k].chosen = Some(f.witnesses.len());
        into[k].found = Some(way.witness.clone());
        into[k].also = way.also.clone();
        into[k].alignment = way.alignment;
    };
    let mut checked = 0;
    let mut changed = Vec::new();
    for (k, card) in offered.iter().enumerate() {
        if placed[k].twin_of.is_some() {
            continue;
        }
        let twin = placed
            .get(k + 1)
            .is_some_and(|q| q.twin_of == Some(placed[k].folded))
            .then_some(k + 1);
        for i in 1..card.len() {
            let mut proposed = placed.to_vec();
            swap(&mut proposed, k, &card[i]);
            if let Some(t) = twin {
                swap(&mut proposed, t, &offered[t][i]);
            }
            checked += 1;
            let after = evaluate_with(closure, &proposed, &verdicts);
            let differs = after.folds != before.folds
                || after.presses != before.presses
                || after.cards != before.cards
                || after.turnovers != before.turnovers
                || after.lost_ends != before.lost_ends
                || after.uncovered != before.uncovered
                || after.extra_marks != before.extra_marks
                || (after.extra_length - before.extra_length).abs() > 1e-9
                || after.approximate_folds != before.approximate_folds
                || after.unavailable > before.unavailable
                || after.pinches_beyond > before.pinches_beyond
                || after.unknown_pinch_precision > before.unknown_pinch_precision;
            if differs {
                changed.push(format!("step {k} way {i} {}", card[i].kind));
            }
        }
    }
    (checked, changed)
}

fn plan_file(path: &Path, verify: bool) -> Option<Tally> {
    let cp = load_path(path, None).ok()?;
    let analysis = analyze(&cp.segments, &cp.colors, Some(ORIEDITA_PAPER)).ok()?;
    let mut total = Tally::default();
    for component in &analysis.components {
        let mut planner = Planner::new(component, PlannerOptions::default());
        if planner.plan_without_reference_finder().is_err() {
            return None;
        }
        let mut t = measure(&planner.sequence(false));
        if let Some(closure) = planner.closure_ref() {
            let placed = order_with(closure, false, true);
            let verdicts = placed_pinch_pass(closure, &placed);
            let start = Instant::now();
            let _ = ways::of(closure, &placed, &verdicts);
            t.ways_ms = start.elapsed().as_secs_f64() * 1e3;
            if verify {
                (t.checked, t.changed) = check(closure, &placed);
            }
        }
        total.add(t);
    }
    (total.cards > 0).then_some(total)
}

fn collect(path: &Path, out: &mut Vec<PathBuf>) {
    if path.is_dir() {
        let Ok(entries) = std::fs::read_dir(path) else {
            return;
        };
        let mut kids: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        kids.sort();
        for kid in kids {
            collect(&kid, out);
        }
    } else if matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("fold" | "cp" | "opx")
    ) {
        out.push(path.to_path_buf());
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let verify = args.iter().any(|a| a == "--check");
    let mut paths = Vec::new();
    for a in args.iter().filter(|a| *a != "--check") {
        collect(Path::new(a), &mut paths);
    }
    paths.retain(|p| {
        !matches!(
            p.file_stem().and_then(|s| s.to_str()),
            Some("detected" | "topology")
        )
    });
    println!("design\tcards\twith ways\tways ms\tjson +%");
    let mut total = Tally::default();
    let mut times: Vec<f64> = Vec::new();
    let mut planned = 0;
    for path in &paths {
        let name = if path.file_stem().is_some_and(|s| s == "truth") {
            path.parent().and_then(|d| d.file_name())
        } else {
            path.file_name()
        }
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
        let Some(t) = plan_file(path, verify) else {
            println!("{name}\tdid not plan");
            continue;
        };
        planned += 1;
        println!(
            "{name}\t{}\t{}\t{:.1}\t{:.1}",
            t.cards,
            t.cards_with_ways,
            t.ways_ms,
            100.0 * (t.json_bytes as f64 / t.json_bytes_without.max(1) as f64 - 1.0)
        );
        for change in &t.changed {
            println!("  CHANGED {change}");
        }
        times.push(t.ways_ms);
        total.add(t);
    }
    times.sort_by(f64::total_cmp);
    let at = |q: f64| {
        times
            .get(((times.len() as f64 - 1.0) * q).round() as usize)
            .copied()
            .unwrap_or(0.0)
    };
    println!(
        "\n{planned} designs: {} cards, {} with a second way ({:.1}%)",
        total.cards,
        total.cards_with_ways,
        100.0 * total.cards_with_ways as f64 / total.cards.max(1) as f64
    );
    println!("ways per card: {:?}", total.by_count);
    println!(
        "time finding ways: p50 {:.1} ms, p90 {:.1} ms, max {:.1} ms",
        at(0.5),
        at(0.9),
        at(1.0)
    );
    println!(
        "json: {} -> {} bytes (+{:.1}%)",
        total.json_bytes_without,
        total.json_bytes,
        100.0 * (total.json_bytes as f64 / total.json_bytes_without.max(1) as f64 - 1.0)
    );
    println!("decided by: {:?}", total.decided_by);
    if verify {
        println!(
            "swapped in: {} ways, {} changed the plan",
            total.checked,
            total.changed.len()
        );
    }
    let mut offered: Vec<_> = total.offered.into_iter().collect();
    offered.sort_by_key(|entry| std::cmp::Reverse(entry.1));
    println!("most offered (pick -> way): ");
    for ((pick, way), n) in offered.into_iter().take(25) {
        println!("  {pick} -> {way}: {n}");
    }
}
