//! Randomized differential check of the completion session
//! (`implementation-plans/fold-solver-performance.md`).
//!
//! ```sh
//! solver_session_check <questions_dir> <out_dir> <file>...
//! ```
//!
//! For each case it reads `<questions_dir>/<case>.questions.json`, written by
//! `solver_differential questions` from the solver as it was, where every
//! question was answered by completing from scratch with its pairs added.
//! It opens one session over the imported letters and answers every question
//! three times: cold, preferring the open's first order, and preferring the
//! order the previous question's fit left (as the dialog's preview does,
//! questions in file order). Every order's `changed` counts the pairs it
//! moves from the order on screen before the question. It checks:
//!
//! - the session's open: its forced pairs and first order are those of
//!   `complete` with one order per component;
//! - a verdict agrees with the old answer whenever that one decided; an
//!   undecided session answer where the old one decided is a failure;
//! - every order it returns passes `oristudio_layer_order::check_problem`
//!   and has every asked pair the asked way;
//! - every "no" names the faces it traces back to;
//! - the three agree whenever they decide.
//!
//! Writes `<out_dir>/<case>.session.json`. Environment: `OPEN_NODES`
//! (200000), `CHECK_NODES` (as the questions file says), `FAST_NODES` (128).

#[path = "solver_differential.rs"]
#[allow(dead_code)]
mod differential;

use std::path::{Path, PathBuf};
use std::time::Instant;

use oristudio_fold::complete::{Check, CheckLimits, CompletionLimits, FixedKind, FixedPair};
use oristudio_fold::{FaceId, ImportRefusal};
use oristudio_layer_order::{LayerOrder, Scope, check_problem};
use serde_json::{Value, json};

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1e3
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let usage = "usage: solver_session_check <questions_dir> <out_dir> <file>...";
    let questions = PathBuf::from(args.get(1).unwrap_or_else(|| panic!("{usage}")));
    let out = PathBuf::from(args.get(2).unwrap_or_else(|| panic!("{usage}")));
    std::fs::create_dir_all(&out).unwrap_or_else(|e| panic!("{}: {e}", out.display()));
    for file in &args[3..] {
        check_case(&questions, &out, Path::new(file));
    }
}

/// Feasible, infeasible or undecided, as `complete_with` says.
fn session_verdict(answer: &Result<Check, oristudio_fold::CompletionRefusal>) -> &'static str {
    use oristudio_fold::CompletionRefusal as R;
    match answer {
        Ok(Check::Fits { .. }) => "feasible",
        Ok(Check::Forced { .. }) => "forced",
        Ok(Check::Conflict { .. }) => "conflict",
        Ok(Check::NoOrder { .. }) => "no_order",
        Ok(Check::Undecided { .. }) => "undecided",
        Err(R::FixedContradictory { .. }) => "fixed_contradictory",
        Err(_) => "error",
    }
}

fn decided(verdict: &str) -> Option<bool> {
    match verdict {
        "feasible" => Some(true),
        "forced" | "conflict" | "no_order" | "fixed_contradictory" => Some(false),
        _ => None,
    }
}

fn differing_pairs(a: &LayerOrder, b: &LayerOrder) -> usize {
    a.pairs()
        .filter(|(pair, lo_above)| b.above(pair.lo(), pair.hi()) != *lo_above)
        .count()
}

fn check_case(questions_dir: &Path, out: &Path, path: &Path) {
    let name = differential::case_name(path);
    let target = out.join(format!("{name}.session.json"));
    if target.exists() {
        return;
    }
    let question_file = questions_dir.join(format!("{name}.questions.json"));
    let Ok(text) = std::fs::read_to_string(&question_file) else {
        eprintln!("{name}: no questions file");
        return;
    };
    let recorded: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let asked = recorded["questions"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let check_nodes = recorded["check_nodes"].as_u64().unwrap_or(200_000);
    let open_nodes = env_u64("OPEN_NODES", 200_000);
    let fast_nodes = env_u64("FAST_NODES", 128);
    let mut failures: Vec<String> = Vec::new();
    let imported = match differential::import(path) {
        Ok(imported) => imported,
        Err(code) => {
            let result = json!({ "case": name, "import": code, "failures": [] });
            std::fs::write(&target, result.to_string()).unwrap_or_default();
            return;
        }
    };
    let unordered = imported.unordered();
    let (view, problem) = (unordered.view(), unordered.problem());
    let open_limits = CompletionLimits {
        per_component: 1,
        max_nodes: Some(open_nodes),
        deadline: None,
    };
    let t = Instant::now();
    let session = imported.session(&open_limits);
    let open_ms = ms(t);
    let complete = imported.complete(&open_limits);
    let session = match (session, complete) {
        (Ok(session), Ok(complete)) => {
            let mut forced = complete.forced_pairs();
            forced.sort_unstable();
            let mut session_forced = session.forced_pairs();
            session_forced.sort_unstable();
            if forced != session_forced {
                failures.push("open: forced pairs differ from complete".to_string());
            }
            let first = complete.order(&vec![0; complete.components().len()]);
            if first.as_ref() != Some(&session.first_order()) {
                failures.push("open: first order differs from complete".to_string());
            }
            match check_problem(problem, view, &session.first_order(), Scope::All) {
                Ok(report) if report.is_valid() => {}
                _ => failures.push("open: first order fails check_problem".to_string()),
            }
            session
        }
        (Err(a), Err(b)) => {
            if a.code() != b.code() {
                failures.push(format!("open: session {} complete {}", a.code(), b.code()));
            }
            let result = json!({
                "case": name, "import": "ok", "open": a.code(), "failures": failures,
            });
            std::fs::write(&target, result.to_string()).unwrap_or_default();
            return;
        }
        (a, b) => {
            failures.push(format!(
                "open: session {:?} complete {:?}",
                a.as_ref().err().map(ImportRefusal::code),
                b.as_ref().err().map(ImportRefusal::code)
            ));
            let result = json!({ "case": name, "import": "ok", "failures": failures });
            std::fs::write(&target, result.to_string()).unwrap_or_default();
            return;
        }
    };
    let first = session.first_order();
    let limits = CheckLimits {
        max_nodes: Some(check_nodes),
        fast_nodes,
        deadline: None,
    };
    let mut answers = Vec::with_capacity(asked.len());
    // The dialog's preview: what the last fit left on screen.
    let mut shown = first.clone();
    for question in &asked {
        let id = question["id"].as_u64().unwrap_or(0);
        let pairs: Vec<FixedPair> = question["pairs"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|p| {
                Some(FixedPair {
                    upper: FaceId(u32::try_from(p.get(0)?.as_u64()?).ok()?),
                    lower: FaceId(u32::try_from(p.get(1)?.as_u64()?).ok()?),
                    kind: FixedKind::Seed,
                })
            })
            .collect();
        let old = question["verdict"].as_str().unwrap_or("other");
        let old_decided = decided(old);
        let mut modes = Vec::new();
        let mut verdicts = Vec::new();
        let before = shown.clone();
        for (mode, prefer) in [
            ("cold", None),
            ("warm", Some(&first)),
            ("chain", Some(&before)),
        ] {
            let t = Instant::now();
            let answer = session.check(&pairs, prefer, &limits);
            let elapsed = ms(t);
            let verdict = session_verdict(&answer);
            let mut record = json!({ "mode": mode, "verdict": verdict, "ms": elapsed });
            match &answer {
                Ok(Check::Fits {
                    order,
                    nodes,
                    stage,
                    ..
                }) => {
                    record["nodes"] = json!(nodes);
                    record["stage"] = json!(stage);
                    // Against the order on screen before this check.
                    record["changed"] = json!(differing_pairs(order, &before));
                    if mode == "chain" {
                        shown = order.clone();
                    }
                    let valid = matches!(
                        check_problem(problem, view, order, Scope::All),
                        Ok(report) if report.is_valid()
                    );
                    record["valid"] = json!(valid);
                    if !valid {
                        failures.push(format!("q{id} {mode}: order fails check_problem"));
                    }
                    if order.len() != problem.variables().len() {
                        failures.push(format!("q{id} {mode}: order is not complete"));
                    }
                    for p in &pairs {
                        if order.above(p.upper, p.lower) != Some(true) {
                            failures
                                .push(format!("q{id} {mode}: {} not above {}", p.upper, p.lower));
                        }
                    }
                }
                Ok(Check::Forced { traced, .. }) => {
                    record["traced"] = json!(traced.len());
                    if traced.is_empty() {
                        failures.push(format!("q{id} {mode}: forced with no trace"));
                    }
                }
                Ok(Check::Conflict { traced, .. }) => {
                    record["traced"] = json!(traced.len());
                    if traced.is_empty() {
                        failures.push(format!("q{id} {mode}: conflict with no trace"));
                    }
                }
                Ok(Check::NoOrder {
                    faces,
                    traced,
                    nodes,
                }) => {
                    record["nodes"] = json!(nodes);
                    record["traced"] = json!(traced.len());
                    if faces.is_empty() || traced.is_empty() {
                        failures.push(format!("q{id} {mode}: no order with no trace"));
                    }
                }
                Ok(Check::Undecided { nodes, .. }) => record["nodes"] = json!(nodes),
                Err(refusal) => record["refusal"] = json!(refusal.code()),
            }
            if verdict == "error" {
                failures.push(format!("q{id} {mode}: error {:?}", answer.err()));
            }
            let session_decided = decided(verdict);
            match (old_decided, session_decided) {
                (Some(a), Some(b)) if a != b => failures.push(format!(
                    "q{id} {mode}: session {verdict}, from scratch {old}"
                )),
                (Some(_), None) => failures.push(format!(
                    "q{id} {mode}: session undecided where from scratch decided {old}"
                )),
                _ => {}
            }
            verdicts.push(session_decided);
            modes.push(record);
        }
        let decided: Vec<bool> = verdicts.iter().flatten().copied().collect();
        if decided.windows(2).any(|w| w[0] != w[1]) {
            failures.push(format!("q{id}: cold, warm and chained disagree"));
        }
        answers.push(json!({
            "id": id,
            "kind": question["kind"],
            "pairs": pairs.len(),
            "old": old,
            "old_ms": question["ms"],
            "old_nodes": question["nodes"],
            "session": modes,
        }));
    }
    let result = json!({
        "case": name,
        "import": "ok",
        "open": "ok",
        "open_ms": open_ms,
        "open_nodes": session.nodes(),
        "check_nodes": check_nodes,
        "fast_nodes": fast_nodes,
        "questions": answers,
        "failures": failures,
    });
    std::fs::write(
        &target,
        serde_json::to_string_pretty(&result).unwrap_or_default(),
    )
    .unwrap_or_else(|e| panic!("{}: {e}", target.display()));
    eprintln!(
        "{name}: {} questions, {} failures, open {open_ms:.0} ms",
        asked.len(),
        failures.len()
    );
}
