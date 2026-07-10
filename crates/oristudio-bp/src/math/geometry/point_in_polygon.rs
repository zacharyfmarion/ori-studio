use crate::math::geometry::{Line, Point};

pub fn point_in_polygon(point: &Point, path: &[Point], boundary: bool) -> bool {
    let len = path.len();
    if len == 2 {
        return boundary && Line::new(path[0].clone(), path[1].clone()).contains(point, true);
    }

    let mut dx = Vec::with_capacity(len);
    let mut dy = Vec::with_capacity(len);
    for value in path {
        dx.push(value.x.sub(&point.x).value());
        dy.push(value.y.sub(&point.y).value());
    }

    let mut inside = false;
    for i in 0..len {
        let j = if i == 0 { len - 1 } else { i - 1 };
        let (xi, yi) = (dx[i], dy[i]);
        let (xj, yj) = (dx[j], dy[j]);
        let mx = xi >= 0.0;
        let nx = xj >= 0.0;
        let my = yi >= 0.0;
        let ny = yj >= 0.0;
        if !((my || ny) && (mx || nx)) || mx && nx {
            continue;
        }
        if !(my && ny && (mx || nx) && !(mx && nx)) {
            let test = (yi * xj - xi * yj) / (xj - xi);
            if test < 0.0 {
                continue;
            }
            if test == 0.0 {
                return boundary;
            }
        }
        inside = !inside;
    }
    inside
}
