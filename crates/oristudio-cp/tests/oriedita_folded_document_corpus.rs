use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use oristudio_cp::io::{cp, fold, orh, ori};
use treemaker_fold::FoldDocument;

#[test]
fn folded_document_corpus_preserves_supported_oriedita_data() {
    let mut roots = vec![repo_root().join("tests/fixtures/oriedita")];
    if let Some(path) = env::var_os("ORIEDITA_FOLDED_CORPUS_DIR") {
        roots.push(resolve_corpus_root(PathBuf::from(path)));
    }

    let mut report = CorpusReport::default();
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
            report.scanned += 1;
            validate_path(&path, &mut report);
        }
    }

    assert!(
        report.scanned > 0,
        "no .cp/.fold/.ori/.orh fixtures found for Oriedita folded-document corpus"
    );
    eprintln!(
        "Oriedita folded-document corpus: scanned={} cp={} fold={} ori={} orh={} folded_form_frames={} fold_files_with_frames={} ori_metadata_keys={} orh_folded_color_sections={}",
        report.scanned,
        report.cp,
        report.fold,
        report.ori,
        report.orh,
        report.folded_form_frames,
        report.fold_files_with_frames,
        report.ori_metadata_keys,
        report.orh_folded_color_sections
    );
}

#[derive(Default)]
struct CorpusReport {
    scanned: usize,
    cp: usize,
    fold: usize,
    ori: usize,
    orh: usize,
    folded_form_frames: usize,
    fold_files_with_frames: usize,
    ori_metadata_keys: usize,
    orh_folded_color_sections: usize,
}

fn validate_path(path: &Path, report: &mut CorpusReport) {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "cp" => validate_cp(path, report),
        "fold" => validate_fold(path, report),
        "ori" => validate_ori(path, report),
        "orh" => validate_orh(path, report),
        _ => {}
    }
}

fn validate_cp(path: &Path, report: &mut CorpusReport) {
    report.cp += 1;
    let text = read_text(path);
    let model = cp::import_cp_str(&text).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    let exported = cp::export_cp_string(&model);
    let roundtrip = cp::import_cp_str(&exported)
        .unwrap_or_else(|err| panic!("{} exported CP: {err}", path.display()));
    assert_eq!(
        model.canonical(1.0e-9),
        roundtrip.canonical(1.0e-9),
        "{} CP roundtrip",
        path.display()
    );
}

fn validate_fold(path: &Path, report: &mut CorpusReport) {
    report.fold += 1;
    let text = read_text(path);
    let document = fold::import_fold_file_json(&text)
        .unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    if !document.file_frames.is_empty() {
        report.fold_files_with_frames += 1;
    }
    report.folded_form_frames += count_folded_form_frames(&document);

    let exported = fold::export_fold_file_json(&document)
        .unwrap_or_else(|err| panic!("{} exported FOLD: {err}", path.display()));
    let roundtrip = fold::import_fold_file_json(&exported)
        .unwrap_or_else(|err| panic!("{} reimported FOLD: {err}", path.display()));
    assert_eq!(
        document,
        roundtrip,
        "{} FOLD frame-preserving roundtrip",
        path.display()
    );
}

fn validate_ori(path: &Path, report: &mut CorpusReport) {
    report.ori += 1;
    let text = read_text(path);
    let document = ori::import_ori_json_with_unknown_version(&text, true)
        .unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    report.ori_metadata_keys += document.metadata.len();

    let exported = ori::export_ori_json(&document)
        .unwrap_or_else(|err| panic!("{} exported ORI: {err}", path.display()));
    let roundtrip = ori::import_ori_json(&exported)
        .unwrap_or_else(|err| panic!("{} reimported ORI: {err}", path.display()));
    assert_eq!(
        document.canonical(1.0e-9),
        roundtrip.canonical(1.0e-9),
        "{} ORI roundtrip",
        path.display()
    );
    assert_eq!(
        document.metadata,
        roundtrip.metadata,
        "{} ORI metadata roundtrip",
        path.display()
    );
}

fn validate_orh(path: &Path, report: &mut CorpusReport) {
    report.orh += 1;
    let bytes = fs::read(path).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    let document =
        orh::import_orh_bytes(&bytes).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    if document
        .metadata
        .contains_key("oriedita:orh:oriagarizu_front_color")
    {
        report.orh_folded_color_sections += 1;
    }

    let exported = orh::export_orh_string(&document);
    let roundtrip = orh::import_orh_str(&exported)
        .unwrap_or_else(|err| panic!("{} reimported ORH: {err}", path.display()));
    assert_eq!(
        document.metadata,
        roundtrip.metadata,
        "{} ORH folded metadata roundtrip",
        path.display()
    );
}

fn count_folded_form_frames(document: &FoldDocument) -> usize {
    let this_frame = usize::from(
        document
            .frame_classes
            .iter()
            .any(|class_name| class_name == "foldedForm"),
    );
    this_frame
        + document
            .file_frames
            .iter()
            .map(count_folded_form_frames)
            .sum::<usize>()
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

fn read_text(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|err| panic!("{}: {err}", path.display()))
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
