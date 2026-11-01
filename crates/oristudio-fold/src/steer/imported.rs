//! An imported crease pattern's faces and the faces Edit folds of it, one
//! for one (`implementation-plans/layer-order-dialog.md`, row H10): what lets
//! Fold's Import CP choose its layer order in the Layer order dialog.
//!
//! The dialog analyses a [`LayerSource`], Oriedita's faces of the creases;
//! Fold's import ([`ImportedPattern`]) traces its own faces of the same
//! creases and numbers them its own way. [`ImportedFaces`] matches the two by
//! the rule a saved record's faces are found again by
//! (`restore.rs`), checked both ways: each Oriedita face's interior point
//! lies in one imported face, no two in the same one, their paper areas
//! agree within [`AREA_TOLERANCE`], and each imported face's own witness lies
//! in the Oriedita face it was matched to. With as many faces on each side,
//! every face is then matched, and an order goes across exactly, pair for
//! pair:
//!
//! - **into the dialog**, an imported order as Oriedita's relations over its
//!   faces ([`ImportedFaces::oriedita_relations`]): the order the dialog
//!   opens on, so an Apply that changed nothing is that order;
//! - **back from it**, the relations its Apply chose as Oriedita relations
//!   over the imported faces ([`ImportedFaces::to_imported`]), which
//!   [`ImportedPattern::oriedita_face_seeds`] turns into the import's seeds:
//!   every pair fixed as the dialog chose it, with the letters.
//!
//! When the faces do not match (a crease one side folds and the other does
//! not), [`FacesDiffer`] says which, and the import keeps its own chooser.
//!
//! **Ori Studio original work**, beside the ports: it reads both through
//! their public accessors and changes neither.

use oristudio_cp::folding::HierarchyRelation;
use oristudio_geometry::convex;
use oristudio_layer_order::{LayerOrder, OrieditaRelation};
use serde::Serialize;
use thiserror::Error;

use super::restore::AREA_TOLERANCE;
use super::source::LayerSource;
use super::stacks::ViewSide;
use crate::import::ImportedPattern;
use crate::pattern::FaceId;

type Point = [f64; 2];

/// Why an import's faces are not the faces Edit folds of its creases. Faces
/// are Oriedita's (the dialog's) indices.
#[derive(Debug, Clone, PartialEq, Serialize, Error)]
#[serde(tag = "cause", rename_all = "snake_case")]
pub enum FacesDiffer {
    /// The two trace different numbers of faces.
    #[error("Edit folds {oriedita} faces, the import {imported}")]
    Count { oriedita: usize, imported: usize },
    /// Oriedita face `face` is no imported face: its interior point lies in
    /// none, or in one another face took, or in one of another area.
    #[error("face {face} is no face of the import")]
    Unmatched { face: FaceId },
    /// The imported face Oriedita face `face` was matched to has its own
    /// point elsewhere: the match does not hold both ways.
    #[error("face {face}'s match does not hold both ways")]
    Unwitnessed { face: FaceId },
}

/// How Fold shows the imported state, in the dialog's terms
/// (`LayerOrderLook`): the side of the folded paper seen, and how far it is
/// turned, clockwise on screen, from Oriedita's picture of that side.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct ImportedLook {
    pub side: ViewSide,
    pub turn_deg: f64,
}

/// See the module docs.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportedFaces {
    /// The imported face of each Oriedita face, by its index.
    imported: Vec<FaceId>,
    /// The Oriedita face of each imported face, by its index.
    oriedita: Vec<FaceId>,
    /// The imported face Oriedita's fold starts from.
    start: FaceId,
}

impl ImportedFaces {
    /// Match `layer`'s faces with `pattern`'s (see the module docs).
    pub fn of(
        layer: &LayerSource,
        pattern: &ImportedPattern,
    ) -> Result<ImportedFaces, FacesDiffer> {
        let wireframe = layer.render_inputs().wireframe();
        let unordered = pattern.unordered();
        let parts = unordered.parts();
        // An imported face by its index, which is its id (`ImportedPattern::new` numbers them so).
        let index_of = |f: FaceId| {
            parts
                .faces
                .get(f.0 as usize)
                .filter(|face| face.id == f)
                .map(|_| f.0 as usize)
        };
        let forward = |k: usize| {
            let point = layer.interior_point(FaceId(k as u32))?;
            index_of(unordered.face_at(pattern.to_sheet(point))?)
        };
        let backward = |f: usize| {
            let witness = unordered.face_witness(parts.faces.get(f)?.id)?;
            layer
                .face_at_paper(pattern.to_input(witness))
                .map(|k| k.0 as usize)
        };
        let same_area = |k: usize, f: usize| {
            let theirs = layer.paper_area(FaceId(k as u32)).unwrap_or(0.0).abs();
            let ours = input_area(pattern, f);
            // False for a NaN area too: no match.
            (ours - theirs).abs() <= AREA_TOLERANCE * theirs
        };
        let imported = matched(
            wireframe.faces.len(),
            parts.faces.len(),
            forward,
            backward,
            same_area,
        )?;
        let mut oriedita = vec![FaceId(0); imported.len()];
        for (k, &f) in imported.iter().enumerate() {
            oriedita[f] = FaceId(k as u32);
        }
        let start = *imported
            .get(wireframe.starting_face)
            .ok_or(FacesDiffer::Unmatched {
                face: FaceId(wireframe.starting_face as u32),
            })?;
        Ok(ImportedFaces {
            imported: imported.iter().map(|&f| FaceId(f as u32)).collect(),
            oriedita,
            start: FaceId(start as u32),
        })
    }

    /// The imported face of Oriedita face `face`.
    pub fn imported_face(&self, face: FaceId) -> Option<FaceId> {
        self.imported.get(face.0 as usize).copied()
    }

    /// The Oriedita face of imported face `face`.
    pub fn oriedita_face(&self, face: FaceId) -> Option<FaceId> {
        self.oriedita.get(face.0 as usize).copied()
    }

    /// The imported face Oriedita's fold starts from: what
    /// [`ImportedPattern::oriedita_face_seeds`] reads the relations' sense
    /// from.
    pub fn start(&self) -> FaceId {
        self.start
    }

    /// `order`, over the imported faces, as Oriedita's relations over
    /// `layer`'s: every determined pair that shares an Oriedita subface,
    /// ascending, `upper_face` nearer a viewer of the starting face's front,
    /// as [`LayerSource::oriedita_relations`] gives the dialog's own.
    pub fn oriedita_relations(
        &self,
        layer: &LayerSource,
        pattern: &ImportedPattern,
        order: &LayerOrder,
    ) -> Vec<HierarchyRelation> {
        let start_front_up = pattern
            .unordered()
            .isometry(self.start)
            .is_some_and(|t| t.front_up());
        let mut relations: Vec<HierarchyRelation> = order
            .to_oriedita(start_front_up)
            .into_iter()
            .filter_map(|r| {
                let (upper, lower) = (
                    self.oriedita_face(r.upper_face)?,
                    self.oriedita_face(r.lower_face)?,
                );
                layer
                    .shares_subface(upper, lower)
                    .then_some(HierarchyRelation {
                        upper_face: upper.0 as usize,
                        lower_face: lower.0 as usize,
                    })
            })
            .collect();
        relations.sort_by_key(|r| (r.upper_face, r.lower_face));
        relations
    }

    /// Relations over Oriedita's faces, `[upper, lower]` as the dialog's
    /// Apply hands them, as Oriedita relations over the imported faces;
    /// `None` when one names a face Oriedita's fold does not have.
    pub fn to_imported(&self, relations: &[[usize; 2]]) -> Option<Vec<OrieditaRelation>> {
        relations
            .iter()
            .map(|&[upper, lower]| {
                Some(OrieditaRelation {
                    upper_face: *self.imported.get(upper)?,
                    lower_face: *self.imported.get(lower)?,
                })
            })
            .collect()
    }

    /// How Fold shows the imported state (see [`ImportedLook`]): Oriedita
    /// draws its starting face where the crease pattern has it, y down, front
    /// up; Fold draws it through its placement on the sheet, its isometry
    /// into the model frame and the view, y up. The side is the one that map
    /// keeps, and the turn its rotation, read off the images of the crease
    /// pattern's axes (for the back, after the back's mirror image, x ↦ −x).
    pub fn look(&self, pattern: &ImportedPattern) -> ImportedLook {
        let unordered = pattern.unordered();
        let isometry = unordered.isometry(self.start).unwrap_or_default();
        let view = unordered.parts().view.transform();
        let shown = |p: Point| {
            let [x, y] = view.apply(isometry.apply(pattern.to_sheet(p)));
            // The screen's y runs down.
            [x, -y]
        };
        let origin = shown([0.0, 0.0]);
        let axis = |p: Point| {
            let [x, y] = shown(p);
            [x - origin[0], y - origin[1]]
        };
        let (ex, ey) = (axis([1.0, 0.0]), axis([0.0, 1.0]));
        let det = ex[0] * ey[1] - ex[1] * ey[0];
        let side = if det >= 0.0 {
            ViewSide::Front
        } else {
            ViewSide::Back
        };
        // The back's picture is the front's mirrored, x ↦ −x: the crease
        // pattern's x axis lands on the back at −x.
        let x_image = match side {
            ViewSide::Front => ex,
            ViewSide::Back => [-ex[0], -ex[1]],
        };
        let turn = x_image[1].atan2(x_image[0]).to_degrees();
        ImportedLook {
            side,
            turn_deg: wrap_degrees(turn),
        }
    }

    /// Turn `pattern`'s view so that Fold shows the imported state turned
    /// `turn_deg`, clockwise on screen, from Oriedita's picture of the side
    /// it shows: what the Layer order dialog's Rotate hands back, in
    /// [`ImportedLook`]'s terms, so [`ImportedFaces::look`] reads it back.
    /// The side never changes. Answers how far it turned, in degrees
    /// clockwise on screen, the shorter way: in (−180, 180]. A non-finite
    /// turn turns nothing.
    pub fn turn_to(&self, pattern: &mut ImportedPattern, turn_deg: f64) -> f64 {
        if !turn_deg.is_finite() {
            return 0.0;
        }
        let now = self.look(pattern).turn_deg;
        let by = shorter_turn(turn_deg - now);
        // The view turns counter-clockwise on the display, the screen's y
        // down: a turn clockwise on screen is the view's the other way, from
        // either side (a turned-over view's rotation follows its mirror).
        pattern.rotate_view(-by.to_radians());
        by
    }
}

/// A turn in degrees, the shorter way round: in (−180, 180].
fn shorter_turn(degrees: f64) -> f64 {
    let wrapped = wrap_degrees(degrees);
    if wrapped > 180.0 {
        wrapped - 360.0
    } else {
        wrapped
    }
}

/// The match rule (see the module docs), over faces by index: `oriedita`
/// faces on one side, `imported` on the other; `forward(k)` is the imported
/// face Oriedita face `k`'s interior point lies in, `backward(f)` the
/// Oriedita face imported face `f`'s witness lies in, and `same_area(k, f)`
/// whether their paper areas agree. Answers each Oriedita face's imported
/// face: one for one, each checked both ways, as a saved record's faces are
/// found again (`restore.rs`).
fn matched(
    oriedita: usize,
    imported: usize,
    forward: impl Fn(usize) -> Option<usize>,
    backward: impl Fn(usize) -> Option<usize>,
    same_area: impl Fn(usize, usize) -> bool,
) -> Result<Vec<usize>, FacesDiffer> {
    if oriedita != imported {
        return Err(FacesDiffer::Count { oriedita, imported });
    }
    let mut of_oriedita = Vec::with_capacity(oriedita);
    let mut taken = vec![false; imported];
    for k in 0..oriedita {
        let unmatched = FacesDiffer::Unmatched {
            face: FaceId(k as u32),
        };
        let f = forward(k).ok_or(unmatched.clone())?;
        if f >= imported || taken[f] || !same_area(k, f) {
            return Err(unmatched);
        }
        taken[f] = true;
        of_oriedita.push(f);
    }
    // And back: each imported face's own point lies in the Oriedita face it was matched to.
    for (k, &f) in of_oriedita.iter().enumerate() {
        if backward(f) != Some(k) {
            return Err(FacesDiffer::Unwitnessed {
                face: FaceId(k as u32),
            });
        }
    }
    Ok(of_oriedita)
}

/// Imported face `index`'s area on the sheet, in the input's units squared
/// (its ring mapped back through the placement).
fn input_area(pattern: &ImportedPattern, index: usize) -> f64 {
    let parts = pattern.unordered().parts();
    let ring: Vec<Point> = parts.faces[index]
        .ring
        .iter()
        .filter_map(|v| parts.vertices.get(v.index()).copied())
        .map(|p| pattern.to_input(p))
        .collect();
    convex::signed_area(&ring).abs()
}

/// An angle in [0, 360), with −0 and values within a hair of 360 as 0.
fn wrap_degrees(degrees: f64) -> f64 {
    let wrapped = degrees.rem_euclid(360.0);
    if (360.0 - wrapped).abs() < 1e-9 || wrapped.abs() < 1e-9 {
        0.0
    } else {
        wrapped
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Three faces each side, imported face `f` being Oriedita face `PERM[f]`.
    const PERM: [usize; 3] = [2, 0, 1];

    fn forward(k: usize) -> Option<usize> {
        PERM.iter().position(|&o| o == k)
    }

    fn backward(f: usize) -> Option<usize> {
        PERM.get(f).copied()
    }

    #[test]
    fn faces_that_match_both_ways_are_matched_one_for_one() {
        let of = matched(3, 3, forward, backward, |_, _| true);
        assert_eq!(of, Ok(vec![1, 2, 0]));
    }

    #[test]
    fn a_match_that_holds_one_way_only_is_refused() {
        // Every Oriedita face's point lies in a face of its own, of its area, but
        // the witness of the face matched to Oriedita face 2 lies in face 1.
        let crossed = |f: usize| if f == 0 { Some(1) } else { backward(f) };
        assert_eq!(
            matched(3, 3, forward, crossed, |_, _| true),
            Err(FacesDiffer::Unwitnessed { face: FaceId(2) })
        );
        // A witness in no face at all.
        let lost = |f: usize| if f == 2 { None } else { backward(f) };
        assert_eq!(
            matched(3, 3, forward, lost, |_, _| true),
            Err(FacesDiffer::Unwitnessed { face: FaceId(1) })
        );
    }

    #[test]
    fn counts_points_and_areas_each_refuse() {
        assert_eq!(
            matched(3, 4, forward, backward, |_, _| true),
            Err(FacesDiffer::Count {
                oriedita: 3,
                imported: 4
            })
        );
        // Two Oriedita faces in one imported face.
        assert_eq!(
            matched(3, 3, |k| Some(k.min(1)), backward, |_, _| true),
            Err(FacesDiffer::Unmatched { face: FaceId(2) })
        );
        // A point in no imported face, or in one past the end.
        assert_eq!(
            matched(
                3,
                3,
                |k| (k != 1).then(|| forward(k)).flatten(),
                backward,
                |_, _| true
            ),
            Err(FacesDiffer::Unmatched { face: FaceId(1) })
        );
        assert_eq!(
            matched(3, 3, |_| Some(7), backward, |_, _| true),
            Err(FacesDiffer::Unmatched { face: FaceId(0) })
        );
        // Another area.
        assert_eq!(
            matched(3, 3, forward, backward, |k, _| k != 2),
            Err(FacesDiffer::Unmatched { face: FaceId(2) })
        );
    }
}
