//! Line color/type operations ported from Oriedita handlers and `FoldLineSet`.

use crate::geometry::{
    Epsilon, FoldMagnitude, Intersection, LineColor, LineSegment, determine_line_segment_distance,
    determine_line_segment_intersection_with_precision, distance, find_intersection_segments,
    is_line_segment_overlapping,
};
use crate::model::{CreasePatternModel, CustomLineType};
use crate::operations::arrangement::{divide_line_segment_with_new_lines, fix2};

/// Oriedita `FoldLineSet.setColor(Collection<LineSegment>, LineColor)`.
pub fn set_line_color_for_segments(
    model: &mut CreasePatternModel,
    lines: &[LineSegment],
    color: LineColor,
) -> usize {
    let mut changed = 0;
    let mut aux = Vec::new();

    for index in 0..model.line_segments.len() {
        if !lines.contains(&model.line_segments[index]) {
            continue;
        }

        if model.line_segments[index].color == color {
            continue;
        }

        changed += 1;
        if model.line_segments[index].color == LineColor::Cyan3 {
            aux.push(model.line_segments[index].clone());
        } else {
            let segment = model.line_segments[index].clone();
            model.line_segments[index] = segment.with_line_color(color);
        }
    }

    replace_aux_lines(model, color, &aux);
    changed
}

/// Convenience wrapper for index-based callers.
pub fn set_line_color_for_indices(
    model: &mut CreasePatternModel,
    indices: &[usize],
    color: LineColor,
) -> usize {
    let lines: Vec<_> = indices
        .iter()
        .filter_map(|index| model.line_segments.get(*index).cloned())
        .collect();
    set_line_color_for_segments(model, &lines, color)
}

/// Oriedita selected-line mountain command without the UI box-selection step.
pub fn make_mountain(model: &mut CreasePatternModel, indices: &[usize]) -> usize {
    make_fold_color(model, indices, LineColor::Red1)
}

/// Oriedita selected-line valley command without the UI box-selection step.
pub fn make_valley(model: &mut CreasePatternModel, indices: &[usize]) -> usize {
    make_fold_color(model, indices, LineColor::Blue2)
}

/// Oriedita selected-line edge command without the UI box-selection step.
pub fn make_edge(model: &mut CreasePatternModel, indices: &[usize]) -> usize {
    make_fold_color(model, indices, LineColor::Black0)
}

/// Oriedita `CREASE_MAKE_AUX_60` selected-line mutation.
pub fn make_aux(model: &mut CreasePatternModel, indices: &[usize]) -> usize {
    let lines: Vec<_> = indices
        .iter()
        .filter_map(|index| model.line_segments.get(*index))
        .filter(|segment| segment.color.is_folding_line())
        .cloned()
        .collect();

    let mut changed = 0;
    for segment in lines {
        let Some(index) = model
            .line_segments
            .iter()
            .position(|candidate| candidate == &segment)
        else {
            continue;
        };
        model.line_segments.remove(index);
        model.add_line_segment(segment.with_line_color(LineColor::Cyan3));
        changed += 1;
    }

    if changed > 0 {
        let end = model.line_segments.len();
        divide_line_segment_with_new_lines(model, end - changed, end);
    }

    changed
}

/// Oriedita `REPLACE_LINE_TYPE_SELECT_72` mutation over explicit line indices.
pub fn replace_line_type_for_indices(
    model: &mut CreasePatternModel,
    indices: &[usize],
    from: CustomLineType,
    to: CustomLineType,
) -> usize {
    let lines = lines_matching_type_for_indices(model, indices, from);
    set_line_color_for_segments(model, &lines, to.line_color())
}

/// Replace currently selected lines matching one Oriedita custom line type.
pub fn replace_selected_line_type(
    model: &mut CreasePatternModel,
    from: CustomLineType,
    to: CustomLineType,
) -> usize {
    let indices = selected_indices(model);
    replace_line_type_for_indices(model, &indices, from, to)
}

/// Oriedita `DELETE_LINE_TYPE_SELECT_73` mutation over explicit line indices.
pub fn delete_line_type_for_indices(
    model: &mut CreasePatternModel,
    indices: &[usize],
    line_type: CustomLineType,
) -> usize {
    let lines = lines_matching_type_for_indices(model, indices, line_type);
    delete_lines_by_value(model, &lines)
}

/// Delete currently selected lines matching one Oriedita custom line type.
pub fn delete_selected_line_type(
    model: &mut CreasePatternModel,
    line_type: CustomLineType,
) -> usize {
    let indices = selected_indices(model);
    delete_line_type_for_indices(model, &indices, line_type)
}

/// Oriedita `CREASE_TOGGLE_MV_58` selected-line mutation.
pub fn toggle_mountain_valley(model: &mut CreasePatternModel, indices: &[usize]) -> usize {
    let mut changed = 0;
    for index in indices {
        let Some(segment) = model.line_segments.get(*index).cloned() else {
            continue;
        };

        let color = match segment.color {
            LineColor::Red1 => LineColor::Blue2,
            LineColor::Blue2 => LineColor::Red1,
            _ => continue,
        };
        model.line_segments[*index] = segment.with_line_color(color);
        changed += 1;
    }
    changed
}

/// Oriedita `CHANGE_CREASE_TYPE_4` mutation after the target line is known.
pub fn change_crease_type(model: &mut CreasePatternModel, index: usize) -> bool {
    let Some(segment) = model.line_segments.get(index).cloned() else {
        return false;
    };
    if !segment.color.is_folding_line() {
        return false;
    }

    let Ok(color) = segment.color.advance_folding() else {
        return false;
    };
    set_line_color_by_value(model, &segment, color)
}

/// Oriedita `CREASE_ADVANCE_TYPE_30` persisted mutation for one line.
pub fn advance_line_type(model: &mut CreasePatternModel, index: usize) -> bool {
    if index >= model.line_segments.len() {
        return false;
    };

    let segment = model.line_segments.remove(index);
    let next = match (segment.color, segment.selected) {
        (LineColor::Black0, 0) => segment.with_selected(2),
        (LineColor::Black0, 2) => segment.with_line_color(LineColor::Red1).with_selected(0),
        (LineColor::Red1, 0) => segment.with_line_color(LineColor::Blue2),
        (LineColor::Blue2, 0) => segment.with_line_color(LineColor::Black0),
        _ => segment,
    };
    model.add_line_segment(next);
    true
}

/// Oriedita `CREASE_MAKE_MV_34` mutation over overlapping lines.
pub fn alternate_mountain_valley_along(
    model: &mut CreasePatternModel,
    guide: &LineSegment,
    start_color: LineColor,
) -> usize {
    let mut overlapping: Vec<_> = model
        .line_segments
        .iter()
        .filter(|segment| is_line_segment_overlapping(segment, guide))
        .map(|segment| {
            (
                segment.clone(),
                determine_line_segment_distance(guide.a, segment),
            )
        })
        .collect();
    overlapping.sort_by(|left, right| {
        left.1
            .partial_cmp(&right.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut color = start_color;
    let mut changed = 0;
    for (segment, _) in overlapping {
        if set_line_color_by_value(model, &segment, color) {
            changed += 1;
        }
        color = match color {
            LineColor::Red1 => LineColor::Blue2,
            LineColor::Blue2 => LineColor::Red1,
            other => other,
        };
    }
    changed
}

/// Oriedita `CREASES_ALTERNATE_MV_36` mutation for lines crossing a guide.
pub fn alternate_mountain_valley_crossing(
    model: &mut CreasePatternModel,
    guide: &LineSegment,
    start_color: LineColor,
) -> usize {
    if !Epsilon::HIGH.gt0(guide.determine_length()) {
        return 0;
    }

    let mut crossing: Vec<_> = model
        .line_segments
        .iter()
        .filter_map(|segment| {
            let intersection = determine_line_segment_intersection_with_precision(
                segment,
                guide,
                Epsilon::UNKNOWN_1EN4,
            );
            if !matches!(
                intersection,
                Intersection::Intersects1
                    | Intersection::IntersectsTShapeS2VerticalBar27
                    | Intersection::IntersectsTShapeS2VerticalBar28
            ) {
                return None;
            }

            Some((
                segment.clone(),
                distance(guide.b, find_intersection_segments(segment, guide)),
            ))
        })
        .collect();
    crossing.sort_by(|left, right| {
        left.1
            .partial_cmp(&right.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut color = start_color;
    let mut changed = 0;
    for (segment, _) in crossing {
        if set_line_color_by_value(model, &segment, color) {
            changed += 1;
        }
        color = match color {
            LineColor::Red1 => LineColor::Blue2,
            LineColor::Blue2 => LineColor::Red1,
            other => other,
        };
    }
    changed
}

fn make_fold_color(model: &mut CreasePatternModel, indices: &[usize], color: LineColor) -> usize {
    let changed = set_line_color_for_indices(model, indices, color);
    if changed > 0 {
        fix2(model);
    }
    changed
}

fn set_line_color_by_value(
    model: &mut CreasePatternModel,
    segment: &LineSegment,
    color: LineColor,
) -> bool {
    let Some(index) = model
        .line_segments
        .iter()
        .position(|candidate| candidate == segment)
    else {
        return false;
    };

    let segment = model.line_segments[index].clone();
    model.line_segments[index] = segment.with_line_color(color);
    true
}

fn replace_aux_lines(model: &mut CreasePatternModel, color: LineColor, aux: &[LineSegment]) {
    for segment in aux {
        let replacement = segment.with_line_color(color);
        let Some(index) = model
            .line_segments
            .iter()
            .position(|candidate| candidate == segment)
        else {
            continue;
        };

        model.line_segments.remove(index);
        let original_end = model.line_segments.len();
        model.add_line_segment(replacement);
        divide_line_segment_with_new_lines(model, original_end, original_end + 1);
    }
}

fn selected_indices(model: &CreasePatternModel) -> Vec<usize> {
    model
        .line_segments
        .iter()
        .enumerate()
        .filter(|(_, segment)| segment.selected == 2)
        .map(|(index, _)| index)
        .collect()
}

fn lines_matching_type_for_indices(
    model: &CreasePatternModel,
    indices: &[usize],
    line_type: CustomLineType,
) -> Vec<LineSegment> {
    indices
        .iter()
        .filter_map(|index| model.line_segments.get(*index))
        .filter(|segment| line_type.matches(segment.color))
        .cloned()
        .collect()
}

fn delete_lines_by_value(model: &mut CreasePatternModel, lines: &[LineSegment]) -> usize {
    let mut deleted = 0;
    for line in lines {
        if let Some(index) = model
            .line_segments
            .iter()
            .position(|candidate| candidate == line)
        {
            model.line_segments.remove(index);
            deleted += 1;
        }
    }
    deleted
}

/// Set the fold magnitude on the given line indices.
///
/// Ori Studio native — Oriedita has no equivalent, because Oriedita creases are
/// always a full +/-180.
///
/// Only folding creases (`Red1`/`Blue2`) are touched; a border or auxiliary line
/// in the selection is skipped rather than silently mutated, so the caller can
/// report how many of the selection actually changed. Setting 180 degrees stores
/// `None`, the canonical classic representation — see `LineSegment::fold_magnitude`.
pub fn set_fold_magnitude_for_indices(
    model: &mut CreasePatternModel,
    indices: &[usize],
    magnitude: Option<FoldMagnitude>,
) -> usize {
    let mut changed = 0;
    for &index in indices {
        let Some(segment) = model.line_segments.get(index) else {
            continue;
        };
        if !matches!(segment.color, LineColor::Red1 | LineColor::Blue2) {
            continue;
        }
        let updated = segment.with_fold_magnitude(magnitude);
        if updated.fold_magnitude == segment.fold_magnitude {
            continue;
        }
        model.line_segments[index] = updated;
        changed += 1;
    }
    changed
}

/// Set a signed fold angle — direction *and* magnitude — on several creases at
/// once.
///
/// Ori Studio native. The two halves have to move together and in one step:
/// closing a vertex can require a mountain to become a valley, and applying the
/// colour and the magnitude as two operations would put a state on the undo
/// stack that the solve never proposed — a crease carrying the new angle with
/// the old direction, which is a different fold.
///
/// # This decides nothing itself
///
/// The whole per-crease rule — which colours are eligible (unassigned included:
/// deciding one is the point of the operation, and excluding it made the
/// three-angle solve apply **two thirds** of its own answer), what the sign
/// names, what a zero does, how 180 normalises — lives in
/// [`LineSegment::with_signed_fold_angle`], because the *preview* has to produce
/// the identical segment and a second copy of the rule is how these two came to
/// disagree in the first place. This is the loop and the change count around it,
/// and nothing more. See `a_solve_decides_the_unassigned_crease_it_was_given`.
///
/// The count is creases that really moved: a write landing on the state the
/// crease is already in is not one, which is what lets propagation use it to ask
/// "did this crease move".
pub fn set_signed_fold_angles(model: &mut CreasePatternModel, angles: &[(usize, f64)]) -> usize {
    let mut changed = 0;
    for &(index, degrees) in angles {
        let Some(segment) = model.line_segments.get(index) else {
            continue;
        };
        let updated = segment.with_signed_fold_angle(degrees);
        if updated == *segment {
            continue;
        }
        model.line_segments[index] = updated;
        changed += 1;
    }
    changed
}
