//! Compiler-native dense evidence extraction.
//!
//! This module intentionally does not depend on the legacy decoder graph
//! snapshots. It converts model tensors into reusable evidence primitives for
//! the V2 compiler pipeline.

use crate::opencv_hough_lines_p::{
    HoughError, HoughLinesPConfig, HoughSegment, hough_lines_p_opencv_cpu,
};
use serde::{Deserialize, Serialize};

const SYNTHETIC_RENDER_INSET_PX: f32 = 32.0;
const VERTEX_TYPE_BACKGROUND_SUPPRESSION_FLOOR: f32 = 0.05;

#[derive(Debug, Clone, Copy)]
pub struct DenseOutputRefs<'a> {
    pub line_logits: &'a [f32],
    pub angle: Option<&'a [f32]>,
    pub junction_logits: &'a [f32],
    pub junction_offset: Option<&'a [f32]>,
    pub assignment_logits: &'a [f32],
    pub non_crease_logits: &'a [f32],
    pub line_style_logits: &'a [f32],
    pub vertex_type_logits: Option<&'a [f32]>,
    pub boundary_contact_logits: &'a [f32],
    pub boundary_side_logits: Option<&'a [f32]>,
    pub boundary_offset: Option<&'a [f32]>,
    pub boundary_coord: Option<&'a [f32]>,
}

impl<'a> DenseOutputRefs<'a> {
    pub const fn from_legacy_heads(
        line_logits: &'a [f32],
        junction_logits: &'a [f32],
        assignment_logits: &'a [f32],
        non_crease_logits: &'a [f32],
        line_style_logits: &'a [f32],
        boundary_contact_logits: &'a [f32],
    ) -> Self {
        Self {
            line_logits,
            angle: None,
            junction_logits,
            junction_offset: None,
            assignment_logits,
            non_crease_logits,
            line_style_logits,
            vertex_type_logits: None,
            boundary_contact_logits,
            boundary_side_logits: None,
            boundary_offset: None,
            boundary_coord: None,
        }
    }

    pub const fn with_angle(mut self, angle: Option<&'a [f32]>) -> Self {
        self.angle = angle;
        self
    }

    pub const fn with_junction_offset(mut self, junction_offset: Option<&'a [f32]>) -> Self {
        self.junction_offset = junction_offset;
        self
    }

    pub const fn with_vertex_type_logits(mut self, vertex_type_logits: Option<&'a [f32]>) -> Self {
        self.vertex_type_logits = vertex_type_logits;
        self
    }

    pub const fn with_boundary_side_logits(
        mut self,
        boundary_side_logits: Option<&'a [f32]>,
    ) -> Self {
        self.boundary_side_logits = boundary_side_logits;
        self
    }

    pub const fn with_boundary_offset(mut self, boundary_offset: Option<&'a [f32]>) -> Self {
        self.boundary_offset = boundary_offset;
        self
    }

    pub const fn with_boundary_coord(mut self, boundary_coord: Option<&'a [f32]>) -> Self {
        self.boundary_coord = boundary_coord;
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct EvidenceExtractionConfig {
    pub image_size: u32,
    pub line_threshold: f32,
    pub strong_line_support: f32,
    pub min_line_length_px: f32,
    pub edge_sample_step_px: f32,
    pub assignment_min_confidence: f32,
    pub hough_vote_threshold: u32,
    pub hough_min_segment_length_px: f32,
    pub hough_max_segment_gap_px: f32,
    pub max_line_primitives: usize,
    pub max_junction_primitives: usize,
    pub max_boundary_contact_primitives: usize,
    pub primitive_nms_radius_px: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompilerEvidence {
    pub image_size: u32,
    pub dense: DenseEvidence,
    pub line_primitives: Vec<LinePrimitive>,
    pub junction_primitives: Vec<JunctionPrimitive>,
    pub boundary_contact_primitives: Vec<BoundaryContactPrimitive>,
    pub report: EvidenceExtractionReport,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DenseEvidence {
    pub line_probability: Vec<f32>,
    pub non_crease_probability: Vec<f32>,
    pub junction_probability: Vec<f32>,
    pub boundary_contact_probability: Vec<f32>,
    pub assignment_probability: Vec<f32>,
    pub line_style_probability: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LinePrimitive {
    pub p0: [f32; 2],
    pub p1: [f32; 2],
    pub theta: f32,
    pub rho: f32,
    pub support: f32,
    pub votes: usize,
    pub assignment: AssignmentEvidence,
    pub style: LineStyleEvidence,
    pub source: PrimitiveSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssignmentEvidence {
    pub label: u8,
    pub confidence: f32,
    pub margin: f32,
    pub probabilities: [f32; 4],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LineStyleEvidence {
    pub probabilities: [f32; 4],
    pub dashed_or_gapped_support: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JunctionPrimitive {
    pub point: [f32; 2],
    pub support: f32,
    pub source: PrimitiveSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BoundaryContactPrimitive {
    pub point: [f32; 2],
    pub side: BoundarySide,
    pub side_coordinate: f32,
    pub support: f32,
    pub source: PrimitiveSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BoundarySide {
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrimitiveSource {
    ObservedStrong,
    ObservedWeak,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EvidenceExtractionReport {
    pub schema: String,
    pub legacy_dependency: bool,
    pub image_size: u32,
    pub extraction_seconds: f64,
    pub line_pixels_above_threshold: usize,
    pub hough_segments: usize,
    pub line_primitives: usize,
    pub strong_line_primitives: usize,
    pub weak_line_primitives: usize,
    pub junction_primitives: usize,
    pub boundary_contact_primitives: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum EvidenceExtractionError {
    #[error("invalid image size: {0}")]
    InvalidImageSize(u32),
    #[error("{name} length mismatch: expected {expected}, got {actual}")]
    TensorLength {
        name: &'static str,
        expected: usize,
        actual: usize,
    },
    #[error("OpenCV-compatible HoughLinesP failed: {0}")]
    Hough(#[from] HoughError),
}

pub fn extract_compiler_evidence(
    outputs: DenseOutputRefs<'_>,
    config: EvidenceExtractionConfig,
) -> Result<CompilerEvidence, EvidenceExtractionError> {
    let size = config.image_size as usize;
    if size < 8 {
        return Err(EvidenceExtractionError::InvalidImageSize(config.image_size));
    }
    let pixels = size * size;
    require_len("line_logits", outputs.line_logits, pixels)?;
    require_len("junction_logits", outputs.junction_logits, pixels)?;
    require_len("non_crease_logits", outputs.non_crease_logits, pixels)?;
    require_len(
        "boundary_contact_logits",
        outputs.boundary_contact_logits,
        pixels,
    )?;
    require_len("assignment_logits", outputs.assignment_logits, pixels * 4)?;
    require_len("line_style_logits", outputs.line_style_logits, pixels * 4)?;
    require_optional_len("junction_offset", outputs.junction_offset, pixels * 2)?;
    require_optional_len("vertex_type_logits", outputs.vertex_type_logits, pixels * 4)?;
    require_optional_len(
        "boundary_side_logits",
        outputs.boundary_side_logits,
        pixels * 4,
    )?;
    require_optional_len("boundary_offset", outputs.boundary_offset, pixels * 2)?;
    require_optional_len("boundary_coord", outputs.boundary_coord, pixels)?;

    let non_crease_probability = sigmoid_map(outputs.non_crease_logits);
    let line_probability = effective_line_probability(
        outputs.line_logits,
        &non_crease_probability,
        config.line_threshold,
    );
    let junction_probability = sigmoid_map(outputs.junction_logits);
    let junction_peak_probability =
        junction_score_map(&junction_probability, outputs.vertex_type_logits, size);
    let boundary_contact_probability = sigmoid_map(outputs.boundary_contact_logits);
    let assignment_probability = softmax_channels(outputs.assignment_logits, 4, pixels);
    let line_style_probability = softmax_channels(outputs.line_style_logits, 4, pixels);

    let (mask, line_pixels_above_threshold) = hough_mask(&line_probability, size, config);
    let hough_segments = if line_pixels_above_threshold == 0 {
        Vec::new()
    } else {
        hough_lines_p_opencv_cpu(
            &mask,
            size,
            size,
            &HoughLinesPConfig {
                rho: 1.0,
                theta: std::f32::consts::PI / 720.0,
                threshold: config.hough_vote_threshold.max(1) as i32,
                min_line_length: config.hough_min_segment_length_px as f64,
                max_line_gap: config.hough_max_segment_gap_px as f64,
                lines_max: i32::MAX,
            },
        )?
    };
    let hough_segment_count = hough_segments.len();
    let mut line_primitives = line_primitives_from_segments(
        &hough_segments,
        &line_probability,
        &assignment_probability,
        &line_style_probability,
        size,
        config,
    );
    line_primitives.sort_by(|left, right| {
        right
            .support
            .total_cmp(&left.support)
            .then_with(|| segment_length_sq(right).total_cmp(&segment_length_sq(left)))
    });
    line_primitives.truncate(config.max_line_primitives);

    let junction_primitives = local_maxima_primitives(
        &junction_peak_probability,
        size,
        config.line_threshold.max(0.50),
        config.primitive_nms_radius_px,
        config.max_junction_primitives,
    )
    .into_iter()
    .map(|(point, support)| JunctionPrimitive {
        point: offset_refined_point(point, outputs.junction_offset, size),
        support,
        source: primitive_source(support, config.strong_line_support),
    })
    .collect::<Vec<_>>();
    let boundary_contact_primitives = local_maxima_primitives(
        &boundary_contact_probability,
        size,
        config.line_threshold.max(0.50),
        config.primitive_nms_radius_px,
        config.max_boundary_contact_primitives,
    )
    .into_iter()
    .map(|(point, support)| {
        boundary_contact_primitive(point, support, outputs.boundary_offset, config)
    })
    .collect::<Vec<_>>();

    let strong_line_primitives = line_primitives
        .iter()
        .filter(|primitive| primitive.source == PrimitiveSource::ObservedStrong)
        .count();
    let weak_line_primitives = line_primitives.len() - strong_line_primitives;
    Ok(CompilerEvidence {
        image_size: config.image_size,
        dense: DenseEvidence {
            line_probability,
            non_crease_probability,
            junction_probability,
            boundary_contact_probability,
            assignment_probability,
            line_style_probability,
        },
        report: EvidenceExtractionReport {
            schema: "oristudio/cp-detect-compiler-evidence/v2".to_owned(),
            legacy_dependency: false,
            image_size: config.image_size,
            extraction_seconds: 0.0,
            line_pixels_above_threshold,
            hough_segments: hough_segment_count,
            line_primitives: line_primitives.len(),
            strong_line_primitives,
            weak_line_primitives,
            junction_primitives: junction_primitives.len(),
            boundary_contact_primitives: boundary_contact_primitives.len(),
        },
        line_primitives,
        junction_primitives,
        boundary_contact_primitives,
    })
}

fn require_len(
    name: &'static str,
    values: &[f32],
    expected: usize,
) -> Result<(), EvidenceExtractionError> {
    if values.len() != expected {
        return Err(EvidenceExtractionError::TensorLength {
            name,
            expected,
            actual: values.len(),
        });
    }
    Ok(())
}

fn require_optional_len(
    name: &'static str,
    values: Option<&[f32]>,
    expected: usize,
) -> Result<(), EvidenceExtractionError> {
    let Some(values) = values else {
        return Ok(());
    };
    require_len(name, values, expected)
}

fn sigmoid_map(values: &[f32]) -> Vec<f32> {
    values.iter().map(|value| sigmoid(*value)).collect()
}

fn effective_line_probability(
    line_logits: &[f32],
    non_crease_probability: &[f32],
    threshold: f32,
) -> Vec<f32> {
    line_logits
        .iter()
        .zip(non_crease_probability.iter())
        .map(|(line, non_crease_prob)| {
            let mut prob = sigmoid(*line);
            if *non_crease_prob >= 0.65 && prob < 0.85 {
                prob *= 0.15;
            }
            if prob < threshold * 0.25 { 0.0 } else { prob }
        })
        .collect()
}

fn softmax_channels(values: &[f32], channels: usize, pixels: usize) -> Vec<f32> {
    let mut probabilities = vec![0.0; pixels * channels];
    for idx in 0..pixels {
        let mut max_value = f32::NEG_INFINITY;
        for channel in 0..channels {
            max_value = max_value.max(values[channel * pixels + idx]);
        }
        let mut denom = 0.0;
        for channel in 0..channels {
            denom += (values[channel * pixels + idx] - max_value).exp();
        }
        if denom <= 0.0 {
            continue;
        }
        for channel in 0..channels {
            probabilities[idx * channels + channel] =
                (values[channel * pixels + idx] - max_value).exp() / denom;
        }
    }
    probabilities
}

fn junction_score_map(
    junction_probability: &[f32],
    vertex_type_logits: Option<&[f32]>,
    size: usize,
) -> Vec<f32> {
    let Some(vertex_type_logits) = vertex_type_logits else {
        return junction_probability.to_vec();
    };
    let pixels = size * size;
    let vertex_type_probability = softmax_channels(vertex_type_logits, 4, pixels);
    (0..pixels)
        .map(|idx| {
            let vertex_like = vertex_type_probability[idx * 4 + 1]
                .max(vertex_type_probability[idx * 4 + 2])
                .max(vertex_type_probability[idx * 4 + 3]);
            if vertex_like < VERTEX_TYPE_BACKGROUND_SUPPRESSION_FLOOR {
                junction_probability[idx] * 0.15
            } else {
                junction_probability[idx]
            }
        })
        .collect()
}

fn hough_mask(
    line_probability: &[f32],
    size: usize,
    config: EvidenceExtractionConfig,
) -> (Vec<u8>, usize) {
    let mut mask = vec![0u8; size * size];
    let mut foreground = 0usize;
    for (idx, score) in line_probability.iter().copied().enumerate() {
        if score >= config.line_threshold {
            mask[idx] = 255;
            foreground += 1;
        }
    }
    (mask, foreground)
}

fn line_primitives_from_segments(
    segments: &[HoughSegment],
    line_probability: &[f32],
    assignment_probability: &[f32],
    line_style_probability: &[f32],
    size: usize,
    config: EvidenceExtractionConfig,
) -> Vec<LinePrimitive> {
    let mut primitives = Vec::new();
    for segment in segments {
        let p0 = [segment.x1 as f32, segment.y1 as f32];
        let p1 = [segment.x2 as f32, segment.y2 as f32];
        if distance(p0, p1) < config.min_line_length_px {
            continue;
        }
        let support =
            sample_scalar_along_segment(p0, p1, line_probability, size, config.edge_sample_step_px);
        let assignment = sample_assignment_along_segment(
            p0,
            p1,
            assignment_probability,
            size,
            config.edge_sample_step_px,
            config.assignment_min_confidence,
        );
        let style = sample_line_style_along_segment(
            p0,
            p1,
            line_style_probability,
            size,
            config.edge_sample_step_px,
        );
        let (theta, rho) = theta_rho(p0, p1);
        primitives.push(LinePrimitive {
            p0,
            p1,
            theta,
            rho,
            support,
            votes: segment_votes(segment),
            assignment,
            style,
            source: primitive_source(support, config.strong_line_support),
        });
    }
    primitives
}

fn sample_assignment_along_segment(
    p0: [f32; 2],
    p1: [f32; 2],
    assignment_probability: &[f32],
    size: usize,
    step_px: f32,
    min_confidence: f32,
) -> AssignmentEvidence {
    let mut sums = [0.0f32; 4];
    let points = sample_points(p0, p1, step_px);
    for point in &points {
        let Some(idx) = pixel_index(*point, size) else {
            continue;
        };
        for channel in 0..4 {
            sums[channel] += assignment_probability[idx * 4 + channel];
        }
    }
    let total = sums.iter().sum::<f32>();
    if total <= 1e-6 {
        return AssignmentEvidence {
            label: 3,
            confidence: 0.0,
            margin: 0.0,
            probabilities: [0.25; 4],
        };
    }
    let probabilities = sums.map(|value| value / total);
    let mut order = [0usize, 1, 2, 3];
    order.sort_by(|left, right| probabilities[*right].total_cmp(&probabilities[*left]));
    let best = order[0];
    let second = order[1];
    let confidence = probabilities[best];
    AssignmentEvidence {
        label: if confidence >= min_confidence {
            best as u8
        } else {
            3
        },
        confidence,
        margin: confidence - probabilities[second],
        probabilities,
    }
}

fn sample_line_style_along_segment(
    p0: [f32; 2],
    p1: [f32; 2],
    line_style_probability: &[f32],
    size: usize,
    step_px: f32,
) -> LineStyleEvidence {
    let mut sums = [0.0f32; 4];
    let points = sample_points(p0, p1, step_px);
    for point in &points {
        let Some(idx) = pixel_index(*point, size) else {
            continue;
        };
        for channel in 0..4 {
            sums[channel] += line_style_probability[idx * 4 + channel];
        }
    }
    let total = sums.iter().sum::<f32>();
    let probabilities = if total <= 1e-6 {
        [0.25; 4]
    } else {
        sums.map(|value| value / total)
    };
    LineStyleEvidence {
        probabilities,
        dashed_or_gapped_support: probabilities[1].max(probabilities[2]),
    }
}

fn sample_scalar_along_segment(
    p0: [f32; 2],
    p1: [f32; 2],
    values: &[f32],
    size: usize,
    step_px: f32,
) -> f32 {
    let points = sample_points(p0, p1, step_px);
    let mut total = 0.0;
    let mut count = 0usize;
    for point in points {
        let Some(idx) = pixel_index(point, size) else {
            continue;
        };
        total += values[idx];
        count += 1;
    }
    if count == 0 {
        0.0
    } else {
        total / count as f32
    }
}

fn sample_points(p0: [f32; 2], p1: [f32; 2], step_px: f32) -> Vec<[f32; 2]> {
    let length = distance(p0, p1).max(1.0);
    let steps = (length / step_px.max(1.0)).ceil().max(1.0) as usize;
    (0..=steps)
        .map(|step| {
            let t = step as f32 / steps as f32;
            [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]
        })
        .collect()
}

fn local_maxima_primitives(
    probability: &[f32],
    size: usize,
    threshold: f32,
    radius_px: f32,
    max_count: usize,
) -> Vec<([f32; 2], f32)> {
    let radius = radius_px.round().max(1.0) as isize;
    let mut candidates = Vec::<([f32; 2], f32)>::new();
    for y in 0..size {
        for x in 0..size {
            let idx = y * size + x;
            let value = probability[idx];
            if value < threshold {
                continue;
            }
            let mut is_peak = true;
            'neighbors: for dy in -radius..=radius {
                for dx in -radius..=radius {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let nx = x as isize + dx;
                    let ny = y as isize + dy;
                    if nx < 0 || ny < 0 || nx >= size as isize || ny >= size as isize {
                        continue;
                    }
                    if probability[ny as usize * size + nx as usize] > value {
                        is_peak = false;
                        break 'neighbors;
                    }
                }
            }
            if is_peak {
                candidates.push(([x as f32, y as f32], value));
            }
        }
    }
    candidates.sort_by(|left, right| right.1.total_cmp(&left.1));
    candidates.truncate(max_count);
    candidates
}

fn boundary_contact_primitive(
    point: [f32; 2],
    support: f32,
    boundary_offset: Option<&[f32]>,
    config: EvidenceExtractionConfig,
) -> BoundaryContactPrimitive {
    let refined_point = offset_refined_point(point, boundary_offset, config.image_size as usize);
    let (frame_min, frame_max) = rendered_square_frame(config.image_size);
    let span = (frame_max - frame_min).max(1.0);
    let distances = [
        (BoundarySide::Top, (refined_point[1] - frame_min).abs()),
        (BoundarySide::Right, (refined_point[0] - frame_max).abs()),
        (BoundarySide::Bottom, (refined_point[1] - frame_max).abs()),
        (BoundarySide::Left, (refined_point[0] - frame_min).abs()),
    ];
    let (side, _) = distances
        .into_iter()
        .min_by(|left, right| left.1.total_cmp(&right.1))
        .unwrap_or((BoundarySide::Top, 0.0));
    let side_coordinate = match side {
        BoundarySide::Top | BoundarySide::Bottom => (refined_point[0] - frame_min) / span,
        BoundarySide::Right | BoundarySide::Left => (refined_point[1] - frame_min) / span,
    }
    .clamp(0.0, 1.0);
    let snapped_point = boundary_point_from_side_coordinate(side, side_coordinate, frame_min, span);
    BoundaryContactPrimitive {
        point: snapped_point,
        side,
        side_coordinate,
        support,
        source: primitive_source(support, config.strong_line_support),
    }
}

fn offset_refined_point(point: [f32; 2], offset: Option<&[f32]>, size: usize) -> [f32; 2] {
    let Some(offset) = offset else {
        return point;
    };
    let pixels = size * size;
    let Some(idx) = pixel_index(point, size) else {
        return point;
    };
    if offset.len() < pixels * 2 {
        return point;
    }
    let max = size.saturating_sub(1) as f32;
    [
        (point[0] + finite_offset(offset[idx])).clamp(0.0, max),
        (point[1] + finite_offset(offset[pixels + idx])).clamp(0.0, max),
    ]
}

fn finite_offset(value: f32) -> f32 {
    if value.is_finite() {
        value.clamp(-0.5, 0.5)
    } else {
        0.0
    }
}

fn rendered_square_frame(image_size: u32) -> (f32, f32) {
    let raw_max = image_size.saturating_sub(1) as f32;
    let inset = if image_size as f32 > SYNTHETIC_RENDER_INSET_PX * 2.0 {
        SYNTHETIC_RENDER_INSET_PX
    } else {
        raw_max * 0.25
    };
    let frame_max = (image_size as f32 - inset).clamp(inset, raw_max);
    (inset, frame_max)
}

fn boundary_point_from_side_coordinate(
    side: BoundarySide,
    side_coordinate: f32,
    frame_min: f32,
    span: f32,
) -> [f32; 2] {
    let coordinate = frame_min + side_coordinate.clamp(0.0, 1.0) * span;
    match side {
        BoundarySide::Top => [coordinate, frame_min],
        BoundarySide::Right => [frame_min + span, coordinate],
        BoundarySide::Bottom => [coordinate, frame_min + span],
        BoundarySide::Left => [frame_min, coordinate],
    }
}

fn primitive_source(support: f32, strong_support: f32) -> PrimitiveSource {
    if support >= strong_support {
        PrimitiveSource::ObservedStrong
    } else {
        PrimitiveSource::ObservedWeak
    }
}

fn pixel_index(point: [f32; 2], size: usize) -> Option<usize> {
    let x = point[0].round() as isize;
    let y = point[1].round() as isize;
    if x < 0 || y < 0 || x >= size as isize || y >= size as isize {
        return None;
    }
    Some(y as usize * size + x as usize)
}

fn theta_rho(p0: [f32; 2], p1: [f32; 2]) -> (f32, f32) {
    let dx = p1[0] - p0[0];
    let dy = p1[1] - p0[1];
    let theta = dy.atan2(dx);
    let normal = [-theta.sin(), theta.cos()];
    let rho = normal[0] * p0[0] + normal[1] * p0[1];
    (theta, rho)
}

fn segment_votes(segment: &HoughSegment) -> usize {
    ((segment.x2 - segment.x1)
        .abs()
        .max((segment.y2 - segment.y1).abs()) as usize)
        + 1
}

fn segment_length_sq(segment: &LinePrimitive) -> f32 {
    let dx = segment.p1[0] - segment.p0[0];
    let dy = segment.p1[1] - segment.p0[1];
    dx * dx + dy * dy
}

fn distance(p0: [f32; 2], p1: [f32; 2]) -> f32 {
    ((p1[0] - p0[0]).powi(2) + (p1[1] - p0[1]).powi(2)).sqrt()
}

fn sigmoid(value: f32) -> f32 {
    1.0 / (1.0 + (-value).exp())
}

#[cfg(test)]
mod tests {
    use super::*;

    type BlankHeads = (Vec<f32>, Vec<f32>, Vec<f32>, Vec<f32>, Vec<f32>, Vec<f32>);

    fn test_config(size: usize) -> EvidenceExtractionConfig {
        EvidenceExtractionConfig {
            image_size: size as u32,
            line_threshold: 0.65,
            strong_line_support: 0.35,
            min_line_length_px: 6.0,
            edge_sample_step_px: 2.0,
            assignment_min_confidence: 0.5,
            hough_vote_threshold: 8,
            hough_min_segment_length_px: 6.0,
            hough_max_segment_gap_px: 4.0,
            max_line_primitives: 32,
            max_junction_primitives: 32,
            max_boundary_contact_primitives: 32,
            primitive_nms_radius_px: 3.0,
        }
    }

    fn blank_heads(size: usize) -> BlankHeads {
        let pixels = size * size;
        (
            vec![-8.0; pixels],
            vec![-8.0; pixels],
            vec![-4.0; pixels * 4],
            vec![-8.0; pixels],
            vec![-4.0; pixels * 4],
            vec![-8.0; pixels],
        )
    }

    #[test]
    fn extracts_line_and_junction_primitives_without_legacy_decoder() {
        let size = 64usize;
        let pixels = size * size;
        let mut line_logits = vec![-8.0; pixels];
        let mut junction_logits = vec![-8.0; pixels];
        let mut assignment_logits = vec![-4.0; pixels * 4];
        let non_crease_logits = vec![-8.0; pixels];
        let line_style_logits = vec![-4.0; pixels * 4];
        let mut boundary_contact_logits = vec![-8.0; pixels];

        for y in 0..size {
            line_logits[y * size + 32] = 8.0;
            assignment_logits[y * size + 32] = 8.0;
        }
        junction_logits[32 * size + 32] = 8.0;
        boundary_contact_logits[32] = 8.0;

        let evidence = extract_compiler_evidence(
            DenseOutputRefs::from_legacy_heads(
                &line_logits,
                &junction_logits,
                &assignment_logits,
                &non_crease_logits,
                &line_style_logits,
                &boundary_contact_logits,
            ),
            test_config(size),
        )
        .expect("evidence extraction");

        assert!(!evidence.line_primitives.is_empty());
        assert!(!evidence.junction_primitives.is_empty());
        assert!(!evidence.boundary_contact_primitives.is_empty());
        assert!(!evidence.report.legacy_dependency);
    }

    #[test]
    fn junction_primitives_use_subpixel_offsets() {
        let size = 128usize;
        let pixels = size * size;
        let (
            line_logits,
            mut junction_logits,
            assignment_logits,
            non_crease_logits,
            line_style_logits,
            boundary_contact_logits,
        ) = blank_heads(size);
        let idx = 64 * size + 64;
        junction_logits[idx] = 8.0;
        let mut junction_offset = vec![0.0; pixels * 2];
        junction_offset[idx] = 0.25;
        junction_offset[pixels + idx] = -0.5;

        let evidence = extract_compiler_evidence(
            DenseOutputRefs::from_legacy_heads(
                &line_logits,
                &junction_logits,
                &assignment_logits,
                &non_crease_logits,
                &line_style_logits,
                &boundary_contact_logits,
            )
            .with_junction_offset(Some(&junction_offset)),
            test_config(size),
        )
        .expect("evidence extraction");

        assert_eq!(evidence.junction_primitives.len(), 1);
        let point = evidence.junction_primitives[0].point;
        assert!((point[0] - 64.25).abs() < 1.0e-4, "{point:?}");
        assert!((point[1] - 63.5).abs() < 1.0e-4, "{point:?}");
    }

    #[test]
    fn vertex_type_suppresses_background_junction_peaks() {
        let size = 128usize;
        let pixels = size * size;
        let (
            line_logits,
            mut junction_logits,
            assignment_logits,
            non_crease_logits,
            line_style_logits,
            boundary_contact_logits,
        ) = blank_heads(size);
        let background_idx = 40 * size + 40;
        let interior_idx = 80 * size + 80;
        junction_logits[background_idx] = 8.0;
        junction_logits[interior_idx] = 8.0;
        let mut vertex_type_logits = vec![-4.0; pixels * 4];
        vertex_type_logits[background_idx] = 8.0;
        vertex_type_logits[3 * pixels + interior_idx] = 8.0;

        let evidence = extract_compiler_evidence(
            DenseOutputRefs::from_legacy_heads(
                &line_logits,
                &junction_logits,
                &assignment_logits,
                &non_crease_logits,
                &line_style_logits,
                &boundary_contact_logits,
            )
            .with_vertex_type_logits(Some(&vertex_type_logits)),
            test_config(size),
        )
        .expect("evidence extraction");

        assert_eq!(evidence.junction_primitives.len(), 1);
        assert_eq!(evidence.junction_primitives[0].point, [80.0, 80.0]);
    }

    #[test]
    fn boundary_contacts_use_rendered_square_frame_coordinates() {
        let size = 128usize;
        let (
            line_logits,
            junction_logits,
            assignment_logits,
            non_crease_logits,
            line_style_logits,
            mut boundary_contact_logits,
        ) = blank_heads(size);
        boundary_contact_logits[32 * size + 64] = 8.0;

        let evidence = extract_compiler_evidence(
            DenseOutputRefs::from_legacy_heads(
                &line_logits,
                &junction_logits,
                &assignment_logits,
                &non_crease_logits,
                &line_style_logits,
                &boundary_contact_logits,
            ),
            test_config(size),
        )
        .expect("evidence extraction");

        assert_eq!(evidence.boundary_contact_primitives.len(), 1);
        let contact = &evidence.boundary_contact_primitives[0];
        assert_eq!(contact.side, BoundarySide::Top);
        assert!(
            (contact.side_coordinate - 0.5).abs() < 1.0e-4,
            "{contact:?}"
        );
        assert_eq!(contact.point, [64.0, 32.0]);
    }

    #[test]
    fn boundary_contacts_use_offset_before_frame_projection() {
        let size = 128usize;
        let pixels = size * size;
        let (
            line_logits,
            junction_logits,
            assignment_logits,
            non_crease_logits,
            line_style_logits,
            mut boundary_contact_logits,
        ) = blank_heads(size);
        let idx = 32 * size + 64;
        boundary_contact_logits[idx] = 8.0;
        let mut boundary_offset = vec![0.0; pixels * 2];
        boundary_offset[idx] = 0.5;

        let evidence = extract_compiler_evidence(
            DenseOutputRefs::from_legacy_heads(
                &line_logits,
                &junction_logits,
                &assignment_logits,
                &non_crease_logits,
                &line_style_logits,
                &boundary_contact_logits,
            )
            .with_boundary_offset(Some(&boundary_offset)),
            test_config(size),
        )
        .expect("evidence extraction");

        let contact = &evidence.boundary_contact_primitives[0];
        assert_eq!(contact.side, BoundarySide::Top);
        assert!(
            (contact.side_coordinate - (32.5 / 64.0)).abs() < 1.0e-4,
            "{contact:?}"
        );
        assert!((contact.point[0] - 64.5).abs() < 1.0e-4, "{contact:?}");
        assert!((contact.point[1] - 32.0).abs() < 1.0e-4, "{contact:?}");
    }

    #[test]
    fn module_does_not_import_legacy_decode() {
        let source = include_str!("evidence_extract.rs");
        assert!(!source.contains(&format!("crate::{}", "legacy_decode")));
        assert!(!source.contains(&format!("super::{}", "legacy_decode")));
    }
}
