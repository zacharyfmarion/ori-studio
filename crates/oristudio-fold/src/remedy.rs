//! The sliver remedy (plan D5, research §6): a fold refused because a moving
//! vertex lands a sliver inside a stationary face is offered the exact line,
//! next to the one asked for, that lands the vertex on the face's edge.
//!
//! A remedy keeps one constraint of the refused line and releases the rest,
//! which leaves one degree of freedom; within that one-parameter family the
//! line that puts the vertex on the edge's line is an axiom:
//!
//! - a line pinned **through a point** turns about it: the remedy is O5,
//!   through the point, carrying the vertex onto the edge's line;
//! - a line pinned **perpendicular to a line** slides along it: the remedy is
//!   O7, perpendicular to it, carrying the vertex onto the edge's line.
//!
//! The pins a line has ([`Pin`]) are the points an axiom's line passes through
//! (O1's two, O4's `p`, O5's pivot), the line it is perpendicular to (O4's
//! `m`, O7's `m2`), and a free line's two points. O2, O3, O6 and an existing
//! crease fix the line by alignments alone: no pin, no remedy.
//!
//! The edge is the stationary face's edge whose line the landed vertex lies
//! past by more than the tolerance and less than the minimum feature, beside
//! the edge rather than beyond its ends. A sliver the other way round — the
//! face's own corner poking into the moving layer, with the named vertex
//! outside the face — has no such edge and gets no remedy.
//!
//! Each remedy is the refused fold with only its line changed, named as an
//! axiom on anchors so a step can store it, keeping the moving side, and is
//! offered only if it lands. Per pin and edge the root nearest the refused
//! line is tried first.

use oristudio_geometry::construct::line_residual;
use oristudio_geometry::{Line, convex};
use serde::{Deserialize, Serialize};

use crate::anchor::SheetSegment;
use crate::anchored::{AnchoredFold, FoldLine, Kind};
use crate::axioms::Axiom;
use crate::fold::PlainFold;
use crate::isometry::Isometry;
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::FaceId;
use crate::refusal::{FoldRefusal, Side};
use crate::state::State;

type Point = [f64; 2];

/// A constraint of a fold line that a remedy keeps, by its anchor.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "pin")]
pub enum Pin {
    /// The line passes through this sheet point.
    Through { point: Point },
    /// The line is perpendicular to this segment's line.
    Perpendicular { segment: SheetSegment },
}

/// A line that lands the sliver's vertex exactly on the edge.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SliverRemedy {
    /// The constraint kept from the refused line.
    pub pin: Pin,
    /// The refused fold along the remedy's line: what a step stores.
    pub fold: AnchoredFold,
    /// That line and its moving side, in the model frame.
    pub line: Line,
    pub side: Side,
}

impl State {
    /// The remedies for a fold refused as a sliver (see the module docs);
    /// none for any other refusal.
    pub(crate) fn sliver_remedies(
        &self,
        op: &AnchoredFold,
        plain: &PlainFold,
        refusal: &FoldRefusal,
        kind: Kind,
    ) -> Vec<SliverRemedy> {
        let FoldRefusal::Sliver { vertex, face, .. } = refusal else {
            return Vec::new();
        };
        let pins = op.line.pins();
        // A vertex the fold itself made lies on the line and lands nowhere.
        let (Some(&sheet), Some(image)) = (
            self.vertices().get(vertex.0 as usize),
            self.vertex_image(*vertex),
        ) else {
            return Vec::new();
        };
        if pins.is_empty() {
            return Vec::new();
        }
        // The line actually folded along, after snapping.
        let Ok(analysis) = self.analyse_fold(plain) else {
            return Vec::new();
        };
        let landed = Isometry::reflection(analysis.line.n, analysis.line.d).apply(image);
        let moving = moving_normal(&analysis.line, analysis.side);
        let mut out = Vec::new();
        for edge in self.sliver_edges(*face, landed) {
            for pin in &pins {
                let axiom = match *pin {
                    Pin::Through { point } => Axiom::O5 {
                        pivot: point,
                        p: sheet,
                        m1: edge,
                    },
                    Pin::Perpendicular { segment } => Axiom::O7 {
                        p: sheet,
                        m1: edge,
                        m2: segment,
                    },
                };
                let Ok(mut candidates) = self.axiom_candidates(&axiom) else {
                    continue;
                };
                candidates.retain(|c| {
                    !c.line.approx_eq(&analysis.line)
                        && c.side.is_some_and(|s| {
                            let n = moving_normal(&c.line, s);
                            n[0] * moving[0] + n[1] * moving[1] > 0.0
                        })
                });
                candidates.sort_by(|a, b| {
                    line_residual(&a.line, &analysis.line)
                        .total_cmp(&line_residual(&b.line, &analysis.line))
                });
                for candidate in candidates {
                    let Some(side) = candidate.side else {
                        continue;
                    };
                    let fold = AnchoredFold {
                        line: FoldLine::Axiom {
                            axiom: axiom.clone(),
                            root: candidate.line,
                        },
                        toward: None,
                        ..op.clone()
                    };
                    if self.anchored(&fold, kind, false).is_ok() {
                        out.push(SliverRemedy {
                            pin: *pin,
                            fold,
                            line: candidate.line,
                            side,
                        });
                        break;
                    }
                }
            }
        }
        out
    }

    /// The edges of `face` whose lines the model-frame point `landed` lies
    /// past by a sliver, beside the edge, as anchors.
    fn sliver_edges(&self, face: FaceId, landed: Point) -> Vec<SheetSegment> {
        let (Some(f), Some(t), Some(image)) =
            (self.face(face), self.isometry(face), self.face_image(face))
        else {
            return Vec::new();
        };
        let Some(centre) = convex::centroid(image) else {
            return Vec::new();
        };
        let n = f.ring.len();
        let mut out = Vec::new();
        for i in 0..n {
            let ends = [f.ring[i], f.ring[(i + 1) % n]].map(|v| self.vertices()[v.index()]);
            let [a, b] = ends.map(|p| t.apply(p));
            let Some(line) = Line::from_points(a, b) else {
                continue;
            };
            let inward = line.signed_distance(centre).signum();
            let depth = inward * line.signed_distance(landed);
            let length = (b[0] - a[0]).hypot(b[1] - a[1]);
            let along =
                ((landed[0] - a[0]) * (b[0] - a[0]) + (landed[1] - a[1]) * (b[1] - a[1])) / length;
            if depth > TOL
                && depth < MIN_FEATURE
                && along > -MIN_FEATURE
                && along < length + MIN_FEATURE
            {
                out.push(SheetSegment::new(ends[0], ends[1]));
            }
        }
        out
    }
}

/// The unit normal pointing into a line's moving side.
fn moving_normal(line: &Line, side: Side) -> Point {
    match side {
        Side::Positive => line.n,
        Side::Negative => [-line.n[0], -line.n[1]],
    }
}
