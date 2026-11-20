//! In-plane shift that keeps the lifted paper its true size, to second order.
//! Display geometry only, like the heights: no fold or layer order changes.
//!
//! For heights `h` above a reference plane, a triangle with height gradient
//! `g` is unstretched in 3D when its in-plane displacement `u` satisfies
//! `sym(grad u) = -1/2 g (x) g`: the membrane strain of a thin plate, set to
//! zero. Joined paper cannot always shorten everywhere at once, so `u` is the
//! area-weighted least-squares fit over the shared material vertices.
use crate::Input;
use std::f64::consts::FRAC_1_SQRT_2;

/// Relative to vertex area. Zero strain leaves one slide and one turn free;
/// this picks the shift with neither, and is far too weak to resist a real
/// shortening.
const ANCHOR: f64 = 1e-4;
/// The external corpus needs about a thousand at most.
const MAX_ITERATIONS: usize = 20_000;
/// Half the model. Anything larger is not a shift; draw without one.
const MAX_SHIFT: f64 = 1.;

struct Element {
    ids: [usize; 3],
    area: f64,
    /// Shape-function gradients, per corner.
    dx: [f64; 3],
    dy: [f64; 3],
}

impl Element {
    /// The strain of a displacement, as three rows over this triangle's six
    /// unknowns: `xx`, `yy` and `sqrt(2) * xy`, so a plain sum of squares is
    /// the Frobenius norm of the strain.
    fn strain_rows(&self) -> [[f64; 6]; 3] {
        let mut rows = [[0.; 6]; 3];
        for corner in 0..3 {
            rows[0][2 * corner] = self.dx[corner];
            rows[1][2 * corner + 1] = self.dy[corner];
            rows[2][2 * corner] = self.dy[corner] * FRAC_1_SQRT_2;
            rows[2][2 * corner + 1] = self.dx[corner] * FRAC_1_SQRT_2;
        }
        rows
    }

    fn unknowns(&self) -> [usize; 6] {
        let [a, b, c] = self.ids;
        [2 * a, 2 * a + 1, 2 * b, 2 * b + 1, 2 * c, 2 * c + 1]
    }

    /// The strain that cancels the stretch of `heights`, in the rows' order.
    fn target(&self, heights: &[f64]) -> [f64; 3] {
        let (mut gx, mut gy) = (0., 0.);
        for corner in 0..3 {
            gx += heights[self.ids[corner]] * self.dx[corner];
            gy += heights[self.ids[corner]] * self.dy[corner];
        }
        [-0.5 * gx * gx, -0.5 * gy * gy, -FRAC_1_SQRT_2 * gx * gy]
    }
}

fn elements(input: &Input) -> Vec<Element> {
    input
        .triangles
        .iter()
        .filter_map(|&ids| {
            let [[xi, yi], [xj, yj], [xk, yk]] = ids.map(|v| input.xy[v]);
            let twice = (xj - xi) * (yk - yi) - (xk - xi) * (yj - yi);
            (twice.abs() >= 2e-13).then(|| Element {
                ids,
                area: twice.abs() / 2.,
                dx: [(yj - yk) / twice, (yk - yi) / twice, (yi - yj) / twice],
                dy: [(xk - xj) / twice, (xi - xk) / twice, (xj - xi) / twice],
            })
        })
        .collect()
}

/// Symmetric positive definite, stored whole in compressed rows.
struct Stiffness {
    start: Vec<usize>,
    column: Vec<usize>,
    value: Vec<f64>,
    diagonal: Vec<f64>,
}

impl Stiffness {
    fn new(elements: &[Element], vertices: usize) -> Self {
        let n = 2 * vertices;
        let mut entries = Vec::with_capacity(36 * elements.len() + n);
        let mut lumped = vec![0.; vertices];
        for element in elements {
            let rows = element.strain_rows();
            let unknowns = element.unknowns();
            for p in 0..6 {
                for q in 0..6 {
                    let value: f64 = rows.iter().map(|row| row[p] * row[q]).sum();
                    if value != 0. {
                        entries.push((unknowns[p], unknowns[q], element.area * value));
                    }
                }
            }
            for v in element.ids {
                lumped[v] += element.area / 3.;
            }
        }
        for (v, &area) in lumped.iter().enumerate() {
            // A vertex in no triangle has nothing to follow; hold it still.
            let anchor = if area > 0. { ANCHOR * area } else { 1. };
            entries.push((2 * v, 2 * v, anchor));
            entries.push((2 * v + 1, 2 * v + 1, anchor));
        }
        entries.sort_unstable_by_key(|&(row, column, _)| (row, column));
        let mut start = vec![0; n + 1];
        let mut column = Vec::with_capacity(entries.len());
        let mut value: Vec<f64> = Vec::with_capacity(entries.len());
        let mut diagonal = vec![0.; n];
        let mut last = None;
        for (row, col, v) in entries {
            if last == Some((row, col)) {
                if let Some(sum) = value.last_mut() {
                    *sum += v;
                }
            } else {
                column.push(col);
                value.push(v);
                start[row + 1] = column.len();
                last = Some((row, col));
            }
            if row == col {
                diagonal[row] += v;
            }
        }
        // Every row holds at least its anchor, so no row is skipped.
        Self {
            start,
            column,
            value,
            diagonal,
        }
    }

    fn multiply(&self, x: &[f64], out: &mut [f64]) {
        for (row, out) in out.iter_mut().enumerate() {
            let range = self.start[row]..self.start[row + 1];
            *out = self.column[range.clone()]
                .iter()
                .zip(&self.value[range])
                .map(|(&column, value)| value * x[column])
                .sum();
        }
    }

    /// Jacobi-preconditioned conjugate gradients. `None` when the iteration
    /// breaks down or stops far from the answer.
    fn solve(&self, load: &[f64]) -> Option<Vec<f64>> {
        let n = load.len();
        let dot = |a: &[f64], b: &[f64]| -> f64 { a.iter().zip(b).map(|(x, y)| x * y).sum() };
        let scale = dot(load, load);
        let mut solution = vec![0.; n];
        if scale == 0. {
            return Some(solution);
        }
        let mut residual = load.to_vec();
        let precondition = |residual: &[f64], out: &mut [f64]| {
            for ((out, r), d) in out.iter_mut().zip(residual).zip(&self.diagonal) {
                *out = r / d;
            }
        };
        let mut scaled = vec![0.; n];
        precondition(&residual, &mut scaled);
        let mut direction = scaled.clone();
        let mut image = vec![0.; n];
        let mut energy = dot(&residual, &scaled);
        let mut remaining = scale;
        for _ in 0..MAX_ITERATIONS {
            self.multiply(&direction, &mut image);
            let curvature = dot(&direction, &image);
            if curvature.is_nan() || curvature <= 0. {
                return None;
            }
            let step = energy / curvature;
            for i in 0..n {
                solution[i] += step * direction[i];
                residual[i] -= step * image[i];
            }
            remaining = dot(&residual, &residual);
            if remaining <= 1e-20 * scale {
                return Some(solution);
            }
            precondition(&residual, &mut scaled);
            let next = dot(&residual, &scaled);
            let turn = next / energy;
            energy = next;
            for i in 0..n {
                direction[i] = scaled[i] + turn * direction[i];
            }
        }
        (remaining <= 1e-8 * scale).then_some(solution)
    }
}

/// The shift at amount 1 for each reference plane `[a, b, c]`, as `x, y` per
/// vertex. It scales with the square of the amount. A side whose solve does
/// not finish, or is not a credible shift, is empty.
pub(crate) fn shifts(input: &Input, heights: &[f64], planes: [[f64; 3]; 2]) -> [Vec<f64>; 2] {
    let elements = elements(input);
    let stiffness = Stiffness::new(&elements, input.xy.len());
    planes.map(|[a, b, c]| {
        let above: Vec<f64> = input
            .xy
            .iter()
            .zip(heights)
            .map(|(&[x, y], &z)| z - a * x - b * y - c)
            .collect();
        let mut load = vec![0.; 2 * input.xy.len()];
        for element in &elements {
            let rows = element.strain_rows();
            let target = element.target(&above);
            for (p, unknown) in element.unknowns().into_iter().enumerate() {
                load[unknown] += element.area
                    * rows
                        .iter()
                        .zip(target)
                        .map(|(row, strain)| row[p] * strain)
                        .sum::<f64>();
            }
        }
        stiffness
            .solve(&load)
            .filter(|shift| shift.iter().all(|v| v.is_finite() && v.abs() <= MAX_SHIFT))
            .unwrap_or_default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Cell;

    /// A unit square with a second square hinged on its right edge and folded
    /// back over it: vertices 4 and 5 lie on 0 and 3.
    fn flap() -> Input {
        Input {
            xy: vec![[0., 0.], [1., 0.], [1., 1.], [0., 1.], [0., 0.], [0., 1.]],
            faces: vec![vec![0, 1, 2, 3], vec![1, 4, 5, 2]],
            triangles: vec![[0, 1, 2], [0, 2, 3], [1, 4, 5], [1, 5, 2]],
            triangle_faces: vec![0, 0, 1, 1],
            orders: vec![[0, 1]],
            plane_groups: None,
            cells: vec![Cell {
                faces: vec![1, 0],
                point: [0.5, 0.5],
                area: 1.,
            }],
        }
    }
    const FLAT: [[f64; 3]; 2] = [[0.; 3]; 2];

    #[test]
    fn lifted_flap_pulls_back_toward_its_hinge() {
        let lift = 0.2;
        let heights = [0., 0., 0., 0., lift, lift];
        let [front, back] = shifts(&flap(), &heights, FLAT);
        assert_eq!(front, back);
        let input = flap();
        // How much longer the line from `a` to `b` gets. The sheet as a whole
        // is free to turn a little, so lengths are what is fixed.
        let longer = |a: usize, b: usize| {
            let [ax, ay] = input.xy[a];
            let [bx, by] = input.xy[b];
            let length = (bx - ax).hypot(by - ay);
            ((front[2 * b] - front[2 * a]) * (bx - ax)
                + (front[2 * b + 1] - front[2 * a + 1]) * (by - ay))
                / length
        };
        // The free edge moves toward the hinge at x = 1 by lift^2 / (2 * length).
        for (free, hinge) in [(4, 1), (5, 2)] {
            assert!((longer(free, hinge) + lift * lift / 2.).abs() < 1e-5);
        }
        // Along the hinge the flap is not tilted, so nothing shortens.
        assert!(longer(4, 5).abs() < 1e-5);
        // The layer underneath is flat, so it keeps its shape.
        for (a, b) in [(0, 1), (1, 2), (2, 3), (3, 0), (0, 2)] {
            assert!(longer(a, b).abs() < 1e-5);
        }
        // In 3D the flap is its own length again, up to the fourth-order term.
        let across = 1. + longer(4, 1);
        let before = (1. + lift * lift).sqrt() - 1.;
        let after = (across * across + lift * lift).sqrt() - 1.;
        assert!(before > 0.019);
        assert!(after.abs() < 0.001);
    }

    #[test]
    fn shift_grows_with_the_square_of_the_lift() {
        let small = shifts(&flap(), &[0., 0., 0., 0., 0.1, 0.1], FLAT);
        let large = shifts(&flap(), &[0., 0., 0., 0., 0.2, 0.2], FLAT);
        for (a, b) in small[0].iter().zip(&large[0]) {
            assert!((4. * a - b).abs() < 1e-9);
        }
    }

    #[test]
    fn flat_and_evenly_tilted_paper_does_not_move() {
        let flat = shifts(&flap(), &[0.; 6], FLAT);
        assert!(flat[0].iter().all(|&v| v == 0.));
        // Heights that only follow the reference plane are no lift at all.
        let plane = [0.3, -0.1, 0.05];
        let input = flap();
        let heights: Vec<f64> = input
            .xy
            .iter()
            .map(|&[x, y]| plane[0] * x + plane[1] * y + plane[2])
            .collect();
        let tilted = shifts(&input, &heights, [plane, plane]);
        assert!(tilted[0].iter().all(|v| v.abs() < 1e-12));
    }

    #[test]
    fn each_side_measures_from_its_own_reference() {
        let heights = [0., 0., 0., 0., 0.2, 0.2];
        let [front, back] = shifts(&flap(), &heights, [[0.; 3], [-0.2, 0., 0.2]]);
        // Above the back's plane the flap is flat and the base is the lifted one.
        let span = |shift: &[f64], free: usize, hinge: usize| shift[2 * free] - shift[2 * hinge];
        assert!((span(&front, 4, 1) - 0.02).abs() < 1e-5);
        assert!(span(&back, 4, 1).abs() < 1e-5);
        assert!((span(&back, 0, 1) - 0.02).abs() < 1e-5);
    }

    #[test]
    fn a_sliver_does_not_break_the_solve() {
        // A nearly collinear corner on the flat layer's lower edge.
        let mut input = flap();
        input.xy.push([0.2, -1e-8]);
        input.faces[0] = vec![0, 6, 1, 2, 3];
        input.triangles.insert(0, [0, 6, 1]);
        input.triangle_faces.insert(0, 0);
        let [front, _] = shifts(&input, &[0., 0., 0., 0., 0.2, 0.2, 0.], FLAT);
        assert_eq!(front.len(), 14);
        assert!((front[8] - front[2] - 0.02).abs() < 1e-4);
    }
}
