//! Boundary-contact re-localisation from the ink.
//!
//! The contact head fires where a crease's stroke meets the border stroke,
//! and that corner sits along the edge from the point where the crease's
//! centreline crosses the paper edge, in the direction the crease leans, by
//! about half the border's width over the tangent of the angle between them.
//! Measured on the curated benchmark's renders, contacts of creases meeting
//! the edge at 15–30° are 3 px off in median and 72% are over 2 px, while
//! near-perpendicular ones are within half a pixel; two shallow creases
//! meeting at one contact decode as two contacts ~5 px apart. The decode
//! follows the head faithfully, so the fix is geometric and model-free (see
//! `implementation-plans/cp-detect-boundary-contact-decode.md`).
//!
//! For each contact with a proposed span to another vertex, the crease's ink
//! is sampled across that span at radii where the sampling window clears the
//! border stroke, the ink centreline is fitted by weighted least squares, and
//! its intersection with the paper edge replaces the contact's position.
//! Contacts that then coincide are merged, and every span touching a moved or
//! merged contact is rebuilt from its new endpoints.

use std::collections::BTreeMap;

use super::JunctionFirstV1StrategyOptions;
use super::junction_carrier_v1::{
    assign_vertex_ids, distance, pixel_index, px_from_unit, sample_span_stats, unit_from_px,
    unit_scale,
};
use super::junction_first_v1::{carrier_equivalent_options, span_from_adjacent_pair};
use crate::evidence_extract::CompilerEvidence;
use oristudio_cp_compiler::candidate_graph::{
    CandidateCreaseSpan, CandidateCreaseSpanKind, CandidateVertex, CandidateVertexKind,
};
use oristudio_cp_compiler::{BoundarySide, Point2};

/// Half-width, in pixels, of the window sampled across the crease at each
/// radius. Wide enough to hold a 2–3 px stroke that is a pixel or two off the
/// span's line.
const HALF_WINDOW_PX: f64 = 4.0;
/// How far, in pixels, the sampling window must stay from the border line so
/// the border stroke's ink never enters the fit.
const BORDER_CLEARANCE_PX: f64 = 4.0;
/// The sampled stretch along the crease, from the first clear radius.
const MAX_FIT_LENGTH_PX: f64 = 70.0;
/// Radii stop this far short of the span's other endpoint, whose junction ink
/// is not the crease's.
const FAR_END_MARGIN_PX: f64 = 6.0;
/// Fewer pixels of crease than this, after the clearance, is not enough to
/// fit a line through.
const MIN_FIT_LENGTH_PX: f64 = 10.0;
/// Samples along the fitted stretch, inclusive of both ends.
const FIT_SAMPLES: usize = 9;
/// A sample with less ink mass than this across its window carries nothing.
const MIN_SAMPLE_MASS: f64 = 0.5;
/// The largest shift a correction may make, whatever the angle.
const MAX_SHIFT_PX: f64 = 8.0;
/// The shift a correction may make grows with the crease's lean: the head's
/// bias is about a stroke half-width over tan(angle), so a near-perpendicular
/// contact is allowed only this much, and a shallow one this plus
/// `SHIFT_LEAN_PX` over the tangent.
const SHIFT_BASE_PX: f64 = 1.5;
const SHIFT_LEAN_PX: f64 = 3.0;
/// Estimates from several spans that disagree by more than this are not one
/// contact seen twice; one of the fits is on the wrong ink and there is no
/// telling which, so the contact keeps its position.
const MAX_ESTIMATE_SPREAD_PX: f64 = 3.0;
/// A straight stroke fits its centreline to well under a pixel; a residual
/// above this is a fit across two strokes or a junction.
const MAX_FIT_RESIDUAL_PX: f64 = 0.8;
/// Ink below this in a sample's profile is background, not a stroke.
const MIN_PROFILE_PEAK: f64 = 0.2;
/// A second stroke in the window at least this fraction of the nearest one
/// makes the sample crowded: two strokes this close can merge into one mode
/// (thick strokes on a scan) and pull the centroid between them.
const CROWDED_MODE_FRACTION: f64 = 0.5;
/// More crowded samples than this and the crease has a neighbour along the
/// fitted stretch; the fit is refused rather than trusted on what is left.
const MAX_CROWDED_SAMPLES: usize = 3;
/// A stroke support this many times wider than the crease's typical support
/// across the stretch is two strokes fused into one blob (two thick creases
/// crossing just inside the edge), not the crease: the sample is crowded.
const FUSED_SUPPORT_RATIO: f64 = 1.6;
/// A crease sampled along its own span runs parallel to it: the head's bias
/// leaves the centroid track within a few hundredths of a pixel per pixel of
/// slope. A span to a *neighbouring* crease's junction, proposed on that
/// crease's ink, tracks a stroke that converges onto the span at the junction
/// and slopes an order of magnitude more; that estimate belongs to the other
/// contact and is refused.
const MAX_TRACK_SLOPE: f64 = 0.08;
/// A straight stroke leaves the fitted line's residuals centred on zero in
/// both the near and the far half of the stretch; a stroke that another
/// crease crosses or joins near the edge bends the centroid track, and the two
/// halves' mean residuals split apart. A split larger than this, in pixels
/// across the crease, refuses the fit.
const MAX_HALF_RESIDUAL_BIAS_PX: f64 = 0.5;
/// Spans shorter than this give no direction worth fitting along.
const MIN_SPAN_LENGTH_PX: f64 = 12.0;
/// A crease closer to parallel with the edge than this cannot be intersected
/// with it reliably.
const MIN_SIN_ANGLE: f64 = 0.05;
/// Below this canvas size the unit paper's pixel scale is degenerate (the
/// render inset is 32 px a side), so nothing here is measurable; the crate's
/// small synthetic fixtures live there.
const MIN_IMAGE_SIZE: u32 = 128;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct ContactRelocalizeReport {
    /// Contacts whose position changed.
    pub moved: usize,
    /// Contacts merged into another contact or a corner.
    pub merged: usize,
}

/// Move every boundary contact onto the ink centreline of its incident spans,
/// merge the ones that now coincide, and rebuild the spans that touch them.
/// `spans` must hold only adjacency spans (no border spans yet).
pub(super) fn relocalize_contacts(
    vertices: &mut Vec<CandidateVertex>,
    spans: &mut Vec<CandidateCreaseSpan>,
    evidence: &CompilerEvidence,
    image_size: u32,
    options: JunctionFirstV1StrategyOptions,
) -> ContactRelocalizeReport {
    let mut report = ContactRelocalizeReport::default();
    if vertices.is_empty() || image_size < MIN_IMAGE_SIZE {
        return report;
    }
    let size = image_size as usize;
    let line = &evidence.dense.line_probability;
    if line.len() < size * size {
        return report;
    }
    let scale = unit_scale(image_size);

    let mut incident: Vec<Vec<usize>> = vec![Vec::new(); vertices.len()];
    for (index, span) in spans.iter().enumerate() {
        if span.kind == CandidateCreaseSpanKind::BorderSpan {
            continue;
        }
        for vertex in span.vertices {
            if let Some(list) = incident.get_mut(vertex) {
                list.push(index);
            }
        }
    }

    // 1. Re-localise each contact from its spans.
    let mut touched = vec![false; vertices.len()];
    for index in 0..vertices.len() {
        let Some(side) = contact_side(&vertices[index]) else {
            continue;
        };
        let contact_px = px_from_unit(vertices[index].point, image_size);
        let contact_px = [f64::from(contact_px[0]), f64::from(contact_px[1])];
        let mut estimates: Vec<(f64, f64, f64)> = Vec::new();
        for &span_index in &incident[index] {
            let [a, b] = spans[span_index].vertices;
            let other = if a == index { b } else { a };
            let Some(other_vertex) = vertices.get(other) else {
                continue;
            };
            let other_px = px_from_unit(other_vertex.point, image_size);
            let other_px = [f64::from(other_px[0]), f64::from(other_px[1])];
            if let Some(estimate) = centreline_contact(line, size, contact_px, other_px, side) {
                estimates.push(estimate);
            }
        }
        let Some((along_px, max_shift)) = combine_estimates(&estimates) else {
            continue;
        };
        let current_px = along_coordinate(contact_px, side);
        if (along_px - current_px).abs() > max_shift {
            continue;
        }
        let point = point_on_side(side, along_unit(along_px, image_size));
        if distance(point, vertices[index].point) * scale > 1e-3 {
            vertices[index].point = point;
            touched[index] = true;
            report.moved += 1;
        }
    }

    // 2. Merge contacts that now coincide, on each side, corners included as
    //    fixed representatives.
    let merge_tolerance = options.contact_merge_px / scale;
    let mut merged_into: Vec<Option<usize>> = vec![None; vertices.len()];
    for side in BoundarySide::all() {
        let mut on_side: Vec<usize> = (0..vertices.len())
            .filter(|&index| {
                contact_side(&vertices[index]) == Some(side)
                    || (vertices[index].kind == CandidateVertexKind::Corner
                        && corner_on_side(vertices[index].point, side))
            })
            .collect();
        on_side.sort_by(|left, right| {
            side_coordinate(vertices[*left].point, side)
                .total_cmp(&side_coordinate(vertices[*right].point, side))
                .then_with(|| left.cmp(right))
        });
        let mut representative: Option<usize> = None;
        for &index in &on_side {
            let Some(current) = representative else {
                representative = Some(index);
                continue;
            };
            let gap = side_coordinate(vertices[index].point, side)
                - side_coordinate(vertices[current].point, side);
            let both_corners = vertices[index].kind == CandidateVertexKind::Corner
                && vertices[current].kind == CandidateVertexKind::Corner;
            // Two contacts neither of which moved are two contacts the head
            // resolved on its own; only a corrected one may land on another.
            let a_corner = vertices[index].kind == CandidateVertexKind::Corner
                || vertices[current].kind == CandidateVertexKind::Corner;
            let one_moved = touched[index] || touched[current];
            if gap > merge_tolerance || both_corners || !(one_moved || a_corner) {
                representative = Some(index);
                continue;
            }
            // Corners are fixed; between two contacts the stronger one stays,
            // at the support-weighted mean of the two positions.
            let (keep, drop) = if vertices[index].kind == CandidateVertexKind::Corner {
                (index, current)
            } else if vertices[current].kind == CandidateVertexKind::Corner
                || vertices[current].support >= vertices[index].support
            {
                (current, index)
            } else {
                (index, current)
            };
            if vertices[keep].kind != CandidateVertexKind::Corner {
                let keep_support = vertices[keep].support.max(1e-6);
                let drop_support = vertices[drop].support.max(1e-6);
                let coordinate = (side_coordinate(vertices[keep].point, side) * keep_support
                    + side_coordinate(vertices[drop].point, side) * drop_support)
                    / (keep_support + drop_support);
                vertices[keep].point = point_on_side(side, coordinate);
                vertices[keep].support = vertices[keep].support.max(vertices[drop].support);
                touched[keep] = true;
            }
            let dropped_sources = std::mem::take(&mut vertices[drop].source_vertex_ids);
            vertices[keep].source_vertex_ids.extend(dropped_sources);
            merged_into[drop] = Some(keep);
            representative = Some(keep);
            report.merged += 1;
        }
    }

    if report.merged > 0 {
        // Spans follow their merged endpoint, then duplicates and collapsed
        // spans go, then the vertex list is compacted.
        let resolve = |mut index: usize| {
            while let Some(target) = merged_into[index] {
                index = target;
            }
            index
        };
        for span in spans.iter_mut() {
            span.vertices = [resolve(span.vertices[0]), resolve(span.vertices[1])];
        }
        let mut best_by_pair: BTreeMap<[usize; 2], usize> = BTreeMap::new();
        for (index, span) in spans.iter().enumerate() {
            let [a, b] = span.vertices;
            if a == b {
                continue;
            }
            let key = [a.min(b), a.max(b)];
            match best_by_pair.get(&key) {
                Some(&existing) if spans[existing].line_support_mean >= span.line_support_mean => {}
                _ => {
                    best_by_pair.insert(key, index);
                }
            }
        }
        let mut keep_span = vec![false; spans.len()];
        for &index in best_by_pair.values() {
            keep_span[index] = true;
        }
        let mut kept_index = 0usize;
        spans.retain(|_| {
            let keep = keep_span[kept_index];
            kept_index += 1;
            keep
        });

        let mut new_index = vec![usize::MAX; vertices.len()];
        let mut next = 0usize;
        for (index, target) in merged_into.iter().enumerate() {
            if target.is_none() {
                new_index[index] = next;
                next += 1;
            }
        }
        let mut compact_index = 0usize;
        let mut compact_touched = Vec::with_capacity(next);
        vertices.retain(|_| {
            let keep = merged_into[compact_index].is_none();
            if keep {
                compact_touched.push(touched[compact_index]);
            }
            compact_index += 1;
            keep
        });
        touched = compact_touched;
        for span in spans.iter_mut() {
            span.vertices = [new_index[span.vertices[0]], new_index[span.vertices[1]]];
        }
        assign_vertex_ids(vertices);
    }

    // 3. Rebuild every span that touches a contact that moved or absorbed
    //    another, from its new endpoints.
    if report.moved > 0 || report.merged > 0 {
        let carrier_options = carrier_equivalent_options(options);
        let short_bypass = options.short_span_bypass_px / scale;
        for span in spans.iter_mut() {
            if span.kind == CandidateCreaseSpanKind::BorderSpan {
                continue;
            }
            let [a_index, b_index] = span.vertices;
            if !(touched[a_index] || touched[b_index]) {
                continue;
            }
            let a = vertices[a_index].point;
            let b = vertices[b_index].point;
            let length = distance(a, b);
            let short = options.short_span_bypass_px > 0.0 && length <= short_bypass;
            let stats = sample_span_stats(a, b, evidence, image_size, carrier_options);
            *span =
                span_from_adjacent_pair(span.id, [a_index, b_index], a, b, stats, options, short);
        }
    }
    report
}

/// Where the crease's ink centreline crosses the paper edge, in pixels along
/// the side, with the ink mass that supports it and the largest shift the
/// crease's lean makes plausible. `contact_px` is the contact's current
/// position on the edge and `other_px` the span's far endpoint; both in
/// canvas pixels.
fn centreline_contact(
    line: &[f32],
    size: usize,
    contact_px: [f64; 2],
    other_px: [f64; 2],
    side: BoundarySide,
) -> Option<(f64, f64, f64)> {
    let (tangent, inward) = side_axes(side);
    let dx = other_px[0] - contact_px[0];
    let dy = other_px[1] - contact_px[1];
    let length = (dx * dx + dy * dy).sqrt();
    if length < MIN_SPAN_LENGTH_PX {
        return None;
    }
    let u = [dx / length, dy / length];
    let n = [-u[1], u[0]];
    let sin_angle = (u[0] * inward[0] + u[1] * inward[1]).abs();
    if sin_angle < MIN_SIN_ANGLE {
        return None;
    }
    let r_min = (HALF_WINDOW_PX + BORDER_CLEARANCE_PX) / sin_angle;
    let r_max = (length - FAR_END_MARGIN_PX).min(r_min + MAX_FIT_LENGTH_PX);
    if r_max - r_min < MIN_FIT_LENGTH_PX {
        return None;
    }
    let half = HALF_WINDOW_PX as i32;
    let mut samples: Vec<(f64, f64, f64)> = Vec::with_capacity(FIT_SAMPLES);
    let mut widths: Vec<f64> = Vec::with_capacity(FIT_SAMPLES);
    let mut crowded = 0usize;
    for step in 0..FIT_SAMPLES {
        let r = r_min + (r_max - r_min) * step as f64 / (FIT_SAMPLES - 1) as f64;
        let centre = [contact_px[0] + r * u[0], contact_px[1] + r * u[1]];
        let profile: Vec<f64> = (-half..=half)
            .map(|k| {
                let point = [
                    (centre[0] + k as f64 * n[0]) as f32,
                    (centre[1] + k as f64 * n[1]) as f32,
                ];
                pixel_index(point, size).map_or(0.0, |idx| f64::from(line[idx]))
            })
            .collect();
        match nearest_stroke_centroid(&profile, half) {
            Some(StrokeSample::Clean {
                offset,
                mass,
                width,
            }) if mass > MIN_SAMPLE_MASS => {
                samples.push((r, offset, mass));
                widths.push(width);
            }
            Some(StrokeSample::Crowded) => crowded += 1,
            _ => {}
        }
    }
    // Two thick strokes fused into one blob read as one wide mode; against the
    // crease's own width elsewhere along the stretch those samples stand out.
    if samples.len() >= 3 {
        let mut sorted = widths.clone();
        sorted.sort_by(|a, b| a.total_cmp(b));
        let typical = sorted[sorted.len() / 2];
        let mut kept = Vec::with_capacity(samples.len());
        for (sample, width) in samples.iter().zip(&widths) {
            if *width > typical * FUSED_SUPPORT_RATIO && *width > typical + 2.0 {
                crowded += 1;
            } else {
                kept.push(*sample);
            }
        }
        samples = kept;
    }
    if samples.len() < 4 || crowded > MAX_CROWDED_SAMPLES {
        return None;
    }
    // The fitted line X(r) = contact + r u + (a + b r) n crosses the edge where
    // its inward component vanishes.
    let u_in = u[0] * inward[0] + u[1] * inward[1];
    let n_in = n[0] * inward[0] + n[1] * inward[1];
    let crossing_along = |samples: &[(f64, f64, f64)]| -> Option<f64> {
        let (a, b, _) = fit_offsets(samples)?;
        let denominator = u_in + b * n_in;
        if denominator.abs() < 1e-6 {
            return None;
        }
        let r0 = -a * n_in / denominator;
        let e0 = a + b * r0;
        let crossing = [
            contact_px[0] + r0 * u[0] + e0 * n[0],
            contact_px[1] + r0 * u[1] + e0 * n[1],
        ];
        let along = crossing[0] * tangent[0] + crossing[1] * tangent[1];
        along.is_finite().then_some(along)
    };
    let (a, b, residual) = fit_offsets(&samples)?;
    if residual > MAX_FIT_RESIDUAL_PX || b.abs() > MAX_TRACK_SLOPE {
        return None;
    }
    // The centroid track must be straight: no bend between the halves.
    let mid = samples.len() / 2;
    let mean_residual = |part: &[(f64, f64, f64)]| -> f64 {
        let mass: f64 = part.iter().map(|s| s.2).sum();
        part.iter()
            .map(|s| s.2 * (s.1 - (a + b * s.0)))
            .sum::<f64>()
            / mass.max(1e-9)
    };
    if (mean_residual(&samples[..mid]) - mean_residual(&samples[mid..])).abs()
        > MAX_HALF_RESIDUAL_BIAS_PX
    {
        return None;
    }
    let along = crossing_along(&samples)?;
    let total: f64 = samples.iter().map(|s| s.2).sum();
    // How far the head's corner can sit from the crossing at this lean.
    let cos_angle = (u[0] * tangent[0] + u[1] * tangent[1]).abs();
    let max_shift = (SHIFT_BASE_PX + SHIFT_LEAN_PX * cos_angle / sin_angle).min(MAX_SHIFT_PX);
    along.is_finite().then_some((along, total, max_shift))
}

/// Weighted least squares of the perpendicular offset against the radius,
/// `e(r) = a + b r`, with the weighted RMS residual. Two samples or fewer
/// carry no slope.
fn fit_offsets(samples: &[(f64, f64, f64)]) -> Option<(f64, f64, f64)> {
    if samples.len() < 2 {
        return None;
    }
    let total: f64 = samples.iter().map(|s| s.2).sum();
    if total <= 0.0 {
        return None;
    }
    let mean_r = samples.iter().map(|s| s.0 * s.2).sum::<f64>() / total;
    let mean_e = samples.iter().map(|s| s.1 * s.2).sum::<f64>() / total;
    let sxx: f64 = samples.iter().map(|s| s.2 * (s.0 - mean_r).powi(2)).sum();
    let sxy: f64 = samples
        .iter()
        .map(|s| s.2 * (s.0 - mean_r) * (s.1 - mean_e))
        .sum();
    let b = if sxx > 1e-6 { sxy / sxx } else { 0.0 };
    let a = mean_e - b * mean_r;
    let residual = (samples
        .iter()
        .map(|s| s.2 * (s.1 - (a + b * s.0)).powi(2))
        .sum::<f64>()
        / total)
        .sqrt();
    Some((a, b, residual))
}

enum StrokeSample {
    /// One stroke: its centroid offset from the span's line, its ink mass and
    /// the width of its support in pixels.
    Clean { offset: f64, mass: f64, width: f64 },
    /// A second stroke shares the window; the sample carries nothing usable.
    Crowded,
}

/// The centroid of the stroke nearest the span's line in one cross-profile,
/// with its ink mass: the profile's local maxima are candidate strokes, the
/// one closest to the centre wins, and its support runs while the ink stays
/// above half its peak. A neighbouring crease inside the window is a separate
/// mode that never enters the centroid, and one comparable in strength marks
/// the sample crowded.
fn nearest_stroke_centroid(profile: &[f64], half: i32) -> Option<StrokeSample> {
    let n = profile.len();
    let value = |i: usize| profile[i];
    let mut best: Option<(usize, f64)> = None;
    for i in 0..n {
        let v = value(i);
        if v < MIN_PROFILE_PEAK {
            continue;
        }
        let left_ok = i == 0 || value(i - 1) <= v;
        let right_ok = i + 1 >= n || value(i + 1) <= v;
        if !(left_ok && right_ok) {
            continue;
        }
        let offset = (i as i32 - half).abs();
        let better = match best {
            None => true,
            Some((j, _)) => {
                let current = (j as i32 - half).abs();
                offset < current || (offset == current && v > value(j))
            }
        };
        if better {
            best = Some((i, v));
        }
    }
    let (peak, peak_value) = best?;
    let floor = peak_value * 0.5;
    let mut lo = peak;
    while lo > 0 && value(lo - 1) >= floor && value(lo - 1) <= value(lo) {
        lo -= 1;
    }
    let mut hi = peak;
    while hi + 1 < n && value(hi + 1) >= floor && value(hi + 1) <= value(hi) {
        hi += 1;
    }
    // Another stroke outside the chosen one's support, comparable to it.
    let crowded = (0..n).any(|i| {
        if (lo..=hi).contains(&i) {
            return false;
        }
        let v = value(i);
        let is_peak = (i == 0 || value(i - 1) <= v) && (i + 1 >= n || value(i + 1) <= v);
        is_peak && v >= peak_value * CROWDED_MODE_FRACTION && v >= MIN_PROFILE_PEAK
    });
    if crowded {
        return Some(StrokeSample::Crowded);
    }
    let mut mass = 0.0;
    let mut moment = 0.0;
    for i in lo..=hi {
        let k = (i as i32 - half) as f64;
        mass += value(i);
        moment += value(i) * k;
    }
    (mass > 0.0).then(|| StrokeSample::Clean {
        offset: moment / mass,
        mass,
        width: (hi - lo + 1) as f64,
    })
}

/// One position from several spans' estimates, with the largest shift any of
/// them allows: their mass-weighted mean when they agree, nothing when they
/// do not.
fn combine_estimates(estimates: &[(f64, f64, f64)]) -> Option<(f64, f64)> {
    if estimates.is_empty() {
        return None;
    }
    let total: f64 = estimates.iter().map(|e| e.1).sum();
    if total <= 0.0 {
        return None;
    }
    let mean = estimates.iter().map(|e| e.0 * e.1).sum::<f64>() / total;
    let spread = estimates
        .iter()
        .map(|e| (e.0 - mean).abs())
        .fold(0.0, f64::max);
    if spread > MAX_ESTIMATE_SPREAD_PX {
        return None;
    }
    let max_shift = estimates.iter().map(|e| e.2).fold(0.0, f64::max);
    Some((mean, max_shift))
}

fn contact_side(vertex: &CandidateVertex) -> Option<BoundarySide> {
    (vertex.kind == CandidateVertexKind::BoundaryContact)
        .then_some(vertex.boundary_side)
        .flatten()
}

/// Unit vectors along the side and into the paper, in pixel space (y down),
/// which shares the unit square's orientation.
fn side_axes(side: BoundarySide) -> ([f64; 2], [f64; 2]) {
    match side {
        BoundarySide::Top => ([1.0, 0.0], [0.0, 1.0]),
        BoundarySide::Bottom => ([1.0, 0.0], [0.0, -1.0]),
        BoundarySide::Left => ([0.0, 1.0], [1.0, 0.0]),
        BoundarySide::Right => ([0.0, 1.0], [-1.0, 0.0]),
    }
}

fn along_coordinate(point_px: [f64; 2], side: BoundarySide) -> f64 {
    match side {
        BoundarySide::Top | BoundarySide::Bottom => point_px[0],
        BoundarySide::Left | BoundarySide::Right => point_px[1],
    }
}

fn along_unit(along_px: f64, image_size: u32) -> f64 {
    let unit = unit_from_px([along_px as f32, along_px as f32], image_size);
    unit.x
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

fn corner_on_side(point: Point2, side: BoundarySide) -> bool {
    const EPS: f64 = 1e-9;
    match side {
        BoundarySide::Top => point.y.abs() <= EPS,
        BoundarySide::Bottom => (1.0 - point.y).abs() <= EPS,
        BoundarySide::Left => point.x.abs() <= EPS,
        BoundarySide::Right => (1.0 - point.x).abs() <= EPS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evidence_extract::{DenseEvidence, EvidenceExtractionReport};
    use oristudio_cp_compiler::{CandidateSourceAdapter, CandidateVertexMovementPolicy};

    const SIZE: u32 = 256;
    const INSET: f64 = 32.0;

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

    /// Paint a 3 px stroke of full line probability between two canvas points.
    fn paint_segment(evidence: &mut CompilerEvidence, from: [f64; 2], to: [f64; 2]) {
        let size = SIZE as usize;
        let dx = to[0] - from[0];
        let dy = to[1] - from[1];
        let length2 = dx * dx + dy * dy;
        let (min_x, max_x) = (from[0].min(to[0]) - 3.0, from[0].max(to[0]) + 3.0);
        let (min_y, max_y) = (from[1].min(to[1]) - 3.0, from[1].max(to[1]) + 3.0);
        for y in (min_y.floor() as i64).max(0)..=(max_y.ceil() as i64).min(size as i64 - 1) {
            for x in (min_x.floor() as i64).max(0)..=(max_x.ceil() as i64).min(size as i64 - 1) {
                let px = x as f64;
                let py = y as f64;
                let t = if length2 > 0.0 {
                    (((px - from[0]) * dx + (py - from[1]) * dy) / length2).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let cx = from[0] + t * dx;
                let cy = from[1] + t * dy;
                if ((px - cx).powi(2) + (py - cy).powi(2)).sqrt() <= 1.2 {
                    evidence.dense.line_probability[y as usize * size + x as usize] = 1.0;
                }
            }
        }
    }

    /// The paper's top border, drawn as a stroke the way an export draws it.
    fn paint_top_border(evidence: &mut CompilerEvidence) {
        let far = f64::from(SIZE) - INSET;
        paint_segment(evidence, [INSET, INSET], [far, INSET]);
    }

    fn vertex(
        id: usize,
        point: Point2,
        kind: CandidateVertexKind,
        side: Option<BoundarySide>,
    ) -> CandidateVertex {
        CandidateVertex {
            id,
            point,
            kind,
            support: 0.9,
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

    fn corners() -> Vec<CandidateVertex> {
        vec![
            vertex(
                0,
                Point2::new(0.0, 0.0),
                CandidateVertexKind::Corner,
                Some(BoundarySide::Top),
            ),
            vertex(
                1,
                Point2::new(1.0, 0.0),
                CandidateVertexKind::Corner,
                Some(BoundarySide::Right),
            ),
            vertex(
                2,
                Point2::new(1.0, 1.0),
                CandidateVertexKind::Corner,
                Some(BoundarySide::Bottom),
            ),
            vertex(
                3,
                Point2::new(0.0, 1.0),
                CandidateVertexKind::Corner,
                Some(BoundarySide::Left),
            ),
        ]
    }

    fn unit(px: [f64; 2]) -> Point2 {
        unit_from_px([px[0] as f32, px[1] as f32], SIZE)
    }

    fn span(
        id: usize,
        vertices: &[CandidateVertex],
        a: usize,
        b: usize,
        evidence: &CompilerEvidence,
    ) -> CandidateCreaseSpan {
        let options = JunctionFirstV1StrategyOptions::default();
        let stats = sample_span_stats(
            vertices[a].point,
            vertices[b].point,
            evidence,
            SIZE,
            carrier_equivalent_options(options),
        );
        span_from_adjacent_pair(
            id,
            [a, b],
            vertices[a].point,
            vertices[b].point,
            stats,
            options,
            false,
        )
    }

    /// A crease meeting the top edge at `angle_degrees`, leaning +x, from the
    /// true contact `truth` to an interior point 80 px along it.
    fn interior_end(truth: [f64; 2], angle_degrees: f64) -> [f64; 2] {
        let angle = angle_degrees.to_radians();
        [truth[0] + 80.0 * angle.cos(), truth[1] + 80.0 * angle.sin()]
    }

    #[test]
    fn centreline_crossing_recovers_the_true_contact_of_a_shallow_crease() {
        let truth = [100.0, INSET];
        let interior = interior_end(truth, 22.5);
        let mut evidence = empty_evidence();
        paint_top_border(&mut evidence);
        paint_segment(&mut evidence, truth, interior);
        // The head's corner sits 3.2 px along the edge in the lean direction.
        let biased = [truth[0] + 3.2, INSET];
        let (along, mass, max_shift) = centreline_contact(
            &evidence.dense.line_probability,
            SIZE as usize,
            biased,
            interior,
            BoundarySide::Top,
        )
        .expect("a fit");
        assert!(mass > 0.0);
        assert!(
            max_shift > 3.2,
            "a 22.5° crease may shift by more than its bias"
        );
        assert!(
            (along - truth[0]).abs() < 0.6,
            "expected the crossing near {} px, got {along}",
            truth[0]
        );
    }

    #[test]
    fn relocalize_moves_a_biased_contact_onto_the_crease() {
        let truth = [100.0, INSET];
        let interior = interior_end(truth, 22.5);
        let mut evidence = empty_evidence();
        paint_top_border(&mut evidence);
        paint_segment(&mut evidence, truth, interior);
        let mut vertices = corners();
        vertices.push(vertex(
            4,
            unit([truth[0] + 3.2, INSET]),
            CandidateVertexKind::BoundaryContact,
            Some(BoundarySide::Top),
        ));
        vertices.push(vertex(
            5,
            unit(interior),
            CandidateVertexKind::InteriorJunction,
            None,
        ));
        let mut spans = vec![span(0, &vertices, 4, 5, &evidence)];
        let report = relocalize_contacts(
            &mut vertices,
            &mut spans,
            &evidence,
            SIZE,
            JunctionFirstV1StrategyOptions::default(),
        );
        assert_eq!(
            report,
            ContactRelocalizeReport {
                moved: 1,
                merged: 0
            }
        );
        let moved = px_from_unit(vertices[4].point, SIZE);
        assert!(
            (f64::from(moved[0]) - truth[0]).abs() < 0.6,
            "contact should sit at x={} px, got {}",
            truth[0],
            moved[0]
        );
        assert_eq!(
            vertices[4].point.y, 0.0,
            "a top contact stays on the top edge"
        );
        // The span was rebuilt from the moved endpoint.
        let direction = spans[0].carrier.direction;
        let expected = Point2::new(
            vertices[5].point.x - vertices[4].point.x,
            vertices[5].point.y - vertices[4].point.y,
        );
        let cross = direction.x * expected.y - direction.y * expected.x;
        assert!(cross.abs() < 1e-6, "span carrier follows the new endpoint");
    }

    #[test]
    fn relocalize_merges_the_two_contacts_of_a_shallow_v() {
        let truth = [128.0, INSET];
        let right = interior_end(truth, 22.5);
        let left = [truth[0] - (right[0] - truth[0]), right[1]];
        let mut evidence = empty_evidence();
        paint_top_border(&mut evidence);
        paint_segment(&mut evidence, truth, right);
        paint_segment(&mut evidence, truth, left);
        let mut vertices = corners();
        vertices.push(vertex(
            4,
            unit([truth[0] + 2.8, INSET]),
            CandidateVertexKind::BoundaryContact,
            Some(BoundarySide::Top),
        ));
        vertices.push(vertex(
            5,
            unit([truth[0] - 2.8, INSET]),
            CandidateVertexKind::BoundaryContact,
            Some(BoundarySide::Top),
        ));
        vertices.push(vertex(
            6,
            unit(right),
            CandidateVertexKind::InteriorJunction,
            None,
        ));
        vertices.push(vertex(
            7,
            unit(left),
            CandidateVertexKind::InteriorJunction,
            None,
        ));
        let mut spans = vec![
            span(0, &vertices, 4, 6, &evidence),
            span(1, &vertices, 5, 7, &evidence),
        ];
        let report = relocalize_contacts(
            &mut vertices,
            &mut spans,
            &evidence,
            SIZE,
            JunctionFirstV1StrategyOptions::default(),
        );
        assert_eq!(report.merged, 1);
        assert_eq!(vertices.len(), 7, "one contact absorbed the other");
        let contacts: Vec<&CandidateVertex> = vertices
            .iter()
            .filter(|v| v.kind == CandidateVertexKind::BoundaryContact)
            .collect();
        assert_eq!(contacts.len(), 1);
        let merged = px_from_unit(contacts[0].point, SIZE);
        assert!(
            (f64::from(merged[0]) - truth[0]).abs() < 0.8,
            "merged at {}",
            merged[0]
        );
        assert_eq!(spans.len(), 2, "both creases keep their span");
        for span in &spans {
            assert!(
                span.vertices.contains(&contacts[0].id),
                "every crease attaches to the merged contact"
            );
            assert!(span.vertices[0] < vertices.len() && span.vertices[1] < vertices.len());
        }
        for (index, vertex) in vertices.iter().enumerate() {
            assert_eq!(vertex.id, index, "ids follow the compacted list");
        }
    }

    #[test]
    fn a_contact_without_a_span_keeps_its_position() {
        let mut evidence = empty_evidence();
        paint_top_border(&mut evidence);
        let mut vertices = corners();
        let point = unit([100.0, INSET]);
        vertices.push(vertex(
            4,
            point,
            CandidateVertexKind::BoundaryContact,
            Some(BoundarySide::Top),
        ));
        let mut spans = Vec::new();
        let report = relocalize_contacts(
            &mut vertices,
            &mut spans,
            &evidence,
            SIZE,
            JunctionFirstV1StrategyOptions::default(),
        );
        assert_eq!(report, ContactRelocalizeReport::default());
        assert_eq!(vertices[4].point, point);
    }

    #[test]
    fn a_fit_far_from_the_ink_is_refused() {
        // The crease's ink is 20 px away along the edge; the span still runs
        // from the (wrong) contact, so its window never holds the stroke.
        let truth = [120.0, INSET];
        let interior = interior_end(truth, 22.5);
        let mut evidence = empty_evidence();
        paint_top_border(&mut evidence);
        paint_segment(&mut evidence, truth, interior);
        let mut vertices = corners();
        let point = unit([100.0, INSET]);
        vertices.push(vertex(
            4,
            point,
            CandidateVertexKind::BoundaryContact,
            Some(BoundarySide::Top),
        ));
        vertices.push(vertex(
            5,
            unit(interior),
            CandidateVertexKind::InteriorJunction,
            None,
        ));
        let mut spans = vec![span(0, &vertices, 4, 5, &evidence)];
        let report = relocalize_contacts(
            &mut vertices,
            &mut spans,
            &evidence,
            SIZE,
            JunctionFirstV1StrategyOptions::default(),
        );
        assert_eq!(report.moved, 0);
        assert_eq!(vertices[4].point, point);
    }

    #[test]
    fn a_neighbouring_stroke_inside_the_window_does_not_pull_the_fit() {
        // A perpendicular crease already at the truth, with a parallel crease
        // 5 px away: the window sees both strokes, the fit must follow the
        // nearer one and leave the contact where it is.
        let truth = [100.0, INSET];
        let interior = [100.0, INSET + 80.0];
        let mut evidence = empty_evidence();
        paint_top_border(&mut evidence);
        paint_segment(&mut evidence, truth, interior);
        paint_segment(&mut evidence, [105.0, INSET], [105.0, INSET + 80.0]);
        let mut vertices = corners();
        let point = unit(truth);
        vertices.push(vertex(
            4,
            point,
            CandidateVertexKind::BoundaryContact,
            Some(BoundarySide::Top),
        ));
        vertices.push(vertex(
            5,
            unit(interior),
            CandidateVertexKind::InteriorJunction,
            None,
        ));
        let mut spans = vec![span(0, &vertices, 4, 5, &evidence)];
        relocalize_contacts(
            &mut vertices,
            &mut spans,
            &evidence,
            SIZE,
            JunctionFirstV1StrategyOptions::default(),
        );
        let after = px_from_unit(vertices[4].point, SIZE);
        assert!(
            (f64::from(after[0]) - truth[0]).abs() < 0.5,
            "contact stayed at {} px, got {}",
            truth[0],
            after[0]
        );
    }

    #[test]
    fn a_fan_of_creases_agrees_on_one_crossing() {
        // Two creases from one contact, at 22.5° and 60°: two spans, two
        // estimates, one answer.
        let truth = [128.0, INSET];
        let shallow = interior_end(truth, 22.5);
        let steep = interior_end(truth, 60.0);
        let mut evidence = empty_evidence();
        paint_top_border(&mut evidence);
        paint_segment(&mut evidence, truth, shallow);
        paint_segment(&mut evidence, truth, steep);
        let mut vertices = corners();
        vertices.push(vertex(
            4,
            unit([truth[0] + 2.5, INSET]),
            CandidateVertexKind::BoundaryContact,
            Some(BoundarySide::Top),
        ));
        vertices.push(vertex(
            5,
            unit(shallow),
            CandidateVertexKind::InteriorJunction,
            None,
        ));
        vertices.push(vertex(
            6,
            unit(steep),
            CandidateVertexKind::InteriorJunction,
            None,
        ));
        let mut spans = vec![
            span(0, &vertices, 4, 5, &evidence),
            span(1, &vertices, 4, 6, &evidence),
        ];
        let report = relocalize_contacts(
            &mut vertices,
            &mut spans,
            &evidence,
            SIZE,
            JunctionFirstV1StrategyOptions::default(),
        );
        assert_eq!(report.moved, 1);
        let after = px_from_unit(vertices[4].point, SIZE);
        assert!(
            (f64::from(after[0]) - truth[0]).abs() < 0.8,
            "fan crossing at {} px, got {}",
            truth[0],
            after[0]
        );
    }

    #[test]
    fn creases_crossing_just_inside_the_edge_refuse_the_fit() {
        // Two contacts 11 px apart whose creases cross 14 px inside the paper:
        // each crease's ink runs into the other's near the edge, and neither
        // contact may be moved onto the crossing.
        let left = [100.0, INSET];
        let right = [111.0, INSET];
        let left_end = [111.0 + 40.0, INSET + 14.0 + 51.0];
        let right_end = [100.0 - 40.0, INSET + 14.0 + 51.0];
        let mut evidence = empty_evidence();
        paint_top_border(&mut evidence);
        paint_segment(&mut evidence, left, left_end);
        paint_segment(&mut evidence, right, right_end);
        let mut vertices = corners();
        let a = unit(left);
        let b = unit(right);
        vertices.push(vertex(
            4,
            a,
            CandidateVertexKind::BoundaryContact,
            Some(BoundarySide::Top),
        ));
        vertices.push(vertex(
            5,
            b,
            CandidateVertexKind::BoundaryContact,
            Some(BoundarySide::Top),
        ));
        vertices.push(vertex(
            6,
            unit(left_end),
            CandidateVertexKind::InteriorJunction,
            None,
        ));
        vertices.push(vertex(
            7,
            unit(right_end),
            CandidateVertexKind::InteriorJunction,
            None,
        ));
        let mut spans = vec![
            span(0, &vertices, 4, 6, &evidence),
            span(1, &vertices, 5, 7, &evidence),
        ];
        let report = relocalize_contacts(
            &mut vertices,
            &mut spans,
            &evidence,
            SIZE,
            JunctionFirstV1StrategyOptions::default(),
        );
        assert_eq!(report.merged, 0, "two distinct contacts must survive");
        let after_a = px_from_unit(vertices[4].point, SIZE);
        let after_b = px_from_unit(vertices[5].point, SIZE);
        assert!(
            (f64::from(after_a[0]) - left[0]).abs() < 1.0,
            "left contact stayed, got {}",
            after_a[0]
        );
        assert!(
            (f64::from(after_b[0]) - right[0]).abs() < 1.0,
            "right contact stayed, got {}",
            after_b[0]
        );
    }

    #[test]
    fn a_span_onto_a_neighbouring_crease_does_not_move_the_contact() {
        // Two distinct contacts 11 px apart, each with its own crease, and a
        // cross span from the left contact to the right crease's junction:
        // the cross span tracks the right crease, which converges onto it, and
        // must not pull the left contact toward the right one.
        let left = [100.0, INSET];
        let right = [111.0, INSET];
        let left_end = interior_end(left, 60.0);
        let right_end = interior_end(right, 25.0);
        let mut evidence = empty_evidence();
        paint_top_border(&mut evidence);
        paint_segment(&mut evidence, left, left_end);
        paint_segment(&mut evidence, right, right_end);
        let mut vertices = corners();
        vertices.push(vertex(
            4,
            unit(left),
            CandidateVertexKind::BoundaryContact,
            Some(BoundarySide::Top),
        ));
        vertices.push(vertex(
            5,
            unit(right),
            CandidateVertexKind::BoundaryContact,
            Some(BoundarySide::Top),
        ));
        vertices.push(vertex(
            6,
            unit(left_end),
            CandidateVertexKind::InteriorJunction,
            None,
        ));
        vertices.push(vertex(
            7,
            unit(right_end),
            CandidateVertexKind::InteriorJunction,
            None,
        ));
        let mut spans = vec![
            span(0, &vertices, 4, 6, &evidence),
            span(1, &vertices, 5, 7, &evidence),
            span(2, &vertices, 4, 7, &evidence),
        ];
        let report = relocalize_contacts(
            &mut vertices,
            &mut spans,
            &evidence,
            SIZE,
            JunctionFirstV1StrategyOptions::default(),
        );
        assert_eq!(report.merged, 0);
        let after = px_from_unit(vertices[4].point, SIZE);
        assert!(
            (f64::from(after[0]) - left[0]).abs() < 1.0,
            "left contact stayed near {} px, got {}",
            left[0],
            after[0]
        );
    }

    #[test]
    fn two_unmoved_contacts_are_never_merged() {
        let mut evidence = empty_evidence();
        paint_top_border(&mut evidence);
        let mut vertices = corners();
        vertices.push(vertex(
            4,
            unit([100.0, INSET]),
            CandidateVertexKind::BoundaryContact,
            Some(BoundarySide::Top),
        ));
        vertices.push(vertex(
            5,
            unit([101.0, INSET]),
            CandidateVertexKind::BoundaryContact,
            Some(BoundarySide::Top),
        ));
        let mut spans = Vec::new();
        let report = relocalize_contacts(
            &mut vertices,
            &mut spans,
            &evidence,
            SIZE,
            JunctionFirstV1StrategyOptions::default(),
        );
        assert_eq!(report, ContactRelocalizeReport::default());
        assert_eq!(vertices.len(), 6);
    }

    #[test]
    fn relocalisation_can_be_switched_off() {
        let truth = [100.0, INSET];
        let interior = interior_end(truth, 22.5);
        let mut evidence = empty_evidence();
        paint_top_border(&mut evidence);
        paint_segment(&mut evidence, truth, interior);
        let mut vertices = corners();
        let point = unit([truth[0] + 3.2, INSET]);
        vertices.push(vertex(
            4,
            point,
            CandidateVertexKind::BoundaryContact,
            Some(BoundarySide::Top),
        ));
        vertices.push(vertex(
            5,
            unit(interior),
            CandidateVertexKind::InteriorJunction,
            None,
        ));
        let mut spans = vec![span(0, &vertices, 4, 5, &evidence)];
        let options = JunctionFirstV1StrategyOptions {
            contact_relocalize: false,
            ..JunctionFirstV1StrategyOptions::default()
        };
        let report = super::super::junction_first_v1::relocalize_if_enabled(
            &mut vertices,
            &mut spans,
            &evidence,
            SIZE,
            options,
        );
        assert_eq!(report, ContactRelocalizeReport::default());
        assert_eq!(vertices[4].point, point);
    }
}
