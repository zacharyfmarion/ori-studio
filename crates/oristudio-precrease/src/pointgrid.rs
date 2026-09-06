//! A tolerance-aware point index: a grid hash whose cell is at least the
//! query radius, probed over the neighbouring cells the query circle can
//! reach, so two points within the radius are always found regardless of
//! which side of a cell boundary they fall on. No exact hashing of
//! coordinates anywhere (tolerance policy).
//!
//! The hasher is a small multiplicative mix rather than SipHash: the planner
//! does millions of lookups per closure and the keys are cell indices, not
//! attacker-controlled input.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// A multiply–xorshift hasher for `(i64, i64)` cell keys.
#[derive(Default, Clone, Copy)]
pub struct CellHasher(u64);

impl Hasher for CellHasher {
    fn finish(&self) -> u64 {
        let mut x = self.0;
        x ^= x >> 33;
        x = x.wrapping_mul(0xff51_afd7_ed55_8ccd);
        x ^= x >> 33;
        x
    }

    fn write(&mut self, bytes: &[u8]) {
        for chunk in bytes.chunks(8) {
            let mut word = [0u8; 8];
            word[..chunk.len()].copy_from_slice(chunk);
            self.write_u64(u64::from_le_bytes(word));
        }
    }

    fn write_u64(&mut self, i: u64) {
        self.0 = (self.0.rotate_left(29) ^ i).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    }

    fn write_i64(&mut self, i: i64) {
        self.write_u64(i as u64);
    }
}

type CellMap = HashMap<(i64, i64), Vec<usize>, BuildHasherDefault<CellHasher>>;

/// Points bucketed by a grid of pitch `cell`.
#[derive(Debug, Clone)]
pub struct PointGrid {
    cell: f64,
    cells: CellMap,
    points: Vec<[f64; 2]>,
}

impl std::fmt::Debug for CellHasher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "CellHasher")
    }
}

impl PointGrid {
    /// A grid whose cell equals the largest radius it will be queried with.
    pub fn new(cell: f64) -> Self {
        Self {
            cell: cell.max(f64::MIN_POSITIVE),
            cells: CellMap::default(),
            points: Vec::new(),
        }
    }

    /// The grid pitch (the largest radius `within` accepts).
    pub fn cell(&self) -> f64 {
        self.cell
    }

    fn cell_of(&self, p: [f64; 2]) -> (i64, i64) {
        // Coordinates are finite by construction (validated at the API
        // boundary); the casts saturate rather than trap on anything else.
        (
            (p[0] / self.cell).floor() as i64,
            (p[1] / self.cell).floor() as i64,
        )
    }

    /// Insert a point unconditionally and return its id.
    pub fn insert(&mut self, p: [f64; 2]) -> usize {
        let id = self.points.len();
        self.points.push(p);
        self.cells.entry(self.cell_of(p)).or_default().push(id);
        id
    }

    /// Ids of every stored point within `radius` of `p`, nearest first.
    /// `radius` must not exceed the grid cell. Only the neighbouring cells
    /// the query circle actually reaches are probed.
    pub fn within(&self, p: [f64; 2], radius: f64) -> Vec<usize> {
        let mut hits: Vec<(f64, usize)> = Vec::new();
        self.for_each_within(p, radius, |id, dist| hits.push((dist, id)));
        hits.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        hits.into_iter().map(|(_, id)| id).collect()
    }

    /// Whether any stored point lies within `radius` of `p`.
    pub fn any_within(&self, p: [f64; 2], radius: f64) -> bool {
        let mut found = false;
        self.for_each_within(p, radius, |_, _| found = true);
        found
    }

    /// The nearest stored point within `radius` of `p`, if any.
    pub fn nearest_within(&self, p: [f64; 2], radius: f64) -> Option<usize> {
        let mut best: Option<(f64, usize)> = None;
        self.for_each_within(p, radius, |id, dist| {
            if best.is_none_or(|(d, i)| dist < d || (dist == d && id < i)) {
                best = Some((dist, id));
            }
        });
        best.map(|(_, id)| id)
    }

    fn for_each_within(&self, p: [f64; 2], radius: f64, mut f: impl FnMut(usize, f64)) {
        let (cx, cy) = self.cell_of(p);
        let fx = p[0] / self.cell - cx as f64;
        let fy = p[1] / self.cell - cy as f64;
        let r = radius / self.cell;
        // Each axis probes its own cell plus whichever neighbours the query
        // circle reaches — both when the radius equals the cell.
        let span = |f: f64| -> [Option<i64>; 3] {
            [Some(0), (f < r).then_some(-1), (f > 1.0 - r).then_some(1)]
        };
        for dx in span(fx).into_iter().flatten() {
            for dy in span(fy).into_iter().flatten() {
                if let Some(ids) = self.cells.get(&(cx + dx, cy + dy)) {
                    for &id in ids {
                        let q = self.points[id];
                        let dist = ((q[0] - p[0]).powi(2) + (q[1] - p[1]).powi(2)).sqrt();
                        if dist <= radius {
                            f(id, dist);
                        }
                    }
                }
            }
        }
    }

    /// The nearest stored point within `radius`, or a freshly inserted one.
    /// Returns `(id, inserted)`.
    pub fn find_or_insert(&mut self, p: [f64; 2], radius: f64) -> (usize, bool) {
        match self.nearest_within(p, radius) {
            Some(id) => (id, false),
            None => (self.insert(p), true),
        }
    }

    /// Stored coordinates of point `id`.
    pub fn point(&self, id: usize) -> [f64; 2] {
        self.points[id]
    }

    /// Number of stored points.
    pub fn len(&self) -> usize {
        self.points.len()
    }

    /// Whether the grid holds no points.
    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    /// All stored points in insertion order.
    pub fn points(&self) -> &[[f64; 2]] {
        &self.points
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_points_across_cell_boundaries() {
        let mut grid = PointGrid::new(1e-3);
        let a = grid.insert([0.999_999, 0.5]);
        let b = grid.insert([1.000_001, 0.5]);
        let far = grid.insert([1.003, 0.5]);
        let hits = grid.within([1.0, 0.5], 1e-3);
        assert_eq!(hits.len(), 2);
        assert!(hits.contains(&a) && hits.contains(&b));
        assert!(!hits.contains(&far));
        assert!(grid.any_within([1.0, 0.5], 1e-3));
        assert!(!grid.any_within([2.0, 0.5], 1e-3));
        assert_eq!(grid.nearest_within([0.999_999_5, 0.5], 1e-3), Some(a));
    }

    #[test]
    fn find_or_insert_dedupes_within_radius_only() {
        let mut grid = PointGrid::new(1e-6);
        let (a, new_a) = grid.find_or_insert([0.25, 0.25], 1e-6);
        let (b, new_b) = grid.find_or_insert([0.25 + 4e-7, 0.25], 1e-6);
        let (c, new_c) = grid.find_or_insert([0.25 + 3e-6, 0.25], 1e-6);
        assert!(new_a && !new_b && new_c);
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(grid.len(), 2);
    }

    #[test]
    fn a_radius_equal_to_the_cell_reaches_both_neighbours() {
        let mut grid = PointGrid::new(1e-3);
        let left = grid.insert([0.0, 0.5]);
        let right = grid.insert([0.0019, 0.5]);
        // Query at the left end of cell 1: the left neighbour holds `left`,
        // the right neighbour is within the radius too.
        let hits = grid.within([0.001, 0.5], 1e-3);
        assert!(hits.contains(&left) && hits.contains(&right), "{hits:?}");
    }

    #[test]
    fn a_smaller_radius_than_the_cell_probes_fewer_cells_but_misses_nothing() {
        // Cell 8e-6, radius 1e-6: points straddling every cell boundary
        // direction must still be found.
        let mut grid = PointGrid::new(8e-6);
        let base = 8e-6 * 1000.0;
        let ids: Vec<usize> = [
            [base - 4e-7, base - 4e-7],
            [base + 4e-7, base + 4e-7],
            [base - 4e-7, base + 4e-7],
            [base + 4e-7, base - 4e-7],
        ]
        .iter()
        .map(|&p| grid.insert(p))
        .collect();
        let hits = grid.within([base, base], 1e-6);
        assert_eq!(hits.len(), 4);
        for id in ids {
            assert!(hits.contains(&id));
        }
        // A point 2e-6 away is outside the radius even though it shares a cell.
        grid.insert([base + 2e-6, base]);
        assert_eq!(grid.within([base, base], 1e-6).len(), 4);
    }
}
