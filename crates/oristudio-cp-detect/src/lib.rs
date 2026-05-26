//! Browser crease-pattern detection core.
//!
//! This crate starts with stable package, model-manifest, and oracle-fixture
//! types. The numeric crop, evidence, topology, and FOLD export ports land in
//! later roadmap phases behind these contracts.

pub mod decode;
pub mod opencv_hough_lines_p;
pub mod rectify;
pub mod segments;

use serde::{Deserialize, Serialize};

pub const MODEL_MANIFEST_SCHEMA: &str = "oristudio/cp-detect-model-manifest/v1";
pub const ORACLE_FIXTURE_SCHEMA: &str = "oristudio/cp-detect-oracle-fixtures/v1";
pub const LOCAL_MODEL_ASSET_DIR: &str = "models/cp-detector-v2";
pub const DEFAULT_MODEL_MANIFEST_URL: &str = "models/cp-detector-v2/manifest.json";
pub const DEFAULT_IMAGE_SIZE: u32 = 1024;
pub const DEFAULT_THRESHOLD: f32 = 0.65;

pub type Result<T> = std::result::Result<T, DetectConfigError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackageInfo {
    pub crate_name: &'static str,
    pub version: &'static str,
    pub model_asset_dir: &'static str,
    pub default_model_manifest_url: &'static str,
    pub default_image_size: u32,
}

pub fn package_info() -> PackageInfo {
    PackageInfo {
        crate_name: env!("CARGO_PKG_NAME"),
        version: env!("CARGO_PKG_VERSION"),
        model_asset_dir: LOCAL_MODEL_ASSET_DIR,
        default_model_manifest_url: DEFAULT_MODEL_MANIFEST_URL,
        default_image_size: DEFAULT_IMAGE_SIZE,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelManifest {
    pub schema: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    pub model: ModelArtifact,
    pub inference: InferenceDefaults,
    pub outputs: OutputTensorNames,
}

impl ModelManifest {
    pub fn validate(&self) -> Result<()> {
        validate_schema(&self.schema, MODEL_MANIFEST_SCHEMA)?;
        if self.id.trim().is_empty() {
            return Err(DetectConfigError::InvalidField("id"));
        }
        if self.model.url.trim().is_empty() {
            return Err(DetectConfigError::InvalidField("model.url"));
        }
        self.inference.validate()?;
        self.outputs.validate()?;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelArtifact {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(default = "default_model_format")]
    pub format: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InferenceDefaults {
    pub image_size: u32,
    pub threshold: f32,
    #[serde(default = "default_preprocessing")]
    pub preprocessing: String,
}

impl InferenceDefaults {
    fn validate(&self) -> Result<()> {
        if self.image_size == 0 {
            return Err(DetectConfigError::InvalidField("inference.image_size"));
        }
        if !(0.0..=1.0).contains(&self.threshold) {
            return Err(DetectConfigError::InvalidField("inference.threshold"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutputTensorNames {
    pub line_logits: String,
    pub angle: String,
    pub junction_logits: String,
    pub junction_offset: String,
    pub assignment_logits: String,
    pub non_crease_logits: String,
    pub line_style_logits: String,
    pub boundary_contact_logits: String,
    pub vertex_type_logits: String,
    pub boundary_side_logits: String,
    pub boundary_offset: String,
    pub boundary_coord: String,
}

impl OutputTensorNames {
    fn validate(&self) -> Result<()> {
        for (field, value) in [
            ("outputs.line_logits", &self.line_logits),
            ("outputs.angle", &self.angle),
            ("outputs.junction_logits", &self.junction_logits),
            ("outputs.junction_offset", &self.junction_offset),
            ("outputs.assignment_logits", &self.assignment_logits),
            ("outputs.non_crease_logits", &self.non_crease_logits),
            ("outputs.line_style_logits", &self.line_style_logits),
            (
                "outputs.boundary_contact_logits",
                &self.boundary_contact_logits,
            ),
            ("outputs.vertex_type_logits", &self.vertex_type_logits),
            ("outputs.boundary_side_logits", &self.boundary_side_logits),
            ("outputs.boundary_offset", &self.boundary_offset),
            ("outputs.boundary_coord", &self.boundary_coord),
        ] {
            if value.trim().is_empty() {
                return Err(DetectConfigError::InvalidField(field));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OracleFixtureManifest {
    pub schema: String,
    pub generated_by: String,
    pub detector_checkpoint_id: String,
    pub fixtures: Vec<OracleFixture>,
}

impl OracleFixtureManifest {
    pub fn validate(&self) -> Result<()> {
        validate_schema(&self.schema, ORACLE_FIXTURE_SCHEMA)?;
        if self.generated_by.trim().is_empty() {
            return Err(DetectConfigError::InvalidField("generated_by"));
        }
        if self.fixtures.is_empty() {
            return Err(DetectConfigError::InvalidField("fixtures"));
        }
        for fixture in &self.fixtures {
            fixture.validate()?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OracleFixture {
    pub id: String,
    pub profile: String,
    pub source_image_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rectified_image_path: Option<String>,
    pub fold_path: String,
    pub report_path: String,
    pub expected_status: DetectStatus,
    pub expected_vertices: u32,
    pub expected_edges: u32,
}

impl OracleFixture {
    fn validate(&self) -> Result<()> {
        if self.id.trim().is_empty() {
            return Err(DetectConfigError::InvalidField("fixture.id"));
        }
        if self.source_image_path.trim().is_empty() {
            return Err(DetectConfigError::InvalidField("fixture.source_image_path"));
        }
        if self.fold_path.trim().is_empty() {
            return Err(DetectConfigError::InvalidField("fixture.fold_path"));
        }
        if self.report_path.trim().is_empty() {
            return Err(DetectConfigError::InvalidField("fixture.report_path"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetectStatus {
    Valid,
    Repaired,
    Ambiguous,
    OutsideSupportedEnvelope,
    OutsideV1Envelope,
    Failed,
}

#[derive(Debug, thiserror::Error)]
pub enum DetectConfigError {
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unsupported schema {actual:?}; expected {expected:?}")]
    UnsupportedSchema {
        actual: String,
        expected: &'static str,
    },
    #[error("invalid or missing field: {0}")]
    InvalidField(&'static str),
}

pub fn parse_model_manifest_json(text: &str) -> Result<ModelManifest> {
    let manifest: ModelManifest = serde_json::from_str(text)?;
    manifest.validate()?;
    Ok(manifest)
}

pub fn parse_oracle_fixture_manifest_json(text: &str) -> Result<OracleFixtureManifest> {
    let manifest: OracleFixtureManifest = serde_json::from_str(text)?;
    manifest.validate()?;
    Ok(manifest)
}

fn validate_schema(actual: &str, expected: &'static str) -> Result<()> {
    if actual == expected {
        Ok(())
    } else {
        Err(DetectConfigError::UnsupportedSchema {
            actual: actual.to_owned(),
            expected,
        })
    }
}

fn default_model_format() -> String {
    "onnx".to_owned()
}

fn default_preprocessing() -> String {
    "rgb_chw_float32_0_1".to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_info_names_browser_asset_contract() {
        let info = package_info();
        assert_eq!(info.model_asset_dir, "models/cp-detector-v2");
        assert_eq!(info.default_image_size, 1024);
    }

    #[test]
    fn parses_model_manifest_contract() {
        let manifest =
            parse_model_manifest_json(MODEL_MANIFEST_JSON).expect("model manifest should parse");
        assert_eq!(manifest.schema, MODEL_MANIFEST_SCHEMA);
        assert_eq!(manifest.inference.image_size, 1024);
        assert_eq!(manifest.inference.threshold, 0.65);
        assert_eq!(manifest.outputs.boundary_coord, "boundary_coord");
    }

    #[test]
    fn rejects_unexpected_manifest_schema() {
        let error = parse_model_manifest_json(WRONG_SCHEMA_MODEL_MANIFEST_JSON)
            .expect_err("wrong schema should fail before later implementation uses it");
        assert!(matches!(
            error,
            DetectConfigError::UnsupportedSchema {
                expected: MODEL_MANIFEST_SCHEMA,
                ..
            }
        ));
    }

    const MODEL_MANIFEST_JSON: &str = r#"{
      "schema": "oristudio/cp-detect-model-manifest/v1",
      "id": "runpod-v2-replay-correction-full-4000ada",
      "created_at": "2026-05-22",
      "model": {
        "url": "model.onnx",
        "sha256": "e3f9aa7ebb06a6c631512ba567038c34f37ae05edd04672afa39ea5b142956f2",
        "format": "onnx"
      },
      "inference": {
        "image_size": 1024,
        "threshold": 0.65,
        "preprocessing": "rgb_chw_float32_0_1"
      },
      "outputs": {
        "line_logits": "line_logits",
        "angle": "angle",
        "junction_logits": "junction_logits",
        "junction_offset": "junction_offset",
        "assignment_logits": "assignment_logits",
        "non_crease_logits": "non_crease_logits",
        "line_style_logits": "line_style_logits",
        "boundary_contact_logits": "boundary_contact_logits",
        "vertex_type_logits": "vertex_type_logits",
        "boundary_side_logits": "boundary_side_logits",
        "boundary_offset": "boundary_offset",
        "boundary_coord": "boundary_coord"
      }
    }"#;

    const WRONG_SCHEMA_MODEL_MANIFEST_JSON: &str = r#"{
      "schema": "wrong",
      "id": "runpod-v2-replay-correction-full-4000ada",
      "model": { "url": "model.onnx" },
      "inference": { "image_size": 1024, "threshold": 0.65 },
      "outputs": {
        "line_logits": "line_logits",
        "angle": "angle",
        "junction_logits": "junction_logits",
        "junction_offset": "junction_offset",
        "assignment_logits": "assignment_logits",
        "non_crease_logits": "non_crease_logits",
        "line_style_logits": "line_style_logits",
        "boundary_contact_logits": "boundary_contact_logits",
        "vertex_type_logits": "vertex_type_logits",
        "boundary_side_logits": "boundary_side_logits",
        "boundary_offset": "boundary_offset",
        "boundary_coord": "boundary_coord"
      }
    }"#;
}
