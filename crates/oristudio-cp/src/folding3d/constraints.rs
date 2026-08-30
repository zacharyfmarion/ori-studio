//! What the folded geometry forces about the layer order.
//!
//! **Ori Studio native.** See [`crate::folding3d`].
//!
//! # One model, and every 3D constraint falls out of it
//!
//! Take a line the folded paper meets, and look at the cross-section
//! perpendicular to it. Each face incident to the line appears as a **ray** from
//! the origin — a *slot* — and coplanar faces on the same side share one slot,
//! separated only by their layer order. A face whose *interior* the line crosses
//! appears as a full **diameter**, since it lies on both sides. Every crease is
//! then a **chord** joining the two slots of its faces, and a face crossed by the
//! line is a chord too, joining its two antipodal slots.
//!
//! Paper self-intersects at that line exactly when two chords **interleave**. So
//! every constraint here is one statement — *chords do not interleave* — read at
//! different levels of freedom:
//!
//! | what meets what | free variables | what it becomes |
//! | --- | --- | --- |
//! | two creases folded flat into one slot | 2 | the shipped **quadruple** (taco-taco) |
//! | a flat fold and a face crossed by the line, same plane | 2 | the shipped **triple** (taco-tortilla) |
//! | a flat fold and a crease leaving its slot | 2 | the shipped **triple** again |
//! | two creases leaving one slot for two different slots | 1 | a **unary** determination |
//! | a crease and a face it crosses, sharing a plane | 1 | a **unary** determination — the wall rule |
//! | two creases spanning the *same* two slots | 2, in two planes | a **cross-plane coupling** |
//! | anything whose slots are all distinct | 0 | settled by geometry: interleaved means **crossing** |
//!
//! Only the second-to-last row is new, and it is the row §5.1 of the research is
//! about: the two variables live in different planes, so no per-plane solve can
//! see the constraint. It is not exotic — measured, every admitted corpus model
//! above six faces has at least one coincident folded line whose faces span two
//! planes.
//!
//! # Why the coupling still needs no new constraint kind
//!
//! `check_quad` (`folding/additional_estimation.rs`) reads "chords `(a, b)` and
//! `(c, d)` do not interleave" off the layer table. Feed it four faces with
//! `a, c` known to be above `b, d` and its eight rules collapse to exactly
//! `[a above c] != [b above d]` — a signed relation between two order variables,
//! which is what the coupling is. Two things make that usable:
//!
//! - **The "known to be above" has to be supplied.** Cross-plane pairs carry no
//!   layer meaning of their own, so [`Fold3dConstraints::cut_seeds`] supply one:
//!   around the line, the slots are put in a fixed order, which is a *cut* of
//!   their cyclic order and is chosen from the line's own canonical frame so two
//!   coincident groups on one supporting line choose alike. They are scaffolding
//!   and never reported as ordering relations.
//! - **The sign has to be encoded in the roles, not hoped for.** Whether the
//!   coupling reads `!=` or `==` depends on how each plane's `up` runs around the
//!   line, and swapping `b` with `d` flips the condition. That is what
//!   [`Coupling::same`] carries.
//!
//! The four faces also get a merged [`SubFace`]. Without it the condition is
//! invisible to the per-subface pruning — `fast_contains` keeps only conditions
//! all of whose faces are local — and the search reaches it solely through the
//! final estimation, whose blame path then resets the guilty generator instead of
//! advancing it and reports "no valid order" on a satisfiable instance. With it
//! the four permutations the cut leaves are enumerated locally and the condition
//! prunes them to two.
//!
//! # The antecedent is the placed geometry, never M/V
//!
//! Which way a wall rises is read from the placed faces. The same `+90` bit puts
//! its wall on opposite sides of the plane with and without an upstream `180`, so
//! anything branching on [`crate::geometry::LineColor`] here is wrong on half the
//! models and plausible on the rest. The one place a colour is read is the
//! in-plane full fold, where it is exactly what the flat path reads.

use std::collections::BTreeMap;

use crate::checks_spatial::{Vec3, cross, dot, norm};
use crate::folding::{EquivalenceCondition, EquivalenceConditionSet, HierarchyRelation};
use crate::folding3d::Fold3dTolerances;
use crate::folding3d::census::FoldedLineIndex;
use crate::folding3d::placement::{Placement3d, sub, unit};
use crate::folding3d::planes::{PlaneId, PlaneIndex};
use crate::geometry::{Point, Polygon, PolygonIntersection};

/// How many [`Fold3dCrossing`]s a [`Fold3dConstraints`] keeps.
pub const MAX_REPORTED_CROSSINGS: usize = 16;

/// A self-intersection no layer order repairs.
///
/// The predicate behind these is sound but **not complete** — a state can pass
/// every one of them and still admit no valid order — which is why the verdict
/// stays three-way and this is never used as a standalone validity gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fold3dCrossing {
    /// Two creases on one folded line whose four half-planes interleave with no
    /// coplanar pair between them, so nothing is left to order.
    Chords {
        lines: (usize, usize),
        faces: [usize; 4],
    },
    /// A face whose interior a folded crease passes through, entering on one
    /// side of the face's plane and leaving on the other.
    Transversal { line: usize, face: usize },
    /// Two faces in different planes, each with the same folded line running
    /// through its interior. Their sheets meet along that line at an angle.
    Sheets { line: usize, faces: (usize, usize) },
}

/// Which geometric rule determined a pair outright.
///
/// Carried so a contradiction between two of them can name both rules and both
/// creases rather than reporting a bare face pair, which is the only form a
/// reader can act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeedKind {
    /// A crease folded flat, laying its two faces into one plane.
    FullFold,
    /// A crease carrying paper out of the plane, over a face it crosses.
    Wall,
    /// Two creases leaving one slot for two different slots.
    SharedSlot,
    /// Not a determination at all: the cross-slot scaffolding a coupled
    /// condition is read in. Reported only when two of them disagree, which is a
    /// statement about the model rather than about a rule.
    Cut,
}

/// One determination, and where it came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fold3dSeed {
    pub relation: HierarchyRelation,
    pub kind: SeedKind,
    /// The crease the rule read. For [`SeedKind::SharedSlot`] it is the crease
    /// whose face the relation names first.
    pub line: usize,
}

/// What the backward check found at one pair of chords.
///
/// Kept separate from [`Fold3dCrossing`] because "these two chords cross" and
/// "the relations do not say where these faces sit" are different answers, and
/// collapsing them makes the checker report a crossing when it means it could not
/// look. The second happens when two faces meeting a line on the same side
/// overlap by less than the census bar, so no ordering variable exists between
/// them and the facewise model has nothing to say about their angular order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Interleaving {
    Crossing {
        lines: (usize, usize),
        faces: [usize; 4],
    },
    Unordered {
        lines: (usize, usize),
        faces: [usize; 4],
    },
}

impl Interleaving {
    pub fn is_crossing(&self) -> bool {
        matches!(self, Self::Crossing { .. })
    }
}

/// A coupling between two ordering variables in two different planes.
///
/// Carried alongside the [`EquivalenceCondition`] that encodes it so a caller
/// can read the coupling as a relation rather than having to re-derive it from
/// the roles, and so the constraint graph can be built without decoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Coupling {
    pub first: (usize, usize),
    pub second: (usize, usize),
    /// `true` when the two variables must agree — `first.0` above `first.1` iff
    /// `second.0` above `second.1` — and `false` when they must differ.
    pub same: bool,
    pub lines: (usize, usize),
    /// The condition that encodes it, with `a, c` from `first` and `b, d` from
    /// `second`, and `b`/`d` swapped when the sign calls for it.
    pub condition: EquivalenceCondition,
}

/// Everything the geometry says about the layer order, before any search.
#[derive(Debug, Clone, PartialEq)]
pub struct Fold3dConstraints {
    /// Determinations: in-plane full folds, wall forcings, and the shared-slot
    /// case. Every pair here is a real ordering variable.
    pub seeds: Vec<Fold3dSeed>,
    pub conditions: EquivalenceConditionSet,
    /// Cross-plane couplings, each carrying its own condition. They are kept out
    /// of `conditions` because a coupling is only usable once its two sides are
    /// known to be ordering variables and its four faces have been given a merged
    /// subface and a cut, and the consumer that knows those things is the one that
    /// assembles them.
    pub couplings: Vec<Coupling>,
    /// Self-intersections, capped at [`MAX_REPORTED_CROSSINGS`]; the count below
    /// is exact. One line running through two stacks of eight faces reports 64
    /// pairs and says nothing the first one did not.
    pub crossings: Vec<Fold3dCrossing>,
    pub crossing_count: usize,
    /// How many full folds seeded an in-plane relation.
    pub full_fold_seeds: usize,
    /// How many wall forcings fired.
    pub wall_seeds: usize,
}

impl Fold3dConstraints {
    fn record_crossing(&mut self, crossing: Fold3dCrossing) {
        self.crossing_count += 1;
        if self.crossings.len() < MAX_REPORTED_CROSSINGS {
            self.crossings.push(crossing);
        }
    }
}

impl Default for Fold3dConstraints {
    fn default() -> Self {
        Self {
            seeds: Vec::new(),
            conditions: EquivalenceConditionSet {
                triple_conditions: Vec::new(),
                quadruple_conditions: Vec::new(),
            },
            couplings: Vec::new(),
            crossings: Vec::new(),
            crossing_count: 0,
            full_fold_seeds: 0,
            wall_seeds: 0,
        }
    }
}

/// Seed one relation per crease that folds two faces flat into one plane.
///
/// This is [`crate::folding`]'s `initial_hierarchy_from_graph` with exactly one
/// boolean substituted — `dot(face_normal, up_P) > 0` for `first_position % 2 ==
/// 1` — and the same `LineColor::Red1` branch kept verbatim. Both encode the same
/// thing in the flat regime, because a face at even BFS depth has been flipped an
/// even number of times and so still faces `+z`; the normal is what that means
/// once the creases are no longer all half-turns.
///
/// The flat function's `SameParityAdjacentFaces` abort goes with the parity seed
/// it belongs to. It is Maekawa's even-degree corollary, correct in the flat
/// regime and meaningless here.
pub fn initial_hierarchy_3d(placement: &Placement3d, index: &PlaneIndex) -> Vec<Fold3dSeed> {
    let mut seen: BTreeMap<(usize, usize), Fold3dSeed> = BTreeMap::new();
    for join in &placement.joins {
        let (first, second) = join.faces;
        if first == second || !placement.is_full_fold(join.line) {
            continue;
        }
        let plane = index.plane_of[first];
        if index.plane_of[second] != plane {
            continue;
        }
        let up = index.planes[plane].up;
        let first_same_orientation = dot(placement.face_normals[first], up) > 0.0;
        let mountain = placement
            .fold_angle_radians(join.line)
            .is_some_and(|angle| angle < 0.0);
        let first_above_second = if mountain {
            first_same_orientation
        } else {
            !first_same_orientation
        };
        seen.insert(
            (first, second),
            Fold3dSeed {
                relation: if first_above_second {
                    HierarchyRelation {
                        upper_face: first,
                        lower_face: second,
                    }
                } else {
                    HierarchyRelation {
                        upper_face: second,
                        lower_face: first,
                    }
                },
                kind: SeedKind::FullFold,
                line: join.line,
            },
        );
    }
    seen.into_values().collect()
}

/// Read every constraint the placed geometry forces.
pub fn build_constraints(
    placement: &Placement3d,
    index: &PlaneIndex,
    lines: &FoldedLineIndex,
    tolerances: Fold3dTolerances,
) -> Fold3dConstraints {
    let mut out = Fold3dConstraints {
        seeds: initial_hierarchy_3d(placement, index),
        ..Default::default()
    };
    out.full_fold_seeds = out.seeds.len();
    let seeded: BTreeMap<(usize, usize), bool> = out
        .seeds
        .iter()
        .map(|seed| {
            let key = (
                seed.relation.upper_face.min(seed.relation.lower_face),
                seed.relation.upper_face.max(seed.relation.lower_face),
            );
            (key, seed.relation.upper_face == key.0)
        })
        .collect();

    let creases = crease_slots(placement, index);
    let slack = tolerances.distance_relative * placement.span;
    for group in &lines.groups {
        let chords: Vec<&Crease> = group
            .lines
            .iter()
            .filter_map(|line| creases.get(line))
            .collect();
        if chords.is_empty() {
            continue;
        }
        for i in 0..chords.len() {
            for j in (i + 1)..chords.len() {
                chord_pair(
                    chords[i], chords[j], index, &seeded, tolerances, slack, &mut out,
                );
            }
        }
    }

    tortillas(placement, index, &creases, &seeded, tolerances, &mut out);
    out
}

/// One crease's placed image, with the slot each of its faces occupies.
struct Crease {
    line: usize,
    faces: (usize, usize),
    /// Interior direction of each face at this crease, perpendicular to it.
    into: (Vec3, Vec3),
    planes: (PlaneId, PlaneId),
    /// The line's canonical frame: direction, and two perpendicular axes.
    frame: Frame,
    /// Extent along `frame.direction`, from the frame's origin.
    span: (f64, f64),
}

#[derive(Clone, Copy)]
struct Frame {
    origin: Vec3,
    direction: Vec3,
    right: Vec3,
    up: Vec3,
}

impl Frame {
    /// Angle of a direction perpendicular to the line, in `[0, 2 * pi)`.
    fn angle(&self, into: Vec3) -> f64 {
        let raw = dot(into, self.up).atan2(dot(into, self.right));
        if raw < 0.0 {
            raw + std::f64::consts::TAU
        } else {
            raw
        }
    }
}

impl Crease {
    fn slot_of(&self, side: usize) -> (PlaneId, Vec3) {
        if side == 0 {
            (self.planes.0, self.into.0)
        } else {
            (self.planes.1, self.into.1)
        }
    }

    fn face_of(&self, side: usize) -> usize {
        if side == 0 {
            self.faces.0
        } else {
            self.faces.1
        }
    }

    fn degenerate(&self) -> bool {
        self.planes.0 == self.planes.1 && dot(self.into.0, self.into.1) > 0.0
    }
}

fn same_slot(a: (PlaneId, Vec3), b: (PlaneId, Vec3)) -> bool {
    a.0 == b.0 && dot(a.1, b.1) > 0.0
}

/// Every crease's placed image and slot geometry, keyed by input segment index.
fn crease_slots(placement: &Placement3d, index: &PlaneIndex) -> BTreeMap<usize, Crease> {
    let mut out = BTreeMap::new();
    for join in &placement.joins {
        let (first, second) = join.faces;
        if first == second || out.contains_key(&join.line) {
            continue;
        }
        let (Some((begin, end)), Some(first_into), Some(second_into)) = (
            placement.folded_line_ends(join.line),
            interior_direction(placement, first, join.line),
            interior_direction(placement, second, join.line),
        ) else {
            continue;
        };
        let direction = canonical_direction(sub(end, begin));
        if norm(direction) == 0.0 {
            continue;
        }
        let frame = frame_for(begin, direction);
        let span = {
            let (a, b) = (
                dot(sub(begin, frame.origin), frame.direction),
                dot(sub(end, frame.origin), frame.direction),
            );
            (a.min(b), a.max(b))
        };
        out.insert(
            join.line,
            Crease {
                line: join.line,
                faces: (first, second),
                into: (first_into, second_into),
                planes: (index.plane_of[first], index.plane_of[second]),
                frame,
                span,
            },
        );
    }
    out
}

/// The direction that points into `face` from its edge along `line`.
fn interior_direction(placement: &Placement3d, face: usize, line: usize) -> Option<Vec3> {
    let (a, b) = placement.directed_crease(face, line)?;
    let edge = sub(b, a);
    if norm(edge) == 0.0 {
        return None;
    }
    let into = cross(placement.face_normals[face], unit(edge));
    (norm(into) > 0.0).then(|| unit(into))
}

/// A direction sign that depends only on the line, so two coincident groups on
/// one supporting line pick the same frame and therefore the same cut.
fn canonical_direction(along: Vec3) -> Vec3 {
    if norm(along) == 0.0 {
        return along;
    }
    let unit = unit(along);
    for component in unit {
        if component.abs() > 1e-12 {
            return if component < 0.0 {
                [-unit[0], -unit[1], -unit[2]]
            } else {
                unit
            };
        }
    }
    unit
}

fn frame_for(origin: Vec3, direction: Vec3) -> Frame {
    let seed =
        if direction[0].abs() <= direction[1].abs() && direction[0].abs() <= direction[2].abs() {
            [1.0, 0.0, 0.0]
        } else if direction[1].abs() <= direction[2].abs() {
            [0.0, 1.0, 0.0]
        } else {
            [0.0, 0.0, 1.0]
        };
    let right = unit(cross(direction, seed));
    Frame {
        origin,
        direction,
        right,
        up: cross(direction, right),
    }
}

/// Whether two creases share more of the folded line than a point.
///
/// `folded_line_index` groups coincident creases into connected components, so a
/// group can hold a chain whose ends do not meet — this is what keeps a
/// constraint from being written between two of them. Measured, no corpus model
/// contains such a chain, so like the area coupling in [`super::cells`] this is
/// defence in depth rather than a tested path.
fn extents_overlap(a: &Crease, b: &Crease, slack: f64) -> bool {
    let shift = dot(sub(b.frame.origin, a.frame.origin), a.frame.direction);
    // `b.span` is b's extent in B'S OWN frame, so it has to be projected into a's
    // before it can be compared against `a.span`. Without the `sign`, two creases
    // whose canonical directions are antiparallel have b's interval used reversed,
    // and the gate then admits or rejects the wrong chord pairs — which decides
    // whether a condition is emitted at all.
    let sign = dot(b.frame.direction, a.frame.direction);
    let (first, second) = (b.span.0 * sign + shift, b.span.1 * sign + shift);
    let (lo, hi) = (first.min(second), first.max(second));
    a.span.0.max(lo) + slack < a.span.1.min(hi)
}

/// Which way the layer order runs around the line, at one slot.
///
/// `+1` when a face higher in its plane's stack sits at a larger angle around the
/// line. This is the whole reason the coupled condition needs a sign: `up` is
/// chosen per plane, and two planes meeting at a line can disagree about which
/// way their stacks wind.
fn slot_winding(frame: &Frame, plane: &crate::folding3d::planes::Plane3d, into: Vec3) -> f64 {
    if dot(plane.up, cross(frame.direction, into)) > 0.0 {
        1.0
    } else {
        -1.0
    }
}

#[allow(clippy::too_many_arguments)]
fn chord_pair(
    first: &Crease,
    second: &Crease,
    index: &PlaneIndex,
    seeded: &BTreeMap<(usize, usize), bool>,
    tolerances: Fold3dTolerances,
    slack: f64,
    out: &mut Fold3dConstraints,
) {
    if !extents_overlap(first, second, slack) {
        return;
    }
    // Two chords that share an endpoint meet there and cannot cross.
    if first.faces.0 == second.faces.0
        || first.faces.0 == second.faces.1
        || first.faces.1 == second.faces.0
        || first.faces.1 == second.faces.1
    {
        return;
    }

    match (first.degenerate(), second.degenerate()) {
        (true, true) => {
            if same_slot(first.slot_of(0), second.slot_of(0)) {
                taco_taco(first, second, seeded, out);
            }
        }
        (true, false) => taco_and_hinge(first, second, seeded, out),
        (false, true) => taco_and_hinge(second, first, seeded, out),
        (false, false) => hinge_pair(first, second, index, tolerances, out),
    }
}

/// Two flat folds in one slot: the shipped taco-taco, unchanged.
fn taco_taco(
    first: &Crease,
    second: &Crease,
    seeded: &BTreeMap<(usize, usize), bool>,
    out: &mut Fold3dConstraints,
) {
    let (a, b) = normalized(first.faces, seeded);
    let (c, d) = normalized(second.faces, seeded);
    out.conditions
        .quadruple_conditions
        .push(EquivalenceCondition { a, b, c, d });
}

/// A flat fold and a crease with one face in the same slot: the shipped triple.
///
/// The taco's two faces bracket a position in the slot and the hinge's face must
/// not sit between them, which is exactly what `check_triple` says. The hinge's
/// far face plays no part: it is in another slot, so it lies outside the arc the
/// taco spans however the layers fall.
fn taco_and_hinge(
    taco: &Crease,
    hinge: &Crease,
    seeded: &BTreeMap<(usize, usize), bool>,
    out: &mut Fold3dConstraints,
) {
    let slot = taco.slot_of(0);
    for side in 0..2 {
        if !same_slot(hinge.slot_of(side), slot) {
            continue;
        }
        let crossing = hinge.face_of(side);
        let (b, d) = normalized(taco.faces, seeded);
        out.conditions.triple_conditions.push(EquivalenceCondition {
            a: crossing,
            b,
            c: crossing,
            d,
        });
    }
}

fn hinge_pair(
    first: &Crease,
    second: &Crease,
    index: &PlaneIndex,
    tolerances: Fold3dTolerances,
    out: &mut Fold3dConstraints,
) {
    let shared: Vec<(usize, usize)> = (0..2)
        .flat_map(|a| (0..2).map(move |b| (a, b)))
        .filter(|&(a, b)| same_slot(first.slot_of(a), second.slot_of(b)))
        .collect();
    match shared.len() {
        2 => coupled(first, second, &shared, index, out),
        1 => shared_slot(first, second, shared[0], index, out),
        _ => {
            if chords_interleave(first, second, tolerances) {
                out.record_crossing(Fold3dCrossing::Chords {
                    lines: (first.line, second.line),
                    faces: [first.faces.0, first.faces.1, second.faces.0, second.faces.1],
                });
            }
        }
    }
}

/// Two creases spanning the same two slots: the cross-plane coupling.
fn coupled(
    first: &Crease,
    second: &Crease,
    shared: &[(usize, usize)],
    index: &PlaneIndex,
    out: &mut Fold3dConstraints,
) {
    let (alpha_first, alpha_second) = shared[0];
    let (beta_first, beta_second) = shared[1];
    let alpha = first.slot_of(alpha_first);
    let beta = first.slot_of(beta_first);
    if alpha.0 == beta.0 {
        // Both slots in one plane: the two variables are in the same stack and
        // the shipped quadruple already reaches them, with no cut to invent.
        return;
    }
    let winding_alpha = slot_winding(&first.frame, &index.planes[alpha.0], alpha.1);
    let winding_beta = slot_winding(&first.frame, &index.planes[beta.0], beta.1);
    let differ = winding_alpha == winding_beta;

    // The cut: the lower-numbered **plane** goes above. The condition's algebra
    // needs only "a and c are above b and d" and is symmetric under swapping the
    // two blocks, so the direction is free — but it has to be free *consistently*,
    // because the layer table holds one cell per face pair for the whole model.
    //
    // Keying it to the planes is what makes that hold. The obvious alternative,
    // "whichever slot sits at the smaller angle around this line", is not
    // consistent: a face can meet two collinear folded lines from opposite sides,
    // its slot angle differs by pi between them, and the two cuts come out
    // opposed. Measured on `spikes_large`, where faces 100 and 115 are cut both
    // ways by two couplings on one supporting line.
    let (above, below) = if alpha.0 < beta.0 {
        ((alpha_first, alpha_second), (beta_first, beta_second))
    } else {
        ((beta_first, beta_second), (alpha_first, alpha_second))
    };
    let a = first.face_of(above.0);
    let c = second.face_of(above.1);
    let high = first.face_of(below.0);
    let low = second.face_of(below.1);
    // `check_quad` with `a, c` above `b, d` reduces to `[a above c] != [b above
    // d]`, so swapping `b` and `d` is what turns that into `==`.
    let (b, d) = if differ { (high, low) } else { (low, high) };

    out.couplings.push(Coupling {
        first: (a, c),
        second: (high, low),
        same: !differ,
        lines: (first.line, second.line),
        condition: EquivalenceCondition { a, b, c, d },
    });
}

/// Two creases leaving one slot for two different slots: a unary determination.
///
/// Going around the line, the chord that leaves first has to be the one nearer
/// the outside of the shared slot, or the two cross.
fn shared_slot(
    first: &Crease,
    second: &Crease,
    shared: (usize, usize),
    index: &PlaneIndex,
    out: &mut Fold3dConstraints,
) {
    let (first_side, second_side) = shared;
    let slot = first.slot_of(first_side);
    let winding = slot_winding(&first.frame, &index.planes[slot.0], slot.1);
    let base = first.frame.angle(slot.1);
    let first_far = relative_angle(base, first.frame.angle(first.slot_of(1 - first_side).1));
    let second_far = relative_angle(base, first.frame.angle(second.slot_of(1 - second_side).1));
    if first_far == second_far {
        return;
    }
    let near = first.face_of(first_side);
    let far = second.face_of(second_side);
    // With the shared slot met first and `first`'s far slot met before
    // `second`'s, `first`'s face has to sit later in the slot's own winding.
    let first_above = (first_far < second_far) == (winding > 0.0);
    out.seeds.push(Fold3dSeed {
        relation: if first_above {
            HierarchyRelation {
                upper_face: near,
                lower_face: far,
            }
        } else {
            HierarchyRelation {
                upper_face: far,
                lower_face: near,
            }
        },
        kind: SeedKind::SharedSlot,
        line: first.line,
    });
}

fn relative_angle(base: f64, other: f64) -> f64 {
    let raw = other - base;
    if raw < 0.0 {
        raw + std::f64::consts::TAU
    } else {
        raw
    }
}

/// Whether two chords with four distinct slots interleave.
///
/// Reached by **nothing measured** — no corpus model has two creases on one
/// folded line whose four faces occupy four different planes — so the predicate
/// below is unit-tested directly rather than through a model.
fn chords_interleave(first: &Crease, second: &Crease, tolerances: Fold3dTolerances) -> bool {
    let frame = first.frame;
    arcs_interleave(
        (frame.angle(first.into.0), frame.angle(first.into.1)),
        (frame.angle(second.into.0), frame.angle(second.into.1)),
        tolerances.angle_radians,
    )
}

/// Whether two chords of a circle, given as endpoint angles, cross.
///
/// They cross when exactly one endpoint of the second lies strictly inside the
/// arc the first spans. Which of the two arcs is taken does not matter — "exactly
/// one" is the same either way — so this takes the one running forward from
/// `a.0`.
fn arcs_interleave(a: (f64, f64), b: (f64, f64), slack: f64) -> bool {
    let arc = relative_angle(a.0, a.1);
    let inside = |angle: f64| {
        let offset = relative_angle(a.0, angle);
        offset > slack && offset + slack < arc
    };
    inside(b.0) != inside(b.1)
}

/// Constraints between a crease and a face whose interior its folded image
/// crosses.
fn tortillas(
    placement: &Placement3d,
    index: &PlaneIndex,
    creases: &BTreeMap<usize, Crease>,
    seeded: &BTreeMap<(usize, usize), bool>,
    tolerances: Fold3dTolerances,
    out: &mut Fold3dConstraints,
) {
    let slack = tolerances.distance_relative * placement.span;
    let boxes: Vec<[f64; 4]> = (0..index.projected.len())
        .map(|face| bounds(&index.projected[face]))
        .collect();

    for (&line, crease) in creases {
        let Some((begin, end)) = placement.folded_line_ends(line) else {
            continue;
        };
        // Parameter along one segment, shared by every plane that looks at it, so
        // two faces are only called crossing when they are pierced over the same
        // stretch of the line rather than merely by the same line.
        let mut pierced: Vec<(usize, Vec<(f64, f64)>)> = Vec::new();
        for (plane_id, plane) in index.planes.iter().enumerate() {
            if dot(sub(begin, plane.origin), plane.up).abs() > slack
                || dot(sub(end, plane.origin), plane.up).abs() > slack
            {
                continue;
            }
            let project = |point: Vec3| {
                let offset = sub(point, plane.origin);
                Point::new(dot(offset, plane.u), dot(offset, plane.v))
            };
            let (a, b) = (project(begin), project(end));
            let segment = [a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y)];
            for &face in &plane.faces {
                if face == crease.faces.0 || face == crease.faces.1 {
                    continue;
                }
                let extent = boxes[face];
                if segment[2] < extent[0]
                    || extent[2] < segment[0]
                    || segment[3] < extent[1]
                    || extent[3] < segment[1]
                {
                    continue;
                }
                let polygon = Polygon::new(index.projected[face].clone());
                let spans = interior_spans(&polygon, a, b, slack);
                if spans.is_empty() {
                    continue;
                }
                pierce_constraint(crease, face, plane_id, plane, index, seeded, out);
                pierced.push((face, spans));
            }
        }

        let relative = slack / (dot(sub(end, begin), sub(end, begin)).sqrt().max(slack));
        for i in 0..pierced.len() {
            for j in (i + 1)..pierced.len() {
                let (f, g) = (pierced[i].0, pierced[j].0);
                if index.plane_of[f] == index.plane_of[g] {
                    continue;
                }
                if spans_overlap(&pierced[i].1, &pierced[j].1, relative) {
                    out.record_crossing(Fold3dCrossing::Sheets {
                        line,
                        faces: (f.min(g), f.max(g)),
                    });
                }
            }
        }
    }
}

/// What a crease running through `face`'s interior forces.
#[allow(clippy::too_many_arguments)]
fn pierce_constraint(
    crease: &Crease,
    face: usize,
    plane_id: PlaneId,
    plane: &crate::folding3d::planes::Plane3d,
    index: &PlaneIndex,
    seeded: &BTreeMap<(usize, usize), bool>,
    out: &mut Fold3dConstraints,
) {
    let in_plane = (
        index.plane_of[crease.faces.0] == plane_id,
        index.plane_of[crease.faces.1] == plane_id,
    );
    match in_plane {
        (true, true) => {
            if crease.degenerate() {
                // A flat fold and the face it lies inside: the shipped
                // taco-tortilla, with the crossed face barred from between.
                let (b, d) = normalized(crease.faces, seeded);
                out.conditions.triple_conditions.push(EquivalenceCondition {
                    a: face,
                    b,
                    c: face,
                    d,
                });
            }
            // An unfolded crease leaves both faces in the plane on opposite
            // sides, which is a second diameter through the same line; two
            // diameters in one plane nest rather than interleave.
        }
        (true, false) | (false, true) => {
            let (anchor, wall) = if in_plane.0 {
                (crease.faces.0, crease.into.1)
            } else {
                (crease.faces.1, crease.into.0)
            };
            // The wall stands on the line and blocks the side it rises toward,
            // so the face it crosses is pushed to the other side of the anchor.
            let rises = dot(wall, plane.up) > 0.0;
            out.wall_seeds += 1;
            out.seeds.push(Fold3dSeed {
                relation: if rises {
                    HierarchyRelation {
                        upper_face: anchor,
                        lower_face: face,
                    }
                } else {
                    HierarchyRelation {
                        upper_face: face,
                        lower_face: anchor,
                    }
                },
                kind: SeedKind::Wall,
                line: crease.line,
            });
        }
        (false, false) => {
            // No face of the crease is in the plane, so there is nothing to
            // order the crossed face against. When the two faces leave on
            // opposite sides the paper passes through the plane at a line inside
            // this face, which no layer order repairs.
            if dot(crease.into.0, plane.up) * dot(crease.into.1, plane.up) < 0.0 {
                out.record_crossing(Fold3dCrossing::Transversal {
                    line: crease.line,
                    face,
                });
            }
        }
    }
}

/// The spans of a segment that run through the polygon's interior.
///
/// In the segment's own parameter, so two planes looking at one folded crease
/// describe the same intervals and can be compared.
///
/// Running *along* an edge is not passing through: the midpoints of those spans
/// read as `Border`, which is what keeps a crease that bounds a face from being
/// read as one that pierces it.
fn interior_spans(polygon: &Polygon, a: Point, b: Point, slack: f64) -> Vec<(f64, f64)> {
    let direction = Point::new(b.x - a.x, b.y - a.y);
    let length = (direction.x * direction.x + direction.y * direction.y).sqrt();
    if length <= slack {
        return Vec::new();
    }
    let mut cuts = vec![0.0_f64, 1.0];
    for edge in polygon.line_segments() {
        // A corner sitting on the segment is a cut even when its two edges are
        // collinear with it, which is exactly when the crossing test below has no
        // intersection parameter to find.
        for corner in [edge.a, edge.b] {
            let t = ((corner.x - a.x) * direction.x + (corner.y - a.y) * direction.y)
                / (length * length);
            let on = Point::new(a.x + direction.x * t, a.y + direction.y * t);
            let away = ((corner.x - on.x).powi(2) + (corner.y - on.y).powi(2)).sqrt();
            if t > 0.0 && t < 1.0 && away <= slack {
                cuts.push(t);
            }
        }
        if let Some(t) = segment_parameter(a, direction, edge.a, edge.b)
            && t > 0.0
            && t < 1.0
        {
            cuts.push(t);
        }
    }
    cuts.sort_by(f64::total_cmp);
    let mut spans: Vec<(f64, f64)> = Vec::new();
    for window in cuts.windows(2) {
        if (window[1] - window[0]) * length <= slack {
            continue;
        }
        let mid = 0.5 * (window[0] + window[1]);
        let point = Point::new(a.x + direction.x * mid, a.y + direction.y * mid);
        if polygon.inside(point) != PolygonIntersection::Inside {
            continue;
        }
        match spans.last_mut() {
            Some(last) if (window[0] - last.1) * length <= slack => last.1 = window[1],
            _ => spans.push((window[0], window[1])),
        }
    }
    spans
}

fn spans_overlap(first: &[(f64, f64)], second: &[(f64, f64)], slack: f64) -> bool {
    first
        .iter()
        .any(|a| second.iter().any(|b| a.0.max(b.0) + slack < a.1.min(b.1)))
}

/// Parameter along `a + t * direction` where it meets the segment `p -> q`.
fn segment_parameter(a: Point, direction: Point, p: Point, q: Point) -> Option<f64> {
    let edge = Point::new(q.x - p.x, q.y - p.y);
    let denominator = direction.x * edge.y - direction.y * edge.x;
    if denominator == 0.0 {
        return None;
    }
    let offset = Point::new(p.x - a.x, p.y - a.y);
    let t = (offset.x * edge.y - offset.y * edge.x) / denominator;
    let u = (offset.x * direction.y - offset.y * direction.x) / denominator;
    (0.0..=1.0).contains(&u).then_some(t)
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

/// The pair in `(upper, lower)` order according to the seeds.
///
/// The shipped conditions are **role-typed**, not index sets: `check_triple`
/// reads `b` as the upper face and `d` as the lower, and the per-subface
/// pruning's `penetration_condition_digit` only recognises the crossing when they
/// are that way round. Mirrors `folding::normalized_pair`, over a map rather than
/// a linear scan of the relation vector — which also removes that function's
/// first-in-vector dependence.
fn normalized(faces: (usize, usize), seeded: &BTreeMap<(usize, usize), bool>) -> (usize, usize) {
    let key = (faces.0.min(faces.1), faces.0.max(faces.1));
    match seeded.get(&key) {
        Some(true) => key,
        Some(false) => (key.1, key.0),
        None => faces,
    }
}

/// Re-derive the crossing test from a finished ordering.
///
/// The constraint generator above works forwards, from the geometry to a set of
/// conditions in the shipped vocabulary, through two derivations that are easy to
/// get backwards: which way a plane's stack winds around a line
/// ([`slot_winding`]), and which role assignment makes `check_quad` say what the
/// geometry means. This works **backwards** from a solved ordering and shares
/// neither. It ranks each slot's faces from the relations alone, lays them on a
/// small circle around the line at their own layer offsets, and asks whether any
/// two chords interleave. An empty result is a second implementation agreeing
/// with the first.
///
/// Faces sharing a slot at a line normally coincide beside it, so they sit in one
/// subface and the search's own per-subface closure has ordered them. That is what
/// makes the ranking answerable: it is taken over the four endpoints of one chord
/// pair, never over a whole slot, where two faces can be ordered only through a
/// third the relation set never mentions. "Normally" is not "always" — two faces
/// can share a slot and still overlap by less than the census bar — and a pair the
/// relations fail to order comes back as [`Interleaving::Unordered`] rather than
/// being passed silently or miscalled a crossing.
///
/// It is a checker, not a gate — running it on a placement whose ordering nobody
/// solved says nothing.
pub fn interleavings(
    placement: &Placement3d,
    index: &PlaneIndex,
    lines: &FoldedLineIndex,
    above: &dyn Fn(usize, usize) -> Option<bool>,
    tolerances: Fold3dTolerances,
) -> Vec<Interleaving> {
    let creases = crease_slots(placement, index);
    let slack = tolerances.distance_relative * placement.span;
    let mut out = Vec::new();

    for group in &lines.groups {
        let members: Vec<&Crease> = group
            .lines
            .iter()
            .filter_map(|line| creases.get(line))
            .collect();
        if members.len() < 2 {
            continue;
        }
        let frame = members[0].frame;
        for i in 0..members.len() {
            for j in (i + 1)..members.len() {
                let (first, second) = (members[i], members[j]);
                if !extents_overlap(first, second, slack) {
                    continue;
                }
                if first.faces.0 == second.faces.0
                    || first.faces.0 == second.faces.1
                    || first.faces.1 == second.faces.0
                    || first.faces.1 == second.faces.1
                {
                    continue;
                }
                let ends = [(first, 0), (first, 1), (second, 0), (second, 1)];
                // Group only these four endpoints by slot. Faces sharing a slot
                // at a line coincide beside it, so they sit in one subface and
                // the search's own per-subface closure has ordered them — which
                // is why a rank over four is answerable where a rank over the
                // whole slot is not.
                let mut groups: Vec<(Vec3, PlaneId, Vec<usize>)> = Vec::new();
                let mut slot_of = [0usize; 4];
                for (slot, (crease, side)) in ends.iter().enumerate() {
                    let (plane, into) = crease.slot_of(*side);
                    let face = crease.face_of(*side);
                    let found = groups
                        .iter()
                        .position(|(other_into, other, _)| {
                            *other == plane && dot(*other_into, into) > 0.0
                        })
                        .unwrap_or_else(|| {
                            groups.push((into, plane, Vec::new()));
                            groups.len() - 1
                        });
                    if !groups[found].2.contains(&face) {
                        groups[found].2.push(face);
                    }
                    slot_of[slot] = found;
                }
                let mut ranks: BTreeMap<(usize, usize), usize> = BTreeMap::new();
                let mut ordered = true;
                for (slot, (_, _, faces)) in groups.iter().enumerate() {
                    match rank_stack(faces, above) {
                        Some(ranked) => {
                            for (face, position) in ranked {
                                ranks.insert((slot, face), position);
                            }
                        }
                        None => ordered = false,
                    }
                }
                if !ordered {
                    out.push(Interleaving::Unordered {
                        lines: (first.line, second.line),
                        faces: [first.faces.0, first.faces.1, second.faces.0, second.faces.1],
                    });
                    continue;
                }
                let angle_at = |slot: usize| {
                    let (into, plane, _) = &groups[slot_of[slot]];
                    let face = ends[slot].0.face_of(ends[slot].1);
                    let position = ranks[&(slot_of[slot], face)];
                    // A tiny displacement along the plane's own normal, exactly
                    // as a thickened realisation places a layer. No winding sign
                    // is consulted: the angle falls out of the geometry.
                    let up = index.planes[*plane].up;
                    let lift = 1e-9 * (1.0 + position as f64);
                    frame.angle([
                        into[0] - lift * up[0],
                        into[1] - lift * up[1],
                        into[2] - lift * up[2],
                    ])
                };
                let a = [angle_at(0), angle_at(1)];
                let b = [angle_at(2), angle_at(3)];
                let arc = relative_angle(a[0], a[1]);
                let inside = |angle: f64| {
                    let offset = relative_angle(a[0], angle);
                    offset > 0.0 && offset < arc
                };
                if inside(b[0]) != inside(b[1]) {
                    out.push(Interleaving::Crossing {
                        lines: (first.line, second.line),
                        faces: [first.faces.0, first.faces.1, second.faces.0, second.faces.1],
                    });
                }
            }
        }
    }
    out
}

/// Rank faces top-first, or `None` when the relations do not order them.
///
/// Closes the relation over the set before ranking: the search's output is
/// transitively closed per subface, not globally, so a raw count of "how many are
/// above me" ties faces that are in fact ordered.
fn rank_stack(
    faces: &[usize],
    above: &dyn Fn(usize, usize) -> Option<bool>,
) -> Option<Vec<(usize, usize)>> {
    let count = faces.len();
    let mut over = vec![false; count * count];
    for i in 0..count {
        for j in 0..count {
            if i != j && above(faces[i], faces[j]) == Some(true) {
                over[i * count + j] = true;
            }
        }
    }
    for k in 0..count {
        for i in 0..count {
            if !over[i * count + k] {
                continue;
            }
            for j in 0..count {
                if over[k * count + j] {
                    over[i * count + j] = true;
                }
            }
        }
    }
    let mut ranked = Vec::with_capacity(count);
    for i in 0..count {
        let below = (0..count).filter(|&j| over[i * count + j]).count();
        if below + (0..count).filter(|&j| over[j * count + i]).count() != count - 1 {
            return None;
        }
        ranked.push((faces[i], count - 1 - below));
    }
    Some(ranked)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::{FRAC_PI_2, PI, TAU};

    /// Four rays around a circle, in every arrangement.
    ///
    /// The interleaving predicate is what turns "two creases meet one folded
    /// line" into "the paper crosses itself there", and on four distinct slots it
    /// is the whole answer — nothing is left to order. No model measured reaches
    /// it, so it is checked here on angles rather than believed.
    #[test]
    fn two_chords_cross_exactly_when_their_endpoints_alternate() {
        let (n, e, s, w) = (0.0, FRAC_PI_2, PI, 3.0 * FRAC_PI_2);
        // N-S against E-W: the endpoints alternate, so they cross.
        assert!(arcs_interleave((n, s), (e, w), 0.0));
        assert!(arcs_interleave((s, n), (e, w), 0.0));
        assert!(arcs_interleave((n, s), (w, e), 0.0));
        // N-E against S-W: two disjoint arcs.
        assert!(!arcs_interleave((n, e), (s, w), 0.0));
        // N-W against E-S: nested rather than alternating.
        assert!(!arcs_interleave((n, w), (e, s), 0.0));
        // A chord against itself shares both endpoints, so neither is strictly
        // inside.
        assert!(!arcs_interleave((n, s), (n, s), 0.0));
        // Wrapping past zero is the same question.
        assert!(arcs_interleave((w, e), (n, s), 0.0));
    }

    /// The slack is what keeps a shared slot from reading as a crossing.
    #[test]
    fn an_endpoint_within_the_slack_is_not_inside() {
        let arc = (0.0, PI);
        assert!(arcs_interleave(arc, (1e-3, TAU - 1e-3), 0.0));
        assert!(!arcs_interleave(arc, (1e-3, TAU - 1e-3), 1e-2));
    }
}
