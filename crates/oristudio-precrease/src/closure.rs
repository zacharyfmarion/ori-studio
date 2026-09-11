//! The closure: fold every constructible CP line, repeat to a fixpoint.
//!
//! # Monotonicity, and why the fixpoint set is order-independent
//!
//! Constructibility of a target ℓ in a state `(L, P)` is *existential* over
//! witnesses drawn from `(L, P)`: some axiom application with inputs in
//! `L ∪ P` reproduces ℓ. Folding a line only ever **adds** to `L` and `P` —
//! nothing is removed, incidence only grows ([`State::add_line`]) — so every
//! witness that exists in a state exists in every later state. Hence
//! `constructible(ℓ, S)` is monotone in `S`, the operator "fold every
//! constructible target" is monotone and inflationary on a finite lattice of
//! line sets, and its least fixpoint from the bare sheet is unique: whatever
//! order the targets are folded in, the *set* of folded lines at the fixpoint
//! is the same (Knaster–Tarski). The *axiom labels* are not order-invariant —
//! the same line may be O2-constructible in one order and only O1 in another
//! — so the closure records **every** certified witness at fold time and the
//! presentation chooses among them in a later pass.
//!
//! The same argument covers resumability and the two tiers below: facts about
//! a target only accumulate, so a budgeted `close` that stops mid-sweep and a
//! later call that continues from the cursors compute exactly the facts a
//! single uninterrupted run would have.
//!
//! # Two tiers, incremental
//!
//! Every remaining target keeps a [`Facts`] record plus three cursors into
//! the state's line and point vectors. The **worklist** is implicit in the
//! cursors: each `(target, new line)` pair is examined once (points on the
//! target through the crossing, perpendiculars, O3 mirror pairs) and each
//! `(target, new point)` pair once (O2 mirror pairs) — O(1) work per pair,
//! and the O2 lookup goes through the point grid (the plan's
//! "direction-bucketed" cost class: a reflection and one grid probe, never a
//! scan of `P`). Tier 1 (O1–O4) is evaluated every sweep. Only when a sweep
//! folds nothing and targets remain does tier 2 run: **lander** facts for
//! O5/O6/O7, computed by the line-pair formulation — `(p, m₁)` is a lander
//! iff `p` lies on `reflect_ℓ(m₁)`, so the points on that mirror line are
//! found through its crossings with the state lines, `O(|L|)` grid probes per
//! `m₁`, again incremental over the lines added since the target's last
//! lander scan.
//!
//! # Rounds
//!
//! One sweep collects every target constructible in the *current* state and
//! folds them together as one round. Witnesses computed against the state at
//! the start of the round stay valid after the round's other folds
//! (monotonicity), so the order within a round is free — the ordering pass
//! uses that.

use serde::{Deserialize, Serialize};

use crate::clock::Deadline;
use crate::direction::{Direction, Side, majority};
use crate::error::PrecreaseError;
use crate::grid::Grid;
use crate::line::{Line, LineIndex};
use crate::marks::{Creased, ends_are_found};
use crate::predicates::{
    Facts, Witness, all_witnesses, choose, scan_landers, scan_lines, scan_points, witnesses,
};
use crate::sheet::Sheet;
use crate::state::{LineTag, State};
use crate::tol::TOL;

/// A CP line to construct, with the editor segments it realises.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Target {
    pub line: Line,
    /// The editor's 1-based crease ids on this line.
    pub cp_line_ids: Vec<u32>,
    /// Where those creases actually are, unit frame, projected onto `line` and
    /// parallel to `cp_line_ids`.
    ///
    /// A fold runs the width of the sheet, but the *pattern* usually only wants
    /// part of that chord — a diagram that draws the whole line says "crease
    /// all of this", which is not the instruction. Empty for an auxiliary line.
    pub spans: Vec<[[f64; 2]; 2]>,
    /// Which way this line's creases mostly fold — the policy applied once to
    /// the evidence [`crate::merge::MergedLine`] carries. `Unassigned` for a
    /// line with no mountain or valley creases.
    pub direction: Direction,
    /// The share of the line's creased length `direction` covers, in `[0, 1]`;
    /// `0.0` when `direction` is `Unassigned`. Under
    /// [`crate::direction::FIRM_MAJORITY`] the line does not force a side.
    pub direction_share: f64,
}

impl Target {
    /// A target whose direction is settled by the majority of its creases.
    ///
    /// `spans` are the creases' own endpoints in the unit frame; they are
    /// projected onto `line` so a drawn span always lies on the drawn chord,
    /// which a raw endpoint need not within `TOL` — and need not at all on the
    /// snappable path, where the line itself moved.
    pub fn new(
        line: Line,
        cp_line_ids: Vec<u32>,
        spans: Vec<[[f64; 2]; 2]>,
        mountain_length: f64,
        valley_length: f64,
    ) -> Target {
        let (direction, direction_share) = majority(mountain_length, valley_length);
        Target {
            line,
            cp_line_ids,
            spans: spans
                .into_iter()
                .map(|[a, b]| [line.project_point(a), line.project_point(b)])
                .collect(),
            direction,
            direction_share,
        }
    }

    /// The same target with each span endpoint moved along the line to the
    /// sheet's boundary, or to a crossing with one of `lines`, when it lies
    /// within `radius` of one.
    ///
    /// For the snappable path. The line has been put back on the lattice; its
    /// creases' endpoints have not, and still carry the file's rounding — a
    /// crease that ends at the edge arrives as one that stops half a thousandth
    /// short of it. `Creased::reaches` tests at `TOL`, so that crease would not
    /// reach the mark where it meets the edge, and a press would be made to
    /// close a gap that exists in the file and not in the design.
    pub fn with_spans_snapped(mut self, sheet: &Sheet, lines: &[Line], radius: f64) -> Target {
        let Some((t0, t1)) = sheet.clip_parameters(&self.line) else {
            return self;
        };
        let mut anchors: Vec<f64> = vec![t0, t1];
        for other in lines {
            if let Some(x) = other.intersect(&self.line) {
                let t = self.line.parameter_of(x);
                if t >= t0 - TOL && t <= t1 + TOL {
                    anchors.push(t);
                }
            }
        }
        for span in &mut self.spans {
            for end in span.iter_mut() {
                let t = self.line.parameter_of(*end);
                let nearest = anchors
                    .iter()
                    .copied()
                    .filter(|a| (a - t).abs() <= radius)
                    .min_by(|a, b| (a - t).abs().total_cmp(&(b - t).abs()));
                if let Some(a) = nearest {
                    *end = self.line.point_at(a);
                }
            }
        }
        self
    }

    /// A target with no direction evidence: the caller supplied bare lines, so
    /// the finished pattern assigns them nothing and the ordering pass folds
    /// them on whichever side is already up.
    pub fn unassigned(line: Line, cp_line_ids: Vec<u32>) -> Target {
        Target {
            line,
            cp_line_ids,
            spans: Vec::new(),
            direction: Direction::Unassigned,
            direction_share: 0.0,
        }
    }

    /// Whether this line's majority is strong enough to force a turn-over.
    pub fn forces_side(&self) -> Option<Side> {
        if self.direction.is_firm(self.direction_share) {
            self.direction.side()
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Default)]
struct TargetFacts {
    facts: Facts,
    lines_scanned: usize,
    points_scanned: usize,
    lander_lines_scanned: usize,
}

/// One folded line with everything the closure knew when it folded it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FoldedLine {
    /// State line id.
    pub line_id: usize,
    pub line: Line,
    pub tag: LineTag,
    /// Index into the closure's targets for a CP line.
    pub target: Option<usize>,
    /// Closure round (1-based; auxiliary folds get their own round).
    pub round: u32,
    /// Every certified witness at fold time (capped per axiom).
    pub witnesses: Vec<Witness>,
    /// Index of the presentation witness in `witnesses`.
    pub chosen: Option<usize>,
    /// Whether the lander tier was evaluated for this line's witnesses.
    pub witnesses_complete: bool,
    /// For a line folded by the closest construction there was rather than an
    /// exact one ([`Closure::fold_approximation`]): how far that construction
    /// lands from the line, in sheet units. `None` for an exact fold.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approximation: Option<f64>,
    /// The line the witnesses actually construct, when it is not `line`: the
    /// approximation. What the folder makes; `line` is what the pattern
    /// wanted, and what the state carries so that later lines close against
    /// the pattern's own geometry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folded_as: Option<Line>,
    /// For a line of the precrease grid ([`Closure::fold_grid`]): which
    /// family and which line of it. A grid line is made by pleating, not
    /// sighted, so it has no witnesses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid: Option<GridRef>,
}

/// Where a folded line sits in the precrease grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridRef {
    /// Index into [`Grid::families`].
    pub family: usize,
    /// Index into that family's lines.
    pub line: usize,
}

impl FoldedLine {
    /// The presentation witness.
    pub fn chosen_witness(&self) -> Option<&Witness> {
        self.chosen.map(|i| &self.witnesses[i])
    }

    /// The line the witnesses construct: `folded_as` for an approximation,
    /// otherwise the line itself.
    pub fn constructed(&self) -> Line {
        self.folded_as.unwrap_or(self.line)
    }
}

/// What one `close` call did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloseOutcome {
    /// Lines folded by this call.
    pub folded: usize,
    /// Targets still unfolded.
    pub remaining: usize,
    /// The fixpoint was reached (nothing remaining is constructible).
    pub fixpoint: bool,
    /// The call stopped on its deadline; call again to resume.
    pub budget_hit: bool,
}

/// What folding an externally supplied line did.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FoldOutcome {
    /// Folded; `line_id` is the state id, `cp_target` the target it realised.
    Folded {
        line_id: usize,
        cp_target: Option<usize>,
    },
    /// An equal line is already folded.
    AlreadyFolded { line_id: usize },
    /// No axiom application in the current state reproduces the line.
    NotConstructible,
    /// The line does not cross the sheet.
    OffSheet,
}

/// Counters for diagnostics.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClosureStats {
    pub rounds: u32,
    pub tier1_sweeps: u32,
    pub tier2_sweeps: u32,
    pub target_evaluations: u64,
}

/// Lines beyond which a tier-1 fold by O1/O4 alone is **not** enriched with
/// lander witnesses for presentation (the lander scan is `O(|L|²)` per line).
pub const LANDER_ENRICH_MAX_LINES: usize = 400;

/// The closure over one component.
#[derive(Debug, Clone)]
pub struct Closure {
    state: State,
    targets: Vec<Target>,
    target_index: LineIndex,
    /// Target index per `target_index` id.
    target_ids: Vec<usize>,
    remaining: Vec<usize>,
    facts: Vec<TargetFacts>,
    folded: Vec<FoldedLine>,
    /// Targets that coincide with a sheet edge: free, never folded.
    free: Vec<usize>,
    round: u32,
    /// Where the paper is actually creased, grown one fold at a time — the
    /// input to the endpoint half of the constructibility test.
    creased: Creased,
    prefer_findable_ends: bool,
    /// The grid pleated before the first close, if any.
    grid: Option<Grid>,
    stats: ClosureStats,
}

impl Closure {
    /// A closure over `targets` from the bare `sheet`. Targets equal to a
    /// sheet edge are recorded as free.
    pub fn new(sheet: Sheet, targets: Vec<Target>, point_cap: usize) -> Closure {
        let state = State::new(sheet, point_cap);
        let mut target_index = LineIndex::new(TOL);
        let mut target_ids = Vec::new();
        let mut remaining = Vec::new();
        let mut free = Vec::new();
        let mut kept: Vec<Target> = Vec::new();
        for t in targets {
            if state.has_line(&t.line) {
                free.push(kept.len());
                kept.push(t);
                continue;
            }
            let (_, inserted) = target_index.insert(t.line);
            if !inserted {
                // Duplicate target lines (a merge at TOL should prevent this);
                // keep the record, plan it once.
                kept.push(t);
                continue;
            }
            target_ids.push(kept.len());
            remaining.push(kept.len());
            kept.push(t);
        }
        let facts = vec![TargetFacts::default(); kept.len()];
        let creased = Creased::new(&state);
        Closure {
            state,
            targets: kept,
            target_index,
            target_ids,
            remaining,
            facts,
            folded: Vec::new(),
            free,
            round: 0,
            creased,
            prefer_findable_ends: true,
            grid: None,
            stats: ClosureStats::default(),
        }
    }

    /// The state.
    pub fn state(&self) -> &State {
        &self.state
    }

    /// Every target, in input order.
    pub fn targets(&self) -> &[Target] {
        &self.targets
    }

    /// Indices of the targets not yet folded.
    pub fn remaining(&self) -> &[usize] {
        &self.remaining
    }

    /// Indices of the targets that coincide with sheet edges.
    pub fn free_targets(&self) -> &[usize] {
        &self.free
    }

    /// Every folded line in fold order.
    pub fn folded(&self) -> &[FoldedLine] {
        &self.folded
    }

    /// The grid pleated before the first close, if any.
    pub fn grid(&self) -> Option<&Grid> {
        self.grid.as_ref()
    }

    /// The current round counter.
    pub fn round(&self) -> u32 {
        self.round
    }

    /// Whether a sweep prefers targets whose creases have findable ends.
    ///
    /// On by default. The off state exists to measure the two orders against
    /// each other and comes out once that measurement has been taken.
    pub fn set_prefer_findable_ends(&mut self, on: bool) {
        self.prefer_findable_ends = on;
    }

    /// Every remaining target whose line can be sighted *and* whose creases
    /// both begin and end somewhere the folder can find, out of `constructible`.
    ///
    /// Judged against the paper as it stood when the sweep began, so it does
    /// not depend on the order the sweep's own folds are made in — the same
    /// footing the witnesses are certified on.
    fn ends_findable(&self, constructible: &[(usize, Vec<Witness>)]) -> Vec<bool> {
        constructible
            .iter()
            .map(|(t, _)| {
                let target = &self.targets[*t];
                ends_are_found(&self.state, &self.creased, &target.line, &target.spans)
            })
            .collect()
    }

    /// Counters.
    pub fn stats(&self) -> &ClosureStats {
        &self.stats
    }

    /// Whether any target remains.
    pub fn is_complete(&self) -> bool {
        self.remaining.is_empty()
    }

    /// The target index of a line equal to a target, if any.
    pub fn target_of(&self, line: &Line) -> Option<usize> {
        let id = self.target_index.find(line)?;
        Some(self.target_ids[id])
    }

    /// Whether `line` equals a target that is still remaining.
    pub fn is_remaining_target(&self, line: &Line) -> bool {
        self.target_of(line)
            .is_some_and(|t| self.remaining.contains(&t))
    }

    fn update_tier1(&mut self, t: usize) {
        let target = self.targets[t].line;
        let tf = &mut self.facts[t];
        if tf.lines_scanned < self.state.line_count() {
            scan_lines(&self.state, &target, &mut tf.facts, tf.lines_scanned);
            tf.lines_scanned = self.state.line_count();
        }
        if tf.points_scanned < self.state.point_count() {
            scan_points(&self.state, &target, &mut tf.facts, tf.points_scanned);
            tf.points_scanned = self.state.point_count();
        }
    }

    fn update_landers(&mut self, t: usize) {
        let target = self.targets[t].line;
        let tf = &mut self.facts[t];
        if !tf.facts.landers_computed || tf.lander_lines_scanned < self.state.line_count() {
            scan_landers(&self.state, &target, &mut tf.facts, tf.lander_lines_scanned);
            tf.lander_lines_scanned = self.state.line_count();
        }
    }

    fn evaluate(&mut self, t: usize) -> Vec<Witness> {
        self.stats.target_evaluations += 1;
        witnesses(&self.state, &self.targets[t].line, &self.facts[t].facts)
    }

    /// Run the closure until the fixpoint or the deadline. Resumable: a call
    /// that hits its deadline leaves every accumulated fact in place.
    pub fn close(&mut self, deadline: &Deadline) -> Result<CloseOutcome, PrecreaseError> {
        let mut folded_now = 0usize;
        loop {
            if self.remaining.is_empty() {
                return Ok(self.outcome(folded_now, true, false));
            }
            if deadline.expired() {
                return Ok(self.outcome(folded_now, false, true));
            }

            // Tier 1 sweep.
            self.stats.tier1_sweeps += 1;
            let mut constructible: Vec<(usize, Vec<Witness>)> = Vec::new();
            let remaining = self.remaining.clone();
            for (k, &t) in remaining.iter().enumerate() {
                if k % 64 == 63 && deadline.expired() {
                    return Ok(self.outcome(folded_now, false, true));
                }
                self.update_tier1(t);
                let ws = self.evaluate(t);
                if !ws.is_empty() {
                    constructible.push((t, ws));
                }
            }

            if constructible.is_empty() {
                // Tier 2: landers.
                self.stats.tier2_sweeps += 1;
                for (k, &t) in remaining.iter().enumerate() {
                    if k % 16 == 15 && deadline.expired() {
                        return Ok(self.outcome(folded_now, false, true));
                    }
                    self.update_landers(t);
                    let ws = self.evaluate(t);
                    if !ws.is_empty() {
                        constructible.push((t, ws));
                    }
                }
                if constructible.is_empty() {
                    return Ok(self.outcome(folded_now, true, false));
                }
            } else if self.state.line_count() <= LANDER_ENRICH_MAX_LINES {
                // Presentation quality: a line folded by O1/O4 alone may have
                // an easier O5/O6/O7 reading; look for it while the state is
                // small enough for the lander scan to be cheap.
                for (t, ws) in &mut constructible {
                    let best = choose(ws).map(|i| ws[i].axiom);
                    if matches!(best, Some(1 | 4)) {
                        self.update_landers(*t);
                        *ws = self.evaluate(*t);
                    }
                }
            }

            // Fold the ones the folder could finish, and let the rest wait a
            // sweep in the hope that these give them the landmark they lack.
            // Never a requirement: a sweep with nothing fully constructible
            // folds what it can sight, exactly as it always did, so the closure
            // cannot stall on this and no pattern stops planning.
            if self.prefer_findable_ends {
                let findable = self.ends_findable(&constructible);
                if findable.iter().any(|&f| f) {
                    constructible = constructible
                        .into_iter()
                        .zip(findable)
                        .filter(|(_, f)| *f)
                        .map(|(c, _)| c)
                        .collect();
                }
            }

            self.round += 1;
            self.stats.rounds += 1;
            let round = self.round;
            let mut folded_targets: Vec<usize> = Vec::with_capacity(constructible.len());
            let mut failed = None;
            for (t, ws) in constructible {
                if let Err(e) = self.fold_target(t, ws, round) {
                    // The cap: what this round folded before it is on the
                    // paper, and must not stay remaining as well.
                    failed = Some(e);
                    break;
                }
                folded_targets.push(t);
                folded_now += 1;
            }
            self.remaining.retain(|t| !folded_targets.contains(t));
            if let Some(e) = failed {
                return Err(e);
            }
        }
    }

    /// Record what a fold just laid down on the paper.
    ///
    /// A fold runs the width of the sheet, but the *pattern* usually only wants
    /// part of that chord. An auxiliary line has no target and creases whole —
    /// [`crate::pinch`] may cut it back later, but only to marks that are used.
    fn record_crease(&mut self, line_id: usize, line: &Line, target: Option<usize>) {
        let Closure {
            creased,
            state,
            targets,
            ..
        } = self;
        match target.map(|t| &targets[t].spans) {
            Some(spans) if !spans.is_empty() => creased.add_spans(state, line_id, line, spans),
            _ => creased.add_whole(state, line_id),
        }
    }

    fn outcome(&self, folded: usize, fixpoint: bool, budget_hit: bool) -> CloseOutcome {
        CloseOutcome {
            folded,
            remaining: self.remaining.len(),
            fixpoint,
            budget_hit,
        }
    }

    fn fold_target(
        &mut self,
        t: usize,
        ws: Vec<Witness>,
        round: u32,
    ) -> Result<usize, PrecreaseError> {
        let line = self.targets[t].line;
        let outcome = self.state.add_line(line, LineTag::Cp)?;
        let chosen = choose(&ws);
        let complete = self.facts[t].facts.landers_computed;
        self.record_crease(outcome.id, &line, Some(t));
        self.folded.push(FoldedLine {
            line_id: outcome.id,
            line,
            tag: LineTag::Cp,
            target: Some(t),
            round,
            witnesses: ws,
            chosen,
            witnesses_complete: complete,
            approximation: None,
            folded_as: None,
            grid: None,
        });
        // Release the facts of a folded target.
        self.facts[t] = TargetFacts::default();
        Ok(outcome.id)
    }

    /// Fold an externally chosen line (an auxiliary fold from the stuck
    /// search or a ReferenceFinder solution) if — and only if — some axiom
    /// application in the current state reproduces it. A line equal to a
    /// remaining target is folded as that target.
    pub fn fold_line(&mut self, line: Line, tag: LineTag) -> Result<FoldOutcome, PrecreaseError> {
        if !self.state.sheet().crosses(&line) {
            return Ok(FoldOutcome::OffSheet);
        }
        if let Some(id) = self.state.find_line(&line) {
            return Ok(FoldOutcome::AlreadyFolded { line_id: id });
        }
        // A line an approximation was folded *as* is a crease on the paper
        // even though the state carries the pattern's line in its place:
        // folding it again would tell the folder to make the same crease
        // twice.
        if let Some(made) = self
            .folded
            .iter()
            .find(|f| f.folded_as.is_some_and(|l| l.approx_eq(&line)))
        {
            return Ok(FoldOutcome::AlreadyFolded {
                line_id: made.line_id,
            });
        }
        let ws = all_witnesses(&self.state, &line);
        if ws.is_empty() {
            return Ok(FoldOutcome::NotConstructible);
        }
        self.round += 1;
        let round = self.round;
        if let Some(t) = self.target_of(&line)
            && self.remaining.contains(&t)
        {
            let id = self.fold_target(t, ws, round)?;
            self.remaining.retain(|&x| x != t);
            return Ok(FoldOutcome::Folded {
                line_id: id,
                cp_target: Some(t),
            });
        }
        let outcome = self.state.add_line(line, tag)?;
        let chosen = choose(&ws);
        self.record_crease(outcome.id, &line, None);
        self.folded.push(FoldedLine {
            line_id: outcome.id,
            line,
            tag,
            target: None,
            round,
            witnesses: ws,
            chosen,
            witnesses_complete: true,
            approximation: None,
            folded_as: None,
            grid: None,
        });
        Ok(FoldOutcome::Folded {
            line_id: outcome.id,
            cp_target: None,
        })
    }

    /// Pleat `grid` into the paper: every line of every family, creased along
    /// its whole chord, before anything is closed.
    ///
    /// A grid line the pattern contains is folded as that target; every other
    /// is a [`LineTag::Grid`] auxiliary — the technique, not a mark, which is
    /// why the pinch pass leaves it alone. No line records a witness: a grid
    /// is made by pleating, edge to edge, not sighted line by line, and the
    /// card for it says so. The closure, the stuck search and everything
    /// after then run over a state that already carries the grid.
    ///
    /// Only meaningful on a closure nothing has been folded on; called on any
    /// other it still folds what it is given, but the grid then is not the
    /// first thing on the paper, and the plan says it is.
    ///
    /// On the point cap the lines already pleated stay on the paper and are
    /// reported as the grid — the folder made them — and the rest are never
    /// added; the error says why.
    pub fn fold_grid(&mut self, grid: Grid) -> Result<(), PrecreaseError> {
        self.round += 1;
        let round = self.round;
        // Every line the grid names, in family order, before any is added:
        // the grid is recorded first so that a cap partway through still
        // reports the lines that made it onto the paper.
        let lines: Vec<(usize, usize, Line, Option<usize>)> = grid
            .families
            .iter()
            .enumerate()
            .flat_map(|(fi, family)| {
                family
                    .lines
                    .iter()
                    .enumerate()
                    .map(move |(li, gl)| (fi, li, gl.line, gl.target))
            })
            .collect();
        self.grid = Some(grid);
        for (fi, li, line, target) in lines {
            if self.state.find_line(&line).is_some() {
                continue;
            }
            let target = target.filter(|t| self.remaining.contains(t));
            let tag = if target.is_some() {
                LineTag::Cp
            } else {
                LineTag::Grid
            };
            let outcome = self.state.add_line(line, tag)?;
            // The pleat creases the whole line, whatever part of it the
            // pattern wants.
            self.creased.add_whole(&self.state, outcome.id);
            self.folded.push(FoldedLine {
                line_id: outcome.id,
                line,
                tag,
                target,
                round,
                witnesses: Vec::new(),
                chosen: None,
                witnesses_complete: true,
                approximation: None,
                folded_as: None,
                grid: Some(GridRef {
                    family: fi,
                    line: li,
                }),
            });
            if let Some(t) = target {
                self.facts[t] = TargetFacts::default();
                self.remaining.retain(|&x| x != t);
            }
        }
        Ok(())
    }

    /// The folded record of state line `id`, if the closure folded it.
    pub fn folded_by_line_id(&self, id: usize) -> Option<&FoldedLine> {
        self.folded.iter().find(|f| f.line_id == id)
    }

    /// Fold remaining target `t` by the closest construction there is:
    /// `constructed` is a line some axiom application in the current state
    /// reproduces exactly, `err` how far it lands from the target, in sheet
    /// units.
    ///
    /// What goes into the state is the **target's** line, not the
    /// construction's: the pattern's later lines are drawn from the
    /// pattern's own geometry, and closing them against it lets them inherit
    /// this one error rather than each finding its own. What the fold records
    /// is the construction's witnesses, with the error on them, and
    /// `folded_as` naming the line they make — the line the folder is shown.
    /// Nothing certifies the target against the state, by design: there is
    /// no exact construction, which is why this exists.
    ///
    /// `NotConstructible` when the state has no exact construction of
    /// `constructed` — the driver was meant to fold the steps that lead to it
    /// first — and `AlreadyFolded` when the target is.
    pub fn fold_approximation(
        &mut self,
        t: usize,
        constructed: Line,
        err: f64,
    ) -> Result<FoldOutcome, PrecreaseError> {
        if !self.remaining.contains(&t) {
            return Ok(match self.state.find_line(&self.targets[t].line) {
                Some(id) => FoldOutcome::AlreadyFolded { line_id: id },
                None => FoldOutcome::NotConstructible,
            });
        }
        let line = self.targets[t].line;
        if !self.state.sheet().crosses(&line) {
            return Ok(FoldOutcome::OffSheet);
        }
        let ws = all_witnesses(&self.state, &constructed);
        if ws.is_empty() {
            return Ok(FoldOutcome::NotConstructible);
        }
        self.round += 1;
        let round = self.round;
        let outcome = self.state.add_line(line, LineTag::Cp)?;
        let chosen = choose(&ws);
        self.record_crease(outcome.id, &line, Some(t));
        self.folded.push(FoldedLine {
            line_id: outcome.id,
            line,
            tag: LineTag::Cp,
            target: Some(t),
            round,
            witnesses: ws,
            chosen,
            witnesses_complete: true,
            approximation: Some(err),
            folded_as: Some(constructed),
            grid: None,
        });
        self.facts[t] = TargetFacts::default();
        self.remaining.retain(|&x| x != t);
        Ok(FoldOutcome::Folded {
            line_id: outcome.id,
            cp_target: Some(t),
        })
    }

    /// Every certified witness for `line` against the **current** state
    /// (all tiers), whether or not it is folded.
    pub fn witnesses_now(&self, line: &Line) -> Vec<Witness> {
        all_witnesses(&self.state, line)
    }

    /// The remaining targets' lines.
    pub fn remaining_lines(&self) -> Vec<(usize, Line)> {
        self.remaining
            .iter()
            .map(|&t| (t, self.targets[t].line))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::{Deadline, frozen_clock};
    use crate::state::DEFAULT_POINT_CAP;

    fn targets(lines: &[Line]) -> Vec<Target> {
        lines
            .iter()
            .enumerate()
            .map(|(i, l)| Target::unassigned(*l, vec![i as u32 + 1]))
            .collect()
    }

    fn v(x: f64) -> Line {
        Line::new([1.0, 0.0], x).expect("line")
    }

    fn h(y: f64) -> Line {
        Line::new([0.0, 1.0], y).expect("line")
    }

    fn unbounded() -> Deadline {
        Deadline::unbounded(frozen_clock())
    }

    #[test]
    fn a_round_cut_short_by_the_point_cap_keeps_its_folds_out_of_remaining() {
        // Eight verticals and eight horizontals close in one round from the
        // bare sheet; a cap that trips partway leaves what was folded folded,
        // and nothing both folded and remaining.
        let lines: Vec<Line> = (1..8)
            .flat_map(|k| [v(k as f64 / 8.0), h(k as f64 / 8.0)])
            .collect();
        let mut c = Closure::new(Sheet::unit_square(), targets(&lines), 40);
        let err = c.close(&unbounded()).expect_err("the cap trips");
        assert!(matches!(err, PrecreaseError::PointCap { .. }));
        assert!(!c.folded().is_empty());
        for f in c.folded() {
            let t = f.target.expect("a target");
            assert!(
                !c.remaining().contains(&t),
                "target {t} is folded and remaining"
            );
        }
        assert_eq!(c.folded().len() + c.remaining().len(), lines.len());
    }

    #[test]
    fn halves_and_quarters_close_in_two_rounds() {
        let mut c = Closure::new(
            Sheet::unit_square(),
            targets(&[v(0.25), v(0.5), v(0.75), h(0.5)]),
            DEFAULT_POINT_CAP,
        );
        let out = c.close(&unbounded()).expect("close");
        assert_eq!(out.folded, 4);
        assert!(out.fixpoint && !out.budget_hit);
        assert!(c.is_complete());
        // x = ½ and y = ½ in round 1, the quarters in round 2.
        let round_of = |x: f64| {
            c.folded()
                .iter()
                .find(|f| f.line.approx_eq(&v(x)))
                .map(|f| f.round)
        };
        assert_eq!(round_of(0.5), Some(1));
        assert_eq!(round_of(0.25), Some(2));
        assert_eq!(round_of(0.75), Some(2));
        // Every folded line has a chosen witness with a tiny residual.
        for f in c.folded() {
            let w = f.chosen_witness().expect("witness");
            assert!(w.err < 1e-12);
            assert_eq!(w.axiom, 2, "{f:?}"); // corner/mark onto mark
        }
    }

    #[test]
    fn a_third_is_stuck_from_the_bare_sheet_and_frees_after_a_landmark() {
        let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("line");
        let anti = Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("line");
        let mut c = Closure::new(
            Sheet::unit_square(),
            targets(&[v(1.0 / 3.0), v(2.0 / 3.0), diag, anti]),
            DEFAULT_POINT_CAP,
        );
        let out = c.close(&unbounded()).expect("close");
        assert_eq!(out.folded, 2); // the diagonals
        assert!(out.fixpoint);
        assert_eq!(c.remaining(), &[0, 1]);
        // The landmark: x = ½ (auxiliary), then y = 2x through the corner and
        // (½, 1); it meets the anti-diagonal at (⅓, ⅔).
        let mid = c.fold_line(v(0.5), LineTag::Aux).expect("fold");
        assert!(matches!(
            mid,
            FoldOutcome::Folded {
                cp_target: None,
                ..
            }
        ));
        let y2x = Line::from_points([0.0, 0.0], [0.5, 1.0]).expect("line");
        let aux = c.fold_line(y2x, LineTag::Aux).expect("fold");
        assert!(matches!(aux, FoldOutcome::Folded { .. }), "{aux:?}");
        assert!(c.state().has_point([1.0 / 3.0, 2.0 / 3.0]));
        let out = c.close(&unbounded()).expect("close");
        assert_eq!(out.folded, 2, "{:?}", c.remaining());
        assert!(c.is_complete());
        // x = ⅓ came first (O4 through the new mark), x = ⅔ after it (O2).
        let third = c
            .folded()
            .iter()
            .find(|f| f.line.approx_eq(&v(1.0 / 3.0)))
            .expect("third");
        let two_thirds = c
            .folded()
            .iter()
            .find(|f| f.line.approx_eq(&v(2.0 / 3.0)))
            .expect("two thirds");
        assert!(third.round < two_thirds.round);
        assert_eq!(two_thirds.chosen_witness().expect("w").axiom, 2);
    }

    #[test]
    fn fold_line_refuses_what_nothing_constructs_and_recognises_targets() {
        let mut c = Closure::new(Sheet::unit_square(), targets(&[v(0.5)]), DEFAULT_POINT_CAP);
        assert_eq!(
            c.fold_line(v(1.0 / 3.0), LineTag::RfAux).expect("fold"),
            FoldOutcome::NotConstructible
        );
        assert_eq!(
            c.fold_line(Line::new([0.0, 1.0], 1.5).expect("l"), LineTag::Aux)
                .expect("fold"),
            FoldOutcome::OffSheet
        );
        // Folding the target itself through fold_line counts as the CP fold.
        let out = c.fold_line(v(0.5), LineTag::RfAux).expect("fold");
        assert!(matches!(
            out,
            FoldOutcome::Folded {
                cp_target: Some(0),
                ..
            }
        ));
        assert!(c.is_complete());
        assert_eq!(c.folded()[0].tag, LineTag::Cp);
        assert!(matches!(
            c.fold_line(v(0.5), LineTag::Aux).expect("fold"),
            FoldOutcome::AlreadyFolded { .. }
        ));
    }

    #[test]
    fn edge_targets_are_free() {
        let c = Closure::new(
            Sheet::unit_square(),
            targets(&[v(0.0), h(1.0), v(0.5)]),
            DEFAULT_POINT_CAP,
        );
        assert_eq!(c.free_targets(), &[0, 1]);
        assert_eq!(c.remaining(), &[2]);
    }

    #[test]
    fn a_budget_hit_mid_closure_resumes_to_the_same_fixpoint() {
        use std::sync::atomic::{AtomicU64, Ordering};
        fn ticking() -> f64 {
            static T: AtomicU64 = AtomicU64::new(0);
            T.fetch_add(1, Ordering::Relaxed) as f64
        }
        let mut c = Closure::new(
            Sheet::unit_square(),
            targets(&[v(0.25), v(0.5)]),
            DEFAULT_POINT_CAP,
        );
        // Expires on the second read: round 1 folds x = ½, then the next
        // loop iteration sees the deadline.
        let short = Deadline::after(ticking, 2.0);
        let out = c.close(&short).expect("close");
        assert!(out.budget_hit && !out.fixpoint, "{out:?}");
        assert_eq!(out.folded, 1);
        assert_eq!(c.remaining().len(), 1);
        let out = c.close(&unbounded()).expect("close");
        assert!(out.fixpoint && c.is_complete(), "{out:?}");
        assert_eq!(c.folded().len(), 2);
    }

    #[test]
    fn duplicate_targets_are_planned_once() {
        let mut c = Closure::new(
            Sheet::unit_square(),
            targets(&[v(0.5), v(0.5 + 1e-9)]),
            DEFAULT_POINT_CAP,
        );
        assert_eq!(c.remaining().len(), 1);
        c.close(&unbounded()).expect("close");
        assert!(c.is_complete());
        assert_eq!(c.folded().len(), 1);
    }
}
