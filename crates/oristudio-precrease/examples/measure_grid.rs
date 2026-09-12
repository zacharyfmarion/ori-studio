//! Measure the precrease grid made only where the pattern needs it against
//! the whole grid, on a corpus.
//!
//! ```sh
//! cargo run --release -p oristudio-precrease --example measure_grid -- <dir-or-file>...
//! ```
//!
//! Per gridded component, in both modes: grid lines made, of them lines the
//! pattern lacks, crease put on grid lines where the pattern has none (in
//! sheet-sides), grid steps, steps in all, turn-overs, presses (and on grid
//! lines), hard witnesses, and lines unsolved. The last block is the total.
//! `implementation-plans/precrease-grid-where-needed.md` sets the gates the
//! totals are read against; a design whose steps rise is listed at the end,
//! to be read by hand.

use std::path::{Path, PathBuf};

use oristudio_precrease::analyze;
use oristudio_precrease::fixture_io::load_path;
use oristudio_precrease::planner::{GridMode, Planner, PlannerOptions};
use oristudio_precrease::sequence::{Sequence, StepKind};

const ORIEDITA_PAPER: [f64; 4] = [-200.0, -200.0, 200.0, 200.0];

#[derive(Default, Clone, Copy, Debug)]
struct Tally {
    grid_lines: u32,
    grid_only: u32,
    unwanted_len: f64,
    grid_steps: u32,
    steps: usize,
    turn_overs: usize,
    presses: u32,
    grid_presses: usize,
    hard: usize,
    unsolved: u32,
}

impl Tally {
    fn add(&mut self, o: Tally) {
        self.grid_lines += o.grid_lines;
        self.grid_only += o.grid_only;
        self.unwanted_len += o.unwanted_len;
        self.grid_steps += o.grid_steps;
        self.steps += o.steps;
        self.turn_overs += o.turn_overs;
        self.presses += o.presses;
        self.grid_presses += o.grid_presses;
        self.hard += o.hard;
        self.unsolved += o.unsolved;
    }

    fn line(&self) -> String {
        format!(
            "lines {:>3} grid-only {:>3} unwanted {:>6.2} gsteps {:>2} steps {:>3} turns {:>2} presses {:>2} (grid {:>2}) hard {:>2} unsolved {:>2}",
            self.grid_lines,
            self.grid_only,
            self.unwanted_len,
            self.grid_steps,
            self.steps,
            self.turn_overs,
            self.presses,
            self.grid_presses,
            self.hard,
            self.unsolved
        )
    }
}

fn tally(seq: &Sequence) -> Tally {
    let grid_line_ids: Vec<usize> = seq
        .steps
        .iter()
        .filter_map(|s| s.grid.as_ref())
        .flat_map(|g| g.lines.iter().map(|l| l.line_id))
        .collect();
    Tally {
        grid_lines: seq.totals.grid_lines,
        grid_only: seq.totals.grid_lines - seq.totals.grid_cp_lines,
        unwanted_len: seq.totals.grid_unwanted_length,
        grid_steps: seq.grid.as_ref().map_or(0, |g| g.steps),
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
        presses: seq.totals.presses,
        grid_presses: seq
            .steps
            .iter()
            .filter(|s| s.kind == StepKind::Press && grid_line_ids.contains(&s.line_id))
            .count(),
        hard: seq.steps.iter().filter(|s| s.hard).count(),
        unsolved: seq.totals.unsolved,
    }
}

fn plan(path: &Path, component: usize, mode: GridMode) -> Option<Sequence> {
    let cp = load_path(path, None).ok()?;
    let analysis = analyze(&cp.segments, &cp.colors, Some(ORIEDITA_PAPER)).ok()?;
    let c = analysis.components.get(component)?;
    // The product's budgets, as `measure_ends` uses: a plan nobody ships
    // measures nothing.
    let opts = PlannerOptions {
        precrease_grid: mode,
        ..PlannerOptions::default()
    };
    let mut planner = Planner::new(c, opts);
    planner.plan_without_reference_finder().ok()?;
    Some(planner.sequence(false))
}

fn collect(path: &Path, out: &mut Vec<PathBuf>) {
    if path.is_dir() {
        let Ok(entries) = std::fs::read_dir(path) else {
            return;
        };
        let mut entries: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        entries.sort();
        for entry in entries {
            collect(&entry, out);
        }
    } else if path
        .extension()
        .is_some_and(|e| e == "fold" || e == "cp" || e == "osf")
    {
        out.push(path.to_path_buf());
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut files: Vec<PathBuf> = Vec::new();
    for a in &args {
        collect(Path::new(a), &mut files);
    }
    let mut whole_total = Tally::default();
    let mut needed_total = Tally::default();
    let mut rose: Vec<String> = Vec::new();
    for file in &files {
        let Ok(cp) = load_path(file, None) else {
            continue;
        };
        let Ok(analysis) = analyze(&cp.segments, &cp.colors, Some(ORIEDITA_PAPER)) else {
            continue;
        };
        let name = file.parent().and_then(|p| p.file_name()).map_or_else(
            || file.display().to_string(),
            |n| n.to_string_lossy().into_owned(),
        );
        let name = if name == "precrease" || name == "default-molecules" || name == "travis_nolan" {
            file.file_name()
                .map_or(name, |n| n.to_string_lossy().into_owned())
        } else {
            name
        };
        for ci in 0..analysis.components.len() {
            let Some(whole) = plan(file, ci, GridMode::Whole) else {
                continue;
            };
            if whole.grid.is_none() {
                continue;
            }
            let Some(needed) = plan(file, ci, GridMode::WhereNeeded) else {
                continue;
            };
            let (w, n) = (tally(&whole), tally(&needed));
            println!("{name} c{ci}");
            println!("  whole   {}", w.line());
            println!("  needed  {}", n.line());
            whole_total.add(w);
            needed_total.add(n);
            if n.steps > w.steps || n.unsolved > w.unsolved || n.hard > w.hard {
                rose.push(format!(
                    "{name} c{ci}: steps {} → {}, hard {} → {}, unsolved {} → {}",
                    w.steps, n.steps, w.hard, n.hard, w.unsolved, n.unsolved
                ));
            }
        }
    }
    println!("TOTAL");
    println!("  whole   {}", whole_total.line());
    println!("  needed  {}", needed_total.line());
    let saved = whole_total.grid_only as i64 - needed_total.grid_only as i64;
    let added = needed_total.steps as i64 - whole_total.steps as i64;
    println!(
        "  grid-only lines saved {saved}, steps added {added}, lines saved per step added {}",
        if added > 0 {
            format!("{:.1}", saved as f64 / added as f64)
        } else {
            "∞".to_string()
        }
    );
    if !rose.is_empty() {
        println!("READ BY HAND");
        for r in rose {
            println!("  {r}");
        }
    }
}
