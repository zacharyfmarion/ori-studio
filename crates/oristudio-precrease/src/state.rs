//! The planner state `(L, P)` for one component in the unit frame.
//!
//! `L` is the set of folded lines, the four sheet edges first; `P` the set of
//! in-paper pairwise intersections of `L` whose crossing angle passes the
//! conditioning floor (`|sin θ| ≥ MIN_ANGLE_SINE`, ReferenceFinder's
//! `minAngleSine`, adopted as a fact). Lines live in an angle-bucketed
//! [`LineIndex`], points in a grid-hashed [`PointGrid`], and every point and
//! line carries its incidence list.
//!
//! # Incidence is complete by construction
//!
//! A point of `P` may lie on more than the two lines that created it (three
//! concurrent creases are the norm in a crease pattern), and the inverse
//! predicates ask "which points lie on this line" and "which lines pass
//! through this point" constantly, so incidence has to be right. Adding a
//! line runs two passes over its intersections with every existing line:
//! the first creates the points that pass the conditioning floor, the second
//! records, for **every** crossing (down to `MIN_INCIDENCE_SINE`), the
//! incidence between the new line, the crossed line, and any point within
//! [`POINT_LOOKUP_RADIUS`] of the crossing that lies on both within `TOL`.
//!
//! Why the two radii: a point on the new line is found through the crossing
//! with some line through it; the pair that created the point crosses at
//! ≥ 20°, so one of those two lines makes at least 10° with the new line and
//! the computed crossing is within `TOL / sin 10° ≈ 6·TOL` of the stored
//! point. The grid cell is `8·TOL`, the lookup radius `8·TOL`, and the
//! decision is always the exact `distance ≤ TOL` test — the quantised index
//! only narrows the search, it never decides (tolerance policy).

use serde::{Deserialize, Serialize};

use crate::constants::MIN_ANGLE_SINE;
use crate::error::PrecreaseError;
use crate::line::{Line, LineIndex};
use crate::pointgrid::PointGrid;
use crate::sheet::Sheet;
use crate::tol::TOL;

/// Grid pitch and lookup radius for point-on-line queries (see the module
/// doc for the bound this rests on).
pub const POINT_LOOKUP_RADIUS: f64 = 8.0 * TOL;

/// Smallest `|sin θ|` at which a crossing is used to *find* incidences
/// (`sin 10°`); crossings shallower than this cannot locate a point
/// accurately and are always redundant with a steeper one.
pub const MIN_INCIDENCE_SINE: f64 = 0.17;

/// The `|P|` cap, set from measurement (plan: "measure before fixing
/// budgets"; its working value was 4 M points on an estimate of 16 B each).
///
/// Measured natively in release on the corpus's largest design — cpoogle
/// *Scale-Shaping*, 7,536 segments merging to 1,575 lines, the one that took
/// the JavaScript prototype 960 s: the closure folds all 1,574 non-outline
/// lines in 1.9 s, reaching `|P| = 397,491` at **186 MB** peak RSS against a
/// 5 MB floor on a design that folds almost nothing. That is ≈ 450 bytes per
/// point, not 16: a point carries its coordinates twice (state and grid), a
/// `Vec` of the lines through it, and a grid cell of its own at this density,
/// and every incidence is recorded on the line side as well.
///
/// 600,000 points is therefore ≈ 270 MB native — about half that in wasm,
/// where `usize` is four bytes — with 50 % headroom over the largest design
/// in a 563-design corpus. Callers raise or lower it through
/// `PlannerOptions::point_cap`.
pub const DEFAULT_POINT_CAP: usize = 600_000;

/// What a folded line is to the plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineTag {
    /// One of the four sheet edges: free.
    Edge,
    /// A crease-pattern line.
    Cp,
    /// An auxiliary fold found by the planner's own search.
    Aux,
    /// An auxiliary fold supplied from a ReferenceFinder solution.
    RfAux,
}

impl LineTag {
    /// The wire code used by `fold(lines, tags)`: 0 cp, 1 aux, 2 rf_aux.
    pub fn from_code(code: u8) -> Option<LineTag> {
        match code {
            0 => Some(LineTag::Cp),
            1 => Some(LineTag::Aux),
            2 => Some(LineTag::RfAux),
            _ => None,
        }
    }
}

/// A folded line and the points on it.
#[derive(Debug, Clone, PartialEq)]
pub struct StateLine {
    pub line: Line,
    pub tag: LineTag,
    /// Ids of the points of `P` on this line.
    pub points: Vec<usize>,
}

/// A point of `P` and the lines through it.
#[derive(Debug, Clone, PartialEq)]
pub struct StatePoint {
    pub p: [f64; 2],
    /// Ids of the lines of `L` through this point (at least two).
    pub lines: Vec<usize>,
    /// The point lies on the sheet boundary (a mark that is easy to see).
    pub on_boundary: bool,
}

/// What `add_line` did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddOutcome {
    /// Id of the line (existing when `inserted` is false).
    pub id: usize,
    pub inserted: bool,
    /// Ids of the points the line created, in id order.
    pub new_points: Vec<usize>,
}

/// The `(L, P)` state.
#[derive(Debug, Clone)]
pub struct State {
    sheet: Sheet,
    lines: Vec<StateLine>,
    index: LineIndex,
    points: Vec<StatePoint>,
    grid: PointGrid,
    point_cap: usize,
}

impl State {
    /// A bare sheet: its four edges and four corners.
    pub fn new(sheet: Sheet, point_cap: usize) -> State {
        let mut state = State {
            sheet,
            lines: Vec::new(),
            index: LineIndex::new(TOL),
            points: Vec::new(),
            grid: PointGrid::new(POINT_LOOKUP_RADIUS),
            point_cap: point_cap.max(4),
        };
        for edge in sheet.edges() {
            // Four edges of a proper rectangle cannot hit a cap ≥ 4.
            let _ = state.add_line(edge, LineTag::Edge);
        }
        state
    }

    /// The sheet.
    pub fn sheet(&self) -> &Sheet {
        &self.sheet
    }

    /// The point cap.
    pub fn point_cap(&self) -> usize {
        self.point_cap
    }

    /// Every folded line, edges first, in id order.
    pub fn lines(&self) -> &[StateLine] {
        &self.lines
    }

    /// Every point, in id order.
    pub fn points(&self) -> &[StatePoint] {
        &self.points
    }

    /// The line with id `id`.
    pub fn line(&self, id: usize) -> &Line {
        &self.lines[id].line
    }

    /// Coordinates of point `id`.
    pub fn point(&self, id: usize) -> [f64; 2] {
        self.points[id].p
    }

    /// Number of lines (including the four edges).
    pub fn line_count(&self) -> usize {
        self.lines.len()
    }

    /// Number of points.
    pub fn point_count(&self) -> usize {
        self.points.len()
    }

    /// Id of the stored line equal to `line` within `TOL`.
    pub fn find_line(&self, line: &Line) -> Option<usize> {
        self.index.find(line)
    }

    /// Whether `line` is folded.
    pub fn has_line(&self, line: &Line) -> bool {
        self.index.find(line).is_some()
    }

    /// Id of the stored point within `TOL` of `p`.
    pub fn find_point(&self, p: [f64; 2]) -> Option<usize> {
        self.grid.nearest_within(p, TOL)
    }

    /// Whether `p` is a point of `P`.
    pub fn has_point(&self, p: [f64; 2]) -> bool {
        self.grid.any_within(p, TOL)
    }

    /// Ids of the points within [`POINT_LOOKUP_RADIUS`] of `q`: the
    /// candidates a caller then decides on with an exact distance test.
    pub fn points_near(&self, q: [f64; 2]) -> Vec<usize> {
        self.grid.within(q, POINT_LOOKUP_RADIUS)
    }

    /// Whether `p` lies on the sheet (padded by `TOL`).
    pub fn in_paper(&self, p: [f64; 2]) -> bool {
        self.sheet.contains(p, TOL)
    }

    /// Whether line `id` is a sheet edge.
    pub fn is_edge(&self, id: usize) -> bool {
        self.lines[id].tag == LineTag::Edge
    }

    /// Fold `line`. Returns the existing id when an equal line is already
    /// folded; otherwise inserts it, creates its in-paper intersections that
    /// pass the conditioning floor, and records every incidence.
    pub fn add_line(&mut self, line: Line, tag: LineTag) -> Result<AddOutcome, PrecreaseError> {
        if let Some(id) = self.index.find(&line) {
            return Ok(AddOutcome {
                id,
                inserted: false,
                new_points: Vec::new(),
            });
        }
        let id = self.lines.len();

        // Every usable crossing with an existing line.
        let mut hits: Vec<(usize, [f64; 2], f64)> = Vec::new();
        for (m, other) in self.lines.iter().enumerate() {
            let det = line.cross(&other.line).abs();
            if det < MIN_INCIDENCE_SINE {
                continue;
            }
            let Some(q) = line.intersect(&other.line) else {
                continue;
            };
            if !self.sheet.contains(q, TOL) {
                continue;
            }
            hits.push((m, q, det));
        }

        // The cap is checked before anything is mutated, so a refused line
        // leaves the state exactly as it was (a conservative count: two
        // crossings of this line within TOL of each other count twice).
        let creatable = hits
            .iter()
            .filter(|&&(_, q, det)| det >= MIN_ANGLE_SINE && !self.grid.any_within(q, TOL))
            .count();
        if self.points.len() + creatable > self.point_cap {
            return Err(PrecreaseError::PointCap {
                cap: self.point_cap,
            });
        }

        // Pass A: create the points that pass the conditioning floor.
        let mut new_points = Vec::new();
        for &(_, q, det) in &hits {
            if det < MIN_ANGLE_SINE || self.grid.any_within(q, TOL) {
                continue;
            }
            let pid = self.grid.insert(q);
            self.points.push(StatePoint {
                p: q,
                lines: Vec::new(),
                on_boundary: self.sheet.on_boundary(q),
            });
            new_points.push(pid);
        }

        // Pass B: incidence between the new line, each crossed line and every
        // point at the crossing.
        self.index.insert(line);
        self.lines.push(StateLine {
            line,
            tag,
            points: Vec::new(),
        });
        for &(m, q, _) in &hits {
            let other = self.lines[m].line;
            for c in self.grid.within(q, POINT_LOOKUP_RADIUS) {
                let pc = self.points[c].p;
                if line.distance_to_point(pc) <= TOL && other.distance_to_point(pc) <= TOL {
                    self.link(id, c);
                    self.link(m, c);
                }
            }
        }

        Ok(AddOutcome {
            id,
            inserted: true,
            new_points,
        })
    }

    fn link(&mut self, line: usize, point: usize) {
        let lines = &mut self.points[point].lines;
        if lines.contains(&line) {
            return;
        }
        lines.push(line);
        self.lines[line].points.push(point);
    }

    /// Ids of the points of `P` on an arbitrary line (folded or not), found
    /// through its crossings with the folded lines.
    pub fn points_on_line(&self, line: &Line) -> Vec<usize> {
        if let Some(id) = self.index.find(line) {
            let mut ids = self.lines[id].points.clone();
            ids.sort_unstable();
            return ids;
        }
        let mut out = Vec::new();
        for other in &self.lines {
            if line.cross(&other.line).abs() < MIN_INCIDENCE_SINE {
                continue;
            }
            let Some(q) = line.intersect(&other.line) else {
                continue;
            };
            if !self.sheet.contains(q, POINT_LOOKUP_RADIUS) {
                continue;
            }
            for c in self.grid.within(q, POINT_LOOKUP_RADIUS) {
                if line.distance_to_point(self.points[c].p) <= TOL {
                    out.push(c);
                }
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }

    /// Ids of the folded lines through an arbitrary point (in `P` or not).
    pub fn lines_through(&self, p: [f64; 2]) -> Vec<usize> {
        if let Some(id) = self.find_point(p) {
            let mut ids = self.points[id].lines.clone();
            ids.sort_unstable();
            return ids;
        }
        self.lines
            .iter()
            .enumerate()
            .filter(|(_, l)| l.line.distance_to_point(p) <= TOL)
            .map(|(id, _)| id)
            .collect()
    }

    /// The in-paper segment of line `id`.
    pub fn clip(&self, id: usize) -> Option<([f64; 2], [f64; 2])> {
        self.sheet.clip(&self.lines[id].line)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(n: [f64; 2], d: f64) -> Line {
        Line::new(n, d).expect("line")
    }

    #[test]
    fn a_bare_sheet_has_four_edges_and_four_corners() {
        let s = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        assert_eq!(s.line_count(), 4);
        assert_eq!(s.point_count(), 4);
        for p in &s.points()[..4] {
            assert!(p.on_boundary);
            assert_eq!(p.lines.len(), 2);
        }
        for l in s.lines() {
            assert_eq!(l.tag, LineTag::Edge);
            assert_eq!(l.points.len(), 2);
        }
        assert!(s.has_point([1.0, 1.0]));
        assert!(!s.has_point([0.5, 0.5]));
    }

    #[test]
    fn concurrent_lines_share_one_point_with_full_incidence() {
        let mut s = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let v = s.add_line(line([1.0, 0.0], 0.5), LineTag::Cp).expect("add");
        assert!(v.inserted);
        // x = 0.5 meets bottom and top edges: two new points.
        assert_eq!(v.new_points.len(), 2);
        let h = s.add_line(line([0.0, 1.0], 0.5), LineTag::Cp).expect("add");
        // y = 0.5 meets left, right and x = 0.5: three new points.
        assert_eq!(h.new_points.len(), 3);
        let centre = s.find_point([0.5, 0.5]).expect("centre");
        assert_eq!(s.points()[centre].lines.len(), 2);
        // The diagonal passes through the centre and two corners: one new
        // point? none — corners exist, centre exists.
        let d = s
            .add_line(
                Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("l"),
                LineTag::Cp,
            )
            .expect("add");
        assert!(d.inserted);
        assert!(d.new_points.is_empty());
        let mut through = s.points()[centre].lines.clone();
        through.sort_unstable();
        assert_eq!(through, vec![v.id, h.id, d.id]);
        // And the diagonal knows its three points.
        assert_eq!(s.lines()[d.id].points.len(), 3);
        assert_eq!(s.points()[0].lines.len(), 3); // corner (0,0): two edges + diagonal
        // Adding the same line again is a no-op.
        let again = s
            .add_line(line([1.0, 0.0], 0.5 + 1e-8), LineTag::Aux)
            .expect("add");
        assert!(!again.inserted);
        assert_eq!(again.id, v.id);
        assert_eq!(s.line_count(), 7);
    }

    #[test]
    fn shallow_crossings_create_no_point_but_incidence_is_still_found() {
        let mut s = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        // Two lines through (0.5, 0.5) at ±5° from horizontal: their mutual
        // crossing is 10° (fails the 20° floor), but each crosses the
        // vertical midline at ~85°.
        let a =
            Line::from_point_direction([0.5, 0.5], [1.0, (5f64).to_radians().tan()]).expect("l");
        let b =
            Line::from_point_direction([0.5, 0.5], [1.0, -(5f64).to_radians().tan()]).expect("l");
        s.add_line(a, LineTag::Cp).expect("add");
        let before = s.point_count();
        s.add_line(b, LineTag::Cp).expect("add");
        // a ∩ b fails the floor: only b's edge crossings are new.
        assert_eq!(s.point_count(), before + 2);
        assert!(s.find_point([0.5, 0.5]).is_none());
        // Now the midline creates the centre, and both shallow lines are
        // recorded as passing through it.
        let v = s.add_line(line([1.0, 0.0], 0.5), LineTag::Cp).expect("add");
        let centre = s.find_point([0.5, 0.5]).expect("centre");
        assert!(v.new_points.contains(&centre));
        assert_eq!(s.points()[centre].lines.len(), 3);
        assert_eq!(s.points_on_line(&a).len(), 3); // two edge points + centre
    }

    #[test]
    fn points_on_an_unfolded_line_and_lines_through_a_point() {
        let mut s = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        s.add_line(line([1.0, 0.0], 0.5), LineTag::Cp).expect("add");
        s.add_line(line([0.0, 1.0], 0.5), LineTag::Cp).expect("add");
        // x + y = 1 is not folded, yet passes through (0.5, 0.5), (1, 0), (0, 1).
        let anti = Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("l");
        let on = s.points_on_line(&anti);
        assert_eq!(on.len(), 3);
        // x + y = ½ (the rounded-normal regression): passes through (0.5, 0)
        // and (0, 0.5), both in P.
        let half = Line::from_points([0.5, 0.0], [0.0, 0.5]).expect("l");
        assert_eq!(s.points_on_line(&half).len(), 2);
        s.add_line(half, LineTag::Cp).expect("add");
        assert_eq!(s.lines_through([0.25, 0.25]).len(), 1);
        assert_eq!(s.lines_through([0.5, 0.0]).len(), 3);
    }

    #[test]
    fn the_point_cap_is_a_typed_error_and_leaves_the_state_untouched() {
        let mut s = State::new(Sheet::unit_square(), 5);
        let err = s.add_line(line([1.0, 0.0], 0.5), LineTag::Cp);
        assert_eq!(err, Err(PrecreaseError::PointCap { cap: 5 }));
        assert_eq!(s.line_count(), 4);
        assert_eq!(s.point_count(), 4);
        assert!(!s.has_line(&line([1.0, 0.0], 0.5)));
    }
}
