//! Select independent anchors by the construction cost of the whole graph.
//! The catalog is generated from integer expressions, never from reference CPs.
use super::*;

const BAND: f64 = 0.002;

struct Catalog {
    values: Vec<f64>,
    costs: Vec<f64>,
}

fn catalog(include_sqrt_three: bool) -> &'static Catalog {
    static ORDINARY: OnceLock<Catalog> = OnceLock::new();
    static FIFTEEN_DEGREES: OnceLock<Catalog> = OnceLock::new();
    let cache = if include_sqrt_three {
        &FIFTEEN_DEGREES
    } else {
        &ORDINARY
    };
    cache.get_or_init(|| {
        let mut entries: BTreeMap<i64, (f64, i32)> = BTreeMap::new();
        let mut add = |value: f64, cost: i32| {
            let key = (value * 1e14).round() as i64;
            let entry = entries.entry(key).or_insert((value, cost));
            if cost < entry.1 {
                *entry = (value, cost);
            }
        };
        // Iterating denominators upwards gives reduced fractions their cheapest
        // representation first, with equal cost measured from either edge.
        for denominator in 1..=64 {
            for numerator in 0..=denominator {
                add(
                    f64::from(numerator) / f64::from(denominator),
                    denominator + numerator.min(denominator - numerator),
                );
            }
        }
        for radicand in [2, 3] {
            if radicand == 3 && !include_sqrt_three {
                continue;
            }
            let root = f64::from(radicand).sqrt();
            for r in 1_i32..=24 {
                for q in -24_i32..=24 {
                    for p in -24_i32..=24 {
                        let cost = p.abs() + q.abs() + r;
                        if cost > 24 {
                            continue;
                        }
                        let value = (f64::from(p) + f64::from(q) * root) / f64::from(r);
                        if (0.0..=1.0).contains(&value) {
                            add(value, cost);
                            add(1. - value, cost);
                        }
                    }
                }
            }
        }
        let (values, costs) = entries
            .into_values()
            .map(|(value, cost)| (value, (1. + f64::from(cost)).log2()))
            .unzip();
        Catalog { values, costs }
    })
}

impl Catalog {
    fn cost(&self, x: &[f64], original: &[f64], observation_weight: f64) -> f64 {
        x.iter()
            .zip(original)
            .map(|(&value, &observed)| {
                let i = self.values.partition_point(|v| *v < value);
                let left = i.saturating_sub(1);
                let right = i.min(self.values.len() - 1);
                let nearest =
                    if (value - self.values[left]).abs() <= (value - self.values[right]).abs() {
                        left
                    } else {
                        right
                    };
                let complexity = if (value - self.values[nearest]).abs() < KNOWN_EPSILON {
                    self.costs[nearest]
                } else {
                    8.
                };
                complexity + observation_weight * ((value - observed) / BAND).powi(2)
            })
            .sum()
    }
}

pub(in crate::exact_solve) fn description_cost(points: &[Point2]) -> f64 {
    let coordinates: Vec<_> = points.iter().flat_map(|p| [p.x, p.y]).collect();
    // Use the same catalog for both answers, irrespective of their detected
    // angle family, so their description lengths are directly comparable.
    catalog(true).cost(&coordinates, &coordinates, 0.)
}

fn has_fifteen_degree_edges(input: &ExactSolveInput, points: &[Point2]) -> bool {
    input
        .selected_spans
        .iter()
        .filter(|span| {
            let [a, b] = span.vertices;
            let angle = (points[b].y - points[a].y).atan2(points[b].x - points[a].x);
            let fifteen = std::f64::consts::PI / 12.;
            let half = std::f64::consts::PI / 16.;
            (angle - (angle / fifteen).round() * fifteen).abs() < 1e-6
                && (angle - (angle / half).round() * half).abs() > 1e-6
        })
        .take(2)
        .count()
        == 2
}

pub(in super::super) fn propose(
    geometry: &LinearGeometry,
    input: &ExactSolveInput,
    points: &[Point2],
    clock: &ExactSolveDeadline,
    observation_weight: f64,
) -> Option<(Vec<Point2>, Value)> {
    let original: Vec<_> = geometry
        .variables
        .iter()
        .map(|&(v, axis)| get(points[v], axis))
        .collect();
    if original.is_empty() || original.iter().all(|&v| already_constructed(v)) || clock.expired() {
        return None;
    }
    let values = catalog(has_fifteen_degree_edges(input, points));
    let mut basis = Basis::new();
    for row in &geometry.rows {
        basis.insert(row.entries.iter().copied().collect(), row.rhs, clock)?;
    }
    for (c, &value) in original.iter().enumerate() {
        if already_constructed(value) {
            // An inconsistent supposed fact must not displace the current
            // solution. Precision is handled separately after construction.
            basis.insert(BTreeMap::from([(c, 1.)]), value, clock)?;
        }
    }
    let nullity = original.len() - basis.order.len();
    let mut reports = Vec::new();
    let mut evaluations = 0;
    for _ in 0..nullity.min(12) {
        if clock.expired() {
            break;
        }
        let current = basis.back_substitute(&original);
        let current_cost = values.cost(&current, &original, observation_weight);
        let mut best: Option<(f64, usize, f64)> = None;
        let mut exhausted = false;
        for (c, &observed) in original.iter().enumerate() {
            if clock.expired() {
                exhausted = true;
                break;
            }
            let Some(independent) = basis.insert(BTreeMap::from([(c, 1.)]), current[c] + 1., clock)
            else {
                continue;
            };
            if !independent {
                continue;
            }
            let mut direction = basis.back_substitute(&original);
            if let Some(column) = basis.order.pop() {
                basis.pivots.remove(&column);
            }
            for (value, &start) in direction.iter_mut().zip(&current) {
                *value -= start;
            }
            let lo = values.values.partition_point(|v| *v < observed - BAND);
            let hi = values.values.partition_point(|v| *v < observed + BAND);
            for &target in &values.values[lo..hi] {
                if clock.expired() {
                    exhausted = true;
                    break;
                }
                let proposed: Vec<_> = current
                    .iter()
                    .zip(&direction)
                    .map(|(v, d)| v + d * (target - current[c]))
                    .collect();
                if movement(geometry, points, &proposed) > 4. * BAND {
                    continue;
                }
                evaluations += 1;
                let score = values.cost(&proposed, &original, observation_weight);
                if score < current_cost - 1e-6 && best.is_none_or(|(best, _, _)| score < best) {
                    best = Some((score, c, target));
                }
            }
            if exhausted {
                break;
            }
        }
        // A partially searched round is not an order-independent choice.
        if exhausted {
            break;
        }
        let Some((cost, c, target)) = best else {
            break;
        };
        basis.insert(BTreeMap::from([(c, 1.)]), target, clock)?;
        reports
            .push(json!({"coordinate":c,"target":target,"cost":cost,"before_cost":current_cost}));
    }
    let x = basis.back_substitute(&original);
    let residual = max_residual(geometry, &x);
    let max_movement = movement(geometry, points, &x);
    if residual > 1e-10 || max_movement > 4. * BAND || x.iter().any(|v| !v.is_finite()) {
        return None;
    }
    Some((
        place(geometry, points, &x),
        json!({"method":"joint_construction_anchors",
        "anchors":reports,"evaluations":evaluations,"linear_nullity_before":nullity,
        "linear_nullity_after":original.len()-basis.order.len(),"max_residual":residual,
            "max_movement":max_movement,"observation_weight":observation_weight}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalog_represents_fine_rationals_and_reflection_equally() {
        let values = catalog(false);
        let left = values.cost(&[1. / 32.], &[1. / 32.], 8.);
        let right = values.cost(&[31. / 32.], &[31. / 32.], 8.);
        assert!(left < 8.);
        assert_eq!(left, right);
    }
}
