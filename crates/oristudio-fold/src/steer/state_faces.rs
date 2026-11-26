//! A Fold state's faces and the faces Edit folds of its crease pattern
//! (`implementation-plans/fold-adjust-order.md`): what lets Fold's Adjust
//! order open the Layer order dialog on the paper on screen, and take the
//! order its Apply chose back onto that paper exactly.
//!
//! The dialog analyses a [`LayerSource`]: Oriedita's faces of the state's
//! crease pattern as Edit folds it whole ([`crate::fold_cp_to_model`] through
//! the CP kernel's selection fold, as Import CP's opening folds its pattern).
//! Edit folds only its folding colours, and a flat crease goes over
//! unassigned, so one Edit face can be several of the state's, side by side
//! across the flat creases between them. [`StateFaces`] matches them many to
//! one, checked both ways, by the rule Import CP's one-for-one match uses
//! ([`super::ImportedFaces`]):
//!
//! - each state face's witness lies in one Edit face, and every Edit face
//!   has at least one;
//! - each Edit face's interior point, unless it lies on a flat crease
//!   between two of the state's faces, lies in one matched to it;
//! - an Edit face's paper area is its state faces' together, within
//!   [`AREA_TOLERANCE`], so they cover it;
//! - the state faces of one Edit face show one side: they lie side by side
//!   on one panel, never over each other.
//!
//! Orders then go across exactly:
//!
//! - **into the dialog**, the state's order as Oriedita's relations over its
//!   faces ([`StateFaces::oriedita_relations`]): the order the dialog opens
//!   on, so an Apply that changed nothing is the state's order;
//! - **back from it**, Apply's relations as seeds over the state's faces
//!   ([`StateFaces::seeds`]): every overlapping pair of state faces, one in
//!   each Edit face of a relation, fixed as the dialog chose it.
//!
//! **Ori Studio original work**, beside the ports: it reads both through
//! their public accessors and changes neither.

use std::collections::BTreeMap;

use oristudio_cp::folding::HierarchyRelation;
use oristudio_geometry::convex;
use oristudio_layer_order::{LayerOrder, LayerOrderError, OrieditaRelation};

use super::imported::{FacesDiffer, ImportedLook, look_of};
use super::restore::AREA_TOLERANCE;
use super::source::LayerSource;
use crate::complete::FixedPair;
use crate::kernel::KernelFrame;
use crate::pattern::FaceId;
use crate::unordered::Unordered;

type Point = [f64; 2];

/// See the module docs.
#[derive(Debug, Clone, PartialEq)]
pub struct StateFaces {
    /// The Edit face of each state face, by the state face's position (the
    /// parts' faces are in id order).
    edit_of: Vec<FaceId>,
    /// The state faces of each Edit face, by position, by its index.
    state_of: Vec<Vec<usize>>,
    /// A state face of the Edit face Oriedita's fold starts from: every one
    /// of them shows the same side, which gives the relations their sense.
    start: FaceId,
}

impl StateFaces {
    /// Match `layer`'s faces with the faces of `unordered`, whose crease
    /// pattern `layer` folds in `frame`'s placement (see the module docs).
    pub fn of(
        layer: &LayerSource,
        unordered: &Unordered,
        frame: &KernelFrame,
    ) -> Result<StateFaces, FacesDiffer> {
        let parts = unordered.parts();
        let wireframe = layer.render_inputs().wireframe();
        let edit_faces = wireframe.faces.len();
        let mut edit_of = Vec::with_capacity(parts.faces.len());
        let mut state_of = vec![Vec::new(); edit_faces];
        for (f, face) in parts.faces.iter().enumerate() {
            let unplaced = FacesDiffer::Unplaced { face: face.id };
            let witness = unordered.face_witness(face.id).ok_or(unplaced.clone())?;
            let k = layer
                .face_at_paper(frame.to_model(witness))
                .filter(|k| (k.0 as usize) < edit_faces)
                .ok_or(unplaced)?;
            edit_of.push(k);
            state_of[k.0 as usize].push(f);
        }
        let side = |f: usize| unordered.isometry(parts.faces[f].id).map(|t| t.front_up());
        for (k, faces) in state_of.iter().enumerate() {
            let edit = FaceId(k as u32);
            let unmatched = FacesDiffer::Unmatched { face: edit };
            if faces.is_empty() {
                return Err(unmatched);
            }
            // And back: the Edit face's own point lies in a state face
            // matched to it. Its point can lie on a flat crease between two
            // of them (a centroid often does), in no one state face: the
            // areas below then say the faces cover it.
            let point = layer.interior_point(edit).ok_or(unmatched.clone())?;
            let hit = unordered
                .face_at(frame.to_sheet(point))
                .and_then(|id| position(unordered, id));
            if hit.is_some_and(|f| edit_of[f] != edit) {
                return Err(FacesDiffer::Unwitnessed { face: edit });
            }
            let theirs = layer.paper_area(edit).unwrap_or(0.0).abs();
            let ours: f64 = faces.iter().map(|&f| model_area(unordered, frame, f)).sum();
            // False for a NaN area too: no match.
            let same_area = (ours - theirs).abs() <= AREA_TOLERANCE * theirs;
            if !same_area {
                return Err(unmatched);
            }
            let first = faces.first().and_then(|&f| side(f));
            if first.is_none() || faces.iter().any(|&f| side(f) != first) {
                return Err(unmatched);
            }
        }
        let start = state_of
            .get(wireframe.starting_face)
            .and_then(|faces| faces.first())
            .map(|&f| parts.faces[f].id)
            .ok_or(FacesDiffer::Unmatched {
                face: FaceId(wireframe.starting_face as u32),
            })?;
        Ok(StateFaces {
            edit_of,
            state_of,
            start,
        })
    }

    /// The Edit face state face `face` lies in.
    pub fn edit_face(&self, unordered: &Unordered, face: FaceId) -> Option<FaceId> {
        position(unordered, face).and_then(|f| self.edit_of.get(f).copied())
    }

    /// A state face of the Edit face Oriedita's fold starts from.
    pub fn start(&self) -> FaceId {
        self.start
    }

    /// `order`, over the state's faces, as Oriedita's relations over
    /// `layer`'s: each pair of Edit faces that share a subface and hold an
    /// ordered pair of state faces, ascending, `upper_face` nearer a viewer
    /// of the starting face's front, as [`LayerSource::oriedita_relations`]
    /// gives the dialog's own. Refused when the state orders one pair of Edit
    /// faces both ways, which Oriedita's one relation per pair cannot say.
    pub fn oriedita_relations(
        &self,
        layer: &LayerSource,
        unordered: &Unordered,
        order: &LayerOrder,
    ) -> Result<Vec<HierarchyRelation>, FacesDiffer> {
        let start_front_up = unordered.isometry(self.start).is_some_and(|t| t.front_up());
        // Each Edit pair, lower index first, and whether that one is upper.
        let mut pairs: BTreeMap<(FaceId, FaceId), bool> = BTreeMap::new();
        for r in order.to_oriedita(start_front_up) {
            let (Some(upper), Some(lower)) = (
                self.edit_face(unordered, r.upper_face),
                self.edit_face(unordered, r.lower_face),
            ) else {
                continue;
            };
            if upper == lower || !layer.shares_subface(upper, lower) {
                continue;
            }
            let (key, lo_upper) = if upper < lower {
                ((upper, lower), true)
            } else {
                ((lower, upper), false)
            };
            if pairs
                .insert(key, lo_upper)
                .is_some_and(|was| was != lo_upper)
            {
                return Err(FacesDiffer::Interleaved {
                    faces: [key.0, key.1],
                });
            }
        }
        let mut relations: Vec<HierarchyRelation> = pairs
            .into_iter()
            .map(|((lo, hi), lo_upper)| {
                let (upper, lower) = if lo_upper { (lo, hi) } else { (hi, lo) };
                HierarchyRelation {
                    upper_face: upper.0 as usize,
                    lower_face: lower.0 as usize,
                }
            })
            .collect();
        relations.sort_by_key(|r| (r.upper_face, r.lower_face));
        Ok(relations)
    }

    /// Relations over Edit's faces, `[upper, lower]` as the dialog's Apply
    /// hands them, as seeds over the state's faces: every pair of state faces
    /// that overlap, one in each face of a relation, ordered as it says.
    /// `None` when a relation names a face Edit's fold does not have; a
    /// contradiction is the layer order's.
    pub fn seeds(
        &self,
        unordered: &Unordered,
        relations: &[[usize; 2]],
    ) -> Option<Result<Vec<FixedPair>, LayerOrderError>> {
        let faces = &unordered.parts().faces;
        let problem = unordered.problem();
        let mut mapped = Vec::new();
        for &[upper, lower] in relations {
            let (above, below) = (self.state_of.get(upper)?, self.state_of.get(lower)?);
            for &f in above {
                for &g in below {
                    let (f, g) = (faces[f].id, faces[g].id);
                    if problem.is_variable(f, g) {
                        mapped.push(OrieditaRelation {
                            upper_face: f,
                            lower_face: g,
                        });
                    }
                }
            }
        }
        Some(unordered.oriedita_seeds(self.start, &mapped))
    }

    /// How Fold shows the state, in the dialog's terms (see [`ImportedLook`]).
    pub fn look(&self, unordered: &Unordered, frame: &KernelFrame) -> ImportedLook {
        look_of(unordered, self.start, |p| frame.to_sheet(p))
    }
}

/// The position of the state face `id` among the parts' faces.
fn position(unordered: &Unordered, id: FaceId) -> Option<usize> {
    unordered
        .parts()
        .faces
        .binary_search_by_key(&id, |f| f.id)
        .ok()
}

/// State face `index`'s area on the sheet, in the kernel's model units
/// squared (its ring placed as the crease pattern Edit folds is).
fn model_area(unordered: &Unordered, frame: &KernelFrame, index: usize) -> f64 {
    let parts = unordered.parts();
    let ring: Vec<Point> = parts.faces[index]
        .ring
        .iter()
        .filter_map(|v| parts.vertices.get(v.index()).copied())
        .map(|p| frame.to_model(p))
        .collect();
    convex::signed_area(&ring).abs()
}
