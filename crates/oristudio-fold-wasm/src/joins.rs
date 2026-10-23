//! Where a bend joins two rows of a cross-section: the brackets the layer
//! picker draws between rows (plan D14, the cross-section).
//!
//! Rows are display layers, faces joined across flat creases, so two faces in
//! different rows that share a crease share a folded one: a bend, where the
//! paper turns from one layer into the other. Where the bend's image meets the
//! fold line, the two rows are one sheet of paper, and the picker draws a
//! bracket between them there. A bend lying along the fold line joins its
//! rows all along it, at no one point, and draws none.
//!
//! A join's place is a distance along the section from its `from`, like every
//! span and interval of the engine's [`CrossSection`].

use std::collections::{BTreeMap, HashMap};

use oristudio_fold::numerics::TOL;
use oristudio_fold::{CrossSection, FaceId, State};
use serde::Serialize;

type Point = [f64; 2];

/// Two rows that one bend joins where it meets the fold line.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct SectionJoin {
    /// Row indices, `upper < lower`.
    pub upper: usize,
    pub lower: usize,
    /// The distance along the section from its `from`.
    pub at: f64,
}

/// Every join between the section's rows, ascending by rows, then along the
/// line; one per place, however many crease halves meet there.
pub fn section_joins(state: &State, section: &CrossSection) -> Vec<SectionJoin> {
    let row_of: HashMap<FaceId, usize> = section
        .rows
        .iter()
        .enumerate()
        .flat_map(|(r, row)| row.faces.iter().map(move |&f| (f, r)))
        .collect();
    // The sides of the rows' faces, by their end vertices: a side two of them
    // share is a crease between them.
    let mut sides: BTreeMap<(u32, u32), Vec<usize>> = BTreeMap::new();
    for face in state.faces() {
        let Some(&r) = row_of.get(&face.id) else {
            continue;
        };
        let n = face.ring.len();
        for i in 0..n {
            let (a, b) = (face.ring[i].0, face.ring[(i + 1) % n].0);
            sides.entry((a.min(b), a.max(b))).or_default().push(r);
        }
    }

    let along = Along::new(state, section);
    let mut joins: Vec<SectionJoin> = Vec::new();
    for crease in state.creases() {
        if !crease.kind.is_folded() {
            continue;
        }
        let [a, b] = crease.vertices.map(|v| v.0);
        let Some([r, s]) = sides
            .get(&(a.min(b), a.max(b)))
            .and_then(|rows| <[usize; 2]>::try_from(rows.as_slice()).ok())
        else {
            continue;
        };
        if r == s {
            continue;
        }
        let (Some(pa), Some(pb)) = (
            state.vertex_image(crease.vertices[0]),
            state.vertex_image(crease.vertices[1]),
        ) else {
            continue;
        };
        let Some(at) = meets(&section.line, pa, pb).map(|p| along.distance(p)) else {
            continue;
        };
        let join = SectionJoin {
            upper: r.min(s),
            lower: r.max(s),
            at,
        };
        let seen = joins.iter().any(|j| {
            j.upper == join.upper && j.lower == join.lower && (j.at - join.at).abs() <= TOL
        });
        if !seen {
            joins.push(join);
        }
    }
    joins.sort_by(|a, b| {
        (a.upper, a.lower)
            .cmp(&(b.upper, b.lower))
            .then(a.at.total_cmp(&b.at))
    });
    joins
}

/// Where the segment `a`–`b` meets the line, at one point; none when it
/// misses it or lies along it.
fn meets(line: &oristudio_geometry::Line, a: Point, b: Point) -> Option<Point> {
    let (da, db) = (line.signed_distance(a), line.signed_distance(b));
    match (da.abs() <= TOL, db.abs() <= TOL) {
        (true, true) => None,
        (true, false) => Some(a),
        (false, true) => Some(b),
        (false, false) if da * db < 0.0 => {
            let u = da / (da - db);
            Some([a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])])
        }
        (false, false) => None,
    }
}

/// Distances along the section, from its `from`, of model-frame points.
struct Along {
    view: oristudio_fold::Isometry,
    from: Point,
    direction: Option<Point>,
}

impl Along {
    fn new(state: &State, section: &CrossSection) -> Along {
        let from: Point = section.from.into();
        let to: Point = section.to.into();
        let length = (to[0] - from[0]).hypot(to[1] - from[1]);
        Along {
            view: state.view().transform(),
            from,
            direction: (length > TOL)
                .then(|| [(to[0] - from[0]) / length, (to[1] - from[1]) / length]),
        }
    }

    fn distance(&self, p: Point) -> f64 {
        let q = self.view.apply(p);
        self.direction.map_or(0.0, |u| {
            (q[0] - self.from[0]) * u[0] + (q[1] - self.from[1]) * u[1]
        })
    }
}

#[cfg(test)]
mod tests {
    use oristudio_fold::{Direction, PlainFold, Sheet, StartSide};
    use oristudio_geometry::Line;

    use super::*;

    fn line(n: Point, d: f64) -> Line {
        Line::new(n, d).unwrap_or_else(|| unreachable!())
    }

    fn fold(state: &State, line: Line, side: oristudio_fold::Side) -> State {
        state
            .fold(&PlainFold::new(line, side, Direction::Valley))
            .unwrap_or_else(|e| panic!("{e}"))
            .state
    }

    #[test]
    fn a_book_folds_two_rows_joined_at_its_bend() {
        use oristudio_fold::Side::{Negative, Positive};
        let flat = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
        // The right half over the left: two layers in x ∈ [0, 0.5], joined at
        // the bend x = 0.5.
        let book = fold(&flat, line([1.0, 0.0], 0.5), Positive);
        // Across the bend, along y = 0.5, the upper half moving: both layers
        // meet the line from x = 0 to the bend.
        let section = book
            .cross_section(&line([0.0, 1.0], 0.5), Positive)
            .unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(section.rows.len(), 2);
        let joins = section_joins(&book, &section);
        assert_eq!(joins.len(), 1, "{joins:?}");
        let join = joins[0];
        assert_eq!((join.upper, join.lower), (0, 1));
        // The bend is the far end of the section or its start, whichever way
        // the section runs; it is not the raw edges' end.
        let from: Point = section.from.into();
        let bend_end = (from[0] - 0.5).abs() < 1e-9;
        let expected = if bend_end { 0.0 } else { 0.5 };
        assert!((join.at - expected).abs() < 1e-9, "{join:?} {section:?}");

        // Along the bend itself the rows are joined all along: no bracket.
        let along = book
            .cross_section(&line([1.0, 0.0], 0.5), Negative)
            .unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(along.rows.len(), 2);
        assert!(section_joins(&book, &along).is_empty());
        // Nor where the line misses the bend.
        let beside = book
            .cross_section(&line([1.0, 0.0], 0.25), Negative)
            .unwrap_or_else(|e| panic!("{e}"));
        assert!(section_joins(&book, &beside).is_empty());
    }
}
