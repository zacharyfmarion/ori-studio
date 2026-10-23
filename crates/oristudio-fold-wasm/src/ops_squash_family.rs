//! The vertex folds — squash, petal fold, rabbit ear, swivel (plan Phase 11)
//! — on the bridge.
//!
//! **Ops** are the Fold document's own shapes (`FoldSquashOp`,
//! `FoldPetalOp`, `FoldRabbitEarOp`, `FoldSwivelOp` in
//! `apps/web/src/fold/document/foldSequenceDocument.ts`). What names paper is
//! a sheet point, resolved here in the parent (plan D6): the flap and the
//! petal on their layers, a point on H's precrease or H's two ends, the
//! triangle's corners, the swivel's vertex and the points its rays run
//! toward, the stayer. A petal fold's H named by its ends need not be
//! creased: the engine creases it (`PetalHinge::Points`). What
//! the step chose is a result: the spine's target and the emergent ray are
//! directions in the parent's model frame, and replay takes the nearest (an
//! axiom's root is replayed the same way). A step's `choices.completion` is
//! the engine's `VertexChoices` as it is. A rabbit ear's fourth crease rises
//! as its ridge, so it has none to choose: an older step's `ridge` is an
//! unknown field, ignored.
//!
//! A swivel takes one of three forms ([`SwivelOp`]): by its rays, by its
//! valley and mountain, or by its edge (`via: 'edge'`: the pivot, a sheet point on the edge, the target line as
//! a crease's point or two points, the layers, the direction, and the ridge
//! when it is not the foot's — a direction, the nearer far ray taken, the
//! choice stored as its result). `compound_analysis` answers the edge form
//! with `kind: 'swivel-by-edge'` (the engine's `SwivelEdgeAnalysis`: vertex,
//! creases with their letters as seen, landing, ridges, moving regions) and
//! per ridge in `emergents`; a refusal's `use_emergent` fix names the other
//! ridge, to store as `ridge`. The edge form on a folded edge names `fold`,
//! a sheet point on that folded crease, in place of `pivot` and `seed` and
//! with no ridge (engine `compound::swivel_on_edge`): its answer adds the
//! folded edge (`fold`), lists no ridges, and says which directions land
//! (`directions`, valley then mountain). An older build reads `fold` as a
//! key it does not know and locks the step. It is the open swivel, or with
//! `swivel: 'inside'` the inside one, its strip tucked between the two
//! layers; the answer says which ways land of both kinds (`kinds`, open
//! then inside, each valley then mountain) — its choices besides the
//! order. A build before the inside swivel reads `swivel` as a key it does
//! not know and locks the step rather than fold it open.
//!
//! The valley-and-mountain form (`via: 'valley-mountain'`, engine
//! `compound::swivel_valley_mountain`) names the two creases the swivel makes
//! on the layer that faces the viewer, each a located line as a fold along
//! a line stores it (an existing crease by a sheet point, a line through two
//! sheet points, or an axiom's inputs with the root taken), and the kind; no
//! direction, since its letters are the viewer's. Its answer is `kind:
//! 'swivel-valley-mountain'` (vertex, creases with their letters as seen —
//! the one on the layer behind split where it is `hidden` — layers, moving
//! regions, the folded edge), and `kinds` says which kinds land, each in the
//! valley column: folded away from the viewer its letters would swap, which
//! is the same two lines named the other way round, so the mountain column
//! is always false.
//!
//! **Replay** (`FoldEngine::apply`, through the compound seam,
//! [`crate::compound`]): a stored step lands, or is refused — the engine's
//! refusal, a stored choice that no longer resolves (`choice_broken`), or a
//! completion that leaves a choice the step does not store
//! (`choice_needed`) — and the replay marks it broken. A landed one reports
//! as the step's `compound`, `{ family: 'vertex', kind, … }`; its summary is
//! the diff from its parent.
//!
//! **The picture** (`FoldEngine::action` before it lands, `step_action` once
//! it has) is the engine's along the one crease that tells the fold best
//! (`compound::vertex`): a squash's lower crease with its arrow and the push
//! onto its spine, a petal fold's H, a fan's crease from its center. A
//! vertex fold folds along no one line, so it answers none of a plain fold's
//! other queries (what moves, its depth choices).
//!
//! **The tools** ask the compound question, as the reverse fold's do: what
//! the op names (its flap, line or fan), which of a fan's fourth rays land,
//! and the orders it leaves, each the `completion` that picks it. A tool
//! then previews and commits the step with its choices through `step`, like
//! any other. The calls below are the family's
//! own besides ([`Pending`]): a fold that leaves a choice is held under its
//! own handle, like an opened import, and each pick lands one order as a
//! held state with the choices the step stores.
//!
//! ```ts
//! // `apps/web/src/fold/engine/foldEngineSquashWire.ts` holds these shapes.
//! class FoldEngine {
//!   /** For a vertex op, `{ family: 'vertex', analysis, emergents, orders }`:
//!    *  the flap, line or fan it names, before it folds, and the choices it
//!    *  leaves. */
//!   compound_analysis(state: number, op: FoldVertexOp, choices?: FoldChoices):
//!     Outcome<FoldCompoundAnalysis>;
//!   /** Fold it: landed (a held state, as `apply` returns it) or a choice
//!    *  of orders held under `pending`. `choices` may be undefined. */
//!   vertex_fold(state: number, op: FoldVertexOp, choices?: FoldChoices): Outcome<VertexTried>;
//!   /** Land one listed order per component; its `compound.stored` is what
//!    *  the step stores. */
//!   vertex_pick(pending: number, choice: Uint32Array): Outcome<Applied>;
//!   /** Let pending choices go; how many were held. */
//!   release_vertex_choices(pending: Uint32Array): number;
//! }
//! ```

use std::collections::HashMap;

use oristudio_fold::numerics::MIN_FEATURE;
use oristudio_fold::{
    ChoiceCount, CompoundRefused, Direction, FanAnalysis, FoldActionGeometry, LineRefusal,
    PetalAnalysis, PetalFold, PetalHinge, RabbitEar, Refused, Squash, SquashAnalysis, State,
    StepSummary, Swivel, SwivelByEdge, SwivelEdgeAnalysis, SwivelKind, SwivelValleyMountain,
    SwivelValleyMountainAnalysis, VertexChoice, VertexChoices, VertexFolded, VertexOutcome,
    WitnessOrder,
};
use oristudio_geometry::Line;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::bridge::{Bridge, settle};
use crate::compound::{
    CompoundAsked, CompoundLanded, CompoundOp, CompoundStepReport, Parent, compound_refusal, landed,
};
use crate::ops_reverse::MAX_ORDERS;
use crate::resolve::{Rejection, check_choices, finite_point};
use crate::wire::{
    Applied, BridgeError, BridgeRefusal, Choices, LineInput, Op, Outcome, Point, Refusal, SeedInput,
};
use crate::{FoldEngine, bridge_error, parse, parse_choices, to_js_value};

// ---------------------------------------------------------------------------
// The document's ops

/// `FoldSquashOp`: the flap by a sheet point on its upper layer as the
/// viewer sees it; where its spine lands, a model-frame direction from the
/// vertex (absent: the hinge line); valley or mountain as seen; and a drawn
/// hinge, located as a fold's line is (absent: the hinge the lower layer
/// folds over), only the flap's end on the flap point's side squashing.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SquashOp {
    pub flap: Point,
    #[serde(default)]
    pub target: Option<Point>,
    pub direction: Direction,
    #[serde(default)]
    pub hinge: Option<LocatedLine>,
}

/// `FoldPetalOp`: H by a sheet point inside its precrease's sheet segment
/// (`crease`, H and the kite creases precreased), or by two sheet points,
/// its ends, that need not be on any crease (`ends`, the fold creasing what
/// is missing) — one of the two; the petal by a sheet point on the flap's top
/// layer below H; the direction.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct PetalOp {
    #[serde(default)]
    pub crease: Option<Point>,
    #[serde(default)]
    pub ends: Option<[Point; 2]>,
    pub petal: Point,
    pub direction: Direction,
}

/// `FoldRabbitEarOp`: the triangle's corners as sheet points, the emergent
/// ray as a model-frame direction from the incenter, the layers at the
/// incenter (`seed`), a sheet point that stays, the direction. An older
/// step's `ridge` is not read.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct RabbitEarOp {
    pub corners: [Point; 3],
    pub emergent: Point,
    pub seed: SeedInput,
    pub stayer: Point,
    pub direction: Direction,
}

/// A swivel op in one of the document's forms: by its rays (`FoldSwivelOp`,
/// no `via`), by its edge (`FoldSwivelEdgeOp`, `via: 'edge'`) or by its
/// valley and mountain (`FoldSwivelValleyMountainOp`,
/// `via: 'valley-mountain'`). Any other `via` is the caller's mistake.
#[derive(Debug, Clone, PartialEq)]
pub enum SwivelOp {
    Rays(SwivelRaysOp),
    Edge(SwivelEdgeOp),
    ValleyMountain(SwivelValleyMountainOp),
}

impl<'de> Deserialize<'de> for SwivelOp {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<SwivelOp, D::Error> {
        use serde::de::Error;
        let value = serde_json::Value::deserialize(deserializer)?;
        match value.get("via") {
            None => serde_json::from_value(value)
                .map(SwivelOp::Rays)
                .map_err(D::Error::custom),
            Some(via) if via == "edge" => serde_json::from_value(value)
                .map(SwivelOp::Edge)
                .map_err(D::Error::custom),
            Some(via) if via == "valley-mountain" => serde_json::from_value(value)
                .map(SwivelOp::ValleyMountain)
                .map_err(D::Error::custom),
            Some(via) => Err(D::Error::custom(format!(
                "a swivel's `via` is 'edge', 'valley-mountain' or absent, got {via}"
            ))),
        }
    }
}

/// `FoldSwivelOp`: the vertex and the points its three given rays run
/// toward as sheet points, the emergent ray as a model-frame direction, the
/// layers at the vertex, a sheet point that stays, the direction.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SwivelRaysOp {
    pub vertex: Point,
    pub toward: [Point; 3],
    pub emergent: Point,
    pub seed: SeedInput,
    pub stayer: Point,
    pub direction: Direction,
}

/// `FoldSwivelEdgeOp`: swivel the edge through the sheet point `edge` (a raw
/// edge or a folded crease) onto `target`, its creases meeting at one of:
///
/// - **a free vertex** (`FoldSwivelFreeOp`): the sheet point `pivot`, its
///   image moved onto the nearer bisector of edge and target; with the
///   layers at the vertex (`seed`), and the ridge, a model-frame direction,
///   when it is not the crease square to the edge;
/// - **a folded edge** (`FoldSwivelOnFoldOp`): the folded crease through the
///   sheet point `fold`, where the bisector nearer it crosses that crease —
///   the classic swivel, through the two layers the folded edge joins, so
///   it has no `seed` and no ridge to choose (engine
///   `compound::swivel_on_edge`).
///
/// One of `pivot` and `fold`, never both; the direction. The target is a
/// crease or edge by a sheet point on it (`via: 'crease'`) or the line
/// through two sheet points' images (`via: 'free'`): an axiom's would need a
/// root the step does not store, and a model line is not one it can store.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SwivelEdgeOp {
    #[serde(default)]
    pub pivot: Option<Point>,
    #[serde(default)]
    pub fold: Option<Point>,
    pub edge: Point,
    pub target: LineInput,
    #[serde(default)]
    pub seed: Option<SeedInput>,
    #[serde(default)]
    pub ridge: Option<Point>,
    pub direction: Direction,
    /// On a folded edge, `'inside'` for the inside swivel, the strip tucked
    /// between the two layers; absent (or `'open'`) for the open one. At a
    /// free vertex the engine refuses an inside one (`swivel_inside_free`).
    #[serde(default)]
    pub swivel: Option<SwivelKind>,
}

/// A line as a step stores it to locate it again: an existing crease or edge
/// by a sheet point, the line through two sheet points, or an axiom's inputs
/// with the root taken (`FoldLocatedLine`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocatedLine {
    pub line: LineInput,
    #[serde(default)]
    pub root: Option<Line>,
}

/// `FoldSwivelValleyMountainOp`: the valley and the mountain the swivel makes
/// on the layer that faces the viewer, and the kind, open unless `'inside'`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SwivelValleyMountainOp {
    pub via: String,
    pub valley: LocatedLine,
    pub mountain: LocatedLine,
    #[serde(default)]
    pub swivel: Option<SwivelKind>,
}

/// A located line in the parent's model frame: an axiom's root as stored,
/// replayed onto the nearest candidate; a crease's or two points' line.
fn located_line(parent: &State, located: &LocatedLine) -> Result<Line, Rejection> {
    match &located.line {
        LineInput::Axiom { axiom, inputs } => {
            let root = crate::resolve::model_line(
                located.root.as_ref().ok_or(BridgeRefusal::RootMissing)?,
            )?
            .0;
            let axiom = crate::resolve::axiom_of(*axiom, inputs)?;
            Ok(parent.axiom_root(&axiom, &root)?.candidate.line)
        }
        _ if located.root.is_some() => {
            Err(BridgeRefusal::UnexpectedChoice { choice: "root" }.into())
        }
        LineInput::Model { .. } => Err(BridgeError::InvalidInput(
            "a saved located line needs sheet references".into(),
        )
        .into()),
        _ => swivel_target(parent, &located.line),
    }
}

/// A vertex op resolved in its parent: the engine's op, and the choice the
/// step stores.
#[derive(Debug, Clone)]
pub struct VertexFold {
    pub op: EngineOp,
    pub choices: VertexChoices,
}

/// The engine's vertex op.
#[derive(Debug, Clone)]
pub enum EngineOp {
    Squash(Squash),
    Petal(PetalFold),
    RabbitEar(RabbitEar),
    Swivel(Swivel),
    SwivelByEdge(SwivelByEdge),
    SwivelValleyMountain(SwivelValleyMountain),
}

/// Resolve a vertex op's anchors in `parent`; any other op is the caller's
/// mistake. Its choices are checked before (`resolve::check_choices`).
pub fn resolve(parent: &State, op: &Op, choices: &Choices) -> Result<VertexFold, Rejection> {
    let image = |name: &str, p: Point| -> Result<Point, Rejection> {
        finite_point(name, p)?;
        parent.resolve_point(p).ok_or(Rejection::Refused(
            LineRefusal::PointOffPaper { point: p }.into(),
        ))
    };
    let direction = |name: &str, d: Point| -> Result<Point, BridgeError> {
        finite_point(name, d)?;
        if d[0].hypot(d[1]) > 0.0 {
            Ok(d)
        } else {
            Err(BridgeError::InvalidInput(format!(
                "{name} has no direction"
            )))
        }
    };
    let op = match op {
        Op::Squash(op) => {
            finite_point("flap", op.flap)?;
            EngineOp::Squash(Squash {
                flap: op.flap,
                target: op.target.map(|t| direction("target", t)).transpose()?,
                direction: op.direction,
                hinge: op
                    .hinge
                    .as_ref()
                    .map(|hinge| located_line(parent, hinge))
                    .transpose()?,
            })
        }
        Op::Petal(op) => {
            finite_point("petal", op.petal)?;
            let hinge = match (op.crease, op.ends) {
                (Some(crease), None) => {
                    finite_point("crease", crease)?;
                    let line = parent
                        .crease_at(crease)
                        .and_then(|c| parent.crease_line(c.id))
                        .ok_or(BridgeRefusal::CreaseNotFound { point: crease })?;
                    PetalHinge::Crease { line }
                }
                (None, Some([a, b])) => {
                    // As a free line's two points resolve (the crimp's
                    // second line's rule).
                    let (from, to) = (image("ends", a)?, image("ends", b)?);
                    let distance = (to[0] - from[0]).hypot(to[1] - from[1]);
                    if distance < MIN_FEATURE {
                        return Err(LineRefusal::FreeLineTooShort { a, b, distance }.into());
                    }
                    PetalHinge::Points { from, to }
                }
                _ => {
                    return Err(BridgeError::InvalidInput(
                        "a petal fold names H by `crease` or by `ends`, one of the two".to_string(),
                    )
                    .into());
                }
            };
            EngineOp::Petal(PetalFold {
                hinge,
                petal: op.petal,
                direction: op.direction,
            })
        }
        Op::RabbitEar(op) => {
            finite_point("stayer", op.stayer)?;
            let [a, b, c] = op.corners;
            EngineOp::RabbitEar(RabbitEar {
                corners: [
                    image("corners", a)?,
                    image("corners", b)?,
                    image("corners", c)?,
                ],
                emergent: direction("emergent", op.emergent)?,
                layers: seed(&op.seed)?,
                stayer: op.stayer,
                direction: op.direction,
            })
        }
        Op::Swivel(SwivelOp::Rays(op)) => {
            finite_point("stayer", op.stayer)?;
            let [a, b, c] = op.toward;
            EngineOp::Swivel(Swivel {
                vertex: image("vertex", op.vertex)?,
                toward: [
                    image("toward", a)?,
                    image("toward", b)?,
                    image("toward", c)?,
                ],
                emergent: direction("emergent", op.emergent)?,
                layers: seed(&op.seed)?,
                stayer: op.stayer,
                direction: op.direction,
            })
        }
        Op::Swivel(SwivelOp::ValleyMountain(op)) => {
            EngineOp::SwivelValleyMountain(SwivelValleyMountain {
                valley: located_line(parent, &op.valley)?,
                mountain: located_line(parent, &op.mountain)?,
                kind: op.swivel.unwrap_or_default(),
            })
        }
        Op::Swivel(SwivelOp::Edge(op)) => {
            finite_point("edge", op.edge)?;
            let mistake = |message: &str| -> Rejection {
                BridgeError::InvalidInput(message.to_string()).into()
            };
            let kind = op.swivel.unwrap_or_default();
            let by_edge = match (op.pivot, op.fold, &op.seed) {
                (Some(pivot), None, Some(layers)) => SwivelByEdge {
                    pivot: image("pivot", pivot)?,
                    edge: op.edge,
                    target: swivel_target(parent, &op.target)?,
                    layers: seed(layers)?,
                    ridge: op.ridge.map(|r| direction("ridge", r)).transpose()?,
                    direction: op.direction,
                    fold: None,
                    kind,
                },
                (None, Some(fold), None) if op.ridge.is_none() => SwivelByEdge {
                    // The bisector nearer the point clicked on the folded
                    // edge is the one its creases meet on.
                    pivot: image("fold", fold)?,
                    edge: op.edge,
                    target: swivel_target(parent, &op.target)?,
                    layers: oristudio_fold::Seed::All,
                    ridge: None,
                    direction: op.direction,
                    fold: Some(fold),
                    kind,
                },
                (Some(_), None, None) => {
                    return Err(mistake(
                        "a swivel at a free vertex names its layers (`seed`)",
                    ));
                }
                (None, Some(_), _) => {
                    return Err(mistake(
                        "a swivel on a folded edge takes no `seed` and no `ridge`: its layers \
                         are the two the edge joins",
                    ));
                }
                _ => {
                    return Err(mistake(
                        "a swivel by its edge names where its creases meet by `pivot` or by \
                         `fold`, one of the two",
                    ));
                }
            };
            EngineOp::SwivelByEdge(by_edge)
        }
        other => {
            return Err(BridgeError::InvalidInput(format!(
                "a {} step is no vertex fold",
                other.kind()
            ))
            .into());
        }
    };
    Ok(VertexFold {
        op,
        choices: VertexChoices {
            completion: choices.completion().cloned(),
        },
    })
}

/// A swivel's target in the parent's model frame: the line of the crease
/// or edge whose sheet segment holds a point, or the line through two sheet
/// points' images.
fn swivel_target(parent: &State, target: &LineInput) -> Result<Line, Rejection> {
    match target {
        LineInput::Crease { at } => {
            finite_point("target.at", *at)?;
            parent
                .crease_at(*at)
                .and_then(|c| parent.crease_line(c.id))
                .ok_or_else(|| BridgeRefusal::CreaseNotFound { point: *at }.into())
        }
        LineInput::Free { through: [a, b] } => {
            let image = |p: Point| -> Result<Point, Rejection> {
                finite_point("target.through", p)?;
                parent
                    .resolve_point(p)
                    .ok_or_else(|| LineRefusal::PointOffPaper { point: p }.into())
            };
            let (pa, pb) = (image(*a)?, image(*b)?);
            let distance = (pb[0] - pa[0]).hypot(pb[1] - pa[1]);
            if distance < MIN_FEATURE {
                return Err(LineRefusal::FreeLineTooShort {
                    a: *a,
                    b: *b,
                    distance,
                }
                .into());
            }
            Line::from_points(pa, pb).ok_or_else(|| {
                LineRefusal::FreeLineTooShort {
                    a: *a,
                    b: *b,
                    distance,
                }
                .into()
            })
        }
        LineInput::Axiom { .. } | LineInput::Model { .. } => Err(BridgeError::InvalidInput(
            "a swivel's target is a crease or edge (`via: 'crease'`) or a line through two \
             points (`via: 'free'`)"
                .to_string(),
        )
        .into()),
    }
}

fn seed(seed: &SeedInput) -> Result<oristudio_fold::Seed, BridgeError> {
    match seed {
        SeedInput::All => {}
        SeedInput::Depth { at, .. } => finite_point("seed.at", *at)?,
        SeedInput::Flaps { at } => {
            for p in at {
                finite_point("seed.at", *p)?;
            }
        }
    }
    Ok(seed.seed())
}

/// The picture of `op` on `parent`, with `landed`'s cover at the arrow's
/// head once it has landed (the engine's `compound::vertex`).
fn picture(
    parent: &State,
    op: &EngineOp,
    landed: Option<&State>,
) -> Result<FoldActionGeometry, Refused> {
    match op {
        EngineOp::Squash(op) => parent.squash_action(op, landed),
        EngineOp::Petal(op) => parent.petal_action(op, landed),
        EngineOp::RabbitEar(op) => parent.rabbit_ear_action(op, landed),
        EngineOp::Swivel(op) => parent.swivel_action(op, landed),
        EngineOp::SwivelByEdge(op) => parent.swivel_by_edge_action(op, landed),
        EngineOp::SwivelValleyMountain(op) => parent.swivel_valley_mountain_action(op, landed),
    }
}

/// The fold, as the engine lands it.
fn fold(parent: &State, fold: &VertexFold) -> Result<VertexOutcome, CompoundRefused> {
    let choices = &fold.choices;
    match &fold.op {
        EngineOp::Squash(op) => parent.squash(op, choices),
        EngineOp::Petal(op) => parent.petal_fold(op, choices),
        EngineOp::RabbitEar(op) => parent.rabbit_ear(op, choices),
        EngineOp::Swivel(op) => parent.swivel(op, choices),
        EngineOp::SwivelByEdge(op) => parent.swivel_by_edge(op, choices),
        EngineOp::SwivelValleyMountain(op) => parent.swivel_valley_mountain(op, choices),
    }
}

fn fold_within(
    parent: &State,
    fold: &VertexFold,
    limits: &oristudio_fold::CompletionLimits,
) -> Result<VertexOutcome, CompoundRefused> {
    let choices = &fold.choices;
    match &fold.op {
        EngineOp::Squash(op) => parent.squash_within(op, choices, limits),
        EngineOp::Petal(op) => parent.petal_fold_within(op, choices, limits),
        EngineOp::RabbitEar(op) => parent.rabbit_ear_within(op, choices, limits),
        EngineOp::Swivel(op) => parent.swivel_within(op, choices, limits),
        EngineOp::SwivelByEdge(op) => parent.swivel_by_edge_within(op, choices, limits),
        EngineOp::SwivelValleyMountain(op) => {
            parent.swivel_valley_mountain_within(op, choices, limits)
        }
    }
}

/// The flap, petal or fan an op names, before it folds.
fn analyse(parent: &State, op: &EngineOp) -> Result<VertexAnalysis, Refused> {
    match op {
        EngineOp::Squash(op) => parent.analyse_squash(op).map(VertexAnalysis::Squash),
        EngineOp::Petal(op) => parent.analyse_petal(op).map(VertexAnalysis::Petal),
        EngineOp::RabbitEar(op) => parent.analyse_rabbit_ear(op).map(VertexAnalysis::RabbitEar),
        EngineOp::Swivel(op) => parent.analyse_swivel(op).map(VertexAnalysis::Swivel),
        EngineOp::SwivelValleyMountain(op) => parent
            .analyse_swivel_valley_mountain(op)
            .map(|a| VertexAnalysis::SwivelValleyMountain(Box::new(a))),
        EngineOp::SwivelByEdge(op) => parent
            .analyse_swivel_by_edge(op)
            .map(|a| VertexAnalysis::SwivelByEdge(Box::new(a))),
    }
}

/// The orders a fold leaves to choose from, when it leaves several: the
/// first [`MAX_ORDERS`], each as the completion that picks it. None when it
/// lands with one, or is refused (the preview says why).
fn listed(outcome: Result<VertexOutcome, CompoundRefused>) -> Option<VertexOrders> {
    let Ok(VertexOutcome::ChooseOrder(choice)) = outcome else {
        return None;
    };
    let (picks, more) = choice.choices(MAX_ORDERS);
    Some(VertexOrders {
        count: choice.count(),
        orders: picks
            .iter()
            .filter_map(|pick| choice.pick(pick).ok()?.report.stored.completion)
            .collect(),
        more,
    })
}

/// Per emergent candidate of a rabbit ear or a swivel, whether the fold
/// lands with it, its other inputs as asked (as a reverse fold's question
/// says which kinds land): what a tool takes first, and marks the others by.
/// Empty for the other folds.
fn emergents(parent: &State, op: &EngineOp, analysis: &VertexAnalysis) -> Vec<bool> {
    let none = VertexChoices::default();
    match (op, analysis) {
        (EngineOp::RabbitEar(ear), VertexAnalysis::RabbitEar(fan)) => fan
            .candidates
            .iter()
            .map(|&emergent| {
                let each = RabbitEar {
                    emergent,
                    ..ear.clone()
                };
                parent.rabbit_ear(&each, &none).is_ok()
            })
            .collect(),
        (EngineOp::Swivel(swivel), VertexAnalysis::Swivel(fan)) => fan
            .candidates
            .iter()
            .map(|&emergent| {
                let each = Swivel {
                    emergent,
                    ..swivel.clone()
                };
                parent.swivel(&each, &none).is_ok()
            })
            .collect(),
        // A swivel by its edge's: per ridge it can take.
        (EngineOp::SwivelByEdge(swivel), VertexAnalysis::SwivelByEdge(analysis)) => analysis
            .ridges
            .iter()
            .map(|&ridge| {
                let each = SwivelByEdge {
                    ridge: Some(ridge),
                    ..swivel.clone()
                };
                parent.swivel_by_edge(&each, &none).is_ok()
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// The kinds a swivel on a folded edge takes, in the order its answer lists
/// them.
const SWIVEL_KINDS: [SwivelKind; 2] = [SwivelKind::Open, SwivelKind::Inside];

/// The directions, likewise: valley, then mountain, as the viewer sees them.
const DIRECTIONS: [Direction; 2] = [Direction::Valley, Direction::Mountain];

/// A swivel on a folded edge's ways: its only choices besides the order, so
/// a tool offers only the ways that land.
struct SwivelWays {
    /// Per kind, open then inside, per direction, valley then mountain as
    /// the viewer sees them: whether the fold lands that way.
    kinds: Vec<[bool; 2]>,
    /// The kind asked's row.
    directions: Vec<bool>,
    /// The way asked, as it folds: whose orders the answer lists.
    asked: Result<VertexOutcome, CompoundRefused>,
}

/// A swivel on a folded edge's ways, each folded once; none for every other
/// fold. A swivel by its valley and mountain folds its letters' way only:
/// per kind, its valley column (module docs).
fn swivel_ways(parent: &State, op: &EngineOp) -> Option<SwivelWays> {
    if let EngineOp::SwivelValleyMountain(swivel) = op {
        let mut asked = None;
        let mut kinds = Vec::with_capacity(SWIVEL_KINDS.len());
        for kind in SWIVEL_KINDS {
            let outcome = parent.swivel_valley_mountain(
                &SwivelValleyMountain {
                    kind,
                    ..swivel.clone()
                },
                &VertexChoices::default(),
            );
            kinds.push([outcome.is_ok(), false]);
            if kind == swivel.kind {
                asked = Some(outcome);
            }
        }
        let directions = kinds[SWIVEL_KINDS.iter().position(|&k| k == swivel.kind)?].to_vec();
        return Some(SwivelWays {
            kinds,
            directions,
            asked: asked?,
        });
    }
    let (chosen_kind, chosen_direction) = match op {
        EngineOp::SwivelByEdge(swivel) if swivel.fold.is_some() => (swivel.kind, swivel.direction),
        _ => return None,
    };
    let mut asked = None;
    let mut kinds = Vec::with_capacity(SWIVEL_KINDS.len());
    let mut directions = Vec::new();
    for kind in SWIVEL_KINDS {
        let mut ways = [false; 2];
        for (way, direction) in ways.iter_mut().zip(DIRECTIONS) {
            let outcome = match op {
                EngineOp::SwivelByEdge(swivel) => parent.swivel_by_edge(
                    &SwivelByEdge {
                        kind,
                        direction,
                        ..swivel.clone()
                    },
                    &VertexChoices::default(),
                ),
                _ => return None,
            };
            *way = outcome.is_ok();
            if kind == chosen_kind && direction == chosen_direction {
                asked = Some(outcome);
            }
        }
        if kind == chosen_kind {
            directions = ways.to_vec();
        }
        kinds.push(ways);
    }
    Some(SwivelWays {
        kinds,
        directions,
        asked: asked?,
    })
}

impl CompoundOp for VertexFold {
    fn order_selection(
        &self,
        parent: &State,
        query: &crate::order_selection::OrderQuery,
    ) -> Result<crate::order_selection::OrderSelection, Refusal> {
        use crate::order_selection::OrderSelection;
        match fold_within(parent, self, &query.limits()) {
            Ok(VertexOutcome::Landed(folded)) => {
                Ok(OrderSelection::unique(folded.report.stored.completion))
            }
            Ok(VertexOutcome::ChooseOrder(choice)) => {
                OrderSelection::pick(choice.completions(), query, |pick| {
                    choice
                        .pick(pick)
                        .map(|folded| folded.report.stored.completion)
                })
            }

            Err(refused) => Err(crate::compound::compound_refusal(refused)),
        }
    }

    /// Its picture along the crease that tells it best: no plain fold's
    /// analysis or depth pick, since it folds along no one line.
    fn action(&self, parent: &State) -> Option<Result<FoldActionGeometry, Refusal>> {
        Some(picture(parent, &self.op, None).map_err(Refusal::from))
    }

    /// The flap, petal or fan it names, before it folds, and what a tool
    /// chooses among (as a reverse fold's question lists its kinds and
    /// orders): which of a fan's emergent candidates land, and the orders it
    /// leaves, whichever completion is stored, so a chooser can move between
    /// them.
    fn ask(&self, parent: &State) -> Result<Result<CompoundAsked, Refusal>, BridgeError> {
        let analysis = match analyse(parent, &self.op) {
            Ok(analysis) => analysis,
            Err(refused) => return Ok(Err(refused.into())),
        };
        let unstored = VertexFold {
            op: self.op.clone(),
            choices: VertexChoices::default(),
        };
        // A swivel on a folded edge folds each of its ways once, the way
        // asked among them.
        let SwivelWays {
            kinds,
            directions,
            asked,
        } = swivel_ways(parent, &self.op).unwrap_or_else(|| SwivelWays {
            kinds: Vec::new(),
            directions: Vec::new(),
            asked: fold(parent, &unstored),
        });
        Ok(Ok(CompoundAsked::Vertex(Box::new(VertexAnalysed {
            emergents: emergents(parent, &self.op, &analysis),
            directions,
            kinds,
            analysis,
            orders: listed(asked),
        }))))
    }

    /// The one state its op and stored choice name (replay), or a refusal
    /// through the seam's one path.
    fn apply(&self, parent: &State) -> Result<Box<dyn CompoundLanded>, Refusal> {
        Ok(Box::new(Landed {
            folded: landed(fold(parent, self))?,
            op: self.op.clone(),
        }))
    }
}

/// A landed vertex fold, held by the bridge with the op that landed it: its
/// summary is the diff from its parent, its picture drawn on its parent from
/// the op, with its own cover at the arrow's head.
#[derive(Debug)]
struct Landed {
    folded: Box<VertexFolded>,
    op: EngineOp,
}

impl CompoundLanded for Landed {
    fn state(&self) -> &State {
        &self.folded.state
    }

    fn report(&self) -> CompoundStepReport {
        CompoundStepReport::Vertex(Box::new(self.folded.report.clone()))
    }

    fn summary(&self, parent: Parent<'_>) -> Result<Result<StepSummary, Refusal>, BridgeError> {
        Ok(Ok(StepSummary::new(parent?, &self.folded.state, None)))
    }

    fn action(
        &self,
        parent: Parent<'_>,
    ) -> Result<Option<Result<FoldActionGeometry, Refusal>>, BridgeError> {
        Ok(Some(
            picture(parent?, &self.op, Some(&self.folded.state)).map_err(Refusal::from),
        ))
    }
}

// ---------------------------------------------------------------------------
// Outputs

/// A vertex op before it folds, by kind.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum VertexAnalysis {
    Squash(SquashAnalysis),
    Petal(PetalAnalysis),
    RabbitEar(FanAnalysis),
    Swivel(FanAnalysis),
    /// A swivel by its edge (`via: 'edge'`): its vertex, creases with their
    /// letters, landing, ridges and moving paper.
    SwivelByEdge(Box<SwivelEdgeAnalysis>),
    /// A swivel by its valley and mountain (`via: 'valley-mountain'`): its
    /// vertex, creases with their letters (the one behind split where it is
    /// hidden), layers, moving paper and folded edge.
    SwivelValleyMountain(Box<SwivelValleyMountainAnalysis>),
}

/// What `compound_analysis` answers for a vertex op.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct VertexAnalysed {
    pub analysis: VertexAnalysis,
    /// A rabbit ear's or a swivel's: per emergent candidate (the analysis'
    /// `candidates`), whether the fold lands with it; a swivel by its
    /// edge's, per ridge (the analysis' `ridges`). Empty for the other
    /// folds.
    pub emergents: Vec<bool>,
    /// A swivel on a folded edge's: valley, then mountain, as the viewer
    /// sees them, each whether the fold lands that way, its kind as asked.
    /// Empty for the other folds.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub directions: Vec<bool>,
    /// A swivel on a folded edge's: per kind, open then inside, its
    /// directions as `directions` lists them, each whether the fold lands
    /// that way. Empty for the other folds.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub kinds: Vec<[bool; 2]>,
    /// The orders the op leaves as asked, its stored completion aside, when
    /// it leaves more than one; null when it lands with one, or is refused.
    pub orders: Option<VertexOrders>,
}

/// The orders a vertex fold leaves (as a reverse fold's question lists
/// them, `ops_reverse::ReverseOrders`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct VertexOrders {
    /// The true ‹ n of m ›.
    pub count: ChoiceCount,
    /// The first [`MAX_ORDERS`], each the `completion` that picks it.
    pub orders: Vec<WitnessOrder>,
    /// More are listed than `orders` holds.
    pub more: bool,
}

/// What `vertex_fold` came to.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum VertexTried {
    /// One order: the step, held as `apply` holds it.
    Landed(Box<Applied>),
    /// More than one: a choice held under `pending`.
    Choose(Choose),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Choose {
    pub pending: u32,
    /// The true ‹ n of m ›.
    pub count: ChoiceCount,
    /// How many orders each independent component lists: a pick names one
    /// of each.
    pub components: Vec<usize>,
}

// ---------------------------------------------------------------------------
// Pending choices

/// Every choice of orders the caller still holds, each with its parent's
/// handle and the op it folds (which a landed pick is pictured by). Handles
/// start at 1 and are never reused while this store lives.
#[derive(Debug, Default)]
pub struct Pending {
    held: HashMap<u32, (u32, VertexChoice, EngineOp)>,
    last: u32,
}

impl Pending {
    pub fn new() -> Pending {
        Pending::default()
    }

    pub fn clear(&mut self) {
        self.held.clear();
    }

    /// Fold `op` on the held state `state`.
    pub fn try_fold(
        &mut self,
        bridge: &mut Bridge,
        state: u32,
        op: &Op,
        choices: &Choices,
    ) -> Result<Outcome<VertexTried>, BridgeError> {
        let parent = bridge.state(state)?;
        // The choices first, as `apply` checks them; then the anchors, which
        // only a vertex op has.
        let resolved =
            check_choices(op.takes(), choices).and_then(|()| resolve(parent, op, choices));
        let resolved = match settle(resolved)? {
            Ok(resolved) => resolved,
            Err(refusal) => return Ok(Outcome::Refused(refusal)),
        };
        Ok(match fold(parent, &resolved) {
            Ok(VertexOutcome::Landed(folded)) => {
                let landed = Landed {
                    folded,
                    op: resolved.op,
                };
                Outcome::Ok(VertexTried::Landed(Box::new(
                    bridge.hold_compound(Box::new(landed), state),
                )))
            }
            Ok(VertexOutcome::ChooseOrder(choice)) => {
                let count = choice.count();
                let components = choice
                    .completions()
                    .components()
                    .iter()
                    .map(|c| c.orders.len())
                    .collect();
                Outcome::Ok(VertexTried::Choose(Choose {
                    pending: self.hold(state, *choice, resolved.op),
                    count,
                    components,
                }))
            }
            Err(refused) => Outcome::Refused(compound_refusal(refused)),
        })
    }

    /// Land the order `choice` names from the held choice `pending`.
    pub fn pick(
        &mut self,
        bridge: &mut Bridge,
        pending: u32,
        choice: &[usize],
    ) -> Result<Outcome<Applied>, BridgeError> {
        let (parent, held, op) = self
            .held
            .get(&pending)
            .ok_or_else(|| BridgeError::InvalidInput(format!("no pending choice {pending}")))?;
        Ok(match held.pick(choice) {
            Ok(folded) => {
                let landed = Landed {
                    folded: Box::new(folded),
                    op: op.clone(),
                };
                Outcome::Ok(bridge.hold_compound(Box::new(landed), *parent))
            }
            Err(refusal) => Outcome::Refused(refusal.into()),
        })
    }

    /// Let a pending choice go; whether it was held.
    pub fn release(&mut self, pending: u32) -> bool {
        self.held.remove(&pending).is_some()
    }

    fn hold(&mut self, parent: u32, choice: VertexChoice, op: EngineOp) -> u32 {
        loop {
            self.last = self.last.wrapping_add(1);
            if self.last != 0 && !self.held.contains_key(&self.last) {
                break;
            }
        }
        self.held.insert(self.last, (parent, choice, op));
        self.last
    }
}

// ---------------------------------------------------------------------------
// On `FoldEngine`

#[wasm_bindgen]
impl FoldEngine {
    /// Fold a vertex op on `state`: landed, or a choice held under its own
    /// handle. `choices` may be `undefined` or `null`.
    pub fn vertex_fold(
        &mut self,
        state: u32,
        op: JsValue,
        choices: JsValue,
    ) -> Result<JsValue, JsValue> {
        let op: Op = parse("op", op)?;
        let choices = parse_choices(choices)?;
        to_js_value(
            &self
                .vertex
                .try_fold(&mut self.inner, state, &op, &choices)
                .map_err(bridge_error)?,
        )
    }

    /// Land the order `choice` picks, one listed order per component.
    pub fn vertex_pick(&mut self, pending: u32, choice: &[u32]) -> Result<JsValue, JsValue> {
        let choice: Vec<usize> = choice.iter().map(|&k| k as usize).collect();
        to_js_value(
            &self
                .vertex
                .pick(&mut self.inner, pending, &choice)
                .map_err(bridge_error)?,
        )
    }

    /// Let pending choices go; how many were held.
    pub fn release_vertex_choices(&mut self, pending: &[u32]) -> u32 {
        let released = pending.iter().filter(|&&p| self.vertex.release(p)).count();
        u32::try_from(released).unwrap_or(u32::MAX)
    }
}
