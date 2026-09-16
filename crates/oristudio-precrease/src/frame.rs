//! One rectangular sheet in model space and its maps to the planner's unit
//! rectangle and to ReferenceFinder's rectangle.
//!
//! Oriedita model space is **y-down** (screen coordinates, default paper
//! ±200). The planner's unit rectangle is **y-up** with a lower-left origin
//! and its longer side equal to 1, which is also ReferenceFinder's paper
//! (bottom-left origin, y-up, `(w, h)` with `max(w, h) = 1`). The map from
//! model space to the unit rectangle therefore contains a reflection: the
//! frame's `y_axis` is the on-screen "up" direction, `x_axis` rotated by
//! −90° in model coordinates, so `(x_axis, y_axis)` is a left-handed pair in
//! the y-down model space and a right-handed pair on screen.
//!
//! Chain: model → sheet (rotation + translation, model units) → unit
//! rectangle (divide by the longer side) → ReferenceFinder rectangle
//! (identical to the unit rectangle; kept as its own step so an RF-specific
//! convention only ever has one place to land).

use serde::{Deserialize, Serialize};

use crate::error::PrecreaseError;
use crate::line::Line;
use crate::tol::TOL;

/// ReferenceFinder's paper rectangle: `(w, h)` with `max(w, h) = 1`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RfRect {
    pub width: f64,
    pub height: f64,
}

/// A 2×3 affine as `[a, b, c, d, e, f]` in the canvas / `DOMMatrix`
/// convention: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
pub type Affine = [f64; 6];

/// The four maps of a frame as affines, for the TypeScript side.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FrameAffines {
    pub model_to_unit: Affine,
    pub unit_to_model: Affine,
    pub model_to_rf: Affine,
    pub rf_to_model: Affine,
}

/// A rectangular sheet: origin corner, unit axes and side lengths in model
/// units. `origin` is the corner that maps to the unit rectangle's
/// lower-left `(0, 0)`; `x_axis` runs along the sheet's width and `y_axis`
/// along its height, with `y_axis = (x_axis.y, −x_axis.x)` (screen "up").
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Frame {
    pub origin: [f64; 2],
    pub x_axis: [f64; 2],
    pub y_axis: [f64; 2],
    pub width: f64,
    pub height: f64,
}

impl Frame {
    /// A frame from its origin corner, the direction of its width edge and
    /// its two sides in model units. `x_axis` is normalised.
    pub fn new(
        origin: [f64; 2],
        x_axis: [f64; 2],
        width: f64,
        height: f64,
    ) -> Result<Frame, PrecreaseError> {
        let len = (x_axis[0] * x_axis[0] + x_axis[1] * x_axis[1]).sqrt();
        if !len.is_finite() || len <= 0.0 {
            return Err(PrecreaseError::DegenerateFrame {
                reason: "x_axis has no direction",
            });
        }
        if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
            return Err(PrecreaseError::DegenerateFrame {
                reason: "sides must be positive",
            });
        }
        let x = [x_axis[0] / len, x_axis[1] / len];
        Ok(Frame {
            origin,
            x_axis: x,
            y_axis: [x[1], -x[0]],
            width,
            height,
        })
    }

    /// A frame whose axes are already settled: `x_axis` and `y_axis` are taken
    /// as given rather than derived, and only the sides are validated.
    ///
    /// Measuring a sheet's sides and mapping points into it must use the *same*
    /// axis. [`Self::new`] normalises its own copy, so a caller that measures
    /// its extents by projecting onto the vector it passed in ends up with a
    /// frame a hair inconsistent with those extents — and normalising twice does
    /// not settle it, since `‖normalise(v)‖` is itself only 1 to within an ULP.
    /// One ULP is enough: on a 45° sheet the far edge then maps to
    /// `1.0000000000000002`, and `ReferenceFinder::ValidateMark` bounds the
    /// paper with no epsilon at all, so every vertex on that edge is rejected.
    ///
    /// So `rectangle_frame` settles the axes once through [`Self::new`],
    /// measures against the answer, and rebuilds here.
    pub fn with_axes(
        origin: [f64; 2],
        x_axis: [f64; 2],
        y_axis: [f64; 2],
        width: f64,
        height: f64,
    ) -> Result<Frame, PrecreaseError> {
        if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
            return Err(PrecreaseError::DegenerateFrame {
                reason: "sides must be positive",
            });
        }
        Ok(Frame {
            origin,
            x_axis,
            y_axis,
            width,
            height,
        })
    }

    /// An axis-aligned sheet from a model-space rectangle `[x0, y0, x1, y1]`.
    /// The origin is the on-screen bottom-left corner `(x0, y1)` because
    /// model space is y-down.
    pub fn axis_aligned(rect: [f64; 4]) -> Result<Frame, PrecreaseError> {
        let [x0, y0, x1, y1] = rect;
        if rect.iter().any(|v| !v.is_finite()) || x1 <= x0 || y1 <= y0 {
            return Err(PrecreaseError::InvalidPaperFallback);
        }
        Frame::new([x0, y1], [1.0, 0.0], x1 - x0, y1 - y0)
    }

    /// Length of the longer side in model units: the unit-rectangle scale.
    pub fn longer(&self) -> f64 {
        self.width.max(self.height)
    }

    /// ReferenceFinder's `(w, h)`: sides divided by the longer one.
    pub fn rf_rect(&self) -> RfRect {
        let longer = self.longer();
        RfRect {
            width: self.width / longer,
            height: self.height / longer,
        }
    }

    /// Rotation of the frame's width edge from the model +x axis, radians.
    pub fn rotation_radians(&self) -> f64 {
        self.x_axis[1].atan2(self.x_axis[0])
    }

    /// Model point → sheet coordinates in model units (`[0, width] × [0, height]`).
    pub fn model_to_sheet(&self, p: [f64; 2]) -> [f64; 2] {
        let dx = p[0] - self.origin[0];
        let dy = p[1] - self.origin[1];
        [
            dx * self.x_axis[0] + dy * self.x_axis[1],
            dx * self.y_axis[0] + dy * self.y_axis[1],
        ]
    }

    /// Model point → unit rectangle (y-up, lower-left origin, longer side 1).
    pub fn model_to_unit(&self, p: [f64; 2]) -> [f64; 2] {
        let s = self.model_to_sheet(p);
        let longer = self.longer();
        [s[0] / longer, s[1] / longer]
    }

    /// Unit-rectangle point → model space.
    pub fn unit_to_model(&self, u: [f64; 2]) -> [f64; 2] {
        let longer = self.longer();
        let sx = u[0] * longer;
        let sy = u[1] * longer;
        [
            self.origin[0] + sx * self.x_axis[0] + sy * self.y_axis[0],
            self.origin[1] + sx * self.x_axis[1] + sy * self.y_axis[1],
        ]
    }

    /// Model point → ReferenceFinder rectangle. Identical to
    /// [`Self::model_to_unit`]: RF's paper *is* the unit rectangle.
    pub fn model_to_rf(&self, p: [f64; 2]) -> [f64; 2] {
        self.model_to_unit(p)
    }

    /// ReferenceFinder point → model space.
    pub fn rf_to_model(&self, p: [f64; 2]) -> [f64; 2] {
        self.unit_to_model(p)
    }

    /// The four maps as affine matrices.
    pub fn affines(&self) -> FrameAffines {
        let longer = self.longer();
        let [ox, oy] = self.origin;
        let [xx, xy] = self.x_axis;
        let [yx, yy] = self.y_axis;
        let model_to_unit: Affine = [
            xx / longer,
            yx / longer,
            xy / longer,
            yy / longer,
            -(ox * xx + oy * xy) / longer,
            -(ox * yx + oy * yy) / longer,
        ];
        let unit_to_model: Affine = [longer * xx, longer * xy, longer * yx, longer * yy, ox, oy];
        FrameAffines {
            model_to_unit,
            unit_to_model,
            model_to_rf: model_to_unit,
            rf_to_model: unit_to_model,
        }
    }

    /// Whether a unit-rectangle point lies inside the sheet padded by `pad`.
    pub fn unit_contains(&self, u: [f64; 2], pad: f64) -> bool {
        let rect = self.rf_rect();
        u[0] >= -pad && u[0] <= rect.width + pad && u[1] >= -pad && u[1] <= rect.height + pad
    }

    /// Whether a model point lies inside the sheet padded by `pad` (unit units).
    pub fn contains_model(&self, p: [f64; 2], pad: f64) -> bool {
        self.unit_contains(self.model_to_unit(p), pad)
    }

    /// The sheet's four edge lines in unit coordinates: `x = 0`, `x = w`,
    /// `y = 0`, `y = h`.
    pub fn edge_lines(&self) -> [Line; 4] {
        let rect = self.rf_rect();
        // Unit normals are exact, so these constructors cannot fail; the
        // fallbacks are unreachable but keep the function total.
        let fallback = Line {
            n: [1.0, 0.0],
            d: 0.0,
        };
        [
            Line::new([1.0, 0.0], 0.0).unwrap_or(fallback),
            Line::new([1.0, 0.0], rect.width).unwrap_or(fallback),
            Line::new([0.0, 1.0], 0.0).unwrap_or(fallback),
            Line::new([0.0, 1.0], rect.height).unwrap_or(fallback),
        ]
    }

    /// Whether a unit-space line coincides with one of the sheet edges.
    pub fn is_edge_line(&self, line: &Line) -> bool {
        self.edge_lines()
            .iter()
            .any(|e| e.approx_eq_within(line, TOL))
    }
}

/// Apply an affine `[a, b, c, d, e, f]` to a point.
pub fn apply_affine(m: &Affine, p: [f64; 2]) -> [f64; 2] {
    [
        m[0] * p[0] + m[2] * p[1] + m[4],
        m[1] * p[0] + m[3] * p[1] + m[5],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: [f64; 2], b: [f64; 2]) -> bool {
        (a[0] - b[0]).abs() < 1e-12 && (a[1] - b[1]).abs() < 1e-12
    }

    #[test]
    fn axis_aligned_frame_flips_y() {
        // Oriedita default paper: model (−200, 200) is the on-screen
        // bottom-left corner and must map to unit (0, 0); model (−200, −200)
        // is the top-left and maps to unit (0, 1).
        let f = Frame::axis_aligned([-200.0, -200.0, 200.0, 200.0]).expect("frame");
        assert!(close(f.model_to_unit([-200.0, 200.0]), [0.0, 0.0]));
        assert!(close(f.model_to_unit([200.0, 200.0]), [1.0, 0.0]));
        assert!(close(f.model_to_unit([-200.0, -200.0]), [0.0, 1.0]));
        assert!(close(f.model_to_unit([-100.0, 100.0]), [0.25, 0.25]));
        assert!(close(f.model_to_unit([-100.0, -100.0]), [0.25, 0.75]));
        assert!(close(f.unit_to_model([0.25, 0.75]), [-100.0, -100.0]));
        assert_eq!(
            f.rf_rect(),
            RfRect {
                width: 1.0,
                height: 1.0
            }
        );
    }

    #[test]
    fn affines_match_the_functions() {
        let f = Frame::new([37.0, -12.0], [3.0, 4.0], 250.0, 100.0).expect("frame");
        let a = f.affines();
        for p in [[0.0, 0.0], [37.0, -12.0], [100.0, 50.0], [-300.0, 1e3]] {
            assert!(close(apply_affine(&a.model_to_unit, p), f.model_to_unit(p)));
            assert!(close(apply_affine(&a.model_to_rf, p), f.model_to_rf(p)));
            let u = f.model_to_unit(p);
            assert!(close(apply_affine(&a.unit_to_model, u), p));
            assert!(close(apply_affine(&a.rf_to_model, u), p));
        }
        let r = f.rf_rect();
        assert!((r.width - 1.0).abs() < 1e-15 && (r.height - 0.4).abs() < 1e-15);
        assert!((f.rotation_radians() - (4.0f64).atan2(3.0)).abs() < 1e-15);
    }

    #[test]
    fn edge_lines_bound_the_unit_rectangle() {
        let f = Frame::new([0.0, 0.0], [1.0, 0.0], 336.0, 400.0).expect("frame");
        let r = f.rf_rect();
        assert!((r.width - 0.84).abs() < 1e-15 && (r.height - 1.0).abs() < 1e-15);
        let edges = f.edge_lines();
        assert!(edges[1].distance_to_point([0.84, 0.3]) < 1e-15);
        assert!(f.is_edge_line(&Line::new([0.0, 1.0], 1.0).expect("line")));
        assert!(!f.is_edge_line(&Line::new([0.0, 1.0], 0.5).expect("line")));
        assert!(f.unit_contains([0.84 + 5e-7, 0.5], TOL));
        assert!(!f.unit_contains([0.84 + 5e-6, 0.5], TOL));
    }

    #[test]
    fn degenerate_frames_are_errors() {
        assert!(Frame::new([0.0, 0.0], [0.0, 0.0], 1.0, 1.0).is_err());
        assert!(Frame::new([0.0, 0.0], [1.0, 0.0], 0.0, 1.0).is_err());
        assert!(Frame::axis_aligned([0.0, 0.0, 0.0, 1.0]).is_err());
        assert!(Frame::axis_aligned([0.0, 0.0, f64::NAN, 1.0]).is_err());
    }
}
