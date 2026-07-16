use crate::math::geometry::path::PathPoint;

pub fn is_inside(point: PathPoint, path: &[PathPoint]) -> bool {
    winding_number(point, path, false) != 0
}

fn winding_number(point: PathPoint, path: &[PathPoint], boundary: bool) -> i32 {
    let mut result = 0;
    for i in 0..path.len() {
        let j = if i == 0 { path.len() - 1 } else { i - 1 };
        let pi = path[i];
        let pj = path[j];
        let left = is_left(pj, pi, point);
        if !boundary && left == 0.0 {
            return 0;
        }
        if pj.y <= point.y {
            if pi.y > point.y && left > 0.0 {
                result += 1;
            }
        } else if pi.y <= point.y && left < 0.0 {
            result -= 1;
        }
    }
    result
}

fn is_left(p0: PathPoint, p1: PathPoint, p2: PathPoint) -> f64 {
    (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)
}
