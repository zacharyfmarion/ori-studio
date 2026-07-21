use crate::engine::{ArcPointData, ArcPolygonData, GraphicsData};
use crate::error::{BpError, BpResult};
use crate::grid::{BpGrid, TransformationMatrix};
use crate::layout::contours::{
    GraphicalContour, PatternContour, build_pattern_contours, build_rough_contours,
    build_trace_contours, combine_graphical_contours,
};
use crate::layout::graphics::{
    RiverContour, collect_free_corners, node_graphics, repo_device_graphics,
};
use crate::layout::{
    LayoutJunction, LayoutRepository, ValidJunction, active_layout_repositories,
    create_layout_junctions, create_valid_junctions, group_junctions, uncovered_junction_indices,
};
use crate::math::geometry::PathPoint;
use crate::model::{Point, Project};
use crate::shared::QuadrantCode;
use crate::sweep::ArcPath;
use crate::sweep::{CpLine, CreaseType, clip_lines};
use crate::tree::BpTree;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

pub const CP_FULL_WIDTH: f64 = 400.0;
const EPSILON: f64 = 1e-10;
const PRECISION: f64 = 16.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CpFormat {
    Cp,
    Fold,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CpExportOptions {
    pub format: CpFormat,
    pub reorient: bool,
    pub use_auxiliary: bool,
    /// Multiplier on the exported full width. `1.0` fills the standard
    /// [`CP_FULL_WIDTH`] paper (BP Studio's convention). "Send to Edit" passes
    /// `bp_sheet_max_cells / edit_grid_divisions` so one BP grid cell maps onto
    /// one Edit-workspace grid cell without changing the Edit grid.
    pub cp_scale: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct LayoutGraphicsSnapshot {
    #[serde(rename = "nodeGraphics")]
    pub node_graphics: Vec<GraphicsEntry>,
    #[serde(rename = "deviceGraphics")]
    pub device_graphics: Vec<GraphicsEntry>,
    #[serde(rename = "invalidJunctions")]
    pub invalid_junctions: Vec<InvalidJunctionSnapshot>,
    #[serde(rename = "patternNotFound")]
    pub pattern_not_found: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GraphicsEntry {
    pub id: String,
    pub data: GraphicsData,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InvalidJunctionSnapshot {
    pub id: String,
    #[serde(rename = "flapIds")]
    pub flap_ids: [u32; 2],
    pub narrowness: f64,
    pub polygon: ArcPolygonData,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CreasePatternSnapshot {
    pub sheet: CpSheetSnapshot,
    pub lines: Vec<CpLineSnapshot>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct CpSheetSnapshot {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CpLineSnapshot {
    pub id: String,
    pub assignment: &'static str,
    pub p1: Point,
    pub p2: Point,
}

impl Default for CpExportOptions {
    fn default() -> Self {
        Self {
            format: CpFormat::Cp,
            reorient: false,
            use_auxiliary: true,
            cp_scale: 1.0,
        }
    }
}

pub fn export_project(project: &Project, options: CpExportOptions) -> BpResult<String> {
    let grid = BpGrid::new(project.design.layout.sheet.clone());
    let components = project_line_components(project, options.use_auxiliary)?;
    let lines = get_cp_lines(&grid.border_path(), &components);
    export_lines(&lines, &grid, project, options)
}

pub fn project_crease_pattern_snapshot(
    project: &Project,
    options: CpExportOptions,
) -> BpResult<CreasePatternSnapshot> {
    let grid = BpGrid::new(project.design.layout.sheet.clone());
    let components = project_line_components(project, options.use_auxiliary)?;
    let lines = get_cp_lines(&grid.border_path(), &components);
    let matrix = grid.transform_matrix(CP_FULL_WIDTH * options.cp_scale, options.reorient);
    let lines = transform_lines(&lines, matrix);
    let border = transform_points(&grid.border_path(), matrix);
    let (width, height) = path_bounds_size(&border);
    Ok(CreasePatternSnapshot {
        sheet: CpSheetSnapshot { width, height },
        lines: lines
            .into_iter()
            .enumerate()
            .map(|(index, line)| CpLineSnapshot {
                id: format!("bp-cp-{index}"),
                assignment: crease_assignment(line.crease_type),
                p1: Point {
                    x: line.p1.x,
                    y: line.p1.y,
                },
                p2: Point {
                    x: line.p2.x,
                    y: line.p2.y,
                },
            })
            .collect(),
    })
}

pub fn project_graphics_snapshot(project: &Project) -> BpResult<LayoutGraphicsSnapshot> {
    if project.design.tree.edges.is_empty() {
        return Ok(LayoutGraphicsSnapshot::default());
    }
    let tree = BpTree::new(&project.design.tree.edges, &project.design.layout.flaps)?;
    let mut repositories = active_layout_repositories(&tree, &project.design.layout.stretches)?;
    let mut pattern_not_found = false;
    for repo in &mut repositories {
        if repo.configuration().is_none() {
            repo.init_with_tree(&tree)?;
        }
        if !repo.initialize_selected_pattern_with_tree(&tree)? {
            pattern_not_found = true;
        }
    }

    let repo_refs = repositories.iter().collect::<Vec<_>>();
    let covered_junctions = covered_junction_map(&tree)?;
    let rough_contours = build_rough_contours(&tree)?;
    let trace_contours =
        build_trace_contours(&tree, &rough_contours, &repo_refs, &covered_junctions)?;
    let pattern_contours = build_pattern_contours(&tree, &trace_contours, &repo_refs)?;
    let free_corners = collect_free_corners(&repo_refs)?;
    let patterned_quadrants = patterned_quadrants(&repositories);
    let mut node_entries = Vec::new();
    for (node_id, traces) in trace_contours {
        let node = tree.node(node_id).ok_or_else(|| {
            BpError::InvalidInput(format!("missing layout graphics node {node_id}"))
        })?;
        let node_pattern_contours = pattern_contours
            .get(&node_id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let child_pattern_contours = child_pattern_contours(node, &pattern_contours);
        let contours =
            combine_graphical_contours(&traces, node_pattern_contours, &child_pattern_contours)?;
        let river_contours = contours
            .iter()
            .cloned()
            .map(graphical_to_river_contour)
            .collect::<Vec<_>>();
        node_entries.push(GraphicsEntry {
            id: node.tag(),
            data: node_graphics(node, &river_contours, &patterned_quadrants, &free_corners),
        });
    }

    let mut device_entries = Vec::new();
    for repo in &repositories {
        device_entries.extend(
            repo_device_graphics(repo, &tree)?
                .into_iter()
                .map(|(id, data)| GraphicsEntry { id, data }),
        );
    }

    Ok(LayoutGraphicsSnapshot {
        node_graphics: node_entries,
        device_graphics: device_entries,
        invalid_junctions: invalid_junctions(&tree)?,
        pattern_not_found,
    })
}

fn invalid_junctions(tree: &BpTree) -> BpResult<Vec<InvalidJunctionSnapshot>> {
    create_layout_junctions(tree)?
        .into_iter()
        .filter_map(|junction| match junction {
            LayoutJunction::Valid(_) => None,
            LayoutJunction::Invalid(junction) => Some(junction),
        })
        .map(|mut junction| {
            let a = junction.a;
            let b = junction.b;
            let id = stretch_id(&[a, b]);
            let narrowness = junction.distance_after_flap_radii();
            let polygon = arc_paths_to_data(junction.get_polygon(tree)?);
            Ok(InvalidJunctionSnapshot {
                id,
                flap_ids: [a, b],
                narrowness,
                polygon,
            })
        })
        .collect()
}

fn arc_paths_to_data(paths: Vec<ArcPath>) -> ArcPolygonData {
    paths
        .into_iter()
        .map(|path| {
            path.into_iter()
                .map(|point| ArcPointData {
                    x: point.point.x,
                    y: point.point.y,
                    arc: point.arc.map(|arc| Point { x: arc.x, y: arc.y }),
                    r: point.radius,
                })
                .collect()
        })
        .collect()
}

pub fn export_project_with_graphics(
    project: &Project,
    node_graphics: &[GraphicsData],
    device_graphics: &[GraphicsData],
    options: CpExportOptions,
) -> BpResult<String> {
    let grid = BpGrid::new(project.design.layout.sheet.clone());
    let components =
        components_from_graphics(options.use_auxiliary, node_graphics, device_graphics);
    let lines = get_cp_lines(&grid.border_path(), &components);
    export_lines(&lines, &grid, project, options)
}

pub fn project_line_components(
    project: &Project,
    use_auxiliary: bool,
) -> BpResult<CpLineComponents> {
    if project.design.tree.edges.is_empty() {
        return Ok(CpLineComponents {
            use_auxiliary,
            ..Default::default()
        });
    }
    let tree = BpTree::new(&project.design.tree.edges, &project.design.layout.flaps)?;
    let mut repositories = active_layout_repositories(&tree, &project.design.layout.stretches)?;
    let covered_junctions = covered_junction_map(&tree)?;
    for repo in &mut repositories {
        if repo.configuration().is_none() {
            repo.init_with_tree(&tree)?;
        }
        if !repo.initialize_selected_pattern_with_tree(&tree)? {
            return Err(BpError::UnsupportedOperation {
                upstream: "src/core/design/tasks/pattern.ts",
                reason: "project-level CP export requires every active stretch repository to have a selected pattern",
            });
        }
    }
    let repo_refs = repositories.iter().collect::<Vec<_>>();
    let rough_contours = build_rough_contours(&tree)?;
    let trace_contours =
        build_trace_contours(&tree, &rough_contours, &repo_refs, &covered_junctions)?;
    let pattern_contours = build_pattern_contours(&tree, &trace_contours, &repo_refs)?;
    let free_corners = collect_free_corners(&repo_refs)?;
    let patterned_quadrants = patterned_quadrants(&repositories);
    let mut components = CpLineComponents {
        use_auxiliary,
        ..Default::default()
    };
    for (node_id, traces) in trace_contours {
        let node = tree
            .node(node_id)
            .ok_or_else(|| BpError::InvalidInput(format!("missing CP export node {node_id}")))?;
        let node_pattern_contours = pattern_contours
            .get(&node_id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let child_pattern_contours = child_pattern_contours(node, &pattern_contours);
        let contours =
            combine_graphical_contours(&traces, node_pattern_contours, &child_pattern_contours)?;
        let river_contours = contours
            .iter()
            .cloned()
            .map(graphical_to_river_contour)
            .collect::<Vec<_>>();
        let graphics = node_graphics(node, &river_contours, &patterned_quadrants, &free_corners);
        components
            .node_outer_contours
            .extend(graphics.contours.into_iter().map(|contour| contour.outer));
        components.node_ridges.extend(graphics.ridges);
    }
    for repo in &repositories {
        for (_, graphics) in repo_device_graphics(repo, &tree)? {
            components.device_draw_ridges.extend(graphics.ridges);
            if let Some(axis_parallel) = graphics.axis_parallel {
                components.device_axis_parallels.extend(axis_parallel);
            }
        }
    }
    Ok(components)
}

pub fn components_from_graphics(
    use_auxiliary: bool,
    node_graphics: &[GraphicsData],
    device_graphics: &[GraphicsData],
) -> CpLineComponents {
    let mut components = CpLineComponents {
        use_auxiliary,
        ..Default::default()
    };
    for graphics in node_graphics {
        components.node_outer_contours.extend(
            graphics
                .contours
                .iter()
                .map(|contour| contour.outer.clone()),
        );
        components
            .node_ridges
            .extend(graphics.ridges.iter().copied());
    }
    for graphics in device_graphics {
        components
            .device_draw_ridges
            .extend(graphics.ridges.iter().copied());
        if let Some(axis_parallel) = &graphics.axis_parallel {
            components
                .device_axis_parallels
                .extend(axis_parallel.iter().copied());
        }
    }
    components
}

pub fn export_lines(
    lines: &[CpLine],
    grid: &BpGrid,
    project: &Project,
    options: CpExportOptions,
) -> BpResult<String> {
    let matrix = grid.transform_matrix(CP_FULL_WIDTH * options.cp_scale, options.reorient);
    let lines = transform_lines(lines, matrix);
    match options.format {
        CpFormat::Cp => Ok(to_cp(&lines)),
        CpFormat::Fold => super::fold_export::to_fold(&lines, project),
    }
}

pub fn to_cp(lines: &[CpLine]) -> String {
    lines
        .iter()
        .map(|line| {
            format!(
                "{} {} {} {} {}",
                line.crease_type as i32,
                number_string(line.p1.x),
                number_string(line.p1.y),
                number_string(line.p2.x),
                number_string(line.p2.y)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn get_cp_lines(borders: &[Point], components: &CpLineComponents) -> Vec<CpLine> {
    let mut lines = Vec::new();
    add_path(&mut lines, borders, CreaseType::Border);
    let hinge_type = if components.use_auxiliary {
        CreaseType::Auxiliary
    } else {
        CreaseType::Valley
    };
    for contour in &components.node_outer_contours {
        add_path(&mut lines, contour, hinge_type);
    }
    add_model_lines(&mut lines, &components.node_ridges, CreaseType::Mountain);
    add_model_lines(
        &mut lines,
        &components.device_draw_ridges,
        CreaseType::Mountain,
    );
    add_model_lines(
        &mut lines,
        &components.device_axis_parallels,
        CreaseType::Valley,
    );
    clip_lines(&lines)
}

#[derive(Debug, Clone, PartialEq)]
pub struct CpLineComponents {
    pub use_auxiliary: bool,
    pub node_outer_contours: Vec<Vec<Point>>,
    pub node_ridges: Vec<[Point; 2]>,
    pub device_draw_ridges: Vec<[Point; 2]>,
    pub device_axis_parallels: Vec<[Point; 2]>,
}

impl Default for CpLineComponents {
    fn default() -> Self {
        Self {
            use_auxiliary: true,
            node_outer_contours: Vec::new(),
            node_ridges: Vec::new(),
            device_draw_ridges: Vec::new(),
            device_axis_parallels: Vec::new(),
        }
    }
}

pub fn add_path(set: &mut Vec<CpLine>, path: &[Point], crease_type: CreaseType) {
    if path.is_empty() {
        return;
    }
    for index in 0..path.len() {
        let p1 = path[index];
        let p2 = path.get(index + 1).copied().unwrap_or(path[0]);
        set.push(CpLine {
            crease_type,
            p1: model_point_to_path_point(p1),
            p2: model_point_to_path_point(p2),
        });
    }
}

pub fn add_model_lines(set: &mut Vec<CpLine>, lines: &[[Point; 2]], crease_type: CreaseType) {
    for [p1, p2] in lines {
        set.push(CpLine {
            crease_type,
            p1: model_point_to_path_point(*p1),
            p2: model_point_to_path_point(*p2),
        });
    }
}

pub fn transform_lines(lines: &[CpLine], matrix: TransformationMatrix) -> Vec<CpLine> {
    lines
        .iter()
        .map(|line| CpLine {
            crease_type: line.crease_type,
            p1: transform(line.p1, matrix),
            p2: transform(line.p2, matrix),
        })
        .collect()
}

pub fn transform(point: PathPoint, matrix: TransformationMatrix) -> PathPoint {
    let [a, b, c, d, x, y] = matrix;
    PathPoint::new(
        fix(point.x * a + point.y * b + x),
        fix(point.x * c + point.y * d + y),
    )
}

fn transform_points(points: &[Point], matrix: TransformationMatrix) -> Vec<Point> {
    points
        .iter()
        .map(|point| {
            let transformed = transform(model_point_to_path_point(*point), matrix);
            Point {
                x: transformed.x,
                y: transformed.y,
            }
        })
        .collect()
}

fn path_bounds_size(points: &[Point]) -> (f64, f64) {
    if points.is_empty() {
        return (0.0, 0.0);
    }
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for point in points {
        min_x = min_x.min(point.x);
        min_y = min_y.min(point.y);
        max_x = max_x.max(point.x);
        max_y = max_y.max(point.y);
    }
    (max_x - min_x, max_y - min_y)
}

fn crease_assignment(crease_type: CreaseType) -> &'static str {
    match crease_type {
        CreaseType::Border => "border",
        CreaseType::Mountain => "mountain",
        CreaseType::Valley => "valley",
        CreaseType::Auxiliary => "auxiliary",
        CreaseType::None => "unassigned",
    }
}

pub fn fix(value: f64) -> f64 {
    if value == 0.0 || value.fract() == 0.0 {
        return normalize_zero(value);
    }
    let rounded = (value * PRECISION).round() / PRECISION;
    if (value - rounded).abs() < EPSILON {
        normalize_zero(rounded)
    } else {
        normalize_zero(value)
    }
}

pub(crate) fn number_string(value: f64) -> String {
    normalize_zero(value).to_string()
}

pub(crate) fn model_point_to_path_point(point: Point) -> PathPoint {
    PathPoint::new(point.x, point.y)
}

fn normalize_zero(value: f64) -> f64 {
    if value == 0.0 { 0.0 } else { value }
}

fn graphical_to_river_contour(contour: GraphicalContour) -> RiverContour {
    RiverContour {
        outer: contour.outer,
        inner: contour.inner,
    }
}

fn covered_junction_map(tree: &BpTree) -> BpResult<BTreeMap<u32, Vec<ValidJunction>>> {
    let mut result = BTreeMap::<u32, Vec<ValidJunction>>::new();
    let valid_junctions = create_valid_junctions(tree)?;
    for team in group_junctions(&valid_junctions)? {
        let mut team_junctions = team
            .junctions
            .iter()
            .filter_map(|index| valid_junctions.get(*index).cloned())
            .collect::<Vec<_>>();
        let _ = uncovered_junction_indices(tree, &mut team_junctions)?;
        for junction in &team_junctions {
            let covering = junction.get_covering(&team_junctions);
            if covering.is_empty() {
                continue;
            }
            if covering
                .iter()
                .all(|index| !team_junctions[*index].involves(junction.a))
            {
                result.entry(junction.a).or_default().push(junction.clone());
            }
            if covering
                .iter()
                .all(|index| !team_junctions[*index].involves(junction.b))
            {
                result.entry(junction.b).or_default().push(junction.clone());
            }
        }
    }
    Ok(result)
}

fn child_pattern_contours(
    node: &crate::tree::TreeNode,
    pattern_contours: &BTreeMap<u32, Vec<PatternContour>>,
) -> Vec<PatternContour> {
    node.children
        .iter()
        .filter_map(|child| pattern_contours.get(child))
        .flat_map(|contours| {
            contours
                .iter()
                .filter(|contour| contour.ids.contains(&node.id))
                .cloned()
        })
        .collect()
}

fn patterned_quadrants(repositories: &[LayoutRepository]) -> BTreeSet<QuadrantCode> {
    repositories
        .iter()
        .filter(|repo| repo.pattern().is_some())
        .flat_map(|repo| repo.quadrants.keys().copied())
        .collect()
}

fn stretch_id(flaps: &[u32]) -> String {
    flaps
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",")
}
