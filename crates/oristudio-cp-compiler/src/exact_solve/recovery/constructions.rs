//! Low-complexity construction hypotheses, generated without learned data.
use super::*;
use std::sync::OnceLock;

mod joint;
pub(super) use joint::propose as joint_proposal;

const NOISE: f64 = 5e-4;
const KNOWN_EPSILON: f64 = 1e-9;

#[derive(Clone, Copy)]
pub(super) enum Attempt {
    Coordinates,
    FreeCoordinates,
    IndependentAnchors,
    RicherAnchors,
    WiderAnchors,
    AlgebraicPrecision,
    SupportedGrid,
}

fn dictionary(height: i32) -> Vec<f64> {
    radical_dictionary(height, 2_f64.sqrt())
}

fn radical_dictionary(height: i32, root: f64) -> Vec<f64> {
    let mut values = vec![0., 1.];
    for r in 1..=height {
        for q in -(height - r)..=(height - r) {
            let remaining = height - r - q.abs();
            let lo = (-remaining).max((-f64::from(q) * root).ceil() as i32);
            let hi = remaining.min((f64::from(r) - f64::from(q) * root).floor() as i32);
            for p in lo..=hi {
                let value = (f64::from(p) + f64::from(q) * root) / f64::from(r);
                if (0.0..=1.0).contains(&value) {
                    values.push(value);
                    values.push(1. - value);
                }
            }
        }
    }
    values.sort_by(f64::total_cmp);
    values.dedup();
    values
}

fn simple_values() -> &'static [f64] {
    static VALUES: OnceLock<Vec<f64>> = OnceLock::new();
    VALUES.get_or_init(|| dictionary(16))
}

fn known_values() -> &'static [f64] {
    static VALUES: OnceLock<Vec<f64>> = OnceLock::new();
    VALUES.get_or_init(|| {
        let mut values = dictionary(128);
        values.extend(radical_dictionary(64, 3_f64.sqrt()));
        values.sort_by(f64::total_cmp);
        values.dedup();
        values
    })
}

fn richer_values() -> &'static [f64] {
    static VALUES: OnceLock<Vec<f64>> = OnceLock::new();
    VALUES.get_or_init(|| dictionary(24))
}

fn nearest(values: &[f64], value: f64) -> f64 {
    let index = values.partition_point(|v| *v < value);
    let left = values[index.saturating_sub(1)];
    let right = values[index.min(values.len() - 1)];
    if (value - left).abs() <= (value - right).abs() {
        left
    } else {
        right
    }
}

fn already_constructed(value: f64) -> bool {
    (1..=256).any(|n| {
        let n = f64::from(n);
        (value - (value * n).round() / n).abs() < KNOWN_EPSILON
    }) || (value - nearest(known_values(), value)).abs() < KNOWN_EPSILON
}

pub(super) fn recognized_coordinate(value: f64) -> Option<f64> {
    let mut target = nearest(known_values(), value);
    for n in 1..=256 {
        let n = f64::from(n);
        let rational = (value * n).round() / n;
        if (value - rational).abs() < (value - target).abs() {
            target = rational;
        }
    }
    ((value - target).abs() < KNOWN_EPSILON).then_some(target)
}

struct Pivot {
    coefficients: BTreeMap<usize, f64>,
    rhs: f64,
    order: usize,
}

struct Basis {
    pivots: BTreeMap<usize, Pivot>,
    order: Vec<usize>,
}

impl Basis {
    fn new() -> Self {
        Self {
            pivots: BTreeMap::new(),
            order: Vec::new(),
        }
    }

    /// Add only independent equations. Reduction changes no existing row, so
    /// a proposed anchor can be rolled back without changing previous facts.
    fn insert(
        &mut self,
        mut row: BTreeMap<usize, f64>,
        mut rhs: f64,
        clock: &ExactSolveDeadline,
    ) -> Option<bool> {
        row.retain(|_, v| v.abs() > 1e-12);
        let mut steps = 0;
        loop {
            if steps % 32 == 0 && clock.expired() {
                return None;
            }
            let shared = row
                .keys()
                .filter_map(|c| self.pivots.get(c).map(|p| (*c, p.order)))
                .min_by_key(|(_, order)| *order);
            let Some((column, _)) = shared else {
                break;
            };
            let coefficient = row.remove(&column)?;
            let pivot = self.pivots.get(&column)?;
            rhs -= coefficient * pivot.rhs;
            for (&c, &v) in &pivot.coefficients {
                let updated = row.get(&c).copied().unwrap_or(0.) - coefficient * v;
                if updated.abs() > 1e-12 {
                    row.insert(c, updated);
                } else {
                    row.remove(&c);
                }
            }
            steps += 1;
        }
        if row.is_empty() {
            return (rhs.abs() < 1e-9).then_some(false);
        }
        let (&column, &coefficient) = row
            .iter()
            .max_by(|(ca, a), (cb, b)| a.abs().total_cmp(&b.abs()).then_with(|| cb.cmp(ca)))?;
        row.remove(&column);
        for value in row.values_mut() {
            *value /= coefficient;
        }
        self.pivots.insert(
            column,
            Pivot {
                coefficients: row,
                rhs: rhs / coefficient,
                order: self.order.len(),
            },
        );
        self.order.push(column);
        Some(true)
    }

    fn back_substitute(&self, original: &[f64]) -> Vec<f64> {
        let mut x = original.to_vec();
        for column in self.order.iter().rev() {
            let pivot = &self.pivots[column];
            x[*column] = pivot.rhs
                - pivot
                    .coefficients
                    .iter()
                    .map(|(&c, &v)| v * x[c])
                    .sum::<f64>();
        }
        x
    }
}

fn max_residual(geometry: &LinearGeometry, x: &[f64]) -> f64 {
    geometry
        .rows
        .iter()
        .map(|r| (r.entries.iter().map(|&(c, v)| v * x[c]).sum::<f64>() - r.rhs).abs())
        .fold(0., f64::max)
}

fn place(geometry: &LinearGeometry, points: &[Point2], x: &[f64]) -> Vec<Point2> {
    let mut placed = points.to_vec();
    for (&(v, a), &value) in geometry.variables.iter().zip(x) {
        set(&mut placed[v], a, value);
    }
    placed
}

fn movement(geometry: &LinearGeometry, points: &[Point2], x: &[f64]) -> f64 {
    let placed = place(geometry, points, x);
    placed
        .iter()
        .zip(points)
        .map(|(&a, &b)| distance(a, b))
        .fold(0., f64::max)
}

pub(super) fn propose(
    geometry: &LinearGeometry,
    points: &[Point2],
    clock: &ExactSolveDeadline,
    attempt: Attempt,
) -> Option<(Vec<Point2>, Value)> {
    let original: Vec<f64> = geometry
        .variables
        .iter()
        .map(|&(v, a)| get(points[v], a))
        .collect();
    if original.is_empty()
        || (!matches!(
            attempt,
            Attempt::AlgebraicPrecision | Attempt::SupportedGrid
        ) && original.iter().all(|&v| already_constructed(v)))
        || clock.expired()
    {
        return None;
    }
    let values = if matches!(attempt, Attempt::RicherAnchors) {
        richer_values()
    } else {
        simple_values()
    };
    let noise = if matches!(attempt, Attempt::WiderAnchors) {
        0.002
    } else {
        NOISE
    };
    let mut x = original.clone();
    let mut report = json!({});
    match attempt {
        Attempt::SupportedGrid => {
            for cells in 2..=512 {
                if clock.expired() {
                    return None;
                }
                let cells = f64::from(cells);
                let evidence: Vec<_> = points
                    .iter()
                    .flat_map(|p| [p.x, p.y])
                    .filter(|v| (*v - (*v * cells).round() / cells).abs() < KNOWN_EPSILON)
                    .collect();
                let distinct: BTreeSet<_> =
                    evidence.iter().map(|v| (v * 1e9).round() as i64).collect();
                if evidence.len() as f64 / ((2 * points.len()) as f64) < 0.95 || distinct.len() < 8
                {
                    continue;
                }
                let proposed: Vec<_> = original
                    .iter()
                    .map(|v| {
                        let target = (v * cells).round() / cells;
                        if (v - target).abs() < NOISE {
                            target
                        } else {
                            *v
                        }
                    })
                    .collect();
                if movement(geometry, points, &proposed) < 1e-12
                    || max_residual(geometry, &proposed) > 1e-10
                {
                    continue;
                }
                x = proposed;
                report["method"] = json!("supported_grid");
                report["cells"] = json!(cells);
                break;
            }
        }
        Attempt::AlgebraicPrecision => {
            for value in &mut x {
                let target = nearest(known_values(), *value);
                if (*value - target).abs() <= KNOWN_EPSILON {
                    *value = target;
                }
            }
            report["method"] = json!("algebraic_precision");
        }
        Attempt::Coordinates => {
            for value in &mut x {
                if already_constructed(*value) {
                    continue;
                }
                let target = nearest(values, *value);
                if (*value - target).abs() <= NOISE {
                    *value = target;
                }
            }
            report["method"] = json!("coordinate_constructions");
        }
        Attempt::FreeCoordinates
        | Attempt::IndependentAnchors
        | Attempt::RicherAnchors
        | Attempt::WiderAnchors => {
            let mut basis = Basis::new();
            for row in &geometry.rows {
                basis.insert(row.entries.iter().copied().collect(), row.rhs, clock)?;
            }
            let nullity = original.len() - basis.order.len();
            report["linear_nullity_before"] = json!(nullity);
            if matches!(attempt, Attempt::FreeCoordinates) {
                for (c, value) in x.iter_mut().enumerate() {
                    if basis.pivots.contains_key(&c) || already_constructed(*value) {
                        continue;
                    }
                    let target = nearest(values, *value);
                    if (*value - target).abs() <= NOISE {
                        *value = target;
                    }
                }
                x = basis.back_substitute(&x);
                report["method"] = json!("free_coordinate_constructions");
            } else {
                let mut anchors = Vec::new();
                for (c, &value) in original.iter().enumerate() {
                    if already_constructed(value) {
                        anchors.push((-1., c, value));
                    } else {
                        let target = nearest(values, value);
                        let error = (value - target).abs();
                        if error <= noise {
                            anchors.push((error, c, target));
                        }
                    }
                }
                anchors.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
                let mut added = 0;
                for (_, c, target) in anchors {
                    if clock.expired() {
                        return None;
                    }
                    // A dependent contradictory hypothesis says nothing about
                    // the already accepted basis; just leave it unselected.
                    let Some(independent) = basis.insert(BTreeMap::from([(c, 1.)]), target, clock)
                    else {
                        continue;
                    };
                    if !independent {
                        continue;
                    }
                    let proposed = basis.back_substitute(&original);
                    if movement(geometry, points, &proposed) > 4. * noise {
                        if let Some(column) = basis.order.pop() {
                            basis.pivots.remove(&column);
                        }
                    } else {
                        added += 1;
                    }
                }
                x = basis.back_substitute(&original);
                report["method"] = json!("independent_construction_anchors");
                report["anchors"] = json!(added);
                report["height"] = json!(if matches!(attempt, Attempt::RicherAnchors) {
                    24
                } else {
                    16
                });
                report["noise"] = json!(noise);
            }
            report["linear_nullity_after"] = json!(original.len() - basis.order.len());
        }
    }
    let residual = max_residual(geometry, &x);
    let max_movement = movement(geometry, points, &x);
    report["max_residual"] = json!(residual);
    report["max_movement"] = json!(max_movement);
    if residual > 1e-10
        || max_movement > 4. * noise
        || x.iter().any(|v| !v.is_finite())
        || clock.expired()
    {
        return None;
    }
    Some((place(geometry, points, &x), report))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constructions_have_no_preferred_paper_edge() {
        for &value in simple_values() {
            assert!((nearest(simple_values(), 1. - value) - (1. - value)).abs() < 1e-15);
        }
    }

    #[test]
    fn preserve_a_rational_that_is_absent_from_the_small_dictionary() {
        assert!(already_constructed(3. / 44.));
        assert!(already_constructed(11. / 12.));
    }

    #[test]
    fn an_independent_anchor_propagates_without_choosing_a_pivot_coordinate() {
        let clock = ExactSolveDeadline::start(1., None);
        let mut basis = Basis::new();
        assert_eq!(
            basis.insert(BTreeMap::from([(0, 1.), (1, -2.)]), 0., &clock),
            Some(true)
        );
        assert_eq!(
            basis.insert(BTreeMap::from([(0, 1.)]), 0.5, &clock),
            Some(true)
        );
        assert_eq!(basis.back_substitute(&[0.501, 0.251]), vec![0.5, 0.25]);
        assert_eq!(basis.insert(BTreeMap::from([(1, 1.)]), 0.3, &clock), None);
        assert_eq!(basis.back_substitute(&[0.501, 0.251]), vec![0.5, 0.25]);
    }
}
