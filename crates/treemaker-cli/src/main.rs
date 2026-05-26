mod cp_exactize;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use treemaker_core::{CPStatus, Tree, TreeError, TreeSummary};
use treemaker_flatfold::{ConstraintSummary, SolutionLimit, SolveOptions, solve_flat_fold};
use treemaker_fold::FoldDocument;
use walkdir::WalkDir;

#[derive(Parser)]
#[command(
    name = "TreeMaker",
    version,
    about = "Headless Rust port of the TreeMaker 5.0.1 model engine"
)]
struct Cli {
    #[arg(short = 'd', long = "datadir", global = true)]
    datadir: Option<PathBuf>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Inspect {
        file: PathBuf,
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    Check {
        file: PathBuf,
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
        #[arg(long)]
        details: bool,
    },
    Optimize {
        file: PathBuf,
        #[arg(long, value_enum)]
        kind: OptimizeKind,
        #[arg(long)]
        out: PathBuf,
    },
    BuildCp {
        file: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    ExportV4 {
        file: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    Flatfold {
        file: PathBuf,
        #[arg(long, default_value = "10")]
        limit: String,
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
    },
    CpExactizeOsf {
        file: PathBuf,
        #[arg(long)]
        out_osf: Option<PathBuf>,
        #[arg(long)]
        out_fold: Option<PathBuf>,
        #[arg(long)]
        report: Option<PathBuf>,
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
        #[arg(long, default_value_t = 1.25)]
        endpoint_tolerance: f64,
        #[arg(long, default_value_t = 1.5)]
        angle_tolerance_degrees: f64,
        #[arg(long, default_value_t = 2.5)]
        rho_tolerance: f64,
        #[arg(long)]
        run_fix12: bool,
    },
    RunFixtures {
        #[arg(long)]
        dir: Option<PathBuf>,
    },
    Corpus {
        dir: PathBuf,
        #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
        format: OutputFormat,
        #[arg(long)]
        oracle: Option<PathBuf>,
        #[arg(long)]
        max_files: Option<usize>,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum OutputFormat {
    Text,
    Json,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum OptimizeKind {
    Scale,
    Edge,
    Strain,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Inspect { file, format } => {
            let tree = read_tree(&file)?;
            print_value(format, &tree.summary())?;
        }
        Command::Check {
            file,
            format,
            details,
        } => {
            let tree = read_tree(&file)?;
            if details {
                print_value(format, &tree.cp_status_report())?;
            } else {
                print_value(format, &tree.summary())?;
            }
            if !tree.is_feasible() {
                std::process::exit(2);
            }
        }
        Command::Optimize { file, kind, out } => {
            let mut tree = read_tree(&file)?;
            match kind {
                OptimizeKind::Scale => tree.optimize_scale(),
                OptimizeKind::Edge => tree.optimize_edges(),
                OptimizeKind::Strain => tree.optimize_strain(),
            }
            .map_err(anyhow_from_tree_error)?;
            fs::write(&out, tree.to_tmd5_string())
                .with_context(|| format!("failed to write {}", out.display()))?;
        }
        Command::BuildCp { file, out } => {
            let mut tree = read_tree(&file)?;
            tree.build_polys_and_crease_pattern()
                .map_err(anyhow_from_tree_error)?;
            fs::write(&out, tree.to_tmd5_string())
                .with_context(|| format!("failed to write {}", out.display()))?;
        }
        Command::ExportV4 { file, out } => {
            let tree = read_tree(&file)?;
            fs::write(&out, tree.export_v4_string())
                .with_context(|| format!("failed to write {}", out.display()))?;
        }
        Command::Flatfold {
            file,
            limit,
            format,
        } => {
            let document = read_fold(&file)?;
            let solved = solve_flat_fold(
                &document,
                SolveOptions {
                    solution_limit: parse_solution_limit(&limit)?,
                    ..SolveOptions::default()
                },
            )
            .with_context(|| format!("failed to solve flat fold {}", file.display()))?;
            print_value(format, &FlatfoldReport::from_result(&file, solved))?;
        }
        Command::CpExactizeOsf {
            file,
            out_osf,
            out_fold,
            report,
            format,
            endpoint_tolerance,
            angle_tolerance_degrees,
            rho_tolerance,
            run_fix12,
        } => {
            let output = cp_exactize::run(cp_exactize::ExactizeCommand {
                file,
                out_osf,
                out_fold,
                report,
                endpoint_tolerance,
                angle_tolerance_degrees,
                rho_tolerance,
                run_fix12,
            })?;
            print_value(format, &output)?;
        }
        Command::RunFixtures { dir } => {
            let dir = dir.unwrap_or_else(|| PathBuf::from("tests/fixtures"));
            run_fixtures(&dir)?;
        }
        Command::Corpus {
            dir,
            format,
            oracle,
            max_files,
        } => {
            let report = run_corpus(&dir, oracle.as_deref(), max_files)?;
            print_corpus_report(format, &report)?;
            if report.failed > 0 || report.oracle_mismatches > 0 {
                std::process::exit(2);
            }
        }
    }
    Ok(())
}

fn read_tree(path: &Path) -> Result<Tree> {
    let text =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    Tree::from_tmd_str(&text).map_err(anyhow_from_tree_error)
}

fn read_fold(path: &Path) -> Result<FoldDocument> {
    let text =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("failed to parse {}", path.display()))
}

fn parse_solution_limit(raw: &str) -> Result<SolutionLimit> {
    if raw == "all" {
        return Ok(SolutionLimit::All);
    }
    let count = raw
        .parse::<usize>()
        .with_context(|| format!("flatfold limit must be a positive integer or all, got {raw}"))?;
    if count == 0 {
        anyhow::bail!("flatfold limit must be positive");
    }
    Ok(SolutionLimit::Count(count))
}

fn print_value<T: serde::Serialize + std::fmt::Debug>(
    format: OutputFormat,
    value: &T,
) -> Result<()> {
    match format {
        OutputFormat::Text => println!("{value:#?}"),
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(value)?),
    }
    Ok(())
}

#[derive(Debug, Serialize)]
struct FlatfoldReport {
    path: String,
    constraints: ConstraintSummary,
    component_sizes: Vec<usize>,
    solution_counts: Vec<usize>,
    states: String,
    face_orders: Vec<[i64; 3]>,
}

impl FlatfoldReport {
    fn from_result(path: &Path, result: treemaker_flatfold::SolveResult) -> Self {
        Self {
            path: path.display().to_string(),
            constraints: result.constraints,
            component_sizes: result.component_sizes,
            solution_counts: result.solution_counts,
            states: result.states,
            face_orders: result.face_orders,
        }
    }
}

fn run_fixtures(dir: &Path) -> Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .with_context(|| format!("failed to read {}", dir.display()))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.path());
    let mut count = 0usize;
    for entry in entries {
        let path = entry.path();
        let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
            continue;
        };
        if !matches!(ext, "tmd" | "tmd4" | "tmd5") {
            continue;
        }
        let tree = read_tree(&path)?;
        let summary = tree.summary();
        println!(
            "{}: nodes={}, edges={}, paths={}, conditions={}, feasible={}",
            path.display(),
            summary.nodes,
            summary.edges,
            summary.paths,
            summary.conditions,
            summary.is_feasible
        );
        count += 1;
    }
    println!("parsed {count} fixture(s)");
    Ok(())
}

#[derive(Debug, Serialize)]
struct CorpusReport {
    root: String,
    scanned_files: usize,
    unique_files: usize,
    duplicates: usize,
    parsed: usize,
    roundtripped: usize,
    failed: usize,
    oracle_checked: usize,
    oracle_mismatches: usize,
    files: Vec<CorpusFileReport>,
}

#[derive(Debug, Serialize)]
struct CorpusFileReport {
    path: String,
    sha256: String,
    status: String,
    duplicate_of: Option<String>,
    summary: Option<TreeSummary>,
    error_code: Option<String>,
    error_message: Option<String>,
    oracle_mismatches: Vec<String>,
}

fn run_corpus(dir: &Path, oracle: Option<&Path>, max_files: Option<usize>) -> Result<CorpusReport> {
    let mut paths = corpus_paths(dir)?;
    if let Some(max_files) = max_files {
        paths.truncate(max_files);
    }

    let mut report = CorpusReport {
        root: dir.display().to_string(),
        scanned_files: paths.len(),
        unique_files: 0,
        duplicates: 0,
        parsed: 0,
        roundtripped: 0,
        failed: 0,
        oracle_checked: 0,
        oracle_mismatches: 0,
        files: Vec::new(),
    };
    let mut seen_hashes = HashMap::<String, String>::new();

    for path in paths {
        let path_text = path.display().to_string();
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) => {
                report.failed += 1;
                report.files.push(CorpusFileReport {
                    path: path_text,
                    sha256: String::new(),
                    status: "read_error".to_string(),
                    duplicate_of: None,
                    summary: None,
                    error_code: Some("read".to_string()),
                    error_message: Some(error.to_string()),
                    oracle_mismatches: Vec::new(),
                });
                continue;
            }
        };
        let sha256 = sha256_hex(&bytes);
        if let Some(first_path) = seen_hashes.get(&sha256) {
            report.duplicates += 1;
            report.files.push(CorpusFileReport {
                path: path_text,
                sha256,
                status: "duplicate".to_string(),
                duplicate_of: Some(first_path.clone()),
                summary: None,
                error_code: None,
                error_message: None,
                oracle_mismatches: Vec::new(),
            });
            continue;
        }
        seen_hashes.insert(sha256.clone(), path_text.clone());
        report.unique_files += 1;

        let text = match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(error) => {
                report.failed += 1;
                report.files.push(CorpusFileReport {
                    path: path_text,
                    sha256,
                    status: "parse_error".to_string(),
                    duplicate_of: None,
                    summary: None,
                    error_code: Some("parse".to_string()),
                    error_message: Some(error.to_string()),
                    oracle_mismatches: Vec::new(),
                });
                continue;
            }
        };

        let tree = match Tree::from_tmd_str(&text) {
            Ok(tree) => tree,
            Err(error) => {
                report.failed += 1;
                report.files.push(error_file_report(
                    path_text,
                    sha256,
                    "parse_error",
                    Some(error),
                ));
                continue;
            }
        };
        report.parsed += 1;

        let summary = tree.summary();
        let serialized = tree.to_tmd5_string();
        let roundtrip = match Tree::from_tmd_str(&serialized) {
            Ok(tree) => tree,
            Err(error) => {
                report.failed += 1;
                report.files.push(error_file_report(
                    path_text,
                    sha256,
                    "roundtrip_error",
                    Some(error),
                ));
                continue;
            }
        };
        let roundtrip_mismatches =
            summary_mismatches(&summary, &roundtrip.summary(), 1.0e-9, "roundtrip");
        if !roundtrip_mismatches.is_empty() {
            report.failed += 1;
            report.files.push(CorpusFileReport {
                path: path_text,
                sha256,
                status: "roundtrip_error".to_string(),
                duplicate_of: None,
                summary: Some(summary),
                error_code: Some("roundtrip".to_string()),
                error_message: Some(roundtrip_mismatches.join("; ")),
                oracle_mismatches: Vec::new(),
            });
            continue;
        }
        report.roundtripped += 1;

        let mut oracle_mismatches = Vec::new();
        let mut status = "ok";
        let mut error_code = None;
        let mut error_message = None;
        if let Some(oracle) = oracle {
            match oracle_summary(oracle, &path) {
                Ok(record) => {
                    report.oracle_checked += 1;
                    oracle_mismatches = compare_oracle_summary(&summary, &record);
                    if !oracle_mismatches.is_empty() {
                        report.oracle_mismatches += 1;
                        report.failed += 1;
                        status = "oracle_mismatch";
                        error_code = Some("oracle_mismatch".to_string());
                        error_message = Some(oracle_mismatches.join("; "));
                    }
                }
                Err(error) => {
                    report.failed += 1;
                    status = "oracle_error";
                    error_code = Some("oracle".to_string());
                    error_message = Some(error.to_string());
                }
            }
        }

        report.files.push(CorpusFileReport {
            path: path_text,
            sha256,
            status: status.to_string(),
            duplicate_of: None,
            summary: Some(summary),
            error_code,
            error_message,
            oracle_mismatches,
        });
    }

    Ok(report)
}

fn corpus_paths(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    for entry in WalkDir::new(dir).follow_links(false) {
        let entry = entry.with_context(|| format!("failed to walk {}", dir.display()))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.into_path();
        if is_treemaker_file(&path) {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}

fn is_treemaker_file(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
        return false;
    };
    matches!(&ext.to_ascii_lowercase()[..], "tmd" | "tmd4" | "tmd5")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{digest:x}")
}

fn error_file_report(
    path: String,
    sha256: String,
    status: &str,
    error: Option<TreeError>,
) -> CorpusFileReport {
    CorpusFileReport {
        path,
        sha256,
        status: status.to_string(),
        duplicate_of: None,
        summary: None,
        error_code: error.as_ref().map(|error| error.code().to_string()),
        error_message: error.map(|error| error.to_string()),
        oracle_mismatches: Vec::new(),
    }
}

fn oracle_summary(oracle: &Path, file: &Path) -> Result<serde_json::Value> {
    let output = std::process::Command::new(oracle)
        .args(["summary", &file.to_string_lossy()])
        .output()
        .with_context(|| format!("failed to run {}", oracle.display()))?;
    if !output.status.success() {
        anyhow::bail!(
            "oracle failed for {}\nstdout:\n{}\nstderr:\n{}",
            file.display(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    serde_json::from_slice(&output.stdout)
        .with_context(|| format!("failed to parse oracle JSON for {}", file.display()))
}

fn summary_mismatches(
    actual: &TreeSummary,
    expected: &TreeSummary,
    float_tol: f64,
    label: &str,
) -> Vec<String> {
    let mut mismatches = Vec::new();
    compare_float(
        &mut mismatches,
        label,
        "paper_width",
        actual.paper_width,
        expected.paper_width,
        float_tol,
    );
    compare_float(
        &mut mismatches,
        label,
        "paper_height",
        actual.paper_height,
        expected.paper_height,
        float_tol,
    );
    compare_float(
        &mut mismatches,
        label,
        "scale",
        actual.scale,
        expected.scale,
        float_tol,
    );
    compare_value(
        &mut mismatches,
        label,
        "has_symmetry",
        actual.has_symmetry,
        expected.has_symmetry,
    );
    compare_value(
        &mut mismatches,
        label,
        "is_feasible",
        actual.is_feasible,
        expected.is_feasible,
    );
    compare_value(
        &mut mismatches,
        label,
        "cp_status",
        &actual.cp_status,
        &expected.cp_status,
    );
    compare_summary_counts(&mut mismatches, label, actual, expected);
    compare_value(
        &mut mismatches,
        label,
        "conditions_by_tag",
        &actual.conditions_by_tag,
        &expected.conditions_by_tag,
    );
    mismatches
}

fn compare_summary_counts(
    mismatches: &mut Vec<String>,
    label: &str,
    actual: &TreeSummary,
    expected: &TreeSummary,
) {
    compare_value(mismatches, label, "nodes", actual.nodes, expected.nodes);
    compare_value(mismatches, label, "edges", actual.edges, expected.edges);
    compare_value(mismatches, label, "paths", actual.paths, expected.paths);
    compare_value(mismatches, label, "polys", actual.polys, expected.polys);
    compare_value(
        mismatches,
        label,
        "vertices",
        actual.vertices,
        expected.vertices,
    );
    compare_value(
        mismatches,
        label,
        "creases",
        actual.creases,
        expected.creases,
    );
    compare_value(mismatches, label, "facets", actual.facets, expected.facets);
    compare_value(
        mismatches,
        label,
        "conditions",
        actual.conditions,
        expected.conditions,
    );
    compare_value(
        mismatches,
        label,
        "leaf_nodes",
        actual.leaf_nodes,
        expected.leaf_nodes,
    );
    compare_value(
        mismatches,
        label,
        "leaf_paths",
        actual.leaf_paths,
        expected.leaf_paths,
    );
    compare_value(
        mismatches,
        label,
        "feasible_paths",
        actual.feasible_paths,
        expected.feasible_paths,
    );
    compare_value(
        mismatches,
        label,
        "active_paths",
        actual.active_paths,
        expected.active_paths,
    );
    compare_value(
        mismatches,
        label,
        "border_nodes",
        actual.border_nodes,
        expected.border_nodes,
    );
    compare_value(
        mismatches,
        label,
        "border_paths",
        actual.border_paths,
        expected.border_paths,
    );
    compare_value(
        mismatches,
        label,
        "polygon_nodes",
        actual.polygon_nodes,
        expected.polygon_nodes,
    );
    compare_value(
        mismatches,
        label,
        "polygon_paths",
        actual.polygon_paths,
        expected.polygon_paths,
    );
    compare_value(
        mismatches,
        label,
        "pinned_nodes",
        actual.pinned_nodes,
        expected.pinned_nodes,
    );
    compare_value(
        mismatches,
        label,
        "pinned_edges",
        actual.pinned_edges,
        expected.pinned_edges,
    );
    compare_value(
        mismatches,
        label,
        "conditioned_nodes",
        actual.conditioned_nodes,
        expected.conditioned_nodes,
    );
    compare_value(
        mismatches,
        label,
        "conditioned_edges",
        actual.conditioned_edges,
        expected.conditioned_edges,
    );
    compare_value(
        mismatches,
        label,
        "conditioned_paths",
        actual.conditioned_paths,
        expected.conditioned_paths,
    );
}

fn compare_oracle_summary(summary: &TreeSummary, record: &serde_json::Value) -> Vec<String> {
    let mut mismatches = Vec::new();
    compare_oracle_float(&mut mismatches, "paper_width", summary.paper_width, record);
    compare_oracle_float(
        &mut mismatches,
        "paper_height",
        summary.paper_height,
        record,
    );
    compare_oracle_float(&mut mismatches, "scale", summary.scale, record);
    compare_oracle_bool(
        &mut mismatches,
        "has_symmetry",
        summary.has_symmetry,
        record,
    );
    compare_oracle_bool(&mut mismatches, "is_feasible", summary.is_feasible, record);
    compare_oracle_string(
        &mut mismatches,
        "cp_status",
        cp_status_oracle_name(&summary.cp_status),
        record,
    );
    for (key, actual) in [
        ("nodes", summary.nodes),
        ("edges", summary.edges),
        ("paths", summary.paths),
        ("polys", summary.polys),
        ("vertices", summary.vertices),
        ("creases", summary.creases),
        ("facets", summary.facets),
        ("conditions", summary.conditions),
        ("leaf_nodes", summary.leaf_nodes),
        ("leaf_paths", summary.leaf_paths),
        ("feasible_paths", summary.feasible_paths),
        ("active_paths", summary.active_paths),
        ("border_nodes", summary.border_nodes),
        ("border_paths", summary.border_paths),
        ("polygon_nodes", summary.polygon_nodes),
        ("polygon_paths", summary.polygon_paths),
        ("pinned_nodes", summary.pinned_nodes),
        ("pinned_edges", summary.pinned_edges),
        ("conditioned_nodes", summary.conditioned_nodes),
        ("conditioned_edges", summary.conditioned_edges),
        ("conditioned_paths", summary.conditioned_paths),
    ] {
        compare_oracle_usize(&mut mismatches, key, actual, record);
    }
    mismatches
}

fn compare_oracle_float(
    mismatches: &mut Vec<String>,
    key: &str,
    actual: f64,
    record: &serde_json::Value,
) {
    match record[key].as_f64() {
        Some(expected) if (actual - expected).abs() <= 1.0e-7 => {}
        Some(expected) => {
            mismatches.push(format!("{key}: rust {actual:.10}, oracle {expected:.10}"))
        }
        None => mismatches.push(format!("{key}: missing oracle value")),
    }
}

fn compare_oracle_bool(
    mismatches: &mut Vec<String>,
    key: &str,
    actual: bool,
    record: &serde_json::Value,
) {
    match record[key].as_bool() {
        Some(expected) if actual == expected => {}
        Some(expected) => mismatches.push(format!("{key}: rust {actual}, oracle {expected}")),
        None => mismatches.push(format!("{key}: missing oracle value")),
    }
}

fn compare_oracle_usize(
    mismatches: &mut Vec<String>,
    key: &str,
    actual: usize,
    record: &serde_json::Value,
) {
    match record[key].as_u64() {
        Some(expected) if actual as u64 == expected => {}
        Some(expected) => mismatches.push(format!("{key}: rust {actual}, oracle {expected}")),
        None => mismatches.push(format!("{key}: missing oracle value")),
    }
}

fn compare_oracle_string(
    mismatches: &mut Vec<String>,
    key: &str,
    actual: &str,
    record: &serde_json::Value,
) {
    match record[key].as_str() {
        Some(expected) if actual == expected => {}
        Some(expected) => mismatches.push(format!("{key}: rust {actual}, oracle {expected}")),
        None => mismatches.push(format!("{key}: missing oracle value")),
    }
}

fn compare_float(
    mismatches: &mut Vec<String>,
    label: &str,
    key: &str,
    actual: f64,
    expected: f64,
    tol: f64,
) {
    if (actual - expected).abs() > tol {
        mismatches.push(format!(
            "{label}.{key}: actual {actual:.10}, expected {expected:.10}"
        ));
    }
}

fn compare_value<T>(mismatches: &mut Vec<String>, label: &str, key: &str, actual: T, expected: T)
where
    T: PartialEq + std::fmt::Debug,
{
    if actual != expected {
        mismatches.push(format!(
            "{label}.{key}: actual {actual:?}, expected {expected:?}"
        ));
    }
}

fn cp_status_oracle_name(status: &CPStatus) -> &'static str {
    match status {
        CPStatus::HasFullCp => "HAS_FULL_CP",
        CPStatus::EdgesTooShort => "EDGES_TOO_SHORT",
        CPStatus::PolysNotValid => "POLYS_NOT_VALID",
        CPStatus::PolysNotFilled => "POLYS_NOT_FILLED",
        CPStatus::PolysMultipleIbps => "POLYS_MULTIPLE_IBPS",
        CPStatus::VerticesLackDepth => "VERTICES_LACK_DEPTH",
        CPStatus::FacetsNotValid => "FACETS_NOT_VALID",
        CPStatus::NotLocalRootConnectable => "NOT_LOCAL_ROOT_CONNECTABLE",
    }
}

fn print_corpus_report(format: OutputFormat, report: &CorpusReport) -> Result<()> {
    match format {
        OutputFormat::Json => print_value(format, report),
        OutputFormat::Text => {
            println!("corpus {}", report.root);
            println!(
                "scanned={}, unique={}, duplicates={}, parsed={}, roundtripped={}, failed={}",
                report.scanned_files,
                report.unique_files,
                report.duplicates,
                report.parsed,
                report.roundtripped,
                report.failed
            );
            if report.oracle_checked > 0 {
                println!(
                    "oracle_checked={}, oracle_mismatches={}",
                    report.oracle_checked, report.oracle_mismatches
                );
            }
            for file in report
                .files
                .iter()
                .filter(|file| !matches!(file.status.as_str(), "ok" | "duplicate"))
            {
                println!(
                    "{}: {}{}",
                    file.path,
                    file.status,
                    file.error_message
                        .as_ref()
                        .map(|message| format!(" ({message})"))
                        .unwrap_or_default()
                );
            }
            Ok(())
        }
    }
}

fn anyhow_from_tree_error(error: TreeError) -> anyhow::Error {
    anyhow::anyhow!("{error}")
}
