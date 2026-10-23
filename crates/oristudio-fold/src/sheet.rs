//! The sheet: a convex polygon in the unit sheet frame (plan D2, D7).
//!
//! The frame is the precrease planner's: y-up, the outline's bounding box at
//! the origin, its longer side 1, so every tolerance is a fraction of the
//! sheet. Only convex outlines are accepted. Every straight fold then cuts
//! each face along a full chord and every face stays convex (research §3); a
//! non-convex sheet is refused rather than approximated.

use oristudio_geometry::convex;
use serde::{Deserialize, Serialize};

use crate::numerics::{MIN_FEATURE, TOL};
use crate::refusal::FoldRefusal;

type Point = [f64; 2];

/// The most sides a regular polygon sheet may have. The document offers 3 to
/// 8 (plan D7); the engine only guards against absurd input.
pub const MAX_REGULAR_SIDES: u32 = 64;

/// A sheet as a document names it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "shape")]
pub enum SheetShape {
    Square,
    /// Any positive `width : height`, scaled to longer side 1.
    Rectangle {
        width: f64,
        height: f64,
    },
    /// A regular polygon with its first vertex at −π/2 (the bottom).
    Regular {
        sides: u32,
    },
    /// An outline already in the unit sheet frame.
    Polygon {
        points: Vec<Point>,
    },
}

/// A validated convex outline, counter-clockwise, in the unit sheet frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sheet {
    outline: Vec<Point>,
}

impl Sheet {
    pub fn new(shape: &SheetShape) -> Result<Sheet, FoldRefusal> {
        match shape {
            SheetShape::Square => Ok(Sheet::square()),
            SheetShape::Rectangle { width, height } => Sheet::rectangle(*width, *height),
            SheetShape::Regular { sides } => Sheet::regular(*sides),
            SheetShape::Polygon { points } => Sheet::polygon(points.clone()),
        }
    }

    /// The unit square.
    pub fn square() -> Sheet {
        Sheet {
            outline: vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        }
    }

    /// A `width : height` rectangle, scaled to longer side 1.
    pub fn rectangle(width: f64, height: f64) -> Result<Sheet, FoldRefusal> {
        if !(width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0) {
            return Err(FoldRefusal::InvalidRectangle);
        }
        let longer = width.max(height);
        let (w, h) = (width / longer, height / longer);
        Sheet::polygon(vec![[0.0, 0.0], [w, 0.0], [w, h], [0.0, h]])
    }

    /// A regular polygon with its first vertex at −π/2, counter-clockwise,
    /// placed in the unit frame.
    pub fn regular(sides: u32) -> Result<Sheet, FoldRefusal> {
        if !(3..=MAX_REGULAR_SIDES).contains(&sides) {
            return Err(FoldRefusal::InvalidSides { sides });
        }
        let n = f64::from(sides);
        let ring: Vec<Point> = (0..sides)
            .map(|k| {
                let t = -std::f64::consts::FRAC_PI_2 + std::f64::consts::TAU * f64::from(k) / n;
                [t.cos(), t.sin()]
            })
            .collect();
        let [x0, y0, x1, y1] = convex::bounding_box(&ring);
        let scale = 1.0 / (x1 - x0).max(y1 - y0);
        let points = ring
            .iter()
            .map(|&[x, y]| [(x - x0) * scale, (y - y0) * scale])
            .collect();
        Sheet::polygon(points)
    }

    /// An outline given in the unit frame: at least three points, convex, no
    /// side shorter than the minimum feature, and its bounding box at the
    /// origin with longer side 1. Either orientation is accepted and stored
    /// counter-clockwise.
    pub fn polygon(points: Vec<Point>) -> Result<Sheet, FoldRefusal> {
        let n = points.len();
        if n < 3 {
            return Err(FoldRefusal::SheetTooFewPoints { count: n });
        }
        if points.iter().flatten().any(|c| !c.is_finite()) {
            return Err(FoldRefusal::SheetNotFinite);
        }
        for i in 0..n {
            let (a, b) = (points[i], points[(i + 1) % n]);
            let length = (b[0] - a[0]).hypot(b[1] - a[1]);
            if length < MIN_FEATURE {
                return Err(FoldRefusal::SheetSideTooShort { index: i, length });
            }
        }
        let mut outline = points;
        if convex::signed_area(&outline) < 0.0 {
            outline.reverse();
        }
        if !convex::is_convex(&outline, TOL) {
            return Err(FoldRefusal::SheetNotConvex);
        }
        let [x0, y0, x1, y1] = convex::bounding_box(&outline);
        if x0.abs() > TOL || y0.abs() > TOL || ((x1 - x0).max(y1 - y0) - 1.0).abs() > TOL {
            return Err(FoldRefusal::SheetNotInUnitFrame);
        }
        Ok(Sheet { outline })
    }

    /// The outline, counter-clockwise.
    pub fn outline(&self) -> &[Point] {
        &self.outline
    }

    pub fn area(&self) -> f64 {
        convex::signed_area(&self.outline)
    }

    /// Whether `p` lies inside the sheet by more than `margin`.
    pub fn contains(&self, p: Point, margin: f64) -> bool {
        convex::contains_point(&self.outline, p, margin)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rectangles_scale_to_longer_side_one() {
        let s = Sheet::rectangle(2.0, 1.0).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(s.outline()[2], [1.0, 0.5]);
        assert!((s.area() - 0.5).abs() < 1e-12);
        let tall = Sheet::rectangle(3.0, 4.0).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(tall.outline()[2], [0.75, 1.0]);
        assert_eq!(
            Sheet::rectangle(0.0, 1.0),
            Err(FoldRefusal::InvalidRectangle)
        );
        assert_eq!(
            Sheet::rectangle(f64::NAN, 1.0),
            Err(FoldRefusal::InvalidRectangle)
        );
    }

    #[test]
    fn regular_polygons_start_at_the_bottom() {
        for sides in 3..=8 {
            let s = Sheet::regular(sides).unwrap_or_else(|e| panic!("{sides}: {e}"));
            assert_eq!(s.outline().len(), sides as usize);
            // The first vertex is the lowest point, on the vertical axis of
            // symmetry.
            let first = s.outline()[0];
            assert!(first[1].abs() < 1e-12, "{sides}: {first:?}");
            let [x0, _, x1, _] = convex::bounding_box(s.outline());
            assert!((first[0] - (x0 + x1) / 2.0).abs() < 1e-12);
            assert!(convex::is_convex(s.outline(), TOL));
        }
        assert_eq!(
            Sheet::regular(2),
            Err(FoldRefusal::InvalidSides { sides: 2 })
        );
    }

    #[test]
    fn malformed_outlines_are_refused() {
        assert_eq!(
            Sheet::polygon(vec![[0.0, 0.0], [1.0, 0.0]]),
            Err(FoldRefusal::SheetTooFewPoints { count: 2 })
        );
        assert_eq!(
            Sheet::polygon(vec![[0.0, 0.0], [f64::INFINITY, 0.0], [0.0, 1.0]]),
            Err(FoldRefusal::SheetNotFinite)
        );
        // An arrowhead: not convex.
        let dart = vec![[0.0, 0.0], [1.0, 0.0], [0.5, 0.3], [0.5, 1.0]];
        assert_eq!(Sheet::polygon(dart), Err(FoldRefusal::SheetNotConvex));
        // A side shorter than the minimum feature.
        let notch = vec![
            [0.0, 0.0],
            [1.0, 0.0],
            [1.0, 1.0],
            [1.0 - 1e-4, 1.0],
            [0.0, 1.0],
        ];
        assert!(matches!(
            Sheet::polygon(notch),
            Err(FoldRefusal::SheetSideTooShort { index: 2, .. })
        ));
        // Not in the unit frame.
        let shifted = vec![[1.0, 0.0], [2.0, 0.0], [2.0, 1.0], [1.0, 1.0]];
        assert_eq!(
            Sheet::polygon(shifted),
            Err(FoldRefusal::SheetNotInUnitFrame)
        );
    }

    #[test]
    fn clockwise_outlines_are_stored_counter_clockwise() {
        let cw = vec![[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0]];
        let s = Sheet::polygon(cw).unwrap_or_else(|e| panic!("{e}"));
        assert!(convex::signed_area(s.outline()) > 0.0);
        assert!(s.contains([0.5, 0.5], TOL));
        assert!(!s.contains([1.0, 0.5], TOL));
    }
}
