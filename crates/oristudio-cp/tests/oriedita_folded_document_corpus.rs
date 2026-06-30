use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{ActiveState, LineSegment};
use oristudio_cp::io::{cp, fold, orh, ori};
use oristudio_cp::model::{CreasePatternModel, GridMetadata};
use serde_json::Value;
use treemaker_fold::FoldDocument;

#[test]
fn folded_document_corpus_preserves_supported_oriedita_data() {
    let mut roots = vec![repo_root().join("tests/fixtures/oriedita")];
    if let Some(path) = env::var_os("ORIEDITA_FOLDED_CORPUS_DIR") {
        roots.push(resolve_corpus_root(PathBuf::from(path)));
    }

    let mut report = CorpusReport::default();
    let oracles = CorpusOracles::from_env();
    for root in roots {
        if !root.exists() {
            if env::var_os("ORIEDITA_FOLDED_CORPUS_DIR").is_some() {
                panic!(
                    "Oriedita folded-document corpus root does not exist: {}",
                    root.display()
                );
            }
            continue;
        }
        for path in corpus_paths(&root) {
            validate_path(&path, &mut report, &oracles);
        }
    }

    assert!(
        report.scanned > 0,
        "no .cp/.fold/.ori/.orh fixtures found for Oriedita folded-document corpus"
    );
    eprintln!("{}", report.summary());
    assert!(
        report.failures.is_empty(),
        "Oriedita folded-document corpus failures:\n{}",
        report.failures.join("\n")
    );
}

#[derive(Default)]
struct CorpusReport {
    scanned: usize,
    failures: Vec<String>,
    cp: FormatReport,
    fold: FormatReport,
    ori: FormatReport,
    orh: FormatReport,
    fold_total_frames: usize,
    folded_form_frames: usize,
    fold_files_with_frames: usize,
    fold_max_frame_depth: usize,
    fold_frame_extra_keys: usize,
    fold_oriedita_extension_keys: usize,
    fold_frames_with_parent: usize,
    fold_frames_with_inherit: usize,
    fold_frames_with_face_orders: usize,
    ori_metadata_keys: usize,
    ori_camera_models: usize,
    ori_canvas_models: usize,
    ori_folded_figure_models: usize,
    ori_application_models: usize,
    ori_unknown_metadata_keys: usize,
    ori_preserved_only_metadata_keys: usize,
    ori_editor_model_nested_keys: usize,
    ori_missing_versions_opened: usize,
    ori_unknown_versions_opened: usize,
    orh_files_with_folded_colors: usize,
    orh_folded_color_sections: usize,
    oracle_checked: usize,
    oracle_mismatches: usize,
    oracle_unavailable: usize,
    oracle_unsupported: usize,
}

#[derive(Default)]
struct FormatReport {
    scanned: usize,
    imported: usize,
    exported: usize,
    roundtripped: usize,
    failed: usize,
}

impl CorpusReport {
    fn summary(&self) -> String {
        format!(
            "Oriedita folded-document corpus: scanned={} imported={} exported={} roundtripped={} failures={}\n  {}\n  {}\n  {}\n  {}\n  fold_frames total={} foldedForm={} files_with_frames={} max_depth={} extra_keys={} oriedita_extension_keys={} frame_parent={} frame_inherit={} faceOrders={}\n  ori_metadata keys={} camera={} canvas={} foldedFigure={} application={} unknown={} preserved_only={} nested_model_keys={} missing_versions_opened={} unknown_versions_opened={}\n  orh folded_color_files={} folded_color_sections={}\n  oracle checked={} mismatches={} unavailable={} unsupported={}",
            self.scanned,
            self.cp.imported + self.fold.imported + self.ori.imported + self.orh.imported,
            self.cp.exported + self.fold.exported + self.ori.exported + self.orh.exported,
            self.cp.roundtripped
                + self.fold.roundtripped
                + self.ori.roundtripped
                + self.orh.roundtripped,
            self.failures.len(),
            self.cp.summary("cp"),
            self.fold.summary("fold"),
            self.ori.summary("ori"),
            self.orh.summary("orh"),
            self.fold_total_frames,
            self.folded_form_frames,
            self.fold_files_with_frames,
            self.fold_max_frame_depth,
            self.fold_frame_extra_keys,
            self.fold_oriedita_extension_keys,
            self.fold_frames_with_parent,
            self.fold_frames_with_inherit,
            self.fold_frames_with_face_orders,
            self.ori_metadata_keys,
            self.ori_camera_models,
            self.ori_canvas_models,
            self.ori_folded_figure_models,
            self.ori_application_models,
            self.ori_unknown_metadata_keys,
            self.ori_preserved_only_metadata_keys,
            self.ori_editor_model_nested_keys,
            self.ori_missing_versions_opened,
            self.ori_unknown_versions_opened,
            self.orh_files_with_folded_colors,
            self.orh_folded_color_sections,
            self.oracle_checked,
            self.oracle_mismatches,
            self.oracle_unavailable,
            self.oracle_unsupported,
        )
    }

    fn record_failure(&mut self, format: CorpusFormat, path: &Path, message: String) {
        self.format_mut(format).failed += 1;
        self.failures
            .push(format!("{} {}: {message}", format.label(), path.display()));
    }

    fn format_mut(&mut self, format: CorpusFormat) -> &mut FormatReport {
        match format {
            CorpusFormat::Cp => &mut self.cp,
            CorpusFormat::Fold => &mut self.fold,
            CorpusFormat::Ori => &mut self.ori,
            CorpusFormat::Orh => &mut self.orh,
        }
    }
}

impl FormatReport {
    fn summary(&self, label: &str) -> String {
        format!(
            "{label}: scanned={} imported={} exported={} roundtripped={} failed={}",
            self.scanned, self.imported, self.exported, self.roundtripped, self.failed
        )
    }
}

#[derive(Default)]
struct CorpusOracles {
    native_io: Option<PathBuf>,
    legacy_io: Option<PathBuf>,
}

impl CorpusOracles {
    fn from_env() -> Self {
        Self {
            native_io: env::var_os("ORIEDITA_NATIVE_IO_ORACLE")
                .map(PathBuf::from)
                .map(resolve_corpus_root),
            legacy_io: env::var_os("ORIEDITA_IO_ORACLE")
                .map(PathBuf::from)
                .map(resolve_corpus_root),
        }
    }
}

#[derive(Clone, Copy)]
enum CorpusFormat {
    Cp,
    Fold,
    Ori,
    Orh,
}

impl CorpusFormat {
    fn from_path(path: &Path) -> Option<Self> {
        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())?
            .to_ascii_lowercase();
        match extension.as_str() {
            "cp" => Some(Self::Cp),
            "fold" => Some(Self::Fold),
            "ori" => Some(Self::Ori),
            "orh" => Some(Self::Orh),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Cp => ".cp",
            Self::Fold => ".fold",
            Self::Ori => ".ori",
            Self::Orh => ".orh",
        }
    }
}

fn validate_path(path: &Path, report: &mut CorpusReport, oracles: &CorpusOracles) {
    let Some(format) = CorpusFormat::from_path(path) else {
        return;
    };
    report.scanned += 1;
    report.format_mut(format).scanned += 1;
    let result = match format {
        CorpusFormat::Cp => validate_cp(path, report),
        CorpusFormat::Fold => validate_fold(path, report, oracles),
        CorpusFormat::Ori => validate_ori(path, report, oracles),
        CorpusFormat::Orh => validate_orh(path, report, oracles),
    };
    if let Err(message) = result {
        report.record_failure(format, path, message);
    }
}

fn validate_cp(path: &Path, report: &mut CorpusReport) -> std::result::Result<(), String> {
    let text = read_text(path)?;
    let model = cp::import_cp_str(&text).map_err(|err| format!("import failed: {err}"))?;
    report.cp.imported += 1;
    let exported = cp::export_cp_string(&model);
    report.cp.exported += 1;
    let roundtrip =
        cp::import_cp_str(&exported).map_err(|err| format!("roundtrip import failed: {err}"))?;
    if model.canonical(1.0e-9) != roundtrip.canonical(1.0e-9) {
        return Err("canonical roundtrip mismatch".to_string());
    }
    report.cp.roundtripped += 1;
    Ok(())
}

fn validate_fold(
    path: &Path,
    report: &mut CorpusReport,
    oracles: &CorpusOracles,
) -> std::result::Result<(), String> {
    let text = read_text(path)?;
    let document =
        fold::import_fold_file_json(&text).map_err(|err| format!("import failed: {err}"))?;
    report.fold.imported += 1;
    if !document.file_frames.is_empty() {
        report.fold_files_with_frames += 1;
    }
    record_fold_summary(&document, report);
    if document.file_frames.is_empty() {
        let editable = fold::import_fold_file_document(&document)
            .map_err(|err| format!("editable FOLD import failed: {err}"))?;
        check_native_oracle(
            path,
            "fold-import-summary",
            &model_summary(
                Some("_"),
                &editable.crease_pattern,
                Some(&editable.crease_pattern.grid),
            ),
            report,
            oracles,
        )?;
    } else {
        report.oracle_unsupported += 1;
    }

    let exported =
        fold::export_fold_file_json(&document).map_err(|err| format!("export failed: {err}"))?;
    report.fold.exported += 1;
    let roundtrip = fold::import_fold_file_json(&exported)
        .map_err(|err| format!("roundtrip import failed: {err}"))?;
    if document != roundtrip {
        return Err("frame-preserving roundtrip mismatch".to_string());
    }
    report.fold.roundtripped += 1;
    Ok(())
}

fn validate_ori(
    path: &Path,
    report: &mut CorpusReport,
    oracles: &CorpusOracles,
) -> std::result::Result<(), String> {
    let text = read_text(path)?;
    match ori_version_status(&text)? {
        OriVersionStatus::Known => {}
        OriVersionStatus::Missing => report.ori_missing_versions_opened += 1,
        OriVersionStatus::Unknown => report.ori_unknown_versions_opened += 1,
    }
    let document = ori::import_ori_json_with_unknown_version(&text, true)
        .map_err(|err| format!("import failed: {err}"))?;
    report.ori.imported += 1;
    record_ori_metadata(&document, report);
    check_native_oracle(
        path,
        "ori-import-summary",
        &document_summary(&document, Some(&document.crease_pattern.grid)),
        report,
        oracles,
    )?;

    let exported =
        ori::export_ori_json(&document).map_err(|err| format!("export failed: {err}"))?;
    report.ori.exported += 1;
    let roundtrip =
        ori::import_ori_json(&exported).map_err(|err| format!("roundtrip import failed: {err}"))?;
    if document.canonical(1.0e-9) != roundtrip.canonical(1.0e-9) {
        return Err("canonical roundtrip mismatch".to_string());
    }
    if document.metadata != roundtrip.metadata {
        return Err("metadata roundtrip mismatch".to_string());
    }
    report.ori.roundtripped += 1;
    Ok(())
}

fn validate_orh(
    path: &Path,
    report: &mut CorpusReport,
    oracles: &CorpusOracles,
) -> std::result::Result<(), String> {
    let bytes = fs::read(path).map_err(|err| err.to_string())?;
    let document = orh::import_orh_bytes(&bytes).map_err(|err| format!("import failed: {err}"))?;
    report.orh.imported += 1;
    let folded_color_sections = orh_folded_color_sections(&document.metadata);
    if folded_color_sections > 0 {
        report.orh_files_with_folded_colors += 1;
        report.orh_folded_color_sections += folded_color_sections;
    }
    check_legacy_oracle(
        path,
        "orh-import-summary",
        &document_summary(&document, Some(&document.crease_pattern.grid)),
        report,
        oracles,
    )?;

    let exported = orh::export_orh_string(&document);
    report.orh.exported += 1;
    let roundtrip =
        orh::import_orh_str(&exported).map_err(|err| format!("roundtrip import failed: {err}"))?;
    if document.metadata != roundtrip.metadata {
        return Err("folded metadata roundtrip mismatch".to_string());
    }
    report.orh.roundtripped += 1;
    Ok(())
}

fn record_fold_summary(document: &FoldDocument, report: &mut CorpusReport) {
    let summary = summarize_fold_document(document, 1);
    report.fold_total_frames += summary.total_frames;
    report.folded_form_frames += summary.folded_form_frames;
    report.fold_max_frame_depth = report.fold_max_frame_depth.max(summary.max_depth);
    report.fold_frame_extra_keys += summary.extra_keys;
    report.fold_oriedita_extension_keys += summary.oriedita_extension_keys;
    report.fold_frames_with_parent += summary.frames_with_parent;
    report.fold_frames_with_inherit += summary.frames_with_inherit;
    report.fold_frames_with_face_orders += summary.frames_with_face_orders;
}

fn check_native_oracle(
    path: &Path,
    command: &str,
    rust_summary: &str,
    report: &mut CorpusReport,
    oracles: &CorpusOracles,
) -> std::result::Result<(), String> {
    let Some(oracle) = &oracles.native_io else {
        report.oracle_unavailable += 1;
        return Ok(());
    };
    check_oracle(path, oracle, command, rust_summary, report)
}

fn check_legacy_oracle(
    path: &Path,
    command: &str,
    rust_summary: &str,
    report: &mut CorpusReport,
    oracles: &CorpusOracles,
) -> std::result::Result<(), String> {
    let Some(oracle) = &oracles.legacy_io else {
        report.oracle_unavailable += 1;
        return Ok(());
    };
    check_oracle(path, oracle, command, rust_summary, report)
}

fn check_oracle(
    path: &Path,
    oracle: &Path,
    command: &str,
    rust_summary: &str,
    report: &mut CorpusReport,
) -> std::result::Result<(), String> {
    let path_arg = path.to_string_lossy();
    let oracle_summary = run_oracle(oracle, &[command, path_arg.as_ref()])?;
    report.oracle_checked += 1;
    if rust_summary != oracle_summary {
        report.oracle_mismatches += 1;
        return Err(format!("Oriedita oracle mismatch for {command}"));
    }
    Ok(())
}

fn run_oracle(oracle: &Path, args: &[&str]) -> std::result::Result<String, String> {
    let output = Command::new(oracle)
        .args(args)
        .output()
        .map_err(|err| format!("oracle execution failed: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "oracle exited with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    String::from_utf8(output.stdout).map_err(|err| format!("oracle stdout was not UTF-8: {err}"))
}

fn document_summary(document: &CreasePatternDocument, grid: Option<&GridMetadata>) -> String {
    model_summary(document.title.as_deref(), &document.crease_pattern, grid)
}

fn model_summary(
    title: Option<&str>,
    model: &CreasePatternModel,
    grid: Option<&GridMetadata>,
) -> String {
    let mut output = String::new();
    output.push_str(&format!("title|{}\n", title.unwrap_or_default()));
    output.push_str(&format!("lines|{}\n", model.line_segments.len()));
    for segment in &model.line_segments {
        push_segment(&mut output, "line", segment);
    }
    output.push_str(&format!("circles|{}\n", model.circles.len()));
    for circle in &model.circles {
        output.push_str(&format!(
            "circle|{}|{}|{}|{}|{}|{}|{}|{}\n",
            java_double_string(circle.x),
            java_double_string(circle.y),
            java_double_string(circle.r),
            circle.color.number(),
            circle.customized,
            circle.customized_color.red,
            circle.customized_color.green,
            circle.customized_color.blue
        ));
    }
    output.push_str(&format!("aux|{}\n", model.aux_line_segments.len()));
    for segment in &model.aux_line_segments {
        push_segment(&mut output, "auxline", segment);
    }
    if let Some(grid) = grid {
        output.push_str(&format!(
            "grid|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}\n",
            grid.interval_grid_size,
            grid.grid_size,
            java_double_string(grid.grid_xa),
            java_double_string(grid.grid_xb),
            java_double_string(grid.grid_xc),
            java_double_string(grid.grid_ya),
            java_double_string(grid.grid_yb),
            java_double_string(grid.grid_yc),
            java_double_string(grid.grid_angle),
            grid.base_state.state(),
            grid.vertical_scale_position,
            grid.horizontal_scale_position,
            grid.draw_diagonal_gridlines
        ));
    } else {
        output.push_str("grid|null\n");
    }
    output
}

fn push_segment(output: &mut String, prefix: &str, segment: &LineSegment) {
    output.push_str(&format!(
        "{prefix}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}\n",
        java_double_string(segment.a.x),
        java_double_string(segment.a.y),
        java_double_string(segment.b.x),
        java_double_string(segment.b.y),
        segment.color.number(),
        active_state_name(segment.active),
        segment.selected,
        segment.customized,
        segment.customized_color.red,
        segment.customized_color.green,
        segment.customized_color.blue
    ));
}

fn active_state_name(active: ActiveState) -> &'static str {
    match active {
        ActiveState::Inactive0 => "INACTIVE_0",
        ActiveState::ActiveA1 => "ACTIVE_A_1",
        ActiveState::ActiveB2 => "ACTIVE_B_2",
        ActiveState::ActiveBoth3 => "ACTIVE_BOTH_3",
    }
}

fn java_double_string(value: f64) -> String {
    if value.is_finite() && value.fract() == 0.0 {
        format!("{value:.1}")
    } else {
        value.to_string()
    }
}

#[derive(Default)]
struct FoldFrameSummary {
    total_frames: usize,
    folded_form_frames: usize,
    max_depth: usize,
    extra_keys: usize,
    oriedita_extension_keys: usize,
    frames_with_parent: usize,
    frames_with_inherit: usize,
    frames_with_face_orders: usize,
}

fn summarize_fold_document(document: &FoldDocument, depth: usize) -> FoldFrameSummary {
    let mut summary = FoldFrameSummary {
        total_frames: 1,
        folded_form_frames: usize::from(
            document
                .frame_classes
                .iter()
                .any(|class_name| class_name == "foldedForm"),
        ),
        max_depth: depth,
        extra_keys: document.extra.len(),
        oriedita_extension_keys: document
            .extra
            .keys()
            .filter(|key| key.starts_with("oriedita:"))
            .count(),
        frames_with_parent: usize::from(document.frame_parent.is_some()),
        frames_with_inherit: usize::from(document.frame_inherit.is_some()),
        frames_with_face_orders: usize::from(!document.face_orders.is_empty()),
    };

    for frame in &document.file_frames {
        let child = summarize_fold_document(frame, depth + 1);
        summary.total_frames += child.total_frames;
        summary.folded_form_frames += child.folded_form_frames;
        summary.max_depth = summary.max_depth.max(child.max_depth);
        summary.extra_keys += child.extra_keys;
        summary.oriedita_extension_keys += child.oriedita_extension_keys;
        summary.frames_with_parent += child.frames_with_parent;
        summary.frames_with_inherit += child.frames_with_inherit;
        summary.frames_with_face_orders += child.frames_with_face_orders;
    }

    summary
}

fn record_ori_metadata(document: &oristudio_cp::CreasePatternDocument, report: &mut CorpusReport) {
    report.ori_metadata_keys += document.metadata.len();
    for (key, value) in &document.metadata {
        let Some(field) = key.strip_prefix(ori::ORI_METADATA_PREFIX) else {
            continue;
        };
        match field {
            ori::ORI_CREASE_PATTERN_CAMERA_FIELD => {
                report.ori_camera_models += 1;
                report.ori_preserved_only_metadata_keys += 1;
                report.ori_editor_model_nested_keys += object_len(value);
            }
            ori::ORI_CANVAS_MODEL_FIELD => {
                report.ori_canvas_models += 1;
                report.ori_preserved_only_metadata_keys += 1;
                report.ori_editor_model_nested_keys += object_len(value);
            }
            ori::ORI_FOLDED_FIGURE_MODEL_FIELD => {
                report.ori_folded_figure_models += 1;
                report.ori_editor_model_nested_keys += object_len(value);
            }
            ori::ORI_APPLICATION_MODEL_FIELD => {
                report.ori_application_models += 1;
                report.ori_preserved_only_metadata_keys += 1;
                report.ori_editor_model_nested_keys += object_len(value);
            }
            _ => {
                report.ori_unknown_metadata_keys += 1;
                report.ori_preserved_only_metadata_keys += 1;
            }
        }
    }
}

fn object_len(value: &Value) -> usize {
    value.as_object().map_or(0, serde_json::Map::len)
}

enum OriVersionStatus {
    Known,
    Missing,
    Unknown,
}

fn ori_version_status(input: &str) -> std::result::Result<OriVersionStatus, String> {
    let value = serde_json::from_str::<Value>(input).map_err(|err| err.to_string())?;
    let object = value
        .as_object()
        .ok_or_else(|| "expected JSON object".to_string())?;
    match object.get("@version").and_then(Value::as_str) {
        Some("v1" | "v1.1") => Ok(OriVersionStatus::Known),
        Some(_) => Ok(OriVersionStatus::Unknown),
        None => Ok(OriVersionStatus::Missing),
    }
}

fn orh_folded_color_sections(metadata: &std::collections::BTreeMap<String, Value>) -> usize {
    [
        "oriedita:orh:oriagarizu_front_color",
        "oriedita:orh:oriagarizu_back_color",
        "oriedita:orh:oriagarizu_line_color",
    ]
    .iter()
    .filter(|key| metadata.contains_key(**key))
    .count()
}

fn read_text(path: &Path) -> std::result::Result<String, String> {
    fs::read_to_string(path).map_err(|err| err.to_string())
}

fn corpus_paths(root: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    collect_corpus_paths(root, &mut paths);
    paths.sort();
    paths
}

fn collect_corpus_paths(dir: &Path, paths: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).unwrap_or_else(|err| panic!("{}: {err}", dir.display())) {
        let entry = entry.unwrap_or_else(|err| panic!("{}: {err}", dir.display()));
        let path = entry.path();
        if path.is_dir() {
            collect_corpus_paths(&path, paths);
        } else if is_oriedita_document(&path) {
            paths.push(path);
        }
    }
}

fn is_oriedita_document(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return false;
    };
    matches!(
        &extension.to_ascii_lowercase()[..],
        "cp" | "fold" | "ori" | "orh"
    )
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn resolve_corpus_root(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        path
    } else {
        repo_root().join(path)
    }
}
