//! The Layer order dialog's constraint sessions across the bridge
//! (`layer_*`, `implementation-plans/layer-order-dialog.md` row E7),
//! natively: every call through `LayerSessions`, the store `FoldEngine`
//! holds, over kabuto and `solution_sample_1` as the CP kernel hands them
//! over. What the calls answer is `oristudio-fold`'s `steer` tests'
//! business; these hold what crosses: flat pairs and triples, stacks that
//! number the scene's subfaces, relations the CP kernel folds, codes for
//! every refusal and mistake, limits and deadlines, and handles.
#![cfg(not(target_arch = "wasm32"))]

use std::collections::HashMap;

use oristudio_cp::folding::{FoldOutcome, FoldedFigureModel};
use oristudio_cp::session::{
    CpSession, FoldSource, FoldWithOrderResult, relations_from_flat_pairs,
};
use oristudio_fold::FaceId;
use oristudio_fold::complete::BudgetLimit;
use oristudio_fold::steer::{
    ConstraintStatus, LayerSource, RecordFace, RecordPair, RecordRead, SolutionCount, StepBy,
    StepDirection, Tally, TimedOut, Verb, ViewSide, encode_record, read_record, scene_relations,
};
use oristudio_fold_wasm::steer::{
    CantFitKind, Committing, Explained, FACE_INTACT, LayerCallError, LayerLimits, LayerOpened,
    LayerRefusal, LayerRestored, LayerSessions, LayerSolutionCaps, OpenedOnWire, Opening,
    PAIR_KEPT, PAIR_UNRESOLVED, PackedStacks, Previewed, RestoredOutcome, Restoring, Saving,
    Showing, Stepping, constraints_of,
};

fn repo(relative: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

/// What a host hands the dialog for a fixture folded whole.
fn source_of(relative: &str) -> FoldSource {
    let text = std::fs::read_to_string(repo(relative)).unwrap_or_else(|e| panic!("{e}"));
    let mut cp = CpSession::new();
    let document = if relative.ends_with(".fold") {
        cp.load_fold(&text, "")
    } else {
        cp.load_cp(&text, "")
    }
    .unwrap_or_else(|e| panic!("{relative}: {e:?}"));
    let lines = cp
        .document_summary(document)
        .expect("summary")
        .line_segments;
    cp.fold_source_of_selection(document, &(1..=lines).collect::<Vec<_>>(), 1)
        .expect("the sheet's source")
}

fn kabuto() -> FoldSource {
    source_of("tests/fixtures/flat-folder/kabuto.fold")
}

fn defaults() -> LayerLimits {
    LayerLimits::default()
}

/// No nodes at all: anything that needs a search runs out.
fn tiny() -> LayerLimits {
    LayerLimits {
        max_nodes: Some(0),
        fast_nodes: Some(0),
        deadline_ms: None,
    }
}

/// A deadline already passed when the call starts.
fn passed() -> LayerLimits {
    LayerLimits {
        deadline_ms: Some(0.0),
        ..LayerLimits::default()
    }
}

/// The same call, with time: keep trying.
fn later() -> LayerLimits {
    LayerLimits {
        deadline_ms: Some(60_000.0),
        ..LayerLimits::default()
    }
}

fn open(layers: &mut LayerSessions, source: &FoldSource) -> LayerOpened {
    match layers.open(source, &defaults()) {
        Ok(Opening::Opened(opened)) => opened,
        other => panic!("{other:?}"),
    }
}

fn pairs(flat: &[u32]) -> Vec<(u32, u32)> {
    assert_eq!(flat.len() % 2, 0, "pairs are flat [a, b, …]");
    flat.chunks_exact(2).map(|p| (p[0], p[1])).collect()
}

/// The sign a sentence gets, by the rule the wire documents: `1` exactly
/// when "the subject is nearer a viewer of the front" equals the object's
/// `front_up`.
fn sentence(
    subject: u32,
    in_front_of: bool,
    object: u32,
    from_front: bool,
    front_up: &[u8],
) -> [i32; 3] {
    let subject_above = in_front_of == from_front;
    let object_front_up = front_up[object as usize] == 1;
    let sign = if subject_above == object_front_up {
        1
    } else {
        -1
    };
    [subject as i32, object as i32, sign]
}

/// The upper face of every pair the order on screen relates.
fn uppers(relations: &[u32]) -> HashMap<(u32, u32), u32> {
    pairs(relations)
        .into_iter()
        .map(|(upper, lower)| ((upper.min(lower), upper.max(lower)), upper))
        .collect()
}

/// The constraint the order on screen breaks on `pair`: its other order.
fn against_shown(
    layers: &LayerSessions,
    session: u32,
    (a, b): (u32, u32),
    front_up: &[u8],
) -> [i32; 3] {
    let shown = uppers(&layers.oriedita_relations(session).expect("relations"));
    let upper = shown[&(a.min(b), a.max(b))];
    let lower = if upper == a { b } else { a };
    sentence(lower, true, upper, true, front_up)
}

/// Everything a host can read of a session.
#[derive(Debug, PartialEq)]
struct Observed {
    open_pairs: Vec<u32>,
    constraints: Vec<i32>,
    front: PackedStacks,
    back: PackedStacks,
    relations: Vec<u32>,
    record: Saving,
}

fn observed(layers: &LayerSessions, session: u32) -> Observed {
    Observed {
        open_pairs: layers.open_pairs(session).expect("open pairs"),
        constraints: layers.constraints(session).expect("constraints"),
        front: layers.stacks(session, ViewSide::Front).expect("front"),
        back: layers.stacks(session, ViewSide::Back).expect("back"),
        relations: layers.oriedita_relations(session).expect("relations"),
        record: layers.save(session, None).expect("save"),
    }
}

fn spot(stacks: &PackedStacks, i: usize) -> &[u32] {
    &stacks.faces[stacks.offsets[i] as usize..stacks.offsets[i + 1] as usize]
}

/// The back's stacks are the front's, each reversed.
fn assert_turned_over(front: &PackedStacks, back: &PackedStacks, spots: u32) {
    assert_eq!(front.offsets.len(), spots as usize + 1);
    assert_eq!(front.offsets, back.offsets);
    for i in 0..spots as usize {
        let mut reversed = spot(front, i).to_vec();
        reversed.reverse();
        assert_eq!(spot(back, i), reversed.as_slice(), "spot {i}");
    }
}

/// The CP kernel folds `relations` on `source` into a figure it solved: what
/// Apply does with them.
fn folds_with(source: &FoldSource, relations: &[u32]) {
    let relations = relations_from_flat_pairs(relations).expect("flat pairs");
    let folded = CpSession::new()
        .folded_figure_fold_with_order(source, &relations, FoldedFigureModel::default())
        .expect("a fold");
    match folded {
        FoldWithOrderResult::Folded { snapshot, .. } => {
            assert_eq!(snapshot.outcome, FoldOutcome::Solved);
        }
        FoldWithOrderResult::Refused { refusal } => panic!("{refusal:?}"),
    }
}

fn saved_json(layers: &LayerSessions, session: u32) -> String {
    match layers.save(session, None) {
        Ok(Saving::Saved { json }) => json,
        other => panic!("{other:?}"),
    }
}

fn restored(layers: &mut LayerSessions, source: &FoldSource, json: &str) -> LayerRestored {
    match layers.restore(source, json, &defaults()) {
        Ok(Restoring::Restored(restored)) => *restored,
        other => panic!("{other:?}"),
    }
}

// ---------------------------------------------------------------------------

#[test]
fn an_open_session_reports_its_faces_open_pairs_and_spots() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    let opened = open(&mut layers, &source);
    assert_eq!(opened.session, 1);
    assert_eq!(opened.faces, 18);
    assert_eq!(opened.front_up.len(), 18);
    assert!(opened.front_up.iter().all(|&b| b <= 1));
    assert!(opened.spots > 0);
    // Kabuto's creases leave 36 of its 117 overlapping pairs open, each
    // smaller face first, ascending.
    let open = pairs(&opened.open_pairs);
    assert_eq!(open.len(), 36);
    assert!(open.iter().all(|&(a, b)| a < b && b < 18));
    assert!(open.windows(2).all(|w| w[0] < w[1]));
    assert_eq!(
        layers.open_pairs(opened.session),
        Ok(opened.open_pairs.clone())
    );
    assert_eq!(layers.constraints(opened.session), Ok(Vec::new()));
    assert_eq!(layers.len(), 1);

    // The sign rule the wire documents is the engine's own.
    let view = LayerSource::from_oriedita(&source).expect("source");
    let view = view.view();
    for (a, b) in open {
        for in_front_of in [true, false] {
            for from_front in [true, false] {
                let verb = if in_front_of {
                    Verb::InFrontOf
                } else {
                    Verb::Behind
                };
                let side = if from_front {
                    ViewSide::Front
                } else {
                    ViewSide::Back
                };
                let engine =
                    oristudio_fold::steer::Constraint::seen(FaceId(a), verb, FaceId(b), side, view)
                        .expect("faces");
                let wire = sentence(a, in_front_of, b, from_front, &opened.front_up);
                assert_eq!(constraints_of(&wire), Ok(vec![engine]));
            }
        }
    }
}

#[test]
fn stacks_number_the_scene_s_subfaces_and_relations_fold_in_the_kernel() {
    for relative in [
        "tests/fixtures/flat-folder/kabuto.fold",
        "tests/fixtures/oriedita/solution_sample_1.cp",
    ] {
        let source = source_of(relative);
        let mut layers = LayerSessions::new();
        let opened = open(&mut layers, &source);
        let session = opened.session;
        let front = layers.stacks(session, ViewSide::Front).expect("front");
        let back = layers.stacks(session, ViewSide::Back).expect("back");
        assert_turned_over(&front, &back, opened.spots);
        for (side, stacks) in [(ViewSide::Front, &front), (ViewSide::Back, &back)] {
            let scene = layers
                .scene(session, side, &FoldedFigureModel::default())
                .expect("scene")
                .expect("subfaces");
            assert_eq!(scene.flipped, side == ViewSide::Back, "{relative}");
            assert_eq!(scene.subfaces.len(), opened.spots as usize, "{relative}");
            for (i, subface) in scene.subfaces.iter().enumerate() {
                let drawn: Vec<u32> = subface
                    .faces_top_to_bottom
                    .iter()
                    .map(|&f| f as u32)
                    .collect();
                assert_eq!(
                    spot(stacks, i),
                    drawn.as_slice(),
                    "{relative} {side:?} spot {i}"
                );
            }
        }
        // The order on screen, folded by the CP kernel as Apply folds it.
        let relations = layers.oriedita_relations(session).expect("relations");
        assert!(!relations.is_empty());
        folds_with(&source, &relations);
    }
}

#[test]
fn a_preview_fits_and_never_commits_and_a_commit_lands_on_it() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    let opened = open(&mut layers, &source);
    let session = opened.session;
    let before = observed(&layers, session);
    let mut fits = 0;
    for pair in pairs(&opened.open_pairs) {
        let candidate = against_shown(&layers, session, pair, &opened.front_up);
        match layers.preview(session, &candidate, &defaults()) {
            Ok(Previewed::Fits(fit)) => {
                fits += 1;
                assert_turned_over(&fit.stacks.front, &fit.stacks.back, opened.spots);
                // The other order of an open pair changes some spot.
                assert!(!fit.changed.front.is_empty() || !fit.changed.back.is_empty());
                assert!(fit.changed.front.iter().all(|&s| s < opened.spots));
            }
            Ok(Previewed::CantFit(_)) => {}
            other => panic!("{pair:?}: {other:?}"),
        }
        assert_eq!(observed(&layers, session), before, "{pair:?}");
    }
    println!(
        "{} previews of an open pair's other order: {fits} fit, none committed",
        opened.open_pairs.len() / 2
    );
    assert!(fits > 10, "{fits}");

    // Add: the commit lands on exactly the order its preview showed.
    let pair = pairs(&opened.open_pairs)[0];
    let candidate = against_shown(&layers, session, pair, &opened.front_up);
    let Ok(Previewed::Fits(fit)) = layers.preview(session, &candidate, &defaults()) else {
        panic!("the first open pair's other order fits");
    };
    let Ok(Committing::Committed(done)) = layers.commit(session, &candidate, &defaults()) else {
        panic!("the previewed list fits");
    };
    assert_eq!(done.changed, fit.changed);
    assert_eq!(done.stacks.front, fit.stacks.front);
    assert_eq!(done.stacks.back, fit.stacks.back);
    assert_eq!(layers.constraints(session), Ok(candidate.to_vec()));
    assert_eq!(layers.open_pairs(session), Ok(done.open_pairs.clone()));
    assert!(done.open_pairs.len() < opened.open_pairs.len());
    assert_eq!(
        layers.stacks(session, ViewSide::Front),
        Ok(done.stacks.front.clone())
    );
    folds_with(
        &source,
        &layers.oriedita_relations(session).expect("relations"),
    );

    // Remove: the order on screen stays, nothing flashes.
    let shown = layers.stacks(session, ViewSide::Front).expect("front");
    let Ok(Committing::Committed(removed)) = layers.commit(session, &[], &defaults()) else {
        panic!("an empty list fits");
    };
    assert!(removed.changed.front.is_empty() && removed.changed.back.is_empty());
    assert_eq!(removed.stacks.front, shown);
    assert_eq!(removed.open_pairs, opened.open_pairs);
}

#[test]
fn a_constraint_that_cannot_fit_is_a_no_and_changes_nothing() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    let opened = open(&mut layers, &source);
    let session = opened.session;
    let before = observed(&layers, session);

    // Against what the creases force: a pair that overlaps and is not open,
    // asked both ways, fits one way and is a no the other.
    let open = pairs(&opened.open_pairs);
    let layer_source = LayerSource::from_oriedita(&source).expect("source");
    let forced = layer_source
        .problem()
        .variables()
        .iter()
        .map(|p| (p.lo().0, p.hi().0))
        .find(|p| !open.contains(p))
        .expect("kabuto forces pairs");
    let mut proofs = Vec::new();
    for in_front_of in [true, false] {
        let candidate = sentence(forced.0, in_front_of, forced.1, true, &opened.front_up);
        match layers.preview(session, &candidate, &defaults()) {
            Ok(Previewed::Fits(fit)) => assert_eq!(fit.nodes, 0),
            Ok(Previewed::CantFit(cant)) => {
                // The candidate is the last of the list checked.
                assert_eq!(cant.constraints, vec![0]);
                assert!(!cant.faces.is_empty());
                assert!(cant.proof_faces.is_empty());
                proofs.push(cant.proof);
                let committing = layers.commit(session, &candidate, &defaults());
                assert!(
                    matches!(committing, Ok(Committing::CantFit(_))),
                    "{committing:?}"
                );
            }
            other => panic!("{other:?}"),
        }
    }
    assert_eq!(proofs, vec![CantFitKind::Forced]);

    // Two constraints that order one pair both ways.
    let (a, b) = open[0];
    let both: Vec<i32> = [
        sentence(a, true, b, true, &opened.front_up),
        sentence(a, false, b, true, &opened.front_up),
    ]
    .concat();
    match layers.commit(session, &both, &defaults()) {
        Ok(Committing::CantFit(cant)) => {
            assert_eq!(cant.proof, CantFitKind::Opposed);
            assert_eq!(cant.constraints, vec![0, 1]);
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(observed(&layers, session), before);
}

#[test]
fn out_of_nodes_or_time_is_a_timeout_and_keep_trying_is_the_same_call_later() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    let opened = open(&mut layers, &source);
    let session = opened.session;
    let before = observed(&layers, session);
    let mut by_nodes = 0;
    let mut by_deadline = 0;
    for pair in pairs(&opened.open_pairs) {
        let candidate = against_shown(&layers, session, pair, &opened.front_up);
        let answered =
            |previewed: &Previewed| matches!(previewed, Previewed::Fits(_) | Previewed::CantFit(_));
        for (limits, limit, count) in [
            (tiny(), BudgetLimit::Nodes, &mut by_nodes),
            (passed(), BudgetLimit::Deadline, &mut by_deadline),
        ] {
            match layers
                .preview(session, &candidate, &limits)
                .expect("preview")
            {
                Previewed::TimedOut(out) => {
                    assert_eq!(out.limit, limit, "{pair:?}");
                    *count += 1;
                    // Keep trying: the same call, with more.
                    let again = layers
                        .preview(session, &candidate, &later())
                        .expect("preview");
                    assert!(answered(&again), "{pair:?}: {again:?}");
                    // A commit that runs out commits nothing.
                    let committing = layers.commit(session, &candidate, &limits).expect("commit");
                    assert!(matches!(committing, Committing::TimedOut(TimedOut { .. })));
                    assert_eq!(observed(&layers, session), before, "{pair:?}");
                }
                other => assert!(answered(&other), "{pair:?}: {other:?}"),
            }
        }
    }
    println!(
        "{} open pairs' other orders: {by_nodes} ran out of nodes, {by_deadline} out of time, \
         each answered when tried again",
        opened.open_pairs.len() / 2
    );
    assert!(by_nodes > 5, "{by_nodes}");
    assert!(by_deadline > 5, "{by_deadline}");

    // The open itself, out of nodes, then again with them.
    match layers.open(&source, &tiny()) {
        Ok(Opening::Refused(refusal)) => {
            assert_eq!(refusal.code(), "session_timed_out");
            assert_eq!(refusal.to_value()["limit"], "nodes");
        }
        other => panic!("{other:?}"),
    }
    match layers.open(&source, &passed()) {
        Ok(Opening::Refused(refusal)) => {
            assert_eq!(refusal.code(), "session_timed_out");
            assert_eq!(refusal.to_value()["limit"], "deadline");
        }
        other => panic!("{other:?}"),
    }
    assert!(matches!(
        layers.open(&source, &later()),
        Ok(Opening::Opened(_))
    ));
}

#[test]
fn a_refused_open_holds_nothing_and_says_why_by_code() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    // The creases trace other faces than the digest names.
    let drifted = FoldSource {
        digest: "0000000000000000".to_string(),
        ..source.clone()
    };
    match layers.open(&drifted, &defaults()) {
        Ok(Opening::Refused(refusal)) => {
            assert_eq!(refusal.code(), "source_digest_mismatch");
            let body = refusal.to_value();
            assert_eq!(body["expected"], "0000000000000000");
            assert_eq!(body["actual"], source.digest.as_str());
        }
        other => panic!("{other:?}"),
    }
    // A restore of the same is refused alike.
    let json = encode_record(&Default::default()).expect("an empty record");
    match layers.restore(&drifted, &json, &defaults()) {
        Ok(Restoring::Refused(refusal)) => assert_eq!(refusal.code(), "source_digest_mismatch"),
        other => panic!("{other:?}"),
    }
    // Nothing folded.
    let empty = FoldSource {
        segments: Vec::new(),
        aux_segments: Vec::new(),
        ..source
    };
    match layers.open(&empty, &defaults()) {
        Ok(Opening::Refused(refusal)) => {
            assert!(refusal.code().starts_with("source_"), "{refusal:?}");
            assert!(refusal.to_value().get("message").is_none());
        }
        other => panic!("{other:?}"),
    }
    assert!(layers.is_empty());
}

#[test]
fn a_saved_session_restores_to_the_same_constraints_and_order() {
    for relative in [
        "tests/fixtures/flat-folder/kabuto.fold",
        "tests/fixtures/oriedita/solution_sample_1.cp",
    ] {
        let source = source_of(relative);
        let mut layers = LayerSessions::new();
        let opened = open(&mut layers, &source);
        let session = opened.session;
        // Two constraints: an open pair's other order, then another open
        // pair the way it is shown.
        let first = against_shown(
            &layers,
            session,
            pairs(&opened.open_pairs)[0],
            &opened.front_up,
        );
        let Ok(Committing::Committed(done)) = layers.commit(session, &first, &defaults()) else {
            panic!("{relative}: it fits");
        };
        let next = pairs(&done.open_pairs)[0];
        let shown = uppers(&layers.oriedita_relations(session).expect("relations"));
        let upper = shown[&next];
        let lower = if upper == next.0 { next.1 } else { next.0 };
        let list = [first, sentence(upper, true, lower, true, &opened.front_up)].concat();
        let Ok(Committing::Committed(_)) = layers.commit(session, &list, &defaults()) else {
            panic!("{relative}: it fits");
        };
        let json = saved_json(&layers, session);
        let back = restored(&mut layers, &source, &json);
        assert_ne!(back.opened.session, session);
        assert_eq!(back.outcome, RestoredOutcome::Applied, "{relative}");
        assert_eq!(back.constraints, list, "{relative}");
        assert!(back.faces.status.iter().all(|&s| s == FACE_INTACT));
        assert!(back.faces.face.iter().all(|&f| f >= 0));
        assert!(
            back.constraint_status
                .iter()
                .all(|s| *s == ConstraintStatus::Intact)
        );
        assert!(back.order_status.iter().all(|&s| s == PAIR_KEPT));
        let restored_session = back.opened.session;
        assert_eq!(
            back.opened.open_pairs,
            layers.open_pairs(session).expect("open")
        );
        assert_eq!(
            observed(&layers, restored_session),
            observed(&layers, session),
            "{relative}"
        );
        assert_eq!(saved_json(&layers, restored_session), json);
    }
}

/// A saved constraint against a pair the creases force, beside one that
/// fits (as a crease edit that turned a letter would leave it): the rows say
/// which, and none is applied.
#[test]
fn a_restore_whose_constraints_clash_commits_none_and_marks_the_clash() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    let opened = open(&mut layers, &source);
    let session = opened.session;
    let open = pairs(&opened.open_pairs);
    let fine = sentence(open[0].0, false, open[0].1, true, &opened.front_up);
    let Ok(Committing::Committed(_)) = layers.commit(session, &fine, &defaults()) else {
        panic!("an open pair takes either order");
    };
    let RecordRead::Read { mut record, .. } = read_record(&saved_json(&layers, session)) else {
        panic!("the record reads");
    };
    // The forced pair the other way, added by hand: no session commits it.
    let layer_source = LayerSource::from_oriedita(&source).expect("source");
    let shown = uppers(&layers.oriedita_relations(session).expect("relations"));
    let (upper, lower) = layer_source
        .problem()
        .variables()
        .iter()
        .map(|p| (p.lo().0, p.hi().0))
        .find(|p| !open.contains(p) && *p != open[0])
        .map(|p| {
            let upper = shown[&p];
            (upper, if upper == p.0 { p.1 } else { p.0 })
        })
        .expect("kabuto forces pairs");
    let mut listed = |face: u32| -> u32 {
        let at = layer_source.interior_point(FaceId(face)).expect("a point");
        if let Some(i) = record.faces.iter().position(|f| f.at == at) {
            return i as u32;
        }
        record.faces.push(RecordFace {
            at,
            area: layer_source.paper_area(FaceId(face)).expect("an area"),
        });
        (record.faces.len() - 1) as u32
    };
    let (f, g) = (listed(lower), listed(upper));
    let against = constraints_of(&sentence(lower, true, upper, true, &opened.front_up))
        .expect("a constraint")[0];
    record.constraints.push(RecordPair {
        f,
        g,
        sign: against.sign,
    });
    let json = encode_record(&record).expect("encode");

    let back = restored(&mut layers, &source, &json);
    assert_eq!(
        back.outcome,
        RestoredOutcome::Clash {
            constraints: vec![1]
        }
    );
    assert_eq!(
        back.constraint_status,
        vec![ConstraintStatus::Intact, ConstraintStatus::Clashing]
    );
    assert!(back.constraints.is_empty(), "none committed");
    assert_eq!(layers.constraints(back.opened.session), Ok(Vec::new()));
    // The saved order is still the one shown, where the creases allow it.
    assert!(back.order_status.iter().all(|&s| s == PAIR_KEPT));
    assert_eq!(back.opened.opened_on, OpenedOnWire::Held { ignored: 0 });
    // The session is held, for the dialog to open on the rows.
    assert_eq!(layers.len(), 2);

    // Both saved constraints are carried, as saved, each with its status
    // and today's constraint.
    let restored_session = back.opened.session;
    let rows = &back.carried;
    assert_eq!(rows.len(), 2);
    assert_eq!(
        (rows[0].index, rows[0].status, rows[0].constraint),
        (0, ConstraintStatus::Intact, Some(fine))
    );
    let against_triple = sentence(lower, true, upper, true, &opened.front_up);
    assert_eq!(
        (rows[1].index, rows[1].status, rows[1].constraint),
        (1, ConstraintStatus::Clashing, Some(against_triple))
    );
    assert_eq!(rows[1].sign, against_triple[2] as i8);
    assert_eq!(layers.carried(restored_session), Ok(back.carried.clone()));
    let saved_constraints = |layers: &LayerSessions| {
        let RecordRead::Read { record, .. } = read_record(&saved_json(layers, restored_session))
        else {
            panic!("the record reads");
        };
        record.constraints.len()
    };
    // A save writes them back: nothing the user made is dropped.
    assert_eq!(saved_constraints(&layers), 2);
    // A dialog names the carried rows to write back by record index; the
    // session keeps every one.
    let kept = |layers: &LayerSessions, keep: &[usize]| {
        let Ok(Saving::Saved { json }) = layers.save(restored_session, Some(keep)) else {
            panic!("the save");
        };
        let RecordRead::Read { record, .. } = read_record(&json) else {
            panic!("the record reads");
        };
        record.constraints.len()
    };
    assert_eq!(kept(&layers, &[]), 0);
    assert_eq!(kept(&layers, &[1]), 1);
    assert_eq!(kept(&layers, &[0, 1, 9]), 2);
    assert_eq!(layers.carried(restored_session), Ok(back.carried.clone()));
    // A removal from the session, by record index.
    assert_eq!(layers.remove_carried(restored_session, 1), Ok(true));
    assert_eq!(layers.remove_carried(restored_session, 1), Ok(false));
    assert_eq!(layers.remove_carried(restored_session, 7), Ok(false));
    assert_eq!(saved_constraints(&layers), 1);
    // The builder previews the rows it shows, then commits them: the
    // carried row is applied and leaves the carried rows.
    let Ok(Previewed::Fits(fit)) = layers.preview_list(restored_session, &fine, &defaults()) else {
        panic!("the intact row fits alone");
    };
    let Ok(Committing::Committed(done)) =
        layers.commit_preview(restored_session, fit.token, &fine, &defaults())
    else {
        panic!("it fits");
    };
    assert!(done.adopted);
    assert_eq!(layers.carried(restored_session), Ok(Vec::new()));
    assert_eq!(layers.constraints(restored_session), Ok(fine.to_vec()));
    assert_eq!(saved_constraints(&layers), 1);

    // Restored again on the same session: carried again, then Clear all.
    let Ok(Restoring::Restored(again)) =
        layers.restore_record(restored_session, &json, &defaults())
    else {
        panic!("the record restores");
    };
    assert_eq!(again.opened.session, restored_session);
    assert_eq!(again.carried.len(), 2);
    assert_eq!(layers.clear_carried(restored_session), Ok(()));
    assert_eq!(layers.carried(restored_session), Ok(Vec::new()));
    assert_eq!(saved_constraints(&layers), 0);
}

/// The CP kernel's own paper scene of `source` folded with Oriedita's order:
/// what Edit shows.
fn edit_scene(source: &FoldSource) -> oristudio_cp::folding::FoldedPaperScene {
    let mut cp = CpSession::new();
    let FoldWithOrderResult::Folded { handle, .. } = cp
        .folded_figure_fold_with_order(source, &[], FoldedFigureModel::default())
        .expect("a fold")
    else {
        panic!("Oriedita folds it");
    };
    cp.folded_figure_paper_scene(handle, None)
        .expect("a scene")
        .expect("subfaces")
}

fn flat_relations(relations: &[oristudio_cp::folding::HierarchyRelation]) -> Vec<u32> {
    relations
        .iter()
        .flat_map(|r| [r.upper_face as u32, r.lower_face as u32])
        .collect()
}

#[test]
fn a_session_opens_on_the_order_its_host_shows() {
    let source = kabuto();
    let scene = edit_scene(&source);
    let shown = flat_relations(&scene_relations(&scene));
    let mut layers = LayerSessions::new();
    let first = open(&mut layers, &source);
    assert_eq!(first.opened_on, OpenedOnWire::First { timed_out: None });
    let Ok(Opening::Opened(showing)) = layers.open_showing(&source, &shown, &defaults()) else {
        panic!("kabuto opens on Oriedita's order");
    };
    assert_eq!(showing.opened_on, OpenedOnWire::Held { ignored: 0 });
    assert_eq!(
        layers.opened_on(showing.session),
        Ok(OpenedOnWire::Held { ignored: 0 })
    );
    assert_eq!(showing.open_pairs, first.open_pairs, "nothing committed");
    // The dialog shows what Edit shows, spot for spot; the solver's first
    // order differs on some.
    let front = layers
        .stacks(showing.session, ViewSide::Front)
        .expect("front");
    let solver = layers
        .stacks(first.session, ViewSide::Front)
        .expect("front");
    let mut differ = 0;
    for (i, subface) in scene.subfaces.iter().enumerate() {
        let drawn: Vec<u32> = subface
            .faces_top_to_bottom
            .iter()
            .map(|&f| f as u32)
            .collect();
        assert_eq!(spot(&front, i), drawn.as_slice(), "spot {i}");
        differ += usize::from(spot(&solver, i) != drawn.as_slice());
    }
    println!(
        "kabuto: the solver's first order differs from Edit's on {differ} of {} spots",
        scene.subfaces.len()
    );
    assert!(differ > 0);
    // The relations it hands back at Apply are the ones it was given.
    let sorted = |flat: &[u32]| {
        let mut pairs = pairs(flat);
        pairs.sort_unstable();
        pairs
    };
    assert_eq!(
        sorted(
            &layers
                .oriedita_relations(showing.session)
                .expect("relations")
        ),
        sorted(&shown)
    );

    // Relations that do not all fit: one forced pair the other way.
    let open = pairs(&first.open_pairs);
    let forced = pairs(&shown)
        .into_iter()
        .position(|(u, l)| !open.contains(&(u.min(l), u.max(l))))
        .expect("kabuto forces pairs");
    let mut wrong = shown.clone();
    wrong.swap(2 * forced, 2 * forced + 1);
    match layers.open_showing(&source, &wrong, &defaults()) {
        Ok(Opening::Opened(opened)) => match opened.opened_on {
            OpenedOnWire::Closest { moved, ignored, .. } => {
                assert!(moved >= 1, "{moved}");
                assert_eq!(ignored, 0);
            }
            other => panic!("{other:?}"),
        },
        other => panic!("{other:?}"),
    }
    // A pair named both ways, and a face the figure lacks, are ignored and
    // counted.
    let mut odd = shown.clone();
    odd.extend([shown[1], shown[0], 999, 0]);
    match layers.open_showing(&source, &odd, &defaults()) {
        Ok(Opening::Opened(opened)) => {
            assert_eq!(opened.opened_on, OpenedOnWire::Held { ignored: 3 });
        }
        other => panic!("{other:?}"),
    }
    // Not pairs.
    assert_eq!(
        layers
            .open_showing(&source, &shown[..3], &defaults())
            .map(|_| ())
            .map_err(|e| e.code()),
        Err("invalid_input")
    );
    assert_eq!(layers.len(), 4);
}

#[test]
fn add_adopts_its_preview_by_token_and_anything_else_searches() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    let opened = open(&mut layers, &source);
    let session = opened.session;
    let candidate = needs_search(&mut layers, &opened);
    let Ok(Previewed::Fits(fit)) = layers.preview(session, &candidate, &defaults()) else {
        panic!("it fits");
    };
    assert_ne!(fit.token, 0);
    // Adopted with no search, so even no nodes at all cannot stop it.
    let Ok(Committing::Committed(done)) =
        layers.commit_preview(session, fit.token, &candidate, &tiny())
    else {
        panic!("Add adopts the preview");
    };
    assert!(done.adopted);
    assert_eq!(done.changed, fit.changed);
    assert_eq!(done.stacks, fit.stacks);
    assert_eq!(layers.constraints(session), Ok(candidate.to_vec()));
    // The preview it adopted is gone: the same token now searches.
    let Ok(Committing::Committed(again)) =
        layers.commit_preview(session, fit.token, &candidate, &defaults())
    else {
        panic!("the same list fits");
    };
    assert!(!again.adopted);

    // A stale token, an unknown one and another list each commit by a search.
    let fresh = open_pair_candidates(&mut layers, &source);
    let (session, list_a, list_b) = (fresh.0, fresh.1, fresh.2);
    let Ok(Previewed::Fits(a)) = layers.preview(session, &list_a, &defaults()) else {
        panic!("a fits");
    };
    let Ok(Previewed::Fits(b)) = layers.preview(session, &list_b, &defaults()) else {
        panic!("b fits");
    };
    assert_ne!(a.token, b.token);
    // Without a search's nodes, a stale token's commit runs out, and
    // commits nothing.
    assert!(matches!(
        layers.commit_preview(session, a.token, &list_a, &tiny()),
        Ok(Committing::TimedOut(_))
    ));
    assert_eq!(layers.constraints(session), Ok(Vec::new()));
    for (token, list) in [(a.token, &list_a), (12_345, &list_b), (b.token, &list_a)] {
        let Ok(Committing::Committed(done)) =
            layers.commit_preview(session, token, list, &defaults())
        else {
            panic!("{token}: the list fits");
        };
        assert!(!done.adopted, "{token}");
        assert_eq!(layers.constraints(session), Ok(list.to_vec()));
        // Back to nothing committed for the next.
        let Ok(Committing::Committed(_)) = layers.commit(session, &[], &defaults()) else {
            panic!("an empty list fits");
        };
    }
    // A preview that cannot fit drops the one kept.
    let Ok(Previewed::Fits(kept)) = layers.preview(session, &list_a, &defaults()) else {
        panic!("a fits");
    };
    let (x, y) = pairs(&opened.open_pairs)[0];
    let both = [
        sentence(x, true, y, true, &opened.front_up),
        sentence(x, false, y, true, &opened.front_up),
    ]
    .concat();
    assert!(matches!(
        layers.preview_list(session, &both, &defaults()),
        Ok(Previewed::CantFit(_))
    ));
    let Ok(Committing::Committed(done)) =
        layers.commit_preview(session, kept.token, &list_a, &defaults())
    else {
        panic!("the list fits");
    };
    assert!(!done.adopted);
}

/// A constraint the session's order on screen breaks, on an open pair, whose
/// preview needs a search: out of nodes, it times out.
fn needs_search(layers: &mut LayerSessions, opened: &LayerOpened) -> [i32; 3] {
    let candidates: Vec<[i32; 3]> = pairs(&opened.open_pairs)
        .into_iter()
        .map(|pair| against_shown(layers, opened.session, pair, &opened.front_up))
        .collect();
    candidates
        .into_iter()
        .find(|c| {
            matches!(
                layers.preview(opened.session, c, &tiny()),
                Ok(Previewed::TimedOut(_))
            )
        })
        .expect("a preview that needs a search")
}

/// A new session on `source`, and two lists of one constraint each on
/// different open pairs, each the other order of the pair from the one
/// shown, the first one that needs a search.
fn open_pair_candidates(
    layers: &mut LayerSessions,
    source: &FoldSource,
) -> (u32, Vec<i32>, Vec<i32>) {
    let opened = open(layers, source);
    let a = needs_search(layers, &opened);
    let b = pairs(&opened.open_pairs)
        .into_iter()
        .map(|pair| against_shown(layers, opened.session, pair, &opened.front_up))
        .find(|b| b[..2] != a[..2] && b[..2] != [a[1], a[0]])
        .expect("another open pair");
    (opened.session, a.to_vec(), b.to_vec())
}

#[test]
fn a_whole_list_previews_without_committing() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    let opened = open(&mut layers, &source);
    let session = opened.session;
    let before = observed(&layers, session);
    let open = pairs(&opened.open_pairs);
    let list = [
        against_shown(&layers, session, open[0], &opened.front_up),
        against_shown(&layers, session, open[open.len() - 1], &opened.front_up),
    ]
    .concat();
    let Ok(Previewed::Fits(fit)) = layers.preview_list(session, &list, &defaults()) else {
        panic!("two open pairs' other orders fit");
    };
    assert_eq!(observed(&layers, session), before);
    let Ok(Committing::Committed(done)) =
        layers.commit_preview(session, fit.token, &list, &defaults())
    else {
        panic!("it fits");
    };
    assert!(done.adopted);
    assert_eq!(layers.constraints(session), Ok(list.clone()));
    // A no indexes the list given.
    let (a, b) = open[1];
    let both = [
        sentence(a, true, b, true, &opened.front_up),
        sentence(a, false, b, true, &opened.front_up),
    ]
    .concat();
    match layers.preview_list(session, &both, &defaults()) {
        Ok(Previewed::CantFit(cant)) => {
            assert_eq!(cant.proof, CantFitKind::Opposed);
            assert_eq!(cant.constraints, vec![0, 1]);
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(layers.constraints(session), Ok(list));
}

#[test]
fn a_restore_is_retried_on_the_open_session() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    let saving = open(&mut layers, &source);
    let candidate = needs_search(&mut layers, &saving);
    let Ok(Committing::Committed(_)) = layers.commit(saving.session, &candidate, &defaults())
    else {
        panic!("it fits");
    };
    let json = saved_json(&layers, saving.session);
    let session = open(&mut layers, &source).session;

    // On a session already open, the record restores as on a fresh one.
    let Ok(Restoring::Restored(back)) = layers.restore_record(session, &json, &defaults()) else {
        panic!("it restores");
    };
    assert_eq!(back.opened.session, session);
    assert_eq!(back.outcome, RestoredOutcome::Applied);
    assert_eq!(back.constraints, candidate.to_vec());
    assert!(back.carried.is_empty());
    assert_eq!(back.opened.opened_on, OpenedOnWire::Held { ignored: 0 });
    assert_eq!(
        observed(&layers, session),
        observed(&layers, saving.session)
    );

    // Saved with no order pairs, its constraint needs a search. Out of
    // nodes: none is applied, and the row is carried.
    let RecordRead::Read { mut record, .. } = read_record(&json) else {
        panic!("the record reads");
    };
    record.order.clear();
    let bare = encode_record(&record).expect("encode");
    let Ok(Restoring::Restored(short)) = layers.restore_record(session, &bare, &tiny()) else {
        panic!("a restore that runs out still answers");
    };
    assert!(matches!(short.outcome, RestoredOutcome::TimedOut { .. }));
    assert!(matches!(
        short.opened.opened_on,
        OpenedOnWire::First { timed_out: Some(_) }
    ));
    assert!(short.constraints.is_empty());
    assert_eq!(short.carried.len(), 1);
    assert_eq!(short.carried[0].status, ConstraintStatus::Intact);
    assert_eq!(short.carried[0].constraint, Some(candidate));
    // Keep trying: the same call with time.
    let Ok(Restoring::Restored(applied)) = layers.restore_record(session, &bare, &later()) else {
        panic!("it restores");
    };
    assert_eq!(applied.outcome, RestoredOutcome::Applied);
    assert_eq!(applied.constraints, candidate.to_vec());
    assert!(applied.carried.is_empty());
    // A timed-out restore of the full record resolves none of its pairs.
    let Ok(Restoring::Restored(unresolved)) = layers.restore_record(session, &json, &passed())
    else {
        panic!("a restore that runs out still answers");
    };
    assert!(matches!(
        unresolved.outcome,
        RestoredOutcome::TimedOut {
            limit: BudgetLimit::Deadline,
            ..
        }
    ));
    assert!(!unresolved.order_status.is_empty());
    assert!(
        unresolved
            .order_status
            .iter()
            .all(|&s| s == PAIR_UNRESOLVED)
    );

    // A record that does not read leaves the session as it was.
    let before = observed(&layers, session);
    match layers.restore_record(session, "not json", &defaults()) {
        Ok(Restoring::Refused(refusal)) => assert_eq!(refusal.code(), "record_damaged"),
        other => panic!("{other:?}"),
    }
    assert_eq!(observed(&layers, session), before);
    assert_eq!(
        layers
            .restore_record(99, &json, &defaults())
            .map(|_| ())
            .map_err(|e| e.code()),
        Err("unknown_layer_session")
    );
}

#[test]
fn a_record_that_does_not_read_is_refused_by_code() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    for (json, code) in [
        ("not json", "record_damaged"),
        (
            r#"{"v":1,"faces":"x","constraints":[],"order":[]}"#,
            "record_damaged",
        ),
        (r#"{"v":2}"#, "record_newer"),
    ] {
        match layers.restore(&source, json, &defaults()) {
            Ok(Restoring::Refused(refusal)) => assert_eq!(refusal.code(), code, "{json}"),
            other => panic!("{json}: {other:?}"),
        }
    }
    match layers.restore(&source, "not json", &defaults()) {
        Ok(Restoring::Refused(LayerRefusal::RecordDamaged { damage })) => {
            assert_eq!(damage.word(), "not-json");
        }
        other => panic!("{other:?}"),
    }
    // A record whose restore runs out of nodes: its open does.
    let json = encode_record(&Default::default()).expect("an empty record");
    match layers.restore(&source, &json, &tiny()) {
        Ok(Restoring::Refused(refusal)) => assert_eq!(refusal.code(), "session_timed_out"),
        other => panic!("{other:?}"),
    }
    assert!(layers.is_empty());
}

#[test]
fn a_closed_session_is_gone_and_its_handle_is_never_reused() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    let first = open(&mut layers, &source).session;
    let second = open(&mut layers, &source).session;
    assert_eq!((first, second), (1, 2));
    assert!(layers.close(first));
    assert!(!layers.close(first));
    assert_eq!(layers.len(), 1);
    let gone = |error: LayerCallError| assert_eq!(error.code(), "unknown_layer_session");
    gone(layers.open_pairs(first).expect_err("closed"));
    gone(layers.constraints(first).expect_err("closed"));
    gone(
        layers
            .preview(first, &[0, 1, 1], &defaults())
            .expect_err("closed"),
    );
    gone(layers.commit(first, &[], &defaults()).expect_err("closed"));
    gone(layers.stacks(first, ViewSide::Front).expect_err("closed"));
    gone(
        layers
            .scene(first, ViewSide::Back, &FoldedFigureModel::default())
            .expect_err("closed"),
    );
    gone(layers.oriedita_relations(first).expect_err("closed"));
    gone(layers.save(first, None).expect_err("closed"));
    // The other session is untouched, and a new one takes a new handle.
    assert!(layers.open_pairs(second).is_ok());
    assert_eq!(open(&mut layers, &source).session, 3);
    layers.clear();
    assert!(layers.is_empty());
}

#[test]
fn a_caller_s_mistakes_are_thrown_by_code() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    let opened = open(&mut layers, &source);
    let session = opened.session;
    let (a, b) = pairs(&opened.open_pairs)[0];
    let code = |result: Result<Previewed, LayerCallError>| result.map(|_| ()).map_err(|e| e.code());
    // Not one triple, a sign that is not ±1, a negative face.
    assert_eq!(
        code(layers.preview(session, &[a as i32, b as i32], &defaults())),
        Err("invalid_input")
    );
    assert_eq!(
        code(layers.preview(session, &[a as i32, b as i32, 0], &defaults())),
        Err("invalid_input")
    );
    assert_eq!(
        code(layers.preview(session, &[-1, b as i32, 1], &defaults())),
        Err("invalid_input")
    );
    // A constraint that is no question: the dialog offers only open pairs.
    assert_eq!(
        code(layers.preview(session, &[a as i32, a as i32, 1], &defaults())),
        Err("session_bad_constraint")
    );
    assert_eq!(
        code(layers.preview(session, &[a as i32, 99, 1], &defaults())),
        Err("session_bad_constraint")
    );
    assert_eq!(
        layers
            .commit(session, &[a as i32, a as i32, 1], &defaults())
            .map(|_| ())
            .map_err(|e| e.code()),
        Err("session_bad_constraint")
    );
    // A deadline that is no duration.
    let negative = LayerLimits {
        deadline_ms: Some(-1.0),
        ..LayerLimits::default()
    };
    assert_eq!(
        code(layers.preview(session, &[a as i32, b as i32, 1], &negative)),
        Err("invalid_input")
    );
    assert_eq!(
        layers
            .open(&source, &negative)
            .map(|_| ())
            .map_err(|e| e.code()),
        Err("invalid_input")
    );
    // Nothing changed.
    assert_eq!(layers.constraints(session), Ok(Vec::new()));
    assert_eq!(
        oristudio_fold_wasm::steer::side_of("up").map_err(|e| e.code()),
        Err("invalid_input")
    );
}

// ---------------------------------------------------------------------------
// E6: explain, the count and the stepper.

const SOLUTION_SAMPLE: &str = "tests/fixtures/oriedita/solution_sample_1.cp";

fn exact(n: u64) -> Tally {
    Tally { n, exact: true }
}

/// A slice of the count: the dialog's worker between its other calls.
fn slice() -> LayerLimits {
    LayerLimits {
        max_nodes: Some(1),
        fast_nodes: None,
        deadline_ms: Some(50.0),
    }
}

/// The count advanced in one-node slices to its end, and how many slices.
fn count_in_slices(
    layers: &mut LayerSessions,
    session: u32,
    cursor: u32,
) -> (SolutionCount, usize) {
    let mut slices = 0;
    loop {
        let count = layers
            .solutions_advance(session, cursor, &slice())
            .expect("a slice");
        slices += 1;
        if count.done {
            return (count, slices);
        }
        assert!(slices < 100_000, "the count never ends");
    }
}

#[test]
fn the_count_in_slices_is_kabuto_s_9_and_1_and_solution_sample_1_s_1_and_16() {
    for (relative, front, back, orders) in [
        ("tests/fixtures/flat-folder/kabuto.fold", 9, 1, 9),
        (SOLUTION_SAMPLE, 1, 16, 16),
    ] {
        let source = source_of(relative);
        let mut layers = LayerSessions::new();
        let session = open(&mut layers, &source).session;
        let sliced = layers
            .solutions_start(session, &LayerSolutionCaps::default())
            .expect("a cursor");
        let (count, slices) = count_in_slices(&mut layers, session, sliced);
        assert_eq!(
            count,
            SolutionCount {
                front: exact(front),
                back: exact(back),
                orders: exact(orders),
                done: true,
            },
            "{relative}"
        );
        // A one-shot count on another cursor ends the same.
        let whole = layers
            .solutions_start(session, &LayerSolutionCaps::default())
            .expect("a cursor");
        assert_ne!(whole, sliced);
        assert_eq!(
            layers.solutions_advance(session, whole, &defaults()),
            Ok(count)
        );
        // Done, it only reads.
        assert_eq!(
            layers.solutions_advance(session, sliced, &slice()),
            Ok(count)
        );
        println!("{relative}: {front} / {back} pictures, {orders} orders, in {slices} slices");
    }
}

/// The top face of every spot.
fn tops(stacks: &PackedStacks) -> Vec<Option<u32>> {
    (0..stacks.offsets.len() - 1)
        .map(|i| spot(stacks, i).first().copied())
        .collect()
}

/// Walk the stepper from its first solution to its last: what each shows
/// (the tops from `side`, or with X-ray the whole order) and its index.
fn walk(
    layers: &mut LayerSessions,
    session: u32,
    cursor: u32,
    by: StepBy,
    side: ViewSide,
) -> Vec<(u64, Vec<u32>)> {
    let shows = |layers: &LayerSessions| -> Vec<u32> {
        match by {
            StepBy::LayerOrder => layers.oriedita_relations(session).expect("relations"),
            StepBy::Picture(_) => tops(&layers.stacks(session, side).expect("stacks"))
                .into_iter()
                .map(|top| top.unwrap_or(u32::MAX))
                .collect(),
        }
    };
    // Back to the first.
    loop {
        match layers.step(session, cursor, by, StepDirection::Previous, &defaults()) {
            Ok(Stepping::Moved(_)) => {}
            Ok(Stepping::End) => break,
            other => panic!("{other:?}"),
        }
    }
    let position = layers
        .solutions_position(session, cursor, by)
        .expect("a position");
    let mut seen = vec![(position.index, shows(layers))];
    loop {
        match layers.step(session, cursor, by, StepDirection::Next, &defaults()) {
            Ok(Stepping::Moved(moved)) => {
                assert_eq!(
                    moved.stacks.front,
                    layers.stacks(session, ViewSide::Front).expect("front")
                );
                assert_eq!(
                    Ok(moved.position),
                    layers.solutions_position(session, cursor, by)
                );
                seen.push((moved.position.index, shows(layers)));
            }
            Ok(Stepping::End) => return seen,
            other => panic!("{other:?}"),
        }
    }
}

#[test]
fn walking_the_stepper_visits_every_solution_once_in_order() {
    for (relative, by, side, total) in [
        (
            "tests/fixtures/flat-folder/kabuto.fold",
            StepBy::Picture(ViewSide::Front),
            ViewSide::Front,
            9,
        ),
        (
            "tests/fixtures/flat-folder/kabuto.fold",
            StepBy::LayerOrder,
            ViewSide::Front,
            9,
        ),
        (
            SOLUTION_SAMPLE,
            StepBy::Picture(ViewSide::Back),
            ViewSide::Back,
            16,
        ),
        (
            SOLUTION_SAMPLE,
            StepBy::Picture(ViewSide::Front),
            ViewSide::Front,
            1,
        ),
    ] {
        let source = source_of(relative);
        let mut layers = LayerSessions::new();
        let session = open(&mut layers, &source).session;
        let cursor = layers
            .solutions_start(session, &LayerSolutionCaps::default())
            .expect("a cursor");
        let (count, _) = count_in_slices(&mut layers, session, cursor);
        assert!(count.done);
        let seen = walk(&mut layers, session, cursor, by, side);
        let indices: Vec<u64> = seen.iter().map(|(index, _)| *index).collect();
        assert_eq!(
            indices,
            (1..=total).collect::<Vec<u64>>(),
            "{relative} {by:?}"
        );
        let mut shown: Vec<&Vec<u32>> = seen.iter().map(|(_, shows)| shows).collect();
        shown.sort_unstable();
        shown.dedup();
        assert_eq!(shown.len() as u64, total, "{relative} {by:?}: each once");
        // Every solution walked fits: the kernel folds it.
        folds_with(
            &source,
            &layers.oriedita_relations(session).expect("relations"),
        );
        // The last is the last: next ends, the position says so.
        assert_eq!(
            layers
                .solutions_position(session, cursor, by)
                .map(|p| p.index),
            Ok(total)
        );
    }
}

/// Undo and redo (#539's review): `order` reads the order on screen, and
/// `show` puts an earlier one back exactly with the list it had, keeping a
/// cursor counting the same list; an order that does not fit is refused and
/// changes nothing.
#[test]
fn show_puts_an_earlier_order_back_exactly_and_keeps_the_cursor() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    let opened = open(&mut layers, &source);
    let session = opened.session;
    let cursor = layers
        .solutions_start(session, &LayerSolutionCaps::default())
        .expect("a cursor");
    let by = StepBy::Picture(ViewSide::Front);
    let opening = layers.order(session).expect("the order");
    let front = layers.stacks(session, ViewSide::Front).expect("stacks");
    let direction = match layers.step(session, cursor, by, StepDirection::Next, &defaults()) {
        Ok(Stepping::Moved(_)) => StepDirection::Next,
        Ok(Stepping::End) => StepDirection::Previous,
        other => panic!("{other:?}"),
    };
    if direction == StepDirection::Previous {
        assert!(matches!(
            layers.step(session, cursor, by, direction, &defaults()),
            Ok(Stepping::Moved(_))
        ));
    }
    let stepped = layers.order(session).expect("the order");
    assert_ne!(stepped, opening);
    // A constraint the stepped order breaks, committed: the order moves.
    let pair = pairs(&opened.open_pairs)
        .into_iter()
        .find(|&pair| {
            let candidate = against_shown(&layers, session, pair, &opened.front_up);
            matches!(
                layers.preview(session, &candidate, &defaults()),
                Ok(Previewed::Fits(_))
            )
        })
        .expect("a constraint that fits against the stepped order");
    let candidate = against_shown(&layers, session, pair, &opened.front_up);
    let Ok(Committing::Committed(_)) = layers.commit(session, &candidate, &defaults()) else {
        panic!("it fits");
    };
    // Undo the Add, then the step: each order exactly, the cursor good again on no constraints.
    let Ok(Showing::Shown(_)) = layers.show(session, &[], &stepped, &defaults()) else {
        panic!("the stepped order fits no constraints");
    };
    assert_eq!(layers.order(session), Ok(stepped.clone()));
    assert!(layers.solutions_position(session, cursor, by).is_ok());
    let Ok(Showing::Shown(done)) = layers.show(session, &[], &opening, &defaults()) else {
        panic!("the opening order fits no constraints");
    };
    assert_eq!(layers.order(session), Ok(opening.clone()));
    assert_eq!(layers.stacks(session, ViewSide::Front), Ok(front));
    assert!(!done.adopted);
    assert!(layers.solutions_position(session, cursor, by).is_ok());
    // The opening order breaks the constraint: refused, and nothing changes.
    assert_eq!(
        layers.show(session, &candidate, &opening, &defaults()),
        Ok(Showing::Refused)
    );
    assert_eq!(layers.order(session), Ok(opening));
    assert_eq!(layers.constraints(session), Ok(Vec::new()));
}

#[test]
fn a_commit_makes_a_cursor_stale_and_a_step_keeps_it_good() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    let opened = open(&mut layers, &source);
    let session = opened.session;
    let cursor = layers
        .solutions_start(session, &LayerSolutionCaps::default())
        .expect("a cursor");
    let (count, _) = count_in_slices(&mut layers, session, cursor);
    let by = StepBy::Picture(ViewSide::Front);
    // A step moves the order on screen and keeps the cursor good, and drops
    // a preview kept from before it: Add then commits from the stepped
    // order.
    let pair = pairs(&opened.open_pairs)[0];
    let candidate = against_shown(&layers, session, pair, &opened.front_up);
    let Ok(Previewed::Fits(kept)) = layers.preview(session, &candidate, &defaults()) else {
        panic!("it fits");
    };
    let direction = match layers.step(session, cursor, by, StepDirection::Next, &defaults()) {
        Ok(Stepping::Moved(_)) => StepDirection::Next,
        Ok(Stepping::End) => StepDirection::Previous,
        other => panic!("{other:?}"),
    };
    if direction == StepDirection::Previous {
        assert!(matches!(
            layers.step(session, cursor, by, direction, &defaults()),
            Ok(Stepping::Moved(_))
        ));
    }
    assert_eq!(
        layers.solutions_advance(session, cursor, &slice()),
        Ok(count)
    );
    assert!(layers.solutions_position(session, cursor, by).is_ok());
    let stale = |e: LayerCallError| assert_eq!(e.code(), "session_stale_solutions");
    let Ok(Committing::Committed(done)) =
        layers.commit_preview(session, kept.token, &candidate, &defaults())
    else {
        panic!("it fits from the stepped order too");
    };
    assert!(!done.adopted, "the step put the preview out of date");
    // The commit makes the cursor stale: every call on it is refused.
    stale(
        layers
            .solutions_advance(session, cursor, &slice())
            .expect_err("stale"),
    );
    stale(
        layers
            .solutions_position(session, cursor, by)
            .expect_err("stale"),
    );
    stale(
        layers
            .step(session, cursor, by, StepDirection::Next, &defaults())
            .expect_err("stale"),
    );
    // A new cursor counts what the constraint leaves.
    let fresh = layers
        .solutions_start(session, &LayerSolutionCaps::default())
        .expect("a cursor");
    let (fewer, _) = count_in_slices(&mut layers, session, fresh);
    assert!(fewer.front.n < count.front.n, "{fewer:?} against {count:?}");
    // Back to the constraints the old one counted: it is good again (E6's
    // own test of a cursor).
    let Ok(Committing::Committed(_)) = layers.commit(session, &[], &defaults()) else {
        panic!("an empty list fits");
    };
    assert_eq!(
        layers.solutions_advance(session, cursor, &slice()),
        Ok(count)
    );
    stale(
        layers
            .solutions_advance(session, fresh, &slice())
            .expect_err("stale"),
    );
    // Closed cursors, and cursors of a closed session, are gone.
    assert_eq!(layers.solutions_close(session, fresh), Ok(true));
    assert_eq!(layers.solutions_close(session, fresh), Ok(false));
    assert_eq!(
        layers
            .solutions_advance(session, fresh, &slice())
            .map(|_| ())
            .map_err(|e| e.code()),
        Err("unknown_layer_cursor")
    );
    assert!(layers.close(session));
    assert_eq!(
        layers
            .solutions_position(session, cursor, by)
            .map(|_| ())
            .map_err(|e| e.code()),
        Err("unknown_layer_session")
    );
}

#[test]
fn explain_names_a_smallest_clashing_set() {
    let source = kabuto();
    let mut layers = LayerSessions::new();
    let opened = open(&mut layers, &source);
    let session = opened.session;
    let open = pairs(&opened.open_pairs);
    let (a, b) = open[0];
    let first = sentence(a, true, b, true, &opened.front_up);
    let Ok(Committing::Committed(_)) = layers.commit(session, &first, &defaults()) else {
        panic!("an open pair takes either order");
    };
    // A candidate that fits has nothing to explain.
    let other = against_shown(&layers, session, open[open.len() - 1], &opened.front_up);
    assert_eq!(
        layers.explain(session, &other, &defaults()),
        Ok(Explained::Fits)
    );
    // The committed constraint's pair the other way: both clash, and each is
    // needed.
    let reversed = sentence(a, false, b, true, &opened.front_up);
    match layers.explain(session, &reversed, &defaults()) {
        Ok(Explained::Clash(clash)) => {
            assert_eq!(clash.constraints, vec![0, 1]);
            assert!(clash.minimal);
            assert_eq!(clash.faces, vec![a.min(b), a.max(b)]);
            assert_eq!(clash.proof, CantFitKind::Opposed);
        }
        other => panic!("{other:?}"),
    }
    // Against a pair the creases force: the candidate alone.
    let layer_source = LayerSource::from_oriedita(&source).expect("source");
    let forced = layer_source
        .problem()
        .variables()
        .iter()
        .map(|p| (p.lo().0, p.hi().0))
        .find(|p| !open.contains(p))
        .expect("kabuto forces pairs");
    let against = against_shown(&layers, session, forced, &opened.front_up);
    match layers.explain(session, &against, &defaults()) {
        Ok(Explained::Clash(clash)) => {
            assert_eq!(clash.constraints, vec![1]);
            assert!(clash.minimal);
            assert_eq!(clash.proof, CantFitKind::Forced);
            assert!(!clash.traced.is_empty());
        }
        other => panic!("{other:?}"),
    }
    // Any list, uncommitted: the third clashes with the first, the second is
    // spared, and dropping either of the two leaves an order.
    let list = [first, other, reversed].concat();
    match layers.explain_list(session, &list, &defaults()) {
        Ok(Explained::Clash(clash)) => {
            assert_eq!(clash.constraints, vec![0, 2]);
            assert!(clash.minimal);
            for kept in [[first, other], [other, reversed]] {
                assert!(matches!(
                    layers.preview_list(session, &kept.concat(), &defaults()),
                    Ok(Previewed::Fits(_))
                ));
            }
        }
        other => panic!("{other:?}"),
    }
    // Out of time it still answers, and never a set that fits.
    match layers.explain_list(session, &list, &passed()) {
        Ok(Explained::Clash(clash)) => {
            assert!(!clash.minimal || clash.constraints == vec![0, 2]);
        }
        Ok(Explained::TimedOut(_)) => {}
        other => panic!("{other:?}"),
    }
    assert_eq!(layers.constraints(session), Ok(first.to_vec()));
    assert_eq!(
        layers
            .explain(session, &[a as i32, a as i32, 1], &defaults())
            .map(|_| ())
            .map_err(|e| e.code()),
        Err("session_bad_constraint")
    );
}
