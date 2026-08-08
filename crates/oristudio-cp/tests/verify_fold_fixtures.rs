//! The shipped FOLD fixtures must keep saying what their descriptions claim.
//!
//! `tests/fixtures/fold-angle/*.fold` exist to be opened by hand — one the
//! self-intersection check must flag, one it must not. A fixture that quietly
//! stops failing is worse than no fixture, because the manual test then passes
//! for the wrong reason, so both claims are pinned here.
//!
//! They are also the only coverage of this check that arrives through the FOLD
//! importer rather than a hand-built `VertexFan`.
//!
//! `tests/fixtures/fold-angle-3d/` is the Phase 2 fixture corpus for the
//! computed 3D folded state, and it is pinned the same way and for a sharper
//! reason: that work has **no oracle**. Oriedita's creases are always ±180, so
//! there is no upstream implementation to diff against, and every claim about
//! placement, admission or the coplanar-overlap census has to be an assertion
//! against a file whose answer is recorded. The recorded answers are in that
//! directory's README, and the table below is the same table.

use oristudio_cp::checks_spatial::{dispatched_camv, spatial_vertex_reports};
use oristudio_cp::io::fold::import_fold_document;
use oristudio_cp::model::is_classic_crease;
use std::path::{Path, PathBuf};
use treemaker_fold::FoldDocument;

/// The closure bar from `lib.rs`, duplicated because it is private there.
///
/// Asserting an order of magnitude of headroom matters: a fixture sitting just
/// under the bar would be one rounding change away from reporting a closure
/// failure instead of the thing it exists to demonstrate.
const CLOSURE_BAR_DEGREES: f64 = 1e-6;

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures")
}

fn read(path: &Path) -> FoldDocument {
    let raw = std::fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    serde_json::from_str(&raw).unwrap_or_else(|error| panic!("parse {}: {error}", path.display()))
}

#[test]
fn shipped_fold_fixtures_behave_as_documented() {
    for (name, expect_crossing) in [
        ("self-intersecting-vertex", true),
        ("valid-waterbomb-vertex", false),
    ] {
        let path = fixture_root().join(format!("fold-angle/{name}.fold"));
        let fold = read(&path);
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

        let verdict = report.link.expect("fixture vertex must be determinate");
        assert_eq!(
            verdict.self_intersects(),
            expect_crossing,
            "{name}: {verdict:?}"
        );
    }
}

/// What one 3D fixture must keep saying about itself.
///
/// Counts rather than tolerances wherever possible: a count that changes is a
/// changed answer, and there is nothing to argue about. The two real-valued
/// entries are bounds and are stated with decades of headroom for the same
/// reason the closure assertion above is.
struct Fixture {
    name: &'static str,
    vertices: usize,
    edges: usize,
    faces: usize,
    /// Creases at exactly ±180 in the file's own `edges_foldAngle`.
    full_folds: usize,
    /// Creases at neither 0 nor ±180 — what makes this a 3D fixture at all.
    non_classic: usize,
    /// Distinct |magnitude| values among those, to 1e-6 degrees. A fixture set
    /// where this is 1 everywhere has only ever been tested at 90 degrees,
    /// which Spike B measured to be the one angle that discriminates least.
    distinct_magnitudes: usize,
    /// Oriedita flat-foldability violations, from the flat branch of CAMV.
    flat_violations: usize,
    /// Spatial vertices `dispatched_camv` reports on at all.
    spatial_vertices: usize,
    /// Of those: closure worse than the bar, link crossing at a closing vertex,
    /// and indeterminate (reported as nothing).
    closure_failures: usize,
    self_intersections: usize,
    indeterminate: usize,
}

/// The committed 3D fold-angle corpus. Mirrors the README table beside it.
const FOLD_ANGLE_3D: &[Fixture] = &[
    Fixture {
        name: "hinge_90",
        vertices: 4,
        edges: 5,
        faces: 2,
        full_folds: 0,
        non_classic: 1,
        distinct_magnitudes: 1,
        flat_violations: 0,
        spatial_vertices: 0,
        closure_failures: 0,
        self_intersections: 0,
        indeterminate: 0,
    },
    Fixture {
        name: "box_90",
        vertices: 13,
        edges: 23,
        faces: 11,
        full_folds: 7,
        non_classic: 6,
        distinct_magnitudes: 1,
        flat_violations: 0,
        spatial_vertices: 2,
        closure_failures: 0,
        self_intersections: 0,
        indeterminate: 0,
    },
    Fixture {
        name: "box_90_unangled",
        vertices: 13,
        edges: 23,
        faces: 11,
        full_folds: 13,
        non_classic: 0,
        distinct_magnitudes: 0,
        flat_violations: 2,
        spatial_vertices: 0,
        closure_failures: 0,
        self_intersections: 0,
        indeterminate: 0,
    },
    Fixture {
        name: "spikes_small",
        vertices: 24,
        edges: 48,
        faces: 25,
        full_folds: 20,
        non_classic: 16,
        distinct_magnitudes: 1,
        flat_violations: 0,
        spatial_vertices: 8,
        closure_failures: 0,
        self_intersections: 0,
        indeterminate: 0,
    },
    Fixture {
        name: "spikes_large",
        vertices: 207,
        edges: 420,
        faces: 214,
        full_folds: 224,
        non_classic: 144,
        distinct_magnitudes: 1,
        flat_violations: 0,
        spatial_vertices: 114,
        closure_failures: 0,
        self_intersections: 0,
        indeterminate: 0,
    },
    Fixture {
        name: "penguin_freeform",
        vertices: 120,
        edges: 246,
        faces: 127,
        full_folds: 133,
        non_classic: 64,
        distinct_magnitudes: 10,
        flat_violations: 0,
        spatial_vertices: 36,
        closure_failures: 0,
        self_intersections: 0,
        indeterminate: 0,
    },
    Fixture {
        name: "penguin_disconnected",
        vertices: 224,
        edges: 452,
        faces: 230,
        full_folds: 269,
        non_classic: 90,
        distinct_magnitudes: 10,
        flat_violations: 0,
        spatial_vertices: 53,
        closure_failures: 0,
        self_intersections: 0,
        indeterminate: 0,
    },
    Fixture {
        name: "rabbit_unclosed",
        vertices: 78,
        edges: 164,
        faces: 87,
        full_folds: 70,
        non_classic: 62,
        distinct_magnitudes: 16,
        flat_violations: 0,
        spatial_vertices: 32,
        closure_failures: 1,
        self_intersections: 0,
        indeterminate: 0,
    },
];

fn is_full_fold(angle: f64) -> bool {
    (angle.abs() - 180.0).abs() <= 1e-6
}

fn is_non_classic(angle: f64) -> bool {
    angle.abs() > 1e-6 && !is_full_fold(angle)
}

#[test]
fn fold_angle_3d_fixtures_carry_the_angles_they_claim() {
    for fixture in FOLD_ANGLE_3D {
        let name = fixture.name;
        let fold = read(&fixture_root().join(format!("fold-angle-3d/{name}.fold")));

        assert_eq!(fold.vertices_coords.len(), fixture.vertices, "{name}: V");
        assert_eq!(fold.edges_vertices.len(), fixture.edges, "{name}: E");
        assert_eq!(
            fold.faces_vertices.len(),
            fixture.faces,
            "{name}: F — every fixture here must carry faces_vertices, or it \
             cannot be checked without running the kernel"
        );

        let angles: Vec<f64> = fold
            .edges_fold_angle
            .iter()
            .map(|angle| {
                angle.unwrap_or_else(|| {
                    panic!(
                        "{name}: a null edges_foldAngle. These are Ori Studio exports and \
                         every edge carries an angle; a null would have to be interpreted, \
                         and the interpretation is exactly what this corpus exists to pin"
                    )
                })
            })
            .collect();
        assert_eq!(
            angles.len(),
            fixture.edges,
            "{name}: edges_foldAngle is not per-edge"
        );

        assert_eq!(
            angles.iter().filter(|a| is_full_fold(**a)).count(),
            fixture.full_folds,
            "{name}: creases at +/-180"
        );
        let non_classic: Vec<f64> = angles
            .iter()
            .copied()
            .filter(|angle| is_non_classic(*angle))
            .collect();
        assert_eq!(
            non_classic.len(),
            fixture.non_classic,
            "{name}: non-classic creases"
        );

        let mut magnitudes: Vec<i64> = non_classic
            .iter()
            .map(|angle| (angle.abs() * 1e6).round() as i64)
            .collect();
        magnitudes.sort_unstable();
        magnitudes.dedup();
        assert_eq!(
            magnitudes.len(),
            fixture.distinct_magnitudes,
            "{name}: distinct fold magnitudes"
        );
    }
}

#[test]
fn fold_angle_3d_fixtures_reach_their_recorded_verdicts() {
    for fixture in FOLD_ANGLE_3D {
        let name = fixture.name;
        let fold = read(&fixture_root().join(format!("fold-angle-3d/{name}.fold")));
        let model = import_fold_document(&fold).unwrap_or_else(|error| panic!("{name}: {error:?}"));

        // `dispatched_camv` and not `spatial_vertex_reports`: it is the call
        // that routes a mixed document's flat vertices to Oriedita's flat
        // checker, so it is the one whose verdict a user would actually meet.
        let dispatched = dispatched_camv(&model);
        assert_eq!(
            dispatched.flat.len(),
            fixture.flat_violations,
            "{name}: flat-foldability violations"
        );
        assert_eq!(
            dispatched.spatial.len(),
            fixture.spatial_vertices,
            "{name}: spatial vertices examined. A zero here means CAMV never \
             looked, which is not the same verdict as passing"
        );

        let mut closure_failures = 0usize;
        let mut self_intersections = 0usize;
        let mut indeterminate = 0usize;
        for report in &dispatched.spatial {
            let crossing = report.link.is_some_and(|link| link.self_intersects());
            match report.residual {
                Some(residual) if residual.to_degrees() > CLOSURE_BAR_DEGREES => {
                    closure_failures += 1;
                }
                Some(_) => self_intersections += usize::from(crossing),
                None => indeterminate += 1,
            }
        }
        assert_eq!(
            closure_failures, fixture.closure_failures,
            "{name}: closure failures"
        );
        assert_eq!(
            self_intersections, fixture.self_intersections,
            "{name}: local self-intersections"
        );
        assert_eq!(
            indeterminate, fixture.indeterminate,
            "{name}: indeterminate vertices"
        );

        // The fold angles have to survive the importer, not just exist in the
        // file: `is_classic_crease` is the predicate the 3D routing turns on,
        // and it reads `fold_magnitude` off the imported segment.
        let imported_non_classic = model
            .line_segments
            .iter()
            .filter(|segment| !is_classic_crease(segment))
            .count();
        assert_eq!(
            imported_non_classic, fixture.non_classic,
            "{name}: non-classic creases survived import"
        );
    }
}

/// Green must mean something was checked.
///
/// Stated as its own assertion because the failure this guards against is a
/// suite that quietly stops covering anything — a renamed directory, an empty
/// glob, a fixture list that lost its entries in a merge — and every one of
/// those leaves the tests above passing while asserting nothing.
#[test]
fn the_3d_fixture_corpus_is_not_empty_and_covers_more_than_ninety_degrees() {
    let directory = fixture_root().join("fold-angle-3d");
    let mut on_disk: Vec<String> = std::fs::read_dir(&directory)
        .unwrap_or_else(|error| panic!("read {}: {error}", directory.display()))
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "fold"))
        .map(|path| {
            path.file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into()
        })
        .collect();
    on_disk.sort();
    let mut listed: Vec<String> = FOLD_ANGLE_3D
        .iter()
        .map(|fixture| fixture.name.to_string())
        .collect();
    listed.sort();
    assert_eq!(
        on_disk, listed,
        "every .fold in tests/fixtures/fold-angle-3d must be pinned above, and \
         every pinned fixture must exist. An unpinned fixture is a file nobody \
         checks; a pinned missing one is a test that cannot run"
    );

    // Spike B measured that at (90, 90) a placement sign fault leaves the
    // obvious probe vertex fixed to 6.7e-16 while moving the rest of the face
    // by 1.414. A corpus that is 90 degrees everywhere cannot see that.
    let free_form = FOLD_ANGLE_3D
        .iter()
        .filter(|fixture| fixture.distinct_magnitudes > 2)
        .count();
    assert!(
        free_form >= 2,
        "the 3D corpus must keep at least two genuinely free-form models; \
         90 degrees is the angle that discriminates least"
    );

    let spatial: usize = FOLD_ANGLE_3D
        .iter()
        .map(|fixture| fixture.spatial_vertices)
        .sum();
    assert_eq!(
        spatial, 245,
        "total spatial vertices across the 3D corpus. Pinned because the claim \
         downstream — that no fixture produces an indeterminate vertex, so \
         truth-table row (f) has no fixture — is only worth anything against a \
         known denominator"
    );
}
