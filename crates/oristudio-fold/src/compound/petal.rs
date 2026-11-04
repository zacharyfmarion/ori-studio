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
//!   crease that is missing across the layer that folds on it, and creases
//!   no other layer. A score where the crease is there already splits
//!   nothing, so over precreases both ways land the same state.
//! - **The flap**: its *top layer* is the petal's face grown across flat
//!   creases that reach below H; its folded creases to the rest that reach
//!   below H are its closed edges, which H meets at its two ends PL and PR.
//!   The *second layer* is the paper across the closed edges, grown the same
//!   way.
//! - **The kite creases**, one per layer at each end. At PL, H, the closed
//!   edge above PL and the two layers' kite creases meet, and the closed
//!   edge below PL unfolds: that folds flat (Kawasaki at PL) exactly when
//!   the two kite creases' angles from the closed edge below PL add up to
//!   its angle with H. So a layer's kite crease is its own flat crease from
//!   PL below H, or the partner of the other layer's; given two points and
//!   neither layer creased there, both are the line that bisects H and the
//!   closed edge, as on the bird base, where the layers end together. On a
//!   doubled flap — a squashed one, as the frog base's — the top layer ends
//!   at a raw edge across the flap and its kite creases meet there, while
//!   the second layer's run on to its own corner. A layer's two kite creases
//!   meet at its open corner, and none of its paper may lie beyond it. Of
//!   the pairs the precreases offer, the first that folds is folded, the
//!   most precreased first; a precreased pair that does not fold flat is
//!   refused as a petal fold, never folded.
//! - **Motions** (6 blocks with what stays, research §5.3): the petal
//!   reflects across H; the top layer outside each of its kite creases
//!   reflects across it and then across H; the second layer outside each of
//!   its own across it alone; the top layer above H, where H is scored,
//!   stays. At PL the three reflections compose to one along the closed
//!   edge below PL, which unfolds. The second layer's paper inside its kite
//!   stays, so H need not cross it creased; its paper outside a kite crease
//!   folds in below H, so H must not cross it at all.

use std::collections::BTreeSet;

use oristudio_geometry::Line;
use oristudio_geometry::convex::{self, HalfPlane};
use serde::{Deserialize, Serialize};

use crate::complete::CompletionLimits;
use crate::compound::CompoundRefused;
use crate::compound::pieces::{Cut, Scoring, score_cuts};
use crate::compound::vertex::{
    Compiled, VertexChoices, VertexFoldKind, VertexOutcome, angle_between, drop_empty,
    piece_centroid, rotate, stack_toward, toward, unit,
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
    /// H's ends on the closed edges, and the corner the top layer's kite
    /// creases meet at, in the parent's model frame: the kite that lifts.
    pub ends: [Point; 2],
    pub corner: Point,
    pub kites: [Line; 2],
    /// The second layer's kite creases (in `kites`' order) and their
    /// corner: the top layer's own on a flap whose layers end together, as
    /// the bird base's do; on a doubled flap, as the frog base's, each runs
    /// to the second layer's own corner beyond the top layer's.
    pub second_corner: Point,
    pub second_kites: [Line; 2],
    /// The parent's faces of the top and second layers, in id order: below
    /// H, or across it where H is not creased.
    pub top: Vec<FaceId>,
    pub second: Vec<FaceId>,
    /// What the fold creases itself (H given by two points): H where it
    /// crosses the top layer, and at each end (in `kites`' order) a kite
    /// crease where it crosses its layer. All false over precreases.
    pub scores_line: bool,
    pub scores_kites: [bool; 2],
}

/// The flap by face positions.
struct Petal {
    line: Line,
    /// The sign of the petal's side of H.
    below: f64,
    ends: [Point; 2],
    top: Vec<usize>,
    second: Vec<usize>,
    /// The kite creases of the top layer and of the second.
    kite: Kite,
    second_kite: Kite,
    /// What the fold scores: the top faces H crosses. Empty over
    /// precreases.
    line_cut: Vec<usize>,
}

/// One layer's kite creases, from H's two ends to where they meet.
struct Kite {
    lines: [Line; 2],
    corner: Point,
    /// A model point inside the kite below H.
    inside: Point,
    /// Per kite crease, the layer's faces it crosses: what the fold scores.
    /// Empty over precreases.
    cuts: [Vec<usize>; 2],
}

impl Kite {
    /// Whether the model point `c` lies outside kite crease `k`: on its side
    /// away from the kite's inside.
    fn outside(&self, k: usize, c: Point) -> bool {
        let kite = &self.lines[k];
        kite.signed_distance(c) * kite.signed_distance(self.inside) < 0.0
    }
}

/// The kite creases a petal fold may fold at one end of H, one per layer:
/// flat at the end (Kawasaki, the closed edge below it unfolding) exactly
/// when their angles from the closed edge add up to the angle between it and
/// H. `precreased` counts those already creased flat there.
#[derive(Debug, Clone, Copy)]
struct KitePair {
    top: Line,
    second: Line,
    precreased: usize,
}

impl State {
    /// A petal fold's flap and creases, without folding.
    pub fn analyse_petal(&self, op: &PetalFold) -> Result<PetalAnalysis, Refused> {
        let direction = self.view().model_direction(op.direction);
        let petal = self.petal_flap(op, direction)?;
        let ids = |faces: &[usize]| faces.iter().map(|&f| self.faces()[f].id).collect();
        let scores =
            |k: usize| !petal.kite.cuts[k].is_empty() || !petal.second_kite.cuts[k].is_empty();
        Ok(PetalAnalysis {
            line: petal.line,
            ends: petal.ends,
            corner: petal.kite.corner,
            kites: petal.kite.lines,
            second_corner: petal.second_kite.corner,
            second_kites: petal.second_kite.lines,
            top: ids(&petal.top),
            second: ids(&petal.second),
            scores_line: !petal.line_cut.is_empty(),
            scores_kites: [scores(0), scores(1)],
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
        let side = Side::of_point(&petal.line, petal.kite.inside)
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
            petal.kite.corner,
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
        // its end in the layer it creases, so H runs through a vertex there
        // and splits no face of the second layer. A line both layers fold
        // on is one cut through both.
        let mut cuts: Vec<(Line, Vec<usize>)> = Vec::new();
        for kite in [&petal.kite, &petal.second_kite] {
            for (line, faces) in kite.lines.iter().zip(&kite.cuts) {
                if faces.is_empty() {
                    continue;
                }
                match cuts.iter_mut().find(|(other, _)| other.approx_eq(line)) {
                    Some((_, all)) => all.extend_from_slice(faces),
                    None => cuts.push((*line, faces.clone())),
                }
            }
        }
        let mut cuts: Vec<Cut> = cuts
            .into_iter()
            .map(|(line, faces)| Cut {
                axis: Axis::new(&line, Side::Positive),
                faces: mask(&faces),
            })
            .collect();
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
            // Outside a kite crease of its own layer.
            let kite = if layer[old] == 1 {
                &petal.kite
            } else {
                &petal.second_kite
            };
            let side = (0..2).find(|&k| kite.outside(k, c));
            block_of.push(match (layer[old], below, side) {
                // The top layer above a scored H stays.
                (1, false, _) => None,
                (1, true, None) => Some(0),
                (1, true, Some(k)) => Some(1 + k),
                (_, _, Some(k)) => Some(3 + k),
                (_, _, None) => None,
            });
        }
        // Each layer turns about its own kite creases: on a doubled flap the
        // top layer's run to its corner, the second layer's on to its own.
        let [left, right] = petal.kite.lines;
        let [second_left, second_right] = petal.second_kite.lines;
        let turns = vec![
            vec![(1, petal.line)],
            vec![(0, left), (1, petal.line)],
            vec![(0, right), (1, petal.line)],
            vec![(0, second_left)],
            vec![(0, second_right)],
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

        // The second layer: the paper across the closed edges.
        let across: Vec<usize> = closed.iter().map(|&(_, g)| g).collect();
        let mut second = grow(&across);
        second.retain(|f| !in_top(*f));
        let flap: Vec<usize> = top.iter().chain(&second).copied().collect();

        // The kite pairs each end offers (see the module docs): angles from
        // the closed edge below the end, partners when they add up to its
        // angle with H.
        let pairs = |end: Point, other: Point, run: Point| -> Vec<KitePair> {
            let Some(along) = unit([other[0] - end[0], other[1] - end[1]]) else {
                return Vec::new();
            };
            let turn = angle_between(run, along);
            let (angle, toward) = (turn.abs(), turn.signum());
            let at = |a: f64| Line::from_point_direction(end, rotate(run, toward * a));
            // A layer's flat creases from the end that run below H: each
            // one's angle from the closed edge, its line, and its far end.
            let creased = |layer: &[usize]| -> Vec<(f64, Line, Point)> {
                let mut found: Vec<(f64, Line, Point)> = Vec::new();
                let flat = layer
                    .iter()
                    .flat_map(|&f| topology.face_creases[f].iter().copied())
                    .filter(|&k| matches!(creases[k].kind, CreaseKind::Flat(_)));
                for k in flat {
                    let [x, y] = point_of(k);
                    let far = if close(x, end) {
                        y
                    } else if close(y, end) {
                        x
                    } else {
                        continue;
                    };
                    if depth(far) <= TOL {
                        continue;
                    }
                    let (Some(direction), Some(line)) = (
                        unit([far[0] - end[0], far[1] - end[1]]),
                        Line::from_points(end, far),
                    ) else {
                        continue;
                    };
                    let a = toward * angle_between(run, direction);
                    if a > 0.0 && a < angle && !found.iter().any(|(_, l, _)| l.approx_eq(&line)) {
                        found.push((a, line, far));
                    }
                }
                found
            };
            let (on_top, on_second) = (creased(&top), creased(&second));
            let mut pairs: Vec<KitePair> = Vec::new();
            let mut push = |top: Line, second: Line, precreased: usize| {
                if !pairs
                    .iter()
                    .any(|p| p.top.approx_eq(&top) && p.second.approx_eq(&second))
                {
                    pairs.push(KitePair {
                        top,
                        second,
                        precreased,
                    });
                }
            };
            // Both creased and flat together.
            for &(a, top_line, _) in &on_top {
                for &(_, second_line, far) in &on_second {
                    if at(angle - a).is_some_and(|l| l.distance_to_point(far) <= TOL) {
                        push(top_line, second_line, 2);
                    }
                }
            }
            // One creased, its partner in the other layer.
            for &(a, top_line, _) in &on_top {
                if let Some(partner) = at(angle - a) {
                    push(top_line, partner, 1);
                }
            }
            for &(a, second_line, _) in &on_second {
                if let Some(partner) = at(angle - a) {
                    push(partner, second_line, 1);
                }
            }
            if scores
                && on_top.is_empty()
                && on_second.is_empty()
                && let Some(bisector) = at(angle / 2.0)
            {
                push(bisector, bisector, 0);
            }
            pairs
        };
        let (at_a, at_b) = (pairs(a, b, run_a), pairs(b, a, run_b));
        if at_a.is_empty() || at_b.is_empty() {
            return Err(if scores {
                no_petal(NoPetal::NoCorner)
            } else {
                not_precreased(top, PetalCrease::Kite)
            });
        }

        // A layer's paper outside both its kite creases, beyond its corner,
        // folds no way: none of it may lie there.
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
        let crosses = |f: usize, kite: &Line| {
            let d: Vec<f64> = faces[f]
                .ring
                .iter()
                .map(|v| kite.signed_distance(images[v.index()]))
                .collect();
            d.iter().any(|&x| x > TOL) && d.iter().any(|&x| x < -TOL)
        };
        // One layer's kite from a pair at each end, checked: its creases
        // meet below H, and none of its paper lies past their corner. Also
        // its outside half-planes, for the second layer's check against H.
        let kite_of = |layer: &[usize],
                       lines: [Line; 2]|
         -> Result<(Kite, [HalfPlane; 2]), Refused> {
            let corner = lines[0]
                .intersect(&lines[1])
                .filter(|c| depth(*c) > TOL)
                .ok_or(no_petal(NoPetal::NoCorner))?;
            let inside = [
                (a[0] + b[0] + corner[0]) / 3.0,
                (a[1] + b[1] + corner[1]) / 3.0,
            ];
            let outside_of = |kite: &Line| -> Option<HalfPlane> {
                let s = -kite.signed_distance(inside).signum();
                HalfPlane::new([s * kite.n[0], s * kite.n[1]], s * kite.d)
            };
            let (Some(out_a), Some(out_b)) = (outside_of(&lines[0]), outside_of(&lines[1])) else {
                return Err(no_petal(NoPetal::NoCorner));
            };
            let past: Vec<usize> = layer
                .iter()
                .copied()
                .filter(|&f| !part(f, &[out_a, out_b]).is_empty())
                .collect();
            if !past.is_empty() {
                return Err(FoldRefusal::PetalNoFlap {
                    faces: ids(&past),
                    cause: NoPetal::NoCorner,
                    detail: Some(NoPetalDetail::PastCorner { corner }),
                }
                .into());
            }
            let cuts = lines.map(|kite| {
                layer
                    .iter()
                    .copied()
                    .filter(|&f| crosses(f, &kite))
                    .collect()
            });
            let kite = Kite {
                lines,
                corner,
                inside,
                cuts,
            };
            Ok((kite, [out_a, out_b]))
        };
        let fold = |[left, right]: [KitePair; 2]| -> Result<(Kite, Kite), Refused> {
            let (kite, _) = kite_of(&top, [left.top, right.top])?;
            let (second_kite, outside) = kite_of(&second, [left.second, right.second])?;
            if !scores {
                let crossed: BTreeSet<usize> = kite
                    .cuts
                    .iter()
                    .chain(&second_kite.cuts)
                    .flatten()
                    .copied()
                    .collect();
                if !crossed.is_empty() {
                    return Err(not_precreased(
                        crossed.into_iter().collect(),
                        PetalCrease::Kite,
                    ));
                }
            }
            // The second layer's paper outside a kite crease folds in below
            // H, so H must not cross it: the fold scores H in the top layer
            // only.
            let reaching: Vec<usize> = second
                .iter()
                .copied()
                .filter(|&f| {
                    outside
                        .iter()
                        .any(|plane| straddles(&mut part(f, &[*plane]).into_iter()))
                })
                .collect();
            if !reaching.is_empty() {
                return Err(not_precreased(reaching, PetalCrease::Line));
            }
            Ok((kite, second_kite))
        };
        // The first pair at each end that folds, the most precreased first.
        // None folding is refused as the first pair that would fold but for
        // a missing kite crease is, naming it; else as the first pair is.
        let mut choices: Vec<[KitePair; 2]> = at_a
            .iter()
            .flat_map(|&left| at_b.iter().map(move |&right| [left, right]))
            .collect();
        choices.sort_by_key(|[left, right]| std::cmp::Reverse(left.precreased + right.precreased));
        let (mut first, mut missing) = (None, None);
        let mut chosen = None;
        for choice in choices {
            match fold(choice) {
                Ok(kites) => {
                    chosen = Some(kites);
                    break;
                }
                Err(refused) => {
                    if missing.is_none()
                        && matches!(
                            refused.refusal,
                            FoldRefusal::PetalNotPrecreased {
                                missing: PetalCrease::Kite,
                                ..
                            }
                        )
                    {
                        missing = Some(refused.clone());
                    }
                    first.get_or_insert(refused);
                }
            }
        }
        let (kite, second_kite) = match (chosen, missing.or(first)) {
            (Some(kites), _) => kites,
            (None, Some(refused)) => return Err(refused),
            (None, None) => return Err(no_petal(NoPetal::NoCorner)),
        };

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
            top,
            second,
            kite,
            second_kite,
            line_cut: if scores { line_cut } else { Vec::new() },
        })
    }
}

fn close(a: Point, b: Point) -> bool {
    (a[0] - b[0]).hypot(a[1] - b[1]) <= TOL
}
