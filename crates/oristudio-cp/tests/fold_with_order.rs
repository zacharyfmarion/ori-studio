//! The kernel's layer-order entry points (`implementation-plans/layer-order-dialog.md`,
//! row E2), held to what a host sees through [`CpSession`]: the same calls the
//! wasm bridge and the desktop commands make.
//!
//! **With no order given, nothing a host saves changes.** An Edit figure's
//! `.osf` entry is its kernel snapshot and its picture, so the unseeded
//! snapshot, render and paper scene of every file fixture are held to a
//! recording, `tests/fixtures/oristudio-cp/flat-figure-bytes.json`. It was
//! written before the entry points existed, so the comparison is against the
//! shipped kernel and not against itself.
//!
//! Regenerate it only after an intentional change to what an unseeded fold
//! answers:
//!
//! ```sh
//! ORISTUDIO_UPDATE_GOLDEN=1 cargo test -p oristudio-cp --test fold_with_order
//! ```
//!
//! **Given an order, the new figure shows it**, and the dialog's own scene of
//! the order is that figure's scene. A refusal leaves no handle.
//!
//! **Both kernels name the same faces.** The face-ring digests of the file
//! fixtures are recorded in `tests/fixtures/oristudio-cp/face-ring-digests.json`
//! by this native build, and the CP bridge is held to the same file
//! (`apps/web/src/engine/oristudioCpFoldWithOrder.wasm.test.ts`). Rewrite it
//! with `ORISTUDIO_UPDATE_DIGESTS=1` only when what the digest hashes changes.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use oristudio_cp::cancel::{CancelHandle, CancelSource, RunId, bind};
use oristudio_cp::folding::{
    EstimationOrder, FoldOutcome, FoldedFigureModel, FoldedFigureRenderOptions,
    FoldedFigureSnapshot, FoldedFigureState, FoldedPaperScene, FoldedRenderInputs,
    FoldingEstimateError, FoldingEstimateSession, HierarchyRelation, HierarchySeedError,
    InitialHierarchy, ShownOrder, WorkerOverlapSearchError, close_initial_hierarchy,
    configure_subfaces_from_segments, equivalence_condition_candidates_from_segments,
    face_ring_digest_from_segments, folded_figure_paper_scene_from_session,
    folded_paper_scene_with_order, initial_hierarchy_from_segments,
};
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::session::{
    CpSession, FoldOrderRefusal, FoldSource, FoldWithOrderResult, relations_from_flat_pairs,
};
use serde::{Deserialize, Serialize};

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures")
}

fn bytes_golden_path() -> PathBuf {
    fixture_root().join("oristudio-cp/flat-figure-bytes.json")
}

/// The file fixtures a host can open: one answer, many, a hole, and the
/// layer-order contradictions. The web app's `.osf` gate reads the same list
/// (`apps/web/src/engine/oristudioCpFoldWithOrder.wasm.test.ts`).
const FILE_FIXTURES: &[(&str, &str)] = &[
    ("solution_sample_1", "oriedita/solution_sample_1.cp"),
    (
        "failing_global_flat_fold",
        "oriedita/failing_global_flat_fold.ori",
    ),
    ("holed_sheet_spiral", "oriedita/holed_sheet_spiral.ori"),
    (
        "holed_frame_collinear",
        "oriedita/holed_frame_collinear.ori",
    ),
    ("kabuto", "flat-folder/kabuto.fold"),
    ("bad_twist", "flat-folder/bad_twist.fold"),
    ("r069-s07", "flat-folder/r069-s07.fold"),
    ("r271-s03", "flat-folder/r271-s03.fold"),
    ("pleat-in-eighths", "fold-samples/pleat-in-eighths.fold"),
    ("preliminary-base", "fold-samples/preliminary-base.fold"),
    ("waterbomb-base", "fold-samples/waterbomb-base.fold"),
];

/// Open a fixture as a host opens a file: a new document in `session`.
fn open(session: &mut CpSession, relative: &str) -> u32 {
    let path = fixture_root().join(relative);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let loaded = match path.extension().and_then(|extension| extension.to_str()) {
        Some("cp") => session.load_cp(&text, ""),
        Some("ori") => session.load_ori(&text, false),
        Some("fold") => session.load_fold(&text, ""),
        other => panic!("{}: no loader for {other:?}", path.display()),
    };
    loaded.unwrap_or_else(|error| panic!("open {}: {error:?}", path.display()))
}

/// Every line of the document, as Edit's whole-sheet fold names them: the
/// selection the kernel narrows to its folding colours.
fn every_line(session: &CpSession, document: u32) -> Vec<usize> {
    let lines = session
        .document_summary(document)
        .expect("summary")
        .line_segments;
    (1..=lines).collect()
}

fn model(state: FoldedFigureState) -> FoldedFigureModel {
    FoldedFigureModel {
        state,
        ..FoldedFigureModel::default()
    }
}

/// A JSON encoding's length and FNV-1a digest: enough to say two encodings
/// are the same bytes, without committing every figure's wireframe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Bytes {
    bytes: usize,
    fnv1a64: String,
}

fn bytes_of(value: &impl Serialize) -> Bytes {
    let text = serde_json::to_string(value).expect("serialise");
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    Bytes {
        bytes: text.len(),
        fnv1a64: format!("{hash:016x}"),
    }
}

/// What an unseeded fold of one fixture answers a host, front and back: the
/// snapshot an `.osf` saves, the picture it saves beside it, and the paper
/// scene the Diagram and the export paint from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct FigureBytes {
    fixture: String,
    outcome: String,
    snapshot: Bytes,
    render_front: Bytes,
    render_back: Bytes,
    scene_front: Bytes,
    scene_back: Bytes,
}

fn figure_bytes(name: &str, relative: &str) -> FigureBytes {
    let mut session = CpSession::new();
    let document = open(&mut session, relative);
    let lines = every_line(&session, document);
    let folded = session
        .folded_figure_fold_selected(
            document,
            &lines,
            1,
            EstimationOrder::Order5,
            model(FoldedFigureState::Front0),
        )
        .unwrap_or_else(|error| panic!("{name}: fold: {error:?}"));
    let handle = folded.handle;
    let style = folded.snapshot.display_style;
    let render = |session: &mut CpSession, state| {
        session
            .folded_figure_set_model(handle, model(state))
            .expect("set model");
        let render = session
            .folded_figure_render_snapshot(
                handle,
                Some(style),
                FoldedFigureRenderOptions::default(),
            )
            .expect("render");
        let scene = session
            .folded_figure_paper_scene(handle, Some(document))
            .expect("scene");
        (bytes_of(&render), bytes_of(&scene))
    };
    let (render_back, scene_back) = render(&mut session, FoldedFigureState::Back1);
    let (render_front, scene_front) = render(&mut session, FoldedFigureState::Front0);
    FigureBytes {
        fixture: name.to_string(),
        outcome: format!("{:?}", folded.snapshot.outcome),
        snapshot: bytes_of(&folded.snapshot),
        render_front,
        render_back,
        scene_front,
        scene_back,
    }
}

/// An unseeded fold answers a host exactly what it did before the layer-order
/// entry points existed: the snapshot, both renders and both paper scenes of
/// every file fixture are the recorded bytes.
#[test]
fn an_unseeded_fold_answers_the_recorded_bytes() {
    let actual: Vec<FigureBytes> = FILE_FIXTURES
        .iter()
        .map(|(name, relative)| figure_bytes(name, relative))
        .collect();
    assert!(
        actual
            .iter()
            .any(|figure| figure.outcome == format!("{:?}", FoldOutcome::Solved)),
        "no fixture solved, so the scenes assert nothing"
    );

    if std::env::var_os("ORISTUDIO_UPDATE_GOLDEN").is_some() {
        let text = format!(
            "{}\n",
            serde_json::to_string_pretty(&actual).expect("serialise the golden")
        );
        std::fs::write(bytes_golden_path(), text).expect("write the golden");
        return;
    }

    let text = std::fs::read_to_string(bytes_golden_path())
        .expect("the golden; regenerate with ORISTUDIO_UPDATE_GOLDEN=1");
    let expected: Vec<FigureBytes> = serde_json::from_str(&text).expect("parse the golden");
    assert_eq!(
        actual
            .iter()
            .map(|figure| &figure.fixture)
            .collect::<Vec<_>>(),
        expected
            .iter()
            .map(|figure| &figure.fixture)
            .collect::<Vec<_>>(),
        "the fixture list changed; regenerate the golden"
    );
    for (actual, expected) in actual.iter().zip(&expected) {
        assert_eq!(
            actual, expected,
            "{}: an unseeded fold changed",
            actual.fixture
        );
    }
}

/// An unseeded snapshot writes no `shown_order`, so its bytes stay; a figure
/// folded with an order writes `"given"`; and a snapshot saved before the
/// field existed reads back as searched.
#[test]
fn only_a_given_order_writes_shown_order() {
    let mut fixture = Fixture::open("kabuto");
    let unseeded = fixture.fold();
    let text = serde_json::to_string(&unseeded.snapshot).expect("serialise");
    assert!(
        !text.contains("shown_order"),
        "an unseeded snapshot grew a key"
    );
    let read: FoldedFigureSnapshot = serde_json::from_str(&text).expect("read back");
    assert_eq!(read.shown_order, ShownOrder::Searched);

    let order = oriedita_orders(&fixture.source).remove(0);
    let (_, given) = folded(fixture.fold_with_order(&order.relations));
    assert_eq!(given.shown_order, ShownOrder::Given);
    let text = serde_json::to_string(&given).expect("serialise");
    assert!(text.contains(r#""shown_order":"given""#), "{text}");
    let read: FoldedFigureSnapshot = serde_json::from_str(&text).expect("read back");
    assert_eq!(read.shown_order, ShownOrder::Given);

    // No relations is no order given: an ordinary fold, with its bytes.
    let (_, none) = folded(fixture.fold_with_order(&[]));
    assert_eq!(none.shown_order, ShownOrder::Searched);
    assert_eq!(
        serde_json::to_string(&none).expect("serialise"),
        serde_json::to_string(&unseeded.snapshot).expect("serialise")
    );
}

// --- the fixtures, as a host opens them -------------------------------------

/// Two synthetic sheets the kernel's seeded tests also fold, as `.cp` text. With
/// the file fixtures, they hold every flat fixture that solves.
const CP_FIXTURES: &[(&str, &str)] = &[
    (
        "square_with_diagonal",
        "1 0 0 1 0\n1 1 0 1 1\n1 1 1 0 1\n1 0 1 0 0\n2 0 0 1 1\n",
    ),
    (
        "two_square_strip",
        "1 0 0 10 0\n1 10 0 20 0\n1 20 0 20 10\n1 20 10 10 10\n1 10 10 0 10\n1 0 10 0 0\n\
         2 10 0 10 10\n",
    ),
];

fn fixture_names() -> impl Iterator<Item = &'static str> {
    FILE_FIXTURES
        .iter()
        .chain(CP_FIXTURES)
        .map(|&(name, _)| name)
}

/// A fixture open in a session of its own, with the source its whole sheet
/// folds from.
struct Fixture {
    name: &'static str,
    session: CpSession,
    document: u32,
    lines: Vec<usize>,
    source: FoldSource,
}

impl Fixture {
    fn open(name: &'static str) -> Self {
        let mut session = CpSession::new();
        let document = if let Some((_, relative)) =
            FILE_FIXTURES.iter().find(|(fixture, _)| *fixture == name)
        {
            open(&mut session, relative)
        } else if let Some((_, text)) = CP_FIXTURES.iter().find(|(fixture, _)| *fixture == name) {
            session.load_cp(text, "").expect("load the sheet")
        } else {
            panic!("no fixture {name}")
        };
        let lines = every_line(&session, document);
        let source = session
            .fold_source_of_selection(document, &lines, 1)
            .unwrap_or_else(|error| panic!("{name}: source: {error:?}"));
        Self {
            name,
            session,
            document,
            lines,
            source,
        }
    }

    /// Edit's unseeded fold of the whole sheet.
    fn fold(&mut self) -> oristudio_cp::session::FoldedFigureResult {
        self.session
            .folded_figure_fold_selected(
                self.document,
                &self.lines,
                1,
                EstimationOrder::Order5,
                model(FoldedFigureState::Front0),
            )
            .unwrap_or_else(|error| panic!("{}: fold: {error:?}", self.name))
    }

    fn fold_with_order(&mut self, relations: &[HierarchyRelation]) -> FoldWithOrderResult {
        self.session
            .folded_figure_fold_with_order(
                &self.source,
                relations,
                model(FoldedFigureState::Front0),
            )
            .unwrap_or_else(|error| panic!("{}: fold with order: {error:?}", self.name))
    }

    /// The figure's paper scene from the side `state` shows, with the aux
    /// lines it was folded with.
    fn scene(&mut self, handle: u32, state: FoldedFigureState) -> Option<FoldedPaperScene> {
        self.session
            .folded_figure_set_model(handle, model(state))
            .expect("set model");
        self.session
            .folded_figure_paper_scene(handle, None)
            .expect("scene")
    }
}

fn folded(result: FoldWithOrderResult) -> (u32, FoldedFigureSnapshot) {
    match result {
        FoldWithOrderResult::Folded { handle, snapshot } => (handle, *snapshot),
        FoldWithOrderResult::Refused { refusal } => panic!("refused: {refusal:?}"),
    }
}

fn refused(result: FoldWithOrderResult) -> FoldOrderRefusal {
    match result {
        FoldWithOrderResult::Refused { refusal } => refusal,
        FoldWithOrderResult::Folded { handle, .. } => panic!("folded into handle {handle}"),
    }
}

/// The layer order a solved estimate shows.
fn shown(estimate: &oristudio_cp::folding::FoldingEstimate) -> Option<&InitialHierarchy> {
    estimate
        .overlap
        .as_ref()
        .filter(|overlap| overlap.found)
        .map(|overlap| &overlap.hierarchy)
}

/// Every order Oriedita's own search finds for a source, in the order
/// "Another solution" walks them: each solved case's full relations.
fn oriedita_orders(source: &FoldSource) -> Vec<InitialHierarchy> {
    let mut session = FoldingEstimateSession::new(&source.segments, source.starting_face_id);
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
        if !estimate.find_another_overlap_valid || orders.len() > 48 {
            break;
        }
        estimate = session
            .folding_estimated(EstimationOrder::Order6)
            .expect("another solution");
    }
    orders
}

// --- a given order is the order shown ---------------------------------------

/// Through the host's own entry points: on every flat fixture, each order
/// Oriedita finds, folded back with `fold_with_order` from the selection's
/// source, is a new figure showing that order, front and back, as its only
/// solution, and "Another solution" stays on it.
#[test]
fn fold_with_order_reproduces_every_order_oriedita_finds() {
    let mut checked = 0;
    for name in fixture_names() {
        let mut fixture = Fixture::open(name);
        let unseeded = fixture.fold();
        // The selection's source is the source of the figure it folds.
        assert_eq!(
            fixture
                .session
                .folded_figure_source(unseeded.handle, Some(fixture.document))
                .expect("the figure's source"),
            fixture.source,
            "{name}"
        );
        assert_eq!(unseeded.snapshot.shown_order, ShownOrder::Searched);

        for (index, order) in oriedita_orders(&fixture.source).iter().enumerate() {
            let case = index + 1;
            let (handle, snapshot) = folded(fixture.fold_with_order(&order.relations));
            assert_ne!(
                handle, unseeded.handle,
                "{name} case {case}: not a new handle"
            );
            assert_eq!(snapshot.outcome, FoldOutcome::Solved, "{name} case {case}");
            assert_eq!(
                (snapshot.current_fold_case, snapshot.discovered_fold_cases),
                (1, 1),
                "{name} case {case}"
            );
            assert!(
                !snapshot.find_another_overlap_valid,
                "{name} case {case}: a whole order given leaves another solution"
            );
            assert_eq!(snapshot.shown_order, ShownOrder::Given);
            assert_eq!(
                fixture
                    .session
                    .folded_figure_digest(handle)
                    .expect("digest"),
                fixture.source.digest,
                "{name} case {case}"
            );

            fixture
                .session
                .folded_figure_fold_to_case(unseeded.handle, case, EstimationOrder::Order5)
                .expect("seek the case");
            for state in [FoldedFigureState::Front0, FoldedFigureState::Back1] {
                let expected = fixture.scene(unseeded.handle, state);
                assert!(expected.is_some(), "{name} case {case}: no picture");
                assert_eq!(
                    fixture.scene(handle, state),
                    expected,
                    "{name} case {case} {state:?}: another order shown"
                );
            }
            fixture
                .session
                .folded_figure_fold_another(handle)
                .expect("another solution");
            let front = FoldedFigureState::Front0;
            assert_eq!(
                fixture.scene(handle, front),
                fixture.scene(unseeded.handle, front),
                "{name} case {case}: another solution left the order"
            );
            fixture
                .session
                .free_folded_figure(handle)
                .expect("free the figure");
            checked += 1;
        }
    }
    // E1's 38 through the public entry: one each for the eight with one, and
    // solution_sample_1's 16, kabuto's 9 and r069-s07's 5.
    assert_eq!(checked, 38);
}

/// The dialog draws an order through `folded_paper_scene_with_order`, and its
/// Apply folds it with `fold_with_order`: given a session's own order, the two
/// scenes are one scene, and the session's, front and back, for every order
/// of kabuto and `solution_sample_1`. So the dialog shows what Apply will.
#[test]
fn the_dialogs_scene_of_an_order_is_the_scene_its_apply_draws() {
    let mut sides = 0;
    for name in ["kabuto", "solution_sample_1"] {
        let mut fixture = Fixture::open(name);
        let source = fixture.source.clone();
        let inputs = FoldedRenderInputs::from_segments(&source.segments, source.starting_face_id)
            .expect("render inputs")
            .expect("faces");
        assert_eq!(inputs.face_ring_digest().to_string(), source.digest);

        let mut oriedita = FoldingEstimateSession::new(&source.segments, source.starting_face_id);
        let mut estimate = oriedita
            .folding_estimated(EstimationOrder::Order5)
            .expect("the first fold");
        loop {
            let order = shown(&estimate).expect("a solved order").clone();
            let (handle, _) = folded(fixture.fold_with_order(&order.relations));
            for state in [FoldedFigureState::Front0, FoldedFigureState::Back1] {
                let dialog = folded_paper_scene_with_order(
                    &inputs,
                    &order.relations,
                    &source.aux_segments,
                    &model(state),
                )
                .expect("the dialog's scene")
                .expect("a picture");
                let session = folded_figure_paper_scene_from_session(
                    &oriedita,
                    &inputs,
                    &source.aux_segments,
                    &model(state),
                )
                .expect("the session's scene")
                .expect("a picture");
                assert_eq!(dialog, session, "{name} {state:?}: not the session's scene");
                // The dialog restacks a scene between orders by the faces
                // under each of its subfaces, numbered as the scene's.
                let drawn: Vec<&[usize]> = inputs.scene_subface_face_ids().collect();
                assert_eq!(drawn.len(), dialog.subfaces.len(), "{name} {state:?}");
                for (faces, subface) in drawn.iter().zip(&dialog.subfaces) {
                    let mut stacked = subface.faces_top_to_bottom.clone();
                    stacked.sort_unstable();
                    let mut under = faces.to_vec();
                    under.sort_unstable();
                    assert_eq!(stacked, under, "{name} {state:?}");
                }
                assert_eq!(
                    fixture.scene(handle, state),
                    Some(dialog),
                    "{name} {state:?}: Apply draws another scene"
                );
                sides += 1;
            }
            fixture.session.free_folded_figure(handle).expect("free");
            if !estimate.find_another_overlap_valid {
                break;
            }
            estimate = oriedita
                .folding_estimated(EstimationOrder::Order6)
                .expect("another solution");
        }
    }
    assert_eq!(sides, (9 + 16) * 2);
}

/// The dialog's scene refuses an order that names faces the figure does not
/// have, or states a pair both ways, as a seed would be refused.
#[test]
fn the_dialogs_scene_refuses_an_order_for_other_faces() {
    let fixture = Fixture::open("kabuto");
    let inputs = FoldedRenderInputs::from_segments(&fixture.source.segments, 1)
        .expect("render inputs")
        .expect("faces");
    let faces_total = inputs.wireframe().faces.len();
    let pair = |upper_face, lower_face| HierarchyRelation {
        upper_face,
        lower_face,
    };
    let refusal = |order: &[HierarchyRelation]| match folded_paper_scene_with_order(
        &inputs,
        order,
        &[],
        &model(FoldedFigureState::Front0),
    ) {
        Err(FoldingEstimateError::WorkerOverlap(WorkerOverlapSearchError::Seed(seed))) => seed,
        other => panic!("not refused: {other:?}"),
    };
    assert_eq!(
        refusal(&[pair(0, faces_total)]),
        HierarchySeedError::UnknownFace {
            face: faces_total,
            faces_total
        }
    );
    assert_eq!(
        refusal(&[pair(1, 1)]),
        HierarchySeedError::SameFace { face: 1 }
    );
    assert_eq!(
        refusal(&[pair(0, 1), pair(1, 0)]),
        HierarchySeedError::Contradiction {
            upper_face: 1,
            lower_face: 0
        }
    );
}

// --- refusals ---------------------------------------------------------------

fn reversed(relation: HierarchyRelation) -> HierarchyRelation {
    HierarchyRelation {
        upper_face: relation.lower_face,
        lower_face: relation.upper_face,
    }
}

/// A pair the setup-time closure derives from kabuto's letters, which the
/// letters themselves leave open.
fn closure_derived_pair(source: &FoldSource) -> HierarchyRelation {
    let letters = initial_hierarchy_from_segments(&source.segments, 1)
        .expect("letters")
        .expect("faces");
    let subfaces = configure_subfaces_from_segments(&source.segments, 1)
        .expect("subfaces")
        .expect("an arrangement");
    let mut conditions = equivalence_condition_candidates_from_segments(&source.segments, 1)
        .expect("conditions")
        .expect("faces");
    let closed =
        close_initial_hierarchy(&letters, &subfaces, &mut conditions).expect("the letters close");
    closed
        .relations
        .iter()
        .find(|relation| !letters.relations.contains(relation))
        .copied()
        .expect("a pair the closure derives")
}

/// Every way an order can be refused leaves no handle behind, and changes
/// neither the document nor the figure the order was made for. The arena's
/// next slot stays free, so the next fold takes it.
#[test]
fn a_refused_order_leaves_no_handle_and_changes_nothing() {
    let mut fixture = Fixture::open("kabuto");
    let figure = fixture.fold();
    // Nothing has been freed, so a figure stored now would take this slot.
    let next = figure.handle + 1;
    let document = fixture
        .session
        .document_snapshot(fixture.document)
        .expect("document");
    let figure_snapshot = fixture
        .session
        .folded_figure_snapshot(figure.handle)
        .expect("figure");

    let source = fixture.source.clone();
    let letters = initial_hierarchy_from_segments(&source.segments, 1)
        .expect("letters")
        .expect("faces");
    let faces_total = letters.faces_total;
    let letter = letters.relations[0];
    let derived = closure_derived_pair(&source);
    let order = oriedita_orders(&source).remove(0).relations;

    let mut forged = source.clone();
    forged.digest = "0000000000000000".to_string();
    // The same creases, reselected in another order: other face numbers.
    let mut reordered = source.clone();
    reordered.segments.swap(0, 1);

    let cases: Vec<(&str, FoldSource, Vec<HierarchyRelation>)> = vec![
        (
            "unknown face",
            source.clone(),
            vec![HierarchyRelation {
                upper_face: faces_total + 4,
                lower_face: 0,
            }],
        ),
        (
            "same face",
            source.clone(),
            vec![HierarchyRelation {
                upper_face: 2,
                lower_face: 2,
            }],
        ),
        ("against a letter", source.clone(), vec![reversed(letter)]),
        ("in the closure", source.clone(), vec![reversed(derived)]),
        ("forged digest", forged, order.clone()),
        ("reordered creases", reordered, order.clone()),
    ];
    let mut refusals = Vec::new();
    for (label, source, relations) in cases {
        let result = fixture
            .session
            .folded_figure_fold_with_order(&source, &relations, model(FoldedFigureState::Front0))
            .unwrap_or_else(|error| panic!("{label}: an error, not a refusal: {error:?}"));
        refusals.push((label, refused(result)));
        assert!(
            fixture.session.folded_figure_snapshot(next).is_err(),
            "{label}: the refusal left a figure behind"
        );
        assert_eq!(
            fixture
                .session
                .document_snapshot(fixture.document)
                .expect("document"),
            document,
            "{label}: the document changed"
        );
        assert_eq!(
            fixture
                .session
                .folded_figure_snapshot(figure.handle)
                .expect("figure"),
            figure_snapshot,
            "{label}: the figure changed"
        );
    }

    let refusal = |label: &str| {
        refusals
            .iter()
            .find(|(case, _)| *case == label)
            .map(|(_, refusal)| refusal.clone())
            .expect("a case")
    };
    assert_eq!(
        refusal("unknown face"),
        FoldOrderRefusal::UnknownFace {
            face: faces_total + 4,
            faces_total
        }
    );
    assert_eq!(refusal("same face"), FoldOrderRefusal::SameFace { face: 2 });
    assert_eq!(
        refusal("against a letter"),
        FoldOrderRefusal::AgainstLetters {
            upper_face: letter.lower_face,
            lower_face: letter.upper_face
        }
    );
    assert!(
        matches!(
            refusal("in the closure"),
            FoldOrderRefusal::InClosure { .. }
        ),
        "{:?}",
        refusal("in the closure")
    );
    assert_eq!(
        refusal("forged digest"),
        FoldOrderRefusal::DigestMismatch {
            expected: "0000000000000000".to_string(),
            actual: source.digest.clone()
        }
    );
    assert!(matches!(
        refusal("reordered creases"),
        FoldOrderRefusal::DigestMismatch { expected, .. } if expected == source.digest
    ));

    // The slot no refusal took is the next figure's.
    let (handle, _) = folded(fixture.fold_with_order(&order));
    assert_eq!(handle, next);
}

/// Reports `run` as cancelled once it has been read `reads` times
/// (`tests/cancel.rs`'s source).
struct CancelAfter {
    run: u32,
    remaining: AtomicU32,
}

impl CancelSource for CancelAfter {
    fn cancelled_run(&self) -> u32 {
        let previous = self
            .remaining
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                Some(remaining.saturating_sub(1))
            })
            .unwrap_or(0);
        if previous == 0 { self.run } else { 0 }
    }
}

/// A Stop, wherever it lands in the fold, is the cancel code and leaves no
/// handle: the digest check, the setup and the seeded search alike.
#[test]
fn a_stopped_fold_with_order_leaves_no_handle() {
    let mut fixture = Fixture::open("kabuto");
    let figure = fixture.fold();
    let next = figure.handle + 1;
    let order = oriedita_orders(&fixture.source).remove(0).relations;
    let (mut stopped, mut finished) = (0, 0);
    for reads in [0, 1, 4, 16, 64, 256, 1024, 4096, 1 << 20] {
        let result = {
            let _bound = bind(Some(CancelHandle::new(
                Arc::new(CancelAfter {
                    run: 1,
                    remaining: AtomicU32::new(reads),
                }),
                RunId::new(1).expect("non-zero"),
            )));
            fixture.session.folded_figure_fold_with_order(
                &fixture.source,
                &order,
                model(FoldedFigureState::Front0),
            )
        };
        match result {
            Err(error) => {
                assert_eq!(error.code, "fold_cancelled", "{reads}: {error:?}");
                assert!(
                    fixture.session.folded_figure_snapshot(next).is_err(),
                    "{reads}: a stopped fold left a figure behind"
                );
                stopped += 1;
            }
            Ok(FoldWithOrderResult::Folded { handle, .. }) => {
                assert_eq!(handle, next);
                fixture.session.free_folded_figure(handle).expect("free");
                finished += 1;
            }
            Ok(FoldWithOrderResult::Refused { refusal }) => {
                panic!("{reads}: refused {refusal:?}")
            }
        }
    }
    assert!(
        stopped > 0 && finished > 0,
        "{stopped} stopped, {finished} finished"
    );
}

#[test]
fn relations_cross_the_bridges_as_flat_pairs() {
    assert_eq!(
        relations_from_flat_pairs(&[3, 1, 0, 2]).expect("pairs"),
        vec![
            HierarchyRelation {
                upper_face: 3,
                lower_face: 1
            },
            HierarchyRelation {
                upper_face: 0,
                lower_face: 2
            },
        ]
    );
    assert!(relations_from_flat_pairs(&[]).expect("none").is_empty());
    assert_eq!(
        relations_from_flat_pairs(&[3, 1, 0]).expect_err("odd").code,
        "invalid_input"
    );
}

// --- the source and its digest ----------------------------------------------

/// The faces of each file fixture, by digest, as this native kernel names
/// them: the selection's source, the figure's source, the figure's own digest
/// and its render inputs all agree, and all are the recorded value the CP
/// bridge is held to as well.
#[test]
fn the_native_digests_are_the_recorded_ones() {
    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    struct FixtureDigest {
        fixture: String,
        faces: usize,
        digest: String,
    }

    let mut actual = Vec::new();
    for (name, _) in FILE_FIXTURES {
        let mut fixture = Fixture::open(name);
        let figure = fixture.fold();
        let digest = fixture.source.digest.clone();
        assert_eq!(digest.len(), 16, "{name}");
        assert_eq!(
            fixture
                .session
                .folded_figure_digest(figure.handle)
                .expect("digest"),
            digest,
            "{name}"
        );
        assert_eq!(
            fixture
                .session
                .folded_figure_source(figure.handle, None)
                .expect("source")
                .digest,
            digest,
            "{name}"
        );
        let inputs = FoldedRenderInputs::from_segments(&fixture.source.segments, 1)
            .expect("render inputs")
            .expect("faces");
        assert_eq!(inputs.face_ring_digest().to_string(), digest, "{name}");
        actual.push(FixtureDigest {
            fixture: name.to_string(),
            faces: inputs.wireframe().faces.len(),
            digest,
        });
    }

    let path = fixture_root().join("oristudio-cp/face-ring-digests.json");
    if std::env::var_os("ORISTUDIO_UPDATE_DIGESTS").is_some() {
        let text = format!(
            "{}\n",
            serde_json::to_string_pretty(&actual).expect("serialise")
        );
        std::fs::write(&path, text).expect("write the digests");
        return;
    }
    let text = std::fs::read_to_string(&path)
        .expect("the digests; record them with ORISTUDIO_UPDATE_DIGESTS=1");
    let expected: Vec<FixtureDigest> = serde_json::from_str(&text).expect("parse");
    assert_eq!(actual, expected);
}

fn sheet(diagonal: LineColor) -> Vec<LineSegment> {
    let line = |ax, ay, bx, by, color| {
        LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
    };
    vec![
        line(0.0, 0.0, 1.0, 0.0, LineColor::Black0),
        line(1.0, 0.0, 1.0, 1.0, LineColor::Black0),
        line(1.0, 1.0, 0.0, 1.0, LineColor::Black0),
        line(0.0, 1.0, 0.0, 0.0, LineColor::Black0),
        line(0.0, 0.0, 1.0, 1.0, diagonal),
    ]
}

/// The digest is the inputs and the rings: another coordinate, colour,
/// starting face or segment order is another digest, and a zero is a zero
/// whatever its sign, as JSON carries it.
#[test]
fn the_digest_hashes_the_inputs_and_the_rings_alone() {
    let segments = sheet(LineColor::Red1);
    let digest = face_ring_digest_from_segments(&segments, 1).expect("faces");
    assert_eq!(
        face_ring_digest_from_segments(&segments, 1),
        Some(digest),
        "not deterministic"
    );

    let negative_zero: Vec<LineSegment> = segments
        .iter()
        .map(|segment| {
            let flip = |point: Point| {
                Point::new(
                    if point.x == 0.0 { -0.0 } else { point.x },
                    if point.y == 0.0 { -0.0 } else { point.y },
                )
            };
            LineSegment::with_color(flip(segment.a), flip(segment.b), segment.color)
        })
        .collect();
    assert_eq!(
        face_ring_digest_from_segments(&negative_zero, 1),
        Some(digest)
    );

    let moved: Vec<LineSegment> = segments
        .iter()
        .map(|segment| {
            let shift = |point: Point| Point::new(point.x + 1.0, point.y);
            LineSegment::with_color(shift(segment.a), shift(segment.b), segment.color)
        })
        .collect();
    let mut reordered = segments.clone();
    reordered.reverse();
    for (label, other) in [
        ("moved", face_ring_digest_from_segments(&moved, 1)),
        (
            "recoloured",
            face_ring_digest_from_segments(&sheet(LineColor::Blue2), 1),
        ),
        ("other start", face_ring_digest_from_segments(&segments, 2)),
        ("reordered", face_ring_digest_from_segments(&reordered, 1)),
    ] {
        assert!(other.is_some(), "{label}: no faces");
        assert_ne!(other, Some(digest), "{label}: the same digest");
    }

    assert_eq!(face_ring_digest_from_segments(&[], 1), None);
    assert_eq!(face_ring_digest_from_segments(&segments[..1], 1), None);
    let inputs = FoldedRenderInputs::from_segments(&segments, 1)
        .expect("inputs")
        .expect("faces");
    assert_eq!(inputs.face_ring_digest(), digest);
}

/// The render inputs' accessors are what the dialog's source reads: the flat
/// points under the wireframe's indices, the faces each subface stacks, and
/// line-to-face adjacency, which is Oriedita's edge rule: one letter per line
/// between two faces, whatever its colour.
#[test]
fn the_render_inputs_expose_edits_faces_and_the_edge_rule() {
    for name in ["kabuto", "solution_sample_1", "holed_sheet_spiral"] {
        let fixture = Fixture::open(name);
        let segments = &fixture.source.segments;
        let inputs = FoldedRenderInputs::from_segments(segments, 1)
            .expect("inputs")
            .expect("faces");
        let wireframe = inputs.wireframe();
        let faces = wireframe.faces.len();
        assert_eq!(inputs.flat_points().len(), wireframe.points.len(), "{name}");
        assert_eq!(wireframe.lines.len(), segments.len(), "{name}");
        // A line's ends are its segment's ends on the sheet.
        for (line, segment) in wireframe.lines.iter().zip(segments) {
            for (point, end) in [(line.begin, segment.a), (line.end, segment.b)] {
                let flat = inputs.flat_points()[point];
                assert!(
                    (flat.x - end.x).abs() < 1e-6 && (flat.y - end.y).abs() < 1e-6,
                    "{name}: {flat:?} is not {end:?}"
                );
            }
        }

        let letters = initial_hierarchy_from_segments(segments, 1)
            .expect("letters")
            .expect("faces");
        let folds = (0..wireframe.lines.len())
            .filter(|&line| matches!(inputs.line_face_border(line), Some((a, b)) if a != b))
            .count();
        assert_eq!(
            folds,
            letters.relations.len(),
            "{name}: one letter per fold"
        );
        for (index, line) in wireframe.lines.iter().enumerate() {
            if let Some((a, b)) = inputs.line_face_border(index) {
                assert!(a <= b && b < faces, "{name}");
                if a == b {
                    assert_eq!(line.color, LineColor::Black0, "{name}: an edge is a border");
                }
            }
        }
        assert_eq!(inputs.line_face_border(usize::MAX), None);

        // Every face lies over some subface, and each subface lists its faces
        // in face order.
        let mut covered = vec![false; faces];
        for face_ids in inputs.subface_face_ids() {
            assert!(face_ids.windows(2).all(|pair| pair[0] < pair[1]), "{name}");
            for &face in face_ids {
                covered[face] = true;
            }
        }
        assert!(
            covered.iter().all(|&face| face),
            "{name}: a face covers nothing"
        );
    }
}
