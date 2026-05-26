use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use oristudio_cp_detect::decode::{
    DecodeConfig, StageCarrier, StageHoughSegment, StageLine, decode_stage_snapshot_from_line_mask,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Deserialize)]
struct OracleManifest {
    #[allow(dead_code)]
    schema: String,
    #[serde(default)]
    detector_checkpoint_id: Option<String>,
    config: OracleConfig,
    fixtures: Vec<OracleFixture>,
}

#[derive(Debug, Deserialize)]
struct OracleConfig {
    image_size: u32,
    threshold: f32,
}

#[derive(Debug, Deserialize)]
struct OracleFixture {
    id: String,
    #[serde(default)]
    profile: Option<String>,
    line_mask_pgm_path: String,
    raw_segments_path: String,
    #[serde(default)]
    raw_lines_path: Option<String>,
    carriers_path: String,
    #[allow(dead_code)]
    fold_path: String,
    #[allow(dead_code)]
    report_path: String,
}

#[derive(Debug, Deserialize)]
struct PythonCarrier {
    #[allow(dead_code)]
    line: PythonLine,
    p0: Vec<f64>,
    p1: Vec<f64>,
    #[allow(dead_code)]
    t_min: f64,
    #[allow(dead_code)]
    t_max: f64,
    #[allow(dead_code)]
    direction: Vec<f64>,
}

#[derive(Debug, Deserialize)]
struct PythonLine {
    #[allow(dead_code)]
    p0: Vec<f64>,
    #[allow(dead_code)]
    p1: Vec<f64>,
    #[allow(dead_code)]
    theta: f64,
    #[allow(dead_code)]
    rho: f64,
    #[allow(dead_code)]
    support: f64,
    #[allow(dead_code)]
    votes: Option<usize>,
}

#[derive(Debug, Serialize)]
struct Report {
    schema: &'static str,
    oracle_manifest: String,
    detector_checkpoint_id: Option<String>,
    config: ReportConfig,
    aggregate: Aggregate,
    fixtures: Vec<FixtureReport>,
}

#[derive(Debug, Serialize)]
struct ReportConfig {
    image_size: u32,
    threshold: f32,
    carrier_tolerance_px: f64,
}

#[derive(Debug, Default, Serialize)]
struct Aggregate {
    fixture_count: usize,
    raw_segment_exact_ordered_matches: usize,
    raw_line_ordered_geometry_matches: usize,
    carrier_ordered_geometry_matches: usize,
    first_divergence_counts: BTreeMap<String, usize>,
}

#[derive(Debug, Serialize)]
struct FixtureReport {
    id: String,
    profile: Option<String>,
    first_divergence: String,
    stages: StageReports,
}

#[derive(Debug, Serialize)]
struct StageReports {
    raw_segments: RawSegmentStageReport,
    raw_lines: LineStageReport,
    carriers: CarrierStageReport,
    final_fold: NotImplementedStageReport,
}

#[derive(Debug, Serialize)]
struct RawSegmentStageReport {
    implemented: bool,
    python_count: usize,
    rust_count: usize,
    exact_ordered: bool,
    exact_unordered: bool,
    first_difference: Option<Value>,
}

#[derive(Debug, Serialize)]
struct CarrierStageReport {
    implemented: bool,
    python_count: usize,
    rust_count: usize,
    count_equal: bool,
    ordered_geometry_match: bool,
    max_endpoint_delta_px: Option<f64>,
    mean_endpoint_delta_px: Option<f64>,
    first_difference: Option<Value>,
}

#[derive(Debug, Serialize)]
struct LineStageReport {
    implemented: bool,
    python_count: usize,
    rust_count: usize,
    count_equal: bool,
    ordered_geometry_match: bool,
    max_endpoint_delta_px: Option<f64>,
    mean_endpoint_delta_px: Option<f64>,
    first_difference: Option<Value>,
}

#[derive(Debug, Serialize)]
struct NotImplementedStageReport {
    implemented: bool,
    python_count: Option<usize>,
    reason: String,
}

#[derive(Debug)]
struct Args {
    manifest: PathBuf,
    out: Option<PathBuf>,
    carrier_tolerance_px: f64,
    allow_mismatch: bool,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse()?;
    let manifest_path = args.manifest;
    let manifest_root = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let manifest: OracleManifest = serde_json::from_str(&fs::read_to_string(&manifest_path)?)?;
    let mut fixture_reports = Vec::new();

    for fixture in &manifest.fixtures {
        let (_, _, line_mask) =
            read_pgm(&resolve_path(manifest_root, &fixture.line_mask_pgm_path))?;
        let snapshot = decode_stage_snapshot_from_line_mask(
            &line_mask,
            manifest.config.image_size,
            DecodeConfig {
                image_size: manifest.config.image_size,
                threshold: manifest.config.threshold,
                ..DecodeConfig::default()
            },
        )?;
        let python_segments =
            read_raw_segments(&resolve_path(manifest_root, &fixture.raw_segments_path))?;
        let python_raw_lines = fixture
            .raw_lines_path
            .as_ref()
            .map(|path| read_python_raw_lines(&resolve_path(manifest_root, path)))
            .transpose()?;
        let python_carriers =
            read_python_carriers(&resolve_path(manifest_root, &fixture.carriers_path))?;

        fixture_reports.push(compare_fixture(
            fixture,
            python_segments,
            python_raw_lines.unwrap_or_default(),
            python_carriers,
            snapshot.raw_segments,
            snapshot.raw_lines,
            snapshot.carriers,
            args.carrier_tolerance_px,
        ));
    }

    let aggregate = aggregate(&fixture_reports);
    let report = Report {
        schema: "oristudio/cp-detect-python-oracle-replay/v1",
        oracle_manifest: manifest_path.display().to_string(),
        detector_checkpoint_id: manifest.detector_checkpoint_id,
        config: ReportConfig {
            image_size: manifest.config.image_size,
            threshold: manifest.config.threshold,
            carrier_tolerance_px: args.carrier_tolerance_px,
        },
        aggregate,
        fixtures: fixture_reports,
    };

    if let Some(out) = args.out {
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&out, serde_json::to_string_pretty(&report)? + "\n")?;
        println!("wrote {}", out.display());
    }
    println!("{}", serde_json::to_string_pretty(&report.aggregate)?);
    if !args.allow_mismatch && !report.aggregate.first_divergence_counts.is_empty() {
        return Err("Rust detector replay diverged from Python oracle".into());
    }
    Ok(())
}

fn compare_fixture(
    fixture: &OracleFixture,
    python_segments: Vec<StageHoughSegment>,
    python_raw_lines: Vec<PythonLine>,
    python_carriers: Vec<PythonCarrier>,
    rust_segments: Vec<StageHoughSegment>,
    rust_raw_lines: Vec<StageLine>,
    rust_carriers: Vec<StageCarrier>,
    carrier_tolerance_px: f64,
) -> FixtureReport {
    let raw_segment_report = compare_raw_segments(&python_segments, &rust_segments);
    let raw_lines_report =
        compare_raw_lines(&python_raw_lines, &rust_raw_lines, carrier_tolerance_px);
    let carrier_report = compare_carriers(&python_carriers, &rust_carriers, carrier_tolerance_px);
    let final_fold_report = NotImplementedStageReport {
        implemented: false,
        python_count: None,
        reason: "Replay currently compares decoder evidence stages only; final FOLD parity requires dense tensor replay in a later checkpoint.".to_owned(),
    };
    let first_divergence = if !raw_segment_report.exact_ordered {
        "raw_segments"
    } else if !raw_lines_report.ordered_geometry_match {
        "raw_lines"
    } else if !carrier_report.ordered_geometry_match {
        "carriers"
    } else {
        "none"
    }
    .to_owned();

    FixtureReport {
        id: fixture.id.clone(),
        profile: fixture.profile.clone(),
        first_divergence,
        stages: StageReports {
            raw_segments: raw_segment_report,
            raw_lines: raw_lines_report,
            carriers: carrier_report,
            final_fold: final_fold_report,
        },
    }
}

fn compare_raw_lines(
    python: &[PythonLine],
    rust: &[StageLine],
    tolerance_px: f64,
) -> LineStageReport {
    let mut deltas = Vec::new();
    let paired = python.len().min(rust.len());
    let mut first_difference = None;
    for index in 0..paired {
        let delta = line_endpoint_delta(&python[index], &rust[index]);
        deltas.push(delta);
        if delta > tolerance_px && first_difference.is_none() {
            first_difference = Some(json!({
                "index": index,
                "endpoint_delta_px": delta,
                "python": {
                    "p0": &python[index].p0,
                    "p1": &python[index].p1,
                    "theta": python[index].theta,
                    "rho": python[index].rho,
                    "support": python[index].support,
                    "votes": python[index].votes,
                },
                "rust": {
                    "p0": rust[index].p0,
                    "p1": rust[index].p1,
                    "theta": rust[index].theta,
                    "rho": rust[index].rho,
                    "support": rust[index].support,
                    "votes": rust[index].votes,
                },
            }));
        }
    }
    if python.len() != rust.len() && first_difference.is_none() {
        first_difference = Some(json!({
            "index": paired,
            "python": python.get(paired).map(|line| json!({
                "p0": &line.p0,
                "p1": &line.p1,
                "theta": line.theta,
                "rho": line.rho,
                "support": line.support,
                "votes": line.votes,
            })),
            "rust": rust.get(paired).map(|line| json!({
                "p0": line.p0,
                "p1": line.p1,
                "theta": line.theta,
                "rho": line.rho,
                "support": line.support,
                "votes": line.votes,
            })),
        }));
    }
    let max_endpoint_delta_px = deltas.iter().copied().reduce(f64::max);
    let mean_endpoint_delta_px = if deltas.is_empty() {
        None
    } else {
        Some(deltas.iter().sum::<f64>() / deltas.len() as f64)
    };
    let ordered_geometry_match =
        python.len() == rust.len() && deltas.iter().all(|delta| *delta <= tolerance_px);
    LineStageReport {
        implemented: true,
        python_count: python.len(),
        rust_count: rust.len(),
        count_equal: python.len() == rust.len(),
        ordered_geometry_match,
        max_endpoint_delta_px,
        mean_endpoint_delta_px,
        first_difference,
    }
}

fn compare_raw_segments(
    python: &[StageHoughSegment],
    rust: &[StageHoughSegment],
) -> RawSegmentStageReport {
    let exact_ordered = python == rust;
    let mut python_sorted = python.to_vec();
    python_sorted.sort();
    let mut rust_sorted = rust.to_vec();
    rust_sorted.sort();
    RawSegmentStageReport {
        implemented: true,
        python_count: python.len(),
        rust_count: rust.len(),
        exact_ordered,
        exact_unordered: python_sorted == rust_sorted,
        first_difference: first_segment_difference(python, rust),
    }
}

fn compare_carriers(
    python: &[PythonCarrier],
    rust: &[StageCarrier],
    tolerance_px: f64,
) -> CarrierStageReport {
    let mut deltas = Vec::new();
    let paired = python.len().min(rust.len());
    let mut first_difference = None;
    for index in 0..paired {
        let delta = carrier_endpoint_delta(&python[index], &rust[index]);
        deltas.push(delta);
        if delta > tolerance_px && first_difference.is_none() {
            first_difference = Some(json!({
                "index": index,
                "endpoint_delta_px": delta,
                "python": {
                    "p0": &python[index].p0,
                    "p1": &python[index].p1,
                },
                "rust": {
                    "p0": rust[index].p0,
                    "p1": rust[index].p1,
                },
            }));
        }
    }
    if python.len() != rust.len() && first_difference.is_none() {
        first_difference = Some(json!({
            "index": paired,
            "python": python.get(paired).map(|carrier| json!({
                "p0": &carrier.p0,
                "p1": &carrier.p1,
            })),
            "rust": rust.get(paired).map(|carrier| json!({
                "p0": carrier.p0,
                "p1": carrier.p1,
            })),
        }));
    }
    let max_endpoint_delta_px = deltas.iter().copied().reduce(f64::max);
    let mean_endpoint_delta_px = if deltas.is_empty() {
        None
    } else {
        Some(deltas.iter().sum::<f64>() / deltas.len() as f64)
    };
    let ordered_geometry_match =
        python.len() == rust.len() && deltas.iter().all(|delta| *delta <= tolerance_px);
    CarrierStageReport {
        implemented: true,
        python_count: python.len(),
        rust_count: rust.len(),
        count_equal: python.len() == rust.len(),
        ordered_geometry_match,
        max_endpoint_delta_px,
        mean_endpoint_delta_px,
        first_difference,
    }
}

fn aggregate(fixtures: &[FixtureReport]) -> Aggregate {
    let mut aggregate = Aggregate {
        fixture_count: fixtures.len(),
        ..Aggregate::default()
    };
    for fixture in fixtures {
        if fixture.stages.raw_segments.exact_ordered {
            aggregate.raw_segment_exact_ordered_matches += 1;
        }
        if fixture.stages.raw_lines.ordered_geometry_match {
            aggregate.raw_line_ordered_geometry_matches += 1;
        }
        if fixture.stages.carriers.ordered_geometry_match {
            aggregate.carrier_ordered_geometry_matches += 1;
        }
        if fixture.first_divergence != "none" {
            *aggregate
                .first_divergence_counts
                .entry(fixture.first_divergence.clone())
                .or_insert(0) += 1;
        }
    }
    aggregate
}

impl Args {
    fn parse() -> Result<Self, Box<dyn std::error::Error>> {
        let mut manifest = None;
        let mut out = None;
        let mut carrier_tolerance_px = 1.0;
        let mut allow_mismatch = false;
        let mut iter = env::args().skip(1);
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--manifest" => {
                    manifest = Some(PathBuf::from(required_value(&mut iter, "--manifest")?))
                }
                "--out" => out = Some(PathBuf::from(required_value(&mut iter, "--out")?)),
                "--carrier-tolerance-px" => {
                    carrier_tolerance_px =
                        required_value(&mut iter, "--carrier-tolerance-px")?.parse()?;
                }
                "--allow-mismatch" => allow_mismatch = true,
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
            carrier_tolerance_px,
            allow_mismatch,
        })
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
        "compare_python_detector_oracle --manifest PATH [--out PATH] \
         [--carrier-tolerance-px 1.0] [--allow-mismatch]"
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

fn read_raw_segments(path: &Path) -> Result<Vec<StageHoughSegment>, Box<dyn std::error::Error>> {
    let rows: Vec<[f64; 4]> = serde_json::from_str(&fs::read_to_string(path)?)?;
    Ok(rows
        .into_iter()
        .map(|row| StageHoughSegment {
            x1: row[0].round() as i32,
            y1: row[1].round() as i32,
            x2: row[2].round() as i32,
            y2: row[3].round() as i32,
        })
        .collect())
}

fn read_python_raw_lines(path: &Path) -> Result<Vec<PythonLine>, Box<dyn std::error::Error>> {
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn read_python_carriers(path: &Path) -> Result<Vec<PythonCarrier>, Box<dyn std::error::Error>> {
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
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

fn first_segment_difference(
    python: &[StageHoughSegment],
    rust: &[StageHoughSegment],
) -> Option<Value> {
    let paired = python.len().min(rust.len());
    for index in 0..paired {
        if python[index] != rust[index] {
            return Some(json!({
                "index": index,
                "python": python[index],
                "rust": rust[index],
            }));
        }
    }
    if python.len() == rust.len() {
        None
    } else {
        Some(json!({
            "index": paired,
            "python": python.get(paired),
            "rust": rust.get(paired),
        }))
    }
}

fn carrier_endpoint_delta(python: &PythonCarrier, rust: &StageCarrier) -> f64 {
    let same = point_distance(&python.p0, rust.p0) + point_distance(&python.p1, rust.p1);
    let swapped = point_distance(&python.p0, rust.p1) + point_distance(&python.p1, rust.p0);
    same.min(swapped) / 2.0
}

fn line_endpoint_delta(python: &PythonLine, rust: &StageLine) -> f64 {
    let same = point_distance(&python.p0, rust.p0) + point_distance(&python.p1, rust.p1);
    let swapped = point_distance(&python.p0, rust.p1) + point_distance(&python.p1, rust.p0);
    same.min(swapped) / 2.0
}

fn point_distance(left: &[f64], right: [f32; 2]) -> f64 {
    if left.len() < 2 {
        return f64::INFINITY;
    }
    let dx = left[0] - f64::from(right[0]);
    let dy = left[1] - f64::from(right[1]);
    (dx * dx + dy * dy).sqrt()
}
