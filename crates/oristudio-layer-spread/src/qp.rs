use crate::{
    Diagnostics, Input, SPAN, Solution, SpreadError, VERSION, WARP,
    prepare::{Prepared, Row, row, value},
    reference,
};
use clarabel::{algebra::CscMatrix, solver::*};
use oristudio_geometry::convex;

#[derive(Default)]
struct Triplets {
    rows: Vec<usize>,
    columns: Vec<usize>,
    values: Vec<f64>,
}
impl Triplets {
    fn push(&mut self, i: usize, j: usize, v: f64) {
        self.rows.push(i);
        self.columns.push(j);
        self.values.push(v);
    }
    fn matrix(self, m: usize, n: usize) -> CscMatrix<f64> {
        CscMatrix::new_from_triplets(m, n, self.rows, self.columns, self.values)
    }
}

struct Problem {
    p: Triplets,
    q: Vec<f64>,
    a: Triplets,
    b: Vec<f64>,
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
    fn upper(&mut self, terms: &Row, bound: f64) {
        for &(i, v) in terms {
            self.a.push(self.b.len(), i, v);
        }
        self.b.push(bound);
    }
    fn bounds(&mut self, terms: &Row, bound: f64) {
        self.upper(terms, bound);
        self.upper(&terms.iter().map(|&(v, w)| (v, -w)).collect(), bound);
    }
}

struct Face {
    center: [f64; 2],
    width: f64,
    area: f64,
    plane: usize,
}

fn face_specs(input: &Input, p: &Prepared) -> Vec<Face> {
    let mut specs: Vec<_> = input
        .faces
        .iter()
        .enumerate()
        .map(|(f, face)| {
            let points: Vec<_> = face.iter().map(|&v| p.xy[v]).collect();
            let area = convex::signed_area(&points).abs();
            let perimeter: f64 = points
                .iter()
                .zip(points.iter().cycle().skip(1))
                .map(|(a, b)| (a[0] - b[0]).hypot(a[1] - b[1]))
                .sum();
            let center = [
                points.iter().map(|p| p[0]).sum::<f64>() / points.len() as f64,
                points.iter().map(|p| p[1]).sum::<f64>() / points.len() as f64,
            ];
            Face {
                center,
                area,
                width: (2. * area / perimeter.max(1e-12)).max(1e-7),
                plane: input.plane_groups.as_ref().map_or(f, |g| g[f]),
            }
        })
        .collect();
    if input.plane_groups.is_some() {
        use std::collections::{BTreeMap, BTreeSet};
        let mut groups = BTreeMap::<usize, Vec<usize>>::new();
        for (f, spec) in specs.iter().enumerate() {
            groups.entry(spec.plane).or_default().push(f);
        }
        for faces in groups.values() {
            let mut vertices = BTreeSet::new();
            let mut edges = BTreeMap::<(usize, usize), usize>::new();
            let mut area = 0.;
            for &f in faces {
                area += specs[f].area;
                let ids = &input.faces[f];
                for (&a, &b) in ids.iter().zip(ids.iter().cycle().skip(1)) {
                    vertices.insert(a);
                    *edges.entry((a.min(b), a.max(b))).or_default() += 1;
                }
            }
            let perimeter: f64 = edges
                .iter()
                .filter(|(_, n)| **n == 1)
                .map(|(&(a, b), _)| (p.xy[a][0] - p.xy[b][0]).hypot(p.xy[a][1] - p.xy[b][1]))
                .sum();
            let center = [0, 1].map(|axis| {
                vertices.iter().map(|&v| p.xy[v][axis]).sum::<f64>() / vertices.len() as f64
            });
            for &f in faces {
                specs[f].center = center;
                specs[f].width = (2. * area / perimeter.max(1e-12)).max(1e-7);
            }
        }
    }
    specs
}

fn geometric_limits(input: &Input, p: &Prepared, faces: &[Face], z: &[f64]) -> (f64, f64) {
    let mut warp: f64 = 0.;
    let mut groups = std::collections::BTreeMap::<usize, (Vec<usize>, f64)>::new();
    for (ids, face) in input.faces.iter().zip(faces) {
        let group = groups
            .entry(face.plane)
            .or_insert_with(|| (Vec::new(), face.width));
        group.0.extend(ids);
    }
    for (mut ids, width) in groups.into_values() {
        ids.sort_unstable();
        ids.dedup();
        let samples: Vec<_> = ids
            .iter()
            .map(|&v| [p.xy[v][0], p.xy[v][1], z[v]])
            .collect();
        let plane = reference::fit(&samples, &vec![1.; ids.len()]).plane;
        for sample in samples {
            warp = warp.max(
                (sample[2] - plane[0] * sample[0] - plane[1] * sample[1] - plane[2]).abs() / width,
            );
        }
    }
    let mut slope: f64 = 0.;
    for (ids, inv) in input.triangles.iter().zip(&p.inverse) {
        for axis in 0..2 {
            let gradient: f64 = (0..3).map(|k| inv[(k, axis)] * z[ids[k]]).sum();
            slope = slope.max(gradient.abs());
        }
    }
    (warp, slope)
}

pub fn solve(input: &Input, p: &Prepared) -> Result<Solution, SpreadError> {
    let nv = p.xy.len();
    let faces = face_specs(input, p);
    let nf = faces.iter().map(|f| f.plane).max().map_or(0, |f| f + 1);
    let base = nv + 3 * nf;
    let n = base + p.crossings.len();
    let spacing_mass: f64 = p.gaps.iter().map(|s| s.weight).sum();
    let crossing_mass: f64 = p.crossings.iter().map(|s| s.weight).sum();
    let coefficient = 50. * spacing_mass / crossing_mass.max(1e-30);
    let depth = input.cells.iter().map(|c| c.faces.len()).max().unwrap_or(1);
    let target = SPAN / (depth.saturating_sub(1).max(1) as f64);
    let mut problem = Problem {
        p: Triplets::default(),
        q: vec![0.; n],
        a: Triplets::default(),
        b: Vec::new(),
    };
    // First row is an equality. All following rows are <= inequalities.
    problem.upper(&(0..nv).map(|v| (v, 1. / nv as f64)).collect(), 0.);
    for (i, sample) in p.crossings.iter().enumerate() {
        let slack = base + i;
        let mut terms: Row = sample.row.iter().map(|&(v, w)| (v, -w)).collect();
        terms.push((slack, -1.));
        problem.upper(&terms, 0.);
        problem.upper(&vec![(slack, -1.)], 0.);
        problem
            .p
            .push(slack, slack, 2. * coefficient * sample.weight);
    }
    for gap in &p.gaps {
        problem.objective(&gap.row, target, gap.weight);
    }
    for (ids, spec) in input.faces.iter().zip(&faces) {
        let at = nv + 3 * spec.plane;
        for &vertex in ids {
            let terms = row([
                (vertex, 1.),
                (at, -(p.xy[vertex][0] - spec.center[0])),
                (at + 1, -(p.xy[vertex][1] - spec.center[1])),
                (at + 2, -1.),
            ]);
            problem.objective(&terms, 0., 30. * spec.area / ids.len() as f64);
            problem.bounds(&terms, WARP * spec.width);
        }
        for axis in 0..2 {
            problem.objective(&vec![(at + axis, 1.)], 0., 0.002 * spec.area);
        }
    }
    for at in nv..base {
        problem.p.push(at, at, 2e-10);
    }
    for (ids, inv) in input.triangles.iter().zip(&p.inverse) {
        for axis in 0..2 {
            problem.bounds(&row((0..3).map(|k| (ids[k], inv[(k, axis)]))), 0.35);
        }
    }
    for v in 0..nv {
        problem.bounds(&vec![(v, 1.)], SPAN);
        problem.p.push(v, v, 2e-6);
    }
    let m = problem.b.len();
    let settings = DefaultSettings {
        verbose: false,
        max_iter: 200,
        time_limit: 12.,
        tol_gap_abs: 2e-9,
        tol_gap_rel: 2e-9,
        tol_feas: 2e-9,
        ..DefaultSettings::default()
    };
    let mut solver = DefaultSolver::new(
        &problem.p.matrix(n, n),
        &problem.q,
        &problem.a.matrix(m, n),
        &problem.b,
        &[ZeroConeT(1), NonnegativeConeT(m - 1)],
        settings,
    )
    .map_err(|e| SpreadError::Solve(e.to_string()))?;
    solver.solve();
    let result = &solver.solution;
    if !matches!(
        result.status,
        SolverStatus::Solved
            | SolverStatus::AlmostSolved
            | SolverStatus::MaxIterations
            | SolverStatus::MaxTime
    ) {
        return Err(SpreadError::Solve(format!("{:?}", result.status)));
    }
    let raw = &result.x[..nv];
    if raw.iter().any(|v| !v.is_finite()) {
        return Err(SpreadError::Solve("non-finite heights".into()));
    }
    let (raw_warp, raw_slope) = geometric_limits(input, p, &faces, raw);
    let lo = raw.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = raw.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let extent = hi - lo;
    let scale = if extent < 1e-7 {
        0.
    } else {
        (SPAN / extent)
            .min(0.99 * WARP / raw_warp.max(1e-12))
            .min(0.349 / raw_slope.max(1e-12))
            .min((SPAN - 0.001) / lo.abs().max(hi.abs()).max(1e-12))
            .min(100.)
    };
    let heights: Vec<_> = raw.iter().map(|v| f64::from((v * scale) as f32)).collect();
    let (warp, slope) = geometric_limits(input, p, &faces, &heights);
    if warp > 1.02 * WARP || slope > 0.351 {
        return Err(SpreadError::Solve(format!(
            "pose rejected: relative warp {warp}, slope {slope}"
        )));
    }
    let mut max_crossing: f64 = 0.;
    let mut crossing_squared = 0.;
    for sample in &p.crossings {
        let penetration = (-value(&sample.row, &heights)).max(0.);
        max_crossing = max_crossing.max(penetration);
        crossing_squared += penetration * penetration * sample.weight;
    }
    let mean_gap = p
        .gaps
        .iter()
        .map(|g| value(&g.row, &heights) * g.weight)
        .sum::<f64>()
        / spacing_mass.max(1e-30);
    let references = [
        reference::visible(input, p, &heights, false)?,
        reference::visible(input, p, &heights, true)?,
    ];
    Ok(Solution {
        version: VERSION.into(),
        heights,
        references,
        diagnostics: Diagnostics {
            status: format!("{:?}", result.status),
            iterations: result.iterations,
            qp_seconds: result.solve_time,
            variables: n,
            constraints: m,
            overlap_regions: p.overlap_regions,
            crossing_weight: coefficient,
            opening_scale: scale,
            max_relative_warp: warp,
            max_slope: slope,
            max_crossing,
            rms_crossing: (crossing_squared / crossing_mass.max(1e-30)).sqrt(),
            mean_gap,
        },
    })
}
