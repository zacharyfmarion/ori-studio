//! The squash fold (plan Phase 11, research §5.3), a vertex fold
//! ([`super::vertex`]): a two-layer flap opened and pressed flat about the
//! vertex where its spine meets its hinge.
//!
//! - **The flap** is named by a sheet point on its upper layer as the viewer
//!   sees it: the face there must be the first at its point from the side
//!   the direction names (the top for a valley), and the face next to it is
//!   the lower layer. Each is first connected across flat precreases; a
//!   folded crease between these regions is the **spine** s;
//!   the end of the spine where the lower layer folds over a hinge is the
//!   **vertex** O, and that crease's line is the **hinge** h. Each layer is
//!   its face grown across flat creases off h and folded ones on s.
//! - **A drawn hinge** ([`Squash::hinge`]) is h instead: O is where it
//!   crosses the spine, within it, and only the flap's end on the flap
//!   point's side of h squashes, lifted along h and pressed flat, the
//!   spine beyond O landing on h. Each layer grows as above, but only by
//!   creases reaching that side; paper beyond h stays, and the upper layer
//!   is cut along h where it runs on across it. The motions below are the
//!   same: the lower layer turns up and back down at h, so only the upper
//!   one folds there. A line that misses the spine is
//!   [`NoFlap::HingeOffSpine`]; it never falls back to the inferred hinge.
//! - **Preconditions, checked up front** (research §5.3: every free flap
//!   closed, 491 of 491; every free, uncovered one was unique, 416 of 416):
//!   both layers are held along h (the upper one folded over it, or flat
//!   beside it once an earlier squash has unfolded it); the flap is *free*,
//!   its moving portion attached to the rest only along h; and it is
//!   *uncovered*, with no other paper over its moving portion, or inside it,
//!   on the side it squashes toward. Paper folded over the upper layer at
//!   the hinge and held by the flap there alone is no cover: it rides with
//!   that layer's hinge side, uncovered in turn. Each
//!   is a refusal naming the faces in the way. An upper layer held by its
//!   spine alone has no squash: its hinge side would lie loose, both ways
//!   round (2 of 67 seeded draws, before this was checked).
//! - **The creases are per layer.** With the flap's wedge D from h to s and
//!   the spine's target t at μD (μ = 0, the hinge line, by default), the
//!   lower layer creases on the bisector of s and t, at h + (1 + μ)D/2, and
//!   the upper one at h + (1 − μ)D/2. One shared line closes only when the
//!   spine lands on h; for an asymmetric squash the spike measured a
//!   residual of 0.342 (research §5.3), so the lines are computed from
//!   (flap, target), never drawn.
//! - **Motions**: the lower layer's spine side reflects across its crease;
//!   the upper layer's spine side turns about O, across the spine and then
//!   with it (the spine unfolds); its hinge side reflects across h (its
//!   hinge toggles); everything else stays.

use std::collections::BTreeSet;
use std::f64::consts::PI;

use oristudio_geometry::{Line, convex};
use serde::{Deserialize, Serialize};

use crate::complete::CompletionLimits;
use crate::compound::CompoundRefused;
use crate::compound::pieces::{Cut, score_cuts};
use crate::compound::vertex::{
    Compiled, VertexChoices, VertexFoldKind, VertexOutcome, angle_between, cross, drop_empty,
    piece_centroid, rotate, stack_toward, toward, unit,
};
use crate::fold::line::Axis;
use crate::fold::{ActionKind, FoldActionGeometry, FoldAnalysis, Push, Snap, Within};
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::{CreaseKind, FaceId};
use crate::refusal::{FoldRefusal, Refused, Side};
use crate::scene::ScenePoint;
use crate::state::State;
use crate::view::Direction;

type Point = [f64; 2];

/// A squash fold, named the way a step stores it (plan D6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Squash {
    /// A sheet point on the flap's upper layer as the viewer sees it: the
    /// top layer at its image for a valley, the bottom one for a mountain.
    pub flap: Point,
    /// Where the spine lands: a direction from the vertex in the parent's
    /// model frame. None for the hinge line, the symmetric squash.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<Point>,
    /// As the viewer sees it.
    pub direction: Direction,
    /// A drawn hinge, in the parent's model frame: only the flap's end on
    /// the flap point's side of it squashes, lifted along it. None for the
    /// hinge the lower layer folds over.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hinge: Option<Line>,
}

/// Why there is no flap to squash at a point.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NoFlap {
    /// Only one layer there.
    SingleLayer,
    /// The two layers there are joined by no folded crease.
    NoSpine,
    /// The lower layer folds over no hinge at either end of the spine.
    NoHinge,
    /// The upper layer is held by the spine alone, not along the hinge.
    UpperNotHinged,
    /// A drawn hinge crosses the spine nowhere within it, or leaves none of
    /// it on the flap point's side, or runs through the flap point.
    HingeOffSpine,
}

/// A squash's flap and its creases, before it lands: what a tool previews.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SquashAnalysis {
    /// O, in the parent's model frame.
    pub vertex: Point,
    pub hinge: Line,
    pub spine: Line,
    /// Unit directions from O along the hinge and along the spine: a
    /// target is a direction between them, `wedge` from the first.
    pub hinge_direction: Point,
    pub spine_direction: Point,
    /// The flap's layers: the parent's faces, in id order.
    pub upper: Vec<FaceId>,
    pub lower: Vec<FaceId>,
    /// Each layer's crease, through O.
    pub upper_crease: Line,
    pub lower_crease: Line,
    /// The wedge D from the hinge to the spine, radians, counter-clockwise
    /// positive; and the target's share μ of it.
    pub wedge: f64,
    pub share: f64,
}

/// The flap by face positions, and its creases.
struct Flap {
    upper: Vec<usize>,
    lower: Vec<usize>,
    /// Paper outside the flap that turns with the upper layer's hinge side
    /// (see [`State::squash_riders`]).
    riders: Vec<usize>,
    vertex: Point,
    /// The spine's far end from the vertex.
    spine_end: Point,
    /// The hinge's direction from the vertex.
    hinge: Point,
    /// A drawn hinge's side the flap is on: the paper beyond it stays.
    clicked: Option<convex::HalfPlane>,
    wedge: f64,
    share: f64,
    lines: [Line; 4],
}

impl Flap {
    fn hinge_line(&self) -> Line {
        self.lines[0]
    }
    fn spine_line(&self) -> Line {
        self.lines[1]
    }
    fn lower_crease(&self) -> Line {
        self.lines[2]
    }
    fn upper_crease(&self) -> Line {
        self.lines[3]
    }
}

impl State {
    /// A squash's flap and creases, without folding.
    pub fn analyse_squash(&self, op: &Squash) -> Result<SquashAnalysis, Refused> {
        let direction = self.view().model_direction(op.direction);
        let flap = self.squash_flap(op, direction)?;
        let ids = |faces: &[usize]| faces.iter().map(|&f| self.faces()[f].id).collect();
        Ok(SquashAnalysis {
            vertex: flap.vertex,
            hinge: flap.hinge_line(),
            spine: flap.spine_line(),
            hinge_direction: flap.hinge,
            spine_direction: rotate(flap.hinge, flap.wedge),
            upper: ids(&flap.upper),
            lower: ids(&flap.lower),
            upper_crease: flap.upper_crease(),
            lower_crease: flap.lower_crease(),
            wedge: flap.wedge,
            share: flap.share,
        })
    }

    /// A squash fold, with its stored choices (empty for a new step), under
    /// the default completion limits.
    pub fn squash(
        &self,
        op: &Squash,
        choices: &VertexChoices,
    ) -> Result<VertexOutcome, CompoundRefused> {
        self.squash_within(op, choices, &CompletionLimits::default())
    }

    /// [`State::squash`] under `limits`. A refusal names the faces in the
    /// way; when no order fits, it offers the other direction if that
    /// lands. A stored choice that no longer resolves is
    /// [`CompoundRefused::Broken`].
    pub fn squash_within(
        &self,
        op: &Squash,
        choices: &VertexChoices,
        limits: &CompletionLimits,
    ) -> Result<VertexOutcome, CompoundRefused> {
        let direction = self.view().model_direction(op.direction);
        let compiled = self
            .compile_squash(op, direction)
            .map_err(CompoundRefused::Refused)?;
        compiled.land(self, choices, limits, || {
            self.compile_squash(op, direction.opposite()).ok()
        })
    }

    fn compile_squash(&self, op: &Squash, direction: Direction) -> Result<Compiled, Refused> {
        let flap = self.squash_flap(op, direction)?;
        let nf = self.faces().len();
        let mask = |faces: &[usize]| {
            let mut mask = vec![false; nf];
            for &f in faces {
                mask[f] = true;
            }
            mask
        };
        let (lower, upper, riders) = (mask(&flap.lower), mask(&flap.upper), mask(&flap.riders));
        let mut cuts = vec![
            Cut {
                axis: Axis::new(&flap.lower_crease(), Side::Positive),
                faces: lower.clone(),
            },
            Cut {
                axis: Axis::new(&flap.upper_crease(), Side::Positive),
                faces: upper.clone(),
            },
        ];
        // The upper layer folds along a drawn hinge, first: the lower one
        // turns there and back, so it is not cut. Each layer's crease
        // enters its paper only on the flap's side, from O.
        if flap.clicked.is_some() {
            cuts.insert(
                0,
                Cut {
                    axis: Axis::new(&flap.hinge_line(), Side::Positive),
                    faces: upper.clone(),
                },
            );
        }
        let scoring = score_cuts(self, &cuts)?;
        // Which side of a layer's crease a piece is on: the spine's, or
        // the hinge's.
        let on_spine_side = |c: Point, crease: Point| {
            cross(crease, [c[0] - flap.vertex[0], c[1] - flap.vertex[1]]) * flap.wedge.signum()
                > 0.0
        };
        let lower_dir = rotate(flap.hinge, (1.0 + flap.share) * flap.wedge / 2.0);
        let upper_dir = rotate(flap.hinge, (1.0 - flap.share) * flap.wedge / 2.0);
        let mut block_of = Vec::with_capacity(scoring.faces.len());
        for a in 0..scoring.faces.len() {
            let old = scoring.old[a];
            let block = if lower[old] || upper[old] {
                let c = piece_centroid(self, &scoring, a).ok_or(FoldRefusal::Internal {
                    message: "a squashed piece has no centroid".to_string(),
                })?;
                let beyond = flap
                    .clicked
                    .is_some_and(|side| side.signed_distance(c) < 0.0);
                match (
                    beyond,
                    lower[old],
                    on_spine_side(c, lower_dir),
                    on_spine_side(c, upper_dir),
                ) {
                    (true, ..) => None,
                    (false, true, true, _) => Some(0),
                    (false, true, false, _) => None,
                    (false, false, _, true) => Some(1),
                    (false, false, _, false) => Some(2),
                }
            } else if riders[old] {
                Some(2)
            } else {
                None
            };
            block_of.push(block);
        }
        // Q′ reflects across its crease; P′ across the spine, then with Q′;
        // the upper layer's hinge side back across the hinge.
        let turns = vec![
            vec![(1, flap.lower_crease())],
            vec![(0, flap.spine_line()), (1, flap.lower_crease())],
            vec![(1, flap.hinge_line())],
        ];
        let turns = drop_empty(&mut block_of, turns);
        Ok(Compiled {
            kind: VertexFoldKind::Squash,
            scoring,
            block_of,
            turns,
            vertices: vec![flap.vertex],
            direction,
            extra: Vec::new(),
            against: None,
        })
    }

    /// The flap `op` names, checked free and uncovered, and its creases.
    fn squash_flap(&self, op: &Squash, direction: Direction) -> Result<Flap, Refused> {
        let faces = self.faces();
        let geometry = self.geometry();
        let topology = self.topology();
        let images = &geometry.vertex_images;
        let ids = |set: &[usize]| -> Vec<FaceId> {
            let mut ids: Vec<FaceId> = set.iter().map(|&f| faces[f].id).collect();
            ids.sort_unstable();
            ids.dedup();
            ids
        };
        let p = self
            .face_at(op.flap)
            .and_then(|id| self.face_position(id))
            .ok_or(FoldRefusal::WitnessNotInFace { point: op.flap })?;
        let at = geometry.isometries[p].apply(op.flap);
        let stack = stack_toward(self, at, direction).ok_or(FoldRefusal::Internal {
            message: "the layers at the flap point do not stack".to_string(),
        })?;
        match stack.iter().position(|&f| f == p) {
            Some(0) => {}
            Some(i) => {
                return Err(FoldRefusal::SquashFlapCovered {
                    faces: ids(&stack[..i]),
                    flap: ids(&[p]),
                }
                .into());
            }
            None => return Err(FoldRefusal::WitnessNotInFace { point: op.flap }.into()),
        }
        let Some(&q) = stack.get(1) else {
            return Err(FoldRefusal::SquashNoFlap {
                faces: ids(&[p]),
                cause: NoFlap::SingleLayer,
            }
            .into());
        };

        // A precrease may separate the picked faces from the spine. Discover
        // each layer across flat creases before looking for their shared fold.
        // These regions are only for discovery: the flap below is still bounded
        // by its hinge, which may itself be flat after an earlier squash.
        let creases = self.creases();
        let upper_region = self.squash_flat_region(p);
        let lower_region = self.squash_flat_region(q);
        let spine: Vec<usize> = topology
            .crease_faces
            .iter()
            .enumerate()
            .filter(|(k, incident)| {
                creases[*k].kind.is_folded()
                    && incident.iter().any(|&f| upper_region[f])
                    && incident.iter().any(|&f| lower_region[f])
            })
            .map(|(k, _)| k)
            .collect();
        let no_flap = |cause| -> Refused {
            FoldRefusal::SquashNoFlap {
                faces: ids(&[p, q]),
                cause,
            }
            .into()
        };
        let Some(&first) = spine.first() else {
            return Err(no_flap(NoFlap::NoSpine));
        };
        let [a, b] = creases[first].vertices.map(|v| images[v.index()]);
        let spine_line = Line::from_points(a, b).ok_or(FoldRefusal::Internal {
            message: "a spine crease has no length".to_string(),
        })?;
        // Its two ends: the extreme vertices along it.
        let mut ends: Vec<(f64, usize)> = spine
            .iter()
            .flat_map(|&k| creases[k].vertices)
            .map(|v| (spine_line.parameter(images[v.index()]), v.index()))
            .collect();
        ends.sort_by(|x, y| x.0.total_cmp(&y.0));
        let (Some(&(_, lo)), Some(&(_, hi))) = (ends.first(), ends.last()) else {
            return Err(no_flap(NoFlap::NoSpine));
        };

        // The vertex, the spine's far end from it, a point along the hinge
        // from it, and a drawn hinge's side the flap is on.
        let (vertex, spine_end, hinge, clicked) = match &op.hinge {
            // The end where the lower layer folds over a hinge. Start from
            // the lower face actually incident to that end of the spine, not
            // the picked subdivision (which need not reach either endpoint).
            None => {
                let Some((o, other, hinge)) =
                    [(lo, hi), (hi, lo)].into_iter().find_map(|(v, w)| {
                        spine.iter().find_map(|&k| {
                            if !creases[k].vertices.iter().any(|end| end.index() == v) {
                                return None;
                            }
                            let &lower = topology.crease_faces[k]
                                .iter()
                                .find(|&&f| lower_region[f])?;
                            self.hinge_at(lower, v, &spine_line).map(|h| (v, w, h))
                        })
                    })
                else {
                    return Err(no_flap(NoFlap::NoHinge));
                };
                (images[o], images[other], hinge, None)
            }
            Some(line) => {
                let drawn = drawn_hinge(line, &spine_line, [images[lo], images[hi]], at)
                    .ok_or(no_flap(NoFlap::HingeOffSpine))?;
                (
                    drawn.vertex,
                    drawn.spine_end,
                    drawn.along,
                    Some(drawn.clicked),
                )
            }
        };
        let spine_dir = unit([spine_end[0] - vertex[0], spine_end[1] - vertex[1]])
            .ok_or(no_flap(NoFlap::NoSpine))?;
        let hinge_dir =
            unit([hinge[0] - vertex[0], hinge[1] - vertex[1]]).ok_or(no_flap(NoFlap::NoHinge))?;
        let wedge = angle_between(hinge_dir, spine_dir);
        let hinge_line =
            Line::from_point_direction(vertex, hinge_dir).ok_or(no_flap(NoFlap::NoHinge))?;

        // Where the spine lands, and each layer's crease.
        let share = match op.target {
            None => 0.0,
            Some(target) => {
                let target = unit(target).ok_or(FoldRefusal::SquashTargetOutside)?;
                angle_between(hinge_dir, target) / wedge
            }
        };
        // A share that is not a number is outside too.
        let inside = share.abs() < 1.0;
        if !inside || wedge.abs() >= PI {
            return Err(FoldRefusal::SquashTargetOutside.into());
        }
        let crease = |share: f64| {
            Line::from_point_direction(vertex, rotate(hinge_dir, share * wedge / 2.0))
                .ok_or(FoldRefusal::SquashTargetOutside)
        };
        let lower_crease = crease(1.0 + share)?;
        let upper_crease = crease(1.0 - share)?;
        // Only the spine side of the lower layer moves. Its flat material
        // can continue into a stationary body with other folded attachments.
        // Those attachments (and paper over that body) do not hold the squash.
        let lower_dir = rotate(hinge_dir, (1.0 + share) * wedge / 2.0);
        let normal = [
            -lower_dir[1] * wedge.signum(),
            lower_dir[0] * wedge.signum(),
        ];
        let moving_lower =
            convex::HalfPlane::new(normal, normal[0] * vertex[0] + normal[1] * vertex[1])
                .ok_or(FoldRefusal::SquashTargetOutside)?;
        let up = geometry.isometries[p].front_up();
        let upper_face = |f: usize| geometry.isometries[f].front_up() == up;

        // The flap: both faces grown across flat creases off the hinge line
        // and folded ones on the spine. Attachments outside the hinge are
        // forbidden only where this material actually moves.
        let on = |line: &Line, k: usize| {
            creases[k]
                .vertices
                .iter()
                .all(|v| line.distance_to_point(images[v.index()]) <= TOL)
        };
        // A drawn hinge bounds the flap: a crease is the flap's only where
        // it reaches the flap's side of it.
        let reaches = |k: usize| {
            clicked.as_ref().is_none_or(|side| {
                creases[k]
                    .vertices
                    .iter()
                    .any(|v| side.signed_distance(images[v.index()]) > TOL)
            })
        };
        let mut in_flap = vec![false; faces.len()];
        in_flap[p] = true;
        in_flap[q] = true;
        let mut queue = vec![p, q];
        while let Some(f) = queue.pop() {
            for &k in &topology.face_creases[f] {
                let Some(g) = topology.across(k, f) else {
                    continue;
                };
                let joins = reaches(k)
                    && match creases[k].kind {
                        CreaseKind::Flat(_) => !on(&hinge_line, k),
                        CreaseKind::Folded(_) => on(&spine_line, k),
                        CreaseKind::Border => false,
                    };
                if joins && !in_flap[g] {
                    in_flap[g] = true;
                    queue.push(g);
                }
            }
        }
        let flap: Vec<usize> = (0..faces.len()).filter(|&f| in_flap[f]).collect();
        let attached: Vec<usize> = flap
            .iter()
            .flat_map(|&f| {
                topology.face_creases[f]
                    .iter()
                    .filter_map(move |&k| topology.across(k, f).map(|g| (f, k, g)))
            })
            .filter(|&(f, k, g)| {
                !in_flap[g]
                    && !on(&hinge_line, k)
                    && reaches(k)
                    && (upper_face(f)
                        || creases[k]
                            .vertices
                            .iter()
                            .any(|v| moving_lower.signed_distance(images[v.index()]) > TOL))
            })
            .map(|(_, _, g)| g)
            .collect();
        if !attached.is_empty() {
            return Err(FoldRefusal::SquashFlapNotFree {
                faces: ids(&attached),
                flap: ids(&flap),
            }
            .into());
        }
        // The upper layer must be held along the hinge too (folded over it,
        // or flat beside it): one held by its spine alone has no squash, its
        // hinge side lying loose. Across a drawn hinge, it may run on as
        // one face.
        let crosses = |f: usize| {
            clicked.as_ref().is_some_and(|side| {
                geometry.images[f]
                    .iter()
                    .any(|&v| side.signed_distance(v) < -TOL)
            })
        };
        let hinged = flap.iter().any(|&f| {
            geometry.isometries[f].front_up() == up
                && (crosses(f)
                    || topology.face_creases[f].iter().any(|&k| {
                        topology.across(k, f).is_some_and(|g| !in_flap[g]) && on(&hinge_line, k)
                    }))
        });
        if !hinged {
            return Err(no_flap(NoFlap::UpperNotHinged));
        }
        // Uncovered where the paper moves. Cover over the stationary part
        // of a lower face is harmless, even when no precrease divides it,
        // and so is cover beyond a drawn hinge.
        let moving_images: Vec<Vec<Point>> = (0..faces.len())
            .map(|f| {
                if !in_flap[f] {
                    Vec::new()
                } else if upper_face(f) {
                    match &clicked {
                        Some(side) => convex::split(&geometry.images[f], side, TOL).inside,
                        None => geometry.images[f].clone(),
                    }
                } else {
                    convex::split(&geometry.images[f], &moving_lower, TOL).inside
                }
            })
            .collect();
        // The faces outside `moves` over what moves, toward `direction`.
        let covering_of = |moves: &[bool], moving_images: &[Vec<Point>]| {
            let mut covering = BTreeSet::new();
            for (pair, _) in self.order().pairs() {
                let (Some(f), Some(g)) =
                    (self.face_position(pair.lo()), self.face_position(pair.hi()))
                else {
                    continue;
                };
                let (x, y) = match (moves[f], moves[g]) {
                    (true, false) => (g, f),
                    (false, true) => (f, g),
                    _ => continue,
                };
                if toward(self, x, y, direction) == Some(true)
                    && convex::overlaps(&geometry.images[x], &moving_images[y])
                {
                    covering.insert(x);
                }
            }
            covering
        };
        let mut covering = covering_of(&in_flap, &moving_images);
        // A cover folded over the upper layer at the hinge, and held by the
        // flap there alone, rides with that layer instead: it is uncovered
        // in turn, nothing else over it.
        let mut riders = Vec::new();
        if !covering.is_empty()
            && let Some(riding) = self.squash_riders(&in_flap, &hinge_line, up, direction)
            && covering.iter().all(|&x| riding[x])
        {
            let moves: Vec<bool> = (0..faces.len()).map(|f| in_flap[f] || riding[f]).collect();
            let mut images = moving_images.clone();
            for f in (0..faces.len()).filter(|&f| riding[f]) {
                images[f] = geometry.images[f].clone();
            }
            covering = covering_of(&moves, &images);
            riders = (0..faces.len()).filter(|&f| riding[f]).collect();
        }
        if !covering.is_empty() {
            let covering: Vec<usize> = covering.into_iter().collect();
            return Err(FoldRefusal::SquashFlapCovered {
                faces: ids(&covering),
                flap: ids(&flap),
            }
            .into());
        }
        let (upper, lower): (Vec<usize>, Vec<usize>) = flap
            .iter()
            .partition(|&&f| geometry.isometries[f].front_up() == up);

        Ok(Flap {
            upper,
            lower,
            riders,
            vertex,
            spine_end,
            hinge: hinge_dir,
            clicked,
            wedge,
            share,
            lines: [hinge_line, spine_line, lower_crease, upper_crease],
        })
    }

    /// The picture of the squash `op` on this state, with `landed`'s cover
    /// at the arrow's head when it is given (see [`super::vertex`]): the
    /// lower layer's crease from the vertex across the flap, the arrow from
    /// the flap's spine side to where its crease lays it, and the push onto
    /// the spine from beyond it, toward where it lands. Refused as
    /// [`State::analyse_squash`] is.
    pub fn squash_action(
        &self,
        op: &Squash,
        landed: Option<&State>,
    ) -> Result<FoldActionGeometry, Refused> {
        let direction = self.view().model_direction(op.direction);
        let flap = self.squash_flap(op, direction)?;
        let crease = flap.lower_crease();
        let into = rotate(flap.hinge, (1.0 + flap.share) * flap.wedge / 2.0);
        let spine = rotate(flap.hinge, flap.wedge);
        let on_spine = [flap.vertex[0] + spine[0], flap.vertex[1] + spine[1]];
        let side = Side::of_point(&crease, on_spine).ok_or(FoldRefusal::SquashTargetOutside)?;
        let mut moving: Vec<FaceId> = flap
            .upper
            .iter()
            .chain(&flap.lower)
            .chain(&flap.riders)
            .map(|&f| self.faces()[f].id)
            .collect();
        moving.sort_unstable();
        let analysis = FoldAnalysis {
            line: crease,
            side,
            snap: Snap::NONE,
            direction,
            flaps: Vec::new(),
            picked: Vec::new(),
            added: Vec::new(),
            moving,
        };
        let mut action = self.fold_action_within(
            &analysis,
            ActionKind::Fold,
            landed,
            Within {
                ray: Some((flap.vertex, into)),
                reach: None,
            },
        )?;
        action.push = push(self, &flap);
        Ok(action)
    }

    /// Connected subdivisions of one material layer, ignoring flat precreases.
    /// Folded creases remain boundaries, even when another layer overlaps it.
    fn squash_flat_region(&self, seed: usize) -> Vec<bool> {
        let topology = self.topology();
        let mut region = vec![false; self.faces().len()];
        region[seed] = true;
        let mut queue = vec![seed];
        while let Some(f) = queue.pop() {
            for &k in &topology.face_creases[f] {
                if !matches!(self.creases()[k].kind, CreaseKind::Flat(_)) {
                    continue;
                }
                if let Some(g) = topology.across(k, f)
                    && !region[g]
                {
                    region[g] = true;
                    queue.push(g);
                }
            }
        }
        region
    }

    /// The paper that rides with a flap's upper layer: what is folded over
    /// that layer at the hinge, with all it is joined to outside the flap.
    /// The upper layer's hinge side turns across the hinge and carries it,
    /// so it must be held by the flap only along the hinge, and lie over
    /// the flap toward `direction` wherever they meet: a cover, never paper
    /// under the flap. None otherwise, when it stays and covers.
    fn squash_riders(
        &self,
        in_flap: &[bool],
        hinge: &Line,
        up: bool,
        direction: Direction,
    ) -> Option<Vec<bool>> {
        let faces = self.faces();
        let geometry = self.geometry();
        let topology = self.topology();
        let creases = self.creases();
        let images = &geometry.vertex_images;
        let on_hinge = |k: usize| {
            creases[k]
                .vertices
                .iter()
                .all(|v| hinge.distance_to_point(images[v.index()]) <= TOL)
        };
        let mut riding = vec![false; faces.len()];
        let mut queue = Vec::new();
        for f in (0..faces.len()).filter(|&f| in_flap[f] && geometry.isometries[f].front_up() == up)
        {
            for &k in &topology.face_creases[f] {
                if let Some(g) = topology.across(k, f)
                    && !in_flap[g]
                    && !riding[g]
                    && creases[k].kind.is_folded()
                    && on_hinge(k)
                {
                    riding[g] = true;
                    queue.push(g);
                }
            }
        }
        while let Some(f) = queue.pop() {
            for &k in &topology.face_creases[f] {
                let Some(g) = topology.across(k, f) else {
                    continue;
                };
                if in_flap[g] {
                    if !on_hinge(k) {
                        return None;
                    }
                } else if !riding[g] {
                    riding[g] = true;
                    queue.push(g);
                }
            }
        }
        for f in (0..faces.len()).filter(|&f| riding[f]) {
            for g in (0..faces.len()).filter(|&g| in_flap[g]) {
                if convex::overlaps(&geometry.images[f], &geometry.images[g])
                    && toward(self, f, g, direction) != Some(true)
                {
                    return None;
                }
            }
        }
        Some(riding)
    }

    /// Where the lower layer `q` folds over a hinge at its vertex `v`, an end
    /// of the spine on `spine`: walking round `v` from the spine across flat
    /// creases, the far end of the first folded crease off the spine's line.
    /// None at a border.
    fn hinge_at(&self, q: usize, v: usize, spine: &Line) -> Option<Point> {
        let topology = self.topology();
        let creases = self.creases();
        let images = &self.geometry().vertex_images;
        let on_spine = |k: usize| {
            creases[k]
                .vertices
                .iter()
                .all(|w| spine.distance_to_point(images[w.index()]) <= TOL)
        };
        // The crease the walk came across, and the face it is in.
        let (mut face, mut came) = (q, None::<usize>);
        for _ in 0..self.faces().len() {
            let ring = &self.faces()[face].ring;
            let i = ring.iter().position(|w| w.index() == v)?;
            let n = ring.len();
            let edges = [
                topology.face_creases[face][(i + n - 1) % n],
                topology.face_creases[face][i],
            ];
            let next = match came {
                None => edges.into_iter().find(|&k| !on_spine(k))?,
                Some(c) => edges.into_iter().find(|&k| k != c)?,
            };
            match creases[next].kind {
                CreaseKind::Folded(_) if !on_spine(next) => {
                    let w = creases[next].vertices.iter().find(|w| w.index() != v)?;
                    return Some(images[w.index()]);
                }
                CreaseKind::Flat(_) => {
                    face = topology.across(next, face)?;
                    came = Some(next);
                }
                _ => return None,
            }
        }
        None
    }
}

/// A drawn hinge where it crosses a spine (see [`drawn_hinge`]).
struct DrawnHinge {
    vertex: Point,
    spine_end: Point,
    along: Point,
    clicked: convex::HalfPlane,
}

/// The drawn `hinge` on a spine along `spine` between `ends`, the flap
/// point's image `at` naming the side that squashes: O where the line
/// crosses the spine, within it; the spine's end on that side, beyond the
/// minimum feature; a point along the hinge from O on the flap's side of
/// the spine; and that side of the hinge. None when the line misses the
/// spine, leaves none of it on that side, or runs through `at`.
fn drawn_hinge(hinge: &Line, spine: &Line, ends: [Point; 2], at: Point) -> Option<DrawnHinge> {
    let side = hinge.signed_distance(at);
    if side.abs() <= TOL {
        return None;
    }
    let vertex = hinge.intersect(spine)?;
    let t = spine.parameter(vertex);
    let [a, b] = ends.map(|e| spine.parameter(e));
    if t < a.min(b) - TOL || t > a.max(b) + TOL {
        return None;
    }
    let spine_end = ends.into_iter().find(|&e| {
        hinge.signed_distance(e) * side.signum() > TOL
            && (e[0] - vertex[0]).hypot(e[1] - vertex[1]) > MIN_FEATURE
    })?;
    let spine_dir = unit([spine_end[0] - vertex[0], spine_end[1] - vertex[1]])?;
    // The flap lies on one side of its spine: the hinge's ray there.
    let material = cross(spine_dir, [at[0] - vertex[0], at[1] - vertex[1]]);
    if material.abs() <= TOL {
        return None;
    }
    let d = hinge.direction();
    let d = if cross(spine_dir, d) * material > 0.0 {
        d
    } else {
        [-d[0], -d[1]]
    };
    let s = side.signum();
    Some(DrawnHinge {
        vertex,
        spine_end,
        along: [vertex[0] + d[0], vertex[1] + d[1]],
        clicked: convex::HalfPlane::new([hinge.n[0] * s, hinge.n[1] * s], hinge.d * s)?,
    })
}

/// Where along the spine its push lands, and how long the push's shaft is,
/// as shares of the spine's length.
const PUSH_AT: f64 = 0.5;
const PUSH_LENGTH: f64 = 0.4;

/// The push onto a squash's spine, in the scene frame: from beyond it,
/// square to it, toward the flap it closes over, where its target is; none
/// for a spine shorter than the minimum feature.
fn push(state: &State, flap: &Flap) -> Option<Push> {
    let spine = rotate(flap.hinge, flap.wedge);
    let length = (flap.spine_end[0] - flap.vertex[0]).hypot(flap.spine_end[1] - flap.vertex[1]);
    if length < MIN_FEATURE {
        return None;
    }
    // Square to the spine, away from the flap's inside (the wedge's middle).
    let inside = rotate(flap.hinge, flap.wedge / 2.0);
    let mut out = [-spine[1], spine[0]];
    if out[0] * inside[0] + out[1] * inside[1] > 0.0 {
        out = [-out[0], -out[1]];
    }
    let toward = [
        flap.vertex[0] + PUSH_AT * length * spine[0],
        flap.vertex[1] + PUSH_AT * length * spine[1],
    ];
    let at = [
        toward[0] + PUSH_LENGTH * length * out[0],
        toward[1] + PUSH_LENGTH * length * out[1],
    ];
    let to_scene = state.view().transform();
    Some(Push {
        at: ScenePoint::from(to_scene.apply(at)),
        toward: ScenePoint::from(to_scene.apply(toward)),
    })
}
