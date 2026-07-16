use crate::math::BpFraction;
use crate::math::geometry::{Point, Vector};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Matrix {
    a: BpFraction,
    b: BpFraction,
    c: BpFraction,
    d: BpFraction,
    det: BpFraction,
}

impl Matrix {
    pub fn new(a: BpFraction, b: BpFraction, c: BpFraction, d: BpFraction) -> Self {
        let det = a.mul(&d).sub(&b.mul(&c));
        Self { a, b, c, d, det }
    }

    pub fn with_det(
        a: BpFraction,
        b: BpFraction,
        c: BpFraction,
        d: BpFraction,
        det: BpFraction,
    ) -> Self {
        Self { a, b, c, d, det }
    }

    pub fn to_array(&self) -> [f64; 4] {
        [
            self.a.value(),
            self.b.value(),
            self.c.value(),
            self.d.value(),
        ]
    }

    pub fn inverse(&self) -> Option<Self> {
        if self.det.equals(&BpFraction::ZERO) {
            return None;
        }
        Some(Self::with_det(
            self.d.div(&self.det).ok()?,
            self.b.negated().div(&self.det).ok()?,
            self.c.negated().div(&self.det).ok()?,
            self.a.div(&self.det).ok()?,
            self.det.inverted().ok()?,
        ))
    }

    pub fn multiply_point(&self, point: &Point) -> Point {
        Point::new(
            self.a.mul(&point.x).add(&self.b.mul(&point.y)),
            self.c.mul(&point.x).add(&self.d.mul(&point.y)),
        )
    }

    pub fn multiply_vector(&self, vector: &Vector) -> Vector {
        Vector::new(
            self.a.mul(&vector.x).add(&self.b.mul(&vector.y)),
            self.c.mul(&vector.x).add(&self.d.mul(&vector.y)),
        )
    }

    pub fn get_transform_matrix(from: &Vector, to: &Vector) -> Option<Self> {
        let m = Self::new(
            from.x.clone(),
            from.y.negated(),
            from.y.clone(),
            from.x.clone(),
        );
        let result = m.inverse()?.multiply_vector(to);
        Some(Self::new(
            result.x.clone(),
            result.y.negated(),
            result.y,
            result.x,
        ))
    }
}

impl fmt::Display for Matrix {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{},{},{},{}", self.a, self.b, self.c, self.d)
    }
}
