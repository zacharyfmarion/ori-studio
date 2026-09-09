//! The box-pleat grid as a prior for the paper border.
//!
//! A box-pleated design lives on a square grid: every crease runs along a
//! grid line or a diagonal of the cells, and every crease that reaches the
//! paper edge does so at a grid position. That licenses a stronger reading
//! of the evidence at those positions than the contact head allows on its
//! own. On the curated benchmark's box-pleated renders the border creases
//! the decoder loses are seen by the line evidence (median support 0.88 along
//! the crease, the same as along a found one) and missed by the contact head
//! (median peak 0.28 against 0.89 at a found contact); 93% of them sit on a
//! grid position (2026-09-09, `research/2026-09-07-cp-detect-curated-funnel-bottleneck.md`).
//!
//! The prior is read from the candidate graph after span proposal and contact
//! re-localisation: the family from the proposed spans' angles, the grid from
//! the interior junctions, and its hold on the border from the contacts the
//! head did find, at their corrected positions. When all three
//! agree, every grid position on each side without a candidate vertex is
//! tested for a crease leaving the edge along the grid line or either
//! diagonal: the line evidence along the first cell must be strong and must
//! be a ridge (stronger than the same reading three pixels to either side, so
//! the solid ink of a dense pleat region never passes), the crease must reach
//! a candidate vertex along that ray, and the span to it must pass the same
//! gate every adjacency span passes. The contact head only has to fire at
//! all. Off the grid, and on every other family, nothing changes.

use super::JunctionFirstV1StrategyOptions;
use super::junction_carrier_v1::{
    distance, pixel_index, px_from_unit, sample_span_stats, unit_scale, vertex,
};
use super::junction_first_v1::{
    carrier_equivalent_options, pair_supported, span_from_adjacent_pair,
};
use crate::evidence_extract::CompilerEvidence;
use oristudio_cp_compiler::candidate_graph::{
    CandidateCreaseSpan, CandidateVertex, CandidateVertexKind,
};
use oristudio_cp_compiler::{BoundarySide, CandidateVertexMovementPolicy, Point2};

/// Grid sizes considered, in cells per side. Below 4 there is no design;
/// above 200 a cell is under five pixels on the model canvas and no border
/// stub can be read.
const MIN_CELLS: u32 = 4;
const MAX_CELLS: u32 = 200;
/// How far (px) an interior junction may sit from a grid line and count as
/// on it. One pixel: the junction head places a vertex within that on a
/// render, and a wider band stops discriminating on fine grids.
const GRID_TOLERANCE_PX: f64 = 1.0;
/// The same for the contacts the head found; they carry the head's small
/// along-edge bias.
const CONTACT_TOLERANCE_PX: f64 = 1.5;
const MIN_GRID_VERTICES: usize = 8;
const MIN_GRID_CONTACTS: usize = 4;
/// Raw fraction of vertex coordinates on the grid a size must reach before
/// its chance-corrected score is considered at all.
const MIN_GRID_FIT: f64 = 0.85;
/// A larger grid must beat the best smaller one by this much: every multiple
/// of the true grid fits at least as well, so ties go to the coarser grid.
const GRID_SCORE_MARGIN: f64 = 0.02;
/// Chance-corrected grid scores (fit above what random positions give at
/// that size, rescaled to 0..1) the prior needs from the junctions and from
/// the contacts. The contacts' bar is low: it only asks that the head's
/// contacts not contradict the grid, and the densest giants (basilisk,
/// dwarf, carp: 96–128 cells) score 0.5–0.7 there because the re-localisation
/// declines to read their crowded ink and the head's along-edge bias stays.
/// The sweep at the final gates: 0.5 admits 47 of the 68 box-pleated cases
/// for 362 true completions and none spurious, 0.8 admits 43 for 285
/// (2026-09-09). Read before the re-localisation the score is lower still
/// (almond 0.53 for 1.0 after), which is why the prior runs after it.
const MIN_GRID_SCORE: f64 = 0.85;
const MIN_CONTACT_SCORE: f64 = 0.5;
/// Family: the fraction of proposed spans within this of a multiple of 45°.
const FAMILY_ANGLE_TOLERANCE_DEGREES: f64 = 5.0;
/// Only spans at least this long (px) vote on the family; shorter ones are
/// too imprecise in angle, and the short-span bypass proposes them on
/// adjacency alone.
const MIN_FAMILY_SPAN_LENGTH_PX: f64 = 12.0;
const MIN_FAMILY_SPANS: usize = 20;
/// The family vote a box-pleat prior needs. Hybrids with a few 22.5° creases
/// pass; their border is grid-aligned where it matters and the completion
/// gates below never admit an off-grid crease.
const MIN_FAMILY_FRACTION: f64 = 0.85;
/// The contact head's peak within [`CONTACT_WINDOW_PX`] of the grid position
/// must reach this. Zero: the ink decides. A floor of 0.05 gave up a third of
/// the true completions (118 against 180) for no spurious one avoided, and
/// 0.10 half of them (2026-09-09).
const MIN_CONTACT_PEAK: f64 = 0.0;
const CONTACT_WINDOW_PX: i32 = 3;
/// Mean line probability along the first cell inward from the edge.
const MIN_STUB_SUPPORT: f64 = 0.5;
const STUB_STEP_PX: f64 = 2.0;
/// The stub reading must exceed the same reading offset this far along the
/// edge to either side by [`MIN_RIDGE`]: a crease is a ridge of the line
/// map, the solid ink between two strokes of a dense region is not. Every
/// spurious completion in the sweep read a ridge of 0.11 or less, the true
/// ones 0.31 at the tenth percentile and 0.49 in median.
const RIDGE_FLANK_PX: f64 = 3.0;
const MIN_RIDGE: f64 = 0.15;
/// The crease must reach a candidate vertex within this (px) of the ray,
/// between half a cell and four cells in.
const TARGET_CORRIDOR_PX: f64 = 3.0;
const MIN_TARGET_CELLS: f64 = 0.5;
const MAX_TARGET_CELLS: f64 = 4.0;
/// Grid positions this close (px) to a candidate vertex are taken.
const MIN_OCCUPIED_DISTANCE_PX: f64 = 3.0;

/// A box-pleat grid read from the candidate graph.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct GridPrior {
    /// Cells per side.
    pub cells: u32,
    /// Fraction of proposed spans at a multiple of 45°.
    pub family_fraction: f64,
    /// Chance-corrected fraction of interior junctions on the grid.
    pub grid_score: f64,
    /// Chance-corrected fraction of the head's contacts on the grid.
    pub contact_score: f64,
}

/// What the border completion added.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct GridCompletionReport {
    pub contacts: usize,
    pub spans: usize,
}

/// Read the family, the grid and its hold on the border from the candidate
/// graph; `spans` must hold only adjacency spans (no border spans yet).
pub(super) fn detect_grid_prior(
    vertices: &[CandidateVertex],
    spans: &[CandidateCreaseSpan],
    image_size: u32,
    options: JunctionFirstV1StrategyOptions,
) -> Option<GridPrior> {
    let scale = unit_scale(image_size);
    let family_fraction = family_fraction(vertices, spans, scale, options)?;
    if family_fraction < MIN_FAMILY_FRACTION {
        return None;
    }
    let junctions = vertices
        .iter()
        .filter(|vertex| vertex.kind == CandidateVertexKind::InteriorJunction)
        .flat_map(|vertex| [vertex.point.x, vertex.point.y])
        .collect::<Vec<_>>();
    if junctions.len() < 2 * MIN_GRID_VERTICES {
        return None;
    }
    let (cells, grid_score) = best_grid(&junctions, GRID_TOLERANCE_PX / scale)?;
    if grid_score < MIN_GRID_SCORE {
        return None;
    }
    let contacts = vertices
        .iter()
        .filter_map(|vertex| {
            (vertex.kind == CandidateVertexKind::BoundaryContact)
                .then(|| {
                    vertex
                        .boundary_side
                        .map(|side| side_coordinate(vertex.point, side))
                })
                .flatten()
        })
        .collect::<Vec<_>>();
    if contacts.len() < MIN_GRID_CONTACTS {
        return None;
    }
    let contact_score = grid_score_at(&contacts, cells, CONTACT_TOLERANCE_PX / scale);
    if contact_score < MIN_CONTACT_SCORE {
        return None;
    }
    Some(GridPrior {
        cells,
        family_fraction,
        grid_score,
        contact_score,
    })
}

/// Fraction of the long, gate-passing spans whose direction is within
/// [`FAMILY_ANGLE_TOLERANCE_DEGREES`] of a multiple of 45°; `None` when there
/// are too few to vote.
fn family_fraction(
    vertices: &[CandidateVertex],
    spans: &[CandidateCreaseSpan],
    scale: f64,
    options: JunctionFirstV1StrategyOptions,
) -> Option<f64> {
    let min_length = MIN_FAMILY_SPAN_LENGTH_PX / scale;
    let mut voters = 0usize;
    let mut on_family = 0usize;
    for span in spans {
        let [a, b] = span.vertices;
        let (Some(a), Some(b)) = (vertices.get(a), vertices.get(b)) else {
            continue;
        };
        if distance(a.point, b.point) < min_length
            || span.line_support_mean < options.min_span_line_support
        {
            continue;
        }
        let angle = (b.point.y - a.point.y)
            .atan2(b.point.x - a.point.x)
            .to_degrees();
        let off = ((angle + 22.5).rem_euclid(45.0) - 22.5).abs();
        voters += 1;
        if off <= FAMILY_ANGLE_TOLERANCE_DEGREES {
            on_family += 1;
        }
    }
    (voters >= MIN_FAMILY_SPANS).then(|| on_family as f64 / voters as f64)
}

/// The coarsest grid size whose chance-corrected fit of `coordinates` is
/// within [`GRID_SCORE_MARGIN`] of the best, with that score.
fn best_grid(coordinates: &[f64], tolerance: f64) -> Option<(u32, f64)> {
    let mut best: Option<(u32, f64)> = None;
    for cells in MIN_CELLS..=MAX_CELLS {
        let fit = grid_fit(coordinates, cells, tolerance);
        if fit < MIN_GRID_FIT {
            continue;
        }
        let score = chance_corrected(fit, cells, tolerance);
        if best.is_none_or(|(_, best_score)| score > best_score + GRID_SCORE_MARGIN) {
            best = Some((cells, score));
        }
    }
    best
}

fn grid_score_at(coordinates: &[f64], cells: u32, tolerance: f64) -> f64 {
    chance_corrected(grid_fit(coordinates, cells, tolerance), cells, tolerance)
}

/// Fraction of `coordinates` (unit square) within `tolerance` of `k / cells`.
fn grid_fit(coordinates: &[f64], cells: u32, tolerance: f64) -> f64 {
    if coordinates.is_empty() {
        return 0.0;
    }
    let on_grid = coordinates
        .iter()
        .filter(|&&c| {
            let scaled = c * f64::from(cells);
            (scaled - scaled.round()).abs() <= tolerance * f64::from(cells)
        })
        .count();
    on_grid as f64 / coordinates.len() as f64
}

/// `fit` rescaled so that what random positions would score is 0 and a
/// perfect fit is 1; a band of `tolerance` either side of every line covers
/// `2 · tolerance · cells` of the unit interval.
fn chance_corrected(fit: f64, cells: u32, tolerance: f64) -> f64 {
    let chance = (2.0 * tolerance * f64::from(cells)).min(1.0);
    if chance >= 1.0 {
        return 0.0;
    }
    ((fit - chance) / (1.0 - chance)).clamp(0.0, 1.0)
}

/// Add a boundary contact, with its spans, at every grid position where a
/// crease leaves the edge and no candidate vertex stands.
pub(super) fn complete_border_on_grid(
    vertices: &mut Vec<CandidateVertex>,
    spans: &mut Vec<CandidateCreaseSpan>,
    prior: &GridPrior,
    evidence: &CompilerEvidence,
    image_size: u32,
    options: JunctionFirstV1StrategyOptions,
) -> GridCompletionReport {
    let mut report = GridCompletionReport::default();
    let size = image_size as usize;
    if evidence.dense.line_probability.len() < size * size
        || evidence.dense.boundary_contact_probability.len() < size * size
    {
        return report;
    }
    let scale = unit_scale(image_size);
    let cell = 1.0 / f64::from(prior.cells);
    let occupied = (cell / 3.0).max(MIN_OCCUPIED_DISTANCE_PX / scale);
    let carrier_options = carrier_equivalent_options(options);
    for side in [
        BoundarySide::Top,
        BoundarySide::Right,
        BoundarySide::Bottom,
        BoundarySide::Left,
    ] {
        let (along, inward) = side_axes(side);
        for k in 1..prior.cells {
            let point = point_on_side(side, f64::from(k) * cell);
            if vertices
                .iter()
                .any(|vertex| distance(vertex.point, point) <= occupied)
            {
                continue;
            }
            let peak = contact_peak(evidence, image_size, point);
            if peak < MIN_CONTACT_PEAK {
                continue;
            }
            let mut proposals = Vec::new();
            for stub in stubs_from_edge(point, along, inward, cell) {
                let Some(target) = crease_from_edge(vertices, evidence, image_size, &stub) else {
                    continue;
                };
                let stats = sample_span_stats(
                    vertices[target].point,
                    point,
                    evidence,
                    image_size,
                    carrier_options,
                );
                if pair_supported(stats, options) {
                    proposals.push((target, stats));
                }
            }
            if proposals.is_empty() {
                continue;
            }
            let support = proposals
                .iter()
                .map(|(_, stats)| stats.line_mean)
                .fold(peak, f64::max);
            let contact = vertices.len();
            vertices.push(vertex(
                contact,
                point,
                CandidateVertexKind::BoundaryContact,
                support,
                CandidateVertexMovementPolicy::BoundaryOnly,
                Some(side),
            ));
            report.contacts += 1;
            for (target, stats) in proposals {
                let mut span = span_from_adjacent_pair(
                    spans.len(),
                    [target, contact],
                    vertices[target].point,
                    point,
                    stats,
                    options,
                    false,
                );
                span.reasons.push(format!(
                    "box-pleat grid prior: border contact completed at grid position (contact peak {peak:.2})"
                ));
                spans.push(span);
                report.spans += 1;
            }
        }
    }
    report
}

/// The head's strongest reading within [`CONTACT_WINDOW_PX`] of `point`.
fn contact_peak(evidence: &CompilerEvidence, image_size: u32, point: Point2) -> f64 {
    let size = image_size as usize;
    let centre = px_from_unit(point, image_size);
    let mut peak = 0.0_f64;
    for dy in -CONTACT_WINDOW_PX..=CONTACT_WINDOW_PX {
        for dx in -CONTACT_WINDOW_PX..=CONTACT_WINDOW_PX {
            let sample = [centre[0] + dx as f32, centre[1] + dy as f32];
            if let Some(idx) = pixel_index(sample, size) {
                peak = peak.max(f64::from(evidence.dense.boundary_contact_probability[idx]));
            }
        }
    }
    peak
}

/// One way a crease can leave the edge at a grid position: the first cell
/// of it, in the unit square.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Stub {
    /// The grid position on the edge.
    origin: Point2,
    /// Unit direction into the paper.
    direction: Point2,
    /// Length to the next grid point along it.
    length: f64,
    /// Unit direction along the edge, for the flanking readings.
    along: Point2,
    /// The grid cell, for the reach of the target search.
    cell: f64,
}

impl Stub {
    fn end(&self) -> Point2 {
        Point2::new(
            self.origin.x + self.direction.x * self.length,
            self.origin.y + self.direction.y * self.length,
        )
    }
}

/// The three ways a crease leaves the edge on a grid: along the grid line
/// and along either diagonal, each to the next grid point.
fn stubs_from_edge(origin: Point2, along: Point2, inward: Point2, cell: f64) -> [Stub; 3] {
    let diagonal = std::f64::consts::FRAC_1_SQRT_2;
    let stub = |direction: Point2, length: f64| Stub {
        origin,
        direction,
        length,
        along,
        cell,
    };
    [
        stub(inward, cell),
        stub(
            Point2::new(
                (inward.x + along.x) * diagonal,
                (inward.y + along.y) * diagonal,
            ),
            cell * std::f64::consts::SQRT_2,
        ),
        stub(
            Point2::new(
                (inward.x - along.x) * diagonal,
                (inward.y - along.y) * diagonal,
            ),
            cell * std::f64::consts::SQRT_2,
        ),
    ]
}

/// The candidate vertex a crease leaving the edge along `stub` reaches, when
/// the line evidence along the first cell says there is one.
fn crease_from_edge(
    vertices: &[CandidateVertex],
    evidence: &CompilerEvidence,
    image_size: u32,
    stub: &Stub,
) -> Option<usize> {
    let scale = unit_scale(image_size);
    let end = stub.end();
    let support = line_mean(evidence, image_size, stub.origin, end);
    if support < MIN_STUB_SUPPORT {
        return None;
    }
    let flank_offset = RIDGE_FLANK_PX / scale;
    let flank = [-1.0, 1.0]
        .into_iter()
        .map(|sign| {
            let offset = Point2::new(
                stub.along.x * sign * flank_offset,
                stub.along.y * sign * flank_offset,
            );
            line_mean(
                evidence,
                image_size,
                Point2::new(stub.origin.x + offset.x, stub.origin.y + offset.y),
                Point2::new(end.x + offset.x, end.y + offset.y),
            )
        })
        .fold(0.0_f64, f64::max);
    if support - flank < MIN_RIDGE {
        return None;
    }
    let corridor = TARGET_CORRIDOR_PX / scale;
    vertices
        .iter()
        .enumerate()
        .filter_map(|(index, vertex)| {
            let dx = vertex.point.x - stub.origin.x;
            let dy = vertex.point.y - stub.origin.y;
            let t = dx * stub.direction.x + dy * stub.direction.y;
            let perpendicular = (-dx * stub.direction.y + dy * stub.direction.x).abs();
            (t >= stub.cell * MIN_TARGET_CELLS
                && t <= stub.cell * MAX_TARGET_CELLS
                && perpendicular <= corridor)
                .then_some((index, t))
        })
        .min_by(|left, right| left.1.total_cmp(&right.1))
        .map(|(index, _)| index)
}

/// Mean line probability sampled every [`STUB_STEP_PX`] from `a` to `b`.
fn line_mean(evidence: &CompilerEvidence, image_size: u32, a: Point2, b: Point2) -> f64 {
    let size = image_size as usize;
    let a_px = px_from_unit(a, image_size);
    let b_px = px_from_unit(b, image_size);
    let length = ((b_px[0] - a_px[0]).powi(2) + (b_px[1] - a_px[1]).powi(2)).sqrt();
    let steps = (f64::from(length) / STUB_STEP_PX).ceil().max(1.0) as usize;
    let mut sum = 0.0;
    let mut count = 0usize;
    for step in 0..=steps {
        let t = step as f32 / steps as f32;
        let sample = [
            a_px[0] + (b_px[0] - a_px[0]) * t,
            a_px[1] + (b_px[1] - a_px[1]) * t,
        ];
        if let Some(idx) = pixel_index(sample, size) {
            sum += f64::from(evidence.dense.line_probability[idx]);
            count += 1;
        }
    }
    if count == 0 { 0.0 } else { sum / count as f64 }
}

/// Unit vectors along the side and into the paper (unit square, y down).
fn side_axes(side: BoundarySide) -> (Point2, Point2) {
    match side {
        BoundarySide::Top => (Point2::new(1.0, 0.0), Point2::new(0.0, 1.0)),
        BoundarySide::Bottom => (Point2::new(1.0, 0.0), Point2::new(0.0, -1.0)),
        BoundarySide::Left => (Point2::new(0.0, 1.0), Point2::new(1.0, 0.0)),
        BoundarySide::Right => (Point2::new(0.0, 1.0), Point2::new(-1.0, 0.0)),
    }
}

fn side_coordinate(point: Point2, side: BoundarySide) -> f64 {
    match side {
        BoundarySide::Top | BoundarySide::Bottom => point.x,
        BoundarySide::Left | BoundarySide::Right => point.y,
    }
}

fn point_on_side(side: BoundarySide, coordinate: f64) -> Point2 {
    let coordinate = coordinate.clamp(0.0, 1.0);
    match side {
        BoundarySide::Top => Point2::new(coordinate, 0.0),
        BoundarySide::Right => Point2::new(1.0, coordinate),
        BoundarySide::Bottom => Point2::new(coordinate, 1.0),
        BoundarySide::Left => Point2::new(0.0, coordinate),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evidence_extract::{DenseEvidence, EvidenceExtractionReport};
    use oristudio_cp_compiler::CandidateSourceAdapter;

    const SIZE: u32 = 256;
    const INSET: f64 = 32.0;
    const CELLS: u32 = 8;

    fn empty_evidence() -> CompilerEvidence {
        let pixels = (SIZE * SIZE) as usize;
        CompilerEvidence {
            image_size: SIZE,
            dense: DenseEvidence {
                line_probability: vec![0.0; pixels],
                non_crease_probability: vec![0.0; pixels],
                junction_probability: vec![0.0; pixels],
                boundary_contact_probability: vec![0.0; pixels],
                assignment_probability: vec![0.0; pixels * 4],
                line_style_probability: vec![0.0; pixels * 4],
            },
            line_primitives: Vec::new(),
            junction_primitives: Vec::new(),
            boundary_contact_primitives: Vec::new(),
            report: EvidenceExtractionReport {
                schema: "test".to_owned(),
                legacy_dependency: false,
                image_size: SIZE,
                extraction_seconds: 0.0,
                line_pixels_above_threshold: 0,
                hough_segments: 0,
                line_primitives: 0,
                strong_line_primitives: 0,
                weak_line_primitives: 0,
                junction_primitives: 0,
                boundary_contact_primitives: 0,
            },
        }
    }

    fn canvas(point: Point2) -> [f64; 2] {
        let span = f64::from(SIZE) - 2.0 * INSET;
        [INSET + point.x * span, INSET + point.y * span]
    }

    /// Paint a stroke of full line probability between two unit points.
    fn paint(evidence: &mut CompilerEvidence, from: Point2, to: Point2, half_width: f64) {
        let size = SIZE as usize;
        let from = canvas(from);
        let to = canvas(to);
        let dx = to[0] - from[0];
        let dy = to[1] - from[1];
        let length2 = dx * dx + dy * dy;
        for y in 0..size {
            for x in 0..size {
                let px = x as f64;
                let py = y as f64;
                let t = if length2 > 0.0 {
                    (((px - from[0]) * dx + (py - from[1]) * dy) / length2).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let cx = from[0] + t * dx;
                let cy = from[1] + t * dy;
                if ((px - cx).powi(2) + (py - cy).powi(2)).sqrt() <= half_width {
                    evidence.dense.line_probability[y * size + x] = 1.0;
                }
            }
        }
    }

    fn paint_contact_head(evidence: &mut CompilerEvidence, point: Point2, value: f32) {
        let size = SIZE as usize;
        let centre = canvas(point);
        if let Some(idx) = pixel_index([centre[0] as f32, centre[1] as f32], size) {
            evidence.dense.boundary_contact_probability[idx] = value;
        }
    }

    fn test_vertex(
        id: usize,
        point: Point2,
        kind: CandidateVertexKind,
        side: Option<BoundarySide>,
    ) -> CandidateVertex {
        CandidateVertex {
            id,
            point,
            kind,
            support: 1.0,
            movement_policy: match kind {
                CandidateVertexKind::Corner => CandidateVertexMovementPolicy::Locked,
                CandidateVertexKind::BoundaryContact => CandidateVertexMovementPolicy::BoundaryOnly,
                _ => CandidateVertexMovementPolicy::Movable,
            },
            boundary_side: side,
            source_vertex_ids: vec![id],
            source_carrier_ids: Vec::new(),
            source_adapter: CandidateSourceAdapter::ArrangementV2,
            provenance: Vec::new(),
        }
    }

    fn grid_point(i: u32, j: u32) -> Point2 {
        Point2::new(
            f64::from(i) / f64::from(CELLS),
            f64::from(j) / f64::from(CELLS),
        )
    }

    fn test_span(
        id: usize,
        vertices: &[CandidateVertex],
        a: usize,
        b: usize,
        line_mean: f64,
    ) -> CandidateCreaseSpan {
        let stats = super::super::junction_carrier_v1::SpanStats {
            line_min: line_mean,
            line_mean,
            line_max: line_mean,
            non_crease_mean: 0.0,
            style_support: 0.0,
            assignment: super::super::junction_carrier_v1::unknown_assignment(),
        };
        span_from_adjacent_pair(
            id,
            [a, b],
            vertices[a].point,
            vertices[b].point,
            stats,
            JunctionFirstV1StrategyOptions::default(),
            false,
        )
    }

    /// A box-pleated candidate graph on an 8-grid: the four corners, a
    /// contact at every interior grid position of the top and bottom sides,
    /// interior junctions on the grid, and spans along the grid lines and
    /// diagonals between them.
    fn box_pleat_graph() -> (Vec<CandidateVertex>, Vec<CandidateCreaseSpan>) {
        let mut vertices = vec![
            test_vertex(
                0,
                Point2::new(0.0, 0.0),
                CandidateVertexKind::Corner,
                Some(BoundarySide::Top),
            ),
            test_vertex(
                1,
                Point2::new(1.0, 0.0),
                CandidateVertexKind::Corner,
                Some(BoundarySide::Top),
            ),
            test_vertex(
                2,
                Point2::new(1.0, 1.0),
                CandidateVertexKind::Corner,
                Some(BoundarySide::Bottom),
            ),
            test_vertex(
                3,
                Point2::new(0.0, 1.0),
                CandidateVertexKind::Corner,
                Some(BoundarySide::Bottom),
            ),
        ];
        for i in 1..CELLS {
            let id = vertices.len();
            vertices.push(test_vertex(
                id,
                grid_point(i, 0),
                CandidateVertexKind::BoundaryContact,
                Some(BoundarySide::Top),
            ));
            let id = vertices.len();
            vertices.push(test_vertex(
                id,
                grid_point(i, CELLS),
                CandidateVertexKind::BoundaryContact,
                Some(BoundarySide::Bottom),
            ));
        }
        let mut junction_ids = std::collections::BTreeMap::new();
        for i in 1..CELLS {
            for j in 1..CELLS {
                let id = vertices.len();
                junction_ids.insert((i, j), id);
                vertices.push(test_vertex(
                    id,
                    grid_point(i, j),
                    CandidateVertexKind::InteriorJunction,
                    None,
                ));
            }
        }
        let mut spans = Vec::new();
        for i in 1..CELLS {
            for j in 1..CELLS {
                let here = junction_ids[&(i, j)];
                if let Some(&right) = junction_ids.get(&(i + 1, j)) {
                    spans.push(test_span(spans.len(), &vertices, here, right, 0.9));
                }
                if let Some(&down) = junction_ids.get(&(i, j + 1)) {
                    spans.push(test_span(spans.len(), &vertices, here, down, 0.9));
                }
                if let Some(&diagonal) = junction_ids.get(&(i + 1, j + 1)).filter(|_| i % 2 == 1) {
                    spans.push(test_span(spans.len(), &vertices, here, diagonal, 0.9));
                }
            }
        }
        (vertices, spans)
    }

    fn options() -> JunctionFirstV1StrategyOptions {
        JunctionFirstV1StrategyOptions::default()
    }

    #[test]
    fn reads_the_grid_of_a_box_pleated_graph() {
        let (vertices, spans) = box_pleat_graph();
        let prior = detect_grid_prior(&vertices, &spans, SIZE, options()).expect("prior");
        assert_eq!(prior.cells, CELLS);
        assert!(prior.family_fraction > 0.99, "{prior:?}");
        assert!(prior.grid_score > 0.99, "{prior:?}");
        assert!(prior.contact_score > 0.99, "{prior:?}");
    }

    #[test]
    fn a_design_with_creases_off_the_45_degree_family_has_no_prior() {
        let (mut vertices, mut spans) = box_pleat_graph();
        // A fifth of the spans re-pointed at 22.5°: a vertex two cells over
        // and one cell down from each junction on the first grid row.
        let count = spans.len() / 5;
        for k in 0..count {
            let id = vertices.len();
            let from = vertices[spans[k].vertices[0]].point;
            let to = Point2::new(
                from.x + 2.0 / f64::from(CELLS),
                from.y + 1.0 / f64::from(CELLS),
            );
            vertices.push(test_vertex(
                id,
                to,
                CandidateVertexKind::InteriorJunction,
                None,
            ));
            let a = spans[k].vertices[0];
            spans[k] = test_span(k, &vertices, a, id, 0.9);
        }
        assert!(detect_grid_prior(&vertices, &spans, SIZE, options()).is_none());
    }

    #[test]
    fn junctions_off_the_grid_give_no_prior() {
        let (mut vertices, spans) = box_pleat_graph();
        let scale = unit_scale(SIZE);
        for (index, vertex) in vertices.iter_mut().enumerate() {
            if vertex.kind == CandidateVertexKind::InteriorJunction {
                // Scatter by 2–5 px, never on a grid line.
                let shift = (2.0 + (index % 4) as f64) / scale;
                vertex.point = Point2::new(vertex.point.x + shift, vertex.point.y - shift);
            }
        }
        assert!(detect_grid_prior(&vertices, &spans, SIZE, options()).is_none());
    }

    #[test]
    fn chance_correction_is_zero_for_random_positions_and_one_for_a_perfect_fit() {
        let tolerance = 1.0 / unit_scale(SIZE);
        let cells = 8;
        let chance = 2.0 * tolerance * f64::from(cells);
        assert!((chance_corrected(chance, cells, tolerance)).abs() < 1e-9);
        assert!((chance_corrected(1.0, cells, tolerance) - 1.0).abs() < 1e-9);
        assert_eq!(chance_corrected(1.0, 200, 0.01), 0.0);
    }

    /// The completion scenario: the head found every top contact but one;
    /// the ink shows that crease leaving the edge to its junction.
    fn missing_contact_scenario() -> (
        Vec<CandidateVertex>,
        Vec<CandidateCreaseSpan>,
        CompilerEvidence,
        Point2,
    ) {
        let (mut vertices, mut spans) = box_pleat_graph();
        let missing = grid_point(3, 0);
        let index = vertices
            .iter()
            .position(|vertex| {
                vertex.kind == CandidateVertexKind::BoundaryContact
                    && distance(vertex.point, missing) < 1e-9
            })
            .expect("contact");
        vertices.remove(index);
        for (id, vertex) in vertices.iter_mut().enumerate() {
            vertex.id = id;
        }
        spans.clear();
        let (rebuilt, rebuilt_spans) = {
            // Re-derive spans on the remaining vertex ids.
            let mut spans = Vec::new();
            let by_point = |p: Point2| vertices.iter().position(|v| distance(v.point, p) < 1e-9);
            for i in 1..CELLS {
                for j in 1..CELLS {
                    let here = by_point(grid_point(i, j)).expect("junction");
                    if let Some(right) = by_point(grid_point(i + 1, j)).filter(|_| i + 1 < CELLS) {
                        spans.push(test_span(spans.len(), &vertices, here, right, 0.9));
                    }
                    if let Some(down) = by_point(grid_point(i, j + 1)).filter(|_| j + 1 < CELLS) {
                        spans.push(test_span(spans.len(), &vertices, here, down, 0.9));
                    }
                }
            }
            (vertices, spans)
        };
        let mut evidence = empty_evidence();
        // The crease from the missing contact down to the junction one cell in.
        paint(&mut evidence, missing, grid_point(3, 1), 1.2);
        paint_contact_head(&mut evidence, missing, 0.2);
        (rebuilt, rebuilt_spans, evidence, missing)
    }

    #[test]
    fn completes_a_missing_contact_where_the_ink_leaves_the_edge() {
        let (mut vertices, mut spans, evidence, missing) = missing_contact_scenario();
        let prior = detect_grid_prior(&vertices, &spans, SIZE, options()).expect("prior");
        let before = (vertices.len(), spans.len());
        let report = complete_border_on_grid(
            &mut vertices,
            &mut spans,
            &prior,
            &evidence,
            SIZE,
            options(),
        );
        assert_eq!(
            report,
            GridCompletionReport {
                contacts: 1,
                spans: 1
            }
        );
        assert_eq!(vertices.len(), before.0 + 1);
        assert_eq!(spans.len(), before.1 + 1);
        let contact = vertices.last().expect("contact");
        assert_eq!(contact.kind, CandidateVertexKind::BoundaryContact);
        assert_eq!(contact.boundary_side, Some(BoundarySide::Top));
        assert!(distance(contact.point, missing) < 1e-9);
        let span = spans.last().expect("span");
        assert_eq!(span.vertices[1], contact.id);
        assert!(distance(vertices[span.vertices[0]].point, grid_point(3, 1)) < 1e-9);
    }

    #[test]
    fn a_position_without_ink_stays_empty() {
        let (mut vertices, mut spans, mut evidence, _) = missing_contact_scenario();
        evidence
            .dense
            .line_probability
            .iter_mut()
            .for_each(|v| *v = 0.0);
        let prior = detect_grid_prior(&vertices, &spans, SIZE, options()).expect("prior");
        let report = complete_border_on_grid(
            &mut vertices,
            &mut spans,
            &prior,
            &evidence,
            SIZE,
            options(),
        );
        assert_eq!(report, GridCompletionReport::default());
    }

    #[test]
    fn solid_ink_across_the_position_is_not_a_ridge() {
        let (mut vertices, mut spans, mut evidence, missing) = missing_contact_scenario();
        // Ink everywhere around the position, well past the reach of the
        // diagonals: every stub reads full support, and so do its flanks.
        paint(
            &mut evidence,
            Point2::new(missing.x, missing.y - 0.5 / f64::from(CELLS)),
            Point2::new(missing.x, missing.y + 2.0 / f64::from(CELLS)),
            2.0 * unit_scale(SIZE) / f64::from(CELLS),
        );
        let prior = detect_grid_prior(&vertices, &spans, SIZE, options()).expect("prior");
        let report = complete_border_on_grid(
            &mut vertices,
            &mut spans,
            &prior,
            &evidence,
            SIZE,
            options(),
        );
        assert_eq!(report, GridCompletionReport::default());
    }

    #[test]
    fn a_crease_with_no_vertex_to_reach_adds_nothing() {
        let (mut vertices, mut spans, evidence, _) = missing_contact_scenario();
        let junction = vertices
            .iter()
            .position(|vertex| distance(vertex.point, grid_point(3, 1)) < 1e-9)
            .expect("junction");
        // Move the junction the crease would reach off its grid line, past
        // the corridor, and drop its spans.
        let scale = unit_scale(SIZE);
        vertices[junction].point = Point2::new(
            vertices[junction].point.x + 5.0 / scale,
            vertices[junction].point.y,
        );
        spans.retain(|span| !span.vertices.contains(&junction));
        let prior = detect_grid_prior(&vertices, &spans, SIZE, options()).expect("prior");
        let report = complete_border_on_grid(
            &mut vertices,
            &mut spans,
            &prior,
            &evidence,
            SIZE,
            options(),
        );
        assert_eq!(report, GridCompletionReport::default());
    }
}
