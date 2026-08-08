//! The external non-flat corpus: designs that carry real fold angles.
//!
//! Third-party and real-user files are not committed (`tests/corpus/README.md`),
//! so the breadth material for the computed 3D folded state lives outside git
//! and is reached through `ORISTUDIO_NON_FLAT_CORPUS_DIR`. The committed
//! fixtures in `tests/fixtures/fold-angle-3d/` are the **gate**; this file is
//! the breadth, plus the one ground-truth asset that cannot be committed at all.
//!
//! ```sh
//! ORISTUDIO_NON_FLAT_CORPUS_DIR=/path/to/non-flat cargo test -p oristudio-cp \
//!     --test non_flat_corpus -- --nocapture
//! ```
//!
//! # Why the skip is loud
//!
//! `grep -rn ORIEDITA .github/workflows/` returns nothing, and roughly 62
//! Oriedita parity tests print "skipping … is not set" and **pass** in every CI
//! run as a result. Green there means nothing was checked, and nothing says so.
//! Four things keep that from happening again here:
//!
//! 1. The load-bearing assertions are on **committed** fixtures
//!    (`verify_fold_fixtures.rs`), which need no environment at all. Nothing in
//!    this file is the only coverage of anything.
//! 2. Every skip prints a `SKIPPED:` block naming the test, the variable, and
//!    what was not checked — greppable, and never a bare early return.
//! 3. `corpus_coverage_is_stated` always runs and prints the roster, so the
//!    absence is reported rather than merely implied.
//! 4. `ORISTUDIO_NON_FLAT_CORPUS_REQUIRED=1` turns every skip into a failure,
//!    which is the form CI or a release check can demand. A failing test's
//!    output is never captured, so that message is visible by default.
//!
//! And a mis-set path must not read as a skip: a variable that points at
//! nothing, or at a directory holding no measurable file, **fails**.

use oristudio_cp::CLOSURE_RESIDUAL_BAR_DEGREES;
use oristudio_cp::checks_spatial::dispatched_camv;
use oristudio_cp::io::fold::import_fold_document;
use std::path::{Path, PathBuf};
use treemaker_fold::FoldDocument;

const CORPUS_ENV: &str = "ORISTUDIO_NON_FLAT_CORPUS_DIR";
const REQUIRE_ENV: &str = "ORISTUDIO_NON_FLAT_CORPUS_REQUIRED";

/// Every test in this file, with what it covers, so a skip can say what was
/// lost rather than that something was.
const COVERAGE: &[(&str, &str)] = &[
    (
        "committed_fixtures_are_reproducible_from_their_sources",
        "each tests/fixtures/fold-angle-3d/*.fold still equals what \
         scripts/osf-fold-projection.mjs produces from its source .osf",
    ),
    (
        "corpus_scan_reports_every_model",
        "foldability over every .fold and .osf in the corpus, reported not gated",
    ),
    (
        "corpus_census_reports_every_model",
        "plane clustering, the coplanar-overlap census, the tolerance bands and \
         cross-plane coupling over every model in the corpus",
    ),
    (
        "corpus_admission_reports_every_verdict",
        "which refusal the 3D admission gate reaches on every model in the \
         corpus, reported not gated",
    ),
    (
        "corpus_landmarks_are_where_the_harness_expects_them",
        "the harness is reading the corpus and not an empty directory",
    ),
    (
        "moosers_train_pair_is_a_usable_placement_oracle",
        "the only ground-truth folded state available, and the noise floor \
         that bounds what may be concluded from it",
    ),
];

/// The corpus root, or `None` after saying loudly what was skipped.
fn corpus(test: &str) -> Option<PathBuf> {
    let covers = COVERAGE
        .iter()
        .find(|(name, _)| *name == test)
        .map(|(_, covers)| *covers)
        .unwrap_or("(uncatalogued — add it to COVERAGE)");
    let required = std::env::var(REQUIRE_ENV).is_ok();
    let Ok(dir) = std::env::var(CORPUS_ENV) else {
        let notice = format!(
            "SKIPPED: {test}\n  {CORPUS_ENV} is not set, so this checked nothing.\n  \
             It would have checked: {covers}\n  \
             Set {REQUIRE_ENV}=1 to make this a failure instead of a skip."
        );
        assert!(!required, "{notice}\n{REQUIRE_ENV} is set.");
        println!("{notice}");
        return None;
    };
    let path = PathBuf::from(&dir);
    // A typo must not read as a skip. This is the other half of the same
    // failure: "the variable is set" and "the variable points at the corpus"
    // are different claims, and only the second one buys coverage.
    assert!(
        path.is_dir(),
        "{CORPUS_ENV} is set to {dir}, which is not a directory. \
         A mis-set path is worse than an unset one, because it looks like coverage."
    );
    Some(path)
}

fn is_measurable(path: &Path) -> bool {
    path.extension().is_some_and(|e| e == "fold" || e == "osf")
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out);
        } else if is_measurable(&path) {
            out.push(path);
        }
    }
}

fn measurable_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    walk(root, &mut files);
    files.sort();
    assert!(
        !files.is_empty(),
        "{} holds no .fold or .osf file. {CORPUS_ENV} is pointing somewhere, \
         but not at the non-flat corpus.",
        root.display()
    );
    files
}

/// Read a `.fold`, or the crease pattern out of an Ori Studio `.osf`.
///
/// Deliberately **not** `import_fold_document`: that drops the z coordinate
/// (`io/fold.rs`), which is fine for a crease pattern and destroys a folded
/// form. Anything reading a `foldedForm` frame has to come through here.
fn read_fold(path: &Path) -> Result<FoldDocument, String> {
    let raw = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    if path.extension().is_some_and(|e| e == "osf") {
        let project: serde_json::Value =
            serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        let projection = project
            .pointer("/workspace/documents/0/creasePattern/foldProjection")
            .ok_or_else(|| "no creasePattern.foldProjection".to_string())?;
        return serde_json::from_value(projection.clone()).map_err(|error| error.to_string());
    }
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The committed fixtures, and the command each was derived by.
///
/// Kept here rather than in the fixture README's prose so that the README and
/// the test cannot drift: the README quotes these arguments verbatim.
const DERIVATIONS: &[(&str, &str, &[&str])] = &[
    ("hinge_90.fold", "test_export.fold", &[]),
    ("box_90.fold", "tooling/base_fixed.osf", &[]),
    ("box_90_unangled.fold", "tooling/base.osf", &[]),
    ("spikes_small.fold", "non-flat-test.osf", &[]),
    ("spikes_large.fold", "spikes_better.fold", &[]),
    (
        "penguin_freeform.fold",
        "plant/penguin_other_angles.osf",
        &["--component", "0"],
    ),
    (
        "penguin_disconnected.fold",
        "plant/penguin_other_angles.osf",
        &[],
    ),
    ("rabbit_unclosed.fold", "plant/rabbit.osf", &[]),
];

/// A derived fixture that cannot be re-derived is a fixture nobody can trust.
///
/// Byte equality, through the documented command, so the command is tested too.
/// This is what makes it safe for the committed files to be derived artefacts
/// rather than the sources themselves.
#[test]
fn committed_fixtures_are_reproducible_from_their_sources() {
    let Some(root) = corpus("committed_fixtures_are_reproducible_from_their_sources") else {
        return;
    };
    let script = repo_root().join("scripts/osf-fold-projection.mjs");
    let probe = std::process::Command::new("node").arg("--version").output();
    if probe.is_err() {
        println!(
            "SKIPPED: committed_fixtures_are_reproducible_from_their_sources\n  \
             node is not on PATH, so the documented derivation command could not be run."
        );
        return;
    }

    for (fixture, source, extra) in DERIVATIONS {
        let source_path = root.join(source);
        assert!(
            source_path.is_file(),
            "{source} is missing from the corpus, so {fixture} cannot be re-derived"
        );
        let output = std::process::Command::new("node")
            .arg(&script)
            .arg(&source_path)
            .args(*extra)
            .output()
            .unwrap_or_else(|error| panic!("run osf-fold-projection.mjs: {error}"));
        assert!(
            output.status.success(),
            "{fixture}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let committed = std::fs::read(
            repo_root()
                .join("tests/fixtures/fold-angle-3d")
                .join(fixture),
        )
        .unwrap_or_else(|error| panic!("read {fixture}: {error}"));
        assert_eq!(
            output.stdout, committed,
            "{fixture} is no longer what its source produces. Either the source \
             changed, or the fixture was hand-edited — and a hand-edited derived \
             artefact is how a corpus stops describing anything."
        );
    }

    // The one file that is a copy rather than a derivation.
    let committed = std::fs::read(repo_root().join("tests/fixtures/fold-angle-3d/box_90.osf"))
        .expect("read box_90.osf");
    let source = std::fs::read(root.join("tooling/base_fixed.osf")).expect("read base_fixed.osf");
    assert_eq!(
        committed, source,
        "box_90.osf must stay a byte-for-byte copy of tooling/base_fixed.osf"
    );
    println!(
        "reproduced {} committed fixtures from source, byte for byte",
        DERIVATIONS.len() + 1
    );
}

/// Scan the whole corpus and report. Deliberately does not gate.
///
/// The corpus contains material that is *meant* to report: the
/// `origami-simulator-corpus` fold angles are relaxation targets rather than
/// solved states, so closure failures there are a fact about the input. A
/// failure count is information; the committed fixtures are the gate.
#[test]
fn corpus_scan_reports_every_model() {
    let Some(root) = corpus("corpus_scan_reports_every_model") else {
        return;
    };
    let files = measurable_files(&root);

    let (mut clean, mut with_angles, mut unreadable) = (0usize, 0usize, 0usize);
    let (mut flat, mut closure, mut self_int) = (0usize, 0usize, 0usize);
    println!(
        "{:<52}{:>7}{:>9}{:>9}{:>9}",
        "model", "n180", "flat", "closure", "self-int"
    );
    for path in &files {
        let name = path
            .strip_prefix(&root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        let Ok(fold) = read_fold(path) else {
            unreadable += 1;
            println!("{name:<52}   unreadable");
            continue;
        };
        let Ok(model) = import_fold_document(&fold) else {
            unreadable += 1;
            println!("{name:<52}   import refused");
            continue;
        };
        let dispatched = dispatched_camv(&model);
        let mut file_closure = 0usize;
        let mut file_self_int = 0usize;
        for report in &dispatched.spatial {
            let crossing = report.link.is_some_and(|link| link.self_intersects());
            match report.residual {
                Some(residual) if residual.to_degrees() > CLOSURE_RESIDUAL_BAR_DEGREES => {
                    file_closure += 1
                }
                Some(_) => file_self_int += usize::from(crossing),
                None => {}
            }
        }
        let non_classic = model
            .line_segments
            .iter()
            .filter(|segment| !oristudio_cp::model::is_classic_crease(segment))
            .count();
        with_angles += usize::from(non_classic > 0);
        flat += dispatched.flat.len();
        closure += file_closure;
        self_int += file_self_int;
        let quiet = dispatched.flat.is_empty() && file_closure == 0 && file_self_int == 0;
        clean += usize::from(quiet);
        println!(
            "{name:<52}{non_classic:>7}{:>9}{file_closure:>9}{file_self_int:>9}{}",
            dispatched.flat.len(),
            if quiet { "  reports nothing" } else { "" }
        );
    }
    println!(
        "\n{} files scanned, {unreadable} unreadable, {with_angles} carry a non-classic \
         angle, {clean} report nothing; totals: {flat} flat, {closure} closure, {self_int} self-int",
        files.len()
    );
}

/// Which verdict the 3D admission gate reaches on every model in the corpus.
///
/// Reported, not gated, for the same reason the foldability scan above is: the
/// `origami-simulator-corpus` fold angles are relaxation targets rather than
/// solved states, so a refusal there is a fact about the input.
///
/// What it is *for* is the distribution. The plan's phase order rests on which
/// refusals users will actually meet, and on which arms are reachable at all —
/// `LoopNotClosed` in particular is defence in depth, and this is the only place
/// that can say whether anything reaches it.
#[test]
fn corpus_admission_reports_every_verdict() {
    use oristudio_cp::folding3d::{Fold3dOutcome, Fold3dRefusal, admit};
    use std::collections::BTreeMap;

    let Some(root) = corpus("corpus_admission_reports_every_verdict") else {
        return;
    };
    let mut tally: BTreeMap<&'static str, usize> = BTreeMap::new();
    let mut worst_admitted_gap = 0.0_f64;
    for path in measurable_files(&root) {
        let name = path
            .strip_prefix(&root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        let Ok(model) = read_fold(&path)
            .and_then(|fold| import_fold_document(&fold).map_err(|error| format!("{error:?}")))
        else {
            *tally.entry("unreadable").or_default() += 1;
            continue;
        };
        let verdict = match admit(&model.line_segments, 1) {
            Ok(admission) => {
                let relative = admission.placement.loop_gap.offset / admission.placement.span;
                worst_admitted_gap = worst_admitted_gap.max(relative);
                println!(
                    "{name:<52}  ADMIT {:?}  faces {:>5}  gap {relative:.2e} of span  \
                     cycles {:>5}  sepbins {:?}",
                    admission.outcome(),
                    admission.placement.rings.len(),
                    admission.placement.loop_gap.non_tree_edges,
                    admission.diagnostics.separation_bins,
                );
                match admission.outcome() {
                    Fold3dOutcome::Folded => "admitted",
                    Fold3dOutcome::LocalCrossing => "admitted with a local crossing",
                }
            }
            Err(refusal) => {
                println!("{name:<52}  {refusal}");
                match refusal {
                    Fold3dRefusal::NoFaces => "NoFaces",
                    Fold3dRefusal::FacesUnresolved => "FacesUnresolved",
                    Fold3dRefusal::Disconnected { .. } => "Disconnected",
                    Fold3dRefusal::NonCreaseJoin { .. } => "NonCreaseJoin",
                    Fold3dRefusal::InteriorCut { .. } => "InteriorCut",
                    Fold3dRefusal::FlatFoldability { .. } => "FlatFoldability",
                    Fold3dRefusal::VertexIndeterminate { .. } => "VertexIndeterminate",
                    Fold3dRefusal::VertexClosure { .. } => "VertexClosure",
                    Fold3dRefusal::LoopNotClosed { .. } => "LoopNotClosed",
                    Fold3dRefusal::ToleranceWindowClosed { .. } => "ToleranceWindowClosed",
                }
            }
        };
        *tally.entry(verdict).or_default() += 1;
    }
    println!("\nverdicts: {tally:?}");
    println!("worst admitted loop gap: {worst_admitted_gap:.3e} of span");
}

/// Plane clustering, the census and cross-plane coupling over the whole corpus.
///
/// Reported, not gated — except for five things that are, because they are the
/// evidence the Phase 4 tolerances rest on and the corpus is the only place they
/// can be measured. **Every corpus number the plan quotes about plane identity,
/// the overlap-area band or cross-plane coupling has to come from this test**,
/// which is a committed command run by `cargo test`. Earlier drafts quoted an
/// instrumented copy of `examples/fold3d_census.rs` that no longer exists, and
/// two of those figures did not reproduce.
///
/// The **model count is deduplicated by file name and asserted**. Ten files
/// appear twice — nine of them in both `known-good/` and
/// `origami-simulator-corpus/fold/` — so a raw walk counts 65 measurable files
/// for 55 distinct models, and any ratio taken over the raw count is wrong by
/// that much.
#[test]
fn corpus_census_reports_every_model() {
    use oristudio_cp::folding3d::{
        Fold3dOutcome, Fold3dTolerances, admit, census_placement, folded_line_index, place_segments,
    };
    use std::collections::{BTreeMap, BTreeSet};

    struct Measured {
        admitted: bool,
        faces: usize,
        planes: usize,
        census: usize,
        full_fold_pairs: usize,
        normal_diameter: f64,
        offset_diameter: f64,
        separation: Option<f64>,
        smallest_accepted: Option<f64>,
        largest_rejected: f64,
        alarms: usize,
        coupled_lines: usize,
    }

    let Some(root) = corpus("corpus_census_reports_every_model") else {
        return;
    };
    let tolerances = Fold3dTolerances::DEFAULT;

    let mut names: BTreeSet<String> = BTreeSet::new();
    let mut rows: BTreeMap<String, Measured> = BTreeMap::new();
    let mut duplicates = 0usize;
    for path in measurable_files(&root) {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        if !names.insert(name.clone()) {
            duplicates += 1;
            continue;
        }
        let Ok(model) = read_fold(&path)
            .and_then(|fold| import_fold_document(&fold).map_err(|error| format!("{error:?}")))
        else {
            continue;
        };
        let Ok(placement) = place_segments(&model.line_segments, 1) else {
            continue;
        };
        let admitted = admit(&model.line_segments, 1)
            .is_ok_and(|admission| admission.outcome() == Fold3dOutcome::Folded);
        let (index, census) = census_placement(&placement, tolerances);
        let lines = folded_line_index(&placement, &index, tolerances);
        rows.insert(
            name,
            Measured {
                admitted,
                faces: census.face_count,
                planes: census.plane_count,
                census: census.overlapping_pair_count,
                full_fold_pairs: census.full_fold_pairs,
                normal_diameter: index.worst_intra_normal_radians,
                offset_diameter: index.worst_intra_offset_relative,
                separation: index.min_inter_separation_relative,
                smallest_accepted: census.min_accepted_area_relative,
                largest_rejected: census.max_rejected_area_relative,
                alarms: index.alarm_count,
                coupled_lines: lines.cross_plane_groups,
            },
        );
    }

    assert_eq!(
        names.len(),
        55,
        "the corpus is supposed to hold 55 distinct model names ({duplicates} duplicates \
         skipped); a changed count means every ratio below is against a different denominator"
    );

    println!(
        "\n{:<44} {:>6} {:>6} {:>7} {:>6} {:>10} {:>10} {:>10} {:>10} {:>10} {:>6} {:>7}",
        "model (~ = not admitted)",
        "faces",
        "planes",
        "census",
        "folds",
        "intra-n",
        "intra-o",
        "inter-sep",
        "min-area",
        "max-rej",
        "couple",
        "alarms"
    );
    let mut worst_normal = (0.0_f64, String::new());
    let mut worst_offset = 0.0_f64;
    let mut min_separation = f64::INFINITY;
    let mut smallest_accepted = f64::INFINITY;
    let mut largest_rejected = 0.0_f64;
    let (mut admitted_models, mut census_zero, mut coupled, mut above_six) = (0, 0, 0, 0);
    let mut alarmed: Vec<&str> = Vec::new();
    for (name, row) in &rows {
        println!(
            "{:<44} {:>6} {:>6} {:>7} {:>6} {:>10.3e} {:>10.3e} {:>10} {:>10} {:>10.3e} {:>6} {:>7}",
            format!("{}{name}", if row.admitted { "" } else { "~" }),
            row.faces,
            row.planes,
            row.census,
            row.full_fold_pairs,
            row.normal_diameter,
            row.offset_diameter,
            row.separation
                .map_or("--".to_string(), |value| format!("{value:.3e}")),
            row.smallest_accepted
                .map_or("--".to_string(), |value| format!("{value:.3e}")),
            row.largest_rejected,
            row.coupled_lines,
            row.alarms,
        );
        if row.alarms > 0 {
            alarmed.push(name);
        }
        if !row.admitted {
            continue;
        }
        admitted_models += 1;
        assert_eq!(
            row.alarms, 0,
            "{name} is admitted and still raised {} tolerance alarms",
            row.alarms
        );
        assert!(
            row.census >= row.full_fold_pairs,
            "{name}: census {} is below its {} full-folded face pairs",
            row.census,
            row.full_fold_pairs
        );
        if row.census == 0 {
            census_zero += 1;
        }
        if row.normal_diameter > worst_normal.0 {
            worst_normal = (row.normal_diameter, name.clone());
        }
        worst_offset = worst_offset.max(row.offset_diameter);
        if let Some(separation) = row.separation {
            min_separation = min_separation.min(separation);
        }
        if let Some(accepted) = row.smallest_accepted {
            smallest_accepted = smallest_accepted.min(accepted);
        }
        largest_rejected = largest_rejected.max(row.largest_rejected);
        if row.faces > 6 {
            above_six += 1;
            if row.coupled_lines > 0 {
                coupled += 1;
            }
        }
    }

    println!(
        "\nmodels: {} distinct, {duplicates} duplicate paths skipped",
        names.len()
    );
    println!("admitted (Folded): {admitted_models}; census 0 on {census_zero}");
    println!("models raising a tolerance alarm: {alarmed:?}");
    println!(
        "worst intra-plane normal diameter: {:.3e} rad on {}",
        worst_normal.0, worst_normal.1
    );
    println!("worst intra-plane offset diameter: {worst_offset:.3e} of span");
    println!("min inter-plane separation:        {min_separation:.3e} of span");
    println!(
        "overlap area band:                 {largest_rejected:.3e} .. {smallest_accepted:.3e} of span^2"
    );
    println!(
        "admitted models above 6 faces with a cross-plane coupled folded line: {coupled} of {above_six}"
    );

    // The five gated claims.
    //
    // 1. The angle bar has a factor of 3.5, not decades, and the model that eats
    //    it is `airplane.fold` — where the diameter is measuring the file's
    //    6-decimal coordinate rounding rather than any design angle. This is the
    //    number the verification pass exists for. Asserted as a band so it fails
    //    in either direction.
    assert_eq!(worst_normal.1, "airplane.fold");
    assert!(
        (1e-8..tolerances.angle_radians).contains(&worst_normal.0),
        "the worst admitted normal diameter moved to {} rad",
        worst_normal.0
    );
    // 2. The offset bar has a factor of 47, and it is `airplane.fold` that eats
    //    it here too — the same 6-decimal rounding, showing up in both
    //    coordinates at once. Decades of headroom is what the committed fixtures
    //    have; the corpus does not, and asserting a factor is the honest form.
    assert!(
        worst_offset * 10.0 < tolerances.distance_relative,
        "the worst admitted offset diameter is {worst_offset} of span"
    );
    // 3. The side condition's upper bound, where it exists at all. `None` on a
    //    model with no two parallel planes is a real answer, so this is a
    //    minimum over the models that have one and never a gate.
    assert!(
        min_separation > tolerances.distance_relative * 1e3,
        "two distinct planes sit {min_separation} of span apart"
    );
    // 4. The overlap-area bar sits between two populations with decades either
    //    side.
    assert!(largest_rejected * 1e3 < tolerances.overlap_area_relative);
    assert!(smallest_accepted > tolerances.overlap_area_relative * 1e3);
    // 5. Cross-plane coupling is not exotic, which is why nothing refuses on it:
    //    every admitted model with more than six faces has at least one folded
    //    line whose creases carry faces in two planes.
    assert!(
        above_six >= 10,
        "only {above_six} admitted models above 6 faces"
    );
    assert_eq!(
        coupled, above_six,
        "cross-plane coupling was expected on every admitted model above 6 faces"
    );
}

/// Prove the harness is reading the corpus, not an empty directory.
///
/// The failure this exists for is the one that looks like success: a scan over
/// zero files reports zero problems. Each landmark below is a file the corpus
/// must contain, with a measurement that could not be produced by accident.
#[test]
fn corpus_landmarks_are_where_the_harness_expects_them() {
    let Some(root) = corpus("corpus_landmarks_are_where_the_harness_expects_them") else {
        return;
    };
    let files = measurable_files(&root);
    assert!(
        files.len() >= 60,
        "expected at least 60 measurable files in the non-flat corpus, found {}",
        files.len()
    );

    // (path, segments, flat violations, spatial vertices, closure failures)
    let landmarks: &[(&str, usize, usize, usize, usize)] = &[
        // The owner-authored scale case: the largest clean 3D-angled model that
        // exists, and the source of `spikes_large`.
        ("spikes_better.fold", 420, 0, 114, 0),
        // Curated third-party, and the R19 instance: it reports nothing at all
        // — 0 flat, 0 closure over 90 examined vertices — while carrying a
        // closed hexagon of border segments inside the sheet that
        // `is_interior_vertex` excuses. The clean line here is the point.
        ("known-good/byu solar driven.fold", 246, 0, 90, 0),
        // Published third-party whose fold angles are relaxation targets rather
        // than a solved state, so it reports plenty. If this one ever goes
        // quiet, the checker changed and not the file.
        (
            "origami-simulator-corpus/fold/polygami.fold",
            4134,
            0,
            1166,
            365,
        ),
    ];
    for (relative, segments, flat, spatial, closure) in landmarks {
        let path = root.join(relative);
        assert!(path.is_file(), "corpus landmark missing: {relative}");
        let fold = read_fold(&path).unwrap_or_else(|error| panic!("{relative}: {error}"));
        let model =
            import_fold_document(&fold).unwrap_or_else(|error| panic!("{relative}: {error:?}"));
        assert_eq!(model.line_segments.len(), *segments, "{relative}: segments");
        let dispatched = dispatched_camv(&model);
        assert_eq!(dispatched.flat.len(), *flat, "{relative}: flat violations");
        assert_eq!(
            dispatched.spatial.len(),
            *spatial,
            "{relative}: spatial vertices examined"
        );
        let failures = dispatched
            .spatial
            .iter()
            .filter(|report| {
                report
                    .residual
                    .is_some_and(|residual| residual.to_degrees() > CLOSURE_RESIDUAL_BAR_DEGREES)
            })
            .count();
        assert_eq!(failures, *closure, "{relative}: closure failures");
    }
    println!(
        "corpus landmarks verified: {} files present, {} landmarks measured",
        files.len(),
        landmarks.len()
    );
}

// --- the ground-truth placement oracle --------------------------------------

fn vertices_3d(fold: &FoldDocument) -> Vec<[f64; 3]> {
    fold.vertices_coords
        .iter()
        .map(|c| {
            [
                c.first().copied().unwrap_or(0.0),
                c.get(1).copied().unwrap_or(0.0),
                c.get(2).copied().unwrap_or(0.0),
            ]
        })
        .collect()
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn norm(a: [f64; 3]) -> f64 {
    dot(a, a).sqrt()
}

fn unit(a: [f64; 3]) -> [f64; 3] {
    let n = norm(a);
    if n == 0.0 {
        a
    } else {
        [a[0] / n, a[1] / n, a[2] / n]
    }
}

/// Newell's normal of a placed ring.
fn face_normal(points: &[[f64; 3]], ring: &[usize]) -> [f64; 3] {
    let mut n = [0.0; 3];
    for i in 0..ring.len() {
        let p = points[ring[i]];
        let q = points[ring[(i + 1) % ring.len()]];
        n = [
            n[0] + cross(p, q)[0],
            n[1] + cross(p, q)[1],
            n[2] + cross(p, q)[2],
        ];
    }
    unit(n)
}

/// Measure every interior crease's dihedral from a folded state's own
/// coordinates, and compare it to that state's own declared fold angle.
///
/// Returns `(creases compared, worst declared-vs-measured error, worst
/// magnitude measured)`, all in degrees. The first two bound how closely a
/// placement may be compared to this data; the third answers the separate
/// question of whether the state is flat at all, with no plane fit to argue
/// about.
fn dihedral_survey(fold: &FoldDocument) -> (usize, f64, f64) {
    let points = vertices_3d(fold);
    let normals: Vec<[f64; 3]> = fold
        .faces_vertices
        .iter()
        .map(|ring| face_normal(&points, ring))
        .collect();
    let mut edge_faces: std::collections::BTreeMap<(usize, usize), Vec<usize>> = Default::default();
    for (index, ring) in fold.faces_vertices.iter().enumerate() {
        for i in 0..ring.len() {
            let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
            edge_faces
                .entry((a.min(b), a.max(b)))
                .or_default()
                .push(index);
        }
    }

    let (mut compared, mut worst_error, mut worst_measured) = (0usize, 0.0_f64, 0.0_f64);
    for (index, [a, b]) in fold.edges_vertices.iter().enumerate() {
        let Some(declared) = fold.edges_fold_angle[index] else {
            continue;
        };
        let Some(faces) = edge_faces.get(&(*a.min(b), *a.max(b))) else {
            continue;
        };
        if faces.len() != 2 {
            continue;
        }
        let (nf, ng) = (normals[faces[0]], normals[faces[1]]);
        let axis = unit(sub(points[*b], points[*a]));
        let measured = dot(cross(nf, ng), axis).atan2(dot(nf, ng)).to_degrees();
        // Which ring winds which way relative to this edge is not fixed here,
        // so take the reading that agrees; the magnitude is what is bounded,
        // and a half-turn is sign-ambiguous however it is read.
        worst_error = worst_error.max(
            (measured - declared)
                .abs()
                .min((-measured - declared).abs()),
        );
        worst_measured = worst_measured.max(measured.abs());
        compared += 1;
    }
    (compared, worst_error, worst_measured)
}

/// Mooser's Train, at 0% and 100% folded: the one ground-truth folded state.
///
/// It is the only file anywhere in reach that states, for a real 484-face
/// model, both the fold angles and where every vertex ends up — and it states
/// them with a **vertex correspondence already in place**, so a placement can be
/// compared to it with no matching step. Phase 3 uses it exactly once, as a
/// smoke check that discriminates the placement fault modes (Spike B: correct
/// 1.76e-3 x span, negated-rho 7.3e-2, left-compose 1.43).
///
/// What this test pins is the **noise floor**, because the tempting mistake is
/// to derive a tolerance from it. Three properties bound what may be concluded:
/// the two states are not isometric, the 100% state's own coordinates disagree
/// with its own declared angles, and the "0%" state is not a crease pattern at
/// all. Each is asserted below, and each is asserted as a floor rather than a
/// ceiling — a *lower* bound on the noise — so that this test fails if someone
/// swaps in a cleaner file and the smoke check silently becomes a tolerance.
#[test]
fn moosers_train_pair_is_a_usable_placement_oracle() {
    let Some(root) = corpus("moosers_train_pair_is_a_usable_placement_oracle") else {
        return;
    };
    let flat_state = root.join("MoosersTrainRigid-Gardner.fold");
    let folded_state = root.join("MoosersTrainRigid-Gardner _ 100PercentFolded.fold");
    for path in [&flat_state, &folded_state] {
        assert!(
            path.is_file(),
            "missing ground-truth file: {}",
            path.display()
        );
    }
    let flat = read_fold(&flat_state).expect("read 0% state");
    let folded = read_fold(&folded_state).expect("read 100% state");

    for (label, fold) in [("0%", &flat), ("100%", &folded)] {
        assert_eq!(
            fold.frame_classes,
            vec!["foldedForm".to_string()],
            "{label}: both states declare foldedForm, which is why neither may be \
             committed as a crease-pattern fixture and why import_fold_document \
             (which drops z) must not be the reader"
        );
        assert_eq!(fold.vertices_coords.len(), 463, "{label}: vertices");
        assert_eq!(fold.edges_vertices.len(), 946, "{label}: edges");
        assert_eq!(fold.faces_vertices.len(), 484, "{label}: faces");
        assert!(
            fold.vertices_coords.iter().all(|c| c.len() == 3),
            "{label}: coordinates must be three-component, or there is no folded \
             state to compare against"
        );
        let nulls: Vec<usize> = fold
            .edges_fold_angle
            .iter()
            .enumerate()
            .filter(|(_, angle)| angle.is_none())
            .map(|(index, _)| index)
            .collect();
        assert_eq!(nulls.len(), 127, "{label}: null fold angles");
        for index in nulls {
            assert_eq!(
                fold.edges_assignment[index],
                treemaker_fold::Assignment::Boundary,
                "{label}: a null fold angle on a non-boundary edge. Harmless here \
                 because all 127 are on B edges, but a loader must refuse rather \
                 than flatten a null on an interior edge"
            );
        }
    }

    // The correspondence is free: identical topology, so vertex i is vertex i.
    assert_eq!(
        flat.edges_vertices, folded.edges_vertices,
        "the two states must share a topology, or the correspondence has to be \
         solved for and the oracle stops being cheap"
    );
    assert_eq!(flat.faces_vertices, folded.faces_vertices, "faces differ");

    let flat_points = vertices_3d(&flat);
    let folded_points = vertices_3d(&folded);

    // (1) The two states are not isometric. Paper does not stretch; this data
    // does, by over 1%, which is five to six decades above what the placement
    // achieves on admissible input.
    let mut worst_stretch: f64 = 0.0;
    for [a, b] in &flat.edges_vertices {
        let before = norm(sub(flat_points[*a], flat_points[*b]));
        let after = norm(sub(folded_points[*a], folded_points[*b]));
        if before > 0.0 {
            worst_stretch = worst_stretch.max((after - before).abs() / before);
        }
    }
    assert!(
        (0.005..0.05).contains(&worst_stretch),
        "edge-length drift between the two states is {worst_stretch:.4}, expected \
         about 0.0115. This is the reference data's own noise, not ours"
    );

    // (2) The 100% state's coordinates disagree with its own declared angles by
    // up to about 0.42 degrees, which is why the plan calls this a >=0.5-degree
    // smoke check and nothing finer.
    let (compared, worst_dihedral, _) = dihedral_survey(&folded);
    assert_eq!(compared, 819, "interior creases compared");
    assert!(
        (0.1..0.5).contains(&worst_dihedral),
        "the 100% state's declared-vs-measured dihedral error is \
         {worst_dihedral:.4} degrees, expected about 0.42. A placement check \
         against this file must sit above it, and must never be tightened to it"
    );

    // (3) The "0%" file is a near-flat *folded form*, not a crease pattern: its
    // own faces are not coplanar, by up to 1.29 degrees. Said as a dihedral
    // rather than an out-of-plane distance because that needs no plane fit and
    // no choice of what "the sheet's plane" means. If this file were ever
    // treated as a `creasePattern` frame, every measurement against it would
    // inherit that much error and nothing would say so.
    let (flat_compared, _, worst_flat_dihedral) = dihedral_survey(&flat);
    assert_eq!(
        flat_compared, 819,
        "interior creases compared in the 0% state"
    );
    assert!(
        (0.5..5.0).contains(&worst_flat_dihedral),
        "the 0% state's own faces bend by {worst_flat_dihedral:.4} degrees, \
         expected about 1.29. It is a folded form, and this is the assertion \
         that stops it being adopted as a crease pattern"
    );

    println!(
        "Mooser's Train reference pair: 463 V / 946 E / 484 F, correspondence free; \
         noise floor is {worst_stretch:.4} relative edge stretch, {worst_dihedral:.3} \
         degrees declared-vs-measured dihedral at 100%, {worst_flat_dihedral:.3} \
         degrees of residual bend at 0%"
    );
}

/// Always runs, and says what did not.
///
/// This is the test that makes an absent corpus a reported fact rather than a
/// silence. It also asserts that the committed gate exists, so "green" can
/// never mean "the fixtures directory went missing and every corpus test
/// skipped".
#[test]
fn corpus_coverage_is_stated() {
    let fixtures = repo_root().join("tests/fixtures/fold-angle-3d");
    let committed = std::fs::read_dir(&fixtures)
        .unwrap_or_else(|error| panic!("read {}: {error}", fixtures.display()))
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "fold"))
        .count();
    assert!(
        committed >= 8,
        "the committed 3D fixture corpus is the gate and it has shrunk to \
         {committed} files"
    );

    match std::env::var(CORPUS_ENV) {
        Ok(dir) => println!(
            "non-flat corpus: {committed} committed fixtures checked unconditionally; \
             external corpus at {dir}, so all {} corpus tests ran",
            COVERAGE.len()
        ),
        Err(_) => {
            println!(
                "non-flat corpus: {committed} committed fixtures checked unconditionally.\n\
                 {CORPUS_ENV} is NOT set, so these {} tests checked nothing:",
                COVERAGE.len()
            );
            for (test, covers) in COVERAGE {
                println!("  - {test}: {covers}");
            }
            println!(
                "Set {CORPUS_ENV} to the non-flat corpus checkout, or \
                 {REQUIRE_ENV}=1 to turn the skips into failures."
            );
        }
    }
}
