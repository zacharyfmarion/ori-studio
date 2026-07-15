use oristudio_bp::layout::trace::{RepoTrace, Ridge, SideDiagonal, Trace, create_hinge_segments};
use oristudio_bp::layout::{CornerType, ValidJunction, ValidJunctionData, create_quadrants};
use oristudio_bp::math::geometry::{PathPoint, Point, parse_line};
use oristudio_bp::model::{Edge, Flap, Point as LayoutPoint};
use oristudio_bp::shared::{QuadrantDirection, SlashDirection};
use oristudio_bp::tree::BpTree;

#[test]
fn hinge_segments_split_counter_clockwise_square_by_forward_slash_direction() {
    let segments = create_hinge_segments(&square(), SlashDirection::Fw);

    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0].q, QuadrantDirection::Ur);
    assert_points(&segments[0].points, &[(2.0, 0.0), (2.0, 2.0), (0.0, 2.0)]);
    assert_eq!(segments[1].q, QuadrantDirection::Ll);
    assert_points(&segments[1].points, &[(0.0, 2.0), (0.0, 0.0), (2.0, 0.0)]);
}

#[test]
fn hinge_segments_split_counter_clockwise_square_by_backward_slash_direction() {
    let segments = create_hinge_segments(&square(), SlashDirection::Bw);

    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0].q, QuadrantDirection::Lr);
    assert_points(&segments[0].points, &[(0.0, 0.0), (2.0, 0.0), (2.0, 2.0)]);
    assert_eq!(segments[1].q, QuadrantDirection::Ul);
    assert_points(&segments[1].points, &[(2.0, 2.0), (0.0, 2.0), (0.0, 0.0)]);
}

#[test]
fn hinge_segments_return_empty_for_degenerate_inputs() {
    assert!(create_hinge_segments(&[], SlashDirection::Fw).is_empty());
    assert!(create_hinge_segments(&[PathPoint::new(0.0, 0.0)], SlashDirection::Bw).is_empty());
}

#[test]
fn hinge_segments_match_upstream_turning_fixture() {
    let segments = create_hinge_segments(
        &path(&[
            (2.0, 3.0),
            (1.0, 3.0),
            (1.0, 2.0),
            (0.0, 2.0),
            (0.0, 1.0),
            (1.0, 1.0),
            (1.0, 0.0),
            (2.0, 0.0),
            (2.0, 1.0),
            (3.0, 1.0),
            (3.0, 2.0),
            (2.0, 2.0),
        ]),
        SlashDirection::Fw,
    );

    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0].q, QuadrantDirection::Ll);
    assert_points(
        &segments[0].points,
        &[(0.0, 2.0), (0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (2.0, 0.0)],
    );
    assert_eq!(segments[1].q, QuadrantDirection::Ur);
    assert_points(
        &segments[1].points,
        &[(3.0, 1.0), (3.0, 2.0), (2.0, 2.0), (2.0, 3.0), (1.0, 3.0)],
    );
}

#[test]
fn trace_generate_includes_intersection_ridge_at_end_like_upstream_fixture() {
    let trace = Trace::new(
        vec![
            ridge("(8, 61)-(25, 32)"),
            ridge("(25, 32)-(48, 26)"),
            ridge("(48, 26)-(31, 55)"),
            ridge("(31, 55)-(8, 61)"),
            ridge("(8, 61)-(8, 61)"),
            ridge("(48, 26)-(48, 26)"),
            Ridge::with_type(
                parse_line("(25, 32)-(18, 39)").unwrap(),
                CornerType::Intersection,
                Some([3, 12]),
            ),
            ridge("(11, 32)-(21, 27)"),
            ridge("(21, 27)-(13, 51)"),
            ridge("(13, 51)-(1/2, 127/2)"),
            ridge("(1/2, 127/2)-(11, 32)"),
            ridge("(13, 51)-(8, 61)"),
            ridge("(8, 61)-(1/2, 127/2)"),
            ridge("(1/2, 127/2)-(0, 64)"),
            ridge("(21, 27)-(22, 26)"),
        ],
        SlashDirection::Bw,
        vec![
            side_diagonal("(23, 63)-(37, 49)", "(31,55)"),
            side_diagonal("(2, 41)-(10, 33)", "(11,32)"),
        ],
    );
    let result = trace
        .generate(
            &path(&[(73.0, 51.0), (23.0, 51.0), (23.0, 1.0)]),
            &Point::from_integers(37, 49),
            &Point::from_integers(25, 32),
            false,
        )
        .unwrap()
        .unwrap();

    assert_exact_points(&result, &["(2901/87,51)", "(2073/87,34)", "(23,34)"]);
}

#[test]
fn repo_trace_resolves_start_and_end_from_adjacent_intersection_ridges() {
    let tree = four_leaf_tree();
    let junctions = vec![
        valid_junction(&tree, 1, 2, QuadrantDirection::Ur),
        valid_junction(&tree, 3, 4, QuadrantDirection::Ur),
    ];
    let quadrants = create_quadrants(&junctions, &tree).unwrap();
    let all = quadrants.directional[QuadrantDirection::Ur as usize]
        .iter()
        .map(|code| quadrants.map.get(code).unwrap().clone())
        .collect::<Vec<_>>();
    assert_eq!(all.len(), 2);

    let mut division = [all[0].flap, all[1].flap];
    division.sort_unstable();
    let repo_trace = RepoTrace::new(
        Trace::new(
            vec![Ridge::with_type(
                parse_line("(100,100)-(101,101)").unwrap(),
                CornerType::Intersection,
                Some(division),
            )],
            SlashDirection::Fw,
            Vec::new(),
        ),
        [all[0].flap, all[1].flap],
    );

    let [start, _] = repo_trace
        .resolve_start_end(&[all[1].clone()], &all, &tree)
        .unwrap();
    assert!(start.equals(&Point::from_integers(100, 100)));

    let [_, end] = repo_trace
        .resolve_start_end(&[all[0].clone()], &all, &tree)
        .unwrap();
    assert!(end.equals(&Point::from_integers(100, 100)));
}

fn square() -> Vec<PathPoint> {
    path(&[(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)])
}

fn path(points: &[(f64, f64)]) -> Vec<PathPoint> {
    points.iter().map(|(x, y)| PathPoint::new(*x, *y)).collect()
}

fn ridge(line: &str) -> Ridge {
    Ridge::new(parse_line(line).unwrap())
}

fn side_diagonal(line: &str, p0: &str) -> SideDiagonal {
    SideDiagonal::new(parse_line(line).unwrap(), Point::parse_test(p0).unwrap())
}

fn four_leaf_tree() -> BpTree {
    BpTree::new(
        &[
            Edge {
                n1: 0,
                n2: 1,
                length: 5.0,
            },
            Edge {
                n1: 0,
                n2: 2,
                length: 5.0,
            },
            Edge {
                n1: 0,
                n2: 3,
                length: 5.0,
            },
            Edge {
                n1: 0,
                n2: 4,
                length: 5.0,
            },
        ],
        &[
            flap(1, 0.0, 0.0),
            flap(2, 20.0, 0.0),
            flap(3, 0.0, 20.0),
            flap(4, 20.0, 20.0),
        ],
    )
    .unwrap()
}

fn flap(id: u32, x: f64, y: f64) -> Flap {
    Flap {
        id,
        x,
        y,
        width: 2.0,
        height: 2.0,
    }
}

fn valid_junction(tree: &BpTree, a: u32, b: u32, direction: QuadrantDirection) -> ValidJunction {
    ValidJunction::new(
        tree,
        a,
        b,
        ValidJunctionData {
            lca: 0,
            s: LayoutPoint { x: 10.0, y: 10.0 },
            o: LayoutPoint { x: 1.0, y: 1.0 },
            f: LayoutPoint { x: 1.0, y: 1.0 },
            dir: direction,
            tip: LayoutPoint { x: 0.0, y: 0.0 },
        },
    )
    .unwrap()
}

fn assert_points(actual: &[PathPoint], expected: &[(f64, f64)]) {
    assert_eq!(actual.len(), expected.len());
    for (point, (x, y)) in actual.iter().zip(expected) {
        assert_eq!((point.x, point.y), (*x, *y));
    }
}

fn assert_exact_points(actual: &[Point], expected: &[&str]) {
    assert_eq!(actual.len(), expected.len());
    for (point, expected) in actual.iter().zip(expected) {
        assert!(
            point.equals(&Point::parse_test(expected).unwrap()),
            "expected {expected}, got {point}"
        );
    }
}
