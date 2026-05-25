use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecodeConfig {
    pub image_size: u32,
    pub threshold: f32,
    #[serde(default = "default_min_edge_support")]
    pub min_edge_support: f32,
    #[serde(default = "default_vertex_merge_px")]
    pub vertex_merge_px: f32,
    #[serde(default = "default_line_vertex_distance_px")]
    pub line_vertex_distance_px: f32,
}

impl Default for DecodeConfig {
    fn default() -> DecodeConfig {
        DecodeConfig {
            image_size: 1024,
            threshold: 0.65,
            min_edge_support: default_min_edge_support(),
            vertex_merge_px: default_vertex_merge_px(),
            line_vertex_distance_px: default_line_vertex_distance_px(),
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
}

#[derive(Debug, Clone)]
struct Edge {
    a: usize,
    b: usize,
    assignment: u8,
    support: f32,
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
    vertices.extend(junction_points(
        outputs.junction_logits,
        &effective,
        &carriers,
        &config,
    ));
    for carrier in &carriers {
        vertices.push(snap_to_frame(carrier.p0, size, config.vertex_merge_px));
        vertices.push(snap_to_frame(carrier.p1, size, config.vertex_merge_px));
    }
    vertices = merge_vertices(&vertices, size, config.vertex_merge_px);

    let mut interior_edges = interior_edges(&vertices, &carriers, &effective, outputs, &config);
    dedupe_edges(&mut interior_edges);
    let used_boundary =
        used_boundary_vertices(&vertices, &interior_edges, size, config.vertex_merge_px);
    let mut border_edges = border_chain(&vertices, &used_boundary, size, &effective);
    let mut edges = Vec::new();
    edges.append(&mut interior_edges);
    edges.append(&mut border_edges);
    dedupe_edges(&mut edges);

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
    let stride = (size / 512).max(1);
    let theta_bins = 180usize;
    let max_coord = (size - 1) as f32;
    let rho_max = (2.0_f32).sqrt() * max_coord;
    let rho_bins = (rho_max.ceil() as usize) * 2 + 1;
    let mut accumulator = vec![0i32; theta_bins * rho_bins];
    let mut trig = Vec::with_capacity(theta_bins);
    for bin in 0..theta_bins {
        let theta = bin as f32 * std::f32::consts::PI / theta_bins as f32;
        trig.push((theta, theta.cos(), theta.sin()));
    }
    for y in (0..size).step_by(stride) {
        for x in (0..size).step_by(stride) {
            if line_prob[y * size + x] < config.threshold {
                continue;
            }
            let xf = x as f32;
            let yf = y as f32;
            for (theta_idx, (_, cos_t, sin_t)) in trig.iter().enumerate() {
                let rho = xf * cos_t + yf * sin_t;
                let rho_idx = (rho + rho_max).round() as isize;
                if rho_idx < 0 || rho_idx >= rho_bins as isize {
                    continue;
                }
                accumulator[theta_idx * rho_bins + rho_idx as usize] += 1;
            }
        }
    }

    let threshold = ((size / stride) / 18).max(10) as i32;
    let mut peaks = Vec::new();
    for theta_idx in 0..theta_bins {
        for rho_idx in 0..rho_bins {
            let votes = accumulator[theta_idx * rho_bins + rho_idx];
            if votes < threshold
                || !is_hough_local_max(
                    &accumulator,
                    theta_bins,
                    rho_bins,
                    theta_idx,
                    rho_idx,
                    votes,
                )
            {
                continue;
            }
            let (theta, _, _) = trig[theta_idx];
            let rho = rho_idx as f32 - rho_max;
            if let Some((p0, p1)) = clip_hough_line(theta, rho, size) {
                peaks.push(Line {
                    theta,
                    rho,
                    votes,
                    p0,
                    p1,
                    direction: Point {
                        x: -theta.sin(),
                        y: theta.cos(),
                    },
                });
            }
        }
    }
    peaks.sort_by(|a, b| b.votes.cmp(&a.votes));
    let mut merged: Vec<Line> = Vec::new();
    for line in peaks {
        if merged.iter().any(|existing| {
            angle_distance(existing.theta, line.theta) <= 2.5_f32.to_radians()
                && (existing.rho - line.rho).abs() <= 3.0
        }) {
            continue;
        }
        merged.push(line);
        if merged.len() >= 220 {
            break;
        }
    }
    merged
}

fn is_hough_local_max(
    accumulator: &[i32],
    theta_bins: usize,
    rho_bins: usize,
    theta_idx: usize,
    rho_idx: usize,
    votes: i32,
) -> bool {
    for dt in -2isize..=2 {
        for dr in -4isize..=4 {
            if dt == 0 && dr == 0 {
                continue;
            }
            let tt = ((theta_idx as isize + dt).rem_euclid(theta_bins as isize)) as usize;
            let rr = rho_idx as isize + dr;
            if rr < 0 || rr >= rho_bins as isize {
                continue;
            }
            if accumulator[tt * rho_bins + rr as usize] > votes {
                return false;
            }
        }
    }
    true
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
                .any(|line| point_line_distance(point, line) <= config.line_vertex_distance_px)
            {
                candidates.push((score, point));
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
            if point_line_distance(*vertex, carrier) <= config.line_vertex_distance_px {
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
            if distance(vertices[a], vertices[b]) < 3.0 {
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
                        vertex_merge_px: 2.0,
                        line_vertex_distance_px: 4.0,
                    },
                )
                .max(0.99),
            });
        }
    }
    edges
}

fn used_boundary_vertices(vertices: &[Point], edges: &[Edge], size: usize, tol: f32) -> Vec<usize> {
    let mut used = Vec::new();
    for edge in edges {
        for idx in [edge.a, edge.b] {
            if point_on_frame(vertices[idx], size, tol) && !is_corner(vertices[idx], size, tol) {
                used.push(idx);
            }
        }
    }
    used.sort_unstable();
    used.dedup();
    used
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
    (point.x * line.theta.cos() + point.y * line.theta.sin() - line.rho).abs()
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

fn default_vertex_merge_px() -> f32 {
    2.0
}

fn default_line_vertex_distance_px() -> f32 {
    4.0
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
