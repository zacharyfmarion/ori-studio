//! The plain fold, closed-form (plan D3, research §4): valley or mountain
//! along a line, through all layers on the moving side or down to picked
//! flaps, with no solver call.
//!
//! 1. Snap ℓ through landmarks within tol, refusing a snap that changes any
//!    vertex's class ([`line`]).
//! 2. Classify each vertex once.
//! 3. Compute the moving set U by closure, and the flaps (`closure`).
//! 4. Split the moving faces, once per crossed crease; toggle hinges on ℓ;
//!    re-derive and check the isometries; carry and place the order; derive
//!    the letters; pass the gate (`apply`).
//!
//! Precrease, refold, unfold and turn-over are this operation, or trivial:
//! a precrease folds and folds back the faces it moved; refolding a precrease
//! and unfolding a flap are plain folds along an existing crease
//! ([`State::crease_line`]), the flap picked by a seed; turning over and
//! rotating change the view. A precrease of part of its line — a segment or
//! a pinch — goes through the same analysis and lands crease marks instead
//! (`partial`, [`State::precrease_extent`]).
//!
//! # Inputs
//!
//! The line is in the parent's model frame; the direction is as the viewer
//! sees it, resolved against the parent's view. Seeds and tuck targets are
//! sheet points, never face ids, so a stored step survives replay (plan D6).

mod action;
pub(crate) mod apply;
pub(crate) mod closure;
pub(crate) mod line;
mod partial;
mod partial_existing;
pub mod placements;
pub(crate) mod score;
pub(crate) mod section;

use oristudio_geometry::Line;
use serde::Serialize;

use crate::pattern::{CreaseKind, EdgeId, FaceId};
use crate::refusal::{Fix, Flap, FoldRefusal, Refused, Side};
use crate::state::State;
use crate::view::Direction;

pub(crate) use action::Within;
pub use action::{ActionKind, FoldActionGeometry, FoldLineSpan, Grip, Pleat, Push};
pub use apply::Refold;
pub use line::Snap;
pub use section::{CrossSection, DepthChoice, RowOrder, SectionInterval, SectionRow};

use closure::Analysis;
use line::Axis;

type Point = [f64; 2];

/// What a fold takes along with the moving side.
#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case", tag = "seed")]
pub enum Seed {
    /// Every layer on the moving side.
    All,
    /// The top `layers` layers at a sheet point (the bottom ones for a
    /// mountain), counted from the side the direction implies. The point's
    /// image must be on the moving side.
    Depth { at: Point, layers: usize },
    /// The flaps of the faces containing these sheet points.
    Flaps { at: Vec<Point> },
}

/// Where the moving block lands.
#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "snake_case", tag = "placement")]
pub enum Placement {
    /// On top for a valley, underneath for a mountain.
    #[default]
    OnTop,
    /// A tuck: just over the stationary face containing the sheet point.
    /// Accepted only if the state it lands validates (research §4.4).
    Over { at: Point },
    /// A tuck: just under the stationary face containing the sheet point.
    Under { at: Point },
}

/// What to do when the closure moves flaps the seed did not name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ClosurePolicy {
    /// Move them, and report them as added.
    #[default]
    Include,
    /// Refuse, offering to include them.
    Refuse,
}

/// A valley or mountain fold along a line.
#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
pub struct PlainFold {
    /// In the parent state's model frame.
    pub line: Line,
    /// Which side of `line` moves.
    pub side: Side,
    /// As the viewer sees it.
    pub direction: Direction,
    pub seed: Seed,
    #[serde(default)]
    pub placement: Placement,
    #[serde(default)]
    pub closure: ClosurePolicy,
}

impl PlainFold {
    /// A fold of every layer on `side` of `line`.
    pub fn new(line: Line, side: Side, direction: Direction) -> PlainFold {
        PlainFold {
            line,
            side,
            direction,
            seed: Seed::All,
            placement: Placement::OnTop,
            closure: ClosurePolicy::Include,
        }
    }

    pub fn with_seed(mut self, seed: Seed) -> PlainFold {
        self.seed = seed;
        self
    }

    pub fn with_placement(mut self, placement: Placement) -> PlainFold {
        self.placement = placement;
        self
    }

    pub fn with_closure(mut self, closure: ClosurePolicy) -> PlainFold {
        self.closure = closure;
        self
    }
}

/// A seed after resolution: what the public seeds name, plus the faces a
/// precrease folds back.
#[derive(Debug, Clone)]
pub(crate) enum ResolvedSeed {
    All,
    Depth { at: Point, layers: usize },
    Flaps(Vec<Point>),
    Faces(Vec<FaceId>),
}

impl From<&Seed> for ResolvedSeed {
    fn from(seed: &Seed) -> ResolvedSeed {
        match seed {
            Seed::All => ResolvedSeed::All,
            Seed::Depth { at, layers } => ResolvedSeed::Depth {
                at: *at,
                layers: *layers,
            },
            Seed::Flaps { at } => ResolvedSeed::Flaps(at.clone()),
        }
    }
}

/// What a fold would move, before anything is cut: the preview (plan D14
/// tier 2).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FoldAnalysis {
    /// The line actually folded along, after snapping, and its moving side.
    pub line: Line,
    pub side: Side,
    pub snap: Snap,
    /// The direction in the model frame.
    pub direction: Direction,
    /// The flaps on the moving side.
    pub flaps: Vec<Flap>,
    /// The flaps the seed named.
    pub picked: Vec<usize>,
    /// The flaps the closure added beyond those.
    pub added: Vec<usize>,
    /// U: the parent's faces that move, in id order.
    pub moving: Vec<FaceId>,
}

/// What a fold did.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FoldReport {
    #[serde(flatten)]
    pub analysis: FoldAnalysis,
    /// The landed state's faces that moved.
    pub moving_faces: Vec<FaceId>,
    /// The creases the fold made.
    pub created: Vec<EdgeId>,
    /// Folded creases on ℓ that became flat.
    pub unfolded: Vec<EdgeId>,
    /// Flat creases on ℓ that became folded.
    pub refolded: Vec<Refold>,
    /// How many faces were split.
    pub split: usize,
}

/// A landed fold.
#[derive(Debug, Clone)]
pub struct Folded {
    pub state: State,
    pub report: FoldReport,
    /// A partial precrease's stretch of the line, in the parent's model
    /// frame, the two ends in order along it: what its picture draws. None
    /// for any other fold, which folds along the whole line.
    pub extent: Option<[Point; 2]>,
}

impl State {
    /// What `fold` would move, without folding.
    pub fn analyse_fold(&self, op: &PlainFold) -> Result<FoldAnalysis, Refused> {
        let analysis = self.analyse(op, &ResolvedSeed::from(&op.seed))?;
        Ok(self.public_analysis(&analysis))
    }

    /// A plain fold. A refusal comes with the fixes that would work: the
    /// other direction when it is valid, the flaps to pick when everything
    /// would move, the flaps to include, or the landmark line of a near miss.
    pub fn fold(&self, op: &PlainFold) -> Result<Folded, Refused> {
        self.fold_as(op, &ResolvedSeed::from(&op.seed), self.step() + 1)
            .map_err(|refused| self.with_direction_fix(op, refused, State::fold_plain))
    }

    /// Fold and unfold: a precrease. The fold back moves exactly the faces the
    /// fold moved, along the line it used, and its creases are left flat,
    /// remembering their letters. One step.
    pub fn precrease(&self, op: &PlainFold) -> Result<Folded, Refused> {
        self.precrease_plain(op)
            .map_err(|refused| self.with_direction_fix(op, refused, State::precrease_plain))
    }

    /// Turn the model over: the view mirrors; no layer or letter changes.
    pub fn turn_over(&self) -> State {
        self.with_view(self.view().turned_over(), self.step() + 1)
    }

    /// Rotate the view by `angle` radians, counter-clockwise.
    pub fn rotate(&self, angle: f64) -> State {
        self.with_view(self.view().rotated(angle), self.step() + 1)
    }

    fn fold_plain(&self, op: &PlainFold) -> Result<Folded, Refused> {
        self.fold_as(op, &ResolvedSeed::from(&op.seed), self.step() + 1)
    }

    fn precrease_plain(&self, op: &PlainFold) -> Result<Folded, Refused> {
        let step = self.step() + 1;
        let folded = self.fold_as(op, &ResolvedSeed::from(&op.seed), step)?;
        let first = &folded.report;
        let back = PlainFold {
            line: first.analysis.line,
            side: first.analysis.side.opposite(),
            // The parent's view, so the same seen direction is the same model
            // direction, which turns the block back.
            direction: op.direction,
            seed: Seed::All,
            placement: Placement::OnTop,
            closure: ClosurePolicy::Include,
        };
        let unfolded = folded.state.fold_as(
            &back,
            &ResolvedSeed::Faces(first.moving_faces.clone()),
            step,
        )?;
        if unfolded.report.analysis.moving.len() != first.moving_faces.len() {
            return Err(FoldRefusal::PrecreaseUnfoldMovedMore.into());
        }
        // Report the net change: the new creases (now flat), and the creases
        // on ℓ whose state differs from the parent's. A hinge on ℓ that the
        // fold unfolded and the fold back refolded is no change.
        let mut report = unfolded.report;
        report.analysis = first.analysis.clone();
        report.created = first.created.clone();
        report.split = first.split;
        report.unfolded.clear();
        report.refolded.clear();
        for crease in self.creases() {
            let Some(now) = unfolded.state.crease(crease.id) else {
                continue;
            };
            match (crease.kind, now.kind) {
                (CreaseKind::Folded(_), CreaseKind::Flat(_)) => report.unfolded.push(crease.id),
                (CreaseKind::Flat(remembered), CreaseKind::Folded(letter)) => {
                    report.refolded.push(Refold {
                        edge: crease.id,
                        remembered,
                        letter,
                    });
                }
                _ => {}
            }
        }
        Ok(Folded {
            state: unfolded.state,
            report,
            extent: None,
        })
    }

    fn fold_as(&self, op: &PlainFold, seed: &ResolvedSeed, step: u32) -> Result<Folded, Refused> {
        let analysis = self.analyse(op, seed)?;
        let (state, landed) = apply::land(self, &analysis, step)?;
        Ok(Folded {
            state,
            report: FoldReport {
                analysis: self.public_analysis(&analysis),
                moving_faces: landed.moving_faces,
                created: landed.created,
                unfolded: landed.unfolded,
                refolded: landed.refolded,
                split: landed.split,
            },
            extent: None,
        })
    }

    fn analyse(&self, op: &PlainFold, seed: &ResolvedSeed) -> Result<Analysis, Refused> {
        let requested = Axis::new(&op.line, op.side);
        let classified = line::classify_for_selection(&self.geometry().vertex_images, requested)?;
        let direction = self.view().model_direction(op.direction);
        closure::analyse(self, classified, direction, seed, &op.placement, op.closure)
    }

    fn public_analysis(&self, analysis: &Analysis) -> FoldAnalysis {
        let (line, side) = analysis.axis().line_and_side();
        FoldAnalysis {
            line,
            side,
            snap: analysis.classified.snap,
            direction: analysis.direction,
            flaps: analysis.flaps.clone(),
            picked: analysis.picked.clone(),
            added: analysis.added.clone(),
            moving: analysis.moved_faces(self),
        }
    }

    /// Add "fold the other way" to a refusal that depends on the direction,
    /// if the other way lands.
    fn with_direction_fix(
        &self,
        op: &PlainFold,
        mut refused: Refused,
        attempt: impl Fn(&State, &PlainFold) -> Result<Folded, Refused>,
    ) -> Refused {
        let depends_on_direction = !matches!(
            refused.refusal,
            FoldRefusal::NearMiss { .. }
                | FoldRefusal::NoMovingSide
                | FoldRefusal::WitnessNotInFace { .. }
                | FoldRefusal::SeedNotOnMovingSide { .. }
                | FoldRefusal::ExtentOffPaper { .. }
                | FoldRefusal::ExtentTooShort { .. }
                | FoldRefusal::ExtentMissesPaper
        );
        if depends_on_direction {
            let other = PlainFold {
                direction: op.direction.opposite(),
                ..op.clone()
            };
            if attempt(self, &other).is_ok() {
                refused.fixes.push(Fix::OppositeDirection);
            }
        }
        refused
    }
}
