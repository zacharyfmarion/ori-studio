//! The swivel (plan Phase 11, research §5.3), a vertex fold
//! ([`super::vertex`]) at a free vertex: four rays from a point inside the
//! chosen layers ([`super::fan`]), folded as the rabbit ear's are. Free: the
//! vertex lies in no crease, so the layers are cut there afresh. A step names
//! a swivel in one of two forms, which fold through the same fan. The
//! classic swivel whose creases meet on a folded edge is the edge form with
//! its `fold` named ([`super::swivel_on_edge`]), folded per crease rather
//! than as a fan.
//!
//! # By its rays ([`Swivel`])
//!
//! The vertex, three rays toward given points and the emergent fourth (one of
//! the Kawasaki candidates), and a sheet point on paper that stays. With the
//! direction seed the spike found each of its cases unique (research §5.3).
//!
//! A rabbit ear on free hinges (Beloch's `swivel-rabbit`, whose emergent
//! "ear" crease is a mountain), so its letters follow the ear's rule: the
//! three given creases take the direction's letter and the fourth the other.
//! The direction seed alone landed a fourth crease beside the paper that
//! stays with the direction's letter and a given one with the other (the
//! spike's 90° ray); that is refused now, as the ear's is, and so is a
//! fourth crease the angles will not let fold opposite the other three.
//!
//! # By its edge ([`SwivelByEdge`])
//!
//! As folders diagram it: *swivel this edge onto that line, pivoting at this
//! point*. The inputs are a pivot `P`, an edge `e` of the folded form (a raw
//! edge, or a folded crease) and a target line `t`; the four creases are
//! computed. A rabbit ear is the swivel whose vertex is its triangle's
//! incenter (Lang), and this form is that ear generalised.
//!
//! **What the inputs determine.**
//!
//! - *The vertex.* A turn about a point carries the line of `e` onto `t`
//!   only when the point is as far from one as from the other: on one of the
//!   two bisectors of `e` and `t`, which cross where they meet, `X`. The
//!   vertex `V` is the pivot moved square onto the nearer bisector, so a
//!   pivot clicked near the bisector lands on it and replay recomputes it
//!   exactly. `V` lies in one of the four angles `e` and `t` make at `X`;
//!   `eₛ` and `tₛ` are the two half-lines bounding it, and the swivel moves
//!   the edge's part along `eₛ` onto `tₛ`. The turn is unique: it takes the
//!   foot of `V` on `e`, `F`, to the foot on `t`.
//! - *The four creases*, from `V` (the fan's rays):
//!   - **meet**, toward `X`: the bisector, whose reflection lays `e` on `t`;
//!   - **foot**, toward `F`, square to `e`;
//!   - **end**, toward `A`, the edge's far end along `eₛ` past `F` (the end
//!     of its straight run of raw edges, or of folded creases);
//!   - **hinge**, forced by Kawasaki's theorem: the one direction in the
//!     wide gap from *end* round to *meet* where the four fold flat.
//!
//!   With θ the angle at `X` and `w` the angle `F V A`, the sectors are
//!   meet→foot `90° − θ/2`, foot→end `w`, end→hinge `90° + θ/2` and
//!   hinge→meet `180° − w`: alternate pairs sum to a half turn, and none
//!   reaches it, so the vertex always folds flat. At the incenter of the
//!   triangle `X A C`, the hinge runs to `C` and the swivel is the rabbit ear.
//! - *What moves.* The wedge from hinge to meet holds `tₛ` beside `X`: it
//!   stays (the fan's anchor), and so does the edge's part past `X`, if any.
//!   The wedge meet→foot folds across *meet*, laying the edge's near part
//!   (from `X`, or its near end, to `F`) on `t` by a plain reflection; the
//!   wedge foot→end turns in place about `V` by the swivel's rotation (two
//!   reflections, so it lands face up), laying `F A` on `t` too; the wedge
//!   end→hinge folds across *hinge*. Every layer the creases cut alike.
//! - *Letters* (Kawasaki and Maekawa with the rabbit ear's rule, Lang): the
//!   ridge — the crease the flap rises along — folds the other way from the
//!   three. It is one of the turning wedge's two rays, *foot* by default (the
//!   rabbit ear's: square to its side). The narrowest sector always borders
//!   *foot* (meet→foot or foot→end, both under a right angle while the other
//!   two exceed one), so the foot can always rise; *end* can rise too when
//!   foot→end is no wider than meet→foot.
//!
//! **Ambiguity.** The turn is unique once the vertex is (`V` off the edge).
//! What is left: which bisector the pivot lies nearer (the user's click
//! decides); which far ray is the ridge (two folded results, differing in
//! letters and order, stored as the op's `ridge` when the other is taken,
//! plan D6); front or back (the direction); and the order, when the
//! completion leaves several (the step's `completion`, as every vertex
//! fold's).
//!
//! **Into the pipeline.** The vertex, the three non-ridge rays as the given
//! ones, the ridge as the emergent fourth, a stayer just inside the wedge
//! from hinge to meet on the first layer cut, the layers and the direction:
//! a [`Swivel`]'s [`FanInput`], folded by the same machinery
//! ([`State::swivel_by_edge_as_rays`] is that [`Swivel`]).
//!
//! **Refusals** (plan D14): a sheet point on no raw or folded edge
//! (`swivel_not_an_edge`); a target parallel to the edge, or its own line
//! (`swivel_target_parallel`); a vertex on the edge's line, where no free
//! vertex is (`swivel_pivot_on_edge`); an edge that ends before its
//! foot, so none of it swivels (`swivel_edge_short`, offering the plain fold
//! along the bisector that lands it); an edge whose paper the cut layers
//! leave out, so it would stay put (`swivel_edge_stays`); then the fan's
//! own: a vertex not inside the layers (`fan_center`), paper in the way
//! (`fan_ray_blocked`, naming it — a flat precrease the rays would cross
//! into uncut paper is in the way too), no order (`no_order`, offering the
//! other direction); and with any of these the other ridge when it lands
//! (`use_emergent`, stored as the op's `ridge`).
//!
//! What this form cannot say is a swivel whose hinges are free: Beloch's
//! `swivel-rabbit` puts its two hinges at a height no landmark fixes, which
//! the rays form states and this one computes.
//!
//! # On a folded edge (`fold`)
//!
//! The same three inputs, but the pivot is a point on a folded edge: the
//! creases meet where the bisector crosses that edge, through the two layers
//! it joins — the classic swivel of folding diagrams. Its geometry, letters
//! and refusals are [`super::swivel_on_edge`]'s. It comes in two kinds
//! ([`SwivelKind`]): open, the other layer's strip folded up on top, or
//! inside, the strip tucked between the two layers.
//!
//! A free vertex has only the open kind (`swivel_inside_free`): its creases
//! cut every layer at the vertex alike, the layers move together, and no
//! folded edge joins two of them there to open a pocket between.

use std::f64::consts::PI;

use oristudio_geometry::{Line, convex};
use serde::{Deserialize, Serialize};

use crate::complete::CompletionLimits;
use crate::compound::CompoundRefused;
use crate::compound::fan::{FanAnalysis, FanInput, fan_layers, kawasaki, nearest, offers_fixes};
use crate::compound::vertex::{
    Compiled, VertexChoices, VertexFoldKind, VertexOutcome, angle_between, rotate, unit,
};
use crate::fold::{FoldActionGeometry, Seed};
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::{CreaseKind, FaceId, Letter, VertexId, opposite};
use crate::refusal::{Fix, FoldRefusal, Refused, Side};
use crate::state::State;
use crate::view::Direction;

type Point = [f64; 2];

/// A swivel, named the way a step stores it (plan D6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Swivel {
    /// The vertex, in the parent's model frame.
    pub vertex: Point,
    /// The points the three given rays run toward, in the parent's model
    /// frame.
    pub toward: [Point; 3],
    /// The fourth ray, a direction from the vertex in the parent's model
    /// frame: the nearest Kawasaki candidate is taken.
    pub emergent: Point,
    /// The layers the creases cut, at the vertex.
    pub layers: Seed,
    /// A sheet point on paper that stays.
    pub stayer: Point,
    /// As the viewer sees it.
    pub direction: Direction,
}

impl Swivel {
    fn input(&self) -> Result<FanInput, Refused> {
        let ray = |p: Point| unit([p[0] - self.vertex[0], p[1] - self.vertex[1]]);
        let [a, b, c] = self.toward;
        let (Some(a), Some(b), Some(c)) = (ray(a), ray(b), ray(c)) else {
            return Err(FoldRefusal::FanNotFlat.into());
        };
        Ok(FanInput {
            kind: VertexFoldKind::Swivel,
            triangle: None,
            center: self.vertex,
            given: [a, b, c],
            emergent: self.emergent,
            layers: self.layers.clone(),
            stayer: self.stayer,
            direction: self.direction,
        })
    }
}

impl State {
    /// A swivel's rays, emergent candidates and layers, without folding.
    pub fn analyse_swivel(&self, op: &Swivel) -> Result<FanAnalysis, Refused> {
        op.input()?.analyse(self)
    }

    /// The picture of the swivel `op` on this state, with `landed`'s cover
    /// at the arrow's head when it is given: a fan fold's (see
    /// [`super::vertex`]).
    pub fn swivel_action(
        &self,
        op: &Swivel,
        landed: Option<&State>,
    ) -> Result<FoldActionGeometry, Refused> {
        op.input()?.action(self, landed)
    }

    /// A swivel, with its stored choices (empty for a new step), under the
    /// default completion limits.
    pub fn swivel(
        &self,
        op: &Swivel,
        choices: &VertexChoices,
    ) -> Result<VertexOutcome, CompoundRefused> {
        self.swivel_within(op, choices, &CompletionLimits::default())
    }

    /// [`State::swivel`] under `limits`. A refusal of its emergent ray
    /// offers the candidates that land.
    pub fn swivel_within(
        &self,
        op: &Swivel,
        choices: &VertexChoices,
        limits: &CompletionLimits,
    ) -> Result<VertexOutcome, CompoundRefused> {
        op.input()
            .map_err(CompoundRefused::Refused)?
            .land(self, choices, limits)
    }
}

// ---------------------------------------------------------------------------
// The swivel by its edge

/// A swivel as folders diagram it: *swivel this edge onto that line,
/// pivoting at this point* (the module docs), named the way a step stores
/// it (plan D6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SwivelByEdge {
    /// The pivot, in the parent's model frame. The creases meet where it
    /// lands moved square onto the nearer bisector of the edge and the
    /// target.
    pub pivot: Point,
    /// A sheet point on the edge that moves: inside the sheet segment of a
    /// raw edge or a folded crease. Its straight run of raw edges (or of
    /// folded creases) is the edge.
    pub edge: Point,
    /// The line the edge lands on, in the parent's model frame.
    pub target: Line,
    /// The layers the creases cut, at the vertex.
    pub layers: Seed,
    /// The ridge, the crease that folds the other way from the three: a
    /// direction from the vertex in the parent's model frame, the nearer of
    /// the turning wedge's two rays taken. None takes the one square to the
    /// edge (the rabbit ear's).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ridge: Option<Point>,
    /// As the viewer sees it: the three creases' letter, the ridge taking
    /// the other.
    pub direction: Direction,
    /// A sheet point on the folded edge the creases meet on: the classic
    /// swivel, its vertex where the bisector nearer the pivot crosses that
    /// edge, its layers the two the edge joins (`layers` and `ridge` are not
    /// read; [`super::swivel_on_edge`]). None for a free vertex, the pivot
    /// moved onto the bisector.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fold: Option<Point>,
    /// On a folded edge, where the other layer's strip goes: on top
    /// ([`SwivelKind::Open`]) or tucked between the two layers
    /// ([`SwivelKind::Inside`]). Spelled only when inside, so every open
    /// swivel's op reads and writes as it always did. A free vertex has
    /// only the open kind (`swivel_inside_free`).
    #[serde(default, skip_serializing_if = "SwivelKind::is_open")]
    pub kind: SwivelKind,
}

/// Where a swivel on a folded edge puts the other layer's strip, the paper
/// between its two creases (`super::swivel_on_edge`), as folders tell the
/// two apart (Abrashi's "What is Swivel fold?", figures 1 and 2).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SwivelKind {
    /// The open swivel: the strip folds up over the rest of its layer, its
    /// back on show, its second crease taking the direction's letter.
    #[default]
    Open,
    /// The inside (closed) swivel: the strip folds under the rest of its
    /// layer, tucked between the folded edge's two layers, its second
    /// crease taking the other letter.
    Inside,
}

impl SwivelKind {
    pub fn is_open(&self) -> bool {
        *self == SwivelKind::Open
    }

    pub fn other(self) -> SwivelKind {
        match self {
            SwivelKind::Open => SwivelKind::Inside,
            SwivelKind::Inside => SwivelKind::Open,
        }
    }
}

/// One of a swivel's four creases, by what it runs toward.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SwivelRay {
    /// Toward where the edge's line meets the target: the bisector. On a
    /// folded edge, the swivel crease, in each of the two layers.
    Meet,
    /// Square to the edge, toward the vertex's foot on it.
    Foot,
    /// Toward the edge's far end.
    End,
    /// The direction Kawasaki's theorem leaves. On a folded edge, the other
    /// layer's second crease: the folded edge reflected in the swivel
    /// crease.
    Hinge,
}

/// A wedge of a swivel's that moves, by the creases bounding it; the one
/// from hinge to meet stays.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SwivelWedge {
    /// Between meet and foot: folds across meet, laying the edge's near
    /// part on the target. On a folded edge, the edge's layer between the
    /// folded edge and the swivel crease, folding across it.
    Near,
    /// Between foot and end: turns in place about the vertex, laying the
    /// rest of the edge on the target. On a folded edge, the other layer's
    /// paper on the half that opens, going with the near wedge.
    Turn,
    /// Between end and hinge: folds across the hinge. On a folded edge, the
    /// other layer's strip between its two creases, folding across the
    /// second.
    Beyond,
}

/// A crease a swivel by its edge makes, as a tool previews it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SwivelCrease {
    pub ray: SwivelRay,
    /// A unit direction from the vertex, in the parent's model frame.
    pub direction: Point,
    /// Where it is seen from, in the parent's model frame: the vertex, or
    /// on a folded edge, for the swivel crease of the layer farther from the
    /// direction's side, where the nearer one's ends (`to` when it is hidden
    /// all along).
    pub from: Point,
    /// Where it leaves the last of the layers it cuts, in the parent's model
    /// frame.
    pub to: Point,
    /// As the viewer sees it: the direction's letter, or the other one for
    /// the ridge.
    pub letter: Letter,
    /// Whether it is the ridge.
    pub ridge: bool,
    /// Whether this stretch of it lies behind paper the viewer sees: a swivel
    /// by its valley and mountain's crease on the layer behind, which a tool
    /// draws dotted there. Written only when it is.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
}

/// A piece of paper a swivel moves, in the parent's model frame.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SwivelRegion {
    pub wedge: SwivelWedge,
    /// Counter-clockwise.
    pub polygon: Vec<Point>,
}

/// What a swivel by its edge is before it folds: what a tool previews and
/// offers.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SwivelEdgeAnalysis {
    /// The pivot as given, and the vertex where the creases meet: the
    /// pivot moved onto the bisector.
    pub pivot: Point,
    pub vertex: Point,
    /// Where the edge's line meets the target.
    pub meet: Point,
    /// The edge's straight run, its end nearer `meet` first.
    pub edge: [Point; 2],
    /// The parent's faces it bounds.
    pub edge_faces: Vec<FaceId>,
    /// The vertex's foot on the edge's line.
    pub foot: Point,
    pub target: Line,
    /// How far the turning wedge turns about the vertex, radians
    /// counter-clockwise, in (−π, π].
    pub rotation: f64,
    /// Where the edge's moving part lies once folded, on the target: its
    /// near part folded across meet (from where it meets the target, or
    /// its near end, to the foot), then its part turned about the vertex
    /// (from the foot to its far end); the near part left out when the edge
    /// starts past the foot. In a rabbit ear the two overlap.
    pub landed: Vec<[Point; 2]>,
    /// The four creases: meet, foot, end, hinge.
    pub creases: Vec<SwivelCrease>,
    /// The rays the ridge can be: foot's, then end's.
    pub ridges: Vec<Point>,
    /// The one taken.
    pub ridge: usize,
    /// The layers the creases cut: the parent's faces, the first nearest
    /// the side the direction names.
    pub layers: Vec<FaceId>,
    /// The paper that moves, by wedge; empty when the fan cannot cut the
    /// layers (folding it says why).
    pub regions: Vec<SwivelRegion>,
    /// A swivel on a folded edge's: that edge, and the half of it that
    /// opens. None for a free vertex.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fold: Option<SwivelFold>,
}

/// The folded edge a swivel's creases meet on, as a tool previews it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SwivelFold {
    /// Its straight run, in the parent's model frame.
    pub edge: [Point; 2],
    /// The half that opens, from the vertex toward the edge that moves.
    pub opens: [Point; 2],
    /// The two faces it joins at the vertex, ascending.
    pub faces: Vec<FaceId>,
}

/// A swivel by its edge resolved in its parent: its vertex and rays.
#[derive(Debug, Clone)]
struct Construction {
    pivot: Point,
    vertex: Point,
    meet: Point,
    /// Nearer `meet` first.
    edge: [Point; 2],
    /// The run's ends on the sheet, in the order of `edge`.
    edge_sheet: [Point; 2],
    edge_faces: Vec<FaceId>,
    /// The unit direction of `eₛ`, from `meet`.
    along: Point,
    foot: Point,
    target: Line,
    /// Meet, foot, end, hinge.
    rays: [Point; 4],
    rotation: f64,
    landed: Vec<[Point; 2]>,
}

/// An edge's straight run: its two ends on the sheet and their images, the
/// faces it bounds, and its creases by position.
pub(crate) struct EdgeRun {
    pub(crate) sheet: [Point; 2],
    pub(crate) ends: [Point; 2],
    pub(crate) faces: Vec<FaceId>,
    pub(crate) creases: Vec<usize>,
}

pub(crate) fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1]]
}

pub(crate) fn dot(a: Point, b: Point) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

pub(crate) fn internal(message: &str) -> Refused {
    FoldRefusal::Internal {
        message: message.to_string(),
    }
    .into()
}

/// The edge the sheet point `point` names: the raw edge or folded crease
/// whose sheet segment holds it, run on through every crease of its kind
/// that continues it straight, on the sheet and in the model frame alike.
pub(crate) fn edge_run(state: &State, point: Point) -> Result<EdgeRun, Refused> {
    let not_an_edge = || Refused::from(FoldRefusal::SwivelNotAnEdge { point });
    let start = state
        .crease_at(point)
        .filter(|c| matches!(c.kind, CreaseKind::Border | CreaseKind::Folded(_)))
        .ok_or_else(not_an_edge)?;
    let creases = state.creases();
    let border = start.kind == CreaseKind::Border;
    let image = |v: VertexId| state.vertex_image(v);
    let [a, b] = start.vertices;
    let (Some(ia), Some(ib)) = (image(a), image(b)) else {
        return Err(internal("an edge's vertex has no image"));
    };
    let line = Line::from_points(ia, ib).ok_or_else(|| internal("an edge has no length"))?;
    let first = creases
        .iter()
        .position(|c| c.id == start.id)
        .ok_or_else(|| internal("no edge crease"))?;
    let mut used: Vec<usize> = vec![first];
    // From `from`, away from `prev`: the run's end that way.
    let mut walk = |mut prev: VertexId, mut from: VertexId| -> VertexId {
        let sheet = state.vertices();
        loop {
            let (Some(model_prev), Some(model_from)) = (image(prev), image(from)) else {
                return from;
            };
            let (sp, sf) = (sheet[prev.index()], sheet[from.index()]);
            let (sheet_ahead, model_ahead) = (sub(sf, sp), sub(model_from, model_prev));
            let along = Line::from_points(sp, sf);
            let next = creases.iter().enumerate().find_map(|(k, c)| {
                if used.contains(&k)
                    || (c.kind == CreaseKind::Border) != border
                    || matches!(c.kind, CreaseKind::Flat(_))
                    || !c.vertices.contains(&from)
                {
                    return None;
                }
                let other = if c.vertices[0] == from {
                    c.vertices[1]
                } else {
                    c.vertices[0]
                };
                let so = sheet[other.index()];
                let mo = image(other)?;
                let straight = along.is_some_and(|l| l.distance_to_point(so) <= TOL)
                    && dot(sub(so, sf), sheet_ahead) > 0.0
                    && line.distance_to_point(mo) <= TOL
                    && dot(sub(mo, model_from), model_ahead) > 0.0;
                straight.then_some((k, other))
            });
            match next {
                Some((k, other)) => {
                    used.push(k);
                    prev = from;
                    from = other;
                }
                None => return from,
            }
        }
    };
    let (end_b, end_a) = (walk(a, b), walk(b, a));
    let (Some(ea), Some(eb)) = (image(end_a), image(end_b)) else {
        return Err(internal("an edge's end has no image"));
    };
    let topology = state.topology();
    let mut faces: Vec<FaceId> = used
        .iter()
        .flat_map(|&k| {
            topology.crease_faces[k]
                .iter()
                .map(|&f| state.faces()[f].id)
        })
        .collect();
    faces.sort_unstable();
    faces.dedup();
    let sheet = state.vertices();
    Ok(EdgeRun {
        sheet: [sheet[end_a.index()], sheet[end_b.index()]],
        ends: [ea, eb],
        faces,
        creases: used,
    })
}

/// The hinge: the Kawasaki direction for meet, foot and end in the gap from
/// end round to meet, outside the arc meet → foot → end (under a half turn).
fn hinge_ray(meet: Point, foot: Point, end: Point) -> Option<Point> {
    let span = angle_between(meet, end);
    let inside = |c: Point| {
        let a = angle_between(meet, c);
        a.signum() == span.signum() && a.abs() < span.abs()
    };
    kawasaki(&[meet, foot, end])
        .into_iter()
        .find(|&c| !inside(c))
}

/// An angle wrapped into (−π, π].
pub(crate) fn wrap(angle: f64) -> f64 {
    let a = angle.rem_euclid(2.0 * PI);
    if a > PI { a - 2.0 * PI } else { a }
}

impl SwivelByEdge {
    /// The vertex and its rays (the module docs).
    fn construct(&self, state: &State) -> Result<Construction, Refused> {
        let run = edge_run(state, self.edge)?;
        let faces = run.faces;
        if self.kind == SwivelKind::Inside {
            // Only a folded edge has two layers to tuck the strip between.
            return Err(FoldRefusal::SwivelInsideFree { faces }.into());
        }
        let [e1, e2] = run.ends;
        let [s1, s2] = run.sheet;
        let edge = Line::from_points(e1, e2).ok_or_else(|| internal("an edge has no length"))?;
        let parallel = || {
            Refused::from(FoldRefusal::SwivelTargetParallel {
                faces: faces.clone(),
            })
        };
        let target = Line::new(self.target.n, self.target.d)
            .filter(|t| t.d.is_finite())
            .ok_or_else(parallel)?;
        let meet = edge.intersect(&target).ok_or_else(parallel)?;
        // The two bisectors through the meeting point; the vertex on the
        // nearer, square from the pivot.
        let (ue, ut) = (edge.direction(), target.direction());
        let vertex = [
            [ue[0] + ut[0], ue[1] + ut[1]],
            [ue[0] - ut[0], ue[1] - ut[1]],
        ]
        .into_iter()
        .filter_map(|d| unit(d).and_then(|d| Line::from_point_direction(meet, d)))
        .map(|bisector| bisector.project_point(self.pivot))
        .min_by(|p, q| {
            let off = |v: &Point| (v[0] - self.pivot[0]).hypot(v[1] - self.pivot[1]);
            off(p).total_cmp(&off(q))
        })
        .ok_or_else(parallel)?;
        if edge.distance_to_point(vertex) < MIN_FEATURE {
            return Err(FoldRefusal::SwivelPivotOnEdge { faces }.into());
        }
        // The edge's half-line from the meeting point on the vertex's side.
        let toward = sub(vertex, meet);
        let es = if dot(toward, ue) > 0.0 {
            ue
        } else {
            [-ue[0], -ue[1]]
        };
        let along = |p: Point| dot(sub(p, meet), es);
        let at = |s: f64| [meet[0] + s * es[0], meet[1] + s * es[1]];
        let foot = at(along(vertex));
        let ((near, far), edge_sheet) = if along(e1) <= along(e2) {
            ((e1, e2), [s1, s2])
        } else {
            ((e2, e1), [s2, s1])
        };
        let meet_line = Line::from_points(vertex, meet).ok_or_else(parallel)?;
        if along(far) < along(foot) + MIN_FEATURE {
            // Nothing of it past the foot: a plain fold along the bisector
            // lays it on the target, its side the edge's.
            let mut refused = Refused::from(FoldRefusal::SwivelEdgeShort {
                faces: faces.clone(),
            });
            if let Some(side) = Side::of_point(&meet_line, foot) {
                refused.fixes.push(Fix::UseLine {
                    line: meet_line,
                    side,
                });
            }
            return Err(refused);
        }
        let ray =
            |p: Point| unit(sub(p, vertex)).ok_or_else(|| internal("a swivel ray has no length"));
        let (meet_ray, foot_ray, end_ray) = (ray(meet)?, ray(foot)?, ray(far)?);
        let hinge = hinge_ray(meet_ray, foot_ray, end_ray).ok_or(FoldRefusal::FanNotFlat)?;
        let rotation = wrap(2.0 * angle_between(foot_ray, meet_ray));
        // The turn: across foot, then across meet.
        let turn = |p: Point| {
            let r = rotate(sub(p, vertex), rotation);
            [vertex[0] + r[0], vertex[1] + r[1]]
        };
        // Where the edge lies once folded: its part from the meeting point
        // (or its near end) to the foot folded across meet, the rest turned.
        let near_start = if along(near) <= 0.0 { meet } else { near };
        let landed = if along(near_start) < along(foot) {
            vec![
                [meet_line.reflect_point(near_start), turn(foot)],
                [turn(foot), turn(far)],
            ]
        } else {
            vec![[turn(near_start), turn(far)]]
        };
        Ok(Construction {
            pivot: self.pivot,
            vertex,
            meet,
            edge: [near, far],
            edge_sheet,
            edge_faces: faces,
            along: es,
            foot,
            target,
            rays: [meet_ray, foot_ray, end_ray, hinge],
            rotation,
            landed,
        })
    }
}

impl Construction {
    /// The rays the ridge can be: foot's, then end's.
    fn ridges(&self) -> [Point; 2] {
        [self.rays[1], self.rays[2]]
    }

    /// The ridge an op asks for, by its index in [`Construction::ridges`].
    fn ridge(&self, asked: Option<Point>) -> usize {
        asked.and_then(|d| nearest(&self.ridges(), d)).unwrap_or(0)
    }

    /// A sheet point on paper that stays: on the first layer cut, just
    /// inside the wedge from hinge to meet.
    fn stayer(&self, state: &State, op: &SwivelByEdge) -> Result<Point, Refused> {
        let direction = state.view().model_direction(op.direction);
        let layers = fan_layers(state, self.vertex, &op.layers, direction)?;
        let first = *layers.first().ok_or(FoldRefusal::EmptySeed)?;
        let [meet, _, _, hinge] = self.rays;
        let mid = unit([meet[0] + hinge[0], meet[1] + hinge[1]])
            .ok_or_else(|| internal("a swivel's staying wedge has no middle"))?;
        let step = MIN_FEATURE / 4.0;
        let q = [
            self.vertex[0] + step * mid[0],
            self.vertex[1] + step * mid[1],
        ];
        Ok(state.geometry().isometries[first].inverse().apply(q))
    }

    /// The fan the pipeline folds, ridge `k` its emergent fourth.
    fn fan(&self, state: &State, op: &SwivelByEdge, k: usize) -> Result<FanInput, Refused> {
        let [meet, foot, end, hinge] = self.rays;
        let (ridge, other) = if k == 0 { (foot, end) } else { (end, foot) };
        Ok(FanInput {
            kind: VertexFoldKind::Swivel,
            triangle: None,
            center: self.vertex,
            given: [meet, other, hinge],
            emergent: ridge,
            layers: op.layers.clone(),
            stayer: self.stayer(state, op)?,
            direction: op.direction,
        })
    }

    /// The fan compiled (the pipeline's step 1): its pieces in their blocks.
    fn compile(&self, state: &State, fan: &FanInput) -> Result<Compiled, Refused> {
        let direction = state.view().model_direction(fan.direction);
        let candidates = kawasaki(&fan.given);
        let k = nearest(&candidates, fan.emergent).ok_or(FoldRefusal::FanNotFlat)?;
        fan.compile_fan(state, &candidates, k, direction)
            .map(|(_, compiled)| compiled)
    }

    /// Which wedge a compiled block turns as: the turning wedge across two
    /// creases, the near one across meet, the beyond one across the hinge.
    fn wedge(&self, compiled: &Compiled, block: usize) -> SwivelWedge {
        let meet = Line::from_point_direction(self.vertex, self.rays[0]);
        match compiled.turns[block].as_slice() {
            [_, _] => SwivelWedge::Turn,
            [(_, line)] if meet.is_some_and(|m| m.approx_eq(line)) => SwivelWedge::Near,
            _ => SwivelWedge::Beyond,
        }
    }

    /// Whether the edge's paper, from where it meets the target to its far
    /// end, turns onto the target: every piece along it in the near wedge
    /// or the turning one (whose motions both carry the edge's line onto the
    /// target), none left staying or folded across the hinge.
    fn edge_moves(&self, compiled: &Compiled) -> bool {
        let scoring = &compiled.scoring;
        let [sa, sb] = self.edge_sheet;
        let [ma, mb] = self.edge;
        let Some(sheet_line) = Line::from_points(sa, sb) else {
            return false;
        };
        let run = sub(sb, sa);
        let length2 = dot(run, run);
        let mut seen = false;
        for (a, face) in scoring.faces.iter().enumerate() {
            let m = face.ring.len();
            for i in 0..m {
                let p = scoring.vertices[face.ring[i].index()];
                let q = scoring.vertices[face.ring[(i + 1) % m].index()];
                if sheet_line.distance_to_point(p) > TOL || sheet_line.distance_to_point(q) > TOL {
                    continue;
                }
                let mid = [(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0];
                let s = dot(sub(mid, sa), run) / length2;
                if !(0.0..=1.0).contains(&s) {
                    continue;
                }
                let model = [ma[0] + s * (mb[0] - ma[0]), ma[1] + s * (mb[1] - ma[1])];
                if dot(sub(model, self.meet), self.along) <= MIN_FEATURE / 2.0 {
                    // Past where it meets the target: it stays.
                    continue;
                }
                seen = true;
                let turns = compiled.block_of[a]
                    .is_some_and(|b| self.wedge(compiled, b) != SwivelWedge::Beyond);
                if !turns {
                    return false;
                }
            }
        }
        seen
    }
}

impl State {
    /// A swivel by its edge before it folds: its vertex, its creases with
    /// their letters, where the edge lands, the ridges it can take and the
    /// paper that moves.
    pub fn analyse_swivel_by_edge(&self, op: &SwivelByEdge) -> Result<SwivelEdgeAnalysis, Refused> {
        if let Some(fold) = op.fold {
            return self.analyse_swivel_on_fold(op, fold);
        }
        let built = op.construct(self)?;
        let ridge = built.ridge(op.ridge);
        let input = built.fan(self, op, ridge)?;
        let direction = self.view().model_direction(op.direction);
        let layers = fan_layers(self, built.vertex, &op.layers, direction)?;
        let geometry = self.geometry();
        // How far each ray runs through the layers it cuts.
        let reach = |u: Point| -> Point {
            let t = layers
                .iter()
                .filter_map(|&f| exit(&geometry.images[f], built.vertex, u))
                .fold(0.0, f64::max);
            [built.vertex[0] + t * u[0], built.vertex[1] + t * u[1]]
        };
        let given = match op.direction {
            Direction::Valley => Letter::Valley,
            Direction::Mountain => Letter::Mountain,
        };
        let rays = [
            SwivelRay::Meet,
            SwivelRay::Foot,
            SwivelRay::End,
            SwivelRay::Hinge,
        ];
        let creases = rays
            .iter()
            .zip(built.rays)
            .enumerate()
            .map(|(i, (&ray, direction))| {
                let is_ridge = i == ridge + 1;
                SwivelCrease {
                    ray,
                    direction,
                    from: built.vertex,
                    to: reach(direction),
                    letter: if is_ridge { opposite(given) } else { given },
                    ridge: is_ridge,
                    hidden: false,
                }
            })
            .collect();
        Ok(SwivelEdgeAnalysis {
            pivot: built.pivot,
            vertex: built.vertex,
            meet: built.meet,
            edge: built.edge,
            edge_faces: built.edge_faces.clone(),
            foot: built.foot,
            target: built.target,
            rotation: built.rotation,
            landed: built.landed.clone(),
            creases,
            ridges: built.ridges().to_vec(),
            ridge,
            layers: layers.iter().map(|&f| self.faces()[f].id).collect(),
            regions: built
                .compile(self, &input)
                .map(|compiled| regions(self, &built, &compiled))
                .unwrap_or_default(),
            fold: None,
        })
    }

    /// The same swivel by its rays: what the pipeline folds (the module
    /// docs). Its `toward` points lie one unit from the vertex. A swivel on
    /// a folded edge has none: its vertex lies on a crease, inside no
    /// layer (`fan_center`, naming the two the edge joins).
    pub fn swivel_by_edge_as_rays(&self, op: &SwivelByEdge) -> Result<Swivel, Refused> {
        if let Some(fold) = op.fold {
            let analysis = self.analyse_swivel_on_fold(op, fold)?;
            return Err(FoldRefusal::FanCenter {
                faces: analysis.fold.map(|f| f.faces).unwrap_or_default(),
            }
            .into());
        }
        let built = op.construct(self)?;
        let input = built.fan(self, op, built.ridge(op.ridge))?;
        let v = built.vertex;
        Ok(Swivel {
            vertex: v,
            toward: input.given.map(|u| [v[0] + u[0], v[1] + u[1]]),
            emergent: input.emergent,
            layers: op.layers.clone(),
            stayer: input.stayer,
            direction: op.direction,
        })
    }

    /// The picture of the swivel by its edge `op` on this state, with
    /// `landed`'s cover at the arrow's head when it is given: a fan fold's
    /// (see [`super::vertex`]).
    pub fn swivel_by_edge_action(
        &self,
        op: &SwivelByEdge,
        landed: Option<&State>,
    ) -> Result<FoldActionGeometry, Refused> {
        if let Some(fold) = op.fold {
            return self.swivel_on_fold_action(op, fold, landed);
        }
        let built = op.construct(self)?;
        built
            .fan(self, op, built.ridge(op.ridge))?
            .action(self, landed)
    }

    /// A swivel by its edge, with its stored choices (empty for a new
    /// step), under the default completion limits.
    pub fn swivel_by_edge(
        &self,
        op: &SwivelByEdge,
        choices: &VertexChoices,
    ) -> Result<VertexOutcome, CompoundRefused> {
        self.swivel_by_edge_within(op, choices, &CompletionLimits::default())
    }

    /// [`State::swivel_by_edge`] under `limits`. A refusal offers the
    /// other direction when it lands (the pipeline's), and the other ridge
    /// when it does (`use_emergent`, stored as the op's `ridge`).
    pub fn swivel_by_edge_within(
        &self,
        op: &SwivelByEdge,
        choices: &VertexChoices,
        limits: &CompletionLimits,
    ) -> Result<VertexOutcome, CompoundRefused> {
        if let Some(fold) = op.fold {
            return self.swivel_on_fold_within(op, fold, choices, limits);
        }
        let built = op.construct(self).map_err(CompoundRefused::Refused)?;
        let k = built.ridge(op.ridge);
        let fan = built.fan(self, op, k).map_err(CompoundRefused::Refused)?;
        // A fan that compiles must carry the edge onto the target; one that
        // does not is refused by the landing, which says why.
        if built
            .compile(self, &fan)
            .is_ok_and(|compiled| !built.edge_moves(&compiled))
        {
            return Err(CompoundRefused::Refused(
                FoldRefusal::SwivelEdgeStays {
                    faces: built.edge_faces.clone(),
                }
                .into(),
            ));
        }
        let landed = fan.land_alone(self, choices, limits);
        match landed {
            Err(CompoundRefused::Refused(mut refused)) if offers_fixes(&refused.refusal) => {
                let other = 1 - k;
                if built
                    .fan(self, op, other)
                    .is_ok_and(|fan| fan.lands(self, limits))
                {
                    refused.fixes.push(Fix::UseEmergent {
                        direction: built.ridges()[other],
                    });
                }
                Err(CompoundRefused::Refused(refused))
            }
            other => other,
        }
    }
}

/// How far the ray from `from` along the unit `u` runs inside the convex,
/// counter-clockwise `polygon` holding `from`; none when it does not hold
/// it.
pub(crate) fn exit(polygon: &[Point], from: Point, u: Point) -> Option<f64> {
    let n = polygon.len();
    let mut best: Option<f64> = None;
    for i in 0..n {
        let (p, q) = (polygon[i], polygon[(i + 1) % n]);
        let edge = sub(q, p);
        let length = edge[0].hypot(edge[1]);
        if length <= TOL {
            continue;
        }
        // The outward normal of a counter-clockwise ring.
        let normal = [edge[1] / length, -edge[0] / length];
        let inside = dot(normal, sub(from, p));
        if inside > TOL {
            return None;
        }
        let rate = dot(normal, u);
        if rate > TOL {
            let t = -inside / rate;
            best = Some(best.map_or(t, |b: f64| b.min(t)));
        }
    }
    best
}

/// The paper the fan moves, by wedge, in the parent's model frame; empty
/// when it cannot cut the layers.
fn regions(state: &State, built: &Construction, compiled: &Compiled) -> Vec<SwivelRegion> {
    let geometry = state.geometry();
    let scoring = &compiled.scoring;
    (0..scoring.faces.len())
        .filter_map(|a| {
            let wedge = built.wedge(compiled, compiled.block_of[a]?);
            let isometry = geometry.isometries[scoring.old[a]];
            let image: Vec<Point> = scoring
                .polygon(a)
                .iter()
                .map(|&p| isometry.apply(p))
                .collect();
            Some(SwivelRegion {
                wedge,
                polygon: convex::normalize(&image),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hinge_balances_the_vertex_in_the_wide_gap() {
        // The flat square's incenter ear: meet toward (0, 0) at 202.5°, foot
        // at 270°, end toward (1, 0) at 315°; the hinge runs to (1, 1), at
        // 67.5°.
        let deg = |d: f64| [d.to_radians().cos(), d.to_radians().sin()];
        let Some(hinge) = hinge_ray(deg(202.5), deg(270.0), deg(315.0)) else {
            panic!("no hinge");
        };
        assert!(angle_between(hinge, deg(67.5)).abs() < 1e-12, "{hinge:?}");
        // Mirrored, the same.
        let Some(hinge) = hinge_ray(deg(-202.5), deg(-270.0), deg(-315.0)) else {
            panic!("no hinge");
        };
        assert!(angle_between(hinge, deg(-67.5)).abs() < 1e-12, "{hinge:?}");
    }

    #[test]
    fn a_ray_leaves_a_convex_polygon_at_its_nearest_side() {
        let square = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        let t = exit(&square, [0.25, 0.5], [1.0, 0.0]).unwrap_or_default();
        assert!((t - 0.75).abs() < 1e-12);
        let s = std::f64::consts::FRAC_1_SQRT_2;
        let t = exit(&square, [0.5, 0.5], [s, s]).unwrap_or_default();
        assert!((t - 0.5_f64.hypot(0.5)).abs() < 1e-12);
        assert_eq!(exit(&square, [2.0, 0.5], [1.0, 0.0]), None);
        assert!((wrap(1.5 * PI) + 0.5 * PI).abs() < 1e-12);
        assert!((wrap(-PI) - PI).abs() < 1e-12);
    }
}
