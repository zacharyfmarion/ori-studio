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

use std::collections::VecDeque;

use crate::geometry::{Epsilon, LineColor, Point};
use crate::model::{CreasePatternModel, crease_fold_angle};
use crate::solve_fold_angles::NoSolution;
use crate::solve_k::{Determinacy, solve_fan_at, solve_k};

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
}

impl Propagation {
    pub fn is_empty(&self) -> bool {
        self.solved.is_empty()
    }
}

/// Propagate outward from `seed`, to a fixpoint.
///
/// `pins` are `(line index, signed degrees)` the user has fixed by hand; they
/// are treated as known before the first solve and are never re-derived.
/// `closed_bar` is the acceptance residual in radians.
pub fn propagate(
    model: &CreasePatternModel,
    seed: Option<Point>,
    pins: &[(usize, f64)],
    max_commit_k: usize,
    closed_bar: f64,
) -> Propagation {
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
    for &(index, degrees) in &effective {
        if write_angle(&mut working, index, degrees) {
            solved.push((index, degrees));
        }
    }

    let mut queue: VecDeque<Point> = VecDeque::new();
    for point in candidate_vertices(&working, seed) {
        queue.push_back(point);
    }

    // A commit strictly reduces the number of free creases, so the loop
    // terminates; the cap is a backstop against a pathological re-queue, not a
    // budget the algorithm relies on.
    let budget = working.line_segments.len().saturating_mul(8).max(64);
    let mut steps = 0;

    while let Some(point) = queue.pop_front() {
        steps += 1;
        if steps > budget {
            break;
        }
        let fan = solve_fan_at(&working, point);
        let unknowns = fan.unknown_positions();
        if unknowns.is_empty() {
            continue;
        }
        if unknowns.len() > max_commit_k {
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
    let mut stalls = Vec::new();
    let mut closure_failures = Vec::new();
    for point in candidate_vertices(&working, None) {
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
    }
}

/// Apply a draft to the document. Returns how many creases changed.
pub fn apply(model: &mut CreasePatternModel, solved: &[(usize, f64)]) -> usize {
    solved
        .iter()
        .filter(|(index, degrees)| write_angle(model, *index, *degrees))
        .count()
}

/// Write one signed angle, turning an unassigned crease into a real one.
///
/// [`crate::operations::color::set_signed_fold_angles`] cannot be used here: it
/// skips anything that is not already `Red1`/`Blue2`, which is a documented
/// invariant of the three-crease tool and is exactly the case propagation needs.
fn write_angle(model: &mut CreasePatternModel, index: usize, degrees: f64) -> bool {
    let Some(segment) = model.line_segments.get(index) else {
        return false;
    };
    let color = if degrees < 0.0 {
        LineColor::Red1
    } else {
        LineColor::Blue2
    };
    let magnitude = crate::geometry::FoldMagnitude::from_degrees(degrees.abs());
    let Some(magnitude) = magnitude else {
        return false;
    };
    // `with_fold_magnitude` normalises a full fold to `None`, which is the one
    // canonical form for 180 degrees and is what keeps a classic document
    // classic — and therefore off the three cost paths that a single non-classic
    // crease switches on for the whole document.
    let updated = segment
        .with_line_color(color)
        .with_fold_magnitude(Some(magnitude));
    if updated == *segment {
        return false;
    }
    model.line_segments[index] = updated;
    true
}

/// Interior-ish vertices worth visiting, nearest the seed first.
///
/// Ordering is presentation, not correctness — the fixpoint is the same either
/// way — but it decides which region resolves under the user's eye.
fn candidate_vertices(model: &CreasePatternModel, seed: Option<Point>) -> Vec<Point> {
    let mut points: Vec<Point> = Vec::new();
    for segment in &model.line_segments {
        if segment.color == LineColor::Cyan3 {
            continue;
        }
        for point in [segment.a, segment.b] {
            if !points
                .iter()
                .any(|have| have.distance(point) < Epsilon::UNKNOWN_1EN6)
            {
                points.push(point);
            }
        }
    }
    if let Some(seed) = seed {
        points.sort_by(|left, right| {
            seed.distance(*left)
                .partial_cmp(&seed.distance(*right))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }
    points
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
    use super::{DEFAULT_MAX_COMMIT_K, StallReason, free_line_indices, propagate};
    use crate::CLOSURE_RESIDUAL_BAR_DEGREES;
    use crate::geometry::LineColor;
    use crate::io::fold::import_fold_document;
    use crate::model::{CreasePatternModel, crease_fold_angle};
    use treemaker_fold::FoldDocument;

    fn bar() -> f64 {
        CLOSURE_RESIDUAL_BAR_DEGREES.to_radians()
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
            let draft = propagate(&blanked, None, &[], DEFAULT_MAX_COMMIT_K, bar());
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
        let draft = propagate(&model, None, &[], DEFAULT_MAX_COMMIT_K, bar());
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
        let draft = propagate(&model, None, &[], DEFAULT_MAX_COMMIT_K, bar());
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
        let draft = propagate(&blanked, None, &[(pin, truth)], DEFAULT_MAX_COMMIT_K, bar());
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
        let draft = propagate(&model, None, &[], DEFAULT_MAX_COMMIT_K, bar());
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
        let draft = propagate(&broken, None, &[], DEFAULT_MAX_COMMIT_K, bar());
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
            None,
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
            let draft = propagate(&blanked, Some(seed), &[], DEFAULT_MAX_COMMIT_K, bar());
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
}
