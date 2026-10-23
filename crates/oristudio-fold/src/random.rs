//! Seeded random fold sequences (feature `random-sequences`; plan D19): the
//! draws the engine's property tests make, for the crates that check the engine
//! from outside it — the oracles in `crates/oracle-tests` (plan D8).
//!
//! A sequence starts from a drawn sheet (square half the time, otherwise a
//! rectangle or a regular polygon) and start side, then draws one operation per
//! step: a turn-over or a rotation now and then, otherwise a plain fold — or a
//! precrease — along a line through landmarks: two vertex images, their
//! perpendicular bisector, a crease's line, the bisector of two creases, a
//! vertex at a sixteenth of a turn, plus a few free lines. Seeds are all
//! layers, a depth at a sheet point on the moving side, or one of the flaps.
//!
//! `tests/random.rs` runs its property campaign on these sequences, and every
//! other seeded test and example in the crate draws from [`Rng`]. Everything
//! replays exactly from the seed: the generator is SplitMix64 and no draw
//! depends on anything but the state and the generator.

use std::collections::BTreeSet;
use std::f64::consts::{PI, TAU};

use oristudio_geometry::Line;
use oristudio_geometry::convex::{self, HalfPlane};

use crate::compound::crimp::CrimpFold;
use crate::compound::reverse::{ReverseFold, ReverseKind};
use crate::compound::squash::Squash;
use crate::compound::tuck::TuckFold;
use crate::fold::{Folded, PlainFold, Seed};
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::{FaceId, VertexId};
use crate::refusal::{FoldRefusal, Refused, Side};
use crate::sheet::Sheet;
use crate::state::State;
use crate::view::{Direction, StartSide};

type Point = [f64; 2];

/// SplitMix64: no dependency, and it replays exactly from its seed.
#[derive(Debug, Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed)
    }

    /// Uniform in `[0, 1)`.
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
    }

    /// Uniform in `0..n`; 0 when `n` is 0.
    pub fn below(&mut self, n: usize) -> usize {
        ((self.next_f64() * n as f64) as usize).min(n.saturating_sub(1))
    }

    pub fn chance(&mut self, p: f64) -> bool {
        self.next_f64() < p
    }

    /// One of `items`; none when there are none (the draw is still made).
    pub fn pick<T: Copy>(&mut self, items: &[T]) -> Option<T> {
        items.get(self.below(items.len())).copied()
    }
}

/// One drawn operation.
#[derive(Debug, Clone, PartialEq)]
pub enum Op {
    Fold(PlainFold),
    Precrease(PlainFold),
    TurnOver,
    /// Rotate the view by this many radians, counter-clockwise.
    Rotate(f64),
}

/// What a drawn operation did.
#[derive(Debug, Clone)]
pub enum Outcome {
    /// A fold or precrease landed.
    Landed(Box<Folded>),
    /// A turn-over or rotation: the same model, seen another way.
    Viewed(State),
    /// The engine refused it; the sequence stays where it was.
    Refused(Refused),
}

/// One step of a sequence.
#[derive(Debug, Clone)]
pub struct Step {
    /// The state the operation was drawn for.
    pub parent: State,
    pub op: Op,
    pub outcome: Outcome,
}

impl Step {
    /// The state the sequence moved to; none when the operation was refused.
    pub fn state(&self) -> Option<&State> {
        match &self.outcome {
            Outcome::Landed(folded) => Some(&folded.state),
            Outcome::Viewed(state) => Some(state),
            Outcome::Refused(_) => None,
        }
    }
}

/// A random sequence: an iterator over its steps. It stops after `steps`
/// draws, or before a draw once the state has more than `max_faces` faces. A
/// draw with nothing to fold along uses up its step and yields nothing.
#[derive(Debug, Clone)]
pub struct Sequence {
    rng: Rng,
    state: State,
    draws_left: usize,
    max_faces: usize,
}

impl Sequence {
    /// The sequence `seed` names, from its drawn sheet and start side.
    pub fn new(seed: u64, steps: usize, max_faces: usize) -> Result<Sequence, FoldRefusal> {
        let mut rng = Rng::new(seed);
        let start = if rng.chance(0.2) {
            StartSide::Back
        } else {
            StartSide::Front
        };
        let state = State::flat(sheet(&mut rng)?, start)?;
        Ok(Sequence {
            rng,
            state,
            draws_left: steps,
            max_faces,
        })
    }

    /// Where the sequence is now.
    pub fn state(&self) -> &State {
        &self.state
    }
}

impl Iterator for Sequence {
    type Item = Step;

    fn next(&mut self) -> Option<Step> {
        while self.draws_left > 0 && self.state.faces().len() <= self.max_faces {
            self.draws_left -= 1;
            let parent = self.state.clone();
            let x = self.rng.next_f64();
            let (op, outcome) = if x < 0.06 {
                (Op::TurnOver, Outcome::Viewed(parent.turn_over()))
            } else if x < 0.1 {
                let angle = self.rng.next_f64() * TAU;
                (Op::Rotate(angle), Outcome::Viewed(parent.rotate(angle)))
            } else {
                let Some(fold) = plain_fold(&parent, &mut self.rng) else {
                    continue;
                };
                let precrease = x < 0.2;
                let result = if precrease {
                    parent.precrease(&fold)
                } else {
                    parent.fold(&fold)
                };
                let outcome = match result {
                    Ok(folded) => Outcome::Landed(Box::new(folded)),
                    Err(refused) => Outcome::Refused(refused),
                };
                let op = if precrease {
                    Op::Precrease(fold)
                } else {
                    Op::Fold(fold)
                };
                (op, outcome)
            };
            let step = Step {
                parent,
                op,
                outcome,
            };
            if let Some(state) = step.state() {
                self.state = state.clone();
            }
            return Some(step);
        }
        None
    }
}

/// A drawn sheet: square half the time, a rectangle a quarter, otherwise a
/// regular polygon of 3 to 8 sides.
pub fn sheet(rng: &mut Rng) -> Result<Sheet, FoldRefusal> {
    let x = rng.next_f64();
    if x < 0.5 {
        Ok(Sheet::square())
    } else if x < 0.75 {
        Sheet::rectangle(0.4 + rng.next_f64(), 1.0)
    } else {
        Sheet::regular(3 + rng.below(6) as u32)
    }
}

/// A drawn plain fold of `state`: a line through landmarks, a side, a
/// direction and a seed. None when the draw has nothing to fold along (two
/// coincident landmarks, parallel creases, no moving-side point found).
pub fn plain_fold(state: &State, rng: &mut Rng) -> Option<PlainFold> {
    let line = line(state, rng)?;
    plain_fold_along(state, line, rng)
}

/// A drawn plain fold of `state` along `line`: the side, direction and seed
/// [`plain_fold`] draws after its line, for a test that draws lines its own
/// way. None when a depth seed finds no moving-side point.
pub fn plain_fold_along(state: &State, line: Line, rng: &mut Rng) -> Option<PlainFold> {
    let side = if rng.chance(0.5) {
        Side::Positive
    } else {
        Side::Negative
    };
    let direction = if rng.chance(0.5) {
        Direction::Valley
    } else {
        Direction::Mountain
    };
    let op = PlainFold::new(line, side, direction);
    let x = rng.next_f64();
    let seed = if x < 0.4 {
        Seed::All
    } else if x < 0.85 {
        let at = moving_side_point(state, &line, side, rng)?;
        let stack = state.stack_at(state.image_of(at)?)?.len().max(1);
        Seed::Depth {
            at,
            layers: 1 + rng.below(stack),
        }
    } else {
        let flaps = state.analyse_fold(&op).ok()?.flaps;
        let flap = flaps.get(rng.below(flaps.len()))?;
        Seed::Flaps {
            at: vec![flap.witness],
        }
    };
    Some(op.with_seed(seed))
}

/// A drawn starting state for a compound-fold campaign, as the compound
/// spike's start (`campaign-reverse.mjs`): one to four plain folds, each
/// drawn by [`plain_fold`], of a square, or a fifth of the time a 1:2
/// rectangle, in at most ten draws.
pub fn folded(rng: &mut Rng) -> Result<State, FoldRefusal> {
    folded_between(rng, 1, 4)
}

/// [`folded`] with `least` to `most` plain folds: the tuck spike's start
/// (`campaign-tuck.mjs`) takes two to four.
pub fn folded_between(rng: &mut Rng, least: usize, most: usize) -> Result<State, FoldRefusal> {
    let sheet = if rng.chance(0.2) {
        Sheet::rectangle(1.0, 2.0)?
    } else {
        Sheet::square()
    };
    let mut state = State::flat(sheet, StartSide::Front)?;
    let want = least + rng.below(most.saturating_sub(least) + 1);
    let mut landed = 0;
    for _ in 0..10 {
        if landed >= want {
            break;
        }
        let Some(op) = plain_fold(&state, rng) else {
            continue;
        };
        if let Ok(folded) = state.fold(&op) {
            state = folded.state;
            landed += 1;
        }
    }
    Ok(state)
}

/// A drawn inside reverse fold of `state`, as the compound spike's campaign
/// draws them (research `r2-spike-reverse-crimp-tuck`, `campaign-reverse.mjs`):
/// a folded crease at least 0.05 long as the spine, a point a random
/// 15–85% along it, and ℓ through that point perpendicular to the spine with
/// probability `perpendicular`, otherwise at 12°–168° to it; a random tip
/// side; the tip grown from the spine's two faces (each named by a sheet
/// point of its paper on the tip side). None when the drawn crease is too
/// short or neither face has paper on the drawn side.
pub fn reverse_fold(state: &State, rng: &mut Rng, perpendicular: f64) -> Option<ReverseFold> {
    let folded: Vec<usize> = (0..state.creases().len())
        .filter(|&k| state.creases()[k].kind.is_folded())
        .collect();
    let k = rng.pick(&folded)?;
    let [a, b] = state.creases()[k].vertices.map(|v| state.vertex_image(v));
    let (a, b) = (a?, b?);
    let length = (b[0] - a[0]).hypot(b[1] - a[1]);
    if length < 0.05 {
        return None;
    }
    let t = 0.15 + 0.7 * rng.next_f64();
    let q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    let u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    let angle = if rng.chance(perpendicular) {
        PI / 2.0
    } else {
        (12.0 + 156.0 * rng.next_f64()).to_radians()
    };
    let (s, c) = angle.sin_cos();
    let line = Line::from_point_direction(q, [u[0] * c - u[1] * s, u[0] * s + u[1] * c])?;
    let side = if rng.chance(0.5) {
        Side::Positive
    } else {
        Side::Negative
    };
    let half = HalfPlane::new(
        match side {
            Side::Positive => line.n,
            Side::Negative => [-line.n[0], -line.n[1]],
        },
        match side {
            Side::Positive => line.d,
            Side::Negative => -line.d,
        },
    )?;
    let at: Vec<Point> = state.topology().crease_faces[k]
        .iter()
        .filter_map(|&f| {
            let id = state.faces()[f].id;
            let piece = convex::split(state.face_image(id)?, &half, TOL).inside;
            let centroid = convex::centroid(&piece)?;
            (half.signed_distance(centroid) > TOL)
                .then(|| state.isometry(id).map(|t| t.inverse().apply(centroid)))
                .flatten()
        })
        .collect();
    (!at.is_empty()).then_some(ReverseFold {
        line,
        side,
        anchor: Seed::Flaps { at },
        kind: ReverseKind::Inside,
    })
}

/// A drawn crimp of `state`, as the reverse spike's crimp campaign draws
/// them (`campaign-crimp.mjs`): a folded crease at least 0.12 long as the
/// spine, a random end of it as the tip's; two points on it, the first
/// 15–65% along and the second 8% or more past it short of 85%; ℓ1 and ℓ2
/// through them, both perpendicular to the spine with probability
/// `parallel`, otherwise each at 20°–160° to it; the tip side of ℓ1 the
/// second point's, and the tip grown from the spine's two faces. Inside;
/// a test asks for the other kind itself. None when the drawn crease is too
/// short, the lines meet over the model (within 0.05 of its box), or
/// neither face has paper on the tip side.
pub fn crimp_fold(state: &State, rng: &mut Rng, parallel: f64) -> Option<CrimpFold> {
    let folded: Vec<usize> = (0..state.creases().len())
        .filter(|&k| state.creases()[k].kind.is_folded())
        .collect();
    let k = rng.pick(&folded)?;
    let [a, b] = state.creases()[k].vertices.map(|v| state.vertex_image(v));
    let (mut a, mut b) = (a?, b?);
    let length = (b[0] - a[0]).hypot(b[1] - a[1]);
    if length < 0.12 {
        return None;
    }
    if rng.chance(0.5) {
        std::mem::swap(&mut a, &mut b);
    }
    let t1 = 0.15 + 0.5 * rng.next_f64();
    let t2 = t1 + 0.08 + (0.85 - t1 - 0.08) * rng.next_f64();
    let at = |t: f64| [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    let (q1, q2) = (at(t1), at(t2));
    let u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    let both = rng.chance(parallel);
    let mut direction = || {
        let angle = if both {
            PI / 2.0
        } else {
            (20.0 + 140.0 * rng.next_f64()).to_radians()
        };
        let (s, c) = angle.sin_cos();
        [u[0] * c - u[1] * s, u[0] * s + u[1] * c]
    };
    let (d1, d2) = (direction(), direction());
    let first = Line::from_point_direction(q1, d1)?;
    let second = Line::from_point_direction(q2, d2)?;
    if !both && let Some(x) = first.intersect(&second) {
        let images: Vec<Point> = (0..state.vertices().len())
            .filter_map(|v| state.vertex_image(VertexId(v as u32)))
            .collect();
        let (x0, y0, x1, y1) = images.iter().fold(
            (
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ),
            |e, p| (e.0.min(p[0]), e.1.min(p[1]), e.2.max(p[0]), e.3.max(p[1])),
        );
        if x[0] > x0 - 0.05 && x[0] < x1 + 0.05 && x[1] > y0 - 0.05 && x[1] < y1 + 0.05 {
            return None;
        }
    }
    let side = Side::of_point(&first, q2)?;
    let half = HalfPlane::new(
        match side {
            Side::Positive => first.n,
            Side::Negative => [-first.n[0], -first.n[1]],
        },
        match side {
            Side::Positive => first.d,
            Side::Negative => -first.d,
        },
    )?;
    let anchor: Vec<Point> = state.topology().crease_faces[k]
        .iter()
        .filter_map(|&f| {
            let id = state.faces()[f].id;
            let piece = convex::split(state.face_image(id)?, &half, TOL).inside;
            let centroid = convex::centroid(&piece)?;
            (half.signed_distance(centroid) > TOL)
                .then(|| state.isometry(id).map(|t| t.inverse().apply(centroid)))
                .flatten()
        })
        .collect();
    (!anchor.is_empty()).then_some(CrimpFold {
        first,
        second,
        side,
        anchor: Seed::Flaps { at: anchor },
        kind: ReverseKind::Inside,
    })
}

/// A drawn tuck of `state`, as the reverse spike's tuck campaign draws them
/// (`campaign-tuck.mjs`): up to eight drawn plain folds ([`plain_fold`])
/// until one lands, and T among the layers wholly on the side that stays
/// which its landed block lies on, named by its witness. The fold's
/// direction makes it a valley tuck (under T) or a mountain tuck (over T).
/// None when no drawn fold lands on such a layer.
pub fn tuck_fold(state: &State, rng: &mut Rng) -> Option<TuckFold> {
    for _ in 0..8 {
        let Some(plain) = plain_fold(state, rng) else {
            continue;
        };
        let Ok(folded) = state.fold(&plain) else {
            continue;
        };
        let analysis = &folded.report.analysis;
        let toward = |p: Point| {
            let d = analysis.line.signed_distance(p);
            if analysis.side == Side::Positive {
                d
            } else {
                -d
            }
        };
        let landing: Vec<&[Point]> = folded
            .report
            .moving_faces
            .iter()
            .filter_map(|&f| folded.state.face_image(f))
            .collect();
        let targets: Vec<FaceId> = state
            .faces()
            .iter()
            .map(|f| f.id)
            .filter(|f| !analysis.moving.contains(f))
            .filter(|&f| {
                state.face_image(f).is_some_and(|image| {
                    image.iter().all(|&p| toward(p) <= TOL)
                        && landing
                            .iter()
                            .any(|landed| convex::penetration(landed, image) > TOL)
                })
            })
            .collect();
        let Some(target) = rng.pick(&targets) else {
            continue;
        };
        return Some(TuckFold {
            line: plain.line,
            side: plain.side,
            direction: plain.direction,
            seed: plain.seed,
            target: state.face_witness(target)?,
            additional_targets: Vec::new(),
        });
    }
    None
}

/// A drawn valley squash of `state`, as the vertex spike's campaign draws
/// them (research `r2-spike-squash-petal-rabbit`, `campaign.mjs`): a face's
/// image centroid, the flap named by the top layer there as the viewer sees
/// it; half the time symmetric, otherwise its spine landing at a share
/// drawn from −0.8 to 0.8 of the flap's wedge. None when the point lies on
/// no layer. A flap the squash refuses is drawn too, symmetric: the squash
/// says why.
pub fn squash(state: &State, rng: &mut Rng) -> Option<Squash> {
    let faces = state.faces();
    let face = faces.get(rng.below(faces.len()))?;
    let at = convex::centroid(state.face_image(face.id)?)?;
    let mut stack = state.stack_at(at)?;
    if state.view().flipped {
        stack.reverse();
    }
    let top = *stack.first()?;
    let flap = state.isometry(top)?.inverse().apply(at);
    let symmetric = rng.chance(0.5);
    let share = rng.next_f64() * 1.6 - 0.8;
    let mut op = Squash {
        flap,
        target: None,
        direction: Direction::Valley,
        hinge: None,
    };
    if !symmetric && let Ok(analysis) = state.analyse_squash(&op) {
        let (s, c) = (share * analysis.wedge).sin_cos();
        let h = analysis.hinge_direction;
        op.target = Some([c * h[0] - s * h[1], s * h[0] + c * h[1]]);
    }
    Some(op)
}

/// The distinct vertex images, in vertex order.
fn landmarks(state: &State) -> Vec<Point> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for v in 0..state.vertices().len() {
        if let Some(p) = state.vertex_image(VertexId(v as u32)) {
            let key = ((p[0] * 1e8).round() as i64, (p[1] * 1e8).round() as i64);
            if seen.insert(key) {
                out.push(p);
            }
        }
    }
    out
}

/// A drawn crease's image segment.
fn crease_segment(state: &State, rng: &mut Rng) -> Option<(Point, Point)> {
    let creases = state.creases();
    let crease = creases.get(rng.below(creases.len()))?;
    let [a, b] = crease.vertices.map(|v| state.vertex_image(v));
    Some((a?, b?))
}

fn line(state: &State, rng: &mut Rng) -> Option<Line> {
    let points = landmarks(state);
    let two = |rng: &mut Rng| {
        let p = rng.pick(&points)?;
        let q = rng.pick(&points)?;
        ((p[0] - q[0]).hypot(p[1] - q[1]) > 1e-6).then_some((p, q))
    };
    match rng.below(6) {
        0 => two(rng).and_then(|(p, q)| Line::from_points(p, q)),
        1 => two(rng).and_then(|(p, q)| Line::perpendicular_bisector(p, q)),
        2 => crease_segment(state, rng).and_then(|(a, b)| Line::from_points(a, b)),
        3 => {
            let ((a, b), (c, d)) = (crease_segment(state, rng)?, crease_segment(state, rng)?);
            let (u, w) = (
                unit([b[0] - a[0], b[1] - a[1]])?,
                unit([d[0] - c[0], d[1] - c[1]])?,
            );
            let (l1, l2) = (Line::from_points(a, b)?, Line::from_points(c, d)?);
            let x = l1.intersect(&l2)?;
            let s = if u[0] * w[0] + u[1] * w[1] >= 0.0 {
                1.0
            } else {
                -1.0
            };
            let bisector = [u[0] + s * w[0], u[1] + s * w[1]];
            let dir = if rng.chance(0.5) {
                bisector
            } else {
                [-bisector[1], bisector[0]]
            };
            Line::from_point_direction(x, dir)
        }
        4 => {
            let p = rng.pick(&points)?;
            let angle = if rng.chance(0.7) {
                rng.below(16) as f64 * PI / 16.0
            } else {
                rng.next_f64() * PI
            };
            Line::from_point_direction(p, [angle.cos(), angle.sin()])
        }
        _ => {
            let (x0, y0, x1, y1) = points.iter().fold(
                (
                    f64::INFINITY,
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                    f64::NEG_INFINITY,
                ),
                |b, p| (b.0.min(p[0]), b.1.min(p[1]), b.2.max(p[0]), b.3.max(p[1])),
            );
            let p = [
                x0 + rng.next_f64() * (x1 - x0),
                y0 + rng.next_f64() * (y1 - y0),
            ];
            let angle = rng.next_f64() * PI;
            Line::from_point_direction(p, [angle.cos(), angle.sin()])
        }
    }
}

fn unit(v: Point) -> Option<Point> {
    let len = v[0].hypot(v[1]);
    (len > 1e-12).then(|| [v[0] / len, v[1] / len])
}

/// A sheet point of a drawn face whose image lies on the moving side, more
/// than the minimum feature from the line; eight tries.
fn moving_side_point(state: &State, line: &Line, side: Side, rng: &mut Rng) -> Option<Point> {
    for _ in 0..8 {
        let faces = state.faces();
        let face = faces.get(rng.below(faces.len()))?.id;
        let image = state.face_image(face)?;
        let weights: Vec<f64> = image.iter().map(|_| rng.next_f64() + 0.05).collect();
        let total: f64 = weights.iter().sum();
        let p = image.iter().zip(&weights).fold([0.0, 0.0], |s, (q, w)| {
            [s[0] + q[0] * w / total, s[1] + q[1] * w / total]
        });
        let d = line.signed_distance(p);
        let d = if side == Side::Positive { d } else { -d };
        if d > MIN_FEATURE {
            let t = state.isometry(face)?;
            return Some(t.inverse().apply(p));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn landed(seed: u64) -> Vec<(Op, usize)> {
        Sequence::new(seed, 10, 64)
            .unwrap_or_else(|e| panic!("{e}"))
            .filter_map(|step| match step.outcome {
                Outcome::Landed(folded) => Some((step.op, folded.state.faces().len())),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn a_seed_replays_its_sequence() {
        for seed in 0..8 {
            assert_eq!(landed(seed), landed(seed), "seed {seed}");
        }
        assert_ne!(landed(1), landed(2));
    }

    #[test]
    fn each_step_starts_where_the_last_one_left_the_sequence() {
        let (mut folds, mut views, mut refusals) = (0, 0, 0);
        for seed in 0..24 {
            let mut sequence = Sequence::new(seed, 10, 64).unwrap_or_else(|e| panic!("{e}"));
            let mut now = sequence.state().clone();
            let mut steps = 0;
            for step in sequence.by_ref() {
                steps += 1;
                assert_eq!(step.parent.parts(), now.parts(), "seed {seed}");
                match &step.outcome {
                    Outcome::Landed(folded) => {
                        folds += 1;
                        assert_eq!(folded.state.step(), step.parent.step() + 1);
                    }
                    Outcome::Viewed(state) => {
                        views += 1;
                        assert_eq!(state.order(), step.parent.order());
                    }
                    Outcome::Refused(_) => refusals += 1,
                }
                if let Some(state) = step.state() {
                    now = state.clone();
                }
            }
            assert!(steps <= 10);
            assert_eq!(sequence.state().parts(), now.parts());
        }
        assert!(folds >= 100, "only {folds} folds landed");
        assert!(
            views > 0 && refusals > 0,
            "{views} views, {refusals} refusals"
        );
    }

    #[test]
    fn a_face_limit_stops_the_draws() {
        let mut stopped = 0;
        for seed in 0..8 {
            let steps: Vec<Step> = Sequence::new(seed, 50, 2)
                .unwrap_or_else(|e| panic!("{e}"))
                .collect();
            assert!(steps.iter().all(|step| step.parent.faces().len() <= 2));
            stopped += usize::from(
                steps
                    .last()
                    .and_then(Step::state)
                    .is_some_and(|state| state.faces().len() > 2),
            );
        }
        assert!(stopped > 0, "no sequence reached the limit");
    }
}
