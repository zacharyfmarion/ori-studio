//! Auxiliary ink is positive geometry, separate from physical fold topology.
//! Oriedita cyan strokes become FOLD `F` edges. They do not split physical
//! creases at crossings or participate in M/V theorem completion.
use crate::decode::DecodeError;
use crate::opencv_hough_lines_p::{HoughLinesPConfig, hough_lines_p_opencv_cpu};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use treemaker_fold::{Assignment, FoldAngle, FoldDocument};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AuxiliarySegment {
    /// Unit paper coordinates, with the same 32px inset as the physical graph.
    pub endpoints: [[f64; 2]; 2],
}

type Segment = [[f64; 2]; 2];

pub fn attach_to_decoded(
    decoded: &mut crate::decode::DecodedFold,
    segments: &[AuxiliarySegment],
) -> Result<(), DecodeError> {
    decoded.fold_json = append_auxiliary(&decoded.fold_json, segments)?;
    if let Some(input) = decoded
        .report
        .quality_report
        .get_mut("compiler_report")
        .and_then(|r| r.get_mut("exact_solve_input"))
        .and_then(Value::as_object_mut)
    {
        // An opaque bridge attachment: the physical solver ignores this field,
        // and both export bridges reattach it after solving.
        input.insert("auxiliary_segments".into(), serde_json::to_value(segments)?);
    }
    decoded.report.edge_count += segments.len();
    decoded.report.vertex_count += segments.len() * 2;
    decoded.report.quality_report["auxiliary_segment_count"] = json!(segments.len());
    Ok(())
}

pub fn segments_from_solve_request(input_json: &str) -> Result<Vec<AuxiliarySegment>, DecodeError> {
    let input: Value = serde_json::from_str(input_json)?;
    let Some(value) = input.get("auxiliary_segments") else {
        return Ok(Vec::new());
    };
    let segments: Vec<AuxiliarySegment> = serde_json::from_value(value.clone())?;
    if segments
        .iter()
        .flat_map(|s| s.endpoints.iter().flatten())
        .any(|v| !v.is_finite())
    {
        return Err(DecodeError::InvalidPixelEvidence(
            "nonfinite AUX coordinates",
        ));
    }
    Ok(segments)
}

pub fn extract_auxiliary_segments(
    rgba: &[u8],
    probability: &[f32],
    image_size: u32,
) -> Result<Vec<AuxiliarySegment>, DecodeError> {
    let size = image_size as usize;
    if !(128..=4096).contains(&size) {
        return Err(DecodeError::InvalidImageSize(image_size));
    }
    if rgba.len() != size * size * 4 || probability.len() != size * size {
        return Err(DecodeError::InvalidPixelEvidence(
            "invalid AUX image/plane dimensions",
        ));
    }
    if probability
        .iter()
        .any(|p| !p.is_finite() || !(0.0..=1.0).contains(p))
    {
        return Err(DecodeError::InvalidPixelEvidence(
            "invalid AUX probabilities",
        ));
    }
    let cyan: Vec<bool> = rgba
        .chunks_exact(4)
        .map(|p| {
            let [r, g, b] = [p[0] as f32, p[1] as f32, p[2] as f32];
            let chroma = (g - r).min(b - r);
            chroma > 12.0 && (g - b).abs() <= 12.0 + 0.25 * chroma
        })
        .collect();
    let mut p = vec![0.0; size * size];
    let mut support = Vec::new();
    for y in 32..=size - 32 {
        for x in 32..=size - 32 {
            let near = (y - 1..=y + 1).any(|yy| (x - 1..=x + 1).any(|xx| cyan[yy * size + xx]));
            if near {
                p[y * size + x] = probability[y * size + x];
                if p[y * size + x] >= 0.30 {
                    support.push(([x as f64, y as f64], p[y * size + x] as f64));
                }
            }
        }
    }
    if support.len() < 8 {
        return Ok(Vec::new());
    }
    let mask = crate::evidence_extract::skeletonized_line_mask(&p, size, 0.45);
    let lines = hough_lines_p_opencv_cpu(
        &mask,
        size,
        size,
        &HoughLinesPConfig {
            min_line_length: 8.0,
            ..Default::default()
        },
    )?;
    let mut proposals: Vec<Segment> = lines
        .into_iter()
        .map(|l| [[l.x1 as f64, l.y1 as f64], [l.x2 as f64, l.y2 as f64]])
        .collect();
    proposals.sort_by(|a, b| length(*b).total_cmp(&length(*a)));
    let mut groups: Vec<Vec<([f64; 2], f64)>> = Vec::new();
    for segment in proposals {
        if let Some(group) = groups.iter_mut().find(|g| mergeable(fit(g), segment)) {
            group.extend(segment.map(|p| (p, 1.0)));
        } else {
            groups.push(segment.map(|p| (p, 1.0)).to_vec());
        }
    }
    let mut result = Vec::new();
    for group in groups {
        let mut segment = fit(&group);
        let len = length(segment);
        if len < 8.0 {
            continue;
        }
        let direction = [
            (segment[1][0] - segment[0][0]) / len,
            (segment[1][1] - segment[0][1]) / len,
        ];
        let nearby: Vec<_> = support
            .iter()
            .copied()
            .filter(|(p, _)| {
                let v = [p[0] - segment[0][0], p[1] - segment[0][1]];
                let along = v[0] * direction[0] + v[1] * direction[1];
                (v[0] * direction[1] - v[1] * direction[0]).abs() <= 1.5
                    && along >= -3.0
                    && along <= len + 3.0
            })
            .collect();
        if nearby.len() >= 6 {
            segment = fit(&nearby);
        }
        // A Hough vote can join pixels from adjacent hatch strokes along a
        // spurious diagonal. Require continuous support on the fitted carrier.
        let samples = length(segment).ceil() as usize;
        let supported = (0..=samples)
            .filter(|i| {
                let t = *i as f64 / samples.max(1) as f64;
                let point = [0, 1].map(|d| {
                    (segment[0][d] + t * (segment[1][d] - segment[0][d])).round() as isize
                });
                (-1..=1).any(|dy| {
                    (-1..=1).any(|dx| {
                        let x = point[0] + dx;
                        let y = point[1] + dy;
                        x >= 0
                            && y >= 0
                            && x < size as isize
                            && y < size as isize
                            && p[y as usize * size + x as usize] >= 0.30
                    })
                })
            })
            .count();
        if length(segment) >= 8.0 && supported as f64 / (samples + 1) as f64 >= 0.65 {
            result.push(segment);
        }
    }
    // Fitting extends fragments to the ink; merge newly touching carriers.
    let mut i = 0;
    while i < result.len() {
        let mut j = i + 1;
        while j < result.len() {
            if mergeable(result[i], result[j]) {
                let points: Vec<_> = result[i]
                    .into_iter()
                    .chain(result[j])
                    .map(|p| (p, 1.0))
                    .collect();
                result[i] = fit(&points);
                result.remove(j);
                j = i + 1;
            } else {
                j += 1;
            }
        }
        i += 1;
    }
    Ok(result
        .into_iter()
        .map(|segment| AuxiliarySegment {
            endpoints: segment
                .map(|p| p.map(|v| ((v - 32.0) / (size as f64 - 64.0)).clamp(0.0, 1.0))),
        })
        .collect())
}

fn length(s: Segment) -> f64 {
    (s[1][0] - s[0][0]).hypot(s[1][1] - s[0][1])
}

fn mergeable(a: Segment, b: Segment) -> bool {
    let len = length(a);
    let other = length(b);
    if len < 1e-8 || other < 1e-8 {
        return false;
    }
    let d = [(a[1][0] - a[0][0]) / len, (a[1][1] - a[0][1]) / len];
    let e = [(b[1][0] - b[0][0]) / other, (b[1][1] - b[0][1]) / other];
    if (d[0] * e[0] + d[1] * e[1]).abs() < 2.0f64.to_radians().cos() {
        return false;
    }
    let relative = b.map(|p| [p[0] - a[0][0], p[1] - a[0][1]]);
    if relative
        .iter()
        .any(|v| (v[0] * d[1] - v[1] * d[0]).abs() > 1.5)
    {
        return false;
    }
    let t = relative.map(|v| v[0] * d[0] + v[1] * d[1]);
    t[0].min(t[1]) <= len + 6.0 && t[0].max(t[1]) >= -6.0
}

fn fit(points: &[([f64; 2], f64)]) -> Segment {
    let mass: f64 = points.iter().map(|(_, w)| w).sum();
    let center = [0, 1].map(|d| points.iter().map(|(p, w)| p[d] * w).sum::<f64>() / mass);
    let (mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0);
    for (p, w) in points {
        let (x, y) = (p[0] - center[0], p[1] - center[1]);
        xx += w * x * x;
        xy += w * x * y;
        yy += w * y * y;
    }
    let theta = 0.5 * (2.0 * xy).atan2(xx - yy);
    let axis = [theta.cos(), theta.sin()];
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for (p, _) in points {
        let t = (p[0] - center[0]) * axis[0] + (p[1] - center[1]) * axis[1];
        lo = lo.min(t);
        hi = hi.max(t);
    }
    [lo, hi].map(|t| [center[0] + axis[0] * t, center[1] + axis[1] * t])
}

/// Attach only after physical recognition/solving. Existing vertex/edge indices
/// remain stable; all detector per-edge metadata is extended consistently.
pub fn append_auxiliary(
    fold_json: &str,
    segments: &[AuxiliarySegment],
) -> Result<String, DecodeError> {
    if segments.is_empty() {
        return Ok(fold_json.to_owned());
    }
    let mut fold: FoldDocument = serde_json::from_str(fold_json)?;
    let old_edges = fold.edges_vertices.len();
    let old_vertices = fold.vertices_coords.len();
    for segment in segments {
        if segment.endpoints.iter().flatten().any(|v| !v.is_finite()) {
            return Err(DecodeError::InvalidPixelEvidence(
                "nonfinite AUX coordinates",
            ));
        }
        let id = fold.vertices_coords.len();
        fold.vertices_coords
            .extend(segment.endpoints.map(Vec::from));
        fold.edges_vertices.push([id, id + 1]);
        fold.edges_assignment.push(Assignment::Flat);
        fold.edges_fold_angle
            .push(FoldAngle::default_for_assignment(Assignment::Flat));
    }
    if let Some(Value::Object(metadata)) = fold.extra.get_mut("cp_detector") {
        for (key, value) in metadata.iter_mut() {
            if let Value::Array(array) = value {
                if array.len() == old_edges
                    && (key.starts_with("edge_")
                        || key.starts_with("assignment_")
                        || key == "boundary_role")
                {
                    let neutral = match key.as_str() {
                        "edge_source" => json!("auxiliary"),
                        "edge_provenance" => json!([]),
                        "boundary_role" | "edge_boundary_role" => json!("none"),
                        "assignment_confidence" | "assignment_margin" | "edge_support" => {
                            json!(1.0)
                        }
                        _ => Value::Null,
                    };
                    array.extend((0..segments.len()).map(|_| neutral.clone()));
                } else if array.len() == old_vertices && key.starts_with("vertex_") {
                    array.extend((0..2 * segments.len()).map(|_| Value::Null));
                }
            }
        }
        metadata.insert("auxiliary_segments".into(), json!(segments));
    }
    Ok(serde_json::to_string(&fold)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cyan_is_preserved_as_aux_without_splitting_physical_edges() {
        let mut rgba = vec![255; 128 * 128 * 4];
        let mut p = vec![0.0; 128 * 128];
        for y in [44, 56, 68, 80] {
            for x in 34..95 {
                rgba[(y * 128 + x) * 4..(y * 128 + x) * 4 + 4]
                    .copy_from_slice(&[100, 200, 200, 255]);
                p[y * 128 + x] = 1.0;
            }
        }
        let aux = extract_auxiliary_segments(&rgba, &p, 128).unwrap();
        assert_eq!(aux.len(), 4, "{aux:?}");
        let source = r#"{"vertices_coords":[[0,0],[1,1]],"edges_vertices":[[0,1]],"edges_assignment":["M"],"edges_foldAngle":[-180],"cp_detector":{"source":"exact_solve_candidate","edge_support":[0.9]}}"#;
        let fold: Value = serde_json::from_str(&append_auxiliary(source, &aux).unwrap()).unwrap();
        assert_eq!(fold["edges_vertices"][0], json!([0, 1]));
        assert_eq!(fold["edges_assignment"], json!(["M", "F", "F", "F", "F"]));
        assert_eq!(
            fold["cp_detector"]["edge_support"]
                .as_array()
                .unwrap()
                .len(),
            5
        );
        assert_eq!(fold["edges_foldAngle"][1], 0.0);
    }

    #[test]
    fn blue_and_gray_do_not_become_cyan_aux() {
        let p = vec![1.0; 128 * 128];
        for color in [[0, 0, 255, 255], [100, 100, 100, 255]] {
            let rgba = color.repeat(128 * 128);
            assert!(
                extract_auxiliary_segments(&rgba, &p, 128)
                    .unwrap()
                    .is_empty()
            );
        }
    }
}
