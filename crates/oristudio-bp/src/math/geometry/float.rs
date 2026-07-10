pub const EPSILON: f64 = 1e-10;

pub fn is_almost_zero(x: f64, eps: f64) -> bool {
    x.abs() < eps
}

pub fn epsilon_same(p1: (f64, f64), p2: (f64, f64), eps: f64) -> bool {
    is_almost_zero(p1.0 - p2.0, eps) && is_almost_zero(p1.1 - p2.1, eps)
}

pub fn fix_zero(x: f64) -> f64 {
    if is_almost_zero(x, EPSILON) { 0.0 } else { x }
}
