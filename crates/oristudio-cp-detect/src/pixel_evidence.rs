//! Model-independent adapter for full-resolution vertices and crease support.
//! No legacy dense heads or Hough extraction are needed for junction-first
//! proposals. Keeping the adapter native also keeps browser and desktop equal.

use crate::decode::{DecodeError, RefinedVertexPrimitive};
use crate::evidence_extract::{CompilerEvidence, DenseEvidence, EvidenceExtractionReport};
use oristudio_cp_compiler::{AssignmentCandidate, AssignmentLabel, ExactSolveInput};

pub(crate) fn physical_evidence(
    rgba: &[u8],
    crease: &[f32],
    vertices: &[RefinedVertexPrimitive],
    size: u32,
) -> Result<CompilerEvidence, DecodeError> {
    if !(128..=4096).contains(&size) {
        return Err(DecodeError::InvalidImageSize(size));
    }
    let pixels = size as usize * size as usize;
    if rgba.len() != pixels * 4 {
        return Err(DecodeError::BufferLength {
            name: "rgba",
            expected: pixels * 4,
            actual: rgba.len(),
        });
    }
    if crease.len() != pixels {
        return Err(DecodeError::TensorLength {
            name: "crease_probability",
            expected: pixels,
            actual: crease.len(),
        });
    }
    if crease
        .iter()
        .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
    {
        return Err(DecodeError::InvalidPixelEvidence(
            "crease probabilities must be finite and within 0..1",
        ));
    }
    if vertices.iter().any(|v| {
        !v.x.is_finite()
            || !v.y.is_finite()
            || v.score.is_some_and(|s| !s.is_finite())
            || v.side_coordinate.is_some_and(|s| !s.is_finite())
    }) {
        return Err(DecodeError::InvalidPixelEvidence("vertices must be finite"));
    }
    let mut assignments = Vec::with_capacity(pixels * 4);
    for pixel in rgba.chunks_exact(4) {
        // Dark/gray ink has no M/V color evidence. Cyan has its own AUX head;
        // this plane is only sampled where the physical crease head supports it.
        let difference = (pixel[0] as f32 - pixel[2] as f32) / 255.0;
        assignments.extend(softmax([
            (difference * 25.0).clamp(-5.0, 5.0),
            (-difference * 25.0).clamp(-5.0, 5.0),
            -5.0,
            1.0,
        ]));
    }
    let solid = softmax([5.0, -5.0, -5.0, -5.0]);
    let mut styles = Vec::with_capacity(pixels * 4);
    for _ in 0..pixels {
        styles.extend(solid);
    }
    // Match the research adapter's absent-head sigmoid(-20), including its
    // floating-point behavior. These planes carry no additional learned data.
    let absent = 1.0 / (1.0 + 20.0f32.exp());
    Ok(CompilerEvidence {
        image_size: size,
        dense: DenseEvidence {
            line_probability: crease.to_vec(),
            non_crease_probability: vec![absent; pixels],
            junction_probability: vec![absent; pixels],
            boundary_contact_probability: vec![absent; pixels],
            assignment_probability: assignments,
            line_style_probability: styles,
        },
        line_primitives: Vec::new(),
        junction_primitives: Vec::new(),
        boundary_contact_primitives: Vec::new(),
        report: EvidenceExtractionReport {
            schema: "pixel-evidence-v1".into(),
            legacy_dependency: false,
            image_size: size,
            extraction_seconds: 0.0,
            line_pixels_above_threshold: crease.iter().filter(|v| **v >= 0.5).count(),
            hough_segments: 0,
            line_primitives: 0,
            strong_line_primitives: 0,
            weak_line_primitives: 0,
            junction_primitives: 0,
            boundary_contact_primitives: 0,
        },
    })
}

fn softmax(values: [f32; 4]) -> [f32; 4] {
    let max = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let exp = values.map(|v| (v - max).exp());
    let denominator: f32 = exp.iter().sum();
    exp.map(|v| v / denominator)
}

/// Read color after physical topology selection. A narrow perpendicular band
/// tolerates subpixel localization error; trimmed endpoints avoid crossing ink.
/// Cyan is AUX evidence, and color-free strokes cannot establish M/V direction.
pub(crate) fn finalize_color_assignments(rgba: &[u8], size: u32, input: &mut ExactSolveInput) {
    use oristudio_cp_compiler::candidate_graph::{AssignmentEvidence, AssignmentEvidenceSource};
    for span in &mut input.selected_spans {
        if !matches!(
            span.assignment_label(),
            AssignmentLabel::Unknown | AssignmentLabel::Mountain | AssignmentLabel::Valley
        ) {
            continue;
        }
        let [a, b] = span.vertices.map(|i| input.vertices[i].point);
        let scale = f64::from(size) - 64.0;
        let endpoints = [
            [32.0 + a.x * scale, 32.0 + a.y * scale],
            [32.0 + b.x * scale, 32.0 + b.y * scale],
        ];
        let Some((label, confidence)) = span_color(rgba, size as usize, endpoints) else {
            continue;
        };
        if label != span.assignment_label() {
            span.assignment_evidence = AssignmentEvidence::from_candidate(
                AssignmentCandidate {
                    label,
                    confidence: (1.0 + confidence) / 2.0,
                    margin: confidence,
                },
                AssignmentEvidenceSource::LegacyColor,
            );
        }
    }
}

fn span_color(rgba: &[u8], size: usize, [a, b]: [[f64; 2]; 2]) -> Option<(AssignmentLabel, f64)> {
    let delta = [b[0] - a[0], b[1] - a[1]];
    let length = delta[0].hypot(delta[1]);
    if length < 1.0 {
        return None;
    }
    let normal = [-delta[1] / length, delta[0] / length];
    let trim = (3.0 / length).min(0.3);
    let count = ((length * (1.0 - 2.0 * trim)) as usize + 1).max(3);
    let mut colored = 0;
    let mut signed_sum = 0.0;
    let mut absolute_sum = 0.0;
    for i in 0..count {
        let t = trim + (1.0 - 2.0 * trim) * i as f64 / (count - 1) as f64;
        let mut best = -1.0;
        let mut chosen: f64 = 0.0;
        for step in -4..=4 {
            let offset = f64::from(step) * 0.5;
            // Match NumPy's ties-to-even pixel sampling in the scored probe.
            let xy = [0, 1].map(|d| {
                (a[d] + t * delta[d] + offset * normal[d])
                    .round_ties_even()
                    .clamp(0.0, (size - 1) as f64) as usize
            });
            let index = (xy[1] * size + xy[0]) * 4;
            let [r, g, b] = [0, 1, 2].map(|c| f64::from(rgba[index + c]));
            let cyan_chroma = (g - r).min(b - r);
            let chroma = if cyan_chroma > 12.0 && (g - b).abs() <= 12.0 + 0.25 * cyan_chroma {
                0.0
            } else {
                r - b
            };
            let merit = chroma.abs() / (1.0 + offset * offset);
            if merit > best {
                best = merit;
                chosen = chroma;
            }
        }
        colored += usize::from(chosen.abs() > 12.0);
        let signed = chosen.clamp(-128.0, 128.0);
        signed_sum += signed;
        absolute_sum += signed.abs();
    }
    let confidence = signed_sum.abs() / absolute_sum.max(1.0);
    if colored * 2 < count || confidence < 0.6 {
        return None;
    }
    Some((
        if signed_sum > 0.0 {
            AssignmentLabel::Mountain
        } else {
            AssignmentLabel::Valley
        },
        confidence,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_band_recovers_offset_ink_without_confusing_cyan_or_crossings() {
        let size = 128;
        for (rgb, expected) in [
            ([255, 0, 0], Some(AssignmentLabel::Mountain)),
            ([0, 0, 255], Some(AssignmentLabel::Valley)),
            ([100, 200, 200], None),
            ([80, 80, 80], None),
        ] {
            let mut rgba = vec![255; size * size * 4];
            for x in 40..=88 {
                rgba[(65 * size + x) * 4..(65 * size + x) * 4 + 3].copy_from_slice(&rgb);
            }
            for y in 60..=68 {
                for x in [40, 88] {
                    rgba[(y * size + x) * 4..(y * size + x) * 4 + 3].copy_from_slice(&[0, 0, 255]);
                }
            }
            assert_eq!(
                span_color(&rgba, size, [[40.0, 64.0], [88.0, 64.0]]).map(|v| v.0),
                expected
            );
        }
    }

    #[test]
    fn neutral_ink_does_not_claim_a_fold_direction() {
        let mut rgba = vec![255; 128 * 128 * 4];
        rgba[..4].copy_from_slice(&[80, 80, 80, 255]);
        rgba[4..8].copy_from_slice(&[255, 0, 0, 255]);
        rgba[8..12].copy_from_slice(&[0, 0, 255, 255]);
        let e = physical_evidence(&rgba, &vec![0.5; 128 * 128], &[], 128).unwrap();
        let p = &e.dense.assignment_probability;
        assert!(p[3] > p[0] && p[3] > p[1]);
        assert!(p[4] > 0.95);
        assert!(p[9] > 0.95);
    }

    #[test]
    fn malformed_probability_is_rejected_before_graph_generation() {
        let rgba = vec![255; 128 * 128 * 4];
        let mut plane = vec![0.0; 128 * 128];
        plane[8] = f32::NAN;
        assert!(matches!(
            physical_evidence(&rgba, &plane, &[], 128),
            Err(DecodeError::InvalidPixelEvidence(_))
        ));
        assert!(matches!(
            physical_evidence(&rgba, &plane[..10], &[], 128),
            Err(DecodeError::TensorLength { .. })
        ));
    }
}
