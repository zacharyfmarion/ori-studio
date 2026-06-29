//! Shared vertex-refiner geometry.
//!
//! Faithful Rust port of the geometry in
//! `apps/web/src/lib/vertexRefinerPipeline.ts` so that the product (via wasm) and
//! the benchmark share a single implementation. Only the ONNX/Torch forward pass
//! lives outside this module.
//!
//! Fidelity rules (match the TS exactly):
//! - feature/tensor maps are stored as `f32` (TS `Float32Array`); arithmetic runs
//!   in `f64` and truncates on store (`as f32`), and reads widen `f32 -> f64`.
//! - `js_round` reproduces JavaScript `Math.round` = `floor(x + 0.5)` (rounds half
//!   toward +infinity, unlike Rust's `f64::round` which rounds half away from zero).

pub mod features;

pub use features::{SourceFeatures, build_source_features};

/// Paper frame in pixel coordinates (mirrors `CpDetectPaperFrame`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Frame {
    pub x_min: f64,
    pub y_min: f64,
    pub x_max: f64,
    pub y_max: f64,
}

impl Frame {
    /// `fullImageFrame(width, height)` -> `{0, 0, width-1, height-1}`.
    pub fn full_image(width: usize, height: usize) -> Self {
        Self {
            x_min: 0.0,
            y_min: 0.0,
            x_max: (width as f64) - 1.0,
            y_max: (height as f64) - 1.0,
        }
    }
}

/// TS `clamp(value, min, max)` = `Math.min(max, Math.max(min, value))`.
#[inline]
pub(crate) fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

/// TS `clamp01`.
#[inline]
pub(crate) fn clamp01(value: f64) -> f64 {
    clamp(value, 0.0, 1.0)
}

/// JavaScript `Math.round`: `floor(x + 0.5)` (half rounds toward +infinity).
#[inline]
pub(crate) fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// TS `clampInt(value, min, max)` = `Math.round(clamp(value, min, max))`.
#[inline]
pub(crate) fn clamp_int(value: f64, min: f64, max: f64) -> f64 {
    js_round(clamp(value, min, max))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_round_matches_javascript_half_toward_positive_infinity() {
        assert_eq!(js_round(0.5), 1.0);
        assert_eq!(js_round(1.5), 2.0);
        assert_eq!(js_round(2.5), 3.0);
        // JS Math.round(-0.5) === 0 (not -1 like Rust's f64::round).
        assert_eq!(js_round(-0.5), 0.0);
        assert_eq!(js_round(-1.5), -1.0);
        assert_eq!(js_round(2.4), 2.0);
    }

    #[test]
    fn clamp_matches_ts_semantics() {
        assert_eq!(clamp(5.0, 0.0, 1.0), 1.0);
        assert_eq!(clamp(-5.0, 0.0, 1.0), 0.0);
        assert_eq!(clamp(0.3, 0.0, 1.0), 0.3);
        assert_eq!(clamp_int(2.6, 0.0, 10.0), 3.0);
        assert_eq!(clamp_int(-1.0, 0.0, 10.0), 0.0);
    }

    #[test]
    fn full_image_frame_is_zero_to_size_minus_one() {
        let frame = Frame::full_image(1024, 1024);
        assert_eq!(frame.x_min, 0.0);
        assert_eq!(frame.x_max, 1023.0);
        assert_eq!(frame.y_max, 1023.0);
    }
}
