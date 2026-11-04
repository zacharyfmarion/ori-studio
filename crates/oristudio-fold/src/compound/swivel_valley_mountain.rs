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
//! **Where the lines meet.** On a folded edge the viewer sees, or — where
//! none is in view there — one hidden under a layer whose raw edge runs along
//! it. Where several meet there (the folded edges of two flaps that abut
//! along one line), the swivel folds on the one it can fold on.
//! Where the folded edges there end instead — the corner where a flap's two
//! hinges end — the lines turn that flap about it
//! ([`super::swivel_hinge_end`]). Where they turn no flap either, the swivel
//! folds on the one folded edge there that runs on through the point and
//! compiles: of those in view, or where every one in view ends there (paper
//! on a raw edge covering the fold), the hidden ones. A ply that ends there
//! bare beside a fold that runs on is the paper's edge, not a hinge.
//!
//! **Through the stack.** Paper beyond the two layers that holds the wedges
//! is creased along the same rays or carried (`super::folded_swivel`).
//!
//! **Refusals** (plan D14): lines that meet on no folded edge, or too near
//! the end of one, or on several the swivel can fold on, and turn no flap
//! about the end of its hinges either (`swivel_line_meeting`); a line along
//! the folded edge, or the two along one line, which bound no flap
//! (`swivel_no_flap`); paper whose motion no assignment of the swivel's
//! four agrees with (`fan_ray_blocked`); and no order (`no_order`). The
//! swivel has no other direction to offer: folded away from the viewer its
//! two letters would be the other way round, which is the same lines picked
//! the other way.
use super::CompoundRefused;
use super::folded_swivel::{FoldCompiled, FoldFan, compile, flat_region, ray_run};
use super::swivel::{
    SwivelCrease, SwivelFold, SwivelKind, SwivelRay, SwivelRegion, SwivelWedge, dot, edge_run,
    internal, sub,
};
use super::swivel_hinge_end::HingeEnd;
use super::vertex::{VertexChoices, VertexOutcome, angle_between, cross, rotate, unit};
use crate::fold::Within;
use crate::numerics::{MIN_FEATURE, TOL};
use crate::{
    ActionKind, CompletionLimits, CreaseKind, Direction, FaceId, FoldActionGeometry, FoldAnalysis,
    FoldRefusal, Landmarks, Letter, Refused, Side, Snap, State,
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
    /// The other end of a crease this swivel can share with a second one
    /// (`super::swivel_pair`): where its hinge, its other named crease or
    /// the crease behind runs on to another folded edge. For a pair, the
    /// second swivel's vertex and the crease the two share. None when no
    /// crease of a swivel on a folded edge runs on to another one, and for a
    /// flap turned about the end of its hinges.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub other_end: Option<SwivelOtherEnd>,
}

/// Which of a swivel's creases another swivel shares: one of the two named
/// on the layer in front, by its letter as seen, or the crease behind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SwivelShared {
    Valley,
    Mountain,
    Behind,
}

/// Where a swivel's crease ends on another folded edge, and which crease it
/// is: the other end, where a second swivel can share it.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct SwivelOtherEnd {
    /// On the other folded edge, in the parent's model frame.
    pub vertex: Point,
    pub shared: SwivelShared,
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

/// How far past the end of a visible part of a folded edge a point is still
/// in view. The landmarks measure a visible part on the edge moved a probe
/// into its face, so where the edge of a layer on top crosses the folded edge
/// at the angle θ, the part ends `PROBE·cot θ` short of the crossing. They
/// see the crossing itself, the corner the two make, within the half minimum
/// feature the parts are resolved to (`landmarks::crossing_seen`), so a tool
/// offers it as a point to pick; the swivel meets there within the same.
const SEEN_SLACK: f64 = MIN_FEATURE / 2.0;

/// The sheet points of the folded edges the lines can meet on at the model
/// point `v`: a bend segment through `v`, away from its ends (or at one
/// exactly, a flat precrease's subdivision), visible there. A point on no
/// visible part is taken where one ends within [`SEEN_SLACK`] of it: a
/// layer's edge crossing the folded edge there, the corner in view. Where no
/// folded edge is in view at `v` — one lies under a layer that covers it, its
/// raw edge along the fold — the hidden ones through `v`. Several, each
/// naming different paper (the folded edges of two flaps that abut along one
/// line), are all returned, the one the swivel can fold picked by
/// [`SwivelValleyMountain::reading`], never one silently.
pub(super) fn folds_at(state: &State, v: Point) -> Vec<Point> {
    let landmarks = state.landmarks(&[]);
    let seen = seen_fold_within(&landmarks, v, |_| TOL, true);
    if !seen.is_empty() {
        return seen;
    }
    let near = seen_fold_within(&landmarks, v, |length| SEEN_SLACK / length, true);
    if !near.is_empty() {
        return near;
    }
    seen_fold_within(&landmarks, v, |_| TOL, false)
}

/// Whether the folded edge through the sheet point `fold` ends at the model
/// point `v` with nothing straight on past it: no flat crease continues its
/// run on the sheet from there.
pub(super) fn ends_bare(state: &State, fold: Point, v: Point) -> bool {
    let Some((_, support)) = fold_support(state, fold) else {
        return false;
    };
    let Ok(run) = edge_run(state, support) else {
        return false;
    };
    let near = |p: Point, q: Point| sub(p, q)[0].hypot(sub(p, q)[1]) < MIN_FEATURE;
    let Some(end) = (0..2).find(|&i| near(run.ends[i], v)) else {
        return false;
    };
    let (tip, back) = (run.sheet[end], run.sheet[1 - end]);
    let ahead = sub(tip, back);
    let sheet = state.vertices();
    !state.creases().iter().any(|c| {
        if !matches!(c.kind, CreaseKind::Flat(_)) {
            return false;
        }
        let [a, b] = c.vertices.map(|w| sheet[w.0 as usize]);
        let other = if near(a, tip) {
            b
        } else if near(b, tip) {
            a
        } else {
            return false;
        };
        let d = sub(other, tip);
        cross(ahead, d).abs() <= TOL * ahead[0].hypot(ahead[1]) && dot(ahead, d) > 0.0
    })
}

/// The folded edges a swivel can fold on where [`folds_at`]'s meeting does
/// not settle (several folds meet at `v` and one ends bare there, or every
/// one ends there): of those, the ones whose run passes on through `v`, its
/// ends at least a minimum feature away; where no fold in view does, the
/// hidden ones that do. The sheet points, one per paper they name.
pub(super) fn folds_through(state: &State, v: Point) -> Vec<Point> {
    let through = |fold: &Point| {
        fold_support(state, *fold)
            .and_then(|(_, support)| edge_run(state, support).ok())
            .is_some_and(|run| {
                run.ends
                    .iter()
                    .all(|p| sub(*p, v)[0].hypot(sub(*p, v)[1]) >= MIN_FEATURE)
            })
    };
    let seen: Vec<Point> = folds_at(state, v).into_iter().filter(through).collect();
    if !seen.is_empty() {
        return seen;
    }
    let landmarks = state.landmarks(&[]);
    seen_fold_within(&landmarks, v, |_| TOL, false)
        .into_iter()
        .filter(through)
        .collect()
}

/// [`folds_at`] with a visible part reaching `slack(length)` past its ends,
/// as a fraction of the edge's length, or any part when `visible` is false:
/// the folded edges' sheet points, one per paper they name.
fn seen_fold_within(
    landmarks: &Landmarks,
    v: Point,
    slack: impl Fn(f64) -> f64,
    visible: bool,
) -> Vec<Point> {
    let mut folds: Vec<Point> = Vec::new();
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
        let slack = slack(len);
        let seen = !visible
            || edge
                .visible
                .iter()
                .any(|[lo, hi]| t >= *lo - slack && t <= *hi + slack);
        if sub(v, q)[0].hypot(sub(v, q)[1]) > TOL || !(inside || at_end) || !seen {
            continue;
        }
        let candidate = edge.sheet.at(t);
        if !folds
            .iter()
            .any(|p| sub(candidate, *p)[0].hypot(sub(candidate, *p)[1]) <= TOL)
        {
            folds.push(candidate);
        }
    }
    folds
}

/// How far from `from` along the unit direction `u` the layer of face
/// `layer` covers the line without a gap: the reach of the chords its
/// flat-connected faces' images cut, joined end to end from `from`.
pub(super) fn covered(state: &State, layer: usize, from: Point, u: Point) -> f64 {
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

/// What a swivel by its valley and mountain names in its parent.
enum Reading {
    /// A swivel on the folded edge its lines meet on.
    OnEdge(Box<(Built, FoldCompiled)>),
    /// A flap turned about the end of its hinges.
    HingeEnd(Box<HingeEnd>),
}

/// A swivel by its valley and mountain resolved in its parent: its fan and
/// which of the folded edge's two faces is in front.
pub(super) struct Built {
    pub(super) fan: FoldFan,
    /// The face that faces the viewer, which takes the named creases, and
    /// the one behind, which creases along the computed one.
    pub(super) front: usize,
    pub(super) behind: usize,
}

impl SwivelValleyMountain {
    /// What the lines name: a swivel on the folded edge they meet on, or,
    /// where they meet at the end of the folded edges there, a flap turned
    /// about the corner where its hinges end. Neither, with the folded edge's
    /// refusal.
    fn reading(&self, state: &State) -> Result<Reading, Refused> {
        match self.on_edge(state) {
            Ok((built, compiled)) => Ok(Reading::OnEdge(Box::new((built, compiled)))),
            Err(refused) if refused.refusal == FoldRefusal::SwivelLineMeeting => {
                match HingeEnd::reading(state, &self.valley, &self.mountain, self.kind)? {
                    Some(turn) => Ok(Reading::HingeEnd(Box::new(turn))),
                    None => match self.through(state) {
                        Some(found) => Ok(Reading::OnEdge(Box::new(found))),
                        None => Err(refused),
                    },
                }
            }
            Err(refused) => Err(refused),
        }
    }

    /// The swivel on a folded edge the lines meet on: of the folded edges
    /// there ([`folds_at`]), the one it can fold on. Several that it can fold
    /// on are refused as a meeting the lines do not settle
    /// (`swivel_line_meeting`); none, with the first one's refusal.
    fn on_edge(&self, state: &State) -> Result<(Built, FoldCompiled), Refused> {
        let meeting = || Refused::from(FoldRefusal::SwivelLineMeeting);
        let at = self.valley.intersect(&self.mountain).ok_or_else(meeting)?;
        let folds = folds_at(state, at);
        // A folded edge that ends where the lines meet, with no paper beyond
        // (the end of a flap's hinge), is not one the swivel folds on; but
        // the lines may name it, so another folded edge there does not
        // settle the meeting. One that ends there only because a fold
        // opened past it (a flat crease runs on) is passed over.
        if folds.len() > 1 && folds.iter().any(|&fold| ends_bare(state, fold, at)) {
            return Err(meeting());
        }
        self.on_one_of(state, folds)
    }

    /// Where the meeting rule refuses and the lines turn no flap about the
    /// end of its hinges: the swivel on a folded edge that runs on through
    /// the point they meet at ([`folds_through`]), where exactly one compiles.
    /// None otherwise, so the meeting's refusal stands.
    fn through(&self, state: &State) -> Option<(Built, FoldCompiled)> {
        let at = self.valley.intersect(&self.mountain)?;
        self.on_one_of(state, folds_through(state, at)).ok()
    }

    /// Of the folded edges through the sheet points `folds`, the one the
    /// swivel compiles on; several are a meeting the lines do not settle.
    fn on_one_of(
        &self,
        state: &State,
        folds: Vec<Point>,
    ) -> Result<(Built, FoldCompiled), Refused> {
        let meeting = || Refused::from(FoldRefusal::SwivelLineMeeting);
        let mut first: Option<Refused> = None;
        let mut found: Vec<(Built, FoldCompiled)> = Vec::new();
        for fold in folds {
            match self
                .build(state, fold)
                .and_then(|built| self.compiled(state, &built).map(|c| (built, c)))
            {
                Ok(reading) => found.push(reading),
                Err(refused) => {
                    first.get_or_insert(refused);
                }
            }
        }
        match found.len() {
            1 => found.pop().ok_or_else(meeting),
            0 => Err(first.unwrap_or_else(meeting)),
            _ => Err(meeting()),
        }
    }

    /// The swivel resolved on the folded edge through the sheet point `fold`.
    pub(super) fn build(&self, state: &State, fold: Point) -> Result<Built, Refused> {
        let meeting = || Refused::from(FoldRefusal::SwivelLineMeeting);
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

/// A swivel's creases as a tool previews them (the analysis' `creases`): the
/// crease behind, split where the layer in front hides it, then the front
/// layer's `c` and its hinge `b`, each by its letter as seen, from the vertex
/// to where it leaves its paper (`ends`: the crease behind's, `c`'s, `b`'s).
pub(super) fn creases_of(
    state: &State,
    built: &Built,
    [behind_to, counter_to, second_to]: [Point; 3],
    kind: SwivelKind,
) -> Vec<SwivelCrease> {
    let fan = &built.fan;
    let v = fan.vertex;
    let inside = kind == SwivelKind::Inside;
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
    let hidden_to = covered(state, built.front, v, fan.swivel).min(length);
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
    creases
}

/// A swivel's folded edge, and the half of it that opens.
pub(super) fn fold_of(state: &State, built: &Built) -> Result<SwivelFold, Refused> {
    let fan = &built.fan;
    let v = fan.vertex;
    let end = fan
        .fold_run
        .into_iter()
        .max_by(|a, b| dot(sub(*a, v), fan.opens).total_cmp(&dot(sub(*b, v), fan.opens)))
        .ok_or_else(|| internal("no fold end"))?;
    Ok(SwivelFold {
        edge: fan.fold_run,
        opens: [v, end],
        faces: fan.ids(state),
    })
}

/// Whether the crease from the swivel's vertex along `u` through the layer
/// of face `layer` stops at a fold of that paper, inside its folded edge
/// and away from its ends, other than the swivel's own folded edge: where a
/// second swivel's lines can meet. Where it is; none at the paper's edge.
fn runs_on_to_a_fold(state: &State, built: &Built, layer: usize, u: Point) -> Option<Point> {
    let run = ray_run(state, layer, built.fan.vertex, u).ok()?;
    let at = run.end;
    let images = &state.geometry().vertex_images;
    let topology = state.topology();
    let on = |k: usize| {
        let [a, b] = state.creases()[k].vertices.map(|w| images[w.index()]);
        let d = sub(b, a);
        let length = dot(d, d).sqrt();
        let along = dot(sub(at, a), d) / length;
        length > TOL
            && (cross(d, sub(at, a)) / length).abs() <= TOL
            && along > -TOL
            && along < length + TOL
    };
    // A fold of the paper the crease runs in, where it stops: one of that
    // sheet's own folds, whichever of its faces it bounds there.
    let region = flat_region(state, layer);
    let fold = (0..state.creases().len()).find(|&k| {
        matches!(state.creases()[k].kind, CreaseKind::Folded(_))
            && topology.crease_faces[k].iter().any(|&f| region[f])
            && on(k)
    })?;
    let [a, b] = state.creases()[fold]
        .vertices
        .map(|w| state.vertices()[w.index()]);
    let edge = edge_run(state, [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]).ok()?;
    let away = |p: Point| sub(p, at)[0].hypot(sub(p, at)[1]) >= MIN_FEATURE;
    let another = !edge.creases.iter().any(|k| built.fan.run.contains(k));
    (another && edge.ends.iter().all(|&p| away(p))).then_some(at)
}

/// The other end of a crease a second swivel can share (the analysis'
/// `other_end`): the first of the swivel's hinge, the crease behind and its
/// other named crease that runs on through its paper to a fold of it
/// (`runs_on_to_a_fold`) — not one that leaves at the paper's edge, whatever
/// other paper lies there.
pub(super) fn other_end(state: &State, built: &Built, kind: SwivelKind) -> Option<SwivelOtherEnd> {
    let (counter, second) = match kind {
        SwivelKind::Open => (SwivelShared::Mountain, SwivelShared::Valley),
        SwivelKind::Inside => (SwivelShared::Valley, SwivelShared::Mountain),
    };
    let fan = &built.fan;
    [
        (built.front, fan.second, second),
        (built.behind, fan.swivel, SwivelShared::Behind),
        (built.front, fan.counter, counter),
    ]
    .into_iter()
    .find_map(|(layer, u, shared)| {
        runs_on_to_a_fold(state, built, layer, u).map(|vertex| SwivelOtherEnd { vertex, shared })
    })
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
        let (built, reading) = match op.reading(self)? {
            Reading::OnEdge(on_edge) => *on_edge,
            Reading::HingeEnd(turn) => {
                return Ok(SwivelValleyMountainAnalysis {
                    vertex: turn.vertex,
                    creases: turn.creases(self),
                    layers: turn.layers(self),
                    regions: turn.regions(self),
                    fold: turn.fold(self),
                    other_end: None,
                });
            }
        };
        Ok(SwivelValleyMountainAnalysis {
            vertex: built.fan.vertex,
            creases: creases_of(self, &built, reading.ends, op.kind),
            layers: vec![self.faces()[built.front].id, self.faces()[built.behind].id],
            regions: super::swivel_on_edge::on_fold_regions(self, &reading),
            fold: fold_of(self, &built)?,
            other_end: other_end(self, &built, op.kind),
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
        match op.reading(self).map_err(CompoundRefused::Refused)? {
            Reading::OnEdge(on_edge) => on_edge.1.land(self, choices, limits, || None),
            Reading::HingeEnd(turn) => turn.land(self, choices, limits),
        }
    }

    /// The picture of a swivel by its valley and mountain, with `landed`'s
    /// cover at the arrow's head when it is given: the front layer's hinge
    /// from the vertex, and the arrow from the strip that folds across it.
    pub fn swivel_valley_mountain_action(
        &self,
        op: &SwivelValleyMountain,
        landed: Option<&State>,
    ) -> Result<FoldActionGeometry, Refused> {
        let (built, reading) = match op.reading(self)? {
            Reading::OnEdge(on_edge) => *on_edge,
            Reading::HingeEnd(turn) => return self.hinge_end_action(&turn, landed),
        };
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

    /// The picture of a flap turned about the end of its hinges: the crease
    /// on the flap from the vertex, and the arrow from the flap across it, by
    /// that crease's letter.
    fn hinge_end_action(
        &self,
        turn: &HingeEnd,
        landed: Option<&State>,
    ) -> Result<FoldActionGeometry, Refused> {
        let reach: Vec<_> = turn
            .regions(self)
            .into_iter()
            .filter(|r| r.wedge == SwivelWedge::Beyond)
            .map(|r| r.polygon)
            .collect();
        let line = turn.on_flap.line;
        let side = reach
            .iter()
            .filter_map(|r| convex::centroid(r))
            .find_map(|p| Side::of_point(&line, p))
            .ok_or_else(|| internal("a turned flap has no side"))?;
        let seen = match turn.on_flap.letter {
            Letter::Valley => Direction::Valley,
            Letter::Mountain => Direction::Mountain,
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
                moving: turn.moving(self),
            },
            ActionKind::Fold,
            landed,
            Within {
                ray: Some((turn.vertex, turn.on_flap.direction)),
                reach: Some(&reach),
            },
        )
    }
}
