use oristudio_bp::engine::BpProjectSession;
use oristudio_bp::io::bps;

const VALID_PACKING: &str =
    include_str!("../../../tests/fixtures/bp-studio/valid-packing.sample.json");

/// A flap's name lives on its dual tree leaf vertex (flap id == vertex id), so
/// the frontend "rename flap" wires straight to `rename_vertex`. Reads the name
/// back from the exported project, which is what the frontend snapshots.
fn vertex_name(session: &BpProjectSession, id: u32) -> String {
    session
        .project_for_export()
        .design
        .tree
        .nodes
        .iter()
        .find(|n| n.id == id)
        .unwrap_or_else(|| panic!("vertex {id} missing"))
        .name
        .clone()
}

/// Renaming flap 2 sets the name on tree vertex 2, and the change is undoable.
#[test]
fn rename_flap_sets_vertex_name_and_is_undoable() {
    let project = bps::load_project_str(VALID_PACKING).expect("valid packing loads");
    let mut session = BpProjectSession::new(project).expect("session builds");
    assert_eq!(vertex_name(&session, 2), "b", "initial vertex 2 name");

    session
        .rename_vertex(2, "left leg".to_string())
        .expect("rename vertex 2");
    assert_eq!(vertex_name(&session, 2), "left leg", "name after rename");

    session.undo().expect("undo rename");
    assert_eq!(vertex_name(&session, 2), "b", "name restored after undo");
}

/// Empty and duplicate names are allowed (BP Studio parity — no validation).
#[test]
fn rename_flap_allows_empty_and_duplicate_names() {
    let project = bps::load_project_str(VALID_PACKING).expect("valid packing loads");
    let mut session = BpProjectSession::new(project).expect("session builds");

    session.rename_vertex(2, String::new()).expect("empty name");
    assert_eq!(vertex_name(&session, 2), "", "empty name accepted");

    // Duplicate of vertex 1's name ("a") — no uniqueness constraint.
    session
        .rename_vertex(2, "a".to_string())
        .expect("duplicate name");
    assert_eq!(vertex_name(&session, 1), "a", "vertex 1 unchanged");
    assert_eq!(vertex_name(&session, 2), "a", "duplicate name accepted");
}

/// Renaming to the current name is a no-op: it records no history entry, so a
/// single undo skips past it to the prior real change.
#[test]
fn rename_flap_to_same_name_records_no_history() {
    let project = bps::load_project_str(VALID_PACKING).expect("valid packing loads");
    let mut session = BpProjectSession::new(project).expect("session builds");

    session
        .rename_vertex(2, "x".to_string())
        .expect("rename to x");
    // No-op: name unchanged, so this must not push a redundant undo entry.
    session
        .rename_vertex(2, "x".to_string())
        .expect("rename to x again");

    session.undo().expect("undo");
    assert_eq!(
        vertex_name(&session, 2),
        "b",
        "single undo reverts the one real rename (no-op added no entry)"
    );
}
