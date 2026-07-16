use super::EventKind;
use crate::data::union_find::ListUnionFind;
use crate::math::geometry::{PathPoint, is_clockwise};
use std::cmp::Ordering;

const COORDINATE_SHIFT: i32 = 4096;
const SHIFT_Y: i32 = 17;
const SHIFT_START: i32 = 16;
const SHIFT_HOR: i32 = 15;
const SHIFT_DELTA: i32 = 14;

#[derive(Debug, Clone, PartialEq)]
pub struct PathEx {
    pub points: Vec<PathPoint>,
    pub is_hole: bool,
    pub from: Option<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UnionResult {
    pub paths: Vec<PathEx>,
    pub from: Vec<usize>,
}

#[derive(Debug, Clone, Default)]
pub struct AaUnion {
    check_self_intersection: bool,
}

impl AaUnion {
    pub fn new(check_self_intersection: bool) -> Self {
        Self {
            check_self_intersection,
        }
    }

    pub fn get(&mut self, components: &[Vec<Vec<PathPoint>>]) -> Vec<PathEx> {
        aa_union_with_options(components, self.check_self_intersection)
    }
}

pub fn aa_union(components: &[Vec<Vec<PathPoint>>]) -> Vec<PathEx> {
    aa_union_with_options(components, false)
}

pub fn aa_union_with_options(
    components: &[Vec<Vec<PathPoint>>],
    check_self_intersection: bool,
) -> Vec<PathEx> {
    AaUnionSweep::new(components, check_self_intersection).get()
}

#[derive(Debug, Clone, Default)]
pub struct RoughUnion;

impl RoughUnion {
    pub fn new() -> Self {
        Self
    }

    pub fn union(&mut self, components: &[Vec<Vec<PathPoint>>]) -> Vec<UnionResult> {
        rough_union(components)
    }
}

pub fn rough_union(components: &[Vec<Vec<PathPoint>>]) -> Vec<UnionResult> {
    let (paths, groups) = AaUnionSweep::new_with_source_tracking(components).get_with_sources();
    groups
        .into_iter()
        .map(|from| {
            let paths = paths
                .iter()
                .filter(|path| path.from.is_some_and(|source| from.contains(&source)))
                .cloned()
                .collect();
            UnionResult { paths, from }
        })
        .collect()
}

#[derive(Debug, Clone)]
struct AaSegment {
    polygon: usize,
    start: PathPoint,
    end: PathPoint,
    is_horizontal: bool,
}

impl AaSegment {
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
            let new_segment = AaSegment::new(point, self.end, self.polygon);
            self.end = point;
            new_segment
        } else {
            let new_segment = AaSegment::new(self.start, point, self.polygon);
            self.start = point;
            new_segment
        }
    }
}

#[derive(Debug, Clone)]
struct AaEvent {
    key: i32,
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

    fn pop(&mut self, events: &[AaEvent]) -> Option<usize> {
        let mut best = 0;
        for index in 1..self.ids.len() {
            if event_cmp(events, self.ids[index], self.ids[best]).is_lt() {
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
    fn insert(&mut self, id: usize, events: &[AaEvent]) {
        if !self.ids.contains(&id) {
            self.ids.push(id);
        }
        self.sort(events);
    }

    fn delete(&mut self, id: usize) {
        self.ids.retain(|candidate| *candidate != id);
    }

    fn get_prev(&mut self, id: usize, events: &[AaEvent]) -> Option<usize> {
        self.sort(events);
        let position = self.ids.iter().position(|candidate| *candidate == id)?;
        position
            .checked_sub(1)
            .and_then(|prev| self.ids.get(prev).copied())
    }

    fn get_next(&mut self, id: usize, events: &[AaEvent]) -> Option<usize> {
        self.sort(events);
        let position = self.ids.iter().position(|candidate| *candidate == id)?;
        self.ids.get(position + 1).copied()
    }

    fn sort(&mut self, events: &[AaEvent]) {
        self.ids.sort_by(|a, b| events[*a].key.cmp(&events[*b].key));
    }
}

struct AaUnionSweep {
    events: Vec<AaEvent>,
    segments: Vec<AaSegment>,
    queue: EventQueue,
    status: Status,
    current_start: Option<usize>,
    event_inserted: bool,
    next_provider_id: i32,
    collected: Vec<usize>,
    check_self_intersection: bool,
    source_tracker: Option<ListUnionFind<usize>>,
}

impl AaUnionSweep {
    fn new(components: &[Vec<Vec<PathPoint>>], check_self_intersection: bool) -> Self {
        Self::build(components, check_self_intersection, false)
    }

    fn new_with_source_tracking(components: &[Vec<Vec<PathPoint>>]) -> Self {
        Self::build(components, true, true)
    }

    fn build(
        components: &[Vec<Vec<PathPoint>>],
        check_self_intersection: bool,
        track_sources: bool,
    ) -> Self {
        let mut sweep = Self {
            events: Vec::new(),
            segments: Vec::new(),
            queue: EventQueue::default(),
            status: Status::default(),
            current_start: None,
            event_inserted: false,
            next_provider_id: 0,
            collected: Vec::new(),
            check_self_intersection,
            source_tracker: track_sources.then(|| ListUnionFind::new(components.len())),
        };
        for (polygon, component) in components.iter().enumerate() {
            for path in component {
                if path.is_empty() {
                    continue;
                }
                for i in 0..path.len() {
                    let p1 = path[i];
                    let p2 = path.get(i + 1).copied().unwrap_or(path[0]);
                    let segment = AaSegment::new(p1, p2, polygon);
                    let delta = if xy_cmp(p1, p2).is_lt() { 1 } else { -1 };
                    sweep.add_segment_delta_orientation(segment, delta);
                }
            }
        }
        sweep
    }

    fn get(mut self) -> Vec<PathEx> {
        self.run_sweep();
        self.collect_paths(false)
    }

    fn get_with_sources(mut self) -> (Vec<PathEx>, Vec<Vec<usize>>) {
        self.run_sweep();
        let paths = self.collect_paths(true);
        let groups = self
            .source_tracker
            .as_ref()
            .map(ListUnionFind::list)
            .unwrap_or_default();
        (paths, groups)
    }

    fn run_sweep(&mut self) {
        while !self.queue.is_empty() {
            let Some(event) = self.queue.pop(&self.events) else {
                break;
            };
            if self.events[event].kind == EventKind::Start {
                self.process_start(event);
            } else {
                self.process_end(event);
            }
        }
    }

    fn collect_paths(&self, track_sources: bool) -> Vec<PathEx> {
        chain_segments(&self.collected, &self.segments, track_sources)
            .into_iter()
            .map(|(points, from)| {
                let is_hole = is_clockwise(&points);
                PathEx {
                    points,
                    is_hole,
                    from,
                }
            })
            .collect()
    }

    fn add_segment_delta_orientation(&mut self, segment: AaSegment, delta: i8) {
        if segment.start == segment.end {
            return;
        }
        let (start_point, end_point) = if delta == 1 {
            (segment.start, segment.end)
        } else {
            (segment.end, segment.start)
        };
        let segment_id = self.segments.len();
        self.segments.push(segment);

        let start_id = self.events.len();
        let end_id = start_id + 1;
        let start_key = self.next_key(start_point, EventKind::Start, segment_id, delta);
        let end_key = self.next_key(end_point, EventKind::End, segment_id, 1);
        self.events.push(AaEvent {
            key: start_key,
            point: start_point,
            kind: EventKind::Start,
            segment: Some(segment_id),
            wrap_delta: delta,
            wrap_count: i32::from(delta),
            is_inside: false,
            other: end_id,
        });
        self.events.push(AaEvent {
            key: end_key,
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

    fn next_key(&mut self, point: PathPoint, kind: EventKind, segment: usize, delta: i8) -> i32 {
        let id = self.next_provider_id;
        self.next_provider_id += 1;
        get_key(point, kind, &self.segments[segment], delta, id)
    }

    fn process_start(&mut self, event: usize) {
        self.status.insert(event, &self.events);
        let prev = self.status.get_prev(event, &self.events);
        let next = self.status.get_next(event, &self.events);

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
        if !self.events[start].is_inside
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
        self.update_source_tracker(event, prev);
    }

    fn update_source_tracker(&mut self, event: usize, prev: Option<usize>) {
        let Some(tracker) = &mut self.source_tracker else {
            return;
        };
        let Some(segment) = self.events[event].segment else {
            return;
        };
        let source = self.segments[segment].polygon;
        if !self.events[event].is_inside && self.events[event].wrap_delta == 1 {
            let _ = tracker.add(source);
        } else if let Some(prev) = prev
            && let Some(prev_segment) = self.events[prev].segment
        {
            let prev_source = self.segments[prev_segment].polygon;
            if source != prev_source {
                let _ = tracker.union(source, prev_source);
            }
        }
    }

    fn possible_intersection(&mut self, ev1: Option<usize>, ev2: Option<usize>) {
        let (Some(ev1), Some(ev2)) = (ev1, ev2) else {
            return;
        };
        let (Some(seg1), Some(seg2)) = (self.events[ev1].segment, self.events[ev2].segment) else {
            return;
        };
        if !self.check_self_intersection
            && self.segments[seg1].polygon == self.segments[seg2].polygon
        {
            return;
        }

        if self.segments[seg1].is_horizontal != self.segments[seg2].is_horizontal {
            let (h, v) = if self.segments[seg1].is_horizontal {
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
            self.process_overlap(ev1, ev2, self.segments[seg1].is_horizontal);
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

    fn subdivide(&mut self, event: usize, point: PathPoint) -> usize {
        let Some(segment) = self.events[event].segment else {
            return event;
        };
        let oriented = self.events[event].point == self.segments[segment].start;
        let new_segment = self.segments[segment].subdivide(point, oriented);
        let new_segment_id = self.segments.len();
        self.segments.push(new_segment);

        let old_end = self.events[event].other;
        let new_start = self.events.len();
        let new_start_key = self.next_key(
            point,
            EventKind::Start,
            new_segment_id,
            self.events[event].wrap_delta,
        );
        self.events.push(AaEvent {
            key: new_start_key,
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
        let new_end_key = self.next_key(point, EventKind::End, segment, 1);
        self.events.push(AaEvent {
            key: new_end_key,
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
                event_cmp(&self.events, current, new_start).is_gt()
                    || event_cmp(&self.events, current, new_end).is_gt()
            });
        }

        new_start
    }
}

fn get_key(point: PathPoint, kind: EventKind, segment: &AaSegment, delta: i8, id: i32) -> i32 {
    let mut hor = if segment.is_horizontal { 1 } else { 0 };
    if kind == EventKind::Start {
        hor ^= 1;
    }
    ((point.y as i32 - COORDINATE_SHIFT) << SHIFT_Y)
        | ((kind as i32) << SHIFT_START)
        | (hor << SHIFT_HOR)
        | ((if delta == 1 { 0 } else { 1 }) << SHIFT_DELTA)
        | id
}

fn event_cmp(events: &[AaEvent], a: usize, b: usize) -> Ordering {
    compare_coord(events[a].point.x, events[b].point.x)
        .then_with(|| events[a].key.cmp(&events[b].key))
}

fn compare_coord(a: f64, b: f64) -> Ordering {
    if a < b {
        Ordering::Less
    } else if a > b {
        Ordering::Greater
    } else {
        Ordering::Equal
    }
}

fn xy_cmp(a: PathPoint, b: PathPoint) -> Ordering {
    compare_coord(a.x, b.x).then_with(|| compare_coord(a.y, b.y))
}

#[derive(Debug, Clone)]
struct Chain {
    points: Vec<PathPoint>,
    source: Option<usize>,
}

fn chain_segments(
    segment_ids: &[usize],
    segments: &[AaSegment],
    track_sources: bool,
) -> Vec<(Vec<PathPoint>, Option<usize>)> {
    let mut chains: Vec<Chain> = Vec::new();
    let mut result = Vec::new();
    for segment in segment_ids.iter().map(|id| &segments[*id]) {
        let tail = chains
            .iter()
            .position(|chain| chain.points.first() == Some(&segment.end));
        let head = chains
            .iter()
            .position(|chain| chain.points.last() == Some(&segment.start));

        match (head, tail) {
            (Some(head), Some(tail)) if head == tail => {
                let chain = chains.swap_remove(head);
                result.push((chain.points, chain.source));
            }
            (Some(head), Some(tail)) => {
                let tail_chain = chains.swap_remove(tail);
                let head_index = if tail < head { head - 1 } else { head };
                chains[head_index].points.extend(tail_chain.points);
            }
            (Some(head), None) => chains[head].points.push(segment.end),
            (None, Some(tail)) => chains[tail].points.insert(0, segment.start),
            (None, None) => chains.push(Chain {
                points: vec![segment.start, segment.end],
                source: track_sources.then_some(segment.polygon),
            }),
        }
    }
    result
}
