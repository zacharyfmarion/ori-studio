//! Isolated exact-solve A/B replay with ground-truth scoring.
//!
//! The full `compare_exact_solve_benchmark` spends most of its wall-clock in
//! decode/selection/metrics; the exact solve itself is a small fraction. This
//! tool isolates solver iteration from that pipeline: capture the solver
//! inputs once, then score any `ExactSolveOptions` configuration against
//! ground truth in solve time only (~1-2 min per config on the native pack vs
//! ~20 min for the full benchmark).
//!
//! Workflow (see scripts/cp-detect/README.md "Isolated exact-solve iteration"):
//!
//! 1. Capture inputs (once per decode/selection change; no solves run):
//!    ```text
//!    cargo run --release -p oristudio-cp-detect --bin compare_exact_solve_benchmark -- \
//!        --dense-manifest <ABS>/dense-cache/<pack>/manifest.json \
//!        --candidate-source junction-first-v1 \
//!        --skip-exact-solve --dump-exact-inputs <dir> --out <scratch-report-dir>
//!    ```
//!    Gate-passing inputs land in `<dir>/right/`, gate-failing in `<dir>/wrong/`.
//!
//! 2. Replay a solver configuration against ground truth:
//!    ```text
//!    cargo run --release -p oristudio-cp-detect --bin replay_exact_solve_experiments -- \
//!        --inputs <dir>/right \
//!        --manifest <ABS>/dense-cache/<pack>/manifest.json \
//!        --out baseline.jsonl
//!    ```
//!
//! 3. Iterate with option overrides and diff per-sample flips vs the baseline:
//!    ```text
//!    ... --movement-sigma 0.003 --compare baseline.jsonl --out candidate.jsonl
//!    ```
//!
//! `recovered` here is the same honest metric as the benchmark's
//! `solve_recovered_original`: solve accepted AND the solved fold reproduces
//! GT topology+assignment at `--strict-px` (default 2px, the benchmark
//! default). Pass dense-cache manifests by ABSOLUTE path so worktrees resolve
//! the shared cache.
//!
//! Determinism: solves race the wall-clock timeout, so thread over-subscription
//! can flip borderline samples run-to-run. `--threads` defaults to 4, which
//! reproduced the sequential full-benchmark accept/timeout split exactly on
//! the native pack; `--threads 0` uses all cores (faster, noisier near the
//! timeout).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

use oristudio_cp_compiler::{
    AssignmentLabel, ExactSolveInput, ExactSolveOptions, Point2, solve_exact,
};
use oristudio_cp_eval::{
    EvalAssignment, EvalEdge, EvalGraph, EvalPoint, StrictTopologyOptions, strict_topology_metrics,
};
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, Deserialize)]
struct Manifest {
    #[serde(default)]
    pack: Option<String>,
    samples: Vec<ManifestSample>,
}

#[derive(Debug, Deserialize)]
struct ManifestSample {
    id: String,
    gt_graph: Option<String>,
    image_size: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct GroundTruthGraph {
    vertices_px: Vec<[f64; 2]>,
    edges_vertices: Vec<[usize; 2]>,
    #[serde(default)]
    edges_assignment_labels: Vec<Value>,
    #[serde(default)]
    edges_assignment: Vec<Value>,
}

fn parse_assignment(value: &str) -> AssignmentLabel {
    match value {
        "M" | "m" | "mountain" => AssignmentLabel::Mountain,
        "V" | "v" | "valley" => AssignmentLabel::Valley,
        "B" | "b" | "boundary" => AssignmentLabel::Boundary,
        "F" | "f" | "flat" => AssignmentLabel::Flat,
        _ => AssignmentLabel::Unknown,
    }
}

fn parse_assignment_value(value: &Value) -> AssignmentLabel {
    if let Some(label) = value.as_str() {
        return parse_assignment(label);
    }
    match value.as_i64() {
        Some(0) => AssignmentLabel::Mountain,
        Some(1) => AssignmentLabel::Valley,
        Some(2) => AssignmentLabel::Boundary,
        Some(3) => AssignmentLabel::Flat,
        _ => AssignmentLabel::Unknown,
    }
}

fn eval_assignment(label: AssignmentLabel) -> EvalAssignment {
    match label {
        AssignmentLabel::Mountain => EvalAssignment::Mountain,
        AssignmentLabel::Valley => EvalAssignment::Valley,
        AssignmentLabel::Boundary => EvalAssignment::Boundary,
        AssignmentLabel::Flat => EvalAssignment::Auxiliary,
        AssignmentLabel::Unknown => EvalAssignment::Unknown,
    }
}

fn normalized_to_px(point: Point2, image_size: u32) -> [f64; 2] {
    let inset = 32.0;
    let span = image_size as f64 - inset * 2.0;
    [inset + point.x * span, inset + point.y * span]
}

fn gt_eval_graph(gt: &GroundTruthGraph) -> EvalGraph {
    let labels = if gt.edges_assignment_labels.is_empty() {
        &gt.edges_assignment
    } else {
        &gt.edges_assignment_labels
    };
    let vertices = gt
        .vertices_px
        .iter()
        .copied()
        .map(EvalPoint::from)
        .collect::<Vec<_>>();
    let edges = gt
        .edges_vertices
        .iter()
        .enumerate()
        .map(|(index, vertices)| {
            EvalEdge::new(
                *vertices,
                labels
                    .get(index)
                    .map(parse_assignment_value)
                    .map(eval_assignment)
                    .unwrap_or(EvalAssignment::Unknown),
            )
        })
        .collect::<Vec<_>>();
    EvalGraph::new(vertices, edges)
}

fn solved_eval_graph(
    input: &ExactSolveInput,
    vertices: &[Point2],
    edges: &[[usize; 2]],
    image_size: u32,
) -> EvalGraph {
    let eval_vertices = vertices
        .iter()
        .copied()
        .map(|point| EvalPoint::from(normalized_to_px(point, image_size)))
        .collect::<Vec<_>>();
    let eval_edges = edges
        .iter()
        .enumerate()
        .filter_map(|(index, edge)| {
            if edge[0] >= vertices.len() || edge[1] >= vertices.len() {
                return None;
            }
            Some(EvalEdge::new(
                *edge,
                input
                    .selected_spans
                    .get(index)
                    .map(|span| eval_assignment(span.assignment_label()))
                    .unwrap_or(EvalAssignment::Unknown),
            ))
        })
        .collect::<Vec<_>>();
    EvalGraph::new(eval_vertices, eval_edges)
}

/// Outcome bucket for a sample; the unit both the summary line and the
/// `--compare` flip report work in.
fn outcome(row: &Value) -> &'static str {
    if row["recovered"].as_bool() == Some(true) {
        "recovered"
    } else if row["accepted"].as_bool() == Some(true) {
        "accepted_wrong"
    } else {
        "not_accepted"
    }
}

struct Args {
    inputs: PathBuf,
    manifest: PathBuf,
    strict_px: f64,
    out: Option<PathBuf>,
    compare: Option<PathBuf>,
    threads: usize,
    allow_stale: bool,
    options: ExactSolveOptions,
}

fn required_value(
    iter: &mut impl Iterator<Item = String>,
    flag: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    iter.next()
        .ok_or_else(|| format!("{flag} needs a value").into())
}

const USAGE: &str = "\
replay_exact_solve_experiments --inputs <dump>/right --manifest <pack manifest> [options]

Required:
  --inputs DIR                 ExactSolveInput fixtures (from compare_exact_solve_benchmark
                               --dump-exact-inputs; use the right/ bucket)
  --manifest PATH              dense-cache manifest of the SAME pack the inputs were dumped
                               from (absolute path; supplies ground-truth graph paths)

Scoring / output:
  --strict-px F                strict vertex tolerance in px (default 2.0)
  --out PATH                   write per-sample results jsonl
  --compare PATH               previous --out jsonl; print per-sample outcome flips
  --threads N                  solver parallelism (default 4 = timeout-parity with the
                               sequential benchmark; 0 = all cores)
  --allow-stale                run even if the binary was built from another commit

ExactSolveOptions overrides (defaults = production ExactSolveOptions::default()):
  --movement-sigma F           interior position-prior sigma (normalized units)
  --boundary-movement-sigma F  boundary position-prior sigma
  --max-vertex-movement F      acceptance movement budget
  --kawasaki-sigma-degrees F   Kawasaki residual sigma
  --carrier-incidence-sigma F  carrier incidence sigma
  --patience N                 LM patience
  --timeout-seconds F          per-solve wall-clock budget
  --no-polish                  disable the polish stage
  --polish-rounds N            polish round cap";

fn parse_args() -> Result<Args, Box<dyn std::error::Error>> {
    let mut inputs = None;
    let mut manifest = None;
    let mut strict_px = 2.0;
    let mut out = None;
    let mut compare = None;
    let mut threads = 4usize;
    let mut allow_stale = false;
    let mut options = ExactSolveOptions::default();
    let mut iter = std::env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--inputs" => inputs = Some(PathBuf::from(required_value(&mut iter, &arg)?)),
            "--manifest" => manifest = Some(PathBuf::from(required_value(&mut iter, &arg)?)),
            "--strict-px" => strict_px = required_value(&mut iter, &arg)?.parse()?,
            "--out" => out = Some(PathBuf::from(required_value(&mut iter, &arg)?)),
            "--compare" => compare = Some(PathBuf::from(required_value(&mut iter, &arg)?)),
            "--threads" => threads = required_value(&mut iter, &arg)?.parse()?,
            "--allow-stale" => allow_stale = true,
            "--movement-sigma" => {
                options.movement_sigma = required_value(&mut iter, &arg)?.parse()?;
            }
            "--boundary-movement-sigma" => {
                options.boundary_movement_sigma = required_value(&mut iter, &arg)?.parse()?;
            }
            "--max-vertex-movement" => {
                options.max_vertex_movement = required_value(&mut iter, &arg)?.parse()?;
            }
            "--kawasaki-sigma-degrees" => {
                options.kawasaki_sigma_radians = required_value(&mut iter, &arg)?
                    .parse::<f64>()?
                    .to_radians();
            }
            "--carrier-incidence-sigma" => {
                options.carrier_incidence_sigma = required_value(&mut iter, &arg)?.parse()?;
            }
            "--patience" => options.patience = required_value(&mut iter, &arg)?.parse()?,
            "--timeout-seconds" => {
                options.timeout_seconds = required_value(&mut iter, &arg)?.parse()?;
            }
            "--no-polish" => options.polish = false,
            "--polish-rounds" => {
                options.polish_rounds = required_value(&mut iter, &arg)?.parse()?;
            }
            "--help" | "-h" => {
                println!("{USAGE}");
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument: {other}\n\n{USAGE}").into()),
        }
    }
    Ok(Args {
        inputs: inputs.ok_or("--inputs is required")?,
        manifest: manifest.ok_or("--manifest is required")?,
        strict_px,
        out,
        compare,
        threads,
        allow_stale,
        options,
    })
}

fn git_commit() -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn short_commit(commit: &str) -> &str {
    commit.get(..12).unwrap_or(commit)
}

/// Same worktree/`target` footgun guard as `compare_exact_solve_benchmark`: a
/// binary built in another worktree silently scores different solver code.
fn assert_fresh_binary(allow_stale: bool) {
    let build_commit = option_env!("BUILD_GIT_COMMIT").unwrap_or("");
    let build_dirty = option_env!("BUILD_GIT_DIRTY") == Some("true");
    let runtime_head = git_commit().unwrap_or_default();
    eprintln!(
        "[provenance] replay_exact_solve_experiments built from {}{} | cwd HEAD {}",
        if build_commit.is_empty() {
            "unknown"
        } else {
            short_commit(build_commit)
        },
        if build_dirty { " (dirty)" } else { "" },
        if runtime_head.is_empty() {
            "unknown".to_owned()
        } else {
            short_commit(&runtime_head).to_owned()
        },
    );
    if build_commit.is_empty() || runtime_head.is_empty() || build_commit == runtime_head {
        return;
    }
    let message = format!(
        "STALE BINARY: built from {} but the working tree at this path is on {}.\n\
         Rebuild from THIS worktree (cargo run -p oristudio-cp-detect \
         --bin replay_exact_solve_experiments) or pass --allow-stale.",
        short_commit(build_commit),
        short_commit(&runtime_head),
    );
    if allow_stale {
        eprintln!("[provenance] WARNING: {message}");
    } else {
        eprintln!("[provenance] ERROR: {message}");
        std::process::exit(2);
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = parse_args()?;
    assert_fresh_binary(args.allow_stale);
    if args.threads > 0 {
        rayon::ThreadPoolBuilder::new()
            .num_threads(args.threads)
            .build_global()?;
    }
    let manifest_text = fs::read_to_string(&args.manifest)?;
    let manifest: Manifest = serde_json::from_str(&manifest_text)?;
    // gt_graph paths resolve against the pack manifest's directory when the
    // dense-cache manifest names one (same rule as compare_exact_solve_benchmark).
    let manifest_root = manifest
        .pack
        .as_deref()
        .map(|pack| {
            Path::new(pack)
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .to_path_buf()
        })
        .unwrap_or_else(|| {
            args.manifest
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .to_path_buf()
        });
    let by_id: BTreeMap<&str, &ManifestSample> = manifest
        .samples
        .iter()
        .map(|sample| (sample.id.as_str(), sample))
        .collect();

    let mut paths: Vec<PathBuf> = fs::read_dir(&args.inputs)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    paths.sort();

    let started = Instant::now();
    let mut results: Vec<Value> = paths
        .par_iter()
        .map(|path| -> Result<Value, String> {
            let id = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or_default()
                .to_owned();
            let sample = by_id
                .get(id.as_str())
                .ok_or_else(|| format!("{id}: not in manifest"))?;
            let gt_path = sample
                .gt_graph
                .as_deref()
                .ok_or_else(|| format!("{id}: no gt_graph"))?;
            let gt_text = fs::read_to_string(manifest_root.join(gt_path))
                .map_err(|err| format!("{id}: read gt: {err}"))?;
            let gt: GroundTruthGraph =
                serde_json::from_str(&gt_text).map_err(|err| format!("{id}: parse gt: {err}"))?;
            let input_text =
                fs::read_to_string(path).map_err(|err| format!("{id}: read input: {err}"))?;
            let input: ExactSolveInput = serde_json::from_str(&input_text)
                .map_err(|err| format!("{id}: parse input: {err}"))?;
            let image_size = input.image_size.or(sample.image_size).unwrap_or(1024);

            let solve_started = Instant::now();
            let solved = solve_exact(&input, args.options);
            let seconds = solve_started.elapsed().as_secs_f64();

            let accepted = solved.movement_report["accepted"]
                .as_bool()
                .unwrap_or(false);
            let predicted = solved_eval_graph(
                &input,
                &solved.vertices_exact,
                &solved.edges_exact,
                image_size,
            );
            let metrics = strict_topology_metrics(
                &predicted,
                &gt_eval_graph(&gt),
                StrictTopologyOptions {
                    vertex_tolerance: args.strict_px,
                    split_merge_tolerance: args.strict_px,
                    compare_assignments: true,
                },
            );
            let recovered = accepted && metrics.exact_topology_and_assignment;
            Ok(json!({
                "id": id,
                "accepted": accepted,
                "recovered": recovered,
                "status": format!("{:?}", solved.status),
                "seconds": seconds,
                "rejection_reasons": solved.movement_report["rejection_reasons"].clone(),
                "timed_out": solved.movement_report["timed_out"].clone(),
                "max_vertex_movement": solved.movement_report["max_vertex_movement"].clone(),
                "unmatched_gt_vertices": metrics.vertices.unmatched_gt_vertices,
                "missing_edges": metrics.edges.missing_edges,
                "extra_edges": metrics.edges.extra_edges,
                "wrong_assignments": metrics.assignments.wrong_edges,
                "max_vertex_error_px": metrics.vertices.max_error,
            }))
        })
        .map(|result| result.unwrap_or_else(|err| json!({ "error": err })))
        .collect();
    results.sort_by(|a, b| {
        a["id"]
            .as_str()
            .unwrap_or_default()
            .cmp(b["id"].as_str().unwrap_or_default())
    });

    let total = results.len();
    let errors = results.iter().filter(|r| r.get("error").is_some()).count();
    let accepted = results
        .iter()
        .filter(|r| r["accepted"].as_bool() == Some(true))
        .count();
    let recovered = results
        .iter()
        .filter(|r| r["recovered"].as_bool() == Some(true))
        .count();
    let timed_out = results
        .iter()
        .filter(|r| r["timed_out"].as_bool() == Some(true))
        .count();
    println!(
        "inputs={total} errors={errors} accepted={accepted} recovered={recovered} \
         accepted_wrong={} not_accepted={} timed_out={timed_out} wall_seconds={:.1}",
        accepted - recovered,
        total - errors - accepted,
        started.elapsed().as_secs_f64(),
    );

    if let Some(compare) = &args.compare {
        let baseline: BTreeMap<String, Value> = fs::read_to_string(compare)?
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter_map(|row| row["id"].as_str().map(|id| (id.to_owned(), row.clone())))
            .collect();
        let mut flips: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
        for row in &results {
            let Some(id) = row["id"].as_str() else {
                continue;
            };
            let Some(before) = baseline.get(id) else {
                continue;
            };
            let (from, to) = (outcome(before), outcome(row));
            if from != to {
                flips
                    .entry((from.to_owned(), to.to_owned()))
                    .or_default()
                    .push(id.to_owned());
            }
        }
        if flips.is_empty() {
            println!("compare: no outcome flips vs {}", compare.display());
        } else {
            for ((from, to), ids) in &flips {
                println!("compare: {from} -> {to}: {}", ids.len());
                for id in ids {
                    println!("    {id}");
                }
            }
        }
    }

    if let Some(out) = &args.out {
        let mut text = String::new();
        for row in &results {
            text.push_str(&serde_json::to_string(row).map_err(|err| err.to_string())?);
            text.push('\n');
        }
        fs::write(out, text)?;
    }
    Ok(())
}
