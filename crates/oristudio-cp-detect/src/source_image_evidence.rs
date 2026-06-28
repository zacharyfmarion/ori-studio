//! Line evidence extracted directly from rectified source pixels.
//!
//! This is intentionally simple and deterministic: estimate the paper
//! background color, measure per-pixel color distance from it, normalize by a
//! high percentile, then add a small tapered support band so sparse span
//! sampling does not miss one-pixel antialiased lines.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SourceImageLineEvidenceOptions {
    pub contrast_percentile: f32,
    pub minimum_contrast_scale: f32,
    pub gamma: f32,
    pub dilation_radius_px: usize,
}

impl Default for SourceImageLineEvidenceOptions {
    fn default() -> Self {
        Self {
            contrast_percentile: 0.99,
            minimum_contrast_scale: 0.18,
            gamma: 0.55,
            dilation_radius_px: 1,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SourceImageLineEvidenceError {
    #[error("invalid image size: {width}x{height}")]
    InvalidImageSize { width: u32, height: u32 },
    #[error("rgba length mismatch: expected {expected}, got {actual}")]
    RgbaLength { expected: usize, actual: usize },
}

pub fn line_probability_from_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    options: SourceImageLineEvidenceOptions,
) -> Result<Vec<f32>, SourceImageLineEvidenceError> {
    if width == 0 || height == 0 {
        return Err(SourceImageLineEvidenceError::InvalidImageSize { width, height });
    }
    let pixels = width as usize * height as usize;
    let expected = pixels * 4;
    if rgba.len() != expected {
        return Err(SourceImageLineEvidenceError::RgbaLength {
            expected,
            actual: rgba.len(),
        });
    }

    let rgb = composited_rgb(rgba);
    let background = median_background(&rgb);
    let contrast = rgb
        .iter()
        .map(|pixel| color_distance(*pixel, background))
        .collect::<Vec<_>>();
    let scale = percentile(&mut contrast.clone(), options.contrast_percentile)
        .max(options.minimum_contrast_scale)
        .max(1e-6);
    let gamma = options.gamma.max(1e-6);
    let probability = contrast
        .into_iter()
        .map(|value| (value / scale).clamp(0.0, 1.0).powf(gamma))
        .collect::<Vec<_>>();
    Ok(dilate(
        &probability,
        width as usize,
        height as usize,
        options.dilation_radius_px,
    ))
}

fn composited_rgb(rgba: &[u8]) -> Vec<[f32; 3]> {
    rgba.chunks_exact(4)
        .map(|pixel| {
            let alpha = pixel[3] as f32 / 255.0;
            [
                composite_over_white(pixel[0], alpha),
                composite_over_white(pixel[1], alpha),
                composite_over_white(pixel[2], alpha),
            ]
        })
        .collect()
}

fn composite_over_white(channel: u8, alpha: f32) -> f32 {
    (channel as f32 * alpha + 255.0 * (1.0 - alpha)) / 255.0
}

fn median_background(rgb: &[[f32; 3]]) -> [f32; 3] {
    [
        channel_percentile(rgb, 0, 0.5),
        channel_percentile(rgb, 1, 0.5),
        channel_percentile(rgb, 2, 0.5),
    ]
}

fn channel_percentile(rgb: &[[f32; 3]], channel: usize, p: f32) -> f32 {
    let mut values = rgb.iter().map(|pixel| pixel[channel]).collect::<Vec<_>>();
    percentile(&mut values, p)
}

fn percentile(values: &mut [f32], p: f32) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|left, right| left.total_cmp(right));
    let index = ((values.len() - 1) as f32 * p.clamp(0.0, 1.0)).round() as usize;
    values[index]
}

fn color_distance(pixel: [f32; 3], background: [f32; 3]) -> f32 {
    let dr = pixel[0] - background[0];
    let dg = pixel[1] - background[1];
    let db = pixel[2] - background[2];
    ((dr * dr + dg * dg + db * db) / 3.0).sqrt()
}

fn dilate(values: &[f32], width: usize, height: usize, radius: usize) -> Vec<f32> {
    if radius == 0 {
        return values.to_vec();
    }
    let mut output = vec![0.0; values.len()];
    let radius_f = radius as f32;
    let min_weight = 0.50_f32;
    for y in 0..height {
        for x in 0..width {
            let x0 = x.saturating_sub(radius);
            let y0 = y.saturating_sub(radius);
            let x1 = (x + radius).min(width - 1);
            let y1 = (y + radius).min(height - 1);
            let mut best = 0.0_f32;
            for yy in y0..=y1 {
                for xx in x0..=x1 {
                    let dx = xx.abs_diff(x) as f32;
                    let dy = yy.abs_diff(y) as f32;
                    let distance = (dx * dx + dy * dy).sqrt();
                    if distance > radius_f {
                        continue;
                    }
                    let weight = if distance <= 0.0 {
                        1.0
                    } else {
                        (1.0 - distance / (radius_f + 1.0)).max(min_weight)
                    };
                    best = best.max(values[yy * width + xx] * weight);
                }
            }
            output[y * width + x] = best;
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dark_line_on_white_background_becomes_line_probability() {
        let width = 8;
        let height = 8;
        let mut rgba = vec![255u8; width * height * 4];
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
        for y in 0..height {
            let idx = (y * width + 4) * 4;
            rgba[idx] = 0;
            rgba[idx + 1] = 0;
            rgba[idx + 2] = 0;
        }

        let map = line_probability_from_rgba(
            &rgba,
            width as u32,
            height as u32,
            SourceImageLineEvidenceOptions {
                dilation_radius_px: 0,
                ..SourceImageLineEvidenceOptions::default()
            },
        )
        .expect("line map");

        assert!(map[4] > 0.95);
        assert!(map[3] < 0.05);
    }

    #[test]
    fn colored_line_is_detected_by_color_distance() {
        let width = 8;
        let height = 8;
        let mut rgba = vec![255u8; width * height * 4];
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
        for x in 0..width {
            let idx = (4 * width + x) * 4;
            rgba[idx] = 220;
            rgba[idx + 1] = 20;
            rgba[idx + 2] = 30;
        }

        let map = line_probability_from_rgba(
            &rgba,
            width as u32,
            height as u32,
            SourceImageLineEvidenceOptions {
                dilation_radius_px: 0,
                ..SourceImageLineEvidenceOptions::default()
            },
        )
        .expect("line map");

        assert!(map[4 * width + 4] > 0.95);
        assert!(map[3 * width + 4] < 0.05);
    }

    #[test]
    fn faint_gray_line_gets_enough_default_support_for_selection() {
        let width = 8;
        let height = 8;
        let mut rgba = vec![255u8; width * height * 4];
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
        for y in 0..height {
            let idx = (y * width + 4) * 4;
            rgba[idx] = 220;
            rgba[idx + 1] = 220;
            rgba[idx + 2] = 220;
        }

        let map = line_probability_from_rgba(
            &rgba,
            width as u32,
            height as u32,
            SourceImageLineEvidenceOptions::default(),
        )
        .expect("line map");

        assert!(map[4] > 0.80);
        assert!(map[3] > 0.40);
        assert!(map[2] < 0.05);
    }
}
