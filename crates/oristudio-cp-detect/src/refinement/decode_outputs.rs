//! Per-crop vertex decode, ported from `decodeVertexRefinerOutputTensors`
//! (+ peak/argmax/ray/boundary helpers).
//!
//! Reads the 7 refiner output tensors and produces raw decoded vertices in image
//! (pixel) space.

use super::{
    Frame, Proposal, RAY_BINS, Side, Tensor, VertexRefinerParams, clamp, clamp01, cmp_f64,
    crop_origin_for_center, sigmoid, vertex_kind_name,
};

/// The 7 refiner output tensors (NCHW per crop).
#[derive(Debug, Clone)]
pub struct RefinerOutputs {
    pub vertex_heatmap: Tensor,
    pub vertex_offset: Tensor,
    pub vertex_kind: Tensor,
    pub degree: Tensor,
    pub incident_rays: Tensor,
    pub boundary_contact_heatmap: Tensor,
    pub boundary_side: Tensor,
}

/// A raw decoded vertex (mirrors `VertexRefinerDecodedVertex`). `kind`/
/// `boundary_side_id` are derived from `kind_id`/`boundary_side`.
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedVertex {
    pub x: f64,
    pub y: f64,
    pub score: f64,
    pub kind_id: usize,
    pub degree_class: usize,
    pub degree: usize,
    pub ray_bins: Vec<usize>,
    pub boundary_side: Option<Side>,
    pub side_coordinate: Option<f64>,
    pub crop_index: usize,
}

/// `decodeVertexRefinerOutputTensors(outputs, proposals, options)`.
pub fn decode_output_tensors(
    outputs: &RefinerOutputs,
    proposals: &[Proposal],
    frame: Frame,
    params: &VertexRefinerParams,
) -> Vec<DecodedVertex> {
    let crop_size = params.crop_size;
    let cs = crop_size as usize;
    let nms_radius = params.nms_radius_px;
    let heatmap_threshold = params.heatmap_threshold;
    let boundary_threshold = params.boundary_heatmap_threshold;
    let ray_threshold = params.ray_threshold;
    let mut vertices = Vec::new();
    for (crop_index, proposal) in proposals.iter().enumerate() {
        let (origin_x, origin_y) = crop_origin_for_center(proposal.x, proposal.y, crop_size);
        let mut peaks = peak_entries(
            &outputs.vertex_heatmap,
            crop_index,
            0,
            cs,
            heatmap_threshold,
            nms_radius,
            false,
        );
        peaks.extend(peak_entries(
            &outputs.boundary_contact_heatmap,
            crop_index,
            0,
            cs,
            boundary_threshold,
            nms_radius,
            true,
        ));
        let mut deduped = dedupe_peak_entries(peaks);
        deduped.sort_by(|a, b| {
            cmp_f64(b.score, a.score)
                .then(a.row.cmp(&b.row))
                .then(a.col.cmp(&b.col))
        });
        for peak in deduped {
            let offset_base = tensor_offset(
                &outputs.vertex_offset,
                crop_index,
                0,
                peak.row,
                peak.col,
                cs,
            );
            let dx = outputs.vertex_offset.data[offset_base] as f64;
            let dy = outputs.vertex_offset.data[offset_base + cs * cs] as f64;
            let mut kind_id =
                argmax_channel(&outputs.vertex_kind, crop_index, peak.row, peak.col, cs);
            if peak.boundary_candidate && (kind_id == 0 || kind_id == 1) {
                kind_id = 2;
            }
            let degree_class = argmax_channel(&outputs.degree, crop_index, peak.row, peak.col, cs);
            let mut x = origin_x + peak.col as f64 + dx;
            let mut y = origin_y + peak.row as f64 + dy;
            let kind_name = vertex_kind_name(kind_id);
            let boundary_side_id =
                argmax_channel(&outputs.boundary_side, crop_index, peak.row, peak.col, cs);
            let predicted_side = Side::ALL.get(boundary_side_id).copied();
            let boundary_like = peak.boundary_candidate || kind_name == "boundary_contact";
            let mut boundary_side: Option<Side> = if boundary_like {
                Some(predicted_side.unwrap_or_else(|| nearest_frame_side(x, y, frame)))
            } else {
                None
            };
            if boundary_like {
                let side = boundary_side.unwrap_or_else(|| nearest_frame_side(x, y, frame));
                boundary_side = Some(side);
                let (sx, sy) = snap_point_to_frame(x, y, frame, side);
                x = sx;
                y = sy;
                kind_id = 2;
            }
            let side_coordinate =
                boundary_side.map(|side| boundary_side_coordinate(x, y, frame, side));
            let ray_bins = active_ray_bins(
                &outputs.incident_rays,
                crop_index,
                peak.row,
                peak.col,
                cs,
                ray_threshold,
            );
            vertices.push(DecodedVertex {
                x,
                y,
                score: peak.score,
                kind_id,
                degree_class,
                degree: degree_class,
                ray_bins,
                boundary_side,
                side_coordinate,
                crop_index,
            });
        }
    }
    vertices
}

struct PeakEntry {
    score: f64,
    row: usize,
    col: usize,
    boundary_candidate: bool,
}

/// `peakEntries`: local-maxima above `threshold` within an NMS radius.
fn peak_entries(
    tensor: &Tensor,
    batch_index: usize,
    channel: usize,
    crop_size: usize,
    threshold: f64,
    radius: f64,
    boundary_candidate: bool,
) -> Vec<PeakEntry> {
    let radius = radius as i64;
    let limit = crop_size as i64 - 1;
    let mut peaks = Vec::new();
    for row in 0..crop_size {
        for col in 0..crop_size {
            let score = sigmoid(
                tensor.data[tensor_offset(tensor, batch_index, channel, row, col, crop_size)]
                    as f64,
            );
            if score < threshold {
                continue;
            }
            let r0 = (row as i64 - radius).max(0) as usize;
            let r1 = (row as i64 + radius).min(limit) as usize;
            let c0 = (col as i64 - radius).max(0) as usize;
            let c1 = (col as i64 + radius).min(limit) as usize;
            let mut is_peak = true;
            'scan: for yy in r0..=r1 {
                for xx in c0..=c1 {
                    let neighbor = sigmoid(
                        tensor.data[tensor_offset(tensor, batch_index, channel, yy, xx, crop_size)]
                            as f64,
                    );
                    if neighbor > score + 1e-6 {
                        is_peak = false;
                        break 'scan;
                    }
                }
            }
            if is_peak {
                peaks.push(PeakEntry {
                    score,
                    row,
                    col,
                    boundary_candidate,
                });
            }
        }
    }
    peaks
}

/// `dedupePeakEntries`: collapse duplicates at the same `(row, col)`, keeping the
/// max score and OR-ing the boundary flag, in first-seen order.
fn dedupe_peak_entries(peaks: Vec<PeakEntry>) -> Vec<PeakEntry> {
    use std::collections::HashMap;
    let mut order: Vec<(usize, usize)> = Vec::new();
    let mut map: HashMap<(usize, usize), PeakEntry> = HashMap::new();
    for peak in peaks {
        let key = (peak.row, peak.col);
        if let Some(prev) = map.get_mut(&key) {
            prev.score = prev.score.max(peak.score);
            prev.boundary_candidate = peak.boundary_candidate || prev.boundary_candidate;
        } else {
            order.push(key);
            map.insert(key, peak);
        }
    }
    order
        .into_iter()
        .map(|key| map.remove(&key).expect("key inserted above"))
        .collect()
}

/// `tensorOffset`: NCHW flat index.
fn tensor_offset(
    tensor: &Tensor,
    batch_index: usize,
    channel: usize,
    row: usize,
    col: usize,
    crop_size: usize,
) -> usize {
    let channels = tensor.channels();
    batch_index * channels * crop_size * crop_size
        + channel * crop_size * crop_size
        + row * crop_size
        + col
}

/// `argmaxChannel`: channel with the max value at `(row, col)`.
fn argmax_channel(
    tensor: &Tensor,
    batch_index: usize,
    row: usize,
    col: usize,
    crop_size: usize,
) -> usize {
    let channels = tensor.channels();
    let mut best_index = 0;
    let mut best_value = f64::NEG_INFINITY;
    for channel in 0..channels {
        let value =
            tensor.data[tensor_offset(tensor, batch_index, channel, row, col, crop_size)] as f64;
        if value > best_value {
            best_value = value;
            best_index = channel;
        }
    }
    best_index
}

/// `activeRayBins`: ray channels whose sigmoid is `>= threshold`.
fn active_ray_bins(
    tensor: &Tensor,
    batch_index: usize,
    row: usize,
    col: usize,
    crop_size: usize,
    threshold: f64,
) -> Vec<usize> {
    // TS: Math.min(tensor.dims[1] ?? RAY_BINS, RAY_BINS).
    let max_channels = tensor
        .dims
        .get(1)
        .copied()
        .unwrap_or(RAY_BINS)
        .min(RAY_BINS);
    let mut bins = Vec::new();
    for channel in 0..max_channels {
        let value = sigmoid(
            tensor.data[tensor_offset(tensor, batch_index, channel, row, col, crop_size)] as f64,
        );
        if value >= threshold {
            bins.push(channel);
        }
    }
    bins
}

/// `nearestFrameSide` (`top, right, bottom, left` order; ties keep the earlier side).
fn nearest_frame_side(x: f64, y: f64, frame: Frame) -> Side {
    let candidates = [
        (Side::Top, (y - frame.y_min).abs()),
        (Side::Right, (x - frame.x_max).abs()),
        (Side::Bottom, (y - frame.y_max).abs()),
        (Side::Left, (x - frame.x_min).abs()),
    ];
    let mut best = candidates[0].0;
    let mut best_distance = candidates[0].1;
    for &(side, distance) in candidates.iter().skip(1) {
        if distance < best_distance {
            best = side;
            best_distance = distance;
        }
    }
    best
}

/// `snapPointToFrame`.
fn snap_point_to_frame(x: f64, y: f64, frame: Frame, side: Side) -> (f64, f64) {
    match side {
        Side::Top => (clamp(x, frame.x_min, frame.x_max), frame.y_min),
        Side::Right => (frame.x_max, clamp(y, frame.y_min, frame.y_max)),
        Side::Bottom => (clamp(x, frame.x_min, frame.x_max), frame.y_max),
        Side::Left => (frame.x_min, clamp(y, frame.y_min, frame.y_max)),
    }
}

/// `boundarySideCoordinate`: normalized `[0, 1]` position along the edge.
fn boundary_side_coordinate(x: f64, y: f64, frame: Frame, side: Side) -> f64 {
    let span_x = (frame.x_max - frame.x_min).max(1.0);
    let span_y = (frame.y_max - frame.y_min).max(1.0);
    match side {
        Side::Top | Side::Bottom => clamp01((x - frame.x_min) / span_x),
        Side::Left | Side::Right => clamp01((y - frame.y_min) / span_y),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nearest_side_picks_closest_edge() {
        let frame = Frame {
            x_min: 0.0,
            y_min: 0.0,
            x_max: 100.0,
            y_max: 100.0,
        };
        assert_eq!(nearest_frame_side(50.0, 2.0, frame), Side::Top);
        assert_eq!(nearest_frame_side(98.0, 50.0, frame), Side::Right);
        assert_eq!(nearest_frame_side(50.0, 99.0, frame), Side::Bottom);
        assert_eq!(nearest_frame_side(1.0, 50.0, frame), Side::Left);
    }

    #[test]
    fn snap_and_side_coordinate_project_onto_edge() {
        let frame = Frame {
            x_min: 0.0,
            y_min: 0.0,
            x_max: 100.0,
            y_max: 100.0,
        };
        assert_eq!(
            snap_point_to_frame(40.0, 7.0, frame, Side::Top),
            (40.0, 0.0)
        );
        // Clamp beyond the edge span.
        assert_eq!(
            snap_point_to_frame(140.0, 7.0, frame, Side::Top),
            (100.0, 0.0)
        );
        assert!((boundary_side_coordinate(25.0, 0.0, frame, Side::Top) - 0.25).abs() < 1e-9);
    }
}
