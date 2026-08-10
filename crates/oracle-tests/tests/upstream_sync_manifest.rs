//! Keeps `upstream-sync.json` honest.
//!
//! The manifest is the single source of truth for where each ported upstream
//! is pinned and how far a drift check has triaged it. Its `watch_paths` and
//! `port_map` are the inputs the `upstream-drift` skill reasons from, so a
//! stale entry does not fail loudly — it quietly narrows what the drift check
//! looks at, which is the same class of silent gap this whole effort exists to
//! close.
//!
//! These tests are offline. They cannot confirm `vendored_commit` matches
//! upstream; that requires the network and belongs to the drift check itself.
//! What they can confirm is that every path the manifest names still exists.

mod support;

use std::path::Path;

use serde_json::Value;
use support::repo_root;

fn manifest() -> Value {
    let path = repo_root().join("upstream-sync.json");
    let text =
        std::fs::read_to_string(&path).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|err| panic!("{}: {err}", path.display()))
}

fn upstreams(manifest: &Value) -> &serde_json::Map<String, Value> {
    manifest["upstreams"]
        .as_object()
        .expect("upstreams must be an object")
}

#[test]
fn every_upstream_declares_the_required_fields() {
    let manifest = manifest();
    for (name, entry) in upstreams(&manifest) {
        for field in [
            "repo",
            "branch",
            "vendored_commit",
            "last_checked_commit",
            "last_checked_date",
        ] {
            assert!(
                entry[field].as_str().is_some_and(|value| !value.is_empty()),
                "{name}: {field} must be a non-empty string",
            );
        }
        assert!(
            entry["watch_paths"]
                .as_array()
                .is_some_and(|paths| !paths.is_empty()),
            "{name}: watch_paths must be a non-empty array",
        );
        assert!(
            entry["port_map"].is_object(),
            "{name}: port_map must be an object",
        );
    }
}

#[test]
fn commit_fields_look_like_full_sha1s() {
    let manifest = manifest();
    for (name, entry) in upstreams(&manifest) {
        for field in ["vendored_commit", "last_checked_commit"] {
            let value = entry[field].as_str().expect("checked above");
            assert_eq!(value.len(), 40, "{name}: {field} must be a full SHA-1");
            assert!(
                value.chars().all(|c| c.is_ascii_hexdigit()),
                "{name}: {field} must be hex",
            );
        }
    }
}

#[test]
fn vendored_paths_and_watch_paths_exist() {
    let manifest = manifest();
    let root = repo_root();
    for (name, entry) in upstreams(&manifest) {
        let Some(vendored) = entry["vendored_path"].as_str() else {
            // origami-simulator is a port rather than a vendored copy, so it
            // has no tree of its own to check watch paths against.
            continue;
        };
        let vendored = root.join(vendored);
        assert!(
            vendored.is_dir(),
            "{name}: vendored_path {} does not exist",
            vendored.display(),
        );
        for watch in entry["watch_paths"].as_array().expect("checked above") {
            let watch = watch.as_str().expect("watch_paths entries are strings");
            let full = vendored.join(watch);
            assert!(
                full.exists(),
                "{name}: watch path {} does not exist in the vendored tree; \
                 a drift check would silently stop looking there",
                full.display(),
            );
        }
    }
}

#[test]
fn port_map_targets_exist_in_this_repo() {
    let manifest = manifest();
    let root = repo_root();
    for (name, entry) in upstreams(&manifest) {
        let map = entry["port_map"].as_object().expect("checked above");
        for (upstream_path, ours) in map {
            let ours = ours.as_str().expect("port_map values are strings");
            let full = root.join(ours);
            assert!(
                full.exists(),
                "{name}: port_map maps {upstream_path} to {ours}, which does \
                 not exist; the drift check would attribute changes to a file \
                 that moved",
            );
        }
    }
}

/// `packages/origami-simulator/NOTICE` records the upstream commit this port
/// was taken from, and it stays authoritative because it serves attribution,
/// not tooling. The manifest mirrors it for the drift check; this asserts the
/// mirror has not drifted.
#[test]
fn origami_simulator_pin_matches_its_notice() {
    let manifest = manifest();
    let pinned = manifest["upstreams"]["origami-simulator"]["vendored_commit"]
        .as_str()
        .expect("origami-simulator vendored_commit");
    let notice_path = repo_root().join("packages/origami-simulator/NOTICE");
    let notice = std::fs::read_to_string(&notice_path)
        .unwrap_or_else(|err| panic!("{}: {err}", notice_path.display()));
    assert!(
        notice.contains(pinned),
        "upstream-sync.json pins origami-simulator at {pinned}, which does not \
         appear in {}. NOTICE is authoritative; update the manifest to match.",
        notice_path.display(),
    );
}

#[test]
fn oracle_scripts_referenced_by_the_manifest_exist() {
    let manifest = manifest();
    let root = repo_root();
    for (name, entry) in upstreams(&manifest) {
        let Some(oracle) = entry["oracle"].as_str() else {
            continue;
        };
        assert!(
            Path::new(&root.join(oracle)).exists(),
            "{name}: oracle {oracle} does not exist",
        );
    }
}
