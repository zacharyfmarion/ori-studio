use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use oristudio_cp_detect::opencv_hough_lines_p::{HoughLinesPConfig, hough_lines_p_opencv_cpu};
use oristudio_cp_detect::segments::{SegmentExtractionConfig, extract_probabilistic_segments};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct OracleManifest {
    config: OracleConfig,
    fixtures: Vec<OracleFixture>,
}

#[derive(Debug, Deserialize)]
struct OracleConfig {
    rho: f32,
    theta: f32,
    threshold: i32,
    min_line_length: f64,
    max_line_gap: f64,
}

#[derive(Debug, Deserialize)]
struct OracleFixture {
    id: String,
    mask_path: String,
    oracle_segments_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
struct Segment {
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
}

#[derive(Debug, Serialize)]
struct Report {
    schema: &'static str,
    candidate: Candidate,
    mode: CompareMode,
    config: ReportConfig,
    aggregate: Aggregate,
    fixtures: Vec<FixtureReport>,
}

#[derive(Debug, Serialize)]
struct ReportConfig {
    rho: f32,
    theta: f32,
    threshold: i32,
    min_line_length: f64,
    max_line_gap: f64,
}

#[derive(Debug, Default, Serialize)]
struct Aggregate {
    fixture_count: usize,
    exact_ordered_matches: usize,
    exact_unordered_matches: usize,
    geometry_equivalent_matches: usize,
}

#[derive(Debug, Serialize)]
struct FixtureReport {
    id: String,
    oracle_count: usize,
    candidate_count: usize,
    exact_ordered: bool,
    exact_unordered: bool,
    geometry_equivalent: bool,
    first_difference: Option<FirstDifference>,
}

#[derive(Debug, Serialize)]
struct FirstDifference {
    index: usize,
    oracle: Option<Segment>,
    candidate: Option<Segment>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse()?;
    let manifest_path = args.manifest;
    let manifest_root = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let manifest: OracleManifest = serde_json::from_str(&fs::read_to_string(&manifest_path)?)?;
    let mut reports = Vec::new();
    for fixture in &manifest.fixtures {
        let oracle = read_segments(&resolve_path(manifest_root, &fixture.oracle_segments_path))?;
        let candidate = match args.candidate {
            Candidate::CustomSpike => {
                let (width, height, mask) =
                    read_pgm(&resolve_path(manifest_root, &fixture.mask_path))?;
                custom_spike_segments(&mask, width, height)
            }
            Candidate::OpenCvPort => {
                let (width, height, mask) =
                    read_pgm(&resolve_path(manifest_root, &fixture.mask_path))?;
                opencv_port_segments(&mask, width, height, &manifest.config)?
            }
        };
        let exact_ordered = candidate == oracle;
        let exact_unordered = sorted_segments(&candidate) == sorted_segments(&oracle);
        let geometry_equivalent = geometry_equivalent(&candidate, &oracle, args.geometry_tolerance);
        reports.push(FixtureReport {
            id: fixture.id.clone(),
            oracle_count: oracle.len(),
            candidate_count: candidate.len(),
            exact_ordered,
            exact_unordered,
            geometry_equivalent,
            first_difference: first_difference(&oracle, &candidate),
        });
    }
    let aggregate = aggregate(&reports);
    let report = Report {
        schema: "oristudio/cp-detect-houghlinesp-compare/v1",
        candidate: args.candidate,
        mode: args.mode,
        config: ReportConfig {
            rho: manifest.config.rho,
            theta: manifest.config.theta,
            threshold: manifest.config.threshold,
            min_line_length: manifest.config.min_line_length,
            max_line_gap: manifest.config.max_line_gap,
        },
        aggregate,
        fixtures: reports,
    };
    if let Some(out) = args.out {
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&out, serde_json::to_string_pretty(&report)? + "\n")?;
        println!("wrote {}", out.display());
    }
    println!("{}", serde_json::to_string_pretty(&report.aggregate)?);
    if !args.allow_mismatch && !report_passes(args.mode, &report.aggregate) {
        return Err(format!("candidate {:?} did not match oracle", args.candidate).into());
    }
    Ok(())
}

#[derive(Debug)]
struct Args {
    manifest: PathBuf,
    out: Option<PathBuf>,
    candidate: Candidate,
    mode: CompareMode,
    geometry_tolerance: i32,
    allow_mismatch: bool,
}

impl Args {
    fn parse() -> Result<Self, Box<dyn std::error::Error>> {
        let mut manifest = None;
        let mut out = None;
        let mut candidate = Candidate::CustomSpike;
        let mut mode = CompareMode::ExactOrdered;
        let mut geometry_tolerance = 1;
        let mut allow_mismatch = false;
        let mut iter = env::args().skip(1);
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--manifest" => {
                    manifest = Some(PathBuf::from(required_value(&mut iter, "--manifest")?))
                }
                "--out" => out = Some(PathBuf::from(required_value(&mut iter, "--out")?)),
                "--candidate" => {
                    candidate = required_value(&mut iter, "--candidate")?.parse()?;
                }
                "--mode" => {
                    mode = required_value(&mut iter, "--mode")?.parse()?;
                }
                "--geometry-tolerance" => {
                    geometry_tolerance =
                        required_value(&mut iter, "--geometry-tolerance")?.parse()?;
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
            candidate,
            mode,
            geometry_tolerance,
            allow_mismatch,
        })
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Candidate {
    CustomSpike,
    OpenCvPort,
}

impl std::str::FromStr for Candidate {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "custom-spike" => Ok(Self::CustomSpike),
            "opencv-port" => Ok(Self::OpenCvPort),
            _ => Err(format!("unknown candidate: {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum CompareMode {
    ExactOrdered,
    ExactUnordered,
    GeometryEquivalent,
}

impl std::str::FromStr for CompareMode {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "exact-ordered" => Ok(Self::ExactOrdered),
            "exact-unordered" => Ok(Self::ExactUnordered),
            "geometry-equivalent" => Ok(Self::GeometryEquivalent),
            _ => Err(format!("unknown compare mode: {value}")),
        }
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
        "compare_houghlinesp_oracle --manifest PATH [--out PATH] \
         [--candidate custom-spike|opencv-port] [--mode exact-ordered] \
         [--geometry-tolerance 1] [--allow-mismatch]"
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

fn read_segments(path: &Path) -> Result<Vec<Segment>, Box<dyn std::error::Error>> {
    let rows: Vec<[i32; 4]> = serde_json::from_str(&fs::read_to_string(path)?)?;
    Ok(rows
        .into_iter()
        .map(|row| Segment {
            x1: row[0],
            y1: row[1],
            x2: row[2],
            y2: row[3],
        })
        .collect())
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

fn custom_spike_segments(mask: &[u8], width: usize, height: usize) -> Vec<Segment> {
    let config = SegmentExtractionConfig::default();
    extract_probabilistic_segments(mask, width, height, &config)
        .into_iter()
        .map(|segment| Segment {
            x1: segment.p0.x.round() as i32,
            y1: segment.p0.y.round() as i32,
            x2: segment.p1.x.round() as i32,
            y2: segment.p1.y.round() as i32,
        })
        .collect()
}

fn opencv_port_segments(
    mask: &[u8],
    width: usize,
    height: usize,
    config: &OracleConfig,
) -> Result<Vec<Segment>, Box<dyn std::error::Error>> {
    let segments = hough_lines_p_opencv_cpu(
        mask,
        width,
        height,
        &HoughLinesPConfig {
            rho: config.rho,
            theta: config.theta,
            threshold: config.threshold,
            min_line_length: config.min_line_length,
            max_line_gap: config.max_line_gap,
            lines_max: i32::MAX,
        },
    )?;
    Ok(segments
        .into_iter()
        .map(|segment| Segment {
            x1: segment.x1,
            y1: segment.y1,
            x2: segment.x2,
            y2: segment.y2,
        })
        .collect())
}

fn sorted_segments(segments: &[Segment]) -> Vec<Segment> {
    let mut out = segments.to_vec();
    out.sort();
    out
}

fn geometry_equivalent(candidate: &[Segment], oracle: &[Segment], tolerance: i32) -> bool {
    if candidate.len() != oracle.len() {
        return false;
    }
    let mut used = vec![false; oracle.len()];
    'candidate: for segment in candidate {
        for (idx, oracle_segment) in oracle.iter().enumerate() {
            if !used[idx] && endpoint_cost(segment, oracle_segment) <= tolerance * 4 {
                used[idx] = true;
                continue 'candidate;
            }
        }
        return false;
    }
    true
}

fn endpoint_cost(left: &Segment, right: &Segment) -> i32 {
    let same = point_cost((left.x1, left.y1), (right.x1, right.y1))
        + point_cost((left.x2, left.y2), (right.x2, right.y2));
    let swapped = point_cost((left.x1, left.y1), (right.x2, right.y2))
        + point_cost((left.x2, left.y2), (right.x1, right.y1));
    same.min(swapped)
}

fn point_cost(left: (i32, i32), right: (i32, i32)) -> i32 {
    (left.0 - right.0).abs() + (left.1 - right.1).abs()
}

fn first_difference(oracle: &[Segment], candidate: &[Segment]) -> Option<FirstDifference> {
    let len = oracle.len().max(candidate.len());
    (0..len).find_map(|index| {
        let oracle_segment = oracle.get(index).copied();
        let candidate_segment = candidate.get(index).copied();
        (oracle_segment != candidate_segment).then_some(FirstDifference {
            index,
            oracle: oracle_segment,
            candidate: candidate_segment,
        })
    })
}

fn aggregate(reports: &[FixtureReport]) -> Aggregate {
    let mut aggregate = Aggregate {
        fixture_count: reports.len(),
        ..Aggregate::default()
    };
    for report in reports {
        if report.exact_ordered {
            aggregate.exact_ordered_matches += 1;
        }
        if report.exact_unordered {
            aggregate.exact_unordered_matches += 1;
        }
        if report.geometry_equivalent {
            aggregate.geometry_equivalent_matches += 1;
        }
    }
    aggregate
}

fn report_passes(mode: CompareMode, aggregate: &Aggregate) -> bool {
    match mode {
        CompareMode::ExactOrdered => aggregate.exact_ordered_matches == aggregate.fixture_count,
        CompareMode::ExactUnordered => aggregate.exact_unordered_matches == aggregate.fixture_count,
        CompareMode::GeometryEquivalent => {
            aggregate.geometry_equivalent_matches == aggregate.fixture_count
        }
    }
}
