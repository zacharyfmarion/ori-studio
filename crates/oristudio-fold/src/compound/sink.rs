//! Sinks (plan Phase 11, research §5.4): the open sink, the closed sink and
//! the unsink of a closed point, through the compound pipeline ([`super`]).
//!
//! - **The point** is the paper on the tip side of ℓ grown from the anchor
//!   across every crease off ℓ: one of the moving side's flaps (plan D3).
//! - **The geometry is forced.** Each tip piece hinges on ℓ to its own piece
//!   that stays, so it lands at R_ℓ ∘ T: the plain fold of the whole point.
//!   Only the letters and the order are open, and the sink decides them.
//! - **Preconditions** are checked first, and a refusal says which failed:
//!   the point is closed (no raw edge on its outline at its crown, the paper
//!   farthest from ℓ: free corners there make it open); for an open sink,
//!   its outline creases share one letter (one outside), they lie on two
//!   straight sides (and on a flat top square to them, where it was sunk
//!   before), and ℓ is exactly square to the axis between the sides. Any
//!   tilt kills the open sink, so that refusal offers the square line at the
//!   same depth, and the closed sink, which survives tilt. Depth is no
//!   precondition: a deep sink, the tip poking out below, lands, raw edges
//!   below the point's widest place on its outline or not.
//! - **Open sink**: each display layer of the point is a block, every block
//!   reflected across ℓ; pairs across blocks keep their order; each tip face
//!   lies directly against its own piece that stays, on the pocket side —
//!   toward the layer its outline crease joins it to — the "inverted nest".
//!   Every ring crease then takes the outline's letter and every inner
//!   folded crease turns. A ring precreased before takes its letter from the
//!   order like a new one, so the letters it remembered are overwritten.
//! - **Closed sink**: an inside reverse fold of the whole point, the reverse
//!   fold's rule ([`super::reverse`]): the pocket splits the point into a
//!   lower and an upper block, the lower placed over its body and the upper
//!   under its own, and each face anchored against the nearest face of its
//!   body. Only the pocket's seams turn. A pocket is one of the reverse
//!   fold's splits ([`super::reverse::down_sets`]) of the point cut along
//!   its outline creases whose gap — the seams whose two faces lie directly
//!   on one another — is bounded all along by one display layer, above or
//!   below. That keeps every gap of a fan point and the front and back
//!   pockets of a preliminary base, and leaves out the twisted splits, front
//!   on one half and back on the other: valid flat states no common fold
//!   makes. A step stores its pocket by the sheet points of a face on each
//!   side of a seam (plan D6).
//! - **Unsink**: the faces grown from the anchor across every crease off ℓ,
//!   all on one side of it, reflect back. Every crease between them and the
//!   rest lies flat again, remembering its letter, and the completion alone
//!   decides their order: from every sunk state the spike's completion was
//!   unique, the letters and the order before the sink.
//!
//! Anchors are per face, not per block ([`super::Anchor`]): one per block
//! left 16 pairs of the preliminary base open.

use std::collections::{BTreeMap, BTreeSet};

use oristudio_geometry::{Line, convex};
use serde::{Deserialize, Serialize};

use crate::complete::{ChoiceCount, CompletionLimits, Completions};
use crate::compound::motion::{MotionKind, StepMotion};
use crate::compound::reverse::down_sets;
use crate::compound::{
    Across, Against, Anchor, CompoundFolded, CompoundRefused, CompoundReport, Macro, Pending,
    Prepared, no_order, prepare,
};
use crate::fold::closure::{MovingSide, moving_side, resolve_seed};
use crate::fold::line::{self, Axis, Classified};
use crate::fold::{ResolvedSeed, Seed, Snap};
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::{CreaseKind, EdgeId, FaceId, Letter};
use crate::refusal::{Fix, Flap, FoldRefusal, Refused, Side};
use crate::state::{State, StateParts, Topology, sort_top_first};
use crate::summary::StepSummary;
use crate::view::Direction;
use crate::witness::{Broken, BrokenWitness, WitnessOrder};

type Point = [f64; 2];

/// The most pockets the scan lists for one point.
pub const MAX_POCKETS: usize = 64;

/// The most pockets a refusal tries before it offers a closed sink instead:
/// each is a completion.
const MAX_FIX_POCKETS: usize = 4;

/// How far past an edge the outline test looks for paper of the point: a
/// quarter of the minimum feature, half the thinnest piece the gate admits.
const OUTLINE_REACH: f64 = MIN_FEATURE / 4.0;

/// Where along an edge the outline test looks: its eighths, ends excluded.
const OUTLINE_SAMPLES: usize = 7;

/// Which way a point sinks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SinkKind {
    /// Every layer turned inside out against its own: the "inverted nest".
    Open,
    /// The whole point reversed into a pocket, its layers locked together.
    Closed,
}

impl SinkKind {
    pub fn other(self) -> SinkKind {
        match self {
            SinkKind::Open => SinkKind::Closed,
            SinkKind::Closed => SinkKind::Open,
        }
    }
}

/// A sink, named the way a step stores it (plan D6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SinkFold {
    /// ℓ, the sink line, in the parent's model frame.
    pub line: Line,
    /// The side of ℓ the point's tip is on.
    pub side: Side,
    /// What the point grows from: every layer on the tip side, the layers
    /// at a sheet point, or flaps by sheet points. It must name one flap.
    pub anchor: Seed,
    pub kind: SinkKind,
}

/// An unsink, named the way a step stores it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Unsink {
    /// The ring's line, in the parent's model frame.
    pub line: Line,
    /// The side of it the sunk tip lies on now; it goes back to the other.
    pub side: Side,
    /// What the sunk tip grows from: a sheet point of one of its faces.
    pub anchor: Seed,
}

/// A closed sink's pocket as a step stores it: an interior sheet point of a
/// face just above it and of one just below it, across a seam (plan D6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredPocket {
    pub above: Point,
    pub below: Point,
}

/// A sink's choices as a step stores them (plan D6).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct SinkChoices {
    /// A closed sink's pocket, when the point has more than one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pocket: Option<StoredPocket>,
    /// The pairs the completion left free, as they were chosen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<WitnessOrder>,
}

/// A gap in the point's layers that a closed sink goes into.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Pocket {
    /// The parent's faces above it and below it, in id order.
    pub upper: Vec<FaceId>,
    pub lower: Vec<FaceId>,
    /// The outline creases across it, in id order: they turn.
    pub seams: Vec<EdgeId>,
    /// What a step stores to choose it.
    pub stored: StoredPocket,
}

/// A point and the ways it sinks, before anything lands: what a sink tool
/// previews.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SinkPoint {
    /// ℓ after snapping, and the side the point's tip is on.
    pub line: Line,
    pub side: Side,
    pub snap: Snap,
    /// The point: the moving side's flap the anchor names.
    pub point: Flap,
    /// The folded creases on its outline, in id order.
    pub outline: Vec<EdgeId>,
    /// The letter they share, the point's outside; none when they carry
    /// both.
    pub exterior: Option<Letter>,
    /// Where its two sides meet, in the model frame; none without an axis.
    pub apex: Option<Point>,
    /// The line square to the point's axis where ℓ crosses it, folding the
    /// same side: the open sink's landmark. None without an axis, or where
    /// that line is a near miss.
    pub square: Option<Line>,
    /// Why an open sink is refused, with its fixes; none when one may land.
    /// The bridge sends it as a refusal of its own.
    #[serde(skip)]
    pub open: Option<Refused>,
    /// The pockets a closed sink can go into, fewest lower faces first.
    pub pockets: Vec<Pocket>,
    /// The scan stopped at [`MAX_POCKETS`]: more may exist.
    pub truncated: bool,
}

/// The sunk tip an unsink would pull back out, before anything lands: what
/// an unsink tool previews.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SunkTip {
    /// ℓ after snapping, and the side the sunk tip lies on now.
    pub line: Line,
    pub side: Side,
    pub snap: Snap,
    /// Its faces, ascending.
    pub faces: Vec<FaceId>,
}

/// The sunk points on one side of a line that an unsink along it can pull
/// back out: what an unsink tool offers before the folder names one.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SunkPoints {
    /// ℓ after snapping, and the side the sunk points lie on.
    pub line: Line,
    pub side: Side,
    pub snap: Snap,
    /// Each one a flap of the side, in the side's flap order: a sheet point
    /// of it is what an unsink's anchor names it by.
    pub points: Vec<Flap>,
}

/// Which step a sink report is of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SinkStep {
    Open,
    Closed,
    Unsink,
}

/// What a sink or an unsink did.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SinkReport {
    pub step: SinkStep,
    /// ℓ after snapping, and the side the moving paper started on: the tip
    /// side for a sink, the side the sunk tip lay on for an unsink.
    pub line: Line,
    pub side: Side,
    pub snap: Snap,
    /// A closed sink's pocket.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pocket: Option<Pocket>,
    /// The landed state's creases between the moved paper and the paper
    /// that stays, in id order: the ring, folded by a sink and flat after an
    /// unsink.
    pub ring: Vec<EdgeId>,
    #[serde(flatten)]
    pub fold: CompoundReport,
    /// The animation's legs (plan D15).
    pub motion: StepMotion,
    /// What the step stores: the pocket chosen among several, and the order
    /// chosen among several.
    pub stored: SinkChoices,
}

/// A landed sink or unsink.
#[derive(Debug, Clone)]
pub struct SinkFolded {
    pub state: State,
    pub report: SinkReport,
}

impl SinkFolded {
    /// This step's summary: `parent` is the state it folded, whose
    /// cross-section along ℓ on the side the paper moved from gives the
    /// layers.
    pub fn summary(&self, parent: &State) -> Result<StepSummary, Refused> {
        let section = parent.cross_section(&self.report.line, self.report.side)?;
        Ok(StepSummary::new(parent, &self.state, Some(section.layers)))
    }
}

/// A sink whose completion left more than one order (plan D4).
#[derive(Debug, Clone)]
pub struct SinkChoice {
    pending: Pending,
    context: Context,
}

impl SinkChoice {
    /// Every order there is to choose from, per independent component.
    pub fn completions(&self) -> &Completions {
        &self.pending.completions
    }

    /// The true ‹ n of m ›.
    pub fn count(&self) -> ChoiceCount {
        self.pending.completions.count()
    }

    /// Land the order `choice` names (one listed order per component); the
    /// report's `stored` holds what the step stores for it.
    pub fn pick(&self, choice: &[usize]) -> Result<SinkFolded, FoldRefusal> {
        let (folded, order) = self.pending.pick(choice)?;
        Ok(self.context.report(folded, Some(order)))
    }
}

/// Where a sink or an unsink got to.
#[derive(Debug, Clone)]
pub enum SinkOutcome {
    Landed(Box<SinkFolded>),
    /// The point has more than one pocket and the choices name none: store
    /// one and sink again.
    ChoosePocket(Box<SinkPoint>),
    /// More than one order fits: pick one.
    ChooseOrder(Box<SinkChoice>),
}

impl State {
    /// The point a sink would move and how it sinks, without folding.
    /// Refused when the anchor names no single point, or the point is open.
    pub fn analyse_sink(&self, op: &SinkFold) -> Result<SinkPoint, Refused> {
        let tip = self.sink_tip(&op.line, op.side, &op.anchor)?;
        let outline = tip.outline(self)?;
        Ok(tip.analysis(self, &outline, &CompletionLimits::default()))
    }

    /// A sink, with its stored choices (empty for a new step), under the
    /// default completion limits.
    pub fn sink(
        &self,
        op: &SinkFold,
        choices: &SinkChoices,
    ) -> Result<SinkOutcome, CompoundRefused> {
        self.sink_within(op, choices, &CompletionLimits::default())
    }

    /// [`State::sink`] under `limits`. A refusal says which precondition
    /// failed, with the fixes that land: the square line, or the other kind.
    /// A stored choice that no longer resolves is [`CompoundRefused::Broken`].
    pub fn sink_within(
        &self,
        op: &SinkFold,
        choices: &SinkChoices,
        limits: &CompletionLimits,
    ) -> Result<SinkOutcome, CompoundRefused> {
        let tip = self
            .sink_tip(&op.line, op.side, &op.anchor)
            .map_err(CompoundRefused::Refused)?;
        let outline = tip.outline(self).map_err(CompoundRefused::Refused)?;
        match op.kind {
            SinkKind::Open => {
                let shape = tip.shape(self, &outline);
                if let Some(mut refused) = tip.open_precondition(self, &shape) {
                    let (pockets, _) = tip.pockets(self, &outline);
                    if tip.closed_lands(self, &pockets, limits) {
                        refused.fixes.push(Fix::OtherSink {
                            kind: SinkKind::Closed,
                        });
                    }
                    return Err(CompoundRefused::Refused(refused));
                }
                let prepared = tip.open(self, &outline).map_err(compound)?;
                let context = Context::new(&tip, SinkStep::Open, None, None);
                finish(prepared, context, choices.order.as_ref(), limits, || {
                    let (pockets, _) = tip.pockets(self, &outline);
                    tip.closed_lands(self, &pockets, limits)
                })
            }
            SinkKind::Closed => {
                let (pockets, _) = tip.pockets(self, &outline);
                let pocket = match &choices.pocket {
                    Some(stored) => {
                        let k =
                            pocket_of(self, &pockets, stored).map_err(CompoundRefused::Broken)?;
                        &pockets[k]
                    }
                    None => match pockets.as_slice() {
                        [only] => only,
                        [] => {
                            let shape = tip.shape(self, &outline);
                            let fixes = if tip.open_lands(self, &outline, &shape, limits) {
                                vec![Fix::OtherSink {
                                    kind: SinkKind::Open,
                                }]
                            } else {
                                Vec::new()
                            };
                            return Err(CompoundRefused::Refused(Refused {
                                refusal: FoldRefusal::SinkNoPocket {
                                    faces: tip.face_ids(self),
                                },
                                fixes,
                            }));
                        }
                        _ => {
                            return Ok(SinkOutcome::ChoosePocket(Box::new(
                                tip.analysis(self, &outline, limits),
                            )));
                        }
                    },
                };
                let prepared = tip.closed(self, pocket).map_err(compound)?;
                // Stored only when there was a choice to make.
                let stored = (pockets.len() > 1).then(|| pocket.stored.clone());
                let context =
                    Context::new(&tip, SinkStep::Closed, Some(pocket.public(self)), stored);
                finish(prepared, context, choices.order.as_ref(), limits, || {
                    let shape = tip.shape(self, &outline);
                    tip.open_lands(self, &outline, &shape, limits)
                })
            }
        }
    }

    /// An unsink, with its stored order (none for a new step), under the
    /// default completion limits.
    pub fn unsink(
        &self,
        op: &Unsink,
        choices: &SinkChoices,
    ) -> Result<SinkOutcome, CompoundRefused> {
        self.unsink_within(op, choices, &CompletionLimits::default())
    }

    /// [`State::unsink`] under `limits`.
    pub fn unsink_within(
        &self,
        op: &Unsink,
        choices: &SinkChoices,
        limits: &CompletionLimits,
    ) -> Result<SinkOutcome, CompoundRefused> {
        let tip = self.unsink_tip(op).map_err(CompoundRefused::Refused)?;
        let (layer_of, layers) = display_layers(self, &tip.in_tip);
        // Each layer turns away from the paper it lies against.
        let mut turns = vec![None; layers];
        let topology = self.topology();
        let faces = self.faces();
        for (k, crease) in self.creases().iter().enumerate() {
            let [f, g] = match topology.crease_faces[k][..] {
                [f, g] if crease.kind.is_folded() && tip.in_tip[f] != tip.in_tip[g] => {
                    if tip.in_tip[f] { [f, g] } else { [g, f] }
                }
                _ => continue,
            };
            if let Some(layer) = layer_of[f] {
                turns[layer] = turns[layer].or(self.above(faces[f].id, faces[g].id));
            }
        }
        let reflection = tip.classified.axis.reflection();
        let prepared = prepare(
            self,
            &Macro {
                line: tip.classified.clone(),
                block_of: layer_of,
                blocks: vec![reflection; layers],
                against: Vec::new(),
                across: Across::Free,
            },
        )
        .map_err(compound)?;
        let mut context = Context::new(&tip, SinkStep::Unsink, None, None);
        context.turns = Some(turns.into_iter().map(|t| t.unwrap_or(false)).collect());
        finish(prepared, context, choices.order.as_ref(), limits, || false)
    }

    /// The sunk tip an unsink would pull back out, without folding. Refused
    /// as the unsink is: its anchor names paper that crosses ℓ, or paper not
    /// joined to the rest by a folded crease on it.
    pub fn analyse_unsink(&self, op: &Unsink) -> Result<SunkTip, Refused> {
        let tip = self.unsink_tip(op)?;
        let (line, side) = tip.classified.axis.line_and_side();
        Ok(SunkTip {
            line,
            side,
            snap: tip.classified.snap,
            faces: tip.face_ids(self),
        })
    }

    /// Every sunk point on `side` of `line` an unsink along it can pull back
    /// out: each flap of the side whose paper lies wholly on it, joined to the
    /// rest by a folded crease on ℓ — what [`State::unsink`] takes an anchor
    /// of — and hidden there, no layer of it the top or the bottom one along
    /// ℓ. Once a sink has put all the paper on one side of ℓ, the paper round
    /// the point passes the first test too, and an unsink of it turns the
    /// model inside out about the ring: it is no sunk point, and the second
    /// leaves it out. Empty when there is none; refused only when no paper
    /// lies on the side.
    pub fn sunk_points(&self, line: &Line, side: Side) -> Result<SunkPoints, Refused> {
        let classified = line::classify(&self.geometry().vertex_images, Axis::new(line, side))?;
        let moving = moving_side(self, &classified)?;
        let (line, side) = classified.axis.line_and_side();
        let section = self.cross_section(&line, side)?;
        let outside = |flap: &Flap| {
            section.intervals.iter().any(|interval| {
                [interval.faces.first(), interval.faces.last()]
                    .into_iter()
                    .flatten()
                    .any(|face| flap.faces.binary_search(face).is_ok())
            })
        };
        let points = moving
            .flaps
            .iter()
            .filter(|flap| {
                let op = Unsink {
                    line,
                    side,
                    anchor: Seed::Flaps {
                        at: vec![flap.witness],
                    },
                };
                !outside(flap) && self.unsink_tip(&op).is_ok()
            })
            .cloned()
            .collect();
        Ok(SunkPoints {
            line,
            side,
            snap: classified.snap,
            points,
        })
    }

    /// The point of a sink: ℓ classified, the moving side, and the one flap
    /// the anchor names. Refused when it names several, or when everything
    /// would move.
    fn sink_tip(&self, line: &Line, side: Side, anchor: &Seed) -> Result<Tip, Refused> {
        let classified = line::classify(&self.geometry().vertex_images, Axis::new(line, side))?;
        let moving = moving_side(self, &classified)?;
        // The top layers at a point are the top as the viewer sees them.
        let top = self.view().model_direction(Direction::Valley);
        let seeded = resolve_seed(
            self,
            &moving.pieces,
            top,
            &ResolvedSeed::from(anchor),
            &classified.axis,
        )?;
        let mut flaps: Vec<usize> = seeded.iter().filter_map(|&f| moving.flap_of[f]).collect();
        flaps.sort_unstable();
        flaps.dedup();
        let flap = match flaps[..] {
            [flap] => flap,
            _ => {
                let mut faces: Vec<FaceId> = flaps
                    .iter()
                    .flat_map(|&k| moving.flaps[k].faces.iter().copied())
                    .collect();
                faces.sort_unstable();
                return Err(Refused {
                    refusal: FoldRefusal::SinkSeveralPoints {
                        flaps: flaps.len(),
                        faces,
                    },
                    fixes: vec![Fix::PickFlap {
                        flaps: flaps.iter().map(|&k| moving.flaps[k].clone()).collect(),
                    }],
                });
            }
        };
        let nf = self.faces().len();
        let in_tip: Vec<bool> = (0..nf).map(|f| moving.flap_of[f] == Some(flap)).collect();
        let tip = Tip::new(self, classified, moving, Some(flap), in_tip);
        if (0..nf).all(|f| tip.in_tip[f] && !tip.has_stationary[f]) {
            let fixes = if tip.side.flaps.len() > 1 {
                vec![Fix::PickFlap {
                    flaps: tip.side.flaps.clone(),
                }]
            } else {
                Vec::new()
            };
            return Err(Refused {
                refusal: FoldRefusal::NothingStays,
                fixes,
            });
        }
        Ok(tip)
    }

    /// The sunk tip of an unsink: the faces grown from the anchor across
    /// every crease off ℓ, which must all lie on the op's side of it and be
    /// joined to the rest by a folded crease on it.
    fn unsink_tip(&self, op: &Unsink) -> Result<Tip, Refused> {
        let classified =
            line::classify(&self.geometry().vertex_images, Axis::new(&op.line, op.side))?;
        let moving = moving_side(self, &classified)?;
        let top = self.view().model_direction(Direction::Valley);
        let seeded = resolve_seed(
            self,
            &moving.pieces,
            top,
            &ResolvedSeed::from(&op.anchor),
            &classified.axis,
        )?;
        let classes = &classified.classes;
        let topology = self.topology();
        let creases = self.creases();
        let on_line = |k: usize| creases[k].vertices.iter().all(|v| classes[v.index()] == 0);
        let nf = self.faces().len();
        let mut in_tip = vec![false; nf];
        let mut queue: Vec<usize> = Vec::new();
        for f in seeded {
            if !in_tip[f] {
                in_tip[f] = true;
                queue.push(f);
            }
        }
        while let Some(f) = queue.pop() {
            for &k in &topology.face_creases[f] {
                if on_line(k) {
                    continue;
                }
                if let Some(g) = topology.across(k, f)
                    && !in_tip[g]
                {
                    in_tip[g] = true;
                    queue.push(g);
                }
            }
        }
        let ids = |keep: &dyn Fn(usize) -> bool| -> Vec<FaceId> {
            (0..nf)
                .filter(|&f| keep(f))
                .map(|f| self.faces()[f].id)
                .collect()
        };
        let across = ids(&|f| {
            in_tip[f]
                && self.faces()[f]
                    .ring
                    .iter()
                    .any(|v| classes[v.index()] == -1)
        });
        if !across.is_empty() {
            return Err(FoldRefusal::UnsinkNotSunk { faces: across }.into());
        }
        if in_tip.iter().all(|&t| t) {
            return Err(FoldRefusal::NothingStays.into());
        }
        let ringed = (0..creases.len()).any(|k| {
            creases[k].kind.is_folded()
                && on_line(k)
                && matches!(topology.crease_faces[k][..], [f, g] if in_tip[f] != in_tip[g])
        });
        if !ringed {
            return Err(FoldRefusal::UnsinkNotSunk {
                faces: ids(&|f| in_tip[f]),
            }
            .into());
        }
        Ok(Tip::new(self, classified, moving, None, in_tip))
    }
}

/// A refusal of the pipeline's steps as a compound refusal.
fn compound(refusal: FoldRefusal) -> CompoundRefused {
    CompoundRefused::Refused(refusal.into())
}

/// Complete a prepared sink: replay the stored order, land the one order,
/// or offer the choice. A sink no order fits is refused naming the faces
/// the conflict traces to, offering the other kind when `other_lands`.
fn finish(
    prepared: Prepared,
    context: Context,
    stored: Option<&WitnessOrder>,
    limits: &CompletionLimits,
    other_lands: impl FnOnce() -> bool,
) -> Result<SinkOutcome, CompoundRefused> {
    if let Some(stored) = stored {
        let folded = prepared
            .replay(stored, limits)
            .map_err(CompoundRefused::Broken)?;
        return Ok(SinkOutcome::Landed(Box::new(
            context.report(folded, Some(stored.clone())),
        )));
    }
    let completions = match prepared.complete(&[], limits) {
        Ok(completions) => completions,
        Err(refusal) => {
            let refusal = no_order(refusal);
            let mut fixes = Vec::new();
            if matches!(refusal, FoldRefusal::NoOrder { .. })
                && let Some(kind) = context.step.kind()
                && other_lands()
            {
                fixes.push(Fix::OtherSink { kind: kind.other() });
            }
            return Err(CompoundRefused::Refused(Refused { refusal, fixes }));
        }
    };
    if completions.is_unique() {
        let order = completions
            .order(&vec![0; completions.components().len()])
            .ok_or_else(|| {
                compound(FoldRefusal::Internal {
                    message: "a unique completion has no order".to_string(),
                })
            })?;
        let folded = prepared.land(order).map_err(compound)?;
        return Ok(SinkOutcome::Landed(Box::new(context.report(folded, None))));
    }
    Ok(SinkOutcome::ChooseOrder(Box::new(SinkChoice {
        pending: Pending {
            prepared,
            completions,
        },
        context,
    })))
}

impl SinkStep {
    fn kind(self) -> Option<SinkKind> {
        match self {
            SinkStep::Open => Some(SinkKind::Open),
            SinkStep::Closed => Some(SinkKind::Closed),
            SinkStep::Unsink => None,
        }
    }
}

/// What turns a landed compound fold into a sink's report.
#[derive(Debug, Clone)]
struct Context {
    step: SinkStep,
    line: Line,
    side: Side,
    snap: Snap,
    pocket: Option<Pocket>,
    stored_pocket: Option<StoredPocket>,
    /// Per block, whether it turns up (toward +z): an unsink's, read from the
    /// parent. None for a sink, whose blocks turn toward where they land.
    turns: Option<Vec<bool>>,
}

impl Context {
    fn new(
        tip: &Tip,
        step: SinkStep,
        pocket: Option<Pocket>,
        stored_pocket: Option<StoredPocket>,
    ) -> Context {
        let (line, side) = tip.classified.axis.line_and_side();
        Context {
            step,
            line,
            side,
            snap: tip.classified.snap,
            pocket,
            stored_pocket,
            turns: None,
        }
    }

    fn report(&self, folded: CompoundFolded, order: Option<WitnessOrder>) -> SinkFolded {
        let state = folded.state;
        let block: BTreeMap<FaceId, usize> = folded
            .report
            .blocks
            .iter()
            .enumerate()
            .flat_map(|(b, faces)| faces.iter().map(move |&f| (f, b)))
            .collect();
        // The ring, and each moved face's partner across it.
        let topology = state.topology();
        let faces = state.faces();
        let mut ring = Vec::new();
        let mut partner: BTreeMap<FaceId, FaceId> = BTreeMap::new();
        for (k, crease) in state.creases().iter().enumerate() {
            let [f, g] = match topology.crease_faces[k][..] {
                [f, g] => [faces[f].id, faces[g].id],
                _ => continue,
            };
            let (moved, stays) = match (block.contains_key(&f), block.contains_key(&g)) {
                (true, false) => (f, g),
                (false, true) => (g, f),
                _ => continue,
            };
            ring.push(crease.id);
            partner.entry(moved).or_insert(stays);
        }
        // A sink's block turns up when it lands above the paper it hinges
        // to: the lower block of a closed sink, a layer whose pocket side is
        // above.
        let groups: Vec<(Vec<FaceId>, bool)> = folded
            .report
            .blocks
            .iter()
            .enumerate()
            .map(|(b, faces)| {
                let up = match &self.turns {
                    Some(turns) => turns.get(b).copied().unwrap_or(false),
                    None => faces
                        .iter()
                        .find_map(|f| partner.get(f).and_then(|s| state.above(*f, *s)))
                        .unwrap_or(false),
                };
                (faces.clone(), up)
            })
            .collect();
        let motion = StepMotion::half_turns(self.line, self.side, &groups, MotionKind::Visual);
        SinkFolded {
            report: SinkReport {
                step: self.step,
                line: self.line,
                side: self.side,
                snap: self.snap,
                pocket: self.pocket.clone(),
                ring,
                fold: folded.report,
                motion,
                stored: SinkChoices {
                    pocket: self.stored_pocket.clone(),
                    order,
                },
            },
            state,
        }
    }
}

/// A sink's point, or an unsink's sunk tip, on a state.
#[derive(Debug, Clone)]
struct Tip {
    classified: Classified,
    side: MovingSide,
    /// The moving side's flap it is; none for an unsink's.
    flap: Option<usize>,
    /// Its face positions, ascending.
    faces: Vec<usize>,
    /// Per face position.
    in_tip: Vec<bool>,
    has_stationary: Vec<bool>,
}

/// The folded creases on a point's outline, by position, ascending, each with
/// the image of its part on the tip side.
#[derive(Debug, Clone)]
struct Outline {
    creases: Vec<(usize, [Point; 2])>,
}

/// What an open sink needs of a point's outline.
#[derive(Debug, Clone)]
struct Shape {
    exterior: Option<Letter>,
    axis: Option<PointAxis>,
}

/// A point with two straight sides.
#[derive(Debug, Clone, Copy)]
struct PointAxis {
    /// Where its sides meet; none when they are parallel. It need not be on
    /// the paper: a sunk point's sides meet above its flat top.
    apex: Option<Point>,
    /// How far apart along the axis ℓ meets the two sides.
    offset: f64,
    /// The line square to the axis where ℓ crosses it, folding the same side.
    square: Option<(Line, Side)>,
}

/// A pocket by face and crease positions.
#[derive(Debug, Clone, PartialEq)]
struct RawPocket {
    upper: Vec<usize>,
    lower: Vec<usize>,
    seams: Vec<usize>,
    upper_body: Vec<usize>,
    lower_body: Vec<usize>,
    stored: StoredPocket,
}

impl RawPocket {
    fn public(&self, state: &State) -> Pocket {
        let ids = |faces: &[usize]| faces.iter().map(|&f| state.faces()[f].id).collect();
        let mut seams: Vec<EdgeId> = self.seams.iter().map(|&k| state.creases()[k].id).collect();
        seams.sort_unstable();
        Pocket {
            upper: ids(&self.upper),
            lower: ids(&self.lower),
            seams,
            stored: self.stored.clone(),
        }
    }
}

impl Tip {
    fn new(
        state: &State,
        classified: Classified,
        side: MovingSide,
        flap: Option<usize>,
        in_tip: Vec<bool>,
    ) -> Tip {
        let classes = &classified.classes;
        let has_stationary = state
            .faces()
            .iter()
            .map(|face| face.ring.iter().any(|v| classes[v.index()] == -1))
            .collect();
        Tip {
            faces: (0..in_tip.len()).filter(|&f| in_tip[f]).collect(),
            classified,
            side,
            flap,
            in_tip,
            has_stationary,
        }
    }

    fn face_ids(&self, state: &State) -> Vec<FaceId> {
        self.faces.iter().map(|&f| state.faces()[f].id).collect()
    }

    fn analysis(&self, state: &State, outline: &Outline, limits: &CompletionLimits) -> SinkPoint {
        let shape = self.shape(state, outline);
        let (pockets, truncated) = self.pockets(state, outline);
        let open = self.open_precondition(state, &shape).map(|mut refused| {
            if self.closed_lands(state, &pockets, limits) {
                refused.fixes.push(Fix::OtherSink {
                    kind: SinkKind::Closed,
                });
            }
            refused
        });
        let (line, side) = self.classified.axis.line_and_side();
        let point = self
            .flap
            .and_then(|k| self.side.flaps.get(k).cloned())
            .unwrap_or_else(|| Flap {
                faces: self.face_ids(state),
                witness: [f64::NAN; 2],
            });
        SinkPoint {
            line,
            side,
            snap: self.classified.snap,
            point,
            outline: outline
                .creases
                .iter()
                .map(|&(k, _)| state.creases()[k].id)
                .collect(),
            exterior: shape.exterior,
            apex: shape.axis.and_then(|a| a.apex),
            square: shape.axis.and_then(|a| a.square).map(|(line, _)| line),
            open,
            pockets: pockets.iter().map(|p| p.public(state)).collect(),
            truncated,
        }
    }

    /// The point's outline (see the module docs): an edge of a tip face is
    /// on it where no paper of the point lies just past it on the tip side.
    /// Refused when a raw edge on it reaches the point's crown, its paper
    /// farthest from ℓ, which makes the point open (free corners). Raw edges
    /// lower down are a deep sink's, the line below the point's widest place,
    /// and leave it closed.
    fn outline(&self, state: &State) -> Result<Outline, Refused> {
        let geometry = state.geometry();
        let topology = state.topology();
        let axis = &self.classified.axis;
        let covered = |q: Point| {
            self.faces.iter().any(|&g| {
                self.side.pieces[g]
                    .as_deref()
                    .is_some_and(|p| convex::contains_point(p, q, TOL))
            })
        };
        let crown = self
            .faces
            .iter()
            .filter_map(|&f| self.side.pieces[f].as_deref())
            .flatten()
            .map(|&p| axis.distance(p))
            .fold(f64::NEG_INFINITY, f64::max);
        let mut seen = BTreeSet::new();
        let (mut creases, mut raw) = (Vec::new(), BTreeSet::new());
        for &f in &self.faces {
            let Some(centre) = self.side.pieces[f].as_deref().and_then(convex::centroid) else {
                continue;
            };
            for &k in &topology.face_creases[f] {
                if !seen.insert(k) {
                    continue;
                }
                let crease = &state.creases()[k];
                let [a, b] = crease.vertices.map(|v| geometry.vertex_images[v.index()]);
                let Some([p, q]) = tip_side_part(axis, a, b) else {
                    continue;
                };
                let length = (q[0] - p[0]).hypot(q[1] - p[1]);
                if length <= TOL {
                    continue;
                }
                // Away from the face: both faces of a folded crease lie on
                // one side of its image, so either face says the same.
                let mut out = [(p[1] - q[1]) / length, (q[0] - p[0]) / length];
                let mid = [(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0];
                if (centre[0] - mid[0]) * out[0] + (centre[1] - mid[1]) * out[1] > 0.0 {
                    out = [-out[0], -out[1]];
                }
                let on = (1..=OUTLINE_SAMPLES).any(|i| {
                    let t = i as f64 / (OUTLINE_SAMPLES + 1) as f64;
                    let s = [
                        p[0] + t * (q[0] - p[0]) + OUTLINE_REACH * out[0],
                        p[1] + t * (q[1] - p[1]) + OUTLINE_REACH * out[1],
                    ];
                    axis.distance(s) > TOL && !covered(s)
                });
                if !on {
                    continue;
                }
                match crease.kind {
                    CreaseKind::Border => {
                        if axis.distance(p).max(axis.distance(q)) >= crown - TOL {
                            raw.insert(state.faces()[f].id);
                        }
                    }
                    CreaseKind::Folded(_) => creases.push((k, [p, q])),
                    CreaseKind::Flat(_) => {}
                }
            }
        }
        if !raw.is_empty() {
            return Err(FoldRefusal::SinkPointOpen {
                faces: raw.into_iter().collect(),
            }
            .into());
        }
        creases.sort_unstable_by_key(|&(k, _)| k);
        Ok(Outline { creases })
    }

    /// The outline's one letter, and its two sides' axis when it has two:
    /// the lines its creases lie on, but for those parallel to ℓ (the flat
    /// top a sink leaves, which a second sink's point has).
    fn shape(&self, state: &State, outline: &Outline) -> Shape {
        let mut letters: Vec<Letter> = outline
            .creases
            .iter()
            .filter_map(|&(k, _)| state.creases()[k].kind.letter())
            .collect();
        letters.sort_unstable();
        letters.dedup();
        let exterior = match letters[..] {
            [letter] => Some(letter),
            _ => None,
        };
        let mut lines: Vec<Line> = Vec::new();
        for &(_, [p, q]) in &outline.creases {
            let on = |line: &Line| {
                line.signed_distance(p).abs() <= TOL && line.signed_distance(q).abs() <= TOL
            };
            if !lines.iter().any(on)
                && let Some(line) = Line::from_points(p, q)
            {
                lines.push(line);
            }
        }
        let n = normal(&self.classified.axis);
        lines.retain(|line| {
            let d = line.direction();
            (n[0] * d[0] + n[1] * d[1]).abs() > TOL
        });
        let axis = match lines[..] {
            [a, b] => point_axis(state, &self.classified.axis, &a, &b),
            _ => None,
        };
        Shape { exterior, axis }
    }

    /// Why an open sink of this point is refused, before anything is cut:
    /// its outline's letters, its axis and ℓ's square (see the module docs).
    fn open_precondition(&self, state: &State, shape: &Shape) -> Option<Refused> {
        let faces = self.face_ids(state);
        if shape.exterior.is_none() {
            return Some(FoldRefusal::SinkOutlineMixed { faces }.into());
        }
        let Some(axis) = shape.axis else {
            return Some(FoldRefusal::SinkNoAxis { faces }.into());
        };
        if axis.offset > TOL {
            return Some(Refused {
                refusal: FoldRefusal::SinkLineTilted {
                    offset: axis.offset,
                    faces,
                },
                fixes: axis
                    .square
                    .map(|(line, side)| Fix::UseLine { line, side })
                    .into_iter()
                    .collect(),
            });
        }
        None
    }

    /// Whether an open sink of this point has an order: a search that stops
    /// at the first order of each component.
    fn open_lands(
        &self,
        state: &State,
        outline: &Outline,
        shape: &Shape,
        limits: &CompletionLimits,
    ) -> bool {
        self.open_precondition(state, shape).is_none()
            && self
                .open(state, outline)
                .ok()
                .is_some_and(|prepared| prepared.complete(&[], &first_only(limits)).is_ok())
    }

    /// Whether a closed sink into one of the first pockets has an order.
    fn closed_lands(
        &self,
        state: &State,
        pockets: &[RawPocket],
        limits: &CompletionLimits,
    ) -> bool {
        pockets.iter().take(MAX_FIX_POCKETS).any(|pocket| {
            self.closed(state, pocket)
                .ok()
                .is_some_and(|prepared| prepared.complete(&[], &first_only(limits)).is_ok())
        })
    }

    /// The open sink through the pipeline's steps 2–7 (see the module docs):
    /// a block per display layer, each tip face anchored against its own
    /// piece that stays on its layer's pocket side.
    fn open(&self, state: &State, outline: &Outline) -> Result<Prepared, FoldRefusal> {
        let (layer_of, layers) = display_layers(state, &self.in_tip);
        let sides = pocket_sides(state, outline, &layer_of, layers);
        let reflection = self.classified.axis.reflection();
        let mut prepared = prepare(
            state,
            &Macro {
                line: self.classified.clone(),
                block_of: layer_of,
                blocks: vec![reflection; layers],
                against: Vec::new(),
                across: Across::Keep,
            },
        )?;
        let (parts, block_of) = prepared.landed();
        let partners = partners(&Topology::build(parts)?, block_of);
        let anchors: Vec<Anchor> = (0..parts.faces.len())
            .filter_map(|t| {
                let above = sides[block_of[t]?]?;
                (!partners[t].is_empty()).then(|| Anchor {
                    face: t,
                    to: partners[t].clone(),
                    above,
                })
            })
            .collect();
        prepared.anchor(&anchors);
        Ok(prepared)
    }

    /// The closed sink into `pocket` through the pipeline's steps 2–7: the
    /// inside reverse fold of the whole point, its lower block over its body
    /// and its upper block under its own, each face against the nearest face
    /// of its body.
    fn closed(&self, state: &State, pocket: &RawPocket) -> Result<Prepared, FoldRefusal> {
        let mut block_of = vec![None; state.faces().len()];
        for &f in &pocket.lower {
            block_of[f] = Some(0);
        }
        for &f in &pocket.upper {
            block_of[f] = Some(1);
        }
        let reflection = self.classified.axis.reflection();
        let mut prepared = prepare(
            state,
            &Macro {
                line: self.classified.clone(),
                block_of,
                blocks: vec![reflection; 2],
                against: vec![
                    Against {
                        block: 0,
                        faces: pocket.lower_body.clone(),
                        above: true,
                    },
                    Against {
                        block: 1,
                        faces: pocket.upper_body.clone(),
                        above: false,
                    },
                ],
                across: Across::Keep,
            },
        )?;
        let (parts, block_of) = prepared.landed();
        let lineage = lineage(state, parts);
        let staying = |body: &[usize]| -> Vec<usize> {
            (0..parts.faces.len())
                .filter(|&s| {
                    block_of[s].is_none()
                        && lineage[s].is_some_and(|p| body.binary_search(&p).is_ok())
                })
                .collect()
        };
        let (lower_to, upper_to) = (staying(&pocket.lower_body), staying(&pocket.upper_body));
        let anchors: Vec<Anchor> = (0..parts.faces.len())
            .filter_map(|t| match block_of[t] {
                Some(0) => Some(Anchor {
                    face: t,
                    to: lower_to.clone(),
                    above: true,
                }),
                Some(_) => Some(Anchor {
                    face: t,
                    to: upper_to.clone(),
                    above: false,
                }),
                None => None,
            })
            .collect();
        prepared.anchor(&anchors);
        Ok(prepared)
    }

    /// The pairs `(upper, lower)` of the point's faces (positions) that lie
    /// directly on one another somewhere on the tip side: one after the
    /// other in the stack of a cell of the overlay that reaches it.
    fn adjacent(&self, state: &State) -> BTreeSet<(usize, usize)> {
        let axis = &self.classified.axis;
        let mut out = BTreeSet::new();
        for cell in state.problem().overlay().cells() {
            if !cell.polygon.iter().any(|&p| axis.distance(p) > TOL) {
                continue;
            }
            let faces: Vec<FaceId> = cell
                .faces
                .iter()
                .copied()
                .filter(|&id| state.face_position(id).is_some_and(|f| self.in_tip[f]))
                .collect();
            let Some(stack) = sort_top_first(&faces, state.order()) else {
                continue;
            };
            for pair in stack.windows(2) {
                if let (Some(u), Some(l)) =
                    (state.face_position(pair[0]), state.face_position(pair[1]))
                {
                    out.insert((u, l));
                }
            }
        }
        out
    }

    /// The point's pockets (see the module docs), fewest lower faces first,
    /// and whether the scan stopped at [`MAX_POCKETS`].
    fn pockets(&self, state: &State, outline: &Outline) -> (Vec<RawPocket>, bool) {
        let topology = state.topology();
        let faces = &self.faces;
        let local = |f: usize| faces.binary_search(&f).unwrap_or(0);
        let on_outline: BTreeSet<usize> = outline.creases.iter().map(|&(k, _)| k).collect();
        // Pieces: the point cut along its outline creases.
        let mut pieces = UnionFind::new(faces.len());
        for (k, joined) in topology.crease_faces.iter().enumerate() {
            if on_outline.contains(&k) {
                continue;
            }
            if let [f, g] = joined[..]
                && self.in_tip[f]
                && self.in_tip[g]
            {
                pieces.join(local(f), local(g));
            }
        }
        let piece_of: Vec<usize> = (0..faces.len()).map(|i| pieces.root(i)).collect();
        // Which of the point's faces lie over which, where their tip pieces
        // overlap.
        let mut over: Vec<(usize, usize)> = Vec::new();
        for (pair, lo_above) in state.order().pairs() {
            let (Some(lo_above), Some(f), Some(g)) = (
                lo_above,
                state.face_position(pair.lo()),
                state.face_position(pair.hi()),
            ) else {
                continue;
            };
            if !self.in_tip[f] || !self.in_tip[g] {
                continue;
            }
            let (Some(p), Some(q)) = (&self.side.pieces[f], &self.side.pieces[g]) else {
                continue;
            };
            if convex::penetration(p, q) > TOL {
                over.push(if lo_above { (f, g) } else { (g, f) });
            }
        }
        let Some(splits) = down_sets(&piece_of, &over, &local, MAX_POCKETS + 1) else {
            return (Vec::new(), false);
        };
        let (layer_of, _) = display_layers(state, &self.in_tip);
        let adjacent = self.adjacent(state);
        let bodies = Bodies::new(state, self);
        let (mut pockets, mut truncated) = (Vec::new(), false);
        for lower_pieces in splits {
            if pockets.len() >= MAX_POCKETS {
                truncated = true;
                break;
            }
            let (lower, upper): (Vec<usize>, Vec<usize>) = faces
                .iter()
                .partition(|&&f| lower_pieces.contains(&piece_of[local(f)]));
            if lower.is_empty() || upper.is_empty() {
                continue;
            }
            let in_lower = |f: usize| lower.binary_search(&f).is_ok();
            let seams: Vec<(usize, [usize; 2])> = outline
                .creases
                .iter()
                .filter_map(|&(k, _)| match topology.crease_faces[k][..] {
                    [f, g] if in_lower(f) != in_lower(g) => {
                        Some((k, if in_lower(f) { [g, f] } else { [f, g] }))
                    }
                    _ => None,
                })
                .collect();
            // The gap itself: the seams whose two faces lie directly on one
            // another somewhere (a crease wrapping round the whole stack is
            // a seam, and turns, but bounds no gap). It is bounded along all
            // of it by one display layer, above or below.
            let (gaps, rest): (Vec<[usize; 2]>, Vec<[usize; 2]>) = seams
                .iter()
                .map(|&(_, ends)| ends)
                .partition(|&[u, l]| adjacent.contains(&(u, l)));
            let one = |side: usize| {
                let mut layers = gaps.iter().map(|ends| layer_of[ends[side]]);
                let first = layers.next().flatten();
                first.is_some() && layers.all(|l| l == first)
            };
            if gaps.is_empty() || !(one(0) || one(1)) {
                continue;
            }
            let (lower_body, upper_body) = (bodies.of(self, &lower), bodies.of(self, &upper));
            if lower_body.is_empty()
                || upper_body.is_empty()
                || !bodies.separated(state, &lower_body, &upper_body)
            {
                continue;
            }
            pockets.push((
                RawPocket {
                    upper,
                    lower,
                    seams: seams.iter().map(|&(k, _)| k).collect(),
                    upper_body,
                    lower_body,
                    stored: StoredPocket {
                        above: [f64::NAN; 2],
                        below: [f64::NAN; 2],
                    },
                },
                // Where a step stores it from: a gap first.
                gaps.into_iter().chain(rest).collect::<Vec<_>>(),
            ));
        }
        pockets.sort_by(|a, b| (a.0.lower.len(), &a.0.lower).cmp(&(b.0.lower.len(), &b.0.lower)));
        pockets.dedup_by(|a, b| a.0 == b.0);
        // Each stored by the first seam whose two faces only it separates.
        let separates = |pocket: &RawPocket, [u, l]: [usize; 2]| {
            pocket.upper.binary_search(&u).is_ok() && pocket.lower.binary_search(&l).is_ok()
        };
        let witness = |f: usize| {
            state
                .face_witness(state.faces()[f].id)
                .unwrap_or([f64::NAN; 2])
        };
        let stored: Vec<Option<StoredPocket>> = pockets
            .iter()
            .map(|(_, seams)| {
                seams
                    .iter()
                    .copied()
                    .find(|&ends| pockets.iter().filter(|(p, _)| separates(p, ends)).count() == 1)
                    .or_else(|| seams.first().copied())
                    .map(|[u, l]| StoredPocket {
                        above: witness(u),
                        below: witness(l),
                    })
            })
            .collect();
        let pockets = pockets
            .into_iter()
            .zip(stored)
            .map(|((pocket, _), stored)| RawPocket {
                stored: stored.unwrap_or(pocket.stored.clone()),
                ..pocket
            })
            .collect();
        (pockets, truncated)
    }
}

/// The part of the segment `a b` on the tip side of `axis`; none when it
/// has none beyond the tolerance.
fn tip_side_part(axis: &Axis, a: Point, b: Point) -> Option<[Point; 2]> {
    let (da, db) = (axis.distance(a), axis.distance(b));
    if da <= TOL && db <= TOL {
        return None;
    }
    let cut = |p: Point, dp: f64, q: Point, dq: f64| {
        if dp >= 0.0 {
            p
        } else {
            let t = dp / (dp - dq);
            [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]
        }
    };
    Some([cut(a, da, b, db), cut(b, db, a, da)])
}

/// The moving side's unit normal.
fn normal(axis: &Axis) -> Point {
    let (line, side) = axis.line_and_side();
    match side {
        Side::Positive => line.n,
        Side::Negative => [-line.n[0], -line.n[1]],
    }
}

/// The axis of a point whose sides lie on the lines `a` and `b`: the
/// bisector of the two sides running toward ℓ from where they meet (or
/// their midline, when they are parallel), how unevenly ℓ cuts them along
/// it, and the square line through the axis's crossing with ℓ, offered only
/// when it classifies cleanly.
fn point_axis(state: &State, axis: &Axis, a: &Line, b: &Line) -> Option<PointAxis> {
    let n = normal(axis);
    let dot = |p: Point, q: Point| p[0] * q[0] + p[1] * q[1];
    // Each side's direction toward ℓ.
    let toward = |line: &Line| {
        let d = line.direction();
        let rate = dot(n, d);
        (rate.abs() > TOL).then(|| if rate < 0.0 { d } else { [-d[0], -d[1]] })
    };
    let (d1, d2) = (toward(a)?, toward(b)?);
    let (ring, _) = axis.line_and_side();
    let (p1, p2) = (ring.intersect(a)?, ring.intersect(b)?);
    let (u, through, apex) = match a.intersect(b).filter(|_| a.cross(b).abs() > TOL) {
        Some(apex) => {
            let sum = [d1[0] + d2[0], d1[1] + d2[1]];
            let norm = sum[0].hypot(sum[1]);
            if norm <= TOL {
                return None;
            }
            ([sum[0] / norm, sum[1] / norm], apex, Some(apex))
        }
        None => (d1, [(p1[0] + p2[0]) / 2.0, (p1[1] + p2[1]) / 2.0], None),
    };
    let along = -dot(n, u);
    if along <= TOL {
        return None;
    }
    let s = axis.distance(through) / along;
    let crossing = [through[0] + s * u[0], through[1] + s * u[1]];
    let tip = [crossing[0] - u[0], crossing[1] - u[1]];
    let square = Line::new([-u[0], -u[1]], -dot(u, crossing))
        .and_then(|line| Some((line, Side::of_point(&line, tip)?)))
        .and_then(|(line, side)| {
            line::classify(&state.geometry().vertex_images, Axis::new(&line, side))
                .ok()
                .map(|c| c.axis.line_and_side())
        });
    Some(PointAxis {
        apex,
        offset: dot(u, [p1[0] - p2[0], p1[1] - p2[1]]).abs(),
        square,
    })
}

/// `limits` searching only for the first order of each component: whether
/// any order exists.
fn first_only(limits: &CompletionLimits) -> CompletionLimits {
    CompletionLimits {
        per_component: 1,
        ..*limits
    }
}

/// Per face position, its display layer among the faces `members` marks:
/// the members joined across flat creases, which share one isometry (plan
/// D14), numbered from the one with the least face; and how many there are.
fn display_layers(state: &State, members: &[bool]) -> (Vec<Option<usize>>, usize) {
    let topology = state.topology();
    let mut joined = UnionFind::new(members.len());
    for (crease, faces) in state.creases().iter().zip(&topology.crease_faces) {
        if let (CreaseKind::Flat(_), &[f, g]) = (crease.kind, &faces[..])
            && members[f]
            && members[g]
        {
            joined.join(f, g);
        }
    }
    let mut index: BTreeMap<usize, usize> = BTreeMap::new();
    let layer_of = (0..members.len())
        .map(|f| {
            members[f].then(|| {
                let next = index.len();
                *index.entry(joined.root(f)).or_insert(next)
            })
        })
        .collect();
    (layer_of, index.len())
}

/// Per display layer of the point, the side its tip faces go to against
/// their own pieces that stay: toward the layers its outline creases join
/// it to, above or below in the parent. None for a layer on no outline
/// crease, or joined both ways; the completion places it.
fn pocket_sides(
    state: &State,
    outline: &Outline,
    layer_of: &[Option<usize>],
    layers: usize,
) -> Vec<Option<bool>> {
    let topology = state.topology();
    let faces = state.faces();
    // None: nothing seen yet; Some(None): undecided.
    let mut sides: Vec<Option<Option<bool>>> = vec![None; layers];
    for &(k, _) in &outline.creases {
        let [f, g] = match topology.crease_faces[k][..] {
            [f, g] => [f, g],
            _ => continue,
        };
        for (face, partner) in [(f, g), (g, f)] {
            let Some(layer) = layer_of[face] else {
                continue;
            };
            let above = state.above(faces[partner].id, faces[face].id);
            sides[layer] = match (sides[layer], above) {
                (None, Some(above)) => Some(Some(above)),
                (Some(Some(was)), Some(above)) if was == above => Some(Some(above)),
                _ => Some(None),
            };
        }
    }
    sides.into_iter().map(Option::flatten).collect()
}

/// Per landed face position, the faces that stay across a crease from it,
/// when it moves: its hinges on ℓ, since the point grows across every crease
/// off ℓ.
fn partners(topology: &Topology, block_of: &[Option<usize>]) -> Vec<Vec<usize>> {
    let mut out = vec![Vec::new(); block_of.len()];
    for faces in &topology.crease_faces {
        if let [f, g] = faces[..] {
            match (block_of[f], block_of[g]) {
                (Some(_), None) => out[f].push(g),
                (None, Some(_)) => out[g].push(f),
                _ => {}
            }
        }
    }
    out
}

/// Per landed face position, the parent's face it is or is a piece of.
fn lineage(parent: &State, landed: &StateParts) -> Vec<Option<usize>> {
    landed
        .faces
        .iter()
        .map(|face| {
            parent
                .face_position(face.id)
                .or_else(|| face.parent.and_then(|p| parent.face_position(p)))
        })
        .collect()
}

/// A stored pocket's index among `pockets`: the one pocket with the face at
/// `above` above it and the face at `below` below it; or, when none has,
/// the one with them the other way round. A pocket is the gap between its
/// faces, whichever way up: started the other side up (the Paper pane's
/// Front up / Back up replays every step on the sheet turned over, each
/// step's direction the viewer's), the model-frame stack is reversed and
/// the faces the step stored above the gap lie below it.
fn pocket_of(state: &State, pockets: &[RawPocket], stored: &StoredPocket) -> Result<usize, Broken> {
    let face = |witness: usize, point: Point| {
        point
            .iter()
            .all(|c| c.is_finite())
            .then(|| state.face_at(point))
            .flatten()
            .and_then(|id| state.face_position(id))
            .ok_or(Broken::Witness {
                witness: BrokenWitness::NoFace { witness, point },
            })
    };
    let (u, l) = (face(0, stored.above)?, face(1, stored.below)?);
    let between = |above: usize, below: usize| -> Vec<usize> {
        (0..pockets.len())
            .filter(|&k| {
                pockets[k].upper.binary_search(&above).is_ok()
                    && pockets[k].lower.binary_search(&below).is_ok()
            })
            .collect()
    };
    let found = match between(u, l) {
        found if found.is_empty() => between(l, u),
        found => found,
    };
    match found[..] {
        [k] => Ok(k),
        _ => Err(Broken::Pocket),
    }
}

/// What each face of a point is hinged to on ℓ, and the pieces that stay.
struct Bodies {
    /// Per face of the point (by its index among the point's faces), its
    /// body: its own piece that stays, and every face wholly on the
    /// stationary side across a crease on ℓ.
    of_face: Vec<Vec<usize>>,
    /// Per face position, its image on the stationary side, where it has
    /// one.
    pieces: Vec<Option<Vec<Point>>>,
}

impl Bodies {
    fn new(state: &State, tip: &Tip) -> Bodies {
        let classes = &tip.classified.classes;
        let topology = state.topology();
        let mut of_face: Vec<Vec<usize>> = tip
            .faces
            .iter()
            .map(|&f| {
                if tip.has_stationary[f] {
                    vec![f]
                } else {
                    Vec::new()
                }
            })
            .collect();
        for (crease, faces) in state.creases().iter().zip(&topology.crease_faces) {
            if crease.kind == CreaseKind::Border
                || crease.vertices.iter().any(|v| classes[v.index()] != 0)
            {
                continue;
            }
            let [f, g] = match faces[..] {
                [f, g] => [f, g],
                _ => continue,
            };
            for (inner, outer) in [(f, g), (g, f)] {
                if let Ok(i) = tip.faces.binary_search(&inner)
                    && tip.side.pieces[outer].is_none()
                {
                    of_face[i].push(outer);
                }
            }
        }
        let images = &state.geometry().images;
        let half = tip.classified.axis.moving_half_plane();
        let pieces = (0..state.faces().len())
            .map(|f| {
                if tip.side.pieces[f].is_none() {
                    return Some(images[f].clone());
                }
                if !tip.has_stationary[f] {
                    return None;
                }
                half.map(|h| convex::split(&images[f], &h, TOL).outside)
                    .filter(|p| p.len() >= 3)
            })
            .collect();
        Bodies { of_face, pieces }
    }

    /// The body of a block of the point's faces, ascending.
    fn of(&self, tip: &Tip, block: &[usize]) -> Vec<usize> {
        let mut body: Vec<usize> = tip
            .faces
            .iter()
            .zip(&self.of_face)
            .filter(|(f, _)| block.binary_search(f).is_ok())
            .flat_map(|(_, body)| body.iter().copied())
            .collect();
        body.sort_unstable();
        body.dedup();
        body
    }

    /// No face in both, and the lower body below the upper wherever their
    /// pieces that stay overlap.
    fn separated(&self, state: &State, lower: &[usize], upper: &[usize]) -> bool {
        let faces = state.faces();
        lower.iter().all(|&a| {
            upper.iter().all(|&b| {
                if a == b {
                    return false;
                }
                let (Some(p), Some(q)) = (&self.pieces[a], &self.pieces[b]) else {
                    return true;
                };
                convex::penetration(p, q) <= TOL
                    || state.above(faces[a].id, faces[b].id) == Some(false)
            })
        })
    }
}

/// Union–find over `0..n`.
struct UnionFind {
    parent: Vec<usize>,
}

impl UnionFind {
    fn new(n: usize) -> UnionFind {
        UnionFind {
            parent: (0..n).collect(),
        }
    }

    fn root(&mut self, mut i: usize) -> usize {
        while self.parent[i] != i {
            self.parent[i] = self.parent[self.parent[i]];
            i = self.parent[i];
        }
        i
    }

    fn join(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.root(a), self.root(b));
        if ra != rb {
            self.parent[ra.max(rb)] = ra.min(rb);
        }
    }
}
