//! The Flat-Folder oracle's `verify` command, and the two Fold states it
//! shows Flat-Folder getting wrong.
//!
//! `verify <fold> <order.json>` keeps the FOLD's own face numbering, checks the
//! arrangement Flat-Folder builds, rebuilds it at halved ε when it is wrong,
//! and then seeds a complete order into Flat-Folder's constraints on it. The
//! tests that run it need Node and are gated on `FLATFOLDER_ORACLE`; the
//! Rust-only pins always run.
//!
//! Both fixtures are Fold spike states, valid by construction, reduced to
//! their crease pattern. Flat-Folder renumbers faces by area, and under that
//! numbering its ε heuristic picks an arrangement that is wrong in a way the
//! cell areas do not show:
//!
//! - r271-s03: the overlap of four creases is handed to one of them, so three
//!   taco-taco constraints are never generated and an invalid second state is
//!   reported.
//! - r069-s07: overlapping segments double a cell boundary, so constraints are
//!   generated that one valid state (found by Oriedita, in
//!   `r069-s07.missed-order.json`) cannot meet.

use std::collections::BTreeMap;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{Value, json};
use treemaker_flatfold::{
    Analysis, AnalyzeOptions, Completion, CompletionOptions, CompletionProblem, ConstraintKind,
    FixedAssignment, FixedKind, PairOrder, SolutionLimit, SolveOptions, analyze_flat_fold,
    complete_layer_order, flat_folder_completion_problem, solve_flat_fold,
};
use treemaker_fold::FoldDocument;

mod support;
use support::repo_root;

const R271: &str = "tests/fixtures/flat-folder/r271-s03.fold";
const R069: &str = "tests/fixtures/flat-folder/r069-s07.fold";
const R069_MISSED: &str = "tests/fixtures/flat-folder/r069-s07.missed-order.json";

/// A fixture with Flat-Folder's own problem for it, and the face renumbering
/// between the file and Flat-Folder's normalized document.
struct Own {
    analysis: Analysis,
    problem: CompletionProblem,
    /// Flat-Folder face to file face.
    file_face: Vec<usize>,
    /// File face to Flat-Folder face.
    own_face: Vec<usize>,
}

fn own(relative: &str) -> Own {
    let document = read_fold(&repo_root().join(relative));
    let analysis = analyze_flat_fold(&document, AnalyzeOptions::default())
        .unwrap_or_else(|err| panic!("{relative}: {err}"));
    let problem =
        flat_folder_completion_problem(&analysis).unwrap_or_else(|err| panic!("{relative}: {err}"));
    // Normalization re-sorts the file's rings; it keeps the vertices.
    let ring = |face: &[usize]| {
        let mut ring = face.to_vec();
        ring.sort_unstable();
        ring
    };
    let by_ring = document
        .faces_vertices
        .iter()
        .enumerate()
        .map(|(face, vertices)| (ring(vertices), face))
        .collect::<BTreeMap<_, _>>();
    let file_face = analysis
        .normalized
        .document
        .faces_vertices
        .iter()
        .map(|vertices| by_ring[&ring(vertices)])
        .collect::<Vec<_>>();
    let mut own_face = vec![0; file_face.len()];
    for (own, file) in file_face.iter().enumerate() {
        own_face[*file] = own;
    }
    Own {
        analysis,
        problem,
        file_face,
        own_face,
    }
}

impl Own {
    /// Every state Flat-Folder's pipeline reports, as FOLD face orders in
    /// Flat-Folder's numbering.
    fn states(&self) -> Vec<Vec<[i64; 3]>> {
        let options = CompletionOptions {
            solution_limit: SolutionLimit::All,
            ..CompletionOptions::default()
        };
        let Ok(Completion::Solved(solved)) = complete_layer_order(&self.problem, &options) else {
            panic!("Flat-Folder's own problem did not solve");
        };
        let counts = solved
            .components
            .iter()
            .map(|component| component.solutions.len())
            .collect::<Vec<_>>();
        let mut choice = vec![0; counts.len()];
        let mut states = Vec::new();
        loop {
            let orders = solved.assignment(&choice).expect("a complete order");
            states.push(self.face_orders(&orders));
            let Some(digit) = (0..choice.len()).find(|digit| choice[*digit] + 1 < counts[*digit])
            else {
                return states;
            };
            choice[digit] += 1;
            choice[..digit].fill(0);
        }
    }

    fn face_orders(&self, orders: &[PairOrder]) -> Vec<[i64; 3]> {
        let flip = &self.analysis.faces_flip;
        self.problem
            .variables
            .iter()
            .zip(orders)
            .map(|([f, g], order)| {
                let (above, below) = match order {
                    PairOrder::FirstAbove => (*f, *g),
                    PairOrder::SecondAbove => (*g, *f),
                };
                [above as i64, below as i64, if flip[below] { 1 } else { -1 }]
            })
            .collect()
    }

    /// FOLD face orders renumbered; their signs read each face's own normal,
    /// so only the indices change.
    fn renumber(orders: &[[i64; 3]], faces: &[usize]) -> Vec<[i64; 3]> {
        orders
            .iter()
            .map(|[f, g, s]| [faces[*f as usize] as i64, faces[*g as usize] as i64, *s])
            .collect()
    }

    /// A complete order in the file's numbering, as seeds for Flat-Folder's
    /// own problem.
    fn seeds(&self, file_orders: &[[i64; 3]]) -> Vec<FixedAssignment> {
        let flip = &self.analysis.faces_flip;
        Self::renumber(file_orders, &self.own_face)
            .into_iter()
            .map(|[f, g, s]| {
                let (f, g) = (f as usize, g as usize);
                // The inverse of `[f, g, flip[g] ? 1 : -1]` for f above g.
                let f_above = s == if flip[g] { 1 } else { -1 };
                let variable = self
                    .problem
                    .variables
                    .iter()
                    .position(|pair| *pair == [f.min(g), f.max(g)])
                    .unwrap_or_else(|| panic!("faces {f} and {g} are not a variable"));
                FixedAssignment {
                    variable,
                    order: if (f < g) == f_above {
                        PairOrder::FirstAbove
                    } else {
                        PairOrder::SecondAbove
                    },
                    kind: FixedKind::Seed,
                }
            })
            .collect()
    }

    /// The normalized crease pattern, so `verify` sees Flat-Folder's own
    /// numbering and folded frame.
    fn normalized_fold(&self) -> Value {
        let document = &self.analysis.normalized.document;
        json!({
            "vertices_coords": document.vertices_coords,
            "edges_vertices": document.edges_vertices,
            "edges_assignment": document
                .edges_assignment
                .iter()
                .map(|assignment| assignment.as_str())
                .collect::<Vec<_>>(),
            "faces_vertices": document.faces_vertices,
        })
    }
}

#[test]
fn r069_s07_flat_folders_own_constraints_reject_an_order_it_misses() {
    let fixture = own(R069);
    let solved = solve_flat_fold(
        &read_fold(&repo_root().join(R069)),
        SolveOptions {
            solution_limit: SolutionLimit::All,
            ..SolveOptions::default()
        },
    )
    .expect("r069-s07 solves");
    assert_eq!(solved.solution_counts, vec![1, 4]);

    let missed = read_order(R069_MISSED);
    let missed_own = Own::renumber(&missed, &fixture.own_face);
    let canonical = |orders: &[[i64; 3]]| {
        let mut orders = orders.to_vec();
        orders.sort_unstable();
        orders
    };
    assert!(
        fixture
            .states()
            .iter()
            .all(|state| canonical(state) != canonical(&missed_own)),
        "the missed order is among Flat-Folder's states"
    );

    // Seeded alone into Flat-Folder's own constraints, the order conflicts:
    // constraint generation rejects it, not the search.
    let mut seeded = fixture.problem.clone();
    seeded.fixed = fixture.seeds(&missed);
    let Ok(Completion::Conflict(conflict)) =
        complete_layer_order(&seeded, &CompletionOptions::default())
    else {
        panic!("seeding the missed order did not conflict");
    };
    let file = |faces: &[usize]| {
        faces
            .iter()
            .map(|face| fixture.file_face[*face])
            .collect::<Vec<_>>()
    };
    assert_eq!(conflict.constraint, ConstraintKind::TacoTortilla);
    // A taco of file faces 5 and 3 around tortilla face 0. It was the mirror
    // image, faces 9 and 11, while serde_json read two of the file's
    // coordinates one ulp off: Flat-Folder numbers faces by area, and that
    // swapped mirror twins 3 and 9. With `float_roundtrip` the numbering is
    // the JS oracle's (`flat_folder_oracle` checks r069-s07).
    assert_eq!(file(&conflict.faces), vec![5, 3, 0]);
}

#[test]
fn verify_tells_flat_folders_two_r271_states_apart_when_enabled() {
    let Some(oracle) = oracle() else {
        return;
    };
    let fixture = own(R271);
    let states = fixture.states();
    assert_eq!(states.len(), 2);
    let verdicts = states
        .iter()
        .enumerate()
        .map(|(index, state)| {
            let order = write_json(
                &format!("r271-state-{index}.json"),
                &json!(Own::renumber(state, &fixture.file_face)),
            );
            let record = verify(&oracle, &repo_root().join(R271), &order);
            assert_eq!(record["arrangement"]["retries"], 0, "{record}");
            record["verify"].clone()
        })
        .collect::<Vec<_>>();
    let valid = verdicts
        .iter()
        .position(|verdict| verdict["verdict"] == "valid")
        .unwrap_or_else(|| panic!("neither state is valid: {verdicts:?}"));
    let invalid = &verdicts[1 - valid];
    assert_eq!(invalid["verdict"], "conflict", "{invalid}");
    assert_eq!(
        invalid["conflict"]["constraint_type"], "taco-taco",
        "{invalid}"
    );

    // Negative control: the valid state is the only one its letters allow,
    // so flipping any one pair of it must be refused.
    let valid_state = Own::renumber(&states[valid], &fixture.file_face);
    for pair in 0..valid_state.len() {
        let mut flipped = valid_state.clone();
        flipped[pair][2] = -flipped[pair][2];
        let order = write_json(&format!("r271-flipped-{pair}.json"), &json!(flipped));
        let record = verify(&oracle, &repo_root().join(R271), &order);
        assert_ne!(record["verify"]["verdict"], "valid", "{record}");
    }
}

#[test]
fn verify_rebuilds_flat_folders_own_r271_arrangement_when_enabled() {
    let Some(oracle) = oracle() else {
        return;
    };
    let fixture = own(R271);
    let fold = write_json("r271-own.fold", &fixture.normalized_fold());
    let mut verdicts = Vec::new();
    for (index, state) in fixture.states().iter().enumerate() {
        let order = write_json(&format!("r271-own-state-{index}.json"), &json!(state));
        let record = verify(&oracle, &fold, &order);
        let arrangement = &record["arrangement"];
        assert_eq!(arrangement["retries"], 1, "{record}");
        let rejected = arrangement["rejected"][0].as_str().unwrap_or_default();
        assert!(
            rejected.contains("is not covered by its segments"),
            "{record}"
        );
        verdicts.push(record["verify"]["verdict"].clone());
    }
    // Rebuilt, the same constraints keep one of the two.
    verdicts.sort_by_key(Value::to_string);
    assert_eq!(verdicts, vec![json!("conflict"), json!("valid")]);
}

#[test]
fn verify_accepts_the_r069_order_flat_folder_misses_when_enabled() {
    let Some(oracle) = oracle() else {
        return;
    };
    let root = repo_root();
    let record = verify(&oracle, &root.join(R069), &root.join(R069_MISSED));
    assert_eq!(record["arrangement"]["retries"], 0, "{record}");
    assert_eq!(record["verify"]["verdict"], "valid", "{record}");

    // In Flat-Folder's own numbering the heuristic arrangement is rejected,
    // and on the rebuilt one the order is valid.
    let fixture = own(R069);
    let fold = write_json("r069-own.fold", &fixture.normalized_fold());
    let missed = Own::renumber(&read_order(R069_MISSED), &fixture.own_face);
    let order = write_json("r069-own-missed.json", &json!(missed));
    let record = verify(&oracle, &fold, &order);
    let rejected = record["arrangement"]["rejected"][0]
        .as_str()
        .unwrap_or_default();
    assert!(rejected.contains("doubles back"), "{record}");
    assert_eq!(record["verify"]["verdict"], "valid", "{record}");
    assert_eq!(record["verify"]["letter_disagreements"], 0, "{record}");
}

fn oracle() -> Option<PathBuf> {
    let Some(oracle) = env::var_os("FLATFOLDER_ORACLE").map(PathBuf::from) else {
        eprintln!("skipping Flat-Folder verify; set FLATFOLDER_ORACLE to enable");
        return None;
    };
    Some(if oracle.is_relative() {
        repo_root().join(oracle)
    } else {
        oracle
    })
}

fn verify(oracle: &Path, fold: &Path, order: &Path) -> Value {
    let output = Command::new(oracle)
        .current_dir(repo_root())
        .arg("verify")
        .arg(fold)
        .arg(order)
        .output()
        .unwrap_or_else(|err| panic!("failed to run {}: {err}", oracle.display()));
    assert!(
        output.status.success(),
        "verify failed for {}\nstderr:\n{}",
        fold.display(),
        String::from_utf8_lossy(&output.stderr)
    );
    let record: Value = serde_json::from_slice(&output.stdout).expect("verify json");
    assert_eq!(record["status"], "ok", "{record}");
    record
}

fn write_json(name: &str, value: &Value) -> PathBuf {
    let path = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    std::fs::write(&path, value.to_string())
        .unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    path
}

fn read_fold(path: &Path) -> FoldDocument {
    let text =
        std::fs::read_to_string(path).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|err| panic!("{}: {err}", path.display()))
}

fn read_order(relative: &str) -> Vec<[i64; 3]> {
    let path = repo_root().join(relative);
    let text =
        std::fs::read_to_string(&path).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|err| panic!("{}: {err}", path.display()))
}
