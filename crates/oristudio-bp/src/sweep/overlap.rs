use super::{CreaseType, EventKind, LineSegment, compare_float, float_xy_cmp};
use crate::math::geometry::{EPSILON, PathPoint, epsilon_same, fix_zero, is_almost_zero};
use std::cmp::Ordering;

const RELAXED_EPSILON: f64 = 1e-9;

#[derive(Debug, Clone, Default)]
pub struct Overlap;

impl Overlap {
    pub fn test(paths: &[Vec<PathPoint>]) -> bool {
        overlap_test(paths)
    }
}

pub fn overlap_test(paths: &[Vec<PathPoint>]) -> bool {
    if paths.len() < 2 {
        return false;
    }
    OverlapSweep::new(paths).test()
}

#[derive(Debug, Clone)]
struct OverlapEvent {
    key: usize,
    point: PathPoint,
    kind: EventKind,
    segment: Option<usize>,
    wrap_delta: i8,
    wrap_count: i32,
    is_inside: bool,
    other: usize,
}

#[derive(Debug, Default)]
struct EventQueue {
    ids: Vec<usize>,
}

impl EventQueue {
    fn insert(&mut self, id: usize) {
        self.ids.push(id);
    }

    fn pop(&mut self, events: &[OverlapEvent], segments: &[LineSegment]) -> Option<usize> {
        let mut best = 0;
        for index in 1..self.ids.len() {
            if event_cmp(events, segments, self.ids[index], self.ids[best]).is_lt() {
                best = index;
            }
        }
        if self.ids.is_empty() {
            None
        } else {
            Some(self.ids.swap_remove(best))
        }
    }

    fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }
}

#[derive(Debug, Default)]
struct Status {
    ids: Vec<usize>,
}

impl Status {
    fn insert(&mut self, id: usize, events: &[OverlapEvent], segments: &[LineSegment]) {
        if !self.ids.contains(&id) {
            self.ids.push(id);
        }
        self.sort(events, segments);
    }

    fn delete(&mut self, id: usize) {
        self.ids.retain(|candidate| *candidate != id);
    }

    fn get_prev(
        &mut self,
        id: usize,
        events: &[OverlapEvent],
        segments: &[LineSegment],
    ) -> Option<usize> {
        self.sort(events, segments);
        let position = self.ids.iter().position(|candidate| *candidate == id)?;
        position
            .checked_sub(1)
            .and_then(|prev| self.ids.get(prev).copied())
    }

    fn get_next(
        &mut self,
        id: usize,
        events: &[OverlapEvent],
        segments: &[LineSegment],
    ) -> Option<usize> {
        self.sort(events, segments);
        let position = self.ids.iter().position(|candidate| *candidate == id)?;
        self.ids.get(position + 1).copied()
    }

    fn sort(&mut self, events: &[OverlapEvent], segments: &[LineSegment]) {
        self.ids
            .sort_by(|a, b| status_cmp(events, segments, *a, *b));
    }
}

struct OverlapSweep {
    events: Vec<OverlapEvent>,
    segments: Vec<LineSegment>,
    queue: EventQueue,
    status: Status,
    current_start: Option<usize>,
    event_inserted: bool,
    collected: usize,
    found: bool,
}

impl OverlapSweep {
    fn new(paths: &[Vec<PathPoint>]) -> Self {
        let mut sweep = Self {
            events: Vec::new(),
            segments: Vec::new(),
            queue: EventQueue::default(),
            status: Status::default(),
            current_start: None,
            event_inserted: false,
            collected: 0,
            found: false,
        };
        for (polygon, path) in paths.iter().enumerate() {
            let len = path.len();
            if len == 0 {
                continue;
            }
            let mut j = len - 1;
            for i in 0..len {
                let p1 = path[j];
                let p2 = path[i];
                let segment = LineSegment::new(p1, p2, polygon);
                let delta = if float_xy_cmp(&p1, &p2).is_lt() {
                    -1
                } else {
                    1
                };
                sweep.add_segment_compare_orientation(segment, delta);
                j = i;
            }
        }
        sweep
    }

    fn test(&mut self) -> bool {
        while !self.queue.is_empty() {
            let Some(event) = self.queue.pop(&self.events, &self.segments) else {
                break;
            };
            if self.events[event].kind == EventKind::Start {
                self.process_start(event);
            } else {
                self.process_end(event);
            }
            if self.collected > 1 || self.found {
                return true;
            }
        }
        false
    }

    fn add_segment_compare_orientation(&mut self, segment: LineSegment, delta: i8) {
        if segment.start == segment.end {
            return;
        }
        let oriented = float_xy_cmp(&segment.start, &segment.end).is_lt();
        let (start_point, end_point) = if oriented {
            (segment.start, segment.end)
        } else {
            (segment.end, segment.start)
        };
        let segment_id = self.segments.len();
        self.segments.push(segment);

        let start_id = self.events.len();
        let end_id = start_id + 1;
        self.events.push(OverlapEvent {
            key: start_id,
            point: start_point,
            kind: EventKind::Start,
            segment: Some(segment_id),
            wrap_delta: delta,
            wrap_count: i32::from(delta),
            is_inside: false,
            other: end_id,
        });
        self.events.push(OverlapEvent {
            key: end_id,
            point: end_point,
            kind: EventKind::End,
            segment: None,
            wrap_delta: 0,
            wrap_count: 0,
            is_inside: false,
            other: start_id,
        });
        self.queue.insert(start_id);
        self.queue.insert(end_id);
    }

    fn process_start(&mut self, event: usize) {
        self.status.insert(event, &self.events, &self.segments);
        let prev = self.status.get_prev(event, &self.events, &self.segments);
        let next = self.status.get_next(event, &self.events, &self.segments);

        self.current_start = Some(event);
        self.event_inserted = false;
        self.possible_intersection(prev, Some(event));
        self.possible_intersection(Some(event), next);

        if self.event_inserted {
            self.queue.insert(event);
        } else {
            self.set_inside_flag(event, prev);
        }
    }

    fn process_end(&mut self, event: usize) {
        let start = self.events[event].other;
        let prev = self.status.get_prev(start, &self.events, &self.segments);
        let next = self.status.get_next(start, &self.events, &self.segments);
        self.status.delete(start);
        self.possible_intersection(prev, next);
        if self.events[start].is_inside {
            self.collected += 1;
        }
    }

    fn set_inside_flag(&mut self, event: usize, prev: Option<usize>) {
        let Some(prev) = prev else {
            return;
        };
        if self.events[prev].wrap_count != 0 {
            self.events[event].wrap_count += self.events[prev].wrap_count;
            self.events[event].is_inside = self.events[event].wrap_count != 0;
        }
    }

    fn possible_intersection(&mut self, ev1: Option<usize>, ev2: Option<usize>) {
        let (Some(ev1), Some(ev2)) = (ev1, ev2) else {
            return;
        };
        let (Some(seg1), Some(seg2)) = (self.events[ev1].segment, self.events[ev2].segment) else {
            return;
        };
        if self.segments[seg1].polygon == self.segments[seg2].polygon {
            return;
        }

        let [a1, b1, c1] = self.segments[seg1].coefficients;
        let [a2, b2, c2] = self.segments[seg2].coefficients;
        let det_ab = a1 * b2 - a2 * b1;
        let det_bc = b1 * c2 - b2 * c1;
        if is_almost_zero(det_ab, EPSILON) {
            if !is_almost_zero(det_bc, RELAXED_EPSILON) {
                return;
            }
            let p2 = self.events[self.events[ev1].other].point;
            let p3 = self.events[ev2].point;
            let p4 = self.events[self.events[ev2].other].point;
            let mut ev1 = ev1;
            if self.segments[seg1].contains_pt_on_line(p3, false) {
                ev1 = self.subdivide(ev1, p3);
            }
            if self.segments[seg1].contains_pt_on_line(p4, false) {
                self.subdivide(ev1, p4);
            }
            if self.segments[seg2].contains_pt_on_line(p2, false) {
                self.subdivide(ev2, p2);
            }
        } else {
            let point = PathPoint::new(det_bc / det_ab, (a2 * c1 - a1 * c2) / det_ab);
            if self.segments[seg1].contains_pt_on_line(point, false)
                && self.segments[seg2].contains_pt_on_line(point, false)
            {
                self.found = true;
            }
        }
    }

    fn subdivide(&mut self, event: usize, point: PathPoint) -> usize {
        let other = self.events[event].other;
        if epsilon_same(
            (point.x, point.y),
            (self.events[event].point.x, self.events[event].point.y),
            RELAXED_EPSILON,
        ) || epsilon_same(
            (point.x, point.y),
            (self.events[other].point.x, self.events[other].point.y),
            RELAXED_EPSILON,
        ) {
            return event;
        }

        let Some(segment) = self.events[event].segment else {
            return event;
        };
        let oriented = self.events[event].point == self.segments[segment].start;
        let new_segment = self.segments[segment].subdivide(point, oriented);
        let new_segment_id = self.segments.len();
        self.segments.push(new_segment);

        let new_start = self.events.len();
        self.events.push(OverlapEvent {
            key: new_start,
            point,
            kind: EventKind::Start,
            segment: Some(new_segment_id),
            wrap_delta: self.events[event].wrap_delta,
            wrap_count: i32::from(self.events[event].wrap_delta),
            is_inside: false,
            other,
        });
        self.events[other].other = new_start;
        self.queue.insert(new_start);

        let new_end = self.events.len();
        self.events.push(OverlapEvent {
            key: new_end,
            point,
            kind: EventKind::End,
            segment: None,
            wrap_delta: 0,
            wrap_count: 0,
            is_inside: false,
            other: event,
        });
        self.events[event].other = new_end;
        self.queue.insert(new_end);

        if self.current_start != Some(event) && !self.event_inserted {
            self.event_inserted = self.current_start.is_some_and(|current| {
                event_cmp(&self.events, &self.segments, current, new_start).is_gt()
                    || event_cmp(&self.events, &self.segments, current, new_end).is_gt()
            });
        }

        new_start
    }
}

fn event_cmp(events: &[OverlapEvent], segments: &[LineSegment], a: usize, b: usize) -> Ordering {
    let a_event = &events[a];
    let b_event = &events[b];
    float_xy_cmp(&a_event.point, &b_event.point)
        .then_with(|| (a_event.kind as u8).cmp(&(b_event.kind as u8)))
        .then_with(|| {
            if a_event.kind == EventKind::Start && b_event.kind == EventKind::Start {
                segment_cmp(events, segments, a, b)
                    .then_with(|| a_event.wrap_delta.cmp(&b_event.wrap_delta))
            } else {
                Ordering::Equal
            }
        })
        .then_with(|| a_event.key.cmp(&b_event.key))
}

fn status_cmp(events: &[OverlapEvent], segments: &[LineSegment], a: usize, b: usize) -> Ordering {
    compare_up_down(events, a, b)
        .then_with(|| segment_cmp(events, segments, a, b))
        .then_with(|| events[a].wrap_delta.cmp(&events[b].wrap_delta))
        .then_with(|| events[a].key.cmp(&events[b].key))
}

fn segment_cmp(events: &[OverlapEvent], segments: &[LineSegment], a: usize, b: usize) -> Ordering {
    compare_float(fix_zero(event_slope(events, a) - event_slope(events, b))).then_with(|| {
        let a_type = events[a]
            .segment
            .map(|segment| segments[segment].segment_type as i32)
            .unwrap_or(CreaseType::None as i32);
        let b_type = events[b]
            .segment
            .map(|segment| segments[segment].segment_type as i32)
            .unwrap_or(CreaseType::None as i32);
        a_type.cmp(&b_type)
    })
}

fn compare_up_down(events: &[OverlapEvent], a: usize, b: usize) -> Ordering {
    let a_event = &events[a];
    let b_event = &events[b];
    let ax = a_event.point.x;
    let bx = b_event.point.x;
    if is_almost_zero(ax - bx, EPSILON) {
        return compare_float(fix_zero(a_event.point.y - b_event.point.y));
    }
    if ax < bx {
        compare_float(fix_zero(
            event_slope(events, a) - point_slope(a_event.point, b_event.point),
        ))
    } else {
        compare_float(fix_zero(
            point_slope(a_event.point, b_event.point) - event_slope(events, b),
        ))
    }
}

fn event_slope(events: &[OverlapEvent], event: usize) -> f64 {
    point_slope(events[event].point, events[events[event].other].point)
}

fn point_slope(p1: PathPoint, p2: PathPoint) -> f64 {
    let dx = p1.x - p2.x;
    if is_almost_zero(dx, EPSILON) {
        f64::INFINITY
    } else {
        (p1.y - p2.y) / dx
    }
}
