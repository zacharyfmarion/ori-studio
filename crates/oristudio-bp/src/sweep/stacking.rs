use super::{PathEx, StatusEntry, build_general_events, exit_first_status_cmp, status_key};
use crate::data::bst::RavlTree;
use crate::math::geometry::PathPoint;

#[derive(Debug, Clone, PartialEq)]
pub struct Contour {
    pub outer: Vec<PathPoint>,
    pub inner: Vec<Vec<PathPoint>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ContourEx {
    pub outer: PathEx,
    pub inner: Vec<PathEx>,
}

#[derive(Debug, Clone, Default)]
pub struct Stacking;

impl Stacking {
    pub fn new() -> Self {
        Self
    }

    pub fn get(&mut self, paths: &[Vec<PathPoint>]) -> Vec<Contour> {
        get_stacking(paths)
    }

    pub fn get_ex(&mut self, paths: &[PathEx]) -> Vec<ContourEx> {
        get_stacking_ex(paths)
    }
}

pub fn get_stacking(paths: &[Vec<PathPoint>]) -> Vec<Contour> {
    let parents = stacking_parents(paths);
    let mut result: Vec<(usize, Contour)> = Vec::new();
    for (i, path) in paths.iter().enumerate() {
        match parents.get(i).copied().flatten() {
            None => {
                contour_index(&mut result, i, paths);
            }
            Some(parent) => {
                let index = contour_index(&mut result, parent, paths);
                result[index].1.inner.push(path.clone());
            }
        }
    }
    result.into_iter().map(|(_, contour)| contour).collect()
}

pub fn get_stacking_ex(paths: &[PathEx]) -> Vec<ContourEx> {
    let points = paths
        .iter()
        .map(|path| path.points.clone())
        .collect::<Vec<_>>();
    let parents = stacking_parents(&points);
    let mut result: Vec<(usize, ContourEx)> = Vec::new();
    for (i, path) in paths.iter().enumerate() {
        match parents.get(i).copied().flatten() {
            None => {
                contour_ex_index(&mut result, i, paths);
            }
            Some(parent) => {
                let index = contour_ex_index(&mut result, parent, paths);
                result[index].1.inner.push(path.clone());
            }
        }
    }
    result.into_iter().map(|(_, contour)| contour).collect()
}

fn stacking_parents(paths: &[Vec<PathPoint>]) -> Vec<Option<usize>> {
    let events = build_general_events(paths);
    let mut status = RavlTree::new(exit_first_status_cmp);
    let mut start_keys: Vec<Option<_>> = Vec::new();
    let mut parents: Vec<Option<Option<usize>>> = vec![None; paths.len()];

    for mut event in events {
        let Some(key) = status_key(&event) else {
            if let Some(Some(other)) = start_keys.get(event.other_key) {
                status.delete(other);
            }
            continue;
        };

        status.insert(
            key.clone(),
            StatusEntry {
                polygon: key.segment.polygon,
                wrap_count: event.wrap_count,
            },
        );

        let prev = status.get_prev(&key);
        if let Some(prev) = &prev {
            event.wrap_count += prev.wrap_count;
        }
        status.insert(
            key.clone(),
            StatusEntry {
                polygon: key.segment.polygon,
                wrap_count: event.wrap_count,
            },
        );

        let index = key.segment.polygon;
        if parents[index].is_none() {
            parents[index] = if event.wrap_delta == 1 || prev.is_none() {
                Some(None)
            } else {
                parent_from_previous(prev.as_ref(), &parents)
            };
        }

        if start_keys.len() <= event.key {
            start_keys.resize(event.key + 1, None);
        }
        start_keys[event.key] = Some(key);
    }
    parents
        .into_iter()
        .map(|parent| match parent {
            Some(Some(parent)) => Some(parent),
            _ => None,
        })
        .collect()
}

fn contour_index(
    contours: &mut Vec<(usize, Contour)>,
    outer_index: usize,
    paths: &[Vec<PathPoint>],
) -> usize {
    if let Some(position) = contours.iter().position(|(index, _)| *index == outer_index) {
        return position;
    }
    contours.push((
        outer_index,
        Contour {
            outer: paths[outer_index].clone(),
            inner: Vec::new(),
        },
    ));
    contours.len() - 1
}

fn contour_ex_index(
    contours: &mut Vec<(usize, ContourEx)>,
    outer_index: usize,
    paths: &[PathEx],
) -> usize {
    if let Some(position) = contours.iter().position(|(index, _)| *index == outer_index) {
        return position;
    }
    contours.push((
        outer_index,
        ContourEx {
            outer: paths[outer_index].clone(),
            inner: Vec::new(),
        },
    ));
    contours.len() - 1
}

fn parent_from_previous(
    prev: Option<&StatusEntry>,
    parents: &[Option<Option<usize>>],
) -> Option<Option<usize>> {
    let prev = prev?;
    match parents.get(prev.polygon) {
        Some(Some(None)) => Some(Some(prev.polygon)),
        Some(Some(Some(parent))) => Some(Some(*parent)),
        _ => None,
    }
}
