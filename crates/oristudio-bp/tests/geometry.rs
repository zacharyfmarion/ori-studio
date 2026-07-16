use oristudio_bp::math::geometry::{Line, Matrix, Point, Rectangle, Vector, fix_zero, parse_line};
use oristudio_bp::math::geometry::{
    PathPoint, is_clockwise, is_inside, join_paths, map_directions, path_to_string,
    point_in_polygon, shift_path, to_lines, triangle_transform,
};
use oristudio_bp::math::{BpFraction, parse_fraction};

#[test]
fn matrix_computes_transformation_matrix() {
    let p1 = Point::from_integers(-4, -2);
    let p2 = Point::from_integers(-2, 0);
    let from = Vector::from_integers(-4, -2);
    let to = Vector::from_integers(-2, 0);
    let matrix = Matrix::get_transform_matrix(&from, &to).expect("matrix is invertible");
    assert_eq!(matrix.to_string(), "2/5,1/5,-1/5,2/5");

    let transformed = matrix.multiply_point(&p1);
    assert!(transformed.equals(&p2));
}

#[test]
fn matrix_computes_inverse() {
    let matrix = Matrix::new(
        BpFraction::from_integer(1),
        BpFraction::from_integer(2),
        BpFraction::from_integer(3),
        BpFraction::from_integer(4),
    );
    let inverse = matrix.inverse().expect("matrix is invertible");
    assert_eq!(inverse.to_string(), "-2,1,3/2,-1/2");
}

#[test]
fn line_checks_equality() {
    assert!(
        parse_line("(0,0)-(5,0)")
            .unwrap()
            .equals(&parse_line("(5,0)-(0,0)").unwrap())
    );
    assert!(
        parse_line("(0,0)-(5,0)")
            .unwrap()
            .equals(&parse_line("(0,0)-(5,0)").unwrap())
    );
}

#[test]
fn line_lists_grid_points() {
    assert_eq!(
        parse_line("(4,10)-(0.0)")
            .unwrap()
            .grid_points()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        parse_line("(10,4)-(0.0)")
            .unwrap()
            .grid_points()
            .unwrap()
            .len(),
        3
    );
}

#[test]
fn line_checks_perpendicularity() {
    assert!(
        parse_line("(0,0)-(2,4)")
            .unwrap()
            .perpendicular(&Vector::from_integers(2, -1))
    );
}

#[test]
fn line_reflects_about_given_direction() {
    let line = parse_line("(-21, 131)-(144031/3031, 374438/3031)").unwrap();
    let result = line.reflect(&Vector::from_integers(2508, 3995)).unwrap();
    assert_eq!(result.to_string(), "(-3116880, 8711609)");
}

#[test]
fn line_subtracts_overlapping_parts() {
    fn subtract(l1: &str, l2: &str) -> usize {
        Line::subtract(&[parse_line(l1).unwrap()], &[parse_line(l2).unwrap()]).len()
    }

    assert_eq!(subtract("(0,0)-(5,0)", "(2,0)-(3,0)"), 2);
    assert_eq!(subtract("(5,0)-(0,0)", "(2,0)-(3,0)"), 2);
    assert_eq!(subtract("(0,0)-(5,0)", "(-1,0)-(6,0)"), 0);
    assert_eq!(subtract("(0,0)-(5,0)", "(4,0)-(6,0)"), 1);
    assert_eq!(subtract("(0,0)-(5,0)", "(-1,0)-(1,0)"), 1);
}

#[test]
fn line_subtraction_ignores_degenerated_parts() {
    fn subtract(l1: &str, l2: &str) -> usize {
        Line::subtract(&[parse_line(l1).unwrap()], &[parse_line(l2).unwrap()]).len()
    }

    assert_eq!(subtract("(0,0)-(5,0)", "(0,0)-(3,0)"), 1);
    assert_eq!(subtract("(5,0)-(0,0)", "(0,0)-(3,0)"), 1);
    assert_eq!(subtract("(0,0)-(5,0)", "(2,0)-(5,0)"), 1);
    assert_eq!(subtract("(5,0)-(0,0)", "(2,0)-(5,0)"), 1);
}

#[test]
fn vector_reduces_and_compares_parallel() {
    let vector = Vector::new(
        parse_fraction("6/10").unwrap(),
        parse_fraction("9/25").unwrap(),
    );
    assert_eq!(vector.reduce().unwrap().to_string(), "(1, 3/5)");
    assert!(vector.parallel(&Vector::new(
        parse_fraction("10/6").unwrap(),
        BpFraction::from_integer(1),
    )));
}

#[test]
fn rectangle_contains_and_compares_with_epsilon_points() {
    let outer = Rectangle::new((10.0, 10.0), (0.0, 0.0));
    let inner = Rectangle::new((2.0, 2.0), (8.0, 8.0));
    assert!(outer.contains(&inner));
    assert!(outer.equals(&Rectangle::new((0.0, 0.0), (10.0, 10.0))));
    assert_eq!(fix_zero(1e-12), 0.0);
}

#[test]
fn path_helpers_match_upstream_direction_and_orientation_rules() {
    let path = vec![
        PathPoint::new(0.0, 0.0),
        PathPoint::new(2.0, 0.0),
        PathPoint::new(2.0, 2.0),
        PathPoint::new(0.0, 2.0),
    ];
    assert_eq!(map_directions(&path), vec![2, 3, 0, 1]);
    assert_eq!(path_to_string(&path), "(0,0),(2,0),(2,2),(0,2)");
    assert!(!is_clockwise(&path));
    let reversed = path.iter().copied().rev().collect::<Vec<_>>();
    assert!(is_clockwise(&reversed));
}

#[test]
fn winding_excludes_boundary_points() {
    let path = vec![
        PathPoint::new(0.0, 0.0),
        PathPoint::new(1.0, 3.0),
        PathPoint::new(15.0, 10.0),
        PathPoint::new(14.0, 7.0),
    ];
    assert!(!is_inside(PathPoint::new(11.0, 8.0), &path));
}

#[test]
fn point_in_polygon_handles_boundary_flag_and_degenerated_path() {
    let p = Point::from_integers(1, 0);
    let segment = vec![Point::from_integers(0, 0), Point::from_integers(2, 0)];
    assert!(!point_in_polygon(&p, &segment, false));
    assert!(point_in_polygon(&p, &segment, true));

    let square = vec![
        Point::from_integers(0, 0),
        Point::from_integers(2, 0),
        Point::from_integers(2, 2),
        Point::from_integers(0, 2),
    ];
    assert!(point_in_polygon(
        &Point::from_integers(1, 1),
        &square,
        false
    ));
}

#[test]
fn rational_path_helpers_convert_transform_join_and_shift() {
    let path = vec![
        Point::from_integers(0, 0),
        Point::from_integers(2, 0),
        Point::from_integers(2, 2),
    ];
    let lines = to_lines(&path);
    assert_eq!(lines.len(), 3);
    assert!(lines[2].equals(&Line::new(path[2].clone(), path[0].clone())));

    let transformed = triangle_transform(&path, &Point::from_integers(4, 0)).unwrap();
    assert!(transformed.equals(&Point::from_integers(4, 4)));

    let joined = join_paths(
        &[
            Point::from_integers(0, 0),
            Point::from_integers(1, 0),
            Point::from_integers(1, 1),
        ],
        &[
            Point::from_integers(1, 0),
            Point::from_integers(2, 0),
            Point::from_integers(1, 1),
        ],
    );
    assert_eq!(joined.len(), 4);

    let shifted = shift_path(&path, &Vector::from_integers(1, -1));
    assert!(shifted[0].equals(&Point::from_integers(1, -1)));
}
