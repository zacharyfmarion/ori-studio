//! Split a crease pattern into per-sheet components and run the pipeline.
//!
//! Every non-border segment goes to the rectangular sheet whose frame
//! contains both its endpoints (padded by `TOL`, or by `SNAP_RADIUS` when the
//! sheet's outline is itself only approximately rectangular). Segments inside
//! a refused loop are attached to that refused component; segments inside no
//! loop are reported unassigned. Each rectangular component is then merged
//! in its own unit frame and probed for exactness.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::PrecreaseError;
use crate::exactness::{Exactness, probe};
use crate::frame::{Frame, FrameAffines, RfRect};
use crate::merge::{LineKind, MergedLine, merge_segments};
use crate::outline::{RefusalReason, detect_border_loops, point_in_polygon};
use crate::tol::{SNAP_RADIUS, TOL};

/// Something the caller should surface but that did not stop the analysis.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Warning {
    /// No border creases: the sheet is the supplied paper rectangle.
    NoBorderFallback { paper: [f64; 4] },
    /// Segments that lie inside more than one sheet went to the first.
    OverlappingSheets { segments: u32 },
    /// Non-border segments shorter than `TOL` in their sheet, skipped by the merge.
    ZeroLengthSegments { count: u32 },
    /// Border segments whose endpoints coincide, ignored by the chaining.
    DegenerateBorderSegments { count: u32 },
}

/// One border loop and everything inside it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Component {
    pub id: u32,
    /// The sheet frame; `None` when the loop was refused.
    pub frame: Option<Frame>,
    /// ReferenceFinder's `(w, h)` for the sheet.
    pub rf_rect: Option<RfRect>,
    /// The frame's four maps as affine matrices.
    pub affines: Option<FrameAffines>,
    /// Model-space corners of the loop (or its vertices when refused).
    pub outline: Vec<[f64; 2]>,
    /// How far the loop is from an exact rectangle (0 for a fallback sheet).
    pub outline_residual: f64,
    /// The sheet came from the paper fallback, not from border creases.
    pub is_fallback: bool,
    /// Border segments forming the loop, in the caller's numbering.
    pub border_segment_indices: Vec<u32>,
    /// Non-border segments inside the sheet, in the caller's numbering.
    pub segment_indices: Vec<u32>,
    /// Those segments in unit-frame coordinates, parallel to `segment_indices`.
    pub unit_segments: Vec<[f64; 4]>,
    /// Distinct lines of the sheet's creases (unit frame).
    pub merged_lines: Vec<MergedLine>,
    /// The exactness probe; `None` for a refused sheet.
    pub exactness: Option<Exactness>,
    /// Why the sheet was refused, if it was.
    pub refused: Option<RefusalReason>,
}

/// The whole analysis, JSON-friendly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SheetAnalysis {
    pub components: Vec<Component>,
    /// Non-border segments inside no sheet, in the caller's numbering.
    pub unassigned_segments: Vec<u32>,
    pub warnings: Vec<Warning>,
    pub segment_count: u32,
    pub tol: f64,
    pub snap_radius: f64,
}

impl SheetAnalysis {
    /// The analysis as a JSON string.
    pub fn to_json_string(&self) -> serde_json::Result<String> {
        serde_json::to_string(self)
    }

    /// Components that have a frame, in id order.
    pub fn sheets(&self) -> impl Iterator<Item = &Component> {
        self.components.iter().filter(|c| c.frame.is_some())
    }
}

fn validate(
    segments: &[f64],
    colors: &[i32],
) -> Result<(Vec<[f64; 4]>, Vec<LineKind>), PrecreaseError> {
    if !segments.len().is_multiple_of(4) {
        return Err(PrecreaseError::MalformedSegments {
            len: segments.len(),
        });
    }
    let count = segments.len() / 4;
    if colors.len() != count {
        return Err(PrecreaseError::ColorCountMismatch {
            segments: count,
            colors: colors.len(),
        });
    }
    if let Some(index) = segments.iter().position(|v| !v.is_finite()) {
        return Err(PrecreaseError::NonFiniteCoordinate { index });
    }
    let segs = segments
        .chunks_exact(4)
        .map(|c| [c[0], c[1], c[2], c[3]])
        .collect();
    let kinds = colors.iter().map(|&c| LineKind::from_color(c)).collect();
    Ok((segs, kinds))
}

fn canvas_scale(segments: &[[f64; 4]], indices: &[u32]) -> f64 {
    let mut min = [f64::INFINITY; 2];
    let mut max = [f64::NEG_INFINITY; 2];
    for &i in indices {
        let s = segments[i as usize];
        for p in [[s[0], s[1]], [s[2], s[3]]] {
            min[0] = min[0].min(p[0]);
            min[1] = min[1].min(p[1]);
            max[0] = max[0].max(p[0]);
            max[1] = max[1].max(p[1]);
        }
    }
    let side = (max[0] - min[0]).max(max[1] - min[1]);
    if side.is_finite() && side > 0.0 {
        side
    } else {
        1.0
    }
}

fn empty_component(id: u32) -> Component {
    Component {
        id,
        frame: None,
        rf_rect: None,
        affines: None,
        outline: Vec::new(),
        outline_residual: 0.0,
        is_fallback: false,
        border_segment_indices: Vec::new(),
        segment_indices: Vec::new(),
        unit_segments: Vec::new(),
        merged_lines: Vec::new(),
        exactness: None,
        refused: None,
    }
}

fn with_frame(component: &mut Component, frame: Frame) {
    component.rf_rect = Some(frame.rf_rect());
    component.affines = Some(frame.affines());
    component.frame = Some(frame);
}

/// Run the pipeline: frames from border creases (or the fallback paper),
/// per-sheet split, collinear merge in each sheet's unit frame, exactness.
///
/// `segments` is `[x1, y1, x2, y2, …]` in Oriedita model space; `colors` has
/// one Oriedita colour code per segment (0 border, 1 mountain, 2 valley, 3
/// auxiliary, negative unassigned); `paper_fallback` is `[x0, y0, x1, y1]`
/// in model space, used only when there are no border creases.
pub fn analyze(
    segments: &[f64],
    colors: &[i32],
    paper_fallback: Option<[f64; 4]>,
) -> Result<SheetAnalysis, PrecreaseError> {
    let (segs, kinds) = validate(segments, colors)?;
    let mut warnings = Vec::new();

    let border_indices: Vec<u32> = (0..segs.len() as u32)
        .filter(|&i| kinds[i as usize] == LineKind::Border)
        .collect();
    let other_indices: Vec<u32> = (0..segs.len() as u32)
        .filter(|&i| kinds[i as usize] != LineKind::Border)
        .collect();

    let mut components: Vec<Component> = Vec::new();
    // Closed refused loops keep their polygon so interior segments can still
    // be attached to them.
    let mut refused_polygons: Vec<(usize, Vec<[f64; 2]>)> = Vec::new();

    if border_indices.is_empty() {
        let paper = paper_fallback.ok_or(PrecreaseError::NoSheet)?;
        let frame = Frame::axis_aligned(paper)?;
        let mut component = empty_component(0);
        component.is_fallback = true;
        component.outline = vec![
            [paper[0], paper[1]],
            [paper[2], paper[1]],
            [paper[2], paper[3]],
            [paper[0], paper[3]],
        ];
        with_frame(&mut component, frame);
        components.push(component);
        warnings.push(Warning::NoBorderFallback { paper });
    } else {
        let scale = canvas_scale(&segs, &border_indices);
        let outline = detect_border_loops(&segs, &border_indices, scale);
        if !outline.degenerate_segments.is_empty() {
            warnings.push(Warning::DegenerateBorderSegments {
                count: outline.degenerate_segments.len() as u32,
            });
        }
        for (id, loop_) in outline.loops.into_iter().enumerate() {
            let mut component = empty_component(id as u32);
            component.border_segment_indices = loop_.border_segment_indices;
            match loop_.sheet {
                Ok(sheet) => {
                    component.outline = loop_.corners;
                    component.outline_residual = sheet.residual;
                    with_frame(&mut component, sheet.frame);
                }
                Err(reason) => {
                    component.outline = if loop_.closed {
                        loop_.corners.clone()
                    } else {
                        loop_.vertices.clone()
                    };
                    if loop_.closed {
                        refused_polygons.push((id, loop_.vertices));
                    }
                    component.refused = Some(reason);
                }
            }
            components.push(component);
        }
    }

    // Assign every non-border segment to a sheet.
    let mut unassigned = Vec::new();
    let mut overlapping = 0u32;
    for &gi in &other_indices {
        let s = segs[gi as usize];
        let a = [s[0], s[1]];
        let b = [s[2], s[3]];
        let mut hits: Vec<usize> = Vec::new();
        for (ci, component) in components.iter().enumerate() {
            let Some(frame) = &component.frame else {
                continue;
            };
            let pad = if component.outline_residual < TOL {
                TOL
            } else {
                SNAP_RADIUS
            };
            if frame.contains_model(a, pad) && frame.contains_model(b, pad) {
                hits.push(ci);
            }
        }
        if hits.len() > 1 {
            overlapping += 1;
        }
        if let Some(&ci) = hits.first() {
            components[ci].segment_indices.push(gi);
            continue;
        }
        if let Some((ci, _)) = refused_polygons
            .iter()
            .find(|(_, polygon)| point_in_polygon(a, polygon) && point_in_polygon(b, polygon))
        {
            components[*ci].segment_indices.push(gi);
            continue;
        }
        unassigned.push(gi);
    }
    if overlapping > 0 {
        warnings.push(Warning::OverlappingSheets {
            segments: overlapping,
        });
    }

    // Merge and probe each sheet in its own unit frame.
    let mut zero_length = 0u32;
    for component in &mut components {
        let Some(frame) = component.frame else {
            continue;
        };
        component.unit_segments = component
            .segment_indices
            .iter()
            .map(|&gi| {
                let s = segs[gi as usize];
                let a = frame.model_to_unit([s[0], s[1]]);
                let b = frame.model_to_unit([s[2], s[3]]);
                [a[0], a[1], b[0], b[1]]
            })
            .collect();
        let local_kinds: Vec<LineKind> = component
            .segment_indices
            .iter()
            .map(|&gi| kinds[gi as usize])
            .collect();
        let merged = merge_segments(
            &component.unit_segments,
            &local_kinds,
            Some(&component.segment_indices),
        );
        zero_length += merged.skipped_zero_length.len() as u32;
        component.merged_lines = merged.lines;
        for line in &mut component.merged_lines {
            line.on_outline = frame.is_edge_line(&line.line);
        }
        component.exactness = Some(probe(component)?);
    }
    if zero_length > 0 {
        warnings.push(Warning::ZeroLengthSegments { count: zero_length });
    }

    Ok(SheetAnalysis {
        components,
        unassigned_segments: unassigned,
        warnings,
        segment_count: segs.len() as u32,
        tol: TOL,
        snap_radius: SNAP_RADIUS,
    })
}

/// Map from a component's global segment indices to positions in its
/// `unit_segments`.
pub(crate) fn local_index(component: &Component) -> HashMap<u32, usize> {
    component
        .segment_indices
        .iter()
        .enumerate()
        .map(|(local, &global)| (global, local))
        .collect()
}
