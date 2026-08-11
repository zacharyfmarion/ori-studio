//! Where layer ordering matters, without decomposing the arrangement.
//!
//! **Ori Studio native.** See [`crate::folding3d`].
//!
//! Layer order is defined only where paper coincides with paper, so the ordering
//! *variables* are exactly the coplanar-overlap pairs. Counting them needs
//! overlap detection and nothing else — no cells, no subfaces, no hierarchy — so
//! this file never calls [`crate::fold_graph::FoldGraph::calculate_faces`]. That
//! is not an optimisation: the Euler gate there rejected 4 of 6 multi-face plane
//! patches on elementary 3D forms, and per-plane splitting makes it *stricter*,
//! since its `0.005 * faces.len()` tolerance needs roughly 200 faces in one plane
//! to open at all. Avoiding it is what makes the census possible.
//!
//! # What the count is, and what it is not
//!
//! `census >= (creases at exactly ±180)` is a **theorem**: a full fold lays two
//! faces into one plane on the same side of a shared edge, and two polygons
//! sharing an edge segment on the same side always overlap in positive area. It
//! held on every admitted corpus model and is tight on a waterbomb base.
//!
//! **The converse is false and must never be asserted.** A 5-panel strip creased
//! at +90° four times — a paper tube with a glue flap — has zero full folds and
//! measures census 1, on a non-adjacent pair. Nine panels give 6. So "no ±180
//! crease" guarantees nothing, and nothing short of running the census tells you
//! a wrap-free net is going to measure zero.
//!
//! # The pairs group by plane; the constraints over them do not
//!
//! [`CoplanarPair`] carries its plane, and it is tempting to read that grouping
//! as a decomposition. It is not. Two creases can fold onto the *same 3D line*
//! while their faces occupy different planes, and the taco-taco condition there
//! couples the two planes' variables — the measured counterexample is a 1×4 strip
//! at (−90, +180, +90), where creases 1 and 3 land on one line while faces A/D
//! are coplanar at `z = 0` and B/C at `x = 1`. Solving per plane returns a
//! definite answer and is wrong half the time, silently. So this file also
//! reports [`folded_line_index`], which is the detector for that coupling, and
//! the grouping here is a variable set and a lower bound on where ordering
//! matters — never a claim that the planes are independent.

use std::collections::BTreeMap;

use crate::checks_spatial::{Vec3, cross, dot, norm};
use crate::folding3d::admit::Admission;
use crate::folding3d::overlap::{intersection_area_with, is_convex};
use crate::folding3d::placement::{Placement3d, sub, unit};
use crate::folding3d::planes::{PlaneId, PlaneIndex, ToleranceAlarm, plane_index};
use crate::folding3d::{Fold3dRefusal, Fold3dTolerances};
use crate::geometry::Point;

/// One ordering variable: two coplanar faces whose footprints overlap.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CoplanarPair {
    pub plane: PlaneId,
    /// Global face indices, `(min, max)`. Each unordered pair appears once.
    pub faces: (usize, usize),
    /// Measured intersection area, in paper units². Carried rather than reduced
    /// to a boolean so a caller can see how far a pair sat from the bar.
    pub area: f64,
    /// Whether the two faces meet across a crease, from [`Placement3d::joins`].
    pub edge_adjacent: bool,
}

/// Where ordering matters on this placement.
#[derive(Debug, Clone, PartialEq)]
pub struct Fold3dCensus {
    /// The ordering variables, ascending by `(plane, faces)`.
    pub pairs: Vec<CoplanarPair>,
    pub plane_count: usize,
    pub patch_count: usize,
    pub face_count: usize,
    pub overlapping_pair_count: usize,
    /// Overlapping pairs that do **not** share a crease. A wrap with no full
    /// folds shows up here and nowhere else.
    pub non_adjacent_pair_count: usize,
    /// Faces sitting in a plane with at least one overlap.
    ///
    /// The number that decides whether a "render what is determined" mode is a
    /// mode at all: measured, `faces_in_overlap / face_count` is 1.00 on 12 of
    /// the 14 corpus models with a non-zero census, so the degraded picture has
    /// no opaque part left in it.
    pub faces_in_overlap: usize,
    /// Creases at an exact ±180 in the document that was placed. The fixture
    /// README's `±180` column, and computable without any placement.
    pub full_fold_creases: usize,
    /// **Distinct face pairs** joined by at least one exactly-±180 crease.
    ///
    /// This is the left-hand side of the theorem, and it is not
    /// `full_fold_creases`: a crease drawn as two collinear pieces contributes
    /// two creases and one pair, and a ±180 crease that borders no traced face —
    /// or the same face twice — contributes neither. `bird_base.fold` is the
    /// instance: 12 full folds, 4 traced faces, census 6.
    pub full_fold_pairs: usize,
    /// Smallest accepted and largest rejected overlap area, both relative to
    /// span². They bracket [`Fold3dTolerances::overlap_area_relative`], so the
    /// empty-band assertion is a read rather than a re-derivation.
    pub min_accepted_area_relative: Option<f64>,
    pub max_rejected_area_relative: f64,
}

/// Creases whose folded images land on one 3D line.
#[derive(Debug, Clone, PartialEq)]
pub struct FoldedLineGroup {
    /// Input segment indices, ascending.
    pub lines: Vec<usize>,
    /// The planes of every face incident to those creases, ascending.
    pub planes: Vec<PlaneId>,
}

impl FoldedLineGroup {
    /// Whether this group's creases carry faces in two or more planes.
    ///
    /// This is the condition under which the four half-planes wrapping the line
    /// have to be ordered together, so the two planes' ordering variables are
    /// coupled and neither can be solved alone.
    pub fn couples_planes(&self) -> bool {
        self.planes.len() > 1
    }
}

/// Which creases share a folded line, and where that crosses plane boundaries.
#[derive(Debug, Clone, PartialEq)]
pub struct FoldedLineIndex {
    pub groups: Vec<FoldedLineGroup>,
    /// Groups carrying more than one crease.
    pub coincident_groups: usize,
    /// Coincident groups whose faces span two or more planes.
    pub cross_plane_groups: usize,
}

/// Measure the census on a placement, applying no admission gate.
///
/// Takes a [`Placement3d`] rather than an [`Admission`] on purpose: it makes the
/// census pinnable on the refused fixtures too, which is where the tolerance
/// alarms actually fire, and it keeps the "residuals in, verdict once" split the
/// module is built around.
pub fn census_placement(
    placement: &Placement3d,
    tolerances: Fold3dTolerances,
) -> (PlaneIndex, Fold3dCensus) {
    let index = plane_index(placement, tolerances);
    let census = census_with_index(placement, &index, tolerances);
    (index, census)
}

/// The product path: measure, then refuse if the tolerance window is closed.
///
/// Deliberately **not** called from [`crate::folding3d::admit`]. A caller that
/// only wants a placement should not pay for the census, and composing the two is
/// the engine boundary's job rather than the gate's.
///
/// Never returns a verdict about layer *order* — that is the ordering solver's,
/// and nothing here can decide it.
pub fn census(admission: &Admission) -> Result<Fold3dCensus, Fold3dRefusal> {
    let (index, census) = census_placement(&admission.placement, admission.diagnostics.tolerances);
    match tolerance_refusal(&index, admission.placement.span) {
        Some(refusal) => Err(refusal),
        None => Ok(census),
    }
}

/// The refusal a plane partition's alarms amount to, or `None` if it raised
/// none.
///
/// Extracted so the engine boundary applies the *same* mapping without paying
/// for a second `plane_index` — two callers deriving one refusal from one alarm
/// set is exactly how the two would come to disagree about which faces to name.
pub fn tolerance_refusal(index: &PlaneIndex, span: f64) -> Option<Fold3dRefusal> {
    let alarm = index.first_alarm()?;
    let (faces, normal_radians, offset) = match alarm {
        ToleranceAlarm::TopologySpansPlanes {
            faces,
            normal_radians,
            offset,
        }
        | ToleranceAlarm::ClusterNotTransitive {
            faces,
            normal_radians,
            offset,
            ..
        } => (faces, normal_radians, offset),
    };
    Some(Fold3dRefusal::ToleranceWindowClosed {
        faces,
        normal_radians,
        offset_relative: offset / span,
        min_inter_separation: index.min_inter_separation_relative,
    })
}

fn census_with_index(
    placement: &Placement3d,
    index: &PlaneIndex,
    tolerances: Fold3dTolerances,
) -> Fold3dCensus {
    let span = placement.span;
    let area_bar = tolerances.overlap_area_relative * span * span;

    let mut adjacent: std::collections::BTreeSet<(usize, usize)> = Default::default();
    let mut full_fold_pairs: std::collections::BTreeSet<(usize, usize)> = Default::default();
    for join in &placement.joins {
        let (f, g) = join.faces;
        adjacent.insert((f.min(g), f.max(g)));
        if placement.is_full_fold(join.line) {
            full_fold_pairs.insert((f.min(g), f.max(g)));
        }
    }

    let mut pairs = Vec::new();
    let mut non_adjacent_pair_count = 0usize;
    let mut overlapped: std::collections::BTreeSet<usize> = Default::default();
    let mut min_accepted: Option<f64> = None;
    let mut max_rejected = 0.0_f64;
    let mut patch_count = 0usize;

    for (plane_id, plane) in index.planes.iter().enumerate() {
        patch_count += plane.patches.len();
        let faces = &plane.faces;
        // Bounding boxes and convexity, once per face rather than once per pair.
        let boxes: Vec<[f64; 4]> = faces
            .iter()
            .map(|&face| bounds(&index.projected[face]))
            .collect();
        let convex: Vec<bool> = faces
            .iter()
            .map(|&face| is_convex(&index.projected[face]))
            .collect();

        for i in 0..faces.len() {
            for j in (i + 1)..faces.len() {
                // Broad phase. Measured at roughly 2 ns per rejected pair, which
                // puts a bare quadratic scan at ~100 ms only near 10^4 faces in
                // one plane; the largest plane measured anywhere is 1,480. A
                // spatial index is revisited there, not before.
                let (a, b) = (boxes[i], boxes[j]);
                if a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1] {
                    continue;
                }
                let (f, g) = (faces[i], faces[j]);
                let area = intersection_area_with(
                    &index.projected[f],
                    &index.projected[g],
                    convex[i],
                    convex[j],
                );
                if area <= area_bar {
                    max_rejected = max_rejected.max(area);
                    continue;
                }
                min_accepted = Some(min_accepted.map_or(area, |m: f64| m.min(area)));
                let key = (f.min(g), f.max(g));
                let edge_adjacent = adjacent.contains(&key);
                if !edge_adjacent {
                    non_adjacent_pair_count += 1;
                }
                overlapped.insert(key.0);
                overlapped.insert(key.1);
                pairs.push(CoplanarPair {
                    plane: plane_id,
                    faces: key,
                    area,
                    edge_adjacent,
                });
            }
        }
    }

    let overlapping_pair_count = pairs.len();
    Fold3dCensus {
        pairs,
        plane_count: index.planes.len(),
        patch_count,
        face_count: placement.rings.len(),
        overlapping_pair_count,
        non_adjacent_pair_count,
        faces_in_overlap: overlapped.len(),
        full_fold_creases: placement.full_fold_creases(),
        full_fold_pairs: full_fold_pairs.len(),
        min_accepted_area_relative: min_accepted.map(|area| area / (span * span)),
        max_rejected_area_relative: max_rejected / (span * span),
    }
}

fn bounds(ring: &[Point]) -> [f64; 4] {
    let mut out = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
    for point in ring {
        out[0] = out[0].min(point.x);
        out[1] = out[1].min(point.y);
        out[2] = out[2].max(point.x);
        out[3] = out[3].max(point.y);
    }
    out
}

/// Group creases whose folded images land on the same 3D line.
///
/// The detector for cross-plane coupling, and pure geometry over the data the
/// census already has. What the coupling *means* belongs to the ordering solver;
/// this file only says where it is.
///
/// **It is reported, never a refusal.** The plan's Phase 4 checklist asked for a
/// `CrossPlaneCoupling` refusal here. Measured, coupling is not exotic: it is
/// non-zero on every admitted corpus model above six faces, including four of
/// the five committed 3D fixtures. A refusal keyed on it would decline the
/// smallest real 3D fold in the fixture set, so the kernel reports the structure
/// and the solver deals with it.
///
/// The predicate on two folded creases is: directions parallel within
/// `angle_radians`; every endpoint of each within `distance_relative * span` of
/// the other's supporting line; and their 1D extents along the shared direction
/// **strictly** overlapping. Touching at an endpoint is not coincidence, which is
/// what stops a crease drawn as two collinear pieces from pairing with itself.
pub fn folded_line_index(
    placement: &Placement3d,
    index: &PlaneIndex,
    tolerances: Fold3dTolerances,
) -> FoldedLineIndex {
    let distance = tolerances.distance_relative * placement.span;
    let sin_tolerance = tolerances.angle_radians.sin();

    let mut faces_of: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for join in &placement.joins {
        let entry = faces_of.entry(join.line).or_default();
        entry.push(join.faces.0);
        entry.push(join.faces.1);
    }

    let mut placed: Vec<FoldedSegment> = Vec::new();
    for &line in faces_of.keys() {
        let Some((begin, end)) = placement.folded_line_ends(line) else {
            continue;
        };
        let along = sub(end, begin);
        if norm(along) == 0.0 {
            continue;
        }
        placed.push(FoldedSegment {
            line,
            begin,
            direction: unit(along),
            length: norm(along),
        });
    }

    // Connected components again, and for the same reason as the plane
    // partition: coincidence under a tolerance is not transitive, and a greedy
    // pass would return a different grouping per iteration order. Quadratic over
    // creases, with a direction reject that is three multiplies — this is a
    // separate entry point precisely so the census does not pay for it.
    let mut parent: Vec<usize> = (0..placed.len()).collect();
    for i in 0..placed.len() {
        for j in (i + 1)..placed.len() {
            if coincident(&placed[i], &placed[j], sin_tolerance, distance) {
                let (a, b) = (root(&mut parent, i), root(&mut parent, j));
                if a != b {
                    parent[a.max(b)] = a.min(b);
                }
            }
        }
    }

    let mut by_root: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for slot in 0..placed.len() {
        by_root
            .entry(root(&mut parent, slot))
            .or_default()
            .push(slot);
    }

    let mut groups = Vec::with_capacity(by_root.len());
    for slots in by_root.into_values() {
        let mut lines: Vec<usize> = slots.iter().map(|&slot| placed[slot].line).collect();
        lines.sort_unstable();
        let mut planes: Vec<PlaneId> = lines
            .iter()
            .filter_map(|line| faces_of.get(line))
            .flatten()
            .map(|&face| index.plane_of[face])
            .collect();
        planes.sort_unstable();
        planes.dedup();
        groups.push(FoldedLineGroup { lines, planes });
    }

    let coincident_groups = groups.iter().filter(|group| group.lines.len() > 1).count();
    let cross_plane_groups = groups
        .iter()
        .filter(|group| group.lines.len() > 1 && group.couples_planes())
        .count();
    FoldedLineIndex {
        groups,
        coincident_groups,
        cross_plane_groups,
    }
}

struct FoldedSegment {
    line: usize,
    begin: Vec3,
    direction: Vec3,
    length: f64,
}

fn coincident(a: &FoldedSegment, b: &FoldedSegment, sin_tolerance: f64, distance: f64) -> bool {
    if norm(cross(a.direction, b.direction)) > sin_tolerance {
        return false;
    }
    let b_end = [
        b.begin[0] + b.direction[0] * b.length,
        b.begin[1] + b.direction[1] * b.length,
        b.begin[2] + b.direction[2] * b.length,
    ];
    for point in [b.begin, b_end] {
        if norm(cross(sub(point, a.begin), a.direction)) > distance {
            return false;
        }
    }
    let project = |p: Vec3| dot(sub(p, a.begin), a.direction);
    let (b_lo, b_hi) = {
        let (p, q) = (project(b.begin), project(b_end));
        (p.min(q), p.max(q))
    };
    // An explicit epsilon rather than a bare `<`. Point contact is not
    // coincidence — that is what stops a crease drawn as two collinear pieces
    // from pairing with itself — and two extents that meet end to end can agree
    // to the last ULP, which makes a bare strict comparison decide the count.
    0.0_f64.max(b_lo) + distance < a.length.min(b_hi)
}

fn root(parent: &mut [usize], mut node: usize) -> usize {
    while parent[node] != node {
        parent[node] = parent[parent[node]];
        node = parent[node];
    }
    node
}
