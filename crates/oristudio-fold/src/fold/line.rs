//! The fold line: snapping it through the vertex images it nearly touches, and
//! classifying every vertex once against it (plan D3 steps 1–2, D5; research
//! §4.2 step 0).
//!
//! Snapping moves ℓ exactly through every vertex image within [`TOL`]: one
//! place, a translation; two or more, the line through the two farthest,
//! keeping its orientation. Without it a vertex δ ≤ tol off ℓ becomes a chord
//! endpoint and the chord leans by about δ over its length; one spike
//! sequence reached a residual of 7.1e-3 that way.
//!
//! The snap is accepted only if it changes no vertex's class. Every vertex is
//! put in a band against both the line asked for and the snapped line; a
//! vertex in different bands makes the snap unsafe. Stable near misses may
//! be deferred while selecting layers; they refuse only when their material
//! participates. Strict callers still validate every vertex. The spike did
//! not check snap stability, and its
//! two-farthest rule once turned ℓ by 0.86° through two places 1e-4 apart.

use oristudio_geometry::convex::HalfPlane;
use oristudio_geometry::{Line, PointGrid};
use serde::Serialize;

use crate::isometry::Isometry;
use crate::numerics::{Band, EXACT, TOL};
use crate::pattern::VertexId;
use crate::refusal::{Fix, FoldRefusal, NearMissCause, Refused, Side};

type Point = [f64; 2];

/// An oriented fold line: the moving side is where `n · p − c > 0`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Axis {
    n: Point,
    c: f64,
}

impl Axis {
    pub(crate) fn new(line: &Line, side: Side) -> Axis {
        match side {
            Side::Positive => Axis {
                n: line.n,
                c: line.d,
            },
            Side::Negative => Axis {
                n: [-line.n[0], -line.n[1]],
                c: -line.d,
            },
        }
    }

    /// The line through `p` and `q`, oriented like `like`; none when the two
    /// are closer than the tolerance.
    fn through(p: Point, q: Point, like: &Axis) -> Option<Axis> {
        let line = Line::from_points(p, q)?;
        let side = if line.n[0] * like.n[0] + line.n[1] * like.n[1] >= 0.0 {
            Side::Positive
        } else {
            Side::Negative
        };
        Some(Axis::new(&line, side))
    }

    /// Signed distance, positive on the moving side.
    pub(crate) fn distance(&self, p: Point) -> f64 {
        self.n[0] * p[0] + self.n[1] * p[1] - self.c
    }

    /// The canonical line and which of its sides moves.
    pub(crate) fn line_and_side(&self) -> (Line, Side) {
        match Line::new(self.n, self.c) {
            Some(line) => {
                let same = line.n[0] * self.n[0] + line.n[1] * self.n[1] >= 0.0;
                (line, if same { Side::Positive } else { Side::Negative })
            }
            // The normal is a unit vector by construction.
            None => (
                Line {
                    n: self.n,
                    d: self.c,
                },
                Side::Positive,
            ),
        }
    }

    pub(crate) fn reflection(&self) -> Isometry {
        Isometry::reflection(self.n, self.c)
    }

    /// The moving side as a closed half-plane.
    pub(crate) fn moving_half_plane(&self) -> Option<HalfPlane> {
        HalfPlane::new(self.n, self.c)
    }
}

/// The snap actually applied, for display (plan D5).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Snap {
    /// How many distinct places the line was snapped through.
    pub clusters: usize,
    /// How far it turned, in radians.
    pub angle: f64,
    /// How far it moved at the farthest vertex image.
    pub max_shift: f64,
}

impl Snap {
    /// No snap: a line the engine made itself, such as a vertex fold's
    /// crease, which no click located.
    pub const NONE: Snap = Snap {
        clusters: 0,
        angle: 0.0,
        max_shift: 0.0,
    };
}

/// The snapped line and every vertex's class against it.
#[derive(Debug, Clone)]
pub(crate) struct Classified {
    pub(crate) axis: Axis,
    pub(crate) snap: Snap,
    /// Per vertex: +1 moving side, −1 stationary side, 0 on the line.
    pub(crate) classes: Vec<i8>,
    /// Per vertex, the signed distance from the snapped line.
    pub(crate) distances: Vec<f64>,
    /// Stable near misses, deferred until the participating paper is known.
    near_misses: Vec<(VertexId, Refused)>,
}

impl Classified {
    /// Check every vertex of the participating faces, including the stationary
    /// corners of faces that will be split. Closure-added paper counts too.
    pub(crate) fn refusal_for(&self, vertices: impl Iterator<Item = VertexId>) -> Option<Refused> {
        if self.near_misses.is_empty() {
            return None;
        }
        let mut relevant = vec![false; self.classes.len()];
        for v in vertices {
            relevant[v.index()] = true;
        }
        self.near_misses
            .iter()
            .find(|(v, _)| relevant[v.index()])
            .map(|(_, refusal)| refusal.clone())
    }
}

/// Snap `requested` through the vertex images it nearly touches, then
/// classify every vertex, refusing a near miss with the landmark line it
/// nearly is when there is one.
pub(crate) fn classify(images: &[Point], requested: Axis) -> Result<Classified, Refused> {
    classify_inner(images, requested, false)
}

/// Classify for selection without rejecting stable near misses on paper that
/// may stay untouched. Their signed classes are provisional: the caller must
/// validate the completed participating set before splitting or moving paper.
/// Snaps that change a band or side remain globally refused; selection must
/// never be based on topology altered by an unsafe snap.
pub(crate) fn classify_for_selection(
    images: &[Point],
    requested: Axis,
) -> Result<Classified, Refused> {
    classify_inner(images, requested, true)
}

fn classify_inner(
    images: &[Point],
    requested: Axis,
    defer_near: bool,
) -> Result<Classified, Refused> {
    let mut places = PointGrid::new(TOL);
    for &p in images {
        if requested.distance(p).abs() <= TOL {
            places.find_or_insert(p, TOL);
        }
    }
    let reps = places.points();
    let axis = match reps {
        [] => requested,
        [p] => Axis {
            n: requested.n,
            c: requested.n[0] * p[0] + requested.n[1] * p[1],
        },
        _ => {
            let (p, q) = farthest_pair(reps);
            Axis::through(p, q, &requested).unwrap_or(requested)
        }
    };
    let cos = (axis.n[0] * requested.n[0] + axis.n[1] * requested.n[1]).abs();
    let mut snap = Snap {
        clusters: reps.len(),
        angle: cos.min(1.0).acos(),
        max_shift: 0.0,
    };

    let mut near_misses = Vec::new();
    let mut classes = Vec::with_capacity(images.len());
    let mut distances = Vec::with_capacity(images.len());
    for (v, &p) in images.iter().enumerate() {
        let (d0, d1) = (requested.distance(p), axis.distance(p));
        snap.max_shift = snap.max_shift.max((d0 - d1).abs());
        let (b0, b1) = (Band::of(d0), Band::of(d1));
        let cause = if b0 == Band::Near || b1 == Band::Near {
            Some(NearMissCause::Band)
        } else if b0 != b1 {
            Some(NearMissCause::SnapChangesSide)
        } else if b1 == Band::On && d1.abs() > EXACT {
            Some(NearMissCause::SnapAmbiguous)
        } else {
            None
        };
        if let Some(cause) = cause {
            let distance = if b0 == Band::Near { d0 } else { d1 }.abs();
            let vertex = VertexId(v as u32);
            let fixes = match cause {
                NearMissCause::Band => landmark_line(images, reps, requested, p)
                    .map(|(line, side)| vec![Fix::UseLine { line, side }])
                    .unwrap_or_default(),
                _ => Vec::new(),
            };
            let refused = Refused {
                refusal: FoldRefusal::NearMiss {
                    vertex,
                    distance,
                    cause,
                },
                fixes,
            };
            if defer_near
                && b0 == Band::Near
                && b1 == Band::Near
                && d0.is_sign_positive() == d1.is_sign_positive()
            {
                near_misses.push((vertex, refused));
            } else {
                return Err(refused);
            }
        }
        // Near vertices retain their actual side for adjacency/overlap. They
        // are not snapped onto the line or allowed into an unchecked fold.
        classes.push(b1.class().unwrap_or(if d1 > 0.0 { 1 } else { -1 }));
        distances.push(d1);
    }
    Ok(Classified {
        axis,
        snap,
        classes,
        distances,
        near_misses,
    })
}

/// The two farthest of at least two points.
fn farthest_pair(points: &[Point]) -> (Point, Point) {
    let mut best = (points[0], points[1], -1.0);
    for (i, &p) in points.iter().enumerate() {
        for &q in &points[i + 1..] {
            let d = (p[0] - q[0]).hypot(p[1] - q[1]);
            if d > best.2 {
                best = (p, q, d);
            }
        }
    }
    (best.0, best.1)
}

/// The landmark line a near miss at `p` nearly is: through `p` and the
/// farthest place the line already passes through, or the line moved through
/// `p` when it passes through none. Offered only if no vertex is a near miss
/// of it.
fn landmark_line(
    images: &[Point],
    on: &[Point],
    requested: Axis,
    p: Point,
) -> Option<(Line, Side)> {
    let anchor = on.iter().copied().max_by(|a, b| {
        let da = (a[0] - p[0]).hypot(a[1] - p[1]);
        let db = (b[0] - p[0]).hypot(b[1] - p[1]);
        da.total_cmp(&db)
    });
    let axis = match anchor {
        Some(q) => Axis::through(p, q, &requested)?,
        None => Axis {
            n: requested.n,
            c: requested.n[0] * p[0] + requested.n[1] * p[1],
        },
    };
    images
        .iter()
        .all(|&x| Band::of(axis.distance(x)) != Band::Near)
        .then(|| axis.line_and_side())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::numerics::MIN_FEATURE;

    fn x_eq(c: f64) -> Axis {
        Axis { n: [1.0, 0.0], c }
    }

    fn square() -> Vec<Point> {
        vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]
    }

    #[test]
    fn a_clear_line_is_not_moved() {
        let c = classify(&square(), x_eq(0.5)).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(c.axis, x_eq(0.5));
        assert_eq!(c.snap.clusters, 0);
        assert_eq!(c.classes, vec![-1, 1, 1, -1]);
    }

    #[test]
    fn one_place_within_tol_translates_the_line_through_it() {
        let triangle = vec![[0.0, 0.0], [1.0, 0.5], [0.0, 1.0]];
        let c = classify(&triangle, x_eq(1.0 - 5e-7)).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(c.snap.clusters, 1);
        assert!((c.axis.c - 1.0).abs() < 1e-15);
        assert_eq!(c.snap.angle, 0.0);
        assert!((c.snap.max_shift - 5e-7).abs() < 1e-12);
        assert_eq!(c.classes, vec![-1, 0, -1]);
        // Two places on one vertical side: the line through both.
        let c = classify(&square(), x_eq(1.0 - 5e-7)).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(c.snap.clusters, 2);
        assert_eq!(c.classes, vec![-1, 0, 0, -1]);
    }

    #[test]
    fn two_places_rotate_the_line_through_both() {
        // The diagonal, nudged by less than tol at both ends.
        let s = 0.5_f64.sqrt();
        let requested = Axis {
            n: [-s, s],
            c: 4e-7,
        };
        let c = classify(&square(), requested).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(c.snap.clusters, 2);
        assert!(c.distances[0].abs() <= EXACT && c.distances[2].abs() <= EXACT);
        assert_eq!(c.classes, vec![0, -1, 0, 1]);
    }

    #[test]
    fn a_vertex_inside_the_minimum_feature_is_a_near_miss_with_its_landmark() {
        let near = x_eq(1.0 - 1e-4);
        let Err(refused) = classify(&square(), near) else {
            panic!("a near miss folded");
        };
        assert!(matches!(
            refused.refusal,
            FoldRefusal::NearMiss {
                cause: NearMissCause::Band,
                ..
            }
        ));
        // The landmark: the line through the near vertex, x = 1 here.
        let [Fix::UseLine { line, side }] = refused.fixes.as_slice() else {
            panic!("{:?}", refused.fixes);
        };
        assert!(line.approx_eq(&Line::new([1.0, 0.0], 1.0).unwrap_or(*line)));
        assert_eq!(*side, Side::Positive);
        // Just outside the band is a clean fold.
        assert!(classify(&square(), x_eq(1.0 - MIN_FEATURE)).is_ok());
    }

    #[test]
    fn a_snap_that_swings_a_far_vertex_across_is_refused() {
        // Two places 2.2e-6 apart, both within tol of y = 0: snapping
        // through both turns the line by about 24°, so a vertex far away
        // changes side.
        let images = vec![[0.0, 0.0], [2e-6, 9e-7], [1.0, 0.002], [0.0, 1.0]];
        let requested = Axis {
            n: [0.0, 1.0],
            c: 0.0,
        };
        assert!(
            classify_for_selection(&images, requested).is_err(),
            "selection must not hide unsafe snapping"
        );
        let Err(refused) = classify(&images, requested) else {
            panic!("a swinging snap folded");
        };
        assert!(matches!(
            refused.refusal,
            FoldRefusal::NearMiss {
                vertex: VertexId(2),
                ..
            }
        ));
    }

    #[test]
    fn axes_report_their_canonical_line_and_side() {
        let a = Axis::new(
            &Line::new([1.0, 0.0], 0.5).unwrap_or_else(|| unreachable!()),
            Side::Negative,
        );
        assert!(a.distance([0.2, 0.0]) > 0.0);
        let (line, side) = a.line_and_side();
        assert_eq!(line.n, [1.0, 0.0]);
        assert_eq!(side, Side::Negative);
        assert_eq!(
            Axis::new(&line, Side::Positive).line_and_side().1,
            Side::Positive
        );
    }
}
