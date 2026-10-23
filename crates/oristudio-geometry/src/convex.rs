//! Convex-polygon primitives: orientation, clipping, half-plane splits and
//! overlap, against the one tolerance in [`crate::tol`].
//!
//! The single owner of these primitives for the new crates (plan D9). Points
//! are `[x, y]`; a polygon is its vertex ring with no repeated closing point.
//! Every function that needs convexity expects a counter-clockwise ring
//! ([`normalize`] makes one) and says what it does with a degenerate one.
//!
//! # Short edges
//!
//! An edge shorter than [`MIN_EDGE`] has a direction set by rounding rather
//! than by the geometry. The measured failure (`r2-spike-core.md`, bug 1): a
//! split emitted a point 4.5e-17 from a vertex, the separating-axis test used
//! that edge's normal, and reported a penetration of 0 instead of 2.09e-4.
//! So every test that needs an edge's direction skips such edges, the splits
//! never emit a point that close to a vertex, and [`normalize`] merges them.

use crate::tol::TOL;

type Point = [f64; 2];

/// Edges shorter than this are left out of every test that needs an edge's
/// direction, and points closer than this are merged.
///
/// One hundredth of [`TOL`]: rounding (about 1e-16 of the sheet) tilts an
/// edge this long by about 1e-8 rad, which moves a projection across the unit
/// sheet by 1% of `TOL`; leaving such an edge out moves a penetration or a
/// width by at most about its length, also 1% of `TOL`.
pub const MIN_EDGE: f64 = TOL * 1e-2;

/// Signed area of a ring: positive when counter-clockwise.
pub fn signed_area(poly: &[Point]) -> f64 {
    let n = poly.len();
    let mut twice = 0.0;
    for i in 0..n {
        let [x0, y0] = poly[i];
        let [x1, y1] = poly[(i + 1) % n];
        twice += x0 * y1 - x1 * y0;
    }
    twice / 2.0
}

/// The ring counter-clockwise, with consecutive points closer than
/// [`MIN_EDGE`] merged (the wrap-around included).
///
/// Collinear vertices are kept: a face whose edge was split by a crease on
/// the other side legitimately has one. A ring that collapses to fewer than
/// three points comes back as it collapsed; [`is_convex`] refuses it.
pub fn normalize(poly: &[Point]) -> Vec<Point> {
    let mut out = dedup(poly);
    if signed_area(&out) < 0.0 {
        out.reverse();
    }
    out
}

/// Whether a ring is a counter-clockwise convex polygon with positive area,
/// allowing a vertex to dent inward by at most `tol` (collinear vertices and
/// rounding).
///
/// The dent is measured as the vertex's distance inside the chord joining its
/// neighbours. The total turning must be one full turn, which rules out a
/// star that turns left at every vertex.
pub fn is_convex(poly: &[Point], tol: f64) -> bool {
    let n = poly.len();
    if n < 3 || poly.iter().flatten().any(|c| !c.is_finite()) || signed_area(poly) <= 0.0 {
        return false;
    }
    for i in 0..n {
        let a = poly[(i + n - 1) % n];
        let b = poly[i];
        let c = poly[(i + 1) % n];
        let chord = sub(c, a);
        let len = norm(chord);
        if len >= MIN_EDGE && cross(chord, sub(b, a)) / len > tol {
            return false;
        }
    }
    let directions: Vec<Point> = edges(poly)
        .map(|(a, b)| sub(b, a))
        .filter(|&d| norm(d) >= MIN_EDGE)
        .collect();
    let m = directions.len();
    let turning: f64 = (0..m)
        .map(|k| {
            let (u, v) = (directions[k], directions[(k + 1) % m]);
            cross(u, v).atan2(dot(u, v))
        })
        .sum();
    (turning - std::f64::consts::TAU).abs() < std::f64::consts::PI
}

/// `[min_x, min_y, max_x, max_y]` of a point set; inverted (infinite) for an
/// empty one, so it overlaps nothing.
pub fn bounding_box(points: &[Point]) -> [f64; 4] {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for &[x, y] in points {
        b[0] = b[0].min(x);
        b[1] = b[1].min(y);
        b[2] = b[2].max(x);
        b[3] = b[3].max(y);
    }
    b
}

/// Whether two boxes overlap after growing each side by `margin`.
pub fn boxes_overlap(a: &[f64; 4], b: &[f64; 4], margin: f64) -> bool {
    a[0] <= b[2] + margin && b[0] <= a[2] + margin && a[1] <= b[3] + margin && b[1] <= a[3] + margin
}

/// The area centroid, an interior point of a convex polygon; `None` when the
/// area is not positive.
pub fn centroid(poly: &[Point]) -> Option<Point> {
    let n = poly.len();
    let area = signed_area(poly);
    if n < 3 || area <= 0.0 {
        return None;
    }
    // Relative to the first vertex, so far-from-origin rings keep precision.
    let o = poly[0];
    let (mut cx, mut cy) = (0.0, 0.0);
    for i in 0..n {
        let p = sub(poly[i], o);
        let q = sub(poly[(i + 1) % n], o);
        let w = cross(p, q);
        cx += (p[0] + q[0]) * w;
        cy += (p[1] + q[1]) * w;
    }
    Some([o[0] + cx / (6.0 * area), o[1] + cy / (6.0 * area)])
}

/// The closed half-plane `normal · p ≥ offset`, with a unit normal.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HalfPlane {
    normal: Point,
    offset: f64,
}

impl HalfPlane {
    /// The half-plane `normal · p ≥ offset`; the normal is normalised. `None`
    /// for a non-finite or zero normal.
    pub fn new(normal: Point, offset: f64) -> Option<HalfPlane> {
        let len = norm(normal);
        if !len.is_finite() || len == 0.0 || !offset.is_finite() {
            return None;
        }
        Some(HalfPlane {
            normal: [normal[0] / len, normal[1] / len],
            offset: offset / len,
        })
    }

    /// The half-plane left of the directed line `a → b`, which for a
    /// counter-clockwise polygon's edge is the polygon's side. `None` when
    /// `a` and `b` are closer than [`MIN_EDGE`].
    pub fn left_of(a: Point, b: Point) -> Option<HalfPlane> {
        let d = sub(b, a);
        // A NaN length passes here and is refused by `new`.
        if norm(d) < MIN_EDGE {
            return None;
        }
        let normal = [-d[1], d[0]];
        HalfPlane::new(normal, dot(normal, a))
    }

    /// The unit normal, pointing into the half-plane.
    pub fn normal(&self) -> Point {
        self.normal
    }

    /// The boundary line's offset along the normal.
    pub fn offset(&self) -> f64 {
        self.offset
    }

    /// Distance of `p` inside the half-plane; negative outside.
    pub fn signed_distance(&self, p: Point) -> f64 {
        dot(self.normal, p) - self.offset
    }

    /// The other side of the same line.
    pub fn complement(&self) -> HalfPlane {
        HalfPlane {
            normal: [-self.normal[0], -self.normal[1]],
            offset: -self.offset,
        }
    }
}

/// The two sides of a convex polygon cut by a half-plane's boundary. Each is a
/// counter-clockwise convex ring, or empty when that side has no area.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Split {
    pub inside: Vec<Point>,
    pub outside: Vec<Point>,
}

/// Split a counter-clockwise convex polygon by a half-plane, treating every
/// vertex within `eps` of the boundary as on it.
///
/// A vertex on the boundary goes to both sides and no crossing point is made
/// next to it, so neither side gets a point within `eps` of a vertex that
/// would make a direction-less edge (see the module docs). A side with no
/// vertex strictly beyond `eps` is empty; when nothing lies outside, `inside`
/// is the polygon unchanged (and the same for the other side).
pub fn split(poly: &[Point], plane: &HalfPlane, eps: f64) -> Split {
    let n = poly.len();
    if n < 3 {
        return Split::default();
    }
    // Recomputed where needed rather than kept: cheaper than allocating.
    let side = |i: usize| -> i8 {
        let d = plane.signed_distance(poly[i]);
        if d > eps {
            1
        } else if d < -eps {
            -1
        } else {
            0
        }
    };
    let has_in = (0..n).any(|i| side(i) == 1);
    let has_out = (0..n).any(|i| side(i) == -1);
    if !has_out {
        let inside = if has_in { poly.to_vec() } else { Vec::new() };
        return Split {
            inside,
            outside: Vec::new(),
        };
    }
    if !has_in {
        return Split {
            inside: Vec::new(),
            outside: poly.to_vec(),
        };
    }
    let mut inside = Vec::with_capacity(n + 1);
    let mut outside = Vec::with_capacity(n + 1);
    let first = side(0);
    let mut side_i = first;
    for i in 0..n {
        let j = (i + 1) % n;
        let side_j = if j == 0 { first } else { side(j) };
        let (a, b) = (poly[i], poly[j]);
        match side_i {
            1 => inside.push(a),
            -1 => outside.push(a),
            _ => {
                inside.push(a);
                outside.push(a);
            }
        }
        if side_i * side_j == -1 {
            let da = plane.signed_distance(a);
            let db = plane.signed_distance(b);
            let t = da / (da - db);
            let x = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
            inside.push(x);
            outside.push(x);
        }
        side_i = side_j;
    }
    Split {
        inside: proper(inside),
        outside: proper(outside),
    }
}

/// The intersection of two counter-clockwise convex polygons, empty when it
/// has no area. Touching within [`MIN_EDGE`] is empty.
pub fn clip(subject: &[Point], window: &[Point]) -> Vec<Point> {
    let mut out = subject.to_vec();
    for (a, b) in edges(window) {
        let Some(plane) = HalfPlane::left_of(a, b) else {
            continue;
        };
        out = split(&out, &plane, MIN_EDGE).inside;
        if out.is_empty() {
            break;
        }
    }
    out
}

/// A convex polygon cut by another: the part inside it and the convex pieces
/// outside it.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Carve {
    pub inside: Vec<Point>,
    pub outside: Vec<Vec<Point>>,
}

/// Cut `subject` by `window` (both counter-clockwise convex) along the
/// window's edge lines in turn: one outside piece per edge that cuts, and what
/// is left inside.
///
/// Nothing at most `sliver` wide is cut off: a piece beyond an edge that thin
/// stays with the inside, so `inside` may reach that far past the window, and
/// every piece returned is wider than `sliver`. `None` when the inside part
/// would be that thin, that is when the two meet in a sliver at most.
pub fn carve(subject: &[Point], window: &[Point], sliver: f64) -> Option<Carve> {
    let mut inside = subject.to_vec();
    let mut outside = Vec::new();
    for (a, b) in edges(window) {
        let Some(plane) = HalfPlane::left_of(a, b) else {
            continue;
        };
        let cut = split(&inside, &plane, MIN_EDGE);
        if cut.outside.is_empty() || width(&cut.outside) <= sliver {
            continue;
        }
        if cut.inside.is_empty() || width(&cut.inside) <= sliver {
            return None;
        }
        outside.push(cut.outside);
        inside = cut.inside;
    }
    if width(&inside) <= sliver {
        return None;
    }
    Some(Carve { inside, outside })
}

/// How deeply two counter-clockwise convex polygons overlap, by the
/// separating-axis test over both polygons' edge normals: for each edge, how
/// far the other polygon reaches past it, and the least of those.
///
/// More than [`TOL`] is an overlap with positive area; at most `TOL` is
/// touching or apart (negative: the gap along the best separating axis).
/// Edges shorter than [`MIN_EDGE`] are skipped (see the module docs). A
/// polygon with no usable edge gives 0, no overlap.
pub fn penetration(p: &[Point], q: &[Point]) -> f64 {
    let mut depth = f64::INFINITY;
    for (own, other) in [(p, q), (q, p)] {
        for (a, b) in edges(own) {
            let Some(plane) = HalfPlane::left_of(a, b) else {
                continue;
            };
            let reach = other
                .iter()
                .map(|&x| plane.signed_distance(x))
                .fold(f64::NEG_INFINITY, f64::max);
            depth = depth.min(reach);
        }
    }
    if depth.is_finite() { depth } else { 0.0 }
}

/// The half-planes left of a counter-clockwise ring's edges, in ring order,
/// skipping edges shorter than [`MIN_EDGE`]: the planes every test here
/// takes from the ring. Each costs a `hypot`, which is most of a
/// [`penetration`], so a polygon met in many tests keeps them
/// ([`penetration_with_planes`]).
pub fn edge_planes(poly: &[Point]) -> Vec<HalfPlane> {
    edges(poly)
        .filter_map(|(a, b)| HalfPlane::left_of(a, b))
        .collect()
}

/// How far `points` reach into each plane (the greatest signed distance),
/// and the least of those; infinite with no plane.
pub fn reach(planes: &[HalfPlane], points: &[Point]) -> f64 {
    let mut depth = f64::INFINITY;
    for plane in planes {
        let reach = points
            .iter()
            .map(|&x| plane.signed_distance(x))
            .fold(f64::NEG_INFINITY, f64::max);
        depth = depth.min(reach);
    }
    depth
}

/// [`penetration`] of `p` and `q` given their [`edge_planes`]: the same
/// answer, bit for bit.
pub fn penetration_with_planes(
    p: &[Point],
    p_planes: &[HalfPlane],
    q: &[Point],
    q_planes: &[HalfPlane],
) -> f64 {
    let depth = reach(p_planes, q).min(reach(q_planes, p));
    if depth.is_finite() { depth } else { 0.0 }
}

/// Whether [`penetration_with_planes`] of finite polygons is more than `tol`
/// (≥ 0): the same answer, without the depth. The penetration is the least
/// reach over every
/// plane, so the first plane the other polygon reaches no further than `tol`
/// into settles it, and a plane is reached far enough at the first point
/// beyond `tol`.
pub fn overlaps_with_planes(
    p: &[Point],
    p_planes: &[HalfPlane],
    q: &[Point],
    q_planes: &[HalfPlane],
    tol: f64,
) -> bool {
    let reaches = |planes: &[HalfPlane], points: &[Point]| {
        planes
            .iter()
            .all(|plane| points.iter().any(|&x| plane.signed_distance(x) > tol))
    };
    // No plane at all is a penetration of 0, which is no overlap.
    (!p_planes.is_empty() || !q_planes.is_empty()) && reaches(p_planes, q) && reaches(q_planes, p)
}

/// Whether two convex polygons overlap with positive area at [`TOL`].
pub fn overlaps(p: &[Point], q: &[Point]) -> bool {
    penetration(p, q) > TOL
}

/// The least width of a counter-clockwise convex polygon: over its edges, the
/// distance of the farthest vertex from the edge's line. It is
/// `penetration(poly, poly)`, so a polygon no wider than [`TOL`] overlaps
/// nothing, with each edge's plane made once rather than twice. Zero for a
/// polygon with no usable edge.
pub fn width(poly: &[Point]) -> f64 {
    let mut depth = f64::INFINITY;
    for (a, b) in edges(poly) {
        let Some(plane) = HalfPlane::left_of(a, b) else {
            continue;
        };
        let reach = poly
            .iter()
            .map(|&x| plane.signed_distance(x))
            .fold(f64::NEG_INFINITY, f64::max);
        depth = depth.min(reach);
    }
    if depth.is_finite() { depth } else { 0.0 }
}

/// Whether `p` lies inside a counter-clockwise convex polygon by more than
/// `margin` from every edge's line. A negative margin admits points up to
/// `-margin` outside. False for a polygon with no usable edge.
pub fn contains_point(poly: &[Point], p: Point, margin: f64) -> bool {
    let mut any = false;
    for (a, b) in edges(poly) {
        let Some(plane) = HalfPlane::left_of(a, b) else {
            continue;
        };
        any = true;
        if plane.signed_distance(p) <= margin {
            return false;
        }
    }
    any
}

/// The length of the part of segment `a b` that lies inside a
/// counter-clockwise convex polygon by more than `margin` from every edge's
/// line. A segment running along an edge, or touching the polygon at a point,
/// gives 0 for any positive margin.
pub fn segment_length_inside(a: Point, b: Point, poly: &[Point], margin: f64) -> f64 {
    let (mut t0, mut t1) = (0.0_f64, 1.0_f64);
    let mut any = false;
    for (p, q) in edges(poly) {
        let Some(plane) = HalfPlane::left_of(p, q) else {
            continue;
        };
        any = true;
        let da = plane.signed_distance(a) - margin;
        let db = plane.signed_distance(b) - margin;
        if da <= 0.0 && db <= 0.0 {
            return 0.0;
        }
        if da < 0.0 {
            t0 = t0.max(da / (da - db));
        } else if db < 0.0 {
            t1 = t1.min(da / (da - db));
        }
        if t1 <= t0 {
            return 0.0;
        }
    }
    if any {
        (t1 - t0) * norm(sub(b, a))
    } else {
        0.0
    }
}

/// The ring's edges as `(start, end)` pairs.
fn edges(poly: &[Point]) -> impl Iterator<Item = (Point, Point)> + '_ {
    let n = poly.len();
    (0..n).map(move |i| (poly[i], poly[(i + 1) % n]))
}

/// A split side as a polygon: merged near-duplicates, and empty unless at
/// least three points and positive area remain.
fn proper(mut ring: Vec<Point>) -> Vec<Point> {
    dedup_in_place(&mut ring);
    if ring.len() < 3 || signed_area(&ring) <= 0.0 {
        return Vec::new();
    }
    ring
}

/// Merge consecutive points closer than [`MIN_EDGE`], the wrap-around
/// included.
fn dedup(poly: &[Point]) -> Vec<Point> {
    let mut out = poly.to_vec();
    dedup_in_place(&mut out);
    out
}

/// [`dedup`] without a second vector: each point is compared with the last
/// one kept.
fn dedup_in_place(ring: &mut Vec<Point>) {
    let mut kept = 0;
    for i in 0..ring.len() {
        let p = ring[i];
        if kept == 0 || norm(sub(p, ring[kept - 1])) >= MIN_EDGE {
            ring[kept] = p;
            kept += 1;
        }
    }
    ring.truncate(kept);
    while ring.len() > 1 && norm(sub(ring[0], ring[ring.len() - 1])) < MIN_EDGE {
        ring.pop();
    }
}

fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1]]
}

fn dot(a: Point, b: Point) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

fn cross(a: Point, b: Point) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

fn norm(a: Point) -> f64 {
    a[0].hypot(a[1])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Point> {
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-12
    }

    fn area_close(poly: &[Point], area: f64) -> bool {
        (signed_area(poly) - area).abs() < 1e-12
    }

    /// Deterministic generator (SplitMix64), so the randomized checks need no
    /// dependency and replay exactly.
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> f64 {
            self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
        }

        /// A random convex polygon: points on a circle (centre in the unit
        /// square, radius 0.2 to 1.2) at sorted angles.
        fn convex(&mut self) -> Vec<Point> {
            let (cx, cy, r) = (self.next(), self.next(), 0.2 + self.next());
            let n = 3 + (self.next() * 6.0) as usize;
            let mut angles: Vec<f64> = (0..n)
                .map(|_| self.next() * std::f64::consts::TAU)
                .collect();
            angles.sort_by(f64::total_cmp);
            let ring: Vec<Point> = angles
                .iter()
                .map(|t| [cx + r * t.cos(), cy + r * t.sin()])
                .collect();
            normalize(&ring)
        }
    }

    #[test]
    fn signed_area_is_positive_for_counter_clockwise_rings() {
        let square = rect(0.0, 0.0, 2.0, 1.0);
        assert!(close(signed_area(&square), 2.0));
        let mut cw = square.clone();
        cw.reverse();
        assert!(close(signed_area(&cw), -2.0));
        assert_eq!(signed_area(&[]), 0.0);
        assert_eq!(signed_area(&[[0.0, 0.0], [1.0, 1.0]]), 0.0);
    }

    #[test]
    fn normalize_reverses_clockwise_rings_and_merges_near_duplicates() {
        let mut cw = rect(0.0, 0.0, 1.0, 1.0);
        cw.reverse();
        assert!(signed_area(&normalize(&cw)) > 0.0);

        // The spike's near-duplicate: a point 4.5e-17 from a vertex, also at
        // the wrap-around.
        let noisy = vec![
            [0.0, 0.0],
            [1.0, 0.0],
            [1.0, 4.5e-17],
            [1.0, 1.0],
            [0.0, 1.0],
            [4.5e-17, 0.0],
        ];
        assert_eq!(normalize(&noisy), rect(0.0, 0.0, 1.0, 1.0));

        // Collinear vertices stay.
        let collinear = vec![[0.0, 0.0], [0.5, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        assert_eq!(normalize(&collinear).len(), 5);
    }

    #[test]
    fn is_convex_accepts_collinear_vertices_and_refuses_dents_and_stars() {
        assert!(is_convex(&rect(0.0, 0.0, 1.0, 1.0), TOL));
        let collinear = vec![[0.0, 0.0], [0.5, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        assert!(is_convex(&collinear, TOL));
        // A rounding-sized dent passes; a real one does not.
        let tiny_dent = vec![[0.0, 0.0], [0.5, 1e-9], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        assert!(is_convex(&tiny_dent, TOL));
        let dent = vec![[0.0, 0.0], [0.5, 0.1], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        assert!(!is_convex(&dent, TOL));
        // Clockwise, degenerate and non-finite rings are not convex polygons.
        let mut cw = rect(0.0, 0.0, 1.0, 1.0);
        cw.reverse();
        assert!(!is_convex(&cw, TOL));
        assert!(!is_convex(&[[0.0, 0.0], [1.0, 0.0], [2.0, 0.0]], TOL));
        assert!(!is_convex(&[[0.0, 0.0], [1.0, 0.0]], TOL));
        assert!(!is_convex(&[[0.0, 0.0], [f64::NAN, 0.0], [0.0, 1.0]], TOL));
        // A pentagram turns left at every vertex but turns twice in all.
        let star: Vec<Point> = (0..5)
            .map(|k| {
                let t = std::f64::consts::FRAC_PI_2 + k as f64 * 4.0 * std::f64::consts::PI / 5.0;
                [t.cos(), t.sin()]
            })
            .collect();
        assert!(signed_area(&star) > 0.0);
        assert!(!is_convex(&star, TOL));
    }

    #[test]
    fn centroid_is_the_area_centroid() {
        let c = centroid(&rect(1.0, 2.0, 3.0, 6.0)).unwrap_or([0.0, 0.0]);
        assert!(close(c[0], 2.0) && close(c[1], 4.0));
        let tri = vec![[0.0, 0.0], [3.0, 0.0], [0.0, 3.0]];
        let c = centroid(&tri).unwrap_or([0.0, 0.0]);
        assert!(close(c[0], 1.0) && close(c[1], 1.0));
        assert_eq!(centroid(&[[0.0, 0.0], [1.0, 0.0], [2.0, 0.0]]), None);
    }

    #[test]
    fn half_plane_left_of_a_directed_line() {
        let h = HalfPlane::left_of([0.0, 0.0], [2.0, 0.0]).unwrap_or_else(|| unreachable!());
        assert!(close(h.signed_distance([5.0, 3.0]), 3.0));
        assert!(close(h.signed_distance([5.0, -1.0]), -1.0));
        assert!(close(h.complement().signed_distance([5.0, -1.0]), 1.0));
        assert_eq!(h.normal(), [0.0, 1.0]);
        assert!(HalfPlane::left_of([0.0, 0.0], [1e-12, 0.0]).is_none());
        assert!(HalfPlane::new([0.0, 0.0], 1.0).is_none());
        assert!(HalfPlane::new([f64::NAN, 1.0], 1.0).is_none());
        let scaled = HalfPlane::new([0.0, 2.0], 4.0).unwrap_or_else(|| unreachable!());
        assert!(close(scaled.offset(), 2.0));
    }

    #[test]
    fn split_cuts_a_square_in_two() {
        let square = rect(0.0, 0.0, 1.0, 1.0);
        let x_ge_04 = HalfPlane::new([1.0, 0.0], 0.4).unwrap_or_else(|| unreachable!());
        let s = split(&square, &x_ge_04, MIN_EDGE);
        assert!(area_close(&s.inside, 0.6));
        assert!(area_close(&s.outside, 0.4));
        assert!(is_convex(&s.inside, TOL) && is_convex(&s.outside, TOL));
    }

    #[test]
    fn split_through_vertices_makes_no_new_points() {
        // The diagonal passes through two vertices: each side is a triangle
        // of original vertices.
        let square = rect(0.0, 0.0, 1.0, 1.0);
        let below_diagonal =
            HalfPlane::left_of([1.0, 1.0], [0.0, 0.0]).unwrap_or_else(|| unreachable!());
        let s = split(&square, &below_diagonal, MIN_EDGE);
        assert_eq!(s.inside.len(), 3);
        assert_eq!(s.outside.len(), 3);
        assert!(
            s.inside
                .iter()
                .chain(&s.outside)
                .all(|p| square.contains(p))
        );
    }

    #[test]
    fn split_never_puts_a_point_next_to_a_vertex_on_the_line() {
        // A vertex 1e-17 off the line used to yield a crossing point at the
        // vertex, a zero-length edge, and a noise normal.
        let tri = vec![[0.0, -1.0], [1.0, 1e-17], [0.0, 1.0]];
        let above_x_axis = HalfPlane::new([0.0, 1.0], 0.0).unwrap_or_else(|| unreachable!());
        let s = split(&tri, &above_x_axis, MIN_EDGE);
        for side in [&s.inside, &s.outside] {
            assert_eq!(side.len(), 3, "{side:?}");
            for (a, b) in edges(side) {
                assert!(norm(sub(b, a)) >= MIN_EDGE);
            }
        }
    }

    #[test]
    fn split_keeps_the_polygon_whole_when_one_side_is_empty() {
        let square = rect(0.0, 0.0, 1.0, 1.0);
        let all_inside = HalfPlane::new([1.0, 0.0], -1.0).unwrap_or_else(|| unreachable!());
        let s = split(&square, &all_inside, MIN_EDGE);
        assert_eq!(s.inside, square);
        assert!(s.outside.is_empty());
        let all_outside = all_inside.complement();
        let s = split(&square, &all_outside, MIN_EDGE);
        assert!(s.inside.is_empty());
        assert_eq!(s.outside, square);
        // An edge lying on the line touches the other side without area.
        let x_le_0 = HalfPlane::new([-1.0, 0.0], 0.0).unwrap_or_else(|| unreachable!());
        let s = split(&square, &x_le_0, MIN_EDGE);
        assert!(s.inside.is_empty());
        assert_eq!(s.outside, square);
        // Within eps counts as on the line.
        let x_ge_tiny = HalfPlane::new([1.0, 0.0], 1e-7).unwrap_or_else(|| unreachable!());
        assert!(split(&square, &x_ge_tiny, TOL).outside.is_empty());
        assert!(
            split(&[[0.0, 0.0], [1.0, 0.0]], &x_ge_tiny, TOL)
                .inside
                .is_empty()
        );
    }

    #[test]
    fn clip_intersects_convex_polygons() {
        let a = rect(0.0, 0.0, 2.0, 2.0);
        let b = rect(1.0, 1.0, 3.0, 3.0);
        let i = clip(&a, &b);
        assert!(area_close(&i, 1.0));
        assert!(is_convex(&i, TOL));
        // Nested, identical, disjoint, touching along an edge and at a corner.
        assert!(area_close(&clip(&a, &rect(0.5, 0.5, 1.0, 1.0)), 0.25));
        assert!(area_close(&clip(&a, &a), 4.0));
        assert!(clip(&a, &rect(5.0, 5.0, 6.0, 6.0)).is_empty());
        assert!(clip(&a, &rect(2.0, 0.0, 3.0, 2.0)).is_empty());
        assert!(clip(&a, &rect(2.0, 2.0, 3.0, 3.0)).is_empty());
        // A triangle cutting a square's corner off: 1 - 0.5²/2.
        let tri = vec![[0.0, 0.0], [1.5, 0.0], [0.0, 1.5]];
        assert!(area_close(&clip(&rect(0.0, 0.0, 1.0, 1.0), &tri), 0.875));
    }

    #[test]
    fn carve_splits_into_the_inside_and_the_pieces_outside() {
        let a = rect(0.0, 0.0, 2.0, 2.0);
        let b = rect(1.0, 1.0, 3.0, 3.0);
        let c = carve(&a, &b, TOL).unwrap_or_default();
        assert!(area_close(&c.inside, 1.0));
        let outside: f64 = c.outside.iter().map(|p| signed_area(p)).sum();
        assert!((outside - 3.0).abs() < 1e-12);
        assert!(
            c.outside
                .iter()
                .all(|p| is_convex(p, TOL) && !overlaps(p, &b))
        );

        // Inside the window: whole, nothing outside.
        let c = carve(&rect(0.5, 0.5, 1.0, 1.0), &a, TOL).unwrap_or_default();
        assert_eq!(c.inside, rect(0.5, 0.5, 1.0, 1.0));
        assert!(c.outside.is_empty());

        // Disjoint, touching along an edge, overlapping by a sliver.
        assert_eq!(carve(&a, &rect(5.0, 5.0, 6.0, 6.0), TOL), None);
        assert_eq!(carve(&a, &rect(2.0, 0.0, 3.0, 2.0), TOL), None);
        assert_eq!(carve(&a, &rect(2.0 - 1e-7, 0.0, 3.0, 2.0), TOL), None);

        // A sliver beyond the window's edge stays with the inside.
        let c = carve(&rect(0.0, 0.0, 1.0 + 1e-7, 1.0), &a, TOL).unwrap_or_default();
        assert!(area_close(&c.inside, 1.0 + 1e-7));
        assert!(c.outside.is_empty());
        // A subject no wider than the sliver is never inside.
        assert_eq!(carve(&rect(0.5, 0.5, 1.0, 0.5 + 1e-7), &a, TOL), None);
    }

    #[test]
    fn penetration_separates_overlap_from_touching() {
        let a = rect(0.0, 0.0, 1.0, 1.0);
        assert!(close(penetration(&a, &rect(0.5, 0.0, 1.5, 1.0)), 0.5));
        assert!(overlaps(&a, &rect(0.5, 0.0, 1.5, 1.0)));
        // Sharing an edge, sharing a corner, apart.
        assert!(close(penetration(&a, &rect(1.0, 0.0, 2.0, 1.0)), 0.0));
        assert!(!overlaps(&a, &rect(1.0, 1.0, 2.0, 2.0)));
        assert!(close(penetration(&a, &rect(1.5, 0.0, 2.5, 1.0)), -0.5));
        // Overlapping by less than TOL is touching; by more is an overlap.
        assert!(!overlaps(&a, &rect(1.0 - 1e-7, 0.0, 2.0, 1.0)));
        assert!(overlaps(&a, &rect(1.0 - 1e-5, 0.0, 2.0, 1.0)));
        // Coincident faces overlap by their width.
        assert!(close(penetration(&a, &a), 1.0));
        // Degenerate input overlaps nothing.
        assert_eq!(penetration(&a, &[]), 0.0);
        assert_eq!(penetration(&[], &[]), 0.0);
    }

    #[test]
    fn penetration_ignores_a_near_zero_edge() {
        // Bug 1 of the core spike: a ring carrying a point 5e-17 from a
        // vertex. That edge's direction is rounding, here with its normal
        // pointing out of the square; taken as an axis it separates the square
        // from a quarter of itself by 0.1.
        let square = vec![
            [0.0, 0.0],
            [-4e-17, -3e-17],
            [1.0, 0.0],
            [1.0, 1.0],
            [0.0, 1.0],
        ];
        let kink = HalfPlane::new([0.6, -0.8], 0.0).unwrap_or_else(|| unreachable!());
        assert!(
            rect(0.0, 0.5, 0.5, 1.0)
                .iter()
                .all(|&q| kink.signed_distance(q) <= -0.1 + 1e-12)
        );
        let quarter = rect(0.0, 0.5, 0.5, 1.0);
        let p = penetration(&square, &quarter);
        assert!(close(p, 0.5), "penetration {p}");
        assert!(close(penetration(&quarter, &square), 0.5));
        assert!(close(width(&square), 1.0));
        assert!(contains_point(&square, [0.9, 0.9], TOL));
        // The same square without the near-duplicate agrees.
        assert!(close(penetration(&rect(0.0, 0.0, 1.0, 1.0), &quarter), p));
    }

    /// Kept planes answer as the plain test does, to the bit: random pairs,
    /// a ring with a direction-less edge, and degenerate input.
    #[test]
    fn penetration_with_planes_is_penetration() {
        let mut rng = Rng(11);
        let noisy = vec![
            [0.0, 0.0],
            [-4e-17, -3e-17],
            [1.0, 0.0],
            [1.0, 1.0],
            [0.0, 1.0],
        ];
        let mut polygons: Vec<Vec<Point>> = (0..300).map(|_| rng.convex()).collect();
        polygons.extend([noisy, rect(0.2, 0.2, 0.7, 0.5), Vec::new()]);
        let planes: Vec<Vec<HalfPlane>> = polygons.iter().map(|p| edge_planes(p)).collect();
        assert_eq!(
            planes[300].len(),
            4,
            "the noisy ring's short edge is left out"
        );
        let mut overlapping = 0;
        for i in 0..polygons.len() {
            for j in (0..polygons.len()).step_by(7) {
                let (p, q) = (&polygons[i], &polygons[j]);
                let kept = penetration_with_planes(p, &planes[i], q, &planes[j]);
                assert_eq!(kept.to_bits(), penetration(p, q).to_bits(), "{p:?} {q:?}");
                for tol in [0.0, TOL, 1e-3, 0.1, kept, kept.next_down()] {
                    let tol = tol.max(0.0);
                    assert_eq!(
                        overlaps_with_planes(p, &planes[i], q, &planes[j], tol),
                        kept > tol,
                        "{p:?} {q:?} at {tol}"
                    );
                }
                overlapping += usize::from(kept > TOL);
            }
            let own = penetration_with_planes(&polygons[i], &planes[i], &polygons[i], &planes[i]);
            assert_eq!(own.to_bits(), width(&polygons[i]).to_bits());
            let plain = penetration(&polygons[i], &polygons[i]);
            assert_eq!(plain.to_bits(), width(&polygons[i]).to_bits());
        }
        let pairs = polygons.len() * polygons.len().div_ceil(7);
        assert!(overlapping > 1000 && overlapping < pairs, "{overlapping}");
    }

    #[test]
    fn width_is_the_least_extent() {
        assert!(close(width(&rect(0.0, 0.0, 3.0, 0.5)), 0.5));
        let tri = vec![[0.0, 0.0], [4.0, 0.0], [0.0, 3.0]];
        // The least height: onto the hypotenuse, 12 / 5.
        assert!(close(width(&tri), 2.4));
        assert!(width(&rect(0.0, 0.0, 1.0, 1e-7)) <= TOL);
        assert_eq!(width(&[]), 0.0);
    }

    #[test]
    fn contains_point_with_a_margin() {
        let square = rect(0.0, 0.0, 1.0, 1.0);
        assert!(contains_point(&square, [0.5, 0.5], TOL));
        assert!(!contains_point(&square, [1.0, 0.5], TOL));
        assert!(!contains_point(&square, [1.0 - 1e-7, 0.5], TOL));
        assert!(contains_point(&square, [1.0 - 1e-5, 0.5], TOL));
        // A negative margin admits points just outside.
        assert!(contains_point(&square, [1.0 + 1e-7, 0.5], -TOL));
        assert!(!contains_point(&square, [2.0, 0.5], -TOL));
        assert!(!contains_point(&[], [0.0, 0.0], 0.0));
    }

    #[test]
    fn segment_length_inside_a_polygon() {
        let square = rect(0.0, 0.0, 1.0, 1.0);
        // Crossing, ending inside, along an edge, outside, touching a corner.
        assert!(
            (segment_length_inside([-1.0, 0.5], [2.0, 0.5], &square, TOL) - (1.0 - 2.0 * TOL))
                .abs()
                < 1e-12
        );
        assert!((segment_length_inside([0.5, 0.5], [3.0, 0.5], &square, 0.0) - 0.5).abs() < 1e-12);
        assert_eq!(
            segment_length_inside([0.0, 0.0], [1.0, 0.0], &square, TOL),
            0.0
        );
        assert_eq!(
            segment_length_inside([0.2, 0.0], [0.8, 0.0], &square, TOL),
            0.0
        );
        assert_eq!(
            segment_length_inside([2.0, 0.0], [3.0, 1.0], &square, 0.0),
            0.0
        );
        assert_eq!(
            segment_length_inside([1.0, 1.0], [2.0, 2.0], &square, TOL),
            0.0
        );
        // A diagonal.
        let diag = segment_length_inside([0.0, 0.0], [1.0, 1.0], &square, 0.0);
        assert!((diag - std::f64::consts::SQRT_2).abs() < 1e-12);
        assert_eq!(segment_length_inside([0.0, 0.0], [1.0, 1.0], &[], 0.0), 0.0);
    }

    #[test]
    fn randomized_clip_split_and_penetration_agree() {
        let mut rng = Rng(7);
        for _ in 0..2000 {
            let p = rng.convex();
            let q = rng.convex();
            assert!(is_convex(&p, TOL) && is_convex(&q, TOL));

            // The clip is convex and inside both.
            let i = clip(&p, &q);
            if !i.is_empty() {
                assert!(is_convex(&i, TOL), "{i:?}");
                for &x in &i {
                    assert!(contains_point(&p, x, -1e-9) && contains_point(&q, x, -1e-9));
                }
            }
            // The penetration bounds the intersection's width from above, so
            // an overlap at TOL always has a positive-area intersection.
            let pen = penetration(&p, &q);
            assert!((pen - penetration(&q, &p)).abs() < 1e-12);
            if !i.is_empty() {
                assert!(pen + 1e-12 >= width(&i), "pen {pen} width {}", width(&i));
            }
            if pen > TOL {
                assert!(!i.is_empty());
            }

            // A split preserves area and convexity.
            let theta = rng.next() * std::f64::consts::TAU;
            let plane = HalfPlane::new([theta.cos(), theta.sin()], rng.next() - 0.5)
                .unwrap_or_else(|| unreachable!());
            let s = split(&p, &plane, MIN_EDGE);
            let total = signed_area(&s.inside) + signed_area(&s.outside);
            assert!((total - signed_area(&p)).abs() < 1e-12);
            for side in [&s.inside, &s.outside] {
                assert!(side.is_empty() || is_convex(side, TOL));
            }
        }
    }
}
