use oristudio_bp::engine::BpProjectSession;
use oristudio_bp::io::bps;
use oristudio_bp::model::Point;

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

fn flap_pos(session: &BpProjectSession, id: u32) -> (f64, f64) {
    let flap = session
        .project()
        .design
        .layout
        .flaps
        .iter()
        .find(|f| f.id == id)
        .unwrap_or_else(|| panic!("flap {id} missing"));
    (flap.x, flap.y)
}

/// The reported bug: after arranging flaps in the packing view, moving a tree
/// vertex (which changes neither length nor topology) must NOT move any flap.
/// BP Studio decouples flaps from their vertices once you enter layout mode
/// (`Design._onModeChanged` -> `$flaps.$sync.clear()`); we mirror that on the
/// first manual flap placement.
#[test]
fn moving_a_tree_vertex_does_not_reset_arranged_flaps() {
    let project = bps::load_project_str(STARTER).expect("starter loads");
    let mut session = BpProjectSession::new(project).expect("session builds");
    session.add_leaf(0, 1.0).expect("add leaf 2");

    // Arrange flap 2 by hand in the packing view.
    session.move_flap(2, Point { x: 5.0, y: 5.0 }, false).expect("place flap 2");
    assert_eq!(flap_pos(&session, 2), (5.0, 5.0), "flap 2 placed at (5,5)");
    let flap1_before = flap_pos(&session, 1);

    // Now drag tree vertex 2 to a very different tree-diagram position.
    session.move_vertex(2, Point { x: 3.0, y: 17.0 }, false).expect("move vertex 2");

    // Flap positions are unchanged — the tree edit did not touch the layout.
    assert_eq!(flap_pos(&session, 2), (5.0, 5.0), "flap 2 must stay where it was placed");
    assert_eq!(flap_pos(&session, 1), flap1_before, "unrelated flap 1 must not move");
}

/// Control: before any layout arranging, a freshly added leaf's flap still
/// follows its tree vertex (BP Studio's new-vertex behavior in tree mode). We
/// only stop following once the user starts placing flaps by hand.
#[test]
fn a_new_leaf_flap_follows_its_vertex_until_the_layout_is_touched() {
    let project = bps::load_project_str(STARTER).expect("starter loads");
    let mut session = BpProjectSession::new(project).expect("session builds");
    session.add_leaf(0, 1.0).expect("add leaf 2");

    let before = flap_pos(&session, 2);
    session.move_vertex(2, Point { x: 3.0, y: 17.0 }, false).expect("move vertex 2");
    let after = flap_pos(&session, 2);
    assert_ne!(before, after, "a still-new leaf's flap follows its tree vertex");
}
