//! "Start from Edit's folded figure" (plan D16): Edit's chosen Oriedita
//! solution as a state, through the order type the engine shares with
//! Oriedita (`ImportedPattern::from_oriedita`).
//!
//! The input is what Edit's folded figure exposes on the web: the kernel's
//! folded paper scene (`FoldedPaperScene`, `folded_figure_paper_scene`),
//! schema 3. It holds everything the import needs and nothing of the
//! drawing:
//!
//! - **the crease pattern that was folded**: each face's ring on the sheet
//!   (`faces[].points` into `sheet_points`, the crease pattern's own y-down
//!   coordinates), with what each ring edge was (`border` or `fold`). A fold
//!   edge's letter is not in the scene; the order decides it. That pattern
//!   is the one Oriedita folded — the folding colours only, or the selection
//!   — so precreases Edit does not fold are not carried;
//! - **the order**: each subface's stack, top to bottom as the pass's viewer
//!   sees it, gives `[upper, lower]` for every pair stacked there, and a face
//!   that shows its front in the pass (`front_up`) is one whose front that
//!   viewer sees — Oriedita's convention, "upper is nearer a viewer of the
//!   starting face's front", with that face as the start. When the first
//!   face shows its back, the viewer is behind it and each pair turns over.
//!   Either pass of a figure, front or rear, gives the same state.
//!
//! Faces are named to the engine by interior points: each ring's centroid.
//! The relations must decide every pair; a figure they leave open is
//! refused with the count (`import_order_open`).

use std::collections::BTreeSet;

use oristudio_cp::folding::{FoldedPaperEdgeKind, FoldedPaperScene};
use oristudio_fold::{
    CreasePatternInput, ImportKind, ImportSegment, ImportSpace, fold_cp_to_model,
};
use oristudio_geometry::convex;

use super::imports::{Parent, import, land_op};
use super::jump::order_json;
use super::kernel::cp_json;
use super::wire::{CpJump, CpOrigin, FigureGap, IoCallError, IoRefusal, Landed, Limits, Target};
use crate::bridge::Bridge;
use crate::wire::Outcome;

type Point = [f64; 2];

/// Edit's folded figure, read for an import.
#[derive(Debug, Clone, PartialEq)]
pub struct EditFigure {
    /// The faces' rings as a crease pattern, in the scene's model space.
    pub input: CreasePatternInput,
    /// An interior point of a face whose front the relations' viewer sees.
    pub start: Point,
    /// `[upper, lower]`, each face by an interior point.
    pub relations: Vec<[Point; 2]>,
}

/// Read a scene for an import (see the module docs).
pub fn read_figure(scene: &FoldedPaperScene) -> Result<EditFigure, IoRefusal> {
    let gap = |gap| IoRefusal::FigureIncomplete { gap };
    if scene.faces.is_empty() {
        return Err(gap(FigureGap::Faces));
    }
    if scene.sheet_points.is_empty() {
        return Err(gap(FigureGap::SheetPoints));
    }
    let point = |k: usize| scene.sheet_points.get(k).map(|p| [p.x, p.y]);

    let mut edges: BTreeSet<(usize, usize)> = BTreeSet::new();
    let mut segments = Vec::new();
    let mut witnesses = Vec::with_capacity(scene.faces.len());
    for (face, f) in scene.faces.iter().enumerate() {
        let n = f.points.len();
        let ring: Option<Vec<Point>> = f.points.iter().map(|&k| point(k)).collect();
        let (Some(ring), true) = (ring, n >= 3 && f.edges.len() == n) else {
            return Err(gap(FigureGap::FaceRing { face }));
        };
        for i in 0..n {
            let (a, b) = (f.points[i], f.points[(i + 1) % n]);
            if !edges.insert((a.min(b), a.max(b))) {
                continue;
            }
            let kind = match f.edges[i].kind {
                FoldedPaperEdgeKind::Border => ImportKind::Border,
                FoldedPaperEdgeKind::Fold => ImportKind::Unassigned { hint: None },
                // A face split by a line the fold did not fold: not a crease.
                FoldedPaperEdgeKind::Flat => ImportKind::Aux,
            };
            segments.push(ImportSegment {
                from: ring[i],
                to: ring[(i + 1) % n],
                kind,
            });
        }
        witnesses.push(interior(&ring).ok_or_else(|| gap(FigureGap::FaceRing { face }))?);
    }

    let turn_over = !scene.faces[0].front_up;
    let mut pairs: BTreeSet<(usize, usize)> = BTreeSet::new();
    for (subface, s) in scene.subfaces.iter().enumerate() {
        if s.faces_top_to_bottom
            .iter()
            .any(|&f| f >= scene.faces.len())
        {
            return Err(gap(FigureGap::Stack { subface }));
        }
        for (i, &upper) in s.faces_top_to_bottom.iter().enumerate() {
            for &lower in &s.faces_top_to_bottom[i + 1..] {
                pairs.insert(if turn_over {
                    (lower, upper)
                } else {
                    (upper, lower)
                });
            }
        }
    }
    Ok(EditFigure {
        input: CreasePatternInput {
            space: ImportSpace::Model,
            segments,
        },
        start: witnesses[0],
        relations: pairs
            .into_iter()
            .map(|(upper, lower)| [witnesses[upper], witnesses[lower]])
            .collect(),
    })
}

/// The centroid of a ring of either orientation.
fn interior(ring: &[Point]) -> Option<Point> {
    convex::centroid(ring).or_else(|| {
        let reversed: Vec<Point> = ring.iter().rev().copied().collect();
        convex::centroid(&reversed)
    })
}

/// Edit's folded figure as a step after `target`: the state its order
/// decides, and the `cp-jump` op (origin `edit_folded_figure`) that lands it,
/// landed as every replay will land it.
pub fn import_figure(
    bridge: &mut Bridge,
    scene: &FoldedPaperScene,
    target: Target,
    limits: &Limits,
) -> Result<Outcome<Landed>, IoCallError> {
    let parent = Parent::of(bridge, target)?;
    let jumped = (|| -> Result<_, IoRefusal> {
        let figure = read_figure(scene)?;
        let (pattern, placed) = import(&figure.input, parent)?;
        let state = pattern.from_oriedita(figure.start, &figure.relations, &limits.completion())?;
        // The state's own crease pattern, its letters decided: the same
        // `cpJson` a Send to Edit of it would carry.
        let jump = CpJump {
            cp_json: cp_json(&fold_cp_to_model(&state))?,
            order_json: order_json(&state)?,
            origin: CpOrigin::EditFoldedFigure,
        };
        Ok((placed, jump))
    })();
    match jumped {
        Ok((placed, jump)) => land_op(bridge, placed, jump),
        Err(refusal) => Ok(Outcome::Refused(refusal.into())),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    /// The unit square folded in half at x = 0.5 as the kernel's scene has
    /// it, y down: the left face shows its front, the right lies on it.
    fn book() -> Value {
        let edge = |kind: &str| json!({ "from": { "x": 0, "y": 0 }, "to": { "x": 0, "y": 0 }, "kind": kind });
        json!({
            "schema_version": 3, "flipped": false, "sheet": 1.0, "aux_lines": [],
            "sheet_points": [
                { "x": 0, "y": 0 }, { "x": 0.5, "y": 0 }, { "x": 1, "y": 0 },
                { "x": 1, "y": 1 }, { "x": 0.5, "y": 1 }, { "x": 0, "y": 1 }
            ],
            "faces": [
                { "outline": [], "points": [0, 1, 4, 5], "front_up": true,
                  "edges": [edge("border"), edge("fold"), edge("border"), edge("border")] },
                { "outline": [], "points": [1, 2, 3, 4], "front_up": false,
                  "edges": [edge("border"), edge("border"), edge("border"), edge("fold")] }
            ],
            "subfaces": [{ "polygon": [], "faces_top_to_bottom": [1, 0] }]
        })
    }

    fn scene(value: Value) -> FoldedPaperScene {
        serde_json::from_value(value).unwrap_or_else(|e| panic!("scene: {e}"))
    }

    fn gap(value: Value) -> Option<FigureGap> {
        match read_figure(&scene(value)) {
            Err(IoRefusal::FigureIncomplete { gap }) => Some(gap),
            _ => None,
        }
    }

    #[test]
    fn a_figure_reads_as_its_faces_rings_and_its_stacks() {
        let figure = read_figure(&scene(book())).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(figure.input.space, ImportSpace::Model);
        // Seven edges, the shared fold once: six borders and the fold.
        assert_eq!(figure.input.segments.len(), 7);
        let folds: Vec<&ImportSegment> = figure
            .input
            .segments
            .iter()
            .filter(|s| s.kind == ImportKind::Unassigned { hint: None })
            .collect();
        assert_eq!(folds.len(), 1);
        assert_eq!(figure.start, [0.25, 0.5]);
        assert_eq!(figure.relations, vec![[[0.75, 0.5], [0.25, 0.5]]]);

        // Seen from the rear pass, the first face shows its back: the stack
        // reads from behind, and each pair turns over to name the same order.
        let mut rear = book();
        rear["faces"][0]["front_up"] = json!(false);
        rear["faces"][1]["front_up"] = json!(true);
        rear["subfaces"][0]["faces_top_to_bottom"] = json!([0, 1]);
        let figure = read_figure(&scene(rear)).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(figure.relations, vec![[[0.75, 0.5], [0.25, 0.5]]]);
    }

    #[test]
    fn a_figure_without_what_an_import_needs_is_refused() {
        let mut none = book();
        none["faces"] = json!([]);
        assert_eq!(gap(none), Some(FigureGap::Faces));
        let mut old = book();
        old["sheet_points"] = json!([]);
        assert_eq!(gap(old), Some(FigureGap::SheetPoints));
        let mut unnamed = book();
        unnamed["faces"][1]["points"] = json!([]);
        assert_eq!(gap(unnamed), Some(FigureGap::FaceRing { face: 1 }));
        let mut outside = book();
        outside["faces"][0]["points"] = json!([0, 1, 4, 9]);
        assert_eq!(gap(outside), Some(FigureGap::FaceRing { face: 0 }));
        let mut stack = book();
        stack["subfaces"][0]["faces_top_to_bottom"] = json!([1, 2]);
        assert_eq!(gap(stack), Some(FigureGap::Stack { subface: 0 }));
    }
}
