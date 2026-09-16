//! Conservative corridor queries. The caller keeps the exact geometry test;
//! this index only avoids visiting vertices that cannot pass that test.
use oristudio_cp_compiler::Point2;
use oristudio_cp_compiler::candidate_graph::CandidateVertex;

pub(super) struct VertexSpatialIndex {
    width: usize,
    cells: Vec<Vec<usize>>,
    usable: bool,
    len: usize,
}

impl VertexSpatialIndex {
    pub(super) fn new(vertices: &[CandidateVertex]) -> Self {
        let width = (vertices.len() as f64).sqrt().ceil().clamp(1.0, 64.0) as usize;
        let mut index = Self {
            width,
            cells: vec![Vec::new(); width * width],
            usable: true,
            len: vertices.len(),
        };
        for (id, vertex) in vertices.iter().enumerate() {
            let p = vertex.point;
            if !p.x.is_finite()
                || !p.y.is_finite()
                || !(0.0..=1.0).contains(&p.x)
                || !(0.0..=1.0).contains(&p.y)
            {
                index.usable = false;
                continue;
            }
            let cell = index.bin(p.y) * width + index.bin(p.x);
            index.cells[cell].push(id);
        }
        index
    }

    fn bin(&self, value: f64) -> usize {
        (value * self.width as f64)
            .floor()
            .clamp(0.0, (self.width - 1) as f64) as usize
    }

    pub(super) fn any_near_segment(
        &self,
        a: Point2,
        b: Point2,
        radius: f64,
        mut predicate: impl FnMut(usize) -> bool,
    ) -> bool {
        if !self.usable || !radius.is_finite() || radius < 0.0 {
            return (0..self.len).any(predicate);
        }
        // Round-off must never turn the broad phase into a rejection gate.
        let pad = radius + 1e-12;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        for y in self.bin(a.y.min(b.y) - pad)..=self.bin(a.y.max(b.y) + pad) {
            // Expand a row vertically by the corridor radius, intersect the
            // segment with that strip, then expand its x range horizontally.
            // This encloses the entire Euclidean tube without scanning its
            // much larger diagonal bounding rectangle.
            let low = y as f64 / self.width as f64 - pad;
            let high = (y + 1) as f64 / self.width as f64 + pad;
            let (t0, t1) = if dy == 0.0 {
                (0.0, 1.0)
            } else {
                let u = (low - a.y) / dy;
                let v = (high - a.y) / dy;
                (u.min(v).max(0.0), u.max(v).min(1.0))
            };
            if t0 > t1 {
                continue;
            }
            let x0 = a.x + dx * t0;
            let x1 = a.x + dx * t1;
            for x in self.bin(x0.min(x1) - pad)..=self.bin(x0.max(x1) + pad) {
                if self.cells[y * self.width + x]
                    .iter()
                    .copied()
                    .any(&mut predicate)
                {
                    return true;
                }
            }
        }
        false
    }
}
