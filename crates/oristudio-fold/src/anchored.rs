//! A plain fold named by anchors (plan D6): what a stored step holds, and
//! what it resolves to when it is replayed on its parent.
//!
//! The fold line comes one of three ways, plan D14's line modes:
//!
//! - **an axiom** on anchors with its chosen root's line, replayed to the
//!   nearest root ([`crate::axioms`]);
//! - **an existing crease** or bend, by a piece of it: the mode that refolds a
//!   precrease, and unfolds a flap when the seed picks the flap (plan D3);
//! - **a free line** through two sheet points, at least the minimum feature
//!   apart in the model frame.
//!
//! The moving side is `toward`'s, a sheet point whose image lies on it, when
//! the step names one; otherwise the axiom's, when it implies one; otherwise
//! the seed's own point (a depth seed's, or the first flap's), which a seed
//! requires to be on the moving side. One rule: a side the step names beats
//! the side its axiom implies. So the step stores a side when nothing else
//! implies one (plan D6), and when it moves the other side than its axiom
//! implies — Swap on a point carried onto a point: the point it would have
//! carried stays, and the other comes onto it.
//!
//! Once the fold's moving set is known, every feature the axiom carries from
//! the moving side must be on a layer that moves: a seed narrower than every
//! layer can leave the mover's own layer in place, and the fold would not do
//! what the axiom says (research §8). A sliver refusal comes with the exact
//! lines the line's pins allow instead ([`crate::remedy`]).

use oristudio_geometry::Line;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::anchor::SheetSegment;
use crate::axioms::{Axiom, AxiomReplay, Mover};
use crate::crease_marks::Extent;
use crate::fold::{ClosurePolicy, FoldAnalysis, Folded, Placement, PlainFold, Seed};
use crate::numerics::MIN_FEATURE;
use crate::pattern::FaceId;
use crate::refusal::{Fix, Refused, Side};
use crate::remedy::{Pin, SliverRemedy};
use crate::state::State;
use crate::view::Direction;

type Point = [f64; 2];

/// How a step names its fold line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "mode")]
pub enum FoldLine {
    /// An axiom and the line of the root chosen, in the parent's model frame.
    Axiom { axiom: Axiom, root: Line },
    /// Along an existing crease or bend, named by a piece of it.
    Crease { segment: SheetSegment },
    /// Through two sheet points.
    Free { a: Point, b: Point },
}

impl FoldLine {
    /// The constraints a sliver remedy may keep ([`crate::remedy`]): an
    /// axiom's, or a free line's two points. An existing crease has none.
    pub fn pins(&self) -> Vec<Pin> {
        match self {
            FoldLine::Axiom { axiom, .. } => axiom.pins(),
            FoldLine::Crease { .. } => Vec::new(),
            FoldLine::Free { a, b } => vec![Pin::Through { point: *a }, Pin::Through { point: *b }],
        }
    }
}

/// A plain fold whose line and moving side are named by anchors.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnchoredFold {
    pub line: FoldLine,
    /// A sheet point whose image is on the moving side: for a line that
    /// implies none and a seed that names no point, or to move the other
    /// side than the axiom implies. It wins over both.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub toward: Option<Point>,
    /// As the viewer sees it.
    pub direction: Direction,
    pub seed: Seed,
    #[serde(default)]
    pub placement: Placement,
    #[serde(default)]
    pub closure: ClosurePolicy,
}

impl AnchoredFold {
    /// A fold of every layer on the moving side.
    pub fn new(line: FoldLine, direction: Direction) -> AnchoredFold {
        AnchoredFold {
            line,
            toward: None,
            direction,
            seed: Seed::All,
            placement: Placement::OnTop,
            closure: ClosurePolicy::Include,
        }
    }

    pub fn toward(mut self, point: Point) -> AnchoredFold {
        self.toward = Some(point);
        self
    }

    pub fn with_seed(mut self, seed: Seed) -> AnchoredFold {
        self.seed = seed;
        self
    }

    pub fn with_placement(mut self, placement: Placement) -> AnchoredFold {
        self.placement = placement;
        self
    }

    pub fn with_closure(mut self, closure: ClosurePolicy) -> AnchoredFold {
        self.closure = closure;
        self
    }
}

/// Why an anchored fold's line or side does not resolve.
#[derive(Debug, Clone, PartialEq, Serialize, Error)]
#[serde(rename_all = "snake_case", tag = "code")]
pub enum LineRefusal {
    #[error("the sheet point {point:?} is not on the paper")]
    PointOffPaper { point: Point },
    #[error("the segment {segment:?} is shorter than the minimum feature")]
    SegmentTooShort { segment: SheetSegment },
    /// A folded crease bends it, or it leaves the paper (the code predates
    /// segments that cross flat creases, which resolve).
    #[error("the segment {segment:?} is bent by a fold or leaves the paper")]
    SegmentNotOnAFace { segment: SheetSegment },
    #[error("the free line's points land {distance} apart, closer than the minimum feature")]
    FreeLineTooShort { a: Point, b: Point, distance: f64 },
    #[error("axiom O{axiom} gives no fold on this paper")]
    NoRoot { axiom: u8 },
    #[error("nothing names the side that moves")]
    NoSide,
    #[error("the sheet point {point:?} naming the moving side lands on the fold line")]
    SideOnLine { point: Point },
    #[error("the feature at {point:?} that the axiom carries is on no layer the fold moves")]
    MoverStays { point: Point },
}

impl LineRefusal {
    /// The stable snake_case code.
    pub fn code(&self) -> &'static str {
        match self {
            LineRefusal::PointOffPaper { .. } => "point_off_paper",
            LineRefusal::SegmentTooShort { .. } => "segment_too_short",
            LineRefusal::SegmentNotOnAFace { .. } => "segment_not_on_a_face",
            LineRefusal::FreeLineTooShort { .. } => "free_line_too_short",
            LineRefusal::NoRoot { .. } => "no_root",
            LineRefusal::NoSide => "no_side",
            LineRefusal::SideOnLine { .. } => "side_on_line",
            LineRefusal::MoverStays { .. } => "mover_stays",
        }
    }
}

/// A refused anchored fold: its line did not resolve, or the fold it names
/// was refused.
#[derive(Debug, Clone, PartialEq, Serialize, Error)]
#[serde(rename_all = "snake_case", tag = "stage")]
pub enum AnchoredRefused {
    #[error("{0}")]
    Line(LineRefusal),
    /// The plain fold's refusal, whose fixes include a `use_line` per remedy.
    #[error("{refused}")]
    Fold {
        refused: Refused,
        remedies: Vec<SliverRemedy>,
    },
}

impl AnchoredRefused {
    /// The stable snake_case code of whichever refusal it is.
    pub fn code(&self) -> &'static str {
        match self {
            AnchoredRefused::Line(r) => r.code(),
            AnchoredRefused::Fold { refused, .. } => refused.refusal.code(),
        }
    }
}

impl From<LineRefusal> for AnchoredRefused {
    fn from(refusal: LineRefusal) -> AnchoredRefused {
        AnchoredRefused::Line(refusal)
    }
}

/// What an anchored fold names on a state.
#[derive(Debug, Clone, PartialEq)]
pub struct Resolved {
    pub fold: PlainFold,
    /// For an axiom line, the candidate replay chose and how far the stored
    /// line was from it.
    pub replay: Option<AxiomReplay>,
    movers: Vec<Mover>,
}

/// Fold, or fold and unfold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Fold,
    Precrease,
}

impl State {
    /// The plain fold an anchored fold names here.
    pub fn resolve_anchored(&self, op: &AnchoredFold) -> Result<Resolved, LineRefusal> {
        let (line, implied, axiom, replay) = match &op.line {
            FoldLine::Axiom { axiom, root } => {
                let replay = self.axiom_root(axiom, root)?;
                (
                    replay.candidate.line,
                    replay.candidate.side,
                    Some(axiom),
                    Some(replay),
                )
            }
            FoldLine::Crease { segment } => (self.anchor_segment(segment)?, None, None, None),
            FoldLine::Free { a, b } => {
                let (ia, ib) = (self.anchor_point(*a)?, self.anchor_point(*b)?);
                let distance = (ib[0] - ia[0]).hypot(ib[1] - ia[1]);
                let line = Line::from_points(ia, ib)
                    .filter(|_| distance >= MIN_FEATURE)
                    .ok_or(LineRefusal::FreeLineTooShort {
                        a: *a,
                        b: *b,
                        distance,
                    })?;
                (line, None, None, None)
            }
        };
        // A side the step names beats the axiom's (see the module docs).
        let side = match implied {
            Some(side) if op.toward.is_none() => side,
            _ => self.side_from_points(&line, op)?,
        };
        // What the axiom carries from the side that moves: all of its movers
        // when it moves the side the axiom implies, an O6's point on the
        // side the step chose, none when the step moves the other side.
        let movers = match axiom {
            Some(axiom) => self.movers_on(axiom, &line, side)?,
            None => Vec::new(),
        };
        Ok(Resolved {
            fold: PlainFold {
                line,
                side,
                direction: op.direction,
                seed: op.seed.clone(),
                placement: op.placement.clone(),
                closure: op.closure,
            },
            replay,
            movers,
        })
    }

    /// What an anchored fold would move, without folding.
    pub fn analyse_anchored(&self, op: &AnchoredFold) -> Result<FoldAnalysis, AnchoredRefused> {
        let resolved = self.resolve_anchored(op)?;
        let analysis =
            self.analyse_fold(&resolved.fold)
                .map_err(|refused| AnchoredRefused::Fold {
                    refused,
                    remedies: Vec::new(),
                })?;
        self.check_movers(&resolved.movers, &analysis.moving)?;
        Ok(analysis)
    }

    /// An anchored fold. A sliver refusal comes with the remedies its line's
    /// pins allow.
    pub fn fold_anchored(&self, op: &AnchoredFold) -> Result<Folded, AnchoredRefused> {
        self.anchored(op, Kind::Fold, true)
    }

    /// An anchored fold and unfold: a precrease along the line it names.
    pub fn precrease_anchored(&self, op: &AnchoredFold) -> Result<Folded, AnchoredRefused> {
        self.anchored(op, Kind::Precrease, true)
    }

    /// [`State::precrease_anchored`] of `extent` of the line it names: a
    /// partial precrease ([`State::precrease_extent`]), which lands nothing,
    /// so it has no sliver to remedy. The axiom's movers must still be on
    /// layers it goes through.
    pub fn precrease_anchored_extent(
        &self,
        op: &AnchoredFold,
        extent: &Extent,
    ) -> Result<Folded, AnchoredRefused> {
        if extent.is_whole() {
            return self.precrease_anchored(op);
        }
        let resolved = self.resolve_anchored(op)?;
        let folded = self
            .precrease_extent(&resolved.fold, extent)
            .map_err(|refused| AnchoredRefused::Fold {
                refused,
                remedies: Vec::new(),
            })?;
        self.check_movers(&resolved.movers, &folded.report.analysis.moving)?;
        Ok(folded)
    }

    pub(crate) fn anchored(
        &self,
        op: &AnchoredFold,
        kind: Kind,
        remedy: bool,
    ) -> Result<Folded, AnchoredRefused> {
        let resolved = self.resolve_anchored(op)?;
        let attempt = match kind {
            Kind::Fold => self.fold(&resolved.fold),
            Kind::Precrease => self.precrease(&resolved.fold),
        };
        match attempt {
            Ok(folded) => {
                self.check_movers(&resolved.movers, &folded.report.analysis.moving)?;
                Ok(folded)
            }
            Err(mut refused) => {
                let remedies = if remedy {
                    self.sliver_remedies(op, &resolved.fold, &refused.refusal, kind)
                } else {
                    Vec::new()
                };
                refused.fixes.extend(remedies.iter().map(|r| Fix::UseLine {
                    line: r.line,
                    side: r.side,
                }));
                Err(AnchoredRefused::Fold { refused, remedies })
            }
        }
    }

    /// The side `toward`, or else the seed's point, is on: the side the step
    /// names.
    fn side_from_points(&self, line: &Line, op: &AnchoredFold) -> Result<Side, LineRefusal> {
        let point = op.toward.or(match &op.seed {
            Seed::All => None,
            Seed::Depth { at, .. } => Some(*at),
            Seed::Flaps { at } => at.first().copied(),
        });
        let point = point.ok_or(LineRefusal::NoSide)?;
        Side::of_point(line, self.anchor_point(point)?).ok_or(LineRefusal::SideOnLine { point })
    }

    /// Every mover is on a face in `moving` (the parent's faces that move, in
    /// id order).
    fn check_movers(&self, movers: &[Mover], moving: &[FaceId]) -> Result<(), LineRefusal> {
        for mover in movers {
            let faces = match mover {
                Mover::Point(p) => self.faces_holding(*p),
                Mover::Segment(s) => self.faces_holding_segment(s),
            };
            if !faces.iter().any(|f| moving.binary_search(f).is_ok()) {
                return Err(LineRefusal::MoverStays {
                    point: mover.sheet_point(),
                });
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_stable_and_tagged() {
        let refusals = [
            LineRefusal::PointOffPaper { point: [2.0, 0.0] },
            LineRefusal::NoSide,
            LineRefusal::NoRoot { axiom: 6 },
            LineRefusal::MoverStays { point: [0.0, 0.0] },
        ];
        for r in refusals {
            let json = serde_json::to_value(&r).unwrap_or_default();
            assert_eq!(json["code"], r.code(), "{json}");
            let wrapped =
                serde_json::to_value(AnchoredRefused::Line(r.clone())).unwrap_or_default();
            assert_eq!(wrapped["stage"], "line");
            assert_eq!(wrapped["code"], r.code());
        }
    }

    #[test]
    fn anchored_folds_round_trip_through_json() {
        let op = AnchoredFold::new(
            FoldLine::Free {
                a: [0.5, 0.0],
                b: [0.5, 1.0],
            },
            Direction::Valley,
        )
        .toward([0.9, 0.5]);
        let json = serde_json::to_value(&op).unwrap_or_default();
        assert_eq!(json["line"]["mode"], "free");
        let back: Result<AnchoredFold, _> = serde_json::from_value(json);
        assert_eq!(back.ok(), Some(op));
    }
}
