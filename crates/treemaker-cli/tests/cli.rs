use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use treemaker_core::Tree;

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_treemaker")
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("workspace root")
        .to_path_buf()
}

fn fixture(name: &str) -> PathBuf {
    repo_root().join("tests/fixtures").join(name)
}

fn temp_dir(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "treemaker-cli-{name}-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).expect("temp dir");
    dir
}

fn run(args: impl IntoIterator<Item = OsString>) -> Output {
    Command::new(bin())
        .args(args)
        .output()
        .expect("run treemaker cli")
}

fn assert_success(output: &Output) {
    assert!(
        output.status.success(),
        "status: {:?}\nstdout:\n{}\nstderr:\n{}",
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn help_version_and_datadir_are_accepted() {
    let help = run([OsString::from("--help")]);
    assert_success(&help);
    assert!(String::from_utf8_lossy(&help.stdout).contains("Headless Rust port"));

    let version = run([OsString::from("--version")]);
    assert_success(&version);
    assert!(String::from_utf8_lossy(&version.stdout).contains("TreeMaker"));

    let inspect = run([
        OsString::from("--datadir"),
        OsString::from("/tmp"),
        OsString::from("inspect"),
        fixture("tmModelTester_1.tmd5").into_os_string(),
        OsString::from("--format"),
        OsString::from("json"),
    ]);
    assert_success(&inspect);
}

#[test]
fn inspect_and_check_emit_json_summaries() {
    let inspect = run([
        OsString::from("inspect"),
        fixture("tmModelTester_1.tmd5").into_os_string(),
        OsString::from("--format"),
        OsString::from("json"),
    ]);
    assert_success(&inspect);
    let summary: Value = serde_json::from_slice(&inspect.stdout).expect("inspect json");
    assert_eq!(summary["nodes"], 4);
    assert_eq!(summary["edges"], 3);
    assert_eq!(summary["is_feasible"], true);

    let check = run([
        OsString::from("check"),
        fixture("tmModelTester_2.tmd5").into_os_string(),
        OsString::from("--format"),
        OsString::from("json"),
    ]);
    assert_eq!(check.status.code(), Some(2));
    let summary: Value = serde_json::from_slice(&check.stdout).expect("check json");
    assert_eq!(summary["is_feasible"], false);

    let details = run([
        OsString::from("check"),
        fixture("tmModelTester_1.tmd5").into_os_string(),
        OsString::from("--details"),
        OsString::from("--format"),
        OsString::from("json"),
    ]);
    assert_success(&details);
    let report: Value = serde_json::from_slice(&details.stdout).expect("check details json");
    assert_eq!(report["status"], "polys_not_valid");
}

#[test]
fn optimize_build_cp_and_export_v4_write_parseable_files() {
    let dir = temp_dir("write-commands");
    let optimized = dir.join("optimized.tmd5");
    let built = dir.join("built.tmd5");
    let exported = dir.join("exported.tmd4");

    let optimize = run([
        OsString::from("optimize"),
        fixture("tmModelTester_1.tmd5").into_os_string(),
        OsString::from("--kind"),
        OsString::from("scale"),
        OsString::from("--out"),
        optimized.clone().into_os_string(),
    ]);
    assert_success(&optimize);
    let optimized_tree =
        Tree::from_tmd_str(&fs::read_to_string(&optimized).expect("optimized output")).unwrap();
    assert!(optimized_tree.is_feasible());
    assert!((optimized_tree.scale - 0.517637).abs() < 1.0e-4);

    let build_cp = run([
        OsString::from("build-cp"),
        fixture("tmModelTester_1.tmd5").into_os_string(),
        OsString::from("--out"),
        built.clone().into_os_string(),
    ]);
    assert_success(&build_cp);
    let built_tree =
        Tree::from_tmd_str(&fs::read_to_string(&built).expect("built output")).unwrap();
    let summary = built_tree.summary();
    assert_eq!(summary.vertices, 4);
    assert_eq!(summary.creases, 6);
    assert_eq!(summary.facets, 3);

    let export_v4 = run([
        OsString::from("export-v4"),
        built.into_os_string(),
        OsString::from("--out"),
        exported.clone().into_os_string(),
    ]);
    assert_success(&export_v4);
    let exported_tree =
        Tree::from_tmd_str(&fs::read_to_string(&exported).expect("exported output")).unwrap();
    assert_eq!(exported_tree.source_version, "4.0");
}

#[test]
fn flatfold_solves_fold_fixture_as_json() {
    let output = run([
        OsString::from("flatfold"),
        repo_root()
            .join("tests/fixtures/flat-folder/kabuto.fold")
            .into_os_string(),
        OsString::from("--limit"),
        OsString::from("1"),
        OsString::from("--format"),
        OsString::from("json"),
    ]);
    assert_success(&output);
    let report: Value = serde_json::from_slice(&output.stdout).expect("flatfold json");
    assert_eq!(report["constraints"]["variables"], 117);
    assert_eq!(report["component_sizes"], serde_json::json!([81, 18, 18]));
    assert_eq!(report["solution_counts"], serde_json::json!([1, 1, 1]));
    assert_eq!(report["states"], "1");
    assert_eq!(
        report["face_orders"].as_array().expect("face orders").len(),
        117
    );
}

#[test]
fn run_fixtures_reports_all_checked_in_fixtures() {
    let output = run([
        OsString::from("run-fixtures"),
        OsString::from("--dir"),
        repo_root().join("tests/fixtures").into_os_string(),
    ]);
    assert_success(&output);
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("tmModelTester_5.tmd5"));
    assert!(stdout.contains("parsed 8 fixture(s)"));
}

#[test]
fn corpus_reports_recursive_fixtures_and_max_files() {
    let output = run([
        OsString::from("corpus"),
        repo_root().join("tests/fixtures").into_os_string(),
        OsString::from("--format"),
        OsString::from("json"),
    ]);
    assert_success(&output);
    let report: Value = serde_json::from_slice(&output.stdout).expect("corpus json");
    assert_eq!(report["scanned_files"], 12);
    assert_eq!(report["unique_files"], 12);
    assert_eq!(report["duplicates"], 0);
    assert_eq!(report["parsed"], 12);
    assert_eq!(report["roundtripped"], 12);
    assert_eq!(report["failed"], 0);

    let text = run([
        OsString::from("corpus"),
        repo_root().join("tests/fixtures").into_os_string(),
        OsString::from("--max-files"),
        OsString::from("2"),
    ]);
    assert_success(&text);
    let stdout = String::from_utf8_lossy(&text.stdout);
    assert!(stdout.contains("scanned=2"));
    assert!(stdout.contains("failed=0"));
}

#[test]
fn corpus_dedupes_by_sha256() {
    let dir = temp_dir("corpus-duplicates");
    fs::copy(fixture("tmModelTester_1.tmd5"), dir.join("a.tmd5")).expect("copy a");
    fs::copy(fixture("tmModelTester_1.tmd5"), dir.join("b.tmd5")).expect("copy b");

    let output = run([
        OsString::from("corpus"),
        dir.into_os_string(),
        OsString::from("--format"),
        OsString::from("json"),
    ]);
    assert_success(&output);
    let report: Value = serde_json::from_slice(&output.stdout).expect("corpus json");
    assert_eq!(report["scanned_files"], 2);
    assert_eq!(report["unique_files"], 1);
    assert_eq!(report["duplicates"], 1);
    assert_eq!(report["parsed"], 1);
    assert_eq!(report["failed"], 0);
}
