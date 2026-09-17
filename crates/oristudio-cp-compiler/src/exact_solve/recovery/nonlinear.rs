//! Propagate construction anchors through the nonlinear angle equations.
use super::*;
use crate::exact_solve::projection::{Fan, fans};

fn rows(geometry: &LinearGeometry, points: &[Point2], fans: &[Fan]) -> (Vec<Row>, f64) {
    let mut indices = vec![[None; 2]; points.len()];
    for (i, &(v, axis)) in geometry.variables.iter().enumerate() {
        indices[v][axis] = Some(i);
    }
    let mut rows = Vec::new();
    let mut maximum = 0_f64;
    for fan in fans {
        if fan.boundary || !fan.neighbors.len().is_multiple_of(2) {
            continue;
        }
        if fan
            .neighbors
            .iter()
            .any(|&v| distance(points[v], points[fan.center]) < 1e-8)
        {
            continue;
        }
        let angles: Vec<_> = fan
            .neighbors
            .iter()
            .map(|&v| angle_radians(points[fan.center], points[v]))
            .collect();
        let residual = (0..angles.len())
            .step_by(2)
            .map(|i| (angles[i + 1] - angles[i]).rem_euclid(TAU))
            .sum::<f64>()
            - std::f64::consts::PI;
        maximum = maximum.max(residual.abs());
        let mut entries = BTreeMap::<usize, f64>::new();
        for (i, &v) in fan.neighbors.iter().enumerate() {
            let dx = points[v].x - points[fan.center].x;
            let dy = points[v].y - points[fan.center].y;
            let sign = if i % 2 == 0 { -1. } else { 1. };
            let length_squared = dx * dx + dy * dy;
            let gradient = [-sign * dy / length_squared, sign * dx / length_squared];
            for (axis, &value) in gradient.iter().enumerate() {
                if let Some(c) = indices[v][axis] {
                    *entries.entry(c).or_default() += value;
                }
                if let Some(c) = indices[fan.center][axis] {
                    *entries.entry(c).or_default() -= value;
                }
            }
        }
        let scale = entries.values().map(|v| v.abs()).fold(1e-12, f64::max);
        let entries: Vec<_> = entries.into_iter().map(|(c, v)| (c, v / scale)).collect();
        let rhs = entries
            .iter()
            .map(|&(c, v)| {
                let (point, axis) = geometry.variables[c];
                v * get(points[point], axis)
            })
            .sum::<f64>()
            - residual / scale;
        rows.push(Row { entries, rhs });
    }
    (rows, maximum)
}

pub(super) fn augment(geometry: &mut LinearGeometry, input: &ExactSolveInput, points: &[Point2]) {
    geometry
        .rows
        .extend(rows(geometry, points, &fans(input, points)).0);
}

pub(super) fn polish(
    geometry: &LinearGeometry,
    input: &ExactSolveInput,
    points: &[Point2],
    clock: &ExactSolveDeadline,
) -> Option<(Vec<Point2>, Value)> {
    let fans = fans(input, points);
    let mut linear = geometry.rows.clone();
    for (c, &(v, axis)) in geometry.variables.iter().enumerate() {
        if let Some(target) = constructions::recognized_coordinate(get(points[v], axis)) {
            linear.push(Row {
                entries: vec![(c, 1.)],
                rhs: target,
            });
        }
    }
    let mut candidate = points.to_vec();
    let mut history = Vec::new();
    for _ in 0..8 {
        if clock.expired() {
            return None;
        }
        let (mut combined, angle_error) = rows(geometry, &candidate, &fans);
        combined.extend(linear.iter().cloned());
        let mut maximum = angle_error;
        for row in &mut combined {
            row.rhs -= row
                .entries
                .iter()
                .map(|&(c, v)| {
                    let (point, axis) = geometry.variables[c];
                    v * get(candidate[point], axis)
                })
                .sum::<f64>();
            maximum = maximum.max(row.rhs.abs());
        }
        history.push(maximum);
        if maximum < 2e-14 {
            break;
        }
        let (correction, _) =
            least_norm_at_precision(&combined, geometry.variables.len(), clock, true)?;
        for (&(v, axis), step) in geometry.variables.iter().zip(correction) {
            let value = get(candidate[v], axis) + step;
            set(&mut candidate[v], axis, value);
        }
        if candidate
            .iter()
            .zip(points)
            .any(|(&a, &b)| !a.x.is_finite() || !a.y.is_finite() || distance(a, b) > 5e-4)
        {
            return None;
        }
    }
    let (_, angle_error) = rows(geometry, &candidate, &fans);
    let maximum = linear
        .iter()
        .map(|r| {
            (r.rhs
                - r.entries
                    .iter()
                    .map(|&(c, v)| {
                        let (point, axis) = geometry.variables[c];
                        v * get(candidate[point], axis)
                    })
                    .sum::<f64>())
            .abs()
        })
        .fold(angle_error, f64::max);
    if maximum > 1e-10 || clock.expired() {
        return None;
    }
    Some((
        candidate,
        json!({"history":history,"final_residual":maximum}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_known_coordinate_determines_a_nearby_nonlinear_intersection() {
        let fold: treemaker_fold::FoldDocument = serde_json::from_value(json!({
            "vertices_coords":[[0.,0.],[1.,0.],[1.,1.],[0.,1.],[1./3.,2./3.+1e-5]],
            "edges_vertices":[[0,1],[1,2],[2,3],[3,0],[0,4],[1,4],[2,4],[3,4]],
            "edges_assignment":["B","B","B","B","M","V","M","M"]
        }))
        .unwrap();
        let input = crate::exact_solve_input_from_fold(&fold).unwrap().0;
        let points: Vec<_> = input.vertices.iter().map(|v| v.point).collect();
        let geometry = linear_geometry(&input, &points, &BTreeSet::new(), &[]);
        let (answer, _) = polish(
            &geometry,
            &input,
            &points,
            &ExactSolveDeadline::start(1., None),
        )
        .unwrap();
        assert!((answer[4].x - 1. / 3.).abs() < 1e-13);
        assert!((answer[4].y - 2. / 3.).abs() < 1e-12);
    }

    #[test]
    fn analytic_angle_rows_agree_with_finite_differences() {
        let points = vec![
            Point2::new(0.503, 0.499),
            Point2::new(0., 0.),
            Point2::new(1., 0.),
            Point2::new(1., 1.),
            Point2::new(0., 1.),
        ];
        let fold: treemaker_fold::FoldDocument = serde_json::from_value(json!({
            "vertices_coords":points.iter().map(|p| vec![p.x,p.y]).collect::<Vec<_>>(),
            "edges_vertices":[[1,2],[2,3],[3,4],[4,1],[0,1],[0,2],[0,3],[0,4]],
            "edges_assignment":["B","B","B","B","M","M","M","V"]
        }))
        .unwrap();
        let input = crate::exact_solve_input_from_fold(&fold).unwrap().0;
        let geometry = LinearGeometry {
            rows: Vec::new(),
            variables: (0..points.len()).flat_map(|v| [(v, 0), (v, 1)]).collect(),
        };
        let fans = fans(&input, &points);
        let (equations, _) = rows(&geometry, &points, &fans);
        // The rows are normalized; compare derivative ratios to avoid making
        // the test depend on the chosen row normalization.
        let equation = &equations[0];
        let derivative = |v: usize, axis: usize| {
            let mut left = points.clone();
            let mut right = points.clone();
            set(&mut left[v], axis, get(points[v], axis) - 1e-7);
            set(&mut right[v], axis, get(points[v], axis) + 1e-7);
            (rows(&geometry, &right, &fans).1 - rows(&geometry, &left, &fans).1) / 2e-7
        };
        let reference = derivative(1, 0);
        let coefficient = equation.entries.iter().find(|(c, _)| *c == 2).unwrap().1;
        for &(c, value) in &equation.entries {
            assert!((derivative(c / 2, c % 2) / reference - value / coefficient).abs() < 1e-5);
        }
    }
}
