//! The squash fold (plan Phase 11, research §5.3), a vertex fold
//! ([`super::vertex`]): a two-layer flap — or one whose walls are several
//! plies each — opened and pressed flat about the vertex where its spine
//! meets its hinge.
//!
//! - **The flap** is named by a sheet point on its upper layer as the viewer
//!   sees it: the face there must be the first at its point from the side
//!   the direction names (the top for a valley), and the face next to it is
//!   the lower layer. Each is first connected across flat precreases; a
//!   folded crease between these regions is the **spine** s;
//!   the end of the spine where the lower layer folds over a hinge is the
//!   **vertex** O, and that crease's line is the **hinge** h. Each layer is
//!   its face grown across flat creases off h and folded ones on s.
//! - **Walls of several plies.** When the top two layers share no folded
//!   crease, the flap's walls may be several plies each: the first 2m layers
//!   for the least m whose walls nest, layer m − 1 − i wrapped round layer
//!   m + i by folded creases on one line, the spine, for every i < m (a
//!   lifted unit of nested wraps). It opens between its walls: the first m
//!   layers are the upper layer, the next m the lower, each grown as above,
//!   and paper reached across the spine from paper that is no ply's is the
//!   other wall's. [`Squash::opening`] opens it elsewhere, k layers down for
//!   any 0 < k < 2m, the wraps on one side of the opening riding closed with
//!   that wall; plies joined across the opening anywhere but on s or h would
//!   tear, and are [`NoFlap::OpeningOutside`]. A flap whose top two layers
//!   share a crease is the two-layer flap above, unchanged.
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
//! - **Pockets on one lower layer.** A flap held off its hinge only by
//!   another pocket on its lower layer — that pocket's upper layer joined
//!   to the moving side of the lower one on a spine of its own, folded over
//!   a hinge of its own, its symmetric squash creasing the lower layer on
//!   the same line — squashes together with it: two doors over one panel,
//!   opened and pressed flat as one. Read only where the flap alone is
//!   refused (`State::squash_other_reading`).

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
    /// Where a flap of several plies opens: how many of its layers at the
    /// flap point, from the direction's side, lie above the opening — from
    /// 1 to one less than its layers there. None for between its walls,
    /// the one opening of a two-layer flap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opening: Option<usize>,
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
    /// A flap of several plies does not open where asked: the opening is
    /// not between two of its layers at the flap point, or the layers above
    /// and below it are joined off the spine and the hinge.
    OpeningOutside,
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
    /// The flap's layers: the parent's faces, in id order. The upper layer
    /// includes the upper layers of the pockets on its lower layer that
    /// squash with it (`State::squash_other_reading`).
    pub upper: Vec<FaceId>,
    pub lower: Vec<FaceId>,
    /// Each layer's crease, through O.
    pub upper_crease: Line,
    pub lower_crease: Line,
    /// The wedge D from the hinge to the spine, radians, counter-clockwise
    /// positive; and the target's share μ of it.
    pub wedge: f64,
    pub share: f64,
    /// The flap's layers at the flap point (2 for a two-layer flap, more
    /// when its walls are several plies), and how many of them, from the
    /// direction's side, lie above where it opens.
    pub layers: usize,
    pub opening: usize,
}

/// The flap by face positions, and its creases.
struct Flap {
    upper: Vec<usize>,
    lower: Vec<usize>,
    /// Its layers at the flap point, and how many lie above the opening.
    layers: usize,
    opening: usize,
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
    /// Pockets on its lower layer that squash with it (see
    /// [`State::squash_other_reading`]): each its own upper layer, riders,
    /// vertex and creases, no lower layer of its own.
    partners: Vec<Flap>,
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
        let ids = |faces: &mut dyn Iterator<Item = &usize>| {
            let mut ids: Vec<FaceId> = faces.map(|&f| self.faces()[f].id).collect();
            ids.sort_unstable();
            ids
        };
        Ok(SquashAnalysis {
            vertex: flap.vertex,
            hinge: flap.hinge_line(),
            spine: flap.spine_line(),
            hinge_direction: flap.hinge,
            spine_direction: rotate(flap.hinge, flap.wedge),
            upper: ids(&mut flap
                .upper
                .iter()
                .chain(flap.partners.iter().flat_map(|p| &p.upper))),
            lower: ids(&mut flap.lower.iter()),
            upper_crease: flap.upper_crease(),
            lower_crease: flap.lower_crease(),
            wedge: flap.wedge,
            share: flap.share,
            layers: flap.layers,
            opening: flap.opening,
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
        // The flap and the pockets that squash with it: each its own upper
        // layer and riders; the lower layer is the flap's. In one order
        // whichever of them was named, so each names the same fold: by
        // their upper layers' first faces. The lower layer creases on the
        // first one's line.
        let mut flaps: Vec<&Flap> = std::iter::once(&flap).chain(&flap.partners).collect();
        flaps.sort_by_key(|f| f.upper.iter().min().copied());
        let first = flaps[0];
        let lower = mask(&flap.lower);
        // Per face, the flap whose upper layer or riders it is in.
        let mut upper_of: Vec<Option<usize>> = vec![None; nf];
        let mut rider_of: Vec<Option<usize>> = vec![None; nf];
        for (i, f) in flaps.iter().enumerate() {
            for &face in &f.upper {
                upper_of[face] = Some(i);
            }
            for &face in &f.riders {
                rider_of[face] = Some(i);
            }
        }
        let mut cuts = vec![Cut {
            axis: Axis::new(&first.lower_crease(), Side::Positive),
            faces: lower.clone(),
        }];
        for f in &flaps {
            cuts.push(Cut {
                axis: Axis::new(&f.upper_crease(), Side::Positive),
                faces: mask(&f.upper),
            });
        }
        // The upper layer folds along a drawn hinge, first: the lower one
        // turns there and back, so it is not cut. Each layer's crease
        // enters its paper only on the flap's side, from O.
        if flap.clicked.is_some() {
            cuts.insert(
                0,
                Cut {
                    axis: Axis::new(&flap.hinge_line(), Side::Positive),
                    faces: mask(&flap.upper),
                },
            );
        }
        let scoring = score_cuts(self, &cuts)?;
        // Which side of a layer's crease a piece is on: the spine's, or
        // the hinge's, about that flap's vertex.
        let on_spine_side = |f: &Flap, c: Point, crease: Point| {
            cross(crease, [c[0] - f.vertex[0], c[1] - f.vertex[1]]) * f.wedge.signum() > 0.0
        };
        let lower_dir = rotate(first.hinge, (1.0 + first.share) * first.wedge / 2.0);
        let upper_dir = |f: &Flap| rotate(f.hinge, (1.0 - f.share) * f.wedge / 2.0);
        let mut block_of = Vec::with_capacity(scoring.faces.len());
        for a in 0..scoring.faces.len() {
            let old = scoring.old[a];
            let block = if lower[old] || upper_of[old].is_some() {
                let c = piece_centroid(self, &scoring, a).ok_or(FoldRefusal::Internal {
                    message: "a squashed piece has no centroid".to_string(),
                })?;
                let beyond = flap
                    .clicked
                    .is_some_and(|side| side.signed_distance(c) < 0.0);
                match (beyond, upper_of[old]) {
                    (true, _) => None,
                    (false, None) => on_spine_side(first, c, lower_dir).then_some(0),
                    (false, Some(i)) => Some(if on_spine_side(flaps[i], c, upper_dir(flaps[i])) {
                        1 + 2 * i
                    } else {
                        2 + 2 * i
                    }),
                }
            } else {
                rider_of[old].map(|i| 2 + 2 * i)
            };
            block_of.push(block);
        }
        // Q′ reflects across its crease; P′ across the spine, then with Q′;
        // the upper layer's hinge side back across the hinge. Each pocket
        // that squashes with the flap turns its upper layer the same way,
        // about its own spine and hinge.
        let mut turns = vec![vec![(1, first.lower_crease())]];
        for f in &flaps {
            turns.push(vec![(0, f.spine_line()), (1, first.lower_crease())]);
            turns.push(vec![(1, f.hinge_line())]);
        }
        let turns = drop_empty(&mut block_of, turns);
        Ok(Compiled {
            kind: VertexFoldKind::Squash,
            scoring,
            block_of,
            turns,
            vertices: flaps.iter().map(|f| f.vertex).collect(),
            direction,
            extra: Vec::new(),
            against: None,
        })
    }

    /// The flap `op` names, checked free and uncovered, and its creases.
    /// Read at the spine's first end that has a hinge; only where that
    /// reading is refused, a flap that squashes together with the pockets on
    /// its lower layer ([`State::squash_other_reading`]).
    fn squash_flap(&self, op: &Squash, direction: Direction) -> Result<Flap, Refused> {
        let base = self.squash_base(op, direction)?;
        let vertices = self.squash_vertices(op, &base)?;
        let first = vertices
            .first()
            .copied()
            .ok_or_else(|| base.no_flap(self, NoFlap::NoHinge))?;
        let refused = match self
            .squash_reading(op, &base, first)
            .and_then(|reading| self.squash_checked(vec![reading], direction))
        {
            Ok(flap) => return Ok(flap),
            Err(refused) => refused,
        };
        self.squash_other_reading(op, direction, &base, &vertices)
            .ok_or(refused)
    }

    /// Where today's reading of `op` is refused: **pockets on one lower
    /// layer**. A lower layer may carry a second pocket, its upper layer
    /// joined to the lower one's moving side on a spine of its own and
    /// folded over a hinge of its own: two doors over one panel. Squashing
    /// one alone would have to crease the other's upper layer where no
    /// squash creases it, so a flap held only by such pockets is not free as
    /// it stands. When each pocket's own symmetric squash creases that lower
    /// layer on the same line, and lays the same side of it over, the
    /// pockets squash together: one motion for the lower layer, each upper
    /// layer's own across its spine and its hinge.
    ///
    /// The flap is read at each end of its spine with a hinge, and exactly
    /// one reading must hold with its pockets, or none is taken. Only for an
    /// inferred hinge, a symmetric squash and two-layer flaps: an asymmetric
    /// target would crease the lower layer off the pockets' shared line.
    fn squash_other_reading(
        &self,
        op: &Squash,
        direction: Direction,
        base: &Base,
        vertices: &[Vertex],
    ) -> Option<Flap> {
        if op.hinge.is_some() || op.target.is_some() || op.opening.is_some() || base.layers != 2 {
            return None;
        }
        let mut found = Vec::new();
        for &vertex in vertices {
            let Ok(reading) = self.squash_reading(op, base, vertex) else {
                continue;
            };
            if let Some(readings) = self.squash_partners(op, reading, direction)
                && let Ok(flap) = self.squash_checked(readings, direction)
            {
                found.push(flap);
            }
        }
        (found.len() == 1).then(|| found.remove(0))
    }

    /// `primary` and the pockets on its lower layer that hold it (see
    /// [`State::squash_other_reading`]), each read from a point on the paper
    /// attached off the hinges to the moving flap; none when that paper is
    /// not such pockets alone, or a pocket reads more than one way.
    fn squash_partners(
        &self,
        op: &Squash,
        primary: Reading,
        direction: Direction,
    ) -> Option<Vec<Reading>> {
        let faces = self.faces();
        let mut readings = vec![primary];
        let mut tried = vec![false; faces.len()];
        loop {
            let attached = self.squash_attached(&readings);
            if attached.is_empty() {
                return (readings.len() > 1).then_some(readings);
            }
            let next = attached.into_iter().find(|&g| !tried[g])?;
            tried[next] = true;
            let ring: Vec<Point> = faces[next]
                .ring
                .iter()
                .map(|v| self.vertices()[v.index()])
                .collect();
            let op = Squash {
                flap: convex::centroid(&ring)?,
                target: None,
                hinge: None,
                opening: None,
                ..op.clone()
            };
            let base = self.squash_base(&op, direction).ok()?;
            if base.layers != 2 {
                return None;
            }
            let primary = &readings[0];
            let shares = |r: &Reading| {
                r.lower() == primary.lower()
                    && r.lower_crease().approx_eq(&primary.lower_crease())
                    && primary.moving_lower.signed_distance(r.spine_end) > TOL
                    && r.upper()
                        .iter()
                        .all(|&f| readings.iter().all(|o| o.wall[f].is_none()))
            };
            let mut matching: Vec<Reading> = self
                .squash_vertices(&op, &base)
                .ok()?
                .into_iter()
                .filter_map(|vertex| self.squash_reading(&op, &base, vertex).ok())
                .filter(shares)
                .collect();
            if matching.len() != 1 {
                return None;
            }
            readings.push(matching.remove(0));
        }
    }

    /// The stack at `op`'s flap point and its walls, the spine and its two
    /// ends, and where it opens: what every reading of the flap starts from.
    fn squash_base(&self, op: &Squash, direction: Direction) -> Result<Base, Refused> {
        let faces = self.faces();
        let geometry = self.geometry();
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

        // The flap's walls: its top two layers, joined on the spine, or
        // several plies each, nested wraps on one spine line.
        let creases = self.creases();
        let Some(walls) = self.squash_walls(&stack) else {
            return Err(FoldRefusal::SquashNoFlap {
                faces: ids(&[p, q]),
                cause: NoFlap::NoSpine,
            }
            .into());
        };
        let Walls {
            plies,
            regions,
            spine,
        } = walls;
        let layers = plies.len();
        let no_flap = |cause| -> Refused {
            FoldRefusal::SquashNoFlap {
                faces: ids(&plies),
                cause,
            }
            .into()
        };
        // Where it opens: between its walls unless asked, the walls' plies
        // beyond the opening riding closed with the other wall.
        let opening = op.opening.unwrap_or(layers / 2);
        if opening == 0 || opening >= layers {
            return Err(no_flap(NoFlap::OpeningOutside));
        }
        // The lower wall, discovered across flat creases (the hinge too): what
        // the hinge is found from.
        let lower_region: Vec<bool> = (0..faces.len())
            .map(|f| regions[layers / 2..].iter().any(|region| region[f]))
            .collect();
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
        Ok(Base {
            plies,
            layers,
            opening,
            lower_region,
            spine,
            spine_line,
            ends: [lo, hi],
            at,
        })
    }

    /// The vertices the flap of `base` may be read at, in the order they are
    /// tried, each with the spine's far end from it, a point along the hinge
    /// from it, and a drawn hinge's side the flap is on. For an inferred
    /// hinge, each end of the spine where the lower layer folds over a hinge,
    /// starting from the lower face actually incident to that end, not the
    /// picked subdivision (which need not reach either endpoint); the first
    /// is today's reading. For a drawn hinge, where it crosses the spine.
    fn squash_vertices(&self, op: &Squash, base: &Base) -> Result<Vec<Vertex>, Refused> {
        let creases = self.creases();
        let topology = self.topology();
        let images = &self.geometry().vertex_images;
        let [lo, hi] = base.ends;
        match &op.hinge {
            None => {
                let found: Vec<Vertex> = [(lo, hi), (hi, lo)]
                    .into_iter()
                    .filter_map(|(v, w)| {
                        base.spine.iter().find_map(|&k| {
                            if !creases[k].vertices.iter().any(|end| end.index() == v) {
                                return None;
                            }
                            let &lower = topology.crease_faces[k]
                                .iter()
                                .find(|&&f| base.lower_region[f])?;
                            self.hinge_at(lower, v, &base.spine_line)
                                .map(|hinge| Vertex {
                                    vertex: images[v],
                                    spine_end: images[w],
                                    hinge,
                                    clicked: None,
                                })
                        })
                    })
                    .collect();
                if found.is_empty() {
                    return Err(base.no_flap(self, NoFlap::NoHinge));
                }
                Ok(found)
            }
            Some(line) => {
                let drawn = drawn_hinge(line, &base.spine_line, [images[lo], images[hi]], base.at)
                    .ok_or_else(|| base.no_flap(self, NoFlap::HingeOffSpine))?;
                Ok(vec![Vertex {
                    vertex: drawn.vertex,
                    spine_end: drawn.spine_end,
                    hinge: drawn.along,
                    clicked: Some(drawn.clicked),
                }])
            }
        }
    }

    /// The flap of `base` read at `vertex`: its creases, and which wall each
    /// of its faces is in, before it is checked free and uncovered.
    fn squash_reading(&self, op: &Squash, base: &Base, vertex: Vertex) -> Result<Reading, Refused> {
        let faces = self.faces();
        let topology = self.topology();
        let creases = self.creases();
        let images = &self.geometry().vertex_images;
        let no_flap = |cause| base.no_flap(self, cause);
        let Vertex {
            vertex,
            spine_end,
            hinge,
            clicked,
        } = vertex;
        let (plies, layers, opening, spine_line) =
            (&base.plies, base.layers, base.opening, base.spine_line);
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

        // The flap: its plies grown across flat creases off the hinge line
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
        // Which wall each face is in: a ply's own, across flat creases; across
        // the spine from paper that is no ply's, the other wall. A ply above
        // the opening is the upper wall's.
        let joins = |k: usize| {
            reaches(k)
                && match creases[k].kind {
                    CreaseKind::Flat(_) => !on(&hinge_line, k),
                    CreaseKind::Folded(_) => on(&spine_line, k),
                    CreaseKind::Border => false,
                }
        };
        let mut wall: Vec<Option<bool>> = vec![None; faces.len()];
        let mut queue = Vec::new();
        for (i, &f) in plies.iter().enumerate() {
            wall[f] = Some(i < opening);
            queue.push(f);
        }
        while let Some(f) = queue.pop() {
            for &k in &topology.face_creases[f] {
                let Some(g) = topology.across(k, f) else {
                    continue;
                };
                if !matches!(creases[k].kind, CreaseKind::Flat(_)) || !joins(k) {
                    continue;
                }
                match wall[g] {
                    None => {
                        wall[g] = wall[f];
                        queue.push(g);
                    }
                    Some(other) if Some(other) != wall[f] => return Err(no_flap(NoFlap::NoSpine)),
                    Some(_) => {}
                }
            }
        }
        let ply: Vec<bool> = wall.iter().map(Option::is_some).collect();
        let mut queue: Vec<usize> = (0..faces.len()).filter(|&f| ply[f]).collect();
        while let Some(f) = queue.pop() {
            for &k in &topology.face_creases[f] {
                let Some(g) = topology.across(k, f).filter(|_| joins(k)) else {
                    continue;
                };
                let flat = matches!(creases[k].kind, CreaseKind::Flat(_));
                let side = wall[f].map(|upper| upper == flat);
                match wall[g] {
                    None => {
                        wall[g] = side;
                        queue.push(g);
                    }
                    Some(other) if !ply[g] && Some(other) != side => {
                        return Err(no_flap(NoFlap::NoSpine));
                    }
                    Some(_) => {}
                }
            }
        }
        let upper_face = |f: usize| wall[f] == Some(true);
        // Plies joined across the opening anywhere but on the spine or the
        // hinge would tear as it opens: no opening there.
        if layers > 2
            && (0..faces.len()).any(|f| {
                upper_face(f)
                    && topology.face_creases[f].iter().any(|&k| {
                        topology
                            .across(k, f)
                            .is_some_and(|g| wall[g] == Some(false))
                            && reaches(k)
                            && !on(&spine_line, k)
                            && !on(&hinge_line, k)
                    })
            })
        {
            return Err(no_flap(NoFlap::OpeningOutside));
        }
        Ok(Reading {
            plies: plies.clone(),
            wall,
            layers,
            opening,
            vertex,
            spine_end,
            hinge: hinge_dir,
            clicked,
            wedge,
            share,
            moving_lower,
            lines: [hinge_line, spine_line, lower_crease, upper_crease],
        })
    }

    /// The paper outside every one of `readings`' flaps that holds one of
    /// them off its hinges where its paper moves: an upper layer anywhere, a
    /// lower one on the side of its crease that moves.
    fn squash_attached(&self, readings: &[Reading]) -> Vec<usize> {
        let topology = self.topology();
        let creases = self.creases();
        let images = &self.geometry().vertex_images;
        let in_flap = |g: usize| readings.iter().any(|r| r.wall[g].is_some());
        let mut attached = BTreeSet::new();
        for r in readings {
            for f in (0..self.faces().len()).filter(|&f| r.wall[f].is_some()) {
                for &k in &topology.face_creases[f] {
                    let Some(g) = topology.across(k, f) else {
                        continue;
                    };
                    let on_a_hinge = readings.iter().any(|o| {
                        (o.wall[f] == Some(false) || std::ptr::eq(o, r))
                            && o.on(self, &o.hinge_line(), k)
                    });
                    let moves = r.wall[f] == Some(true)
                        || creases[k]
                            .vertices
                            .iter()
                            .any(|v| r.moving_lower.signed_distance(images[v.index()]) > TOL);
                    if !in_flap(g) && !on_a_hinge && r.reaches(self, k) && moves {
                        attached.insert(g);
                    }
                }
            }
        }
        attached.into_iter().collect()
    }

    /// `readings` checked free and uncovered, as one flap: the first is the
    /// flap read at the flap point, the others pockets on its lower layer
    /// (see [`State::squash_other_reading`]). Each upper layer must be held
    /// along its own hinge.
    fn squash_checked(
        &self,
        readings: Vec<Reading>,
        direction: Direction,
    ) -> Result<Flap, Refused> {
        let faces = self.faces();
        let geometry = self.geometry();
        let topology = self.topology();
        let ids = |set: &[usize]| -> Vec<FaceId> {
            let mut ids: Vec<FaceId> = set.iter().map(|&f| faces[f].id).collect();
            ids.sort_unstable();
            ids.dedup();
            ids
        };
        let in_flap: Vec<bool> = (0..faces.len())
            .map(|f| readings.iter().any(|r| r.wall[f].is_some()))
            .collect();
        let flap: Vec<usize> = (0..faces.len()).filter(|&f| in_flap[f]).collect();
        let attached = self.squash_attached(&readings);
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
        for r in &readings {
            let crosses = |f: usize| {
                r.clicked.as_ref().is_some_and(|side| {
                    geometry.images[f]
                        .iter()
                        .any(|&v| side.signed_distance(v) < -TOL)
                })
            };
            let hinged = (0..faces.len()).any(|f| {
                r.wall[f] == Some(true)
                    && (crosses(f)
                        || topology.face_creases[f].iter().any(|&k| {
                            topology.across(k, f).is_some_and(|g| !in_flap[g])
                                && r.on(self, &r.hinge_line(), k)
                        }))
            });
            if !hinged {
                return Err(FoldRefusal::SquashNoFlap {
                    faces: ids(&r.plies),
                    cause: NoFlap::UpperNotHinged,
                }
                .into());
            }
        }
        // Uncovered where the paper moves. Cover over the stationary part
        // of a lower face is harmless, even when no precrease divides it,
        // and so is cover beyond a drawn hinge.
        let moving_lower = &readings[0].moving_lower;
        let moving_images: Vec<Vec<Point>> = (0..faces.len())
            .map(|f| match readings.iter().find(|r| r.wall[f].is_some()) {
                None => Vec::new(),
                Some(r) if r.wall[f] == Some(true) => match &r.clicked {
                    Some(side) => convex::split(&geometry.images[f], side, TOL).inside,
                    None => geometry.images[f].clone(),
                },
                Some(_) => convex::split(&geometry.images[f], moving_lower, TOL).inside,
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
        // A cover folded over an upper layer at its hinge, and held by the
        // flap there alone, rides with that layer instead: it is uncovered
        // in turn, nothing else over it.
        let mut riders: Vec<Vec<usize>> = vec![Vec::new(); readings.len()];
        if !covering.is_empty()
            && let Some(riding) = readings
                .iter()
                .map(|r| {
                    let upper = |f: usize| r.wall[f] == Some(true);
                    self.squash_riders(&in_flap, &r.hinge_line(), &upper, direction)
                })
                .collect::<Option<Vec<Vec<bool>>>>()
            && (0..faces.len()).all(|f| riding.iter().filter(|r| r[f]).count() <= 1)
            && covering.iter().all(|&x| riding.iter().any(|r| r[x]))
        {
            let rides = |f: usize| riding.iter().any(|r| r[f]);
            let moves: Vec<bool> = (0..faces.len()).map(|f| in_flap[f] || rides(f)).collect();
            let mut images = moving_images.clone();
            for f in (0..faces.len()).filter(|&f| rides(f)) {
                images[f] = geometry.images[f].clone();
            }
            covering = covering_of(&moves, &images);
            riders = riding
                .iter()
                .map(|r| (0..faces.len()).filter(|&f| r[f]).collect())
                .collect();
        }
        if !covering.is_empty() {
            let covering: Vec<usize> = covering.into_iter().collect();
            return Err(FoldRefusal::SquashFlapCovered {
                faces: ids(&covering),
                flap: ids(&flap),
            }
            .into());
        }
        let mut flaps = readings.into_iter().zip(riders).map(|(r, riders)| {
            let (upper, lower): (Vec<usize>, Vec<usize>) = (0..faces.len())
                .filter(|&f| r.wall[f].is_some())
                .partition(|&f| r.wall[f] == Some(true));
            Flap {
                upper,
                lower,
                layers: r.layers,
                opening: r.opening,
                riders,
                vertex: r.vertex,
                spine_end: r.spine_end,
                hinge: r.hinge,
                clicked: r.clicked,
                wedge: r.wedge,
                share: r.share,
                lines: r.lines,
                partners: Vec::new(),
            }
        });
        let mut primary = flaps.next().ok_or(FoldRefusal::Internal {
            message: "a squash read no flap".to_string(),
        })?;
        // The pockets share the primary's lower layer: only their upper
        // layers are their own.
        primary.partners = flaps
            .map(|partner| Flap {
                lower: Vec::new(),
                ..partner
            })
            .collect();
        Ok(primary)
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
        let mut moving: Vec<FaceId> = std::iter::once(&flap)
            .chain(&flap.partners)
            .flat_map(|f| f.upper.iter().chain(&f.lower).chain(&f.riders))
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

    /// A flap's walls in `stack`, the layers at its point from the
    /// direction's side: its top two, when folded creases join them (each
    /// discovered across flat precreases); otherwise the first 2m layers
    /// for the least m whose walls nest, layer m − 1 − i wrapped round
    /// layer m + i by folded creases on one line — the spine — for every
    /// i < m. None when no m does. A precrease may separate a picked face
    /// from the spine, so each ply is discovered across flat creases first;
    /// these regions are only for discovery: the flap is still bounded by
    /// its hinge, which may itself be flat after an earlier squash.
    fn squash_walls(&self, stack: &[usize]) -> Option<Walls> {
        let creases = self.creases();
        let topology = self.topology();
        let images = &self.geometry().vertex_images;
        let joining = |a: &[bool], b: &[bool]| -> Vec<usize> {
            topology
                .crease_faces
                .iter()
                .enumerate()
                .filter(|(k, incident)| {
                    creases[*k].kind.is_folded()
                        && incident.iter().any(|&f| a[f])
                        && incident.iter().any(|&f| b[f])
                })
                .map(|(k, _)| k)
                .collect()
        };
        let mut regions: Vec<Vec<bool>> = Vec::new();
        for m in 1..=stack.len() / 2 {
            while regions.len() < 2 * m {
                regions.push(self.squash_flat_region(stack[regions.len()]));
            }
            let inner = joining(&regions[m - 1], &regions[m]);
            let plies = || stack[..2 * m].to_vec();
            if m == 1 {
                if inner.is_empty() {
                    continue;
                }
                return Some(Walls {
                    plies: plies(),
                    regions,
                    spine: inner,
                });
            }
            for &first in &inner {
                let [a, b] = creases[first].vertices.map(|v| images[v.index()]);
                let Some(line) = Line::from_points(a, b) else {
                    continue;
                };
                let on = |k: &usize| {
                    creases[*k]
                        .vertices
                        .iter()
                        .all(|v| line.distance_to_point(images[v.index()]) <= TOL)
                };
                let pairs: Vec<Vec<usize>> = (0..m)
                    .map(|i| {
                        joining(&regions[m - 1 - i], &regions[m + i])
                            .into_iter()
                            .filter(on)
                            .collect()
                    })
                    .collect();
                if pairs.iter().all(|pair| !pair.is_empty()) {
                    regions.truncate(2 * m);
                    return Some(Walls {
                        plies: plies(),
                        regions,
                        spine: pairs.concat(),
                    });
                }
            }
        }
        None
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
        upper: &dyn Fn(usize) -> bool,
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
        for f in (0..faces.len()).filter(|&f| in_flap[f] && upper(f)) {
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

/// What every reading of a flap starts from (see [`State::squash_base`]).
struct Base {
    /// Its layers at the flap point, from the direction's side.
    plies: Vec<usize>,
    layers: usize,
    /// How many of them lie above where it opens.
    opening: usize,
    /// The lower wall, discovered across flat creases (the hinge too): what
    /// the hinge is found from.
    lower_region: Vec<bool>,
    /// The folded creases joining the walls, on the spine's line.
    spine: Vec<usize>,
    spine_line: Line,
    /// The spine's extreme vertices along its line.
    ends: [usize; 2],
    /// The flap point's image.
    at: Point,
}

impl Base {
    fn no_flap(&self, state: &State, cause: NoFlap) -> Refused {
        let mut faces: Vec<FaceId> = self.plies.iter().map(|&f| state.faces()[f].id).collect();
        faces.sort_unstable();
        faces.dedup();
        FoldRefusal::SquashNoFlap { faces, cause }.into()
    }
}

/// A vertex a flap may be read at (see [`State::squash_vertices`]).
#[derive(Debug, Clone, Copy)]
struct Vertex {
    vertex: Point,
    /// The spine's far end from it.
    spine_end: Point,
    /// A point along the hinge from it.
    hinge: Point,
    /// A drawn hinge's side the flap is on.
    clicked: Option<convex::HalfPlane>,
}

/// A flap read at one vertex, before it is checked free and uncovered (see
/// [`State::squash_reading`]).
#[derive(Debug, Clone)]
struct Reading {
    plies: Vec<usize>,
    /// Per face position: in the upper wall, the lower one, or neither.
    wall: Vec<Option<bool>>,
    layers: usize,
    opening: usize,
    vertex: Point,
    spine_end: Point,
    /// The hinge's direction from the vertex.
    hinge: Point,
    clicked: Option<convex::HalfPlane>,
    wedge: f64,
    share: f64,
    /// The side of the lower layer's crease that moves.
    moving_lower: convex::HalfPlane,
    /// The hinge, the spine, the lower layer's crease and the upper's.
    lines: [Line; 4],
}

impl Reading {
    fn hinge_line(&self) -> Line {
        self.lines[0]
    }
    fn lower_crease(&self) -> Line {
        self.lines[2]
    }
    fn upper(&self) -> Vec<usize> {
        (0..self.wall.len())
            .filter(|&f| self.wall[f] == Some(true))
            .collect()
    }
    fn lower(&self) -> Vec<usize> {
        (0..self.wall.len())
            .filter(|&f| self.wall[f] == Some(false))
            .collect()
    }
    /// Whether crease `k` of `state` lies on `line`.
    fn on(&self, state: &State, line: &Line, k: usize) -> bool {
        let images = &state.geometry().vertex_images;
        state.creases()[k]
            .vertices
            .iter()
            .all(|v| line.distance_to_point(images[v.index()]) <= TOL)
    }
    /// Whether crease `k` reaches the flap's side of a drawn hinge.
    fn reaches(&self, state: &State, k: usize) -> bool {
        let images = &state.geometry().vertex_images;
        self.clicked.as_ref().is_none_or(|side| {
            state.creases()[k]
                .vertices
                .iter()
                .any(|v| side.signed_distance(images[v.index()]) > TOL)
        })
    }
}

/// A flap's walls (see [`State::squash_walls`]).
struct Walls {
    /// Its layers at the flap point, from the direction's side: the upper
    /// wall's, then the lower's.
    plies: Vec<usize>,
    /// Each ply's flat region, by face position.
    regions: Vec<Vec<bool>>,
    /// The folded creases that join them, on the spine.
    spine: Vec<usize>,
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
