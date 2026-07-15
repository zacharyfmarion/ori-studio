pub mod float;
pub mod line;
pub mod matrix;
pub mod path;
pub mod point;
pub mod point_in_polygon;
pub mod rational_path;
pub mod rectangle;
pub mod vector;
pub mod winding;

pub use float::{EPSILON, epsilon_same, fix_zero, is_almost_zero};
pub use line::{Intersection, Line, get_intersection, parse_line};
pub use matrix::Matrix;
pub use path::{
    PathPoint, deduplicate, is_clockwise, map_directions, path_to_string, point_to_string,
};
pub use point::Point;
pub use point_in_polygon::point_in_polygon;
pub use rational_path::{RationalPath, join_paths, shift_path, to_lines, triangle_transform};
pub use rectangle::Rectangle;
pub use vector::Vector;
pub use winding::is_inside;
