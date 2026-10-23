//! The rabbit ear (plan Phase 11, research §5.3), a vertex fold
//! ([`super::vertex`]) of four rays from a triangle's incenter
//! ([`super::fan`]): three to its corners, bisecting its angles, and the
//! emergent fourth, one of at most three Kawasaki candidates, through the
//! chosen layers.
//!
//! The three bisectors take the direction's letter and the fourth crease the
//! other: a valley ear's are valley, valley, valley and mountain (Lang;
//! Beloch's `flatten-rabbit-ear-*`). The direction alone leaves two orders,
//! which differ in which of the far wedge's two rays rises as the ear's
//! *ridge* (research §5.3, 2 states with the direction seed); only the
//! fourth's rising is a rabbit ear, so the fourth is seeded as the ridge
//! ([`super::fan`]), and a fourth crease beside the paper that stays is
//! refused. With it every spike case is unique.
//!
//! A step stored before kept a `ridge` naming one of the two: it is no
//! longer read (an unknown field, ignored), and the ear lands as the rule
//! has it (see [`FanInput::land`](super::fan) on a stored order).

use serde::{Deserialize, Serialize};

use crate::complete::CompletionLimits;
use crate::compound::CompoundRefused;
use crate::compound::fan::{FanAnalysis, FanInput};
use crate::compound::vertex::{VertexChoices, VertexFoldKind, VertexOutcome, unit};
use crate::fold::{FoldActionGeometry, Seed};
use crate::refusal::{FoldRefusal, Refused};
use crate::state::State;
use crate::view::Direction;

type Point = [f64; 2];

/// A rabbit ear, named the way a step stores it (plan D6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RabbitEar {
    /// The triangle's corners, in the parent's model frame.
    pub corners: [Point; 3],
    /// The fourth ray, a direction from the incenter in the parent's model
    /// frame: the nearest Kawasaki candidate is taken.
    pub emergent: Point,
    /// The layers the creases cut, at the incenter.
    pub layers: Seed,
    /// A sheet point on paper that stays.
    pub stayer: Point,
    /// As the viewer sees it: the bisectors' letter, the fourth crease
    /// taking the other.
    pub direction: Direction,
}

/// The incenter of a triangle: its corners weighted by the opposite sides.
pub fn incenter(corners: &[Point; 3]) -> Option<Point> {
    let [a, b, c] = *corners;
    let side = |p: Point, q: Point| (q[0] - p[0]).hypot(q[1] - p[1]);
    let (la, lb, lc) = (side(b, c), side(a, c), side(a, b));
    let sum = la + lb + lc;
    (sum.is_finite() && sum > 0.0).then(|| {
        [
            (la * a[0] + lb * b[0] + lc * c[0]) / sum,
            (la * a[1] + lb * b[1] + lc * c[1]) / sum,
        ]
    })
}

impl RabbitEar {
    fn input(&self) -> Result<FanInput, Refused> {
        let center = incenter(&self.corners).ok_or(FoldRefusal::FanNotFlat)?;
        let ray = |p: Point| unit([p[0] - center[0], p[1] - center[1]]);
        let [a, b, c] = self.corners;
        let (Some(a), Some(b), Some(c)) = (ray(a), ray(b), ray(c)) else {
            return Err(FoldRefusal::FanNotFlat.into());
        };
        Ok(FanInput {
            kind: VertexFoldKind::RabbitEar,
            triangle: Some(self.corners),
            center,
            given: [a, b, c],
            emergent: self.emergent,
            layers: self.layers.clone(),
            stayer: self.stayer,
            direction: self.direction,
        })
    }
}

impl State {
    /// A rabbit ear's rays, emergent candidates and layers, without
    /// folding.
    pub fn analyse_rabbit_ear(&self, op: &RabbitEar) -> Result<FanAnalysis, Refused> {
        op.input()?.analyse(self)
    }

    /// The picture of the rabbit ear `op` on this state, with `landed`'s
    /// cover at the arrow's head when it is given: a fan fold's (see
    /// [`super::vertex`]).
    pub fn rabbit_ear_action(
        &self,
        op: &RabbitEar,
        landed: Option<&State>,
    ) -> Result<FoldActionGeometry, Refused> {
        op.input()?.action(self, landed)
    }

    /// A rabbit ear, with its stored choices (empty for a new step), under
    /// the default completion limits.
    pub fn rabbit_ear(
        &self,
        op: &RabbitEar,
        choices: &VertexChoices,
    ) -> Result<VertexOutcome, CompoundRefused> {
        self.rabbit_ear_within(op, choices, &CompletionLimits::default())
    }

    /// [`State::rabbit_ear`] under `limits`. A refusal of its emergent ray
    /// offers the candidates that land.
    pub fn rabbit_ear_within(
        &self,
        op: &RabbitEar,
        choices: &VertexChoices,
        limits: &CompletionLimits,
    ) -> Result<VertexOutcome, CompoundRefused> {
        op.input()
            .map_err(CompoundRefused::Refused)?
            .land(self, choices, limits)
    }
}
