//! Shared vertex-refiner geometry.
//!
//! Faithful Rust port of the geometry in
//! `apps/web/src/lib/vertexRefinerPipeline.ts` so that the product (via wasm) and
//! the benchmark share a single implementation. Only the ONNX/Torch forward pass
//! lives outside this module.
//!
//! Fidelity rules (match the TS exactly):
//! - feature/tensor maps are stored as `f32` (TS `Float32Array`); arithmetic runs
//!   in `f64` and truncates on store (`as f32`), and reads widen `f32 -> f64`.
//! - `js_round` reproduces JavaScript `Math.round` = `floor(x + 0.5)` (rounds half
//!   toward +infinity, unlike Rust's `f64::round` which rounds half away from zero).

pub mod crop_tensor;
pub mod decode_outputs;
pub mod features;
pub mod merge;
pub mod params;
pub mod proposals;

pub use crop_tensor::build_crop_tensor;
pub use decode_outputs::{DecodedVertex, RefinerOutputs, decode_output_tensors};
pub use features::{SourceFeatures, build_source_features};
pub use merge::{MergedVertex, merge_decoded_vertices};
pub use params::{ProposalMode, VertexRefinerParams};
pub use proposals::{generate_proposals, refinement_region_for_proposal};

/// Vertex kinds (`VERTEX_KIND_NAMES` in the TS).
pub const VERTEX_KIND_NAMES: [&str; 5] = [
    "background",
    "interior_junction",
    "boundary_contact",
    "corner",
    "endpoint_or_dangling",
];

/// Number of incident-ray bins (`RAY_BINS`).
pub const RAY_BINS: usize = 36;

/// `kind_id -> kind name`, falling back to `"background"` (TS `?? 'background'`).
pub(crate) fn vertex_kind_name(kind_id: usize) -> &'static str {
    VERTEX_KIND_NAMES
        .get(kind_id)
        .copied()
        .unwrap_or("background")
}

/// Frame side (`BOUNDARY_SIDE_NAMES = ['top','right','bottom','left']`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Top,
    Right,
    Bottom,
    Left,
}

impl Side {
    /// In `BOUNDARY_SIDE_NAMES` order.
    pub const ALL: [Side; 4] = [Side::Top, Side::Right, Side::Bottom, Side::Left];

    pub fn name(self) -> &'static str {
        match self {
            Side::Top => "top",
            Side::Right => "right",
            Side::Bottom => "bottom",
            Side::Left => "left",
        }
    }

    /// `BOUNDARY_SIDE_NAMES.indexOf(side)`.
    pub fn index(self) -> usize {
        match self {
            Side::Top => 0,
            Side::Right => 1,
            Side::Bottom => 2,
            Side::Left => 3,
        }
    }
}

/// A crop proposal center in pixel space (mirrors `VertexRefinerProposal`).
#[derive(Debug, Clone, PartialEq)]
pub struct Proposal {
    pub x: f64,
    pub y: f64,
    pub score: f64,
    pub provenance: Vec<String>,
}

/// Clamped crop bounding box in pixel space (mirrors `VertexRefinerRefinementRegion`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RefinementRegion {
    pub x_min: f64,
    pub y_min: f64,
    pub x_max: f64,
    pub y_max: f64,
}

/// A dense/output tensor (`CpDetectTensorData`): flat `f32` data plus `dims`.
#[derive(Debug, Clone)]
pub struct Tensor {
    pub data: Vec<f32>,
    pub dims: Vec<usize>,
}

impl Tensor {
    /// `tensor.dims[1] ?? 1` — the channel count used by `tensorOffset`.
    pub(crate) fn channels(&self) -> usize {
        self.dims.get(1).copied().unwrap_or(1)
    }

    /// `tensorSpatialShape` -> `(width, height)` (channel offset is always 0).
    pub(crate) fn spatial_shape(&self) -> Option<(usize, usize)> {
        let dims = &self.dims;
        if dims.len() >= 2 {
            let height = dims[dims.len() - 2];
            let width = dims[dims.len() - 1];
            if width > 0 && height > 0 && self.data.len() >= width * height {
                return Some((width, height));
            }
        }
        let side = js_round((self.data.len() as f64).sqrt()) as usize;
        if side > 0 && side * side == self.data.len() {
            return Some((side, side));
        }
        None
    }
}

/// Result of the geometry "plan" stage: what the forward pass consumes plus what
/// the decode needs afterward.
#[derive(Debug, Clone)]
pub struct VertexRefinerPlan {
    pub proposals: Vec<Proposal>,
    pub refinement_regions: Option<Vec<RefinementRegion>>,
    /// `[N, 11, crop_size, crop_size]`, row-major NCHW.
    pub crop_tensor: Vec<f32>,
}

/// Geometry up to (and including) the crop tensor — everything before the refiner
/// forward pass. Mirrors the pre-inference half of `runVertexRefinerOnImage`.
pub fn plan_vertex_refiner(
    image_rgba: &[u8],
    width: usize,
    height: usize,
    junction_logits: Option<&Tensor>,
    params: &VertexRefinerParams,
) -> VertexRefinerPlan {
    let crop_size = params.crop_size;
    let frame = params
        .frame
        .unwrap_or_else(|| Frame::full_image(width, height));
    let features = build_source_features(image_rgba, width, height, crop_size, frame);
    let proposals = generate_proposals(width, height, junction_logits, frame, params);
    let refinement_regions = match params.proposal_mode {
        ProposalMode::DenseJunctionRegions => Some(
            proposals
                .iter()
                .map(|proposal| refinement_region_for_proposal(proposal, crop_size, width, height))
                .collect(),
        ),
        ProposalMode::FullCoverage => None,
    };
    let crop_tensor = build_crop_tensor(&features, &proposals, crop_size);
    VertexRefinerPlan {
        proposals,
        refinement_regions,
        crop_tensor,
    }
}

/// Decode the refiner outputs and merge into final vertices. Mirrors the
/// post-inference half of `runVertexRefinerOnImage`
/// (`decodeVertexRefinerOutputTensors` + `mergeDecodedVertexRefinerVertices`).
pub fn decode_merge_vertex_refiner(
    outputs: &RefinerOutputs,
    proposals: &[Proposal],
    params: &VertexRefinerParams,
) -> Vec<MergedVertex> {
    let frame = params.frame.unwrap_or_default();
    let raw = decode_output_tensors(outputs, proposals, frame, params);
    merge_decoded_vertices(&raw, proposals, params)
}

/// `sigmoid` scalar (the tensor element is widened `f32 -> f64` first, as in JS).
#[inline]
pub(crate) fn sigmoid(value: f64) -> f64 {
    1.0 / (1.0 + (-value).exp())
}

/// `cropOriginForCenter(center, cropSize)`.
#[inline]
pub(crate) fn crop_origin_for_center(x: f64, y: f64, crop_size: f64) -> (f64, f64) {
    (js_round(x - crop_size / 2.0), js_round(y - crop_size / 2.0))
}

/// Total-order-ish `f64` comparison for the TS numeric sort comparators (inputs
/// are finite here).
#[inline]
pub(crate) fn cmp_f64(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

/// Paper frame in pixel coordinates (mirrors `CpDetectPaperFrame`).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Frame {
    pub x_min: f64,
    pub y_min: f64,
    pub x_max: f64,
    pub y_max: f64,
}

impl Frame {
    /// `fullImageFrame(width, height)` -> `{0, 0, max(1, width-1), max(1, height-1)}`.
    pub fn full_image(width: usize, height: usize) -> Self {
        Self {
            x_min: 0.0,
            y_min: 0.0,
            x_max: (width as f64 - 1.0).max(1.0),
            y_max: (height as f64 - 1.0).max(1.0),
        }
    }
}

/// TS `clamp(value, min, max)` = `Math.min(max, Math.max(min, value))`.
#[inline]
pub(crate) fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

/// TS `clamp01`.
#[inline]
pub(crate) fn clamp01(value: f64) -> f64 {
    clamp(value, 0.0, 1.0)
}

/// JavaScript `Math.round`: `floor(x + 0.5)` (half rounds toward +infinity).
#[inline]
pub(crate) fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// TS `clampInt(value, min, max)` = `Math.round(clamp(value, min, max))`.
#[inline]
pub(crate) fn clamp_int(value: f64, min: f64, max: f64) -> f64 {
    js_round(clamp(value, min, max))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_round_matches_javascript_half_toward_positive_infinity() {
        assert_eq!(js_round(0.5), 1.0);
        assert_eq!(js_round(1.5), 2.0);
        assert_eq!(js_round(2.5), 3.0);
        // JS Math.round(-0.5) === 0 (not -1 like Rust's f64::round).
        assert_eq!(js_round(-0.5), 0.0);
        assert_eq!(js_round(-1.5), -1.0);
        assert_eq!(js_round(2.4), 2.0);
    }

    #[test]
    fn clamp_matches_ts_semantics() {
        assert_eq!(clamp(5.0, 0.0, 1.0), 1.0);
        assert_eq!(clamp(-5.0, 0.0, 1.0), 0.0);
        assert_eq!(clamp(0.3, 0.0, 1.0), 0.3);
        assert_eq!(clamp_int(2.6, 0.0, 10.0), 3.0);
        assert_eq!(clamp_int(-1.0, 0.0, 10.0), 0.0);
    }

    #[test]
    fn full_image_frame_is_zero_to_size_minus_one() {
        let frame = Frame::full_image(1024, 1024);
        assert_eq!(frame.x_min, 0.0);
        assert_eq!(frame.x_max, 1023.0);
        assert_eq!(frame.y_max, 1023.0);
    }
}
