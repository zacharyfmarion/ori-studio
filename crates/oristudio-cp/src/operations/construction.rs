//! Construction/drawing commands ported from Oriedita handlers.

use crate::geometry::{
    ActiveState, Epsilon, Intersection, LineColor, LineSegment, ParallelJudgement, Point,
    StraightLine, StraightLineIntersection, angle, angle_between_0_360, center,
    determine_line_segment_distance, determine_line_segment_intersection,
    determine_line_segment_intersection_sweet_with_tolerances, distance,
    find_intersection_segments, find_intersection_straight_lines, find_line_symmetry_line_segment,
    find_line_symmetry_point, find_projection, find_projection_segment, get_segment_with_length,
    is_line_segment_parallel, is_line_segment_parallel_with_precision, is_point_within_line_span,
    line_segment_rotate, line_segment_rotate_scaled, mid_point, move_parallel, point_rotate,
};
use crate::model::CreasePatternModel;
use crate::operations::arrangement::{
    add_line_segment_like_worker, del_v_at_point, divide_line_segment_with_new_lines,
};
use crate::operations::selection::unselect_all;
use crate::operations::transform::{extend_to_intersection_point, extend_to_intersection_point_2};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DrawCreaseTarget {
    FoldLine,
    AuxLine,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FoldableLineDrawOperationMode {
    DrawCreaseFree,
    VertexMakeAngularlyFlatFoldable,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AngleRestrictedConvergingCandidates {
    pub indicators: Vec<LineSegment>,
    pub intersections: Vec<Point>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FlatFoldableVertexCandidates {
    pub candidates: Vec<LineSegment>,
    pub commit_color: LineColor,
}

struct Axiom5IndicatorDecision<'a> {
    base: &'a LineSegment,
    first_projected: &'a LineSegment,
    second_projected: &'a LineSegment,
    pivot: Point,
    center1: Point,
    center2: Point,
    target: Point,
    target_segment: &'a LineSegment,
}

#[derive(Debug, Clone)]
struct WeightedVertexLine {
    segment: LineSegment,
    angle: f64,
}

struct ContinuousLengthenResult {
    segment: LineSegment,
    point: Point,
    flag: StraightLineIntersection,
    first_hit: LineSegment,
}

/// Oriedita free/restricted draw-crease insertion after endpoints are resolved.
pub fn draw_crease_segment(
    model: &mut CreasePatternModel,
    segment: &LineSegment,
    target: DrawCreaseTarget,
) -> bool {
    if !Epsilon::HIGH.gt0(segment.determine_length()) {
        return false;
    }

    match target {
        DrawCreaseTarget::FoldLine => add_line_segment_like_worker(model, segment),
        DrawCreaseTarget::AuxLine => model.add_aux_line_segment(segment.clone()),
    }
    true
}

/// Oriedita `DRAW_CREASE_ANGLE_RESTRICTED_5_37` snap-and-insert kernel.
pub fn draw_crease_angle_restricted_5(
    model: &mut CreasePatternModel,
    anchor: Point,
    pointer: Point,
    angle_system_divider: i32,
    angles: [f64; 6],
    selection_distance: f64,
    color: LineColor,
) -> bool {
    let release = snap_to_close_point_in_active_angle_system(
        model,
        anchor,
        pointer,
        angle_system_divider,
        angles,
        selection_distance,
    );
    draw_crease_segment(
        model,
        &LineSegment::with_color(anchor, release, color),
        DrawCreaseTarget::FoldLine,
    )
}

/// Oriedita `DRAW_CREASE_ANGLE_RESTRICTED_3_18` fan candidates after two points are resolved.
pub fn draw_crease_angle_restricted_3_candidates(
    start: Point,
    end: Point,
    angle_system_divider: i32,
    angles: [f64; 6],
) -> Vec<LineSegment> {
    let mut candidates = Vec::new();
    let count = if angle_system_divider != 0 {
        angle_system_divider * 2 - 1
    } else {
        6
    };
    let starting_segment = LineSegment::new(end, start);

    if angle_system_divider != 0 {
        let mut angle = 0.0;
        let angle_step = 180.0 / angle_system_divider as f64;
        for i in 0..count {
            angle += angle_step;
            let color = if i % 2 == 0 {
                LineColor::Orange4
            } else {
                LineColor::Green6
            };
            candidates.push(
                line_segment_rotate_scaled(&starting_segment, angle, 100.0).with_line_color(color),
            );
        }
    } else {
        for (index, angle) in angles.into_iter().enumerate() {
            let color = match index % 3 {
                0 => LineColor::Orange4,
                1 => LineColor::Green6,
                _ => LineColor::Purple8,
            };
            candidates.push(
                line_segment_rotate_scaled(&starting_segment, angle, 100.0).with_line_color(color),
            );
        }
    }

    candidates
}

/// Oriedita `DRAW_CREASE_ANGLE_RESTRICTED_3_18` final add after a fan line is chosen.
pub fn draw_crease_angle_restricted_3_to_point(
    model: &mut CreasePatternModel,
    pointer: Point,
    endpoint: Point,
    selected_candidate: &LineSegment,
    selection_distance: f64,
    color: LineColor,
) -> bool {
    if determine_line_segment_distance(pointer, selected_candidate) >= selection_distance {
        return false;
    }

    let mut target_point = find_projection(StraightLine::from_segment(selected_candidate), pointer);
    let closest_line = closest_line_segment_or_sentinel(model, pointer);
    if determine_line_segment_distance(pointer, &closest_line) < selection_distance
        && is_line_segment_parallel_with_precision(
            StraightLine::from_segment(selected_candidate),
            StraightLine::from_segment(&closest_line),
            Epsilon::UNKNOWN_1EN6,
        ) == ParallelJudgement::NotParallel
    {
        let intersection = find_intersection_segments(selected_candidate, &closest_line);
        if pointer.distance(target_point) * 2.0 > pointer.distance(intersection) {
            target_point = intersection;
        }
    }

    add_line_segment_like_worker(
        model,
        &LineSegment::with_color(target_point, endpoint, color),
    );
    true
}

/// Oriedita `DRAW_CREASE_ANGLE_RESTRICTED_13` indicator and convergence candidates.
pub fn angle_restricted_converging_candidates(
    segment: &LineSegment,
    angle_system_divider: i32,
    angles: [f64; 6],
) -> AngleRestrictedConvergingCandidates {
    let mut indicators = Vec::new();
    let count = if angle_system_divider != 0 {
        angle_system_divider * 2 - 1
    } else {
        6
    };

    if angle_system_divider != 0 {
        let angle_step = 180.0 / angle_system_divider as f64;
        push_angle_restricted_converging_divider_indicators(
            &mut indicators,
            segment,
            angle_step,
            count,
        );
        push_angle_restricted_converging_divider_indicators(
            &mut indicators,
            &segment.with_swapped_coordinates(),
            angle_step,
            count,
        );
    } else {
        push_angle_restricted_converging_custom_indicators(&mut indicators, segment, angles);
        push_angle_restricted_converging_custom_indicators(
            &mut indicators,
            &segment.with_swapped_coordinates(),
            angles,
        );
    }

    let intersections = angle_restricted_converging_intersections(segment, &indicators);
    AngleRestrictedConvergingCandidates {
        indicators,
        intersections,
    }
}

/// Oriedita `DRAW_CREASE_ANGLE_RESTRICTED_13` final add after a convergence point is chosen.
pub fn draw_crease_angle_restricted_converging(
    model: &mut CreasePatternModel,
    segment: &LineSegment,
    converge_point: Point,
    color: LineColor,
) -> usize {
    let first = LineSegment::with_color(segment.a, converge_point, color);
    let second = LineSegment::with_color(segment.b, converge_point, color);
    add_line_segment_like_worker(model, &first);
    add_line_segment_like_worker(model, &second);
    2
}

/// Oriedita `VERTEX_MAKE_ANGULARLY_FLAT_FOLDABLE_38` candidate generation after an invalid vertex is resolved.
pub fn make_vertex_flat_foldable_candidates(
    model: &CreasePatternModel,
    invalid_point: Point,
    grid_width: f64,
    color: LineColor,
) -> FlatFoldableVertexCandidates {
    let vertex_lines = sorted_vertex_folding_lines(model, invalid_point);
    let commit_color = if vertex_lines.len() == 1 {
        vertex_lines[0].segment.color
    } else {
        color
    };
    let candidates = odd_vertex_foldable_candidates(
        &vertex_lines,
        invalid_point,
        grid_width,
        ActiveState::Inactive0,
    );
    FlatFoldableVertexCandidates {
        candidates,
        commit_color,
    }
}

/// Oriedita `VERTEX_MAKE_ANGULARLY_FLAT_FOLDABLE_38` final add after candidate and destination are resolved.
pub fn make_vertex_flat_foldable_to_destination(
    model: &mut CreasePatternModel,
    invalid_point: Point,
    selected_candidate: &LineSegment,
    destination: &LineSegment,
    color: LineColor,
) -> bool {
    let cross_point = find_intersection_segments(selected_candidate, destination);
    let result = LineSegment::with_color(cross_point, invalid_point, color);
    if !Epsilon::HIGH.gt0(result.determine_length()) {
        return false;
    }
    add_line_segment_like_worker(model, &result);
    true
}

/// Oriedita `FOLDABLE_LINE_INPUT_39` generated step candidates after the starting vertex is resolved.
pub fn foldable_line_input_candidates(
    model: &CreasePatternModel,
    vertex: Point,
    grid_width: f64,
) -> Vec<LineSegment> {
    odd_vertex_foldable_candidates(
        &sorted_vertex_folding_lines(model, vertex),
        vertex,
        grid_width,
        ActiveState::ActiveA1,
    )
}

/// Oriedita `FOLDABLE_LINE_INPUT_39` fallback step when no flat-foldable candidate exists.
pub fn foldable_line_input_fallback(vertex: Point) -> LineSegment {
    LineSegment::with_color(vertex, vertex, LineColor::Purple8)
        .with_active(ActiveState::ActiveBoth3)
}

/// Oriedita `FOLDABLE_LINE_INPUT_39` final add when the resolved input segment endpoint is accepted.
pub fn foldable_line_input_direct(
    model: &mut CreasePatternModel,
    input: &LineSegment,
    color: LineColor,
) -> bool {
    let result = LineSegment::with_color(input.a, input.b, color);
    if !Epsilon::HIGH.gt0(result.determine_length()) {
        return false;
    }
    add_line_segment_like_worker(model, &result);
    true
}

/// Oriedita `FOLDABLE_LINE_INPUT_39` final add when the input segment is clipped to an existing line.
pub fn foldable_line_input_to_destination(
    model: &mut CreasePatternModel,
    input: &LineSegment,
    destination: &LineSegment,
    color: LineColor,
) -> bool {
    let result = LineSegment::with_color(
        find_intersection_segments(input, destination),
        input.a,
        color,
    );
    if !Epsilon::HIGH.gt0(result.determine_length()) {
        return false;
    }
    add_line_segment_like_worker(model, &result);
    true
}

/// Oriedita `FOLDABLE_LINE_DRAW_71` initial dispatch decision.
pub fn foldable_line_draw_operation_mode(
    model: &CreasePatternModel,
    pointer: Point,
    selection_distance: f64,
) -> FoldableLineDrawOperationMode {
    let closest_point = closest_model_point(model, pointer);
    let resolved_point = if pointer.distance(closest_point) > selection_distance {
        pointer
    } else {
        closest_point
    };
    if sorted_vertex_folding_lines(model, resolved_point)
        .len()
        .is_multiple_of(2)
    {
        FoldableLineDrawOperationMode::DrawCreaseFree
    } else {
        FoldableLineDrawOperationMode::VertexMakeAngularlyFlatFoldable
    }
}

/// Oriedita `FOLDABLE_LINE_DRAW_71` drag switch from flat-foldable mode to free draw.
pub fn foldable_line_draw_switches_to_free(
    pointer: Point,
    memo_point: Point,
    selection_distance: f64,
) -> bool {
    pointer.distance(memo_point) > selection_distance
}

/// Oriedita `SnappingUtil.snapToActiveAngleSystem` without UI grid candidates.
pub fn snap_to_active_angle_system(
    model: &CreasePatternModel,
    start: Point,
    point: Point,
    angle_system_divider: i32,
    angles: [f64; 6],
    selection_distance: f64,
) -> Point {
    let base = LineSegment::new(point, start);
    let radians = if angle_system_divider != 0 {
        let angle_step = 180.0 / angle_system_divider as f64;
        (angle_step * (angle(&base) / angle_step).round()).to_radians()
    } else {
        let current_angle = angle(&base);
        let mut best_difference = 1000.0;
        let mut best_angle = 0.0;
        for angle in angles {
            let candidate = angle - 180.0;
            let difference = angle_between_0_360(candidate - current_angle)
                .min(angle_between_0_360(current_angle - candidate));
            if difference < best_difference {
                best_difference = difference;
                best_angle = candidate;
            }
        }
        best_angle.to_radians()
    };

    let closest_segment = closest_line_segment_or_sentinel(model, point);
    let snap_line = LineSegment::new(
        base.b,
        Point::new(
            base.determine_bx() + radians.cos(),
            base.determine_by() + radians.sin(),
        ),
    );
    let mut result = find_projection(StraightLine::from_segment(&snap_line), point);
    if determine_line_segment_distance(point, &closest_segment) <= selection_distance
        && is_line_segment_parallel_with_precision(
            StraightLine::from_segment(&closest_segment),
            StraightLine::from_segment(&snap_line),
            Epsilon::PARALLEL_FOR_FIX,
        ) == ParallelJudgement::NotParallel
    {
        result = find_intersection_segments(&closest_segment, &snap_line);
    }
    result
}

/// Oriedita `SnappingUtil.snapToClosePointInActiveAngleSystem` without UI grid candidates.
pub fn snap_to_close_point_in_active_angle_system(
    model: &CreasePatternModel,
    start: Point,
    point: Point,
    angle_system_divider: i32,
    angles: [f64; 6],
    selection_distance: f64,
) -> Point {
    let snapped = snap_to_active_angle_system(
        model,
        start,
        point,
        angle_system_divider,
        angles,
        selection_distance,
    );
    let closest_point = closest_model_point(model, snapped);
    let offset_angle = angle((start, snapped, start, closest_point));
    let offset =
        Epsilon::UNKNOWN_1EN5 < offset_angle && offset_angle <= 360.0 - Epsilon::UNKNOWN_1EN5;
    if offset || snapped.distance(closest_point) > selection_distance {
        snapped
    } else {
        closest_point
    }
}

/// Oriedita `ANGLE_SYSTEM_16` preview candidates from two resolved points.
pub fn angle_system_candidates(
    start: Point,
    end: Point,
    angle_system_divider: i32,
    angles: [f64; 6],
) -> Vec<LineSegment> {
    let mut candidates = Vec::new();
    let count = if angle_system_divider != 0 {
        angle_system_divider * 2 - 1
    } else {
        6
    };
    let starting_segment = LineSegment::with_color(end, start, LineColor::Green6);
    candidates.push(starting_segment.clone());

    if angle_system_divider != 0 {
        let mut angle = 0.0;
        let angle_step = 180.0 / angle_system_divider as f64;
        for i in 0..count {
            angle += angle_step;
            let color = if i % 2 == 0 {
                LineColor::Orange4
            } else {
                LineColor::Green6
            };
            candidates.push(line_segment_rotate(&starting_segment, angle).with_line_color(color));
        }
    } else {
        for (index, angle) in angles.into_iter().enumerate() {
            let color = match index % 3 {
                0 => LineColor::Orange4,
                1 => LineColor::Green6,
                _ => LineColor::Purple8,
            };
            candidates.push(line_segment_rotate(&starting_segment, angle).with_line_color(color));
        }
    }

    candidates
}

/// Oriedita `ANGLE_SYSTEM_16` final add after a candidate direction and destination are resolved.
pub fn angle_system_draw_to_destination(
    model: &mut CreasePatternModel,
    release_point: Point,
    selected_segment: &LineSegment,
    destination: &LineSegment,
    color: LineColor,
) -> bool {
    let result = LineSegment::with_color(
        find_intersection_segments(destination, selected_segment),
        release_point,
        color,
    );
    if !Epsilon::HIGH.gt0(result.determine_length()) {
        return false;
    }
    add_line_segment_like_worker(model, &result);
    true
}

/// Oriedita `DRAW_CREASE_SYMMETRIC_12` mutation after the mirror axis is known.
pub fn mirror_selected_lines(model: &mut CreasePatternModel, axis: &LineSegment) -> usize {
    let selected: Vec<_> = model
        .line_segments
        .iter()
        .filter(|segment| segment.selected == 2)
        .cloned()
        .collect();
    if selected.is_empty() {
        return 0;
    }

    let original_end = model.line_segments.len();
    for segment in &selected {
        let mirrored =
            find_line_symmetry_line_segment(segment, axis).with_line_color(segment.color);
        model.add_line_segment(mirrored);
    }
    let added_end = model.line_segments.len();
    divide_line_segment_with_new_lines(model, original_end, added_end);
    unselect_all(model);
    selected.len()
}

/// Oriedita `PARALLEL_DRAW_40` final mutation after all three inputs are resolved.
pub fn parallel_draw(
    model: &mut CreasePatternModel,
    target_point: Point,
    parallel_segment: &LineSegment,
    destination_segment: &LineSegment,
    color: LineColor,
) -> bool {
    let guide = LineSegment::new(
        target_point,
        Point::new(
            target_point.x + parallel_segment.determine_bx() - parallel_segment.determine_ax(),
            target_point.y + parallel_segment.determine_by() - parallel_segment.determine_ay(),
        ),
    );
    let Some(result) = additional_intersection(&guide, destination_segment, color) else {
        return false;
    };
    add_line_segment_like_worker(model, &result);
    true
}

/// Oriedita `PARALLEL_DRAW_WIDTH_51` indicator generation after width is resolved.
pub fn parallel_width_indicators(selected_segment: &LineSegment, width: f64) -> [LineSegment; 2] {
    [
        move_parallel(selected_segment, width).with_line_color(LineColor::Purple8),
        move_parallel(selected_segment, -width).with_line_color(LineColor::Purple8),
    ]
}

/// Oriedita `PARALLEL_DRAW_WIDTH_51` final mutation after an indicator is chosen.
pub fn commit_parallel_width_indicator(
    model: &mut CreasePatternModel,
    indicator: &LineSegment,
    color: LineColor,
) -> bool {
    let segment = indicator.with_line_color(color);
    if !Epsilon::HIGH.gt0(segment.determine_length()) {
        return false;
    }
    add_line_segment_like_worker(model, &segment);
    true
}

/// Oriedita `PERPENDICULAR_DRAW_9` immediate projection branch.
pub fn perpendicular_projection(
    model: &mut CreasePatternModel,
    target_point: Point,
    perpendicular_segment: &LineSegment,
    color: LineColor,
) -> bool {
    let result = LineSegment::with_color(
        target_point,
        find_projection(
            StraightLine::from_segment(perpendicular_segment),
            target_point,
        ),
        color,
    );
    if !Epsilon::HIGH.gt0(result.determine_length()) {
        return false;
    }
    add_line_segment_like_worker(model, &result);
    true
}

/// Oriedita `PERPENDICULAR_DRAW_9` indicator branch after the base line is resolved.
pub fn perpendicular_indicator(
    model: &CreasePatternModel,
    target_point: Point,
    perpendicular_segment: &LineSegment,
) -> Option<LineSegment> {
    if !is_point_within_line_span(target_point, perpendicular_segment) {
        return None;
    }

    let moved = move_parallel(perpendicular_segment, 1.0);
    let seed = LineSegment::with_color(
        target_point,
        find_projection(StraightLine::from_segment(&moved), target_point),
        LineColor::Purple8,
    );
    let indicator = full_extend_until_hit(model, &seed);
    Some(full_extend_until_hit(
        model,
        &indicator.with_coordinates(indicator.b, indicator.a),
    ))
}

/// Add the chosen perpendicular indicator itself.
pub fn commit_perpendicular_indicator(
    model: &mut CreasePatternModel,
    indicator: &LineSegment,
    color: LineColor,
) -> bool {
    let result = indicator.with_line_color(color);
    if !Epsilon::HIGH.gt0(result.determine_length()) {
        return false;
    }
    add_line_segment_like_worker(model, &result);
    true
}

/// Oriedita `PERPENDICULAR_DRAW_9` destination branch after an indicator is resolved.
pub fn perpendicular_draw_to_destination(
    model: &mut CreasePatternModel,
    target_point: Point,
    indicator: &LineSegment,
    destination_segment: &LineSegment,
    color: LineColor,
) -> bool {
    let guide = LineSegment::new(
        target_point,
        Point::new(
            target_point.x + indicator.determine_bx() - indicator.determine_ax(),
            target_point.y + indicator.determine_by() - indicator.determine_ay(),
        ),
    );
    let Some(result) = additional_intersection(&guide, destination_segment, color) else {
        return false;
    };
    add_line_segment_like_worker(model, &result);
    true
}

/// Oriedita `AXIOM_5` purple indicator generation after target point, target line, and pivot are resolved.
pub fn axiom5_indicators(
    model: &CreasePatternModel,
    target_point: Point,
    target_segment: &LineSegment,
    pivot_point: Point,
) -> Option<[LineSegment; 2]> {
    if distance(pivot_point, target_point) <= Epsilon::UNKNOWN_1EN7 {
        return None;
    }
    if is_point_within_line_span(pivot_point, target_segment)
        && is_point_within_line_span(target_point, target_segment)
    {
        return None;
    }

    let radius = distance(target_point, pivot_point);
    if radius <= Epsilon::UNKNOWN_1EN7 {
        return None;
    }

    let mut length_a = 0.0;
    if !is_point_within_line_span(pivot_point, target_segment) {
        length_a = distance(
            pivot_point,
            find_projection_segment(target_segment, pivot_point),
        );
    }

    if (length_a - radius).abs() < Epsilon::UNKNOWN_1EN7 {
        return axiom5_tangent_indicators(model, target_point, target_segment, pivot_point);
    }
    if length_a > radius {
        return None;
    }

    let base = LineSegment::new(target_point, pivot_point);
    let project_point = find_projection_segment(target_segment, pivot_point);
    let length_b = ((radius * radius) - (length_a * length_a)).sqrt();
    let first_projected = axiom5_projected_line_of_indicator(pivot_point, project_point, length_b);
    let second_projected =
        axiom5_projected_line_of_indicator(pivot_point, project_point, -length_b);
    let (first_projected, second_projected) = axiom5_process_pivot_within_segment_span(
        first_projected,
        second_projected,
        target_segment,
        pivot_point,
    );
    let center1 = axiom5_process_center(pivot_point, &base, &first_projected);
    let center2 = axiom5_process_center(pivot_point, &base, &second_projected);
    axiom5_determine_indicators(
        model,
        Axiom5IndicatorDecision {
            base: &base,
            first_projected: &first_projected,
            second_projected: &second_projected,
            pivot: pivot_point,
            center1,
            center2,
            target: target_point,
            target_segment,
        },
    )
}

/// Add the chosen Axiom 5 indicator itself.
pub fn commit_axiom5_indicator(
    model: &mut CreasePatternModel,
    indicator: &LineSegment,
    color: LineColor,
) -> bool {
    let reversed = LineSegment::with_color(indicator.b, indicator.a, color);
    let result = full_extend_until_hit(model, &reversed);
    if !Epsilon::HIGH.gt0(result.determine_length()) {
        return false;
    }
    add_line_segment_like_worker(model, &result);
    true
}

/// Oriedita `AXIOM_5` destination branch after indicators and destination are resolved.
pub fn axiom5_draw_to_destination(
    model: &mut CreasePatternModel,
    pivot_point: Point,
    indicator1: &LineSegment,
    indicator2: &LineSegment,
    destination: &LineSegment,
    pointer: Point,
    color: LineColor,
) -> bool {
    let intersection1 = find_intersection_segments(indicator1, destination);
    let intersection2 = find_intersection_segments(indicator2, destination);
    let target = if distance(pointer, intersection1) < distance(pointer, intersection2) {
        intersection1
    } else {
        intersection2
    };
    let result = LineSegment::with_color(pivot_point, target, color);
    if !Epsilon::HIGH.gt0(result.determine_length()) {
        return false;
    }
    add_line_segment_like_worker(model, &result);
    true
}

/// Oriedita `AXIOM_7` purple indicator generation after target inputs are resolved.
pub fn axiom7_indicator(
    model: &CreasePatternModel,
    target_point: Point,
    target_segment: &LineSegment,
    perpendicular_segment: &LineSegment,
) -> Option<LineSegment> {
    let guide = LineSegment::new(
        target_point,
        Point::new(
            target_point.x + perpendicular_segment.determine_bx()
                - perpendicular_segment.determine_ax(),
            target_point.y + perpendicular_segment.determine_by()
                - perpendicular_segment.determine_ay(),
        ),
    );
    let extend_line = additional_intersection(&guide, target_segment, LineColor::Purple8)?;
    let midpoint = mid_point(
        target_point,
        find_intersection_segments(&extend_line, target_segment),
    );
    let moved = move_parallel(&extend_line, 1.0);
    let indicator = full_extend_until_hit(
        model,
        &LineSegment::with_color(
            midpoint,
            find_projection(StraightLine::from_segment(&moved), midpoint),
            LineColor::Purple8,
        ),
    );
    Some(full_extend_until_hit(
        model,
        &indicator.with_coordinates(indicator.b, indicator.a),
    ))
}

/// Add the chosen Axiom 7 indicator itself.
pub fn commit_axiom7_indicator(
    model: &mut CreasePatternModel,
    indicator: &LineSegment,
    color: LineColor,
) -> bool {
    let result = indicator.with_line_color(color);
    if !Epsilon::HIGH.gt0(result.determine_length()) {
        return false;
    }
    add_line_segment_like_worker(model, &result);
    true
}

/// Oriedita `AXIOM_7` destination branch after its indicator is resolved.
pub fn axiom7_draw_to_destination(
    model: &mut CreasePatternModel,
    indicator: &LineSegment,
    destination: &LineSegment,
    color: LineColor,
) -> bool {
    let Some(result) = additional_intersection(indicator, destination, color) else {
        return false;
    };
    add_line_segment_like_worker(model, &result);
    true
}

/// Oriedita `SYMMETRIC_DRAW_10` final mutation after two construction lines are resolved.
pub fn symmetric_draw(
    model: &mut CreasePatternModel,
    source: &LineSegment,
    mirror: &LineSegment,
    color: LineColor,
) -> bool {
    let cross = find_intersection_segments(source, mirror);
    let reflected = find_line_symmetry_point(
        cross,
        mirror.determine_furthest_endpoint(cross),
        source.determine_furthest_endpoint(cross),
    );
    let add_segment = extend_to_intersection_point(model, &LineSegment::new(cross, reflected))
        .with_line_color(color);
    if !Epsilon::HIGH.gt0(add_segment.determine_length()) {
        return false;
    }
    add_line_segment_like_worker(model, &add_segment);
    true
}

/// Oriedita `DOUBLE_SYMMETRIC_DRAW_35` final mutation after the drag axis is resolved.
pub fn double_symmetric_draw(model: &mut CreasePatternModel, drag_segment: &LineSegment) -> usize {
    if !Epsilon::HIGH.gt0(drag_segment.determine_length()) {
        return 0;
    }

    let snapshot = model.line_segments.clone();
    let mut added = 0;
    for segment in snapshot {
        let intersection = determine_line_segment_intersection_sweet_with_tolerances(
            &segment,
            drag_segment,
            Epsilon::UNKNOWN_001,
            Epsilon::UNKNOWN_001,
        );
        if !is_double_symmetric_intersection(intersection) {
            continue;
        }

        let mut source_point = segment.a;
        if determine_line_segment_distance(source_point, drag_segment)
            < determine_line_segment_distance(segment.b, drag_segment)
        {
            source_point = segment.b;
        }

        let reflected = find_line_symmetry_point(drag_segment.a, drag_segment.b, source_point);
        let add_segment = extend_to_intersection_point(
            model,
            &LineSegment::new(
                find_intersection_segments(&segment, drag_segment),
                reflected,
            ),
        )
        .with_line_color(segment.color);

        if Epsilon::HIGH.gt0(add_segment.determine_length()) {
            add_line_segment_like_worker(model, &add_segment);
            added += 1;
        }
    }
    added
}

/// Oriedita `CONTINUOUS_SYMMETRIC_DRAW_52` recursive reflection draw.
pub fn continuous_symmetric_draw(
    model: &mut CreasePatternModel,
    start: Point,
    through: Point,
    color: LineColor,
) -> usize {
    let mut segments = Vec::new();
    continuous_symmetric_segments(model, start, through, None, &mut segments);

    let mut line_color = color;
    let mut added = 0;
    for segment in segments {
        let result = segment.with_line_color(line_color);
        line_color = line_color.change_mv();
        if Epsilon::HIGH.gt0(result.determine_length()) {
            add_line_segment_like_worker(model, &result);
            added += 1;
        }
    }
    added
}

/// Oriedita `INWARD_8` final mutation after three distinct points are resolved.
pub fn inward(
    model: &mut CreasePatternModel,
    p1: Point,
    p2: Point,
    p3: Point,
    color: LineColor,
) -> usize {
    let center = center(p1, p2, p3);
    let mut added = 0;
    for point in [p1, p2, p3] {
        let segment = LineSegment::with_color(point, center, color);
        if Epsilon::HIGH.gt0(segment.determine_length()) {
            add_line_segment_like_worker(model, &segment);
            added += 1;
        }
    }
    added
}

/// Oriedita `SQUARE_BISECTOR_7` three-point branch after the destination is resolved.
pub fn square_bisector_from_points_to_destination(
    model: &mut CreasePatternModel,
    p1: Point,
    p2: Point,
    p3: Point,
    destination: &LineSegment,
    color: LineColor,
) -> bool {
    if is_point_within_line_span(p1, &LineSegment::new(p2, p3)) {
        return false;
    }

    let incenter = center(p1, p2, p3);
    let seed = LineSegment::new(p2, incenter);
    if is_line_segment_parallel(
        StraightLine::from_segment(&seed),
        StraightLine::from_segment(destination),
    ) != ParallelJudgement::NotParallel
    {
        return false;
    }

    let result = LineSegment::with_color(find_intersection_segments(&seed, destination), p2, color);
    add_square_bisector_line(model, &result)
}

/// Oriedita `SQUARE_BISECTOR_7` non-parallel two-line branch.
pub fn square_bisector_from_lines_to_destination(
    model: &mut CreasePatternModel,
    first: &LineSegment,
    second: &LineSegment,
    destination: &LineSegment,
    color: LineColor,
) -> bool {
    let intersection = find_intersection_segments(first, second);
    let incenter = center(
        intersection,
        first.determine_furthest_endpoint(intersection),
        second.determine_furthest_endpoint(intersection),
    );
    let temp_bisect = full_extend_until_hit(model, &LineSegment::new(intersection, incenter));
    if is_line_segment_parallel(
        StraightLine::from_segment(&temp_bisect),
        StraightLine::from_segment(destination),
    ) != ParallelJudgement::NotParallel
    {
        return false;
    }

    let result = LineSegment::with_color(
        find_intersection_segments(&temp_bisect, destination),
        intersection,
        color,
    );
    add_square_bisector_line(model, &result)
}

/// Oriedita `SQUARE_BISECTOR_7` parallel two-line purple indicator branch.
pub fn square_bisector_parallel_indicator(
    model: &CreasePatternModel,
    first: &LineSegment,
    second: &LineSegment,
) -> Option<LineSegment> {
    if is_line_segment_parallel_with_precision(
        StraightLine::from_segment(first),
        StraightLine::from_segment(second),
        Epsilon::UNKNOWN_1EN4,
    ) == ParallelJudgement::NotParallel
    {
        return None;
    }

    let projected = find_projection(StraightLine::from_segment(first), second.a);
    let midpoint = mid_point(second.a, projected);
    let perpendicular_seed = LineSegment::new(second.a, projected);
    let moved = move_parallel(&perpendicular_seed, -1.0);
    let indicator = full_extend_until_hit(
        model,
        &LineSegment::with_color(
            midpoint,
            find_projection(StraightLine::from_segment(&moved), midpoint),
            LineColor::Purple8,
        ),
    );
    Some(full_extend_until_hit(
        model,
        &indicator.with_coordinates(indicator.b, indicator.a),
    ))
}

/// Add the chosen parallel square-bisector indicator itself.
pub fn commit_square_bisector_parallel_indicator(
    model: &mut CreasePatternModel,
    indicator: &LineSegment,
    color: LineColor,
) -> bool {
    add_square_bisector_line(model, &indicator.with_line_color(color))
}

/// Oriedita `SQUARE_BISECTOR_7` parallel two-line branch using two destinations.
pub fn square_bisector_parallel_between_destinations(
    model: &mut CreasePatternModel,
    indicator: &LineSegment,
    first_destination: &LineSegment,
    second_destination: &LineSegment,
    color: LineColor,
) -> bool {
    if is_line_segment_parallel(
        StraightLine::from_segment(first_destination),
        StraightLine::from_segment(second_destination),
    ) == ParallelJudgement::ParallelEqual
    {
        return false;
    }

    let result = LineSegment::with_color(
        find_intersection_segments(indicator, first_destination),
        find_intersection_segments(indicator, second_destination),
        color,
    );
    add_square_bisector_line(model, &result)
}

fn add_square_bisector_line(model: &mut CreasePatternModel, segment: &LineSegment) -> bool {
    if !Epsilon::HIGH.gt0(segment.determine_length()) {
        return false;
    }
    add_line_segment_like_worker(model, segment);
    true
}

/// Oriedita `FISH_BONE_DRAW_33` final mutation after the drag segment is resolved.
pub fn fishbone_draw(
    model: &mut CreasePatternModel,
    drag_segment: &LineSegment,
    grid_width: f64,
    color: LineColor,
    selection_distance: f64,
) -> usize {
    if !Epsilon::HIGH.gt0(drag_segment.determine_length()) || grid_width <= 0.0 {
        return 0;
    }

    let dx = (drag_segment.determine_ax() - drag_segment.determine_bx()) * grid_width
        / drag_segment.determine_length();
    let dy = (drag_segment.determine_ay() - drag_segment.determine_by()) * grid_width
        / drag_segment.determine_length();
    let mut current_color = color;
    let mut added = 0;

    for i in 0..=(drag_segment.determine_length() / grid_width).floor() as usize {
        let point = Point::new(
            drag_segment.determine_bx() + i as f64 * dx,
            drag_segment.determine_by() + i as f64 * dy,
        );

        if closest_line_segment_distance_excluding_parallel(model, point, drag_segment)
            <= Epsilon::UNKNOWN_0001
        {
            continue;
        }

        let mut station_added = 0;
        for seed in [
            LineSegment::new(point, Point::new(point.x - dy, point.y + dx)),
            LineSegment::new(point, Point::new(point.x + dy, point.y - dx)),
        ] {
            if fishbone_has_forward_intersection(model, &seed) {
                let result =
                    extend_to_intersection_point(model, &seed).with_line_color(current_color);
                add_line_segment_like_worker(model, &result);
                station_added += 1;
                added += 1;
            }
        }

        if station_added == 2 {
            del_v_at_point(model, point, selection_distance, Epsilon::UNKNOWN_1EN6);
        }

        current_color = next_fishbone_color(current_color);
    }

    added
}

fn closest_line_segment_distance_excluding_parallel(
    model: &CreasePatternModel,
    point: Point,
    segment: &LineSegment,
) -> f64 {
    let mut minimum = 100_000.0;
    for existing in &model.line_segments {
        if is_line_segment_parallel_with_precision(
            StraightLine::from_segment(existing),
            StraightLine::from_segment(segment),
            Epsilon::UNKNOWN_1EN4,
        ) == ParallelJudgement::NotParallel
        {
            let distance = determine_line_segment_distance(point, existing);
            if minimum > distance {
                minimum = distance;
            }
        }
    }
    minimum
}

fn fishbone_has_forward_intersection(model: &CreasePatternModel, seed: &LineSegment) -> bool {
    let straight_line = StraightLine::from_segment(seed);
    for existing in &model.line_segments {
        if !straight_line
            .line_segment_intersect_reverse_detail(existing)
            .is_intersecting()
        {
            continue;
        }

        let intersection =
            find_intersection_straight_lines(straight_line, StraightLine::from_segment(existing));
        if intersection.distance(seed.a) <= Epsilon::UNKNOWN_1EN5 {
            continue;
        }

        let segment_angle = angle((seed.a, seed.b, seed.a, intersection));
        if !(1.0..=359.0).contains(&segment_angle) {
            return true;
        }
    }
    false
}

fn next_fishbone_color(color: LineColor) -> LineColor {
    match color {
        LineColor::Red1 => LineColor::Blue2,
        LineColor::Blue2 => LineColor::Red1,
        other => other,
    }
}

fn push_angle_restricted_converging_divider_indicators(
    indicators: &mut Vec<LineSegment>,
    segment: &LineSegment,
    angle_step: f64,
    count: i32,
) {
    let mut angle = 0.0;
    for i in 0..count {
        angle += angle_step;
        let color = if i % 2 == 0 {
            LineColor::Orange4
        } else {
            LineColor::Green6
        };
        indicators.push(line_segment_rotate_scaled(segment, angle, 10.0).with_line_color(color));
    }
}

fn push_angle_restricted_converging_custom_indicators(
    indicators: &mut Vec<LineSegment>,
    segment: &LineSegment,
    angles: [f64; 6],
) {
    for (index, angle) in angles.into_iter().enumerate() {
        // The Java handler's custom branch uses a 1-based loop against a six-value array.
        // Preserve its intended color order while keeping the Rust kernel non-panicking.
        let color = match index {
            0 | 4 => LineColor::Green6,
            1 | 5 => LineColor::Purple8,
            _ => LineColor::Orange4,
        };
        indicators.push(line_segment_rotate_scaled(segment, angle, 10.0).with_line_color(color));
    }
}

fn angle_restricted_converging_intersections(
    segment: &LineSegment,
    indicators: &[LineSegment],
) -> Vec<Point> {
    let mut intersections = Vec::new();
    for i in 0..indicators.len() {
        for j in (i + 1)..indicators.len() {
            let first = &indicators[i];
            let second = &indicators[j];
            let intersection = determine_line_segment_intersection(first, second);
            if !intersection.is_intersection() || intersection.is_overlapping() {
                continue;
            }

            let point = find_intersection_segments(first, second);
            if point == segment.a || point == segment.b {
                continue;
            }
            if intersections.contains(&point) {
                continue;
            }

            intersections.push(point);
        }
    }
    intersections
}

fn sorted_vertex_folding_lines(
    model: &CreasePatternModel,
    vertex: Point,
) -> Vec<WeightedVertexLine> {
    let mut lines = Vec::new();
    for segment in &model.line_segments {
        if !segment.color.is_folding_line() {
            continue;
        }
        if vertex.distance(segment.a) < Epsilon::UNKNOWN_1EN6 {
            lines.push(WeightedVertexLine {
                segment: segment.clone(),
                angle: angle((segment.a, segment.b)),
            });
        } else if vertex.distance(segment.b) < Epsilon::UNKNOWN_1EN6 {
            lines.push(WeightedVertexLine {
                segment: segment.clone(),
                angle: angle((segment.b, segment.a)),
            });
        }
    }
    lines.sort_by(|left, right| {
        left.angle
            .partial_cmp(&right.angle)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    lines
}

fn odd_vertex_foldable_candidates(
    vertex_lines: &[WeightedVertexLine],
    vertex: Point,
    grid_width: f64,
    active: ActiveState,
) -> Vec<LineSegment> {
    if vertex_lines.len().is_multiple_of(2) {
        return Vec::new();
    }

    let total = vertex_lines.len();
    let mut candidates = Vec::new();
    for i in 0..total {
        let mut angle_delta = 0.0;
        for k in 0..total {
            let near = (i + k) % total;
            let far = (i + k + 1) % total;
            let add_angle = angle_between_0_360(vertex_lines[far].angle - vertex_lines[near].angle);
            if k % 2 == 0 {
                angle_delta += add_angle;
            } else {
                angle_delta -= add_angle;
            }
        }

        if total == 1 {
            angle_delta = 360.0;
        }

        let next = (i + 1) % total;
        let mut first_wedge_angle =
            angle_between_0_360(vertex_lines[next].angle - vertex_lines[i].angle);
        if total == 1 {
            first_wedge_angle = 360.0;
        }

        let half_delta = angle_delta / 2.0;
        if half_delta <= Epsilon::UNKNOWN_1EN6
            || half_delta >= first_wedge_angle - Epsilon::UNKNOWN_1EN6
        {
            continue;
        }

        let base_line = base_line_from_vertex(&vertex_lines[i].segment, vertex);
        let base_length = base_line.determine_length();
        if !Epsilon::HIGH.gt0(base_length) {
            continue;
        }
        let candidate =
            line_segment_rotate_scaled(&base_line, half_delta, grid_width / base_length)
                .with_line_color(LineColor::Purple8)
                .with_active(active);
        candidates.push(candidate);
    }
    candidates
}

fn base_line_from_vertex(segment: &LineSegment, vertex: Point) -> LineSegment {
    if vertex.distance(segment.a) < Epsilon::UNKNOWN_1EN6 {
        LineSegment::new(segment.a, segment.b)
    } else if vertex.distance(segment.b) < Epsilon::UNKNOWN_1EN6 {
        LineSegment::new(segment.b, segment.a)
    } else {
        LineSegment::new(vertex, vertex)
    }
}

fn continuous_symmetric_segments(
    model: &CreasePatternModel,
    a: Point,
    b: Point,
    start: Option<Point>,
    output: &mut Vec<LineSegment>,
) {
    let Some(hit) = lengthen_until_intersection_disregard_included(model, a, b) else {
        return;
    };

    output.push(hit.segment.clone());
    if start.is_some_and(|start| Epsilon::HIGH.eq0(start.distance(hit.segment.b))) {
        return;
    }
    if hit.first_hit.color == LineColor::Black0 {
        return;
    }

    let start = start.unwrap_or(hit.segment.b);
    match hit.flag {
        StraightLineIntersection::IntersectX1 => {
            continuous_symmetric_reflect(model, a, start, output, &hit);
        }
        StraightLineIntersection::IntersectTA21 | StraightLineIntersection::IntersectTB22 => {
            continuous_symmetric_vertex_seed(model, a, b, start, output, &hit);
        }
        StraightLineIntersection::None0 | StraightLineIntersection::Included3 => {}
    }
}

fn continuous_symmetric_reflect(
    model: &CreasePatternModel,
    a: Point,
    start: Point,
    output: &mut Vec<LineSegment>,
    hit: &ContinuousLengthenResult,
) {
    let new_a = hit.point;
    let new_b = find_line_symmetry_point(hit.first_hit.a, hit.first_hit.b, a);
    continuous_symmetric_segments(model, new_a, new_b, Some(start), output);
}

fn continuous_symmetric_vertex_seed(
    model: &CreasePatternModel,
    a: Point,
    b: Point,
    start: Point,
    output: &mut Vec<LineSegment>,
    hit: &ContinuousLengthenResult,
) {
    let current_line = StraightLine::from_points(a, b);
    let vertex_lines = sorted_vertex_b_surrounding_fold_lines(model, hit.segment.a, hit.segment.b);
    match vertex_lines.len() {
        2 => {
            if current_line.line_segment_intersect_reverse_detail(&vertex_lines[0])
                == StraightLineIntersection::Included3
            {
                return;
            }
            if current_line.line_segment_intersect_reverse_detail(&vertex_lines[1])
                == StraightLineIntersection::Included3
            {
                return;
            }
            if StraightLine::from_segment(&vertex_lines[0])
                .line_segment_intersect_reverse_detail(&vertex_lines[1])
                == StraightLineIntersection::Included3
            {
                continuous_symmetric_reflect(model, a, start, output, hit);
            }
        }
        3 => {
            for included_index in 0..3 {
                if current_line.line_segment_intersect_reverse_detail(&vertex_lines[included_index])
                    != StraightLineIntersection::Included3
                {
                    continue;
                }
                let next_index = (included_index + 1) % 3;
                let last_index = (included_index + 2) % 3;
                if StraightLine::from_segment(&vertex_lines[next_index])
                    .line_segment_intersect_reverse_detail(&vertex_lines[last_index])
                    == StraightLineIntersection::Included3
                {
                    continuous_symmetric_reflect(model, a, start, output, hit);
                    return;
                }
            }
        }
        _ => {}
    }
}

fn lengthen_until_intersection_disregard_included(
    model: &CreasePatternModel,
    a: Point,
    b: Point,
) -> Option<ContinuousLengthenResult> {
    let mut closest_distance = Point::new(1_000_000.0, 1_000_000.0).distance(a);
    let straight_line = StraightLine::from_points(a, b);
    let mut result = None;

    for segment in &model.line_segments {
        if !segment.color.is_folding_line() {
            continue;
        }
        let flag = straight_line.line_segment_intersect_reverse_detail(segment);
        if !matches!(
            flag,
            StraightLineIntersection::IntersectX1
                | StraightLineIntersection::IntersectTA21
                | StraightLineIntersection::IntersectTB22
        ) {
            continue;
        }

        let intersection =
            find_intersection_straight_lines(straight_line, StraightLine::from_segment(segment));
        if intersection.distance(a) <= Epsilon::UNKNOWN_1EN5 {
            continue;
        }
        if intersection.distance(a) >= closest_distance {
            continue;
        }

        let intersection_angle = angle((a, b, a, intersection));
        if !(1.0..=359.0).contains(&intersection_angle) {
            closest_distance = intersection.distance(a);
            let segment_to_hit = LineSegment::new(a, intersection);
            result = Some(ContinuousLengthenResult {
                segment: segment_to_hit,
                point: intersection,
                flag,
                first_hit: segment.clone(),
            });
        }
    }

    result
}

fn sorted_vertex_b_surrounding_fold_lines(
    model: &CreasePatternModel,
    a: Point,
    b: Point,
) -> Vec<LineSegment> {
    let mut lines = Vec::new();
    for segment in &model.line_segments {
        if !segment.color.is_folding_line() {
            continue;
        }
        if b.distance(segment.a) < Epsilon::FLAT {
            lines.push((angle((b, a, segment.a, segment.b)), segment.clone()));
        } else if b.distance(segment.b) < Epsilon::FLAT {
            lines.push((angle((b, a, segment.b, segment.a)), segment.clone()));
        }
    }
    lines.sort_by(|left, right| {
        left.0
            .partial_cmp(&right.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    lines.into_iter().map(|(_, segment)| segment).collect()
}

fn axiom5_tangent_indicators(
    model: &CreasePatternModel,
    target_point: Point,
    target_segment: &LineSegment,
    pivot_point: Point,
) -> Option<[LineSegment; 2]> {
    let projection_point = find_projection_segment(target_segment, pivot_point);
    let projection_line = LineSegment::new(pivot_point, projection_point);

    if is_point_within_line_span(target_point, &projection_line) {
        if distance(projection_point, target_point) < Epsilon::UNKNOWN_1EN7 {
            let midpoint = mid_point(pivot_point, projection_point);
            return Some([
                full_extend_until_hit(
                    model,
                    &LineSegment::with_color(
                        midpoint,
                        find_projection_segment(&move_parallel(&projection_line, -1.0), midpoint),
                        LineColor::Purple8,
                    ),
                ),
                full_extend_until_hit(
                    model,
                    &LineSegment::with_color(
                        midpoint,
                        find_projection_segment(&move_parallel(&projection_line, 1.0), midpoint),
                        LineColor::Purple8,
                    ),
                ),
            ]);
        }

        return Some([
            full_extend_until_hit(
                model,
                &LineSegment::with_color(
                    pivot_point,
                    find_projection_segment(&move_parallel(&projection_line, 1.0), pivot_point),
                    LineColor::Purple8,
                ),
            ),
            full_extend_until_hit(
                model,
                &LineSegment::with_color(
                    pivot_point,
                    find_projection_segment(&move_parallel(&projection_line, -1.0), pivot_point),
                    LineColor::Purple8,
                ),
            ),
        ]);
    }

    let source = LineSegment::new(pivot_point, target_point);
    let indicator = if is_line_segment_parallel(
        StraightLine::from_segment(&source),
        StraightLine::from_segment(&projection_line),
    ) == ParallelJudgement::NotParallel
    {
        full_extend_until_hit(
            model,
            &LineSegment::with_color(
                pivot_point,
                center(pivot_point, target_point, projection_point),
                LineColor::Purple8,
            ),
        )
    } else {
        full_extend_until_hit(
            model,
            &LineSegment::with_color(pivot_point, projection_point, LineColor::Purple8),
        )
    };
    Some([indicator.clone(), indicator])
}

fn axiom5_projected_line_of_indicator(
    pivot: Point,
    project_point: Point,
    length: f64,
) -> LineSegment {
    let project_line = LineSegment::new(pivot, project_point);
    let shifted = move_parallel(&project_line, length);
    LineSegment::new(pivot, find_projection_segment(&shifted, project_point))
}

fn axiom5_process_center(pivot: Point, first: &LineSegment, second: &LineSegment) -> Point {
    let first_far = first.determine_furthest_endpoint(pivot);
    let second_far = second.determine_furthest_endpoint(pivot);
    if is_line_segment_parallel(
        StraightLine::from_points(first_far, pivot),
        StraightLine::from_points(pivot, second_far),
    ) == ParallelJudgement::ParallelEqual
    {
        let shifted = move_parallel(first, 1.0);
        let segment = LineSegment::new(pivot, find_projection_segment(&shifted, pivot));
        return center(
            first_far,
            second_far,
            segment.determine_furthest_endpoint(pivot),
        );
    }
    center(pivot, second_far, first_far)
}

fn axiom5_process_pivot_within_segment_span(
    mut first: LineSegment,
    mut second: LineSegment,
    target_segment: &LineSegment,
    pivot: Point,
) -> (LineSegment, LineSegment) {
    if is_point_within_line_span(pivot, target_segment) {
        if distance(pivot, target_segment.a) < Epsilon::UNKNOWN_1EN7 {
            first = LineSegment::new(pivot, point_rotate(pivot, target_segment.b, 180.0));
            second = LineSegment::new(pivot, target_segment.b);
            return (first, second);
        }
        if distance(pivot, target_segment.b) < Epsilon::UNKNOWN_1EN7 {
            first = LineSegment::new(pivot, target_segment.a);
            second = LineSegment::new(pivot, point_rotate(pivot, target_segment.a, 180.0));
            return (first, second);
        }

        let outside_a = target_segment.determine_length() > distance(target_segment.a, pivot)
            && distance(target_segment.b, pivot) > target_segment.determine_length();
        let outside_b = target_segment.determine_length() > distance(target_segment.b, pivot)
            && distance(target_segment.a, pivot) > target_segment.determine_length();

        first = LineSegment::new(
            pivot,
            if outside_a {
                point_rotate(pivot, target_segment.b, 180.0)
            } else {
                target_segment.a
            },
        );
        second = LineSegment::new(
            pivot,
            if outside_b {
                point_rotate(pivot, target_segment.a, 180.0)
            } else {
                target_segment.b
            },
        );
    }
    (first, second)
}

fn axiom5_determine_indicators(
    model: &CreasePatternModel,
    decision: Axiom5IndicatorDecision<'_>,
) -> Option<[LineSegment; 2]> {
    if distance(
        decision.center1,
        find_projection_segment(decision.target_segment, decision.center1),
    ) > Epsilon::UNKNOWN_1EN7
        || distance(
            decision.center2,
            find_projection_segment(decision.target_segment, decision.center2),
        ) > Epsilon::UNKNOWN_1EN7
    {
        if !is_point_within_line_span(decision.target, decision.target_segment) {
            return Some([
                full_extend_until_hit(
                    model,
                    &LineSegment::with_color(decision.pivot, decision.center1, LineColor::Purple8),
                ),
                full_extend_until_hit(
                    model,
                    &LineSegment::with_color(decision.pivot, decision.center2, LineColor::Purple8),
                ),
            ]);
        }
        if is_line_segment_parallel(
            StraightLine::from_segment(decision.first_projected),
            StraightLine::from_segment(decision.base),
        ) == ParallelJudgement::ParallelEqual
        {
            let indicator = full_extend_until_hit(
                model,
                &LineSegment::with_color(decision.pivot, decision.center2, LineColor::Purple8),
            );
            return Some([indicator.clone(), indicator]);
        }
        if is_line_segment_parallel(
            StraightLine::from_segment(decision.second_projected),
            StraightLine::from_segment(decision.base),
        ) == ParallelJudgement::ParallelEqual
        {
            let indicator = full_extend_until_hit(
                model,
                &LineSegment::with_color(decision.pivot, decision.center1, LineColor::Purple8),
            );
            return Some([indicator.clone(), indicator]);
        }
        return None;
    }

    Some([
        full_extend_until_hit(
            model,
            &LineSegment::with_color(
                decision.pivot,
                find_projection_segment(
                    &move_parallel(decision.first_projected, 1.0),
                    decision.pivot,
                ),
                LineColor::Purple8,
            ),
        ),
        full_extend_until_hit(
            model,
            &LineSegment::with_color(
                decision.pivot,
                find_projection_segment(
                    &move_parallel(decision.second_projected, -1.0),
                    decision.pivot,
                ),
                LineColor::Purple8,
            ),
        ),
    ])
}

fn closest_line_segment_or_sentinel(model: &CreasePatternModel, point: Point) -> LineSegment {
    let mut closest = LineSegment::new(
        Point::new(100_000.0, 100_000.0),
        Point::new(100_000.0, 100_000.1),
    );
    let mut minimum = 100_000.0;
    for segment in &model.line_segments {
        let distance = determine_line_segment_distance(point, segment);
        if minimum > distance {
            minimum = distance;
            closest = segment.clone();
        }
    }
    closest
}

fn closest_model_point(model: &CreasePatternModel, point: Point) -> Point {
    let mut closest = Point::new(100_000.0, 100_000.0);
    for segment in &model.line_segments {
        for endpoint in [segment.a, segment.b] {
            if point.distance_squared(endpoint) < point.distance_squared(closest) {
                closest = endpoint;
            }
        }
    }
    for circle in &model.circles {
        let center = circle.determine_center();
        if point.distance_squared(center) < point.distance_squared(closest) {
            closest = center;
        }
    }
    closest
}

fn is_double_symmetric_intersection(intersection: Intersection) -> bool {
    matches!(
        intersection,
        Intersection::IntersectsLShapeS1StartS2Start21
            | Intersection::IntersectsLShapeS1StartS2End22
            | Intersection::IntersectsLShapeS1EndS2Start23
            | Intersection::IntersectsLShapeS1EndS2End24
            | Intersection::IntersectsTShapeS1VerticalBar25
            | Intersection::IntersectsTShapeS1VerticalBar26
    )
}

fn additional_intersection(
    guide: &LineSegment,
    destination: &LineSegment,
    color: LineColor,
) -> Option<LineSegment> {
    let parallel = is_line_segment_parallel_with_precision(
        StraightLine::from_segment(guide),
        StraightLine::from_segment(destination),
        Epsilon::UNKNOWN_1EN7,
    );

    let cross_point = match parallel {
        ParallelJudgement::ParallelNotEqual => return None,
        ParallelJudgement::ParallelEqual => {
            if distance(guide.a, destination.a) > distance(guide.a, destination.b) {
                destination.b
            } else {
                destination.a
            }
        }
        ParallelJudgement::NotParallel => find_intersection_segments(guide, destination),
    };

    let result = LineSegment::with_color(cross_point, guide.a, color);
    if Epsilon::HIGH.gt0(result.determine_length()) {
        Some(result)
    } else {
        None
    }
}

fn full_extend_until_hit(model: &CreasePatternModel, segment: &LineSegment) -> LineSegment {
    let temp = get_segment_with_length(segment, 0.5);
    let point = temp.a;
    let temp = extend_to_intersection_point_2(model, &temp);
    LineSegment::with_color(
        point,
        temp.determine_furthest_endpoint(point),
        segment.color,
    )
}
