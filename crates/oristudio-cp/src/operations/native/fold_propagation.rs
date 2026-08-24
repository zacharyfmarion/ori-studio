//! Spreading fold angles outward from what is already decided.
//!
//! Ori Studio original. [`crate::solve_k`] answers one vertex; this runs that
//! answer across the sheet, committing **only where the answer is unique** and
//! reporting everywhere it will not guess.
//!
//! # A worklist, not a wave
//!
//! The obvious implementation is a breadth-first pass out from a seed. It is
//! wrong, and measurably so: a vertex with four unknowns when the wave first
//! reaches it stays unsolved even after its neighbours later reduce it to two.
//! So every commit re-queues the vertices at both ends of the crease it changed,
//! and the pass runs to a **fixpoint**.
//!
//! That also buys a property worth stating, because it is what makes the result
//! trustworthy rather than an artefact of where the user clicked: determined-only
//! propagation is **confluent**. "Determined" only ever grows, so the set of
//! creases this can solve is the same whatever order the queue is drained in.
//! The seed decides which questions surface first and which region the user sees
//! resolve — not what the answer is.
//!
//! # Why the seed still matters
//!
//! Because the user's *pins* are the real input. Measured on real designs, a
//! single seed on its own commits almost nothing — 1,312 runs across 13 designs
//! committed 121 creases in total, and 9 of those designs committed **zero** —
//! for a structural reason: seeding one vertex reveals exactly one crease at
//! each neighbour, so a degree-*d* neighbour sits at k = d-1, and determinacy
//! needs k <= 3. Only degree-4-or-less neighbours can move at all.
//!
//! The feature is therefore a **draft the user edits**, not a one-shot fill.
//! Propagate, look, adjust a crease, propagate again. Each adjustment is both a
//! branch resolution and a fresh seed, and the loop converges exactly: with a
//! user answering, every measured run reached full coverage with a
//! reconstruction error of 0.0 degrees.
//!
//! # What it refuses to do
//!
//! Commit anything that is not the single, isolated answer. A vertex with two
//! valid foldings is a **question**, not a coin flip — see [`crate::solve_k`] on
//! why `+180` and `-180` are a real mountain/valley choice that the closure math
//! cannot settle. Those surface as [`StallReason::Branching`] and wait.
//!
//! # Scope: the fan sees the whole document, the scope limits the commits
//!
//! **This is the single most dangerous thing in the module to get wrong.**
//!
//! A user with several patterns laid out on one canvas expects a click on one
//! of them to solve *that* one. [`Scope`] is how that is expressed — and it is a
//! **write mask, and nothing else**. Every fan is still built against the whole
//! document by [`crate::solve_k::solve_fan_at`], which takes the model, not the
//! scope.
//!
//! The reason is the closure condition: it involves **every** crease incident to
//! a vertex. Build the fan from the in-scope creases alone and the closure
//! product is a product over the wrong set, so the solver returns confident,
//! wrong angles. That is the same failure [`crate::solve_k::SolveFan`] exists to
//! avoid — `checks_spatial`'s checker fan drops unassigned creases, which is
//! right for a checker and wrong for a solver.
//!
//! The scope therefore enters in exactly two places, and neither is the fan:
//!
//! 1. **Which vertices are visited** — [`Scope::vertices`], the queue and the
//!    stall census.
//! 2. **Which unknowns may be written** — the gate before [`solve_k`], not
//!    after it. See [`StallReason::OutOfScope`] for why a vertex whose unknowns
//!    are only partly writable is skipped entirely rather than partly committed.

use std::collections::VecDeque;

use crate::crease_graph::EndpointGraph;
use crate::geometry::{LineColor, Point};
use crate::model::{CreasePatternModel, crease_fold_angle};
use crate::solve_fold_angles::NoSolution;
use crate::solve_k::{Determinacy, SolveFan, solve_fan_at, solve_k};

/// The largest `k` a commit is allowed to come from.
///
/// k = 3 is exactly determined but yields a unique answer only ~5% of the time
/// on real geometry, so most of what it produces is a question rather than a
/// commit. k <= 2 is the useful default; the cap is a caller's knob rather than
/// a constant so the tool can offer it.
pub const DEFAULT_MAX_COMMIT_K: usize = 2;

/// Why propagation stopped at a vertex.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StallReason {
    /// More free creases than closure can pin down — `k >= 4`, or a
    /// rank-deficient `k <= 3`. Both reduce to the same instruction for the
    /// user, which is to give one more crease in the region an angle.
    Underdetermined,
    /// Several distinct foldings close this vertex. A real question.
    Branching,
    /// No angles close it. Usually means a neighbour is already wrong.
    Unsolvable,
    /// Above the caller's `max_commit_k`, so it was never attempted.
    AboveCap,
    /// Solvable, but at least one of its unknowns is outside the scope, so the
    /// answer is one this run is not allowed to act on.
    ///
    /// **The vertex is skipped whole, never partly committed**, for three
    /// reasons in ascending order of force:
    ///
    /// 1. [`solve_k`] returns one joint answer over *all* the vertex's unknowns.
    ///    Taking one coordinate of a solution to a simultaneous system is not a
    ///    solution to anything.
    /// 2. The module's posture is already to decline rather than half-answer —
    ///    see [`StallReason::Underdetermined`] and the header.
    /// 3. **The decisive one.** Filtering at *write* time would leak out of the
    ///    scope. Propagation works on a clone and every commit is immediately
    ///    visible to the next solve, so writing crease A while withholding its
    ///    partner B makes A a *known* angle in the fan at its far endpoint —
    ///    and B's implied value silently becomes an input to in-scope answers
    ///    elsewhere on the sheet. The vertex would also sit at k = 1 forever,
    ///    re-solving B and never writing it, which makes the census's
    ///    "`Determined` here would mean the fixpoint was not reached" branch
    ///    reachable and wrong.
    ///
    /// So the gate is at *vertex selection*, before the solve — which is also
    /// cheaper than solving. This reason can only arise from a selection scope:
    /// a connected component is vertex-closed by construction, so every crease
    /// at a component vertex is in that component.
    OutOfScope,
}

/// One place propagation stopped.
#[derive(Debug, Clone, PartialEq)]
pub struct Stall {
    pub point: Point,
    pub reason: StallReason,
    /// How many creases at this vertex are still free.
    pub unknowns: usize,
    /// The distinct foldings on offer, when the reason is
    /// [`StallReason::Branching`]. Each is `(line index, signed degrees)`.
    pub options: Vec<Vec<(usize, f64)>>,
}

/// How a scope was arrived at, for a tool that has to name it to the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ScopeKind {
    /// The creases the user had selected.
    Selection,
    /// The connected component the user clicked in.
    Component,
    /// Every crease in the document.
    ///
    /// Reachable from Rust and any headless caller, and deliberately **not**
    /// constructed by the command arms: a UI run with neither a selection nor a
    /// seed refuses, because "no scope means the whole canvas" is exactly the
    /// behaviour scoping exists to remove.
    #[default]
    Document,
}

/// Which creases a propagation run may write, and which vertices it may visit.
///
/// **A write mask, and nothing else.** The fan is always built against the whole
/// document — see the module docs on why building it from the scope produces
/// confident, wrong angles.
#[derive(Debug, Clone, PartialEq)]
pub struct Scope {
    kind: ScopeKind,
    /// Dense per-document-line mask, so the gate before a solve is an index
    /// rather than a search.
    writable: Vec<bool>,
    /// The in-scope line indices, ascending.
    creases: Vec<usize>,
    /// Representative vertices worth visiting, in the order to visit them.
    vertices: Vec<Point>,
}

impl Scope {
    /// The creases the user selected.
    ///
    /// The vertices are the endpoints of the selected creases that are still
    /// **unassigned**, because a commit only ever happens where an unknown
    /// lives, and every commit re-queues the endpoints of the crease it changed.
    ///
    /// An auxiliary line is dropped rather than honoured: it is a construction
    /// guide with no fold angle, and writing one would turn it into a crease the
    /// user never drew.
    pub fn creases(model: &CreasePatternModel, indices: &[usize]) -> Self {
        let graph = EndpointGraph::build(model);
        let mut writable = vec![false; model.line_segments.len()];
        let mut creases: Vec<usize> = Vec::new();
        for &index in indices {
            let Some(segment) = model.line_segments.get(index) else {
                continue;
            };
            if segment.color == LineColor::Cyan3 || writable[index] {
                continue;
            }
            writable[index] = true;
            creases.push(index);
        }
        creases.sort_unstable();

        let mut seen = vec![false; graph.vertex_count()];
        let mut vertices = Vec::new();
        for &index in &creases {
            if model.line_segments[index].color != LineColor::None {
                continue;
            }
            let Some(ends) = graph.ends_of(index) else {
                continue;
            };
            for end in ends {
                if !seen[end] {
                    seen[end] = true;
                    vertices.push(graph.point(end));
                }
            }
        }

        Self {
            kind: ScopeKind::Selection,
            writable,
            creases,
            vertices,
        }
    }

    /// The connected component `seed` lands in — one of the separate patterns
    /// laid out on the canvas.
    ///
    /// `None` when the click named no pattern, which the caller must surface
    /// rather than widen: falling back to the document is the bug.
    pub fn component_at(model: &CreasePatternModel, seed: Point, radius: f64) -> Option<Self> {
        let graph = EndpointGraph::build(model);
        let component = graph.component_at(model, seed, radius)?;
        let creases = graph.creases_in(component);
        let mut writable = vec![false; model.line_segments.len()];
        for &index in &creases {
            writable[index] = true;
        }
        let mut vertices = graph.points_in(component);
        sort_by_distance(&mut vertices, seed);
        Some(Self {
            kind: ScopeKind::Component,
            writable,
            creases,
            vertices,
        })
    }

    /// Every crease in the document, ordered from `seed`.
    ///
    /// What passing no seed used to mean. Kept for tests and headless callers;
    /// the command arms never construct it.
    pub fn document(model: &CreasePatternModel, seed: Option<Point>) -> Self {
        let graph = EndpointGraph::build(model);
        let mut creases = Vec::new();
        let writable: Vec<bool> = (0..model.line_segments.len())
            .map(|index| {
                let present = graph.ends_of(index).is_some();
                if present {
                    creases.push(index);
                }
                present
            })
            .collect();
        let mut vertices = graph.vertices().to_vec();
        if let Some(seed) = seed {
            sort_by_distance(&mut vertices, seed);
        }
        Self {
            kind: ScopeKind::Document,
            writable,
            creases,
            vertices,
        }
    }

    pub fn kind(&self) -> ScopeKind {
        self.kind
    }

    /// The line indices this scope names, ascending.
    pub fn creases_named(&self) -> &[usize] {
        &self.creases
    }

    /// The vertices propagation may visit, in visit order.
    pub fn vertices(&self) -> &[Point] {
        &self.vertices
    }

    /// Unassigned creases **inside the scope**.
    ///
    /// Not the document's free count: a tool reporting "still undecided: N" from
    /// the whole canvas while showing a draft over one pattern is reporting
    /// somebody else's problem.
    pub fn free_in(&self, model: &CreasePatternModel) -> usize {
        self.creases
            .iter()
            .filter(|index| {
                model
                    .line_segments
                    .get(**index)
                    .is_some_and(|segment| segment.color == LineColor::None)
            })
            .count()
    }
}

/// Ordering is presentation, not correctness — the fixpoint is the same either
/// way — but it decides which region resolves under the user's eye.
fn sort_by_distance(points: &mut [Point], seed: Point) {
    points.sort_by(|left, right| {
        seed.distance(*left)
            .partial_cmp(&seed.distance(*right))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}

/// What the scope resolved to, for a tool that has to name it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ScopeReport {
    pub kind: ScopeKind,
    /// Creases the scope names.
    pub creases: usize,
    /// Vertices propagation was allowed to visit.
    pub vertices: usize,
    /// Unassigned creases inside the scope, **before** the draft.
    pub free: usize,
}

/// A draft: what propagation worked out, and everywhere it stopped.
///
/// Nothing here is applied. The caller previews it, lets the user adjust, and
/// re-runs; only an explicit confirm writes it to the document.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Propagation {
    /// `(document line index, signed degrees)`, negative a mountain.
    ///
    /// Every entry is a crease that really changes — `write_angle` declines to
    /// report a write that would leave the segment as it was — and no index
    /// appears twice, so a caller can use these ids directly as the set of
    /// creases a draft stands in for.
    pub solved: Vec<(usize, f64)>,
    pub stalls: Vec<Stall>,
    /// Vertices that ended fully known and **do not close**. Propagation reached
    /// them from two directions and the two answers disagree, so something
    /// upstream — a pin, or the drawn geometry — is inconsistent. Surfacing
    /// these is the cycle-closure test.
    pub closure_failures: Vec<Point>,
    /// What the run was scoped to, so a tool can say *"this pattern"* rather
    /// than implying it worked on everything.
    pub scope: ScopeReport,
}

impl Propagation {
    pub fn is_empty(&self) -> bool {
        self.solved.is_empty()
    }
}

/// Propagate within `scope`, to a fixpoint.
///
/// `pins` are `(line index, signed degrees)` the user has fixed by hand; they
/// are treated as known before the first solve and are never re-derived.
/// `closed_bar` is the acceptance residual in radians.
///
/// `model` is the **whole document** and stays that way: every fan is built
/// against it. `scope` decides only which vertices are visited and which creases
/// may be written. See the module docs.
pub fn propagate(
    model: &CreasePatternModel,
    scope: &Scope,
    pins: &[(usize, f64)],
    max_commit_k: usize,
    closed_bar: f64,
) -> Propagation {
    let scope_report = ScopeReport {
        kind: scope.kind,
        creases: scope.creases.len(),
        vertices: scope.vertices.len(),
        free: scope.free_in(model),
    };
    // Work on a copy so a commit is visible to the next solve without touching
    // the caller's document. The draft is the diff between the two.
    let mut working = model.clone();
    let mut solved: Vec<(usize, f64)> = Vec::new();
    // The same crease pinned twice would otherwise be written twice and reported
    // twice, and `solved` is the set of creases a surface stops drawing on the
    // draft's behalf — a duplicate there is a lie about how much changed. Last
    // value wins, the way any map assignment would.
    let mut effective: Vec<(usize, f64)> = Vec::with_capacity(pins.len());
    for &(index, degrees) in pins {
        match effective.iter_mut().find(|(at, _)| *at == index) {
            Some(held) => held.1 = degrees,
            None => effective.push((index, degrees)),
        }
    }
    // A pin is the user typing an angle at a named crease, so propagation is not
    // deciding it and the scope does not govern it: the writable set is
    // `scope ∪ pins`. In practice a pin always *is* in scope, because it round
    // trips out of the previous scoped preview — stating the union is what lets
    // the adjust-and-re-propagate loop survive a selection change without a
    // silent hole in the invariant.
    let mut writable = scope.writable.clone();
    for &(index, _) in &effective {
        if let Some(slot) = writable.get_mut(index) {
            *slot = true;
        }
    }

    let mut queue: VecDeque<Point> = VecDeque::new();
    for &point in &scope.vertices {
        queue.push_back(point);
    }
    for &(index, degrees) in &effective {
        if write_angle(&mut working, index, degrees) {
            solved.push((index, degrees));
        }
        // A pinned crease's vertices are where the pin can spread from, and a
        // pin outside the scope's own vertex list would otherwise never be
        // looked at.
        for end in endpoints(&working, index) {
            queue.push_back(end);
        }
    }

    // A commit strictly reduces the number of free creases, so the loop
    // terminates; the cap is a backstop against a pathological re-queue, not a
    // budget the algorithm relies on. Sized from the **scope**: a forty-crease
    // selection on a thirty-thousand-segment canvas would otherwise carry a
    // backstop that means nothing.
    let budget = scope.creases.len().saturating_mul(8).max(64);
    let mut steps = 0;

    while let Some(point) = queue.pop_front() {
        steps += 1;
        if steps > budget {
            break;
        }
        // The fan is built against the whole working document, never the scope.
        let fan = solve_fan_at(&working, point);
        let unknowns = fan.unknown_positions();
        if unknowns.is_empty() {
            continue;
        }
        if unknowns.len() > max_commit_k {
            continue;
        }
        // THE SCOPE GATE, and it belongs here rather than in the write loop
        // below. A joint answer whose parts are not all writable is not an
        // answer this run may act on, and filtering at write time would leak the
        // withheld crease's implied value into the rest of the sheet — see
        // [`StallReason::OutOfScope`]. Cheaper than solving, too.
        if !all_writable(&fan, &unknowns, &writable) {
            continue;
        }
        let report = solve_k(&working, &fan, &unknowns, closed_bar);
        if report.no_solution.is_some() || report.verdict != Determinacy::Determined {
            continue;
        }
        let Some(answer) = report.solutions.first() else {
            continue;
        };
        let mut changed = false;
        for &(index, degrees) in &answer.angles {
            if write_angle(&mut working, index, degrees) {
                solved.push((index, degrees));
                changed = true;
                for end in endpoints(&working, index) {
                    queue.push_back(end);
                }
            }
        }
        if changed {
            queue.push_back(point);
        }
    }

    // Only now, at the fixpoint, is it worth asking what is still open. A vertex
    // that branches mid-pass is very often closed by a neighbour before the pass
    // ends — measured, asking eagerly costs up to 71 questions that answer
    // themselves — so the stall census runs once, at the end.
    //
    // The census runs over the **scope's** vertices, for the same reason the
    // draft does: a window that says "6 vertices are stuck" while showing a
    // draft over one pattern is counting other patterns' problems as this
    // draft's.
    let mut stalls = Vec::new();
    let mut closure_failures = Vec::new();
    for &point in &scope.vertices {
        let fan = solve_fan_at(&working, point);
        let unknowns = fan.unknown_positions();
        if unknowns.is_empty() {
            let report = solve_k(&working, &fan, &[], closed_bar);
            if report.no_solution.is_none()
                && report.verdict == Determinacy::Check
                && report.residual_degrees.to_radians() > closed_bar
            {
                closure_failures.push(point);
            }
            continue;
        }
        // Reported ahead of the arity stall because it is the one with an action
        // attached: widen the selection, or clear it and click the pattern.
        if !all_writable(&fan, &unknowns, &writable) {
            stalls.push(Stall {
                point,
                reason: StallReason::OutOfScope,
                unknowns: unknowns.len(),
                options: Vec::new(),
            });
            continue;
        }
        if unknowns.len() > max_commit_k {
            stalls.push(Stall {
                point,
                reason: StallReason::AboveCap,
                unknowns: unknowns.len(),
                options: Vec::new(),
            });
            continue;
        }
        let report = solve_k(&working, &fan, &unknowns, closed_bar);
        // `Unreachable` is not a reason to say nothing — it *is* the finding.
        // `solve_k` sets `no_solution = Some(Unreachable)` on exactly the
        // vertices whose verdict is `Unsolvable`, so skipping every
        // `no_solution` swallowed the whole category: measured, 383 genuinely
        // unsolvable vertices across seven real files were reported as **zero**
        // stalls, which made `StallReason::Unsolvable` dead code. It matters
        // because that is how a *wrong* pin surfaces — the vertex it poisons
        // stops closing, and without this the only symptom is quietly fewer
        // creases solved.
        //
        // The other `no_solution` reasons really are silence: a boundary vertex
        // has no closure condition, and an unsplit junction or a mis-picked
        // crease is a fan this pass cannot read at all.
        match report.no_solution {
            Some(NoSolution::Unreachable) => {
                stalls.push(Stall {
                    point,
                    reason: StallReason::Unsolvable,
                    unknowns: unknowns.len(),
                    options: Vec::new(),
                });
                continue;
            }
            Some(_) => continue,
            None => {}
        }
        let reason = match report.verdict {
            Determinacy::Branching => StallReason::Branching,
            Determinacy::Underdetermined => StallReason::Underdetermined,
            Determinacy::Unsolvable => StallReason::Unsolvable,
            // Determined here would mean the fixpoint was not reached.
            Determinacy::Determined | Determinacy::Check => continue,
        };
        let options = if reason == StallReason::Branching {
            report
                .solutions
                .iter()
                .map(|solution| solution.angles.clone())
                .collect()
        } else {
            Vec::new()
        };
        stalls.push(Stall {
            point,
            reason,
            unknowns: unknowns.len(),
            options,
        });
    }

    Propagation {
        solved,
        stalls,
        closure_failures,
        scope: scope_report,
    }
}

/// Is every one of this vertex's unknowns a crease the run may write?
///
/// `fan.sources` is index-aligned with `fan.creases`, so a fan position maps
/// straight to the document line it came from.
fn all_writable(fan: &SolveFan, unknowns: &[usize], writable: &[bool]) -> bool {
    unknowns.iter().all(|position| {
        fan.sources
            .get(*position)
            .and_then(|source| writable.get(*source))
            .copied()
            .unwrap_or(false)
    })
}

/// Apply a draft to the document. Returns how many creases changed.
pub fn apply(model: &mut CreasePatternModel, solved: &[(usize, f64)]) -> usize {
    crate::operations::color::set_signed_fold_angles(model, solved)
}

/// Write one signed angle, turning an unassigned crease into a real one.
///
/// A thin call into the shared chain, kept only because the propagation loop
/// needs to know whether *this* crease moved, and a count over a one-element
/// slice is the same question.
///
/// It used to be a near-copy of that chain, on the stated grounds that
/// [`crate::operations::color::set_signed_fold_angles`] "skips anything that is
/// not already `Red1`/`Blue2`". That skip turned out to be a bug in the
/// three-crease solve rather than an invariant to work around — it made the tool
/// apply two thirds of its own answer — so the copy has outlived its reason.
/// Two chains for one write is how they came to disagree in the first place.
fn write_angle(model: &mut CreasePatternModel, index: usize, degrees: f64) -> bool {
    crate::operations::color::set_signed_fold_angles(model, &[(index, degrees)]) == 1
}

fn endpoints(model: &CreasePatternModel, index: usize) -> Vec<Point> {
    model
        .line_segments
        .get(index)
        .map(|segment| vec![segment.a, segment.b])
        .unwrap_or_default()
}

/// Every crease whose angle is currently unknown.
pub fn free_line_indices(model: &CreasePatternModel) -> Vec<usize> {
    model
        .line_segments
        .iter()
        .enumerate()
        .filter(|(_, segment)| segment.color == LineColor::None)
        .map(|(index, _)| index)
        .collect()
}

/// The angle a crease carries today, for showing a draft against the document.
pub fn current_angle(model: &CreasePatternModel, index: usize) -> Option<f64> {
    model.line_segments.get(index).and_then(crease_fold_angle)
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_MAX_COMMIT_K, Scope, ScopeKind, StallReason, free_line_indices, propagate,
    };
    use crate::CLOSURE_RESIDUAL_BAR_DEGREES;
    use crate::geometry::{LineColor, Point};
    use crate::io::fold::import_fold_document;
    use crate::model::{CreasePatternModel, crease_fold_angle};
    use treemaker_fold::FoldDocument;

    fn bar() -> f64 {
        CLOSURE_RESIDUAL_BAR_DEGREES.to_radians()
    }

    fn whole(model: &CreasePatternModel) -> Scope {
        Scope::document(model, None)
    }

    fn kabuto() -> CreasePatternModel {
        let text = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../tests/fixtures/flat-folder/kabuto.fold"),
        )
        .expect("fixture");
        let document: FoldDocument = serde_json::from_str(&text).expect("fold json");
        import_fold_document(&document).expect("import")
    }

    /// The reported bug in miniature: two copies of a real pattern, translated
    /// apart, in one document. Returns the model and the offset applied to the
    /// second copy.
    fn two_disjoint_kabutos() -> (CreasePatternModel, f64) {
        const SHIFT: f64 = 1000.0;
        let one = kabuto();
        let mut both = one.clone();
        for segment in &one.line_segments {
            // Cloned rather than rebuilt, so the copy differs from the original
            // in nothing but its position.
            let mut moved = segment.clone();
            moved.a = Point::new(segment.a.x + SHIFT, segment.a.y);
            moved.b = Point::new(segment.b.x + SHIFT, segment.b.y);
            both.line_segments.push(moved);
        }
        (both, SHIFT)
    }

    /// Blank one recoverable crease in each copy of [`two_disjoint_kabutos`].
    /// Returns `(model, index in copy A, index in copy B)`.
    fn two_kabutos_with_one_blanked_crease_each() -> (CreasePatternModel, usize, usize) {
        let (both, _) = two_disjoint_kabutos();
        let half = both.line_segments.len() / 2;
        for index in 0..half {
            let segment = both.line_segments[index].clone();
            if crease_fold_angle(&segment).is_none() {
                continue;
            }
            let mut blanked = both.clone();
            for at in [index, index + half] {
                blanked.line_segments[at] = blanked.line_segments[at]
                    .clone()
                    .with_line_color(LineColor::None);
            }
            let draft = propagate(&blanked, &whole(&blanked), &[], DEFAULT_MAX_COMMIT_K, bar());
            if draft.solved.iter().any(|(at, _)| *at == index)
                && draft.solved.iter().any(|(at, _)| *at == index + half)
            {
                return (blanked, index, index + half);
            }
        }
        panic!("no crease is recoverable in both copies");
    }

    /// Blank one crease and propagation must put back exactly what was there.
    /// This is the k=1 contraction, end to end through the worklist.
    #[test]
    fn a_single_blanked_crease_comes_back_exactly() {
        let model = kabuto();
        let mut recovered = 0;
        for index in 0..model.line_segments.len() {
            let segment = model.line_segments[index].clone();
            let Some(truth) = crease_fold_angle(&segment) else {
                continue;
            };
            let mut blanked = model.clone();
            blanked.line_segments[index] = segment.with_line_color(LineColor::None);
            let draft = propagate(&blanked, &whole(&blanked), &[], DEFAULT_MAX_COMMIT_K, bar());
            let Some((_, solved)) = draft.solved.iter().find(|(at, _)| *at == index) else {
                continue;
            };
            assert!(
                (solved - truth).abs() < 1e-3,
                "crease {index} came back {solved} not {truth}"
            );
            recovered += 1;
        }
        assert!(recovered >= 8, "expected real recovery, got {recovered}");
    }

    /// Nothing free means nothing to do — and no stalls invented for a document
    /// that is already complete.
    #[test]
    fn a_complete_document_yields_an_empty_draft() {
        let model = kabuto();
        assert!(free_line_indices(&model).is_empty());
        let draft = propagate(&model, &whole(&model), &[], DEFAULT_MAX_COMMIT_K, bar());
        assert!(draft.solved.is_empty());
        assert!(draft.stalls.is_empty());
    }

    /// The refusal that makes the tool trustworthy: with everything free there is
    /// nothing forced, so it must commit **nothing** rather than pick a folding.
    #[test]
    fn an_entirely_free_document_commits_nothing() {
        let mut model = kabuto();
        for index in 0..model.line_segments.len() {
            let segment = model.line_segments[index].clone();
            if crease_fold_angle(&segment).is_some() {
                model.line_segments[index] = segment.with_line_color(LineColor::None);
            }
        }
        let draft = propagate(&model, &whole(&model), &[], DEFAULT_MAX_COMMIT_K, bar());
        assert!(
            draft.solved.is_empty(),
            "propagation guessed {} creases with nothing to go on",
            draft.solved.len()
        );
    }

    /// A pin is honoured and never re-derived, which is what makes the
    /// adjust-and-re-propagate loop work.
    #[test]
    fn a_pin_is_kept_and_spreads() {
        let model = kabuto();
        let mut blanked = model.clone();
        let mut blanked_indices = Vec::new();
        for index in 0..model.line_segments.len() {
            let segment = model.line_segments[index].clone();
            if crease_fold_angle(&segment).is_some() && blanked_indices.len() < 6 {
                blanked.line_segments[index] = segment.with_line_color(LineColor::None);
                blanked_indices.push(index);
            }
        }
        let pin = blanked_indices[0];
        let truth = crease_fold_angle(&model.line_segments[pin]).expect("crease");
        let draft = propagate(
            &blanked,
            &whole(&blanked),
            &[(pin, truth)],
            DEFAULT_MAX_COMMIT_K,
            bar(),
        );
        let pinned = draft
            .solved
            .iter()
            .find(|(at, _)| *at == pin)
            .expect("the pin must appear in the draft");
        assert!((pinned.1 - truth).abs() < 1e-9, "the pin must not be moved");
    }

    /// Stalls are reported, and an over-cap vertex is named as such rather than
    /// silently skipped — the user has to be told which instruction applies.
    #[test]
    fn stalls_are_reported_with_a_reason() {
        let mut model = kabuto();
        for index in 0..model.line_segments.len() {
            let segment = model.line_segments[index].clone();
            if crease_fold_angle(&segment).is_some() {
                model.line_segments[index] = segment.with_line_color(LineColor::None);
            }
        }
        let draft = propagate(&model, &whole(&model), &[], DEFAULT_MAX_COMMIT_K, bar());
        assert!(!draft.stalls.is_empty(), "an all-free document must stall");
        assert!(
            draft
                .stalls
                .iter()
                .any(|stall| stall.reason == StallReason::AboveCap),
            "expected at least one arity stall, got {:?}",
            draft.stalls.iter().map(|s| s.reason).collect::<Vec<_>>()
        );
    }

    /// A vertex that cannot close must be *reported*, not skipped.
    ///
    /// `solve_k` returns `no_solution = Some(Unreachable)` on exactly the
    /// vertices whose verdict is `Unsolvable`, so an early `continue` on any
    /// `no_solution` made `StallReason::Unsolvable` unreachable — measured, 383
    /// genuinely unsolvable vertices across seven real files reported as zero
    /// stalls. That is the channel a wrong pin surfaces through, so its silence
    /// was the expensive kind.
    #[test]
    fn a_vertex_that_cannot_close_is_reported() {
        let model = kabuto();
        // Poison one crease with an angle its neighbours cannot accommodate,
        // then blank a neighbour so the vertex has something to solve for.
        let mut broken = model.clone();
        let mut poisoned = None;
        for index in 0..broken.line_segments.len() {
            let segment = broken.line_segments[index].clone();
            if crease_fold_angle(&segment).is_some() {
                broken.line_segments[index] = segment
                    .with_line_color(LineColor::Blue2)
                    .with_fold_magnitude(crate::geometry::FoldMagnitude::from_degrees(37.0));
                poisoned = Some(index);
                break;
            }
        }
        assert!(poisoned.is_some());
        for index in 0..broken.line_segments.len() {
            let segment = broken.line_segments[index].clone();
            if Some(index) != poisoned && crease_fold_angle(&segment).is_some() {
                broken.line_segments[index] = segment.with_line_color(LineColor::None);
                break;
            }
        }
        let draft = propagate(&broken, &whole(&broken), &[], DEFAULT_MAX_COMMIT_K, bar());
        let reported = draft.stalls.iter().any(|stall| {
            matches!(
                stall.reason,
                StallReason::Unsolvable | StallReason::Underdetermined | StallReason::Branching
            )
        }) || !draft.closure_failures.is_empty();
        assert!(
            reported,
            "an inconsistent neighbourhood must surface somewhere, got {:?} stalls",
            draft.stalls.len()
        );
    }

    /// `solved` is the set of creases a draft would change, and a surface uses
    /// those ids to stop drawing them. One crease pinned twice must therefore
    /// appear once, carrying the value the caller assigned last.
    #[test]
    fn a_repeated_pin_is_not_reported_twice() {
        let model = kabuto();
        let mut blanked = model.clone();
        let mut cleared = Vec::new();
        for index in 0..model.line_segments.len() {
            let segment = model.line_segments[index].clone();
            if crease_fold_angle(&segment).is_some() && cleared.len() < 4 {
                blanked.line_segments[index] = segment.with_line_color(LineColor::None);
                cleared.push(index);
            }
        }
        let pin = cleared[0];
        let truth = crease_fold_angle(&model.line_segments[pin]).expect("crease");
        let draft = propagate(
            &blanked,
            &whole(&blanked),
            &[(pin, truth / 2.0), (pin, truth)],
            DEFAULT_MAX_COMMIT_K,
            bar(),
        );
        let entries: Vec<_> = draft.solved.iter().filter(|(at, _)| *at == pin).collect();
        assert_eq!(
            entries.len(),
            1,
            "the pin was reported {} times",
            entries.len()
        );
        assert!(
            (entries[0].1 - truth).abs() < 1e-9,
            "the last value must win, got {}",
            entries[0].1
        );
    }

    /// Confluence: the fixpoint does not depend on where the user clicked.
    /// Ordering is presentation only.
    #[test]
    fn the_draft_does_not_depend_on_the_seed() {
        let model = kabuto();
        let mut blanked = model.clone();
        let mut count = 0;
        for index in 0..model.line_segments.len() {
            let segment = model.line_segments[index].clone();
            if crease_fold_angle(&segment).is_some() && count < 4 {
                blanked.line_segments[index] = segment.with_line_color(LineColor::None);
                count += 1;
            }
        }
        let seeds: Vec<_> = blanked
            .line_segments
            .iter()
            .take(6)
            .map(|segment| segment.a)
            .collect();
        let mut baseline: Option<Vec<(usize, f64)>> = None;
        for seed in seeds {
            let draft = propagate(
                &blanked,
                &Scope::document(&blanked, Some(seed)),
                &[],
                DEFAULT_MAX_COMMIT_K,
                bar(),
            );
            let mut sorted = draft.solved.clone();
            sorted.sort_by_key(|entry| entry.0);
            match &baseline {
                None => baseline = Some(sorted),
                Some(first) => assert_eq!(
                    first, &sorted,
                    "the determined set changed with the seed, so a commit was not forced"
                ),
            }
        }
    }

    // -----------------------------------------------------------------------
    // Scope
    // -----------------------------------------------------------------------

    /// **The regression test for the filed bug.** Two patterns on one canvas,
    /// a crease blanked in each, and a selection naming only the first: the
    /// second must be left exactly where it was.
    #[test]
    fn a_selection_confines_the_draft_to_the_selected_creases() {
        let (model, in_a, in_b) = two_kabutos_with_one_blanked_crease_each();
        let scope = Scope::creases(&model, &[in_a]);
        let draft = propagate(&model, &scope, &[], DEFAULT_MAX_COMMIT_K, bar());

        assert_eq!(draft.scope.kind, ScopeKind::Selection);
        assert!(
            draft.solved.iter().any(|(at, _)| *at == in_a),
            "the selected crease must be solved"
        );
        assert!(
            !draft.solved.iter().any(|(at, _)| *at == in_b),
            "propagation reached into the other pattern"
        );
        assert!(
            draft.solved.iter().all(|(at, _)| *at == in_a),
            "the draft named a crease outside the selection: {:?}",
            draft.solved
        );
    }

    /// A click scopes to the pattern it landed in, and nothing else moves.
    #[test]
    fn a_click_scopes_to_the_component_it_lands_in() {
        let (model, in_a, in_b) = two_kabutos_with_one_blanked_crease_each();
        let seed = model.line_segments[in_a].a;
        let scope = Scope::component_at(&model, seed, 1.0).expect("the seed is on a pattern");
        let draft = propagate(&model, &scope, &[], DEFAULT_MAX_COMMIT_K, bar());

        assert_eq!(draft.scope.kind, ScopeKind::Component);
        assert!(draft.solved.iter().any(|(at, _)| *at == in_a));
        assert!(
            !draft.solved.iter().any(|(at, _)| *at == in_b),
            "a seed in one pattern wrote into another"
        );
        let half = model.line_segments.len() / 2;
        assert!(
            draft.solved.iter().all(|(at, _)| *at < half),
            "the component scope leaked into the second copy"
        );
        assert!(
            scope.creases_named().iter().all(|index| *index < half),
            "the two patterns are not separate components"
        );
    }

    /// A stall belongs to the pattern the user is looking at. Measured on a real
    /// multi-pattern document, the unscoped census reported six stalls where the
    /// clicked component had none — other people's patterns, counted as this
    /// draft's problems.
    #[test]
    fn stalls_are_reported_only_inside_the_scope() {
        let (mut model, _) = two_disjoint_kabutos();
        let half = model.line_segments.len() / 2;
        // Break the *second* copy thoroughly, so an unscoped census would be
        // full of it, and blank one crease in the first so there is work to do.
        for index in half..model.line_segments.len() {
            let segment = model.line_segments[index].clone();
            if crease_fold_angle(&segment).is_some() {
                model.line_segments[index] = segment.with_line_color(LineColor::None);
            }
        }
        let seed = model.line_segments[0].a;
        let scope = Scope::component_at(&model, seed, 1.0).expect("the seed is on a pattern");
        let draft = propagate(&model, &scope, &[], DEFAULT_MAX_COMMIT_K, bar());

        let unscoped = propagate(&model, &whole(&model), &[], DEFAULT_MAX_COMMIT_K, bar());
        assert!(
            unscoped.stalls.len() > draft.stalls.len(),
            "the fixture must make the unscoped census noisier"
        );
        for stall in &draft.stalls {
            assert!(
                stall.point.x < 500.0,
                "a stall at {:?} is in the other pattern",
                stall.point
            );
        }
    }

    /// **The trap test.** Scope one blanked crease and nothing else: every other
    /// crease at its vertex is assigned and out of scope, so a fan built from
    /// the scope would be missing most of the closure product. The answer must
    /// still be the original angle.
    #[test]
    fn the_fan_still_sees_creases_outside_the_scope() {
        let model = kabuto();
        let mut checked = 0;
        for index in 0..model.line_segments.len() {
            let segment = model.line_segments[index].clone();
            let Some(truth) = crease_fold_angle(&segment) else {
                continue;
            };
            let mut blanked = model.clone();
            blanked.line_segments[index] = segment.with_line_color(LineColor::None);
            let scope = Scope::creases(&blanked, &[index]);
            let draft = propagate(&blanked, &scope, &[], DEFAULT_MAX_COMMIT_K, bar());
            let Some((_, solved)) = draft.solved.iter().find(|(at, _)| *at == index) else {
                continue;
            };
            assert!(
                (solved - truth).abs() < 1e-3,
                "crease {index} came back {solved} not {truth} — the fan was built \
                 from the scope instead of the document"
            );
            checked += 1;
        }
        assert!(
            checked >= 4,
            "expected real single-crease coverage, got {checked}"
        );
    }

    /// A single degree-4 vertex, alone, whose four creases really close in 3D.
    ///
    /// The sector angles and starting values are the ones
    /// `lib.rs`'s `solving_three_fold_angles_closes_the_vertex` uses — the
    /// shipped proof that this fan closes once three of its creases are solved.
    /// Kabuto cannot stand in here: it is flat-folded, so every crease is a full
    /// fold, and a k=2 vertex there is the `+180`/`-180` question rather than a
    /// commit. And it has to be *alone*, because a two-unknown vertex in a real
    /// document can legitimately have one of its creases forced from the far
    /// end, which would hide the thing being tested.
    fn a_closed_generic_vertex() -> (CreasePatternModel, Point, Vec<usize>) {
        let centre = Point::new(0.0, 0.0);
        let mut model = CreasePatternModel::default();
        let mut indices = Vec::new();
        for (theta, rho) in [
            (0.0_f64, 90.0_f64),
            (45.0, 180.0),
            (90.0, -90.0),
            (225.0, 30.0),
        ] {
            let radians = theta.to_radians();
            indices.push(model.line_segments.len());
            model.line_segments.push(
                crate::geometry::LineSegment::with_color(
                    centre,
                    Point::new(150.0 * radians.cos(), 150.0 * radians.sin()),
                    if rho < 0.0 {
                        LineColor::Red1
                    } else {
                        LineColor::Blue2
                    },
                )
                .with_fold_magnitude(crate::geometry::FoldMagnitude::from_degrees(rho.abs())),
            );
        }
        let solved = crate::solve_fold_angles::vertex_angle_solutions(
            &model,
            centre,
            &[indices[0], indices[2], indices[3]],
            bar(),
        );
        let answer = solved.solutions.first().expect("the fan closes");
        for &(index, degrees) in &answer.creases {
            super::write_angle(&mut model, index, degrees);
        }
        (model, centre, indices)
    }

    /// A vertex whose unknowns are only partly in scope commits **nothing** and
    /// says so. Committing one of two unknowns would leave the vertex open, and
    /// the withheld crease's implied value would leak onward as a known angle.
    #[test]
    fn a_vertex_with_an_unknown_outside_the_scope_commits_nothing() {
        let (closed, centre, indices) = a_closed_generic_vertex();

        // Whichever pair of this vertex's creases is a genuine k=2 commit. The
        // pair is found rather than asserted so the test is about the scope, not
        // about which two creases happen to be determined.
        let mut fixture = None;
        for left in 0..indices.len() {
            for right in (left + 1)..indices.len() {
                let mut blanked = closed.clone();
                for at in [indices[left], indices[right]] {
                    blanked.line_segments[at] = blanked.line_segments[at]
                        .clone()
                        .with_line_color(LineColor::None);
                }
                let unscoped =
                    propagate(&blanked, &whole(&blanked), &[], DEFAULT_MAX_COMMIT_K, bar());
                if unscoped.solved.len() == 2 {
                    fixture = Some((blanked, indices[left]));
                    break;
                }
            }
            if fixture.is_some() {
                break;
            }
        }
        let (blanked, in_scope) =
            fixture.expect("no k=2 commit at the fixture vertex, so the scope proves nothing");

        let scope = Scope::creases(&blanked, &[in_scope]);
        let draft = propagate(&blanked, &scope, &[], DEFAULT_MAX_COMMIT_K, bar());
        assert!(
            draft.solved.is_empty(),
            "half a joint answer was committed: {:?}",
            draft.solved
        );
        let stall = draft
            .stalls
            .iter()
            .find(|stall| stall.reason == StallReason::OutOfScope)
            .expect("the vertex must be reported, not silently skipped");
        assert_eq!(
            stall.unknowns, 2,
            "the stall must report the whole vertex, not the in-scope part"
        );
        assert!(stall.point.distance(centre) < 1e-6);
    }

    /// The crease outside the scope is never written, whatever else happens.
    /// This is the invariant the partial-commit refusal exists to protect, on a
    /// real document rather than an isolated fan.
    #[test]
    fn an_unknown_outside_the_scope_is_never_written() {
        let model = kabuto();
        let mut checked = 0;
        for index in 0..model.line_segments.len() {
            let segment = model.line_segments[index].clone();
            if crease_fold_angle(&segment).is_none() {
                continue;
            }
            let vertex = segment.a;
            let Some(partner) = model
                .line_segments
                .iter()
                .enumerate()
                .position(|(at, other)| {
                    at != index
                        && crease_fold_angle(other).is_some()
                        && (other.a.distance(vertex) < 1e-9 || other.b.distance(vertex) < 1e-9)
                })
            else {
                continue;
            };
            let mut blanked = model.clone();
            for at in [index, partner] {
                blanked.line_segments[at] = blanked.line_segments[at]
                    .clone()
                    .with_line_color(LineColor::None);
            }
            let draft = propagate(
                &blanked,
                &Scope::creases(&blanked, &[index]),
                &[],
                DEFAULT_MAX_COMMIT_K,
                bar(),
            );
            assert!(
                !draft.solved.iter().any(|(at, _)| *at == partner),
                "crease {partner} was written while outside the scope"
            );
            // And whatever *was* committed is still the truth, because the fan
            // never stopped seeing the whole document.
            for &(at, degrees) in &draft.solved {
                let truth = crease_fold_angle(&model.line_segments[at]).expect("crease");
                assert!(
                    (degrees - truth).abs() < 1e-3,
                    "crease {at} came back {degrees} not {truth}"
                );
            }
            checked += 1;
            if checked >= 8 {
                return;
            }
        }
        assert!(
            checked > 0,
            "no vertex in the fixture has two blankable creases"
        );
    }

    /// A pin is the user's own answer, so it is honoured whether or not the
    /// scope names it — `writable` is `scope ∪ pins`.
    #[test]
    fn an_out_of_scope_pin_is_still_honoured() {
        let model = kabuto();
        let mut blanked = model.clone();
        let mut cleared = Vec::new();
        for index in 0..model.line_segments.len() {
            let segment = model.line_segments[index].clone();
            if crease_fold_angle(&segment).is_some() && cleared.len() < 2 {
                blanked.line_segments[index] = segment.with_line_color(LineColor::None);
                cleared.push(index);
            }
        }
        let pin = cleared[0];
        let elsewhere = cleared[1];
        let truth = crease_fold_angle(&model.line_segments[pin]).expect("crease");
        // The scope deliberately names the *other* crease.
        let scope = Scope::creases(&blanked, &[elsewhere]);
        let draft = propagate(
            &blanked,
            &scope,
            &[(pin, truth)],
            DEFAULT_MAX_COMMIT_K,
            bar(),
        );
        let written = draft
            .solved
            .iter()
            .find(|(at, _)| *at == pin)
            .expect("a pin must be written even when the scope does not name it");
        assert!((written.1 - truth).abs() < 1e-9);
    }

    /// Confluence, scoped: the answer inside a component still does not depend
    /// on which of its vertices the user clicked.
    #[test]
    fn the_scoped_draft_does_not_depend_on_the_seed() {
        let (model, in_a, _) = two_kabutos_with_one_blanked_crease_each();
        let half = model.line_segments.len() / 2;
        let seeds: Vec<Point> = model.line_segments[..half]
            .iter()
            .take(6)
            .map(|segment| segment.a)
            .collect();
        let mut baseline: Option<Vec<(usize, f64)>> = None;
        for seed in seeds {
            let scope = Scope::component_at(&model, seed, 1.0).expect("seed on the pattern");
            let draft = propagate(&model, &scope, &[], DEFAULT_MAX_COMMIT_K, bar());
            assert!(draft.solved.iter().any(|(at, _)| *at == in_a));
            let mut sorted = draft.solved.clone();
            sorted.sort_by_key(|entry| entry.0);
            match &baseline {
                None => baseline = Some(sorted),
                Some(first) => assert_eq!(
                    first, &sorted,
                    "the scoped determined set changed with the seed"
                ),
            }
        }
    }

    /// The scope reports what it was, and its free count is its own — not the
    /// canvas's.
    #[test]
    fn the_scope_reports_its_own_free_count() {
        let (model, in_a, _) = two_kabutos_with_one_blanked_crease_each();
        let seed = model.line_segments[in_a].a;
        let scope = Scope::component_at(&model, seed, 1.0).expect("seed on the pattern");
        assert_eq!(
            scope.free_in(&model),
            1,
            "one crease is blanked in this pattern"
        );
        assert_eq!(
            free_line_indices(&model).len(),
            2,
            "two on the whole canvas"
        );

        let draft = propagate(&model, &scope, &[], DEFAULT_MAX_COMMIT_K, bar());
        assert_eq!(draft.scope.free, 1);
        assert_eq!(draft.scope.vertices, scope.vertices().len());
        assert_eq!(draft.scope.creases, scope.creases_named().len());
    }

    /// A click that landed on empty canvas names no pattern, and the caller has
    /// to be told rather than quietly handed the whole document.
    #[test]
    fn a_seed_nowhere_near_anything_names_no_component() {
        let model = kabuto();
        assert!(Scope::component_at(&model, Point::new(1e6, 1e6), 1.0).is_none());
    }

    /// Cost as a counted invariant rather than a clock: a scoped run must not
    /// visit a vertex outside its scope. A wall-clock ratio here would red the
    /// Rust job on unrelated pull requests.
    #[test]
    fn a_scoped_run_visits_only_its_own_vertices() {
        let (model, in_a, _) = two_kabutos_with_one_blanked_crease_each();
        let seed = model.line_segments[in_a].a;
        let scope = Scope::component_at(&model, seed, 1.0).expect("seed on the pattern");
        let whole_document = whole(&model);
        assert!(
            scope.vertices().len() * 2 <= whole_document.vertices().len() + 1,
            "a component of two equal copies should be about half the canvas"
        );
        for point in scope.vertices() {
            assert!(
                point.x < 500.0,
                "the component's vertex list reaches into the other pattern at {point:?}"
            );
        }
    }
}
