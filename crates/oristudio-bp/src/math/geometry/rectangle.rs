use crate::math::geometry::float::epsilon_same;

#[derive(Debug, Clone, PartialEq)]
pub struct Rectangle {
    p1: (f64, f64),
    p2: (f64, f64),
}

impl Rectangle {
    pub fn new(mut p1: (f64, f64), mut p2: (f64, f64)) -> Self {
        if p1.0 > p2.0 {
            std::mem::swap(&mut p1, &mut p2);
        }
        if p1.1 > p2.1 {
            (p1, p2) = ((p1.0, p2.1), (p2.0, p1.1));
        }
        Self { p1, p2 }
    }

    pub fn contains(&self, that: &Self) -> bool {
        self.p1.0 <= that.p1.0
            && self.p1.1 <= that.p1.1
            && self.p2.0 >= that.p2.0
            && self.p2.1 >= that.p2.1
    }

    pub fn equals(&self, that: &Self) -> bool {
        epsilon_same(self.p1, that.p1, crate::math::geometry::float::EPSILON)
            && epsilon_same(self.p2, that.p2, crate::math::geometry::float::EPSILON)
    }
}
