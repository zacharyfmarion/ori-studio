use std::path::Path;

use treemaker_fold::FoldDocument;
use treemaker_sequence::{
    CertificateStatus, ComplexMoveKind, PlanStatus, SequenceError, SequenceState, SolutionLimit,
    TargetStateOptions, plan_folding_sequence, recognize_complex_moves, resolve_target_state,
    trace_plan,
};

fn fixture_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("repo root")
}

fn read_fold(path: impl AsRef<Path>) -> FoldDocument {
    let path = path.as_ref();
    let text =
        std::fs::read_to_string(path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

#[test]
fn phase0_fixtures_resolve_target_states() {
    let root = fixture_root().join("tests/fixtures/folding-sequence/fold");
    for fixture in [
        "simple-valley.fold",
        "accordion-book-fold.fold",
        "kite-rabbit-ear-local.fold",
        "squash-local.fold",
        "treemaker-triad-base.fold",
        "simultaneous-collapse-unsupported.fold",
    ] {
        let document = read_fold(root.join(fixture));
        let target = resolve_target_state(&document, TargetStateOptions::default())
            .unwrap_or_else(|error| panic!("{fixture}: {error}"));

        assert_eq!(
            target.folded_vertices.len(),
            target.normalized.vertices_coords.len(),
            "{fixture}"
        );
        assert_eq!(
            target.faces_flip.len(),
            target.normalized.faces_vertices.len(),
            "{fixture}"
        );
        assert_eq!(
            target.id_map.normalized_edges_to_input_edges.len(),
            target.normalized.edges_vertices.len(),
            "{fixture}"
        );
        assert_eq!(target.selected_solution_index, 0, "{fixture}");
        assert!(!target.states.is_empty(), "{fixture}");
        let plan =
            plan_folding_sequence(&target).unwrap_or_else(|error| panic!("{fixture}: {error}"));
        assert!(
            matches!(
                plan.status,
                PlanStatus::Complete | PlanStatus::Partial | PlanStatus::Unsupported
            ),
            "{fixture}"
        );
    }
}

#[test]
fn phase0_simple_fixtures_have_complete_phase3_plans() {
    let root = fixture_root().join("tests/fixtures/folding-sequence/fold");
    for (fixture, expected_steps) in [("simple-valley.fold", 1), ("accordion-book-fold.fold", 2)] {
        let document = read_fold(root.join(fixture));
        let target = resolve_target_state(&document, TargetStateOptions::default())
            .unwrap_or_else(|error| panic!("{fixture}: {error}"));
        let plan =
            plan_folding_sequence(&target).unwrap_or_else(|error| panic!("{fixture}: {error}"));

        assert_eq!(plan.status, PlanStatus::Complete, "{fixture}");
        assert_eq!(plan.steps.len(), expected_steps, "{fixture}");
        assert!(plan.unresolved_regions.is_empty(), "{fixture}");
        assert_eq!(plan.search.best_unresolved_creases, 0, "{fixture}");
    }
}

#[test]
fn phase0_complex_fixtures_are_recognized_but_not_faked() {
    let root = fixture_root().join("tests/fixtures/folding-sequence/fold");
    for (fixture, expected_kind, expected_status) in [
        (
            "kite-rabbit-ear-local.fold",
            ComplexMoveKind::RabbitEar,
            PlanStatus::Complete,
        ),
        (
            "squash-local.fold",
            ComplexMoveKind::SquashFold,
            PlanStatus::Complete,
        ),
        (
            "treemaker-triad-base.fold",
            ComplexMoveKind::MoleculeCollapse,
            PlanStatus::Complete,
        ),
        (
            "simultaneous-collapse-unsupported.fold",
            ComplexMoveKind::SimultaneousCollapse,
            PlanStatus::Unsupported,
        ),
    ] {
        let document = read_fold(root.join(fixture));
        let target = resolve_target_state(&document, TargetStateOptions::default())
            .unwrap_or_else(|error| panic!("{fixture}: {error}"));
        let state = SequenceState::from_target("target", &target);
        let candidates =
            recognize_complex_moves(&state).unwrap_or_else(|error| panic!("{fixture}: {error}"));
        let plan =
            plan_folding_sequence(&target).unwrap_or_else(|error| panic!("{fixture}: {error}"));

        assert!(
            candidates
                .iter()
                .any(|candidate| candidate.kind == expected_kind),
            "{fixture}: {candidates:?}"
        );
        assert_eq!(plan.status, expected_status, "{fixture}");
        if expected_status == PlanStatus::Complete {
            assert!(
                plan.steps
                    .iter()
                    .any(|step| step_matches_kind(step, &expected_kind)),
                "{fixture}: completed complex fixture should use a certified or heuristic local collapse step"
            );
            assert!(
                plan.unresolved_regions.is_empty(),
                "{fixture}: completed complex fixture should not leave unresolved regions"
            );
        } else {
            match plan.steps.first() {
                Some(treemaker_sequence::InstructionStep::ManualCollapse(details)) => {
                    assert_eq!(details.label, "Collapse up until this point", "{fixture}");
                    assert_eq!(details.before_state, "flat-cp", "{fixture}");
                    assert!(
                        matches!(details.after_state.as_str(), "state-1" | "target"),
                        "{fixture}: {}",
                        details.after_state
                    );
                }
                other => panic!("{fixture}: expected leading manual collapse step, got {other:?}"),
            }
            assert!(
                !plan.steps.iter().any(|step| matches!(
                    step,
                    treemaker_sequence::InstructionStep::UnsupportedRegion(_)
                )),
                "{fixture}: unsupported region should be represented by a leading manual collapse step"
            );
            assert!(
                !plan.unresolved_regions.is_empty(),
                "{fixture}: complex moves must not be silently dropped"
            );
        }
    }
}

#[test]
fn phase0_fixture_traces_lock_step_certainty_contracts() {
    let root = fixture_root().join("tests/fixtures/folding-sequence/fold");
    for (fixture, expected_kind, expected_status, expected_recognizer) in [
        (
            "simple-valley.fold",
            "simple_fold",
            Some(CertificateStatus::Verified),
            Some("boundary_simple_fold"),
        ),
        (
            "kite-rabbit-ear-local.fold",
            "local_collapse",
            Some(CertificateStatus::Heuristic),
            Some("topology_only_rabbit_ear"),
        ),
        (
            "squash-local.fold",
            "local_collapse",
            Some(CertificateStatus::Heuristic),
            Some("topology_only_squash_fold"),
        ),
        (
            "treemaker-triad-base.fold",
            "local_collapse",
            Some(CertificateStatus::Heuristic),
            Some("topology_only_molecule_collapse"),
        ),
        (
            "simultaneous-collapse-unsupported.fold",
            "manual_collapse",
            Some(CertificateStatus::Manual),
            Some("manual_collapse_boundary"),
        ),
    ] {
        let document = read_fold(root.join(fixture));
        let target = resolve_target_state(&document, TargetStateOptions::default())
            .unwrap_or_else(|error| panic!("{fixture}: {error}"));
        let plan =
            plan_folding_sequence(&target).unwrap_or_else(|error| panic!("{fixture}: {error}"));
        let trace = trace_plan(&plan);
        let first = trace
            .candidates
            .first()
            .unwrap_or_else(|| panic!("{fixture}: expected at least one trace candidate"));

        assert_eq!(first.kind, expected_kind, "{fixture}");
        assert_eq!(first.certificate_status, expected_status, "{fixture}");
        assert_eq!(
            first.recognizer.as_deref(),
            expected_recognizer,
            "{fixture}"
        );
        if first.certificate_status == Some(CertificateStatus::Heuristic) {
            assert_eq!(plan.status, PlanStatus::Complete, "{fixture}");
            assert!(
                plan.diagnostics
                    .iter()
                    .any(|diagnostic| diagnostic.code == "heuristic_step_certificate"),
                "{fixture}: heuristic traces should include an explicit diagnostic"
            );
        }
    }
}

fn step_matches_kind(step: &treemaker_sequence::InstructionStep, kind: &ComplexMoveKind) -> bool {
    match (step, kind) {
        (treemaker_sequence::InstructionStep::ReverseFold(_), ComplexMoveKind::ReverseFold)
        | (treemaker_sequence::InstructionStep::SquashFold(_), ComplexMoveKind::SquashFold)
        | (treemaker_sequence::InstructionStep::RabbitEar(_), ComplexMoveKind::RabbitEar)
        | (
            treemaker_sequence::InstructionStep::MoleculeCollapse(_),
            ComplexMoveKind::MoleculeCollapse,
        )
        | (
            treemaker_sequence::InstructionStep::SimultaneousCollapse(_),
            ComplexMoveKind::SimultaneousCollapse,
        ) => true,
        (treemaker_sequence::InstructionStep::LocalCollapse(details), kind) => details
            .certificate
            .as_ref()
            .is_some_and(|certificate| certificate.recognizer == topology_recognizer(kind)),
        _ => false,
    }
}

fn topology_recognizer(kind: &ComplexMoveKind) -> &'static str {
    match kind {
        ComplexMoveKind::ReverseFold => "topology_only_reverse_fold",
        ComplexMoveKind::SquashFold => "topology_only_squash_fold",
        ComplexMoveKind::RabbitEar => "topology_only_rabbit_ear",
        ComplexMoveKind::MoleculeCollapse => "topology_only_molecule_collapse",
        ComplexMoveKind::SimultaneousCollapse => "topology_only_simultaneous_collapse",
    }
}

#[test]
fn target_state_preserves_source_ids_for_phase0_simple_valley() {
    let document =
        read_fold(fixture_root().join("tests/fixtures/folding-sequence/fold/simple-valley.fold"));
    let target = resolve_target_state(&document, TargetStateOptions::default())
        .expect("simple valley target state");

    assert!(
        target
            .id_map
            .normalized_vertices_to_input_vertices
            .iter()
            .all(|vertices| !vertices.is_empty())
    );
    assert!(
        target
            .id_map
            .normalized_edges_to_input_edges
            .iter()
            .all(|edges| !edges.is_empty())
    );
    assert_eq!(
        target.id_map.normalized_faces_to_input_faces,
        vec![vec![0], vec![1]]
    );
}

#[test]
fn flat_folder_kabuto_without_faces_resolves_generated_target_state() {
    let document = read_fold(fixture_root().join("tests/fixtures/flat-folder/kabuto.fold"));
    let target = resolve_target_state(
        &document,
        TargetStateOptions {
            solution_limit: SolutionLimit::Count(10),
            ..TargetStateOptions::default()
        },
    )
    .expect("kabuto target state");

    assert!(!target.normalized.faces_vertices.is_empty());
    assert_eq!(target.states, "9");
    assert_eq!(target.face_orders.len(), 117);
    assert!(target.has_layer_order_ambiguity());
    assert!(
        target
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "ambiguous_layer_order")
    );
    assert!(
        target
            .id_map
            .normalized_edges_to_input_edges
            .iter()
            .any(|edges| !edges.is_empty())
    );
    assert!(
        target
            .id_map
            .normalized_faces_to_input_faces
            .iter()
            .all(Vec::is_empty)
    );
}

#[test]
fn unique_layer_order_requirement_rejects_ambiguous_target() {
    let document = read_fold(fixture_root().join("tests/fixtures/flat-folder/kabuto.fold"));
    let error = resolve_target_state(
        &document,
        TargetStateOptions {
            require_unique_layer_order: true,
            ..TargetStateOptions::default()
        },
    )
    .expect_err("kabuto has multiple layer-order states");

    assert_eq!(
        error,
        SequenceError::AmbiguousLayerOrder {
            states: "9".to_string()
        }
    );
}
