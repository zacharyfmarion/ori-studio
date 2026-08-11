//! Ground truth captured from BP Studio's headless Core for a design where one
//! flap overlaps a stack of five siblings, so most of the resulting junctions
//! are covered:
//!
//! ```sh
//! bun tools/bp-studio-oracle/layout-graphics.ts \
//!   tests/fixtures/bp-studio/covered-junction-stretch.sample.json
//! ```
//!
//! Flap 25's junctions with 7/9/11 form one team (and 8/10/12 its mirror). Only
//! `11,25` and `12,25` survive the covering check, so each team must resolve to
//! a two-flap stretch with a pattern. Treating a covered junction as uncovered
//! grows the team to three flaps, which has no configuration at all — the
//! stretch device disappears and the flaps fall back to bare rectangles.

use oristudio_bp::io::bps;
use oristudio_bp::io::cp::project_graphics_snapshot;

const COVERED_JUNCTION_STRETCH: &str =
    include_str!("../../../tests/fixtures/bp-studio/covered-junction-stretch.sample.json");

fn snapshot() -> oristudio_bp::io::cp::LayoutGraphicsSnapshot {
    let project = bps::load_project_str(COVERED_JUNCTION_STRETCH).expect("fixture loads");
    project_graphics_snapshot(&project).expect("graphics snapshot")
}

#[test]
fn covered_junctions_leave_two_flap_stretches() {
    let snapshot = snapshot();

    let stretches = snapshot
        .stretches
        .iter()
        .map(|stretch| (stretch.id.as_str(), stretch.flap_ids.as_slice()))
        .collect::<Vec<_>>();
    assert_eq!(
        stretches,
        vec![
            ("11,25", [11, 25].as_slice()),
            ("12,25", [12, 25].as_slice())
        ]
    );

    for stretch in &snapshot.stretches {
        assert!(stretch.pattern_found, "{} has a pattern", stretch.id);
        assert_eq!(stretch.configuration_count, 1, "{}", stretch.id);
        assert_eq!(stretch.pattern_count, 2, "{}", stretch.id);
        assert_eq!(stretch.regions.len(), 1, "{} covers one gap", stretch.id);
    }
    assert!(!snapshot.pattern_not_found);
    assert!(snapshot.invalid_junctions.is_empty());
}

#[test]
fn stretch_devices_match_bp_studio_oracle() {
    let snapshot = snapshot();

    let devices = snapshot
        .device_graphics
        .iter()
        .map(|entry| entry.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(devices, vec!["s11,25.0", "s12,25.0"]);

    let device = serde_json::to_value(&snapshot.device_graphics[0].data).unwrap();
    assert_eq!(
        device["contours"][0]["outer"],
        serde_json::json!([
            {"x":24.0,"y":18.0},{"x":23.0,"y":16.0},{"x":14.0,"y":13.0},{"x":15.0,"y":15.0}
        ])
    );
    assert_eq!(
        device["ridges"],
        serde_json::json!([
            [{"x":24.0,"y":18.0},{"x":23.0,"y":16.0}],
            [{"x":23.0,"y":16.0},{"x":14.0,"y":13.0}],
            [{"x":14.0,"y":13.0},{"x":15.0,"y":15.0}],
            [{"x":15.0,"y":15.0},{"x":24.0,"y":18.0}],
            [{"x":24.0,"y":18.0},{"x":25.0,"y":19.0}],
            [{"x":14.0,"y":13.0},{"x":13.0,"y":12.0}],
            [{"x":15.0,"y":15.0},{"x":18.0,"y":18.0}]
        ])
    );
}

/// The stretch pattern indents the contour of the flap it sits on, so a lost
/// stretch shows up in the pane as a plain rectangle here.
#[test]
fn patterned_flap_contour_matches_bp_studio_oracle() {
    let snapshot = snapshot();

    let f25 = snapshot
        .node_graphics
        .iter()
        .find(|entry| entry.id == "f25")
        .expect("f25 graphics");
    let data = serde_json::to_value(&f25.data).unwrap();
    assert_eq!(
        data["contours"][0]["outer"],
        serde_json::json!([
            {"x":7.0,"y":6.0},
            {"x":19.0,"y":6.0},
            {"x":19.0,"y":14.666666666666666},
            {"x":18.0,"y":16.0},
            {"x":18.0,"y":18.0},
            {"x":8.0,"y":18.0},
            {"x":8.0,"y":16.0},
            {"x":7.0,"y":14.666666666666666}
        ])
    );
}
