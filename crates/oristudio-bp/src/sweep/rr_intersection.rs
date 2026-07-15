use super::EventKind;
use crate::math::geometry::{EPSILON, PathPoint, epsilon_same, fix_zero};
use std::cmp::Ordering;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RoundedRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub radius: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ArcPoint {
    pub point: PathPoint,
    pub arc: Option<PathPoint>,
    pub radius: Option<f64>,
}

impl ArcPoint {
    fn new(point: PathPoint) -> Self {
        Self {
            point,
            arc: None,
            radius: None,
        }
    }
}

pub type ArcPath = Vec<ArcPoint>;

#[derive(Debug, Clone, Default)]
pub struct RrIntersection;

impl RrIntersection {
    pub fn new() -> Self {
        Self
    }

    pub fn get(&mut self, components: &[RoundedRect]) -> Vec<ArcPath> {
        rr_intersection(components)
    }
}

pub fn rr_intersection(components: &[RoundedRect]) -> Vec<ArcPath> {
    RrIntersectionSweep::new(components).get()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SegmentType {
    AaLine = 1,
    Arc = 2,
}

#[derive(Debug, Clone)]
enum RrSegment {
    AaLine(AaLineSegment),
    Arc(ArcSegment),
}

impl RrSegment {
    fn segment_type(&self) -> SegmentType {
        match self {
            RrSegment::AaLine(_) => SegmentType::AaLine,
            RrSegment::Arc(_) => SegmentType::Arc,
        }
    }

    fn polygon(&self) -> usize {
        match self {
            RrSegment::AaLine(segment) => segment.polygon,
            RrSegment::Arc(segment) => segment.polygon,
        }
    }

    fn start(&self) -> PathPoint {
        match self {
            RrSegment::AaLine(segment) => segment.start,
            RrSegment::Arc(segment) => segment.start,
        }
    }

    fn end(&self) -> PathPoint {
        match self {
            RrSegment::AaLine(segment) => segment.end,
            RrSegment::Arc(segment) => segment.end,
        }
    }

    fn subdivide(&mut self, point: PathPoint, oriented: bool) -> Self {
        match self {
            RrSegment::AaLine(segment) => RrSegment::AaLine(segment.subdivide(point, oriented)),
            RrSegment::Arc(segment) => RrSegment::Arc(segment.subdivide(point, oriented)),
        }
    }
}

#[derive(Debug, Clone)]
struct AaLineSegment {
    polygon: usize,
    start: PathPoint,
    end: PathPoint,
    is_horizontal: bool,
}

impl AaLineSegment {
    fn new(start: PathPoint, end: PathPoint, polygon: usize) -> Self {
        Self {
            polygon,
            start,
            end,
            is_horizontal: start.y == end.y,
        }
    }

    fn subdivide(&mut self, point: PathPoint, oriented: bool) -> Self {
        if oriented {
            let new_segment = AaLineSegment::new(point, self.end, self.polygon);
            self.end = point;
            new_segment
        } else {
            let new_segment = AaLineSegment::new(self.start, point, self.polygon);
            self.start = point;
            new_segment
        }
    }
}

#[derive(Debug, Clone)]
struct ArcSegment {
    polygon: usize,
    center: PathPoint,
    radius: f64,
    start: PathPoint,
    end: PathPoint,
    out: PathPoint,
    delta: PathPoint,
    anchor: PathPoint,
}

impl ArcSegment {
    fn new(
        center: PathPoint,
        radius: f64,
        start: PathPoint,
        end: PathPoint,
        polygon: usize,
    ) -> Self {
        let mut segment = Self {
            polygon,
            center,
            radius,
            start,
            end,
            out: PathPoint::new(0.0, 0.0),
            delta: PathPoint::new(0.0, 0.0),
            anchor: PathPoint::new(0.0, 0.0),
        };
        segment.update();
        segment
    }

    fn subdivide(&mut self, point: PathPoint, oriented: bool) -> Self {
        if oriented {
            let new_segment =
                ArcSegment::new(self.center, self.radius, point, self.end, self.polygon);
            self.end = point;
            self.update();
            new_segment
        } else {
            let new_segment =
                ArcSegment::new(self.center, self.radius, self.start, point, self.polygon);
            self.start = point;
            self.update();
            new_segment
        }
    }

    fn intersections(&self, that: &ArcSegment) -> Vec<PathPoint> {
        let x1 = self.center.x;
        let y1 = self.center.y;
        let r1 = self.radius;
        let x2 = that.center.x;
        let y2 = that.center.y;
        let r2 = that.radius;
        let dx = x1 - x2;
        let dy = y1 - y2;
        if dx == 0.0 && dy == 0.0 {
            return Vec::new();
        }
        let r = r1 + r2;
        let ds = dx * dx + dy * dy;
        if ds > r * r {
            return Vec::new();
        }

        let d = ds.sqrt();
        let l = (r1 * r1 - r2 * r2 + ds) / d / 2.0;
        if l > r1 {
            return Vec::new();
        }

        let h = leg(r1, l);
        if h == 0.0 {
            vec![PathPoint::new(x1 - dx * l / d, y1 - dy * l / d)]
        } else {
            let mut result = vec![
                PathPoint::new(x1 - (dx * l + dy * h) / d, y1 - (dy * l - dx * h) / d),
                PathPoint::new(x1 - (dx * l - dy * h) / d, y1 - (dy * l + dx * h) / d),
            ];
            result.sort_by(|a, b| xy_cmp(*a, *b));
            result
        }
    }

    fn in_arc_range(&self, point: PathPoint) -> f64 {
        if (point.x - self.center.x) * self.out.x + (point.y - self.center.y) * self.out.y <= 0.0 {
            return 1.0;
        }

        let x = self.delta.x;
        let y = self.delta.y;
        let weight =
            ((point.x - self.start.x) * x + (point.y - self.start.y) * y) / (x * x + y * y);
        weight * (weight - 1.0)
    }

    fn update(&mut self) {
        let end = self.end;
        let start = self.start;
        let center = self.center;
        self.delta = PathPoint::new(end.x - start.x, end.y - start.y);
        let mut r = (end.y - start.y) / (start.x + end.x - 2.0 * center.x);
        r = 1.0 + r * r;
        self.out = PathPoint::new(
            ((end.x + start.x) / 2.0 - center.x) * r,
            ((end.y + start.y) / 2.0 - center.y) * r,
        );
        self.anchor = PathPoint::new(center.x + self.out.x, center.y + self.out.y);
    }
}

#[derive(Debug, Clone)]
struct RrEvent {
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

    fn pop(&mut self, events: &[RrEvent], segments: &[RrSegment]) -> Option<usize> {
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
    fn insert(&mut self, id: usize, events: &[RrEvent], segments: &[RrSegment]) {
        if !self.ids.contains(&id) {
            self.ids.push(id);
        }
        self.sort(events, segments);
    }

    fn delete(&mut self, id: usize) {
        self.ids.retain(|candidate| *candidate != id);
    }

    fn get_prev(&mut self, id: usize, events: &[RrEvent], segments: &[RrSegment]) -> Option<usize> {
        self.sort(events, segments);
        let position = self.ids.iter().position(|candidate| *candidate == id)?;
        position
            .checked_sub(1)
            .and_then(|prev| self.ids.get(prev).copied())
    }

    fn get_next(&mut self, id: usize, events: &[RrEvent], segments: &[RrSegment]) -> Option<usize> {
        self.sort(events, segments);
        let position = self.ids.iter().position(|candidate| *candidate == id)?;
        self.ids.get(position + 1).copied()
    }

    fn sort(&mut self, events: &[RrEvent], segments: &[RrSegment]) {
        self.ids
            .sort_by(|a, b| status_cmp(events, segments, *a, *b));
    }
}

struct RrIntersectionSweep {
    events: Vec<RrEvent>,
    segments: Vec<RrSegment>,
    queue: EventQueue,
    status: Status,
    current_start: Option<usize>,
    event_inserted: bool,
    collected: Vec<usize>,
}

impl RrIntersectionSweep {
    fn new(components: &[RoundedRect]) -> Self {
        let mut sweep = Self {
            events: Vec::new(),
            segments: Vec::new(),
            queue: EventQueue::default(),
            status: Status::default(),
            current_start: None,
            event_inserted: false,
            collected: Vec::new(),
        };
        for (polygon, component) in components.iter().enumerate() {
            let x = component.x;
            let y = component.y;
            let width = component.width;
            let height = component.height;
            let radius = component.radius;

            sweep.add_segment_delta_orientation(
                RrSegment::Arc(ArcSegment::new(
                    PathPoint::new(x, y),
                    radius,
                    PathPoint::new(x - radius, y),
                    PathPoint::new(x, y - radius),
                    polygon,
                )),
                1,
            );
            sweep.add_segment_delta_orientation(
                RrSegment::Arc(ArcSegment::new(
                    PathPoint::new(x + width, y),
                    radius,
                    PathPoint::new(x + width, y - radius),
                    PathPoint::new(x + width + radius, y),
                    polygon,
                )),
                1,
            );
            sweep.add_segment_delta_orientation(
                RrSegment::Arc(ArcSegment::new(
                    PathPoint::new(x + width, y + height),
                    radius,
                    PathPoint::new(x + width + radius, y + height),
                    PathPoint::new(x + width, y + height + radius),
                    polygon,
                )),
                -1,
            );
            sweep.add_segment_delta_orientation(
                RrSegment::Arc(ArcSegment::new(
                    PathPoint::new(x, y + height),
                    radius,
                    PathPoint::new(x, y + height + radius),
                    PathPoint::new(x - radius, y + height),
                    polygon,
                )),
                -1,
            );

            if width != 0.0 {
                sweep.add_segment_delta_orientation(
                    RrSegment::AaLine(AaLineSegment::new(
                        PathPoint::new(x, y - radius),
                        PathPoint::new(x + width, y - radius),
                        polygon,
                    )),
                    1,
                );
                sweep.add_segment_delta_orientation(
                    RrSegment::AaLine(AaLineSegment::new(
                        PathPoint::new(x + width, y + height + radius),
                        PathPoint::new(x, y + height + radius),
                        polygon,
                    )),
                    -1,
                );
            }
            if height != 0.0 {
                sweep.add_segment_delta_orientation(
                    RrSegment::AaLine(AaLineSegment::new(
                        PathPoint::new(x + width + radius, y),
                        PathPoint::new(x + width + radius, y + height),
                        polygon,
                    )),
                    1,
                );
                sweep.add_segment_delta_orientation(
                    RrSegment::AaLine(AaLineSegment::new(
                        PathPoint::new(x - radius, y + height),
                        PathPoint::new(x - radius, y),
                        polygon,
                    )),
                    -1,
                );
            }
        }
        sweep
    }

    fn get(mut self) -> Vec<ArcPath> {
        while !self.queue.is_empty() {
            let Some(event) = self.queue.pop(&self.events, &self.segments) else {
                break;
            };
            if self.events[event].kind == EventKind::Start {
                self.process_start(event);
            } else {
                self.process_end(event);
            }
        }
        chain_segments(&self.collected, &self.segments)
    }

    fn add_segment_delta_orientation(&mut self, segment: RrSegment, delta: i8) {
        if segment.start() == segment.end() {
            return;
        }
        let (start_point, end_point) = if delta == 1 {
            (segment.start(), segment.end())
        } else {
            (segment.end(), segment.start())
        };
        let segment_id = self.segments.len();
        self.segments.push(segment);

        let start_id = self.events.len();
        let end_id = start_id + 1;
        self.events.push(RrEvent {
            key: start_id,
            point: start_point,
            kind: EventKind::Start,
            segment: Some(segment_id),
            wrap_delta: delta,
            wrap_count: i32::from(delta),
            is_inside: false,
            other: end_id,
        });
        self.events.push(RrEvent {
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
        self.status.delete(start);
        if self.events[start].is_inside
            && let Some(segment) = self.events[start].segment
        {
            self.collected.push(segment);
        }
    }

    fn set_inside_flag(&mut self, event: usize, prev: Option<usize>) {
        if let Some(prev) = prev
            && self.events[prev].wrap_count != 0
        {
            self.events[event].wrap_count += self.events[prev].wrap_count;
            self.events[event].is_inside = self.events[event].wrap_count != 0;
        }
    }

    fn possible_intersection(&mut self, ev1: Option<usize>, ev2: Option<usize>) {
        let (Some(ev1), Some(ev2)) = (ev1, ev2) else {
            return;
        };
        let (Some(seg1_id), Some(seg2_id)) = (self.events[ev1].segment, self.events[ev2].segment)
        else {
            return;
        };
        if self.segments[seg1_id].polygon() == self.segments[seg2_id].polygon() {
            return;
        }

        match (
            self.segments[seg1_id].segment_type(),
            self.segments[seg2_id].segment_type(),
        ) {
            (SegmentType::AaLine, SegmentType::AaLine) => {
                self.process_aa_line_segments(ev1, ev2);
            }
            (SegmentType::Arc, SegmentType::Arc) => {
                self.process_arc_segments(ev1, ev2);
            }
            (SegmentType::AaLine, SegmentType::Arc) => {
                self.process_arc_vs_aa_line(ev2, ev1);
            }
            (SegmentType::Arc, SegmentType::AaLine) => {
                self.process_arc_vs_aa_line(ev1, ev2);
            }
        }
    }

    fn process_aa_line_segments(&mut self, ev1: usize, ev2: usize) {
        let (Some(seg1), Some(seg2)) = (self.aa_line_segment(ev1), self.aa_line_segment(ev2))
        else {
            return;
        };
        if seg1.is_horizontal != seg2.is_horizontal {
            let (h, v) = if seg1.is_horizontal {
                (ev1, ev2)
            } else {
                (ev2, ev1)
            };
            let x = self.events[v].point.x;
            let y = self.events[h].point.y;
            let hx1 = self.events[h].point.x;
            let hx2 = self.events[self.events[h].other].point.x;
            let vy1 = self.events[v].point.y;
            let vy2 = self.events[self.events[v].other].point.y;
            let point = PathPoint::new(x, y);
            if hx1 < x && x < hx2 && vy1 <= y && y <= vy2 {
                self.subdivide(h, point);
            }
            if vy1 < y && y < vy2 && hx1 <= x && x <= hx2 {
                self.subdivide(v, point);
            }
        } else {
            self.process_overlap(ev1, ev2, seg1.is_horizontal);
        }
    }

    fn process_overlap(&mut self, ev1: usize, ev2: usize, is_horizontal: bool) {
        let x1 = self.events[ev1].point.x;
        let y1 = self.events[ev1].point.y;
        let p2 = self.events[self.events[ev1].other].point;
        let x2 = p2.x;
        let y2 = p2.y;
        let p3 = self.events[ev2].point;
        let x3 = p3.x;
        let y3 = p3.y;
        let p4 = self.events[self.events[ev2].other].point;
        let x4 = p4.x;
        let y4 = p4.y;

        let mut ev1 = ev1;
        if is_horizontal && y1 == y3 {
            if x1 < x3 && x3 < x2 {
                ev1 = self.subdivide(ev1, p3);
            }
            if x1 < x4 && x4 < x2 {
                self.subdivide(ev1, p4);
            } else if x3 < x2 && x2 < x4 {
                self.subdivide(ev2, p2);
            }
        } else if !is_horizontal && x1 == x3 {
            if y1 < y3 && y3 < y2 {
                ev1 = self.subdivide(ev1, p3);
            }
            if y1 < y4 && y4 < y2 {
                self.subdivide(ev1, p4);
            } else if y3 < y2 && y2 < y4 {
                self.subdivide(ev2, p2);
            }
        }
    }

    fn process_arc_segments(&mut self, ev1: usize, ev2: usize) {
        let (Some(seg1), Some(seg2)) = (self.arc_segment(ev1), self.arc_segment(ev2)) else {
            return;
        };
        let intersections = seg1.intersections(&seg2);
        let mut ev1 = ev1;
        let mut ev2 = ev2;
        for point in intersections {
            let (Some(seg1), Some(seg2)) = (self.arc_segment(ev1), self.arc_segment(ev2)) else {
                return;
            };
            let point = ref_point(
                ref_point(point, &RrSegment::Arc(seg1.clone())),
                &RrSegment::Arc(seg2.clone()),
            );
            let in1 = seg1.in_arc_range(point);
            let in2 = seg2.in_arc_range(point);
            if in1 < -EPSILON && in2 < EPSILON {
                ev1 = self.subdivide(ev1, point);
            }
            if in1 < EPSILON && in2 < -EPSILON {
                ev2 = self.subdivide(ev2, point);
            }
        }
    }

    fn process_arc_vs_aa_line(&mut self, arc_event: usize, line_event: usize) {
        let (Some(arc), Some(line)) = (
            self.arc_segment(arc_event),
            self.aa_line_segment(line_event),
        ) else {
            return;
        };

        if line.is_horizontal {
            let y = line.start.y;
            let da = (y - arc.start.y) * (y - arc.end.y);
            if da > EPSILON {
                return;
            }
            let dy = y - arc.center.y;
            let dx = leg(arc.radius, dy);
            let x = arc.center.x + if arc.start.y > arc.end.y { -dx } else { dx };
            let point = ref_point(
                ref_point(PathPoint::new(x, y), &RrSegment::AaLine(line.clone())),
                &RrSegment::Arc(arc.clone()),
            );
            let dl = (x - self.events[line_event].point.x)
                * (x - self.events[self.events[line_event].other].point.x);
            if da < -EPSILON && dl < EPSILON {
                self.subdivide(arc_event, point);
            }
            if da < EPSILON && dl < -EPSILON {
                self.subdivide(line_event, point);
            }
        } else {
            let x = line.start.x;
            let da = (x - arc.start.x) * (x - arc.end.x);
            if da > EPSILON {
                return;
            }
            let y = y_intercept(&arc, x);
            let point = ref_point(
                ref_point(PathPoint::new(x, y), &RrSegment::AaLine(line.clone())),
                &RrSegment::Arc(arc.clone()),
            );
            let dl = (y - self.events[line_event].point.y)
                * (y - self.events[self.events[line_event].other].point.y);
            if da < -EPSILON && dl < EPSILON {
                self.subdivide(arc_event, point);
            }
            if da < EPSILON && dl < -EPSILON {
                self.subdivide(line_event, point);
            }
        }
    }

    fn subdivide(&mut self, event: usize, point: PathPoint) -> usize {
        let Some(segment) = self.events[event].segment else {
            return event;
        };
        let oriented = self.events[event].point == self.segments[segment].start();
        let new_segment = self.segments[segment].subdivide(point, oriented);
        let new_segment_id = self.segments.len();
        self.segments.push(new_segment);

        let old_end = self.events[event].other;
        let new_start = self.events.len();
        self.events.push(RrEvent {
            key: new_start,
            point,
            kind: EventKind::Start,
            segment: Some(new_segment_id),
            wrap_delta: self.events[event].wrap_delta,
            wrap_count: i32::from(self.events[event].wrap_delta),
            is_inside: false,
            other: old_end,
        });
        self.events[old_end].other = new_start;
        self.queue.insert(new_start);

        let new_end = self.events.len();
        self.events.push(RrEvent {
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

    fn aa_line_segment(&self, event: usize) -> Option<AaLineSegment> {
        let segment_id = self.events[event].segment?;
        match &self.segments[segment_id] {
            RrSegment::AaLine(segment) => Some(segment.clone()),
            RrSegment::Arc(_) => None,
        }
    }

    fn arc_segment(&self, event: usize) -> Option<ArcSegment> {
        let segment_id = self.events[event].segment?;
        match &self.segments[segment_id] {
            RrSegment::Arc(segment) => Some(segment.clone()),
            RrSegment::AaLine(_) => None,
        }
    }
}

fn event_cmp(events: &[RrEvent], segments: &[RrSegment], a: usize, b: usize) -> Ordering {
    let a_event = &events[a];
    let b_event = &events[b];
    xy_cmp(a_event.point, b_event.point)
        .then_with(|| (a_event.kind as u8).cmp(&(b_event.kind as u8)))
        .then_with(|| {
            if a_event.kind == EventKind::Start && b_event.kind == EventKind::Start {
                segment_cmp(events, segments, a, b)
            } else {
                Ordering::Equal
            }
        })
        .then_with(|| a_event.key.cmp(&b_event.key))
}

fn status_cmp(events: &[RrEvent], segments: &[RrSegment], a: usize, b: usize) -> Ordering {
    status_y_cmp(events, segments, a, b)
        .then_with(|| segment_cmp(events, segments, a, b))
        .then_with(|| events[a].key.cmp(&events[b].key))
}

fn segment_cmp(events: &[RrEvent], segments: &[RrSegment], a: usize, b: usize) -> Ordering {
    compare_float(fix_zero(
        event_slope(events, segments, a) - event_slope(events, segments, b),
    ))
    .then_with(|| {
        compare_float(get_curvature(events, segments, a) - get_curvature(events, segments, b))
    })
    .then_with(|| events[a].wrap_delta.cmp(&events[b].wrap_delta))
}

fn status_y_cmp(events: &[RrEvent], segments: &[RrSegment], a: usize, b: usize) -> Ordering {
    let a_event = &events[a];
    let b_event = &events[b];
    let Some(a_segment) = a_event.segment.map(|id| &segments[id]) else {
        return Ordering::Equal;
    };
    let Some(b_segment) = b_event.segment.map(|id| &segments[id]) else {
        return Ordering::Equal;
    };

    let value = if a_event.point.x < b_event.point.x && a_segment.segment_type() == SegmentType::Arc
    {
        match a_segment {
            RrSegment::Arc(arc) => y_intercept(arc, b_event.point.x) - b_event.point.y,
            RrSegment::AaLine(_) => 0.0,
        }
    } else if b_event.point.x < a_event.point.x && b_segment.segment_type() == SegmentType::Arc {
        match b_segment {
            RrSegment::Arc(arc) => a_event.point.y - y_intercept(arc, a_event.point.x),
            RrSegment::AaLine(_) => 0.0,
        }
    } else {
        a_event.point.y - b_event.point.y
    };
    compare_float(value)
}

fn event_slope(events: &[RrEvent], segments: &[RrSegment], event: usize) -> f64 {
    let Some(segment) = events[event].segment.map(|id| &segments[id]) else {
        return 0.0;
    };
    match segment {
        RrSegment::AaLine(line) => {
            if line.is_horizontal {
                0.0
            } else {
                f64::INFINITY
            }
        }
        RrSegment::Arc(arc) => {
            let dx = arc.anchor.x - events[event].point.x;
            let dy = arc.anchor.y - events[event].point.y;
            if dx > EPSILON {
                dy / dx
            } else if dy > 0.0 {
                f64::INFINITY
            } else {
                f64::NEG_INFINITY
            }
        }
    }
}

fn get_curvature(events: &[RrEvent], segments: &[RrSegment], event: usize) -> f64 {
    let Some(segment) = events[event].segment.map(|id| &segments[id]) else {
        return 0.0;
    };
    match segment {
        RrSegment::AaLine(_) => 0.0,
        RrSegment::Arc(arc) => {
            let sign = if events[event].point == arc.start {
                1.0
            } else {
                -1.0
            };
            sign / arc.radius
        }
    }
}

fn y_intercept(arc: &ArcSegment, x: f64) -> f64 {
    let dx = x - arc.center.x;
    let dy = leg(arc.radius, dx);
    arc.center.y + if arc.start.x > arc.end.x { dy } else { -dy }
}

fn ref_point(point: PathPoint, segment: &RrSegment) -> PathPoint {
    if epsilon_same(
        (point.x, point.y),
        (segment.start().x, segment.start().y),
        EPSILON,
    ) {
        return segment.start();
    }
    if epsilon_same(
        (point.x, point.y),
        (segment.end().x, segment.end().y),
        EPSILON,
    ) {
        return segment.end();
    }
    point
}

fn leg(c: f64, b: f64) -> f64 {
    (c * c - b * b).sqrt()
}

fn xy_cmp(a: PathPoint, b: PathPoint) -> Ordering {
    compare_float(a.x - b.x).then_with(|| compare_float(a.y - b.y))
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

#[derive(Debug, Clone)]
struct Chain {
    points: ArcPath,
}

fn chain_segments(segment_ids: &[usize], segments: &[RrSegment]) -> Vec<ArcPath> {
    let mut chains: Vec<Chain> = Vec::new();
    let mut result = Vec::new();
    for segment in segment_ids.iter().map(|id| &segments[*id]) {
        let tail = chains.iter().position(|chain| {
            chain
                .points
                .first()
                .is_some_and(|p| p.point == segment.end())
        });
        let head = chains.iter().position(|chain| {
            chain
                .points
                .last()
                .is_some_and(|p| p.point == segment.start())
        });

        match (head, tail) {
            (Some(head), Some(tail)) if head == tail => {
                let mut chain = chains.swap_remove(head);
                set_arc_segment(&mut chain.points[0], segment);
                result.push(chain.points);
            }
            (Some(head), Some(tail)) => {
                let mut tail_chain = chains.swap_remove(tail);
                set_arc_segment(&mut tail_chain.points[0], segment);
                let head_index = if tail < head { head - 1 } else { head };
                chains[head_index].points.extend(tail_chain.points);
            }
            (Some(head), None) => {
                chains[head].points.push(ArcPoint::new(segment.end()));
                let last = chains[head].points.len() - 1;
                set_arc_segment(&mut chains[head].points[last], segment);
            }
            (None, Some(tail)) => {
                set_arc_segment(&mut chains[tail].points[0], segment);
                chains[tail]
                    .points
                    .insert(0, ArcPoint::new(segment.start()));
            }
            (None, None) => {
                let mut end = ArcPoint::new(segment.end());
                set_arc_segment(&mut end, segment);
                chains.push(Chain {
                    points: vec![ArcPoint::new(segment.start()), end],
                });
            }
        }
    }
    result
}

fn set_arc_segment(point: &mut ArcPoint, segment: &RrSegment) {
    if let RrSegment::Arc(arc) = segment {
        point.arc = Some(arc.anchor);
        point.radius = Some(arc.radius);
    }
}
