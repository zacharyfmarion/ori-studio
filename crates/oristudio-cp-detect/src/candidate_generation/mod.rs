use std::fmt;
use std::str::FromStr;

use crate::legacy_decode::{DecodeConfig, DecodeError, DenseOutputs};
use oristudio_cp_compiler::{
    CandidateGraph, CandidateProgram, LegacyCandidateAdapter, LegacyCandidateAdapterOptions,
};

pub const LEGACY_THRESHOLD_STRATEGY_ID: &str = "legacy-threshold";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CandidateGenerationStrategyName {
    LegacyThreshold,
}

impl CandidateGenerationStrategyName {
    pub const fn id(self) -> &'static str {
        match self {
            Self::LegacyThreshold => LEGACY_THRESHOLD_STRATEGY_ID,
        }
    }
}

impl Default for CandidateGenerationStrategyName {
    fn default() -> Self {
        Self::LegacyThreshold
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

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CandidateGenerationOptions {
    pub strategy: CandidateGenerationStrategyName,
    pub legacy_threshold: LegacyThresholdStrategyOptions,
}

impl Default for CandidateGenerationOptions {
    fn default() -> Self {
        Self {
            strategy: CandidateGenerationStrategyName::LegacyThreshold,
            legacy_threshold: LegacyThresholdStrategyOptions::default(),
        }
    }
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

#[derive(Debug, Clone, PartialEq)]
pub struct CandidateGenerationOutput {
    pub strategy: CandidateGenerationStrategyName,
    pub threshold: f32,
    pub low_threshold: f32,
    pub primary_program: CandidateProgram,
    pub weak_program: Option<CandidateProgram>,
    pub candidate_graph: CandidateGraph,
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
        })
    }
}

pub fn generate_candidate_graph(
    ctx: CandidateGenerationContext<'_>,
    options: CandidateGenerationOptions,
) -> Result<CandidateGenerationOutput, DecodeError> {
    match options.strategy {
        CandidateGenerationStrategyName::LegacyThreshold => {
            LegacyThresholdStrategy::new(options.legacy_threshold).generate(ctx)
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
    }

    #[test]
    fn adapter_options_convert_pixel_tolerances_to_unit_space() {
        let options = legacy_adapter_options(1000, LegacyThresholdStrategyOptions::default());
        assert!((options.duplicate_endpoint_tolerance - 0.003).abs() < 1e-9);
    }
}
