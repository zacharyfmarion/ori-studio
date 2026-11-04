//! Census 1 of the Layer order dialog (`implementation-plans/layer-order-dialog.md`,
//! row E4 and Phase gate 1): what the dialog's solver source,
//! `oristudio_fold::steer::LayerSource::from_oriedita`, makes of designs
//! Oriedita folds flat, through the same calls the hosts and the dialog make.
//!
//! Each design is folded as Edit folds a whole sheet
//! (`CpSession::folded_figure_fold_selected` over every line, starting face 1,
//! `Order5`). A design whose fold is not `Solved` is outside the census. For
//! the rest, from the figure's own source (`folded_figure_source`):
//!
//! 1. **Letters.** The source's letter seeds equal Oriedita's initial
//!    hierarchy (`initial_hierarchy_from_segments`), relation for relation and
//!    in order.
//! 2. **Refusals.** The source's refusal code, when it refuses.
//! 3. **Witnesses.** The completion session's first order, and up to three
//!    other distinct orders from `complete` (three listed per component;
//!    every component's second, every component's third, and a mix).
//! 4. **Apply.** `fold_with_order` from a witness's Oriedita relations gives a
//!    new handle, `Solved` and `shown_order: given`, whose front stacks are the
//!    witness's on every subface it draws, every face present; and its scene
//!    is the dialog's (`folded_paper_scene_with_order`) of the witness.
//! 5. **Reopen.** The witness's free pairs (those the session's open does not
//!    force) are written as the plan's record, read back on a fresh source by
//!    paper point and area, and with that fresh session's forced pairs they
//!    rebuild exactly the witness. Seeded into a check on the fresh session,
//!    they fit as the witness too: the host engine's reopen.
//! 6. **Record bytes.** The record as one compact JSON string in the plan's
//!    shape (approach 6: `{"v":1,"faces":[{"at","area"}],"constraints":[],
//!    "order":[[f,g,s]]}`, faces only those the order names, FOLD signs), and
//!    the full order in the same shape, for comparison. The codec here is the
//!    census's; the product's is E5's.
//! 7. **Fold-only pairs**: pairs the solver's view overlaps that share no
//!    Oriedita subface.
//! 8. **Timings**, natively: Edit's fold, the source, the session's open,
//!    each Apply, and checks of a few single flips of free pairs (a preview
//!    of "A above B" against the first order, the order on screen preferred).
//!
//! # Where it runs
//!
//! - **CI**, in the workspace test step: the fixtures (kabuto,
//!   `solution_sample_1`, Oriedita's `colorconstrainttest`, and
//!   `solution_sample_1_black_valley`, the same sheet with an interior valley
//!   drawn black), each held to Phase gate 1.
//! - **Locally, in release**, with `LAYER_ORDER_CENSUS_DIR` naming a corpus
//!   laid out as `<case>/truth.fold` (the cpoogle cases): the fixtures,
//!   `precrease/iguana-c0.fold` and every case, one row printed per design,
//!   and a per-design CSV and a summary written to
//!   `artifacts/layer-order-census/` (gitignored; `LAYER_ORDER_CENSUS_OUT`
//!   moves it):
//!
//!   ```sh
//!   LAYER_ORDER_CENSUS_DIR=/path/to/cpoogle \
//!     cargo test -p oracle-tests --release --test layer_order_witness -- --nocapture
//!   ```
//!
//!   `LAYER_ORDER_CENSUS_JOBS=n` runs `n` designs at once (the timings then
//!   share the machine); `LAYER_ORDER_CENSUS_ONLY=a,b` keeps the cases whose
//!   name contains one of the strings.
//!
//! Corpus files are never committed or copied in, and no case is named in a
//! committed file (`tests/corpus/README.md`).

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use oristudio_cp::folding::{
    EstimationOrder, FoldOutcome, FoldedFigureModel, FoldedPaperScene, ShownOrder,
    folded_paper_scene_with_order, initial_hierarchy_from_segments,
};
use oristudio_cp::geometry::LineColor;
use oristudio_cp::session::{CpSession, FoldSource, FoldWithOrderResult};
use oristudio_fold::FaceId;
use oristudio_fold::complete::{
    self, Check, CheckLimits, CompletionLimits, CompletionSession, Deadline, FixedKind, FixedPair,
};
use oristudio_fold::steer::{LayerSource, SourceRefusal};
use oristudio_layer_order::{EdgeKind, FacePair, LayerOrder, Letter, OrderTable};
use serde::{Deserialize, Serialize};

const CORPUS_ENV: &str = "LAYER_ORDER_CENSUS_DIR";
const OUT_ENV: &str = "LAYER_ORDER_CENSUS_OUT";
const JOBS_ENV: &str = "LAYER_ORDER_CENSUS_JOBS";
const ONLY_ENV: &str = "LAYER_ORDER_CENSUS_ONLY";

/// The plan's budget per record (approach 6, "Calls I've made").
const RECORD_BUDGET: usize = 1 << 20;
/// Single-flip checks timed per design.
const CHECKS: usize = 5;

/// The fixtures CI runs, by name and path from the repository root.
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

/// Milliseconds on a monotonic clock, for the solver's deadlines.
fn now_ms() -> f64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1e3
}

fn deadline_in(ms: f64) -> Deadline {
    Deadline {
        now_ms,
        at_ms: now_ms() + ms,
    }
}

fn elapsed_ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1e3
}

/// What one design gave, every measure of the census.
#[derive(Debug, Clone, Default)]
struct Row {
    name: String,
    group: &'static str,
    /// `solved`, or the fold's outcome or error code: outside the census.
    oriedita: String,
    oriedita_ms: f64,
    segments: usize,
    /// `ok`, or the source's refusal code.
    source: String,
    /// The refusal's cause or detail.
    detail: String,
    source_ms: f64,
    faces: usize,
    folds: usize,
    pairs: usize,
    subface_pairs: usize,
    fold_only: usize,
    letters: usize,
    letters_equal: Option<bool>,
    /// `ok`, or the completion session's refusal code.
    session: String,
    open_ms: f64,
    forced: usize,
    free: usize,
    components: usize,
    orders: String,
    witnesses: usize,
    reproduced: usize,
    dialog_scene_equal: usize,
    apply_fail: Vec<String>,
    apply_ms_max: f64,
    reopened: usize,
    seeded_fits: usize,
    reopen_fail: Vec<String>,
    record_bytes: usize,
    record_bytes_max: usize,
    full_bytes: usize,
    checks: usize,
    check_ms: Vec<f64>,
    check_verdicts: BTreeMap<&'static str, usize>,
    total_ms: f64,
}

impl Row {
    fn admitted(&self) -> bool {
        self.oriedita == "solved" && self.source == "ok"
    }

    /// Every witness this design has passed Apply and reopen.
    fn passes(&self) -> bool {
        self.admitted()
            && self.letters_equal == Some(true)
            && self.session == "ok"
            && self.witnesses > 0
            && self.reproduced == self.witnesses
            && self.dialog_scene_equal == self.witnesses
            && self.reopened == self.witnesses
            && self.seeded_fits == self.witnesses
            && self.record_bytes_max < RECORD_BUDGET
    }

    const CSV_HEADER: &'static str = "name,group,oriedita,oriedita_ms,segments,source,detail,\
source_ms,faces,folds,pairs,subface_pairs,fold_only,letters,letters_equal,session,open_ms,\
forced,free,components,orders,witnesses,reproduced,dialog_scene_equal,apply_fail,apply_ms_max,\
reopened,seeded_fits,reopen_fail,record_bytes,record_bytes_max,full_bytes,checks,\
check_ms_median,check_ms_max,check_verdicts,total_ms";

    fn csv(&self) -> String {
        let clean = |s: &str| s.replace([',', '\n'], ";");
        let verdicts = self
            .check_verdicts
            .iter()
            .map(|(k, n)| format!("{k}:{n}"))
            .collect::<Vec<_>>()
            .join(" ");
        format!(
            "{},{},{},{:.1},{},{},{},{:.1},{},{},{},{},{},{},{},{},{:.1},{},{},{},{},{},{},{},{},{:.1},{},{},{},{},{},{},{},{:.2},{:.2},{},{:.1}",
            clean(&self.name),
            self.group,
            clean(&self.oriedita),
            self.oriedita_ms,
            self.segments,
            clean(&self.source),
            clean(&self.detail),
            self.source_ms,
            self.faces,
            self.folds,
            self.pairs,
            self.subface_pairs,
            self.fold_only,
            self.letters,
            self.letters_equal
                .map_or("", |e| if e { "yes" } else { "no" }),
            clean(&self.session),
            self.open_ms,
            self.forced,
            self.free,
            self.components,
            clean(&self.orders),
            self.witnesses,
            self.reproduced,
            self.dialog_scene_equal,
            clean(&self.apply_fail.join(" ")),
            self.apply_ms_max,
            self.reopened,
            self.seeded_fits,
            clean(&self.reopen_fail.join(" ")),
            self.record_bytes,
            self.record_bytes_max,
            self.full_bytes,
            self.checks,
            median(&self.check_ms).unwrap_or(0.0),
            self.check_ms.iter().copied().fold(0.0, f64::max),
            verdicts,
            self.total_ms,
        )
    }

    fn line(&self) -> String {
        if self.oriedita != "solved" {
            return format!("{}: Oriedita {}", self.name, self.oriedita);
        }
        if self.source != "ok" {
            return format!(
                "{}: {} faces, refused {} {}",
                self.name, self.faces, self.source, self.detail
            );
        }
        format!(
            "{}: {} faces, {} pairs ({} free, {} fold-only), letters {}, session {}, \
             witnesses {}: apply {}/{}, reopen {}/{}, seeded {}/{}, record {} B (full {} B), \
             open {:.0} ms, check median {:.1} ms",
            self.name,
            self.faces,
            self.pairs,
            self.free,
            self.fold_only,
            match self.letters_equal {
                Some(true) => "equal",
                Some(false) => "DIFFER",
                None => "-",
            },
            self.session,
            self.witnesses,
            self.reproduced,
            self.witnesses,
            self.reopened,
            self.witnesses,
            self.seeded_fits,
            self.witnesses,
            self.record_bytes,
            self.full_bytes,
            self.source_ms + self.open_ms,
            median(&self.check_ms).unwrap_or(0.0),
        )
    }
}

fn median(values: &[f64]) -> Option<f64> {
    percentile(values, 0.5)
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

/// Open a design as a host opens a file.
fn open(cp: &mut CpSession, path: &Path) -> Result<u32, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("read: {e}"))?;
    let loaded = match path.extension().and_then(|e| e.to_str()) {
        Some("cp") => cp.load_cp(&text, ""),
        Some("ori") => cp.load_ori(&text, false),
        Some("fold") => cp.load_fold(&text, ""),
        other => return Err(format!("no loader for {other:?}")),
    };
    loaded.map_err(|e| e.code.to_string())
}

fn model() -> FoldedFigureModel {
    FoldedFigureModel::default()
}

/// The census of one design. Never panics on the design's account: every
/// answer is a column.
fn census(name: &str, group: &'static str, path: &Path) -> Row {
    let started = Instant::now();
    let mut row = Row {
        name: name.to_string(),
        group,
        ..Row::default()
    };
    let mut cp = CpSession::new();
    let document = match open(&mut cp, path) {
        Ok(document) => document,
        Err(e) => {
            row.oriedita = format!("unreadable {e}");
            return row;
        }
    };
    let lines: Vec<usize> = match cp.document_summary(document) {
        Ok(summary) => (1..=summary.line_segments).collect(),
        Err(e) => {
            row.oriedita = e.code.to_string();
            return row;
        }
    };

    // Edit's fold of the whole sheet.
    let t = Instant::now();
    let folded =
        cp.folded_figure_fold_selected(document, &lines, 1, EstimationOrder::Order5, model());
    row.oriedita_ms = elapsed_ms(t);
    let folded = match folded {
        Ok(folded) => folded,
        Err(e) => {
            row.oriedita = e.code.to_string();
            return row;
        }
    };
    if folded.snapshot.outcome != FoldOutcome::Solved {
        row.oriedita = format!("{:?}", folded.snapshot.outcome).to_lowercase();
        return row;
    }
    row.oriedita = "solved".to_string();
    let fold_source = match cp.folded_figure_source(folded.handle, Some(document)) {
        Ok(source) => source,
        Err(e) => {
            row.source = format!("no source {}", e.code);
            return row;
        }
    };
    row.segments = fold_source.segments.len();

    // 2. The source.
    let t = Instant::now();
    let source = LayerSource::from_oriedita(&fold_source);
    row.source_ms = elapsed_ms(t);
    let source = match source {
        Ok(source) => source,
        Err(refusal) => {
            row.source = refusal.code().to_string();
            row.detail = refusal_detail(&refusal);
            // The faces Oriedita traced, from its fold graph alone.
            row.faces = initial_hierarchy_from_segments(
                &fold_source.segments,
                fold_source.starting_face_id,
            )
            .ok()
            .flatten()
            .map_or(0, |initial| initial.faces_total);
            row.total_ms = elapsed_ms(started);
            return row;
        }
    };
    row.source = "ok".to_string();
    row.faces = source.view().faces().len();
    row.folds = source.view().edges().len();
    row.pairs = source.problem().variables().len();
    row.subface_pairs = source.subface_pairs();
    row.fold_only = source.fold_only_pairs().len();

    // 1. The letters against Oriedita's initial hierarchy.
    row.letters = source.letter_seeds().len();
    row.letters_equal = Some(letters_equal(&source, &fold_source));

    // The session.
    let t = Instant::now();
    let session = source.session(&CompletionLimits {
        deadline: Some(deadline_in(120_000.0)),
        ..CompletionLimits::default()
    });
    row.open_ms = elapsed_ms(t);
    let session = match session {
        Ok(session) => session,
        Err(refusal) => {
            row.session = refusal.code().to_string();
            row.total_ms = elapsed_ms(started);
            return row;
        }
    };
    row.session = "ok".to_string();
    row.forced = session.forced_pairs().len();
    row.free = row.pairs - row.forced;

    // 3. Witnesses.
    let witnesses = witnesses(&source, &session, &mut row);
    row.witnesses = witnesses.len();

    // A fresh source and session, as a reopen builds them.
    let fresh = LayerSource::from_oriedita(&fold_source)
        .ok()
        .and_then(|fresh| {
            let session = fresh.session(&CompletionLimits::default()).ok()?;
            Some((fresh, session))
        });

    for (k, witness) in witnesses.iter().enumerate() {
        // 4. Apply.
        match apply(&mut cp, &fold_source, &source, witness) {
            Ok((ms, dialog_equal)) => {
                row.reproduced += 1;
                row.dialog_scene_equal += usize::from(dialog_equal);
                row.apply_ms_max = row.apply_ms_max.max(ms);
            }
            Err(why) => row.apply_fail.push(format!("w{k}:{why}")),
        }

        // 6. The record, and the full order for comparison.
        let free = free_pairs(&session, witness);
        let Some(record) = record_of(&source, &free) else {
            row.reopen_fail.push(format!("w{k}:record"));
            continue;
        };
        let text = serde_json::to_string(&record).unwrap_or_default();
        row.record_bytes_max = row.record_bytes_max.max(text.len());
        if k == 0 {
            row.record_bytes = text.len();
            let all: Vec<(FacePair, bool)> = witness
                .pairs()
                .filter_map(|(pair, lo_above)| lo_above.map(|a| (pair, a)))
                .collect();
            row.full_bytes = record_of(&source, &all)
                .and_then(|full| serde_json::to_string(&full).ok())
                .map_or(0, |full| full.len());
        }

        // 5. Reopen.
        let Some((fresh, fresh_session)) = &fresh else {
            row.reopen_fail.push(format!("w{k}:fresh source"));
            continue;
        };
        match reopen(fresh, fresh_session, &text, witness) {
            Ok(seeded) => {
                row.reopened += 1;
                row.seeded_fits += usize::from(seeded);
                if !seeded {
                    row.reopen_fail.push(format!("w{k}:seeded check"));
                }
            }
            Err(why) => row.reopen_fail.push(format!("w{k}:{why}")),
        }
    }

    // 8. Checks: single flips of free pairs against the first order.
    if let Some(first) = witnesses.first() {
        time_checks(&session, first, &mut row);
    }
    row.total_ms = elapsed_ms(started);
    row
}

fn refusal_detail(refusal: &SourceRefusal) -> String {
    match refusal {
        SourceRefusal::Tolerance { cause } => cause.code().to_string(),
        SourceRefusal::NonConvexFace { face } => format!("face {face}"),
        SourceRefusal::AmbiguousOverlap { ambiguities } => format!(
            "{} pairs, {:?}",
            ambiguities.len(),
            ambiguities
                .iter()
                .map(|a| format!("{:?}", a.cause))
                .collect::<BTreeSet<_>>()
        ),
        SourceRefusal::Kernel { kernel_code, .. } => kernel_code.to_string(),
        other => other.to_string(),
    }
}

/// The source's letters are Oriedita's initial hierarchy, relation for
/// relation, in order.
fn letters_equal(source: &LayerSource, fold_source: &FoldSource) -> bool {
    let Ok(Some(initial)) =
        initial_hierarchy_from_segments(&fold_source.segments, fold_source.starting_face_id)
    else {
        return false;
    };
    let ours: Vec<(usize, usize)> = source
        .letter_seeds()
        .iter()
        .map(|s| (s.upper.0 as usize, s.lower.0 as usize))
        .collect();
    let theirs: Vec<(usize, usize)> = initial
        .relations
        .iter()
        .map(|r| (r.upper_face, r.lower_face))
        .collect();
    ours == theirs
}

/// The first order and up to three other distinct orders.
fn witnesses(source: &LayerSource, session: &CompletionSession, row: &mut Row) -> Vec<LayerOrder> {
    let mut out = vec![session.first_order()];
    let limits = CompletionLimits {
        per_component: 3,
        max_nodes: Some(CompletionLimits::DEFAULT_MAX_NODES),
        deadline: Some(deadline_in(60_000.0)),
    };
    match complete::complete(
        source.view(),
        source.problem(),
        source.letter_seeds(),
        &limits,
    ) {
        Ok(all) => {
            let components = all.components();
            row.components = components.len();
            let count = all.count();
            row.orders = format!("{}{}", count.orders, if count.exact { "" } else { "+" });
            for j in 1..=3 {
                let choice: Vec<usize> = components
                    .iter()
                    .enumerate()
                    .map(|(k, c)| {
                        let n = c.orders.len().max(1);
                        if j < 3 { j % n } else { (k + 1) % n }
                    })
                    .collect();
                if let Some(order) = all.order(&choice)
                    && !out.contains(&order)
                {
                    out.push(order);
                }
            }
        }
        Err(refusal) => row.orders = format!("complete {}", refusal.code()),
    }
    out
}

/// The witness's pairs that the session's open does not force: what the
/// record saves.
fn free_pairs(session: &CompletionSession, witness: &LayerOrder) -> Vec<(FacePair, bool)> {
    witness
        .pairs()
        .filter_map(|(pair, lo_above)| {
            let lo_above = lo_above?;
            session
                .forced(pair.lo(), pair.hi())
                .is_none()
                .then_some((pair, lo_above))
        })
        .collect()
}

/// Apply: fold the witness's relations into a new handle and read its order
/// back. The milliseconds the fold took, and whether its scene is the
/// dialog's.
fn apply(
    cp: &mut CpSession,
    fold_source: &FoldSource,
    source: &LayerSource,
    witness: &LayerOrder,
) -> Result<(f64, bool), String> {
    let relations = source.oriedita_relations(witness);
    let t = Instant::now();
    let folded = cp.folded_figure_fold_with_order(fold_source, &relations, model());
    let ms = elapsed_ms(t);
    let (handle, snapshot) = match folded {
        Ok(FoldWithOrderResult::Folded { handle, snapshot }) => (handle, snapshot),
        Ok(FoldWithOrderResult::Refused { refusal }) => {
            let wire = serde_json::to_value(&refusal).unwrap_or_default();
            return Err(wire["code"].as_str().unwrap_or("refused").to_string());
        }
        Err(e) => return Err(e.code.to_string()),
    };
    let result = (|| {
        if snapshot.outcome != FoldOutcome::Solved {
            return Err(format!("{:?}", snapshot.outcome).to_lowercase());
        }
        // No relations is an ordinary fold (a sheet with no overlapping pair
        // has nothing to order), and it says so.
        let shown = if relations.is_empty() {
            ShownOrder::Searched
        } else {
            ShownOrder::Given
        };
        if snapshot.shown_order != shown {
            return Err(format!("{:?}", snapshot.shown_order).to_lowercase());
        }
        let scene = cp
            .folded_figure_paper_scene(handle, None)
            .map_err(|e| e.code.to_string())?
            .ok_or("no_scene")?;
        stacks_agree(source, witness, &scene)?;
        let dialog = folded_paper_scene_with_order(
            source.render_inputs(),
            &relations,
            &fold_source.aux_segments,
            &model(),
        )
        .map_err(|e| format!("dialog scene {e:?}"))?;
        Ok(dialog.as_ref() == Some(&scene))
    })();
    let _ = cp.free_folded_figure(handle);
    result.map(|dialog_equal| (ms, dialog_equal))
}

/// Every stack the new handle draws is the witness's stack of that
/// subface's faces, every face present.
fn stacks_agree(
    source: &LayerSource,
    witness: &LayerOrder,
    scene: &FoldedPaperScene,
) -> Result<(), String> {
    let table = OrderTable::new(source.view(), witness);
    let mut expected: HashMap<&[usize], Option<Vec<usize>>> = HashMap::new();
    for faces in source.render_inputs().subface_face_ids() {
        expected
            .entry(faces)
            .or_insert_with(|| stack_of(faces, &table));
    }
    let by_set: HashMap<Vec<usize>, &Option<Vec<usize>>> = expected
        .iter()
        .map(|(faces, stack)| (faces.to_vec(), stack))
        .collect();
    for (i, subface) in scene.subfaces.iter().enumerate() {
        let mut set = subface.faces_top_to_bottom.clone();
        set.sort_unstable();
        match by_set.get(&set) {
            Some(Some(stack)) if *stack == subface.faces_top_to_bottom => {}
            Some(Some(_)) => return Err(format!("stack_differs@{i}")),
            Some(None) => return Err(format!("witness_not_total@{i}")),
            None => return Err(format!("stack_incomplete@{i}")),
        }
    }
    Ok(())
}

/// The faces of one subface, top first by the witness; `None` when the
/// witness is not a total order on them.
fn stack_of(faces: &[usize], table: &OrderTable) -> Option<Vec<usize>> {
    let k = faces.len();
    let mut slots: Vec<Option<usize>> = vec![None; k];
    for &f in faces {
        let above = faces
            .iter()
            .filter(|&&g| g != f && table.above(f, g) == Some(true))
            .count();
        let slot = slots.get_mut(k - 1 - above)?;
        if slot.replace(f).is_some() {
            return None;
        }
    }
    slots.into_iter().collect()
}

/// The plan's record (approach 6), as the census writes it.
#[derive(Debug, Serialize, Deserialize)]
struct Record {
    v: u32,
    faces: Vec<RecordFace>,
    constraints: Vec<(u32, u32, i8)>,
    order: Vec<(u32, u32, i8)>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RecordFace {
    at: [f64; 2],
    area: f64,
}

/// The record of `pairs` (each with whether its smaller face lies above):
/// the faces they name, ascending, by paper point and area, and a FOLD
/// triple per pair, `s = +1` iff `f` lies on `g`'s front side.
fn record_of(source: &LayerSource, pairs: &[(FacePair, bool)]) -> Option<Record> {
    let view = source.view();
    let ids: BTreeSet<FaceId> = pairs.iter().flat_map(|(p, _)| p.faces()).collect();
    let index: BTreeMap<FaceId, u32> = ids
        .iter()
        .enumerate()
        .map(|(i, &f)| (f, i as u32))
        .collect();
    let faces = ids
        .iter()
        .map(|&f| {
            Some(RecordFace {
                at: source.paper_point(f)?,
                area: source.paper_area(f)?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let order = pairs
        .iter()
        .map(|&(pair, lo_above)| {
            let s = if lo_above == view.front_up(pair.hi())? {
                1
            } else {
                -1
            };
            Some((*index.get(&pair.lo())?, *index.get(&pair.hi())?, s))
        })
        .collect::<Option<Vec<_>>>()?;
    Some(Record {
        v: 1,
        faces,
        constraints: Vec::new(),
        order,
    })
}

/// Reopen: read the record on a fresh source and rebuild the witness from
/// it and the fresh session's forced pairs. `Ok(seeded)` when the rebuild is
/// the witness; `seeded` when a check seeded with the record also fits as
/// the witness.
fn reopen(
    fresh: &LayerSource,
    session: &CompletionSession,
    text: &str,
    witness: &LayerOrder,
) -> Result<bool, String> {
    let record: Record = serde_json::from_str(text).map_err(|_| "parse")?;
    let ids = record
        .faces
        .iter()
        .map(|face| {
            let id = fresh.face_at_paper(face.at).ok_or("face_not_found")?;
            let area = fresh.paper_area(id).ok_or("no_area")?;
            if (area - face.area).abs() > 1e-6 * face.area.abs() {
                return Err("area_differs");
            }
            Ok(id)
        })
        .collect::<Result<Vec<FaceId>, &str>>()?;
    let id = |i: u32| ids.get(i as usize).map(|f| i64::from(f.0));
    let triples = record
        .order
        .iter()
        .map(|&(f, g, s)| Some([id(f)?, id(g)?, i64::from(s)]))
        .collect::<Option<Vec<_>>>()
        .ok_or("index")?;
    let saved = LayerOrder::from_fold_face_orders(&triples, fresh.view()).map_err(|_| "triples")?;
    let seeds: Vec<FixedPair> = saved
        .pairs()
        .filter_map(|(pair, lo_above)| {
            let (upper, lower) = if lo_above? {
                (pair.lo(), pair.hi())
            } else {
                (pair.hi(), pair.lo())
            };
            Some(FixedPair {
                upper,
                lower,
                kind: FixedKind::Seed,
            })
        })
        .collect();

    let mut rebuilt = LayerOrder::new();
    for [upper, lower] in session.forced_pairs() {
        rebuilt.set_above(upper, lower).map_err(|_| "forced")?;
    }
    for seed in &seeds {
        if session.forced(seed.upper, seed.lower).is_some() {
            return Err("saved_pair_forced".to_string());
        }
        rebuilt
            .set_above(seed.upper, seed.lower)
            .map_err(|_| "saved")?;
    }
    if rebuilt != *witness {
        return Err("rebuild_differs".to_string());
    }
    let seeded = session.check(
        &seeds,
        None,
        &CheckLimits {
            deadline: Some(deadline_in(60_000.0)),
            ..CheckLimits::default()
        },
    );
    Ok(matches!(seeded, Ok(Check::Fits { order, .. }) if order == *witness))
}

/// A few previews of single flips of free pairs, timed.
fn time_checks(session: &CompletionSession, first: &LayerOrder, row: &mut Row) {
    let free = free_pairs(session, first);
    if free.is_empty() {
        return;
    }
    let picks: BTreeSet<usize> = (0..CHECKS).map(|i| i * free.len() / CHECKS).collect();
    for i in picks {
        let (pair, lo_above) = free[i];
        // The opposite of what the first order says.
        let (upper, lower) = if lo_above {
            (pair.hi(), pair.lo())
        } else {
            (pair.lo(), pair.hi())
        };
        let seed = FixedPair {
            upper,
            lower,
            kind: FixedKind::Seed,
        };
        let t = Instant::now();
        let checked = session.check(
            &[seed],
            Some(first),
            &CheckLimits {
                deadline: Some(deadline_in(30_000.0)),
                ..CheckLimits::default()
            },
        );
        row.check_ms.push(elapsed_ms(t));
        row.checks += 1;
        let verdict = match checked {
            Ok(Check::Fits { .. }) => "fits",
            Ok(Check::Forced { .. }) => "forced",
            Ok(Check::Conflict { .. }) => "conflict",
            Ok(Check::NoOrder { .. }) => "no_order",
            Ok(Check::Undecided { .. }) => "undecided",
            Err(_) => "refused",
        };
        *row.check_verdicts.entry(verdict).or_default() += 1;
    }
}

fn fixture_rows() -> Vec<Row> {
    FIXTURES
        .iter()
        .map(|(name, relative)| {
            let row = census(name, "fixture", &repo_root().join(relative));
            println!("{}", row.line());
            row
        })
        .collect()
}

/// Phase gate 1 on the fixtures, in CI.
#[test]
fn the_fixtures_pass_phase_gate_1() {
    for row in fixture_rows() {
        assert!(row.passes(), "{row:#?}");
        // Each has more than one order, so the other witnesses are exercised.
        assert!(
            row.witnesses > 1,
            "{}: {} witnesses",
            row.name,
            row.witnesses
        );
    }
}

/// An interior line drawn black folds as a valley, as Edit folds it: the
/// sheet with one valley drawn black is the same problem, letter for letter,
/// as the sheet itself.
#[test]
fn an_interior_black_crease_folds_as_a_valley() {
    let source_of = |relative: &str| {
        let mut cp = CpSession::new();
        let document = open(&mut cp, &repo_root().join(relative)).expect("open");
        let lines: Vec<usize> = (1..=cp
            .document_summary(document)
            .expect("summary")
            .line_segments)
            .collect();
        let fold_source = cp
            .fold_source_of_selection(document, &lines, 1)
            .expect("source");
        let layer = LayerSource::from_oriedita(&fold_source).unwrap_or_else(|e| panic!("{e}"));
        (fold_source, layer)
    };
    let (plain_source, plain) = source_of("tests/fixtures/oriedita/solution_sample_1.cp");
    let (black_source, black) =
        source_of("tests/fixtures/oriedita/solution_sample_1_black_valley.cp");

    // Exactly one black line borders two faces, and it is a valley fold.
    let interior_black: Vec<usize> = black_source
        .segments
        .iter()
        .enumerate()
        .filter(|(line, segment)| {
            segment.color == LineColor::Black0
                && black
                    .render_inputs()
                    .line_face_border(*line)
                    .is_some_and(|(f, g)| f != g)
        })
        .map(|(line, _)| line)
        .collect();
    assert_eq!(interior_black.len(), 1, "{interior_black:?}");
    let (f, g) = black
        .render_inputs()
        .line_face_border(interior_black[0])
        .expect("two faces");
    let fold = black
        .view()
        .edges()
        .iter()
        .find(|e| e.faces == [FaceId(f as u32), FaceId(g as u32)])
        .expect("the black line is a fold");
    assert_eq!(fold.kind, EdgeKind::Folded(Some(Letter::Valley)));
    assert!(letters_equal(&black, &black_source));

    // The same faces, folds, letters and pairs as the sheet drawn blue.
    assert_eq!(plain.view().faces(), black.view().faces());
    assert_eq!(plain.view().edges(), black.view().edges());
    assert_eq!(plain.letter_seeds(), black.letter_seeds());
    assert_eq!(plain.problem().variables(), black.problem().variables());
    let first = |layer: &LayerSource| {
        layer
            .session(&CompletionLimits::default())
            .expect("session")
            .first_order()
    };
    assert_eq!(first(&plain), first(&black));
    // But not the same creases: the digest names the colour.
    assert_ne!(plain_source.digest, black_source.digest);
}

/// The local census: the fixtures, the iguana and a corpus, with the report
/// written under `artifacts/`.
#[test]
fn the_local_census() {
    let Some(dir) = std::env::var_os(CORPUS_ENV) else {
        println!(
            "SKIPPED: the_local_census\n  {CORPUS_ENV} is not set, so the iguana and the corpus \
             were not censused.\n  Run it in release: {CORPUS_ENV}=/path/to/cpoogle cargo test \
             -p oracle-tests --release --test layer_order_witness -- --nocapture"
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
    let rows: Vec<Row> = rows.into_iter().map(|(_, row)| row).collect();

    let out = std::env::var_os(OUT_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|| repo_root().join("artifacts/layer-order-census"));
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

/// Phase gate 1 over the rows, as Markdown.
fn summary(rows: &[Row], jobs: usize) -> String {
    let mut s = String::new();
    let flat: Vec<&Row> = rows.iter().filter(|r| r.oriedita == "solved").collect();
    let not_flat: BTreeMap<String, usize> =
        rows.iter()
            .filter(|r| r.oriedita != "solved")
            .fold(BTreeMap::new(), |mut m, r| {
                *m.entry(r.oriedita.clone()).or_default() += 1;
                m
            });
    let admitted: Vec<&Row> = flat.iter().copied().filter(|r| r.admitted()).collect();
    let refused: Vec<&Row> = flat.iter().copied().filter(|r| !r.admitted()).collect();
    let opened: Vec<&Row> = admitted
        .iter()
        .copied()
        .filter(|r| r.session == "ok")
        .collect();
    let letters_equal = admitted
        .iter()
        .filter(|r| r.letters_equal == Some(true))
        .count();
    let witnesses: usize = opened.iter().map(|r| r.witnesses).sum();
    let reproduced: usize = opened.iter().map(|r| r.reproduced).sum();
    let dialog_equal: usize = opened.iter().map(|r| r.dialog_scene_equal).sum();
    let reopened: usize = opened.iter().map(|r| r.reopened).sum();
    let seeded: usize = opened.iter().map(|r| r.seeded_fits).sum();
    let fixtures_reproduced = opened
        .iter()
        .filter(|r| r.group == "fixture")
        .all(|r| r.reproduced == r.witnesses);
    let record: Vec<f64> = opened.iter().map(|r| r.record_bytes as f64).collect();
    let record_max = opened.iter().map(|r| r.record_bytes_max).max().unwrap_or(0);
    let full: Vec<f64> = opened.iter().map(|r| r.full_bytes as f64).collect();
    let fold_only: Vec<f64> = admitted.iter().map(|r| r.fold_only as f64).collect();
    let with_fold_only = admitted.iter().filter(|r| r.fold_only > 0).count();
    let open: Vec<f64> = opened.iter().map(|r| r.source_ms + r.open_ms).collect();
    let check: Vec<f64> = opened.iter().flat_map(|r| r.check_ms.clone()).collect();
    let pct = |n: usize, d: usize| {
        if d == 0 {
            0.0
        } else {
            100.0 * n as f64 / d as f64
        }
    };
    let dist = |v: &[f64], unit: &str| {
        format!(
            "{:.1} / {:.1} / {:.1} {unit}",
            percentile(v, 0.5).unwrap_or(0.0),
            percentile(v, 0.95).unwrap_or(0.0),
            v.iter().copied().fold(0.0, f64::max)
        )
    };
    let pass = |ok: bool| if ok { "**pass**" } else { "**FAIL**" };
    let refusal_rate = pct(refused.len(), flat.len());

    let _ = writeln!(s, "# Layer order census 1 (native)\n");
    let _ = writeln!(
        s,
        "{} designs read: {} fixtures, {} iguana, {} corpus. {} fold flat in Oriedita \
         (`Solved`); the rest are outside the census: {:?}. Jobs: {jobs}.\n",
        rows.len(),
        rows.iter().filter(|r| r.group == "fixture").count(),
        rows.iter().filter(|r| r.group == "iguana").count(),
        rows.iter().filter(|r| r.group == "corpus").count(),
        flat.len(),
        not_flat,
    );
    let _ = writeln!(s, "## Phase gate 1\n");
    let _ = writeln!(s, "| Measure | Threshold | Measured | Result |");
    let _ = writeln!(s, "| --- | --- | --- | --- |");
    let _ = writeln!(
        s,
        "| Letter seeds equal Oriedita's initial hierarchy | every admitted design | {letters_equal} of {} | {} |",
        admitted.len(),
        pass(letters_equal == admitted.len())
    );
    let _ = writeln!(
        s,
        "| Source refusals | ≤ 5% of designs | {} of {} ({refusal_rate:.1}%) | {} |",
        refused.len(),
        flat.len(),
        pass(refusal_rate <= 5.0)
    );
    let _ = writeln!(
        s,
        "| `fold_with_order` reproduces a witness (Apply) | ≥ 99%; every fixture | {reproduced} of {witnesses} ({:.2}%); fixtures {} | {} |",
        pct(reproduced, witnesses),
        if fixtures_reproduced {
            "all"
        } else {
            "NOT all"
        },
        pass(pct(reproduced, witnesses) >= 99.0 && fixtures_reproduced)
    );
    let _ = writeln!(
        s,
        "| Reopen rebuild equals the witness | every witness | {reopened} of {witnesses} | {} |",
        pass(reopened == witnesses)
    );
    let _ = writeln!(
        s,
        "| Record bytes, first witness, p50 / p95 / max | every record under 1 MB | {}; largest of any witness {record_max} B | {} |",
        dist(&record, "B"),
        pass(record_max < RECORD_BUDGET)
    );
    let _ = writeln!(
        s,
        "| Fold-only pairs | reported | {} of {} admitted designs have any; per design {} | – |\n",
        with_fold_only,
        admitted.len(),
        dist(&fold_only, "pairs")
    );
    // The plan's table (approach 6), over the corpus alone, as Fold's import
    // measured it.
    let corpus: Vec<&Row> = opened
        .iter()
        .copied()
        .filter(|r| r.group == "corpus")
        .collect();
    let column = |f: fn(&Row) -> usize| corpus.iter().map(|r| f(r) as f64).collect::<Vec<_>>();
    let _ = writeln!(
        s,
        "## Sizes over the {} corpus designs with a session\n",
        corpus.len()
    );
    let _ = writeln!(s, "| | p50 / p95 / max |");
    let _ = writeln!(s, "| --- | --- |");
    for (label, values, unit) in [
        ("Face pairs that overlap", column(|r| r.pairs), "pairs"),
        ("Pairs the creases leave free", column(|r| r.free), "pairs"),
        (
            "The record (free pairs, first witness)",
            column(|r| r.record_bytes),
            "B",
        ),
        (
            "The full order, for comparison",
            column(|r| r.full_bytes),
            "B",
        ),
    ] {
        let _ = writeln!(s, "| {label} | {} |", dist(&values, unit));
    }
    let _ = writeln!(s);
    let _ = writeln!(s, "## Beside the gate\n");
    let _ = writeln!(
        s,
        "- Sessions that refused after the source admitted: {} ({:?}).",
        admitted.len() - opened.len(),
        admitted
            .iter()
            .filter(|r| r.session != "ok")
            .map(|r| r.session.as_str())
            .collect::<Vec<_>>()
    );
    let _ = writeln!(
        s,
        "- The new handle's scene equals the dialog's (`folded_paper_scene_with_order`): {dialog_equal} of {witnesses}."
    );
    let _ = writeln!(
        s,
        "- The record seeded into a fresh check fits as the witness: {seeded} of {witnesses}."
    );
    let _ = writeln!(
        s,
        "- Full order in the record's shape, p50 / p95 / max: {}.",
        dist(&full, "B")
    );
    let _ = writeln!(
        s,
        "- Open (source plus session), p50 / p95 / max: {}; single-flip checks ({} of them), p50 / p95 / max: {}.",
        dist(&open, "ms"),
        check.len(),
        dist(&check, "ms")
    );
    let mut verdicts: BTreeMap<&str, usize> = BTreeMap::new();
    for r in &opened {
        for (k, n) in &r.check_verdicts {
            *verdicts.entry(k).or_default() += n;
        }
    }
    let _ = writeln!(s, "- Check verdicts: {verdicts:?}.\n");
    let _ = writeln!(s, "## Refusals by code\n");
    let mut codes: BTreeMap<String, usize> = BTreeMap::new();
    for r in &refused {
        let key = if r.detail.is_empty() || r.source != "source_tolerance" {
            r.source.clone()
        } else {
            format!("{} ({})", r.source, r.detail)
        };
        *codes.entry(key).or_default() += 1;
    }
    if codes.is_empty() {
        let _ = writeln!(s, "None.");
    }
    for (code, n) in &codes {
        let _ = writeln!(s, "- `{code}`: {n}");
    }
    let failing: Vec<String> = opened
        .iter()
        .filter(|r| !r.passes())
        .map(|r| {
            format!(
                "{} ({}): apply {:?}, reopen {:?}",
                r.group, r.faces, r.apply_fail, r.reopen_fail
            )
        })
        .collect();
    let _ = writeln!(s, "\n## Admitted designs with a failing witness\n");
    if failing.is_empty() {
        let _ = writeln!(s, "None.");
    }
    for f in failing {
        let _ = writeln!(s, "- {f}");
    }
    s
}
