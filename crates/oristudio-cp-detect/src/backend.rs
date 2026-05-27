use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecoderBackend {
    #[serde(rename = "legacy_v2_decoder")]
    LegacyV2,
}

impl DecoderBackend {
    pub const fn id(self) -> &'static str {
        match self {
            DecoderBackend::LegacyV2 => "legacy_v2_decoder",
        }
    }
}

impl Default for DecoderBackend {
    fn default() -> Self {
        Self::LegacyV2
    }
}
