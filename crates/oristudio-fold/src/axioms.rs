//! The seven Huzita–Justin axioms on flat and folded forms (plan Phase 3,
//! research §8): inputs named by anchors, solved by `oristudio_geometry`'s
//! constructions over the folded silhouette, each root with the side it
//! moves.
//!
//! # From anchors to candidates
//!
//! 1. The inputs — sheet points and [`SheetSegment`]s, in the crate's axiom
//!    order, which is [`Construction`]'s — resolve in the model frame. Click
//!    order is the tool's business; the slots are fixed here (plan D6).
//! 2. [`Construction::lines`] solves on the state's
//!    [`Silhouette`](crate::silhouette::Silhouette): every validity filter
//!    asks the folded paper, so a fold that would land a point off the folded
//!    form, or fold a line onto a stretch of another with no material there,
//!    yields no root.
//! 3. **Who moves.** An axiom names what it carries: `p` for O2, O5 and O7,
//!    `m1` for O3, `p1` and `p2` for O6. A root's moving side is the side its
//!    movers are on. Some roots leave the side to the step
//!    ([`AxiomCandidate::side`] is none): O1 and O4 carry nothing; an O3 whose
//!    `m1` segment straddles the fold has a half on each side that lands on
//!    `m2`; and an O6 whose points lie on opposite sides of the fold is
//!    realized from either side (below). A root with a mover on the fold line
//!    carries nothing and is dropped.
//! 4. **The movers a step checks** are those on the side it moves: every one
//!    when it moves the side the root implies, an O6's point on the chosen
//!    side, and none of an O1, an O4 or a straddling O3. A step may name the
//!    other side than the root implies (Swap, [`crate::anchored`]): the fold
//!    is the same line's, so the movers stay and what they were carried onto
//!    comes to them, as an O6's other side does (below), and none is checked.
//!    Which layers a fold moves is known only once it is analysed: a seed
//!    narrower than every layer can leave a mover's own layer in place, which
//!    the anchored fold refuses ([`crate::anchored`]).
//!
//! # O6 with its points on opposite sides
//!
//! One fold carries `p1` onto `m1` and `p2` onto `m2` whichever side moves,
//! because reflection is its own inverse: when `p1` moves it lands on `m1`,
//! and the piece of `m2` through `p2`'s reflection lands on `p2`. With both
//! points on one side, that side moves both points. With them on opposite
//! sides, either side moves one point and the other point's line, so the
//! root is kept and the step chooses. Robert J. Lang's same-side condition
//! (*Origami and Geometric Constructions*, pp. 46–48, as research
//! `r1-theory.md` records it) is derived under his assumption that the
//! points move and the lines stay put, not as a condition for the fold to
//! exist. ReferenceFinder keeps the opposite-side roots and records that one
//! point and one line move (`refLineP2LP2L.cpp`, lines 217–243).
//!
//! # Replay
//!
//! A root number is only an enumeration index (the O5 chord end, the O6 cubic
//! root in ascending order): when an earlier step changes the inputs or the
//! paper the indices can swap, and a root can vanish from the list. A step
//! therefore stores the chosen root's *line*, in its parent's model frame
//! (plan D6), and [`State::axiom_root`] takes the candidate nearest it under
//! [`line_residual`] — `Construction::nearest_root` over the roots that
//! survive who-moves, the same metric.

use oristudio_geometry::construct::line_residual;
use oristudio_geometry::{Construction, Line};
use serde::{Deserialize, Serialize};

use crate::anchor::SheetSegment;
use crate::anchored::LineRefusal;
use crate::numerics::MIN_FEATURE;
use crate::refusal::Side;
use crate::remedy::Pin;
use crate::state::State;

type Point = [f64; 2];

/// One axiom application named by anchors: sheet points and sheet segments,
/// in [`Construction`]'s input order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "axiom")]
pub enum Axiom {
    /// Crease through `p` and `q`.
    O1 { p: Point, q: Point },
    /// Fold `p` onto `q`.
    O2 { p: Point, q: Point },
    /// Fold `m1` onto `m2`.
    O3 { m1: SheetSegment, m2: SheetSegment },
    /// Crease through `p` perpendicular to `m`.
    O4 { p: Point, m: SheetSegment },
    /// Fold through `pivot` carrying `p` onto `m1`.
    O5 {
        pivot: Point,
        p: Point,
        m1: SheetSegment,
    },
    /// Fold `p1` onto `m1` and `p2` onto `m2` at once.
    O6 {
        p1: Point,
        m1: SheetSegment,
        p2: Point,
        m2: SheetSegment,
    },
    /// Fold perpendicular to `m2` carrying `p` onto `m1`.
    O7 {
        p: Point,
        m1: SheetSegment,
        m2: SheetSegment,
    },
}

/// A feature an axiom carries across its fold, by its anchor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Mover {
    Point(Point),
    Segment(SheetSegment),
}

impl Mover {
    /// A sheet point on it, for naming it in a refusal.
    pub(crate) fn sheet_point(&self) -> Point {
        match self {
            Mover::Point(p) => *p,
            Mover::Segment(s) => s.midpoint(),
        }
    }
}

impl Axiom {
    /// The axiom number, 1..=7.
    pub fn number(&self) -> u8 {
        match self {
            Axiom::O1 { .. } => 1,
            Axiom::O2 { .. } => 2,
            Axiom::O3 { .. } => 3,
            Axiom::O4 { .. } => 4,
            Axiom::O5 { .. } => 5,
            Axiom::O6 { .. } => 6,
            Axiom::O7 { .. } => 7,
        }
    }

    /// What the axiom carries across its fold (see the module docs).
    pub(crate) fn movers(&self) -> Vec<Mover> {
        match self {
            Axiom::O1 { .. } | Axiom::O4 { .. } => Vec::new(),
            Axiom::O2 { p, .. } | Axiom::O5 { p, .. } | Axiom::O7 { p, .. } => {
                vec![Mover::Point(*p)]
            }
            Axiom::O3 { m1, .. } => vec![Mover::Segment(*m1)],
            Axiom::O6 { p1, p2, .. } => vec![Mover::Point(*p1), Mover::Point(*p2)],
        }
    }

    /// The constraints of its line a sliver remedy may keep, each leaving
    /// one degree of freedom ([`crate::remedy`]): the points the line passes
    /// through and the line it is perpendicular to. O2, O3 and O6 fix the line
    /// by alignments alone and have none.
    pub fn pins(&self) -> Vec<Pin> {
        match self {
            Axiom::O1 { p, q } => vec![Pin::Through { point: *p }, Pin::Through { point: *q }],
            Axiom::O4 { p, m } => vec![
                Pin::Through { point: *p },
                Pin::Perpendicular { segment: *m },
            ],
            Axiom::O5 { pivot, .. } => vec![Pin::Through { point: *pivot }],
            Axiom::O7 { m2, .. } => vec![Pin::Perpendicular { segment: *m2 }],
            Axiom::O2 { .. } | Axiom::O3 { .. } | Axiom::O6 { .. } => Vec::new(),
        }
    }
}

/// One fold an axiom yields on a state.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct AxiomCandidate {
    /// The construction's root number: an enumeration index, never stored
    /// (see the module docs).
    pub root: u8,
    /// The fold line in the state's model frame: what a step stores as its
    /// choice.
    pub line: Line,
    /// The side that moves, when the axiom implies one.
    pub side: Option<Side>,
}

/// The candidate a stored line names on replay, and how far it was from it.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct AxiomReplay {
    pub candidate: AxiomCandidate,
    /// [`line_residual`] between the stored line and the candidate's.
    pub err: f64,
}

/// A mover's image in the model frame.
enum Image {
    Point(Point),
    Segment([Point; 2]),
}

impl State {
    /// The construction an axiom names here: its inputs in the model frame.
    pub fn axiom_construction(&self, axiom: &Axiom) -> Result<Construction, LineRefusal> {
        let p = |q: &Point| self.anchor_point(*q);
        let m = |s: &SheetSegment| self.anchor_segment(s);
        Ok(match axiom {
            Axiom::O1 { p: a, q } => Construction::O1 { p: p(a)?, q: p(q)? },
            Axiom::O2 { p: a, q } => Construction::O2 { p: p(a)?, q: p(q)? },
            Axiom::O3 { m1, m2 } => Construction::O3 {
                m1: m(m1)?,
                m2: m(m2)?,
            },
            Axiom::O4 { p: a, m: l } => Construction::O4 { p: p(a)?, m: m(l)? },
            Axiom::O5 { pivot, p: a, m1 } => Construction::O5 {
                pivot: p(pivot)?,
                p: p(a)?,
                m1: m(m1)?,
            },
            Axiom::O6 { p1, m1, p2, m2 } => Construction::O6 {
                p1: p(p1)?,
                m1: m(m1)?,
                p2: p(p2)?,
                m2: m(m2)?,
            },
            Axiom::O7 { p: a, m1, m2 } => Construction::O7 {
                p: p(a)?,
                m1: m(m1)?,
                m2: m(m2)?,
            },
        })
    }

    /// Every fold the axiom yields on this state's folded form, with the side
    /// each moves (see the module docs); empty when there is none.
    pub fn axiom_candidates(&self, axiom: &Axiom) -> Result<Vec<AxiomCandidate>, LineRefusal> {
        let construction = self.axiom_construction(axiom)?;
        let images: Vec<Image> = self
            .mover_images(axiom)?
            .into_iter()
            .map(|(_, image)| image)
            .collect();
        Ok(construction
            .lines(&self.silhouette())
            .into_iter()
            .filter_map(|root| {
                let side = moving_side(&root.line, &images)?;
                Some(AxiomCandidate {
                    root: root.root,
                    line: root.line,
                    side,
                })
            })
            .collect())
    }

    /// What the axiom carries when `side` of its root `line` moves: its
    /// movers whose images lie on that side (see the module docs).
    pub(crate) fn movers_on(
        &self,
        axiom: &Axiom,
        line: &Line,
        side: Side,
    ) -> Result<Vec<Mover>, LineRefusal> {
        Ok(self
            .mover_images(axiom)?
            .into_iter()
            .filter(|(_, image)| image_side(line, image) == Some(Some(side)))
            .map(|(mover, _)| mover)
            .collect())
    }

    /// Each mover with its image in the model frame.
    fn mover_images(&self, axiom: &Axiom) -> Result<Vec<(Mover, Image)>, LineRefusal> {
        axiom
            .movers()
            .into_iter()
            .map(|mover| {
                let image = match mover {
                    Mover::Point(p) => Image::Point(self.anchor_point(p)?),
                    Mover::Segment(s) => {
                        Image::Segment([self.anchor_point(s.a)?, self.anchor_point(s.b)?])
                    }
                };
                Ok((mover, image))
            })
            .collect()
    }

    /// Replay: the candidate nearest a stored line (see the module docs).
    pub fn axiom_root(&self, axiom: &Axiom, stored: &Line) -> Result<AxiomReplay, LineRefusal> {
        self.axiom_candidates(axiom)?
            .into_iter()
            .map(|candidate| AxiomReplay {
                err: line_residual(&candidate.line, stored),
                candidate,
            })
            .min_by(|a, b| a.err.total_cmp(&b.err))
            .ok_or(LineRefusal::NoRoot {
                axiom: axiom.number(),
            })
    }

    /// A sheet point's image, or why it has none.
    pub(crate) fn anchor_point(&self, p: Point) -> Result<Point, LineRefusal> {
        self.resolve_point(p)
            .ok_or(LineRefusal::PointOffPaper { point: p })
    }

    /// A sheet segment's line, or why it has none.
    pub(crate) fn anchor_segment(&self, segment: &SheetSegment) -> Result<Line, LineRefusal> {
        if segment.length() < MIN_FEATURE {
            return Err(LineRefusal::SegmentTooShort { segment: *segment });
        }
        self.resolve_segment(segment)
            .ok_or(LineRefusal::SegmentNotOnAFace { segment: *segment })
    }
}

/// The side a root moves, from its movers' images: `None` drops the root
/// (a mover on the line), `Some(None)` leaves the side to the step. Only
/// O6 has two movers, its points: on one side they move together, and on
/// opposite sides either side realizes the root (see the module docs).
fn moving_side(line: &Line, movers: &[Image]) -> Option<Option<Side>> {
    let sides = movers
        .iter()
        .map(|m| image_side(line, m))
        .collect::<Option<Vec<_>>>()?;
    Some(match sides[..] {
        [side] => side,
        [a, b] if a == b => a,
        _ => None,
    })
}

/// The side of `line` a mover's image is on: `None` on the line,
/// `Some(None)` for a segment that straddles it. A segment touching the line
/// is on the side of its other end.
fn image_side(line: &Line, image: &Image) -> Option<Option<Side>> {
    match image {
        Image::Point(p) => Side::of_point(line, *p).map(Some),
        Image::Segment([a, b]) => match (Side::of_point(line, *a), Side::of_point(line, *b)) {
            (None, None) => None,
            (Some(s), None) | (None, Some(s)) => Some(Some(s)),
            (Some(s), Some(t)) => Some((s == t).then_some(s)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(n: Point, d: f64) -> Line {
        Line::new(n, d).unwrap_or_else(|| unreachable!())
    }

    #[test]
    fn the_side_follows_the_movers() {
        let x = line([1.0, 0.0], 0.5);
        let left = || Image::Point([0.2, 0.5]);
        let right = || Image::Point([0.8, 0.5]);
        assert_eq!(moving_side(&x, &[]), Some(None));
        assert_eq!(
            moving_side(&x, &[Image::Point([0.2, 0.5])]),
            Some(Some(Side::Negative))
        );
        assert_eq!(moving_side(&x, &[Image::Point([0.5, 0.2])]), None);
        // A segment on one side, touching the line, or straddling it.
        let touching = Image::Segment([[0.5, 0.0], [0.9, 0.3]]);
        assert_eq!(moving_side(&x, &[touching]), Some(Some(Side::Positive)));
        let straddling = Image::Segment([[0.1, 0.0], [0.9, 0.3]]);
        assert_eq!(moving_side(&x, &[straddling]), Some(None));
        // O6: both points on one side move together; on opposite sides the
        // step chooses; a point on the line drops the root.
        assert_eq!(
            moving_side(&x, &[left(), Image::Point([0.3, 0.9])]),
            Some(Some(Side::Negative))
        );
        assert_eq!(moving_side(&x, &[left(), right()]), Some(None));
        assert_eq!(moving_side(&x, &[Image::Point([0.5, 0.1]), right()]), None);
    }

    #[test]
    fn pins_keep_points_and_perpendiculars() {
        let s = SheetSegment::new([0.0, 0.0], [1.0, 0.0]);
        let p = [0.2, 0.3];
        assert_eq!(Axiom::O2 { p, q: p }.pins(), Vec::new());
        assert_eq!(
            Axiom::O4 { p, m: s }.pins(),
            vec![Pin::Through { point: p }, Pin::Perpendicular { segment: s }]
        );
        assert_eq!(
            Axiom::O7 {
                p,
                m1: s,
                m2: SheetSegment::new([0.0, 0.0], [0.0, 1.0])
            }
            .pins(),
            vec![Pin::Perpendicular {
                segment: SheetSegment::new([0.0, 0.0], [0.0, 1.0])
            }]
        );
    }

    #[test]
    fn axioms_serialize_by_number() {
        let a = Axiom::O5 {
            pivot: [0.0, 0.0],
            p: [0.5, 0.5],
            m1: SheetSegment::new([0.0, 1.0], [1.0, 1.0]),
        };
        let json = serde_json::to_value(&a).unwrap_or_default();
        assert_eq!(json["axiom"], "o5");
        let back: Result<Axiom, _> = serde_json::from_value(json);
        assert_eq!(back.ok(), Some(a));
    }
}
