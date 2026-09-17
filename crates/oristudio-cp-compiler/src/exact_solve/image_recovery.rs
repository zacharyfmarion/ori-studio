//! Generate alternatives from source strokes and keep only a meaningfully
//! better image fit that passes the original request's unchanged hard checks.
use super::*;
use crate::image_evidence::SourceImageEvidence;

fn usable(input: &ExactSolveInput, evidence: &SourceImageEvidence) -> bool {
    let n = input.vertices.len();
    evidence.pixels_per_unit.is_finite()
        && evidence.pixels_per_unit > 0.
        && evidence.observed_vertices.len() == n
        && evidence.fitted_vertices.len() == n
        && !evidence.lines.is_empty()
        && evidence.lines.len() <= input.selected_spans.len()
        && evidence
            .lines
            .iter()
            .map(|line| line.span_id)
            .collect::<BTreeSet<_>>()
            .len()
            == evidence.lines.len()
        && evidence
            .observed_vertices
            .iter()
            .zip(&input.vertices)
            .all(|(p, v)| *p == v.point)
        && evidence
            .fitted_vertices
            .iter()
            .all(|p| p.x.is_finite() && p.y.is_finite())
        && evidence.lines.iter().all(|line| {
            line.normal.x.is_finite()
                && line.normal.y.is_finite()
                && (line.normal.x.hypot(line.normal.y) - 1.).abs() < 1e-6
                && line.rho.is_finite()
                && line.length_pixels.is_finite()
                && line.length_pixels > 0.
                && line.sigma_pixels.is_finite()
                && line.sigma_pixels >= 0.
                && input.selected_spans.iter().any(|span| {
                    span.id == line.span_id
                        && span.vertices == line.vertices
                        && span.assignment_label() == line.assignment
                })
                && line.vertices.iter().all(|&v| v < n)
        })
}

#[derive(Clone, Copy)]
struct ImageScore {
    error: f64,
    raw_error: f64,
    phase: Point2,
}

fn score(evidence: &SourceImageEvidence, points: &[Point2]) -> ImageScore {
    let (mut aa, mut ab, mut bb, mut bx, mut by, mut yy, mut mass) = (0., 0., 0., 0., 0., 0., 0.);
    for line in &evidence.lines {
        let weight = line.length_pixels.min(100.);
        let n = line.normal;
        for &v in &line.vertices {
            let residual =
                (n.x * points[v].x + n.y * points[v].y - line.rho) * evidence.pixels_per_unit;
            aa += weight * n.x * n.x;
            ab += weight * n.x * n.y;
            bb += weight * n.y * n.y;
            bx += weight * n.x * residual;
            by += weight * n.y * residual;
            yy += weight * residual * residual;
            mass += weight;
        }
    }
    // Pixel-center conventions and endpoint rounding introduce a shared raster
    // phase even with a correct paper frame. Fit at most half a source pixel in
    // each axis for scoring only. Never translate the returned geometry or use
    // this nuisance parameter when comparing an answer to reference coordinates.
    // Enumerate the interior optimum and the four box edges of this 2x2 problem.
    let det = aa * bb - ab * ab;
    let mut phases = vec![Point2::new(0., 0.)];
    if det > 1e-12 * (aa + bb).powi(2) {
        phases.push(Point2::new(
            (bx * bb - by * ab) / det,
            (by * aa - bx * ab) / det,
        ));
    } else if aa + bb > 0. {
        phases.push(Point2::new(bx / (aa + bb), by / (aa + bb)));
    }
    for bound in [-0.5, 0.5] {
        phases.push(Point2::new(
            bound,
            if bb > 0. { (by - ab * bound) / bb } else { 0. },
        ));
        phases.push(Point2::new(
            if aa > 0. { (bx - ab * bound) / aa } else { 0. },
            bound,
        ));
    }
    let error = |p: Point2| {
        ((yy - 2. * (bx * p.x + by * p.y) + aa * p.x * p.x + 2. * ab * p.x * p.y + bb * p.y * p.y)
            / mass)
            .max(0.)
    };
    let mut best = ImageScore {
        error: yy / mass,
        raw_error: yy / mass,
        phase: phases[0],
    };
    for phase in phases {
        let phase = Point2::new(phase.x.clamp(-0.5, 0.5), phase.y.clamp(-0.5, 0.5));
        let value = error(phase);
        if value < best.error - 1e-14
            || ((value - best.error).abs() <= 1e-14
                && phase.x.hypot(phase.y) < best.phase.x.hypot(best.phase.y))
        {
            best.error = value;
            best.phase = phase;
        }
    }
    best
}

/// Conservative uncertainty margin for comparing fitted lines. A source pixel
/// has at least uniform one-pixel quantization uncertainty (variance 1/12),
/// even when regression through its rounded stroke reports zero scatter.
/// Endpoints on the same fitted line have correlated offset and angle errors.
/// Bound their combined effect before summing independent line variances;
/// counting every sampled pixel as independent would overstate confidence.
fn comparison_margin(
    evidence: &SourceImageEvidence,
    before: &[Point2],
    after: &[Point2],
    before_phase: Point2,
    after_phase: Point2,
) -> f64 {
    let mut variance = 0.;
    let mut mass = 0.;
    for line in &evidence.lines {
        let weight = line.length_pixels.min(100.);
        let displacement: f64 = line
            .vertices
            .iter()
            .map(|&v| {
                (line.normal.x
                    * ((before[v].x - after[v].x) * evidence.pixels_per_unit - before_phase.x
                        + after_phase.x)
                    + line.normal.y
                        * ((before[v].y - after[v].y) * evidence.pixels_per_unit - before_phase.y
                            + after_phase.y))
                    .abs()
            })
            .sum();
        variance += (weight * displacement).powi(2) * (1. / 12. + line.sigma_pixels.powi(2));
        mass += 2. * weight;
    }
    (4. * variance.sqrt() / mass).max(0.0001)
}

pub(super) fn refine(
    input: &ExactSolveInput,
    solved: &mut ExactSolvedGraph,
    options: &ExactSolveOptionsWithExemptions,
    clock: &ExactSolveDeadline,
) {
    if options.options.construction_recovery != ConstructionRecoveryMode::Constructions
        || options.options.angle_family == AngleFamilyMode::Off
        || is_polygon_boundary(input)
        || solved.status != ExactSolvedGraphStatus::Solved
        || solved.movement_report["accepted"] != true
        || !solved.merged_vertices.is_empty()
        || clock.expired()
    {
        return;
    }
    let Some(evidence) = input.image_evidence.as_ref().filter(|e| usable(input, e)) else {
        return;
    };
    let reserve = 0.5 + (input.vertices.len() as f64).powi(2) * 1e-7;
    let mut proposal = input.clone();
    proposal.image_evidence = None;
    for (v, point) in proposal.vertices.iter_mut().zip(&evidence.fitted_vertices) {
        if !options.pinned_vertex_ids.contains(&v.id)
            && v.movement_policy != CandidateVertexMovementPolicy::Locked
            && !input.boundary.corners.contains(&v.id)
        {
            v.point = *point;
        }
    }
    recognition::refresh_carriers(&mut proposal);
    let original_report = solved.movement_report.clone();
    let initial_score = score(evidence, &solved.vertices_exact);
    let mut best_score = initial_score;
    let mut best_description = recovery::description_cost(&solved.vertices_exact);
    let mut reports = Vec::new();
    // The precise observation scale is tried first. The ordinary construction
    // prior and a tighter subpixel hypothesis remain bounded alternatives.
    for weight in [800., 8., 8000.] {
        let remaining = if clock.timeout_seconds < 0. {
            8.
        } else {
            clock.timeout_seconds - clock.elapsed_seconds() - reserve
        };
        if remaining <= 0.1 || clock.expired() {
            break;
        }
        let mut child_options = options.clone();
        child_options.options.timeout_seconds = remaining.min(8.);
        child_options.options.work_budget = clock.work_left();
        let child_clock = ExactSolveDeadline::start(
            child_options.options.timeout_seconds,
            child_options.options.work_budget,
        );
        let candidate = solve_with_recovery(&proposal, &child_options, &child_clock, weight);
        clock.work.set(
            clock.work.get().saturating_add(
                candidate.movement_report["work_spent"]
                    .as_u64()
                    .unwrap_or(0),
            ),
        );
        let mut report = json!({"observation_weight":weight,"seconds":child_clock.elapsed_seconds(),"adopted":false});
        if candidate.status != ExactSolvedGraphStatus::Solved
            || candidate.movement_report["accepted"] != true
            || !candidate.merged_vertices.is_empty()
            || candidate.vertices_exact.len() != input.vertices.len()
            || candidate.edges_exact != solved.edges_exact
        {
            report["reason"] = json!("candidate_checks");
            reports.push(report);
            continue;
        }
        let candidate_score = score(evidence, &candidate.vertices_exact);
        let movement = candidate
            .vertices_exact
            .iter()
            .zip(&solved.vertices_exact)
            .map(|(&a, &b)| distance(a, b))
            .fold(0., f64::max)
            * evidence.pixels_per_unit;
        report["score_px_squared"] = json!(candidate_score.error);
        report["raster_phase_pixels"] = json!(candidate_score.phase);
        report["max_change_pixels"] = json!(movement);
        let description = recovery::description_cost(&candidate.vertices_exact);
        // Simpler exact geometry and better ink supply independent evidence.
        // Otherwise the image improvement must clear the quantization margin.
        let margin = if description < best_description - 1e-6 {
            0.0001
        } else {
            comparison_margin(
                evidence,
                &solved.vertices_exact,
                &candidate.vertices_exact,
                best_score.phase,
                candidate_score.phase,
            )
        };
        report["construction_description_cost"] = json!(description);
        report["previous_description_cost"] = json!(best_description);
        report["comparison_margin_px_squared"] = json!(margin);
        // Below this scale, byte quantization and centroid fitting cannot
        // reliably distinguish a new construction from an already exact one.
        if movement < 0.05 || candidate_score.error + margin >= best_score.error {
            report["reason"] = json!("image_tie_or_worse");
            reports.push(report);
            continue;
        }
        if !recovery::preserves_constructed_coordinates(
            &solved.vertices_exact,
            &candidate.vertices_exact,
        ) {
            report["reason"] = json!("lost_exact_construction");
            reports.push(report);
            continue;
        }
        if clock.expired()
            || (clock.timeout_seconds >= 0.
                && clock.timeout_seconds - clock.elapsed_seconds() < reserve)
        {
            report["reason"] = json!("validation_budget");
            reports.push(report);
            break;
        }
        if let Some(mut judged) = recognition::judge_original(
            input,
            &candidate,
            options.options,
            clock,
            Rc::new(options.exempt_vertex_ids.clone()),
            Rc::new(options.pinned_vertex_ids.clone()),
        ) {
            judged.movement_report["termination"] = json!("source_image_recovery");
            report["adopted"] = json!(true);
            best_score = candidate_score;
            best_description = description;
            *solved = judged;
        } else {
            report["reason"] = json!("original_request_checks");
        }
        reports.push(report);
    }
    solved.movement_report["before_image_recovery"] = original_report;
    solved.movement_report["image_recovery"] = json!({"initial_score_px_squared":initial_score.error,"final_score_px_squared":best_score.error,"initial_raw_score_px_squared":initial_score.raw_error,"final_raw_score_px_squared":best_score.raw_error,"initial_raster_phase_pixels":initial_score.phase,"final_raster_phase_pixels":best_score.phase,"candidates":reports});
    solved.movement_report["elapsed_seconds"] = json!(clock.elapsed_seconds());
    solved.movement_report["work_spent"] = json!(clock.work.get());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image_evidence::SourceLineFit;
    use treemaker_fold::{Assignment, FoldDocument};

    fn stripe() -> ExactSolveInput {
        let mut fold = FoldDocument::new(
            vec![
                vec![0., 0.],
                vec![1., 0.],
                vec![1., 1.],
                vec![0., 1.],
                vec![0.386, 0.],
                vec![0.386, 1.],
            ],
            vec![[0, 4], [4, 1], [1, 2], [2, 5], [5, 3], [3, 0], [4, 5]],
        );
        fold.edges_assignment = vec![Assignment::Boundary; 6];
        fold.edges_assignment.push(Assignment::Mountain);
        let mut input = crate::exact_solve_input_from_fold(&fold).unwrap().0;
        let observed: Vec<_> = input.vertices.iter().map(|v| v.point).collect();
        let mut fitted = observed.clone();
        let span = input
            .selected_spans
            .iter()
            .find(|s| s.assignment_label() == AssignmentLabel::Mountain)
            .unwrap();
        for &v in &span.vertices {
            fitted[v].x = 5. / 13.;
        }
        input.image_evidence = Some(SourceImageEvidence {
            observed_vertices: observed,
            fitted_vertices: fitted,
            pixels_per_unit: 1024.,
            lines: vec![SourceLineFit {
                span_id: span.id,
                vertices: span.vertices,
                assignment: AssignmentLabel::Mountain,
                normal: Point2::new(1., 0.),
                rho: 5. / 13.,
                length_pixels: 1024.,
                sigma_pixels: 0.1,
            }],
        });
        input
    }

    fn options() -> ExactSolveOptionsWithExemptions {
        ExactSolveOptionsWithExemptions {
            options: ExactSolveOptions {
                construction_recovery: ConstructionRecoveryMode::Constructions,
                timeout_seconds: 5.,
                polish: true,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn source_evidence_selects_a_precise_alternative_and_preserves_topology() {
        let input = stripe();
        let options = options();
        let clock = ExactSolveDeadline::start(5., None);
        let mut solved = solve_with_recovery(&input, &options, &clock, 8.);
        assert_eq!(solved.status, ExactSolvedGraphStatus::Solved);
        // A different locally valid arrangement is not proof of the reference.
        // Source evidence chooses the independently specified 5/13 construction.
        for &v in &input.image_evidence.as_ref().unwrap().lines[0].vertices {
            solved.vertices_exact[v].x = 0.39;
        }
        let edges = solved.edges_exact.clone();
        refine(&input, &mut solved, &options, &clock);
        assert_eq!(solved.status, ExactSolvedGraphStatus::Solved);
        assert_eq!(solved.edges_exact, edges);
        assert!(solved.merged_vertices.is_empty());
        assert_eq!(
            solved.movement_report["termination"],
            "source_image_recovery"
        );
        for &v in &input.image_evidence.as_ref().unwrap().lines[0].vertices {
            assert!(
                (solved.vertices_exact[v].x - 5. / 13.).abs() < 1e-12,
                "{:?}",
                solved.vertices_exact
            );
        }
        for &v in &input.boundary.corners {
            assert_eq!(solved.vertices_exact[v], input.vertices[v].point);
        }
    }

    #[test]
    fn raster_phase_is_scored_separately_without_moving_the_graph() {
        let input = stripe();
        let mut evidence = input.image_evidence.unwrap();
        evidence.pixels_per_unit = 128.;
        evidence.lines[0].rho = 0.386 - 0.5 / 128.;
        let points = evidence.observed_vertices.clone();
        let aligned = score(&evidence, &points);
        assert!((aligned.raw_error - 0.25).abs() < 1e-12);
        assert!(aligned.error < 1e-12);
        assert!((aligned.phase.x - 0.5).abs() < 1e-12);
        assert_eq!(points, evidence.observed_vertices);
        evidence.lines[0].rho = 0.386 - 1. / 128.;
        assert!(score(&evidence, &points).error > 0.24);
    }

    #[test]
    fn a_simpler_but_weakly_supported_construction_does_not_displace_an_existing_one() {
        let mut input = stripe();
        let ids = input.image_evidence.as_ref().unwrap().lines[0].vertices;
        for &v in &ids {
            input.vertices[v].point.x = 0.502;
        }
        let evidence = input.image_evidence.as_mut().unwrap();
        evidence.observed_vertices = input.vertices.iter().map(|v| v.point).collect();
        evidence.fitted_vertices = evidence.observed_vertices.clone();
        for &v in &ids {
            evidence.fitted_vertices[v].x = 0.5;
        }
        evidence.pixels_per_unit = 128.;
        evidence.lines[0].rho = 0.5;
        evidence.lines[0].length_pixels = 128.;
        recognition::refresh_carriers(&mut input);
        let options = options();
        let clock = ExactSolveDeadline::start(5., None);
        let mut solved = solve_with_recovery(&input, &options, &clock, 8.);
        for &v in &ids {
            solved.vertices_exact[v].x = 128. / 255.;
        }
        let before = solved.vertices_exact.clone();
        refine(&input, &mut solved, &options, &clock);
        assert_eq!(solved.vertices_exact, before);
        let candidates = solved.movement_report["image_recovery"]["candidates"]
            .as_array()
            .unwrap();
        assert!(
            candidates
                .iter()
                .any(|c| c["reason"] == "image_tie_or_worse")
        );
    }

    #[test]
    fn edits_and_invalid_or_duplicate_measurements_invalidate_evidence() {
        let input = stripe();
        let evidence = input.image_evidence.as_ref().unwrap();
        assert!(usable(&input, evidence));
        let mut edited = input.clone();
        edited.vertices[4].point.x += 0.001;
        assert!(!usable(&edited, evidence));
        edited = input.clone();
        edited.selected_spans[6].assignment_evidence.observed_label = AssignmentLabel::Valley;
        assert!(!usable(&edited, evidence));
        let mut bad = evidence.clone();
        bad.lines.push(bad.lines[0].clone());
        assert!(!usable(&input, &bad));
        bad = evidence.clone();
        bad.lines[0].normal.x = f64::NAN;
        assert!(!usable(&input, &bad));
    }

    #[test]
    fn image_proposals_do_not_override_pins_or_spend_an_exhausted_budget() {
        let input = stripe();
        let mut options = options();
        options
            .pinned_vertex_ids
            .extend(input.image_evidence.as_ref().unwrap().lines[0].vertices);
        let pinned = solve_exact_with_exemptions(&input, &options);
        for &v in &options.pinned_vertex_ids {
            assert_eq!(pinned.vertices_exact[v], input.vertices[v].point);
        }
        let mut baseline = pinned.clone();
        refine(
            &input,
            &mut baseline,
            &options,
            &ExactSolveDeadline::start(0., None),
        );
        assert_eq!(baseline.vertices_exact, pinned.vertices_exact);
        assert_eq!(baseline.movement_report, pinned.movement_report);
    }

    #[test]
    fn old_inputs_omit_optional_image_evidence() {
        let mut input = stripe();
        input.image_evidence = None;
        let value = serde_json::to_value(&input).unwrap();
        assert!(value.get("image_evidence").is_none());
        let old: ExactSolveInput = serde_json::from_value(value).unwrap();
        assert!(old.image_evidence.is_none());
    }

    #[test]
    fn raster_fit_cannot_replace_a_construction_with_a_free_subpixel_offset() {
        let exact = vec![Point2::new(2_f64.sqrt() / 4., 0.5)];
        let shifted = vec![Point2::new(exact[0].x + 0.0005, 0.5)];
        assert!(!recovery::preserves_constructed_coordinates(
            &exact, &shifted
        ));
        assert!(recovery::preserves_constructed_coordinates(
            &shifted, &exact
        ));
        assert!(recovery::preserves_constructed_coordinates(
            &exact,
            &[Point2::new(5. / 13., 0.5)]
        ));
    }
}
