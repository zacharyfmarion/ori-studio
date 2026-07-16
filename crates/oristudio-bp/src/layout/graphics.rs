use crate::engine::{ContourData, GraphicsData};
use crate::layout::pattern::LayoutPattern;
use crate::layout::{LayoutConfiguration, LayoutRepository};
use crate::math::geometry::PathPoint;
use crate::model::Point;
use crate::shared::{QUADRANT_NUMBER, QuadrantCode, SlashDirection};
use crate::sweep::PathEx;
use crate::tree::{TreeNode, to_corners};
use crate::{
    error::{BpError, BpResult},
    tree::BpTree,
};
use std::collections::{BTreeMap, BTreeSet};

pub type GraphicsLine = [Point; 2];

#[derive(Debug, Clone, PartialEq)]
pub struct RiverContour {
    pub outer: PathEx,
    pub inner: Vec<Vec<PathPoint>>,
}

pub fn device_graphics(
    pattern: &LayoutPattern,
    device_index: usize,
    config: &LayoutConfiguration,
    repo: &LayoutRepository,
    tree: &BpTree,
) -> BpResult<GraphicsData> {
    let contours = pattern
        .contours(device_index, repo)?
        .into_iter()
        .map(|outer| ContourData {
            outer,
            inner: Vec::new(),
        })
        .collect();
    let ridges = pattern
        .draw_ridges(device_index, config, repo, tree)?
        .iter()
        .map(device_line_data)
        .collect();
    let axis_parallel = pattern
        .axis_parallels(device_index, repo)?
        .iter()
        .map(device_line_data)
        .collect();
    let device = pattern.devices().get(device_index).ok_or_else(|| {
        crate::error::BpError::InvalidInput(format!("missing graphics device {device_index}"))
    })?;
    Ok(GraphicsData {
        contours,
        ridges,
        axis_parallel: Some(axis_parallel),
        range: Some(pattern.dragging_range(device_index, config, repo, tree)?),
        location: Some(device.location()),
        forward: Some(repo.direction() == SlashDirection::Fw),
    })
}

pub fn device_graphics_key(repo: &LayoutRepository, device_index: usize) -> String {
    format!("s{}.{}", repo.stretch_id, device_index)
}

pub fn repo_device_graphics(
    repo: &LayoutRepository,
    tree: &BpTree,
) -> BpResult<Vec<(String, GraphicsData)>> {
    let Some(config) = repo.configuration() else {
        return Ok(Vec::new());
    };
    let Some(pattern) = config.pattern() else {
        return Ok(Vec::new());
    };
    repo_device_graphics_from_selection(repo, config, pattern, tree)
}

pub fn repo_device_graphics_from_selection(
    repo: &LayoutRepository,
    config: &LayoutConfiguration,
    pattern: &LayoutPattern,
    tree: &BpTree,
) -> BpResult<Vec<(String, GraphicsData)>> {
    (0..pattern.devices().len())
        .map(|device_index| {
            Ok((
                device_graphics_key(repo, device_index),
                device_graphics(pattern, device_index, config, repo, tree)?,
            ))
        })
        .collect()
}

pub fn node_graphics(
    node: &TreeNode,
    contours: &[RiverContour],
    patterned_quadrants: &BTreeSet<QuadrantCode>,
    free_corners: &[Point],
) -> GraphicsData {
    let ridges = if node.is_leaf() {
        flap_ridges(node, patterned_quadrants)
    } else {
        river_ridges(node.length, contours, free_corners)
    };
    let contours = contours
        .iter()
        .map(|contour| ContourData {
            outer: path_to_model(&contour.outer.points),
            inner: contour
                .inner
                .iter()
                .map(|inner| path_to_model(inner))
                .collect(),
        })
        .collect::<Vec<_>>();
    GraphicsData {
        contours,
        ridges,
        axis_parallel: None,
        range: None,
        location: None,
        forward: None,
    }
}

pub fn configuration_free_corners(
    config: &LayoutConfiguration,
    pattern: &LayoutPattern,
) -> BpResult<Vec<Point>> {
    let mut result = Vec::new();
    for (device_index, partition) in config.partitions.iter().enumerate() {
        let device = pattern.devices().get(device_index).ok_or_else(|| {
            BpError::InvalidInput(format!("missing free-corner device {device_index}"))
        })?;
        for map in partition.external_corner_maps() {
            result.push(exact_point_to_model(&device.resolve_corner_map(map)?));
        }
    }
    Ok(result)
}

pub fn repo_free_corners(repo: &LayoutRepository) -> BpResult<Vec<Point>> {
    let Some(config) = repo.configuration() else {
        return Ok(Vec::new());
    };
    let Some(pattern) = config.pattern() else {
        return Ok(Vec::new());
    };
    configuration_free_corners(config, pattern)
}

pub fn collect_free_corners(repos: &[&LayoutRepository]) -> BpResult<Vec<Point>> {
    let mut result = Vec::new();
    for repo in repos {
        result.extend(repo_free_corners(repo)?);
    }
    Ok(result)
}

pub fn flap_ridges(
    node: &TreeNode,
    patterned_quadrants: &BTreeSet<QuadrantCode>,
) -> Vec<GraphicsLine> {
    let corners = to_corners(node.aabb.to_values());
    let contour = node.aabb.to_path();
    let mut ridges = Vec::new();
    for i in 0..QUADRANT_NUMBER {
        let p1 = corners[i];
        let p2 = corners.get(i + 1).copied().unwrap_or(corners[0]);
        let c1 = contour[i].point;
        if !same_path_point(p1, p2) {
            ridges.push(line_data(p1, p2));
        }
        let q = (node.id << 2) | i as u32;
        if !patterned_quadrants.contains(&q) {
            ridges.push(line_data(p1, c1));
        }
    }
    ridges
}

pub fn river_ridges(
    width: f64,
    contours: &[RiverContour],
    free_corners: &[Point],
) -> Vec<GraphicsLine> {
    let mut ridges = Vec::new();
    let free_corner_map = FreeCornerMap::new(free_corners);
    for contour in contours {
        if contour.inner.is_empty() {
            continue;
        }
        let side = if contour.outer.is_hole { -1.0 } else { 1.0 };
        let mut inner_right_corners = BTreeMap::<String, [PathPoint; 3]>::new();
        let mut doubled = BTreeSet::<String>::new();
        for path in &contour.inner {
            for [p1, p0, p2] in path_right_corners(path) {
                let key = ordered_point_key(p1);
                match inner_right_corners.entry(key) {
                    std::collections::btree_map::Entry::Occupied(entry) => {
                        doubled.insert(entry.key().clone());
                    }
                    std::collections::btree_map::Entry::Vacant(entry) => {
                        entry.insert([p1, p0, p2]);
                    }
                }
            }
        }

        for [p1, p0, p2] in path_right_corners(&contour.outer.points) {
            let p = corresponding_point(p1, p0, p2, width, side);
            let inner_key = ordered_point_key(p);
            if !try_add_remaining_ridge(p1, p, &free_corner_map, &mut ridges)
                && inner_right_corners.contains_key(&inner_key)
            {
                ridges.push(line_data(p1, p));
                if !doubled.contains(&inner_key) {
                    inner_right_corners.remove(&inner_key);
                }
            }
        }

        for [p1, p0, p2] in inner_right_corners.values().copied() {
            let p = corresponding_point(p1, p0, p2, width, side);
            let _ = try_add_remaining_ridge(p1, p, &free_corner_map, &mut ridges);
        }
    }
    ridges
}

pub fn path_right_corners(path: &[PathPoint]) -> Vec<[PathPoint; 3]> {
    let len = path.len();
    let mut result = Vec::new();
    if len == 0 {
        return result;
    }
    let mut j = len - 1;
    for i in 0..len {
        let p1 = path[i];
        if !is_integer(p1.x) || !is_integer(p1.y) {
            j = i;
            continue;
        }
        let p0 = path[j];
        let p2 = path.get(i + 1).copied().unwrap_or(path[0]);
        let dot = (p1.x - p0.x) * (p2.x - p1.x) + (p1.y - p0.y) * (p2.y - p1.y);
        if dot == 0.0 {
            result.push([p1, p0, p2]);
        }
        j = i;
    }
    result
}

pub fn corresponding_point(
    p1: PathPoint,
    p0: PathPoint,
    p2: PathPoint,
    width: f64,
    side: f64,
) -> PathPoint {
    let fx = js_sign(p2.x - p0.x);
    let fy = js_sign(p2.y - p0.y);
    PathPoint::new(p1.x - side * fy * width, p1.y + side * fx * width)
}

pub fn device_line_data(line: &crate::math::geometry::Line) -> GraphicsLine {
    [
        exact_point_to_model(&line.p1),
        exact_point_to_model(&line.p2),
    ]
}

pub fn path_to_model(path: &[PathPoint]) -> Vec<Point> {
    path.iter().copied().map(path_point_to_model).collect()
}

fn try_add_remaining_ridge(
    p1: PathPoint,
    p: PathPoint,
    free_corner_map: &FreeCornerMap,
    ridges: &mut Vec<GraphicsLine>,
) -> bool {
    let dx = p1.x - p.x;
    let f = if dx == 0.0 {
        f64::INFINITY
    } else {
        (p1.y - p.y) / dx
    };
    if f != 1.0 && f != -1.0 {
        return false;
    }
    let key = p.x - f * p.y;
    let Some(side_corners) = free_corner_map.get(f, key) else {
        return false;
    };
    if let Some(corner) = side_corners
        .iter()
        .copied()
        .find(|corner| point_on_segment(p1, p, *corner))
    {
        ridges.push(line_data(p1, corner));
        return true;
    }
    false
}

#[derive(Debug, Clone, PartialEq)]
struct FreeCornerMap {
    positive: Vec<(f64, Vec<PathPoint>)>,
    negative: Vec<(f64, Vec<PathPoint>)>,
}

impl FreeCornerMap {
    fn new(free_corners: &[Point]) -> Self {
        let mut result = Self {
            positive: Vec::new(),
            negative: Vec::new(),
        };
        for corner in free_corners {
            let point = PathPoint::new(corner.x, corner.y);
            result.push(1.0, corner.x - corner.y, point);
            result.push(-1.0, corner.x + corner.y, point);
        }
        result
    }

    fn push(&mut self, slope: f64, key: f64, point: PathPoint) {
        let entries = if slope == 1.0 {
            &mut self.positive
        } else {
            &mut self.negative
        };
        if let Some((_, points)) = entries.iter_mut().find(|(entry_key, _)| *entry_key == key) {
            points.push(point);
        } else {
            entries.push((key, vec![point]));
        }
    }

    fn get(&self, slope: f64, key: f64) -> Option<&[PathPoint]> {
        let entries = if slope == 1.0 {
            &self.positive
        } else {
            &self.negative
        };
        entries
            .iter()
            .find(|(entry_key, _)| *entry_key == key)
            .map(|(_, points)| points.as_slice())
    }
}

fn line_data(p1: PathPoint, p2: PathPoint) -> GraphicsLine {
    [path_point_to_model(p1), path_point_to_model(p2)]
}

fn path_point_to_model(point: PathPoint) -> Point {
    Point {
        x: point.x,
        y: point.y,
    }
}

fn exact_point_to_model(point: &crate::math::geometry::Point) -> Point {
    let (x, y) = point.value();
    Point { x, y }
}

fn same_path_point(a: PathPoint, b: PathPoint) -> bool {
    a.x == b.x && a.y == b.y
}

fn is_integer(value: f64) -> bool {
    value.fract() == 0.0
}

fn point_on_segment(a: PathPoint, b: PathPoint, point: PathPoint) -> bool {
    let v1 = PathPoint::new(point.x - a.x, point.y - a.y);
    let v2 = PathPoint::new(point.x - b.x, point.y - b.y);
    let cross = v1.x * v2.y - v2.x * v1.y;
    cross == 0.0 && v1.x * v2.x + v1.y * v2.y <= 0.0
}

fn ordered_point_key(point: PathPoint) -> String {
    format!("{}:{}", point.x.to_bits(), point.y.to_bits())
}

fn js_sign(value: f64) -> f64 {
    if value > 0.0 {
        1.0
    } else if value < 0.0 {
        -1.0
    } else {
        0.0
    }
}
