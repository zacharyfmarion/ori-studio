//! Which placed faces share a plane, and the frame each plane is read in.
//!
//! **Ori Studio native.** See [`crate::folding3d`].
//!
//! Layer order is defined only where paper coincides with paper, so before the
//! census can ask *which faces overlap* something has to answer *which faces
//! could*. That is this file, and it has one job the plan is emphatic about: the
//! partition it returns must be a **property of the model**, not of the order
//! the faces happened to be visited in.
//!
//! # The partition is the relation's own components, and that is what makes it unique
//!
//! Coplanarity under a tolerance is not transitive. Three planes at offsets
//! `0`, `0.6·tol`, `1.2·tol` are pairwise-within-tolerance in two of three pairs,
//! and a greedy first-match clusterer returns a *different* partition for each
//! face order — `[[0, 0.6], [1.2]]` ascending, `[[1.2, 0.6], [0]]` descending,
//! one cluster of three from the middle. Each looks fine from the inside.
//!
//! So the partition here is **not** greedy. It is the connected components of
//! the symmetric relation [`same_plane`], computed by union-find over every face
//! pair. That is canonical by construction: connected components do not depend on
//! the order edges are added, so no clustering order can disagree, and the
//! "check every pair of distinct clusters is separated" half of the argument is a
//! theorem rather than a pass — two components with a within-tolerance member
//! pair would be one component.
//!
//! What is *not* free is that the relation is an equivalence at all. The
//! verification pass ([`PlaneIndex::alarms`]) re-checks every **intra**-cluster
//! pair, and a cluster that only holds together by chaining — the ladder above —
//! comes back as [`ToleranceAlarm::ClusterNotTransitive`] naming the two faces
//! that are not within tolerance of each other. Empty alarms mean the relation is
//! a genuine equivalence on this model and the partition is the only one there is.
//!
//! # Topology is a seed and an alarm, not the classification
//!
//! Faces joined across an exactly-±180 crease are coplanar by construction: a
//! half-turn about a line in a plane maps that plane to itself exactly. The plan
//! expected that to "classify most of the model for free". It does — on an
//! **all-180 document**, where it is the whole answer. On a document with real
//! 3D angles it over-splits by roughly 4x, because most creases are not full
//! folds and carry no such guarantee. So it is recorded
//! ([`PlaneIndex::topological_class_of`]) and checked
//! ([`ToleranceAlarm::TopologySpansPlanes`]) rather than used to build the
//! partition — feeding it in would merge two genuinely distinct planes whenever
//! the placement is numerically inconsistent, which is exactly the case the alarm
//! exists to report.

use std::collections::BTreeMap;

use crate::checks_spatial::{Vec3, cross, dot, norm};
use crate::folding3d::Fold3dTolerances;
use crate::folding3d::placement::{Placement3d, sub, unit};
use crate::geometry::Point;

/// Index into [`PlaneIndex::planes`].
pub type PlaneId = usize;

/// The coarse angle gate in [`compare`], and the bar below which it is sound.
///
/// `COARSE_REJECT_COSINE` is `cos(COARSE_REJECT_RADIANS)`, and the gate is only
/// taken when the caller's own angle tolerance is strictly smaller — otherwise a
/// deliberately loose tolerance would be silently narrowed to 2.56 degrees. Not a
/// policy threshold and so not a member of [`Fold3dTolerances`]: it changes no
/// answer, only how quickly the obvious ones are reached.
const COARSE_REJECT_COSINE: f64 = 0.999;
const COARSE_REJECT_RADIANS: f64 = 0.044;

/// How many [`ToleranceAlarm`]s a [`PlaneIndex`] keeps.
///
/// The count is always exact; only the list is capped. One alarm is enough to
/// say the tolerance window is closed, and a handful is enough to see the shape
/// of why.
pub const MAX_REPORTED_ALARMS: usize = 16;

/// One plane of the folded figure, with the frame it is read in.
#[derive(Debug, Clone, PartialEq)]
pub struct Plane3d {
    /// Unit normal, and the plane's **orientation reference**.
    ///
    /// A stack has no canonical up until one is picked, and picking it wrong
    /// emits reversed stacks that look entirely plausible. So it is picked once,
    /// here, by a rule that depends on nothing but the placement: the placed
    /// normal of the lowest-indexed member face. `FoldGraph`'s face numbering is
    /// a deterministic function of the segment slice, so a refold, a reload and
    /// a re-enumeration all produce the same `up`.
    ///
    /// On an all-180 document the whole model is one plane and the lowest-indexed
    /// face is normally the walk's own root, whose transform is the identity — so
    /// `up` is `+z` and the flat reading of "above" is recovered unchanged.
    pub up: Vec3,
    /// A point in the plane: the centroid of the reference face. Projection is
    /// relative to this, so the 2D coordinates stay near zero however far the
    /// plane is from the world origin.
    pub origin: Vec3,
    /// In-plane axes with `u × v == up`, so counter-clockwise in `(u, v)` means
    /// the paper's front faces `up` — the same convention
    /// [`Placement3d::face_normals`] is written in.
    ///
    /// **Emitted, never recomputed.** A consumer that derives its own tangent
    /// from a different seed vector gets a different chirality, and every stack
    /// it reads off the projected winding comes out reversed.
    pub u: Vec3,
    pub v: Vec3,
    /// Global face indices, ascending. The lowest is the reference face.
    pub faces: Vec<usize>,
    /// Connected runs of edge-adjacent faces within this plane, from
    /// [`Placement3d::joins`] rather than from a shared-vertex test. Each is
    /// ascending, and they are ordered by their lowest member.
    pub patches: Vec<Vec<usize>>,
    /// How many topological (±180-joined) classes this plane holds. One means
    /// topology alone would have found it.
    pub topological_classes: usize,
    /// Worst normal disagreement between any two of this plane's faces, radians.
    /// A **residual**, not a verdict — the bar is applied once, in [`plane_index`],
    /// and reported as an alarm.
    pub normal_diameter_radians: f64,
    /// Worst offset disagreement between any two of this plane's faces, in paper
    /// units.
    pub offset_diameter: f64,
}

/// A tolerance statement that did not hold.
///
/// Each is a first-class alarm and never a tie-break: the clustering does not
/// consult them, it reports them. That is what lets them be tested on models the
/// admission gate refuses, which is where they actually fire.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ToleranceAlarm {
    /// Two faces joined across an exactly-±180 crease did not land in one plane.
    ///
    /// Geometrically impossible — a half-turn about an in-plane line maps the
    /// plane to itself — so this is a statement about the placement's numerical
    /// consistency, and it is the cheapest one available. Defence in depth: it
    /// never fires on an admitted model.
    TopologySpansPlanes {
        faces: (usize, usize),
        normal_radians: f64,
        offset: f64,
    },
    /// Two faces in one plane are not within tolerance of **each other**.
    ///
    /// Coplanarity under a tolerance is not transitive, so a component can hold
    /// together by chaining. This is that, named.
    ClusterNotTransitive {
        plane: PlaneId,
        faces: (usize, usize),
        normal_radians: f64,
        offset: f64,
    },
}

/// Every placed face's plane, its frame, and its projected ring.
#[derive(Debug, Clone, PartialEq)]
pub struct PlaneIndex {
    pub planes: Vec<Plane3d>,
    /// Indexed by **global** face index, aligned with [`Placement3d::rings`],
    /// [`Placement3d::face_points`] and [`Placement3d::face_normals`]. Every face
    /// appears in exactly one plane, so this is a partition.
    pub plane_of: Vec<PlaneId>,
    /// Each face's ring in its own plane's `(u, v)` frame, relative to that
    /// plane's `origin`. Computed once, so the census and anything downstream see
    /// identical coordinates rather than two roundings of the same projection.
    pub projected: Vec<Vec<Point>>,
    /// Each face's ±180-connected class. Reported; the partition is not built
    /// from it.
    pub topological_class_of: Vec<usize>,
    pub topological_classes: usize,
    /// Empty means [`same_plane`] is a genuine equivalence relation on this
    /// model, so the partition is unique.
    ///
    /// Capped at [`MAX_REPORTED_ALARMS`]; [`PlaneIndex::alarm_count`] is the
    /// total. A model whose placement is badly inconsistent produces one per
    /// offending pair, and the corpus contains one that produces 252,270 —
    /// keeping all of them costs megabytes to say something the first one
    /// already said.
    pub alarms: Vec<ToleranceAlarm>,
    /// How many alarms fired in total, whether or not they were kept.
    pub alarm_count: usize,
    /// Worst intra-plane normal disagreement over the whole model, radians.
    pub worst_intra_normal_radians: f64,
    /// Worst intra-plane offset disagreement over the whole model, relative to
    /// the paper span.
    pub worst_intra_offset_relative: f64,
    /// Smallest offset gap between two **distinct** planes whose normals are
    /// parallel, relative to the paper span.
    ///
    /// `None` when no two distinct planes are parallel at all — measured, that is
    /// the common case on small models, and it must never be read as "infinitely
    /// separated". This is the side condition's upper bound
    /// (`loop_gap < dist_tol < min plane separation`), reported and never gated,
    /// exactly as the research requires.
    ///
    /// It is **not** [`crate::folding3d::Fold3dDiagnostics::min_face_offset_gap`],
    /// which is a consecutive difference between per-face offsets inside a normal
    /// class and so measures intra-cluster jitter.
    pub min_inter_separation_relative: Option<f64>,
}

impl PlaneIndex {
    /// The first alarm, if the tolerance window is closed for this model.
    pub fn first_alarm(&self) -> Option<ToleranceAlarm> {
        self.alarms.first().copied()
    }
}

/// A face's plane carrier: the exact image of `+z`, and a point in the plane.
#[derive(Debug, Clone, Copy)]
struct Carrier {
    normal: Vec3,
    centroid: Vec3,
}

/// Whether two placed faces lie in one plane.
///
/// **Symmetric in `a` and `b`, deliberately and load-bearingly.** The uniqueness
/// argument is that the partition is the connected components of this relation,
/// and connected components are only well defined for a symmetric relation. Two
/// details make it so:
///
/// - The normal sign is resolved **against the other face**, never by a global
///   rule. A global rule ("flip if the first non-zero component is negative")
///   splits two normals differing by 1e-17 across an axis into opposite signs;
///   measured, that invented a 50-unit gap on a 400-unit sheet.
/// - The offset is compared along the **bisector** of the two normals, so
///   neither face is the reference. Comparing along `a`'s normal and along `b`'s
///   are different tests, and a relation that disagrees with itself when the
///   arguments swap has no components.
///
/// The angle is compared as an angle (`|n_a × n_b| ≤ sin(tol)`), not as a
/// dot-product deficit. `dot > 1 − ε` is a *squared* quantity: at `ε = 1e-9` it
/// is an effective 4.5e-5 rad bar, 450x looser than
/// [`Fold3dTolerances::angle_radians`], which is how the harness's clustering can
/// be coarser than the kernel's while looking tighter.
pub fn same_plane(
    a_normal: Vec3,
    a_centroid: Vec3,
    b_normal: Vec3,
    b_centroid: Vec3,
    tolerances: Fold3dTolerances,
    span: f64,
) -> bool {
    compare(
        Carrier {
            normal: a_normal,
            centroid: a_centroid,
        },
        Carrier {
            normal: b_normal,
            centroid: b_centroid,
        },
        tolerances,
        span,
    )
    .within
}

/// What [`same_plane`] decided, and the two residuals it decided it from.
#[derive(Debug, Clone, Copy)]
struct Comparison {
    normal_radians: f64,
    offset: f64,
    within: bool,
}

/// The **one** implementation of the coplanarity question.
///
/// The clustering pass and the verification pass both go through here, which is
/// the point. Two implementations of one predicate — a dot-product deficit in one
/// and an angle in the other, or a cluster-seed offset against a centroid offset
/// — is how a partition and its own verification end up disagreeing about what
/// they checked, and the disagreement reads as a passing test.
fn compare(a: Carrier, b: Carrier, tolerances: Fold3dTolerances, span: f64) -> Comparison {
    let aligned = dot(a.normal, b.normal);
    // A cheap reject, and what keeps the all-pairs clustering pass to three
    // multiplies on the overwhelming majority of pairs. `0.999` is 2.56 degrees,
    // so it can only reject pairs the real bar would have rejected — but only
    // while the real bar is well below it, which is why the gate is switched off
    // rather than assumed. `acos` is well conditioned this far from 1, so the
    // residual it reports on this path is a real number.
    if tolerances.angle_radians < COARSE_REJECT_RADIANS && aligned.abs() < COARSE_REJECT_COSINE {
        return Comparison {
            normal_radians: aligned.abs().min(1.0).acos(),
            // Measured against `a`'s plane rather than the bisector's. The two
            // normals are degrees apart here, so there is no shared plane for a
            // bisector to be the normal of, and the number is only ever read off
            // an alarm.
            offset: dot(a.normal, sub(a.centroid, b.centroid)).abs(),
            within: false,
        };
    }
    let b_normal = if aligned < 0.0 {
        neg(b.normal)
    } else {
        b.normal
    };
    let normal_radians = norm(cross(a.normal, b_normal)).atan2(dot(a.normal, b_normal));
    let bisector = unit(add(a.normal, b_normal));
    let offset = dot(bisector, sub(a.centroid, b.centroid)).abs();
    Comparison {
        normal_radians,
        offset,
        // `angle <= tol` and `|n_a x n_b| <= sin(tol)` are the same test on
        // `[0, pi/2]`, which is where the sign resolution above puts it.
        within: normal_radians <= tolerances.angle_radians
            && offset <= tolerances.distance_relative * span,
    }
}

/// Group every placed face into a plane, and report what the tolerances did.
///
/// Infallible by construction: it always returns a partition, and every tolerance
/// violation comes back as data in [`PlaneIndex::alarms`]. That is what makes the
/// alarms testable on models the admission gate refuses — which is where they
/// fire — and it mirrors the split the module already has between
/// [`crate::folding3d::place_segments`], which returns residuals, and
/// [`crate::folding3d::admit`], which returns a verdict.
pub fn plane_index(placement: &Placement3d, tolerances: Fold3dTolerances) -> PlaneIndex {
    let faces = placement.rings.len();
    let carriers: Vec<Carrier> = (0..faces)
        .map(|face| Carrier {
            normal: placement.face_normals[face],
            centroid: centroid(&placement.face_points[face]),
        })
        .collect();

    // 1. Topological classes, recorded and never merged in. A ±180 join is an
    //    exact coplanarity, so a class that ends up spanning two planes is an
    //    alarm rather than an instruction.
    let mut topology = UnionFind::new(faces);
    for join in &placement.joins {
        if placement
            .fold_angle_radians(join.line)
            .is_some_and(is_full_fold)
        {
            topology.union(join.faces.0, join.faces.1);
        }
    }
    let (topological_class_of, topological_classes) = topology.labels();

    // 2. The partition: connected components of `same_plane`. Not greedy — see
    //    the module docs. The `find` guard makes the common case (two faces
    //    already known to share a plane) free, and the dot-product reject in
    //    `same_plane` makes the cross-plane case three multiplies.
    let mut geometry = UnionFind::new(faces);
    for i in 0..faces {
        for j in (i + 1)..faces {
            if geometry.find(i) == geometry.find(j) {
                continue;
            }
            if compare(carriers[i], carriers[j], tolerances, placement.span).within {
                geometry.union(i, j);
            }
        }
    }
    let (plane_of, plane_count) = geometry.labels();

    let mut members: Vec<Vec<usize>> = vec![Vec::new(); plane_count];
    for (face, &plane) in plane_of.iter().enumerate() {
        members[plane].push(face);
    }

    // 3. Patches, from the walk's own edge adjacency in O(E). The harness derives
    //    this from an O(F^2) shared-vertex test; `joins` is exact, keyed on the
    //    edge, and already computed.
    let mut patch_sets = UnionFind::new(faces);
    for join in &placement.joins {
        let (f, g) = join.faces;
        if plane_of[f] == plane_of[g] {
            patch_sets.union(f, g);
        }
    }

    // 4. Verification: every intra-plane pair, both coordinates. Cross-plane
    //    pairs need no pass — two components with a within-tolerance member pair
    //    would be one component.
    let mut alarms = Alarms::default();
    let mut worst_intra_normal_radians = 0.0_f64;
    let mut worst_intra_offset = 0.0_f64;
    let mut diameters: Vec<(f64, f64)> = vec![(0.0, 0.0); plane_count];
    for (plane, faces_here) in members.iter().enumerate() {
        for i in 0..faces_here.len() {
            for j in (i + 1)..faces_here.len() {
                let (a, b) = (faces_here[i], faces_here[j]);
                let seen = compare(carriers[a], carriers[b], tolerances, placement.span);
                diameters[plane].0 = diameters[plane].0.max(seen.normal_radians);
                diameters[plane].1 = diameters[plane].1.max(seen.offset);
                worst_intra_normal_radians = worst_intra_normal_radians.max(seen.normal_radians);
                worst_intra_offset = worst_intra_offset.max(seen.offset);
                if !seen.within {
                    alarms.record(ToleranceAlarm::ClusterNotTransitive {
                        plane,
                        faces: (a, b),
                        normal_radians: seen.normal_radians,
                        offset: seen.offset,
                    });
                }
            }
        }
    }

    // 5. The topology alarm, after the partition exists.
    for join in &placement.joins {
        let (f, g) = join.faces;
        if plane_of[f] == plane_of[g] {
            continue;
        }
        if placement
            .fold_angle_radians(join.line)
            .is_some_and(is_full_fold)
        {
            let seen = compare(carriers[f], carriers[g], tolerances, placement.span);
            alarms.record(ToleranceAlarm::TopologySpansPlanes {
                faces: (f.min(g), f.max(g)),
                normal_radians: seen.normal_radians,
                offset: seen.offset,
            });
        }
    }

    // 6. Frames, patches and the projection.
    let mut planes = Vec::with_capacity(plane_count);
    let mut projected: Vec<Vec<Point>> = vec![Vec::new(); faces];
    for (plane, faces_here) in members.iter().enumerate() {
        let reference = faces_here[0];
        let up = carriers[reference].normal;
        let origin = carriers[reference].centroid;
        let (u, v) = tangent_frame(up);

        for &face in faces_here {
            projected[face] = placement.face_points[face]
                .iter()
                .map(|&p| {
                    let d = sub(p, origin);
                    Point::new(dot(d, u), dot(d, v))
                })
                .collect();
        }

        let mut runs: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for &face in faces_here {
            runs.entry(patch_sets.find(face)).or_default().push(face);
        }
        let mut patches: Vec<Vec<usize>> = runs.into_values().collect();
        patches.sort_by_key(|patch| patch[0]);

        let mut classes: Vec<usize> = faces_here
            .iter()
            .map(|&face| topological_class_of[face])
            .collect();
        classes.sort_unstable();
        classes.dedup();

        planes.push(Plane3d {
            up,
            origin,
            u,
            v,
            faces: faces_here.clone(),
            patches,
            topological_classes: classes.len(),
            normal_diameter_radians: diameters[plane].0,
            offset_diameter: diameters[plane].1,
        });
    }

    let min_inter_separation_relative =
        min_inter_separation(&planes, tolerances).map(|separation| separation / placement.span);

    PlaneIndex {
        planes,
        plane_of,
        projected,
        topological_class_of,
        topological_classes,
        alarms: alarms.kept,
        alarm_count: alarms.total,
        worst_intra_normal_radians,
        worst_intra_offset_relative: worst_intra_offset / placement.span,
        min_inter_separation_relative,
    }
}

/// Smallest offset gap between two distinct planes whose normals are parallel.
///
/// Over the planes' **reference faces**, which are members, so a value at or
/// below the distance tolerance would contradict the partition: the two
/// reference faces would have been one component. It is therefore a reported
/// side condition rather than a check, and `None` — no two planes parallel at
/// all — is a real and common answer, not an infinity.
fn min_inter_separation(planes: &[Plane3d], tolerances: Fold3dTolerances) -> Option<f64> {
    let mut minimum: Option<f64> = None;
    for i in 0..planes.len() {
        for j in (i + 1)..planes.len() {
            let (a, b) = (&planes[i], &planes[j]);
            let seen = compare(
                Carrier {
                    normal: a.up,
                    centroid: a.origin,
                },
                Carrier {
                    normal: b.up,
                    centroid: b.origin,
                },
                tolerances,
                f64::INFINITY,
            );
            if seen.normal_radians > tolerances.angle_radians {
                continue;
            }
            minimum = Some(minimum.map_or(seen.offset, |m: f64| m.min(seen.offset)));
        }
    }
    minimum
}

/// Right-handed in-plane axes for `up`, with `u × v == up`.
///
/// The seed is the least-aligned coordinate axis, so `cross(up, seed)` is never
/// near-degenerate.
fn tangent_frame(up: Vec3) -> (Vec3, Vec3) {
    let seed = if up[0].abs() <= up[1].abs() && up[0].abs() <= up[2].abs() {
        [1.0, 0.0, 0.0]
    } else if up[1].abs() <= up[2].abs() {
        [0.0, 1.0, 0.0]
    } else {
        [0.0, 0.0, 1.0]
    };
    let u = unit(cross(up, seed));
    // `u x v = u x (up x u) = up (u.u) - u (u.up) = up`, since `u` is a unit
    // vector perpendicular to `up`.
    let v = cross(up, u);
    (u, v)
}

fn centroid(ring: &[Vec3]) -> Vec3 {
    if ring.is_empty() {
        return [0.0, 0.0, 0.0];
    }
    let mut sum = [0.0, 0.0, 0.0];
    for point in ring {
        sum = add(sum, *point);
    }
    let count = ring.len() as f64;
    [sum[0] / count, sum[1] / count, sum[2] / count]
}

/// Whether a crease's own angle is an exact half-turn.
///
/// Exact, not "within the flat snap": the gate already pulled every near-flat
/// crease to a full fold in its own copy, and this reads that copy through
/// [`Placement3d::fold_angle_radians`]. A second window here would snap creases
/// the placement rotated by something else.
fn is_full_fold(radians: f64) -> bool {
    radians.abs() == std::f64::consts::PI
}

fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn neg(a: Vec3) -> Vec3 {
    [-a[0], -a[1], -a[2]]
}

/// A bounded alarm list with an exact count.
#[derive(Default)]
struct Alarms {
    kept: Vec<ToleranceAlarm>,
    total: usize,
}

impl Alarms {
    fn record(&mut self, alarm: ToleranceAlarm) {
        self.total += 1;
        if self.kept.len() < MAX_REPORTED_ALARMS {
            self.kept.push(alarm);
        }
    }
}

/// Union-find with path halving. Labels come out in ascending order of each
/// component's lowest member, so nothing downstream depends on a hash order.
struct UnionFind {
    parent: Vec<usize>,
}

impl UnionFind {
    fn new(size: usize) -> Self {
        Self {
            parent: (0..size).collect(),
        }
    }

    fn find(&mut self, mut node: usize) -> usize {
        while self.parent[node] != node {
            self.parent[node] = self.parent[self.parent[node]];
            node = self.parent[node];
        }
        node
    }

    fn union(&mut self, a: usize, b: usize) {
        let (a, b) = (self.find(a), self.find(b));
        if a == b {
            return;
        }
        // Always keep the lower index as the root, so a component's
        // representative is its lowest member and the labelling below is stable.
        if a < b {
            self.parent[b] = a;
        } else {
            self.parent[a] = b;
        }
    }

    /// `(label per element, label count)`, labels assigned in ascending order of
    /// each component's lowest member.
    fn labels(&mut self) -> (Vec<usize>, usize) {
        let mut label_of: BTreeMap<usize, usize> = BTreeMap::new();
        let mut out = Vec::with_capacity(self.parent.len());
        for node in 0..self.parent.len() {
            let root = self.find(node);
            let next = label_of.len();
            out.push(*label_of.entry(root).or_insert(next));
        }
        (out, label_of.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `u x v == up`, on a spread of normals including the axis-aligned ones
    /// where the seed choice changes.
    ///
    /// A left-handed frame is the single cheapest way to emit stacks that are
    /// reversed and look right, so the constructor's claim is asserted directly.
    #[test]
    fn the_plane_frame_is_right_handed_everywhere() {
        let mut normals = vec![
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [-1.0, 0.0, 0.0],
            [0.0, -1.0, 0.0],
            [0.0, 0.0, -1.0],
        ];
        for k in 0..40 {
            let t = k as f64 * 0.37;
            normals.push(unit([t.cos(), (2.0 * t).sin(), (0.5 * t + 0.3).cos()]));
        }
        for up in normals {
            let (u, v) = tangent_frame(up);
            assert!((norm(u) - 1.0).abs() < 1e-12, "u is not a unit vector");
            assert!((norm(v) - 1.0).abs() < 1e-12, "v is not a unit vector");
            assert!(dot(u, up).abs() < 1e-12, "u is not in the plane");
            assert!(dot(v, up).abs() < 1e-12, "v is not in the plane");
            let handedness = sub(cross(u, v), up);
            assert!(
                norm(handedness) < 1e-12,
                "u x v is not up for {up:?}: off by {}",
                norm(handedness)
            );
        }
    }

    /// The relation has to agree with itself when its arguments swap, or the
    /// components it induces are not well defined.
    #[test]
    fn the_coplanarity_relation_is_symmetric() {
        let tolerances = Fold3dTolerances::DEFAULT;
        let span = 400.0;
        let mut checked = 0usize;
        for k in 0..60 {
            let t = k as f64 * 0.211;
            let a_normal = unit([t.cos(), t.sin(), 0.25]);
            // A normal a hair off `a`, sometimes flipped, so the sign resolution
            // is exercised in both directions.
            let wobble = 4e-8 * ((k % 7) as f64 - 3.0);
            let b_normal = unit([
                (t + wobble).cos(),
                (t + wobble).sin(),
                0.25 + 1e-9 * ((k % 5) as f64),
            ]);
            let b_normal = if k % 2 == 0 { neg(b_normal) } else { b_normal };
            let a_centroid = [10.0 * t, -3.0, 7.0];
            let b_centroid = [10.0 * t + 1e-5 * (k as f64 - 30.0), -3.0, 7.0];
            let forward = same_plane(a_normal, a_centroid, b_normal, b_centroid, tolerances, span);
            let backward = same_plane(b_normal, b_centroid, a_normal, a_centroid, tolerances, span);
            assert_eq!(forward, backward, "asymmetric at k={k}");
            if forward {
                checked += 1;
            }
        }
        assert!(
            checked > 5 && checked < 55,
            "{checked} of 60 sample pairs were coplanar; the sample decides nothing"
        );
    }
}
