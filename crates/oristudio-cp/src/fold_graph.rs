use crate::geometry::{
    Epsilon, LineColor, LineSegment, Point, Polygon, angle, equal, find_line_symmetry_point,
};
use crate::model::CreasePatternModel;
use std::collections::{BTreeSet, HashMap};

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct GraphLine {
    pub begin: usize,
    pub end: usize,
    pub color: LineColor,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FoldGraph {
    pub segments: Vec<LineSegment>,
    pub points: Vec<Point>,
    pub lines: Vec<GraphLine>,
    pub faces: Vec<Vec<usize>>,
    pub include_faces: bool,
    /// Per line, the lowest and highest face index having that line on its
    /// border — Oriedita's `lineInFaceBorder_min` / `_max` arrays, built once by
    /// `PointSet.findLineInFaceBorder()`
    /// (`third_party/oriedita/.../crease_pattern/PointSet.java:454-490`) and
    /// read through `lineInFaceBorder_min_lookup` (`:494`).
    ///
    /// Derived purely from `lines` and `faces`, and only ever written by
    /// [`FoldGraph::calculate_faces`], which is the sole writer of `faces`
    /// (`:251`). Empty whenever `faces` is, so an uncalculated graph answers
    /// `None` for every line exactly as the scan it replaces did.
    line_face_borders: Vec<Option<(usize, usize)>>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FacePositions {
    pub starting_face: usize,
    pub face_position: Vec<usize>,
    pub next_face: Vec<Option<usize>>,
    pub associated_line: Vec<Option<usize>>,
}

/// A fold graph the spanning walk cannot describe.
///
/// **Ori Studio native — no Oriedita counterpart.** Upstream's
/// `WireFrame_Worker.getFacePositions()` has no exit for this at all: its
/// `while (remaining_facesTotal > 0)` loop keeps re-scanning an empty frontier
/// until the thread is interrupted. We already diverged by breaking out of the
/// loop; that traded a hang for a *wrong answer*, because every face the walk
/// never reached keeps `associated_line: None`, and [`FoldGraph::fold_movement`]
/// then returns those faces' points unmoved — an unfolded slab inside an
/// otherwise folded figure, with no error anywhere. See PORTING.md.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FoldGraphError {
    /// The dual graph of faces is not connected: no walk from the starting face
    /// reaches `unreached` of them.
    ///
    /// The Euler gate in [`FoldGraph::calculate_faces`] catches the small cases
    /// (two disjoint squares score `euler == 2` and are rejected outright), but
    /// its tolerance is `0.005 * faces.len()`, so from ~200 faces up a
    /// disconnected line set passes the gate and reaches the walk.
    DisconnectedFaces { reached: usize, unreached: usize },
}

impl std::fmt::Display for FoldGraphError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DisconnectedFaces { reached, unreached } => write!(
                f,
                "the fold graph is disconnected: the walk reached {reached} faces \
                 and could not reach {unreached}"
            ),
        }
    }
}

impl std::error::Error for FoldGraphError {}

impl FoldGraph {
    pub(crate) fn from_model_for_export(model: &CreasePatternModel) -> Self {
        let segments = if model.line_segments.is_empty() {
            vec![LineSegment::with_color(
                Point::new(0.0, 0.0),
                Point::new(0.0, 0.0),
                LineColor::Black0,
            )]
        } else {
            model.line_segments.clone()
        };
        Self::from_segments(&segments, true)
    }

    pub(crate) fn from_segments(segments: &[LineSegment], calculate_faces: bool) -> Self {
        let mut points = VertexIndex::with_capacity(segments.len() * 2);
        let mut lines = Vec::with_capacity(segments.len());
        for segment in segments {
            let begin = points.index_of(segment.a);
            let end = points.index_of(segment.b);
            lines.push(GraphLine {
                begin,
                end,
                color: segment.color,
            });
        }

        let mut graph = Self {
            segments: segments.to_vec(),
            points: points.into_points(),
            lines,
            faces: Vec::new(),
            include_faces: false,
            line_face_borders: Vec::new(),
        };

        if calculate_faces {
            graph.include_faces = graph.calculate_faces();
        }

        graph
    }

    pub(crate) fn edges_vertices(&self) -> Vec<[usize; 2]> {
        self.lines
            .iter()
            .map(|line| [line.begin, line.end])
            .collect()
    }

    pub(crate) fn faces_edges(&self) -> Vec<Vec<usize>> {
        self.faces
            .iter()
            .map(|face| self.face_edges(face))
            .collect()
    }

    /// The lowest and highest face index carrying `line_index` on its border.
    ///
    /// An array read. It used to be a scan over every face, run from inside the
    /// equivalence-condition loops (`folding.rs:4210`, `:4243`, `:4253`), which
    /// made condition generation `O(lines x candidates x faces)` — the dominant
    /// cost of a large fold. Upstream never paid it: `PointSet` precomputes the
    /// same answer once and looks it up (`PointSet.java:454-494`).
    pub(crate) fn line_face_border(&self, line_index: usize) -> Option<(usize, usize)> {
        self.line_face_borders.get(line_index).copied().flatten()
    }

    pub(crate) fn folded_points(&self, positions: &FacePositions) -> Vec<Point> {
        let mut folded = self.points.clone();
        for (point_index, target) in folded.iter_mut().enumerate() {
            let mut x = 0.0;
            let mut y = 0.0;
            let mut total = 0usize;
            for face_index in self.faces_containing_point(point_index) {
                let moved = self.fold_movement(point_index, face_index, positions);
                x += moved.x;
                y += moved.y;
                total += 1;
            }

            if total == 0 {
                *target = Point::new(f64::NAN, f64::NAN);
            } else {
                *target = Point::new(x / total as f64, y / total as f64);
            }
        }
        folded
    }

    /// Oriedita `WireFrame_Worker.getFacePositions()`: the spanning walk over the
    /// dual graph of faces, recording each face's depth, its parent, and the
    /// crease it folds across.
    ///
    /// Fallible where upstream is not — see [`FoldGraphError`].
    pub(crate) fn face_positions(
        &self,
        starting_face: i32,
    ) -> Result<FacePositions, FoldGraphError> {
        let starting_face = self.resolve_starting_face(starting_face);
        let mut face_position = vec![0; self.faces.len()];
        let mut next_face = vec![None; self.faces.len()];
        let mut associated_line = vec![None; self.faces.len()];

        if self.faces.is_empty() {
            return Ok(FacePositions {
                starting_face,
                face_position,
                next_face,
                associated_line,
            });
        }

        face_position[starting_face] = 1;
        let mut remaining_faces = self.faces.len().saturating_sub(1);
        let mut depth = 1usize;
        let mut current_round = BTreeSet::new();
        current_round.insert(starting_face);

        while remaining_faces > 0 {
            let mut next_round = BTreeSet::new();
            for face in &current_round {
                for candidate in 0..self.faces.len() {
                    if face_position[candidate] != 0 {
                        continue;
                    }
                    if let Some(line) = self.find_adjacent_line(*face, candidate) {
                        next_round.insert(candidate);
                        face_position[candidate] = depth + 1;
                        next_face[candidate] = Some(*face);
                        associated_line[candidate] = Some(line);
                        remaining_faces -= 1;
                    }
                }
            }

            if next_round.is_empty() {
                // Nothing new is reachable and faces remain. Upstream would spin
                // here forever; breaking out would hand back an unfolded slab.
                return Err(FoldGraphError::DisconnectedFaces {
                    reached: self.faces.len() - remaining_faces,
                    unreached: remaining_faces,
                });
            }

            current_round = next_round;
            depth += 1;
        }

        Ok(FacePositions {
            starting_face,
            face_position,
            next_face,
            associated_line,
        })
    }

    fn calculate_faces(&mut self) -> bool {
        let point_linking = self.point_linking();
        let mut face_point_map = vec![Vec::<usize>::new(); self.points.len()];
        let mut faces = Vec::<Vec<usize>>::new();

        for line in &self.lines {
            let begin = line.begin;
            let end = line.end;

            let forward = self.face_request(begin, end, &point_linking);
            if self.should_add_face(&forward, begin, &faces, &face_point_map) {
                add_face(forward, &mut faces, &mut face_point_map);
            }

            let reverse = self.face_request(end, begin, &point_linking);
            if self.should_add_face(&reverse, begin, &faces, &face_point_map) {
                add_face(reverse, &mut faces, &mut face_point_map);
            }
        }

        let euler = faces.len() as isize - self.lines.len() as isize + self.points.len() as isize;
        let include_faces = euler == 1 || (euler - 1).abs() as f64 <= 0.005 * faces.len() as f64;
        self.faces = if include_faces { faces } else { Vec::new() };
        self.line_face_borders = if include_faces {
            self.line_face_borders_from_incidence(&face_point_map)
        } else {
            Vec::new()
        };
        include_faces
    }

    /// Oriedita `PointSet.findLineInFaceBorder()`: resolve every line's border
    /// faces in one pass, consulting only the faces incident to that line's
    /// `begin` point instead of all of them.
    ///
    /// `incidence[point]` is the face list [`Self::calculate_faces`] already
    /// accumulates while building the faces, so the index this needs costs
    /// nothing extra. Narrowing the scan to `begin` loses no answer: a face
    /// carrying the line on its border contains both of its endpoints, so it is
    /// always in that bucket — the same reasoning that lets upstream walk only
    /// `head[lines[i].getBegin()]` (`PointSet.java:474`).
    fn line_face_borders_from_incidence(
        &self,
        incidence: &[Vec<usize>],
    ) -> Vec<Option<(usize, usize)>> {
        self.lines
            .iter()
            .map(|line| {
                let mut min = usize::MAX;
                let mut max = 0usize;
                let mut found = false;
                for &face_index in incidence.get(line.begin)? {
                    let Some(face) = self.faces.get(face_index) else {
                        continue;
                    };
                    if face_contains_line(face, line.begin, line.end) {
                        min = min.min(face_index);
                        max = max.max(face_index);
                        found = true;
                    }
                }
                found.then_some((min, max))
            })
            .collect()
    }

    fn point_linking(&self) -> Vec<Vec<usize>> {
        let mut point_linking = vec![Vec::<usize>::new(); self.points.len()];
        for line in &self.lines {
            if line.begin < point_linking.len() && line.end < point_linking.len() {
                point_linking[line.begin].push(line.end);
                point_linking[line.end].push(line.begin);
            }
        }
        point_linking
    }

    fn face_request(&self, start: usize, end: usize, point_linking: &[Vec<usize>]) -> Vec<usize> {
        if start >= self.points.len() || end >= self.points.len() {
            return Vec::new();
        }

        let mut face = vec![start, end];
        let mut next = self.r_point(start, end, point_linking);
        let mut added_after_seed = false;

        loop {
            let Some(next_point) = next else {
                if added_after_seed {
                    // Oriedita `Face` stores a sentinel point id 0; after at
                    // least one added vertex, falling off a dangling branch
                    // still returns the partial face because that sentinel is
                    // "contained".
                    align_face(&mut face);
                    return face;
                }
                return Vec::new();
            };
            if face.contains(&next_point) {
                align_face(&mut face);
                return face;
            }

            face.push(next_point);
            added_after_seed = true;
            let count = face.len();
            next = self.r_point(face[count - 2], face[count - 1], point_linking);
        }
    }

    fn r_point(
        &self,
        previous: usize,
        current: usize,
        point_linking: &[Vec<usize>],
    ) -> Option<usize> {
        let linked_points = point_linking.get(current)?;
        if !point_linking
            .get(previous)
            .is_some_and(|linked| linked.contains(&current))
        {
            return None;
        }

        let mut result = None;
        let mut best_angle = 876.0;
        for candidate in linked_points {
            if *candidate == previous {
                continue;
            }
            let candidate_angle = angle((
                self.points[current],
                self.points[previous],
                self.points[current],
                self.points[*candidate],
            ));
            if candidate_angle <= best_angle {
                result = Some(*candidate);
                best_angle = candidate_angle;
            }
        }

        result
    }

    fn should_add_face(
        &self,
        face: &[usize],
        begin: usize,
        faces: &[Vec<usize>],
        face_point_map: &[Vec<usize>],
    ) -> bool {
        if face.is_empty()
            || face_area(face, &self.points) <= 0.0
            || face_point_map
                .get(begin)
                .is_some_and(|existing| existing.iter().any(|index| faces[*index] == face))
        {
            return false;
        }

        true
    }

    fn face_edges(&self, face: &[usize]) -> Vec<usize> {
        if face.is_empty() {
            return Vec::new();
        }

        let mut face_edges = Vec::with_capacity(face.len());
        let first = face[0];
        let last = face[face.len() - 1];
        face_edges.push(self.find_edge(first, last).unwrap_or(usize::MAX));
        for index in 1..face.len() {
            face_edges.push(
                self.find_edge(face[index], face[index - 1])
                    .unwrap_or(usize::MAX),
            );
        }
        face_edges
    }

    fn find_edge(&self, a: usize, b: usize) -> Option<usize> {
        self.lines.iter().position(|line| {
            (line.begin == a && line.end == b) || (line.begin == b && line.end == a)
        })
    }

    fn find_adjacent_line(&self, face: usize, other: usize) -> Option<usize> {
        let face_points = self.faces.get(face)?;
        let other_points = self.faces.get(other)?;
        for index in 0..face_points.len() {
            let a = face_points[index];
            let b = face_points[(index + 1) % face_points.len()];
            for other_index in 0..other_points.len() {
                let other_a = other_points[other_index];
                let other_b = other_points[(other_index + 1) % other_points.len()];
                if ((a == other_a && b == other_b) || (a == other_b && b == other_a))
                    && let Some(line) = self.find_edge(a, b)
                {
                    return Some(line);
                }
            }
        }
        None
    }

    fn resolve_starting_face(&self, starting_face: i32) -> usize {
        if self.faces.is_empty() {
            return 0;
        }

        if starting_face > self.faces.len() as i32 {
            return self.faces.len() - 1;
        }
        if starting_face >= 1 {
            return starting_face as usize - 1;
        }

        self.inside_face(Point::new(0.0, 0.0)).unwrap_or_default()
    }

    fn inside_face(&self, point: Point) -> Option<usize> {
        for (index, face) in self.faces.iter().enumerate() {
            let polygon = Polygon::new(face.iter().map(|point| self.points[*point]).collect());
            match polygon.inside(point) {
                crate::geometry::PolygonIntersection::Inside => return Some(index),
                crate::geometry::PolygonIntersection::Border => return None,
                _ => {}
            }
        }
        None
    }

    fn faces_containing_point(&self, point: usize) -> impl Iterator<Item = usize> + '_ {
        self.faces
            .iter()
            .enumerate()
            .filter_map(move |(index, face)| face.contains(&point).then_some(index))
    }

    /// One face's own image of a point, before [`Self::folded_points`] averages
    /// it away.
    ///
    /// `pub(crate)` so [`crate::folding3d`] can be diffed against it face by
    /// face. That comparison is the only cross-check the 3D placement has
    /// against code someone else wrote — a half-turn about an in-sheet axis
    /// restricted to the sheet plane *is* this reflection — and it has to be
    /// made here rather than against `folded_points`, whose averaging is a
    /// different answer on any document the placement is not path-independent
    /// on.
    pub(crate) fn fold_movement(
        &self,
        point: usize,
        face: usize,
        positions: &FacePositions,
    ) -> Point {
        let mut p = self.points[point];
        let mut destination_face = face;
        while destination_face != positions.starting_face {
            let Some(line_index) = positions.associated_line[destination_face] else {
                break;
            };
            let line = self.lines[line_index];
            p = find_line_symmetry_point(self.points[line.begin], self.points[line.end], p);
            let Some(next_face) = positions.next_face[destination_face] else {
                break;
            };
            destination_face = next_face;
        }
        p
    }
}

fn face_contains_line(face: &[usize], begin: usize, end: usize) -> bool {
    if face.is_empty() {
        return false;
    }

    for index in 0..face.len() {
        let a = face[index];
        let b = face[(index + 1) % face.len()];
        if (a == begin && b == end) || (a == end && b == begin) {
            return true;
        }
    }

    false
}

/// Side of one bucket in [`VertexIndex`], in paper units.
///
/// Four times [`Epsilon::POINT`], so a candidate within the merge radius is
/// never more than one bucket away on either axis and the `-1..=1` sweep below
/// is exhaustive with three decimal orders of slack against the rounding in
/// `coordinate / CELL`.
const VERTEX_BUCKET: f64 = Epsilon::POINT * 4.0;

/// The arrangement's point set, plus a uniform grid over it.
///
/// **An index, not a change of rule.** [`Self::index_of`] returns the same
/// answer as the linear `points.iter().position(|p| equal(*p, point))` it
/// replaces — the *lowest* index within [`Epsilon::POINT`] of `point`, and a
/// fresh index when there is none — because the bucket sweep is a superset of
/// the candidates and the minimum is taken over it. `points_dedup_exactly_as_a_linear_scan_does`
/// asserts that against the scan itself.
///
/// It exists because the scan is quadratic and every arrangement pays it.
/// `CheckCamv` runs on the 120 ms debounced post-edit path and, on a document
/// carrying a non-classic crease, reaches `interior_border_segments`, which
/// builds a full arrangement: measured on the corpus's 9,162-segment
/// `ALL-combined.fold`, that one build was 42 ms of a 53 ms check against 5.5 ms
/// for Oriedita's `check4` alone. The work is wanted; paying `O(n^2)` for it is
/// not.
struct VertexIndex {
    points: Vec<Point>,
    buckets: HashMap<(i64, i64), Vec<usize>>,
}

impl VertexIndex {
    fn with_capacity(capacity: usize) -> Self {
        Self {
            points: Vec::with_capacity(capacity),
            buckets: HashMap::with_capacity(capacity),
        }
    }

    /// Bucket coordinates. A non-finite coordinate saturates, which is harmless:
    /// `equal` is false against a NaN either way, so such a point is pushed as
    /// its own vertex exactly as the linear scan pushed it.
    fn bucket(point: Point) -> (i64, i64) {
        (
            (point.x / VERTEX_BUCKET).floor() as i64,
            (point.y / VERTEX_BUCKET).floor() as i64,
        )
    }

    fn index_of(&mut self, point: Point) -> usize {
        let (bx, by) = Self::bucket(point);
        let mut found: Option<usize> = None;
        for dx in -1..=1 {
            for dy in -1..=1 {
                // Saturating, because a coordinate far enough out (or not finite
                // at all) saturates the cast. Such points then share one bucket
                // and are separated by `equal` as they always were.
                let neighbour = (bx.saturating_add(dx), by.saturating_add(dy));
                let Some(bucket) = self.buckets.get(&neighbour) else {
                    continue;
                };
                for &candidate in bucket {
                    if equal(self.points[candidate], point) {
                        found = Some(found.map_or(candidate, |best| best.min(candidate)));
                    }
                }
            }
        }
        if let Some(index) = found {
            return index;
        }

        let index = self.points.len();
        self.points.push(point);
        self.buckets.entry((bx, by)).or_default().push(index);
        index
    }

    fn into_points(self) -> Vec<Point> {
        self.points
    }
}

/// Rotate the ring so its lowest point id comes first.
///
/// The `remove(0)`/`push` loop this replaces stopped after the smallest `k` with
/// `face[k] == minimum`, which is exactly `position`, and cost `O(n^2)` getting
/// there. Duplicate ids do not separate the two forms: both stop at the first
/// slot holding the minimum.
fn align_face(face: &mut [usize]) {
    let Some(minimum) = face.iter().copied().min() else {
        return;
    };
    let Some(at) = face.iter().position(|point| *point == minimum) else {
        return;
    };
    face.rotate_left(at);
}

fn add_face(face: Vec<usize>, faces: &mut Vec<Vec<usize>>, face_point_map: &mut [Vec<usize>]) {
    let face_index = faces.len();
    for point in &face {
        if let Some(entries) = face_point_map.get_mut(*point) {
            entries.push(face_index);
        }
    }
    faces.push(face);
}

fn face_area(face: &[usize], points: &[Point]) -> f64 {
    let vertices = face
        .iter()
        .filter_map(|index| points.get(*index).copied())
        .collect::<Vec<_>>();
    Polygon::new(vertices).calculate_area()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::LineColor;

    /// The all-faces scan [`FoldGraph::line_face_border`] replaces, kept as the
    /// reference the cache is checked against.
    fn scanned_line_face_border(graph: &FoldGraph, line_index: usize) -> Option<(usize, usize)> {
        let line = graph.lines.get(line_index)?;
        let mut min = usize::MAX;
        let mut max = 0usize;
        let mut found = false;
        for (face_index, face) in graph.faces.iter().enumerate() {
            if face_contains_line(face, line.begin, line.end) {
                min = min.min(face_index);
                max = max.max(face_index);
                found = true;
            }
        }
        found.then_some((min, max))
    }

    fn assert_line_face_borders_match_scan(segments: &[LineSegment]) {
        let graph = FoldGraph::from_segments(segments, true);
        // Guard the guard: a graph whose faces were rejected answers `None`
        // everywhere, which would make the comparison below vacuous.
        assert!(graph.include_faces, "fixture produced no faces");
        assert!(!graph.faces.is_empty(), "fixture produced no faces");
        for line_index in 0..graph.lines.len() {
            assert_eq!(
                graph.line_face_border(line_index),
                scanned_line_face_border(&graph, line_index),
                "line {line_index} disagrees with the all-faces scan"
            );
        }
    }

    /// An `n` x `n` grid emitted one cell edge at a time.
    ///
    /// Full-length crossing lines would not do: `from_segments` takes its points
    /// from segment *endpoints*, so undivided crossings contribute no vertex and
    /// the graph comes back with no faces at all. Callers in `folding.rs` reach
    /// the graph only after `divide_intersections`; this is the same shape.
    fn grid_segments(n: usize) -> Vec<LineSegment> {
        let step = 400.0 / n as f64;
        let at = |i: usize| i as f64 * step;
        let mut segments = Vec::new();
        for i in 0..=n {
            for j in 0..n {
                segments.push(LineSegment::with_color(
                    Point::new(at(i), at(j)),
                    Point::new(at(i), at(j + 1)),
                    LineColor::Black0,
                ));
                segments.push(LineSegment::with_color(
                    Point::new(at(j), at(i)),
                    Point::new(at(j + 1), at(i)),
                    LineColor::Black0,
                ));
            }
        }
        segments
    }

    /// The cache is only a faster way to compute the scan, so it must agree with
    /// it line for line — including the `None`s, which are what the callers in
    /// `folding.rs` branch on.
    #[test]
    fn line_face_border_matches_the_all_faces_scan() {
        assert_line_face_borders_match_scan(&grid_segments(1));
        assert_line_face_borders_match_scan(&grid_segments(4));
        assert_line_face_borders_match_scan(&grid_segments(9));
    }

    /// A graph built without faces has no borders to report, and must say so
    /// rather than index into an empty cache.
    #[test]
    fn line_face_border_is_empty_without_faces() {
        let graph = FoldGraph::from_segments(&grid_segments(2), false);
        assert!(graph.faces.is_empty());
        for line_index in 0..graph.lines.len() {
            assert_eq!(graph.line_face_border(line_index), None);
        }
        assert_eq!(graph.line_face_border(usize::MAX), None);
    }

    /// The linear scan [`VertexIndex`] replaces, kept as the reference.
    fn scanned_points(segments: &[LineSegment]) -> Vec<Point> {
        let mut points: Vec<Point> = Vec::new();
        let mut push = |point: Point| {
            if points
                .iter()
                .position(|candidate| equal(*candidate, point))
                .is_none()
            {
                points.push(point);
            }
        };
        for segment in segments {
            push(segment.a);
            push(segment.b);
        }
        points
    }

    /// Deterministic points clustered around the merge radius.
    ///
    /// The interesting inputs are not "far apart" or "identical" — both forms
    /// agree trivially on those. They are points a hair either side of
    /// `Epsilon::POINT` from each other, and points that straddle a bucket
    /// boundary, which is the only place a grid can differ from a scan.
    fn near_coincident_segments() -> Vec<LineSegment> {
        let mut state: u64 = 0x2545_F491_4F6C_DD1D;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 11) as f64 / (1u64 << 53) as f64
        };
        // Snap onto a lattice whose pitch is the merge radius, then jitter by up
        // to twice it: every pair is within a bucket or two of a merge decision.
        let pitch = Epsilon::POINT;
        let mut segments = Vec::new();
        for _ in 0..600 {
            let mut point = || {
                let cell_x = (next() * 12.0).floor();
                let cell_y = (next() * 12.0).floor();
                Point::new(
                    cell_x * pitch + (next() - 0.5) * 2.0 * pitch,
                    cell_y * pitch + (next() - 0.5) * 2.0 * pitch,
                )
            };
            segments.push(LineSegment::with_color(point(), point(), LineColor::Red1));
        }
        segments
    }

    #[test]
    fn points_dedup_exactly_as_a_linear_scan_does() {
        let segments = near_coincident_segments();
        let graph = FoldGraph::from_segments(&segments, false);
        assert_eq!(
            graph.points,
            scanned_points(&segments),
            "the grid must return the same vertex, in the same order, as the scan"
        );
        assert!(
            graph.points.len() > 60,
            "the generator has to actually merge some and keep others; got {}",
            graph.points.len()
        );
    }

    /// The whole arrangement, not just the point list: a differing vertex id
    /// would move every face.
    #[test]
    fn the_arrangement_is_unchanged_on_a_grid_with_shared_vertices() {
        let mut segments = Vec::new();
        for i in 0..=8 {
            let t = f64::from(i) * 25.0;
            segments.push(LineSegment::with_color(
                Point::new(t, 0.0),
                Point::new(t, 200.0),
                LineColor::Red1,
            ));
            segments.push(LineSegment::with_color(
                Point::new(0.0, t),
                Point::new(200.0, t),
                LineColor::Blue2,
            ));
        }
        let graph = FoldGraph::from_segments(&segments, true);
        assert_eq!(graph.points, scanned_points(&segments));
        assert_eq!(
            graph.lines.len(),
            segments.len(),
            "one graph line per segment, in order"
        );
    }

    /// `align_face` rotates to the first slot holding the minimum, duplicates or
    /// not — the property the `remove(0)` loop had.
    #[test]
    fn a_face_ring_is_rotated_to_its_lowest_point_id() {
        let mut ring = vec![7, 3, 9, 3, 5];
        align_face(&mut ring);
        assert_eq!(ring, vec![3, 9, 3, 5, 7]);

        let mut already = vec![1, 4, 2];
        align_face(&mut already);
        assert_eq!(already, vec![1, 4, 2]);

        let mut empty: Vec<usize> = Vec::new();
        align_face(&mut empty);
        assert!(empty.is_empty());
    }
}
