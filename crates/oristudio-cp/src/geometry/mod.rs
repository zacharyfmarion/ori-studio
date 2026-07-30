//! Oriedita-compatible geometry primitives and calculation helpers.
//!
//! The public names in this module intentionally follow Oriedita's domain
//! language. Later editing operations should use these helpers instead of
//! generic geometry crates when parity-sensitive behavior is involved.

mod circle;
mod epsilon;
mod line;
mod line_color;
mod line_segment;
mod orita_calc;
mod point;
mod polygon;
mod rectangle;
mod straight_line;

pub use circle::{Circle, CircleIntersection};
pub use epsilon::{Epsilon, HighEpsilon};
pub use line::Line;
pub use line_color::{LineColor, LineColorParseError};
pub use line_segment::{ActiveState, FoldMagnitude, Intersection, LineSegment, RgbColor};
pub use orita_calc::{
    ParallelJudgement, angle, angle_between_0_360, angle_between_0_kmax, angle_between_m180_180,
    bisection, center, change_length, circle_to_circle_intersection,
    circle_to_circle_no_intersection_wo_musubu_line_segment,
    circle_to_circle_no_intersection_wo_tooru_straight_line,
    circle_to_straight_line_no_intersect_wo_connect_line_segment,
    determine_closest_line_segment_endpoint, determine_line_segment_distance,
    determine_line_segment_intersection, determine_line_segment_intersection_sweet,
    determine_line_segment_intersection_sweet_with_tolerances,
    determine_line_segment_intersection_with_precision,
    determine_line_segment_intersection_with_tolerances, distance, distance_circumference, equal,
    equal_with_radius, find_intersection_segments, find_intersection_straight_lines,
    find_line_symmetry_line_segment, find_line_symmetry_point, find_projection,
    find_projection_segment, get_segment_with_length, internal_division_ratio, is_inside,
    is_inside_sweet, is_line_segment_overlapping, is_line_segment_parallel,
    is_line_segment_parallel_with_precision, is_point_within_line_span, line_segment_change_length,
    line_segment_rotate, line_segment_rotate_scaled, line_segment_to_straight_line,
    line_segment_x_kousa_decide, mid_point, min4, move_parallel, point_rotate, point_rotate_scaled,
};
pub use point::Point;
pub use polygon::{Polygon, PolygonIntersection};
pub use rectangle::Rectangle;
pub use straight_line::{StraightLine, StraightLineIntersection};
