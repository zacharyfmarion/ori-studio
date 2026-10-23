//! The swivel on a folded edge by its valley and its mountain: the swivel as
//! folders diagram it.
//!
//! # In a folder's words
//!
//! *On the layer you see, the flap is bounded by a valley and a mountain
//! that meet at a point on the folded edge; squash the flap down, and the
//! layer behind creases along a third line.* Two layers are joined along a
//! folded edge `h`. On the one that faces the viewer, a valley and a mountain
//! leave a point `V` of `h`, both into the paper. The folder names those two
//! lines, nothing else: no edge, no target, no layer, no direction. The
//! letters are the viewer's, so the swivel always folds toward the viewer: a
//! swivel whose pair lies on the layer behind is made by turning the model
//! over first.
//!
//! # The creases
//!
//! These are the creases of [`super::swivel_on_edge`]'s swivel, named from
//! the other side. That swivel creases the layer of the edge that moves along
//! `s` alone and the other layer twice: along `c`, where the paper on the half
//! of `h` that opens leaves it, and along `b`, the other layer's hinge. Every
//! swivel that lands has the other layer on the direction's side of the
//! edge's (that module's docs), so the other layer is the one the viewer sees,
//! and its `c` and `b` are the two lines the folder names:
//!
//! - **open**: its strip between `c` and `b` folds up over the rest of its
//!   layer across the hinge `b`, a valley, and `c` folds the other way, a
//!   mountain;
//! - **inside**: the strip tucks under, into the pocket between the two
//!   layers, across `b`, now a mountain, and `c` is a valley.
//!
//! So the kind says which of the two lines is the hinge. In signed angles
//! from the half of `h` that opens, material continuity — `R_s R_h R_c = R_b`
//! round `V` — gives the crease on the layer behind, `s = b − c`, and the half
//! that opens is the one `c` lies nearer, `c` between it and `b`. With `c`,
//! `b` and `s` the flat-swivel compiler ([`super::folded_swivel`]) scores and
//! lands the fold exactly as it lands the edge-onto-line swivel, the case `c
//! = s`, `b = 2s`; its scoring, order and validity gates are shared.
//!
//! The layer behind needs no guess: it is the folded edge's other face. The
//! crease there is hidden behind the layer in front as far as that layer
//! reaches along it, and a tool draws it dotted there, as a diagram does.
//!
//! **Refusals** (plan D14): lines that meet on no folded edge the viewer
//! sees, or on several stacked ones, or too near the end of one
//! (`swivel_line_meeting`); a line along the folded edge, or the two along
//! one line, which bound no flap (`swivel_no_flap`); a crease that runs into
//! a fold before the paper's edge, or paper joining two wedges
//! (`fan_ray_blocked`); and no order (`no_order`). The swivel has no other
//! direction to offer: folded away from the viewer its two letters would be
//! the other way round, which is the same lines picked the other way.
use super::CompoundRefused;
use super::folded_swivel::{FoldCompiled, FoldFan, compile, flat_region};
use super::swivel::{
    SwivelCrease, SwivelFold, SwivelKind, SwivelRay, SwivelRegion, SwivelWedge, dot, edge_run,
    internal, sub,
};
use super::vertex::{VertexChoices, VertexOutcome, angle_between, cross, rotate, unit};
use crate::fold::Within;
use crate::numerics::{MIN_FEATURE, TOL};
use crate::{
    ActionKind, CompletionLimits, CreaseKind, Direction, FaceId, FoldActionGeometry, FoldAnalysis,
    FoldRefusal, Letter, Refused, Side, Snap, State,
};
use oristudio_geometry::{Line, convex};
use serde::{Deserialize, Serialize};
type Point = [f64; 2];

/// A swivel on a folded edge named by the two creases it makes on the layer
/// that faces the viewer, as model-frame lines in the state it folds (the
/// module docs). Neither needs to be a crease already.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SwivelValleyMountain {
    pub valley: Line,
    pub mountain: Line,
    pub kind: SwivelKind,
}

/// A swivel by its valley and mountain before it folds: what a tool previews.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SwivelValleyMountainAnalysis {
    /// Where the creases meet, on the folded edge, in the parent's model frame.
    pub vertex: Point,
    /// The crease on the layer behind (`meet`, split where the layer in front
    /// stops hiding it), then the front layer's `c` (`meet`) and its hinge
    /// `b` (`hinge`), each by its letter as the viewer sees it.
    pub creases: Vec<SwivelCrease>,
    /// The two layers the folded edge joins, the one in front first.
    pub layers: Vec<FaceId>,
    pub regions: Vec<SwivelRegion>,
    pub fold: SwivelFold,
}

/// A folded run may be subdivided by flat precreases at the meeting point.
/// Resolve that same material run, never a different fold through the vertex.
fn fold_support(state: &State, point: Point) -> Option<(usize, Point)> {
    let mut found: Option<(usize, Point, Line)> = None;
    for (k, crease) in state.creases().iter().enumerate() {
        if !matches!(crease.kind, CreaseKind::Folded(_)) {
            continue;
        }
        let [a, b] = crease.vertices.map(|v| state.vertices()[v.0 as usize]);
        let line = Line::from_points(a, b)?;
        let d = sub(b, a);
        let len = dot(d, d).sqrt();
        let along = dot(sub(point, a), d) / len;
        if line.distance_to_point(point) > TOL || along < -TOL || along > len + TOL {
            continue;
        }
        if let Some((_, _, prior)) = found {
            if prior.distance_to_point(a) > TOL || prior.distance_to_point(b) > TOL {
                return None;
            }
        } else {
            found = Some((k, [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0], line));
        }
    }
    found.map(|(k, p, _)| (k, p))
}

/// The sheet point of the folded edge the viewer sees at the model point
/// `v`: a bend segment through `v`, away from its ends (or at one exactly, a
/// flat precrease's subdivision), visible there. Several stacked edges that
/// name different paper are refused, never one silently picked.
fn seen_fold_at(state: &State, v: Point) -> Result<Point, Refused> {
    let refused = || Refused::from(FoldRefusal::SwivelLineMeeting);
    let landmarks = state.landmarks(&[]);
    let mut fold: Option<Point> = None;
    for edge in &landmarks.segments {
        if edge.kind != crate::SegmentKind::Bend {
            continue;
        }
        let [a, b] = edge.at;
        let d = sub(b, a);
        let len2 = dot(d, d);
        let len = len2.sqrt();
        if len < MIN_FEATURE {
            continue;
        }
        let t = dot(sub(v, a), d) / len2;
        let q = [a[0] + t * d[0], a[1] + t * d[1]];
        let inside = t * len > MIN_FEATURE && (1.0 - t) * len > MIN_FEATURE;
        let at_end = (t * len).abs() <= TOL || ((1.0 - t) * len).abs() <= TOL;
        let seen = edge
            .visible
            .iter()
            .any(|[lo, hi]| t >= *lo - TOL && t <= *hi + TOL);
        if sub(v, q)[0].hypot(sub(v, q)[1]) > TOL || !(inside || at_end) || !seen {
            continue;
        }
        let candidate = edge.sheet.at(t);
        match fold {
            Some(p) if sub(candidate, p)[0].hypot(sub(candidate, p)[1]) > TOL => {
                return Err(refused());
            }
            Some(_) => {}
            None => fold = Some(candidate),
        }
    }
    fold.ok_or_else(refused)
}

/// How far from `from` along the unit direction `u` the layer of face
/// `layer` covers the line without a gap: the reach of the chords its
/// flat-connected faces' images cut, joined end to end from `from`.
fn covered(state: &State, layer: usize, from: Point, u: Point) -> f64 {
    let images = &state.geometry().images;
    let chords: Vec<[f64; 2]> = flat_region(state, layer)
        .into_iter()
        .enumerate()
        .filter(|&(_, belongs)| belongs)
        .filter_map(|(f, _)| chord(&images[f], from, u))
        .collect();
    let mut reach = 0.0;
    loop {
        let grown = chords
            .iter()
            .filter(|[lo, hi]| *lo <= reach + TOL && *hi > reach + TOL)
            .map(|[_, hi]| *hi)
            .fold(reach, f64::max);
        if grown <= reach {
            return reach;
        }
        reach = grown;
    }
}

/// The stretch of the line through `from` along `u` inside a convex ring, as
/// distances along `u`; none when the line misses it.
fn chord(ring: &[Point], from: Point, u: Point) -> Option<[f64; 2]> {
    let n = ring.len();
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        let (da, db) = (cross(u, sub(a, from)), cross(u, sub(b, from)));
        let mut take = |p: Point| {
            let t = dot(u, sub(p, from));
            lo = lo.min(t);
            hi = hi.max(t);
        };
        if da.abs() <= TOL {
            take(a);
        }
        if da > TOL && db < -TOL || da < -TOL && db > TOL {
            let s = da / (da - db);
            take([a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])]);
        }
    }
    (hi - lo > TOL).then_some([lo, hi])
}

/// A swivel by its valley and mountain resolved in its parent: its fan and
/// which of the folded edge's two faces is in front.
struct Built {
    fan: FoldFan,
    /// The face that faces the viewer, which takes the named creases, and
    /// the one behind, which creases along the computed one.
    front: usize,
    behind: usize,
}

impl SwivelValleyMountain {
    fn build(&self, state: &State) -> Result<Built, Refused> {
        let meeting = || Refused::from(FoldRefusal::SwivelLineMeeting);
        let at = self.valley.intersect(&self.mountain).ok_or_else(meeting)?;
        let fold = seen_fold_at(state, at)?;
        let (k, support) = fold_support(state, fold).ok_or_else(meeting)?;
        let faces = match state.topology().crease_faces[k][..] {
            [a, b] => [a, b],
            _ => return Err(internal("a folded edge needs two faces")),
        };
        let ids = || faces.map(|f| state.faces()[f].id).to_vec();
        let v = state
            .resolve_point(fold)
            .ok_or_else(|| Refused::from(FoldRefusal::WitnessNotInFace { point: fold }))?;
        let run = edge_run(state, support)?;
        let fold_line = Line::from_points(run.ends[0], run.ends[1])
            .ok_or_else(|| internal("a folded edge has no line"))?;
        if run
            .ends
            .iter()
            .any(|p| sub(*p, v)[0].hypot(sub(*p, v)[1]) < MIN_FEATURE)
        {
            return Err(meeting());
        }
        // Each crease runs from V into the half-plane the two layers lie in.
        let no_flap = || Refused::from(FoldRefusal::SwivelNoFlap { faces: ids() });
        let paper = convex::centroid(&state.geometry().images[faces[0]])
            .ok_or_else(|| internal("a layer has no centroid"))?;
        let side = Side::of_point(&fold_line, paper).ok_or_else(no_flap)?;
        let into = |line: &Line| -> Option<Point> {
            let u = unit(line.direction())?;
            [u, [-u[0], -u[1]]]
                .into_iter()
                .find(|d| Side::of_point(&fold_line, [v[0] + d[0], v[1] + d[1]]) == Some(side))
        };
        let valley = into(&self.valley).ok_or_else(no_flap)?;
        let mountain = into(&self.mountain).ok_or_else(no_flap)?;
        // The kind says which named line is the front layer's hinge.
        let (counter, second) = match self.kind {
            SwivelKind::Open => (mountain, valley),
            SwivelKind::Inside => (valley, mountain),
        };
        let h = fold_line.direction();
        let (opens, swivel) = [h, [-h[0], -h[1]]]
            .into_iter()
            .find_map(|opens| {
                let c = angle_between(opens, counter);
                let b = angle_between(opens, second);
                let between = c * b > 0.0
                    && c.abs() > 1e-9
                    && b.abs() > c.abs() + 1e-9
                    && b.abs() < std::f64::consts::PI - 1e-9;
                between.then(|| (opens, rotate(opens, b - c)))
            })
            .ok_or_else(no_flap)?;
        let front = front_face(state, faces, v, side, &fold_line)?;
        let behind = if front == faces[0] {
            faces[1]
        } else {
            faces[0]
        };
        Ok(Built {
            fan: FoldFan {
                vertex: v,
                fold_line,
                fold_run: run.ends,
                run: run.creases,
                faces,
                opens,
                stays: [-opens[0], -opens[1]],
                swivel,
                counter,
                second,
            },
            front,
            behind,
        })
    }

    /// The fold compiled: the layer behind is the edge's, creased along the
    /// computed crease; the direction the viewer's valley.
    fn compiled(&self, state: &State, built: &Built) -> Result<FoldCompiled, Refused> {
        let direction = state.view().model_direction(Direction::Valley);
        compile(state, &built.fan, built.behind, direction, self.kind)
    }
}

/// Which of the folded edge's two faces the viewer sees in front: by their
/// order, or where that names no pair, by the stack just inside the paper at
/// the vertex.
fn front_face(
    state: &State,
    faces: [usize; 2],
    v: Point,
    side: Side,
    fold_line: &Line,
) -> Result<usize, Refused> {
    let [a, b] = faces;
    let id = |f: usize| state.faces()[f].id;
    if let Some(seen) = state.seen_above(id(a), id(b)) {
        return Ok(if seen { a } else { b });
    }
    let n = fold_line.n;
    let sign = if side == Side::Positive { 1.0 } else { -1.0 };
    let probe = [
        v[0] + sign * n[0] * MIN_FEATURE,
        v[1] + sign * n[1] * MIN_FEATURE,
    ];
    let stack = state
        .stack_at(probe)
        .ok_or_else(|| internal("the layers at a folded edge have no order"))?;
    let seen_top_first = !state.view().flipped;
    let ordered: Vec<FaceId> = if seen_top_first {
        stack
    } else {
        stack.into_iter().rev().collect()
    };
    ordered
        .into_iter()
        .find_map(|f| [a, b].into_iter().find(|&g| id(g) == f))
        .ok_or_else(|| internal("the folded edge's layers are not at its vertex"))
}

impl State {
    /// A swivel by its valley and mountain before it folds (the module docs):
    /// its vertex, its creases with their letters as seen — the one behind
    /// split where it is hidden — its layers, the paper that moves and the
    /// folded edge.
    pub fn analyse_swivel_valley_mountain(
        &self,
        op: &SwivelValleyMountain,
    ) -> Result<SwivelValleyMountainAnalysis, Refused> {
        let built = op.build(self)?;
        let reading = op.compiled(self, &built)?;
        let fan = &built.fan;
        let v = fan.vertex;
        let inside = op.kind == SwivelKind::Inside;
        let [behind_to, counter_to, second_to] = reading.ends;
        let crease = |ray, direction, from, to, letter, ridge, hidden| SwivelCrease {
            ray,
            direction,
            from,
            to,
            letter,
            ridge,
            hidden,
        };
        // The layer in front hides the crease behind as far as it reaches.
        let length = dot(sub(behind_to, v), fan.swivel);
        let hidden_to = covered(self, built.front, v, fan.swivel).min(length);
        let split = [
            v[0] + hidden_to * fan.swivel[0],
            v[1] + hidden_to * fan.swivel[1],
        ];
        let mut creases = vec![crease(
            SwivelRay::Meet,
            fan.swivel,
            v,
            split,
            Letter::Valley,
            false,
            true,
        )];
        if length - hidden_to > TOL {
            creases.push(crease(
                SwivelRay::Meet,
                fan.swivel,
                split,
                behind_to,
                Letter::Valley,
                false,
                false,
            ));
        }
        let (counter_letter, second_letter) = if inside {
            (Letter::Valley, Letter::Mountain)
        } else {
            (Letter::Mountain, Letter::Valley)
        };
        creases.push(crease(
            SwivelRay::Meet,
            fan.counter,
            v,
            counter_to,
            counter_letter,
            !inside,
            false,
        ));
        creases.push(crease(
            SwivelRay::Hinge,
            fan.second,
            v,
            second_to,
            second_letter,
            inside,
            false,
        ));
        let end = fan
            .fold_run
            .into_iter()
            .max_by(|a, b| dot(sub(*a, v), fan.opens).total_cmp(&dot(sub(*b, v), fan.opens)))
            .ok_or_else(|| internal("no fold end"))?;
        Ok(SwivelValleyMountainAnalysis {
            vertex: v,
            creases,
            layers: vec![self.faces()[built.front].id, self.faces()[built.behind].id],
            regions: super::swivel_on_edge::on_fold_regions(self, &reading),
            fold: SwivelFold {
                edge: fan.fold_run,
                opens: [v, end],
                faces: fan.ids(self),
            },
        })
    }

    pub fn swivel_valley_mountain(
        &self,
        op: &SwivelValleyMountain,
        choices: &VertexChoices,
    ) -> Result<VertexOutcome, CompoundRefused> {
        self.swivel_valley_mountain_within(op, choices, &CompletionLimits::default())
    }

    /// Landed, or refused (the module docs). A refusal for want of an order
    /// offers no other direction: the swivel has none.
    pub fn swivel_valley_mountain_within(
        &self,
        op: &SwivelValleyMountain,
        choices: &VertexChoices,
        limits: &CompletionLimits,
    ) -> Result<VertexOutcome, CompoundRefused> {
        let built = op.build(self).map_err(CompoundRefused::Refused)?;
        let reading = op
            .compiled(self, &built)
            .map_err(CompoundRefused::Refused)?;
        reading.compiled.land(self, choices, limits, || None)
    }

    /// The picture of a swivel by its valley and mountain, with `landed`'s
    /// cover at the arrow's head when it is given: the front layer's hinge
    /// from the vertex, and the arrow from the strip that folds across it.
    pub fn swivel_valley_mountain_action(
        &self,
        op: &SwivelValleyMountain,
        landed: Option<&State>,
    ) -> Result<FoldActionGeometry, Refused> {
        let built = op.build(self)?;
        let reading = op.compiled(self, &built)?;
        let regions = super::swivel_on_edge::on_fold_regions(self, &reading);
        let reach: Vec<_> = regions
            .iter()
            .filter(|r| r.wedge == SwivelWedge::Beyond)
            .map(|r| r.polygon.clone())
            .collect();
        let line = built.fan.second_line()?;
        let side = reach
            .iter()
            .filter_map(|r| convex::centroid(r))
            .find_map(|p| Side::of_point(&line, p))
            .ok_or_else(|| internal("a swivel's strip has no side"))?;
        let mut moving: Vec<_> = reading
            .compiled
            .block_of
            .iter()
            .enumerate()
            .filter(|(_, b)| b.is_some())
            .map(|(p, _)| self.faces()[reading.compiled.scoring.old[p]].id)
            .collect();
        moving.sort_unstable();
        moving.dedup();
        // The strip folds across the hinge toward the viewer when it is
        // open, into the pocket away from the viewer when it is inside.
        let seen = match op.kind {
            SwivelKind::Open => Direction::Valley,
            SwivelKind::Inside => Direction::Mountain,
        };
        self.fold_action_within(
            &FoldAnalysis {
                line,
                side,
                snap: Snap::NONE,
                direction: self.view().model_direction(seen),
                flaps: vec![],
                picked: vec![],
                added: vec![],
                moving,
            },
            ActionKind::Fold,
            landed,
            Within {
                ray: Some((built.fan.vertex, built.fan.second)),
                reach: Some(&reach),
            },
        )
    }
}
