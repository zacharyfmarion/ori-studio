//! Compare constructions on the SAME closure. Unneeded auxiliaries may vanish.
//! Every input must exist and load. JSONL output reports each component, runtime,
//! coverage and quality. No ReferenceFinder fallback; not a product success rate.
//! Usage: compare_constructions --product --budget-ms 10000 <file-or-directory>...
//! Offline controls: --trials N --budget-ms N --witnesses N --tradeoffs
//! --single-alignment --deep-trials N --rollout-trials N --grid off|whole|where_needed
//! Zero search budget means a fixed trial cap without a wall-clock cutoff.
//! A corpus directory containing truth.fold contributes that file only, never
//! its work.osf, detection, or topology copies.
use oristudio_precrease::{
    analyze,
    clock::{Deadline, default_clock},
    fixture_io::load_path,
    order,
    planner::{GridMode, Planner, PlannerOptions},
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
    let mut trials = 4000;
    let mut budget_ms: f64 = 60000.0;
    let mut paths = Vec::new();
    let mut tradeoffs = false;
    let mut single_alignment = false;
    let mut rollout_trials = 0;
    let mut witnesses_per_fold = 0;
    let mut grid_mode = GridMode::WhereNeeded;
    let mut deep_trials = 0;
    let mut product = false;
    while let Some(a) = args.next() {
        if a == "--product" {
            product = true;
        } else if a == "--grid" {
            grid_mode = match args.next().as_deref() {
                Some("off") => GridMode::Off,
                Some("whole") => GridMode::Whole,
                Some("where_needed") => GridMode::WhereNeeded,
                _ => return Err("grid must be off, whole, or where_needed".into()),
            };
        } else if a == "--deep-trials" {
            deep_trials = args.next().ok_or("missing deep trials")?.parse()?;
        } else if a == "--witnesses" {
            witnesses_per_fold = args.next().ok_or("missing witnesses")?.parse()?;
        } else if a == "--rollout-trials" {
            rollout_trials = args.next().ok_or("missing rollout trials")?.parse()?;
        } else if a == "--tradeoffs" {
            tradeoffs = true;
        } else if a == "--single-alignment" {
            single_alignment = true;
        } else if a == "--trials" {
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
    if product && (budget_ms <= 0.0 || rollout_trials > 0 || deep_trials > 0) {
        return Err(
            "product mode requires a positive shared budget and no offline rollouts/deep search"
                .into(),
        );
    }
    paths.sort();
    paths.dedup();
    if paths.is_empty() {
        return Err("no inputs".into());
    }
    eprintln!(
        "WITHOUT ReferenceFinder fallback; same closure for both policies; {} inputs; {} construction evaluations",
        paths.len(),
        if product {
            order::construction::Options::production().max_evaluations
        } else {
            trials
        }
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
                    precrease_grid: grid_mode,
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
            let product_deadline = Deadline::after(default_clock(), budget_ms);
            let baseline = order::improve(
                closure,
                false,
                true,
                baseline,
                64,
                &Deadline::after(
                    default_clock(),
                    if product {
                        budget_ms.min(1500.0)
                    } else {
                        1500.0
                    },
                ),
            );
            let baseline_refined = quality::evaluate(closure, &baseline);
            let refinement_ms = start.elapsed().as_secs_f64() * 1000.;
            let deep = if deep_trials > 0 {
                let start = Instant::now();
                let deep = order::improve(
                    closure,
                    false,
                    true,
                    baseline.clone(),
                    deep_trials,
                    &Deadline::after(default_clock(), budget_ms),
                );
                Some(
                    serde_json::json!({"quality":quality::evaluate(closure, &deep),
                    "ms":start.elapsed().as_secs_f64()*1000., "trials":deep_trials}),
                )
            } else {
                None
            };
            let start = Instant::now();
            let deadline = if product {
                product_deadline
            } else {
                Deadline::after(default_clock(), budget_ms)
            };
            let options = if product {
                order::construction::Options::production()
            } else {
                order::construction::Options {
                    max_evaluations: trials,
                    max_passes: 3,
                    tradeoffs,
                    single_alignment,
                    witnesses_per_fold,
                }
            };
            let result = order::construction::refine(closure, baseline, options, &deadline);
            let construction = quality::evaluate(closure, &result.placed);
            let rollouts = order::rollout::improve(
                closure,
                result.placed,
                order::rollout::Options {
                    trials: rollout_trials,
                    width: 3,
                    cleanup_evaluations: 1000,
                },
                &deadline,
            );
            let candidate = rollouts.placed;
            let search_ms = start.elapsed().as_secs_f64() * 1000.;
            let after = quality::evaluate(closure, &candidate);
            println!(
                "{}",
                serde_json::json!({"path":path,"component":component,"status":status,
                "plan_ms":plan_ms,"baseline_ms":baseline_ms,"refinement_ms":refinement_ms,"search_ms":search_ms,
                "max_trials":options.max_evaluations,"budget_ms":budget_ms,"witnesses_per_fold":options.witnesses_per_fold,"product":product,"remaining":closure.remaining().len(),
                "tradeoffs":options.tradeoffs,"single_alignment":options.single_alignment,"grid":format!("{grid_mode:?}"),"deep":deep,"unrefined":before,"before":baseline_refined,"cleanup":result.after_cleanup,"construction":construction,"after":after,"stats":result.stats,"rollouts":rollouts.stats})
            );
        }
    }
    Ok(())
}
