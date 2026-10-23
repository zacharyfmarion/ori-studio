use std::collections::BTreeMap;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;
use sha2::{Digest, Sha256};
use treemaker_flatfold::{
    AnalyzeOptions, Completion, CompletionOptions, NormalizeOptions, SolveOptions,
    analyze_flat_fold, complete_layer_order, flat_folder_completion_problem, normalize_fold,
    solve_flat_fold,
};
use treemaker_fold::{Assignment, FoldDocument};

mod support;
use support::repo_root;

#[test]
fn flat_folder_normalization_matches_js_oracle_when_enabled() {
    let Some(mut oracle) = env::var_os("FLATFOLDER_ORACLE").map(PathBuf::from) else {
        eprintln!("skipping Flat-Folder oracle parity; set FLATFOLDER_ORACLE to enable");
        return;
    };
    let root = repo_root();
    if oracle.is_relative() {
        oracle = root.join(oracle);
    }
    for fixture in [
        "kabuto.fold",
        "bad_twist.fold",
        "r271-s03.fold",
        "r069-s07.fold",
    ] {
        let path = root.join("tests/fixtures/flat-folder").join(fixture);
        let record = run_flat_folder_oracle(&oracle, &root, "overlap", &path);
        assert_eq!(record["status"].as_str(), Some("ok"), "{fixture}");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|err| panic!("{}: {err}", path.display()));
        let document: FoldDocument =
            serde_json::from_str(&text).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
        let normalized = normalize_fold(&document, NormalizeOptions::default())
            .unwrap_or_else(|err| panic!("{}: {err}", path.display()));
        assert_normalize_record(
            &normalized.document,
            &normalized.vertex_vertices,
            &record,
            fixture,
        );
        let analysis = treemaker_flatfold::analyze_flat_fold(
            &document,
            treemaker_flatfold::AnalyzeOptions {
                ..treemaker_flatfold::AnalyzeOptions::default()
            },
        )
        .unwrap_or_else(|err| panic!("{}: {err}", path.display()));
        assert_project_record(
            &analysis.folded_vertices,
            &analysis.faces_flip,
            &record,
            fixture,
        );
        let overlap = analysis
            .overlap
            .as_ref()
            .unwrap_or_else(|| panic!("{fixture}: missing overlap graph"));
        assert_overlap_record(overlap, &record, fixture);
    }
}

#[test]
fn flat_folder_solver_matches_js_oracle_when_enabled() {
    let Some(mut oracle) = env::var_os("FLATFOLDER_ORACLE").map(PathBuf::from) else {
        eprintln!("skipping Flat-Folder solver oracle parity; set FLATFOLDER_ORACLE to enable");
        return;
    };
    let root = repo_root();
    if oracle.is_relative() {
        oracle = root.join(oracle);
    }
    for fixture in ["kabuto.fold", "r271-s03.fold", "r069-s07.fold"] {
        let path = root.join("tests/fixtures/flat-folder").join(fixture);
        let record = run_flat_folder_oracle(&oracle, &root, "solve", &path);
        assert_eq!(record["status"].as_str(), Some("ok"), "{fixture}");
        let solved = solve_flat_fold(&read_fold(&path), SolveOptions::default())
            .unwrap_or_else(|err| panic!("{}: {err}", path.display()));

        assert_constraint_record(&solved.constraints, &record, fixture);
        let solve = &record["solve"];
        assert_eq!(
            solved.component_sizes,
            solve["component_sizes"]
                .as_array()
                .expect("component_sizes")
                .iter()
                .map(|value| value.as_u64().expect("component size") as usize)
                .collect::<Vec<_>>(),
            "{fixture} component_sizes"
        );
        assert_eq!(
            solved.solution_counts,
            solve["solution_counts"]
                .as_array()
                .expect("solution_counts")
                .iter()
                .map(|value| value.as_u64().expect("solution count") as usize)
                .collect::<Vec<_>>(),
            "{fixture} solution_counts"
        );
        assert_eq!(
            solved.states,
            solve["states"].as_str().expect("states"),
            "{fixture} states"
        );
        assert_eq!(
            solved.face_orders.len(),
            solve["face_orders"].as_u64().expect("face_orders") as usize,
            "{fixture} face_orders"
        );
        assert_hash(&solved.face_orders, solve, "face_orders_hash", fixture);
    }
}

/// The completion entry point's port of `error_faces`, run over Flat-Folder's
/// own constraints, names the faces upstream's `initial_assignment` names.
#[test]
fn flat_folder_seed_conflict_matches_js_oracle_when_enabled() {
    let Some(mut oracle) = env::var_os("FLATFOLDER_ORACLE").map(PathBuf::from) else {
        eprintln!("skipping Flat-Folder conflict oracle parity; set FLATFOLDER_ORACLE to enable");
        return;
    };
    let root = repo_root();
    if oracle.is_relative() {
        oracle = root.join(oracle);
    }
    let path = root.join("tests/fixtures/flat-folder/bad_twist.fold");
    let record = run_flat_folder_oracle(&oracle, &root, "solve", &path);
    assert_eq!(
        record["status"].as_str(),
        Some("assignment-conflict"),
        "bad_twist.fold"
    );
    let analysis = analyze_flat_fold(&read_fold(&path), AnalyzeOptions::default())
        .expect("bad_twist.fold analysis");
    let problem = flat_folder_completion_problem(&analysis).expect("bad_twist.fold problem");
    let Ok(Completion::Conflict(conflict)) =
        complete_layer_order(&problem, &CompletionOptions::default())
    else {
        panic!("bad_twist.fold: the completion did not conflict");
    };
    let error = &record["error"];
    assert_eq!(
        Some(conflict.constraint.name()),
        error["constraint_type"].as_str()
    );
    assert_eq!(serde_json::json!(conflict.faces), error["faces"]);
    assert_eq!(
        serde_json::json!(conflict.error_faces),
        error["conflict_faces"]
    );
}

/// r271-s03 has one flat-folded state, and Flat-Folder reports two: the
/// arrangement its ε heuristic picks under its own face numbering loses
/// three taco-taco constraints. The JS oracle reports the same numbers (the
/// parity test above), so this is upstream behaviour the port keeps.
#[test]
fn r271_s03_keeps_flat_folders_second_state() {
    let path = repo_root().join("tests/fixtures/flat-folder/r271-s03.fold");
    let solved = solve_flat_fold(&read_fold(&path), SolveOptions::default())
        .unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    assert_eq!(solved.constraints.variables, 28);
    assert_eq!(solved.constraints.taco_taco, 5);
    assert_eq!(solved.solution_counts, vec![1, 2]);
    assert_eq!(solved.states, "2");
}

fn read_fold(path: &Path) -> FoldDocument {
    let text =
        std::fs::read_to_string(path).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|err| panic!("{}: {err}", path.display()))
}

fn assert_overlap_record(
    overlap: &treemaker_flatfold::OverlapGraph,
    record: &Value,
    fixture: &str,
) {
    let oracle = &record["overlap"];
    assert_eq!(
        overlap.points.len(),
        oracle["points"].as_u64().expect("points") as usize,
        "{fixture}"
    );
    assert_eq!(
        overlap.segments_points.len(),
        oracle["segments"].as_u64().expect("segments") as usize,
        "{fixture}"
    );
    assert_eq!(
        overlap.cells_points.len(),
        oracle["cells"].as_u64().expect("cells") as usize,
        "{fixture}"
    );
    assert_hash(
        &overlap.segments_points,
        oracle,
        "segments_points_hash",
        fixture,
    );
    assert_hash(
        &overlap.segments_edges,
        oracle,
        "segments_edges_hash",
        fixture,
    );
    assert_semantic_cells_match(overlap, oracle, fixture);
}

fn assert_semantic_cells_match(
    overlap: &treemaker_flatfold::OverlapGraph,
    oracle: &Value,
    fixture: &str,
) {
    let oracle_cells = oracle["cells_points"].as_array().expect("cells_points");
    let oracle_cells_faces = oracle["cells_faces"].as_array().expect("cells_faces");
    let oracle_segments_cells = oracle["segments_cells"].as_array().expect("segments_cells");
    let mut oracle_cell_by_polygon = BTreeMap::<String, usize>::new();
    for (index, cell) in oracle_cells.iter().enumerate() {
        let key = serde_json::to_string(cell).expect("cell key");
        assert!(
            oracle_cell_by_polygon.insert(key, index).is_none(),
            "{fixture}: duplicate oracle cell polygon"
        );
    }

    let mut rust_to_oracle = Vec::new();
    for (cell_index, cell) in overlap.cells_points.iter().enumerate() {
        let key = serde_json::to_string(cell).expect("rust cell key");
        let Some(oracle_index) = oracle_cell_by_polygon.get(&key).copied() else {
            panic!("{fixture}: rust cell {cell_index} missing from oracle: {key}");
        };
        rust_to_oracle.push(oracle_index);
        assert_eq!(
            serde_json::to_value(&overlap.cells_faces[cell_index]).expect("rust cell faces"),
            oracle_cells_faces[oracle_index],
            "{fixture}: cell faces for {key}"
        );
    }

    for (segment_index, rust_cells) in overlap.segments_cells.iter().enumerate() {
        let mut mapped_rust = rust_cells
            .iter()
            .map(|cell| rust_to_oracle[*cell])
            .collect::<Vec<_>>();
        mapped_rust.sort_unstable();
        let mut expected = oracle_segments_cells[segment_index]
            .as_array()
            .expect("oracle segment cells")
            .iter()
            .map(|value| value.as_u64().expect("oracle cell") as usize)
            .collect::<Vec<_>>();
        expected.sort_unstable();
        assert_eq!(mapped_rust, expected, "{fixture}: segment {segment_index}");
    }
}

fn assert_constraint_record(
    constraints: &treemaker_flatfold::ConstraintSummary,
    record: &Value,
    fixture: &str,
) {
    let expected = &record["constraints"];
    assert_eq!(
        constraints.variables,
        expected["variables"].as_u64().expect("variables") as usize,
        "{fixture} variables"
    );
    assert_eq!(
        constraints.taco_taco,
        expected["taco_taco"].as_u64().expect("taco_taco") as usize,
        "{fixture} taco_taco"
    );
    assert_eq!(
        constraints.taco_tortilla,
        expected["taco_tortilla"].as_u64().expect("taco_tortilla") as usize,
        "{fixture} taco_tortilla"
    );
    assert_eq!(
        constraints.tortilla_tortilla,
        expected["tortilla_tortilla"]
            .as_u64()
            .expect("tortilla_tortilla") as usize,
        "{fixture} tortilla_tortilla"
    );
    assert_eq!(
        constraints.transitivity,
        expected["transitivity"].as_u64().expect("transitivity") as usize,
        "{fixture} transitivity"
    );
    assert_eq!(
        constraints.reduced_transitivity,
        expected["reduced_transitivity"]
            .as_u64()
            .expect("reduced_transitivity") as usize,
        "{fixture} reduced_transitivity"
    );
}

fn assert_project_record(
    folded_vertices: &[[f64; 2]],
    faces_flip: &[bool],
    record: &Value,
    fixture: &str,
) {
    let project = &record["project"];
    assert_eq!(
        faces_flip.iter().filter(|flip| !**flip).count(),
        project["faces_up"].as_u64().expect("faces_up") as usize,
        "{fixture}"
    );
    assert_eq!(
        faces_flip.iter().filter(|flip| **flip).count(),
        project["faces_down"].as_u64().expect("faces_down") as usize,
        "{fixture}"
    );
    assert_hash(faces_flip, project, "faces_flip_hash", fixture);
    let expected = project["folded_vertices"]
        .as_array()
        .expect("folded_vertices");
    assert_eq!(folded_vertices.len(), expected.len(), "{fixture}");
    for (index, (actual, expected)) in folded_vertices.iter().zip(expected).enumerate() {
        let expected = expected.as_array().expect("folded vertex");
        let expected_x = expected[0].as_f64().expect("folded x");
        let expected_y = expected[1].as_f64().expect("folded y");
        assert!(
            (actual[0] - expected_x).abs() <= 1.0e-9,
            "{fixture} folded vertex {index} x: rust {}, oracle {}",
            actual[0],
            expected_x
        );
        assert!(
            (actual[1] - expected_y).abs() <= 1.0e-9,
            "{fixture} folded vertex {index} y: rust {}, oracle {}",
            actual[1],
            expected_y
        );
    }
}

fn run_flat_folder_oracle(oracle: &Path, root: &Path, command: &str, file: &Path) -> Value {
    let output = Command::new(oracle)
        .current_dir(root)
        .arg(command)
        .arg(file)
        .output()
        .unwrap_or_else(|err| panic!("failed to run {}: {err}", oracle.display()));
    assert!(
        output.status.success(),
        "oracle failed for {}\nstdout:\n{}\nstderr:\n{}",
        file.display(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout).expect("oracle stdout utf8");
    serde_json::from_str(stdout.trim()).unwrap_or_else(|err| panic!("{stdout}: {err}"))
}

fn assert_normalize_record(
    document: &FoldDocument,
    vertex_vertices: &[Vec<usize>],
    record: &Value,
    fixture: &str,
) {
    let normalize = &record["normalize"];
    assert_eq!(
        document.vertices_coords.len(),
        normalize["vertices"].as_u64().expect("vertices") as usize,
        "{fixture}"
    );
    assert_eq!(
        document.edges_vertices.len(),
        normalize["edges"].as_u64().expect("edges") as usize,
        "{fixture}"
    );
    assert_eq!(
        document.faces_vertices.len(),
        normalize["faces"].as_u64().expect("faces") as usize,
        "{fixture}"
    );
    assert_eq!(
        assignment_counts(&document.edges_assignment),
        normalize["assignments"],
        "{fixture}"
    );
    assert_hash(
        &document.edges_vertices,
        normalize,
        "edges_vertices_hash",
        fixture,
    );
    assert_hash(
        &document.edges_faces,
        normalize,
        "edges_faces_hash",
        fixture,
    );
    assert_hash(
        &document.faces_vertices,
        normalize,
        "faces_vertices_hash",
        fixture,
    );
    assert_hash(
        &document.faces_edges,
        normalize,
        "faces_edges_hash",
        fixture,
    );
    assert_hash(vertex_vertices, normalize, "vertex_vertices_hash", fixture);
}

fn assignment_counts(assignments: &[Assignment]) -> Value {
    let mut counts = BTreeMap::<&'static str, usize>::new();
    for assignment in assignments {
        *counts.entry(assignment.as_str()).or_default() += 1;
    }
    serde_json::to_value(counts).expect("assignment counts json")
}

fn assert_hash<T: serde::Serialize + ?Sized>(
    actual: &T,
    normalize: &Value,
    key: &str,
    fixture: &str,
) {
    let actual_hash = sha256_json(actual);
    let expected = normalize[key].as_str().expect(key);
    assert_eq!(actual_hash, expected, "{fixture} {key}");
}

fn sha256_json<T: serde::Serialize + ?Sized>(value: &T) -> String {
    let json = serde_json::to_string(value).expect("hash json");
    format!("{:x}", Sha256::digest(json.as_bytes()))
}
