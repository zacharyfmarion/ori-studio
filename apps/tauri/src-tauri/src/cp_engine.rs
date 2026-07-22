//! Native crease-pattern (CP) engine commands — the desktop counterpart to the
//! `oristudio-cp-wasm` browser bridge. On desktop these run as native Rust via
//! Tauri `invoke`, avoiding the wasm runtime penalty and (later) enabling
//! `rayon` parallelism for folding.
//!
//! See `implementation-plans/desktop-native-cp-engine-migration.md`. This module
//! grows one phase at a time; Phase 0 proves the invoke + serde round-trip with a
//! single stateless command.

use oristudio_cp::{
    OperationCategory, OperationDescriptor, OperationId, OperationStatus, operation_descriptors,
};
use serde::Serialize;

/// Mirror of the wasm bridge's `JsOperationDescriptor`. Serialized to the same
/// JSON shape the frontend already consumes (the wasm path uses
/// `serde_wasm_bindgen`'s `json_compatible` serializer, which matches
/// `serde_json`).
#[derive(Serialize)]
pub struct CpOperationDescriptor {
    id: OperationId,
    upstream: &'static str,
    target: &'static str,
    category: OperationCategory,
    stage: u8,
    status: OperationStatus,
}

impl From<&'static OperationDescriptor> for CpOperationDescriptor {
    fn from(descriptor: &'static OperationDescriptor) -> Self {
        Self {
            id: descriptor.id,
            upstream: descriptor.upstream,
            target: descriptor.target,
            category: descriptor.category,
            stage: descriptor.stage,
            status: descriptor.status,
        }
    }
}

/// Native equivalent of `cp_operation_descriptors` in the wasm bridge: the static
/// catalog of CP operations.
#[tauri::command]
pub fn cp_operation_descriptors() -> Vec<CpOperationDescriptor> {
    operation_descriptors()
        .iter()
        .map(CpOperationDescriptor::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::cp_operation_descriptors;

    #[test]
    fn descriptors_serialize_to_the_expected_json_shape() {
        let descriptors = cp_operation_descriptors();
        assert!(
            !descriptors.is_empty(),
            "expected a non-empty operation catalog"
        );

        let json = serde_json::to_value(&descriptors).expect("descriptors serialize as JSON");
        let array = json
            .as_array()
            .expect("descriptors serialize as a JSON array");
        let first = array.first().expect("at least one descriptor");

        // The frontend's OristudioCpOperationDescriptor contract.
        for key in ["id", "upstream", "target", "category", "stage", "status"] {
            assert!(
                first.get(key).is_some(),
                "descriptor JSON is missing `{key}`: {first}"
            );
        }
    }
}
