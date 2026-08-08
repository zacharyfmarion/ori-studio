use crate::geometry::{
    LineColor, LineSegment, Point, Polygon, angle, equal, find_line_symmetry_point,
};
use crate::model::CreasePatternModel;
use std::collections::BTreeSet;

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
        let mut points = Vec::new();
        let mut lines = Vec::with_capacity(segments.len());
        for segment in segments {
            let begin = vertex_index(&mut points, segment.a);
            let end = vertex_index(&mut points, segment.b);
            lines.push(GraphLine {
                begin,
                end,
                color: segment.color,
            });
        }

        let mut graph = Self {
            segments: segments.to_vec(),
            points,
            lines,
            faces: Vec::new(),
            include_faces: false,
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

    pub(crate) fn line_face_border(&self, line_index: usize) -> Option<(usize, usize)> {
        let line = self.lines.get(line_index)?;
        let mut min = usize::MAX;
        let mut max = 0usize;
        let mut found = false;

        for (face_index, face) in self.faces.iter().enumerate() {
            if face_contains_line(face, line.begin, line.end) {
                min = min.min(face_index);
                max = max.max(face_index);
                found = true;
            }
        }

        found.then_some((min, max))
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
        include_faces
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

    fn fold_movement(&self, point: usize, face: usize, positions: &FacePositions) -> Point {
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

fn vertex_index(points: &mut Vec<Point>, point: Point) -> usize {
    if let Some(index) = points.iter().position(|candidate| equal(*candidate, point)) {
        return index;
    }

    points.push(point);
    points.len() - 1
}

fn align_face(face: &mut Vec<usize>) {
    let Some(minimum) = face.iter().copied().min() else {
        return;
    };
    while face.first().copied() != Some(minimum) {
        let first = face.remove(0);
        face.push(first);
    }
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
