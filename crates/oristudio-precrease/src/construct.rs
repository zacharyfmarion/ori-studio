//! Forward constructors for the seven Huzita–Justin axioms, and the
//! certificate that ties an inverse witness to a target line.
//!
//! # Provenance (licence tier 2)
//!
//! Every constructor here is derived from the axiom's *definition* — a
//! statement about what one fold line ℓ must align — by solving that
//! statement for ℓ. The validity filters are re-derived from a single
//! principle, **a fold must align in-paper material**: every point the fold
//! moves must land on the sheet, a line folded onto another must have an
//! in-paper segment that lands on the other's in-paper segment, and the fold
//! itself must cross the sheet. Nothing in this module is transcribed from
//! ReferenceFinder's `refLine*.cpp`; ReferenceFinder's answers are used only
//! as a test oracle (the Node cross-check in `tools/precrease-rf-crosscheck`).
//!
//! # The axioms as alignment statements
//!
//! | Axiom | Statement about ℓ | Solution |
//! | --- | --- | --- |
//! | O1 | ℓ passes through `p` and `q` | the line through them |
//! | O2 | ℓ carries `p` onto `q` | the perpendicular bisector of `pq` |
//! | O3 | ℓ carries line `m₁` onto line `m₂` | the angle bisector(s) through `m₁ ∩ m₂`, or the midline of two parallels |
//! | O4 | ℓ passes through `p` and is perpendicular to `m` | unique |
//! | O5 | ℓ passes through `q` and carries `p` onto `m₁` | reflect(p) ∈ m₁ at distance `\|p − q\|` from `q`: a circle–line intersection, ≤ 2 folds |
//! | O6 | ℓ carries `p₁` onto `m₁` and `p₂` onto `m₂` | a common tangent of two parabolas: a cubic, ≤ 3 folds |
//! | O7 | ℓ is perpendicular to `m₂` and carries `p` onto `m₁` | unique |
//!
//! # The O6 cubic
//!
//! Parametrise the landing point of `p₁` on `m₁` as `r₁(s) = F₁ + s·u₁`,
//! where `F₁` is the foot of `p₁` on `m₁` and `u₁` the unit direction of
//! `m₁`. The fold is the perpendicular bisector of `p₁ r₁(s)`: normal
//! `n(s) = a + s·u₁` with `a = F₁ − p₁` (so `a ⟂ u₁`), through
//! `mid(s) = (p₁ + F₁)/2 + (s/2)·u₁`. Reflecting `p₂` across it gives
//! `p₂′ = p₂ − 2·[(p₂ − mid)·n / (n·n)]·n`, and demanding `p₂′ ∈ m₂`
//! (`m₂.n · p₂′ = m₂.d`), multiplied through by `n·n = |a|² + s²`, yields
//!
//! ```text
//! f(s) = h₂·(|a|² + s²) − 2·[(p₂ − mid(s))·n(s)]·[m₂.n · n(s)] = 0,
//!        h₂ = m₂.n·p₂ − m₂.d,
//! ```
//!
//! whose expansion is the cubic `k₁ s³ + (h₂ − 2 g₁ k₁ + k₀) s² −
//! 2 (g₀ k₁ + g₁ k₀) s + (h₂ |a|² − 2 g₀ k₀)` with `b = p₂ − (p₁ + F₁)/2`,
//! `g₀ = b·a`, `g₁ = b·u₁`, `k₀ = m₂.n·a`, `k₁ = m₂.n·u₁`. Real roots are
//! found in closed form and polished by Newton's method on `f`; every root
//! is then re-checked against both alignment constraints before it is
//! accepted (the polish makes the check meaningful at `TOL`).

use crate::line::Line;
use crate::sheet::Sheet;
use crate::tol::TOL;

/// A point in the unit frame.
pub type Pt = [f64; 2];

/// One axiom application with concrete inputs.
#[derive(Debug, Clone, PartialEq)]
pub enum Construction {
    /// Crease through two points.
    O1 { p: Pt, q: Pt },
    /// Fold `p` onto `q`.
    O2 { p: Pt, q: Pt },
    /// Fold line `m1` onto line `m2`.
    O3 { m1: Line, m2: Line },
    /// Crease through `p` perpendicular to `m`.
    O4 { p: Pt, m: Line },
    /// Fold through `pivot` carrying `p` onto `m1`.
    O5 { pivot: Pt, p: Pt, m1: Line },
    /// Fold `p1` onto `m1` and `p2` onto `m2` at once.
    O6 { p1: Pt, m1: Line, p2: Pt, m2: Line },
    /// Fold perpendicular to `m2` carrying `p` onto `m1`.
    O7 { p: Pt, m1: Line, m2: Line },
}

/// One valid fold a construction yields; `root` numbers the solutions of a
/// multi-valued axiom (O3 bisectors, O5 chord ends, O6 cubic roots).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Root {
    pub line: Line,
    pub root: u8,
}

/// A forward construction reproduced the target: `err` is the line
/// residual (`max(|n₁ × n₂|, |d₁ − s·d₂|)`), `line` the constructed line.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Certificate {
    pub root: u8,
    pub err: f64,
    pub line: Line,
}

fn sub(a: Pt, b: Pt) -> Pt {
    [a[0] - b[0], a[1] - b[1]]
}

fn dot(a: Pt, b: Pt) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

fn dist(a: Pt, b: Pt) -> f64 {
    dot(sub(a, b), sub(a, b)).sqrt()
}

/// Residual between two lines under the `(n, d) ~ (−n, −d)` identification.
pub fn line_residual(a: &Line, b: &Line) -> f64 {
    let s = if a.dot(b) >= 0.0 { 1.0 } else { -1.0 };
    a.cross(b).abs().max((a.d - s * b.d).abs())
}

impl Construction {
    /// The axiom number, 1..=7.
    pub fn axiom(&self) -> u8 {
        match self {
            Construction::O1 { .. } => 1,
            Construction::O2 { .. } => 2,
            Construction::O3 { .. } => 3,
            Construction::O4 { .. } => 4,
            Construction::O5 { .. } => 5,
            Construction::O6 { .. } => 6,
            Construction::O7 { .. } => 7,
        }
    }

    /// Every valid fold this construction yields on `sheet`.
    pub fn lines(&self, sheet: &Sheet) -> Vec<Root> {
        let mut out = match self {
            Construction::O1 { p, q } => o1(*p, *q),
            Construction::O2 { p, q } => o2(*p, *q),
            Construction::O3 { m1, m2 } => o3(sheet, m1, m2),
            Construction::O4 { p, m } => o4(sheet, *p, m),
            Construction::O5 { pivot, p, m1 } => o5(sheet, *pivot, *p, m1),
            Construction::O6 { p1, m1, p2, m2 } => o6(sheet, *p1, m1, *p2, m2),
            Construction::O7 { p, m1, m2 } => o7(sheet, *p, m1, m2),
        };
        out.retain(|r| sheet.crosses(&r.line));
        out
    }

    /// The certificate that this construction reproduces `target` within
    /// `TOL` on `sheet`, choosing the closest root when several do.
    pub fn certify(&self, sheet: &Sheet, target: &Line) -> Option<Certificate> {
        self.lines(sheet)
            .into_iter()
            .filter_map(|r| {
                let err = line_residual(&r.line, target);
                (err <= TOL).then_some(Certificate {
                    root: r.root,
                    err,
                    line: r.line,
                })
            })
            .min_by(|a, b| a.err.total_cmp(&b.err))
    }
}

fn o1(p: Pt, q: Pt) -> Vec<Root> {
    Line::from_points(p, q)
        .map(|line| vec![Root { line, root: 0 }])
        .unwrap_or_default()
}

fn o2(p: Pt, q: Pt) -> Vec<Root> {
    Line::perpendicular_bisector(p, q)
        .map(|line| vec![Root { line, root: 0 }])
        .unwrap_or_default()
}

/// Parameter interval of the in-paper segment of `m` mapped by `fold` onto
/// `onto`, intersected with `onto`'s own in-paper interval; positive when
/// the folded material overlaps the reference line's material.
fn folded_overlap(sheet: &Sheet, fold: &Line, m: &Line, onto: &Line) -> f64 {
    let Some((a, b)) = sheet.clip(m) else {
        return 0.0;
    };
    let Some((c0, c1)) = sheet.clip_parameters(onto) else {
        return 0.0;
    };
    let ta = onto.parameter(fold.reflect_point(a));
    let tb = onto.parameter(fold.reflect_point(b));
    let (lo, hi) = if ta < tb { (ta, tb) } else { (tb, ta) };
    hi.min(c1) - lo.max(c0)
}

fn o3(sheet: &Sheet, m1: &Line, m2: &Line) -> Vec<Root> {
    if m1.approx_eq(m2) {
        return Vec::new();
    }
    let mut candidates: Vec<Root> = Vec::new();
    if m1.is_parallel_within(m2, TOL) {
        let s = if m1.dot(m2) >= 0.0 { 1.0 } else { -1.0 };
        if let Some(line) = Line::new(m1.n, (m1.d + s * m2.d) / 2.0) {
            candidates.push(Root { line, root: 0 });
        }
    } else if let Some(x) = m1.intersect(m2) {
        let u1 = m1.direction();
        let u2 = m2.direction();
        for (root, u) in [
            (0u8, [u1[0] + u2[0], u1[1] + u2[1]]),
            (1u8, [u1[0] - u2[0], u1[1] - u2[1]]),
        ] {
            if let Some(line) = Line::from_point_direction(x, u) {
                candidates.push(Root { line, root });
            }
        }
    }
    candidates
        .into_iter()
        .filter(|r| {
            // The fold really maps m1 onto m2 …
            let image = match r.line.reflect_line(m1) {
                Some(l) => l,
                None => return false,
            };
            if !image.approx_eq(m2) {
                return false;
            }
            // … and in-paper material of m1 lands on in-paper material of m2.
            folded_overlap(sheet, &r.line, m1, m2) > TOL
        })
        .collect()
}

fn o4(sheet: &Sheet, p: Pt, m: &Line) -> Vec<Root> {
    let Some(line) = Line::new(m.direction(), dot(m.direction(), p)) else {
        return Vec::new();
    };
    // The crease meets m at the foot of p on m, which must be on the sheet.
    let s = m.signed_distance(p);
    let foot = [p[0] - s * m.n[0], p[1] - s * m.n[1]];
    if !sheet.contains(foot, TOL) {
        return Vec::new();
    }
    vec![Root { line, root: 0 }]
}

fn o5(sheet: &Sheet, pivot: Pt, p: Pt, m1: &Line) -> Vec<Root> {
    // A point already on its landing line has nothing to align.
    if m1.distance_to_point(p) <= TOL {
        return Vec::new();
    }
    let radius2 = dot(sub(p, pivot), sub(p, pivot));
    let s = m1.signed_distance(pivot);
    let foot = [pivot[0] - s * m1.n[0], pivot[1] - s * m1.n[1]];
    let h2 = radius2 - s * s;
    if h2 < -TOL * TOL {
        return Vec::new();
    }
    let h = h2.max(0.0).sqrt();
    let u = m1.direction();
    let mut out = Vec::new();
    for (root, sign) in [(0u8, 1.0f64), (1u8, -1.0)] {
        if root == 1 && h < TOL {
            break; // tangent: one landing point only
        }
        let r = [foot[0] + sign * h * u[0], foot[1] + sign * h * u[1]];
        if !sheet.contains(r, TOL) || dist(r, p) < TOL {
            continue;
        }
        let Some(line) = Line::perpendicular_bisector(p, r) else {
            continue;
        };
        // The pivot lies on the fold by construction; keep the check so a
        // numerically poor chord cannot certify.
        if line.distance_to_point(pivot) > TOL {
            continue;
        }
        out.push(Root { line, root });
    }
    out
}

/// Real roots of `c[0] + c[1] s + c[2] s² + c[3] s³`, ascending, each
/// polished by Newton's method. Degenerate leading coefficients fall back to
/// the lower-degree case.
pub fn real_roots(c: [f64; 4]) -> Vec<f64> {
    let scale = c.iter().fold(0.0f64, |m, v| m.max(v.abs()));
    if scale == 0.0 {
        return Vec::new();
    }
    let tiny = 1e-12 * scale;
    let mut roots: Vec<f64> = if c[3].abs() > tiny {
        cubic_roots(c[2] / c[3], c[1] / c[3], c[0] / c[3])
    } else if c[2].abs() > tiny {
        quadratic_roots(c[2], c[1], c[0])
    } else if c[1].abs() > tiny {
        vec![-c[0] / c[1]]
    } else {
        Vec::new()
    };
    let f = |s: f64| c[0] + s * (c[1] + s * (c[2] + s * c[3]));
    let df = |s: f64| c[1] + s * (2.0 * c[2] + s * 3.0 * c[3]);
    for r in &mut roots {
        for _ in 0..6 {
            let d = df(*r);
            if d.abs() < 1e-300 {
                break;
            }
            let step = f(*r) / d;
            if !step.is_finite() {
                break;
            }
            *r -= step;
            if step.abs() < 1e-17 {
                break;
            }
        }
    }
    roots.retain(|r| r.is_finite());
    roots.sort_by(f64::total_cmp);
    roots
}

fn quadratic_roots(a: f64, b: f64, c: f64) -> Vec<f64> {
    let disc = b * b - 4.0 * a * c;
    if disc < 0.0 {
        return Vec::new();
    }
    let sq = disc.sqrt();
    // Stable form: avoid cancellation in the smaller root.
    let q = if b >= 0.0 {
        -(b + sq) / 2.0
    } else {
        -(b - sq) / 2.0
    };
    if q == 0.0 {
        return vec![0.0];
    }
    let r1 = q / a;
    let r2 = c / q;
    if (r1 - r2).abs() <= 1e-15 * (1.0 + r1.abs()) {
        vec![r1]
    } else {
        vec![r1, r2]
    }
}

/// Real roots of the monic cubic `s³ + a s² + b s + c`.
fn cubic_roots(a: f64, b: f64, c: f64) -> Vec<f64> {
    // Depress: s = t − a/3 gives t³ + p t + q = 0.
    let shift = a / 3.0;
    let p = b - a * a / 3.0;
    let q = 2.0 * a * a * a / 27.0 - a * b / 3.0 + c;
    let half_q = q / 2.0;
    let third_p = p / 3.0;
    let disc = half_q * half_q + third_p * third_p * third_p;
    let mut ts = Vec::new();
    if disc > 1e-18 {
        // One real root (Cardano).
        let sq = disc.sqrt();
        let u = (-half_q + sq).cbrt();
        let v = (-half_q - sq).cbrt();
        ts.push(u + v);
    } else if disc < -1e-18 {
        // Three real roots (trigonometric form); p < 0 here.
        let r = (-third_p).sqrt();
        let arg = (-half_q / (r * r * r)).clamp(-1.0, 1.0);
        let phi = arg.acos() / 3.0;
        for k in 0..3 {
            ts.push(2.0 * r * (phi - 2.0 * std::f64::consts::PI * k as f64 / 3.0).cos());
        }
    } else {
        // Repeated roots.
        let u = (-half_q).cbrt();
        ts.push(2.0 * u);
        ts.push(-u);
    }
    ts.into_iter().map(|t| t - shift).collect()
}

fn o6(sheet: &Sheet, p1: Pt, m1: &Line, p2: Pt, m2: &Line) -> Vec<Root> {
    // Points already on their landing lines have nothing to align, and a
    // fold must move two distinct points onto two distinct lines.
    if m1.distance_to_point(p1) <= TOL
        || m2.distance_to_point(p2) <= TOL
        || dist(p1, p2) <= TOL
        || m1.approx_eq(m2)
    {
        return Vec::new();
    }
    let s1 = m1.signed_distance(p1);
    let foot1 = [p1[0] - s1 * m1.n[0], p1[1] - s1 * m1.n[1]];
    let u1 = m1.direction();
    let a = sub(foot1, p1);
    let a2 = dot(a, a);
    let b = sub(p2, [(p1[0] + foot1[0]) / 2.0, (p1[1] + foot1[1]) / 2.0]);
    let h2 = m2.signed_distance(p2);
    let g0 = dot(b, a);
    let g1 = dot(b, u1);
    let k0 = dot(m2.n, a);
    let k1 = dot(m2.n, u1);
    let coefficients = [
        h2 * a2 - 2.0 * g0 * k0,
        -2.0 * (g0 * k1 + g1 * k0),
        h2 - 2.0 * g1 * k1 + k0,
        k1,
    ];
    let mut out: Vec<Root> = Vec::new();
    for (root, s) in real_roots(coefficients).into_iter().enumerate() {
        let r1 = [foot1[0] + s * u1[0], foot1[1] + s * u1[1]];
        let Some(line) = Line::perpendicular_bisector(p1, r1) else {
            continue;
        };
        // Re-check both alignments at the tolerance, on the sheet.
        let r2 = line.reflect_point(p2);
        if m1.distance_to_point(r1) > TOL
            || m2.distance_to_point(r2) > TOL
            || !sheet.contains(r1, TOL)
            || !sheet.contains(r2, TOL)
        {
            continue;
        }
        if out.iter().any(|o| o.line.approx_eq(&line)) {
            continue;
        }
        out.push(Root {
            line,
            root: root as u8,
        });
    }
    out
}

fn o7(sheet: &Sheet, p: Pt, m1: &Line, m2: &Line) -> Vec<Root> {
    if m1.distance_to_point(p) <= TOL {
        return Vec::new();
    }
    let n = m2.direction();
    let k = dot(m1.n, n);
    if k.abs() <= TOL {
        return Vec::new(); // the fold would be parallel to m1: p cannot reach it
    }
    let d = dot(n, p) - (dot(m1.n, p) - m1.d) / (2.0 * k);
    let Some(line) = Line::new(n, d) else {
        return Vec::new();
    };
    let Some(x) = line.intersect(m2) else {
        return Vec::new();
    };
    let r = line.reflect_point(p);
    if !sheet.contains(x, TOL) || !sheet.contains(r, TOL) || m1.distance_to_point(r) > TOL {
        return Vec::new();
    }
    vec![Root { line, root: 0 }]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(n: [f64; 2], d: f64) -> Line {
        Line::new(n, d).expect("line")
    }

    /// A small deterministic generator (xorshift) for the recovery tests.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> f64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 >> 11) as f64 / (1u64 << 53) as f64
        }
        fn point(&mut self) -> Pt {
            [self.next(), self.next()]
        }
        fn fold(&mut self) -> Line {
            loop {
                let a = self.point();
                let b = self.point();
                if let Some(l) = Line::from_points(a, b)
                    && dist(a, b) > 0.2
                {
                    return l;
                }
            }
        }
    }

    fn recovers(c: &Construction, fold: &Line) -> bool {
        c.certify(&Sheet::unit_square(), fold).is_some()
    }

    #[test]
    fn o1_o2_o4_recover_a_random_fold() {
        let sheet = Sheet::unit_square();
        let mut rng = Rng(0x9e37_79b9);
        for _ in 0..200 {
            let fold = rng.fold();
            let (a, b) = sheet.clip(&fold).expect("crosses");
            let t0 = fold.parameter(a);
            let t1 = fold.parameter(b);
            let p = fold.point_at(t0 + (t1 - t0) * 0.3);
            let q = fold.point_at(t0 + (t1 - t0) * 0.8);
            assert!(recovers(&Construction::O1 { p, q }, &fold));
            let x = rng.point();
            let r = fold.reflect_point(x);
            assert!(recovers(&Construction::O2 { p: x, q: r }, &fold));
            // O4: any line perpendicular to the fold through a point on it
            // whose foot lies on the sheet.
            let m = Line::new(fold.direction(), dot(fold.direction(), p)).expect("line");
            assert!(recovers(&Construction::O4 { p, m }, &fold));
        }
    }

    #[test]
    fn o3_recovers_both_bisectors_and_the_midline() {
        let sheet = Sheet::unit_square();
        let m1 = line([0.0, 1.0], 0.0); // bottom edge
        let m2 = line([1.0, 0.0], 0.0); // left edge
        let roots = Construction::O3 { m1, m2 }.lines(&sheet);
        // Only the diagonal through the corner has in-paper overlap; the
        // external bisector leaves the sheet.
        assert_eq!(roots.len(), 1, "{roots:?}");
        let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("line");
        assert!(roots[0].line.approx_eq(&diag));
        // Two crossing interior lines: both bisectors overlap.
        let a = Line::from_points([0.0, 0.2], [1.0, 0.8]).expect("line");
        let b = Line::from_points([0.0, 0.8], [1.0, 0.2]).expect("line");
        let roots = Construction::O3 { m1: a, m2: b }.lines(&sheet);
        assert_eq!(roots.len(), 2);
        assert!(
            roots
                .iter()
                .any(|r| r.line.approx_eq(&line([1.0, 0.0], 0.5)))
        );
        assert!(
            roots
                .iter()
                .any(|r| r.line.approx_eq(&line([0.0, 1.0], 0.5)))
        );
        // Parallel: the midline.
        let roots = Construction::O3 {
            m1: line([0.0, 1.0], 0.0),
            m2: line([0.0, 1.0], 1.0),
        }
        .lines(&sheet);
        assert_eq!(roots.len(), 1);
        assert!(roots[0].line.approx_eq(&line([0.0, 1.0], 0.5)));
        // Identical lines: nothing to align.
        assert!(Construction::O3 { m1: a, m2: a }.lines(&sheet).is_empty());
    }

    #[test]
    fn o3_external_bisector_without_overlap_is_refused() {
        // verify-claim2 case C: two lines meeting off-paper; the bisector
        // whose in-paper segments lie on the same side reflects m's
        // material off m'.
        let sheet = Sheet::unit_square();
        let x = [-0.1, 0.5];
        let m = Line::from_points(x, [1.0, 0.0]).expect("line");
        let r = Line::from_points(x, [0.2, 1.0]).expect("line");
        let roots = Construction::O3 { m1: m, m2: r }.lines(&sheet);
        for root in &roots {
            assert!(folded_overlap(&sheet, &root.line, &m, &r) > TOL);
        }
        // The internal bisector through x crosses the sheet and aligns
        // material; the external one (nearly vertical through x) is off-sheet
        // or aligns nothing, so at most one root survives.
        assert!(roots.len() <= 1, "{roots:?}");
    }

    #[test]
    fn o4_requires_the_foot_on_the_sheet() {
        // verify-claim2 case A: box-pleat corner diagonals whose fold meets
        // the perpendicular reference outside the paper.
        let sheet = Sheet::unit_square();
        let m = Line::from_points([0.0, 0.9], [0.1, 1.0]).expect("line");
        let p = [0.1, 0.0];
        assert!(Construction::O4 { p, m }.lines(&sheet).is_empty());
        // The same construction with the reference passing nearby is fine.
        let m2 = Line::from_points([0.0, 0.1], [0.5, 0.6]).expect("line");
        assert_eq!(Construction::O4 { p, m: m2 }.lines(&sheet).len(), 1);
    }

    #[test]
    fn o5_recovers_a_random_fold_and_refuses_a_point_on_its_line() {
        let sheet = Sheet::unit_square();
        let mut rng = Rng(0x1234_5678);
        let mut checked = 0;
        for _ in 0..400 {
            let fold = rng.fold();
            let p = rng.point();
            let r = fold.reflect_point(p);
            if !sheet.contains(r, 0.0) {
                continue;
            }
            // Landing line through r in a random direction.
            let dir = [rng.next() - 0.5, rng.next() - 0.5];
            let Some(m1) = Line::from_point_direction(r, dir) else {
                continue;
            };
            if m1.distance_to_point(p) <= 1e-3 {
                continue;
            }
            let (a, b) = sheet.clip(&fold).expect("crosses");
            let pivot = fold.point_at((fold.parameter(a) + fold.parameter(b)) / 2.0);
            assert!(
                recovers(&Construction::O5 { pivot, p, m1 }, &fold),
                "fold {fold:?} p {p:?} m1 {m1:?}"
            );
            checked += 1;
        }
        assert!(checked > 100);
        // Trivial: p on m1.
        let m1 = line([0.0, 1.0], 0.5);
        assert!(
            Construction::O5 {
                pivot: [0.0, 0.0],
                p: [0.3, 0.5],
                m1
            }
            .lines(&sheet)
            .is_empty()
        );
    }

    #[test]
    fn o6_recovers_a_random_fold_from_two_landers() {
        let sheet = Sheet::unit_square();
        let mut rng = Rng(0xdead_beef);
        let mut checked = 0;
        for _ in 0..600 {
            let fold = rng.fold();
            let p1 = rng.point();
            let p2 = rng.point();
            let r1 = fold.reflect_point(p1);
            let r2 = fold.reflect_point(p2);
            if !sheet.contains(r1, 0.0) || !sheet.contains(r2, 0.0) || dist(p1, p2) < 0.05 {
                continue;
            }
            let d1 = [rng.next() - 0.5, rng.next() - 0.5];
            let d2 = [rng.next() - 0.5, rng.next() - 0.5];
            let (Some(m1), Some(m2)) = (
                Line::from_point_direction(r1, d1),
                Line::from_point_direction(r2, d2),
            ) else {
                continue;
            };
            if m1.distance_to_point(p1) < 1e-2
                || m2.distance_to_point(p2) < 1e-2
                || m1.approx_eq_within(&m2, 1e-3)
            {
                continue;
            }
            let c = Construction::O6 { p1, m1, p2, m2 };
            let cert = c.certify(&sheet, &fold);
            assert!(
                cert.is_some(),
                "fold {fold:?} p1 {p1:?} m1 {m1:?} p2 {p2:?} m2 {m2:?} roots {:?}",
                c.lines(&sheet)
            );
            assert!(cert.expect("cert").err < 1e-9);
            checked += 1;
        }
        assert!(checked > 100, "only {checked} cases exercised");
    }

    #[test]
    fn o6_known_solution_and_degenerate_pairs() {
        let sheet = Sheet::unit_square();
        // Fold (0, 0) onto the top edge and (1, 1) onto the bottom edge: the
        // horizontal midline and the anti-diagonal both do it (the
        // anti-diagonal sends (0,0) to (1,1), a corner on the top edge).
        let top = line([0.0, 1.0], 1.0);
        let bottom = line([0.0, 1.0], 0.0);
        let roots = Construction::O6 {
            p1: [0.0, 0.0],
            m1: top,
            p2: [1.0, 1.0],
            m2: bottom,
        }
        .lines(&sheet);
        assert!(
            roots
                .iter()
                .any(|r| r.line.approx_eq(&line([0.0, 1.0], 0.5)))
        );
        assert!(roots.iter().any(|r| {
            r.line
                .approx_eq(&Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("l"))
        }));
        // Same point twice, or the same line twice: refused.
        let right = line([1.0, 0.0], 1.0);
        assert!(
            Construction::O6 {
                p1: [0.0, 0.0],
                m1: top,
                p2: [0.0, 0.0],
                m2: right
            }
            .lines(&sheet)
            .is_empty()
        );
        assert!(
            Construction::O6 {
                p1: [0.0, 0.0],
                m1: top,
                p2: [1.0, 0.0],
                m2: top
            }
            .lines(&sheet)
            .is_empty()
        );
    }

    #[test]
    fn o7_recovers_a_random_fold_and_checks_the_crossing() {
        let sheet = Sheet::unit_square();
        let mut rng = Rng(0x0bad_cafe);
        let mut checked = 0;
        for _ in 0..400 {
            let fold = rng.fold();
            let p = rng.point();
            let r = fold.reflect_point(p);
            if !sheet.contains(r, 0.0) {
                continue;
            }
            let d1 = [rng.next() - 0.5, rng.next() - 0.5];
            let Some(m1) = Line::from_point_direction(r, d1) else {
                continue;
            };
            if m1.distance_to_point(p) < 1e-2 || m1.cross(&fold).abs() < 1e-2 {
                continue;
            }
            // m2 perpendicular to the fold, crossing it on the sheet.
            let (a, b) = sheet.clip(&fold).expect("crosses");
            let x = fold.point_at((fold.parameter(a) + fold.parameter(b)) / 2.0);
            let m2 = Line::new(fold.direction(), dot(fold.direction(), x)).expect("line");
            assert!(recovers(&Construction::O7 { p, m1, m2 }, &fold), "{fold:?}");
            checked += 1;
        }
        assert!(checked > 100);
        // verify-claim2 case B: the fold meets its perpendicular reference
        // off the paper.
        let m = Line::from_points([0.0, 0.9], [0.1, 1.0]).expect("line");
        let k = Line::from_points([0.3, 0.3], [0.3 + 0.7 / 3f64.sqrt(), 1.0]).expect("line");
        let roots = Construction::O7 {
            p: [0.0, 0.0],
            m1: k,
            m2: m,
        }
        .lines(&sheet);
        let bad = Line::from_points([0.0, 0.3], [0.3, 0.0]).expect("line");
        assert!(!roots.iter().any(|r| r.line.approx_eq(&bad)), "{roots:?}");
    }

    #[test]
    fn cubic_solver_finds_all_real_roots() {
        // (s − 1)(s − 2)(s − 3) = s³ − 6s² + 11s − 6
        let roots = real_roots([-6.0, 11.0, -6.0, 1.0]);
        assert_eq!(roots.len(), 3);
        for (r, e) in roots.iter().zip([1.0, 2.0, 3.0]) {
            assert!((r - e).abs() < 1e-12);
        }
        // s³ − 1: one real root.
        let roots = real_roots([-1.0, 0.0, 0.0, 1.0]);
        assert_eq!(roots.len(), 1);
        assert!((roots[0] - 1.0).abs() < 1e-14);
        // Quadratic fallback: s² − 4.
        let roots = real_roots([-4.0, 0.0, 1.0, 0.0]);
        assert_eq!(roots.len(), 2);
        assert!((roots[0] + 2.0).abs() < 1e-14 && (roots[1] - 2.0).abs() < 1e-14);
        // Linear.
        assert_eq!(real_roots([2.0, -1.0, 0.0, 0.0]), vec![2.0]);
        // Double root (s − 1)²(s + 2) = s³ − 3s + 2.
        let roots = real_roots([2.0, -3.0, 0.0, 1.0]);
        assert!(roots.iter().any(|r| (r + 2.0).abs() < 1e-9));
        assert!(roots.iter().any(|r| (r - 1.0).abs() < 1e-6));
    }
}
