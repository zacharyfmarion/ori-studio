//! Finite line segment extraction experiments for CP detector parity.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SegmentPoint {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SegmentCandidate {
    pub p0: SegmentPoint,
    pub p1: SegmentPoint,
    pub theta: f32,
    pub rho: f32,
    pub votes: u32,
    pub support: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LineCandidate {
    pub p0: SegmentPoint,
    pub p1: SegmentPoint,
    pub theta: f32,
    pub rho: f32,
    pub support: f32,
    pub votes: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SegmentExtractionConfig {
    pub theta_bins: usize,
    pub vote_threshold: u32,
    pub nms_theta_radius: isize,
    pub nms_rho_radius: isize,
    pub max_peaks: usize,
    pub line_distance_px: f32,
    pub min_line_length_px: f32,
    pub max_line_gap_px: f32,
    pub max_segments: usize,
    pub line_angle_merge_degrees: f32,
    pub line_rho_merge_px: f32,
    pub max_line_hypotheses: usize,
}

impl Default for SegmentExtractionConfig {
    fn default() -> Self {
        Self {
            theta_bins: 720,
            vote_threshold: 10,
            nms_theta_radius: 4,
            nms_rho_radius: 4,
            max_peaks: 1600,
            line_distance_px: 1.5,
            min_line_length_px: 6.0,
            max_line_gap_px: 4.0,
            max_segments: 12000,
            line_angle_merge_degrees: 2.5,
            line_rho_merge_px: 3.0,
            max_line_hypotheses: 240,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct ForegroundPoint {
    x: f32,
    y: f32,
}

#[derive(Debug, Clone, Copy)]
struct HoughPeak {
    theta_idx: usize,
    rho_idx: usize,
    theta: f32,
    rho: f32,
    votes: u32,
}

pub fn extract_probabilistic_segments(
    mask: &[u8],
    width: usize,
    height: usize,
    config: &SegmentExtractionConfig,
) -> Vec<SegmentCandidate> {
    if width == 0 || height == 0 || mask.len() != width * height || config.theta_bins == 0 {
        return Vec::new();
    }
    let foreground = foreground_points(mask, width, height);
    if foreground.is_empty() {
        return Vec::new();
    }
    let rho_max = (((width * width + height * height) as f64).sqrt().ceil() as i32).max(1);
    let rho_bins = (rho_max * 2 + 1) as usize;
    let trig = theta_lut(config.theta_bins);
    let mut accumulator = vec![0u32; config.theta_bins * rho_bins];
    for point in &foreground {
        for (theta_idx, (sin_t, cos_t)) in trig.iter().enumerate() {
            let rho = point.x * cos_t + point.y * sin_t;
            let rho_idx = rho.round() as i32 + rho_max;
            if (0..rho_bins as i32).contains(&rho_idx) {
                accumulator[theta_idx * rho_bins + rho_idx as usize] += 1;
            }
        }
    }

    let peaks = hough_peaks(&accumulator, rho_bins, rho_max, &trig, config);
    let mut segments = Vec::new();
    for peak in peaks {
        segments.extend(segments_for_peak(peak, &foreground, config));
        if segments.len() >= config.max_segments {
            segments.truncate(config.max_segments);
            break;
        }
    }
    dedupe_segments(&mut segments, config);
    segments.truncate(config.max_segments);
    segments
}

pub fn merge_segments_into_lines(
    segments: &[SegmentCandidate],
    config: &SegmentExtractionConfig,
) -> Vec<LineCandidate> {
    let mut groups: Vec<Vec<&SegmentCandidate>> = Vec::new();
    let angle_tol = config.line_angle_merge_degrees.to_radians();
    for segment in segments {
        if distance(segment.p0, segment.p1) < config.min_line_length_px {
            continue;
        }
        if let Some(group) = groups.iter_mut().find(|group| {
            let first = group[0];
            angle_distance(first.theta, segment.theta) <= angle_tol
                && (first.rho - segment.rho).abs() <= config.line_rho_merge_px
        }) {
            group.push(segment);
        } else {
            groups.push(vec![segment]);
        }
    }

    let mut lines = Vec::new();
    for group in groups {
        let support_sum: f32 = group.iter().map(|segment| segment.support.max(1.0)).sum();
        if support_sum <= 0.0 {
            continue;
        }
        let theta = weighted_bidirectional_angle(
            group.iter().map(|segment| segment.theta),
            group.iter().map(|segment| segment.support.max(1.0)),
        );
        let normal = SegmentPoint {
            x: -theta.sin(),
            y: theta.cos(),
        };
        let rho = group
            .iter()
            .map(|segment| segment.rho * segment.support.max(1.0))
            .sum::<f32>()
            / support_sum;
        let direction = SegmentPoint {
            x: theta.cos(),
            y: theta.sin(),
        };
        let mut t_min = f32::INFINITY;
        let mut t_max = f32::NEG_INFINITY;
        for segment in &group {
            for point in [segment.p0, segment.p1] {
                let t = dot(point, direction);
                t_min = t_min.min(t);
                t_max = t_max.max(t);
            }
        }
        let center = SegmentPoint {
            x: direction.x * ((t_min + t_max) * 0.5),
            y: direction.y * ((t_min + t_max) * 0.5),
        };
        let signed_center = SegmentPoint {
            x: center.x + normal.x * (rho - dot(center, normal)),
            y: center.y + normal.y * (rho - dot(center, normal)),
        };
        let center_t = dot(signed_center, direction);
        lines.push(LineCandidate {
            p0: SegmentPoint {
                x: signed_center.x + direction.x * (t_min - center_t),
                y: signed_center.y + direction.y * (t_min - center_t),
            },
            p1: SegmentPoint {
                x: signed_center.x + direction.x * (t_max - center_t),
                y: signed_center.y + direction.y * (t_max - center_t),
            },
            theta,
            rho,
            support: support_sum,
            votes: group.iter().map(|segment| segment.votes).sum(),
        });
    }
    lines.sort_by(|left, right| right.support.total_cmp(&left.support));
    lines.truncate(config.max_line_hypotheses);
    lines
}

fn foreground_points(mask: &[u8], width: usize, height: usize) -> Vec<ForegroundPoint> {
    let mut points = Vec::new();
    for y in 0..height {
        for x in 0..width {
            if mask[y * width + x] > 0 {
                points.push(ForegroundPoint {
                    x: x as f32,
                    y: y as f32,
                });
            }
        }
    }
    points
}

fn theta_lut(theta_bins: usize) -> Vec<(f32, f32)> {
    (0..theta_bins)
        .map(|idx| {
            let theta = idx as f32 * std::f32::consts::PI / theta_bins as f32;
            theta.sin_cos()
        })
        .collect()
}

fn hough_peaks(
    accumulator: &[u32],
    rho_bins: usize,
    rho_max: i32,
    trig: &[(f32, f32)],
    config: &SegmentExtractionConfig,
) -> Vec<HoughPeak> {
    let theta_bins = trig.len();
    let mut peaks = Vec::new();
    for theta_idx in 0..theta_bins {
        for rho_idx in 0..rho_bins {
            let votes = accumulator[theta_idx * rho_bins + rho_idx];
            if votes < config.vote_threshold
                || !is_local_max(
                    accumulator,
                    theta_bins,
                    rho_bins,
                    theta_idx,
                    rho_idx,
                    votes,
                    config,
                )
            {
                continue;
            }
            peaks.push(HoughPeak {
                theta_idx,
                rho_idx,
                theta: theta_idx as f32 * std::f32::consts::PI / theta_bins as f32,
                rho: rho_idx as f32 - rho_max as f32,
                votes,
            });
        }
    }
    peaks.sort_by(|left, right| {
        right
            .votes
            .cmp(&left.votes)
            .then_with(|| left.theta_idx.cmp(&right.theta_idx))
            .then_with(|| left.rho_idx.cmp(&right.rho_idx))
    });
    peaks.truncate(config.max_peaks);
    peaks
}

fn is_local_max(
    accumulator: &[u32],
    theta_bins: usize,
    rho_bins: usize,
    theta_idx: usize,
    rho_idx: usize,
    votes: u32,
    config: &SegmentExtractionConfig,
) -> bool {
    for dt in -config.nms_theta_radius..=config.nms_theta_radius {
        for dr in -config.nms_rho_radius..=config.nms_rho_radius {
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

fn segments_for_peak(
    peak: HoughPeak,
    foreground: &[ForegroundPoint],
    config: &SegmentExtractionConfig,
) -> Vec<SegmentCandidate> {
    let (sin_t, cos_t) = peak.theta.sin_cos();
    let direction = SegmentPoint {
        x: -sin_t,
        y: cos_t,
    };
    let mut projections = Vec::new();
    for point in foreground {
        let rho = point.x * cos_t + point.y * sin_t;
        if (rho - peak.rho).abs() <= config.line_distance_px {
            projections.push((point.x * direction.x + point.y * direction.y, *point));
        }
    }
    if projections.is_empty() {
        return Vec::new();
    }
    projections.sort_by(|left, right| left.0.total_cmp(&right.0));
    let mut segments = Vec::new();
    let mut start = 0usize;
    for idx in 1..=projections.len() {
        let gap = if idx < projections.len() {
            projections[idx].0 - projections[idx - 1].0
        } else {
            f32::INFINITY
        };
        if gap <= config.max_line_gap_px {
            continue;
        }
        let run = &projections[start..idx];
        if let Some(segment) = segment_from_run(peak, direction, run, config) {
            segments.push(segment);
        }
        start = idx;
    }
    segments
}

fn segment_from_run(
    peak: HoughPeak,
    direction: SegmentPoint,
    run: &[(f32, ForegroundPoint)],
    config: &SegmentExtractionConfig,
) -> Option<SegmentCandidate> {
    let first = run.first()?.0;
    let last = run.last()?.0;
    let length = last - first;
    if length < config.min_line_length_px {
        return None;
    }
    let normal = SegmentPoint {
        x: peak.theta.cos(),
        y: peak.theta.sin(),
    };
    let p0 = SegmentPoint {
        x: normal.x * peak.rho + direction.x * first,
        y: normal.y * peak.rho + direction.y * first,
    };
    let p1 = SegmentPoint {
        x: normal.x * peak.rho + direction.x * last,
        y: normal.y * peak.rho + direction.y * last,
    };
    let theta = (p1.y - p0.y)
        .atan2(p1.x - p0.x)
        .rem_euclid(std::f32::consts::PI);
    let line_normal = SegmentPoint {
        x: -theta.sin(),
        y: theta.cos(),
    };
    Some(SegmentCandidate {
        p0,
        p1,
        theta,
        rho: dot(line_normal, p0),
        votes: run.len() as u32,
        support: length.max(run.len() as f32),
    })
}

fn dedupe_segments(segments: &mut Vec<SegmentCandidate>, config: &SegmentExtractionConfig) {
    segments.sort_by(|left, right| right.support.total_cmp(&left.support));
    let mut out: Vec<SegmentCandidate> = Vec::new();
    let angle_tol = config.line_angle_merge_degrees.to_radians();
    'segments: for segment in segments.drain(..) {
        for existing in &out {
            if angle_distance(existing.theta, segment.theta) <= angle_tol
                && (existing.rho - segment.rho).abs() <= config.line_rho_merge_px
                && endpoint_cost(existing, &segment) <= config.max_line_gap_px * 2.0
            {
                continue 'segments;
            }
        }
        out.push(segment);
    }
    *segments = out;
}

fn weighted_bidirectional_angle(
    angles: impl Iterator<Item = f32>,
    weights: impl Iterator<Item = f32>,
) -> f32 {
    let mut x = 0.0;
    let mut y = 0.0;
    for (angle, weight) in angles.zip(weights) {
        x += (2.0 * angle).cos() * weight;
        y += (2.0 * angle).sin() * weight;
    }
    (0.5 * y.atan2(x)).rem_euclid(std::f32::consts::PI)
}

fn endpoint_cost(left: &SegmentCandidate, right: &SegmentCandidate) -> f32 {
    let same = distance(left.p0, right.p0) + distance(left.p1, right.p1);
    let swapped = distance(left.p0, right.p1) + distance(left.p1, right.p0);
    same.min(swapped)
}

fn dot(left: SegmentPoint, right: SegmentPoint) -> f32 {
    left.x * right.x + left.y * right.y
}

fn distance(left: SegmentPoint, right: SegmentPoint) -> f32 {
    let dx = left.x - right.x;
    let dy = left.y - right.y;
    (dx * dx + dy * dy).sqrt()
}

fn angle_distance(a: f32, b: f32) -> f32 {
    let mut d = (a - b).abs() % std::f32::consts::PI;
    if d > std::f32::consts::PI / 2.0 {
        d = std::f32::consts::PI - d;
    }
    d
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_horizontal_segment_from_mask() {
        let width = 96usize;
        let height = 64usize;
        let mut mask = vec![0u8; width * height];
        for x in 12..80 {
            mask[32 * width + x] = 255;
        }
        let config = SegmentExtractionConfig {
            vote_threshold: 8,
            max_peaks: 20,
            ..SegmentExtractionConfig::default()
        };
        let segments = extract_probabilistic_segments(&mask, width, height, &config);
        assert!(!segments.is_empty(), "segments={segments:?}");
        let lines = merge_segments_into_lines(&segments, &config);
        assert!(!lines.is_empty(), "segments={segments:?}");
        let best = &lines[0];
        assert!(angle_distance(best.theta, 0.0) < 0.05, "{best:?}");
        assert!((best.p0.y - 32.0).abs() < 2.0, "{best:?}");
        assert!((best.p1.y - 32.0).abs() < 2.0, "{best:?}");
    }
}
