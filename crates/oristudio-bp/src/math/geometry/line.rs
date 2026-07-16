use crate::error::{BpError, BpResult};
use crate::math::geometry::matrix::Matrix;
use crate::math::geometry::point::{Point, parse_coordinate_pair};
use crate::math::geometry::vector::Vector;
use crate::math::{BpFraction, parse_fraction};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub p1: Point,
    pub p2: Point,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Intersection {
    pub line: Line,
    pub point: Point,
    pub dist: BpFraction,
}

impl Line {
    pub fn new(p1: Point, p2: Point) -> Self {
        Self { p1, p2 }
    }

    pub fn from_point_vector(point: Point, vector: &Vector) -> Self {
        let p2 = point.add_vector(vector);
        Self::new(point, p2)
    }

    pub fn distinct(lines: Vec<Self>) -> Vec<Self> {
        let mut signatures = Vec::<String>::new();
        let mut result = Vec::new();
        for line in lines {
            let signature = line.to_string();
            if !signatures.contains(&signature) {
                signatures.push(signature);
                result.push(line);
            }
        }
        result
    }

    pub fn subtract(l1: &[Self], l2: &[Self]) -> Vec<Self> {
        let mut result = Vec::new();
        let mut slope_map: Vec<(u64, Vec<Self>)> = Vec::new();
        for line in l2 {
            let key = line.slope().to_bits();
            if let Some((_, lines)) = slope_map.iter_mut().find(|(slope, _)| *slope == key) {
                lines.push(line.clone());
            } else {
                slope_map.push((key, vec![line.clone()]));
            }
        }

        for line in l1 {
            let key = line.slope().to_bits();
            if let Some((_, lines)) = slope_map.iter().find(|(slope, _)| *slope == key) {
                result.extend(line.cancel(lines));
            } else {
                result.push(line.clone());
            }
        }
        result
    }

    pub fn is_degenerated(&self) -> bool {
        self.p1.equals(&self.p2)
    }

    pub fn vector(&self) -> Vector {
        self.p2.sub_point(&self.p1)
    }

    pub fn slope(&self) -> f64 {
        let dx = self.p1.x.sub(&self.p2.x);
        if dx.numerator() == 0 {
            f64::INFINITY
        } else {
            self.p1
                .y
                .sub(&self.p2.y)
                .div(&dx)
                .map_or(f64::NAN, |f| f.value())
        }
    }

    pub fn equals(&self, other: &Self) -> bool {
        self.p1.equals(&other.p1) && self.p2.equals(&other.p2)
            || self.p1.equals(&other.p2) && self.p2.equals(&other.p1)
    }

    pub fn reverse(&self) -> Self {
        Self::new(self.p2.clone(), self.p1.clone())
    }

    pub fn point_is_on_right(&self, point: &Point, allow_eq: bool) -> bool {
        let vector = point.sub_point(&self.p1).rotate90();
        let dot = vector.dot(&self.vector());
        dot > 0.0 || allow_eq && dot == 0.0
    }

    pub fn contains(&self, point: &Point, include_endpoints: bool) -> bool {
        if include_endpoints && (point.equals(&self.p1) || point.equals(&self.p2)) {
            return true;
        }
        let v1 = point.sub_point(&self.p1);
        let v2 = point.sub_point(&self.p2);
        v1.x.mul(&v2.y).equals(&v2.x.mul(&v1.y)) && v1.dot(&v2) < 0.0
    }

    pub fn line_contains(&self, point: &Point) -> bool {
        self.vector().parallel(&point.sub_point(&self.p1))
    }

    pub fn intersect_line(&self, line: &Self, as_segment: bool) -> Option<Point> {
        get_intersection(
            self,
            &line.p1,
            &line.vector(),
            as_segment,
            as_segment,
            false,
        )
        .map(|intersection| intersection.point)
    }

    pub fn intersection(
        &self,
        point: &Point,
        vector: &Vector,
        headless: bool,
        tailless: bool,
    ) -> Option<Point> {
        get_intersection(self, point, vector, headless, tailless, false)
            .map(|intersection| intersection.point)
    }

    pub fn transform(&self, fx: i64, fy: i64) -> Self {
        Self::new(self.p1.transform(fx, fy), self.p2.transform(fx, fy))
    }

    pub fn add(&self, vector: &Vector) -> Self {
        Self::new(self.p1.add_vector(vector), self.p2.add_vector(vector))
    }

    pub fn x_orient(&self) -> (Point, Point) {
        if self.p1.x.gt(&self.p2.x) {
            (self.p2.clone(), self.p1.clone())
        } else {
            (self.p1.clone(), self.p2.clone())
        }
    }

    pub fn grid_points(&self) -> BpResult<Vec<Point>> {
        let mut result = Vec::new();
        let dx = self.p2.x.value() - self.p1.x.value();
        let dy = self.p2.y.value() - self.p1.y.value();
        if dx == 0.0 && dy == 0.0 {
            if self.p1.is_integral() {
                result.push(self.p1.clone());
            }
            return Ok(result);
        }
        if dx == 0.0 {
            return self.axis_grid_points(false);
        }
        if dy == 0.0 {
            return self.axis_grid_points(true);
        }
        if dx.abs() < dy.abs() {
            let f = dx.signum();
            let mut x = directed_int(self.p1.x.value(), f);
            while x as f64 * f <= self.p2.x.value() * f {
                let point = self.x_intersection(x)?;
                if point.is_integral() {
                    result.push(point);
                }
                x += f as i64;
            }
        } else {
            let f = dy.signum();
            let mut y = directed_int(self.p1.y.value(), f);
            while y as f64 * f <= self.p2.y.value() * f {
                let point = self.y_intersection(y)?;
                if point.is_integral() {
                    result.push(point);
                }
                y += f as i64;
            }
        }
        Ok(result)
    }

    pub fn x_intersection(&self, x: i64) -> BpResult<Point> {
        let vector = self.vector();
        let f = BpFraction::from_integer(x);
        Ok(Point::new(
            f.clone(),
            self.p1.y.sub(&vector.slope()?.mul(&self.p1.x.sub(&f))),
        ))
    }

    pub fn y_intersection(&self, y: i64) -> BpResult<Point> {
        let vector = self.vector();
        let f = BpFraction::from_integer(y);
        let mut ratio = self.p1.y.sub(&f);
        ratio.div_mut(&vector.slope()?)?;
        Ok(Point::new(self.p1.x.sub(&ratio), f))
    }

    pub fn reflect(&self, vector: &Vector) -> BpResult<Vector> {
        let matrix = Matrix::new(
            vector.x.negated(),
            vector.y.clone(),
            vector.y.negated(),
            vector.x.negated(),
        );
        let inverse = matrix
            .inverse()
            .ok_or_else(|| BpError::InvalidInput("non-invertible reflection matrix".to_string()))?;
        let line_vector = self.p2.sub_point(&self.p1);
        let rotated = inverse.multiply_vector(&line_vector);
        let doubled = rotated.double_angle()?;
        matrix.multiply_vector(&doubled).reduce()
    }

    pub fn perpendicular(&self, vector: &Vector) -> bool {
        self.vector().dot(vector) == 0.0
    }

    pub fn shift(&self, vector: &Vector) -> Self {
        Self::new(self.p1.add_vector(vector), self.p2.add_vector(vector))
    }

    fn cancel(&self, set: &[Self]) -> Vec<Self> {
        let mut result = vec![self.clone()];
        for other in set {
            let mut next = Vec::new();
            for line in result {
                next.extend(line.cancel_core(other));
            }
            result = next;
        }
        result
    }

    fn cancel_core(&self, line: &Self) -> Vec<Self> {
        let a = self.contains(&line.p1, true);
        let b = self.contains(&line.p2, true);
        let c = line.contains(&self.p1, true);
        let d = line.contains(&self.p2, true);

        if c && d {
            return Vec::new();
        }
        if !a && !b {
            return vec![self.clone()];
        }
        if a && b {
            let l11 = Self::new(self.p1.clone(), line.p1.clone());
            let l12 = Self::new(self.p1.clone(), line.p2.clone());
            let l21 = Self::new(self.p2.clone(), line.p1.clone());
            let l22 = Self::new(self.p2.clone(), line.p2.clone());
            if l11.is_degenerated() {
                vec![l22]
            } else if l12.is_degenerated() {
                vec![l21]
            } else if l21.is_degenerated() {
                vec![l12]
            } else if l22.is_degenerated() {
                vec![l11]
            } else if l11.contains(&line.p2, false) {
                vec![l12, l21]
            } else {
                vec![l11, l22]
            }
        } else {
            let p1 = if a { &line.p1 } else { &line.p2 };
            let p2 = if d { &self.p1 } else { &self.p2 };
            if p1.equals(p2) {
                Vec::new()
            } else {
                vec![Self::new(p1.clone(), p2.clone())]
            }
        }
    }

    fn axis_grid_points(&self, horizontal: bool) -> BpResult<Vec<Point>> {
        let mut result = Vec::new();
        if horizontal {
            let y = self.p1.y.clone();
            let start = self.p1.x.value().min(self.p2.x.value()).ceil() as i64;
            let end = self.p1.x.value().max(self.p2.x.value()).floor() as i64;
            for x in start..=end {
                let point = Point::new(BpFraction::from_integer(x), y.clone());
                if point.is_integral() {
                    result.push(point);
                }
            }
        } else {
            let x = self.p1.x.clone();
            let start = self.p1.y.value().min(self.p2.y.value()).ceil() as i64;
            let end = self.p1.y.value().max(self.p2.y.value()).floor() as i64;
            for y in start..=end {
                let point = Point::new(x.clone(), BpFraction::from_integer(y));
                if point.is_integral() {
                    result.push(point);
                }
            }
        }
        Ok(result)
    }
}

impl fmt::Display for Line {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut points = [self.p1.to_string(), self.p2.to_string()];
        points.sort();
        write!(f, "{},{}", points[0], points[1])
    }
}

pub fn get_intersection(
    line: &Line,
    point: &Point,
    vector: &Vector,
    headless: bool,
    tailless: bool,
    target_as_ray: bool,
) -> Option<Intersection> {
    let v1 = line.p2.sub_point(&line.p1);
    let matrix = Matrix::new(
        v1.x.clone(),
        vector.x.clone(),
        v1.y.clone(),
        vector.y.clone(),
    )
    .inverse()?;
    let r = matrix.multiply_point(&Point::new(
        point.x.sub(&line.p1.x),
        point.y.sub(&line.p1.y),
    ));
    let a = r.x;
    let b = r.y.negated();
    if a.lt(&BpFraction::ZERO) || !target_as_ray && a.gt(&BpFraction::ONE) {
        return None;
    }
    if headless && b.lt(&BpFraction::ZERO) {
        return None;
    }
    if tailless && b.gt(&BpFraction::ONE) {
        return None;
    }

    Some(Intersection {
        line: line.clone(),
        point: point.add_vector(&vector.scale(&b)),
        dist: b,
    })
}

pub fn parse_line(value: &str) -> BpResult<Line> {
    let parts = value.split('-').collect::<Vec<_>>();
    if parts.len() < 2 {
        return Err(BpError::InvalidInput(format!("invalid line {value}")));
    }
    let numbers = value
        .split(|c: char| !(c == '-' || c == '/' || c.is_ascii_digit()))
        .filter(|part| !part.is_empty() && *part != "-")
        .map(|token| {
            if token.contains('/') {
                parse_fraction(token)
            } else {
                token
                    .parse::<i64>()
                    .map(BpFraction::from_integer)
                    .map_err(|_| BpError::InvalidInput(format!("invalid numeric token {token}")))
            }
        })
        .collect::<BpResult<Vec<_>>>()?;
    if numbers.len() != 4 {
        let endpoints = value
            .split_once('-')
            .ok_or_else(|| BpError::InvalidInput(format!("invalid line endpoints {value}")))?;
        let p1 = parse_coordinate_pair(endpoints.0)?;
        let p2 = parse_coordinate_pair(endpoints.1)?;
        return Ok(Line::new(Point::new(p1.0, p1.1), Point::new(p2.0, p2.1)));
    }
    Ok(Line::new(
        Point::new(numbers[0].clone(), numbers[1].clone()),
        Point::new(numbers[2].clone(), numbers[3].clone()),
    ))
}

fn directed_int(x: f64, f: f64) -> i64 {
    if f > 0.0 {
        x.ceil() as i64
    } else {
        x.floor() as i64
    }
}
