//! The shipped FOLD fixtures must keep saying what their descriptions claim.
//!
//! `tests/fixtures/fold-angle/*.fold` exist to be opened by hand — one the
//! self-intersection check must flag, one it must not. A fixture that quietly
//! stops failing is worse than no fixture, because the manual test then passes
//! for the wrong reason, so both claims are pinned here.
//!
//! They are also the only coverage of this check that arrives through the FOLD
//! importer rather than a hand-built `VertexFan`.

use oristudio_cp::checks_spatial::spatial_vertex_reports;
use oristudio_cp::io::fold::import_fold_document;
use treemaker_fold::FoldDocument;

/// The closure bar from `lib.rs`, duplicated because it is private there.
///
/// Asserting an order of magnitude of headroom matters: a fixture sitting just
/// under the bar would be one rounding change away from reporting a closure
/// failure instead of the thing it exists to demonstrate.
const CLOSURE_BAR_DEGREES: f64 = 1e-6;

#[test]
fn shipped_fold_fixtures_behave_as_documented() {
    for (name, expect_crossing) in [
        ("self-intersecting-vertex", true),
        ("valid-waterbomb-vertex", false),
    ] {
        let path = format!(
            "{}/../../tests/fixtures/fold-angle/{name}.fold",
            env!("CARGO_MANIFEST_DIR")
        );
        let raw = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{path}: {error}"));
        let fold: FoldDocument =
            serde_json::from_str(&raw).unwrap_or_else(|error| panic!("{name}: {error}"));
        let model = import_fold_document(&fold).unwrap_or_else(|error| panic!("{name}: {error:?}"));

        // Each fixture is one interior vertex plus a boundary split at every
        // crease endpoint, so the rim vertices are boundary vertices and carry
        // no closure constraint of their own.
        let reports = spatial_vertex_reports(&model);
        let interior: Vec<_> = reports.iter().filter(|report| report.degree >= 3).collect();
        assert_eq!(
            interior.len(),
            1,
            "{name}: expected exactly one interior vertex, found {}",
            interior.len()
        );

        let report = interior[0];
        let residual = report
            .residual
            .expect("fixture vertex must be determinate")
            .to_degrees();
        assert!(
            residual < CLOSURE_BAR_DEGREES / 10.0,
            "{name}: closes at {residual} degrees, too near the {CLOSURE_BAR_DEGREES} bar \
             for a fixture — any drift would turn it into a closure failure"
        );

        let contacts = report.contacts.expect("fixture vertex must be determinate");
        assert_eq!(
            contacts.self_intersects(),
            expect_crossing,
            "{name}: transverse {} tangential {}",
            contacts.transverse,
            contacts.tangential
        );
    }
}
