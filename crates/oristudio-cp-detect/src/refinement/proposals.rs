//! Proposal/region selection, ported from `generateVertexRefinerProposals` and
//! its dense-junction-region and sliding-window paths (+ helpers).
//!
//! Pure geometry over the dense junction heatmap (and frame); the refiner model
//! plays no part in choosing crops.

use std::cmp::Ordering;

use super::{
    Frame, Proposal, ProposalMode, RefinementRegion, Tensor, VertexRefinerParams, clamp, clamp_int,
    cmp_f64, crop_origin_for_center, js_round, sigmoid,
};

const DENSE_REGION_BORDER_CROP_EXCLUSION_MARGIN_PX: f64 = 1.0;

/// `generateVertexRefinerProposals` — dispatches on proposal mode.
pub fn generate_proposals(
    width: usize,
    height: usize,
    junction_logits: Option<&Tensor>,
    frame: Frame,
    params: &VertexRefinerParams,
) -> Vec<Proposal> {
    let crop_size = params.crop_size;
    let proposal_cap = params.proposal_cap.floor().max(1.0) as usize;
    match params.proposal_mode {
        ProposalMode::DenseJunctionRegions => {
            let Some(junction) = junction_logits else {
                return Vec::new();
            };
            generate_dense_junction_region_proposals(
                junction,
                width,
                height,
                crop_size,
                frame,
                proposal_cap,
                params.dense_region_junction_threshold,
                params.dense_region_min_peaks,
                params.dense_region_max_overlap_fraction,
            )
        }
        ProposalMode::FullCoverage => {
            let sliding = generate_sliding_window_proposals(
                width,
                height,
                crop_size,
                frame,
                proposal_cap,
                params.grid_stride_px,
            );
            select_proposals(sliding, crop_size, proposal_cap, width, height)
        }
    }
}

/// `refinementRegionForProposal`.
pub fn refinement_region_for_proposal(
    proposal: &Proposal,
    crop_size: f64,
    image_width: usize,
    image_height: usize,
) -> RefinementRegion {
    let (origin_x, origin_y) = crop_origin_for_center(proposal.x, proposal.y, crop_size);
    RefinementRegion {
        x_min: clamp(origin_x, 0.0, image_width as f64 - 1.0),
        y_min: clamp(origin_y, 0.0, image_height as f64 - 1.0),
        x_max: clamp(origin_x + crop_size, 0.0, image_width as f64 - 1.0),
        y_max: clamp(origin_y + crop_size, 0.0, image_height as f64 - 1.0),
    }
}

struct Peak {
    x: f64,
    y: f64,
    score: f64,
}

/// `generateDenseJunctionRegionVertexRefinerProposals`.
#[allow(clippy::too_many_arguments)]
fn generate_dense_junction_region_proposals(
    junction: &Tensor,
    image_width: usize,
    image_height: usize,
    crop_size: f64,
    frame: Frame,
    proposal_cap: usize,
    junction_threshold: f64,
    min_peaks_per_crop: f64,
    max_overlap_fraction: f64,
) -> Vec<Proposal> {
    let peaks = dense_junction_peaks(
        junction,
        image_width,
        image_height,
        frame,
        junction_threshold,
        4.0,
    );
    let min_peaks = min_peaks_per_crop.floor().max(1.0) as usize;
    let mut candidates: Vec<(Proposal, usize)> = peaks
        .iter()
        .filter_map(|peak| dense_junction_crop_candidate(peak, &peaks, crop_size, frame))
        .filter(|(proposal, count)| {
            *count >= min_peaks && !dense_region_crop_touches_frame(proposal, crop_size, frame)
        })
        .collect();
    candidates.sort_by(|(left_p, left_c), (right_p, right_c)| {
        right_c
            .cmp(left_c)
            .then(cmp_f64(right_p.score, left_p.score))
            .then(cmp_f64(left_p.y, right_p.y))
            .then(cmp_f64(left_p.x, right_p.x))
    });
    let max_overlap = clamp(max_overlap_fraction, 0.0, 1.0);
    let mut selected: Vec<Proposal> = Vec::new();
    for (proposal, _) in candidates {
        if selected.len() >= proposal_cap {
            break;
        }
        if selected
            .iter()
            .any(|existing| crop_overlap_fraction(existing, &proposal, crop_size) > max_overlap)
        {
            continue;
        }
        selected.push(proposal);
    }
    merge_proposals(&selected, 1e-3)
}

/// `denseJunctionPeaks`.
fn dense_junction_peaks(
    junction: &Tensor,
    image_width: usize,
    image_height: usize,
    frame: Frame,
    threshold: f64,
    nms_radius_px: f64,
) -> Vec<Peak> {
    let Some((width, height)) = junction.spatial_shape() else {
        return Vec::new();
    };
    let threshold = clamp(threshold, 0.0, 1.0);
    let scale = (width as f64 / image_width as f64).max(height as f64 / image_height as f64);
    let map_radius = js_round(nms_radius_px * scale).max(1.0) as i64;
    let mut peaks: Vec<Peak> = Vec::new();
    for row in 0..height {
        for col in 0..width {
            let score = sigmoid(junction.data[row * width + col] as f64);
            if score < threshold {
                continue;
            }
            if !is_dense_map_local_max(&junction.data, width, height, row, col, score, map_radius) {
                continue;
            }
            let x = map_coord_to_image_coord(col as f64, width, image_width);
            let y = map_coord_to_image_coord(row as f64, height, image_height);
            if x >= frame.x_min && x <= frame.x_max && y >= frame.y_min && y <= frame.y_max {
                peaks.push(Peak { x, y, score });
            }
        }
    }
    peaks.sort_by(|a, b| {
        cmp_f64(b.score, a.score)
            .then(cmp_f64(a.y, b.y))
            .then(cmp_f64(a.x, b.x))
    });
    peaks
}

/// `isDenseMapLocalMax`.
fn is_dense_map_local_max(
    data: &[f32],
    width: usize,
    height: usize,
    row: usize,
    col: usize,
    score: f64,
    radius: i64,
) -> bool {
    let r0 = (row as i64 - radius).max(0) as usize;
    let r1 = (row as i64 + radius).min(height as i64 - 1) as usize;
    let c0 = (col as i64 - radius).max(0) as usize;
    let c1 = (col as i64 + radius).min(width as i64 - 1) as usize;
    for yy in r0..=r1 {
        for xx in c0..=c1 {
            if yy == row && xx == col {
                continue;
            }
            if sigmoid(data[yy * width + xx] as f64) > score + 1e-6 {
                return false;
            }
        }
    }
    true
}

/// `mapCoordToImageCoord`.
fn map_coord_to_image_coord(coord: f64, map_size: usize, image_size: usize) -> f64 {
    if map_size <= 1 {
        return (image_size as f64 - 1.0) / 2.0;
    }
    (coord * (image_size as f64 - 1.0)) / (map_size as f64 - 1.0)
}

/// `denseJunctionCropCandidate`.
fn dense_junction_crop_candidate(
    peak: &Peak,
    peaks: &[Peak],
    crop_size: f64,
    frame: Frame,
) -> Option<(Proposal, usize)> {
    let half = crop_size / 2.0;
    let x = clamp(peak.x, frame.x_min + half, frame.x_max - half);
    let y = clamp(peak.y, frame.y_min + half, frame.y_max - half);
    let inside: Vec<&Peak> = peaks
        .iter()
        .filter(|candidate| (candidate.x - x).abs() <= half && (candidate.y - y).abs() <= half)
        .collect();
    if inside.is_empty() {
        return None;
    }
    let score_sum: f64 = inside.iter().map(|candidate| candidate.score).sum();
    let count = inside.len();
    Some((
        Proposal {
            x,
            y,
            score: score_sum / (count.max(1) as f64),
            provenance: vec![format!("dense_junction_region:{count}")],
        },
        count,
    ))
}

/// `denseRegionCropTouchesFrame`.
fn dense_region_crop_touches_frame(proposal: &Proposal, crop_size: f64, frame: Frame) -> bool {
    let half = crop_size / 2.0;
    let margin = DENSE_REGION_BORDER_CROP_EXCLUSION_MARGIN_PX;
    proposal.x - half <= frame.x_min + margin
        || proposal.x + half >= frame.x_max - margin
        || proposal.y - half <= frame.y_min + margin
        || proposal.y + half >= frame.y_max - margin
}

/// `cropOverlapFraction`.
fn crop_overlap_fraction(left: &Proposal, right: &Proposal, crop_size: f64) -> f64 {
    let (left_x, left_y) = crop_origin_for_center(left.x, left.y, crop_size);
    let (right_x, right_y) = crop_origin_for_center(right.x, right.y, crop_size);
    let overlap_x = ((left_x + crop_size).min(right_x + crop_size) - left_x.max(right_x)).max(0.0);
    let overlap_y = ((left_y + crop_size).min(right_y + crop_size) - left_y.max(right_y)).max(0.0);
    (overlap_x * overlap_y) / (crop_size * crop_size).max(1.0)
}

/// `mergeVertexRefinerProposals`.
fn merge_proposals(proposals: &[Proposal], radius_px: f64) -> Vec<Proposal> {
    let mut sorted: Vec<Proposal> = proposals.to_vec();
    sorted.sort_by(proposal_compare);
    let mut merged: Vec<Proposal> = Vec::new();
    for proposal in sorted {
        let match_index = merged.iter().position(|existing| {
            (existing.x - proposal.x).hypot(existing.y - proposal.y) <= radius_px
        });
        match match_index {
            None => merged.push(proposal),
            Some(index) => {
                let existing = &merged[index];
                let existing_weight = existing.score.max(1e-3);
                let proposal_weight = proposal.score.max(1e-3);
                let total = existing_weight + proposal_weight;
                let mut provenance: Vec<String> = existing
                    .provenance
                    .iter()
                    .chain(proposal.provenance.iter())
                    .cloned()
                    .collect();
                provenance.sort();
                provenance.dedup();
                merged[index] = Proposal {
                    x: (existing.x * existing_weight + proposal.x * proposal_weight) / total,
                    y: (existing.y * existing_weight + proposal.y * proposal_weight) / total,
                    score: existing.score.max(proposal.score),
                    provenance,
                };
            }
        }
    }
    merged.sort_by(proposal_compare);
    merged
}

/// `proposalCompare`.
fn proposal_compare(left: &Proposal, right: &Proposal) -> Ordering {
    cmp_f64(proposal_quality(right), proposal_quality(left))
        .then(cmp_f64(left.y, right.y))
        .then(cmp_f64(left.x, right.x))
        .then(left.provenance.join(",").cmp(&right.provenance.join(",")))
}

/// `proposalQuality`: score plus the best provenance bonus.
fn proposal_quality(proposal: &Proposal) -> f64 {
    let mut best_bonus = 0.0f64;
    for key in &proposal.provenance {
        let bonus = match key.as_str() {
            "square_frame_corner" => 0.95,
            "boundary_contact_top"
            | "boundary_contact_right"
            | "boundary_contact_bottom"
            | "boundary_contact_left" => 0.5,
            "sliding_window" => 0.1,
            _ => 0.0,
        };
        if bonus > best_bonus {
            best_bonus = bonus;
        }
    }
    proposal.score + best_bonus
}

/// `generateSlidingWindowVertexRefinerProposals`.
fn generate_sliding_window_proposals(
    width: usize,
    height: usize,
    crop_size: f64,
    frame: Frame,
    proposal_cap: usize,
    stride_px: f64,
) -> Vec<Proposal> {
    let _ = (width, height);
    let stride = stride_px.max(8.0);
    let boundary_stride = (stride / 2.0).min(crop_size / 3.0).max(8.0);
    let mut boundary_proposals: Vec<Proposal> = Vec::new();
    for (x, y) in [
        (frame.x_min, frame.y_min),
        (frame.x_max, frame.y_min),
        (frame.x_max, frame.y_max),
        (frame.x_min, frame.y_max),
    ] {
        boundary_proposals.push(Proposal {
            x,
            y,
            score: 1.0,
            provenance: vec!["square_frame_corner".to_string()],
        });
    }
    for x in grid_centers(frame.x_min, frame.x_max, boundary_stride) {
        boundary_proposals.push(Proposal {
            x,
            y: frame.y_min,
            score: 0.85,
            provenance: vec!["boundary_contact_top".to_string()],
        });
        boundary_proposals.push(Proposal {
            x,
            y: frame.y_max,
            score: 0.85,
            provenance: vec!["boundary_contact_bottom".to_string()],
        });
    }
    for y in grid_centers(frame.y_min, frame.y_max, boundary_stride) {
        boundary_proposals.push(Proposal {
            x: frame.x_min,
            y,
            score: 0.85,
            provenance: vec!["boundary_contact_left".to_string()],
        });
        boundary_proposals.push(Proposal {
            x: frame.x_max,
            y,
            score: 0.85,
            provenance: vec!["boundary_contact_right".to_string()],
        });
    }
    let merged_boundary = merge_proposals(&boundary_proposals, 1e-3);
    let interior_budget = proposal_cap.saturating_sub(merged_boundary.len());
    let (x_count, y_count) = interior_grid_counts(frame, crop_size, interior_budget);
    let x_centers = evenly_spaced_interior_centers(frame.x_min, frame.x_max, crop_size, x_count);
    let y_centers = evenly_spaced_interior_centers(frame.y_min, frame.y_max, crop_size, y_count);
    let mut proposals = merged_boundary;
    for &y in &y_centers {
        for &x in &x_centers {
            proposals.push(Proposal {
                x,
                y,
                score: 0.35,
                provenance: vec!["sliding_window".to_string()],
            });
        }
    }
    merge_proposals(&proposals, 1e-3)
}

/// `gridCenters`.
fn grid_centers(start: f64, end: f64, stride: f64) -> Vec<f64> {
    if end <= start {
        return vec![(start + end) / 2.0];
    }
    let mut centers = Vec::new();
    let mut value = start;
    while value <= end + 1e-6 {
        centers.push(value);
        value += stride;
    }
    if (centers.last().copied().unwrap_or(start) - end).abs() > stride * 0.35 {
        centers.push(end);
    }
    centers
}

/// `interiorGridCounts`.
fn interior_grid_counts(frame: Frame, crop_size: f64, budget: usize) -> (usize, usize) {
    if budget == 0 {
        return (0, 0);
    }
    let width = (frame.x_max - frame.x_min).max(1.0);
    let height = (frame.y_max - frame.y_min).max(1.0);
    let min_x = (width / crop_size).ceil().max(1.0) as i64;
    let min_y = (height / crop_size).ceil().max(1.0) as i64;
    let aspect = clamp(width / height, 0.25, 4.0);
    let budget_i = budget as i64;
    let budget_f = budget as f64;
    if min_x * min_y > budget_i {
        let mut x_count = (budget_f * aspect).sqrt().floor().max(1.0) as i64;
        let mut y_count = (budget_f / (x_count as f64).max(1.0)).floor().max(1.0) as i64;
        while x_count * y_count > budget_i && y_count > 1 {
            y_count -= 1;
        }
        while x_count * y_count > budget_i && x_count > 1 {
            x_count -= 1;
        }
        return (x_count as usize, y_count as usize);
    }
    let mut x_count = (budget_f * aspect).sqrt().floor().max(min_x as f64) as i64;
    let mut y_count = (budget_f / aspect).sqrt().floor().max(min_y as f64) as i64;
    while x_count * y_count > budget_i {
        let x_surplus = x_count as f64 / min_x as f64;
        let y_surplus = y_count as f64 / min_y as f64;
        if x_surplus >= y_surplus && x_count > min_x {
            x_count -= 1;
        } else if y_count > min_y {
            y_count -= 1;
        } else {
            break;
        }
    }
    (x_count as usize, y_count as usize)
}

/// `evenlySpacedInteriorCenters`.
fn evenly_spaced_interior_centers(
    frame_min: f64,
    frame_max: f64,
    crop_size: f64,
    count: usize,
) -> Vec<f64> {
    if count == 0 {
        return Vec::new();
    }
    let half = crop_size / 2.0;
    let start = frame_min + half;
    let end = frame_max - half;
    if count == 1 || end <= start {
        return vec![(frame_min + frame_max) / 2.0];
    }
    (0..count)
        .map(|index| start + ((end - start) * index as f64) / (count as f64 - 1.0).max(1.0))
        .collect()
}

/// `selectVertexRefinerProposals`: greedy quality/coverage selection.
fn select_proposals(
    proposals: Vec<Proposal>,
    crop_size: f64,
    max_count: usize,
    image_width: usize,
    image_height: usize,
) -> Vec<Proposal> {
    let mut ranked = proposals;
    ranked.sort_by(proposal_compare);
    if ranked.len() <= max_count {
        return ranked;
    }
    let cell_size = js_round(crop_size / 12.0).max(4.0) as usize;
    let covered_width = ((image_width as f64 / cell_size as f64).ceil() as usize).max(1);
    let covered_height = ((image_height as f64 / cell_size as f64).ceil() as usize).max(1);
    let mut covered = vec![0u8; covered_width * covered_height];
    let mut remaining = ranked;
    let mut selected: Vec<Proposal> = Vec::new();
    while !remaining.is_empty() && selected.len() < max_count {
        let mut best_index = 0;
        let mut best_value = f64::NEG_INFINITY;
        for (index, proposal) in remaining.iter().enumerate() {
            let quality = proposal_quality(proposal);
            let coverage =
                new_coverage_fraction(proposal, &covered, covered_width, cell_size, crop_size);
            let value = 0.55 * quality + 0.45 * coverage;
            if value > best_value {
                best_value = value;
                best_index = index;
            }
        }
        let proposal = remaining.remove(best_index);
        mark_covered(&proposal, &mut covered, covered_width, cell_size, crop_size);
        selected.push(proposal);
    }
    selected
}

/// `newCoverageFraction`.
fn new_coverage_fraction(
    proposal: &Proposal,
    covered: &[u8],
    covered_width: usize,
    cell_size: usize,
    crop_size: f64,
) -> f64 {
    let (x0, y0) = crop_origin_for_center(proposal.x, proposal.y, crop_size);
    let cell = cell_size as f64;
    let col0 = clamp_int((x0 / cell).floor(), 0.0, covered_width as f64 - 1.0) as usize;
    let row0 = (y0 / cell).floor().max(0.0) as usize;
    let col1 = clamp_int(
        ((x0 + crop_size) / cell).ceil(),
        col0 as f64 + 1.0,
        covered_width as f64,
    ) as usize;
    let row1 = ((y0 + crop_size) / cell).ceil().max(row0 as f64 + 1.0) as usize;
    let mut total = 0usize;
    let mut fresh = 0usize;
    for row in row0..row1 {
        for col in col0..col1 {
            let idx = row * covered_width + col;
            if idx >= covered.len() {
                continue;
            }
            total += 1;
            if covered[idx] == 0 {
                fresh += 1;
            }
        }
    }
    if total == 0 {
        0.0
    } else {
        fresh as f64 / total as f64
    }
}

/// `markCovered`.
fn mark_covered(
    proposal: &Proposal,
    covered: &mut [u8],
    covered_width: usize,
    cell_size: usize,
    crop_size: f64,
) {
    let (x0, y0) = crop_origin_for_center(proposal.x, proposal.y, crop_size);
    let cell = cell_size as f64;
    let col0 = clamp_int((x0 / cell).floor(), 0.0, covered_width as f64 - 1.0) as usize;
    let row0 = (y0 / cell).floor().max(0.0) as usize;
    let col1 = clamp_int(
        ((x0 + crop_size) / cell).ceil(),
        col0 as f64 + 1.0,
        covered_width as f64,
    ) as usize;
    let row1 = ((y0 + crop_size) / cell).ceil().max(row0 as f64 + 1.0) as usize;
    for row in row0..row1 {
        for col in col0..col1 {
            let idx = row * covered_width + col;
            if idx < covered.len() {
                covered[idx] = 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a `width x height` junction logit map (single channel) with the given
    /// peak logits placed at pixel coords.
    fn junction_map(size: usize, peaks: &[(usize, usize, f32)]) -> Tensor {
        let mut data = vec![-10.0f32; size * size];
        for &(row, col, logit) in peaks {
            data[row * size + col] = logit;
        }
        Tensor {
            data,
            dims: vec![1, 1, size, size],
        }
    }

    #[test]
    fn dense_region_requires_min_peaks_and_avoids_border() {
        // 64x64 dense map == image (so map==image coords). Cluster of 3 peaks near
        // the center; crop_size 16, frame inset so center crop doesn't touch border.
        let size = 64;
        let peaks = [(30, 30, 8.0f32), (30, 33, 8.0), (33, 31, 8.0)];
        let junction = junction_map(size, &peaks);
        let frame = Frame {
            x_min: 4.0,
            y_min: 4.0,
            x_max: 59.0,
            y_max: 59.0,
        };
        let proposals = generate_dense_junction_region_proposals(
            &junction, size, size, 16.0, frame, 256, 0.35, 3.0, 0.0,
        );
        assert_eq!(proposals.len(), 1);
        assert!(proposals[0].provenance[0].starts_with("dense_junction_region:"));

        // With min_peaks = 4, the 3-peak cluster is rejected.
        let none = generate_dense_junction_region_proposals(
            &junction, size, size, 16.0, frame, 256, 0.35, 4.0, 0.0,
        );
        assert!(none.is_empty());
    }

    #[test]
    fn map_coord_handles_degenerate_map() {
        assert_eq!(map_coord_to_image_coord(0.0, 1, 100), 49.5);
        assert_eq!(map_coord_to_image_coord(0.0, 64, 64), 0.0);
        assert_eq!(map_coord_to_image_coord(63.0, 64, 64), 63.0);
    }
}
