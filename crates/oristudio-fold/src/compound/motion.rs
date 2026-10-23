//! A compound step's motion, as the animation draws it (plan D15, research
//! §9): legs, each turning groups of paper about a hinge, with exact
//! endpoints.
//!
//! A plain fold is one rigid motion of two groups and the web plays it from
//! the step's own geometry. A reverse fold has no rigid motion short of
//! unfolding the vertex where ℓ meets the spine flat (research §9, `r1-
//! folding3d-sim-animation` E): its two branches meet only there. So its
//! motion is *visual*: each block turns about ℓ as a hinge, the lower blocks
//! one way and the upper the other, as if the spine let go; the first frame
//! is the parent and the last the landed state, exactly.
//!
//! Two legs, split where the turning paper stands edge-on (a quarter turn),
//! where it covers no area and its stacking can change without a jump:
//!
//! - **spread**: from flat to edge-on, stacked as the parent stacks it;
//! - **close**: from edge-on to landed, stacked as the landed state does,
//!   so the last frame draws what lands, in the order it lands in.
//!
//! A tuck is one block turning the same way. A crimp folds both its lines
//! together, in one spread and one close: each strip block turns about ℓ1 as
//! a reverse fold's block does, and its tip block turns about ℓ2 the other
//! way at the same rate, carried by the strip's turn (`MotionGroup::carrier`)
//! — so the tip's pose is the strip's turn of its own at every instant, ρ1∘ρ2
//! once both are done, and between them the tip slides over as a pleat does
//! (along parallel lines it never tilts) rather than standing edge-on with
//! its strip.
//!
//! A vertex fold (squash, petal, rabbit ear, swivel) turns some paper about
//! more than one crease: its blocks' motions are products of reflections.
//! Its motion is staged ([`StepMotion::staged`]): each stage a spread and a
//! close leg, each block turning about one of its creases per stage or
//! resting, a group's `then` taking it from where the turn leaves it to
//! where it lands. Every leg places every moving face, and only the last
//! stacks as the landed state.

use std::f64::consts::{FRAC_PI_2, PI};

use oristudio_geometry::Line;
use serde::Serialize;

use crate::isometry::Isometry;
use crate::pattern::FaceId;
use crate::refusal::Side;

type Point = [f64; 2];

/// Whether a motion is the paper's own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MotionKind {
    /// Every frame is a pose the paper can take.
    Rigid,
    /// Only the endpoints are states; the frames between are a picture.
    Visual,
}

/// What a leg does, for the transport's pacing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LegName {
    /// The moving paper lifts from where it lay to edge-on.
    Spread,
    /// It comes down from edge-on to where it lands.
    Close,
}

/// Which state's layer order draws the turning paper against the paper that
/// stays, during a leg.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Stacking {
    /// The parent's: each turning face as its parent face lay.
    Parent,
    /// The landed state's.
    Landed,
}

/// Paper turning about one hinge during one leg.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MotionGroup {
    /// The landed state's faces that turn together.
    pub faces: Vec<FaceId>,
    /// The hinge, in the parent's model frame (and the landed state's, which
    /// is the same: what stays keeps its isometry).
    pub axis: Line,
    /// The side of `axis` the faces start on.
    pub side: Side,
    /// The turn at the leg's start and end, in radians: 0 where the faces
    /// lay before this turn, ±π where it leaves them; positive lifts them
    /// toward +z of the model frame.
    pub from: f64,
    pub to: f64,
    /// The turn that carries this group's hinge while the group turns about
    /// it, over the same leg: the paper the hinge joins the group to, turning
    /// about its own hinge (a crimp's strip, carrying ℓ2 and its tip). It
    /// applies after the group's own turn. None for a hinge that stays where
    /// it lies.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub carrier: Option<Carrier>,
    /// What the faces still do after this turn, in the model frame: the
    /// identity (left out) when this turn lands them. A vertex fold turns
    /// some paper twice (`StepMotion::staged`). The identity for every leg
    /// of a plain or reverse fold, a tuck and a crimp.
    #[serde(default, skip_serializing_if = "is_identity")]
    pub then: Isometry,
}

/// A turn carrying another group's hinge ([`MotionGroup::carrier`]): its
/// line, the side the carried paper starts on, and its turn at the leg's
/// start and end, as a group's own.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Carrier {
    pub axis: Line,
    pub side: Side,
    pub from: f64,
    pub to: f64,
}

impl MotionGroup {
    /// Where the leg puts a point of one of the group's faces `share` of the
    /// way through it (0 its start, 1 its end), given where it lands (a
    /// model-frame point of the landed state): its model-frame position and
    /// its height above the paper that stays. The group's turn, and its
    /// carrier's, each move by that share from their `from` to their `to`.
    /// At ±π (each) this is where the turns leave it (`landed`, for the last
    /// leg) at height 0; at 0, where it lay before them (where the parent had
    /// it, for the first).
    pub fn pose(&self, landed: Point, share: f64) -> [f64; 3] {
        let at = |from: f64, to: f64| from + share * (to - from);
        // Where the turns start it: where they leave it, back across the
        // carrier's hinge and then the group's own.
        let left = self.then.inverse().apply(landed);
        let back = match &self.carrier {
            Some(carrier) => carrier.axis.reflect_point(left),
            None => left,
        };
        let start = self.axis.reflect_point(back);
        let own = turn(
            &self.axis,
            self.side,
            at(self.from, self.to),
            [start[0], start[1], 0.0],
        );
        match &self.carrier {
            Some(carrier) => turn(
                &carrier.axis,
                carrier.side,
                at(carrier.from, carrier.to),
                own,
            ),
            None => own,
        }
    }
}

/// A point of space turned by `angle` about `axis`, a line in the paper's
/// plane: the paper on its `side` lifts toward +z for a positive angle.
fn turn(axis: &Line, side: Side, angle: f64, [x, y, z]: [f64; 3]) -> [f64; 3] {
    let (n, d) = match side {
        Side::Positive => (axis.n, axis.d),
        Side::Negative => ([-axis.n[0], -axis.n[1]], -axis.d),
    };
    // Its distance from the axis across the plane, and its height, turn
    // together.
    let u = n[0] * x + n[1] * y - d;
    let (sin, cos) = angle.sin_cos();
    let moved = u * cos - z * sin - u;
    [x + moved * n[0], y + moved * n[1], u * sin + z * cos]
}

/// One leg of a motion: groups turning at once.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MotionLeg {
    pub name: LegName,
    pub stacking: Stacking,
    pub groups: Vec<MotionGroup>,
}

/// A step's motion: its legs, played in order (see the module docs).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StepMotion {
    pub kind: MotionKind,
    pub legs: Vec<MotionLeg>,
}

impl StepMotion {
    /// Groups turning about `axis` from `side` by a half turn each, upward
    /// (toward +z) or downward, through a spread and a close leg (see the
    /// module docs). Each entry of `groups` is a group's landed faces and
    /// whether it turns upward.
    pub(crate) fn half_turns(
        axis: Line,
        side: Side,
        groups: &[(Vec<FaceId>, bool)],
        kind: MotionKind,
    ) -> StepMotion {
        let turn = Turn { axis, side };
        StepMotion {
            kind,
            legs: vec![
                turn.leg(
                    LegName::Spread,
                    Stacking::Parent,
                    0.0,
                    groups,
                    Isometry::IDENTITY,
                ),
                turn.leg(
                    LegName::Close,
                    Stacking::Landed,
                    FRAC_PI_2,
                    groups,
                    Isometry::IDENTITY,
                ),
            ],
        }
    }

    /// A crimp's motion, visual, both lines folding together (see the
    /// module docs): each strip block turns about ℓ1 as a reverse fold's
    /// block does (`first`, from the side it starts on), and each tip block
    /// turns about ℓ2 (`second`, where the parent has it, from the tip's
    /// side) the other way from its strip, carried by the strip's turn about
    /// ℓ1. Each group is its landed faces and whether its strip turns upward.
    /// One spread, stacked as the parent stacks it, and one close, stacked
    /// as the landed state.
    pub(crate) fn crimp(
        first: Turn,
        second: Turn,
        strip: &[(Vec<FaceId>, bool)],
        tip: &[(Vec<FaceId>, bool)],
    ) -> StepMotion {
        let leg = |name: LegName, stacking: Stacking, from: f64| {
            let mut leg = first.leg(name, stacking, from, strip, Isometry::IDENTITY);
            leg.groups.extend(tip.iter().map(|(faces, up)| {
                let sign = if *up { 1.0 } else { -1.0 };
                MotionGroup {
                    faces: faces.clone(),
                    axis: second.axis,
                    side: second.side,
                    from: -sign * from,
                    to: -sign * (from + FRAC_PI_2),
                    carrier: Some(Carrier {
                        axis: first.axis,
                        side: first.side,
                        from: sign * from,
                        to: sign * (from + FRAC_PI_2),
                    }),
                    then: Isometry::IDENTITY,
                }
            }));
            leg
        };
        StepMotion {
            kind: MotionKind::Visual,
            legs: vec![
                leg(LegName::Spread, Stacking::Parent, 0.0),
                leg(LegName::Close, Stacking::Landed, FRAC_PI_2),
            ],
        }
    }

    /// Blocks turning in stages (a vertex fold's visual motion, plan D15):
    /// each block's motion is the product of half turns about its `turns`,
    /// applied in order, each in its own stage. A stage is a spread and a
    /// close leg, as [`StepMotion::half_turns`]'s, in which every block
    /// appears: turning, if it turns then, or resting where its turns so far
    /// left it (`from == to`), so a frame of any leg places every moving
    /// face. Every leg stacks as the parent but the last, which stacks as
    /// the landed state. `up` lifts every turn toward +z of the model frame.
    pub(crate) fn staged(blocks: &[StagedBlock], up: bool, kind: MotionKind) -> StepMotion {
        let stages = blocks
            .iter()
            .flat_map(|b| b.turns.iter().map(|(stage, _)| stage + 1))
            .max()
            .unwrap_or(0);
        let sign = if up { 1.0 } else { -1.0 };
        let mut legs = Vec::with_capacity(2 * stages);
        for stage in 0..stages {
            for (name, from, to) in [
                (LegName::Spread, 0.0, FRAC_PI_2),
                (LegName::Close, FRAC_PI_2, PI),
            ] {
                let last = stage + 1 == stages && name == LegName::Close;
                let groups = blocks
                    .iter()
                    .filter_map(|b| b.group(stage, sign * from, sign * to, sign * PI))
                    .collect();
                legs.push(MotionLeg {
                    name,
                    stacking: if last {
                        Stacking::Landed
                    } else {
                        Stacking::Parent
                    },
                    groups,
                });
            }
        }
        StepMotion { kind, legs }
    }
}

/// A hinge groups turn about: its line in the parent's model frame, and the
/// side of it they start on.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Turn {
    pub(crate) axis: Line,
    pub(crate) side: Side,
}

impl Turn {
    /// A quarter turn from `from` (0 or π/2) of each group, upward or down.
    fn leg(
        &self,
        name: LegName,
        stacking: Stacking,
        from: f64,
        groups: &[(Vec<FaceId>, bool)],
        then: Isometry,
    ) -> MotionLeg {
        MotionLeg {
            name,
            stacking,
            groups: groups
                .iter()
                .map(|(faces, up)| {
                    let sign = if *up { 1.0 } else { -1.0 };
                    MotionGroup {
                        faces: faces.clone(),
                        axis: self.axis,
                        side: self.side,
                        from: sign * from,
                        to: sign * (from + FRAC_PI_2),
                        carrier: None,
                        then,
                    }
                })
                .collect(),
        }
    }
}

/// A block of a vertex fold as its motion draws it ([`StepMotion::staged`]).
#[derive(Debug, Clone)]
pub(crate) struct StagedBlock {
    /// The landed state's faces in the block.
    pub(crate) faces: Vec<FaceId>,
    /// Its half turns in the order they apply, each with its stage: the
    /// block's motion is their reflections' product, the last outermost.
    pub(crate) turns: Vec<(usize, Line)>,
    /// A model-frame point inside the block's landed paper: what tells the
    /// side of each hinge it turns from.
    pub(crate) at: Point,
}

impl StagedBlock {
    /// The block's group in `stage`: turning from `from` to `to` about the
    /// turn it makes then, or resting where its turns leave it, at 0 before
    /// its next turn or at `rest` (±π) after its last. None for a block with
    /// no turns.
    fn group(&self, stage: usize, from: f64, to: f64, rest: f64) -> Option<MotionGroup> {
        let (k, from, to) = match self.turns.iter().position(|(s, _)| *s == stage) {
            Some(k) => (k, from, to),
            None => match self.turns.iter().position(|(s, _)| *s > stage) {
                Some(k) => (k, 0.0, 0.0),
                None => (self.turns.len().checked_sub(1)?, rest, rest),
            },
        };
        let axis = self.turns[k].1;
        let then = self.turns[k + 1..]
            .iter()
            .fold(Isometry::IDENTITY, |m, (_, line)| {
                reflection(line).after(&m)
            });
        let start = axis.reflect_point(then.inverse().apply(self.at));
        Some(MotionGroup {
            faces: self.faces.clone(),
            axis,
            side: Side::of_point(&axis, start).unwrap_or(Side::Positive),
            from,
            to,
            carrier: None,
            then,
        })
    }
}

/// The reflection across a line.
pub(crate) fn reflection(line: &Line) -> Isometry {
    Isometry::reflection(line.n, line.d)
}

fn is_identity(m: &Isometry) -> bool {
    *m == Isometry::IDENTITY
}

#[cfg(test)]
mod tests {
    use std::f64::consts::PI;

    use super::*;

    fn close(a: [f64; 3], b: [f64; 3]) -> bool {
        a.iter().zip(&b).all(|(x, y)| (x - y).abs() < 1e-12)
    }

    /// Where a crimp's motion has the point of `face` that lands at
    /// `landed`, `t` of the way through it: its spread to ½, its close
    /// after.
    fn crimp_pose(motion: &StepMotion, face: FaceId, landed: Point, t: f64) -> [f64; 3] {
        let (leg, share) = if t < 0.5 {
            (0, 2.0 * t)
        } else {
            (1, 2.0 * t - 1.0)
        };
        motion.legs[leg]
            .groups
            .iter()
            .find(|g| g.faces == [face])
            .map(|g| g.pose(landed, share))
            .unwrap_or_else(|| panic!("no face {face} in leg {leg}"))
    }

    /// The area of the triangle three posed points make, seen from above.
    fn area_from_above([a, b, c]: [[f64; 3]; 3]) -> f64 {
        ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])).abs() / 2.0
    }

    #[test]
    fn a_crimps_tip_turns_about_its_line_as_the_strip_carries_it() {
        // ℓ1: x = 0.5, the strip (face 1) beyond it, and ℓ2 through (0.8, 0)
        // — parallel to ℓ1, or turned 20° — the tip (face 2) beyond that.
        let x = |c: f64| Line::new([1.0, 0.0], c).unwrap_or_else(|| unreachable!());
        let tilt = 20f64.to_radians();
        let turned =
            Line::new([tilt.cos(), tilt.sin()], 0.8 * tilt.cos()).unwrap_or_else(|| unreachable!());
        for (second, kind) in [(x(0.8), "parallel"), (turned, "turned")] {
            for up in [true, false] {
                let label = format!("{kind}, strip up {up}");
                let motion = StepMotion::crimp(
                    Turn {
                        axis: x(0.5),
                        side: Side::Positive,
                    },
                    Turn {
                        axis: second,
                        side: Side::Positive,
                    },
                    &[(vec![FaceId(1)], up)],
                    &[(vec![FaceId(2)], up)],
                );
                // One spread, as the parent stacks, and one close, as the
                // landed state does.
                let legs: Vec<(LegName, Stacking)> =
                    motion.legs.iter().map(|l| (l.name, l.stacking)).collect();
                assert_eq!(
                    legs,
                    [
                        (LegName::Spread, Stacking::Parent),
                        (LegName::Close, Stacking::Landed)
                    ],
                    "{label}"
                );
                // The tip lands by ρ1 ∘ ρ2, from where the parent had it.
                let lands = |p: Point| x(0.5).reflect_point(second.reflect_point(p));
                let tip = [[0.9, 0.3], [1.0, 0.3], [0.95, 0.6]];
                for p in tip {
                    let q = lands(p);
                    let at = |t: f64| crimp_pose(&motion, FaceId(2), q, t);
                    assert!(close(at(0.0), [p[0], p[1], 0.0]), "{label}: {p:?}");
                    assert!(close(at(1.0), [q[0], q[1], 0.0]), "{label}: {p:?}");
                    // The legs meet.
                    let spread = motion.legs[0].groups[1].pose(q, 1.0);
                    let closing = motion.legs[1].groups[1].pose(q, 0.0);
                    assert!(close(spread, closing), "{label}: {p:?}");
                }
                for k in 0..=40 {
                    let t = f64::from(k) / 40.0;
                    // ℓ2 joins the tip to its strip all the way: a point of
                    // it lands by ρ1 on either.
                    for s in [0.0, 0.25, 0.5] {
                        let on = [0.8 - s * second.n[1], s * second.n[0]];
                        let landed = x(0.5).reflect_point(on);
                        let a = crimp_pose(&motion, FaceId(1), landed, t);
                        let b = crimp_pose(&motion, FaceId(2), landed, t);
                        assert!(
                            a.iter().zip(&b).all(|(u, v)| (u - v).abs() < 1e-9),
                            "{label} at {t}: ℓ2's {on:?} parts, {a:?} and {b:?}"
                        );
                    }
                    // The tip never stands edge-on: seen from above it keeps
                    // its area, all of it along parallel lines, where it
                    // slides without tilting.
                    let posed = tip.map(|p| crimp_pose(&motion, FaceId(2), lands(p), t));
                    let seen =
                        area_from_above(posed) / area_from_above(tip.map(|p| [p[0], p[1], 0.0]));
                    if kind == "parallel" {
                        assert!((seen - 1.0).abs() < 1e-9, "{label} at {t}: {seen}");
                        assert!((posed[0][2] - posed[1][2]).abs() < 1e-9);
                        assert!((posed[0][2] - posed[2][2]).abs() < 1e-9);
                    } else {
                        assert!(seen > tilt.cos() - 1e-9, "{label} at {t}: {seen}");
                    }
                }
                // Halfway, the strip stands edge-on over ℓ1 and the tip lies
                // across its top, as high as the strip is wide there.
                let strip = crimp_pose(&motion, FaceId(1), [0.4, 0.0], 0.5);
                let sign = if up { 1.0 } else { -1.0 };
                assert!(close(strip, [0.5, 0.0, sign * 0.1]), "{label}: {strip:?}");
                let corner = crimp_pose(&motion, FaceId(2), lands([0.8, 0.0]), 0.5);
                assert!(close(corner, [0.5, 0.0, sign * 0.3]), "{label}: {corner:?}");
            }
        }
    }

    #[test]
    fn a_half_turn_ends_where_the_fold_lands_it() {
        // ℓ: x = 0.5; the tip started at x > 0.5, landed reflected.
        let Some(axis) = Line::new([1.0, 0.0], 0.5) else {
            unreachable!()
        };
        let motion = StepMotion::half_turns(
            axis,
            Side::Positive,
            &[(vec![FaceId(1)], true), (vec![FaceId(2)], false)],
            MotionKind::Visual,
        );
        assert_eq!(motion.legs.len(), 2);
        let [spread, closing] = [&motion.legs[0], &motion.legs[1]];
        assert_eq!(spread.stacking, Stacking::Parent);
        assert_eq!(closing.stacking, Stacking::Landed);
        // The legs meet edge-on, and the groups turn opposite ways.
        let (up, down) = (&closing.groups[0], &closing.groups[1]);
        assert_eq!(spread.groups[0].to, up.from);
        assert_eq!(up.to, PI);
        assert_eq!(down.to, -PI);
        let landed = [0.2, 0.7];
        assert!(close(up.pose(landed, 1.0), [0.2, 0.7, 0.0]));
        assert!(close(spread.groups[0].pose(landed, 0.0), [0.8, 0.7, 0.0]));
        // Edge-on: over the hinge, as high as the point was far from it.
        assert!(close(up.pose(landed, 0.0), [0.5, 0.7, 0.3]));
        assert!(close(down.pose(landed, 0.0), [0.5, 0.7, -0.3]));
        assert!(close(spread.groups[0].pose(landed, 1.0), [0.5, 0.7, 0.3]));
        // The same from the other side.
        let other = |group: &MotionGroup| MotionGroup {
            side: Side::Negative,
            ..group.clone()
        };
        assert!(close(other(up).pose([0.8, 0.1], 1.0), [0.8, 0.1, 0.0]));
        assert!(close(
            other(&spread.groups[0]).pose([0.8, 0.1], 0.0),
            [0.2, 0.1, 0.0]
        ));
    }

    #[test]
    fn a_staged_motion_turns_each_block_in_turn_and_never_jumps() {
        // Block 0 turns across x = 0.5 and then y = 0.5; block 1 across
        // y = 0.5 only, in the second stage.
        let (Some(x), Some(y)) = (Line::new([1.0, 0.0], 0.5), Line::new([0.0, 1.0], 0.5)) else {
            unreachable!()
        };
        let landed =
            |start: Point, turns: &[Line]| turns.iter().fold(start, |p, l| l.reflect_point(p));
        let (a0, b0) = ([0.8, 0.7], [0.3, 0.9]);
        let (a, b) = (landed(a0, &[x, y]), landed(b0, &[y]));
        let blocks = [
            StagedBlock {
                faces: vec![FaceId(1)],
                turns: vec![(0, x), (1, y)],
                at: a,
            },
            StagedBlock {
                faces: vec![FaceId(2)],
                turns: vec![(1, y)],
                at: b,
            },
        ];
        let motion = StepMotion::staged(&blocks, true, MotionKind::Visual);
        assert_eq!(motion.legs.len(), 4);
        assert_eq!(motion.legs[2].stacking, Stacking::Parent);
        assert_eq!(motion.legs[3].stacking, Stacking::Landed);
        for (k, (landed, start)) in [(a, a0), (b, b0)].into_iter().enumerate() {
            let at = |leg: usize, end: bool| {
                motion.legs[leg].groups[k].pose(landed, if end { 1.0 } else { 0.0 })
            };
            assert!(close(at(0, false), [start[0], start[1], 0.0]), "block {k}");
            assert!(close(at(3, true), [landed[0], landed[1], 0.0]), "block {k}");
            for leg in 0..3 {
                assert!(
                    close(at(leg, true), at(leg + 1, false)),
                    "block {k} leg {leg}"
                );
            }
        }
        // Block 1 rests through the first stage, block 0 turns in both.
        assert_eq!(motion.legs[0].groups[1].from, motion.legs[0].groups[1].to);
        assert!(motion.legs[0].groups[0].to > motion.legs[0].groups[0].from);
        assert!(motion.legs[2].groups[0].to > motion.legs[2].groups[0].from);
    }
}
