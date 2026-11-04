//! The petal fold through the compound pipeline (plan Phase 11; research
//! §5.3), on the vertex spike's case 2: two petal folds on the preliminary
//! base are Beloch's bird base, each the only state, with its eight hinge
//! changes; a petal fold whose H is named by a crease needs its creases
//! precreased, and is refused naming the paper they would cross; and one
//! whose H is named by two points creases H in the top layer alone, and the
//! kite creases if they are missing, landing exactly what folding over those
//! creases precreased there lands.

mod beloch;
mod support;
mod vertex;

use std::collections::BTreeSet;

use oristudio_fold::{
    CompletionLimits, CompoundRefused, CreaseKind, CreasePatternInput, Direction, EdgeId, Face,
    FaceId, Fix, FoldRefusal, ImportKind, ImportSegment, ImportSpace, ImportTarget,
    ImportedPattern, Letter, NoPetal, NoPetalDetail, PetalCrease, PetalFold, PetalHinge, Seed,
    StartSide, State, VertexChoices, VertexFolded,
};
use oristudio_geometry::convex;
use oristudio_layer_order::{LayerOrder, Violation};
use vertex::cases::{self, PetalMarks, landed};
use vertex::{check, flat_segments, folded_segments, frame_segments, symmetries_between};

fn refusal(state: &State, op: &PetalFold) -> FoldRefusal {
    match state.petal_fold(op, &VertexChoices::default()) {
        Err(CompoundRefused::Refused(refused)) => refused.refusal,
        Err(CompoundRefused::Broken(broken)) => panic!("broken {broken}"),
        Ok(_) => panic!("{op:?} landed"),
    }
}

/// Spike case 2: on the preliminary base (two squashes), the kite creases
/// and H precreased, a petal fold front and back is the bird base. Its
/// folded creases are Beloch's `bird-base-petal.fold` when folded in mirror
/// image, as the base is (the spike's route matches it under x ↦ 1 − x;
/// Beloch's frame folds no precreases, so the faces differ and the creases
/// compare); each petal fold is the only state, with research §5.3's eight
/// hinge changes and six blocks with what stays; and the bird base is the
/// only order its crease pattern and letters allow.
#[test]
fn two_petal_folds_make_belochs_bird_base() {
    let doc = beloch::document("bird-base-petal.fold");
    let frame = beloch::final_frame(&doc).unwrap_or_else(|e| panic!("{e}"));
    for mirror in [true, false] {
        let route = cases::bird_base(mirror);
        for (parent, folded) in &route.steps {
            check(parent, folded);
            let fold = &folded.report.fold;
            // H in the top layer and the four kite segments in the top two
            // fold again; the closed edges below H's ends unfold.
            assert!(fold.created.is_empty());
            assert_eq!((fold.refolded.len(), fold.unfolded.len()), (6, 2));
            assert_eq!(fold.blocks.len(), 5);
            assert_eq!(folded.report.vertices.len(), 2);
        }
        let bird = route.last();
        assert_eq!(bird.faces().len(), 24);
        let symmetries = symmetries_between(&folded_segments(bird), &frame_segments(&frame));
        let want = if mirror { "id" } else { "flip x" };
        assert!(
            symmetries.contains(&want),
            "mirror {mirror}: {symmetries:?}"
        );
        assert!(vertex::only_order_of_its_pattern(bird));
    }
}

/// The creases a petal fold folds must be there when H is named by a
/// crease: without H precreased, the top layer below it is one piece H
/// crosses; without the kite creases, the top layer has none to fold. Each
/// refusal names the faces.
#[test]
fn a_petal_fold_needs_its_creases_precreased() {
    let marks: PetalMarks = cases::petal_marks(false);
    let base = cases::preliminary(false).last().clone();
    // Kites, no H.
    let kites = cases::kites(&base, &marks);
    let refused = refusal(&kites, &cases::petal_op(&kites, &marks));
    let FoldRefusal::PetalNotPrecreased { faces, missing } = &refused else {
        panic!("{refused:?}");
    };
    assert_eq!(*missing, PetalCrease::Line);
    assert!(!faces.is_empty());
    assert_eq!(refused.faces(), *faces);
    // H, no kites.
    let h = cases::precrease(&base, marks.ends[0], marks.ends[1], marks.t, Seed::All);
    assert!(matches!(
        refusal(&h, &cases::petal_op(&h, &marks)),
        FoldRefusal::PetalNotPrecreased {
            missing: PetalCrease::Kite,
            ..
        }
    ));
    // Through JSON, by code.
    let json = serde_json::to_value(&refused).unwrap_or_default();
    assert_eq!(json["code"], "petal_not_precreased");
    assert_eq!(json["missing"], "line");
}

/// A petal fold refused for H uncreased offers to precrease H through every
/// layer first only where the same fold then lands: over the kites it does
/// (the bird base's route), and the fold and the analysis both say so;
/// with nothing precreased the kites would still be missing, so nothing is
/// offered.
#[test]
fn a_petal_fold_offers_to_precrease_h_only_where_it_then_lands() {
    let marks: PetalMarks = cases::petal_marks(false);
    let base = cases::preliminary(false).last().clone();
    let kites = cases::kites(&base, &marks);
    let op = cases::petal_op(&kites, &marks);
    let PetalHinge::Crease { line } = op.hinge else {
        unreachable!()
    };
    let refused = match kites.petal_fold(&op, &VertexChoices::default()) {
        Err(CompoundRefused::Refused(refused)) => refused,
        other => panic!("{other:?}"),
    };
    assert!(matches!(
        refused.refusal,
        FoldRefusal::PetalNotPrecreased {
            missing: PetalCrease::Line,
            ..
        }
    ));
    assert_eq!(refused.fixes, vec![Fix::PrecreaseFirst { line }]);
    let analysed = kites.analyse_petal(&op).err();
    assert_eq!(analysed.map(|r| r.fixes), Some(refused.fixes.clone()));
    // The fix's route lands.
    let with_h = cases::precrease(&kites, marks.ends[0], marks.ends[1], marks.t, Seed::All);
    landed(with_h.petal_fold(&cases::petal_op(&with_h, &marks), &VertexChoices::default()));
    let json = serde_json::to_value(&refused.fixes[0]).unwrap_or_default();
    assert_eq!(json["fix"], "precrease_first");

    let bare = cases::petal_op(&base, &marks);
    let refused = match base.petal_fold(&bare, &VertexChoices::default()) {
        Err(CompoundRefused::Refused(refused)) => refused,
        other => panic!("{other:?}"),
    };
    assert!(matches!(
        refused.refusal,
        FoldRefusal::PetalNotPrecreased {
            missing: PetalCrease::Line,
            ..
        }
    ));
    assert!(refused.fixes.is_empty(), "{:?}", refused.fixes);
}

/// The analysis names H's ends on the closed edges, the open corner the
/// kite creases meet at, and the two layers below H; over precreases it
/// scores nothing.
#[test]
fn the_analysis_finds_the_ends_the_corner_and_the_layers() {
    let route = cases::bird_base(false);
    let (front, _) = &route.steps[0];
    let marks = cases::petal_marks(false);
    let close = |a: [f64; 2], b: [f64; 2]| (a[0] - b[0]).hypot(a[1] - b[1]) < 1e-9;
    for op in [
        cases::petal_op(front, &marks),
        cases::petal_points_op(front, &marks),
    ] {
        let analysis = front.analyse_petal(&op).unwrap_or_else(|e| panic!("{e}"));
        assert!(
            analysis
                .ends
                .iter()
                .all(|&e| marks.ends.iter().any(|&m| close(e, m))),
            "{analysis:?}"
        );
        assert!(close(analysis.corner, marks.open));
        assert_eq!(analysis.top.len(), 4);
        assert_eq!(analysis.second.len(), 4);
        assert!(!analysis.scores_line);
        assert_eq!(analysis.scores_kites, [false, false]);
    }
}

/// H through two points on the preliminary base, never precreased: the
/// analysis finds the same ends and corner, the kite creases precreased or
/// the bisectors of H and the closed edges at its ends, and says what the
/// fold will crease. The flap's layers are the faces H and the kites cross.
#[test]
fn the_analysis_of_h_through_two_points_says_what_it_creases() {
    let marks = cases::petal_marks(false);
    let base = cases::preliminary(false).last().clone();
    let close = |a: [f64; 2], b: [f64; 2]| (a[0] - b[0]).hypot(a[1] - b[1]) < 1e-9;
    for (state, kites_there) in [(cases::kites(&base, &marks), true), (base.clone(), false)] {
        let analysis = state
            .analyse_petal(&cases::petal_points_op(&state, &marks))
            .unwrap_or_else(|e| panic!("{e}"));
        assert!(
            analysis
                .ends
                .iter()
                .all(|&e| marks.ends.iter().any(|&m| close(e, m))),
            "{analysis:?}"
        );
        assert!(close(analysis.corner, marks.open), "{analysis:?}");
        for (kite, end) in analysis.kites.iter().zip(analysis.ends) {
            assert!(kite.distance_to_point(end) < 1e-9);
            assert!(kite.distance_to_point(marks.open) < 1e-9);
        }
        assert!(analysis.scores_line);
        assert_eq!(analysis.scores_kites, [!kites_there, !kites_there]);
        // The front flap is two faces (its centre crease flat), its second
        // layer one triangle each side, until the kites split them.
        let (top, second) = if kites_there { (4, 4) } else { (2, 2) };
        assert_eq!((analysis.top.len(), analysis.second.len()), (top, second));
    }
}

/// The petal fold with H through its two ends on the preliminary base: H
/// scored across the top layer alone, as two new creases either side of
/// its centre crease, and every crease the fold makes or refolds lies in
/// the top two layers; with the kites precreased those refold, otherwise
/// the fold scores them too. Either way, research §5.3's eight hinge
/// changes and six blocks with what stays.
#[test]
fn a_petal_fold_through_two_points_creases_h_in_the_top_layer_alone() {
    let marks = cases::petal_marks(false);
    let base = cases::preliminary(false).last().clone();
    for kites_first in [true, false] {
        let parent = if kites_first {
            cases::kites(&base, &marks)
        } else {
            base.clone()
        };
        let op = cases::petal_points_op(&parent, &marks);
        let analysis = parent.analyse_petal(&op).unwrap_or_else(|e| panic!("{e}"));
        let folded = landed(parent.petal_fold(&op, &VertexChoices::default()));
        check(&parent, &folded);
        let fold = &folded.report.fold;
        let created = if kites_first { 2 } else { 6 };
        assert_eq!(
            (fold.created.len(), fold.refolded.len(), fold.unfolded.len()),
            (created, 6 - created, 2),
            "kites first {kites_first}"
        );
        assert_eq!(fold.blocks.len(), 5);
        // Each new crease bounds pieces of the top two layers; those on H,
        // of the top layer.
        let state = &folded.state;
        let lineage = |face: &Face| face.parent.unwrap_or(face.id);
        let layers: BTreeSet<FaceId> = analysis
            .top
            .iter()
            .chain(&analysis.second)
            .copied()
            .collect();
        let top: BTreeSet<FaceId> = analysis.top.iter().copied().collect();
        let mut on_h = 0;
        for &edge in &fold.created {
            let crease = state.crease(edge).unwrap_or_else(|| panic!("no {edge}"));
            let bounding: Vec<&Face> = state
                .faces()
                .iter()
                .filter(|f| crease.vertices.iter().all(|v| f.ring.contains(v)))
                .collect();
            assert_eq!(bounding.len(), 2, "crease {edge}");
            assert!(bounding.iter().all(|f| layers.contains(&lineage(f))));
            let image = |f: &Face| {
                let t = state.isometry(f.id).unwrap_or_default();
                crease
                    .vertices
                    .map(|v| t.apply(state.vertices()[v.0 as usize]))
            };
            // The landed images of H's creases lie where the petal turned
            // them: back across H, onto it.
            let ends = image(bounding[0]);
            if ends
                .iter()
                .all(|&p| analysis.line.distance_to_point(p) < 1e-9)
            {
                on_h += 1;
                assert!(bounding.iter().all(|f| top.contains(&lineage(f))));
            }
        }
        assert_eq!(on_h, 2, "kites first {kites_first}");
    }
}

/// The bird base with H named by its two ends, never precreased — the kite
/// creases precreased first, or creased by the folds too — folds Beloch's
/// creases, and the precreased route's, each fold the only state; its only
/// flat creases are ones the precreased route has too, which creased H
/// through every layer.
#[test]
fn the_bird_base_through_two_points_is_belochs_and_the_precreased_ones() {
    let doc = beloch::document("bird-base-petal.fold");
    let frame = beloch::final_frame(&doc).unwrap_or_else(|e| panic!("{e}"));
    for mirror in [true, false] {
        let precreased = cases::bird_base(mirror);
        let want = folded_segments(precreased.last());
        for kites_first in [true, false] {
            let route = cases::bird_base_points(mirror, kites_first);
            for (parent, folded) in &route.steps {
                check(parent, folded);
                assert_eq!(folded.report.fold.blocks.len(), 5);
            }
            let bird = route.last();
            assert_eq!(folded_segments(bird), want, "mirror {mirror}");
            let symmetries = symmetries_between(&folded_segments(bird), &frame_segments(&frame));
            let beloch = if mirror { "id" } else { "flip x" };
            assert!(symmetries.contains(&beloch), "{symmetries:?}");
            assert!(vertex::only_order_of_its_pattern(bird));
            let flat = flat_segments(bird);
            let theirs = flat_segments(precreased.last());
            assert!(flat.is_subset(&theirs), "{flat:?} ⊄ {theirs:?}");
            assert!(flat.len() < theirs.len());
        }
    }
}

/// A state's facts with no face, vertex or crease number in them, as the
/// bridge's `fs1` keys spell one: each face by its sheet polygon and its
/// model image, each crease by its sheet segment and kind, the order by the
/// faces' sheet centroids. Numbers in units of 1e-9.
fn facts(state: &State) -> BTreeSet<String> {
    let r = |p: [f64; 2]| [(p[0] * 1e9).round() as i64, (p[1] * 1e9).round() as i64];
    let sheet = |face: &Face| -> Vec<[f64; 2]> {
        face.ring
            .iter()
            .map(|v| state.vertices()[v.0 as usize])
            .collect()
    };
    let witness = |id: FaceId| {
        let face = state.face(id).unwrap_or_else(|| panic!("no face {id}"));
        r(convex::centroid(&sheet(face)).unwrap_or_default())
    };
    let mut out = BTreeSet::new();
    for face in state.faces() {
        let mut polygon: Vec<[i64; 2]> = sheet(face).into_iter().map(r).collect();
        polygon.sort_unstable();
        let mut image: Vec<[i64; 2]> = state
            .face_image(face.id)
            .unwrap_or_default()
            .iter()
            .map(|&p| r(p))
            .collect();
        image.sort_unstable();
        out.insert(format!("f:{polygon:?}:{image:?}"));
    }
    for crease in state.creases() {
        let [a, b] = crease.vertices.map(|v| r(state.vertices()[v.0 as usize]));
        let (a, b) = if a <= b { (a, b) } else { (b, a) };
        out.insert(format!("c:{a:?}{b:?}:{:?}", crease.kind));
    }
    for (pair, above) in state.order().pairs() {
        let (lo, hi) = (witness(pair.lo()), witness(pair.hi()));
        let above = above.unwrap_or_else(|| panic!("{pair:?} undetermined"));
        out.insert(if lo <= hi {
            format!("o:{lo:?}{hi:?}:{above}")
        } else {
            format!("o:{hi:?}{lo:?}:{}", !above)
        });
    }
    out
}

/// Whether the sheet point `p` lies on the segment `a b`.
fn on_segment(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> bool {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let length = dx.hypot(dy);
    let off = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / length;
    let along = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length;
    off.abs() < 1e-9 && along > -1e-9 && along < length + 1e-9
}

/// `parent` with the creases the petal fold `folded` scored on it there
/// already, flat, remembering the letters they folded to, and nowhere else:
/// the landed crease pattern with each crease the kind its paper had in the
/// parent, and the parent's order between the pieces of its faces — the
/// precreases a petal fold over them would need to fold what `folded`
/// scored.
fn precreased_where_scored(parent: &State, folded: &VertexFolded) -> State {
    let landed = &folded.state;
    let created: BTreeSet<EdgeId> = folded.report.fold.created.iter().copied().collect();
    let mut parts = landed.parts().clone();
    for crease in &mut parts.creases {
        if created.contains(&crease.id) {
            let letter = crease.kind.letter().unwrap_or(Letter::Valley);
            crease.kind = CreaseKind::Flat(letter);
            crease.made_at = parent.step();
            continue;
        }
        let [a, b] = crease.vertices.map(|v| landed.vertices()[v.0 as usize]);
        let was = parent
            .creases()
            .iter()
            .find(|c| {
                let [p, q] = c.vertices.map(|v| parent.vertices()[v.0 as usize]);
                on_segment(a, p, q) && on_segment(b, p, q)
            })
            .unwrap_or_else(|| panic!("crease {} is no parent crease's", crease.id));
        crease.kind = was.kind;
    }
    parts.step = parent.step();
    parts.view = parent.parts().view;
    parts.order = LayerOrder::new();
    let lineage = |id: FaceId| -> FaceId {
        match landed.face(id) {
            Some(face) if parent.face(id).is_none() => face
                .parent
                .unwrap_or_else(|| panic!("piece {id} has no parent")),
            _ => id,
        }
    };
    // The gate names every overlapping pair an empty order misses: each
    // takes the order of the parent's faces it is pieces of.
    let missing: Vec<_> = match State::make(parts.clone()) {
        Err(FoldRefusal::LayerOrder { violations }) => violations
            .iter()
            .filter_map(|v| match v {
                Violation::MissingPair { pair } => Some(*pair),
                _ => None,
            })
            .collect(),
        other => panic!("an empty order passed the gate: {:?}", other.err()),
    };
    for pair in missing {
        let (lo, hi) = (pair.lo(), pair.hi());
        let above = parent
            .above(lineage(lo), lineage(hi))
            .unwrap_or_else(|| panic!("the parent does not order {pair:?}"));
        let (upper, lower) = if above { (lo, hi) } else { (hi, lo) };
        parts
            .order
            .set_above(upper, lower)
            .unwrap_or_else(|e| panic!("{e:?}"));
    }
    State::make(parts).unwrap_or_else(|e| panic!("{e}"))
}

/// The proof the request asks for: on the preliminary base (kites
/// precreased, or not) and again on its back after the first petal fold,
/// the petal fold with H through two points lands exactly the state the
/// petal fold over a precreased H lands when H — and every kite crease the
/// first one scored — was precreased exactly where it is now scored: the
/// same faces, the same creases and letters, the same order.
#[test]
fn scoring_h_lands_what_precreasing_it_there_lands() {
    for mirror in [false, true] {
        let marks = cases::petal_marks(mirror);
        for kites_first in [true, false] {
            let route = cases::bird_base_points(mirror, kites_first);
            for (k, (parent, folded)) in route.steps.iter().enumerate() {
                let precreased = precreased_where_scored(parent, folded);
                let analysis = precreased
                    .analyse_petal(&cases::petal_op(&precreased, &marks))
                    .unwrap_or_else(|e| panic!("step {k}: {e}"));
                assert!(!analysis.scores_line);
                let over = landed(precreased.petal_fold(
                    &cases::petal_op(&precreased, &marks),
                    &VertexChoices::default(),
                ));
                check(&precreased, &over);
                assert!(over.report.fold.created.is_empty());
                assert_eq!(
                    facts(&over.state),
                    facts(&folded.state),
                    "mirror {mirror}, kites first {kites_first}, step {k}"
                );
                assert_eq!(over.state.view(), folded.state.view());
                // The precreased H is in the top layer alone: the second
                // layer's paper inside the kite lies across its line,
                // uncreased, and that is no refusal.
                let h = cases::petal_op(&precreased, &marks);
                let line = match h.hinge {
                    PetalHinge::Crease { line } => line,
                    PetalHinge::Points { .. } => unreachable!(),
                };
                let across = analysis.second.iter().any(|&f| {
                    let image = precreased.face_image(f).unwrap_or_default();
                    let d: Vec<f64> = image.iter().map(|&p| line.signed_distance(p)).collect();
                    d.iter().any(|&x| x > 1e-6) && d.iter().any(|&x| x < -1e-6)
                });
                assert!(across, "step {k}: no second-layer face spans H");
            }
        }
    }
}

/// A mountain petal fold through two points lifts the back flap away from
/// the viewer: the state the valley one lands on the model turned over.
#[test]
fn a_mountain_petal_fold_through_two_points_is_the_valley_one_turned_over() {
    let marks = cases::petal_marks(false);
    let first = &cases::bird_base_points(false, false).steps[0].1.state;
    let valley = landed(first.turn_over().petal_fold(
        &cases::petal_points_op(&first.turn_over(), &marks),
        &VertexChoices::default(),
    ));
    let op = PetalFold {
        hinge: PetalHinge::Points {
            from: marks.ends[0],
            to: marks.ends[1],
        },
        petal: cases::seen_bottom(first, marks.petal),
        direction: Direction::Mountain,
    };
    let mountain = landed(first.petal_fold(&op, &VertexChoices::default()));
    check(first, &mountain);
    assert_eq!(facts(&mountain.state), facts(&valley.state));
}

/// H through two points that misses the flap, crosses it from a folded edge
/// to a raw one, sits too near its closed end for the kite creases to meet
/// at its open corner, or has no length: each refused by code and cause,
/// with the detail that tells them apart, naming the flap's faces (the
/// paper beyond the corner, past it).
#[test]
fn a_hinge_through_two_points_that_gives_no_petal_is_refused() {
    let marks = cases::petal_marks(false);
    let base = cases::preliminary(false).last().clone();
    let points = |from: [f64; 2], to: [f64; 2]| PetalFold {
        hinge: PetalHinge::Points { from, to },
        ..cases::petal_points_op(&base, &marks)
    };
    // Below the whole flap.
    let misses = refusal(&base, &points([0.0, -0.1], [0.5, -0.1]));
    let FoldRefusal::PetalNoFlap {
        faces,
        cause: NoPetal::NoEnds,
        detail: Some(NoPetalDetail::MissesFlap),
    } = &misses
    else {
        panic!("{misses:?}");
    };
    assert_eq!(faces.len(), 2);
    let json = serde_json::to_value(&misses).unwrap_or_default();
    assert_eq!(json["code"], "petal_no_flap");
    assert_eq!(json["cause"], "no_ends");
    assert_eq!(json["detail"], serde_json::json!({ "kind": "misses_flap" }));
    // From the closed edge on y = 1/2 to the raw edge on x = 0: one end.
    let one_end = refusal(&base, &points([0.1, 0.5], [0.0, 0.3]));
    assert!(
        matches!(
            one_end,
            FoldRefusal::PetalNoFlap {
                cause: NoPetal::NoEnds,
                detail: None,
                ..
            }
        ),
        "{one_end:?}"
    );
    let json = serde_json::to_value(&one_end).unwrap_or_default();
    assert!(json.get("detail").is_none(), "{json}");
    // Nearer the closed point than the bird base's H: the bisectors meet
    // above the open corner, and the flap reaches past them.
    let past = refusal(&base, &points([0.4, 0.5], [0.5, 0.4]));
    let FoldRefusal::PetalNoFlap {
        faces,
        cause: NoPetal::NoCorner,
        detail: Some(NoPetalDetail::PastCorner { corner }),
    } = &past
    else {
        panic!("{past:?}");
    };
    assert!(!faces.is_empty());
    assert!(corner[0] > 0.01 && corner[1] > 0.01, "{corner:?}");
    let json = serde_json::to_value(&past).unwrap_or_default();
    assert_eq!(json["code"], "petal_no_flap");
    assert_eq!(json["detail"]["kind"], "past_corner");
    // Two points closer than the minimum feature name no line.
    assert!(matches!(
        refusal(&base, &points([0.3, 0.5], [0.3, 0.5 - 1e-5])),
        FoldRefusal::PetalNoFlap {
            cause: NoPetal::NoEnds,
            detail: None,
            ..
        }
    ));
}

/// H anywhere along the closed edges, through two points: nearer the open
/// corner than the bird base's, the kite creases meet beyond the paper and
/// the fold lands, a valid state its motion places; nearer the closed point,
/// the flap reaches past them and is refused. Nothing else happens.
#[test]
fn h_through_two_points_along_the_flap_lands_or_is_refused_past_the_corner() {
    let (base, ops) = cases::petal_sweep();
    let t22 = cases::bird_base_share();
    let (mut landed_count, mut past_count) = (0, 0);
    for (s, op) in ops {
        match base.petal_fold(&op, &VertexChoices::default()) {
            Ok(outcome) => {
                for folded in vertex::cases::every(Ok(outcome)) {
                    check(&base, &folded);
                }
                assert!(s < t22, "landed at {s}");
                landed_count += 1;
            }
            Err(CompoundRefused::Refused(refused)) => {
                assert!(
                    matches!(
                        refused.refusal,
                        FoldRefusal::PetalNoFlap {
                            cause: NoPetal::NoCorner,
                            detail: Some(NoPetalDetail::PastCorner { .. }),
                            ..
                        }
                    ),
                    "{s}: {:?}",
                    refused.refusal
                );
                assert!(s > t22, "refused at {s}");
                past_count += 1;
            }
            Err(other) => panic!("{s}: {other}"),
        }
    }
    eprintln!("{landed_count} landed, {past_count} past the corner");
    assert!(landed_count > 0 && past_count > 0);
}

/// Whether the model points `a` and `b` are the same, to a hair.
fn near(a: [f64; 2], b: [f64; 2]) -> bool {
    (a[0] - b[0]).hypot(a[1] - b[1]) < 1e-9
}

/// The side of the sheet the viewer sees at the model point `p`.
fn seen_side(state: &State, p: [f64; 2]) -> bool {
    let mut stack = state.stack_at(p).unwrap_or_default();
    if state.view().flipped {
        stack.reverse();
    }
    let top = *stack.first().unwrap_or_else(|| panic!("nothing at {p:?}"));
    state
        .front_up(top)
        .unwrap_or_else(|| panic!("no side for {top}"))
}

/// The frog base's petal fold, on the preliminary base's front flap
/// squashed open: a doubled flap, whose top layer ends at a raw edge across
/// it while the layer under it runs on to the open corner. Over the usual
/// precreases (the lower edges folded to the centre line through both
/// layers), H through two points lands, the only order: each layer folds
/// on its own kite — the top layer's to its own corner, the second's on to
/// the open corner, the pair flat at H's ends — and the flap shows its top
/// layer's side all over, inside the same outline. With the top layer's own
/// kite precreased instead, the second layer's is scored as its partner, and
/// the same creases fold.
#[test]
fn a_petal_fold_of_a_squashed_flap_folds_each_layer_on_its_own_kite() {
    let marks = cases::doubled_marks();
    let squashed = cases::squashed_flap();
    let side = seen_side(&squashed, marks.petal);
    let parent = cases::lower_edges_to_centre(&squashed, &marks);
    let op = cases::doubled_petal_op(&parent, marks.ends, marks.petal);

    let analysis = parent.analyse_petal(&op).unwrap_or_else(|e| panic!("{e}"));
    assert!(near(analysis.corner, marks.corner), "{analysis:?}");
    assert!(near(analysis.second_corner, marks.open), "{analysis:?}");
    for k in 0..2 {
        let end = analysis.ends[k];
        assert!(marks.ends.iter().any(|&m| near(end, m)), "{analysis:?}");
        assert!(analysis.kites[k].distance_to_point(end) < 1e-9);
        assert!(analysis.kites[k].distance_to_point(marks.corner) < 1e-9);
        assert!(analysis.second_kites[k].distance_to_point(end) < 1e-9);
        assert!(analysis.second_kites[k].distance_to_point(marks.open) < 1e-9);
    }
    // H and the top layer's kite are scored; the second layer's refolds.
    assert!(analysis.scores_line);
    assert_eq!(analysis.scores_kites, [true, true]);

    let folded = landed(parent.petal_fold(&op, &VertexChoices::default()));
    check(&parent, &folded);
    let fold = &folded.report.fold;
    assert_eq!(fold.blocks.len(), 5);
    // The second layer's precreased kites fold again, the closed edges
    // below H's ends unfold.
    assert_eq!((fold.refolded.len(), fold.unfolded.len()), (2, 2));
    let state = &folded.state;
    let outline = |s: &State| -> ([f64; 2], [f64; 2]) {
        let points: Vec<[f64; 2]> = s
            .faces()
            .iter()
            .flat_map(|f| s.face_image(f.id).unwrap_or_default().to_vec())
            .collect();
        let lo = points
            .iter()
            .fold([f64::MAX; 2], |m, p| [m[0].min(p[0]), m[1].min(p[1])]);
        let hi = points
            .iter()
            .fold([f64::MIN; 2], |m, p| [m[0].max(p[0]), m[1].max(p[1])]);
        (lo, hi)
    };
    let (lo, hi) = outline(state);
    assert!(
        near(lo, [0.0, 0.0]) && near(hi, [0.5, 0.5]),
        "{lo:?} {hi:?}"
    );
    // The flap, H up to the closed point and down to the open corner, all
    // its top layer's side.
    for p in [
        [0.205, 0.177],
        [0.31, 0.29],
        [0.4, 0.45],
        [0.2, 0.05],
        [0.05, 0.2],
        [0.1, 0.06],
        [0.33, 0.1],
    ] {
        assert_eq!(seen_side(state, p), side, "at {p:?}");
    }

    // The top layer's own kite precreased, and nothing in the second layer.
    let mut own = squashed.clone();
    for k in 0..2 {
        let inside = [
            (marks.ends[k][0] + marks.corner[0]) / 2.0 * 0.9 + 0.025,
            (marks.ends[k][1] + marks.corner[1]) / 2.0 * 0.9 + 0.025,
        ];
        let at = cases::seen_top(&own, inside);
        own = cases::precrease(
            &own,
            marks.corner,
            marks.ends[k],
            [0.25, 0.25],
            Seed::Depth { at, layers: 1 },
        );
    }
    let op = cases::doubled_petal_op(&own, marks.ends, marks.petal);
    let analysis = own.analyse_petal(&op).unwrap_or_else(|e| panic!("{e}"));
    assert!(near(analysis.corner, marks.corner), "{analysis:?}");
    assert!(near(analysis.second_corner, marks.open), "{analysis:?}");
    let other = landed(own.petal_fold(&op, &VertexChoices::default()));
    check(&own, &other);
    assert_eq!(folded_segments(&other.state), folded_segments(state));
}

/// On the squashed flap, a petal fold the paper cannot make is still
/// refused, and as a petal fold: H nearer the closed point leaves the
/// layers' paper past their kites' corners; and H named by its precrease,
/// over kite precreases of both layers that do not fold flat together at
/// its ends, needs a kite crease that is not there — the top layer's own,
/// which the fold names — rather than folding them and failing the gate.
#[test]
fn a_petal_fold_of_a_squashed_flap_that_does_not_fold_is_refused() {
    let marks = cases::doubled_marks();
    let parent = cases::lower_edges_to_centre(&cases::squashed_flap(), &marks);
    let high = cases::doubled_petal_op(&parent, [[0.25, 0.4], [0.4, 0.25]], [0.27, 0.22]);
    assert!(
        matches!(
            refusal(&parent, &high),
            FoldRefusal::PetalNoFlap {
                cause: NoPetal::NoCorner,
                detail: Some(NoPetalDetail::PastCorner { .. }),
                ..
            }
        ),
        "{:?}",
        refusal(&parent, &high)
    );

    let at = cases::seen_top(&parent, marks.petal);
    let with_h = cases::precrease(
        &parent,
        marks.ends[0],
        marks.ends[1],
        [0.1, 0.1],
        Seed::Depth { at, layers: 1 },
    );
    let by_crease = PetalFold {
        hinge: PetalHinge::Crease {
            line: oristudio_geometry::Line::from_points(marks.ends[0], marks.ends[1])
                .unwrap_or_else(|| panic!("no H")),
        },
        ..cases::doubled_petal_op(&with_h, marks.ends, marks.petal)
    };
    let refused = refusal(&with_h, &by_crease);
    let FoldRefusal::PetalNotPrecreased {
        faces,
        missing: PetalCrease::Kite,
    } = &refused
    else {
        panic!("{refused:?}");
    };
    // The faces are the top layer's, where its own kite would run.
    let analysis = with_h
        .analyse_petal(&cases::doubled_petal_op(&with_h, marks.ends, marks.petal))
        .unwrap_or_else(|e| panic!("{e}"));
    assert!(!faces.is_empty());
    assert!(faces.iter().all(|f| analysis.top.contains(f)), "{faces:?}");
}

/// The sheet point under the model point `p` on the layer `depth` below the
/// one the viewer sees on top there.
fn seen_at(state: &State, p: [f64; 2], depth: usize) -> [f64; 2] {
    let mut stack = state.stack_at(p).unwrap_or_default();
    if state.view().flipped {
        stack.reverse();
    }
    let face = *stack
        .get(depth)
        .unwrap_or_else(|| panic!("no layer {depth} at {p:?}"));
    state.isometry(face).unwrap_or_default().inverse().apply(p)
}

/// A corner flap squashed open and its kite precreased
/// ([`squashed_corner`]), with its landmarks in the model frame.
struct SquashedCorner {
    state: State,
    /// H's ends on the squash's creases, halfway from the closed point to
    /// the corner.
    ends: [[f64; 2]; 2],
    /// The top layer's corner: the sheet's own, on the spine.
    corner: [f64; 2],
    /// The second layer's: where the sheet's raw edge x = 1 meets the spine.
    second_corner: [f64; 2],
    /// Inside the kite below H, on the top layer.
    petal: [f64; 2],
}

/// The square folded on its diagonal, the corner (0, 0) over onto (1, 1);
/// in half across that, the lower half up; the corner flap this makes — two
/// layers hinged along y = 1/2 — squashed with its spine onto the hinge
/// line; and the squashed flap's kite precreased, each lower edge of its top
/// layer folded to the spine (the upper one through the flap's top two
/// layers, the lower through every layer). The flap is a kite from the
/// closed point (1/2, 1/2) to the sheet's corner at (1/2 + √2/2, 1/2), its
/// top layer the whole kite. Its second layer ends at the sheet's raw edge
/// x = 1, short of the corner, and below the spine runs on, flat across the
/// hinge the squash unfolded, into the back layer above it.
fn squashed_corner() -> SquashedCorner {
    let (r2, t) = (std::f64::consts::SQRT_2, (std::f64::consts::PI / 8.0).tan());
    let s = cases::valley(&cases::square(), [1.0, 0.0], [0.0, 1.0], [0.2, 0.2]);
    let s = cases::valley(&s, [0.0, 0.5], [1.0, 0.5], [0.9, 0.2]);
    let s = cases::squash(&s, [0.918, 0.673]).state;
    let corner = [0.5 + r2 / 2.0, 0.5];
    let x = 0.5 + r2 / 4.0;
    let ends = [[x, 0.5 + r2 / 4.0 * t], [x, 0.5 - r2 / 4.0 * t]];
    let flap = seen_at(&s, [0.95, 0.64], 1);
    let s = cases::precrease(
        &s,
        ends[0],
        corner,
        [1.0, 0.68],
        Seed::Flaps { at: vec![flap] },
    );
    let s = cases::precrease(&s, ends[1], corner, [1.0, 0.32], Seed::All);
    SquashedCorner {
        state: s,
        ends,
        corner,
        second_corner: [1.0, 0.5],
        petal: [1.0, 0.45],
    }
}

/// The crease pattern a folder draws for [`squashed_corner`] petal folded,
/// on the sheet: H a mountain in the top layer, the top layer's kite to the
/// sheet's corner and the second layer's to where the raw edge meets the
/// spine (valleys), the squash's creases above H's ends still folded and
/// below them gone; the spine, the hinge the squash unfolded and the
/// second layer's own precreases flat.
fn squashed_corner_petal_pattern() -> (Vec<ImportSegment>, BTreeSet<vertex::Segment>) {
    let h = (1.0 - std::f64::consts::FRAC_1_SQRT_2) / 2.0;
    let r2 = std::f64::consts::SQRT_2;
    let (pl, pr) = ([0.5 + h, h], [1.0 - h, 0.5 - h]);
    let (centre, corner) = ([0.5, 0.5], [1.0, 0.0]);
    let (m, v) = (ImportKind::Mountain, ImportKind::Valley);
    let folded = [
        (v, [0.0, 1.0], centre),
        (m, [0.5, 0.0], centre),
        (v, centre, pl),
        (v, centre, pr),
        (m, pl, pr),
        (v, pl, corner),
        (v, pr, corner),
        (v, [0.5, 0.0], pl),
        (v, [1.0, 0.5], pr),
    ];
    let flat = ImportKind::Unassigned {
        hint: Some(Letter::Valley),
    };
    let square = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
    let mut segments: Vec<ImportSegment> = (0..4)
        .map(|i| ImportSegment {
            from: square[i],
            to: square[(i + 1) % 4],
            kind: ImportKind::Border,
        })
        .collect();
    for (kind, from, to) in folded {
        segments.push(ImportSegment { from, to, kind });
    }
    for (from, to) in [
        (centre, corner),
        (centre, [1.0, 0.5]),
        ([2.0 - r2, 0.0], pl),
        (pr, [1.0, r2 - 1.0]),
    ] {
        segments.push(ImportSegment {
            from,
            to,
            kind: flat,
        });
    }
    let key = |p: [f64; 2]| [(p[0] * 1e6).round() as i64, (p[1] * 1e6).round() as i64];
    let letters = folded
        .iter()
        .map(|&(kind, a, b)| {
            let letter = if kind == m {
                Letter::Mountain
            } else {
                Letter::Valley
            };
            let (a, b) = (key(a), key(b));
            if a <= b {
                (letter, a, b)
            } else {
                (letter, b, a)
            }
        })
        .collect();
    (segments, letters)
}

/// Whether two states of one crease pattern are the same folded form: one
/// rigid motion of the model frame takes each face of `ours` onto the face
/// of `theirs` under the same sheet points, and every two faces of `ours`
/// that overlap stack as the faces of `theirs` under them do. `ours` may
/// have flat creases `theirs` has not.
fn same_folded_form(ours: &State, theirs: &State) {
    let sheet = |s: &State, f: FaceId| -> Vec<[f64; 2]> {
        s.face(f)
            .unwrap_or_else(|| panic!("no face {f}"))
            .ring
            .iter()
            .map(|v| s.vertices()[v.0 as usize])
            .collect()
    };
    let at = |s: &State, p: [f64; 2]| s.face_at(p).unwrap_or_else(|| panic!("no paper at {p:?}"));
    let iso = |s: &State, f: FaceId| s.isometry(f).unwrap_or_default();
    let probe = ours.faces()[0].id;
    let p = convex::centroid(&sheet(ours, probe)).unwrap_or_default();
    // Ours to theirs.
    let phi = iso(theirs, at(theirs, p)).after(&iso(ours, probe).inverse());
    for face in ours.faces() {
        let p = convex::centroid(&sheet(ours, face.id)).unwrap_or_default();
        let [x, y] = phi.apply(iso(ours, face.id).apply(p));
        let [u, w] = iso(theirs, at(theirs, p)).apply(p);
        assert!(
            (x - u).hypot(y - w) < 1e-9,
            "face {} lies elsewhere",
            face.id
        );
    }
    let mut pairs = 0;
    for (pair, above) in ours.order().pairs() {
        let (f, g) = (pair.lo(), pair.hi());
        let (Some(fi), Some(gi)) = (ours.face_image(f), ours.face_image(g)) else {
            continue;
        };
        let overlap = convex::clip(fi, gi);
        if convex::signed_area(&overlap).abs() < 1e-9 {
            continue;
        }
        let m = convex::centroid(&overlap).unwrap_or_default();
        let (pf, pg) = (
            iso(ours, f).inverse().apply(m),
            iso(ours, g).inverse().apply(m),
        );
        let (tf, tg) = (at(theirs, pf), at(theirs, pg));
        let ours_above = above.unwrap_or_else(|| panic!("{pair:?} undetermined"));
        let theirs_above = theirs
            .above(tf, tg)
            .unwrap_or_else(|| panic!("{tf} {tg} unstacked"));
        // A turned-over frame stacks the other way up.
        assert_eq!(
            ours_above,
            theirs_above == phi.front_up(),
            "faces {f} and {g} stack the other way"
        );
        pairs += 1;
    }
    assert!(pairs > 0);
}

/// The petal fold of a squashed corner whose second layer runs on, flat,
/// into the back layer at one end ([`squashed_corner`]): each end's
/// second-layer kite crease folds the paper across that end's closed edge
/// alone, so the back layer stays put rather than fold on the other end's
/// kite (refused before as needing H precreased, naming it). It lands the
/// only order: the crease pattern a folder draws for it, folded as that
/// pattern's one flat state.
#[test]
fn a_petal_fold_of_a_squashed_corner_folds_each_end_on_its_own_second_layer() {
    let c = squashed_corner();
    let parent = &c.state;
    let op = cases::doubled_petal_op(parent, c.ends, c.petal);
    let analysis = parent.analyse_petal(&op).unwrap_or_else(|e| panic!("{e}"));
    assert!(near(analysis.corner, c.corner), "{analysis:?}");
    assert!(
        near(analysis.second_corner, c.second_corner),
        "{analysis:?}"
    );
    assert!(analysis.scores_line);
    // The back layer above the spine: the sheet above its diagonal and y = 1/2.
    let back = parent
        .face_at([0.25, 0.9])
        .unwrap_or_else(|| panic!("no back"));
    assert!(analysis.second.contains(&back));

    let folded = landed(parent.petal_fold(&op, &VertexChoices::default()));
    check(parent, &folded);
    let state = &folded.state;
    assert_eq!(folded.report.fold.blocks.len(), 5);
    assert!(
        folded.report.fold.blocks.iter().flatten().all(|&f| {
            let lineage = state.face(f).and_then(|f| f.parent).unwrap_or(f);
            lineage != back
        }),
        "the back layer moves"
    );
    assert_eq!(state.isometry(back), parent.isometry(back));

    let (segments, want) = squashed_corner_petal_pattern();
    assert_eq!(folded_segments(state), want);
    let pattern = ImportedPattern::new(
        &CreasePatternInput {
            space: ImportSpace::Sheet,
            segments,
        },
        ImportTarget::Empty {
            start: StartSide::Front,
        },
    )
    .unwrap_or_else(|e| panic!("{e}"));
    let completions = pattern
        .complete(&CompletionLimits::default())
        .unwrap_or_else(|e| panic!("{e}"));
    assert!(completions.is_unique(), "{:?}", completions.count());
    let order = completions
        .order(&vec![0; completions.components().len()])
        .unwrap_or_default();
    let theirs = pattern.state(order).unwrap_or_else(|e| panic!("{e}"));
    same_folded_form(state, &theirs);
}
