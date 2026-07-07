//! Transform operations ported from Oriedita selected-line move/copy handlers.

use crate::geometry::{
    Epsilon, Intersection, LineColor, LineSegment, ParallelJudgement, Point, Polygon,
    PolygonIntersection, StraightLine, StraightLineIntersection, angle,
    determine_line_segment_distance, determine_line_segment_intersection_sweet_with_tolerances,
    determine_line_segment_intersection_with_precision, find_intersection_segments,
    find_intersection_straight_lines, find_projection_segment,
    is_line_segment_parallel_with_precision, point_rotate_scaled,
};
use crate::model::CreasePatternModel;
use crate::operations::arrangement::{
    add_line_segment_like_worker, delete_line_segments_for_indices,
    divide_line_segment_with_new_lines,
};
use crate::operations::selection::{delete_selected_lines, unselect_all};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LengthenColorMode {
    Current(LineColor),
    SameAsOriginal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OperationFrameMode {
    None0,
    Create1,
    MovePoints2,
    MoveSides3,
    MoveBox4,
}

impl OperationFrameMode {
    pub const fn oriedita_name(self) -> &'static str {
        match self {
            Self::None0 => "NONE_0",
            Self::Create1 => "CREATE_1",
            Self::MovePoints2 => "MOVE_POINTS_2",
            Self::MoveSides3 => "MOVE_SIDES_3",
            Self::MoveBox4 => "MOVE_BOX_4",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct OperationFrameDragState {
    pub mode: OperationFrameMode,
    pub last_mouse_pos: Point,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct OperationFrame {
    pub active: bool,
    pub points: [Point; 4],
}

impl OperationFrame {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn p1(&self) -> Point {
        self.points[0]
    }

    pub fn p2(&self) -> Point {
        self.points[1]
    }

    pub fn p3(&self) -> Point {
        self.points[2]
    }

    pub fn p4(&self) -> Point {
        self.points[3]
    }

    pub fn polygon(&self) -> Polygon {
        Polygon::new(self.points.to_vec())
    }

    pub fn set_frame_point(&mut self, index: usize, point: Point) -> bool {
        if let Some(target) = self.points.get_mut(index) {
            *target = point;
            true
        } else {
            false
        }
    }

    pub fn set_frame_point_x(&mut self, index: usize, x: f64) -> bool {
        if let Some(target) = self.points.get_mut(index) {
            *target = target.with_x(x);
            true
        } else {
            false
        }
    }

    pub fn set_frame_point_y(&mut self, index: usize, y: f64) -> bool {
        if let Some(target) = self.points.get_mut(index) {
            *target = target.with_y(y);
            true
        } else {
            false
        }
    }

    pub fn reset(&mut self) {
        self.active = false;
    }
}

/// Oriedita `FoldLineSet.move(dx, dy)` for the editable model's FoldLineSet data.
pub fn translate_model(model: &mut CreasePatternModel, dx: f64, dy: f64) {
    let delta = Point::new(dx, dy);
    for segment in &mut model.line_segments {
        *segment = translate_segment(segment, delta);
    }
    for circle in &mut model.circles {
        *circle = circle.with_center(circle.determine_center().move_by(delta));
    }
}

/// Oriedita `OPERATION_FRAME_CREATE_61` mouse-press state transition with an identity camera.
pub fn operation_frame_press(
    model: &CreasePatternModel,
    frame: &mut OperationFrame,
    point: Point,
    selection_distance: f64,
) -> OperationFrameDragState {
    let p1 = frame.p1();
    let p2 = frame.p2();
    let p3 = frame.p3();
    let p4 = frame.p4();
    let mut mode = OperationFrameMode::None0;
    if !frame.active {
        mode = OperationFrameMode::Create1;
    }

    if frame.active {
        let mut distance_min = determine_line_segment_distance(point, &LineSegment::new(p1, p2));
        distance_min = distance_min.min(determine_line_segment_distance(
            point,
            &LineSegment::new(p2, p3),
        ));
        distance_min = distance_min.min(determine_line_segment_distance(
            point,
            &LineSegment::new(p3, p4),
        ));
        distance_min = distance_min.min(determine_line_segment_distance(
            point,
            &LineSegment::new(p4, p1),
        ));

        if distance_min < selection_distance {
            mode = OperationFrameMode::MoveSides3;
        } else if frame.polygon().inside(point) == PolygonIntersection::Outside {
            mode = OperationFrameMode::Create1;
        } else {
            mode = OperationFrameMode::MoveBox4;
        }

        if point.distance(p1) < selection_distance {
            let moved = frame.p1();
            frame.set_frame_point(0, frame.p3());
            frame.set_frame_point(2, moved);
            mode = OperationFrameMode::MovePoints2;
        }
        if point.distance(p2) < selection_distance {
            let moved = frame.p2();
            frame.set_frame_point(1, frame.p1());
            frame.set_frame_point(0, frame.p4());
            frame.set_frame_point(3, frame.p3());
            frame.set_frame_point(2, moved);
            mode = OperationFrameMode::MovePoints2;
        }
        if point.distance(p3) < selection_distance {
            let moved = frame.p3();
            frame.set_frame_point(0, frame.p1());
            frame.set_frame_point(2, moved);
            mode = OperationFrameMode::MovePoints2;
        }
        if point.distance(p4) < selection_distance {
            let moved = frame.p4();
            frame.set_frame_point(3, frame.p1());
            frame.set_frame_point(0, frame.p2());
            frame.set_frame_point(1, frame.p3());
            frame.set_frame_point(2, moved);
            mode = OperationFrameMode::MovePoints2;
        }

        if mode == OperationFrameMode::MoveSides3 {
            let mut p_ob1 = p1;
            let mut p_ob2 = p2;
            let mut p_ob3 = p3;
            let mut p_ob4 = p4;
            for _ in 0..4 {
                if determine_line_segment_distance(point, &LineSegment::new(p_ob1, p_ob2))
                    == distance_min
                {
                    break;
                }
                let moved = frame.p1();
                frame.set_frame_point(0, frame.p2());
                frame.set_frame_point(1, frame.p3());
                frame.set_frame_point(2, frame.p4());
                frame.set_frame_point(3, moved);

                let previous = p_ob1;
                p_ob1 = p_ob2;
                p_ob2 = p_ob3;
                p_ob3 = p_ob4;
                p_ob4 = previous;
            }
        }
    }

    if mode == OperationFrameMode::Create1 {
        frame.active = true;
        let mut snapped = point;
        let closest_point = closest_operation_frame_point(model, point);
        if point.distance(closest_point) < selection_distance {
            snapped = closest_point;
        }
        for index in 0..4 {
            frame.set_frame_point(index, snapped);
        }
    }

    OperationFrameDragState {
        mode,
        last_mouse_pos: point,
    }
}

/// Oriedita `OPERATION_FRAME_CREATE_61` mouse-drag update with an identity camera.
pub fn operation_frame_drag(
    model: &CreasePatternModel,
    frame: &mut OperationFrame,
    state: &mut OperationFrameDragState,
    point: Point,
    selection_distance: f64,
) {
    if state.mode == OperationFrameMode::MovePoints2 {
        state.mode = OperationFrameMode::Create1;
    }

    let closest_point = closest_operation_frame_point(model, point);
    let snapped = if point.distance(closest_point) < selection_distance {
        closest_point
    } else {
        point
    };

    update_operation_frame(frame, state, snapped);
    state.last_mouse_pos = snapped;
}

/// Oriedita `OPERATION_FRAME_CREATE_61` mouse-release update with an identity camera.
pub fn operation_frame_release(
    model: &CreasePatternModel,
    frame: &mut OperationFrame,
    state: &OperationFrameDragState,
    point: Point,
    selection_distance: f64,
) {
    let closest_point = closest_operation_frame_point(model, point);
    let snapped = if point.distance(closest_point) <= selection_distance {
        closest_point
    } else {
        point
    };

    update_operation_frame(frame, state, snapped);
    if frame.polygon().calculate_area() < 1.0 {
        frame.active = false;
    }
}

pub fn operation_frame_reset(frame: &mut OperationFrame) {
    frame.reset();
}

/// Oriedita `CREASE_MOVE_21` final mutation after selected lines and delta are known.
pub fn move_selected_lines(model: &mut CreasePatternModel, delta: Point) -> usize {
    if !Epsilon::HIGH.gt0(delta.distance(Point::origin())) {
        return 0;
    }

    let mut selected = selected_line_segments(model);
    let moved_count = selected.len();
    if moved_count == 0 {
        return 0;
    }

    delete_selected_lines(model);
    translate_segments(&mut selected, delta);
    append_and_split(model, selected);
    unselect_all(model);
    moved_count
}

/// Oriedita `CREASE_COPY_22` final mutation after selected lines and delta are known.
pub fn copy_selected_lines(model: &mut CreasePatternModel, delta: Point) -> usize {
    if !Epsilon::HIGH.gt0(delta.distance(Point::origin())) {
        return 0;
    }

    let mut selected = selected_line_segments(model);
    let copied_count = selected.len();
    if copied_count == 0 {
        return 0;
    }

    translate_segments(&mut selected, delta);
    for segment in &mut selected {
        *segment = segment.with_selected(0);
    }
    append_and_split(model, selected);
    unselect_all(model);
    copied_count
}

/// Oriedita `CREASE_MOVE_4P_31` final mutation once all four points are known.
pub fn move_selected_lines_by_points(
    model: &mut CreasePatternModel,
    original_a: Point,
    original_b: Point,
    target_a: Point,
    target_b: Point,
) -> usize {
    let mut selected = selected_line_segments(model);
    let moved_count = selected.len();
    if moved_count == 0 {
        return 0;
    }

    delete_selected_lines(model);
    transform_segments_by_points(&mut selected, original_a, original_b, target_a, target_b);
    append_and_split(model, selected);
    unselect_all(model);
    moved_count
}

/// Oriedita `CREASE_COPY_4P_32` final mutation once all four points are known.
pub fn copy_selected_lines_by_points(
    model: &mut CreasePatternModel,
    original_a: Point,
    original_b: Point,
    target_a: Point,
    target_b: Point,
) -> usize {
    let mut selected = selected_line_segments(model);
    let copied_count = selected.len();
    if copied_count == 0 {
        return 0;
    }

    transform_segments_by_points(&mut selected, original_a, original_b, target_a, target_b);
    for segment in &mut selected {
        *segment = segment.with_selected(0);
    }
    append_and_split(model, selected);
    unselect_all(model);
    copied_count
}

/// Insert app-resolved clipboard line segments into the editable fold line set.
pub fn insert_line_segments(
    model: &mut CreasePatternModel,
    segments: &[LineSegment],
    select_inserted: bool,
) -> usize {
    unselect_all(model);
    let selected = if select_inserted { 2 } else { 0 };
    let mut inserted = 0;
    for segment in segments {
        if !Epsilon::HIGH.gt0(segment.a.distance(segment.b)) {
            continue;
        }
        model.add_line_segment(segment.with_selected(selected));
        inserted += 1;
    }
    inserted
}

/// Replace resolved line IDs with transformed app-resolved line segments.
pub fn replace_line_segments(
    model: &mut CreasePatternModel,
    line_indices: &[usize],
    segments: &[LineSegment],
) -> usize {
    if line_indices.is_empty() || segments.is_empty() {
        return 0;
    }
    let deleted = delete_line_segments_for_indices(model, line_indices);
    if deleted == 0 {
        return 0;
    }
    insert_line_segments(model, segments, true)
}

/// Oriedita `FoldLineSet.move(ta, tb, tc, td)` line-segment transform.
pub fn transform_segments_by_points(
    segments: &mut [LineSegment],
    original_a: Point,
    original_b: Point,
    target_a: Point,
    target_b: Point,
) {
    let rotation = angle((original_a, original_b, target_a, target_b));
    let scale = target_a.distance(target_b) / original_a.distance(original_b);
    let delta = original_a.delta(target_a);

    for segment in segments {
        let new_a = point_rotate_scaled(original_a, segment.a, rotation, scale).move_by(delta);
        let new_b = point_rotate_scaled(original_a, segment.b, rotation, scale).move_by(delta);
        *segment = segment.with_coordinates(new_a, new_b);
    }
}

/// Oriedita `CreasePattern_Worker.extendToIntersectionPoint`: extends `segment`
/// from its `A` endpoint toward `B` until it meets the nearest forward polyline,
/// keeping `A` fixed. Returns the segment unchanged when nothing intersects.
///
/// This differs from [`extend_to_intersection_point_2`], which drops the
/// original `A`→`B` span and returns `B`→intersection. Tools that anchor a line
/// at a specific point (fishbone ribs, symmetric/double-symmetric construction
/// lines) need `A` preserved so the drawn line stays connected to that anchor.
pub fn extend_to_intersection_point(
    model: &CreasePatternModel,
    segment: &LineSegment,
) -> LineSegment {
    let mut add_segment = segment.clone();
    let mut intersection_distance = Point::new(1_000_000.0, 1_000_000.0).distance(add_segment.a);
    let straight_line = StraightLine::from_points(add_segment.a, add_segment.b);

    for existing in &model.line_segments {
        if !straight_line
            .line_segment_intersect_reverse_detail(existing)
            .is_intersecting()
        {
            continue;
        }
        let intersection =
            find_intersection_straight_lines(straight_line, StraightLine::from_segment(existing));
        if should_extend_to(
            add_segment.a,
            add_segment.b,
            intersection,
            intersection_distance,
        ) {
            intersection_distance = intersection.distance(add_segment.a);
            add_segment = add_segment.with_b(intersection);
        }
    }

    add_segment
}

/// Oriedita `OritaCalc.extendToIntersectionPoint_2`.
pub fn extend_to_intersection_point_2(
    model: &CreasePatternModel,
    segment: &LineSegment,
) -> LineSegment {
    let mut add_segment = segment.clone();
    let mut intersection_point = Point::new(1_000_000.0, 1_000_000.0);
    let mut intersection_distance = intersection_point.distance(add_segment.a);
    let straight_line = StraightLine::from_points(add_segment.a, add_segment.b);

    for existing in &model.line_segments {
        let straight_intersection = straight_line.line_segment_intersect_reverse_detail(existing);
        let segment_intersection = determine_line_segment_intersection_sweet_with_tolerances(
            segment,
            existing,
            Epsilon::UNKNOWN_1EN5,
            Epsilon::UNKNOWN_1EN5,
        );

        if straight_intersection.is_intersecting()
            && !segment_intersection.is_endpoint_intersection()
        {
            intersection_point = find_intersection_straight_lines(
                straight_line,
                StraightLine::from_segment(existing),
            );
            if should_extend_to(
                add_segment.a,
                add_segment.b,
                intersection_point,
                intersection_distance,
            ) {
                intersection_distance = intersection_point.distance(add_segment.a);
                add_segment = add_segment.with_b(intersection_point);
            }
        }

        if straight_intersection == StraightLineIntersection::Included3
            && segment_intersection != Intersection::ParallelEqual31
        {
            for point in [existing.a, existing.b] {
                if should_extend_to(add_segment.a, add_segment.b, point, intersection_distance) {
                    intersection_distance = point.distance(add_segment.a);
                    add_segment = add_segment.with_b(point);
                }
            }
        }
    }

    add_segment.with_a(segment.b)
}

/// Oriedita `MouseHandlerLengthenCrease` / `MouseHandlerLengthenCreaseSameColor`
/// final model mutation from resolved model-space inputs.
pub fn lengthen_crease(
    model: &mut CreasePatternModel,
    selection_line: LineSegment,
    extension_point: Point,
    selection_distance: f64,
    color_mode: LengthenColorMode,
) -> usize {
    let Some(extension_line) = closest_line_segment(model, extension_point) else {
        return 0;
    };

    let (selection_line, lines_to_extend) =
        lengthen_candidates(model, selection_line, selection_distance);
    if lines_to_extend.is_empty()
        || determine_line_segment_distance(extension_point, &extension_line) >= selection_distance
    {
        return 0;
    }

    let same_line_mode = lines_to_extend.iter().any(|line| {
        determine_line_segment_intersection_with_precision(
            line,
            &extension_line,
            Epsilon::UNKNOWN_1EN6,
        ) == Intersection::ParallelEqual31
    });

    let mut added = 0;
    if !same_line_mode {
        for original in lines_to_extend {
            if is_line_segment_parallel_with_precision(
                StraightLine::from_segment(&original),
                StraightLine::from_segment(&extension_line),
                Epsilon::UNKNOWN_1EN6,
            ) == ParallelJudgement::NotParallel
            {
                let intersection = find_intersection_segments(&original, &extension_line);
                let add_segment = LineSegment::new(
                    intersection,
                    original.determine_closest_endpoint(intersection),
                );
                if add_extended_line_segment(model, add_segment, &original, color_mode) {
                    added += 1;
                }
            }
        }
    } else {
        for original in lines_to_extend {
            let intersection = find_intersection_segments(&original, &selection_line);
            let line_to_extend =
                if intersection.distance(original.a) < intersection.distance(original.b) {
                    original.with_swapped_coordinates()
                } else {
                    original
                };
            let add_segment = extend_to_intersection_point_2(model, &line_to_extend);
            if add_extended_line_segment(model, add_segment, &line_to_extend, color_mode) {
                added += 1;
            }
        }
    }

    added
}

fn lengthen_candidates(
    model: &CreasePatternModel,
    mut selection_line: LineSegment,
    selection_distance: f64,
) -> (LineSegment, Vec<LineSegment>) {
    let mut candidates = Vec::<(LineSegment, f64)>::new();
    for line in &model.line_segments {
        let intersection = determine_line_segment_intersection_with_precision(
            line,
            &selection_line,
            Epsilon::UNKNOWN_1EN4,
        );
        if intersection == Intersection::Intersects1 {
            candidates.push((
                line.clone(),
                selection_line
                    .a
                    .distance(find_intersection_segments(line, &selection_line)),
            ));
        }
    }

    if candidates.is_empty()
        && selection_line.determine_length() <= Epsilon::UNKNOWN_1EN6
        && let Some(closest) = closest_line_segment(model, selection_line.b)
        && determine_line_segment_distance(selection_line.b, &closest) < selection_distance
    {
        let mut projection = find_projection_segment(&closest, selection_line.b);
        if determine_line_segment_distance(projection, &closest) > Epsilon::UNKNOWN_1EN6 {
            projection = closest.determine_closest_endpoint(projection);
        }
        selection_line = selection_line.with_coordinates(projection, projection);
        candidates.push((closest, 1.0));
    }

    candidates.sort_by(|(_, left), (_, right)| left.total_cmp(right));
    (
        selection_line,
        candidates.into_iter().map(|(segment, _)| segment).collect(),
    )
}

fn add_extended_line_segment(
    model: &mut CreasePatternModel,
    add_segment: LineSegment,
    original: &LineSegment,
    color_mode: LengthenColorMode,
) -> bool {
    if !Epsilon::HIGH.gt0(add_segment.determine_length()) {
        return false;
    }

    let color = match color_mode {
        LengthenColorMode::Current(color) => color,
        LengthenColorMode::SameAsOriginal => original.color,
    };
    add_line_segment_like_worker(model, &add_segment.with_line_color(color));
    true
}

fn closest_line_segment(model: &CreasePatternModel, point: Point) -> Option<LineSegment> {
    let mut min_distance = 100_000.0;
    let mut closest = None;
    for segment in &model.line_segments {
        let distance = determine_line_segment_distance(point, segment);
        if min_distance > distance {
            min_distance = distance;
            closest = Some(segment.clone());
        }
    }
    closest
}

fn closest_operation_frame_point(model: &CreasePatternModel, point: Point) -> Point {
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

fn update_operation_frame(
    frame: &mut OperationFrame,
    state: &OperationFrameDragState,
    point: Point,
) {
    if state.mode == OperationFrameMode::MoveSides3 {
        if (frame.p1().x - frame.p2().x).abs() < (frame.p1().y - frame.p2().y).abs() {
            frame.set_frame_point_x(0, point.x);
            frame.set_frame_point_x(1, point.x);
        }

        if (frame.p1().x - frame.p2().x).abs() > (frame.p1().y - frame.p2().y).abs() {
            frame.set_frame_point_y(0, point.y);
            frame.set_frame_point_y(1, point.y);
        }
    }

    if state.mode == OperationFrameMode::MoveBox4 {
        let delta = state.last_mouse_pos.delta(point);
        for frame_point in &mut frame.points {
            *frame_point = frame_point.move_by(delta);
        }
    }

    if state.mode == OperationFrameMode::Create1 {
        frame.set_frame_point(2, point);
        frame.set_frame_point(1, Point::new(frame.p1().x, frame.p3().y));
        frame.set_frame_point(3, Point::new(frame.p3().x, frame.p1().y));
    }
}

fn selected_line_segments(model: &CreasePatternModel) -> Vec<LineSegment> {
    model
        .line_segments
        .iter()
        .filter(|segment| segment.selected == 2)
        .cloned()
        .collect()
}

fn append_and_split(model: &mut CreasePatternModel, segments: Vec<LineSegment>) {
    let original_end = model.line_segments.len();
    model.line_segments.extend(segments);
    let added_end = model.line_segments.len();
    divide_line_segment_with_new_lines(model, original_end, added_end);
}

fn translate_segments(segments: &mut [LineSegment], delta: Point) {
    for segment in segments {
        *segment = translate_segment(segment, delta);
    }
}

fn translate_segment(segment: &LineSegment, delta: Point) -> LineSegment {
    segment.with_coordinates(segment.a.move_by(delta), segment.b.move_by(delta))
}

fn should_extend_to(origin: Point, direction: Point, point: Point, current_distance: f64) -> bool {
    if point.distance(origin) <= Epsilon::UNKNOWN_1EN5 {
        return false;
    }
    if point.distance(origin) >= current_distance {
        return false;
    }

    let angle = angle((origin, direction, origin, point));
    !(1.0..=359.0).contains(&angle)
}
