//! Insert a vertex at a point, splitting **every** crease that passes through
//! it in one edit.
//!
//! Ori Studio original. Oriedita's nearest tool is `MouseHandlerDrawPoint`
//! (`DRAW_POINT_14`), which resolves the *closest* line segment and hands that
//! one to `FoldLineSet.applyLineSegmentDivide`; at a crossing it therefore
//! splits one crease and leaves the other whole. That is the right tool for
//! putting a reference point on a crease and the wrong one for the repair verb
//! this exists for, where a junction the graph is missing needs the vertex on
//! every crease through it or the repair is half applied — a 4-valent crossing
//! costs four missing edges and two extra ones, and it is one repair, not four.
//!
//! Two deliberate differences from `applyLineSegmentDivide`, both stated here
//! because the file is otherwise a faithful reading of it:
//!
//! - **The first half stays in its slot.** Upstream deletes the segment and
//!   appends both halves. Line ids are indices, so that renumbers every crease
//!   after the split — and the surfaces that drive this hold ids across the
//!   edit. Replacing in place and appending only the second half leaves every
//!   untouched crease's id alone, and is the same shape `divideIntersectionsFast`
//!   uses for its own splits (`set_segment(i, …)` plus an append).
//! - **Both halves keep every field**, which upstream also does via
//!   `withA`/`withB`; it is repeated here because it is the property the repair
//!   flow depends on. A split must not decide a crease's mountain/valley, its
//!   fold angle, or its custom colour.
//!
//! Auxiliary lines are not touched: they live in
//! [`CreasePatternModel::aux_line_segments`], a separate list, and a
//! construction guide has no place in the fold graph this repairs.

use crate::geometry::{Epsilon, LineSegment, Point, determine_line_segment_distance};
use crate::model::CreasePatternModel;

/// How near the point has to pass a crease to count as lying on it.
///
/// [`Epsilon::UNKNOWN_001`] is the precision
/// [`crate::geometry::determine_line_segment_intersection`] uses when no caller
/// states one — the kernel's own default answer to "do these two meet" — so the
/// question "is this point on this crease" is asked at the tolerance the kernel
/// already answers it at, rather than at a second one invented here.
///
/// It is deliberately not a pointer radius. The split lands on the **supplied**
/// point, not on its projection, because the halves of two different creases
/// have to end at the *same* coordinate or no vertex has been inserted at all;
/// the tolerance is therefore also the bound on how far this operation may bend
/// a crease, and a click radius would be far too much licence for that.
///
/// The command payload's `selection_distance` is deliberately *not* consulted:
/// every tool with steps is handed one automatically, it is a pointer radius
/// that grows as the camera zooms out, and `cp_workspace/snapRadius.ts` records
/// what happens when a kernel decision that is not pointer proximity reuses it.
///
/// So a caller aiming a cursor resolves the point first and sends the resolved
/// one. Two creases that genuinely cross give an exact point on both — the
/// 4-valent hub that dominates the repair population. A near-T, where one
/// crease *nearly* reaches another, has no such point: send the projection onto
/// the crease being split, or weld the near-miss with `Fix2` first. This
/// operation will not move a crease onto a junction it does not already reach.
pub const ON_CREASE_TOLERANCE: f64 = Epsilon::UNKNOWN_001;

/// One crease the point splits, and the two segments it becomes.
///
/// `index` is the crease's position in [`CreasePatternModel::line_segments`],
/// which is where `first` goes; `second` is appended.
#[derive(Debug, Clone, PartialEq)]
pub struct CreaseSplit {
    /// Index of the crease being split.
    pub index: usize,
    /// The half from the crease's `a` to the inserted vertex.
    pub first: LineSegment,
    /// The half from the inserted vertex to the crease's `b`.
    pub second: LineSegment,
}

/// Work out what inserting a vertex at `point` would split, changing nothing.
///
/// One resolver for the commit and the preview, so what the surface shows under
/// the cursor is what the click does. An empty result is the ordinary answer for
/// a point on no crease.
pub fn plan_vertex_insert(model: &CreasePatternModel, point: Point) -> Vec<CreaseSplit> {
    if !point.x.is_finite() || !point.y.is_finite() {
        return Vec::new();
    }

    model
        .line_segments
        .iter()
        .enumerate()
        .filter(|(_, segment)| passes_through(segment, point))
        .map(|(index, segment)| CreaseSplit {
            index,
            first: segment.with_b(point),
            second: segment.with_a(point),
        })
        .collect()
}

/// Insert a vertex at `point`, splitting every crease whose interior passes
/// through it. Returns how many creases were split.
///
/// A no-op — returning `0` and leaving the document untouched — when nothing
/// passes through the point, and idempotent: the second call finds the creases
/// already ending there and splits nothing.
pub fn insert_vertex_on_creases(model: &mut CreasePatternModel, point: Point) -> usize {
    let mut split = 0;
    // Appending never shifts an existing index, so the planned indices stay
    // valid as the second halves accumulate.
    for crease in plan_vertex_insert(model, point) {
        let Some(slot) = model.line_segments.get_mut(crease.index) else {
            continue;
        };
        *slot = crease.first;
        model.add_line_segment(crease.second);
        split += 1;
    }
    split
}

/// Whether `point` lies on this crease's interior, far enough from both ends to
/// be a new vertex rather than one that is already there.
fn passes_through(segment: &LineSegment, point: Point) -> bool {
    // A zero-length segment has no interior to split, and `Fix1` owns it anyway.
    if !Epsilon::HIGH.gt0(segment.determine_length()) {
        return false;
    }

    // The idempotent case, and the guard that keeps the split from producing a
    // sliver shorter than the tolerance that found it — a single 9.4e-5 crease
    // is enough to make the FOLD exporter's Euler check discard every face.
    if point.distance(segment.a) <= ON_CREASE_TOLERANCE
        || point.distance(segment.b) <= ON_CREASE_TOLERANCE
    {
        return false;
    }

    // `determine_line_segment_distance` clamps to the endpoints, so this is the
    // perpendicular distance exactly when the point projects between them and
    // an endpoint distance otherwise — which the guard above has already
    // rejected. One predicate answers both "on the line" and "between the ends".
    determine_line_segment_distance(point, segment) <= ON_CREASE_TOLERANCE
}

#[cfg(test)]
mod tests {
    use super::{ON_CREASE_TOLERANCE, insert_vertex_on_creases, plan_vertex_insert};
    use crate::geometry::{FoldMagnitude, LineColor, LineSegment, Point};
    use crate::model::CreasePatternModel;

    fn model_with(segments: impl IntoIterator<Item = LineSegment>) -> CreasePatternModel {
        let mut model = CreasePatternModel::default();
        for segment in segments {
            model.add_line_segment(segment);
        }
        model
    }

    fn segment(ax: f64, ay: f64, bx: f64, by: f64, color: LineColor) -> LineSegment {
        LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
    }

    /// The dominant repair: a crossing both creases draw through and neither
    /// stops at. One click has to make it four creases, not two plus a whole one.
    #[test]
    fn a_crossing_splits_both_creases_into_four() {
        let mut model = model_with([
            segment(-10.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(0.0, -10.0, 0.0, 10.0, LineColor::Blue2),
        ]);

        assert_eq!(
            insert_vertex_on_creases(&mut model, Point::new(0.0, 0.0)),
            2
        );

        assert_eq!(model.line_segments.len(), 4);
        let origin = Point::new(0.0, 0.0);
        for segment in &model.line_segments {
            assert!(
                segment.a == origin || segment.b == origin,
                "every half must meet at the inserted vertex, got {segment:?}"
            );
        }
    }

    #[test]
    fn a_t_junction_splits_only_the_crease_passing_through() {
        let mut model = model_with([
            segment(-10.0, 0.0, 10.0, 0.0, LineColor::Red1),
            // Stops on the first crease rather than crossing it.
            segment(0.0, 0.0, 0.0, 10.0, LineColor::Blue2),
        ]);

        assert_eq!(
            insert_vertex_on_creases(&mut model, Point::new(0.0, 0.0)),
            1
        );

        assert_eq!(model.line_segments.len(), 3);
        // The stem is untouched and keeps its slot.
        assert_eq!(
            model.line_segments[1],
            segment(0.0, 0.0, 0.0, 10.0, LineColor::Blue2)
        );
    }

    #[test]
    fn a_point_on_no_crease_changes_nothing() {
        let before = model_with([segment(-10.0, 0.0, 10.0, 0.0, LineColor::Red1)]);
        let mut model = before.clone();

        assert_eq!(
            insert_vertex_on_creases(&mut model, Point::new(4.0, 3.0)),
            0
        );

        assert_eq!(model, before);
    }

    /// The whole point of the endpoint guard: near enough to be found, too near
    /// to be a new vertex. Splitting here would leave a sliver the fold graph
    /// cannot survive.
    #[test]
    fn a_point_just_off_the_line_is_outside_the_tolerance_and_does_nothing() {
        let before = model_with([segment(-10.0, 0.0, 10.0, 0.0, LineColor::Red1)]);
        let mut model = before.clone();
        let just_outside = Point::new(0.0, ON_CREASE_TOLERANCE * 2.0);

        assert_eq!(insert_vertex_on_creases(&mut model, just_outside), 0);

        assert_eq!(model, before);
        // …and just inside it does split, so the test above is about the
        // tolerance rather than about the point being on the wrong crease.
        let mut inside = before.clone();
        let just_inside = Point::new(0.0, ON_CREASE_TOLERANCE / 2.0);
        assert_eq!(insert_vertex_on_creases(&mut inside, just_inside), 1);
    }

    #[test]
    fn inserting_the_same_vertex_twice_is_a_no_op_the_second_time() {
        let mut model = model_with([
            segment(-10.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(0.0, -10.0, 0.0, 10.0, LineColor::Blue2),
        ]);

        assert_eq!(
            insert_vertex_on_creases(&mut model, Point::new(0.0, 0.0)),
            2
        );
        let after_first = model.clone();

        assert_eq!(
            insert_vertex_on_creases(&mut model, Point::new(0.0, 0.0)),
            0
        );
        assert_eq!(model, after_first);
    }

    /// A vertex that is already there but reached from a hair off still counts
    /// as already there, at the same tolerance the crease was found by.
    #[test]
    fn a_vertex_within_tolerance_of_an_endpoint_is_already_there() {
        let before = model_with([
            segment(-10.0, 0.0, 0.0, 0.0, LineColor::Red1),
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        ]);
        let mut model = before.clone();

        let nearly = Point::new(ON_CREASE_TOLERANCE / 2.0, 0.0);
        assert_eq!(insert_vertex_on_creases(&mut model, nearly), 0);
        assert_eq!(model, before);
    }

    /// A split must not decide anything about the crease it splits.
    #[test]
    fn both_halves_keep_the_creases_colour_and_fold_angle() {
        let creased = LineSegment {
            fold_magnitude: FoldMagnitude::from_degrees(37.5),
            ..segment(-10.0, 0.0, 10.0, 0.0, LineColor::Blue2)
        }
        .with_selected(2);
        let mut model = model_with([creased.clone()]);

        assert_eq!(
            insert_vertex_on_creases(&mut model, Point::new(2.0, 0.0)),
            1
        );

        assert_eq!(model.line_segments.len(), 2);
        for half in &model.line_segments {
            assert_eq!(half.color, creased.color);
            assert_eq!(half.fold_magnitude, creased.fold_magnitude);
            assert_eq!(half.selected, creased.selected);
        }
        assert_eq!(model.line_segments[0].a, creased.a);
        assert_eq!(model.line_segments[0].b, Point::new(2.0, 0.0));
        assert_eq!(model.line_segments[1].a, Point::new(2.0, 0.0));
        assert_eq!(model.line_segments[1].b, creased.b);
    }

    /// Three creases through one point is the same edit as two, and the reason
    /// the operation is "every crease" rather than "the closest".
    #[test]
    fn every_crease_through_the_point_splits_in_one_call() {
        let mut model = model_with([
            segment(-10.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(0.0, -10.0, 0.0, 10.0, LineColor::Blue2),
            segment(-10.0, -10.0, 10.0, 10.0, LineColor::Black0),
        ]);

        assert_eq!(
            insert_vertex_on_creases(&mut model, Point::new(0.0, 0.0)),
            3
        );
        assert_eq!(model.line_segments.len(), 6);
    }

    #[test]
    fn the_plan_names_the_slot_the_first_half_lands_in() {
        let model = model_with([
            segment(-10.0, 5.0, 10.0, 5.0, LineColor::Red1),
            segment(-10.0, 0.0, 10.0, 0.0, LineColor::Red1),
        ]);

        let planned = plan_vertex_insert(&model, Point::new(0.0, 0.0));

        assert_eq!(planned.len(), 1);
        assert_eq!(planned[0].index, 1);
        assert_eq!(planned[0].first.b, Point::new(0.0, 0.0));
        assert_eq!(planned[0].second.a, Point::new(0.0, 0.0));
    }

    #[test]
    fn a_degenerate_crease_has_no_interior_to_split() {
        let before = model_with([segment(3.0, 3.0, 3.0, 3.0, LineColor::Red1)]);
        let mut model = before.clone();

        assert_eq!(
            insert_vertex_on_creases(&mut model, Point::new(3.0, 3.0)),
            0
        );

        assert_eq!(model, before);
    }

    #[test]
    fn a_non_finite_point_splits_nothing() {
        let before = model_with([segment(-10.0, 0.0, 10.0, 0.0, LineColor::Red1)]);
        let mut model = before.clone();

        assert_eq!(
            insert_vertex_on_creases(&mut model, Point::new(f64::NAN, 0.0)),
            0
        );

        assert_eq!(model, before);
    }
}
