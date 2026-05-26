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

#[wasm_bindgen_test]
fn auto_rectify_returns_report_and_rgba_bytes() {
    let mut rgba = vec![255u8; 64 * 64 * 4];
    for pixel in rgba.chunks_exact_mut(4) {
        pixel[3] = 255;
    }
    draw_rect(&mut rgba, 64, 0, 0, 63, 63);
    draw_line(&mut rgba, 64, 0, 0, 63, 63);

    let result = oristudio_cp_detect_wasm::cp_detect_auto_rectify_rgba(&rgba, 64, 64, 64)
        .expect("rectification should succeed");
    let report: serde_json::Value =
        serde_json::from_str(&result.report_json()).expect("report JSON should parse");

    assert_eq!(result.width(), 64);
    assert_eq!(result.height(), 64);
    assert_eq!(result.rgba().len(), 64 * 64 * 4);
    assert_eq!(report["mode"], "full_frame_resize");
}

#[wasm_bindgen_test]
fn decode_dense_outputs_returns_fold_json() {
    let size = 64usize;
    let pixels = size * size;
    let mut line_logits = vec![-8.0f32; pixels];
    let mut junction_logits = vec![-8.0f32; pixels];
    let mut assignment_logits = vec![-4.0f32; pixels * 4];
    let non_crease_logits = vec![-8.0f32; pixels];
    let line_style_logits = vec![-4.0f32; pixels * 4];
    let mut boundary_contact_logits = vec![-8.0f32; pixels];

    draw_logit_line(&mut line_logits, size, (32, 0), (32, 63), 8.0);
    draw_logit_line(&mut line_logits, size, (0, 32), (63, 32), 8.0);
    draw_logit_line(&mut line_logits, size, (0, 0), (63, 0), 8.0);
    draw_logit_line(&mut line_logits, size, (63, 0), (63, 63), 8.0);
    draw_logit_line(&mut line_logits, size, (0, 63), (63, 63), 8.0);
    draw_logit_line(&mut line_logits, size, (0, 0), (0, 63), 8.0);
    junction_logits[32 * size + 32] = 8.0;
    boundary_contact_logits[32] = 8.0;
    boundary_contact_logits[63 * size + 32] = 8.0;
    boundary_contact_logits[32 * size] = 8.0;
    boundary_contact_logits[32 * size + 63] = 8.0;
    for y in 0..size {
        let idx = y * size + 32;
        assignment_logits[idx] = 8.0;
    }
    for x in 0..size {
        let idx = 32 * size + x;
        assignment_logits[pixels + idx] = 8.0;
    }
    for x in 0..size {
        assignment_logits[2 * pixels + x] = 8.0;
        assignment_logits[2 * pixels + (size - 1) * size + x] = 8.0;
    }
    for y in 0..size {
        assignment_logits[2 * pixels + y * size] = 8.0;
        assignment_logits[2 * pixels + y * size + size - 1] = 8.0;
    }
    junction_logits[16 * size + 16] = 8.0;

    let decoded = oristudio_cp_detect_wasm::cp_detect_decode_dense_outputs(
        &line_logits,
        &junction_logits,
        &assignment_logits,
        &non_crease_logits,
        &line_style_logits,
        &boundary_contact_logits,
        size as u32,
        0.65,
    )
    .expect("decode should succeed");
    let decoded: serde_json::Value =
        serde_wasm_bindgen::from_value(decoded).expect("decoded payload should deserialize");
    let fold: serde_json::Value =
        serde_json::from_str(decoded["fold_json"].as_str().expect("fold_json")).expect("fold");

    assert!(fold["edges_vertices"].as_array().expect("edges").len() >= 8);
    assert_eq!(decoded["report"]["status"], "outside_v1_envelope");
    assert!(
        decoded["report"]["warnings"]
            .as_array()
            .expect("warnings")
            .len()
            > 0
    );
}

fn draw_logit_line(
    logits: &mut [f32],
    size: usize,
    start: (usize, usize),
    end: (usize, usize),
    value: f32,
) {
    let dx = end.0 as isize - start.0 as isize;
    let dy = end.1 as isize - start.1 as isize;
    let steps = dx.abs().max(dy.abs()).max(1);
    for step in 0..=steps {
        let x = start.0 as isize + dx * step / steps;
        let y = start.1 as isize + dy * step / steps;
        for oy in -1..=1 {
            for ox in -1..=1 {
                let px = x + ox;
                let py = y + oy;
                if px < 0 || py < 0 || px >= size as isize || py >= size as isize {
                    continue;
                }
                logits[py as usize * size + px as usize] = value;
            }
        }
    }
}

fn draw_rect(rgba: &mut [u8], width: usize, x0: usize, y0: usize, x1: usize, y1: usize) {
    for x in x0..=x1 {
        set_pixel(rgba, width, x, y0);
        set_pixel(rgba, width, x, y1);
    }
    for y in y0..=y1 {
        set_pixel(rgba, width, x0, y);
        set_pixel(rgba, width, x1, y);
    }
}

fn draw_line(rgba: &mut [u8], width: usize, x0: usize, y0: usize, x1: usize, y1: usize) {
    let dx = x1 as isize - x0 as isize;
    let dy = y1 as isize - y0 as isize;
    let steps = dx.abs().max(dy.abs()).max(1);
    for step in 0..=steps {
        let x = (x0 as isize + dx * step / steps) as usize;
        let y = (y0 as isize + dy * step / steps) as usize;
        set_pixel(rgba, width, x, y);
    }
}

fn set_pixel(rgba: &mut [u8], width: usize, x: usize, y: usize) {
    let idx = (y * width + x) * 4;
    rgba[idx] = 0;
    rgba[idx + 1] = 0;
    rgba[idx + 2] = 0;
    rgba[idx + 3] = 255;
}
