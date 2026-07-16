use oristudio_bp::engine::BpProjectSession;
use oristudio_bp::io::bps;
use oristudio_bp::model::Point;

// The exact starter the web app ships on "New Box Pleat".
const STARTER: &str = r#"{
  "version": "0.7",
  "design": {
    "title": "",
    "mode": "tree",
    "layout": { "sheet": { "type": "rect", "width": 16, "height": 16 }, "flaps": [], "stretches": [] },
    "tree": {
      "sheet": { "type": "rect", "width": 20, "height": 20 },
      "nodes": [
        { "id": 0, "x": 10, "y": 10, "name": "" },
        { "id": 1, "x": 10, "y": 9, "name": "" }
      ],
      "edges": [{ "n1": 0, "n2": 1, "length": 1 }]
    }
  }
}"#;

fn snapshot_json(session: &BpProjectSession) -> serde_json::Value {
    let snapshot =
        oristudio_bp::io::cp::project_graphics_snapshot(session.project()).expect("graphics");
    serde_json::to_value(&snapshot).unwrap()
}

fn f1_graphics(session: &BpProjectSession) -> serde_json::Value {
    snapshot_json(session)["nodeGraphics"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"] == "f1")
        .expect("f1 graphics present")
        .clone()
}

#[test]
fn starter_leaf_flap_matches_bp_studio_oracle() {
    let project = bps::load_project_str(STARTER).expect("starter loads");
    let mut session = BpProjectSession::new(project).expect("session builds");

    // BP Studio (oracle): default flap for the flapless leaf sits at the origin:
    //   contour [(1,1),(-1,1),(-1,-1),(1,-1)], ridges 4x from (0,0).
    let f1 = f1_graphics(&session);
    let default_outer = &f1["data"]["contours"][0]["outer"];
    assert_eq!(
        default_outer,
        &serde_json::json!([
            {"x":1.0,"y":1.0},{"x":-1.0,"y":1.0},{"x":-1.0,"y":-1.0},{"x":1.0,"y":-1.0}
        ]),
        "default flap contour must match BP Studio"
    );

    // BP Studio (oracle): dragging leaf 1 to (5,5) recenters it there:
    //   contour [(6,6),(4,6),(4,4),(6,4)], ridges 4x from (5,5).
    session
        .move_flap(1, Point { x: 5.0, y: 5.0 }, false)
        .expect("leaf 1 is draggable");
    let f1 = f1_graphics(&session);
    assert_eq!(
        &f1["data"]["contours"][0]["outer"],
        &serde_json::json!([
            {"x":6.0,"y":6.0},{"x":4.0,"y":6.0},{"x":4.0,"y":4.0},{"x":6.0,"y":4.0}
        ]),
        "moved flap contour must match BP Studio"
    );
    assert_eq!(
        &f1["data"]["ridges"],
        &serde_json::json!([
            [{"x":5.0,"y":5.0},{"x":6.0,"y":6.0}],
            [{"x":5.0,"y":5.0},{"x":4.0,"y":6.0}],
            [{"x":5.0,"y":5.0},{"x":4.0,"y":4.0}],
            [{"x":5.0,"y":5.0},{"x":6.0,"y":4.0}]
        ]),
        "moved flap ridges must match BP Studio"
    );
}
