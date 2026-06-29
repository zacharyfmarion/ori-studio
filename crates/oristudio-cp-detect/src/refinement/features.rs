//! Source-feature extraction, ported from `buildVertexRefinerSourceFeatures`
//! (and its helpers) in `apps/web/src/lib/vertexRefinerPipeline.ts`.
//!
//! Produces the 9 image-derived channels of the refiner crop tensor (the two
//! normalized coordinate-grid channels are added later in `crop_tensor`). All
//! maps are row-major (`y * width + x`), stored `f32`, computed in `f64`.

use super::{Frame, clamp, clamp_int, clamp01, js_round};

/// The 9 image-derived feature maps (mirrors `VertexRefinerSourceFeatures`).
#[derive(Debug, Clone)]
pub struct SourceFeatures {
    pub width: usize,
    pub height: usize,
    pub frame: Frame,
    pub image_gray: Vec<f32>,
    pub source_ink_probability: Vec<f32>,
    pub source_distance_to_ink: Vec<f32>,
    pub source_orientation_cos2: Vec<f32>,
    pub source_orientation_sin2: Vec<f32>,
    pub signed_distance_to_frame: Vec<f32>,
    pub frame_edge_mask: Vec<f32>,
    pub inside_paper_mask: Vec<f32>,
    pub boundary_contact_prior: Vec<f32>,
}

/// `buildVertexRefinerSourceFeatures(image, { cropSize, frame })`.
///
/// `image_rgba` is row-major RGBA (`width * height * 4` bytes).
pub fn build_source_features(
    image_rgba: &[u8],
    width: usize,
    height: usize,
    crop_size: f64,
    frame: Frame,
) -> SourceFeatures {
    let pixel_count = width * height;
    let mut gray = vec![0f32; pixel_count];
    let mut chroma = vec![0f32; pixel_count];
    for index in 0..pixel_count {
        let rgba = index * 4;
        let alpha = image_rgba[rgba + 3] as f64 / 255.0;
        let red = composite_over_white(image_rgba[rgba] as f64, alpha);
        let green = composite_over_white(image_rgba[rgba + 1] as f64, alpha);
        let blue = composite_over_white(image_rgba[rgba + 2] as f64, alpha);
        gray[index] = (0.299 * red + 0.587 * green + 0.114 * blue) as f32;
        chroma[index] = (red.max(green).max(blue) - red.min(green).min(blue)) as f32;
    }

    let median_gray = percentile(&gray, 0.5);
    let mut contrast = vec![0f32; pixel_count];
    for index in 0..pixel_count {
        contrast[index] = (gray[index] as f64 - median_gray).abs() as f32;
    }
    let contrast_scale = percentile(&contrast, 0.98).max(1e-3);
    let chroma_scale = percentile(&chroma, 0.98).max(1e-3);
    let mut ink = vec![0f32; pixel_count];
    for index in 0..pixel_count {
        ink[index] = clamp01(
            (contrast[index] as f64 / contrast_scale).max(chroma[index] as f64 / chroma_scale),
        ) as f32;
    }
    let blurred_ink = gaussian3x3(&ink, width, height);
    for index in 0..pixel_count {
        ink[index] = (ink[index] as f64).max(blurred_ink[index] as f64) as f32;
    }

    let distance = distance_to_ink_map(&ink, width, height, crop_size);
    let (orientation_cos2, orientation_sin2) = source_orientation_channels(&ink, width, height);
    let (signed_distance_to_frame, frame_edge_mask, inside_paper_mask, boundary_contact_prior) =
        build_frame_feature_maps(&ink, width, height, frame, crop_size);

    SourceFeatures {
        width,
        height,
        frame,
        image_gray: gray,
        source_ink_probability: ink,
        source_distance_to_ink: distance,
        source_orientation_cos2: orientation_cos2,
        source_orientation_sin2: orientation_sin2,
        signed_distance_to_frame,
        frame_edge_mask,
        inside_paper_mask,
        boundary_contact_prior,
    }
}

/// `compositeOverWhite(channel, alpha)`.
#[inline]
fn composite_over_white(channel: f64, alpha: f64) -> f64 {
    (channel * alpha + 255.0 * (1.0 - alpha)) / 255.0
}

/// `percentile(values, p)` over an `f32` map. Values are widened to `f64` (as JS
/// reads `Float32Array` elements), sorted ascending, indexed by
/// `round((len-1) * clamp(p,0,1))`.
pub(crate) fn percentile(values: &[f32], p: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut copy: Vec<f64> = values.iter().map(|&v| v as f64).collect();
    copy.sort_by(|a, b| a.total_cmp(b));
    let index = js_round((copy.len() as f64 - 1.0) * clamp(p, 0.0, 1.0)) as usize;
    copy.get(index).copied().unwrap_or(0.0)
}

/// Separable-free `3x3` `[1,2,1]x[1,2,1]/16` blur with clamped borders.
pub(crate) fn gaussian3x3(values: &[f32], width: usize, height: usize) -> Vec<f32> {
    let mut output = vec![0f32; values.len()];
    for y in 0..height {
        for x in 0..width {
            let mut sum = 0f64;
            let mut weight = 0f64;
            for dy in -1i64..=1 {
                for dx in -1i64..=1 {
                    let xx = clamp_int(x as f64 + dx as f64, 0.0, (width - 1) as f64) as usize;
                    let yy = clamp_int(y as f64 + dy as f64, 0.0, (height - 1) as f64) as usize;
                    let w = (if dx == 0 { 2.0 } else { 1.0 }) * (if dy == 0 { 2.0 } else { 1.0 });
                    sum += values[yy * width + xx] as f64 * w;
                    weight += w;
                }
            }
            output[y * width + x] = (sum / weight) as f32;
        }
    }
    output
}

/// `distanceToInkMap`: two-pass chamfer distance to ink (>= 0.2), normalized by
/// `cropSize` and capped at 1.
fn distance_to_ink_map(ink: &[f32], width: usize, height: usize, crop_size: f64) -> Vec<f32> {
    let mut distance = vec![0f32; ink.len()];
    let max_distance = 1e6f64;
    let mut has_ink = false;
    for index in 0..ink.len() {
        if ink[index] as f64 >= 0.2 {
            distance[index] = 0.0;
            has_ink = true;
        } else {
            distance[index] = max_distance as f32;
        }
    }
    if !has_ink {
        distance.iter_mut().for_each(|d| *d = 1.0);
        return distance;
    }
    let diag = std::f64::consts::SQRT_2;
    for y in 0..height {
        for x in 0..width {
            let idx = y * width + x;
            let mut best = distance[idx] as f64;
            if x > 0 {
                best = best.min(distance[idx - 1] as f64 + 1.0);
            }
            if y > 0 {
                best = best.min(distance[idx - width] as f64 + 1.0);
            }
            if x > 0 && y > 0 {
                best = best.min(distance[idx - width - 1] as f64 + diag);
            }
            if x + 1 < width && y > 0 {
                best = best.min(distance[idx - width + 1] as f64 + diag);
            }
            distance[idx] = best as f32;
        }
    }
    for y in (0..height).rev() {
        for x in (0..width).rev() {
            let idx = y * width + x;
            let mut best = distance[idx] as f64;
            if x + 1 < width {
                best = best.min(distance[idx + 1] as f64 + 1.0);
            }
            if y + 1 < height {
                best = best.min(distance[idx + width] as f64 + 1.0);
            }
            if x + 1 < width && y + 1 < height {
                best = best.min(distance[idx + width + 1] as f64 + diag);
            }
            if x > 0 && y + 1 < height {
                best = best.min(distance[idx + width - 1] as f64 + diag);
            }
            distance[idx] = (1f64).min(best / crop_size.max(1.0)) as f32;
        }
    }
    distance
}

/// `sourceOrientationChannels`: doubled-angle orientation of the smoothed ink
/// gradient, gated by ink support.
fn source_orientation_channels(ink: &[f32], width: usize, height: usize) -> (Vec<f32>, Vec<f32>) {
    let smooth = gaussian3x3(ink, width, height);
    let mut cos2 = vec![0f32; ink.len()];
    let mut sin2 = vec![0f32; ink.len()];
    for y in 0..height {
        for x in 0..width {
            let left = smooth
                [y * width + clamp_int(x as f64 - 1.0, 0.0, (width - 1) as f64) as usize]
                as f64;
            let right = smooth
                [y * width + clamp_int(x as f64 + 1.0, 0.0, (width - 1) as f64) as usize]
                as f64;
            let top = smooth
                [clamp_int(y as f64 - 1.0, 0.0, (height - 1) as f64) as usize * width + x]
                as f64;
            let bottom = smooth
                [clamp_int(y as f64 + 1.0, 0.0, (height - 1) as f64) as usize * width + x]
                as f64;
            let tangent = (bottom - top).atan2(right - left) + std::f64::consts::FRAC_PI_2;
            let support = if ink[y * width + x] as f64 >= 0.15 {
                1.0
            } else {
                0.0
            };
            cos2[y * width + x] = ((2.0 * tangent).cos() * support) as f32;
            sin2[y * width + x] = ((2.0 * tangent).sin() * support) as f32;
        }
    }
    (cos2, sin2)
}

/// `buildFrameFeatureMaps`: signed distance to frame, edge mask, inside-paper
/// mask, and boundary-contact prior.
fn build_frame_feature_maps(
    ink: &[f32],
    width: usize,
    height: usize,
    frame: Frame,
    crop_size: f64,
) -> (Vec<f32>, Vec<f32>, Vec<f32>, Vec<f32>) {
    let mut signed = vec![0f32; ink.len()];
    let mut edge_mask = vec![0f32; ink.len()];
    let mut inside_mask = vec![0f32; ink.len()];
    let mut boundary_prior = vec![0f32; ink.len()];
    for y in 0..height {
        for x in 0..width {
            let idx = y * width + x;
            let xf = x as f64;
            let yf = y as f64;
            let inside =
                xf >= frame.x_min && xf <= frame.x_max && yf >= frame.y_min && yf <= frame.y_max;
            inside_mask[idx] = if inside { 1.0 } else { 0.0 };
            let inside_distance = (xf - frame.x_min)
                .min(frame.x_max - xf)
                .min(yf - frame.y_min)
                .min(frame.y_max - yf);
            let outside_dx = (frame.x_min - xf).max(xf - frame.x_max).max(0.0);
            let outside_dy = (frame.y_min - yf).max(yf - frame.y_max).max(0.0);
            let outside_distance = outside_dx.hypot(outside_dy);
            signed[idx] = clamp(
                (if inside {
                    inside_distance
                } else {
                    -outside_distance
                }) / crop_size.max(1.0),
                -1.0,
                1.0,
            ) as f32;
            let edge = in_frame_band(xf, yf, frame, 1.5);
            let contact = in_frame_band(xf, yf, frame, 3.0);
            edge_mask[idx] = if edge { 1.0 } else { 0.0 };
            boundary_prior[idx] = if contact { ink[idx] } else { 0.0 };
        }
    }
    (signed, edge_mask, inside_mask, boundary_prior)
}

/// `inFrameBand(x, y, frame, band)`.
fn in_frame_band(x: f64, y: f64, frame: Frame, band: f64) -> bool {
    let horizontal_span = x >= frame.x_min - band && x <= frame.x_max + band;
    let vertical_span = y >= frame.y_min - band && y <= frame.y_max + band;
    // Equivalent to the TS `(|y-ymin|<=band && hspan) || (|y-ymax|<=band && hspan)
    // || (|x-xmin|<=band && vspan) || (|x-xmax|<=band && vspan)`, factored to keep
    // clippy quiet (operands are pure and finite, so the result is identical).
    (horizontal_span && ((y - frame.y_min).abs() <= band || (y - frame.y_max).abs() <= band))
        || (vertical_span && ((x - frame.x_min).abs() <= band || (x - frame.x_max).abs() <= band))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composite_over_white_blends_toward_white_with_alpha() {
        assert_eq!(composite_over_white(255.0, 1.0), 1.0);
        assert_eq!(composite_over_white(0.0, 1.0), 0.0);
        // Fully transparent -> white regardless of channel.
        assert_eq!(composite_over_white(0.0, 0.0), 1.0);
        // channel 128 at alpha 0.5 -> (64 + 127.5) / 255.
        let v = composite_over_white(128.0, 0.5);
        assert!((v - (191.5 / 255.0)).abs() < 1e-12);
    }

    #[test]
    fn percentile_indexes_like_ts() {
        // len 4, p=0.5 -> idx round(3 * 0.5) = round(1.5) = 2 -> sorted[2] = 3.
        let values = [4.0f32, 1.0, 3.0, 2.0];
        assert_eq!(percentile(&values, 0.5), 3.0);
        // p=0 -> min, p=1 -> max.
        assert_eq!(percentile(&values, 0.0), 1.0);
        assert_eq!(percentile(&values, 1.0), 4.0);
        assert_eq!(percentile(&[], 0.5), 0.0);
    }

    #[test]
    fn gaussian3x3_preserves_uniform_field() {
        let values = vec![0.5f32; 9];
        let blurred = gaussian3x3(&values, 3, 3);
        for v in blurred {
            assert!((v - 0.5).abs() < 1e-6);
        }
    }

    #[test]
    fn distance_to_ink_map_is_zero_at_ink_and_grows_outward() {
        // 5x1 row, single ink pixel in the center.
        let ink = [0.0f32, 0.0, 1.0, 0.0, 0.0];
        let crop_size = 100.0;
        let distance = distance_to_ink_map(&ink, 5, 1, crop_size);
        assert_eq!(distance[2], 0.0);
        // Neighbors are 1px away -> 1/100.
        assert!((distance[1] as f64 - 1.0 / 100.0).abs() < 1e-6);
        assert!((distance[3] as f64 - 1.0 / 100.0).abs() < 1e-6);
        // The backward pass normalizes in place (faithful to the TS), so the
        // far-left pixel reads its already-normalized neighbor (0.01) as raw and
        // adds 1: (0.01 + 1) / 100 ~= 0.0101 (not the "true" chamfer 0.02).
        assert!((distance[0] as f64 - 0.0101).abs() < 1e-6);
        // No ink anywhere -> filled with 1.
        let blank = distance_to_ink_map(&[0.0f32; 4], 2, 2, crop_size);
        assert_eq!(blank, vec![1.0f32; 4]);
    }
}
