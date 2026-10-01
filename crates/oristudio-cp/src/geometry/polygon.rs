use super::circle::Circle;
use super::epsilon::Epsilon;
use super::line_segment::{Intersection, LineSegment};
use super::orita_calc::{
    center, determine_line_segment_distance, determine_line_segment_intersection,
    determine_line_segment_intersection_sweet, determine_line_segment_intersection_with_precision,
    distance, find_intersection_segments, mid_point,
};
use super::point::Point;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

/// Oriedita polygon carrier.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Polygon {
    pub vertices: Vec<Point>,
}

impl Polygon {
    pub fn new(vertices: Vec<Point>) -> Self {
        Self { vertices }
    }

    pub fn add(&mut self, point: Point) {
        self.vertices.push(point);
    }

    pub fn get(&self, index: usize) -> Option<Point> {
        self.vertices.get(index).copied()
    }

    pub fn set(&mut self, index: usize, point: Point) -> bool {
        if let Some(target) = self.vertices.get_mut(index) {
            *target = point;
            true
        } else {
            false
        }
    }

    pub fn line_segments(&self) -> Vec<LineSegment> {
        let mut line_segments = Vec::with_capacity(self.vertices.len());
        if self.vertices.is_empty() {
            return line_segments;
        }

        for index in 0..self.vertices.len() {
            let next = if index == self.vertices.len() - 1 {
                0
            } else {
                index + 1
            };
            line_segments.push(LineSegment::new(self.vertices[index], self.vertices[next]));
        }

        line_segments
    }

    pub fn inside_outside_check(&self, s0: &LineSegment) -> PolygonIntersection {
        let mut intersections = vec![s0.a, s0.b];

        for segment in self.line_segments() {
            match determine_line_segment_intersection(s0, &segment) {
                Intersection::Intersects1
                | Intersection::IntersectsTShapeS2VerticalBar27
                | Intersection::IntersectsTShapeS2VerticalBar28 => {
                    intersections.push(find_intersection_segments(s0, &segment));
                }
                Intersection::ParallelStartOfS1ContainsStartOfS2_321
                | Intersection::ParallelEndOfS1ContainsStartOfS2_341
                | Intersection::ParallelS1StartOverlapsS2End373 => intersections.push(segment.b),
                Intersection::ParallelStartOfS1ContainsEndOfS2_331
                | Intersection::ParallelEndOfS1ContainsEndOfS2_351
                | Intersection::ParallelS1StartOverlapsS2Start374 => intersections.push(segment.a),
                Intersection::ParallelS1IncludesS2_361
                | Intersection::ParallelS1IncludesS2_362
                | Intersection::ParallelS1EndOverlapsS2Start371 => {
                    intersections.push(segment.a);
                    intersections.push(segment.b);
                }
                _ => {}
            }
        }

        intersections.sort_by(|a, b| a.distance(s0.a).total_cmp(&b.distance(s0.a)));

        let mut outside = false;
        let mut border = false;
        let mut inside = false;

        for (index, point) in intersections.iter().enumerate() {
            match self.inside(*point) {
                PolygonIntersection::Outside => outside = true,
                PolygonIntersection::Border => border = true,
                PolygonIntersection::Inside => inside = true,
                _ => {}
            }

            if let Some(next) = intersections.get(index + 1) {
                match self.inside(mid_point(*point, *next)) {
                    PolygonIntersection::Outside => outside = true,
                    PolygonIntersection::Border => border = true,
                    PolygonIntersection::Inside => inside = true,
                    _ => {}
                }
            }
        }

        PolygonIntersection::create(outside, border, inside).unwrap_or(PolygonIntersection::Outside)
    }

    pub fn convex_inside(&self, s0: &LineSegment) -> bool {
        let mut num_points_on_polygon = 0;

        for segment in self.line_segments() {
            let intersection = determine_line_segment_intersection_sweet(s0, &segment);
            match intersection {
                Intersection::Intersects1 => return true,
                Intersection::IntersectAtPoint4
                | Intersection::IntersectAtPointS2_6
                | Intersection::IntersectAtPointS1_5 => return false,
                _ => {}
            }

            if intersection.is_overlapping() {
                return false;
            }

            if intersection.is_endpoint_intersection() {
                num_points_on_polygon += 1;
            }
        }

        match num_points_on_polygon {
            0 | 1 => self.inside(Point::mid(s0.a, s0.b)) == PolygonIntersection::Inside,
            2 => {
                self.inside(Point::mid(s0.a, s0.b)) == PolygonIntersection::Inside
                    || self.inside(s0.a) == PolygonIntersection::Inside
                    || self.inside(s0.b) == PolygonIntersection::Inside
            }
            3 => true,
            _ => num_points_on_polygon == 4,
        }
    }

    pub fn totu_boundary_inside_circle(&self, circle: Circle) -> bool {
        for segment in self.line_segments() {
            if determine_line_segment_distance(circle.determine_center(), &segment) <= circle.r
                && (distance(segment.a, circle.determine_center()) >= circle.r
                    || distance(segment.b, circle.determine_center()) >= circle.r)
            {
                return true;
            }
        }

        self.totu_boundary_inside_line_segment(&LineSegment::new(
            circle.determine_center(),
            circle.determine_center(),
        ))
    }

    pub fn totu_boundary_inside_line_segment(&self, s0: &LineSegment) -> bool {
        for segment in self.line_segments() {
            if determine_line_segment_intersection(s0, &segment) != Intersection::NoIntersection0 {
                return true;
            }
        }

        self.inside(Point::mid(s0.a, s0.b)) == PolygonIntersection::Inside
    }

    pub fn inside(&self, p: Point) -> PolygonIntersection {
        for segment in self.line_segments() {
            if determine_line_segment_distance(p, &segment) < Epsilon::UNKNOWN_001 {
                return PolygonIntersection::Border;
            }
        }

        let mut rad: f64 = 0.0;
        loop {
            let mut crossings = 0;
            let mut crossroad_crossings = 0;

            rad += 1.0;
            let q = Point::new(100000.0 * rad.cos(), 100000.0 * rad.sin());
            let sq = LineSegment::new(p, q);

            for segment in self.line_segments() {
                let intersection =
                    determine_line_segment_intersection_with_precision(&sq, &segment, 0.0);
                if intersection.is_intersection() {
                    crossings += 1;
                }
                if intersection == Intersection::Intersects1 {
                    crossroad_crossings += 1;
                }
            }

            if crossings == crossroad_crossings {
                if crossings % 2 == 1 {
                    return PolygonIntersection::Inside;
                }
                return PolygonIntersection::Outside;
            }
        }
    }

    pub fn calculate_area(&self) -> f64 {
        if self.vertices.len() < 3 {
            return 0.0;
        }

        let mut area =
            (self.vertices[self.vertices.len() - 1].x - self.vertices[1].x) * self.vertices[0].y;
        for index in 1..self.vertices.len() - 1 {
            area +=
                (self.vertices[index - 1].x - self.vertices[index + 1].x) * self.vertices[index].y;
        }
        area += (self.vertices[self.vertices.len() - 2].x - self.vertices[0].x)
            * self.vertices[self.vertices.len() - 1].y;
        -area / 2.0
    }

    pub fn find_distance(&self, point: Point) -> Option<f64> {
        self.line_segments()
            .iter()
            .map(|segment| determine_line_segment_distance(point, segment))
            .min_by(f64::total_cmp)
    }

    pub fn inside_point_find(&self) -> Point {
        if self.vertices.len() < 3 {
            return Point::origin();
        }

        let mut result = Point::origin();
        let mut best_distance = -10.0;

        for index in 1..self.vertices.len() - 1 {
            let point = center(
                self.vertices[index - 1],
                self.vertices[index],
                self.vertices[index + 1],
            );
            if let Some(found_distance) = self.find_distance(point)
                && best_distance < found_distance
                && self.inside(point) == PolygonIntersection::Inside
            {
                best_distance = found_distance;
                result = point;
            }
        }

        let candidates = [
            center(
                self.vertices[self.vertices.len() - 2],
                self.vertices[self.vertices.len() - 1],
                self.vertices[0],
            ),
            center(
                self.vertices[self.vertices.len() - 1],
                self.vertices[0],
                self.vertices[1],
            ),
        ];

        for point in candidates {
            if let Some(found_distance) = self.find_distance(point)
                && best_distance < found_distance
                && self.inside(point) == PolygonIntersection::Inside
            {
                best_distance = found_distance;
                result = point;
            }
        }

        result
    }

    /// The parts of `segment` that run through this polygon's interior, in
    /// order along it and keeping its direction and colour.
    ///
    /// **Ori Studio native — no Oriedita counterpart.** The segment is split
    /// at every proper crossing of a polygon edge, and a piece is kept when
    /// its midpoint is [`PolygonIntersection::Inside`] by [`Self::inside`].
    /// A piece that runs along an edge (its midpoint on the border) is not
    /// interior and is dropped, and so is a piece shorter than
    /// [`Epsilon::POINT`] — the merge radius below which the engine cannot
    /// tell two points apart. Endpoints on the border are kept as they are:
    /// a piece may start or end on an edge, but never lie on one.
    pub fn clip_segment(&self, segment: &LineSegment) -> Vec<LineSegment> {
        if self.vertices.len() < 3 {
            return Vec::new();
        }
        // A non-finite length compares to nothing, and such a segment is
        // dropped rather than cut nowhere and kept.
        let length = segment.a.distance(segment.b);
        if length.partial_cmp(&Epsilon::POINT) != Some(Ordering::Greater) {
            return Vec::new();
        }
        let dx = segment.b.x - segment.a.x;
        let dy = segment.b.y - segment.a.y;
        // Where along the segment the crossings fall, as fractions of it.
        let mut cuts = vec![0.0, 1.0];
        for edge in self.line_segments() {
            let ex = edge.b.x - edge.a.x;
            let ey = edge.b.y - edge.a.y;
            let edge_length = edge.a.distance(edge.b);
            if edge_length.partial_cmp(&Epsilon::POINT) != Some(Ordering::Greater) {
                continue;
            }
            let denominator = dx * ey - dy * ex;
            // Parallel to the edge: no proper crossing. A collinear overlap is
            // decided by the midpoint test below, which reads it as a border.
            if Epsilon::HIGH.eq0(denominator / (length * edge_length)) {
                continue;
            }
            let ax = edge.a.x - segment.a.x;
            let ay = edge.a.y - segment.a.y;
            let t = (ax * ey - ay * ex) / denominator;
            let u = (ax * dy - ay * dx) / denominator;
            let t_slack = Epsilon::POINT / length;
            let u_slack = Epsilon::POINT / edge_length;
            if (-t_slack..=1.0 + t_slack).contains(&t) && (-u_slack..=1.0 + u_slack).contains(&u) {
                cuts.push(t.clamp(0.0, 1.0));
            }
        }
        cuts.sort_by(f64::total_cmp);

        let at = |t: f64| Point::new(segment.a.x + dx * t, segment.a.y + dy * t);
        let mut pieces = Vec::new();
        for pair in cuts.windows(2) {
            let (from, to) = (pair[0], pair[1]);
            if (to - from) * length < Epsilon::POINT {
                continue;
            }
            if self.inside(at((from + to) / 2.0)) != PolygonIntersection::Inside {
                continue;
            }
            pieces.push(LineSegment::with_color(at(from), at(to), segment.color));
        }
        pieces
    }

    pub fn x_min(&self) -> Option<f64> {
        self.vertices
            .iter()
            .map(|point| point.x)
            .min_by(f64::total_cmp)
    }

    pub fn x_max(&self) -> Option<f64> {
        self.vertices
            .iter()
            .map(|point| point.x)
            .max_by(f64::total_cmp)
    }

    pub fn y_min(&self) -> Option<f64> {
        self.vertices
            .iter()
            .map(|point| point.y)
            .min_by(f64::total_cmp)
    }

    pub fn y_max(&self) -> Option<f64> {
        self.vertices
            .iter()
            .map(|point| point.y)
            .max_by(f64::total_cmp)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PolygonIntersection {
    Outside,
    Border,
    Inside,
    OutsideBorder,
    OutsideBorderInside,
    BorderInside,
}

impl PolygonIntersection {
    pub const fn create(outside: bool, border: bool, inside: bool) -> Option<Self> {
        match (outside, border, inside) {
            (true, true, true) => Some(Self::OutsideBorderInside),
            (true, true, false) => Some(Self::OutsideBorder),
            (false, true, true) => Some(Self::BorderInside),
            (true, false, false) => Some(Self::Outside),
            (false, false, true) => Some(Self::Inside),
            (false, true, false) => Some(Self::Border),
            (true, false, true) => None,
            (false, false, false) => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::LineColor;

    fn unit_square() -> Polygon {
        Polygon::new(vec![
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            Point::new(1.0, 1.0),
            Point::new(0.0, 1.0),
        ])
    }

    fn cyan(a: (f64, f64), b: (f64, f64)) -> LineSegment {
        LineSegment::with_color(Point::new(a.0, a.1), Point::new(b.0, b.1), LineColor::Cyan3)
    }

    fn close(p: Point, x: f64, y: f64) -> bool {
        (p.x - x).abs() < 1e-9 && (p.y - y).abs() < 1e-9
    }

    #[test]
    fn a_segment_inside_comes_back_whole_with_its_colour() {
        let pieces = unit_square().clip_segment(&cyan((0.2, 0.3), (0.8, 0.6)));
        assert_eq!(pieces.len(), 1);
        assert!(close(pieces[0].a, 0.2, 0.3) && close(pieces[0].b, 0.8, 0.6));
        assert_eq!(pieces[0].color, LineColor::Cyan3);
    }

    #[test]
    fn a_segment_through_the_polygon_is_cut_at_both_edges() {
        let pieces = unit_square().clip_segment(&cyan((-1.0, 0.5), (2.0, 0.5)));
        assert_eq!(pieces.len(), 1);
        assert!(close(pieces[0].a, 0.0, 0.5) && close(pieces[0].b, 1.0, 0.5));
    }

    #[test]
    fn a_segment_outside_or_along_an_edge_yields_nothing() {
        let square = unit_square();
        assert!(
            square
                .clip_segment(&cyan((2.0, 0.0), (2.0, 1.0)))
                .is_empty()
        );
        assert!(
            square
                .clip_segment(&cyan((-0.5, 0.0), (1.5, 0.0)))
                .is_empty(),
            "a run along an edge is not interior"
        );
        assert!(
            square
                .clip_segment(&cyan((0.5, 0.5), (0.5, 0.5)))
                .is_empty(),
            "a degenerate segment has no length to keep"
        );
    }

    #[test]
    fn a_concave_polygon_drops_the_span_outside_it() {
        // A U: the notch between x = 0.4 and x = 0.6 is open from the top.
        let u = Polygon::new(vec![
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            Point::new(1.0, 1.0),
            Point::new(0.6, 1.0),
            Point::new(0.6, 0.5),
            Point::new(0.4, 0.5),
            Point::new(0.4, 1.0),
            Point::new(0.0, 1.0),
        ]);
        let pieces = u.clip_segment(&cyan((0.0, 0.75), (1.0, 0.75)));
        assert_eq!(pieces.len(), 2);
        assert!(close(pieces[0].a, 0.0, 0.75) && close(pieces[0].b, 0.4, 0.75));
        assert!(close(pieces[1].a, 0.6, 0.75) && close(pieces[1].b, 1.0, 0.75));
    }

    #[test]
    fn a_segment_through_a_vertex_keeps_one_piece_per_side() {
        // The diagonal of the square passes through two of its corners.
        let pieces = unit_square().clip_segment(&cyan((-0.5, -0.5), (1.5, 1.5)));
        assert_eq!(pieces.len(), 1);
        assert!(close(pieces[0].a, 0.0, 0.0) && close(pieces[0].b, 1.0, 1.0));
    }
}
