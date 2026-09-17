//! Direct-coordinate feasibility projection. No carrier unknowns or soft
//! theorem penalties: each Newton step solves J dx = -c for a small displacement.
//! Local crimp ties express the ordering needed by the existing CAMV checker.
//! These are proposals; the ordinary geometry/checker acceptance stays decisive.
use super::*;
use std::f64::consts::PI;

#[derive(Clone)]
pub(super) struct Fan {
    pub(super) center: usize,
    pub(super) neighbors: Vec<usize>,
    colors: Vec<AssignmentLabel>,
    pub(super) boundary: bool,
}

#[derive(Clone)]
struct Relation {
    fan: usize,
    coefficients: Vec<f64>,
    constant: f64,
}

#[derive(Clone)]
struct Sector {
    coefficients: Vec<f64>,
    constant: f64,
}

impl Sector {
    fn value(&self, angles: &[f64]) -> f64 {
        self.constant
            + self
                .coefficients
                .iter()
                .zip(angles)
                .map(|(a, b)| a * b)
                .sum::<f64>()
    }
    fn difference(&self, other: &Self) -> Self {
        Self {
            coefficients: self
                .coefficients
                .iter()
                .zip(&other.coefficients)
                .map(|(a, b)| a - b)
                .collect(),
            constant: self.constant - other.constant,
        }
    }
    fn plus(&self, other: &Self) -> Self {
        Self {
            coefficients: self
                .coefficients
                .iter()
                .zip(&other.coefficients)
                .map(|(a, b)| a + b)
                .collect(),
            constant: self.constant + other.constant,
        }
    }
}

pub(super) fn fans(input: &ExactSolveInput, points: &[Point2]) -> Vec<Fan> {
    let mut adjacent = vec![Vec::new(); points.len()];
    for span in &input.selected_spans {
        if !is_fold_span(span) && !is_boundary_like_span(span) {
            continue;
        }
        let [a, b] = span.vertices;
        adjacent[a].push((b, span.assignment_label()));
        adjacent[b].push((a, span.assignment_label()));
    }
    adjacent
        .into_iter()
        .enumerate()
        .filter_map(|(center, mut rays)| {
            if rays.len() < 2 {
                return None;
            }
            rays.sort_by(|(a, _), (b, _)| {
                angle_radians(points[center], points[*a])
                    .total_cmp(&angle_radians(points[center], points[*b]))
            });
            let boundary = rays.iter().any(|(_, c)| *c == AssignmentLabel::Boundary);
            Some(Fan {
                center,
                neighbors: rays.iter().map(|(v, _)| *v).collect(),
                colors: rays.iter().map(|(_, c)| *c).collect(),
                boundary,
            })
        })
        .collect()
}

fn angles(fan: &Fan, points: &[Point2]) -> Vec<f64> {
    fan.neighbors
        .iter()
        .map(|&v| angle_radians(points[fan.center], points[v]))
        .collect()
}

/// Mirror the crimp *relations*, not the checker verdict. At an illegal step,
/// bring the closest opposite-assignment sector to the current minimum. A tie
/// is admissible; shrinking the residual without reaching the tie is not.
fn propose_ties(fan: &Fan, bearings: &[f64]) -> Vec<Sector> {
    let n = bearings.len();
    if fan.colors.iter().any(|c| {
        !matches!(
            c,
            AssignmentLabel::Mountain | AssignmentLabel::Valley | AssignmentLabel::Boundary
        )
    }) {
        return Vec::new();
    }
    let mut sectors: Vec<Sector> = (0..n)
        .map(|i| {
            let next = (i + 1) % n;
            let mut coefficients = vec![0.; n];
            coefficients[i] = -1.;
            coefficients[next] = 1.;
            let raw = bearings[next] - bearings[i];
            Sector {
                coefficients,
                constant: raw.rem_euclid(TAU) - raw,
            }
        })
        .collect();
    let mut colors = fan.colors.clone();
    if fan.boundary {
        // Cut the fan across the exterior sector between the two boundary
        // rays. An open fan may crimp at either end without an assignment pair.
        let Some(cut) = (0..n).find(|&i| {
            colors[i] == AssignmentLabel::Boundary
                && colors[(i + 1) % n] == AssignmentLabel::Boundary
        }) else {
            return Vec::new();
        };
        colors.rotate_left((cut + 1) % n);
        sectors.rotate_left((cut + 1) % n);
        sectors.pop();
    }
    let mut ties = Vec::new();
    while colors.len() > 2 {
        let values: Vec<f64> = sectors.iter().map(|s| s.value(bearings)).collect();
        let Some(smallest) = (0..values.len()).min_by(|&a, &b| values[a].total_cmp(&values[b]))
        else {
            break;
        };
        let eligible = |i: usize| {
            (fan.boundary && (i == 0 || i + 1 == sectors.len()))
                || colors[i] != colors[(i + 1) % colors.len()]
        };
        let Some(selected) = (0..values.len())
            .filter(|&i| eligible(i))
            .min_by(|&a, &b| values[a].total_cmp(&values[b]))
        else {
            break;
        };
        if values[selected] > values[smallest] + 1e-10 {
            ties.push(sectors[selected].difference(&sectors[smallest]));
        }
        if fan.boundary && selected == 0 {
            colors.remove(0);
            sectors.remove(0);
            continue;
        }
        if fan.boundary && selected + 1 == sectors.len() {
            colors.pop();
            sectors.pop();
            continue;
        }
        if fan.boundary {
            let merged = sectors[selected - 1]
                .difference(&sectors[selected])
                .plus(&sectors[selected + 1]);
            sectors.splice(selected - 1..=selected + 1, [merged]);
            colors.drain(selected..=selected + 1);
        } else {
            colors.rotate_left(selected);
            sectors.rotate_left(selected);
            let merged = sectors[sectors.len() - 1]
                .difference(&sectors[0])
                .plus(&sectors[1]);
            colors.drain(0..2);
            sectors.drain(0..2);
            sectors.pop();
            sectors.push(merged);
        }
    }
    ties
}

#[derive(Clone)]
pub(super) struct Row {
    pub(super) entries: Vec<(usize, f64)>,
    pub(super) rhs: f64,
}

fn row(
    model: &SolveModel,
    params: &OVector<f64, Dyn>,
    points: &[Point2],
    rays: &[(usize, usize, f64)],
    residual: f64,
) -> Row {
    let mut entries = Vec::new();
    for &(a, b, scale) in rays {
        model.add_angle_derivative(
            &mut |_, c, v| entries.push((c, v)),
            0,
            a,
            b,
            scale,
            points,
            params,
        );
    }
    entries.sort_unstable_by_key(|(c, _)| *c);
    let mut summed: Vec<(usize, f64)> = Vec::new();
    for (c, v) in entries {
        if let Some(last) = summed.last_mut().filter(|last| last.0 == c) {
            last.1 += v;
        } else {
            summed.push((c, v));
        }
    }
    summed.retain(|(_, v)| v.abs() > 1e-14);
    let norm = summed
        .iter()
        .map(|(_, v)| v * v)
        .sum::<f64>()
        .sqrt()
        .max(1e-12);
    for (_, v) in &mut summed {
        *v /= norm;
    }
    Row {
        entries: summed,
        rhs: -residual / norm,
    }
}

fn norm(v: &[f64]) -> f64 {
    v.iter().map(|x| x * x).sum::<f64>().sqrt()
}
fn normalize(v: &mut [f64]) -> f64 {
    let length = norm(v);
    if length > 0. {
        for x in v {
            *x /= length;
        }
    }
    length
}
fn multiply(rows: &[Row], x: &[f64], out: &mut [f64]) {
    for (r, y) in rows.iter().zip(out) {
        *y = r.entries.iter().map(|&(c, v)| v * x[c]).sum();
    }
}
fn transpose(rows: &[Row], x: &[f64], out: &mut [f64]) {
    out.fill(0.);
    for (r, &x) in rows.iter().zip(x) {
        for &(c, v) in &r.entries {
            out[c] += v * x;
        }
    }
}

/// Golub-Kahan LSQR recurrence (Paige/Saunders). Minimum-length corrections
/// avoid a dense factorization and work for dependent constraint rows. Reference:
/// https://web.stanford.edu/group/SOL/software/lsqr/ . Independent implementation.
fn least_norm(rows: &[Row], n: usize, clock: &ExactSolveDeadline) -> Option<(Vec<f64>, usize)> {
    least_norm_at_precision(rows, n, clock, false)
}

pub(super) fn least_norm_at_precision(
    rows: &[Row],
    n: usize,
    clock: &ExactSolveDeadline,
    precision: bool,
) -> Option<(Vec<f64>, usize)> {
    // Regularize the step, not the geometry. This bounds roundoff in the
    // numerical null space of redundant angle/collinearity equations. Newton
    // relinearizes from the new point, so no residual tolerance is relaxed.
    let mut regularized = rows.to_vec();
    regularized.extend((0..n).map(|i| Row {
        entries: vec![(i, if precision { 1e-10 } else { 1e-6 })],
        rhs: 0.,
    }));
    let rows = regularized.as_slice();
    let mut u: Vec<f64> = rows.iter().map(|r| r.rhs).collect();
    let initial = normalize(&mut u);
    let mut v = vec![0.; n];
    transpose(rows, &u, &mut v);
    let mut alpha = normalize(&mut v);
    let initial_normal_residual = alpha * initial;
    let mut w = v.clone();
    let mut x = vec![0.; n];
    let mut rhobar = alpha;
    let mut phibar = initial;
    let mut next_u = vec![0.; rows.len()];
    let mut next_v = vec![0.; n];
    let mut residual = vec![0.; rows.len()];
    let mut normal_residual = vec![0.; n];
    if initial == 0. || alpha == 0. {
        return Some((x, 0));
    }
    for iteration in 0..3000 {
        if iteration % 16 == 0 && clock.expired() {
            return None;
        }
        multiply(rows, &v, &mut next_u);
        for (next, old) in next_u.iter_mut().zip(&u) {
            *next -= alpha * old;
        }
        let beta = normalize(&mut next_u);
        std::mem::swap(&mut next_u, &mut u);
        transpose(rows, &u, &mut next_v);
        for (next, old) in next_v.iter_mut().zip(&v) {
            *next -= beta * old;
        }
        alpha = normalize(&mut next_v);
        std::mem::swap(&mut next_v, &mut v);
        let rho = rhobar.hypot(beta);
        if rho == 0. || !rho.is_finite() {
            return None;
        }
        let c = rhobar / rho;
        let s = beta / rho;
        let theta = s * alpha;
        rhobar = -c * alpha;
        let phi = c * phibar;
        phibar *= s;
        for i in 0..n {
            x[i] += phi / rho * w[i];
            w[i] = v[i] - theta / rho * w[i];
        }
        // An inconsistent/rank-deficient system has a nonzero residual floor.
        // Stop on the normal residual as well; chasing that floor otherwise
        // grows a spurious null-space displacement after numerical breakdown.
        if iteration % 16 == 15 {
            multiply(rows, &x, &mut residual);
            for (r, row) in residual.iter_mut().zip(rows) {
                *r -= row.rhs;
            }
            transpose(rows, &residual, &mut normal_residual);
            // Solve the linearized step to relative normal-residual accuracy.
            // Insisting on 1e-12 relative to the *damped residual floor* costs
            // thousands of iterations on large redundant grids. Newton then
            // relinearizes and the original exact geometric check still gates
            // success, so an inexact early step cannot relax the final answer.
            let tolerance = if precision {
                1e-14 * initial_normal_residual
            } else {
                1e-8 * initial_normal_residual + 1e-16
            };
            if norm(&normal_residual) <= tolerance {
                return Some((x, iteration + 1));
            }
        }
        let residual_tolerance = if precision {
            initial * 1e-14
        } else {
            initial * 1e-11 + 1e-14
        };
        if phibar.abs() <= residual_tolerance || alpha == 0. {
            return x
                .iter()
                .all(|v| v.is_finite())
                .then_some((x, iteration + 1));
        }
    }
    x.iter().all(|v| v.is_finite()).then_some((x, 3000))
}

#[derive(Clone, Copy)]
pub(super) struct Grid {
    pub cells: u32,
    pub tolerance: f64,
}

struct ProjectionAttempt {
    grid: Option<Grid>,
    hold_carriers: bool,
    angle_step: Option<f64>,
    iterations: usize,
}

pub(super) fn solve(
    input: &ExactSolveInput,
    options: ExactSolveOptions,
    clock: &ExactSolveDeadline,
    exempt: Rc<BTreeSet<usize>>,
    pinned: Rc<BTreeSet<usize>>,
) -> ExactSolvedGraph {
    solve_ordered(input, options, clock, exempt, pinned, None)
}

pub(super) fn solve_grid(
    input: &ExactSolveInput,
    options: ExactSolveOptions,
    clock: &ExactSolveDeadline,
    exempt: Rc<BTreeSet<usize>>,
    pinned: Rc<BTreeSet<usize>>,
    grid: Grid,
) -> ExactSolvedGraph {
    // The mostly fixed lattice supplies stronger evidence for its horizontal,
    // vertical, and diagonal continuations than for every nearby 22.5° ray.
    // Other angles remain unknowns in the folding equations.
    solve_ordered(input, options, clock, exempt, pinned, Some(grid))
}

fn solve_ordered(
    input: &ExactSolveInput,
    options: ExactSolveOptions,
    clock: &ExactSolveDeadline,
    exempt: Rc<BTreeSet<usize>>,
    pinned: Rc<BTreeSet<usize>>,
    grid: Option<Grid>,
) -> ExactSolvedGraph {
    let prefer_directions = grid.is_some();
    let validation = validate_input(input);
    if !validation.is_empty() {
        return failed_graph(
            input,
            input.vertices.iter().map(|v| v.point).collect(),
            json!({"blockers":validation}),
            json!({"status":"failed"}),
        );
    }
    let directions: Vec<f64> = input
        .selected_spans
        .iter()
        .filter(|s| is_fold_span(s))
        .map(|s| {
            let [a, b] = s.vertices;
            angle_radians(input.vertices[a].point, input.vertices[b].point)
        })
        .collect();
    let step = (options.angle_family != AngleFamilyMode::Off)
        .then(|| {
            infer_angle_family(
                &directions,
                options.angle_family_snap_tolerance_radians,
                options.angle_family_min_fraction,
            )
        })
        .flatten()
        .map(f64::to_radians);
    // Leave time for a structured proposal on highly redundant systems. The
    // unrestricted attempt remains available when no angle family is observed.
    let first_iterations = if step.is_some() && !prefer_directions {
        8
    } else {
        30
    };
    let first = project(
        input,
        options,
        clock,
        Rc::clone(&exempt),
        Rc::clone(&pinned),
        ProjectionAttempt {
            grid,
            hold_carriers: false,
            angle_step: if prefer_directions {
                step.map(|_| PI / 4.)
            } else {
                None
            },
            iterations: first_iterations,
        },
    );
    if first.status == ExactSolvedGraphStatus::Solved || clock.expired() {
        return first;
    }
    let mut angle_attempt = None;
    if let Some(step) = step.filter(|_| !prefer_directions) {
        let mut candidate = project(
            input,
            options,
            clock,
            Rc::clone(&exempt),
            Rc::clone(&pinned),
            ProjectionAttempt {
                grid: None,
                hold_carriers: false,
                angle_step: Some(step),
                iterations: 30,
            },
        );
        candidate.movement_report["unconstrained_projection"] = first.movement_report.clone();
        if candidate.status == ExactSolvedGraphStatus::Solved || clock.expired() {
            return candidate;
        }
        angle_attempt = Some(candidate.movement_report);
        // A detected family is a hypothesis, not a requirement. If it failed,
        // let a non-family geometry finish its unrestricted Newton iteration.
        let mut extended = project(
            input,
            options,
            clock,
            Rc::clone(&exempt),
            Rc::clone(&pinned),
            ProjectionAttempt {
                grid: None,
                hold_carriers: false,
                angle_step: None,
                iterations: 30,
            },
        );
        if extended.status == ExactSolvedGraphStatus::Solved || clock.expired() {
            extended.movement_report["angle_projection"] = json!(angle_attempt);
            return extended;
        }
    }
    let mut second = project(
        input,
        options,
        clock,
        exempt,
        pinned,
        ProjectionAttempt {
            grid: None,
            hold_carriers: true,
            angle_step: None,
            iterations: 30,
        },
    );
    second.movement_report["unconstrained_projection"] = first.movement_report;
    second.movement_report["angle_projection"] = json!(angle_attempt);
    second
}

fn project(
    input: &ExactSolveInput,
    options: ExactSolveOptions,
    clock: &ExactSolveDeadline,
    exempt: Rc<BTreeSet<usize>>,
    pinned: Rc<BTreeSet<usize>>,
    attempt: ProjectionAttempt,
) -> ExactSolvedGraph {
    let ProjectionAttempt {
        grid,
        hold_carriers,
        angle_step,
        iterations,
    } = attempt;
    let validation = validate_input(input);
    let original: Vec<Point2> = input.vertices.iter().map(|v| v.point).collect();
    if !validation.is_empty() {
        return failed_graph(
            input,
            original,
            json!({"blockers":validation}),
            json!({"status":"failed"}),
        );
    }
    let model = SolveModel::new(input, options, clock.clone(), exempt, pinned);
    let mut params = model.initial_params.clone();
    let before_points = model.points_from_params(&params);
    let before = analyze_graph(input, &before_points, &model, &params, options);
    let (initial_residuals, initial_breakdown) = model.residuals_with_breakdown(&params);
    let initial_objective = residual_energy(&initial_residuals);
    if !exact_solve_preflight_rejection_reasons(&before).is_empty()
        || !before.odd_degree_vertices.is_empty()
        || !before.maekawa_failures.is_empty()
    {
        return failed_graph(
            input,
            before_points,
            json!({"status":"projection_blocked"}),
            json!({"status":"failed","before":analysis_json(&before)}),
        );
    }
    let fans = fans(input, &before_points);
    let mut direction_constraints = Vec::new();
    if let Some(step) = angle_step {
        for span in &input.selected_spans {
            if !is_fold_span(span) {
                continue;
            }
            let [a, b] = span.vertices;
            // A nearby angle family is a hypothesis. Two pinned/grid-locked
            // endpoints already determine the direction, including legitimate
            // non-family slopes that happen to lie close to a family angle.
            if matches!(model.vertex_params[a], VertexParameterization::Fixed { .. })
                && matches!(model.vertex_params[b], VertexParameterization::Fixed { .. })
            {
                continue;
            }
            let angle = angle_radians(before_points[a], before_points[b]);
            let target = (angle / step).round() * step;
            // A pixel of endpoint noise is a much larger angle on a short
            // crossing span. The grid proposal allows the same bounded
            // positional uncertainty there, capped well below half a 45° bin.
            // Long segments retain the ordinary narrow angle window.
            let tolerance = if grid.is_some() {
                let positional =
                    (3_f64 / 1024.).atan2(distance(before_points[a], before_points[b]));
                options
                    .angle_family_snap_tolerance_radians
                    .max(positional.min(5_f64.to_radians()))
            } else {
                options.angle_family_snap_tolerance_radians
            };
            if (angle - target).abs() <= tolerance {
                direction_constraints.push((a, b, target));
            }
        }
    }
    let mut carrier_relations = Vec::new();
    if hold_carriers {
        for group in &model.carrier_groups {
            if group.span_indices.len() < 2 {
                continue;
            }
            let Some(span) = group
                .span_indices
                .iter()
                .map(|&i| &input.selected_spans[i])
                .max_by(|a, b| {
                    distance(before_points[a.vertices[0]], before_points[a.vertices[1]]).total_cmp(
                        &distance(before_points[b.vertices[0]], before_points[b.vertices[1]]),
                    )
                })
            else {
                continue;
            };
            let [a, b] = span.vertices;
            let vertices: BTreeSet<usize> = group
                .span_indices
                .iter()
                .flat_map(|&i| input.selected_spans[i].vertices)
                .collect();
            for v in vertices {
                if v != a && v != b {
                    carrier_relations.push((a, b, v));
                }
            }
        }
    }
    let n = model
        .vertex_params
        .iter()
        .flat_map(|p| match p {
            VertexParameterization::Free { x_index, y_index } => vec![*x_index, *y_index],
            VertexParameterization::Boundary { index, .. }
            | VertexParameterization::PolyBoundary { index, .. } => vec![*index],
            _ => vec![],
        })
        .max()
        .map_or(0, |v| v + 1);
    // A grid can fix just x or just y at a non-grid construction point. Holding
    // whole vertices only would let an otherwise straight grid line slide.
    // Eliminate supported coordinate parameters from the Newton updates;
    // explicit fixed vertices/pins have no parameters and remain untouched.
    let mut fixed_axes = BTreeSet::new();
    if let Some(grid) = grid {
        let mut support = vec![[false; 2]; before_points.len()];
        for span in &input.selected_spans {
            if !is_fold_span(span) {
                continue;
            }
            let [a, b] = span.vertices;
            let delta = Point2::new(
                before_points[b].x - before_points[a].x,
                before_points[b].y - before_points[a].y,
            );
            if delta.x.hypot(delta.y) < (16_f64 / 1024.).max(2. / f64::from(grid.cells)) {
                continue;
            }
            for (axis, (across, along)) in [(delta.x, delta.y), (delta.y, delta.x)]
                .into_iter()
                .enumerate()
            {
                if across.abs().atan2(along.abs()) > options.angle_family_snap_tolerance_radians {
                    continue;
                }
                let values =
                    [before_points[a], before_points[b]].map(|p| if axis == 0 { p.x } else { p.y });
                let targets = values.map(|v| crate::lattice::snap_to(v, grid.cells));
                if targets[0] == targets[1]
                    && values
                        .iter()
                        .zip(targets)
                        .all(|(v, t)| (v - t).abs() <= grid.tolerance)
                {
                    support[a][axis] = true;
                    support[b][axis] = true;
                }
            }
        }
        for (vertex, vp) in model.vertex_params.iter().enumerate() {
            let indices = match *vp {
                VertexParameterization::Free { x_index, y_index } => {
                    vec![(x_index, 0), (y_index, 1)]
                }
                VertexParameterization::Boundary { index, side } => vec![(
                    index,
                    match side {
                        BoundarySide::Top | BoundarySide::Bottom => 0,
                        _ => 1,
                    },
                )],
                _ => Vec::new(),
            };
            for (index, axis) in indices {
                if support[vertex][axis] {
                    params[index] = crate::lattice::snap_to(params[index], grid.cells);
                    fixed_axes.insert(index);
                }
            }
        }
    }
    let mut ties: Vec<Relation> = Vec::new();
    let mut history = Vec::new();
    let mut termination = "projection_iterations";
    for iteration in 0..iterations {
        if model.timeout_reached() {
            termination = "projection_timeout";
            break;
        }
        let points = model.points_from_params(&params);
        let bearings: Vec<Vec<f64>> = fans.iter().map(|f| angles(f, &points)).collect();
        if iteration >= 2 {
            for (i, (fan, angles)) in fans.iter().zip(&bearings).enumerate() {
                for sector in propose_ties(fan, angles) {
                    // Constants differ by full turns after a ray wraps across 0.
                    let constant = (sector.constant + PI).rem_euclid(TAU) - PI;
                    if !ties.iter().any(|t| {
                        t.fan == i
                            && t.coefficients == sector.coefficients
                            && (t.constant - constant).abs() < 1e-9
                    }) {
                        ties.push(Relation {
                            fan: i,
                            coefficients: sector.coefficients,
                            constant,
                        });
                    }
                }
            }
        }
        let mut rows = Vec::new();
        let mut maximum = 0_f64;
        for (fan, angles) in fans.iter().zip(&bearings) {
            if fan.boundary || !fan.neighbors.len().is_multiple_of(2) {
                continue;
            }
            let residual = (0..angles.len())
                .step_by(2)
                .map(|i| (angles[(i + 1) % angles.len()] - angles[i]).rem_euclid(TAU))
                .sum::<f64>()
                - PI;
            maximum = maximum.max(residual.abs());
            let rays: Vec<_> = fan
                .neighbors
                .iter()
                .enumerate()
                .map(|(i, &v)| (fan.center, v, if i % 2 == 0 { -1. } else { 1. }))
                .collect();
            rows.push(row(&model, &params, &points, &rays, residual));
        }
        for tie in &ties {
            let fan = &fans[tie.fan];
            let residual = (tie.constant
                + tie
                    .coefficients
                    .iter()
                    .zip(&bearings[tie.fan])
                    .map(|(c, a)| c * a)
                    .sum::<f64>()
                + PI)
                .rem_euclid(TAU)
                - PI;
            maximum = maximum.max(residual.abs());
            let rays: Vec<_> = fan
                .neighbors
                .iter()
                .zip(&tie.coefficients)
                .filter(|(_, c)| **c != 0.)
                .map(|(&v, &c)| (fan.center, v, c))
                .collect();
            rows.push(row(&model, &params, &points, &rays, residual));
        }
        for &(a, b, v) in &carrier_relations {
            let residual = (angle_radians(points[a], points[v])
                - angle_radians(points[a], points[b])
                + PI / 2.)
                .rem_euclid(PI)
                - PI / 2.;
            maximum = maximum.max(residual.abs());
            rows.push(row(
                &model,
                &params,
                &points,
                &[(a, v, 1.), (a, b, -1.)],
                residual,
            ));
        }
        for &(a, b, target) in &direction_constraints {
            let residual =
                (angle_radians(points[a], points[b]) - target + PI / 2.).rem_euclid(PI) - PI / 2.;
            maximum = maximum.max(residual.abs());
            rows.push(row(&model, &params, &points, &[(a, b, 1.)], residual));
        }
        if maximum < 1e-11 && iteration >= 2 {
            termination = "projection_converged";
            break;
        }
        for row in &mut rows {
            row.entries.retain(|(index, _)| !fixed_axes.contains(index));
        }
        let Some((delta, iterations)) = least_norm(&rows, n, clock) else {
            termination = "projection_linear_stop";
            break;
        };
        let largest = delta.iter().map(|v| v.abs()).fold(0., f64::max);
        let step = (0.005 / largest.max(1e-20)).min(1.);
        for (p, d) in params.iter_mut().take(n).zip(&delta) {
            *p += step * d;
        }
        history.push(json!({"maximum_radians":maximum,"linear_iterations":iterations,"ties":ties.len(),"step":step}));
        if model
            .points_from_params(&params)
            .iter()
            .zip(&before_points)
            .enumerate()
            .any(|(i, (p, q))| {
                !model.exempt_vertex_ids.contains(&i)
                    && distance(*p, *q) > options.max_vertex_movement
            })
        {
            termination = "projection_movement_limit";
            break;
        }
    }
    let points = model.points_from_params(&params);
    // Geometry-derived carrier bins are observations, not user constraints.
    // Re-read them from the proposed placement exactly as the partial-lattice
    // proposal does. Explicit source carrier IDs and pins remain unchanged.
    let mut placed = input.clone();
    for (v, p) in placed.vertices.iter_mut().zip(&points) {
        v.point = *p;
    }
    for span in &mut placed.selected_spans {
        let [a, b] = span.vertices;
        let (carrier, interval) = carrier_from(points[a], points[b]);
        span.carrier = carrier;
        span.t_interval = interval;
    }
    let placed_model = SolveModel::with_carrier_resolution(
        &placed,
        options,
        clock.clone(),
        Rc::clone(&model.exempt_vertex_ids),
        Rc::clone(&model.pinned_vertex_ids),
        true,
    );
    let mut placed_params = placed_model.initial_params.clone();
    refit_carriers_through(&placed_model, &points, &mut placed_params);
    // Orthogonal least squares refit of a shared line. Farthest endpoints are
    // sensitive to two extreme points; the centroid fit uses all observations.
    for group in &placed_model.carrier_groups {
        let vertices: BTreeSet<usize> = group
            .span_indices
            .iter()
            .flat_map(|&i| input.selected_spans[i].vertices)
            .collect();
        if vertices.len() < 3 {
            continue;
        }
        let count = vertices.len() as f64;
        let mx = vertices.iter().map(|&v| points[v].x).sum::<f64>() / count;
        let my = vertices.iter().map(|&v| points[v].y).sum::<f64>() / count;
        let mut xx = 0.;
        let mut yy = 0.;
        let mut xy = 0.;
        for &v in &vertices {
            let dx = points[v].x - mx;
            let dy = points[v].y - my;
            xx += dx * dx;
            yy += dy * dy;
            xy += dx * dy;
        }
        let direction = (2. * xy).atan2(xx - yy) / 2.;
        let theta = direction + PI / 2.;
        placed_params[group.theta_index] = theta;
        placed_params[group.rho_index] = theta.cos() * mx + theta.sin() * my;
    }
    let after = analyze_graph(input, &points, &placed_model, &placed_params, options);
    let status = classify_status(&before, &after, options);
    let (residuals, breakdown) = placed_model.residuals_with_breakdown(&placed_params);
    let objective = residual_energy(&residuals);
    let mut reasons = exact_solution_rejection_reasons(
        &before,
        &after,
        status,
        initial_objective,
        objective,
        options,
    );
    if status != ExactSolvedGraphStatus::Solved {
        reasons.push("projection_not_exact".to_owned());
    }
    if clock.expired() {
        reasons.push(timeout_rejection_reason(options));
    }
    let accepted = reasons.is_empty();
    let result_points = if accepted {
        points.clone()
    } else {
        before_points.clone()
    };
    let mut movement = movement_report(
        input,
        &before_points,
        &result_points,
        &points,
        initial_objective,
        if accepted {
            objective
        } else {
            initial_objective
        },
        objective,
        history.len(),
        termination,
        options,
        accepted,
        &reasons,
        &model,
        &initial_breakdown,
        if accepted {
            &breakdown
        } else {
            &initial_breakdown
        },
        &breakdown,
        &SolveCounterSnapshot::default(),
        &PolishOutcome::not_run("constraint_projection"),
    );
    movement["constraint_projection"] = json!({"iterations":history,"ties":ties.len(),"hold_carriers":hold_carriers,"angle_step":angle_step,"grid_direction_noise":grid.is_some(),"grid_coordinate_constraints":fixed_axes.len()});
    ExactSolvedGraph {
        schema: SCHEMA.to_owned(),
        vertices_exact: result_points,
        edges_exact: input.selected_spans.iter().map(|s| s.vertices).collect(),
        merged_vertices: Vec::new(),
        movement_report: movement,
        theorem_residual_report: theorem_report(
            &before,
            if accepted { &after } else { &before },
            &after,
            termination,
            accepted,
            &reasons,
        ),
        status: if accepted {
            status
        } else {
            ExactSolvedGraphStatus::Failed
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use treemaker_fold::{Assignment, FoldDocument};

    fn noisy_base() -> ExactSolveInput {
        let mut fold = FoldDocument::new(
            vec![
                vec![0., 0.],
                vec![1., 0.],
                vec![1., 1.],
                vec![0., 1.],
                vec![0.5004, 0.4997],
            ],
            vec![
                [0, 1],
                [1, 2],
                [2, 3],
                [3, 0],
                [0, 4],
                [1, 4],
                [2, 4],
                [3, 4],
            ],
        );
        fold.edges_assignment = vec![
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Mountain,
            Assignment::Mountain,
            Assignment::Mountain,
            Assignment::Valley,
        ];
        crate::exact_solve_input_from_fold(&fold).unwrap().0
    }

    #[test]
    fn grid_can_fix_one_coordinate_without_inventing_the_other() {
        let x = 0.5007;
        let y = 0.4143;
        let mut fold = FoldDocument::new(
            vec![
                vec![0., 0.],
                vec![1., 0.],
                vec![1., 1.],
                vec![0., 1.],
                vec![x, y],
                vec![x, 0.],
                vec![1., y],
                vec![x, 1.],
                vec![0., y],
            ],
            vec![
                [0, 5],
                [5, 1],
                [1, 6],
                [6, 2],
                [2, 7],
                [7, 3],
                [3, 8],
                [8, 0],
                [4, 5],
                [4, 6],
                [4, 7],
                [4, 8],
            ],
        );
        fold.edges_assignment = vec![Assignment::Boundary; 8];
        fold.edges_assignment.extend([
            Assignment::Mountain,
            Assignment::Mountain,
            Assignment::Mountain,
            Assignment::Valley,
        ]);
        let (input, _) = crate::exact_solve_input_from_fold(&fold).unwrap();
        let result = solve_grid(
            &input,
            ExactSolveOptions::default(),
            &ExactSolveDeadline::start(5., None),
            Rc::default(),
            Rc::default(),
            Grid {
                cells: 8,
                tolerance: 1.5 / 1024.,
            },
        );
        assert_eq!(
            result.status,
            ExactSolvedGraphStatus::Solved,
            "{}",
            result.movement_report
        );
        for v in [4, 5, 7] {
            assert_eq!(result.vertices_exact[v].x, 0.5);
        }
        for v in [4, 6, 8] {
            assert!((result.vertices_exact[v].y - y).abs() < 1e-12);
        }
        assert_eq!(result.edges_exact, fold.edges_vertices);
        let pinned = solve_grid(
            &input,
            ExactSolveOptions::default(),
            &ExactSolveDeadline::start(5., None),
            Rc::default(),
            Rc::new(BTreeSet::from([4])),
            Grid {
                cells: 8,
                tolerance: 1.5 / 1024.,
            },
        );
        assert_eq!(pinned.vertices_exact[4], input.vertices[4].point);
    }

    #[test]
    fn grid_projection_recovers_short_crossings_without_moving_anchors() {
        let axis = [0., 0.487, 0.5, 0.513, 1.];
        let mut fold = FoldDocument::new(Vec::new(), Vec::new());
        for y in axis {
            for x in axis {
                fold.vertices_coords.push(vec![x, y]);
            }
        }
        for y in 0..5 {
            for x in 0..5 {
                let v = y * 5 + x;
                if x < 4 {
                    fold.edges_vertices.push([v, v + 1]);
                    fold.edges_assignment.push(if y == 0 || y == 4 {
                        Assignment::Boundary
                    } else if x % 2 == 0 {
                        Assignment::Mountain
                    } else {
                        Assignment::Valley
                    });
                }
                if y < 4 {
                    fold.edges_vertices.push([v, v + 5]);
                    fold.edges_assignment.push(if x == 0 || x == 4 {
                        Assignment::Boundary
                    } else if x % 2 == 0 {
                        Assignment::Mountain
                    } else {
                        Assignment::Valley
                    });
                }
            }
        }
        let expected = fold.vertices_coords.clone();
        fold.vertices_coords[12] = vec![0.5008, 0.4993];
        let (mut input, _) = crate::exact_solve_input_from_fold(&fold).unwrap();
        for v in &mut input.vertices {
            if v.id != 12 {
                v.movement_policy = CandidateVertexMovementPolicy::Locked;
            }
        }
        let result = solve_grid(
            &input,
            ExactSolveOptions::default(),
            &ExactSolveDeadline::start(5., None),
            Rc::default(),
            Rc::default(),
            Grid {
                cells: 8,
                tolerance: 1.5 / 1024.,
            },
        );
        assert_eq!(
            result.status,
            ExactSolvedGraphStatus::Solved,
            "{}",
            result.movement_report
        );
        for (v, target) in result.vertices_exact.iter().zip(expected) {
            assert!((v.x - target[0]).abs() < 1e-12 && (v.y - target[1]).abs() < 1e-12);
        }
        assert_eq!(result.edges_exact, fold.edges_vertices);
    }

    #[test]
    fn exact_endpoints_take_precedence_over_a_nearby_angle_family() {
        let mut fold = FoldDocument::new(
            vec![
                vec![0., 0.],
                vec![1., 0.],
                vec![1., 1.],
                vec![0., 1.],
                vec![0., 0.3],
                vec![1., 0.7],
            ],
            vec![[0, 1], [1, 5], [5, 2], [2, 3], [3, 4], [4, 0], [4, 5]],
        );
        fold.edges_assignment = vec![Assignment::Boundary; 6];
        fold.edges_assignment.push(Assignment::Mountain);
        let (mut input, _) = crate::exact_solve_input_from_fold(&fold).unwrap();
        for v in &mut input.vertices {
            v.movement_policy = CandidateVertexMovementPolicy::Locked;
        }
        let result = project(
            &input,
            ExactSolveOptions::default(),
            &ExactSolveDeadline::start(5., None),
            Rc::default(),
            Rc::default(),
            ProjectionAttempt {
                grid: None,
                hold_carriers: false,
                angle_step: Some(PI / 8.),
                iterations: 30,
            },
        );
        assert_eq!(
            result.status,
            ExactSolvedGraphStatus::Solved,
            "{}",
            result.movement_report
        );
        assert_eq!(
            result.vertices_exact,
            input.vertices.iter().map(|v| v.point).collect::<Vec<_>>()
        );
    }

    #[test]
    fn lsqr_returns_minimum_norm_with_dependent_rows() {
        let rows = vec![
            Row {
                entries: vec![(0, 1.), (1, 1.)],
                rhs: 1.,
            },
            Row {
                entries: vec![(0, 2.), (1, 2.)],
                rhs: 2.,
            },
        ];
        let (x, _) = least_norm(&rows, 2, &ExactSolveDeadline::start(1., None)).unwrap();
        assert!((x[0] - 0.5).abs() < 1e-12 && (x[1] - 0.5).abs() < 1e-12);
    }

    #[test]
    fn inconsistent_rows_do_not_generate_a_null_space_step() {
        let rows = vec![
            Row {
                entries: vec![(0, 1.), (1, 1.)],
                rhs: 1e-10,
            },
            Row {
                entries: vec![(0, 1.), (1, 1.)],
                rhs: 2e-10,
            },
        ];
        let (x, _) = least_norm(&rows, 2, &ExactSolveDeadline::start(1., None)).unwrap();
        assert!((x[0] - 7.5e-11).abs() < 1e-13 && (x[1] - 7.5e-11).abs() < 1e-13);
    }

    #[test]
    fn projected_base_passes_the_unchanged_editor_checker() {
        let input = noisy_base();
        let result =
            super::super::solve_exact_projection(&input, &ExactSolveOptions::default().into());
        assert_eq!(
            result.status,
            ExactSolvedGraphStatus::Solved,
            "{}",
            result.theorem_residual_report
        );
        assert_eq!(
            result.edges_exact,
            input
                .selected_spans
                .iter()
                .map(|s| s.vertices)
                .collect::<Vec<_>>()
        );
        assert!(result.merged_vertices.is_empty());
        assert_eq!(
            result.theorem_residual_report["after"]["camv_angle_violations"],
            0
        );
        assert_eq!(
            result.theorem_residual_report["after"]["big_little_big_violations"],
            0
        );
    }

    #[test]
    fn projection_preserves_pins_even_when_they_prevent_a_solution() {
        let input = noisy_base();
        let mut options = ExactSolveOptionsWithExemptions::from(ExactSolveOptions::default());
        options.pinned_vertex_ids = (0..input.vertices.len()).collect();
        let result = super::super::solve_exact_projection(&input, &options);
        assert_eq!(
            result.vertices_exact,
            input.vertices.iter().map(|v| v.point).collect::<Vec<_>>()
        );
        assert_ne!(result.status, ExactSolvedGraphStatus::Solved);
    }

    #[test]
    fn expired_projection_cannot_report_success() {
        let input = noisy_base();
        let options = ExactSolveOptions {
            timeout_seconds: 0.,
            ..Default::default()
        };
        let result = super::super::solve_exact_projection(&input, &options.into());
        assert_ne!(result.status, ExactSolvedGraphStatus::Solved);
        assert_eq!(result.movement_report["accepted"], false);
    }

    #[test]
    fn projection_cannot_rebase_away_the_original_movement_limit() {
        let input = noisy_base();
        let options = ExactSolveOptions {
            max_vertex_movement: 1e-8,
            ..Default::default()
        };
        let result = super::super::solve_exact_projection(&input, &options.into());
        assert_ne!(result.status, ExactSolvedGraphStatus::Solved);
        assert_eq!(result.movement_report["accepted"], false);
        assert_eq!(
            result.vertices_exact,
            input.vertices.iter().map(|v| v.point).collect::<Vec<_>>()
        );
    }

    #[test]
    fn projection_does_not_discard_explicit_source_carrier_constraints() {
        let mut input = noisy_base();
        // A deliberately incompatible source constraint: all four spokes
        // would have to lie on one line. Refreshing observed geometry must
        // not erase the caller's source IDs to manufacture an exact verdict.
        for span in &mut input.selected_spans {
            if is_fold_span(span) {
                span.source_carrier_ids = vec![999];
            }
        }
        let result =
            super::super::solve_exact_projection(&input, &ExactSolveOptions::default().into());
        assert_ne!(result.status, ExactSolvedGraphStatus::Solved);
        assert_eq!(result.movement_report["accepted"], false);
    }

    #[test]
    fn projection_restores_auxiliary_junctions_on_a_dissolved_crease() {
        let input = noisy_base();
        let mut fold = FoldDocument::new(
            input
                .vertices
                .iter()
                .map(|v| vec![v.point.x, v.point.y])
                .collect(),
            input.selected_spans.iter().map(|s| s.vertices).collect(),
        );
        fold.edges_assignment = input
            .selected_spans
            .iter()
            .map(|s| crate::fold_export::fold_assignment(s.assignment_label()))
            .collect();
        let middle = vec![
            input.vertices[4].point.x / 2.,
            input.vertices[4].point.y / 2.,
        ];
        fold.vertices_coords.extend([middle, vec![0.8, 0.2]]);
        fold.edges_vertices[4] = [0, 5];
        fold.edges_vertices.extend([[5, 4], [5, 6]]);
        fold.edges_assignment
            .extend([Assignment::Mountain, Assignment::Flat]);
        let input = crate::exact_solve_input_from_fold(&fold).unwrap().0;
        let result =
            super::super::solve_exact_projection(&input, &ExactSolveOptions::default().into());
        assert_eq!(
            result.status,
            ExactSolvedGraphStatus::Solved,
            "{}",
            result.movement_report
        );
        assert_eq!(result.edges_exact, fold.edges_vertices);
        let a = result.vertices_exact[0];
        let b = result.vertices_exact[4];
        let middle = result.vertices_exact[5];
        assert!(((b.x - a.x) * (middle.y - a.y) - (b.y - a.y) * (middle.x - a.x)).abs() < 1e-12);
        assert_eq!(result.edges_exact.last(), Some(&[5, 6]));
        let mut options = ExactSolveOptionsWithExemptions::from(ExactSolveOptions::default());
        options.pinned_vertex_ids.insert(5);
        let pinned = super::super::solve_exact_projection(&input, &options);
        assert_eq!(pinned.vertices_exact[5], input.vertices[5].point);
    }
}
