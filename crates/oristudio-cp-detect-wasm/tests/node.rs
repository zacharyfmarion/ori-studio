use wasm_bindgen_test::*;

#[wasm_bindgen_test]
fn package_info_serializes_browser_detector_contract() {
    let info =
        oristudio_cp_detect_wasm::cp_detect_package_info().expect("package info should serialize");
    let info: serde_json::Value =
        serde_wasm_bindgen::from_value(info).expect("package info should deserialize");

    assert_eq!(info["crate_name"], "oristudio-cp-detect");
    assert_eq!(info["model_asset_dir"], "models/cp-detector-v2");
    assert_eq!(info["default_image_size"], 1024);
}

#[wasm_bindgen_test]
fn model_manifest_parser_returns_typed_schema_error() {
    let error = oristudio_cp_detect_wasm::cp_detect_parse_model_manifest(
        r#"{
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
        }"#,
    )
    .expect_err("wrong schema should fail");
    let error: serde_json::Value =
        serde_wasm_bindgen::from_value(error).expect("error should deserialize");

    assert_eq!(error["code"], "unsupported_schema");
}
