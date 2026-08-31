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

use oristudio_cp::CLOSURE_RESIDUAL_BAR_DEGREES;
use oristudio_cp::checks_spatial::{dispatched_camv, spatial_vertex_reports};
use oristudio_cp::io::fold::import_fold_document;
use oristudio_cp::model::is_classic_crease;
use std::path::{Path, PathBuf};
use treemaker_fold::FoldDocument;

mod common;

// Fixtures are held to a tenth of `CLOSURE_RESIDUAL_BAR_DEGREES` rather than to
// the bar itself: one sitting just under it would be a rounding change away from
// reporting a closure failure instead of the thing it exists to demonstrate.

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
            residual < CLOSURE_RESIDUAL_BAR_DEGREES / 10.0,
            "{name}: closes at {residual} degrees, too near the {CLOSURE_RESIDUAL_BAR_DEGREES} bar \
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

/// `fold-angle/unreachable-undecided-vertex.fold` must keep saying what its
/// description claims — that opening it and running Check foldability **names a
/// vertex**.
///
/// It is `solve/failure_case.osf`'s failing vertex, minimised: six creases, one
/// of them unassigned, and no fold angle for that crease closes the vertex. The
/// file exists because the checker used to report nothing here at all. The fan
/// declined on the unassigned crease, `report_for` produced no residual, and the
/// diagnostic pass skipped every report without one — so a document that cannot
/// be folded read as clean, and the fold-blocked dialog could not say which
/// vertex.
///
/// The corpus half of this is `non_flat_corpus.rs`'s
/// `tier_a_verdicts_name_the_one_broken_vertex_and_no_others`, on the real file.
/// This half needs no corpus and runs in CI.
#[test]
fn the_unreachable_undecided_fixture_names_its_vertex() {
    use oristudio_cp::checks_spatial::{Broken, VertexVerdict};

    let path = fixture_root().join("fold-angle/unreachable-undecided-vertex.fold");
    let model = import_fold_document(&read(&path)).expect("import");

    let dispatched = dispatched_camv(&model);
    let broken: Vec<_> = dispatched
        .spatial
        .iter()
        .filter(|report| matches!(report.verdict, VertexVerdict::Broken(_)))
        .collect();
    assert_eq!(
        broken.len(),
        1,
        "exactly one vertex in this fixture cannot fold: {:?}",
        dispatched.spatial
    );

    let report = broken[0];
    let VertexVerdict::Broken(Broken::NoAngleCloses { unknowns, closest }) = report.verdict else {
        panic!(
            "expected an unreachable-closure verdict, got {:?}",
            report.verdict
        );
    };
    assert_eq!(unknowns, 1, "the fixture's vertex is k = 1");
    assert_eq!(
        report.residual, None,
        "and it has no residual, which is exactly why the check used to say nothing"
    );

    let closest = closest.expect("the refusal must say how close the vertex can get");
    assert!(
        (closest - 65.9579).abs() < 1e-3,
        "the fixture's description records 65.96 degrees, measured by sweeping the \
         undecided crease over its whole range at 0.001 degrees; the solver reports \
         {closest}"
    );
}

/// `Fine` means exactly "a closure residual exists and clears the bar".
///
/// The plan's failure arriving in reverse would be a verdict that reads Fine
/// where the residual does not — a clean HUD over a pattern that does not fold —
/// and the verdict is now what the diagnostic pass switches on, so the two must
/// not be able to drift. Run over every committed fixture rather than a
/// synthetic, because the interesting population is vertices that close.
#[test]
fn a_fine_verdict_and_the_closure_residual_never_disagree() {
    use oristudio_cp::checks_spatial::VertexVerdict;

    let mut fine = 0usize;
    let mut checked_files = 0usize;
    for directory in ["fold-angle", "fold-angle-3d"] {
        let entries = std::fs::read_dir(fixture_root().join(directory)).expect("fixture directory");
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|extension| extension != "fold") {
                continue;
            }
            let Ok(model) = import_fold_document(&read(&path)) else {
                continue;
            };
            checked_files += 1;
            for report in dispatched_camv(&model).spatial {
                let cleared = report
                    .residual
                    .is_some_and(|residual| residual.to_degrees() <= CLOSURE_RESIDUAL_BAR_DEGREES);
                assert_eq!(
                    report.verdict == VertexVerdict::Fine,
                    cleared,
                    "{}: verdict and residual disagree at {:?}: {report:?}",
                    path.display(),
                    report.point
                );
                fine += usize::from(cleared);
            }
        }
    }
    assert!(
        checked_files >= 6,
        "only {checked_files} fixtures were read"
    );
    assert!(fine > 0, "no vertex closed, so the law was never exercised");
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
    /// Spatial vertices with a closure condition — the ones `dispatched_camv`
    /// has something to decide about.
    ///
    /// **Not `spatial.len()`.** That list now carries a verdict for every vertex
    /// the spatial branch sees, including every vertex on the paper edge, where
    /// the paper does not wrap around the point and no closure condition exists.
    /// Counting those would count the rim of the sheet.
    spatial_vertices: usize,
    /// Of those: closure worse than the bar, link crossing at a closing vertex,
    /// and indeterminate (a condition exists and the fan could not be read).
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
        name: "hole_vertex_90",
        vertices: 20,
        edges: 26,
        faces: 6,
        full_folds: 0,
        non_classic: 6,
        // The only committed fixture with more than one: 90 on the four valleys
        // and arccos(1/3) on the two mountains. Every other one here is 90
        // throughout, which is the angle Spike B measured to discriminate least.
        distinct_magnitudes: 2,
        flat_violations: 0,
        // Zero, and that is the point of the fixture rather than a gap in it.
        // Every vertex touches the hole rim or the paper rim, so
        // `is_interior_vertex` declines all of them and the closure check
        // examines nothing. The loop gap is the only thing judging this model.
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
        let Some(path) =
            common::fixture_path("fold_angle_3d_fixtures_carry_the_angles_they_claim", name)
        else {
            continue;
        };
        let fold = read(&path);

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
        let Some(path) =
            common::fixture_path("fold_angle_3d_fixtures_reach_their_recorded_verdicts", name)
        else {
            continue;
        };
        let fold = read(&path);
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
        // Vertices with a closure condition, not reports: the list now also
        // carries the boundary vertices, whose verdict is that there was nothing
        // to decide. See `Fixture::spatial_vertices`.
        let constrained: Vec<_> = dispatched
            .spatial
            .iter()
            .filter(|report| report.has_closure_condition())
            .collect();
        assert_eq!(
            constrained.len(),
            fixture.spatial_vertices,
            "{name}: spatial vertices examined. A zero here means CAMV never \
             looked, which is not the same verdict as passing"
        );

        let mut closure_failures = 0usize;
        let mut self_intersections = 0usize;
        let mut indeterminate = 0usize;
        for report in &constrained {
            let crossing = report.link.is_some_and(|link| link.self_intersects());
            match report.residual {
                Some(residual) if residual.to_degrees() > CLOSURE_RESIDUAL_BAR_DEGREES => {
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
        // Nothing new became an error. The verdicts added one way for a vertex
        // to be Broken that the residual test could not express, and this is
        // what keeps that from firing anywhere it should not: the count of
        // Broken verdicts is still the count of closure failures the fixture was
        // recorded with, and Broken is exactly what the diagnostic pass reports.
        assert_eq!(
            dispatched
                .spatial
                .iter()
                .filter(|report| matches!(
                    report.verdict,
                    oristudio_cp::checks_spatial::VertexVerdict::Broken(_)
                ))
                .count(),
            fixture.closure_failures,
            "{name}: vertices reported as broken"
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
        .filter(|fixture| !common::is_external(fixture.name))
        .map(|fixture| fixture.name.to_string())
        .collect();
    listed.sort();
    assert_eq!(
        on_disk, listed,
        "every .fold in tests/fixtures/fold-angle-3d must be pinned above, and \
         every pinned fixture must exist. An unpinned fixture is a file nobody \
         checks; a pinned missing one is a test that cannot run"
    );

    // The commit rule, as a test rather than a paragraph in the README. Three of
    // the models this corpus was built around turned out to be third-party
    // designs and were tracked here for months on the strength of a README
    // sentence asserting otherwise. A sentence cannot fail; this can.
    for name in common::EXTERNAL_FIXTURES {
        assert!(
            !on_disk.iter().any(|found| found == name),
            "{name} is a third-party design and must not be committed. It is read \
             from {} — see tests/common/mod.rs",
            common::CORPUS_ENV
        );
    }

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

    // Over the whole table, committed and external alike: the denominator is a
    // property of the corpus the verdicts were recorded against, not of what
    // happens to be checked out.
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
