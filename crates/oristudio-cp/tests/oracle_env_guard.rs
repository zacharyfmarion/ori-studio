//! Guards against a parity suite going dormant.
//!
//! Every oracle-backed test in this crate returns early when its oracle
//! environment variable is unset, so a plain `cargo test -p oristudio-cp`
//! needs no Java. The cost of that convenience is that an unconfigured suite
//! and a passing suite look identical in the log — which is how seven of this
//! workspace's eight oracle suites ran dormant in CI.
//!
//! The CI parity steps set `ORACLE_REQUIRED` to the comma-separated list of
//! variables that step depends on. If any is missing, this fails loudly
//! instead of every gated suite quietly reporting `ok`.

use std::env;

#[test]
fn required_oracle_env_is_present() {
    let Some(required) = env::var_os("ORACLE_REQUIRED") else {
        return;
    };
    let required = required.to_string_lossy().into_owned();
    let missing: Vec<&str> = required
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .filter(|name| env::var_os(name).is_none())
        .collect();
    assert!(
        missing.is_empty(),
        "ORACLE_REQUIRED names {missing:?}, but they are unset; the parity \
         suites they gate would have skipped silently",
    );
}
