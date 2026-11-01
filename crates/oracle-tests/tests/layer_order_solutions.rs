//! The Layer order dialog's solution count, stepper and explanations
//! (`oristudio_fold::steer::{Solutions, ConstraintSession::explain}`,
//! `implementation-plans/layer-order-dialog.md` row E6) over real designs.
//!
//! Each design is folded as Edit folds a whole sheet, and each one Oriedita
//! folds flat and `LayerSource::from_oriedita` admits is opened as the dialog
//! opens it. Then:
//!
//! 1. its solutions are **counted** with no constraints, in one call with a
//!    deadline (`LAYER_ORDER_COUNT_MS`, 10 s by default): the time, the
//!    tallies, and whether a cap or the deadline left them "at least";
//! 2. when that took under 2 s, counted again in **slices** of 1,000 nodes,
//!    which must end equal to the one call, every slice's tallies at most
//!    the final ones;
//! 3. the **stepper** steps forward and back through pictures from the
//!    front, and with X-ray through layer orders, each step's index one
//!    away from the last when the count is exact;
//! 4. three constraints are committed as the session census commits them
//!    (`layer_order_session.rs`), and the count runs again;
//! 5. up to three candidates that can't fit are **explained**, and each set
//!    is checked on a second session: it can't fit, and without any one
//!    member it fits.
//!
//! # Where it runs
//!
//! - **CI**: the fixtures (kabuto, `solution_sample_1`, Oriedita's
//!   `colorconstrainttest`), held to every gate and to their counts.
//! - **Locally, in release**, with `LAYER_ORDER_CENSUS_DIR` naming a corpus of
//!   `<case>/truth.fold`: the fixtures, `precrease/iguana-c0.fold` and every
//!   case, a row per design, and a CSV and a summary written to
//!   `artifacts/layer-order-solutions/` (`LAYER_ORDER_SOLUTIONS_OUT` moves
//!   it):
//!
//!   ```sh
//!   LAYER_ORDER_CENSUS_DIR=/path/to/cpoogle \
//!     cargo test -p oracle-tests --release --test layer_order_solutions -- --nocapture
//!   ```
//!
//!   `LAYER_ORDER_CENSUS_JOBS=n` runs `n` designs at once and
//!   `LAYER_ORDER_CENSUS_ONLY=a,b` keeps the cases whose name contains one of
//!   the strings, as for the other censuses.
//!
//! Corpus files are never committed or copied in, and no case is named in a
//! committed file (`tests/corpus/README.md`).

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use oristudio_cp::folding::{EstimationOrder, FoldOutcome, FoldedFigureModel};
use oristudio_cp::session::CpSession;
use oristudio_fold::complete::Deadline;
use oristudio_fold::steer::{
    Commit, Constraint, ConstraintSession, CountShape, Explanation, LayerSource, Limits, Preview,
    SolutionCount, StepBy, StepDirection, Stepped, Verb, ViewSide,
};
use oristudio_layer_order::FacePair;

const CORPUS_ENV: &str = "LAYER_ORDER_CENSUS_DIR";
const OUT_ENV: &str = "LAYER_ORDER_SOLUTIONS_OUT";
const JOBS_ENV: &str = "LAYER_ORDER_CENSUS_JOBS";
const ONLY_ENV: &str = "LAYER_ORDER_CENSUS_ONLY";
const COUNT_MS_ENV: &str = "LAYER_ORDER_COUNT_MS";

/// Constraints committed per design.
const STEPS: usize = 3;
/// Candidates explained per design, and how many pairs are tried for them.
const EXPLAINED: usize = 3;
const TRIED: usize = 60;

const FIXTURES: &[(&str, &str)] = &[
    ("kabuto", "tests/fixtures/flat-folder/kabuto.fold"),
    (
        "solution_sample_1",
        "tests/fixtures/oriedita/solution_sample_1.cp",
    ),
    (
        "colorconstrainttest",
        "third_party/oriedita/oriedita-data/src/test/resources/colorconstrainttest.cp",
    ),
];

const IGUANA: (&str, &str) = ("iguana-c0", "tests/fixtures/precrease/iguana-c0.fold");

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn now_ms() -> f64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1e3
}

fn limits_for(ms: f64) -> Limits {
    Limits {
        max_nodes: None,
        deadline: Some(Deadline {
            now_ms,
            at_ms: now_ms() + ms,
        }),
        ..Limits::default()
    }
}

fn elapsed_ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1e3
}

fn count_ms() -> f64 {
    std::env::var(COUNT_MS_ENV)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10_000.0)
}

/// One count: how long, what it found, and why it is not exact.
#[derive(Debug, Clone, Default)]
struct Counted {
    ms: f64,
    count: Option<SolutionCount>,
    nodes: u64,
    shape: Option<CountShape>,
}

impl Counted {
    /// `exact`, `cap` (done, a tally at least) or `deadline`.
    fn reason(&self) -> &'static str {
        match self.count {
            None => "refused",
            Some(c) if !c.done => "deadline",
            Some(c) if c.front.exact && c.back.exact && c.orders.exact => "exact",
            Some(c) if c.front.exact && c.back.exact => "exact pictures",
            Some(_) => "cap",
        }
    }

    fn pictures(&self) -> String {
        match self.count {
            Some(c) => format!(
                "{}{} / {}{} pictures, {}{} orders",
                if c.front.exact { "" } else { "≥" },
                c.front.n,
                if c.back.exact { "" } else { "≥" },
                c.back.n,
                if c.orders.exact { "" } else { "≥" },
                c.orders.n
            ),
            None => "no count".to_string(),
        }
    }
}

/// What one design gave.
#[derive(Debug, Clone, Default)]
struct Row {
    name: String,
    group: &'static str,
    /// `ok`, or why the design is outside the census.
    status: String,
    faces: usize,
    pairs: usize,
    open_ms: f64,
    open: Counted,
    sliced: Option<usize>,
    step_ms: Vec<f64>,
    constraints: usize,
    constrained: Counted,
    explain_ms: Vec<f64>,
    /// Per explanation: the check's set, the smallest set, minimal.
    explained: Vec<(usize, usize, bool)>,
    failures: Vec<String>,
}

impl Row {
    fn admitted(&self) -> bool {
        self.status == "ok"
    }

    fn passes(&self) -> bool {
        self.admitted() && self.failures.is_empty()
    }

    const CSV_HEADER: &'static str = "name,group,status,faces,pairs,open_ms,count_ms,count_reason,\
front,front_exact,back,back_exact,orders,orders_exact,nodes,components,largest_component,\
open_spots_front,groups_front,joined_groups,slices,step_ms_max,constraints,constrained_count_ms,\
constrained_reason,constrained_front,explained,explain_ms_max,failures";

    fn csv(&self) -> String {
        let clean = |s: &str| s.replace([',', '\n'], ";");
        let c = self.open.count;
        let shape = self.open.shape;
        format!(
            "{},{},{},{},{},{:.1},{:.1},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{:.1},{},{:.1},{},{},{},{:.1},{}",
            clean(&self.name),
            self.group,
            clean(&self.status),
            self.faces,
            self.pairs,
            self.open_ms,
            self.open.ms,
            self.open.reason(),
            c.map_or(0, |c| c.front.n),
            c.is_some_and(|c| c.front.exact),
            c.map_or(0, |c| c.back.n),
            c.is_some_and(|c| c.back.exact),
            c.map_or(0, |c| c.orders.n),
            c.is_some_and(|c| c.orders.exact),
            self.open.nodes,
            shape.map_or(0, |s| s.components),
            shape.map_or(0, |s| s.largest_component),
            shape.map_or(0, |s| s.open_spots[0]),
            shape.map_or(0, |s| s.groups[0]),
            shape.map_or(0, |s| s.joined_groups[0] + s.joined_groups[1]),
            self.sliced.map_or(String::new(), |n| n.to_string()),
            max(&self.step_ms),
            self.constraints,
            self.constrained.ms,
            self.constrained.reason(),
            self.constrained.count.map_or(0, |c| c.front.n),
            self.explained.len(),
            max(&self.explain_ms),
            clean(&self.failures.join(" ")),
        )
    }

    fn line(&self) -> String {
        if !self.admitted() {
            return format!("{}: {}", self.name, self.status);
        }
        format!(
            "{}: {} faces, {} pairs; count {:.0} ms ({}, {}); {} constraints, count {:.0} ms \
             ({}, {}); {} explained, max {:.1} ms; steps max {:.1} ms; {}",
            self.name,
            self.faces,
            self.pairs,
            self.open.ms,
            self.open.reason(),
            self.open.pictures(),
            self.constraints,
            self.constrained.ms,
            self.constrained.reason(),
            self.constrained.pictures(),
            self.explained.len(),
            max(&self.explain_ms),
            max(&self.step_ms),
            if self.failures.is_empty() {
                "pass".to_string()
            } else {
                format!("FAIL {}", self.failures.join(" "))
            },
        )
    }
}

fn max(values: &[f64]) -> f64 {
    values.iter().copied().fold(0.0, f64::max)
}

/// The nearest-rank percentile.
fn percentile(values: &[f64], p: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let rank = ((p * sorted.len() as f64).ceil() as usize).clamp(1, sorted.len());
    Some(sorted[rank - 1])
}

fn open_document(cp: &mut CpSession, path: &Path) -> Result<u32, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("read: {e}"))?;
    let loaded = match path.extension().and_then(|e| e.to_str()) {
        Some("cp") => cp.load_cp(&text, ""),
        Some("fold") => cp.load_fold(&text, ""),
        other => return Err(format!("no loader for {other:?}")),
    };
    loaded.map_err(|e| e.code.to_string())
}

/// The constraint that reverses the order on screen on `pair`.
fn against_shown(session: &ConstraintSession, pair: FacePair) -> Option<Constraint> {
    let lo_above = session.shown_order().above(pair.lo(), pair.hi())?;
    let (subject, object) = if lo_above {
        (pair.hi(), pair.lo())
    } else {
        (pair.lo(), pair.hi())
    };
    Constraint::seen(
        subject,
        Verb::InFrontOf,
        object,
        ViewSide::Front,
        session.source().view(),
    )
}

/// The constraint that keeps the order on screen on `pair`.
fn with_shown(session: &ConstraintSession, pair: FacePair) -> Option<Constraint> {
    // The sentence the other way round: a sign is read against its object's
    // side, so swapping subject and object alone would not reverse it.
    let c = against_shown(session, pair)?;
    Constraint::seen(
        c.object,
        Verb::InFrontOf,
        c.subject,
        ViewSide::Front,
        session.source().view(),
    )
}

/// Count `session`'s solutions in one call within the census deadline.
fn count_once(session: &ConstraintSession, row: &mut Row) -> Counted {
    let t = Instant::now();
    let mut solutions = match session.solutions() {
        Ok(solutions) => solutions,
        Err(e) => {
            row.failures.push(format!("solutions {}", e.code()));
            return Counted::default();
        }
    };
    let count = solutions.advance(session, &limits_for(count_ms()));
    let ms = elapsed_ms(t);
    match count {
        Ok(count) => Counted {
            ms,
            count: Some(count),
            nodes: solutions.nodes(),
            shape: Some(solutions.shape()),
        },
        Err(e) => {
            row.failures.push(format!("count {}", e.code()));
            Counted::default()
        }
    }
}

fn census(name: &str, group: &'static str, path: &Path) -> Row {
    let mut row = Row {
        name: name.to_string(),
        group,
        ..Row::default()
    };
    let mut cp = CpSession::new();
    let document = match open_document(&mut cp, path) {
        Ok(document) => document,
        Err(e) => {
            row.status = format!("unreadable {e}");
            return row;
        }
    };
    let lines: Vec<usize> = match cp.document_summary(document) {
        Ok(summary) => (1..=summary.line_segments).collect(),
        Err(e) => {
            row.status = e.code.to_string();
            return row;
        }
    };
    let folded = match cp.folded_figure_fold_selected(
        document,
        &lines,
        1,
        EstimationOrder::Order5,
        FoldedFigureModel::default(),
    ) {
        Ok(folded) => folded,
        Err(e) => {
            row.status = e.code.to_string();
            return row;
        }
    };
    if folded.snapshot.outcome != FoldOutcome::Solved {
        row.status = format!("oriedita {:?}", folded.snapshot.outcome).to_lowercase();
        return row;
    }
    let fold = match cp.folded_figure_source(folded.handle, Some(document)) {
        Ok(fold) => fold,
        Err(e) => {
            row.status = format!("no source {}", e.code);
            return row;
        }
    };
    let source = match LayerSource::from_oriedita(&fold) {
        Ok(source) => source,
        Err(refusal) => {
            row.status = refusal.code().to_string();
            return row;
        }
    };
    row.faces = source.view().faces().len();
    row.pairs = source.problem().variables().len();
    let t = Instant::now();
    let session = ConstraintSession::open(source, &limits_for(120_000.0));
    row.open_ms = elapsed_ms(t);
    let mut session = match session {
        Ok(session) => session,
        Err(refusal) => {
            row.status = refusal.code().to_string();
            return row;
        }
    };
    row.status = "ok".to_string();

    // 1. The count, in one call.
    row.open = count_once(&session, &mut row);

    // 2. In slices, when the one call was short: the same end, and never
    // more on the way.
    if let Some(whole) = row.open.count.filter(|c| c.done && row.open.ms < 2_000.0) {
        match session.solutions() {
            Ok(mut solutions) => {
                let slice = Limits {
                    max_nodes: Some(1_000),
                    ..Limits::default()
                };
                let mut slices = 0;
                loop {
                    slices += 1;
                    let Ok(so_far) = solutions.advance(&session, &slice) else {
                        row.failures.push("slice_refused".to_string());
                        break;
                    };
                    for (tally, last) in [
                        (so_far.front, whole.front),
                        (so_far.back, whole.back),
                        (so_far.orders, whole.orders),
                    ] {
                        if tally.n > last.n || (tally.exact && tally != last) {
                            row.failures.push("slice_above".to_string());
                        }
                    }
                    if so_far.done {
                        if so_far != whole {
                            row.failures.push("sliced_differs".to_string());
                        }
                        break;
                    }
                    if slices > 1_000_000 {
                        row.failures.push("slices_unbounded".to_string());
                        break;
                    }
                }
                row.sliced = Some(slices);
            }
            Err(e) => row.failures.push(format!("solutions {}", e.code())),
        }
    }

    // 3. The stepper, forward and back, and with X-ray.
    if let Ok(mut solutions) = session.solutions() {
        let _ = solutions.advance(&session, &limits_for(count_ms()));
        let plan = [
            (StepBy::Picture(ViewSide::Front), StepDirection::Next),
            (StepBy::Picture(ViewSide::Front), StepDirection::Next),
            (StepBy::Picture(ViewSide::Front), StepDirection::Previous),
            (StepBy::Picture(ViewSide::Front), StepDirection::Previous),
            (StepBy::LayerOrder, StepDirection::Next),
            (StepBy::LayerOrder, StepDirection::Previous),
        ];
        for (by, direction) in plan {
            let Ok(before) = session.position(&solutions, by) else {
                row.failures.push("position_refused".to_string());
                break;
            };
            let t = Instant::now();
            let stepped = session.step(&mut solutions, by, direction, &limits_for(5_000.0));
            row.step_ms.push(elapsed_ms(t));
            match stepped {
                Ok(Stepped::Moved(moved)) if before.total.exact => {
                    let expected = match direction {
                        StepDirection::Next => before.index + 1,
                        StepDirection::Previous => before.index - 1,
                    };
                    if moved.position.index != expected {
                        row.failures.push(format!("step_index {by:?}"));
                    }
                }
                Ok(Stepped::End) if before.total.exact && solutions.is_done() => {
                    let at_end = match direction {
                        StepDirection::Next => before.index == before.total.n,
                        StepDirection::Previous => before.index == 1,
                    };
                    if !at_end {
                        row.failures.push(format!("step_end {by:?}"));
                    }
                }
                Ok(_) => {}
                Err(e) => row.failures.push(format!("step {}", e.code())),
            }
        }
    }

    // 4. Constraints, as the session census commits them, and the count
    // again.
    for step in 0..STEPS {
        let open = session.open_pairs();
        if open.is_empty() {
            break;
        }
        let pair = open[step * open.len() / STEPS % open.len()];
        let (Some(against), Some(keep)) =
            (against_shown(&session, pair), with_shown(&session, pair))
        else {
            break;
        };
        let mut list = session.constraints().to_vec();
        list.push(against);
        if !matches!(
            session.commit(list, &limits_for(30_000.0)),
            Ok(Commit::Committed(_))
        ) {
            let mut list = session.constraints().to_vec();
            list.push(keep);
            if !matches!(
                session.commit(list, &limits_for(30_000.0)),
                Ok(Commit::Committed(_))
            ) {
                row.failures.push(format!("s{step}:commit"));
                break;
            }
        }
    }
    row.constraints = session.constraints().len();
    row.constrained = count_once(&session, &mut row);

    // 5. Explain candidates that can't fit, each checked on a second
    // session.
    let checker = LayerSource::from_oriedita(&fold)
        .ok()
        .and_then(|source| ConstraintSession::open(source, &limits_for(120_000.0)).ok());
    let Some(mut checker) = checker else {
        row.failures.push("checker".to_string());
        return row;
    };
    let pairs: Vec<FacePair> = session.shown_order().pairs().map(|(p, _)| p).collect();
    let stride = (pairs.len() / TRIED).max(1);
    for &pair in pairs.iter().step_by(stride).take(TRIED) {
        if row.explained.len() >= EXPLAINED {
            break;
        }
        let Some(candidate) = against_shown(&session, pair) else {
            continue;
        };
        let Ok(Preview::CantFit(cant)) = session.preview(candidate, &limits_for(10_000.0)) else {
            continue;
        };
        let t = Instant::now();
        let explained = session.explain(candidate, &limits_for(10_000.0));
        row.explain_ms.push(elapsed_ms(t));
        let clash = match explained {
            Ok(Explanation::Clash(clash)) => clash,
            other => {
                row.failures.push(format!("explain {other:?}"));
                continue;
            }
        };
        let mut list = session.constraints().to_vec();
        list.push(candidate);
        if !clash.constraints.contains(&(list.len() - 1)) {
            row.failures.push("explain_without_candidate".to_string());
        }
        let set: Vec<Constraint> = clash.constraints.iter().map(|&i| list[i]).collect();
        let fits = |checker: &mut ConstraintSession, list: Vec<Constraint>| -> Option<bool> {
            let answer = match checker.commit(list, &limits_for(30_000.0)) {
                Ok(Commit::Committed(_)) => Some(true),
                Ok(Commit::CantFit(_)) => Some(false),
                _ => None,
            };
            let _ = checker.commit(Vec::new(), &limits_for(30_000.0));
            answer
        };
        if fits(&mut checker, set.clone()) != Some(false) {
            row.failures.push("explain_set_fits".to_string());
        }
        if clash.minimal {
            for drop in 0..set.len() {
                let mut without = set.clone();
                without.remove(drop);
                if fits(&mut checker, without) != Some(true) {
                    row.failures.push("explain_not_minimal".to_string());
                }
            }
        }
        row.explained.push((
            cant.constraints.len(),
            clash.constraints.len(),
            clash.minimal,
        ));
    }
    row
}

fn rows_of(designs: &[(String, &'static str, PathBuf)], jobs: usize) -> Vec<Row> {
    let next = AtomicUsize::new(0);
    let rows = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..jobs {
            let worker = std::thread::Builder::new()
                .stack_size(256 << 20)
                .spawn_scoped(scope, || {
                    loop {
                        let i = next.fetch_add(1, Ordering::SeqCst);
                        let Some((name, group, path)) = designs.get(i) else {
                            break;
                        };
                        let row = census(name, group, path);
                        println!("[{}/{}] {}", i + 1, designs.len(), row.line());
                        if let Ok(mut rows) = rows.lock() {
                            rows.push((i, row));
                        }
                    }
                });
            assert!(worker.is_ok(), "spawn a census worker");
        }
    });
    let mut rows = rows.into_inner().unwrap_or_default();
    rows.sort_by_key(|(i, _)| *i);
    rows.into_iter().map(|(_, row)| row).collect()
}

/// Every gate on the fixtures, in CI, and their counts: what brute force
/// gives (the unit tests in `oristudio-fold`'s `steer::solutions`).
#[test]
fn the_solutions_pass_every_gate_on_the_fixtures() {
    let designs: Vec<(String, &'static str, PathBuf)> = FIXTURES
        .iter()
        .map(|(name, relative)| (name.to_string(), "fixture", repo_root().join(relative)))
        .collect();
    let counts: BTreeMap<String, (u64, u64, u64)> = rows_of(&designs, 1)
        .into_iter()
        .map(|row| {
            assert!(row.passes(), "{row:#?}");
            assert_eq!(row.open.reason(), "exact", "{}", row.name);
            let c = row.open.count.unwrap_or_else(|| panic!("{}", row.name));
            (row.name, (c.front.n, c.back.n, c.orders.n))
        })
        .collect();
    assert_eq!(counts["kabuto"], (9, 1, 9));
    assert_eq!(counts["solution_sample_1"], (1, 16, 16));
    assert_eq!(counts["colorconstrainttest"], (12, 2, 22));
}

/// The local census: the fixtures, the iguana and a corpus.
#[test]
fn the_local_solutions_census() {
    let Some(dir) = std::env::var_os(CORPUS_ENV) else {
        println!(
            "SKIPPED: the_local_solutions_census\n  {CORPUS_ENV} is not set, so the iguana and \
             the corpus were not run.\n  Run it in release: {CORPUS_ENV}=/path/to/cpoogle cargo \
             test -p oracle-tests --release --test layer_order_solutions -- --nocapture"
        );
        return;
    };
    let dir = PathBuf::from(dir);
    assert!(
        dir.is_dir(),
        "{CORPUS_ENV} names no directory: {}",
        dir.display()
    );
    let only: Vec<String> = std::env::var(ONLY_ENV)
        .map(|v| v.split(',').map(str::to_string).collect())
        .unwrap_or_default();
    let jobs: usize = std::env::var(JOBS_ENV)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1)
        .max(1);
    let mut designs: Vec<(String, &'static str, PathBuf)> = FIXTURES
        .iter()
        .map(|(name, relative)| (name.to_string(), "fixture", repo_root().join(relative)))
        .collect();
    designs.push((IGUANA.0.to_string(), "iguana", repo_root().join(IGUANA.1)));
    let mut cases: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map(|entries| entries.filter_map(|e| e.ok().map(|e| e.path())).collect())
        .unwrap_or_default();
    cases.sort();
    for case in cases {
        let truth = case.join("truth.fold");
        if !truth.is_file() {
            continue;
        }
        let name = case
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if !only.is_empty() && !only.iter().any(|o| name.contains(o.as_str())) {
            continue;
        }
        designs.push((name, "corpus", truth));
    }
    let rows = rows_of(&designs, jobs);

    let out = std::env::var_os(OUT_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|| repo_root().join("artifacts/layer-order-solutions"));
    std::fs::create_dir_all(&out).expect("create the report directory");
    let mut csv = String::from(Row::CSV_HEADER);
    csv.push('\n');
    for row in &rows {
        csv.push_str(&row.csv());
        csv.push('\n');
    }
    std::fs::write(out.join("designs.csv"), csv).expect("write designs.csv");
    let summary = summary(&rows, jobs);
    std::fs::write(out.join("summary.md"), &summary).expect("write summary.md");
    println!("{summary}");
    println!("report: {}", out.display());
}

fn summary(rows: &[Row], jobs: usize) -> String {
    let mut s = String::new();
    let admitted: Vec<&Row> = rows.iter().filter(|r| r.admitted()).collect();
    let passed = admitted.iter().filter(|r| r.passes()).count();
    let outside: BTreeMap<&str, usize> =
        rows.iter()
            .filter(|r| !r.admitted())
            .fold(BTreeMap::new(), |mut m, r| {
                *m.entry(r.status.as_str()).or_default() += 1;
                m
            });
    let corpus: Vec<&Row> = admitted
        .iter()
        .copied()
        .filter(|r| r.group == "corpus")
        .collect();
    let stat = |values: Vec<f64>| -> String {
        format!(
            "{:.1} / {:.1} / {:.1}",
            percentile(&values, 0.5).unwrap_or(0.0),
            percentile(&values, 0.95).unwrap_or(0.0),
            max(&values)
        )
    };
    let reasons = |pick: &dyn Fn(&Row) -> &Counted| -> BTreeMap<&'static str, usize> {
        corpus.iter().fold(BTreeMap::new(), |mut m, r| {
            *m.entry(pick(r).reason()).or_default() += 1;
            m
        })
    };
    let _ = writeln!(s, "# Layer order solutions census\n");
    let _ = writeln!(
        s,
        "{} designs, {} jobs, a count deadline of {:.0} ms; {} admitted, {} pass every gate; \
         outside: {:?}\n",
        rows.len(),
        jobs,
        count_ms(),
        admitted.len(),
        passed,
        outside
    );
    let failing: Vec<String> = admitted
        .iter()
        .filter(|r| !r.passes())
        .map(|r| format!("{}: {}", r.name, r.failures.join(" ")))
        .collect();
    if !failing.is_empty() {
        let _ = writeln!(s, "Failing:\n\n- {}\n", failing.join("\n- "));
    }
    let _ = writeln!(
        s,
        "Corpus counts, no constraints: {:?}; with constraints: {:?}\n",
        reasons(&|r| &r.open),
        reasons(&|r| &r.constrained)
    );
    let joined: usize = corpus
        .iter()
        .filter_map(|r| r.open.shape)
        .map(|s| s.joined_groups[0] + s.joined_groups[1])
        .sum();
    let sliced = corpus.iter().filter(|r| r.sliced.is_some()).count();
    let explained: Vec<(usize, usize, bool)> =
        corpus.iter().flat_map(|r| r.explained.clone()).collect();
    let shrunk = explained.iter().filter(|(a, b, _)| b < a).count();
    let minimal = explained.iter().filter(|(_, _, m)| *m).count();
    let _ = writeln!(
        s,
        "Look groups of more than one component: {joined}. Counted again in slices: {sliced} \
         designs, every one equal. Explained: {} candidates, {minimal} minimal, {shrunk} smaller \
         than the check's set.\n",
        explained.len()
    );
    let _ = writeln!(s, "| Corpus (p50 / p95 / max) | |\n| --- | --- |");
    let _ = writeln!(
        s,
        "| count, no constraints, ms | {} |",
        stat(corpus.iter().map(|r| r.open.ms).collect())
    );
    let _ = writeln!(
        s,
        "| count, with constraints, ms | {} |",
        stat(corpus.iter().map(|r| r.constrained.ms).collect())
    );
    let _ = writeln!(
        s,
        "| pictures from the front (exact counts) | {} |",
        stat(
            corpus
                .iter()
                .filter_map(|r| r.open.count)
                .filter(|c| c.front.exact)
                .map(|c| c.front.n as f64)
                .collect()
        )
    );
    let _ = writeln!(
        s,
        "| layer orders (exact counts) | {} |",
        stat(
            corpus
                .iter()
                .filter_map(|r| r.open.count)
                .filter(|c| c.orders.exact)
                .map(|c| c.orders.n as f64)
                .collect()
        )
    );
    let _ = writeln!(
        s,
        "| components | {} |",
        stat(
            corpus
                .iter()
                .filter_map(|r| r.open.shape)
                .map(|s| s.components as f64)
                .collect()
        )
    );
    let _ = writeln!(
        s,
        "| step, ms | {} |",
        stat(corpus.iter().flat_map(|r| r.step_ms.clone()).collect())
    );
    let _ = writeln!(
        s,
        "| explain, ms | {} |",
        stat(corpus.iter().flat_map(|r| r.explain_ms.clone()).collect())
    );
    let _ = writeln!(
        s,
        "| explained set size | {} |",
        stat(explained.iter().map(|(_, b, _)| *b as f64).collect())
    );
    for row in admitted.iter().filter(|r| r.group != "corpus") {
        let _ = writeln!(s, "\n{}", row.line());
    }
    s
}
