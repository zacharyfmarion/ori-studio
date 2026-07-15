use oristudio_bp::engine::BpProjectSession;
use oristudio_bp::io::bps;

const ROOT_WITH_LEAF: &str = r#"{
  "version": "0.7",
  "design": {
    "title": "",
    "mode": "tree",
    "layout": { "sheet": {"type":"rect","width":16,"height":16}, "flaps": [], "stretches": [] },
    "tree": {
      "sheet": {"type":"rect","width":20,"height":20},
      "nodes": [{"id":0,"x":10,"y":10,"name":"root"},{"id":1,"x":11,"y":10,"name":""}],
      "edges": [{"n1":0,"n2":1,"length":1}]
    }
  }
}"#;

#[test]
fn scaffolded_root_project_loads_and_accepts_edits() {
    let project = bps::load_project_str(ROOT_WITH_LEAF).expect("scaffolded project loads");
    let mut session = BpProjectSession::new(project).expect("session builds");
    // Add another unit leaf to the root and move it to a float (non-grid) spot.
    session
        .add_leaf(0, 1.0)
        .expect("add a unit leaf to the root");
    session
        .move_vertex(2, oristudio_bp::model::Point { x: 9.31, y: 10.72 }, false)
        .expect("move the new leaf to a float position");
}
