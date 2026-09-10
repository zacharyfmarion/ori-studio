//! The lattices exact crease patterns live on.
//!
//! "On a lattice" means *exactly expressible in some angle system*: box
//! pleating (0°/45°/90° with rational offsets) and 22.5° designs (offsets in
//! ℤ[√2]/2ᵏ) both are, and so are 15° designs (ℤ[√3]) and the rational
//! connectors box pleating draws between grid points (slope 1/2, 1/3, 2/3 …).
//! A line's direction is tested against the `k·π/8` and `k·π/12` families and
//! against integer normals `(a, b)` up to a bound; its offset is tested in
//! the **ring normal** of that direction — the normal with components in
//! ℤ[√r] (or in ℤ for a rational direction) — because `d` of a unit normal is
//! irrational even for a lattice line (a 45° line `x + y = 1/2` has
//! `d = 1/(2√2)`), while the ring offset `c = n_ring · p` is `1/2`.
//!
//! Two tiers of candidates serve two questions:
//!
//! - **Dense** (the exactness residual, threshold `TOL`): directions with
//!   `|a|, |b| ≤ 32`; any rational offset with denominator ≤
//!   [`DENSE_MAX_DENOMINATOR`]; ring offsets `(p + q√r)/D` for the
//!   denominators of [`dense_ring_denominators`] (powers of two to 64, and
//!   the odd grids 3, 5, 7 with a few halvings) with `|q| ≤ 12` — the
//!   irrational coefficient of `(√2−1)⁴`, the deepest landmark real designs
//!   reach; `p` is unbounded. And, at the same denominators, the **pure**
//!   elements `q√r/D` with no bound on `q` at all: a 60° grid of `D` rows
//!   puts every oblique line exactly there, and `q` is the row index, which
//!   runs the width of the sheet (a 14-row triangle grid reaches `q = 21`).
//!   That is one candidate per denominator — a lattice as sparse as the
//!   rationals at `D` — so it costs nothing in false positives; the landmark
//!   bound is what keeps `p ≠ 0` from being a second free parameter. The
//!   offset ring is the *design's*: an axis line in a 22.5° design is tested
//!   in ℤ[√2] too. ℤ[√2] is dense in ℝ, so the bounds are what make "off the
//!   lattice" a meaningful verdict: with them a random offset lands within
//!   `TOL` of a candidate with probability of ~1.4 % per ring and ~4 % for
//!   the rationals, so a design with many off-lattice lines is still
//!   classified as such, while the count of off-lattice lines undercounts by
//!   about that much.
//! - **Sparse snap families** (the snap, radius [`SNAP_RADIUS`]): directions
//!   with `|a|, |b| ≤ 8`, and one denominator family per odd `m ≤ 25`. For a
//!   line whose ring normal has magnitude `|n|`, the family admits offsets
//!   `(p + q√r)/(m·2ʲ)` with `|q| ≤ 5` up to the largest `j` whose candidate
//!   set still has a pitch, in sheet distance (`pitch / |n|`), of at least
//!   `2·SNAP_RADIUS`, so the nearest element is unambiguous for any residual
//!   under the snap radius. The pitch is measured on the actual candidate
//!   set rather than assumed. A union of families would create near
//!   coincidences (`1/3` vs `85/256` are `1.3e-3` apart) and snap a jittered
//!   `1/3` onto `85/256`; choosing one family per component avoids that.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::tol::{SNAP_RADIUS, TOL};

/// √2.
pub const SQRT2: f64 = std::f64::consts::SQRT_2;
/// √3.
pub const SQRT3: f64 = 1.732_050_807_568_877_2;

/// Largest denominator the dense rational tier accepts for every component.
pub const DENSE_MAX_DENOMINATOR: u32 = 256;
/// Ceiling on the one extra rational denominator a component's own lines may
/// reveal ([`infer_rational_denominator`]): [`SNAP_MAX_ODD`] halved as deep
/// as [`DENSE_MAX_DENOMINATOR`] goes.
pub const INFERRED_MAX_DENOMINATOR: u32 = SNAP_MAX_ODD * DENSE_MAX_DENOMINATOR;
/// Largest `|q|` the dense ring tier searches: `(17 − 12√2)/16`, the
/// fourth power of `√2 − 1`, is the deepest landmark real designs reach.
pub const DENSE_MAX_Q: i64 = 12;
/// Odd multipliers and their largest power of two in the dense ring tier's
/// denominators (see [`dense_ring_denominators`]).
pub const DENSE_RING_DENOMINATOR_BOUNDS: [(u32, u32); 4] = [(1, 6), (3, 4), (5, 2), (7, 1)];
/// Rings a snap may assume for a whole component's offsets.
pub const SNAP_RING_VARIANTS: [Ring; 3] = [Ring::Rational, Ring::Sqrt2, Ring::Sqrt3];
/// Largest `|a|, |b|` of an integer normal the dense tier considers.
pub const DENSE_SLOPE_BOUND: i64 = 32;
/// Largest `|q|` a sparse snap family searches.
pub const SNAP_MAX_Q: i64 = 5;
/// Largest odd multiplier that gets its own snap family.
pub const SNAP_MAX_ODD: u32 = 25;
/// Largest power of two a snap family may reach.
pub const SNAP_MAX_K: u32 = 8;
/// Largest `|a|, |b|` of an integer normal the snap tier considers.
pub const SNAP_SLOPE_BOUND: i64 = 8;
/// Ring offsets of lines crossing the unit sheet lie within this range.
const OFFSET_RANGE: f64 = 3.0;

/// The number ring a direction's offsets live in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Ring {
    /// Offsets are rational: 0°, 45°, 90° and every rational-slope line.
    Rational,
    /// Offsets in ℤ[√2]: the 22.5° and 67.5° lines.
    Sqrt2,
    /// Offsets in ℤ[√3]: the 15°, 30°, 60° and 75° lines.
    Sqrt3,
}

impl Ring {
    /// Short name for family labels.
    pub fn name(self) -> &'static str {
        match self {
            Ring::Rational => "rational",
            Ring::Sqrt2 => "sqrt2",
            Ring::Sqrt3 => "sqrt3",
        }
    }

    /// The irrational generator (`0` for the rationals).
    pub fn irrational(self) -> f64 {
        match self {
            Ring::Rational => 0.0,
            Ring::Sqrt2 => SQRT2,
            Ring::Sqrt3 => SQRT3,
        }
    }
}

/// How a lattice direction was recognised.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DirectionKind {
    /// A multiple of π/24 that is a multiple of π/8 or π/12 (the index is in
    /// units of π/24, so ±3 is ±22.5°, ±2 is ±15°).
    Family { index_24: i32 },
    /// An integer normal `(a, b)`, coprime, `a > 0` or `a == 0 && b > 0`.
    Rational { a: i64, b: i64 },
}

/// A lattice direction for a line normal: its ring and the two normals.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LatticeDirection {
    pub kind: DirectionKind,
    pub ring: Ring,
    /// Normal with components in ℤ[√r], smallest representative.
    pub ring_normal: [f64; 2],
    /// `ring_normal` normalised.
    pub unit_normal: [f64; 2],
}

impl LatticeDirection {
    fn new(kind: DirectionKind, ring: Ring, ring_normal: [f64; 2]) -> Self {
        let len = (ring_normal[0].powi(2) + ring_normal[1].powi(2)).sqrt();
        Self {
            kind,
            ring,
            ring_normal,
            unit_normal: [ring_normal[0] / len, ring_normal[1] / len],
        }
    }

    /// `|ring_normal|`: converts ring-offset units to sheet distance.
    pub fn ring_scale(&self) -> f64 {
        (self.ring_normal[0].powi(2) + self.ring_normal[1].powi(2)).sqrt()
    }

    /// Ring offset of a point: `ring_normal · p`.
    pub fn ring_offset(&self, p: [f64; 2]) -> f64 {
        self.ring_normal[0] * p[0] + self.ring_normal[1] * p[1]
    }
}

fn family_direction(index_24: i32) -> LatticeDirection {
    let s = if index_24 < 0 { -1.0 } else { 1.0 };
    let t8 = SQRT2 - 1.0; // tan 22.5°
    let t12 = 2.0 - SQRT3; // tan 15°
    let (ring_normal, ring) = match index_24.abs() {
        0 => ([1.0, 0.0], Ring::Rational),
        2 => ([1.0, s * t12], Ring::Sqrt3),
        3 => ([1.0, s * t8], Ring::Sqrt2),
        4 => ([SQRT3, s], Ring::Sqrt3),
        6 => ([1.0, s], Ring::Rational),
        8 => ([1.0, s * SQRT3], Ring::Sqrt3),
        9 => ([t8, s], Ring::Sqrt2),
        10 => ([t12, s], Ring::Sqrt3),
        _ => ([0.0, s], Ring::Rational),
    };
    LatticeDirection::new(DirectionKind::Family { index_24 }, ring, ring_normal)
}

/// The family angle nearest a canonical normal angle `theta ∈ [−π/2, π/2]`
/// and the angular residual in radians.
pub fn nearest_family_angle(theta: f64) -> (LatticeDirection, f64) {
    use std::f64::consts::PI;
    let k8 = (theta / (PI / 8.0)).round();
    let r8 = (theta - k8 * PI / 8.0).abs();
    let k12 = (theta / (PI / 12.0)).round();
    let r12 = (theta - k12 * PI / 12.0).abs();
    let index = if r8 <= r12 {
        (k8 as i32) * 3
    } else {
        (k12 as i32) * 2
    };
    (family_direction(index.clamp(-12, 12)), r8.min(r12))
}

fn gcd(mut a: i64, mut b: i64) -> i64 {
    a = a.abs();
    b = b.abs();
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

/// Angle between two directions, orientation-insensitive.
fn angular_residual(n: [f64; 2], m: [f64; 2]) -> f64 {
    let cross = (n[0] * m[1] - n[1] * m[0]).abs();
    let dot = (n[0] * m[0] + n[1] * m[1]).abs();
    cross.atan2(dot)
}

/// The nearest coprime integer normal with `|a|, |b| ≤ bound` (canonical sign)
/// to a unit normal `n`, and the angular residual.
fn nearest_rational_direction(n: [f64; 2], bound: i64) -> Option<(LatticeDirection, f64)> {
    let mut best: Option<(LatticeDirection, f64)> = None;
    for a in 0..=bound {
        for b in -bound..=bound {
            if (a == 0 && b <= 0) || gcd(a, b) != 1 {
                continue;
            }
            let len = ((a * a + b * b) as f64).sqrt();
            let residual = angular_residual(n, [a as f64 / len, b as f64 / len]);
            if best.as_ref().is_none_or(|(_, r)| residual < *r) {
                best = Some((
                    LatticeDirection::new(
                        DirectionKind::Rational { a, b },
                        Ring::Rational,
                        [a as f64, b as f64],
                    ),
                    residual,
                ));
            }
        }
    }
    best
}

/// The lattice direction nearest a unit normal: a family angle, or an integer
/// normal with `|a|, |b| ≤ slope_bound` when that is strictly closer. Returns
/// the angular residual in radians alongside.
pub fn nearest_direction(n: [f64; 2], slope_bound: i64) -> (LatticeDirection, f64) {
    let (family, family_residual) = nearest_family_angle(n[1].atan2(n[0]));
    if family_residual < TOL {
        return (family, family_residual);
    }
    match nearest_rational_direction(n, slope_bound) {
        Some((rational, residual)) if residual < family_residual => (rational, residual),
        _ => (family, family_residual),
    }
}

/// One lattice element `(p + q·√r) / denominator`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LatticeOffset {
    pub p: i64,
    pub q: i64,
    pub denominator: u32,
    pub ring: Ring,
    /// The element's numeric value (in ring-offset units).
    pub value: f64,
}

/// The nearest element of `{(p + q√r)/denominator : |q| ≤ q_max}` to `c`,
/// with the residual `|c − value|`.
pub fn nearest_offset(c: f64, ring: Ring, denominator: u32, q_max: i64) -> (LatticeOffset, f64) {
    let r = ring.irrational();
    let denom = denominator as f64;
    let qs = if ring == Ring::Rational {
        0..=0
    } else {
        -q_max..=q_max
    };
    let mut best: Option<(LatticeOffset, f64)> = None;
    for q in qs {
        let t = c * denom - q as f64 * r;
        let p = t.round();
        let value = (p + q as f64 * r) / denom;
        let residual = (c - value).abs();
        let candidate = LatticeOffset {
            p: p as i64,
            q,
            denominator,
            ring,
            value,
        };
        match &best {
            Some((_, best_res)) if *best_res <= residual => {}
            _ => best = Some((candidate, residual)),
        }
    }
    // The q range is never empty, so `best` is always set; the fallback is
    // unreachable but keeps the function total.
    best.unwrap_or((
        LatticeOffset {
            p: 0,
            q: 0,
            denominator,
            ring,
            value: 0.0,
        },
        c.abs(),
    ))
}

/// The nearest pure element `q√r/denominator` — no rational part, any `q` —
/// with the residual `|c − value|`. Where a grid of `denominator` rows in a
/// 60° (or 45°) design puts its oblique lines; `q` is the row index.
pub fn nearest_pure_offset(c: f64, ring: Ring, denominator: u32) -> (LatticeOffset, f64) {
    let r = ring.irrational();
    let denom = denominator as f64;
    let q = (c * denom / r).round();
    let value = q * r / denom;
    (
        LatticeOffset {
            p: 0,
            q: q as i64,
            denominator,
            ring,
            value,
        },
        (c - value).abs(),
    )
}

/// Denominators of the dense ring tier, ascending: `m · 2ᵏ` for
/// `(m, k) ≤ (1, 6), (3, 4), (5, 2), (7, 1)` — the powers of two 22.5°
/// designs halve into, and the odd grids box-pleating sheets put them on.
/// (The bounds live in [`DENSE_RING_DENOMINATOR_BOUNDS`]; this list is
/// derived from them.)
pub fn dense_ring_denominators() -> &'static [u32] {
    static DENOMINATORS: OnceLock<Vec<u32>> = OnceLock::new();
    DENOMINATORS.get_or_init(|| {
        let mut out: Vec<u32> = DENSE_RING_DENOMINATOR_BOUNDS
            .iter()
            .flat_map(|&(m, k_max)| (0..=k_max).map(move |k| m << k))
            .collect();
        out.sort_unstable();
        out.dedup();
        out
    })
}

/// Which rings a direction's offsets are tested in. The offset ring is a
/// property of the *design*, not of the line: an axis or 45° line in a 22.5°
/// design has a ℤ[√2] offset. Rational-slope connectors are only expected in
/// grid designs, so they get the rationals alone.
fn offset_rings(direction: &LatticeDirection) -> &'static [Ring] {
    match (direction.kind, direction.ring) {
        (DirectionKind::Rational { .. }, _) => &[Ring::Rational],
        (_, Ring::Rational) => &[Ring::Rational, Ring::Sqrt2, Ring::Sqrt3],
        (_, Ring::Sqrt2) => &[Ring::Rational, Ring::Sqrt2],
        (_, Ring::Sqrt3) => &[Ring::Rational, Ring::Sqrt3],
    }
}

/// The smallest denominator ≤ `max` whose rationals hold `c` within `TOL`,
/// if any.
pub fn rational_denominator_within(c: f64, max: u32) -> Option<u32> {
    (1..=max).find(|&d| nearest_offset(c, Ring::Rational, d, 0).1 < TOL)
}

/// The smallest denominator ≤ [`DENSE_MAX_DENOMINATOR`] whose rationals hold
/// `c` within `TOL`, if any.
pub fn dense_rational_denominator(c: f64) -> Option<u32> {
    rational_denominator_within(c, DENSE_MAX_DENOMINATOR)
}

/// The one rational denominator a component's own offsets agree on, when it
/// is finer than [`DENSE_MAX_DENOMINATOR`].
///
/// `offsets` are the ring offsets the dense tier could **not** express (the
/// caller filters those — passing an expressible offset only wastes a
/// search). Each is given its smallest denominator up to
/// [`INFERRED_MAX_DENOMINATOR`], and the winner is the denominator that
/// **explains the most of them** — a design's grid divides every one of its
/// own offsets — smallest first on a tie.
///
/// A design drawn on a 320-, 416- or 768-grid is exactly constructible but
/// invisible to a tier that stops at 256, so its offsets read as off-lattice.
/// Raising [`DENSE_MAX_DENOMINATOR`] instead is not an option: the share of
/// arbitrary offsets that land within `TOL` of *some* `p/d` grows as `d²`
/// (4 % at 256, 36 % at 768 — measured), which would make "off the lattice"
/// meaningless. Admitting one denominator the component's own lines agree on
/// costs one denominator's worth of false positives.
///
/// The candidate has to look like a grid, not merely fit: `odd · 2ᵏ` with the
/// odd part no coarser than the snap tier's ([`SNAP_MAX_ODD`]). Every real
/// fine grid measured on the corpus has that shape (320 = 5·2⁶, 384 = 3·2⁷,
/// 416 = 13·2⁵, 512 = 2⁹, 768 = 3·2⁸), while an arbitrary offset's smallest
/// denominator within `TOL` clusters around `√(π²/6·TOL) ≈ 1300` with an
/// arbitrary factorisation. Without this rule a real design (cpoogle
/// Dragon-by-Lorbeer) was measured taking `Exact` on a denominator of
/// 1121 = 19·59.
///
/// The agreement has to be real too: `None` unless the winner explains at
/// least two offsets and at least a quarter of them. A grid explains nearly
/// all of what missed the tier (328 of 346 on the design this was measured
/// against); a handful of hand-placed offsets explain only themselves, so the
/// inference fails closed to the dense tier. Taking the lcm of every missing
/// offset instead would let a single stray line disable the inference for a
/// whole grid, which is exactly what that design does.
pub fn infer_rational_denominator(offsets: impl IntoIterator<Item = f64>) -> Option<u32> {
    let mut total = 0usize;
    let denominators: Vec<u32> = offsets
        .into_iter()
        .inspect(|_| total += 1)
        .filter_map(|c| rational_denominator_within(c, INFERRED_MAX_DENOMINATOR))
        .collect();
    let mut best: Option<(usize, u32)> = None;
    for &d in &denominators {
        if d <= DENSE_MAX_DENOMINATOR || !is_grid_shaped(d) {
            continue;
        }
        let support = denominators
            .iter()
            .filter(|&&e| d.is_multiple_of(e))
            .count();
        if best.is_none_or(|(bs, bd)| support > bs || (support == bs && d < bd)) {
            best = Some((support, d));
        }
    }
    let (support, denominator) = best?;
    (support >= 2 && support * 4 >= total).then_some(denominator)
}

/// `odd · 2ᵏ` with `odd ≤ SNAP_MAX_ODD`, within [`INFERRED_MAX_DENOMINATOR`].
fn is_grid_shaped(denominator: u32) -> bool {
    denominator > 0
        && denominator <= INFERRED_MAX_DENOMINATOR
        && (denominator >> denominator.trailing_zeros()) <= SNAP_MAX_ODD
}

/// The lattice a component's own lines reveal, beyond the tiers every
/// component gets.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ComponentGrid {
    /// The odd grid factor of the rational offsets ([`infer_grid_factor`]);
    /// the ring tiers also admit `odd · 2ᵏ`, `k ≤ 2`.
    pub odd_factor: Option<u32>,
    /// The rational denominator the component's own offsets share when it is
    /// finer than [`DENSE_MAX_DENOMINATOR`] ([`infer_rational_denominator`]);
    /// the rational tier also admits it and its divisors.
    pub rational_denominator: Option<u32>,
}

impl ComponentGrid {
    /// Divisors of [`Self::rational_denominator`] the dense rational tier
    /// does not already scan, ascending.
    fn extra_rational_denominators(&self) -> Vec<u32> {
        let Some(d) = self.rational_denominator else {
            return Vec::new();
        };
        (DENSE_MAX_DENOMINATOR + 1..=d)
            .filter(|k| d.is_multiple_of(*k))
            .collect()
    }
}

/// The odd grid factor a component's rational offsets reveal: the least
/// common multiple of their smallest denominators, with powers of two
/// divided out (they are in the base ring set already). `None` when nothing
/// is rational, the lcm exceeds [`DENSE_MAX_DENOMINATOR`], or the factor is
/// a power of two.
pub fn infer_grid_factor(denominators: impl IntoIterator<Item = u32>) -> Option<u32> {
    let mut lcm: u64 = 1;
    for d in denominators {
        let d = u64::from(d.max(1));
        lcm = lcm / gcd(lcm as i64, d as i64) as u64 * d;
        if lcm > u64::from(DENSE_MAX_DENOMINATOR) {
            return None;
        }
    }
    let odd = lcm >> lcm.trailing_zeros();
    (odd > 1).then_some(odd as u32)
}

/// Dense-tier nearest element and residual for a line's ring offset `c` in
/// `direction`: the smallest denominator (rationals first, then the design
/// rings) that fits within `TOL`, else the best fit overall. `grid` is what
/// the component's own lines revealed: its odd grid factor lets the ring
/// tiers also admit `grid · 2ᵏ` (k ≤ 2), so a 22.5° accent on a 13-grid sheet
/// is recognised without admitting every odd denominator for every sheet, and
/// its rational denominator lets the rational tier reach past
/// [`DENSE_MAX_DENOMINATOR`] for that component alone.
pub fn dense_offset_residual(
    c: f64,
    direction: &LatticeDirection,
    grid: ComponentGrid,
) -> (LatticeOffset, f64) {
    let mut best: Option<(LatticeOffset, f64)> = None;
    let mut consider = |candidate: (LatticeOffset, f64)| -> bool {
        let exact = candidate.1 < TOL;
        match &best {
            Some((_, r)) if *r <= candidate.1 => {}
            _ => best = Some(candidate),
        }
        exact
    };
    let grid_denominators: Vec<u32> = grid
        .odd_factor
        .into_iter()
        .flat_map(|g| (0..=2).map(move |k| g << k))
        .filter(|&d| d <= DENSE_MAX_DENOMINATOR && !dense_ring_denominators().contains(&d))
        .collect();
    let extra_rational = grid.extra_rational_denominators();
    'rings: for &ring in offset_rings(direction) {
        match ring {
            Ring::Rational => {
                for denominator in (1..=DENSE_MAX_DENOMINATOR).chain(extra_rational.iter().copied())
                {
                    if consider(nearest_offset(c, ring, denominator, 0)) {
                        break 'rings;
                    }
                }
            }
            Ring::Sqrt2 | Ring::Sqrt3 => {
                for &denominator in dense_ring_denominators().iter().chain(&grid_denominators) {
                    if consider(nearest_offset(c, ring, denominator, DENSE_MAX_Q))
                        || consider(nearest_pure_offset(c, ring, denominator))
                    {
                        break 'rings;
                    }
                }
            }
        }
    }
    best.unwrap_or_else(|| nearest_offset(c, Ring::Rational, 1, 0))
}

/// One snap family: offsets on denominators `m · 2ʲ`. `pitches[ring][j]` is
/// the smallest gap, in ring-offset units, between candidates of the family
/// up to level `j`; a line whose ring normal has magnitude `|n|` may use
/// level `j` only while `pitches[j] / |n| ≥ 2 · SNAP_RADIUS`.
#[derive(Debug, Clone, PartialEq)]
pub struct SnapFamily {
    pub name: String,
    pub odd: u32,
    rational_pitches: Vec<f64>,
    sqrt2_pitches: Vec<f64>,
    sqrt3_pitches: Vec<f64>,
}

impl SnapFamily {
    fn pitches(&self, ring: Ring) -> &[f64] {
        match ring {
            Ring::Rational => &self.rational_pitches,
            Ring::Sqrt2 => &self.sqrt2_pitches,
            Ring::Sqrt3 => &self.sqrt3_pitches,
        }
    }

    /// The finest denominator a line with ring-normal magnitude `magnitude`
    /// may snap to in this ring, if any.
    pub fn admissible_denominator(&self, ring: Ring, magnitude: f64) -> Option<u32> {
        let min_pitch = 2.0 * SNAP_RADIUS * magnitude;
        self.pitches(ring)
            .iter()
            .rposition(|&pitch| pitch >= min_pitch)
            .map(|k| self.odd << k)
    }

    /// The nearest element of this family to a ring offset `c` of a line
    /// with ring-normal magnitude `magnitude`, with its residual; `None`
    /// when the ring is not representable finely enough.
    pub fn snap_offset(&self, c: f64, ring: Ring, magnitude: f64) -> Option<(LatticeOffset, f64)> {
        let max_denominator = self.admissible_denominator(ring, magnitude)?;
        if ring == Ring::Rational {
            return Some(nearest_offset(c, ring, max_denominator, 0));
        }
        let mut best: Option<(LatticeOffset, f64)> = None;
        let mut denominator = self.odd;
        while denominator <= max_denominator {
            let candidate = nearest_offset(c, ring, denominator, SNAP_MAX_Q);
            if best.as_ref().is_none_or(|(_, r)| candidate.1 < *r) {
                best = Some(candidate);
            }
            denominator *= 2;
        }
        best
    }
}

/// Smallest gap between distinct values of
/// `{(p + q√r)/(odd·2ʲ) : j ≤ k, |q| ≤ q_max}` within the offset range.
fn union_pitch(ring: Ring, odd: u32, k: u32, q_max: i64) -> f64 {
    if ring == Ring::Rational {
        return 1.0 / (odd << k) as f64;
    }
    let r = ring.irrational();
    let mut values = Vec::new();
    for j in 0..=k {
        let d = (odd << j) as f64;
        for q in -q_max..=q_max {
            let base = q as f64 * r;
            let p_min = (-OFFSET_RANGE * d - base).ceil() as i64;
            let p_max = (OFFSET_RANGE * d - base).floor() as i64;
            for p in p_min..=p_max {
                values.push((p as f64 + base) / d);
            }
        }
    }
    values.sort_by(f64::total_cmp);
    values
        .windows(2)
        .map(|w| w[1] - w[0])
        .filter(|g| *g > 1e-12)
        .fold(f64::INFINITY, f64::min)
}

/// Pitches per level until even a unit-magnitude normal could not use the
/// level (every ring normal has magnitude ≥ 1).
fn pitch_table(ring: Ring, odd: u32, q_max: i64) -> Vec<f64> {
    let floor = 2.0 * SNAP_RADIUS;
    let mut pitches = Vec::new();
    for k in 0..=SNAP_MAX_K {
        let pitch = union_pitch(ring, odd, k, q_max);
        if pitch < floor {
            break;
        }
        pitches.push(pitch);
    }
    pitches
}

fn build_snap_families() -> Vec<SnapFamily> {
    (1..=SNAP_MAX_ODD)
        .step_by(2)
        .filter_map(|odd| {
            let rational_pitches = pitch_table(Ring::Rational, odd, 0);
            if rational_pitches.is_empty() {
                return None;
            }
            Some(SnapFamily {
                name: if odd == 1 {
                    "dyadic".to_string()
                } else {
                    format!("odd_{odd}")
                },
                odd,
                rational_pitches,
                sqrt2_pitches: pitch_table(Ring::Sqrt2, odd, SNAP_MAX_Q),
                sqrt3_pitches: pitch_table(Ring::Sqrt3, odd, SNAP_MAX_Q),
            })
        })
        .collect()
}

/// The snap families, coarsest odd multiplier first. Computed once.
pub fn snap_families() -> &'static [SnapFamily] {
    static FAMILIES: OnceLock<Vec<SnapFamily>> = OnceLock::new();
    FAMILIES.get_or_init(build_snap_families)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    #[test]
    fn family_angles_cover_both_families() {
        for (theta, index, ring) in [
            (0.0, 0, Ring::Rational),
            (PI / 12.0, 2, Ring::Sqrt3),
            (PI / 8.0, 3, Ring::Sqrt2),
            (PI / 6.0, 4, Ring::Sqrt3),
            (PI / 4.0, 6, Ring::Rational),
            (PI / 3.0, 8, Ring::Sqrt3),
            (3.0 * PI / 8.0, 9, Ring::Sqrt2),
            (5.0 * PI / 12.0, 10, Ring::Sqrt3),
            (PI / 2.0, 12, Ring::Rational),
            (-PI / 8.0, -3, Ring::Sqrt2),
            (-PI / 2.0, -12, Ring::Rational),
        ] {
            let (dir, residual) = nearest_family_angle(theta + 3e-7);
            assert_eq!(
                dir.kind,
                DirectionKind::Family { index_24: index },
                "theta {theta}"
            );
            assert_eq!(dir.ring, ring);
            assert!((residual - 3e-7).abs() < 1e-12);
            // The ring normal really points at the family angle.
            let ang = dir.unit_normal[1].atan2(dir.unit_normal[0]);
            assert!((ang - theta).abs() < 1e-12, "theta {theta} got {ang}");
        }
        // 7.5° belongs to neither family: residual is the distance to 0 or 15°.
        let (_, residual) = nearest_family_angle(PI / 24.0);
        assert!((residual - PI / 24.0).abs() < 1e-12);
    }

    #[test]
    fn rational_directions_are_recognised_within_their_bound() {
        // A slope-1/3 line: direction (3, 1), normal (1, −3)/√10.
        let len = 10f64.sqrt();
        let n = [1.0 / len, -3.0 / len];
        let (dir, residual) = nearest_direction(n, DENSE_SLOPE_BOUND);
        assert_eq!(dir.kind, DirectionKind::Rational { a: 1, b: -3 });
        assert_eq!(dir.ring, Ring::Rational);
        assert!(residual < 1e-12);
        assert!((dir.ring_offset([1.0 / 3.0, 0.0]) - 1.0 / 3.0).abs() < 1e-15);
        // Family angles win exact ties with their rational twins.
        let (dir, _) = nearest_direction([1.0, 0.0], DENSE_SLOPE_BOUND);
        assert_eq!(dir.kind, DirectionKind::Family { index_24: 0 });
        let (dir, _) = nearest_direction([SQRT2 / 2.0, SQRT2 / 2.0], DENSE_SLOPE_BOUND);
        assert_eq!(dir.kind, DirectionKind::Family { index_24: 6 });
        // Normal angle atan(5/12) = 22.62°: the dense tier names it exactly,
        // the snap tier (bound 8) has no such normal and settles for 22.5°.
        let n = [12.0 / 13.0, 5.0 / 13.0];
        let (dir, residual) = nearest_direction(n, DENSE_SLOPE_BOUND);
        assert_eq!(dir.kind, DirectionKind::Rational { a: 12, b: 5 });
        assert!(residual < 1e-12);
        let (dir, residual) = nearest_direction(n, SNAP_SLOPE_BOUND);
        assert_eq!(dir.kind, DirectionKind::Family { index_24: 3 });
        assert!(residual > 2e-3 && residual < 2.2e-3);
    }

    #[test]
    fn ring_offsets_of_lattice_lines_are_rational_or_in_the_ring() {
        // x + y = 1/2 on the unit square: ring normal (1, 1), offset 1/2.
        let (diag, _) = nearest_family_angle(PI / 4.0);
        let c = diag.ring_offset([0.5, 0.0]);
        let (off, res) = dense_offset_residual(c, &diag, ComponentGrid::default());
        assert!(res < 1e-15);
        assert_eq!((off.p, off.q, off.denominator), (1, 0, 2));
        // A line with normal angle 22.5° (ring normal (1, √2−1)) through the
        // point (1, −(√2−1)): ring offset 2√2 − 2, in ℤ[√2].
        let (dir, res_ang) = nearest_family_angle((SQRT2 - 1.0f64).atan2(1.0));
        assert_eq!(dir.kind, DirectionKind::Family { index_24: 3 });
        assert!(res_ang < 1e-12);
        let c = dir.ring_offset([1.0, -(SQRT2 - 1.0)]);
        let (off, res) = dense_offset_residual(c, &dir, ComponentGrid::default());
        assert!(res < 1e-12, "residual {res}");
        assert_eq!((off.p, off.q, off.denominator), (-2, 2, 1));
        // (17 − 12√2)/16, a fourth-generation 22.5° landmark.
        let (off, res) =
            dense_offset_residual((17.0 - 12.0 * SQRT2) / 16.0, &dir, ComponentGrid::default());
        assert!(res < 1e-12);
        assert_eq!((off.p, off.q, off.denominator), (17, -12, 16));
        // The offset ring belongs to the design: a 45° line and an axis line
        // in a 22.5° design laid out on thirds (iguana component 14).
        let (off, res) =
            dense_offset_residual((12.0 - SQRT2) / 6.0, &diag, ComponentGrid::default());
        assert!(res < 1e-12);
        assert_eq!(
            (off.p, off.q, off.denominator, off.ring),
            (12, -1, 6, Ring::Sqrt2)
        );
        let (axis, _) = nearest_family_angle(0.0);
        let (off, res) =
            dense_offset_residual((1.0 + 2.0 * SQRT2) / 3.0, &axis, ComponentGrid::default());
        assert!(res < 1e-12);
        assert_eq!((off.p, off.q, off.denominator), (1, 2, 3));
        // A 22.5° accent on a 13-grid sheet (iguana component 15) needs the
        // component's grid factor; without it the offset is off the lattice.
        let accent = (25.0 - 12.0 * SQRT2) / 13.0;
        let (_, res) = dense_offset_residual(accent, &dir, ComponentGrid::default());
        assert!(res > TOL);
        let (off, res) = dense_offset_residual(
            accent,
            &dir,
            ComponentGrid {
                odd_factor: Some(13),
                ..Default::default()
            },
        );
        assert!(res < 1e-12);
        assert_eq!((off.p, off.q, off.denominator), (25, -12, 13));
        assert_eq!(infer_grid_factor([13, 13, 1, 2]), Some(13));
        assert_eq!(infer_grid_factor([24, 8, 3]), Some(3));
        assert_eq!(infer_grid_factor([16, 4]), None);
        assert_eq!(infer_grid_factor([13, 7, 5]), None);
        // A rational-slope connector gets the rationals only.
        let (conn, _) = nearest_direction([1.0 / 10f64.sqrt(), -3.0 / 10f64.sqrt()], 32);
        let (_, res) =
            dense_offset_residual((1.0 + 2.0 * SQRT2) / 3.0, &conn, ComponentGrid::default());
        assert!(res > TOL);
    }

    /// A triangle grid's oblique lines sit at `q√3/D` with `q` the row
    /// index, which runs past the landmark bound on a sheet of more than
    /// twelve rows: hex_precreasing.fold, 14 rows, reaches `q = 21`.
    #[test]
    fn a_pure_ring_element_is_dense_whatever_its_coefficient() {
        let (dir, _) = nearest_family_angle(PI / 6.0);
        assert_eq!(dir.ring, Ring::Sqrt3);
        // 17 and 19 are the two rows of that file no rational coincidence
        // within TOL happens to cover (13√3/14 is 193/120 to 4.4e-7, and the
        // rationals are tried first); before the pure element they were the
        // whole reason the design read as off the lattice.
        for q in [17i64, 19] {
            let c = q as f64 * SQRT3 / 14.0;
            let (off, res) = dense_offset_residual(c, &dir, ComponentGrid::default());
            assert!(res < 1e-12, "q = {q}: residual {res}");
            assert_eq!(
                (off.p, off.q, off.denominator, off.ring),
                (0, q, 14, Ring::Sqrt3)
            );
        }
        // A row that reduces is found at its smallest denominator, as before.
        let (off, res) = dense_offset_residual(21.0 * SQRT3 / 14.0, &dir, ComponentGrid::default());
        assert!(res < 1e-12);
        assert_eq!((off.p, off.q, off.denominator), (0, 3, 2));
        // The rational part is still bounded: a deep element with one is not
        // suddenly on the lattice.
        let deep = (1.0 + 40.0 * SQRT3) / 14.0;
        let (_, res) = dense_offset_residual(deep, &dir, ComponentGrid::default());
        assert!(res > TOL, "residual {res}");
    }

    #[test]
    fn dense_rational_tier_prefers_the_smallest_denominator() {
        let (axis, _) = nearest_family_angle(0.0);
        let (off, res) = dense_offset_residual(1.0 / 6.0, &axis, ComponentGrid::default());
        assert!(res < 1e-15);
        assert_eq!((off.p, off.denominator), (1, 6));
        assert_eq!(dense_rational_denominator(1.0 / 6.0), Some(6));
        let (off, res) = dense_offset_residual(5.0 / 24.0, &axis, ComponentGrid::default());
        assert!(res < 1e-15);
        assert_eq!((off.p, off.denominator), (5, 24));
        // 1/π has no rational approximation with denominator ≤ 256 closer
        // than ~5e-5 (its convergents jump from 7/22 to 106/333), and no
        // near coincidence in the bounded ring tiers either.
        let (_, res) =
            dense_offset_residual(std::f64::consts::FRAC_1_PI, &axis, ComponentGrid::default());
        assert!(res > TOL, "an arbitrary offset is off the dense lattice");
        assert_eq!(
            dense_rational_denominator(std::f64::consts::FRAC_1_PI),
            None
        );
        assert_eq!(dense_ring_denominators()[0], 1);
        assert!(dense_ring_denominators().contains(&24));
        assert!(dense_ring_denominators().contains(&14));
        assert!(!dense_ring_denominators().contains(&56));
        assert_eq!(*dense_ring_denominators().last().expect("set"), 64);
    }

    #[test]
    fn a_components_own_grid_reaches_past_the_dense_denominator_cap() {
        let (axis, _) = nearest_family_angle(0.0);
        // Real cpoogle box pleats are drawn on 320-, 416- and 768-grids, none
        // of which any denominator ≤ 256 expresses, so their offsets read as
        // off-lattice however exactly they were drawn.
        for grid in [320u32, 384, 416, 512, 768] {
            // Numerators coprime to the grid, so the offsets do not reduce
            // to a denominator the dense tier already reaches.
            let offsets: Vec<f64> = [1u32, 5, 7, 11, 13]
                .iter()
                .filter(|&&k| gcd(i64::from(k), i64::from(grid)) == 1)
                .map(|&k| f64::from(k) / f64::from(grid))
                .collect();
            assert!(offsets.len() >= 2);
            for &c in &offsets {
                assert_eq!(dense_rational_denominator(c), None, "grid {grid}, c {c}");
                let (_, res) = dense_offset_residual(c, &axis, ComponentGrid::default());
                assert!(res > TOL, "grid {grid}: {res:e} is inside TOL already");
            }
            let inferred = infer_rational_denominator(offsets.iter().copied());
            assert_eq!(inferred, Some(grid), "grid {grid}");
            let component = ComponentGrid {
                rational_denominator: inferred,
                ..Default::default()
            };
            for &c in &offsets {
                let (off, res) = dense_offset_residual(c, &axis, component);
                assert!(res < 1e-12, "grid {grid}, c {c}: residual {res:e}");
                assert!(
                    grid.is_multiple_of(off.denominator),
                    "grid {grid}: denominator {}",
                    off.denominator
                );
            }
        }
        // A 257-grid is not a grid this admits: 257 is prime, so it fails the
        // `odd · 2ᵏ` shape however consistently its own lines agree, and its
        // offsets stay off the lattice.
        let offsets: Vec<f64> = [1u32, 5, 7, 11, 13]
            .iter()
            .map(|&k| f64::from(k) / 257.0)
            .collect();
        assert_eq!(infer_rational_denominator(offsets.iter().copied()), None);
        let (_, res) = dense_offset_residual(offsets[0], &axis, ComponentGrid::default());
        assert!(res > TOL, "1/257 is off the dense lattice: {res:e}");
    }

    #[test]
    fn the_inferred_denominator_is_one_grid_not_a_wider_cap() {
        // One line is not a grid: a single unexplained offset must not buy
        // itself a denominator.
        assert_eq!(infer_rational_denominator([1.0 / 384.0]), None);
        // Arbitrary offsets explain only themselves: no denominator divides
        // more than one of them, so nothing is admitted.
        assert_eq!(
            infer_rational_denominator([
                std::f64::consts::FRAC_1_PI,
                std::f64::consts::LN_2 / 3.0,
                0.318_281_7,
                0.712_349_1,
            ]),
            None
        );
        // Nothing is admitted when the component's own grid is already inside
        // the dense tier.
        assert_eq!(infer_rational_denominator([1.0 / 6.0, 5.0 / 24.0]), None);
        // A real grid survives a minority of hand-placed offsets — the shape
        // of the design this was measured against, where 18 of 346 offsets
        // that missed the tier are genuinely off the 768 grid. Taking the lcm
        // of all of them would have thrown the grid away.
        let mut offsets: Vec<f64> = (1..=12).map(|k| f64::from(k) * 5.0 / 768.0).collect();
        offsets.extend([std::f64::consts::FRAC_1_PI, 0.712_349_1]);
        assert_eq!(infer_rational_denominator(offsets), Some(768));
        // But a grid may not be read off a handful against a crowd.
        let mut offsets: Vec<f64> = vec![5.0 / 768.0, 7.0 / 768.0];
        offsets.extend((1..=20).map(|k| 0.318_281_7 + f64::from(k) * 0.031_477_3));
        assert_eq!(infer_rational_denominator(offsets), None);
        // A denominator that fits but is not shaped like a grid is refused
        // however well its lines agree: 1121 = 19·59 took a real design to
        // `Exact` before this rule.
        let offsets: Vec<f64> = (1..=12).map(|k| f64::from(k) * 5.0 / 1121.0).collect();
        assert_eq!(infer_rational_denominator(offsets), None);
        // The real fine grids all have the shape, and nothing past the
        // ceiling is even searched for.
        assert_eq!(INFERRED_MAX_DENOMINATOR, 6400);
        for grid in [320u32, 384, 416, 512, 768] {
            assert!(is_grid_shaped(grid), "{grid}");
        }
        for other in [1121u32, 883, 985, 1189, 3787, 12800] {
            assert!(!is_grid_shaped(other), "{other}");
        }
        assert_eq!(
            rational_denominator_within(1.0 / 12800.0, INFERRED_MAX_DENOMINATOR),
            None
        );
        // The cap itself is untouched, so an arbitrary offset stays off the
        // lattice for a component with no inferred grid.
        assert_eq!(DENSE_MAX_DENOMINATOR, 256);
        let (axis, _) = nearest_family_angle(0.0);
        let (_, res) = dense_offset_residual(
            std::f64::consts::FRAC_1_PI,
            &axis,
            ComponentGrid {
                rational_denominator: Some(768),
                ..Default::default()
            },
        );
        assert!(res > TOL, "one extra denominator, not a wider tier");
    }

    #[test]
    fn snap_families_keep_their_pitch_above_twice_the_snap_radius() {
        let families = snap_families();
        assert_eq!(families.len(), 13);
        let dyadic = &families[0];
        assert_eq!(dyadic.name, "dyadic");
        // Axis lines (|n| = 1) reach 1/128; 45° lines (|n| = √2) too; a
        // slope-1/3 connector (|n| = √10) only 1/64.
        assert_eq!(
            dyadic.admissible_denominator(Ring::Rational, 1.0),
            Some(128)
        );
        assert_eq!(
            dyadic.admissible_denominator(Ring::Rational, SQRT2),
            Some(128)
        );
        assert_eq!(
            dyadic.admissible_denominator(Ring::Rational, 10f64.sqrt()),
            Some(64)
        );
        let thirds = &families[1];
        assert_eq!(thirds.odd, 3);
        assert_eq!(
            thirds.admissible_denominator(Ring::Rational, 1.0),
            Some(192)
        );
        assert_eq!(
            thirds.admissible_denominator(Ring::Rational, SQRT2),
            Some(96)
        );
        for family in families {
            for ring in [Ring::Rational, Ring::Sqrt2, Ring::Sqrt3] {
                for magnitude in [1.0, 1.5, 2.0, 3.0] {
                    let Some(max_denominator) = family.admissible_denominator(ring, magnitude)
                    else {
                        continue;
                    };
                    let k = (max_denominator / family.odd).trailing_zeros();
                    let q = if ring == Ring::Rational {
                        0
                    } else {
                        SNAP_MAX_Q
                    };
                    let pitch = union_pitch(ring, family.odd, k, q) / magnitude;
                    assert!(
                        pitch >= 2.0 * SNAP_RADIUS,
                        "{} {ring:?} {pitch}",
                        family.name
                    );
                    // One more halving would break the bound.
                    let finer = union_pitch(ring, family.odd, k + 1, q) / magnitude;
                    assert!(
                        finer < 2.0 * SNAP_RADIUS,
                        "{} {ring:?} {magnitude} could be finer",
                        family.name
                    );
                }
            }
        }
        // 22.5° lines (|n| ≈ 1.08) reach (p + q√2)/4 in the dyadic family:
        // (√2 − 1)/2 and (2 − √2)/4 snap.
        let magnitude = (4.0 - 2.0 * SQRT2).sqrt();
        assert_eq!(
            dyadic.admissible_denominator(Ring::Sqrt2, magnitude),
            Some(4)
        );
        let (off, res) = dyadic
            .snap_offset((SQRT2 - 1.0) / 2.0 + 1e-3, Ring::Sqrt2, magnitude)
            .expect("representable");
        assert!(res < 1.1e-3);
        assert_eq!((off.p, off.q, off.denominator), (-1, 1, 2));
        // A 25-grid cannot host ring lines under the pitch bound.
        let last = families.last().expect("families");
        assert_eq!(last.odd, 25);
        assert_eq!(last.admissible_denominator(Ring::Sqrt2, magnitude), None);
        assert!(last.snap_offset(0.3, Ring::Sqrt2, magnitude).is_none());
    }

    #[test]
    fn nearest_offset_finds_ring_elements() {
        let c = (3.0 - SQRT2) / 8.0;
        let (off, res) = nearest_offset(c, Ring::Sqrt2, 8, 5);
        assert!(res < 1e-15);
        assert_eq!((off.p, off.q), (3, -1));
        let (off, res) = nearest_offset(0.25, Ring::Rational, 128, 0);
        assert!(res < 1e-15);
        assert_eq!(off.p, 32);
    }
}
