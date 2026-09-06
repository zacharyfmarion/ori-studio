//! Forward candidate generation: lines one axiom away from the current state
//! that the stuck search may fold as auxiliary creases.
//!
//! Two generators, chosen by state size:
//!
//! - **Full** (small states, the measured stuck states have `|P| = 5–11`):
//!   every O1–O7 construction over `(L, P)`, through the same forward
//!   constructors the certificates use, so every candidate is constructible
//!   by definition. O5/O7 scale as `|P|²·|L|` and `|P|·|L|²`, O6 as
//!   `|P|²·|L|²`, so O6 is enumerated only on the smallest states.
//! - **Goal-directed** (larger states): candidates that can help a
//!   remaining target `t`, drawn from *anchor points* — `t ∩ m` for `m ∈ L`
//!   (a new line through it puts a mark on `t`) — and, for each anchor `X`,
//!   the lines through `X` that are one axiom away: O1 (two marks collinear
//!   with `X`), O2 (two marks equidistant from `X`), O3 (two lines
//!   equidistant from `X`), O4 (through `X` perpendicular to a folded line,
//!   with a mark on it). Plus the mirror images `reflect_t(m)` of folded
//!   lines that tier 1 can already construct — folding one creates an O3
//!   pair for `t`. Anchors are budgeted against `|P|` so a stuck event on a
//!   large state stays inside its time budget.
//!
//! Candidates never include folded lines and are deduped at `TOL`; a line
//! equal to a remaining target is kept (folding it is a CP fold, the best
//! possible outcome) and the search charges no auxiliary cost for it.

use crate::closure::Closure;
use crate::constants::axiom_ease;
use crate::construct::{Construction, Pt};
use crate::line::{Line, LineIndex};
use crate::predicates::{tier1_facts, witnesses};
use crate::tol::TOL;

/// Caps for the generator.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CandidateOptions {
    /// Largest candidate set returned (best ease first).
    pub max_candidates: usize,
    /// Full enumeration while `|P|` is at most this …
    pub full_max_points: usize,
    /// … and `|L|` at most this.
    pub full_max_lines: usize,
    /// O6 enumeration only while `|P|` is at most this …
    pub o6_max_points: usize,
    /// … and `|L|` at most this.
    pub o6_max_lines: usize,
    /// Largest anchor set in goal-directed mode (further reduced by `|P|`).
    pub max_anchors: usize,
}

impl Default for CandidateOptions {
    fn default() -> Self {
        Self {
            max_candidates: 400,
            full_max_points: 48,
            full_max_lines: 24,
            o6_max_points: 16,
            o6_max_lines: 12,
            max_anchors: 256,
        }
    }
}

/// One candidate auxiliary line and the axiom that produced it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Candidate {
    pub line: Line,
    pub axiom: u8,
}

struct Collector<'a> {
    closure: &'a Closure,
    index: LineIndex,
    out: Vec<Candidate>,
}

impl Collector<'_> {
    fn add(&mut self, line: Line, axiom: u8) {
        let state = self.closure.state();
        if !state.sheet().crosses(&line) || state.has_line(&line) {
            return;
        }
        if self.index.insert(line).1 {
            self.out.push(Candidate { line, axiom });
        }
    }

    fn add_all(&mut self, c: &Construction) {
        let sheet = *self.closure.state().sheet();
        for root in c.lines(&sheet) {
            self.add(root.line, c.axiom());
        }
    }
}

/// Every candidate one axiom away from the closure's state.
pub fn candidates(closure: &Closure, opts: &CandidateOptions) -> Vec<Candidate> {
    let state = closure.state();
    let mut col = Collector {
        closure,
        index: LineIndex::new(TOL),
        out: Vec::new(),
    };
    if state.point_count() <= opts.full_max_points && state.line_count() <= opts.full_max_lines {
        full(&mut col, opts);
    } else {
        goal_directed(&mut col, opts);
    }
    let mut out = col.out;
    out.sort_by_key(|c| (axiom_ease(c.axiom).unwrap_or(7), c.line.key()));
    truncate_diverse(&mut out, opts.max_candidates);
    out
}

/// Cap a candidate list at `n` while keeping every axiom represented: take
/// the (ease, key)-sorted list round-robin across its axiom classes.
///
/// A flat truncation of an ease-sorted list is not a neutral cap — it drops
/// the *last* axiom in the ease order, which is O1, and the count-optimal
/// auxiliary routes the plan's probes found are O1 lines (`y = 2x`,
/// `3x + y = 1`). Cutting `g3d_x19`'s child list at 60 that way cost it an
/// auxiliary fold (2 → 3); round-robin at the same cap keeps the 2-fold set.
pub fn truncate_diverse(candidates: &mut Vec<Candidate>, n: usize) {
    if candidates.len() <= n {
        return;
    }
    // Axiom classes in the order they appear (the list is ease-sorted, so
    // that is the ease order).
    let mut classes: Vec<Vec<Candidate>> = Vec::new();
    let mut seen: Vec<u8> = Vec::new();
    for c in candidates.drain(..) {
        match seen.iter().position(|&a| a == c.axiom) {
            Some(k) => classes[k].push(c),
            None => {
                seen.push(c.axiom);
                classes.push(vec![c]);
            }
        }
    }
    let mut round = 0usize;
    while candidates.len() < n {
        let mut any = false;
        for class in &classes {
            if let Some(c) = class.get(round) {
                candidates.push(*c);
                any = true;
                if candidates.len() == n {
                    break;
                }
            }
        }
        if !any {
            break;
        }
        round += 1;
    }
    candidates.sort_by_key(|c| (axiom_ease(c.axiom).unwrap_or(7), c.line.key()));
}

fn full(col: &mut Collector<'_>, opts: &CandidateOptions) {
    let state = col.closure.state();
    let points: Vec<Pt> = state.points().iter().map(|p| p.p).collect();
    let lines: Vec<Line> = state.lines().iter().map(|l| l.line).collect();

    for (i, &p) in points.iter().enumerate() {
        for &q in &points[i + 1..] {
            col.add_all(&Construction::O1 { p, q });
            col.add_all(&Construction::O2 { p, q });
        }
    }
    for (i, &m1) in lines.iter().enumerate() {
        for &m2 in &lines[i + 1..] {
            col.add_all(&Construction::O3 { m1, m2 });
        }
    }
    for &p in &points {
        for &m in &lines {
            col.add_all(&Construction::O4 { p, m });
        }
    }
    // Landers: (p, m1) with p off m1.
    let landers: Vec<(usize, usize)> = (0..points.len())
        .flat_map(|p| (0..lines.len()).map(move |m| (p, m)))
        .filter(|&(p, m)| lines[m].distance_to_point(points[p]) > TOL)
        .collect();
    for &(p, m1) in &landers {
        for (qi, &pivot) in points.iter().enumerate() {
            if qi != p {
                col.add_all(&Construction::O5 {
                    pivot,
                    p: points[p],
                    m1: lines[m1],
                });
            }
        }
        for (mi, &m2) in lines.iter().enumerate() {
            if mi != m1 {
                col.add_all(&Construction::O7 {
                    p: points[p],
                    m1: lines[m1],
                    m2,
                });
            }
        }
    }
    if points.len() <= opts.o6_max_points && lines.len() <= opts.o6_max_lines {
        for (i, &(p1, m1)) in landers.iter().enumerate() {
            for &(p2, m2) in &landers[i + 1..] {
                if p1 == p2 || m1 == m2 {
                    continue;
                }
                col.add_all(&Construction::O6 {
                    p1: points[p1],
                    m1: lines[m1],
                    p2: points[p2],
                    m2: lines[m2],
                });
            }
        }
    }
}

fn goal_directed(col: &mut Collector<'_>, opts: &CandidateOptions) {
    let closure = col.closure;
    let state = closure.state();
    let sheet = *state.sheet();
    let point_count = state.point_count().max(1);
    // Anchors cost O(|P| log |P|) each; keep the total near 2e7 operations.
    let anchor_budget = (20_000_000 / point_count).clamp(8, opts.max_anchors);

    let mut anchors: Vec<Pt> = Vec::new();
    let mut anchor_index = crate::pointgrid::PointGrid::new(TOL);
    'targets: for (_, t) in closure.remaining_lines() {
        for sl in state.lines() {
            if anchors.len() >= anchor_budget {
                break 'targets;
            }
            let Some(x) = t.intersect(&sl.line) else {
                continue;
            };
            if !state.in_paper(x) || anchor_index.any_within(x, TOL) {
                continue;
            }
            anchor_index.insert(x);
            anchors.push(x);
        }
    }

    let points: Vec<Pt> = state.points().iter().map(|p| p.p).collect();
    let lines: Vec<Line> = state.lines().iter().map(|l| l.line).collect();
    let mut directions: Vec<Line> = Vec::new();
    for l in &lines {
        if !directions.iter().any(|d| d.is_parallel_within(l, TOL)) {
            directions.push(*l);
        }
    }

    for x in &anchors {
        // O1: marks collinear with X, bucketed by direction from X.
        let mut by_angle: Vec<(f64, usize)> = points
            .iter()
            .enumerate()
            .filter_map(|(i, p)| {
                let d = [p[0] - x[0], p[1] - x[1]];
                let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
                (len > TOL).then(|| {
                    let mut a = d[1].atan2(d[0]);
                    if a < 0.0 {
                        a += std::f64::consts::PI;
                    }
                    if a >= std::f64::consts::PI - TOL {
                        a -= std::f64::consts::PI;
                    }
                    (a, i)
                })
            })
            .collect();
        by_angle.sort_by(|a, b| a.0.total_cmp(&b.0));
        for w in by_angle.windows(2) {
            if (w[1].0 - w[0].0).abs() <= TOL {
                col.add_all(&Construction::O1 {
                    p: points[w[0].1],
                    q: points[w[1].1],
                });
            }
        }
        // O2: marks equidistant from X.
        let mut by_dist: Vec<(f64, usize)> = points
            .iter()
            .enumerate()
            .map(|(i, p)| (((p[0] - x[0]).powi(2) + (p[1] - x[1]).powi(2)).sqrt(), i))
            .collect();
        by_dist.sort_by(|a, b| a.0.total_cmp(&b.0));
        for w in by_dist.windows(2) {
            if (w[1].0 - w[0].0).abs() <= TOL && w[0].0 > TOL {
                col.add_all(&Construction::O2 {
                    p: points[w[0].1],
                    q: points[w[1].1],
                });
            }
        }
        // O3: lines equidistant from X (a bisector through X).
        let mut line_dist: Vec<(f64, usize)> = lines
            .iter()
            .enumerate()
            .map(|(i, l)| (l.distance_to_point(*x), i))
            .collect();
        line_dist.sort_by(|a, b| a.0.total_cmp(&b.0));
        for w in line_dist.windows(2) {
            if (w[1].0 - w[0].0).abs() <= TOL {
                let c = Construction::O3 {
                    m1: lines[w[0].1],
                    m2: lines[w[1].1],
                };
                for root in c.lines(&sheet) {
                    if root.line.distance_to_point(*x) <= TOL {
                        col.add(root.line, 3);
                    }
                }
            }
        }
        // O4: through X perpendicular to a folded direction, with a mark on it.
        for m in &directions {
            let Some(a) = Line::new(
                m.direction(),
                m.direction()[0] * x[0] + m.direction()[1] * x[1],
            ) else {
                continue;
            };
            if state.has_line(&a) {
                continue;
            }
            let on = state.points_on_line(&a);
            if let Some(&p) = on.first() {
                // Any folded line parallel to m serves as the perpendicular
                // reference; certify against the first whose foot is on-sheet.
                for ml in lines.iter().filter(|l| l.is_parallel_within(m, TOL)) {
                    let c = Construction::O4 {
                        p: state.point(p),
                        m: *ml,
                    };
                    if c.certify(&sheet, &a).is_some() {
                        col.add(a, 4);
                        break;
                    }
                }
            }
        }
    }

    // Mirror images of folded lines across a remaining target that tier 1
    // already constructs: folding one gives the target an O3 pair.
    if point_count <= 20_000 {
        for (_, t) in closure.remaining_lines().into_iter().take(8) {
            for m in &lines {
                let Some(image) = t.reflect_line(m) else {
                    continue;
                };
                if !sheet.crosses(&image) || state.has_line(&image) {
                    continue;
                }
                let facts = tier1_facts(state, &image);
                let ws = witnesses(state, &image, &facts);
                if let Some(w) = ws.first() {
                    col.add(image, w.axiom);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::{Deadline, frozen_clock};
    use crate::closure::Target;
    use crate::sheet::Sheet;
    use crate::state::DEFAULT_POINT_CAP;

    fn v(x: f64) -> Line {
        Line::new([1.0, 0.0], x).expect("line")
    }

    #[test]
    fn bare_sheet_candidates_are_the_midlines_and_diagonals() {
        let c = Closure::new(Sheet::unit_square(), vec![], DEFAULT_POINT_CAP);
        let cands = candidates(&c, &CandidateOptions::default());
        let lines: Vec<Line> = cands.iter().map(|c| c.line).collect();
        assert_eq!(lines.len(), 4, "{lines:?}");
        for expect in [
            v(0.5),
            Line::new([0.0, 1.0], 0.5).expect("l"),
            Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("l"),
            Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("l"),
        ] {
            assert!(lines.iter().any(|l| l.approx_eq(&expect)), "{expect:?}");
        }
        // Every candidate is one axiom away: folding it certifies.
        for cand in &cands {
            let mut c2 = c.clone();
            let out = c2
                .fold_line(cand.line, crate::state::LineTag::Aux)
                .expect("fold");
            assert!(matches!(out, crate::closure::FoldOutcome::Folded { .. }));
        }
    }

    #[test]
    fn goal_directed_finds_the_landmark_for_a_third() {
        let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("line");
        let anti = Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("line");
        let mut c = Closure::new(
            Sheet::unit_square(),
            [v(1.0 / 3.0), diag, anti, v(0.5)]
                .iter()
                .map(|l| Target {
                    line: *l,
                    cp_line_ids: vec![],
                })
                .collect(),
            DEFAULT_POINT_CAP,
        );
        c.close(&Deadline::unbounded(frozen_clock()))
            .expect("close");
        assert_eq!(c.remaining().len(), 1);
        let opts = CandidateOptions {
            full_max_points: 0, // force the goal-directed generator
            ..CandidateOptions::default()
        };
        let cands = candidates(&c, &opts);
        // y = 2x passes through the anchor x = ⅓ ∩ x + y = 1 = (⅓, ⅔) and the
        // corner (0,0) and (½, 1): an O1 through two marks collinear with it.
        let y2x = Line::from_points([0.0, 0.0], [0.5, 1.0]).expect("line");
        assert!(cands.iter().any(|c| c.line.approx_eq(&y2x)), "{cands:?}");
        // The full generator finds it as well.
        let full = candidates(&c, &CandidateOptions::default());
        assert!(full.iter().any(|c| c.line.approx_eq(&y2x)));
        assert!(full.len() >= cands.len() / 2);
    }
}
