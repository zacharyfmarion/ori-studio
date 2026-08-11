//! Exact polygon overlap in a plane's own 2D frame.
//!
//! **Ori Studio native.** See [`crate::folding3d`].
//!
//! Graduated verbatim from `examples/fold3d_census.rs`, which is the census's
//! second independent implementation and the only cross-check this feature has.
//! This one primitive is deliberately **not** duplicated: the harness imports it
//! from here, because a disagreement between the two censuses has to mean the
//! placement or the clustering disagreed, not that one copy of a clipper drifted.
//! The harness's own comment names it "the only place a wrong answer would move
//! every number in the report without looking wrong".
//!
//! # Why a fan decomposition rather than ear clipping
//!
//! [`intersection_area`] decomposes each polygon into **signed** fan triangles
//! about the frame origin. That reproduces a simple polygon as a signed measure
//! whether or not it is convex, so `Σ σᵢσⱼ · area(Tᵢ ∩ Tⱼ)` over triangle pairs
//! is exact with no convexity assumption and no triangulation step. Every
//! `Tᵢ ∩ Tⱼ` is then a convex-convex clip, which [`clip_convex`] does exactly.
//!
//! Non-convex faces are rare and real — measured **52 of 26,030** faces over the
//! external non-flat corpus (0.20%), on 11 of 54 models, 4 of them admitted — so
//! the fan path is the general path and cannot be dropped. It is also `O(|A|·|B|)`
//! clips, against one clip for the convex-convex case, which is why
//! [`intersection_area`] dispatches on [`is_convex`] rather than always fanning.

use crate::geometry::Point;

/// Standard shoelace: positive for a counter-clockwise ring.
///
/// Not [`crate::geometry::Polygon::calculate_area`], which returns the
/// **negated** shoelace — the sign convention that makes every `FoldGraph` face
/// clockwise (see [`crate::folding3d::placement`]). Mixing the two here would
/// flip every fan sign at once, which the hexagram case below would catch and a
/// convex-only test would not.
pub fn signed_area(polygon: &[Point]) -> f64 {
    let mut sum = 0.0;
    for index in 0..polygon.len() {
        let a = polygon[index];
        let b = polygon[(index + 1) % polygon.len()];
        sum += a.x * b.y - b.x * a.y;
    }
    sum / 2.0
}

/// Whether every turn of `polygon` has the same sign.
///
/// Collinear vertices (an exact zero cross product) are ignored rather than
/// treated as a reversal: the arrangement produces them wherever a crease is
/// drawn as two collinear pieces, and calling those faces non-convex would push
/// the common case onto the slow path for nothing.
pub fn is_convex(polygon: &[Point]) -> bool {
    if polygon.len() < 4 {
        return true;
    }
    let mut sign = 0.0_f64;
    for index in 0..polygon.len() {
        let a = polygon[index];
        let b = polygon[(index + 1) % polygon.len()];
        let c = polygon[(index + 2) % polygon.len()];
        let turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if turn == 0.0 {
            continue;
        }
        if sign == 0.0 {
            sign = turn;
        } else if (turn > 0.0) != (sign > 0.0) {
            return false;
        }
    }
    true
}

/// Sutherland-Hodgman clip of `subject` by the counter-clockwise convex `clip`.
///
/// The result is the exact intersection when `subject` is also convex, and is
/// only meaningful in that case — a non-convex subject comes back with its
/// notches filled, which is why [`intersection_area`] never calls this directly
/// on a face ring unless [`is_convex`] said so.
pub fn clip_convex(subject: &[Point], clip: &[Point]) -> Vec<Point> {
    let mut out = subject.to_vec();
    for index in 0..clip.len() {
        if out.is_empty() {
            return out;
        }
        let a = clip[index];
        let b = clip[(index + 1) % clip.len()];
        let (ex, ey) = (b.x - a.x, b.y - a.y);
        let side = |p: Point| ex * (p.y - a.y) - ey * (p.x - a.x);
        let input = std::mem::take(&mut out);
        let mut previous = input[input.len() - 1];
        let mut previous_side = side(previous);
        for current in input {
            let current_side = side(current);
            if current_side >= 0.0 {
                if previous_side < 0.0 {
                    let t = previous_side / (previous_side - current_side);
                    out.push(Point::new(
                        previous.x + t * (current.x - previous.x),
                        previous.y + t * (current.y - previous.y),
                    ));
                }
                out.push(current);
            } else if previous_side >= 0.0 {
                let t = previous_side / (previous_side - current_side);
                out.push(Point::new(
                    previous.x + t * (current.x - previous.x),
                    previous.y + t * (current.y - previous.y),
                ));
            }
            previous = current;
            previous_side = current_side;
        }
    }
    out
}

/// Area of `a ∩ b` for two **simple**, possibly non-convex polygons, exactly.
///
/// Winding-agnostic: the result is the same for a ring and its reverse.
pub fn intersection_area(a: &[Point], b: &[Point]) -> f64 {
    intersection_area_with(a, b, is_convex(a), is_convex(b))
}

/// [`intersection_area`] with the convexity of each ring supplied.
///
/// The census tests every face's ring once per plane rather than once per pair,
/// which on a plane holding `n` faces is `n` tests instead of `n²`.
///
/// The flags are an optimisation, not a licence: passing `true` for a ring that
/// is not convex sends it down the Sutherland-Hodgman path, which fills the
/// notch and silently over-reports the area.
pub fn intersection_area_with(a: &[Point], b: &[Point], a_convex: bool, b_convex: bool) -> f64 {
    if a.len() < 3 || b.len() < 3 {
        return 0.0;
    }
    // The fast path, taken on the overwhelming majority of corpus face pairs.
    // One clip instead of `|A| * |B|` of them, and it agreed with the fan path
    // on every convex-convex pair in the corpus.
    if a_convex && b_convex {
        let (a, b) = (counter_clockwise(a), counter_clockwise(b));
        let piece = clip_convex(&a, &b);
        return if piece.len() >= 3 {
            signed_area(&piece).abs()
        } else {
            0.0
        };
    }

    let (fa, fb) = (signed_fan(a), signed_fan(b));
    let mut total = 0.0;
    for (triangle_a, sign_a) in &fa {
        for (triangle_b, sign_b) in &fb {
            let piece = clip_convex(triangle_a, triangle_b);
            if piece.len() >= 3 {
                total += sign_a * sign_b * signed_area(&piece).abs();
            }
        }
    }
    total.abs()
}

fn counter_clockwise(polygon: &[Point]) -> Vec<Point> {
    if signed_area(polygon) < 0.0 {
        polygon.iter().rev().copied().collect()
    } else {
        polygon.to_vec()
    }
}

/// The polygon as counter-clockwise triangles about the frame origin, each with
/// the sign of the fan wedge it replaces.
fn signed_fan(polygon: &[Point]) -> Vec<(Vec<Point>, f64)> {
    let origin = Point::new(0.0, 0.0);
    let mut out = Vec::with_capacity(polygon.len());
    for index in 0..polygon.len() {
        let p = polygon[index];
        let q = polygon[(index + 1) % polygon.len()];
        let triangle = vec![origin, p, q];
        let area = signed_area(&triangle);
        if area == 0.0 {
            continue;
        }
        let sign = area.signum();
        let triangle = if area < 0.0 {
            vec![origin, q, p]
        } else {
            triangle
        };
        out.push((triangle, sign));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ring(points: &[(f64, f64)]) -> Vec<Point> {
        points.iter().map(|&(x, y)| Point::new(x, y)).collect()
    }

    const UNIT: [(f64, f64); 4] = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];

    /// The unit square with its top-right quarter removed. Area 3/4.
    const ELL: [(f64, f64); 6] = [
        (0.0, 0.0),
        (1.0, 0.0),
        (1.0, 0.5),
        (0.5, 0.5),
        (0.5, 1.0),
        (0.0, 1.0),
    ];

    /// A U of area 7 inside a 3x3 box, whose notch is a hole no clip may fill.
    const U: [(f64, f64); 8] = [
        (0.0, 0.0),
        (3.0, 0.0),
        (3.0, 3.0),
        (2.0, 3.0),
        (2.0, 1.0),
        (1.0, 1.0),
        (1.0, 3.0),
        (0.0, 3.0),
    ];

    fn close(got: f64, want: f64) -> bool {
        (got - want).abs() < 1e-12
    }

    /// Every case the harness's `--selftest` flag checked, as tests.
    ///
    /// Each area is hand-computable, and each row rules out a different way of
    /// being wrong: the L pair rules out ear clipping that assumes convexity,
    /// the reversed row rules out a winding assumption, the U-against-the-bar
    /// row rules out filling a notch, and the hexagram rules out a fan sign
    /// error on a shape whose two rings wind oppositely about the origin.
    #[test]
    fn the_clip_reproduces_areas_worked_out_by_hand() {
        let unit = ring(&UNIT);
        let ell = ring(&ELL);
        let u = ring(&U);

        assert!(close(intersection_area(&unit, &unit), 1.0));
        assert!(close(
            intersection_area(
                &unit,
                &ring(&[(2.0, 0.0), (3.0, 0.0), (3.0, 1.0), (2.0, 1.0)])
            ),
            0.0
        ));
        // Edge-adjacent: a real overlap of measure zero, which is the case the
        // census's area bar exists to reject.
        assert!(close(
            intersection_area(
                &unit,
                &ring(&[(1.0, 0.0), (2.0, 0.0), (2.0, 1.0), (1.0, 1.0)])
            ),
            0.0
        ));
        assert!(close(
            intersection_area(
                &unit,
                &ring(&[(0.5, 0.5), (1.5, 0.5), (1.5, 1.5), (0.5, 1.5)])
            ),
            0.25
        ));

        assert!(close(intersection_area(&ell, &unit), 0.75));
        assert!(close(intersection_area(&ell, &ell), 0.75));
        assert!(close(
            intersection_area(
                &ell,
                &ring(&[(0.5, 0.5), (1.0, 0.5), (1.0, 1.0), (0.5, 1.0)])
            ),
            0.0
        ));

        let mut reversed = ELL;
        reversed.reverse();
        assert!(close(intersection_area(&ring(&reversed), &unit), 0.75));

        assert!(close(
            intersection_area(&u, &ring(&[(0.0, 0.0), (3.0, 0.0), (3.0, 3.0), (0.0, 3.0)])),
            7.0
        ));
        assert!(close(
            intersection_area(&u, &ring(&[(0.0, 2.0), (3.0, 2.0), (3.0, 2.5), (0.0, 2.5)])),
            1.0
        ));

        // Two side-6 equilateral triangles crossing in a hexagram. Each has area
        // 9*sqrt(3); on the side-2 triangular grid that is nine cells, and the
        // inner hexagon is six of them.
        let s3 = 3.0_f64.sqrt();
        let up = ring(&[(-3.0, -s3), (3.0, -s3), (0.0, 2.0 * s3)]);
        let down = ring(&[(-3.0, s3), (0.0, -2.0 * s3), (3.0, s3)]);
        assert!(close(intersection_area(&up, &down), 6.0 * s3));
    }

    /// The convex fast path and the general fan path must agree exactly, or the
    /// dispatch in [`intersection_area`] is a source of disagreement rather than
    /// a speed-up.
    #[test]
    fn the_convex_fast_path_agrees_with_the_fan_decomposition() {
        let fan_only = |a: &[Point], b: &[Point]| {
            let (fa, fb) = (signed_fan(a), signed_fan(b));
            let mut total = 0.0;
            for (ta, sa) in &fa {
                for (tb, sb) in &fb {
                    let piece = clip_convex(ta, tb);
                    if piece.len() >= 3 {
                        total += sa * sb * signed_area(&piece).abs();
                    }
                }
            }
            total.abs()
        };

        let mut pairs = 0usize;
        for i in 0..12 {
            for j in 0..12 {
                let a = ring(&[
                    (i as f64 * 0.17, j as f64 * 0.11),
                    (i as f64 * 0.17 + 1.0, j as f64 * 0.11),
                    (i as f64 * 0.17 + 1.3, j as f64 * 0.11 + 0.9),
                    (i as f64 * 0.17 + 0.2, j as f64 * 0.11 + 1.1),
                ]);
                let b = ring(&[(0.0, 0.0), (1.0, -0.3), (1.4, 0.8), (0.3, 1.2)]);
                assert!(is_convex(&a) && is_convex(&b));
                let (fast, slow) = (intersection_area(&a, &b), fan_only(&a, &b));
                assert!(
                    (fast - slow).abs() <= 1e-12 * (1.0 + slow),
                    "convex fast path {fast} vs fan {slow}"
                );
                if slow > 0.0 {
                    pairs += 1;
                }
            }
        }
        assert!(pairs > 50, "only {pairs} of the sampled pairs overlapped");
    }

    /// The convexity test has to be right in both directions, or the dispatch
    /// silently sends an L down the convex path and fills its notch.
    #[test]
    fn convexity_is_decided_correctly_in_both_directions() {
        assert!(is_convex(&ring(&UNIT)));
        assert!(!is_convex(&ring(&ELL)));
        assert!(!is_convex(&ring(&U)));
        // A collinear vertex, which the arrangement produces wherever a crease
        // is drawn as two pieces, is not a reversal.
        assert!(is_convex(&ring(&[
            (0.0, 0.0),
            (0.5, 0.0),
            (1.0, 0.0),
            (1.0, 1.0),
            (0.0, 1.0)
        ])));
        // And the same shape reversed.
        assert!(is_convex(&ring(&[
            (0.0, 1.0),
            (1.0, 1.0),
            (1.0, 0.0),
            (0.5, 0.0),
            (0.0, 0.0)
        ])));
    }

    /// The dispatch has to matter: an L clipped by *itself* through the convex
    /// path keeps only the corner every half-plane agrees on, because the reflex
    /// edge's half-plane cuts away the rest. 0.25 against a true 0.75.
    ///
    /// This is the assertion that fails if [`is_convex`] is ever weakened to
    /// `true`, which is the cheap way of "simplifying" this file.
    #[test]
    fn the_convex_dispatch_is_not_vacuous() {
        let ell = ring(&ELL);
        assert!(!is_convex(&ell));
        assert!(close(intersection_area(&ell, &ell), 0.75));
        // What the fast path would have returned had it been taken.
        let cut = clip_convex(&ell, &ell);
        assert!(
            close(signed_area(&cut).abs(), 0.25),
            "the convex path on an L gave {}",
            signed_area(&cut).abs()
        );
    }
}
