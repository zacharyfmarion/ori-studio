//! Measure the two closure orders against each other on a corpus.
//!
//! ```sh
//! cargo run --release -p oristudio-precrease --example measure_ends -- <dir-or-file>...
//! ```
//!
//! Per design and in total: steps, turn-overs, steps sighted from a mark that
//! is not on the paper, and crease ends with no landmark. Run twice — with the
//! endpoint preference on and off — and print both, because a reorder cannot be
//! simulated after the fact: changing what folds first changes what is
//! constructible next, so the two plans are different plans.

use std::path::{Path, PathBuf};

use oristudio_precrease::analyze;
use oristudio_precrease::fixture_io::load_path;
use oristudio_precrease::marks::{Creased, crease_runs, end_is_found};
use oristudio_precrease::pinch::Extent;
use oristudio_precrease::planner::{Planner, PlannerOptions};
use oristudio_precrease::sequence::{Sequence, StepKind};
use oristudio_precrease::sheet::Sheet;
use oristudio_precrease::state::State;

const ORIEDITA_PAPER: [f64; 4] = [-200.0, -200.0, 200.0, 200.0];

#[derive(Default, Clone, Copy, PartialEq, Debug)]
struct Tally {
    steps: usize,
    rounds: usize,
    turn_overs: usize,
    phantom: usize,
    ends: usize,
    lost_ends: usize,
    reversed: usize,
    /// Press steps: extra crease made so a later step can be sighted.
    presses: usize,
    /// Their total length, in sheet-sides.
    press_len: f64,
}

impl Tally {
    fn add(&mut self, o: Tally) {
        self.steps += o.steps;
        self.rounds += o.rounds;
        self.turn_overs += o.turn_overs;
        self.phantom += o.phantom;
        self.ends += o.ends;
        self.lost_ends += o.lost_ends;
        self.reversed += o.reversed;
        self.presses += o.presses;
        self.press_len += o.press_len;
    }
}

/// Replay a sequence onto a bare sheet, counting the ends the folder cannot
/// find at the moment the step is performed.
fn measure(seq: &Sequence, sheet: Sheet, point_cap: usize) -> Tally {
    let mut state = State::new(sheet, point_cap);
    let mut creased = Creased::new(&state);
    let mut t = Tally {
        steps: seq.steps.len(),
        turn_overs: usize::from(
            seq.steps
                .first()
                .is_some_and(|s| s.side == oristudio_precrease::direction::Side::Back),
        ) + seq
            .steps
            .windows(2)
            .filter(|w| w[0].side != w[1].side)
            .count(),
        phantom: seq.steps.iter().filter(|s| !s.marks_exist).count(),
        reversed: seq
            .steps
            .iter()
            .filter(|s| s.direction_share > 0.0 && s.direction_share < 0.5)
            .count(),
        ..Tally::default()
    };
    for step in &seq.steps {
        // A press is a pinch on a line already made: it goes on the paper, but
        // it is not a crease with ends a folder must find — it is pressed *at*
        // a mark. Its empty `cp_spans` must not read as "creased whole".
        if step.kind == StepKind::Press {
            let Extent::Pinches { spans } = &step.extent else {
                continue;
            };
            t.presses += 1;
            t.press_len += spans
                .iter()
                .map(|[a, b]| (a[0] - b[0]).hypot(a[1] - b[1]))
                .sum::<f64>();
            if let Ok(outcome) = state.add_line(step.line, step.tag) {
                creased.add_spans(&state, outcome.id, &step.line, spans);
            }
            continue;
        }
        let spans = &step.cp_spans;
        // Per end of a merged run, not per segment: a CP splits a line at every
        // change of assignment, and those joints are not ends.
        let ends: Vec<[f64; 2]> = crease_runs(&step.line, spans)
            .into_iter()
            .flat_map(|(a, b)| [a, b])
            .collect();
        t.ends += ends.len();
        t.lost_ends += ends
            .iter()
            .filter(|end| !end_is_found(&state, &creased, &step.line, **end))
            .count();
        let Ok(outcome) = state.add_line(step.line, step.tag) else {
            continue;
        };
        if spans.is_empty() {
            creased.add_whole(&state, outcome.id);
        } else {
            creased.add_spans(&state, outcome.id, &step.line, spans);
        }
    }
    t
}

fn plan_file(path: &Path, prefer: bool) -> Option<Tally> {
    let cp = load_path(path, None).ok()?;
    let analysis = analyze(&cp.segments, &cp.colors, Some(ORIEDITA_PAPER)).ok()?;
    let mut total = Tally::default();
    for component in &analysis.components {
        // The product's budgets, not unbounded ones: the stuck search now
        // runs on off-lattice components too, and unbounded it can search a
        // hand-drawn design for an hour. The browser gives it four seconds
        // an event and thirty in all, and a measurement at any other setting
        // is of a planner nobody ships. A real clock, therefore — a frozen
        // one never expires.
        let opts = PlannerOptions {
            prefer_findable_ends: prefer,
            ..PlannerOptions::default()
        };
        let point_cap = opts.point_cap;
        let mut planner = Planner::new(component, opts);
        if planner.plan_without_reference_finder().is_err() {
            return None;
        }
        let sheet = *planner.sheet()?;
        let mut t = measure(&planner.sequence(false), sheet, point_cap);
        t.rounds = planner
            .closure_ref()
            .map_or(0, |c| c.stats().rounds as usize);
        total.add(t);
    }
    (total.steps > 0).then_some(total)
}

/// Every crease pattern under the given paths, recursively. A corpus design is
/// a directory holding `truth.fold` beside its source image, so a bare
/// directory means "everything under here".
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
    let mut paths = Vec::new();
    for a in &args {
        collect(Path::new(a), &mut paths);
    }
    // One plan per design: the corpus keeps a detection and a topology beside
    // the truth, and they are the same pattern read three ways.
    paths.retain(|p| {
        !matches!(
            p.file_stem().and_then(|s| s.to_str()),
            Some("detected" | "topology")
        )
    });
    let mut on = Tally::default();
    let mut off = Tally::default();
    let mut planned = 0;
    // better / worse, per design, for each measure.
    let mut score = [[0usize; 2]; 3];
    // Say what these numbers are, in the output, every time. They are measured
    // through `plan_without_reference_finder`, which is not the driver Ori
    // Studio ships: the browser's loop asks ReferenceFinder when the stuck
    // search fails, and this cannot. So a plan here gives up one step earlier
    // than a real one, and every count below is a ceiling on defects rather
    // than a measurement of them. Quoting one as the product's behaviour has
    // already happened once.
    println!(
        "NOTE: measured WITHOUT the ReferenceFinder fallback \
         (`Planner::plan_without_reference_finder`), which the shipping driver \
         has and this does not. Defect counts below are CEILINGS."
    );
    println!("design\tsteps\tphantom on/off\tturns on/off\tlost ends on/off");
    for path in &paths {
        let (a, b) = (plan_file(path, true), plan_file(path, false));
        let (Some(a), Some(b)) = (a, b) else {
            println!("{}\tdid not plan", path.display());
            continue;
        };
        planned += 1;
        // A corpus design is a directory holding truth.fold, so the directory
        // is the design's name; a loose .cp or .fold is its own.
        let name = if path.file_stem().is_some_and(|s| s == "truth") {
            path.parent().and_then(|d| d.file_name())
        } else {
            path.file_name()
        }
        .unwrap_or_default()
        .to_string_lossy();
        println!(
            "{name}\t{}\t{}/{}\t{}/{}\t{}/{}",
            a.steps, a.phantom, b.phantom, a.turn_overs, b.turn_overs, a.lost_ends, b.lost_ends
        );
        for (k, (x, y)) in [
            (a.phantom, b.phantom),
            (a.turn_overs, b.turn_overs),
            (a.lost_ends, b.lost_ends),
        ]
        .into_iter()
        .enumerate()
        {
            if x < y {
                score[k][0] += 1;
            } else if x > y {
                score[k][1] += 1;
            }
        }
        on.add(a);
        off.add(b);
    }
    println!("\n{planned} designs planned of {}", paths.len());
    for (label, t) in [("preference on ", on), ("preference off", off)] {
        println!(
            "{label}  steps {:5}  rounds {:5}  phantom {:4}  presses {:4} ({:.1} sheet-sides)  turn-overs {:4}  lost ends {:5} / {:5} ({:.1}%)  reversed {:4}",
            t.steps,
            t.rounds,
            t.phantom,
            t.presses,
            t.press_len,
            t.turn_overs,
            t.lost_ends,
            t.ends,
            100.0 * t.lost_ends as f64 / t.ends.max(1) as f64,
            t.reversed
        );
    }
    for (label, [better, worse]) in ["phantom", "turn-overs", "lost ends"]
        .into_iter()
        .zip(score)
    {
        println!("{label}: better on {better} designs, worse on {worse}");
    }
}
