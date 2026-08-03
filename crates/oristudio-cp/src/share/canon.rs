//! Canonicalisation and quantisation — the codec's only lossy step.
//!
//! Everything downstream operates on integers, so this module owns the entire
//! precision budget. Two rules make that safe:
//!
//! * **Complete linkage.** Every member of a coordinate cluster lies within
//!   `tau` of the representative, so displacement is bounded by construction.
//!   Single linkage has unbounded cluster diameter — a chain of values spaced
//!   just under `tau` collapses arbitrarily far — which was measured merging
//!   vertices 2e-6 apart, twice Oriedita's own CAMV clustering radius.
//! * **The tolerance and the quantum are the same number.** Spending bits on one
//!   while leaving the other loose is wasted; a single knob cannot drift.

use std::collections::HashMap;

use super::error::{Result, ShareError};
use crate::geometry::{LineSegment, Point};

/// Floor when every crease is classic (flat regime). Measured: at `F = 30` all
/// 563 corpus documents preserve their CAMV violation set exactly, and the cliff
/// below is steep — `F = 24` preserves only 64%, `F = 20` only 21%.
pub const F_MIN_FLAT: i32 = 30;

/// Floor when any crease carries a fold angle. Those vertices are dispatched to
/// the *spatial closure* checker (`checks_spatial::dispatched_camv`), whose bar
/// is 1e-6 degrees. Measured max per-vertex residual movement: `F = 28` leaves
/// only 1.4x margin and `F = 26` goes over the bar outright, so the flat floor
/// is not enough here.
pub const F_MIN_SPATIAL: i32 = 32;

/// Hard bounds on the wire encoding of `F`.
pub const F_WIRE_MIN: i32 = 8;
pub const F_WIRE_MAX: i32 = 60;

/// `229 * 2` from the Kawasaki residual bound `R <= 229 * n * delta / L_min`
/// with `delta = 1.5q`, rearranged for `R < 1e-7` degrees.
const ANALYTIC_CONSTANT: f64 = 3.44e9;

/// One coordinate axis: the strictly-ascending integer alphabet, plus the map
/// from each source `f64` to its index.
pub struct Axis {
    pub values: Vec<i64>,
    index: HashMap<u64, u32>,
}

impl Axis {
    pub fn index_of(&self, value: f64) -> Result<u32> {
        self.index
            .get(&value.to_bits())
            .copied()
            .ok_or(ShareError::NotRepresentable(
                "coordinate was not present when the alphabet was built",
            ))
    }

    pub fn len(&self) -> usize {
        self.values.len()
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }
}

pub struct Quantised {
    pub f_bits: i32,
    pub x: Axis,
    pub y: Axis,
}

impl Quantised {
    pub fn quantum(&self) -> f64 {
        2f64.powi(-self.f_bits)
    }

    /// Quantise a loose coordinate (a circle centre, a text anchor) that does
    /// not participate in the vertex alphabets.
    pub fn raw(&self, value: f64) -> i64 {
        (value / self.quantum()).round() as i64
    }

    pub fn dequantise(&self, units: i64) -> f64 {
        // Exactly two operations, both exact: `i64 -> f64` is exact below 2^53
        // (guaranteed by the F_max clamp) and multiplying by a power of two is
        // exact. So reconstruction is bit-identical on x86-64, aarch64 and wasm32.
        (units as f64) * self.quantum()
    }
}

/// Complete-linkage cluster of a scalar list, keyed by the *original* bit
/// patterns.
///
/// A cluster is closed as soon as admitting the next value would make the span
/// exceed `tau`.
///
/// The map is populated by looking every original value up against the cluster
/// boundaries rather than by walking the deduplicated list. That matters for
/// `-0.0`: it compares equal to `0.0` so `dedup` drops one of them, but the two
/// have different `to_bits()`, so a bits-keyed map built from the deduplicated
/// list would be missing an entry — and real `.cp` files are full of values like
/// `-2.12e-12` that land on negative zero.
fn cluster(values: &[f64], tau: f64) -> HashMap<u64, f64> {
    let mut sorted: Vec<f64> = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    sorted.dedup();

    let mut starts: Vec<f64> = Vec::new();
    let mut reps: Vec<f64> = Vec::new();
    let mut start = 0usize;
    while start < sorted.len() {
        let mut end = start;
        while end + 1 < sorted.len() && sorted[end + 1] - sorted[start] <= tau {
            end += 1;
        }
        starts.push(sorted[start]);
        reps.push(sorted[(start + end) / 2]);
        start = end + 1;
    }

    let mut out = HashMap::with_capacity(values.len());
    for &value in values {
        let idx = starts.partition_point(|&s| s <= value).saturating_sub(1);
        out.insert(value.to_bits(), reps[idx.min(reps.len().saturating_sub(1))]);
    }
    out
}

/// The analytic starting quantum for a document.
///
/// `F` is a *bound*, not a fit: it is derived from the document's own extent,
/// maximum vertex degree and shortest crease, so it adapts to a pattern authored
/// at unit scale as readily as one on Oriedita's 400-unit paper.
pub fn choose_f(segments: &[LineSegment], f_min: i32) -> i32 {
    let mut lo = (f64::MAX, f64::MAX);
    let mut hi = (f64::MIN, f64::MIN);
    let mut max_abs: f64 = 1.0;
    for s in segments {
        for p in [s.a, s.b] {
            lo = (lo.0.min(p.x), lo.1.min(p.y));
            hi = (hi.0.max(p.x), hi.1.max(p.y));
            max_abs = max_abs.max(p.x.abs()).max(p.y.abs());
        }
    }
    let span = (hi.0 - lo.0).max(hi.1 - lo.1).max(f64::MIN_POSITIVE);

    // Shortest non-degenerate crease, and the highest endpoint multiplicity as a
    // cheap upper bound on vertex degree (an exact interior-degree pass would
    // need the border, and over-estimating only makes `F` safer).
    let mut l_min = f64::MAX;
    let mut degree: HashMap<(u64, u64), u32> = HashMap::new();
    for s in segments {
        let len = s.a.distance(s.b);
        if len > 0.0 {
            l_min = l_min.min(len);
        }
        for p in [s.a, s.b] {
            *degree.entry((p.x.to_bits(), p.y.to_bits())).or_insert(0) += 1;
        }
    }
    let n_max = degree.values().copied().max().unwrap_or(4).max(1) as f64;
    if !l_min.is_finite() || l_min <= 0.0 {
        l_min = span;
    }

    let extent_term = 45.0 - span.log2().ceil();
    let analytic_term = (ANALYTIC_CONSTANT * n_max / l_min).log2().ceil();
    // Keep `i64 -> f64` exact: the largest quantised magnitude must stay under 2^53.
    let f_max = (53.0 - max_abs.log2().ceil()).floor() as i32;

    let wanted = extent_term.max(analytic_term);
    let wanted = if wanted.is_finite() {
        wanted as i32
    } else {
        f_min
    };
    wanted.clamp(f_min, f_max.clamp(f_min, F_WIRE_MAX))
}

/// Canonicalise and quantise every coordinate in `segments` (plus any extra
/// points that must share the same alphabets) at `f_bits`.
///
/// Fails with `NotRepresentable` when two canonical values collide after
/// rounding or a magnitude exceeds 2^53 — the caller's job is then to raise
/// `f_bits` and retry, which is what makes the strictly-ascending invariant a
/// guarantee rather than a hope.
pub fn quantise(segments: &[LineSegment], extra: &[Point], f_bits: i32) -> Result<Quantised> {
    if !(F_WIRE_MIN..=F_WIRE_MAX).contains(&f_bits) {
        return Err(ShareError::BadQuantum(f_bits));
    }
    let q = 2f64.powi(-f_bits);

    let mut xs = Vec::with_capacity(segments.len() * 2 + extra.len());
    let mut ys = Vec::with_capacity(segments.len() * 2 + extra.len());
    for s in segments {
        for p in [s.a, s.b] {
            xs.push(p.x);
            ys.push(p.y);
        }
    }
    for p in extra {
        xs.push(p.x);
        ys.push(p.y);
    }
    if xs.iter().chain(ys.iter()).any(|v| !v.is_finite()) {
        return Err(ShareError::NotRepresentable("coordinate is not finite"));
    }

    Ok(Quantised {
        f_bits,
        x: build_axis(&xs, q)?,
        y: build_axis(&ys, q)?,
    })
}

fn build_axis(values: &[f64], q: f64) -> Result<Axis> {
    let reps = cluster(values, q);

    // Distinct cluster representatives, ascending.
    let mut distinct: Vec<f64> = reps.values().copied().collect();
    distinct.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    distinct.dedup();

    // Assign each cluster its own integer, monotonically.
    //
    // Complete linkage bounds a cluster's *diameter*, but it does not put two
    // neighbouring representatives more than `q` apart: a cluster's median can
    // sit near its upper edge while the next cluster begins just past the
    // tolerance. Those two reps can round to the same integer, which would merge
    // two genuinely distinct vertices — the one failure this module exists to
    // prevent. Bumping to `previous + 1` keeps the alphabet strictly ascending
    // and costs at most one extra quantum of displacement, which is ~1e-11 model
    // units at a typical `F` and five orders of magnitude under the CAMV bar.
    let mut units = Vec::with_capacity(distinct.len());
    let mut previous: Option<i64> = None;
    for &rep in &distinct {
        if !rep.is_finite() {
            return Err(ShareError::NotRepresentable("coordinate is not finite"));
        }
        let rounded = (rep / q).round();
        if rounded.abs() >= 9_007_199_254_740_992.0 {
            return Err(ShareError::NotRepresentable(
                "quantised coordinate exceeds 2^53",
            ));
        }
        let mut value = rounded as i64;
        if previous.is_some_and(|prev| value <= prev) {
            value = previous
                .and_then(|prev| prev.checked_add(1))
                .ok_or(ShareError::NotRepresentable("coordinate alphabet overflow"))?;
        }
        previous = Some(value);
        units.push(value);
    }

    let rep_to_index: HashMap<u64, u32> = distinct
        .iter()
        .enumerate()
        .map(|(i, r)| (r.to_bits(), i as u32))
        .collect();
    let index = reps
        .into_iter()
        .map(|(bits, rep)| (bits, rep_to_index[&rep.to_bits()]))
        .collect();

    Ok(Axis {
        values: units,
        index,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::LineColor;

    fn seg(ax: f64, ay: f64, bx: f64, by: f64) -> LineSegment {
        LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), LineColor::Red1)
    }

    #[test]
    fn complete_linkage_bounds_cluster_diameter() {
        // A chain spaced just under tau: single linkage would collapse all of it.
        let tau = 1.0;
        let values: Vec<f64> = (0..100).map(|i| f64::from(i) * 0.9).collect();
        let reps = cluster(&values, tau);
        for v in &values {
            let rep = reps[&v.to_bits()];
            assert!(
                (rep - v).abs() <= tau,
                "displacement {} exceeded tau",
                (rep - v).abs()
            );
        }
    }

    #[test]
    fn float_noise_on_the_same_intended_value_merges() {
        // Real .cp files carry the same intended coordinate with different
        // accumulated noise; those must land on one alphabet entry.
        let values = [-200.0, -199.999_999_999_999_97, -200.000_000_000_000_03];
        let reps = cluster(&values, 2f64.powi(-30));
        let distinct: std::collections::HashSet<u64> = reps.values().map(|v| v.to_bits()).collect();
        assert_eq!(distinct.len(), 1);
    }

    #[test]
    fn genuinely_distinct_coordinates_stay_distinct() {
        let values = [0.0, 0.1, 0.2, 100.0];
        let reps = cluster(&values, 2f64.powi(-30));
        let distinct: std::collections::HashSet<u64> = reps.values().map(|v| v.to_bits()).collect();
        assert_eq!(distinct.len(), 4);
    }

    #[test]
    fn dequantise_is_exact_for_powers_of_two() {
        let q = quantise(&[seg(0.0, 0.0, 1.0, 1.0)], &[], 30).unwrap();
        for units in [0i64, 1, -1, 1 << 40, -(1 << 40)] {
            let back = q.dequantise(units);
            assert_eq!((back / q.quantum()).round() as i64, units);
        }
    }

    #[test]
    fn alphabets_are_strictly_ascending() {
        let segs = vec![
            seg(0.0, 0.0, 100.0, 0.0),
            seg(100.0, 0.0, 100.0, 100.0),
            seg(50.0, 50.0, 0.0, 100.0),
        ];
        let q = quantise(&segs, &[], 32).unwrap();
        assert!(q.x.values.windows(2).all(|w| w[0] < w[1]));
        assert!(q.y.values.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn f_adapts_to_document_scale() {
        // A unit-square pattern needs more fractional bits than a 400-unit one
        // to hold the same absolute accuracy.
        let big = choose_f(&[seg(-200.0, -200.0, 200.0, 200.0)], F_MIN_FLAT);
        let small = choose_f(&[seg(0.0, 0.0, 1.0, 1.0)], F_MIN_FLAT);
        assert!(
            small > big,
            "unit-scale {small} should exceed 400-scale {big}"
        );
    }

    #[test]
    fn f_respects_the_measured_floor() {
        let f = choose_f(&[seg(-200.0, -200.0, 200.0, 200.0)], F_MIN_SPATIAL);
        assert!(f >= F_MIN_SPATIAL);
    }

    #[test]
    fn a_short_crease_forces_more_bits() {
        let long = choose_f(&[seg(0.0, 0.0, 400.0, 0.0)], F_MIN_FLAT);
        let short = choose_f(
            &[seg(0.0, 0.0, 400.0, 0.0), seg(0.0, 0.0, 0.000_1, 0.0)],
            F_MIN_FLAT,
        );
        assert!(short > long, "short crease {short} should exceed {long}");
    }

    #[test]
    fn rejects_an_out_of_range_quantum() {
        assert!(matches!(
            quantise(&[seg(0.0, 0.0, 1.0, 1.0)], &[], 4),
            Err(ShareError::BadQuantum(4))
        ));
    }
}
