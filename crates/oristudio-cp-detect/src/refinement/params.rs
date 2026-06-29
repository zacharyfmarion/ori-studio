//! Resolved vertex-refiner parameters.
//!
//! In the TS these are resolved per call as `options.X ?? manifest.inference.X ??
//! default`. Here the caller (wasm shim or benchmark) does that resolution and
//! passes concrete values; the `Default` mirrors the product defaults
//! (`cpDetectTypes` constants + the pipeline fallbacks). Threshold fields that
//! come only from the manifest (`heatmap_threshold`, `boundary_heatmap_threshold`)
//! have placeholder defaults and are expected to be overwritten from the manifest.

use super::Frame;

/// `VertexRefinerProposalMode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposalMode {
    FullCoverage,
    DenseJunctionRegions,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VertexRefinerParams {
    pub crop_size: f64,
    pub frame: Option<Frame>,
    pub proposal_mode: ProposalMode,
    pub proposal_cap: f64,
    pub dense_region_junction_threshold: f64,
    pub dense_region_min_peaks: f64,
    pub dense_region_max_overlap_fraction: f64,
    pub grid_stride_px: f64,
    pub heatmap_threshold: f64,
    pub boundary_heatmap_threshold: f64,
    pub nms_radius_px: f64,
    pub merge_radius_px: f64,
    pub boundary_merge_radius_px: f64,
    pub min_support: f64,
    pub min_support_fraction: f64,
    pub split_same_crop_conflicts: bool,
    pub split_min_support_fraction: f64,
    pub ray_threshold: f64,
}

impl Default for VertexRefinerParams {
    fn default() -> Self {
        Self {
            crop_size: 96.0,
            frame: None,
            // Product default (CP_DETECT_DEFAULT_VERTEX_REFINER_PROPOSAL_MODE).
            proposal_mode: ProposalMode::DenseJunctionRegions,
            proposal_cap: 256.0,
            dense_region_junction_threshold: 0.35,
            dense_region_min_peaks: 3.0,
            dense_region_max_overlap_fraction: 0.0,
            grid_stride_px: 64.0,
            // Manifest-supplied; placeholder until set from the model manifest.
            heatmap_threshold: 0.5,
            boundary_heatmap_threshold: 0.5,
            nms_radius_px: 2.0,
            merge_radius_px: 5.0,
            boundary_merge_radius_px: 5.0,
            min_support: 1.0,
            min_support_fraction: 0.25,
            split_same_crop_conflicts: false,
            split_min_support_fraction: 0.5,
            ray_threshold: 0.5,
        }
    }
}
