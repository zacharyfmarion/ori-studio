use anyhow::{Context, Result, bail};
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::io::fold::export_fold_document;
use oristudio_cp::operations::arrangement;
use oristudio_cp::{CreasePatternDocument, checks};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::f64::consts::PI;
use std::fs;
use std::path::PathBuf;
use treemaker_flatfold::{SolutionLimit, SolveOptions, solve_flat_fold};

pub struct ExactizeCommand {
    pub file: PathBuf,
    pub out_osf: Option<PathBuf>,
    pub out_fold: Option<PathBuf>,
    pub report: Option<PathBuf>,
    pub endpoint_tolerance: f64,
    pub angle_tolerance_degrees: f64,
    pub rho_tolerance: f64,
    pub run_fix12: bool,
}

#[derive(Debug, Serialize)]
pub struct CpExactizeReport {
    input: String,
    options: ExactizeOptionsReport,
    baseline: DiagnosticSummary,
    exactized: DiagnosticSummary,
    exactization: ExactizationReport,
    output_osf: Option<String>,
    output_fold: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
struct ExactizeOptionsReport {
    endpoint_tolerance: f64,
    angle_tolerance_degrees: f64,
    rho_tolerance: f64,
    run_fix12: bool,
}

#[derive(Debug, Serialize)]
struct DiagnosticSummary {
    line_segments: usize,
    exact_endpoint_count: usize,
    approximate_endpoint_count: usize,
    check4_violations: usize,
    check4_rules: BTreeMap<String, usize>,
    check4_samples: Vec<ViolationSample>,
    camv_violations: usize,
    camv_rules: BTreeMap<String, usize>,
    camv_samples: Vec<ViolationSample>,
    flatfold: FlatfoldStatus,
}

#[derive(Debug, Serialize)]
struct ViolationSample {
    x: f64,
    y: f64,
    rule: String,
    color: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum FlatfoldStatus {
    Solved {
        vertices: usize,
        edges: usize,
        faces: usize,
        face_orders: usize,
        component_sizes: Vec<usize>,
        solution_counts: Vec<usize>,
    },
    Failed {
        error: String,
    },
}

#[derive(Debug, Default, Serialize)]
struct ExactizationReport {
    input_segments: usize,
    output_segments: usize,
    endpoint_clusters: usize,
    carrier_count: usize,
    border_carriers: usize,
    axis_snapped_carriers: usize,
    diagonal_snapped_carriers: usize,
    degenerate_segments_dropped: usize,
    fix1_changed: bool,
    fix2_changed: bool,
    segments_after_fix12: usize,
    max_endpoint_move: f64,
    mean_endpoint_move: f64,
    frame: Frame,
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
struct Frame {
    left: f64,
    right: f64,
    top: f64,
    bottom: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BorderSide {
    Left,
    Right,
    Top,
    Bottom,
}

#[derive(Debug, Clone)]
struct Carrier {
    line: FittedLine,
    segment_indices: Vec<usize>,
    points: Vec<Point>,
    border_side: Option<BorderSide>,
    snapped_to: Option<&'static str>,
}

#[derive(Debug, Clone, Copy)]
struct FittedLine {
    nx: f64,
    ny: f64,
    c: f64,
}

#[derive(Debug, Clone)]
struct EndpointCluster {
    centroid: Point,
    members: Vec<(usize, Endpoint)>,
}

#[derive(Debug, Clone, Copy)]
enum Endpoint {
    A,
    B,
}

#[derive(Debug, Clone, Copy)]
struct ExactizeOptions {
    endpoint_tolerance: f64,
    angle_tolerance_radians: f64,
    rho_tolerance: f64,
}

pub fn run(command: ExactizeCommand) -> Result<CpExactizeReport> {
    let text = fs::read_to_string(&command.file)
        .with_context(|| format!("failed to read {}", command.file.display()))?;
    let mut project: Value = serde_json::from_str(&text)
        .with_context(|| format!("failed to parse {}", command.file.display()))?;
    let document_path = active_crease_pattern_document_path(&project)?;
    let document_value = project
        .pointer(&document_path)
        .cloned()
        .with_context(|| format!("missing crease-pattern document at {document_path}"))?;
    let document: CreasePatternDocument =
        serde_json::from_value(document_value).with_context(|| {
            format!(
                "failed to parse crease-pattern document in {}",
                command.file.display()
            )
        })?;
    let options = ExactizeOptions {
        endpoint_tolerance: command.endpoint_tolerance,
        angle_tolerance_radians: command.angle_tolerance_degrees.to_radians(),
        rho_tolerance: command.rho_tolerance,
    };

    let baseline = summarize_document(&document, options.endpoint_tolerance);
    let (mut exact_document, mut exactization) = exactize_document(&document, options);
    if command.run_fix12 {
        let before_fix2 = exact_document.crease_pattern.line_segments.clone();
        exactization.fix1_changed = arrangement::fix1(&mut exact_document.crease_pattern);
        arrangement::fix2(&mut exact_document.crease_pattern);
        exactization.fix2_changed = exact_document.crease_pattern.line_segments != before_fix2;
        exactization.segments_after_fix12 = exact_document.crease_pattern.line_segments.len();
        exactization.output_segments = exactization.segments_after_fix12;
    }
    let exactized = summarize_document(&exact_document, options.endpoint_tolerance);

    let output_osf = if let Some(path) = command.out_osf.as_ref() {
        write_parented(path, |path| {
            let replacement = serde_json::to_value(&exact_document)?;
            *project.pointer_mut(&document_path).with_context(|| {
                format!("missing mutable crease-pattern document at {document_path}")
            })? = replacement;
            fs::write(path, serde_json::to_string_pretty(&project)?)
                .with_context(|| format!("failed to write {}", path.display()))
        })?;
        Some(path.display().to_string())
    } else {
        None
    };

    let output_fold = if let Some(path) = command.out_fold.as_ref() {
        let fold =
            export_fold_document(&exact_document.crease_pattern, exact_document.title.clone());
        write_parented(path, |path| {
            fs::write(path, serde_json::to_string_pretty(&fold)?)
                .with_context(|| format!("failed to write {}", path.display()))
        })?;
        Some(path.display().to_string())
    } else {
        None
    };

    let report = CpExactizeReport {
        input: command.file.display().to_string(),
        options: ExactizeOptionsReport {
            endpoint_tolerance: command.endpoint_tolerance,
            angle_tolerance_degrees: command.angle_tolerance_degrees,
            rho_tolerance: command.rho_tolerance,
            run_fix12: command.run_fix12,
        },
        baseline,
        exactized,
        exactization,
        output_osf,
        output_fold,
    };

    if let Some(path) = command.report.as_ref() {
        write_parented(path, |path| {
            fs::write(path, serde_json::to_string_pretty(&report)?)
                .with_context(|| format!("failed to write {}", path.display()))
        })?;
    }

    Ok(report)
}

fn write_parented(path: &PathBuf, write: impl FnOnce(&PathBuf) -> Result<()>) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    write(path)
}

fn active_crease_pattern_document_path(project: &Value) -> Result<String> {
    let documents = project
        .pointer("/workspace/documents")
        .and_then(Value::as_array)
        .context("OSF is missing /workspace/documents")?;
    for (index, document) in documents.iter().enumerate() {
        if document.get("kind").and_then(Value::as_str) == Some("crease-pattern") {
            return Ok(format!(
                "/workspace/documents/{index}/creasePattern/document"
            ));
        }
    }
    bail!("OSF does not contain a crease-pattern document")
}

fn summarize_document(
    document: &CreasePatternDocument,
    endpoint_tolerance: f64,
) -> DiagnosticSummary {
    let model = &document.crease_pattern;
    let check4 = checks::check4(model);
    let camv = checks::check_camv_task(model).violations;
    let fold = export_fold_document(model, document.title.clone());
    let flatfold = match solve_flat_fold(
        &fold,
        SolveOptions {
            solution_limit: SolutionLimit::Count(1),
            ..SolveOptions::default()
        },
    ) {
        Ok(result) => FlatfoldStatus::Solved {
            vertices: result.analysis.normalized.document.vertices_coords.len(),
            edges: result.analysis.normalized.document.edges_vertices.len(),
            faces: result.analysis.normalized.document.faces_vertices.len(),
            face_orders: result.face_orders.len(),
            component_sizes: result.component_sizes,
            solution_counts: result.solution_counts,
        },
        Err(error) => FlatfoldStatus::Failed {
            error: error.to_string(),
        },
    };
    DiagnosticSummary {
        line_segments: model.line_segments.len(),
        exact_endpoint_count: exact_endpoint_count(&model.line_segments),
        approximate_endpoint_count: endpoint_clusters(&model.line_segments, endpoint_tolerance)
            .0
            .len(),
        check4_violations: check4.len(),
        check4_rules: rule_counts(&check4),
        check4_samples: violation_samples(&check4),
        camv_violations: camv.len(),
        camv_rules: rule_counts(&camv),
        camv_samples: violation_samples(&camv),
        flatfold,
    }
}

fn exactize_document(
    document: &CreasePatternDocument,
    options: ExactizeOptions,
) -> (CreasePatternDocument, ExactizationReport) {
    let mut next = document.clone();
    let segments = &document.crease_pattern.line_segments;
    let frame = infer_frame(segments);
    let (clusters, endpoint_cluster_by_segment) =
        endpoint_clusters(segments, options.endpoint_tolerance);
    let (carriers, carrier_by_segment) = carrier_groups(segments, frame, options);
    let exact_points = exact_cluster_points(
        &clusters,
        &carriers,
        &carrier_by_segment,
        &endpoint_cluster_by_segment,
        frame,
    );

    let mut degenerate_segments_dropped = 0usize;
    let mut movements = Vec::new();
    let mut exact_segments = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        let a_cluster = endpoint_cluster_by_segment[index][0];
        let b_cluster = endpoint_cluster_by_segment[index][1];
        let a = exact_points[a_cluster];
        let b = exact_points[b_cluster];
        movements.push(segment.a.distance(a));
        movements.push(segment.b.distance(b));
        if a.distance(b) < 1e-7 {
            degenerate_segments_dropped += 1;
            continue;
        }
        exact_segments.push(segment.with_coordinates(a, b));
    }
    next.crease_pattern.line_segments = exact_segments;

    let report = ExactizationReport {
        input_segments: segments.len(),
        output_segments: next.crease_pattern.line_segments.len(),
        endpoint_clusters: clusters.len(),
        carrier_count: carriers.len(),
        border_carriers: carriers
            .iter()
            .filter(|carrier| carrier.border_side.is_some())
            .count(),
        axis_snapped_carriers: carriers
            .iter()
            .filter(|carrier| matches!(carrier.snapped_to, Some("horizontal" | "vertical")))
            .count(),
        diagonal_snapped_carriers: carriers
            .iter()
            .filter(|carrier| matches!(carrier.snapped_to, Some("45" | "135")))
            .count(),
        degenerate_segments_dropped,
        fix1_changed: false,
        fix2_changed: false,
        segments_after_fix12: next.crease_pattern.line_segments.len(),
        max_endpoint_move: movements.iter().copied().fold(0.0, f64::max),
        mean_endpoint_move: if movements.is_empty() {
            0.0
        } else {
            movements.iter().sum::<f64>() / movements.len() as f64
        },
        frame,
    };
    (next, report)
}

fn endpoint_clusters(
    segments: &[LineSegment],
    tolerance: f64,
) -> (Vec<EndpointCluster>, Vec<[usize; 2]>) {
    let mut clusters: Vec<EndpointCluster> = Vec::new();
    let mut by_segment = vec![[usize::MAX; 2]; segments.len()];
    for (segment_index, segment) in segments.iter().enumerate() {
        for (endpoint_index, (point, endpoint)) in
            [(segment.a, Endpoint::A), (segment.b, Endpoint::B)]
                .into_iter()
                .enumerate()
        {
            let cluster_index = clusters
                .iter()
                .position(|cluster| cluster.centroid.distance(point) <= tolerance)
                .unwrap_or_else(|| {
                    clusters.push(EndpointCluster {
                        centroid: point,
                        members: Vec::new(),
                    });
                    clusters.len() - 1
                });
            let cluster = &mut clusters[cluster_index];
            let n = cluster.members.len() as f64;
            cluster.centroid = Point::new(
                (cluster.centroid.x * n + point.x) / (n + 1.0),
                (cluster.centroid.y * n + point.y) / (n + 1.0),
            );
            cluster.members.push((segment_index, endpoint));
            by_segment[segment_index][endpoint_index] = cluster_index;
        }
    }
    (clusters, by_segment)
}

fn carrier_groups(
    segments: &[LineSegment],
    frame: Frame,
    options: ExactizeOptions,
) -> (Vec<Carrier>, Vec<usize>) {
    let mut groups = Vec::<Carrier>::new();
    let mut by_segment = vec![usize::MAX; segments.len()];
    let mut order: Vec<usize> = (0..segments.len()).collect();
    order.sort_by(|left, right| {
        segment_length(&segments[*right]).total_cmp(&segment_length(&segments[*left]))
    });

    for segment_index in order {
        let segment = &segments[segment_index];
        if segment_length(segment) < 1e-7 {
            continue;
        }
        if let Some(side) = border_side(segment, frame, 3.0) {
            let group_index = groups
                .iter()
                .position(|group| group.border_side == Some(side))
                .unwrap_or_else(|| {
                    groups.push(Carrier {
                        line: frame_line(frame, side),
                        segment_indices: Vec::new(),
                        points: Vec::new(),
                        border_side: Some(side),
                        snapped_to: Some("border"),
                    });
                    groups.len() - 1
                });
            add_segment_to_group(&mut groups[group_index], segment_index, segment);
            by_segment[segment_index] = group_index;
            continue;
        }

        let line = FittedLine::from_segment(segment);
        let group_index = groups
            .iter()
            .enumerate()
            .filter(|(_, group)| group.border_side.is_none())
            .filter_map(|(index, group)| {
                let angle = line_angle_delta(line, group.line);
                let rho = signed_rho_delta(line, group.line);
                (angle <= options.angle_tolerance_radians && rho <= options.rho_tolerance)
                    .then_some((index, angle + rho / 400.0))
            })
            .min_by(|left, right| left.1.total_cmp(&right.1))
            .map(|(index, _)| index)
            .unwrap_or_else(|| {
                groups.push(Carrier {
                    line,
                    segment_indices: Vec::new(),
                    points: Vec::new(),
                    border_side: None,
                    snapped_to: None,
                });
                groups.len() - 1
            });
        add_segment_to_group(&mut groups[group_index], segment_index, segment);
        by_segment[segment_index] = group_index;
    }

    for group in &mut groups {
        if group.border_side.is_none() {
            group.line = fit_line(&group.points);
            snap_obvious_line(group);
        }
    }

    (groups, by_segment)
}

fn add_segment_to_group(group: &mut Carrier, segment_index: usize, segment: &LineSegment) {
    group.segment_indices.push(segment_index);
    group.points.push(segment.a);
    group.points.push(segment.b);
}

fn exact_cluster_points(
    clusters: &[EndpointCluster],
    carriers: &[Carrier],
    carrier_by_segment: &[usize],
    endpoint_cluster_by_segment: &[[usize; 2]],
    frame: Frame,
) -> Vec<Point> {
    let mut incident = vec![BTreeSet::<usize>::new(); clusters.len()];
    for (segment_index, clusters_for_segment) in endpoint_cluster_by_segment.iter().enumerate() {
        let carrier_index = carrier_by_segment[segment_index];
        if carrier_index == usize::MAX {
            continue;
        }
        incident[clusters_for_segment[0]].insert(carrier_index);
        incident[clusters_for_segment[1]].insert(carrier_index);
    }

    clusters
        .iter()
        .enumerate()
        .map(|(cluster_index, cluster)| {
            if let Some(corner) = frame_corner(cluster.centroid, frame, 3.0) {
                return corner;
            }
            let lines: Vec<FittedLine> = incident[cluster_index]
                .iter()
                .filter_map(|carrier_index| {
                    carriers.get(*carrier_index).map(|carrier| carrier.line)
                })
                .collect();
            solve_lines_least_squares(&lines)
                .unwrap_or_else(|| project_to_line(cluster.centroid, lines.first().copied()))
        })
        .collect()
}

fn solve_lines_least_squares(lines: &[FittedLine]) -> Option<Point> {
    if lines.len() < 2 {
        return None;
    }
    let mut a00 = 0.0;
    let mut a01 = 0.0;
    let mut a11 = 0.0;
    let mut b0 = 0.0;
    let mut b1 = 0.0;
    for line in lines {
        a00 += line.nx * line.nx;
        a01 += line.nx * line.ny;
        a11 += line.ny * line.ny;
        b0 += line.nx * line.c;
        b1 += line.ny * line.c;
    }
    let det = a00 * a11 - a01 * a01;
    if det.abs() < 1e-9 {
        return None;
    }
    Some(Point::new(
        (b0 * a11 - b1 * a01) / det,
        (a00 * b1 - a01 * b0) / det,
    ))
}

fn project_to_line(point: Point, line: Option<FittedLine>) -> Point {
    let Some(line) = line else {
        return point;
    };
    let signed_distance = line.nx * point.x + line.ny * point.y - line.c;
    Point::new(
        point.x - signed_distance * line.nx,
        point.y - signed_distance * line.ny,
    )
}

fn exact_endpoint_count(segments: &[LineSegment]) -> usize {
    let mut points = BTreeSet::new();
    for segment in segments {
        points.insert((segment.a.x.to_bits(), segment.a.y.to_bits()));
        points.insert((segment.b.x.to_bits(), segment.b.y.to_bits()));
    }
    points.len()
}

fn rule_counts(violations: &[checks::FlatFoldabilityViolation]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for violation in violations {
        *counts.entry(format!("{:?}", violation.rule)).or_insert(0) += 1;
    }
    counts
}

fn violation_samples(violations: &[checks::FlatFoldabilityViolation]) -> Vec<ViolationSample> {
    violations
        .iter()
        .take(12)
        .map(|violation| ViolationSample {
            x: violation.point.x,
            y: violation.point.y,
            rule: format!("{:?}", violation.rule),
            color: format!("{:?}", violation.color),
        })
        .collect()
}

fn infer_frame(segments: &[LineSegment]) -> Frame {
    let mut left = f64::INFINITY;
    let mut right = f64::NEG_INFINITY;
    let mut top = f64::INFINITY;
    let mut bottom = f64::NEG_INFINITY;
    for segment in segments {
        for point in [segment.a, segment.b] {
            left = left.min(point.x);
            right = right.max(point.x);
            top = top.min(point.y);
            bottom = bottom.max(point.y);
        }
    }
    Frame {
        left: clean_coordinate(left),
        right: clean_coordinate(right),
        top: clean_coordinate(top),
        bottom: clean_coordinate(bottom),
    }
}

fn clean_coordinate(value: f64) -> f64 {
    let rounded = value.round();
    if (value - rounded).abs() < 0.01 {
        rounded
    } else {
        value
    }
}

fn border_side(segment: &LineSegment, frame: Frame, tolerance: f64) -> Option<BorderSide> {
    if segment.color != LineColor::Black0 {
        return None;
    }
    let within_y =
        |point: Point| frame.top - tolerance <= point.y && point.y <= frame.bottom + tolerance;
    let within_x =
        |point: Point| frame.left - tolerance <= point.x && point.x <= frame.right + tolerance;
    if within_y(segment.a)
        && within_y(segment.b)
        && (segment.a.x - frame.left).abs() <= tolerance
        && (segment.b.x - frame.left).abs() <= tolerance
    {
        return Some(BorderSide::Left);
    }
    if within_y(segment.a)
        && within_y(segment.b)
        && (segment.a.x - frame.right).abs() <= tolerance
        && (segment.b.x - frame.right).abs() <= tolerance
    {
        return Some(BorderSide::Right);
    }
    if within_x(segment.a)
        && within_x(segment.b)
        && (segment.a.y - frame.top).abs() <= tolerance
        && (segment.b.y - frame.top).abs() <= tolerance
    {
        return Some(BorderSide::Top);
    }
    if within_x(segment.a)
        && within_x(segment.b)
        && (segment.a.y - frame.bottom).abs() <= tolerance
        && (segment.b.y - frame.bottom).abs() <= tolerance
    {
        return Some(BorderSide::Bottom);
    }
    None
}

fn frame_line(frame: Frame, side: BorderSide) -> FittedLine {
    match side {
        BorderSide::Left => FittedLine {
            nx: 1.0,
            ny: 0.0,
            c: frame.left,
        },
        BorderSide::Right => FittedLine {
            nx: 1.0,
            ny: 0.0,
            c: frame.right,
        },
        BorderSide::Top => FittedLine {
            nx: 0.0,
            ny: 1.0,
            c: frame.top,
        },
        BorderSide::Bottom => FittedLine {
            nx: 0.0,
            ny: 1.0,
            c: frame.bottom,
        },
    }
}

fn frame_corner(point: Point, frame: Frame, tolerance: f64) -> Option<Point> {
    [
        Point::new(frame.left, frame.top),
        Point::new(frame.right, frame.top),
        Point::new(frame.right, frame.bottom),
        Point::new(frame.left, frame.bottom),
    ]
    .into_iter()
    .find(|corner| corner.distance(point) <= tolerance)
}

fn snap_obvious_line(group: &mut Carrier) {
    let angle = line_angle(group.line);
    let targets = [
        (0.0, "horizontal"),
        (PI / 4.0, "45"),
        (PI / 2.0, "vertical"),
        (3.0 * PI / 4.0, "135"),
    ];
    let Some((target, name, delta)) = targets
        .into_iter()
        .map(|(target, name)| (target, name, angular_difference(angle, target)))
        .min_by(|left, right| left.2.total_cmp(&right.2))
    else {
        return;
    };
    if delta > 0.75_f64.to_radians() {
        return;
    }
    let tx = target.cos();
    let ty = target.sin();
    let nx = -ty;
    let ny = tx;
    let c = if group.points.is_empty() {
        group.line.c
    } else {
        group
            .points
            .iter()
            .map(|point| nx * point.x + ny * point.y)
            .sum::<f64>()
            / group.points.len() as f64
    };
    group.line = FittedLine {
        nx,
        ny,
        c: clean_coordinate(c),
    };
    group.snapped_to = Some(name);
}

fn fit_line(points: &[Point]) -> FittedLine {
    if points.len() < 2 {
        return FittedLine {
            nx: 0.0,
            ny: 1.0,
            c: points.first().map(|point| point.y).unwrap_or(0.0),
        };
    }
    let mean = Point::new(
        points.iter().map(|point| point.x).sum::<f64>() / points.len() as f64,
        points.iter().map(|point| point.y).sum::<f64>() / points.len() as f64,
    );
    let mut sxx = 0.0;
    let mut syy = 0.0;
    let mut sxy = 0.0;
    for point in points {
        let dx = point.x - mean.x;
        let dy = point.y - mean.y;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
    }
    let theta = 0.5 * (2.0 * sxy).atan2(sxx - syy);
    let tx = theta.cos();
    let ty = theta.sin();
    let nx = -ty;
    let ny = tx;
    FittedLine {
        nx,
        ny,
        c: nx * mean.x + ny * mean.y,
    }
}

impl FittedLine {
    fn from_segment(segment: &LineSegment) -> Self {
        let dx = segment.b.x - segment.a.x;
        let dy = segment.b.y - segment.a.y;
        let length = (dx * dx + dy * dy).sqrt().max(1e-12);
        let mut tx = dx / length;
        let mut ty = dy / length;
        if tx < 0.0 || (tx.abs() < 1e-12 && ty < 0.0) {
            tx = -tx;
            ty = -ty;
        }
        let nx = -ty;
        let ny = tx;
        Self {
            nx,
            ny,
            c: nx * segment.a.x + ny * segment.a.y,
        }
    }
}

fn line_angle(line: FittedLine) -> f64 {
    let tx = line.ny;
    let ty = -line.nx;
    normalize_angle(ty.atan2(tx))
}

fn line_angle_delta(a: FittedLine, b: FittedLine) -> f64 {
    angular_difference(line_angle(a), line_angle(b))
}

fn signed_rho_delta(mut a: FittedLine, b: FittedLine) -> f64 {
    if a.nx * b.nx + a.ny * b.ny < 0.0 {
        a.nx = -a.nx;
        a.ny = -a.ny;
        a.c = -a.c;
    }
    (a.c - b.c).abs()
}

fn angular_difference(a: f64, b: f64) -> f64 {
    let delta = (normalize_angle(a) - normalize_angle(b)).abs();
    delta.min(PI - delta)
}

fn normalize_angle(mut angle: f64) -> f64 {
    while angle < 0.0 {
        angle += PI;
    }
    while angle >= PI {
        angle -= PI;
    }
    angle
}

fn segment_length(segment: &LineSegment) -> f64 {
    segment.a.distance(segment.b)
}
