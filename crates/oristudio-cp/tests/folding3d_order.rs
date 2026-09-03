//! Layer ordering, against the flat path and against shapes built to break it.
//!
//! There is no upstream to diff a 3D layer order against, so this leans on four
//! independent checks and every one of them is here:
//!
//! 1. **The flat control.** An all-180 document has one plane, and then the 3D
//!    path's subfaces, seeds and answer must be the shipped flat fold's. Kabuto
//!    is 18 faces and 117 ordering variables, so this is not a smoke test.
//! 2. **A backward re-derivation.** [`interleavings`] takes a finished ordering
//!    and asks the crossing question again from the placed normals alone, sharing
//!    neither the winding sign nor the condition roles the forward generator
//!    depends on. It must be empty wherever an ordering exists.
//! 3. **Hand-derivable shapes.** A strip folded in half and then bent has an
//!    answer a reader can check on paper, and it is one of the two states rather
//!    than either.
//! 4. **Guards that fire.** The face-id range check and the seed-contradiction
//!    check both have tests that break them.

use oristudio_cp::folding::{
    FoldedFigureModel, HierarchyRelation, InitialHierarchy, SubFace,
    configure_subfaces_from_segments, initial_hierarchy_from_segments,
    overlap_search_from_segments_with_swap, possible_overlap_search_for_subfaces,
    validate_initial_hierarchy,
};
use oristudio_cp::folding3d::wire::Fold3dVerdict;
use oristudio_cp::folding3d::{
    Advance, Fold3dOrderEnumerator, Fold3dOrderError, Fold3dSession, Fold3dTolerances, SeedKind,
    build_constraints, cell_index, census_placement, folded_line_index, initial_hierarchy_3d,
    interleavings, place_segments,
};
use oristudio_cp::geometry::{FoldMagnitude, LineColor, LineSegment, Point};
use oristudio_cp::io::fold::import_fold_document;
use oristudio_cp::model::CreasePatternModel;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use treemaker_fold::FoldDocument;

mod common;

fn repo(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn read_model(relative: &str) -> CreasePatternModel {
    let path = repo(relative);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let document: FoldDocument = serde_json::from_str(&raw)
        .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()));
    import_fold_document(&document)
        .unwrap_or_else(|error| panic!("import {}: {error:?}", path.display()))
}

/// A committed fixture. Panics on a name held outside the repository — use
/// `try_fixture` for those.
fn fixture(name: &str) -> CreasePatternModel {
    assert!(
        !common::is_external(name),
        "{name} is held outside the repository; use try_fixture"
    );
    read_model(&format!("tests/fixtures/fold-angle-3d/{name}.fold"))
}

/// A fixture, or `None` when it is one of the third-party models held outside
/// the repository and the corpus is not configured. See `tests/common/mod.rs`.
fn try_fixture(test: &str, name: &str) -> Option<CreasePatternModel> {
    let path = common::fixture_path(test, name)?;
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let document: FoldDocument = serde_json::from_str(&raw)
        .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()));
    Some(
        import_fold_document(&document)
            .unwrap_or_else(|error| panic!("import {}: {error:?}", path.display())),
    )
}

fn border(a: Point, b: Point) -> LineSegment {
    LineSegment::with_color(a, b, LineColor::Black0)
}

fn crease(a: Point, b: Point, degrees: f64) -> LineSegment {
    let color = if degrees < 0.0 {
        LineColor::Red1
    } else {
        LineColor::Blue2
    };
    let mut segment = LineSegment::with_color(a, b, color);
    segment.fold_magnitude = if degrees.abs() == 180.0 {
        None
    } else {
        FoldMagnitude::from_degrees(degrees.abs())
    };
    segment
}

/// A strip of `angles.len() + 1` unit squares, creased between each pair.
fn strip(angles: &[f64]) -> Vec<LineSegment> {
    let panels = angles.len() + 1;
    let width = 100.0;
    let far = width * panels as f64;
    let mut segments = vec![
        border(Point::new(0.0, 0.0), Point::new(0.0, width)),
        border(Point::new(far, 0.0), Point::new(far, width)),
    ];
    for index in 0..panels {
        let (x0, x1) = (width * index as f64, width * (index + 1) as f64);
        segments.push(border(Point::new(x0, 0.0), Point::new(x1, 0.0)));
        segments.push(border(Point::new(x0, width), Point::new(x1, width)));
    }
    for (index, &degrees) in angles.iter().enumerate() {
        let x = width * (index + 1) as f64;
        segments.push(crease(Point::new(x, 0.0), Point::new(x, width), degrees));
    }
    segments
}

/// A strip whose first panel folds flat over the second and past it, so the
/// second crease ends up **inside** the first panel's folded image.
///
/// That is the wall rule's own shape and there is no other way to reach it: the
/// crease at `x = 200` carries paper out of the plane along a line that runs
/// through the interior of the face lying over it, and nothing may sit between
/// them on the side the paper rises toward.
fn wall_strip(flat: f64, rise: f64) -> Vec<LineSegment> {
    let (height, first, second, far) = (100.0, 150.0, 200.0, 350.0);
    let mut segments = vec![
        border(Point::new(0.0, 0.0), Point::new(0.0, height)),
        border(Point::new(far, 0.0), Point::new(far, height)),
    ];
    // The rim is split at each crease, or the arrangement has an edge crossing a
    // vertex and declines to trace.
    for (from, to) in [(0.0, first), (first, second), (second, far)] {
        segments.push(border(Point::new(from, 0.0), Point::new(to, 0.0)));
        segments.push(border(Point::new(from, height), Point::new(to, height)));
    }
    segments.push(crease(
        Point::new(first, 0.0),
        Point::new(first, height),
        flat,
    ));
    segments.push(crease(
        Point::new(second, 0.0),
        Point::new(second, height),
        rise,
    ));
    segments
}

/// Three panels whose two outer flaps fold onto opposite halves of the middle
/// one, so the flaps share the middle face and nothing else.
///
/// The middle panel is twice as wide as either flap, which is what makes the two
/// folded images meet at a line rather than overlap: two ordering variables,
/// `(flap, middle)` twice, in two stacks that share exactly one face.
fn two_flaps(first: f64, second: f64, tail: Option<f64>) -> Vec<LineSegment> {
    let height = 100.0;
    let mut cuts = vec![0.0, 100.0, 300.0, 400.0];
    if tail.is_some() {
        cuts.push(500.0);
    }
    let far = *cuts.last().unwrap_or(&400.0);
    let mut segments = vec![
        border(Point::new(0.0, 0.0), Point::new(0.0, height)),
        border(Point::new(far, 0.0), Point::new(far, height)),
    ];
    for pair in cuts.windows(2) {
        segments.push(border(Point::new(pair[0], 0.0), Point::new(pair[1], 0.0)));
        segments.push(border(
            Point::new(pair[0], height),
            Point::new(pair[1], height),
        ));
    }
    let mut angles = vec![(100.0, first), (300.0, second)];
    if let Some(tail) = tail {
        angles.push((400.0, tail));
    }
    for (x, degrees) in angles {
        segments.push(crease(Point::new(x, 0.0), Point::new(x, height), degrees));
    }
    segments
}

/// One solved ordering, plus the numbers a test reads off it.
#[derive(Debug)]
struct Solved {
    relations: BTreeMap<(usize, usize), bool>,
    reported: usize,
    variables: usize,
    components: Vec<usize>,
    undetermined: usize,
    couplings: usize,
    crossings: usize,
    has_next: bool,
}

fn relation_map(relations: &[HierarchyRelation]) -> BTreeMap<(usize, usize), bool> {
    let mut out = BTreeMap::new();
    for relation in relations {
        out.insert((relation.upper_face, relation.lower_face), true);
        out.insert((relation.lower_face, relation.upper_face), false);
    }
    out
}

/// Solve a segment set, and re-derive the crossing question from the answer.
///
/// The re-derivation runs on **every** call rather than in one dedicated test,
/// so a shape added later cannot quietly skip it.
fn solve(segments: &[LineSegment]) -> Result<Solved, Fold3dOrderError> {
    let placement = place_segments(segments, 1).expect("placed");
    let (index, census) = census_placement(&placement, Fold3dTolerances::DEFAULT);
    let enumerator =
        Fold3dOrderEnumerator::new(&placement, &index, &census, Fold3dTolerances::DEFAULT)?;
    let ordering = enumerator.current().clone();
    let relations = relation_map(&ordering.relations);
    let lines = folded_line_index(&placement, &index, Fold3dTolerances::DEFAULT);
    let found = interleavings(
        &placement,
        &index,
        &lines,
        &|a, b| relations.get(&(a, b)).copied(),
        Fold3dTolerances::DEFAULT,
    );
    let crossing: Vec<_> = found.iter().filter(|entry| entry.is_crossing()).collect();
    assert!(
        crossing.is_empty(),
        "the ordering was re-checked from the geometry and interleaves: {crossing:?}"
    );
    // Every committed fixture and every shape here is fully ordered at every
    // folded line, so a chord pair the check could not rank would mean it was
    // looking at less than it claims.
    assert!(
        found.is_empty(),
        "the re-derivation could not rank {} chord pairs: {found:?}",
        found.len()
    );
    assert_eq!(
        ordering.component_of.len(),
        ordering.variables.len(),
        "every variable must name its component"
    );
    Ok(Solved {
        relations,
        reported: ordering.relations.len(),
        variables: ordering.variables.len(),
        components: ordering.component_sizes.clone(),
        undetermined: ordering.undetermined.len(),
        couplings: ordering.couplings,
        crossings: ordering.crossing_count,
        has_next: ordering.has_next,
    })
}

/// Every reported relation is an ordering variable, and every variable is
/// reported.
///
/// The cross-slot cut relations the coupled conditions are read in carry no layer
/// meaning at all — they order faces in different planes, which never share paper
/// — so a caller that drew them would be drawing an invented stacking. This is
/// the assertion that they do not escape.
fn only_variables_are_reported(solved: &Solved, label: &str) {
    assert_eq!(
        solved.undetermined, 0,
        "{label}: {} ordering variables came back undecided",
        solved.undetermined
    );
    assert_eq!(
        solved.reported, solved.variables,
        "{label}: {} relations reported for {} ordering variables",
        solved.reported, solved.variables
    );
}

fn above(solved: &Solved, upper: usize, lower: usize) -> Option<bool> {
    solved.relations.get(&(upper, lower)).copied()
}

// ---------------------------------------------------------------------------
// 1. The flat control
// ---------------------------------------------------------------------------

const FLAT_FIXTURES: [(&str, usize); 4] = [
    ("tests/fixtures/flat-folder/kabuto.fold", 117),
    (
        "tests/fixtures/folding-sequence/fold/treemaker-triad-base.fold",
        15,
    ),
    (
        "tests/fixtures/folding-sequence/fold/accordion-book-fold.fold",
        3,
    ),
    ("tests/fixtures/folding-sequence/fold/squash-local.fold", 28),
];

fn maximal_sets(subfaces: &[SubFace]) -> BTreeSet<Vec<usize>> {
    let mut all: Vec<Vec<usize>> = subfaces
        .iter()
        .filter(|subface| subface.face_ids.len() > 1)
        .map(|subface| {
            let mut ids = subface.face_ids.clone();
            ids.sort_unstable();
            ids
        })
        .collect();
    all.sort();
    all.dedup();
    all.iter()
        .filter(|candidate| {
            !all.iter().any(|other| {
                other.len() > candidate.len() && candidate.iter().all(|face| other.contains(face))
            })
        })
        .cloned()
        .collect()
}

/// On one plane the 3D path must find the flat path's own stacks.
///
/// This is the strongest available check on the cell decomposition: it goes
/// through a different arrangement (per overlap group, on projected
/// coordinates) and has to land on the same face sets the shipped
/// `configure_subfaces` produces from the folded wireframe.
#[test]
fn the_cells_of_a_flat_document_are_the_flat_paths_subfaces() {
    for (path, _) in FLAT_FIXTURES {
        let model = read_model(path);
        let placement = place_segments(&model.line_segments, 1).expect("placed");
        let (index, census) = census_placement(&placement, Fold3dTolerances::DEFAULT);
        assert_eq!(index.planes.len(), 1, "{path} is not an all-180 document");
        let cells =
            cell_index(&index, &census, placement.span, Fold3dTolerances::DEFAULT).expect("cells");
        let flat = configure_subfaces_from_segments(&model.line_segments, 1)
            .expect("flat subfaces")
            .expect("flat subfaces");
        assert_eq!(
            maximal_sets(&cells.subfaces),
            maximal_sets(&flat.subfaces),
            "{path}"
        );
        assert!(
            !cells.subfaces.is_empty(),
            "{path} produced no stack at all, so the comparison above checked nothing"
        );
        // The reduction to maximal sets is not a correctness requirement — a
        // contained set adds no constraint — but a decomposition that stopped
        // reducing would quietly grow the search's subface count with nothing
        // saying so.
        for (index, subface) in cells.subfaces.iter().enumerate() {
            for (other, superset) in cells.subfaces.iter().enumerate() {
                assert!(
                    other == index
                        || !subface
                            .face_ids
                            .iter()
                            .all(|face| superset.face_ids.contains(face)),
                    "{path}: subface {index} is contained in subface {other}"
                );
            }
        }
    }
}

/// The one boolean substitution, checked against the function it replaces.
///
/// `initial_hierarchy_3d` reads `dot(face_normal, up_P) > 0` where
/// `initial_hierarchy_from_graph` reads `first_position % 2 == 1`. On one plane
/// whose `up` is the walk's own root normal the two say the same thing, and this
/// asserts it relation for relation rather than in aggregate.
#[test]
fn the_3d_seeder_reproduces_the_flat_seeder_on_a_flat_document() {
    let mut seeded = 0usize;
    for (path, _) in FLAT_FIXTURES {
        let model = read_model(path);
        let placement = place_segments(&model.line_segments, 1).expect("placed");
        let (index, _) = census_placement(&placement, Fold3dTolerances::DEFAULT);
        let mine: Vec<HierarchyRelation> = initial_hierarchy_3d(&placement, &index)
            .into_iter()
            .map(|seed| {
                assert_eq!(seed.kind, SeedKind::FullFold);
                seed.relation
            })
            .collect();
        let flat = initial_hierarchy_from_segments(&model.line_segments, 1)
            .expect("flat hierarchy")
            .expect("flat hierarchy");
        let sort = |mut relations: Vec<HierarchyRelation>| {
            relations.sort_by_key(|relation| (relation.upper_face, relation.lower_face));
            relations.dedup();
            relations
        };
        assert_eq!(sort(mine.clone()), sort(flat.relations.clone()), "{path}");
        assert!(
            !mine.is_empty(),
            "{path} seeded nothing, so the comparison above checked nothing"
        );
        seeded += mine.len();
    }
    assert!(
        seeded >= 30,
        "{seeded} seeds across four fixtures is too few to have compared anything"
    );
}

/// The whole answer, not just its inputs.
#[test]
fn a_flat_document_through_the_3d_path_gives_the_flat_answer() {
    for (path, variables) in FLAT_FIXTURES {
        let model = read_model(path);
        let solved = solve(&model.line_segments).expect("ordered");
        assert_eq!(solved.variables, variables, "{path}");
        only_variables_are_reported(&solved, path);
        assert_eq!(solved.couplings, 0, "{path} has one plane to couple");
        assert_eq!(solved.crossings, 0, "{path}");

        let flat = overlap_search_from_segments_with_swap(&model.line_segments, 1)
            .expect("flat search")
            .expect("flat search");
        assert!(flat.found, "{path} does not fold flat");
        let theirs = relation_map(&flat.hierarchy.relations);
        let mut compared = 0usize;
        for (&(upper, lower), &value) in &solved.relations {
            if let Some(&other) = theirs.get(&(upper, lower)) {
                assert_eq!(value, other, "{path}: faces {upper} and {lower} disagree");
                compared += 1;
            }
        }
        assert_eq!(
            compared,
            2 * variables,
            "{path}: the flat fold left ordering variables undecided"
        );
    }
}

// ---------------------------------------------------------------------------
// 2. The shapes
// ---------------------------------------------------------------------------

/// **Shape 1 — the founding counterexample.** A 1x4 strip at (-90, +180, +90).
///
/// Creases 1 and 3 land on one folded line while their faces occupy two planes,
/// so the two planes' ordering variables are coupled: this is the case per-plane
/// solving gets right half the time by accident. The full fold seeds its own
/// slot, the coupling carries that across to the other plane, and the answer is
/// one state rather than the two an uncoupled solve would allow.
#[test]
fn the_coupled_strip_is_solved_across_its_two_planes() {
    for angles in [[-90.0, 180.0, 90.0], [90.0, 180.0, -90.0]] {
        let solved = solve(&strip(&angles)).expect("ordered");
        assert_eq!(solved.variables, 2, "{angles:?}");
        assert_eq!(solved.couplings, 1, "{angles:?}");
        assert_eq!(solved.components, vec![2], "{angles:?} did not couple");
        only_variables_are_reported(&solved, &format!("{angles:?}"));

        // The coupling leaves no second state: the shipped enumerator's own
        // "another solution" flag is optimistic — it says the permutation state
        // moved, not that a solution is there — so this presses it.
        let segments = strip(&angles);
        let placement = place_segments(&segments, 1).expect("placed");
        let (index, census) = census_placement(&placement, Fold3dTolerances::DEFAULT);
        let mut enumerator =
            Fold3dOrderEnumerator::new(&placement, &index, &census, Fold3dTolerances::DEFAULT)
                .expect("ordered");
        let first = enumerator.current().relations.clone();
        assert_eq!(
            enumerator.advance().expect("advance"),
            Advance::WrappedToFirst,
            "{angles:?}"
        );
        assert_eq!(enumerator.current().relations, first, "{angles:?}");
    }
}

/// The coupling is load-bearing, not decoration.
///
/// Both variables come out determined, and they are in **different planes** —
/// which is the whole claim: the full fold determines one, and nothing but the
/// coupling can reach the other.
#[test]
fn the_coupled_strips_second_plane_is_decided_only_by_the_coupling() {
    let segments = strip(&[-90.0, 180.0, 90.0]);
    let placement = place_segments(&segments, 1).expect("placed");
    let (index, census) = census_placement(&placement, Fold3dTolerances::DEFAULT);
    assert_eq!(index.planes.len(), 2);
    let lines = folded_line_index(&placement, &index, Fold3dTolerances::DEFAULT);
    let constraints = build_constraints(&placement, &index, &lines, Fold3dTolerances::DEFAULT);
    assert_eq!(constraints.seeds.len(), 1, "one full fold, one seed");
    assert_eq!(constraints.couplings.len(), 1);
    let coupling = constraints.couplings[0];
    assert_ne!(
        index.plane_of[coupling.first.0], index.plane_of[coupling.second.0],
        "the coupling is supposed to span two planes"
    );
    let seeded = census
        .pairs
        .iter()
        .filter(|pair| {
            let seed = constraints.seeds[0].relation;
            pair.faces
                == (
                    seed.upper_face.min(seed.lower_face),
                    seed.upper_face.max(seed.lower_face),
                )
        })
        .count();
    assert_eq!(seeded, 1, "the full fold seeds one of the two variables");
}

/// **Shape 2 — a wrap with no full fold.** Five panels at +90: a square tube
/// with a glue flap.
///
/// One ordering variable, and both answers are real paper: the flap can be
/// tucked inside or left outside. So this is also where the cycling verb is
/// checked past its wrap, which no existing test does.
#[test]
fn a_paper_tube_has_two_states_and_cycles_between_them() {
    let segments = strip(&[90.0; 4]);
    let solved = solve(&segments).expect("ordered");
    assert_eq!(solved.variables, 1);
    assert_eq!(solved.components, vec![1]);
    assert!(solved.has_next);

    let placement = place_segments(&segments, 1).expect("placed");
    let (index, census) = census_placement(&placement, Fold3dTolerances::DEFAULT);
    let mut enumerator =
        Fold3dOrderEnumerator::new(&placement, &index, &census, Fold3dTolerances::DEFAULT)
            .expect("ordered");
    let first = enumerator.current().relations.clone();
    assert_eq!(enumerator.advance().expect("advance"), Advance::Next);
    let second = enumerator.current().relations.clone();
    assert_ne!(first, second, "the second state is the same as the first");
    assert_eq!(
        enumerator.advance().expect("advance"),
        Advance::WrappedToFirst
    );
    assert_eq!(enumerator.current().relations, first);
    // Past the wrap into a second lap, which is the case the flat suite never
    // presses.
    assert_eq!(enumerator.advance().expect("advance"), Advance::Next);
    assert_eq!(enumerator.current().relations, second);
}

/// **Shape 3 — a double wrap.** Nine panels at +90 wrap the tube twice.
#[test]
fn a_double_wrapped_tube_couples_four_ways_and_still_solves() {
    let solved = solve(&strip(&[90.0; 8])).expect("ordered");
    assert_eq!(solved.variables, 6);
    assert_eq!(solved.couplings, 4);
    only_variables_are_reported(&solved, "tube9");
    assert!(solved.has_next);
}

/// **Shape 4 — the flat control among the shapes.** A four-panel accordion.
///
/// One plane, every crease a full fold, so the M/V seeding alone decides the
/// whole stack and there is nothing left to search.
#[test]
fn an_accordion_is_decided_by_its_creases_alone() {
    let solved = solve(&strip(&[180.0, -180.0, 180.0])).expect("ordered");
    assert_eq!(solved.variables, 6);
    assert_eq!(solved.components, vec![6]);
    only_variables_are_reported(&solved, "accordion");
    assert!(!solved.has_next, "an accordion has one stacking");
    // Panel 0 is the outside of the roll, so everything is above it.
    for face in 1..4 {
        assert_eq!(above(&solved, face, 0), Some(true), "face {face}");
    }
}

/// A four-panel open box wraps onto nothing and needs no ordering at all.
#[test]
fn an_open_box_has_no_ordering_to_do() {
    let solved = solve(&strip(&[90.0; 3])).expect("ordered");
    assert_eq!(solved.variables, 0);
    assert!(solved.components.is_empty());
    assert!(!solved.has_next);
}

/// **Shape 5 — two stacks that share one face and touch nowhere else.**
///
/// This is the shape that shows a component is a set of *variables* and not a
/// set of faces. The middle panel carries both variables, but the two flaps land
/// on opposite halves of it, so no subface and no condition holds both — and the
/// constraint graph has two components sharing a face.
///
/// Assigning items to components by looking a face up in a per-component face set
/// silently loses one of them: the shared face resolves to whichever component is
/// found first, every subface of the other component fails the match, that
/// component is handed nothing, its search trivially succeeds, and its variable
/// comes back undetermined under a `Folded` verdict. The flat path decides both,
/// which is what the first half of this test pins.
#[test]
fn two_stacks_sharing_one_face_are_both_decided() {
    let segments = two_flaps(180.0, 180.0, None);

    // The control: all creases are full folds, so the shipped flat folder is
    // authoritative here and it decides both pairs.
    let flat = overlap_search_from_segments_with_swap(&segments, 1)
        .expect("flat search")
        .expect("flat search");
    assert!(flat.found, "the flat control does not fold");
    let theirs = relation_map(&flat.hierarchy.relations);

    let solved = solve(&segments).expect("ordered");
    assert_eq!(solved.variables, 2, "two flaps, two ordering variables");
    assert_eq!(
        solved.components,
        vec![1, 1],
        "the two stacks are supposed to be independent components"
    );
    only_variables_are_reported(&solved, "two_flaps");
    for (&(upper, lower), &value) in &solved.relations {
        assert_eq!(
            theirs.get(&(upper, lower)),
            Some(&value),
            "faces {upper} and {lower} disagree with the flat fold"
        );
    }
}

/// The same shape through the engine boundary, where the answer is a verdict.
///
/// A trailing panel at `+90` makes the document genuinely three-dimensional, so
/// this goes down the same path the app does rather than the flat shortcut, and
/// the assertion is the one a user would notice: `Folded` must not be reported
/// over a stack nobody resolved.
#[test]
fn a_folded_verdict_leaves_no_stack_undetermined() {
    let segments = two_flaps(180.0, 180.0, Some(-90.0));
    let session =
        Fold3dSession::new(&segments, 1, FoldedFigureModel::default()).expect("a 3D session");
    let snapshot = session.snapshot();
    assert_eq!(snapshot.verdict, Fold3dVerdict::Folded);
    assert_eq!(
        snapshot.components,
        vec![1, 1],
        "the two flaps are supposed to be independent components"
    );
    assert!(
        snapshot.planes.len() > 1,
        "the tail panel is supposed to make this a genuinely 3D document"
    );
    assert_eq!(snapshot.undetermined_pairs, 0);
    assert_eq!(snapshot.undetermined_cells, 0);
}

/// **Fold in half, then bend the two halves apart** — and half the M/V choices
/// leave no valid layer order at all.
///
/// The two panels are stacked by the middle crease; the outer creases then carry
/// one panel's neighbour up and the other's down from the same folded line. If
/// the lower panel's neighbour is the one that rises, the two sheets share the
/// slab between the layers and no stacking repairs it. Hand-derivable, and the
/// sign of the middle fold picks which half of the four is legal.
#[test]
fn bending_a_folded_strip_the_wrong_way_admits_no_layer_order() {
    for (angles, legal) in [
        ([90.0, 180.0, 90.0], false),
        ([-90.0, 180.0, -90.0], true),
        ([90.0, -180.0, 90.0], true),
        ([-90.0, -180.0, -90.0], false),
    ] {
        let outcome = solve(&strip(&angles));
        match (legal, outcome) {
            (true, Ok(solved)) => {
                assert_eq!(solved.variables, 1, "{angles:?}");
                assert_eq!(solved.undetermined, 0, "{angles:?}");
            }
            (false, Err(Fold3dOrderError::ContradictorySeeds { first, second, .. })) => {
                let kinds = [first.0, second.0];
                assert!(
                    kinds.contains(&SeedKind::SharedSlot) && kinds.contains(&SeedKind::FullFold),
                    "{angles:?}: expected the wall-side rule to disagree with the crease, got {kinds:?}"
                );
            }
            (legal, other) => panic!("{angles:?}: expected legal={legal}, got {other:?}"),
        }
    }
}

/// **The wall rule**, on the only shape that reaches it.
///
/// A crease carrying paper out of the plane stands on its own line like a wall,
/// and a face whose interior that line crosses cannot be on the side the paper
/// rises toward. Here the flat fold decides the same pair directly, so the two
/// rules have to agree — and they agree for exactly one of the two rise
/// directions, which is what makes this a test of the direction rather than of
/// the existence of a rule.
#[test]
fn a_wall_orders_the_face_its_crease_runs_through() {
    let mut walls = 0usize;
    let mut refused: Vec<(f64, f64)> = Vec::new();
    for (flat, rise) in [
        (180.0, 90.0),
        (180.0, -90.0),
        (-180.0, 90.0),
        (-180.0, -90.0),
    ] {
        let segments = wall_strip(flat, rise);
        let placement = place_segments(&segments, 1).expect("placed");
        let (index, _) = census_placement(&placement, Fold3dTolerances::DEFAULT);
        let lines = folded_line_index(&placement, &index, Fold3dTolerances::DEFAULT);
        let constraints = build_constraints(&placement, &index, &lines, Fold3dTolerances::DEFAULT);
        assert!(
            constraints.wall_seeds > 0,
            "({flat}, {rise}) reached no wall at all, so this test checks nothing"
        );
        walls += constraints.wall_seeds;

        // The wall's **direction**, not its existence. Counting refusals alone
        // does not test it: flipping the rise sign in `pierce_constraint` swaps
        // which two of the four shapes are refused and leaves the count at two,
        // so it passes on a reversed rule. The pierced face is identified as the
        // one the wall's own crease does not join, which needs no face id.
        let wall = constraints
            .seeds
            .iter()
            .find(|seed| seed.kind == SeedKind::Wall)
            .unwrap_or_else(|| panic!("({flat}, {rise}) has a wall count but no wall seed"));
        let join = placement
            .joins
            .iter()
            .find(|join| join.line == wall.line)
            .unwrap_or_else(|| panic!("({flat}, {rise}): the wall's crease joins nothing"));
        let pierced = [wall.relation.upper_face, wall.relation.lower_face]
            .into_iter()
            .find(|&face| face != join.faces.0 && face != join.faces.1)
            .unwrap_or_else(|| panic!("({flat}, {rise}): the wall named only its own faces"));
        // At `rise = -90` the neighbour rises toward this plane's `up`, so it
        // blocks that side and the face it crosses is pushed under the anchor.
        assert_eq!(
            wall.relation.lower_face == pierced,
            rise < 0.0,
            "({flat}, {rise}): the wall pushed the pierced face the wrong way"
        );

        match solve(&segments) {
            Ok(solved) => {
                assert_eq!(solved.variables, 1, "({flat}, {rise})");
                only_variables_are_reported(&solved, &format!("({flat}, {rise})"));
            }
            Err(Fold3dOrderError::ContradictorySeeds { first, second, .. }) => {
                refused.push((flat, rise));
                let kinds = [first.0, second.0];
                assert!(
                    kinds.contains(&SeedKind::Wall) && kinds.contains(&SeedKind::FullFold),
                    "({flat}, {rise}): expected the wall to disagree with the crease, got {kinds:?}"
                );
            }
            other => panic!("({flat}, {rise}): {other:?}"),
        }
    }
    assert!(
        walls >= 4,
        "only {walls} wall determinations across four shapes"
    );
    // *Which* two, not how many: the crease and the wall agree exactly when
    // their signs are opposite, and a reversed wall rule takes the complement of
    // this list while leaving its length at two.
    assert_eq!(
        refused,
        vec![(180.0, 90.0), (-180.0, -90.0)],
        "the wrong half of the rise directions was refused"
    );
}

// ---------------------------------------------------------------------------
// 3. The committed 3D fixtures
// ---------------------------------------------------------------------------

/// Every committed 3D fixture, with the numbers recorded rather than described.
#[test]
fn the_committed_fixtures_order_completely() {
    let expected: [(&str, usize, usize, usize, usize); 6] = [
        // fixture, variables, components, couplings, crossings
        ("hinge_90", 0, 0, 0, 0),
        // Census 0, so no ordering variables — the same degenerate shape as
        // `hinge_90`, reached a different way (six faces over six planes).
        ("hole_vertex_90", 0, 0, 0, 0),
        ("box_90", 17, 1, 0, 0),
        ("spikes_small", 36, 1, 8, 0),
        ("spikes_large", 543, 1, 64, 0),
        ("penguin_freeform", 457, 4, 52, 0),
    ];
    for (name, variables, components, couplings, crossings) in expected {
        let Some(model) = try_fixture("the_committed_fixtures_order_completely", name) else {
            continue;
        };
        let solved = solve(&model.line_segments)
            .unwrap_or_else(|error| panic!("{name} did not order: {error}"));
        assert_eq!(solved.variables, variables, "{name} variables");
        assert_eq!(solved.components.len(), components, "{name} components");
        assert_eq!(solved.couplings, couplings, "{name} couplings");
        assert_eq!(solved.crossings, crossings, "{name} crossings");
        only_variables_are_reported(&solved, name);
        assert!(
            solved.components.windows(2).all(|pair| pair[0] >= pair[1]),
            "{name}: components are not ordered by size descending"
        );
    }
}

/// The odometer moves the largest component first.
///
/// Advancing the smallest leaves the silhouette identical and reads as a broken
/// button, so the invariant is stated on the faces that move rather than on the
/// ordering convention that produces it.
#[test]
fn the_first_press_changes_the_largest_component() {
    let Some(model) = try_fixture(
        "the_first_press_changes_the_largest_component",
        "penguin_freeform",
    ) else {
        return;
    };
    let placement = place_segments(&model.line_segments, 1).expect("placed");
    let (index, census) = census_placement(&placement, Fold3dTolerances::DEFAULT);
    let mut enumerator =
        Fold3dOrderEnumerator::new(&placement, &index, &census, Fold3dTolerances::DEFAULT)
            .expect("ordered");
    let sizes = enumerator.current().component_sizes.clone();
    assert!(
        sizes.len() > 1 && sizes[0] > sizes[1],
        "the fixture has no strictly largest component, so this would pass on anything"
    );
    // The variables of component 0 only. Taking every variable in the model
    // instead is the version of this test that passes when the odometer advances
    // the *smallest* component, which is precisely the bug it exists for.
    let largest: BTreeSet<(usize, usize)> = enumerator
        .current()
        .variables
        .iter()
        .zip(&enumerator.current().component_of)
        .filter(|&(_, &component)| component == 0)
        .map(|(variable, _)| variable.faces)
        .collect();
    assert_eq!(largest.len(), sizes[0]);
    let before = relation_map(&enumerator.current().relations);
    assert_eq!(enumerator.advance().expect("advance"), Advance::Next);
    let after = relation_map(&enumerator.current().relations);
    let moved: BTreeSet<(usize, usize)> = before
        .iter()
        .filter(|(pair, value)| after.get(pair) != Some(value))
        .map(|((a, b), _)| (*a.min(b), *a.max(b)))
        .collect();
    assert!(!moved.is_empty(), "pressing again changed nothing");
    assert!(
        moved.iter().any(|pair| largest.contains(pair)),
        "the press moved nothing in the largest component ({} variables); it changed \
         {} pairs elsewhere",
        sizes[0],
        moved.len()
    );
}

// ---------------------------------------------------------------------------
// 4. Guards that fire
// ---------------------------------------------------------------------------

/// The reason the face-id range check exists.
///
/// A face id at or past `faces_total` does not error: the search reports
/// `found = true` and the face is simply absent from every stack. This asserts
/// the failure mode, so the check that prevents it is not guarding a hazard
/// nobody can demonstrate.
#[test]
fn an_out_of_range_face_id_makes_the_shipped_search_lie() {
    let subfaces = vec![SubFace {
        face_ids: vec![0, 1, 5],
    }];
    let reduced = vec![0usize];
    let narrow = InitialHierarchy {
        faces_total: 3,
        relations: vec![HierarchyRelation {
            upper_face: 0,
            lower_face: 1,
        }],
    };
    let result =
        possible_overlap_search_for_subfaces(&subfaces, &reduced, &narrow, None).expect("search");
    assert!(result.found, "the search is supposed to succeed regardless");
    assert!(
        result
            .hierarchy
            .relations
            .iter()
            .all(|relation| relation.upper_face != 5 && relation.lower_face != 5),
        "face 5 was expected to vanish from the answer"
    );

    let wide = InitialHierarchy {
        faces_total: 6,
        ..narrow.clone()
    };
    let honest =
        possible_overlap_search_for_subfaces(&subfaces, &reduced, &wide, None).expect("search");
    assert!(
        honest
            .hierarchy
            .relations
            .iter()
            .any(|relation| relation.upper_face == 5 || relation.lower_face == 5),
        "with room for it, face 5 must be ordered"
    );
}

/// The cell decomposition's postcondition fires.
///
/// It never fires on real geometry — that is the point of it — so the only way to
/// show it is not dead code is to hand it a census it cannot satisfy: a pair of
/// coplanar faces claimed to overlap that share no arrangement cell. Without the
/// check the solver would leave that variable undecided with nothing saying so,
/// and a lost *triple* would drop the transitivity that forbids a cycle.
#[test]
fn a_pair_with_no_cell_is_refused() {
    let model = fixture("box_90");
    let placement = place_segments(&model.line_segments, 1).expect("placed");
    let (index, mut census) = census_placement(&placement, Fold3dTolerances::DEFAULT);
    assert!(
        cell_index(&index, &census, placement.span, Fold3dTolerances::DEFAULT).is_ok(),
        "box_90 is supposed to decompose before the census is doctored"
    );

    // Two faces of one plane that the census does not pair. Any plane with three
    // members has one, and `box_90` has several.
    let plane = index
        .planes
        .iter()
        .enumerate()
        .find(|(id, plane)| {
            plane.faces.len() > 2
                && plane.faces.iter().any(|&a| {
                    plane.faces.iter().any(|&b| {
                        a < b
                            && !census
                                .pairs
                                .iter()
                                .any(|pair| pair.plane == *id && pair.faces == (a, b))
                    })
                })
        })
        .expect("a plane with an unpaired face pair");
    let (plane_id, faces) = {
        let (id, plane) = plane;
        let pair = plane
            .faces
            .iter()
            .flat_map(|&a| plane.faces.iter().map(move |&b| (a, b)))
            .find(|&(a, b)| {
                a < b
                    && !census
                        .pairs
                        .iter()
                        .any(|pair| pair.plane == id && pair.faces == (a, b))
            })
            .expect("pair");
        (id, pair)
    };
    census.pairs.push(oristudio_cp::folding3d::CoplanarPair {
        plane: plane_id,
        faces,
        area: 1.0,
        edge_adjacent: false,
    });
    assert_eq!(
        cell_index(&index, &census, placement.span, Fold3dTolerances::DEFAULT).err(),
        Some(oristudio_cp::folding3d::CellError::OverlapWithoutCell {
            plane: plane_id,
            faces,
        })
    );
}

/// The other half of the same postcondition fires too.
///
/// A subface whose faces do not overlap would put a total order on paper that
/// never touches, which is what a cell decomposition that has silently produced
/// overlapping cells looks like from the outside. Removing a real pair from the
/// census is the cheapest way to show the check is live.
#[test]
fn a_subface_over_a_non_variable_pair_is_refused() {
    let model = fixture("box_90");
    let placement = place_segments(&model.line_segments, 1).expect("placed");
    let (index, census) = census_placement(&placement, Fold3dTolerances::DEFAULT);
    let doctored: Vec<usize> = (0..census.pairs.len()).collect();
    let mut fired = 0usize;
    for drop in doctored {
        let mut thinned = census.clone();
        let removed = thinned.pairs.remove(drop);
        match cell_index(&index, &thinned, placement.span, Fold3dTolerances::DEFAULT) {
            Err(oristudio_cp::folding3d::CellError::CellWithoutOverlap { faces, .. }) => {
                assert_eq!(faces, removed.faces);
                fired += 1;
            }
            // Dropping the last pair of a plane drops the plane, and then the
            // faces are never looked at. That is the postcondition agreeing with
            // itself, not missing.
            Ok(_) => {}
            other => panic!("dropping {:?} gave {other:?}", removed.faces),
        }
    }
    assert!(
        fired >= census.pairs.len() / 2,
        "only {fired} of {} removals reached the check",
        census.pairs.len()
    );
}

/// The reason the seed set is validated before any table is built.
#[test]
fn the_shipped_table_builder_keeps_whichever_seed_came_first() {
    let forward = InitialHierarchy {
        faces_total: 2,
        relations: vec![
            HierarchyRelation {
                upper_face: 0,
                lower_face: 1,
            },
            HierarchyRelation {
                upper_face: 1,
                lower_face: 0,
            },
        ],
    };
    let backward = InitialHierarchy {
        faces_total: 2,
        relations: forward.relations.iter().rev().copied().collect(),
    };
    // Both are contradictory, and the checked builder says so in both orders.
    assert!(validate_initial_hierarchy(&forward).is_err());
    assert!(validate_initial_hierarchy(&backward).is_err());
    // The search, which uses the unchecked builder, does not.
    let subfaces = vec![SubFace {
        face_ids: vec![0, 1],
    }];
    let reduced = vec![0usize];
    let first =
        possible_overlap_search_for_subfaces(&subfaces, &reduced, &forward, None).expect("search");
    let second =
        possible_overlap_search_for_subfaces(&subfaces, &reduced, &backward, None).expect("search");
    assert!(first.found && second.found);
    assert_ne!(
        first.hierarchy.relations, second.hierarchy.relations,
        "the two orders were expected to give opposite answers"
    );
}

/// A cyclic panel order is legal, and the reuse preserves it.
///
/// He and Guest name the classical square twist at `a > b > c > d > a`. The
/// ordering surface is a bag of pairwise relations for exactly this reason, and
/// the search it is built on accepts the cycle so long as no single stack
/// contains it — which is the real invariant, per arrangement cell rather than
/// globally.
#[test]
fn a_cycle_across_stacks_survives_the_search() {
    let pinwheel = vec![
        SubFace {
            face_ids: vec![0, 1],
        },
        SubFace {
            face_ids: vec![1, 2],
        },
        SubFace {
            face_ids: vec![2, 3],
        },
        SubFace {
            face_ids: vec![3, 0],
        },
    ];
    let reduced: Vec<usize> = (0..pinwheel.len()).collect();
    let cyclic = InitialHierarchy {
        faces_total: 4,
        relations: vec![
            HierarchyRelation {
                upper_face: 0,
                lower_face: 1,
            },
            HierarchyRelation {
                upper_face: 1,
                lower_face: 2,
            },
            HierarchyRelation {
                upper_face: 2,
                lower_face: 3,
            },
            HierarchyRelation {
                upper_face: 3,
                lower_face: 0,
            },
        ],
    };
    assert!(
        validate_initial_hierarchy(&cyclic).is_ok(),
        "a cycle is not a contradiction"
    );
    let result =
        possible_overlap_search_for_subfaces(&pinwheel, &reduced, &cyclic, None).expect("search");
    assert!(result.found, "a cyclic panel order was rejected");
    let relations = relation_map(&result.hierarchy.relations);
    for (upper, lower) in [(0, 1), (1, 2), (2, 3), (3, 0)] {
        assert_eq!(
            relations.get(&(upper, lower)),
            Some(&true),
            "the cycle lost {upper} > {lower}"
        );
    }

    // The same cycle inside **one** stack is a contradiction, and is refused.
    let single = vec![SubFace {
        face_ids: vec![0, 1, 2],
    }];
    let inside = InitialHierarchy {
        faces_total: 3,
        relations: vec![
            HierarchyRelation {
                upper_face: 0,
                lower_face: 1,
            },
            HierarchyRelation {
                upper_face: 1,
                lower_face: 2,
            },
            HierarchyRelation {
                upper_face: 2,
                lower_face: 0,
            },
        ],
    };
    let refused =
        possible_overlap_search_for_subfaces(&single, &[0usize], &inside, None).expect("search");
    assert!(
        !refused.found,
        "a cycle inside one stack must not be accepted"
    );
}

/// The search gives up on a budget, and says so as its own outcome.
///
/// The budget exists because the alternative was not slowness but non-
/// termination: before the subface-loss fix, `hex pleated pangolin` produced
/// candidate stackings forever and the only way out was the Stop button. What
/// this pins is the *shape* of giving up, which is the part a later change can
/// quietly get wrong — `Exhausted` must not arrive as a cancel, because the
/// frontend unwinds those silently, and it must not arrive as "no layer order",
/// because that is a claim about the user's crease pattern.
///
/// Both directions are asserted. A budget the search fits inside must not fire,
/// or the test would pass just as happily against a build that gave up on
/// everything.
#[test]
fn an_exhausted_search_is_its_own_outcome_not_a_verdict_or_a_cancel() {
    // Three faces, one stack, and a cycle among the seeds: unsatisfiable, and
    // cheap enough that its whole search fits in a single outer iteration.
    let subfaces = vec![SubFace {
        face_ids: vec![0, 1, 2],
    }];
    let hierarchy = InitialHierarchy {
        faces_total: 3,
        relations: vec![
            HierarchyRelation {
                upper_face: 0,
                lower_face: 1,
            },
            HierarchyRelation {
                upper_face: 1,
                lower_face: 2,
            },
            HierarchyRelation {
                upper_face: 2,
                lower_face: 0,
            },
        ],
    };
    let build = || {
        oristudio_cp::folding::WorkerOverlapEnumerator::from_subfaces(
            &subfaces,
            &[0usize],
            &hierarchy,
            None,
        )
        .expect("build")
    };

    // Unbounded it settles on "no stacking exists" rather than running away, so
    // the budget below is the only thing under test.
    let unbounded = build()
        .possible_overlapping_search(true)
        .expect("unbounded search");
    assert!(!unbounded.found, "the fixture is meant to be unsatisfiable");

    // One iteration is all this search needs, so a budget of one is room to
    // spare and must leave the answer untouched.
    let within = build()
        .within_iteration_budget(1)
        .possible_overlapping_search(true)
        .expect("a budget the search fits inside must not fire");
    assert_eq!(within.found, unbounded.found);

    // Zero is the only budget this fixture can exceed. On a model that needs
    // thousands the same branch is reached the same way.
    let error = build()
        .within_iteration_budget(0)
        .possible_overlapping_search(true)
        .expect_err("a zero budget must stop before the first iteration");

    assert!(
        matches!(
            error,
            oristudio_cp::folding::WorkerOverlapSearchError::Exhausted { iterations: 1 }
        ),
        "giving up reported as {error:?}"
    );
    assert!(
        !error.is_cancelled(),
        "an exhausted search must not read as the user pressing Stop"
    );
}

/// The flat path keeps upstream's unbounded loop.
///
/// The budget is opt-in for a reason: `WorkerOverlapEnumerator` is shared, and
/// upstream's `while (Sid != 0)` has no bound at all. A default budget would
/// change the flat path's answer on a hard model without anyone asking for it.
#[test]
fn the_flat_path_sets_no_iteration_budget() {
    let subfaces = vec![SubFace {
        face_ids: vec![0, 1, 2],
    }];
    let hierarchy = InitialHierarchy {
        faces_total: 3,
        relations: Vec::new(),
    };
    let search = possible_overlap_search_for_subfaces(&subfaces, &[0usize], &hierarchy, None)
        .expect("the flat entry point must not be bounded");
    assert!(search.found);
}
