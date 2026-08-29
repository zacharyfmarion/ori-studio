//! Arrangement and cleanup helpers ported from Oriedita `FoldLineSet` workers.

use crate::geometry::{
    Epsilon, FoldMagnitude, Intersection, LineColor, LineSegment, Point, StraightLine,
    StraightLineIntersection, determine_line_segment_intersection,
    determine_line_segment_intersection_sweet,
    determine_line_segment_intersection_sweet_with_tolerances,
    determine_line_segment_intersection_with_precision,
    determine_line_segment_intersection_with_tolerances, find_intersection_segments,
    find_intersection_straight_lines, find_projection, is_line_segment_overlapping,
    line_segment_to_straight_line, line_segment_x_kousa_decide,
};
use crate::model::CreasePatternModel;
use std::collections::{BTreeSet, HashMap};

/// Oriedita sentinel used by `FoldLineSet.removeOverlappingLines()`.
const DEFAULT_PRECISION_SENTINEL: f64 = -9999.9;
const INTERSECT_DIVIDE_BOUNDS_EPSILON: f64 = 0.05;

/// Divide line segments at intersections and overlapping spans.
///
/// This ports the standalone `IntersectDivide` worker semantics. The upstream
/// implementation uses a quadtree to find possible collisions; this Rust port
/// preserves pair mutation behavior with a direct dynamic scan.
/// Fallible **only** to carry a cancel: the arrangement itself cannot fail.
///
/// Measured at ~870ms per call on a dense grid, and it runs twice per fold, so
/// leaving it uninterruptible would blow the latency bound on its own. A caller
/// with no cancel bound can `.expect()`-free ignore the error — `check` is inert
/// when nothing is bound, so `Err` is unreachable there.
pub fn divide_intersections(
    model: &mut CreasePatternModel,
) -> Result<(), crate::cancel::Cancelled> {
    let mut i = 0;
    while i < model.line_segments.len() {
        // Site 12. One iteration is a scan over every later segment.
        crate::cancel::check()?;
        let scan_len = model.line_segments.len();
        // Oriedita's QuadTree collision collector only yields candidates with
        // an index greater than `i`; overlap colors and inserted-line order
        // depend on preserving that traversal.
        for j in (i + 1)..scan_len {
            let _ = intersect_divide_pair(model, i, j);
        }
        i += 1;
    }
    Ok(())
}

/// Divide a single pair of line segments.
///
/// Returns the number of lines added, or `-1` when Oriedita would do nothing.
pub fn intersect_divide_pair(model: &mut CreasePatternModel, i: usize, j: usize) -> i32 {
    if i == j || i >= model.line_segments.len() || j >= model.line_segments.len() {
        return -1;
    }

    let si = model.line_segments[i].clone();
    let sj = model.line_segments[j].clone();

    if si.determine_ax().max(si.determine_bx()) + INTERSECT_DIVIDE_BOUNDS_EPSILON
        < sj.determine_ax().min(sj.determine_bx())
        || sj.determine_ax().max(sj.determine_bx()) + INTERSECT_DIVIDE_BOUNDS_EPSILON
            < si.determine_ax().min(si.determine_bx())
        || si.determine_ay().max(si.determine_by()) + INTERSECT_DIVIDE_BOUNDS_EPSILON
            < sj.determine_ay().min(sj.determine_by())
        || sj.determine_ay().max(sj.determine_by()) + INTERSECT_DIVIDE_BOUNDS_EPSILON
            < si.determine_ay().min(si.determine_by())
    {
        return -1;
    }

    let intersection = determine_line_segment_intersection_sweet(&si, &sj);
    let p1 = si.a;
    let p2 = si.b;
    let p3 = sj.a;
    let p4 = sj.b;

    match intersection {
        Intersection::Intersects1 => {
            let pk = find_intersection_segments(&si, &sj);
            set_segment(model, i, si.with_coordinates(p1, pk));
            set_segment(model, j, sj.with_coordinates(p3, pk));
            add_line(model, p2, pk, si.color);
            add_line(model, p4, pk, sj.color);
            2
        }
        Intersection::IntersectsTShapeS1VerticalBar25
        | Intersection::IntersectsTShapeS1VerticalBar26 => {
            let pk = find_intersection_segments(&si, &sj);
            set_segment(model, j, sj.with_coordinates(p3, pk));
            add_line(model, p4, pk, sj.color);
            1
        }
        Intersection::IntersectsTShapeS2VerticalBar27
        | Intersection::IntersectsTShapeS2VerticalBar28 => {
            let pk = find_intersection_segments(&si, &sj);
            set_segment(model, i, si.with_coordinates(p1, pk));
            add_line(model, p2, pk, si.color);
            1
        }
        Intersection::ParallelEqual31 => -1,
        Intersection::ParallelStartOfS1ContainsStartOfS2_321 => {
            set_segment(model, i, si.with_coordinates(p2, p4));
            set_color(model, j, overlapping_color(i, j, si.color, sj.color));
            0
        }
        Intersection::ParallelStartOfS2ContainsStartOfS1_322 => {
            set_segment(model, j, sj.with_coordinates(p2, p4));
            set_color(model, i, overlapping_color(i, j, si.color, sj.color));
            0
        }
        Intersection::ParallelStartOfS1ContainsEndOfS2_331 => {
            set_segment(model, i, si.with_coordinates(p2, p3));
            set_color(model, j, overlapping_color(i, j, si.color, sj.color));
            0
        }
        Intersection::ParallelEndOfS2ContainsStartOfS1_332 => {
            set_segment(model, j, sj.with_coordinates(p2, p3));
            set_color(model, i, overlapping_color(i, j, si.color, sj.color));
            0
        }
        Intersection::ParallelEndOfS1ContainsStartOfS2_341 => {
            set_segment(model, i, si.with_coordinates(p1, p4));
            set_color(model, j, overlapping_color(i, j, si.color, sj.color));
            0
        }
        Intersection::ParallelStartOfS2ContainsEndOfS1_342 => {
            set_segment(model, j, sj.with_coordinates(p1, p4));
            set_color(model, i, overlapping_color(i, j, si.color, sj.color));
            0
        }
        Intersection::ParallelEndOfS1ContainsEndOfS2_351 => {
            set_segment(model, i, si.with_coordinates(p1, p3));
            set_color(model, j, overlapping_color(i, j, si.color, sj.color));
            0
        }
        Intersection::ParallelEndOfS2ContainsEndOfS1_352 => {
            set_segment(model, j, sj.with_coordinates(p1, p3));
            set_color(model, i, overlapping_color(i, j, si.color, sj.color));
            0
        }
        Intersection::ParallelS1IncludesS2_361 => {
            set_segment(model, i, si.with_coordinates(p1, p3));
            add_line(model, p2, p4, si.color);
            set_color(model, j, overlapping_color(i, j, si.color, sj.color));
            1
        }
        Intersection::ParallelS1IncludesS2_362 => {
            set_segment(model, i, si.with_coordinates(p1, p4));
            add_line(model, p2, p3, si.color);
            set_color(model, j, overlapping_color(i, j, si.color, sj.color));
            1
        }
        Intersection::ParallelS2IncludesS1_363 => {
            set_segment(model, j, sj.with_coordinates(p1, p3));
            add_line(model, p2, p4, sj.color);
            set_color(model, i, overlapping_color(i, j, si.color, sj.color));
            1
        }
        Intersection::ParallelS2IncludesS1_364 => {
            set_segment(model, j, sj.with_coordinates(p1, p4));
            add_line(model, p2, p3, sj.color);
            set_color(model, i, overlapping_color(i, j, si.color, sj.color));
            1
        }
        Intersection::ParallelS1EndOverlapsS2Start371 => {
            set_segment(model, i, si.with_coordinates(p1, p3));
            set_segment(model, j, sj.with_coordinates(p2, p4));
            add_line(model, p2, p3, overlapping_color(i, j, si.color, sj.color));
            1
        }
        Intersection::ParallelS1EndOverlapsS2End372 => {
            set_segment(model, i, si.with_coordinates(p1, p4));
            set_segment(model, j, sj.with_coordinates(p3, p2));
            add_line(model, p2, p4, overlapping_color(i, j, si.color, sj.color));
            1
        }
        Intersection::ParallelS1StartOverlapsS2End373 => {
            set_segment(model, i, si.with_coordinates(p2, p4));
            set_segment(model, j, sj.with_coordinates(p1, p3));
            add_line(model, p1, p4, overlapping_color(i, j, si.color, sj.color));
            1
        }
        Intersection::ParallelS1StartOverlapsS2Start374 => {
            set_segment(model, i, si.with_coordinates(p3, p2));
            set_segment(model, j, sj.with_coordinates(p1, p4));
            add_line(model, p1, p3, overlapping_color(i, j, si.color, sj.color));
            1
        }
        _ => -1,
    }
}

/// Divide newly added lines against the existing crease-pattern lines.
///
/// `original_end` and `added_end` are counts in the same role as Oriedita's
/// one-based inclusive parameters: lines before `original_end` are existing
/// lines, lines in `original_end..added_end` are newly inserted lines.
pub fn divide_line_segment_with_new_lines(
    model: &mut CreasePatternModel,
    original_end: usize,
    added_end: usize,
) {
    let original_end = original_end.min(model.line_segments.len());
    let added_end = added_end.min(model.line_segments.len());
    let mut flags = vec![0u8; model.line_segments.len() + 101];

    for flag in flags.iter_mut().take(original_end) {
        *flag = 1;
    }
    for flag in flags.iter_mut().take(added_end).skip(original_end) {
        *flag = 2;
    }

    let mut to_delete = BTreeSet::new();
    let mut i = original_end;
    while i < model.line_segments.len() {
        if flag_at(&flags, i) == 2 {
            let scan_len = model.line_segments.len();
            for j in 0..scan_len {
                if flag_at(&flags, j) != 1 || i == j {
                    continue;
                }

                let result = divide_intersections_fast(model, i, j, &mut to_delete);
                ensure_flags_len(&mut flags, model.line_segments.len());
                let total = model.line_segments.len();

                match result {
                    Intersection::Intersects1 => {
                        flags[total - 2] = 2;
                        flags[total - 1] = 1;
                    }
                    Intersection::IntersectsAux2
                    | Intersection::IntersectTA211
                    | Intersection::IntersectTB221 => {
                        flags[total - 1] = 2;
                    }
                    Intersection::IntersectsAux3
                    | Intersection::IntersectTA121
                    | Intersection::IntersectTB122
                    | Intersection::ParallelS2IncludesS1_363
                    | Intersection::ParallelS2IncludesS1_364 => {
                        flags[total - 1] = 1;
                    }
                    Intersection::ParallelS1IncludesS2_361
                    | Intersection::ParallelS1IncludesS2_362 => {
                        flags[j] = 0;
                        flags[total - 1] = 2;
                    }
                    Intersection::ParallelS1EndOverlapsS2Start371
                    | Intersection::ParallelS1StartOverlapsS2End373
                    | Intersection::ParallelS1EndOverlapsS2End372
                    | Intersection::ParallelS1StartOverlapsS2Start374 => {
                        flags[total - 1] = 0;
                    }
                    _ => {}
                }
            }
        }

        i += 1;
    }

    for index in to_delete.into_iter().rev() {
        if index < model.line_segments.len() {
            model.line_segments.remove(index);
        }
    }
}

/// Oriedita `CreasePattern_Worker.addLineSegment` line-only insertion path.
///
/// # The active crease angle is stamped here
///
/// This is the one insertion path for a *drawn* crease — every draw site in
/// `construction`, `generators`, `point`, `transform` and `native::square`
/// funnels through it — which makes it the only place a per-draw pen can be
/// applied once instead of at forty call sites.
///
/// It is also the only place where doing so is *correct*, and that is down to
/// the ordering below. The segment is appended **before**
/// [`divide_line_segment_with_new_lines`] splits it against everything it
/// crosses, and a split copies the whole struct through
/// `LineSegment::with_coordinates`. So the drawn line's pieces inherit the pen,
/// while an existing crease it crosses is split into pieces that keep *their*
/// magnitude. Stamping after the division — or reconstructing "what is new"
/// from a before/after diff — would retag the halves of a crossed classic
/// crease, since those are new segments by any geometric identity.
///
/// A segment that arrives carrying its own magnitude keeps it: a caller that
/// has already decided (an inherited angle, a solver's answer) outranks the pen.
/// `with_fold_magnitude` is separately a no-op on borders and auxiliary lines,
/// so no angle can be smuggled onto a line that cannot carry one.
pub fn add_line_segment_like_worker(model: &mut CreasePatternModel, segment: &LineSegment) {
    let original_end = model.line_segments.len();
    let drawn = match model.pen_fold_magnitude {
        Some(pen) if segment.fold_magnitude.is_none() => segment.with_fold_magnitude(Some(pen)),
        _ => segment.clone(),
    };
    model.add_line_segment(drawn);
    divide_line_segment_with_new_lines(model, original_end, original_end + 1);
}

/// Oriedita `CreasePattern_Worker.setSave_for_reading_tuika` import (add).
///
/// Merges an imported crease pattern into `model` without disturbing existing
/// geometry. The imported folding line segments and circles are shifted so the
/// import sits to the right of the current pattern (a 100-unit gap between the
/// current max-X and the import's min-X, with the two patterns' top edges
/// aligned), appended, then divided against the existing lines exactly as
/// Oriedita does. Auxiliary lines, loose points, and text are intentionally
/// dropped, matching `FoldLineSet.setSave`, which only carries folding line
/// segments and circles.
pub fn import_add(model: &mut CreasePatternModel, imported: &CreasePatternModel) {
    let mut added_lines = imported.line_segments.clone();
    let mut added_circles = imported.circles.clone();

    // Oriedita: addx = foldLineSet.getMaxX() + 100 - tempFoldLineSet.getMinX();
    //           addy = foldLineSet.getMaxY() - tempFoldLineSet.getMaxY();
    let add_x =
        line_segments_max_x(&model.line_segments) + 100.0 - line_segments_min_x(&added_lines);
    let add_y = line_segments_max_y(&model.line_segments) - line_segments_max_y(&added_lines);
    let delta = Point::new(add_x, add_y);

    for segment in &mut added_lines {
        *segment = segment.with_coordinates(segment.a.move_by(delta), segment.b.move_by(delta));
    }
    for circle in &mut added_circles {
        circle.x += add_x;
        circle.y += add_y;
    }

    let total_old = model.line_segments.len();
    model.line_segments.extend(added_lines);
    model.circles.extend(added_circles);
    let total_new = model.line_segments.len();

    divide_line_segment_with_new_lines(model, total_old, total_new);
    unselect_all(model);
}

/// Oriedita `FoldLineSet.getMaxX`: max X over every line-segment endpoint
/// (`0.0` when there are no line segments).
fn line_segments_max_x(segments: &[LineSegment]) -> f64 {
    if segments.is_empty() {
        return 0.0;
    }
    segments
        .iter()
        .flat_map(|segment| [segment.a.x, segment.b.x])
        .fold(f64::NEG_INFINITY, f64::max)
}

/// Oriedita `FoldLineSet.getMinX`: min X over every line-segment endpoint
/// (`0.0` when there are no line segments).
fn line_segments_min_x(segments: &[LineSegment]) -> f64 {
    if segments.is_empty() {
        return 0.0;
    }
    segments
        .iter()
        .flat_map(|segment| [segment.a.x, segment.b.x])
        .fold(f64::INFINITY, f64::min)
}

/// Oriedita `FoldLineSet.getMaxY`: max Y over every line-segment endpoint
/// (`0.0` when there are no line segments).
fn line_segments_max_y(segments: &[LineSegment]) -> f64 {
    if segments.is_empty() {
        return 0.0;
    }
    segments
        .iter()
        .flat_map(|segment| [segment.a.y, segment.b.y])
        .fold(f64::NEG_INFINITY, f64::max)
}

/// Oriedita `FoldLineSet.divideIntersectionsFast` for one new/existing pair.
pub fn divide_intersections_fast(
    model: &mut CreasePatternModel,
    i: usize,
    j: usize,
    indices_to_delete: &mut BTreeSet<usize>,
) -> Intersection {
    if i == j || i >= model.line_segments.len() || j >= model.line_segments.len() {
        return Intersection::NoIntersection0;
    }

    let si = model.line_segments[i].clone();
    let sj = model.line_segments[j].clone();

    if si.determine_max_x() < sj.determine_min_x()
        || sj.determine_max_x() < si.determine_min_x()
        || si.determine_max_y() < sj.determine_min_y()
        || sj.determine_max_y() < si.determine_min_y()
    {
        return Intersection::NoIntersection0;
    }

    let straight_line0 = StraightLine::from_points(si.a, si.b);
    let intersect_flag0 = straight_line0.line_segment_intersect_reverse_detail(&sj);
    if intersect_flag0 == StraightLineIntersection::None0 {
        return Intersection::NoIntersection0;
    }

    let straight_line1 = StraightLine::from_points(sj.a, sj.b);
    let intersect_flag1 = straight_line1.line_segment_intersect_reverse_detail(&si);
    if intersect_flag1 == StraightLineIntersection::None0 {
        return Intersection::NoIntersection0;
    }

    if intersect_flag0 == StraightLineIntersection::IntersectX1
        && intersect_flag1 == StraightLineIntersection::IntersectX1
    {
        let intersection_point = find_intersection_straight_lines(straight_line0, straight_line1);
        if same_aux_class(si.color, sj.color) {
            add_line_like(model, intersection_point, si.b, &si);
            set_segment(model, i, si.with_b(intersection_point));
            add_line_like(model, intersection_point, sj.b, &sj);
            set_segment(model, j, sj.with_b(intersection_point));
            return Intersection::Intersects1;
        }
        if si.color == LineColor::Cyan3 && sj.color != LineColor::Cyan3 {
            add_line_like(model, intersection_point, si.b, &si);
            set_segment(model, i, si.with_b(intersection_point));
            return Intersection::IntersectsAux2;
        }
        if si.color != LineColor::Cyan3 && sj.color == LineColor::Cyan3 {
            add_line_like(model, intersection_point, sj.b, &sj);
            set_segment(model, j, sj.with_b(intersection_point));
            return Intersection::IntersectsAux3;
        }
    }

    if intersect_flag0 == StraightLineIntersection::IntersectX1
        && intersect_flag1 == StraightLineIntersection::IntersectTA21
    {
        let intersection_point = find_projection(line_segment_to_straight_line(&sj), si.a);
        if same_aux_class(si.color, sj.color)
            || (si.color != LineColor::Cyan3 && sj.color == LineColor::Cyan3)
        {
            add_line_like(model, intersection_point, sj.b, &sj);
            set_segment(model, j, sj.with_b(intersection_point));
            return Intersection::IntersectTA121;
        }
        return Intersection::NoIntersection0;
    }

    if intersect_flag0 == StraightLineIntersection::IntersectX1
        && intersect_flag1 == StraightLineIntersection::IntersectTB22
    {
        let intersection_point = find_projection(line_segment_to_straight_line(&sj), si.b);
        if same_aux_class(si.color, sj.color)
            || (si.color != LineColor::Cyan3 && sj.color == LineColor::Cyan3)
        {
            add_line_like(model, intersection_point, sj.b, &sj);
            set_segment(model, j, sj.with_b(intersection_point));
            return Intersection::IntersectTB122;
        }
        return Intersection::NoIntersection0;
    }

    if intersect_flag0 == StraightLineIntersection::IntersectTA21
        && intersect_flag1 == StraightLineIntersection::IntersectX1
    {
        let intersection_point = find_projection(line_segment_to_straight_line(&si), sj.a);
        if same_aux_class(si.color, sj.color)
            || (si.color == LineColor::Cyan3 && sj.color != LineColor::Cyan3)
        {
            add_line_like(model, intersection_point, si.b, &si);
            set_segment(model, i, si.with_b(intersection_point));
            return Intersection::IntersectTA211;
        }
        return Intersection::NoIntersection0;
    }

    if intersect_flag0 == StraightLineIntersection::IntersectTB22
        && intersect_flag1 == StraightLineIntersection::IntersectX1
    {
        let intersection_point = find_projection(line_segment_to_straight_line(&si), sj.b);
        if same_aux_class(si.color, sj.color)
            || (si.color == LineColor::Cyan3 && sj.color != LineColor::Cyan3)
        {
            add_line_like(model, intersection_point, si.b, &si);
            set_segment(model, i, si.with_b(intersection_point));
            return Intersection::IntersectTB221;
        }
        return Intersection::NoIntersection0;
    }

    if intersect_flag0 == StraightLineIntersection::Included3 {
        let p1 = si.a;
        let p2 = si.b;
        let p3 = sj.a;
        let p4 = sj.b;
        let intersection =
            determine_line_segment_intersection_with_precision(&si, &sj, Epsilon::UNKNOWN_1EN6);

        match intersection {
            Intersection::ParallelEqual31 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                indices_to_delete.insert(j);
                return Intersection::ParallelEqual31;
            }
            Intersection::ParallelStartOfS1ContainsStartOfS2_321 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                set_color(model, j, si.color);
                set_segment(model, i, si.with_a(sj.b));
                return intersection;
            }
            Intersection::ParallelStartOfS2ContainsStartOfS1_322 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                set_segment(model, j, sj.with_a(si.b));
                return intersection;
            }
            Intersection::ParallelStartOfS1ContainsEndOfS2_331 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                set_color(model, j, si.color);
                set_segment(model, i, si.with_a(sj.a));
                return intersection;
            }
            Intersection::ParallelEndOfS2ContainsStartOfS1_332 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                set_segment(model, j, sj.with_b(si.b));
                return intersection;
            }
            Intersection::ParallelEndOfS1ContainsStartOfS2_341 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                set_color(model, j, si.color);
                set_segment(model, i, si.with_b(sj.b));
                return intersection;
            }
            Intersection::ParallelStartOfS2ContainsEndOfS1_342 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                set_segment(model, j, sj.with_a(si.a));
                return intersection;
            }
            Intersection::ParallelEndOfS1ContainsEndOfS2_351 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                set_color(model, j, si.color);
                set_segment(model, i, si.with_b(sj.a));
                return intersection;
            }
            Intersection::ParallelEndOfS2ContainsEndOfS1_352 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                set_segment(model, j, sj.with_b(si.a));
                return intersection;
            }
            Intersection::ParallelS1IncludesS2_361 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                set_color(model, j, si.color);
                add_line_like(model, sj.b, si.b, &si);
                set_segment(model, i, si.with_b(sj.a));
                return intersection;
            }
            Intersection::ParallelS1IncludesS2_362 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                set_color(model, j, si.color);
                add_line_like(model, sj.a, si.b, &si);
                set_segment(model, i, si.with_b(sj.b));
                return intersection;
            }
            Intersection::ParallelS2IncludesS1_363 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                add_line_like(model, si.b, sj.b, &sj);
                set_segment(model, j, sj.with_b(si.a));
                return intersection;
            }
            Intersection::ParallelS2IncludesS1_364 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                add_line_like(model, si.a, sj.b, &sj);
                set_segment(model, j, sj.with_b(si.b));
                return intersection;
            }
            Intersection::ParallelS1EndOverlapsS2Start371 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                add_line_like(model, p3, p2, &si);
                set_segment(model, i, si.with_b(p3));
                set_segment(model, j, sj.with_a(p2));
                return intersection;
            }
            Intersection::ParallelS1EndOverlapsS2End372 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                add_line_like(model, p4, p2, &si);
                set_segment(model, i, si.with_b(p4));
                set_segment(model, j, sj.with_b(p2));
                return intersection;
            }
            Intersection::ParallelS1StartOverlapsS2End373 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                add_line_like(model, p1, p4, &si);
                set_segment(model, i, si.with_a(p4));
                set_segment(model, j, sj.with_b(p1));
                return intersection;
            }
            Intersection::ParallelS1StartOverlapsS2Start374 => {
                if has_cyan_mismatch(si.color, sj.color) {
                    return Intersection::NoIntersection0;
                }
                add_line_like(model, p1, p3, &si);
                set_segment(model, i, si.with_a(p3));
                set_segment(model, j, sj.with_a(p1));
                return intersection;
            }
            _ => {}
        }
    }

    Intersection::NoIntersection0
}

/// Delete lines that overlap the supplied drag/selection segment.
pub fn delete_overlapping_lines_along(
    model: &mut CreasePatternModel,
    selection: &LineSegment,
) -> bool {
    delete_inside_line(model, selection, false)
}

/// Delete lines that overlap or X-intersect the supplied selection segment.
pub fn delete_intersecting_or_overlapping_lines_along(
    model: &mut CreasePatternModel,
    selection: &LineSegment,
) -> bool {
    delete_inside_line(model, selection, true)
}

/// Remove dangling branch lines and merge straight same-color vertices.
pub fn branch_trim(model: &mut CreasePatternModel) {
    let radius = Epsilon::UNKNOWN_1EN6;
    let mut i_one_based = 1;

    while i_one_based <= model.line_segments.len() {
        let index = i_one_based - 1;
        let segment = model.line_segments[index].clone();
        let mut has_a_connection = false;
        let mut has_b_connection = false;

        for (other_index, other) in model.line_segments.iter().enumerate() {
            if index == other_index {
                continue;
            }

            if segment.a.distance(other.a) < radius || segment.a.distance(other.b) < radius {
                has_a_connection = true;
            }
            if segment.b.distance(other.a) < radius || segment.b.distance(other.b) < radius {
                has_b_connection = true;
            }
        }

        if !has_a_connection || !has_b_connection {
            delete_line_segment_vertex(model, index);
            i_one_based = 2;
        } else {
            i_one_based += 1;
        }
    }
}

/// Delete a line and apply Oriedita's same-color straight vertex cleanup.
pub fn delete_line_segment_vertex(model: &mut CreasePatternModel, index: usize) {
    if index >= model.line_segments.len() {
        return;
    }

    let segment = model.line_segments[index].clone();
    model.line_segments.remove(index);

    let _ = del_v_at_point(
        model,
        segment.a,
        Epsilon::UNKNOWN_1EN6,
        Epsilon::UNKNOWN_1EN6,
    );
    let _ = del_v_at_point(
        model,
        segment.b,
        Epsilon::UNKNOWN_1EN6,
        Epsilon::UNKNOWN_1EN6,
    );
}

/// Oriedita line-delete click mutation after the target line has been resolved.
pub fn delete_line_segment_vertex_for_index(model: &mut CreasePatternModel, index: usize) -> bool {
    let Some(segment) = model.line_segments.get(index).cloned() else {
        return false;
    };
    let Some(delete_index) = model
        .line_segments
        .iter()
        .position(|candidate| candidate == &segment)
    else {
        return false;
    };

    delete_line_segment_vertex(model, delete_index);
    true
}

/// Oriedita box line-delete mutation after the target lines have been resolved.
pub fn delete_line_segments_for_indices(
    model: &mut CreasePatternModel,
    indices: &[usize],
) -> usize {
    let lines: Vec<_> = indices
        .iter()
        .filter_map(|index| model.line_segments.get(*index).cloned())
        .collect();
    let mut deleted = 0;
    for line in lines {
        let Some(index) = model
            .line_segments
            .iter()
            .position(|candidate| candidate == &line)
        else {
            continue;
        };
        model.line_segments.remove(index);
        deleted += 1;
    }
    deleted
}

/// Oriedita `FoldLineSet.del_V(Point, hikiyose, r)`.
///
/// The Java method returns `false` even after a successful merge; this function
/// preserves that observable return value.
pub fn del_v_at_point(
    model: &mut CreasePatternModel,
    point: Point,
    snap_radius: f64,
    vertex_radius: f64,
) -> bool {
    del_v_at_point_impl(model, point, snap_radius, vertex_radius, false)
}

/// Oriedita `FoldLineSet.del_V_cc(Point, hikiyose, r)`.
///
/// This keeps the Java quirk where the merged line receives the first line's
/// original color, even for mixed mountain/valley/edge pairs.
pub fn del_v_at_point_color_change(
    model: &mut CreasePatternModel,
    point: Point,
    snap_radius: f64,
    vertex_radius: f64,
) -> bool {
    del_v_at_point_impl(model, point, snap_radius, vertex_radius, true)
}

/// Oriedita `FoldLineSet.del_V_all()`.
pub fn del_v_all(model: &mut CreasePatternModel) {
    del_v_all_impl(model, false);
}

/// Oriedita `FoldLineSet.del_V_all_cc()`.
pub fn del_v_all_color_change(model: &mut CreasePatternModel) {
    del_v_all_impl(model, true);
}

/// Oriedita `FoldLineSet.del_V(LineSegment, LineSegment)`.
pub fn del_v_pair(
    model: &mut CreasePatternModel,
    first: &LineSegment,
    second: &LineSegment,
) -> Option<LineSegment> {
    let intersection =
        determine_line_segment_intersection_with_precision(first, second, Epsilon::UNKNOWN_1EN5);
    let (a, b) = del_v_merge_endpoints(first, second, intersection)?;
    let color = del_v_pair_color(first.color, second.color)?;
    let fold_magnitude = del_v_merged_fold_magnitude(first, second, color)?;

    remove_line_by_value(model, first)?;
    remove_line_by_value(model, second)?;

    let new_line = LineSegment {
        fold_magnitude,
        ..LineSegment::with_color(a, b, color)
    };
    model.add_line_segment(new_line.clone());
    Some(new_line)
}

/// Oriedita `Fix1.apply`: mark/fix inaccurate overlapping line pairs.
pub fn fix1(model: &mut CreasePatternModel) -> bool {
    unselect_all(model);

    let len = model.line_segments.len();
    for i in 0..len.saturating_sub(1) {
        let si = model.line_segments[i].clone();
        if si.color == LineColor::Cyan3 {
            continue;
        }

        for j in (i + 1)..len {
            if j >= model.line_segments.len() {
                break;
            }
            let sj = model.line_segments[j].clone();
            if sj.color == LineColor::Cyan3 {
                continue;
            }

            let intersection = determine_line_segment_intersection_with_tolerances(
                &si,
                &sj,
                Epsilon::UNKNOWN_0001,
                Epsilon::PARALLEL_FOR_FIX,
            );
            match intersection {
                Intersection::ParallelEqual31 => {
                    set_color(model, i, sj.color);
                    model.line_segments.remove(j);
                    return true;
                }
                Intersection::ParallelStartOfS1ContainsStartOfS2_321
                | Intersection::ParallelStartOfS2ContainsStartOfS1_322
                | Intersection::ParallelStartOfS1ContainsEndOfS2_331
                | Intersection::ParallelEndOfS2ContainsStartOfS1_332
                | Intersection::ParallelEndOfS1ContainsStartOfS2_341
                | Intersection::ParallelStartOfS2ContainsEndOfS1_342
                | Intersection::ParallelEndOfS1ContainsEndOfS2_351
                | Intersection::ParallelEndOfS2ContainsEndOfS1_352 => {
                    select_pair(model, i, j);
                }
                _ => {}
            }

            if intersection.is_contained_inside() {
                select_pair(model, i, j);
            }
        }
    }

    false
}

/// Oriedita `Fix2.apply`: split near-T intersections using sweet tolerances.
pub fn fix2(model: &mut CreasePatternModel) {
    unselect_all(model);

    let mut i = 0;
    while i + 1 < model.line_segments.len() {
        let si = model.line_segments[i].clone();
        if si.color != LineColor::Cyan3 {
            let scan_len = model.line_segments.len();
            for j in (i + 1)..scan_len {
                if j >= model.line_segments.len() {
                    break;
                }
                let current_si = model.line_segments[i].clone();
                let sj = model.line_segments[j].clone();
                if sj.color == LineColor::Cyan3 {
                    continue;
                }

                let intersection = determine_line_segment_intersection_sweet_with_tolerances(
                    &current_si,
                    &sj,
                    Epsilon::UNKNOWN_0001,
                    Epsilon::PARALLEL_FOR_FIX,
                );
                match intersection {
                    Intersection::IntersectsTShapeS1VerticalBar25 => {
                        apply_line_segment_divide_for_fix2(model, current_si.a, j);
                    }
                    Intersection::IntersectsTShapeS1VerticalBar26 => {
                        apply_line_segment_divide_for_fix2(model, current_si.b, j);
                    }
                    Intersection::IntersectsTShapeS2VerticalBar27 => {
                        apply_line_segment_divide_for_fix2(model, sj.a, i);
                    }
                    Intersection::IntersectsTShapeS2VerticalBar28 => {
                        apply_line_segment_divide_for_fix2(model, sj.b, i);
                    }
                    _ => {}
                }
            }
        }
        i += 1;
    }
}

fn del_v_at_point_impl(
    model: &mut CreasePatternModel,
    point: Point,
    snap_radius: f64,
    vertex_radius: f64,
    allow_color_change: bool,
) -> bool {
    let q = closest_endpoint(model, point);
    if q.distance_squared(point) > snap_radius * snap_radius {
        return false;
    }

    let adjacent = vertex_surrounding_line_indices(model, q, vertex_radius);
    if adjacent.len() != 2 {
        return false;
    }

    let ix = adjacent[0];
    let iy = adjacent[1];
    let lix = model.line_segments[ix].clone();
    let liy = model.line_segments[iy].clone();
    let intersection =
        determine_line_segment_intersection_with_precision(&lix, &liy, Epsilon::UNKNOWN_1EN6);

    let Some((a, b)) = del_v_merge_endpoints(&lix, &liy, intersection) else {
        return false;
    };

    if allow_color_change {
        if !del_v_cc_allows_colors(lix.color, liy.color) {
            return false;
        }
    } else if lix.color != liy.color {
        return false;
    }

    // Same rule as the whole-document sweep: merging two creases at different
    // fold angles would have to invent one, so the vertex stays instead. Kept
    // in step deliberately — this is the sweep applied to a single vertex, and
    // the two disagreeing would be a defect, not a distinction.
    let Some(fold_magnitude) = del_v_merged_fold_magnitude(&lix, &liy, lix.color) else {
        return false;
    };

    let (first_delete, second_delete) = if ix > iy { (ix, iy) } else { (iy, ix) };
    model.line_segments.remove(first_delete);
    model.line_segments.remove(second_delete);
    model.add_line_segment(LineSegment {
        fold_magnitude,
        ..LineSegment::with_color(a, b, lix.color)
    });

    false
}

fn unselect_all(model: &mut CreasePatternModel) {
    for segment in &mut model.line_segments {
        *segment = segment.with_selected(0);
    }
}

fn select_pair(model: &mut CreasePatternModel, i: usize, j: usize) {
    model.line_segments[i] = model.line_segments[i].with_selected(2);
    model.line_segments[j] = model.line_segments[j].with_selected(2);
}

fn apply_line_segment_divide_for_fix2(model: &mut CreasePatternModel, point: Point, index: usize) {
    if index >= model.line_segments.len() {
        return;
    }

    let segment = model.line_segments[index].clone();
    let projection = find_projection(line_segment_to_straight_line(&segment), point);
    model.line_segments.remove(index);
    model.add_line_segment(segment.with_b(projection));
    model.add_line_segment(LineSegment::with_color(
        projection,
        segment.b,
        segment.color,
    ));
}

/// Oriedita `FoldLineSet.del_V_all` / `del_V_all_cc`.
///
/// Walks each vertex in `PointLineMap` insertion order and, where exactly two
/// non-auxiliary creases meet, merges them if they are collinear (and, for the
/// same-colour variant, the same colour).
///
/// Tracked by segment index rather than by segment value. The value-based
/// version this replaces re-scanned every segment to delete a merged pair and
/// re-scanned every vertex group to redirect the references, so a document
/// where most vertices are degree two — exactly the input this sweep exists
/// for — cost O(vertices x segments). Deletion is deferred to a single retain
/// at the end, which preserves the surviving order and the append order of
/// merged segments, so the resulting `line_segments` is identical to removing
/// eagerly.
///
/// One consequence of indices worth stating: two segments that are exactly
/// equal by value are now distinguishable, where the old code could delete or
/// redirect whichever matched first. Documents carrying exact duplicates are
/// `Fix1`'s business, and upstream is equally ill-defined there.
fn del_v_all_impl(model: &mut CreasePatternModel, allow_color_change: bool) {
    let VertexIndex {
        mut groups,
        exact_vertex,
    } = vertex_index(model);
    let mut alive = vec![true; model.line_segments.len()];

    for group_index in 0..groups.len() {
        let [i, j] = match groups[group_index][..] {
            [i, j] => [i, j],
            _ => continue,
        };
        // Upstream reads both segments straight out of the map and lets
        // `deleteLine` fail if one is already gone. A dead index is that case.
        if !alive[i] || !alive[j] {
            continue;
        }

        let first = model.line_segments[i].clone();
        let second = model.line_segments[j].clone();
        if !allow_color_change && (first.color != second.color || first.color == LineColor::Cyan3) {
            continue;
        }

        let intersection = determine_line_segment_intersection_with_precision(
            &first,
            &second,
            Epsilon::UNKNOWN_1EN5,
        );
        let Some((a, b)) = del_v_merge_endpoints(&first, &second, intersection) else {
            continue;
        };
        let Some(color) = del_v_pair_color(first.color, second.color) else {
            continue;
        };
        let Some(fold_magnitude) = del_v_merged_fold_magnitude(&first, &second, color) else {
            continue;
        };

        alive[i] = false;
        alive[j] = false;
        let merged = model.line_segments.len();
        model.add_line_segment(LineSegment {
            fold_magnitude,
            ..LineSegment::with_color(a, b, color)
        });
        alive.push(true);

        replace_line_in_vertex_groups(&mut groups, &exact_vertex, &first, i, merged);
        replace_line_in_vertex_groups(&mut groups, &exact_vertex, &second, j, merged);
    }

    let mut keep = alive.iter().copied();
    model.line_segments.retain(|_| keep.next().unwrap_or(true));
}

/// Port of `PointLineMap.replaceLine`, including the two details that decide
/// what a chain of three or more collinear segments collapses to.
///
/// It removes and re-appends rather than overwriting in place, so the merged
/// segment lands at the *end* of each vertex list. That reorders the pair the
/// next vertex sees, and the pair order decides which way round the merged
/// endpoints come out — an in-place overwrite produced a segment with its two
/// endpoints swapped relative to Oriedita, which no single-pair fixture could
/// have caught.
///
/// It also looks the vertex up by exact coordinates, where the map's own
/// bucketing merges endpoints within 1e-4. An endpoint that got folded into a
/// nearby vertex therefore finds no bucket and is silently skipped. Faithful to
/// upstream, and the reason this takes an exact-coordinate map rather than the
/// membership recorded while indexing.
fn replace_line_in_vertex_groups(
    groups: &mut [Vec<usize>],
    exact_vertex: &HashMap<(u64, u64), usize>,
    old_segment: &LineSegment,
    old_index: usize,
    new_index: usize,
) {
    for endpoint in [old_segment.a, old_segment.b] {
        let Some(&group) = exact_vertex.get(&point_key(endpoint)) else {
            continue;
        };
        if let Some(position) = groups[group].iter().position(|&entry| entry == old_index) {
            groups[group].remove(position);
            groups[group].push(new_index);
        }
    }
}

/// Segment indices grouped by shared endpoint.
struct VertexIndex {
    /// Vertex groups in `PointLineMap` insertion order.
    groups: Vec<Vec<usize>>,
    /// Exact vertex coordinates to group, mirroring the `HashMap<Point, ...>`
    /// lookup in `PointLineMap.replaceLine`. Only the canonical (first-seen)
    /// coordinates are keys, which is what makes the eps-folded lookup miss.
    exact_vertex: HashMap<(u64, u64), usize>,
}

/// Port of Oriedita `PointLineMap`, including its skip of auxiliary (cyan)
/// creases: an aux line ending at a vertex does not raise that vertex's degree,
/// so two collinear creases still merge there and the aux endpoint is left
/// dangling mid-crease.
///
/// Endpoints within `UNKNOWN_1EN4` share a vertex. Candidates come from the
/// eps-sized cell neighbourhood rather than a scan of every vertex seen so far;
/// taking the lowest-index match reproduces the scan's first-match exactly.
fn vertex_index(model: &CreasePatternModel) -> VertexIndex {
    let eps = Epsilon::UNKNOWN_1EN4;
    let eps_squared = eps * eps;
    let mut points: Vec<Point> = Vec::new();
    let mut groups: Vec<Vec<usize>> = Vec::new();
    let mut exact_vertex: HashMap<(u64, u64), usize> = HashMap::new();
    let mut cells: HashMap<(i64, i64), Vec<usize>> = HashMap::new();

    for (index, segment) in model.line_segments.iter().enumerate() {
        if segment.color == LineColor::Cyan3 {
            continue;
        }
        for endpoint in [segment.a, segment.b] {
            let group = vertex_group_for(
                endpoint,
                eps,
                eps_squared,
                &mut points,
                &mut groups,
                &mut exact_vertex,
                &mut cells,
            );
            groups[group].push(index);
        }
    }

    VertexIndex {
        groups,
        exact_vertex,
    }
}

fn vertex_group_for(
    point: Point,
    eps: f64,
    eps_squared: f64,
    points: &mut Vec<Point>,
    groups: &mut Vec<Vec<usize>>,
    exact_vertex: &mut HashMap<(u64, u64), usize>,
    cells: &mut HashMap<(i64, i64), Vec<usize>>,
) -> usize {
    let cx = (point.x / eps).floor() as i64;
    let cy = (point.y / eps).floor() as i64;
    let mut best: Option<usize> = None;
    for dx in -1..=1 {
        for dy in -1..=1 {
            if let Some(indices) = cells.get(&(cx + dx, cy + dy)) {
                for &index in indices {
                    if points[index].distance_squared(point) < eps_squared {
                        best = Some(best.map_or(index, |b| b.min(index)));
                    }
                }
            }
        }
    }

    best.unwrap_or_else(|| {
        let index = points.len();
        points.push(point);
        groups.push(Vec::new());
        exact_vertex.insert(point_key(point), index);
        cells.entry((cx, cy)).or_default().push(index);
        index
    })
}

/// Exact-coordinate key. Java `Point` hashes and compares with
/// `Double.compare`, which keeps `-0.0` and `0.0` distinct; raw bits do the
/// same, so the two maps bucket identically.
fn point_key(point: Point) -> (u64, u64) {
    (point.x.to_bits(), point.y.to_bits())
}

fn remove_line_by_value(model: &mut CreasePatternModel, line: &LineSegment) -> Option<LineSegment> {
    let index = model
        .line_segments
        .iter()
        .position(|candidate| candidate == line)?;
    Some(model.line_segments.remove(index))
}

/// Fold angle for a merged crease. Outer `None` refuses the merge.
///
/// Ori Studio's addition to a ported operation: Oriedita has no fold angles, so
/// upstream is silent here rather than opposed. Two collinear creases at the
/// same magnitude are one crease and merging is lossless. At different
/// magnitudes they are genuinely two creases, and every way of picking a single
/// answer invents geometry the user did not draw — so the vertex stays.
///
/// `None` is the canonical spelling of a classic +/-180 crease, so a document
/// that has never carried a fold angle — every Oriedita import, and everything
/// the parity oracle sees — takes the both-`None` branch and behaves exactly as
/// it did before fold angles existed.
fn del_v_merged_fold_magnitude(
    first: &LineSegment,
    second: &LineSegment,
    merged_color: LineColor,
) -> Option<Option<FoldMagnitude>> {
    // A magnitude is meaningful only on a fold line. A mountain merged with a
    // valley resolves to an edge by the colour matrix above, and an edge has no
    // angle to carry — dropping it is the invariant, not a loss.
    if !matches!(merged_color, LineColor::Red1 | LineColor::Blue2) {
        return Some(None);
    }
    if first.fold_magnitude == second.fold_magnitude {
        return Some(first.fold_magnitude);
    }
    None
}

fn del_v_pair_color(first: LineColor, second: LineColor) -> Option<LineColor> {
    match (first, second) {
        (LineColor::Black0, LineColor::Black0 | LineColor::Red1 | LineColor::Blue2) => Some(second),
        (LineColor::Red1, LineColor::Black0 | LineColor::Red1) => Some(LineColor::Red1),
        (LineColor::Red1, LineColor::Blue2) => Some(LineColor::Black0),
        (LineColor::Blue2, LineColor::Black0 | LineColor::Blue2) => Some(LineColor::Blue2),
        (LineColor::Blue2, LineColor::Red1) => Some(LineColor::Black0),
        (LineColor::Cyan3, LineColor::Cyan3) => Some(LineColor::Cyan3),
        _ => None,
    }
}

fn delete_inside_line(
    model: &mut CreasePatternModel,
    selection: &LineSegment,
    include_crossing: bool,
) -> bool {
    let original_len = model.line_segments.len();
    model.line_segments.retain(|segment| {
        let should_delete = is_line_segment_overlapping(segment, selection)
            || (include_crossing && line_segment_x_kousa_decide(segment, selection));
        !should_delete
    });
    model.line_segments.len() != original_len
}

fn closest_endpoint(model: &CreasePatternModel, point: Point) -> Point {
    let mut closest = Point::new(100000.0, 100000.0);
    for segment in &model.line_segments {
        if point.distance_squared(segment.a) < point.distance_squared(closest) {
            closest = segment.a;
        }
        if point.distance_squared(segment.b) < point.distance_squared(closest) {
            closest = segment.b;
        }
    }
    closest
}

fn vertex_surrounding_line_indices(
    model: &CreasePatternModel,
    point: Point,
    radius: f64,
) -> Vec<usize> {
    let q = closest_endpoint(model, point);
    let mut indices = Vec::new();
    for (index, segment) in model.line_segments.iter().enumerate() {
        let closest = if q.distance_squared(segment.b) < q.distance_squared(segment.a) {
            segment.b
        } else {
            segment.a
        };
        if q.distance_squared(closest) < radius * radius {
            indices.push(index);
        }
    }
    indices
}

fn del_v_merge_endpoints(
    first: &LineSegment,
    second: &LineSegment,
    intersection: Intersection,
) -> Option<(Point, Point)> {
    match intersection {
        Intersection::ParallelStartOfS1IntersectsStartOfS2_323 => Some((first.b, second.b)),
        Intersection::ParallelStartOfS1IntersectsEndOfS2_333 => Some((first.b, second.a)),
        Intersection::ParallelEndOfS1IntersectsStartOfS2_343 => Some((first.a, second.b)),
        Intersection::ParallelEndOfS1IntersectsEndOfS2_353 => Some((first.a, second.a)),
        _ => None,
    }
}

fn del_v_cc_allows_colors(first: LineColor, second: LineColor) -> bool {
    !((first == LineColor::Cyan3 && second != LineColor::Cyan3)
        || (first != LineColor::Cyan3 && second == LineColor::Cyan3))
}

fn flag_at(flags: &[u8], index: usize) -> u8 {
    flags.get(index).copied().unwrap_or_default()
}

fn ensure_flags_len(flags: &mut Vec<u8>, len: usize) {
    if flags.len() < len + 101 {
        flags.resize(len + 101, 0);
    }
}

fn same_aux_class(first: LineColor, second: LineColor) -> bool {
    (first == LineColor::Cyan3 && second == LineColor::Cyan3)
        || (first != LineColor::Cyan3 && second != LineColor::Cyan3)
}

fn has_cyan_mismatch(first: LineColor, second: LineColor) -> bool {
    (first == LineColor::Cyan3 && second != LineColor::Cyan3)
        || (first != LineColor::Cyan3 && second == LineColor::Cyan3)
}

fn set_segment(model: &mut CreasePatternModel, index: usize, segment: LineSegment) {
    model.line_segments[index] = segment;
}

fn set_color(model: &mut CreasePatternModel, index: usize, color: LineColor) {
    model.line_segments[index] = model.line_segments[index].with_line_color(color);
}

fn add_line(model: &mut CreasePatternModel, a: Point, b: Point, color: LineColor) {
    model.add_line_segment(LineSegment::with_color(a, b, color));
}

fn add_line_like(model: &mut CreasePatternModel, a: Point, b: Point, template: &LineSegment) {
    model.add_line_segment(template.with_coordinates(a, b));
}

fn overlapping_color(i: usize, j: usize, si_color: LineColor, sj_color: LineColor) -> LineColor {
    if i < j { sj_color } else { si_color }
}

/// Remove duplicate overlapping line segments in Oriedita's order.
///
/// This ports the observable behavior of `FoldLineSet.removeOverlappingLines`:
/// when two line segments classify as `PARALLEL_EQUAL_31`, the later line is
/// removed and the earlier line survives. The upstream implementation uses
/// spatial acceleration; this first Rust port intentionally keeps the same
/// pair-order semantics with a direct scan so correctness is visible.
pub fn remove_overlapping_lines(model: &mut CreasePatternModel) {
    remove_overlapping_lines_with_precision(model, DEFAULT_PRECISION_SENTINEL);
}

/// Remove duplicate overlapping line segments with Oriedita's optional radius.
pub fn remove_overlapping_lines_with_precision(model: &mut CreasePatternModel, radius: f64) {
    let mut remove = vec![false; model.line_segments.len()];

    let len = model.line_segments.len();
    for i in 0..len.saturating_sub(1) {
        for (j, remove_j) in remove.iter_mut().enumerate().take(len).skip(i + 1) {
            let intersection = if radius <= DEFAULT_PRECISION_SENTINEL {
                determine_line_segment_intersection(
                    &model.line_segments[i],
                    &model.line_segments[j],
                )
            } else {
                determine_line_segment_intersection_with_precision(
                    &model.line_segments[i],
                    &model.line_segments[j],
                    radius,
                )
            };

            if intersection == Intersection::ParallelEqual31 {
                *remove_j = true;
            }
        }
    }

    model.line_segments = model
        .line_segments
        .iter()
        .enumerate()
        .filter_map(|(index, segment)| (!remove[index]).then_some(segment.clone()))
        .collect();
}

#[cfg(test)]
mod import_add_tests {
    use super::*;
    use crate::geometry::Circle;

    fn model_with(segments: Vec<LineSegment>) -> CreasePatternModel {
        CreasePatternModel {
            line_segments: segments,
            ..CreasePatternModel::default()
        }
    }

    #[test]
    fn import_add_shifts_import_right_of_existing_pattern() {
        // Existing pattern occupies x in [0, 10], y in [0, 10].
        let mut model = model_with(vec![
            LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0),
            LineSegment::from_coordinates(0.0, 0.0, 0.0, 10.0),
            LineSegment::from_coordinates(10.0, 0.0, 10.0, 10.0),
            LineSegment::from_coordinates(0.0, 10.0, 10.0, 10.0),
        ]);
        // Imported pattern is a single segment from (0,0) to (5,5).
        let imported = model_with(vec![LineSegment::from_coordinates(0.0, 0.0, 5.0, 5.0)]);

        import_add(&mut model, &imported);

        // The imported segment must be shifted by addx = 10 + 100 - 0 = 110 and
        // addy = 10 - 5 = 5, and no existing line may be lost.
        let shifted = model
            .line_segments
            .iter()
            .find(|segment| (segment.a.x - 110.0).abs() < 1e-9 && (segment.a.y - 5.0).abs() < 1e-9);
        let shifted = shifted.expect("imported segment should be shifted to (110, 5)");
        assert!((shifted.b.x - 115.0).abs() < 1e-9);
        assert!((shifted.b.y - 10.0).abs() < 1e-9);
    }

    #[test]
    fn import_add_divides_crossing_lines() {
        // A single horizontal line at y = 5 spanning x in [0, 10].
        let mut model = model_with(vec![LineSegment::with_color(
            Point::new(0.0, 5.0),
            Point::new(10.0, 5.0),
            LineColor::Black0,
        )]);
        // Import a segment that, after the 110-unit shift, is guaranteed not to
        // touch the existing line, so only the import's own division applies and
        // the existing horizontal line survives intact.
        let imported = model_with(vec![LineSegment::from_coordinates(0.0, 0.0, 0.0, 8.0)]);
        let before = model.line_segments.len();

        import_add(&mut model, &imported);

        assert!(model.line_segments.len() > before);
        assert!(
            model
                .line_segments
                .iter()
                .all(|segment| segment.selected == 0)
        );
    }

    #[test]
    fn import_add_into_empty_pattern_gaps_by_one_hundred() {
        let mut model = CreasePatternModel::default();
        let imported = model_with(vec![LineSegment::from_coordinates(0.0, 0.0, 4.0, 0.0)]);

        import_add(&mut model, &imported);

        // Empty getMaxX/getMaxY are 0.0, so addx = 0 + 100 - 0 = 100, addy = 0.
        let segment = &model.line_segments[0];
        assert!((segment.a.x - 100.0).abs() < 1e-9);
        assert!((segment.b.x - 104.0).abs() < 1e-9);
        assert!(segment.a.y.abs() < 1e-9);
    }

    /// Circles ride the import's shift with the lines, unchanged otherwise.
    ///
    /// This is what lets "Send to Edit (include circles)" place circles on the
    /// *imported* document and let the merge carry them: the shift is derived
    /// from the line segments alone, so a circle keeps its position relative to
    /// the creases it annotates. Radius and colour must survive untouched — a
    /// scaled radius would put a packing circle on the wrong flap.
    #[test]
    fn import_add_shifts_circles_with_their_lines() {
        let mut model = model_with(vec![LineSegment::from_coordinates(0.0, 0.0, 10.0, 10.0)]);
        let mut imported = model_with(vec![LineSegment::from_coordinates(0.0, 0.0, 5.0, 5.0)]);
        imported.add_circle(Circle::new(1.0, 2.0, 3.0, LineColor::Cyan3));

        import_add(&mut model, &imported);

        // Same addx/addy the lines get: 10 + 100 - 0 = 110, and 10 - 5 = 5.
        assert_eq!(model.circles.len(), 1);
        let circle = &model.circles[0];
        assert!((circle.x - 111.0).abs() < 1e-9);
        assert!((circle.y - 7.0).abs() < 1e-9);
        assert!((circle.r - 3.0).abs() < 1e-9);
        assert_eq!(circle.color, LineColor::Cyan3);
    }

    /// A circle keeps its offset from the creases it was placed against.
    ///
    /// Stronger than asserting the shift arithmetic: it says the *relationship*
    /// is preserved, which is the property the feature actually depends on.
    #[test]
    fn import_add_preserves_circle_offset_from_imported_lines() {
        let mut model = model_with(vec![LineSegment::from_coordinates(0.0, 0.0, 40.0, 40.0)]);
        let mut imported = model_with(vec![LineSegment::from_coordinates(2.0, 3.0, 6.0, 9.0)]);
        // Centred on the imported segment's first endpoint.
        imported.add_circle(Circle::new(2.0, 3.0, 1.5, LineColor::Cyan3));

        import_add(&mut model, &imported);

        let moved = model
            .line_segments
            .iter()
            .find(|segment| (segment.a.x - model.circles[0].x).abs() < 1e-9)
            .expect("the imported segment should still start at the circle's centre");
        assert!((moved.a.y - model.circles[0].y).abs() < 1e-9);
    }
}
