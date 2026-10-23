//! A face image with its edges' half-planes computed once per build. The pair
//! tests, the cell cuts and the edge-through-face tests meet each face
//! hundreds of times, and `oristudio_geometry::convex` normalises every edge
//! again on each call (a `hypot` per edge, which was most of a pair test).
//! The answers are `convex`'s own, from the same half-planes in the same
//! order (`convex::edge_planes`); the tests hold them to it bit for bit.

use oristudio_geometry::convex::{self, Carve, HalfPlane, MIN_EDGE, edge_planes};

use crate::view::{FaceId, FoldedView};

type Point = [f64; 2];

/// One face of a view, ready for repeated tests.
pub(crate) struct Shape<'a> {
    pub(crate) id: FaceId,
    pub(crate) polygon: &'a [Point],
    pub(crate) bbox: [f64; 4],
    /// Left of each edge with a direction, in ring order: the planes
    /// `convex` tests a counter-clockwise ring against.
    pub(crate) planes: Vec<HalfPlane>,
}

impl<'a> Shape<'a> {
    pub(crate) fn new(id: FaceId, polygon: &'a [Point], bbox: [f64; 4]) -> Shape<'a> {
        Shape {
            id,
            polygon,
            bbox,
            planes: edge_planes(polygon),
        }
    }

    /// Every face of the view, in its order.
    pub(crate) fn of_view(view: &'a FoldedView) -> Vec<Shape<'a>> {
        view.faces()
            .iter()
            .enumerate()
            .map(|(i, f)| Shape::new(f.id, &f.polygon, *view.bounding_box(i)))
            .collect()
    }

    /// `convex::penetration(self.polygon, other.polygon)`.
    pub(crate) fn penetration(&self, other: &Shape<'_>) -> f64 {
        convex::penetration_with_planes(self.polygon, &self.planes, other.polygon, &other.planes)
    }

    /// `convex::segment_length_inside(a, b, self.polygon, margin)`.
    pub(crate) fn segment_length_inside(&self, a: Point, b: Point, margin: f64) -> f64 {
        let (mut t0, mut t1) = (0.0_f64, 1.0_f64);
        for plane in &self.planes {
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
        if self.planes.is_empty() {
            0.0
        } else {
            (t1 - t0) * (b[0] - a[0]).hypot(b[1] - a[1])
        }
    }
}

/// `convex::penetration(polygon, shape.polygon)` for a polygon met once.
pub(crate) fn penetration_with(polygon: &[Point], shape: &Shape<'_>) -> f64 {
    convex::penetration_with_planes(polygon, &edge_planes(polygon), shape.polygon, &shape.planes)
}

/// `convex::carve(subject, window, sliver)`, given the window's planes in
/// ring order, of which those the subject lies within by [`MIN_EDGE`] may be
/// left out.
///
/// Such a plane never cuts: every point of what is left inside lies within
/// `MIN_EDGE` of it (up to rounding), so what `convex::split` puts outside it
/// is at most twice that wide, no wider than any sliver, and carving moves
/// on. Leaving it out skips a split, an allocation or three and a width.
pub(crate) fn carve_along<'p>(
    subject: &[Point],
    planes: impl Iterator<Item = &'p HalfPlane>,
    sliver: f64,
) -> Option<Carve> {
    let mut inside = subject.to_vec();
    let mut outside = Vec::new();
    for plane in planes {
        let cut = convex::split(&inside, plane, MIN_EDGE);
        if cut.outside.is_empty() || convex::width(&cut.outside) <= sliver {
            continue;
        }
        if cut.inside.is_empty() || convex::width(&cut.inside) <= sliver {
            return None;
        }
        outside.push(cut.outside);
        inside = cut.inside;
    }
    if convex::width(&inside) <= sliver {
        return None;
    }
    Some(Carve { inside, outside })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// SplitMix64.
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> f64 {
            self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    /// A convex ring: points on a circle at increasing angles, some of them
    /// nearly coincident so that short edges are skipped.
    fn ring(rng: &mut Rng) -> Vec<Point> {
        let (cx, cy, r) = (rng.next(), rng.next(), 0.05 + rng.next());
        let n = 3 + (rng.next() * 6.0) as usize;
        let mut angles: Vec<f64> = (0..n).map(|_| rng.next() * std::f64::consts::TAU).collect();
        angles.sort_by(f64::total_cmp);
        let mut out: Vec<Point> = angles
            .iter()
            .map(|a| [cx + r * a.cos(), cy + r * a.sin()])
            .collect();
        if rng.next() < 0.3 {
            let p = out[0];
            out.insert(1, [p[0] + 1e-10, p[1]]);
        }
        out
    }

    #[test]
    fn cached_tests_are_convexs_bit_for_bit() {
        let mut rng = Rng(7);
        for _ in 0..4000 {
            let (p, q) = (ring(&mut rng), ring(&mut rng));
            let (sp, sq) = (
                Shape::new(FaceId(0), &p, convex::bounding_box(&p)),
                Shape::new(FaceId(1), &q, convex::bounding_box(&q)),
            );
            let want = convex::penetration(&p, &q);
            assert_eq!(sp.penetration(&sq).to_bits(), want.to_bits());
            assert_eq!(penetration_with(&p, &sq).to_bits(), want.to_bits());
            let (a, b) = (q[0], [rng.next() * 2.0 - 0.5, rng.next() * 2.0 - 0.5]);
            for margin in [0.0, 1e-6, -1e-6] {
                assert_eq!(
                    sp.segment_length_inside(a, b, margin).to_bits(),
                    convex::segment_length_inside(a, b, &p, margin).to_bits()
                );
            }
        }
    }

    fn bits(carve: &Option<Carve>) -> Option<Vec<Vec<[u64; 2]>>> {
        carve.as_ref().map(|c| {
            std::iter::once(&c.inside)
                .chain(&c.outside)
                .map(|p| p.iter().map(|x| x.map(f64::to_bits)).collect())
                .collect()
        })
    }

    #[test]
    fn carving_along_the_cutting_planes_is_convexs_carve() {
        let mut rng = Rng(11);
        let mut skipped = 0;
        for _ in 0..4000 {
            let window = convex::normalize(&ring(&mut rng));
            // Subjects that straddle the window, and some that lie inside it
            // but for an edge or two.
            let subject = if rng.next() < 0.5 {
                convex::normalize(&ring(&mut rng))
            } else {
                let c = convex::centroid(&window).unwrap_or([0.5, 0.5]);
                let k = 0.6 + 0.6 * rng.next();
                window
                    .iter()
                    .map(|p| [c[0] + k * (p[0] - c[0]), c[1] + k * (p[1] - c[1])])
                    .collect()
            };
            let want = convex::carve(&subject, &window, 1e-6);
            let all = edge_planes(&window);
            assert_eq!(bits(&carve_along(&subject, all.iter(), 1e-6)), bits(&want));
            let cutting: Vec<&HalfPlane> = all
                .iter()
                .filter(|pl| subject.iter().any(|&x| pl.signed_distance(x) < -MIN_EDGE))
                .collect();
            skipped += all.len() - cutting.len();
            assert_eq!(
                bits(&carve_along(&subject, cutting.into_iter(), 1e-6)),
                bits(&want)
            );
        }
        assert!(skipped > 1000, "only {skipped} planes skipped");
    }
}
