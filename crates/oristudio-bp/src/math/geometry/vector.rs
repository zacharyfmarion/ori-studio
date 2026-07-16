use crate::error::BpResult;
use crate::math::BpFraction;
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Vector {
    pub x: BpFraction,
    pub y: BpFraction,
}

impl Vector {
    pub const ZERO: Self = Self {
        x: BpFraction::ZERO,
        y: BpFraction::ZERO,
    };

    pub fn new(x: BpFraction, y: BpFraction) -> Self {
        Self { x, y }
    }

    pub fn from_integers(x: i64, y: i64) -> Self {
        Self::new(BpFraction::from_integer(x), BpFraction::from_integer(y))
    }

    pub fn from_numbers(x: f64, y: f64) -> BpResult<Self> {
        Ok(Self::new(
            BpFraction::from_number(x)?,
            BpFraction::from_number(y)?,
        ))
    }

    pub fn length(&self) -> f64 {
        self.dot(self).sqrt()
    }

    pub fn slope(&self) -> BpResult<BpFraction> {
        self.y.div(&self.x)
    }

    pub fn rotate90(&self) -> Self {
        Self::new(self.y.negated(), self.x.clone())
    }

    pub fn normalize(&self) -> BpResult<Self> {
        Ok(self.scale(&BpFraction::from_number(self.length())?.inverted()?))
    }

    pub fn scale(&self, ratio: &BpFraction) -> Self {
        Self::new(self.x.mul(ratio), self.y.mul(ratio))
    }

    pub fn dot(&self, other: &Self) -> f64 {
        self.x.mul(&other.x).add_mut(&self.y.mul(&other.y)).value()
    }

    pub fn negated(&self) -> Self {
        Self::new(self.x.negated(), self.y.negated())
    }

    pub fn angle(&self) -> f64 {
        self.y.value().atan2(self.x.value())
    }

    pub fn reduce(&self) -> BpResult<Self> {
        let mut x = self.x.clone();
        let mut y = self.y.clone();
        let (x, y) = x.reduce_with(&mut y)?;
        Ok(Self::new(x, y))
    }

    pub fn reduce_to_int(&self) -> BpResult<Self> {
        let mut x = self.x.clone();
        let mut y = self.y.clone();
        let (x, y) = x.reduce_to_int_with(&mut y)?;
        Ok(Self::new(x, y))
    }

    pub fn double_angle(&self) -> BpResult<Self> {
        let reduced = self.reduce()?;
        let first = reduced.x.mul(&reduced.x).sub(&reduced.y.mul(&reduced.y));
        let second = BpFraction::TWO.mul(&reduced.x).mul(&reduced.y);
        Ok(Self::new(first, second))
    }

    pub fn parallel(&self, other: &Self) -> bool {
        self.x.mul(&other.y).equals(&self.y.mul(&other.x))
    }

    pub fn equals(&self, other: &Self) -> bool {
        self.x.equals(&other.x) && self.y.equals(&other.y)
    }
}

impl fmt::Display for Vector {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "({}, {})", self.x, self.y)
    }
}
