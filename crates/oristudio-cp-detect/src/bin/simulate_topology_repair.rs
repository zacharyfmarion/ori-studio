//! Repair-simulation harness: how far would hand repair of the detected
//! topology actually get?
//!
//! `implementation-plans/crease-topology-repair.md` projects that hand repair
//! takes exact topology from 307/563 to roughly 480/563 on the V5 production
//! run. That projection is an inference from defect counts, not a measurement.
//! This tool turns it into a number with no human in the loop:
//!
//! 1. read the candidate `ExactSolveInput` and the ground-truth graph,
//! 2. derive the minimal edit set that fixes the topology — the same verbs the
//!    UI plans to offer (insert vertex on edge / split, add edge, add vertex,
//!    delete edge, delete vertex, relabel),
//! 3. apply those edits to the candidate graph, keeping every *detected*
//!    coordinate,
//! 4. re-solve with `solve_exact_with_exemptions`,
//! 5. report how many samples recover the original crease pattern, bucketed
//!    easy/medium/hard, beside the unrepaired baseline solved by the same code.
//!
//! What it measures is the **ceiling** of hand repair: the edit set is derived
//! from ground truth, so it is the repair a user would make if they never made
//! a mistake and never missed a defect. It deliberately does *not* borrow GT
//! geometry beyond that — matched vertices keep their detected positions, and
//! an inserted vertex is projected onto the candidate spans it lands on (or
//! onto their intersection), which is what a click that snaps to the drawing
//! would produce. `--click-jitter-px` perturbs those clicks to check the result
//! does not depend on pixel-perfect aim.
//!
//! Workflow (paths ABSOLUTE — the shared pack/cache is not in a worktree):
//!
//! ```text
//! # 1. Capture the candidate ExactSolveInputs (no solves; ~5 min).
//! cargo run --release -p oristudio-cp-detect --bin compare_exact_solve_benchmark -- \
//!     --dense-manifest "$ABS/dense-cache/<pack>/manifest.json" \
//!     --candidate-source junction-first-v1 --line-evidence-source source-image \
//!     --skip-flat-folder --skip-exact-solve \
//!     --dump-exact-inputs "$ABS/exact-inputs/<run>" --out /tmp/capture-report
//!
//! # 2. Simulate repair over those inputs and re-solve.
//! cargo run --release -p oristudio-cp-detect --bin simulate_topology_repair -- \
//!     --inputs "$ABS/exact-inputs/<run>" \
//!     --manifest "$ABS/dense-cache/<pack>/manifest.json" \
//!     --out "$ABS/reports/<run>-repair-simulation"
//! ```
//!
//! `--threads` defaults to 4 for the same reason as
//! `replay_exact_solve_experiments`: solves race a wall-clock timeout, so
//! over-subscription flips borderline samples run-to-run.
//!
//! ## What it measured, first run (V5 production candidates, 563 samples)
//!
//! | | exact topology | recovered end to end |
//! | --- | --- | --- |
//! | baseline (same candidates, solved here without the benchmark's topology gate) | 307 | 236 |
//! | after the derived repair | **446** | **347** |
//!
//! Against the plan's projection of ~480 exact topology. The shortfall is the
//! *metric*, not the repair: judged as a graph rather than through the strict
//! 2px vertex matching, the derived repair is ground truth on **541 / 563**
//! (541 of the 542 square-paper samples; the other 21 are non-square paper the
//! square-only pipeline cannot represent at all).
//!
//! The hard bucket barely moves (5 → 9) for a reason repair cannot fix: 123 of
//! its 140 solves hit the 25s budget. Raising the budget to 120s on 40
//! correct-topology hard CPs took recovery from 3 to 16, so hard is
//! solver-bound, not repair-bound.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use oristudio_cp_compiler::candidate_graph::{
    BoundarySideModel, CandidateCarrierGeometry, CandidateCreaseBoundaryRole,
    CandidateVertex as GraphVertex,
};
use oristudio_cp_compiler::{
    AssignmentEvidence, AssignmentEvidenceSource, AssignmentLabel, BoundarySide,
    CandidateCreaseSourceKind, CandidateCreaseSpan, CandidateCreaseSpanKind,
    CandidateSelectionPolicy, CandidateSourceAdapter, CandidateVertexKind,
    CandidateVertexMovementPolicy, ExactSolveInput, ExactSolveOptions,
    ExactSolveOptionsWithExemptions, ExactSolvedGraph, Point2, analyze_candidate_topology,
    solve_exact_with_exemptions,
};
use oristudio_cp_eval::{
    EvalAssignment, EvalBoundaryRole, EvalEdge, EvalGraph, EvalPoint, StrictTopologyOptions,
    strict_topology_metrics,
};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const SCHEMA: &str = "oristudio/cp-detect-topology-repair-simulation/v1";
/// The rendering inset every pack shares: paper (0,0)-(1,1) maps to
/// `[inset, image_size - inset]` px. Same constant the benchmark uses.
const RENDER_INSET_PX: f64 = 32.0;
/// Two spans meeting at a shallower angle than this are not treated as a
/// crossing whose intersection an inserted vertex should snap to.
const INTERSECTION_MIN_ANGLE_DEGREES: f64 = 10.0;
/// Two vertices this close are the same vertex for drawing purposes: an edge
/// between them is degenerate, and one degenerate edge blocks the entire solve
/// at preflight.
const COINCIDENT_VERTEX_PX: f64 = 0.25;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct Manifest {
    #[serde(default)]
    pack: Option<String>,
    samples: Vec<ManifestSample>,
}

#[derive(Debug, Deserialize)]
struct ManifestSample {
    id: String,
    #[serde(default)]
    gt_graph: Option<String>,
    #[serde(default)]
    image_size: Option<u32>,
    #[serde(default)]
    bucket: Option<String>,
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

impl GroundTruthGraph {
    fn labels(&self) -> Vec<AssignmentLabel> {
        let source = if self.edges_assignment_labels.is_empty() {
            &self.edges_assignment
        } else {
            &self.edges_assignment_labels
        };
        self.edges_vertices
            .iter()
            .enumerate()
            .map(|(index, _)| {
                source
                    .get(index)
                    .map(parse_assignment_value)
                    .unwrap_or(AssignmentLabel::Unknown)
            })
            .collect()
    }

    fn eval_graph(&self) -> EvalGraph {
        let labels = self.labels();
        let vertices = self
            .vertices_px
            .iter()
            .copied()
            .map(EvalPoint::from)
            .collect::<Vec<_>>();
        let edges = self
            .edges_vertices
            .iter()
            .enumerate()
            .map(|(index, vertices)| {
                EvalEdge::new(
                    *vertices,
                    labels
                        .get(index)
                        .copied()
                        .map(eval_assignment)
                        .unwrap_or(EvalAssignment::Unknown),
                )
            })
            .collect::<Vec<_>>();
        EvalGraph::new(vertices, edges)
    }
}

// ---------------------------------------------------------------------------
// Report shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct RunSummary {
    schema: &'static str,
    generated_by: &'static str,
    generated_at_unix: u64,
    git_commit: Option<String>,
    inputs: String,
    manifest: String,
    config: RunConfig,
    sample_count: usize,
    total_seconds: f64,
    /// Aggregates over every sample, then per bucket, then over the samples
    /// whose edit set is inside `hand_repair_site_cap` (the realistically
    /// hand-repairable population).
    overall: BucketAggregate,
    buckets: BTreeMap<String, BucketAggregate>,
    within_site_cap: BTreeMap<String, BucketAggregate>,
}

#[derive(Debug, Clone, Serialize)]
struct RunConfig {
    strict_vertex_tolerance_px: f64,
    identify_px: f64,
    on_edge_px: f64,
    click_jitter_px: f64,
    fix_assignments: bool,
    exempt_repaired_vertices: bool,
    added_span_kind: String,
    exact_solve_timeout_seconds: f64,
    threads: usize,
    hand_repair_site_cap: usize,
    baseline_solved: bool,
}

#[derive(Debug, Default, Clone, Serialize)]
struct BucketAggregate {
    samples: usize,
    /// Pre-solve strict topology of the *unrepaired* candidate graph. This is
    /// the plan's 307/563 column.
    baseline_candidate_exact_topology: usize,
    baseline_candidate_exact_topology_and_assignment: usize,
    /// Solve accepted AND the solved graph reproduces GT topology+assignment.
    /// The plan's 220/563 column.
    baseline_recovered: usize,
    baseline_accepted: usize,
    baseline_timed_out: usize,
    /// Pre-solve strict topology *after* the derived edit set is applied. Not a
    /// result so much as a self-check on the edit derivation: it should be
    /// every sample, and where it is not, the harness could not express the
    /// repair.
    repaired_candidate_exact_topology: usize,
    repaired_candidate_exact_topology_and_assignment: usize,
    /// The edit set judged as a graph rather than through the metric's 2px
    /// vertex matching: how often the derived repair *is* the ground-truth
    /// topology. Anything short of `samples` is a repair the harness could not
    /// express, so this bounds how much the headline understates.
    repaired_graph_matches_ground_truth: usize,
    /// Repaired graphs still holding a degenerate span, which blocks the solve
    /// at preflight.
    repaired_degenerate: usize,
    repaired_recovered: usize,
    repaired_recovered_topology_only: usize,
    repaired_accepted: usize,
    repaired_timed_out: usize,
    /// Samples the repair recovered that the baseline did not, and the reverse.
    gained: usize,
    lost: usize,
    edits: EditTotals,
    repair_sites: SiteDistribution,
    baseline_solve_seconds: f64,
    repaired_solve_seconds: f64,
}

/// Edits by verb, in the plan's numbering: insert vertex on edge (1),
/// add edge (2), add vertex (3), delete edge (4), delete vertex (6),
/// relabel (7). Counted per *span*, not per user action — `split_spans` is the
/// number of resulting pieces, so one split-at-point through a 4-valent
/// crossing shows up as four.
#[derive(Debug, Default, Clone, Copy, Serialize)]
struct EditTotals {
    inserted_vertices: usize,
    deleted_vertices: usize,
    split_spans: usize,
    added_spans: usize,
    deleted_spans: usize,
    relabelled_spans: usize,
}

#[derive(Debug, Default, Clone, Serialize)]
struct SiteDistribution {
    median: f64,
    mean: f64,
    p90: f64,
    max: usize,
    at_most_2: usize,
    at_most_4: usize,
    at_most_8: usize,
    #[serde(skip)]
    values: Vec<usize>,
}

impl SiteDistribution {
    fn push(&mut self, value: usize) {
        self.values.push(value);
    }

    fn finalize(&mut self) {
        self.values.sort_unstable();
        self.max = self.values.last().copied().unwrap_or(0);
        self.mean = if self.values.is_empty() {
            0.0
        } else {
            self.values.iter().sum::<usize>() as f64 / self.values.len() as f64
        };
        self.median = percentile(&self.values, 0.5);
        self.p90 = percentile(&self.values, 0.9);
        self.at_most_2 = self.values.iter().filter(|value| **value <= 2).count();
        self.at_most_4 = self.values.iter().filter(|value| **value <= 4).count();
        self.at_most_8 = self.values.iter().filter(|value| **value <= 8).count();
    }
}

fn percentile(sorted: &[usize], fraction: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let index = ((sorted.len() as f64 - 1.0) * fraction).round() as usize;
    sorted.get(index).copied().unwrap_or(0) as f64
}

#[derive(Debug, Clone, Serialize)]
struct SampleRow {
    id: String,
    bucket: Option<String>,
    gt_vertices: usize,
    gt_edges: usize,
    candidate_vertices: usize,
    candidate_spans: usize,
    repaired_vertices: usize,
    repaired_spans: usize,
    edits: EditTotals,
    /// Connected components of the added set plus of the deleted set — the
    /// plan's "repair sites" unit, so the two counts are comparable.
    repair_sites: usize,
    add_sites: usize,
    delete_sites: usize,
    /// Odd-degree interior vertices before and after the edit set: the
    /// dominant marker the repair worklist is built from.
    odd_degree_before: usize,
    odd_degree_after: usize,
    /// Degenerate spans left in the repaired graph. One of these blocks the
    /// whole solve at preflight, so this is a hard failure, not a metric.
    degenerate_edges_after: usize,
    baseline_candidate: TopologySummary,
    repaired_candidate: TopologySummary,
    /// The edit set judged as a graph, free of the metric's coordinate
    /// tolerance — see [`repaired_topology_at_gt_coordinates`].
    repaired_graph_at_gt_coordinates: TopologySummary,
    baseline_solve: SolveOutcome,
    repaired_solve: SolveOutcome,
    notes: Vec<String>,
    seconds: f64,
}

#[derive(Debug, Default, Clone, Serialize)]
struct TopologySummary {
    exact_topology: bool,
    exact_topology_and_assignment: bool,
    missing_edges: usize,
    extra_edges: usize,
    wrong_assignments: usize,
    unmatched_gt_vertices: usize,
    unmatched_predicted_vertices: usize,
    max_vertex_error_px: f64,
}

impl TopologySummary {
    fn from_metrics(metrics: &oristudio_cp_eval::StrictTopologyMetrics) -> Self {
        Self {
            exact_topology: metrics.exact_topology,
            exact_topology_and_assignment: metrics.exact_topology_and_assignment,
            missing_edges: metrics.edges.missing_edges,
            extra_edges: metrics.edges.extra_edges,
            wrong_assignments: metrics.assignments.wrong_edges,
            unmatched_gt_vertices: metrics.vertices.unmatched_gt_vertices,
            unmatched_predicted_vertices: metrics.vertices.unmatched_predicted_vertices,
            max_vertex_error_px: round3(metrics.vertices.max_error),
        }
    }
}

#[derive(Debug, Default, Clone, Serialize)]
struct SolveOutcome {
    ran: bool,
    status: String,
    accepted: bool,
    timed_out: bool,
    seconds: f64,
    rejection_reasons: Vec<String>,
    topology: TopologySummary,
    recovered: bool,
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Args {
    inputs: PathBuf,
    manifest: PathBuf,
    out: PathBuf,
    strict_px: f64,
    repair: RepairOptions,
    threads: usize,
    timeout_seconds: f64,
    exempt_repaired_vertices: bool,
    skip_baseline: bool,
    buckets: Option<BTreeSet<String>>,
    limit: Option<usize>,
    hand_repair_site_cap: usize,
    allow_stale: bool,
}

#[derive(Debug, Clone, Copy)]
struct RepairOptions {
    /// A candidate vertex within this of a GT vertex *is* that GT vertex: the
    /// user recognises it and does not add another.
    identify_px: f64,
    /// How close an inserted vertex must be to a span to land on it (and split
    /// it), and how close a target edge must be to a span to inherit it.
    on_edge_px: f64,
    /// Tolerance for splitting GT edges at GT vertices on their interior, so
    /// the repair target is the same canonical segmentation the eval compares.
    split_tolerance_px: f64,
    /// Perturbation applied to every inserted vertex before it snaps, in px.
    click_jitter_px: f64,
    fix_assignments: bool,
    added_span_kind: CandidateCreaseSpanKind,
}

impl Default for RepairOptions {
    fn default() -> Self {
        Self {
            identify_px: 3.0,
            on_edge_px: 2.0,
            split_tolerance_px: 2.0,
            click_jitter_px: 0.0,
            fix_assignments: true,
            // Junction-first emits `ObservedCarrierSpan` for every span, whose
            // carrier group is geometry-binned — so a drawn crease collinear
            // with an existing one shares its carrier, which is what snapping
            // to the existing line means. `--added-span-kind atomic` gives each
            // added span its own carrier instead.
            added_span_kind: CandidateCreaseSpanKind::ObservedCarrierSpan,
        }
    }
}

const USAGE: &str = "\
simulate_topology_repair --inputs <dump dir> --manifest <dense-cache manifest> --out <dir>

Required:
  --inputs DIR             ExactSolveInput dump from compare_exact_solve_benchmark
                           --dump-exact-inputs (the dir itself, or its right/ or
                           wrong/ bucket; subdirectories are picked up)
  --manifest PATH          dense-cache manifest of the SAME pack (absolute path;
                           supplies ground-truth graphs and buckets)
  --out DIR                report directory (per_sample.jsonl + summary.json + summary.md)

Repair model:
  --identify-px F          candidate vertex within F px of a GT vertex is that vertex (3.0)
  --on-edge-px F           span-containment tolerance for split/inherit (2.0)
  --click-jitter-px F      perturb every inserted vertex before snapping (0.0)
  --no-relabel             do not fix assignments from ground truth (verb 7 off)
  --added-span-kind KIND   observed (default; geometry-binned carrier) | atomic (own carrier)
  --no-exemptions          do not exempt repaired vertices from the movement budget

Scoring / run:
  --strict-px F            strict vertex tolerance in px (2.0)
  --timeout-seconds F      per-solve wall-clock budget (production default)
  --threads N              solver parallelism (4 = timeout parity; 0 = all cores)
  --skip-baseline          do not re-solve the unrepaired candidate
  --bucket NAME            restrict to a bucket (repeatable: easy|medium|hard)
  --limit N                first N samples after bucket filtering
  --hand-repair-site-cap N site budget for the \"realistically hand-repairable\" slice (8)
  --allow-stale            run even if the binary was built from another commit";

fn required_value(
    iter: &mut impl Iterator<Item = String>,
    flag: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    iter.next()
        .ok_or_else(|| format!("{flag} needs a value").into())
}

fn parse_args() -> Result<Args, Box<dyn std::error::Error>> {
    let mut inputs = None;
    let mut manifest = None;
    let mut out = None;
    let mut strict_px = 2.0;
    let mut repair = RepairOptions::default();
    let mut threads = 4usize;
    let mut timeout_seconds = ExactSolveOptions::default().timeout_seconds;
    let mut exempt_repaired_vertices = true;
    let mut skip_baseline = false;
    let mut buckets: Option<BTreeSet<String>> = None;
    let mut limit = None;
    let mut hand_repair_site_cap = 8usize;
    let mut allow_stale = false;
    let mut iter = std::env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--inputs" => inputs = Some(PathBuf::from(required_value(&mut iter, &arg)?)),
            "--manifest" => manifest = Some(PathBuf::from(required_value(&mut iter, &arg)?)),
            "--out" => out = Some(PathBuf::from(required_value(&mut iter, &arg)?)),
            "--strict-px" => strict_px = required_value(&mut iter, &arg)?.parse()?,
            "--identify-px" => repair.identify_px = required_value(&mut iter, &arg)?.parse()?,
            "--on-edge-px" => repair.on_edge_px = required_value(&mut iter, &arg)?.parse()?,
            "--click-jitter-px" => {
                repair.click_jitter_px = required_value(&mut iter, &arg)?.parse()?;
            }
            "--no-relabel" => repair.fix_assignments = false,
            "--added-span-kind" => {
                let value = required_value(&mut iter, &arg)?;
                repair.added_span_kind = match value.as_str() {
                    "observed" => CandidateCreaseSpanKind::ObservedCarrierSpan,
                    "atomic" => CandidateCreaseSpanKind::AtomicInterval,
                    other => {
                        return Err(format!(
                            "--added-span-kind must be observed|atomic (got {other})"
                        )
                        .into());
                    }
                };
            }
            "--no-exemptions" => exempt_repaired_vertices = false,
            "--timeout-seconds" => timeout_seconds = required_value(&mut iter, &arg)?.parse()?,
            "--threads" => threads = required_value(&mut iter, &arg)?.parse()?,
            "--skip-baseline" => skip_baseline = true,
            "--bucket" => {
                buckets
                    .get_or_insert_with(BTreeSet::new)
                    .insert(required_value(&mut iter, &arg)?);
            }
            "--limit" => limit = Some(required_value(&mut iter, &arg)?.parse()?),
            "--hand-repair-site-cap" => {
                hand_repair_site_cap = required_value(&mut iter, &arg)?.parse()?;
            }
            "--allow-stale" => allow_stale = true,
            "--help" | "-h" => {
                println!("{USAGE}");
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument: {other}\n\n{USAGE}").into()),
        }
    }
    repair.split_tolerance_px = strict_px;
    Ok(Args {
        inputs: inputs.ok_or("--inputs is required")?,
        manifest: manifest.ok_or("--manifest is required")?,
        out: out.ok_or("--out is required")?,
        strict_px,
        repair,
        threads,
        timeout_seconds,
        exempt_repaired_vertices,
        skip_baseline,
        buckets,
        limit,
        hand_repair_site_cap,
        allow_stale,
    })
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

fn normalized_to_px(point: Point2, image_size: u32) -> [f64; 2] {
    let span = image_size as f64 - RENDER_INSET_PX * 2.0;
    [
        RENDER_INSET_PX + point.x * span,
        RENDER_INSET_PX + point.y * span,
    ]
}

fn px_to_normalized(point: [f64; 2], image_size: u32) -> Point2 {
    let span = (image_size as f64 - RENDER_INSET_PX * 2.0).max(1e-9);
    Point2::new(
        (point[0] - RENDER_INSET_PX) / span,
        (point[1] - RENDER_INSET_PX) / span,
    )
}

fn px_span(image_size: u32) -> f64 {
    (image_size as f64 - RENDER_INSET_PX * 2.0).max(1e-9)
}

fn distance(a: Point2, b: Point2) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

/// Perpendicular distance from `point` to the segment `a`-`b`, plus its
/// parameter along the segment. `None` for a degenerate segment.
fn segment_projection(point: Point2, a: Point2, b: Point2) -> Option<(f64, f64, Point2)> {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let length_sq = dx * dx + dy * dy;
    if length_sq <= f64::EPSILON {
        return None;
    }
    let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / length_sq;
    let projected = Point2::new(a.x + t * dx, a.y + t * dy);
    Some((distance(point, projected), t, projected))
}

/// Intersection of the infinite lines through `a0`-`a1` and `b0`-`b1`, when
/// they meet at more than [`INTERSECTION_MIN_ANGLE_DEGREES`].
fn line_intersection(a0: Point2, a1: Point2, b0: Point2, b1: Point2) -> Option<Point2> {
    let r = Point2::new(a1.x - a0.x, a1.y - a0.y);
    let s = Point2::new(b1.x - b0.x, b1.y - b0.y);
    let r_len = (r.x * r.x + r.y * r.y).sqrt();
    let s_len = (s.x * s.x + s.y * s.y).sqrt();
    if r_len <= f64::EPSILON || s_len <= f64::EPSILON {
        return None;
    }
    let cross = r.x * s.y - r.y * s.x;
    let sin_angle = (cross / (r_len * s_len)).abs();
    if sin_angle < INTERSECTION_MIN_ANGLE_DEGREES.to_radians().sin() {
        return None;
    }
    let t = ((b0.x - a0.x) * s.y - (b0.y - a0.y) * s.x) / cross;
    Some(Point2::new(a0.x + t * r.x, a0.y + t * r.y))
}

/// A tiny deterministic PRNG, so `--click-jitter-px` is reproducible without a
/// dependency. xorshift64*, seeded per sample.
struct Jitter {
    state: u64,
}

impl Jitter {
    fn new(seed: u64) -> Self {
        Self { state: seed | 1 }
    }

    fn next_unit(&mut self) -> f64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        let value = x.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 11;
        value as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
    }
}

fn hash_id(id: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in id.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

// ---------------------------------------------------------------------------
// Assignment helpers
// ---------------------------------------------------------------------------

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

fn eval_boundary_role(role: CandidateCreaseBoundaryRole) -> EvalBoundaryRole {
    match role {
        CandidateCreaseBoundaryRole::None => EvalBoundaryRole::None,
        CandidateCreaseBoundaryRole::PaperBoundary => EvalBoundaryRole::PaperBoundary,
        CandidateCreaseBoundaryRole::CutBoundary => EvalBoundaryRole::CutBoundary,
    }
}

/// Pixel-space eval graph over a solved (or unsolved) input, with the same
/// conventions `compare_exact_solve_benchmark` scores with: every input vertex
/// participates, and predicted edges carry their boundary role.
fn predicted_eval_graph(
    input: &ExactSolveInput,
    points: &[Point2],
    edges: &[[usize; 2]],
    image_size: u32,
) -> EvalGraph {
    let vertices = points
        .iter()
        .copied()
        .map(|point| EvalPoint::from(normalized_to_px(point, image_size)))
        .collect::<Vec<_>>();
    let eval_edges = edges
        .iter()
        .enumerate()
        .filter_map(|(index, edge)| {
            if edge[0] >= points.len() || edge[1] >= points.len() {
                return None;
            }
            let span = input.selected_spans.get(index)?;
            Some(
                EvalEdge::new(*edge, eval_assignment(span.assignment_label()))
                    .with_boundary_role(eval_boundary_role(span.boundary_role())),
            )
        })
        .collect::<Vec<_>>();
    EvalGraph::new(vertices, eval_edges)
}

fn candidate_eval_graph(input: &ExactSolveInput, image_size: u32) -> EvalGraph {
    let points = input
        .vertices
        .iter()
        .map(|vertex| vertex.point)
        .collect::<Vec<_>>();
    let edges = input
        .selected_spans
        .iter()
        .map(|span| span.vertices)
        .collect::<Vec<_>>();
    predicted_eval_graph(input, &points, &edges, image_size)
}

// ---------------------------------------------------------------------------
// The repair itself
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct RepairedCandidate {
    input: ExactSolveInput,
    edits: EditTotals,
    add_sites: usize,
    delete_sites: usize,
    exempt_vertex_ids: BTreeSet<usize>,
    notes: Vec<String>,
}

/// One edge of the repair target: the ground-truth graph split at every GT
/// vertex lying on an edge's interior, which is the segmentation the strict
/// topology metric canonicalizes both graphs to before comparing.
#[derive(Debug, Clone, Copy)]
struct TargetEdge {
    vertices: [usize; 2],
    assignment: AssignmentLabel,
}

fn split_gt_edges(gt: &GroundTruthGraph, tolerance_px: f64) -> Vec<TargetEdge> {
    let labels = gt.labels();
    let points = gt
        .vertices_px
        .iter()
        .copied()
        .map(Point2::from_array)
        .collect::<Vec<_>>();
    let mut seen = BTreeSet::<[usize; 2]>::new();
    let mut edges = Vec::new();
    for (edge_index, edge) in gt.edges_vertices.iter().enumerate() {
        let (Some(a), Some(b)) = (points.get(edge[0]).copied(), points.get(edge[1]).copied())
        else {
            continue;
        };
        let assignment = labels
            .get(edge_index)
            .copied()
            .unwrap_or(AssignmentLabel::Unknown);
        let length = distance(a, b);
        let mut interior = Vec::<(usize, f64)>::new();
        if length > f64::EPSILON {
            let margin = (tolerance_px / length).min(0.5);
            for (index, point) in points.iter().enumerate() {
                if index == edge[0] || index == edge[1] {
                    continue;
                }
                let Some((perpendicular, t, _)) = segment_projection(*point, a, b) else {
                    continue;
                };
                if t <= margin || t >= 1.0 - margin || perpendicular > tolerance_px {
                    continue;
                }
                interior.push((index, t));
            }
        }
        interior.sort_by(|left, right| left.1.total_cmp(&right.1));
        let mut chain = Vec::with_capacity(interior.len() + 2);
        chain.push(edge[0]);
        chain.extend(interior.iter().map(|(index, _)| *index));
        chain.push(edge[1]);
        for window in chain.windows(2) {
            let (left, right) = (window[0], window[1]);
            if left == right {
                continue;
            }
            let key = if left <= right {
                [left, right]
            } else {
                [right, left]
            };
            if seen.insert(key) {
                edges.push(TargetEdge {
                    vertices: [left, right],
                    assignment,
                });
            }
        }
    }
    edges
}

trait FromArray {
    fn from_array(value: [f64; 2]) -> Self;
}

impl FromArray for Point2 {
    fn from_array(value: [f64; 2]) -> Self {
        Self::new(value[0], value[1])
    }
}

/// Greedy nearest-neighbour matching of GT vertices to candidate vertices
/// within `tolerance`, honouring `forced` pairs first. One-to-one: a candidate
/// vertex speaks for at most one GT vertex, so a duplicate near a junction
/// stays unmatched (and is deleted).
fn match_vertices(
    gt: &[Point2],
    candidates: &[GraphVertex],
    tolerance: f64,
    forced: &BTreeMap<usize, usize>,
) -> (Vec<Option<usize>>, Vec<Option<usize>>) {
    let mut gt_to_candidate = vec![None; gt.len()];
    let mut candidate_to_gt = vec![None; candidates.len()];
    for (gt_index, candidate_index) in forced {
        if *gt_index < gt.len() && *candidate_index < candidates.len() {
            gt_to_candidate[*gt_index] = Some(*candidate_index);
            candidate_to_gt[*candidate_index] = Some(*gt_index);
        }
    }

    // x-sorted candidate index so each GT vertex only scans its x window.
    let mut order = (0..candidates.len()).collect::<Vec<_>>();
    order.sort_by(|left, right| {
        candidates[*left]
            .point
            .x
            .total_cmp(&candidates[*right].point.x)
    });
    let xs = order
        .iter()
        .map(|index| candidates[*index].point.x)
        .collect::<Vec<_>>();

    let mut pairs = Vec::<(f64, usize, usize)>::new();
    for (gt_index, point) in gt.iter().enumerate() {
        if gt_to_candidate[gt_index].is_some() {
            continue;
        }
        let low = xs.partition_point(|x| *x < point.x - tolerance);
        for slot in xs[low..].iter().enumerate() {
            let (offset, x) = slot;
            if *x > point.x + tolerance {
                break;
            }
            let candidate_index = order[low + offset];
            if candidate_to_gt[candidate_index].is_some() {
                continue;
            }
            let gap = distance(*point, candidates[candidate_index].point);
            if gap <= tolerance {
                pairs.push((gap, gt_index, candidate_index));
            }
        }
    }
    pairs.sort_by(|left, right| {
        left.0
            .total_cmp(&right.0)
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.2.cmp(&right.2))
    });
    for (_, gt_index, candidate_index) in pairs {
        if gt_to_candidate[gt_index].is_some() || candidate_to_gt[candidate_index].is_some() {
            continue;
        }
        gt_to_candidate[gt_index] = Some(candidate_index);
        candidate_to_gt[candidate_index] = Some(gt_index);
    }
    (gt_to_candidate, candidate_to_gt)
}

struct UnionFind {
    parent: Vec<usize>,
}

impl UnionFind {
    fn new(size: usize) -> Self {
        Self {
            parent: (0..size).collect(),
        }
    }

    fn find(&mut self, value: usize) -> usize {
        let mut root = value;
        while self.parent[root] != root {
            root = self.parent[root];
        }
        let mut current = value;
        while self.parent[current] != root {
            let next = self.parent[current];
            self.parent[current] = root;
            current = next;
        }
        root
    }

    fn union(&mut self, left: usize, right: usize) {
        let (left, right) = (self.find(left), self.find(right));
        if left != right {
            self.parent[left] = right;
        }
    }
}

/// Connected components of a set of vertex pairs, plus the isolated vertices
/// in `singletons` that no pair covers. This is the plan's "repair site" unit.
fn count_sites(pairs: &[[usize; 2]], singletons: &[usize], vertex_count: usize) -> usize {
    let mut union = UnionFind::new(vertex_count);
    for pair in pairs {
        if pair[0] < vertex_count && pair[1] < vertex_count {
            union.union(pair[0], pair[1]);
        }
    }
    let mut roots = BTreeSet::new();
    for pair in pairs {
        if pair[0] < vertex_count {
            roots.insert(union.find(pair[0]));
        }
    }
    let mut covered = BTreeSet::new();
    for pair in pairs {
        covered.insert(pair[0]);
        covered.insert(pair[1]);
    }
    for vertex in singletons {
        if !covered.contains(vertex) && *vertex < vertex_count {
            roots.insert(union.find(*vertex));
        }
    }
    roots.len()
}

fn repair_candidate(
    input: &ExactSolveInput,
    gt: &GroundTruthGraph,
    image_size: u32,
    options: &RepairOptions,
    seed: u64,
) -> RepairedCandidate {
    let scale = px_span(image_size);
    let identify = options.identify_px / scale;
    let on_edge = options.on_edge_px / scale;
    let mut notes = Vec::new();
    let mut edits = EditTotals::default();

    let gt_points = gt
        .vertices_px
        .iter()
        .copied()
        .map(|point| px_to_normalized(point, image_size))
        .collect::<Vec<_>>();
    let target_edges = split_gt_edges(gt, options.split_tolerance_px);

    // The four paper corners are load-bearing: the boundary model addresses
    // them by id and the solver pins them to the unit square, so a corner must
    // never be dropped by the delete pass. Force-match each to its GT corner.
    let mut forced = BTreeMap::<usize, usize>::new();
    let corner_targets = [
        Point2::new(0.0, 0.0),
        Point2::new(1.0, 0.0),
        Point2::new(1.0, 1.0),
        Point2::new(0.0, 1.0),
    ];
    for (slot, corner_id) in input.boundary.corners.iter().copied().enumerate() {
        if corner_id >= input.vertices.len() {
            continue;
        }
        let target = corner_targets
            .get(slot)
            .copied()
            .unwrap_or(Point2::new(0.0, 0.0));
        let nearest = gt_points
            .iter()
            .enumerate()
            .filter(|(gt_index, _)| !forced.contains_key(gt_index))
            .map(|(gt_index, point)| (distance(*point, target), gt_index))
            .min_by(|left, right| {
                left.0
                    .total_cmp(&right.0)
                    .then_with(|| left.1.cmp(&right.1))
            });
        match nearest {
            Some((gap, gt_index)) if gap <= identify.max(2.0 / scale) => {
                forced.insert(gt_index, corner_id);
            }
            // Ground truth has no vertex at this corner, which in this corpus
            // means non-square paper: the detect pipeline pins the boundary to
            // the unit square end to end, so it manufactures four corners the
            // drawing does not have. No edit set can remove them, and no repair
            // can rescue such a sample — it is outside the square-only pipeline,
            // not outside repair.
            _ => notes.push(format!(
                "no ground-truth vertex at paper corner {slot} (non-square paper: \
                 unrecoverable by the square-only pipeline, repaired or not)"
            )),
        }
    }

    let (gt_to_candidate, candidate_to_gt) =
        match_vertices(&gt_points, &input.vertices, identify, &forced);

    // ---- vertices -------------------------------------------------------
    // The repaired vertex list is exactly the GT vertex list: index i is GT
    // vertex i, so `id == index` holds (the invariant `analyze_graph` indexes
    // by) and the target edges need no remapping. Candidate corners with no GT
    // counterpart are appended rather than dropped, because the boundary model
    // addresses them.
    let mut vertices = Vec::<GraphVertex>::with_capacity(gt_points.len());
    let mut exempt_vertex_ids = BTreeSet::new();
    let mut inserted_vertices = Vec::new();
    let mut jitter = Jitter::new(seed);
    // Every position an inserted vertex must not land on. A snap that lands on
    // an existing vertex draws a zero-length crease, and one of those blocks
    // the *whole* solve at preflight (`preflight_degenerate_edges`) — the
    // plan's first UI trap. It happens for real: where ground truth holds two
    // junctions a pixel or two apart and detection found only one, the second
    // one's click snaps onto the first.
    let mut occupied = gt_to_candidate
        .iter()
        .filter_map(|candidate_index| {
            candidate_index.and_then(|index| input.vertices.get(index).map(|vertex| vertex.point))
        })
        .collect::<Vec<_>>();
    let coincident = COINCIDENT_VERTEX_PX / scale;
    for (gt_index, point) in gt_points.iter().copied().enumerate() {
        match gt_to_candidate[gt_index] {
            Some(candidate_index) => {
                let mut vertex = input.vertices[candidate_index].clone();
                vertex.id = gt_index;
                vertices.push(vertex);
            }
            None => {
                let mut click = point;
                if options.click_jitter_px > 0.0 {
                    let radius = options.click_jitter_px / scale;
                    click = Point2::new(
                        click.x + jitter.next_unit() * radius,
                        click.y + jitter.next_unit() * radius,
                    );
                }
                let mut placed = snap_inserted_vertex(input, click, on_edge);
                if is_coincident(&occupied, placed, coincident) {
                    // Refuse the snap rather than the vertex: an unsnapped
                    // click still marks the junction, and the solver pulls it
                    // onto its carriers.
                    placed = click;
                    if is_coincident(&occupied, placed, coincident) {
                        notes.push(format!(
                            "ground-truth vertex {gt_index} sits within {COINCIDENT_VERTEX_PX}px \
                             of another vertex; no repair can separate them"
                        ));
                    }
                }
                occupied.push(placed);
                vertices.push(new_vertex(gt_index, placed, scale));
                exempt_vertex_ids.insert(gt_index);
                inserted_vertices.push(gt_index);
                edits.inserted_vertices += 1;
            }
        }
    }
    let mut appended_corner_ids = BTreeMap::<usize, usize>::new();
    for corner_id in input.boundary.corners.iter().copied() {
        if corner_id < input.vertices.len() && candidate_to_gt[corner_id].is_none() {
            let id = vertices.len();
            let mut vertex = input.vertices[corner_id].clone();
            vertex.id = id;
            vertices.push(vertex);
            appended_corner_ids.insert(corner_id, id);
            notes.push(format!(
                "kept unmatched paper corner {corner_id} (counts as an extra vertex)"
            ));
        }
    }
    edits.deleted_vertices = input
        .vertices
        .iter()
        .enumerate()
        .filter(|(index, _)| {
            candidate_to_gt[*index].is_none() && !appended_corner_ids.contains_key(index)
        })
        .count();

    let repaired_index = |candidate_index: usize| -> Option<usize> {
        candidate_to_gt
            .get(candidate_index)
            .copied()
            .flatten()
            .or_else(|| appended_corner_ids.get(&candidate_index).copied())
    };

    // ---- spans ----------------------------------------------------------
    let mut spans = Vec::<CandidateCreaseSpan>::with_capacity(target_edges.len());
    let mut parent_used = vec![0usize; input.selected_spans.len()];
    let mut added_pairs = Vec::<[usize; 2]>::new();
    for target in &target_edges {
        let [a, b] = target.vertices;
        let (Some(pa), Some(pb)) = (vertices.get(a), vertices.get(b)) else {
            continue;
        };
        let (pa, pb) = (pa.point, pb.point);
        let parent = find_parent_span(input, pa, pb, on_edge);
        let id = spans.len();
        match parent {
            Some(parent_index) => {
                parent_used[parent_index] += 1;
                let source = &input.selected_spans[parent_index];
                let mapped = [
                    repaired_index(source.vertices[0]),
                    repaired_index(source.vertices[1]),
                ];
                let same_edge = matches!((mapped[0], mapped[1]), (Some(left), Some(right))
                    if (left == a && right == b) || (left == b && right == a));
                if !same_edge {
                    edits.split_spans += 1;
                }
                let mut span = source.clone();
                span.id = id;
                span.vertices = [a, b];
                span.t_interval = t_interval(&span.carrier, pa, pb);
                if options.fix_assignments && span.assignment_label() != target.assignment {
                    edits.relabelled_spans += 1;
                    set_span_assignment(&mut span, target.assignment);
                }
                spans.push(span);
            }
            None => {
                edits.added_spans += 1;
                added_pairs.push([a, b]);
                spans.push(new_span(id, [a, b], pa, pb, target.assignment, options));
            }
        }
    }
    let mut deleted_pairs = Vec::<[usize; 2]>::new();
    for (index, span) in input.selected_spans.iter().enumerate() {
        if parent_used[index] > 0 {
            continue;
        }
        edits.deleted_spans += 1;
        deleted_pairs.push(span.vertices);
    }

    let add_sites = count_sites(&added_pairs, &inserted_vertices, vertices.len());
    let delete_sites = count_sites(&deleted_pairs, &[], input.vertices.len());

    // ---- boundary -------------------------------------------------------
    let mut boundary = input.boundary.clone();
    let mut corners = boundary.corners;
    for corner in corners.iter_mut() {
        if let Some(mapped) = repaired_index(*corner) {
            *corner = mapped;
        } else {
            notes.push(format!("paper corner {corner} lost in repair"));
        }
    }
    boundary.corners = corners;
    let corner_set = corners.iter().copied().collect::<BTreeSet<_>>();
    boundary.sides = boundary
        .sides
        .iter()
        .map(|side| {
            let mut contacts = vertices
                .iter()
                .filter(|vertex| {
                    vertex.boundary_side == Some(side.side) && !corner_set.contains(&vertex.id)
                })
                .map(|vertex| (side_sort_key(side.side, vertex.point), vertex.id))
                .collect::<Vec<_>>();
            contacts.sort_by(|left, right| left.0.total_cmp(&right.0).then(left.1.cmp(&right.1)));
            BoundarySideModel {
                side: side.side,
                corner_vertices: [
                    repaired_index(side.corner_vertices[0]).unwrap_or(side.corner_vertices[0]),
                    repaired_index(side.corner_vertices[1]).unwrap_or(side.corner_vertices[1]),
                ],
                contact_vertices: contacts.into_iter().map(|(_, id)| id).collect(),
            }
        })
        .collect();
    // Span ids are reassigned above, so the old generated-border ids no longer
    // address anything. Nothing in the solve path reads this list; clear it
    // rather than leave dangling ids behind.
    boundary.generated_border_span_ids = Vec::new();

    let repaired = ExactSolveInput {
        schema: input.schema.clone(),
        coordinate_space: input.coordinate_space.clone(),
        image_size: input.image_size,
        vertices,
        selected_spans: spans,
        boundary,
        cost_model: input.cost_model.clone(),
        provenance: input.provenance.clone(),
    };

    RepairedCandidate {
        input: repaired,
        edits,
        add_sites,
        delete_sites,
        exempt_vertex_ids,
        notes,
    }
}

fn is_coincident(occupied: &[Point2], point: Point2, tolerance: f64) -> bool {
    occupied
        .iter()
        .any(|other| distance(*other, point) <= tolerance)
}

fn side_sort_key(side: BoundarySide, point: Point2) -> f64 {
    match side {
        BoundarySide::Top | BoundarySide::Bottom => point.x,
        BoundarySide::Right | BoundarySide::Left => point.y,
    }
}

/// Where an inserted vertex actually lands. A click near two crossing spans
/// snaps to their intersection (the plan's "add vertex, snapped to
/// intersections"); a click near one span projects onto it (split-at-point);
/// otherwise it stays where it was clicked.
fn snap_inserted_vertex(input: &ExactSolveInput, click: Point2, tolerance: f64) -> Point2 {
    let mut hits = Vec::<(f64, Point2, Point2)>::new();
    for span in &input.selected_spans {
        let (Some(a), Some(b)) = (
            input.vertices.get(span.vertices[0]),
            input.vertices.get(span.vertices[1]),
        ) else {
            continue;
        };
        let (a, b) = (a.point, b.point);
        let Some((perpendicular, t, _)) = segment_projection(click, a, b) else {
            continue;
        };
        let length = distance(a, b);
        if length <= f64::EPSILON {
            continue;
        }
        let margin = tolerance / length;
        if t < -margin || t > 1.0 + margin || perpendicular > tolerance {
            continue;
        }
        hits.push((perpendicular, a, b));
    }
    hits.sort_by(|left, right| left.0.total_cmp(&right.0));
    if hits.len() >= 2 {
        for other in hits.iter().skip(1) {
            if let Some(point) = line_intersection(hits[0].1, hits[0].2, other.1, other.2)
                && distance(point, click) <= tolerance * 2.0
            {
                return point;
            }
        }
    }
    if let Some((_, a, b)) = hits.first()
        && let Some((_, _, projected)) = segment_projection(click, *a, *b)
    {
        return projected;
    }
    click
}

/// The candidate span a target edge should inherit: the shortest span whose
/// segment contains both endpoints. That single rule covers both "this edge is
/// already there" (the span is the edge) and "this edge is one piece of a span
/// that skipped a junction" (the split), so a split keeps the parent's carrier
/// and its two halves stay collinear.
fn find_parent_span(
    input: &ExactSolveInput,
    a: Point2,
    b: Point2,
    tolerance: f64,
) -> Option<usize> {
    let mut best: Option<(f64, usize)> = None;
    for (index, span) in input.selected_spans.iter().enumerate() {
        let (Some(p0), Some(p1)) = (
            input.vertices.get(span.vertices[0]),
            input.vertices.get(span.vertices[1]),
        ) else {
            continue;
        };
        let (p0, p1) = (p0.point, p1.point);
        let length = distance(p0, p1);
        if length <= f64::EPSILON {
            continue;
        }
        let margin = tolerance / length;
        let contains = |point: Point2| {
            segment_projection(point, p0, p1).is_some_and(|(perpendicular, t, _)| {
                perpendicular <= tolerance && (-margin..=1.0 + margin).contains(&t)
            })
        };
        if !contains(a) || !contains(b) {
            continue;
        }
        if best.is_none_or(|(best_length, _)| length < best_length) {
            best = Some((length, index));
        }
    }
    best.map(|(_, index)| index)
}

fn t_interval(carrier: &CandidateCarrierGeometry, a: Point2, b: Point2) -> [f64; 2] {
    let t0 = carrier.direction.x * a.x + carrier.direction.y * a.y;
    let t1 = carrier.direction.x * b.x + carrier.direction.y * b.y;
    [t0.min(t1), t0.max(t1)]
}

fn set_span_assignment(span: &mut CandidateCreaseSpan, label: AssignmentLabel) {
    span.assignment_evidence.observed_label = label;
    span.assignment_evidence.ink_label = None;
    // `boundary_role()` folds the label in, so an inherited role has to move
    // with it: a span left marked `PaperBoundary` is excluded from every local
    // theorem, which is the plan's "labelling a span boundary is a topology
    // delete" trap in reverse.
    span.boundary_role = if label == AssignmentLabel::Boundary {
        CandidateCreaseBoundaryRole::PaperBoundary
    } else {
        CandidateCreaseBoundaryRole::None
    };
}

fn new_vertex(id: usize, point: Point2, scale: f64) -> GraphVertex {
    let border = 0.5 / scale;
    let side = if point.x.abs() <= border {
        Some(BoundarySide::Left)
    } else if (point.x - 1.0).abs() <= border {
        Some(BoundarySide::Right)
    } else if point.y.abs() <= border {
        Some(BoundarySide::Top)
    } else if (point.y - 1.0).abs() <= border {
        Some(BoundarySide::Bottom)
    } else {
        None
    };
    GraphVertex {
        id,
        point,
        kind: if side.is_some() {
            CandidateVertexKind::BoundaryContact
        } else {
            CandidateVertexKind::InteriorJunction
        },
        // Measured to carry no signal in the shipping junction-first path (it
        // is uniformly 1.0 on every production-dumped fixture), so a repaired
        // vertex takes the same value rather than inventing a weaker one.
        support: 1.0,
        movement_policy: if side.is_some() {
            CandidateVertexMovementPolicy::BoundaryOnly
        } else {
            CandidateVertexMovementPolicy::Movable
        },
        boundary_side: side,
        source_vertex_ids: Vec::new(),
        source_carrier_ids: Vec::new(),
        source_adapter: CandidateSourceAdapter::RepairCandidate,
        provenance: Vec::new(),
    }
}

fn new_span(
    id: usize,
    vertices: [usize; 2],
    a: Point2,
    b: Point2,
    label: AssignmentLabel,
    options: &RepairOptions,
) -> CandidateCreaseSpan {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let length = (dx * dx + dy * dy).sqrt().max(1e-12);
    let direction = Point2::new(dx / length, dy / length);
    let mut normal = Point2::new(-direction.y, direction.x);
    let mut rho = normal.x * a.x + normal.y * a.y;
    if rho < 0.0 {
        normal = Point2::new(-normal.x, -normal.y);
        rho = -rho;
    }
    let carrier = CandidateCarrierGeometry {
        normal,
        direction,
        rho,
    };
    CandidateCreaseSpan {
        id,
        kind: options.added_span_kind,
        vertices,
        carrier,
        t_interval: t_interval(&carrier, a, b),
        // A hand-drawn crease carries no detector evidence at all: the solver
        // reads the label and the carrier, never the support fields. Leaving
        // them at zero keeps that explicit.
        assignment_evidence: AssignmentEvidence {
            mountain: 0.0,
            valley: 0.0,
            boundary: 0.0,
            auxiliary: 0.0,
            unknown: 0.0,
            observed_label: label,
            source: AssignmentEvidenceSource::Inferred,
            confidence: 1.0,
            margin: 1.0,
            ink_label: None,
        },
        presence_probability: 0.0,
        line_support_min: 0.0,
        line_support_mean: 0.0,
        line_support_max: 0.0,
        style_support: 0.0,
        non_crease_support: 0.0,
        source_kind: CandidateCreaseSourceKind::RepairCandidate,
        selection_policy: CandidateSelectionPolicy::Locked,
        boundary_role: if label == AssignmentLabel::Boundary {
            CandidateCreaseBoundaryRole::PaperBoundary
        } else {
            CandidateCreaseBoundaryRole::None
        },
        source_edge_ids: Vec::new(),
        source_atomic_edge_ids: Vec::new(),
        source_carrier_ids: Vec::new(),
        replaced_span_ids: Vec::new(),
        replaced_atomic_edge_ids: Vec::new(),
        collapsed_vertex_ids: Vec::new(),
        provenance: Vec::new(),
        reasons: vec!["repair simulation: user-added crease".to_owned()],
    }
}

// ---------------------------------------------------------------------------
// Per-sample run
// ---------------------------------------------------------------------------

struct SampleContext<'a> {
    id: &'a str,
    bucket: Option<String>,
    input: ExactSolveInput,
    gt: GroundTruthGraph,
    image_size: u32,
}

fn solve_and_score(
    input: &ExactSolveInput,
    gt_graph: &EvalGraph,
    image_size: u32,
    options: &ExactSolveOptionsWithExemptions,
    strict_px: f64,
) -> SolveOutcome {
    let started = Instant::now();
    let solved: ExactSolvedGraph = solve_exact_with_exemptions(input, options);
    let seconds = started.elapsed().as_secs_f64();
    let accepted = solved.movement_report["accepted"]
        .as_bool()
        .unwrap_or(false);
    let timed_out = solved.movement_report["timed_out"]
        .as_bool()
        .unwrap_or(false);
    let rejection_reasons = solved.movement_report["rejection_reasons"]
        .as_array()
        .map(|reasons| {
            reasons
                .iter()
                .filter_map(|reason| reason.as_str().map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let predicted = predicted_eval_graph(
        input,
        &solved.vertices_exact,
        &solved.edges_exact,
        image_size,
    );
    let metrics = strict_topology_metrics(
        &predicted,
        gt_graph,
        StrictTopologyOptions {
            vertex_tolerance: strict_px,
            split_merge_tolerance: strict_px,
            compare_assignments: true,
        },
    );
    SolveOutcome {
        ran: true,
        status: format!("{:?}", solved.status).to_lowercase(),
        accepted,
        timed_out,
        seconds: round3(seconds),
        rejection_reasons,
        recovered: accepted && metrics.exact_topology_and_assignment,
        topology: TopologySummary::from_metrics(&metrics),
    }
}

/// The repaired graph scored against ground truth **at ground-truth
/// coordinates**: repaired vertex `i` is GT vertex `i` by construction, so
/// placing the repaired edge set on the GT points turns the strict metric into
/// a pure graph comparison.
///
/// This separates the two things `repaired_candidate` conflates. If this says
/// exact, the derived edit set *is* the complete repair and any disagreement at
/// detected coordinates is the metric's 2px vertex matching and its
/// coordinate-dependent canonicalization talking, not a missing edit. If it
/// says otherwise, the harness genuinely could not express the repair.
fn repaired_topology_at_gt_coordinates(
    repaired: &ExactSolveInput,
    gt: &GroundTruthGraph,
    gt_graph: &EvalGraph,
    image_size: u32,
    strict_px: f64,
) -> TopologySummary {
    let points = repaired
        .vertices
        .iter()
        .enumerate()
        .map(|(index, vertex)| match gt.vertices_px.get(index) {
            Some(point) => px_to_normalized(*point, image_size),
            None => vertex.point,
        })
        .collect::<Vec<_>>();
    let edges = repaired
        .selected_spans
        .iter()
        .map(|span| span.vertices)
        .collect::<Vec<_>>();
    let metrics = strict_topology_metrics(
        &predicted_eval_graph(repaired, &points, &edges, image_size),
        gt_graph,
        StrictTopologyOptions {
            vertex_tolerance: strict_px,
            split_merge_tolerance: strict_px,
            compare_assignments: true,
        },
    );
    TopologySummary::from_metrics(&metrics)
}

fn topology_summary(
    input: &ExactSolveInput,
    gt_graph: &EvalGraph,
    image_size: u32,
    strict_px: f64,
) -> TopologySummary {
    let metrics = strict_topology_metrics(
        &candidate_eval_graph(input, image_size),
        gt_graph,
        StrictTopologyOptions {
            vertex_tolerance: strict_px,
            split_merge_tolerance: strict_px,
            compare_assignments: true,
        },
    );
    TopologySummary::from_metrics(&metrics)
}

fn process_sample(context: SampleContext<'_>, args: &Args) -> SampleRow {
    let started = Instant::now();
    let gt_graph = context.gt.eval_graph();
    let exact_options = ExactSolveOptions {
        timeout_seconds: args.timeout_seconds,
        ..ExactSolveOptions::default()
    };

    let baseline_candidate = topology_summary(
        &context.input,
        &gt_graph,
        context.image_size,
        args.strict_px,
    );
    let repaired = repair_candidate(
        &context.input,
        &context.gt,
        context.image_size,
        &args.repair,
        hash_id(context.id),
    );
    let repaired_candidate = topology_summary(
        &repaired.input,
        &gt_graph,
        context.image_size,
        args.strict_px,
    );

    let baseline_solve = if args.skip_baseline {
        SolveOutcome::default()
    } else {
        solve_and_score(
            &context.input,
            &gt_graph,
            context.image_size,
            &ExactSolveOptionsWithExemptions::from(exact_options),
            args.strict_px,
        )
    };
    let repaired_options = ExactSolveOptionsWithExemptions {
        options: exact_options,
        exempt_vertex_ids: if args.exempt_repaired_vertices {
            repaired.exempt_vertex_ids.clone()
        } else {
            BTreeSet::new()
        },
    };
    let repaired_solve = solve_and_score(
        &repaired.input,
        &gt_graph,
        context.image_size,
        &repaired_options,
        args.strict_px,
    );

    let odd_degree_before = analyze_candidate_topology(&context.input)
        .combinatorial
        .odd_degree_vertices
        .len();
    let repaired_diagnostics = analyze_candidate_topology(&repaired.input);
    let odd_degree_after = repaired_diagnostics.combinatorial.odd_degree_vertices.len();
    let degenerate_edges_after = repaired_diagnostics.combinatorial.degenerate_edges.len();
    let repaired_graph_at_gt_coordinates = repaired_topology_at_gt_coordinates(
        &repaired.input,
        &context.gt,
        &gt_graph,
        context.image_size,
        args.strict_px,
    );

    SampleRow {
        id: context.id.to_owned(),
        bucket: context.bucket,
        gt_vertices: context.gt.vertices_px.len(),
        gt_edges: context.gt.edges_vertices.len(),
        candidate_vertices: context.input.vertices.len(),
        candidate_spans: context.input.selected_spans.len(),
        repaired_vertices: repaired.input.vertices.len(),
        repaired_spans: repaired.input.selected_spans.len(),
        edits: repaired.edits,
        repair_sites: repaired.add_sites + repaired.delete_sites,
        add_sites: repaired.add_sites,
        delete_sites: repaired.delete_sites,
        odd_degree_before,
        odd_degree_after,
        degenerate_edges_after,
        baseline_candidate,
        repaired_candidate,
        repaired_graph_at_gt_coordinates,
        baseline_solve,
        repaired_solve,
        notes: repaired.notes,
        seconds: round3(started.elapsed().as_secs_f64()),
    }
}

// ---------------------------------------------------------------------------
// Aggregation and reporting
// ---------------------------------------------------------------------------

impl BucketAggregate {
    fn add(&mut self, row: &SampleRow) {
        self.samples += 1;
        self.baseline_candidate_exact_topology +=
            usize::from(row.baseline_candidate.exact_topology);
        self.baseline_candidate_exact_topology_and_assignment +=
            usize::from(row.baseline_candidate.exact_topology_and_assignment);
        self.baseline_recovered += usize::from(row.baseline_solve.recovered);
        self.baseline_accepted += usize::from(row.baseline_solve.accepted);
        self.baseline_timed_out += usize::from(row.baseline_solve.timed_out);
        self.repaired_candidate_exact_topology +=
            usize::from(row.repaired_candidate.exact_topology);
        self.repaired_candidate_exact_topology_and_assignment +=
            usize::from(row.repaired_candidate.exact_topology_and_assignment);
        self.repaired_graph_matches_ground_truth += usize::from(
            row.repaired_graph_at_gt_coordinates
                .exact_topology_and_assignment,
        );
        self.repaired_degenerate += usize::from(row.degenerate_edges_after > 0);
        self.repaired_recovered += usize::from(row.repaired_solve.recovered);
        self.repaired_recovered_topology_only +=
            usize::from(row.repaired_solve.accepted && row.repaired_solve.topology.exact_topology);
        self.repaired_accepted += usize::from(row.repaired_solve.accepted);
        self.repaired_timed_out += usize::from(row.repaired_solve.timed_out);
        if row.repaired_solve.recovered && !row.baseline_solve.recovered {
            self.gained += 1;
        }
        if !row.repaired_solve.recovered && row.baseline_solve.recovered {
            self.lost += 1;
        }
        self.edits.inserted_vertices += row.edits.inserted_vertices;
        self.edits.deleted_vertices += row.edits.deleted_vertices;
        self.edits.split_spans += row.edits.split_spans;
        self.edits.added_spans += row.edits.added_spans;
        self.edits.deleted_spans += row.edits.deleted_spans;
        self.edits.relabelled_spans += row.edits.relabelled_spans;
        self.repair_sites.push(row.repair_sites);
        self.baseline_solve_seconds += row.baseline_solve.seconds;
        self.repaired_solve_seconds += row.repaired_solve.seconds;
    }

    fn finalize(&mut self) {
        self.repair_sites.finalize();
        self.baseline_solve_seconds = round3(self.baseline_solve_seconds);
        self.repaired_solve_seconds = round3(self.repaired_solve_seconds);
    }
}

fn aggregate<'a>(
    rows: impl Iterator<Item = &'a SampleRow>,
) -> (BucketAggregate, BTreeMap<String, BucketAggregate>) {
    let mut overall = BucketAggregate::default();
    let mut buckets = BTreeMap::<String, BucketAggregate>::new();
    for row in rows {
        overall.add(row);
        buckets
            .entry(
                row.bucket
                    .clone()
                    .unwrap_or_else(|| "unbucketed".to_owned()),
            )
            .or_default()
            .add(row);
    }
    overall.finalize();
    for bucket in buckets.values_mut() {
        bucket.finalize();
    }
    (overall, buckets)
}

fn summary_markdown(summary: &RunSummary) -> String {
    let mut text = String::new();
    text.push_str("# Topology repair simulation\n\n");
    text.push_str(&format!(
        "Inputs: `{}`\nManifest: `{}`\n\n",
        summary.inputs, summary.manifest
    ));
    text.push_str(
        "| bucket | n | baseline topology | baseline recovered | repaired topology | repaired recovered | gained | lost | median sites |\n\
         | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n",
    );
    let mut rows = summary
        .buckets
        .iter()
        .map(|(name, aggregate)| (name.as_str(), aggregate))
        .collect::<Vec<_>>();
    rows.push(("all", &summary.overall));
    for (name, aggregate) in rows {
        text.push_str(&format!(
            "| {name} | {} | {} | {} | {} | {} | {} | {} | {} |\n",
            aggregate.samples,
            aggregate.baseline_candidate_exact_topology,
            aggregate.baseline_recovered,
            aggregate.repaired_candidate_exact_topology,
            aggregate.repaired_recovered,
            aggregate.gained,
            aggregate.lost,
            aggregate.repair_sites.median,
        ));
    }
    text.push_str(&format!(
        "\nWithin the {}-site hand-repair cap:\n\n",
        summary.config.hand_repair_site_cap
    ));
    text.push_str("| bucket | n | repaired recovered |\n| --- | --- | --- |\n");
    for (name, aggregate) in &summary.within_site_cap {
        text.push_str(&format!(
            "| {name} | {} | {} |\n",
            aggregate.samples, aggregate.repaired_recovered
        ));
    }
    text
}

fn write_reports(
    out: &Path,
    summary: &RunSummary,
    rows: &[SampleRow],
) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(out)?;
    fs::write(
        out.join("summary.json"),
        serde_json::to_string_pretty(summary)? + "\n",
    )?;
    let mut per_sample = String::new();
    for row in rows {
        per_sample.push_str(&serde_json::to_string(row)?);
        per_sample.push('\n');
    }
    fs::write(out.join("per_sample.jsonl"), per_sample)?;
    fs::write(out.join("summary.md"), summary_markdown(summary))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

fn collect_input_paths(root: &Path) -> Result<Vec<PathBuf>, Box<dyn std::error::Error>> {
    let mut paths = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        for entry in fs::read_dir(&directory)? {
            let path = entry?.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                paths.push(path);
            }
        }
    }
    paths.sort();
    Ok(paths)
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

/// Same worktree/`target` guard the sibling benchmarks carry: a binary built in
/// another worktree silently measures different solver code.
fn assert_fresh_binary(allow_stale: bool) {
    let build_commit = option_env!("BUILD_GIT_COMMIT").unwrap_or("");
    let build_dirty = option_env!("BUILD_GIT_DIRTY") == Some("true");
    let runtime_head = git_commit().unwrap_or_default();
    eprintln!(
        "[provenance] simulate_topology_repair built from {}{} | cwd HEAD {}",
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
         --bin simulate_topology_repair) or pass --allow-stale.",
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

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = parse_args()?;
    assert_fresh_binary(args.allow_stale);
    if args.threads > 0 {
        rayon::ThreadPoolBuilder::new()
            .num_threads(args.threads)
            .build_global()?;
    }

    let manifest: Manifest = serde_json::from_str(&fs::read_to_string(&args.manifest)?)?;
    // `gt_graph` resolves against the pack manifest's directory when the
    // dense-cache manifest names one — the same rule the benchmark uses.
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
    let by_id = manifest
        .samples
        .iter()
        .map(|sample| (sample.id.as_str(), sample))
        .collect::<BTreeMap<_, _>>();

    let mut paths = collect_input_paths(&args.inputs)?;
    if let Some(buckets) = &args.buckets {
        paths.retain(|path| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .and_then(|id| by_id.get(id))
                .and_then(|sample| sample.bucket.as_deref())
                .is_some_and(|bucket| buckets.contains(bucket))
        });
    }
    if let Some(limit) = args.limit {
        paths.truncate(limit);
    }
    eprintln!(
        "[repair] {} inputs from {}",
        paths.len(),
        args.inputs.display()
    );

    let started = Instant::now();
    let results = paths
        .par_iter()
        .map(|path| -> Result<SampleRow, String> {
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
            let gt: GroundTruthGraph = serde_json::from_str(
                &fs::read_to_string(manifest_root.join(gt_path))
                    .map_err(|error| format!("{id}: read ground truth: {error}"))?,
            )
            .map_err(|error| format!("{id}: parse ground truth: {error}"))?;
            let input: ExactSolveInput = serde_json::from_str(
                &fs::read_to_string(path).map_err(|error| format!("{id}: read input: {error}"))?,
            )
            .map_err(|error| format!("{id}: parse input: {error}"))?;
            let image_size = input.image_size.or(sample.image_size).unwrap_or(1024);
            let row = process_sample(
                SampleContext {
                    id: &id,
                    bucket: sample.bucket.clone(),
                    input,
                    gt,
                    image_size,
                },
                &args,
            );
            eprintln!(
                "{}",
                serde_json::to_string(&json!({
                    "id": row.id,
                    "bucket": row.bucket,
                    "sites": row.repair_sites,
                    "baseline_recovered": row.baseline_solve.recovered,
                    "repaired_recovered": row.repaired_solve.recovered,
                    "repaired_topology": row.repaired_candidate.exact_topology,
                    "seconds": row.seconds,
                }))
                .unwrap_or_default()
            );
            Ok(row)
        })
        .collect::<Vec<Result<SampleRow, String>>>();

    let mut rows = Vec::new();
    let mut errors = Vec::new();
    for result in results {
        match result {
            Ok(row) => rows.push(row),
            Err(error) => errors.push(error),
        }
    }
    rows.sort_by(|left, right| left.id.cmp(&right.id));
    for error in &errors {
        eprintln!("[repair] error: {error}");
    }

    let (overall, buckets) = aggregate(rows.iter());
    let (cap_overall, mut within_site_cap) = aggregate(
        rows.iter()
            .filter(|row| row.repair_sites <= args.hand_repair_site_cap),
    );
    within_site_cap.insert("all".to_owned(), cap_overall);

    let summary = RunSummary {
        schema: SCHEMA,
        generated_by: "simulate_topology_repair",
        generated_at_unix: now_unix(),
        git_commit: git_commit(),
        inputs: args.inputs.display().to_string(),
        manifest: args.manifest.display().to_string(),
        config: RunConfig {
            strict_vertex_tolerance_px: args.strict_px,
            identify_px: args.repair.identify_px,
            on_edge_px: args.repair.on_edge_px,
            click_jitter_px: args.repair.click_jitter_px,
            fix_assignments: args.repair.fix_assignments,
            exempt_repaired_vertices: args.exempt_repaired_vertices,
            added_span_kind: format!("{:?}", args.repair.added_span_kind),
            exact_solve_timeout_seconds: args.timeout_seconds,
            threads: args.threads,
            hand_repair_site_cap: args.hand_repair_site_cap,
            baseline_solved: !args.skip_baseline,
        },
        sample_count: rows.len(),
        total_seconds: round3(started.elapsed().as_secs_f64()),
        overall,
        buckets,
        within_site_cap,
    };

    write_reports(&args.out, &summary, &rows)?;
    println!("{}", serde_json::to_string_pretty(&summary)?);
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use oristudio_cp_compiler::candidate_graph::{BoundaryModel, BoundaryReconstructionPolicy};
    use oristudio_cp_compiler::{CandidateGraphProvenance, CostModel};

    const IMAGE_SIZE: u32 = 1024;

    fn point(x: f64, y: f64) -> Point2 {
        Point2::new(x, y)
    }

    fn px(x: f64, y: f64) -> [f64; 2] {
        let point = normalized_to_px(Point2::new(x, y), IMAGE_SIZE);
        [point[0], point[1]]
    }

    fn corner(id: usize, at: Point2) -> GraphVertex {
        GraphVertex {
            id,
            point: at,
            kind: CandidateVertexKind::Corner,
            support: 1.0,
            movement_policy: CandidateVertexMovementPolicy::Locked,
            boundary_side: None,
            source_vertex_ids: Vec::new(),
            source_carrier_ids: Vec::new(),
            source_adapter: CandidateSourceAdapter::ArrangementV2,
            provenance: Vec::new(),
        }
    }

    fn interior(id: usize, at: Point2) -> GraphVertex {
        GraphVertex {
            id,
            point: at,
            kind: CandidateVertexKind::InteriorJunction,
            support: 1.0,
            movement_policy: CandidateVertexMovementPolicy::Movable,
            boundary_side: None,
            source_vertex_ids: Vec::new(),
            source_carrier_ids: Vec::new(),
            source_adapter: CandidateSourceAdapter::ArrangementV2,
            provenance: Vec::new(),
        }
    }

    fn span(
        id: usize,
        vertices: [usize; 2],
        a: Point2,
        b: Point2,
        label: AssignmentLabel,
    ) -> CandidateCreaseSpan {
        new_span(id, vertices, a, b, label, &RepairOptions::default())
    }

    fn input_with(vertices: Vec<GraphVertex>, spans: Vec<CandidateCreaseSpan>) -> ExactSolveInput {
        ExactSolveInput {
            schema: "oristudio/cp-compiler/exact-solve-input-v1".to_owned(),
            coordinate_space: "unit_square".to_owned(),
            image_size: Some(IMAGE_SIZE),
            vertices,
            selected_spans: spans,
            boundary: BoundaryModel {
                corners: [0, 1, 2, 3],
                sides: Vec::new(),
                generated_border_span_ids: Vec::new(),
                reconstruction_policy: BoundaryReconstructionPolicy::LockedUnitSquareSortedContacts,
            },
            cost_model: CostModel::default(),
            provenance: CandidateGraphProvenance {
                source_adapter: CandidateSourceAdapter::ArrangementV2,
                source_ids: Vec::new(),
                notes: Vec::new(),
            },
        }
    }

    /// Square paper with the four corners, its border, and one diagonal that
    /// ground truth splits at the centre with a cross through it.
    fn square_corners() -> Vec<GraphVertex> {
        vec![
            corner(0, point(0.0, 0.0)),
            corner(1, point(1.0, 0.0)),
            corner(2, point(1.0, 1.0)),
            corner(3, point(0.0, 1.0)),
        ]
    }

    fn border_spans(next_id: usize) -> Vec<CandidateCreaseSpan> {
        let corners = [
            (point(0.0, 0.0), point(1.0, 0.0), [0, 1]),
            (point(1.0, 0.0), point(1.0, 1.0), [1, 2]),
            (point(1.0, 1.0), point(0.0, 1.0), [2, 3]),
            (point(0.0, 1.0), point(0.0, 0.0), [3, 0]),
        ];
        corners
            .into_iter()
            .enumerate()
            .map(|(offset, (a, b, vertices))| {
                span(next_id + offset, vertices, a, b, AssignmentLabel::Boundary)
            })
            .collect()
    }

    fn gt_square(
        extra_vertices: Vec<[f64; 2]>,
        extra_edges: Vec<([usize; 2], &str)>,
    ) -> GroundTruthGraph {
        let mut vertices_px = vec![px(0.0, 0.0), px(1.0, 0.0), px(1.0, 1.0), px(0.0, 1.0)];
        vertices_px.extend(extra_vertices);
        let mut edges_vertices = vec![[0, 1], [1, 2], [2, 3], [3, 0]];
        let mut labels = vec![
            Value::String("B".to_owned()),
            Value::String("B".to_owned()),
            Value::String("B".to_owned()),
            Value::String("B".to_owned()),
        ];
        for (edge, label) in extra_edges {
            edges_vertices.push(edge);
            labels.push(Value::String(label.to_owned()));
        }
        GroundTruthGraph {
            vertices_px,
            edges_vertices,
            edges_assignment_labels: labels,
            edges_assignment: Vec::new(),
        }
    }

    #[test]
    fn split_gt_edges_splits_at_a_vertex_on_the_interior() {
        // A border edge with a boundary-contact vertex sitting on it: the eval
        // canonicalizes that into two segments, so the repair target must too.
        let gt = gt_square(vec![px(0.5, 0.0)], vec![([4, 4], "M")]);
        let target = split_gt_edges(&gt, 2.0);
        let has_left = target
            .iter()
            .any(|edge| edge.vertices == [0, 4] || edge.vertices == [4, 0]);
        let has_right = target
            .iter()
            .any(|edge| edge.vertices == [4, 1] || edge.vertices == [1, 4]);
        assert!(has_left && has_right, "{target:?}");
        assert!(
            !target
                .iter()
                .any(|edge| edge.vertices == [0, 1] || edge.vertices == [1, 0]),
            "the whole border edge should not survive the split"
        );
    }

    #[test]
    fn missed_junction_is_repaired_by_inserting_and_splitting() {
        // The candidate has one diagonal running corner to corner; ground truth
        // has the same diagonal but split at the centre, where a second crease
        // crosses it. This is the plan's dominant defect: one missed junction
        // costing four missing edges and two extra ones.
        let mut vertices = square_corners();
        let mut spans = border_spans(0);
        spans.push(span(
            4,
            [0, 2],
            point(0.0, 0.0),
            point(1.0, 1.0),
            AssignmentLabel::Mountain,
        ));
        spans.push(span(
            5,
            [1, 3],
            point(1.0, 0.0),
            point(0.0, 1.0),
            AssignmentLabel::Valley,
        ));
        vertices.iter_mut().for_each(|vertex| {
            vertex.kind = CandidateVertexKind::Corner;
        });
        let input = input_with(vertices, spans);

        let gt = gt_square(
            vec![px(0.5, 0.5)],
            vec![([0, 4], "M"), ([4, 2], "M"), ([1, 4], "V"), ([4, 3], "V")],
        );
        let repaired = repair_candidate(&input, &gt, IMAGE_SIZE, &RepairOptions::default(), 7);

        assert_eq!(repaired.edits.inserted_vertices, 1);
        assert_eq!(
            repaired.edits.added_spans, 0,
            "both diagonals are split, not drawn"
        );
        assert_eq!(repaired.edits.split_spans, 4);
        assert_eq!(repaired.edits.deleted_spans, 0);
        assert_eq!(repaired.input.vertices.len(), 5);
        assert_eq!(repaired.input.selected_spans.len(), 8);
        // The inserted vertex snapped to the intersection of the two diagonals.
        let inserted = &repaired.input.vertices[4];
        assert!((inserted.point.x - 0.5).abs() < 1e-9);
        assert!((inserted.point.y - 0.5).abs() < 1e-9);
        assert!(repaired.exempt_vertex_ids.contains(&4));
        // One junction, one site.
        assert_eq!(repaired.add_sites + repaired.delete_sites, 1);
    }

    #[test]
    fn repaired_graph_recovers_ground_truth_topology_and_solves() {
        let mut spans = border_spans(0);
        spans.push(span(
            4,
            [0, 2],
            point(0.0, 0.0),
            point(1.0, 1.0),
            AssignmentLabel::Mountain,
        ));
        spans.push(span(
            5,
            [1, 3],
            point(1.0, 0.0),
            point(0.0, 1.0),
            AssignmentLabel::Valley,
        ));
        let input = input_with(square_corners(), spans);
        let gt = gt_square(
            vec![px(0.5, 0.5)],
            vec![([0, 4], "M"), ([4, 2], "M"), ([1, 4], "V"), ([4, 3], "V")],
        );
        let repaired = repair_candidate(&input, &gt, IMAGE_SIZE, &RepairOptions::default(), 7);

        let gt_graph = gt.eval_graph();
        let before = topology_summary(&input, &gt_graph, IMAGE_SIZE, 2.0);
        let after = topology_summary(&repaired.input, &gt_graph, IMAGE_SIZE, 2.0);
        assert!(
            !before.exact_topology,
            "the unrepaired candidate misses the junction"
        );
        assert!(after.exact_topology_and_assignment, "{after:?}");

        let outcome = solve_and_score(
            &repaired.input,
            &gt_graph,
            IMAGE_SIZE,
            &ExactSolveOptionsWithExemptions {
                options: ExactSolveOptions::default(),
                exempt_vertex_ids: repaired.exempt_vertex_ids.clone(),
            },
            2.0,
        );
        assert!(outcome.accepted, "{outcome:?}");
        assert!(outcome.recovered, "{outcome:?}");
    }

    #[test]
    fn a_spurious_crease_is_deleted_and_a_missing_one_is_drawn() {
        // No candidate span lies along the missing crease, so it has to be
        // drawn from scratch (verb 2); the spurious one has no ground-truth
        // counterpart, so it is deleted (verb 4).
        let mut vertices = square_corners();
        vertices.push(interior(4, point(0.5, 0.25)));
        vertices.push(interior(5, point(0.5, 0.75)));
        let mut spans = border_spans(0);
        spans.push(span(
            4,
            [4, 5],
            point(0.5, 0.25),
            point(0.5, 0.75),
            AssignmentLabel::Mountain,
        ));
        let input = input_with(vertices, spans);

        // Ground truth keeps neither endpoint: it has one horizontal crease
        // between two boundary contacts instead.
        let gt = gt_square(vec![px(0.0, 0.5), px(1.0, 0.5)], vec![([4, 5], "V")]);
        let repaired = repair_candidate(&input, &gt, IMAGE_SIZE, &RepairOptions::default(), 11);

        assert_eq!(repaired.edits.deleted_spans, 1);
        assert_eq!(repaired.edits.added_spans, 1);
        assert_eq!(repaired.edits.inserted_vertices, 2);
        assert_eq!(repaired.edits.deleted_vertices, 2);
        let after = topology_summary(&repaired.input, &gt.eval_graph(), IMAGE_SIZE, 2.0);
        assert!(after.exact_topology_and_assignment, "{after:?}");
    }

    #[test]
    fn relabelling_moves_the_boundary_role_with_the_label() {
        let mut spans = border_spans(0);
        spans.push(span(
            4,
            [0, 2],
            point(0.0, 0.0),
            point(1.0, 1.0),
            // The detector called the diagonal a paper boundary, which excludes
            // it from every local theorem until the label is fixed.
            AssignmentLabel::Boundary,
        ));
        let input = input_with(square_corners(), spans);
        let gt = gt_square(vec![], vec![([0, 2], "M")]);
        let repaired = repair_candidate(&input, &gt, IMAGE_SIZE, &RepairOptions::default(), 3);

        assert_eq!(repaired.edits.relabelled_spans, 1);
        let diagonal = repaired
            .input
            .selected_spans
            .iter()
            .find(|span| span.vertices == [0, 2] || span.vertices == [2, 0])
            .expect("diagonal survives");
        assert_eq!(diagonal.assignment_label(), AssignmentLabel::Mountain);
        assert_eq!(diagonal.boundary_role(), CandidateCreaseBoundaryRole::None);
    }

    #[test]
    fn an_inserted_vertex_never_snaps_onto_an_existing_one() {
        // Ground truth holds two junctions ~1px apart on the same diagonal and
        // detection found only one. Projecting the second click onto the
        // diagonal would land it on the first, drawing a zero-length crease
        // that blocks the whole solve at preflight.
        let mut vertices = square_corners();
        vertices.push(interior(4, point(0.5, 0.5)));
        let mut spans = border_spans(0);
        spans.push(span(
            4,
            [0, 4],
            point(0.0, 0.0),
            point(0.5, 0.5),
            AssignmentLabel::Mountain,
        ));
        spans.push(span(
            5,
            [4, 2],
            point(0.5, 0.5),
            point(1.0, 1.0),
            AssignmentLabel::Mountain,
        ));
        let input = input_with(vertices, spans);

        let neighbour = 0.5 + 1.0 / px_span(IMAGE_SIZE);
        let gt = gt_square(
            vec![px(0.5, 0.5), px(neighbour, neighbour)],
            vec![([0, 4], "M"), ([4, 5], "M"), ([5, 2], "M")],
        );
        let repaired = repair_candidate(&input, &gt, IMAGE_SIZE, &RepairOptions::default(), 5);

        assert_eq!(repaired.edits.inserted_vertices, 1);
        let inserted = &repaired.input.vertices[5];
        let existing = repaired.input.vertices[4].point;
        assert!(
            distance(inserted.point, existing) > COINCIDENT_VERTEX_PX / px_span(IMAGE_SIZE) * 0.9,
            "inserted vertex collapsed onto the existing one: {inserted:?} vs {existing:?}"
        );
        assert!(
            analyze_candidate_topology(&repaired.input)
                .combinatorial
                .degenerate_edges
                .is_empty()
        );
    }

    #[test]
    fn repair_sites_count_connected_components_not_edges() {
        // Two separate stars: four edges each, but two repair sites.
        let pairs = [[0, 1], [0, 2], [0, 3], [0, 4], [5, 6], [5, 7], [5, 8]];
        assert_eq!(count_sites(&pairs, &[], 9), 2);
        // A lone inserted vertex with no added edge is its own site.
        assert_eq!(count_sites(&pairs, &[9], 10), 3);
        // ...but one that an added edge already covers is not counted twice.
        assert_eq!(count_sites(&pairs, &[0], 9), 2);
    }

    #[test]
    fn click_jitter_still_lands_on_the_crossing() {
        let mut spans = border_spans(0);
        spans.push(span(
            4,
            [0, 2],
            point(0.0, 0.0),
            point(1.0, 1.0),
            AssignmentLabel::Mountain,
        ));
        spans.push(span(
            5,
            [1, 3],
            point(1.0, 0.0),
            point(0.0, 1.0),
            AssignmentLabel::Valley,
        ));
        let input = input_with(square_corners(), spans);
        let gt = gt_square(
            vec![px(0.5, 0.5)],
            vec![([0, 4], "M"), ([4, 2], "M"), ([1, 4], "V"), ([4, 3], "V")],
        );
        let options = RepairOptions {
            click_jitter_px: 1.5,
            ..RepairOptions::default()
        };
        let repaired = repair_candidate(&input, &gt, IMAGE_SIZE, &options, 12345);
        let inserted = &repaired.input.vertices[4];
        // The click was off, but it snapped back to the intersection.
        assert!((inserted.point.x - 0.5).abs() < 1e-9, "{inserted:?}");
        assert!((inserted.point.y - 0.5).abs() < 1e-9, "{inserted:?}");
    }
}
