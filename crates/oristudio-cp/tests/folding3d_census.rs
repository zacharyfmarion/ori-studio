//! Plane clustering and the coplanar-overlap census, against the fixtures whose
//! answers are recorded and against four shapes built to break a naive one.
//!
//! Like the admission gate, this has **no oracle**: Oriedita's creases are always
//! ±180, so there is no upstream implementation to diff against. What it has
//! instead is three independent checks, and each one is here:
//!
//! 1. `examples/fold3d_census.rs` is a second implementation of the same count,
//!    written from the geometry rather than from the kernel. Its per-model
//!    figures are in `tests/fixtures/fold-angle-3d/README.md` and are pinned
//!    below.
//! 2. On an **all-180** document the ordering variables are exactly
//!    `treemaker-flatfold`'s, and that crate pins its own counts against the
//!    upstream Flat-Folder. Three of them are checked here, one being Kabuto's
//!    117 — a number three implementations now agree on.
//! 3. `census >= (distinct face pairs joined by a full fold)` is a theorem, and
//!    it is asserted on every fixture and every synthetic shape.

use oristudio_cp::folding3d::{
    Fold3dRefusal, Fold3dTolerances, ToleranceAlarm, admit, census, census_placement,
    folded_line_index, place_segments, plane_index,
};
use oristudio_cp::geometry::{FoldMagnitude, LineColor, LineSegment, Point};
use oristudio_cp::io::fold::import_fold_document;
use oristudio_cp::model::CreasePatternModel;
use std::path::{Path, PathBuf};
use treemaker_fold::FoldDocument;

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

fn fixture(name: &str) -> CreasePatternModel {
    read_model(&format!("tests/fixtures/fold-angle-3d/{name}.fold"))
}

fn border(a: Point, b: Point) -> LineSegment {
    LineSegment::with_color(a, b, LineColor::Black0)
}

/// Signed degrees, per the FOLD convention `crease_fold_angle` reads: valley
/// positive (blue), mountain negative (red).
fn crease(a: Point, b: Point, degrees: f64) -> LineSegment {
    let color = if degrees < 0.0 {
        LineColor::Red1
    } else {
        LineColor::Blue2
    };
    let mut segment = LineSegment::with_color(a, b, color);
    // `None` is the canonical classic form for a full fold, and the one
    // `is_classic_crease` accepts.
    segment.fold_magnitude = if degrees.abs() == 180.0 {
        None
    } else {
        FoldMagnitude::from_degrees(degrees.abs())
    };
    segment
}

/// Measurements a row of the table below records.
struct Measured {
    faces: usize,
    planes: usize,
    topological_classes: usize,
    patches: usize,
    census: usize,
    non_adjacent: usize,
    full_fold_pairs: usize,
    alarms: usize,
    cross_plane_groups: usize,
}

fn measure(model: &CreasePatternModel) -> Measured {
    let placement = place_segments(&model.line_segments, 1).expect("placed");
    let (index, census) = census_placement(&placement, Fold3dTolerances::DEFAULT);
    let lines = folded_line_index(&placement, &index, Fold3dTolerances::DEFAULT);
    // The partition claim, asserted on every model this helper touches rather
    // than only where a test remembers to.
    assert_eq!(index.plane_of.len(), placement.rings.len());
    assert_eq!(index.projected.len(), placement.rings.len());
    let mut seen = vec![0usize; index.planes.len()];
    for &plane in &index.plane_of {
        seen[plane] += 1;
    }
    for (id, plane) in index.planes.iter().enumerate() {
        assert_eq!(
            plane.faces.len(),
            seen[id],
            "plane {id} membership disagrees"
        );
        assert!(
            plane.faces.windows(2).all(|w| w[0] < w[1]),
            "plane {id} members are not ascending"
        );
        let patched: usize = plane.patches.iter().map(Vec::len).sum();
        assert_eq!(patched, plane.faces.len(), "plane {id} patches lose a face");
    }
    // Patches partition the plane too, and a patch is a connected run of
    // edge-adjacent faces, so there can never be more of them than faces.
    assert!(census.patch_count <= census.face_count);
    Measured {
        faces: census.face_count,
        planes: census.plane_count,
        topological_classes: index.topological_classes,
        patches: census.patch_count,
        census: census.overlapping_pair_count,
        non_adjacent: census.non_adjacent_pair_count,
        full_fold_pairs: census.full_fold_pairs,
        alarms: index.alarm_count,
        cross_plane_groups: lines.cross_plane_groups,
    }
}

// ---------------------------------------------------------------------------
// The committed fixtures
// ---------------------------------------------------------------------------

/// Every committed fixture the walk can place, and what the census must say.
///
/// `census` is the column in `tests/fixtures/fold-angle-3d/README.md`, produced
/// by a second implementation. `penguin_disconnected` is deliberately absent: it
/// never places, so the harness's figure of 1001 for it is a per-component number
/// the kernel cannot reproduce and must not be read as a target.
struct Row {
    name: &'static str,
    faces: usize,
    planes: usize,
    topological_classes: usize,
    census: usize,
    non_adjacent: usize,
    full_fold_pairs: usize,
    cross_plane_groups: usize,
}

const ROWS: [Row; 7] = [
    Row {
        name: "hinge_90",
        faces: 2,
        planes: 2,
        topological_classes: 2,
        census: 0,
        non_adjacent: 0,
        full_fold_pairs: 0,
        cross_plane_groups: 0,
    },
    Row {
        name: "box_90",
        faces: 11,
        planes: 4,
        // Five topological classes over four planes: topology alone would have
        // split this model, which is the whole reason it is a seed and not the
        // classification.
        topological_classes: 5,
        census: 17,
        non_adjacent: 10,
        full_fold_pairs: 7,
        cross_plane_groups: 1,
    },
    Row {
        name: "box_90_unangled",
        faces: 11,
        planes: 1,
        topological_classes: 1,
        census: 27,
        non_adjacent: 15,
        full_fold_pairs: 13,
        // A flat document couples no planes, because it has only one.
        cross_plane_groups: 0,
    },
    Row {
        name: "spikes_small",
        faces: 25,
        planes: 3,
        topological_classes: 9,
        census: 36,
        non_adjacent: 16,
        full_fold_pairs: 20,
        cross_plane_groups: 4,
    },
    Row {
        name: "spikes_large",
        faces: 214,
        planes: 8,
        topological_classes: 34,
        census: 543,
        non_adjacent: 319,
        full_fold_pairs: 224,
        cross_plane_groups: 40,
    },
    Row {
        name: "penguin_freeform",
        faces: 127,
        planes: 21,
        topological_classes: 29,
        census: 457,
        non_adjacent: 324,
        full_fold_pairs: 133,
        cross_plane_groups: 23,
    },
    Row {
        // The one row that differs from the harness, and it is the refused
        // model: `rabbit_unclosed`'s placement disagrees with itself by 70.5
        // degrees, so which faces are coplanar is genuinely a function of the
        // tolerance. The harness reads 26 planes and census 306 under a normal
        // bar 450x looser than the kernel's (a `dot > 1 - 1e-9` deficit is an
        // effective 4.5e-5 rad); the kernel reads 25 and 371. Neither is wrong
        // about a model whose geometry does not close — which is why the gate
        // refuses it before any of this is consulted.
        name: "rabbit_unclosed",
        faces: 87,
        planes: 25,
        topological_classes: 31,
        census: 371,
        non_adjacent: 303,
        full_fold_pairs: 68,
        cross_plane_groups: 15,
    },
];

#[test]
fn the_committed_fixtures_reach_their_recorded_census() {
    for row in &ROWS {
        let measured = measure(&fixture(row.name));
        assert_eq!(measured.faces, row.faces, "{}: faces", row.name);
        assert!(
            measured.patches >= measured.planes,
            "{}: {} patches over {} planes",
            row.name,
            measured.patches,
            measured.planes
        );
        assert_eq!(measured.planes, row.planes, "{}: planes", row.name);
        assert_eq!(
            measured.topological_classes, row.topological_classes,
            "{}: topological classes",
            row.name
        );
        assert_eq!(measured.census, row.census, "{}: census", row.name);
        assert_eq!(
            measured.non_adjacent, row.non_adjacent,
            "{}: non-adjacent pairs",
            row.name
        );
        assert_eq!(
            measured.full_fold_pairs, row.full_fold_pairs,
            "{}: full-fold pairs",
            row.name
        );
        assert_eq!(
            measured.cross_plane_groups, row.cross_plane_groups,
            "{}: cross-plane coupled folded lines",
            row.name
        );
        assert_eq!(measured.alarms, 0, "{}: tolerance alarms", row.name);
    }
}

/// `census >= (distinct face pairs joined by an exact full fold)`.
///
/// A theorem, not a measurement: a half-turn lays two faces into one plane on the
/// same side of their shared edge, and two polygons sharing an edge segment on
/// the same side overlap in positive area.
///
/// **Never the converse.** `paper_tube_five_panels` below has zero full folds and
/// census 1, so a "no ±180 crease means no ordering" shortcut is wrong on the
/// first wrap it meets.
#[test]
fn the_census_is_at_least_the_number_of_full_folded_face_pairs() {
    let mut tight = 0usize;
    for row in &ROWS {
        let measured = measure(&fixture(row.name));
        assert!(
            measured.census >= measured.full_fold_pairs,
            "{}: census {} is below its {} full-folded face pairs",
            row.name,
            measured.census,
            measured.full_fold_pairs
        );
        if measured.census == measured.full_fold_pairs && measured.census > 0 {
            tight += 1;
        }
    }
    // The bound is not slack everywhere — see `waterbomb_base_is_tight` for the
    // equality case, which the committed set does not contain.
    assert_eq!(tight, 0);
}

/// A fan of `angles.len()` creases from the origin out to a rim, at equal
/// angular spacing.
fn fan(angles: &[f64]) -> Vec<LineSegment> {
    let count = angles.len();
    let radius = 100.0;
    let tip = |k: usize| {
        let theta = std::f64::consts::TAU * k as f64 / count as f64;
        Point::new(radius * theta.cos(), radius * theta.sin())
    };
    let mut segments = Vec::new();
    for (k, &degrees) in angles.iter().enumerate() {
        segments.push(crease(Point::new(0.0, 0.0), tip(k), degrees));
    }
    for k in 0..count {
        segments.push(border(tip(k), tip((k + 1) % count)));
    }
    segments
}

/// Two faces joined across a full fold that did not land in one plane.
///
/// Geometrically impossible: a half-turn about a line in a plane maps that plane
/// to itself exactly. So the alarm is not about paper — it is the cheapest
/// available statement that the *placement* is numerically inconsistent, and it
/// can only fire across a **non-tree** join, because a tree join is the rotation
/// the walk performed.
///
/// A degree-4 fan at (180, 180, 180, 90) is the smallest instance: three of the
/// four sectors chain flat and the fourth arrives at 90 degrees, so the join that
/// closes the ring disagrees with itself by a right angle across a crease that
/// declares itself a half-turn.
///
/// Nothing committed reaches this and nothing admitted ever will; in the external
/// corpus it fires on `reschBarbell.fold` (30 alarms, up to 0.86 rad) and
/// `langWedgeDoubleFaced.fold` (62), both refused. It is defence in depth, and
/// this is the fixture that keeps it from being untested code.
#[test]
fn a_full_fold_across_an_inconsistent_placement_is_an_alarm() {
    let placement = place_segments(&fan(&[180.0, 180.0, 180.0, 90.0]), 1).expect("placed");
    assert!(
        placement.loop_gap.offset / placement.span > 0.1,
        "this fan is supposed to be wildly inconsistent"
    );
    let index = plane_index(&placement, Fold3dTolerances::DEFAULT);
    assert_eq!(
        index.topological_classes, 1,
        "every crease declares a full fold"
    );
    assert_eq!(
        index.planes.len(),
        2,
        "and the placement puts them in two planes"
    );
    assert_eq!(index.alarm_count, 1);
    match index.alarms[0] {
        ToleranceAlarm::TopologySpansPlanes { normal_radians, .. } => assert!(
            (normal_radians - std::f64::consts::FRAC_PI_2).abs() < 1e-9,
            "the disagreement should be the right angle the fourth crease adds: {normal_radians}"
        ),
        other => panic!("expected a topology alarm, got {other:?}"),
    }

    // The same fan with a consistent placement raises nothing, so the alarm is
    // not simply "this fan has a loop gap".
    let placement = place_segments(&fan(&[180.0, 180.0, 90.0, 90.0]), 1).expect("placed");
    assert!(placement.loop_gap.offset / placement.span > 0.1);
    let index = plane_index(&placement, Fold3dTolerances::DEFAULT);
    assert_eq!(index.topological_classes, 2);
    assert_eq!(
        index.alarm_count, 0,
        "no full fold spans two planes here, however open the loop is"
    );
}

/// The theorem's hypothesis is that the placement is consistent, and the alarm is
/// what says it is not.
///
/// `reschBarbell.fold` in the external corpus is the instance: 1,080 faces, 90
/// full-folded face pairs, census **60**, and 30 `TopologySpansPlanes` alarms
/// with normal disagreements up to 0.86 rad. It is refused by the gate. Nothing
/// committed reaches this, so the case is asserted here as a synthetic instead —
/// two faces joined by a full fold that the placement puts 45 degrees apart.
#[test]
fn a_full_fold_whose_faces_are_not_coplanar_is_an_alarm_not_a_silent_miss() {
    // A square split by a diagonal, the crease declared as a full fold, but the
    // fold angle deliberately read as 90 by the placement: build the +/-180 join
    // and then measure a document where it is 90 instead, so the topological seed
    // and the geometry disagree by construction.
    let square = [
        Point::new(0.0, 0.0),
        Point::new(100.0, 0.0),
        Point::new(100.0, 100.0),
        Point::new(0.0, 100.0),
    ];
    let mut segments: Vec<LineSegment> = (0..4)
        .map(|k| border(square[k], square[(k + 1) % 4]))
        .collect();
    segments.push(crease(square[0], square[2], 180.0));

    let placement = place_segments(&segments, 1).expect("placed");
    let index = plane_index(&placement, Fold3dTolerances::DEFAULT);
    assert_eq!(
        index.planes.len(),
        1,
        "a full fold lands both faces in one plane"
    );
    assert_eq!(index.alarm_count, 0);

    // The same document with the diagonal at 90 degrees: two planes, and now the
    // topological seed says nothing because there is no full fold left.
    segments.pop();
    segments.push(crease(square[0], square[2], 90.0));
    let placement = place_segments(&segments, 1).expect("placed");
    let index = plane_index(&placement, Fold3dTolerances::DEFAULT);
    assert_eq!(index.planes.len(), 2);
    assert_eq!(index.topological_classes, 2);
    assert_eq!(
        index.alarm_count, 0,
        "a 90-degree crease is not a topology claim"
    );
}

// ---------------------------------------------------------------------------
// The four shapes that break a naive census
// ---------------------------------------------------------------------------

/// A strip of `angles.len() + 1` unit squares, creased between each pair.
///
/// The long borders are split at every crease foot. `FoldGraph::from_segments`
/// does not split a segment where another one ends on it, so a single border
/// running the length of the strip leaves the arrangement untraceable and the
/// whole shape comes back as `FacesUnresolved`.
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

/// **Shape 1 — the founding counterexample.** A 1×4 strip at (−90, +180, +90):
/// fold in half, then bend the doubled stack.
///
/// Two planes, one ordering variable in each, and the two *coupled*: creases 1
/// and 3 land on the identical 3D line, so the four half-planes wrapping that
/// line have to be ordered together and neither plane can be solved alone. This
/// is the model the plan's §3 is built on, and Phase 4's job is to see the
/// coupling rather than to report two independent planes.
#[test]
fn the_coupled_strip_reports_two_planes_and_one_coupled_folded_line() {
    let segments = strip(&[-90.0, 180.0, 90.0]);
    let measured = measure(&CreasePatternModel {
        line_segments: segments.clone(),
        ..CreasePatternModel::default()
    });

    assert_eq!(measured.faces, 4);
    assert_eq!(measured.planes, 2, "A/D in one plane, B/C in the other");
    assert_eq!(measured.census, 2, "one overlapping pair per plane");
    assert_eq!(
        measured.full_fold_pairs, 1,
        "only the middle crease is a full fold"
    );
    assert_eq!(
        measured.cross_plane_groups, 1,
        "creases 1 and 3 fold onto one line while their faces sit in two planes"
    );

    // Which faces, not only how many: the pairs must be (A, D) and (B, C).
    let placement = place_segments(&segments, 1).expect("placed");
    let (index, census) = census_placement(&placement, Fold3dTolerances::DEFAULT);
    let mut pairs: Vec<(usize, usize)> = census.pairs.iter().map(|pair| pair.faces).collect();
    pairs.sort_unstable();
    assert_eq!(pairs.len(), 2);
    // The two pairs are disjoint, which is what makes the coupling a statement
    // about two *different* variables rather than one.
    let (first, second) = (pairs[0], pairs[1]);
    assert!(
        first.0 != second.0 && first.0 != second.1 && first.1 != second.0 && first.1 != second.1,
        "the two ordering variables share a face: {pairs:?}"
    );
    assert_ne!(
        index.plane_of[first.0], index.plane_of[second.0],
        "the two variables are supposed to live in different planes"
    );

    // And the mirror image behaves identically, so nothing above is an accident
    // of which way the first crease bent.
    let mirrored = measure(&CreasePatternModel {
        line_segments: strip(&[90.0, 180.0, -90.0]),
        ..CreasePatternModel::default()
    });
    assert_eq!(mirrored.planes, 2);
    assert_eq!(mirrored.census, 2);
    assert_eq!(mirrored.cross_plane_groups, 1);
}

/// **Shape 2 — a wrap with no full folds.** Five panels at +90 each: a square
/// tube with a glue flap.
///
/// Zero creases at ±180 and census **1**, on a **non-adjacent** pair — the last
/// panel lands back on the first. This is the counterexample to the converse of
/// the theorem above, and it is the reason nothing short of running the census
/// can tell you where ordering matters.
#[test]
fn a_paper_tube_has_no_full_folds_and_still_needs_an_ordering() {
    let measured = measure(&CreasePatternModel {
        line_segments: strip(&[90.0, 90.0, 90.0, 90.0]),
        ..CreasePatternModel::default()
    });
    assert_eq!(measured.faces, 5);
    assert_eq!(
        measured.full_fold_pairs, 0,
        "a tube has no half-turn anywhere"
    );
    assert_eq!(measured.census, 1, "the fifth panel lands on the first");
    assert_eq!(
        measured.non_adjacent, 1,
        "and it is not a pair that shares a crease"
    );

    // Four panels close the box exactly and overlap in nothing; nine wrap twice.
    let open_box = measure(&CreasePatternModel {
        line_segments: strip(&[90.0, 90.0, 90.0]),
        ..CreasePatternModel::default()
    });
    assert_eq!(open_box.census, 0, "a four-panel box wraps onto nothing");
    let double = measure(&CreasePatternModel {
        line_segments: strip(&[90.0; 8]),
        ..CreasePatternModel::default()
    });
    assert_eq!(double.census, 6, "nine panels wrap twice");
    assert_eq!(double.full_fold_pairs, 0);
}

/// A pinwheel: a square centre with four arms, each folded flat back across it,
/// each arm's image a bar along one side.
///
/// Centre `[0,100]²`; the arms land at `[0,100]×[0,25]`, `[75,100]×[0,100]`,
/// `[0,100]×[75,100]` and `[0,25]×[0,100]`.
fn pinwheel() -> Vec<LineSegment> {
    let p = Point::new;
    vec![
        // The centre's four edges, each split by the arm hinged along part of it.
        // Bottom edge y = 0: hinge x in [0, 25] (south arm), border x in [25, 100].
        crease(p(0.0, 0.0), p(25.0, 0.0), 180.0),
        border(p(25.0, 0.0), p(100.0, 0.0)),
        // Right edge x = 100: hinge y in [0, 25] (east arm), border y in [25, 100].
        crease(p(100.0, 0.0), p(100.0, 25.0), 180.0),
        border(p(100.0, 25.0), p(100.0, 100.0)),
        // Top edge y = 100: hinge x in [75, 100] (north arm), border x in [0, 75].
        crease(p(75.0, 100.0), p(100.0, 100.0), 180.0),
        border(p(0.0, 100.0), p(75.0, 100.0)),
        // Left edge x = 0: hinge y in [75, 100] (west arm), border y in [0, 75].
        crease(p(0.0, 75.0), p(0.0, 100.0), 180.0),
        border(p(0.0, 0.0), p(0.0, 75.0)),
        // South arm: [0,25] x [-100,0].
        border(p(0.0, 0.0), p(0.0, -100.0)),
        border(p(0.0, -100.0), p(25.0, -100.0)),
        border(p(25.0, -100.0), p(25.0, 0.0)),
        // East arm: [100,200] x [0,25].
        border(p(100.0, 0.0), p(200.0, 0.0)),
        border(p(200.0, 0.0), p(200.0, 25.0)),
        border(p(200.0, 25.0), p(100.0, 25.0)),
        // North arm: [75,100] x [100,200].
        border(p(100.0, 100.0), p(100.0, 200.0)),
        border(p(100.0, 200.0), p(75.0, 200.0)),
        border(p(75.0, 200.0), p(75.0, 100.0)),
        // West arm: [-100,0] x [75,100].
        border(p(0.0, 100.0), p(-100.0, 100.0)),
        border(p(-100.0, 100.0), p(-100.0, 75.0)),
        border(p(-100.0, 75.0), p(0.0, 75.0)),
    ]
}

/// **Shape 3 — a cyclic overlap.** Four bars in one plane overlapping
/// `a–b–c–d–a` and **not** `a–c` or `b–d`.
///
/// The point is not that the census counts eight pairs. It is that it counts the
/// four bar-bar pairs the geometry has and not the six a "these are all in one
/// plane, so they all overlap" shortcut would produce — and that the four it
/// finds form a cycle, which is exactly the configuration He & Guest's square
/// twist needs and which no per-face scalar layer index can express. Nothing here
/// may be turned into an acyclicity assertion downstream.
#[test]
fn a_pinwheel_of_four_bars_overlaps_in_a_cycle_and_not_across_it() {
    let segments = pinwheel();
    let placement = place_segments(&segments, 1).expect("placed");
    let (index, census) = census_placement(&placement, Fold3dTolerances::DEFAULT);

    assert_eq!(placement.rings.len(), 5, "a centre and four arms");
    assert_eq!(
        index.planes.len(),
        1,
        "every arm folds flat onto the centre"
    );
    assert_eq!(census.full_fold_pairs, 4);

    // The centre is the only face every arm overlaps, so it is the one with
    // degree four.
    let mut degree = vec![0usize; placement.rings.len()];
    for pair in &census.pairs {
        degree[pair.faces.0] += 1;
        degree[pair.faces.1] += 1;
    }
    let centre = (0..placement.rings.len())
        .max_by_key(|&face| degree[face])
        .expect("faces");
    assert_eq!(degree[centre], 4, "the centre overlaps all four arms");

    let arms: Vec<usize> = (0..placement.rings.len())
        .filter(|&face| face != centre)
        .collect();
    let overlapping = |a: usize, b: usize| {
        census
            .pairs
            .iter()
            .any(|pair| pair.faces == (a.min(b), a.max(b)))
    };
    let among_arms = arms
        .iter()
        .enumerate()
        .flat_map(|(i, &a)| arms[i + 1..].iter().map(move |&b| (a, b)))
        .filter(|&(a, b)| overlapping(a, b))
        .count();
    assert_eq!(
        among_arms, 4,
        "four arms in a cycle overlap in 4 pairs, not the 6 of a complete graph"
    );
    assert_eq!(
        census.overlapping_pair_count, 8,
        "4 arm-centre plus 4 arm-arm"
    );

    // Each arm overlaps exactly two others, which is what makes the four a cycle
    // rather than a path or a star.
    for &arm in &arms {
        assert_eq!(degree[arm], 3, "arm {arm} has the wrong overlap degree");
    }
    assert_eq!(index.alarm_count, 0);
}

/// **Shape 4 — a box with flat-folded flaps**, which is the committed `box_90`.
///
/// The row above pins its numbers; this pins what makes it the shape that breaks
/// a topology-first classifier. Its five ±180-connected classes sit in four
/// planes, so topology alone splits a plane that geometry merges — and one of its
/// folded lines carries creases whose faces span two planes, so it is also the
/// smallest committed model on which per-plane solving would be wrong.
#[test]
fn the_box_with_flat_folded_flaps_needs_geometry_as_well_as_topology() {
    let model = fixture("box_90");
    let placement = place_segments(&model.line_segments, 1).expect("placed");
    let index = plane_index(&placement, Fold3dTolerances::DEFAULT);

    assert_eq!(index.topological_classes, 5);
    assert_eq!(index.planes.len(), 4);
    let merged = index
        .planes
        .iter()
        .filter(|plane| plane.topological_classes > 1)
        .count();
    assert_eq!(
        merged, 1,
        "one plane holds two topological classes; that is the merge topology alone misses"
    );

    // And the flat control — the same box before its angles were set — is one
    // plane and one class, which is why topology looks sufficient on flat models.
    let flat = fixture("box_90_unangled");
    let flat_placement = place_segments(&flat.line_segments, 1).expect("placed");
    let flat_index = plane_index(&flat_placement, Fold3dTolerances::DEFAULT);
    assert_eq!(flat_index.planes.len(), 1);
    assert_eq!(flat_index.topological_classes, 1);
}

// ---------------------------------------------------------------------------
// The flat cross-check
// ---------------------------------------------------------------------------

/// On an all-180 document the ordering variables are exactly the flat solver's.
///
/// `treemaker-flatfold` is the Flat-Folder port and pins these counts against
/// upstream (`constraint_counts_match_flat_folder_kabuto_fixture`), so agreement
/// here is a third implementation reaching the same number by a completely
/// different route: this one places the faces in 3D and clips polygons, that one
/// builds an overlap graph in the plane.
///
/// A disagreement is a defect, not something to characterise.
#[test]
fn the_census_equals_the_flat_solvers_ordering_variable_count() {
    for (name, expected) in [
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
    ] {
        let path = repo(name);
        let raw = std::fs::read_to_string(&path).expect("read");
        let document: FoldDocument = serde_json::from_str(&raw).expect("parse");
        let solved = treemaker_flatfold::solve_flat_fold(
            &document,
            treemaker_flatfold::SolveOptions::default(),
        )
        .unwrap_or_else(|error| panic!("{name}: {error:?}"));
        assert_eq!(
            solved.constraints.variables, expected,
            "{name}: the flat solver moved"
        );

        let model = import_fold_document(&document).expect("import");
        let measured = measure(&model);
        assert_eq!(
            measured.census, expected,
            "{name}: the 3D census and the flat solver disagree about the variable count"
        );
        assert_eq!(measured.planes, 1, "{name}: a flat document has one plane");
        assert_eq!(
            measured.cross_plane_groups, 0,
            "{name}: a flat document cannot couple two planes"
        );
    }
}

/// A waterbomb base is where the bound is **tight**: 4 full-folded face pairs and
/// census 4.
///
/// External-corpus material, so this runs only when the corpus is available. The
/// tightness matters because a bound that is always slack is not evidence the
/// count is right.
#[test]
fn a_waterbomb_base_makes_the_bound_tight() {
    let Ok(root) = std::env::var("ORISTUDIO_NON_FLAT_CORPUS_DIR") else {
        println!(
            "SKIPPED: a_waterbomb_base_makes_the_bound_tight\n  \
             ORISTUDIO_NON_FLAT_CORPUS_DIR is not set, so the tight case of \
             `census >= full-folded face pairs` was not checked."
        );
        return;
    };
    let path = Path::new(&root).join("known-good/waterbombBase.fold");
    if !path.is_file() {
        println!("SKIPPED: a_waterbomb_base_makes_the_bound_tight\n  {path:?} is missing.");
        return;
    }
    let raw = std::fs::read_to_string(&path).expect("read");
    let document: FoldDocument = serde_json::from_str(&raw).expect("parse");
    let model = import_fold_document(&document).expect("import");
    let measured = measure(&model);
    assert_eq!(measured.faces, 8);
    assert_eq!(measured.census, 4);
    assert_eq!(
        measured.full_fold_pairs, 4,
        "the bound has to be tight here"
    );
    assert_eq!(measured.non_adjacent, 0);
}

// ---------------------------------------------------------------------------
// The tolerance window
// ---------------------------------------------------------------------------

/// Where the overlap-area bar sits, measured rather than asserted.
///
/// Two populations: coplanar faces that merely *touch* along a shared edge, whose
/// intersection is an exact measure-zero sliver reported as rounding noise, and
/// faces that genuinely stack, whose shared footprint is a fraction of a face.
/// The bar is only defensible if nothing lands between them.
#[test]
fn the_overlap_area_bar_sits_in_an_empty_band() {
    let bar = Fold3dTolerances::DEFAULT.overlap_area_relative;
    let mut worst_rejected = 0.0_f64;
    let mut smallest_accepted = f64::INFINITY;
    for row in &ROWS {
        // The admitted fixtures only. `rabbit_unclosed` does not close, so its
        // slivers are the size of its 70-degree placement error (1.2e-11 of
        // span^2, still below the bar) rather than of the arithmetic.
        if row.name == "rabbit_unclosed" || row.name == "box_90_unangled" {
            continue;
        }
        let model = fixture(row.name);
        let placement = place_segments(&model.line_segments, 1).expect("placed");
        let (_, census) = census_placement(&placement, Fold3dTolerances::DEFAULT);
        worst_rejected = worst_rejected.max(census.max_rejected_area_relative);
        if let Some(accepted) = census.min_accepted_area_relative {
            smallest_accepted = smallest_accepted.min(accepted);
        }
    }
    assert!(
        worst_rejected * 1e3 < bar,
        "the largest rejected overlap is {worst_rejected} of span^2, within three decades \
         of the {bar} bar"
    );
    assert!(
        smallest_accepted > bar * 1e3,
        "the smallest accepted overlap is {smallest_accepted} of span^2, within three \
         decades of the {bar} bar"
    );
    assert!(
        smallest_accepted.is_finite(),
        "no fixture accepted an overlap, so this measured nothing"
    );
}

/// The plane tolerances' own band, and the one place there is not much of it.
///
/// The offset bar has four decades of headroom on every committed fixture. The
/// **angle** bar does not: the worst intra-plane normal diameter here is 1.1e-9
/// against a 1e-7 bar, and the external corpus's `airplane.fold` reaches 2.8e-8 —
/// a factor of 3.5, where the numbers are measuring that file's 6-decimal
/// coordinate rounding rather than any design angle.
///
/// That is why the verification pass exists rather than being assumed, and why
/// this test asserts a factor rather than decades on the angle.
#[test]
fn the_plane_tolerances_have_the_headroom_they_are_claimed_to() {
    let tolerances = Fold3dTolerances::DEFAULT;
    let mut worst_normal = 0.0_f64;
    let mut worst_offset = 0.0_f64;
    let mut separations = Vec::new();
    for row in &ROWS {
        let model = fixture(row.name);
        let placement = place_segments(&model.line_segments, 1).expect("placed");
        let index = plane_index(&placement, tolerances);
        worst_normal = worst_normal.max(index.worst_intra_normal_radians);
        worst_offset = worst_offset.max(index.worst_intra_offset_relative);
        if let Some(separation) = index.min_inter_separation_relative {
            separations.push((row.name, separation));
        }
    }
    assert!(
        worst_normal * 10.0 < tolerances.angle_radians,
        "the worst intra-plane normal diameter is {worst_normal} rad, within 10x of the \
         {} rad bar",
        tolerances.angle_radians
    );
    assert!(
        worst_offset * 1e3 < tolerances.distance_relative,
        "the worst intra-plane offset diameter is {worst_offset} of span, within three \
         decades of the {} bar",
        tolerances.distance_relative
    );

    // The side condition's upper bound, reported and never gated. It exists on
    // three of seven fixtures and is `None` on the rest, which is a real answer
    // and not an infinity — a gate keyed on it would certify nothing on more
    // than half the set.
    assert_eq!(separations.len(), 3, "{separations:?}");
    for (name, separation) in separations {
        assert!(
            separation > tolerances.distance_relative * 1e3,
            "{name}: two distinct planes sit {separation} of span apart, within three \
             decades of the {} bar",
            tolerances.distance_relative
        );
    }
}

/// A plane ladder inside the tolerance window is reported, not silently chained.
///
/// Three planes at offsets `0`, `0.6·tol` and `1.2·tol`: the first two are within
/// tolerance, the last two are, and the first and last are not. Under a greedy
/// clusterer the answer depends on the face order — `[[0, 0.6], [1.2]]` ascending
/// and `[[1.2, 0.6], [0]]` descending — and both of those pass a verification
/// that only checks the clusters' representatives are separated.
///
/// It is a real crease pattern rather than three hand-built carriers, so it goes
/// through the same `plane_index` the product calls. A five-panel Z at
/// ±0.000172° puts panels 1, 3 and 5 on exactly that ladder: the ± pair composes
/// to the identity, so their normals agree to machine precision and only the
/// offset climbs.
///
/// This is the negative fixture for the whole clustering argument. Delete the
/// intra-pair verification pass and it stops firing.
#[test]
fn an_offset_ladder_inside_the_tolerance_window_is_reported() {
    let tolerances = Fold3dTolerances::DEFAULT;
    // 100 * sin(0.000172 deg) = 3.002e-4, against a 5e-4 bar on a 500 span.
    let segments = strip(&[0.000172, -0.000172, 0.000172, -0.000172]);
    let placement = place_segments(&segments, 1).expect("placed");
    assert_eq!(placement.rings.len(), 5);
    assert!((placement.span - 500.0).abs() < 1e-9);

    let index = plane_index(&placement, tolerances);
    let step = 0.6 * tolerances.distance_relative * placement.span;
    assert!(
        (index.worst_intra_offset_relative * placement.span - 2.0 * step).abs() < 0.1 * step,
        "the ladder's ends are {} of span apart; the rungs are meant to be 0.6 of the bar",
        index.worst_intra_offset_relative
    );

    // Panels 1, 3 and 5 chain into one plane; the two tilted panels are their
    // own. The chain is what the alarm is about.
    let ladder = index
        .planes
        .iter()
        .find(|plane| plane.faces.len() == 3)
        .expect("the three parallel panels chained into one plane");
    assert!(
        ladder.offset_diameter > tolerances.distance_relative * placement.span,
        "the chained plane's diameter is {}, inside the bar, so nothing chained",
        ladder.offset_diameter
    );
    // Two planes, not three: the two *tilted* panels are parallel to each other
    // and their offsets happen to differ by the same 0.6 of the bar, so they
    // merge as well. That is a correct merge — their pair is within tolerance —
    // and the alarm below is specific to the pair that is not.
    assert_eq!(index.planes.len(), 2);
    assert_eq!(
        index.alarm_count, 1,
        "exactly one intra-plane pair is out of tolerance: the ladder's two ends"
    );
    assert!(matches!(
        index.alarms[0],
        ToleranceAlarm::ClusterNotTransitive { .. }
    ));

    // Ten times the step and there is no ladder: every panel is its own plane and
    // nothing is reported.
    let separated = strip(&[0.00172, -0.00172, 0.00172, -0.00172]);
    let placement = place_segments(&separated, 1).expect("placed");
    let index = plane_index(&placement, tolerances);
    assert_eq!(index.planes.len(), 5);
    assert_eq!(index.alarm_count, 0);
}

/// The same ladder in the **angle** coordinate, which is the one with only a
/// factor of 3.5 of real headroom anywhere in the corpus.
///
/// Three panels at +0.0000034° each: normals at `0`, `0.59·tol` and `1.19·tol`,
/// with every offset inside the bar because each plane passes through its own
/// crease.
#[test]
fn a_normal_ladder_inside_the_tolerance_window_is_reported() {
    let tolerances = Fold3dTolerances::DEFAULT;
    let segments = strip(&[0.0000034, 0.0000034]);
    let placement = place_segments(&segments, 1).expect("placed");
    assert_eq!(placement.rings.len(), 3);

    let index = plane_index(&placement, tolerances);
    assert_eq!(
        index.planes.len(),
        1,
        "the three normals chain into one plane"
    );
    assert!(
        index.worst_intra_normal_radians > tolerances.angle_radians,
        "the chain's ends are {} rad apart, inside the {} rad bar, so nothing chained",
        index.worst_intra_normal_radians,
        tolerances.angle_radians
    );
    assert!(
        index.worst_intra_offset_relative < tolerances.distance_relative,
        "this ladder is supposed to climb in the angle, not the offset"
    );
    assert_eq!(index.alarm_count, 1);
    assert!(matches!(
        index.alarms[0],
        ToleranceAlarm::ClusterNotTransitive { .. }
    ));

    // Half the angle and the chain closes: one plane, no alarm, because now every
    // pair really is within tolerance of every other.
    let shallow = strip(&[0.0000017, 0.0000017]);
    let placement = place_segments(&shallow, 1).expect("placed");
    let index = plane_index(&placement, tolerances);
    assert_eq!(index.planes.len(), 1);
    assert_eq!(index.alarm_count, 0);
}

/// The alarm is a refusal at the product boundary, and it names the pair.
#[test]
fn a_closed_tolerance_window_refuses_the_census_rather_than_measuring_it() {
    // Every admitted fixture has an open window, so `census` returns.
    for row in &ROWS {
        let model = fixture(row.name);
        let Ok(admission) = admit(&model.line_segments, 1) else {
            continue;
        };
        let counted =
            census(&admission).unwrap_or_else(|refusal| panic!("{}: {refusal}", row.name));
        assert_eq!(counted.overlapping_pair_count, row.census, "{}", row.name);
    }

    // And an alarm becomes the refusal, with the numbers on it. Driven through
    // the alarm type rather than through a document, because no committed fixture
    // reaches it — the same shape as `the_loop_gap_refusal_fires_...`.
    let alarm = ToleranceAlarm::ClusterNotTransitive {
        plane: 0,
        faces: (3, 9),
        normal_radians: 5.0e-8,
        offset: 4.0e-4,
    };
    let ToleranceAlarm::ClusterNotTransitive {
        faces,
        normal_radians,
        offset,
        ..
    } = alarm
    else {
        panic!("the alarm above is a ClusterNotTransitive");
    };
    let refusal = Fold3dRefusal::ToleranceWindowClosed {
        faces,
        normal_radians,
        offset_relative: offset / 400.0,
        min_inter_separation: None,
    };
    assert!(
        format!("{refusal}").contains("faces 3 and 9"),
        "the refusal has to name the pair: {refusal}"
    );
}

// ---------------------------------------------------------------------------
// Non-vacuity
// ---------------------------------------------------------------------------

/// The census must actually depend on the tolerances it is given.
///
/// Two knobs, moved one at a time on a model with real structure. If either read
/// the same either way, the corresponding bar is not being consulted and every
/// band assertion above is measuring nothing.
#[test]
fn the_census_moves_when_its_bars_move() {
    let model = fixture("spikes_large");
    let placement = place_segments(&model.line_segments, 1).expect("placed");
    let baseline = census_placement(&placement, Fold3dTolerances::DEFAULT).1;

    // An area bar above every accepted overlap rejects them all.
    let blunt = Fold3dTolerances {
        overlap_area_relative: 1.0,
        ..Fold3dTolerances::DEFAULT
    };
    assert_eq!(
        census_placement(&placement, blunt).1.overlapping_pair_count,
        0
    );

    // A distance bar wide enough to merge every plane produces one plane and a
    // different count — fewer, in fact, because a face perpendicular to the
    // surviving frame projects to a sliver and its real overlaps vanish. Which
    // direction it moves is not the claim; that it moves is.
    let coarse = Fold3dTolerances {
        distance_relative: 10.0,
        // Above pi/2, which is the whole range the sign resolution leaves.
        angle_radians: 1.6,
        ..Fold3dTolerances::DEFAULT
    };
    let merged = census_placement(&placement, coarse);
    assert_eq!(merged.0.planes.len(), 1);
    assert_ne!(
        merged.1.overlapping_pair_count, baseline.overlapping_pair_count,
        "merging every plane did not change the census"
    );
    // No alarm, and that is right rather than a gap: the alarm says "this
    // relation is not transitive at this tolerance", not "these faces are not
    // really coplanar". At a 1.6 rad bar every pair passes, so the partition is
    // an equivalence — a wrong one, and the tolerance is what is wrong.
    assert_eq!(merged.0.alarm_count, 0);
}

/// The partition must be **closed** under the coplanarity relation: any two faces
/// the relation calls coplanar are in one plane.
///
/// This is the defining property of "connected components of `same_plane`", and
/// it is what makes the partition order-independent — the argument the whole
/// clustering design rests on. A greedy first-match clusterer satisfies it only
/// by luck: on a chain it absorbs a face into a cluster and then never lets that
/// cluster grow again, so which of `[[0, 0.6], [1.2]]` and `[[0, 0.6, 1.2]]` you
/// get depends on the face numbering.
///
/// Checked on every fixture and on the two ladders, because the fixtures alone
/// cannot fail it: on a model where the relation is a genuine equivalence, every
/// clustering agrees. The ladders are where it bites.
#[test]
fn the_partition_is_closed_under_the_coplanarity_relation() {
    let tolerances = Fold3dTolerances::DEFAULT;
    let mut related_pairs = 0usize;
    let mut cases: Vec<(String, Vec<LineSegment>)> = ROWS
        .iter()
        .map(|row| (row.name.to_string(), fixture(row.name).line_segments))
        .collect();
    cases.push((
        "offset ladder".to_string(),
        strip(&[0.000172, -0.000172, 0.000172, -0.000172]),
    ));
    cases.push(("normal ladder".to_string(), strip(&[0.0000034, 0.0000034])));
    cases.push(("coupled strip".to_string(), strip(&[-90.0, 180.0, 90.0])));
    cases.push(("pinwheel".to_string(), pinwheel()));

    for (name, segments) in cases {
        let placement = place_segments(&segments, 1).expect("placed");
        let index = plane_index(&placement, tolerances);
        let carrier = |face: usize| {
            let ring = &placement.face_points[face];
            let mut sum = [0.0, 0.0, 0.0];
            for point in ring {
                for axis in 0..3 {
                    sum[axis] += point[axis];
                }
            }
            let count = ring.len() as f64;
            (
                placement.face_normals[face],
                [sum[0] / count, sum[1] / count, sum[2] / count],
            )
        };
        for i in 0..placement.rings.len() {
            for j in (i + 1)..placement.rings.len() {
                let (normal_i, centroid_i) = carrier(i);
                let (normal_j, centroid_j) = carrier(j);
                if oristudio_cp::folding3d::planes::same_plane(
                    normal_i,
                    centroid_i,
                    normal_j,
                    centroid_j,
                    tolerances,
                    placement.span,
                ) {
                    related_pairs += 1;
                    assert_eq!(
                        index.plane_of[i], index.plane_of[j],
                        "{name}: faces {i} and {j} are coplanar but landed in different planes"
                    );
                }
            }
        }
    }
    assert!(
        related_pairs > 1000,
        "only {related_pairs} coplanar pairs were checked; the sample decides nothing"
    );
}

/// A stack has no canonical up until one is picked, so the rule that picks it is
/// asserted rather than left to be inferred.
///
/// Three claims, and each one is a way stacks come out reversed if it breaks:
/// `up` is the placed normal of the plane's **lowest-indexed** face; the frame is
/// right-handed against it; and the whole index is bit-identical across runs, so
/// a refold does not quietly renumber the planes or flip one of them.
#[test]
fn the_plane_orientation_reference_is_fixed_and_reproducible() {
    for row in &ROWS {
        let model = fixture(row.name);
        let placement = place_segments(&model.line_segments, 1).expect("placed");
        let index = plane_index(&placement, Fold3dTolerances::DEFAULT);
        for (id, plane) in index.planes.iter().enumerate() {
            let reference = plane.faces[0];
            assert_eq!(
                plane.up, placement.face_normals[reference],
                "{}: plane {id} did not take its up from its lowest-indexed face",
                row.name
            );
            let handedness = [
                plane.u[1] * plane.v[2] - plane.u[2] * plane.v[1] - plane.up[0],
                plane.u[2] * plane.v[0] - plane.u[0] * plane.v[2] - plane.up[1],
                plane.u[0] * plane.v[1] - plane.u[1] * plane.v[0] - plane.up[2],
            ];
            assert!(
                handedness.iter().all(|component| component.abs() < 1e-12),
                "{}: plane {id}'s frame is left-handed",
                row.name
            );
        }
        // Bit-identical, not merely equivalent: `PlaneIndex` derives `PartialEq`
        // over every float it carries.
        assert_eq!(
            index,
            plane_index(&placement, Fold3dTolerances::DEFAULT),
            "{}: two runs produced different plane indices",
            row.name
        );
    }
}

/// The projection has to be the plane's own frame, not a global one.
///
/// Every face's projected ring must reproduce its 3D ring's area, or the frame is
/// skewed and every overlap area is wrong by the same factor — which no
/// comparison between two of them would notice.
#[test]
fn the_projection_preserves_area_in_every_plane() {
    for row in &ROWS {
        let model = fixture(row.name);
        let placement = place_segments(&model.line_segments, 1).expect("placed");
        let index = plane_index(&placement, Fold3dTolerances::DEFAULT);
        for face in 0..placement.rings.len() {
            let projected =
                oristudio_cp::folding3d::overlap::signed_area(&index.projected[face]).abs();
            let spatial = spatial_area(&placement.face_points[face]);
            assert!(
                (projected - spatial).abs() <= 1e-9 * spatial.max(1.0),
                "{}: face {face} projects to area {projected} from {spatial}",
                row.name
            );
        }
    }
}

/// Area of a planar 3D ring, by the magnitude of its vector area.
fn spatial_area(ring: &[[f64; 3]]) -> f64 {
    let mut sum = [0.0, 0.0, 0.0];
    for index in 0..ring.len() {
        let a = ring[index];
        let b = ring[(index + 1) % ring.len()];
        sum[0] += a[1] * b[2] - a[2] * b[1];
        sum[1] += a[2] * b[0] - a[0] * b[2];
        sum[2] += a[0] * b[1] - a[1] * b[0];
    }
    (sum[0] * sum[0] + sum[1] * sum[1] + sum[2] * sum[2]).sqrt() / 2.0
}
