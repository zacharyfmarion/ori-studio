use oristudio_cp::geometry::{LineColor, LineSegment, Point, Polygon};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::operations::color::toggle_mountain_valley;
use oristudio_cp::operations::selection::{
    delete_selected_lines, line_indices_in_box, select_all, select_box,
    select_connected_from_point, select_indices, select_intersecting_line, select_lasso,
    select_polygon, unselect_all, unselect_box, unselect_indices, unselect_intersecting_line,
    unselect_lasso, unselect_polygon,
};

#[test]
fn select_and_unselect_all_match_foldlineset_flags() {
    let mut model = model_from_segments(&[
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
        segment(0.0, 1.0, 1.0, 1.0, LineColor::Blue2),
    ]);

    assert_eq!(select_all(&mut model), 2);
    assert_eq!(selected_flags(&model), vec![2, 2]);
    assert_eq!(unselect_all(&mut model), 2);
    assert_eq!(selected_flags(&model), vec![0, 0]);
}

#[test]
fn select_and_unselect_indices_ignore_out_of_bounds_indices() {
    let mut model = model_from_segments(&[
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
        segment(0.0, 1.0, 1.0, 1.0, LineColor::Blue2),
        segment(0.0, 2.0, 1.0, 2.0, LineColor::Black0),
    ]);

    assert_eq!(select_indices(&mut model, &[0, 2, 99]), 2);
    assert_eq!(selected_flags(&model), vec![2, 0, 2]);
    assert_eq!(unselect_indices(&mut model, &[2]), 1);
    assert_eq!(selected_flags(&model), vec![2, 0, 0]);
}

#[test]
fn box_selection_selects_lines_touching_boundary_or_interior() {
    let mut model = model_from_segments(&[
        segment(-1.0, 0.0, 0.0, 0.0, LineColor::Red1),
        segment(0.25, 0.25, 0.75, 0.75, LineColor::Blue2),
        segment(2.0, 2.0, 3.0, 3.0, LineColor::Black0),
    ]);
    let polygon = unit_square();

    assert_eq!(select_box(&mut model, &polygon), 2);
    assert_eq!(selected_flags(&model), vec![2, 2, 0]);
    assert_eq!(unselect_box(&mut model, &polygon), 2);
    assert_eq!(selected_flags(&model), vec![0, 0, 0]);
}

#[test]
fn box_flip_toggles_only_mountain_valley_lines_inside_the_box() {
    // Oriedita CREASE_TOGGLE_MV_58 drag box: flip every enclosed M/V line, skip
    // non-M/V lines, and leave lines outside the box untouched.
    let mut model = model_from_segments(&[
        segment(-1.0, 0.0, 0.0, 0.0, LineColor::Red1), // boundary mountain -> valley
        segment(0.25, 0.25, 0.75, 0.75, LineColor::Blue2), // inside valley -> mountain
        segment(0.1, 0.1, 0.2, 0.2, LineColor::Black0), // inside edge, ignored
        segment(2.0, 2.0, 3.0, 3.0, LineColor::Red1),  // outside mountain, unchanged
    ]);
    let polygon = unit_square();

    let indices = line_indices_in_box(&model, &polygon);
    assert_eq!(toggle_mountain_valley(&mut model, &indices), 2);
    assert_eq!(model.line_segments[0].color, LineColor::Blue2);
    assert_eq!(model.line_segments[1].color, LineColor::Red1);
    assert_eq!(model.line_segments[2].color, LineColor::Black0);
    assert_eq!(model.line_segments[3].color, LineColor::Red1);
}

#[test]
fn polygon_selection_uses_inside_outside_categories() {
    let mut model = model_from_segments(&[
        segment(0.25, 0.25, 0.75, 0.75, LineColor::Red1),
        segment(-1.0, 0.0, 0.0, 0.0, LineColor::Blue2),
        segment(-1.0, 0.5, 2.0, 0.5, LineColor::Black0),
    ]);
    let polygon = unit_square();

    assert_eq!(select_polygon(&mut model, &polygon), 1);
    assert_eq!(selected_flags(&model), vec![2, 0, 0]);

    model.line_segments[2] = model.line_segments[2].with_selected(2);
    assert_eq!(unselect_polygon(&mut model, &polygon), 1);
    assert_eq!(selected_flags(&model), vec![0, 0, 2]);
}

#[test]
fn intersecting_line_selection_selects_overlaps_and_x_crossings() {
    let mut model = model_from_segments(&[
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(5.0, -5.0, 5.0, 5.0, LineColor::Blue2),
        segment(0.0, 1.0, 10.0, 1.0, LineColor::Black0),
    ]);
    let selection = segment(2.0, 0.0, 8.0, 0.0, LineColor::Magenta5);

    assert_eq!(select_intersecting_line(&mut model, &selection), 2);
    assert_eq!(selected_flags(&model), vec![2, 2, 0]);
    assert_eq!(unselect_intersecting_line(&mut model, &selection), 2);
    assert_eq!(selected_flags(&model), vec![0, 0, 0]);
}

#[test]
fn lasso_selection_selects_intersecting_or_contained_lines() {
    let mut model = model_from_segments(&[
        segment(0.25, 0.25, 0.75, 0.75, LineColor::Red1),
        segment(-0.5, 0.5, 0.5, 0.5, LineColor::Blue2),
        segment(2.0, 2.0, 3.0, 3.0, LineColor::Black0),
    ]);
    let lasso = unit_square();

    assert_eq!(select_lasso(&mut model, &lasso), 2);
    assert_eq!(selected_flags(&model), vec![2, 2, 0]);
    assert_eq!(unselect_lasso(&mut model, &lasso), 2);
    assert_eq!(selected_flags(&model), vec![0, 0, 0]);
}

#[test]
fn connected_selection_walks_exact_oriedita_equal_endpoints() {
    let mut model = model_from_segments(&[
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
        segment(1.0, 0.0, 2.0, 0.0, LineColor::Blue2),
        segment(2.0, 0.0, 3.0, 0.0, LineColor::Black0),
        segment(10.0, 0.0, 11.0, 0.0, LineColor::Cyan3),
    ]);

    assert_eq!(
        select_connected_from_point(&mut model, Point::new(1.0, 0.0)),
        3
    );
    assert_eq!(selected_flags(&model), vec![2, 2, 2, 0]);
}

#[test]
fn delete_selected_lines_removes_selected_segments_and_preserves_order() {
    let mut model = model_from_segments(&[
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
        segment(0.0, 1.0, 1.0, 1.0, LineColor::Blue2),
        segment(0.0, 2.0, 1.0, 2.0, LineColor::Black0),
    ]);
    model.line_segments[0] = model.line_segments[0].with_selected(2);
    model.line_segments[2] = model.line_segments[2].with_selected(2);

    let deleted = delete_selected_lines(&mut model);

    assert_eq!(deleted, 2);
    assert_eq!(model.line_segments.len(), 1);
    assert_eq!(model.line_segments[0].color, LineColor::Blue2);
}

fn model_from_segments(segments: &[LineSegment]) -> CreasePatternModel {
    let mut model = CreasePatternModel::default();
    for segment in segments {
        model.add_line_segment(segment.clone());
    }
    model
}

fn segment(ax: f64, ay: f64, bx: f64, by: f64, color: LineColor) -> LineSegment {
    LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
}

fn unit_square() -> Polygon {
    Polygon::new(vec![
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        Point::new(1.0, 1.0),
        Point::new(0.0, 1.0),
    ])
}

fn selected_flags(model: &CreasePatternModel) -> Vec<i32> {
    model
        .line_segments
        .iter()
        .map(|segment| segment.selected)
        .collect()
}
