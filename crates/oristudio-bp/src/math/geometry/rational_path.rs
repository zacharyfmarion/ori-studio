use crate::math::geometry::{Line, Matrix, Point, Vector};

pub type RationalPath = Vec<Point>;

pub fn to_lines(path: &[Point]) -> Vec<Line> {
    path.iter()
        .enumerate()
        .map(|(index, point)| {
            let next = path.get(index + 1).unwrap_or(&path[0]);
            Line::new(point.clone(), next.clone())
        })
        .collect()
}

pub fn triangle_transform(triangle: &[Point], to: &Point) -> Option<Point> {
    let [p1, p2, p3] = triangle else {
        return None;
    };
    let v1 = to.sub_point(p1);
    let v2 = p2.sub_point(p1);
    let v3 = p3.sub_point(p1);

    if v2.equals(&Vector::ZERO) || v1.equals(&Vector::ZERO) {
        return None;
    }

    let matrix = Matrix::get_transform_matrix(&v2, &v1)?;
    Some(p1.add_vector(&matrix.multiply_vector(&v3)))
}

pub fn join_paths(p1: &[Point], p2: &[Point]) -> RationalPath {
    let mut p1 = p1.to_vec();
    let mut p2 = p2.to_vec();
    for i in 0..p1.len() {
        for j in 0..p2.len() {
            if p1[i].equals(&p2[j]) {
                p2.rotate_left(j);
                p1.splice(i..i + 2, p2);
                return p1;
            }
        }
    }
    p1
}

pub fn shift_path(path: &[Point], vector: &Vector) -> RationalPath {
    path.iter().map(|point| point.add_vector(vector)).collect()
}
