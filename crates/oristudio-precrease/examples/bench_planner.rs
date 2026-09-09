//! Measure the planner on a crease pattern: closure time, stuck-search time,
//! point counts, auxiliary folds, status — per component and in total.
//!
//! ```sh
//! cargo run --release -p oristudio-precrease --example bench_planner -- <file> \
//!     [--document N] [--component N] [--stuck-budget-ms N] [--total-budget-ms N] \
//!     [--no-stuck] [--max-depth N]
//! ```
//!
//! Numbers, not assertions: the plan's `|P|` cap and budgets are set from
//! what this prints (Phase 4 "measure before fixing budgets").

use std::path::PathBuf;
use std::time::Instant;

use oristudio_precrease::fixture_io::load_path;
use oristudio_precrease::planner::{Planner, PlannerOptions};
use oristudio_precrease::sequence::StepKind;
use oristudio_precrease::{ExactnessClass, analyze};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut file: Option<PathBuf> = None;
    let mut component: Option<u32> = None;
    let mut document: Option<usize> = None;
    let mut opts = PlannerOptions {
        stuck_budget_ms: 0.0,
        total_budget_ms: 0.0,
        ..PlannerOptions::default()
    };
    let mut run_stuck = true;
    let mut i = 0;
    while i < args.len() {
        let value = |k: usize| args.get(k).cloned().unwrap_or_default();
        match args[i].as_str() {
            "--component" => {
                component = value(i + 1).parse().ok();
                i += 1;
            }
            "--document" => {
                document = value(i + 1).parse().ok();
                i += 1;
            }
            "--stuck-budget-ms" => {
                opts.stuck_budget_ms = value(i + 1).parse().unwrap_or(0.0);
                i += 1;
            }
            "--total-budget-ms" => {
                opts.total_budget_ms = value(i + 1).parse().unwrap_or(0.0);
                i += 1;
            }
            "--max-depth" => {
                opts.stuck.max_depth = value(i + 1).parse().unwrap_or(2);
                i += 1;
            }
            "--child-candidates" => {
                opts.stuck.child_candidates = value(i + 1).parse().unwrap_or(60);
                i += 1;
            }
            "--max-candidates" => {
                opts.stuck.candidates.max_candidates = value(i + 1).parse().unwrap_or(400);
                i += 1;
            }
            "--depth3-threshold" => {
                opts.stuck.depth3_threshold = value(i + 1).parse().unwrap_or(60);
                i += 1;
            }
            "--no-stuck" => run_stuck = false,
            other => file = Some(PathBuf::from(other)),
        }
        i += 1;
    }
    let Some(file) = file else {
        eprintln!(
            "usage: bench_planner <file> [--document N] [--component N] [--stuck-budget-ms N] [--total-budget-ms N] [--no-stuck] [--max-depth N] [--child-candidates N] [--max-candidates N] [--depth3-threshold N]"
        );
        std::process::exit(2);
    };
    let t_load = Instant::now();
    let cp = match load_path(&file, document) {
        Ok(cp) => cp,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    let analysis = match analyze(
        &cp.segments,
        &cp.colors,
        Some([-200.0, -200.0, 200.0, 200.0]),
    ) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    println!(
        "{}: {} segments, {} components, load+analyze {:.0} ms",
        file.display(),
        analysis.segment_count,
        analysis.components.len(),
        t_load.elapsed().as_secs_f64() * 1000.0
    );
    println!(
        "{:>4} {:>6} {:>6} {:>5} {:>6} {:>4} {:>8} {:>6} {:>9} {:>5} {:>4} {:>4} {:>9} {:>9} status",
        "comp",
        "segs",
        "lines",
        "free",
        "clos0",
        "rnds",
        "|P|",
        "|L|",
        "close_ms",
        "stuck",
        "aux",
        "vis",
        "search_ms",
        "total_ms"
    );
    let mut total_ms = 0.0;
    let mut peak_points = 0usize;
    for c in &analysis.components {
        if component.is_some_and(|want| want != c.id) {
            continue;
        }
        let Some(exactness) = &c.exactness else {
            println!("{:>4} refused: {:?}", c.id, c.refused);
            continue;
        };
        let t0 = Instant::now();
        let mut planner = Planner::new(c, opts);
        let outcome = planner.close(0.0).expect("close");
        let close_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let closure0 = outcome.folded;
        let rounds0 = planner.closure_ref().map_or(0, |cl| cl.round());
        let t1 = Instant::now();
        if run_stuck {
            planner.plan_without_reference_finder().expect("plan");
        }
        let search_ms = t1.elapsed().as_secs_f64() * 1000.0;
        let seq = planner.sequence(false);
        let closure = planner.closure_ref().expect("closure");
        let points = closure.state().point_count();
        peak_points = peak_points.max(points);
        let elapsed = t0.elapsed().as_secs_f64() * 1000.0;
        total_ms += elapsed;
        let aux = seq.steps.iter().filter(|s| s.kind == StepKind::Aux).count();
        println!(
            "{:>4} {:>6} {:>6} {:>5} {:>6} {:>4} {:>8} {:>6} {:>9.1} {:>5} {:>4} {:>4} {:>9.1} {:>9.1} {:?}{}",
            c.id,
            c.segment_indices.len(),
            c.merged_lines.len(),
            closure.free_targets().len(),
            closure0,
            rounds0,
            points,
            closure.state().line_count(),
            close_ms,
            seq.diagnostics.stuck_events,
            aux,
            seq.totals.visible_aux,
            search_ms,
            elapsed,
            seq.status,
            if exactness.class != ExactnessClass::Exact {
                format!(" ({:?})", exactness.class)
            } else {
                String::new()
            }
        );
        if seq.diagnostics.stuck_events > 0 {
            for (k, e) in planner.stuck_events().iter().enumerate() {
                println!(
                    "       stuck {k}: depth {} exhausted {} root {} evaluated {} closures {} → {} aux ({} visible), unlocked {}",
                    e.depth_reached,
                    e.exhausted,
                    e.root_candidates,
                    e.candidates_evaluated,
                    e.closures_run,
                    e.aux_folds,
                    e.visible_aux,
                    e.unlocked
                );
            }
        }
    }
    println!("total {total_ms:.1} ms, peak |P| {peak_points}");
}
