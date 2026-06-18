//! Dense-free raster evidence extraction.
//!
//! This module converts a rectified crease-pattern image into deterministic
//! image-space evidence without reading model dense heads. Later raster
//! candidate-generation strategies consume this evidence and still emit the
//! shared compiler `CandidateGraph` IR.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

pub const RASTER_EVIDENCE_SCHEMA: &str = "oristudio/cp-detect-raster-evidence/v1";

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RasterEvidenceConfig {
    pub image_size: u32,
    pub line_threshold: f32,
    pub adaptive_radius_px: u32,
    pub local_contrast_gain: f32,
    pub global_contrast_gain: f32,
    pub chroma_gain: f32,
    pub min_reported_component_px: usize,
}

impl Default for RasterEvidenceConfig {
    fn default() -> Self {
        Self {
            image_size: crate::DEFAULT_IMAGE_SIZE,
            line_threshold: 0.22,
            adaptive_radius_px: 7,
            local_contrast_gain: 4.0,
            global_contrast_gain: 0.85,
            chroma_gain: 0.70,
            min_reported_component_px: 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RasterEvidence {
    pub schema: String,
    pub image_size: u32,
    pub luma: Vec<f32>,
    pub local_contrast: Vec<f32>,
    pub line_probability: Vec<f32>,
    pub line_mask: Vec<u8>,
    /// Line tangent orientation in radians, normalized to [0, pi). Pixels with
    /// no useful gradient receive 0.
    pub orientation: Vec<f32>,
    pub report: RasterEvidenceReport,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RasterEvidenceReport {
    pub schema: String,
    pub image_size: u32,
    pub line_threshold: f32,
    pub adaptive_radius_px: u32,
    pub foreground_pixels: usize,
    pub foreground_density: f32,
    pub connected_components: usize,
    pub largest_component_pixels: usize,
    pub mean_luma: f32,
    pub mean_line_probability: f32,
    pub max_line_probability: f32,
}

#[derive(Debug, thiserror::Error)]
pub enum RasterEvidenceError {
    #[error("invalid raster image dimensions: {width}x{height}")]
    InvalidDimensions { width: u32, height: u32 },
    #[error("raster image size mismatch: config expected {expected}, got {actual}")]
    ImageSizeMismatch { expected: u32, actual: u32 },
    #[error("RGBA length mismatch: expected {expected}, got {actual}")]
    RgbaLengthMismatch { expected: usize, actual: usize },
    #[error("RGB length mismatch: expected {expected}, got {actual}")]
    RgbLengthMismatch { expected: usize, actual: usize },
}

pub fn extract_raster_evidence_from_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    config: RasterEvidenceConfig,
) -> Result<RasterEvidence, RasterEvidenceError> {
    validate_dimensions(width, height, config)?;
    let pixels = pixel_count(width, height);
    let expected = pixels * 4;
    if rgba.len() != expected {
        return Err(RasterEvidenceError::RgbaLengthMismatch {
            expected,
            actual: rgba.len(),
        });
    }
    let mut luma = Vec::with_capacity(pixels);
    let mut chroma = Vec::with_capacity(pixels);
    for px in rgba.chunks_exact(4) {
        let alpha = px[3] as f32 / 255.0;
        let r = blend_over_white(px[0], alpha);
        let g = blend_over_white(px[1], alpha);
        let b = blend_over_white(px[2], alpha);
        luma.push(rgb_luma(r, g, b));
        chroma.push(rgb_chroma(r, g, b));
    }
    evidence_from_luma_chroma(luma, chroma, config)
}

pub fn extract_raster_evidence_from_rgb(
    rgb: &[u8],
    width: u32,
    height: u32,
    config: RasterEvidenceConfig,
) -> Result<RasterEvidence, RasterEvidenceError> {
    validate_dimensions(width, height, config)?;
    let pixels = pixel_count(width, height);
    let expected = pixels * 3;
    if rgb.len() != expected {
        return Err(RasterEvidenceError::RgbLengthMismatch {
            expected,
            actual: rgb.len(),
        });
    }
    let mut luma = Vec::with_capacity(pixels);
    let mut chroma = Vec::with_capacity(pixels);
    for px in rgb.chunks_exact(3) {
        let r = px[0] as f32 / 255.0;
        let g = px[1] as f32 / 255.0;
        let b = px[2] as f32 / 255.0;
        luma.push(rgb_luma(r, g, b));
        chroma.push(rgb_chroma(r, g, b));
    }
    evidence_from_luma_chroma(luma, chroma, config)
}

fn evidence_from_luma_chroma(
    luma: Vec<f32>,
    chroma: Vec<f32>,
    config: RasterEvidenceConfig,
) -> Result<RasterEvidence, RasterEvidenceError> {
    let size = config.image_size as usize;
    let mean_luma = mean(&luma);
    let local_mean = local_mean_map(&luma, size, config.adaptive_radius_px as usize);
    let mut local_contrast = Vec::with_capacity(luma.len());
    let mut line_probability = Vec::with_capacity(luma.len());
    let mut line_mask = Vec::with_capacity(luma.len());
    let mut foreground_pixels = 0usize;
    let mut probability_sum = 0.0f32;
    let mut max_line_probability = 0.0f32;

    for idx in 0..luma.len() {
        let contrast = (luma[idx] - local_mean[idx]).abs();
        local_contrast.push(contrast);

        let adaptive_score = contrast * config.local_contrast_gain;
        let global_score = if mean_luma >= 0.5 {
            (1.0 - luma[idx]) * config.global_contrast_gain
        } else {
            luma[idx] * config.global_contrast_gain
        };
        let chroma_score = chroma[idx] * config.chroma_gain;
        let probability = adaptive_score
            .max(global_score)
            .max(chroma_score)
            .clamp(0.0, 1.0);
        if probability >= config.line_threshold {
            line_mask.push(255);
            foreground_pixels += 1;
        } else {
            line_mask.push(0);
        }
        probability_sum += probability;
        max_line_probability = max_line_probability.max(probability);
        line_probability.push(probability);
    }

    let components =
        connected_component_summary(&line_mask, size, size, config.min_reported_component_px);
    let orientation = orientation_map(&luma, size);
    let foreground_density = foreground_pixels as f32 / luma.len().max(1) as f32;
    let mean_line_probability = probability_sum / luma.len().max(1) as f32;
    Ok(RasterEvidence {
        schema: RASTER_EVIDENCE_SCHEMA.to_owned(),
        image_size: config.image_size,
        luma,
        local_contrast,
        line_probability,
        line_mask,
        orientation,
        report: RasterEvidenceReport {
            schema: RASTER_EVIDENCE_SCHEMA.to_owned(),
            image_size: config.image_size,
            line_threshold: config.line_threshold,
            adaptive_radius_px: config.adaptive_radius_px,
            foreground_pixels,
            foreground_density,
            connected_components: components.count,
            largest_component_pixels: components.largest,
            mean_luma,
            mean_line_probability,
            max_line_probability,
        },
    })
}

fn validate_dimensions(
    width: u32,
    height: u32,
    config: RasterEvidenceConfig,
) -> Result<(), RasterEvidenceError> {
    if width == 0 || height == 0 || width != height {
        return Err(RasterEvidenceError::InvalidDimensions { width, height });
    }
    if width != config.image_size {
        return Err(RasterEvidenceError::ImageSizeMismatch {
            expected: config.image_size,
            actual: width,
        });
    }
    Ok(())
}

fn pixel_count(width: u32, height: u32) -> usize {
    width as usize * height as usize
}

fn blend_over_white(channel: u8, alpha: f32) -> f32 {
    channel as f32 / 255.0 * alpha + (1.0 - alpha)
}

fn rgb_luma(r: f32, g: f32, b: f32) -> f32 {
    (0.2126 * r + 0.7152 * g + 0.0722 * b).clamp(0.0, 1.0)
}

fn rgb_chroma(r: f32, g: f32, b: f32) -> f32 {
    r.max(g).max(b) - r.min(g).min(b)
}

fn mean(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f32>() / values.len() as f32
}

fn local_mean_map(values: &[f32], size: usize, radius: usize) -> Vec<f32> {
    let integral = integral_image(values, size, size);
    let mut means = vec![0.0; values.len()];
    for y in 0..size {
        for x in 0..size {
            let x0 = x.saturating_sub(radius);
            let y0 = y.saturating_sub(radius);
            let x1 = (x + radius + 1).min(size);
            let y1 = (y + radius + 1).min(size);
            let sum = integral_sum(&integral, size, x0, y0, x1, y1);
            let area = (x1 - x0) * (y1 - y0);
            means[y * size + x] = sum / area.max(1) as f32;
        }
    }
    means
}

fn integral_image(values: &[f32], width: usize, height: usize) -> Vec<f32> {
    let stride = width + 1;
    let mut integral = vec![0.0; (width + 1) * (height + 1)];
    for y in 0..height {
        let mut row_sum = 0.0;
        for x in 0..width {
            row_sum += values[y * width + x];
            integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row_sum;
        }
    }
    integral
}

fn integral_sum(
    integral: &[f32],
    image_width: usize,
    x0: usize,
    y0: usize,
    x1: usize,
    y1: usize,
) -> f32 {
    let stride = image_width + 1;
    integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0]
        + integral[y0 * stride + x0]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ComponentSummary {
    count: usize,
    largest: usize,
}

fn connected_component_summary(
    mask: &[u8],
    width: usize,
    height: usize,
    min_reported_component_px: usize,
) -> ComponentSummary {
    let mut visited = vec![false; mask.len()];
    let mut count = 0usize;
    let mut largest = 0usize;
    let mut queue = VecDeque::new();
    for start in 0..mask.len() {
        if visited[start] || mask[start] == 0 {
            continue;
        }
        visited[start] = true;
        queue.push_back(start);
        let mut component_size = 0usize;
        while let Some(idx) = queue.pop_front() {
            component_size += 1;
            let x = idx % width;
            let y = idx / width;
            for (nx, ny) in neighbors8(x, y, width, height) {
                let nidx = ny * width + nx;
                if !visited[nidx] && mask[nidx] > 0 {
                    visited[nidx] = true;
                    queue.push_back(nidx);
                }
            }
        }
        largest = largest.max(component_size);
        if component_size >= min_reported_component_px {
            count += 1;
        }
    }
    ComponentSummary { count, largest }
}

fn neighbors8(x: usize, y: usize, width: usize, height: usize) -> Vec<(usize, usize)> {
    let mut neighbors = Vec::with_capacity(8);
    let x0 = x.saturating_sub(1);
    let y0 = y.saturating_sub(1);
    let x1 = (x + 1).min(width.saturating_sub(1));
    let y1 = (y + 1).min(height.saturating_sub(1));
    for ny in y0..=y1 {
        for nx in x0..=x1 {
            if nx != x || ny != y {
                neighbors.push((nx, ny));
            }
        }
    }
    neighbors
}

fn orientation_map(luma: &[f32], size: usize) -> Vec<f32> {
    let mut orientation = vec![0.0; luma.len()];
    for y in 0..size {
        for x in 0..size {
            let gx = -sample_luma(luma, size, x as isize - 1, y as isize - 1)
                + sample_luma(luma, size, x as isize + 1, y as isize - 1)
                - 2.0 * sample_luma(luma, size, x as isize - 1, y as isize)
                + 2.0 * sample_luma(luma, size, x as isize + 1, y as isize)
                - sample_luma(luma, size, x as isize - 1, y as isize + 1)
                + sample_luma(luma, size, x as isize + 1, y as isize + 1);
            let gy = -sample_luma(luma, size, x as isize - 1, y as isize - 1)
                - 2.0 * sample_luma(luma, size, x as isize, y as isize - 1)
                - sample_luma(luma, size, x as isize + 1, y as isize - 1)
                + sample_luma(luma, size, x as isize - 1, y as isize + 1)
                + 2.0 * sample_luma(luma, size, x as isize, y as isize + 1)
                + sample_luma(luma, size, x as isize + 1, y as isize + 1);
            if gx.abs() + gy.abs() > 1e-5 {
                orientation[y * size + x] =
                    (gy.atan2(gx) + std::f32::consts::FRAC_PI_2).rem_euclid(std::f32::consts::PI);
            }
        }
    }
    orientation
}

fn sample_luma(luma: &[f32], size: usize, x: isize, y: isize) -> f32 {
    let x = x.clamp(0, size.saturating_sub(1) as isize) as usize;
    let y = y.clamp(0, size.saturating_sub(1) as isize) as usize;
    luma[y * size + x]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_black_line_on_light_background() {
        let size = 32u32;
        let mut rgba = solid_rgba(size, [255, 255, 255, 255]);
        for i in 4..28 {
            set_rgba(&mut rgba, size, i, i, [0, 0, 0, 255]);
        }

        let evidence = extract_raster_evidence_from_rgba(
            &rgba,
            size,
            size,
            RasterEvidenceConfig {
                image_size: size,
                ..RasterEvidenceConfig::default()
            },
        )
        .expect("raster evidence");

        assert!(evidence.report.foreground_pixels >= 24);
        assert_eq!(evidence.report.connected_components, 1);
        assert!(evidence.line_probability[(16 * size + 16) as usize] > 0.75);
        assert!(evidence.line_probability[(2 * size + 2) as usize] < 0.25);
    }

    #[test]
    fn extracts_light_line_on_dark_background() {
        let size = 32u32;
        let mut rgba = solid_rgba(size, [16, 16, 18, 255]);
        for x in 3..29 {
            set_rgba(&mut rgba, size, x, 15, [245, 245, 245, 255]);
        }

        let evidence = extract_raster_evidence_from_rgba(
            &rgba,
            size,
            size,
            RasterEvidenceConfig {
                image_size: size,
                ..RasterEvidenceConfig::default()
            },
        )
        .expect("raster evidence");

        assert!(evidence.report.foreground_pixels >= 26);
        assert!(evidence.line_probability[(15 * size + 16) as usize] > 0.75);
        assert!(evidence.line_probability[(2 * size + 2) as usize] < 0.25);
    }

    #[test]
    fn blank_image_reports_no_foreground() {
        let size = 24u32;
        let rgba = solid_rgba(size, [255, 255, 255, 255]);

        let evidence = extract_raster_evidence_from_rgba(
            &rgba,
            size,
            size,
            RasterEvidenceConfig {
                image_size: size,
                ..RasterEvidenceConfig::default()
            },
        )
        .expect("raster evidence");

        assert_eq!(evidence.report.foreground_pixels, 0);
        assert_eq!(evidence.report.connected_components, 0);
        assert_eq!(evidence.report.largest_component_pixels, 0);
    }

    #[test]
    fn rejects_mismatched_rgba_length() {
        let error = extract_raster_evidence_from_rgba(
            &[255; 7],
            2,
            2,
            RasterEvidenceConfig {
                image_size: 2,
                ..RasterEvidenceConfig::default()
            },
        )
        .expect_err("length mismatch");

        assert!(matches!(
            error,
            RasterEvidenceError::RgbaLengthMismatch {
                expected: 16,
                actual: 7
            }
        ));
    }

    fn solid_rgba(size: u32, color: [u8; 4]) -> Vec<u8> {
        let mut rgba = Vec::with_capacity(size as usize * size as usize * 4);
        for _ in 0..size as usize * size as usize {
            rgba.extend_from_slice(&color);
        }
        rgba
    }

    fn set_rgba(rgba: &mut [u8], size: u32, x: u32, y: u32, color: [u8; 4]) {
        let idx = ((y * size + x) * 4) as usize;
        rgba[idx..idx + 4].copy_from_slice(&color);
    }
}
