use oristudio_bp::grid::{
    BpGrid, DiagonalGrid, Dimension, RectangularGrid, constrain_flap, diagonal_constrain,
    flip_sheet, get_dots, get_relative_point, image_dimension, rectangular_constrain, rotate_sheet,
    subdivide_sheet, unsubdivide_sheet,
};
use oristudio_bp::model::{GridType, Point, Sheet};
use oristudio_bp::shared::Direction;

#[test]
fn rectangular_grid_matches_upstream_geometry_payloads() {
    let grid = RectangularGrid::new(4.0, 3.0);

    assert_eq!(grid.diameter(), 4.0);
    assert!(grid.can_subdivide());
    assert_eq!(grid.center(), Point { x: 2.0, y: 1.5 });
    assert_eq!(
        grid.constrain(Point { x: 5.0, y: -1.0 }),
        Point { x: 4.0, y: 0.0 }
    );
    assert!(grid.contains(Point { x: 4.0, y: 3.0 }));
    assert!(!grid.contains(Point { x: 4.1, y: 3.0 }));
    assert_eq!(grid.label_direction(0.0, 0.0), Direction::Ll);
    assert_eq!(grid.label_direction(4.0, 3.0), Direction::Ur);
    assert_eq!(
        grid.border_path(),
        vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 4.0, y: 0.0 },
            Point { x: 4.0, y: 3.0 },
            Point { x: 0.0, y: 3.0 },
        ]
    );
    assert_eq!(grid.grid_lines().len(), 5);
    assert_eq!(
        grid.transform_matrix(400.0, false),
        [100.0, 0.0, 0.0, -100.0, -200.0, 150.0]
    );

    let wrapped = BpGrid::Rectangular(grid);
    assert_eq!(wrapped.diameter(), 4.0);
    assert!(wrapped.contains(Point { x: 2.0, y: 2.0 }));
    assert_eq!(wrapped.label_direction(4.0, 3.0), Direction::Ur);
    assert_eq!(wrapped.border_path(), grid.border_path());
    assert_eq!(wrapped.grid_lines(), grid.grid_lines());
    assert_eq!(
        wrapped.transform_matrix(400.0, false),
        grid.transform_matrix(400.0, false)
    );
    assert_eq!(wrapped.offset(), Point { x: 0.0, y: 0.0 });
}

#[test]
fn rectangular_resize_reports_anchor_shifts_and_rejections() {
    let anchors = [Point { x: 2.0, y: 1.0 }, Point { x: 7.0, y: 3.0 }];
    let mut grid = RectangularGrid::new(10.0, 10.0);
    let resize = grid.set_width_checked(8.0, &anchors).unwrap();
    assert_eq!(resize.shift, None);
    assert!(resize.flush_history);

    let resize = grid.set_width_checked(6.0, &anchors).unwrap();
    assert_eq!(resize.shift, Some(Point { x: -1.0, y: 0.0 }));
    assert!(!resize.flush_history);

    assert!(grid.set_width_checked(4.0, &anchors).is_none());
}

#[test]
fn diagonal_grid_matches_upstream_geometry_payloads() {
    let grid = DiagonalGrid::new(6.0, 6.0);

    assert_eq!(grid.size(), 6.0);
    assert_eq!(grid.render_width(), 6.0);
    assert_eq!(grid.offset(), Point { x: 0.0, y: 0.0 });
    assert_eq!(
        grid.constrain(Point { x: 0.0, y: 0.0 }),
        Point { x: 1.0, y: 2.0 }
    );
    assert!(grid.contains(Point { x: 3.0, y: 0.0 }));
    assert!(!grid.contains(Point { x: 0.0, y: 0.0 }));
    assert_eq!(grid.label_direction(0.0, 3.0), Direction::L);
    assert_eq!(grid.label_direction(3.0, 6.0), Direction::T);
    assert_eq!(
        grid.border_path(),
        vec![
            Point { x: 3.0, y: -0.0 },
            Point { x: 6.0, y: 3.0 },
            Point { x: 3.0, y: 6.0 },
            Point { x: -0.0, y: 3.0 },
        ]
    );
    assert_eq!(grid.grid_lines().len(), 10);
    assert_eq!(
        grid.transform_matrix(12.0, true),
        [2.0, 2.0, 2.0, -2.0, -12.0, 0.0]
    );

    let odd = DiagonalGrid::new(5.0, 5.0);
    assert_eq!(odd.render_width(), 6.0);
    assert_eq!(odd.offset(), Point { x: -0.5, y: -0.5 });
}

#[test]
fn diagonal_resize_and_initial_fit_follow_anchor_rules() {
    let anchors = [Point { x: 1.0, y: 4.0 }, Point { x: 7.0, y: 4.0 }];
    let mut grid = DiagonalGrid::new(8.0, 8.0);
    let resize = grid.set_size_checked(6.0, &anchors).unwrap();
    assert_eq!(resize.shift, Some(Point { x: -1.0, y: -1.0 }));
    assert!(!resize.flush_history);

    let anchors = [Point { x: -3.0, y: 0.0 }, Point { x: 8.0, y: 0.0 }];
    let (grid, shift) = DiagonalGrid::new_fitted(4.0, 4.0, &anchors);
    assert!(grid.size() >= 6.0);
    assert!(shift.is_some());

    let mut grid = DiagonalGrid::new(8.0, 8.0);
    assert!(grid.set_dimension(8.0, 6.0).is_err());
}

#[test]
fn constrain_helpers_match_upstream_vector_rules() {
    assert_eq!(
        rectangular_constrain(4.0, 3.0, Point { x: -1.0, y: 5.0 }),
        Point { x: 0.0, y: 3.0 }
    );
    assert_eq!(
        diagonal_constrain(6.0, 6.0, Point { x: 7.0, y: 7.0 }),
        Point { x: 5.0, y: 4.0 }
    );
    assert_eq!(
        get_dots(Point { x: 1.0, y: 2.0 }, 3.0, 4.0),
        [
            Point { x: 4.0, y: 6.0 },
            Point { x: 1.0, y: 6.0 },
            Point { x: 1.0, y: 2.0 },
            Point { x: 4.0, y: 2.0 },
        ]
    );

    let vector = constrain_flap(
        |point| rectangular_constrain(4.0, 4.0, point),
        Point { x: 3.0, y: 3.0 },
        2.0,
        2.0,
        Point { x: 1.0, y: 1.0 },
    );
    assert_eq!(vector, Point { x: -1.0, y: -1.0 });
}

#[test]
fn relative_points_scale_between_grid_render_dimensions() {
    let from = BpGrid::new(Sheet {
        grid_type: GridType::Rectangular,
        width: 10.0,
        height: 20.0,
    });
    let to = BpGrid::new(Sheet {
        grid_type: GridType::Diagonal,
        width: 6.0,
        height: 6.0,
    });

    assert_eq!(
        get_relative_point(Point { x: 5.0, y: 10.0 }, &from, &to),
        Point { x: 3.0, y: 3.0 }
    );

    let mut dimension = Dimension {
        width: 1.0,
        height: 2.0,
    };
    RectangularGrid::fix_dimension(&mut dimension);
    assert_eq!(dimension.width, 4.0);
    assert_eq!(dimension.height, 4.0);
    DiagonalGrid::fix_dimension(&mut dimension);
    assert_eq!(dimension.width, 6.0);
    assert_eq!(dimension.height, 6.0);
}

#[test]
fn unsubdivide_halves_the_grid_when_flaps_sit_on_even_lines() {
    let rect = BpGrid::new(Sheet {
        grid_type: GridType::Rectangular,
        width: 10.0,
        height: 20.0,
    });
    // All flap dots on even coordinates → clean halving.
    let anchors = [Point { x: 2.0, y: 4.0 }, Point { x: 6.0, y: 8.0 }];
    let transform = unsubdivide_sheet(rect, &anchors).unwrap().unwrap();
    assert_eq!(
        transform.grid.to_sheet(),
        Sheet {
            grid_type: GridType::Rectangular,
            width: 5.0,
            height: 10.0,
        }
    );
    assert_eq!(transform.matrix, [0.5, 0.0, 0.0, 0.5, 0.0, 0.0]);
}

#[test]
fn unsubdivide_is_the_inverse_of_subdivide() {
    let rect = BpGrid::new(Sheet {
        grid_type: GridType::Rectangular,
        width: 10.0,
        height: 20.0,
    });
    let up = subdivide_sheet(rect).unwrap().unwrap();
    // After subdividing, every original anchor doubles, so it stays even.
    let doubled = [Point { x: 4.0, y: 8.0 }, Point { x: 12.0, y: 16.0 }];
    let down = unsubdivide_sheet(up.grid, &doubled).unwrap().unwrap();
    assert_eq!(down.grid.to_sheet(), rect.to_sheet());
    assert_eq!(down.matrix, [0.5, 0.0, 0.0, 0.5, 0.0, 0.0]);
}

#[test]
fn unsubdivide_refuses_flaps_on_odd_lines() {
    let rect = BpGrid::new(Sheet {
        grid_type: GridType::Rectangular,
        width: 16.0,
        height: 16.0,
    });
    // A flap dot on an odd line cannot halve onto the coarser grid.
    let anchors = [Point { x: 3.0, y: 4.0 }];
    assert!(unsubdivide_sheet(rect, &anchors).unwrap().is_none());
}

#[test]
fn unsubdivide_refuses_odd_or_below_minimum_dimensions() {
    let odd = BpGrid::new(Sheet {
        grid_type: GridType::Rectangular,
        width: 15.0,
        height: 16.0,
    });
    assert!(unsubdivide_sheet(odd, &[]).unwrap().is_none());

    // 6/2 = 3 < MIN_RECT_SIZE (4), so halving is refused.
    let too_small = BpGrid::new(Sheet {
        grid_type: GridType::Rectangular,
        width: 6.0,
        height: 6.0,
    });
    assert!(unsubdivide_sheet(too_small, &[]).unwrap().is_none());
}

#[test]
fn sheet_transform_helpers_match_upstream_matrices() {
    let rect = BpGrid::new(Sheet {
        grid_type: GridType::Rectangular,
        width: 10.0,
        height: 20.0,
    });
    let subdivide = subdivide_sheet(rect).unwrap().unwrap();
    assert_eq!(
        subdivide.grid.to_sheet(),
        Sheet {
            grid_type: GridType::Rectangular,
            width: 20.0,
            height: 40.0,
        }
    );
    assert_eq!(subdivide.matrix, [2.0, 0.0, 0.0, 2.0, 0.0, 0.0]);

    let rotate = rotate_sheet(rect, 1.0).unwrap();
    assert_eq!(
        rotate.grid.to_sheet(),
        Sheet {
            grid_type: GridType::Rectangular,
            width: 20.0,
            height: 10.0,
        }
    );
    assert_eq!(rotate.matrix, [0.0, 1.0, -1.0, 0.0, 0.0, 10.0]);
    assert_eq!(flip_sheet(&rect, true), [-1.0, 0.0, 0.0, 1.0, 10.0, 0.0]);
    assert_eq!(flip_sheet(&rect, false), [1.0, 0.0, 0.0, -1.0, 0.0, 20.0]);

    let odd_diag = BpGrid::new(Sheet {
        grid_type: GridType::Diagonal,
        width: 5.0,
        height: 5.0,
    });
    let subdivide = subdivide_sheet(odd_diag).unwrap().unwrap();
    assert_eq!(
        subdivide.grid.to_sheet(),
        Sheet {
            grid_type: GridType::Diagonal,
            width: 12.0,
            height: 12.0,
        }
    );
    assert_eq!(subdivide.matrix, [2.0, 0.0, 0.0, 2.0, 1.0, 1.0]);
    assert_eq!(
        image_dimension(&odd_diag, 10.0, 8.0),
        Dimension {
            width: 66.0,
            height: 66.0,
        }
    );
}
