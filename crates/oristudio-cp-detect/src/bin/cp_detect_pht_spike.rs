use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use oristudio_cp_detect::segments::{
    LineCandidate, SegmentCandidate, SegmentExtractionConfig, SegmentPoint,
    extract_probabilistic_segments, merge_segments_into_lines,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct EvidenceManifest {
    detector_checkpoint_id: String,
    fixtures: Vec<EvidenceFixture>,
}

#[derive(Debug, Deserialize)]
struct EvidenceFixture {
    id: String,
    line_mask_pgm_path: String,
    raw_segments_path: String,
    raw_lines_path: String,
}

#[derive(Debug, Deserialize)]
struct PythonLine {
    p0: [f32; 2],
    p1: [f32; 2],
    theta: f32,
    rho: f32,
    support: f32,
    votes: u32,
}

#[derive(Debug, Serialize)]
struct Report {
    schema: &'static str,
    detector_checkpoint_id: String,
    config: SegmentExtractionConfig,
    results: Vec<FixtureResult>,
    aggregate: Metrics,
}

#[derive(Debug, Serialize)]
struct FixtureResult {
    id: String,
    python: CountSummary,
    rust: CountSummary,
    metrics: Metrics,
}

#[derive(Debug, Serialize)]
struct CountSummary {
    raw_segments: usize,
    lines: usize,
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
struct Metrics {
    fixture_count: usize,
    segment_precision: f32,
    segment_recall: f32,
    segment_f1: f32,
    line_precision: f32,
    line_recall: f32,
    line_f1: f32,
}

#[derive(Debug, Clone, Copy)]
struct SegmentLike {
    p0: SegmentPoint,
    p1: SegmentPoint,
}

#[derive(Debug, Clone, Copy)]
struct LineLike {
    theta: f32,
    rho: f32,
    t_min: f32,
    t_max: f32,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse()?;
    let config = args.extraction_config();
    let manifest_path = args.manifest;
    let manifest_root = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let manifest: EvidenceManifest = serde_json::from_str(&fs::read_to_string(&manifest_path)?)?;
    let mut results = Vec::new();
    for fixture in &manifest.fixtures {
        let mask_path = resolve_path(manifest_root, &fixture.line_mask_pgm_path);
        let (width, height, mask) = read_pgm(&mask_path)?;
        let rust_segments = extract_probabilistic_segments(&mask, width, height, &config);
        let rust_lines = merge_segments_into_lines(&rust_segments, &config);
        let python_segments =
            read_python_segments(&resolve_path(manifest_root, &fixture.raw_segments_path))?;
        let python_lines =
            read_python_lines(&resolve_path(manifest_root, &fixture.raw_lines_path))?;
        let rust_segment_likes = segments_from_rust(&rust_segments);
        let python_segment_likes = segments_from_python(&python_segments);
        let segment_matches = match_segments(
            &rust_segment_likes,
            &python_segment_likes,
            args.segment_tolerance_px,
        );
        let rust_line_likes = lines_from_rust(&rust_lines);
        let python_line_likes = lines_from_python(&python_lines);
        let line_matches = match_lines(
            &rust_line_likes,
            &python_line_likes,
            args.line_angle_tolerance_degrees.to_radians(),
            args.line_rho_tolerance_px,
            args.line_overlap_tolerance,
        );
        let metrics = Metrics {
            fixture_count: 1,
            segment_precision: precision(segment_matches, rust_segments.len()),
            segment_recall: precision(segment_matches, python_segments.len()),
            segment_f1: f1_from_match(segment_matches, rust_segments.len(), python_segments.len()),
            line_precision: precision(line_matches, rust_lines.len()),
            line_recall: precision(line_matches, python_lines.len()),
            line_f1: f1_from_match(line_matches, rust_lines.len(), python_lines.len()),
        };
        results.push(FixtureResult {
            id: fixture.id.clone(),
            python: CountSummary {
                raw_segments: python_segments.len(),
                lines: python_lines.len(),
            },
            rust: CountSummary {
                raw_segments: rust_segments.len(),
                lines: rust_lines.len(),
            },
            metrics,
        });
    }
    let aggregate = aggregate_metrics(results.iter().map(|result| result.metrics));
    let report = Report {
        schema: "oristudio/cp-detect-pht-spike/v1",
        detector_checkpoint_id: manifest.detector_checkpoint_id,
        config,
        results,
        aggregate,
    };
    if let Some(out) = args.out {
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&out, serde_json::to_string_pretty(&report)? + "\n")?;
        println!("wrote {}", out.display());
    }
    println!("{}", serde_json::to_string_pretty(&report.aggregate)?);
    Ok(())
}

#[derive(Debug)]
struct Args {
    manifest: PathBuf,
    out: Option<PathBuf>,
    extraction: SegmentExtractionConfig,
    segment_tolerance_px: f32,
    line_angle_tolerance_degrees: f32,
    line_rho_tolerance_px: f32,
    line_overlap_tolerance: f32,
}

impl Args {
    fn parse() -> Result<Self, Box<dyn std::error::Error>> {
        let mut manifest = None;
        let mut out = None;
        let mut extraction = SegmentExtractionConfig::default();
        let mut segment_tolerance_px = 12.0;
        let mut line_angle_tolerance_degrees = 3.0;
        let mut line_rho_tolerance_px = 5.0;
        let mut line_overlap_tolerance = 0.3;
        let mut iter = env::args().skip(1);
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--manifest" => {
                    manifest = Some(PathBuf::from(required_value(&mut iter, "--manifest")?))
                }
                "--out" => out = Some(PathBuf::from(required_value(&mut iter, "--out")?)),
                "--vote-threshold" => {
                    extraction.vote_threshold =
                        required_value(&mut iter, "--vote-threshold")?.parse()?;
                }
                "--max-peaks" => {
                    extraction.max_peaks = required_value(&mut iter, "--max-peaks")?.parse()?;
                }
                "--line-distance-px" => {
                    extraction.line_distance_px =
                        required_value(&mut iter, "--line-distance-px")?.parse()?;
                }
                "--min-line-length-px" => {
                    extraction.min_line_length_px =
                        required_value(&mut iter, "--min-line-length-px")?.parse()?;
                }
                "--max-line-gap-px" => {
                    extraction.max_line_gap_px =
                        required_value(&mut iter, "--max-line-gap-px")?.parse()?;
                }
                "--max-segments" => {
                    extraction.max_segments =
                        required_value(&mut iter, "--max-segments")?.parse()?;
                }
                "--line-merge-angle-degrees" => {
                    extraction.line_angle_merge_degrees =
                        required_value(&mut iter, "--line-merge-angle-degrees")?.parse()?;
                }
                "--line-merge-rho-px" => {
                    extraction.line_rho_merge_px =
                        required_value(&mut iter, "--line-merge-rho-px")?.parse()?;
                }
                "--max-line-hypotheses" => {
                    extraction.max_line_hypotheses =
                        required_value(&mut iter, "--max-line-hypotheses")?.parse()?;
                }
                "--segment-tolerance-px" => {
                    segment_tolerance_px =
                        required_value(&mut iter, "--segment-tolerance-px")?.parse()?;
                }
                "--line-angle-tolerance-degrees" => {
                    line_angle_tolerance_degrees =
                        required_value(&mut iter, "--line-angle-tolerance-degrees")?.parse()?;
                }
                "--line-rho-tolerance-px" => {
                    line_rho_tolerance_px =
                        required_value(&mut iter, "--line-rho-tolerance-px")?.parse()?;
                }
                "--line-overlap-tolerance" => {
                    line_overlap_tolerance =
                        required_value(&mut iter, "--line-overlap-tolerance")?.parse()?;
                }
                "--help" | "-h" => {
                    print_usage();
                    std::process::exit(0);
                }
                other => return Err(format!("unknown argument: {other}").into()),
            }
        }
        Ok(Self {
            manifest: manifest.ok_or("--manifest is required")?,
            out,
            extraction,
            segment_tolerance_px,
            line_angle_tolerance_degrees,
            line_rho_tolerance_px,
            line_overlap_tolerance,
        })
    }

    fn extraction_config(&self) -> SegmentExtractionConfig {
        self.extraction.clone()
    }
}

fn required_value(
    iter: &mut impl Iterator<Item = String>,
    name: &'static str,
) -> Result<String, Box<dyn std::error::Error>> {
    iter.next()
        .ok_or_else(|| format!("{name} requires a value").into())
}

fn print_usage() {
    println!(
        "cp_detect_pht_spike --manifest PATH [--out PATH] \
         [--vote-threshold 10] [--max-peaks 1600] [--line-distance-px 1.5] \
         [--min-line-length-px 6] [--max-line-gap-px 4] [--max-segments 12000] \
         [--line-merge-angle-degrees 2.5] [--line-merge-rho-px 3] \
         [--max-line-hypotheses 240] \
         [--segment-tolerance-px 12] [--line-angle-tolerance-degrees 3] \
         [--line-rho-tolerance-px 5] [--line-overlap-tolerance 0.3]"
    );
}

fn resolve_path(root: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn read_pgm(path: &Path) -> Result<(usize, usize, Vec<u8>), Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    let mut idx = 0usize;
    let magic = next_token(&bytes, &mut idx).ok_or("missing PGM magic")?;
    if magic != b"P5" {
        return Err(format!("unsupported PGM magic in {}: {:?}", path.display(), magic).into());
    }
    let width: usize =
        std::str::from_utf8(next_token(&bytes, &mut idx).ok_or("missing PGM width")?)?.parse()?;
    let height: usize =
        std::str::from_utf8(next_token(&bytes, &mut idx).ok_or("missing PGM height")?)?.parse()?;
    let max_value: usize =
        std::str::from_utf8(next_token(&bytes, &mut idx).ok_or("missing PGM max value")?)?
            .parse()?;
    if max_value != 255 {
        return Err(format!(
            "unsupported PGM max value in {}: {max_value}",
            path.display()
        )
        .into());
    }
    while idx < bytes.len() && bytes[idx].is_ascii_whitespace() {
        idx += 1;
    }
    let data = bytes[idx..].to_vec();
    if data.len() != width * height {
        return Err(format!(
            "PGM data length mismatch in {}: expected {}, got {}",
            path.display(),
            width * height,
            data.len()
        )
        .into());
    }
    Ok((width, height, data))
}

fn next_token<'a>(bytes: &'a [u8], idx: &mut usize) -> Option<&'a [u8]> {
    loop {
        while *idx < bytes.len() && bytes[*idx].is_ascii_whitespace() {
            *idx += 1;
        }
        if *idx < bytes.len() && bytes[*idx] == b'#' {
            while *idx < bytes.len() && bytes[*idx] != b'\n' {
                *idx += 1;
            }
            continue;
        }
        break;
    }
    if *idx >= bytes.len() {
        return None;
    }
    let start = *idx;
    while *idx < bytes.len() && !bytes[*idx].is_ascii_whitespace() {
        *idx += 1;
    }
    Some(&bytes[start..*idx])
}

fn read_python_segments(path: &Path) -> Result<Vec<SegmentLike>, Box<dyn std::error::Error>> {
    let rows: Vec<[f32; 4]> = serde_json::from_str(&fs::read_to_string(path)?)?;
    Ok(rows
        .into_iter()
        .map(|row| SegmentLike {
            p0: SegmentPoint {
                x: row[0],
                y: row[1],
            },
            p1: SegmentPoint {
                x: row[2],
                y: row[3],
            },
        })
        .collect())
}

fn read_python_lines(path: &Path) -> Result<Vec<PythonLine>, Box<dyn std::error::Error>> {
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn segments_from_rust(segments: &[SegmentCandidate]) -> Vec<SegmentLike> {
    segments
        .iter()
        .map(|segment| SegmentLike {
            p0: segment.p0,
            p1: segment.p1,
        })
        .collect()
}

fn segments_from_python(segments: &[SegmentLike]) -> Vec<SegmentLike> {
    segments.to_vec()
}

fn lines_from_rust(lines: &[LineCandidate]) -> Vec<LineLike> {
    lines.iter().map(line_like_from_candidate).collect()
}

fn lines_from_python(lines: &[PythonLine]) -> Vec<LineLike> {
    lines
        .iter()
        .map(|line| {
            let p0 = SegmentPoint {
                x: line.p0[0],
                y: line.p0[1],
            };
            let p1 = SegmentPoint {
                x: line.p1[0],
                y: line.p1[1],
            };
            let direction = SegmentPoint {
                x: line.theta.cos(),
                y: line.theta.sin(),
            };
            let _ = (line.support, line.votes);
            LineLike {
                theta: line.theta,
                rho: line.rho,
                t_min: dot(p0, direction).min(dot(p1, direction)),
                t_max: dot(p0, direction).max(dot(p1, direction)),
            }
        })
        .collect()
}

fn line_like_from_candidate(line: &LineCandidate) -> LineLike {
    let direction = SegmentPoint {
        x: line.theta.cos(),
        y: line.theta.sin(),
    };
    LineLike {
        theta: line.theta,
        rho: line.rho,
        t_min: dot(line.p0, direction).min(dot(line.p1, direction)),
        t_max: dot(line.p0, direction).max(dot(line.p1, direction)),
    }
}

fn match_segments(predicted: &[SegmentLike], oracle: &[SegmentLike], tolerance: f32) -> usize {
    let mut used = HashSet::new();
    let mut matches = 0usize;
    for segment in predicted {
        let mut best = None;
        for (idx, candidate) in oracle.iter().enumerate() {
            if used.contains(&idx) {
                continue;
            }
            let cost = endpoint_cost(segment, candidate);
            if cost <= tolerance * 2.0 && best.is_none_or(|(_, best_cost)| cost < best_cost) {
                best = Some((idx, cost));
            }
        }
        if let Some((idx, _)) = best {
            used.insert(idx);
            matches += 1;
        }
    }
    matches
}

fn match_lines(
    predicted: &[LineLike],
    oracle: &[LineLike],
    angle_tol: f32,
    rho_tol: f32,
    overlap_tol: f32,
) -> usize {
    let mut used = HashSet::new();
    let mut matches = 0usize;
    for line in predicted {
        let mut best = None;
        for (idx, candidate) in oracle.iter().enumerate() {
            if used.contains(&idx)
                || angle_distance(line.theta, candidate.theta) > angle_tol
                || (line.rho - candidate.rho).abs() > rho_tol
            {
                continue;
            }
            let overlap =
                interval_overlap_fraction(line.t_min, line.t_max, candidate.t_min, candidate.t_max);
            if overlap < overlap_tol {
                continue;
            }
            let cost = angle_distance(line.theta, candidate.theta)
                + (line.rho - candidate.rho).abs() / 1000.0;
            if best.is_none_or(|(_, best_cost)| cost < best_cost) {
                best = Some((idx, cost));
            }
        }
        if let Some((idx, _)) = best {
            used.insert(idx);
            matches += 1;
        }
    }
    matches
}

fn aggregate_metrics(items: impl Iterator<Item = Metrics>) -> Metrics {
    let mut count = 0usize;
    let mut aggregate = Metrics::default();
    for item in items {
        count += 1;
        aggregate.segment_precision += item.segment_precision;
        aggregate.segment_recall += item.segment_recall;
        aggregate.segment_f1 += item.segment_f1;
        aggregate.line_precision += item.line_precision;
        aggregate.line_recall += item.line_recall;
        aggregate.line_f1 += item.line_f1;
    }
    if count > 0 {
        let denom = count as f32;
        aggregate.fixture_count = count;
        aggregate.segment_precision /= denom;
        aggregate.segment_recall /= denom;
        aggregate.segment_f1 /= denom;
        aggregate.line_precision /= denom;
        aggregate.line_recall /= denom;
        aggregate.line_f1 /= denom;
    }
    aggregate
}

fn precision(matches: usize, total: usize) -> f32 {
    if total == 0 {
        1.0
    } else {
        matches as f32 / total as f32
    }
}

fn f1_from_match(matches: usize, predicted_total: usize, oracle_total: usize) -> f32 {
    let p = precision(matches, predicted_total);
    let r = precision(matches, oracle_total);
    if p + r > 0.0 {
        2.0 * p * r / (p + r)
    } else {
        0.0
    }
}

fn endpoint_cost(left: &SegmentLike, right: &SegmentLike) -> f32 {
    let same = distance(left.p0, right.p0) + distance(left.p1, right.p1);
    let swapped = distance(left.p0, right.p1) + distance(left.p1, right.p0);
    same.min(swapped)
}

fn interval_overlap_fraction(a0: f32, a1: f32, b0: f32, b1: f32) -> f32 {
    let left = a0.min(a1).max(b0.min(b1));
    let right = a0.max(a1).min(b0.max(b1));
    if right <= left {
        return 0.0;
    }
    let overlap = right - left;
    let smaller = (a1 - a0).abs().min((b1 - b0).abs()).max(1e-6);
    overlap / smaller
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
