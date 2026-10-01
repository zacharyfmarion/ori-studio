//! A document's auxiliary lines, carried onto a 3D figure.
//!
//! **Ori Studio native.** An auxiliary (`Cyan3`) line is drawn on the paper
//! and folded by nothing, so the fold never sees one: the admission takes
//! only folding-colour creases. What a figure shows of the document's aux
//! lines is therefore a picture of its paper with them drawn on, and it can
//! be asked for again whenever they change — no refold, and nothing about
//! the placement, the cells or the ordering moves.
//!
//! Each line is clipped to every face of the unfolded sheet
//! ([`Polygon::clip_segment`]), and each piece is placed by that face's
//! rigid transform — the map that placed the face's own ring
//! ([`Placement3d::face_points`]) — so a piece lies on its face by
//! construction. Which layer of a cell a piece belongs to, and so when it is
//! seen, is the renderer's: it is the face's slot in the cell's stack, the
//! same rule a crease is drawn by.

use serde::{Deserialize, Serialize};

use crate::folding3d::placement::{Placement3d, point3};
use crate::geometry::{LineColor, LineSegment, Point, Polygon};

/// The document's aux lines on a 3D figure, one piece per face crossed.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Folded3dAuxLines {
    /// The render model's face each piece lies on.
    pub faces: Vec<u32>,
    /// `ax, ay, az, bx, by, bz` per piece, in the render model's coordinates.
    pub points: Vec<f64>,
}

impl Folded3dAuxLines {
    /// How many pieces there are.
    pub fn len(&self) -> usize {
        self.faces.len()
    }

    pub fn is_empty(&self) -> bool {
        self.faces.is_empty()
    }
}

/// The `Cyan3` lines of `segments` carried onto `placement`'s faces.
pub fn folded3d_aux_lines(placement: &Placement3d, segments: &[LineSegment]) -> Folded3dAuxLines {
    let mut lines = segments
        .iter()
        .filter(|segment| segment.color == LineColor::Cyan3)
        .peekable();
    let mut out = Folded3dAuxLines::default();
    if lines.peek().is_none() {
        return out;
    }
    // Every face's sheet polygon and its box, once: a line is clipped against
    // a face only when their boxes meet.
    let faces: Vec<(Polygon, (Point, Point))> = placement
        .rings
        .iter()
        .map(|ring| {
            let polygon = Polygon::new(
                ring.iter()
                    .filter_map(|&index| placement.points.get(index).copied())
                    .collect(),
            );
            let bounds = bounds_of(polygon.vertices.iter().copied());
            (polygon, bounds)
        })
        .collect();
    for line in lines {
        let line_bounds = bounds_of([line.a, line.b].into_iter());
        for (face, (polygon, bounds)) in faces.iter().enumerate() {
            if !meet(*bounds, line_bounds) {
                continue;
            }
            let Some(transform) = placement.face_transforms.get(face) else {
                continue;
            };
            for piece in polygon.clip_segment(line) {
                out.faces.push(face as u32);
                out.points
                    .extend_from_slice(&transform.apply(point3(piece.a)));
                out.points
                    .extend_from_slice(&transform.apply(point3(piece.b)));
            }
        }
    }
    out
}

/// `(min, max)` of some points, widened by the point tolerance so a line
/// touching a face's outline is never skipped.
fn bounds_of(points: impl Iterator<Item = Point>) -> (Point, Point) {
    let mut min = Point::new(f64::INFINITY, f64::INFINITY);
    let mut max = Point::new(f64::NEG_INFINITY, f64::NEG_INFINITY);
    for point in points {
        min = Point::new(min.x.min(point.x), min.y.min(point.y));
        max = Point::new(max.x.max(point.x), max.y.max(point.y));
    }
    let slack = crate::geometry::Epsilon::POINT;
    (
        Point::new(min.x - slack, min.y - slack),
        Point::new(max.x + slack, max.y + slack),
    )
}

fn meet(a: (Point, Point), b: (Point, Point)) -> bool {
    a.0.x <= b.1.x && b.0.x <= a.1.x && a.0.y <= b.1.y && b.0.y <= a.1.y
}
