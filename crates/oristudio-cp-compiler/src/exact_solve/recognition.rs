//! Bounded proposals for recognition and whole-pattern repair.
use super::*;

const LARGE_SPANS: usize = 1500;
const NOISE_PX: f64 = 1.5;
const RETRY_NOISE_PX: f64 = 2.0;

pub(super) fn solve(
    input: &ExactSolveInput,
    mut options: ExactSolveOptions,
    exempt: Rc<BTreeSet<usize>>,
    pinned: Rc<BTreeSet<usize>>,
) -> ExactSolvedGraph {
    options.recognition_fallback = false;
    let clock = ExactSolveDeadline::start(options.timeout_seconds, options.work_budget);
    let mut primary_options = options;
    // Reserve part of the same 25-second budget for the direct feasibility
    // proposal. A slow ordinary polish must not starve every alternative.
    primary_options.timeout_seconds = if options.timeout_seconds < 0.0 {
        20.0
    } else {
        (remaining(&clock) * 0.8).min(20.0)
    };
    let mut primary = solve_exact_inner(
        input,
        primary_options,
        Rc::clone(&exempt),
        Rc::clone(&pinned),
        input.selected_spans.len() > LARGE_SPANS,
    );
    let spent = primary.movement_report["work_spent"].as_u64().unwrap_or(0);
    clock.work.set(spent);
    if (primary.status == ExactSolvedGraphStatus::Solved
        && primary.movement_report["accepted"] == true)
        || clock.expired()
    {
        return finish(primary, &clock, options, None);
    }
    let mut lattice_report = None;
    if let Some((proposal, mut report)) = propose(input, &pinned) {
        let mut fallback_options = options;
        // A fully fixed document proposal needs validation, not a search. Its
        // large graph checks can outlast the small iterative-proposal slice.
        let fixed_document = input.image_size.is_none() && all_vertices_fixed(&proposal, &pinned);
        let proposal_limit = if fixed_document { 10.0 } else { 5.0 };
        fallback_options.timeout_seconds = if options.timeout_seconds < 0.0 {
            proposal_limit
        } else {
            (remaining(&clock) * 0.5).min(proposal_limit)
        };
        fallback_options.work_budget = clock.work_left();
        let candidate = if input.image_size.is_none() {
            solve_proposal(
                &proposal,
                fallback_options,
                Rc::clone(&exempt),
                Rc::clone(&pinned),
            )
        } else {
            // Preserve the recognition path's structural polish: accepting a
            // coordinate projection first can leave off-grid construction
            // points at a different locally valid solution. Document rebuilds
            // previously had no partial-lattice path at all.
            solve_exact_inner(
                &proposal,
                fallback_options,
                Rc::clone(&exempt),
                Rc::clone(&pinned),
                false,
            )
        };
        clock.work.set(
            spent.saturating_add(
                candidate.movement_report["work_spent"]
                    .as_u64()
                    .unwrap_or(0),
            ),
        );
        report["candidate_status"] = json!(candidate.status);
        report["candidate_timed_out"] = candidate.movement_report["timed_out"].clone();
        report["adopted"] = json!(false);
        if !clock.expired()
            && candidate.status == ExactSolvedGraphStatus::Solved
            && candidate.movement_report["accepted"] == true
            && candidate.merged_vertices.is_empty()
            && let Some(rebased) = judge_original(
                input,
                &candidate,
                options,
                &clock,
                Rc::clone(&exempt),
                Rc::clone(&pinned),
            )
        {
            report["adopted"] = json!(true);
            return finish(rebased, &clock, options, Some(report));
        }
        lattice_report = Some(report);
    }
    if !clock.expired() {
        let candidate = projection::solve(input, options, &clock, exempt, pinned);
        let adopted = candidate.status == ExactSolvedGraphStatus::Solved
            && candidate.movement_report["accepted"] == true
            && !clock.expired();
        let report = json!({
            "status": candidate.status,
            "adopted": adopted,
            "rejection_reasons": candidate.movement_report["rejection_reasons"],
            "details": candidate.movement_report["constraint_projection"],
        });
        if adopted {
            primary = candidate;
        }
        primary.movement_report["recognition_projection"] = report;
    }
    finish(primary, &clock, options, lattice_report)
}

/// A mostly locked grid has few coordinate unknowns, even when thousands of
/// spans leave the carrier formulation large. Try the sparse projection before
/// spending the proposal's remaining budget on the ordinary solver.
fn solve_proposal(
    input: &ExactSolveInput,
    mut options: ExactSolveOptions,
    exempt: Rc<BTreeSet<usize>>,
    pinned: Rc<BTreeSet<usize>>,
) -> ExactSolvedGraph {
    let clock = ExactSolveDeadline::start(options.timeout_seconds, options.work_budget);
    let fixed = all_vertices_fixed(input, &pinned);
    let projection_clock = ExactSolveDeadline::start(
        if fixed {
            options.timeout_seconds
        } else {
            (options.timeout_seconds * 0.5).min(2.5)
        },
        options.work_budget,
    );
    let projected = projection::solve(
        input,
        options,
        &projection_clock,
        Rc::clone(&exempt),
        Rc::clone(&pinned),
    );
    clock.work.set(projection_clock.work.get());
    if (projected.status == ExactSolvedGraphStatus::Solved
        && projected.movement_report["accepted"] == true)
        || clock.expired()
        || fixed
    {
        return projected;
    }
    options.timeout_seconds = remaining(&clock);
    options.work_budget = clock.work_left();
    let mut ordinary = solve_exact_inner(input, options, exempt, pinned, false);
    ordinary.movement_report["proposal_projection"] = projected.movement_report;
    ordinary.movement_report["work_spent"] = json!(
        clock
            .work
            .get()
            .saturating_add(ordinary.movement_report["work_spent"].as_u64().unwrap_or(0))
    );
    ordinary
}

fn all_vertices_fixed(input: &ExactSolveInput, pinned: &BTreeSet<usize>) -> bool {
    input.vertices.iter().all(|v| {
        v.movement_policy == CandidateVertexMovementPolicy::Locked
            || pinned.contains(&v.id)
            || input.boundary.corners.contains(&v.id)
    })
}

fn remaining(clock: &ExactSolveDeadline) -> f64 {
    if clock.timeout_seconds < 0.0 {
        -1.0
    } else {
        (clock.timeout_seconds - clock.elapsed_seconds()).max(0.0)
    }
}

fn finish(
    mut result: ExactSolvedGraph,
    clock: &ExactSolveDeadline,
    options: ExactSolveOptions,
    proposal: Option<Value>,
) -> ExactSolvedGraph {
    result.movement_report["elapsed_seconds"] = json!(clock.elapsed_seconds());
    result.movement_report["timeout_seconds"] = json!(options.timeout_seconds);
    result.movement_report["work_spent"] = json!(clock.work.get());
    result.movement_report["recognition_fallback"] = json!(proposal);
    if clock.expired() && result.movement_report["accepted"] != true {
        result.movement_report["timed_out"] = json!(true);
        result.movement_report["rejection_reasons"] = json!([timeout_rejection_reason(options)]);
    }
    result
}

/// Coarsest grid supported by 95% of coordinates; only its inliers are held.
/// A finer grid is not allowed to absorb the remaining off-grid geometry.
pub(super) fn propose(
    input: &ExactSolveInput,
    pinned: &BTreeSet<usize>,
) -> Option<(ExactSolveInput, Value)> {
    propose_at_noise(input, pinned, NOISE_PX).or_else(|| {
        input
            .image_size
            .is_none()
            .then(|| propose_at_noise(input, pinned, RETRY_NOISE_PX))
            .flatten()
    })
}

fn propose_at_noise(
    input: &ExactSolveInput,
    pinned: &BTreeSet<usize>,
    noise_px: f64,
) -> Option<(ExactSolveInput, Value)> {
    if !validate_input(input).is_empty() || is_polygon_boundary(input) {
        return None;
    }
    // Live-document rebuilding has no raster metadata. Use the same 1024-unit
    // fallback as SolveModel instead of silently disabling structural repair.
    let pixels = f64::from(match input.image_size {
        Some(size) => size.checked_sub(64)?,
        None => 1024,
    });
    if pixels <= 0.0 || input.vertices.is_empty() {
        return None;
    }
    let tolerance = noise_px / pixels;
    for cells in 4..=512 {
        let band = 2.0 * tolerance * f64::from(cells);
        if band >= 0.5 {
            break;
        }
        let mut support = 0usize;
        let mut distinct = BTreeSet::new();
        for vertex in &input.vertices {
            for value in [vertex.point.x, vertex.point.y] {
                if (value - crate::lattice::snap_to(value, cells)).abs() <= tolerance {
                    support += 1;
                    distinct.insert((value * 1e6).round() as i64);
                }
            }
        }
        let fraction = support as f64 / (2 * input.vertices.len()) as f64;
        if fraction < 0.95 || distinct.len() < 8 || band.powf(distinct.len() as f64) > 1e-6 {
            continue;
        }
        let mut proposal = input.clone();
        let mut locked = 0usize;
        for vertex in &mut proposal.vertices {
            // Never move a user pin or an already locked vertex. Corners remain
            // the original boundary model's fixed anchors as in the base solve.
            if pinned.contains(&vertex.id)
                || vertex.movement_policy == CandidateVertexMovementPolicy::Locked
                || input.boundary.corners.contains(&vertex.id)
            {
                continue;
            }
            let snapped = Point2::new(
                crate::lattice::snap_to(vertex.point.x, cells),
                crate::lattice::snap_to(vertex.point.y, cells),
            );
            if (snapped.x - vertex.point.x).abs() <= tolerance
                && (snapped.y - vertex.point.y).abs() <= tolerance
                && distance(snapped, vertex.point) * pixels <= noise_px * 2.0
            {
                vertex.point = snapped;
                vertex.movement_policy = CandidateVertexMovementPolicy::Locked;
                locked += 1;
            }
        }
        if locked == 0 {
            return None;
        }
        refresh_carriers(&mut proposal);
        return Some((
            proposal,
            json!({"cells": cells, "coordinate_support": fraction,
                                      "noise_px": noise_px, "pixels_per_unit": pixels,
                                      "locked_vertices": locked}),
        ));
    }
    None
}

fn refresh_carriers(input: &mut ExactSolveInput) {
    for span in &mut input.selected_spans {
        let [a, b] = span.vertices;
        let (carrier, interval) = carrier_from(input.vertices[a].point, input.vertices[b].point);
        span.carrier = carrier;
        span.t_interval = interval;
    }
}

/// Rejudge everything, including movement, against recognition's coordinates.
/// The snapped input is an optimization proposal, never a new movement origin.
pub(super) fn judge_original(
    input: &ExactSolveInput,
    candidate: &ExactSolvedGraph,
    options: ExactSolveOptions,
    clock: &ExactSolveDeadline,
    exempt: Rc<BTreeSet<usize>>,
    pinned: Rc<BTreeSet<usize>>,
) -> Option<ExactSolvedGraph> {
    if candidate.vertices_exact.len() != input.vertices.len() {
        return None;
    }
    for (v, p) in input.vertices.iter().zip(&candidate.vertices_exact) {
        if (pinned.contains(&v.id) || v.movement_policy == CandidateVertexMovementPolicy::Locked)
            && *p != v.point
        {
            return None;
        }
    }
    let before_model = SolveModel::new(
        input,
        options,
        clock.clone(),
        Rc::clone(&exempt),
        Rc::clone(&pinned),
    );
    let before_params = before_model.initial_params.clone();
    let before_points = before_model.placed_points(&before_params);
    let before = analyze_graph(
        input,
        &before_points,
        &before_model,
        &before_params,
        options,
    );
    let mut placed = input.clone();
    for (vertex, point) in placed.vertices.iter_mut().zip(&candidate.vertices_exact) {
        vertex.point = *point;
    }
    refresh_carriers(&mut placed);
    let model = SolveModel::new(&placed, options, clock.clone(), exempt, pinned);
    let params = model.initial_params.clone();
    let after = analyze_graph(input, &candidate.vertices_exact, &model, &params, options);
    let status = classify_status(&before, &after, options);
    if status != ExactSolvedGraphStatus::Solved {
        return None;
    }
    let (before_residuals, before_breakdown) =
        before_model.residuals_with_breakdown(&before_params);
    let (after_residuals, after_breakdown) = model.residuals_with_breakdown(&params);
    let initial_objective = residual_energy(&before_residuals);
    let objective = residual_energy(&after_residuals);
    let reasons = exact_solution_rejection_reasons(
        &before,
        &after,
        status,
        initial_objective,
        objective,
        options,
    );
    if !reasons.is_empty() || clock.expired() {
        return None;
    }
    let mut result = candidate.clone();
    result.movement_report = movement_report(
        input,
        &before_points,
        &candidate.vertices_exact,
        &candidate.vertices_exact,
        initial_objective,
        objective,
        objective,
        0,
        "partial_lattice",
        options,
        true,
        &[],
        &model,
        &before_breakdown,
        &after_breakdown,
        &after_breakdown,
        &SolveCounterSnapshot::default(),
        &PolishOutcome::not_run("partial_lattice"),
    );
    result.movement_report["proposal_solve"] = candidate.movement_report.clone();
    result.theorem_residual_report =
        theorem_report(&before, &after, &after, "partial_lattice", true, &[]);
    Some(result)
}
