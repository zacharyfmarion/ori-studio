use crate::error::{BpError, BpResult};
use crate::math::gcd::reduce_int;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

const MAX_SAFE: i64 = 67_108_863;
const JS_MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
const JS_MIN_SAFE_INTEGER: f64 = -9_007_199_254_740_991.0;
const DEFAULT_ERROR: f64 = 1e-10;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BpFraction {
    numerator: i64,
    denominator: u64,
}

impl BpFraction {
    pub const ZERO: Self = Self {
        numerator: 0,
        denominator: 1,
    };
    pub const ONE: Self = Self {
        numerator: 1,
        denominator: 1,
    };
    pub const TWO: Self = Self {
        numerator: 2,
        denominator: 1,
    };

    pub fn from_integer(numerator: i64) -> Self {
        Self {
            numerator,
            denominator: 1,
        }
    }

    pub fn new(numerator: i64, denominator: u64) -> BpResult<Self> {
        if denominator == 0 {
            return Err(BpError::InvalidInput(
                "fraction denominator must be positive".to_string(),
            ));
        }
        Ok(Self {
            numerator,
            denominator,
        }
        .normalize())
    }

    pub fn from_number(value: f64) -> BpResult<Self> {
        Self::from_ratio_number(value, 1)
    }

    pub fn from_ratio_number(numerator: f64, denominator: u64) -> BpResult<Self> {
        let denominator_f = denominator as f64;
        if numerator.is_finite()
            && numerator.fract() == 0.0
            && is_safe_integer(numerator)
            && denominator <= JS_MAX_SAFE_INTEGER as u64
        {
            return Self::new(numerator as i64, denominator);
        }
        let ratio = numerator / denominator_f;
        if ratio.floor().is_finite() && is_safe_integer(ratio.floor()) {
            return to_fraction(ratio, DEFAULT_ERROR);
        }
        Err(BpError::InvalidInput(format!(
            "invalid fraction input {numerator}/{denominator}"
        )))
    }

    pub fn numerator(&self) -> i64 {
        self.numerator
    }

    pub fn denominator(&self) -> u64 {
        self.denominator
    }

    pub fn value(&self) -> f64 {
        self.numerator as f64 / self.denominator as f64
    }

    pub fn equals(&self, other: &Self) -> bool {
        self.numerator as i128 * other.denominator as i128
            == other.numerator as i128 * self.denominator as i128
    }

    pub fn lt(&self, other: &Self) -> bool {
        (self.numerator as i128 * other.denominator as i128)
            < (other.numerator as i128 * self.denominator as i128)
    }

    pub fn gt(&self, other: &Self) -> bool {
        (self.numerator as i128 * other.denominator as i128)
            > (other.numerator as i128 * self.denominator as i128)
    }

    pub fn le(&self, other: &Self) -> bool {
        !self.gt(other)
    }

    pub fn ge(&self, other: &Self) -> bool {
        !self.lt(other)
    }

    pub fn negate_mut(&mut self) -> &mut Self {
        self.numerator = -self.numerator;
        self
    }

    pub fn invert_mut(&mut self) -> BpResult<&mut Self> {
        if self.numerator == 0 {
            return Err(BpError::InvalidInput(
                "cannot invert zero fraction".to_string(),
            ));
        }
        let sign = self.numerator.signum();
        let denominator = self.numerator.unsigned_abs();
        self.numerator = sign * self.denominator as i64;
        self.denominator = denominator;
        Ok(self)
    }

    pub fn add_mut(&mut self, other: &Self) -> &mut Self {
        let (q1, q2, divisor) = reduce_int(self.denominator as i64, other.denominator as i64);
        self.numerator = self.numerator * q2 + other.numerator * q1;
        self.denominator = (q1 as u64) * (q2 as u64) * divisor;
        self.normalize_mut()
    }

    pub fn sub_mut(&mut self, other: &Self) -> &mut Self {
        let (q1, q2, divisor) = reduce_int(self.denominator as i64, other.denominator as i64);
        self.numerator = self.numerator * q2 - other.numerator * q1;
        self.denominator = (q1 as u64) * (q2 as u64) * divisor;
        self.normalize_mut()
    }

    pub fn mul_mut(&mut self, other: &Self) -> &mut Self {
        self.numerator *= other.numerator;
        self.denominator *= other.denominator;
        self.normalize_mut()
    }

    pub fn div_mut(&mut self, other: &Self) -> BpResult<&mut Self> {
        if other.numerator == 0 {
            return Err(BpError::InvalidInput(
                "cannot divide by zero fraction".to_string(),
            ));
        }
        let sign = other.numerator.signum();
        self.numerator *= sign * other.denominator as i64;
        self.denominator *= other.numerator.unsigned_abs();
        Ok(self.normalize_mut())
    }

    pub fn fac_mut(&mut self, sign: i64) -> &mut Self {
        self.numerator *= sign;
        self
    }

    pub fn is_integral(&mut self) -> bool {
        self.simplify_mut();
        self.denominator == 1
    }

    pub fn negated(&self) -> Self {
        let mut result = self.clone();
        result.negate_mut();
        result
    }

    pub fn inverted(&self) -> BpResult<Self> {
        let mut result = self.clone();
        result.invert_mut()?;
        Ok(result)
    }

    pub fn add(&self, other: &Self) -> Self {
        let mut result = self.clone();
        result.add_mut(other);
        result
    }

    pub fn sub(&self, other: &Self) -> Self {
        let mut result = self.clone();
        result.sub_mut(other);
        result
    }

    pub fn mul(&self, other: &Self) -> Self {
        let mut result = self.clone();
        result.mul_mut(other);
        result
    }

    pub fn div(&self, other: &Self) -> BpResult<Self> {
        let mut result = self.clone();
        result.div_mut(other)?;
        Ok(result)
    }

    pub fn fac(&self, sign: i64) -> Self {
        let mut result = self.clone();
        result.fac_mut(sign);
        result
    }

    pub fn reduce_with(&mut self, other: &mut Self) -> BpResult<(Self, Self)> {
        self.simplify_mut();
        other.simplify_mut();
        let (n1, n2, _) = reduce_int(self.numerator, other.numerator);
        let (d1, d2, _) = reduce_int(self.denominator as i64, other.denominator as i64);
        Ok((Self::new(n1, d1 as u64)?, Self::new(n2, d2 as u64)?))
    }

    pub fn reduce_to_int_with(&mut self, other: &mut Self) -> BpResult<(Self, Self)> {
        self.simplify_mut();
        other.simplify_mut();
        let (n1, n2, _) = reduce_int(
            self.numerator * other.denominator as i64,
            self.denominator as i64 * other.numerator,
        );
        Ok((Self::new(n1, 1)?, Self::new(n2, 1)?))
    }

    pub fn simplified_string(&mut self) -> String {
        self.simplify_mut();
        self.to_string()
    }

    fn normalize(mut self) -> Self {
        self.normalize_mut();
        self
    }

    fn normalize_mut(&mut self) -> &mut Self {
        if self.denominator > MAX_SAFE as u64 || self.numerator.unsigned_abs() > MAX_SAFE as u64 {
            self.simplify_mut();
        }
        self
    }

    fn simplify_mut(&mut self) {
        let (numerator, denominator, _) = reduce_int(self.numerator, self.denominator as i64);
        self.numerator = numerator;
        self.denominator = denominator as u64;
    }
}

impl fmt::Display for BpFraction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut value = self.clone();
        value.simplify_mut();
        if value.denominator == 1 {
            write!(f, "{}", value.numerator)
        } else {
            write!(f, "{}/{}", value.numerator, value.denominator)
        }
    }
}

impl Serialize for BpFraction {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for BpFraction {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        parse_fraction(&value).map_err(serde::de::Error::custom)
    }
}

pub fn to_fraction(value: f64, error: f64) -> BpResult<BpFraction> {
    if !value.is_finite() || !error.is_finite() || error < 0.0 {
        return Err(BpError::InvalidInput(format!(
            "invalid fraction approximation input {value}"
        )));
    }
    to_fraction_recursive(value, 1, 0, error)
}

pub fn parse_fraction(expression: &str) -> BpResult<BpFraction> {
    let Some((numerator, denominator)) = expression.split_once('/') else {
        return expression
            .parse::<i64>()
            .map_err(|_| BpError::InvalidInput("Invalid expression".to_string()))
            .and_then(|n| BpFraction::new(n, 1));
    };
    let numerator = numerator
        .parse::<i64>()
        .map_err(|_| BpError::InvalidInput("Invalid expression".to_string()))?;
    let denominator = denominator
        .parse::<u64>()
        .map_err(|_| BpError::InvalidInput("Invalid expression".to_string()))?;
    BpFraction::new(numerator, denominator)
}

fn to_fraction_recursive(value: f64, k2: i64, k1: i64, error: f64) -> BpResult<BpFraction> {
    let n = value.floor();
    let r = value - n;
    let k0 = n as i64 * k1 + k2;
    let fraction = BpFraction::from_ratio_number(n, 1)?;
    if r / k0 as f64 / ((1.0 - r) * k0 as f64 + k1 as f64) < error {
        Ok(fraction)
    } else {
        let mut tail = to_fraction_recursive(1.0 / r, k1, k0, error)?;
        tail.invert_mut()?;
        tail.add_mut(&fraction);
        Ok(tail)
    }
}

fn is_safe_integer(value: f64) -> bool {
    (JS_MIN_SAFE_INTEGER..=JS_MAX_SAFE_INTEGER).contains(&value)
}
