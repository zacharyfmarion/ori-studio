use oristudio_bp::engine::BpProjectSession;
use oristudio_bp::io::bps;
use oristudio_bp::model::Point;

const VALID_PACKING: &str =
    include_str!("../../../tests/fixtures/bp-studio/valid-packing.sample.json");

fn flap_pos(session: &BpProjectSession, id: u32) -> (f64, f64) {
    let project = session.project_for_export();
    let flap = project
        .design
        .layout
        .flaps
        .iter()
        .find(|f| f.id == id)
        .unwrap_or_else(|| panic!("flap {id} missing"));
    (flap.x, flap.y)
}

fn f_graphics(session: &BpProjectSession, tag: &str) -> serde_json::Value {
    // The frontend renders project_graphics_snapshot (bp_project_layout_snapshot),
    // recomputed on-demand from the project — so THAT is what we diff vs BP Studio.
    let snapshot =
        oristudio_bp::io::cp::project_graphics_snapshot(session.project()).expect("graphics");
    serde_json::to_value(&snapshot).unwrap()["nodeGraphics"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"] == tag)
        .unwrap_or_else(|| panic!("{tag} graphics missing"))
        .clone()
}

/// Ground truth captured from BP Studio's headless Core (DesignController.init +
/// update) for the same design and edit — see tools/bp-studio-oracle. Moving
/// flap 2 from (4,0) to (5,0) must reproduce BP Studio's contours and ridges.
#[test]
fn flap_move_graphics_match_bp_studio_oracle() {
    let project = bps::load_project_str(VALID_PACKING).expect("valid packing loads");
    let mut session = BpProjectSession::new(project).expect("session builds");
    assert_eq!(flap_pos(&session, 2), (4.0, 0.0), "initial flap 2 position");

    session
        .move_flap(2, Point { x: 5.0, y: 0.0 }, false)
        .expect("move flap 2 to (5,0)");
    assert_eq!(flap_pos(&session, 2), (5.0, 0.0), "flap 2 after move");

    // BP Studio f1 (stationary, at origin).
    let f1 = f_graphics(&session, "f1");
    assert_eq!(
        &f1["data"]["contours"][0]["outer"],
        &serde_json::json!([
            {"x":1.0,"y":1.0},{"x":-1.0,"y":1.0},{"x":-1.0,"y":-1.0},{"x":1.0,"y":-1.0}
        ])
    );
    // BP Studio f2 (moved to (5,0)): contour and 4 ridges from its center.
    let f2 = f_graphics(&session, "f2");
    assert_eq!(
        &f2["data"]["contours"][0]["outer"],
        &serde_json::json!([
            {"x":6.0,"y":1.0},{"x":4.0,"y":1.0},{"x":4.0,"y":-1.0},{"x":6.0,"y":-1.0}
        ])
    );
    assert_eq!(
        &f2["data"]["ridges"],
        &serde_json::json!([
            [{"x":5.0,"y":0.0},{"x":6.0,"y":1.0}],
            [{"x":5.0,"y":0.0},{"x":4.0,"y":1.0}],
            [{"x":5.0,"y":0.0},{"x":4.0,"y":-1.0}],
            [{"x":5.0,"y":0.0},{"x":6.0,"y":-1.0}]
        ])
    );
}
