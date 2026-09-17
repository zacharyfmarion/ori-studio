//! Infer exact geometric constructions from an accepted nearby solution.
//! Reference geometry never enters this module. The original request remains
//! the source of pins, topology, movement limits, and the shared deadline.
use super::projection::{Row, least_norm_at_precision};
use super::*;

mod carriers;
mod constructions;
pub(super) use constructions::description_cost;

/// Image measurements may choose between constructions, but must not turn an
/// already precise construction into a free coordinate just to fit raster ink.
pub(super) fn preserves_constructed_coordinates(before: &[Point2], after: &[Point2]) -> bool {
    before.iter().zip(after).all(|(a, b)| {
        [(a.x, b.x), (a.y, b.y)].into_iter().all(|(old, new)| {
            constructions::recognized_coordinate(old).is_none()
                || constructions::recognized_coordinate(new).is_some()
        })
    })
}
mod nonlinear;

struct LinearGeometry {
    rows: Vec<Row>,
    variables: Vec<(usize, usize)>,
}

fn get(point: Point2, axis: usize) -> f64 {
    if axis == 0 { point.x } else { point.y }
}

fn set(point: &mut Point2, axis: usize, value: f64) {
    if axis == 0 {
        point.x = value;
    } else {
        point.y = value;
    }
}

fn linear_geometry(
    input: &ExactSolveInput,
    points: &[Point2],
    pinned: &BTreeSet<usize>,
    symmetries: &[DetectedSymmetry],
) -> LinearGeometry {
    let mut variables = Vec::new();
    let mut indices = vec![[None; 2]; points.len()];
    let mut used = vec![false; points.len()];
    for span in &input.selected_spans {
        for v in span.vertices {
            used[v] = true;
        }
    }
    for vertex in &input.vertices {
        if !used[vertex.id]
            || vertex.movement_policy == CandidateVertexMovementPolicy::Locked
            || pinned.contains(&vertex.id)
            || input.boundary.corners.contains(&vertex.id)
        {
            continue;
        }
        for (axis, index) in indices[vertex.id].iter_mut().enumerate() {
            let boundary_fixed = matches!(
                (vertex.boundary_side, axis),
                (Some(BoundarySide::Top | BoundarySide::Bottom), 1)
                    | (Some(BoundarySide::Left | BoundarySide::Right), 0)
            );
            if !boundary_fixed {
                *index = Some(variables.len());
                variables.push((vertex.id, axis));
            }
        }
    }
    let mut rows = Vec::new();
    for span in &input.selected_spans {
        let [a, b] = span.vertices;
        let delta = Point2::new(points[b].x - points[a].x, points[b].y - points[a].y);
        let length = delta.x.hypot(delta.y);
        if length < 1e-12 {
            continue;
        }
        let angle = delta.y.atan2(delta.x);
        // Preserve already-recognized half-angle and 15-degree constructions,
        // too. Omitting them creates false degrees of freedom downstream.
        let theta = [8., 16., 12.]
            .into_iter()
            .map(|divisor| {
                let step = std::f64::consts::PI / divisor;
                (angle / step).round() * step
            })
            .min_by(|a, b| {
                (a.cos() * delta.y - a.sin() * delta.x)
                    .abs()
                    .total_cmp(&(b.cos() * delta.y - b.sin() * delta.x).abs())
            })
            .unwrap_or(angle);
        let mut dx = theta.cos();
        let mut dy = theta.sin();
        if dx.abs() < 1e-15 {
            dx = 0.;
        }
        if dy.abs() < 1e-15 {
            dy = 0.;
        }
        if (dx * delta.y - dy * delta.x).abs() > 1e-6 * length {
            continue;
        }
        let mut entries = Vec::new();
        let mut rhs = 0.;
        for (vertex, axis, coefficient) in [(a, 0, -dy), (a, 1, dx), (b, 0, dy), (b, 1, -dx)] {
            if let Some(column) = indices[vertex][axis] {
                entries.push((column, coefficient));
            } else {
                rhs -= coefficient * get(points[vertex], axis);
            }
        }
        rows.push(Row { entries, rhs });
    }
    for symmetry in symmetries {
        if mirror_error(symmetry, points) > 1e-7 {
            continue;
        }
        let matrix = symmetry.axis.reflection_matrix();
        let offset = symmetry.axis.reflect(Point2::new(0., 0.));
        for [a, b] in symmetry
            .pairs
            .iter()
            .copied()
            .chain(symmetry.on_axis.iter().map(|&v| [v, v]))
        {
            for (axis, row) in matrix.iter().enumerate() {
                let mut coefficients = BTreeMap::new();
                let mut rhs = -get(offset, axis);
                for (v, d, c) in [(a, 0, row[0]), (a, 1, row[1]), (b, axis, -1.)] {
                    if let Some(column) = indices[v][d] {
                        *coefficients.entry(column).or_insert(0.) += c;
                    } else {
                        rhs -= c * get(points[v], d);
                    }
                }
                rows.push(Row {
                    entries: coefficients.into_iter().filter(|(_, v)| *v != 0.).collect(),
                    rhs,
                });
            }
        }
    }
    LinearGeometry { rows, variables }
}

fn precision_proposal(
    geometry: &LinearGeometry,
    points: &[Point2],
    clock: &ExactSolveDeadline,
) -> Option<(Vec<Point2>, Value)> {
    let mut x: Vec<f64> = geometry
        .variables
        .iter()
        .map(|&(v, a)| get(points[v], a))
        .collect();
    let mut iterations = 0;
    for _ in 0..3 {
        if clock.expired() {
            return None;
        }
        let rows: Vec<Row> = geometry
            .rows
            .iter()
            .map(|r| Row {
                entries: r.entries.clone(),
                rhs: r.rhs - r.entries.iter().map(|&(c, v)| v * x[c]).sum::<f64>(),
            })
            .collect();
        if rows.iter().all(|r| r.rhs.abs() < 4e-16) {
            break;
        }
        let (correction, count) = least_norm_at_precision(&rows, x.len(), clock, true)?;
        iterations += count;
        for (value, step) in x.iter_mut().zip(correction) {
            *value += step;
        }
    }
    let mut candidate = points.to_vec();
    for (&(v, axis), value) in geometry.variables.iter().zip(x) {
        set(&mut candidate[v], axis, value);
    }
    let movement = points
        .iter()
        .zip(&candidate)
        .map(|(&a, &b)| distance(a, b))
        .fold(0., f64::max);
    if movement > 1e-5
        || candidate
            .iter()
            .any(|p| !p.x.is_finite() || !p.y.is_finite())
    {
        return None;
    }
    Some((
        candidate,
        json!({"equations":geometry.rows.len(),"iterations":iterations,"max_movement":movement}),
    ))
}

pub(super) fn refine(
    input: &ExactSolveInput,
    solved: &mut ExactSolvedGraph,
    options: ExactSolveOptions,
    clock: &ExactSolveDeadline,
    exempt: Rc<BTreeSet<usize>>,
    pinned: Rc<BTreeSet<usize>>,
    observation_weight: f64,
) {
    if options.construction_recovery == ConstructionRecoveryMode::Off
        || options.angle_family == AngleFamilyMode::Off
        || solved.status != ExactSolvedGraphStatus::Solved
        || solved.movement_report["accepted"] != true
        || !solved.merged_vertices.is_empty()
        || is_polygon_boundary(input)
        || clock.expired()
    {
        return;
    }
    clock
        .work
        .set(solved.movement_report["work_spent"].as_u64().unwrap_or(0));
    let original_report = solved.movement_report.clone();
    let symmetries: Vec<DetectedSymmetry> = original_report["symmetry"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|value| value["held"] == true)
        .filter_map(|value| serde_json::from_value(value.clone()).ok())
        .collect();
    let recovery = Recovery {
        input,
        options,
        clock,
        exempt,
        pinned,
    };
    let mut reports = Vec::new();
    if let Some(proposal_clock) = recovery.proposal_clock() {
        let geometry =
            linear_geometry(input, &solved.vertices_exact, &recovery.pinned, &symmetries);
        if let Some((points, mut report)) =
            precision_proposal(&geometry, &solved.vertices_exact, &proposal_clock)
        {
            report["method"] = json!("direction_precision");
            recovery.adopt(solved, points, &mut report);
            reports.push(report);
        }
    }
    if options.construction_recovery == ConstructionRecoveryMode::Constructions {
        let mut linear_rejected = false;
        if let Some(proposal_clock) = recovery.proposal_clock() {
            let geometry =
                linear_geometry(input, &solved.vertices_exact, &recovery.pinned, &symmetries);
            if let Some((points, mut report)) = constructions::joint_proposal(
                &geometry,
                input,
                &solved.vertices_exact,
                &proposal_clock,
                observation_weight,
            ) {
                recovery.adopt(solved, points, &mut report);
                linear_rejected = report["reason"] == "original_request_checks";
                reports.push(report);
            }
        }
        if linear_rejected && let Some(proposal_clock) = recovery.proposal_clock() {
            let geometry =
                linear_geometry(input, &solved.vertices_exact, &recovery.pinned, &symmetries);
            let mut augmented = LinearGeometry {
                rows: geometry.rows.clone(),
                variables: geometry.variables.clone(),
            };
            nonlinear::augment(&mut augmented, input, &solved.vertices_exact);
            if let Some((points, mut report)) = constructions::joint_proposal(
                &augmented,
                input,
                &solved.vertices_exact,
                &proposal_clock,
                observation_weight * 0.25,
            ) && let Some((points, polish)) =
                nonlinear::polish(&geometry, input, &points, &proposal_clock)
            {
                report["method"] = json!("nonlinear_construction_anchors");
                report["polish"] = polish;
                recovery.adopt(solved, points, &mut report);
                reports.push(report);
            }
        }
        for attempt in [
            constructions::Attempt::Coordinates,
            constructions::Attempt::FreeCoordinates,
            constructions::Attempt::IndependentAnchors,
            constructions::Attempt::AlgebraicPrecision,
            constructions::Attempt::SupportedGrid,
        ] {
            let Some(proposal_clock) = recovery.proposal_clock() else {
                break;
            };
            let geometry =
                linear_geometry(input, &solved.vertices_exact, &recovery.pinned, &symmetries);
            if let Some((points, mut report)) =
                constructions::propose(&geometry, &solved.vertices_exact, &proposal_clock, attempt)
            {
                recovery.adopt(solved, points, &mut report);
                reports.push(report);
            }
        }
        if let Some(proposal_clock) = recovery.proposal_clock() {
            let mut geometry =
                linear_geometry(input, &solved.vertices_exact, &recovery.pinned, &symmetries);
            if let Some(count) = carriers::augment(
                &mut geometry,
                input,
                &solved.vertices_exact,
                &proposal_clock,
            ) && count > 0
                && let Some((points, mut report)) =
                    precision_proposal(&geometry, &solved.vertices_exact, &proposal_clock)
            {
                report["method"] = json!("seeded_carrier_precision");
                report["carriers"] = json!(count);
                recovery.adopt(solved, points, &mut report);
                reports.push(report);
            }
        }
        for attempt in [
            constructions::Attempt::RicherAnchors,
            constructions::Attempt::WiderAnchors,
            constructions::Attempt::AlgebraicPrecision,
        ] {
            let Some(proposal_clock) = recovery.proposal_clock() else {
                break;
            };
            let geometry =
                linear_geometry(input, &solved.vertices_exact, &recovery.pinned, &symmetries);
            if let Some((points, mut report)) =
                constructions::propose(&geometry, &solved.vertices_exact, &proposal_clock, attempt)
            {
                recovery.adopt(solved, points, &mut report);
                reports.push(report);
            }
        }
    }
    solved.movement_report["before_construction_recovery"] = original_report;
    solved.movement_report["construction_recovery"] = json!({"stages":reports});
    solved.movement_report["elapsed_seconds"] = json!(clock.elapsed_seconds());
    solved.movement_report["work_spent"] = json!(clock.work.get());
}

struct Recovery<'a> {
    input: &'a ExactSolveInput,
    options: ExactSolveOptions,
    clock: &'a ExactSolveDeadline,
    exempt: Rc<BTreeSet<usize>>,
    pinned: Rc<BTreeSet<usize>>,
}

impl Recovery<'_> {
    fn validation_reserve(&self) -> f64 {
        // Graph checks include pairwise geometry work. Reserve that work before
        // beginning another proposal; timeout must not invalidate a good solve.
        let n = self.input.vertices.len() as f64;
        0.5 + n * n * 1e-7
    }

    fn proposal_clock(&self) -> Option<ExactSolveDeadline> {
        if self.clock.expired() {
            return None;
        }
        let remaining = if self.clock.timeout_seconds < 0. {
            5.
        } else {
            self.clock.timeout_seconds - self.clock.elapsed_seconds() - self.validation_reserve()
        };
        (remaining > 0.1).then(|| {
            self.clock.for_round(RoundAllowance {
                seconds: Some(remaining.min(4.)),
                work: None,
            })
        })
    }

    fn adopt(&self, solved: &mut ExactSolvedGraph, points: Vec<Point2>, report: &mut Value) {
        report["adopted"] = json!(false);
        if points
            .iter()
            .zip(&solved.vertices_exact)
            .all(|(&a, &b)| distance(a, b) < 1e-14)
        {
            report["reason"] = json!("unchanged");
            return;
        }
        if self.clock.expired()
            || (self.clock.timeout_seconds >= 0.
                && self.clock.timeout_seconds - self.clock.elapsed_seconds()
                    < self.validation_reserve())
        {
            report["reason"] = json!("validation_budget");
            return;
        }
        let mut candidate = solved.clone();
        candidate.vertices_exact = points;
        // Keep the pre-recovery report once, not recursively in every proposal.
        candidate.movement_report = json!({"construction_proposal":report});
        if let Some(mut judged) = recognition::judge_original(
            self.input,
            &candidate,
            self.options,
            self.clock,
            Rc::clone(&self.exempt),
            Rc::clone(&self.pinned),
        ) {
            report["adopted"] = json!(true);
            judged.movement_report["termination"] = json!("construction_recovery");
            *solved = judged;
        } else {
            report["reason"] = json!("original_request_checks");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square_fan() -> ExactSolveInput {
        let fold: treemaker_fold::FoldDocument = serde_json::from_value(json!({
            "vertices_coords": [[0.,0.],[1.,0.],[1.,1.],[0.,1.],[0.5,0.5]],
            "edges_vertices": [[0,1],[1,2],[2,3],[3,0],[0,4],[1,4],[2,4],[3,4]],
            "edges_assignment": ["B","B","B","B","M","M","M","V"]
        }))
        .unwrap();
        crate::exact_solve_input_from_fold(&fold).unwrap().0
    }

    fn cross_with_auxiliary(t: f64) -> ExactSolveInput {
        let fold: treemaker_fold::FoldDocument = serde_json::from_value(json!({
            "vertices_coords": [[0.,0.],[1.,0.],[1.,1.],[0.,1.],
                [t,0.],[1.,0.5],[t,1.],[0.,0.5],[t,0.5],
                [0.,0.25],[1.,0.25],[t,0.25]],
            "edges_vertices": [[0,4],[4,1],[1,10],[10,5],[5,2],[2,6],
                [6,3],[3,7],[7,9],[9,0],[4,11],[11,8],[8,6],[7,8],[8,5],[9,11],[11,10]],
            "edges_assignment": ["B","B","B","B","B","B","B","B","B","B",
                "M","M","M","M","V","F","F"]
        }))
        .unwrap();
        crate::exact_solve_input_from_fold(&fold).unwrap().0
    }

    #[test]
    fn construction_recovery_moves_auxiliary_junctions_with_their_carrier() {
        let target = 2_f64.sqrt() - 1.;
        let input = cross_with_auxiliary(target + 8e-5);
        let solved = solve_exact(
            &input,
            ExactSolveOptions {
                construction_recovery: ConstructionRecoveryMode::Constructions,
                ..ExactSolveOptions::default()
            },
        );
        assert_eq!(solved.status, ExactSolvedGraphStatus::Solved);
        assert_eq!(solved.movement_report["accepted"], true);
        assert_eq!(solved.edges_exact.len(), input.selected_spans.len());
        for v in [4, 6, 8, 11] {
            assert!(
                (solved.vertices_exact[v].x - target).abs() < 1e-12,
                "vertex {v}: {:?}",
                solved.vertices_exact[v]
            );
        }
        assert!((solved.vertices_exact[11].y - 0.25).abs() < 1e-12);
    }

    #[test]
    fn recovery_preserves_an_existing_exact_free_construction() {
        for target in [3. / 44., (20. + 2_f64.sqrt()) / 64.] {
            let input = cross_with_auxiliary(target);
            let solved = solve_exact(
                &input,
                ExactSolveOptions {
                    construction_recovery: ConstructionRecoveryMode::Constructions,
                    ..ExactSolveOptions::default()
                },
            );
            assert_eq!(solved.status, ExactSolvedGraphStatus::Solved);
            for vertex in &input.vertices {
                assert!(distance(solved.vertices_exact[vertex.id], vertex.point) < 1e-12);
            }
        }
    }

    #[test]
    fn a_non_family_carrier_is_determined_by_its_recognized_endpoints() {
        let mut input = cross_with_auxiliary(0.37);
        // Use the AUX chain as a non-family line with exact rational endpoints.
        input.vertices[9].point = Point2::new(0., 0.25);
        input.vertices[10].point = Point2::new(1., 0.75);
        input.vertices[11].point = Point2::new(0.37, 0.435 + 1e-9);
        let points: Vec<_> = input.vertices.iter().map(|v| v.point).collect();
        let mut geometry = linear_geometry(&input, &points, &BTreeSet::new(), &[]);
        let clock = ExactSolveDeadline::start(1., None);
        assert!(carriers::augment(&mut geometry, &input, &points, &clock).unwrap() > 0);
        let (answer, _) = precision_proposal(&geometry, &points, &clock).unwrap();
        assert!((answer[11].y - (0.25 + answer[11].x / 2.)).abs() < 1e-13);
    }

    #[test]
    fn direction_equations_recover_an_anchored_intersection_at_numerical_precision() {
        let input = square_fan();
        let mut points: Vec<_> = input.vertices.iter().map(|v| v.point).collect();
        points[4] = Point2::new(0.5 + 4e-10, 0.5 - 3e-10);
        let geometry = linear_geometry(&input, &points, &BTreeSet::new(), &[]);
        let (recovered, _) =
            precision_proposal(&geometry, &points, &ExactSolveDeadline::start(1., None)).unwrap();
        assert!(distance(recovered[4], Point2::new(0.5, 0.5)) < 1e-14);
        assert_eq!(&recovered[..4], &points[..4]);
    }

    #[test]
    fn a_user_pin_is_not_a_precision_variable() {
        let input = square_fan();
        let mut points: Vec<_> = input.vertices.iter().map(|v| v.point).collect();
        points[4] = Point2::new(0.5 + 4e-10, 0.5 - 3e-10);
        let geometry = linear_geometry(&input, &points, &BTreeSet::from([4]), &[]);
        assert!(geometry.variables.is_empty());
        let (recovered, _) =
            precision_proposal(&geometry, &points, &ExactSolveDeadline::start(1., None)).unwrap();
        assert_eq!(recovered, points);
    }

    #[test]
    fn full_recovery_respects_a_user_pin_on_a_free_construction() {
        let input = cross_with_auxiliary(2_f64.sqrt() - 1. + 8e-5);
        let options = ExactSolveOptionsWithExemptions {
            options: ExactSolveOptions {
                construction_recovery: ConstructionRecoveryMode::Constructions,
                ..ExactSolveOptions::default()
            },
            pinned_vertex_ids: BTreeSet::from([4]),
            exempt_vertex_ids: BTreeSet::new(),
        };
        let solved = solve_exact_with_exemptions(&input, &options);
        assert_eq!(solved.status, ExactSolvedGraphStatus::Solved);
        assert_eq!(solved.vertices_exact[4], input.vertices[4].point);
        assert!((solved.vertices_exact[11].x - input.vertices[4].point.x).abs() < 1e-12);
    }

    #[test]
    fn half_angle_directions_are_not_lost_from_the_linear_model() {
        let mut input = cross_with_auxiliary(0.3);
        let slope = (std::f64::consts::PI / 16.).tan();
        input.vertices[9].point = Point2::new(0., 0.2);
        input.vertices[10].point = Point2::new(1., 0.2 + slope);
        input.vertices[11].point = Point2::new(0.3, 0.2 + 0.3 * slope + 1e-9);
        let points: Vec<_> = input.vertices.iter().map(|v| v.point).collect();
        let geometry = linear_geometry(&input, &points, &BTreeSet::from([9, 10]), &[]);
        let (answer, _) =
            precision_proposal(&geometry, &points, &ExactSolveDeadline::start(1., None)).unwrap();
        assert!((answer[11].y - (0.2 + answer[11].x * slope)).abs() < 1e-13);
    }

    #[test]
    fn held_symmetry_constrains_an_otherwise_free_coordinate() {
        let input = square_fan();
        let mut points: Vec<_> = input.vertices.iter().map(|v| v.point).collect();
        points[4] = Point2::new(0.5 + 4e-8, 0.41);
        let symmetry = DetectedSymmetry {
            axis: crate::symmetry::SymmetryAxis::Vertical,
            pairs: Vec::new(),
            on_axis: vec![4],
            vertex_fraction: 1.,
            crease_fraction: 1.,
        };
        let geometry = linear_geometry(&input, &points, &BTreeSet::new(), &[symmetry]);
        let (answer, _) =
            precision_proposal(&geometry, &points, &ExactSolveDeadline::start(1., None)).unwrap();
        assert!((answer[4].x - 0.5).abs() < 1e-14);
        assert_eq!(answer[4].y, points[4].y);
    }

    #[test]
    fn precision_does_not_invent_a_far_away_direction_family() {
        let input = square_fan();
        let mut points: Vec<_> = input.vertices.iter().map(|v| v.point).collect();
        points[4] = Point2::new(0.47, 0.54);
        let geometry = linear_geometry(&input, &points, &BTreeSet::new(), &[]);
        let (recovered, _) =
            precision_proposal(&geometry, &points, &ExactSolveDeadline::start(1., None)).unwrap();
        assert_eq!(recovered, points);
    }

    #[test]
    fn precision_obeys_an_expired_budget() {
        let input = square_fan();
        let points: Vec<_> = input.vertices.iter().map(|v| v.point).collect();
        let geometry = linear_geometry(&input, &points, &BTreeSet::new(), &[]);
        assert!(
            precision_proposal(&geometry, &points, &ExactSolveDeadline::start(0., None)).is_none()
        );
    }
}
