//! Which creases lie on one line.
//!
//! The solver holds every crease on a *carrier*, a line with its own direction
//! and offset, and creases that share a carrier stay collinear through the
//! solve. Where a detection's carriers come from decides what the solve can
//! reach: a design draws a crease straight through the vertices it crosses,
//! detection noise bends it a degree or so at each of them, and a solve that
//! holds the two halves as separate lines has no reason to straighten them.
//! Measured on a curated hex design with 178 lines: the geometric bins gave
//! 334 carriers, the solve converged to 0.014° Kawasaki and stopped, and only
//! re-exporting the answer and solving again — which re-derived the carriers
//! from the straightened geometry — reached the truth.
//!
//! [`shared_carrier_ids`] is that derivation. Two rules join creases: the same
//! geometric bin, for collinear creases wherever they are; and continuing
//! straight through a shared vertex within a small tolerance, for a line
//! noise bent. The second rule is *not* safe on its own for every pattern —
//! an optimizer-drawn TreeMaker CP really does meet at tiny angles, and
//! joining those made a square-paper CP worse — so the exact solve applies it
//! as a judged round, adopted only when nothing regresses, and the FOLD input
//! builder uses the bins alone.

use std::collections::BTreeMap;
use std::f64::consts::{FRAC_PI_2, PI};

use crate::Point2;
use crate::candidate_graph::CandidateCarrierGeometry;

/// A crease meeting another at a vertex and continuing on the far side is one
/// line if their directions agree within this. Degrees. Below the smallest
/// turn a designed pattern draws at a vertex (7.5° in a 15° family), above
/// what detection noise bends a straight crease by at the median: on the
/// curated hex design, the pairs the design has collinear were bent 1.5° at
/// the median and 5.3° at the ninetieth percentile, and no pair the design
/// keeps distinct sat within 3°.
pub const PASS_THROUGH_TOLERANCE_DEGREES: f64 = 1.5;

/// Endpoint noise a crease is allowed, in pixels, when the pass-through test
/// widens its tolerance for short creases: a crease of length `L` px may sit
/// `atan(PASS_THROUGH_NOISE_PX / L)` off its neighbour's line. The same shape
/// as the pinned round's short-crease allowance.
pub const PASS_THROUGH_NOISE_PX: f64 = 2.0;

/// The line through `a` and `b` as the solver parameterizes it — a unit
/// normal oriented so the offset is non-negative, the unit direction, and
/// the offset — with the two endpoints' positions along the direction.
pub fn carrier_from(a: Point2, b: Point2) -> (CandidateCarrierGeometry, [f64; 2]) {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let len = (dx * dx + dy * dy).sqrt().max(1e-12);
    let dir = Point2::new(dx / len, dy / len);
    let mut normal = Point2::new(dir.y, -dir.x);
    let mut rho = normal.x * a.x + normal.y * a.y;
    if rho < 0.0 {
        normal = Point2::new(-normal.x, -normal.y);
        rho = -rho;
    }
    let ta = a.x * dir.x + a.y * dir.y;
    let tb = b.x * dir.x + b.y * dir.y;
    (
        CandidateCarrierGeometry {
            normal,
            direction: dir,
            rho,
        },
        [ta.min(tb), ta.max(tb)],
    )
}

/// The bin a carrier line falls in — the same 0.01 rad / 0.0025 grid the
/// solver's `CarrierGroupKey::Geometry` uses — so collinear creases share one.
pub fn carrier_bin(carrier: &CandidateCarrierGeometry) -> (i64, i64) {
    let rho_bin = (carrier.rho / 0.0025).round() as i64;
    let mut theta = carrier.normal.y.atan2(carrier.normal.x);
    // A line through the frame's origin has no offset, so the sign rule
    // `carrier_from` orients a normal by (rho >= 0) does not pick a direction
    // for it: the two halves of such a crease, drawn towards and away from the
    // origin, had normals a half-turn apart and were two carriers. Where the
    // offset bin is zero the angle is folded to a half-turn, where they are one.
    if rho_bin == 0 {
        theta = theta.rem_euclid(PI);
    }
    ((theta / 0.01).round() as i64, rho_bin)
}

/// What [`shared_carrier_ids`] needs to know about a span.
#[derive(Debug, Clone)]
pub struct SpanLine {
    pub vertices: [usize; 2],
    /// Unit direction along the span.
    pub direction: Point2,
    pub bin: (i64, i64),
    /// Whether this is a folding crease at all; a border span is never joined.
    pub crease: bool,
}

impl SpanLine {
    /// A span's line read off `points`.
    pub fn from_points(vertices: [usize; 2], points: &[Point2], crease: bool) -> Self {
        let (carrier, _) = carrier_from(points[vertices[0]], points[vertices[1]]);
        Self {
            vertices,
            direction: carrier.direction,
            bin: carrier_bin(&carrier),
            crease,
        }
    }
}

/// Which creases lie on one line, as a small dense id per line in first-seen
/// order; `None` for a span that is not a crease.
///
/// `join_pass_throughs` adds the second rule described in the module docs; the
/// bins alone are the FOLD input builder's behaviour. `image_size_px` is what
/// a pixel of endpoint noise is worth in the coordinates of `points`.
///
/// The ids are dense small integers rather than a hash of the bin, which used
/// to put a negative angle's id just under 2^64: different on wasm's 32-bit
/// `usize` than on the desktop, and beyond what a JavaScript number holds, so
/// the page's JSON trip rounded neighbouring ids together and the solver
/// pinned unrelated creases to one line. The solver reads them for equality
/// only.
pub fn shared_carrier_ids(
    spans: &[SpanLine],
    points: &[Point2],
    join_pass_throughs: bool,
    image_size_px: f64,
) -> Vec<Option<usize>> {
    let mut parent: Vec<usize> = (0..spans.len()).collect();
    fn find(parent: &mut [usize], mut x: usize) -> usize {
        while parent[x] != x {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        x
    }
    let join = |parent: &mut Vec<usize>, a: usize, b: usize| {
        let (ra, rb) = (find(parent, a), find(parent, b));
        if ra != rb {
            parent[ra.max(rb)] = ra.min(rb);
        }
    };
    let mut first_in_bin: BTreeMap<(i64, i64), usize> = BTreeMap::new();
    let mut incident: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (index, span) in spans.iter().enumerate().filter(|(_, span)| span.crease) {
        match first_in_bin.get(&span.bin) {
            Some(&first) => join(&mut parent, first, index),
            None => {
                first_in_bin.insert(span.bin, index);
            }
        }
        for vertex in span.vertices {
            incident.entry(vertex).or_default().push(index);
        }
    }
    if join_pass_throughs {
        for (&vertex, list) in &incident {
            for (k, &a) in list.iter().enumerate() {
                for &b in &list[k + 1..] {
                    if continues_through(&spans[a], &spans[b], vertex, points, image_size_px) {
                        join(&mut parent, a, b);
                    }
                }
            }
        }
    }
    let mut ids: BTreeMap<usize, usize> = BTreeMap::new();
    (0..spans.len())
        .map(|index| {
            spans[index].crease.then(|| {
                let root = find(&mut parent, index);
                let next = ids.len();
                *ids.entry(root).or_insert(next)
            })
        })
        .collect()
}

/// Whether `a` and `b`, which both end at `vertex`, are one line bent there
/// by noise: their far ends lie on opposite sides of the vertex, and their
/// directions agree within the tolerance, widened for a short crease by what
/// [`PASS_THROUGH_NOISE_PX`] of endpoint noise is worth on its length.
fn continues_through(
    a: &SpanLine,
    b: &SpanLine,
    vertex: usize,
    points: &[Point2],
    image_size_px: f64,
) -> bool {
    let far = |span: &SpanLine| {
        let [p, q] = span.vertices;
        points[if p == vertex { q } else { p }]
    };
    let (fa, fb, at) = (far(a), far(b), points[vertex]);
    if (fa.x - at.x) * (fb.x - at.x) + (fa.y - at.y) * (fb.y - at.y) >= 0.0 {
        return false;
    }
    let angle = |span: &SpanLine| span.direction.y.atan2(span.direction.x);
    let mut delta = (angle(a) - angle(b)).rem_euclid(PI);
    if delta > FRAC_PI_2 {
        delta = PI - delta;
    }
    let length = |span: &SpanLine| {
        let [p, q] = span.vertices;
        let (dx, dy) = (points[p].x - points[q].x, points[p].y - points[q].y);
        (dx * dx + dy * dy).sqrt() * image_size_px
    };
    let shorter = length(a).min(length(b)).max(1e-9);
    let tolerance = PASS_THROUGH_TOLERANCE_DEGREES
        .to_radians()
        .max((PASS_THROUGH_NOISE_PX / shorter).atan());
    delta <= tolerance
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A horizontal crease through the centre, its right half bent up by
    /// `bend_degrees` at the crossing with a vertical one.
    fn crossing(bend_degrees: f64) -> (Vec<SpanLine>, Vec<Point2>) {
        let points = vec![
            Point2::new(0.5, 0.5),
            Point2::new(0.0, 0.5),
            Point2::new(1.0, 0.5 + 0.5 * bend_degrees.to_radians().tan()),
            Point2::new(0.5, 0.0),
            Point2::new(0.5, 1.0),
        ];
        let spans = [[1, 0], [0, 2], [3, 0], [0, 4]]
            .into_iter()
            .map(|vertices| SpanLine::from_points(vertices, &points, true))
            .collect();
        (spans, points)
    }

    #[test]
    fn a_pass_through_bent_by_noise_is_one_line_and_a_designed_turn_is_two() {
        let (spans, points) = crossing(1.2);
        let ids = shared_carrier_ids(&spans, &points, true, 1024.0);
        assert_eq!(ids[0], ids[1], "bent 1.2°: one line");
        assert_eq!(ids[2], ids[3], "straight: one line");
        assert_ne!(ids[0], ids[2]);
        let bins_only = shared_carrier_ids(&spans, &points, false, 1024.0);
        assert_ne!(
            bins_only[0], bins_only[1],
            "the bins alone keep the bent halves apart"
        );
        let (spans, points) = crossing(10.0);
        let ids = shared_carrier_ids(&spans, &points, true, 1024.0);
        assert_ne!(ids[0], ids[1], "turned 10°: two lines");
    }

    #[test]
    fn a_short_crease_gets_a_wider_tolerance() {
        // A 20 px crease bent 4° off a long one: 2 px of endpoint noise on
        // 20 px is 5.7°, so it is still the same line.
        let points = vec![
            Point2::new(0.5, 0.5),
            Point2::new(0.0, 0.5),
            Point2::new(
                0.5 + (20.0 / 1024.0) * 4.0_f64.to_radians().cos(),
                0.5 + (20.0 / 1024.0) * 4.0_f64.to_radians().sin(),
            ),
        ];
        let spans: Vec<SpanLine> = [[1, 0], [0, 2]]
            .into_iter()
            .map(|vertices| SpanLine::from_points(vertices, &points, true))
            .collect();
        let ids = shared_carrier_ids(&spans, &points, true, 1024.0);
        assert_eq!(ids[0], ids[1]);
        // The same bend on a 200 px crease is a turn.
        let far = Point2::new(
            0.5 + (200.0 / 1024.0) * 4.0_f64.to_radians().cos(),
            0.5 + (200.0 / 1024.0) * 4.0_f64.to_radians().sin(),
        );
        let points = vec![points[0], points[1], far];
        let spans: Vec<SpanLine> = [[1, 0], [0, 2]]
            .into_iter()
            .map(|vertices| SpanLine::from_points(vertices, &points, true))
            .collect();
        let ids = shared_carrier_ids(&spans, &points, true, 1024.0);
        assert_ne!(ids[0], ids[1]);
    }

    #[test]
    fn a_crease_that_folds_back_is_never_joined() {
        // Two creases from one vertex on the same side, 0.5° apart: a fan, not
        // a line, however close their directions.
        let points = vec![
            Point2::new(0.5, 0.5),
            Point2::new(1.0, 0.5),
            Point2::new(1.0, 0.5 + 0.5 * 0.5_f64.to_radians().tan()),
        ];
        let spans: Vec<SpanLine> = [[0, 1], [0, 2]]
            .into_iter()
            .map(|vertices| SpanLine::from_points(vertices, &points, true))
            .collect();
        let ids = shared_carrier_ids(&spans, &points, true, 1024.0);
        assert_ne!(ids[0], ids[1]);
    }
}
