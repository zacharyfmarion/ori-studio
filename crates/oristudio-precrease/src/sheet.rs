//! The planner's sheet: the unit rectangle `[0, w] × [0, h]` with
//! `max(w, h) = 1`, plus the in-paper tests every axiom needs (a reflected
//! point must land on the paper, a fold must cross it, a reference line has
//! an in-paper segment).

use serde::{Deserialize, Serialize};

use crate::frame::Frame;
use crate::line::Line;
use crate::tol::TOL;

/// The sheet as a rectangle in the planner's unit frame.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Sheet {
    pub width: f64,
    pub height: f64,
}

/// Which sheet edge a line is, for typed references in step sentences.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeSide {
    /// `x = 0`.
    Left,
    /// `x = w`.
    Right,
    /// `y = 0`.
    Bottom,
    /// `y = h`.
    Top,
}

/// Which sheet corner a point is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CornerName {
    /// `(0, 0)`.
    Sw,
    /// `(w, 0)`.
    Se,
    /// `(0, h)`.
    Nw,
    /// `(w, h)`.
    Ne,
}

impl Sheet {
    /// The unit square.
    pub fn unit_square() -> Sheet {
        Sheet {
            width: 1.0,
            height: 1.0,
        }
    }

    /// The sheet of a frame: its ReferenceFinder `(w, h)`.
    pub fn from_frame(frame: &Frame) -> Sheet {
        let r = frame.rf_rect();
        Sheet {
            width: r.width,
            height: r.height,
        }
    }

    /// A sheet with the given sides; `None` unless both are positive and the
    /// longer is 1 (within `TOL`).
    pub fn new(width: f64, height: f64) -> Option<Sheet> {
        if !width.is_finite() || !height.is_finite() || width <= TOL || height <= TOL {
            return None;
        }
        if (width.max(height) - 1.0).abs() > TOL {
            return None;
        }
        Some(Sheet { width, height })
    }

    /// Whether `p` lies on the sheet padded by `pad`.
    pub fn contains(&self, p: [f64; 2], pad: f64) -> bool {
        p[0] >= -pad && p[0] <= self.width + pad && p[1] >= -pad && p[1] <= self.height + pad
    }

    /// The four edge lines in the order of [`EdgeSide`]: left, right,
    /// bottom, top.
    pub fn edges(&self) -> [Line; 4] {
        let fallback = Line {
            n: [1.0, 0.0],
            d: 0.0,
        };
        [
            Line::new([1.0, 0.0], 0.0).unwrap_or(fallback),
            Line::new([1.0, 0.0], self.width).unwrap_or(fallback),
            Line::new([0.0, 1.0], 0.0).unwrap_or(fallback),
            Line::new([0.0, 1.0], self.height).unwrap_or(fallback),
        ]
    }

    /// The edge sides in the order of [`Self::edges`].
    pub const EDGE_SIDES: [EdgeSide; 4] = [
        EdgeSide::Left,
        EdgeSide::Right,
        EdgeSide::Bottom,
        EdgeSide::Top,
    ];

    /// The four corners in the order of [`CornerName`]: sw, se, nw, ne.
    pub fn corners(&self) -> [[f64; 2]; 4] {
        [
            [0.0, 0.0],
            [self.width, 0.0],
            [0.0, self.height],
            [self.width, self.height],
        ]
    }

    /// The corner names in the order of [`Self::corners`].
    pub const CORNER_NAMES: [CornerName; 4] = [
        CornerName::Sw,
        CornerName::Se,
        CornerName::Nw,
        CornerName::Ne,
    ];

    /// Which edge `line` is, if any.
    pub fn edge_of(&self, line: &Line) -> Option<EdgeSide> {
        self.edges()
            .iter()
            .zip(Self::EDGE_SIDES)
            .find(|(e, _)| e.approx_eq(line))
            .map(|(_, side)| side)
    }

    /// Which corner `p` is, if any.
    pub fn corner_of(&self, p: [f64; 2]) -> Option<CornerName> {
        self.corners()
            .iter()
            .zip(Self::CORNER_NAMES)
            .find(|(c, _)| (c[0] - p[0]).abs() <= TOL && (c[1] - p[1]).abs() <= TOL)
            .map(|(_, name)| name)
    }

    /// Whether `p` lies on the sheet's boundary (within `TOL`).
    pub fn on_boundary(&self, p: [f64; 2]) -> bool {
        self.contains(p, TOL)
            && (p[0].abs() <= TOL
                || (p[0] - self.width).abs() <= TOL
                || p[1].abs() <= TOL
                || (p[1] - self.height).abs() <= TOL)
    }

    /// The parameter interval `[t0, t1]` along `line` (see
    /// [`Line::parameter`]) that lies on the sheet, or `None` when the line
    /// misses the sheet. A line touching only a corner returns a degenerate
    /// interval.
    pub fn clip_parameters(&self, line: &Line) -> Option<(f64, f64)> {
        let f = line.foot();
        let dir = line.direction();
        let mut t0 = f64::NEG_INFINITY;
        let mut t1 = f64::INFINITY;
        // Half-planes: 0 ≤ f + t·dir ≤ side, per axis.
        for axis in 0..2 {
            let side = if axis == 0 { self.width } else { self.height };
            let (origin, slope) = (f[axis], dir[axis]);
            if slope.abs() < 1e-15 {
                if origin < -TOL || origin > side + TOL {
                    return None;
                }
                continue;
            }
            let ta = (0.0 - origin) / slope;
            let tb = (side - origin) / slope;
            let (lo, hi) = if ta < tb { (ta, tb) } else { (tb, ta) };
            t0 = t0.max(lo);
            t1 = t1.min(hi);
        }
        if t0 > t1 + TOL {
            return None;
        }
        Some((t0, t1.max(t0)))
    }

    /// The in-paper segment of `line`, or `None` when it misses the sheet.
    pub fn clip(&self, line: &Line) -> Option<([f64; 2], [f64; 2])> {
        let (t0, t1) = self.clip_parameters(line)?;
        Some((line.point_at(t0), line.point_at(t1)))
    }

    /// Whether `line` has an in-paper segment longer than `TOL` — a fold
    /// that only grazes a corner is not a fold.
    pub fn crosses(&self, line: &Line) -> bool {
        match self.clip_parameters(line) {
            Some((t0, t1)) => t1 - t0 > TOL,
            None => false,
        }
    }

    /// Aspect ratio (short side over long side) of the bounding box of the
    /// piece of the sheet on one side of `line`. A flap thinner than
    /// [`crate::constants::SKINNY_FLAP_ASPECT`] on either side is hard to
    /// fold accurately.
    pub fn flap_aspects(&self, line: &Line) -> Option<[f64; 2]> {
        let (a, b) = self.clip(line)?;
        let mut aspects = [1.0f64; 2];
        for (k, sign) in [1.0f64, -1.0].iter().enumerate() {
            let mut min = [a[0].min(b[0]), a[1].min(b[1])];
            let mut max = [a[0].max(b[0]), a[1].max(b[1])];
            let mut any = false;
            for c in self.corners() {
                if line.signed_distance(c) * sign > TOL {
                    any = true;
                    min[0] = min[0].min(c[0]);
                    min[1] = min[1].min(c[1]);
                    max[0] = max[0].max(c[0]);
                    max[1] = max[1].max(c[1]);
                }
            }
            if !any {
                aspects[k] = 0.0;
                continue;
            }
            let w = max[0] - min[0];
            let h = max[1] - min[1];
            let long = w.max(h);
            aspects[k] = if long <= TOL { 0.0 } else { w.min(h) / long };
        }
        Some(aspects)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clip_and_crosses() {
        let s = Sheet::unit_square();
        let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("line");
        let (a, b) = s.clip(&diag).expect("segment");
        let lo = if a[0] < b[0] { a } else { b };
        let hi = if a[0] < b[0] { b } else { a };
        assert!((lo[0]).abs() < 1e-12 && (lo[1]).abs() < 1e-12);
        assert!((hi[0] - 1.0).abs() < 1e-12 && (hi[1] - 1.0).abs() < 1e-12);
        assert!(s.crosses(&diag));
        // A line through one corner only, leaning outside: touches, does not cross.
        let graze = Line::from_points([0.0, 0.0], [1.0, -1.0]).expect("line");
        assert!(!s.crosses(&graze));
        // Misses entirely.
        let miss = Line::new([0.0, 1.0], 1.5).expect("line");
        assert!(s.clip(&miss).is_none());
        // A rectangle.
        let r = Sheet::new(0.5, 1.0).expect("sheet");
        let (a, b) = r
            .clip(&Line::new([0.0, 1.0], 0.25).expect("line"))
            .expect("seg");
        assert!((a[0] - b[0]).abs() > 0.49);
    }

    #[test]
    fn edges_corners_and_names() {
        let s = Sheet::unit_square();
        assert_eq!(
            s.edge_of(&Line::new([1.0, 0.0], 1.0).expect("line")),
            Some(EdgeSide::Right)
        );
        assert_eq!(s.corner_of([1.0, 1.0]), Some(CornerName::Ne));
        assert_eq!(s.corner_of([0.5, 1.0]), None);
        assert!(s.on_boundary([0.5, 1.0]));
        assert!(!s.on_boundary([0.5, 0.5]));
        assert!(Sheet::new(2.0, 1.0).is_none());
        assert!(Sheet::new(1.0, 0.0).is_none());
    }

    #[test]
    fn flap_aspects_flag_thin_strips() {
        let s = Sheet::unit_square();
        let thin = Line::new([1.0, 0.0], 0.05).expect("line");
        let [left, right] = s.flap_aspects(&thin).expect("aspects");
        assert!(left.min(right) < 0.1 && left.max(right) > 0.9);
        let mid = Line::new([1.0, 0.0], 0.5).expect("line");
        let a = s.flap_aspects(&mid).expect("aspects");
        assert!((a[0] - 0.5).abs() < 1e-12 && (a[1] - 0.5).abs() < 1e-12);
    }
}
