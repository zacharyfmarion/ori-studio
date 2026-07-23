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

/// Moving a tree vertex changes neither length nor topology, so it must NOT
/// move any flap. BP Studio couples a newly created vertex to its flap until
/// you switch to layout mode (`Design._onModeChanged` -> `$flaps.$sync.clear()`);
/// we show both editors at once and diverge outright — the tree diagram never
/// places a flap.
#[test]
fn moving_a_tree_vertex_does_not_reset_arranged_flaps() {
    let project = bps::load_project_str(STARTER).expect("starter loads");
    let mut session = BpProjectSession::new(project).expect("session builds");
    session.add_leaf(0, 1.0).expect("add leaf 2");

    // Arrange flap 2 by hand in the packing view.
    session
        .move_flap(2, Point { x: 5.0, y: 5.0 }, false)
        .expect("place flap 2");
    assert_eq!(flap_pos(&session, 2), (5.0, 5.0), "flap 2 placed at (5,5)");
    let flap1_before = flap_pos(&session, 1);

    // Now drag tree vertex 2 to a very different tree-diagram position.
    session
        .move_vertex(2, Point { x: 3.0, y: 17.0 }, false)
        .expect("move vertex 2");

    // Flap positions are unchanged — the tree edit did not touch the layout.
    assert_eq!(
        flap_pos(&session, 2),
        (5.0, 5.0),
        "flap 2 must stay where it was placed"
    );
    assert_eq!(
        flap_pos(&session, 1),
        flap1_before,
        "unrelated flap 1 must not move"
    );
}

/// The same holds for a leaf that was just added and whose flap nobody has
/// touched yet: the flap keeps the position `add_leaf` seeded it with. (BP
/// Studio would drag this one along — see `Vertex._move`. This is the divergence.)
#[test]
fn a_new_leaf_flap_stays_put_when_its_vertex_moves() {
    let project = bps::load_project_str(STARTER).expect("starter loads");
    let mut session = BpProjectSession::new(project).expect("session builds");
    session.add_leaf(0, 1.0).expect("add leaf 2");

    let before = flap_pos(&session, 2);
    session
        .move_vertex(2, Point { x: 3.0, y: 17.0 }, false)
        .expect("move vertex 2");
    assert_eq!(
        flap_pos(&session, 2),
        before,
        "a tree-diagram move never places a flap"
    );
}

/// Undo/redo of a vertex move replays only the vertex, never the layout.
#[test]
fn undoing_a_vertex_move_leaves_flaps_alone() {
    let project = bps::load_project_str(STARTER).expect("starter loads");
    let mut session = BpProjectSession::new(project).expect("session builds");
    session.add_leaf(0, 1.0).expect("add leaf 2");
    session
        .move_flap(2, Point { x: 5.0, y: 5.0 }, false)
        .expect("place flap 2");

    session
        .move_vertex(2, Point { x: 3.0, y: 17.0 }, false)
        .expect("move vertex 2");
    session.undo().expect("undo the vertex move");
    assert_eq!(
        flap_pos(&session, 2),
        (5.0, 5.0),
        "undo must not move flaps"
    );
    session.redo().expect("redo the vertex move");
    assert_eq!(
        flap_pos(&session, 2),
        (5.0, 5.0),
        "redo must not move flaps"
    );
}
