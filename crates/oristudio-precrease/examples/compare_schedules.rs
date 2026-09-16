//! Compare scheduling on the SAME closure (including its auxiliary decisions).
//! Every input must exist and load. JSONL output reports each component, runtime,
//! coverage and quality. No ReferenceFinder fallback; not a product success rate.
//! Usage: compare_schedules [--trials N] [--budget-ms N] <file-or-directory>...
//! Zero search budget means a fixed trial cap without a wall-clock cutoff.
//! A corpus directory containing truth.fold contributes that file only, never
//! its work.osf, detection, or topology copies.
use oristudio_precrease::{
    analyze,
    clock::{Deadline, default_clock},
    fixture_io::load_path,
    order,
    planner::{Planner, PlannerOptions},
    quality,
};
use std::{
    path::{Path, PathBuf},
    time::Instant,
};

fn collect(path: &Path, out: &mut Vec<PathBuf>) -> Result<(), Box<dyn std::error::Error>> {
    if path.is_dir() {
        if path.join("truth.fold").is_file() {
            out.push(path.join("truth.fold"));
            return Ok(());
        }
        let mut kids: Vec<_> = std::fs::read_dir(path)?
            .map(|e| e.map(|e| e.path()))
            .collect::<Result<_, _>>()?;
        kids.sort();
        for p in kids {
            collect(&p, out)?;
        }
    } else if matches!(
        path.extension().and_then(|s| s.to_str()),
        Some("fold" | "cp" | "opx" | "osf")
    ) {
        if !matches!(
            path.file_stem().and_then(|s| s.to_str()),
            Some("detected" | "topology")
        ) {
            out.push(path.to_owned());
        }
    } else if !path.exists() {
        return Err(format!("missing input: {}", path.display()).into());
    }
    Ok(())
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let mut trials = 64;
    let mut budget_ms: f64 = 0.0;
    let mut paths = Vec::new();
    while let Some(a) = args.next() {
        if a == "--trials" {
            trials = args.next().ok_or("missing trials")?.parse()?;
        } else if a == "--budget-ms" {
            budget_ms = args.next().ok_or("missing budget")?.parse()?;
        } else {
            collect(Path::new(&a), &mut paths)?;
        }
    }
    if !budget_ms.is_finite() || budget_ms < 0.0 {
        return Err("budget must be finite and non-negative".into());
    }
    paths.sort();
    paths.dedup();
    if paths.is_empty() {
        return Err("no inputs".into());
    }
    eprintln!(
        "WITHOUT ReferenceFinder fallback; same closure for both policies; {} inputs; {trials} trials",
        paths.len()
    );
    for path in paths {
        let cp = load_path(&path, None)?;
        let analysis = analyze(&cp.segments, &cp.colors, Some([-200., -200., 200., 200.]))?;
        if analysis.components.is_empty() {
            println!(
                "{}",
                serde_json::json!({"path":path,"status":"no_components"})
            );
        }
        for (component, c) in analysis.components.iter().enumerate() {
            let mut planner = Planner::new(
                c,
                PlannerOptions {
                    sequence_budget_ms: 0.0,
                    ..PlannerOptions::default()
                },
            );
            let start = Instant::now();
            let status = planner.plan_without_reference_finder()?;
            // Settle the grid exactly as final sequence emission does.
            let _ = planner.sequence(false);
            let plan_ms = start.elapsed().as_secs_f64() * 1000.;
            let Some(closure) = planner.closure_ref() else {
                println!(
                    "{}",
                    serde_json::json!({"path":path,"component":component,"status":status,"plan_ms":plan_ms})
                );
                continue;
            };
            let start = Instant::now();
            let baseline = order::order_with(closure, false, true);
            let baseline_ms = start.elapsed().as_secs_f64() * 1000.;
            let before = quality::evaluate(closure, &baseline);
            let start = Instant::now();
            let candidate = order::improve(
                closure,
                false,
                true,
                baseline,
                trials,
                &Deadline::after(default_clock(), budget_ms),
            );
            let search_ms = start.elapsed().as_secs_f64() * 1000.;
            let after = quality::evaluate(closure, &candidate);
            println!(
                "{}",
                serde_json::json!({"path":path,"component":component,"status":status,
                "plan_ms":plan_ms,"baseline_ms":baseline_ms,"search_ms":search_ms,
                "max_trials":trials,"budget_ms":budget_ms,"remaining":closure.remaining().len(),
                "before":before,"after":after})
            );
        }
    }
    Ok(())
}
