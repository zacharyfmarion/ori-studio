//! What a host and the dialog's rows need of the constraint session
//! (`implementation-plans/layer-order-dialog.md` row E5, after its review):
//! opening on the order the host shows, Add adopting its preview, previewing
//! a list nothing has committed, restoring again on an open session, faces
//! found again by their own point, thin faces saved by a point they are found
//! at, and the saved constraints a restore carries rather than drops.

#![cfg(feature = "kernel")]

use oristudio_cp::folding::{
    EstimationOrder, FoldOutcome, FoldedFigureModel, FoldedFigureState, HierarchyRelation,
    folded_paper_scene_with_order,
};
use oristudio_cp::session::{CpSession, FoldSource};
use oristudio_fold::FaceId;
use oristudio_fold::complete::Deadline;
use oristudio_fold::steer::{
    CantFitProof, Commit, Constraint, ConstraintSession, ConstraintStatus, FaceStatus, FoldSign,
    GoneCause, LayerOrderRecord, LayerSource, Limits, OpenedOn, Preview, RecordFace, RecordPair,
    RestoreOutcome, SavedPairStatus, Verb, ViewSide, scene_relations,
};
use oristudio_layer_order::FacePair;

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

fn load(cp: &mut CpSession, text: &str, fold: bool) -> u32 {
    if fold {
        cp.load_fold(text, "").expect("load")
    } else {
        cp.load_cp(text, "").expect("load")
    }
}

/// A host's figure: Edit's whole-sheet fold, its source, and its paper
/// scene's relations (what it shows).
struct Figure {
    fold: FoldSource,
    shown: Vec<HierarchyRelation>,
    /// Edit's front stacks, subface by subface.
    front: Vec<Vec<u32>>,
}

fn figure_of_text(text: &str, fold: bool) -> Figure {
    let mut cp = CpSession::new();
    let document = load(&mut cp, text, fold);
    let lines: Vec<usize> = (1..=cp
        .document_summary(document)
        .expect("summary")
        .line_segments)
        .collect();
    let folded = cp
        .folded_figure_fold_selected(
            document,
            &lines,
            1,
            EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
        .expect("Edit's fold");
    assert_eq!(folded.snapshot.outcome, FoldOutcome::Solved);
    let fold = cp
        .folded_figure_source(folded.handle, Some(document))
        .expect("source");
    let scene = cp
        .folded_figure_paper_scene(folded.handle, None)
        .expect("a scene")
        .expect("subfaces");
    Figure {
        fold,
        shown: scene_relations(&scene),
        front: scene
            .subfaces
            .iter()
            .map(|s| s.faces_top_to_bottom.iter().map(|&f| f as u32).collect())
            .collect(),
    }
}

fn figure(relative: &str) -> Figure {
    let text = std::fs::read_to_string(repo_path(relative)).expect("fixture");
    figure_of_text(&text, relative.ends_with(".fold"))
}

fn source(fold: &FoldSource) -> LayerSource {
    LayerSource::from_oriedita(fold).unwrap_or_else(|e| panic!("{e}"))
}

/// How many spots show another top face than Edit's, from the front.
fn tops_differing(session: &ConstraintSession, edit: &[Vec<u32>]) -> usize {
    let stacks = session.stacks(ViewSide::Front);
    edit.iter()
        .enumerate()
        .filter(|(i, stack)| stacks.spot(*i).first() != stack.first())
        .count()
}

/// A pair's other order than the one on screen, as a constraint.
fn against_shown(session: &ConstraintSession, pair: FacePair) -> Constraint {
    let lo_above = session
        .shown_order()
        .above(pair.lo(), pair.hi())
        .expect("ordered");
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
    .expect("faces")
}

/// A pair's order on screen, as a constraint.
fn with_shown(session: &ConstraintSession, pair: FacePair) -> Constraint {
    let c = against_shown(session, pair);
    // The other face in front: the order on screen.
    Constraint::seen(
        c.object,
        Verb::InFrontOf,
        c.subject,
        ViewSide::Front,
        session.source().view(),
    )
    .expect("faces")
}

fn passed() -> Limits {
    fn epoch() -> f64 {
        1.0
    }
    Limits {
        deadline: Some(Deadline {
            now_ms: epoch,
            at_ms: 0.0,
        }),
        ..Limits::default()
    }
}

// 1. The order the host shows.

/// Opened on the host's relations, the dialog shows exactly Edit's picture,
/// spot for spot and both sides; the solver's first order does not.
#[test]
fn the_dialog_opens_on_the_order_edit_shows() {
    let mut before = 0;
    for (name, relative) in FIXTURES {
        let figure = figure(relative);
        let first = ConstraintSession::open(source(&figure.fold), &Limits::default())
            .unwrap_or_else(|e| panic!("{e}"));
        before += tops_differing(&first, &figure.front);
        let session = ConstraintSession::open_showing(
            source(&figure.fold),
            &figure.shown,
            &Limits::default(),
        )
        .unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(
            session.opened_on(),
            &OpenedOn::Held { ignored: 0 },
            "{name}"
        );
        let stacks = session.stacks(ViewSide::Front);
        assert_eq!(stacks.len(), figure.front.len(), "{name}");
        for (i, edit) in figure.front.iter().enumerate() {
            assert_eq!(stacks.spot(i), edit.as_slice(), "{name} spot {i}");
        }
        // The back is Edit's rear pass too.
        let back = folded_paper_scene_with_order(
            session.source().render_inputs(),
            &figure.shown,
            &[],
            &FoldedFigureModel {
                state: FoldedFigureState::Back1,
                ..FoldedFigureModel::default()
            },
        )
        .expect("a scene")
        .expect("subfaces");
        let stacks = session.stacks(ViewSide::Back);
        for (i, subface) in back.subfaces.iter().enumerate() {
            let theirs: Vec<u32> = subface
                .faces_top_to_bottom
                .iter()
                .map(|&f| f as u32)
                .collect();
            assert_eq!(stacks.spot(i), theirs.as_slice(), "{name} back {i}");
        }
        // The rear scene reads back as the same relations.
        assert_eq!(scene_relations(&back), figure.shown, "{name}");
        // Nothing is committed, and every pair the creases leave is open.
        assert!(session.constraints().is_empty());
        assert_eq!(session.open_pairs(), first.open_pairs(), "{name}");
    }
    // kabuto alone differs on 14 spots when opened on the first order.
    assert!(before >= 14, "{before}");
}

/// Relations that no longer fit the creases fall back to the closest order
/// the search finds; ones that name no pair are ignored and counted.
#[test]
fn an_order_that_no_longer_fits_opens_on_the_closest() {
    let figure = figure(FIXTURES[0].1);
    let plain = ConstraintSession::open(source(&figure.fold), &Limits::default()).expect("open");
    // Reverse one relation the creases force.
    let forced = plain
        .source()
        .problem()
        .variables()
        .iter()
        .copied()
        .find(|p| plain.forced(p.lo(), p.hi()).is_some())
        .expect("a forced pair");
    let mut shown: Vec<HierarchyRelation> = figure
        .shown
        .iter()
        .map(|r| {
            let pair = FacePair::new(FaceId(r.upper_face as u32), FaceId(r.lower_face as u32));
            if pair == Some(forced) {
                HierarchyRelation {
                    upper_face: r.lower_face,
                    lower_face: r.upper_face,
                }
            } else {
                *r
            }
        })
        .collect();
    // And two that name no pair the solver orders.
    let n = plain.source().view().faces().len();
    shown.push(HierarchyRelation {
        upper_face: n + 3,
        lower_face: 0,
    });
    let apart = (0..n)
        .flat_map(|a| (a + 1..n).map(move |b| (a, b)))
        .find(|&(a, b)| {
            !plain
                .source()
                .problem()
                .is_variable(FaceId(a as u32), FaceId(b as u32))
        })
        .expect("faces apart");
    shown.push(HierarchyRelation {
        upper_face: apart.0,
        lower_face: apart.1,
    });
    let session = ConstraintSession::open_showing(source(&figure.fold), &shown, &Limits::default())
        .expect("open");
    let OpenedOn::Closest { moved, ignored, .. } = session.opened_on() else {
        panic!("{:?}", session.opened_on());
    };
    assert!(*moved >= 1, "{moved}");
    assert_eq!(*ignored, 2);
    // Every spot but the ones the forced pair changes is still Edit's.
    assert!(tops_differing(&session, &figure.front) < figure.front.len());
    // Out of time before anything is held: the solver's first order, said so.
    let late = ConstraintSession::open_showing(source(&figure.fold), &figure.shown, &passed());
    assert!(late.is_err(), "the open itself is out of time");
}

/// An order that puts a face between the two faces of a folded crease that
/// runs through it (the three-face condition Edit can miss, plan D19) opens
/// on the closest order, and says which face sat inside which fold.
#[test]
fn an_order_with_a_face_inside_a_fold_names_the_face() {
    let figure = figure(FIXTURES[0].1);
    let plain = ConstraintSession::open(source(&figure.fold), &Limits::default()).expect("open");
    let shown: std::collections::BTreeSet<(usize, usize)> = figure
        .shown
        .iter()
        .map(|r| (r.upper_face, r.lower_face))
        .collect();
    let has = |a: FaceId, b: FaceId| {
        let (a, b) = (a.0 as usize, b.0 as usize);
        shown.contains(&(a, b)) || shown.contains(&(b, a))
    };
    // A condition of kabuto's creases whose two pairs Edit's order states.
    let (a, b, face) = plain
        .source()
        .problem()
        .constraints()
        .iter()
        .find_map(|condition| match *condition {
            oristudio_layer_order::Constraint::TacoTortilla([a, b, c]) => {
                (has(c, a) && has(c, b)).then_some((a, b, c))
            }
            _ => None,
        })
        .expect("kabuto has a fold with a face across it");
    // Put the face between them: above a, below b.
    let (a, b, face) = (a.0 as usize, b.0 as usize, face.0 as usize);
    let wrong: Vec<HierarchyRelation> = figure
        .shown
        .iter()
        .map(|r| {
            let pair = (
                r.upper_face.min(r.lower_face),
                r.upper_face.max(r.lower_face),
            );
            if pair == (a.min(face), a.max(face)) {
                HierarchyRelation {
                    upper_face: face,
                    lower_face: a,
                }
            } else if pair == (b.min(face), b.max(face)) {
                HierarchyRelation {
                    upper_face: b,
                    lower_face: face,
                }
            } else {
                *r
            }
        })
        .collect();
    let above = |upper: usize, lower: usize| {
        wrong
            .iter()
            .any(|r| r.upper_face == upper && r.lower_face == lower)
    };
    let session = ConstraintSession::open_showing(source(&figure.fold), &wrong, &Limits::default())
        .expect("open");
    let OpenedOn::Closest {
        moved,
        inside: Some(inside),
        ..
    } = session.opened_on()
    else {
        panic!("{:?}", session.opened_on());
    };
    assert!(*moved >= 1, "{moved}");
    // The face named is one of the creases' conditions the order given breaks.
    let [x, y] = inside.crease;
    let (x, y, f) = (x.0 as usize, y.0 as usize, inside.face.0 as usize);
    assert!(
        session.source().problem().constraints().contains(
            &oristudio_layer_order::Constraint::TacoTortilla([
                inside.crease[0],
                inside.crease[1],
                inside.face
            ])
        ),
        "{inside:?}"
    );
    assert_ne!(above(f, x), above(f, y), "{inside:?}");
    // Edit's own order breaks none: it opens held.
    let edit =
        ConstraintSession::open_showing(source(&figure.fold), &figure.shown, &Limits::default())
            .expect("open");
    assert!(
        matches!(edit.opened_on(), OpenedOn::Held { .. }),
        "{:?}",
        edit.opened_on()
    );
}

// 2. Add adopts its preview.

#[test]
fn add_adopts_its_preview_without_searching() {
    for (name, relative) in FIXTURES {
        let figure = figure(relative);
        let mut session = ConstraintSession::open_showing(
            source(&figure.fold),
            &figure.shown,
            &Limits::default(),
        )
        .expect("open");
        for k in 0..3 {
            let open = session.open_pairs();
            let Some(&pair) = open.get(k * open.len() / 3) else {
                break;
            };
            let candidate = against_shown(&session, pair);
            let Ok(Preview::Fits(fit)) = session.preview(candidate, &Limits::default()) else {
                continue;
            };
            let order = fit.order();
            let changed = fit.changed.clone();
            let mut list = session.constraints().to_vec();
            list.push(candidate);
            assert_eq!(fit.constraints(), list.as_slice());
            assert_eq!(
                fit.oriedita_relations(&session).len(),
                session.oriedita_relations().len()
            );
            // Even out of time, the current preview is adopted.
            match session.commit_preview(fit, &passed()) {
                Ok(Commit::Committed(done)) => assert_eq!(done.changed, changed, "{name}"),
                other => panic!("{name}: {other:?}"),
            }
            assert_eq!(session.shown_order(), order, "{name}");
            assert_eq!(session.constraints(), list.as_slice(), "{name}");
        }
    }
    // A preview the session has moved on from is committed by a search.
    let figure = figure(FIXTURES[0].1);
    let mut session =
        ConstraintSession::open(source(&figure.fold), &Limits::default()).expect("open");
    let open = session.open_pairs();
    let (a, b) = (open[0], open[open.len() - 1]);
    let Ok(Preview::Fits(stale)) = session.preview(against_shown(&session, a), &Limits::default())
    else {
        panic!("an open pair's other order fits");
    };
    let keep = with_shown(&session, b);
    assert!(matches!(
        session.commit(vec![keep], &Limits::default()),
        Ok(Commit::Committed(_))
    ));
    // Out of time, the stale preview cannot be adopted, and is not.
    let before = session.shown_order();
    match session.commit_preview(stale.clone(), &passed()) {
        Ok(Commit::TimedOut(_)) => assert_eq!(session.shown_order(), before),
        other => panic!("{other:?}"),
    }
    // With time it commits its own list.
    match session.commit_preview(stale.clone(), &Limits::default()) {
        Ok(Commit::Committed(_)) => assert_eq!(session.constraints(), stale.constraints()),
        other => panic!("{other:?}"),
    }
    // A preview from another session is never adopted by this one.
    let other = ConstraintSession::open(source(&figure.fold), &Limits::default()).expect("open");
    let Ok(Preview::Fits(foreign)) = other.preview(against_shown(&other, a), &Limits::default())
    else {
        panic!("fits");
    };
    let mut third =
        ConstraintSession::open(source(&figure.fold), &Limits::default()).expect("open");
    assert!(matches!(
        third.commit_preview(foreign, &passed()),
        Ok(Commit::TimedOut(_))
    ));
}

// 3, 8. The rows after a clash: previewed as a list, carried, saved.

/// Saved constraints a restore cannot apply are carried, written back by a
/// save as they were saved, and leave only when removed or committed; the
/// builder previews against the rows when nothing is committed.
#[test]
fn rows_a_restore_cannot_apply_are_carried_and_saved() {
    let figure = figure(FIXTURES[0].1);
    let plain = ConstraintSession::open(source(&figure.fold), &Limits::default()).expect("open");
    let open = plain.open_pairs();
    let fine = with_shown(&plain, open[0]);
    // A pair the creases force, saved the other way: the clash.
    let forced = plain
        .source()
        .problem()
        .variables()
        .iter()
        .copied()
        .find(|p| plain.forced(p.lo(), p.hi()).is_some() && !p.contains(fine.subject))
        .expect("forced");
    let against = against_shown(&plain, forced);
    let mut record = LayerOrderRecord::default();
    let add = |record: &mut LayerOrderRecord, c: Constraint| {
        let f = listed(record, plain.source(), c.subject);
        let g = listed(record, plain.source(), c.object);
        record.constraints.push(RecordPair { f, g, sign: c.sign });
    };
    add(&mut record, fine);
    add(&mut record, against);
    // And a row whose face is off the paper: gone.
    record.faces.push(RecordFace {
        at: [1e4, 1e4],
        area: 1.0,
    });
    let off = record.faces.len() as u32 - 1;
    record.constraints.push(RecordPair {
        f: 0,
        g: off,
        sign: FoldSign::Front,
    });

    let mut restored =
        ConstraintSession::restore(source(&figure.fold), &record, &Limits::default())
            .expect("restore");
    assert_eq!(
        restored.outcome,
        RestoreOutcome::Clash {
            constraints: vec![1]
        }
    );
    let session = &mut restored.session;
    assert!(session.constraints().is_empty());
    let carried = session.carried().to_vec();
    assert_eq!(carried.len(), 3, "nothing applied, nothing dropped");
    assert_eq!(carried[0].status, ConstraintStatus::Intact);
    assert_eq!(carried[0].constraint, Some(fine));
    assert_eq!(carried[1].status, ConstraintStatus::Clashing);
    assert_eq!(
        carried[2].status,
        ConstraintStatus::Gone {
            cause: GoneCause::FaceGone
        }
    );
    assert_eq!(carried[2].constraint, None);
    assert_eq!(carried[2].object, record.faces[off as usize]);

    // A save now writes all three back, the gone one by its saved faces.
    let saved = session.save().expect("save");
    assert_eq!(saved.constraints.len(), 3);
    let last = saved.constraints[2];
    assert_eq!(saved.faces[last.g as usize], record.faces[off as usize]);

    // The builder previews against its rows, not the empty committed list.
    let rows = vec![fine, against];
    match session.preview_list(&rows, &Limits::default()) {
        Ok(Preview::CantFit(why)) => {
            assert_eq!(why.proof, CantFitProof::Forced);
            assert_eq!(why.constraints, vec![1]);
        }
        other => panic!("{other:?}"),
    }
    assert!(
        session.constraints().is_empty(),
        "a preview commits nothing"
    );
    // The user removes the clashing row; the rest is applied, and the
    // applied row leaves the carried ones.
    let removed = session.remove_carried(1).expect("a row");
    assert_eq!(removed.status, ConstraintStatus::Clashing);
    let Ok(Preview::Fits(fit)) = session.preview_list(&[fine], &Limits::default()) else {
        panic!("the rest fits");
    };
    assert!(matches!(
        session.commit_preview(fit, &Limits::default()),
        Ok(Commit::Committed(_))
    ));
    assert_eq!(session.constraints(), &[fine]);
    assert_eq!(session.carried().len(), 1, "the gone row is still carried");
    let saved = session.save().expect("save");
    assert_eq!(saved.constraints.len(), 2);
    // A dialog keeps or drops a carried row at the save, by its record
    // index, and the session keeps it either way, for an undo after a save
    // the host refuses.
    assert_eq!(session.carried()[0].index, 2);
    assert_eq!(
        session.save_keeping(&[]).expect("save").constraints.len(),
        1
    );
    assert_eq!(
        session.save_keeping(&[2]).expect("save").constraints.len(),
        2
    );
    assert_eq!(
        session
            .save_keeping(&[0, 1])
            .expect("save")
            .constraints
            .len(),
        1
    );
    assert_eq!(session.carried().len(), 1);
    // A removal names its row by record index too, never by its place: the
    // row of record index 2 is the only one now.
    assert!(
        session.remove_carried(0).is_none(),
        "record index 0 was applied"
    );
    assert_eq!(session.remove_carried(2).map(|row| row.index), Some(2));
    assert_eq!(session.save().expect("save").constraints.len(), 1);
    session.clear_carried();
    assert_eq!(session.save().expect("save").constraints.len(), 1);
}

/// After a restore that applied what it could, the ambiguous and gone rows
/// are carried, and an Apply writes them back.
#[test]
fn an_applied_restore_carries_what_it_did_not_apply() {
    let figure = figure(FIXTURES[0].1);
    let mut plain =
        ConstraintSession::open(source(&figure.fold), &Limits::default()).expect("open");
    let fine = against_shown(&plain, plain.open_pairs()[0]);
    assert!(matches!(
        plain.commit(vec![fine], &Limits::default()),
        Ok(Commit::Committed(_))
    ));
    let mut record = plain.save().expect("save");
    // A row whose subject now lies in a face of another area.
    let shrunk = RecordFace {
        area: record.faces[0].area * 0.5,
        ..record.faces[0]
    };
    record.faces.push(shrunk);
    let k = record.faces.len() as u32 - 1;
    record.constraints.push(RecordPair {
        f: k,
        g: 1,
        sign: FoldSign::Back,
    });
    let restored = ConstraintSession::restore(source(&figure.fold), &record, &Limits::default())
        .expect("restore");
    assert_eq!(restored.outcome, RestoreOutcome::Applied);
    assert_eq!(restored.session.constraints(), &[fine]);
    assert_eq!(restored.session.carried().len(), 1);
    assert_eq!(
        restored.session.carried()[0].status,
        ConstraintStatus::Ambiguous
    );
    let saved = restored.session.save().expect("save");
    assert_eq!(saved.constraints.len(), 2);
    let back = saved.constraints[1];
    assert_eq!(saved.faces[back.f as usize], shrunk);
    assert_eq!(back.sign, FoldSign::Back);
}

/// `face`'s index in `record`, listing it by its interior point when it is
/// not.
fn listed(record: &mut LayerOrderRecord, source: &LayerSource, face: FaceId) -> u32 {
    let at = source.interior_point(face).expect("a point");
    if let Some(i) = record.faces.iter().position(|f| f.at == at) {
        return i as u32;
    }
    record.faces.push(RecordFace {
        at,
        area: source.paper_area(face).expect("an area"),
    });
    (record.faces.len() - 1) as u32
}

// 4. A restore again, on the open session.

#[test]
fn a_restore_runs_again_on_the_open_session() {
    let figure = figure(FIXTURES[0].1);
    let mut plain =
        ConstraintSession::open(source(&figure.fold), &Limits::default()).expect("open");
    let c = against_shown(&plain, plain.open_pairs()[0]);
    assert!(matches!(
        plain.commit(vec![c], &Limits::default()),
        Ok(Commit::Committed(_))
    ));
    let record = plain.save().expect("save");
    // The source back, for another session on the same creases.
    let mut session =
        ConstraintSession::open(plain.into_source(), &Limits::default()).expect("open again");

    // Out of time: nothing applied, every saved pair unchecked, every row
    // carried.
    let report = session.restore_record(&record, &passed()).expect("restore");
    assert!(matches!(report.outcome, RestoreOutcome::TimedOut(_)));
    assert!(matches!(
        session.opened_on(),
        OpenedOn::First { timed_out: Some(_) }
    ));
    assert!(
        report
            .order
            .iter()
            .all(|s| *s == SavedPairStatus::Unresolved)
    );
    assert!(session.constraints().is_empty());
    assert_eq!(session.carried().len(), 1);

    // Again, with time: as a fresh restore.
    let report = session
        .restore_record(&record, &Limits::default())
        .expect("restore");
    assert_eq!(report.outcome, RestoreOutcome::Applied);
    assert_eq!(session.opened_on(), &OpenedOn::Held { ignored: 0 });
    assert_eq!(session.constraints(), &[c]);
    assert!(session.carried().is_empty());
    let fresh = ConstraintSession::restore(source(&figure.fold), &record, &Limits::default())
        .expect("restore");
    assert_eq!(session.shown_order(), fresh.session.shown_order());
    assert_eq!(report.faces, fresh.faces);
    assert_eq!(report.order, fresh.order);
}

/// A clash whose fallback orders both run out of time says so.
#[test]
fn a_clash_out_of_time_says_so() {
    let figure = figure(FIXTURES[0].1);
    let mut session =
        ConstraintSession::open(source(&figure.fold), &Limits::default()).expect("open");
    let pair = session.open_pairs()[0];
    let (up, down) = (with_shown(&session, pair), against_shown(&session, pair));
    let mut record = LayerOrderRecord::default();
    for c in [up, down] {
        let f = listed(&mut record, session.source(), c.subject);
        let g = listed(&mut record, session.source(), c.object);
        record.constraints.push(RecordPair { f, g, sign: c.sign });
    }
    let report = session.restore_record(&record, &passed()).expect("restore");
    assert_eq!(
        report.outcome,
        RestoreOutcome::Clash {
            constraints: vec![0, 1]
        }
    );
    assert!(matches!(
        session.opened_on(),
        OpenedOn::First { timed_out: Some(_) }
    ));
}

// 5. A point in another face of the same area.

/// A 400 square pleated into strips at `xs`, valley and mountain in turn.
fn strips(xs: &[f64]) -> String {
    let mut stops = vec![-200.0];
    stops.extend_from_slice(xs);
    stops.push(200.0);
    let mut text = String::new();
    for w in stops.windows(2) {
        text.push_str(&format!(
            "1 {} -200 {} -200\n1 {} 200 {} 200\n",
            w[0], w[1], w[0], w[1]
        ));
    }
    text.push_str("1 -200 -200 -200 200\n1 200 -200 200 200\n");
    for (i, x) in xs.iter().enumerate() {
        let kind = if i % 2 == 0 { 3 } else { 2 };
        text.push_str(&format!("{kind} {x} -200 {x} 200\n"));
    }
    text
}

#[test]
fn a_point_now_in_another_face_of_the_same_area_is_ambiguous() {
    let even = figure_of_text(&strips(&[-100.0, 0.0, 100.0]), false);
    let mut session =
        ConstraintSession::open(source(&even.fold), &Limits::default()).expect("open");
    // The first strip, and its neighbour, by the order on screen.
    let first = session
        .source()
        .face_at_paper([-150.0, 0.0])
        .expect("a strip");
    let second = session
        .source()
        .face_at_paper([-50.0, 0.0])
        .expect("a strip");
    let c = with_shown(&session, FacePair::new(first, second).expect("two strips"));
    assert!(matches!(
        session.commit(vec![c], &Limits::default()),
        Ok(Commit::Committed(_))
    ));
    let record = session.save().expect("save");
    // Restored on itself, every face is intact.
    let same = ConstraintSession::restore(source(&even.fold), &record, &Limits::default())
        .expect("restore");
    assert!(
        same.faces
            .iter()
            .all(|f| matches!(f, FaceStatus::Intact { .. }))
    );
    // The pleats moved: the first strip's point now lies in a strip of the
    // same width, so the same area, that is not it.
    let shifted = figure_of_text(&strips(&[-160.0, -60.0, 40.0, 140.0]), false);
    let moved = ConstraintSession::restore(source(&shifted.fold), &record, &Limits::default())
        .expect("restore");
    let i = record
        .faces
        .iter()
        .position(|f| f.at[0] < -100.0)
        .expect("the first strip");
    let FaceStatus::Ambiguous { area, .. } = moved.faces[i] else {
        panic!("{:?}", moved.faces[i]);
    };
    assert!((area - record.faces[i].area).abs() < 1e-9, "the same area");
    assert_eq!(moved.constraints, vec![ConstraintStatus::Ambiguous]);
    assert!(moved.session.constraints().is_empty());
    assert_eq!(moved.session.carried().len(), 1);
}

// 6. Thin faces.

#[test]
fn a_thin_face_is_saved_by_a_point_it_is_found_at() {
    // A flap 0.001 wide along one edge of a 400 square: wider than the
    // tolerance (0.0004 here), its centroid nearer an edge than that.
    let text = "1 -200 -200 200 -200\n1 200 -200 200 -199.999\n1 200 -199.999 200 200\n\
                1 200 200 -200 200\n1 -200 200 -200 -200\n3 -200 -200 200 -199.999\n";
    let thin = figure_of_text(text, false);
    let source_ = source(&thin.fold);
    let flap = (0..source_.view().faces().len() as u32)
        .map(FaceId)
        .min_by(|a, b| {
            let area = |f| source_.paper_area(f).unwrap_or(f64::MAX);
            area(*a).total_cmp(&area(*b))
        })
        .expect("faces");
    let centroid = source_.paper_point(flap).expect("a centroid");
    assert_ne!(
        source_.face_at_paper(centroid),
        Some(flap),
        "too near an edge"
    );
    let at = source_.interior_point(flap).expect("a point");
    assert_eq!(source_.face_at_paper(at), Some(flap));

    // Saved by that point, it is found again.
    let mut session = ConstraintSession::open(source_, &Limits::default()).expect("open");
    let other = FaceId(1 - flap.0);
    let c = with_shown(&session, FacePair::new(flap, other).expect("two faces"));
    assert!(matches!(
        session.commit(vec![c], &Limits::default()),
        Ok(Commit::Committed(_))
    ));
    let record = session.save().expect("save");
    assert!(record.faces.iter().any(|f| f.at == at));
    let restored = ConstraintSession::restore(source(&thin.fold), &record, &Limits::default())
        .expect("restore");
    assert!(
        restored
            .faces
            .iter()
            .all(|f| matches!(f, FaceStatus::Intact { .. })),
        "{:?}",
        restored.faces
    );
    assert_eq!(restored.session.constraints(), &[c]);
}
