//! The planner driver: one component in, a precrease sequence out.
//!
//! `Planner::new` applies the exactness policy (plan decision D8): an
//! **exact** component is planned as is; a **snappable** one is planned on
//! its snapped copy and the maximum displacement is reported; an
//! **off-lattice** one gets the closure only — every remaining line becomes
//! a finding, nothing approximate is ever folded; a **refused** sheet gets
//! a status and nothing else. From there the driver runs the closure,
//! the stuck search, and the presentation passes, all resumable and
//! budgeted through a caller-supplied clock, and answers `explain` for any
//! line.

use serde::{Deserialize, Serialize};

use crate::clock::{Clock, Deadline, default_clock};
use crate::closure::{CloseOutcome, Closure, FoldOutcome, FoldedLine, Target};
use crate::components::Component;
use crate::error::PrecreaseError;
use crate::exactness::ExactnessClass;
use crate::line::Line;
use crate::order::{Placed, group, order, pattern};
use crate::pinch::{Extent, pinch_pass};
use crate::predicates::{Ref, Witness, full_facts, witnesses};
use crate::sequence::{
    Diagnostics, ExactnessSummary, FactsSummary, Finding, FindingReason, LineEntry, PointEntry,
    Sequence, Status, Step, StepKind, Totals,
};
use crate::sheet::Sheet;
use crate::state::{DEFAULT_POINT_CAP, LineTag};
use crate::stuck::{StuckOptions, stuck_search};

/// Planner knobs. The JSON form ([`PlannerOptionsJson`]) is what crosses the
/// wasm boundary; every field is optional there.
#[derive(Debug, Clone, Copy)]
pub struct PlannerOptions {
    pub point_cap: usize,
    pub stuck: StuckOptions,
    /// Per stuck event, milliseconds. The plan's working value was 2 s; the
    /// slowest search measured over the 31 components of `iguana_24.osf` —
    /// component 15, 588 segments merging to 95 lines — takes 1.92 s in
    /// release, so a 2 s cap would truncate a real search non-deterministically.
    /// 4 s is twice the measured worst case and still well inside the total.
    pub stuck_budget_ms: f64,
    /// Overall budget for `plan`, milliseconds (plan: 30 s default; the whole
    /// iguana canvas, all 31 components, plans in 3.3 s).
    pub total_budget_ms: f64,
    pub clock: Clock,
}

impl Default for PlannerOptions {
    fn default() -> Self {
        Self {
            point_cap: DEFAULT_POINT_CAP,
            stuck: StuckOptions::default(),
            stuck_budget_ms: 4000.0,
            total_budget_ms: 30_000.0,
            clock: default_clock(),
        }
    }
}

/// The JSON shape of the options: `{ point_cap, max_depth, depth3_threshold,
/// max_candidates, stuck_budget_ms, total_budget_ms }`, all optional.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PlannerOptionsJson {
    pub point_cap: Option<usize>,
    pub max_depth: Option<u8>,
    pub depth3_threshold: Option<usize>,
    pub max_candidates: Option<usize>,
    pub stuck_budget_ms: Option<f64>,
    pub total_budget_ms: Option<f64>,
}

impl PlannerOptions {
    /// Options from their JSON form (an empty string means defaults).
    pub fn from_json(json: &str) -> Result<PlannerOptions, PrecreaseError> {
        let parsed: PlannerOptionsJson = if json.trim().is_empty() {
            PlannerOptionsJson::default()
        } else {
            serde_json::from_str(json).map_err(|e| PrecreaseError::InvalidOptions {
                reason: e.to_string(),
            })?
        };
        let mut opts = PlannerOptions::default();
        if let Some(cap) = parsed.point_cap {
            opts.point_cap = cap;
        }
        if let Some(d) = parsed.max_depth {
            opts.stuck.max_depth = d.clamp(1, 3);
        }
        if let Some(t) = parsed.depth3_threshold {
            opts.stuck.depth3_threshold = t;
        }
        if let Some(c) = parsed.max_candidates {
            opts.stuck.candidates.max_candidates = c.max(1);
        }
        for (value, slot) in [
            (parsed.stuck_budget_ms, &mut opts.stuck_budget_ms),
            (parsed.total_budget_ms, &mut opts.total_budget_ms),
        ] {
            if let Some(v) = value {
                if !v.is_finite() || v < 0.0 {
                    return Err(PrecreaseError::InvalidOptions {
                        reason: "budgets must be finite and non-negative".to_string(),
                    });
                }
                *slot = v;
            }
        }
        Ok(opts)
    }
}

/// A remaining CP line as the TypeScript side needs it for a
/// ReferenceFinder query: canonical form plus two in-frame points.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RemainingLine {
    pub target: usize,
    pub line: Line,
    pub segment: [[f64; 2]; 2],
    pub cp_line_ids: Vec<u32>,
}

/// What one stuck event decided.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StuckSummary {
    pub aux: Vec<Line>,
    pub aux_folds: usize,
    pub visible_aux: usize,
    pub unlocked: usize,
    pub ease_sum: u32,
    pub depth_reached: u8,
    pub exhausted: bool,
    /// The chosen set finished the closure rather than only unsticking it.
    pub complete: bool,
    pub root_candidates: usize,
    pub candidates_evaluated: usize,
    pub closures_run: usize,
}

/// Everything known about one line, for the UI's "why".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Explanation {
    pub line: Line,
    pub folded: bool,
    /// State line id when folded.
    pub line_id: Option<usize>,
    pub tag: Option<LineTag>,
    pub round: Option<u32>,
    pub is_target: bool,
    pub remaining: bool,
    pub cp_line_ids: Vec<u32>,
    /// Recorded at fold time for a folded line; against the current state
    /// otherwise.
    pub witnesses: Vec<Witness>,
    pub chosen: Option<usize>,
    /// Facts against the current state.
    pub facts: FactsSummary,
}

/// The planner over one component.
#[derive(Debug, Clone)]
pub struct Planner {
    opts: PlannerOptions,
    component_id: u32,
    sheet: Option<Sheet>,
    closure: Option<Closure>,
    exactness: Option<ExactnessSummary>,
    off_lattice: bool,
    refused: bool,
    stuck_events: Vec<StuckSummary>,
    budget_hit: bool,
    point_cap_hit: bool,
    rf_lines_folded: u32,
    candidates_evaluated: u64,
    closures_run: u64,
    started_ms: f64,
    elapsed_ms: f64,
}

fn segment_of(sheet: &Sheet, line: &Line) -> Option<[[f64; 2]; 2]> {
    sheet.clip(line).map(|(a, b)| [a, b])
}

impl Planner {
    /// A planner over `component` (from `analyze`), applying the exactness
    /// policy. A refused component yields a planner whose status is
    /// `RefusedSheet` and whose every method is a no-op.
    pub fn new(component: &Component, opts: PlannerOptions) -> Planner {
        let started_ms = (opts.clock)();
        let mut planner = Planner {
            opts,
            component_id: component.id,
            sheet: None,
            closure: None,
            exactness: None,
            off_lattice: false,
            refused: true,
            stuck_events: Vec::new(),
            budget_hit: false,
            point_cap_hit: false,
            rf_lines_folded: 0,
            candidates_evaluated: 0,
            closures_run: 0,
            started_ms,
            elapsed_ms: 0.0,
        };
        let (Some(frame), Some(exactness)) = (&component.frame, &component.exactness) else {
            return planner;
        };
        let sheet = Sheet::from_frame(frame);
        let targets: Vec<Target> = match exactness.class {
            ExactnessClass::Exact | ExactnessClass::OffLattice => component
                .merged_lines
                .iter()
                .map(|ml| Target {
                    line: ml.line,
                    cp_line_ids: ml.segment_indices.iter().map(|&i| i + 1).collect(),
                })
                .collect(),
            ExactnessClass::Snappable => exactness
                .snapped
                .lines
                .iter()
                .map(|sl| Target {
                    line: sl.line,
                    cp_line_ids: sl.segment_indices.iter().map(|&i| i + 1).collect(),
                })
                .collect(),
        };
        planner.exactness = Some(ExactnessSummary {
            class: exactness.class,
            family: exactness.family.clone(),
            max_displacement_unit: exactness.snapped.max_displacement_unit,
            max_displacement_model: exactness.snapped.max_displacement_model,
            off_lattice_lines: exactness.off_lattice_lines,
            off_lattice_vertices: exactness.off_lattice_vertices,
        });
        planner.off_lattice = exactness.class == ExactnessClass::OffLattice;
        planner.refused = false;
        planner.closure = Some(Closure::new(sheet, targets, opts.point_cap));
        planner.sheet = Some(sheet);
        planner
    }

    /// A planner over the bare unit sheet and explicit target lines (tests,
    /// tools): treated as exact.
    pub fn from_lines(sheet: Sheet, lines: &[Line], opts: PlannerOptions) -> Planner {
        let started_ms = (opts.clock)();
        let targets = lines
            .iter()
            .enumerate()
            .map(|(i, l)| Target {
                line: *l,
                cp_line_ids: vec![i as u32 + 1],
            })
            .collect();
        Planner {
            opts,
            component_id: 0,
            sheet: Some(sheet),
            closure: Some(Closure::new(sheet, targets, opts.point_cap)),
            exactness: None,
            off_lattice: false,
            refused: false,
            stuck_events: Vec::new(),
            budget_hit: false,
            point_cap_hit: false,
            rf_lines_folded: 0,
            candidates_evaluated: 0,
            closures_run: 0,
            started_ms,
            elapsed_ms: 0.0,
        }
    }

    fn tick(&mut self) {
        self.elapsed_ms = (self.opts.clock)() - self.started_ms;
    }

    fn closure(&self) -> Result<&Closure, PrecreaseError> {
        self.closure.as_ref().ok_or(PrecreaseError::RefusedSheet)
    }

    fn closure_mut(&mut self) -> Result<&mut Closure, PrecreaseError> {
        self.closure.as_mut().ok_or(PrecreaseError::RefusedSheet)
    }

    /// The component id.
    pub fn component_id(&self) -> u32 {
        self.component_id
    }

    /// The sheet, unless refused.
    pub fn sheet(&self) -> Option<&Sheet> {
        self.sheet.as_ref()
    }

    /// The closure, unless refused.
    pub fn closure_ref(&self) -> Option<&Closure> {
        self.closure.as_ref()
    }

    /// The options.
    pub fn options(&self) -> &PlannerOptions {
        &self.opts
    }

    /// The current status.
    pub fn status(&self) -> Status {
        match &self.closure {
            None => Status::RefusedSheet,
            Some(c) if c.is_complete() => Status::Complete,
            Some(_) if self.off_lattice => Status::PartialOffLattice,
            Some(_) => Status::PartialUnsolved,
        }
    }

    fn deadline(&self, budget_ms: f64) -> Deadline {
        Deadline::after(self.opts.clock, budget_ms)
    }

    fn note_cap(&mut self, result: Result<(), PrecreaseError>) -> Result<(), PrecreaseError> {
        if let Err(PrecreaseError::PointCap { .. }) = &result {
            self.point_cap_hit = true;
        }
        result
    }

    /// Run the closure for at most `budget_ms` (0 = unbounded). Resumable.
    pub fn close(&mut self, budget_ms: f64) -> Result<CloseOutcome, PrecreaseError> {
        let deadline = self.deadline(budget_ms);
        let outcome = self.closure_mut()?.close(&deadline);
        let outcome = match outcome {
            Ok(o) => o,
            Err(e) => {
                self.note_cap(Err(e.clone()))?;
                return Err(e);
            }
        };
        self.budget_hit |= outcome.budget_hit;
        self.tick();
        Ok(outcome)
    }

    /// The remaining CP lines with two in-frame points each.
    pub fn remaining(&self) -> Vec<RemainingLine> {
        let (Some(c), Some(sheet)) = (&self.closure, &self.sheet) else {
            return Vec::new();
        };
        c.remaining()
            .iter()
            .filter_map(|&t| {
                let target = &c.targets()[t];
                segment_of(sheet, &target.line).map(|segment| RemainingLine {
                    target: t,
                    line: target.line,
                    segment,
                    cp_line_ids: target.cp_line_ids.clone(),
                })
            })
            .collect()
    }

    /// Canonical keys of the remaining lines (same order as `remaining`).
    pub fn line_keys(&self) -> Vec<u64> {
        self.remaining().iter().map(|r| r.line.key()).collect()
    }

    /// Run the forward-first search from the current (stuck) state with the
    /// given maximum depth and budget, and **apply** the best auxiliary set
    /// found (folding it and re-closing). `None` when nothing was found.
    pub fn stuck_search(
        &mut self,
        max_depth: u8,
        budget_ms: f64,
    ) -> Result<Option<StuckSummary>, PrecreaseError> {
        if self.off_lattice {
            return Ok(None);
        }
        let deadline = self.deadline(budget_ms);
        let mut opts = self.opts.stuck;
        opts.max_depth = max_depth.clamp(1, 3);
        let closure = self.closure()?.clone();
        if closure.is_complete() {
            return Ok(None);
        }
        let (result, stats) = match stuck_search(&closure, &opts, &deadline) {
            Ok(r) => r,
            Err(e) => {
                self.note_cap(Err(e.clone()))?;
                return Err(e);
            }
        };
        self.candidates_evaluated += stats.candidates_evaluated as u64;
        self.closures_run += stats.closures_run as u64;
        self.budget_hit |= !stats.exhausted;
        self.tick();
        let Some(result) = result else {
            self.stuck_events.push(StuckSummary {
                aux: Vec::new(),
                aux_folds: 0,
                visible_aux: 0,
                unlocked: 0,
                ease_sum: 0,
                depth_reached: stats.depth_reached,
                exhausted: stats.exhausted,
                complete: false,
                root_candidates: stats.root_candidates,
                candidates_evaluated: stats.candidates_evaluated,
                closures_run: stats.closures_run,
            });
            return Ok(None);
        };
        let summary = StuckSummary {
            aux: result.aux.clone(),
            aux_folds: result.score.aux_folds,
            visible_aux: result.score.visible_aux,
            unlocked: result.unlocked,
            ease_sum: result.score.ease_sum,
            depth_reached: stats.depth_reached,
            exhausted: stats.exhausted,
            complete: result.complete,
            root_candidates: stats.root_candidates,
            candidates_evaluated: stats.candidates_evaluated,
            closures_run: stats.closures_run,
        };
        self.closure = Some(result.closure);
        self.stuck_events.push(summary.clone());
        Ok(Some(summary))
    }

    /// Score externally supplied lines against the current state: for each,
    /// how many CP lines folding it alone would unlock, or `None` when it is
    /// not constructible from the current state.
    pub fn score(
        &self,
        lines: &[Line],
        budget_ms: f64,
    ) -> Result<Vec<Option<usize>>, PrecreaseError> {
        let deadline = self.deadline(budget_ms);
        crate::stuck::score_lines(self.closure()?, lines, &deadline)
    }

    /// Fold externally supplied lines in order, each only if some axiom
    /// application in the current state reproduces it, then re-close.
    pub fn fold(
        &mut self,
        lines: &[Line],
        tags: &[LineTag],
        budget_ms: f64,
    ) -> Result<Vec<FoldOutcome>, PrecreaseError> {
        if tags.len() != lines.len() {
            return Err(PrecreaseError::TagCountMismatch {
                lines: lines.len(),
                tags: tags.len(),
            });
        }
        let mut outcomes = Vec::with_capacity(lines.len());
        for (line, &tag) in lines.iter().zip(tags) {
            let tag = if tag == LineTag::Edge {
                LineTag::Aux
            } else {
                tag
            };
            let out = self.closure_mut()?.fold_line(*line, tag);
            let out = match out {
                Ok(o) => o,
                Err(e) => {
                    self.note_cap(Err(e.clone()))?;
                    return Err(e);
                }
            };
            if matches!(out, FoldOutcome::Folded { .. }) && tag == LineTag::RfAux {
                self.rf_lines_folded += 1;
            }
            outcomes.push(out);
        }
        self.close(budget_ms)?;
        Ok(outcomes)
    }

    /// Closure → stuck search → repeat, until complete, unsolved, off-lattice
    /// or out of budget (`total_budget_ms`, 0 = unbounded).
    pub fn plan(&mut self) -> Result<Status, PrecreaseError> {
        if self.refused {
            return Ok(Status::RefusedSheet);
        }
        let total = self.deadline(self.opts.total_budget_ms);
        loop {
            self.close(self.opts.total_budget_ms)?;
            if self.closure()?.is_complete() || self.off_lattice {
                break;
            }
            if total.expired() {
                self.budget_hit = true;
                break;
            }
            let depth = self.opts.stuck.max_depth;
            let budget = self.opts.stuck_budget_ms;
            match self.stuck_search(depth, budget)? {
                Some(_) => continue,
                None => break,
            }
        }
        self.tick();
        Ok(self.status())
    }

    fn certification(&self) -> String {
        if self.stuck_events.is_empty() {
            return "best_found_to_depth_0".to_string();
        }
        if self.rf_lines_folded > 0
            || self.budget_hit
            || self.stuck_events.iter().any(|e| !e.exhausted)
        {
            return "heuristic".to_string();
        }
        let depth = self
            .stuck_events
            .iter()
            .map(|e| e.depth_reached)
            .max()
            .unwrap_or(0);
        format!("best_found_to_depth_{depth}")
    }

    fn diagnostics(&self) -> Diagnostics {
        let (points, lines, closure_stats) = match &self.closure {
            Some(c) => (
                c.state().point_count(),
                c.state().line_count(),
                c.stats().clone(),
            ),
            None => (0, 0, Default::default()),
        };
        Diagnostics {
            closure: closure_stats,
            stuck_events: self.stuck_events.len() as u32,
            candidates_evaluated: self.candidates_evaluated,
            closures_run: self.closures_run,
            points,
            lines,
            elapsed_ms: self.elapsed_ms,
            budget_hit: self.budget_hit,
            point_cap_hit: self.point_cap_hit,
            max_depth_searched: self
                .stuck_events
                .iter()
                .map(|e| e.depth_reached)
                .max()
                .unwrap_or(0),
            search_exhausted: self.stuck_events.iter().all(|e| e.exhausted),
            witnesses_incomplete_steps: self.closure.as_ref().map_or(0, |c| {
                c.folded().iter().filter(|f| !f.witnesses_complete).count() as u32
            }),
            rf_lines_folded: self.rf_lines_folded,
        }
    }

    /// The plan in its wire shape.
    pub fn sequence(&self, landmarks_first: bool) -> Sequence {
        let status = self.status();
        let (Some(closure), Some(sheet)) = (&self.closure, &self.sheet) else {
            return Sequence {
                status,
                certification: "heuristic".to_string(),
                sheet: Sheet::unit_square(),
                landmarks_first,
                steps: Vec::new(),
                groups: Vec::new(),
                totals: Totals::default(),
                findings: Vec::new(),
                points: Vec::new(),
                lines: Vec::new(),
                exactness: self.exactness.clone(),
                diagnostics: self.diagnostics(),
            };
        };
        let placed: Vec<Placed> = order(closure, landmarks_first);
        let fold_order: Vec<usize> = placed.iter().map(|p| p.folded).collect();
        let verdicts = pinch_pass(closure, &fold_order);
        let folded = closure.folded();
        let state = closure.state();

        // Step id per state line id, for `unlocks`.
        let mut step_of_line: Vec<Option<u32>> = vec![None; state.line_count()];
        for (k, p) in placed.iter().enumerate() {
            step_of_line[folded[p.folded].line_id] = Some(k as u32 + 1);
        }

        let mut steps: Vec<Step> = Vec::with_capacity(placed.len());
        let mut referenced_points: Vec<usize> = Vec::new();
        for (k, p) in placed.iter().enumerate() {
            let f: &FoldedLine = &folded[p.folded];
            let chosen = p.chosen.map(|c| &f.witnesses[c]);
            if let Some(w) = chosen {
                for r in &w.inputs {
                    if r.is_point() && !referenced_points.contains(&r.id()) {
                        referenced_points.push(r.id());
                    }
                }
            }
            let verdict = &verdicts[k];
            let kind = if f.tag == LineTag::Cp {
                StepKind::Cp
            } else {
                StepKind::Aux
            };
            let cp_line_ids = f
                .target
                .map(|t| closure.targets()[t].cp_line_ids.clone())
                .unwrap_or_default();
            steps.push(Step {
                id: k as u32 + 1,
                kind,
                tag: f.tag,
                line: f.line,
                line_id: f.line_id,
                segment: segment_of(sheet, &f.line).unwrap_or([[0.0; 2]; 2]),
                extent: verdict.extent.clone(),
                round: p.round,
                witnesses: f.witnesses.clone(),
                chosen: p.chosen,
                ease: chosen.map_or(0, |w| w.ease),
                hard: chosen.is_some_and(|w| w.hard),
                err: chosen.map_or(0.0, |w| w.err),
                unlocks: Vec::new(),
                cp_line_ids,
                visible: verdict.visible,
                witnesses_complete: f.witnesses_complete,
                hoisted: p.hoisted,
            });
        }

        // Unlocks: CP steps whose chosen witness uses an aux step's line or
        // a mark on it.
        for i in 0..steps.len() {
            if steps[i].kind != StepKind::Aux {
                continue;
            }
            let line_id = steps[i].line_id;
            let mut unlocks: Vec<u32> = Vec::new();
            for later in &steps[(i + 1)..] {
                if later.kind != StepKind::Cp {
                    continue;
                }
                let Some(w) = later.chosen.map(|c| &later.witnesses[c]) else {
                    continue;
                };
                let uses = w.inputs.iter().any(|r| match r {
                    Ref::Edge { id, .. } | Ref::Line { id } => *id == line_id,
                    Ref::Corner { id, .. } | Ref::Point { id } => {
                        state.points()[*id].lines.contains(&line_id)
                    }
                });
                if uses {
                    unlocks.push(later.id);
                }
            }
            steps[i].unlocks = unlocks;
        }

        let groups = group(closure, &placed);
        let _ = pattern(None);

        referenced_points.sort_unstable();
        let points: Vec<PointEntry> = referenced_points
            .iter()
            .map(|&id| {
                let sp = &state.points()[id];
                let mut lines = sp.lines.clone();
                lines.sort_unstable();
                PointEntry {
                    id,
                    p: sp.p,
                    lines,
                    on_boundary: sp.on_boundary,
                }
            })
            .collect();
        let lines: Vec<LineEntry> = state
            .lines()
            .iter()
            .enumerate()
            .map(|(id, l)| LineEntry {
                id,
                tag: l.tag,
                step: step_of_line[id],
            })
            .collect();

        let findings: Vec<Finding> = closure
            .remaining()
            .iter()
            .map(|&t| {
                let target = &closure.targets()[t];
                let facts = full_facts(state, &target.line);
                Finding {
                    line: target.line,
                    segment: segment_of(sheet, &target.line),
                    cp_line_ids: target.cp_line_ids.clone(),
                    reason: if self.off_lattice {
                        FindingReason::OffLattice
                    } else {
                        FindingReason::Unsolved
                    },
                    facts: summarize(&facts),
                }
            })
            .collect();

        let cp_lines = steps.iter().filter(|s| s.kind == StepKind::Cp).count() as u32;
        let aux = steps.iter().filter(|s| s.kind == StepKind::Aux).count() as u32;
        let visible_aux = steps.iter().filter(|s| s.visible).count() as u32;
        let free_lines = closure.free_targets().len() as u32;
        let unsolved = closure.remaining().len() as u32;
        let totals = Totals {
            folds: cp_lines + aux,
            cp_lines,
            aux,
            visible_aux,
            lower_bound: cp_lines + unsolved,
            free_lines,
            unsolved,
        };

        Sequence {
            status,
            certification: self.certification(),
            sheet: *sheet,
            landmarks_first,
            steps,
            groups,
            totals,
            findings,
            points,
            lines,
            exactness: self.exactness.clone(),
            diagnostics: self.diagnostics(),
        }
    }

    /// Everything known about `line`: its recorded witnesses when folded,
    /// otherwise its witnesses and facts against the current state.
    pub fn explain(&self, line: &Line) -> Explanation {
        let Some(closure) = &self.closure else {
            return Explanation {
                line: *line,
                folded: false,
                line_id: None,
                tag: None,
                round: None,
                is_target: false,
                remaining: false,
                cp_line_ids: Vec::new(),
                witnesses: Vec::new(),
                chosen: None,
                facts: FactsSummary::default(),
            };
        };
        let state = closure.state();
        let facts = full_facts(state, line);
        let target = closure.target_of(line);
        let remaining = target.is_some_and(|t| closure.remaining().contains(&t));
        let cp_line_ids = target
            .map(|t| closure.targets()[t].cp_line_ids.clone())
            .unwrap_or_default();
        match state
            .find_line(line)
            .and_then(|id| closure.folded_by_line_id(id))
        {
            Some(f) => Explanation {
                line: *line,
                folded: true,
                line_id: Some(f.line_id),
                tag: Some(f.tag),
                round: Some(f.round),
                is_target: target.is_some(),
                remaining: false,
                cp_line_ids,
                witnesses: f.witnesses.clone(),
                chosen: f.chosen,
                facts: summarize(&facts),
            },
            None => {
                let ws = witnesses(state, line, &facts);
                let chosen = crate::predicates::choose(&ws);
                Explanation {
                    line: *line,
                    folded: state.has_line(line),
                    line_id: state.find_line(line),
                    tag: state.find_line(line).map(|id| state.lines()[id].tag),
                    round: None,
                    is_target: target.is_some(),
                    remaining,
                    cp_line_ids,
                    witnesses: ws,
                    chosen,
                    facts: summarize(&facts),
                }
            }
        }
    }

    /// Two in-frame points of `line` for a ReferenceFinder line query (the
    /// planner unit frame *is* the ReferenceFinder frame; this is the seam).
    pub fn line_to_rf(&self, line: &Line) -> Option<[[f64; 2]; 2]> {
        self.sheet.as_ref().and_then(|s| segment_of(s, line))
    }

    /// A ReferenceFinder line (two points) as a canonical planner line.
    pub fn line_from_rf(&self, a: [f64; 2], b: [f64; 2]) -> Option<Line> {
        Line::from_points(a, b)
    }

    /// The stuck events so far.
    pub fn stuck_events(&self) -> &[StuckSummary] {
        &self.stuck_events
    }

    /// Whether the exactness policy turned planning off (off-lattice).
    pub fn is_off_lattice(&self) -> bool {
        self.off_lattice
    }
}

fn summarize(facts: &crate::predicates::Facts) -> FactsSummary {
    FactsSummary {
        points_on: facts.points_on.len(),
        perpendiculars: facts.perps.len(),
        o2_pairs: facts.o2_pairs.len(),
        o3_pairs: facts.o3_pairs.len(),
        landers: facts.landers.len(),
        landers_computed: facts.landers_computed,
    }
}

/// Whether a step's extent is a set of pinches.
pub fn is_pinched(step: &Step) -> bool {
    matches!(step.extent, Extent::Pinches { .. })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::frozen_clock;

    fn v(x: f64) -> Line {
        Line::new([1.0, 0.0], x).expect("line")
    }

    fn h(y: f64) -> Line {
        Line::new([0.0, 1.0], y).expect("line")
    }

    fn opts() -> PlannerOptions {
        PlannerOptions {
            clock: frozen_clock(),
            stuck_budget_ms: 0.0,
            total_budget_ms: 0.0,
            ..PlannerOptions::default()
        }
    }

    #[test]
    fn options_json_round_trip_and_validation() {
        let o = PlannerOptions::from_json("").expect("defaults");
        assert_eq!(o.point_cap, DEFAULT_POINT_CAP);
        let o =
            PlannerOptions::from_json(r#"{"max_depth": 3, "stuck_budget_ms": 10}"#).expect("parse");
        assert_eq!(o.stuck.max_depth, 3);
        assert_eq!(o.stuck_budget_ms, 10.0);
        assert!(PlannerOptions::from_json(r#"{"nope": 1}"#).is_err());
        assert!(PlannerOptions::from_json(r#"{"stuck_budget_ms": -1}"#).is_err());
    }

    #[test]
    fn a_grid_of_quarters_plans_without_auxiliary_folds() {
        let mut p = Planner::from_lines(
            Sheet::unit_square(),
            &[v(0.25), v(0.5), v(0.75), h(0.5), v(0.0)],
            opts(),
        );
        assert_eq!(p.plan().expect("plan"), Status::Complete);
        let seq = p.sequence(false);
        assert_eq!(seq.status, Status::Complete);
        assert_eq!(seq.totals.cp_lines, 4);
        assert_eq!(seq.totals.aux, 0);
        assert_eq!(seq.totals.free_lines, 1);
        assert_eq!(seq.totals.lower_bound, 4);
        assert_eq!(seq.certification, "best_found_to_depth_0");
        assert_eq!(seq.steps.len(), 4);
        assert!(seq.steps.iter().all(|s| s.extent == Extent::Full));
        assert!(seq.steps.iter().all(|s| s.cp_line_ids.len() == 1));
        assert_eq!(seq.steps[0].id, 1);
        assert!(!seq.groups.is_empty());
        // Lines table resolves state ids to steps; edges have none.
        assert!(seq.lines[..4].iter().all(|l| l.step.is_none()));
        assert!(seq.lines[4..].iter().all(|l| l.step.is_some()));
        // JSON serialises.
        let json = serde_json::to_string(&seq).expect("json");
        assert!(json.contains("\"status\":\"complete\""));
    }

    #[test]
    fn thirds_need_one_auxiliary_fold_and_it_is_pinched_or_visible() {
        let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("l");
        let anti = Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("l");
        let mut p = Planner::from_lines(
            Sheet::unit_square(),
            &[
                v(1.0 / 3.0),
                v(2.0 / 3.0),
                h(1.0 / 3.0),
                h(2.0 / 3.0),
                diag,
                anti,
            ],
            opts(),
        );
        assert_eq!(p.plan().expect("plan"), Status::Complete);
        let seq = p.sequence(false);
        assert_eq!(seq.totals.cp_lines, 6);
        assert!(
            seq.totals.aux >= 1 && seq.totals.aux <= 2,
            "{:?}",
            seq.totals
        );
        assert_eq!(seq.totals.folds, seq.totals.cp_lines + seq.totals.aux);
        assert!(seq.certification.starts_with("best_found_to_depth_"));
        let aux: Vec<&Step> = seq
            .steps
            .iter()
            .filter(|s| s.kind == StepKind::Aux)
            .collect();
        assert_eq!(aux.len() as u32, seq.totals.aux);
        for a in &aux {
            assert!(!a.unlocks.is_empty(), "{a:?}");
            assert!(a.visible || is_pinched(a));
        }
        assert_eq!(
            seq.totals.visible_aux as usize,
            aux.iter().filter(|a| a.visible).count()
        );
        // Explain a folded CP line and a fresh line.
        let e = p.explain(&v(1.0 / 3.0));
        assert!(e.folded && e.is_target && !e.remaining);
        assert!(!e.witnesses.is_empty());
        let e = p.explain(&v(0.2));
        assert!(!e.folded && !e.is_target);
        assert!(e.facts.landers_computed);
        // Landmarks-first hoists what certifies from the bare sheet.
        let lf = p.sequence(true);
        assert_eq!(lf.totals, seq.totals);
        assert!(lf.steps.iter().filter(|s| s.hoisted).count() <= aux.len());
    }

    #[test]
    fn an_unsolvable_line_is_a_finding() {
        // x = 1/7 with a depth-1 search and a candidate cap too small to
        // reach it: partial_unsolved with one finding.
        let mut o = opts();
        o.stuck.max_depth = 1;
        o.stuck.depth3_threshold = 0;
        o.stuck.candidates.max_candidates = 4;
        let mut p = Planner::from_lines(Sheet::unit_square(), &[v(1.0 / 7.0), v(0.5)], o);
        let status = p.plan().expect("plan");
        assert_eq!(status, Status::PartialUnsolved);
        let seq = p.sequence(false);
        assert_eq!(seq.findings.len(), 1);
        assert_eq!(seq.findings[0].reason, FindingReason::Unsolved);
        assert_eq!(seq.totals.unsolved, 1);
        assert_eq!(seq.totals.lower_bound, 2);
        assert!(seq.remaining_is_consistent());
    }

    impl Sequence {
        fn remaining_is_consistent(&self) -> bool {
            self.totals.cp_lines + self.totals.unsolved == self.totals.lower_bound
        }
    }
}
