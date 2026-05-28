use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecoderBackend {
    #[serde(rename = "legacy_v2_decoder")]
    LegacyV2,
    #[serde(rename = "constraint_compiler_v1")]
    ConstraintCompilerV1,
    #[serde(rename = "constraint_compiler_v2")]
    ConstraintCompilerV2,
}

impl DecoderBackend {
    pub const fn id(self) -> &'static str {
        match self {
            DecoderBackend::LegacyV2 => "legacy_v2_decoder",
            DecoderBackend::ConstraintCompilerV1 => "constraint_compiler_v1",
            DecoderBackend::ConstraintCompilerV2 => "constraint_compiler_v2",
        }
    }
}

impl Default for DecoderBackend {
    fn default() -> Self {
        Self::LegacyV2
    }
}
