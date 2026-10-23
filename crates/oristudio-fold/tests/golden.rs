//! The sign conventions, pinned before anything random (the core spike's
//! `test-golden.mjs` G1–G12 and its negative controls, research §3.1):
//! valley and mountain from the front and the back, two layers, the top
//! layer's corner, precrease, refold, unfold, the all-moving refusal, a
//! rectangle; and the closure (i) qualifier.

mod support;

use oristudio_fold::{
    CreaseKind, Direction, Fix, FoldRefusal, Isometry, Letter, Seed, Sheet, StartSide, State,
};
use oristudio_layer_order::Violation;
use support::*;

use Direction::{Mountain, Valley};

fn square() -> State {
    State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"))
}

/// G1's book fold: x = 0.5, the right half over the left.
fn book() -> State {
    fold(&square(), &all(x_eq(0.5), [0.75, 0.5], Valley)).state
}

#[test]
fn g1_valley_from_the_front() {
    let s = book();
    assert_valid(&s);
    let (left, right) = (face(&s, [0.25, 0.5]), face(&s, [0.75, 0.5]));
    assert_eq!(s.front_up(left), Some(true));
    assert_eq!(s.front_up(right), Some(false));
    assert!(above(&s, right, left), "the moving half lands on top");
    assert_eq!(kind_at(&s, [0.5, 0.5]), V);
    let image = s.isometry(right).map(|t| t.apply([1.0, 0.0]));
    assert!(image.is_some_and(|p| close(p, [0.0, 0.0])));
    // FOLD faceOrders: each half lies on the other's front side.
    let orders = s.order().to_fold_face_orders(s.folded_view());
    let (lo, hi) = (left.min(right), left.max(right));
    assert_eq!(orders, Ok(vec![[i64::from(lo.0), i64::from(hi.0), 1]]));
}

#[test]
fn g2_mountain_from_the_front() {
    let s = fold(&square(), &all(x_eq(0.5), [0.75, 0.5], Mountain)).state;
    assert_valid(&s);
    let (left, right) = (face(&s, [0.25, 0.5]), face(&s, [0.75, 0.5]));
    assert!(!above(&s, right, left), "the moving half lands underneath");
    assert_eq!(kind_at(&s, [0.5, 0.5]), M);
}

#[test]
fn g3_g4_folds_from_the_back() {
    let t = square().turn_over();
    assert_eq!(t.seen_front_up(face(&t, [0.5, 0.5])), Some(false));
    assert!(!t.view().transform().front_up());
    // The model frame is untouched; only the view mirrors.
    assert_eq!(t.image_of([0.1, 0.2]), Some([0.1, 0.2]));
    assert!(close(t.view().transform().apply([0.1, 0.2]), [-0.1, 0.2]));

    // The viewer's right half is the sheet's left half (model x < 0.5).
    let s = fold(&t, &all(x_eq(0.5), [0.25, 0.5], Valley)).state;
    assert_valid(&s);
    let (left, right) = (face(&s, [0.25, 0.5]), face(&s, [0.75, 0.5]));
    assert_eq!(
        s.seen_front_up(left),
        Some(true),
        "the moved half shows its front"
    );
    assert_eq!(s.seen_front_up(right), Some(false));
    assert_eq!(
        s.seen_above(left, right),
        Some(true),
        "and lands on top, as seen"
    );
    assert_eq!(kind_at(&s, [0.5, 0.5]), M, "a valley from the back is M");

    let s4 = fold(&t, &all(x_eq(0.5), [0.25, 0.5], Mountain)).state;
    assert_valid(&s4);
    assert_eq!(kind_at(&s4, [0.5, 0.5]), V, "a mountain from the back is V");
    // G4b: turning over again keeps the letter and the state.
    let s5 = s4.turn_over();
    assert_eq!(kind_at(&s5, [0.5, 0.5]), V);
    assert_valid(&s5);
    assert_eq!(s5.view(), square().view());
}

/// G5's state: the book fold, then valley y = 0.5 through both layers.
fn quarters() -> (State, State) {
    let s1 = book();
    let s = fold(&s1, &all(y_eq(0.5), [0.25, 0.75], Valley)).state;
    (s1, s)
}

#[test]
fn g5_two_layers_valley() {
    let (s1, s) = quarters();
    assert_valid(&s);
    assert_eq!(s.faces().len(), 4);
    assert_eq!(kind_at(&s, [0.25, 0.5]), V);
    assert_eq!(
        kind_at(&s, [0.75, 0.5]),
        M,
        "the chord alternates with the layer's flip"
    );
    assert_eq!(kind_at(&s, [0.5, 0.25]), V);
    assert_eq!(kind_at(&s, [0.5, 0.75]), V);
    let [ls, rs, rm, lm] =
        [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]].map(|p| face(&s, p));
    let bottom_to_top = [ls, rs, rm, lm];
    for i in 0..4 {
        for j in i + 1..4 {
            assert!(above(&s, bottom_to_top[j], bottom_to_top[i]), "{i} {j}");
        }
    }
    // Moving pairs keep their FOLD triple while their absolute order
    // reverses.
    let (lp, rp) = (face(&s1, [0.25, 0.75]), face(&s1, [0.75, 0.75]));
    assert_eq!(on_front_side(&s, lm, rm), on_front_side(&s1, lp, rp));
    assert_eq!(on_front_side(&s, rm, lm), on_front_side(&s1, rp, lp));
    assert_eq!(above(&s, lm, rm), !above(&s1, lp, rp));
}

#[test]
fn g6_two_layers_mountain() {
    let s = fold(&book(), &all(y_eq(0.5), [0.25, 0.75], Mountain)).state;
    assert_valid(&s);
    assert_eq!(kind_at(&s, [0.25, 0.5]), M);
    assert_eq!(kind_at(&s, [0.75, 0.5]), V);
    let [ls, rs, rm, lm] =
        [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]].map(|p| face(&s, p));
    let bottom_to_top = [rm, lm, ls, rs];
    for i in 0..4 {
        for j in i + 1..4 {
            assert!(above(&s, bottom_to_top[j], bottom_to_top[i]), "{i} {j}");
        }
    }
}

#[test]
fn g7_the_top_layers_corner() {
    let (_, s) = quarters();
    // The top layer at folded (0.02, 0.02) is the upper-left quarter, which
    // shows its back; its sheet point there is (0.02, 0.98).
    let line = through([0.0, 0.1], [0.1, 0.0]);
    let r = fold(&s, &depth(line, [0.0, 0.0], Valley, [0.02, 0.98], 1));
    assert_valid(&r.state);
    assert_eq!(r.state.faces().len(), 5, "only the top layer split");
    assert_eq!(r.report.analysis.moving.len(), 1);
    assert_eq!(
        kind_at(&r.state, [0.05, 0.95]),
        M,
        "the top layer shows its back"
    );
}

#[test]
fn g8_precrease() {
    let r = precrease(&square(), &all(x_eq(0.5), [0.75, 0.5], Valley));
    let s = r.state;
    assert_valid(&s);
    assert_eq!(kind_at(&s, [0.5, 0.5]), CreaseKind::Flat(Letter::Valley));
    for f in s.faces() {
        let t = s.isometry(f.id).unwrap_or_default();
        assert!(t.distance_on(&Isometry::IDENTITY, [[0.0, 0.0], [1.0, 1.0]]) < 1e-12);
    }
    assert!(s.order().is_empty(), "nothing overlaps");
    assert_eq!(r.report.created.len(), 1);
    assert_eq!(s.step(), 1, "a precrease is one step");
    assert_eq!(s.crease_at([0.5, 0.5]).map(|c| c.made_at), Some(1));
}

#[test]
fn g9_refold_a_precrease() {
    let s = precrease(&square(), &all(x_eq(0.5), [0.75, 0.5], Valley)).state;
    let r = fold(&s, &all(x_eq(0.5), [0.75, 0.5], Mountain));
    assert_valid(&r.state);
    assert_eq!(kind_at(&r.state, [0.5, 0.5]), M);
    assert_eq!(r.state.vertices().len(), s.vertices().len());
    assert_eq!(r.state.creases().len(), s.creases().len());
    let [refold] = r.report.refolded.as_slice() else {
        panic!("{:?}", r.report.refolded);
    };
    assert_eq!(refold.remembered, Letter::Valley);
    assert_eq!(refold.letter, Letter::Mountain);
}

#[test]
fn g10_unfold_a_flap() {
    let s1 = book();
    // Fold the top layer back along the bend: the hinge is not adjacency, so
    // only the flap moves.
    let r = fold(&s1, &depth(x_eq(0.5), [0.25, 0.5], Valley, [0.25, 0.5], 1));
    assert_valid(&r.state);
    assert_eq!(r.report.analysis.moving.len(), 1);
    assert_eq!(
        kind_at(&r.state, [0.5, 0.5]),
        CreaseKind::Flat(Letter::Valley)
    );
    assert_eq!(r.report.unfolded.len(), 1);
    for f in r.state.faces() {
        let t = r.state.isometry(f.id).unwrap_or_default();
        assert!(t.front_up());
        assert!(t.distance_on(&Isometry::IDENTITY, [[0.0, 0.0], [1.0, 1.0]]) < 1e-12);
    }
    // The bend's own line is what the existing-crease mode folds along.
    let bend = s1.crease_at([0.5, 0.5]).map(|c| c.id);
    let line = bend.and_then(|id| s1.crease_line(id));
    assert!(line.is_some_and(|l| l.approx_eq(&x_eq(0.5))));
}

#[test]
fn g11_everything_moving_is_refused_with_pick_a_flap() {
    let everything = refused(&book(), &all(x_eq(0.5), [0.25, 0.5], Valley));
    assert_eq!(everything.refusal, FoldRefusal::NothingStays);
    let picks: Vec<&Fix> = everything
        .fixes
        .iter()
        .filter(|f| matches!(f, Fix::PickFlap { .. }))
        .collect();
    let [Fix::PickFlap { flaps }] = picks.as_slice() else {
        panic!("{:?}", everything.fixes);
    };
    // The two halves, separated by the hinge on ℓ.
    assert_eq!(flaps.len(), 2);
    assert!(!everything.fixes.contains(&Fix::OppositeDirection));
    let s = book();
    let top = face(&s, [0.75, 0.5]);
    for flap in flaps {
        let op = all(x_eq(0.5), [0.25, 0.5], Valley).with_seed(Seed::Flaps {
            at: vec![flap.witness],
        });
        if flap.faces == [top] {
            // The top flap unfolds alone.
            let r = fold(&s, &op);
            assert_eq!(r.report.analysis.moving, vec![top]);
        } else {
            // The bottom one would drag the top one along by rule (ii) and
            // move everything again; a mountain takes it alone.
            let e = refused(&s, &op);
            assert_eq!(e.refusal, FoldRefusal::NothingStays);
            assert!(e.fixes.contains(&Fix::OppositeDirection), "{:?}", e.fixes);
        }
    }
}

#[test]
fn g12_a_rectangle() {
    let sheet = Sheet::rectangle(2.0, 1.0).unwrap_or_else(|e| panic!("{e}"));
    let s = State::flat(sheet, StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let r = fold(&s, &all(x_eq(0.5), [0.75, 0.25], Valley));
    assert_valid(&r.state);
    assert_eq!(kind_at(&r.state, [0.5, 0.25]), V);
}

#[test]
fn a_sheet_started_back_up_stores_a_valley_as_m() {
    let s = State::flat(Sheet::square(), StartSide::Back).unwrap_or_else(|e| panic!("{e}"));
    let r = fold(&s, &all(x_eq(0.5), [0.75, 0.5], Valley));
    assert_valid(&r.state);
    assert_eq!(r.report.analysis.direction, Mountain);
    assert_eq!(kind_at(&r.state, [0.5, 0.5]), M);
}

/// A narrow image overlap with a resolved order is allowed; a near miss
/// that would change material topology remains guarded at the same threshold.
#[test]
fn resolved_overlaps_land_but_material_near_misses_are_refused() {
    let strip = Sheet::rectangle(1.0, 0.5).unwrap_or_else(|e| panic!("{e}"));
    let s = State::flat(strip, StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let s = fold(&s, &all(x_eq(0.3), [0.1, 0.25], Valley)).state;
    let result = fold(&s, &all(x_eq(0.79995), [0.9, 0.25], Valley));
    assert_valid(&result.state);
    assert!(
        (result
            .state
            .vertex_image(oristudio_fold::VertexId(1))
            .unwrap()[0]
            - 0.5999)
            .abs()
            < 1e-9
    );

    // A line 1e-4 from the folded layer's edge at x = 0.6 is a near miss;
    // the landmark offered is the edge's own line, which folds.
    let e = refused(&s, &all(x_eq(0.6 - 1e-4), [0.9, 0.25], Valley));
    assert_eq!(e.refusal.code(), "near_miss");
    let [Fix::UseLine { line, side }] = e.fixes.as_slice() else {
        panic!("{:?}", e.fixes);
    };
    assert!(line.approx_eq(&x_eq(0.6)));
    let landed = fold(&s, &oristudio_fold::PlainFold::new(*line, *side, Valley));
    assert_valid(&landed.state);
}

/// The closure (i) qualifier: a strip folded at y = 0.2, then its top layer
/// folded at y = 0.3. The hinge at y = 0.2 lies on the stationary side of the
/// second fold, so it joins nothing: U is the top layer alone.
#[test]
fn closure_ignores_a_hinge_on_the_stationary_side() {
    let strip = Sheet::rectangle(0.25, 1.0).unwrap_or_else(|e| panic!("{e}"));
    let s = State::flat(strip, StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let s = fold(&s, &all(y_eq(0.2), [0.1, 0.1], Valley)).state;
    // The folded layer covers y in [0.2, 0.4]; sheet y = 0.05 lands at 0.35.
    let top = face(&s, [0.1, 0.05]);
    let op = depth(y_eq(0.3), [0.1, 0.35], Valley, [0.1, 0.05], 1);
    let analysis = s.analyse_fold(&op).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(analysis.moving, vec![top]);
    assert!(analysis.added.is_empty());
    assert_eq!(
        analysis.flaps.len(),
        2,
        "the layer and the body are two flaps"
    );
    let r = fold(&s, &op);
    assert_valid(&r.state);
    assert_eq!(r.state.faces().len(), 3);
}

/// The same strip, picking the body (the bottom layer) instead: a valley
/// carries the layer lying on it along (rule (ii)), which the report names as
/// an added flap, or which a strict pick refuses with the fix to include it.
#[test]
fn the_closure_reports_the_flaps_it_adds() {
    use oristudio_fold::ClosurePolicy;

    let strip = Sheet::rectangle(0.25, 1.0).unwrap_or_else(|e| panic!("{e}"));
    let s = State::flat(strip, StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let s = fold(&s, &all(y_eq(0.2), [0.1, 0.1], Valley)).state;
    let (body, layer) = (face(&s, [0.1, 0.5]), face(&s, [0.1, 0.05]));
    let pick_body = |direction| {
        all(y_eq(0.3), [0.1, 0.35], direction).with_seed(Seed::Flaps {
            at: vec![[0.1, 0.5]],
        })
    };

    let r = fold(&s, &pick_body(Valley));
    let a = &r.report.analysis;
    assert_eq!(a.moving, vec![body.min(layer), body.max(layer)]);
    let [picked] = a.picked[..] else {
        panic!("{:?}", a.picked);
    };
    assert_eq!(a.flaps[picked].faces, vec![body]);
    let [added] = a.added[..] else {
        panic!("{:?}", a.added);
    };
    assert_eq!(a.flaps[added].faces, vec![layer]);
    assert_valid(&r.state);

    let strict = pick_body(Valley).with_closure(ClosurePolicy::Refuse);
    let e = refused(&s, &strict);
    assert_eq!(
        e.refusal,
        FoldRefusal::ClosureAddsFlaps { added: vec![added] }
    );
    assert!(e.fixes.contains(&Fix::IncludeFlaps { flaps: vec![added] }));
    // A mountain takes the body alone, so that is offered too.
    assert!(e.fixes.contains(&Fix::OppositeDirection), "{:?}", e.fixes);
    let alone = fold(&s, &pick_body(Mountain));
    assert_eq!(alone.report.analysis.moving, vec![body]);
    assert!(alone.report.analysis.added.is_empty());
}

/// A depth is counted from the side the viewer's direction implies: turned
/// over, the book fold's bottom layer is the one the viewer sees on top, and
/// a valley as seen takes it alone.
#[test]
fn a_turned_over_state_counts_depth_from_the_viewer() {
    let s = book().turn_over();
    let (left, right) = (face(&s, [0.25, 0.5]), face(&s, [0.75, 0.5]));
    assert_eq!(s.seen_above(left, right), Some(true));
    let r = fold(&s, &depth(x_eq(0.5), [0.25, 0.5], Valley, [0.25, 0.5], 1));
    assert_valid(&r.state);
    assert_eq!(r.report.analysis.moving, vec![left]);
    assert_eq!(r.report.analysis.direction, Mountain);
    assert_eq!(
        kind_at(&r.state, [0.5, 0.5]),
        CreaseKind::Flat(Letter::Valley)
    );
    // Flat again, seen from the front.
    for f in r.state.faces() {
        assert_eq!(r.state.seen_front_up(f.id), Some(true));
    }
}

// --- Negative controls on G5: the gate refuses each corruption -----------

fn corrupted(edit: impl FnOnce(&mut oristudio_fold::StateParts)) -> FoldRefusal {
    let (_, s) = quarters();
    let mut parts = s.into_parts();
    edit(&mut parts);
    match State::make(parts) {
        Ok(_) => panic!("a corrupted state passed the gate"),
        Err(e) => e,
    }
}

fn violations(refusal: &FoldRefusal) -> &[Violation] {
    match refusal {
        FoldRefusal::LayerOrder { violations } => violations,
        other => panic!("{other:?}"),
    }
}

#[test]
fn flipping_any_pair_is_refused_naming_its_faces() {
    let (_, s) = quarters();
    let pairs: Vec<_> = s.order().pairs().collect();
    assert_eq!(pairs.len(), 6);
    for (pair, lo_above) in pairs {
        let refusal = corrupted(|parts| {
            let (upper, lower) = if lo_above == Some(true) {
                (pair.hi(), pair.lo())
            } else {
                (pair.lo(), pair.hi())
            };
            assert!(parts.order.set_above(upper, lower).is_ok());
        });
        assert!(!violations(&refusal).is_empty());
        assert!(refusal.faces().contains(&pair.lo()) || refusal.faces().contains(&pair.hi()));
    }
}

#[test]
fn a_missing_pair_is_refused() {
    let refusal = corrupted(|parts| {
        let Some((pair, _)) = parts.order.pairs().next() else {
            unreachable!()
        };
        assert!(parts.order.remove(pair.lo(), pair.hi()));
    });
    assert!(
        violations(&refusal)
            .iter()
            .any(|v| matches!(v, Violation::MissingPair { .. }))
    );
}

#[test]
fn a_flipped_letter_is_refused() {
    let refusal = corrupted(|parts| {
        let Some(c) = parts.creases.iter_mut().find(|c| c.kind == M) else {
            unreachable!()
        };
        c.kind = V;
    });
    assert!(
        violations(&refusal)
            .iter()
            .any(|v| matches!(v, Violation::LetterMismatch { .. }))
    );
}

#[test]
fn a_pair_that_does_not_overlap_is_refused() {
    // Precrease the square: two faces side by side, no overlap.
    let s = precrease(&square(), &all(x_eq(0.5), [0.75, 0.5], Valley)).state;
    let mut parts = s.into_parts();
    let (a, b) = (parts.faces[0].id, parts.faces[1].id);
    assert!(parts.order.set_above(a, b).is_ok());
    let refusal = State::make(parts)
        .err()
        .unwrap_or(FoldRefusal::NothingStays);
    assert!(
        violations(&refusal)
            .iter()
            .any(|v| matches!(v, Violation::ExtraPair { .. }))
    );
}

#[test]
fn geometric_corruptions_are_refused() {
    // A folded crease made flat: its faces have opposite orientations.
    let refusal = corrupted(|parts| {
        if let Some(c) = parts.creases.iter_mut().find(|c| c.kind == V) {
            c.kind = CreaseKind::Flat(Letter::Valley);
        }
    });
    assert!(
        matches!(refusal, FoldRefusal::HingeOrientation { .. }),
        "{refusal:?}"
    );
    // A vertex inside the sheet moved off the diagonal, so the angles
    // around it no longer fold flat: the isometries no longer agree. (One on
    // its edge moved inward takes its border creases off the edge.)
    let refusal = corrupted(|parts| {
        let Some(v) = parts.vertices.iter().position(|&p| close(p, [0.5, 0.5])) else {
            unreachable!()
        };
        parts.vertices[v] = [0.51, 0.51];
    });
    assert!(
        matches!(
            refusal,
            FoldRefusal::Residual { .. }
                | FoldRefusal::NonConvexFace { .. }
                | FoldRefusal::AreaMismatch { .. }
        ),
        "{refusal:?}"
    );
    // A ring side that is no crease.
    let refusal = corrupted(|parts| parts.faces[0].ring.reverse());
    assert!(
        matches!(
            refusal,
            FoldRefusal::NonConvexFace { .. } | FoldRefusal::CreaseFaceCount { .. }
        ),
        "{refusal:?}"
    );
    // A face dropped: the rest no longer covers the sheet.
    let refusal = corrupted(|parts| {
        let root = parts.root;
        if let Some(f) = parts.faces.iter().position(|f| f.id != root) {
            parts.faces.remove(f);
        }
    });
    assert!(
        matches!(
            refusal,
            FoldRefusal::CreaseFaceCount { .. } | FoldRefusal::UnusedVertex { .. }
        ),
        "{refusal:?}"
    );
    // An unknown root.
    let refusal = corrupted(|parts| parts.root = oristudio_fold::FaceId(99));
    assert!(matches!(refusal, FoldRefusal::UnknownRoot { .. }));
}

/// Parts that every other check agrees with, but that are no flat folded
/// state of the sheet: a root map that is no rigid motion (every isometry
/// is derived from it, so they all agree), paper moved off the sheet or
/// turned on it (the area still matches), a border that is not the sheet's
/// edge, and a view that is no angle. Each was accepted once.
#[test]
fn invariant_corruptions_are_refused() {
    let root = |refusal: FoldRefusal| matches!(refusal, FoldRefusal::RootNotRigid { .. });
    // Twice the size: the layers agree, but the paper is not the sheet.
    assert!(root(corrupted(|parts| {
        parts.root_isometry = Isometry([2.0, 0.0, 0.0, 0.0, 2.0, 0.0]);
    })));
    // Sheared.
    assert!(root(corrupted(|parts| {
        parts.root_isometry = Isometry([1.0, 0.5, 0.0, 0.0, 1.0, 0.0]);
    })));
    // Not a number.
    assert!(root(corrupted(|parts| {
        parts.root_isometry.0[2] = f64::NAN;
    })));
    // Turned and moved in the model frame, the model is rigid: still a
    // state, with the same order.
    let (_, s) = quarters();
    let mut parts = s.parts().clone();
    let moved = Isometry([1.0, 0.0, 3.0, 0.0, 1.0, -2.0]).after(&Isometry::rotation(0.7));
    parts.root_isometry = moved.after(&parts.root_isometry);
    let turned = State::make(parts).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(turned.order(), s.order());

    let off_sheet = |refusal: FoldRefusal| matches!(refusal, FoldRefusal::VertexOffSheet { .. });
    // Every vertex moved off the sheet together: nothing else disagrees.
    assert!(off_sheet(corrupted(|parts| {
        for p in &mut parts.vertices {
            *p = [p[0] + 5.0, p[1] + 5.0];
        }
    })));
    // A vertex that is not a number.
    assert!(off_sheet(
        corrupted(|parts| parts.vertices[0][1] = f64::NAN)
    ));
    // A 1 × ½ sheet whose one face is the rectangle turned a quarter: the
    // same area, half of it off the sheet.
    let sheet = Sheet::rectangle(1.0, 0.5).unwrap_or_else(|e| panic!("{e}"));
    let flat = State::flat(sheet, StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let mut parts = flat.into_parts();
    parts.vertices = vec![[0.5, 0.0], [0.5, 1.0], [0.0, 1.0], [0.0, 0.0]];
    let refusal = State::make(parts).err();
    assert!(refusal.is_some_and(off_sheet));

    // A corner pulled in: its two border creases cut across the sheet.
    let mut parts = square().into_parts();
    parts.vertices[2] = [0.9, 0.9];
    let refusal = State::make(parts).err();
    assert!(
        matches!(refusal, Some(FoldRefusal::BorderOffOutline { .. })),
        "{refusal:?}"
    );

    // A view that is no angle.
    for rotation in [f64::NAN, f64::INFINITY] {
        let refusal = corrupted(|parts| parts.view.rotation = rotation);
        assert_eq!(refusal, FoldRefusal::ViewNotFinite);
    }
}
