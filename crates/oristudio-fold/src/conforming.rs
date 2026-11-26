//! The overlay's cells as one planar arrangement: what the scene's
//! `subfaces` are ([`crate::scene`]).
//!
//! The app's painters (`foldedFlatPaperScene` in the web app) take subfaces
//! as Oriedita's are: two subfaces that share a vertex give it the same
//! coordinates, and no subface has a corner partway along another's edge.
//! They find the subface across each edge by its two ends, exactly, and a
//! woven order's patches are worked out from what lies across: a buried
//! edge is found through the subface beside it. Where no subface is found
//! the edge is the figure's rim, and a buried edge drawn there stays on top.
//!
//! `oristudio-layer-order`'s overlay is not that. Its cells are a cover of
//! the faces up to [`TOL`], built face by face with no global point merging
//! (its module docs say why): two cells may give one corner coordinates a
//! few bits apart, and a cut along a face's whole edge line leaves a corner
//! partway along the edge of a cell beside it. So the scene seals them, and
//! the overlay is left as the checker reads it:
//!
//! 1. every corner within [`TOL`] of one already seen takes that one's
//!    coordinates, so a corner is one point. The faces' own corners are seen
//!    first, so a cell's corner that is a face's keeps the face's
//!    coordinates; the rest are seen cell by cell, in order;
//! 2. every cell corner lying on a cell's edge, within [`TOL`] of it and
//!    strictly between its ends, is put into that edge, in order along it.
//!
//! Nothing moves by more than [`TOL`]; a cell keeps its stack and its place
//! in the list. A cell that welding would leave with fewer than three
//! corners keeps its own.

use oristudio_geometry::PointGrid;

use crate::numerics::TOL;

type Point = [f64; 2];

/// Each polygon welded and with the corners on its edges put in (see the
/// module docs), in the order given; `faces` are the faces' corners, whose
/// coordinates a corner within [`TOL`] of one takes.
pub(crate) fn conforming<'a>(
    faces: impl IntoIterator<Item = Point>,
    polygons: impl IntoIterator<Item = &'a [Point]>,
) -> Vec<Vec<Point>> {
    let polygons: Vec<&[Point]> = polygons.into_iter().collect();
    let mut weld = PointGrid::new(TOL);
    for corner in faces {
        weld.find_or_insert(corner, TOL);
    }
    let rings: Vec<Option<Vec<usize>>> = polygons
        .iter()
        .map(|polygon| {
            let mut ring: Vec<usize> = polygon
                .iter()
                .map(|&p| weld.find_or_insert(p, TOL).0)
                .collect();
            ring.dedup();
            while ring.len() > 1 && ring.first() == ring.last() {
                ring.pop();
            }
            (ring.len() >= 3).then_some(ring)
        })
        .collect();
    let points = weld.points();
    let corners = Corners::new(points, &rings);
    rings
        .iter()
        .zip(&polygons)
        .map(|(ring, polygon)| match ring {
            Some(ring) => corners.seal(ring),
            None => polygon.to_vec(),
        })
        .collect()
}

/// The welded cell corners, bucketed coarsely enough that an edge is looked
/// up through a few buckets per edge length.
struct Corners<'a> {
    points: &'a [Point],
    grid: PointGrid,
    /// Per point in `grid`, its index in `points`.
    ids: Vec<usize>,
}

impl<'a> Corners<'a> {
    fn new(points: &'a [Point], rings: &[Option<Vec<usize>>]) -> Corners<'a> {
        let (mut length, mut edges) = (0.0, 0usize);
        let mut used = vec![false; points.len()];
        for ring in rings.iter().flatten() {
            for (i, &a) in ring.iter().enumerate() {
                length += distance(points[a], points[ring[(i + 1) % ring.len()]]);
                edges += 1;
                used[a] = true;
            }
        }
        // The mean edge: an edge's lookup probes about two buckets per mean
        // edge along it. Never under a few TOL, so a probe's reach (the pitch)
        // always covers a corner TOL off the edge between two probes.
        let pitch = if edges == 0 {
            1.0
        } else {
            length / edges as f64
        }
        .max(4.0 * TOL);
        let mut grid = PointGrid::new(pitch);
        let ids: Vec<usize> = (0..points.len()).filter(|&k| used[k]).collect();
        for &k in &ids {
            grid.insert(points[k]);
        }
        Corners { points, grid, ids }
    }

    /// The ring's corners with every other corner on each of its edges put
    /// in, in order along the edge.
    fn seal(&self, ring: &[usize]) -> Vec<Point> {
        let mut sealed = Vec::with_capacity(ring.len());
        let mut on: Vec<(f64, usize)> = Vec::new();
        for (i, &a) in ring.iter().enumerate() {
            let b = ring[(i + 1) % ring.len()];
            sealed.push(self.points[a]);
            self.on_edge(a, b, &mut on);
            sealed.extend(on.iter().map(|&(_, k)| self.points[k]));
        }
        sealed
    }

    /// The corners other than `a` and `b` within [`TOL`] of the edge from `a`
    /// to `b` and strictly between them, by their place along it.
    fn on_edge(&self, a: usize, b: usize, on: &mut Vec<(f64, usize)>) {
        on.clear();
        let (pa, pb) = (self.points[a], self.points[b]);
        let d = [pb[0] - pa[0], pb[1] - pa[1]];
        let length = d[0].hypot(d[1]);
        if length <= TOL {
            return;
        }
        // Probes no more than a pitch apart, each reaching a pitch: a corner
        // TOL off the edge is within a pitch of the probe nearest it.
        let pitch = self.grid.cell();
        let probes = (length / pitch).ceil() as usize;
        for s in 0..=probes {
            let t = s as f64 / probes.max(1) as f64;
            let probe = [pa[0] + d[0] * t, pa[1] + d[1] * t];
            for k in self
                .grid
                .within(probe, pitch)
                .into_iter()
                .map(|g| self.ids[g])
            {
                if k == a || k == b {
                    continue;
                }
                let p = self.points[k];
                let v = [p[0] - pa[0], p[1] - pa[1]];
                let off = (d[0] * v[1] - d[1] * v[0]).abs() / length;
                let along = (d[0] * v[0] + d[1] * v[1]) / length;
                if off <= TOL && along > 0.0 && along < length {
                    on.push((along, k));
                }
            }
        }
        on.sort_unstable_by(|x, y| x.0.total_cmp(&y.0).then(x.1.cmp(&y.1)));
        on.dedup_by_key(|&mut (_, k)| k);
    }
}

fn distance(a: Point, b: Point) -> f64 {
    (b[0] - a[0]).hypot(b[1] - a[1])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Point> {
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    }

    fn sealed(cells: &[Vec<Point>]) -> Vec<Vec<Point>> {
        conforming([], cells.iter().map(Vec::as_slice))
    }

    /// A cell beside two whose shared corner is partway along its edge: the
    /// corner goes into that edge, so both edges across are its own.
    #[test]
    fn a_corner_partway_along_an_edge_goes_into_it() {
        let cells = [
            square(0.0, 0.0, 1.0, 1.0),
            square(1.0, 0.0, 2.0, 0.5),
            square(1.0, 0.5, 2.0, 1.0),
        ];
        let out = sealed(&cells);
        assert_eq!(
            out[0],
            vec![[0.0, 0.0], [1.0, 0.0], [1.0, 0.5], [1.0, 1.0], [0.0, 1.0]]
        );
        assert_eq!(out[1], cells[1]);
        assert_eq!(out[2], cells[2]);
    }

    /// Corners a few bits apart become one point: the first seen.
    #[test]
    fn corners_a_few_bits_apart_are_one_point() {
        let cells = [
            square(0.0, 0.0, 0.11000000000000003, 0.08),
            vec![
                [0.11000000000000004, 0.0],
                [0.2, 0.0],
                [0.2, 0.08],
                [0.11000000000000004, 0.07999999999999999],
            ],
        ];
        let out = sealed(&cells);
        assert_eq!(out[0], cells[0]);
        assert_eq!(out[1][0], [0.11000000000000003, 0.0]);
        assert_eq!(out[1][3], [0.11000000000000003, 0.08]);
    }

    /// Within the tolerance, a corner off the edge still goes in, as itself;
    /// past it, it does not. Several go in by their place along the edge.
    #[test]
    fn corners_within_the_tolerance_go_in_in_order() {
        let near = 0.5 * TOL;
        let far = 2.0 * TOL;
        let cells = [
            vec![[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
            vec![[0.7, near], [0.8, -0.5], [0.9, 0.0]],
            vec![[0.2, -0.5], [0.3, 0.0], [0.25, -far]],
            vec![[0.4, -far], [0.5, -0.5], [0.6, -far]],
        ];
        let out = sealed(&cells);
        assert_eq!(
            out[0],
            vec![
                [0.0, 0.0],
                [0.3, 0.0],
                [0.7, near],
                [0.9, 0.0],
                [1.0, 0.0],
                [0.0, 1.0]
            ]
        );
    }

    /// A corner at an edge's end is not put into it, and nor is one on the
    /// edge's line past its end.
    #[test]
    fn nothing_goes_in_at_or_past_an_end() {
        let cells = [
            square(0.0, 0.0, 1.0, 1.0),
            vec![[1.0, 0.0], [2.0, 0.0], [1.5, -1.0]],
            vec![[1.2, 1.0], [1.4, 1.0], [1.3, 2.0]],
        ];
        let out = sealed(&cells);
        assert_eq!(out[0], cells[0]);
    }

    /// A face's corner is the coordinates a cell corner within the tolerance
    /// of it takes; one that is no cell's corner goes into no edge.
    #[test]
    fn a_face_s_corner_is_the_one_kept() {
        let corner = [1.0 + 0.5 * TOL, 0.0];
        let cells = [square(0.0, 0.0, 1.0, 1.0), square(1.0, 0.0, 2.0, 1.0)];
        let out = conforming([corner, [0.5, 0.0]], cells.iter().map(Vec::as_slice));
        assert_eq!(out[0], vec![[0.0, 0.0], corner, [1.0, 1.0], [0.0, 1.0]]);
        assert_eq!(out[1], vec![corner, [2.0, 0.0], [2.0, 1.0], [1.0, 1.0]]);
    }

    /// A ring welding would leave with fewer than three corners is kept as
    /// it was.
    #[test]
    fn a_cell_welding_would_collapse_is_kept() {
        let tiny = vec![[0.0, 0.0], [0.5 * TOL, 0.0], [0.0, 0.5 * TOL]];
        let out = sealed(&[square(0.0, 0.0, 1.0, 1.0), tiny.clone()]);
        assert_eq!(out[1], tiny);
    }
}
