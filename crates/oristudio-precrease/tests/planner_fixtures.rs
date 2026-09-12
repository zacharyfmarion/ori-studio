//! The fixture manifest: every fixture's auxiliary count as the crate derives
//! it, recorded beside the prototype's upper bound and the panel's best-found
//! value in `tests/fixtures/precrease/manifest.json`.

mod common;

use common::*;
use oristudio_precrease::sequence::{Status, StepKind, Totals};
use oristudio_precrease::{Line, Sheet};
use serde_json::Value;

fn manifest() -> Vec<Value> {
    let path = fixture_dir().join("manifest.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let value: Value = serde_json::from_str(&text).expect("manifest json");
    value["fixtures"]
        .as_array()
        .expect("fixtures array")
        .clone()
}

#[test]
fn every_manifest_fixture_plans_to_its_recorded_auxiliary_count() {
    let entries = manifest();
    assert!(!entries.is_empty());
    let mut failures = Vec::new();
    for entry in &entries {
        let file = entry["file"].as_str().expect("file");
        let component = entry["component"].as_u64().unwrap_or(0) as u32;
        let cp = load(file);
        let analysis = analyze_cp(&cp);
        let comp = analysis
            .components
            .iter()
            .find(|c| c.id == component)
            .unwrap_or_else(|| panic!("{file}: no component {component}"));
        let (mut planner, seq) = plan_component(comp, unbounded_options());
        let aux = seq.steps.iter().filter(|s| s.kind == StepKind::Aux).count() as u64;
        let expected_status = match entry["status"].as_str().unwrap_or("complete") {
            "complete" => Status::Complete,
            "partial_unsolved" => Status::PartialUnsolved,
            "partial_off_lattice" => Status::PartialOffLattice,
            other => panic!("{file}: unknown status {other}"),
        };
        let expected_aux = entry["crate"].as_u64();
        let lines = entry["lines"].as_u64();
        println!(
            "{file}: status {:?} lines {} free {} aux {aux} visible {} stuck {} cert {} elapsed {:.1} ms",
            seq.status,
            seq.totals.lower_bound + seq.totals.free_lines,
            seq.totals.free_lines,
            seq.totals.visible_aux,
            seq.diagnostics.stuck_events,
            seq.certification,
            seq.diagnostics.elapsed_ms
        );
        if seq.status != expected_status {
            failures.push(format!(
                "{file}: status {:?}, manifest says {:?}",
                seq.status, expected_status
            ));
        }
        match expected_aux {
            Some(e) if e != aux => failures.push(format!(
                "{file}: crate derived {aux} auxiliary folds, manifest records {e}"
            )),
            None => failures.push(format!(
                "{file}: manifest has no `crate` value; derived {aux} (record it)"
            )),
            _ => {}
        }
        if let Some(l) = lines {
            let total = seq.totals.lower_bound + seq.totals.free_lines;
            if total != l as u32 {
                failures.push(format!(
                    "{file}: {total} distinct lines, manifest records {l}"
                ));
            }
        }
        // Structural invariants of every plan. A fold is a crease made: the
        // pattern's lines, the auxiliary folds, and the grid's own lines.
        let grid_aux = seq.totals.grid_lines - seq.totals.grid_cp_lines;
        assert_eq!(
            seq.totals.folds,
            seq.totals.cp_lines + seq.totals.aux + grid_aux,
            "{file}"
        );
        assert_eq!(u64::from(seq.totals.aux), aux, "{file}");
        assert_eq!(
            seq.totals.cp_lines + seq.totals.unsolved,
            seq.totals.lower_bound,
            "{file}"
        );
        // The manifest says whether the design is pleated on a grid.
        let grid_steps = seq
            .steps
            .iter()
            .filter(|s| s.kind == StepKind::Grid)
            .count() as u32;
        match (&entry["grid"], &seq.grid) {
            (serde_json::Value::Null, None) => assert_eq!(grid_steps, 0, "{file}"),
            (expected, Some(grid)) if !expected.is_null() => {
                assert_eq!(
                    expected["n"].as_u64(),
                    Some(u64::from(grid.n)),
                    "{file}: grid"
                );
                assert_eq!(
                    expected["kind"].as_str(),
                    Some(match grid.kind {
                        oristudio_precrease::GridKind::Box => "box",
                        oristudio_precrease::GridKind::Hex => "hex",
                    }),
                    "{file}: grid"
                );
                assert_eq!(
                    expected["lines"].as_u64(),
                    Some(u64::from(grid.lines)),
                    "{file}: grid lines"
                );
                assert_eq!(
                    expected["steps"].as_u64(),
                    Some(u64::from(grid.steps)),
                    "{file}: grid steps"
                );
                assert_eq!(grid_steps, grid.steps, "{file}");
                assert_eq!(grid.lines, seq.totals.grid_lines, "{file}");
                assert_eq!(grid.cp_lines, seq.totals.grid_cp_lines, "{file}");
            }
            (expected, found) => {
                failures.push(format!("{file}: manifest grid {expected}, plan {found:?}"))
            }
        }
        // A press is a step but not a fold: it puts a mark on the paper for a
        // fold that follows, on a line already made. A grid step is one step
        // for a family of folds.
        assert_eq!(
            seq.steps.len() as u32,
            seq.totals.folds - seq.totals.grid_lines + grid_steps + seq.totals.presses,
            "{file}"
        );
        for (k, step) in seq.steps.iter().enumerate() {
            assert_eq!(step.id as usize, k + 1);
            if step.kind == StepKind::Grid {
                let grid = step.grid.as_ref().unwrap_or_else(|| {
                    panic!("{file}: step {} is a grid step with no grid", step.id)
                });
                assert!(!grid.lines.is_empty(), "{file}: step {}", step.id);
                assert!(step.chosen.is_none() && step.witnesses.is_empty(), "{file}");
                continue;
            }
            if step.kind == StepKind::Press {
                assert!(
                    step.press.is_some(),
                    "{file}: step {} is a press of nothing",
                    step.id
                );
                // A press presents the fold that made its line, so it has that
                // fold's witness — and reads as an ordinary step.
                let made = seq
                    .steps
                    .iter()
                    .find(|s| s.line_id == step.line_id && s.kind != StepKind::Press)
                    .unwrap_or_else(|| panic!("{file}: press on a line nobody made"));
                assert_eq!(step.chosen, made.chosen, "{file}: step {}", step.id);
            }
            assert!(
                step.chosen.is_some(),
                "{file}: step {} has no witness",
                step.id
            );
            assert!(
                step.err <= 1e-6,
                "{file}: step {} err {}",
                step.id,
                step.err
            );
            if step.kind == StepKind::Cp {
                assert!(!step.cp_line_ids.is_empty(), "{file}: step {}", step.id);
            }
        }
        // Landmarks-first keeps the totals — the folds, that is. A different
        // order can leave different marks short and so need different presses,
        // and can crease a band's line further for them.
        let lf = planner.sequence(true);
        let folds_only = |t: &Totals| Totals {
            presses: 0,
            grid_unwanted_length: 0.0,
            ..*t
        };
        assert_eq!(folds_only(&lf.totals), folds_only(&seq.totals), "{file}");
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

fn v(x: f64) -> Line {
    Line::new([1.0, 0.0], x).expect("line")
}

fn plan_lines(lines: &[Line]) -> (usize, Status, u32) {
    let mut p = oristudio_precrease::planner::Planner::from_lines(
        Sheet::unit_square(),
        lines,
        unbounded_options(),
    );
    let status = p.plan_without_reference_finder().expect("plan");
    let seq = p.sequence(false);
    (
        seq.totals.aux as usize,
        status,
        seq.diagnostics.stuck_events,
    )
}

#[test]
fn x_equals_one_fifth_needs_three_auxiliary_folds() {
    // Plan: `{x = 1/5}` 3 (panel, exhaustive depth 3 without O6).
    let (aux, status, _) = plan_lines(&[v(0.2)]);
    assert_eq!(status, Status::Complete);
    assert!(aux <= 3, "aux {aux}");
    println!("x = 1/5: {aux} auxiliary folds (panel: 3)");
}

#[test]
fn thirds_and_fifths_need_three_auxiliary_folds() {
    // Plan: `thirds_and_fifths` 3.
    let (aux, status, stuck) =
        plan_lines(&[v(1.0 / 3.0), v(2.0 / 3.0), v(0.2), v(0.4), v(0.6), v(0.8)]);
    assert_eq!(status, Status::Complete);
    assert!(aux <= 3, "aux {aux}");
    println!("thirds_and_fifths: {aux} auxiliary folds over {stuck} stuck events (panel: 3)");
}
