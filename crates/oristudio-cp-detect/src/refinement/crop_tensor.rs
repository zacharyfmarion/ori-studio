//! Crop-tensor assembly, ported from `buildVertexRefinerCropTensor`
//! (+ `normalizedCoordGrid`, `copyCrop`).
//!
//! Builds the `[N, 11, cropSize, cropSize]` row-major NCHW batch the refiner eats:
//! 9 image-derived feature channels (cropped around each proposal, with per-channel
//! padding) plus 2 normalized coordinate-grid channels.

use super::{Proposal, SourceFeatures, crop_origin_for_center};

enum Axis {
    X,
    Y,
}

/// `buildVertexRefinerCropTensor(features, proposals, cropSize)`.
pub fn build_crop_tensor(
    features: &SourceFeatures,
    proposals: &[Proposal],
    crop_size: f64,
) -> Vec<f32> {
    let channel_count = 11usize;
    let cs = crop_size as usize;
    let crop_area = cs * cs;
    let mut tensor = vec![0f32; proposals.len() * channel_count * crop_area];
    let x_grid = normalized_coord_grid(cs, Axis::X);
    let y_grid = normalized_coord_grid(cs, Axis::Y);
    // (source map, pad value) in channel order. Channels 9/10 are the coord grids.
    let maps: [(&[f32], f32); 11] = [
        (&features.image_gray, 1.0),
        (&features.source_ink_probability, 0.0),
        (&features.source_distance_to_ink, 1.0),
        (&features.source_orientation_cos2, 0.0),
        (&features.source_orientation_sin2, 0.0),
        (&features.signed_distance_to_frame, -1.0),
        (&features.frame_edge_mask, 0.0),
        (&features.inside_paper_mask, 0.0),
        (&features.boundary_contact_prior, 0.0),
        (&x_grid, 0.0),
        (&y_grid, 0.0),
    ];
    for (batch_index, proposal) in proposals.iter().enumerate() {
        let (origin_x, origin_y) = crop_origin_for_center(proposal.x, proposal.y, crop_size);
        for (channel, &(source, pad_value)) in maps.iter().enumerate() {
            let channel_offset = batch_index * channel_count * crop_area + channel * crop_area;
            if channel >= 9 {
                tensor[channel_offset..channel_offset + crop_area].copy_from_slice(source);
            } else {
                copy_crop(
                    source,
                    features.width,
                    features.height,
                    origin_x,
                    origin_y,
                    cs,
                    pad_value,
                    &mut tensor,
                    channel_offset,
                );
            }
        }
    }
    tensor
}

/// `normalizedCoordGrid(cropSize, axis)`: a `[-1, 1]` ramp across the chosen axis.
fn normalized_coord_grid(crop_size: usize, axis: Axis) -> Vec<f32> {
    let mut output = vec![0f32; crop_size * crop_size];
    let denom = (crop_size as f64 - 1.0).max(1.0);
    for y in 0..crop_size {
        for x in 0..crop_size {
            let coord = match axis {
                Axis::X => x,
                Axis::Y => y,
            } as f64;
            output[y * crop_size + x] = (-1.0 + (2.0 * coord) / denom) as f32;
        }
    }
    output
}

/// `copyCrop`: sample `cropSize x cropSize` from `source` at the crop origin, with
/// `pad_value` outside the image bounds.
#[allow(clippy::too_many_arguments)]
fn copy_crop(
    source: &[f32],
    width: usize,
    height: usize,
    origin_x: f64,
    origin_y: f64,
    crop_size: usize,
    pad_value: f32,
    target: &mut [f32],
    target_offset: usize,
) {
    for y in 0..crop_size {
        let source_y = origin_y + y as f64;
        for x in 0..crop_size {
            let source_x = origin_x + x as f64;
            let value = if source_x >= 0.0
                && source_x < width as f64
                && source_y >= 0.0
                && source_y < height as f64
            {
                source[(source_y as usize) * width + (source_x as usize)]
            } else {
                pad_value
            };
            target[target_offset + y * crop_size + x] = value;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::refinement::Frame;

    #[test]
    fn coord_grid_spans_minus_one_to_one() {
        let grid = normalized_coord_grid(3, Axis::X);
        // Row-major 3x3: each row is [-1, 0, 1].
        assert_eq!(grid, vec![-1.0, 0.0, 1.0, -1.0, 0.0, 1.0, -1.0, 0.0, 1.0]);
        let grid_y = normalized_coord_grid(3, Axis::Y);
        assert_eq!(grid_y, vec![-1.0, -1.0, -1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0]);
    }

    #[test]
    fn crop_tensor_has_expected_shape_and_coord_channels() {
        let width = 8;
        let height = 8;
        let features = SourceFeatures {
            width,
            height,
            frame: Frame::full_image(width, height),
            image_gray: vec![0.5; width * height],
            source_ink_probability: vec![0.0; width * height],
            source_distance_to_ink: vec![1.0; width * height],
            source_orientation_cos2: vec![0.0; width * height],
            source_orientation_sin2: vec![0.0; width * height],
            signed_distance_to_frame: vec![0.0; width * height],
            frame_edge_mask: vec![0.0; width * height],
            inside_paper_mask: vec![0.0; width * height],
            boundary_contact_prior: vec![0.0; width * height],
        };
        let crop_size = 4.0;
        let cs = 4usize;
        let proposals = vec![Proposal {
            x: 4.0,
            y: 4.0,
            score: 1.0,
            provenance: vec![],
        }];
        let tensor = build_crop_tensor(&features, &proposals, crop_size);
        assert_eq!(tensor.len(), 1 * 11 * cs * cs);
        // Channel 9 (xGrid) first row is [-1, -1/3, 1/3, 1].
        let ch9 = &tensor[9 * cs * cs..10 * cs * cs];
        assert!((ch9[0] - (-1.0)).abs() < 1e-6);
        assert!((ch9[3] - 1.0).abs() < 1e-6);
    }
}
