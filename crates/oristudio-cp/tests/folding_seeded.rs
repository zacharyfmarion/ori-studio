//! The seeded core of the flat fold (`implementation-plans/layer-order-dialog.md`,
//! row E1): a figure whose layer-order search starts from given relations as
//! well as the creases' letters.
//!
//! Two promises make it safe, and this file holds both.
//!
//! - **With no seeds nothing changes**: every flat figure reaches the same
//!   solutions in the same order as before, press for press of "Another
//!   solution". "Before" is a recording, not a second code path. The committed
//!   golden, `tests/fixtures/oristudio-cp/flat-fold-case-sequences.json`, was
//!   written by the unseeded entry before the seeded core existed, so a seeded
//!   session with no seeds is compared against what the shipped fold did, not
//!   against itself.
//! - **Seeded with an order Oriedita found, the fold shows that order**, and its
//!   restart and its render's fallback search stay on it.
//!
//! Regenerate the golden only after an intentional change to the flat search:
//!
//! ```sh
//! ORISTUDIO_UPDATE_GOLDEN=1 cargo test -p oristudio-cp --test folding_seeded
//! ```

use std::path::{Path, PathBuf};

use oristudio_cp::folding::{
    DisplayStyle, EstimationOrder, FoldOutcome, FoldedFigureModel, FoldedFigureRenderOptions,
    FoldedFigureRenderSnapshot, FoldedFigureState, FoldedRenderInputs, FoldingEstimate,
    FoldingEstimateError, FoldingEstimateSession, HierarchyRelation, HierarchySeedError,
    InitialHierarchy, WorkerOverlapSearchError, fold_another,
    folded_figure_render_snapshot_from_session, folding_estimate_to_case,
    initial_hierarchy_from_segments,
};
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::io::fold::import_fold_document;
use oristudio_cp::io::{cp, ori};
use oristudio_cp::session::EngineError;
use serde::{Deserialize, Serialize};

/// Presses of "Another solution" after the first fold, at most. Enough to walk
/// every committed fixture to its end and through the wrap back to the first
/// solution.
const MAX_PRESSES: usize = 48;

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures")
}

fn golden_path() -> PathBuf {
    fixture_root().join("oristudio-cp/flat-fold-case-sequences.json")
}

fn segment(ax: f64, ay: f64, bx: f64, by: f64, color: LineColor) -> LineSegment {
    LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
}

fn square_with(diagonals: &[(f64, f64, f64, f64, LineColor)]) -> Vec<LineSegment> {
    let mut segments = vec![
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Black0),
        segment(1.0, 0.0, 1.0, 1.0, LineColor::Black0),
        segment(1.0, 1.0, 0.0, 1.0, LineColor::Black0),
        segment(0.0, 1.0, 0.0, 0.0, LineColor::Black0),
    ];
    segments.extend(
        diagonals
            .iter()
            .map(|&(ax, ay, bx, by, color)| segment(ax, ay, bx, by, color)),
    );
    segments
}

/// The folding colours of a file, as Edit hands them to the fold.
fn folding_lines(segments: Vec<LineSegment>) -> Vec<LineSegment> {
    segments
        .into_iter()
        .filter(|segment| segment.color.is_folding_line())
        .collect()
}

fn fold_file(relative: &str) -> Vec<LineSegment> {
    let path = fixture_root().join(relative);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let document: treemaker_fold::FoldDocument = serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()));
    let model = import_fold_document(&document)
        .unwrap_or_else(|error| panic!("import {}: {error:?}", path.display()));
    folding_lines(model.line_segments)
}

fn ori_file(relative: &str) -> Vec<LineSegment> {
    let path = fixture_root().join(relative);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let document = ori::import_ori_json(&text)
        .unwrap_or_else(|error| panic!("import {}: {error:?}", path.display()));
    folding_lines(document.crease_pattern.line_segments)
}

fn cp_file(relative: &str) -> Vec<LineSegment> {
    let path = fixture_root().join(relative);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let model = cp::import_cp_str(&text)
        .unwrap_or_else(|error| panic!("import {}: {error:?}", path.display()));
    folding_lines(model.line_segments)
}

/// Every flat fixture the kernel's fold tests draw from, plus the Flat-Folder
/// and Fold-sample crease patterns: single solutions, many solutions, a hole,
/// and two layer-order contradictions.
fn flat_fixtures() -> Vec<(&'static str, Vec<LineSegment>)> {
    vec![
        (
            "square_with_diagonal",
            square_with(&[(0.0, 0.0, 1.0, 1.0, LineColor::Red1)]),
        ),
        (
            "two_square_strip",
            vec![
                segment(0.0, 0.0, 10.0, 0.0, LineColor::Black0),
                segment(10.0, 0.0, 20.0, 0.0, LineColor::Black0),
                segment(20.0, 0.0, 20.0, 10.0, LineColor::Black0),
                segment(20.0, 10.0, 10.0, 10.0, LineColor::Black0),
                segment(10.0, 10.0, 0.0, 10.0, LineColor::Black0),
                segment(0.0, 10.0, 0.0, 0.0, LineColor::Black0),
                segment(10.0, 0.0, 10.0, 10.0, LineColor::Red1),
            ],
        ),
        (
            "quartered_square",
            square_with(&[
                (0.5, 0.5, 0.0, 0.0, LineColor::Red1),
                (0.5, 0.5, 1.0, 0.0, LineColor::Blue2),
                (0.5, 0.5, 1.0, 1.0, LineColor::Red1),
                (0.5, 0.5, 0.0, 1.0, LineColor::Blue2),
            ]),
        ),
        (
            "solution_sample_1",
            cp_file("oriedita/solution_sample_1.cp"),
        ),
        (
            "failing_global_flat_fold",
            ori_file("oriedita/failing_global_flat_fold.ori"),
        ),
        (
            "holed_sheet_spiral",
            ori_file("oriedita/holed_sheet_spiral.ori"),
        ),
        (
            "holed_frame_collinear",
            ori_file("oriedita/holed_frame_collinear.ori"),
        ),
        ("kabuto", fold_file("flat-folder/kabuto.fold")),
        ("bad_twist", fold_file("flat-folder/bad_twist.fold")),
        ("r069-s07", fold_file("flat-folder/r069-s07.fold")),
        ("r271-s03", fold_file("flat-folder/r271-s03.fold")),
        (
            "pleat-in-eighths",
            fold_file("fold-samples/pleat-in-eighths.fold"),
        ),
        (
            "preliminary-base",
            fold_file("fold-samples/preliminary-base.fold"),
        ),
        (
            "waterbomb-base",
            fold_file("fold-samples/waterbomb-base.fold"),
        ),
    ]
}

/// What the figure shows after one press: its case, the enumeration's state,
/// and the layer order it found, as a count and a digest of its relations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Case {
    press: usize,
    case: usize,
    discovered: usize,
    another: bool,
    outcome: String,
    step: String,
    contradiction: Option<[usize; 2]>,
    relations: usize,
    digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Sequence {
    fixture: String,
    cases: Vec<Case>,
}

/// FNV-1a over the found order's relations, in the order the search reports
/// them (sorted by upper face, then lower).
fn hierarchy_digest(estimate: &FoldingEstimate) -> (usize, String) {
    let Some(overlap) = estimate.overlap.as_ref().filter(|overlap| overlap.found) else {
        return (0, "none".to_string());
    };
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for relation in &overlap.hierarchy.relations {
        for value in [relation.upper_face as u64, relation.lower_face as u64] {
            for byte in value.to_le_bytes() {
                hash ^= u64::from(byte);
                hash = hash.wrapping_mul(0x0100_0000_01b3);
            }
        }
    }
    (overlap.hierarchy.relations.len(), format!("{hash:016x}"))
}

fn case_of(press: usize, estimate: &FoldingEstimate) -> Case {
    let (relations, digest) = hierarchy_digest(estimate);
    Case {
        press,
        case: estimate.current_fold_case,
        discovered: estimate.discovered_fold_cases,
        another: estimate.find_another_overlap_valid,
        outcome: format!("{:?}", estimate.outcome),
        step: format!("{:?}", estimate.estimation_step),
        contradiction: estimate
            .contradiction
            .map(|contradiction| [contradiction.upper_face, contradiction.lower_face]),
        relations,
        digest,
    }
}

/// The figure's first fold (`Order5`), then "Another solution" until the
/// enumeration ends, and one press more: the wrap back to the first solution,
/// or the no-op of a figure with one.
fn case_sequence(mut session: FoldingEstimateSession) -> Vec<Case> {
    let first = session
        .folding_estimated(EstimationOrder::Order5)
        .expect("the first fold concludes");
    let mut cases = vec![case_of(0, &first)];
    let mut another = first.find_another_overlap_valid;
    for press in 1..=MAX_PRESSES {
        let estimate = fold_another(&mut session).expect("another solution");
        cases.push(case_of(press, &estimate));
        if !another {
            break;
        }
        another = estimate.find_another_overlap_valid;
    }
    cases
}

fn sequences(session_for: impl Fn(&[LineSegment]) -> FoldingEstimateSession) -> Vec<Sequence> {
    flat_fixtures()
        .into_iter()
        .map(|(name, segments)| Sequence {
            fixture: name.to_string(),
            cases: case_sequence(session_for(&segments)),
        })
        .collect()
}

fn committed_golden() -> Vec<Sequence> {
    let path = golden_path();
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "missing golden {}: {error}. Regenerate with ORISTUDIO_UPDATE_GOLDEN=1.",
            path.display()
        )
    });
    serde_json::from_str(&text).expect("parse the golden")
}

fn assert_sequences_match(label: &str, actual: &[Sequence], expected: &[Sequence]) {
    assert_eq!(
        actual.iter().map(|s| &s.fixture).collect::<Vec<_>>(),
        expected.iter().map(|s| &s.fixture).collect::<Vec<_>>(),
        "{label}: the fixture list changed; regenerate the golden"
    );
    for (actual, expected) in actual.iter().zip(expected) {
        assert_eq!(
            actual.cases, expected.cases,
            "{label}: {} left the shipped case sequence",
            actual.fixture
        );
    }
}

/// The unseeded entry still walks every fixture exactly as it did when the
/// golden was written.
#[test]
fn the_unseeded_fold_keeps_the_committed_case_sequence() {
    let actual = sequences(|segments| FoldingEstimateSession::new(segments, 1));

    if std::env::var_os("ORISTUDIO_UPDATE_GOLDEN").is_some() {
        let path = golden_path();
        let text = format!(
            "{}\n",
            serde_json::to_string_pretty(&actual).expect("serialise the golden")
        );
        std::fs::write(&path, text).expect("write the golden");
        return;
    }

    assert_sequences_match("unseeded", &actual, &committed_golden());
}

// --- empty and redundant seeds ---------------------------------------------

/// A seeded session with no seeds is the shipped fold: on every fixture, the
/// case sequence the unseeded entry recorded, through every press of
/// "Another solution" and the wrap.
#[test]
fn empty_seeds_keep_the_committed_case_sequence() {
    let actual = sequences(|segments| FoldingEstimateSession::with_seeds(segments, 1, Vec::new()));
    assert_sequences_match("empty seeds", &actual, &committed_golden());
}

fn letters(segments: &[LineSegment]) -> InitialHierarchy {
    initial_hierarchy_from_segments(segments, 1)
        .expect("the letters")
        .expect("faces")
}

/// Seeds that add nothing, the creases' own letters, take the seeded branch
/// (the check against the letters, the iteration budget) and leave every case
/// where it was. So the branch itself moves no case; only what a seed says can.
#[test]
fn seeds_the_letters_already_state_keep_the_committed_case_sequence() {
    let actual = sequences(|segments| {
        let relations = letters(segments).relations;
        assert!(!relations.is_empty(), "a fixture with no letters to seed");
        FoldingEstimateSession::with_seeds(segments, 1, relations)
    });
    assert_sequences_match("the letters as seeds", &actual, &committed_golden());
}

// --- a seeded order is the order shown --------------------------------------

/// The orders Oriedita itself finds for a fixture, in the order "Another
/// solution" walks them: each solved case's full relations.
fn oriedita_orders(segments: &[LineSegment]) -> Vec<InitialHierarchy> {
    let mut session = FoldingEstimateSession::new(segments, 1);
    let mut estimate = session
        .folding_estimated(EstimationOrder::Order5)
        .expect("the first fold");
    let mut orders = Vec::new();
    loop {
        if estimate.outcome == FoldOutcome::Solved
            && let Some(hierarchy) = shown(&estimate)
        {
            orders.push(hierarchy.clone());
        }
        if !estimate.find_another_overlap_valid || orders.len() > MAX_PRESSES {
            break;
        }
        estimate = session
            .folding_estimated(EstimationOrder::Order6)
            .expect("another solution");
    }
    orders
}

/// The layer order the figure holds, when its search found one.
fn shown(estimate: &FoldingEstimate) -> Option<&InitialHierarchy> {
    estimate
        .overlap
        .as_ref()
        .filter(|overlap| overlap.found)
        .map(|overlap| &overlap.hierarchy)
}

fn paper_render(
    session: &FoldingEstimateSession,
    state: FoldedFigureState,
) -> FoldedFigureRenderSnapshot {
    let inputs = FoldedRenderInputs::for_session(session)
        .expect("render inputs")
        .expect("faces");
    folded_figure_render_snapshot_from_session(
        session,
        &inputs,
        DisplayStyle::Paper5,
        FoldedFigureModel {
            state,
            ..FoldedFigureModel::default()
        },
        FoldedFigureRenderOptions::default(),
    )
    .expect("the render")
    .expect("a Paper5 picture")
}

/// A session at `Order3`: faces and subfaces, no search yet, so a `Paper5`
/// render of it has only its fallback search to draw from.
fn unsearched(segments: &[LineSegment], seeds: Vec<HierarchyRelation>) -> FoldingEstimateSession {
    let mut session = FoldingEstimateSession::with_seeds(segments, 1, seeds);
    let estimate = session
        .folding_estimated(EstimationOrder::Order3)
        .expect("Order3");
    assert!(estimate.overlap.is_none(), "Order3 searched");
    session
}

/// Seeded with the full relations of any order Oriedita found, on any fixture,
/// the fold finds exactly that order as its first and only solution; a
/// restart, which rebuilds the search, comes back to it; and a render that has
/// to search (nothing solved yet) draws it, not the unseeded first order.
///
/// "Another solution" is pressed too, but with one solution it has nowhere to
/// go and never wraps, so it cannot fail here: the wrap is held to the seeds
/// by `a_partly_seeded_figure_walks_only_the_solutions_that_honour_the_seeds`.
#[test]
fn seeding_an_order_oriedita_found_reproduces_it() {
    let (mut orders_checked, mut fallbacks_with_teeth) = (0, 0);
    for (name, segments) in flat_fixtures() {
        let orders = oriedita_orders(&segments);
        if orders.is_empty() {
            continue;
        }
        let first_order_picture = [FoldedFigureState::Front0, FoldedFigureState::Back1]
            .map(|state| paper_render(&unsearched(&segments, Vec::new()), state));
        for (index, order) in orders.iter().enumerate() {
            let case = index + 1;
            let mut seeded =
                FoldingEstimateSession::with_seeds(&segments, 1, order.relations.clone());
            let first = seeded
                .folding_estimated(EstimationOrder::Order5)
                .unwrap_or_else(|error| panic!("{name} case {case}: {error:?}"));
            assert_eq!(first.outcome, FoldOutcome::Solved, "{name} case {case}");
            assert_eq!(
                (first.current_fold_case, first.discovered_fold_cases),
                (1, 1),
                "{name} case {case}"
            );
            assert_eq!(
                shown(&first),
                Some(order),
                "{name} case {case}: not the seeded order"
            );
            assert!(
                !first.find_another_overlap_valid,
                "{name} case {case}: a whole order seeded leaves another solution"
            );

            // One solution: the press neither searches nor wraps.
            let another = fold_another(&mut seeded).expect("another solution");
            assert_eq!(
                shown(&another),
                Some(order),
                "{name} case {case}: another solution"
            );
            let restarted = seeded.restart().expect("restart");
            assert_eq!(
                shown(&restarted),
                Some(order),
                "{name} case {case}: restart"
            );

            // The render's fallback search carries the seeds.
            let mut unseeded = FoldingEstimateSession::new(&segments, 1);
            folding_estimate_to_case(&mut unseeded, case, EstimationOrder::Order5)
                .expect("seek the case");
            assert_eq!(shown(unseeded.estimate()), Some(order));
            let fallback = unsearched(&segments, order.relations.clone());
            for (side, state) in [FoldedFigureState::Front0, FoldedFigureState::Back1]
                .into_iter()
                .enumerate()
            {
                let solved = paper_render(&unseeded, state);
                assert_eq!(
                    paper_render(&fallback, state),
                    solved,
                    "{name} case {case} {state:?}: the fallback drew another order"
                );
                if solved != first_order_picture[side] {
                    fallbacks_with_teeth += 1;
                }
            }
            orders_checked += 1;
        }
    }
    // Every solution of every solved fixture: 1 each for the eight with one,
    // and solution_sample_1's 16, kabuto's 9 and r069-s07's 5.
    assert_eq!(orders_checked, 38);
    // Sides where the order seeded draws differently from the first order, so
    // an unseeded fallback would have been caught.
    println!("{orders_checked} orders reproduced; {fallbacks_with_teeth} sides draw unlike case 1");
    assert!(fallbacks_with_teeth > 0);
}

fn relation_pair(relation: &HierarchyRelation) -> (usize, usize) {
    (relation.upper_face, relation.lower_face)
}

fn honours(order: &InitialHierarchy, seed: &HierarchyRelation) -> bool {
    order.relations.contains(seed)
}

/// Partly seeded, a figure keeps several solutions, and "Another solution"
/// walks exactly those: every case it shows, through the wrap back to the
/// first, honours the seed, and the cases are Oriedita's own solutions that do.
///
/// The seed is a pair Oriedita's solutions order both ways, taken the way its
/// first solution does not, by at least two solutions. So the walk has
/// somewhere to go and does wrap, and a wrap that forgot the seeds would land
/// on an order that breaks them.
#[test]
fn a_partly_seeded_figure_walks_only_the_solutions_that_honour_the_seeds() {
    let fixtures = flat_fixtures();
    for name in ["solution_sample_1", "kabuto", "r069-s07"] {
        let segments = &fixtures
            .iter()
            .find(|(fixture, _)| *fixture == name)
            .expect("a fixture")
            .1;
        let orders = oriedita_orders(segments);
        let seed = orders[0]
            .relations
            .iter()
            .map(|relation| HierarchyRelation {
                upper_face: relation.lower_face,
                lower_face: relation.upper_face,
            })
            .find(|seed| orders.iter().filter(|order| honours(order, seed)).count() >= 2)
            .unwrap_or_else(|| panic!("{name}: no pair two solutions order against the first"));
        let mut expected: Vec<&InitialHierarchy> = orders
            .iter()
            .filter(|order| honours(order, &seed))
            .collect();

        let mut session = FoldingEstimateSession::with_seeds(segments, 1, vec![seed]);
        let mut estimate = session
            .folding_estimated(EstimationOrder::Order5)
            .unwrap_or_else(|error| panic!("{name}: {error:?}"));
        let first = shown(&estimate).cloned().expect("a first solution");
        let mut walked = vec![first.clone()];
        let mut presses = 0;
        while estimate.find_another_overlap_valid {
            estimate = fold_another(&mut session).expect("another solution");
            presses += 1;
            assert!(presses <= MAX_PRESSES, "{name}: the walk does not end");
            walked.extend(shown(&estimate).cloned());
        }
        assert!(walked.len() >= 2, "{name}: one solution, so nothing wraps");
        let wrapped = fold_another(&mut session).expect("the wrap");
        assert_eq!(
            wrapped.current_fold_case, 1,
            "{name}: the press did not wrap"
        );
        assert_eq!(
            shown(&wrapped),
            Some(&first),
            "{name}: the wrap left the seeded first solution"
        );

        for (index, order) in walked.iter().enumerate() {
            assert!(
                honours(order, &seed),
                "{name} case {}: breaks the seed {:?}",
                index + 1,
                relation_pair(&seed)
            );
        }
        let mut walked: Vec<&InitialHierarchy> = walked.iter().collect();
        let key = |order: &&InitialHierarchy| {
            order
                .relations
                .iter()
                .map(relation_pair)
                .collect::<Vec<_>>()
        };
        walked.sort_by_key(key);
        expected.sort_by_key(key);
        assert_eq!(
            walked, expected,
            "{name}: not Oriedita's own solutions that honour the seed"
        );
        println!(
            "{name}: seeded {:?}, {} of {} solutions walked, wrapped to case 1",
            relation_pair(&seed),
            walked.len(),
            orders.len()
        );
    }
}

// --- refusals ---------------------------------------------------------------

fn kabuto() -> Vec<LineSegment> {
    fold_file("flat-folder/kabuto.fold")
}

/// A square whose middle crease is two collinear halves, `lower` from the
/// bottom edge to the centre and `upper` on to the top: two letters for one
/// pair of faces.
fn split_crease_square(lower: LineColor, upper: LineColor) -> Vec<LineSegment> {
    vec![
        segment(0.0, 0.0, 0.5, 0.0, LineColor::Black0),
        segment(0.5, 0.0, 1.0, 0.0, LineColor::Black0),
        segment(1.0, 0.0, 1.0, 1.0, LineColor::Black0),
        segment(1.0, 1.0, 0.5, 1.0, LineColor::Black0),
        segment(0.5, 1.0, 0.0, 1.0, LineColor::Black0),
        segment(0.0, 1.0, 0.0, 0.0, LineColor::Black0),
        segment(0.5, 0.0, 0.5, 0.5, lower),
        segment(0.5, 0.5, 0.5, 1.0, upper),
    ]
}

/// When the creases' letters disagree, the fold reads the first of them
/// (`HierarchyTable::from_initial`) and solves. Seeds are checked against
/// that reading, not the raw letters, so the order on screen, and the letter
/// it kept, always pass as seeds; the other letter, seeded, says the opposite
/// of what the fold reads and is refused, named as the seed it is.
#[test]
fn seeds_are_checked_against_the_order_the_fold_reads_when_letters_disagree() {
    // Mountain and valley halves either way round, and a mountain half beside
    // an unassigned one, which folds as a valley.
    for (lower, upper) in [
        (LineColor::Red1, LineColor::Blue2),
        (LineColor::Blue2, LineColor::Red1),
        (LineColor::Red1, LineColor::Black0),
    ] {
        let label = format!("{lower:?}/{upper:?}");
        let segments = split_crease_square(lower, upper);
        let letters = letters(&segments);
        let (kept, dropped) = letters
            .relations
            .iter()
            .enumerate()
            .find_map(|(index, kept)| {
                letters.relations[index + 1..]
                    .iter()
                    .find(|other| relation_pair(other) == (kept.lower_face, kept.upper_face))
                    .map(|dropped| (*kept, *dropped))
            })
            .unwrap_or_else(|| panic!("{label}: the letters agree"));

        let mut unseeded = FoldingEstimateSession::new(&segments, 1);
        let estimate = unseeded
            .folding_estimated(EstimationOrder::Order5)
            .expect("the unseeded fold");
        assert_eq!(estimate.outcome, FoldOutcome::Solved, "{label}");
        assert_eq!(estimate.discovered_fold_cases, 1, "{label}");
        let order = shown(&estimate).cloned().expect("the order on screen");
        assert!(
            honours(&order, &kept),
            "{label}: the fold read the first letter"
        );

        for seeds in [vec![kept], order.relations.clone()] {
            let (_, result) = seeded_first_fold(&segments, seeds);
            let estimate = result.unwrap_or_else(|error| panic!("{label}: {error:?}"));
            assert_eq!(estimate.outcome, FoldOutcome::Solved, "{label}");
            assert_eq!(shown(&estimate), Some(&order), "{label}");
        }

        let (_, result) = seeded_first_fold(&segments, vec![dropped]);
        assert_eq!(
            result.expect_err("the other letter, seeded, is refused"),
            FoldingEstimateError::WorkerOverlap(WorkerOverlapSearchError::Seed(
                HierarchySeedError::Contradiction {
                    upper_face: dropped.upper_face,
                    lower_face: dropped.lower_face,
                }
            )),
            "{label}"
        );
    }
}

fn seeded_first_fold(
    segments: &[LineSegment],
    seeds: Vec<HierarchyRelation>,
) -> (
    FoldingEstimateSession,
    Result<FoldingEstimate, FoldingEstimateError>,
) {
    let mut session = FoldingEstimateSession::with_seeds(segments, 1, seeds);
    let result = session.folding_estimated(EstimationOrder::Order5);
    (session, result)
}

/// A seed the letters cannot take is an error naming it, never a
/// contradiction outcome: that outcome says the creases cannot fold, and draws
/// their faces red.
#[test]
fn seeds_the_letters_cannot_take_are_refused_by_name() {
    let segments = kabuto();
    let letters = letters(&segments);
    let faces_total = letters.faces_total;
    let letter = letters.relations[0];
    for (seed, expected) in [
        (
            HierarchyRelation {
                upper_face: faces_total + 4,
                lower_face: 0,
            },
            HierarchySeedError::UnknownFace {
                face: faces_total + 4,
                faces_total,
            },
        ),
        (
            HierarchyRelation {
                upper_face: 2,
                lower_face: 2,
            },
            HierarchySeedError::SameFace { face: 2 },
        ),
        (
            HierarchyRelation {
                upper_face: letter.lower_face,
                lower_face: letter.upper_face,
            },
            HierarchySeedError::Contradiction {
                upper_face: letter.lower_face,
                lower_face: letter.upper_face,
            },
        ),
    ] {
        let (session, result) = seeded_first_fold(&segments, vec![seed]);
        let error = result.expect_err("the seed is refused");
        assert_eq!(
            error,
            FoldingEstimateError::WorkerOverlap(WorkerOverlapSearchError::Seed(expected))
        );
        assert_eq!(error.contradiction(), None);
        assert_eq!(EngineError::from(error).code, "fold_seed_refused");
        assert_ne!(session.estimate().outcome, FoldOutcome::Contradiction);
        assert_eq!(session.estimate().contradiction, None);
        assert!(shown(session.estimate()).is_none());
    }
}

/// A seed against a pair only the shipped deduction derives passes the
/// letters' check, and the closure refuses it as it refuses creases that
/// cannot fold: as the fold's contradiction, which a caller seeding a figure
/// Oriedita solved unseeded can attribute to the seeds.
#[test]
fn a_seed_the_closure_refuses_concludes_as_a_contradiction() {
    use oristudio_cp::folding::{
        close_initial_hierarchy, configure_subfaces_from_segments,
        equivalence_condition_candidates_from_segments,
    };
    let segments = kabuto();
    let letters = letters(&segments);
    let subfaces = configure_subfaces_from_segments(&segments, 1)
        .expect("subfaces")
        .expect("an arrangement");
    let mut conditions = equivalence_condition_candidates_from_segments(&segments, 1)
        .expect("conditions")
        .expect("faces");
    let closed =
        close_initial_hierarchy(&letters, &subfaces, &mut conditions).expect("kabuto closes");
    let derived = closed
        .relations
        .iter()
        .find(|relation| !letters.relations.contains(relation))
        .copied()
        .expect("a pair the closure derives");

    let (_, result) = seeded_first_fold(
        &segments,
        vec![HierarchyRelation {
            upper_face: derived.lower_face,
            lower_face: derived.upper_face,
        }],
    );
    let estimate = result.expect("the fold concludes");
    assert_eq!(estimate.outcome, FoldOutcome::Contradiction);
    assert!(estimate.contradiction.is_some());
    assert!(shown(&estimate).is_none());
}
