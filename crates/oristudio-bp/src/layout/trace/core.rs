use crate::error::BpResult;
use crate::layout::pattern::LayoutPattern;
use crate::layout::{
    CornerType, LayoutConfiguration, LayoutRepository, Quadrant, start_end_points,
};
use crate::math::BpFraction;
use crate::math::geometry::{Line, PathPoint, Point, Vector, get_intersection};
use crate::model::NodeId;
use crate::shared::SlashDirection;
use crate::tree::BpTree;
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ridge {
    pub line: Line,
    pub corner_type: Option<CornerType>,
    pub division: Option<[NodeId; 2]>,
}

impl Ridge {
    pub fn new(line: Line) -> Self {
        Self {
            line,
            corner_type: None,
            division: None,
        }
    }

    pub fn with_type(line: Line, corner_type: CornerType, division: Option<[NodeId; 2]>) -> Self {
        Self {
            line,
            corner_type: Some(corner_type),
            division,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SideDiagonal {
    pub line: Line,
    pub p0: Point,
}

impl SideDiagonal {
    pub fn new(line: Line, p0: Point) -> Self {
        Self { line, p0 }
    }

    fn contains(&self, point: &Point, include_endpoints: bool) -> bool {
        self.line.contains(point, include_endpoints)
    }

    fn line_contains(&self, point: &Point) -> bool {
        self.line.line_contains(point)
    }

    fn reflect(&self, vector: &Vector) -> BpResult<Vector> {
        self.line.reflect(vector)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TraceLine {
    Ridge(Ridge),
    SideDiagonal(SideDiagonal),
}

impl TraceLine {
    pub fn line(&self) -> &Line {
        match self {
            Self::Ridge(ridge) => &ridge.line,
            Self::SideDiagonal(diagonal) => &diagonal.line,
        }
    }

    fn is_side_diagonal(&self) -> bool {
        matches!(self, Self::SideDiagonal(_))
    }

    fn target_as_ray(&self) -> bool {
        matches!(self, Self::Ridge(ridge) if ridge.corner_type.is_some())
    }

    fn reflect(&self, vector: &Vector) -> BpResult<Vector> {
        self.line().reflect(vector)
    }
}

impl From<Ridge> for TraceLine {
    fn from(value: Ridge) -> Self {
        Self::Ridge(value)
    }
}

impl From<SideDiagonal> for TraceLine {
    fn from(value: SideDiagonal) -> Self {
        Self::SideDiagonal(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraceNode {
    pub point: Point,
    pub vector: Vector,
    pub last: Option<Vector>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RidgeIntersection {
    pub index: usize,
    pub line: TraceLine,
    pub point: Point,
    pub dist: BpFraction,
    pub angle: f64,
    pub end_point: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Trace {
    direction: SlashDirection,
    ridges: Vec<Ridge>,
    side_diagonals: Vec<SideDiagonal>,
}

impl Trace {
    pub fn new(
        ridges: Vec<Ridge>,
        direction: SlashDirection,
        side_diagonals: Vec<SideDiagonal>,
    ) -> Self {
        Self {
            direction,
            ridges,
            side_diagonals: side_diagonals
                .into_iter()
                .filter(|diagonal| !diagonal.line.is_degenerated())
                .collect(),
        }
    }

    pub fn direction(&self) -> SlashDirection {
        self.direction
    }

    pub fn ridges(&self) -> &[Ridge] {
        &self.ridges
    }

    pub fn side_diagonals(&self) -> &[SideDiagonal] {
        &self.side_diagonals
    }

    pub fn generate(
        &self,
        hinges: &[PathPoint],
        start: &Point,
        end: &Point,
        raw_mode: bool,
    ) -> BpResult<Option<Vec<Point>>> {
        let Some(ctx) = TraceContext::new(self, hinges)? else {
            return Ok(None);
        };

        let directional_vector = Vector::from_integers(
            1,
            if self.direction == SlashDirection::Fw {
                1
            } else {
                -1
            },
        );
        let mut ridges = self.create_filtered_ridges(start, end, &directional_vector);

        let start_diagonal = self
            .side_diagonals
            .iter()
            .find(|diagonal| diagonal.line_contains(start));
        let Some(mut cursor) = ctx.get_initial_node(&mut ridges, start_diagonal)? else {
            return Ok(None);
        };
        let mut path = vec![cursor.point.clone()];

        if let Some(end_diagonal) = self
            .side_diagonals
            .iter()
            .find(|diagonal| diagonal.contains(end, true))
        {
            ridges.push(end_diagonal.clone().into());
        }

        while let Some(intersection) = get_next_intersection(&ridges, &cursor, None)? {
            ridges.remove(intersection.index);
            cursor = TraceNode {
                last: Some(intersection.line.line().vector()),
                point: intersection.point,
                vector: intersection.line.reflect(&cursor.vector)?,
            };

            let Some(last_point) = path.last().cloned() else {
                break;
            };
            if !last_point.equals(&cursor.point) {
                let line = Line::new(last_point, cursor.point.clone());
                if let Some(test) = line.intersection(end, &directional_vector, false, false)
                    && !test.equals(&cursor.point)
                {
                    break;
                }
                path.push(cursor.point.clone());
            }
        }

        let result = ctx.trim(path);
        if raw_mode {
            raw_mode_final_check(result, hinges, &cursor.vector)
        } else {
            Ok(result)
        }
    }

    fn create_filtered_ridges(
        &self,
        start: &Point,
        end: &Point,
        directional_vector: &Vector,
    ) -> Vec<TraceLine> {
        let mut start_line = Line::from_point_vector(start.clone(), directional_vector);
        let mut end_line = Line::from_point_vector(end.clone(), directional_vector);
        if start_line.point_is_on_right(end, false) {
            start_line = start_line.reverse();
        }
        if end_line.point_is_on_right(start, false) {
            end_line = end_line.reverse();
        }

        self.ridges
            .iter()
            .filter(|ridge| {
                let line = &ridge.line;
                (!start_line.point_is_on_right(&line.p1, true)
                    || !start_line.point_is_on_right(&line.p2, true))
                    && (!end_line.point_is_on_right(&line.p1, true)
                        || !end_line.point_is_on_right(&line.p2, true)
                        || end_line.line_contains(&line.p1) && end_line.line_contains(&line.p2))
            })
            .cloned()
            .map(TraceLine::from)
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoTrace {
    trace: Trace,
    leaves: BTreeSet<NodeId>,
}

impl RepoTrace {
    pub fn new(trace: Trace, leaves: impl IntoIterator<Item = NodeId>) -> Self {
        Self {
            trace,
            leaves: leaves.into_iter().collect(),
        }
    }

    pub fn from_repository(
        config: &LayoutConfiguration,
        pattern: &LayoutPattern,
        repo: &LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<Self> {
        let mut ridges = Vec::new();
        for index in 0..pattern.devices().len() {
            ridges.extend(pattern.trace_ridges(index, config, repo, tree)?);
        }
        let trace = Trace::new(
            ridges,
            repo.direction(),
            config.side_diagonals(pattern, repo, tree)?,
        );
        Ok(Self::new(trace, repo.node_set.leaves.iter().copied()))
    }

    pub fn from_repo(repo: &LayoutRepository, tree: &BpTree) -> BpResult<Option<Self>> {
        let Some(config) = repo.configuration() else {
            return Ok(None);
        };
        let Some(pattern) = config.pattern() else {
            return Ok(None);
        };
        Self::from_repository(config, pattern, repo, tree).map(Some)
    }

    pub fn trace(&self) -> &Trace {
        &self.trace
    }

    pub fn leaves(&self) -> &BTreeSet<NodeId> {
        &self.leaves
    }

    pub fn resolve_start_end(
        &self,
        filtered: &[Quadrant],
        all: &[Quadrant],
        tree: &BpTree,
    ) -> BpResult<[Point; 2]> {
        let [start, end] = start_end_points(filtered, tree)?;
        let mut start = Point::from_numbers(start.x, start.y)?;
        let mut end = Point::from_numbers(end.x, end.y)?;
        if filtered.len() != all.len() {
            let mut sorted = filtered.to_vec();
            sorted.sort_by(|a, b| a.w.partial_cmp(&b.w).unwrap_or(std::cmp::Ordering::Equal));
            if let Some(first) = sorted
                .first()
                .and_then(|quadrant| all.iter().position(|candidate| candidate == quadrant))
                && first > 0
            {
                let a = all[first - 1].flap;
                let b = all[first].flap;
                if let Some(ridge) = self.intersection_ridge(a, b) {
                    start = ridge.line.p1.clone();
                }
            }
            if let Some(last) = sorted
                .last()
                .and_then(|quadrant| all.iter().position(|candidate| candidate == quadrant))
                && last < all.len().saturating_sub(1)
            {
                let a = all[last].flap;
                let b = all[last + 1].flap;
                if let Some(ridge) = self.intersection_ridge(a, b) {
                    end = ridge.line.p1.clone();
                }
            }
        }
        Ok([start, end])
    }

    fn intersection_ridge(&self, mut a: NodeId, mut b: NodeId) -> Option<&Ridge> {
        if a > b {
            std::mem::swap(&mut a, &mut b);
        }
        self.trace
            .ridges
            .iter()
            .find(|ridge| ridge.division == Some([a, b]))
    }
}

struct TraceContext<'a> {
    trace: &'a Trace,
    hinges: Vec<Line>,
}

impl<'a> TraceContext<'a> {
    fn new(trace: &'a Trace, hinges: &[PathPoint]) -> BpResult<Option<Self>> {
        let hinges = candidate_rough_contour_lines(hinges)?;
        if hinges.is_empty() {
            return Ok(None);
        }
        Ok(Some(Self { trace, hinges }))
    }

    fn get_initial_node(
        &self,
        ridges: &mut Vec<TraceLine>,
        start_diagonal: Option<&SideDiagonal>,
    ) -> BpResult<Option<TraceNode>> {
        let mut start_diagonal = start_diagonal.cloned();
        for hinge in &self.hinges {
            let mut ray = TraceNode {
                point: hinge.p1.clone(),
                vector: hinge.vector(),
                last: None,
            };

            if let Some(diagonal) = start_diagonal.clone()
                && let Some(point) = hinge.intersect_line(&diagonal.line, false)
            {
                let hinge_vector =
                    self.diagonal_hit_initial_vector(hinge, &ray.vector, &diagonal)?;
                if !point.equals(&diagonal.p0) {
                    return Ok(Some(TraceNode {
                        point,
                        vector: hinge_vector,
                        last: None,
                    }));
                }
                ray.vector = hinge_vector;
                ray.point = point.sub_vector(&ray.vector);
                start_diagonal = None;
            }

            let Some(intersection) = get_next_intersection(ridges, &ray, Some(&hinge.p1))? else {
                continue;
            };
            let result = TraceNode {
                point: intersection.point,
                vector: intersection.line.reflect(&ray.vector)?,
                last: None,
            };
            ridges.remove(intersection.index);
            return Ok(Some(result));
        }
        Ok(None)
    }

    fn trim(&self, mut path: Vec<Point>) -> Option<Vec<Point>> {
        if path.len() <= 1 {
            return None;
        }
        let first_line = Line::new(path[0].clone(), path[1].clone());
        let last_line = Line::new(path[path.len() - 2].clone(), path[path.len() - 1].clone());
        if self.test_end_points(&last_line, false) {
            path.pop();
        }
        if self.test_end_points(&first_line, true) {
            path.remove(0);
        }
        (path.len() > 1).then_some(path)
    }

    fn test_end_points(&self, line: &Line, start: bool) -> bool {
        self.hinges.iter().any(|hinge| {
            hinge.contains(if start { &line.p2 } else { &line.p1 }, false)
                && hinge.vector().parallel(&line.vector())
        })
    }

    fn diagonal_hit_initial_vector(
        &self,
        hinge: &Line,
        vector: &Vector,
        diagonal: &SideDiagonal,
    ) -> BpResult<Vector> {
        let corner_is_on_outside = hinge.point_is_on_right(&diagonal.p0, true);
        let forward = self.trace.direction == SlashDirection::Fw;
        let result_is_vertical = forward == corner_is_on_outside;
        let line_is_vertical = vector.x.equals(&BpFraction::ZERO);
        if result_is_vertical == line_is_vertical {
            Ok(vector.clone())
        } else {
            diagonal.reflect(vector)
        }
    }
}

pub fn get_next_intersection(
    ridges: &[TraceLine],
    node: &TraceNode,
    omit: Option<&Point>,
) -> BpResult<Option<RidgeIntersection>> {
    let mut result: Option<RidgeIntersection> = None;
    for (index, ridge) in ridges.iter().enumerate() {
        let Some(intersection) = get_intersection(
            ridge.line(),
            &node.point,
            &node.vector,
            true,
            omit.is_some(),
            ridge.target_as_ray(),
        ) else {
            continue;
        };
        if omit.is_some_and(|point| intersection.point.equals(point)) {
            continue;
        }

        let shift_angle = node.last.as_ref().map(|last| get_angle(&node.vector, last));
        let is_p1 = intersection.point.equals(&ridge.line().p1);
        let is_p2 = intersection.point.equals(&ridge.line().p2);
        if !ridge.is_side_diagonal()
            && !is_shift_touchable(ridge.line(), &node.point, &node.vector, shift_angle)
        {
            continue;
        }

        let candidate = RidgeIntersection {
            index,
            line: ridge.clone(),
            point: intersection.point,
            dist: intersection.dist,
            end_point: is_p1 || is_p2,
            angle: get_angle(&node.vector, &ridge.line().vector()),
        };
        if is_closer(&candidate, result.as_ref()) {
            result = Some(candidate);
        }
    }
    Ok(result)
}

fn raw_mode_final_check(
    result: Option<Vec<Point>>,
    hinges: &[PathPoint],
    last_vec: &Vector,
) -> BpResult<Option<Vec<Point>>> {
    let Some(mut result) = result else {
        return Ok(None);
    };

    let mut hinge_lines = Vec::new();
    let Some(last_point) = result.last() else {
        return Ok(None);
    };
    for i in (1..hinges.len()).rev() {
        let line = Line::new(point_from_path(hinges[i])?, point_from_path(hinges[i - 1])?);
        if line.contains(last_point, true) {
            return Ok(Some(result));
        }
        hinge_lines.push(line);
    }

    if last_vec.x.equals(&BpFraction::ZERO) || last_vec.y.equals(&BpFraction::ZERO) {
        let last = result[result.len() - 1].clone();
        if let Some(intersection) = find_hinge_intersection(&hinge_lines, &last, last_vec) {
            result.push(intersection);
            return Ok(Some(result));
        }
    }

    for i in (1..result.len()).rev() {
        let last = result[i].clone();
        let prev = result[i - 1].clone();
        let vector = last.sub_point(&prev);
        if !vector.x.equals(&BpFraction::ZERO) && !vector.y.equals(&BpFraction::ZERO) {
            break;
        }

        result.pop();
        if let Some(intersection) = find_hinge_intersection(&hinge_lines, &prev, &vector) {
            result.push(intersection);
            return Ok(Some(result));
        }
    }
    Ok(None)
}

fn find_hinge_intersection(hinges: &[Line], point: &Point, vector: &Vector) -> Option<Point> {
    hinges
        .iter()
        .find_map(|hinge| hinge.intersection(point, vector, true, false))
}

fn get_angle(v1: &Vector, v2: &Vector) -> f64 {
    let mut angle = v1.angle() - v2.angle();
    while angle < 0.0 {
        angle += std::f64::consts::PI;
    }
    while angle > std::f64::consts::PI {
        angle -= std::f64::consts::PI;
    }
    angle
}

fn is_closer(candidate: &RidgeIntersection, current: Option<&RidgeIntersection>) -> bool {
    let Some(current) = current else {
        return true;
    };
    candidate.dist.lt(&current.dist)
        || candidate.dist.equals(&current.dist)
            && (candidate.line.is_side_diagonal()
                || !current.line.is_side_diagonal() && candidate.angle < current.angle)
}

fn is_shift_touchable(ridge: &Line, from: &Point, vector: &Vector, angle: Option<f64>) -> bool {
    let rotated_vector = vector.rotate90();
    let v1 = ridge.p1.sub_point(from);
    let v2 = ridge.p2.sub_point(from);
    let r1 = v1.dot(&rotated_vector);
    let r2 = v2.dot(&rotated_vector);
    let d1 = v1.dot(vector);
    let d2 = v2.dot(vector);
    (r1 > 0.0 || r2 > 0.0)
        && (d1 > 0.0
            || d2 > 0.0
            || angle
                .is_some_and(|angle| angle != 0.0 && get_angle(vector, &ridge.vector()) > angle))
}

fn candidate_rough_contour_lines(path: &[PathPoint]) -> BpResult<Vec<Line>> {
    let mut result = Vec::new();
    for i in 0..path.len().saturating_sub(1) {
        result.push(Line::new(
            point_from_path(path[i])?,
            point_from_path(path[i + 1])?,
        ));
    }
    Ok(result)
}

fn point_from_path(point: PathPoint) -> BpResult<Point> {
    Point::from_numbers(point.x, point.y)
}
