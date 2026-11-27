//! The box-pleat grid snap: an exact answer's near-grid coordinates put
//! exactly on the grid its detection reads, kept only where the solver still
//! calls the result exact. See [`GridSnapMode`].
use super::*;
use crate::box_pleat_grid::{BoxPleatGrid, read_box_pleat_grid, snap_to_box_pleat_grid};

/// The largest multiple of the read grid tried after it.
///
/// The grid read from a detection is the coarsest one that nearly all of it
/// sits on, so a design on 96 cells with a few vertices off the 32-grid reads
/// as 32 (forest fairy; girl-3 and the pseudoscorpion read 64 of 192). Snapped
/// to 32, those few stay where the solve put them, a fraction of a pixel off
/// the neighbours that moved, and the result is no longer exact. A finer
/// multiple snaps them too. The judge decides each try, so a multiple that only
/// happens to pass near some vertex cannot be adopted unless the result folds.
const MAX_GRID_MULTIPLE: u32 = 4;

/// A multiple is snapped within this share of its cell, when that is tighter
/// than the read tolerance: a pixel and a half is most of a 192-grid's 5 px
/// cell, and a converged answer sits within a tenth of a pixel of its grid
/// (girl-3 0.07 px, the pseudoscorpion 0.03), so a sixth of a cell still
/// catches it while keeping a band no wider than a third of the edge.
const MULTIPLE_TOLERANCE_CELLS: f64 = 1.0 / 6.0;

/// No multiple finer than this, in pixels a cell: below it a stroke is wider
/// than a cell and no detection resolves the grid.
const MIN_MULTIPLE_CELL_PX: f64 = 4.0;

/// Snap `solved` to the box-pleat grid `input` reads, if it is exact and the
/// snapped answer still is. The outcome, adopted or not, is reported as
/// `movement_report.grid_snap`; an adopted snap ends with
/// `termination: "box_pleat_grid_snap"` and keeps the answer it replaced under
/// `before_grid_snap`.
pub(super) fn round(
    input: &ExactSolveInput,
    solved: &mut ExactSolvedGraph,
    options: &ExactSolveOptionsWithExemptions,
    clock: &ExactSolveDeadline,
) {
    let Some(grid) = read_box_pleat_grid(input) else {
        solved.movement_report["grid_snap"] = json!({"adopted": false, "stop_reason": "no_grid"});
        return;
    };
    let mut report = json!({
        "cells": grid.cells,
        "coordinate_support": round6(grid.coordinate_support),
        "family_fraction": round6(grid.family_fraction),
        "adopted": false,
    });
    let stop = attempt(input, solved, options, clock, &grid, &mut report);
    report["stop_reason"] = json!(stop);
    solved.movement_report["grid_snap"] = report;
}

/// Why the round stopped; on `"adopted"`, `solved` holds the snapped answer.
fn attempt(
    input: &ExactSolveInput,
    solved: &mut ExactSolvedGraph,
    options: &ExactSolveOptionsWithExemptions,
    clock: &ExactSolveDeadline,
    grid: &BoxPleatGrid,
    report: &mut Value,
) -> &'static str {
    if solved.status != ExactSolvedGraphStatus::Solved || solved.movement_report["accepted"] != true
    {
        return "not_exact";
    }
    // A merged pair sits on one point the snap would treat as two vertices.
    if !solved.merged_vertices.is_empty() {
        return "merged_vertices";
    }
    if solved.vertices_exact.len() != input.vertices.len() {
        return "answer_shape";
    }
    // The answer as an input of its own, the way the judge reads a proposal:
    // its coordinates written in, the carriers refit through them, and the
    // caller's pins locked so the snap leaves them where they were held.
    let mut answered = input.clone();
    for (vertex, point) in answered.vertices.iter_mut().zip(&solved.vertices_exact) {
        vertex.point = *point;
        if options.pinned_vertex_ids.contains(&vertex.id) {
            vertex.movement_policy = CandidateVertexMovementPolicy::Locked;
        }
    }
    recognition::refresh_carriers(&mut answered);
    let mut refused = Vec::new();
    for multiple in 1..=MAX_GRID_MULTIPLE {
        let cells = grid.cells * multiple;
        if grid.pixels_per_unit / f64::from(cells) < MIN_MULTIPLE_CELL_PX {
            break;
        }
        let tolerance = if multiple == 1 {
            grid.tolerance
        } else {
            grid.tolerance
                .min(MULTIPLE_TOLERANCE_CELLS / f64::from(cells))
        };
        let snapped = snap_to_box_pleat_grid(
            &answered,
            &BoxPleatGrid {
                cells,
                tolerance,
                ..*grid
            },
        );
        if snapped.moved_vertices.is_empty() {
            if multiple == 1 {
                return "already_on_grid";
            }
            continue;
        }
        if clock.expired() {
            report["refused_cells"] = json!(refused);
            return "out_of_time";
        }
        let mut candidate = solved.clone();
        for (point, vertex) in candidate
            .vertices_exact
            .iter_mut()
            .zip(&snapped.input.vertices)
        {
            *point = vertex.point;
        }
        // The answer being replaced is kept once, below, not in every try.
        candidate.movement_report = json!({"grid_snap_proposal": {"cells": cells}});
        if let Some(mut judged) = recognition::judge_original(
            input,
            &candidate,
            options.options,
            clock,
            Rc::new(options.exempt_vertex_ids.clone()),
            Rc::new(options.pinned_vertex_ids.clone()),
        ) {
            judged.movement_report["termination"] = json!("box_pleat_grid_snap");
            // The rounds that ran before the snap still describe the answer —
            // the family its creases were pinned to, the pleats held even, the
            // mirror pairs — and a reader explains the answer from them; the
            // judge, which only checks, has none of its own to report.
            for key in ["polish", "symmetry"] {
                if let Some(value) = solved.movement_report.get(key) {
                    judged.movement_report[key] = value.clone();
                }
            }
            judged.movement_report["before_grid_snap"] = solved.movement_report.clone();
            judged.movement_report["elapsed_seconds"] = json!(clock.elapsed_seconds());
            judged.movement_report["work_spent"] = json!(clock.work.get());
            report["adopted"] = json!(true);
            report["snapped_cells"] = json!(cells);
            report["vertices_moved"] = json!(snapped.moved_vertices.len());
            report["refused_cells"] = json!(refused);
            *solved = judged;
            return "adopted";
        }
        refused.push(cells);
    }
    report["refused_cells"] = json!(refused);
    "not_exact_on_grid"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exact_solve_input_from_fold;

    /// The rebuilt document's resolution: no raster metadata, so 1024 px.
    const PX: f64 = 1024.0;

    /// Pleats: a vertical crease at every line of a 32-grid, mountain and
    /// valley in turn, each `noise(k)` px off its line. Flat-foldable at any
    /// spacing, so an answer a fraction of a pixel off the grid is as exact as
    /// one on it, and only a snap tells them apart.
    fn pleats(noise: impl Fn(usize) -> f64) -> treemaker_fold::FoldDocument {
        let mut coords = vec![
            json!([0.0, 0.0]),
            json!([1.0, 0.0]),
            json!([1.0, 1.0]),
            json!([0.0, 1.0]),
        ];
        let xs: Vec<f64> = (1..32).map(|k| k as f64 / 32.0 + noise(k) / PX).collect();
        let top: Vec<usize> = xs
            .iter()
            .map(|&x| {
                coords.push(json!([x, 0.0]));
                coords.len() - 1
            })
            .collect();
        let bottom: Vec<usize> = xs
            .iter()
            .map(|&x| {
                coords.push(json!([x, 1.0]));
                coords.len() - 1
            })
            .collect();
        let mut edges = Vec::new();
        let mut labels = Vec::new();
        let mut chain = vec![0];
        chain.extend(&top);
        chain.push(1);
        chain.push(2);
        chain.extend(bottom.iter().rev());
        chain.push(3);
        chain.push(0);
        for pair in chain.windows(2) {
            edges.push(json!([pair[0], pair[1]]));
            labels.push(json!("B"));
        }
        for (k, (&a, &b)) in top.iter().zip(&bottom).enumerate() {
            edges.push(json!([a, b]));
            labels.push(json!(if k % 2 == 0 { "M" } else { "V" }));
        }
        serde_json::from_value(json!({
            "file_spec": 1.1,
            "vertices_coords": coords,
            "edges_vertices": edges,
            "edges_assignment": labels,
        }))
        .expect("fold")
    }

    fn input_of(fold: &treemaker_fold::FoldDocument) -> ExactSolveInput {
        exact_solve_input_from_fold(fold).expect("rebuild").0
    }

    /// The grid snap alone. The lattice round, the pleat round that evens out
    /// a run's spacings and the symmetry round that holds mirror pairs to each
    /// other would each put a pattern this clean on its grid by themselves,
    /// which is not what these tests are about.
    fn grid_snap(pinned: &[usize]) -> ExactSolveOptionsWithExemptions {
        ExactSolveOptionsWithExemptions {
            options: ExactSolveOptions {
                grid_snap: GridSnapMode::BoxPleat,
                lattice_snap: LatticeSnapMode::Off,
                pleat_spacing: PleatSpacingMode::Off,
                symmetry: SymmetryMode::Off,
                ..ExactSolveOptions::default()
            },
            exempt_vertex_ids: BTreeSet::new(),
            pinned_vertex_ids: pinned.iter().copied().collect(),
        }
    }

    fn alternating(px: f64) -> impl Fn(usize) -> f64 {
        move |k| if k % 2 == 0 { px } else { -px }
    }

    fn on_grid(value: f64) -> bool {
        (value * 32.0 - (value * 32.0).round()).abs() < 1e-9
    }

    #[test]
    fn an_exact_answer_off_its_grid_is_snapped_onto_it() {
        let input = input_of(&pleats(alternating(0.6)));
        let solved = solve_exact_with_exemptions(&input, &grid_snap(&[]));
        let report = &solved.movement_report["grid_snap"];
        assert_eq!(report["stop_reason"], "adopted", "{report}");
        assert_eq!(report["snapped_cells"], 32);
        assert_eq!(solved.status, ExactSolvedGraphStatus::Solved);
        assert_eq!(solved.movement_report["accepted"], true);
        assert_eq!(solved.movement_report["termination"], "box_pleat_grid_snap");
        assert!(solved.movement_report["before_grid_snap"].is_object());
        assert_eq!(
            solved.movement_report["polish"],
            solved.movement_report["before_grid_snap"]["polish"]
        );
        for point in &solved.vertices_exact {
            assert!(on_grid(point.x) && on_grid(point.y), "{point:?}");
        }
    }

    #[test]
    fn off_leaves_the_answer_where_the_solve_put_it() {
        let input = input_of(&pleats(alternating(0.6)));
        let mut options = grid_snap(&[]);
        options.options.grid_snap = GridSnapMode::Off;
        let solved = solve_exact_with_exemptions(&input, &options);
        assert!(solved.movement_report.get("grid_snap").is_none());
        assert!(solved.vertices_exact.iter().any(|point| !on_grid(point.x)));
    }

    #[test]
    fn a_pinned_vertex_is_held_where_the_caller_put_it() {
        let input = input_of(&pleats(alternating(0.6)));
        let pinned = input
            .vertices
            .iter()
            .find(|vertex| vertex.movement_policy == CandidateVertexMovementPolicy::BoundaryOnly)
            .expect("a contact")
            .id;
        let solved = solve_exact_with_exemptions(&input, &grid_snap(&[pinned]));
        assert_eq!(solved.vertices_exact[pinned], input.vertices[pinned].point);
        assert!(!on_grid(solved.vertices_exact[pinned].x));
    }

    #[test]
    fn an_answer_on_its_grid_already_has_nothing_to_snap() {
        let input = input_of(&pleats(|_| 0.0));
        let solved = solve_exact_with_exemptions(&input, &grid_snap(&[]));
        assert_eq!(
            solved.movement_report["grid_snap"]["stop_reason"],
            "already_on_grid"
        );
    }

    #[test]
    fn a_pattern_too_small_to_vote_reads_no_grid() {
        let fold: treemaker_fold::FoldDocument = serde_json::from_value(json!({
            "vertices_coords": [[0., 0.], [1., 0.], [1., 1.], [0., 1.], [0.5, 0.], [0.5, 1.]],
            "edges_vertices": [[0, 4], [4, 1], [1, 2], [2, 5], [5, 3], [3, 0], [4, 5]],
            "edges_assignment": ["B", "B", "B", "B", "B", "B", "M"],
        }))
        .expect("fold");
        let solved = solve_exact_with_exemptions(&input_of(&fold), &grid_snap(&[]));
        assert_eq!(
            solved.movement_report["grid_snap"]["stop_reason"],
            "no_grid"
        );
    }
}
