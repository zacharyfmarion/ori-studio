use crate::{
    Input, SpreadError,
    reach::{Reach, ordered_pairs},
};
use nalgebra::{Matrix3, Vector3};
use oristudio_geometry::convex;
use std::collections::{BTreeMap, HashMap};

pub type Row = Vec<(usize, f64)>;

pub fn row(terms: impl IntoIterator<Item = (usize, f64)>) -> Row {
    let mut out = BTreeMap::<usize, f64>::new();
    for (id, value) in terms {
        *out.entry(id).or_default() += value;
    }
    out.into_iter().filter(|(_, v)| v.abs() > 1e-12).collect()
}

pub fn value(row: &Row, z: &[f64]) -> f64 {
    row.iter().map(|&(i, w)| z[i] * w).sum()
}

pub struct Sample {
    pub row: Row,
    pub weight: f64,
}

pub struct Prepared {
    pub xy: Vec<[f64; 2]>,
    pub inverse: Vec<Matrix3<f64>>,
    pub face_triangles: Vec<Vec<usize>>,
    pub gaps: Vec<Sample>,
    pub crossings: Vec<Sample>,
    /// The overlap area the crossing penalties are weighed against.
    pub crossing_mass: f64,
    pub reach: Reach,
    pub overlap_regions: usize,
}

fn invalid(message: &str) -> SpreadError {
    SpreadError::Invalid(message.into())
}

/// Overlapping triangle pairs that become crossing penalties: the solver's size.
const MAX_OVERLAP_REGIONS: usize = 200_000;
const TOO_MANY_REGIONS: &str = "overlap regions";
/// Triangle pairs the sweep may look up. Most are skipped without a clip.
const MAX_PAIR_TESTS: usize = 20_000_000;

/// How two overlapping faces are ordered.
#[derive(Clone, Copy)]
struct Order {
    lower: usize,
    /// The fewest places apart any overlap cell stacks the two, when that is
    /// near. `usize::MAX` when every cell has them further apart.
    apart: usize,
}

fn pair_key(a: usize, b: usize) -> (usize, usize) {
    (a.min(b), a.max(b))
}

impl Prepared {
    pub fn new(input: &Input) -> Result<Self, SpreadError> {
        Self::within(input, MAX_OVERLAP_REGIONS)
    }

    /// `new`, for a solver that may penalize `max_regions` overlap regions.
    fn within(input: &Input, max_regions: usize) -> Result<Self, SpreadError> {
        let nv = input.xy.len();
        let nf = input.faces.len();
        if nv > 20_000 || input.triangles.len() > 40_000 || nf > 10_000 {
            return Err(SpreadError::Limit("material topology"));
        }
        if nv < 3
            || nf == 0
            || input.triangles.is_empty()
            || input.triangle_faces.len() != input.triangles.len()
            || input
                .xy
                .iter()
                .flatten()
                .any(|v| !v.is_finite() || v.abs() > 10.)
            || input
                .faces
                .iter()
                .any(|f| f.len() < 3 || f.iter().any(|&v| v >= nv))
        {
            return Err(invalid("coordinates or face rings"));
        }
        if input
            .plane_groups
            .as_ref()
            .is_some_and(|groups| groups.len() != nf || groups.iter().any(|&g| g >= nf))
        {
            return Err(invalid("planarity groups"));
        }
        let xy: Vec<[f64; 2]> = input
            .xy
            .iter()
            .map(|p| p.map(|v| f64::from(v as f32)))
            .collect();
        let mut inverse = Vec::with_capacity(input.triangles.len());
        let mut face_triangles = vec![Vec::new(); nf];
        let mut polygons = Vec::with_capacity(input.triangles.len());
        for (t, (&ids, &owner)) in input
            .triangles
            .iter()
            .zip(&input.triangle_faces)
            .enumerate()
        {
            if owner >= nf
                || ids
                    .iter()
                    .any(|&v| v >= nv || !input.faces[owner].contains(&v))
            {
                return Err(invalid("triangle material indices"));
            }
            let [a, b, c] = ids.map(|v| xy[v]);
            let matrix = Matrix3::new(a[0], b[0], c[0], a[1], b[1], c[1], 1., 1., 1.);
            if matrix.determinant().abs() < 1e-14 {
                return Err(invalid("degenerate triangle"));
            }
            inverse.push(
                matrix
                    .try_inverse()
                    .ok_or_else(|| invalid("singular triangle"))?,
            );
            polygons.push(convex::normalize(&[a, b, c]));
            face_triangles[owner].push(t);
        }
        if face_triangles.iter().any(Vec::is_empty) {
            return Err(invalid("face without triangulation"));
        }
        let mut relation = HashMap::new();
        for &[lo, hi] in &input.orders {
            if lo >= nf || hi >= nf || lo == hi {
                return Err(invalid("layer relation"));
            }
            let order = Order {
                lower: lo,
                apart: usize::MAX,
            };
            if relation
                .insert(pair_key(lo, hi), order)
                .is_some_and(|old| old.lower != lo)
            {
                return Err(invalid("contradictory face-pair order"));
            }
        }
        let mut prepared = Self {
            xy,
            inverse,
            face_triangles,
            gaps: Vec::new(),
            crossings: Vec::new(),
            crossing_mass: 0.,
            reach: Reach::Near,
            overlap_regions: 0,
        };
        // Overlap area summed over every ordered pair of faces.
        let mut ordered_area = 0.;
        for cell in &input.cells {
            if !cell.area.is_finite()
                || cell.area < 0.
                || cell.point.iter().any(|v| !v.is_finite())
                || cell.faces.iter().any(|&f| f >= nf)
            {
                return Err(invalid("overlap cell"));
            }
            for (upper, lower) in Reach::Near.pairs(cell.faces.len()) {
                let pair = pair_key(cell.faces[upper], cell.faces[lower]);
                if let Some(order) = relation.get_mut(&pair) {
                    order.apart = order.apart.min(lower - upper);
                }
            }
            if cell.area <= 1e-14 {
                continue;
            }
            ordered_area += cell.area * ordered_pairs(cell.faces.len()) as f64;
            for pair in cell.faces.windows(2) {
                let upper = prepared.at_face(input, pair[0], cell.point)?;
                let lower = prepared.at_face(input, pair[1], cell.point)?;
                let terms = row(upper
                    .into_iter()
                    .chain(lower.into_iter().map(|(v, w)| (v, -w))));
                if !terms.is_empty() {
                    prepared.gaps.push(Sample {
                        row: terms,
                        weight: cell.area,
                    });
                }
            }
        }
        // A model with too many near pairs to solve keeps the layers that touch.
        Reach::widest(
            |reach| prepared.penalize(input, &polygons, &relation, reach, max_regions),
            |error| matches!(error, SpreadError::Limit(TOO_MANY_REGIONS)),
        )?;
        let penalized = prepared.crossings.iter().map(|s| s.weight).sum();
        prepared.crossing_mass = prepared.reach.mass(penalized, ordered_area);
        Ok(prepared)
    }

    /// Crossing samples for the overlapping triangles of every pair of faces
    /// that some cell stacks within `reach` of each other.
    fn penalize(
        &mut self,
        input: &Input,
        polygons: &[Vec<[f64; 2]>],
        relation: &HashMap<(usize, usize), Order>,
        reach: Reach,
        max_regions: usize,
    ) -> Result<(), SpreadError> {
        self.crossings.clear();
        self.overlap_regions = 0;
        self.reach = reach;
        // Sweep in X: no quadratic all-triangle array or pairwise dense matrix.
        let boxes: Vec<_> = polygons.iter().map(|p| convex::bounding_box(p)).collect();
        let mut sorted: Vec<_> = (0..polygons.len()).collect();
        sorted.sort_by(|&a, &b| boxes[a][0].total_cmp(&boxes[b][0]).then(a.cmp(&b)));
        let mut active = Vec::<usize>::new();
        let mut dedup = HashMap::<Vec<(usize, i64)>, usize>::new();
        let mut pair_tests = 0_usize;
        for &a in &sorted {
            active.retain(|&b| boxes[b][2] >= boxes[a][0]);
            for &b in &active {
                let (fa, fb) = (input.triangle_faces[a], input.triangle_faces[b]);
                if fa == fb || !convex::boxes_overlap(&boxes[a], &boxes[b], 0.) {
                    continue;
                }
                pair_tests += 1;
                if pair_tests > MAX_PAIR_TESTS {
                    return Err(SpreadError::Limit("overlap pairs"));
                }
                let order = relation.get(&pair_key(fa, fb)).copied();
                // Faces far apart in every stack they share are held in order
                // through the layers between them, each kept from crossing its
                // neighbours. A penalty of their own would only repeat that.
                if order.is_some_and(|order| order.apart > reach.places()) {
                    continue;
                }
                let polygon = convex::clip(&polygons[a], &polygons[b]);
                let area = convex::signed_area(&polygon).abs();
                if area <= 1e-16 || polygon.len() < 3 {
                    continue;
                }
                self.overlap_regions += 1;
                if self.overlap_regions > max_regions {
                    return Err(SpreadError::Limit(TOO_MANY_REGIONS));
                }
                let lower = match order {
                    Some(order) => {
                        if order.lower == fa {
                            a
                        } else {
                            b
                        }
                    }
                    None if area <= 2e-8 => continue, // Floating-point slivers are not invented material orders.
                    None => return Err(invalid("significant overlap missing layer order")),
                };
                let upper = if lower == a { b } else { a };
                // Each unique corner receives equal area mass. A closing ring
                // coordinate is not a second geometric sample.
                let weight = area / polygon.len() as f64;
                for point in polygon {
                    let terms = row(self.at_triangle(input, upper, point).into_iter().chain(
                        self.at_triangle(input, lower, point)
                            .into_iter()
                            .map(|(v, w)| (v, -w)),
                    ));
                    if terms.is_empty() {
                        continue;
                    }
                    let key: Vec<_> = terms
                        .iter()
                        .map(|&(v, w)| (v, (w * 1e10).round() as i64))
                        .collect();
                    if let Some(&at) = dedup.get(&key) {
                        self.crossings[at].weight += weight;
                    } else {
                        dedup.insert(key, self.crossings.len());
                        self.crossings.push(Sample { row: terms, weight });
                    }
                }
            }
            active.push(a);
        }
        Ok(())
    }

    pub fn at_triangle(&self, input: &Input, triangle: usize, point: [f64; 2]) -> Row {
        let weights = self.inverse[triangle] * Vector3::new(point[0], point[1], 1.);
        input.triangles[triangle]
            .iter()
            .copied()
            .zip(weights.iter().copied())
            .collect()
    }

    pub fn at_face(&self, input: &Input, face: usize, point: [f64; 2]) -> Result<Row, SpreadError> {
        let mut best = None;
        for &triangle in &self.face_triangles[face] {
            let row = self.at_triangle(input, triangle, point);
            let minimum = row.iter().map(|&(_, w)| w).fold(f64::INFINITY, f64::min);
            if best.as_ref().is_none_or(|(score, _)| minimum > *score) {
                best = Some((minimum, row));
            }
        }
        match best {
            Some((minimum, row)) if minimum >= -2e-5 => Ok(row),
            _ => Err(invalid("cell centroid outside its face")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Cell, qp};

    /// `layers` loose unit squares, face 0 on top. Two squares overlap in two
    /// triangle pairs, of area one in all.
    fn stack(layers: usize) -> Input {
        let corners = [[0., 0.], [1., 0.], [1., 1.], [0., 1.]];
        Input {
            xy: (0..layers).flat_map(|_| corners).collect(),
            faces: (0..layers).map(|f| (4 * f..4 * f + 4).collect()).collect(),
            triangles: (0..layers)
                .flat_map(|f| [[4 * f, 4 * f + 1, 4 * f + 2], [4 * f, 4 * f + 2, 4 * f + 3]])
                .collect(),
            triangle_faces: (0..layers).flat_map(|f| [f, f]).collect(),
            orders: (0..layers)
                .flat_map(|upper| (upper + 1..layers).map(move |lower| [lower, upper]))
                .collect(),
            plane_groups: None,
            cells: vec![Cell {
                faces: (0..layers).collect(),
                point: [0.6, 0.3],
                area: 1.,
            }],
        }
    }

    // Thirty layers: 204 pairs lie within eight places, 29 touch, 435 overlap.
    const NEAR: usize = 2 * 204;
    const TOUCHING: usize = 2 * 29;

    #[test]
    fn near_pairs_within_the_limit_are_weighed_against_every_overlap() {
        let prepared = Prepared::within(&stack(30), NEAR).unwrap();
        assert_eq!(prepared.reach, Reach::Near);
        assert_eq!(prepared.overlap_regions, NEAR);
        assert!((prepared.crossing_mass - 435.).abs() < 1e-9);
    }

    #[test]
    fn too_many_near_pairs_fall_back_to_the_layers_that_touch() {
        let input = stack(30);
        let prepared = Prepared::within(&input, NEAR - 1).unwrap();
        assert_eq!(prepared.reach, Reach::Touching);
        assert_eq!(prepared.overlap_regions, TOUCHING);
        // Weighed against themselves: the overlap of the 29 touching pairs.
        assert!((prepared.crossing_mass - 29.).abs() < 1e-9);
        let solution = qp::solve(&input, &prepared).unwrap();
        assert_eq!(solution.diagnostics.reach, 1);
        let level = |face: usize| &solution.heights[4 * face..4 * face + 4];
        for upper in 0..29 {
            let lowest = level(upper).iter().copied().fold(f64::INFINITY, f64::min);
            let highest = level(upper + 1)
                .iter()
                .copied()
                .fold(f64::NEG_INFINITY, f64::max);
            assert!(lowest > highest, "face {upper} is not above the next");
        }
    }

    #[test]
    fn refuses_when_the_layers_that_touch_are_too_many_as_well() {
        assert!(matches!(
            Prepared::within(&stack(30), TOUCHING - 1),
            Err(SpreadError::Limit(TOO_MANY_REGIONS))
        ));
        assert!(Prepared::within(&stack(30), TOUCHING).is_ok());
    }
}
