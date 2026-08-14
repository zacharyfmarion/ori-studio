//! Where a fold-angle-3D fixture's crease pattern comes from.
//!
//! Most of `tests/fixtures/fold-angle-3d/` is committed. Three of the models the
//! suite was built around are **not ours to commit** — they are third-party
//! designs that were mistakenly tracked, and they now live outside the
//! repository with the rest of the non-flat corpus:
//!
//! | fixture | source |
//! | --- | --- |
//! | `penguin_freeform` | `plant/penguin_other_angles.osf`, component 0 |
//! | `penguin_disconnected` | `plant/penguin_other_angles.osf` |
//! | `rabbit_unclosed` | `plant/rabbit.osf` |
//!
//! Derive them once into the corpus and every test that names them runs again:
//!
//! ```sh
//! CORPUS=$ORISTUDIO_NON_FLAT_CORPUS_DIR
//! mkdir -p "$CORPUS/fold-angle-3d"
//! node scripts/osf-fold-projection.mjs "$CORPUS/plant/penguin_other_angles.osf" --component 0 \
//!     > "$CORPUS/fold-angle-3d/penguin_freeform.fold"
//! node scripts/osf-fold-projection.mjs "$CORPUS/plant/penguin_other_angles.osf" \
//!     > "$CORPUS/fold-angle-3d/penguin_disconnected.fold"
//! node scripts/osf-fold-projection.mjs "$CORPUS/plant/rabbit.osf" \
//!     > "$CORPUS/fold-angle-3d/rabbit_unclosed.fold"
//! ```
//!
//! # Why the skip is loud
//!
//! Without the corpus these tests check nothing, and several of them check
//! *only* these models — so a silent skip would turn a green run into a lie.
//! `non_flat_corpus.rs`'s header records what that costs: roughly 62 Oriedita
//! parity tests print "skipping" and pass in every CI run, and nothing says so.
//! Two things keep it from happening here. Every skip prints a `SKIPPED:` block
//! naming the test and the fixture it did not check, and
//! `ORISTUDIO_NON_FLAT_CORPUS_REQUIRED=1` turns every one of them into a
//! failure — the form CI or a release check can demand.
//!
//! **CI does not set it, and that is the accepted cost of the removal.** The
//! roles that go external with these three are the only free-form-angle
//! positive, the only naturally-authored disconnected refusal, and the only
//! closure refusal; see `tests/fixtures/fold-angle-3d/README.md`.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

pub const CORPUS_ENV: &str = "ORISTUDIO_NON_FLAT_CORPUS_DIR";
pub const REQUIRE_ENV: &str = "ORISTUDIO_NON_FLAT_CORPUS_REQUIRED";

/// Fixtures that are read from the corpus rather than from the repository.
///
/// Named here rather than inferred from what happens to be on disk: a fixture
/// that quietly stopped being committed must not quietly start being optional.
pub const EXTERNAL_FIXTURES: [&str; 3] = [
    "penguin_freeform",
    "penguin_disconnected",
    "rabbit_unclosed",
];

pub fn is_external(name: &str) -> bool {
    EXTERNAL_FIXTURES.contains(&name)
}

pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Where a fixture's FOLD is, or `None` after saying loudly what went unchecked.
///
/// A committed fixture always resolves. An external one resolves only when the
/// corpus is configured *and* holds the derived file; either gap is a skip, and
/// a `CORPUS_ENV` that points at a non-directory is a hard failure rather than a
/// skip, because a typo that reads as coverage is worse than an honest absence.
pub fn fixture_path(test: &str, name: &str) -> Option<PathBuf> {
    if !is_external(name) {
        return Some(
            repo_root()
                .join("tests/fixtures/fold-angle-3d")
                .join(format!("{name}.fold")),
        );
    }

    let Ok(dir) = std::env::var(CORPUS_ENV) else {
        skipped(test, name, &format!("{CORPUS_ENV} is not set"));
        return None;
    };
    let root = PathBuf::from(&dir);
    assert!(
        root.is_dir(),
        "{CORPUS_ENV} is set to {dir}, which is not a directory. \
         A mis-set path is worse than an unset one, because it looks like coverage."
    );

    let path = root.join("fold-angle-3d").join(format!("{name}.fold"));
    if !path.is_file() {
        skipped(
            test,
            name,
            &format!(
                "{} does not exist — derive it with the command in tests/common/mod.rs",
                path.display()
            ),
        );
        return None;
    }
    Some(path)
}

/// The `SKIPPED:` block, and the escalation that turns it into a failure.
pub fn skipped(test: &str, name: &str, why: &str) {
    let notice = format!(
        "SKIPPED: {test}\n  {name} is a third-party design held outside the repository, \
         and {why}.\n  This checked nothing about that fixture.\n  \
         Set {REQUIRE_ENV}=1 to make this a failure instead of a skip."
    );
    assert!(
        std::env::var(REQUIRE_ENV).is_err(),
        "{notice}\n{REQUIRE_ENV} is set."
    );
    println!("{notice}");
}
