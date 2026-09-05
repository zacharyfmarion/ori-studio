//! A tolerance-aware point index: a grid hash whose cell is the query radius,
//! probed over the 3×3 neighbourhood, so two points within the radius are
//! always found regardless of which side of a cell boundary they fall on.
//! No exact hashing of coordinates anywhere (tolerance policy).

use std::collections::HashMap;

/// Points bucketed by a grid of pitch `cell`.
#[derive(Debug, Clone)]
pub struct PointGrid {
    cell: f64,
    cells: HashMap<(i64, i64), Vec<usize>>,
    points: Vec<[f64; 2]>,
}

impl PointGrid {
    /// A grid whose cell equals the largest radius it will be queried with.
    pub fn new(cell: f64) -> Self {
        Self {
            cell: cell.max(f64::MIN_POSITIVE),
            cells: HashMap::new(),
            points: Vec::new(),
        }
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
    /// `radius` must not exceed the grid cell.
    pub fn within(&self, p: [f64; 2], radius: f64) -> Vec<usize> {
        let (cx, cy) = self.cell_of(p);
        let mut hits: Vec<(f64, usize)> = Vec::new();
        for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(ids) = self.cells.get(&(cx + dx, cy + dy)) {
                    for &id in ids {
                        let q = self.points[id];
                        let dist = ((q[0] - p[0]).powi(2) + (q[1] - p[1]).powi(2)).sqrt();
                        if dist <= radius {
                            hits.push((dist, id));
                        }
                    }
                }
            }
        }
        hits.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        hits.into_iter().map(|(_, id)| id).collect()
    }

    /// The nearest stored point within `radius`, or a freshly inserted one.
    /// Returns `(id, inserted)`.
    pub fn find_or_insert(&mut self, p: [f64; 2], radius: f64) -> (usize, bool) {
        match self.within(p, radius).first() {
            Some(&id) => (id, false),
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
}
