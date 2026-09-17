//! Measure subpixel stroke centers around a recognized graph in the original
//! image. Color separates M/V/AUX. No reference geometry or trained parameters.
use oristudio_cp_compiler::image_evidence::{SourceImageEvidence, SourceLineFit};
use oristudio_cp_compiler::{
    AssignmentLabel, BoundarySide, CandidateVertexMovementPolicy, ExactSolveInput, Point2,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SourceLineFitError {
    #[error("source image dimensions or RGBA buffer are invalid")]
    InvalidImage,
    #[error("source paper quadrilateral is invalid")]
    InvalidQuad,
    #[error("source graph contains invalid coordinates or vertex indices")]
    InvalidGraph,
}

struct Map([f64; 8]);
impl Map {
    fn new(q: [[f64; 2]; 4]) -> Option<Self> {
        if q.iter().flatten().any(|v| !v.is_finite()) {
            return None;
        }
        let [a, b, c, d] = q;
        let dx1 = b[0] - c[0];
        let dx2 = d[0] - c[0];
        let dy1 = b[1] - c[1];
        let dy2 = d[1] - c[1];
        let rx = a[0] - b[0] + c[0] - d[0];
        let ry = a[1] - b[1] + c[1] - d[1];
        let det = dx1 * dy2 - dx2 * dy1;
        if det.abs() < 1e-8 {
            return None;
        }
        let g = (rx * dy2 - dx2 * ry) / det;
        let h = (dx1 * ry - rx * dy1) / det;
        let m = Self([
            b[0] - a[0] + g * b[0],
            d[0] - a[0] + h * d[0],
            a[0],
            b[1] - a[1] + g * b[1],
            d[1] - a[1] + h * d[1],
            a[1],
            g,
            h,
        ]);
        for point in [
            Point2::new(0., 0.),
            Point2::new(1., 0.),
            Point2::new(1., 1.),
            Point2::new(0., 1.),
        ] {
            m.forward(point)?;
        }
        Some(m)
    }
    fn forward(&self, p: Point2) -> Option<Point2> {
        let m = &self.0;
        let den = m[6] * p.x + m[7] * p.y + 1.;
        if den.abs() < 1e-10 {
            return None;
        }
        let q = Point2::new(
            (m[0] * p.x + m[1] * p.y + m[2]) / den,
            (m[3] * p.x + m[4] * p.y + m[5]) / den,
        );
        (q.x.is_finite() && q.y.is_finite()).then_some(q)
    }
    fn inverse(&self, p: Point2) -> Option<Point2> {
        let m = &self.0;
        let a = m[0] - p.x * m[6];
        let b = m[1] - p.x * m[7];
        let c = m[3] - p.y * m[6];
        let d = m[4] - p.y * m[7];
        let det = a * d - b * c;
        if det.abs() < 1e-12 {
            return None;
        }
        let x = p.x - m[2];
        let y = p.y - m[5];
        Some(Point2::new((x * d - b * y) / det, (a * y - x * c) / det))
    }
}

fn quantile(values: &[f64], fraction: f64) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    if sorted.is_empty() {
        return 0.;
    }
    let p = fraction * (sorted.len() - 1) as f64;
    let i = p.floor() as usize;
    sorted[i] + (sorted[(i + 1).min(sorted.len() - 1)] - sorted[i]) * (p - i as f64)
}

fn blur(plane: &mut [f64], width: usize, height: usize, sigma: f64) {
    let mut kernel = [0.; 5];
    for (i, k) in kernel.iter_mut().enumerate() {
        *k = (-((i as f64 - 2.) / sigma).powi(2) / 2.).exp();
    }
    let sum: f64 = kernel.iter().sum();
    for k in &mut kernel {
        *k /= sum;
    }
    let reflect = |i: isize, n: usize| -> usize {
        if i < 0 {
            (-i - 1) as usize
        } else if i >= n as isize {
            (2 * n as isize - i - 1) as usize
        } else {
            i as usize
        }
    };
    let mut temp = vec![0.; width * height];
    for y in 0..height {
        for x in 0..width {
            temp[y * width + x] = kernel
                .iter()
                .enumerate()
                .map(|(k, w)| w * plane[y * width + reflect(x as isize + k as isize - 2, width)])
                .sum();
        }
    }
    for y in 0..height {
        for x in 0..width {
            plane[y * width + x] = kernel
                .iter()
                .enumerate()
                .map(|(k, w)| w * temp[reflect(y as isize + k as isize - 2, height) * width + x])
                .sum();
        }
    }
}

// One color at a time bounds temporary storage to two f64 planes, rather than
// keeping every color plane alive alongside the original high-resolution image.
struct Field {
    width: usize,
    height: usize,
    plane: Vec<f64>,
}
impl Field {
    fn new(rgba: &[u8], width: usize, height: usize, label: Option<AssignmentLabel>) -> Self {
        let mut plane = Vec::with_capacity(width * height);
        for pixel in rgba.chunks_exact(4) {
            let alpha = f64::from(pixel[3]) / 255.;
            let [r, g, b] =
                [pixel[0], pixel[1], pixel[2]].map(|v| f64::from(v) / 255. * alpha + 1. - alpha);
            plane.push(
                match label {
                    Some(AssignmentLabel::Mountain) => r - (g + b) / 2.,
                    Some(AssignmentLabel::Valley) => b - r.max(g),
                    Some(AssignmentLabel::Flat) => g.min(b) - r - 1.5 * (g - b).abs(),
                    Some(_) => 1. - (r + g + b) / 3.,
                    None => 1. - r.max(g).max(b) - (r.max(g).max(b) - r.min(g).min(b)),
                }
                .max(0.),
            );
        }
        blur(
            &mut plane,
            width,
            height,
            if label.is_some() { 0.6 } else { 0.4 },
        );
        Self {
            width,
            height,
            plane,
        }
    }
    fn sample(&self, p: Point2) -> f64 {
        let plane = &self.plane;
        let x = p.x.clamp(0., (self.width - 1) as f64);
        let y = p.y.clamp(0., (self.height - 1) as f64);
        let ix = x.floor() as usize;
        let iy = y.floor() as usize;
        let jx = (ix + 1).min(self.width - 1);
        let jy = (iy + 1).min(self.height - 1);
        let tx = x - ix as f64;
        let ty = y - iy as f64;
        (1. - ty) * ((1. - tx) * plane[iy * self.width + ix] + tx * plane[iy * self.width + jx])
            + ty * ((1. - tx) * plane[jy * self.width + ix] + tx * plane[jy * self.width + jx])
    }
}

fn regression(samples: &[[f64; 2]]) -> Option<(f64, f64)> {
    if samples.len() < 4 {
        return None;
    }
    let n = samples.len() as f64;
    let x = samples.iter().map(|p| p[0]).sum::<f64>() / n;
    let y = samples.iter().map(|p| p[1]).sum::<f64>() / n;
    let xx = samples.iter().map(|p| (p[0] - x).powi(2)).sum::<f64>();
    if xx < 1e-12 {
        return None;
    }
    let slope = samples.iter().map(|p| (p[0] - x) * (p[1] - y)).sum::<f64>() / xx;
    Some((slope, y - slope * x))
}

fn fit_line(
    input: &ExactSolveInput,
    span: &oristudio_cp_compiler::CandidateCreaseSpan,
    map: &Map,
    fields: &Field,
) -> Option<SourceLineFit> {
    if span.assignment_label() == AssignmentLabel::Boundary {
        return None;
    }
    let [a, b] = span.vertices;
    let first = map.forward(input.vertices[a].point)?;
    let last = map.forward(input.vertices[b].point)?;
    let dx = last.x - first.x;
    let dy = last.y - first.y;
    let length = dx.hypot(dy);
    if length < 6. {
        return None;
    }
    let tangent = Point2::new(dx / length, dy / length);
    let normal = Point2::new(-tangent.y, tangent.x);
    let margin = 4_f64.min(length * 0.25);
    let count = ((length / 2.) as usize).clamp(5, 4096);
    let mut samples = Vec::new();
    for j in 0..count {
        let along = margin + (length - 2. * margin) * j as f64 / (count - 1) as f64;
        let center = Point2::new(first.x + tangent.x * along, first.y + tangent.y * along);
        let profile: Vec<f64> = (0..25)
            .map(|k| {
                let shift = -3. + k as f64 * 0.25;
                fields.sample(Point2::new(
                    center.x + normal.x * shift,
                    center.y + normal.y * shift,
                ))
            })
            .collect();
        let (peak, &height) = profile
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))?;
        if height <= 0.08 || peak <= 1 || peak >= 23 {
            continue;
        }
        let background = quantile(&profile, 0.15);
        let mut mass = 0.;
        let mut moment = 0.;
        for (k, value) in profile.iter().enumerate() {
            let w = (value - background).max(0.);
            mass += w;
            moment += w * (-3. + k as f64 * 0.25);
        }
        if mass > 1e-6 {
            samples.push([along - length / 2., moment / mass]);
        }
    }
    if samples.len() < 4 || (samples.len() as f64) < (count as f64 * 0.6) {
        return None;
    }
    for _ in 0..3 {
        let (slope, intercept) = regression(&samples)?;
        let residuals: Vec<_> = samples
            .iter()
            .map(|p| (p[1] - slope * p[0] - intercept).abs())
            .collect();
        let limit = 0.15_f64.max(2.5 * quantile(&residuals, 0.5));
        let retained: Vec<_> = samples
            .iter()
            .zip(residuals)
            .filter_map(|(p, r)| (r < limit).then_some(*p))
            .collect();
        if retained.len() < 4 {
            break;
        }
        samples = retained;
    }
    let (slope, intercept) = regression(&samples)?;
    let sigma = (samples
        .iter()
        .map(|p| (p[1] - slope * p[0] - intercept).powi(2))
        .sum::<f64>()
        / samples.len() as f64)
        .sqrt();
    if sigma > 0.4 {
        return None;
    }
    let left = intercept - slope * length / 2.;
    let right = intercept + slope * length / 2.;
    let a = map.inverse(Point2::new(
        first.x + normal.x * left,
        first.y + normal.y * left,
    ))?;
    let b = map.inverse(Point2::new(
        last.x + normal.x * right,
        last.y + normal.y * right,
    ))?;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let size = dx.hypot(dy);
    if size < 1e-12 {
        return None;
    }
    let n = Point2::new(-dy / size, dx / size);
    Some(SourceLineFit {
        span_id: span.id,
        vertices: span.vertices,
        assignment: span.assignment_label(),
        normal: n,
        rho: n.x * a.x + n.y * a.y,
        length_pixels: length,
        sigma_pixels: sigma,
    })
}

/// Independent two-coordinate least-squares blocks are equivalent to the
/// sparse research fit, without a browser dependency on a linear algebra VM.
fn fitted_vertices(input: &ExactSolveInput, lines: &[SourceLineFit]) -> Vec<Point2> {
    let mut blocks = vec![[1., 0., 1., 0., 0.]; input.vertices.len()];
    for (block, v) in blocks.iter_mut().zip(&input.vertices) {
        block[3] = v.point.x;
        block[4] = v.point.y;
    }
    for line in lines {
        let w = line.length_pixels.min(100.);
        let n = line.normal;
        for &v in &line.vertices {
            if let Some(block) = blocks.get_mut(v) {
                block[0] += w * n.x * n.x;
                block[1] += w * n.x * n.y;
                block[2] += w * n.y * n.y;
                block[3] += w * n.x * line.rho;
                block[4] += w * n.y * line.rho;
            }
        }
    }
    input
        .vertices
        .iter()
        .zip(blocks)
        .map(|(v, b)| {
            if v.movement_policy == CandidateVertexMovementPolicy::Locked
                || input.boundary.corners.contains(&v.id)
            {
                return v.point;
            }
            if matches!(
                v.boundary_side,
                Some(BoundarySide::Top | BoundarySide::Bottom)
            ) {
                return Point2::new((b[3] - b[1] * v.point.y) / b[0], v.point.y);
            }
            if matches!(
                v.boundary_side,
                Some(BoundarySide::Left | BoundarySide::Right)
            ) {
                return Point2::new(v.point.x, (b[4] - b[1] * v.point.x) / b[2]);
            }
            let det = b[0] * b[2] - b[1] * b[1];
            Point2::new(
                (b[3] * b[2] - b[1] * b[4]) / det,
                (b[0] * b[4] - b[1] * b[3]) / det,
            )
        })
        .collect()
}

/// Recenter the supplied crop on neutral boundary ink within three source
/// pixels. This estimates raster alignment, not a new crop or paper shape.
pub fn refine_source_border(
    rgba: &[u8],
    width: u32,
    height: u32,
    quad: [[f64; 2]; 4],
) -> Result<[[f64; 2]; 4], SourceLineFitError> {
    let width = width as usize;
    let height = height as usize;
    if width < 3
        || height < 3
        || width.checked_mul(height).and_then(|n| n.checked_mul(4)) != Some(rgba.len())
    {
        return Err(SourceLineFitError::InvalidImage);
    }
    Map::new(quad).ok_or(SourceLineFitError::InvalidQuad)?;
    let neutral = Field::new(rgba, width, height, None);
    let mut lines = [(Point2::new(0., 0.), 0.); 4];
    for i in 0..4 {
        let a = quad[i];
        let b = quad[(i + 1) % 4];
        let length = (b[0] - a[0]).hypot(b[1] - a[1]);
        if length < 1. {
            return Err(SourceLineFitError::InvalidQuad);
        }
        let normal = Point2::new(-(b[1] - a[1]) / length, (b[0] - a[0]) / length);
        let profile: Vec<f64> = (0..121)
            .map(|k| {
                let offset = -3. + k as f64 * 0.05;
                (0..400)
                    .map(|j| {
                        let t = 0.03 + 0.94 * j as f64 / 399.;
                        neutral.sample(Point2::new(
                            a[0] + t * (b[0] - a[0]) + offset * normal.x,
                            a[1] + t * (b[1] - a[1]) + offset * normal.y,
                        ))
                    })
                    .sum::<f64>()
                    / 400.
            })
            .collect();
        let background = quantile(&profile, 0.2);
        let mut mass = 0.;
        let mut moment = 0.;
        for (k, &v) in profile.iter().enumerate() {
            let weight = (v - background).max(0.);
            mass += weight;
            moment += weight * (-3. + k as f64 * 0.05);
        }
        let shift = if mass > 1e-6 { moment / mass } else { 0. };
        lines[i] = (normal, normal.x * a[0] + normal.y * a[1] + shift);
    }
    let mut refined = quad;
    for i in 0..4 {
        let (a, ra) = lines[(i + 3) % 4];
        let (b, rb) = lines[i];
        let det = a.x * b.y - a.y * b.x;
        if det.abs() < 1e-8 {
            return Err(SourceLineFitError::InvalidQuad);
        }
        refined[i] = [(ra * b.y - a.y * rb) / det, (a.x * rb - ra * b.x) / det];
    }
    Map::new(refined).ok_or(SourceLineFitError::InvalidQuad)?;
    Ok(refined)
}

pub fn measure_source_lines(
    input: &ExactSolveInput,
    rgba: &[u8],
    width: u32,
    height: u32,
    quad: [[f64; 2]; 4],
) -> Result<SourceImageEvidence, SourceLineFitError> {
    let width = width as usize;
    let height = height as usize;
    if width < 3
        || height < 3
        || width.checked_mul(height).and_then(|n| n.checked_mul(4)) != Some(rgba.len())
    {
        return Err(SourceLineFitError::InvalidImage);
    }
    if input
        .vertices
        .iter()
        .enumerate()
        .any(|(i, v)| v.id != i || !v.point.x.is_finite() || !v.point.y.is_finite())
        || input
            .selected_spans
            .iter()
            .any(|s| s.vertices.iter().any(|&v| v >= input.vertices.len()))
    {
        return Err(SourceLineFitError::InvalidGraph);
    }
    let map = Map::new(quad).ok_or(SourceLineFitError::InvalidQuad)?;
    let mut lines = Vec::new();
    for label in [
        AssignmentLabel::Mountain,
        AssignmentLabel::Valley,
        AssignmentLabel::Flat,
        AssignmentLabel::Unknown,
    ] {
        let matches = |span: &&oristudio_cp_compiler::CandidateCreaseSpan| {
            let observed = span.assignment_label();
            observed == label
                || (label == AssignmentLabel::Unknown
                    && !matches!(
                        observed,
                        AssignmentLabel::Mountain
                            | AssignmentLabel::Valley
                            | AssignmentLabel::Flat
                            | AssignmentLabel::Boundary
                    ))
        };
        if !input.selected_spans.iter().any(|s| matches(&s)) {
            continue;
        }
        let field = Field::new(rgba, width, height, Some(label));
        lines.extend(
            input
                .selected_spans
                .iter()
                .filter(matches)
                .filter_map(|span| fit_line(input, span, &map, &field)),
        );
    }
    lines.sort_by_key(|line| line.span_id);
    let fitted = fitted_vertices(input, &lines);
    let pixels_per_unit = (0..4)
        .map(|i| (quad[i][0] - quad[(i + 1) % 4][0]).hypot(quad[i][1] - quad[(i + 1) % 4][1]))
        .sum::<f64>()
        / 4.;
    Ok(SourceImageEvidence {
        observed_vertices: input.vertices.iter().map(|v| v.point).collect(),
        pixels_per_unit,
        lines,
        fitted_vertices: fitted,
    })
}

/// Carry the detector resolution (and its uncertainty scale) through a FOLD
/// rebuild. Both frames refer to the same saved reference image.
pub fn inherited_image_size(
    previous: &ExactSolveInput,
    quad: [[f64; 2]; 4],
    previous_quad: [[f64; 2]; 4],
) -> Option<u32> {
    let original = previous.image_size?;
    Map::new(quad)?;
    Map::new(previous_quad)?;
    let perimeter = |q: [[f64; 2]; 4]| {
        (0..4)
            .map(|i| (q[i][0] - q[(i + 1) % 4][0]).hypot(q[i][1] - q[(i + 1) % 4][1]))
            .sum::<f64>()
    };
    let size = f64::from(original) * perimeter(quad) / perimeter(previous_quad);
    (size.is_finite() && size > 0. && size <= f64::from(u32::MAX))
        .then(|| size.round().max(1.) as u32)
}

/// Reuse original-raster observations for strokes still present in a rebuilt
/// document graph. The saved underlay is rectified and compressed; measuring it
/// again needlessly discards precision. Both quadrilaterals refer to that same
/// underlay, so image/document rotation, reflection and translation are explicit.
/// A moved or recolored stroke cannot inherit an old observation. Splitting an
/// unchanged stroke at a new junction can, because its supporting ink is intact.
pub fn reuse_source_lines(
    input: &ExactSolveInput,
    evidence: &mut SourceImageEvidence,
    quad: [[f64; 2]; 4],
    previous: &ExactSolveInput,
    previous_quad: [[f64; 2]; 4],
) -> usize {
    let Some(old) = &previous.image_evidence else {
        return 0;
    };
    if old.observed_vertices.len() != previous.vertices.len()
        || old
            .observed_vertices
            .iter()
            .zip(&previous.vertices)
            .any(|(p, v)| *p != v.point)
        || !old.pixels_per_unit.is_finite()
        || old.pixels_per_unit <= 0.
    {
        return 0;
    }
    let (Some(current_map), Some(previous_map)) = (Map::new(quad), Map::new(previous_quad)) else {
        return 0;
    };
    let to_previous = |p| previous_map.inverse(current_map.forward(p)?);
    let to_current = |p| current_map.inverse(previous_map.forward(p)?);
    let valid: Vec<_> = old
        .lines
        .iter()
        .filter(|line| {
            if !line.normal.x.is_finite()
                || !line.normal.y.is_finite()
                || (line.normal.x.hypot(line.normal.y) - 1.).abs() > 1e-6
                || !line.rho.is_finite()
                || !line.sigma_pixels.is_finite()
                || line.sigma_pixels < 0.
                || !line.length_pixels.is_finite()
                || line.length_pixels <= 0.
                || !previous.selected_spans.iter().any(|s| {
                    s.id == line.span_id
                        && s.vertices == line.vertices
                        && s.assignment_label() == line.assignment
                })
            {
                return false;
            }
            true
        })
        .collect();
    let mut reused = 0;
    for span in &input.selected_spans {
        let [a, b] = span.vertices;
        let (Some(a), Some(b)) = (input.vertices.get(a), input.vertices.get(b)) else {
            continue;
        };
        let (Some(a), Some(b)) = (to_previous(a.point), to_previous(b.point)) else {
            continue;
        };
        for line in &valid {
            if span.assignment_label() != line.assignment {
                continue;
            }
            let [u, v] = line.vertices;
            let (Some(u), Some(v)) = (old.observed_vertices.get(u), old.observed_vertices.get(v))
            else {
                continue;
            };
            let dx = v.x - u.x;
            let dy = v.y - u.y;
            let length = dx.hypot(dy);
            if length < 1e-10 {
                continue;
            }
            let on_segment = |p: Point2| {
                let x = p.x - u.x;
                let y = p.y - u.y;
                let along = (x * dx + y * dy) / length;
                (x * dy - y * dx).abs() / length < 1e-7 && along >= -1e-7 && along <= length + 1e-7
            };
            if !on_segment(a) || !on_segment(b) {
                continue;
            }
            let p = Point2::new(line.normal.x * line.rho, line.normal.y * line.rho);
            let q = Point2::new(p.x - line.normal.y, p.y + line.normal.x);
            let (Some(p), Some(q)) = (to_current(p), to_current(q)) else {
                continue;
            };
            let norm = (q.x - p.x).hypot(q.y - p.y);
            if norm < 1e-10 {
                continue;
            }
            let normal = Point2::new(-(q.y - p.y) / norm, (q.x - p.x) / norm);
            let scale = evidence.pixels_per_unit * norm / old.pixels_per_unit;
            let fit = SourceLineFit {
                span_id: span.id,
                vertices: span.vertices,
                assignment: line.assignment,
                normal,
                rho: normal.x * p.x + normal.y * p.y,
                length_pixels: line.length_pixels * (a.x - b.x).hypot(a.y - b.y) / length * scale,
                sigma_pixels: ((line.sigma_pixels * scale).powi(2)
                    + ((scale * scale - 1.) / 12.).max(0.))
                .sqrt(),
            };
            evidence.lines.retain(|f| f.span_id != span.id);
            evidence.lines.push(fit);
            reused += 1;
            break;
        }
    }
    evidence.lines.sort_by_key(|line| line.span_id);
    evidence.fitted_vertices = fitted_vertices(input, &evidence.lines);
    reused
}

#[cfg(test)]
mod tests {
    use super::*;
    use treemaker_fold::{Assignment, FoldDocument};

    fn stripe_input(x: f64) -> ExactSolveInput {
        let mut fold = FoldDocument::new(
            vec![
                vec![0., 0.],
                vec![1., 0.],
                vec![1., 1.],
                vec![0., 1.],
                vec![x, 0.],
                vec![x, 1.],
            ],
            vec![[0, 4], [4, 1], [1, 2], [2, 5], [5, 3], [3, 0], [4, 5]],
        );
        fold.edges_assignment = vec![Assignment::Boundary; 6];
        fold.edges_assignment.push(Assignment::Mountain);
        oristudio_cp_compiler::exact_solve_input_from_fold(&fold)
            .unwrap()
            .0
    }

    fn stripe_rgba(center: f64, color: [u8; 3]) -> Vec<u8> {
        let mut rgba = vec![255; 256 * 256 * 4];
        for y in 16..=240 {
            for x in 0..256 {
                let strength = (-((x as f64 - center) / 0.7).powi(2) / 2.).exp();
                for c in 0..3 {
                    rgba[(y * 256 + x) * 4 + c] =
                        (255. - strength * (255. - f64::from(color[c]))).round() as u8;
                }
            }
        }
        rgba
    }

    #[test]
    fn measures_a_subpixel_center_and_preserves_the_paper_boundary() {
        let input = stripe_input(0.404);
        let evidence = measure_source_lines(
            &input,
            &stripe_rgba(16. + 224. * 0.4, [255, 0, 0]),
            256,
            256,
            [[16., 16.], [240., 16.], [240., 240.], [16., 240.]],
        )
        .unwrap();
        assert_eq!(evidence.lines.len(), 1);
        // Raster centering and the weak position prior are observations, not
        // exact construction recovery: reduce ~0.9px error below 0.05px.
        for &v in &[4, 5] {
            assert!(
                (evidence.fitted_vertices[v].x - 0.4).abs() * 224. < 0.05,
                "{:?}",
                evidence
            );
            assert_eq!(evidence.fitted_vertices[v].y, input.vertices[v].point.y);
        }
        for v in 0..4 {
            assert_eq!(evidence.fitted_vertices[v], input.vertices[v].point);
        }
    }

    #[test]
    fn cyan_is_separate_from_a_valley_and_a_pin_overrides_the_ink() {
        let mut input = stripe_input(0.404);
        let rgba = stripe_rgba(16. + 224. * 0.4, [0, 200, 200]);
        let quad = [[16., 16.], [240., 16.], [240., 240.], [16., 240.]];
        input.selected_spans[6].assignment_evidence.observed_label = AssignmentLabel::Valley;
        assert!(
            measure_source_lines(&input, &rgba, 256, 256, quad)
                .unwrap()
                .lines
                .is_empty()
        );
        input.selected_spans[6].assignment_evidence.observed_label = AssignmentLabel::Flat;
        input.vertices[4].movement_policy = CandidateVertexMovementPolicy::Locked;
        let evidence = measure_source_lines(&input, &rgba, 256, 256, quad).unwrap();
        assert_eq!(evidence.lines.len(), 1);
        assert_eq!(evidence.fitted_vertices[4], input.vertices[4].point);
        assert!(
            (evidence.fitted_vertices[5].x - 0.4).abs() * 224. < 0.05,
            "{:?}",
            evidence
        );
    }

    #[test]
    fn detector_resolution_survives_a_rebuild_and_changes_only_with_paper_scale() {
        let mut previous = stripe_input(0.4);
        let quad = [[16., 16.], [240., 16.], [240., 240.], [16., 240.]];
        assert_eq!(inherited_image_size(&previous, quad, quad), None);
        previous.image_size = Some(2048);
        assert_eq!(inherited_image_size(&previous, quad, quad), Some(2048));
        assert_eq!(
            inherited_image_size(&previous, [quad[3], quad[0], quad[1], quad[2]], quad),
            Some(2048)
        );
        let half = quad.map(|p| [16. + (p[0] - 16.) / 2., 16. + (p[1] - 16.) / 2.]);
        assert_eq!(inherited_image_size(&previous, half, quad), Some(1024));
    }

    #[test]
    fn original_observations_survive_saving_but_not_moving_or_recoloring_a_stroke() {
        let mut previous = stripe_input(0.404);
        let quad = [[16., 16.], [240., 16.], [240., 240.], [16., 240.]];
        let original = measure_source_lines(
            &previous,
            &stripe_rgba(16. + 224. * 0.4, [255, 0, 0]),
            256,
            256,
            quad,
        )
        .unwrap();
        previous.image_evidence = Some(original.clone());
        let blank = vec![255; 256 * 256 * 4];
        let mut current = previous.clone();
        current.image_evidence = None;
        let mut measured = measure_source_lines(&current, &blank, 256, 256, quad).unwrap();
        assert!(measured.lines.is_empty());
        assert_eq!(
            reuse_source_lines(&current, &mut measured, quad, &previous, quad),
            1
        );
        for v in [4, 5] {
            assert!((measured.fitted_vertices[v].x - original.fitted_vertices[v].x).abs() < 1e-12);
        }
        current.selected_spans[6].assignment_evidence.observed_label = AssignmentLabel::Valley;
        assert_eq!(
            reuse_source_lines(&current, &mut measured, quad, &previous, quad),
            0
        );
        current.selected_spans[6].assignment_evidence.observed_label = AssignmentLabel::Mountain;
        current.vertices[4].point.x += 0.001;
        assert_eq!(
            reuse_source_lines(&current, &mut measured, quad, &previous, quad),
            0
        );
        current.vertices[4].point.x -= 0.001;
        previous.vertices[4].point.x += 0.001;
        assert_eq!(
            reuse_source_lines(&current, &mut measured, quad, &previous, quad),
            0
        );
    }

    #[test]
    fn original_observations_follow_rotation_and_a_new_split_vertex() {
        let mut previous = stripe_input(0.404);
        let quad = [[16., 16.], [240., 16.], [240., 240.], [16., 240.]];
        previous.image_evidence = Some(
            measure_source_lines(
                &previous,
                &stripe_rgba(16. + 224. * 0.4, [255, 0, 0]),
                256,
                256,
                quad,
            )
            .unwrap(),
        );
        let mut current = previous.clone();
        current.image_evidence = None;
        for vertex in &mut current.vertices {
            vertex.point = Point2::new(1. - vertex.point.y, vertex.point.x);
        }
        current.vertices[4].boundary_side = Some(BoundarySide::Right);
        current.vertices[5].boundary_side = Some(BoundarySide::Left);
        let mut junction = current.vertices[4].clone();
        junction.id = 6;
        junction.point = Point2::new(0.5, 0.404);
        junction.boundary_side = None;
        junction.movement_policy = CandidateVertexMovementPolicy::Movable;
        current.vertices.push(junction);
        let mut second = current.selected_spans[6].clone();
        current.selected_spans[6].vertices = [4, 6];
        second.id = 7;
        second.vertices = [6, 5];
        current.selected_spans.push(second);
        let rotated = [quad[3], quad[0], quad[1], quad[2]];
        let mut measured =
            measure_source_lines(&current, &vec![255; 256 * 256 * 4], 256, 256, rotated).unwrap();
        assert_eq!(
            reuse_source_lines(&current, &mut measured, rotated, &previous, quad),
            2
        );
        for v in [4, 5, 6] {
            assert!((measured.fitted_vertices[v].y - 0.4).abs() * 224. < 0.05);
        }
        assert_eq!(measured.fitted_vertices[4].x, 1.);
        assert_eq!(measured.fitted_vertices[5].x, 0.);
    }

    #[test]
    fn recenters_the_source_frame_on_neutral_border_ink_only() {
        let quad = [[16., 17.], [239., 17.], [239., 240.], [16., 240.]];
        let mut rgba = vec![255; 256 * 256 * 4];
        for y in 0..256 {
            for x in 0..256 {
                let distance = (x as f64 - 16.4)
                    .abs()
                    .min((x as f64 - 239.4).abs())
                    .min((y as f64 - 17.2).abs())
                    .min((y as f64 - 240.2).abs());
                let gray = (255. * (1. - (-(distance / 0.7).powi(2) / 2.).exp())).round() as u8;
                rgba[(y * 256 + x) * 4..(y * 256 + x) * 4 + 3].fill(gray);
            }
        }
        let refined = refine_source_border(&rgba, 256, 256, quad).unwrap();
        for (point, original) in refined.iter().zip(quad) {
            assert!((point[0] - original[0] - 0.4).abs() < 0.02);
            assert!((point[1] - original[1] - 0.2).abs() < 0.02);
        }
        // A nearby red crease is not evidence for shifting the paper frame.
        let colored = stripe_rgba(18., [255, 0, 0]);
        assert_eq!(
            refine_source_border(&colored, 256, 256, quad).unwrap(),
            quad
        );
    }

    #[test]
    fn perspective_mapping_round_trips_and_malformed_graph_is_rejected() {
        let quad = [[10., 20.], [230., 30.], [210., 245.], [35., 210.]];
        let map = Map::new(quad).unwrap();
        for p in [
            Point2::new(0., 0.),
            Point2::new(0.7, 0.4),
            Point2::new(1., 1.),
        ] {
            let q = map.inverse(map.forward(p).unwrap()).unwrap();
            assert!((q.x - p.x).abs() < 1e-12 && (q.y - p.y).abs() < 1e-12);
        }
        let mut input = stripe_input(0.4);
        input.selected_spans[6].vertices[0] = 100;
        assert!(matches!(
            measure_source_lines(&input, &vec![255; 256 * 256 * 4], 256, 256, quad),
            Err(SourceLineFitError::InvalidGraph)
        ));
    }
}
