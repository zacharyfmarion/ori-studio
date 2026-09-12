//! The precrease grid: a box- or hex-pleated design opens with its grid
//! pleated, one step per family, and everything after is sighted from it.

mod common;

use common::*;

use oristudio_precrease::planner::{GridMode, PlannerOptions};
use oristudio_precrease::predicates::Ref;
use oristudio_precrease::sequence::{Sequence, StepKind};
use oristudio_precrease::{Direction, ExactnessClass, GridKind, Side, analyze};

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
        // The grid steps come first — the pleats, then the band steps — and
        // are the only grid steps there are.
        let count = grid.steps as usize;
        assert!(
            count >= grid.families as usize && grid.families >= 1,
            "{file}"
        );
        for (k, step) in seq.steps.iter().enumerate() {
            assert_eq!(step.id as usize, k + 1, "{file}: ids run from one");
            let is_grid = step.kind == StepKind::Grid;
            assert_eq!(is_grid, k < count, "{file}: step {} out of place", step.id);
            assert_eq!(is_grid, step.grid.is_some(), "{file}: step {}", step.id);
        }
        let mut lines = 0;
        let mut cp_lines = 0;
        let mut seen_band = false;
        for step in &seq.steps[..count] {
            let family = step.grid.as_ref().expect("a grid step carries its family");
            // Pleated from the front, sighted from nothing, exact by
            // construction.
            assert_eq!(step.side, Side::Front, "{file}");
            assert!(step.witnesses.is_empty() && step.chosen.is_none(), "{file}");
            assert!(step.exact && step.marks_exist, "{file}");
            assert_eq!(step.direction, Direction::Unassigned, "{file}");
            assert!(!family.lines.is_empty(), "{file}");
            assert!((family.family as u32) < grid.families, "{file}");
            assert_eq!(family.n, n, "{file}");
            // The pleats come before the band steps.
            if family.pleat {
                assert!(!seen_band, "{file}: a pleat after a band step");
            } else {
                seen_band = true;
            }
            // In ascending order, every one on its own chord; the step's own
            // line is the first of them.
            assert_eq!(step.line_id, family.lines[0].line_id, "{file}");
            for pair in family.lines.windows(2) {
                assert!(pair[0].index < pair[1].index, "{file}: lines out of order");
                if family.pleat {
                    // A pleat alternates, and skips no line of its level.
                    assert_ne!(
                        pair[0].direction, pair[1].direction,
                        "{file}: no alternation"
                    );
                    if let Some(cells) = family.cells {
                        assert_eq!(
                            (pair[1].index - pair[0].index) as u32,
                            cells / family.level.max(1),
                            "{file}: a grid line is missing between {} and {}",
                            pair[0].index,
                            pair[1].index
                        );
                    }
                }
            }
            for line in &family.lines {
                assert_ne!(line.direction, Direction::Unassigned, "{file}");
                if !family.pleat && line.pattern_direction != Direction::Unassigned {
                    // A band step's line is made the way the pattern wants it.
                    assert_eq!(line.direction, line.pattern_direction, "{file}");
                }
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
                    !seq.steps[count..]
                        .iter()
                        .any(|s| s.line_id == line.line_id && s.kind != StepKind::Press),
                    "{file}: grid line {} folded again",
                    line.line_id
                );
            }
            // A band is bounded by the sheet's edge or by a line an earlier
            // grid step made, so the folder can see where it runs — except
            // an odd base's band (13ths, 25ths), which no halving made and
            // whose bounds are positions across the sheet.
            assert_eq!(family.pleat, family.regions.is_empty(), "{file}");
            for region in &family.regions {
                assert!(region.lines >= 1, "{file}");
                for bound in &region.bounds {
                    if bound.edge {
                        assert!(bound.line_id.is_none(), "{file}");
                        continue;
                    }
                    let Some(id) = bound.line_id else {
                        assert!(family.level % 2 == 1, "{file}: a bound off the paper");
                        continue;
                    };
                    let made_by = seq
                        .lines
                        .iter()
                        .find(|l| l.id == id)
                        .and_then(|l| l.step)
                        .unwrap_or_else(|| panic!("{file}: bound {id} made by nothing"));
                    assert!(
                        made_by < step.id,
                        "{file}: bound {id} made after step {}",
                        step.id
                    );
                }
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
            seq.steps[..count].iter().any(|s| !s.unlocks.is_empty()),
            "{file}: no step is sighted from the grid"
        );
        for later in &seq.steps[count..] {
            let Some(w) = later.chosen.and_then(|c| later.witnesses.get(c)) else {
                continue;
            };
            for input in &w.inputs {
                if let Ref::Line { id } | Ref::Edge { id, .. } = input {
                    assert!(seq.lines.iter().any(|l| l.id == *id), "{file}");
                }
            }
        }
        // Whatever the grid left out, the plan still makes.
        assert_eq!(seq.totals.unsolved, 0, "{file}");
    }
}

#[test]
fn the_grid_can_be_turned_off_and_the_plan_folds_line_by_line() {
    let off = PlannerOptions::from_json(r#"{"precrease_grid": false}"#).expect("options");
    assert_eq!(off.precrease_grid, GridMode::Off);
    assert_eq!(
        PlannerOptions::from_json("")
            .expect("defaults")
            .precrease_grid,
        GridMode::WhereNeeded
    );
    // The toggle alone still gets a grid; the second flag says how much.
    assert_eq!(
        PlannerOptions::from_json(r#"{"grid_where_needed": false}"#)
            .expect("options")
            .precrease_grid,
        GridMode::Whole
    );
    assert_eq!(
        PlannerOptions::from_json(r#"{"precrease_grid": false, "grid_where_needed": true}"#)
            .expect("options")
            .precrease_grid,
        GridMode::Off
    );
    for (file, _, _) in PLEATED {
        let with = plan(file, unbounded_options());
        let without = plan(
            file,
            PlannerOptions {
                precrease_grid: GridMode::Off,
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
        let count = plain.grid.as_ref().expect("grid").steps as usize;
        assert_eq!(hoisted.grid, plain.grid, "{file}");
        for k in 0..count {
            assert_eq!(hoisted.steps[k].kind, StepKind::Grid, "{file}");
            assert_eq!(hoisted.steps[k].grid, plain.steps[k].grid, "{file}");
        }
    }
}

/// An off-lattice design draws a crease a hair off a grid line — hex-tiger's
/// ear creases sit 0.0006 from the 30° lines of its grid — and the pleat that
/// makes the grid line makes that crease too, rather than the plan sighting a
/// second fold a quarter of a millimetre from the first.
#[test]
fn a_crease_a_hair_off_a_grid_line_rides_on_the_grid_step() {
    // An 8-grid box pattern, a second line drawn alongside x = ¼ a hair off
    // it (which the exactness probe refuses to snap together, so the
    // component is off-lattice and planned as drawn — and which the coalesce
    // leaves alone for the same reason), and a short crease 0.0006 above the
    // grid line y = ½ where that line stops.
    let mut segments: Vec<f64> = Vec::new();
    let mut colors: Vec<i32> = Vec::new();
    let mut push = |s: [f64; 4], c: i32| {
        segments.extend_from_slice(&[
            s[0] * 400.0 - 200.0,
            200.0 - s[1] * 400.0,
            s[2] * 400.0 - 200.0,
            200.0 - s[3] * 400.0,
        ]);
        colors.push(c);
    };
    for (a, b) in [
        ([0.0, 0.0], [1.0, 0.0]),
        ([1.0, 0.0], [1.0, 1.0]),
        ([1.0, 1.0], [0.0, 1.0]),
        ([0.0, 1.0], [0.0, 0.0]),
    ] {
        push([a[0], a[1], b[0], b[1]], 0);
    }
    for k in 1..8 {
        let t = k as f64 / 8.0;
        push([t, 0.0, t, 1.0], if k % 2 == 0 { 1 } else { 2 });
        // y = ½ stops short of the right edge; the hair-off crease continues
        // it there, as hex-tiger's ears continue its grid lines.
        let right = if k == 4 { 0.8 } else { 1.0 };
        push([0.0, t, right, t], if k % 2 == 0 { 2 } else { 1 });
    }
    push([0.2515, 0.0, 0.2515, 1.0], 1);
    push([0.9, 0.5006, 1.0, 0.5006], 2);
    let analysis = analyze(&segments, &colors, Some(ORIEDITA_PAPER)).expect("analysis");
    let component = &analysis.components[0];
    assert_eq!(
        component.exactness.as_ref().map(|e| e.class),
        Some(ExactnessClass::OffLattice)
    );
    let hair = component
        .merged_lines
        .iter()
        .position(|l| (l.line.d - 0.5006).abs() < 1e-6 && l.line.n[1] > 0.9)
        .expect("the hair-off crease merges as its own line at TOL");
    let hair_id = component.merged_lines[hair].segment_indices[0] + 1;
    let (_, seq) = plan_component(component, unbounded_options());
    let grid = seq.grid.as_ref().expect("a grid");
    assert_eq!((grid.kind, grid.n), (GridKind::Box, 8));
    let horizontal = seq.steps[1].grid.as_ref().expect("the horizontal family");
    let half = horizontal
        .lines
        .iter()
        .find(|l| (l.line.d - 0.5).abs() < 1e-9)
        .expect("y = ½ is a grid line");
    assert!(
        half.cp_line_ids.contains(&hair_id),
        "the hair-off crease is made by the grid line it sits on: {:?}",
        half.cp_line_ids
    );
    assert!(
        seq.steps
            .iter()
            .all(|s| s.kind != StepKind::Cp || !s.cp_line_ids.contains(&hair_id)),
        "and not by a fold of its own"
    );
    // The line alongside x = ¼ is still its own: a fold of its own, or
    // ReferenceFinder's to construct, which this driver has not got.
    let alongside = component
        .merged_lines
        .iter()
        .find(|l| (l.line.d - 0.2515).abs() < 1e-6 && l.line.n[0] > 0.9)
        .map(|l| l.segment_indices[0] + 1)
        .expect("the line alongside x = ¼");
    assert!(
        seq.steps
            .iter()
            .any(|s| s.kind == StepKind::Cp && s.cp_line_ids.contains(&alongside))
            || seq
                .findings
                .iter()
                .any(|f| f.cp_line_ids.contains(&alongside)),
        "a crease drawn alongside another is not folded as it"
    );
    assert!(seq.totals.unsolved <= 1, "{:?}", seq.findings);
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
