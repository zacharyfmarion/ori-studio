//! A tuck in place: a flap already folded along ℓ keeps its place and every
//! crease, and only its order against the paper that stays changes — it is
//! tucked under (or over) a layer T, into a pocket or behind a layer, with
//! no new crease. Diagrams draw it as a tuck arrow on a flap that is already
//! folded, so it is reached as a [`super::tuck`] is: through a valley or
//! mountain fold along the flap's folded edge, as one of the layer orders
//! its chooser lists (`crate::fold::placements`).
//!
//! - **What moves** is named by the seed and [`InPlace`]: the seed's flap as
//!   a plain fold along ℓ names it, hinged at ℓ to paper that stays (it turns
//!   out about ℓ and back in, an unfold and a fold against T in one step);
//!   or the layers folded together at ℓ where the seed is, joined elsewhere
//!   to paper that stays (the fold slides past the layers in its way).
//! - **Nothing turns.** The block moves by the identity, so its faces keep
//!   their images, its inner order and its creases; the pairs that stay are
//!   kept, and so is every hinge between the block and the paper that stays,
//!   so no letter changes. What is left free is the block against the paper
//!   that stays.
//! - **The order** is a tuck's against T (`super::tuck::placements`): the
//!   block immediately under T for a valley, over it for a mountain, as the
//!   viewer sees it, and against every layer that meets T by which side of T
//!   it is on — read strictly, and where that has no order, locally. The
//!   completion decides the rest; several orders are a choice, stored as a
//!   tuck's.
//!
//! Its report is a tuck's ([`TuckReport`]), so it draws, summarises and
//! replays as one; its motion turns the block out about ℓ and back in.

use std::collections::VecDeque;

use oristudio_geometry::{Line, convex};
use serde::{Deserialize, Serialize};

use crate::complete::{CompletionLimits, Completions};
use crate::compound::pieces::{Pieces, Scoring, prepare_pieces};
use crate::compound::tuck::{
    Context, Placed, TuckChoices, TuckOutcome, TuckSide, Unplaced, land_placed, lands_read,
};
use crate::compound::{Across, CompoundRefused, Prepared, first as first_of, no_order};
use crate::fold::closure::{moving_side, resolve_seed};
use crate::fold::line::{self, Axis, Classified};
use crate::fold::{
    ActionKind, FoldActionGeometry, FoldAnalysis, PlainFold, Push, ResolvedSeed, Seed,
};
use crate::isometry::Isometry;
use crate::numerics::TOL;
use crate::pattern::{CreaseKind, FaceId};
use crate::refusal::{FoldRefusal, Refused, Side};
use crate::scene::ScenePoint;
use crate::state::State;
use crate::view::Direction;
use crate::witness::WitnessOrder;

type Point = [f64; 2];

/// Which paper a tuck in place moves (see the module docs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InPlace {
    /// The seed's flap as a plain fold along ℓ names it — grown across every
    /// crease with an end on the moving side — hinged at ℓ to paper that
    /// stays.
    Flap,
    /// The seed's layers and every layer folded against them along ℓ, each
    /// joined elsewhere to paper that stays.
    Fold,
}

/// A tuck in place, named the way a step stores it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TuckInPlace {
    /// ℓ, in the parent's model frame: a folded edge of the flap.
    pub line: Line,
    /// The side of ℓ the flap lies on.
    pub side: Side,
    /// As the viewer sees it: a valley tucks under its target, a mountain
    /// over it.
    pub direction: Direction,
    pub seed: Seed,
    pub moves: InPlace,
    /// A sheet point inside T, the layer the block lands against.
    pub target: Point,
    /// Other layers the block lands against as well.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub additional_targets: Vec<Point>,
}

/// One way a flap folded along a line lands tucked in place
/// ([`State::tuck_in_place_landings`]).
#[derive(Debug, Clone)]
pub(crate) struct InPlaceLanding {
    pub(crate) op: TuckInPlace,
    /// What the step stores for it: the order chosen among several.
    pub(crate) order: Option<WitnessOrder>,
    /// The parent's faces that move, in id order.
    pub(crate) moving: Vec<FaceId>,
    pub(crate) state: State,
}

/// Every choice a completion lists, one listed order per component, in
/// order (the last component's varies fastest).
fn picks(completions: &Completions) -> Vec<Vec<usize>> {
    let sizes: Vec<usize> = completions
        .components()
        .iter()
        .map(|c| c.orders.len().max(1))
        .collect();
    let mut out = vec![vec![0; sizes.len()]];
    loop {
        let mut next = out[out.len() - 1].clone();
        let Some(k) = (0..sizes.len()).rev().find(|&k| next[k] + 1 < sizes[k]) else {
            return out;
        };
        next[k] += 1;
        for later in &mut next[k + 1..] {
            *later = 0;
        }
        out.push(next);
        if out.len() >= MAX_PICKS {
            return out;
        }
    }
}

/// The most choices [`picks`] lists.
const MAX_PICKS: usize = 64;

/// A tuck in place's block on a state, before its target.
struct Block {
    classified: Classified,
    /// In the model frame.
    direction: Direction,
    /// Per face position.
    moving: Vec<bool>,
}

impl Block {
    fn under(&self) -> bool {
        self.direction == Direction::Valley
    }

    fn placement(&self) -> TuckSide {
        if self.under() {
            TuckSide::Under
        } else {
            TuckSide::Over
        }
    }
}

impl State {
    /// The block a tuck in place moves: its line classified, its direction
    /// in the model frame, and per face position whether it moves. Refused
    /// when no seed layer is folded along ℓ ([`FoldRefusal::TuckNotAtFold`])
    /// and when nothing would stay.
    fn in_place_block(
        &self,
        line: &Line,
        side: Side,
        direction: Direction,
        seed: &Seed,
        moves: InPlace,
    ) -> Result<Block, Refused> {
        let classified = line::classify(&self.geometry().vertex_images, Axis::new(line, side))?;
        let moving_side = moving_side(self, &classified)?;
        let direction = self.view().model_direction(direction);
        let seed = resolve_seed(
            self,
            &moving_side.pieces,
            direction,
            &ResolvedSeed::from(seed),
            &classified.axis,
        )?;
        let faces = self.faces();
        // Per face position, the faces joined to it by a folded crease that
        // lies along ℓ.
        let mut along: Vec<Vec<usize>> = vec![Vec::new(); faces.len()];
        let on_line = |v: usize| classified.classes[v] == 0;
        for (k, crease) in self.creases().iter().enumerate() {
            if !matches!(crease.kind, CreaseKind::Folded(_)) {
                continue;
            }
            let [a, b] = crease.vertices;
            if !(on_line(a.index()) && on_line(b.index())) {
                continue;
            }
            if let [f, g] = self.topology().crease_faces[k][..] {
                along[f].push(g);
                along[g].push(f);
            }
        }
        let not_at_fold = || -> Refused {
            FoldRefusal::TuckNotAtFold {
                faces: seed.iter().map(|&f| faces[f].id).collect(),
            }
            .into()
        };
        if seed.iter().all(|&f| along[f].is_empty()) {
            return Err(not_at_fold());
        }
        let neighbours = |f: usize| -> &[usize] {
            match moves {
                InPlace::Flap => &moving_side.adjacent[f],
                InPlace::Fold => &along[f],
            }
        };
        let mut moving = vec![false; faces.len()];
        let mut queue: VecDeque<usize> = seed.iter().copied().collect();
        while let Some(f) = queue.pop_front() {
            if std::mem::replace(&mut moving[f], true) {
                continue;
            }
            queue.extend(neighbours(f).iter().copied().filter(|&g| !moving[g]));
        }
        if moving.iter().all(|&m| m) {
            return Err(FoldRefusal::NothingStays.into());
        }
        // A flap tucked in place is hinged at ℓ to paper that stays: that is
        // the fold it is tucked along.
        let hinged = (0..faces.len()).any(|f| moving[f] && along[f].iter().any(|&g| !moving[g]));
        if moves == InPlace::Flap && !hinged {
            return Err(not_at_fold());
        }
        Ok(Block {
            classified,
            direction,
            moving,
        })
    }

    /// The block's faces kept where they are, and its hinges to the paper
    /// that stays kept as the parent has them: what every target places.
    fn in_place_prepared(&self, block: &Block) -> Result<Prepared, FoldRefusal> {
        let mut prepared = prepare_pieces(
            self,
            Pieces {
                scoring: Scoring::unscored(self),
                block_of: block.moving.iter().map(|&m| m.then_some(0)).collect(),
                blocks: vec![Isometry::IDENTITY],
                against: Vec::new(),
                across: Across::Keep,
            },
        )?;
        let faces = self.faces();
        let mut hinges = Vec::new();
        for (k, crease) in self.creases().iter().enumerate() {
            if !matches!(crease.kind, CreaseKind::Folded(_)) {
                continue;
            }
            let [f, g] = self.topology().crease_faces[k][..] else {
                continue;
            };
            if block.moving[f] == block.moving[g] {
                continue;
            }
            let (a, b) = (faces[f].id, faces[g].id);
            match self.above(a, b) {
                Some(true) => hinges.push([a, b]),
                Some(false) => hinges.push([b, a]),
                None => {}
            }
        }
        prepared.carry(hinges);
        Ok(prepared)
    }

    /// The targets' positions; refused when one is off the paper, would
    /// move, or the block lies nowhere over it.
    fn in_place_targets(&self, op: &TuckInPlace, block: &Block) -> Result<Vec<usize>, Refused> {
        let mut targets = Vec::new();
        for &point in std::iter::once(&op.target).chain(&op.additional_targets) {
            let at = self
                .face_at(point)
                .and_then(|id| self.face_position(id))
                .ok_or(FoldRefusal::WitnessNotInFace { point })?;
            if block.moving[at] {
                return Err(FoldRefusal::TuckTargetMoves {
                    face: self.faces()[at].id,
                }
                .into());
            }
            if !self.in_place_meets(block, at) {
                return Err(FoldRefusal::TuckInfeasible {
                    target: self.faces()[at].id,
                    placement: block.placement(),
                    faces: Vec::new(),
                }
                .into());
            }
            if !targets.contains(&at) {
                targets.push(at);
            }
        }
        Ok(targets)
    }

    /// Whether some face of the block overlaps the face at `f`.
    fn in_place_meets(&self, block: &Block, f: usize) -> bool {
        let images = &self.geometry().images;
        (0..images.len())
            .filter(|&m| block.moving[m])
            .any(|m| convex::penetration(&images[m], &images[f]) > TOL)
    }

    /// A tuck in place, with its stored choices (empty for a new step),
    /// under the default completion limits.
    pub fn tuck_in_place(
        &self,
        op: &TuckInPlace,
        choices: &TuckChoices,
    ) -> Result<TuckOutcome, CompoundRefused> {
        self.tuck_in_place_within(op, choices, &CompletionLimits::default())
    }

    /// [`State::tuck_in_place`] under `limits`. No order puts the block
    /// against every target is [`FoldRefusal::TuckInfeasible`]; a stored
    /// choice that no longer resolves is [`CompoundRefused::Broken`].
    pub fn tuck_in_place_within(
        &self,
        op: &TuckInPlace,
        choices: &TuckChoices,
        limits: &CompletionLimits,
    ) -> Result<TuckOutcome, CompoundRefused> {
        let refused = |r: Refused| CompoundRefused::Refused(r);
        let block = self
            .in_place_block(&op.line, op.side, op.direction, &op.seed, op.moves)
            .map_err(refused)?;
        let targets = self.in_place_targets(op, &block).map_err(refused)?;
        let unplaced = self
            .in_place_prepared(&block)
            .map_err(|r| refused(r.into()))?;
        let target = self.faces()[targets[0]].id;
        let (line, side) = block.classified.axis.line_and_side();
        let context = Context {
            line,
            side,
            snap: block.classified.snap,
            direction: block.direction,
            placement: block.placement(),
            target,
            in_place: true,
        };
        let ids: Vec<FaceId> = targets.iter().map(|&t| self.faces()[t].id).collect();
        match land_placed(self, &unplaced, &ids, block.under(), choices, limits) {
            Ok(placed) => placed.outcome(context),
            Err(Unplaced::Broken(broken)) => Err(CompoundRefused::Broken(broken)),
            Err(Unplaced::Fold(refusal)) => Err(refused(refusal.into())),
            Err(Unplaced::NoOrder(refusal)) => Err(refused(
                match no_order(refusal) {
                    FoldRefusal::NoOrder { faces } => FoldRefusal::TuckInfeasible {
                        target,
                        placement: block.placement(),
                        faces,
                    },
                    other => other,
                }
                .into(),
            )),
        }
    }

    /// Every way the flap the plain fold `fold` names, folded along its line
    /// already, can be tucked in place, as a valley or mountain fold's
    /// layer-order chooser lists them (`crate::fold::placements`): for each
    /// [`InPlace`] reading that names a block, against each layer that stays
    /// and that the block overlaps, in id order, every order it lands in — at
    /// most `per_target` of a choice's, and `most` in all. Each is the op
    /// that lands it, its stored choice, what moves, and the landed state.
    /// None where the seed is not at a fold along the line; nothing that
    /// lands the parent's own order.
    pub(crate) fn tuck_in_place_landings(
        &self,
        fold: &PlainFold,
        limits: &CompletionLimits,
        per_target: usize,
        most: usize,
    ) -> Vec<InPlaceLanding> {
        let (seed, direction) = (&fold.seed, fold.direction);
        let mut out: Vec<InPlaceLanding> = Vec::new();
        for moves in [InPlace::Flap, InPlace::Fold] {
            let Ok(block) = self.in_place_block(&fold.line, fold.side, direction, seed, moves)
            else {
                continue;
            };
            let Ok(unplaced) = self.in_place_prepared(&block) else {
                continue;
            };
            let moving: Vec<FaceId> = (0..block.moving.len())
                .filter(|&f| block.moving[f])
                .map(|f| self.faces()[f].id)
                .collect();
            let (line, side) = block.classified.axis.line_and_side();
            for f in 0..self.faces().len() {
                if block.moving[f] || !self.in_place_meets(&block, f) {
                    continue;
                }
                let id = self.faces()[f].id;
                if lands_read(self, &unplaced, &[id], block.under(), &first_of(limits))
                    == Some(false)
                {
                    continue;
                }
                let Some(at) = self.face_witness(id) else {
                    continue;
                };
                let op = TuckInPlace {
                    line,
                    side,
                    direction,
                    seed: seed.clone(),
                    moves,
                    target: at,
                    additional_targets: Vec::new(),
                };
                let landed: Vec<(Option<WitnessOrder>, State)> = match land_placed(
                    self,
                    &unplaced,
                    &[id],
                    block.under(),
                    &TuckChoices::default(),
                    limits,
                ) {
                    Ok(Placed::Unique(folded)) => vec![(None, folded.state)],
                    Ok(Placed::Choose(pending)) => picks(&pending.completions)
                        .into_iter()
                        .take(per_target)
                        .filter_map(|pick| pending.pick(&pick).ok())
                        .map(|(folded, order)| (Some(order), folded.state))
                        .collect(),
                    Ok(Placed::Replayed(..)) | Err(_) => Vec::new(),
                };
                for (order, state) in landed {
                    if state.order() == self.order()
                        || out.iter().any(|o| o.state.order() == state.order())
                    {
                        continue;
                    }
                    out.push(InPlaceLanding {
                        op: op.clone(),
                        order,
                        moving: moving.clone(),
                        state,
                    });
                    if out.len() >= most {
                        return out;
                    }
                }
            }
        }
        out
    }

    /// What a tuck in place moves, as a plain fold's analysis reads it: the
    /// moving side's flaps along ℓ, and the block's faces.
    pub fn analyse_tuck_in_place(&self, op: &TuckInPlace) -> Result<FoldAnalysis, Refused> {
        let block = self.in_place_block(&op.line, op.side, op.direction, &op.seed, op.moves)?;
        self.in_place_targets(op, &block)?;
        let (line, side) = block.classified.axis.line_and_side();
        let moving: Vec<FaceId> = (0..block.moving.len())
            .filter(|&f| block.moving[f])
            .map(|f| self.faces()[f].id)
            .collect();
        let side_flaps = moving_side(self, &block.classified)?;
        let flaps = side_flaps.flaps;
        let picked: Vec<usize> = (0..flaps.len())
            .filter(|&k| {
                flaps[k]
                    .faces
                    .iter()
                    .any(|f| moving.binary_search(f).is_ok())
            })
            .collect();
        Ok(FoldAnalysis {
            line,
            side,
            snap: block.classified.snap,
            direction: block.direction,
            flaps,
            picked,
            added: Vec::new(),
            moving,
        })
    }

    /// The picture of a tuck in place before it lands: ℓ and the block as a
    /// plain fold draws them, and a push from the block into T, where it
    /// goes, in place of the turn's arrow.
    pub fn tuck_in_place_action(&self, op: &TuckInPlace) -> Result<FoldActionGeometry, Refused> {
        let analysis = self.analyse_tuck_in_place(op)?;
        let mut action = self.fold_action(&analysis, ActionKind::Fold, None)?;
        let target = self
            .face_at(op.target)
            .and_then(|id| self.face_image(id))
            .map(<[Point]>::to_vec);
        let to_scene = self.view().transform();
        if let (Some(grip), Some(target)) = (action.grip.take(), target) {
            // Where the block meets T: the push ends there.
            let into = analysis
                .moving
                .iter()
                .filter_map(|&id| self.face_image(id))
                .map(|image| convex::clip(image, &target))
                .find(|both| both.len() >= 3)
                .and_then(|both| convex::centroid(&both));
            if let Some(into) = into {
                action.push = Some(Push {
                    at: grip.at,
                    toward: ScenePoint::from(to_scene.apply(into)),
                });
            }
        }
        Ok(action)
    }
}
