//! Connected spatial opening. Original Ori Studio display geometry, not a
//! physical fold or a change to the admitted kernel placement.
use crate::{
    SpreadError,
    prepare::{Row, Sample, row, value},
};
use clarabel::{algebra::CscMatrix, solver::*};
use nalgebra::{Matrix3, Vector3};
use oristudio_geometry::convex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
mod crossings;
use crossings::{CrossingAccumulator, Crossings};

pub const VERSION: &str = "spatial-vector-v1";
type V3 = [f64; 3];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cell {
    /// One convex piece of the source cell, in normalized world coordinates.
    pub ring: Vec<V3>,
    /// Top first along normal. Only determined stacks may enter this API.
    pub faces: Vec<usize>,
    pub normal: V3,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Input {
    /// Longest folded extent is two. Material identity survives coincident positions.
    pub positions: Vec<V3>,
    pub faces: Vec<Vec<usize>>,
    pub triangles: Vec<[usize; 3]>,
    pub triangle_faces: Vec<usize>,
    /// Zero-angle connected pieces share a rigid-motion regularizer.
    pub groups: Vec<usize>,
    pub cells: Vec<Cell>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Solution {
    pub version: String,
    pub displacements: Vec<V3>,
    pub constraint_residual: f64,
    pub mean_gap: f64,
    pub max_order_violation: f64,
    pub status: String,
}

fn invalid(s: &str) -> SpreadError {
    SpreadError::Invalid(s.into())
}
fn sub(a: V3, b: V3) -> V3 {
    [0, 1, 2].map(|i| a[i] - b[i])
}
fn dot(a: V3, b: V3) -> f64 {
    (0..3).map(|i| a[i] * b[i]).sum()
}
fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn norm(a: V3) -> f64 {
    dot(a, a).sqrt()
}
fn skew([x, y, z]: V3) -> [[f64; 3]; 3] {
    [[0., -z, y], [z, 0., -x], [-y, x, 0.]]
}

#[derive(Default)]
struct Matrix {
    r: Vec<usize>,
    c: Vec<usize>,
    v: Vec<f64>,
}
impl Matrix {
    fn push(&mut self, r: usize, c: usize, v: f64) {
        self.r.push(r);
        self.c.push(c);
        self.v.push(v);
    }
    fn finish(self, m: usize, n: usize) -> CscMatrix<f64> {
        CscMatrix::new_from_triplets(m, n, self.r, self.c, self.v)
    }
}
struct Problem {
    p: Matrix,
    q: Vec<f64>,
    rows: Vec<Row>,
    bounds: Vec<f64>,
}
impl Problem {
    fn objective(&mut self, terms: &Row, target: f64, weight: f64) {
        for &(i, x) in terms {
            self.q[i] -= 2. * weight * target * x;
            for &(j, y) in terms {
                if i <= j {
                    self.p.push(i, j, 2. * weight * x * y);
                }
            }
        }
    }
    fn upper(&mut self, terms: Row, bound: f64) {
        self.rows.push(terms);
        self.bounds.push(bound);
    }
    fn bound(&mut self, terms: Row, bound: f64) {
        self.upper(terms.iter().map(|&(i, x)| (i, -x)).collect(), bound);
        self.upper(terms, bound);
    }
}

fn samples(input: &Input) -> Result<(Vec<Sample>, Crossings), SpreadError> {
    let mut face_triangles = vec![Vec::new(); input.faces.len()];
    for (t, &f) in input.triangle_faces.iter().enumerate() {
        face_triangles[f].push(t);
    }
    if face_triangles.iter().any(Vec::is_empty) {
        return Err(invalid("face without triangles"));
    }
    let mut gaps = Vec::new();
    let mut crossings = CrossingAccumulator::default();
    let mut work = 0usize;
    for cell in &input.cells {
        let n = cell.normal;
        if (norm(n) - 1.).abs() > 1e-6
            || cell.faces.iter().any(|&f| f >= input.faces.len())
            || cell.ring.len() < 3
            || cell
                .ring
                .iter()
                .flatten()
                .any(|v| !v.is_finite() || v.abs() > 10.)
        {
            return Err(invalid("spatial cell"));
        }
        if cell.faces.iter().collect::<BTreeSet<_>>().len() != cell.faces.len() {
            return Err(invalid("repeated cell face"));
        }
        let axis = if n[0].abs() < 0.8 {
            [1., 0., 0.]
        } else {
            [0., 1., 0.]
        };
        let u = cross(n, axis);
        let u = u.map(|v| v / norm(u));
        let v = cross(n, u);
        let project = |p: V3| [dot(p, u), dot(p, v)];
        let support = convex::normalize(&cell.ring.iter().map(|&p| project(p)).collect::<Vec<_>>());
        if !convex::is_convex(&support, 1e-8) {
            return Err(invalid("non-convex spatial cell piece"));
        }
        let mut triangles = BTreeMap::new();
        for &f in &cell.faces {
            for &t in &face_triangles[f] {
                work += 1;
                if work > 2_000_000 {
                    return Err(SpreadError::Limit("spatial triangle preparation"));
                }
                let ids = input.triangles[t];
                let [a, b, c] = ids.map(|i| project(input.positions[i]));
                let inverse = Matrix3::new(a[0], b[0], c[0], a[1], b[1], c[1], 1., 1., 1.)
                    .try_inverse()
                    .ok_or_else(|| invalid("degenerate spatial triangle"))?;
                triangles.insert(t, (convex::normalize(&[a, b, c]), inverse));
            }
        }
        for i in 0..cell.faces.len() {
            for j in i + 1..cell.faces.len() {
                for &upper in &face_triangles[cell.faces[i]] {
                    for &lower in &face_triangles[cell.faces[j]] {
                        work += 1;
                        if work > 2_000_000 {
                            return Err(SpreadError::Limit("spatial overlap pairs"));
                        }
                        let (up, ui) = &triangles[&upper];
                        let (lo, li) = &triangles[&lower];
                        if !convex::boxes_overlap(
                            &convex::bounding_box(up),
                            &convex::bounding_box(lo),
                            0.,
                        ) {
                            continue;
                        }
                        let overlap = convex::clip(&convex::clip(up, lo), &support);
                        let area = convex::signed_area(&overlap);
                        if area < 1e-12 {
                            continue;
                        }
                        let gap = |p: [f64; 2]| {
                            let h = Vector3::new(p[0], p[1], 1.);
                            let uw = ui * h;
                            let lw = li * h;
                            row([(upper, uw, 1.), (lower, lw, -1.)].into_iter().flat_map(
                                |(t, w, s)| {
                                    input.triangles[t].into_iter().enumerate().flat_map(
                                        move |(k, id)| {
                                            (0..3).map(move |a| (3 * id + a, s * w[k] * n[a]))
                                        },
                                    )
                                },
                            ))
                        };
                        if j == i + 1
                            && let Some(center) = convex::centroid(&overlap)
                        {
                            gaps.push(Sample {
                                row: gap(center),
                                weight: area,
                            });
                            if gaps.len() > 100_000 {
                                return Err(SpreadError::Limit("spatial gap samples"));
                            }
                        }
                        for &point in &overlap {
                            // Compaction bounds retained memory; this separately
                            // bounds raw work even when every row is a duplicate.
                            work += 1;
                            if work > 2_000_000 {
                                return Err(SpreadError::Limit("spatial overlap samples"));
                            }
                            crossings.push(Sample {
                                row: gap(point),
                                weight: area / overlap.len() as f64,
                            })?;
                        }
                    }
                }
            }
        }
    }
    Ok((gaps, crossings.finish()))
}

pub fn solve(input: &Input) -> Result<Solution, SpreadError> {
    let nv = input.positions.len();
    let nf = input.faces.len();
    if nv > 10_000 || nf > 5_000 || input.triangles.len() > 20_000 || input.cells.len() > 40_000 {
        return Err(SpreadError::Limit("spatial material"));
    }
    if nv < 3
        || nf == 0
        || input.groups.len() != nf
        || input.triangle_faces.len() != input.triangles.len()
        || input
            .positions
            .iter()
            .flatten()
            .any(|v| !v.is_finite() || v.abs() > 10.)
        || input
            .faces
            .iter()
            .any(|f| f.len() < 3 || f.iter().any(|&v| v >= nv))
        || input.groups.iter().any(|&g| g >= nf)
        || input
            .triangles
            .iter()
            .zip(&input.triangle_faces)
            .any(|(t, &f)| f >= nf || t.iter().any(|v| !input.faces[f].contains(v)))
    {
        return Err(invalid("spatial topology"));
    }
    let (gaps, crossings) = samples(input)?;
    let Crossings {
        samples: crossings,
        total_weight: crossing_mass,
        rounding_gap_bound,
    } = crossings;
    if gaps.is_empty() {
        return Ok(Solution {
            version: VERSION.into(),
            displacements: vec![[0.; 3]; nv],
            constraint_residual: 0.,
            mean_gap: 0.,
            max_order_violation: 0.,
            status: "no-stacks".into(),
        });
    }
    let mut groups = BTreeMap::<usize, Vec<usize>>::new();
    for (f, &g) in input.groups.iter().enumerate() {
        groups.entry(g).or_default().push(f);
    }
    let base = 3 * nv + 6 * groups.len();
    let count = base + crossings.len();
    let mut problem = Problem {
        p: Matrix::default(),
        q: vec![0.; count],
        rows: Vec::new(),
        bounds: Vec::new(),
    };
    for axis in 0..3 {
        problem.upper(
            (0..nv).map(|v| (3 * v + axis, 1. / nv as f64)).collect(),
            0.,
        );
        problem.upper(
            row(input.positions.iter().enumerate().flat_map(|(v, &p)| {
                (0..3).map(move |k| (3 * v + k, skew(p)[axis][k] / nv as f64))
            })),
            0.,
        );
    }
    let depth = input.cells.iter().map(|c| c.faces.len()).max().unwrap_or(1);
    let target = 0.18 / depth.saturating_sub(1).max(1) as f64;
    let spacing_mass: f64 = gaps.iter().map(|s| s.weight).sum();
    for s in &gaps {
        problem.objective(&s.row, target, s.weight);
    }
    for (i, s) in crossings.iter().enumerate() {
        let slack = base + i;
        let mut terms: Row = s.row.iter().map(|&(v, w)| (v, -w)).collect();
        terms.push((slack, -1.));
        problem.upper(terms, 0.);
        // Minimizing the positive quadratic under s >= -gap already yields
        // s = max(0, -gap). A second s >= 0 row is redundant at the optimum.
        problem.objective(
            &vec![(slack, 1.)],
            0.,
            50. * spacing_mass / crossing_mass * s.weight,
        );
    }
    for (g, faces) in groups.values().enumerate() {
        let vertices: BTreeSet<_> = faces
            .iter()
            .flat_map(|&f| input.faces[f].iter().copied())
            .collect();
        let center = [0, 1, 2].map(|a| {
            vertices.iter().map(|&v| input.positions[v][a]).sum::<f64>() / vertices.len() as f64
        });
        let area: f64 = input
            .triangles
            .iter()
            .zip(&input.triangle_faces)
            .filter(|(_, f)| faces.contains(f))
            .map(|(ids, _)| {
                let [a, b, c] = ids.map(|v| input.positions[v]);
                norm(cross(sub(b, a), sub(c, a))) / 2.
            })
            .sum();
        let mut edges = BTreeMap::<(usize, usize), usize>::new();
        for &f in faces {
            let ring = &input.faces[f];
            for (&a, &b) in ring.iter().zip(ring.iter().cycle().skip(1)) {
                *edges.entry((a.min(b), a.max(b))).or_default() += 1;
            }
        }
        let perimeter: f64 = edges
            .iter()
            .filter(|(_, n)| **n == 1)
            .map(|(&(a, b), _)| norm(sub(input.positions[a], input.positions[b])))
            .sum();
        let width = 2. * area / perimeter.max(1e-9);
        let at = 3 * nv + 6 * g;
        for &vertex in &vertices {
            let cross = skew(sub(input.positions[vertex], center));
            for (axis, cross_row) in cross.iter().enumerate() {
                let terms = row([(3 * vertex + axis, 1.), (at + axis, -1.)]
                    .into_iter()
                    .chain((0..3).map(|k| (at + 3 + k, cross_row[k]))));
                problem.objective(&terms, 0., 3. * area / vertices.len() as f64);
                problem.bound(terms, (0.025 * width).max(1e-7));
            }
        }
        for axis in 0..3 {
            problem.objective(&vec![(at + 3 + axis, 1.)], 0., 0.002 * area);
            problem.bound(vec![(at + 3 + axis, 1.)], 0.35);
        }
    }
    for v in 0..3 * nv {
        problem.objective(&vec![(v, 1.)], 0., 1e-5);
        problem.bound(vec![(v, 1.)], 0.22);
    }
    for v in 3 * nv..base {
        problem.objective(&vec![(v, 1.)], 0., 1e-10);
    }
    let mut a = Matrix::default();
    for (i, r) in problem.rows.iter().enumerate() {
        for &(j, v) in r {
            a.push(i, j, v);
        }
    }
    let m = problem.rows.len();
    let settings = DefaultSettings {
        verbose: false,
        max_iter: 150,
        time_limit: 20.,
        tol_gap_abs: 1e-8,
        tol_gap_rel: 1e-8,
        tol_feas: 1e-8,
        ..DefaultSettings::default()
    };
    let mut solver = DefaultSolver::new(
        &problem.p.finish(count, count),
        &problem.q,
        &a.finish(m, count),
        &problem.bounds,
        &[ZeroConeT(6), NonnegativeConeT(m - 6)],
        settings,
    )
    .map_err(|e| SpreadError::Solve(e.to_string()))?;
    solver.solve();
    let result = &solver.solution;
    if !matches!(
        result.status,
        SolverStatus::Solved | SolverStatus::AlmostSolved
    ) || result.x.iter().any(|v| !v.is_finite())
    {
        return Err(SpreadError::Solve(format!("spatial {:?}", result.status)));
    }
    let residual = problem
        .rows
        .iter()
        .zip(&problem.bounds)
        .enumerate()
        .map(|(i, (r, b))| {
            let d = value(r, &result.x) - b;
            if i < 6 { d.abs() } else { d.max(0.) }
        })
        .fold(0., f64::max);
    if residual > 2e-6 {
        return Err(SpreadError::Solve(format!("spatial residual {residual}")));
    }
    Ok(Solution {
        version: VERSION.into(),
        displacements: result.x[..3 * nv]
            .chunks_exact(3)
            .map(|p| [p[0], p[1], p[2]])
            .collect(),
        constraint_residual: residual,
        mean_gap: gaps
            .iter()
            .map(|s| value(&s.row, &result.x) * s.weight)
            .sum::<f64>()
            / spacing_mass,
        max_order_violation: crossings
            .iter()
            .map(|s| (-value(&s.row, &result.x)).max(0.))
            .fold(0., f64::max)
            + rounding_gap_bound,
        status: format!("{:?}", result.status),
    })
}
