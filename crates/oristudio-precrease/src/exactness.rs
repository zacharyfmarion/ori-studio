//! The exactness probe (plan decision D8) and the lattice snap.
//!
//! Residuals are measured in unit-sheet units over a component's merged
//! lines and their segments' endpoints:
//!
//! - **merge**: the largest distance of a segment endpoint from the line it
//!   was merged into;
//! - **vertex**: the largest distance between two endpoints that nearly
//!   coincide (closer than [`SNAP_RADIUS`] but not identical);
//! - **angle**: the largest distance of a line's normal angle from the
//!   nearest `k·π/8` or `k·π/12`;
//! - **offset**: the largest distance of a line's ring offset from the dense
//!   lattice ([`lattice::dense_offset_residual`]);
//! - **outline**: how far the border loop is from an exact rectangle.
//!
//! Directions are the `k·π/8` and `k·π/12` families plus rational slopes
//! (integer normals up to a bound — box pleating's connectors); offsets are
//! read in the direction's ring normal and tested against the rationals and
//! the design rings ℤ[√2], ℤ[√3] (see [`crate::lattice`]).
//!
//! A component is **exact** when every residual is below [`TOL`]; it snaps
//! to itself. Otherwise the snap tries each sparse [`SnapFamily`] in each
//! ring the design might live in ([`SNAP_RING_VARIANTS`]): every line goes to
//! its lattice direction and to the nearest lattice offset of that family,
//! every endpoint to the intersection of the snapped lines through it (or
//! its projection when only one line passes). A family passes when every
//! endpoint moved less than the snap radius, every junction is consistent
//! (all snapped lines through it meet at one point within `TOL`), and no two
//! distinct lines with overlapping extents landed on the same snapped line —
//! a merge is not a snap. Among passing families the one with the smallest
//! RMS displacement wins (coarsest first on ties): the true lattice explains
//! every line with a small residual, a wrong one only some. The component is
//! then **snappable**; if no family passes it is **off-lattice**, and the
//! counts report how many lines and vertices the best attempt could not
//! place.
//!
//! Two lines that sit within the snap radius of each other but are one bent
//! line split at jittered vertices (consecutive pieces, no overlap) collapse
//! legitimately; two overlapping lines that close cannot be told apart from
//! a designed pair and refuse the snap.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::components::{Component, local_index};
use crate::error::PrecreaseError;
use crate::frame::Frame;
use crate::lattice::{
    DENSE_SLOPE_BOUND, LatticeDirection, LatticeOffset, Ring, SNAP_RING_VARIANTS, SNAP_SLOPE_BOUND,
    SnapFamily, dense_offset_residual, dense_rational_denominator, infer_grid_factor,
    nearest_direction, snap_families,
};
use crate::line::{Line, LineIndex};
use crate::merge::MergedLine;
use crate::pointgrid::PointGrid;
use crate::tol::{SNAP_RADIUS, TOL};

/// The three classes of D8.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExactnessClass {
    Exact,
    Snappable,
    OffLattice,
}

/// The residual statistics, unit-sheet units (radians for `angle_max`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Residuals {
    pub merge_max: f64,
    pub vertex_max: f64,
    pub angle_max: f64,
    pub offset_max: f64,
    pub outline: f64,
}

/// One snapped line and where it came from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SnappedLine {
    /// The lattice line, unit frame.
    pub line: Line,
    /// Ids into the component's `merged_lines` that landed on it.
    pub source_lines: Vec<u32>,
    /// Their segments, in the caller's numbering.
    pub segment_indices: Vec<u32>,
    /// The lattice element of its ring offset.
    pub lattice: Option<LatticeOffset>,
    /// Largest endpoint displacement among its sources.
    pub displacement: f64,
}

/// A component's lines on the lattice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SnappedComponent {
    pub class: ExactnessClass,
    /// `"exact"`, or the snap family and ring used (`"dyadic_rational"`,
    /// `"odd_3_rational"`, `"dyadic_sqrt2"`, …).
    pub family: String,
    pub lines: Vec<SnappedLine>,
    /// Merged-line ids the snap could not place (off-lattice only).
    pub omitted_lines: Vec<u32>,
    pub max_displacement_unit: f64,
    pub max_displacement_model: f64,
    /// Every line was placed and the result is usable for planning.
    pub complete: bool,
}

/// The probe's verdict.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Exactness {
    pub class: ExactnessClass,
    pub residuals: Residuals,
    /// Lines the best snap attempt could not place within the snap radius.
    pub off_lattice_lines: u32,
    /// Endpoint clusters displaced beyond the snap radius or inconsistent.
    pub off_lattice_vertices: u32,
    /// Distinct overlapping lines that would have collapsed under the snap.
    pub near_duplicate_lines: u32,
    /// Junctions whose snapped lines do not meet at one point.
    pub inconsistent_vertices: u32,
    /// The snap family used or attempted.
    pub family: Option<String>,
    /// Per merged line, its largest endpoint displacement under the snap.
    pub line_displacements: Vec<f64>,
    pub snapped: SnappedComponent,
}

struct Endpoint {
    p: [f64; 2],
    line: usize,
}

struct Context<'a> {
    frame: &'a Frame,
    lines: &'a [MergedLine],
    /// Dense-tier direction and angular residual per line.
    angles: Vec<(LatticeDirection, f64)>,
    /// Least-squares ring offset per line in the dense-tier direction.
    ring_offsets: Vec<f64>,
    /// Snap-tier direction and ring offset per line (fewer rational slopes).
    snap_dirs: Vec<LatticeDirection>,
    snap_ring_offsets: Vec<f64>,
    /// The odd grid factor the component's rational offsets reveal.
    grid_factor: Option<u32>,
    endpoints: Vec<Endpoint>,
    clusters: Vec<Vec<usize>>,
    edges: [Line; 4],
    vertex_max: f64,
}

fn distance(a: [f64; 2], b: [f64; 2]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

fn find_root(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

fn build_context<'a>(component: &'a Component, frame: &'a Frame) -> Context<'a> {
    let lines = &component.merged_lines;
    let local = local_index(component);

    let mut endpoints = Vec::new();
    for (li, ml) in lines.iter().enumerate() {
        for &gi in &ml.segment_indices {
            if let Some(&j) = local.get(&gi) {
                let s = component.unit_segments[j];
                endpoints.push(Endpoint {
                    p: [s[0], s[1]],
                    line: li,
                });
                endpoints.push(Endpoint {
                    p: [s[2], s[3]],
                    line: li,
                });
            }
        }
    }

    // Lattice directions and least-squares ring offsets per line, for both
    // tiers.
    let mut per_line_points: Vec<Vec<[f64; 2]>> = vec![Vec::new(); lines.len()];
    for e in &endpoints {
        per_line_points[e.line].push(e.p);
    }
    let ring_offset_for = |li: usize, dir: &LatticeDirection| -> f64 {
        let pts = &per_line_points[li];
        if pts.is_empty() {
            dir.ring_offset(lines[li].line.foot())
        } else {
            pts.iter().map(|&p| dir.ring_offset(p)).sum::<f64>() / pts.len() as f64
        }
    };
    let angles: Vec<(LatticeDirection, f64)> = lines
        .iter()
        .map(|ml| nearest_direction(ml.line.n, DENSE_SLOPE_BOUND))
        .collect();
    let ring_offsets: Vec<f64> = (0..lines.len())
        .map(|li| ring_offset_for(li, &angles[li].0))
        .collect();
    // The sheet's grid, read off the lines whose offsets are plainly
    // rational, lets the ring tiers admit that grid's denominators too.
    let grid_factor = infer_grid_factor(
        (0..lines.len())
            .filter(|&li| angles[li].0.ring == Ring::Rational)
            .filter_map(|li| dense_rational_denominator(ring_offsets[li])),
    );
    let snap_dirs: Vec<LatticeDirection> = lines
        .iter()
        .map(|ml| nearest_direction(ml.line.n, SNAP_SLOPE_BOUND).0)
        .collect();
    let snap_ring_offsets: Vec<f64> = (0..lines.len())
        .map(|li| ring_offset_for(li, &snap_dirs[li]))
        .collect();

    // Endpoint clusters within SNAP_RADIUS, and the vertex residual.
    let mut grid = PointGrid::new(SNAP_RADIUS);
    for e in &endpoints {
        grid.insert(e.p);
    }
    let mut parent: Vec<usize> = (0..endpoints.len()).collect();
    let mut vertex_max = 0.0f64;
    for (i, e) in endpoints.iter().enumerate() {
        for j in grid.within(e.p, SNAP_RADIUS) {
            if j == i {
                continue;
            }
            vertex_max = vertex_max.max(distance(e.p, endpoints[j].p));
            let (ri, rj) = (find_root(&mut parent, i), find_root(&mut parent, j));
            if ri != rj {
                parent[ri.max(rj)] = ri.min(rj);
            }
        }
    }
    let mut by_root: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..endpoints.len() {
        let r = find_root(&mut parent, i);
        by_root.entry(r).or_default().push(i);
    }
    let mut clusters: Vec<Vec<usize>> = by_root.into_values().collect();
    clusters.sort_by_key(|c| c[0]);

    Context {
        frame,
        lines,
        angles,
        ring_offsets,
        snap_dirs,
        snap_ring_offsets,
        grid_factor,
        endpoints,
        clusters,
        edges: frame.edge_lines(),
        vertex_max,
    }
}

struct Evaluation {
    family: String,
    snapped: Vec<Option<(Line, LatticeOffset)>>,
    line_displacement: Vec<f64>,
    endpoint_displacement: Vec<f64>,
    inconsistent_vertices: u32,
    near_duplicate_lines: u32,
    off_lattice_lines: u32,
    off_lattice_vertices: u32,
    max_displacement: f64,
    rms: f64,
    passes: bool,
}

/// The ring a line's offset is snapped in: the design's ring for axis, 45°
/// and rational-slope lines, the line's own ring for 22.5° / 15° lines.
fn effective_ring(direction_ring: Ring, variant: Ring) -> Ring {
    if direction_ring == Ring::Rational {
        variant
    } else {
        direction_ring
    }
}

fn snap_line(
    ctx: &Context<'_>,
    li: usize,
    family: &SnapFamily,
    variant: Ring,
) -> Option<(Line, LatticeOffset)> {
    let dir = &ctx.snap_dirs[li];
    let ring = effective_ring(dir.ring, variant);
    let (offset, _) = family.snap_offset(ctx.snap_ring_offsets[li], ring, dir.ring_scale())?;
    let line = Line::new(dir.unit_normal, offset.value / dir.ring_scale())?;
    Some((line, offset))
}

fn evaluate(ctx: &Context<'_>, family: &SnapFamily, variant: Ring) -> Evaluation {
    let n_lines = ctx.lines.len();
    let snapped: Vec<Option<(Line, LatticeOffset)>> = (0..n_lines)
        .map(|li| snap_line(ctx, li, family, variant))
        .collect();

    let mut endpoint_displacement = vec![f64::INFINITY; ctx.endpoints.len()];
    let mut inconsistent_vertices = 0u32;
    let mut off_lattice_vertices = 0u32;

    for cluster in &ctx.clusters {
        let mut through: Vec<Line> = Vec::new();
        let mut missing = false;
        let mut centroid = [0.0f64; 2];
        for &e in cluster {
            let ep = &ctx.endpoints[e];
            centroid[0] += ep.p[0];
            centroid[1] += ep.p[1];
            match &snapped[ep.line] {
                Some((l, _)) => {
                    if !through.iter().any(|t| t.approx_eq(l)) {
                        through.push(*l);
                    }
                }
                None => missing = true,
            }
        }
        centroid[0] /= cluster.len() as f64;
        centroid[1] /= cluster.len() as f64;
        if missing {
            off_lattice_vertices += 1;
            continue;
        }
        for edge in &ctx.edges {
            if edge.distance_to_point(centroid) < SNAP_RADIUS
                && !through.iter().any(|t| t.approx_eq(edge))
            {
                through.push(*edge);
            }
        }

        let mut target: Option<[f64; 2]> = None;
        let mut consistent = true;
        if through.len() >= 2 {
            let mut best: Option<(f64, usize, usize)> = None;
            for i in 0..through.len() {
                for j in (i + 1)..through.len() {
                    let c = through[i].cross(&through[j]).abs();
                    if best.is_none_or(|(bc, _, _)| c > bc) {
                        best = Some((c, i, j));
                    }
                }
            }
            match best {
                Some((c, i, j)) if c >= TOL => {
                    if let Some(p) = through[i].intersect(&through[j]) {
                        if through.iter().any(|l| l.distance_to_point(p) > TOL) {
                            consistent = false;
                        }
                        target = Some(p);
                    }
                }
                _ => consistent = false, // distinct parallel lines through one vertex
            }
        }
        if !consistent {
            inconsistent_vertices += 1;
        }
        let mut cluster_max = 0.0f64;
        for &e in cluster {
            let p = ctx.endpoints[e].p;
            let d = match target {
                Some(t) => distance(p, t),
                None => through
                    .first()
                    .map_or(f64::INFINITY, |l| l.distance_to_point(p)),
            };
            endpoint_displacement[e] = d;
            cluster_max = cluster_max.max(d);
        }
        if !consistent || cluster_max >= SNAP_RADIUS {
            off_lattice_vertices += 1;
        }
    }

    // Distinct lines that collapsed onto one snapped line with overlapping
    // extents: a merge, not a snap.
    let mut index = LineIndex::new(TOL);
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for (li, s) in snapped.iter().enumerate() {
        if let Some((line, _)) = s {
            let (gid, inserted) = index.insert(*line);
            if inserted {
                groups.push(Vec::new());
            }
            groups[gid].push(li);
        }
    }
    let mut extents: Vec<Option<(f64, f64)>> = vec![None; n_lines];
    for (i, e) in ctx.endpoints.iter().enumerate() {
        let _ = i;
        if let Some((line, _)) = &snapped[e.line] {
            let t = line.parameter(e.p);
            let ext = extents[e.line].get_or_insert((t, t));
            ext.0 = ext.0.min(t);
            ext.1 = ext.1.max(t);
        }
    }
    let mut near_duplicate_lines = 0u32;
    for group in &groups {
        for a in 0..group.len() {
            for b in (a + 1)..group.len() {
                if let (Some(ea), Some(eb)) = (extents[group[a]], extents[group[b]]) {
                    let overlap = ea.1.min(eb.1) - ea.0.max(eb.0);
                    if overlap > SNAP_RADIUS {
                        near_duplicate_lines += 1;
                    }
                }
            }
        }
    }

    let mut line_displacement = vec![0.0f64; n_lines];
    for (i, e) in ctx.endpoints.iter().enumerate() {
        line_displacement[e.line] = line_displacement[e.line].max(endpoint_displacement[i]);
    }
    for (li, s) in snapped.iter().enumerate() {
        if s.is_none() {
            line_displacement[li] = f64::INFINITY;
        }
    }
    let off_lattice_lines = line_displacement
        .iter()
        .filter(|&&d| d.is_nan() || d >= SNAP_RADIUS)
        .count() as u32;
    let finite: Vec<f64> = endpoint_displacement
        .iter()
        .copied()
        .filter(|d| d.is_finite())
        .collect();
    let max_displacement = endpoint_displacement.iter().copied().fold(0.0, f64::max);
    let rms = if finite.is_empty() {
        0.0
    } else if finite.len() < endpoint_displacement.len() {
        f64::INFINITY
    } else {
        (finite.iter().map(|d| d * d).sum::<f64>() / finite.len() as f64).sqrt()
    };
    let passes = snapped.iter().all(Option::is_some)
        && max_displacement < SNAP_RADIUS
        && inconsistent_vertices == 0
        && near_duplicate_lines == 0;

    Evaluation {
        family: format!("{}_{}", family.name, variant.name()),
        snapped,
        line_displacement,
        endpoint_displacement,
        inconsistent_vertices,
        near_duplicate_lines,
        off_lattice_lines,
        off_lattice_vertices,
        max_displacement,
        rms,
        passes,
    }
}

fn snapped_component(
    ctx: &Context<'_>,
    class: ExactnessClass,
    evaluation: &Evaluation,
) -> SnappedComponent {
    let mut index = LineIndex::new(TOL);
    let mut lines: Vec<SnappedLine> = Vec::new();
    let mut omitted = Vec::new();
    for (li, s) in evaluation.snapped.iter().enumerate() {
        let Some((line, offset)) = s else {
            omitted.push(li as u32);
            continue;
        };
        let (gid, inserted) = index.insert(*line);
        if inserted {
            lines.push(SnappedLine {
                line: *line,
                source_lines: Vec::new(),
                segment_indices: Vec::new(),
                lattice: Some(*offset),
                displacement: 0.0,
            });
        }
        let entry = &mut lines[gid];
        entry.source_lines.push(li as u32);
        entry
            .segment_indices
            .extend(ctx.lines[li].segment_indices.iter().copied());
        let d = evaluation.line_displacement[li];
        if d.is_finite() {
            entry.displacement = entry.displacement.max(d);
        }
    }
    let max_unit = if evaluation.max_displacement.is_finite() {
        evaluation.max_displacement
    } else {
        evaluation
            .endpoint_displacement
            .iter()
            .copied()
            .filter(|d| d.is_finite())
            .fold(0.0, f64::max)
    };
    SnappedComponent {
        class,
        family: evaluation.family.clone(),
        lines,
        omitted_lines: omitted,
        max_displacement_unit: max_unit,
        max_displacement_model: max_unit * ctx.frame.longer(),
        complete: evaluation.passes,
    }
}

fn identity_evaluation(ctx: &Context<'_>) -> Evaluation {
    let snapped = ctx
        .lines
        .iter()
        .enumerate()
        .map(|(li, ml)| {
            let (offset, _) =
                dense_offset_residual(ctx.ring_offsets[li], &ctx.angles[li].0, ctx.grid_factor);
            Some((ml.line, offset))
        })
        .collect();
    Evaluation {
        family: "exact".to_string(),
        snapped,
        line_displacement: vec![0.0; ctx.lines.len()],
        endpoint_displacement: vec![0.0; ctx.endpoints.len()],
        inconsistent_vertices: 0,
        near_duplicate_lines: 0,
        off_lattice_lines: 0,
        off_lattice_vertices: 0,
        max_displacement: 0.0,
        rms: 0.0,
        passes: true,
    }
}

/// Probe a component: residuals, class, and the snapped copy.
pub fn probe(component: &Component) -> Result<Exactness, PrecreaseError> {
    let frame = component.frame.as_ref().ok_or(PrecreaseError::NoFrame {
        id: component.id,
        reason: "refused sheet",
    })?;
    let ctx = build_context(component, frame);

    let merge_max = ctx
        .lines
        .iter()
        .map(|l| l.merge_residual)
        .fold(0.0, f64::max);
    let angle_max = ctx.angles.iter().map(|(_, r)| *r).fold(0.0, f64::max);
    let offset_max = ctx
        .lines
        .iter()
        .enumerate()
        .map(|(li, _)| {
            dense_offset_residual(ctx.ring_offsets[li], &ctx.angles[li].0, ctx.grid_factor).1
        })
        .fold(0.0, f64::max);
    let residuals = Residuals {
        merge_max,
        vertex_max: ctx.vertex_max,
        angle_max,
        offset_max,
        outline: component.outline_residual,
    };

    let exact = [
        merge_max,
        ctx.vertex_max,
        angle_max,
        offset_max,
        component.outline_residual,
    ]
    .iter()
    .all(|&r| r < TOL);
    if exact {
        let evaluation = identity_evaluation(&ctx);
        return Ok(Exactness {
            class: ExactnessClass::Exact,
            residuals,
            off_lattice_lines: 0,
            off_lattice_vertices: 0,
            near_duplicate_lines: 0,
            inconsistent_vertices: 0,
            family: None,
            line_displacements: evaluation.line_displacement.clone(),
            snapped: snapped_component(&ctx, ExactnessClass::Exact, &evaluation),
        });
    }

    // Every denominator family in every ring the design might live in;
    // coarser families first so ties go to the simpler explanation.
    let ctx_ref = &ctx;
    let evaluations: Vec<Evaluation> = snap_families()
        .iter()
        .flat_map(|family| {
            SNAP_RING_VARIANTS
                .iter()
                .map(move |&variant| evaluate(ctx_ref, family, variant))
        })
        .collect();
    let chosen = evaluations
        .iter()
        .filter(|e| e.passes)
        .min_by(|a, b| a.rms.total_cmp(&b.rms));
    let (class, evaluation) = match chosen {
        Some(e) => (ExactnessClass::Snappable, e),
        None => {
            let best = evaluations
                .iter()
                .min_by(|a, b| {
                    a.off_lattice_lines
                        .cmp(&b.off_lattice_lines)
                        .then(a.rms.total_cmp(&b.rms))
                })
                .unwrap_or(&evaluations[0]);
            (ExactnessClass::OffLattice, best)
        }
    };

    Ok(Exactness {
        class,
        residuals,
        off_lattice_lines: evaluation.off_lattice_lines,
        off_lattice_vertices: evaluation.off_lattice_vertices,
        near_duplicate_lines: evaluation.near_duplicate_lines,
        inconsistent_vertices: evaluation.inconsistent_vertices,
        family: Some(evaluation.family.clone()),
        line_displacements: evaluation.line_displacement.clone(),
        snapped: snapped_component(&ctx, class, evaluation),
    })
}

/// The snapped copy of a component: itself when exact, the best snap family
/// otherwise (`complete == false` for an off-lattice component).
pub fn snap(component: &Component) -> Result<SnappedComponent, PrecreaseError> {
    probe(component).map(|e| e.snapped)
}
