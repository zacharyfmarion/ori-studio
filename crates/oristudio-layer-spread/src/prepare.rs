use crate::{Input, SpreadError};
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
    pub overlap_regions: usize,
}

fn invalid(message: &str) -> SpreadError {
    SpreadError::Invalid(message.into())
}

impl Prepared {
    pub fn new(input: &Input) -> Result<Self, SpreadError> {
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
            let key = (lo.min(hi), lo.max(hi));
            if relation
                .insert(key, (lo, hi))
                .is_some_and(|old| old != (lo, hi))
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
            overlap_regions: 0,
        };
        for cell in &input.cells {
            if !cell.area.is_finite()
                || cell.area < 0.
                || cell.point.iter().any(|v| !v.is_finite())
                || cell.faces.iter().any(|&f| f >= nf)
            {
                return Err(invalid("overlap cell"));
            }
            if cell.area <= 1e-14 {
                continue;
            }
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
        // Sweep in X: no quadratic all-triangle array or pairwise dense matrix.
        let boxes: Vec<_> = polygons.iter().map(|p| convex::bounding_box(p)).collect();
        let mut sorted: Vec<_> = (0..polygons.len()).collect();
        sorted.sort_by(|&a, &b| boxes[a][0].total_cmp(&boxes[b][0]).then(a.cmp(&b)));
        let mut active = Vec::<usize>::new();
        let mut dedup = HashMap::<Vec<(usize, i64)>, usize>::new();
        for &a in &sorted {
            active.retain(|&b| boxes[b][2] >= boxes[a][0]);
            for &b in &active {
                let (fa, fb) = (input.triangle_faces[a], input.triangle_faces[b]);
                if fa == fb || !convex::boxes_overlap(&boxes[a], &boxes[b], 0.) {
                    continue;
                }
                let polygon = convex::clip(&polygons[a], &polygons[b]);
                let area = convex::signed_area(&polygon).abs();
                if area <= 1e-16 || polygon.len() < 3 {
                    continue;
                }
                prepared.overlap_regions += 1;
                if prepared.overlap_regions > 200_000 {
                    return Err(SpreadError::Limit("overlap regions"));
                }
                let key = (fa.min(fb), fa.max(fb));
                let lower = match relation.get(&key) {
                    Some(&(lo, _)) => {
                        if lo == fa {
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
                    let terms = row(prepared.at_triangle(input, upper, point).into_iter().chain(
                        prepared
                            .at_triangle(input, lower, point)
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
                        prepared.crossings[at].weight += weight;
                    } else {
                        dedup.insert(key, prepared.crossings.len());
                        prepared.crossings.push(Sample { row: terms, weight });
                    }
                }
            }
            active.push(a);
        }
        Ok(prepared)
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
