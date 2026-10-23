//! The crimp (plan Phase 11, research §5.2): two reverse folds of one kind,
//! along ℓ1 nearer the body and ℓ2 nearer the tip, folded as one operation
//! through the compound pipeline ([`super`]) and verified only at its end.
//!
//! - **One operation.** The strip between the lines moves by ρ1, the
//!   reflection across ℓ1, and the tip beyond ℓ2 by ρ1∘ρ2: a rotation about
//!   where the lines meet, or a translation when they are parallel. As two
//!   reverse folds, the first alone is not flat in 4.5% (inside) and 5.6%
//!   (outside) of the spike's valid crimps, so nothing is landed between.
//! - **One kind on both lines.** An inside crimp is two inside reverses, an
//!   outside crimp two outside ones. A mixed pair is a reverse and a counter-
//!   reverse, not a crimp: as one op it is valid in 8–14% of random ops, but
//!   in 574 of the spike's 585 valid mixed states the first reverse alone
//!   lands, so it is left to two reverse folds.
//! - **The tip and its openings** are the reverse fold's at ℓ1
//!   ([`super::reverse`]): each flap opens at its own layers, and a flap
//!   that opens several ways is chosen by its upper block, stored. ℓ2 opens
//!   every flap between the same layers, so a flap must reach past ℓ2 with
//!   both blocks or with neither.
//! - **Two scores.** ℓ1 scores the tip, then ℓ2 scores what lies across it
//!   (the second score pass), and steps 3–7 run once on the result. The
//!   lines must not cross over the paper the crimp moves. They may share an
//!   exact boundary endpoint with a nondegenerate strip on one side.
//! - **The order.** Carried: pairs that stay, kept; pairs in one block,
//!   reversed in the strip and kept in the tip (ρ1∘ρ2 turns nothing over).
//!   Seeded: pairs across the blocks of the strip, and across those of the
//!   tip, kept, except corresponding nested packet halves which follow
//!   their strip/tip motion; each strip block against its body on ℓ1, and each tip block
//!   against its strip on ℓ2, inside putting the lower block over its body
//!   and the upper under, outside the reverse. Nothing else of the tip is
//!   ordered against the strip: as the second reverse would, the completion
//!   decides it ([`super::Across::Alike`]). With these seeds the spike found
//!   99.0% of feasible inside crimps unique and 98.9% of outside ones.
//! - **Letters** follow from the order: the strip's spine creases turn M↔V
//!   and the tip's turn twice, keeping theirs.

use std::collections::{BTreeSet, HashMap};

use oristudio_geometry::Line;
use oristudio_layer_order::LayerOrder;
use serde::{Deserialize, Serialize};

use crate::complete::{ChoiceCount, CompletionLimits, Completions};
use crate::compound::motion::{StepMotion, Turn};
use crate::compound::pieces::{Pieces, Scoring, prepare_pieces};
use crate::compound::reverse::{
    Opening, Plan, ReverseAnalysis, ReverseChoices, ReverseFold, ReverseKind, Tip,
};
use crate::compound::{
    Across, Against, CompoundFolded, CompoundRefused, CompoundReport, Pending, Prepared, no_order,
};
use crate::fold::line::{self, Axis, Classified};
use crate::fold::score::{self, Scored, ScoredFace};
use crate::fold::{ActionKind, FoldActionGeometry, FoldAnalysis, PlainFold, Pleat, Seed, Snap};
use crate::isometry::Isometry;
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::{CreaseKind, EdgeId, FaceId, VertexId};
use crate::refusal::{Fix, FoldRefusal, Refused, Side};
use crate::scene::ScenePoint;
use crate::state::{State, StateParts, Topology};
use crate::view::Direction;
use crate::witness::WitnessOrder;

type Point = [f64; 2];

/// A crimp, named the way a step stores it (plan D6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CrimpFold {
    /// ℓ1, the line nearer the body, in the parent's model frame.
    pub first: Line,
    /// ℓ2, the line nearer the tip. Its tip side is the one away from ℓ1.
    pub second: Line,
    /// The side of ℓ1 the tip, and ℓ2, are on.
    pub side: Side,
    /// What the tip grows from, as a reverse fold's anchor.
    pub anchor: Seed,
    /// Inside or outside, on both lines.
    pub kind: ReverseKind,
}

impl CrimpFold {
    /// The reverse fold along ℓ1 whose tip the crimp's is.
    fn first_reverse(&self) -> ReverseFold {
        ReverseFold {
            line: self.first,
            side: self.side,
            anchor: self.anchor.clone(),
            kind: self.kind,
        }
    }
}

/// What a crimp moves and how its flaps open, before it lands.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CrimpAnalysis {
    /// The tip at ℓ1 and how each of its flaps opens: the reverse fold's.
    pub tip: ReverseAnalysis,
    /// ℓ2 after snapping, and its side away from ℓ1.
    pub second: Line,
    pub second_side: Side,
    pub second_snap: Snap,
    /// The tip's faces with paper beyond ℓ2, in id order.
    pub beyond: Vec<FaceId>,
}

/// What a crimp did.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CrimpReport {
    /// ℓ1 after snapping and the tip's side of it.
    pub first: Line,
    pub side: Side,
    pub snap: Snap,
    /// ℓ2 after snapping and its side away from ℓ1.
    pub second: Line,
    pub second_side: Side,
    pub second_snap: Snap,
    pub kind: ReverseKind,
    /// Each opening flap's opening. The report's blocks are the strip's —
    /// `2k` (lower) and `2k + 1` (upper) for the opening `k`, then one per
    /// flap moving whole — and then the tip's, in the same order.
    pub openings: Vec<Opening>,
    /// The flaps with no spine to open along, moving whole: the parent's
    /// faces of each.
    pub whole: Vec<Vec<FaceId>>,
    #[serde(flatten)]
    pub fold: CompoundReport,
    /// The animation's legs (plan D15).
    pub motion: StepMotion,
    /// What the step stores: the openings chosen among several, and the
    /// order chosen among several.
    pub stored: ReverseChoices,
}

/// A landed crimp.
#[derive(Debug, Clone)]
pub struct CrimpFolded {
    pub state: State,
    pub report: CrimpReport,
}

/// A crimp whose completion left more than one order (plan D4).
#[derive(Debug, Clone)]
pub struct CrimpChoice {
    pending: Pending,
    context: Context,
}

impl CrimpChoice {
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
    pub fn pick(&self, choice: &[usize]) -> Result<CrimpFolded, FoldRefusal> {
        let (folded, order) = self.pending.pick(choice)?;
        Ok(self.context.report(folded, Some(order)))
    }
}

/// Where a crimp got to.
#[derive(Debug, Clone)]
pub enum CrimpOutcome {
    Landed(Box<CrimpFolded>),
    /// A flap opens more than one way and the choices name none of them:
    /// store one of each such flap's openings and fold again.
    ChooseOpening(Box<CrimpAnalysis>),
    /// More than one order fits: pick one.
    ChooseOrder(Box<CrimpChoice>),
}

/// What turns a landed compound fold into a crimp's report.
#[derive(Debug, Clone)]
struct Context {
    first: Line,
    side: Side,
    snap: Snap,
    second: Line,
    second_side: Side,
    second_snap: Snap,
    kind: ReverseKind,
    openings: Vec<Opening>,
    whole: Vec<Vec<FaceId>>,
    stored_openings: Vec<StoredOpenings>,
    /// The strip's block count; the tip's blocks follow.
    strip_blocks: usize,
}

type StoredOpenings = crate::compound::reverse::StoredOpening;

impl Context {
    fn report(&self, folded: CompoundFolded, order: Option<WitnessOrder>) -> CrimpFolded {
        // As a reverse fold's: lower blocks turn up for an inside crimp,
        // upper ones down, and a flap moving whole with the lower blocks.
        let opened = 2 * self.openings.len();
        let up =
            |b: usize| (b >= opened || b.is_multiple_of(2)) == (self.kind == ReverseKind::Inside);
        let groups = |range: std::ops::Range<usize>| -> Vec<(Vec<FaceId>, bool)> {
            range
                .map(|b| {
                    let faces = folded.report.blocks.get(b).cloned().unwrap_or_default();
                    (faces, up(b % self.strip_blocks.max(1)))
                })
                .filter(|(faces, _)| !faces.is_empty())
                .collect()
        };
        let strip = groups(0..self.strip_blocks);
        // Each tip block turns about ℓ2 as its strip block carries it.
        let tip = groups(self.strip_blocks..2 * self.strip_blocks);
        let motion = StepMotion::crimp(
            Turn {
                axis: self.first,
                side: self.side,
            },
            Turn {
                axis: self.second,
                side: self.second_side,
            },
            &strip,
            &tip,
        );
        CrimpFolded {
            state: folded.state,
            report: CrimpReport {
                first: self.first,
                side: self.side,
                snap: self.snap,
                second: self.second,
                second_side: self.second_side,
                second_snap: self.second_snap,
                kind: self.kind,
                openings: self.openings.clone(),
                whole: self.whole.clone(),
                fold: folded.report,
                motion,
                stored: ReverseChoices {
                    openings: self.stored_openings.clone(),
                    order,
                },
            },
        }
    }
}

/// ℓ2's score composed with ℓ1's (`State::score_second`): what the shared
/// steps 3–7 take, and what the crimp places its tip against.
struct SecondScore {
    /// The parent scored along both lines, each face's `old` its parent
    /// face, the chords last.
    scored: Scored,
    /// Per scored face, its block: a strip block's paper beyond ℓ2 in its
    /// tip block; none for a face that stays.
    block_of: Vec<Option<usize>>,
    /// Per strip block, the landed faces of the strip hinged on ℓ2 to its
    /// tip.
    bodies: Vec<Vec<FaceId>>,
}

/// A crimp's tip at ℓ1 and its two scores' first: everything before a plan
/// says how the flaps open.
struct Crimp {
    tip: Tip,
    /// The tip scored along ℓ1: every tip face, whatever the plan.
    first: Scored,
    /// ℓ2 oriented toward the tip and snapped, with every vertex of `first`
    /// classified.
    second: Classified,
}

impl Crimp {
    /// Whether the scored face at `a` of the first pass is tip paper.
    fn in_tip(&self, a: usize) -> bool {
        let s = &self.first.faces[a];
        self.tip.in_tip[s.old] && s.piece != score::Piece::Negative
    }

    fn analysis(&self, state: &State) -> CrimpAnalysis {
        let (second, second_side) = self.second.axis.line_and_side();
        let mut beyond: Vec<FaceId> = (0..self.first.faces.len())
            .filter(|&a| self.in_tip(a) && self.beyond(a))
            .map(|a| state.faces()[self.first.faces[a].old].id)
            .collect();
        beyond.sort_unstable();
        beyond.dedup();
        CrimpAnalysis {
            tip: self.tip.analysis(state),
            second,
            second_side,
            second_snap: self.second.snap,
            beyond,
        }
    }

    /// Whether the first pass's face at `a` has paper beyond ℓ2.
    fn beyond(&self, a: usize) -> bool {
        self.first.faces[a]
            .face
            .ring
            .iter()
            .any(|v| score::class_of(&self.second.classes, *v) == 1)
    }
}

impl State {
    /// The tip of a crimp, how each of its flaps opens and what lies beyond
    /// its second line, without folding.
    pub fn analyse_crimp(&self, op: &CrimpFold) -> Result<CrimpAnalysis, Refused> {
        Ok(self.crimp(op)?.analysis(self))
    }

    /// The kinds of this crimp that land (with the stored openings, when a
    /// flap opens more than one way): one when the lines are not parallel,
    /// in all but 18 of the spike's 1,746 such ops.
    pub fn crimp_kinds(
        &self,
        op: &CrimpFold,
        choices: &ReverseChoices,
    ) -> Result<Vec<ReverseKind>, CompoundRefused> {
        let crimp = self.crimp(op).map_err(CompoundRefused::Refused)?;
        let Some(plan) = crimp.tip.choose(self, choices)? else {
            return Ok(Vec::new());
        };
        let inside = CrimpFold {
            kind: ReverseKind::Inside,
            ..op.clone()
        };
        let Ok((prepared, _)) = self.prepare_crimp(&inside, &crimp, &plan) else {
            return Ok(Vec::new());
        };
        let limits = CompletionLimits::default();
        Ok([
            (ReverseKind::Inside, prepared.lands(&limits)),
            (ReverseKind::Outside, prepared.lands_flipped(&limits)),
        ]
        .into_iter()
        .filter_map(|(kind, lands)| lands.then_some(kind))
        .collect())
    }

    /// A crimp, with its stored choices (empty for a new step), under the
    /// default completion limits.
    pub fn crimp_fold(
        &self,
        op: &CrimpFold,
        choices: &ReverseChoices,
    ) -> Result<CrimpOutcome, CompoundRefused> {
        self.crimp_fold_within(op, choices, &CompletionLimits::default())
    }

    /// [`State::crimp_fold`] under `limits`. A crimp no order fits is
    /// refused naming the faces the conflict traces to — the layers in its
    /// way when there are such — offering the other kind when it lands; a
    /// stored choice that no longer resolves is [`CompoundRefused::Broken`].
    pub fn crimp_fold_within(
        &self,
        op: &CrimpFold,
        choices: &ReverseChoices,
        limits: &CompletionLimits,
    ) -> Result<CrimpOutcome, CompoundRefused> {
        let refused = |r: Refused| CompoundRefused::Refused(r);
        let crimp = self.crimp(op).map_err(refused)?;
        let Some(plan) = crimp.tip.choose(self, choices)? else {
            return Ok(CrimpOutcome::ChooseOpening(Box::new(crimp.analysis(self))));
        };
        let (prepared, strip_blocks) = self
            .prepare_crimp(op, &crimp, &plan)
            .map_err(|r| refused(r.into()))?;
        let (second, second_side) = crimp.second.axis.line_and_side();
        let ids = |faces: &[usize]| faces.iter().map(|&f| self.faces()[f].id).collect();
        let context = Context {
            first: crimp.tip.line(),
            side: crimp.tip.side(),
            snap: crimp.tip.classified.snap,
            second,
            second_side,
            second_snap: crimp.second.snap,
            kind: op.kind,
            openings: plan.openings.iter().map(|o| o.public(self)).collect(),
            whole: plan.whole.iter().map(|faces| ids(faces)).collect(),
            stored_openings: plan.stored.clone(),
            strip_blocks,
        };
        if let Some(stored) = &choices.order {
            let folded = prepared
                .replay(stored, limits)
                .map_err(CompoundRefused::Broken)?;
            return Ok(CrimpOutcome::Landed(Box::new(
                context.report(folded, Some(stored.clone())),
            )));
        }
        let completions = match prepared.complete(&[], limits) {
            Ok(completions) => completions,
            Err(refusal) => {
                return Err(refused(self.diagnose_crimp(
                    op,
                    &crimp,
                    &prepared,
                    no_order(refusal),
                    limits,
                )));
            }
        };
        if completions.is_unique() {
            let order = completions
                .order(&vec![0; completions.components().len()])
                .ok_or_else(|| {
                    refused(
                        FoldRefusal::Internal {
                            message: "a unique completion has no order".to_string(),
                        }
                        .into(),
                    )
                })?;
            let folded = prepared.land(order).map_err(|r| refused(r.into()))?;
            return Ok(CrimpOutcome::Landed(Box::new(context.report(folded, None))));
        }
        Ok(CrimpOutcome::ChooseOrder(Box::new(CrimpChoice {
            pending: Pending {
                prepared,
                completions,
            },
            context,
        })))
    }

    /// The crimp's tip at ℓ1, the tip scored along ℓ1, and ℓ2 classified
    /// over it. Refused when the lines meet over the tip, or ℓ2 misses it.
    fn crimp(&self, op: &CrimpFold) -> Result<Crimp, Refused> {
        let tip = self.tip(&op.first_reverse())?;
        let parts = self.parts();
        let classes = &tip.classified.classes;
        let crosses = |f: usize| parts.faces[f].ring.iter().any(|v| classes[v.index()] == -1);
        let first_split: Vec<bool> = (0..parts.faces.len())
            .map(|f| tip.in_tip[f] && crosses(f))
            .collect();
        let first = score::score(
            parts,
            self.topology(),
            classes,
            &tip.classified.distances,
            &first_split,
            self.step() + 1,
            self.next_ids(),
        )?;
        // Every vertex's image: a new one, on ℓ1, through a face it bounds.
        let geometry = self.geometry();
        let mut images: Vec<Option<Point>> = geometry
            .vertex_images
            .iter()
            .copied()
            .map(Some)
            .chain(std::iter::repeat_n(
                None,
                first.vertices.len() - geometry.vertex_images.len(),
            ))
            .collect();
        for s in &first.faces {
            for v in &s.face.ring {
                if images[v.index()].is_none() {
                    images[v.index()] =
                        Some(geometry.isometries[s.old].apply(first.vertices[v.index()]));
                }
            }
        }
        let images: Vec<Point> = images.into_iter().map(Option::unwrap_or_default).collect();
        // The tip's paper on ℓ1 lies on one side of ℓ2, clear of it: that
        // side is the strip's.
        let images_ref = &images;
        let on_first: Vec<(usize, f64)> = first
            .faces
            .iter()
            .filter(|s| tip.in_tip[s.old] && s.piece != score::Piece::Negative)
            .flat_map(|s| {
                s.face
                    .ring
                    .iter()
                    .filter(|v| score::class_of(classes, **v) == 0)
                    .map(move |v| (s.old, op.second.signed_distance(images_ref[v.index()])))
            })
            .collect();
        // An exact common endpoint may bound a wedge-shaped strip. It is
        // not an interior crossing: every other point of the first hinge
        // must still be clear of ℓ2 on the same side. Near misses retain the
        // minimum-feature refusal, and coincident hinges have no clear side.
        let strip_below = on_first
            .iter()
            .all(|&(_, d)| d.abs() <= TOL || d <= -MIN_FEATURE)
            && on_first.iter().any(|&(_, d)| d <= -MIN_FEATURE);
        let strip_above = on_first
            .iter()
            .all(|&(_, d)| d.abs() <= TOL || d >= MIN_FEATURE)
            && on_first.iter().any(|&(_, d)| d >= MIN_FEATURE);
        if on_first.is_empty() || !(strip_below || strip_above) {
            let mut faces: Vec<FaceId> = on_first
                .iter()
                .filter(|&&(_, d)| d.abs() < MIN_FEATURE || (d > 0.0) != strip_above)
                .map(|&(f, _)| self.faces()[f].id)
                .collect();
            faces.sort_unstable();
            faces.dedup();
            return Err(FoldRefusal::CrimpLinesMeet { faces }.into());
        }
        let toward = if strip_below {
            Side::Positive
        } else {
            Side::Negative
        };
        let second = line::classify(&images, Axis::new(&op.second, toward))?;
        let crimp = Crimp { tip, first, second };
        if !(0..crimp.first.faces.len()).any(|a| crimp.in_tip(a) && crimp.beyond(a)) {
            return Err(FoldRefusal::CrimpMissesTip.into());
        }
        Ok(crimp)
    }

    /// The crimp of a plan through the pipeline's steps 3–7, once ℓ2 has
    /// scored the strip and tip apart: its blocks seeded, and how many
    /// blocks the strip has.
    fn prepare_crimp(
        &self,
        op: &CrimpFold,
        crimp: &Crimp,
        plan: &Plan,
    ) -> Result<(Prepared, usize), FoldRefusal> {
        let nf = self.faces().len();
        let inside = op.kind == ReverseKind::Inside;
        // The strip's blocks: as the reverse fold's at ℓ1.
        let mut block_of = vec![None; nf];
        let mut against = Vec::with_capacity(2 * plan.openings.len());
        for (k, opening) in plan.openings.iter().enumerate() {
            let (lower, upper) = (2 * k, 2 * k + 1);
            for &f in &opening.lower {
                block_of[f] = Some(lower);
            }
            for &f in &opening.upper {
                block_of[f] = Some(upper);
            }
            against.push(Against {
                block: lower,
                faces: opening.lower_body.clone(),
                above: inside,
            });
            against.push(Against {
                block: upper,
                faces: opening.upper_body.clone(),
                above: !inside,
            });
        }
        for (j, whole) in plan.whole.iter().enumerate() {
            for &f in whole {
                block_of[f] = Some(2 * plan.openings.len() + j);
            }
        }
        let strip_blocks = 2 * plan.openings.len() + plan.whole.len();
        let SecondScore {
            scored,
            block_of: scored_block_of,
            bodies,
        } = self.score_second(crimp, &block_of, strip_blocks)?;
        // Each opening flap reaches past ℓ2 with both blocks, or neither,
        // and each block that does has its strip there to hinge to.
        for (k, opening) in plan.openings.iter().enumerate() {
            let reach = |b: usize| scored_block_of.contains(&Some(strip_blocks + b));
            let hinged = |b: usize| !bodies[b].is_empty();
            let (lower, upper) = (2 * k, 2 * k + 1);
            let opens = match (reach(lower), reach(upper)) {
                (false, false) => true,
                (true, true) => hinged(lower) && hinged(upper),
                _ => false,
            };
            if !opens {
                let mut faces: Vec<FaceId> = opening
                    .lower
                    .iter()
                    .chain(&opening.upper)
                    .map(|&f| self.faces()[f].id)
                    .collect();
                faces.sort_unstable();
                return Err(FoldRefusal::CrimpNoOpening { faces });
            }
        }
        let first = crimp.tip.classified.axis.reflection();
        let second = crimp.second.axis.reflection();
        let tip = first.after(&second);
        let mut blocks = vec![first; strip_blocks];
        blocks.extend(vec![tip; strip_blocks]);
        let mut coupled = crimp.tip.packet_pairs(self, plan);
        coupled.extend(
            coupled
                .clone()
                .into_iter()
                .map(|[a, b]| [strip_blocks + a, strip_blocks + b]),
        );
        let mut prepared = prepare_pieces(
            self,
            Pieces {
                scoring: Scoring::of(scored),
                block_of: scored_block_of,
                blocks,
                against,
                across: Across::packets(coupled, true),
            },
        )?;
        // Each tip block against its strip on ℓ2, as the second reverse
        // places it.
        let tip_blocks: Vec<Vec<FaceId>> = (0..strip_blocks)
            .map(|b| {
                let blocks = prepared.blocks_of();
                prepared
                    .unordered()
                    .parts()
                    .faces
                    .iter()
                    .zip(blocks)
                    .filter(|(_, block)| **block == Some(strip_blocks + b))
                    .map(|(f, _)| f.id)
                    .collect()
            })
            .collect();
        let mut pairs = Vec::new();
        for (b, faces) in tip_blocks.iter().enumerate() {
            if b >= 2 * plan.openings.len() {
                continue;
            }
            let above = b.is_multiple_of(2) == inside;
            for &a in faces {
                for &s in &bodies[b] {
                    pairs.push(if above { [a, s] } else { [s, a] });
                }
            }
        }
        prepared.place(pairs);
        Ok((prepared, strip_blocks))
    }

    /// ℓ2's score of the strip and tip, composed with ℓ1's into one scoring
    /// (see the module docs), with each landed face's block — a strip
    /// block's paper beyond ℓ2 in its tip block, `strip_blocks` on — and per
    /// strip block the landed faces of the strip hinged on ℓ2 to its tip.
    fn score_second(
        &self,
        crimp: &Crimp,
        parent_block: &[Option<usize>],
        strip_blocks: usize,
    ) -> Result<SecondScore, FoldRefusal> {
        let first = &crimp.first;
        let (next_face, next_crease) = self.next_ids();
        let step = self.step() + 1;
        let first_block: Vec<Option<usize>> = first
            .faces
            .iter()
            .map(|s| match s.piece {
                score::Piece::Negative => None,
                _ => parent_block[s.old],
            })
            .collect();
        let classes = &crimp.second.classes;
        let crosses = |a: usize, class: i8| {
            first.faces[a]
                .face
                .ring
                .iter()
                .any(|v| score::class_of(classes, *v) == class)
        };
        let split: Vec<bool> = (0..first.faces.len())
            .map(|a| first_block[a].is_some() && crosses(a, 1) && crosses(a, -1))
            .collect();
        let parts = StateParts {
            sheet: self.sheet().clone(),
            vertices: first.vertices.clone(),
            creases: first.creases.clone(),
            faces: first.faces.iter().map(|s| s.face.clone()).collect(),
            root: self.root(),
            root_isometry: Isometry::IDENTITY,
            order: LayerOrder::new(),
            view: self.view(),
            step,
            marks: Vec::new(),
        };
        let topology = Topology::build(&parts)?;
        let after_first = (
            parts
                .faces
                .iter()
                .map(|f| f.id.0 + 1)
                .max()
                .unwrap_or(next_face),
            parts
                .creases
                .iter()
                .map(|c| c.id.0 + 1)
                .max()
                .unwrap_or(next_crease),
        );
        let second = score::score(
            &parts,
            &topology,
            classes,
            &crimp.second.distances,
            &split,
            step,
            after_first,
        )?;
        // ℓ2 cuts no crease ℓ1 made: the lines do not meet over the paper.
        let kept: BTreeSet<EdgeId> = second.creases.iter().map(|c| c.id).collect();
        if first.created.iter().any(|id| !kept.contains(id)) {
            let mut faces: Vec<FaceId> = (0..first.faces.len())
                .filter(|&a| split[a])
                .map(|a| self.faces()[first.faces[a].old].id)
                .collect();
            faces.dedup();
            return Err(FoldRefusal::CrimpLinesMeet { faces });
        }

        // Faces: each knows its parent face; the new ones are numbered
        // afresh from the parent's next id, in order, and name the parent
        // face as theirs (a piece ℓ1 made and ℓ2 split again never was).
        let mut fresh_face = next_face;
        let mut faces = Vec::with_capacity(second.faces.len());
        let mut block_of = Vec::with_capacity(second.faces.len());
        let mut child_of = vec![Vec::new(); self.faces().len()];
        for (a, s) in second.faces.iter().enumerate() {
            let parent = first.faces[s.old].old;
            let mut face = s.face.clone();
            if face.id.0 >= next_face {
                face.id = FaceId(fresh_face);
                fresh_face += 1;
                face.parent = Some(self.faces()[parent].id);
            }
            let beyond = match s.piece {
                score::Piece::Positive => true,
                score::Piece::Negative => false,
                score::Piece::Whole => crosses(s.old, 1),
            };
            block_of.push(first_block[s.old].map(|b| if beyond { strip_blocks + b } else { b }));
            child_of[parent].push(a);
            faces.push(ScoredFace {
                face,
                old: parent,
                piece: s.piece,
            });
        }
        // Creases: the parent's kept, then the halves either score made,
        // then ℓ1's chords and ℓ2's, numbered afresh in that order so the
        // chords come last.
        let chords: Vec<EdgeId> = first
            .created
            .iter()
            .chain(&second.created)
            .copied()
            .collect();
        let position: HashMap<EdgeId, usize> = second
            .creases
            .iter()
            .enumerate()
            .map(|(k, c)| (c.id, k))
            .collect();
        let mut order: Vec<usize> = (0..second.creases.len())
            .filter(|&k| second.creases[k].id.0 < next_crease)
            .collect();
        order.extend(
            (0..second.creases.len())
                .filter(|&k| second.creases[k].id.0 >= next_crease)
                .filter(|&k| !chords.contains(&second.creases[k].id)),
        );
        order.extend(chords.iter().filter_map(|id| position.get(id).copied()));
        let mut fresh_crease = next_crease;
        let mut created = Vec::with_capacity(chords.len());
        let creases = order
            .into_iter()
            .map(|k| {
                let mut crease = second.creases[k].clone();
                if crease.id.0 >= next_crease {
                    if chords.contains(&crease.id) {
                        created.push(EdgeId(fresh_crease));
                    }
                    crease.id = EdgeId(fresh_crease);
                    fresh_crease += 1;
                }
                crease
            })
            .collect();
        // A parent face either score split has more than one landed face:
        // what the shared steps read as split (`pieces::prepare_pieces`).
        let scored = Scored {
            vertices: second.vertices,
            faces,
            child_of,
            creases,
            created,
            split: first.split + second.split,
        };
        let bodies = strip_bodies(&scored, &block_of, strip_blocks);
        Ok(SecondScore {
            scored,
            block_of,
            bodies,
        })
    }

    /// Fixes for a crimp no order fits: the other kind when it lands. The
    /// layers in its way, when the conflict traces to any, are named.
    fn diagnose_crimp(
        &self,
        op: &CrimpFold,
        crimp: &Crimp,
        prepared: &Prepared,
        refusal: FoldRefusal,
        limits: &CompletionLimits,
    ) -> Refused {
        let FoldRefusal::NoOrder { faces } = refusal else {
            return refusal.into();
        };
        let mut fixes = Vec::new();
        if prepared.lands_flipped(limits) {
            fixes.push(Fix::OtherKind {
                kind: op.kind.other(),
            });
        }
        let blocking: BTreeSet<usize> = faces
            .iter()
            .filter_map(|&id| self.face_position(id))
            .filter(|&f| !crimp.tip.in_tip[f] && crimp.tip.side.pieces[f].is_some())
            .collect();
        let refusal = if blocking.is_empty() {
            FoldRefusal::CrimpKindInfeasible {
                kind: op.kind,
                faces,
            }
        } else {
            FoldRefusal::CrimpTipNotFree {
                blocking: blocking.iter().map(|&f| self.faces()[f].id).collect(),
                faces,
            }
        };
        Refused { refusal, fixes }
    }
}

/// Per strip block, the strip's faces hinged on ℓ2 to its tip block: the
/// faces of `scored` outside every tip block that share a side with one in
/// tip block `strip_blocks + b`. Strip and tip meet only on ℓ2.
fn strip_bodies(
    scored: &Scored,
    block_of: &[Option<usize>],
    strip_blocks: usize,
) -> Vec<Vec<FaceId>> {
    let mut sides: HashMap<[VertexId; 2], Vec<usize>> = HashMap::new();
    for (a, s) in scored.faces.iter().enumerate() {
        let ring = &s.face.ring;
        for i in 0..ring.len() {
            let (p, q) = (ring[i], ring[(i + 1) % ring.len()]);
            sides.entry([p.min(q), p.max(q)]).or_default().push(a);
        }
    }
    let mut bodies = vec![BTreeSet::new(); strip_blocks];
    for crease in &scored.creases {
        if crease.kind == CreaseKind::Border {
            continue;
        }
        let [p, q] = crease.vertices;
        let Some(faces) = sides.get(&[p.min(q), p.max(q)]) else {
            continue;
        };
        for &x in faces {
            for &y in faces {
                let (Some(tip), strip) = (block_of[x], block_of[y]) else {
                    continue;
                };
                if tip < strip_blocks || strip.is_some_and(|s| s >= strip_blocks) {
                    continue;
                }
                bodies[tip - strip_blocks].insert(scored.faces[y].face.id);
            }
        }
    }
    bodies
        .into_iter()
        .map(|b| b.into_iter().collect())
        .collect()
}

// ---------------------------------------------------------------------------
// What the tools and the panes ask of a crimp beside landing it (plan D12,
// D14): what its tip moves, the plain fold the depth picker previews the
// stacks of, and its picture.
//
// - **What moves** is the tip at ℓ1, the reverse fold's of the kind
//   ([`State::analyse_reverse`]), read as a plain fold's analysis: ℓ1 and the
//   tip's side, the moving side's flaps (the plain fold's along ℓ1, which the
//   chips number and a refusal's `include_flaps` indexes), the tip's flaps
//   among them picked, the tip's faces moving. Refused as the crimp is
//   before it lands: lines that meet over the tip, ℓ2 missing it.
// - **The picture** is the tip's at ℓ1, as a reverse fold of the kind draws
//   it ([`State::fold_action`] of the whole tip, in the direction the near
//   layer turns there): ℓ1 across the silhouette with the spans where the tip
//   meets it. No grip: a plain fold's arrow takes its grip across ℓ1, where
//   a crimp puts no paper, since the tip lands by ρ1∘ρ2. A crimp is drawn as
//   a pleat is instead ([`Pleat`]): an arrow across both lines, from beyond
//   ℓ2 to short of ℓ1, through the middles of the lines' stretches over the
//   tip, with one kink for the two creases each layer takes. ℓ2 is the
//   analysis' and the report's (`second`), drawn beside ℓ1 by whatever draws
//   the picture.

/// How far past each line the pleat arrow reaches, as a share of the way
/// between the lines' middles over the tip.
const PLEAT_OVERHANG: f64 = 0.5;

impl CrimpFold {
    /// The plain fold along ℓ1 its side and anchor name, as the reverse fold
    /// at ℓ1 names it: what the depth picker previews the stacks of, and
    /// whose flaps the layer picker shows.
    pub fn plain(&self) -> PlainFold {
        PlainFold::new(self.first, self.side, Direction::Valley).with_seed(self.anchor.clone())
    }
}

impl State {
    /// What the crimp `op` moves before it lands, as a plain fold's analysis
    /// reads (see above).
    pub fn analyse_crimp_fold(&self, op: &CrimpFold) -> Result<FoldAnalysis, Refused> {
        let tip = self.analyse_crimp(op)?.tip;
        let direction = self.view().model_direction(op.kind.seen_direction());
        let (flaps, picked) = match self.analyse_fold(&op.plain()) {
            Ok(plain) => (plain.flaps, tip.flaps.iter().map(|f| f.index).collect()),
            Err(_) => (
                tip.flaps.iter().map(|f| f.flap.clone()).collect(),
                (0..tip.flaps.len()).collect(),
            ),
        };
        Ok(FoldAnalysis {
            line: tip.line,
            side: tip.side,
            snap: tip.snap,
            direction,
            flaps,
            picked,
            added: Vec::new(),
            moving: tip.tip,
        })
    }

    /// The picture of the crimp `op` on this state, before it lands (see
    /// above). Refused as [`State::analyse_crimp`] is.
    pub fn crimp_action(&self, op: &CrimpFold) -> Result<FoldActionGeometry, Refused> {
        let analysis = self.analyse_crimp(op)?;
        let tip = &analysis.tip;
        crimp_picture(
            self,
            &Picture {
                first: tip.line,
                side: tip.side,
                snap: tip.snap,
                kind: op.kind,
                tip: &tip.tip,
                second: analysis.second,
            },
        )
    }
}

impl CrimpReport {
    /// The landed crimp's picture on `parent`, the state it folded (see
    /// above). It has no grip, so nothing of the landed state is drawn.
    pub fn action(&self, parent: &State) -> Result<FoldActionGeometry, Refused> {
        crimp_picture(
            parent,
            &Picture {
                first: self.first,
                side: self.side,
                snap: self.snap,
                kind: self.kind,
                tip: &self.fold.moving,
                second: self.second,
            },
        )
    }
}

impl CrimpFolded {
    /// Its picture on `parent`, the state it folded.
    pub fn action(&self, parent: &State) -> Result<FoldActionGeometry, Refused> {
        self.report.action(parent)
    }
}

/// What a crimp's picture is drawn from, before it lands or after.
struct Picture<'a> {
    first: Line,
    side: Side,
    snap: Snap,
    kind: ReverseKind,
    /// The parent's faces that move: the tip at ℓ1, the strip with it.
    tip: &'a [FaceId],
    second: Line,
}

fn crimp_picture(state: &State, picture: &Picture<'_>) -> Result<FoldActionGeometry, Refused> {
    let analysis = FoldAnalysis {
        line: picture.first,
        side: picture.side,
        snap: picture.snap,
        direction: state.view().model_direction(picture.kind.seen_direction()),
        flaps: Vec::new(),
        picked: Vec::new(),
        added: Vec::new(),
        moving: picture.tip.to_vec(),
    };
    let mut action = state.fold_action(&analysis, ActionKind::Fold, None)?;
    action.grip = None;
    action.pleat = pleat(state, &picture.first, &picture.second, picture.tip);
    Ok(action)
}

/// The pleat arrow across a crimp's lines, in the scene frame (see above);
/// none when either line misses the tip, or the two cross it within the
/// minimum feature of each other.
fn pleat(state: &State, first: &Line, second: &Line, tip: &[FaceId]) -> Option<Pleat> {
    let middle = |line: &Line| -> Option<Point> {
        let [lo, hi] = tip
            .iter()
            .filter_map(|&id| state.face_image(id))
            .filter_map(|image| chord(line, image))
            .reduce(|[a, b], [lo, hi]| [a.min(lo), b.max(hi)])?;
        Some(line.point_at((lo + hi) / 2.0))
    };
    let (near, far) = (middle(first)?, middle(second)?);
    let across = [far[0] - near[0], far[1] - near[1]];
    if across[0].hypot(across[1]) < MIN_FEATURE {
        return None;
    }
    let from = [
        far[0] + PLEAT_OVERHANG * across[0],
        far[1] + PLEAT_OVERHANG * across[1],
    ];
    let to = [
        near[0] - PLEAT_OVERHANG * across[0],
        near[1] - PLEAT_OVERHANG * across[1],
    ];
    let to_scene = state.view().transform();
    Some(Pleat {
        from: ScenePoint::from(to_scene.apply(from)),
        to: ScenePoint::from(to_scene.apply(to)),
        kinks: 1,
    })
}

/// The stretch of `line` over a convex polygon, as parameters along it
/// ([`Line::parameter`]); none when it misses, or only touches.
fn chord(line: &Line, polygon: &[Point]) -> Option<[f64; 2]> {
    let mut span: Option<[f64; 2]> = None;
    let mut take = |p: Point| {
        let t = line.parameter(p);
        span = Some(span.map_or([t, t], |[a, b]| [a.min(t), b.max(t)]));
    };
    let n = polygon.len();
    for i in 0..n {
        let (p, q) = (polygon[i], polygon[(i + 1) % n]);
        let (dp, dq) = (line.signed_distance(p), line.signed_distance(q));
        if dp.abs() <= TOL {
            take(p);
        } else if (dp > TOL && dq < -TOL) || (dp < -TOL && dq > TOL) {
            let s = dp / (dp - dq);
            take([p[0] + s * (q[0] - p[0]), p[1] + s * (q[1] - p[1])]);
        }
    }
    span.filter(|[a, b]| b - a > TOL)
}
