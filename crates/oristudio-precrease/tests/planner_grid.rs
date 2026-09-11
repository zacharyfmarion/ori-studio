//! The precrease grid: a box- or hex-pleated design opens with its grid
//! pleated, one step per family, and everything after is sighted from it.

mod common;

use common::*;

use oristudio_precrease::planner::PlannerOptions;
use oristudio_precrease::predicates::Ref;
use oristudio_precrease::sequence::{Sequence, StepKind};
use oristudio_precrease::{Direction, GridKind, Side};

/// The fixtures that are pleated, with the grid the manifest records.
const PLEATED: [(&str, GridKind, u32); 3] = [
    ("tests/fixtures/precrease/grid6.fold", GridKind::Box, 6),
    ("tests/fixtures/precrease/iguana-c0.fold", GridKind::Box, 50),
    ("tests/fixtures/precrease/hex-14.fold", GridKind::Hex, 16),
];

fn plan(file: &str, opts: PlannerOptions) -> Sequence {
    let cp = load(file);
    let analysis = analyze_cp(&cp);
    let component = analysis
        .components
        .iter()
        .find(|c| c.id == 0)
        .expect("component 0");
    plan_component(component, opts).1
}

#[test]
fn a_pleated_design_opens_with_its_grid() {
    for (file, kind, n) in PLEATED {
        let seq = plan(file, unbounded_options());
        let grid = seq
            .grid
            .as_ref()
            .unwrap_or_else(|| panic!("{file}: no grid"));
        assert_eq!(grid.kind, kind, "{file}");
        assert_eq!(grid.n, n, "{file}");
        // The grid steps come first, one per family, and are the only grid
        // steps there are.
        let families = grid.families as usize;
        assert!(families >= 1, "{file}");
        for (k, step) in seq.steps.iter().enumerate() {
            assert_eq!(step.id as usize, k + 1, "{file}: ids run from one");
            let is_grid = step.kind == StepKind::Grid;
            assert_eq!(
                is_grid,
                k < families,
                "{file}: step {} out of place",
                step.id
            );
            assert_eq!(is_grid, step.grid.is_some(), "{file}: step {}", step.id);
        }
        let mut lines = 0;
        let mut cp_lines = 0;
        for step in &seq.steps[..families] {
            let family = step.grid.as_ref().expect("a grid step carries its family");
            // Pleated from the front, sighted from nothing, exact by
            // construction.
            assert_eq!(step.side, Side::Front, "{file}");
            assert!(step.witnesses.is_empty() && step.chosen.is_none(), "{file}");
            assert!(step.exact && step.marks_exist, "{file}");
            assert_eq!(step.direction, Direction::Unassigned, "{file}");
            assert!(!family.lines.is_empty(), "{file}");
            assert_eq!(family.family, step.id as usize - 1, "{file}");
            assert_eq!(family.n, n, "{file}");
            // The lines alternate, in ascending order, every one on its own
            // chord; the step's own line is the first of them.
            assert_eq!(step.line_id, family.lines[0].line_id, "{file}");
            for pair in family.lines.windows(2) {
                assert!(pair[0].index < pair[1].index, "{file}: lines out of order");
                assert_ne!(
                    pair[0].direction, pair[1].direction,
                    "{file}: no alternation"
                );
                assert_eq!(
                    pair[1].index - pair[0].index,
                    1,
                    "{file}: a grid line is missing between {} and {}",
                    pair[0].index,
                    pair[1].index
                );
            }
            for line in &family.lines {
                assert_ne!(line.direction, Direction::Unassigned, "{file}");
                assert_eq!(line.cp_spans.len(), line.cp_line_ids.len(), "{file}");
                // The step's crease ids are its lines' crease ids.
                for id in &line.cp_line_ids {
                    assert!(step.cp_line_ids.contains(id), "{file}");
                }
                // Every grid line is made by this step, and by nothing else.
                let entry = seq
                    .lines
                    .iter()
                    .find(|l| l.id == line.line_id)
                    .unwrap_or_else(|| panic!("{file}: grid line {} unknown", line.line_id));
                assert_eq!(entry.step, Some(step.id), "{file}: line {}", line.line_id);
                assert!(
                    !seq.steps[families..]
                        .iter()
                        .any(|s| s.line_id == line.line_id && s.kind != StepKind::Press),
                    "{file}: grid line {} folded again",
                    line.line_id
                );
            }
            lines += family.lines.len() as u32;
            cp_lines += family.in_pattern;
            assert!(family.reversed <= family.in_pattern, "{file}");
        }
        assert_eq!(grid.lines, lines, "{file}");
        assert_eq!(grid.cp_lines, cp_lines, "{file}");
        assert_eq!(seq.totals.grid_lines, lines, "{file}");
        assert_eq!(seq.totals.grid_cp_lines, cp_lines, "{file}");
        // The pattern lines the grid realises are counted as pattern lines,
        // and the grid's own as folds.
        let cp_steps = seq.steps.iter().filter(|s| s.kind == StepKind::Cp).count() as u32;
        assert_eq!(seq.totals.cp_lines, cp_steps + cp_lines, "{file}");
        assert_eq!(
            seq.totals.folds,
            seq.totals.cp_lines + seq.totals.aux + (lines - cp_lines),
            "{file}"
        );
        // Nothing after the grid is a grid line, and something after it is
        // sighted from the grid.
        assert!(
            seq.steps[..families].iter().any(|s| !s.unlocks.is_empty()),
            "{file}: no step is sighted from the grid"
        );
        for later in &seq.steps[families..] {
            let Some(w) = later.chosen.and_then(|c| later.witnesses.get(c)) else {
                continue;
            };
            for input in &w.inputs {
                if let Ref::Line { id } | Ref::Edge { id, .. } = input {
                    assert!(seq.lines.iter().any(|l| l.id == *id), "{file}");
                }
            }
        }
    }
}

#[test]
fn a_design_that_is_not_pleated_has_no_grid_step() {
    for file in [
        "crates/oristudio-cp/resources/default-molecules/bird_base.fold",
        "crates/oristudio-cp/resources/default-molecules/frog_base.fold",
        "tests/fixtures/precrease/g3d_x19.fold",
        "tests/fixtures/precrease/claim7-cand9.fold",
    ] {
        let seq = plan(file, unbounded_options());
        assert!(seq.grid.is_none(), "{file}: {:?}", seq.grid);
        assert!(
            seq.steps
                .iter()
                .all(|s| s.kind != StepKind::Grid && s.grid.is_none()),
            "{file}"
        );
        assert_eq!(seq.totals.grid_lines, 0, "{file}");
    }
}

#[test]
fn the_grid_can_be_turned_off_and_the_plan_folds_line_by_line() {
    let off = PlannerOptions::from_json(r#"{"precrease_grid": false}"#).expect("options");
    assert!(!off.precrease_grid);
    assert!(
        PlannerOptions::from_json("")
            .expect("defaults")
            .precrease_grid
    );
    for (file, _, _) in PLEATED {
        let with = plan(file, unbounded_options());
        let without = plan(
            file,
            PlannerOptions {
                precrease_grid: false,
                ..unbounded_options()
            },
        );
        assert!(without.grid.is_none(), "{file}");
        assert!(
            without.steps.iter().all(|s| s.kind != StepKind::Grid),
            "{file}"
        );
        // The same lines are made either way; the grid makes fewer steps of
        // them.
        assert_eq!(with.totals.cp_lines, without.totals.cp_lines, "{file}");
        assert_eq!(
            with.totals.lower_bound, without.totals.lower_bound,
            "{file}"
        );
        assert!(with.steps.len() < without.steps.len(), "{file}");
    }
}

#[test]
fn landmarks_first_leaves_the_grid_where_it_is() {
    for (file, _, _) in PLEATED {
        let cp = load(file);
        let analysis = analyze_cp(&cp);
        let (planner, plain) = plan_component(&analysis.components[0], unbounded_options());
        let hoisted = planner.sequence(true);
        let families = plain.grid.as_ref().expect("grid").families as usize;
        assert_eq!(hoisted.grid, plain.grid, "{file}");
        for k in 0..families {
            assert_eq!(hoisted.steps[k].kind, StepKind::Grid, "{file}");
            assert_eq!(hoisted.steps[k].grid, plain.steps[k].grid, "{file}");
        }
    }
}

/// On the point cap partway through the grid, the lines that made it onto
/// the paper are the grid the plan reports, and the pattern lines it never
/// reached are still remaining: nothing is planned twice and nothing is lost.
#[test]
fn a_grid_cut_short_by_the_point_cap_is_reported_as_far_as_it_got() {
    let cp = load("tests/fixtures/precrease/grid6.fold");
    let analysis = analyze_cp(&cp);
    let opts = PlannerOptions {
        point_cap: 30,
        ..unbounded_options()
    };
    let (_, seq) = plan_component(&analysis.components[0], opts);
    assert!(seq.diagnostics.point_cap_hit);
    let grid = seq
        .grid
        .as_ref()
        .expect("the grid that was made is reported");
    assert!(grid.lines > 0 && grid.lines < 10, "{grid:?}");
    let pleated: u32 = seq
        .steps
        .iter()
        .filter_map(|s| s.grid.as_ref())
        .map(|g| g.lines.len() as u32)
        .sum();
    assert_eq!(pleated, grid.lines);
    // Every pattern line is either a step or a finding, never both, never
    // neither.
    assert_eq!(
        seq.totals.cp_lines + seq.totals.unsolved,
        seq.totals.lower_bound
    );
    assert_eq!(seq.totals.lower_bound + seq.totals.free_lines, 14);
    let folded: std::collections::HashSet<u32> = seq
        .steps
        .iter()
        .flat_map(|s| match &s.grid {
            Some(g) => g
                .lines
                .iter()
                .flat_map(|l| l.cp_line_ids.clone())
                .collect::<Vec<_>>(),
            None => s.cp_line_ids.clone(),
        })
        .collect();
    for finding in &seq.findings {
        for id in &finding.cp_line_ids {
            assert!(
                !folded.contains(id),
                "crease {id} is both folded and unsolved"
            );
        }
    }
    for entry in seq
        .lines
        .iter()
        .filter(|l| l.tag == oristudio_precrease::LineTag::Cp)
    {
        assert!(
            entry.step.is_some(),
            "state line {} was made by no step",
            entry.id
        );
    }
}

/// The curated benchmark designs, when they are on this machine
/// (`ORI_PRECREASE_CORPUS` names the directory of `<design>/truth.fold`):
/// real hex-pleated designs and real box-pleated ones. The grid is read off
/// the planner as built — planning an off-lattice design to the end is a
/// budget question, not a grid one.
#[test]
fn corpus_designs_are_pleated_on_their_own_grids() {
    let Ok(dir) = std::env::var("ORI_PRECREASE_CORPUS") else {
        eprintln!("ORI_PRECREASE_CORPUS is not set; skipping");
        return;
    };
    let dir = std::path::PathBuf::from(dir);
    for (design, kind, n, families) in [
        ("hex-tiger-naoki-terao", GridKind::Hex, 16, 3),
        ("zebra-naoki-terao", GridKind::Hex, 16, 3),
        ("axolotl-molecule", GridKind::Box, 8, 2),
        ("executioner", GridKind::Box, 28, 2),
    ] {
        let path = dir.join(design).join("truth.fold");
        let cp = oristudio_precrease::fixture_io::load_path(&path, None)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let analysis = analyze_cp(&cp);
        let planner = oristudio_precrease::planner::Planner::new(
            &analysis.components[0],
            unbounded_options(),
        );
        let seq = planner.sequence(false);
        let grid = seq
            .grid
            .as_ref()
            .unwrap_or_else(|| panic!("{design}: no grid"));
        assert_eq!(
            (grid.kind, grid.n, grid.families),
            (kind, n, families),
            "{design}"
        );
        assert!(grid.cp_lines * 2 >= grid.lines / 2, "{design}: {grid:?}");
        assert_eq!(
            seq.steps.len(),
            families as usize,
            "{design}: only the grid is planned"
        );
    }
}
