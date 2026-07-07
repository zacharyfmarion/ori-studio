//! Selection operations ported from Oriedita `FoldLineSet` and selection handlers.

use crate::geometry::{
    LineSegment, Point, Polygon, PolygonIntersection, equal, is_line_segment_overlapping,
    line_segment_x_kousa_decide,
};
use crate::model::CreasePatternModel;

const SELECTED: i32 = 2;
const UNSELECTED: i32 = 0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LassoInteractionMode {
    Intersect,
    Contain,
    IntersectContain,
}

/// Oriedita `FoldLineSet.select_all`.
pub fn select_all(model: &mut CreasePatternModel) -> usize {
    set_all(model, SELECTED)
}

/// Oriedita `FoldLineSet.unselect_all`.
pub fn unselect_all(model: &mut CreasePatternModel) -> usize {
    set_all(model, UNSELECTED)
}

/// Set the selected flag for zero-based line indices.
pub fn select_indices(model: &mut CreasePatternModel, indices: &[usize]) -> usize {
    set_indices(model, indices, SELECTED)
}

/// Clear the selected flag for zero-based line indices.
pub fn unselect_indices(model: &mut CreasePatternModel, indices: &[usize]) -> usize {
    set_indices(model, indices, UNSELECTED)
}

/// Oriedita `FoldLineSet.select(Polygon)`/box-line selection behavior.
pub fn select_box(model: &mut CreasePatternModel, polygon: &Polygon) -> usize {
    select_by_boundary_or_inside(model, polygon, SELECTED)
}

/// Line indices collected by Oriedita's box-select predicate
/// (`Polygon.totu_boundary_inside_line_segment`), without mutating selection.
/// Used by box tools that act on the boxed lines directly (e.g. flip M/V).
pub fn line_indices_in_box(model: &CreasePatternModel, polygon: &Polygon) -> Vec<usize> {
    model
        .line_segments
        .iter()
        .enumerate()
        .filter(|(_, segment)| polygon.totu_boundary_inside_line_segment(segment))
        .map(|(index, _)| index)
        .collect()
}

/// Box-line unselection using Oriedita's `lineSegmentsInside` predicate.
pub fn unselect_box(model: &mut CreasePatternModel, polygon: &Polygon) -> usize {
    select_by_boundary_or_inside(model, polygon, UNSELECTED)
}

/// Oriedita `FoldLineSet.select_Takakukei(polygon, "select")`.
pub fn select_polygon(model: &mut CreasePatternModel, polygon: &Polygon) -> usize {
    select_by_polygon_intersection(model, polygon, SELECTED)
}

/// Oriedita `FoldLineSet.select_Takakukei(polygon, "unselectAction")`.
pub fn unselect_polygon(model: &mut CreasePatternModel, polygon: &Polygon) -> usize {
    select_by_polygon_intersection(model, polygon, UNSELECTED)
}

/// Oriedita `FoldLineSet.select_lasso(..., SELECT, INTERSECT_CONTAIN)`.
pub fn select_lasso(model: &mut CreasePatternModel, path: &Polygon) -> usize {
    select_by_lasso(
        model,
        path,
        SELECTED,
        LassoInteractionMode::IntersectContain,
    )
}

/// Oriedita `FoldLineSet.select_lasso(..., UNSELECT, INTERSECT_CONTAIN)`.
pub fn unselect_lasso(model: &mut CreasePatternModel, path: &Polygon) -> usize {
    select_by_lasso(
        model,
        path,
        UNSELECTED,
        LassoInteractionMode::IntersectContain,
    )
}

/// Oriedita `FoldLineSet.select_lX(selection, "select_lX")`.
pub fn select_intersecting_line(model: &mut CreasePatternModel, selection: &LineSegment) -> usize {
    select_by_intersecting_line(model, selection, SELECTED)
}

/// Oriedita `FoldLineSet.select_lX(selection, "unselect_lX")`.
pub fn unselect_intersecting_line(
    model: &mut CreasePatternModel,
    selection: &LineSegment,
) -> usize {
    select_by_intersecting_line(model, selection, UNSELECTED)
}

/// Oriedita `FoldLineSet.selectProbablyConnected` without quadtree acceleration.
pub fn select_connected_from_point(model: &mut CreasePatternModel, point: Point) -> usize {
    let mut active_points = vec![point];
    let mut new_active_points = Vec::new();
    let mut processed_points = Vec::new();
    let mut connected_indices = Vec::new();

    while !active_points.is_empty() {
        for active_point in active_points.drain(..) {
            processed_points.push(active_point);

            for (index, line) in model.line_segments.iter().enumerate() {
                if equal(line.a, active_point) {
                    push_unique_usize(&mut connected_indices, index);
                    if !processed_points.contains(&line.b) {
                        push_unique_point(&mut new_active_points, line.b);
                    }
                }

                if equal(line.b, active_point) {
                    push_unique_usize(&mut connected_indices, index);
                    if !processed_points.contains(&line.a) {
                        push_unique_point(&mut new_active_points, line.a);
                    }
                }
            }
        }

        active_points.append(&mut new_active_points);
    }

    set_indices(model, &connected_indices, SELECTED)
}

/// Oriedita `FoldLineSet.delSelectedLineSegmentFast`.
pub fn delete_selected_lines(model: &mut CreasePatternModel) -> usize {
    let original_total = model.line_segments.len();
    model
        .line_segments
        .retain(|segment| segment.selected != SELECTED);
    original_total - model.line_segments.len()
}

fn set_all(model: &mut CreasePatternModel, selected: i32) -> usize {
    let mut changed = 0;
    for segment in &mut model.line_segments {
        if segment.selected != selected {
            changed += 1;
        }
        *segment = segment.with_selected(selected);
    }
    changed
}

fn set_indices(model: &mut CreasePatternModel, indices: &[usize], selected: i32) -> usize {
    let mut changed = 0;
    for index in indices {
        let Some(segment) = model.line_segments.get_mut(*index) else {
            continue;
        };

        if segment.selected != selected {
            changed += 1;
        }
        *segment = segment.with_selected(selected);
    }
    changed
}

fn select_by_boundary_or_inside(
    model: &mut CreasePatternModel,
    polygon: &Polygon,
    selected: i32,
) -> usize {
    let indices: Vec<_> = model
        .line_segments
        .iter()
        .enumerate()
        .filter(|(_, segment)| polygon.totu_boundary_inside_line_segment(segment))
        .map(|(index, _)| index)
        .collect();
    set_indices(model, &indices, selected)
}

fn select_by_polygon_intersection(
    model: &mut CreasePatternModel,
    polygon: &Polygon,
    selected: i32,
) -> usize {
    let indices: Vec<_> = model
        .line_segments
        .iter()
        .enumerate()
        .filter(|(_, segment)| {
            matches!(
                polygon.inside_outside_check(segment),
                PolygonIntersection::Border
                    | PolygonIntersection::BorderInside
                    | PolygonIntersection::Inside
            )
        })
        .map(|(index, _)| index)
        .collect();
    set_indices(model, &indices, selected)
}

fn select_by_intersecting_line(
    model: &mut CreasePatternModel,
    selection: &LineSegment,
    selected: i32,
) -> usize {
    let indices: Vec<_> = model
        .line_segments
        .iter()
        .enumerate()
        .filter(|(_, segment)| {
            is_line_segment_overlapping(segment, selection)
                || line_segment_x_kousa_decide(segment, selection)
        })
        .map(|(index, _)| index)
        .collect();
    set_indices(model, &indices, selected)
}

fn select_by_lasso(
    model: &mut CreasePatternModel,
    path: &Polygon,
    selected: i32,
    mode: LassoInteractionMode,
) -> usize {
    let mut changed = 0;
    for segment in &mut model.line_segments {
        if segment.selected == selected {
            continue;
        }

        let is_valid = match mode {
            LassoInteractionMode::Intersect => is_line_segment_intersecting_path(path, segment),
            LassoInteractionMode::Contain => is_line_segment_contained_in_path(path, segment),
            LassoInteractionMode::IntersectContain => {
                is_line_segment_intersecting_path(path, segment)
                    || is_line_segment_contained_in_path(path, segment)
            }
        };

        if is_valid {
            *segment = segment.with_selected(selected);
            changed += 1;
        }
    }
    changed
}

fn is_line_segment_intersecting_path(path: &Polygon, segment: &LineSegment) -> bool {
    path.line_segments()
        .iter()
        .any(|path_segment| line2d_intersects_line(segment, path_segment))
}

fn is_line_segment_contained_in_path(path: &Polygon, segment: &LineSegment) -> bool {
    path.inside(segment.a) == PolygonIntersection::Inside
        && path.inside(segment.b) == PolygonIntersection::Inside
        && !is_line_segment_intersecting_path(path, segment)
}

fn line2d_intersects_line(a: &LineSegment, b: &LineSegment) -> bool {
    relative_ccw(a.a, a.b, b.a) * relative_ccw(a.a, a.b, b.b) <= 0
        && relative_ccw(b.a, b.b, a.a) * relative_ccw(b.a, b.b, a.b) <= 0
}

fn relative_ccw(a: Point, b: Point, p: Point) -> i32 {
    let x2 = b.x - a.x;
    let y2 = b.y - a.y;
    let mut px = p.x - a.x;
    let mut py = p.y - a.y;
    let mut ccw = px * y2 - py * x2;
    if ccw == 0.0 {
        ccw = px * x2 + py * y2;
        if ccw > 0.0 {
            px -= x2;
            py -= y2;
            ccw = px * x2 + py * y2;
            if ccw < 0.0 {
                ccw = 0.0;
            }
        }
    }

    if ccw < 0.0 {
        -1
    } else if ccw > 0.0 {
        1
    } else {
        0
    }
}

fn push_unique_usize(values: &mut Vec<usize>, value: usize) {
    if !values.contains(&value) {
        values.push(value);
    }
}

fn push_unique_point(values: &mut Vec<Point>, value: Point) {
    if !values.contains(&value) {
        values.push(value);
    }
}
