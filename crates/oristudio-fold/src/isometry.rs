//! Plane isometries as 2×3 affine maps.
//!
//! A face's isometry maps its sheet coordinates into the model frame. Its
//! determinant is +1 when the face shows its front to the viewer at +z
//! (front-up) and −1 when it shows its back (research §3.1).

use serde::{Deserialize, Serialize};

type Point = [f64; 2];

/// `x' = a x + b y + c`, `y' = d x + e y + f`, stored `[a, b, c, d, e, f]`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Isometry(pub [f64; 6]);

impl Isometry {
    pub const IDENTITY: Isometry = Isometry([1.0, 0.0, 0.0, 0.0, 1.0, 0.0]);

    /// The reflection across the line `n · p = c`, for a unit normal `n`:
    /// `p' = p − 2 (n · p − c) n`.
    pub fn reflection(n: Point, c: f64) -> Isometry {
        let [nx, ny] = n;
        Isometry([
            1.0 - 2.0 * nx * nx,
            -2.0 * nx * ny,
            2.0 * c * nx,
            -2.0 * nx * ny,
            1.0 - 2.0 * ny * ny,
            2.0 * c * ny,
        ])
    }

    /// The rotation by `angle` radians, counter-clockwise, about the origin.
    pub fn rotation(angle: f64) -> Isometry {
        let (s, c) = angle.sin_cos();
        Isometry([c, -s, 0.0, s, c, 0.0])
    }

    /// The mirror image across the y axis, `x ↦ −x`.
    pub const MIRROR_X: Isometry = Isometry([-1.0, 0.0, 0.0, 0.0, 1.0, 0.0]);

    pub fn apply(&self, p: Point) -> Point {
        let [a, b, c, d, e, f] = self.0;
        [a * p[0] + b * p[1] + c, d * p[0] + e * p[1] + f]
    }

    /// `self ∘ other`: apply `other` first.
    pub fn after(&self, other: &Isometry) -> Isometry {
        let [a, b, c, d, e, f] = self.0;
        let [p, q, r, s, t, u] = other.0;
        Isometry([
            a * p + b * s,
            a * q + b * t,
            a * r + b * u + c,
            d * p + e * s,
            d * q + e * t,
            d * r + e * u + f,
        ])
    }

    pub fn det(&self) -> f64 {
        let [a, b, _, d, e, _] = self.0;
        a * e - b * d
    }

    /// Whether the map keeps orientation: a face under it shows its front.
    pub fn front_up(&self) -> bool {
        self.det() > 0.0
    }

    /// Whether this is a rigid motion within `tolerance`: every entry
    /// finite and the linear part orthonormal (unit columns, at right
    /// angles). [`Isometry::inverse`] holds only for one.
    pub fn is_rigid(&self, tolerance: f64) -> bool {
        let [a, b, _, d, e, _] = self.0;
        self.0.iter().all(|x| x.is_finite())
            && (a * a + d * d - 1.0).abs() <= tolerance
            && (b * b + e * e - 1.0).abs() <= tolerance
            && (a * b + d * e).abs() <= tolerance
    }

    /// The inverse, using that the linear part is orthogonal (its inverse is
    /// its transpose).
    pub fn inverse(&self) -> Isometry {
        let [a, b, c, d, e, f] = self.0;
        Isometry([a, d, -(a * c + d * f), b, e, -(b * c + e * f)])
    }

    /// The largest distance between the images of `points` under the two
    /// maps.
    pub fn distance_on(&self, other: &Isometry, points: impl IntoIterator<Item = Point>) -> f64 {
        points
            .into_iter()
            .map(|p| {
                let (x, y) = (self.apply(p), other.apply(p));
                (x[0] - y[0]).hypot(x[1] - y[1])
            })
            .fold(0.0, f64::max)
    }
}

impl Default for Isometry {
    fn default() -> Isometry {
        Isometry::IDENTITY
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Point, b: Point) -> bool {
        (a[0] - b[0]).abs() < 1e-12 && (a[1] - b[1]).abs() < 1e-12
    }

    #[test]
    fn reflection_fixes_its_line_and_reverses_orientation() {
        // x = 0.5.
        let r = Isometry::reflection([1.0, 0.0], 0.5);
        assert!(close(r.apply([1.0, 0.0]), [0.0, 0.0]));
        assert!(close(r.apply([0.5, 0.7]), [0.5, 0.7]));
        assert!(!r.front_up());
        assert!(close(r.after(&r).apply([0.3, 0.9]), [0.3, 0.9]));
        // The diagonal y = x.
        let s = 0.5_f64.sqrt();
        let d = Isometry::reflection([-s, s], 0.0);
        assert!(close(d.apply([1.0, 0.0]), [0.0, 1.0]));
    }

    #[test]
    fn composition_applies_the_right_map_first() {
        let r = Isometry::reflection([1.0, 0.0], 0.5);
        let t = Isometry::reflection([0.0, 1.0], 0.5);
        // Reflect in x = 0.5, then in y = 0.5: (1, 0) → (0, 0) → (0, 1).
        assert!(close(t.after(&r).apply([1.0, 0.0]), [0.0, 1.0]));
        assert!(t.after(&r).front_up());
    }

    #[test]
    fn rigid_motions_are_told_from_other_maps() {
        let m = Isometry::rotation(0.7).after(&Isometry::reflection([0.6, 0.8], 0.3));
        assert!(m.is_rigid(1e-12));
        assert!(Isometry::IDENTITY.is_rigid(0.0));
        assert!(Isometry::MIRROR_X.is_rigid(0.0));
        for not in [
            Isometry([2.0, 0.0, 0.0, 0.0, 2.0, 0.0]),
            Isometry([1.0, 0.5, 0.0, 0.0, 1.0, 0.0]),
            Isometry([1.0, 0.0, f64::NAN, 0.0, 1.0, 0.0]),
            Isometry([1.0, 0.0, 0.0, 0.0, 1.0, f64::INFINITY]),
        ] {
            assert!(!not.is_rigid(1e-6), "{not:?}");
        }
    }

    #[test]
    fn inverse_undoes_the_map() {
        let m = Isometry::rotation(0.7).after(&Isometry::reflection([0.6, 0.8], 0.3));
        let p = [0.25, -1.5];
        assert!(close(m.inverse().apply(m.apply(p)), p));
        assert!(close(m.after(&m.inverse()).apply(p), p));
        assert!(Isometry::IDENTITY.distance_on(&m.inverse().after(&m), [p, [3.0, 4.0]]) < 1e-12);
    }
}
