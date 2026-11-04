//! The swivel at a hinge end: a flap turned about the corner where its two
//! hinges end.
//!
//! # In a folder's words
//!
//! *Swivel the flap out about its corner.* A flap is joined to the layers on
//! either side of it by two folds that end at one point `V`, its hinges. On
//! the sheet, `V` is a flat vertex of four folds and the flap is the sector
//! between two of them. Turning the flap about `V` moves both hinges by one
//! angle ψ, the same way round: the flap's paper beside the hinge it leaves
//! unfolds onto the layer across that hinge, the other layer's paper beside
//! the hinge the flap turns toward folds in with the flap, and the other two
//! folds stay. The sectors either side of the flap change by ψ, one wider and
//! one narrower, so Kawasaki's theorem holds at `V` for every ψ; the flap
//! turns through 2ψ in the folded figure.
//!
//! The folder names it as a swivel by its valley and mountain
//! ([`super::swivel_valley_mountain`]): two lines from `V` into the flap.
//! That module takes this reading where the lines meet on no folded edge
//! they could swivel on, at the end of the folded edges there.
//!
//! - **The kind** says which way the flap turns. Of the two layers its hinges
//!   join, the one across the hinge the flap shows as its valley lies over
//!   it. Open, the flap swings out from under that layer: the mountain is the
//!   crease on the flap and the valley the one in that layer. Inside, it
//!   swings in under it: the valley is on the flap and the mountain in the
//!   layer below.
//! - **The crease on the flap** sets the turn. It lies ψ inside the hinge
//!   whose letter it keeps, as the flap shows it.
//! - **The other crease** is computed, ψ inside the other hinge, as the
//!   crease behind a swivel on a folded edge is: the folder's line only has
//!   to run into the flap too. It is hidden under paper the viewer sees, and
//!   diagrams draw it there only roughly.
//! - **A flap whose two hinges show it one letter** lies over both layers
//!   they join (mountains) or under both (valleys). The crease on it keeps
//!   that letter, so it is the mountain (open's letters) or the valley
//!   (inside's), and it could leave either hinge: it leaves the one that
//!   gives it room. Where both do, the lines do not say which: the other
//!   crease runs along the same line either way (`swivel_line_meeting`).
//!   Such a flap is read only where the viewer sees it along the crease
//!   named on it (the lines are drawn on it), and only where the lines turn
//!   no flap whose hinges show it two letters — none there, or one that
//!   refuses — so every turn that lands otherwise lands as it did; where it
//!   refuses too, the first refusal stands.
//!
//! **The motion.** The flap's paper between the hinge it leaves and the crease
//! on it unfolds across that hinge (the near wedge); the rest of the flap
//! turns about `V` (the beyond wedge, the flap); the other layer's paper
//! between its hinge and the crease on it folds across that crease with the
//! flap (the turning wedge). Turning a flap whose hinges show it one letter,
//! a precrease a new crease runs along folds with it. Every other face moves
//! with the paper it is joined to, and paper joined to two of those holds
//! them (`fan_ray_blocked`).
//! Each piece keeps its place in the stack against the paper that stays: the
//! flap in its own slot, the paper it takes in the flap's, the paper it gives
//! up in the layer that takes it. What lands is checked like every compound
//! fold, and each order a choice offers is landed before it is offered.
use super::CompoundRefused;
use super::folded_swivel::{flat_region, ray_run};
use super::pieces::{Cut, Scoring, score_cuts};
use super::swivel::{
    SwivelCrease, SwivelFold, SwivelKind, SwivelRay, SwivelRegion, SwivelWedge, dot, internal, sub,
};
use super::vertex::{Compiled, VertexChoices, VertexFoldKind, VertexOutcome, unit};
use crate::complete::CompletionLimits;
use crate::fold::line::Axis;
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::{CreaseKind, FaceId, Letter, opposite};
use crate::refusal::{FoldRefusal, Refused, Side};
use crate::state::State;
use crate::view::Direction;
use oristudio_geometry::{Line, convex};
use std::collections::{HashMap, HashSet};
use std::f64::consts::{PI, TAU};
type Point = [f64; 2];

/// The least angle between a line and a hinge, in radians.
const APART: f64 = 1e-6;

/// The wedges by block: the flap's paper that unfolds, the flap that turns,
/// the other layer's paper that folds in with it.
const NEAR: usize = 0;
const FLAP: usize = 1;
const TURN: usize = 2;

/// One of the two new creases: its model line and unit direction from the
/// vertex, where it leaves the paper it creases, the face position it starts
/// in, and its letter as the viewer sees it on the flap.
#[derive(Debug, Clone)]
pub(super) struct NewCrease {
    pub(super) line: Line,
    pub(super) direction: Point,
    pub(super) end: Point,
    pub(super) layer: usize,
    pub(super) letter: Letter,
}

/// A flap turned about its hinges' end, compiled in its parent.
#[derive(Debug, Clone)]
pub(super) struct HingeEnd {
    pub(super) vertex: Point,
    /// Face positions at the vertex: the flap beside the hinge it leaves,
    /// the layer across that hinge, and the layer the flap takes paper from.
    flap: usize,
    gives: usize,
    takes: usize,
    /// The hinge the flap leaves, from the vertex to its far end.
    leaves: [Point; 2],
    /// The crease on the flap and the one in the layer it takes paper from.
    pub(super) on_flap: NewCrease,
    pub(super) in_layer: NewCrease,
    pub(super) compiled: Compiled,
}

/// Which flaps a reading takes: those whose two hinges show them a valley and
/// a mountain, or those whose hinges show them one letter (module docs).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Hinges {
    TwoLetters,
    OneLetter,
}

/// The flap a valley and a mountain turn, before it is compiled: angles on
/// the sheet, counter-clockwise, at the vertex `w`.
struct Plan {
    w: Point,
    /// The flap's hinges, `a` then `b` counter-clockwise, and the folds
    /// before `a` and after `b`.
    a: f64,
    b: f64,
    prev: f64,
    next: f64,
    /// How far inside its hinge each new crease lies.
    psi: f64,
    /// The flap leaves `a` and takes paper from beyond `b`; otherwise it
    /// leaves `b` and takes paper from before `a`.
    toward_a: bool,
    /// Face positions: the flap beside `a` and beside `b`, the layer before
    /// `a` and the one after `b`.
    flap_a: usize,
    flap_b: usize,
    before: usize,
    after: usize,
    /// The crease on the flap's letter, as named.
    flap_letter: Letter,
    /// The letters its hinges show it.
    hinges: Hinges,
}

/// `angle`'s unit direction.
fn heading(angle: f64) -> Point {
    let (s, c) = angle.sin_cos();
    [c, s]
}

/// The counter-clockwise angle from `from` to `to`, in [0, 2π).
fn sweep(from: f64, to: f64) -> f64 {
    (to - from).rem_euclid(TAU)
}

/// The sheet point a short way from `w` along `angle`.
fn near(w: Point, angle: f64) -> Point {
    let d = heading(angle);
    let r = MIN_FEATURE / 4.0;
    [w[0] + r * d[0], w[1] + r * d[1]]
}

/// The model unit direction of the sheet direction `angle` at `w`, through
/// face position `f`.
fn model_heading(state: &State, f: usize, w: Point, angle: f64) -> Option<Point> {
    let t = state.geometry().isometries[f];
    let d = heading(angle);
    unit(sub(t.apply([w[0] + d[0], w[1] + d[1]]), t.apply(w)))
}

/// The sheet angle of the model direction `u` at the model point `v`,
/// through face position `f`.
fn sheet_angle(state: &State, f: usize, v: Point, u: Point) -> f64 {
    let t = state.geometry().isometries[f].inverse();
    let d = sub(t.apply([v[0] + u[0], v[1] + u[1]]), t.apply(v));
    d[1].atan2(d[0])
}

/// The face position whose sheet polygon holds a point a short way from `w`
/// inside the sector from `from` sweeping `width`, near `from` when `share`
/// is small; the first of a few tries that is off every crease.
fn face_in(state: &State, w: Point, from: f64, width: f64, share: &[f64]) -> Option<usize> {
    share
        .iter()
        .find_map(|&s| state.face_at(near(w, from + s * width)))
        .and_then(|id| state.face_position(id))
}

/// Whether the viewer sees the flap from `a` sweeping `width` at the sheet
/// vertex `at` along the crease named on it, `on_flap` inside `a`: its paper
/// on either side of that crease, a short way from the vertex, is on top.
fn seen_along(state: &State, at: Point, a: f64, width: f64, on_flap: f64) -> bool {
    let crease = a + on_flap;
    [crease - on_flap / 8.0, crease + (width - on_flap) / 8.0]
        .iter()
        .all(|&angle| {
            let p = near(at, angle);
            state
                .face_at(p)
                .and_then(|id| state.face_position(id))
                .is_some_and(|f| seen_at(state, f, state.geometry().isometries[f].apply(p)))
        })
}

/// The plans the two lines name at sheet vertex `w`: per flap among its four
/// folds that both lines run into, whose hinges show it the letters `hinges`
/// asks for, each way it can turn with the room it needs.
fn plans_at(
    state: &State,
    w: usize,
    v: Point,
    valley: &Line,
    mountain: &Line,
    kind: SwivelKind,
    hinges: Hinges,
) -> Vec<Plan> {
    let sheet = state.vertices();
    let at = sheet[w];
    let mut folds: Vec<(f64, Letter)> = Vec::new();
    for crease in state.creases() {
        let [p, q] = crease.vertices.map(|x| x.index());
        if p != w && q != w {
            continue;
        }
        let other = sheet[if p == w { q } else { p }];
        let d = sub(other, at);
        match crease.kind {
            // On the paper's raw edge: no flap turns there.
            CreaseKind::Border => return Vec::new(),
            CreaseKind::Folded(letter) => folds.push((d[1].atan2(d[0]).rem_euclid(TAU), letter)),
            CreaseKind::Flat(_) => {}
        }
    }
    if folds.len() != 4 {
        return Vec::new();
    }
    folds.sort_by(|x, y| x.0.total_cmp(&y.0));
    let mut plans = Vec::new();
    for i in 0..4 {
        let fold = |k: usize| folds[(i + k) % 4];
        let ((a, letter_a), (b, letter_b)) = (fold(0), fold(1));
        let (next, prev) = (fold(2).0, fold(3).0);
        let width = sweep(a, b);
        if width >= PI - APART {
            continue;
        }
        let (Some(flap_a), Some(flap_b), Some(before), Some(after)) = (
            face_in(state, at, a, width, &[0.125, 0.25]),
            face_in(state, at, b, -width, &[0.125, 0.25]),
            face_in(state, at, a, -sweep(prev, a), &[0.125, 0.25]),
            face_in(state, at, b, sweep(b, next), &[0.125, 0.25]),
        ) else {
            continue;
        };
        // Each named line's ray into the flap, by its angle inside `a`.
        let inside = |line: &Line| -> Option<f64> {
            let u = unit(line.direction())?;
            [u, [-u[0], -u[1]]].into_iter().find_map(|d| {
                let theta = sweep(a, sheet_angle(state, flap_a, v, d));
                (theta > APART && theta < width - APART).then_some(theta)
            })
        };
        let (Some(at_valley), Some(at_mountain)) = (inside(valley), inside(mountain)) else {
            continue;
        };
        let one_letter = letter_a == letter_b;
        if (at_valley - at_mountain).abs() <= APART || one_letter != (hinges == Hinges::OneLetter) {
            continue;
        }
        let Some(up) = state.seen_front_up(state.faces()[flap_a].id) else {
            continue;
        };
        let seen = |letter: Letter| if up { letter } else { opposite(letter) };
        // The crease on the flap keeps the letter of the hinge it lies
        // inside: the flap leaves that hinge. Hinges of one letter both have
        // it, or neither does.
        let (flap_letter, on_flap) = match kind {
            SwivelKind::Open => (Letter::Mountain, at_mountain),
            SwivelKind::Inside => (Letter::Valley, at_valley),
        };
        let keeps_a = seen(letter_a) == flap_letter;
        // Hinges of one letter: only a flap the lines are drawn on, which the
        // viewer sees along the crease named on it.
        let ways: &[bool] = match (one_letter, keeps_a) {
            (false, toward_a) => &[toward_a],
            (true, true) if seen_along(state, at, a, width, on_flap) => &[true, false],
            (true, _) => &[],
        };
        for &toward_a in ways {
            let psi = if toward_a { on_flap } else { width - on_flap };
            let room = if toward_a {
                sweep(b, next)
            } else {
                sweep(prev, a)
            };
            if psi >= room - APART {
                continue;
            }
            plans.push(Plan {
                w: at,
                a,
                b,
                prev,
                next,
                psi,
                toward_a,
                flap_a,
                flap_b,
                before,
                after,
                flap_letter,
                hinges,
            });
        }
    }
    plans
}

/// Union-find root.
fn root(parent: &mut [usize], mut a: usize) -> usize {
    while parent[a] != a {
        parent[a] = parent[parent[a]];
        a = parent[a];
    }
    a
}

impl HingeEnd {
    /// The flap the valley and the mountain turn about where its hinges end
    /// (module docs), compiled. None when they name no such flap; refused
    /// as a meeting the lines do not settle when they name several. A flap
    /// whose hinges show it one letter is read only where those that show
    /// theirs two name none that turns; where that one refuses too, the
    /// first refusal stands.
    pub(super) fn reading(
        state: &State,
        valley: &Line,
        mountain: &Line,
        kind: SwivelKind,
    ) -> Result<Option<HingeEnd>, Refused> {
        let Some(v) = valley.intersect(mountain) else {
            return Ok(None);
        };
        let images = &state.geometry().vertex_images;
        let plans = |hinges: Hinges| -> Vec<Plan> {
            let mut plans = Vec::new();
            for (w, image) in images.iter().enumerate() {
                if sub(*image, v)[0].hypot(sub(*image, v)[1]) <= MIN_FEATURE / 2.0 {
                    plans.extend(plans_at(state, w, *image, valley, mountain, kind, hinges));
                }
            }
            plans
        };
        let meeting = || Refused::from(FoldRefusal::SwivelLineMeeting);
        let compile = |mut plans: Vec<Plan>| {
            let plan = plans.pop().ok_or_else(|| internal("no plan"))?;
            Self::compile(state, &plan, valley, mountain)
        };
        let two = plans(Hinges::TwoLetters);
        let refused = match two.len() {
            0 => None,
            1 => match compile(two) {
                Ok(turn) => return Ok(Some(turn)),
                Err(refused) => Some(refused),
            },
            _ => return Err(meeting()),
        };
        let one = plans(Hinges::OneLetter);
        match (one.len(), refused) {
            (0, None) => Ok(None),
            (0, Some(refused)) => Err(refused),
            (1, refused) => match compile(one) {
                Ok(turn) => Ok(Some(turn)),
                Err(own) => Err(refused.unwrap_or(own)),
            },
            (_, refused) => Err(refused.unwrap_or_else(meeting)),
        }
    }

    fn compile(
        state: &State,
        plan: &Plan,
        valley: &Line,
        mountain: &Line,
    ) -> Result<HingeEnd, Refused> {
        let Plan {
            w,
            a,
            b,
            psi,
            toward_a,
            flap_a,
            flap_b,
            before,
            after,
            ..
        } = *plan;
        let geometry = state.geometry();
        let v = geometry.isometries[flap_a].apply(w);
        // Toward `a`: the flap leaves `a`, its crease ψ past `a` on the flap,
        // the layer after `b` creased ψ past `b`. Toward `b`, the mirror.
        let (leaves_angle, flap_crease, layer_crease) = if toward_a {
            (a, a + psi, b + psi)
        } else {
            (b, b - psi, a - psi)
        };
        let (flap, gives, takes, flap_other) = if toward_a {
            (flap_a, before, after, flap_b)
        } else {
            (flap_b, after, before, flap_a)
        };
        let direction = |f: usize, angle: f64| {
            model_heading(state, f, w, angle).ok_or_else(|| internal("a hinge has no direction"))
        };
        let along = |d: Point| {
            Line::from_point_direction(v, d).ok_or_else(|| internal("a crease has no line"))
        };
        let leaves_dir = direction(flap, leaves_angle)?;
        let leaves_line = along(leaves_dir)?;
        let flap_dir = direction(flap, flap_crease)?;
        let layer_dir = direction(takes, layer_crease)?;
        let (flap_line, layer_line) = (along(flap_dir)?, along(layer_dir)?);
        // The crease found on the flap is the line named for it.
        let flap_letter = plan.flap_letter;
        let named = match flap_letter {
            Letter::Valley => valley,
            Letter::Mountain => mountain,
        };
        if !flap_line.approx_eq_within(named, 1e-6) {
            return Err(internal("a hinge-end swivel's crease is not its line"));
        }
        let flap_run = ray_run(state, flap, v, flap_dir)?;
        let layer_run = ray_run(state, takes, v, layer_dir)?;
        let nf = state.faces().len();
        let mask = |faces: &[usize]| {
            let mut mask = vec![false; nf];
            for &f in faces {
                mask[f] = true;
            }
            mask
        };
        let scoring = score_cuts(
            state,
            &[
                Cut {
                    axis: Axis::new(&flap_line, Side::Positive),
                    faces: mask(&flap_run.faces),
                },
                Cut {
                    axis: Axis::new(&layer_line, Side::Positive),
                    faces: mask(&layer_run.faces),
                },
            ],
        )?;
        let reach = |end: Point| sub(end, v)[0].hypot(sub(end, v)[1]);
        let block_of = blocks(
            state,
            plan,
            &scoring,
            [
                (flap_crease, reach(flap_run.end)),
                (layer_crease, reach(layer_run.end)),
            ],
        )?
        .map_err(|faces| Refused::from(FoldRefusal::FanRayBlocked { faces }))?;
        let turns = vec![
            vec![(0, leaves_line)],
            vec![
                (0, leaves_line),
                (
                    1,
                    leaves_line
                        .reflect_line(&flap_line)
                        .ok_or_else(|| internal("a reflected crease has no line"))?,
                ),
            ],
            vec![(1, layer_line)],
        ];
        let extra = seeds(state, &scoring, &block_of, [flap, gives, flap_other]);
        let leaves_end = state
            .creases()
            .iter()
            .filter(|c| c.kind.is_folded())
            .find_map(|c| {
                let [p, q] = c.vertices.map(|x| state.vertices()[x.index()]);
                let (at, other) = if sub(p, w)[0].hypot(sub(p, w)[1]) <= TOL {
                    (p, q)
                } else if sub(q, w)[0].hypot(sub(q, w)[1]) <= TOL {
                    (q, p)
                } else {
                    return None;
                };
                let d = sub(other, at);
                let angle = d[1].atan2(d[0]);
                (sweep(leaves_angle, angle).min(sweep(angle, leaves_angle)) <= APART)
                    .then(|| geometry.isometries[flap].apply(other))
            })
            .ok_or_else(|| internal("the hinge the flap leaves has no end"))?;
        Ok(HingeEnd {
            vertex: v,
            flap,
            gives,
            takes,
            leaves: [v, leaves_end],
            on_flap: NewCrease {
                line: flap_line,
                direction: flap_dir,
                end: flap_run.end,
                layer: flap,
                letter: flap_letter,
            },
            in_layer: NewCrease {
                line: layer_line,
                direction: layer_dir,
                end: layer_run.end,
                layer: takes,
                letter: opposite(flap_letter),
            },
            compiled: Compiled {
                kind: VertexFoldKind::Swivel,
                scoring,
                block_of,
                turns,
                vertices: vec![v],
                direction: state.view().model_direction(Direction::Valley),
                extra,
                against: Some(Vec::new()),
            },
        })
    }

    /// Land it; each order a choice offers is landed before it is offered.
    pub(super) fn land(
        &self,
        state: &State,
        choices: &VertexChoices,
        limits: &CompletionLimits,
    ) -> Result<VertexOutcome, CompoundRefused> {
        self.compiled
            .land_checked(state, choices, limits, || None, true)
    }

    /// The parent's faces that move.
    pub(super) fn moving(&self, state: &State) -> Vec<FaceId> {
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

    /// The paper that moves, by wedge, as model-frame polygons: the flap's
    /// paper that unfolds (near), the flap (beyond), the paper it takes in
    /// (turn).
    pub(super) fn regions(&self, state: &State) -> Vec<SwivelRegion> {
        let scoring = &self.compiled.scoring;
        let wedges = [SwivelWedge::Near, SwivelWedge::Beyond, SwivelWedge::Turn];
        self.compiled
            .block_of
            .iter()
            .enumerate()
            .filter_map(|(p, b)| {
                let t = state.geometry().isometries[scoring.old[p]];
                let mut polygon: Vec<Point> =
                    scoring.polygon(p).into_iter().map(|q| t.apply(q)).collect();
                if !t.front_up() {
                    polygon.reverse();
                }
                b.map(|b| SwivelRegion {
                    wedge: wedges[b],
                    polygon,
                })
            })
            .collect()
    }

    /// Its creases as a tool previews them: the one on the flap, as named,
    /// then the one computed in the layer it takes paper from, by the other
    /// letter; each dotted where paper the viewer sees lies over it.
    pub(super) fn creases(&self, state: &State) -> Vec<SwivelCrease> {
        let v = self.vertex;
        [
            (&self.on_flap, SwivelRay::Meet),
            (&self.in_layer, SwivelRay::Hinge),
        ]
        .into_iter()
        .map(|(crease, ray)| SwivelCrease {
            ray,
            direction: crease.direction,
            from: v,
            to: crease.end,
            letter: crease.letter,
            ridge: false,
            hidden: !seen_at(
                state,
                crease.layer,
                [(v[0] + crease.end[0]) / 2.0, (v[1] + crease.end[1]) / 2.0],
            ),
        })
        .collect()
    }

    /// The two layers it creases, the flap first.
    pub(super) fn layers(&self, state: &State) -> Vec<FaceId> {
        vec![state.faces()[self.flap].id, state.faces()[self.takes].id]
    }

    /// The hinge the flap leaves, which opens.
    pub(super) fn fold(&self, state: &State) -> SwivelFold {
        let mut faces = vec![state.faces()[self.flap].id, state.faces()[self.gives].id];
        faces.sort_unstable();
        SwivelFold {
            edge: self.leaves,
            opens: self.leaves,
            faces,
        }
    }
}

/// Whether the viewer sees paper of `layer`'s flat region on top at the
/// model point `p`.
fn seen_at(state: &State, layer: usize, p: Point) -> bool {
    let Some(stack) = state.stack_at(p) else {
        return false;
    };
    let top = if state.view().flipped {
        stack.last()
    } else {
        stack.first()
    };
    let region = flat_region(state, layer);
    top.and_then(|&id| state.face_position(id))
        .is_some_and(|f| region[f])
}

/// Each scored piece's block (module docs); or, where paper holds two of
/// them together, that paper. `new` is each new crease's sheet angle and how
/// far it runs from the vertex.
fn blocks(
    state: &State,
    plan: &Plan,
    scoring: &Scoring,
    new: [(f64, f64); 2],
) -> Result<Result<Vec<Option<usize>>, Vec<FaceId>>, Refused> {
    let Plan {
        w,
        a,
        b,
        prev,
        next,
        toward_a,
        ..
    } = *plan;
    let [(flap_crease, _), (layer_crease, _)] = new;
    let key = |p: usize, q: usize| (p.min(q), p.max(q));
    // The hinges both open; the new creases are cut, and for a flap whose
    // hinges show it one letter so is a precrease they run along (one whose
    // hinges show it two refuses there, as it always has). Paper is joined
    // across every other crease.
    let on_ray = |angle: f64, reach: f64, p: Point, q: Point| {
        let d = heading(angle);
        [p, q].iter().all(|&x| {
            let r = sub(x, w);
            (d[0] * r[1] - d[1] * r[0]).abs() <= TOL
                && dot(d, r) >= -TOL
                && dot(d, r) <= reach + TOL
        })
    };
    let on_hinge = |p: Point, q: Point| {
        [a, b]
            .iter()
            .any(|&angle| on_ray(angle, f64::INFINITY, p, q))
    };
    let on_new = |p: Point, q: Point| new.iter().any(|&(angle, reach)| on_ray(angle, reach, p, q));
    let mut cut: HashSet<(usize, usize)> = HashSet::new();
    for crease in &scoring.creases {
        let [p, q] = crease.vertices.map(|x| x.index());
        let (x, y) = (scoring.vertices[p], scoring.vertices[q]);
        let created = scoring.created.binary_search(&crease.id).is_ok();
        let hinge = crease.kind.is_folded() && on_hinge(x, y);
        let precrease = plan.hinges == Hinges::OneLetter
            && matches!(crease.kind, CreaseKind::Flat(_))
            && on_new(x, y);
        if created || hinge || precrease {
            cut.insert(key(p, q));
        }
    }
    let count = scoring.faces.len();
    let mut sides: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    for (p, face) in scoring.faces.iter().enumerate() {
        let m = face.ring.len();
        for i in 0..m {
            let edge = key(face.ring[i].index(), face.ring[(i + 1) % m].index());
            sides.entry(edge).or_default().push(p);
        }
    }
    let mut parent: Vec<usize> = (0..count).collect();
    for (side, faces) in &sides {
        if let [p, q] = faces[..]
            && !cut.contains(side)
        {
            let (rp, rq) = (root(&mut parent, p), root(&mut parent, q));
            parent[rp.max(rq)] = rp.min(rq);
        }
    }
    let component: Vec<usize> = (0..count).map(|p| root(&mut parent, p)).collect();
    // The piece a short way into a sector at the vertex.
    let piece = |from: f64, to: f64| -> Result<usize, Refused> {
        let width = sweep(from, to);
        [0.5, 0.3, 0.7]
            .iter()
            .find_map(|&s| {
                let q = near(w, from + s * width);
                (0..count).find(|&p| convex::contains_point(&scoring.polygon(p), q, -TOL))
            })
            .map(|p| component[p])
            .ok_or_else(|| internal("a hinge-end swivel's wedge has no paper at the vertex"))
    };
    let (near_wedge, flap, turn, stays) = if toward_a {
        (
            piece(a, flap_crease)?,
            piece(flap_crease, b)?,
            piece(b, layer_crease)?,
            [
                piece(prev, a)?,
                piece(layer_crease, next)?,
                piece(next, prev)?,
            ],
        )
    } else {
        (
            piece(flap_crease, b)?,
            piece(a, flap_crease)?,
            piece(layer_crease, a)?,
            [
                piece(prev, layer_crease)?,
                piece(b, next)?,
                piece(next, prev)?,
            ],
        )
    };
    if stays.iter().any(|&c| c != stays[0]) {
        return Err(internal("the paper that stays is in two parts"));
    }
    let wedges = [near_wedge, flap, turn];
    for (i, &c) in wedges.iter().enumerate() {
        if c == stays[0] || wedges[..i].contains(&c) {
            let mut ids: Vec<FaceId> = (0..count)
                .filter(|&p| component[p] == c)
                .map(|p| state.faces()[scoring.old[p]].id)
                .collect();
            ids.sort_unstable();
            ids.dedup();
            return Ok(Err(ids));
        }
    }
    let block_of = (0..count)
        .map(|p| wedges.iter().position(|&c| c == component[p]))
        .collect();
    Ok(Ok(block_of))
}

/// The seeds that keep each piece in its place against the paper that
/// stays (module docs), as `[upper, lower]` scored positions: the flap's
/// own pieces as the flap was, the paper it gives up as the layer it joins
/// (`gives`), the paper it takes in as the flap beside that paper
/// (`flap_other`); and the flap over or under the paper it gives up as it
/// was over or under that layer.
fn seeds(
    state: &State,
    scoring: &Scoring,
    block_of: &[Option<usize>],
    [flap, gives, flap_other]: [usize; 3],
) -> Vec<[usize; 2]> {
    let id = |f: usize| state.faces()[f].id;
    let mut pairs: Vec<[usize; 2]> = Vec::new();
    let mut seen: HashSet<(usize, usize)> = HashSet::new();
    let mut push = |upper: usize, lower: usize| {
        if seen.insert((upper.min(lower), upper.max(lower))) {
            pairs.push([upper, lower]);
        }
    };
    let flap_region = flat_region(state, flap);
    let count = scoring.faces.len();
    if let Some(above) = state.above(id(flap), id(gives)) {
        for p in (0..count).filter(|&p| block_of[p] == Some(FLAP) && flap_region[scoring.old[p]]) {
            for q in (0..count).filter(|&q| block_of[q] == Some(NEAR)) {
                if above {
                    push(p, q);
                } else {
                    push(q, p);
                }
            }
        }
    }
    for p in 0..count {
        let Some(block) = block_of[p] else {
            continue;
        };
        let proxy = match block {
            NEAR => gives,
            TURN => flap_other,
            _ => scoring.old[p],
        };
        for s in (0..count).filter(|&s| block_of[s].is_none()) {
            let g = scoring.old[s];
            if g == proxy {
                continue;
            }
            match state.above(id(proxy), id(g)) {
                Some(true) => push(p, s),
                Some(false) => push(s, p),
                None => {}
            }
        }
    }
    pairs
}
