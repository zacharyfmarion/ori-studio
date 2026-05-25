use image::{GrayImage, Luma};
use imageproc::hough::{LineDetectionOptions, PolarLine, detect_lines};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecodeConfig {
    pub image_size: u32,
    pub threshold: f32,
    #[serde(default = "default_min_edge_support")]
    pub min_edge_support: f32,
    #[serde(default = "default_min_edge_length_px")]
    pub min_edge_length_px: f32,
    #[serde(default = "default_vertex_merge_px")]
    pub vertex_merge_px: f32,
    #[serde(default = "default_line_vertex_distance_px")]
    pub line_vertex_distance_px: f32,
    #[serde(default = "default_hough_vote_threshold")]
    pub hough_vote_threshold: u32,
    #[serde(default = "default_hough_suppression_radius")]
    pub hough_suppression_radius: u32,
    #[serde(default = "default_hough_line_distance_px")]
    pub hough_line_distance_px: f32,
    #[serde(default = "default_hough_min_segment_length_px")]
    pub hough_min_segment_length_px: f32,
    #[serde(default = "default_hough_max_segment_gap_px")]
    pub hough_max_segment_gap_px: f32,
    #[serde(default = "default_carrier_extent_padding_px")]
    pub carrier_extent_padding_px: f32,
    #[serde(default = "default_carrier_merge_angle_degrees")]
    pub carrier_merge_angle_degrees: f32,
    #[serde(default = "default_carrier_merge_rho_px")]
    pub carrier_merge_rho_px: f32,
    #[serde(default = "default_max_line_hypotheses")]
    pub max_line_hypotheses: usize,
    #[serde(default = "default_max_intersection_lines")]
    pub max_intersection_lines: usize,
    #[serde(default = "default_junction_snap_px")]
    pub junction_snap_px: f32,
    #[serde(default = "default_planar_cleanup")]
    pub planar_cleanup: bool,
    #[serde(default = "default_planar_cleanup_max_edges")]
    pub planar_cleanup_max_edges: usize,
    #[serde(default = "default_planar_split_vertex_distance_px")]
    pub planar_split_vertex_distance_px: f32,
    #[serde(default = "default_planar_crossing_support_tie")]
    pub planar_crossing_support_tie: f32,
}

impl Default for DecodeConfig {
    fn default() -> DecodeConfig {
        DecodeConfig {
            image_size: 1024,
            threshold: 0.65,
            min_edge_support: default_min_edge_support(),
            min_edge_length_px: default_min_edge_length_px(),
            vertex_merge_px: default_vertex_merge_px(),
            line_vertex_distance_px: default_line_vertex_distance_px(),
            hough_vote_threshold: default_hough_vote_threshold(),
            hough_suppression_radius: default_hough_suppression_radius(),
            hough_line_distance_px: default_hough_line_distance_px(),
            hough_min_segment_length_px: default_hough_min_segment_length_px(),
            hough_max_segment_gap_px: default_hough_max_segment_gap_px(),
            carrier_extent_padding_px: default_carrier_extent_padding_px(),
            carrier_merge_angle_degrees: default_carrier_merge_angle_degrees(),
            carrier_merge_rho_px: default_carrier_merge_rho_px(),
            max_line_hypotheses: default_max_line_hypotheses(),
            max_intersection_lines: default_max_intersection_lines(),
            junction_snap_px: default_junction_snap_px(),
            planar_cleanup: default_planar_cleanup(),
            planar_cleanup_max_edges: default_planar_cleanup_max_edges(),
            planar_split_vertex_distance_px: default_planar_split_vertex_distance_px(),
            planar_crossing_support_tie: default_planar_crossing_support_tie(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct DenseOutputs<'a> {
    pub line_logits: &'a [f32],
    pub junction_logits: &'a [f32],
    pub assignment_logits: &'a [f32],
    pub non_crease_logits: &'a [f32],
    pub line_style_logits: &'a [f32],
    pub boundary_contact_logits: &'a [f32],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecodedFold {
    pub fold_json: String,
    pub report: DecodeReport,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecodeReport {
    pub status: String,
    pub image_size: u32,
    pub threshold: f32,
    pub line_count: usize,
    pub carrier_count: usize,
    pub vertex_count: usize,
    pub edge_count: usize,
    pub border_edge_count: usize,
    pub interior_edge_count: usize,
    pub warnings: Vec<DecodeWarning>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecodeWarning {
    pub code: String,
    pub message: String,
    pub severity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Debug, thiserror::Error)]
pub enum DecodeError {
    #[error("invalid image size: {0}")]
    InvalidImageSize(u32),
    #[error("{name} length mismatch: expected {expected}, got {actual}")]
    TensorLength {
        name: &'static str,
        expected: usize,
        actual: usize,
    },
    #[error("failed to serialize FOLD JSON: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Point {
    x: f32,
    y: f32,
}

#[derive(Debug, Clone)]
struct Line {
    theta: f32,
    rho: f32,
    votes: i32,
    p0: Point,
    p1: Point,
    direction: Point,
    t_min: f32,
    t_max: f32,
    support: f32,
}

#[derive(Debug, Clone)]
struct Edge {
    a: usize,
    b: usize,
    assignment: u8,
    support: f32,
}

#[derive(Debug, Clone, Copy)]
struct ForegroundPoint {
    point: Point,
    score: f32,
}

pub fn decode_dense_outputs(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
) -> Result<DecodedFold, DecodeError> {
    let size = config.image_size as usize;
    if size < 8 {
        return Err(DecodeError::InvalidImageSize(config.image_size));
    }
    let pixels = size * size;
    require_len("line_logits", outputs.line_logits, pixels)?;
    require_len("junction_logits", outputs.junction_logits, pixels)?;
    require_len("non_crease_logits", outputs.non_crease_logits, pixels)?;
    require_len(
        "boundary_contact_logits",
        outputs.boundary_contact_logits,
        pixels,
    )?;
    require_len("assignment_logits", outputs.assignment_logits, pixels * 4)?;
    require_len("line_style_logits", outputs.line_style_logits, pixels * 4)?;

    let effective = effective_line_prob(outputs, &config);
    let lines = hough_lines(&effective, &config);
    let carriers: Vec<Line> = lines
        .iter()
        .filter(|line| !line_is_frame_border(line, size))
        .cloned()
        .collect();

    let mut vertices = square_corners(size);
    vertices.extend(boundary_contact_points(
        outputs.boundary_contact_logits,
        size,
    ));
    let carrier_intersections = carrier_intersections(&carriers, &config);
    vertices.extend(junction_points(
        outputs.junction_logits,
        &effective,
        &carriers,
        &carrier_intersections,
        &config,
    ));
    for carrier in &carriers {
        for endpoint in [carrier.p0, carrier.p1] {
            if point_on_frame(endpoint, size, config.vertex_merge_px * 2.0) {
                vertices.push(snap_to_frame(endpoint, size, config.vertex_merge_px));
            }
        }
    }
    vertices = merge_vertices(&vertices, size, config.vertex_merge_px);

    let mut interior_edges = interior_edges(&vertices, &carriers, &effective, outputs, &config);
    dedupe_edges(&mut interior_edges);
    let (vertices, mut interior_edges, used_boundary) =
        drop_unused_non_border_vertices(vertices, interior_edges, size, config.vertex_merge_px);
    let interior_support_refresh = support_for_edges(
        &vertices,
        &interior_edges,
        &effective,
        outputs.line_style_logits,
        &config,
    );
    for (edge, support) in interior_edges
        .iter_mut()
        .zip(interior_support_refresh.into_iter())
    {
        edge.support = support;
    }
    let mut border_edges = border_chain(&vertices, &used_boundary, size, &effective);
    let mut edges = Vec::new();
    edges.append(&mut interior_edges);
    edges.append(&mut border_edges);
    dedupe_edges(&mut edges);
    if config.planar_cleanup {
        edges = planar_cleanup(&vertices, edges, &config);
    }

    let (vertices, edges) =
        drop_unused_vertices_keep_corners(vertices, edges, size, config.vertex_merge_px);
    let border_edge_count = edges.iter().filter(|edge| edge.assignment == 2).count();
    let interior_edge_count = edges.len().saturating_sub(border_edge_count);
    let mut warnings = Vec::new();
    if interior_edge_count == 0 {
        warnings.push(DecodeWarning {
            code: "no_interior_edges".to_owned(),
            message: "No interior crease edges passed the square topology decoder support gates."
                .to_owned(),
            severity: "warning".to_owned(),
            details: None,
        });
    }
    if border_edge_count < 4 {
        warnings.push(DecodeWarning {
            code: "incomplete_border_chain".to_owned(),
            message: "The deterministic square border chain has fewer than four edges.".to_owned(),
            severity: "error".to_owned(),
            details: Some(json!({ "border_edge_count": border_edge_count })),
        });
    }

    let fold = fold_value(&vertices, &edges, size, &config, &warnings);
    let status = if warnings.iter().any(|warning| warning.severity == "error") {
        "failed"
    } else if warnings.is_empty() {
        "valid"
    } else {
        "ambiguous"
    };
    Ok(DecodedFold {
        fold_json: serde_json::to_string_pretty(&fold)?,
        report: DecodeReport {
            status: status.to_owned(),
            image_size: config.image_size,
            threshold: config.threshold,
            line_count: lines.len(),
            carrier_count: carriers.len(),
            vertex_count: vertices.len(),
            edge_count: edges.len(),
            border_edge_count,
            interior_edge_count,
            warnings,
        },
    })
}

fn require_len(name: &'static str, values: &[f32], expected: usize) -> Result<(), DecodeError> {
    if values.len() != expected {
        return Err(DecodeError::TensorLength {
            name,
            expected,
            actual: values.len(),
        });
    }
    Ok(())
}

fn effective_line_prob(outputs: DenseOutputs<'_>, config: &DecodeConfig) -> Vec<f32> {
    outputs
        .line_logits
        .iter()
        .zip(outputs.non_crease_logits.iter())
        .map(|(line, non_crease)| {
            let mut prob = sigmoid(*line);
            let non_crease_prob = sigmoid(*non_crease);
            if non_crease_prob >= 0.65 && prob < 0.85 {
                prob *= 0.15;
            }
            if prob < config.threshold * 0.25 {
                0.0
            } else {
                prob
            }
        })
        .collect()
}

fn hough_lines(line_prob: &[f32], config: &DecodeConfig) -> Vec<Line> {
    let size = config.image_size as usize;
    let (mask, foreground) = hough_mask(line_prob, config);
    if foreground.is_empty() {
        return Vec::new();
    }
    let vote_threshold = config.hough_vote_threshold.max((size / 18).max(10) as u32);
    let polar_lines = detect_lines(
        &mask,
        LineDetectionOptions {
            vote_threshold,
            suppression_radius: config.hough_suppression_radius,
        },
    );

    let mut candidates = Vec::new();
    for polar in polar_lines {
        candidates.extend(finite_carriers_from_polar_line(
            polar,
            &foreground,
            size,
            config,
        ));
    }
    merge_carrier_segments(candidates, config)
}

fn hough_mask(line_prob: &[f32], config: &DecodeConfig) -> (GrayImage, Vec<ForegroundPoint>) {
    let size = config.image_size as usize;
    let mut mask = GrayImage::new(config.image_size, config.image_size);
    let mut foreground = Vec::new();
    for y in 0..size {
        for x in 0..size {
            let idx = y * size + x;
            let score = line_prob[idx];
            if score < config.threshold {
                continue;
            }
            mask.put_pixel(x as u32, y as u32, Luma([255]));
            foreground.push(ForegroundPoint {
                point: Point {
                    x: x as f32,
                    y: y as f32,
                },
                score,
            });
        }
    }
    (mask, foreground)
}

fn finite_carriers_from_polar_line(
    polar: PolarLine,
    foreground: &[ForegroundPoint],
    size: usize,
    config: &DecodeConfig,
) -> Vec<Line> {
    let theta = (polar.angle_in_degrees as f32).to_radians();
    let rho = polar.r;
    let direction = Point {
        x: -theta.sin(),
        y: theta.cos(),
    };
    let Some((clip0, clip1)) = clip_hough_line(theta, rho, size) else {
        return Vec::new();
    };
    let square_t_min = project(clip0, direction).min(project(clip1, direction));
    let square_t_max = project(clip0, direction).max(project(clip1, direction));
    let distance_tolerance = config
        .hough_line_distance_px
        .max(config.line_vertex_distance_px * 0.75);
    let mut projections = Vec::new();
    for foreground_point in foreground {
        if point_polar_distance(foreground_point.point, theta, rho) <= distance_tolerance {
            projections.push((
                project(foreground_point.point, direction),
                foreground_point.score,
            ));
        }
    }
    if projections.len() < config.hough_vote_threshold.max(3) as usize {
        return Vec::new();
    }
    projections.sort_by(|left, right| left.0.total_cmp(&right.0));

    let mut carriers = Vec::new();
    let mut run_start = 0usize;
    for idx in 1..=projections.len() {
        let gap = if idx < projections.len() {
            projections[idx].0 - projections[idx - 1].0
        } else {
            f32::INFINITY
        };
        if gap <= config.hough_max_segment_gap_px {
            continue;
        }
        let run = &projections[run_start..idx];
        if let Some(line) = carrier_from_projection_run(
            theta,
            rho,
            direction,
            square_t_min,
            square_t_max,
            run,
            config,
        ) {
            carriers.push(line);
        }
        run_start = idx;
    }
    carriers
}

fn carrier_from_projection_run(
    theta: f32,
    rho: f32,
    direction: Point,
    square_t_min: f32,
    square_t_max: f32,
    run: &[(f32, f32)],
    config: &DecodeConfig,
) -> Option<Line> {
    if run.len() < config.hough_vote_threshold.max(3) as usize {
        return None;
    }
    let t_min = (run.first()?.0 - config.carrier_extent_padding_px).max(square_t_min);
    let t_max = (run.last()?.0 + config.carrier_extent_padding_px).min(square_t_max);
    if t_max - t_min < config.hough_min_segment_length_px {
        return None;
    }
    let support = run.iter().map(|(_, score)| *score).sum::<f32>() / run.len() as f32;
    Some(Line {
        theta,
        rho,
        votes: run.len() as i32,
        p0: point_on_polar_line(theta, rho, direction, t_min),
        p1: point_on_polar_line(theta, rho, direction, t_max),
        direction,
        t_min,
        t_max,
        support,
    })
}

fn merge_carrier_segments(mut candidates: Vec<Line>, config: &DecodeConfig) -> Vec<Line> {
    candidates.sort_by(|left, right| {
        right
            .votes
            .cmp(&left.votes)
            .then_with(|| right.support.total_cmp(&left.support))
    });
    let mut merged: Vec<Line> = Vec::new();
    for line in candidates {
        if let Some(existing) = merged.iter_mut().find(|existing| {
            same_carrier_family(existing, &line, config)
                && projection_intervals_touch(existing, &line, config.carrier_extent_padding_px)
        }) {
            existing.t_min = existing.t_min.min(project(line.p0, existing.direction));
            existing.t_min = existing.t_min.min(project(line.p1, existing.direction));
            existing.t_max = existing.t_max.max(project(line.p0, existing.direction));
            existing.t_max = existing.t_max.max(project(line.p1, existing.direction));
            existing.p0 = point_on_polar_line(
                existing.theta,
                existing.rho,
                existing.direction,
                existing.t_min,
            );
            existing.p1 = point_on_polar_line(
                existing.theta,
                existing.rho,
                existing.direction,
                existing.t_max,
            );
            existing.votes += line.votes;
            existing.support = existing.support.max(line.support);
            continue;
        }
        merged.push(line);
        if merged.len() >= config.max_line_hypotheses {
            break;
        }
    }
    merged
}

fn same_carrier_family(left: &Line, right: &Line, config: &DecodeConfig) -> bool {
    angle_distance(left.theta, right.theta) <= config.carrier_merge_angle_degrees.to_radians()
        && (left.rho - right.rho).abs() <= config.carrier_merge_rho_px
}

fn projection_intervals_touch(left: &Line, right: &Line, gap: f32) -> bool {
    let right_t0 = project(right.p0, left.direction).min(project(right.p1, left.direction));
    let right_t1 = project(right.p0, left.direction).max(project(right.p1, left.direction));
    left.t_min <= right_t1 + gap && right_t0 <= left.t_max + gap
}

fn point_on_polar_line(theta: f32, rho: f32, direction: Point, t: f32) -> Point {
    Point {
        x: theta.cos() * rho + direction.x * t,
        y: theta.sin() * rho + direction.y * t,
    }
}

fn clip_hough_line(theta: f32, rho: f32, size: usize) -> Option<(Point, Point)> {
    let max = (size - 1) as f32;
    let cos_t = theta.cos();
    let sin_t = theta.sin();
    let mut points = Vec::new();
    if sin_t.abs() > 1e-6 {
        for x in [0.0, max] {
            let y = (rho - x * cos_t) / sin_t;
            if (-1.0..=max + 1.0).contains(&y) {
                points.push(Point {
                    x,
                    y: y.clamp(0.0, max),
                });
            }
        }
    }
    if cos_t.abs() > 1e-6 {
        for y in [0.0, max] {
            let x = (rho - y * sin_t) / cos_t;
            if (-1.0..=max + 1.0).contains(&x) {
                points.push(Point {
                    x: x.clamp(0.0, max),
                    y,
                });
            }
        }
    }
    dedupe_points(&mut points, 1.0);
    if points.len() < 2 {
        return None;
    }
    let dir = Point {
        x: -sin_t,
        y: cos_t,
    };
    points.sort_by(|a, b| project(*a, dir).total_cmp(&project(*b, dir)));
    Some((*points.first()?, *points.last()?))
}

fn boundary_contact_points(logits: &[f32], size: usize) -> Vec<Point> {
    let max = (size - 1) as f32;
    let band = (size as f32 * 0.04).max(4.0) as usize;
    let radius = (size / 256).max(2);
    let mut points = Vec::new();
    for side in 0..4 {
        let mut candidates = Vec::new();
        for y in 0..size {
            for x in 0..size {
                let in_band = match side {
                    0 => y <= band,
                    1 => x + band >= size - 1,
                    2 => y + band >= size - 1,
                    _ => x <= band,
                };
                if !in_band {
                    continue;
                }
                let idx = y * size + x;
                let score = sigmoid(logits[idx]);
                if score < 0.25 || !local_max_scalar(logits, size, x, y, radius, score) {
                    continue;
                }
                let point = match side {
                    0 => Point {
                        x: x as f32,
                        y: 0.0,
                    },
                    1 => Point {
                        x: max,
                        y: y as f32,
                    },
                    2 => Point {
                        x: x as f32,
                        y: max,
                    },
                    _ => Point {
                        x: 0.0,
                        y: y as f32,
                    },
                };
                candidates.push((score, point));
            }
        }
        candidates.sort_by(|a, b| b.0.total_cmp(&a.0));
        for (_, point) in candidates {
            if points.iter().any(|other| distance(*other, point) <= 8.0) {
                continue;
            }
            points.push(point);
        }
    }
    points
}

fn junction_points(
    logits: &[f32],
    line_prob: &[f32],
    carriers: &[Line],
    intersections: &[Point],
    config: &DecodeConfig,
) -> Vec<Point> {
    let size = config.image_size as usize;
    let mut candidates = Vec::new();
    for y in 1..size - 1 {
        for x in 1..size - 1 {
            let idx = y * size + x;
            if line_prob[idx] < config.threshold * 0.45 {
                continue;
            }
            let score = sigmoid(logits[idx]);
            if score < 0.20 || !local_max_scalar(logits, size, x, y, 2, score) {
                continue;
            }
            let point = Point {
                x: x as f32,
                y: y as f32,
            };
            if carriers
                .iter()
                .any(|line| point_on_finite_line(point, line, config.line_vertex_distance_px))
            {
                candidates.push((
                    score,
                    snap_junction_to_intersection(point, intersections, config),
                ));
            }
        }
    }
    candidates.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mut points = Vec::new();
    for (_, point) in candidates {
        if points
            .iter()
            .any(|other| distance(*other, point) <= config.vertex_merge_px * 2.0)
        {
            continue;
        }
        points.push(point);
        if points.len() >= 1600 {
            break;
        }
    }
    points
}

fn carrier_intersections(carriers: &[Line], config: &DecodeConfig) -> Vec<Point> {
    let size = config.image_size as usize;
    let max_lines = carriers.len().min(config.max_intersection_lines);
    let mut intersections = Vec::new();
    for i in 0..max_lines {
        for j in i + 1..max_lines {
            let Some(point) = line_intersection(&carriers[i], &carriers[j]) else {
                continue;
            };
            if !point_in_frame(point, size, 1.0) {
                continue;
            }
            if !point_on_finite_line(point, &carriers[i], config.vertex_merge_px)
                || !point_on_finite_line(point, &carriers[j], config.vertex_merge_px)
            {
                continue;
            }
            intersections.push(point);
        }
    }
    intersections
}

fn line_intersection(first: &Line, second: &Line) -> Option<Point> {
    let a1 = first.theta.cos();
    let b1 = first.theta.sin();
    let a2 = second.theta.cos();
    let b2 = second.theta.sin();
    let det = a1 * b2 - a2 * b1;
    if det.abs() < 1e-6 {
        return None;
    }
    Some(Point {
        x: (first.rho * b2 - second.rho * b1) / det,
        y: (a1 * second.rho - a2 * first.rho) / det,
    })
}

fn snap_junction_to_intersection(
    point: Point,
    intersections: &[Point],
    config: &DecodeConfig,
) -> Point {
    let mut best = None;
    for intersection in intersections {
        let item_distance = distance(point, *intersection);
        if item_distance > config.junction_snap_px {
            continue;
        }
        match best {
            None => best = Some((*intersection, item_distance)),
            Some((_, best_distance)) if item_distance < best_distance => {
                best = Some((*intersection, item_distance))
            }
            _ => {}
        }
    }
    best.map(|(intersection, _)| intersection).unwrap_or(point)
}

fn local_max_scalar(
    logits: &[f32],
    size: usize,
    x: usize,
    y: usize,
    radius: usize,
    score: f32,
) -> bool {
    let x0 = x.saturating_sub(radius);
    let y0 = y.saturating_sub(radius);
    let x1 = (x + radius).min(size - 1);
    let y1 = (y + radius).min(size - 1);
    for yy in y0..=y1 {
        for xx in x0..=x1 {
            if sigmoid(logits[yy * size + xx]) > score {
                return false;
            }
        }
    }
    true
}

fn interior_edges(
    vertices: &[Point],
    carriers: &[Line],
    line_prob: &[f32],
    outputs: DenseOutputs<'_>,
    config: &DecodeConfig,
) -> Vec<Edge> {
    let mut edges = Vec::new();
    let size = config.image_size as usize;
    for carrier in carriers {
        let mut on_line = Vec::new();
        for (idx, vertex) in vertices.iter().enumerate() {
            if point_on_finite_line(*vertex, carrier, config.line_vertex_distance_px) {
                on_line.push((idx, project(*vertex, carrier.direction)));
            }
        }
        if on_line.len() < 2 {
            continue;
        }
        on_line.sort_by(|a, b| a.1.total_cmp(&b.1));
        for pair in on_line.windows(2) {
            let a = pair[0].0;
            let b = pair[1].0;
            if distance(vertices[a], vertices[b]) < config.min_edge_length_px {
                continue;
            }
            if segment_is_frame_border(vertices[a], vertices[b], size) {
                continue;
            }
            let support = segment_support(
                vertices[a],
                vertices[b],
                line_prob,
                outputs.line_style_logits,
                config,
            );
            if support < config.min_edge_support {
                continue;
            }
            edges.push(Edge {
                a,
                b,
                assignment: vote_assignment(
                    vertices[a],
                    vertices[b],
                    outputs.assignment_logits,
                    line_prob,
                    config,
                ),
                support,
            });
        }
    }
    edges
}

fn segment_support(
    a: Point,
    b: Point,
    line_prob: &[f32],
    line_style_logits: &[f32],
    config: &DecodeConfig,
) -> f32 {
    let size = config.image_size as usize;
    let pixels = size * size;
    let length = distance(a, b);
    if length <= 1e-6 {
        return 0.0;
    }
    let samples = (length / 2.0).ceil().max(2.0) as usize;
    let dx = (b.x - a.x) / length;
    let dy = (b.y - a.y) / length;
    let px = -dy;
    let py = dx;
    let mut hits = 0usize;
    let mut prob_sum = 0.0;
    let mut dashed_sum = 0.0;
    for step in 0..=samples {
        let t = step as f32 / samples as f32;
        let cx = a.x + (b.x - a.x) * t;
        let cy = a.y + (b.y - a.y) * t;
        let mut best = 0.0_f32;
        let mut best_dashed = 0.0_f32;
        for offset in -1..=1 {
            let x = (cx + px * offset as f32).round() as isize;
            let y = (cy + py * offset as f32).round() as isize;
            if x < 0 || y < 0 || x >= size as isize || y >= size as isize {
                continue;
            }
            let idx = y as usize * size + x as usize;
            best = best.max(line_prob[idx]);
            best_dashed = best_dashed.max(softmax_channel(line_style_logits, 4, idx, 1, pixels));
        }
        if best >= config.threshold {
            hits += 1;
        }
        prob_sum += best;
        dashed_sum += best_dashed;
    }
    let count = samples + 1;
    let hit_fraction = hits as f32 / count as f32;
    let mean_prob = prob_sum / count as f32;
    let dashed = dashed_sum / count as f32;
    let dashed_support = if mean_prob >= 0.12 && dashed >= 0.55 {
        dashed * 0.55
    } else {
        0.0
    };
    hit_fraction.max(mean_prob * 0.35).max(dashed_support)
}

fn vote_assignment(
    a: Point,
    b: Point,
    assignment_logits: &[f32],
    line_prob: &[f32],
    config: &DecodeConfig,
) -> u8 {
    let size = config.image_size as usize;
    let pixels = size * size;
    let length = distance(a, b);
    let samples = (length / 3.0).ceil().max(2.0) as usize;
    let trim = (samples / 10).max(1);
    let mut counts = [0usize; 4];
    for step in trim..=samples.saturating_sub(trim) {
        let t = step as f32 / samples as f32;
        let x = (a.x + (b.x - a.x) * t).round() as isize;
        let y = (a.y + (b.y - a.y) * t).round() as isize;
        if x < 0 || y < 0 || x >= size as isize || y >= size as isize {
            continue;
        }
        let idx = y as usize * size + x as usize;
        if line_prob[idx] < config.threshold * 0.45 {
            continue;
        }
        let label = argmax_channel(assignment_logits, 4, idx, pixels);
        counts[label] += 1;
    }
    let total: usize = counts.iter().sum();
    if total == 0 {
        return 3;
    }
    let (label, count) = counts
        .iter()
        .copied()
        .enumerate()
        .max_by_key(|(_, count)| *count)
        .unwrap_or((3, 0));
    if count as f32 / total as f32 >= 0.75 {
        label as u8
    } else {
        3
    }
}

fn border_chain(
    vertices: &[Point],
    used_boundary: &[usize],
    size: usize,
    line_prob: &[f32],
) -> Vec<Edge> {
    let mut edges = Vec::new();
    for side in 0..4 {
        let mut indices: Vec<usize> = vertices
            .iter()
            .enumerate()
            .filter_map(|(idx, point)| {
                if !(is_corner(*point, size, 2.5) || used_boundary.contains(&idx)) {
                    return None;
                }
                point_on_side(*point, side, size, 3.0).then_some(idx)
            })
            .collect();
        indices.sort_by(|left, right| {
            side_position(vertices[*left], side).total_cmp(&side_position(vertices[*right], side))
        });
        indices.dedup();
        for pair in indices.windows(2) {
            let a = pair[0];
            let b = pair[1];
            if a == b {
                continue;
            }
            edges.push(Edge {
                a,
                b,
                assignment: 2,
                support: segment_support(
                    vertices[a],
                    vertices[b],
                    line_prob,
                    &[],
                    &DecodeConfig {
                        image_size: size as u32,
                        threshold: 0.0,
                        min_edge_support: 0.0,
                        min_edge_length_px: 3.0,
                        vertex_merge_px: 2.0,
                        line_vertex_distance_px: 4.0,
                        ..DecodeConfig::default()
                    },
                )
                .max(0.99),
            });
        }
    }
    edges
}

fn drop_unused_non_border_vertices(
    vertices: Vec<Point>,
    edges: Vec<Edge>,
    size: usize,
    tol: f32,
) -> (Vec<Point>, Vec<Edge>, Vec<usize>) {
    if vertices.is_empty() {
        return (vertices, edges, Vec::new());
    }
    let mut keep = vec![false; vertices.len()];
    for (idx, point) in vertices.iter().enumerate() {
        if is_corner(*point, size, tol) {
            keep[idx] = true;
        }
    }
    for edge in &edges {
        keep[edge.a] = true;
        keep[edge.b] = true;
    }
    let mut remap = vec![usize::MAX; vertices.len()];
    let mut next_vertices = Vec::new();
    for (idx, point) in vertices.iter().copied().enumerate() {
        if keep[idx] {
            remap[idx] = next_vertices.len();
            next_vertices.push(point);
        }
    }
    let next_edges: Vec<Edge> = edges
        .into_iter()
        .filter_map(|edge| {
            let a = remap[edge.a];
            let b = remap[edge.b];
            (a != usize::MAX && b != usize::MAX && a != b).then_some(Edge { a, b, ..edge })
        })
        .collect();
    let mut used_boundary = Vec::new();
    for edge in &next_edges {
        for idx in [edge.a, edge.b] {
            if point_on_frame(next_vertices[idx], size, tol)
                && !is_corner(next_vertices[idx], size, tol)
            {
                used_boundary.push(idx);
            }
        }
    }
    used_boundary.sort_unstable();
    used_boundary.dedup();
    (next_vertices, next_edges, used_boundary)
}

fn support_for_edges(
    vertices: &[Point],
    edges: &[Edge],
    line_prob: &[f32],
    line_style_logits: &[f32],
    config: &DecodeConfig,
) -> Vec<f32> {
    edges
        .iter()
        .map(|edge| {
            segment_support(
                vertices[edge.a],
                vertices[edge.b],
                line_prob,
                line_style_logits,
                config,
            )
        })
        .collect()
}

fn dedupe_edges(edges: &mut Vec<Edge>) {
    let mut out: Vec<Edge> = Vec::new();
    for edge in edges.drain(..) {
        let a = edge.a.min(edge.b);
        let b = edge.a.max(edge.b);
        if a == b {
            continue;
        }
        if let Some(existing) = out
            .iter_mut()
            .find(|item| item.a.min(item.b) == a && item.a.max(item.b) == b)
        {
            if edge.assignment == 2 || edge.support > existing.support {
                *existing = Edge { a, b, ..edge };
            }
        } else {
            out.push(Edge { a, b, ..edge });
        }
    }
    *edges = out;
}

fn planar_cleanup(vertices: &[Point], mut edges: Vec<Edge>, config: &DecodeConfig) -> Vec<Edge> {
    if edges.len() <= 1 || vertices.len() < 3 || edges.len() > config.planar_cleanup_max_edges {
        return edges;
    }
    edges = split_edges_at_intermediate_vertices(vertices, &edges, config);
    dedupe_edges(&mut edges);
    remove_crossing_edges(vertices, edges, config)
}

fn split_edges_at_intermediate_vertices(
    vertices: &[Point],
    edges: &[Edge],
    config: &DecodeConfig,
) -> Vec<Edge> {
    let mut out = Vec::new();
    for edge in edges {
        let sequence = vertices_on_segment(vertices, edge.a, edge.b, config);
        for pair in sequence.windows(2) {
            let a = pair[0];
            let b = pair[1];
            if a == b || distance(vertices[a], vertices[b]) < config.min_edge_length_px {
                continue;
            }
            out.push(Edge {
                a,
                b,
                assignment: edge.assignment,
                support: edge.support,
            });
        }
    }
    out
}

fn vertices_on_segment(
    vertices: &[Point],
    a: usize,
    b: usize,
    config: &DecodeConfig,
) -> Vec<usize> {
    let start = vertices[a];
    let end = vertices[b];
    let length = distance(start, end);
    if length <= 1e-6 {
        return vec![a, b];
    }
    let direction = Point {
        x: (end.x - start.x) / length,
        y: (end.y - start.y) / length,
    };
    let mut intermediate = Vec::new();
    for (idx, point) in vertices.iter().enumerate() {
        if idx == a || idx == b {
            continue;
        }
        let rel = Point {
            x: point.x - start.x,
            y: point.y - start.y,
        };
        let projection = rel.x * direction.x + rel.y * direction.y;
        if projection <= config.min_edge_length_px
            || projection >= length - config.min_edge_length_px
        {
            continue;
        }
        let perp = (rel.x * direction.y - rel.y * direction.x).abs();
        if perp <= config.planar_split_vertex_distance_px {
            intermediate.push((idx, projection));
        }
    }
    intermediate.sort_by(|left, right| left.1.total_cmp(&right.1));
    let mut sequence = Vec::with_capacity(intermediate.len() + 2);
    sequence.push(a);
    sequence.extend(intermediate.into_iter().map(|(idx, _)| idx));
    sequence.push(b);
    sequence
}

fn remove_crossing_edges(vertices: &[Point], edges: Vec<Edge>, config: &DecodeConfig) -> Vec<Edge> {
    if edges.len() <= 1 {
        return edges;
    }
    let mut keep = vec![true; edges.len()];
    let bboxes: Vec<(Point, Point)> = edges
        .iter()
        .map(|edge| edge_bbox(vertices[edge.a], vertices[edge.b]))
        .collect();
    for i in 0..edges.len() {
        if !keep[i] {
            continue;
        }
        for j in i + 1..edges.len() {
            if !keep[j] || !bbox_intersects(bboxes[i], bboxes[j]) {
                continue;
            }
            let edge_a = &edges[i];
            let edge_b = &edges[j];
            if [edge_a.a, edge_a.b]
                .iter()
                .any(|idx| *idx == edge_b.a || *idx == edge_b.b)
            {
                continue;
            }
            if !proper_segments_intersect(
                vertices[edge_a.a],
                vertices[edge_a.b],
                vertices[edge_b.a],
                vertices[edge_b.b],
            ) {
                continue;
            }
            let loser = crossing_loser(vertices, &edges, i, j, config);
            keep[loser] = false;
            if loser == i {
                break;
            }
        }
    }
    edges
        .into_iter()
        .enumerate()
        .filter_map(|(idx, edge)| keep[idx].then_some(edge))
        .collect()
}

fn edge_bbox(a: Point, b: Point) -> (Point, Point) {
    (
        Point {
            x: a.x.min(b.x),
            y: a.y.min(b.y),
        },
        Point {
            x: a.x.max(b.x),
            y: a.y.max(b.y),
        },
    )
}

fn bbox_intersects(first: (Point, Point), second: (Point, Point)) -> bool {
    !(first.1.x < second.0.x
        || second.1.x < first.0.x
        || first.1.y < second.0.y
        || second.1.y < first.0.y)
}

fn proper_segments_intersect(a: Point, b: Point, c: Point, d: Point) -> bool {
    let eps = 1e-6;
    let o1 = orient(a, b, c);
    let o2 = orient(a, b, d);
    let o3 = orient(c, d, a);
    let o4 = orient(c, d, b);
    if o1.abs() < eps || o2.abs() < eps || o3.abs() < eps || o4.abs() < eps {
        return false;
    }
    (o1 > 0.0) != (o2 > 0.0) && (o3 > 0.0) != (o4 > 0.0)
}

fn orient(a: Point, b: Point, c: Point) -> f32 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

fn crossing_loser(
    vertices: &[Point],
    edges: &[Edge],
    a: usize,
    b: usize,
    config: &DecodeConfig,
) -> usize {
    let support_delta = edges[a].support - edges[b].support;
    if support_delta.abs() > config.planar_crossing_support_tie {
        return if support_delta > 0.0 { b } else { a };
    }
    let len_a = distance(vertices[edges[a].a], vertices[edges[a].b]);
    let len_b = distance(vertices[edges[b].a], vertices[edges[b].b]);
    if len_a >= len_b { a } else { b }
}

fn drop_unused_vertices_keep_corners(
    vertices: Vec<Point>,
    edges: Vec<Edge>,
    size: usize,
    tol: f32,
) -> (Vec<Point>, Vec<Edge>) {
    let mut keep = vec![false; vertices.len()];
    for (idx, point) in vertices.iter().enumerate() {
        if is_corner(*point, size, tol) {
            keep[idx] = true;
        }
    }
    for edge in &edges {
        keep[edge.a] = true;
        keep[edge.b] = true;
    }
    let mut remap = vec![usize::MAX; vertices.len()];
    let mut next_vertices = Vec::new();
    for (idx, point) in vertices.iter().copied().enumerate() {
        if keep[idx] {
            remap[idx] = next_vertices.len();
            next_vertices.push(point);
        }
    }
    let next_edges = edges
        .into_iter()
        .filter_map(|edge| {
            let a = remap[edge.a];
            let b = remap[edge.b];
            (a != usize::MAX && b != usize::MAX && a != b).then_some(Edge { a, b, ..edge })
        })
        .collect();
    (next_vertices, next_edges)
}

fn fold_value(
    vertices: &[Point],
    edges: &[Edge],
    size: usize,
    config: &DecodeConfig,
    warnings: &[DecodeWarning],
) -> Value {
    let max = (size - 1).max(1) as f32;
    let vertices_coords: Vec<[f32; 2]> = vertices
        .iter()
        .map(|point| {
            [
                (point.x / max).clamp(0.0, 1.0),
                (point.y / max).clamp(0.0, 1.0),
            ]
        })
        .collect();
    let edges_vertices: Vec<[usize; 2]> = edges.iter().map(|edge| [edge.a, edge.b]).collect();
    let edges_assignment: Vec<&'static str> = edges
        .iter()
        .map(|edge| match edge.assignment {
            0 => "M",
            1 => "V",
            2 => "B",
            _ => "U",
        })
        .collect();
    let edge_support: Vec<f32> = edges.iter().map(|edge| edge.support).collect();
    json!({
        "file_spec": 1.1,
        "file_creator": "Ori Studio browser CP detector V1",
        "file_classes": ["singleModel"],
        "frame_classes": ["creasePattern"],
        "vertices_coords": vertices_coords,
        "edges_vertices": edges_vertices,
        "edges_assignment": edges_assignment,
        "cp_detect": {
            "schema": "oristudio/cp-detect/fold-metadata/v1",
            "decoder": "square_topology_wasm_v1",
            "image_size": config.image_size,
            "threshold": config.threshold,
            "edge_support": edge_support,
            "warnings": warnings,
        },
    })
}

fn square_corners(size: usize) -> Vec<Point> {
    let max = (size - 1) as f32;
    vec![
        Point { x: 0.0, y: 0.0 },
        Point { x: max, y: 0.0 },
        Point { x: max, y: max },
        Point { x: 0.0, y: max },
    ]
}

fn merge_vertices(vertices: &[Point], size: usize, tol: f32) -> Vec<Point> {
    let mut used = vec![false; vertices.len()];
    let mut merged = Vec::new();
    for (idx, point) in vertices.iter().enumerate() {
        if used[idx] {
            continue;
        }
        let mut sum = Point { x: 0.0, y: 0.0 };
        let mut count = 0.0;
        for (other_idx, other) in vertices.iter().enumerate() {
            if used[other_idx] || distance(*point, *other) > tol {
                continue;
            }
            used[other_idx] = true;
            sum.x += other.x;
            sum.y += other.y;
            count += 1.0;
        }
        merged.push(snap_to_frame(
            Point {
                x: sum.x / count,
                y: sum.y / count,
            },
            size,
            tol,
        ));
    }
    merged
}

fn dedupe_points(points: &mut Vec<Point>, tol: f32) {
    let mut out = Vec::new();
    for point in points.drain(..) {
        if !out.iter().any(|other| distance(*other, point) <= tol) {
            out.push(point);
        }
    }
    *points = out;
}

fn line_is_frame_border(line: &Line, size: usize) -> bool {
    segment_is_frame_border(line.p0, line.p1, size)
}

fn segment_is_frame_border(a: Point, b: Point, size: usize) -> bool {
    let max = (size - 1) as f32;
    let tol = 4.0;
    (a.y.abs() <= tol && b.y.abs() <= tol)
        || ((a.y - max).abs() <= tol && (b.y - max).abs() <= tol)
        || (a.x.abs() <= tol && b.x.abs() <= tol)
        || ((a.x - max).abs() <= tol && (b.x - max).abs() <= tol)
}

fn point_on_frame(point: Point, size: usize, tol: f32) -> bool {
    let max = (size - 1) as f32;
    point.x.abs() <= tol
        || point.y.abs() <= tol
        || (point.x - max).abs() <= tol
        || (point.y - max).abs() <= tol
}

fn point_in_frame(point: Point, size: usize, tol: f32) -> bool {
    let max = (size - 1) as f32;
    point.x >= -tol && point.y >= -tol && point.x <= max + tol && point.y <= max + tol
}

fn point_on_side(point: Point, side: usize, size: usize, tol: f32) -> bool {
    let max = (size - 1) as f32;
    match side {
        0 => point.y.abs() <= tol,
        1 => (point.x - max).abs() <= tol,
        2 => (point.y - max).abs() <= tol,
        _ => point.x.abs() <= tol,
    }
}

fn side_position(point: Point, side: usize) -> f32 {
    if side == 0 || side == 2 {
        point.x
    } else {
        point.y
    }
}

fn is_corner(point: Point, size: usize, tol: f32) -> bool {
    square_corners(size)
        .into_iter()
        .any(|corner| distance(point, corner) <= tol)
}

fn snap_to_frame(point: Point, size: usize, tol: f32) -> Point {
    let max = (size - 1) as f32;
    let mut x = point.x.clamp(0.0, max);
    let mut y = point.y.clamp(0.0, max);
    if x <= tol {
        x = 0.0;
    } else if (x - max).abs() <= tol {
        x = max;
    }
    if y <= tol {
        y = 0.0;
    } else if (y - max).abs() <= tol {
        y = max;
    }
    Point { x, y }
}

fn point_line_distance(point: Point, line: &Line) -> f32 {
    point_polar_distance(point, line.theta, line.rho)
}

fn point_polar_distance(point: Point, theta: f32, rho: f32) -> f32 {
    (point.x * theta.cos() + point.y * theta.sin() - rho).abs()
}

fn point_on_finite_line(point: Point, line: &Line, tol: f32) -> bool {
    if point_line_distance(point, line) > tol {
        return false;
    }
    let t = project(point, line.direction);
    t >= line.t_min - tol && t <= line.t_max + tol
}

fn project(point: Point, direction: Point) -> f32 {
    point.x * direction.x + point.y * direction.y
}

fn distance(a: Point, b: Point) -> f32 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    (dx * dx + dy * dy).sqrt()
}

fn angle_distance(a: f32, b: f32) -> f32 {
    let mut d = (a - b).abs() % std::f32::consts::PI;
    if d > std::f32::consts::PI / 2.0 {
        d = std::f32::consts::PI - d;
    }
    d
}

fn sigmoid(value: f32) -> f32 {
    1.0 / (1.0 + (-value).exp())
}

fn argmax_channel(values: &[f32], channels: usize, pixel_idx: usize, pixels: usize) -> usize {
    let mut best = 0usize;
    let mut best_value = f32::NEG_INFINITY;
    for channel in 0..channels {
        let value = values[channel * pixels + pixel_idx];
        if value > best_value {
            best_value = value;
            best = channel;
        }
    }
    best
}

fn softmax_channel(
    values: &[f32],
    channels: usize,
    pixel_idx: usize,
    channel: usize,
    pixels: usize,
) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let max_value = (0..channels)
        .map(|idx| values[idx * pixels + pixel_idx])
        .fold(f32::NEG_INFINITY, f32::max);
    let denom: f32 = (0..channels)
        .map(|idx| (values[idx * pixels + pixel_idx] - max_value).exp())
        .sum();
    if denom <= 0.0 {
        0.0
    } else {
        (values[channel * pixels + pixel_idx] - max_value).exp() / denom
    }
}

fn default_min_edge_support() -> f32 {
    0.45
}

fn default_min_edge_length_px() -> f32 {
    3.0
}

fn default_vertex_merge_px() -> f32 {
    2.0
}

fn default_line_vertex_distance_px() -> f32 {
    4.0
}

fn default_hough_vote_threshold() -> u32 {
    0
}

fn default_hough_suppression_radius() -> u32 {
    4
}

fn default_hough_line_distance_px() -> f32 {
    3.0
}

fn default_hough_min_segment_length_px() -> f32 {
    6.0
}

fn default_hough_max_segment_gap_px() -> f32 {
    18.0
}

fn default_carrier_extent_padding_px() -> f32 {
    8.0
}

fn default_carrier_merge_angle_degrees() -> f32 {
    2.5
}

fn default_carrier_merge_rho_px() -> f32 {
    3.0
}

fn default_max_line_hypotheses() -> usize {
    240
}

fn default_max_intersection_lines() -> usize {
    180
}

fn default_junction_snap_px() -> f32 {
    4.5
}

fn default_planar_cleanup() -> bool {
    true
}

fn default_planar_cleanup_max_edges() -> usize {
    2500
}

fn default_planar_split_vertex_distance_px() -> f32 {
    2.0
}

fn default_planar_crossing_support_tie() -> f32 {
    1e-4
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_square_cross_into_fold_json() {
        let size = 64usize;
        let pixels = size * size;
        let mut line_logits = vec![-8.0; pixels];
        let mut junction_logits = vec![-8.0; pixels];
        let non_crease_logits = vec![-8.0; pixels];
        let mut assignment_logits = vec![-4.0; pixels * 4];
        let line_style_logits = vec![-4.0; pixels * 4];
        let boundary_contact_logits = vec![-8.0; pixels];

        draw_prob_line(&mut line_logits, size, (32, 0), (32, 63), 8.0);
        draw_prob_line(&mut line_logits, size, (0, 32), (63, 32), 8.0);
        junction_logits[32 * size + 32] = 8.0;
        for y in 0..size {
            let idx = y * size + 32;
            assignment_logits[idx] = 8.0;
        }
        for x in 0..size {
            let idx = 32 * size + x;
            assignment_logits[pixels + idx] = 8.0;
        }

        let decoded = decode_dense_outputs(
            DenseOutputs {
                line_logits: &line_logits,
                junction_logits: &junction_logits,
                assignment_logits: &assignment_logits,
                non_crease_logits: &non_crease_logits,
                line_style_logits: &line_style_logits,
                boundary_contact_logits: &boundary_contact_logits,
            },
            DecodeConfig {
                image_size: size as u32,
                threshold: 0.65,
                ..DecodeConfig::default()
            },
        )
        .expect("decode should succeed");
        let fold: Value = serde_json::from_str(&decoded.fold_json).expect("fold JSON");

        assert_eq!(fold["file_classes"][0], "singleModel");
        assert!(
            decoded.report.border_edge_count >= 4,
            "{:?}",
            decoded.report
        );
        assert!(
            decoded.report.interior_edge_count >= 4,
            "{:?}",
            decoded.report
        );
        assert!(
            fold["edges_assignment"]
                .as_array()
                .unwrap()
                .iter()
                .any(|value| value == "M"),
            "{}",
            decoded.fold_json
        );
    }

    #[test]
    fn assignment_vote_recovers_valley_segment() {
        let size = 32usize;
        let pixels = size * size;
        let mut line_prob = vec![0.0; pixels];
        let mut assignment_logits = vec![-4.0; pixels * 4];
        for x in 2..30 {
            let idx = 16 * size + x;
            line_prob[idx] = 1.0;
            assignment_logits[pixels + idx] = 8.0;
        }

        let assignment = vote_assignment(
            Point { x: 2.0, y: 16.0 },
            Point { x: 29.0, y: 16.0 },
            &assignment_logits,
            &line_prob,
            &DecodeConfig {
                image_size: size as u32,
                threshold: 0.65,
                ..DecodeConfig::default()
            },
        );

        assert_eq!(assignment, 1);
    }

    fn draw_prob_line(
        logits: &mut [f32],
        size: usize,
        start: (usize, usize),
        end: (usize, usize),
        value: f32,
    ) {
        let dx = end.0 as isize - start.0 as isize;
        let dy = end.1 as isize - start.1 as isize;
        let steps = dx.abs().max(dy.abs()).max(1);
        for step in 0..=steps {
            let x = start.0 as isize + dx * step / steps;
            let y = start.1 as isize + dy * step / steps;
            for oy in -1..=1 {
                for ox in -1..=1 {
                    let px = x + ox;
                    let py = y + oy;
                    if px < 0 || py < 0 || px >= size as isize || py >= size as isize {
                        continue;
                    }
                    logits[py as usize * size + px as usize] = value;
                }
            }
        }
    }
}
