//! The checker against the Fold spike's corpus (research r3-reuse-solver §2):
//! FOLD crease patterns with their layer orders, every one valid by
//! construction, and a third judge's verdicts on single-pair flips and on the
//! solutions Flat-Folder and Oriedita found.
//!
//! The corpus is not committed. A handful of its states and verdicts are,
//! under `tests/fixtures/`; the whole run needs the spike's solver directory:
//!
//! ```sh
//! ORISTUDIO_FOLD_SPIKE_SOLVER=…/artifacts/fold-spike/reuse/solver \
//!     cargo test -p oristudio-layer-order --release --test corpus -- --nocapture
//! ```

mod support;

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use oristudio_layer_order::{
    CheckReport, ConstraintProblem, EdgeKind, FaceId, FacePair, LayerOrder, Scope, Violation,
    check_problem,
};
use serde_json::Value;
use support::{FoldState, order_from_triples, read_fold};

const CORPUS_ENV: &str = "ORISTUDIO_FOLD_SPIKE_SOLVER";

/// Comma-separated corpus folders under it; `corpus-v2` (the 1,685-state main
/// corpus) by default, `corpus-mu0` and `corpus-big` for the tolerance-stress
/// and large states.
const CORPORA_ENV: &str = "ORISTUDIO_FOLD_SPIKE_CORPORA";

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn load(path: &Path) -> FoldState {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    read_fold(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn report(problem: &ConstraintProblem, state: &FoldState, order: &LayerOrder) -> CheckReport {
    check_problem(problem, &state.view, order, Scope::All).unwrap_or_else(|e| panic!("{e}"))
}

fn triples(value: &Value) -> Vec<[i64; 3]> {
    value
        .as_array()
        .map(|a| {
            a.iter()
                .map(|t| [0, 1, 2].map(|k| t[k].as_i64().unwrap_or(i64::MIN)))
                .collect()
        })
        .unwrap_or_default()
}

/// A state's own order passes; returns a description of the failure if not.
fn own_order_fails(name: &str, state: &FoldState) -> Option<String> {
    let problem = ConstraintProblem::build(&state.view);
    let r = report(&problem, state, &state.order);
    (!r.is_valid()).then(|| format!("{name}: {:?}", r.violations))
}

/// One judged state: the flip and every solver solution, judged by our
/// checker; returns a description of each disagreement with the judge.
///
/// The judge (the spike's `indep.mjs`) requires only a folded crease's two
/// faces to be ordered, not every overlapping pair, so a report of other
/// missing pairs alone counts as its "valid". That matters on r139-s04, where
/// Flat-Folder's two solutions omit four overlapping pairs its arrangement
/// missed (the JS verifier needed five ε retries there), which this checker
/// reports.
fn disagreements(name: &str, state: &FoldState, dump: &Value, verdict: &Value) -> Vec<String> {
    let problem = ConstraintProblem::build(&state.view);
    let creases: BTreeSet<FacePair> = state
        .view
        .edges()
        .iter()
        .filter(|e| matches!(e.kind, EdgeKind::Folded(_)))
        .filter_map(|e| FacePair::new(e.faces[0], e.faces[1]))
        .collect();
    let valid = |t: &[[i64; 3]]| {
        report(&problem, state, &order_from_triples(t, &state.view))
            .violations
            .iter()
            .all(|v| matches!(v, Violation::MissingPair { pair } if !creases.contains(pair)))
    };
    let mut out = Vec::new();
    let neg = triples(&dump["neg"]);
    let judged_valid = verdict["neg"].as_str() == Some("valid");
    if valid(&neg) != judged_valid {
        let r = report(&problem, state, &order_from_triples(&neg, &state.view));
        out.push(format!(
            "{name}: flip judged {}, ours {:?}",
            verdict["neg"], r.violations
        ));
    }
    for solver in ["ff", "or"] {
        let solutions = dump[solver].as_array().cloned().unwrap_or_default();
        let ours = solutions.iter().filter(|s| valid(&triples(s))).count();
        let judged = verdict[solver]["valid"].as_u64().unwrap_or(u64::MAX) as usize;
        if ours != judged {
            out.push(format!(
                "{name}: {solver} solutions valid: judge {judged}, ours {ours} of {}",
                solutions.len()
            ));
        }
    }
    out
}

#[test]
fn committed_fixtures_pass_and_their_judged_flips_agree() {
    let dir = fixtures();
    let judged: Value = serde_json::from_str(
        &fs::read_to_string(dir.join("judged.json")).unwrap_or_else(|e| panic!("judged.json: {e}")),
    )
    .unwrap_or_else(|e| panic!("judged.json: {e}"));
    let mut failures = Vec::new();
    let mut states = 0;
    for entry in fs::read_dir(&dir).unwrap_or_else(|e| panic!("{e}")) {
        let path = entry.unwrap_or_else(|e| panic!("{e}")).path();
        if path.extension().and_then(|x| x.to_str()) != Some("fold") {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("?")
            .to_string();
        let state = load(&path);
        states += 1;
        failures.extend(own_order_fails(&name, &state));
        if let Some(entry) = judged.get(&name) {
            failures.extend(disagreements(
                &name,
                &state,
                &entry["dump"],
                &entry["verdict"],
            ));
        }
    }
    assert!(states >= 10, "only {states} fixtures");
    assert!(failures.is_empty(), "{failures:#?}");
}

#[test]
fn rebuilding_over_any_touched_faces_equals_a_full_build() {
    for entry in fs::read_dir(fixtures()).unwrap_or_else(|e| panic!("{e}")) {
        let path = entry.unwrap_or_else(|e| panic!("{e}")).path();
        if path.extension().and_then(|x| x.to_str()) != Some("fold") {
            continue;
        }
        let state = load(&path);
        let full = ConstraintProblem::build(&state.view);
        let ids: Vec<FaceId> = state.view.faces().iter().map(|f| f.id).collect();
        let mut subsets: Vec<BTreeSet<FaceId>> = ids.iter().map(|&f| BTreeSet::from([f])).collect();
        subsets.push(ids.iter().copied().step_by(2).collect());
        subsets.push(ids.iter().copied().collect());
        for touched in subsets {
            assert!(
                full.rebuild(&state.view, &touched) == full,
                "{}: touched {touched:?}",
                path.display()
            );
        }
    }
}

/// A check scoped to some faces reports exactly the full check's violations
/// that name one of them, on the committed states' judged flips (orders that
/// break pairs, constraints and cells).
#[test]
fn a_scoped_check_is_the_full_check_restricted_to_its_faces() {
    let dir = fixtures();
    let judged: Value = serde_json::from_str(
        &fs::read_to_string(dir.join("judged.json")).unwrap_or_else(|e| panic!("judged.json: {e}")),
    )
    .unwrap_or_else(|e| panic!("judged.json: {e}"));
    let mut flips = 0;
    for (name, entry) in judged.as_object().into_iter().flatten() {
        let state = load(&dir.join(name));
        let problem = ConstraintProblem::build(&state.view);
        let order = order_from_triples(&triples(&entry["dump"]["neg"]), &state.view);
        let full = report(&problem, &state, &order);
        flips += usize::from(!full.is_valid());
        let ids: Vec<FaceId> = state.view.faces().iter().map(|f| f.id).collect();
        let mut scopes: Vec<BTreeSet<FaceId>> = full
            .violations
            .iter()
            .map(|v| v.faces().into_iter().take(1).collect())
            .collect();
        scopes.push(ids.iter().copied().step_by(3).collect());
        scopes.push(BTreeSet::new());
        for scope in scopes {
            let scoped = check_problem(&problem, &state.view, &order, Scope::Faces(&scope))
                .unwrap_or_else(|e| panic!("{e}"));
            let want: Vec<Violation> = full
                .violations
                .iter()
                .filter(|v| v.faces().iter().any(|f| scope.contains(f)))
                .copied()
                .collect();
            assert_eq!(scoped.violations, want, "{name}: scope {scope:?}");
        }
    }
    assert!(flips > 0, "no judged flip breaks its state");
}

#[test]
fn spike_corpus_passes_and_agrees_with_the_judge() {
    let Some(root) = std::env::var_os(CORPUS_ENV).map(PathBuf::from) else {
        eprintln!("skipped: set {CORPUS_ENV} to artifacts/fold-spike/reuse/solver");
        return;
    };
    let corpora = std::env::var(CORPORA_ENV).unwrap_or_else(|_| "corpus-v2".to_string());
    let started = std::time::Instant::now();
    let mut failures = Vec::new();
    let mut states = 0;
    for (corpus, source) in corpora
        .split(',')
        .flat_map(|c| ["random", "compound", "beloch"].map(|s| (c.trim(), s)))
    {
        let dir = root.join(corpus).join(source);
        let mut paths: Vec<PathBuf> = fs::read_dir(&dir)
            .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("fold"))
            .collect();
        paths.sort();
        for path in paths {
            let file = path.file_name().and_then(|n| n.to_str()).unwrap_or("?");
            let name = format!("{corpus}/{source}/{file}");
            match fs::read_to_string(&path)
                .map_err(|e| e.to_string())
                .and_then(|t| read_fold(&t))
            {
                Ok(state) => failures.extend(own_order_fails(&name, &state)),
                Err(e) => failures.push(format!("{name}: {e}")),
            }
            states += 1;
        }
    }
    eprintln!(
        "corpus: {states} states, {} failing, {:.1?}",
        failures.len(),
        started.elapsed()
    );
    let started = std::time::Instant::now();

    let verdicts: Value = serde_json::from_str(
        &fs::read_to_string(root.join("judge-results.json")).unwrap_or_else(|e| panic!("{e}")),
    )
    .unwrap_or_else(|e| panic!("{e}"));
    let mut judged = 0;
    let mut judged_failures = Vec::new();
    for verdict in verdicts.as_array().cloned().unwrap_or_default() {
        let Some(name) = verdict["name"].as_str() else {
            continue;
        };
        let dump_path = root.join("dump").join(format!("{name}.json"));
        let Ok(text) = fs::read_to_string(&dump_path) else {
            continue;
        };
        let dump: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{e}"));
        let state = load(&root.join("corpus-v2/random").join(name));
        judged_failures.extend(disagreements(name, &state, &dump, &verdict));
        judged += 1;
    }
    eprintln!(
        "judge: {judged} states, {} disagreements, {:.1?}",
        judged_failures.len(),
        started.elapsed()
    );
    failures.extend(judged_failures);
    assert!(
        states > 0 && judged >= 266,
        "{states} states, {judged} judged"
    );
    assert!(failures.is_empty(), "{failures:#?}");
}
