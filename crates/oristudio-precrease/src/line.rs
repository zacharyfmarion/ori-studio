//! Canonical infinite lines `n · p = d` with a unit normal.
//!
//! The sign of `(n, d)` is canonicalised so that `n.x > 0`, or `n.x == 0`
//! and `n.y > 0`. That makes storage deterministic but leaves a seam: two
//! nearly horizontal lines with `n.x = ±1e-9` canonicalise to opposite
//! signs. Equality therefore resolves the `(n, d) ~ (−n, −d)` identification
//! **at compare time** — `|n₁ × n₂| ≤ tol` and `|d₁ − s·d₂| ≤ tol` with
//! `s = sign(n₁ · n₂)` — and never by snapping a component to zero.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::tol::TOL;

/// An infinite line `n · p = d`, `|n| = 1`, sign-canonicalised.
///
/// `PartialEq` is exact component equality (for derives and fixtures); use
/// [`Line::approx_eq`] for the tolerance comparison everything else needs.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Line {
    /// Unit normal.
    pub n: [f64; 2],
    /// Signed offset along the normal.
    pub d: f64,
}

impl Line {
    /// A line from any normal and offset; the normal is normalised and the
    /// sign canonicalised. `None` when `|n| < TOL`.
    pub fn new(n: [f64; 2], d: f64) -> Option<Line> {
        let len = (n[0] * n[0] + n[1] * n[1]).sqrt();
        if len.is_nan() || len < TOL {
            return None;
        }
        let mut n = [n[0] / len, n[1] / len];
        let mut d = d / len;
        if n[0] < 0.0 || (n[0] == 0.0 && n[1] < 0.0) {
            n = [-n[0], -n[1]];
            d = -d;
        }
        // Normalise a negative zero so `n.x == 0.0` compares consistently.
        if n[0] == 0.0 {
            n[0] = 0.0;
        }
        if n[1] == 0.0 {
            n[1] = 0.0;
        }
        Some(Line { n, d })
    }

    /// The line through two points; `None` when they are closer than `TOL`.
    pub fn from_points(p: [f64; 2], q: [f64; 2]) -> Option<Line> {
        Self::from_point_direction(p, [q[0] - p[0], q[1] - p[1]])
    }

    /// The line through `p` with direction `dir`; `None` for a direction
    /// shorter than `TOL`.
    pub fn from_point_direction(p: [f64; 2], dir: [f64; 2]) -> Option<Line> {
        let n = [-dir[1], dir[0]];
        let d = n[0] * p[0] + n[1] * p[1];
        Self::new(n, d)
    }

    /// `n · p − d`: positive on the side the normal points to.
    pub fn signed_distance(&self, p: [f64; 2]) -> f64 {
        self.n[0] * p[0] + self.n[1] * p[1] - self.d
    }

    /// Unsigned distance from `p` to the line.
    pub fn distance_to_point(&self, p: [f64; 2]) -> f64 {
        self.signed_distance(p).abs()
    }

    /// Mirror image of `p` across the line.
    pub fn reflect_point(&self, p: [f64; 2]) -> [f64; 2] {
        let s = self.signed_distance(p);
        [p[0] - 2.0 * s * self.n[0], p[1] - 2.0 * s * self.n[1]]
    }

    /// Foot of the perpendicular from the origin: the point `d · n`.
    pub fn foot(&self) -> [f64; 2] {
        [self.d * self.n[0], self.d * self.n[1]]
    }

    /// Unit direction along the line, the normal rotated by +90°.
    pub fn direction(&self) -> [f64; 2] {
        [-self.n[1], self.n[0]]
    }

    /// Parameter of `p` projected onto the line, measured along
    /// [`Self::direction`] from the foot.
    pub fn parameter(&self, p: [f64; 2]) -> f64 {
        let dir = self.direction();
        dir[0] * p[0] + dir[1] * p[1]
    }

    /// Point at parameter `t` (inverse of [`Self::parameter`]).
    pub fn point_at(&self, t: f64) -> [f64; 2] {
        let f = self.foot();
        let dir = self.direction();
        [f[0] + t * dir[0], f[1] + t * dir[1]]
    }

    /// Angle of the normal, in `[−π/2, π/2]` because of the canonical sign.
    pub fn normal_angle(&self) -> f64 {
        self.n[1].atan2(self.n[0])
    }

    /// Cross product of the two unit normals: `sin` of the angle between them.
    pub fn cross(&self, other: &Line) -> f64 {
        self.n[0] * other.n[1] - self.n[1] * other.n[0]
    }

    /// Dot product of the two unit normals.
    pub fn dot(&self, other: &Line) -> f64 {
        self.n[0] * other.n[0] + self.n[1] * other.n[1]
    }

    /// Mirror image of `other` across this line: the line through the
    /// reflections of two of its points. `None` only for a degenerate input.
    pub fn reflect_line(&self, other: &Line) -> Option<Line> {
        let a = other.point_at(0.0);
        let b = other.point_at(1.0);
        Line::from_points(self.reflect_point(a), self.reflect_point(b))
    }

    /// The perpendicular bisector of `p` and `q`: the unique fold carrying
    /// `p` onto `q`. `None` when the points are closer than `TOL`.
    pub fn perpendicular_bisector(p: [f64; 2], q: [f64; 2]) -> Option<Line> {
        let n = [q[0] - p[0], q[1] - p[1]];
        let mid = [(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0];
        Line::new(n, n[0] * mid[0] + n[1] * mid[1])
    }

    /// Intersection point, or `None` when `|det| < TOL` (parallel within
    /// tolerance, which includes coincident lines).
    pub fn intersect(&self, other: &Line) -> Option<[f64; 2]> {
        let det = self.cross(other);
        if det.abs() < TOL {
            return None;
        }
        Some([
            (self.d * other.n[1] - other.d * self.n[1]) / det,
            (self.n[0] * other.d - other.n[0] * self.d) / det,
        ])
    }

    /// Parallel within `tol` radians, in either orientation.
    pub fn is_parallel_within(&self, other: &Line, tol: f64) -> bool {
        self.cross(other).abs() <= tol
    }

    /// Same line within `tol`, resolving `(n, d) ~ (−n, −d)` at compare time.
    pub fn approx_eq_within(&self, other: &Line, tol: f64) -> bool {
        if !self.is_parallel_within(other, tol) {
            return false;
        }
        let s = if self.dot(other) >= 0.0 { 1.0 } else { -1.0 };
        (self.d - s * other.d).abs() <= tol
    }

    /// [`Self::approx_eq_within`] at [`TOL`].
    pub fn approx_eq(&self, other: &Line) -> bool {
        self.approx_eq_within(other, TOL)
    }

    /// Normal angle folded into `[0, π)` with the offset sign adjusted, so a
    /// line and its `(−n, −d)` twin map to the same pair. Angles within
    /// `TOL/2` of `π` wrap to `0` so the seam there is an ordinary quantum
    /// boundary rather than a jump.
    pub(crate) fn folded_angle_offset(&self) -> (f64, f64) {
        let mut theta = self.normal_angle();
        let mut d = self.d;
        if theta < 0.0 {
            theta += std::f64::consts::PI;
            d = -d;
        }
        if theta >= std::f64::consts::PI - TOL / 2.0 {
            theta -= std::f64::consts::PI;
            d = -d;
        }
        (theta, d)
    }

    /// A `u64` hash key: the folded normal angle and offset quantised at
    /// `TOL`. Identical for `(n, d)` and `(−n, −d)`. Like every quantised
    /// key it is **not** tolerance-stable — two lines equal within `TOL` can
    /// straddle a quantum boundary — so it is a hash hint for exact dedupe of
    /// lines produced by the same arithmetic, never a substitute for
    /// [`Self::approx_eq`]. [`LineIndex`] is the tolerance-aware structure.
    pub fn key(&self) -> u64 {
        let (theta, d) = self.folded_angle_offset();
        let aq = (theta / TOL).round().max(0.0) as u64;
        const D_BITS: u32 = 42;
        let limit = (1i64 << (D_BITS - 1)) - 1;
        let dq = (d / TOL).round().clamp(-(limit as f64), limit as f64) as i64;
        (aq << D_BITS) | ((dq as u64) & ((1u64 << D_BITS) - 1))
    }
}

/// A tolerance-aware index of distinct lines: angle buckets mod π (with
/// wrap) of pitch `4 · tol`, probed over the neighbouring buckets, with the
/// final decision made by [`Line::approx_eq_within`].
#[derive(Debug, Clone)]
pub struct LineIndex {
    tol: f64,
    pitch: f64,
    bucket_count: i64,
    buckets: HashMap<i64, Vec<usize>>,
    lines: Vec<Line>,
}

impl LineIndex {
    /// An empty index deciding equality at `tol`.
    pub fn new(tol: f64) -> Self {
        let pitch = 4.0 * tol.max(f64::MIN_POSITIVE);
        let bucket_count = (std::f64::consts::PI / pitch).ceil().max(1.0) as i64;
        Self {
            tol,
            pitch,
            bucket_count,
            buckets: HashMap::new(),
            lines: Vec::new(),
        }
    }

    fn bucket(&self, line: &Line) -> i64 {
        let (theta, _) = line.folded_angle_offset();
        ((theta / self.pitch).floor() as i64).rem_euclid(self.bucket_count)
    }

    /// Id of a stored line equal to `line` within the index tolerance.
    pub fn find(&self, line: &Line) -> Option<usize> {
        let b = self.bucket(line);
        for delta in -1..=1 {
            let key = (b + delta).rem_euclid(self.bucket_count);
            if let Some(ids) = self.buckets.get(&key) {
                for &id in ids {
                    if self.lines[id].approx_eq_within(line, self.tol) {
                        return Some(id);
                    }
                }
            }
        }
        None
    }

    /// Insert unless an equal line is stored; returns `(id, inserted)`.
    pub fn insert(&mut self, line: Line) -> (usize, bool) {
        if let Some(id) = self.find(&line) {
            return (id, false);
        }
        let id = self.lines.len();
        let b = self.bucket(&line);
        self.lines.push(line);
        self.buckets.entry(b).or_default().push(id);
        (id, true)
    }

    /// Stored line `id`.
    pub fn get(&self, id: usize) -> &Line {
        &self.lines[id]
    }

    /// Every stored line in id order.
    pub fn lines(&self) -> &[Line] {
        &self.lines
    }

    /// Number of distinct lines.
    pub fn len(&self) -> usize {
        self.lines.len()
    }

    /// Whether no line is stored.
    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(n: [f64; 2], d: f64) -> Line {
        Line::new(n, d).expect("non-degenerate normal")
    }

    #[test]
    fn canonical_sign_puts_nx_positive_or_ny_positive() {
        let l = line([-1.0, 0.0], 0.5);
        assert_eq!(l.n, [1.0, 0.0]);
        assert_eq!(l.d, -0.5);
        let m = line([0.0, -1.0], 0.25);
        assert_eq!(m.n, [0.0, 1.0]);
        assert_eq!(m.d, -0.25);
        // -0.0 is normalised away so the seam test is exact.
        let z = line([-0.0, 1.0], 0.0);
        assert!(z.n[0].is_sign_positive());
    }

    #[test]
    fn seam_near_nx_zero_is_resolved_at_compare_time() {
        // Two nearly horizontal lines y = 0.3, one with n.x = +1e-9 and one
        // with n.x = -1e-9: canonicalisation flips the second, so the stored
        // normals point opposite ways and d differs in sign.
        let a = line([1e-9, 1.0], 0.3);
        let b = line([-1e-9, 1.0], 0.3);
        assert!(a.n[1] > 0.0 && b.n[1] < 0.0);
        assert!(a.approx_eq(&b));
        assert!(b.approx_eq(&a));
        // Their keys agree too, because the folded angle handles the flip.
        assert_eq!(a.key(), b.key());
    }

    #[test]
    fn seam_near_ny_zero_folds_angle_across_pi() {
        // Nearly vertical lines x = 0.4 with n.y = ±1e-9.
        let a = line([1.0, 1e-9], 0.4);
        let b = line([1.0, -1e-9], 0.4);
        assert!(a.approx_eq(&b));
        assert_eq!(a.key(), b.key());
    }

    #[test]
    fn equality_under_the_identification() {
        let a = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("line");
        let b = Line::from_points([1.0, 1.0], [0.0, 0.0]).expect("line");
        assert!(a.approx_eq(&b));
        assert_eq!(a.key(), b.key());
        let c = Line::from_points([0.0, 1e-7], [1.0, 1.0 + 1e-7]).expect("line");
        assert!(a.approx_eq(&c));
        let far = Line::from_points([0.0, 1e-5], [1.0, 1.0 + 1e-5]).expect("line");
        assert!(!a.approx_eq(&far));
    }

    #[test]
    fn parallel_offset_lines_are_distinct() {
        let a = line([0.0, 1.0], 0.5);
        let b = line([0.0, 1.0], 0.5 + 5e-6);
        assert!(a.is_parallel_within(&b, TOL));
        assert!(!a.approx_eq(&b));
        assert!(a.intersect(&b).is_none());
    }

    #[test]
    fn intersection_and_reflection() {
        let x = line([1.0, 0.0], 0.25);
        let y = line([0.0, 1.0], 0.75);
        let p = x.intersect(&y).expect("crossing");
        assert!((p[0] - 0.25).abs() < 1e-12 && (p[1] - 0.75).abs() < 1e-12);
        let r = x.reflect_point([0.0, 0.1]);
        assert!((r[0] - 0.5).abs() < 1e-12 && (r[1] - 0.1).abs() < 1e-12);
        let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("line");
        let r = diag.reflect_point([1.0, 0.0]);
        assert!(r[0].abs() < 1e-12 && (r[1] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn reflect_line_and_perpendicular_bisector() {
        let axis = line([0.0, 1.0], 0.5); // y = 0.5
        let m = Line::from_points([0.0, 0.0], [1.0, 0.25]).expect("line");
        let r = axis.reflect_line(&m).expect("line");
        let expected = Line::from_points([0.0, 1.0], [1.0, 0.75]).expect("line");
        assert!(r.approx_eq(&expected));
        let b = Line::perpendicular_bisector([0.0, 0.0], [1.0, 1.0]).expect("line");
        assert!(b.approx_eq(&Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("line")));
        assert!(Line::perpendicular_bisector([0.3, 0.3], [0.3, 0.3]).is_none());
    }

    #[test]
    fn parameter_round_trips() {
        let l = Line::from_points([0.2, 0.1], [0.9, 0.6]).expect("line");
        let p = [0.55, 0.35];
        let t = l.parameter(p);
        let q = l.point_at(t);
        assert!((q[0] - p[0]).abs() < 1e-12 && (q[1] - p[1]).abs() < 1e-12);
    }

    #[test]
    fn degenerate_inputs_are_none() {
        assert!(Line::new([0.0, 0.0], 1.0).is_none());
        assert!(Line::from_points([0.3, 0.3], [0.3, 0.3 + 1e-9]).is_none());
    }

    #[test]
    fn index_dedupes_across_the_seam_and_bucket_boundaries() {
        let mut index = LineIndex::new(TOL);
        let (a, new_a) = index.insert(line([1e-9, 1.0], 0.3));
        let (b, new_b) = index.insert(line([-1e-9, 1.0], 0.3));
        assert!(new_a && !new_b);
        assert_eq!(a, b);
        let (c, new_c) = index.insert(line([1.0, -1e-9], 0.4));
        let (d, new_d) = index.insert(line([1.0, 1e-9], 0.4));
        assert!(new_c && !new_d);
        assert_eq!(c, d);
        // Angle just under a bucket boundary vs just over it.
        let pitch = 4.0 * TOL;
        let theta = 100.0 * pitch;
        let e = line([(theta - 1e-7).cos(), (theta - 1e-7).sin()], 0.1);
        let f = line([(theta + 1e-7).cos(), (theta + 1e-7).sin()], 0.1);
        let (ei, _) = index.insert(e);
        let (fi, new_f) = index.insert(f);
        assert!(!new_f);
        assert_eq!(ei, fi);
        assert_eq!(index.len(), 3);
    }
}
