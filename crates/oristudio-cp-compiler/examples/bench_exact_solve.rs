//! Isolated exact-solve replay benchmark.
//!
//! Loads serialized `ExactSolveInput` fixtures (dumped from the detection
//! pipeline via `compare_exact_solve_benchmark --dump-exact-inputs`) and times
//! `solve_exact` on each in isolation, reporting the built-in solve counters and
//! writing a golden output (status + solved vertices) for later bit-identical
//! diffing of perf refactors.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-compiler --example bench_exact_solve -- \
//!       <fixtures_dir> [--golden <out_dir>] [--reps N]

use oristudio_cp_compiler::{ExactSolveInput, ExactSolveOptions, solve_exact};
use std::path::{Path, PathBuf};
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let dir = PathBuf::from(
        args.next()
            .expect("usage: bench_exact_solve <dir> [--golden DIR] [--reps N]"),
    );
    let mut golden: Option<PathBuf> = None;
    let mut min_reps = 5usize;
    let mut no_polish = false;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--golden" => golden = Some(PathBuf::from(args.next().expect("--golden needs a dir"))),
            "--reps" => min_reps = args.next().expect("--reps needs N").parse()?,
            "--no-polish" => no_polish = true,
            other => return Err(format!("unknown arg {other}").into()),
        }
    }
    if let Some(g) = &golden {
        std::fs::create_dir_all(g)?;
    }

    let mut paths: Vec<PathBuf> = std::fs::read_dir(&dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    paths.sort();

    println!(
        "{:<26} {:>6} {:>6} {:>7} {:>8} {:>9} {:>9} {:>10} {:>10} {:>12} {:>12}",
        "fixture",
        "verts",
        "spans",
        "params",
        "resid",
        "evals",
        "res_call",
        "jac_call",
        "status",
        "wall_ms",
        "us_per_eval",
    );

    for path in &paths {
        let name = short_name(path);
        let bytes = std::fs::read(path)?;
        let input: ExactSolveInput = serde_json::from_slice(&bytes)?;
        let options = ExactSolveOptions {
            polish: !no_polish,
            ..ExactSolveOptions::default()
        };

        // Warm run captures the golden output + trace metadata.
        let solved = solve_exact(&input, options);
        let trace = &solved.movement_report["trace"];
        let params = trace["parameter_count"].as_u64().unwrap_or(0);
        let resid = trace["residual_count"].as_u64().unwrap_or(0);
        let evals = solved.movement_report["evaluations"].as_u64().unwrap_or(0);
        let counters = &trace["counters"];
        let res_call = counters["residual_calls"].as_u64().unwrap_or(0);
        let jac_call = counters["jacobian_calls"].as_u64().unwrap_or(0);
        let status = format!("{:?}", solved.status);

        // Timed reps: exactly min_reps, but stop early once total exceeds ~3s so
        // slow (multi-second) fixtures don't dominate the run.
        let mut times = Vec::new();
        let bench_start = Instant::now();
        while times.len() < min_reps {
            let t = Instant::now();
            let s = solve_exact(&input, options);
            std::hint::black_box(&s);
            times.push(t.elapsed().as_secs_f64() * 1e3);
            if bench_start.elapsed().as_secs_f64() > 3.0 {
                break;
            }
        }
        times.sort_by(|a, b| a.total_cmp(b));
        let median_ms = times[times.len() / 2];
        let us_per_eval = if evals > 0 {
            median_ms * 1000.0 / evals as f64
        } else {
            0.0
        };

        println!(
            "{:<26} {:>6} {:>6} {:>7} {:>8} {:>9} {:>9} {:>10} {:>10} {:>12.2} {:>12.2}",
            truncate(&name, 26),
            input.vertices.len(),
            input.selected_spans.len(),
            params,
            resid,
            evals,
            res_call,
            jac_call,
            status,
            median_ms,
            us_per_eval,
        );

        if let Some(g) = &golden {
            let golden_value = serde_json::json!({
                "status": status,
                "vertices_exact": solved.vertices_exact,
            });
            std::fs::write(
                g.join(format!("{name}.golden.json")),
                serde_json::to_vec(&golden_value)?,
            )?;
        }
    }

    Ok(())
}

fn short_name(path: &Path) -> String {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("?");
    // Fixture ids embed a long hash + duplicated title; keep the human tail.
    stem.rsplit('-')
        .take(3)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("-")
}

fn truncate(s: &str, n: usize) -> String {
    if s.len() <= n {
        s.to_owned()
    } else {
        s.chars().take(n).collect()
    }
}
