use std::path::Path;

use oristudio_cp_detect::{DetectStatus, parse_oracle_fixture_manifest_json};

#[test]
fn parses_python_oracle_fixture_manifest() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cp-detect-oracle");
    let manifest_path = root.join("manifest.json");
    let manifest = parse_oracle_fixture_manifest_json(
        &std::fs::read_to_string(&manifest_path).expect("fixture manifest should exist"),
    )
    .expect("oracle fixture manifest should parse");

    assert_eq!(
        manifest.detector_checkpoint_id,
        "runpod-v2-replay-correction-full-4000ada"
    );
    assert_eq!(manifest.fixtures.len(), 1);

    let fixture = &manifest.fixtures[0];
    assert_eq!(fixture.id, "clean-smoke");
    assert_eq!(fixture.expected_status, DetectStatus::OutsideV1Envelope);
    assert!(root.join(&fixture.source_image_path).exists());
    assert!(
        fixture
            .rectified_image_path
            .as_ref()
            .is_some_and(|path| root.join(path).exists())
    );

    let fold: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root.join(&fixture.fold_path)).expect("fold should exist"),
    )
    .expect("fold should be JSON");
    let report: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root.join(&fixture.report_path)).expect("report should exist"),
    )
    .expect("report should be JSON");

    assert_eq!(
        fold["vertices_coords"]
            .as_array()
            .expect("vertices should be an array")
            .len(),
        fixture.expected_vertices as usize
    );
    assert_eq!(
        fold["edges_vertices"]
            .as_array()
            .expect("edges should be an array")
            .len(),
        fixture.expected_edges as usize
    );
    assert_eq!(report["status"], "outside_v1_envelope");
    assert_eq!(report["config"]["image_size"], 1024);
}
