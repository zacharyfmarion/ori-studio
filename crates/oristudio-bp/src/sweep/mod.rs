pub mod aa_union;
pub mod clip;
pub mod general_union;
pub mod overlap;
pub mod rr_intersection;
pub mod stacking;

pub use aa_union::{AaUnion, PathEx, RoughUnion, UnionResult, aa_union, rough_union};
pub use clip::{Clip, clip_lines};
pub use general_union::{GeneralUnion, general_union};
pub use overlap::{Overlap, overlap_test};
pub use rr_intersection::{ArcPath, ArcPoint, RoundedRect, RrIntersection, rr_intersection};
pub use stacking::{Contour, ContourEx, Stacking, get_stacking, get_stacking_ex};

use crate::math::geometry::{EPSILON, PathPoint, fix_zero, is_almost_zero};
use std::cmp::Ordering;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum CreaseType {
    None = 0,
    Border = 1,
    Mountain = 2,
    Valley = 3,
    Auxiliary = 4,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CpLine {
    pub crease_type: CreaseType,
    pub p1: PathPoint,
    pub p2: PathPoint,
}

#[derive(Debug, Clone)]
struct LineSegment {
    segment_type: CreaseType,
    polygon: usize,
    start: PathPoint,
    end: PathPoint,
    coefficients: [f64; 3],
    is_horizontal: bool,
    is_vertical: bool,
}

impl LineSegment {
    fn new(start: PathPoint, end: PathPoint, polygon: usize) -> Self {
        Self::with_type(start, end, polygon, CreaseType::None)
    }

    fn with_type(
        start: PathPoint,
        end: PathPoint,
        polygon: usize,
        segment_type: CreaseType,
    ) -> Self {
        let coefficients = [
            end.y - start.y,
            start.x - end.x,
            start.y * end.x - start.x * end.y,
        ];
        Self {
            segment_type,
            polygon,
            start,
            end,
            coefficients,
            is_horizontal: is_almost_zero(coefficients[0], EPSILON),
            is_vertical: is_almost_zero(coefficients[1], EPSILON),
        }
    }

    fn contains_pt_on_line(&self, point: PathPoint, endpoints: bool) -> bool {
        let threshold = if endpoints { EPSILON } else { -EPSILON };
        !self.is_vertical && (point.x - self.start.x) * (point.x - self.end.x) < threshold
            || !self.is_horizontal && (point.y - self.start.y) * (point.y - self.end.y) < threshold
    }

    fn subdivide(&mut self, point: PathPoint, oriented: bool) -> Self {
        if oriented {
            let new_segment =
                LineSegment::with_type(point, self.end, self.polygon, self.segment_type);
            self.end = point;
            new_segment
        } else {
            let new_segment =
                LineSegment::with_type(self.start, point, self.polygon, self.segment_type);
            self.start = point;
            new_segment
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EventKind {
    End = 0,
    Start = 1,
}

#[derive(Debug, Clone)]
struct SweepEvent {
    key: usize,
    point: PathPoint,
    kind: EventKind,
    segment: Option<LineSegment>,
    wrap_delta: i8,
    wrap_count: i32,
    other_point: PathPoint,
    other_key: usize,
}

#[derive(Debug, Clone)]
struct StatusKey {
    key: usize,
    point: PathPoint,
    segment: LineSegment,
    wrap_delta: i8,
    other_point: PathPoint,
}

#[derive(Debug, Clone)]
struct StatusEntry {
    polygon: usize,
    wrap_count: i32,
}

fn build_general_events(paths: &[Vec<PathPoint>]) -> Vec<SweepEvent> {
    let mut events = Vec::new();
    let mut next_key = 0;
    for (polygon, path) in paths.iter().enumerate() {
        if path.is_empty() {
            continue;
        }
        for i in 0..path.len() {
            let p1 = path[i];
            let p2 = path.get(i + 1).copied().unwrap_or(path[0]);
            let segment = LineSegment::new(p1, p2, polygon);
            let delta = if float_xy_cmp(&p1, &p2).is_lt() {
                1
            } else {
                -1
            };
            add_segment(&mut events, &mut next_key, segment, delta);
        }
    }
    events.sort_by(exit_first_event_cmp);
    events
}

fn add_segment(
    events: &mut Vec<SweepEvent>,
    next_key: &mut usize,
    segment: LineSegment,
    delta: i8,
) {
    if segment.start == segment.end {
        return;
    }

    let (start_point, end_point) = if delta == 1 {
        (segment.start, segment.end)
    } else {
        (segment.end, segment.start)
    };

    let start_key = *next_key;
    *next_key += 1;
    let end_key = *next_key;
    *next_key += 1;

    events.push(SweepEvent {
        key: start_key,
        point: start_point,
        kind: EventKind::Start,
        segment: Some(segment.clone()),
        wrap_delta: delta,
        wrap_count: i32::from(delta),
        other_point: end_point,
        other_key: end_key,
    });
    events.push(SweepEvent {
        key: end_key,
        point: end_point,
        kind: EventKind::End,
        segment: None,
        wrap_delta: 0,
        wrap_count: 0,
        other_point: start_point,
        other_key: start_key,
    });
}

fn status_key(event: &SweepEvent) -> Option<StatusKey> {
    let segment = event.segment.clone()?;
    Some(StatusKey {
        key: event.key,
        point: event.point,
        segment,
        wrap_delta: event.wrap_delta,
        other_point: event.other_point,
    })
}

fn exit_first_event_cmp(a: &SweepEvent, b: &SweepEvent) -> Ordering {
    float_xy_cmp(&a.point, &b.point)
        .then_with(|| (a.kind as u8).cmp(&(b.kind as u8)))
        .then_with(|| {
            if a.kind == EventKind::Start && b.kind == EventKind::Start {
                start_segment_cmp(a, b).then_with(|| a.wrap_delta.cmp(&b.wrap_delta))
            } else {
                Ordering::Equal
            }
        })
        .then_with(|| a.key.cmp(&b.key))
}

fn exit_first_status_cmp(a: &StatusKey, b: &StatusKey) -> Ordering {
    compare_up_down(a, b)
        .then_with(|| status_segment_cmp(a, b))
        .then_with(|| a.wrap_delta.cmp(&b.wrap_delta))
        .then_with(|| a.key.cmp(&b.key))
}

fn start_segment_cmp(a: &SweepEvent, b: &SweepEvent) -> Ordering {
    compare_float(fix_zero(event_slope(a) - event_slope(b))).then_with(|| {
        let a_type = a
            .segment
            .as_ref()
            .map(|s| s.segment_type as i32)
            .unwrap_or(0);
        let b_type = b
            .segment
            .as_ref()
            .map(|s| s.segment_type as i32)
            .unwrap_or(0);
        a_type.cmp(&b_type)
    })
}

fn status_segment_cmp(a: &StatusKey, b: &StatusKey) -> Ordering {
    compare_float(fix_zero(status_event_slope(a) - status_event_slope(b)))
        .then_with(|| (a.segment.segment_type as i32).cmp(&(b.segment.segment_type as i32)))
}

fn compare_up_down(a: &StatusKey, b: &StatusKey) -> Ordering {
    let ax = a.point.x;
    let bx = b.point.x;
    if is_almost_zero(ax - bx, EPSILON) {
        return compare_float(fix_zero(a.point.y - b.point.y));
    }
    if ax < bx {
        compare_float(fix_zero(status_event_slope(a) - slope(a.point, b.point)))
    } else {
        compare_float(fix_zero(slope(a.point, b.point) - status_event_slope(b)))
    }
}

fn event_slope(event: &SweepEvent) -> f64 {
    slope(event.point, event.other_point)
}

fn status_event_slope(event: &StatusKey) -> f64 {
    slope(event.point, event.other_point)
}

fn slope(p1: PathPoint, p2: PathPoint) -> f64 {
    let dx = p1.x - p2.x;
    if is_almost_zero(dx, EPSILON) {
        f64::INFINITY
    } else {
        (p1.y - p2.y) / dx
    }
}

fn float_xy_cmp(a: &PathPoint, b: &PathPoint) -> Ordering {
    compare_float(fix_zero(a.x - b.x)).then_with(|| compare_float(fix_zero(a.y - b.y)))
}

fn compare_float(value: f64) -> Ordering {
    if value < 0.0 {
        Ordering::Less
    } else if value > 0.0 {
        Ordering::Greater
    } else {
        Ordering::Equal
    }
}
