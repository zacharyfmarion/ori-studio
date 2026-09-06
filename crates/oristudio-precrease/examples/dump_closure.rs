//! Dump the closure of a crease pattern as JSON, for the Node cross-check in
//! `tools/precrease-rf-crosscheck/` and for debugging.
//!
//! ```sh
//! cargo run -p oristudio-precrease --example dump_closure -- <file.fold|.cp|.osf> \
//!     [--component N] [--document N] [--plan]
//! ```
//!
//! Without `--plan` only the closure from the bare sheet runs (no auxiliary
//! folds), which is what the cross-check needs: every folded line with its
//! round and every certified witness, plus the point and line tables the
//! witnesses' references point into.

use std::path::PathBuf;

use oristudio_precrease::clock::frozen_clock;
use oristudio_precrease::fixture_io::load_path;
use oristudio_precrease::planner::{Planner, PlannerOptions};
use oristudio_precrease::sheet::Sheet;
use oristudio_precrease::{Line, analyze};
use serde_json::{Value, json};

fn line_json(l: &Line) -> Value {
    json!([l.n[0], l.n[1], l.d])
}

fn segment_json(sheet: &Sheet, l: &Line) -> Value {
    match sheet.clip(l) {
        Some((a, b)) => json!([a, b]),
        None => Value::Null,
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut file: Option<PathBuf> = None;
    let mut component: Option<usize> = None;
    let mut document: Option<usize> = None;
    let mut plan = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--component" => {
                component = args.get(i + 1).and_then(|v| v.parse().ok());
                i += 1;
            }
            "--document" => {
                document = args.get(i + 1).and_then(|v| v.parse().ok());
                i += 1;
            }
            "--plan" => plan = true,
            other => file = Some(PathBuf::from(other)),
        }
        i += 1;
    }
    let Some(file) = file else {
        eprintln!("usage: dump_closure <file> [--component N] [--document N] [--plan]");
        std::process::exit(2);
    };
    let cp = match load_path(&file, document) {
        Ok(cp) => cp,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    let paper = [-200.0, -200.0, 200.0, 200.0];
    let analysis = match analyze(&cp.segments, &cp.colors, Some(paper)) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    let opts = PlannerOptions {
        clock: frozen_clock(),
        stuck_budget_ms: 0.0,
        total_budget_ms: 0.0,
        ..PlannerOptions::default()
    };
    let mut components = Vec::new();
    for c in &analysis.components {
        if component.is_some_and(|want| want != c.id as usize) {
            continue;
        }
        let mut planner = Planner::new(c, opts);
        if planner.closure_ref().is_none() {
            components.push(json!({ "id": c.id, "refused": c.refused }));
            continue;
        }
        if plan {
            planner.plan().expect("plan");
        } else {
            planner.close(0.0).expect("close");
        }
        let closure = planner.closure_ref().expect("closure");
        let sheet = *closure.state().sheet();
        let state = closure.state();
        let targets: Vec<Value> = closure
            .targets()
            .iter()
            .map(|t| {
                json!({
                    "line": line_json(&t.line),
                    "segment": segment_json(&sheet, &t.line),
                    "cp_line_ids": t.cp_line_ids,
                })
            })
            .collect();
        let folded: Vec<Value> = closure
            .folded()
            .iter()
            .map(|f| {
                json!({
                    "line": line_json(&f.line),
                    "line_id": f.line_id,
                    "segment": segment_json(&sheet, &f.line),
                    "round": f.round,
                    "tag": f.tag,
                    "target": f.target,
                    "witnesses": f.witnesses,
                    "chosen": f.chosen,
                    "witnesses_complete": f.witnesses_complete,
                })
            })
            .collect();
        let points: Vec<Value> = state
            .points()
            .iter()
            .enumerate()
            .map(|(id, p)| json!({ "id": id, "p": p.p, "lines": p.lines, "on_boundary": p.on_boundary }))
            .collect();
        let lines: Vec<Value> = state
            .lines()
            .iter()
            .enumerate()
            .map(|(id, l)| json!({ "id": id, "line": line_json(&l.line), "tag": l.tag }))
            .collect();
        components.push(json!({
            "id": c.id,
            "sheet": { "width": sheet.width, "height": sheet.height },
            "exactness": c.exactness.as_ref().map(|e| e.class),
            "status": planner.status(),
            "targets": targets,
            "free": closure.free_targets(),
            "remaining": closure.remaining(),
            "folded": folded,
            "points": points,
            "lines": lines,
        }));
    }
    let out = json!({
        "file": file.display().to_string(),
        "segment_count": analysis.segment_count,
        "components": components,
    });
    println!("{}", serde_json::to_string(&out).expect("json"));
}
