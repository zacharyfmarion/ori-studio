use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const DEFAULT_BORDER_MARGIN_RATIO: f32 = 32.0 / 1024.0;

/// Where the paper goes inside the rectified image: `[margin, image_size -
/// margin]`, on **every** path.
///
/// This is not a preference, it is the one convention three separate things
/// already agree on and rectification has to join:
///
/// - the **training renders** put the paper frame at exactly `32 .. 992` of 1024
///   (`render_metadata.json`'s `v2_boundary.frame` in every eval pack sample),
///   so this is the distribution the model learned;
/// - the **decoder** reads it back the same way — `unit_from_px` maps `u = 0` to
///   pixel `32` and `u = 1` to pixel `image_size - 32`
///   (`candidate_generation/junction_carrier_v1.rs:1223`), never consulting the
///   report;
/// - the **repair underlay** is sized from that same constant, because the
///   creases it registers with came out of the decoder.
///
/// Only `warp_detected_panel` used to land near it, and it was a pixel short —
/// `image_size - 1 - margin` spans 959 rather than 960. `resize_full_frame` and
/// `resize_without_panel` did not inset at all, so a clean already-cropped CP —
/// the common case, and the one that takes those paths — was handed to the model
/// with its paper filling the frame and then decoded as though it were inset:
/// off-distribution going in, and 1024/960 ≈ 6.7% out of scale coming back.
fn paper_target_span(image_size: u32) -> (f32, f32) {
    let margin = (image_size as f32 * DEFAULT_BORDER_MARGIN_RATIO)
        .round()
        .clamp(2.0, (image_size.saturating_sub(2) / 2) as f32);
    (margin, image_size as f32 - margin)
}
const MIN_PANEL_CONFIDENCE: f32 = 0.72;
/// The floor for calling a candidate a bordered square at all: square to
/// within about 6%, which a scan or a photograph of one still is.
const LOOSE_SQUARE_SCORE: f64 = 0.9;
/// A bordered square the finder may prefer for its size over a better-scoring
/// one: square to within about a percent (`square_score` is
/// `1 - |ln aspect| / ln 1.8`).
const GENUINE_SQUARE_SCORE: f64 = 0.985;
/// Two genuine squares whose areas are within this ratio are one paper seen
/// twice, the second shifted onto a title or a crease row (0.4–1.1% larger
/// on the curated scans); the better-supported one is the paper.
const SAME_SIZE_AREA_RATIO: f32 = 0.98;
/// A genuine square replaces the largest bordered box only when it fills
/// this much of it: the box is then the paper plus one extension (0.95–0.97
/// on the curated scans), not a paper with a square drawn inside.
const PAPER_OF_BOX_AREA_RATIO: f32 = 0.85;
/// A full-frame border needs every side of the frame on an edge at least this
/// far, not only the mean: a scan with one dark edge is not a paper filling
/// the frame.
const FRAME_MIN_SIDE_SUPPORT: f32 = 0.5;
/// How far apart two projection peaks must be, as a fraction of the image's
/// smaller side, to be opposite sides of a panel rather than one thick line.
const MIN_PANEL_SPAN_RATIO: f32 = 0.12;
/// How many lines an axis offers the panel search. The search is every pair
/// against every pair, so this is a fourth-power cost.
const MAX_AXIS_CLUSTERS: usize = 12;
/// How many angles the sweep looks at across the square's 90° of symmetry.
const ANGLE_SWEEP_STEPS: usize = 90;
/// Roughly how many pixels one projection in the sweep looks at, whatever the
/// image's size. The sweep is ninety projections per axis and has to stay
/// cheap on a photograph as well as on a diagram.
const ANGLE_SWEEP_PIXEL_BUDGET: usize = 250_000;
/// The same for the refinement, which is a dozen projections rather than a
/// hundred and so can afford every pixel of any ordinary image.
///
/// It has to. Striding the raster samples a sublattice, and how much of a
/// line that sublattice happens to catch depends on the line's angle, so the
/// support curve comes out lumpy at a scale that swamps the quarter-degree
/// the refinement is trying to resolve. On `angry-cat` a stride of 4 makes
/// 45.25° beat the true 45.00° by 257 to 256, and at stride 1 the same curve
/// is smooth and symmetric about 45.00°.
const ANGLE_REFINE_PIXEL_BUDGET: usize = 4_000_000;
/// How many rotated angles the finder searches besides the image's own.
const MAX_ROTATED_ANGLES: usize = 2;
/// A rotated angle is worth the full search when its straight-edge support is
/// at least this much of the best angle's.
const ROTATION_SUPPORT_RATIO: f32 = 0.5;
/// Two angles closer than this are one border found twice: an edge still
/// half-registers a degree or two off its own angle.
const MIN_ANGLE_SEPARATION_DEG: f32 = 6.0;
/// How far a candidate's corner may fall outside the image. A rotated quad
/// built from two projection pairs can land its corner past the image's own,
/// and clipping one deforms it into something that is no longer a square.
const QUAD_OUTSIDE_MARGIN_PX: f32 = 2.0;
/// How much of the image's ink a rotated panel has to hold. A paper holds
/// its pattern; the rotated squares that beat the paper on `at-at` and
/// `carnotaurus-v1` hold 18% and 13% of it, against 0.44 for the weakest
/// rotated paper the corpus actually contains.
const ROTATED_MIN_INK_SHARE: f32 = 0.40;
/// How far along an edge every side of a rotated panel has to run. Two of
/// `calico-cat`'s sides cross blank page at 0.15 while its corners happen to
/// come out square; the weakest true rotated paper reads 0.23.
const ROTATED_MIN_SIDE_SUPPORT: f64 = 0.20;
/// How far outside a quad its own outline's ink still counts as held.
///
/// The Sobel mask answers a line with a band a couple of pixels to each
/// side, so a panel drawn exactly on the paper's edge leaves the outer half
/// of that band outside itself. Measured against an undilated quad the true
/// paper scores *below* a slightly larger box that contains all of it, which
/// is the wrong way round for the one comparison `prefer_rotated` makes.
const QUAD_INK_MARGIN_PX: f32 = 3.0;
/// How much larger a rotated square must be to displace an upright one.
/// Comparing areas across angles is not like-for-like — see `prefer_rotated`.
const CROSS_ANGLE_AREA_MARGIN: f32 = 1.15;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

impl Point {
    fn lerp(self, other: Point, t: f32) -> Point {
        Point {
            x: self.x + (other.x - self.x) * t,
            y: self.y + (other.y - self.y) * t,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Quad {
    pub top_left: Point,
    pub top_right: Point,
    pub bottom_right: Point,
    pub bottom_left: Point,
}

impl Quad {
    pub fn frame(width: u32, height: u32) -> Quad {
        let max_x = width.saturating_sub(1) as f32;
        let max_y = height.saturating_sub(1) as f32;
        Quad {
            top_left: Point { x: 0.0, y: 0.0 },
            top_right: Point { x: max_x, y: 0.0 },
            bottom_right: Point { x: max_x, y: max_y },
            bottom_left: Point { x: 0.0, y: max_y },
        }
    }

    pub fn square(low: f32, high: f32) -> Quad {
        Quad {
            top_left: Point { x: low, y: low },
            top_right: Point { x: high, y: low },
            bottom_right: Point { x: high, y: high },
            bottom_left: Point { x: low, y: high },
        }
    }

    pub fn points(self) -> [Point; 4] {
        [
            self.top_left,
            self.top_right,
            self.bottom_right,
            self.bottom_left,
        ]
    }

    pub fn clipped(self, width: u32, height: u32) -> Quad {
        let max_x = width.saturating_sub(1) as f32;
        let max_y = height.saturating_sub(1) as f32;
        let clip = |point: Point| Point {
            x: point.x.clamp(0.0, max_x),
            y: point.y.clamp(0.0, max_y),
        };
        Quad {
            top_left: clip(self.top_left),
            top_right: clip(self.top_right),
            bottom_right: clip(self.bottom_right),
            bottom_left: clip(self.bottom_left),
        }
    }

    fn side_lengths(self) -> [f32; 4] {
        let p = self.points();
        [
            distance(p[0], p[1]),
            distance(p[1], p[2]),
            distance(p[2], p[3]),
            distance(p[3], p[0]),
        ]
    }

    fn mean_side(self) -> f32 {
        self.side_lengths().iter().sum::<f32>() / 4.0
    }

    fn area(self) -> f32 {
        let p = self.points();
        0.5 * ((0..4)
            .map(|idx| {
                let a = p[idx];
                let b = p[(idx + 1) % 4];
                a.x * b.y - b.x * a.y
            })
            .sum::<f32>())
        .abs()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RectificationWarning {
    pub code: String,
    pub message: String,
    pub severity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RectificationReport {
    pub original_width: u32,
    pub original_height: u32,
    pub image_size: u32,
    pub mode: String,
    pub confidence: f32,
    pub source_quad: Quad,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detected_source_quad: Option<Quad>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_quad: Option<Quad>,
    pub padding_rgb: [u8; 3],
    pub warnings: Vec<RectificationWarning>,
    pub metrics: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RectifiedRgbaImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub report: RectificationReport,
}

#[derive(Debug, thiserror::Error)]
pub enum RectificationError {
    #[error("invalid image dimensions: {width}x{height}")]
    InvalidDimensions { width: u32, height: u32 },
    #[error("rgba length mismatch: expected {expected}, got {actual}")]
    RgbaLengthMismatch { expected: usize, actual: usize },
    #[error("invalid manual quad: {0}")]
    InvalidQuad(&'static str),
    #[error("rectification homography could not be solved")]
    SingularHomography,
}

#[derive(Debug, Clone)]
struct ImageAnalysis {
    rgb: Vec<u8>,
    edges: Vec<bool>,
    width: usize,
    height: usize,
    padding_rgb: [u8; 3],
    edge_density: f32,
}

#[derive(Debug, Clone)]
struct PanelCandidate {
    quad: Quad,
    confidence: f32,
    method: &'static str,
    /// The projection angle this panel was found at. Zero for the ink
    /// bounding box and the full frame, which have no angle of their own.
    angle_deg: f32,
    metrics: Value,
}

impl PanelCandidate {
    fn is_rotated(&self) -> bool {
        self.angle_deg != 0.0
    }
}

pub fn auto_rectify_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    image_size: u32,
) -> Result<RectifiedRgbaImage, RectificationError> {
    let analysis = analyze_rgba(rgba, width, height)?;
    let mut warnings = Vec::new();
    let panel = detect_panel(&analysis);

    let mut result = if let Some(panel) = panel {
        if is_full_frame_panel(width, height, panel.quad) {
            resize_full_frame(&analysis, image_size, panel, warnings)?
        } else if panel.confidence >= MIN_PANEL_CONFIDENCE {
            warp_detected_panel(&analysis, image_size, panel, warnings)?
        } else {
            warnings.push(RectificationWarning {
                code: "low_confidence_crop".to_owned(),
                message: "The crop detector found a possible CP panel, but confidence is low; inspect or adjust the quad before detection.".to_owned(),
                severity: "warning".to_owned(),
                details: Some(panel.metrics.clone()),
            });
            warp_detected_panel(&analysis, image_size, panel, warnings)?
        }
    } else {
        warnings.push(RectificationWarning {
            code: "cp_panel_not_detected".to_owned(),
            message:
                "No reliable square CP panel was detected; using a padded resize for preview only."
                    .to_owned(),
            severity: "warning".to_owned(),
            details: None,
        });
        resize_without_panel(&analysis, image_size, warnings)?
    };

    append_density_warning(
        &mut result.report.warnings,
        result.report.image_size,
        &result.rgba,
    );
    Ok(result)
}

pub fn manual_rectify_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    image_size: u32,
    quad: Quad,
) -> Result<RectifiedRgbaImage, RectificationError> {
    validate_quad(quad, width, height)?;
    let analysis = analyze_rgba(rgba, width, height)?;
    let warnings = Vec::new();
    let clipped = quad.clipped(width, height);
    let result = warp_source_quad(
        &analysis,
        image_size,
        clipped,
        "manual_quad_warp",
        1.0,
        json!({"method": "manual"}),
        warnings,
    )?;
    let mut result = result;
    append_density_warning(
        &mut result.report.warnings,
        result.report.image_size,
        &result.rgba,
    );
    Ok(result)
}

fn analyze_rgba(rgba: &[u8], width: u32, height: u32) -> Result<ImageAnalysis, RectificationError> {
    if width == 0 || height == 0 {
        return Err(RectificationError::InvalidDimensions { width, height });
    }
    let expected = width as usize * height as usize * 4;
    if rgba.len() != expected {
        return Err(RectificationError::RgbaLengthMismatch {
            expected,
            actual: rgba.len(),
        });
    }
    let padding_rgb = infer_padding_rgb(rgba, width as usize, height as usize);
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    let mut luma = Vec::with_capacity(width as usize * height as usize);
    for pixel in rgba.chunks_exact(4) {
        let alpha = pixel[3] as f32 / 255.0;
        let r = composite(pixel[0], padding_rgb[0], alpha);
        let g = composite(pixel[1], padding_rgb[1], alpha);
        let b = composite(pixel[2], padding_rgb[2], alpha);
        rgb.extend_from_slice(&[r, g, b]);
        luma.push(0.299 * r as f32 + 0.587 * g as f32 + 0.114 * b as f32);
    }
    let edges = edge_mask(&luma, width as usize, height as usize);
    let edge_density = edges.iter().filter(|active| **active).count() as f32 / edges.len() as f32;
    Ok(ImageAnalysis {
        rgb,
        edges,
        width: width as usize,
        height: height as usize,
        padding_rgb,
        edge_density,
    })
}

fn composite(foreground: u8, matte: u8, alpha: f32) -> u8 {
    ((foreground as f32 * alpha + matte as f32 * (1.0 - alpha)).round()).clamp(0.0, 255.0) as u8
}

fn edge_mask(luma: &[f32], width: usize, height: usize) -> Vec<bool> {
    let mut gradient = vec![0.0; width * height];
    let mut samples = Vec::new();
    let stride = ((width * height) / 65_536).max(1);
    for y in 1..height.saturating_sub(1) {
        for x in 1..width.saturating_sub(1) {
            let idx = y * width + x;
            let gx = -luma[(y - 1) * width + x - 1] + luma[(y - 1) * width + x + 1]
                - 2.0 * luma[y * width + x - 1]
                + 2.0 * luma[y * width + x + 1]
                - luma[(y + 1) * width + x - 1]
                + luma[(y + 1) * width + x + 1];
            let gy = -luma[(y - 1) * width + x - 1]
                - 2.0 * luma[(y - 1) * width + x]
                - luma[(y - 1) * width + x + 1]
                + luma[(y + 1) * width + x - 1]
                + 2.0 * luma[(y + 1) * width + x]
                + luma[(y + 1) * width + x + 1];
            let value = (gx * gx + gy * gy).sqrt();
            gradient[idx] = value;
            if idx.is_multiple_of(stride) {
                samples.push(value);
            }
        }
    }
    samples.sort_by(|a, b| a.total_cmp(b));
    let p80 = percentile_sorted(&samples, 0.80).unwrap_or(0.0);
    let p92 = percentile_sorted(&samples, 0.92).unwrap_or(0.0);
    let threshold = (p80 * 0.70 + p92 * 0.30).max(36.0);
    gradient
        .into_iter()
        .map(|value| value >= threshold)
        .collect()
}

fn detect_panel(analysis: &ImageAnalysis) -> Option<PanelCandidate> {
    let ranked = ranked_panel_candidates(analysis);
    let chosen = choose_panel(&ranked)?;
    let mut chosen = chosen.clone();
    if let Value::Object(ref mut map) = chosen.metrics {
        map.insert("candidates".to_owned(), candidate_summaries(&ranked));
    }
    Some(chosen)
}

/// Every panel the finder considered, best first.
///
/// A full-frame border, when the image is one, outranks everything: the paper
/// fills the image and there is nothing to crop. Otherwise the projection quads
/// and the ink bounding box compete on confidence.
fn ranked_panel_candidates(analysis: &ImageAnalysis) -> Vec<PanelCandidate> {
    if let Some(candidate) = frame_candidate(analysis) {
        return vec![candidate];
    }
    let mut candidates = projection_candidates(analysis);
    if let Some(candidate) = density_candidate(analysis) {
        candidates.push(candidate);
    }
    candidates.sort_by(|left, right| right.confidence.total_cmp(&left.confidence));
    candidates
}

/// The largest credible bordered square, not the best-scoring one.
///
/// A crease pattern is full of squares: a box-pleated grid, a preliminary
/// base, a blintz all draw one inside the paper, bordered by creases as
/// crisp as the paper's own edge. Scored on border support, squareness and
/// ink density they tie with the paper — the size term saturates at a sixth
/// of the image and a full frame is even marked down — and the tie broke on
/// noise, cropping a turtle to its shell. The paper is the square that holds
/// all the others, so among the bordered squares the finder believes in, the
/// largest is the paper. The ink bounding box is not a bordered square and
/// keeps to the ranking: a caption outside the paper stretches it.
///
/// "Square" has to mean it. A title, a legend, an auxiliary line running off
/// the paper, or the page's own edge gives the finder a box one edge wider
/// than the paper, 3–7% off square, and a gate at `square_score ≥ 0.9` (6%)
/// let it win on area on six of the curated benchmark's real images while
/// the paper itself sat first in the ranking. So the largest bordered box
/// gives way to the largest *genuine* square — square to within a percent —
/// when that square fills most of the box: the paper plus one extension.
/// A square drawn well inside the box is not that, and the box stays (a
/// shell inside a turtle, on a scan a little off square). Two genuine
/// squares of the same size are one paper seen twice, the second shifted
/// onto a title or a crease row; the one with every side on an edge wins.
/// Rotation is decided separately from all of that, because the rule above
/// compares areas and areas are not comparable across angles.
fn choose_panel(ranked: &[PanelCandidate]) -> Option<&PanelCandidate> {
    let upright: Vec<&PanelCandidate> = ranked
        .iter()
        .filter(|candidate| !candidate.is_rotated())
        .collect();
    let rotated: Vec<&PanelCandidate> = ranked
        .iter()
        .filter(|candidate| candidate.is_rotated())
        .collect();
    // The upright reading is what the finder answers with when nothing is
    // rotated, so it keeps the fallback to the best-scoring candidate. A
    // rotated reading that is not a credible bordered square is not a
    // reading at all.
    let upright = largest_square_among(&upright).or_else(|| upright.first().copied());
    let rotated = largest_square_among(&rotated);
    match (upright, rotated) {
        (Some(upright), Some(rotated)) if prefer_rotated(upright, rotated) => Some(rotated),
        (Some(upright), _) => Some(upright),
        (None, rotated) => rotated,
    }
}

/// Whether the rotated reading of the image replaces the upright one.
///
/// When the upright pick is the ink bounding box or a padded frame there is
/// no rival square, only the absence of one, and a credible rotated panel
/// stands on its own — `cat`'s diamond is half the area of the ink box that
/// used to win there, and is the paper.
///
/// When the upright pick *is* a bordered square the two are rival readings
/// of the same paper, and "the largest square wins" stops being
/// like-for-like: the rotated search offers ninety times the squares, so it
/// turns up a larger one on noise alone. Nor can size settle it, because
/// both ways it can go look the same by area — on `armadillo-girdled-lizard`
/// crease fragments at 38.75° form a square 3% larger than the paper, and a
/// paper photographed 8° off square leaves an upright box 3% smaller than
/// itself. What settles it is the same thing that makes a square a paper at
/// all: which of the two holds the pattern. The tilted paper holds all of
/// its own ink and the box across it does not, while the fragments hold less
/// than the upright paper they sit inside — as does the square inscribed in
/// `lotus`'s octagon, which is not a square paper at any angle.
fn prefer_rotated(upright: &PanelCandidate, rotated: &PanelCandidate) -> bool {
    if !is_bordered_square(upright, LOOSE_SQUARE_SCORE) {
        return true;
    }
    ink_share(rotated) > ink_share(upright)
        || rotated.quad.area() >= upright.quad.area() * CROSS_ANGLE_AREA_MARGIN
}

/// The largest credible bordered square among these candidates, by the rule
/// above. `None` when none of them is one.
fn largest_square_among<'a>(candidates: &[&'a PanelCandidate]) -> Option<&'a PanelCandidate> {
    let loose = largest(&bordered_squares(candidates, LOOSE_SQUARE_SCORE));
    let genuine = paper_among(&bordered_squares(candidates, GENUINE_SQUARE_SCORE));
    match (loose, genuine) {
        (Some(bordered), Some(square))
            if square.quad.area() >= bordered.quad.area() * PAPER_OF_BOX_AREA_RATIO =>
        {
            Some(square)
        }
        (Some(bordered), _) => Some(bordered),
        (None, square) => square,
    }
}

/// The largest of the squares, where those within `SAME_SIZE_AREA_RATIO` of
/// the largest are the same square: the best-supported of them, then the
/// most confident.
fn paper_among<'a>(squares: &[&'a PanelCandidate]) -> Option<&'a PanelCandidate> {
    let largest_area = squares
        .iter()
        .map(|candidate| candidate.quad.area())
        .fold(0.0_f32, f32::max);
    squares
        .iter()
        .filter(|candidate| candidate.quad.area() >= largest_area * SAME_SIZE_AREA_RATIO)
        .max_by(|left, right| {
            min_side_support(left)
                .total_cmp(&min_side_support(right))
                .then(left.confidence.total_cmp(&right.confidence))
                .then(left.quad.area().total_cmp(&right.quad.area()))
        })
        .copied()
}

fn square_score(candidate: &PanelCandidate) -> f64 {
    candidate
        .metrics
        .get("square_score")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

/// A candidate's least-supported side, from the metrics `score_quad` wrote.
fn min_side_support(candidate: &PanelCandidate) -> f64 {
    candidate
        .metrics
        .get("border_sides")
        .and_then(Value::as_array)
        .map(|sides| {
            sides
                .iter()
                .filter_map(Value::as_f64)
                .fold(f64::INFINITY, f64::min)
        })
        .filter(|value| value.is_finite())
        .unwrap_or(0.0)
}

/// The credible projection candidates at least `square_floor` square.
fn bordered_squares<'a>(
    ranked: &[&'a PanelCandidate],
    square_floor: f64,
) -> Vec<&'a PanelCandidate> {
    ranked
        .iter()
        .copied()
        .filter(|candidate| is_bordered_square(candidate, square_floor))
        .collect()
}

fn is_bordered_square(candidate: &PanelCandidate, square_floor: f64) -> bool {
    candidate.method == "border_projection"
        && candidate.confidence >= MIN_PANEL_CONFIDENCE
        && square_score(candidate) >= square_floor
}

/// The largest candidate, the more confident of two the same size.
fn largest<'a>(candidates: &[&'a PanelCandidate]) -> Option<&'a PanelCandidate> {
    candidates
        .iter()
        .max_by(|left, right| {
            left.quad
                .area()
                .total_cmp(&right.quad.area())
                .then(left.confidence.total_cmp(&right.confidence))
        })
        .copied()
}

/// The ranked candidates as the report carries them: enough to see what
/// competed and why it lost, without the per-candidate metric blobs.
fn candidate_summaries(ranked: &[PanelCandidate]) -> Value {
    Value::Array(
        ranked
            .iter()
            .take(8)
            .map(|candidate| {
                let points = candidate.quad.points();
                let xs = points.map(|point| point.x);
                let ys = points.map(|point| point.y);
                json!({
                    "method": candidate.method,
                    "confidence": candidate.confidence,
                    "box": [
                        xs.iter().copied().fold(f32::INFINITY, f32::min),
                        ys.iter().copied().fold(f32::INFINITY, f32::min),
                        xs.iter().copied().fold(f32::NEG_INFINITY, f32::max),
                        ys.iter().copied().fold(f32::NEG_INFINITY, f32::max),
                    ],
                    "area_ratio": candidate.metrics.get("area_ratio").cloned().unwrap_or(Value::Null),
                    "border_score": candidate.metrics.get("border_score").cloned().unwrap_or(Value::Null),
                    "border_sides": candidate.metrics.get("border_sides").cloned().unwrap_or(Value::Null),
                    "square_score": candidate.metrics.get("square_score").cloned().unwrap_or(Value::Null),
                    "edge_density": candidate.metrics.get("edge_density").cloned().unwrap_or(Value::Null),
                    "ink_share": candidate.metrics.get("ink_share").cloned().unwrap_or(Value::Null),
                    "angle_deg": candidate.metrics.get("angle_deg").cloned().unwrap_or(json!(0.0)),
                    "corners": points.map(|point| [point.x, point.y]),
                })
            })
            .collect(),
    )
}

fn frame_candidate(analysis: &ImageAnalysis) -> Option<PanelCandidate> {
    if analysis.width.abs_diff(analysis.height) > (analysis.width.max(analysis.height) / 50).max(2)
    {
        return None;
    }
    let quad = Quad::frame(analysis.width as u32, analysis.height as u32);
    let border_sides = border_support_sides(analysis, quad);
    let border_score = border_sides.iter().sum::<f32>() / 4.0;
    let weakest_side = border_sides.iter().copied().fold(f32::INFINITY, f32::min);
    let interior_density = quad_interior(analysis, quad).density;
    if border_score < 0.24 || weakest_side < FRAME_MIN_SIDE_SUPPORT || interior_density < 0.002 {
        return None;
    }
    Some(PanelCandidate {
        quad,
        confidence: 1.0,
        method: "full_frame_border",
        angle_deg: 0.0,
        metrics: json!({
            "method": "full_frame_border",
            "border_score": border_score,
            "border_sides": border_sides,
            "edge_density": interior_density,
        }),
    })
}

/// The panels found at the image's own angle and at any rotation the image
/// gives evidence for.
///
/// A crease pattern is often drawn as a diamond, and a photographed one is
/// never quite square. Both are the same problem: the paper's edges project
/// onto nothing in a per-column and per-row histogram, so the finder used to
/// see only whichever interior creases happened to be axis-aligned — on
/// `blackbuck-simplified`, a 75x112 box in the middle of the pattern.
fn projection_candidates(analysis: &ImageAnalysis) -> Vec<PanelCandidate> {
    candidate_angles(analysis)
        .into_iter()
        .flat_map(|angle| projection_candidates_at(analysis, angle))
        .collect()
}

/// Whether a rotated panel looks enough like a paper to be offered at all.
///
/// Rotation multiplies the squares on offer — a crease pattern is full of
/// them at 45°, and the finder's own preference for the largest square then
/// has ninety times as many ways to be wrong. So a rotated panel has to look
/// like a paper rather than merely like a square: it must hold the pattern,
/// and every one of its sides must run along a line.
fn rotated_panel_is_credible(candidate: &PanelCandidate) -> bool {
    ink_share(candidate) >= ROTATED_MIN_INK_SHARE
        && min_side_support(candidate) >= ROTATED_MIN_SIDE_SUPPORT
}

/// How much of the image's ink a candidate holds, from the metrics
/// `score_quad` wrote.
fn ink_share(candidate: &PanelCandidate) -> f32 {
    candidate
        .metrics
        .get("ink_share")
        .and_then(Value::as_f64)
        .unwrap_or(0.0) as f32
}

fn projection_candidates_at(analysis: &ImageAnalysis, angle_deg: f32) -> Vec<PanelCandidate> {
    let (u_axis, v_axis) = ProjectionAxis::pair(angle_deg, analysis.width, analysis.height);
    let lines = if angle_deg == 0.0 {
        Lines::PerRun
    } else {
        Lines::PerPeak
    };
    let u_clusters = axis_clusters(analysis, u_axis, 1, lines);
    let v_clusters = axis_clusters(analysis, v_axis, 1, lines);
    let min_span = analysis.width.min(analysis.height) as f32 * MIN_PANEL_SPAN_RATIO;
    let mut candidates = Vec::new();
    for (left_idx, left) in u_clusters.iter().enumerate() {
        for right in u_clusters.iter().skip(left_idx + 1) {
            let u0 = u_axis.coord(left.center.min(right.center));
            let u1 = u_axis.coord(left.center.max(right.center));
            if u1 - u0 < min_span {
                continue;
            }
            for (top_idx, top) in v_clusters.iter().enumerate() {
                for bottom in v_clusters.iter().skip(top_idx + 1) {
                    let v0 = v_axis.coord(top.center.min(bottom.center));
                    let v1 = v_axis.coord(top.center.max(bottom.center));
                    if v1 - v0 < min_span {
                        continue;
                    }
                    // Named from the `u`/`v` corners, which for the swept
                    // range of angles run clockwise from the panel's most
                    // top-left corner exactly as `Quad::frame` does — so the
                    // warp that follows is a rotation and never a mirror.
                    let quad = Quad {
                        top_left: u_axis.point(v_axis, u0, v0),
                        top_right: u_axis.point(v_axis, u1, v0),
                        bottom_right: u_axis.point(v_axis, u1, v1),
                        bottom_left: u_axis.point(v_axis, u0, v1),
                    };
                    if !quad_inside_image(quad, analysis.width, analysis.height) {
                        continue;
                    }
                    let (confidence, mut metrics) = score_quad(analysis, quad, "border_projection");
                    if confidence < 0.42 {
                        continue;
                    }
                    if let Value::Object(ref mut map) = metrics {
                        map.insert("angle_deg".to_owned(), json!(angle_deg));
                    }
                    let candidate = PanelCandidate {
                        quad,
                        confidence,
                        method: "border_projection",
                        angle_deg,
                        metrics,
                    };
                    if candidate.is_rotated() && !rotated_panel_is_credible(&candidate) {
                        continue;
                    }
                    candidates.push(candidate);
                }
            }
        }
    }
    candidates
}

/// Every corner inside the image, give or take `QUAD_OUTSIDE_MARGIN_PX`.
///
/// Two projection pairs always meet inside the image's *projections*, which
/// for a rotated axis is not the same as inside the image: a corner can land
/// out past one of the image's own.
fn quad_inside_image(quad: Quad, width: usize, height: usize) -> bool {
    let max_x = width.saturating_sub(1) as f32 + QUAD_OUTSIDE_MARGIN_PX;
    let max_y = height.saturating_sub(1) as f32 + QUAD_OUTSIDE_MARGIN_PX;
    quad.points().iter().all(|point| {
        point.x >= -QUAD_OUTSIDE_MARGIN_PX
            && point.y >= -QUAD_OUTSIDE_MARGIN_PX
            && point.x <= max_x
            && point.y <= max_y
    })
}

/// The angles the full panel search runs at: the image's own, always, plus
/// the rotations its edges give evidence for.
///
/// The image's own angle is never dropped — an axis-aligned reading is the
/// prior, and every panel the finder used to propose is still proposed.
fn candidate_angles(analysis: &ImageAnalysis) -> Vec<f32> {
    let stride = budget_stride(analysis, ANGLE_SWEEP_PIXEL_BUDGET);
    let support: Vec<f32> = (0..ANGLE_SWEEP_STEPS)
        .map(|step| angle_support(analysis, sweep_angle(step), stride))
        .collect();
    let best = support.iter().copied().fold(0.0_f32, f32::max);
    if best <= 0.0 {
        return vec![0.0];
    }
    // The sweep is circular: a square at -45° is the same square at +45°.
    let mut peaks: Vec<(f32, f32)> = (0..ANGLE_SWEEP_STEPS)
        .filter(|step| {
            let previous = support[(step + ANGLE_SWEEP_STEPS - 1) % ANGLE_SWEEP_STEPS];
            let next = support[(step + 1) % ANGLE_SWEEP_STEPS];
            support[*step] >= previous && support[*step] >= next
        })
        .map(|step| (sweep_angle(step), support[step]))
        .collect();
    peaks.sort_by(|left, right| right.1.total_cmp(&left.1));

    let mut angles = vec![0.0_f32];
    for (angle, peak) in peaks {
        // `angles` already holds the image's own, so this counts rotations.
        if angles.len() > MAX_ROTATED_ANGLES {
            break;
        }
        if peak < best * ROTATION_SUPPORT_RATIO {
            break;
        }
        if angles
            .iter()
            .any(|chosen| angle_separation(*chosen, angle) < MIN_ANGLE_SEPARATION_DEG)
        {
            continue;
        }
        angles.push(refine_angle(analysis, angle));
    }
    angles
}

/// The `step`th angle of the sweep, over the 90° a square is symmetric under.
fn sweep_angle(step: usize) -> f32 {
    -45.0 + (step + 1) as f32 * (90.0 / ANGLE_SWEEP_STEPS as f32)
}

/// How far apart two angles are, given that a square repeats every 90°.
fn angle_separation(left: f32, right: f32) -> f32 {
    let delta = (left - right).rem_euclid(90.0);
    delta.min(90.0 - delta)
}

/// The coarse peak to a quarter of a degree, over every pixel.
///
/// The angle has to be this good twice over. A degree of error walks the
/// sampled border 8 px off a 500 px side and `border_support_sides` looks
/// only 2 px around each sample, so the panel would score as though it had
/// no border. And well before that, a quarter of a degree is enough to smear
/// the paper's own edge across enough buckets that `top_clusters` drops it
/// for a crease — on `angry-cat` at 45.25° the two upper edges of the paper
/// are simply not among the peaks, and the crop lands 14–20 px inside them.
fn refine_angle(analysis: &ImageAnalysis, angle_deg: f32) -> f32 {
    let stride = budget_stride(analysis, ANGLE_REFINE_PIXEL_BUDGET);
    let coarse_step = 90.0 / ANGLE_SWEEP_STEPS as f32;
    (-4..=4)
        .map(|offset| angle_deg + offset as f32 * coarse_step * 0.25)
        .map(|angle| (angle, angle_support(analysis, angle, stride)))
        .max_by(|left, right| left.1.total_cmp(&right.1))
        .map(|(angle, _)| angle)
        .unwrap_or(angle_deg)
}

/// How strongly a pair of straight opposite borders shows at this angle.
///
/// An edge of length L lands its whole length in one projection bucket at its
/// own angle and smears over `L·sin δ` of them δ away, so a peak's height
/// falls off sharply within a degree — which is what makes a projection
/// sweep able to find the paper's angle at all. A panel needs two such peaks
/// on each axis, so score the angle by its weakest of the four.
fn angle_support(analysis: &ImageAnalysis, angle_deg: f32, stride: usize) -> f32 {
    let (u_axis, v_axis) = ProjectionAxis::pair(angle_deg, analysis.width, analysis.height);
    let min_span = analysis.width.min(analysis.height) as f32 * MIN_PANEL_SPAN_RATIO;
    [u_axis, v_axis]
        .into_iter()
        .map(|axis| {
            opposite_pair_support(
                &axis_clusters(analysis, axis, stride, Lines::PerPeak),
                min_span,
            )
        })
        .fold(f32::INFINITY, f32::min)
}

/// The strength of the best pair of peaks at least `min_span` apart, where a
/// pair is worth only its weaker half: a panel has two sides, not one.
fn opposite_pair_support(clusters: &[Cluster], min_span: f32) -> f32 {
    let mut best = 0.0_f32;
    for (idx, left) in clusters.iter().enumerate() {
        for right in clusters.iter().skip(idx + 1) {
            if right.center.abs_diff(left.center) as f32 >= min_span {
                best = best.max(left.score.min(right.score));
            }
        }
    }
    best
}

/// One pixel in every `stride`, chosen so a projection costs about `budget`
/// however big the image is.
///
/// The stride walks the raster, so it must not share a factor with the row
/// length: a stride of 2 on an even-width image sees only even columns, and
/// a border one column over disappears entirely.
fn budget_stride(analysis: &ImageAnalysis, budget: usize) -> usize {
    let pixels = analysis.width * analysis.height;
    let mut stride = pixels.div_ceil(budget).max(1);
    while stride > 1 && gcd(stride, analysis.width) > 1 {
        stride += 1;
    }
    stride
}

fn gcd(left: usize, right: usize) -> usize {
    if right == 0 {
        left
    } else {
        gcd(right, left % right)
    }
}

#[derive(Debug, Clone)]
struct Cluster {
    center: usize,
    score: f32,
}

/// The direction edge pixels are projected onto, with the offset that puts
/// the whole image at a non-negative bucket.
///
/// At 0° the `u` axis is the image's x and its buckets are its columns, so a
/// projection along it is exactly the per-column edge count the finder always
/// used; every other angle is the same measurement taken diagonally.
#[derive(Debug, Clone, Copy)]
struct ProjectionAxis {
    cos: f32,
    sin: f32,
    offset: f32,
    len: usize,
}

impl ProjectionAxis {
    /// The axis at `angle_deg` from the image's x axis, and its perpendicular.
    fn pair(angle_deg: f32, width: usize, height: usize) -> (ProjectionAxis, ProjectionAxis) {
        let (sin, cos) = angle_deg.to_radians().sin_cos();
        (
            ProjectionAxis::new(cos, sin, width, height),
            ProjectionAxis::new(-sin, cos, width, height),
        )
    }

    fn new(cos: f32, sin: f32, width: usize, height: usize) -> ProjectionAxis {
        let max_x = width.saturating_sub(1) as f32;
        let max_y = height.saturating_sub(1) as f32;
        let projections = [(0.0, 0.0), (max_x, 0.0), (max_x, max_y), (0.0, max_y)]
            .map(|(x, y): (f32, f32)| x * cos + y * sin);
        let low = projections.iter().copied().fold(f32::INFINITY, f32::min);
        let high = projections
            .iter()
            .copied()
            .fold(f32::NEG_INFINITY, f32::max);
        ProjectionAxis {
            cos,
            sin,
            offset: -low,
            len: (high - low).round() as usize + 1,
        }
    }

    fn bucket(&self, x: f32, y: f32) -> usize {
        ((x * self.cos + y * self.sin + self.offset).round().max(0.0) as usize).min(self.len - 1)
    }

    /// The coordinate along this axis that a bucket stands for.
    fn coord(&self, bucket: usize) -> f32 {
        bucket as f32 - self.offset
    }

    /// The image point at `u` along this axis and `v` along its perpendicular.
    fn point(&self, perpendicular: ProjectionAxis, u: f32, v: f32) -> Point {
        Point {
            x: u * self.cos + v * perpendicular.cos,
            y: u * self.sin + v * perpendicular.sin,
        }
    }

    /// The average length of a line at this axis's angle through the image —
    /// what a peak's height is worth measuring against. For one of the
    /// image's own axes it is exactly the cross dimension.
    fn mean_chord(&self, width: usize, height: usize) -> f32 {
        (width as f64 * height as f64 / self.len.max(1) as f64) as f32
    }
}

/// The smoothed peaks of the edge pixels projected onto an axis.
fn axis_clusters(
    analysis: &ImageAnalysis,
    axis: ProjectionAxis,
    stride: usize,
    lines: Lines,
) -> Vec<Cluster> {
    let scores = smooth_scores(&project_edges(analysis, axis, stride));
    top_clusters(
        &scores,
        axis.mean_chord(analysis.width, analysis.height),
        lines,
    )
}

/// The edge pixels' histogram along an axis, one pixel in every `stride`
/// weighted back up to a full count so the peaks read the same either way.
fn project_edges(analysis: &ImageAnalysis, axis: ProjectionAxis, stride: usize) -> Vec<f32> {
    let mut scores = vec![0.0; axis.len];
    let weight = stride as f32;
    for idx in (0..analysis.edges.len()).step_by(stride) {
        if !analysis.edges[idx] {
            continue;
        }
        let x = (idx % analysis.width) as f32;
        let y = (idx / analysis.width) as f32;
        scores[axis.bucket(x, y)] += weight;
    }
    scores
}

/// How far a single line's ink spreads along the projection once smoothed:
/// two peaks nearer than this are one line, not two.
fn smoothing_radius(len: usize) -> usize {
    (len / 300).clamp(1, 5)
}

fn smooth_scores(scores: &[f32]) -> Vec<f32> {
    let radius = smoothing_radius(scores.len());
    let mut out = vec![0.0; scores.len()];
    for (idx, value) in out.iter_mut().enumerate() {
        let start = idx.saturating_sub(radius);
        let end = (idx + radius + 1).min(scores.len());
        *value = scores[start..end].iter().sum::<f32>() / (end - start) as f32;
    }
    out
}

/// How many lines the finder reads out of one run of buckets above the
/// threshold.
///
/// A run is not always one line. Where a paper's edge runs alongside a band
/// of creases parallel to it — which at 45° is most of a crease pattern —
/// the two stay above the threshold together, and `PerRun` reports the whole
/// band as a single line at its weighted centre: on `hawk` a run 132 buckets
/// wide, holding the paper's lower-right edge at its far end, comes back 55
/// px inside the paper and the crop is short by that much. `PerPeak` reads
/// one line per local maximum instead.
///
/// `PerPeak` is the better line finder on any axis, and the upright search
/// has the same defect — `samurai-v4`'s and `falcon-2-0`'s papers are inset
/// today for exactly this reason. But it also multiplies the lines an axis
/// offers, from 12 to 53–61 on those two, and `MAX_AXIS_CLUSTERS` then keeps
/// the tallest rather than the outermost, which moves 22 of the corpus's
/// upright crops. Rotation needs the fix now and the upright path needs its
/// own review to take it, so the two are separated here rather than
/// entangled. See `implementation-plans/cp-detect-rotated-paper-crop.md`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Lines {
    PerRun,
    PerPeak,
}

fn top_clusters(scores: &[f32], cross_len: f32, lines: Lines) -> Vec<Cluster> {
    if scores.is_empty() {
        return Vec::new();
    }
    let max_score = scores
        .iter()
        .copied()
        .fold(0.0_f32, |best, value| best.max(value));
    let threshold = (max_score * 0.45).max(cross_len * 0.08).max(8.0);
    let separation = match lines {
        Lines::PerRun => usize::MAX,
        Lines::PerPeak => 2 * smoothing_radius(scores.len()) + 1,
    };
    let mut clusters = Vec::new();
    let mut idx = 0;
    while idx < scores.len() {
        if scores[idx] < threshold {
            idx += 1;
            continue;
        }
        let start = idx;
        while idx < scores.len() && scores[idx] >= threshold {
            idx += 1;
        }
        clusters.extend(split_run(&scores[start..idx], start, separation));
    }
    clusters.sort_by(|left, right| right.score.total_cmp(&left.score));
    clusters.truncate(MAX_AXIS_CLUSTERS);
    clusters.sort_by_key(|cluster| cluster.center);
    clusters
}

/// One cluster per line in a run of buckets above the threshold.
///
/// A run is not always one line. Where a paper's edge runs alongside a band
/// of creases parallel to it — which at 45° is most of a crease pattern —
/// the two stay above the threshold together, and collapsing the run to a
/// single weighted centroid puts the line in the middle of the band. On
/// `hawk` that is a run 132 buckets wide holding the paper's lower-right
/// edge at its far end, reported 55 px inside the paper, and the crop is
/// short by that much.
///
/// A run with one maximum still gives exactly one cluster at exactly the
/// centroid it always did, so this only ever splits a run that held more
/// than one line to begin with.
fn split_run(run: &[f32], offset: usize, separation: usize) -> Vec<Cluster> {
    let peaks = run_peaks(run, separation);
    let bounds: Vec<usize> = std::iter::once(0)
        .chain(
            peaks
                .windows(2)
                // The run parts at the low point between two lines.
                .map(|pair| {
                    (pair[0]..=pair[1])
                        .min_by(|left, right| run[*left].total_cmp(&run[*right]))
                        .unwrap_or(pair[0])
                }),
        )
        .chain(std::iter::once(run.len()))
        .collect();
    bounds
        .windows(2)
        .map(|pair| {
            let segment = &run[pair[0]..pair[1]];
            let total: f32 = segment.iter().sum();
            let weighted: f32 = segment
                .iter()
                .enumerate()
                .map(|(idx, score)| (offset + pair[0] + idx) as f32 * score)
                .sum();
            Cluster {
                center: if total > 0.0 {
                    (weighted / total).round() as usize
                } else {
                    offset + (pair[0] + pair[1]) / 2
                },
                score: segment.iter().copied().fold(0.0_f32, f32::max),
            }
        })
        .collect()
}

/// The local maxima of a run, keeping the stronger of any two closer than
/// `separation` — which is one line's own width, so two peaks that close are
/// one line read twice.
fn run_peaks(run: &[f32], separation: usize) -> Vec<usize> {
    let mut peaks: Vec<usize> = (0..run.len())
        .filter(|idx| {
            let rising = *idx == 0 || run[*idx] > run[idx - 1];
            let falling = *idx + 1 == run.len() || run[*idx] >= run[idx + 1];
            rising && falling
        })
        .collect();
    peaks.sort_by(|left, right| run[*right].total_cmp(&run[*left]));
    let mut kept: Vec<usize> = Vec::new();
    for peak in peaks {
        if kept.iter().all(|other| peak.abs_diff(*other) >= separation) {
            kept.push(peak);
        }
    }
    kept.sort_unstable();
    kept
}

fn density_candidate(analysis: &ImageAnalysis) -> Option<PanelCandidate> {
    let mut min_x = analysis.width;
    let mut min_y = analysis.height;
    let mut max_x = 0usize;
    let mut max_y = 0usize;
    let mut count = 0usize;
    for y in 0..analysis.height {
        for x in 0..analysis.width {
            if analysis.edges[y * analysis.width + x] {
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
                count += 1;
            }
        }
    }
    if count < (analysis.width * analysis.height / 400).max(64) || min_x >= max_x || min_y >= max_y
    {
        return None;
    }
    let pad = ((max_x - min_x).min(max_y - min_y) as f32 * 0.02).round() as usize + 2;
    min_x = min_x.saturating_sub(pad);
    min_y = min_y.saturating_sub(pad);
    max_x = (max_x + pad).min(analysis.width - 1);
    max_y = (max_y + pad).min(analysis.height - 1);
    let quad = Quad {
        top_left: Point {
            x: min_x as f32,
            y: min_y as f32,
        },
        top_right: Point {
            x: max_x as f32,
            y: min_y as f32,
        },
        bottom_right: Point {
            x: max_x as f32,
            y: max_y as f32,
        },
        bottom_left: Point {
            x: min_x as f32,
            y: max_y as f32,
        },
    };
    let (base_confidence, mut metrics) = score_quad(analysis, quad, "density_bbox");
    let square_score = metrics
        .get("square_score")
        .and_then(Value::as_f64)
        .unwrap_or(0.0) as f32;
    if square_score < 0.62 {
        return None;
    }
    if let Value::Object(ref mut map) = metrics {
        map.insert("edge_pixel_count".to_owned(), json!(count));
    }
    Some(PanelCandidate {
        quad,
        confidence: (base_confidence + 0.08).min(0.86),
        method: "density_bbox",
        angle_deg: 0.0,
        metrics,
    })
}

fn score_quad(analysis: &ImageAnalysis, quad: Quad, method: &'static str) -> (f32, Value) {
    let area_ratio = quad.area() / (analysis.width * analysis.height).max(1) as f32;
    let sides = quad.side_lengths();
    let mean_width = ((sides[0] + sides[2]) * 0.5).max(1e-6);
    let mean_height = ((sides[1] + sides[3]) * 0.5).max(1e-6);
    let aspect = mean_width / mean_height;
    let square_score = clamp01(1.0 - aspect.max(1e-6).ln().abs() / 1.8_f32.ln());
    let size_score = if area_ratio >= 0.96 {
        clamp01(area_ratio / 0.16) * 0.85
    } else {
        clamp01(area_ratio / 0.16)
    };
    let border_sides = border_support_sides(analysis, quad);
    let border_support = border_sides.iter().sum::<f32>() / 4.0;
    let interior = quad_interior(analysis, quad);
    let interior_density = interior.density;
    let density_score = clamp01(interior_density / 0.045);
    let confidence = clamp01(
        0.38 * border_support
            + 0.30 * square_score
            + 0.14 * density_score
            + 0.10 * size_score
            + 0.08 * coverage_score(analysis, quad),
    );
    (
        confidence,
        json!({
            "method": method,
            "area_ratio": area_ratio,
            "aspect": aspect,
            "square_score": square_score,
            "size_score": size_score,
            "border_score": border_support,
            "border_sides": border_sides,
            "edge_density": interior_density,
            "density_score": density_score,
            "ink_share": interior.ink_share,
            "coverage_score": coverage_score(analysis, quad),
        }),
    )
}

/// The share of each side (top, right, bottom, left) that runs along an
/// edge in the image.
fn border_support_sides(analysis: &ImageAnalysis, quad: Quad) -> [f32; 4] {
    let p = quad.points();
    let samples = quad.mean_side().round().clamp(24.0, 512.0) as usize;
    let mut sides = [0.0; 4];
    for (side, support) in sides.iter_mut().enumerate() {
        let a = p[side];
        let b = p[(side + 1) % 4];
        let mut active = 0usize;
        for step in 0..=samples {
            let t = step as f32 / samples as f32;
            let point = a.lerp(b, t);
            if local_edge(
                analysis,
                point.x.round() as isize,
                point.y.round() as isize,
                2,
            ) {
                active += 1;
            }
        }
        *support = active as f32 / (samples + 1) as f32;
    }
    sides
}

/// What a quad holds: how dense its interior is, and how much of the image's
/// ink is inside it at all.
#[derive(Debug, Clone, Copy)]
struct QuadInterior {
    /// The share of the quad's interior that sits on an edge, inset from its
    /// own border so the panel's edge does not count as its content.
    density: f32,
    /// The share of the image's edge pixels that fall inside the quad.
    ink_share: f32,
}

/// What the quad holds, measured inside the quad rather than inside its
/// bounding box — which for an axis-aligned quad is the same rectangle and
/// for a rotated one is not: half of a diamond's bounding box is outside the
/// paper, and on `blackbuck-simplified` that half holds the folded model
/// drawn beside the crease pattern.
fn quad_interior(analysis: &ImageAnalysis, quad: Quad) -> QuadInterior {
    let sides = quad.side_lengths();
    let span_u = ((sides[0] + sides[2]) * 0.5).max(1e-6);
    let span_v = ((sides[1] + sides[3]) * 0.5).max(1e-6);
    let pad = (span_u.min(span_v) * 0.08).round();
    let inner = inset_quad(quad, pad / span_u, pad / span_v);
    let (active, total) = quad_edge_counts(analysis, inner);
    let held = quad_edge_counts(
        analysis,
        inset_quad(
            quad,
            -QUAD_INK_MARGIN_PX / span_u,
            -QUAD_INK_MARGIN_PX / span_v,
        ),
    )
    .0;
    let ink = analysis.edge_density * (analysis.width * analysis.height) as f32;
    QuadInterior {
        density: active as f32 / total.max(1) as f32,
        ink_share: if ink > 0.0 {
            (held as f32 / ink).min(1.0)
        } else {
            0.0
        },
    }
}

/// The edge pixels inside a convex quad, and how many pixels it covers.
fn quad_edge_counts(analysis: &ImageAnalysis, quad: Quad) -> (usize, usize) {
    let ys = quad.points().map(|point| point.y);
    let min_y = ys
        .iter()
        .copied()
        .fold(f32::INFINITY, f32::min)
        .floor()
        .max(0.0) as usize;
    let max_y = ys
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max)
        .ceil()
        .min((analysis.height - 1) as f32) as usize;
    let mut active = 0usize;
    let mut total = 0usize;
    for y in min_y..max_y {
        let Some((start, end)) = quad_row_span(quad, y as f32, analysis.width) else {
            continue;
        };
        let row = &analysis.edges[y * analysis.width + start..y * analysis.width + end];
        active += row.iter().filter(|edge| **edge).count();
        total += row.len();
    }
    (active, total)
}

/// Where a row crosses a convex quad, as a half-open range of columns inside
/// the image.
///
/// This is what keeps the density scan a straight walk of the edge mask: the
/// quad decides the row's bounds once, not each pixel in it.
fn quad_row_span(quad: Quad, y: f32, width: usize) -> Option<(usize, usize)> {
    let points = quad.points();
    let mut low = f32::INFINITY;
    let mut high = f32::NEG_INFINITY;
    for idx in 0..4 {
        let a = points[idx];
        let b = points[(idx + 1) % 4];
        if (a.y - b.y).abs() < 1e-6 {
            // A horizontal side lies in the row or misses it entirely; the
            // two sides meeting it give the same bounds either way.
            continue;
        }
        let t = (y - a.y) / (b.y - a.y);
        if !(0.0..=1.0).contains(&t) {
            continue;
        }
        let x = a.x + (b.x - a.x) * t;
        low = low.min(x);
        high = high.max(x);
    }
    let start = low.ceil().max(0.0) as usize;
    let end = (high.floor().min(width.saturating_sub(1) as f32) as usize).saturating_add(1);
    (low.is_finite() && start < end).then_some((start, end.min(width)))
}

/// The quad pulled in from each of its own sides by a fraction of that side,
/// or pushed out by one when the ratio is negative.
fn inset_quad(quad: Quad, u_ratio: f32, v_ratio: f32) -> Quad {
    let (u0, u1) = (u_ratio.clamp(-0.25, 0.49), 1.0 - u_ratio.clamp(-0.25, 0.49));
    let (v0, v1) = (v_ratio.clamp(-0.25, 0.49), 1.0 - v_ratio.clamp(-0.25, 0.49));
    Quad {
        top_left: quad_point(quad, u0, v0),
        top_right: quad_point(quad, u1, v0),
        bottom_right: quad_point(quad, u1, v1),
        bottom_left: quad_point(quad, u0, v1),
    }
}

/// The point at `(u, v)` of the quad's own unit square.
fn quad_point(quad: Quad, u: f32, v: f32) -> Point {
    quad.top_left
        .lerp(quad.top_right, u)
        .lerp(quad.bottom_left.lerp(quad.bottom_right, u), v)
}

fn coverage_score(analysis: &ImageAnalysis, quad: Quad) -> f32 {
    let cells = 8usize;
    let mut occupied = 0usize;
    for cy in 0..cells {
        for cx in 0..cells {
            let u0 = cx as f32 / cells as f32;
            let u1 = (cx + 1) as f32 / cells as f32;
            let v0 = cy as f32 / cells as f32;
            let v1 = (cy + 1) as f32 / cells as f32;
            let mut hits = 0usize;
            for sy in 0..4 {
                for sx in 0..4 {
                    let u = u0 + (u1 - u0) * (sx as f32 + 0.5) / 4.0;
                    let v = v0 + (v1 - v0) * (sy as f32 + 0.5) / 4.0;
                    let point = quad_point(quad, u, v);
                    if local_edge(
                        analysis,
                        point.x.round() as isize,
                        point.y.round() as isize,
                        1,
                    ) {
                        hits += 1;
                    }
                }
            }
            if hits > 0 {
                occupied += 1;
            }
        }
    }
    occupied as f32 / (cells * cells) as f32
}

fn local_edge(analysis: &ImageAnalysis, x: isize, y: isize, radius: isize) -> bool {
    for yy in y - radius..=y + radius {
        for xx in x - radius..=x + radius {
            if xx < 0 || yy < 0 || xx >= analysis.width as isize || yy >= analysis.height as isize {
                continue;
            }
            if analysis.edges[yy as usize * analysis.width + xx as usize] {
                return true;
            }
        }
    }
    false
}

fn is_full_frame_panel(width: u32, height: u32, quad: Quad) -> bool {
    if width == 0 || height == 0 {
        return false;
    }
    if width.abs_diff(height) > (width.max(height) as f32 * 0.02).round().max(2.0) as u32 {
        return false;
    }
    let area_ratio = quad.area() / ((width - 1).max(1) * (height - 1).max(1)) as f32;
    // A bordered square a few pixels inside the frame is the frame; one 1.5%
    // inside is a paper with a margin, and resizing the frame would hand the
    // decoder that margin as a scale error (u-waluigi001: 23 px on 1566).
    let tolerance = (width.min(height) as f32 * 0.005).max(3.0);
    let points = quad.points();
    let min_x = points
        .iter()
        .map(|point| point.x)
        .fold(f32::INFINITY, f32::min);
    let max_x = points
        .iter()
        .map(|point| point.x)
        .fold(f32::NEG_INFINITY, f32::max);
    let min_y = points
        .iter()
        .map(|point| point.y)
        .fold(f32::INFINITY, f32::min);
    let max_y = points
        .iter()
        .map(|point| point.y)
        .fold(f32::NEG_INFINITY, f32::max);
    area_ratio >= 0.94
        && min_x <= tolerance
        && min_y <= tolerance
        && max_x >= width.saturating_sub(1) as f32 - tolerance
        && max_y >= height.saturating_sub(1) as f32 - tolerance
}

fn resize_full_frame(
    analysis: &ImageAnalysis,
    image_size: u32,
    panel: PanelCandidate,
    warnings: Vec<RectificationWarning>,
) -> Result<RectifiedRgbaImage, RectificationError> {
    let result = resize_without_panel(analysis, image_size, warnings)?;
    Ok(RectifiedRgbaImage {
        report: RectificationReport {
            mode: "full_frame_resize".to_owned(),
            confidence: panel.confidence.max(if analysis.width == analysis.height {
                1.0
            } else {
                0.85
            }),
            detected_source_quad: Some(panel.quad),
            metrics: panel.metrics,
            ..result.report
        },
        ..result
    })
}

fn resize_without_panel(
    analysis: &ImageAnalysis,
    image_size: u32,
    mut warnings: Vec<RectificationWarning>,
) -> Result<RectifiedRgbaImage, RectificationError> {
    if analysis.width != analysis.height {
        warnings.push(RectificationWarning {
            code: "rectified_input_not_square".to_owned(),
            message: "Input is not square; it was resized with letterbox padding.".to_owned(),
            severity: "warning".to_owned(),
            details: Some(json!({"width": analysis.width, "height": analysis.height})),
        });
    }
    let mut rgba = vec![255; image_size as usize * image_size as usize * 4];
    for chunk in rgba.chunks_exact_mut(4) {
        chunk[0] = analysis.padding_rgb[0];
        chunk[1] = analysis.padding_rgb[1];
        chunk[2] = analysis.padding_rgb[2];
        chunk[3] = 255;
    }
    // Fit inside the paper box, not the whole frame — see `paper_target_span`.
    // The source's pixel *centres* span `w - 1`, and they have to land on a box
    // of continuous width `hi - lo`, so the output is one pixel wider than the
    // span: a square source fills 961 pixels, 32..=992, which is the frame the
    // training renders and the decoder both use.
    let (lo, hi) = paper_target_span(image_size);
    let available = hi - lo;
    let source_span_x = analysis.width.saturating_sub(1).max(1) as f32;
    let source_span_y = analysis.height.saturating_sub(1).max(1) as f32;
    let scale = (available / source_span_x).min(available / source_span_y);
    let out_width = ((source_span_x * scale).round() as u32)
        .saturating_add(1)
        .max(1);
    let out_height = ((source_span_y * scale).round() as u32)
        .saturating_add(1)
        .max(1);
    // Centred inside the paper box, which is itself centred in the frame.
    let offset_x = lo.round() as u32 + (available.round() as u32 + 1 - out_width) / 2;
    let offset_y = lo.round() as u32 + (available.round() as u32 + 1 - out_height) / 2;
    for y in 0..out_height {
        for x in 0..out_width {
            let src_x = x as f32 / (out_width.saturating_sub(1).max(1) as f32)
                * (analysis.width.saturating_sub(1) as f32);
            let src_y = y as f32 / (out_height.saturating_sub(1).max(1) as f32)
                * (analysis.height.saturating_sub(1) as f32);
            let rgb = sample_rgb(analysis, src_x, src_y);
            write_rgba(
                &mut rgba,
                image_size as usize,
                offset_x + x,
                offset_y + y,
                rgb,
            );
        }
    }
    let source_quad = Quad::frame(analysis.width as u32, analysis.height as u32);
    Ok(RectifiedRgbaImage {
        width: image_size,
        height: image_size,
        rgba,
        report: RectificationReport {
            original_width: analysis.width as u32,
            original_height: analysis.height as u32,
            image_size,
            mode: if analysis.width == analysis.height {
                "resize".to_owned()
            } else {
                "resize_pad".to_owned()
            },
            confidence: if analysis.width == analysis.height {
                1.0
            } else {
                0.85
            },
            source_quad,
            detected_source_quad: None,
            target_quad: Some(Quad {
                top_left: Point {
                    x: offset_x as f32,
                    y: offset_y as f32,
                },
                top_right: Point {
                    x: (offset_x + out_width.saturating_sub(1)) as f32,
                    y: offset_y as f32,
                },
                bottom_right: Point {
                    x: (offset_x + out_width.saturating_sub(1)) as f32,
                    y: (offset_y + out_height.saturating_sub(1)) as f32,
                },
                bottom_left: Point {
                    x: offset_x as f32,
                    y: (offset_y + out_height.saturating_sub(1)) as f32,
                },
            }),
            padding_rgb: analysis.padding_rgb,
            warnings,
            metrics: json!({"edge_density": analysis.edge_density}),
        },
    })
}

fn warp_detected_panel(
    analysis: &ImageAnalysis,
    image_size: u32,
    panel: PanelCandidate,
    warnings: Vec<RectificationWarning>,
) -> Result<RectifiedRgbaImage, RectificationError> {
    let mode = if panel.method == "density_bbox" {
        "detect_density_crop"
    } else {
        "detect_quad_warp"
    };
    warp_source_quad(
        analysis,
        image_size,
        panel.quad,
        mode,
        panel.confidence,
        panel.metrics,
        warnings,
    )
}

fn warp_source_quad(
    analysis: &ImageAnalysis,
    image_size: u32,
    source_quad: Quad,
    mode: &str,
    confidence: f32,
    metrics: Value,
    warnings: Vec<RectificationWarning>,
) -> Result<RectifiedRgbaImage, RectificationError> {
    let source_quad = source_quad.clipped(analysis.width as u32, analysis.height as u32);
    let (lo, hi) = paper_target_span(image_size);
    let target_quad = Quad::square(lo, hi);
    let homography = homography_from_quad_to_quad(target_quad, source_quad)?;
    let mut rgba = vec![255; image_size as usize * image_size as usize * 4];
    for chunk in rgba.chunks_exact_mut(4) {
        chunk[0] = analysis.padding_rgb[0];
        chunk[1] = analysis.padding_rgb[1];
        chunk[2] = analysis.padding_rgb[2];
        chunk[3] = 255;
    }
    for y in 0..image_size {
        for x in 0..image_size {
            let point = Point {
                x: x as f32,
                y: y as f32,
            };
            if !point_in_convex_quad(point, target_quad) {
                continue;
            }
            let src = apply_homography(&homography, point);
            if src.x < 0.0
                || src.y < 0.0
                || src.x > (analysis.width - 1) as f32
                || src.y > (analysis.height - 1) as f32
            {
                continue;
            }
            let rgb = sample_rgb(analysis, src.x, src.y);
            write_rgba(&mut rgba, image_size as usize, x, y, rgb);
        }
    }
    Ok(RectifiedRgbaImage {
        width: image_size,
        height: image_size,
        rgba,
        report: RectificationReport {
            original_width: analysis.width as u32,
            original_height: analysis.height as u32,
            image_size,
            mode: mode.to_owned(),
            confidence,
            source_quad,
            detected_source_quad: Some(source_quad),
            target_quad: Some(target_quad),
            padding_rgb: analysis.padding_rgb,
            warnings,
            metrics: json!({
                "source_crop_padding_px": 0.0,
                "target_crop_padding_px": 0.0,
                "raw": metrics,
            }),
        },
    })
}

fn validate_quad(quad: Quad, width: u32, height: u32) -> Result<(), RectificationError> {
    if quad.area() < 16.0 {
        return Err(RectificationError::InvalidQuad("area is too small"));
    }
    for point in quad.points() {
        if !point.x.is_finite() || !point.y.is_finite() {
            return Err(RectificationError::InvalidQuad(
                "coordinates must be finite",
            ));
        }
        let margin = 2.0;
        if point.x < -margin
            || point.y < -margin
            || point.x > width.saturating_sub(1) as f32 + margin
            || point.y > height.saturating_sub(1) as f32 + margin
        {
            return Err(RectificationError::InvalidQuad(
                "coordinates are outside the source image",
            ));
        }
    }
    Ok(())
}

fn append_density_warning(warnings: &mut Vec<RectificationWarning>, image_size: u32, rgba: &[u8]) {
    let luma: Vec<f32> = rgba
        .chunks_exact(4)
        .map(|pixel| 0.299 * pixel[0] as f32 + 0.587 * pixel[1] as f32 + 0.114 * pixel[2] as f32)
        .collect();
    let edges = edge_mask(&luma, image_size as usize, image_size as usize);
    let edge_density = edges.iter().filter(|active| **active).count() as f32 / edges.len() as f32;
    let background_luma = sampled_median_f32(&luma).unwrap_or(255.0);
    let ink: Vec<bool> = luma
        .iter()
        .map(|value| (value - background_luma).abs() >= 28.0)
        .collect();
    let ink_density = ink.iter().filter(|active| **active).count() as f32 / ink.len() as f32;
    let vertical_clusters =
        active_axis_cluster_count(&ink, image_size as usize, image_size as usize, true);
    let horizontal_clusters =
        active_axis_cluster_count(&ink, image_size as usize, image_size as usize, false);
    let dense = edge_density >= 0.18
        || ink_density >= 0.20
        || (ink_density >= 0.08 && vertical_clusters + horizontal_clusters >= 20);
    if dense {
        warnings.push(RectificationWarning {
            code: "dense_input_evidence".to_owned(),
            message: "The rectified input contains dense line evidence that may be outside the readable 1024px geometry envelope.".to_owned(),
            severity: "warning".to_owned(),
            details: Some(json!({
                "edge_density": edge_density,
                "ink_density": ink_density,
                "background_luma": background_luma,
                "vertical_cluster_count": vertical_clusters,
                "horizontal_cluster_count": horizontal_clusters,
                "image_size": [image_size, image_size],
            })),
        });
    }
}

fn active_axis_cluster_count(edges: &[bool], width: usize, height: usize, vertical: bool) -> usize {
    let len = if vertical { width } else { height };
    let cross = if vertical { height } else { width };
    let mut scores = vec![0.0; len];
    for (outer, score) in scores.iter_mut().enumerate().take(len) {
        for inner in 0..cross {
            let idx = if vertical {
                inner * width + outer
            } else {
                outer * width + inner
            };
            if edges[idx] {
                *score += 1.0;
            }
        }
    }
    let scores = smooth_scores(&scores);
    let max_score = scores
        .iter()
        .copied()
        .fold(0.0_f32, |best, value| best.max(value));
    let threshold = (max_score * 0.45).max(cross as f32 * 0.03).max(4.0);
    let mut clusters = 0usize;
    let mut idx = 0usize;
    while idx < len {
        if scores[idx] < threshold {
            idx += 1;
            continue;
        }
        clusters += 1;
        while idx < len && scores[idx] >= threshold {
            idx += 1;
        }
    }
    clusters
}

fn sampled_median_f32(values: &[f32]) -> Option<f32> {
    if values.is_empty() {
        return None;
    }
    let stride = (values.len() / 65_536).max(1);
    let mut samples: Vec<f32> = values
        .iter()
        .enumerate()
        .filter_map(|(idx, value)| (idx % stride == 0).then_some(*value))
        .collect();
    samples.sort_by(|a, b| a.total_cmp(b));
    samples.get(samples.len() / 2).copied()
}

fn sample_rgb(analysis: &ImageAnalysis, x: f32, y: f32) -> [u8; 3] {
    let x0 = x.floor().clamp(0.0, (analysis.width - 1) as f32) as usize;
    let y0 = y.floor().clamp(0.0, (analysis.height - 1) as f32) as usize;
    let x1 = (x0 + 1).min(analysis.width - 1);
    let y1 = (y0 + 1).min(analysis.height - 1);
    let tx = x - x0 as f32;
    let ty = y - y0 as f32;
    let p00 = rgb_at(analysis, x0, y0);
    let p10 = rgb_at(analysis, x1, y0);
    let p01 = rgb_at(analysis, x0, y1);
    let p11 = rgb_at(analysis, x1, y1);
    let mut out = [0u8; 3];
    for channel in 0..3 {
        let top = p00[channel] as f32 * (1.0 - tx) + p10[channel] as f32 * tx;
        let bottom = p01[channel] as f32 * (1.0 - tx) + p11[channel] as f32 * tx;
        out[channel] = (top * (1.0 - ty) + bottom * ty).round().clamp(0.0, 255.0) as u8;
    }
    out
}

fn rgb_at(analysis: &ImageAnalysis, x: usize, y: usize) -> [u8; 3] {
    let idx = (y * analysis.width + x) * 3;
    [
        analysis.rgb[idx],
        analysis.rgb[idx + 1],
        analysis.rgb[idx + 2],
    ]
}

fn write_rgba(rgba: &mut [u8], width: usize, x: u32, y: u32, rgb: [u8; 3]) {
    let idx = (y as usize * width + x as usize) * 4;
    rgba[idx] = rgb[0];
    rgba[idx + 1] = rgb[1];
    rgba[idx + 2] = rgb[2];
    rgba[idx + 3] = 255;
}

fn homography_from_quad_to_quad(source: Quad, dest: Quad) -> Result<[f32; 9], RectificationError> {
    let src = source.points();
    let dst = dest.points();
    let mut a = [[0.0_f64; 9]; 8];
    for i in 0..4 {
        let x = src[i].x as f64;
        let y = src[i].y as f64;
        let u = dst[i].x as f64;
        let v = dst[i].y as f64;
        a[2 * i] = [x, y, 1.0, 0.0, 0.0, 0.0, -u * x, -u * y, u];
        a[2 * i + 1] = [0.0, 0.0, 0.0, x, y, 1.0, -v * x, -v * y, v];
    }
    let solved = solve_8x8(a).ok_or(RectificationError::SingularHomography)?;
    Ok([
        solved[0] as f32,
        solved[1] as f32,
        solved[2] as f32,
        solved[3] as f32,
        solved[4] as f32,
        solved[5] as f32,
        solved[6] as f32,
        solved[7] as f32,
        1.0,
    ])
}

fn solve_8x8(mut matrix: [[f64; 9]; 8]) -> Option<[f64; 8]> {
    for col in 0..8 {
        let pivot =
            (col..8).max_by(|&a, &b| matrix[a][col].abs().total_cmp(&matrix[b][col].abs()))?;
        if matrix[pivot][col].abs() <= 1e-10 {
            return None;
        }
        if pivot != col {
            matrix.swap(pivot, col);
        }
        let pivot_value = matrix[col][col];
        for value in matrix[col].iter_mut().skip(col) {
            *value /= pivot_value;
        }
        let pivot_row = matrix[col];
        for (row, matrix_row) in matrix.iter_mut().enumerate() {
            if row == col {
                continue;
            }
            let factor = matrix_row[col];
            if factor.abs() <= 1e-12 {
                continue;
            }
            for (value, pivot_value) in matrix_row
                .iter_mut()
                .skip(col)
                .zip(pivot_row.iter().skip(col))
            {
                *value -= factor * *pivot_value;
            }
        }
    }
    let mut out = [0.0_f64; 8];
    for row in 0..8 {
        out[row] = matrix[row][8];
    }
    Some(out)
}

fn apply_homography(h: &[f32; 9], point: Point) -> Point {
    let denom = h[6] * point.x + h[7] * point.y + h[8];
    Point {
        x: (h[0] * point.x + h[1] * point.y + h[2]) / denom,
        y: (h[3] * point.x + h[4] * point.y + h[5]) / denom,
    }
}

fn point_in_convex_quad(point: Point, quad: Quad) -> bool {
    let points = quad.points();
    let mut sign = 0.0;
    for idx in 0..4 {
        let a = points[idx];
        let b = points[(idx + 1) % 4];
        let cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
        if cross.abs() <= 1e-4 {
            continue;
        }
        if sign == 0.0 {
            sign = cross.signum();
        } else if sign * cross < 0.0 {
            return false;
        }
    }
    true
}

fn infer_padding_rgb(rgba: &[u8], width: usize, height: usize) -> [u8; 3] {
    let thickness = ((width.min(height) as f32 * 0.04).round() as usize).max(1);
    let mut channels = [Vec::<u8>::new(), Vec::<u8>::new(), Vec::<u8>::new()];
    let stride = ((width * height) / 16_384).max(1);
    for y in 0..height {
        for x in 0..width {
            if y >= thickness && y < height - thickness && x >= thickness && x < width - thickness {
                continue;
            }
            let idx = (y * width + x) * 4;
            if !(idx / 4).is_multiple_of(stride) {
                continue;
            }
            let alpha = rgba[idx + 3];
            if alpha < 245 {
                continue;
            }
            channels[0].push(rgba[idx]);
            channels[1].push(rgba[idx + 1]);
            channels[2].push(rgba[idx + 2]);
        }
    }
    if channels.iter().any(Vec::is_empty) {
        return [255, 255, 255];
    }
    [
        median_u8(&mut channels[0]),
        median_u8(&mut channels[1]),
        median_u8(&mut channels[2]),
    ]
}

fn median_u8(values: &mut [u8]) -> u8 {
    values.sort_unstable();
    values[values.len() / 2]
}

fn percentile_sorted(values: &[f32], percentile: f32) -> Option<f32> {
    if values.is_empty() {
        return None;
    }
    let idx = ((values.len() - 1) as f32 * percentile).round() as usize;
    values.get(idx).copied()
}

fn distance(a: Point, b: Point) -> f32 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    (dx * dx + dy * dy).sqrt()
}

fn clamp01(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_rectifier_crops_axis_aligned_cp_panel() {
        let mut image = white_rgba(240, 180);
        draw_rect(&mut image, 240, 52, 28, 156, 132, [0, 0, 0], 3);
        draw_line(&mut image, 240, 52, 80, 156, 80, [0, 0, 255], 2);
        draw_line(&mut image, 240, 104, 28, 104, 132, [255, 0, 0], 2);
        draw_line(&mut image, 240, 52, 28, 156, 132, [120, 120, 120], 2);
        draw_line(&mut image, 240, 156, 28, 52, 132, [120, 120, 120], 2);

        let result = auto_rectify_rgba(&image, 240, 180, 128).expect("rectify");

        assert_eq!(result.width, 128);
        assert_eq!(result.height, 128);
        assert_eq!(result.report.mode, "detect_quad_warp");
        assert!(result.report.confidence >= 0.72, "{:?}", result.report);
        let detected = result.report.detected_source_quad.expect("detected quad");
        assert!((detected.top_left.x - 52.0).abs() <= 6.0, "{detected:?}");
        assert!((detected.top_left.y - 28.0).abs() <= 6.0, "{detected:?}");
    }

    /// A square drawn inside the paper — a preliminary base, a blintz, one
    /// cell of a grid — is bordered by creases as crisp as the paper's edge and
    /// scores as well as the paper does. The paper is the square that holds it.
    #[test]
    fn auto_rectifier_prefers_the_paper_over_a_square_drawn_inside_it() {
        let mut image = white_rgba(400, 400);
        // The paper.
        draw_rect(&mut image, 400, 30, 30, 370, 370, [0, 0, 0], 3);
        // A square of creases inside it, with its own diagonals.
        draw_rect(&mut image, 400, 120, 120, 280, 280, [200, 0, 0], 3);
        draw_line(&mut image, 400, 120, 120, 280, 280, [0, 0, 200], 2);
        draw_line(&mut image, 400, 280, 120, 120, 280, [0, 0, 200], 2);
        // Creases across the rest of the paper, so the paper is not empty.
        draw_line(&mut image, 400, 30, 200, 370, 200, [200, 0, 0], 2);
        draw_line(&mut image, 400, 200, 30, 200, 370, [0, 0, 200], 2);
        draw_line(&mut image, 400, 30, 30, 370, 370, [200, 0, 0], 2);

        let result = auto_rectify_rgba(&image, 400, 400, 256).expect("rectify");

        assert_eq!(result.report.mode, "detect_quad_warp");
        let detected = result.report.detected_source_quad.expect("detected quad");
        assert!((detected.top_left.x - 30.0).abs() <= 6.0, "{detected:?}");
        assert!((detected.top_left.y - 30.0).abs() <= 6.0, "{detected:?}");
        assert!(
            (detected.bottom_right.x - 370.0).abs() <= 6.0,
            "{detected:?}"
        );
        assert!(
            (detected.bottom_right.y - 370.0).abs() <= 6.0,
            "{detected:?}"
        );
        // The inner square was a credible candidate, and the report says so.
        let candidates = result.report.metrics["raw"]["candidates"]
            .as_array()
            .expect("candidates")
            .clone();
        assert!(candidates.len() >= 2, "{candidates:?}");
    }

    /// A caption rule, a legend, an auxiliary line running off the paper or
    /// the page's own edge gives the finder a box one edge wider than the
    /// paper. It is bordered on every side and only a few percent off
    /// square, and it is larger; the paper still wins.
    #[test]
    fn auto_rectifier_prefers_the_paper_over_a_wider_box_a_few_percent_off_square() {
        let mut image = white_rgba(400, 400);
        // The paper, 280 px square.
        draw_rect(&mut image, 400, 60, 60, 340, 340, [0, 0, 0], 3);
        // A full-height rule 12 px outside its left edge: with the paper's
        // top and bottom it makes a 292 x 280 box, square to 4%.
        draw_line(&mut image, 400, 48, 60, 48, 340, [0, 0, 0], 3);
        draw_line(&mut image, 400, 48, 60, 60, 60, [0, 0, 0], 3);
        draw_line(&mut image, 400, 48, 340, 60, 340, [0, 0, 0], 3);
        // Creases, so the paper is not empty.
        draw_line(&mut image, 400, 60, 200, 340, 200, [200, 0, 0], 2);
        draw_line(&mut image, 400, 200, 60, 200, 340, [0, 0, 200], 2);
        draw_line(&mut image, 400, 60, 60, 340, 340, [200, 0, 0], 2);
        draw_line(&mut image, 400, 340, 60, 60, 340, [0, 0, 200], 2);

        let result = auto_rectify_rgba(&image, 400, 400, 256).expect("rectify");

        assert_eq!(result.report.mode, "detect_quad_warp");
        let detected = result.report.detected_source_quad.expect("detected quad");
        assert!((detected.top_left.x - 60.0).abs() <= 6.0, "{detected:?}");
        assert!(
            (detected.bottom_right.x - 340.0).abs() <= 6.0,
            "{detected:?}"
        );
        // The wider box was a credible candidate.
        let candidates = result.report.metrics["raw"]["candidates"]
            .as_array()
            .expect("candidates")
            .clone();
        assert!(
            candidates.iter().any(|candidate| {
                candidate["box"][0]
                    .as_f64()
                    .is_some_and(|x| (x - 48.0).abs() <= 6.0)
                    && candidate["confidence"].as_f64().is_some_and(|c| c >= 0.72)
            }),
            "{candidates:?}"
        );
    }

    /// A square the paper's size, shifted so that its top edge runs along the
    /// title and its bottom along a crease, is the same size as the paper;
    /// the paper, bordered on every side, is the one to keep.
    #[test]
    fn auto_rectifier_prefers_the_paper_over_a_square_of_its_size_shifted_onto_the_title() {
        let mut image = white_rgba(400, 400);
        // The paper, 280 px square, with creases.
        draw_rect(&mut image, 400, 60, 60, 340, 340, [0, 0, 0], 3);
        draw_line(&mut image, 400, 60, 200, 340, 200, [200, 0, 0], 2);
        draw_line(&mut image, 400, 200, 60, 200, 340, [0, 0, 200], 2);
        draw_line(&mut image, 400, 60, 60, 340, 340, [200, 0, 0], 2);
        // A crease 20 px above the bottom edge, and a title 20 px above the
        // paper spanning most of its width: a 280 px square shifted up by 20.
        draw_line(&mut image, 400, 60, 320, 340, 320, [200, 0, 0], 2);
        draw_line(&mut image, 400, 70, 40, 300, 40, [0, 0, 0], 3);

        let result = auto_rectify_rgba(&image, 400, 400, 256).expect("rectify");

        assert_eq!(result.report.mode, "detect_quad_warp");
        let detected = result.report.detected_source_quad.expect("detected quad");
        assert!((detected.top_left.y - 60.0).abs() <= 6.0, "{detected:?}");
        assert!(
            (detected.bottom_right.y - 340.0).abs() <= 6.0,
            "{detected:?}"
        );
    }

    /// A paper whose border is crossed by creases every few pixels reads a
    /// weak border on that side; it is still the largest square, and beats
    /// the fully bordered square drawn inside it.
    #[test]
    fn auto_rectifier_prefers_a_paper_with_a_busy_border_over_a_clean_square_inside_it() {
        let mut image = white_rgba(400, 400);
        // The paper, its right border broken every 20 px.
        draw_rect(&mut image, 400, 30, 30, 370, 370, [0, 0, 0], 3);
        for gap in (40..360).step_by(20) {
            draw_line(&mut image, 400, 366, gap, 374, gap + 4, [255, 255, 255], 9);
        }
        // A clean square inside it, with its diagonals.
        draw_rect(&mut image, 400, 60, 60, 180, 180, [200, 0, 0], 3);
        draw_line(&mut image, 400, 60, 60, 180, 180, [0, 0, 200], 2);
        draw_line(&mut image, 400, 180, 60, 60, 180, [0, 0, 200], 2);
        // Creases across the rest of the paper.
        draw_line(&mut image, 400, 30, 250, 370, 250, [200, 0, 0], 2);
        draw_line(&mut image, 400, 250, 30, 250, 370, [0, 0, 200], 2);
        draw_line(&mut image, 400, 30, 370, 370, 30, [200, 0, 0], 2);

        let result = auto_rectify_rgba(&image, 400, 400, 256).expect("rectify");

        assert_eq!(result.report.mode, "detect_quad_warp");
        let detected = result.report.detected_source_quad.expect("detected quad");
        assert!((detected.top_left.x - 30.0).abs() <= 6.0, "{detected:?}");
        assert!(
            (detected.bottom_right.x - 370.0).abs() <= 6.0,
            "{detected:?}"
        );
    }

    /// A paper whose border sits a percent or two inside the image is a
    /// paper with a margin, not the frame: it is warped to the paper box,
    /// or the decoder reads the margin as a scale error.
    #[test]
    fn auto_rectifier_warps_a_paper_a_little_inside_the_frame() {
        let mut image = white_rgba(400, 400);
        draw_rect(&mut image, 400, 6, 6, 393, 393, [0, 0, 0], 3);
        draw_line(&mut image, 400, 6, 6, 393, 393, [0, 0, 255], 2);
        draw_line(&mut image, 400, 393, 6, 6, 393, [255, 0, 0], 2);
        draw_line(&mut image, 400, 6, 200, 393, 200, [255, 0, 0], 2);

        let result = auto_rectify_rgba(&image, 400, 400, 256).expect("rectify");

        assert_eq!(
            result.report.mode, "detect_quad_warp",
            "{:?}",
            result.report
        );
        let detected = result.report.detected_source_quad.expect("detected quad");
        assert!((detected.top_left.x - 6.0).abs() <= 3.0, "{detected:?}");
        assert!(
            (detected.bottom_right.y - 393.0).abs() <= 3.0,
            "{detected:?}"
        );
    }

    /// A scan with one dark image edge is not a paper filling the frame: the
    /// frame's mean border support clears the bar on that side alone, and the
    /// bordered square inside it is the paper.
    #[test]
    fn auto_rectifier_ignores_a_frame_with_one_dark_edge() {
        let mut image = white_rgba(400, 400);
        draw_rect(&mut image, 400, 30, 30, 370, 370, [0, 0, 0], 3);
        draw_line(&mut image, 400, 30, 30, 370, 370, [0, 0, 255], 2);
        draw_line(&mut image, 400, 370, 30, 30, 370, [255, 0, 0], 2);
        draw_line(&mut image, 400, 30, 200, 370, 200, [255, 0, 0], 2);
        // The right edge of the image is dark.
        draw_rect(&mut image, 400, 394, 0, 399, 399, [0, 0, 0], 3);

        let result = auto_rectify_rgba(&image, 400, 400, 256).expect("rectify");

        assert_eq!(
            result.report.mode, "detect_quad_warp",
            "{:?}",
            result.report
        );
        let detected = result.report.detected_source_quad.expect("detected quad");
        assert!((detected.top_left.x - 30.0).abs() <= 6.0, "{detected:?}");
        assert!(
            (detected.bottom_right.x - 370.0).abs() <= 6.0,
            "{detected:?}"
        );
    }

    #[test]
    fn auto_rectifier_preserves_full_frame_square_cp() {
        let mut image = white_rgba(128, 128);
        draw_rect(&mut image, 128, 0, 0, 127, 127, [0, 0, 0], 3);
        draw_line(&mut image, 128, 0, 0, 127, 127, [0, 0, 255], 2);
        draw_line(&mut image, 128, 127, 0, 0, 127, [255, 0, 0], 2);

        let result = auto_rectify_rgba(&image, 128, 128, 128).expect("rectify");

        assert_eq!(result.report.mode, "full_frame_resize");
        assert_eq!(result.report.confidence, 1.0);
        // Only the density note, which this fixture earns: a 3 px black border on
        // a 128 px frame is 5% of the image, so `infer_padding_rgb` medians the
        // border ring to black and the margin it fills reads as ink. At the
        // 1024 px the detector actually runs at, the same drawing is 0.3%.
        assert_eq!(
            result
                .report
                .warnings
                .iter()
                .map(|warning| warning.code.as_str())
                .filter(|code| *code != "dense_input_evidence")
                .count(),
            0,
            "{:?}",
            result.report
        );
        // Inset like every other path — see `paper_target_span`. This is the
        // assertion the full-frame path did not have, and its absence is why
        // this path spent so long handing the model a frame-filling paper.
        let target = result.report.target_quad.expect("target quad");
        let margin = 128.0 * DEFAULT_BORDER_MARGIN_RATIO;
        assert_eq!(target.top_left.x, margin);
        assert_eq!(target.top_left.y, margin);
        assert_eq!(target.bottom_right.x, 128.0 - margin);
        assert_eq!(target.bottom_right.y, 128.0 - margin);
    }

    /// Every rectification path maps the paper onto the same box, because the
    /// decoder assumes one (`unit_from_px` divides by `image_size - 64` and never
    /// reads the report) and the training renders use it (`v2_boundary.frame` is
    /// `32..992` of 1024 in every eval-pack sample).
    #[test]
    fn every_path_maps_the_paper_onto_the_same_box() {
        let (lo, hi) = paper_target_span(1024);
        assert_eq!((lo, hi), (32.0, 992.0));

        // A CP that fills its frame — the already-cropped case, `resize_*`.
        let mut full = white_rgba(256, 256);
        draw_rect(&mut full, 256, 0, 0, 255, 255, [0, 0, 0], 2);
        draw_line(&mut full, 256, 0, 0, 255, 255, [0, 0, 255], 2);
        // The same CP with room around it — the photographed case, `warp_*`.
        let mut inset = white_rgba(256, 256);
        draw_rect(&mut inset, 256, 40, 40, 215, 215, [0, 0, 0], 2);
        draw_line(&mut inset, 256, 40, 40, 215, 215, [0, 0, 255], 2);

        for (label, image) in [("full frame", full), ("detected panel", inset)] {
            let result = auto_rectify_rgba(&image, 256, 256, 256).expect("rectify");
            let target = result.report.target_quad.expect("target quad");
            let (lo, hi) = paper_target_span(256);
            assert_eq!(
                (target.top_left.x, target.bottom_right.x),
                (lo, hi),
                "{label} ({}) put the paper somewhere else",
                result.report.mode
            );
        }
    }

    #[test]
    fn manual_rectifier_warps_quad_and_reports_manual_mode() {
        let mut image = white_rgba(160, 120);
        draw_rect(&mut image, 160, 30, 20, 130, 100, [0, 0, 0], 3);
        draw_line(&mut image, 160, 30, 20, 130, 100, [0, 0, 255], 2);
        let quad = Quad {
            top_left: Point { x: 30.0, y: 20.0 },
            top_right: Point { x: 130.0, y: 20.0 },
            bottom_right: Point { x: 130.0, y: 100.0 },
            bottom_left: Point { x: 30.0, y: 100.0 },
        };

        let result = manual_rectify_rgba(&image, 160, 120, 128, quad).expect("rectify");

        assert_eq!(result.report.mode, "manual_quad_warp");
        assert_eq!(result.report.confidence, 1.0);
        let mid = ((64 * 128 + 64) * 4) as usize;
        assert!(result.rgba[mid + 2] > result.rgba[mid]);
    }

    #[test]
    fn manual_rectifier_does_not_sample_source_pixels_outside_crop() {
        let mut image = white_rgba(160, 120);
        draw_line(&mut image, 160, 30, 16, 130, 16, [0, 0, 0], 3);
        draw_rect(&mut image, 160, 30, 20, 130, 100, [0, 0, 0], 3);
        let quad = Quad {
            top_left: Point { x: 30.0, y: 20.0 },
            top_right: Point { x: 130.0, y: 20.0 },
            bottom_right: Point { x: 130.0, y: 100.0 },
            bottom_left: Point { x: 30.0, y: 100.0 },
        };

        let result = manual_rectify_rgba(&image, 160, 120, 128, quad).expect("rectify");

        assert_eq!(rgb_at(&result.rgba, 128, 64, 2), [255, 255, 255]);
        assert_eq!(
            result.report.metrics["source_crop_padding_px"].as_f64(),
            Some(0.0)
        );
        assert_eq!(
            result.report.metrics["target_crop_padding_px"].as_f64(),
            Some(0.0)
        );
    }

    #[test]
    fn dense_rectified_input_gets_warning() {
        let mut image = white_rgba(128, 128);
        draw_rect(&mut image, 128, 0, 0, 127, 127, [0, 0, 0], 2);
        for offset in (8..120).step_by(8) {
            draw_line(&mut image, 128, offset, 0, offset, 127, [120, 120, 120], 1);
            draw_line(&mut image, 128, 0, offset, 127, offset, [120, 120, 120], 1);
        }

        let result = auto_rectify_rgba(&image, 128, 128, 128).expect("rectify");
        assert!(
            result
                .report
                .warnings
                .iter()
                .any(|warning| warning.code == "dense_input_evidence"),
            "{:?}",
            result.report,
        );
    }

    #[test]
    fn missing_panel_warns_instead_of_hallucinating_crop() {
        let image = white_rgba(180, 120);

        let result = auto_rectify_rgba(&image, 180, 120, 128).expect("rectify");

        assert_eq!(result.report.mode, "resize_pad");
        assert!(
            result
                .report
                .warnings
                .iter()
                .any(|warning| warning.code == "cp_panel_not_detected")
        );
    }

    /// A square paper rotated by `angle_deg` about `(cx, cy)`, drawn with the
    /// creases a crease pattern has: its two diagonals and its two midlines,
    /// which is what gives the projection sweep something to confuse the
    /// paper with.
    fn draw_rotated_paper(
        image: &mut [u8],
        width: usize,
        (cx, cy): (f32, f32),
        half: f32,
        angle_deg: f32,
    ) -> [Point; 4] {
        let (sin, cos) = angle_deg.to_radians().sin_cos();
        let at = |u: f32, v: f32| Point {
            x: cx + u * cos - v * sin,
            y: cy + u * sin + v * cos,
        };
        let corners = [
            at(-half, -half),
            at(half, -half),
            at(half, half),
            at(-half, half),
        ];
        let line = |image: &mut [u8], a: Point, b: Point, rgb: [u8; 3], thickness: usize| {
            draw_line(
                image,
                width,
                a.x.round().max(0.0) as usize,
                a.y.round().max(0.0) as usize,
                b.x.round().max(0.0) as usize,
                b.y.round().max(0.0) as usize,
                rgb,
                thickness,
            );
        };
        for idx in 0..4 {
            line(image, corners[idx], corners[(idx + 1) % 4], [0, 0, 0], 3);
        }
        line(image, corners[0], corners[2], [255, 0, 0], 2);
        line(image, corners[1], corners[3], [255, 0, 0], 2);
        line(image, at(-half, 0.0), at(half, 0.0), [0, 0, 255], 2);
        line(image, at(0.0, -half), at(0.0, half), [0, 0, 255], 2);
        corners
    }

    /// How far the detected quad's corners are from the paper's, matched by
    /// the rotation the finder is free to choose: a square has four namings
    /// and every one of them is the same crop.
    fn corner_error(detected: Quad, paper: [Point; 4]) -> f32 {
        let found = detected.points();
        (0..4)
            .map(|shift| {
                (0..4)
                    .map(|idx| distance(found[idx], paper[(idx + shift) % 4]))
                    .fold(0.0_f32, f32::max)
            })
            .fold(f32::INFINITY, f32::min)
    }

    #[test]
    fn auto_rectifier_finds_a_paper_drawn_as_a_diamond() {
        let mut image = white_rgba(320, 320);
        let paper = draw_rotated_paper(&mut image, 320, (160.0, 160.0), 105.0, 45.0);

        let result = auto_rectify_rgba(&image, 320, 320, 128).expect("rectify");

        assert_eq!(result.report.mode, "detect_quad_warp");
        let detected = result.report.detected_source_quad.expect("detected quad");
        assert!(
            corner_error(detected, paper) <= 6.0,
            "{detected:?} against {paper:?}"
        );
    }

    #[test]
    fn auto_rectifier_finds_a_paper_photographed_a_few_degrees_off_square() {
        let mut image = white_rgba(320, 320);
        let paper = draw_rotated_paper(&mut image, 320, (160.0, 160.0), 128.0, 8.0);

        let result = auto_rectify_rgba(&image, 320, 320, 128).expect("rectify");

        let detected = result.report.detected_source_quad.expect("detected quad");
        assert!(
            corner_error(detected, paper) <= 6.0,
            "{detected:?} against {paper:?}"
        );
    }

    /// The `blackbuck-simplified` shape: the folded model drawn beside the
    /// crease pattern sits inside the diamond's bounding box, so a finder
    /// that measures a quad by its bounding box reads it as the paper's own
    /// content.
    #[test]
    fn auto_rectifier_ignores_a_model_drawn_beside_a_diamond() {
        let mut image = white_rgba(440, 320);
        let paper = draw_rotated_paper(&mut image, 440, (150.0, 160.0), 105.0, 45.0);
        for offset in 0..40 {
            draw_line(
                &mut image,
                440,
                330,
                120 + offset,
                420,
                160 + offset,
                [90, 90, 90],
                2,
            );
        }

        let result = auto_rectify_rgba(&image, 440, 320, 128).expect("rectify");

        let detected = result.report.detected_source_quad.expect("detected quad");
        assert!(
            corner_error(detected, paper) <= 6.0,
            "{detected:?} against {paper:?}"
        );
    }

    /// A diamond drawn inside a square paper is a crease, not the paper —
    /// and it is the shape a blintz or a preliminary base puts there. The
    /// upright paper holds it, so the upright paper wins.
    #[test]
    fn auto_rectifier_prefers_the_paper_over_a_diamond_creased_inside_it() {
        let mut image = white_rgba(320, 320);
        draw_rect(&mut image, 320, 40, 40, 280, 280, [0, 0, 0], 3);
        let diamond = [(160, 40), (280, 160), (160, 280), (40, 160)];
        for idx in 0..4 {
            let (x0, y0) = diamond[idx];
            let (x1, y1) = diamond[(idx + 1) % 4];
            draw_line(&mut image, 320, x0, y0, x1, y1, [255, 0, 0], 2);
        }
        draw_line(&mut image, 320, 40, 160, 280, 160, [0, 0, 255], 2);
        draw_line(&mut image, 320, 160, 40, 160, 280, [0, 0, 255], 2);

        let result = auto_rectify_rgba(&image, 320, 320, 128).expect("rectify");

        let detected = result.report.detected_source_quad.expect("detected quad");
        assert!(
            (detected.top_left.x - 40.0).abs() <= 6.0
                && (detected.top_left.y - 40.0).abs() <= 6.0
                && (detected.bottom_right.x - 280.0).abs() <= 6.0,
            "took the inscribed diamond instead of the paper: {detected:?}"
        );
    }

    /// The crop of a rotated paper is a rotation, never a mirror: the corners
    /// keep the winding `Quad::frame` has, so the warp cannot flip the
    /// pattern left for right.
    #[test]
    fn a_rotated_panel_keeps_the_frames_winding() {
        let mut image = white_rgba(320, 320);
        draw_rotated_paper(&mut image, 320, (160.0, 160.0), 105.0, 45.0);

        let result = auto_rectify_rgba(&image, 320, 320, 128).expect("rectify");
        let detected = result.report.detected_source_quad.expect("detected quad");

        assert!(
            signed_area(detected) > 0.0 && signed_area(Quad::frame(320, 320)) > 0.0,
            "{detected:?}"
        );
    }

    fn signed_area(quad: Quad) -> f32 {
        let p = quad.points();
        0.5 * (0..4)
            .map(|idx| {
                let (a, b) = (p[idx], p[(idx + 1) % 4]);
                a.x * b.y - b.x * a.y
            })
            .sum::<f32>()
    }

    /// A projection along the image's own x axis is the per-column edge count
    /// the finder always used, which is what keeps every upright panel it
    /// used to find exactly where it was.
    #[test]
    fn the_upright_projection_is_a_column_histogram() {
        let mut image = white_rgba(64, 48);
        draw_line(&mut image, 64, 20, 4, 20, 43, [0, 0, 0], 1);
        let analysis = analyze_rgba(&image, 64, 48).expect("analyze");
        let (u_axis, v_axis) = ProjectionAxis::pair(0.0, 64, 48);

        assert_eq!(u_axis.len, 64);
        assert_eq!(v_axis.len, 48);
        assert_eq!(u_axis.mean_chord(64, 48), 48.0);
        let columns = project_edges(&analysis, u_axis, 1);
        for (x, count) in columns.iter().enumerate() {
            let expected = (0..48).filter(|y| analysis.edges[y * 64 + x]).count() as f32;
            assert_eq!(*count, expected, "column {x}");
        }
    }

    /// `hawk`'s mechanism, in miniature: a paper edge at one end of a band
    /// of creases parallel to it, all of them above the threshold together.
    #[test]
    fn a_run_holding_a_band_and_an_edge_reads_as_separate_lines() {
        // A dense band, a gap too small to fall below threshold, then the
        // paper's own edge — one run of buckets, two lines.
        let mut run = vec![200.0, 260.0, 210.0, 250.0, 205.0];
        run.extend([150.0, 140.0, 135.0, 140.0, 150.0]);
        run.extend([190.0, 240.0, 279.0, 230.0, 180.0]);

        let one = split_run(&run, 0, usize::MAX);
        let many = split_run(&run, 0, 3);

        assert_eq!(one.len(), 1, "a run must still read as one line on demand");
        assert!(
            (5..=9).contains(&one[0].center),
            "the whole run averages to its middle: {:?}",
            one[0].center
        );
        assert!(many.len() >= 2, "{many:?}");
        let outermost = many.last().expect("a line");
        assert!(
            (11..=13).contains(&outermost.center),
            "the edge at the far end is its own line: {:?}",
            many.iter().map(|c| c.center).collect::<Vec<_>>()
        );
    }

    #[test]
    fn two_peaks_within_one_lines_width_are_one_line() {
        let run = vec![100.0, 180.0, 120.0, 170.0, 90.0];
        assert_eq!(run_peaks(&run, 5).len(), 1);
        assert_eq!(run_peaks(&run, 2).len(), 2);
    }

    #[test]
    fn angles_are_separated_around_the_squares_symmetry() {
        assert_eq!(angle_separation(44.0, -45.0), 1.0);
        assert_eq!(angle_separation(0.0, 45.0), 45.0);
        assert_eq!(angle_separation(-3.0, 3.0), 6.0);
    }

    fn white_rgba(width: usize, height: usize) -> Vec<u8> {
        let mut image = vec![255; width * height * 4];
        for pixel in image.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
        image
    }

    fn rgb_at(image: &[u8], width: usize, x: usize, y: usize) -> [u8; 3] {
        let idx = (y * width + x) * 4;
        [image[idx], image[idx + 1], image[idx + 2]]
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_rect(
        image: &mut [u8],
        width: usize,
        x0: usize,
        y0: usize,
        x1: usize,
        y1: usize,
        rgb: [u8; 3],
        thickness: usize,
    ) {
        for t in 0..thickness {
            draw_line(image, width, x0, y0 + t, x1, y0 + t, rgb, 1);
            draw_line(image, width, x0, y1 - t, x1, y1 - t, rgb, 1);
            draw_line(image, width, x0 + t, y0, x0 + t, y1, rgb, 1);
            draw_line(image, width, x1 - t, y0, x1 - t, y1, rgb, 1);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_line(
        image: &mut [u8],
        width: usize,
        x0: usize,
        y0: usize,
        x1: usize,
        y1: usize,
        rgb: [u8; 3],
        thickness: usize,
    ) {
        let dx = x1 as isize - x0 as isize;
        let dy = y1 as isize - y0 as isize;
        let steps = dx.abs().max(dy.abs()).max(1);
        for step in 0..=steps {
            let x = x0 as isize + dx * step / steps;
            let y = y0 as isize + dy * step / steps;
            for oy in -(thickness as isize / 2)..=(thickness as isize / 2) {
                for ox in -(thickness as isize / 2)..=(thickness as isize / 2) {
                    let px = x + ox;
                    let py = y + oy;
                    if px < 0 || py < 0 {
                        continue;
                    }
                    let idx = (py as usize * width + px as usize) * 4;
                    if idx + 3 >= image.len() {
                        continue;
                    }
                    image[idx] = rgb[0];
                    image[idx + 1] = rgb[1];
                    image[idx + 2] = rgb[2];
                    image[idx + 3] = 255;
                }
            }
        }
    }
}
