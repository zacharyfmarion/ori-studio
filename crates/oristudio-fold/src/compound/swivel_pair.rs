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
//! **Refusals**: either swivel's own (`swivel_line_meeting`,
//! `swivel_no_flap`, the fan's); both at one vertex, or several pairs of
//! folded edges that compile (`swivel_line_meeting`); paper joined to two
//! wedges that move differently, or to a wedge and the paper that stays,
//! including paper beyond the four layers (`fan_ray_blocked`: the reading
//! through the stack is a single swivel's only); and no order (`no_order`).
use super::CompoundRefused;
use super::folded_swivel::{Layered, RayRun, finish_together, ray_run, two_layers_of};
use super::swivel::{SwivelKind, sub};
use super::swivel_valley_mountain::{Built, SwivelValleyMountain, ends_bare, folds_at};
use super::vertex::{Compiled, VertexChoices, VertexOutcome};
use crate::numerics::MIN_FEATURE;
use crate::{CompletionLimits, Direction, FoldRefusal, Refused, State};
use serde::{Deserialize, Serialize};

/// Two swivels by their valleys and mountains, made together (the module
/// docs), each as model-frame lines in the state they fold.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SwivelPair {
    pub swivels: [SwivelValleyMountain; 2],
}

impl SwivelPair {
    /// The folded edges each swivel can fold on: built on every one its
    /// lines meet on, or that swivel's refusal.
    fn candidates(swivel: &SwivelValleyMountain, state: &State) -> Result<Vec<Built>, Refused> {
        let meeting = || Refused::from(FoldRefusal::SwivelLineMeeting);
        let at = swivel
            .valley
            .intersect(&swivel.mountain)
            .ok_or_else(meeting)?;
        let folds = folds_at(state, at);
        if folds.len() > 1 && folds.iter().any(|&fold| ends_bare(state, fold, at)) {
            return Err(meeting());
        }
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
            return Err(first.unwrap_or_else(meeting));
        }
        Ok(built)
    }

    /// The fold compiled on the one pair of folded edges it compiles on.
    fn compiled(&self, state: &State) -> Result<Compiled, Refused> {
        let meeting = || Refused::from(FoldRefusal::SwivelLineMeeting);
        let [one, two] = &self.swivels;
        let (ones, twos) = (Self::candidates(one, state)?, Self::candidates(two, state)?);
        let mut first: Option<Refused> = None;
        let mut found: Vec<Compiled> = Vec::new();
        for a in &ones {
            for b in &twos {
                match self.compile([a, b], state) {
                    Ok(compiled) => found.push(compiled),
                    Err(refused) => {
                        first.get_or_insert(refused);
                    }
                }
            }
        }
        match found.len() {
            1 => found.pop().ok_or_else(meeting),
            0 => Err(first.unwrap_or_else(meeting)),
            _ => Err(meeting()),
        }
    }

    /// The two swivels on the folded edges `built`, as one fold.
    fn compile(&self, built: [&Built; 2], state: &State) -> Result<Compiled, Refused> {
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
        let kinds: [SwivelKind; 2] = self.swivels.each_ref().map(|s| s.kind);
        let direction = state.view().model_direction(Direction::Valley);
        finish_together(state, &swivels, &kinds, direction, read)
    }
}

impl State {
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
        op.compiled(self)
            .map_err(CompoundRefused::Refused)?
            .land_checked(self, choices, limits, || None, true)
    }
}
