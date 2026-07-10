use crate::error::{BpError, BpResult};
use crate::math::geometry::vector::Vector;
use crate::math::{BpFraction, parse_fraction};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Point {
    pub x: BpFraction,
    pub y: BpFraction,
}

impl Point {
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

    pub fn parse_test(value: &str) -> BpResult<Self> {
        let values = parse_coordinate_pair(value)?;
        Ok(Self::new(values.0, values.1))
    }

    pub fn value(&self) -> (f64, f64) {
        (self.x.value(), self.y.value())
    }

    pub fn dist(&self, other: &Self) -> f64 {
        self.sub_point(other).length()
    }

    pub fn sub_point(&self, other: &Self) -> Vector {
        Vector::new(self.x.sub(&other.x), self.y.sub(&other.y))
    }

    pub fn sub_vector(&self, vector: &Vector) -> Self {
        Self::new(self.x.sub(&vector.x), self.y.sub(&vector.y))
    }

    pub fn add_vector(&self, vector: &Vector) -> Self {
        Self::new(self.x.add(&vector.x), self.y.add(&vector.y))
    }

    pub fn equals(&self, other: &Self) -> bool {
        self.x.equals(&other.x) && self.y.equals(&other.y)
    }

    pub fn is_integral(&self) -> bool {
        let mut x = self.x.clone();
        let mut y = self.y.clone();
        x.is_integral() && y.is_integral()
    }

    pub fn transform(&self, fx: i64, fy: i64) -> Self {
        Self::new(self.x.fac(fx), self.y.fac(fy))
    }
}

impl fmt::Display for Point {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "({}, {})", self.x, self.y)
    }
}

pub(crate) fn parse_coordinate_pair(value: &str) -> BpResult<(BpFraction, BpFraction)> {
    let numbers = value
        .split(|c: char| !(c == '-' || c == '/' || c.is_ascii_digit()))
        .filter(|part| !part.is_empty())
        .map(parse_number_token)
        .collect::<BpResult<Vec<_>>>()?;
    if numbers.len() != 2 {
        return Err(BpError::InvalidInput(format!(
            "invalid coordinate pair {value}"
        )));
    }
    Ok((numbers[0].clone(), numbers[1].clone()))
}

pub(crate) fn parse_number_token(token: &str) -> BpResult<BpFraction> {
    if token.contains('/') {
        parse_fraction(token)
    } else {
        token
            .parse::<i64>()
            .map(BpFraction::from_integer)
            .map_err(|_| BpError::InvalidInput(format!("invalid numeric token {token}")))
    }
}
