//! The Layer order dialog's constraint session (`steer::ConstraintSession`,
//! `implementation-plans/layer-order-dialog.md` row E5) on the fixtures CI
//! runs: kabuto, `solution_sample_1` and Oriedita's `colorconstrainttest`.
//! The same calls over the cpoogle corpus are the local census in
//! `crates/oracle-tests/tests/layer_order_session.rs`.

#![cfg(feature = "kernel")]

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};

use oristudio_cp::folding::{
    EstimationOrder, FoldOutcome, FoldedFigureModel, face_ring_digest_from_segments,
};
use oristudio_cp::geometry::{LineColor, LineSegment, Point as KernelPoint};
use oristudio_cp::session::{CpSession, FoldSource};
use oristudio_fold::complete::Deadline;
use oristudio_fold::random::Rng;
use oristudio_fold::steer::{
    CantFitProof, Commit, Constraint, ConstraintFault, ConstraintSession, ConstraintStatus,
    FaceStatus, FoldSign, GoneCause, LayerOrderRecord, LayerSource, Limits, Preview, RecordFace,
    RecordPair, RecordRead, RestoreOutcome, SavedPairStatus, SessionRefusal, Stacks, Verb,
    ViewSide, encode_record, read_record,
};
use oristudio_fold::{
    CreasePatternInput, FaceId, ImportKind, ImportSegment, ImportSpace, ImportTarget,
    ImportedPattern, StartSide,
};
use oristudio_layer_order::{FacePair, LayerOrder, check::Scope};

const FIXTURES: &[(&str, &str)] = &[
    ("kabuto", "tests/fixtures/flat-folder/kabuto.fold"),
    (
        "solution_sample_1",
        "tests/fixtures/oriedita/solution_sample_1.cp",
    ),
    (
        "colorconstrainttest",
        "third_party/oriedita/oriedita-data/src/test/resources/colorconstrainttest.cp",
    ),
];

fn repo_path(relative: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

/// A fixture opened as a host opens a file.
fn document(cp: &mut CpSession, relative: &str) -> u32 {
    let path = repo_path(relative);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{relative}: {e}"));
    let loaded = if relative.ends_with(".fold") {
        cp.load_fold(&text, "")
    } else {
        cp.load_cp(&text, "")
    };
    loaded.unwrap_or_else(|e| panic!("{relative}: {e:?}"))
}

fn every_line(cp: &CpSession, document: u32) -> Vec<usize> {
    (1..=cp
        .document_summary(document)
        .expect("summary")
        .line_segments)
        .collect()
}

/// What a host hands the dialog for the whole sheet.
fn fold_source(cp: &CpSession, document: u32) -> FoldSource {
    cp.fold_source_of_selection(document, &every_line(cp, document), 1)
        .expect("the sheet's source")
}

fn source_of(relative: &str) -> (FoldSource, LayerSource) {
    let mut cp = CpSession::new();
    let document = document(&mut cp, relative);
    let fold = fold_source(&cp, document);
    let source = LayerSource::from_oriedita(&fold).unwrap_or_else(|e| panic!("{relative}: {e}"));
    (fold, source)
}

fn open(relative: &str) -> ConstraintSession {
    ConstraintSession::open(source_of(relative).1, &Limits::default())
        .unwrap_or_else(|e| panic!("{relative}: {e}"))
}

/// Everything a host can read of a session: what a preview must leave as it
/// was.
#[derive(Debug, PartialEq)]
struct Observed {
    constraints: Vec<Constraint>,
    shown: LayerOrder,
    open: Vec<FacePair>,
    front: Stacks,
    back: Stacks,
    relations: Vec<(usize, usize)>,
    record: String,
}

fn observed(session: &ConstraintSession) -> Observed {
    Observed {
        constraints: session.constraints().to_vec(),
        shown: session.shown_order(),
        open: session.open_pairs(),
        front: session.stacks(ViewSide::Front),
        back: session.stacks(ViewSide::Back),
        relations: session
            .oriedita_relations()
            .iter()
            .map(|r| (r.upper_face, r.lower_face))
            .collect(),
        record: encode_record(&session.save().expect("save")).expect("encode"),
    }
}

/// The order on screen fits the creases and every committed constraint.
fn assert_fits(session: &ConstraintSession, context: &str) {
    let source = session.source();
    let shown = session.shown_order();
    let report = oristudio_layer_order::check::check_problem(
        source.problem(),
        source.view(),
        &shown,
        Scope::All,
    )
    .expect("the session's problem");
    assert!(report.is_valid(), "{context}: {:?}", report.violations);
    for c in session.constraints() {
        let above = c.subject_above(source.view()).expect("a side");
        assert_eq!(
            shown.above(c.subject, c.object),
            Some(above),
            "{context}: {c:?}"
        );
    }
}

/// A random constraint on an open pair, as the builder would offer it.
fn offered(session: &ConstraintSession, rng: &mut Rng) -> Option<Constraint> {
    let open = session.open_pairs();
    if open.is_empty() {
        return None;
    }
    let pair = open[rng.below(open.len())];
    let (subject, object) = if rng.chance(0.5) {
        (pair.lo(), pair.hi())
    } else {
        (pair.hi(), pair.lo())
    };
    let verb = if rng.chance(0.5) {
        Verb::InFrontOf
    } else {
        Verb::Behind
    };
    let side = if rng.chance(0.5) {
        ViewSide::Front
    } else {
        ViewSide::Back
    };
    Constraint::seen(subject, verb, object, side, session.source().view())
}

/// The constraint the order on screen breaks on `pair`: its other order.
fn against_shown(session: &ConstraintSession, pair: FacePair) -> Constraint {
    let shown = session.shown_order();
    let lo_above = shown
        .above(pair.lo(), pair.hi())
        .expect("a determined pair");
    let (subject, object) = if lo_above {
        (pair.hi(), pair.lo())
    } else {
        (pair.lo(), pair.hi())
    };
    Constraint::seen(
        subject,
        Verb::InFrontOf,
        object,
        ViewSide::Front,
        session.source().view(),
    )
    .expect("faces of the view")
}

// Gate 1: the same problem as Fold's own import of the same sheet.

/// A square sheet's creases as Fold's Import CP reads them.
fn import_input(source: &FoldSource) -> CreasePatternInput {
    CreasePatternInput {
        space: ImportSpace::Model,
        segments: source
            .segments
            .iter()
            .map(|s| ImportSegment {
                from: [s.a.x, s.a.y],
                to: [s.b.x, s.b.y],
                kind: match s.color {
                    LineColor::Red1 => ImportKind::Mountain,
                    LineColor::Blue2 => ImportKind::Valley,
                    _ => ImportKind::Border,
                },
            })
            .collect(),
    }
}

/// On the square fixtures, the session sees what Fold's import of the same
/// creases sees: the same faces (by paper point), the same forced and open
/// pairs, and the same first order, each pair by its FOLD sign (relative to
/// the paper, so the two imports' frames need not agree).
#[test]
fn the_session_sees_what_fold_s_import_sees() {
    let mut compared = 0;
    for (name, relative) in FIXTURES {
        let (fold, source) = source_of(relative);
        let session =
            ConstraintSession::open(source, &Limits::default()).unwrap_or_else(|e| panic!("{e}"));
        let import = ImportedPattern::new(
            &import_input(&fold),
            ImportTarget::Empty {
                start: StartSide::Front,
            },
        )
        .unwrap_or_else(|e| panic!("{name}: {e}"));
        let imported = import.unordered();
        let import_session = import
            .session(&Default::default())
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        let source = session.source();

        // The faces, one for one by paper point.
        let ours: BTreeMap<FaceId, FaceId> = imported
            .view()
            .faces()
            .iter()
            .map(|face| {
                let witness = imported.face_witness(face.id).expect("a witness");
                let at = import.to_input(witness);
                let mine = source
                    .face_at_paper(at)
                    .unwrap_or_else(|| panic!("{name}: no face at {at:?}"));
                (face.id, mine)
            })
            .collect();
        assert_eq!(ours.len(), source.view().faces().len(), "{name}");
        let mut images: Vec<FaceId> = ours.values().copied().collect();
        images.sort_unstable();
        images.dedup();
        assert_eq!(images.len(), ours.len(), "{name}: two faces in one");

        // The same pairs overlap.
        let mapped = |pair: &FacePair| FacePair::new(ours[&pair.lo()], ours[&pair.hi()]);
        let mut theirs_pairs: Vec<FacePair> = imported
            .problem()
            .variables()
            .iter()
            .filter_map(mapped)
            .collect();
        theirs_pairs.sort_unstable();
        assert_eq!(theirs_pairs, source.problem().variables(), "{name}");

        // The same forced pairs, the same open ones, and the same first
        // order, by the FOLD sign of f against g.
        let their_sign = |f_above: Option<bool>, g: FaceId| {
            f_above.map(|a| FoldSign::of_above(a, imported.view().front_up(g).expect("a side")))
        };
        let our_sign = |f_above: Option<bool>, g: FaceId| {
            f_above.map(|a| FoldSign::of_above(a, source.view().front_up(g).expect("a side")))
        };
        let open: Vec<FacePair> = session.open_pairs();
        for pair in imported.problem().variables() {
            let (f, g) = (pair.lo(), pair.hi());
            let (mf, mg) = (ours[&f], ours[&g]);
            assert_eq!(
                their_sign(import_session.forced(f, g), g),
                our_sign(session.forced(mf, mg), mg),
                "{name}: forced {pair}"
            );
            let mine = FacePair::new(mf, mg).expect("distinct");
            assert_eq!(
                import_session.forced(f, g).is_none(),
                open.binary_search(&mine).is_ok(),
                "{name}: open {pair}"
            );
            compared += 1;
        }

        // An order of the import's faces as an order of ours, pair for pair
        // by FOLD sign.
        let as_ours = |order: &LayerOrder| -> Vec<(FacePair, FoldSign)> {
            let mut pairs: Vec<(FacePair, FoldSign)> = order
                .pairs()
                .map(|(pair, lo_above)| {
                    // The sign of f against g, the same in either frame.
                    let (f, g) = (pair.lo(), pair.hi());
                    let sign = their_sign(lo_above, g).expect("determined");
                    let (mf, mg) = (ours[&f], ours[&g]);
                    let mine = FacePair::new(mf, mg).expect("distinct");
                    let mf_above = sign.above(source.view().front_up(mg).expect("a side"));
                    let lo_above = if mine.lo() == mf { mf_above } else { !mf_above };
                    (
                        mine,
                        our_sign(Some(lo_above), mine.hi()).expect("determined"),
                    )
                })
                .collect();
            pairs.sort_unstable_by_key(|(pair, _)| *pair);
            pairs
        };
        let ours_of = |order: &LayerOrder| -> Vec<(FacePair, FoldSign)> {
            order
                .pairs()
                .map(|(pair, lo_above)| (pair, our_sign(lo_above, pair.hi()).expect("determined")))
                .collect()
        };

        // The same orders, every one: the first order each search picks is
        // one of them, by its own face numbering.
        let every = |completions: &oristudio_fold::Completions| -> Vec<LayerOrder> {
            let (picks, more) = completions.picks(100_000);
            assert!(!more && completions.count().exact, "{name}");
            picks
                .iter()
                .map(|pick| completions.order(pick).expect("an order"))
                .collect()
        };
        let limits = oristudio_fold::CompletionLimits {
            per_component: 100_000,
            ..Default::default()
        };
        let mut theirs: Vec<Vec<(FacePair, FoldSign)>> = every(
            &import
                .complete(&limits)
                .unwrap_or_else(|e| panic!("{name}: {e}")),
        )
        .iter()
        .map(as_ours)
        .collect();
        let mut mine: Vec<Vec<(FacePair, FoldSign)>> = every(
            &oristudio_fold::complete::complete(
                source.view(),
                source.problem(),
                source.letter_seeds(),
                &limits,
            )
            .unwrap_or_else(|e| panic!("{name}: {e}")),
        )
        .iter()
        .map(ours_of)
        .collect();
        theirs.sort();
        mine.sort();
        assert_eq!(theirs.len(), mine.len(), "{name}: order counts");
        assert_eq!(theirs, mine, "{name}: the orders");
        let their_first = as_ours(&import_session.first_order());
        let our_first = ours_of(&session.shown_order());
        assert!(mine.binary_search(&their_first).is_ok(), "{name}");
        assert!(mine.binary_search(&our_first).is_ok(), "{name}");
        let differ = their_first
            .iter()
            .zip(&our_first)
            .filter(|(a, b)| a != b)
            .count();
        println!(
            "{name}: {} faces, {} pairs, {} open, {} orders alike; the first orders \
             differ on {differ} pairs",
            ours.len(),
            source.problem().variables().len(),
            open.len(),
            mine.len(),
        );
    }
    assert!(compared > 100, "{compared}");
}

// Gate 2: Oriedita's own order.

/// Oriedita's first order of a whole-sheet fold, as its figure draws it: each
/// subface's stack, top first from the front.
fn oriedita_first_order(relative: &str) -> (LayerSource, LayerOrder) {
    let mut cp = CpSession::new();
    let document = document(&mut cp, relative);
    let lines = every_line(&cp, document);
    let folded = cp
        .folded_figure_fold_selected(
            document,
            &lines,
            1,
            EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
        .unwrap_or_else(|e| panic!("{relative}: {e:?}"));
    assert_eq!(folded.snapshot.outcome, FoldOutcome::Solved, "{relative}");
    let fold = cp
        .folded_figure_source(folded.handle, Some(document))
        .expect("the figure's source");
    let source = LayerSource::from_oriedita(&fold).unwrap_or_else(|e| panic!("{e}"));
    let scene = cp
        .folded_figure_paper_scene(folded.handle, None)
        .expect("a scene")
        .expect("subfaces");
    let mut order = LayerOrder::new();
    for subface in &scene.subfaces {
        let stack = &subface.faces_top_to_bottom;
        for (i, &upper) in stack.iter().enumerate() {
            for &lower in &stack[i + 1..] {
                let (upper, lower) = (FaceId(upper as u32), FaceId(lower as u32));
                if let Some(above) = order.above(upper, lower) {
                    assert!(
                        above,
                        "{relative}: two subfaces disagree on {upper} {lower}"
                    );
                }
                order.set_above(upper, lower).expect("distinct faces");
            }
        }
    }
    (source, order)
}

/// The convention: Oriedita's own first order of each fixture is an order
/// of the session's problem, every pair, and a session accepts it whole.
#[test]
fn oriedita_s_own_first_order_fits_the_session_s_problem() {
    for (name, relative) in FIXTURES {
        let (source, oriedita) = oriedita_first_order(relative);
        assert_eq!(
            oriedita.len(),
            source.problem().variables().len(),
            "{name}: Oriedita orders every pair"
        );
        let report = oristudio_layer_order::check::check_problem(
            source.problem(),
            source.view(),
            &oriedita,
            Scope::All,
        )
        .expect("the source's problem");
        assert!(report.is_valid(), "{name}: {:?}", report.violations);

        // As constraints, every free pair of it fits, and is what is shown.
        let mut session =
            ConstraintSession::open(source, &Limits::default()).unwrap_or_else(|e| panic!("{e}"));
        let view = session.source().view();
        let constraints: Vec<Constraint> = session
            .open_pairs()
            .iter()
            .map(|pair| {
                let above = oriedita.above(pair.lo(), pair.hi()).expect("ordered");
                Constraint {
                    subject: pair.lo(),
                    object: pair.hi(),
                    sign: FoldSign::of_above(above, view.front_up(pair.hi()).expect("a side")),
                }
            })
            .collect();
        let committed = session
            .commit(constraints, &Limits::default())
            .unwrap_or_else(|e| panic!("{e}"));
        assert!(
            matches!(committed, Commit::Committed(_)),
            "{name}: {committed:?}"
        );
        assert_eq!(session.shown_order(), oriedita, "{name}");
        assert!(session.open_pairs().is_empty(), "{name}");
        println!(
            "{name}: Oriedita's first order fits, {} pairs",
            oriedita.len()
        );
    }
}

// The stacks are the scene's.

#[test]
fn the_stacks_are_the_scene_s_spot_for_subface() {
    let model = FoldedFigureModel::default();
    for (name, relative) in FIXTURES {
        let mut session = open(relative);
        let mut rng = Rng::new(0x5eed);
        for step in 0..6 {
            for side in [ViewSide::Front, ViewSide::Back] {
                let scene = session
                    .scene(side, &model)
                    .unwrap_or_else(|e| panic!("{e}"))
                    .expect("subfaces");
                let stacks = session.stacks(side);
                assert_eq!(stacks.len(), scene.subfaces.len(), "{name}");
                assert_eq!(session.spot_count(), scene.subfaces.len(), "{name}");
                for (i, subface) in scene.subfaces.iter().enumerate() {
                    let theirs: Vec<u32> = subface
                        .faces_top_to_bottom
                        .iter()
                        .map(|&f| f as u32)
                        .collect();
                    assert_eq!(
                        stacks.spot(i),
                        theirs.as_slice(),
                        "{name} step {step} {side:?} {i}"
                    );
                }
            }
            let Some(next) = offered(&session, &mut rng) else {
                break;
            };
            let mut list = session.constraints().to_vec();
            list.push(next);
            let _ = session.commit(list, &Limits::default());
        }
    }
}

/// What a host seeds `fold_with_order` with is the order on screen: the
/// source's conversion of it, and the new handle draws the session's scene.
#[test]
fn apply_draws_the_order_on_screen() {
    let model = FoldedFigureModel::default();
    for (name, relative) in FIXTURES {
        let (fold, source) = source_of(relative);
        let mut session =
            ConstraintSession::open(source, &Limits::default()).unwrap_or_else(|e| panic!("{e}"));
        let mut rng = Rng::new(0xa991);
        for _ in 0..3 {
            let open = session.open_pairs();
            let pair = open[rng.below(open.len())];
            let mut list = session.constraints().to_vec();
            list.push(against_shown(&session, pair));
            let committed = session.commit(list, &Limits::default());
            assert!(matches!(committed, Ok(Commit::Committed(_))), "{name}");
        }
        let relations = session.oriedita_relations();
        assert_eq!(
            relations,
            session.source().oriedita_relations(&session.shown_order()),
            "{name}"
        );
        let mut cp = CpSession::new();
        let applied = cp
            .folded_figure_fold_with_order(&fold, &relations, model.clone())
            .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        let oristudio_cp::session::FoldWithOrderResult::Folded { handle, snapshot } = applied
        else {
            panic!("{name}: {applied:?}");
        };
        assert_eq!(snapshot.outcome, FoldOutcome::Solved, "{name}");
        let drawn = cp
            .folded_figure_paper_scene(handle, None)
            .expect("a scene")
            .expect("subfaces");
        let ours = session
            .scene(ViewSide::Front, &model)
            .expect("the session's scene")
            .expect("subfaces");
        assert_eq!(drawn, ours, "{name}");
    }
}

// Gate 3: a preview never commits.

#[test]
fn a_preview_never_changes_the_session() {
    let mut previews = 0;
    let mut fits = 0;
    let mut cant = 0;
    for (name, relative) in FIXTURES {
        let mut session = open(relative);
        let mut rng = Rng::new(0x1a7e);
        for round in 0..40 {
            let before = observed(&session);
            // An offered constraint, the other order of a shown pair, and
            // one of any pair at all.
            let pairs = session.source().problem().variables().to_vec();
            let any = pairs[rng.below(pairs.len())];
            let candidates = [
                offered(&session, &mut rng),
                Some(against_shown(&session, any)),
                Constraint::seen(
                    any.hi(),
                    Verb::Behind,
                    any.lo(),
                    ViewSide::Back,
                    session.source().view(),
                ),
            ];
            for candidate in candidates.into_iter().flatten() {
                match session.preview(candidate, &Limits::default()) {
                    Ok(Preview::Fits(fit)) => {
                        fits += 1;
                        assert_eq!(fit.stacks(ViewSide::Back).len(), session.spot_count());
                    }
                    Ok(Preview::CantFit(why)) => {
                        cant += 1;
                        assert!(!why.constraints.is_empty(), "{name}: {why:?}");
                    }
                    Ok(Preview::TimedOut(out)) => panic!("{name}: {out:?}"),
                    Err(e) => panic!("{name}: {e}"),
                }
                previews += 1;
                assert_eq!(observed(&session), before, "{name} round {round}");
            }
            // Move on: commit an offered constraint now and then.
            if round % 3 == 0
                && let Some(next) = offered(&session, &mut rng)
            {
                let mut list = session.constraints().to_vec();
                list.push(next);
                let _ = session.commit(list, &Limits::default());
                assert_fits(&session, name);
            }
        }
    }
    println!("{previews} previews: {fits} fit, {cant} can't fit, none changed the session");
    assert!(fits > 20 && cant > 20, "{fits} {cant}");
}

/// Add commits exactly the order its preview showed.
#[test]
fn add_lands_on_the_previewed_order() {
    let mut landed = 0;
    for (name, relative) in FIXTURES {
        let mut session = open(relative);
        let mut rng = Rng::new(0xadd);
        for _ in 0..30 {
            let Some(next) = offered(&session, &mut rng) else {
                break;
            };
            let Ok(Preview::Fits(fit)) = session.preview(next, &Limits::default()) else {
                continue;
            };
            let mut list = session.constraints().to_vec();
            list.push(next);
            let Ok(Commit::Committed(committed)) = session.commit(list, &Limits::default()) else {
                panic!("{name}: the preview fit and the commit did not");
            };
            assert_eq!(session.shown_order(), fit.order(), "{name}");
            assert_eq!(committed.changed, fit.changed, "{name}");
            assert_fits(&session, name);
            landed += 1;
        }
    }
    assert!(landed > 10, "{landed}");
}

// Gate 4: removal keeps the order on screen.

#[test]
fn removing_a_constraint_keeps_the_order_on_screen() {
    let mut removals = 0;
    let mut moved_on_add = 0;
    for (name, relative) in FIXTURES {
        let mut session = open(relative);
        let mut rng = Rng::new(0x7e30);
        for _ in 0..60 {
            let before = session.shown_order();
            let mut list = session.constraints().to_vec();
            if !list.is_empty() && rng.chance(0.4) {
                list.remove(rng.below(list.len()));
                let Ok(Commit::Committed(done)) = session.commit(list, &Limits::default()) else {
                    panic!("{name}: a shorter list always fits");
                };
                assert_eq!(session.shown_order(), before, "{name}");
                assert!(done.changed.is_empty(), "{name}");
                removals += 1;
            } else if let Some(next) = offered(&session, &mut rng) {
                list.push(next);
                if let Ok(Commit::Committed(done)) = session.commit(list, &Limits::default()) {
                    moved_on_add += usize::from(!done.changed.is_empty());
                }
            }
            assert_fits(&session, name);
        }
        // Clear all keeps it too.
        let before = session.shown_order();
        let cleared = session.commit(Vec::new(), &Limits::default());
        assert!(matches!(cleared, Ok(Commit::Committed(_))), "{name}");
        assert_eq!(session.shown_order(), before, "{name}");
        assert!(session.constraints().is_empty());
    }
    println!("{removals} removals kept the order; {moved_on_add} adds moved it");
    assert!(removals > 20, "{removals}");
}

/// The open pairs are the deduction's: what the creases and the committed
/// constraints leave open, never one they force.
#[test]
fn the_open_pairs_are_what_deduction_leaves() {
    for (name, relative) in FIXTURES {
        let mut session = open(relative);
        let mut rng = Rng::new(0x09e2);
        for _ in 0..20 {
            let open = session.open_pairs();
            for pair in session.source().problem().variables() {
                let forced = session.forced(pair.lo(), pair.hi());
                assert_eq!(forced.is_none(), open.binary_search(pair).is_ok(), "{name}");
                if let Some(above) = forced {
                    assert_eq!(
                        session.shown_order().above(pair.lo(), pair.hi()),
                        Some(above)
                    );
                }
            }
            let faces: Vec<FaceId> = open.iter().flat_map(|p| p.faces()).collect();
            for face in faces {
                for partner in session.open_partners(face) {
                    let pair = FacePair::new(face, partner).expect("distinct");
                    assert!(open.binary_search(&pair).is_ok(), "{name}");
                }
            }
            let Some(next) = offered(&session, &mut rng) else {
                break;
            };
            let mut list = session.constraints().to_vec();
            list.push(next);
            let _ = session.commit(list, &Limits::default());
        }
    }
}

/// A constraint that is no question is refused, by index and fault.
#[test]
fn a_constraint_that_is_no_question_is_refused() {
    let session = open(FIXTURES[0].1);
    let n = session.source().view().faces().len() as u32;
    let pair = session.source().problem().variables()[0];
    let same = Constraint {
        subject: pair.lo(),
        object: pair.lo(),
        sign: FoldSign::Front,
    };
    let unknown = Constraint {
        subject: FaceId(n),
        object: pair.lo(),
        sign: FoldSign::Front,
    };
    // Two faces that do not overlap.
    let apart = (0..n)
        .flat_map(|a| (a + 1..n).map(move |b| (FaceId(a), FaceId(b))))
        .find(|&(a, b)| !session.source().problem().is_variable(a, b))
        .map(|(a, b)| Constraint {
            subject: a,
            object: b,
            sign: FoldSign::Back,
        })
        .expect("kabuto has faces apart");
    for (candidate, fault) in [
        (same, ConstraintFault::SameFace),
        (unknown, ConstraintFault::UnknownFace { face: FaceId(n) }),
        (apart, ConstraintFault::NotOverlapping),
    ] {
        let refused = session.preview(candidate, &Limits::default());
        assert_eq!(
            refused,
            Err(SessionRefusal::BadConstraint { index: 0, fault }),
            "{candidate:?}"
        );
    }
    // Two constraints that order one pair both ways can't fit, and name both.
    let view = session.source().view();
    let up = Constraint::seen(pair.lo(), Verb::InFrontOf, pair.hi(), ViewSide::Front, view)
        .expect("faces");
    let down = Constraint::seen(pair.lo(), Verb::InFrontOf, pair.hi(), ViewSide::Back, view)
        .expect("faces");
    let mut opposed = open(FIXTURES[0].1);
    match opposed.commit(vec![up, down], &Limits::default()) {
        Ok(Commit::CantFit(why)) => {
            assert_eq!(why.proof, CantFitProof::Opposed);
            assert_eq!(why.constraints, vec![0, 1]);
        }
        other => panic!("{other:?}"),
    }
    assert!(opposed.constraints().is_empty());
}

/// A constraint reads the same from either side in its own words: "in front
/// of" from one side is "behind" from the other.
#[test]
fn a_constraint_is_relative_to_the_paper() {
    let session = open(FIXTURES[0].1);
    let view = session.source().view();
    for pair in session.source().problem().variables() {
        for verb in [Verb::InFrontOf, Verb::Behind] {
            for side in [ViewSide::Front, ViewSide::Back] {
                let c = Constraint::seen(pair.lo(), verb, pair.hi(), side, view).expect("faces");
                assert_eq!(c.verb(side, view), Some(verb));
                let other_side = match side {
                    ViewSide::Front => ViewSide::Back,
                    ViewSide::Back => ViewSide::Front,
                };
                let other_verb = match verb {
                    Verb::InFrontOf => Verb::Behind,
                    Verb::Behind => Verb::InFrontOf,
                };
                assert_eq!(c.verb(other_side, view), Some(other_verb));
                assert_eq!(
                    c.subject_above(view),
                    Some((verb == Verb::InFrontOf) == (side == ViewSide::Front))
                );
            }
        }
    }
}

// Gate 6: save, then restore on the same creases.

fn round_trip(session: &ConstraintSession, relative: &str) -> (usize, ConstraintSession) {
    let record = session.save().expect("save");
    let json = encode_record(&record).expect("encode");
    let RecordRead::Read {
        record: read,
        json: again,
    } = read_record(&json)
    else {
        panic!("{relative}: the record does not read back");
    };
    assert_eq!(again, json);
    assert_eq!(read, record);
    let restored = ConstraintSession::restore(source_of(relative).1, &read, &Limits::default())
        .unwrap_or_else(|e| panic!("{relative}: {e}"));
    assert_eq!(restored.outcome, RestoreOutcome::Applied, "{relative}");
    assert!(
        restored
            .faces
            .iter()
            .all(|f| matches!(f, FaceStatus::Intact { .. })),
        "{relative}: {:?}",
        restored.faces
    );
    assert!(
        restored
            .constraints
            .iter()
            .all(|s| *s == ConstraintStatus::Intact),
        "{relative}"
    );
    assert!(
        restored.order.iter().all(|s| *s == SavedPairStatus::Kept),
        "{relative}"
    );
    (json.len(), restored.session)
}

#[test]
fn a_saved_session_restores_to_the_same_constraints_and_order() {
    for (name, relative) in FIXTURES {
        let mut session = open(relative);
        let mut rng = Rng::new(0x2071);
        for step in 0..8 {
            let (bytes, restored) = round_trip(&session, relative);
            assert_eq!(
                restored.constraints(),
                session.constraints(),
                "{name} {step}"
            );
            assert_eq!(
                restored.shown_order(),
                session.shown_order(),
                "{name} {step}"
            );
            assert_eq!(restored.open_pairs(), session.open_pairs(), "{name} {step}");
            assert_eq!(
                encode_record(&restored.save().expect("save")),
                encode_record(&session.save().expect("save")),
                "{name} {step}"
            );
            if step == 7 {
                println!(
                    "{name}: {} constraints, record {bytes} bytes",
                    session.constraints().len()
                );
            }
            let Some(next) = offered(&session, &mut rng) else {
                break;
            };
            let mut list = session.constraints().to_vec();
            list.push(next);
            let _ = session.commit(list, &Limits::default());
        }
    }
}

/// The shared record golden's engine record
/// (`tests/fixtures/layer-order/record-v1.json`, which the TypeScript codec is
/// held to as well) is what a session saves for kabuto with two constraints.
#[test]
fn the_record_golden_s_kabuto_is_what_a_session_saves() {
    let mut session = open(FIXTURES[0].1);
    for (verb, side) in [
        (Verb::InFrontOf, ViewSide::Front),
        (Verb::Behind, ViewSide::Back),
    ] {
        let pair = session.open_pairs()[0];
        let c = Constraint::seen(pair.hi(), verb, pair.lo(), side, session.source().view())
            .expect("faces");
        let mut list = session.constraints().to_vec();
        list.push(c);
        let Ok(Commit::Committed(_)) = session.commit(list, &Limits::default()) else {
            panic!("an open pair takes either order");
        };
    }
    let fresh = encode_record(&session.save().expect("save")).expect("encode");
    let path = repo_path("tests/fixtures/layer-order/record-v1.json");
    let golden: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("the golden")).expect("JSON");
    let saved = golden["written"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|case| {
            case["name"]
                .as_str()
                .is_some_and(|n| n.starts_with("kabuto"))
        })
        .and_then(|case| case["json"].as_str())
        .unwrap_or_default();
    assert_eq!(
        saved, fresh,
        "the golden's kabuto record is stale; the engine saves:\n{fresh}"
    );
}

// Gate 7: out of nodes is a timeout, never "can't fit".

#[test]
fn a_tiny_budget_times_out_rather_than_refuses() {
    let tiny = Limits {
        max_nodes: Some(0),
        fast_nodes: 0,
        deadline: None,
    };
    let mut timed_out = 0;
    let mut by_propagation = 0;
    for (name, relative) in FIXTURES {
        let session = open(relative);
        for pair in session.source().problem().variables().to_vec() {
            let candidate = against_shown(&session, pair);
            let full = session.preview(candidate, &Limits::default());
            let short = session.preview(candidate, &tiny);
            match (&full, &short) {
                // No search was needed: the same answer.
                (Ok(Preview::Fits(a)), Ok(Preview::Fits(b))) if a.nodes == 0 => {
                    assert_eq!(a, b, "{name}");
                }
                // A proof by deduction alone needs no nodes.
                (Ok(Preview::CantFit(a)), Ok(Preview::CantFit(b)))
                    if !matches!(a.proof, CantFitProof::NoOrder { .. }) =>
                {
                    assert_eq!(a, b, "{name}");
                    by_propagation += 1;
                }
                // Anything that needed a search runs out.
                (Ok(Preview::Fits(_) | Preview::CantFit(_)), Ok(Preview::TimedOut(_))) => {
                    timed_out += 1;
                }
                other => panic!("{name} {pair}: {other:?}"),
            }
        }
    }
    println!("{timed_out} previews timed out, {by_propagation} proved by deduction alone");
    assert!(timed_out > 5, "{timed_out}");

    // A restore whose check needs a search: a constraint the first order
    // breaks, saved with no order pairs.
    let relative = FIXTURES[0].1;
    let mut session = open(relative);
    let open_pair = session.open_pairs()[0];
    let candidate = against_shown(&session, open_pair);
    let Ok(Commit::Committed(done)) = session.commit(vec![candidate], &Limits::default()) else {
        panic!("an open pair's other order fits");
    };
    assert!(done.nodes > 0 || done.stage != oristudio_fold::CheckStage::Unchanged);
    let mut record = session.save().expect("save");
    record.order.clear();
    // With no nodes at all, the open itself times out.
    assert!(matches!(
        ConstraintSession::restore(source_of(relative).1, &record, &tiny),
        Err(SessionRefusal::TimedOut { .. })
    ));
    // A deadline that passes the moment the open is done: the restore's
    // check runs out, and nothing is applied.
    let reads = {
        let source = source_of(relative).1;
        let before = TICKS.load(Ordering::SeqCst);
        let far = Limits {
            deadline: Some(Deadline {
                now_ms: ticking,
                at_ms: f64::MAX,
            }),
            ..Limits::default()
        };
        ConstraintSession::open(source, &far).expect("open");
        TICKS.load(Ordering::SeqCst) - before
    };
    let source = source_of(relative).1;
    let at_open = TICKS.load(Ordering::SeqCst);
    let just_opens = Limits {
        deadline: Some(Deadline {
            now_ms: ticking,
            at_ms: (at_open + reads) as f64,
        }),
        ..Limits::default()
    };
    let restored = ConstraintSession::restore(source, &record, &just_opens).expect("it opens");
    assert!(
        matches!(restored.outcome, RestoreOutcome::TimedOut(_)),
        "{:?}",
        restored.outcome
    );
    assert!(restored.session.constraints().is_empty());
    assert_eq!(restored.constraints, vec![ConstraintStatus::Intact]);
    assert_fits(&restored.session, "timed out");
    // With time, the same restore applies the constraint.
    let applied = ConstraintSession::restore(source_of(relative).1, &record, &Limits::default())
        .expect("restore");
    assert_eq!(applied.outcome, RestoreOutcome::Applied);
    assert_eq!(applied.session.constraints(), &[candidate]);
}

/// A clock that moves one millisecond each time it is read, so a deadline
/// can fall between two reads.
static TICKS: AtomicU64 = AtomicU64::new(0);

fn ticking() -> f64 {
    TICKS.fetch_add(1, Ordering::SeqCst) as f64
}

// Gate 5: statuses after splits and merges of kabuto.

/// Kabuto as a host hands it over.
fn kabuto() -> FoldSource {
    source_of(FIXTURES[0].1).0
}

/// Kabuto's corner flap: the triangle of the sheet's corner and the mountain
/// crease across it, as its corner and its two other corners, in the crease
/// pattern's coordinates.
fn corner_flap(source: &LayerSource) -> (FaceId, [KernelPoint; 3]) {
    let inputs = source.render_inputs();
    let flat = inputs.flat_points();
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for p in flat {
        x0 = x0.min(p.x);
        y0 = y0.min(p.y);
        x1 = x1.max(p.x);
        y1 = y1.max(p.y);
    }
    let side = (x1 - x0).max(y1 - y0);
    let is_corner = |p: KernelPoint| {
        ((p.x - x0).abs() < 1e-9 || (p.x - x1).abs() < 1e-9)
            && ((p.y - y0).abs() < 1e-9 || (p.y - y1).abs() < 1e-9)
    };
    for (k, ring) in inputs.wireframe().faces.iter().enumerate() {
        let face = FaceId(k as u32);
        let area = source.paper_area(face).expect("an area");
        if ring.len() != 3 || (area / (side * side) - 0.03125).abs() > 1e-9 {
            continue;
        }
        let points: Vec<KernelPoint> = ring.iter().map(|&i| flat[i]).collect();
        let Some(c) = points.iter().position(|&p| is_corner(p)) else {
            continue;
        };
        return (face, [points[c], points[(c + 1) % 3], points[(c + 2) % 3]]);
    }
    panic!("kabuto has its corner flap");
}

/// Kabuto with a crease of `color` across its corner flap, parallel to the
/// flap's fold and `t` of the way from the sheet's corner to it: the edit a
/// user makes by drawing one line, the paper's two edges split where it
/// meets them, as the kernel splits them. The flap's tip folds over.
fn kabuto_cut(t: f64, color: LineColor) -> FoldSource {
    let (fold, plain) = source_of(FIXTURES[0].1);
    let (_, [c, a, b]) = corner_flap(&plain);
    let at = |p: KernelPoint| KernelPoint::new(c.x + t * (p.x - c.x), c.y + t * (p.y - c.y));
    let (pa, pb) = (at(a), at(b));
    let near = |p: KernelPoint, q: KernelPoint| p.distance(q) < 1e-9;
    let joins =
        |s: &LineSegment, p, q| (near(s.a, p) && near(s.b, q)) || (near(s.a, q) && near(s.b, p));
    let piece = |s: &LineSegment, p, q| LineSegment {
        a: p,
        b: q,
        ..s.clone()
    };
    let mut segments = Vec::with_capacity(fold.segments.len() + 3);
    let mut split = 0;
    for s in &fold.segments {
        if joins(s, a, c) {
            segments.extend([piece(s, a, pa), piece(s, pa, c)]);
            split += 1;
        } else if joins(s, b, c) {
            segments.extend([piece(s, b, pb), piece(s, pb, c)]);
            split += 1;
        } else {
            segments.push(s.clone());
        }
    }
    assert_eq!(split, 2, "the flap's two paper edges");
    segments.push(LineSegment::with_color(pa, pb, color));
    let digest = face_ring_digest_from_segments(&segments, fold.starting_face_id)
        .expect("faces")
        .to_string();
    FoldSource {
        segments,
        starting_face_id: fold.starting_face_id,
        aux_segments: fold.aux_segments.clone(),
        digest,
    }
}

/// [`kabuto_cut`] with whichever letter Oriedita folds flat, as Edit would
/// fold the edited creases, and the session orders.
fn split_kabuto(t: f64) -> FoldSource {
    for color in [LineColor::Blue2, LineColor::Red1] {
        let fold = kabuto_cut(t, color);
        let mut cp = CpSession::new();
        let solved = matches!(
            cp.folded_figure_fold_with_order(&fold, &[], FoldedFigureModel::default()),
            Ok(oristudio_cp::session::FoldWithOrderResult::Folded { snapshot, .. })
                if snapshot.outcome == FoldOutcome::Solved
        );
        let Ok(source) = LayerSource::from_oriedita(&fold) else {
            continue;
        };
        if solved && ConstraintSession::open(source, &Limits::default()).is_ok() {
            return fold;
        }
    }
    panic!("no letter folds kabuto's split flap flat");
}

fn session_on(fold: &FoldSource) -> ConstraintSession {
    let source = LayerSource::from_oriedita(fold).unwrap_or_else(|e| panic!("{e}"));
    ConstraintSession::open(source, &Limits::default()).unwrap_or_else(|e| panic!("{e}"))
}

/// An open pair whose faces are neither of `avoid`, and one with `face`.
fn open_pair_with(session: &ConstraintSession, face: Option<FaceId>, avoid: &[FaceId]) -> FacePair {
    *session
        .open_pairs()
        .iter()
        .find(|p| match face {
            Some(face) => p.contains(face) && !avoid.iter().any(|&a| a != face && p.contains(a)),
            None => !avoid.iter().any(|&a| p.contains(a)),
        })
        .unwrap_or_else(|| panic!("an open pair with {face:?}, avoiding {avoid:?}"))
}

fn record_of(session: &ConstraintSession, constraints: Vec<Constraint>) -> LayerOrderRecord {
    let mut saving = ConstraintSession::open(fresh(session), &Limits::default()).expect("open");
    let Ok(Commit::Committed(_)) = saving.commit(constraints, &Limits::default()) else {
        panic!("the constraints fit");
    };
    saving.save().expect("save")
}

#[test]
fn a_split_face_makes_its_constraints_ambiguous() {
    let plain = session_on(&kabuto());
    let (flap, _) = corner_flap(plain.source());
    let elsewhere = open_pair_with(&plain, None, &[flap]);
    let at_flap = open_pair_with(&plain, Some(flap), &[]);
    let view = plain.source().view();
    let c = |p: FacePair| {
        Constraint::seen(p.lo(), Verb::InFrontOf, p.hi(), ViewSide::Front, view).expect("faces")
    };
    let record = record_of(&plain, vec![c(elsewhere), c(at_flap)]);

    // Split below the flap's centroid: the flap is ambiguous.
    let split = LayerSource::from_oriedita(&split_kabuto(0.4)).expect("source");
    let restored = ConstraintSession::restore(split, &record, &Limits::default()).expect("restore");
    assert_eq!(
        restored.constraints,
        vec![ConstraintStatus::Intact, ConstraintStatus::Ambiguous]
    );
    assert_eq!(restored.outcome, RestoreOutcome::Applied);
    // Only the intact one is committed, as it was built.
    assert_eq!(restored.session.constraints().len(), 1);
    let flap_index = face_index(&record, plain.source().paper_point(flap).expect("point"));
    let FaceStatus::Ambiguous { area, .. } = restored.faces[flap_index] else {
        panic!("{:?}", restored.faces[flap_index]);
    };
    let saved = record.faces[flap_index].area;
    assert!((area / saved - 0.84).abs() < 1e-9, "{area} {saved}");
    // Every other face is intact.
    assert_eq!(
        restored
            .faces
            .iter()
            .filter(|f| matches!(f, FaceStatus::Intact { .. }))
            .count(),
        record.faces.len() - 1
    );
    // The flap's saved pairs are unresolved; the rest are kept.
    for (pair, status) in record.order.iter().zip(&restored.order) {
        let names_flap = pair.f as usize == flap_index || pair.g as usize == flap_index;
        assert_eq!(
            *status,
            if names_flap {
                SavedPairStatus::Unresolved
            } else {
                SavedPairStatus::Kept
            },
            "{pair:?}"
        );
    }
    assert_fits(&restored.session, "split");
}

/// The cut moved so that it runs through a saved face's point: the face is
/// gone, and so is its constraint.
#[test]
fn a_crease_through_a_saved_point_makes_its_face_gone() {
    // Saved on kabuto with its flap cut at 0.4: the tip's centroid lies 4/15
    // of the way from the corner to the flap's fold.
    let saved = session_on(&split_kabuto(0.4));
    let plain = session_on(&kabuto());
    let (flap, _) = corner_flap(plain.source());
    let flap_at = plain.source().paper_point(flap).expect("point");
    let tip = (0..saved.source().view().faces().len() as u32)
        .map(FaceId)
        .find(|&f| {
            let at = saved.source().paper_point(f);
            at.and_then(|p| plain.source().face_at_paper(p)) == Some(flap)
                && saved.source().face_at_paper(flap_at) != Some(f)
        })
        .expect("the tip");
    let piece = saved
        .source()
        .face_at_paper(flap_at)
        .expect("the rest of the flap");
    let view = saved.source().view();
    let c = |p: FacePair| {
        Constraint::seen(p.lo(), Verb::InFrontOf, p.hi(), ViewSide::Front, view).expect("faces")
    };
    let elsewhere = open_pair_with(&saved, None, &[tip, piece]);
    let at_tip = open_pair_with(&saved, Some(tip), &[piece]);
    let record = record_of(&saved, vec![c(elsewhere), c(at_tip)]);

    // Restored with the cut moved to run through the tip's saved point.
    let moved = LayerSource::from_oriedita(&split_kabuto(0.8 / 3.0)).expect("source");
    let restored = ConstraintSession::restore(moved, &record, &Limits::default()).expect("restore");
    let tip_index = face_index(&record, saved.source().paper_point(tip).expect("point"));
    assert_eq!(restored.faces[tip_index], FaceStatus::Gone);
    assert_eq!(
        restored.constraints,
        vec![
            ConstraintStatus::Intact,
            ConstraintStatus::Gone {
                cause: GoneCause::FaceGone
            }
        ]
    );
    // The rest of the flap grew: ambiguous, never guessed.
    let piece_index = face_index(&record, saved.source().paper_point(piece).expect("point"));
    assert!(matches!(
        restored.faces[piece_index],
        FaceStatus::Ambiguous { .. }
    ));
    assert_eq!(restored.outcome, RestoreOutcome::Applied);
    assert_eq!(restored.session.constraints().len(), 1);
    assert_fits(&restored.session, "moved cut");
}

fn face_index(record: &LayerOrderRecord, at: [f64; 2]) -> usize {
    record
        .faces
        .iter()
        .position(|f| f.at == at)
        .expect("the face is in the record")
}

#[test]
fn merged_faces_make_their_constraints_ambiguous_or_gone() {
    // Saved on kabuto with its flap split; restored on kabuto.
    let split = session_on(&split_kabuto(0.4));
    let plain = session_on(&kabuto());
    let (flap, _) = corner_flap(plain.source());
    let flap_at = plain.source().paper_point(flap).expect("point");
    // The flap's two pieces: the one holding its centroid, and the tip.
    let piece = split.source().face_at_paper(flap_at).expect("a piece");
    let tip = (0..split.source().view().faces().len() as u32)
        .map(FaceId)
        .find(|&f| {
            f != piece
                && split
                    .source()
                    .paper_point(f)
                    .and_then(|p| plain.source().face_at_paper(p))
                    == Some(flap)
        })
        .expect("the tip");
    let view = split.source().view();
    let c = |a: FaceId, b: FaceId| {
        Constraint::seen(a, Verb::InFrontOf, b, ViewSide::Front, view).expect("faces")
    };
    let between = FacePair::new(piece, tip).expect("two pieces");
    assert!(
        split.open_pairs().contains(&between) || split.forced(piece, tip).is_some(),
        "the pieces overlap"
    );
    let elsewhere = open_pair_with(&split, None, &[piece, tip]);
    let at_piece = open_pair_with(&split, Some(piece), &[tip]);
    let mut constraints = vec![
        c(elsewhere.lo(), elsewhere.hi()),
        c(at_piece.lo(), at_piece.hi()),
    ];
    // The pieces' own order, as it is shown.
    let shown_up = split.shown_order().above(piece, tip).expect("ordered");
    constraints.push(if shown_up {
        c(piece, tip)
    } else {
        c(tip, piece)
    });
    let record = record_of(&split, constraints);

    let restored =
        ConstraintSession::restore(fresh(&plain), &record, &Limits::default()).expect("restore");
    assert_eq!(
        restored.constraints,
        vec![
            ConstraintStatus::Intact,
            ConstraintStatus::Ambiguous,
            ConstraintStatus::Gone {
                cause: GoneCause::SameFace
            }
        ]
    );
    for at in [
        split.source().paper_point(piece),
        split.source().paper_point(tip),
    ] {
        let i = face_index(&record, at.expect("point"));
        let FaceStatus::Ambiguous { face, area } = restored.faces[i] else {
            panic!("{:?}", restored.faces[i]);
        };
        assert_eq!(face, flap);
        assert!(area > record.faces[i].area);
    }
    assert_eq!(restored.outcome, RestoreOutcome::Applied);
}

/// `face`'s index in `record`, listing it when it is not.
fn listed(record: &mut LayerOrderRecord, source: &LayerSource, face: FaceId) -> u32 {
    let at = source.paper_point(face).expect("a point");
    if let Some(i) = record.faces.iter().position(|f| f.at == at) {
        return i as u32;
    }
    record.faces.push(RecordFace {
        at,
        area: source.paper_area(face).expect("an area"),
    });
    (record.faces.len() - 1) as u32
}

/// A fresh source over what `session` was opened on, as a reopen builds one.
fn fresh(session: &ConstraintSession) -> LayerSource {
    LayerSource::from_oriedita(session.source().fold_source()).unwrap_or_else(|e| panic!("{e}"))
}

#[test]
fn intact_constraints_that_clash_are_marked_and_none_is_applied() {
    let plain = session_on(&kabuto());
    let view = plain.source().view();
    // A pair the creases force, saved the other way (as a crease edit that
    // turned a letter would leave it), beside an intact constraint.
    let forced = plain
        .source()
        .problem()
        .variables()
        .iter()
        .copied()
        .find(|p| plain.forced(p.lo(), p.hi()).is_some())
        .expect("kabuto forces pairs");
    let lo_above = plain.forced(forced.lo(), forced.hi()).expect("forced");
    let against = Constraint {
        subject: forced.lo(),
        object: forced.hi(),
        sign: FoldSign::of_above(!lo_above, view.front_up(forced.hi()).expect("a side")),
    };
    let elsewhere = open_pair_with(&plain, None, &forced.faces());
    let fine = Constraint::seen(
        elsewhere.lo(),
        Verb::Behind,
        elsewhere.hi(),
        ViewSide::Front,
        view,
    )
    .expect("faces");
    let mut record = record_of(&plain, vec![fine]);
    // Add the clashing one by hand: no session would commit it.
    let f = listed(&mut record, plain.source(), against.subject);
    let g = listed(&mut record, plain.source(), against.object);
    record.constraints.push(RecordPair {
        f,
        g,
        sign: against.sign,
    });
    let restored =
        ConstraintSession::restore(fresh(&plain), &record, &Limits::default()).expect("restore");
    assert_eq!(
        restored.outcome,
        RestoreOutcome::Clash {
            constraints: vec![1]
        }
    );
    assert_eq!(
        restored.constraints,
        vec![ConstraintStatus::Intact, ConstraintStatus::Clashing]
    );
    // Nothing is applied, and the order shown still fits the creases.
    assert!(restored.session.constraints().is_empty());
    assert_fits(&restored.session, "clash");
    // The saved order is shown where the creases allow it.
    assert!(
        restored.order.iter().all(|s| *s == SavedPairStatus::Kept),
        "{:?}",
        restored.order
    );
}

#[test]
fn faces_that_no_longer_overlap_make_their_constraint_gone() {
    let plain = session_on(&kabuto());
    let n = plain.source().view().faces().len() as u32;
    let (a, b) = (0..n)
        .flat_map(|a| (a + 1..n).map(move |b| (FaceId(a), FaceId(b))))
        .find(|&(a, b)| !plain.source().problem().is_variable(a, b))
        .expect("faces apart");
    let mut record = record_of(&plain, Vec::new());
    let (f, g) = (
        listed(&mut record, plain.source(), a),
        listed(&mut record, plain.source(), b),
    );
    record.constraints.push(RecordPair {
        f,
        g,
        sign: FoldSign::Front,
    });
    let k = record.faces.len() as u32;
    let restored =
        ConstraintSession::restore(fresh(&plain), &record, &Limits::default()).expect("restore");
    assert_eq!(
        restored.constraints,
        vec![ConstraintStatus::Gone {
            cause: GoneCause::NoOverlap
        }]
    );
    // A record that would not encode is refused.
    record.constraints.push(RecordPair {
        f: 0,
        g: k,
        sign: FoldSign::Back,
    });
    assert!(matches!(
        ConstraintSession::restore(fresh(&plain), &record, &Limits::default()),
        Err(SessionRefusal::BadRecord { .. })
    ));
}
