//! Two swivels by their valleys and mountains, made together where they
//! share a crease.
//!
//! # In a folder's words
//!
//! *Fold the strip up, squashing the corner out on each side.* Each side is
//! a swivel by its valley and mountain ([`super::swivel_valley_mountain`])
//! on its own folded edge, and one crease of each runs across to the other
//! side's folded edge and is the same crease: the valley across the layer in
//! front (a kite's bottom corner folded up, each wide corner squashed), or
//! the crease behind (a cupboard's two flaps each swivelled out, the layer
//! behind them creased once across).
//!
//! Made one at a time, the first swivel's shared crease runs on to the other
//! folded edge and carries the other side's flap with the strip; that is a
//! different fold. Made together, the paper between the two vertices along
//! the shared crease is a wedge of both swivels and moves as both move it.
//! A swivel's analysis names where such a crease runs on to another folded
//! edge (`other_end`), so a tool can offer the second swivel there.
//!
//! # The fold
//!
//! Each swivel resolves on the folded edge its lines meet on, as the swivel
//! by its valley and mountain does; where several folded edges qualify, the
//! pair that compiles. The two fans' rays crease their own two layers, rays
//! of the two along one line are one crease, and every other face moves with
//! the paper it is joined to (`super::folded_swivel`'s two-layer reading over
//! both fans). The fold lands through the compound pipeline, each order a
//! choice offers landed before it is offered.
//!
//! **Its picture** is the strip's: the shared crease, with the arrow from
//! the paper both swivels move across it.
//!
//! **Refusals**: either swivel's own (`swivel_line_meeting`,
//! `swivel_no_flap`, the fan's); both at one vertex, or several pairs of
//! folded edges that compile (`swivel_line_meeting`); paper joined to two
//! wedges that move differently, or to a wedge and the paper that stays,
//! including paper beyond the four layers (`fan_ray_blocked`: the reading
//! through the stack is a single swivel's only); and no order (`no_order`).
use super::CompoundRefused;
use super::folded_swivel::{Layered, RayRun, finish_together, ray_run, two_layers_of};
use super::swivel::{SwivelCrease, SwivelKind, SwivelRegion, SwivelWedge, dot, internal, sub};
use super::swivel_valley_mountain::{
    Built, SwivelOtherEnd, SwivelShared, SwivelValleyMountain, SwivelValleyMountainAnalysis,
    covered, creases_of, ends_bare, fold_of, folds_at, folds_through,
};
use super::vertex::{Compiled, VertexChoices, VertexOutcome, cross};
use crate::fold::Within;
use crate::numerics::{MIN_FEATURE, TOL};
use crate::{
    ActionKind, CompletionLimits, Direction, FaceId, FoldActionGeometry, FoldAnalysis, FoldRefusal,
    Refused, Side, Snap, State,
};
use oristudio_geometry::{Line, convex};
use serde::{Deserialize, Serialize};
type Point = [f64; 2];

/// Two swivels by their valleys and mountains, made together (the module
/// docs), each as model-frame lines in the state they fold.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SwivelPair {
    pub swivels: [SwivelValleyMountain; 2],
}

/// The pair compiled on the folded edges it folds on.
struct Paired {
    built: [Built; 2],
    /// Per swivel, where its crease behind, its `c` and its `b` leave their paper.
    ends: [[Point; 3]; 2],
    compiled: Compiled,
    /// Per block, the swivels' wedges that move as it (`folded_swivel::Together`).
    members: Vec<Vec<[usize; 2]>>,
}

/// A swivel's three lines by index: the crease behind, `c`, `b`.
fn lines(built: &Built) -> [Point; 3] {
    [built.fan.swivel, built.fan.counter, built.fan.second]
}

impl SwivelPair {
    /// The folded edges each swivel can fold on: built on every one its
    /// lines meet on, or that swivel's refusal.
    /// Where those the lines meet on are a meeting they do not settle, the
    /// folded edges that run on through the point (`folds_through`), as a
    /// single swivel's lines are read; the meeting's refusal where none
    /// builds.
    fn candidates(swivel: &SwivelValleyMountain, state: &State) -> Result<Vec<Built>, Refused> {
        let meeting = || Refused::from(FoldRefusal::SwivelLineMeeting);
        let at = swivel
            .valley
            .intersect(&swivel.mountain)
            .ok_or_else(meeting)?;
        let folds = folds_at(state, at);
        let settled = if folds.len() > 1 && folds.iter().any(|&fold| ends_bare(state, fold, at)) {
            Err(meeting())
        } else {
            Self::built_on(swivel, state, folds)
        };
        match settled {
            Err(refused) if refused.refusal == FoldRefusal::SwivelLineMeeting => {
                Self::built_on(swivel, state, folds_through(state, at)).map_err(|_| refused)
            }
            settled => settled,
        }
    }

    /// The swivel built on each of the folded edges through the sheet points
    /// `folds`; the first refusal where none builds.
    fn built_on(
        swivel: &SwivelValleyMountain,
        state: &State,
        folds: Vec<Point>,
    ) -> Result<Vec<Built>, Refused> {
        let mut first: Option<Refused> = None;
        let mut built = Vec::new();
        for fold in folds {
            match swivel.build(state, fold) {
                Ok(b) => built.push(b),
                Err(refused) => {
                    first.get_or_insert(refused);
                }
            }
        }
        if built.is_empty() {
            return Err(first.unwrap_or_else(|| FoldRefusal::SwivelLineMeeting.into()));
        }
        Ok(built)
    }

    /// The fold compiled on the one pair of folded edges it compiles on.
    fn paired(&self, state: &State) -> Result<Paired, Refused> {
        let meeting = || Refused::from(FoldRefusal::SwivelLineMeeting);
        let [one, two] = &self.swivels;
        let (mut ones, mut twos) = (Self::candidates(one, state)?, Self::candidates(two, state)?);
        let mut first: Option<Refused> = None;
        let mut found = Vec::new();
        for (i, a) in ones.iter().enumerate() {
            for (j, b) in twos.iter().enumerate() {
                match self.compile([a, b], state) {
                    Ok(compiled) => found.push((i, j, compiled)),
                    Err(refused) => {
                        first.get_or_insert(refused);
                    }
                }
            }
        }
        match found.len() {
            1 => {
                let (i, j, (compiled, ends, members)) = found.pop().ok_or_else(meeting)?;
                Ok(Paired {
                    built: [ones.swap_remove(i), twos.swap_remove(j)],
                    ends,
                    compiled,
                    members,
                })
            }
            0 => Err(first.unwrap_or_else(meeting)),
            _ => Err(meeting()),
        }
    }

    /// The two swivels on the folded edges `built`, as one fold.
    #[allow(clippy::type_complexity)]
    fn compile(
        &self,
        built: [&Built; 2],
        state: &State,
    ) -> Result<(Compiled, [[Point; 3]; 2], Vec<Vec<[usize; 2]>>), Refused> {
        let [a, b] = built;
        let apart = sub(a.fan.vertex, b.fan.vertex);
        if apart[0].hypot(apart[1]) < MIN_FEATURE {
            return Err(FoldRefusal::SwivelLineMeeting.into());
        }
        let runs = |x: &Built| -> Result<[RayRun; 3], Refused> {
            let v = x.fan.vertex;
            Ok([
                ray_run(state, x.behind, v, x.fan.swivel)?,
                ray_run(state, x.front, v, x.fan.counter)?,
                ray_run(state, x.front, v, x.fan.second)?,
            ])
        };
        let runs = [runs(a)?, runs(b)?];
        let ends = runs.each_ref().map(|r| r.each_ref().map(|run| run.end));
        let swivels = [
            Layered {
                fan: &a.fan,
                layers: [a.behind, a.front],
                runs: &runs[0],
            },
            Layered {
                fan: &b.fan,
                layers: [b.behind, b.front],
                runs: &runs[1],
            },
        ];
        let read = two_layers_of(state, &swivels)?
            .map_err(|faces| Refused::from(FoldRefusal::FanRayBlocked { faces }))?;
        let members = read.2.clone();
        let kinds: [SwivelKind; 2] = self.swivels.each_ref().map(|s| s.kind);
        let direction = state.view().model_direction(Direction::Valley);
        let compiled = finish_together(state, &swivels, &kinds, direction, read)?;
        Ok((compiled, ends, members))
    }
}

impl Paired {
    /// The block both swivels move, and the first swivel's wedge in it.
    fn shared(&self) -> Option<(usize, usize)> {
        self.members.iter().enumerate().find_map(|(block, wedges)| {
            let both = wedges.iter().any(|w| w[0] == 0) && wedges.iter().any(|w| w[0] == 1);
            let first = wedges.iter().find(|w| w[0] == 0)?;
            both.then_some((block, first[1]))
        })
    }

    /// Which of the first swivel's creases the second's runs along, by its
    /// letter as seen, and the second's vertex; none when they share none.
    fn other_end(&self, kinds: [SwivelKind; 2]) -> Option<SwivelOtherEnd> {
        let [a, b] = &self.built;
        let line = |x: &Built, u: Point| Line::from_point_direction(x.fan.vertex, u);
        let theirs: Vec<Line> = lines(b).iter().filter_map(|&u| line(b, u)).collect();
        let shared = lines(a)
            .iter()
            .position(|&u| line(a, u).is_some_and(|l| theirs.iter().any(|t| t.approx_eq(&l))))?;
        let open = kinds[0] == SwivelKind::Open;
        let shared = match (shared, open) {
            (0, _) => SwivelShared::Behind,
            (1, true) | (2, false) => SwivelShared::Mountain,
            _ => SwivelShared::Valley,
        };
        Some(SwivelOtherEnd {
            vertex: b.fan.vertex,
            shared,
        })
    }

    /// The paper that moves, by the first swivel's wedge of each block.
    fn regions(&self, state: &State) -> Vec<SwivelRegion> {
        let names = [SwivelWedge::Near, SwivelWedge::Turn, SwivelWedge::Beyond];
        let scoring = &self.compiled.scoring;
        self.compiled
            .block_of
            .iter()
            .enumerate()
            .filter_map(|(p, block)| {
                let wedge = self.members.get((*block)?)?.first()?[1];
                let t = state.geometry().isometries[scoring.old[p]];
                let mut polygon: Vec<Point> =
                    scoring.polygon(p).into_iter().map(|q| t.apply(q)).collect();
                if !t.front_up() {
                    polygon.reverse();
                }
                Some(SwivelRegion {
                    wedge: names[wedge.min(2)],
                    polygon,
                })
            })
            .collect()
    }

    /// The parent's faces that move.
    fn moving(&self, state: &State) -> Vec<FaceId> {
        let mut moving: Vec<FaceId> = self
            .compiled
            .block_of
            .iter()
            .enumerate()
            .filter(|(_, b)| b.is_some())
            .map(|(p, _)| state.faces()[self.compiled.scoring.old[p]].id)
            .collect();
        moving.sort_unstable();
        moving.dedup();
        moving
    }

    /// Both swivels' creases as a tool previews them: the first's, then the
    /// second's but the one they share. A crease behind that both share is
    /// hidden from each end as far as that end's layer in front covers it.
    fn creases(&self, state: &State, kinds: [SwivelKind; 2]) -> Vec<SwivelCrease> {
        let [a, b] = &self.built;
        let mut creases = creases_of(state, a, self.ends[0], kinds[0]);
        let along = |c: &SwivelCrease, d: &SwivelCrease| {
            let on = |p: Point| cross(c.direction, sub(p, c.from)).abs() <= TOL;
            cross(c.direction, d.direction).abs() <= TOL && on(d.from) && on(d.to)
        };
        let theirs = creases_of(state, b, self.ends[1], kinds[1]);
        let behind_shared =
            matches!(self.other_end(kinds), Some(end) if end.shared == SwivelShared::Behind);
        if behind_shared {
            // The crease behind, from the first vertex to the second: hidden
            // at each end under that end's layer in front.
            let (v, w) = (a.fan.vertex, b.fan.vertex);
            let u = a.fan.swivel;
            let length = dot(sub(w, v), u);
            let near = covered(state, a.front, v, u).min(length);
            let far = covered(state, b.front, w, [-u[0], -u[1]]).min(length - near);
            let at = |s: f64| [v[0] + s * u[0], v[1] + s * u[1]];
            let template = creases[0].clone();
            let piece = |from: f64, to: f64, hidden: bool| SwivelCrease {
                from: at(from),
                to: at(to),
                hidden,
                ..template.clone()
            };
            // `creases_of` lists the crease behind first, in one or two
            // pieces, then the two named ones.
            creases.drain(0..creases.len().saturating_sub(2));
            let mut behind = vec![piece(0.0, near, true)];
            if length - far - near > TOL {
                behind.push(piece(near, length - far, false));
            }
            if far > TOL {
                behind.push(piece(length - far, length, true));
            }
            creases.splice(0..0, behind);
        }
        // The second's, but any along one of the first's: the one they share.
        let first = creases.len();
        for crease in theirs {
            if !creases[..first].iter().any(|c| along(c, &crease)) {
                creases.push(crease);
            }
        }
        creases
    }
}

impl State {
    /// Two swivels made together, before they fold: both swivels' creases
    /// with their letters as seen (the one they share once), the four layers
    /// (each swivel's in front first), the paper that moves, the first's
    /// folded edge, and as `other_end` the second's vertex and the crease the
    /// two share.
    pub fn analyse_swivel_pair(
        &self,
        op: &SwivelPair,
    ) -> Result<SwivelValleyMountainAnalysis, Refused> {
        let paired = op.paired(self)?;
        let kinds = op.swivels.each_ref().map(|s| s.kind);
        let mut layers: Vec<FaceId> = Vec::new();
        for built in &paired.built {
            for f in [built.front, built.behind] {
                let id = self.faces()[f].id;
                if !layers.contains(&id) {
                    layers.push(id);
                }
            }
        }
        Ok(SwivelValleyMountainAnalysis {
            vertex: paired.built[0].fan.vertex,
            creases: paired.creases(self, kinds),
            layers,
            regions: paired.regions(self),
            fold: fold_of(self, &paired.built[0])?,
            other_end: paired.other_end(kinds),
        })
    }

    pub fn swivel_pair(
        &self,
        op: &SwivelPair,
        choices: &VertexChoices,
    ) -> Result<VertexOutcome, CompoundRefused> {
        self.swivel_pair_within(op, choices, &CompletionLimits::default())
    }

    /// Landed, or refused (the module docs); each order a choice offers is
    /// landed before it is offered.
    pub fn swivel_pair_within(
        &self,
        op: &SwivelPair,
        choices: &VertexChoices,
        limits: &CompletionLimits,
    ) -> Result<VertexOutcome, CompoundRefused> {
        op.paired(self)
            .map_err(CompoundRefused::Refused)?
            .compiled
            .land_checked(self, choices, limits, || None, true)
    }

    /// The picture of two swivels made together, with `landed`'s cover at the
    /// arrow's head when it is given: the crease they share, with the arrow
    /// from the paper both move across it — the strip folding up across the
    /// valley, or the layer behind across the crease behind. Two swivels that
    /// share no paper are drawn as the first.
    pub fn swivel_pair_action(
        &self,
        op: &SwivelPair,
        landed: Option<&State>,
    ) -> Result<FoldActionGeometry, Refused> {
        let paired = op.paired(self)?;
        let Some((block, wedge)) = paired.shared().filter(|&(_, w)| w != 1) else {
            return self.swivel_valley_mountain_action(&op.swivels[0], landed);
        };
        let fan = &paired.built[0].fan;
        // Across the crease behind, the layer behind folds toward the viewer,
        // as the preview letters it; across the hinge, as the kind folds it.
        let (along, seen) = if wedge == 0 {
            (fan.swivel, Direction::Valley)
        } else {
            let seen = match op.swivels[0].kind {
                SwivelKind::Open => Direction::Valley,
                SwivelKind::Inside => Direction::Mountain,
            };
            (fan.second, seen)
        };
        let line = Line::from_point_direction(fan.vertex, along)
            .ok_or_else(|| internal("a shared crease has no line"))?;
        let scoring = &paired.compiled.scoring;
        let reach: Vec<Vec<Point>> = paired
            .compiled
            .block_of
            .iter()
            .enumerate()
            .filter(|(_, b)| **b == Some(block))
            .map(|(p, _)| {
                let t = self.geometry().isometries[scoring.old[p]];
                scoring.polygon(p).into_iter().map(|q| t.apply(q)).collect()
            })
            .collect();
        let side = reach
            .iter()
            .filter_map(|r| convex::centroid(r))
            .find_map(|p| Side::of_point(&line, p))
            .ok_or_else(|| internal("a shared strip has no side"))?;
        self.fold_action_within(
            &FoldAnalysis {
                line,
                side,
                snap: Snap::NONE,
                direction: self.view().model_direction(seen),
                flaps: vec![],
                picked: vec![],
                added: vec![],
                moving: paired.moving(self),
            },
            ActionKind::Fold,
            landed,
            Within {
                ray: Some((fan.vertex, along)),
                reach: Some(&reach),
            },
        )
    }
}
