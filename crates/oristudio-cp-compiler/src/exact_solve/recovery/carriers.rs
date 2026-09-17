//! Propagate line equations from two already-recognized points on a carrier.
use super::*;

fn root(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

pub(super) fn augment(
    geometry: &mut LinearGeometry,
    input: &ExactSolveInput,
    points: &[Point2],
    clock: &ExactSolveDeadline,
) -> Option<usize> {
    let mut parent: Vec<_> = (0..input.selected_spans.len()).collect();
    let mut incident = vec![Vec::new(); points.len()];
    for (i, span) in input.selected_spans.iter().enumerate() {
        let [a, b] = span.vertices;
        incident[a].push((i, b));
        incident[b].push((i, a));
    }
    for (v, rays) in incident.iter().enumerate() {
        if clock.expired() {
            return None;
        }
        for (i, &(a, x)) in rays.iter().enumerate() {
            let dx = points[x].x - points[v].x;
            let dy = points[x].y - points[v].y;
            let length = dx.hypot(dy);
            if length < 1e-12 {
                continue;
            }
            for &(b, y) in &rays[i + 1..] {
                let ex = points[y].x - points[v].x;
                let ey = points[y].y - points[v].y;
                let other = ex.hypot(ey);
                if other < 1e-12 || dx * ex + dy * ey >= 0. {
                    continue;
                }
                if (dx * ey - dy * ex).abs() <= 1e-6 * length * other {
                    let left = root(&mut parent, a);
                    let right = root(&mut parent, b);
                    parent[left.max(right)] = left.min(right);
                }
            }
        }
    }
    let mut groups: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
    for (i, span) in input.selected_spans.iter().enumerate() {
        groups
            .entry(root(&mut parent, i))
            .or_default()
            .extend(span.vertices);
    }
    let exact: Vec<_> = points
        .iter()
        .map(|p| {
            Some(Point2::new(
                constructions::recognized_coordinate(p.x)?,
                constructions::recognized_coordinate(p.y)?,
            ))
        })
        .collect();
    let mut indices = vec![[None; 2]; points.len()];
    for (i, &(v, axis)) in geometry.variables.iter().enumerate() {
        indices[v][axis] = Some(i);
    }
    let mut added = 0;
    for vertices in groups.values() {
        if clock.expired() {
            return None;
        }
        let seeds: Vec<_> = vertices.iter().filter_map(|&v| exact[v]).collect();
        if seeds.len() < 2 {
            continue;
        }
        // On a straight carrier the extremes of either coordinate determine
        // the farthest pair; use the wider axis to avoid near-vertical noise.
        let endpoints: Vec<_> = (0..2)
            .filter_map(|axis| {
                let lo = seeds
                    .iter()
                    .min_by(|a, b| get(**a, axis).total_cmp(&get(**b, axis)))?;
                let hi = seeds
                    .iter()
                    .max_by(|a, b| get(**a, axis).total_cmp(&get(**b, axis)))?;
                Some((*lo, *hi))
            })
            .collect();
        let &(a, b) = endpoints
            .iter()
            .max_by(|(a, b), (c, d)| distance(*a, *b).total_cmp(&distance(*c, *d)))?;
        let length = distance(a, b);
        if length < 1e-5 {
            continue;
        }
        let normal = [(a.y - b.y) / length, (b.x - a.x) / length];
        let rho = normal[0] * a.x + normal[1] * a.y;
        if vertices
            .iter()
            .any(|&v| (normal[0] * points[v].x + normal[1] * points[v].y - rho).abs() > 1e-5)
        {
            continue;
        }
        for &v in vertices {
            let mut rhs = rho;
            let mut entries = Vec::new();
            for (axis, &coefficient) in normal.iter().enumerate() {
                if let Some(c) = indices[v][axis] {
                    entries.push((c, coefficient));
                } else {
                    rhs -= coefficient * get(points[v], axis);
                }
            }
            geometry.rows.push(Row { entries, rhs });
        }
        added += 1;
    }
    Some(added)
}
