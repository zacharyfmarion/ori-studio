//! A partial precrease: a precrease of part of its line ℓ — a segment, or a
//! pinch — that leaves crease marks rather than creases
//! (`crate::crease_marks`).
//!
//! The line, its snap, the seed and the closure are the whole precrease's
//! (`super::closure`), so the same layers are in scope and the same
//! refusals come first. Then nothing lands. Every face of U that ℓ crosses
//! — exactly the faces the whole precrease would split — gets the part of ℓ
//! inside its image and inside the extent, taken back to the sheet, with the
//! letter the whole precrease would leave on it: valley iff the fold turns
//! the face's front toward itself, that is, the direction in the model frame
//! is valley and the face shows its front, or mountain and its back. Pieces
//! of one letter that touch along one sheet line merge (one layer crossing
//! a flat crease is one mark); pieces shorter than the minimum feature go.
//! The paper is flat again, so the faces, the order and the view are the
//! parent's. New material gets marks; an existing flat hinge has its
//! remembered letter updated only within the extent. Its endpoints may
//! subdivide a crease, but never split a face or change the layer order.
//!
//! A pinch is a crease made in place, so a tuck placement is not part of
//! it: the closure is grown as for a fold on top.
//!
//! # The extent
//!
//! Named by sheet anchors ([`Extent`]), one rule for each: a point is
//! resolved through the parent's isometries (boundaries included, so a
//! landmark on a crease or at a vertex resolves) and its image projected
//! onto the snapped ℓ. A segment runs between its two points' projections,
//! in either order; a pinch is `length` centred on its point's. An extent
//! that runs past the paper is clipped to it.

use crate::crease_marks::{self, CreaseMark, Extent};
use crate::fold::section::clip_line;
use crate::fold::{FoldReport, Folded, Placement, PlainFold, ResolvedSeed, closure::Analysis};
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::{CreaseKind, Letter};
use crate::refusal::{FoldRefusal, Refused};
use crate::state::State;
use crate::view::Direction;
use oristudio_geometry::Line;

type Point = [f64; 2];

impl State {
    /// A precrease of `extent` of its line (see the module docs): the whole
    /// line is [`State::precrease`]. A refusal that depends on the direction
    /// comes with "fold the other way" when the other direction would mark.
    pub fn precrease_extent(&self, op: &PlainFold, extent: &Extent) -> Result<Folded, Refused> {
        if extent.is_whole() {
            return self.precrease(op);
        }
        self.mark(op, extent).map_err(|refused| {
            self.with_direction_fix(op, refused, |state: &State, other: &PlainFold| {
                state.mark(other, extent)
            })
        })
    }

    fn mark(&self, op: &PlainFold, extent: &Extent) -> Result<Folded, Refused> {
        let op = PlainFold {
            placement: Placement::OnTop,
            ..op.clone()
        };
        let analysis = self.analyse(&op, &ResolvedSeed::from(&op.seed))?;
        let (line, _) = analysis.axis().line_and_side();
        let [t0, t1] = self.extent_along(&line, extent)?;
        let step = self.step() + 1;
        let marks = self.marks_within(&analysis, &line, [t0, t1], step)?;
        let state = super::partial_existing::land(self, marks, step)?;
        let public = self.public_analysis(&analysis);
        Ok(Folded {
            state,
            report: FoldReport {
                moving_faces: public.moving.clone(),
                analysis: public,
                created: Vec::new(),
                unfolded: Vec::new(),
                refolded: Vec::new(),
                split: 0,
            },
            extent: Some([line.point_at(t0), line.point_at(t1)]),
        })
    }

    /// The extent as an interval of `line`'s parameter (see the module
    /// docs).
    fn extent_along(&self, line: &Line, extent: &Extent) -> Result<[f64; 2], Refused> {
        let along = |point: Point| -> Result<f64, Refused> {
            self.resolve_point(point)
                .map(|image| line.parameter(image))
                .ok_or_else(|| FoldRefusal::ExtentOffPaper { point }.into())
        };
        let [lo, hi] = match *extent {
            Extent::Whole => [f64::NEG_INFINITY, f64::INFINITY],
            Extent::Segment { from, to } => {
                let (a, b) = (along(from)?, along(to)?);
                [a.min(b), a.max(b)]
            }
            Extent::Pinch { at, length } => {
                if length.is_nan() || length < MIN_FEATURE {
                    return Err(FoldRefusal::ExtentTooShort { length }.into());
                }
                let t = along(at)?;
                [t - length / 2.0, t + length / 2.0]
            }
        };
        if hi - lo < MIN_FEATURE {
            return Err(FoldRefusal::ExtentTooShort { length: hi - lo }.into());
        }
        Ok([lo, hi])
    }

    /// The marks the faces of U that ℓ crosses get within `[t0, t1]` of
    /// `line`, merged; refused when the extent holds no paper, or none of
    /// U's.
    fn marks_within(
        &self,
        analysis: &Analysis,
        line: &Line,
        [t0, t1]: [f64; 2],
        step: u32,
    ) -> Result<Vec<CreaseMark>, Refused> {
        let geometry = self.geometry();
        let (origin, direction) = (line.foot(), line.direction());
        let valley = analysis.direction == Direction::Valley;
        let mut paper: Vec<[f64; 2]> = Vec::new();
        let mut pieces: Vec<CreaseMark> = Vec::new();
        for (f, image) in geometry.images.iter().enumerate() {
            let Some([lo, hi]) = clip_line(image, origin, direction, 0.0) else {
                continue;
            };
            let (lo, hi) = (lo.max(t0), hi.min(t1));
            if hi - lo <= TOL {
                continue;
            }
            paper.push([lo, hi]);
            // The faces the whole precrease would split: in U, with a vertex
            // on either side of ℓ.
            if !(analysis.moving[f] && analysis.has_stationary[f]) {
                continue;
            }
            let t = geometry.isometries[f];
            let to_sheet = t.inverse();
            pieces.push(CreaseMark {
                a: to_sheet.apply(line.point_at(lo)),
                b: to_sheet.apply(line.point_at(hi)),
                letter: if valley == t.front_up() {
                    Letter::Valley
                } else {
                    Letter::Mountain
                },
                made_at: step,
            });
        }
        if covered_length(paper) < MIN_FEATURE {
            return Err(FoldRefusal::ExtentMissesPaper.into());
        }
        // An existing flat crease is already a face boundary, so neither
        // face straddles the line. It participates exactly when a full fold
        // would refold it: one incident face moves and the other stays.
        for (k, crease) in self.creases().iter().enumerate() {
            if !matches!(crease.kind, CreaseKind::Flat(_))
                || !crease
                    .vertices
                    .iter()
                    .all(|v| analysis.classified.classes[v.index()] == 0)
            {
                continue;
            }
            let [f, g] = self.topology().crease_faces[k].as_slice() else {
                continue;
            };
            if analysis.moving[*f] == analysis.moving[*g] {
                continue;
            }
            let [a, b] = crease
                .vertices
                .map(|v| line.parameter(geometry.vertex_images[v.index()]));
            let (lo, hi) = (a.min(b).max(t0), a.max(b).min(t1));
            if hi - lo <= TOL {
                continue;
            }
            let t = geometry.isometries[*f];
            let inverse = t.inverse();
            pieces.push(CreaseMark {
                a: inverse.apply(line.point_at(lo)),
                b: inverse.apply(line.point_at(hi)),
                letter: if valley == t.front_up() {
                    Letter::Valley
                } else {
                    Letter::Mountain
                },
                made_at: step,
            });
        }
        let marks: Vec<CreaseMark> = crease_marks::merge(pieces)
            .into_iter()
            .filter(|m| m.length() >= MIN_FEATURE)
            .collect();
        if marks.is_empty() {
            return Err(FoldRefusal::ExtentMissesLayers.into());
        }
        Ok(marks)
    }
}

/// The length the union of the intervals covers.
fn covered_length(mut spans: Vec<[f64; 2]>) -> f64 {
    spans.sort_by(|a, b| a[0].total_cmp(&b[0]));
    let mut total = 0.0;
    let mut reach = f64::NEG_INFINITY;
    for [lo, hi] in spans {
        let lo = lo.max(reach);
        if hi > lo {
            total += hi - lo;
        }
        reach = reach.max(hi);
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::refusal::Side;
    use crate::sheet::Sheet;
    use crate::view::StartSide;

    fn square() -> State {
        State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"))
    }

    fn x_eq(c: f64) -> Line {
        Line::new([1.0, 0.0], c).unwrap_or_else(|| unreachable!())
    }

    fn close(p: Point, q: Point) -> bool {
        (p[0] - q[0]).hypot(p[1] - q[1]) < 1e-12
    }

    #[test]
    fn intervals_cover_their_union() {
        assert_eq!(
            covered_length(vec![[0.0, 1.0], [0.5, 2.0], [3.0, 4.0]]),
            3.0
        );
        assert_eq!(covered_length(Vec::new()), 0.0);
    }

    #[test]
    fn a_pinch_on_the_flat_sheet_is_one_short_valley() {
        let s = square();
        let op = PlainFold::new(x_eq(0.5), Side::Positive, Direction::Valley);
        let pinch = Extent::Pinch {
            at: [0.5, 0.5],
            length: 0.1,
        };
        let folded = s
            .precrease_extent(&op, &pinch)
            .unwrap_or_else(|e| panic!("{e}"));
        let marks = folded.state.crease_marks();
        assert_eq!(marks.len(), 1);
        assert_eq!(marks[0].letter, Letter::Valley);
        assert_eq!(marks[0].made_at, 1);
        let mut ends = [marks[0].a, marks[0].b];
        ends.sort_by(|a, b| a[1].total_cmp(&b[1]));
        assert!(
            close(ends[0], [0.5, 0.45]) && close(ends[1], [0.5, 0.55]),
            "{ends:?}"
        );
        // Nothing else changed.
        assert_eq!(folded.state.faces(), s.faces());
        assert_eq!(folded.state.creases(), s.creases());
        assert_eq!(folded.state.step(), 1);
        assert!(folded.report.created.is_empty());
        // At an edge, the pinch is clipped to the paper.
        let edge = Extent::Pinch {
            at: [0.5, 0.0],
            length: 0.1,
        };
        let folded = s
            .precrease_extent(&op, &edge)
            .unwrap_or_else(|e| panic!("{e}"));
        assert!((folded.state.crease_marks()[0].length() - 0.05).abs() < 1e-12);
    }

    #[test]
    fn the_extent_is_refused_by_code() {
        let s = square();
        let op = PlainFold::new(x_eq(0.5), Side::Positive, Direction::Valley);
        let code = |extent: Extent| {
            s.precrease_extent(&op, &extent)
                .err()
                .map(|e| e.refusal.code())
        };
        assert_eq!(
            code(Extent::Pinch {
                at: [0.5, 0.5],
                length: MIN_FEATURE / 2.0
            }),
            Some("extent_too_short")
        );
        assert_eq!(
            code(Extent::Pinch {
                at: [0.5, 0.5],
                length: f64::NAN
            }),
            Some("extent_too_short")
        );
        assert_eq!(
            code(Extent::Segment {
                from: [0.2, 0.3],
                to: [0.8, 0.3]
            }),
            Some("extent_too_short")
        );
        assert_eq!(
            code(Extent::Pinch {
                at: [1.5, 0.5],
                length: 0.1
            }),
            Some("extent_off_paper")
        );
        // A line across the corner, x + y = 0.2, and a segment named by
        // points whose projections fall beyond its chord: no paper there.
        let corner = Line::new([1.0, 1.0], 0.2).unwrap_or_else(|| unreachable!());
        let across = PlainFold::new(corner, Side::Negative, Direction::Valley);
        let beyond = Extent::Segment {
            from: [0.9, 0.1],
            to: [0.9, 0.5],
        };
        assert_eq!(
            s.precrease_extent(&across, &beyond)
                .err()
                .map(|e| e.refusal.code()),
            Some("extent_misses_paper")
        );
        // A crease already there is also a valid place to pinch.
        let creased = s.precrease(&op).unwrap_or_else(|e| panic!("{e}")).state;
        let again = creased.precrease_extent(
            &op,
            &Extent::Pinch {
                at: [0.5, 0.5],
                length: 0.1,
            },
        );
        assert!(again.is_ok(), "{again:?}");
    }
}
