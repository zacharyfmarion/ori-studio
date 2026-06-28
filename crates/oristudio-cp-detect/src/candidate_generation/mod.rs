use std::fmt;
use std::str::FromStr;

mod junction_carrier_v1;
mod junction_first_v1;
mod legacy_topology_v2;

use crate::evidence_extract::CompilerEvidence;
use crate::evidence_extract::JunctionEvidenceSource;
use crate::legacy_decode::{DecodeConfig, DecodeError, DenseOutputs};
use oristudio_cp_compiler::{
    CandidateGraph, CandidateProgram, LegacyCandidateAdapter, LegacyCandidateAdapterOptions, Point2,
};

pub const LEGACY_THRESHOLD_STRATEGY_ID: &str = "legacy-threshold";
pub const LEGACY_TOPOLOGY_V2_STRATEGY_ID: &str = "legacy-topology-v2";
pub const JUNCTION_CARRIER_V1_STRATEGY_ID: &str = "junction-carrier-v1";
pub const JUNCTION_FIRST_V1_STRATEGY_ID: &str = "junction-first-v1";

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum CandidateGenerationStrategyName {
    LegacyThreshold,
    LegacyTopologyV2,
    JunctionCarrierV1,
    /// Production default: adjacency-constrained dense strategy. On
    /// clean-1024-s15 strict topology it beats legacy-threshold on every
    /// metric (edge F1 0.942 vs 0.902 with parity repair enabled).
    #[default]
    JunctionFirstV1,
}

impl CandidateGenerationStrategyName {
    pub const fn id(self) -> &'static str {
        match self {
            Self::LegacyThreshold => LEGACY_THRESHOLD_STRATEGY_ID,
            Self::LegacyTopologyV2 => LEGACY_TOPOLOGY_V2_STRATEGY_ID,
            Self::JunctionCarrierV1 => JUNCTION_CARRIER_V1_STRATEGY_ID,
            Self::JunctionFirstV1 => JUNCTION_FIRST_V1_STRATEGY_ID,
        }
    }
}

impl fmt::Display for CandidateGenerationStrategyName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.id())
    }
}

impl FromStr for CandidateGenerationStrategyName {
    type Err = CandidateGenerationStrategyParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            LEGACY_THRESHOLD_STRATEGY_ID | "legacy" | "legacy_threshold" => {
                Ok(Self::LegacyThreshold)
            }
            LEGACY_TOPOLOGY_V2_STRATEGY_ID | "legacy_topology_v2" => Ok(Self::LegacyTopologyV2),
            JUNCTION_CARRIER_V1_STRATEGY_ID | "junction_carrier_v1" => Ok(Self::JunctionCarrierV1),
            JUNCTION_FIRST_V1_STRATEGY_ID | "junction_first_v1" => Ok(Self::JunctionFirstV1),
            other => Err(CandidateGenerationStrategyParseError {
                value: other.to_owned(),
            }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("unknown candidate generation strategy {value:?}")]
pub struct CandidateGenerationStrategyParseError {
    pub value: String,
}

#[derive(Clone)]
pub struct CandidateGenerationContext<'a> {
    pub outputs: DenseOutputs<'a>,
    pub config: DecodeConfig,
}

#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct CandidateGenerationOptions {
    pub strategy: CandidateGenerationStrategyName,
    pub legacy_threshold: LegacyThresholdStrategyOptions,
    pub legacy_topology_v2: LegacyTopologyV2StrategyOptions,
    pub junction_carrier_v1: JunctionCarrierV1StrategyOptions,
    pub junction_first_v1: JunctionFirstV1StrategyOptions,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LegacyThresholdStrategyOptions {
    pub low_threshold: Option<f32>,
    pub duplicate_endpoint_tolerance_px: f64,
    pub weak_endpoint_snap_radius_px: Option<f64>,
    pub weak_boundary_endpoint_snap_radius_px: Option<f64>,
    pub weak_carrier_incidence_tolerance_px: Option<f64>,
    pub weak_span_split_tolerance_px: Option<f64>,
    pub weak_min_split_length_px: Option<f64>,
}

impl Default for LegacyThresholdStrategyOptions {
    fn default() -> Self {
        Self {
            low_threshold: None,
            duplicate_endpoint_tolerance_px: 3.0,
            weak_endpoint_snap_radius_px: None,
            weak_boundary_endpoint_snap_radius_px: None,
            weak_carrier_incidence_tolerance_px: None,
            weak_span_split_tolerance_px: None,
            weak_min_split_length_px: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LegacyTopologyV2StrategyOptions {
    pub pass_through_angle_tolerance_degrees: f64,
    pub endpoint_rho_tolerance_px: f64,
    pub min_chain_spans: usize,
    pub min_structural_mean_support: f64,
}

impl Default for LegacyTopologyV2StrategyOptions {
    fn default() -> Self {
        Self {
            pass_through_angle_tolerance_degrees: 4.0,
            endpoint_rho_tolerance_px: 5.0,
            min_chain_spans: 2,
            min_structural_mean_support: 0.42,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct JunctionCarrierV1StrategyOptions {
    pub vertex_merge_radius_px: f64,
    pub carrier_angle_tolerance_degrees: f64,
    pub carrier_rho_tolerance_px: f64,
    pub carrier_extent_padding_px: f64,
    pub vertex_carrier_distance_px: f64,
    pub min_span_length_px: f64,
    pub min_span_line_support: f64,
    pub strong_span_line_support: f64,
    pub min_span_line_min_support: f64,
    pub max_skip_vertices: usize,
    pub max_line_endpoint_vertices: usize,
    pub max_vertices_per_carrier: usize,
    pub max_spans_per_carrier: usize,
    pub max_total_spans: usize,
    /// Offset normalization radius for offset-vote junction decoding.
    /// 0 keeps legacy local-maxima extraction (see EvidenceExtractionConfig).
    pub junction_offset_cluster_radius_px: f64,
    pub junction_evidence_source: JunctionEvidenceSource,
}

impl Default for JunctionCarrierV1StrategyOptions {
    fn default() -> Self {
        Self {
            vertex_merge_radius_px: 6.0,
            carrier_angle_tolerance_degrees: 2.5,
            carrier_rho_tolerance_px: 8.0,
            carrier_extent_padding_px: 16.0,
            vertex_carrier_distance_px: 7.0,
            min_span_length_px: 8.0,
            min_span_line_support: 0.42,
            strong_span_line_support: 0.62,
            min_span_line_min_support: 0.08,
            max_skip_vertices: 3,
            max_line_endpoint_vertices: 0,
            max_vertices_per_carrier: 120,
            max_spans_per_carrier: 360,
            max_total_spans: 8000,
            junction_offset_cluster_radius_px: 0.0,
            junction_evidence_source: JunctionEvidenceSource::Model,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct JunctionFirstV1StrategyOptions {
    /// Vertex merge radius forwarded to dense evidence vertex building.
    pub vertex_merge_radius_px: f64,
    /// Minimum proposed span length.
    pub min_span_length_px: f64,
    /// A pair (A, B) is rejected when a third vertex sits within this
    /// perpendicular corridor of segment A-B (the adjacency constraint).
    pub intermediate_corridor_px: f64,
    /// Projection margin at both segment ends inside which a third vertex does
    /// not count as intermediate (it is effectively an endpoint duplicate).
    pub endpoint_margin_px: f64,
    /// Cheap preflight: max line probability over mid/quarter samples must
    /// reach this before full segment scoring runs.
    pub preflight_min_line_support: f64,
    pub min_span_line_support: f64,
    pub strong_span_line_support: f64,
    pub min_span_line_min_support: f64,
    pub max_non_crease_support: f64,
    /// Near-collinear overlap conflict thresholds.
    pub collinear_conflict_angle_degrees: f64,
    pub collinear_conflict_distance_px: f64,
    /// Offset normalization radius for offset-vote junction decoding (the
    /// radius the model's junction_offset head was trained with). 0 keeps the
    /// legacy local-maxima vertex extraction.
    pub junction_offset_cluster_radius_px: f64,
    pub junction_evidence_source: JunctionEvidenceSource,
}

impl Default for JunctionFirstV1StrategyOptions {
    fn default() -> Self {
        // Tuned on clean-1024-s15 strict topology (2026-06-09): merge radius 3
        // and min span 3 with a 2px endpoint margin preserve close vertex
        // pairs and tiny creases that the previous 6/8/4 defaults destroyed.
        Self {
            vertex_merge_radius_px: 3.0,
            min_span_length_px: 3.0,
            intermediate_corridor_px: 3.0,
            endpoint_margin_px: 2.0,
            preflight_min_line_support: 0.25,
            min_span_line_support: 0.42,
            strong_span_line_support: 0.62,
            min_span_line_min_support: 0.08,
            max_non_crease_support: 0.72,
            collinear_conflict_angle_degrees: 2.0,
            collinear_conflict_distance_px: 3.0,
            junction_offset_cluster_radius_px: 0.0,
            junction_evidence_source: JunctionEvidenceSource::Model,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CandidateGenerationOutput {
    pub strategy: CandidateGenerationStrategyName,
    pub threshold: f32,
    pub low_threshold: f32,
    pub primary_program: CandidateProgram,
    pub weak_program: Option<CandidateProgram>,
    pub candidate_graph: CandidateGraph,
    pub diagnostics: CandidateGenerationDiagnostics,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CandidateGenerationDiagnostics {
    pub junction_carrier_v1: Option<JunctionCarrierV1Diagnostics>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct JunctionCarrierV1Diagnostics {
    pub line_primitives: usize,
    pub carrier_hypotheses: Vec<JunctionCarrierDiagnosticCarrier>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct JunctionCarrierDiagnosticCarrier {
    pub id: usize,
    pub normal: Point2,
    pub direction: Point2,
    pub rho: f64,
    pub t_interval: [f64; 2],
    pub support: f64,
    pub incident_vertices: usize,
    pub emitted_spans: usize,
}

pub trait CandidateGenerationStrategy {
    fn name(&self) -> CandidateGenerationStrategyName;
    fn generate(
        &self,
        ctx: CandidateGenerationContext<'_>,
    ) -> Result<CandidateGenerationOutput, DecodeError>;
}

#[derive(Debug, Clone, Copy)]
pub struct LegacyThresholdStrategy {
    options: LegacyThresholdStrategyOptions,
}

impl LegacyThresholdStrategy {
    pub const fn new(options: LegacyThresholdStrategyOptions) -> Self {
        Self { options }
    }
}

impl CandidateGenerationStrategy for LegacyThresholdStrategy {
    fn name(&self) -> CandidateGenerationStrategyName {
        CandidateGenerationStrategyName::LegacyThreshold
    }

    fn generate(
        &self,
        ctx: CandidateGenerationContext<'_>,
    ) -> Result<CandidateGenerationOutput, DecodeError> {
        let threshold = ctx.config.threshold;
        let low_threshold = self
            .options
            .low_threshold
            .unwrap_or_else(|| default_low_threshold(threshold));
        let primary_program = decode_program(ctx.outputs, ctx.config.clone())?;
        let weak_program = if low_threshold < threshold {
            Some(decode_program(
                ctx.outputs,
                DecodeConfig {
                    threshold: low_threshold,
                    ..ctx.config.clone()
                },
            )?)
        } else {
            None
        };
        let candidate_graph = LegacyCandidateAdapter::from_programs(
            &primary_program,
            weak_program.as_ref(),
            legacy_adapter_options(ctx.config.image_size, self.options),
        );
        Ok(CandidateGenerationOutput {
            strategy: self.name(),
            threshold,
            low_threshold,
            primary_program,
            weak_program,
            candidate_graph,
            diagnostics: CandidateGenerationDiagnostics::default(),
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub struct LegacyTopologyV2Strategy {
    legacy_options: LegacyThresholdStrategyOptions,
    topology_options: LegacyTopologyV2StrategyOptions,
}

impl LegacyTopologyV2Strategy {
    pub const fn new(
        legacy_options: LegacyThresholdStrategyOptions,
        topology_options: LegacyTopologyV2StrategyOptions,
    ) -> Self {
        Self {
            legacy_options,
            topology_options,
        }
    }
}

impl CandidateGenerationStrategy for LegacyTopologyV2Strategy {
    fn name(&self) -> CandidateGenerationStrategyName {
        CandidateGenerationStrategyName::LegacyTopologyV2
    }

    fn generate(
        &self,
        ctx: CandidateGenerationContext<'_>,
    ) -> Result<CandidateGenerationOutput, DecodeError> {
        let image_size = ctx.config.image_size;
        let mut output = LegacyThresholdStrategy::new(self.legacy_options).generate(ctx)?;
        legacy_topology_v2::add_structural_topology_candidates(
            &mut output.candidate_graph,
            image_size,
            self.topology_options,
        );
        output.strategy = self.name();
        Ok(output)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct JunctionCarrierV1Strategy {
    options: JunctionCarrierV1StrategyOptions,
}

impl JunctionCarrierV1Strategy {
    pub const fn new(options: JunctionCarrierV1StrategyOptions) -> Self {
        Self { options }
    }
}

impl CandidateGenerationStrategy for JunctionCarrierV1Strategy {
    fn name(&self) -> CandidateGenerationStrategyName {
        CandidateGenerationStrategyName::JunctionCarrierV1
    }

    fn generate(
        &self,
        ctx: CandidateGenerationContext<'_>,
    ) -> Result<CandidateGenerationOutput, DecodeError> {
        let threshold = ctx.config.threshold;
        let (candidate_graph, diagnostics) =
            junction_carrier_v1::generate_candidate_graph_with_diagnostics(
                ctx.outputs,
                &ctx.config,
                self.options,
            )?;
        Ok(CandidateGenerationOutput {
            strategy: self.name(),
            threshold,
            low_threshold: threshold,
            primary_program: empty_program(ctx.config.image_size),
            weak_program: None,
            candidate_graph,
            diagnostics: CandidateGenerationDiagnostics {
                junction_carrier_v1: Some(diagnostics),
            },
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub struct JunctionFirstV1Strategy {
    options: JunctionFirstV1StrategyOptions,
}

impl JunctionFirstV1Strategy {
    pub const fn new(options: JunctionFirstV1StrategyOptions) -> Self {
        Self { options }
    }

    pub fn generate_from_evidence(
        &self,
        evidence: &CompilerEvidence,
        config: &DecodeConfig,
    ) -> CandidateGenerationOutput {
        let threshold = config.threshold;
        let candidate_graph =
            junction_first_v1::graph_from_evidence(evidence, config, self.options);
        CandidateGenerationOutput {
            strategy: self.name(),
            threshold,
            low_threshold: threshold,
            primary_program: empty_program(config.image_size),
            weak_program: None,
            candidate_graph,
            diagnostics: CandidateGenerationDiagnostics::default(),
        }
    }

    pub fn extract_evidence(
        &self,
        outputs: DenseOutputs<'_>,
        config: &DecodeConfig,
    ) -> Result<CompilerEvidence, DecodeError> {
        junction_first_v1::extract_evidence(outputs, config, self.options)
    }
}

impl CandidateGenerationStrategy for JunctionFirstV1Strategy {
    fn name(&self) -> CandidateGenerationStrategyName {
        CandidateGenerationStrategyName::JunctionFirstV1
    }

    fn generate(
        &self,
        ctx: CandidateGenerationContext<'_>,
    ) -> Result<CandidateGenerationOutput, DecodeError> {
        let threshold = ctx.config.threshold;
        let candidate_graph =
            junction_first_v1::generate_candidate_graph(ctx.outputs, &ctx.config, self.options)?;
        Ok(CandidateGenerationOutput {
            strategy: self.name(),
            threshold,
            low_threshold: threshold,
            primary_program: empty_program(ctx.config.image_size),
            weak_program: None,
            candidate_graph,
            diagnostics: CandidateGenerationDiagnostics::default(),
        })
    }
}

pub fn generate_candidate_graph(
    ctx: CandidateGenerationContext<'_>,
    options: CandidateGenerationOptions,
) -> Result<CandidateGenerationOutput, DecodeError> {
    // Register new complete candidate-generation strategies here. Do not mix
    // unrelated strategy outputs unless the hybrid is itself an explicit
    // strategy with dedupe/conflict semantics.
    match options.strategy {
        CandidateGenerationStrategyName::LegacyThreshold => {
            LegacyThresholdStrategy::new(options.legacy_threshold).generate(ctx)
        }
        CandidateGenerationStrategyName::LegacyTopologyV2 => {
            LegacyTopologyV2Strategy::new(options.legacy_threshold, options.legacy_topology_v2)
                .generate(ctx)
        }
        CandidateGenerationStrategyName::JunctionCarrierV1 => {
            JunctionCarrierV1Strategy::new(options.junction_carrier_v1).generate(ctx)
        }
        CandidateGenerationStrategyName::JunctionFirstV1 => {
            JunctionFirstV1Strategy::new(options.junction_first_v1).generate(ctx)
        }
    }
}

pub fn default_low_threshold(threshold: f32) -> f32 {
    (threshold * 0.55).max(0.10).min(threshold)
}

pub fn legacy_adapter_options(
    image_size: u32,
    options: LegacyThresholdStrategyOptions,
) -> LegacyCandidateAdapterOptions {
    let scale = 1.0 / image_size.max(1) as f64;
    let mut adapter = LegacyCandidateAdapterOptions {
        duplicate_endpoint_tolerance: (options.duplicate_endpoint_tolerance_px * scale).max(1e-6),
        ..LegacyCandidateAdapterOptions::default()
    };
    if let Some(value) = options.weak_endpoint_snap_radius_px {
        adapter.weak_endpoint_snap_tolerance = (value * scale).max(1e-6);
    }
    if let Some(value) = options.weak_boundary_endpoint_snap_radius_px {
        adapter.weak_boundary_endpoint_snap_tolerance = (value * scale).max(1e-6);
    }
    if let Some(value) = options.weak_carrier_incidence_tolerance_px {
        adapter.weak_carrier_incidence_tolerance = (value * scale).max(1e-6);
    }
    if let Some(value) = options.weak_span_split_tolerance_px {
        adapter.weak_span_split_tolerance = (value * scale).max(1e-6);
    }
    if let Some(value) = options.weak_min_split_length_px {
        adapter.weak_min_split_length = (value * scale).max(1e-6);
    }
    adapter
}

fn decode_program(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
) -> Result<CandidateProgram, DecodeError> {
    let decoded = crate::legacy_decode::decode_dense_outputs(outputs, config)?;
    let value = serde_json::from_str::<serde_json::Value>(&decoded.fold_json)?;
    Ok(CandidateProgram::from_fold_value(&value)?)
}

fn empty_program(image_size: u32) -> CandidateProgram {
    CandidateProgram {
        coordinate_space: "unit_square".to_owned(),
        image_size: Some(image_size),
        carriers: Vec::new(),
        vertices: Vec::new(),
        edges: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_legacy_strategy_aliases() {
        assert_eq!(
            "legacy-threshold"
                .parse::<CandidateGenerationStrategyName>()
                .expect("strategy"),
            CandidateGenerationStrategyName::LegacyThreshold
        );
        assert_eq!(
            "legacy"
                .parse::<CandidateGenerationStrategyName>()
                .expect("strategy"),
            CandidateGenerationStrategyName::LegacyThreshold
        );
        assert!(
            "arrangement"
                .parse::<CandidateGenerationStrategyName>()
                .is_err()
        );
        assert_eq!(
            "legacy-topology-v2"
                .parse::<CandidateGenerationStrategyName>()
                .expect("strategy"),
            CandidateGenerationStrategyName::LegacyTopologyV2
        );
        assert_eq!(
            "junction-carrier-v1"
                .parse::<CandidateGenerationStrategyName>()
                .expect("strategy"),
            CandidateGenerationStrategyName::JunctionCarrierV1
        );
        assert_eq!(
            "junction-first-v1"
                .parse::<CandidateGenerationStrategyName>()
                .expect("strategy"),
            CandidateGenerationStrategyName::JunctionFirstV1
        );
    }

    #[test]
    fn adapter_options_convert_pixel_tolerances_to_unit_space() {
        let options = legacy_adapter_options(1000, LegacyThresholdStrategyOptions::default());
        assert!((options.duplicate_endpoint_tolerance - 0.003).abs() < 1e-9);
    }
}
