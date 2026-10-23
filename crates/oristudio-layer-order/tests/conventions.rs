//! The sign conventions, pinned on states built by hand (the core spike's
//! `test-golden.mjs`, research §3.1): single valley and mountain folds from
//! the front and the back, two layers, the top layer's corner; negative
//! controls; a valid woven state; and the incremental rebuild.

mod support;

use std::collections::BTreeSet;

use oristudio_layer_order::{
    Constraint, ConstraintProblem, Edge, EdgeKind, Face, FaceId, FacePair, FoldedView, LayerOrder,
    LayerOrderError, Letter, Scope, Violation, check, check_problem, derived_letter,
};
use support::{IDENTITY, Sheet, compose, order, rect, reflect_x, reflect_y, reflection, stack};

const V: EdgeKind = EdgeKind::Folded(Some(Letter::Valley));
const M: EdgeKind = EdgeKind::Folded(Some(Letter::Mountain));

fn f(id: u32) -> FaceId {
    FaceId(id)
}

fn pair(a: u32, b: u32) -> FacePair {
    FacePair::new(f(a), f(b)).unwrap_or_else(|| panic!("{a} = {b}"))
}

fn assert_valid(name: &str, view: &FoldedView, order: &LayerOrder) {
    let report = check(view, order);
    assert!(report.is_valid(), "{name}: {:?}", report.violations);
}

fn letters(view: &FoldedView, order: &LayerOrder) -> Vec<Option<Letter>> {
    (0..view.edges().len())
        .map(|e| derived_letter(view, order, e))
        .collect()
}

/// G1/G2: the unit square folded in half at x = 0.5, the right half moving.
/// Face 0 is the left half, face 1 the right.
fn half(kind: EdgeKind) -> FoldedView {
    Sheet::default()
        .face(0, rect(0.0, 0.0, 0.5, 1.0), IDENTITY)
        .face(1, rect(0.5, 0.0, 1.0, 1.0), reflect_x(0.5))
        .edge(0, 1, [[0.5, 0.0], [0.5, 1.0]], kind)
        .view()
}

/// G3/G4: turned over first (the view reflected across x = 0.5), then the
/// half on the viewer's right, the sheet's left half, folded at x = 0.5.
fn half_from_the_back(kind: EdgeKind) -> FoldedView {
    let turn = reflect_x(0.5);
    Sheet::default()
        .face(0, rect(0.0, 0.0, 0.5, 1.0), compose(&reflect_x(0.5), &turn))
        .face(1, rect(0.5, 0.0, 1.0, 1.0), turn)
        .edge(0, 1, [[0.5, 0.0], [0.5, 1.0]], kind)
        .view()
}

/// G5/G6: folded in half (valley, x = 0.5), then the top half (y > 0.5)
/// folded through both layers. Faces: 0 the lower left, 1 the lower right,
/// 2 the upper right, 3 the upper left; creases x = 0.5 (both halves), then
/// the left and right chords.
fn quarters(chords: [EdgeKind; 2]) -> FoldedView {
    let r = reflect_x(0.5);
    let t = reflect_y(0.5);
    Sheet::default()
        .face(0, rect(0.0, 0.0, 0.5, 0.5), IDENTITY)
        .face(1, rect(0.5, 0.0, 1.0, 0.5), r)
        .face(2, rect(0.5, 0.5, 1.0, 1.0), compose(&t, &r))
        .face(3, rect(0.0, 0.5, 0.5, 1.0), t)
        .edge(0, 1, [[0.5, 0.0], [0.5, 0.5]], V)
        .edge(3, 2, [[0.5, 0.5], [0.5, 1.0]], V)
        .edge(0, 3, [[0.0, 0.5], [0.5, 0.5]], chords[0])
        .edge(1, 2, [[0.5, 0.5], [1.0, 0.5]], chords[1])
        .view()
}

/// G7: G5, then the top layer's corner (the upper left quarter's sheet
/// corner (0, 1), at folded (0, 0)) valley-folded along the folded line
/// through (0, 0.1) and (0.1, 0). The upper left quarter becomes 5 (the
/// rest) and 6 (the corner).
fn corner() -> FoldedView {
    let r = reflect_x(0.5);
    let t = reflect_y(0.5);
    let fold = reflection([0.0, 0.1], [0.1, 0.0]);
    Sheet::default()
        .face(0, rect(0.0, 0.0, 0.5, 0.5), IDENTITY)
        .face(1, rect(0.5, 0.0, 1.0, 0.5), r)
        .face(2, rect(0.5, 0.5, 1.0, 1.0), compose(&t, &r))
        .face(
            5,
            vec![[0.0, 0.5], [0.5, 0.5], [0.5, 1.0], [0.1, 1.0], [0.0, 0.9]],
            t,
        )
        .face(
            6,
            vec![[0.0, 0.9], [0.1, 1.0], [0.0, 1.0]],
            compose(&fold, &t),
        )
        .edge(0, 1, [[0.5, 0.0], [0.5, 0.5]], V)
        .edge(5, 2, [[0.5, 0.5], [0.5, 1.0]], V)
        .edge(0, 5, [[0.0, 0.5], [0.5, 0.5]], V)
        .edge(1, 2, [[0.5, 0.5], [1.0, 0.5]], M)
        .edge(6, 5, [[0.0, 0.9], [0.1, 1.0]], M)
        .view()
}

#[test]
fn g1_valley_from_the_front() {
    let view = half(V);
    // The moving half lands on top and shows its back.
    let order = order(&[(1, 0)]);
    assert_eq!(view.front_up(f(0)), Some(true));
    assert_eq!(view.front_up(f(1)), Some(false));
    assert_valid("G1", &view, &order);
    assert_eq!(letters(&view, &order), [Some(Letter::Valley)]);
    // Each face lies on the other's front side.
    assert_eq!(order.to_fold_face_orders(&view), Ok(vec![[0, 1, 1]]));
}

#[test]
fn g2_mountain_from_the_front() {
    let view = half(M);
    let order = order(&[(0, 1)]);
    assert_valid("G2", &view, &order);
    assert_eq!(letters(&view, &order), [Some(Letter::Mountain)]);
    assert_eq!(order.to_fold_face_orders(&view), Ok(vec![[0, 1, -1]]));
}

#[test]
fn g3_g4_folds_from_the_back_store_the_other_letter() {
    // A valley as the viewer sees it, the paper's back up: the moving sheet
    // left half shows its front on top, so the crease is M.
    let view = half_from_the_back(M);
    assert_eq!(view.front_up(f(0)), Some(true));
    assert_eq!(view.front_up(f(1)), Some(false));
    let valley_seen = order(&[(0, 1)]);
    assert_valid("G3", &view, &valley_seen);
    assert_eq!(letters(&view, &valley_seen), [Some(Letter::Mountain)]);

    // And a mountain seen from the back is V.
    let view = half_from_the_back(V);
    let mountain_seen = order(&[(1, 0)]);
    assert_valid("G4", &view, &mountain_seen);
    assert_eq!(letters(&view, &mountain_seen), [Some(Letter::Valley)]);

    // Turning the model over inverts every `above` and keeps the letter and
    // the FOLD triples.
    let turn = reflect_x(0.5);
    let turned = Sheet::default()
        .face(
            0,
            rect(0.0, 0.0, 0.5, 1.0),
            compose(&turn, &compose(&reflect_x(0.5), &turn)),
        )
        .face(1, rect(0.5, 0.0, 1.0, 1.0), compose(&turn, &turn))
        .edge(0, 1, [[0.5, 0.0], [0.5, 1.0]], V)
        .view();
    let turned_order = mountain_seen.turned_over();
    assert_valid("G4b", &turned, &turned_order);
    assert_eq!(letters(&turned, &turned_order), [Some(Letter::Valley)]);
    assert_eq!(
        turned_order.to_fold_face_orders(&turned),
        mountain_seen.to_fold_face_orders(&view)
    );
}

#[test]
fn g5_valley_through_two_layers_alternates_the_new_letters() {
    let view = quarters([V, M]);
    let order = stack(&[0, 1, 2, 3]);
    assert_valid("G5", &view, &order);
    // The x = 0.5 creases stay V; the new chord is V on the front-up layer
    // and M on the face-down one.
    assert_eq!(
        letters(&view, &order),
        [V, V, V, M].map(|k| match k {
            EdgeKind::Folded(l) => l,
            EdgeKind::Flat => None,
        })
    );
    // Both pairs of creases run along one line with their faces on one side:
    // two taco-tacos.
    let problem = ConstraintProblem::build(&view);
    let tacos = problem
        .constraints()
        .iter()
        .filter(|c| matches!(c, Constraint::TacoTaco(_)))
        .count();
    assert_eq!(tacos, 2);
    assert_eq!(problem.variables().len(), 6);
    assert!(problem.ambiguities().is_empty());

    // The moving pair keeps its FOLD triple while its absolute order
    // reverses: G1's (left, right) is G5's (upper left, upper right).
    let g1 = half(V);
    let g1_order = support::order(&[(1, 0)]);
    let triple = |view: &FoldedView, order: &LayerOrder, a: u32, b: u32| {
        let a_above = order
            .above(f(a), f(b))
            .unwrap_or_else(|| panic!("unordered"));
        a_above == view.front_up(f(b)).unwrap_or_else(|| panic!("no face"))
    };
    assert_eq!(triple(&view, &order, 3, 2), triple(&g1, &g1_order, 0, 1));
    assert_eq!(triple(&view, &order, 2, 3), triple(&g1, &g1_order, 1, 0));
    assert_ne!(order.above(f(3), f(2)), g1_order.above(f(0), f(1)));
}

#[test]
fn g6_mountain_through_two_layers() {
    let view = quarters([M, V]);
    let order = stack(&[2, 3, 0, 1]);
    assert_valid("G6", &view, &order);
    assert_eq!(
        letters(&view, &order),
        [
            Some(Letter::Valley),
            Some(Letter::Valley),
            Some(Letter::Mountain),
            Some(Letter::Valley)
        ]
    );
}

#[test]
fn g7_the_top_layers_corner_is_a_mountain() {
    let view = corner();
    assert_eq!(view.front_up(f(6)), Some(true));
    let order = stack(&[0, 1, 2, 5, 6]);
    assert_valid("G7", &view, &order);
    assert_eq!(derived_letter(&view, &order, 4), Some(Letter::Mountain));
    // The corner's crease runs through the three layers under it.
    let problem = ConstraintProblem::build(&view);
    for h in [0, 1, 2] {
        assert!(
            problem
                .constraints()
                .contains(&Constraint::TacoTortilla([f(5), f(6), f(h)])),
            "{h}"
        );
    }
    assert_eq!(problem.variables().len(), 10);
}

#[test]
fn g12_a_rectangle() {
    let view = Sheet::default()
        .face(0, rect(0.0, 0.0, 1.0, 1.0), IDENTITY)
        .face(1, rect(1.0, 0.0, 2.0, 1.0), reflect_x(1.0))
        .edge(0, 1, [[1.0, 0.0], [1.0, 1.0]], V)
        .view();
    assert_valid("G12", &view, &order(&[(1, 0)]));
}

#[test]
fn negative_controls_name_the_faces() {
    let view = quarters([V, M]);
    let valid = stack(&[0, 1, 2, 3]);

    // Every single-pair flip is caught, and the report names both faces.
    for (p, lo_above) in valid.pairs() {
        let mut flipped = valid.clone();
        let (upper, lower) = match lo_above {
            Some(true) => (p.hi(), p.lo()),
            _ => (p.lo(), p.hi()),
        };
        assert!(flipped.set_above(upper, lower).is_ok());
        let report = check(&view, &flipped);
        assert!(!report.is_valid(), "flipping {p} passed");
        let named = report.faces();
        assert!(
            named.contains(&p.lo()) && named.contains(&p.hi()),
            "{p}: {:?}",
            report.violations
        );
    }

    // A dropped pair is missing.
    let mut dropped = valid.clone();
    assert!(dropped.remove(f(0), f(3)));
    assert_eq!(
        check(&view, &dropped).violations,
        [Violation::MissingPair { pair: pair(0, 3) }]
    );

    // An undetermined pair is reported as such.
    let mut open = valid.clone();
    assert!(open.set_undetermined(f(1), f(2)).is_ok());
    assert_eq!(
        check(&view, &open).violations,
        [Violation::UndeterminedPair { pair: pair(1, 2) }]
    );

    // A flipped letter: the right chord stored V.
    let lettered = quarters([V, V]);
    assert_eq!(
        check(&lettered, &valid).violations,
        [Violation::LetterMismatch {
            edge: 3,
            faces: [f(1), f(2)],
            letter: Letter::Valley,
            derived: Letter::Mountain
        }]
    );

    // An order on faces that do not overlap: a precreased sheet, flat.
    let flat = Sheet::default()
        .face(0, rect(0.0, 0.0, 0.5, 1.0), IDENTITY)
        .face(1, rect(0.5, 0.0, 1.0, 1.0), IDENTITY)
        .edge(0, 1, [[0.5, 0.0], [0.5, 1.0]], EdgeKind::Flat)
        .view();
    assert_valid("G8", &flat, &LayerOrder::new());
    assert_eq!(
        check(&flat, &order(&[(0, 1)])).violations,
        [Violation::ExtraPair { pair: pair(0, 1) }]
    );
}

#[test]
fn a_wrapped_hinge_breaks_taco_tortilla() {
    // G7's corner tucked under the second layer instead: the crease 5-6 then
    // wraps through faces 1 and 2, which lie between its faces.
    let view = corner();
    let order = stack(&[0, 6, 1, 2, 5]);
    let report = check(&view, &order);
    for h in [1, 2] {
        assert!(
            report.violations.contains(&Violation::TacoTortilla {
                faces: [f(5), f(6), f(h)]
            }),
            "{:?}",
            report.violations
        );
    }
    assert!(!report.violations.contains(&Violation::TacoTortilla {
        faces: [f(5), f(6), f(0)]
    }));
}

#[test]
fn interleaved_tacos_break_taco_taco() {
    // G5 with the upper pair slid between the lower one: Ls, Rm, Rs, Lm.
    let view = quarters([V, M]);
    let report = check(&view, &stack(&[0, 2, 1, 3]));
    assert!(
        report.violations.contains(&Violation::TacoTaco {
            faces: [f(0), f(1), f(2), f(3)]
        }),
        "{:?}",
        report.violations
    );
}

/// A strip wound once around a square: four segments, each folded on top of
/// the last at a 45° crease, and the last tucked under the first. Pairwise
/// overlaps only at the corners, so no cell holds three faces and the cyclic
/// order is valid; there is no stack it could be read from.
fn woven_strip() -> FoldedView {
    let face = |id: u32, polygon: Vec<[f64; 2]>, front_up| Face {
        id: f(id),
        polygon,
        front_up,
    };
    let crease = |a: u32, b: u32, segment| Edge {
        faces: [f(a), f(b)],
        segment,
        kind: EdgeKind::Folded(None),
    };
    FoldedView::new(
        vec![
            face(
                1,
                vec![[0.0, 0.0], [5.0, 0.0], [4.0, 1.0], [0.0, 1.0]],
                true,
            ),
            face(
                2,
                vec![[4.0, 1.0], [4.0, -4.0], [5.0, -3.0], [5.0, 0.0]],
                false,
            ),
            face(
                3,
                vec![[1.0, -4.0], [4.0, -4.0], [5.0, -3.0], [0.0, -3.0]],
                true,
            ),
            face(
                4,
                vec![[0.0, -3.0], [1.0, -4.0], [1.0, 1.0], [0.0, 1.0]],
                false,
            ),
        ],
        vec![
            crease(1, 2, [[5.0, 0.0], [4.0, 1.0]]),
            crease(2, 3, [[4.0, -4.0], [5.0, -3.0]]),
            crease(3, 4, [[0.0, -3.0], [1.0, -4.0]]),
        ],
    )
    .unwrap_or_else(|e| panic!("{e}"))
}

#[test]
fn a_woven_state_with_a_cyclic_order_is_valid() {
    let view = woven_strip();
    let woven = order(&[(2, 1), (3, 2), (4, 3), (1, 4)]);
    assert_valid("woven", &view, &woven);
    let problem = ConstraintProblem::build(&view);
    assert_eq!(
        problem.variables(),
        [pair(1, 2), pair(1, 4), pair(2, 3), pair(3, 4)]
    );
    assert!(problem.overlay().cells().iter().all(|c| c.faces.len() <= 2));
    // 1 < 2 < 3 < 4 < 1: no face is below all the others it overlaps.
    for face in 1..=4 {
        let below_all = problem
            .variables()
            .iter()
            .filter(|p| p.contains(f(face)))
            .all(|p| {
                woven.above(f(face), if p.lo() == f(face) { p.hi() } else { p.lo() }) == Some(false)
            });
        assert!(!below_all, "{face}");
    }
    assert_eq!(
        letters(&view, &woven),
        [
            Some(Letter::Valley),
            Some(Letter::Mountain),
            Some(Letter::Valley)
        ]
    );
    // FOLD carries it unchanged.
    let triples = woven.to_fold_face_orders(&view).unwrap_or_default();
    assert_eq!(
        LayerOrder::from_fold_face_orders(&triples, &view),
        Ok(woven.clone())
    );
    // Laid over the start instead, it is a stack, and also valid.
    assert_valid("unwoven", &view, &order(&[(2, 1), (3, 2), (4, 3), (4, 1)]));
}

#[test]
fn a_cycle_inside_one_cell_is_reported() {
    let view = Sheet::default()
        .face(0, rect(0.0, 0.0, 1.0, 1.0), IDENTITY)
        .face(1, rect(0.0, 0.0, 1.0, 1.0), IDENTITY)
        .face(2, rect(0.0, 0.0, 1.0, 1.0), IDENTITY)
        .view();
    let report = check(&view, &order(&[(1, 0), (2, 1), (0, 2)]));
    assert_eq!(
        report.violations,
        [Violation::CellCycle {
            faces: [f(0), f(2), f(1)],
            cell: 0
        }]
    );
}

#[test]
fn incremental_rebuild_equals_a_full_build() {
    // G5 to G7: the top layer (3) is split into 5 and 6; faces 0, 1 and 2
    // and the creases among them are untouched.
    let before = ConstraintProblem::build(&quarters([V, M]));
    let after = corner();
    let full = ConstraintProblem::build(&after);
    assert_eq!(before.rebuild(&after, &BTreeSet::new()), full);
    assert_eq!(before.rebuild(&after, &BTreeSet::from([f(3)])), full);

    // Touching unchanged faces changes nothing.
    for touched in [vec![], vec![0], vec![2, 6], vec![0, 1, 2, 5, 6]] {
        let touched: BTreeSet<FaceId> = touched.into_iter().map(f).collect();
        assert_eq!(full.rebuild(&after, &touched), full, "{touched:?}");
    }
}

#[test]
fn a_scoped_check_sees_only_the_touched_faces() {
    let view = corner();
    let problem = ConstraintProblem::build(&view);
    // Swap the bottom two layers (a letter mismatch on 0-1) and tuck the
    // corner under its own layer (a letter mismatch on 5-6).
    let order = stack(&[1, 0, 2, 6, 5]);
    let report = |scope| {
        check_problem(&problem, &view, &order, scope)
            .unwrap_or_else(|e| panic!("{e}"))
            .faces()
    };
    let all = report(Scope::All);
    assert!(all.contains(&f(0)) && all.contains(&f(6)));
    let touched = BTreeSet::from([f(6)]);
    let scoped = report(Scope::Faces(&touched));
    assert!(
        scoped.contains(&f(6)) && !scoped.contains(&f(0)),
        "{scoped:?}"
    );

    // A problem checks only the view it was built from.
    assert_eq!(
        check_problem(&problem, &quarters([V, M]), &order, Scope::All),
        Err(LayerOrderError::ProblemMismatch)
    );
}
