//! The petal fold (plan Phase 11, research §5.3), a vertex fold
//! ([`super::vertex`]): a flap's lower point lifted along a line H while its
//! sides fold in along the kite creases — a fan at the two ends of H.
//!
//! - **Inputs**: H ([`PetalHinge`]), a sheet point on the flap's top layer
//!   below H inside the kite (the petal), and the direction (a valley lifts
//!   the petal toward the viewer).
//! - **H is named one of two ways.** As an existing crease's line
//!   ([`PetalHinge::Crease`]), H and the kite creases are precreased, as a
//!   folder does it: the macro scores nothing, every crease it folds is
//!   there, flat, and the hinge diff refolds it; a piece H or a kite line
//!   crosses is refused, naming it. As the line through two points
//!   ([`PetalHinge::Points`]), they need not be: the macro scores H across
//!   the top layer alone — the paper that lifts across it — and each kite
//!   crease that is missing across the top two layers, which fold on it, and
//!   creases no other layer. A score where the crease is there already splits
//!   nothing, so over precreases both ways land the same state.
//! - **The flap**: its *top layer* is the petal's face grown across flat
//!   creases that reach below H; its folded creases to the rest that reach
//!   below H are its closed edges, which H meets at its two ends PL and PR.
//!   A kite crease is the flat crease of the top layer from PL (or PR) below
//!   H; given two points and no such crease, it is the line from PL that
//!   bisects H and the closed edge below PL, the one line there that folds
//!   flat with the closed edge unfolding (Kawasaki at PL). The two meet at
//!   the flap's open corner, and no paper of the flap may lie beyond it. The
//!   *second layer* is the paper across the closed edges, grown the same way.
//! - **Motions** (6 blocks with what stays, research §5.3): the petal
//!   reflects across H; the top layer outside each kite crease reflects
//!   across it and then across H; the second layer outside it across it
//!   alone; the top layer above H, where H is scored, stays. At PL, H, the
//!   kite crease and the closed edge meet, so the three reflections compose
//!   to one there: the second layer creases on the kite line, and the closed
//!   edge below PL unfolds. The second layer's paper inside the kite stays,
//!   so H need not cross it creased; its paper outside a kite crease folds
//!   in below H, so H must not cross it at all.

use std::collections::BTreeSet;

use oristudio_geometry::Line;
use oristudio_geometry::convex::{self, HalfPlane};
use serde::{Deserialize, Serialize};

use crate::complete::CompletionLimits;
use crate::compound::CompoundRefused;
use crate::compound::pieces::{Cut, Scoring, score_cuts};
use crate::compound::vertex::{
    Compiled, VertexChoices, VertexFoldKind, VertexOutcome, drop_empty, piece_centroid,
    stack_toward, toward, unit,
};
use crate::fold::line::Axis;
use crate::fold::{ActionKind, FoldActionGeometry, FoldAnalysis, Snap, Within};
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::{CreaseKind, FaceId};
use crate::refusal::{FoldRefusal, Refused, Side};
use crate::state::State;
use crate::view::Direction;

type Point = [f64; 2];

/// How a petal fold names H, the line the petal lifts about, in the parent's
/// model frame.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum PetalHinge {
    /// An existing crease's line: H and the kite creases are precreased
    /// wherever the fold folds them, and it scores nothing.
    Crease { line: Line },
    /// The line through two points — H's ends on the flap's closed edges,
    /// where the kite creases meet them, say — which need not be creased:
    /// the fold scores H across the top layer and each missing kite crease
    /// across the top two layers.
    Points { from: Point, to: Point },
}

impl PetalHinge {
    /// H; none for two points closer than the minimum feature.
    pub fn line(&self) -> Option<Line> {
        match *self {
            PetalHinge::Crease { line } => Some(line),
            PetalHinge::Points { from, to } => {
                let distance = (to[0] - from[0]).hypot(to[1] - from[1]);
                Line::from_points(from, to).filter(|_| distance >= MIN_FEATURE)
            }
        }
    }

    /// Whether the fold scores what is not creased yet: H given by two
    /// points.
    pub fn scores(&self) -> bool {
        matches!(self, PetalHinge::Points { .. })
    }
}

/// A petal fold, named the way a step stores it (plan D6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PetalFold {
    /// H: an existing crease, or the line through two points.
    pub hinge: PetalHinge,
    /// A sheet point on the flap's top layer as the viewer sees it, below H
    /// and between the kite creases.
    pub petal: Point,
    /// As the viewer sees it.
    pub direction: Direction,
}

/// Which crease of a petal fold is not precreased.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PetalCrease {
    /// The line H.
    Line,
    /// A kite crease, from an end of H to the open corner.
    Kite,
}

/// Why a petal fold has no flap.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NoPetal {
    /// H does not cross the top layer's closed edges at two points: it
    /// crosses one, or none, or misses the flap altogether
    /// ([`NoPetalDetail::MissesFlap`]); or, given by two points, has no
    /// length.
    NoEnds,
    /// The kite creases do not meet below H at the flap's open corner: they
    /// do not meet below H, or the flap reaches past where they do
    /// ([`NoPetalDetail::PastCorner`]).
    NoCorner,
}

/// What a [`NoPetal`] cause names more precisely, where it does.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum NoPetalDetail {
    /// H misses the flap: the top layer the petal names lies wholly on the
    /// petal's side of it (`no_ends`; the faces are the top layer's).
    MissesFlap,
    /// The kite creases meet below H at `corner` (in the parent's model
    /// frame), but the flap reaches past it: the paper beyond, outside both,
    /// folds no way (`no_corner`; the faces are that paper's). H lies too
    /// near the flap's closed point.
    PastCorner { corner: Point },
}

/// A petal fold's flap and creases, before it lands: what a tool previews.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PetalAnalysis {
    pub line: Line,
    /// H's ends on the closed edges, and the corner the kite creases meet
    /// at, in the parent's model frame.
    pub ends: [Point; 2],
    pub corner: Point,
    pub kites: [Line; 2],
    /// The parent's faces of the top and second layers, in id order: below
    /// H, or across it where H is not creased.
    pub top: Vec<FaceId>,
    pub second: Vec<FaceId>,
    /// What the fold creases itself (H given by two points): H where it
    /// crosses the top layer, and each kite crease (in `kites`' order) where
    /// it crosses the top two layers. All false over precreases.
    pub scores_line: bool,
    pub scores_kites: [bool; 2],
}

/// The flap by face positions.
struct Petal {
    line: Line,
    /// The sign of the petal's side of H.
    below: f64,
    ends: [Point; 2],
    corner: Point,
    kites: [Line; 2],
    top: Vec<usize>,
    second: Vec<usize>,
    /// A model point inside the kite below H.
    inside: Point,
    /// What the fold scores: the top faces H crosses, and per kite crease
    /// the top and second faces it crosses. Empty over precreases.
    line_cut: Vec<usize>,
    kite_cuts: [Vec<usize>; 2],
}

impl State {
    /// A petal fold's flap and creases, without folding.
    pub fn analyse_petal(&self, op: &PetalFold) -> Result<PetalAnalysis, Refused> {
        let direction = self.view().model_direction(op.direction);
        let petal = self.petal_flap(op, direction)?;
        let ids = |faces: &[usize]| faces.iter().map(|&f| self.faces()[f].id).collect();
        Ok(PetalAnalysis {
            line: petal.line,
            ends: petal.ends,
            corner: petal.corner,
            kites: petal.kites,
            top: ids(&petal.top),
            second: ids(&petal.second),
            scores_line: !petal.line_cut.is_empty(),
            scores_kites: petal.kite_cuts.each_ref().map(|faces| !faces.is_empty()),
        })
    }

    /// A petal fold, with its stored choices (empty for a new step), under
    /// the default completion limits.
    pub fn petal_fold(
        &self,
        op: &PetalFold,
        choices: &VertexChoices,
    ) -> Result<VertexOutcome, CompoundRefused> {
        self.petal_fold_within(op, choices, &CompletionLimits::default())
    }

    /// [`State::petal_fold`] under `limits`; refusals as the squash's.
    pub fn petal_fold_within(
        &self,
        op: &PetalFold,
        choices: &VertexChoices,
        limits: &CompletionLimits,
    ) -> Result<VertexOutcome, CompoundRefused> {
        let direction = self.view().model_direction(op.direction);
        let compiled = self
            .compile_petal(op, direction)
            .map_err(CompoundRefused::Refused)?;
        compiled.land(self, choices, limits, || {
            self.compile_petal(op, direction.opposite()).ok()
        })
    }

    /// The picture of the petal fold `op` on this state, with `landed`'s
    /// cover at the arrow's head when it is given (see [`super::vertex`]): H
    /// where the flap's top layer meets it, and the arrow lifting the petal
    /// across it, from inside the kite. Refused as [`State::analyse_petal`]
    /// is.
    pub fn petal_action(
        &self,
        op: &PetalFold,
        landed: Option<&State>,
    ) -> Result<FoldActionGeometry, Refused> {
        let direction = self.view().model_direction(op.direction);
        let petal = self.petal_flap(op, direction)?;
        let side = Side::of_point(&petal.line, petal.inside)
            .ok_or(FoldRefusal::SeedNotOnMovingSide { point: op.petal })?;
        let mut moving: Vec<FaceId> = petal.top.iter().map(|&f| self.faces()[f].id).collect();
        moving.sort_unstable();
        let analysis = FoldAnalysis {
            line: petal.line,
            side,
            snap: Snap::NONE,
            direction,
            flaps: Vec::new(),
            picked: Vec::new(),
            added: Vec::new(),
            moving,
        };
        // The petal turns across H alone; the sides outside the kite fold
        // in first, so the grip stays inside it.
        let kite = [convex::normalize(&[
            petal.ends[0],
            petal.ends[1],
            petal.corner,
        ])];
        self.fold_action_within(
            &analysis,
            ActionKind::Fold,
            landed,
            Within {
                ray: None,
                reach: Some(&kite),
            },
        )
    }

    fn compile_petal(&self, op: &PetalFold, direction: Direction) -> Result<Compiled, Refused> {
        let petal = self.petal_flap(op, direction)?;
        let nf = self.faces().len();
        let mask = |faces: &[usize]| {
            let mut mask = vec![false; nf];
            for &f in faces {
                mask[f] = true;
            }
            mask
        };
        let mut layer = vec![0_u8; nf];
        for &f in &petal.top {
            layer[f] = 1;
        }
        for &f in &petal.second {
            layer[f] = 2;
        }
        // The kite creases first: each one scored splits the closed edge at
        // its end in both layers it creases, so H runs through a vertex
        // there and splits no face of the second layer.
        let mut cuts = Vec::new();
        for (kite, faces) in petal.kites.iter().zip(&petal.kite_cuts) {
            if !faces.is_empty() {
                cuts.push(Cut {
                    axis: Axis::new(kite, Side::Positive),
                    faces: mask(faces),
                });
            }
        }
        if !petal.line_cut.is_empty() {
            cuts.push(Cut {
                axis: Axis::new(&petal.line, Side::Positive),
                faces: mask(&petal.line_cut),
            });
        }
        let scoring = if cuts.is_empty() {
            Scoring::unscored(self)
        } else {
            score_cuts(self, &cuts)?
        };
        // Outside a kite line: on its side away from the kite's inside.
        let outside = |kite: &Line, c: Point| {
            kite.signed_distance(c) * kite.signed_distance(petal.inside) < 0.0
        };
        let mut block_of = Vec::with_capacity(scoring.faces.len());
        for a in 0..scoring.faces.len() {
            let old = scoring.old[a];
            if layer[old] == 0 {
                block_of.push(None);
                continue;
            }
            let c = piece_centroid(self, &scoring, a).ok_or(FoldRefusal::Internal {
                message: "a petal piece has no centroid".to_string(),
            })?;
            let below = petal.line.signed_distance(c) * petal.below > 0.0;
            let side = (0..2).find(|&k| outside(&petal.kites[k], c));
            block_of.push(match (layer[old], below, side) {
                // The top layer above a scored H stays.
                (1, false, _) => None,
                (1, true, None) => Some(0),
                (1, true, Some(k)) => Some(1 + k),
                (_, _, Some(k)) => Some(3 + k),
                (_, _, None) => None,
            });
        }
        let [left, right] = petal.kites;
        let turns = vec![
            vec![(1, petal.line)],
            vec![(0, left), (1, petal.line)],
            vec![(0, right), (1, petal.line)],
            vec![(0, left)],
            vec![(0, right)],
        ];
        let turns = drop_empty(&mut block_of, turns);
        Ok(Compiled {
            kind: VertexFoldKind::Petal,
            scoring,
            block_of,
            turns,
            vertices: petal.ends.to_vec(),
            direction,
            extra: Vec::new(),
            against: None,
        })
    }

    /// The flap `op` names and its creases: checked precreased (H named by a
    /// crease) or found to score (by two points), and uncovered.
    fn petal_flap(&self, op: &PetalFold, direction: Direction) -> Result<Petal, Refused> {
        let faces = self.faces();
        let creases = self.creases();
        let geometry = self.geometry();
        let topology = self.topology();
        let images = &geometry.vertex_images;
        let ids = |set: &[usize]| -> Vec<FaceId> {
            let mut ids: Vec<FaceId> = set.iter().map(|&f| faces[f].id).collect();
            ids.sort_unstable();
            ids.dedup();
            ids
        };
        let scores = op.hinge.scores();
        let p = self
            .face_at(op.petal)
            .and_then(|id| self.face_position(id))
            .ok_or(FoldRefusal::WitnessNotInFace { point: op.petal })?;
        let line = op.hinge.line().ok_or(FoldRefusal::PetalNoFlap {
            faces: ids(&[p]),
            cause: NoPetal::NoEnds,
            detail: None,
        })?;
        let at = geometry.isometries[p].apply(op.petal);
        if line.distance_to_point(at) <= TOL {
            return Err(FoldRefusal::SeedNotOnMovingSide { point: op.petal }.into());
        }
        let below = line.signed_distance(at).signum();
        let stack = stack_toward(self, at, direction).ok_or(FoldRefusal::Internal {
            message: "the layers at the petal do not stack".to_string(),
        })?;
        if let Some(i) = stack.iter().position(|&f| f == p)
            && i > 0
        {
            return Err(FoldRefusal::SquashFlapCovered {
                faces: ids(&stack[..i]),
                flap: ids(&[p]),
            }
            .into());
        }
        // How far below H a model point lies: positive on the petal's side.
        let depth = |q: Point| line.signed_distance(q) * below;
        let straddles = |points: &mut dyn Iterator<Item = Point>| {
            let (mut over, mut under) = (false, false);
            for q in points {
                over |= depth(q) < -TOL;
                under |= depth(q) > TOL;
            }
            over && under
        };
        let face_straddles =
            |f: usize| straddles(&mut faces[f].ring.iter().map(|v| images[v.index()]));
        // A crease reaches below H when an end of it lies below.
        let reaches = |k: usize| {
            creases[k]
                .vertices
                .iter()
                .any(|v| depth(images[v.index()]) > TOL)
        };
        let grow = |seeds: &[usize]| -> Vec<usize> {
            let mut seen = vec![false; faces.len()];
            let mut queue: Vec<usize> = seeds.to_vec();
            for &f in seeds {
                seen[f] = true;
            }
            while let Some(f) = queue.pop() {
                for &k in &topology.face_creases[f] {
                    if !matches!(creases[k].kind, CreaseKind::Flat(_)) || !reaches(k) {
                        continue;
                    }
                    if let Some(g) = topology.across(k, f)
                        && !seen[g]
                    {
                        seen[g] = true;
                        queue.push(g);
                    }
                }
            }
            (0..faces.len()).filter(|&f| seen[f]).collect()
        };
        let top = grow(&[p]);
        let misses = top
            .iter()
            .all(|&f| faces[f].ring.iter().all(|v| depth(images[v.index()]) > TOL));
        if misses {
            return Err(FoldRefusal::PetalNoFlap {
                faces: ids(&top),
                cause: NoPetal::NoEnds,
                detail: Some(NoPetalDetail::MissesFlap),
            }
            .into());
        }
        let not_precreased = |faces: Vec<usize>, missing| -> Refused {
            FoldRefusal::PetalNotPrecreased {
                faces: ids(&faces),
                missing,
            }
            .into()
        };
        let line_cut: Vec<usize> = top.iter().copied().filter(|&f| face_straddles(f)).collect();
        if !scores && !line_cut.is_empty() {
            return Err(not_precreased(line_cut, PetalCrease::Line));
        }

        // The closed edges: the top layer's folded creases to other paper
        // that reach below H. H's ends are where it meets them, each with
        // the direction its closed edge runs below H from there.
        let in_top = |f: usize| top.binary_search(&f).is_ok();
        let mut closed: Vec<(usize, usize)> = Vec::new();
        for &f in &top {
            for &k in &topology.face_creases[f] {
                if let (CreaseKind::Folded(_), Some(g)) = (creases[k].kind, topology.across(k, f))
                    && !in_top(g)
                    && reaches(k)
                {
                    closed.push((k, g));
                }
            }
        }
        let point_of = |k: usize| creases[k].vertices.map(|v| images[v.index()]);
        let mut ends: Vec<(Point, Point)> = Vec::new();
        for &(k, _) in &closed {
            let [x, y] = point_of(k);
            let (dx, dy) = (depth(x), depth(y));
            let (end, low) = if dx.abs() <= TOL {
                (x, y)
            } else if dy.abs() <= TOL {
                (y, x)
            } else if dx * dy < 0.0 {
                let t = dx / (dx - dy);
                let end = [x[0] + t * (y[0] - x[0]), x[1] + t * (y[1] - x[1])];
                (end, if dx > 0.0 { x } else { y })
            } else {
                continue;
            };
            let Some(run) = unit([low[0] - end[0], low[1] - end[1]]) else {
                continue;
            };
            if !ends.iter().any(|&(e, _)| close(e, end)) {
                ends.push((end, run));
            }
        }
        let no_petal = |cause| -> Refused {
            FoldRefusal::PetalNoFlap {
                faces: ids(&top),
                cause,
                detail: None,
            }
            .into()
        };
        let [(a, run_a), (b, run_b)] = ends[..] else {
            return Err(no_petal(NoPetal::NoEnds));
        };
        // The kite creases: the top layer's flat creases from each end that
        // run below H; given two points and none is there, the bisector of
        // H and the closed edge below the end.
        let precreased = |end: Point| -> Option<Line> {
            top.iter()
                .flat_map(|&f| topology.face_creases[f].iter().copied())
                .filter(|&k| matches!(creases[k].kind, CreaseKind::Flat(_)))
                .find_map(|k| {
                    let [x, y] = point_of(k);
                    let far = if close(x, end) {
                        y
                    } else if close(y, end) {
                        x
                    } else {
                        return None;
                    };
                    (depth(far) > TOL)
                        .then(|| Line::from_points(end, far))
                        .flatten()
                })
        };
        let bisector = |end: Point, other: Point, run: Point| -> Option<Line> {
            let along = unit([other[0] - end[0], other[1] - end[1]])?;
            let mid = unit([along[0] + run[0], along[1] + run[1]])?;
            Line::from_point_direction(end, mid)
        };
        let kite = |end: Point, other: Point, run: Point| {
            precreased(end).or_else(|| scores.then(|| bisector(end, other, run)).flatten())
        };
        let (Some(left), Some(right)) = (kite(a, b, run_a), kite(b, a, run_b)) else {
            return Err(if scores {
                no_petal(NoPetal::NoCorner)
            } else {
                not_precreased(top, PetalCrease::Kite)
            });
        };
        let corner = left
            .intersect(&right)
            .filter(|c| depth(*c) > TOL)
            .ok_or(no_petal(NoPetal::NoCorner))?;
        let inside = [
            (a[0] + b[0] + corner[0]) / 3.0,
            (a[1] + b[1] + corner[1]) / 3.0,
        ];

        // The second layer: the paper across the closed edges.
        let across: Vec<usize> = closed.iter().map(|&(_, g)| g).collect();
        let mut second = grow(&across);
        second.retain(|f| !in_top(*f));
        let flap: Vec<usize> = top.iter().chain(&second).copied().collect();

        // Beyond the corner, outside both kite creases, the flap folds no
        // way: none of it may lie there.
        let outside_of = |kite: &Line| -> Option<HalfPlane> {
            let s = -kite.signed_distance(inside).signum();
            HalfPlane::new([s * kite.n[0], s * kite.n[1]], s * kite.d)
        };
        let (Some(out_left), Some(out_right)) = (outside_of(&left), outside_of(&right)) else {
            return Err(no_petal(NoPetal::NoCorner));
        };
        let part = |f: usize, planes: &[HalfPlane]| -> Vec<Point> {
            let mut part = geometry.images[f].clone();
            for plane in planes {
                if part.is_empty() {
                    break;
                }
                part = convex::split(&part, plane, TOL).inside;
            }
            part
        };
        let past: Vec<usize> = flap
            .iter()
            .copied()
            .filter(|&f| !part(f, &[out_left, out_right]).is_empty())
            .collect();
        if !past.is_empty() {
            return Err(FoldRefusal::PetalNoFlap {
                faces: ids(&past),
                cause: NoPetal::NoCorner,
                detail: Some(NoPetalDetail::PastCorner { corner }),
            }
            .into());
        }
        let crosses = |f: usize, kite: &Line| {
            let d: Vec<f64> = faces[f]
                .ring
                .iter()
                .map(|v| kite.signed_distance(images[v.index()]))
                .collect();
            d.iter().any(|&x| x > TOL) && d.iter().any(|&x| x < -TOL)
        };
        let kite_cuts = [left, right].map(|kite| {
            flap.iter()
                .copied()
                .filter(|&f| crosses(f, &kite))
                .collect()
        });
        if !scores {
            let crossed: BTreeSet<usize> = kite_cuts.iter().flatten().copied().collect();
            if !crossed.is_empty() {
                return Err(not_precreased(
                    crossed.into_iter().collect(),
                    PetalCrease::Kite,
                ));
            }
        }
        // The second layer's paper outside a kite crease folds in below H,
        // so H must not cross it: the fold scores H in the top layer only.
        let reaching: Vec<usize> = second
            .iter()
            .copied()
            .filter(|&f| {
                [out_left, out_right]
                    .iter()
                    .any(|plane| straddles(&mut part(f, &[*plane]).into_iter()))
            })
            .collect();
        if !reaching.is_empty() {
            return Err(not_precreased(reaching, PetalCrease::Line));
        }

        // Uncovered: no other paper over the top layer below H on the side
        // the petal lifts toward.
        let petal_side = HalfPlane::new([below * line.n[0], below * line.n[1]], below * line.d)
            .ok_or(no_petal(NoPetal::NoEnds))?;
        let mut in_flap = vec![false; faces.len()];
        for &f in &flap {
            in_flap[f] = true;
        }
        let mut covering = BTreeSet::new();
        for (pair, _) in self.order().pairs() {
            let (Some(f), Some(g)) = (self.face_position(pair.lo()), self.face_position(pair.hi()))
            else {
                continue;
            };
            let (x, y) = match (in_flap[f], in_flap[g]) {
                (true, false) => (g, f),
                (false, true) => (f, g),
                _ => continue,
            };
            if !in_top(y) || toward(self, x, y, direction) != Some(true) {
                continue;
            }
            // A top face H crosses lifts only below it.
            let over_lifting = !face_straddles(y)
                || convex::penetration(&geometry.images[x], &part(y, &[petal_side])) > TOL;
            if over_lifting {
                covering.insert(x);
            }
        }
        if !covering.is_empty() {
            let covering: Vec<usize> = covering.into_iter().collect();
            return Err(FoldRefusal::SquashFlapCovered {
                faces: ids(&covering),
                flap: ids(&top),
            }
            .into());
        }
        Ok(Petal {
            line,
            below,
            ends: [a, b],
            corner,
            kites: [left, right],
            top,
            second,
            inside,
            line_cut: if scores { line_cut } else { Vec::new() },
            kite_cuts: if scores {
                kite_cuts
            } else {
                [Vec::new(), Vec::new()]
            },
        })
    }
}

fn close(a: Point, b: Point) -> bool {
    (a[0] - b[0]).hypot(a[1] - b[1]) <= TOL
}
