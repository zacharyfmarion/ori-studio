use oristudio_bp::engine::BpProjectSession;
use oristudio_bp::io::bps;

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

/// Two 1-unit flaps far apart (starter + one added leaf) must NOT generate any
/// stretch device or junction — they have far more slack than the tree distance
/// between them. BP Studio's Core produces exactly `f1`, `f2`, `root` for this
/// design with no `s…` device graphics (verified via tools/bp-studio-oracle);
/// our snapshot must match. This guards the junction intersection gate: without
/// it every leaf pair yields a valid junction and a spurious gadget.
#[test]
fn distant_flaps_produce_no_stretch_device() {
    let project = bps::load_project_str(STARTER).expect("starter loads");
    let mut session = BpProjectSession::new(project).expect("session builds");
    session.add_leaf(0, 1.0).expect("add second leaf");

    let snapshot =
        oristudio_bp::io::cp::project_graphics_snapshot(session.project()).expect("graphics");

    let tags: Vec<&str> = snapshot
        .node_graphics
        .iter()
        .map(|entry| entry.id.as_str())
        .collect();
    assert_eq!(
        tags,
        vec!["f1", "f2"],
        "only the two flap contours, no gadget"
    );
    assert!(
        snapshot.device_graphics.is_empty(),
        "distant flaps must not generate a device, got {:?}",
        snapshot.device_graphics.len()
    );
    assert!(
        snapshot.invalid_junctions.is_empty(),
        "distant flaps do not overlap, so there is no invalid junction"
    );
}
