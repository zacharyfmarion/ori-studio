use oristudio_bp::engine::{
    HistoryCommand, HistoryManager, OperationResult, Step, StepRecord, command_signature,
};
use oristudio_bp::model::{DesignMode, Edge, Point};
use serde_json::json;

#[test]
fn command_json_and_signatures_match_upstream_shape() {
    let command = HistoryCommand::edit(
        vec![(
            true,
            Edge {
                n1: 0,
                n2: 1,
                length: 2.0,
            },
        )],
        0,
        1,
    );
    assert_eq!(command.signature(), "2:tree");
    assert_eq!(
        serde_json::to_value(&command).unwrap(),
        json!({
            "type": 2,
            "tag": "tree",
            "old": 0,
            "new": 1,
            "edits": [[true, { "n1": 0, "n2": 1, "length": 2.0 }]]
        })
    );

    let commands = vec![
        HistoryCommand::move_command("b", Point { x: 0.0, y: 0.0 }, Point { x: 1.0, y: 0.0 }),
        HistoryCommand::field("a", "x", json!(0), json!(1)),
    ];
    assert_eq!(command_signature(&commands), "0:a;1:b");
}

#[test]
fn field_and_move_commands_coalesce_with_upstream_rules() {
    let mut existing = HistoryCommand::field("n", "length", json!(1), json!(2));
    let incoming = HistoryCommand::field("n", "length", json!(2), json!(3));
    assert!(incoming.can_add_to(&existing, false));
    incoming.add_to(&mut existing);
    assert_eq!(
        serde_json::to_value(&existing).unwrap(),
        json!({ "type": 0, "tag": "n", "prop": "length", "old": 1, "new": 3 })
    );

    let existing =
        HistoryCommand::move_command("f1", Point { x: 0.0, y: 0.0 }, Point { x: 1.0, y: 0.0 });
    let incoming =
        HistoryCommand::move_command("f1", Point { x: 1.0, y: 0.0 }, Point { x: 0.0, y: 0.0 });
    assert!(!incoming.can_add_to(&existing, false));
    assert!(incoming.can_add_to(&existing, true));
}

#[test]
fn step_combines_commands_and_cancels_matching_mementos() {
    let mut step = Step::new(StepRecord {
        commands: vec![HistoryCommand::field("f1", "x", json!(0), json!(1))],
        construct: vec![("f1".to_string(), json!({ "id": 1 }))],
        destruct: Vec::new(),
        mode: DesignMode::Layout,
        before: vec!["old".to_string()],
        after: vec!["new".to_string()],
    });

    assert!(step.try_add(
        &[HistoryCommand::field("f1", "x", json!(1), json!(2))],
        Vec::new(),
        vec![("f1".to_string(), json!({ "id": 1 }))],
        false,
    ));
    let record = step.to_record();
    assert!(record.construct.is_empty());
    assert!(record.destruct.is_empty());
    assert_eq!(
        serde_json::to_value(&record.commands[0]).unwrap(),
        json!({ "type": 0, "tag": "f1", "prop": "x", "old": 0, "new": 2 })
    );
}

#[test]
fn history_manager_flushes_combines_trims_and_tracks_save_index() {
    let mut history = HistoryManager::new();
    history.field_change_flush(
        "locked",
        "x",
        json!(0),
        json!(1),
        DesignMode::Tree,
        Vec::new(),
    );
    assert!(history.steps().is_empty());

    history.flush(DesignMode::Tree, Vec::new());
    history.cache_selection(vec!["before".to_string()]);
    history.field_change_flush(
        "f1",
        "x",
        json!(0),
        json!(1),
        DesignMode::Tree,
        vec!["after".to_string()],
    );
    history.field_change_flush(
        "f1",
        "x",
        json!(1),
        json!(2),
        DesignMode::Tree,
        vec!["after".to_string()],
    );
    assert_eq!(history.steps().len(), 1);
    assert_eq!(history.index(), 1);
    assert!(history.is_modified());
    history.notify_save();
    assert!(!history.is_modified());

    for i in 0..32 {
        history.field_change_flush(
            format!("f{i}"),
            "x",
            json!(0),
            json!(i),
            DesignMode::Tree,
            Vec::new(),
        );
    }
    assert_eq!(history.steps().len(), 30);
    assert_eq!(history.index(), 30);
    assert_eq!(history.saved_index(), -1);
}

#[test]
fn history_manager_truncates_on_partial_navigation_results() {
    let mut history = HistoryManager::new();
    history.flush(DesignMode::Tree, Vec::new());
    for i in 0..3 {
        history.field_change_flush(
            format!("f{i}"),
            "x",
            json!(0),
            json!(i + 1),
            DesignMode::Tree,
            Vec::new(),
        );
    }

    history.apply_undo_result(OperationResult::Partial);
    assert_eq!(history.index(), 0);
    assert_eq!(history.steps().len(), 1);

    history.apply_redo_result(OperationResult::Failed);
    assert_eq!(history.index(), 0);
    assert_eq!(history.steps().len(), 0);
}
