//! Crease marks: partial creases, what a partial precrease leaves (a pinch,
//! or a stretch of its line; the fold op is `fold::partial`).
//!
//! A crease mark is a real flat crease on the paper: it keeps a letter,
//! front-relative like the letter a flat crease remembers (research §3.1).
//! It may end inside the paper, so it need not bound a face. Imported cyan
//! lines use the same representation, including full lines. It therefore
//! lives in the state beside the face
//! graph ([`StateParts::marks`]), never in it — no vertex, no edge, no split
//! face — and it changes no layer order and no flat-foldability.
//!
//! Sheet coordinates never move, so every later operation carries a mark
//! unchanged ([`carry`]), with one exception: a crease made along a mark's
//! line **subsumes** the part of the mark it covers, which is dropped, so
//! nothing is drawn twice. A newer mark subsumes an older one's covered part
//! the same way. Whatever is left shorter than the minimum feature goes.
//!
//! [`State::make`](crate::State::make) checks every mark ([`check`]): finite
//! ends on the sheet, at least the minimum feature long, along no crease and
//! overlapping no other mark.
//!
//! # The default pinch
//!
//! A pinch is [`PINCH_FRACTION`] of the sheet's shorter side long
//! ([`default_pinch_length`]): about a centimetre on a 15 cm square, the
//! length a folder's thumbnail makes, short enough to sit between the
//! landmarks of a 16-grid and long enough to see and snap to. The step
//! stores the length it was made with, so replay never depends on this
//! default.

use oristudio_geometry::convex;
use serde::{Deserialize, Serialize};

use crate::anchor::SheetSegment;
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::{Crease, CreaseKind, Letter};
use crate::refusal::FoldRefusal;
use crate::sheet::Sheet;
use crate::state::{State, StateParts};

type Point = [f64; 2];

/// The default pinch, as a fraction of the sheet's shorter side.
pub const PINCH_FRACTION: f64 = 1.0 / 16.0;

/// A partial crease on the paper (see the module docs).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CreaseMark {
    /// Its ends, in sheet coordinates.
    pub a: Point,
    pub b: Point,
    /// Front-relative: valley iff the paper's front was folded toward itself.
    pub letter: Letter,
    /// The step that made it.
    pub made_at: u32,
}

impl CreaseMark {
    pub fn segment(&self) -> SheetSegment {
        SheetSegment::new(self.a, self.b)
    }

    pub fn length(&self) -> f64 {
        distance(self.a, self.b)
    }

    /// The point a fraction `u` of the way from `a` to `b`.
    pub fn at(&self, u: f64) -> Point {
        lerp(self.a, self.b, u)
    }

    /// The part from fraction `u0` to `u1`.
    fn part(&self, u0: f64, u1: f64) -> CreaseMark {
        CreaseMark {
            a: self.at(u0),
            b: self.at(u1),
            ..*self
        }
    }
}

/// How much of a precrease's line it creases. Anchors are sheet points, as
/// every input a step stores (plan D6): each is resolved through the parent's
/// isometries and its image projected onto the located line, one rule for a
/// segment's ends and a pinch's centre.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum Extent {
    /// All of it: the precrease folds and unfolds, its creases flat creases.
    #[default]
    Whole,
    /// Between the two points' projections onto the line, in either order.
    Segment { from: Point, to: Point },
    /// `length` (sheet units) centred on the point's projection onto the
    /// line.
    Pinch { at: Point, length: f64 },
}

impl Extent {
    pub fn is_whole(&self) -> bool {
        matches!(self, Extent::Whole)
    }
}

/// The default pinch length on `sheet`: [`PINCH_FRACTION`] of its bounding
/// box's shorter side.
pub fn default_pinch_length(sheet: &Sheet) -> f64 {
    let [x0, y0, x1, y1] = convex::bounding_box(sheet.outline());
    PINCH_FRACTION * (x1 - x0).min(y1 - y0)
}

/// One crease mark's part on one face: what the scene and the landmarks draw
/// and snap to.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct MarkPiece {
    /// The mark's index.
    pub(crate) mark: usize,
    /// The face's position.
    pub(crate) face: usize,
    /// Fractions of the way along the mark, ascending.
    pub(crate) span: [f64; 2],
}

impl State {
    /// The crease marks: partial creases, in the order they were made (a
    /// subsumed mark's remaining parts in its place, in order along it).
    pub fn crease_marks(&self) -> &[CreaseMark] {
        &self.parts().marks
    }

    /// Every mark's parts on the faces it crosses, by mark and then by
    /// face position: a later fold that split a face under a mark leaves it
    /// one part per face, each mapped by its own face's isometry.
    pub(crate) fn mark_pieces(&self) -> Vec<MarkPiece> {
        let marks = self.crease_marks();
        if marks.is_empty() {
            return Vec::new();
        }
        let polygons: Vec<Vec<Point>> = (0..self.faces().len())
            .map(|f| self.sheet_polygon(f))
            .collect();
        let boxes: Vec<[f64; 4]> = polygons.iter().map(|p| convex::bounding_box(p)).collect();
        let mut out = Vec::new();
        for (mark, m) in marks.iter().enumerate() {
            let bounds = convex::bounding_box(&[m.a, m.b]);
            for (face, polygon) in polygons.iter().enumerate() {
                if !convex::boxes_overlap(&bounds, &boxes[face], TOL) {
                    continue;
                }
                if let Some(span) = span_inside(m.a, m.b, polygon) {
                    out.push(MarkPiece { mark, face, span });
                }
            }
        }
        out
    }
}

/// The part of the segment `a`–`b` inside a counter-clockwise convex
/// polygon, as fractions of the way along it; none when that is no longer
/// than the tolerance.
pub(crate) fn span_inside(a: Point, b: Point, polygon: &[Point]) -> Option<[f64; 2]> {
    let (mut u0, mut u1) = (0.0_f64, 1.0_f64);
    for i in 0..polygon.len() {
        let Some(plane) = convex::HalfPlane::left_of(polygon[i], polygon[(i + 1) % polygon.len()])
        else {
            continue;
        };
        let (da, db) = (plane.signed_distance(a), plane.signed_distance(b));
        if da < 0.0 && db < 0.0 {
            return None;
        }
        if da < 0.0 {
            u0 = u0.max(da / (da - db));
        } else if db < 0.0 {
            u1 = u1.min(da / (da - db));
        }
    }
    ((u1 - u0) * distance(a, b) > TOL).then_some([u0, u1])
}

/// Every mark valid on its parts (see the module docs), each refusal naming
/// the mark by its index.
pub(crate) fn check(parts: &StateParts) -> Result<(), FoldRefusal> {
    let marks = &parts.marks;
    if marks.is_empty() {
        return Ok(());
    }
    for (mark, m) in marks.iter().enumerate() {
        // A NaN coordinate compares as inside, so finiteness comes first.
        let on = |p: Point| p[0].is_finite() && p[1].is_finite() && parts.sheet.contains(p, -TOL);
        if !(on(m.a) && on(m.b)) {
            return Err(FoldRefusal::MarkOffSheet { mark });
        }
        let length = m.length();
        if length < MIN_FEATURE {
            return Err(FoldRefusal::MarkTooShort { mark, length });
        }
    }
    let boxes: Vec<[f64; 4]> = marks
        .iter()
        .map(|m| convex::bounding_box(&[m.a, m.b]))
        .collect();
    for crease in parts.creases.iter() {
        let [a, b] = crease.vertices.map(|v| parts.vertices[v.index()]);
        let bounds = convex::bounding_box(&[a, b]);
        for (mark, m) in marks.iter().enumerate() {
            if convex::boxes_overlap(&boxes[mark], &bounds, TOL) && covered(m, a, b).is_some() {
                return Err(FoldRefusal::MarkOnCrease {
                    mark,
                    edge: crease.id,
                });
            }
        }
    }
    for (i, m) in marks.iter().enumerate() {
        for (j, n) in marks.iter().enumerate().skip(i + 1) {
            if convex::boxes_overlap(&boxes[i], &boxes[j], TOL) && covered(m, n.a, n.b).is_some() {
                return Err(FoldRefusal::MarksOverlap { marks: [i, j] });
            }
        }
    }
    Ok(())
}

/// The marks a state built from `vertices` and `creases` carries from its
/// parent's `marks`: each less the parts its creases cover (a fold along a
/// mark's line subsumes it), keeping what is left at least the minimum
/// feature long, in order.
pub(crate) fn carry(
    marks: &[CreaseMark],
    vertices: &[Point],
    creases: &[Crease],
) -> Vec<CreaseMark> {
    if marks.is_empty() {
        return Vec::new();
    }
    let segments: Vec<[Point; 2]> = creases
        .iter()
        .filter(|c| c.kind != CreaseKind::Border)
        .map(|c| c.vertices.map(|v| vertices[v.index()]))
        .collect();
    marks
        .iter()
        .flat_map(|m| subtract(m, segments.iter().copied()))
        .collect()
}

/// `older` less the parts the `newer` marks cover, then `newer`: what a
/// partial precrease's marks leave beside the ones before them.
pub(crate) fn add(older: &[CreaseMark], newer: Vec<CreaseMark>) -> Vec<CreaseMark> {
    let covering: Vec<[Point; 2]> = newer.iter().map(|m| [m.a, m.b]).collect();
    let mut out: Vec<CreaseMark> = older
        .iter()
        .flat_map(|m| subtract(m, covering.iter().copied()))
        .collect();
    out.extend(newer);
    out
}

/// `mark` less the parts the collinear `segments` cover: its remaining
/// parts at least the minimum feature long, in order along it.
fn subtract(mark: &CreaseMark, segments: impl Iterator<Item = [Point; 2]>) -> Vec<CreaseMark> {
    let bounds = convex::bounding_box(&[mark.a, mark.b]);
    let mut cut: Vec<[f64; 2]> = segments
        .filter(|[a, b]| convex::boxes_overlap(&bounds, &convex::bounding_box(&[*a, *b]), TOL))
        .filter_map(|[a, b]| covered(mark, a, b))
        .collect();
    if cut.is_empty() {
        return vec![*mark];
    }
    cut.sort_by(|x, y| x[0].total_cmp(&y[0]));
    let length = mark.length();
    let mut out = Vec::new();
    let mut from = 0.0_f64;
    for [u0, u1] in cut {
        if (u0 - from) * length >= MIN_FEATURE {
            out.push(mark.part(from, u0));
        }
        from = from.max(u1);
    }
    if (1.0 - from) * length >= MIN_FEATURE {
        out.push(mark.part(from, 1.0));
    }
    out
}

/// The part of `mark` the segment `a`–`b` covers, as fractions of the way
/// along it, ascending: none unless the segment lies along the mark's line
/// (both its ends within the tolerance of it) and overlaps the mark by more
/// than the tolerance. The one predicate [`check`], [`carry`] and [`add`]
/// share, so whatever they cut passes the check.
pub(crate) fn covered(mark: &CreaseMark, a: Point, b: Point) -> Option<[f64; 2]> {
    let length = mark.length();
    if length == 0.0 {
        return None;
    }
    let d = [
        (mark.b[0] - mark.a[0]) / length,
        (mark.b[1] - mark.a[1]) / length,
    ];
    let off = |p: Point| ((p[0] - mark.a[0]) * d[1] - (p[1] - mark.a[1]) * d[0]).abs();
    if off(a) > TOL || off(b) > TOL {
        return None;
    }
    let along = |p: Point| ((p[0] - mark.a[0]) * d[0] + (p[1] - mark.a[1]) * d[1]) / length;
    let (ta, tb) = (along(a), along(b));
    let (lo, hi) = (ta.min(tb).max(0.0), ta.max(tb).min(1.0));
    ((hi - lo) * length > TOL).then_some([lo, hi])
}

/// Pieces of one step, merged where two of one letter lie on one line and
/// touch or overlap: a mark across several faces of one layer is one mark.
pub(crate) fn merge(mut pieces: Vec<CreaseMark>) -> Vec<CreaseMark> {
    let mut merged = true;
    while merged {
        merged = false;
        'search: for i in 0..pieces.len() {
            for j in i + 1..pieces.len() {
                if let Some(joined) = join(&pieces[i], &pieces[j]) {
                    pieces[i] = joined;
                    pieces.remove(j);
                    merged = true;
                    break 'search;
                }
            }
        }
    }
    pieces
}

/// The one mark `p` and `q` make together, when they have one letter, lie on
/// one line and touch or overlap.
fn join(p: &CreaseMark, q: &CreaseMark) -> Option<CreaseMark> {
    if p.letter != q.letter || p.made_at != q.made_at {
        return None;
    }
    let length = p.length();
    if length == 0.0 {
        return None;
    }
    let d = [(p.b[0] - p.a[0]) / length, (p.b[1] - p.a[1]) / length];
    let off = |x: Point| ((x[0] - p.a[0]) * d[1] - (x[1] - p.a[1]) * d[0]).abs();
    if off(q.a) > TOL || off(q.b) > TOL {
        return None;
    }
    let along = |x: Point| (x[0] - p.a[0]) * d[0] + (x[1] - p.a[1]) * d[1];
    let (ta, tb) = (along(q.a), along(q.b));
    let (lo, hi) = (ta.min(tb), ta.max(tb));
    if lo > length + TOL || hi < -TOL {
        return None;
    }
    let ends = [(0.0, p.a), (length, p.b), (ta, q.a), (tb, q.b)];
    let first = ends
        .iter()
        .min_by(|x, y| x.0.total_cmp(&y.0))
        .map(|e| e.1)?;
    let last = ends
        .iter()
        .max_by(|x, y| x.0.total_cmp(&y.0))
        .map(|e| e.1)?;
    Some(CreaseMark {
        a: first,
        b: last,
        ..*p
    })
}

fn distance(a: Point, b: Point) -> f64 {
    (b[0] - a[0]).hypot(b[1] - a[1])
}

fn lerp(a: Point, b: Point, u: f64) -> Point {
    [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pattern::{EdgeId, VertexId};
    use crate::view::StartSide;

    fn mark(a: Point, b: Point) -> CreaseMark {
        CreaseMark {
            a,
            b,
            letter: Letter::Valley,
            made_at: 1,
        }
    }

    fn close(p: Point, q: Point) -> bool {
        distance(p, q) < 1e-12
    }

    #[test]
    fn the_default_pinch_is_a_sixteenth_of_the_shorter_side() {
        assert_eq!(default_pinch_length(&Sheet::square()), 1.0 / 16.0);
        let tall = Sheet::rectangle(1.0, 2f64.sqrt()).unwrap_or_else(|e| panic!("{e}"));
        assert!((default_pinch_length(&tall) - 0.5f64.sqrt() / 16.0).abs() < 1e-15);
    }

    #[test]
    fn a_covering_segment_cuts_its_part_out() {
        let m = mark([0.0, 0.5], [0.4, 0.5]);
        let near = |got: Option<[f64; 2]>, want: [f64; 2]| {
            got.is_some_and(|[a, b]| (a - want[0]).abs() < 1e-12 && (b - want[1]).abs() < 1e-12)
        };
        // A crease along the line over the middle half.
        assert!(near(covered(&m, [0.1, 0.5], [0.3, 0.5]), [0.25, 0.75]));
        // Reversed, and running past an end.
        assert!(near(covered(&m, [0.6, 0.5], [0.2, 0.5]), [0.5, 1.0]));
        // Off the line, across it, or only touching an end: nothing.
        assert_eq!(covered(&m, [0.1, 0.5 + 1e-5], [0.3, 0.5 + 1e-5]), None);
        assert_eq!(covered(&m, [0.2, 0.0], [0.2, 1.0]), None);
        assert_eq!(covered(&m, [0.4, 0.5], [0.9, 0.5]), None);
        let parts = subtract(&m, [[[0.1, 0.5], [0.3, 0.5]]].into_iter());
        assert_eq!(parts.len(), 2);
        assert!(close(parts[0].a, [0.0, 0.5]) && close(parts[0].b, [0.1, 0.5]));
        assert!(close(parts[1].a, [0.3, 0.5]) && close(parts[1].b, [0.4, 0.5]));
        // What is left shorter than the minimum feature goes.
        let parts = subtract(&m, [[[MIN_FEATURE / 2.0, 0.5], [0.5, 0.5]]].into_iter());
        assert!(parts.is_empty(), "{parts:?}");
    }

    #[test]
    fn touching_pieces_of_one_letter_on_one_line_merge() {
        let pieces = vec![
            mark([0.0, 0.5], [0.25, 0.5]),
            mark([0.5, 0.5], [0.75, 0.5]),
            mark([0.5, 0.5], [0.25, 0.5]),
            CreaseMark {
                letter: Letter::Mountain,
                ..mark([0.75, 0.5], [1.0, 0.5])
            },
            mark([0.5, 0.0], [0.5, 0.25]),
        ];
        let merged = merge(pieces);
        assert_eq!(merged.len(), 3, "{merged:?}");
        assert!(close(merged[0].a, [0.0, 0.5]) && close(merged[0].b, [0.75, 0.5]));
        assert_eq!(merged[1].letter, Letter::Mountain);
    }

    #[test]
    fn the_check_names_the_mark() {
        let flat = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
        let with = |marks: Vec<CreaseMark>| {
            let mut parts = flat.parts().clone();
            parts.marks = marks;
            State::make(parts).map(|_| ()).err()
        };
        assert_eq!(with(vec![mark([0.2, 0.5], [0.8, 0.5])]), None);
        assert_eq!(
            with(vec![mark([0.2, 0.5], [1.2, 0.5])]),
            Some(FoldRefusal::MarkOffSheet { mark: 0 })
        );
        assert_eq!(
            with(vec![mark([0.2, 0.5], [f64::NAN, 0.5])]),
            Some(FoldRefusal::MarkOffSheet { mark: 0 })
        );
        assert!(matches!(
            with(vec![mark([0.2, 0.5], [0.2 + MIN_FEATURE / 2.0, 0.5])]),
            Some(FoldRefusal::MarkTooShort { mark: 0, .. })
        ));
        // Along the border's bottom edge.
        assert_eq!(
            with(vec![mark([0.2, 0.0], [0.6, 0.0])]),
            Some(FoldRefusal::MarkOnCrease {
                mark: 0,
                edge: EdgeId(0)
            })
        );
        assert_eq!(
            with(vec![
                mark([0.5, 0.1], [0.5, 0.3]),
                mark([0.2, 0.5], [0.8, 0.5]),
                mark([0.6, 0.5], [0.9, 0.5]),
            ]),
            Some(FoldRefusal::MarksOverlap { marks: [1, 2] })
        );
        // End to end is no overlap.
        assert_eq!(
            with(vec![
                mark([0.2, 0.5], [0.6, 0.5]),
                mark([0.6, 0.5], [0.9, 0.5])
            ]),
            None
        );
    }

    #[test]
    fn carrying_drops_only_what_a_crease_covers() {
        let vertices = vec![[0.0, 0.5], [1.0, 0.5], [0.3, 0.0], [0.3, 1.0]];
        let crease = |id: u32, a: u32, b: u32| Crease {
            id: EdgeId(id),
            vertices: [VertexId(a), VertexId(b)],
            kind: CreaseKind::Folded(Letter::Valley),
            made_at: 2,
        };
        let marks = [mark([0.2, 0.5], [0.6, 0.5]), mark([0.6, 0.2], [0.6, 0.8])];
        // y = 0.5 covers the first; x = 0.3 crosses both and covers neither.
        let carried = carry(&marks, &vertices, &[crease(0, 0, 1), crease(1, 2, 3)]);
        assert_eq!(carried, vec![marks[1]]);
        let carried = carry(&marks, &vertices, &[crease(1, 2, 3)]);
        assert_eq!(carried, marks.to_vec());
        // A newer mark over part of an older one keeps the older's rest.
        let newer = mark([0.4, 0.5], [0.9, 0.5]);
        let both = add(&marks, vec![newer]);
        assert_eq!(both.len(), 3);
        assert!(close(both[0].a, [0.2, 0.5]) && close(both[0].b, [0.4, 0.5]));
        assert_eq!(both[2], newer);
    }
}
