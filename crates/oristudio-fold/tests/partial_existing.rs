//! Existing crease reuse must preserve material geometry and selected layers,
//! not just the outline, and full M/V folds must still order that material.
mod support;

use Direction::{Mountain, Valley};
use oristudio_fold::{CreaseKind, Direction, Extent, Letter, Sheet, StartSide, State};
use support::*;

#[test]
fn bounded_reversal_then_mountain_and_valley_refolds_on_either_paper_side() {
    for start in [StartSide::Front, StartSide::Back] {
        for direction in [Valley, Mountain] {
            let flat = State::flat(Sheet::square(), start).unwrap();
            let before = precrease(&flat, &all(x_eq(0.5), [0.75, 0.5], direction.opposite())).state;
            let op = all(x_eq(0.5), [0.75, 0.5], direction);
            let expected = precrease(&before, &op).state;
            for extent in [
                Extent::Segment {
                    from: [0.5, 0.8],
                    to: [0.5, 0.2],
                },
                Extent::Pinch {
                    at: [0.5, 0.5],
                    length: 0.6,
                },
            ] {
                let result = before.precrease_extent(&op, &extent).unwrap();
                let after = &result.state;
                assert_valid(after);
                assert!(after.crease_marks().is_empty());
                assert_eq!(after.faces().len(), before.faces().len());
                assert_eq!(after.parts().order, before.parts().order);
                assert_eq!(after.view(), before.view());
                assert_eq!(after.vertices().len(), before.vertices().len() + 2);
                assert_eq!(after.creases().len(), before.creases().len() + 2);
                for f in before.faces() {
                    assert_eq!(after.isometry(f.id), before.isometry(f.id));
                }
                for y in [0.1, 0.9] {
                    assert_eq!(kind_at(after, [0.5, y]), kind_at(&before, [0.5, y]));
                }
                assert_eq!(kind_at(after, [0.5, 0.5]), kind_at(&expected, [0.5, 0.5]));
                assert!(after.creases().iter().all(|c| c.made_at <= before.step()));
                assert_eq!(before.crease_diff(after).reversed.len(), 1);
                // Repeating the same letter does not need more subdivisions.
                let again = after.precrease_extent(&op, &extent).unwrap().state;
                assert_eq!(again.creases(), after.creases());
                assert_eq!(again.vertices(), after.vertices());
                for fold_direction in [Valley, Mountain] {
                    let landed = fold(after, &all(x_eq(0.5), [0.75, 0.5], fold_direction));
                    assert_valid(&landed.state);
                    assert!(landed.report.created.is_empty());
                    assert_eq!(landed.report.refolded.len(), 3);
                    assert_eq!(landed.state.creases().len(), after.creases().len());
                    let moving = face(after, [0.75, 0.5]);
                    let still = face(after, [0.25, 0.5]);
                    assert_eq!(
                        landed
                            .state
                            .view()
                            .seen_above(above(&landed.state, moving, still)),
                        fold_direction == Valley
                    );
                }
                // Later folds across the inserted vertices still share one topology.
                assert_valid(&fold(after, &all(y_eq(0.2), [0.25, 0.1], Valley)).state);
            }
        }
    }
}

#[test]
fn existing_crease_reuse_respects_depth_and_front_relative_letters() {
    let flat = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let book = fold(&flat, &all(x_eq(0.5), [0.75, 0.5], Valley)).state;
    let before = precrease(&book, &all(x_eq(0.25), [0.1, 0.5], Mountain)).state;
    for direction in [Valley, Mountain] {
        let at = if direction == Valley {
            [0.9, 0.5]
        } else {
            [0.1, 0.5]
        };
        let op = depth(x_eq(0.25), [0.1, 0.5], direction, at, 1);
        let after = before
            .precrease_extent(
                &op,
                &Extent::Segment {
                    from: [0.25, 0.2],
                    to: [0.25, 0.8],
                },
            )
            .unwrap()
            .state;
        assert_valid(&after);
        assert_eq!(after.parts().order, before.parts().order);
        assert!(after.crease_marks().is_empty());
        let changed = if direction == Valley {
            [0.75, 0.5]
        } else {
            [0.25, 0.5]
        };
        let untouched = if direction == Valley {
            [0.25, 0.5]
        } else {
            [0.75, 0.5]
        };
        // Both selected operations leave an M on their respective material side.
        assert_eq!(
            kind_at(&after, changed),
            CreaseKind::Flat(Letter::Mountain),
            "{direction:?} changed={changed:?} before={:?} after={:?}",
            before.creases(),
            after.creases()
        );
        assert_eq!(kind_at(&after, untouched), kind_at(&before, untouched));
    }
}

#[test]
fn short_remainder_is_refused_without_mutating_parent() {
    let flat = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let op = all(x_eq(0.5), [0.75, 0.5], Valley);
    let before = precrease(&flat, &op).state;
    let result = before.precrease_extent(
        &all(x_eq(0.5), [0.75, 0.5], Mountain),
        &Extent::Segment {
            from: [0.5, 0.0001],
            to: [0.5, 0.8],
        },
    );
    assert_eq!(result.unwrap_err().refusal.code(), "short_crease");
    assert_eq!(before.creases().len(), 7);
    assert_valid(&before);
}

#[test]
fn one_extent_can_reverse_an_existing_layer_and_mark_new_material_below_it() {
    let flat = State::flat(Sheet::square(), StartSide::Front).unwrap();
    let book = fold(&flat, &all(x_eq(0.5), [0.75, 0.5], Valley)).state;
    let before = precrease(&book, &depth(x_eq(0.25), [0.1, 0.5], Valley, [0.9, 0.5], 1)).state;
    let after = before
        .precrease_extent(
            &all(x_eq(0.25), [0.1, 0.5], Mountain),
            &Extent::Pinch {
                at: [0.25, 0.5],
                length: 0.4,
            },
        )
        .unwrap()
        .state;
    assert_valid(&after);
    assert_eq!(after.faces().len(), before.faces().len());
    assert_eq!(after.parts().order, before.parts().order);
    assert_eq!(
        kind_at(&after, [0.75, 0.5]),
        CreaseKind::Flat(Letter::Valley)
    );
    let [mark] = after.crease_marks() else {
        panic!("{:?}", after.crease_marks())
    };
    assert!((mark.a[0] - 0.25).abs() < 1e-12);
    assert!((mark.length() - 0.4).abs() < 1e-12);
    assert_eq!(mark.letter, Letter::Mountain);
}
