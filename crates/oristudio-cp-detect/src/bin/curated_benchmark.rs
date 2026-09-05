//! The curated benchmark: every case of a hand-curated corpus through the
//! product's own pipeline, natively, scored against what a person established
//! in the editor. See `implementation-plans/cp-detect-curated-ground-truth.md`.
//!
//! A case is a directory holding `source.<ext>` (the image the detect dialog
//! was given), optionally `detected.fold` (what the detector produced when the
//! case was curated), `topology.fold` (the repaired pattern before solving)
//! and `truth.fold` (the solved pattern). Nothing else: every fact about a
//! case is derived here. Cases sit either at the corpus root or one level
//! down in a group directory (`curated/`, `cpoogle/`): a directory with a
//! `source.<ext>` is a case, any other directory is a group, and a case is
//! keyed `group/slug` in every output. `--group` restricts a run to one group.
//!
//! Per case, three scores:
//!
//! - **decoder**: the pipeline's graph against `topology.fold`, the strict
//!   topology metric from `oristudio-cp-eval` at 4 px of 1024;
//! - **end to end**: the pipeline's solved answer against `truth.fold`, vertex
//!   to vertex by mutual nearest-neighbour correspondence;
//! - **gate**: `topology.fold` through the solver's two stages against
//!   `truth.fold`, the same way — the solver on correct topology, no model.
//!
//! Writes `per_case.jsonl`, `summary.json` (which is also the scorecard
//! `--compare` reads), `summary.md`, and under `answers/` the pipeline's and
//! the gate's solved patterns per case as FOLD files in the case's own frame,
//! to open beside `truth.fold` when a bucket needs explaining. Refuses to run
//! from a binary built at another commit unless `--allow-stale`.
//!
//!   cargo run --release -p oristudio-cp-detect --features native-inference \
//!     --bin curated_benchmark -- --cases <dir> --out <dir> \
//!     [--model <model.onnx>] [--compare <summary.json>] [--budget 25] \
//!     [--max-edges 1500] [--only slug,slug] [--group name] [--allow-stale]
//!     [--write-detected]
//!
//! `--write-detected` writes the pipeline's output as `detected.fold` into any
//! case that has none, which is how a generated group gets its curation-time
//! detection (`rendered_corpus` in `oristudio-cp` makes the cases, this fills
//! that file). A pattern over the edge cap is still scored on the decoder from
//! the recognise-only decode; its solve is skipped, in the pipeline and in the
//! gate alike.
use oristudio_cp_compiler::{
    Point2, exact_solve_input_from_fold, parse_exact_solve_request, solve_exact_with_exemptions,
};
use oristudio_cp_detect::native_inference::{self, NativeSession};
use oristudio_cp_eval::{EvalGraph, StrictTopologyOptions, strict_topology_metrics};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

const PX: f64 = 1024.0;
/// The editor's own flat-foldability bar, in degrees.
const EXACT_KAWASAKI_DEGREES: f64 = 1e-6;
/// Decoder vertices match a topology vertex within this, in pixels of 1024.
const DECODER_VERTEX_TOLERANCE_PX: f64 = 4.0;
/// How far apart two vertices may be and still be read as the same one when
/// an answer is compared with a truth: a tenth of the paper.
const CORRESPONDENCE_RADIUS: f64 = 0.1;

struct Args {
    cases: PathBuf,
    out: PathBuf,
    model: PathBuf,
    compare: Option<PathBuf>,
    budget: f64,
    max_edges: usize,
    only: Option<Vec<String>>,
    group: Option<String>,
    allow_stale: bool,
    write_detected: bool,
}

fn parse_args() -> Args {
    let mut args = Args {
        cases: std::env::var("CP_DETECT_CURATED_CORPUS_DIR")
            .map(PathBuf::from)
            .unwrap_or_default(),
        out: PathBuf::from("artifacts/cp-detect-curated/latest"),
        model: PathBuf::new(),
        compare: None,
        budget: 25.0,
        max_edges: 1500,
        only: None,
        group: None,
        allow_stale: false,
        write_detected: false,
    };
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--cases" => args.cases = it.next().expect("--cases <dir>").into(),
            "--out" => args.out = it.next().expect("--out <dir>").into(),
            "--model" => args.model = it.next().expect("--model <path>").into(),
            "--compare" => args.compare = Some(it.next().expect("--compare <summary.json>").into()),
            "--budget" => args.budget = it.next().expect("--budget <s>").parse().expect("budget"),
            "--max-edges" => {
                args.max_edges = it
                    .next()
                    .expect("--max-edges <n>")
                    .parse()
                    .expect("max-edges")
            }
            "--only" => {
                args.only = Some(
                    it.next()
                        .expect("--only <slug,slug>")
                        .split(',')
                        .map(str::to_owned)
                        .collect(),
                )
            }
            "--group" => args.group = Some(it.next().expect("--group <name>")),
            "--allow-stale" => args.allow_stale = true,
            "--write-detected" => args.write_detected = true,
            other => panic!("unknown argument {other}"),
        }
    }
    if args.model.as_os_str().is_empty() {
        args.model = model_from_pointer_file().expect(
            "--model <model.onnx>, or run from the repository root so scripts/cp-detect/current-model.json can name it",
        );
    }
    assert!(
        args.cases.is_dir(),
        "--cases must name the corpus directory (or set CP_DETECT_CURATED_CORPUS_DIR)"
    );
    assert!(
        args.model.is_file(),
        "model not found: {}",
        args.model.display()
    );
    args
}

/// The current product model, from the tracked pointer file, when run from
/// the repository root.
fn model_from_pointer_file() -> Option<PathBuf> {
    let pointer: Value = serde_json::from_str(
        &std::fs::read_to_string("scripts/cp-detect/current-model.json").ok()?,
    )
    .ok()?;
    let dir = pointer.get("versioned_model_asset_dir")?.as_str()?;
    let file = pointer.get("model_filename")?.as_str()?;
    Some(Path::new(dir).join(file))
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

/// The worktree/`target` footgun, as `compare_exact_solve_benchmark` guards it:
/// each worktree has its own `target/`, so a binary built in one worktree and
/// run from another silently reports another commit's numbers.
fn assert_fresh_binary(allow_stale: bool) -> String {
    let build_commit = option_env!("BUILD_GIT_COMMIT").unwrap_or("").to_owned();
    let dirty = option_env!("BUILD_GIT_DIRTY") == Some("true");
    let head = git_commit().unwrap_or_default();
    eprintln!(
        "[provenance] built from {}{} | cwd HEAD {}",
        if build_commit.is_empty() {
            "unknown"
        } else {
            &build_commit[..12.min(build_commit.len())]
        },
        if dirty { " (dirty)" } else { "" },
        if head.is_empty() {
            "unknown"
        } else {
            &head[..12.min(head.len())]
        }
    );
    if !build_commit.is_empty() && !head.is_empty() && build_commit != head && !allow_stale {
        panic!("this binary was built at another commit; rebuild, or pass --allow-stale");
    }
    if build_commit.is_empty() {
        head
    } else {
        build_commit
    }
}

// ---------------------------------------------------------------------------
// FOLD reading, frames and geometry
// ---------------------------------------------------------------------------

/// A FOLD's creases in a common frame: vertices scaled so the paper's
/// boundary spans `0..PX`, aux (`F`) edges dropped, plus the edges as
/// (vertices, assignment) for the checks that need them.
struct Pattern {
    /// The JSON with `vertices_coords` rescaled, for `EvalGraph`.
    value: Value,
    /// Vertices on the `0..PX` paper, by the boundary's bounding box.
    points: Vec<Point2>,
    /// Vertices as the file holds them, for a frame the solver defines.
    raw: Vec<Point2>,
    edges: Vec<([usize; 2], String)>,
}

fn read_pattern(path: &Path) -> Result<Pattern, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    pattern_from_value(value).map_err(|e| format!("{}: {e}", path.display()))
}

fn pattern_from_value(mut value: Value) -> Result<Pattern, String> {
    let coords: Vec<[f64; 2]> = value
        .get("vertices_coords")
        .and_then(Value::as_array)
        .ok_or("no vertices_coords")?
        .iter()
        .map(|v| {
            let a = v.as_array().ok_or("vertex is not an array")?;
            Ok([
                a.first().and_then(Value::as_f64).ok_or("vertex x")?,
                a.get(1).and_then(Value::as_f64).ok_or("vertex y")?,
            ])
        })
        .collect::<Result<_, &str>>()?;
    let edges: Vec<[usize; 2]> = value
        .get("edges_vertices")
        .and_then(Value::as_array)
        .ok_or("no edges_vertices")?
        .iter()
        .map(|e| {
            let a = e.as_array().ok_or("edge is not an array")?;
            Ok([
                a.first().and_then(Value::as_u64).ok_or("edge a")? as usize,
                a.get(1).and_then(Value::as_u64).ok_or("edge b")? as usize,
            ])
        })
        .collect::<Result<_, &str>>()?;
    let assignments: Vec<String> = value
        .get("edges_assignment")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(|x| x.as_str().unwrap_or("U").to_owned())
                .collect()
        })
        .unwrap_or_else(|| vec!["U".to_owned(); edges.len()]);
    // The paper: the bounding box of the boundary edges, or of everything
    // when a file carries no boundary.
    let mut on_boundary: Vec<[f64; 2]> = edges
        .iter()
        .zip(&assignments)
        .filter(|(_, a)| a.as_str() == "B")
        .flat_map(|(e, _)| [coords[e[0]], coords[e[1]]])
        .collect();
    if on_boundary.is_empty() {
        on_boundary = coords.clone();
    }
    let (min_x, max_x) = on_boundary
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
            (lo.min(p[0]), hi.max(p[0]))
        });
    let (min_y, max_y) = on_boundary
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
            (lo.min(p[1]), hi.max(p[1]))
        });
    let span_x = (max_x - min_x).max(1e-9);
    let span_y = (max_y - min_y).max(1e-9);
    let points: Vec<Point2> = coords
        .iter()
        .map(|p| Point2::new((p[0] - min_x) / span_x * PX, (p[1] - min_y) / span_y * PX))
        .collect();
    // Rewrite the JSON: rescaled vertices, aux edges dropped.
    let keep: Vec<usize> = (0..edges.len())
        .filter(|&i| assignments[i] != "F")
        .collect();
    value["vertices_coords"] = json!(points.iter().map(|p| [p.x, p.y]).collect::<Vec<_>>());
    value["edges_vertices"] = json!(keep.iter().map(|&i| edges[i]).collect::<Vec<_>>());
    value["edges_assignment"] = json!(
        keep.iter()
            .map(|&i| assignments[i].clone())
            .collect::<Vec<_>>()
    );
    if let Some(detector) = value.get_mut("cp_detector").and_then(Value::as_object_mut)
        && let Some(roles) = detector
            .get("edge_boundary_role")
            .and_then(Value::as_array)
            .cloned()
    {
        detector.insert(
            "edge_boundary_role".to_owned(),
            json!(
                keep.iter()
                    .filter_map(|&i| roles.get(i).cloned())
                    .collect::<Vec<_>>()
            ),
        );
    }
    for key in [
        "edges_foldAngle",
        "faces_vertices",
        "faces_edges",
        "oriedita:edges_colors",
    ] {
        if let Some(object) = value.as_object_mut() {
            object.remove(key);
        }
    }
    Ok(Pattern {
        value,
        points,
        raw: coords.iter().map(|p| Point2::new(p[0], p[1])).collect(),
        edges: keep
            .iter()
            .map(|&i| (edges[i], assignments[i].clone()))
            .collect(),
    })
}

/// Whether a pattern folds flat as the editor's check reads it: no interior
/// vertex of odd degree, and Kawasaki within the editor's bar at every even
/// one. Aux edges are already gone; boundary vertices are the `B` edges'.
fn exactness(pattern: &Pattern) -> (bool, f64, usize, usize) {
    let mut incident: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    let mut boundary = std::collections::BTreeSet::new();
    let mut creases = 0usize;
    for (edge, assignment) in &pattern.edges {
        match assignment.as_str() {
            "B" => {
                boundary.insert(edge[0]);
                boundary.insert(edge[1]);
            }
            "M" | "V" | "U" => {
                creases += 1;
                incident.entry(edge[0]).or_default().push(edge[1]);
                incident.entry(edge[1]).or_default().push(edge[0]);
            }
            _ => {}
        }
    }
    let mut worst = 0.0_f64;
    let mut odd = 0usize;
    for (&v, neighbours) in &incident {
        if boundary.contains(&v) {
            continue;
        }
        if neighbours.len() % 2 == 1 {
            odd += 1;
            continue;
        }
        let at = pattern.points[v];
        let mut angles: Vec<f64> = neighbours
            .iter()
            .map(|&n| (pattern.points[n].y - at.y).atan2(pattern.points[n].x - at.x))
            .collect();
        angles.sort_by(|a, b| a.total_cmp(b));
        let sectors: Vec<f64> = (0..angles.len())
            .map(|k| (angles[(k + 1) % angles.len()] - angles[k]).rem_euclid(std::f64::consts::TAU))
            .collect();
        let alternating: f64 = sectors
            .iter()
            .enumerate()
            .map(|(k, s)| if k % 2 == 0 { *s } else { -*s })
            .sum();
        worst = worst.max(alternating.abs().to_degrees());
    }
    (
        odd == 0 && worst <= EXACT_KAWASAKI_DEGREES,
        worst,
        odd,
        creases,
    )
}

/// How far `answer` sits from `truth`, vertex to vertex: each truth vertex is
/// paired with its mutual nearest answer vertex within a radius, unpaired
/// truth vertices (a hand-fixed truth's split points and aux endpoints have
/// no counterpart) are counted, not measured.
fn correspondence(answer: &[Point2], truth: &[Point2], truth_degree: &[usize]) -> Value {
    if answer.is_empty() || truth.is_empty() {
        return json!({ "paired": 0, "unpaired": truth.len() });
    }
    let nearest = |p: Point2, set: &[Point2]| {
        set.iter()
            .enumerate()
            .map(|(k, q)| (k, ((p.x - q.x).powi(2) + (p.y - q.y).powi(2)).sqrt()))
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .unwrap_or((0, f64::INFINITY))
    };
    let radius = CORRESPONDENCE_RADIUS * PX;
    let mut distances = Vec::new();
    let mut unpaired = 0usize;
    let mut unpaired_junctions = 0usize;
    for (j, t) in truth.iter().enumerate() {
        let (i, d) = nearest(*t, answer);
        let (back, _) = nearest(answer[i], truth);
        if back == j && d <= radius {
            distances.push(d);
        } else {
            unpaired += 1;
            if truth_degree.get(j).copied().unwrap_or(0) >= 3 {
                unpaired_junctions += 1;
            }
        }
    }
    distances.sort_by(|a, b| a.total_cmp(b));
    let n = distances.len();
    let at = |q: f64| {
        distances
            .get(((n as f64 - 1.0) * q).round() as usize)
            .copied()
            .unwrap_or(0.0)
    };
    json!({
        "paired": n,
        "unpaired": unpaired,
        "unpaired_junctions": unpaired_junctions,
        "max_px": round(distances.last().copied().unwrap_or(0.0)),
        "p90_px": round(at(0.9)),
        "median_px": round(at(0.5)),
        "over_1px": distances.iter().filter(|&&d| d > 1.0).count(),
        "over_2px": distances.iter().filter(|&&d| d > 2.0).count(),
    })
}

fn crease_degrees(pattern: &Pattern) -> Vec<usize> {
    let mut degree = vec![0usize; pattern.points.len()];
    for (edge, assignment) in &pattern.edges {
        if matches!(assignment.as_str(), "M" | "V" | "U") {
            degree[edge[0]] += 1;
            degree[edge[1]] += 1;
        }
    }
    degree
}

fn round(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

fn eval_graph(pattern: &Pattern) -> Result<EvalGraph, String> {
    EvalGraph::from_fold_value(&pattern.value).map_err(|e| e.to_string())
}

/// The strict topology metric as a JSON record, plus an edge F1.
fn strict_score(predicted: &EvalGraph, truth: &EvalGraph, tolerance_px: f64) -> Value {
    let m = strict_topology_metrics(
        predicted,
        truth,
        StrictTopologyOptions {
            vertex_tolerance: tolerance_px,
            split_merge_tolerance: tolerance_px,
            compare_assignments: true,
        },
    );
    let f1 = |p: f64, r: f64| {
        if p + r > 0.0 {
            2.0 * p * r / (p + r)
        } else {
            0.0
        }
    };
    json!({
        "exact_topology": m.exact_topology,
        "exact_topology_and_assignment": m.exact_topology_and_assignment,
        "vertex_precision": round(m.vertices.precision),
        "vertex_recall": round(m.vertices.recall),
        "vertex_mean_error_px": round(m.vertices.mean_error),
        "edge_precision": round(m.edges.precision),
        "edge_recall": round(m.edges.recall),
        "edge_f1": round(f1(m.edges.precision, m.edges.recall)),
        "gt_edges": m.edges.gt_edges,
        "predicted_edges": m.edges.predicted_edges,
        "missing_edges": m.edges.missing_edges,
        "extra_edges": m.edges.extra_edges,
        "split_edges": m.split_edges.len(),
        "merged_edges": m.merged_edges.len(),
        "assignment_accuracy": round(m.assignments.accuracy),
        "wrong_assignments": m.wrong_assignments.len(),
    })
}

// ---------------------------------------------------------------------------
// Per case
// ---------------------------------------------------------------------------

struct Case {
    /// The group directory's name, or empty for a case at the corpus root.
    group: String,
    slug: String,
    dir: PathBuf,
    source: PathBuf,
    detected: Option<PathBuf>,
    topology: Option<PathBuf>,
    truth: Option<PathBuf>,
}

impl Case {
    /// `group/slug`, or the bare slug for a case at the root: the name every
    /// record, table and scorecard uses.
    fn key(&self) -> String {
        if self.group.is_empty() {
            self.slug.clone()
        } else {
            format!("{}/{}", self.group, self.slug)
        }
    }
}

fn source_image(dir: &Path) -> Option<PathBuf> {
    ["png", "jpg", "jpeg", "webp"]
        .iter()
        .map(|ext| dir.join(format!("source.{ext}")))
        .find(|p| p.is_file())
}

fn sorted_dirs(path: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(path) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_dir()
                && !p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with('.'))
        })
        .collect();
    dirs.sort();
    dirs
}

/// Every case under the corpus: a directory with a `source.<ext>` is a case,
/// any other directory is a group of cases. `only` matches a key or a bare
/// slug; `group` keeps one group.
fn discover(cases: &Path, only: Option<&[String]>, group: Option<&str>) -> Vec<Case> {
    let mut out = Vec::new();
    let mut push = |group_name: &str, dir: PathBuf, source: PathBuf| {
        let slug = dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_owned();
        let file = |name: &str| Some(dir.join(name)).filter(|p| p.is_file());
        let case = Case {
            group: group_name.to_owned(),
            slug,
            detected: file("detected.fold"),
            topology: file("topology.fold"),
            truth: file("truth.fold"),
            source,
            dir,
        };
        let wanted =
            only.is_none_or(|list| list.iter().any(|s| s == &case.key() || s == &case.slug));
        if wanted {
            out.push(case);
        }
    };
    for dir in sorted_dirs(cases) {
        if let Some(source) = source_image(&dir) {
            if group.is_none_or(|g| g.is_empty()) {
                push("", dir, source);
            }
            continue;
        }
        let name = dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_owned();
        if group.is_some_and(|g| g != name) {
            continue;
        }
        for case_dir in sorted_dirs(&dir) {
            if let Some(source) = source_image(&case_dir) {
                push(&name, case_dir, source);
            }
        }
    }
    out
}

/// The solver's two stages on `topology.fold`, the product's option strings,
/// against the truth by correspondence. `dump` receives the answer as a FOLD
/// in the case's own frame.
fn solver_gate(
    topology: &Path,
    truth: Option<&Pattern>,
    budget: f64,
    max_edges: usize,
    dump: Option<&Path>,
) -> Value {
    let started = Instant::now();
    let fold: treemaker_fold::FoldDocument = match std::fs::read_to_string(topology)
        .map_err(|e| e.to_string())
        .and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string()))
    {
        Ok(fold) => fold,
        Err(error) => return json!({ "error": format!("read: {error}") }),
    };
    let (input, xform) = match exact_solve_input_from_fold(&fold) {
        Ok(v) => v,
        Err(error) => return json!({ "error": format!("rebuild: {error}") }),
    };
    // The solve's LM step is not preemptible, and on thousands of spans one
    // step outlasts the budget by minutes; the pipeline skips such a solve,
    // and so does the gate.
    if input.selected_spans.len() > max_edges {
        return json!({
            "status": "skipped_too_large",
            "spans": input.selected_spans.len(),
            "seconds": round(started.elapsed().as_secs_f64()),
        });
    }
    let input_json = match serde_json::to_string(&input) {
        Ok(v) => v,
        Err(error) => return json!({ "error": format!("json: {error}") }),
    };
    // Stage 2 alone: the refinement re-runs the geometry stage inside it, so
    // the product's separate stage-1 call is a preview the gate has no use
    // for, and running it doubled the gate's time.
    let options = json!({ "polish": true, "timeout_seconds": budget }).to_string();
    let Ok((parsed, options)) = parse_exact_solve_request(&input_json, &options) else {
        return json!({ "error": "request" });
    };
    let solved = solve_exact_with_exemptions(&parsed, &options);
    let mr = &solved.movement_report;
    let polish = &mr["polish"];
    let mut record = json!({
        "status": format!("{:?}", solved.status).to_lowercase(),
        "accepted": mr["accepted"],
        "rejection_reasons": mr["rejection_reasons"],
        "kawasaki_after_degrees": solved.theorem_residual_report["after"]["max_kawasaki_residual_degrees"],
        "angle_violations_after": solved.theorem_residual_report["after"]["camv_angle_violations"],
        "carrier_rounds_adopted": mr["carrier_join"]["adopted_rounds"],
        "pinned_family": polish["pinned_family"]["adopted"],
        "pinned_step_degrees": polish["pinned_family"]["step_degrees"],
        "pleats": polish["pleat_runs"]["adopted"],
        "merged_vertices": solved.merged_vertices.len(),
        "seconds": round(started.elapsed().as_secs_f64()),
    });
    if let Some(truth) = truth {
        // The truth and the topology share the case's document frame. The
        // solve worked in the frame the topology's boundary plan defined,
        // which is the unit paper up to a symmetry of the square: its first
        // corner at the origin, reflected when the loop ran the other way.
        // The paper's bounding box cannot tell one orientation from another,
        // so the truth goes through the same transform the topology did.
        let truth_points: Vec<Point2> = truth
            .raw
            .iter()
            .map(|p| {
                let q = xform.apply(*p);
                Point2::new(q.x * PX, q.y * PX)
            })
            .collect();
        let answer: Vec<Point2> = solved
            .vertices_exact
            .iter()
            .map(|p| Point2::new(p.x * PX, p.y * PX))
            .collect();
        record["vs_truth"] = correspondence(&answer, &truth_points, &crease_degrees(truth));
    }
    if let Some(path) = dump {
        // The stage-2 reports beside the answer, for a diff against another
        // build's when a bucket moves.
        let _ = std::fs::write(
            path.with_extension("report.json"),
            serde_json::to_string_pretty(&json!({
                "status": format!("{:?}", solved.status),
                "movement_report": solved.movement_report,
                "theorem_residual_report": solved.theorem_residual_report,
            }))
            .unwrap_or_default(),
        );
        let mut answer = fold.clone();
        for (coord, point) in answer
            .vertices_coords
            .iter_mut()
            .zip(&solved.vertices_exact)
        {
            let p = xform.invert(*point);
            coord[0] = p.x;
            coord[1] = p.y;
        }
        if let Ok(text) = serde_json::to_string(&answer) {
            let _ = std::fs::write(path, text);
        }
    }
    record
}

fn run_case(session: &mut NativeSession, case: &Case, args: &Args) -> Value {
    let started = Instant::now();
    let mut record = json!({ "slug": case.key(), "group": case.group });
    let answers = args.out.join("answers");
    let _ = std::fs::create_dir_all(&answers);
    let answer_name = case.key().replace('/', "__");
    let topology = case.topology.as_deref().map(read_pattern);
    let truth = case.truth.as_deref().map(read_pattern);
    let detected = case.detected.as_deref().map(read_pattern);
    let topology = match topology {
        Some(Ok(p)) => Some(p),
        Some(Err(error)) => {
            record["topology_error"] = json!(error);
            None
        }
        None => None,
    };
    let truth = match truth {
        Some(Ok(p)) => Some(p),
        Some(Err(error)) => {
            record["truth_error"] = json!(error);
            None
        }
        None => None,
    };
    let detected = match detected {
        Some(Ok(p)) => Some(p),
        _ => None,
    };
    let truth_exact = truth.as_ref().map(exactness);
    record["status"] = json!(match (&topology, truth_exact) {
        (None, _) => "skipped",
        (Some(_), Some((true, _, _, _))) => "solved",
        (Some(_), _) => "topology",
    });
    if let Some((exact, worst, odd, creases)) = truth_exact {
        record["truth"] = json!({
            "exact": exact,
            "kawasaki_degrees": worst,
            "odd_vertices": odd,
            "creases": creases,
        });
    }
    if let Some(topology) = &topology {
        record["topology"] =
            json!({ "creases": topology.edges.iter().filter(|(_, a)| a != "B").count() });
    }

    // The pipeline.
    let mut pipeline: Option<Pattern> = None;
    // The graph as recognised, before the compiler and the solve: the
    // decoder's own output. The solve merges detector-split junctions and
    // moves vertices, which scored as decoder error when the solved pattern
    // was compared with the topology; the carrier round made three exact
    // decodes read as near.
    let mut recognised: Option<Pattern> = None;
    let mut detection = json!({});
    match image::open(&case.source) {
        Err(error) => detection["error"] = json!(format!("load: {error}")),
        Ok(img) => {
            let rgba = img.to_rgba8();
            let (width, height) = rgba.dimensions();
            match native_inference::rectify(rgba.as_raw(), width, height) {
                Err(error) => detection["error"] = json!(error),
                Ok(rectified) => {
                    detection["rectification"] = rectified.report.clone();
                    match session.infer(&rectified.rgba) {
                        Err(error) => detection["error"] = json!(error),
                        Ok((heads, inference_ms)) => {
                            detection["inference_ms"] = json!(round(inference_ms));
                            detection["provider"] = json!(session.provider);
                            let decode_started = Instant::now();
                            // Recognise once: the graph before the compiler
                            // and the solve, which scores the decoder, sizes
                            // the pattern, and stands in for the solve over
                            // the edge cap. On a 6,000-crease pattern this
                            // stage alone takes two minutes, so it runs one
                            // time, not once per use.
                            let probe = native_inference::decode(
                                &rectified.rgba,
                                &heads,
                                args.budget,
                                true,
                            );
                            let recognised_edges = probe
                                .as_ref()
                                .ok()
                                .and_then(|p| serde_json::to_value(&p.report).ok())
                                .and_then(|r| r.get("edge_count").and_then(Value::as_u64))
                                .unwrap_or(0)
                                as usize;
                            if topology.is_some()
                                && let Ok(probe) = &probe
                            {
                                let _ = std::fs::write(
                                    answers.join(format!("{answer_name}.recognised.fold")),
                                    &probe.fold_json,
                                );
                                recognised = serde_json::from_str::<Value>(&probe.fold_json)
                                    .ok()
                                    .and_then(|v| pattern_from_value(v).ok());
                            }
                            // A case without a topology has no truth to score
                            // a solve against, and over the edge cap the solve
                            // is skipped, not the case: the recognised graph
                            // stands in, and the record says why there is no
                            // solve.
                            let mut too_large = None;
                            let decoded = if topology.is_none() {
                                probe
                            } else if recognised_edges > args.max_edges {
                                too_large = Some(format!(
                                    "too_large: {recognised_edges} edges recognized, over the {} edge cap; solve skipped",
                                    args.max_edges
                                ));
                                probe
                            } else {
                                native_inference::decode(
                                    &rectified.rgba,
                                    &heads,
                                    args.budget,
                                    false,
                                )
                            };
                            match decoded {
                                Err(error) => detection["error"] = json!(error),
                                Ok(decoded) => {
                                    detection["decode_solve_ms"] = json!(round(
                                        decode_started.elapsed().as_secs_f64() * 1000.0
                                    ));
                                    let report = serde_json::to_value(&decoded.report)
                                        .unwrap_or(Value::Null);
                                    let exact = report
                                        .pointer("/quality_report/compiler_report/exact_solve")
                                        .cloned()
                                        .unwrap_or(Value::Null);
                                    detection["vertex_count"] = report["vertex_count"].clone();
                                    detection["edge_count"] = report["edge_count"].clone();
                                    detection["solve_status"] = exact["status"].clone();
                                    if let Some(reason) = too_large {
                                        detection["solve_status"] = json!("skipped_too_large");
                                        detection["too_large"] = json!(reason);
                                    }
                                    detection["accepted"] =
                                        exact["movement_report"]["accepted"].clone();
                                    detection["rejection_reasons"] =
                                        exact["movement_report"]["rejection_reasons"].clone();
                                    detection["kawasaki_after_degrees"] = exact
                                        ["theorem_residual_report"]["after"]["max_kawasaki_residual_degrees"]
                                        .clone();
                                    detection["carrier_rounds_adopted"] = exact["movement_report"]
                                        ["carrier_join"]["adopted_rounds"]
                                        .clone();
                                    detection["pleats"] =
                                        exact["movement_report"]["polish"]["pleat_runs"]["adopted"]
                                            .clone();
                                    detection["pinned_step_degrees"] = exact["movement_report"]
                                        ["polish"]["pinned_family"]["step_degrees"]
                                        .clone();
                                    detection["compiler_seconds"] = report
                                        .pointer("/quality_report/compiler_report/timings/compiler_seconds")
                                        .cloned()
                                        .unwrap_or(Value::Null);
                                    detection["exact_solve_seconds"] = report
                                        .pointer("/quality_report/compiler_report/timings/exact_solve_seconds")
                                        .cloned()
                                        .unwrap_or(Value::Null);
                                    let _ = std::fs::write(
                                        answers.join(format!("{answer_name}.pipeline.fold")),
                                        &decoded.fold_json,
                                    );
                                    if args.write_detected && case.detected.is_none() {
                                        let _ = std::fs::write(
                                            case.dir.join("detected.fold"),
                                            &decoded.fold_json,
                                        );
                                    }
                                    match serde_json::from_str::<Value>(&decoded.fold_json)
                                        .map_err(|e| e.to_string())
                                        .and_then(pattern_from_value)
                                    {
                                        Ok(p) => pipeline = Some(p),
                                        Err(error) => {
                                            detection["error"] = json!(format!("fold: {error}"))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    record["detection"] = detection;

    // Decoder against the repaired topology, and drift against the detection
    // the case was curated from.
    let decoder_graph = recognised.as_ref().or(pipeline.as_ref());
    if let (Some(pipeline), Some(topology)) = (decoder_graph, &topology) {
        match (eval_graph(pipeline), eval_graph(topology)) {
            (Ok(predicted), Ok(gt)) => {
                record["decoder"] = strict_score(&predicted, &gt, DECODER_VERTEX_TOLERANCE_PX)
            }
            (Err(error), _) | (_, Err(error)) => record["decoder"] = json!({ "error": error }),
        }
    }
    if let (Some(pipeline), Some(detected)) = (decoder_graph, &detected)
        && let (Ok(predicted), Ok(then)) = (eval_graph(pipeline), eval_graph(detected))
    {
        let drift = strict_score(&predicted, &then, DECODER_VERTEX_TOLERANCE_PX);
        record["drift"] = json!({
            "edge_f1": drift["edge_f1"],
            "exact_topology": drift["exact_topology"],
        });
    }

    // End to end: the pipeline's solved answer against the truth.
    if let (Some(pipeline), Some(truth)) = (&pipeline, &truth) {
        let vs = correspondence(&pipeline.points, &truth.points, &crease_degrees(truth));
        let accepted = record["detection"]["accepted"] == Value::Bool(true);
        let recovered = accepted
            && vs["max_px"].as_f64().unwrap_or(f64::INFINITY) <= 2.0
            && vs["unpaired_junctions"].as_u64().unwrap_or(1) == 0;
        record["end_to_end"] = vs;
        record["end_to_end"]["recovered"] = json!(recovered);
    }

    // The solver on correct topology.
    if let Some(path) = &case.topology {
        record["gate"] = solver_gate(
            path,
            truth.as_ref(),
            args.budget,
            args.max_edges,
            Some(&answers.join(format!("{answer_name}.gate.fold"))),
        );
    }

    record["buckets"] = json!({
        "decoder": decoder_bucket(&record),
        "end_to_end": end_to_end_bucket(&record),
        "gate": gate_bucket(&record),
    });
    record["seconds"] = json!(round(started.elapsed().as_secs_f64()));
    record
}

fn decoder_bucket(record: &Value) -> &'static str {
    if record["status"] == json!("skipped") {
        return "n/a";
    }
    if record["detection"].get("error").is_some() || record["decoder"].is_null() {
        return "no_detection";
    }
    if record["decoder"]["exact_topology"] == Value::Bool(true) {
        return "exact";
    }
    if record["decoder"]["edge_f1"].as_f64().unwrap_or(0.0) >= 0.95 {
        return "near";
    }
    "off"
}

fn end_to_end_bucket(record: &Value) -> &'static str {
    if record["status"] != json!("solved") {
        return "n/a";
    }
    if record["end_to_end"].is_null() {
        return "no_detection";
    }
    if record["end_to_end"]["recovered"] == Value::Bool(true) {
        return "recovered";
    }
    if record["detection"]["accepted"] == Value::Bool(true) {
        return "accepted_wrong";
    }
    "not_accepted"
}

fn gate_bucket(record: &Value) -> &'static str {
    if record["status"] == json!("skipped") || record["gate"].is_null() {
        return "n/a";
    }
    if record["gate"].get("error").is_some() {
        return "error";
    }
    if record["gate"]["status"] == json!("skipped_too_large") {
        return "skipped";
    }
    if record["gate"]["status"] != json!("solved") {
        return "not_solved";
    }
    if record["status"] != json!("solved") {
        return "solved_no_truth";
    }
    let max = record["gate"]["vs_truth"]["max_px"]
        .as_f64()
        .unwrap_or(f64::INFINITY);
    let unpaired_junctions = record["gate"]["vs_truth"]["unpaired_junctions"]
        .as_u64()
        .unwrap_or(1);
    if max <= 1.0 && unpaired_junctions == 0 {
        "reproduced"
    } else if max <= 5.0 && unpaired_junctions == 0 {
        "close"
    } else {
        "off"
    }
}

// ---------------------------------------------------------------------------
// Summary, scorecard, comparison
// ---------------------------------------------------------------------------

fn summarize(records: &[Value], commit: &str, model: &Path) -> Value {
    let cases: BTreeMap<String, Value> = records
        .iter()
        .map(|r| {
            (
                r["slug"].as_str().unwrap_or("").to_owned(),
                json!({
                    "status": r["status"],
                    "decoder": r["buckets"]["decoder"],
                    "end_to_end": r["buckets"]["end_to_end"],
                    "gate": r["buckets"]["gate"],
                    "edge_f1": r["decoder"]["edge_f1"],
                    "gate_max_px": r["gate"]["vs_truth"]["max_px"],
                    "gate_unpaired_junctions": r["gate"]["vs_truth"]["unpaired_junctions"],
                }),
            )
        })
        .collect();
    let mut groups: BTreeMap<String, Vec<&Value>> = BTreeMap::new();
    for r in records {
        groups
            .entry(r["group"].as_str().unwrap_or("").to_owned())
            .or_default()
            .push(r);
    }
    let all: Vec<&Value> = records.iter().collect();
    let mut summary = aggregate(&all);
    summary["schema"] = json!("oristudio/cp-detect-curated-scorecard/v2");
    summary["commit"] = json!(commit);
    summary["model"] = json!(model.file_name().and_then(|n| n.to_str()).unwrap_or(""));
    summary["model_dir"] = json!(
        model
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("")
    );
    summary["groups"] = json!(
        groups
            .iter()
            .map(|(name, members)| (name.clone(), aggregate(members)))
            .collect::<BTreeMap<_, _>>()
    );
    summary["cases"] = json!(cases);
    summary
}

/// The counts and buckets over one set of records: the whole run, or one
/// group of it.
fn aggregate(records: &[&Value]) -> Value {
    let count = |key: &str, bucket: &str| {
        records
            .iter()
            .filter(|r| r["buckets"][key] == json!(bucket))
            .count()
    };
    let buckets = |key: &str| {
        let mut out = BTreeMap::new();
        for r in records {
            if let Some(b) = r["buckets"][key].as_str() {
                *out.entry(b.to_owned()).or_insert(0usize) += 1;
            }
        }
        out
    };
    let f1s: Vec<f64> = records
        .iter()
        .filter_map(|r| r["decoder"]["edge_f1"].as_f64())
        .collect();
    json!({
        "cases_total": records.len(),
        "status": {
            "solved": records.iter().filter(|r| r["status"] == json!("solved")).count(),
            "topology": records.iter().filter(|r| r["status"] == json!("topology")).count(),
            "skipped": records.iter().filter(|r| r["status"] == json!("skipped")).count(),
        },
        "decoder": {
            "buckets": buckets("decoder"),
            "exact_topology": count("decoder", "exact"),
            "mean_edge_f1": round(if f1s.is_empty() { 0.0 } else { f1s.iter().sum::<f64>() / f1s.len() as f64 }),
            "scored": f1s.len(),
        },
        "end_to_end": { "buckets": buckets("end_to_end"), "recovered": count("end_to_end", "recovered") },
        "gate": { "buckets": buckets("gate"), "reproduced": count("gate", "reproduced") },
    })
}

fn summary_markdown(summary: &Value, records: &[Value]) -> String {
    let mut out = String::new();
    out.push_str("# Curated benchmark\n\n");
    out.push_str(&format!(
        "Commit `{}`, model `{}`. {} cases: {} solved, {} topology-only, {} skipped.\n\n",
        summary["commit"]
            .as_str()
            .unwrap_or("?")
            .get(..12)
            .unwrap_or("?"),
        summary["model_dir"].as_str().unwrap_or("?"),
        summary["cases_total"],
        summary["status"]["solved"],
        summary["status"]["topology"],
        summary["status"]["skipped"]
    ));
    out.push_str(&format!(
        "- decoder: exact topology on {} of {} scored, mean edge F1 {}; buckets {}\n",
        summary["decoder"]["exact_topology"],
        summary["decoder"]["scored"],
        summary["decoder"]["mean_edge_f1"],
        summary["decoder"]["buckets"]
    ));
    out.push_str(&format!(
        "- end to end: recovered {} ; buckets {}\n",
        summary["end_to_end"]["recovered"], summary["end_to_end"]["buckets"]
    ));
    out.push_str(&format!(
        "- solver on correct topology: reproduced {} ; buckets {}\n\n",
        summary["gate"]["reproduced"], summary["gate"]["buckets"]
    ));
    if let Some(groups) = summary["groups"].as_object()
        && groups.len() > 1
    {
        for (name, g) in groups {
            out.push_str(&format!(
                "- `{}`: {} cases ({} solved, {} topology-only, {} skipped); decoder exact {} of {} (mean edge F1 {}); end to end recovered {}; gate reproduced {}\n",
                if name.is_empty() { "(root)" } else { name },
                g["cases_total"],
                g["status"]["solved"],
                g["status"]["topology"],
                g["status"]["skipped"],
                g["decoder"]["exact_topology"],
                g["decoder"]["scored"],
                g["decoder"]["mean_edge_f1"],
                g["end_to_end"]["recovered"],
                g["gate"]["reproduced"]
            ));
        }
        out.push('\n');
    }
    out.push_str("| case | status | decoder | edge F1 | missing / extra | end to end | e2e max px / unpaired junctions | gate | gate max px / unpaired junctions |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n");
    for r in records {
        out.push_str(&format!(
            "| `{}` | {} | {} | {} | {} / {} | {} | {} / {} | {} | {} / {} |\n",
            r["slug"].as_str().unwrap_or(""),
            r["status"].as_str().unwrap_or(""),
            r["buckets"]["decoder"].as_str().unwrap_or(""),
            r["decoder"]["edge_f1"],
            r["decoder"]["missing_edges"],
            r["decoder"]["extra_edges"],
            r["buckets"]["end_to_end"].as_str().unwrap_or(""),
            r["end_to_end"]["max_px"],
            r["end_to_end"]["unpaired_junctions"],
            r["buckets"]["gate"].as_str().unwrap_or(""),
            r["gate"]["vs_truth"]["max_px"],
            r["gate"]["vs_truth"]["unpaired_junctions"]
        ));
    }
    out
}

/// Every case whose bucket changed against a previous scorecard, both
/// directions, so a regression cannot hide inside a net gain.
fn compare(previous: &Value, current: &Value) {
    let (Some(before), Some(after)) = (previous["cases"].as_object(), current["cases"].as_object())
    else {
        eprintln!("[compare] the scorecard has no cases");
        return;
    };
    let mut changes = 0usize;
    for key in ["decoder", "end_to_end", "gate"] {
        for (slug, now) in after {
            let Some(was) = before.get(slug) else {
                continue;
            };
            if was[key] != now[key] {
                changes += 1;
                println!(
                    "[compare] {slug}: {key} {} -> {}",
                    was[key].as_str().unwrap_or("?"),
                    now[key].as_str().unwrap_or("?")
                );
            }
        }
    }
    for (slug, _) in after {
        if !before.contains_key(slug) {
            println!("[compare] {slug}: new case");
        }
    }
    for (slug, _) in before {
        if !after.contains_key(slug) {
            println!("[compare] {slug}: no longer present");
        }
    }
    let aggregates = [
        ("decoder exact topology", "/decoder/exact_topology"),
        ("decoder mean edge F1", "/decoder/mean_edge_f1"),
        ("end to end recovered", "/end_to_end/recovered"),
        ("gate reproduced", "/gate/reproduced"),
    ];
    for (label, path) in aggregates {
        println!(
            "[compare] {label}: {} -> {}",
            previous.pointer(path).cloned().unwrap_or(Value::Null),
            current.pointer(path).cloned().unwrap_or(Value::Null)
        );
    }
    if let (Some(before), Some(after)) = (
        previous["groups"].as_object(),
        current["groups"].as_object(),
    ) && after.len() > 1
    {
        for (name, now) in after {
            let Some(was) = before.get(name) else {
                println!("[compare] group {name}: new");
                continue;
            };
            for (label, path) in aggregates {
                let (a, b) = (
                    was.pointer(path).cloned().unwrap_or(Value::Null),
                    now.pointer(path).cloned().unwrap_or(Value::Null),
                );
                if a != b {
                    println!("[compare] group {name}: {label} {a} -> {b}");
                }
            }
        }
    }
    if changes == 0 {
        println!("[compare] no case changed bucket");
    }
}

fn main() {
    let args = parse_args();
    let commit = assert_fresh_binary(args.allow_stale);
    std::fs::create_dir_all(&args.out).expect("out dir");
    let cases = discover(&args.cases, args.only.as_deref(), args.group.as_deref());
    eprintln!(
        "[curated] {} cases under {}",
        cases.len(),
        args.cases.display()
    );
    let started = Instant::now();
    let mut session = NativeSession::open(&args.model, &args.out.join(".coreml-cache"))
        .unwrap_or_else(|e| panic!("session: {e}"));
    eprintln!(
        "[curated] session on {} in {:.1}s",
        session.provider,
        started.elapsed().as_secs_f64()
    );
    let mut records = Vec::new();
    let jsonl = args.out.join("per_case.jsonl");
    let _ = std::fs::remove_file(&jsonl);
    for (index, case) in cases.iter().enumerate() {
        let record = run_case(&mut session, case, &args);
        eprintln!(
            "[{}/{}] {:36} {:8} decoder {:12} e2e {:14} gate {:12} {:.1}s",
            index + 1,
            cases.len(),
            case.key(),
            record["status"].as_str().unwrap_or(""),
            record["buckets"]["decoder"].as_str().unwrap_or(""),
            record["buckets"]["end_to_end"].as_str().unwrap_or(""),
            record["buckets"]["gate"].as_str().unwrap_or(""),
            record["seconds"].as_f64().unwrap_or(0.0)
        );
        if let Ok(line) = serde_json::to_string(&record) {
            use std::io::Write;
            if let Ok(mut file) = std::fs::OpenOptions::new()
                .append(true)
                .create(true)
                .open(&jsonl)
            {
                let _ = writeln!(file, "{line}");
            }
        }
        records.push(record);
    }
    let summary = summarize(&records, &commit, &args.model);
    let _ = std::fs::write(
        args.out.join("summary.json"),
        serde_json::to_string_pretty(&summary).expect("summary"),
    );
    let _ = std::fs::write(
        args.out.join("summary.md"),
        summary_markdown(&summary, &records),
    );
    println!(
        "curated benchmark: {} cases | decoder exact {} of {} (mean edge F1 {}) | end to end recovered {} | gate reproduced {} | {:.0}s",
        records.len(),
        summary["decoder"]["exact_topology"],
        summary["decoder"]["scored"],
        summary["decoder"]["mean_edge_f1"],
        summary["end_to_end"]["recovered"],
        summary["gate"]["reproduced"],
        started.elapsed().as_secs_f64()
    );
    if let Some(path) = &args.compare {
        match std::fs::read_to_string(path)
            .map_err(|e| e.to_string())
            .and_then(|t| serde_json::from_str::<Value>(&t).map_err(|e| e.to_string()))
        {
            Ok(previous) => compare(&previous, &summary),
            Err(error) => eprintln!("[compare] could not read {}: {error}", path.display()),
        }
    }
}
