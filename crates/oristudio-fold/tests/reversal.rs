mod support;
use oristudio_fold::{
    CreaseKind, Direction::*, Extent, Sheet, StartSide, State, reversal::restore_pose,
};
use support::*;

fn assert_pose(actual: &State, target: &State) {
    assert_valid(actual);
    assert_eq!(actual.view(), target.view());
    for f in actual.faces() {
        let points: Vec<_> = f
            .ring
            .iter()
            .map(|v| actual.vertices()[v.0 as usize])
            .collect();
        let p = oristudio_geometry::convex::centroid(&points).unwrap();
        let old = target.face_at(p).unwrap();
        assert!(
            actual
                .isometry(f.id)
                .unwrap()
                .distance_on(&target.isometry(old).unwrap(), points)
                < 1e-6
        );
    }
    for (pair, above) in actual.order().pairs() {
        let source = |f| {
            let ring: Vec<_> = actual
                .face(f)
                .unwrap()
                .ring
                .iter()
                .map(|v| actual.vertices()[v.0 as usize])
                .collect();
            target
                .face_at(oristudio_geometry::convex::centroid(&ring).unwrap())
                .unwrap()
        };
        assert_eq!(
            above,
            target.order().above(source(pair.lo()), source(pair.hi()))
        );
    }
}

#[test]
fn ranges_keep_creases_and_support_new_folds_on_both_paper_sides() {
    for side in [StartSide::Front, StartSide::Back] {
        let sheet = State::flat(Sheet::square(), side).unwrap();
        let book = fold(&sheet, &all(x_eq(0.5), [0.75, 0.5], Valley)).state;
        let quarter = fold(&book, &all(y_eq(0.5), [0.25, 0.75], Mountain)).state;
        let result = restore_pose(&quarter, &book, &[&sheet, &book, &quarter])
            .unwrap()
            .state;
        assert_pose(&result, &book);
        assert_eq!(result.creases().len(), quarter.creases().len());
        assert!(
            result
                .creases()
                .iter()
                .any(|c| matches!(c.kind, CreaseKind::Flat(_)))
        );
        let refolded = fold(&result, &all(y_eq(0.5), [0.25, 0.75], Mountain)).state;
        assert_pose(&refolded, &quarter);
        let flat = restore_pose(&result, &sheet, &[&sheet, &book, &quarter, &result])
            .unwrap()
            .state;
        assert_pose(&flat, &sheet);
        assert!(flat.creases().iter().all(|c| !c.kind.is_folded()));
        let again = restore_pose(&flat, &quarter, &[&sheet, &book, &quarter, &result, &flat])
            .unwrap()
            .state;
        assert_pose(&again, &quarter);
    }
}

#[test]
fn partial_marks_survive_and_opposite_precreases_remember_the_latest_letter() {
    let sheet = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let valley = precrease(&sheet, &all(x_eq(0.5), [0.75, 0.5], Valley)).state;
    let mountain = precrease(&valley, &all(x_eq(0.5), [0.75, 0.5], Mountain)).state;
    let marked = mountain
        .precrease_extent(
            &all(y_eq(0.3), [0.25, 0.1], Valley),
            &Extent::Pinch {
                at: [0.2, 0.3],
                length: 0.1,
            },
        )
        .unwrap()
        .state;
    let result = restore_pose(&marked, &sheet, &[&sheet, &valley, &mountain, &marked])
        .unwrap()
        .state;
    assert_pose(&result, &sheet);
    assert_eq!(kind_at(&result, [0.5, 0.2]), kind_at(&mountain, [0.5, 0.2]));
    assert_eq!(result.crease_marks(), marked.crease_marks());
}

#[test]
fn cp_graph_replacement_starts_the_history() {
    let sheet = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let old = precrease(&sheet, &all(x_eq(0.5), [0.75, 0.5], Valley)).state;
    // A replacement graph has its own identities and omits the vertical crease.
    let replacement = fold(&sheet, &all(y_eq(0.5), [0.5, 0.75], Mountain)).state;
    // A target from before the replacement brings its own creases: its pose
    // is made of them. The history starts at the replacement.
    let result = restore_pose(&replacement, &old, &[&replacement])
        .unwrap()
        .state;
    assert_pose(&result, &old);
    assert_eq!(result.faces().len(), 4);
    assert!(result.creases().iter().all(|c| !c.kind.is_folded()));
    let back = restore_pose(&result, &replacement, &[&replacement, &result])
        .unwrap()
        .state;
    assert_pose(&back, &replacement);
    // Back to the replacement from a fold made on it: the crease it omitted
    // stays gone.
    let after = fold(&replacement, &all(x_eq(0.25), [0.1, 0.25], Valley)).state;
    let unfolded = restore_pose(&after, &replacement, &[&replacement, &after])
        .unwrap()
        .state;
    assert_pose(&unfolded, &replacement);
    assert_eq!(unfolded.faces().len(), after.faces().len());
}

mod sinks;
#[test]
fn sinks_unsinks_and_changed_views_return_with_material_order_intact() {
    use oristudio_fold::{SinkChoices, SinkKind};
    use sinks::*;
    for (base, foot) in [
        (preliminary(), PRELIMINARY_FOOT),
        (waterbomb(), WATERBOMB_FOOT),
    ] {
        let sheet = State::flat(base.sheet().clone(), StartSide::Front).unwrap();
        let op = sink_op(&base, foot, 0.3, 0.0, SinkKind::Open);
        let mut folds = vec![landed(base.sink(&op, &SinkChoices::default()), "open")];
        folds.extend(closed_sinks(&base, &op));
        for folded in folds {
            let returned = restore_pose(&folded.state, &base, &[&sheet, &base, &folded.state])
                .unwrap()
                .state;
            assert_pose(&returned, &base);
            let flat = restore_pose(
                &returned,
                &sheet,
                &[&sheet, &base, &folded.state, &returned],
            )
            .unwrap()
            .state;
            assert_pose(&flat, &sheet);
            let unsunk = landed(
                folded
                    .state
                    .unsink(&unsink_op(&folded, 0.3), &SinkChoices::default()),
                "unsink",
            )
            .state;
            let back = restore_pose(
                &unsunk,
                &folded.state,
                &[&sheet, &base, &folded.state, &unsunk],
            )
            .unwrap()
            .state;
            assert_pose(&back, &folded.state);
            let turned = unsunk.turn_over();
            let back = restore_pose(
                &turned,
                &base,
                &[&sheet, &base, &folded.state, &unsunk, &turned],
            )
            .unwrap()
            .state;
            assert_pose(&back, &base);
        }
    }
}

#[test]
fn both_crimp_kinds_return_without_replaying_their_internal_legs() {
    use oristudio_fold::{CrimpFold, CrimpOutcome, ReverseChoices, ReverseKind, Seed};
    use oristudio_geometry::Line;
    let sheet = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let tri = fold(
        &sheet,
        &all(through([1.0, 0.0], [0.0, 1.0]), [0.0, 0.0], Valley),
    )
    .state;
    let first = Line::from_point_direction([0.4, 0.6], [1.0, 1.0]).unwrap();
    let second = Line::from_point_direction([0.6, 0.4], [1.0, 1.0]).unwrap();
    for kind in [ReverseKind::Inside, ReverseKind::Outside] {
        let op = CrimpFold {
            first,
            second,
            side: side(&first, [0.97, 0.06]),
            anchor: Seed::All,
            kind,
        };
        let CrimpOutcome::Landed(folded) = tri.crimp_fold(&op, &ReverseChoices::default()).unwrap()
        else {
            panic!("unique crimp")
        };
        let back = restore_pose(&folded.state, &tri, &[&sheet, &tri, &folded.state])
            .unwrap()
            .state;
        assert_pose(&back, &tri);
    }
}
