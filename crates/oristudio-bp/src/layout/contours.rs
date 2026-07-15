use crate::error::BpResult;
use crate::layout::trace::{RepoTrace, create_hinge_segments};
use crate::layout::{LayoutRepository, NodeSet, Quadrant, ValidJunction, get_factors};
use crate::math::geometry::{
    EPSILON, Line, PathPoint, Point, deduplicate, fix_zero, map_directions,
};
use crate::model::NodeId;
use crate::shared::{QUADRANT_NUMBER, QuadrantDirection, get_quadrant};
use crate::sweep::{AaUnion, Contour, GeneralUnion, PathEx, RoughUnion, Stacking};
use crate::tree::TreeNode;
use crate::{error::BpError, tree::BpTree};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq)]
pub struct RoughContour {
    pub id: NodeId,
    pub outer: Vec<PathEx>,
    pub children: Vec<RoughContour>,
    pub leaves: Vec<NodeId>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ContourPath {
    pub points: Vec<PathPoint>,
    pub is_hole: bool,
    pub leaves: Option<Vec<NodeId>>,
}

impl ContourPath {
    pub fn new(points: Vec<PathPoint>) -> Self {
        Self {
            points,
            is_hole: false,
            leaves: None,
        }
    }

    pub fn from_path_ex(path: &PathEx) -> Self {
        Self {
            points: path.points.clone(),
            is_hole: path.is_hole,
            leaves: None,
        }
    }

    pub fn with_leaves(mut self, leaves: Vec<NodeId>) -> Self {
        self.leaves = Some(leaves);
        self
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TraceContour {
    pub outer: Vec<ContourPath>,
    pub inner: Vec<ContourPath>,
    pub leaves: Vec<NodeId>,
    pub raw: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatternContour {
    pub points: Vec<Point>,
    pub ids: Vec<NodeId>,
    pub repo: Option<String>,
    pub for_index: Option<usize>,
    pub leaves: Vec<NodeId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RationalPathEx {
    pub points: Vec<Point>,
    pub is_hole: bool,
    pub leaves: Option<Vec<NodeId>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RationalContour {
    pub outer: Vec<RationalPathEx>,
    pub inner: Vec<RationalPathEx>,
    pub leaves: Vec<NodeId>,
    pub raw: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GraphicalContour {
    pub outer: PathEx,
    pub inner: Vec<Vec<PathPoint>>,
}

impl From<GraphicalContour> for Contour {
    fn from(contour: GraphicalContour) -> Self {
        Self {
            outer: contour.outer.points,
            inner: contour.inner,
        }
    }
}

pub type StartEndMap = [Option<[Point; 2]>; QUADRANT_NUMBER];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeafSet {
    pub leaves: Vec<NodeId>,
    pub has_overlapping: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CriticalCorner {
    pub signature: String,
    pub flap: NodeId,
    pub node_set: NodeSet,
}

pub fn leaf_rough_contour(node: &TreeNode) -> RoughContour {
    RoughContour {
        id: node.id,
        outer: vec![PathEx {
            points: node
                .aabb
                .to_path()
                .into_iter()
                .map(|point| point.point)
                .collect(),
            is_hole: false,
            from: None,
        }],
        children: Vec::new(),
        leaves: vec![node.id],
    }
}

pub fn build_rough_contours(tree: &BpTree) -> BpResult<BTreeMap<NodeId, Vec<RoughContour>>> {
    let mut result = BTreeMap::new();
    let root = tree.root_id();
    build_rough_contours_inner(root, tree, &mut result)?;
    Ok(result)
}

pub fn build_trace_contours(
    tree: &BpTree,
    rough_contours: &BTreeMap<NodeId, Vec<RoughContour>>,
    repos: &[&LayoutRepository],
    covered_junctions: &BTreeMap<NodeId, Vec<ValidJunction>>,
) -> BpResult<BTreeMap<NodeId, Vec<TraceContour>>> {
    let mut result = BTreeMap::new();
    for (id, roughs) in rough_contours {
        let node = tree
            .node(*id)
            .ok_or_else(|| BpError::InvalidInput(format!("missing trace contour node {id}")))?;
        let contours =
            create_trace_contours_for_node(node, roughs, repos, tree, covered_junctions)?;
        result.insert(*id, contours);
    }
    Ok(result)
}

pub fn create_trace_contours_for_node(
    node: &TreeNode,
    rough_contours: &[RoughContour],
    repos: &[&LayoutRepository],
    tree: &BpTree,
    covered_junctions: &BTreeMap<NodeId, Vec<ValidJunction>>,
) -> BpResult<Vec<TraceContour>> {
    rough_contours
        .iter()
        .map(|rough| create_trace_contour_recursive(node, rough, repos, tree, covered_junctions))
        .collect()
}

pub fn critical_corners_for_node(
    node: &TreeNode,
    repos: &[&LayoutRepository],
    tree: &BpTree,
) -> BpResult<Vec<CriticalCorner>> {
    let mut result = Vec::new();
    for repo in repos {
        let Some(codes) = repo.node_set.quadrant_coverage.get(&node.id) else {
            continue;
        };
        for code in codes {
            let quadrant = repo.quadrants.get(code).ok_or_else(|| {
                BpError::InvalidInput(format!("missing critical corner quadrant {code}"))
            })?;
            let flap = tree.node(quadrant.flap).ok_or_else(|| {
                BpError::InvalidInput(format!("missing critical corner flap {}", quadrant.flap))
            })?;
            let distance = flap.dist - node.dist + node.length;
            let corner = quadrant.corner(tree, distance)?;
            result.push(CriticalCorner {
                signature: corner_signature(PathPoint::new(corner.x, corner.y), quadrant.q),
                flap: quadrant.flap,
                node_set: repo.node_set.clone(),
            });
        }
    }
    Ok(result)
}

pub fn create_trace_contour(
    node: &TreeNode,
    rough_contour: &RoughContour,
    critical_corners: &[CriticalCorner],
    child_traces: &[TraceContour],
    tree: &BpTree,
    covered_junctions: &BTreeMap<NodeId, Vec<ValidJunction>>,
) -> BpResult<TraceContour> {
    let leaves = rough_contour.leaves.clone();
    let mut result = TraceContour {
        outer: rough_contour
            .outer
            .iter()
            .map(ContourPath::from_path_ex)
            .collect(),
        inner: Vec::new(),
        leaves: leaves.clone(),
        raw: false,
    };

    if leaves.len() > 1 {
        let mut corner_map = BTreeMap::<String, CriticalCorner>::new();
        for corner in critical_corners {
            if leaves.contains(&corner.flap) {
                corner_map.insert(corner.signature.clone(), corner.clone());
            }
        }
        let mut corners = corner_map.keys().cloned().collect::<BTreeSet<_>>();
        if !check_critical_corners(&result.outer, &mut corners) {
            let node_sets = corner_map
                .into_values()
                .map(|corner| corner.node_set)
                .collect::<Vec<_>>();
            result.outer = create_raw_contour(
                node,
                &node_sets,
                &leaves,
                &rough_contour.children,
                tree,
                covered_junctions,
            )?;
            result.raw = true;
        }
    }

    if result.raw {
        result.inner = child_traces
            .iter()
            .flat_map(|trace| {
                trace.outer.iter().cloned().map(|mut outer| {
                    outer.leaves = Some(trace.leaves.clone());
                    outer
                })
            })
            .collect();
    } else {
        let components = child_traces
            .iter()
            .flat_map(|trace| {
                if trace.raw {
                    trace
                        .outer
                        .iter()
                        .map(|outer| vec![outer.points.clone()])
                        .collect::<Vec<_>>()
                } else {
                    vec![
                        trace
                            .outer
                            .iter()
                            .map(|outer| outer.points.clone())
                            .collect::<Vec<_>>(),
                    ]
                }
            })
            .collect::<Vec<_>>();
        result.inner = AaUnion::new(false)
            .get(&components)
            .iter()
            .map(ContourPath::from_path_ex)
            .collect();
    }

    Ok(result)
}

fn build_rough_contours_inner(
    id: NodeId,
    tree: &BpTree,
    result: &mut BTreeMap<NodeId, Vec<RoughContour>>,
) -> BpResult<Vec<RoughContour>> {
    let node = tree
        .node(id)
        .ok_or_else(|| BpError::InvalidInput(format!("missing rough contour node {id}")))?;
    let contours = if node.is_leaf() {
        vec![leaf_rough_contour(node)]
    } else {
        let mut children = Vec::new();
        for child in &node.children {
            children.extend(build_rough_contours_inner(*child, tree, result)?);
        }
        expand_rough_contours(&children, node.length, node.id)
    };
    if node.parent.is_some() {
        result.insert(id, contours.clone());
    }
    Ok(contours)
}

fn create_trace_contour_recursive(
    node: &TreeNode,
    rough_contour: &RoughContour,
    repos: &[&LayoutRepository],
    tree: &BpTree,
    covered_junctions: &BTreeMap<NodeId, Vec<ValidJunction>>,
) -> BpResult<TraceContour> {
    let child_traces = rough_contour
        .children
        .iter()
        .map(|child| {
            let child_node = tree.node(child.id).ok_or_else(|| {
                BpError::InvalidInput(format!("missing child trace contour node {}", child.id))
            })?;
            create_trace_contour_recursive(child_node, child, repos, tree, covered_junctions)
        })
        .collect::<BpResult<Vec<_>>>()?;
    let critical_corners = critical_corners_for_node(node, repos, tree)?;
    create_trace_contour(
        node,
        rough_contour,
        &critical_corners,
        &child_traces,
        tree,
        covered_junctions,
    )
}

pub fn expand_rough_contours(inputs: &[RoughContour], units: f64, id: NodeId) -> Vec<RoughContour> {
    let components = inputs
        .iter()
        .map(|contour| {
            let mut result = Vec::new();
            for outer in &contour.outer {
                if outer.is_hole && span(outer) <= units * 2.0 {
                    continue;
                }
                result.push(expand_path(outer, units).points);
            }
            result
        })
        .collect::<Vec<_>>();

    RoughUnion::new()
        .union(&components)
        .into_iter()
        .map(|component| {
            let outer = component
                .paths
                .into_iter()
                .map(|path| simplify(&path))
                .collect();
            let children = component
                .from
                .iter()
                .filter_map(|index| inputs.get(*index).cloned())
                .collect::<Vec<_>>();
            let leaves = children
                .iter()
                .flat_map(|contour| contour.leaves.iter().copied())
                .collect();
            RoughContour {
                id,
                outer,
                children,
                leaves,
            }
        })
        .collect()
}

pub fn combine_contours(
    trace_contours: &[TraceContour],
    pattern_contours: &[PatternContour],
    child_pattern_contours: &[PatternContour],
) -> BpResult<Vec<Contour>> {
    Ok(
        combine_graphical_contours(trace_contours, pattern_contours, child_pattern_contours)?
            .into_iter()
            .map(Contour::from)
            .collect(),
    )
}

pub fn combine_graphical_contours(
    trace_contours: &[TraceContour],
    pattern_contours: &[PatternContour],
    child_pattern_contours: &[PatternContour],
) -> BpResult<Vec<GraphicalContour>> {
    let mut result = trace_contours
        .iter()
        .map(to_rational_contour)
        .collect::<BpResult<Vec<_>>>()?;
    insert_outer(pattern_contours, &mut result);
    insert_inner(child_pattern_contours, &mut result);
    let mut contours = Vec::new();
    for contour in &result {
        contours.extend(to_graphical_contours_ex(contour)?);
    }
    Ok(contours)
}

pub fn process_pattern_contours(
    trace_contours: &[TraceContour],
    covered_quadrants: &[Quadrant],
    trace: &RepoTrace,
    repo: &LayoutRepository,
    tree: &BpTree,
) -> BpResult<Vec<PatternContour>> {
    let multi_contour = trace_contours.len() > 1;
    let mut result = Vec::new();
    for (index, trace_contour) in trace_contours.iter().enumerate() {
        let trace_leaves = trace_contour
            .leaves
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        for outer in &trace_contour.outer {
            let leaves = if let Some(leaves) = &outer.leaves {
                leaves
                    .iter()
                    .copied()
                    .filter(|leaf| trace.leaves().contains(leaf))
                    .collect::<Vec<_>>()
            } else {
                trace_contour.leaves.clone()
            };

            if trace_contour.raw && raw_component_is_irrelevant(&leaves, &trace_leaves, repo)? {
                continue;
            }

            let quadrants = covered_quadrants
                .iter()
                .filter(|quadrant| !multi_contour || leaves.contains(&quadrant.flap))
                .cloned()
                .collect::<Vec<_>>();
            let map = create_start_end_map(&quadrants, trace, repo, tree)?;
            for hinge_segment in create_hinge_segments(&outer.points, repo.direction()) {
                let Some([start, end]) = &map[hinge_segment.q as usize] else {
                    continue;
                };
                if let Some(points) =
                    trace
                        .trace()
                        .generate(&hinge_segment.points, start, end, trace_contour.raw)?
                {
                    result.push(PatternContour {
                        points,
                        ids: repo.node_set.nodes.clone(),
                        repo: Some(repo.signature.clone()),
                        for_index: Some(index),
                        leaves: leaves.clone(),
                    });
                }
            }
        }
    }
    Ok(result)
}

pub fn build_pattern_contours(
    tree: &BpTree,
    trace_contours: &BTreeMap<NodeId, Vec<TraceContour>>,
    repos: &[&LayoutRepository],
) -> BpResult<BTreeMap<NodeId, Vec<PatternContour>>> {
    let mut result = BTreeMap::<NodeId, Vec<PatternContour>>::new();
    for repo in repos {
        let Some(trace) = RepoTrace::from_repo(repo, tree)? else {
            continue;
        };
        for (node_id, codes) in &repo.node_set.quadrant_coverage {
            let Some(node_trace_contours) = trace_contours.get(node_id) else {
                continue;
            };
            let covered_quadrants = codes
                .iter()
                .map(|code| {
                    repo.quadrants.get(code).cloned().ok_or_else(|| {
                        BpError::InvalidInput(format!(
                            "missing pattern contour covered quadrant {code}"
                        ))
                    })
                })
                .collect::<BpResult<Vec<_>>>()?;
            let contours = process_pattern_contours(
                node_trace_contours,
                &covered_quadrants,
                &trace,
                repo,
                tree,
            )?;
            if !contours.is_empty() {
                result.entry(*node_id).or_default().extend(contours);
            }
        }
    }
    Ok(result)
}

pub fn create_start_end_map(
    quadrants: &[Quadrant],
    trace: &RepoTrace,
    repo: &LayoutRepository,
    tree: &BpTree,
) -> BpResult<StartEndMap> {
    let mut result: StartEndMap = std::array::from_fn(|_| None);
    for (q, slot) in result.iter_mut().enumerate() {
        let filtered = quadrants
            .iter()
            .filter(|quadrant| quadrant.q as usize == q)
            .cloned()
            .collect::<Vec<_>>();
        if filtered.is_empty() {
            continue;
        }
        let all = repo.directional_quadrants[q]
            .iter()
            .map(|code| {
                repo.quadrants.get(code).cloned().ok_or_else(|| {
                    BpError::InvalidInput(format!("missing directional quadrant {code}"))
                })
            })
            .collect::<BpResult<Vec<_>>>()?;
        *slot = Some(trace.resolve_start_end(&filtered, &all, tree)?);
    }
    Ok(result)
}

pub fn corner_signature(point: PathPoint, dir: QuadrantDirection) -> String {
    format!("{},{},{}", point.x, point.y, dir as u8)
}

pub fn check_critical_corners(paths: &[ContourPath], corners: &mut BTreeSet<String>) -> bool {
    for path in paths {
        let dirs = map_directions(&path.points);
        for (index, point) in path.points.iter().enumerate() {
            if let Some(dir) = dirs.get(index).and_then(|dir| quadrant_direction(*dir)) {
                corners.remove(&corner_signature(*point, dir));
            }
        }
    }
    corners.is_empty()
}

pub fn create_leaf_sets(
    node_sets: &[NodeSet],
    remaining_leaves: &mut BTreeSet<NodeId>,
) -> Vec<LeafSet> {
    let mut leaf_sets = node_sets
        .iter()
        .map(|node_set| LeafSet {
            leaves: node_set
                .leaves
                .iter()
                .copied()
                .filter(|id| remaining_leaves.contains(id))
                .collect(),
            has_overlapping: false,
        })
        .collect::<Vec<_>>();
    let mut leaf_map = BTreeMap::<NodeId, usize>::new();
    for index in 0..leaf_sets.len() {
        for id in leaf_sets[index].leaves.clone() {
            remaining_leaves.remove(&id);
            if let Some(previous) = leaf_map.get(&id).copied() {
                if let Some(leaf_set) = leaf_sets.get_mut(previous) {
                    leaf_set.has_overlapping = true;
                }
                leaf_sets[index].has_overlapping = true;
                break;
            }
            leaf_map.insert(id, index);
        }
    }
    leaf_sets
}

pub fn create_raw_contour(
    node: &TreeNode,
    node_sets: &[NodeSet],
    leaves: &[NodeId],
    children: &[RoughContour],
    tree: &BpTree,
    covered_junctions: &BTreeMap<NodeId, Vec<ValidJunction>>,
) -> BpResult<Vec<ContourPath>> {
    let mut remaining_leaves = leaves.iter().copied().collect::<BTreeSet<_>>();
    let mut result = Vec::new();
    let leaf_sets = create_leaf_sets(node_sets, &mut remaining_leaves);
    let mut shared_leaves = BTreeSet::new();
    for leaf_set in leaf_sets {
        if leaf_set.has_overlapping {
            shared_leaves.extend(leaf_set.leaves);
        } else {
            let mut outers = leaf_set
                .leaves
                .iter()
                .map(|id| {
                    let leaf = tree.node(*id).ok_or_else(|| {
                        BpError::InvalidInput(format!("missing raw contour leaf {id}"))
                    })?;
                    create_raw_contour_for_leaf(
                        node,
                        leaf,
                        covered_junctions.get(id).map_or(&[], Vec::as_slice),
                    )
                })
                .collect::<BpResult<Vec<_>>>()?;
            if outers.len() > 1 {
                outers = AaUnion::new(false).get(&path_components(&outers));
            }
            result.extend(pack_paths(outers, leaf_set.leaves));
        }
    }

    for id in shared_leaves {
        let leaf = tree.node(id).ok_or_else(|| {
            BpError::InvalidInput(format!("missing shared raw contour leaf {id}"))
        })?;
        result.extend(pack_paths(
            vec![create_raw_contour_for_leaf(
                node,
                leaf,
                covered_junctions.get(&id).map_or(&[], Vec::as_slice),
            )?],
            vec![id],
        ));
    }

    if !remaining_leaves.is_empty() {
        let paths = recursive_expand(node, children, &remaining_leaves, node.length, tree)?;
        let outers = AaUnion::new(true).get(&path_components(&paths));
        result.extend(pack_paths(outers, remaining_leaves.into_iter().collect()));
    }

    Ok(result)
}

pub fn recursive_expand(
    node: &TreeNode,
    children: &[RoughContour],
    remaining_leaves: &BTreeSet<NodeId>,
    length: f64,
    tree: &BpTree,
) -> BpResult<Vec<PathEx>> {
    let mut result = Vec::new();
    for child in children {
        let leaves = child
            .leaves
            .iter()
            .copied()
            .filter(|id| remaining_leaves.contains(id))
            .collect::<Vec<_>>();
        if leaves.len() == 1 {
            let id = leaves[0];
            let leaf = tree.node(id).ok_or_else(|| {
                BpError::InvalidInput(format!("missing recursive raw contour leaf {id}"))
            })?;
            result.push(create_raw_contour_for_leaf(node, leaf, &[])?);
        } else if leaves.len() == child.leaves.len() {
            result.extend(child.outer.iter().map(|outer| expand_path(outer, length)));
        } else if !leaves.is_empty() {
            let child_node = tree.node(child.id).ok_or_else(|| {
                BpError::InvalidInput(format!("missing recursive raw contour child {}", child.id))
            })?;
            result.extend(recursive_expand(
                node,
                &child.children,
                remaining_leaves,
                length + child_node.length,
                tree,
            )?);
        }
    }
    Ok(result)
}

pub fn create_raw_contour_for_leaf(
    node: &TreeNode,
    leaf: &TreeNode,
    covered_junctions: &[ValidJunction],
) -> BpResult<PathEx> {
    let leaf_contour = leaf_rough_contour(leaf);
    let outer = leaf_contour
        .outer
        .first()
        .ok_or_else(|| BpError::InvalidInput("leaf rough contour has no outer".to_string()))?;
    let length = leaf.dist - node.dist - leaf.length + node.length;
    let result = expand_path(outer, length);
    if covered_junctions.is_empty() {
        return Ok(result);
    }

    let mut final_points = Vec::new();
    let mut quadrants: [Option<crate::model::Point>; QUADRANT_NUMBER] =
        std::array::from_fn(|_| None);
    for junction in covered_junctions {
        let code = if junction.a == leaf.id {
            junction.q1
        } else {
            junction.q2
        };
        quadrants[get_quadrant(code) as usize] = Some(junction.o);
    }

    for (q, point) in result.points.iter().copied().enumerate() {
        let Some(mut rect) = quadrants[q] else {
            final_points.push(point);
            continue;
        };
        if rect.x > length {
            rect.x = length;
        }
        if rect.y > length {
            rect.y = length;
        }
        let direction = quadrant_direction(q as u8)
            .ok_or_else(|| BpError::InvalidInput(format!("invalid raw contour quadrant {q}")))?;
        let f = get_factors(direction);
        let pxy = PathPoint::new(point.x - f.x * rect.x, point.y - f.y * rect.y);
        let py = PathPoint::new(point.x, pxy.y);
        let px = PathPoint::new(pxy.x, point.y);
        if q % 2 == 1 {
            final_points.extend([px, pxy, py]);
        } else {
            final_points.extend([py, pxy, px]);
        }
    }

    Ok(PathEx {
        points: final_points,
        is_hole: result.is_hole,
        from: result.from,
    })
}

fn raw_component_is_irrelevant(
    leaves: &[NodeId],
    trace_leaves: &BTreeSet<NodeId>,
    repo: &LayoutRepository,
) -> BpResult<bool> {
    for leaf in leaves {
        let opposites = repo.opposite_map.get(leaf).ok_or_else(|| {
            BpError::InvalidInput(format!("missing opposite map entry for leaf {leaf}"))
        })?;
        if !opposites
            .iter()
            .all(|opposite| trace_leaves.contains(opposite))
        {
            return Ok(false);
        }
    }
    Ok(true)
}

fn quadrant_direction(value: u8) -> Option<QuadrantDirection> {
    match value {
        0 => Some(QuadrantDirection::Ur),
        1 => Some(QuadrantDirection::Ul),
        2 => Some(QuadrantDirection::Ll),
        3 => Some(QuadrantDirection::Lr),
        _ => None,
    }
}

pub fn insert_outer(pattern_contours: &[PatternContour], result: &mut [RationalContour]) {
    for contour in pattern_contours {
        if let Some(index) = contour.for_index {
            if let Some(rough) = result.get_mut(index) {
                let _ = try_insert_outer(contour, rough);
            }
        } else {
            for rough in result.iter_mut() {
                if try_insert_outer(contour, rough) {
                    break;
                }
            }
        }
    }
}

pub fn insert_inner(child_pattern_contours: &[PatternContour], result: &mut [RationalContour]) {
    for child_contour in child_pattern_contours {
        try_insert_inner(child_contour, result);
    }
}

pub fn try_insert_outer(pattern_contour: &PatternContour, rough: &mut RationalContour) -> bool {
    for outer in &mut rough.outer {
        if try_insert(&mut outer.points, pattern_contour) {
            return true;
        }
    }
    false
}

pub fn try_insert_inner(child_contour: &PatternContour, result: &mut [RationalContour]) {
    for contour in result {
        for inner in &mut contour.inner {
            let leaves = inner.leaves.as_ref().unwrap_or(&contour.leaves);
            if child_contour
                .leaves
                .iter()
                .any(|leaf| !leaves.contains(leaf))
            {
                continue;
            }
            if try_insert(&mut inner.points, child_contour) {
                return;
            }
        }
    }
}

pub fn try_insert(path: &mut Vec<Point>, insert: &PatternContour) -> bool {
    let Some(first) = insert.points.first() else {
        return false;
    };
    let Some(last) = insert.points.last() else {
        return false;
    };
    let len = path.len();
    let mut start = None;
    let mut end = None;
    for i in 0..len {
        let line = Line::new(path[i].clone(), path.get(i + 1).unwrap_or(&path[0]).clone());
        if start.is_none() && (line.contains(first, false) || line.p1.equals(first)) {
            start = Some(i + 1);
        }
        if end.is_none() && (line.contains(last, false) || line.p2.equals(last)) {
            end = Some(i + 1);
        }
        if let (Some(start), Some(end)) = (start, end)
            && start != end
        {
            if end > start {
                path.splice(start..end, insert.points.clone());
            } else {
                path.truncate(start);
                path.drain(0..end);
                path.extend(insert.points.clone());
            }
            return true;
        }
    }
    false
}

pub fn to_rational_contour(contour: &TraceContour) -> BpResult<RationalContour> {
    Ok(RationalContour {
        outer: contour
            .outer
            .iter()
            .map(to_rational_path)
            .collect::<BpResult<Vec<_>>>()?,
        inner: contour
            .inner
            .iter()
            .map(to_rational_path)
            .collect::<BpResult<Vec<_>>>()?,
        leaves: contour.leaves.clone(),
        raw: contour.raw,
    })
}

pub fn to_graphical_contours(contour: &RationalContour) -> BpResult<Vec<Contour>> {
    Ok(to_graphical_contours_ex(contour)?
        .into_iter()
        .map(Contour::from)
        .collect())
}

pub fn to_graphical_contours_ex(contour: &RationalContour) -> BpResult<Vec<GraphicalContour>> {
    let mut outers = contour
        .outer
        .iter()
        .map(to_path_ex)
        .collect::<Vec<_>>()
        .into_iter()
        .map(|path| simplify(&path))
        .collect::<Vec<_>>();
    let mut inners = contour
        .inner
        .iter()
        .map(to_path_ex)
        .collect::<Vec<_>>()
        .into_iter()
        .map(|path| reverse(&simplify(&path)))
        .collect::<Vec<_>>();

    rearrange_role(&mut outers, &mut inners);
    if contour.raw {
        let outer_components = path_components(&outers);
        outers = GeneralUnion::new().get(&outer_components);
        let reversed_inners = inners.iter().map(reverse).collect::<Vec<_>>();
        let inner_components = path_components(&reversed_inners);
        inners = GeneralUnion::new()
            .get(&inner_components)
            .into_iter()
            .map(|path| reverse(&path))
            .collect();
        rearrange_role(&mut outers, &mut inners);
    }
    outers = clean_up(outers);
    inners = clean_up(inners);

    if outers.len() == 1 {
        return Ok(vec![GraphicalContour {
            outer: outers.remove(0),
            inner: inners.into_iter().map(|inner| inner.points).collect(),
        }]);
    }

    let paths = outers.into_iter().chain(inners).collect::<Vec<_>>();
    Ok(Stacking::new()
        .get_ex(&paths)
        .into_iter()
        .map(|contour| GraphicalContour {
            outer: contour.outer,
            inner: contour
                .inner
                .into_iter()
                .map(|inner| inner.points)
                .collect(),
        })
        .collect())
}

pub fn expand_path(path: &PathEx, units: f64) -> PathEx {
    let len = path.points.len();
    let mut points = Vec::with_capacity(len);
    for i in 0..len {
        let j = if i == 0 { len - 1 } else { i - 1 };
        let point = path.points[i];
        let prev = path.points[j];
        let next = path.points.get(i + 1).copied().unwrap_or(path.points[0]);
        let dx = js_sign(next.y - prev.y) * units;
        let dy = js_sign(prev.x - next.x) * units;
        points.push(PathPoint::new(point.x + dx, point.y + dy));
    }
    PathEx {
        points,
        is_hole: path.is_hole,
        from: path.from,
    }
}

pub fn simplify(path: &PathEx) -> PathEx {
    if path.points.is_empty() {
        return PathEx {
            points: Vec::new(),
            is_hole: path.is_hole,
            from: path.from,
        };
    }
    let mut deduplicated = deduplicate(&path.points);
    let len = deduplicated.len();
    if len == 0 {
        return PathEx {
            points: Vec::new(),
            is_hole: path.is_hole,
            from: path.from,
        };
    }
    deduplicated.push(deduplicated[0]);
    let mut points = Vec::new();
    for i in 0..len {
        let j = if i == 0 { len - 1 } else { i - 1 };
        let prev = deduplicated[j];
        let next = deduplicated[i + 1];
        let dx = next.x - prev.x;
        let dy = next.y - prev.y;
        if dx != 0.0 && dy != 0.0 {
            points.push(deduplicated[i]);
        }
    }
    PathEx {
        points,
        is_hole: path.is_hole,
        from: path.from,
    }
}

pub fn span(path: &PathEx) -> f64 {
    let mut x_min = f64::INFINITY;
    let mut x_max = f64::NEG_INFINITY;
    let mut y_min = f64::INFINITY;
    let mut y_max = f64::NEG_INFINITY;
    for point in &path.points {
        x_min = x_min.min(point.x);
        x_max = x_max.max(point.x);
        y_min = y_min.min(point.y);
        y_max = y_max.max(point.y);
    }
    (x_max - x_min).min(y_max - y_min)
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

fn to_rational_path(path: &ContourPath) -> BpResult<RationalPathEx> {
    Ok(RationalPathEx {
        points: path
            .points
            .iter()
            .map(|point| Point::from_numbers(point.x, point.y))
            .collect::<BpResult<Vec<_>>>()?,
        is_hole: path.is_hole,
        leaves: path.leaves.clone(),
    })
}

fn to_path_ex(path: &RationalPathEx) -> PathEx {
    PathEx {
        points: path
            .points
            .iter()
            .map(|point| {
                let (x, y) = point.value();
                PathPoint::new(x, y)
            })
            .collect(),
        is_hole: path.is_hole,
        from: None,
    }
}

fn reverse(path: &PathEx) -> PathEx {
    let mut points = path.points.clone();
    points.reverse();
    PathEx {
        points,
        is_hole: !path.is_hole,
        from: path.from,
    }
}

fn clean_up(paths: Vec<PathEx>) -> Vec<PathEx> {
    paths
        .into_iter()
        .map(|path| simplify(&path))
        .filter(|path| path.points.len() > 2)
        .map(fix_path)
        .collect()
}

fn rearrange_role(outers: &mut Vec<PathEx>, inners: &mut Vec<PathEx>) {
    let outer_hole = outers
        .iter()
        .filter(|path| path.is_hole)
        .cloned()
        .collect::<Vec<_>>();
    let inner_fill = inners
        .iter()
        .filter(|path| !path.is_hole)
        .cloned()
        .collect::<Vec<_>>();
    let outer_fill = outers
        .iter()
        .filter(|path| !path.is_hole)
        .cloned()
        .collect::<Vec<_>>();
    let inner_hole = inners
        .iter()
        .filter(|path| path.is_hole)
        .cloned()
        .collect::<Vec<_>>();
    outers.clear();
    inners.clear();
    outers.extend(inner_fill);
    outers.extend(outer_fill);
    inners.extend(outer_hole);
    inners.extend(inner_hole);
}

fn path_components(paths: &[PathEx]) -> Vec<Vec<Vec<PathPoint>>> {
    paths.iter().map(|path| vec![path.points.clone()]).collect()
}

fn pack_paths(outers: Vec<PathEx>, leaves: Vec<NodeId>) -> Vec<ContourPath> {
    outers
        .into_iter()
        .map(|outer| ContourPath::from_path_ex(&simplify(&outer)).with_leaves(leaves.clone()))
        .collect()
}

fn fix_path(path: PathEx) -> PathEx {
    PathEx {
        points: path.points.into_iter().map(fix_point).collect(),
        is_hole: path.is_hole,
        from: path.from,
    }
}

fn fix_point(point: PathPoint) -> PathPoint {
    PathPoint::new(fix_float(point.x), fix_float(point.y))
}

fn fix_float(value: f64) -> f64 {
    let rounded = value.round();
    if (rounded - value).abs() < EPSILON {
        rounded
    } else {
        fix_zero(value)
    }
}
