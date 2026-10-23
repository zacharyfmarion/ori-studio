//! The imported crease pattern as a planar graph, and its faces (plan D16
//! step 5, D10's inverse).
//!
//! 1. Endpoints within the tolerance are one vertex.
//! 2. Every segment is split where another one's end lies on it (a T or a
//!    collinear overlap) and where two cross; a crossing within the
//!    tolerance of a vertex is that vertex.
//! 3. Pieces between the same two vertices are one edge: the border wins over
//!    a crease drawn along it, equal kinds merge, and two different creases
//!    are refused.
//! 4. A vertex between two collinear edges of one kind is dropped, joining
//!    them (an aux line that split a crease leaves one).
//! 5. A crease that ends inside the paper is no chord of its face, and a
//!    pattern with one is refused: the face would not be convex, and the
//!    engine never builds one that is not.
//! 6. Faces are the bounded cycles of a half-edge walk, counter-clockwise;
//!    each must be convex, and the creases must all hang together with the
//!    border.
//!
//! Everything is in sheet coordinates at the shared tolerance; refusals name
//! sheet points, which the caller maps back to the input's.

use std::collections::HashMap;

use oristudio_geometry::{PointGrid, convex};

use super::{ImportKind, ImportRefusal};
use crate::numerics::TOL;
use crate::pattern::Letter;
use crate::sheet::Sheet;

type Point = [f64; 2];

/// What an imported edge becomes (D10's inverse).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Border,
    /// Folded, with its letter or with one the order decides.
    Folded(Option<Letter>),
    /// A precrease remembering its letter.
    Flat(Letter),
}

impl Kind {
    /// The kind of an input segment; none for an aux line, which is a guide.
    pub(crate) fn of(kind: ImportKind) -> Option<Kind> {
        Some(match kind {
            ImportKind::Border => Kind::Border,
            ImportKind::Mountain => Kind::Folded(Some(Letter::Mountain)),
            ImportKind::Valley => Kind::Folded(Some(Letter::Valley)),
            ImportKind::Unassigned { hint: Some(letter) } => Kind::Flat(letter),
            ImportKind::Unassigned { hint: None } => Kind::Folded(None),
            ImportKind::Aux | ImportKind::CreaseMark { .. } => return None,
        })
    }

    /// The input kind it came from.
    fn import_kind(self) -> ImportKind {
        match self {
            Kind::Border => ImportKind::Border,
            Kind::Folded(Some(Letter::Mountain)) => ImportKind::Mountain,
            Kind::Folded(Some(Letter::Valley)) => ImportKind::Valley,
            Kind::Folded(None) => ImportKind::Unassigned { hint: None },
            Kind::Flat(letter) => ImportKind::Unassigned { hint: Some(letter) },
        }
    }
}

/// One input segment in sheet coordinates.
pub(crate) struct Placed {
    pub(crate) ends: [Point; 2],
    pub(crate) kind: Kind,
    /// Its index in the input.
    pub(crate) segment: usize,
}

/// One edge of the planar graph.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ArrangedEdge {
    pub(crate) ends: [usize; 2],
    pub(crate) kind: Kind,
    /// The input segment it is (part of).
    pub(crate) segment: usize,
}

/// The planar graph and its faces.
#[derive(Debug, Clone)]
pub(crate) struct Arrangement {
    pub(crate) vertices: Vec<Point>,
    pub(crate) edges: Vec<ArrangedEdge>,
    /// Counter-clockwise vertex rings.
    pub(crate) faces: Vec<Vec<usize>>,
    /// Input segments, or pieces of them, that added nothing: shorter than
    /// the tolerance, or lying on another of the same kind or on the border.
    pub(crate) dropped: usize,
}

/// Build the planar graph of `placed` on `sheet` and find its faces.
pub(crate) fn arrange(placed: &[Placed], sheet: &Sheet) -> Result<Arrangement, ImportRefusal> {
    arrange_graph(placed, sheet, true)
}

/// Refine historical graphs without erasing collinear provenance boundaries.
pub(crate) fn refine(placed: &[Placed], sheet: &Sheet) -> Result<Arrangement, ImportRefusal> {
    arrange_graph(placed, sheet, false)
}

fn arrange_graph(
    placed: &[Placed],
    sheet: &Sheet,
    join: bool,
) -> Result<Arrangement, ImportRefusal> {
    let mut grid = PointGrid::new(TOL);
    let mut dropped = 0;
    let mut segments: Vec<Segment> = Vec::with_capacity(placed.len());
    for p in placed {
        let (a, _) = grid.find_or_insert(p.ends[0], TOL);
        let (b, _) = grid.find_or_insert(p.ends[1], TOL);
        if a == b {
            dropped += 1;
            continue;
        }
        segments.push(Segment {
            ends: [a, b],
            kind: p.kind,
            segment: p.segment,
            splits: Vec::new(),
        });
    }
    split_where_they_meet(&mut segments, &mut grid);

    // Pieces into edges, one per vertex pair.
    let mut graph = Graph::default();
    for s in &segments {
        let [a, b] = s.ends.map(|v| grid.point(v));
        let d = sub(b, a);
        let along = |v: usize| dot(sub(grid.point(v), a), d);
        let mut chain: Vec<(f64, usize)> = s.splits.iter().map(|&v| (along(v), v)).collect();
        chain.push((along(s.ends[0]), s.ends[0]));
        chain.push((along(s.ends[1]), s.ends[1]));
        chain.sort_by(|x, y| x.0.total_cmp(&y.0));
        chain.dedup_by_key(|x| x.1);
        for pair in chain.windows(2) {
            let edge = ArrangedEdge {
                ends: [pair[0].1, pair[1].1],
                kind: s.kind,
                segment: s.segment,
            };
            if !graph.insert(edge, &grid)? {
                dropped += 1;
            }
        }
    }
    if join {
        graph.join_collinear(&grid);
    }
    let (vertices, edges) = graph.compact(&grid);

    let mut degree = vec![0usize; vertices.len()];
    for e in &edges {
        for v in e.ends {
            degree[v] += 1;
            if !sheet.contains(vertices[v], -TOL) {
                return Err(ImportRefusal::CreaseOffSheet {
                    segment: e.segment,
                    point: vertices[v],
                });
            }
        }
    }
    for e in &edges {
        if let Some(&v) = e.ends.iter().find(|&&v| degree[v] == 1) {
            return Err(ImportRefusal::CreaseNotChord {
                segment: e.segment,
                kind: e.kind.import_kind(),
                point: vertices[v],
            });
        }
    }
    let faces = faces(&vertices, &edges)?;
    Ok(Arrangement {
        vertices,
        edges,
        faces,
        dropped,
    })
}

struct Segment {
    ends: [usize; 2],
    kind: Kind,
    segment: usize,
    /// Vertices strictly inside it where it must be split.
    splits: Vec<usize>,
}

/// Record every vertex where a segment must be split: another one's end on
/// it, or a proper crossing. Candidate pairs come from a sweep over the
/// segments' boxes in x.
fn split_where_they_meet(segments: &mut [Segment], grid: &mut PointGrid) {
    let ends = |s: &Segment, grid: &PointGrid| s.ends.map(|v| grid.point(v));
    let boxes: Vec<[f64; 4]> = segments
        .iter()
        .map(|s| convex::bounding_box(&ends(s, grid)))
        .collect();
    let mut by_x: Vec<usize> = (0..segments.len()).collect();
    by_x.sort_by(|&i, &j| boxes[i][0].total_cmp(&boxes[j][0]));
    let mut splits: Vec<(usize, usize)> = Vec::new();
    for (k, &i) in by_x.iter().enumerate() {
        for &j in &by_x[k + 1..] {
            if boxes[j][0] > boxes[i][2] + TOL {
                break;
            }
            if !convex::boxes_overlap(&boxes[i], &boxes[j], TOL) {
                continue;
            }
            let (s, r) = (&segments[i], &segments[j]);
            let ([a, b], [c, d]) = (ends(s, grid), ends(r, grid));
            for (end, at) in r.ends.iter().zip([c, d]) {
                if !s.ends.contains(end) && strictly_on(at, a, b) {
                    splits.push((i, *end));
                }
            }
            for (end, at) in s.ends.iter().zip([a, b]) {
                if !r.ends.contains(end) && strictly_on(at, c, d) {
                    splits.push((j, *end));
                }
            }
            let sides = [side(c, a, b), side(d, a, b), side(a, c, d), side(b, c, d)];
            if sides.iter().all(|x| x.abs() > TOL)
                && sides[0].signum() != sides[1].signum()
                && sides[2].signum() != sides[3].signum()
            {
                // Where a b meets c d, by the share of a b on each side of
                // c d's line.
                let t = sides[2] / (sides[2] - sides[3]);
                let x = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
                let (v, _) = grid.find_or_insert(x, TOL);
                for (seg, own) in [(i, s.ends), (j, r.ends)] {
                    if !own.contains(&v) {
                        splits.push((seg, v));
                    }
                }
            }
        }
    }
    for (seg, v) in splits {
        segments[seg].splits.push(v);
    }
}

/// The edges by vertex pair, with each vertex's edges.
#[derive(Default)]
struct Graph {
    edges: Vec<Option<ArrangedEdge>>,
    by_ends: HashMap<(usize, usize), usize>,
    at: HashMap<usize, Vec<usize>>,
}

impl Graph {
    /// Add an edge; false when it lies on one already there (the border
    /// wins, equal kinds merge).
    fn insert(&mut self, edge: ArrangedEdge, grid: &PointGrid) -> Result<bool, ImportRefusal> {
        let key = key(edge.ends);
        if let Some(&e) = self.by_ends.get(&key) {
            let Some(existing) = self.edges[e].as_mut() else {
                return Ok(false);
            };
            if existing.kind == edge.kind || existing.kind == Kind::Border {
                return Ok(false);
            }
            if edge.kind == Kind::Border {
                *existing = edge;
                return Ok(false);
            }
            let [a, b] = edge.ends.map(|v| grid.point(v));
            return Err(ImportRefusal::ConflictingCreases {
                segments: [existing.segment, edge.segment],
                point: [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0],
            });
        }
        let e = self.edges.len();
        self.edges.push(Some(edge));
        self.by_ends.insert(key, e);
        for v in edge.ends {
            self.at.entry(v).or_default().push(e);
        }
        Ok(true)
    }

    /// Drop every vertex that only joins two collinear edges of one kind,
    /// joining the edges.
    fn join_collinear(&mut self, grid: &PointGrid) {
        let mut work: Vec<usize> = self.at.keys().copied().collect();
        work.sort_unstable();
        while let Some(v) = work.pop() {
            let Some(&[e1, e2]) = self.at.get(&v).map(Vec::as_slice) else {
                continue;
            };
            let (Some(first), Some(second)) = (self.edges[e1], self.edges[e2]) else {
                continue;
            };
            let other = |e: &ArrangedEdge| if e.ends[0] == v { e.ends[1] } else { e.ends[0] };
            let (n1, n2) = (other(&first), other(&second));
            if first.kind != second.kind
                || n1 == n2
                || self.by_ends.contains_key(&key([n1, n2]))
                || !strictly_on(grid.point(v), grid.point(n1), grid.point(n2))
            {
                continue;
            }
            self.by_ends.remove(&key(first.ends));
            self.by_ends.remove(&key(second.ends));
            self.by_ends.insert(key([n1, n2]), e1);
            self.edges[e1] = Some(ArrangedEdge {
                ends: [n1, n2],
                ..first
            });
            self.edges[e2] = None;
            self.at.remove(&v);
            if let Some(list) = self.at.get_mut(&n2) {
                for e in list.iter_mut() {
                    if *e == e2 {
                        *e = e1;
                    }
                }
            }
            work.extend([n1, n2]);
        }
    }

    /// The live edges, with the vertices they use renumbered in order.
    fn compact(&self, grid: &PointGrid) -> (Vec<Point>, Vec<ArrangedEdge>) {
        let mut index: HashMap<usize, usize> = HashMap::new();
        let mut vertices = Vec::new();
        let mut edges = Vec::new();
        for edge in self.edges.iter().flatten() {
            let ends = edge.ends.map(|v| {
                *index.entry(v).or_insert_with(|| {
                    vertices.push(grid.point(v));
                    vertices.len() - 1
                })
            });
            edges.push(ArrangedEdge { ends, ..*edge });
        }
        (vertices, edges)
    }
}

/// The bounded faces, counter-clockwise: at each vertex the walk turns to
/// the next edge clockwise from the one it came in by, which keeps the face
/// on its left.
fn faces(vertices: &[Point], edges: &[ArrangedEdge]) -> Result<Vec<Vec<usize>>, ImportRefusal> {
    let mut around: Vec<Vec<usize>> = vec![Vec::new(); vertices.len()];
    for e in edges {
        let [a, b] = e.ends;
        around[a].push(b);
        around[b].push(a);
    }
    for (v, list) in around.iter_mut().enumerate() {
        let angle = |w: &usize| {
            let d = sub(vertices[*w], vertices[v]);
            d[1].atan2(d[0])
        };
        list.sort_by(|x, y| angle(x).total_cmp(&angle(y)));
    }
    let mut used: Vec<Vec<bool>> = around.iter().map(|l| vec![false; l.len()]).collect();
    let mut faces = Vec::new();
    let mut outer: Vec<Vec<usize>> = Vec::new();
    for start in 0..vertices.len() {
        for first in 0..around[start].len() {
            if used[start][first] {
                continue;
            }
            let mut ring = Vec::new();
            let (mut u, mut k) = (start, first);
            for _ in 0..=2 * edges.len() {
                used[u][k] = true;
                ring.push(u);
                let w = around[u][k];
                let Some(back) = around[w].iter().position(|&x| x == u) else {
                    break;
                };
                let n = around[w].len();
                (u, k) = (w, (back + n - 1) % n);
                if (u, k) == (start, first) {
                    break;
                }
            }
            let polygon: Vec<Point> = ring.iter().map(|&v| vertices[v]).collect();
            if convex::signed_area(&polygon) > 0.0 {
                faces.push(ring);
            } else {
                outer.push(ring);
            }
        }
    }
    if let Some(island) = outer.get(1) {
        return Err(ImportRefusal::DisconnectedCreases {
            point: island.first().map_or([f64::NAN; 2], |&v| vertices[v]),
        });
    }
    for ring in &faces {
        let polygon: Vec<Point> = ring.iter().map(|&v| vertices[v]).collect();
        if !convex::is_convex(&polygon, TOL) {
            return Err(ImportRefusal::NonConvexFace {
                point: dent(&polygon),
            });
        }
    }
    Ok(faces)
}

/// The corner of a non-convex ring that dents inward, or its first point.
fn dent(polygon: &[Point]) -> Point {
    let n = polygon.len();
    (0..n)
        .find(|&i| {
            let (a, b, c) = (polygon[(i + n - 1) % n], polygon[i], polygon[(i + 1) % n]);
            let chord = sub(c, a);
            let len = chord[0].hypot(chord[1]);
            len > 0.0 && cross(chord, sub(b, a)) / len > TOL
        })
        .map_or(polygon.first().copied().unwrap_or([f64::NAN; 2]), |i| {
            polygon[i]
        })
}

/// Whether `p` lies on segment `a b`, within the tolerance of its line and
/// more than the tolerance from either end.
fn strictly_on(p: Point, a: Point, b: Point) -> bool {
    let d = sub(b, a);
    let len = d[0].hypot(d[1]);
    if len <= 2.0 * TOL {
        return false;
    }
    let along = dot(sub(p, a), d) / len;
    side(p, a, b).abs() <= TOL && along > TOL && along < len - TOL
}

/// The signed distance of `p` from the line through `a` and `b`, positive on
/// its left.
fn side(p: Point, a: Point, b: Point) -> f64 {
    let d = sub(b, a);
    let len = d[0].hypot(d[1]);
    if len == 0.0 {
        return 0.0;
    }
    cross(d, sub(p, a)) / len
}

fn key([a, b]: [usize; 2]) -> (usize, usize) {
    (a.min(b), a.max(b))
}

fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1]]
}

fn dot(a: Point, b: Point) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

fn cross(a: Point, b: Point) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn placed(segments: &[(Point, Point, Kind)]) -> Vec<Placed> {
        segments
            .iter()
            .enumerate()
            .map(|(segment, &(a, b, kind))| Placed {
                ends: [a, b],
                kind,
                segment,
            })
            .collect()
    }

    fn border() -> Vec<(Point, Point, Kind)> {
        let c = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        (0..4)
            .map(|i| (c[i], c[(i + 1) % 4], Kind::Border))
            .collect()
    }

    const V: Kind = Kind::Folded(Some(Letter::Valley));
    const M: Kind = Kind::Folded(Some(Letter::Mountain));

    fn arranged(segments: &[(Point, Point, Kind)]) -> Arrangement {
        arrange(&placed(segments), &Sheet::square()).unwrap_or_else(|e| panic!("{e}"))
    }

    #[test]
    fn crossing_diagonals_split_into_four_triangles() {
        let mut s = border();
        s.push(([0.0, 0.0], [1.0, 1.0], V));
        s.push(([1.0, 0.0], [0.0, 1.0], M));
        let a = arranged(&s);
        assert_eq!(a.vertices.len(), 5);
        assert_eq!(a.edges.len(), 8);
        assert_eq!(a.faces.len(), 4);
        for ring in &a.faces {
            let polygon: Vec<Point> = ring.iter().map(|&v| a.vertices[v]).collect();
            assert!((convex::signed_area(&polygon) - 0.25).abs() < 1e-12);
        }
    }

    #[test]
    fn t_junctions_and_overlaps_split_and_merge() {
        // A valley across the middle, a mountain from its midpoint up, the
        // valley drawn again in two overlapping pieces, and a crease along
        // the border.
        let mut s = border();
        s.push(([0.0, 0.5], [1.0, 0.5], V));
        s.push(([0.5, 0.5], [0.5, 1.0], M));
        s.push(([0.0, 0.5], [0.7, 0.5], V));
        s.push(([0.3, 0.5], [1.0, 0.5], V));
        s.push(([0.0, 0.0], [0.4, 0.0], M));
        s.push(([0.2, 0.2], [0.2, 0.2], M));
        let a = arranged(&s);
        assert_eq!(a.faces.len(), 3);
        assert!(a.dropped >= 3);
        // The bottom border stays one border edge: the mountain on it is
        // dropped and its split rejoined.
        let bottom = a
            .edges
            .iter()
            .filter(|e| e.ends.iter().all(|&v| a.vertices[v][1] == 0.0))
            .collect::<Vec<_>>();
        assert_eq!(bottom.len(), 1);
        assert_eq!(bottom[0].kind, Kind::Border);
        // The valley is two edges, split by the mountain's foot.
        assert_eq!(a.edges.iter().filter(|e| e.kind == V).count(), 2);
    }

    #[test]
    fn a_split_crease_is_joined_again() {
        let mut s = border();
        s.push(([0.0, 0.5], [0.4, 0.5], V));
        s.push(([0.4, 0.5], [1.0, 0.5], V));
        let a = arranged(&s);
        assert_eq!(a.faces.len(), 2);
        // Six border edges, split where the valley meets them, and the one
        // valley.
        assert_eq!(a.edges.len(), 7);
        // Kinds that differ are not joined; the gate judges them later.
        let mut s = border();
        s.push(([0.0, 0.5], [0.4, 0.5], V));
        s.push(([0.4, 0.5], [1.0, 0.5], M));
        assert_eq!(arranged(&s).edges.len(), 8);
    }

    #[test]
    fn patterns_the_engine_cannot_hold_are_refused() {
        let refused = |extra: Vec<(Point, Point, Kind)>| {
            let mut s = border();
            s.extend(extra);
            arrange(&placed(&s), &Sheet::square()).err()
        };
        // A precrease that stops inside the paper.
        assert!(matches!(
            refused(vec![([0.0, 0.5], [0.6, 0.5], Kind::Flat(Letter::Valley))]),
            Some(ImportRefusal::CreaseNotChord {
                segment: 4,
                kind: ImportKind::Unassigned {
                    hint: Some(Letter::Valley)
                },
                point,
            }) if point == [0.6, 0.5]
        ));
        // A valley and a mountain on the same line.
        assert!(matches!(
            refused(vec![
                ([0.0, 0.5], [1.0, 0.5], V),
                ([0.2, 0.5], [0.4, 0.5], M)
            ]),
            Some(ImportRefusal::ConflictingCreases { .. })
        ));
        // A crease that bends: one face has a reflex corner.
        assert!(matches!(
            refused(vec![([0.0, 0.5], [0.5, 0.6], V), ([0.5, 0.6], [1.0, 0.5], V)]),
            Some(ImportRefusal::NonConvexFace { point }) if point == [0.5, 0.6]
        ));
        // A closed loop of creases that touches nothing.
        assert!(matches!(
            refused(vec![
                ([0.2, 0.2], [0.8, 0.2], V),
                ([0.8, 0.2], [0.8, 0.8], V),
                ([0.8, 0.8], [0.2, 0.8], V),
                ([0.2, 0.8], [0.2, 0.2], V),
            ]),
            Some(ImportRefusal::DisconnectedCreases { .. })
        ));
        // A crease that leaves the sheet.
        assert!(matches!(
            refused(vec![([0.5, 0.0], [0.5, 1.5], V)]),
            Some(ImportRefusal::CreaseOffSheet { segment: 4, point }) if point == [0.5, 1.5]
        ));
    }
}
