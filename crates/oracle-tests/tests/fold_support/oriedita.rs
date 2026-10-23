//! The seeded Oriedita verification of a Fold state (plan D8), folding colours
//! only: Oriedita is handed the state's crease pattern and its whole layer
//! order, and must find a layer order that agrees with every seeded pair.
//!
//! The recipe is the research spike's (`r3-reuse-solver` §2, 1,685 of 1,685
//! states verified), built from `oristudio-cp`'s public stages:
//! `initial_hierarchy_from_segments` plus the seeded relations, checked by
//! `validate_initial_hierarchy`; `configure_subfaces_from_segments` and
//! `equivalence_condition_candidates_from_segments`; the shipped path's closure,
//! `close_initial_hierarchy`; then `WorkerOverlapEnumerator`'s first search,
//! with swapping, as Oriedita's first "fold" runs it.
//!
//! It never asks Oriedita to reach `Solved` from the letters alone: that gave
//! false "no solutions" and stalls on valid states.
//!
//! # What Oriedita can see
//!
//! The crease pattern reaches it as Edit's does, through the one conversion
//! to the kernel's model (`fold_cp_to_model`, plan D10), in Oriedita's model
//! space. Only folding colours reach its flat fold (`B`, `M`, `V`), as Edit
//! filters them; a flat crease becomes an unassigned line and is dropped, so
//! faces on either side of a precrease are one Oriedita face. Each of our
//! faces is matched to the Oriedita face containing its centroid, placed by
//! the same `KernelFrame`; pairs within one Oriedita face are not seeded, and
//! two of our pairs on one Oriedita pair must agree, or the order is one
//! Oriedita cannot state.
//!
//! # Convention
//!
//! Oriedita's `upper_face` is nearer a viewer of the *starting face's* front
//! (`LayerOrder::to_oriedita`, calibrated on the spike's 1,685 states). The
//! starting face's side follows from any matched face: a face with Oriedita's
//! odd position has the starting face's orientation.

use std::collections::BTreeMap;

use oristudio_cp::folding::{
    AdditionalEstimationError, EquivalenceConditionSet, HierarchyRelation, InitialHierarchy,
    SubFaceConfiguration, WorkerOverlapEnumerator, close_initial_hierarchy,
    configure_subfaces_from_segments, equivalence_condition_candidates_from_segments,
    face_position_wireframe_from_segments, initial_hierarchy_from_segments,
    validate_initial_hierarchy,
};
use oristudio_cp::geometry::LineSegment;
use oristudio_fold::{FaceId, KernelFrame, State, fold_cp_to_model};
use oristudio_geometry::convex;
use oristudio_layer_order::LayerOrder;

/// Oriedita's starting face, as the shipped fold calls it.
const STARTING_FACE: i32 = 1;

/// Outer iterations the first search may spend. A seeded search settles in a
/// handful; the bound turns an upstream stall (research `r3-reuse-solver` §2)
/// into a failure that names the state instead of a hung test.
const ITERATION_BUDGET: u64 = 100_000;

/// What Oriedita says about a state's order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// It found a layer order agreeing with every seeded pair.
    Verified { seeded: usize },
    /// Two of our pairs on one pair of Oriedita's merged faces disagree: an
    /// order Oriedita cannot state, so it is not asked.
    Unrepresentable,
    /// The seeds contradict the letters (`validate_initial_hierarchy`) or what
    /// the closure derives from them.
    Contradiction(String),
    /// The search found no layer order.
    NotFound,
    /// The order it found reverses seeded pairs, or leaves them open.
    Disagrees { reversed: usize, open: usize },
    /// The search failed or ran out of its budget.
    Failed(String),
}

/// A state prepared for Oriedita: everything that does not depend on the
/// order, so a negative control reuses it.
pub struct Seeded {
    /// Our face to Oriedita's.
    faces: BTreeMap<FaceId, usize>,
    start_front_up: bool,
    initial: InitialHierarchy,
    subfaces: SubFaceConfiguration,
    conditions: EquivalenceConditionSet,
}

impl Seeded {
    pub fn new(state: &State) -> Result<Seeded, String> {
        let segments = folding_segments(state);
        let frame = KernelFrame::of(state.sheet());
        let wireframe = face_position_wireframe_from_segments(&segments, STARTING_FACE)
            .map_err(|e| format!("wireframe: {e}"))?
            .ok_or("Oriedita finds no faces")?;
        let polygons: Vec<Vec<[f64; 2]>> = wireframe
            .faces
            .iter()
            .map(|ring| {
                ring.iter()
                    .filter_map(|&i| wireframe.points.get(i))
                    .map(|p| [p.x, p.y])
                    .collect()
            })
            .collect();

        let mut faces = BTreeMap::new();
        let mut start_front_up = None;
        for face in state.faces() {
            let sheet: Vec<[f64; 2]> = face
                .ring
                .iter()
                .map(|v| state.vertices()[v.0 as usize])
                .collect();
            let centroid =
                convex::centroid(&sheet).ok_or(format!("face {} has no centroid", face.id))?;
            let at = frame.to_model(centroid);
            let hits: Vec<usize> = (0..polygons.len())
                .filter(|&k| polygons[k].len() >= 3 && contains(&polygons[k], at))
                .collect();
            let &[hit] = hits.as_slice() else {
                return Err(format!(
                    "face {} lies in {} Oriedita faces",
                    face.id,
                    hits.len()
                ));
            };
            faces.insert(face.id, hit);
            // An odd position: the starting face's orientation.
            let same_as_start = wireframe
                .face_positions
                .get(hit)
                .is_some_and(|p| p % 2 == 1);
            let front_up = state
                .front_up(face.id)
                .ok_or("a face without an isometry")?;
            let start = front_up == same_as_start;
            if *start_front_up.get_or_insert(start) != start {
                return Err(format!(
                    "face {} disagrees with the others about the starting face",
                    face.id
                ));
            }
        }

        let initial = initial_hierarchy_from_segments(&segments, STARTING_FACE)
            .map_err(|e| format!("hierarchy: {e}"))?
            .ok_or("no hierarchy")?;
        let subfaces = configure_subfaces_from_segments(&segments, STARTING_FACE)
            .map_err(|e| format!("subfaces: {e}"))?
            .ok_or("no subface arrangement")?;
        let conditions = equivalence_condition_candidates_from_segments(&segments, STARTING_FACE)
            .map_err(|e| format!("conditions: {e}"))?
            .ok_or("no conditions")?;
        Ok(Seeded {
            faces,
            start_front_up: start_front_up.unwrap_or(true),
            initial,
            subfaces,
            conditions,
        })
    }

    /// Whether every one of our faces is an Oriedita face of its own: no
    /// precrease merged two.
    pub fn one_to_one(&self) -> bool {
        let mut seen: Vec<usize> = self.faces.values().copied().collect();
        seen.sort_unstable();
        seen.dedup();
        seen.len() == self.faces.len()
    }

    /// The order as Oriedita relations on its faces; none when two of our
    /// pairs on one Oriedita pair disagree.
    fn relations(&self, order: &LayerOrder) -> Option<Vec<HierarchyRelation>> {
        let mut upper_of: BTreeMap<(usize, usize), usize> = BTreeMap::new();
        for relation in order.to_oriedita(self.start_front_up) {
            let upper = *self.faces.get(&relation.upper_face)?;
            let lower = *self.faces.get(&relation.lower_face)?;
            if upper == lower {
                continue;
            }
            let key = (upper.min(lower), upper.max(lower));
            if *upper_of.entry(key).or_insert(upper) != upper {
                return None;
            }
        }
        Some(
            upper_of
                .into_iter()
                .map(|((a, b), upper)| HierarchyRelation {
                    upper_face: upper,
                    lower_face: if upper == a { b } else { a },
                })
                .collect(),
        )
    }

    pub fn verify(&self, order: &LayerOrder) -> Verdict {
        let Some(relations) = self.relations(order) else {
            return Verdict::Unrepresentable;
        };
        let mut seeded = self.initial.clone();
        seeded.relations.extend(relations.iter().copied());
        if let Err(e) = validate_initial_hierarchy(&seeded) {
            return Verdict::Contradiction(format!("against the letters: {e:?}"));
        }
        let mut conditions = self.conditions.clone();
        let closed = match close_initial_hierarchy(&seeded, &self.subfaces, &mut conditions) {
            Ok(closed) => closed,
            Err(e @ AdditionalEstimationError::Contradiction { .. }) => {
                return Verdict::Contradiction(format!("in the closure: {e:?}"));
            }
            Err(e) => return Verdict::Failed(format!("closure: {e:?}")),
        };
        let search = WorkerOverlapEnumerator::from_subfaces(
            &self.subfaces.subfaces,
            &self.subfaces.reduced_subface_indices,
            &closed,
            Some(&conditions),
        )
        .map(|enumerator| enumerator.within_iteration_budget(ITERATION_BUDGET))
        .and_then(|mut enumerator| enumerator.possible_overlapping_search(true));
        let found = match search {
            Ok(found) if found.found => found.hierarchy,
            Ok(_) => return Verdict::NotFound,
            Err(e) => return Verdict::Failed(format!("search: {e:?}")),
        };
        let solution: std::collections::BTreeSet<(usize, usize)> = found
            .relations
            .iter()
            .map(|r| (r.upper_face, r.lower_face))
            .collect();
        let (mut reversed, mut open) = (0, 0);
        for r in &relations {
            if solution.contains(&(r.upper_face, r.lower_face)) {
                continue;
            }
            if solution.contains(&(r.lower_face, r.upper_face)) {
                reversed += 1;
            } else {
                open += 1;
            }
        }
        if reversed == 0 && open == 0 {
            Verdict::Verified {
                seeded: relations.len(),
            }
        } else {
            Verdict::Disagrees { reversed, open }
        }
    }
}

/// The folding colours of the state's crease pattern as the kernel holds it:
/// border black, mountain red, valley blue; the unassigned lines precreases
/// become are left out, as Edit leaves them out of its fold.
fn folding_segments(state: &State) -> Vec<LineSegment> {
    fold_cp_to_model(state)
        .line_segments
        .into_iter()
        .filter(|s| s.color.is_folding_line())
        .collect()
}

/// Even-odd point in polygon: an Oriedita face merged across precreases need
/// not be convex.
fn contains(polygon: &[[f64; 2]], p: [f64; 2]) -> bool {
    let mut inside = false;
    let mut j = polygon.len() - 1;
    for i in 0..polygon.len() {
        let (a, b) = (polygon[i], polygon[j]);
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}
