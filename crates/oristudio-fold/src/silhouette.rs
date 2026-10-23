//! The folded silhouette as a [`Paper`] (plan D9, Phase 3): what a
//! Huzita–Justin construction folds once the sheet is no longer flat.
//!
//! The silhouette is the union of the face images in the model frame. Each
//! image is convex, the union often is not (a flap folded out past the body
//! leaves a notch), so a line can meet the paper in several runs. The three
//! questions the construction filters ask are answered face by face:
//!
//! - **contains**: some image holds the point, padded;
//! - **intervals**: each image's interval along the line, clipped exactly as
//!   the rectangle [`oristudio_geometry::Sheet`] clips (a line parallel to an
//!   edge within rounding is in or out by the tolerance), then merged where
//!   they touch within the tolerance, so faces split by a crease the line
//!   crosses give one run;
//! - **crosses**: the trait's default, a run longer than the tolerance.
//!
//! On a flat sheet the union is the sheet, and the answers agree with the
//! rectangle's however many precreases split it (the tests compare them).

use oristudio_geometry::convex::{self, HalfPlane};
use oristudio_geometry::{Line, Paper};

use crate::numerics::TOL;
use crate::state::State;

type Point = [f64; 2];

/// A slope below which a line is parallel to an edge: the rectangle's own
/// threshold (`oristudio_geometry::Sheet::clip_parameters`), so a line
/// constructed through an edge's end points runs along it rather than
/// crossing it at a point set by rounding.
const PARALLEL: f64 = 1e-15;

/// The union of a state's face images, borrowed from the state.
#[derive(Debug, Clone, Copy)]
pub struct Silhouette<'s> {
    images: &'s [Vec<Point>],
    boxes: &'s [[f64; 4]],
}

impl State {
    /// The folded form as paper for the axiom constructions, in the model
    /// frame.
    pub fn silhouette(&self) -> Silhouette<'_> {
        let geometry = self.geometry();
        Silhouette {
            images: &geometry.images,
            boxes: &geometry.boxes,
        }
    }
}

impl Paper for Silhouette<'_> {
    fn contains(&self, p: Point, pad: f64) -> bool {
        let point = [p[0], p[1], p[0], p[1]];
        self.images.iter().zip(self.boxes).any(|(image, b)| {
            convex::boxes_overlap(b, &point, pad.max(0.0)) && holds(image, p, pad)
        })
    }

    fn intervals(&self, line: &Line) -> impl Iterator<Item = (f64, f64)> {
        let runs: Vec<(f64, f64)> = self
            .images
            .iter()
            .zip(self.boxes)
            .filter(|(_, b)| reaches(b, line))
            .filter_map(|(image, _)| interval(image, line))
            .collect();
        merge(runs).into_iter()
    }
}

/// Whether a counter-clockwise convex polygon holds `p` padded by `pad`:
/// within `pad` outside every edge's line.
fn holds(polygon: &[Point], p: Point, pad: f64) -> bool {
    let mut any = false;
    for i in 0..polygon.len() {
        let Some(plane) = HalfPlane::left_of(polygon[i], polygon[(i + 1) % polygon.len()]) else {
            continue;
        };
        any = true;
        if plane.signed_distance(p) < -pad {
            return false;
        }
    }
    any
}

/// Whether `line` comes within the tolerance of a box.
fn reaches(b: &[f64; 4], line: &Line) -> bool {
    let corners = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
    let d = corners.map(|c| line.signed_distance(c));
    !(d.iter().all(|&x| x > TOL) || d.iter().all(|&x| x < -TOL))
}

/// The parameter interval of `line` (see [`Line::parameter`]) inside a
/// counter-clockwise convex polygon; none when it misses. A line touching the
/// polygon at a point gives a degenerate interval, as the rectangle's clip
/// does.
fn interval(polygon: &[Point], line: &Line) -> Option<(f64, f64)> {
    let foot = line.foot();
    let dir = line.direction();
    let (mut t0, mut t1) = (f64::NEG_INFINITY, f64::INFINITY);
    let mut any = false;
    for i in 0..polygon.len() {
        let Some(plane) = HalfPlane::left_of(polygon[i], polygon[(i + 1) % polygon.len()]) else {
            continue;
        };
        any = true;
        let s0 = plane.signed_distance(foot);
        let k = plane.normal()[0] * dir[0] + plane.normal()[1] * dir[1];
        if k.abs() < PARALLEL {
            if s0 < -TOL {
                return None;
            }
            continue;
        }
        let t = -s0 / k;
        if k > 0.0 {
            t0 = t0.max(t);
        } else {
            t1 = t1.min(t);
        }
    }
    // A polygon with positive area bounds the line in both directions.
    if !any || !t0.is_finite() || !t1.is_finite() || t0 > t1 + TOL {
        return None;
    }
    Some((t0, t1.max(t0)))
}

/// Intervals merged where they overlap or touch within the tolerance,
/// ascending.
fn merge(mut runs: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
    runs.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut out: Vec<(f64, f64)> = Vec::with_capacity(runs.len());
    for (t0, t1) in runs {
        match out.last_mut() {
            Some(last) if t0 <= last.1 + TOL => last.1 = last.1.max(t1),
            _ => out.push((t0, t1)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fold::PlainFold;
    use crate::refusal::Side;
    use crate::sheet::Sheet;
    use crate::view::{Direction, StartSide};
    use oristudio_geometry::Sheet as Rectangle;

    fn line(n: Point, d: f64) -> Line {
        Line::new(n, d).unwrap_or_else(|| unreachable!())
    }

    fn flat(sheet: Sheet) -> State {
        State::flat(sheet, StartSide::Front).unwrap_or_else(|e| panic!("{e}"))
    }

    fn fold(state: &State, line: Line, side: Side) -> State {
        let op = PlainFold::new(line, side, Direction::Valley);
        state.fold(&op).unwrap_or_else(|e| panic!("{e}")).state
    }

    fn precrease(state: &State, line: Line, side: Side) -> State {
        let op = PlainFold::new(line, side, Direction::Valley);
        state.precrease(&op).unwrap_or_else(|e| panic!("{e}")).state
    }

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> f64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    /// The flat sheet, precreased or not, answers as the rectangle does.
    #[test]
    fn a_flat_sheet_is_the_rectangle() {
        let cases = [
            (flat(Sheet::square()), Rectangle::unit_square()),
            (
                flat(Sheet::rectangle(1.0, 0.6).unwrap_or_else(|e| panic!("{e}"))),
                Rectangle::new(1.0, 0.6).unwrap_or_else(|| unreachable!()),
            ),
            (
                precrease(
                    &precrease(
                        &flat(Sheet::square()),
                        Line::from_points([0.0, 0.0], [1.0, 1.0]).unwrap_or_else(|| unreachable!()),
                        Side::Positive,
                    ),
                    line([0.0, 1.0], 0.3),
                    Side::Positive,
                ),
                Rectangle::unit_square(),
            ),
        ];
        let mut rng = Rng(0x5eed_1234);
        for (state, rectangle) in &cases {
            let paper = state.silhouette();
            for _ in 0..2000 {
                let p = [rng.next() * 1.4 - 0.2, rng.next() * 1.4 - 0.2];
                let angle = rng.next() * std::f64::consts::PI;
                let Some(l) = Line::from_point_direction(p, [angle.cos(), angle.sin()]) else {
                    continue;
                };
                assert_eq!(paper.contains(p, TOL), rectangle.contains(p, TOL), "{p:?}");
                assert_eq!(paper.crosses(&l), rectangle.crosses(&l), "{l:?}");
                let ours: Vec<(f64, f64)> = paper.intervals(&l).collect();
                let theirs: Vec<(f64, f64)> = rectangle.intervals(&l).collect();
                assert_eq!(ours.len(), theirs.len(), "{l:?}: {ours:?} {theirs:?}");
                for (a, b) in ours.iter().zip(&theirs) {
                    assert!((a.0 - b.0).abs() < 1e-12 && (a.1 - b.1).abs() < 1e-12);
                }
            }
            // Lines along the sheet's edges and through its corners.
            for l in [
                line([1.0, 0.0], 0.0),
                line([0.0, 1.0], 0.0),
                Line::from_points([0.0, 0.0], [1.0, -1.0]).unwrap_or_else(|| unreachable!()),
            ] {
                assert_eq!(paper.crosses(&l), rectangle.crosses(&l), "{l:?}");
            }
        }
    }

    /// A flap folded out past the body leaves a notch: a line through it
    /// meets the paper twice, and a point in it is off the paper.
    #[test]
    fn a_notched_silhouette_has_two_runs() {
        let strip = flat(Sheet::rectangle(1.0, 0.5).unwrap_or_else(|e| panic!("{e}")));
        // y = x − 0.25: the left end, (x, y) ↦ (y + 0.25, x − 0.25), swings
        // down to x ∈ [0.25, 0.75], y ∈ [−0.25, x − 0.25]. The body keeps
        // x ∈ [0.25, 1] under the line, so x ∈ [0.75, 1], y < 0 is a notch.
        let diagonal =
            Line::from_points([0.25, 0.0], [0.75, 0.5]).unwrap_or_else(|| unreachable!());
        let side = Side::of_point(&diagonal, [0.1, 0.25]).unwrap_or_else(|| unreachable!());
        let s = fold(&strip, diagonal, side);
        let paper = s.silhouette();
        assert!(paper.contains([0.5, -0.1], TOL));
        assert!(!paper.contains([0.875, -0.1], TOL));
        assert!(paper.contains([0.875, 0.1], TOL));
        // Across the notch: the swung end, then the body.
        let across = Line::from_points([0.5, -0.2], [0.9, 0.0]).unwrap_or_else(|| unreachable!());
        let runs: Vec<_> = paper.intervals(&across).collect();
        assert_eq!(runs.len(), 2, "{runs:?}");
        assert!(paper.crosses(&across));
        // x = 0.5 crosses the swung end and the body under the line as one
        // run, y ∈ [−0.25, 0.25], merged across the two faces.
        let vertical: Vec<_> = paper.intervals(&line([1.0, 0.0], 0.5)).collect();
        assert_eq!(vertical.len(), 1, "{vertical:?}");
        let (t0, t1) = vertical[0];
        let ends = [
            line([1.0, 0.0], 0.5).point_at(t0)[1],
            line([1.0, 0.0], 0.5).point_at(t1)[1],
        ];
        let (lo, hi) = (ends[0].min(ends[1]), ends[0].max(ends[1]));
        assert!(
            (lo + 0.25).abs() < 1e-12 && (hi - 0.25).abs() < 1e-12,
            "{lo} {hi}"
        );
    }

    #[test]
    fn runs_merge_across_the_faces_a_line_crosses() {
        let s = precrease(
            &flat(Sheet::square()),
            line([1.0, 0.0], 0.5),
            Side::Positive,
        );
        assert_eq!(s.faces().len(), 2);
        let runs: Vec<_> = s.silhouette().intervals(&line([0.0, 1.0], 0.5)).collect();
        assert_eq!(runs.len(), 1);
        assert!((runs[0].1 - runs[0].0 - 1.0).abs() < 1e-12);
    }
}
