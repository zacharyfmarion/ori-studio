//! The Layer order dialog's constraint session (`oristudio_fold::steer::ConstraintSession`,
//! `implementation-plans/layer-order-dialog.md` row E5) over real designs:
//! the gates its unit tests hold on the fixtures, at the scale of the corpus.
//!
//! Each design is folded as Edit folds a whole sheet, and each one Oriedita
//! folds flat and `LayerSource::from_oriedita` admits is opened on the
//! solver's first order (counting the spots whose top face differs from
//! Edit's) and then as the dialog opens it, on the order Edit shows
//! (`open_showing` with the figure's paper-scene relations), which must hold
//! that order and stack every spot as Edit's scene does. Then, three times, a
//! constraint is built on an open pair, the other way from the order on
//! screen (so it changes the order), and:
//!
//! 1. **previewed**, and the session must be as it was: constraints, order
//!    on screen, open pairs, stacks from both sides and the saved record;
//! 2. previewed again with no nodes at all, which must give the same answer
//!    when the first needed no search, and a timeout when it did, never a
//!    "can't fit" it did not prove;
//! 3. **committed** when it fits, by adopting the preview (`commit_preview`,
//!    given no nodes at all, so it must not search) and landing on exactly the
//!    previewed order; when it cannot fit, the order on screen's own way of
//!    the pair is committed.
//!
//! Then the first constraint is **removed**, which must keep the order on
//! screen, and put back; and the session is **saved**, encoded, read back
//! and **restored** on a fresh source of the same creases, which must give
//! back the same constraints, the same order on screen and the same open
//! pairs, every face and constraint intact, every saved pair kept and nothing
//! carried; a second restore on that session (`restore_record`) gives the
//! same again.
//!
//! # Where it runs
//!
//! - **CI**: the fixtures (kabuto, `solution_sample_1`, Oriedita's
//!   `colorconstrainttest` and `solution_sample_1_black_valley`), held to
//!   every gate.
//! - **Locally, in release**, with `LAYER_ORDER_CENSUS_DIR` naming a corpus of
//!   `<case>/truth.fold` (the variable census 1 reads,
//!   `layer_order_witness.rs`): the fixtures, `precrease/iguana-c0.fold` and
//!   every case, a row printed per design, and a CSV and a summary written to
//!   `artifacts/layer-order-session/` (`LAYER_ORDER_SESSION_OUT` moves it):
//!
//!   ```sh
//!   LAYER_ORDER_CENSUS_DIR=/path/to/cpoogle \
//!     cargo test -p oracle-tests --release --test layer_order_session -- --nocapture
//!   ```
//!
//!   `LAYER_ORDER_CENSUS_JOBS=n` runs `n` designs at once and
//!   `LAYER_ORDER_CENSUS_ONLY=a,b` keeps the cases whose name contains one of
//!   the strings, as for census 1.
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
    CantFitProof, Commit, Constraint, ConstraintSession, ConstraintStatus, FaceStatus, LayerSource,
    Limits, OpenedOn, Preview, RECORD_MAX_BYTES, RecordRead, RestoreOutcome, SavedPairStatus,
    Stacks, Verb, ViewSide, encode_record, read_record, scene_relations,
};
use oristudio_layer_order::{FacePair, LayerOrder};

const CORPUS_ENV: &str = "LAYER_ORDER_CENSUS_DIR";
const OUT_ENV: &str = "LAYER_ORDER_SESSION_OUT";
const JOBS_ENV: &str = "LAYER_ORDER_CENSUS_JOBS";
const ONLY_ENV: &str = "LAYER_ORDER_CENSUS_ONLY";

/// Constraints built per design.
const STEPS: usize = 3;

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
    (
        "solution_sample_1_black_valley",
        "tests/fixtures/oriedita/solution_sample_1_black_valley.cp",
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

/// What one design gave.
#[derive(Debug, Clone, Default)]
struct Row {
    name: String,
    group: &'static str,
    /// `ok`, or why the design is outside the census: Oriedita's outcome, the
    /// source's refusal or the session's.
    status: String,
    faces: usize,
    pairs: usize,
    spots: usize,
    open_at_start: usize,
    open_ms: f64,
    preview_ms: Vec<f64>,
    commit_ms: Vec<f64>,
    verdicts: BTreeMap<&'static str, usize>,
    tiny_timed_out: usize,
    tiny_alike: usize,
    constraints: usize,
    record_bytes: usize,
    save_ms: f64,
    restore_ms: f64,
    /// Spots whose top face differs from Edit's when the session opens on the
    /// solver's first order.
    first_tops_differ: usize,
    /// Where `open_showing` put the order on screen: `held`, `closest`,
    /// `first`.
    showing: &'static str,
    /// Spots whose stack differs from Edit's after `open_showing`.
    showing_differ: usize,
    /// Spots whose top face differs from Edit's after `open_showing`.
    showing_tops_differ: usize,
    /// When Edit's order is not held: how it breaks the solver's problem,
    /// violations by kind.
    edit_violations: BTreeMap<String, usize>,
    /// How deep the first such taco-tortilla's crease runs into its
    /// tortilla, in the sheet's units.
    crossing_depth: Option<f64>,
    showing_ms: f64,
    /// Every gate this design failed, by name.
    failures: Vec<String>,
}

impl Row {
    fn admitted(&self) -> bool {
        self.status == "ok"
    }

    fn passes(&self) -> bool {
        self.admitted() && self.failures.is_empty() && self.record_bytes <= RECORD_MAX_BYTES
    }

    const CSV_HEADER: &'static str = "name,group,status,faces,pairs,spots,open_at_start,open_ms,\
previews,preview_ms_median,preview_ms_max,commit_ms_max,verdicts,tiny_timed_out,tiny_alike,\
constraints,record_bytes,save_ms,restore_ms,first_tops_differ,showing,showing_differ,showing_ms,\
failures";

    fn csv(&self) -> String {
        let clean = |s: &str| s.replace([',', '\n'], ";");
        format!(
            "{},{},{},{},{},{},{},{:.1},{},{:.2},{:.2},{:.2},{},{},{},{},{},{:.1},{:.1},{},{},{},{:.1},{}",
            clean(&self.name),
            self.group,
            clean(&self.status),
            self.faces,
            self.pairs,
            self.spots,
            self.open_at_start,
            self.open_ms,
            self.preview_ms.len(),
            percentile(&self.preview_ms, 0.5).unwrap_or(0.0),
            max(&self.preview_ms),
            max(&self.commit_ms),
            self.verdicts
                .iter()
                .map(|(k, n)| format!("{k}:{n}"))
                .collect::<Vec<_>>()
                .join(" "),
            self.tiny_timed_out,
            self.tiny_alike,
            self.constraints,
            self.record_bytes,
            self.save_ms,
            self.restore_ms,
            self.first_tops_differ,
            self.showing,
            self.showing_differ,
            self.showing_ms,
            clean(&self.failures.join(" ")),
        )
    }

    fn line(&self) -> String {
        if !self.admitted() {
            return format!("{}: {}", self.name, self.status);
        }
        format!(
            "{}: {} faces, {} pairs, {} spots, {} open; first order {} tops off Edit's, \
             open_showing {} ({} stacks off); open {:.0} ms, preview median {:.1} ms \
             max {:.1} ms; {} constraints, record {} B, restore {:.0} ms; {}",
            self.name,
            self.faces,
            self.pairs,
            self.spots,
            self.open_at_start,
            self.first_tops_differ,
            self.showing,
            self.showing_differ,
            self.open_ms,
            percentile(&self.preview_ms, 0.5).unwrap_or(0.0),
            max(&self.preview_ms),
            self.constraints,
            self.record_bytes,
            self.restore_ms,
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

/// Everything a host reads of a session: what a preview leaves as it was.
#[derive(Debug, PartialEq)]
struct Observed {
    constraints: Vec<Constraint>,
    shown: LayerOrder,
    open: Vec<FacePair>,
    front: Stacks,
    back: Stacks,
    record: Option<String>,
}

fn observed(session: &ConstraintSession) -> Observed {
    Observed {
        constraints: session.constraints().to_vec(),
        shown: session.shown_order(),
        open: session.open_pairs(),
        front: session.stacks(ViewSide::Front),
        back: session.stacks(ViewSide::Back),
        record: session
            .save()
            .ok()
            .and_then(|record| encode_record(&record).ok()),
    }
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
    let lo_above = session.shown_order().above(pair.lo(), pair.hi())?;
    let (subject, object) = if lo_above {
        (pair.lo(), pair.hi())
    } else {
        (pair.hi(), pair.lo())
    };
    Constraint::seen(
        subject,
        Verb::Behind,
        object,
        ViewSide::Back,
        session.source().view(),
    )
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
    // What Edit shows: its figure's paper scene, front.
    let edit = match cp.folded_figure_paper_scene(folded.handle, None) {
        Ok(Some(scene)) => scene,
        other => {
            row.status = format!("no scene {}", other.is_ok());
            return row;
        }
    };
    let edit_stacks: Vec<Vec<u32>> = edit
        .subfaces
        .iter()
        .map(|s| s.faces_top_to_bottom.iter().map(|&f| f as u32).collect())
        .collect();

    let t = Instant::now();
    let session = ConstraintSession::open(source, &limits_for(120_000.0));
    row.open_ms = elapsed_ms(t);
    let first = match session {
        Ok(session) => session,
        Err(refusal) => {
            row.status = refusal.code().to_string();
            return row;
        }
    };
    row.status = "ok".to_string();
    row.spots = first.spot_count();
    row.open_at_start = first.open_pairs().len();
    let stacks = first.stacks(ViewSide::Front);
    row.first_tops_differ = edit_stacks
        .iter()
        .enumerate()
        .filter(|(i, stack)| stacks.spot(*i).first() != stack.first())
        .count();

    // 0. The dialog opens on the order Edit shows, spot for spot.
    let t = Instant::now();
    let showing = ConstraintSession::open_showing(
        first.into_source(),
        &scene_relations(&edit),
        &limits_for(120_000.0),
    );
    row.showing_ms = elapsed_ms(t);
    let mut session = match showing {
        Ok(session) => session,
        Err(refusal) => {
            row.failures
                .push(format!("open_showing {}", refusal.code()));
            return row;
        }
    };
    row.showing = match session.opened_on() {
        OpenedOn::Held { .. } => "held",
        OpenedOn::Closest { .. } => "closest",
        OpenedOn::First { .. } => "first",
    };
    if row.showing != "held" {
        // Why the solver's problem does not take Edit's order: its
        // violations of it, by kind.
        let mut edit_order = LayerOrder::new();
        for r in scene_relations(&edit) {
            let _ = edit_order.set_above(
                oristudio_fold::FaceId(r.upper_face as u32),
                oristudio_fold::FaceId(r.lower_face as u32),
            );
        }
        let source = session.source();
        if let Ok(report) = oristudio_layer_order::check::check_problem(
            source.problem(),
            source.view(),
            &edit_order,
            oristudio_layer_order::check::Scope::All,
        ) {
            for violation in &report.violations {
                let kind = serde_json::to_value(violation)
                    .ok()
                    .and_then(|v| v["kind"].as_str().map(str::to_string))
                    .unwrap_or_default();
                *row.edit_violations.entry(kind).or_default() += 1;
            }
            // How deep the first taco-tortilla's crease runs into its
            // tortilla, in the sheet's units (the tolerance is 1e-6).
            row.crossing_depth = report.violations.iter().find_map(|v| {
                let oristudio_layer_order::check::Violation::TacoTortilla { faces: [a, b, h] } = *v
                else {
                    return None;
                };
                let edge = source
                    .view()
                    .edges()
                    .iter()
                    .find(|e| e.faces == [a, b] || e.faces == [b, a])?;
                let ring = oristudio_geometry::convex::normalize(&source.view().face(h)?.polygon);
                let planes = oristudio_geometry::convex::edge_planes(&ring);
                let [p, q] = edge.segment;
                (0..=20)
                    .map(|i| {
                        let t = f64::from(i) / 20.0;
                        let x = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
                        planes
                            .iter()
                            .map(|plane| plane.signed_distance(x))
                            .fold(f64::INFINITY, f64::min)
                    })
                    .reduce(f64::max)
            });
        }
        // Holding fails only for an order the problem rejects: then the
        // closest fitting order is the session's to show (reported, not a
        // failure); an order it accepts must be held.
        if row.edit_violations.is_empty() || row.showing != "closest" {
            row.failures.push(format!(
                "open_showing {:?} edit_order_violates {:?}",
                session.opened_on(),
                row.edit_violations
            ));
        }
    }
    let stacks = session.stacks(ViewSide::Front);
    row.showing_differ = edit_stacks
        .iter()
        .enumerate()
        .filter(|(i, stack)| stacks.spot(*i) != stack.as_slice())
        .count()
        + edit_stacks.len().abs_diff(stacks.len());
    row.showing_tops_differ = edit_stacks
        .iter()
        .enumerate()
        .filter(|(i, stack)| stacks.spot(*i).first() != stack.first())
        .count();
    // Held, the dialog shows Edit's picture spot for spot.
    if row.showing == "held" && row.showing_differ > 0 {
        row.failures.push("open_showing_stacks".to_string());
    }

    let tiny = Limits {
        max_nodes: Some(0),
        fast_nodes: 0,
        deadline: None,
    };
    for step in 0..STEPS {
        let open = session.open_pairs();
        if open.is_empty() {
            break;
        }
        let pair = open[step * open.len() / STEPS % open.len()];
        let Some(candidate) = against_shown(&session, pair) else {
            row.failures.push(format!("s{step}:undetermined"));
            break;
        };

        // 1. A preview changes nothing.
        let before = observed(&session);
        let t = Instant::now();
        let preview = session.preview(candidate, &limits_for(30_000.0));
        row.preview_ms.push(elapsed_ms(t));
        if observed(&session) != before {
            row.failures.push(format!("s{step}:preview_changed"));
        }
        let preview = match preview {
            Ok(preview) => preview,
            Err(e) => {
                row.failures.push(format!("s{step}:{}", e.code()));
                break;
            }
        };
        let verdict = match &preview {
            Preview::Fits(_) => "fits",
            Preview::CantFit(_) => "cant_fit",
            Preview::TimedOut(_) => "timed_out",
        };
        *row.verdicts.entry(verdict).or_default() += 1;

        // 2. Out of nodes is a timeout, never a verdict it did not prove.
        let needed_search = match &preview {
            Preview::Fits(fit) => fit.nodes > 0,
            Preview::CantFit(cant) => matches!(cant.proof, CantFitProof::NoOrder { .. }),
            Preview::TimedOut(_) => true,
        };
        match session.preview(candidate, &tiny) {
            Ok(Preview::TimedOut(_)) if needed_search => row.tiny_timed_out += 1,
            Ok(short) if !needed_search && short == preview => row.tiny_alike += 1,
            other => row.failures.push(format!(
                "s{step}:tiny_{}",
                match other {
                    Ok(Preview::Fits(_)) => "fits",
                    Ok(Preview::CantFit(_)) => "cant_fit",
                    Ok(Preview::TimedOut(_)) => "timed_out",
                    Err(_) => "refused",
                }
            )),
        }

        // 3. Commit what fits by adopting its preview (Add): no search, so
        // even with no nodes it lands on the previewed order; else the order
        // on screen's own way of the pair.
        let t = Instant::now();
        let committed = match &preview {
            Preview::Fits(fit) => session.commit_preview(fit.clone(), &tiny),
            _ => match with_shown(&session, pair) {
                Some(keep) => {
                    let mut list = session.constraints().to_vec();
                    list.push(keep);
                    session.commit(list, &limits_for(30_000.0))
                }
                None => break,
            },
        };
        row.commit_ms.push(elapsed_ms(t));
        match (committed, &preview) {
            (Ok(Commit::Committed(_)), Preview::Fits(fit)) => {
                if session.shown_order() != fit.order() {
                    row.failures.push(format!("s{step}:add_moved"));
                }
            }
            (Ok(Commit::Committed(done)), _) => {
                if !done.changed.is_empty() {
                    row.failures.push(format!("s{step}:kept_pair_moved"));
                }
            }
            (other, _) => {
                row.failures.push(format!("s{step}:commit {other:?}"));
                break;
            }
        }
    }

    // Removal keeps the order on screen; then the constraint goes back.
    if let Some(&first) = session.constraints().first() {
        let before = session.shown_order();
        let rest = session.constraints()[1..].to_vec();
        match session.commit(rest, &limits_for(30_000.0)) {
            Ok(Commit::Committed(_)) if session.shown_order() == before => {}
            other => row.failures.push(format!("removal {other:?}")),
        }
        let mut again = session.constraints().to_vec();
        again.insert(0, first);
        if !matches!(
            session.commit(again, &limits_for(30_000.0)),
            Ok(Commit::Committed(_))
        ) || session.shown_order() != before
        {
            row.failures.push("put_back".to_string());
        }
    }
    row.constraints = session.constraints().len();

    // Save, then restore on a fresh source of the same creases.
    let t = Instant::now();
    let json = session.save().map(|record| encode_record(&record));
    row.save_ms = elapsed_ms(t);
    let json = match json {
        Ok(Ok(json)) => json,
        other => {
            row.failures.push(format!("save {other:?}"));
            return row;
        }
    };
    row.record_bytes = json.len();
    let RecordRead::Read {
        record,
        json: again,
    } = read_record(&json)
    else {
        row.failures.push("record_unread".to_string());
        return row;
    };
    if again != json {
        row.failures.push("record_rewritten".to_string());
    }
    let fresh = match LayerSource::from_oriedita(&fold) {
        Ok(fresh) => fresh,
        Err(e) => {
            row.failures.push(format!("fresh {}", e.code()));
            return row;
        }
    };
    let t = Instant::now();
    let restored = ConstraintSession::restore(fresh, &record, &limits_for(120_000.0));
    row.restore_ms = elapsed_ms(t);
    let restored = match restored {
        Ok(restored) => restored,
        Err(e) => {
            row.failures.push(format!("restore {}", e.code()));
            return row;
        }
    };
    if restored.outcome != RestoreOutcome::Applied {
        row.failures.push(format!("restore {:?}", restored.outcome));
    }
    if !restored
        .faces
        .iter()
        .all(|f| matches!(f, FaceStatus::Intact { .. }))
        || !restored
            .constraints
            .iter()
            .all(|s| *s == ConstraintStatus::Intact)
        || !restored.order.iter().all(|s| *s == SavedPairStatus::Kept)
    {
        row.failures.push("restore_statuses".to_string());
    }
    if restored.session.constraints() != session.constraints() {
        row.failures.push("restore_constraints".to_string());
    }
    if restored.session.shown_order() != session.shown_order() {
        row.failures.push("restore_order".to_string());
    }
    if restored.session.open_pairs() != session.open_pairs() {
        row.failures.push("restore_open".to_string());
    }
    if !restored.session.carried().is_empty() {
        row.failures.push("restore_carried".to_string());
    }
    // A retry on the open session restores the same.
    let mut again = restored.session;
    match again.restore_record(&record, &limits_for(120_000.0)) {
        Ok(report)
            if report.outcome == RestoreOutcome::Applied
                && again.shown_order() == session.shown_order()
                && again.constraints() == session.constraints() => {}
        other => row.failures.push(format!("restore_record {other:?}")),
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

/// Every gate on the fixtures, in CI.
#[test]
fn the_session_passes_every_gate_on_the_fixtures() {
    let designs: Vec<(String, &'static str, PathBuf)> = FIXTURES
        .iter()
        .map(|(name, relative)| (name.to_string(), "fixture", repo_root().join(relative)))
        .collect();
    for row in rows_of(&designs, 1) {
        assert!(row.passes(), "{row:#?}");
        // Every fixture has open pairs to build on (kabuto's run out after
        // two, from Edit's order).
        assert!(row.constraints >= 2, "{}: {}", row.name, row.constraints);
        assert_eq!(row.showing, "held", "{}", row.name);
    }
}

/// The local census: the fixtures, the iguana and a corpus.
#[test]
fn the_local_session_census() {
    let Some(dir) = std::env::var_os(CORPUS_ENV) else {
        println!(
            "SKIPPED: the_local_session_census\n  {CORPUS_ENV} is not set, so the iguana and \
             the corpus were not run.\n  Run it in release: {CORPUS_ENV}=/path/to/cpoogle cargo \
             test -p oracle-tests --release --test layer_order_session -- --nocapture"
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
        .unwrap_or_else(|| repo_root().join("artifacts/layer-order-session"));
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
    let _ = writeln!(s, "# Layer order session census\n");
    let _ = writeln!(
        s,
        "{} designs, {} jobs; {} admitted, {} pass every gate; outside: {:?}\n",
        rows.len(),
        jobs,
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
    let verdicts = admitted.iter().fold(BTreeMap::new(), |mut m, r| {
        for (k, n) in &r.verdicts {
            *m.entry(*k).or_insert(0usize) += n;
        }
        m
    });
    let previews: usize = admitted.iter().map(|r| r.preview_ms.len()).sum();
    let _ = writeln!(
        s,
        "{} previews: {:?}; with no nodes, {} timed out and {} answered alike, as they needed \
         no search\n",
        previews,
        verdicts,
        admitted.iter().map(|r| r.tiny_timed_out).sum::<usize>(),
        admitted.iter().map(|r| r.tiny_alike).sum::<usize>(),
    );
    let showing = admitted.iter().fold(BTreeMap::new(), |mut m, r| {
        *m.entry(r.showing).or_insert(0usize) += 1;
        m
    });
    let _ = writeln!(
        s,
        "Opened on the solver's first order, {} of {} designs show another top face than Edit \
         on some spot ({} spots in all); opened on Edit's own order (`open_showing`): {:?}, \
         {} designs with any stack off Edit's\n",
        admitted.iter().filter(|r| r.first_tops_differ > 0).count(),
        admitted.len(),
        admitted.iter().map(|r| r.first_tops_differ).sum::<usize>(),
        showing,
        admitted.iter().filter(|r| r.showing_differ > 0).count(),
    );
    let not_held: Vec<&&Row> = admitted.iter().filter(|r| r.showing != "held").collect();
    if !not_held.is_empty() {
        let kinds = not_held.iter().fold(BTreeMap::new(), |mut m, r| {
            for (k, n) in &r.edit_violations {
                *m.entry(k.clone()).or_insert(0usize) += n;
            }
            m
        });
        let depths: Vec<f64> = not_held.iter().filter_map(|r| r.crossing_depth).collect();
        let _ = writeln!(
            s,
            "Where Edit's order is not held ({} designs), the solver's problem finds it breaks \
             {:?}, the first such crease running {:.4} to {:.4} of the sheet into its tortilla \
             (the tolerance is 1e-6); the closest order shows another top face than Edit on {} \
             spots, the first order on {}\n",
            not_held.len(),
            kinds,
            depths.iter().copied().fold(f64::INFINITY, f64::min),
            max(&depths),
            not_held
                .iter()
                .map(|r| r.showing_tops_differ)
                .sum::<usize>(),
            not_held.iter().map(|r| r.first_tops_differ).sum::<usize>(),
        );
    }
    let _ = writeln!(s, "| Corpus (p50 / p95 / max) | |\n| --- | --- |");
    let _ = writeln!(
        s,
        "| open, ms | {} |",
        stat(corpus.iter().map(|r| r.open_ms).collect())
    );
    let _ = writeln!(
        s,
        "| open_showing, ms (source built, open included) | {} |",
        stat(corpus.iter().map(|r| r.showing_ms).collect())
    );
    let _ = writeln!(
        s,
        "| preview, ms | {} |",
        stat(corpus.iter().flat_map(|r| r.preview_ms.clone()).collect())
    );
    let _ = writeln!(
        s,
        "| commit, ms | {} |",
        stat(corpus.iter().flat_map(|r| r.commit_ms.clone()).collect())
    );
    let _ = writeln!(
        s,
        "| restore, ms | {} |",
        stat(corpus.iter().map(|r| r.restore_ms).collect())
    );
    let _ = writeln!(
        s,
        "| record, bytes | {} |",
        stat(corpus.iter().map(|r| r.record_bytes as f64).collect())
    );
    let _ = writeln!(
        s,
        "| spots | {} |",
        stat(corpus.iter().map(|r| r.spots as f64).collect())
    );
    for row in admitted.iter().filter(|r| r.group != "corpus") {
        let _ = writeln!(s, "\n{}", row.line());
    }
    s
}
