use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const DEFAULT_BORDER_MARGIN_RATIO: f32 = 32.0 / 1024.0;
const MIN_PANEL_CONFIDENCE: f32 = 0.72;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

impl Point {
    fn lerp(self, other: Point, t: f32) -> Point {
        Point {
            x: self.x + (other.x - self.x) * t,
            y: self.y + (other.y - self.y) * t,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Quad {
    pub top_left: Point,
    pub top_right: Point,
    pub bottom_right: Point,
    pub bottom_left: Point,
}

impl Quad {
    pub fn frame(width: u32, height: u32) -> Quad {
        let max_x = width.saturating_sub(1) as f32;
        let max_y = height.saturating_sub(1) as f32;
        Quad {
            top_left: Point { x: 0.0, y: 0.0 },
            top_right: Point { x: max_x, y: 0.0 },
            bottom_right: Point { x: max_x, y: max_y },
            bottom_left: Point { x: 0.0, y: max_y },
        }
    }

    pub fn square(low: f32, high: f32) -> Quad {
        Quad {
            top_left: Point { x: low, y: low },
            top_right: Point { x: high, y: low },
            bottom_right: Point { x: high, y: high },
            bottom_left: Point { x: low, y: high },
        }
    }

    pub fn points(self) -> [Point; 4] {
        [
            self.top_left,
            self.top_right,
            self.bottom_right,
            self.bottom_left,
        ]
    }

    pub fn clipped(self, width: u32, height: u32) -> Quad {
        let max_x = width.saturating_sub(1) as f32;
        let max_y = height.saturating_sub(1) as f32;
        let clip = |point: Point| Point {
            x: point.x.clamp(0.0, max_x),
            y: point.y.clamp(0.0, max_y),
        };
        Quad {
            top_left: clip(self.top_left),
            top_right: clip(self.top_right),
            bottom_right: clip(self.bottom_right),
            bottom_left: clip(self.bottom_left),
        }
    }

    fn side_lengths(self) -> [f32; 4] {
        let p = self.points();
        [
            distance(p[0], p[1]),
            distance(p[1], p[2]),
            distance(p[2], p[3]),
            distance(p[3], p[0]),
        ]
    }

    fn mean_side(self) -> f32 {
        self.side_lengths().iter().sum::<f32>() / 4.0
    }

    fn area(self) -> f32 {
        let p = self.points();
        0.5 * ((0..4)
            .map(|idx| {
                let a = p[idx];
                let b = p[(idx + 1) % 4];
                a.x * b.y - b.x * a.y
            })
            .sum::<f32>())
        .abs()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RectificationWarning {
    pub code: String,
    pub message: String,
    pub severity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RectificationReport {
    pub original_width: u32,
    pub original_height: u32,
    pub image_size: u32,
    pub mode: String,
    pub confidence: f32,
    pub source_quad: Quad,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detected_source_quad: Option<Quad>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_quad: Option<Quad>,
    pub padding_rgb: [u8; 3],
    pub warnings: Vec<RectificationWarning>,
    pub metrics: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RectifiedRgbaImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub report: RectificationReport,
}

#[derive(Debug, thiserror::Error)]
pub enum RectificationError {
    #[error("invalid image dimensions: {width}x{height}")]
    InvalidDimensions { width: u32, height: u32 },
    #[error("rgba length mismatch: expected {expected}, got {actual}")]
    RgbaLengthMismatch { expected: usize, actual: usize },
    #[error("invalid manual quad: {0}")]
    InvalidQuad(&'static str),
    #[error("rectification homography could not be solved")]
    SingularHomography,
}

#[derive(Debug, Clone)]
struct ImageAnalysis {
    rgb: Vec<u8>,
    edges: Vec<bool>,
    width: usize,
    height: usize,
    padding_rgb: [u8; 3],
    edge_density: f32,
}

#[derive(Debug, Clone)]
struct PanelCandidate {
    quad: Quad,
    confidence: f32,
    method: &'static str,
    metrics: Value,
}

pub fn auto_rectify_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    image_size: u32,
) -> Result<RectifiedRgbaImage, RectificationError> {
    let analysis = analyze_rgba(rgba, width, height)?;
    let mut warnings = Vec::new();
    let panel = detect_panel(&analysis);

    let mut result = if let Some(panel) = panel {
        if is_full_frame_panel(width, height, panel.quad) {
            resize_full_frame(&analysis, image_size, panel, warnings)?
        } else if panel.confidence >= MIN_PANEL_CONFIDENCE {
            warp_detected_panel(&analysis, image_size, panel, warnings)?
        } else {
            warnings.push(RectificationWarning {
                code: "low_confidence_crop".to_owned(),
                message: "The crop detector found a possible CP panel, but confidence is low; inspect or adjust the quad before detection.".to_owned(),
                severity: "warning".to_owned(),
                details: Some(panel.metrics.clone()),
            });
            warp_detected_panel(&analysis, image_size, panel, warnings)?
        }
    } else {
        warnings.push(RectificationWarning {
            code: "cp_panel_not_detected".to_owned(),
            message:
                "No reliable square CP panel was detected; using a padded resize for preview only."
                    .to_owned(),
            severity: "warning".to_owned(),
            details: None,
        });
        resize_without_panel(&analysis, image_size, warnings)?
    };

    append_density_warning(
        &mut result.report.warnings,
        result.report.image_size,
        &result.rgba,
    );
    Ok(result)
}

pub fn manual_rectify_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    image_size: u32,
    quad: Quad,
) -> Result<RectifiedRgbaImage, RectificationError> {
    validate_quad(quad, width, height)?;
    let analysis = analyze_rgba(rgba, width, height)?;
    let warnings = Vec::new();
    let clipped = quad.clipped(width, height);
    let result = warp_source_quad(
        &analysis,
        image_size,
        clipped,
        "manual_quad_warp",
        1.0,
        json!({"method": "manual"}),
        warnings,
    )?;
    let mut result = result;
    append_density_warning(
        &mut result.report.warnings,
        result.report.image_size,
        &result.rgba,
    );
    Ok(result)
}

fn analyze_rgba(rgba: &[u8], width: u32, height: u32) -> Result<ImageAnalysis, RectificationError> {
    if width == 0 || height == 0 {
        return Err(RectificationError::InvalidDimensions { width, height });
    }
    let expected = width as usize * height as usize * 4;
    if rgba.len() != expected {
        return Err(RectificationError::RgbaLengthMismatch {
            expected,
            actual: rgba.len(),
        });
    }
    let padding_rgb = infer_padding_rgb(rgba, width as usize, height as usize);
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    let mut luma = Vec::with_capacity(width as usize * height as usize);
    for pixel in rgba.chunks_exact(4) {
        let alpha = pixel[3] as f32 / 255.0;
        let r = composite(pixel[0], padding_rgb[0], alpha);
        let g = composite(pixel[1], padding_rgb[1], alpha);
        let b = composite(pixel[2], padding_rgb[2], alpha);
        rgb.extend_from_slice(&[r, g, b]);
        luma.push(0.299 * r as f32 + 0.587 * g as f32 + 0.114 * b as f32);
    }
    let edges = edge_mask(&luma, width as usize, height as usize);
    let edge_density = edges.iter().filter(|active| **active).count() as f32 / edges.len() as f32;
    Ok(ImageAnalysis {
        rgb,
        edges,
        width: width as usize,
        height: height as usize,
        padding_rgb,
        edge_density,
    })
}

fn composite(foreground: u8, matte: u8, alpha: f32) -> u8 {
    ((foreground as f32 * alpha + matte as f32 * (1.0 - alpha)).round()).clamp(0.0, 255.0) as u8
}

fn edge_mask(luma: &[f32], width: usize, height: usize) -> Vec<bool> {
    let mut gradient = vec![0.0; width * height];
    let mut samples = Vec::new();
    let stride = ((width * height) / 65_536).max(1);
    for y in 1..height.saturating_sub(1) {
        for x in 1..width.saturating_sub(1) {
            let idx = y * width + x;
            let gx = -luma[(y - 1) * width + x - 1] + luma[(y - 1) * width + x + 1]
                - 2.0 * luma[y * width + x - 1]
                + 2.0 * luma[y * width + x + 1]
                - luma[(y + 1) * width + x - 1]
                + luma[(y + 1) * width + x + 1];
            let gy = -luma[(y - 1) * width + x - 1]
                - 2.0 * luma[(y - 1) * width + x]
                - luma[(y - 1) * width + x + 1]
                + luma[(y + 1) * width + x - 1]
                + 2.0 * luma[(y + 1) * width + x]
                + luma[(y + 1) * width + x + 1];
            let value = (gx * gx + gy * gy).sqrt();
            gradient[idx] = value;
            if idx.is_multiple_of(stride) {
                samples.push(value);
            }
        }
    }
    samples.sort_by(|a, b| a.total_cmp(b));
    let p80 = percentile_sorted(&samples, 0.80).unwrap_or(0.0);
    let p92 = percentile_sorted(&samples, 0.92).unwrap_or(0.0);
    let threshold = (p80 * 0.70 + p92 * 0.30).max(36.0);
    gradient
        .into_iter()
        .map(|value| value >= threshold)
        .collect()
}

fn detect_panel(analysis: &ImageAnalysis) -> Option<PanelCandidate> {
    if let Some(candidate) = frame_candidate(analysis) {
        return Some(candidate);
    }
    let mut candidates = projection_candidates(analysis);
    if let Some(candidate) = density_candidate(analysis) {
        candidates.push(candidate);
    }
    candidates
        .into_iter()
        .max_by(|left, right| left.confidence.total_cmp(&right.confidence))
}

fn frame_candidate(analysis: &ImageAnalysis) -> Option<PanelCandidate> {
    if analysis.width.abs_diff(analysis.height) > (analysis.width.max(analysis.height) / 50).max(2)
    {
        return None;
    }
    let quad = Quad::frame(analysis.width as u32, analysis.height as u32);
    let border_score = border_support(analysis, quad);
    let interior_density = interior_edge_density(analysis, quad);
    if border_score < 0.24 || interior_density < 0.002 {
        return None;
    }
    Some(PanelCandidate {
        quad,
        confidence: 1.0,
        method: "full_frame_border",
        metrics: json!({
            "method": "full_frame_border",
            "border_score": border_score,
            "edge_density": interior_density,
        }),
    })
}

fn projection_candidates(analysis: &ImageAnalysis) -> Vec<PanelCandidate> {
    let col_scores = smooth_scores(&axis_scores(analysis, true));
    let row_scores = smooth_scores(&axis_scores(analysis, false));
    let x_clusters = top_clusters(&col_scores, analysis.height);
    let y_clusters = top_clusters(&row_scores, analysis.width);
    let mut candidates = Vec::new();
    for (left_idx, left) in x_clusters.iter().enumerate() {
        for right in x_clusters.iter().skip(left_idx + 1) {
            let x0 = left.center.min(right.center) as f32;
            let x1 = left.center.max(right.center) as f32;
            let panel_width = x1 - x0;
            if panel_width < analysis.width.min(analysis.height) as f32 * 0.12 {
                continue;
            }
            for (top_idx, top) in y_clusters.iter().enumerate() {
                for bottom in y_clusters.iter().skip(top_idx + 1) {
                    let y0 = top.center.min(bottom.center) as f32;
                    let y1 = top.center.max(bottom.center) as f32;
                    let panel_height = y1 - y0;
                    if panel_height < analysis.width.min(analysis.height) as f32 * 0.12 {
                        continue;
                    }
                    let quad = Quad {
                        top_left: Point { x: x0, y: y0 },
                        top_right: Point { x: x1, y: y0 },
                        bottom_right: Point { x: x1, y: y1 },
                        bottom_left: Point { x: x0, y: y1 },
                    };
                    let (confidence, metrics) = score_quad(analysis, quad, "border_projection");
                    if confidence >= 0.42 {
                        candidates.push(PanelCandidate {
                            quad,
                            confidence,
                            method: "border_projection",
                            metrics,
                        });
                    }
                }
            }
        }
    }
    candidates
}

#[derive(Debug, Clone)]
struct Cluster {
    center: usize,
    score: f32,
}

fn axis_scores(analysis: &ImageAnalysis, vertical: bool) -> Vec<f32> {
    let len = if vertical {
        analysis.width
    } else {
        analysis.height
    };
    let cross = if vertical {
        analysis.height
    } else {
        analysis.width
    };
    let mut scores = vec![0.0; len];
    for (outer, score_slot) in scores.iter_mut().enumerate().take(len) {
        let mut score = 0.0;
        for inner in 0..cross {
            let idx = if vertical {
                inner * analysis.width + outer
            } else {
                outer * analysis.width + inner
            };
            if analysis.edges[idx] {
                score += 1.0;
            }
        }
        *score_slot = score;
    }
    scores
}

fn smooth_scores(scores: &[f32]) -> Vec<f32> {
    let radius = (scores.len() / 300).clamp(1, 5);
    let mut out = vec![0.0; scores.len()];
    for (idx, value) in out.iter_mut().enumerate() {
        let start = idx.saturating_sub(radius);
        let end = (idx + radius + 1).min(scores.len());
        *value = scores[start..end].iter().sum::<f32>() / (end - start) as f32;
    }
    out
}

fn top_clusters(scores: &[f32], cross_len: usize) -> Vec<Cluster> {
    if scores.is_empty() {
        return Vec::new();
    }
    let max_score = scores
        .iter()
        .copied()
        .fold(0.0_f32, |best, value| best.max(value));
    let threshold = (max_score * 0.45).max(cross_len as f32 * 0.08).max(8.0);
    let mut clusters = Vec::new();
    let mut idx = 0;
    while idx < scores.len() {
        if scores[idx] < threshold {
            idx += 1;
            continue;
        }
        let start = idx;
        let mut weighted = 0.0;
        let mut total = 0.0;
        let mut best = (idx, scores[idx]);
        while idx < scores.len() && scores[idx] >= threshold {
            let score = scores[idx];
            weighted += idx as f32 * score;
            total += score;
            if score > best.1 {
                best = (idx, score);
            }
            idx += 1;
        }
        let end = idx;
        let center = if total > 0.0 {
            (weighted / total).round() as usize
        } else {
            (start + end) / 2
        };
        clusters.push(Cluster {
            center,
            score: best.1,
        });
    }
    clusters.sort_by(|left, right| right.score.total_cmp(&left.score));
    clusters.truncate(12);
    clusters.sort_by_key(|cluster| cluster.center);
    clusters
}

fn density_candidate(analysis: &ImageAnalysis) -> Option<PanelCandidate> {
    let mut min_x = analysis.width;
    let mut min_y = analysis.height;
    let mut max_x = 0usize;
    let mut max_y = 0usize;
    let mut count = 0usize;
    for y in 0..analysis.height {
        for x in 0..analysis.width {
            if analysis.edges[y * analysis.width + x] {
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
                count += 1;
            }
        }
    }
    if count < (analysis.width * analysis.height / 400).max(64) || min_x >= max_x || min_y >= max_y
    {
        return None;
    }
    let pad = ((max_x - min_x).min(max_y - min_y) as f32 * 0.02).round() as usize + 2;
    min_x = min_x.saturating_sub(pad);
    min_y = min_y.saturating_sub(pad);
    max_x = (max_x + pad).min(analysis.width - 1);
    max_y = (max_y + pad).min(analysis.height - 1);
    let quad = Quad {
        top_left: Point {
            x: min_x as f32,
            y: min_y as f32,
        },
        top_right: Point {
            x: max_x as f32,
            y: min_y as f32,
        },
        bottom_right: Point {
            x: max_x as f32,
            y: max_y as f32,
        },
        bottom_left: Point {
            x: min_x as f32,
            y: max_y as f32,
        },
    };
    let (base_confidence, mut metrics) = score_quad(analysis, quad, "density_bbox");
    let square_score = metrics
        .get("square_score")
        .and_then(Value::as_f64)
        .unwrap_or(0.0) as f32;
    if square_score < 0.62 {
        return None;
    }
    if let Value::Object(ref mut map) = metrics {
        map.insert("edge_pixel_count".to_owned(), json!(count));
    }
    Some(PanelCandidate {
        quad,
        confidence: (base_confidence + 0.08).min(0.86),
        method: "density_bbox",
        metrics,
    })
}

fn score_quad(analysis: &ImageAnalysis, quad: Quad, method: &'static str) -> (f32, Value) {
    let area_ratio = quad.area() / (analysis.width * analysis.height).max(1) as f32;
    let sides = quad.side_lengths();
    let mean_width = ((sides[0] + sides[2]) * 0.5).max(1e-6);
    let mean_height = ((sides[1] + sides[3]) * 0.5).max(1e-6);
    let aspect = mean_width / mean_height;
    let square_score = clamp01(1.0 - aspect.max(1e-6).ln().abs() / 1.8_f32.ln());
    let size_score = if area_ratio >= 0.96 {
        clamp01(area_ratio / 0.16) * 0.85
    } else {
        clamp01(area_ratio / 0.16)
    };
    let border_support = border_support(analysis, quad);
    let interior_density = interior_edge_density(analysis, quad);
    let density_score = clamp01(interior_density / 0.045);
    let confidence = clamp01(
        0.38 * border_support
            + 0.30 * square_score
            + 0.14 * density_score
            + 0.10 * size_score
            + 0.08 * coverage_score(analysis, quad),
    );
    (
        confidence,
        json!({
            "method": method,
            "area_ratio": area_ratio,
            "aspect": aspect,
            "square_score": square_score,
            "size_score": size_score,
            "border_score": border_support,
            "edge_density": interior_density,
            "density_score": density_score,
            "coverage_score": coverage_score(analysis, quad),
        }),
    )
}

fn border_support(analysis: &ImageAnalysis, quad: Quad) -> f32 {
    let p = quad.points();
    let samples = quad.mean_side().round().clamp(24.0, 512.0) as usize;
    let mut active = 0usize;
    let mut total = 0usize;
    for side in 0..4 {
        let a = p[side];
        let b = p[(side + 1) % 4];
        for step in 0..=samples {
            let t = step as f32 / samples as f32;
            let point = a.lerp(b, t);
            if local_edge(
                analysis,
                point.x.round() as isize,
                point.y.round() as isize,
                2,
            ) {
                active += 1;
            }
            total += 1;
        }
    }
    active as f32 / total.max(1) as f32
}

fn interior_edge_density(analysis: &ImageAnalysis, quad: Quad) -> f32 {
    let xs = quad.points().map(|point| point.x);
    let ys = quad.points().map(|point| point.y);
    let min_x = xs
        .iter()
        .copied()
        .fold(f32::INFINITY, f32::min)
        .floor()
        .max(0.0) as usize;
    let max_x = xs
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max)
        .ceil()
        .min((analysis.width - 1) as f32) as usize;
    let min_y = ys
        .iter()
        .copied()
        .fold(f32::INFINITY, f32::min)
        .floor()
        .max(0.0) as usize;
    let max_y = ys
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max)
        .ceil()
        .min((analysis.height - 1) as f32) as usize;
    let pad = ((max_x - min_x).min(max_y - min_y) as f32 * 0.08).round() as usize;
    let mut active = 0usize;
    let mut total = 0usize;
    for y in (min_y + pad).min(max_y)..max_y.saturating_sub(pad) {
        for x in (min_x + pad).min(max_x)..max_x.saturating_sub(pad) {
            if analysis.edges[y * analysis.width + x] {
                active += 1;
            }
            total += 1;
        }
    }
    active as f32 / total.max(1) as f32
}

fn coverage_score(analysis: &ImageAnalysis, quad: Quad) -> f32 {
    let cells = 8usize;
    let mut occupied = 0usize;
    for cy in 0..cells {
        for cx in 0..cells {
            let u0 = cx as f32 / cells as f32;
            let u1 = (cx + 1) as f32 / cells as f32;
            let v0 = cy as f32 / cells as f32;
            let v1 = (cy + 1) as f32 / cells as f32;
            let mut hits = 0usize;
            for sy in 0..4 {
                for sx in 0..4 {
                    let u = u0 + (u1 - u0) * (sx as f32 + 0.5) / 4.0;
                    let v = v0 + (v1 - v0) * (sy as f32 + 0.5) / 4.0;
                    let top = quad.top_left.lerp(quad.top_right, u);
                    let bottom = quad.bottom_left.lerp(quad.bottom_right, u);
                    let point = top.lerp(bottom, v);
                    if local_edge(
                        analysis,
                        point.x.round() as isize,
                        point.y.round() as isize,
                        1,
                    ) {
                        hits += 1;
                    }
                }
            }
            if hits > 0 {
                occupied += 1;
            }
        }
    }
    occupied as f32 / (cells * cells) as f32
}

fn local_edge(analysis: &ImageAnalysis, x: isize, y: isize, radius: isize) -> bool {
    for yy in y - radius..=y + radius {
        for xx in x - radius..=x + radius {
            if xx < 0 || yy < 0 || xx >= analysis.width as isize || yy >= analysis.height as isize {
                continue;
            }
            if analysis.edges[yy as usize * analysis.width + xx as usize] {
                return true;
            }
        }
    }
    false
}

fn is_full_frame_panel(width: u32, height: u32, quad: Quad) -> bool {
    if width == 0 || height == 0 {
        return false;
    }
    if width.abs_diff(height) > (width.max(height) as f32 * 0.02).round().max(2.0) as u32 {
        return false;
    }
    let area_ratio = quad.area() / ((width - 1).max(1) * (height - 1).max(1)) as f32;
    let tolerance = (width.min(height) as f32 * 0.025).max(6.0);
    let points = quad.points();
    let min_x = points
        .iter()
        .map(|point| point.x)
        .fold(f32::INFINITY, f32::min);
    let max_x = points
        .iter()
        .map(|point| point.x)
        .fold(f32::NEG_INFINITY, f32::max);
    let min_y = points
        .iter()
        .map(|point| point.y)
        .fold(f32::INFINITY, f32::min);
    let max_y = points
        .iter()
        .map(|point| point.y)
        .fold(f32::NEG_INFINITY, f32::max);
    area_ratio >= 0.94
        && min_x <= tolerance
        && min_y <= tolerance
        && max_x >= width.saturating_sub(1) as f32 - tolerance
        && max_y >= height.saturating_sub(1) as f32 - tolerance
}

fn resize_full_frame(
    analysis: &ImageAnalysis,
    image_size: u32,
    panel: PanelCandidate,
    warnings: Vec<RectificationWarning>,
) -> Result<RectifiedRgbaImage, RectificationError> {
    let result = resize_without_panel(analysis, image_size, warnings)?;
    Ok(RectifiedRgbaImage {
        report: RectificationReport {
            mode: "full_frame_resize".to_owned(),
            confidence: panel.confidence.max(if analysis.width == analysis.height {
                1.0
            } else {
                0.85
            }),
            detected_source_quad: Some(panel.quad),
            metrics: panel.metrics,
            ..result.report
        },
        ..result
    })
}

fn resize_without_panel(
    analysis: &ImageAnalysis,
    image_size: u32,
    mut warnings: Vec<RectificationWarning>,
) -> Result<RectifiedRgbaImage, RectificationError> {
    if analysis.width != analysis.height {
        warnings.push(RectificationWarning {
            code: "rectified_input_not_square".to_owned(),
            message: "Input is not square; it was resized with letterbox padding.".to_owned(),
            severity: "warning".to_owned(),
            details: Some(json!({"width": analysis.width, "height": analysis.height})),
        });
    }
    let mut rgba = vec![255; image_size as usize * image_size as usize * 4];
    for chunk in rgba.chunks_exact_mut(4) {
        chunk[0] = analysis.padding_rgb[0];
        chunk[1] = analysis.padding_rgb[1];
        chunk[2] = analysis.padding_rgb[2];
        chunk[3] = 255;
    }
    let scale =
        (image_size as f32 / analysis.width as f32).min(image_size as f32 / analysis.height as f32);
    let out_width = (analysis.width as f32 * scale).round().max(1.0) as u32;
    let out_height = (analysis.height as f32 * scale).round().max(1.0) as u32;
    let offset_x = (image_size - out_width) / 2;
    let offset_y = (image_size - out_height) / 2;
    for y in 0..out_height {
        for x in 0..out_width {
            let src_x = x as f32 / (out_width.saturating_sub(1).max(1) as f32)
                * (analysis.width.saturating_sub(1) as f32);
            let src_y = y as f32 / (out_height.saturating_sub(1).max(1) as f32)
                * (analysis.height.saturating_sub(1) as f32);
            let rgb = sample_rgb(analysis, src_x, src_y);
            write_rgba(
                &mut rgba,
                image_size as usize,
                offset_x + x,
                offset_y + y,
                rgb,
            );
        }
    }
    let source_quad = Quad::frame(analysis.width as u32, analysis.height as u32);
    Ok(RectifiedRgbaImage {
        width: image_size,
        height: image_size,
        rgba,
        report: RectificationReport {
            original_width: analysis.width as u32,
            original_height: analysis.height as u32,
            image_size,
            mode: if analysis.width == analysis.height {
                "resize".to_owned()
            } else {
                "resize_pad".to_owned()
            },
            confidence: if analysis.width == analysis.height {
                1.0
            } else {
                0.85
            },
            source_quad,
            detected_source_quad: None,
            target_quad: Some(Quad {
                top_left: Point {
                    x: offset_x as f32,
                    y: offset_y as f32,
                },
                top_right: Point {
                    x: (offset_x + out_width.saturating_sub(1)) as f32,
                    y: offset_y as f32,
                },
                bottom_right: Point {
                    x: (offset_x + out_width.saturating_sub(1)) as f32,
                    y: (offset_y + out_height.saturating_sub(1)) as f32,
                },
                bottom_left: Point {
                    x: offset_x as f32,
                    y: (offset_y + out_height.saturating_sub(1)) as f32,
                },
            }),
            padding_rgb: analysis.padding_rgb,
            warnings,
            metrics: json!({"edge_density": analysis.edge_density}),
        },
    })
}

fn warp_detected_panel(
    analysis: &ImageAnalysis,
    image_size: u32,
    panel: PanelCandidate,
    warnings: Vec<RectificationWarning>,
) -> Result<RectifiedRgbaImage, RectificationError> {
    let mode = if panel.method == "density_bbox" {
        "detect_density_crop"
    } else {
        "detect_quad_warp"
    };
    warp_source_quad(
        analysis,
        image_size,
        panel.quad,
        mode,
        panel.confidence,
        panel.metrics,
        warnings,
    )
}

fn warp_source_quad(
    analysis: &ImageAnalysis,
    image_size: u32,
    source_quad: Quad,
    mode: &str,
    confidence: f32,
    metrics: Value,
    warnings: Vec<RectificationWarning>,
) -> Result<RectifiedRgbaImage, RectificationError> {
    let source_quad = source_quad.clipped(analysis.width as u32, analysis.height as u32);
    let margin = (image_size as f32 * DEFAULT_BORDER_MARGIN_RATIO)
        .round()
        .clamp(2.0, (image_size.saturating_sub(2) / 2) as f32);
    let target_quad = Quad::square(margin, image_size.saturating_sub(1) as f32 - margin);
    let homography = homography_from_quad_to_quad(target_quad, source_quad)?;
    let mut rgba = vec![255; image_size as usize * image_size as usize * 4];
    for chunk in rgba.chunks_exact_mut(4) {
        chunk[0] = analysis.padding_rgb[0];
        chunk[1] = analysis.padding_rgb[1];
        chunk[2] = analysis.padding_rgb[2];
        chunk[3] = 255;
    }
    for y in 0..image_size {
        for x in 0..image_size {
            let point = Point {
                x: x as f32,
                y: y as f32,
            };
            if !point_in_convex_quad(point, target_quad) {
                continue;
            }
            let src = apply_homography(&homography, point);
            if src.x < 0.0
                || src.y < 0.0
                || src.x > (analysis.width - 1) as f32
                || src.y > (analysis.height - 1) as f32
            {
                continue;
            }
            let rgb = sample_rgb(analysis, src.x, src.y);
            write_rgba(&mut rgba, image_size as usize, x, y, rgb);
        }
    }
    Ok(RectifiedRgbaImage {
        width: image_size,
        height: image_size,
        rgba,
        report: RectificationReport {
            original_width: analysis.width as u32,
            original_height: analysis.height as u32,
            image_size,
            mode: mode.to_owned(),
            confidence,
            source_quad,
            detected_source_quad: Some(source_quad),
            target_quad: Some(target_quad),
            padding_rgb: analysis.padding_rgb,
            warnings,
            metrics: json!({
                "source_crop_padding_px": 0.0,
                "target_crop_padding_px": 0.0,
                "raw": metrics,
            }),
        },
    })
}

fn validate_quad(quad: Quad, width: u32, height: u32) -> Result<(), RectificationError> {
    if quad.area() < 16.0 {
        return Err(RectificationError::InvalidQuad("area is too small"));
    }
    for point in quad.points() {
        if !point.x.is_finite() || !point.y.is_finite() {
            return Err(RectificationError::InvalidQuad(
                "coordinates must be finite",
            ));
        }
        let margin = 2.0;
        if point.x < -margin
            || point.y < -margin
            || point.x > width.saturating_sub(1) as f32 + margin
            || point.y > height.saturating_sub(1) as f32 + margin
        {
            return Err(RectificationError::InvalidQuad(
                "coordinates are outside the source image",
            ));
        }
    }
    Ok(())
}

fn append_density_warning(warnings: &mut Vec<RectificationWarning>, image_size: u32, rgba: &[u8]) {
    let luma: Vec<f32> = rgba
        .chunks_exact(4)
        .map(|pixel| 0.299 * pixel[0] as f32 + 0.587 * pixel[1] as f32 + 0.114 * pixel[2] as f32)
        .collect();
    let edges = edge_mask(&luma, image_size as usize, image_size as usize);
    let edge_density = edges.iter().filter(|active| **active).count() as f32 / edges.len() as f32;
    let background_luma = sampled_median_f32(&luma).unwrap_or(255.0);
    let ink: Vec<bool> = luma
        .iter()
        .map(|value| (value - background_luma).abs() >= 28.0)
        .collect();
    let ink_density = ink.iter().filter(|active| **active).count() as f32 / ink.len() as f32;
    let vertical_clusters =
        active_axis_cluster_count(&ink, image_size as usize, image_size as usize, true);
    let horizontal_clusters =
        active_axis_cluster_count(&ink, image_size as usize, image_size as usize, false);
    let dense = edge_density >= 0.18
        || ink_density >= 0.20
        || (ink_density >= 0.08 && vertical_clusters + horizontal_clusters >= 20);
    if dense {
        warnings.push(RectificationWarning {
            code: "dense_input_evidence".to_owned(),
            message: "The rectified input contains dense line evidence that may be outside the readable 1024px geometry envelope.".to_owned(),
            severity: "warning".to_owned(),
            details: Some(json!({
                "edge_density": edge_density,
                "ink_density": ink_density,
                "background_luma": background_luma,
                "vertical_cluster_count": vertical_clusters,
                "horizontal_cluster_count": horizontal_clusters,
                "image_size": [image_size, image_size],
            })),
        });
    }
}

fn active_axis_cluster_count(edges: &[bool], width: usize, height: usize, vertical: bool) -> usize {
    let len = if vertical { width } else { height };
    let cross = if vertical { height } else { width };
    let mut scores = vec![0.0; len];
    for (outer, score) in scores.iter_mut().enumerate().take(len) {
        for inner in 0..cross {
            let idx = if vertical {
                inner * width + outer
            } else {
                outer * width + inner
            };
            if edges[idx] {
                *score += 1.0;
            }
        }
    }
    let scores = smooth_scores(&scores);
    let max_score = scores
        .iter()
        .copied()
        .fold(0.0_f32, |best, value| best.max(value));
    let threshold = (max_score * 0.45).max(cross as f32 * 0.03).max(4.0);
    let mut clusters = 0usize;
    let mut idx = 0usize;
    while idx < len {
        if scores[idx] < threshold {
            idx += 1;
            continue;
        }
        clusters += 1;
        while idx < len && scores[idx] >= threshold {
            idx += 1;
        }
    }
    clusters
}

fn sampled_median_f32(values: &[f32]) -> Option<f32> {
    if values.is_empty() {
        return None;
    }
    let stride = (values.len() / 65_536).max(1);
    let mut samples: Vec<f32> = values
        .iter()
        .enumerate()
        .filter_map(|(idx, value)| (idx % stride == 0).then_some(*value))
        .collect();
    samples.sort_by(|a, b| a.total_cmp(b));
    samples.get(samples.len() / 2).copied()
}

fn sample_rgb(analysis: &ImageAnalysis, x: f32, y: f32) -> [u8; 3] {
    let x0 = x.floor().clamp(0.0, (analysis.width - 1) as f32) as usize;
    let y0 = y.floor().clamp(0.0, (analysis.height - 1) as f32) as usize;
    let x1 = (x0 + 1).min(analysis.width - 1);
    let y1 = (y0 + 1).min(analysis.height - 1);
    let tx = x - x0 as f32;
    let ty = y - y0 as f32;
    let p00 = rgb_at(analysis, x0, y0);
    let p10 = rgb_at(analysis, x1, y0);
    let p01 = rgb_at(analysis, x0, y1);
    let p11 = rgb_at(analysis, x1, y1);
    let mut out = [0u8; 3];
    for channel in 0..3 {
        let top = p00[channel] as f32 * (1.0 - tx) + p10[channel] as f32 * tx;
        let bottom = p01[channel] as f32 * (1.0 - tx) + p11[channel] as f32 * tx;
        out[channel] = (top * (1.0 - ty) + bottom * ty).round().clamp(0.0, 255.0) as u8;
    }
    out
}

fn rgb_at(analysis: &ImageAnalysis, x: usize, y: usize) -> [u8; 3] {
    let idx = (y * analysis.width + x) * 3;
    [
        analysis.rgb[idx],
        analysis.rgb[idx + 1],
        analysis.rgb[idx + 2],
    ]
}

fn write_rgba(rgba: &mut [u8], width: usize, x: u32, y: u32, rgb: [u8; 3]) {
    let idx = (y as usize * width + x as usize) * 4;
    rgba[idx] = rgb[0];
    rgba[idx + 1] = rgb[1];
    rgba[idx + 2] = rgb[2];
    rgba[idx + 3] = 255;
}

fn homography_from_quad_to_quad(source: Quad, dest: Quad) -> Result<[f32; 9], RectificationError> {
    let src = source.points();
    let dst = dest.points();
    let mut a = [[0.0_f64; 9]; 8];
    for i in 0..4 {
        let x = src[i].x as f64;
        let y = src[i].y as f64;
        let u = dst[i].x as f64;
        let v = dst[i].y as f64;
        a[2 * i] = [x, y, 1.0, 0.0, 0.0, 0.0, -u * x, -u * y, u];
        a[2 * i + 1] = [0.0, 0.0, 0.0, x, y, 1.0, -v * x, -v * y, v];
    }
    let solved = solve_8x8(a).ok_or(RectificationError::SingularHomography)?;
    Ok([
        solved[0] as f32,
        solved[1] as f32,
        solved[2] as f32,
        solved[3] as f32,
        solved[4] as f32,
        solved[5] as f32,
        solved[6] as f32,
        solved[7] as f32,
        1.0,
    ])
}

fn solve_8x8(mut matrix: [[f64; 9]; 8]) -> Option<[f64; 8]> {
    for col in 0..8 {
        let pivot =
            (col..8).max_by(|&a, &b| matrix[a][col].abs().total_cmp(&matrix[b][col].abs()))?;
        if matrix[pivot][col].abs() <= 1e-10 {
            return None;
        }
        if pivot != col {
            matrix.swap(pivot, col);
        }
        let pivot_value = matrix[col][col];
        for value in matrix[col].iter_mut().skip(col) {
            *value /= pivot_value;
        }
        let pivot_row = matrix[col];
        for (row, matrix_row) in matrix.iter_mut().enumerate() {
            if row == col {
                continue;
            }
            let factor = matrix_row[col];
            if factor.abs() <= 1e-12 {
                continue;
            }
            for (value, pivot_value) in matrix_row
                .iter_mut()
                .skip(col)
                .zip(pivot_row.iter().skip(col))
            {
                *value -= factor * *pivot_value;
            }
        }
    }
    let mut out = [0.0_f64; 8];
    for row in 0..8 {
        out[row] = matrix[row][8];
    }
    Some(out)
}

fn apply_homography(h: &[f32; 9], point: Point) -> Point {
    let denom = h[6] * point.x + h[7] * point.y + h[8];
    Point {
        x: (h[0] * point.x + h[1] * point.y + h[2]) / denom,
        y: (h[3] * point.x + h[4] * point.y + h[5]) / denom,
    }
}

fn point_in_convex_quad(point: Point, quad: Quad) -> bool {
    let points = quad.points();
    let mut sign = 0.0;
    for idx in 0..4 {
        let a = points[idx];
        let b = points[(idx + 1) % 4];
        let cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
        if cross.abs() <= 1e-4 {
            continue;
        }
        if sign == 0.0 {
            sign = cross.signum();
        } else if sign * cross < 0.0 {
            return false;
        }
    }
    true
}

fn infer_padding_rgb(rgba: &[u8], width: usize, height: usize) -> [u8; 3] {
    let thickness = ((width.min(height) as f32 * 0.04).round() as usize).max(1);
    let mut channels = [Vec::<u8>::new(), Vec::<u8>::new(), Vec::<u8>::new()];
    let stride = ((width * height) / 16_384).max(1);
    for y in 0..height {
        for x in 0..width {
            if y >= thickness && y < height - thickness && x >= thickness && x < width - thickness {
                continue;
            }
            let idx = (y * width + x) * 4;
            if !(idx / 4).is_multiple_of(stride) {
                continue;
            }
            let alpha = rgba[idx + 3];
            if alpha < 245 {
                continue;
            }
            channels[0].push(rgba[idx]);
            channels[1].push(rgba[idx + 1]);
            channels[2].push(rgba[idx + 2]);
        }
    }
    if channels.iter().any(Vec::is_empty) {
        return [255, 255, 255];
    }
    [
        median_u8(&mut channels[0]),
        median_u8(&mut channels[1]),
        median_u8(&mut channels[2]),
    ]
}

fn median_u8(values: &mut [u8]) -> u8 {
    values.sort_unstable();
    values[values.len() / 2]
}

fn percentile_sorted(values: &[f32], percentile: f32) -> Option<f32> {
    if values.is_empty() {
        return None;
    }
    let idx = ((values.len() - 1) as f32 * percentile).round() as usize;
    values.get(idx).copied()
}

fn distance(a: Point, b: Point) -> f32 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    (dx * dx + dy * dy).sqrt()
}

fn clamp01(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_rectifier_crops_axis_aligned_cp_panel() {
        let mut image = white_rgba(240, 180);
        draw_rect(&mut image, 240, 52, 28, 156, 132, [0, 0, 0], 3);
        draw_line(&mut image, 240, 52, 80, 156, 80, [0, 0, 255], 2);
        draw_line(&mut image, 240, 104, 28, 104, 132, [255, 0, 0], 2);
        draw_line(&mut image, 240, 52, 28, 156, 132, [120, 120, 120], 2);
        draw_line(&mut image, 240, 156, 28, 52, 132, [120, 120, 120], 2);

        let result = auto_rectify_rgba(&image, 240, 180, 128).expect("rectify");

        assert_eq!(result.width, 128);
        assert_eq!(result.height, 128);
        assert_eq!(result.report.mode, "detect_quad_warp");
        assert!(result.report.confidence >= 0.72, "{:?}", result.report);
        let detected = result.report.detected_source_quad.expect("detected quad");
        assert!((detected.top_left.x - 52.0).abs() <= 6.0, "{detected:?}");
        assert!((detected.top_left.y - 28.0).abs() <= 6.0, "{detected:?}");
    }

    #[test]
    fn auto_rectifier_preserves_full_frame_square_cp() {
        let mut image = white_rgba(128, 128);
        draw_rect(&mut image, 128, 0, 0, 127, 127, [0, 0, 0], 3);
        draw_line(&mut image, 128, 0, 0, 127, 127, [0, 0, 255], 2);
        draw_line(&mut image, 128, 127, 0, 0, 127, [255, 0, 0], 2);

        let result = auto_rectify_rgba(&image, 128, 128, 128).expect("rectify");

        assert_eq!(result.report.mode, "full_frame_resize");
        assert_eq!(result.report.confidence, 1.0);
        assert!(result.report.warnings.is_empty(), "{:?}", result.report);
    }

    #[test]
    fn manual_rectifier_warps_quad_and_reports_manual_mode() {
        let mut image = white_rgba(160, 120);
        draw_rect(&mut image, 160, 30, 20, 130, 100, [0, 0, 0], 3);
        draw_line(&mut image, 160, 30, 20, 130, 100, [0, 0, 255], 2);
        let quad = Quad {
            top_left: Point { x: 30.0, y: 20.0 },
            top_right: Point { x: 130.0, y: 20.0 },
            bottom_right: Point { x: 130.0, y: 100.0 },
            bottom_left: Point { x: 30.0, y: 100.0 },
        };

        let result = manual_rectify_rgba(&image, 160, 120, 128, quad).expect("rectify");

        assert_eq!(result.report.mode, "manual_quad_warp");
        assert_eq!(result.report.confidence, 1.0);
        let mid = ((64 * 128 + 64) * 4) as usize;
        assert!(result.rgba[mid + 2] > result.rgba[mid]);
    }

    #[test]
    fn manual_rectifier_does_not_sample_source_pixels_outside_crop() {
        let mut image = white_rgba(160, 120);
        draw_line(&mut image, 160, 30, 16, 130, 16, [0, 0, 0], 3);
        draw_rect(&mut image, 160, 30, 20, 130, 100, [0, 0, 0], 3);
        let quad = Quad {
            top_left: Point { x: 30.0, y: 20.0 },
            top_right: Point { x: 130.0, y: 20.0 },
            bottom_right: Point { x: 130.0, y: 100.0 },
            bottom_left: Point { x: 30.0, y: 100.0 },
        };

        let result = manual_rectify_rgba(&image, 160, 120, 128, quad).expect("rectify");

        assert_eq!(rgb_at(&result.rgba, 128, 64, 2), [255, 255, 255]);
        assert_eq!(
            result.report.metrics["source_crop_padding_px"].as_f64(),
            Some(0.0)
        );
        assert_eq!(
            result.report.metrics["target_crop_padding_px"].as_f64(),
            Some(0.0)
        );
    }

    #[test]
    fn dense_rectified_input_gets_warning() {
        let mut image = white_rgba(128, 128);
        draw_rect(&mut image, 128, 0, 0, 127, 127, [0, 0, 0], 2);
        for offset in (8..120).step_by(8) {
            draw_line(&mut image, 128, offset, 0, offset, 127, [120, 120, 120], 1);
            draw_line(&mut image, 128, 0, offset, 127, offset, [120, 120, 120], 1);
        }

        let result = auto_rectify_rgba(&image, 128, 128, 128).expect("rectify");
        assert!(
            result
                .report
                .warnings
                .iter()
                .any(|warning| warning.code == "dense_input_evidence"),
            "{:?}",
            result.report,
        );
    }

    #[test]
    fn missing_panel_warns_instead_of_hallucinating_crop() {
        let image = white_rgba(180, 120);

        let result = auto_rectify_rgba(&image, 180, 120, 128).expect("rectify");

        assert_eq!(result.report.mode, "resize_pad");
        assert!(
            result
                .report
                .warnings
                .iter()
                .any(|warning| warning.code == "cp_panel_not_detected")
        );
    }

    fn white_rgba(width: usize, height: usize) -> Vec<u8> {
        let mut image = vec![255; width * height * 4];
        for pixel in image.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
        image
    }

    fn rgb_at(image: &[u8], width: usize, x: usize, y: usize) -> [u8; 3] {
        let idx = (y * width + x) * 4;
        [image[idx], image[idx + 1], image[idx + 2]]
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_rect(
        image: &mut [u8],
        width: usize,
        x0: usize,
        y0: usize,
        x1: usize,
        y1: usize,
        rgb: [u8; 3],
        thickness: usize,
    ) {
        for t in 0..thickness {
            draw_line(image, width, x0, y0 + t, x1, y0 + t, rgb, 1);
            draw_line(image, width, x0, y1 - t, x1, y1 - t, rgb, 1);
            draw_line(image, width, x0 + t, y0, x0 + t, y1, rgb, 1);
            draw_line(image, width, x1 - t, y0, x1 - t, y1, rgb, 1);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_line(
        image: &mut [u8],
        width: usize,
        x0: usize,
        y0: usize,
        x1: usize,
        y1: usize,
        rgb: [u8; 3],
        thickness: usize,
    ) {
        let dx = x1 as isize - x0 as isize;
        let dy = y1 as isize - y0 as isize;
        let steps = dx.abs().max(dy.abs()).max(1);
        for step in 0..=steps {
            let x = x0 as isize + dx * step / steps;
            let y = y0 as isize + dy * step / steps;
            for oy in -(thickness as isize / 2)..=(thickness as isize / 2) {
                for ox in -(thickness as isize / 2)..=(thickness as isize / 2) {
                    let px = x + ox;
                    let py = y + oy;
                    if px < 0 || py < 0 {
                        continue;
                    }
                    let idx = (py as usize * width + px as usize) * 4;
                    if idx + 3 >= image.len() {
                        continue;
                    }
                    image[idx] = rgb[0];
                    image[idx + 1] = rgb[1];
                    image[idx + 2] = rgb[2];
                    image[idx + 3] = 255;
                }
            }
        }
    }
}
