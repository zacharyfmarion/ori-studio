//! Oriedita cyan references are FOLD `F` edges in the connected drawing graph.
//! Fold constraints use the reduced physical graph; exports restore AUX and
//! split every crossing into a shared vertex without changing physical folds.
mod graph;
use crate::decode::DecodeError;
use crate::opencv_hough_lines_p::{HoughLinesPConfig, hough_lines_p_opencv_cpu};
pub use graph::{append_auxiliary, append_solved_auxiliary, partial_auxiliary_fold};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

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
    let compiler = &decoded.report.quality_report["compiler_report"];
    decoded.fold_json = if let (Some(input), Some(solved)) = (
        compiler.get("exact_solve_input"),
        compiler.get("exact_solve"),
    ) {
        append_solved_auxiliary(
            &decoded.fold_json,
            segments,
            &serde_json::from_value(input.clone())?,
            &serde_json::from_value(solved.clone())?,
        )?
    } else {
        append_auxiliary(&decoded.fold_json, segments)?
    };
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
    let fold: treemaker_fold::FoldDocument = serde_json::from_str(&decoded.fold_json)?;
    decoded.report.edge_count = fold.edges_vertices.len();
    decoded.report.vertex_count = fold.vertices_coords.len();
    decoded.report.border_edge_count = fold
        .edges_assignment
        .iter()
        .filter(|&&a| a == treemaker_fold::Assignment::Boundary)
        .count();
    decoded.report.interior_edge_count =
        decoded.report.edge_count - decoded.report.border_edge_count;
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
    let cyan: Vec<f32> = rgba
        .chunks_exact(4)
        .map(|p| {
            let [r, g, b] = [p[0] as f32, p[1] as f32, p[2] as f32];
            let chroma = (g - r).min(b - r);
            if chroma > 6.0 && (g - b).abs() <= 12.0 + 0.25 * chroma {
                (chroma / 20.0).min(1.0)
            } else {
                0.0
            }
        })
        .collect();
    // Preserve the original seed color gate exactly. Tightening it even a few
    // RGB levels can remove the last Hough votes on a short JPEG-softened AUX.
    let seed_cyan: Vec<bool> = rgba
        .chunks_exact(4)
        .map(|pixel| {
            let [r, g, b] = [pixel[0] as f32, pixel[1] as f32, pixel[2] as f32];
            let chroma = (g - r).min(b - r);
            chroma > 12.0 && (g - b).abs() <= 12.0 + 0.25 * chroma
        })
        .collect();
    let mut p = vec![0.0; size * size];
    let mut support = Vec::new();
    for y in 32..=size - 32 {
        for x in 32..=size - 32 {
            let near =
                (y - 1..=y + 1).any(|yy| (x - 1..=x + 1).any(|xx| seed_cyan[yy * size + xx]));
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
    let mut grown = Vec::new();
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
            // The model establishes the carrier; visible cyan continues it
            // through low-confidence ends and small occlusions at crossings.
            // Do not propose carriers from color alone: JPEG speckles around
            // pale cyan otherwise create short, off-axis branches.
            let seed = segment;
            for _ in 0..4 {
                segment = grow_on_cyan(segment, &cyan, size);
            }
            grown.push((segment, seed));
        }
    }
    // A short seed's noisy angle can grow into a second approximation of a
    // longer, well-supported stroke. If that long stroke already explains the
    // original seed within 1.5 pixels, retain one carrier rather than parallel
    // duplicate reference edges. Compare seeds, not the extended guesses.
    grown.sort_by(|a, b| length(b.0).total_cmp(&length(a.0)));
    let mut result: Vec<Segment> = Vec::new();
    for (segment, seed) in grown {
        if !result.iter().any(|&other| contains_seed(other, seed)) {
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

fn contains_seed(carrier: Segment, seed: Segment) -> bool {
    let len = length(carrier);
    if len <= 0.0 {
        return false;
    }
    let d = [
        (carrier[1][0] - carrier[0][0]) / len,
        (carrier[1][1] - carrier[0][1]) / len,
    ];
    seed.iter().all(|p| {
        let v = [p[0] - carrier[0][0], p[1] - carrier[0][1]];
        let along = v[0] * d[0] + v[1] * d[1];
        (v[0] * d[1] - v[1] * d[0]).abs() <= 1.5 && along >= -1.0 && along <= len + 1.0
    })
}

fn grow_on_cyan(segment: Segment, cyan: &[f32], size: usize) -> Segment {
    let len = length(segment);
    let direction = [0, 1].map(|d| (segment[1][d] - segment[0][d]) / len);
    let mut ends = segment;
    for i in 0..2 {
        let sign = if i == 0 { -1.0 } else { 1.0 };
        let mut gap = 0;
        for step in 1..size {
            let point = [0, 1].map(|d| segment[i][d] + sign * step as f64 * direction[d]);
            if point.iter().any(|&v| v < 32.0 || v > (size - 32) as f64) {
                break;
            }
            let [x, y] = point.map(|v| v.round() as usize);
            let supported =
                (y - 1..=y + 1).any(|yy| (x - 1..=x + 1).any(|xx| cyan[yy * size + xx] >= 0.3));
            if supported {
                ends[i] = point;
                gap = 0;
            } else {
                gap += 1;
            }
            if gap > 12 {
                break;
            }
        }
    }
    // Fit the center of actual ink, not the edge of the sampling band.
    let mut points = Vec::new();
    let low = [0, 1].map(|d| (ends[0][d].min(ends[1][d]) - 3.0).floor().max(32.0) as usize);
    let high = [0, 1].map(|d| {
        (ends[0][d].max(ends[1][d]) + 3.0)
            .ceil()
            .min((size - 32) as f64) as usize
    });
    let span = length(ends);
    // Visit a narrow strip, not the line's potentially image-sized bounding
    // box. Dense reference hatching must stay fast in browser WASM.
    let major = usize::from(direction[1].abs() > direction[0].abs());
    let minor = 1 - major;
    for coordinate in low[major]..=high[major] {
        let center = ends[0][minor]
            + (coordinate as f64 - ends[0][major]) * direction[minor] / direction[major];
        let lower = (center - 4.0).floor().max(low[minor] as f64) as usize;
        let upper = (center + 4.0).ceil().min(high[minor] as f64) as usize;
        for adjacent in lower..=upper {
            let mut pixel = [0; 2];
            pixel[major] = coordinate;
            pixel[minor] = adjacent;
            let [x, y] = pixel;
            let strength = cyan[y * size + x];
            let v = [x as f64 - ends[0][0], y as f64 - ends[0][1]];
            let along = v[0] * direction[0] + v[1] * direction[1];
            if strength >= 0.3
                && (v[0] * direction[1] - v[1] * direction[0]).abs() <= 2.5
                && along >= 0.0
                && along <= span
            {
                points.push(([x as f64, y as f64], strength as f64));
            }
        }
    }
    if points.len() >= 6 {
        fit(&points)
    } else {
        segment
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cyan_is_preserved_as_aux_with_shared_crossing_vertices() {
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
        assert_ne!(fold["edges_vertices"][0], json!([0, 1]));
        assert_eq!(
            fold["edges_assignment"],
            json!([
                "M", "M", "M", "M", "M", "F", "F", "F", "F", "F", "F", "F", "F"
            ])
        );
        assert_eq!(
            fold["cp_detector"]["edge_support"]
                .as_array()
                .unwrap()
                .len(),
            13
        );
        assert_eq!(fold["edges_foldAngle"][5], 0.0);
    }

    #[test]
    fn visible_cyan_recovers_low_probability_ends_and_occluded_crossings() {
        let size = 256usize;
        let mut rgba = vec![255; size * size * 4];
        let mut p = vec![0.0; size * size];
        for x in 40..=215 {
            rgba[(100 * size + x) * 4..(100 * size + x) * 4 + 4]
                .copy_from_slice(&[215, 235, 235, 255]);
            if (75..=100).contains(&x) || (150..=185).contains(&x) {
                p[100 * size + x] = 0.9;
            }
        }
        for y in 70..130 {
            for x in 124..=129 {
                rgba[(y * size + x) * 4..(y * size + x) * 4 + 4].copy_from_slice(&[255, 0, 0, 255]);
            }
        }
        let aux = extract_auxiliary_segments(&rgba, &p, size as u32).unwrap();
        assert_eq!(aux.len(), 1, "{aux:?}");
        let xs = aux[0].endpoints.map(|v| 32.0 + v[0] * (size - 64) as f64);
        assert!((xs[0].min(xs[1]) - 40.0).abs() <= 1.0);
        assert!((xs[0].max(xs[1]) - 215.0).abs() <= 1.0);
    }

    #[test]
    fn cyan_without_a_learned_seed_and_separate_collinear_strokes_stay_separate() {
        let size = 256usize;
        let mut rgba = vec![255; size * size * 4];
        let mut p = vec![0.0; size * size];
        for x in (40..100).chain(145..215) {
            rgba[(100 * size + x) * 4..(100 * size + x) * 4 + 4]
                .copy_from_slice(&[100, 200, 200, 255]);
            p[100 * size + x] = 0.9;
        }
        assert_eq!(
            extract_auxiliary_segments(&rgba, &p, size as u32)
                .unwrap()
                .len(),
            2
        );
        p.fill(0.0);
        assert!(
            extract_auxiliary_segments(&rgba, &p, size as u32)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn dense_parallel_references_keep_their_identity_through_crossing_occlusions() {
        let size = 256usize;
        let mut rgba = vec![255; size * size * 4];
        let mut p = vec![0.0; size * size];
        for y in (40..=210).step_by(10) {
            for x in 40..=215 {
                rgba[(y * size + x) * 4..(y * size + x) * 4 + 4]
                    .copy_from_slice(&[100, 200, 200, 255]);
                if (60..=195).contains(&x) && !(114..=140).contains(&x) {
                    p[y * size + x] = 1.0;
                }
            }
        }
        for y in 32..224 {
            for x in 125..=129 {
                rgba[(y * size + x) * 4..(y * size + x) * 4 + 4].copy_from_slice(&[0, 0, 255, 255]);
            }
        }
        let aux = extract_auxiliary_segments(&rgba, &p, size as u32).unwrap();
        assert_eq!(aux.len(), 18, "{aux:?}");
        for s in aux {
            let x = s.endpoints.map(|p| 32.0 + p[0] * 192.0);
            assert!((x[0].min(x[1]) - 40.0).abs() < 1.0);
            assert!((x[0].max(x[1]) - 215.0).abs() < 1.0);
            assert!((s.endpoints[0][1] - s.endpoints[1][1]).abs() < 1e-5);
        }
    }

    #[test]
    fn short_jpeg_tinted_cyan_keeps_the_original_seed_color_tolerance() {
        let mut rgba = vec![255; 128 * 128 * 4];
        let mut p = vec![0.0; 128 * 128];
        for x in 40..60 {
            rgba[(64 * 128 + x) * 4..(64 * 128 + x) * 4 + 4].copy_from_slice(&[215, 230, 240, 255]);
            p[64 * 128 + x] = 0.9;
        }
        let aux = extract_auxiliary_segments(&rgba, &p, 128).unwrap();
        assert_eq!(aux.len(), 1);
        assert!(length(aux[0].endpoints) > 18.0 / 64.0, "{aux:?}");
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
