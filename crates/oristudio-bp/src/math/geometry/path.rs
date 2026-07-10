#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PathPoint {
    pub x: f64,
    pub y: f64,
}

impl PathPoint {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

fn corner_direction(prev: PathPoint, next: PathPoint) -> u8 {
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    (if dx * dy < 0.0 { 0 } else { 1 }) + (if dx < 0.0 { 0 } else { 2 })
}

pub fn map_directions(path: &[PathPoint]) -> Vec<u8> {
    let len = path.len();
    let mut result = Vec::with_capacity(len);
    for i in 0..len {
        let j = if i == 0 { len - 1 } else { i - 1 };
        let next = path.get(i + 1).copied().unwrap_or(path[0]);
        result.push(corner_direction(path[j], next));
    }
    result
}

pub fn deduplicate(path: &[PathPoint]) -> Vec<PathPoint> {
    let len = path.len();
    let mut result = Vec::with_capacity(len);
    for i in 0..len {
        let j = if i == 0 { len - 1 } else { i - 1 };
        let prev = path[j];
        let point = path[i];
        if prev.x != point.x || prev.y != point.y {
            result.push(point);
        }
    }
    result
}

pub fn path_to_string(path: &[PathPoint]) -> String {
    path.iter()
        .map(point_to_string)
        .collect::<Vec<_>>()
        .join(",")
}

pub fn point_to_string(point: &PathPoint) -> String {
    format!("({},{})", point.x, point.y)
}

pub fn is_clockwise(path: &[PathPoint]) -> bool {
    let len = path.len();
    let mut min_x = f64::INFINITY;
    let mut min_x_delta = 0.0;
    for i in 0..len {
        let point = path[i];
        if point.x < min_x {
            min_x = point.x;
            let j = if i == 0 { len - 1 } else { i - 1 };
            let next = path.get(i + 1).copied().unwrap_or(path[0]);
            min_x_delta = next.y - path[j].y;
        }
    }
    min_x_delta > 0.0
}
