//! The exactness probe (plan decision D8) and the lattice snap.
//!
//! Residuals are measured in unit-sheet units over a component's merged
//! lines and their segments' endpoints:
//!
//! - **merge**: the largest distance of a segment endpoint from the line it
//!   was merged into;
//! - **vertex**: the largest distance from a segment endpoint to where the
//!   lines it lies on actually cross — the merged lines within [`TOL`] of it,
//!   plus any sheet edge within `TOL`. Measured per endpoint, never between
//!   two of them: two junctions closer than [`SNAP_RADIUS`] are two vertices,
//!   not a near-coincidence, and box pleating's rational connectors put
//!   lattice junctions as close as 1/8192 of the sheet;
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
//!
//! An endpoint belongs to the vertex its own lines cross at, and two such
//! crossings are two vertices however close they sit; only endpoints with no
//! crossing to name — the jittered case the snap is for — are grouped by
//! proximity, and then around a seed rather than by single-link chaining, so
//! no cluster is wider than the radius the snap is allowed to move a point.
//! [`SNAP_RADIUS`] is a cap on movement, never a definition of sameness.

use serde::{Deserialize, Serialize};

use crate::components::{Component, local_index};
use crate::error::PrecreaseError;
use crate::frame::Frame;
use crate::lattice::{
    ComponentGrid, DENSE_SLOPE_BOUND, LatticeDirection, LatticeOffset, Ring, SNAP_RING_VARIANTS,
    SNAP_SLOPE_BOUND, SnapFamily, dense_offset_residual, dense_rational_denominator,
    infer_grid_factor, infer_rational_denominator, nearest_direction, snap_families,
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
    /// The lattice the component's own lines reveal, beyond the shared tiers.
    grid: ComponentGrid,
    endpoints: Vec<Endpoint>,
    clusters: Vec<Vec<usize>>,
    edges: [Line; 4],
    vertex_max: f64,
}

fn distance(a: [f64; 2], b: [f64; 2]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
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
    // The sheet's grid, read off its rational-direction lines: the odd factor
    // lets the ring tiers admit that grid's denominators too, and the lines
    // the dense tier cannot express reveal a finer rational denominator (a
    // 320-, 416- or 768-grid box pleat) that this component alone may use.
    let rational_denominators: Vec<(usize, Option<u32>)> = (0..lines.len())
        .filter(|&li| angles[li].0.ring == Ring::Rational)
        .map(|li| (li, dense_rational_denominator(ring_offsets[li])))
        .collect();
    let component_grid = ComponentGrid {
        odd_factor: infer_grid_factor(rational_denominators.iter().filter_map(|&(_, d)| d)),
        rational_denominator: infer_rational_denominator(
            rational_denominators
                .iter()
                .filter(|(_, d)| d.is_none())
                .map(|&(li, _)| ring_offsets[li]),
        ),
    };
    let snap_dirs: Vec<LatticeDirection> = lines
        .iter()
        .map(|ml| nearest_direction(ml.line.n, SNAP_SLOPE_BOUND).0)
        .collect();
    let snap_ring_offsets: Vec<f64> = (0..lines.len())
        .map(|li| ring_offset_for(li, &snap_dirs[li]))
        .collect();

    // The junction each endpoint sits on, and the vertex residual: how far
    // the endpoint is from where its own lines actually cross. Measured per
    // endpoint — never as the distance between two endpoints, which counts a
    // designed pair of junctions closer than SNAP_RADIUS (box-pleat
    // connectors put lattice junctions as close as 1/8192 of the sheet) as a
    // near-coincidence and so denies an exactly drawn design its `Exact`.
    let edges = frame.edge_lines();
    let mut vertex_max = 0.0f64;
    let mut anchors: Vec<Option<[f64; 2]>> = Vec::with_capacity(endpoints.len());
    let mut through: Vec<Line> = Vec::new();
    for e in &endpoints {
        through.clear();
        for candidate in lines.iter().map(|ml| &ml.line).chain(edges.iter()) {
            if candidate.distance_to_point(e.p) <= TOL
                && !through.iter().any(|t| t.approx_eq(candidate))
            {
                through.push(*candidate);
            }
        }
        let (anchor, residual) = junction_of(&through, e.p);
        vertex_max = vertex_max.max(residual);
        anchors.push(anchor);
    }

    let clusters = cluster_endpoints(&endpoints, &anchors);

    Context {
        frame,
        lines,
        angles,
        ring_offsets,
        snap_dirs,
        snap_ring_offsets,
        grid: component_grid,
        endpoints,
        clusters,
        edges,
        vertex_max,
    }
}

/// Where the lines `through` a point cross, and how far `p` is from it.
///
/// The best-conditioned pair decides, as it does in [`evaluate`]. When no
/// pair crosses — one line, or all of them parallel within `TOL` — or the
/// crossing is further than the snap radius (an ill-conditioned pair whose
/// intersection is nowhere near this endpoint), the point has no junction and
/// the residual is simply how far it is from the lines it lies on.
fn junction_of(through: &[Line], p: [f64; 2]) -> (Option<[f64; 2]>, f64) {
    let mut best: Option<(f64, usize, usize)> = None;
    for i in 0..through.len() {
        for j in (i + 1)..through.len() {
            let c = through[i].cross(&through[j]).abs();
            if best.is_none_or(|(bc, _, _)| c > bc) {
                best = Some((c, i, j));
            }
        }
    }
    if let Some((c, i, j)) = best
        && c >= TOL
        && let Some(q) = through[i].intersect(&through[j])
    {
        let d = distance(p, q);
        if d < SNAP_RADIUS {
            return (Some(q), d);
        }
    }
    let residual = through
        .iter()
        .map(|l| l.distance_to_point(p))
        .fold(0.0, f64::max);
    (None, residual)
}

/// Group endpoints into the vertices the snap will move them to.
///
/// One cluster per **junction**: endpoints whose lines cross at the same
/// point (within `TOL`) are one vertex, and two junctions further apart than
/// that are two vertices however close they sit. Endpoints the geometry gives
/// no junction for — the jittered case the snap exists for — join the nearest
/// junction within half the snap radius, or else cluster around a seed at the
/// same distance, so no cluster is wider than the radius the snap is allowed
/// to move a point.
///
/// The single-link pass this replaces chained clusters transitively: on a
/// real design (cpoogle Scale-Shaping) 291 distinct grid vertices became one
/// cluster 0.19 unit across, whose forced single target reported a maximum
/// displacement of 0.177 against a design that is exact to 1e-9.
fn cluster_endpoints(endpoints: &[Endpoint], anchors: &[Option<[f64; 2]>]) -> Vec<Vec<usize>> {
    // Cell `SNAP_RADIUS` because the grid is queried at both radii: `TOL` to
    // decide whether two anchors are the same junction, and half the snap
    // radius to attach a loose endpoint to one.
    let mut junctions = PointGrid::new(SNAP_RADIUS);
    let mut cluster_of: Vec<Option<usize>> = vec![None; endpoints.len()];
    let mut clusters: Vec<Vec<usize>> = Vec::new();
    let mut junction_cluster: Vec<usize> = Vec::new();
    for (i, anchor) in anchors.iter().enumerate() {
        let Some(a) = *anchor else { continue };
        let (jid, fresh) = junctions.find_or_insert(a, TOL);
        if fresh {
            junction_cluster.push(clusters.len());
            clusters.push(Vec::new());
        }
        let cluster = junction_cluster[jid];
        clusters[cluster].push(i);
        cluster_of[i] = Some(cluster);
    }

    let loose_ids: Vec<usize> = (0..endpoints.len())
        .filter(|&i| cluster_of[i].is_none())
        .collect();
    let mut loose = PointGrid::new(SNAP_RADIUS);
    for &i in &loose_ids {
        loose.insert(endpoints[i].p);
    }
    let reach = SNAP_RADIUS / 2.0;
    for &i in &loose_ids {
        if cluster_of[i].is_some() {
            continue;
        }
        let p = endpoints[i].p;
        if let Some(jid) = junctions.nearest_within(p, reach) {
            let cluster = junction_cluster[jid];
            clusters[cluster].push(i);
            cluster_of[i] = Some(cluster);
            continue;
        }
        let cluster = clusters.len();
        clusters.push(Vec::new());
        for hit in loose.within(p, reach) {
            let j = loose_ids[hit];
            if cluster_of[j].is_none() {
                cluster_of[j] = Some(cluster);
                clusters[cluster].push(j);
            }
        }
    }

    for cluster in &mut clusters {
        cluster.sort_unstable();
    }
    clusters.sort_by_key(|c| c[0]);
    clusters
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
                dense_offset_residual(ctx.ring_offsets[li], &ctx.angles[li].0, ctx.grid);
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
        .map(|(li, _)| dense_offset_residual(ctx.ring_offsets[li], &ctx.angles[li].0, ctx.grid).1)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn endpoints_at(points: &[[f64; 2]]) -> Vec<Endpoint> {
        points
            .iter()
            .enumerate()
            .map(|(line, &p)| Endpoint { p, line })
            .collect()
    }

    #[test]
    fn junctions_a_hair_apart_stay_separate_clusters() {
        // Twenty junctions in a row, each 1.5e-3 apart — every neighbouring
        // pair inside SNAP_RADIUS. Single-link chaining made them one cluster
        // 2.85e-2 across, whose one forced target then reported a
        // displacement of half that for a design that needed none.
        let points: Vec<[f64; 2]> = (0..20).map(|k| [f64::from(k) * 1.5e-3, 0.5]).collect();
        let endpoints = endpoints_at(&points);
        let anchors: Vec<Option<[f64; 2]>> = points.iter().map(|&p| Some(p)).collect();
        let clusters = cluster_endpoints(&endpoints, &anchors);
        assert_eq!(clusters.len(), 20);
        assert!(clusters.iter().all(|c| c.len() == 1));
    }

    #[test]
    fn endpoints_on_one_junction_are_one_cluster() {
        // Four segments meeting at a vertex, each endpoint resolving to the
        // same crossing: one cluster however the endpoints themselves sit.
        let points = [
            [0.25, 0.5],
            [0.25, 0.5],
            [0.25 + 4e-7, 0.5],
            [0.25, 0.5 - 3e-7],
        ];
        let endpoints = endpoints_at(&points);
        let anchors = vec![Some([0.25, 0.5]); 4];
        let clusters = cluster_endpoints(&endpoints, &anchors);
        assert_eq!(clusters, vec![vec![0, 1, 2, 3]]);
    }

    #[test]
    fn endpoints_with_no_junction_cluster_by_proximity_within_half_the_radius() {
        // The jittered case the snap exists for: nothing resolves to a
        // crossing, so proximity decides — but around a seed, so no cluster
        // is wider than the radius the snap may move a point.
        let points = [
            [0.5, 0.5],
            [0.5 + 5e-4, 0.5],
            [0.5, 0.5 + 5e-4],
            // Beyond the seed's reach, and beyond a chain from it.
            [0.5 + 1.6e-3, 0.5],
            [0.5 + 3.1e-3, 0.5],
        ];
        let endpoints = endpoints_at(&points);
        let anchors = vec![None; points.len()];
        let clusters = cluster_endpoints(&endpoints, &anchors);
        assert_eq!(clusters, vec![vec![0, 1, 2], vec![3], vec![4]]);
        for cluster in &clusters {
            for &i in cluster {
                for &j in cluster {
                    assert!(distance(points[i], points[j]) <= SNAP_RADIUS);
                }
            }
        }
    }

    #[test]
    fn a_loose_endpoint_joins_the_junction_it_belongs_to() {
        let points = [[0.25, 0.5], [0.25 + 6e-4, 0.5], [0.9, 0.9]];
        let endpoints = endpoints_at(&points);
        let anchors = vec![Some([0.25, 0.5]), None, None];
        let clusters = cluster_endpoints(&endpoints, &anchors);
        assert_eq!(clusters, vec![vec![0, 1], vec![2]]);
    }

    #[test]
    fn every_endpoint_lands_in_exactly_one_cluster() {
        let points: Vec<[f64; 2]> = (0..50)
            .map(|k| {
                let t = f64::from(k);
                [0.1 + t * 7.0e-4, 0.2 + (t * 0.37).fract() * 0.5]
            })
            .collect();
        let endpoints = endpoints_at(&points);
        let anchors: Vec<Option<[f64; 2]>> = points
            .iter()
            .enumerate()
            .map(|(i, &p)| (i % 3 == 0).then_some(p))
            .collect();
        let clusters = cluster_endpoints(&endpoints, &anchors);
        let mut seen: Vec<usize> = clusters.iter().flatten().copied().collect();
        seen.sort_unstable();
        assert_eq!(seen, (0..points.len()).collect::<Vec<_>>());
    }

    #[test]
    fn a_junction_is_where_the_lines_cross_not_where_the_point_is() {
        let x = Line::new([1.0, 0.0], 0.25).expect("line");
        let y = Line::new([0.0, 1.0], 0.5).expect("line");
        let (anchor, residual) = junction_of(&[x, y], [0.25, 0.5]);
        assert_eq!(anchor, Some([0.25, 0.5]));
        assert!(residual < 1e-15);
        // Off the crossing by 4e-4: that displacement is the residual.
        let (_, residual) = junction_of(&[x, y], [0.25 + 4e-4, 0.5]);
        assert!((residual - 4e-4).abs() < 1e-15);
        // One line: the residual is the distance to it, and there is no
        // junction to cluster on.
        let (anchor, residual) = junction_of(&[x], [0.25 + 3e-7, 0.9]);
        assert_eq!(anchor, None);
        assert!((residual - 3e-7).abs() < 1e-15);
        // Parallel lines never make a junction.
        let far = Line::new([1.0, 0.0], 0.75).expect("line");
        assert_eq!(junction_of(&[x, far], [0.25, 0.5]).0, None);
        // Nothing through the point at all: nothing to measure.
        assert_eq!(junction_of(&[], [0.25, 0.5]), (None, 0.0));
    }
}
