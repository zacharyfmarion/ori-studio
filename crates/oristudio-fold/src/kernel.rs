//! The one conversion to the CP kernel's model (plan D10), behind the `kernel`
//! feature.
//!
//! Fold owns its crease pattern: stable ids, faces with their lineage, an F
//! crease that remembers its letter, the step that made each crease. The
//! kernel's [`CreasePatternModel`] holds none of that, so the boundary is
//! crossed once, here, and everything bound for Edit's world goes through it:
//! Send to Edit (FOLD text into the existing import chokepoint), the kernel's
//! `.cp` / `.ori` / `.orh` and FOLD writers, the root frame of the FOLD
//! sequence export, and the Oriedita oracle.
//!
//! | Fold | Kernel |
//! |---|---|
//! | B | `Black0` |
//! | M | `Red1` |
//! | V | `Blue2` |
//! | F remembering X | `None`, with the direction hint X |
//! | a crease mark (a partial crease) | `Cyan3`, an auxiliary line |
//!
//! A crease mark ends inside the paper, which Edit's checks take for an
//! error in a crease, so it goes over as the auxiliary line Edit's
//! "precreases as auxiliary lines" would make of it: in both Send to Edit
//! variants, and in the FOLD export's crease-pattern frame. Its letter stays
//! in Fold, as an aux line has none. Import CP reads it back as a guide line,
//! as it reads every aux colour.
//!
//! Lossless means lossless for everything the kernel can hold — segments,
//! colours, hints — through the kernel's own FOLD writer and reader. Ids,
//! lineage, `made_at` and the layer order stay in Fold; Edit has nowhere to put
//! them. Oriedita folds only the folding colours (Edit filters
//! `is_folding_line` first), so the precreases, written as `None`, take no part
//! in its fold.
//!
//! # Placement
//!
//! The kernel's FOLD reader re-places every crease pattern it reads
//! (`normalize_imported_fold_lines`, Oriedita's import rule): the bounding
//! box's upper-left corner goes to (−200, −200) and its height to 400 model
//! units, y down. [`KernelFrame`] puts the sheet exactly there, so on a square
//! it is Oriedita's default paper and in general the re-placement is the
//! identity. Placed anywhere else, a pattern would come back moved and scaled.
//!
//! The identity is still evaluated, as `(c + 200) − 200` on each coordinate,
//! and it rounds the y coordinate of about one point in five (measured on a
//! million random points). [`KernelFrame::to_model`] applies that rounding
//! once; it is idempotent, so every coordinate it leaves is one the reader
//! maps to itself and the kernel's FOLD writer and reader return the model to
//! the bit. So does FOLD *text*: `serde_json` prints each coordinate as the
//! shortest string that reads back to it, and the workspace enables its
//! `float_roundtrip` feature (root `Cargo.toml`), which parses that string to
//! the same `f64`. `tests/kernel.rs` asserts both round trips exactly.

use oristudio_cp::geometry::{FoldDirection, LineColor, LineSegment, Point as KernelPoint};
use oristudio_cp::model::CreasePatternModel;
use oristudio_geometry::{Frame, convex};

use crate::pattern::{CreaseKind, Letter};
use crate::sheet::Sheet;
use crate::state::State;

type Point = [f64; 2];

/// Where the kernel's FOLD reader puts a pattern's upper-left corner, on both
/// axes, in model units.
const READER_ANCHOR: f64 = -200.0;

/// Where a sheet sits in the kernel's model space: its bounding box's top edge
/// on y = −200, its bottom edge on y = 200 and its left edge on x = −200, the
/// placement the kernel's FOLD reader gives every pattern (see the module
/// docs).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KernelFrame {
    /// The lower-left corner of the sheet's bounding box, in sheet
    /// coordinates.
    corner: Point,
    /// The bounding box's height in sheet coordinates: what becomes 400 model
    /// units.
    height: f64,
}

impl KernelFrame {
    /// Oriedita's default paper: the 400-unit square about the origin, y
    /// down. A square sheet maps onto it exactly; any other sheet is scaled
    /// so its height spans it, and a wide one runs past its right edge.
    pub const PAPER: Frame = Frame {
        origin: [-200.0, 200.0],
        x_axis: [1.0, 0.0],
        y_axis: [0.0, -1.0],
        width: 400.0,
        height: 400.0,
    };

    pub fn of(sheet: &Sheet) -> KernelFrame {
        let [x0, y0, _, y1] = convex::bounding_box(sheet.outline());
        KernelFrame {
            corner: [x0, y0],
            height: y1 - y0,
        }
    }

    /// A sheet point in the kernel's model space: [`Self::PAPER`]'s map of the
    /// point measured in bounding-box heights, on a value the kernel's FOLD
    /// reader maps to itself.
    ///
    /// Dividing by the height before [`Frame::unit_to_model`] multiplies is
    /// what puts the box's top edge on −200 exactly: multiplying by a scale of
    /// 400 / height and then by the height lands within an ulp of 400, and an
    /// ulp off is enough for the reader to rescale every point. A point
    /// rounding has left a hair outside the box is put on it, for the same
    /// reason.
    pub fn to_model(&self, p: Point) -> Point {
        let t = [
            ((p[0] - self.corner[0]) / self.height).max(0.0),
            ((p[1] - self.corner[1]) / self.height).clamp(0.0, 1.0),
        ];
        let [x, y] = Self::PAPER.unit_to_model(t);
        [on_reader_grid(x), on_reader_grid(y)]
    }

    /// A model-space point back in sheet coordinates.
    pub fn to_sheet(&self, p: Point) -> Point {
        let [tx, ty] = Self::PAPER.model_to_unit(p);
        [
            self.corner[0] + tx * self.height,
            self.corner[1] + ty * self.height,
        ]
    }
}

/// The kernel's FOLD reader's re-placement of one coordinate that is already
/// where it puts patterns: a rotation by 0° at scale 1 about the anchor,
/// evaluated as the reader evaluates it (`point_rotate_scaled`).
fn on_reader_grid(c: f64) -> f64 {
    (c - READER_ANCHOR) + READER_ANCHOR
}

/// The state's crease pattern as a kernel model, one segment per crease in id
/// order, then one auxiliary line per crease mark, in [`KernelFrame`]
/// placement.
pub fn fold_cp_to_model(state: &State) -> CreasePatternModel {
    let frame = KernelFrame::of(state.sheet());
    let place = |p: Point| {
        let [x, y] = frame.to_model(p);
        KernelPoint::new(x, y)
    };
    let points: Vec<KernelPoint> = state.vertices().iter().map(|&p| place(p)).collect();
    let mut model = CreasePatternModel::default();
    for crease in state.creases() {
        // A state's creases name its own vertices (the gate checked).
        let [a, b] = crease.vertices.map(|v| points[v.index()]);
        model.add_line_segment(kernel_segment(a, b, crease.kind));
    }
    for mark in state.crease_marks() {
        model.add_line_segment(LineSegment::with_color(
            place(mark.a),
            place(mark.b),
            AUXILIARY,
        ));
    }
    model
}

/// What a crease mark is in Edit: the auxiliary line Edit's "precreases as
/// auxiliary lines" also turns a precrease into.
pub const AUXILIARY: LineColor = LineColor::Cyan3;

fn kernel_segment(a: KernelPoint, b: KernelPoint, kind: CreaseKind) -> LineSegment {
    match kind {
        CreaseKind::Border => LineSegment::with_color(a, b, LineColor::Black0),
        CreaseKind::Folded(letter) => LineSegment::with_color(a, b, direction(letter).line_color()),
        // The kernel keeps a remembered direction only on an unassigned
        // crease, and this is the constructor that puts it there.
        CreaseKind::Flat(letter) => {
            LineSegment::with_color(a, b, direction(letter).line_color()).with_direction_kept()
        }
    }
}

fn direction(letter: Letter) -> FoldDirection {
    match letter {
        Letter::Mountain => FoldDirection::Mountain,
        Letter::Valley => FoldDirection::Valley,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // The crate's tests always have `random-sequences`: the crate is its own
    // dev-dependency with it.
    use crate::random::Rng;

    fn sheets() -> Vec<Sheet> {
        let built = [
            Ok(Sheet::square()),
            Sheet::rectangle(1.0, 2f64.sqrt()),
            Sheet::rectangle(2f64.sqrt(), 1.0),
            Sheet::rectangle(4.0, 3.0),
            Sheet::regular(3),
            Sheet::regular(5),
            Sheet::regular(6),
        ];
        built
            .into_iter()
            .map(|s| s.unwrap_or_else(|e| panic!("{e}")))
            .collect()
    }

    #[test]
    fn the_paper_is_orieditas_default_square() {
        assert_eq!(
            Ok(KernelFrame::PAPER),
            Frame::axis_aligned([-200.0, -200.0, 200.0, 200.0])
        );
        let square = KernelFrame::of(&Sheet::square());
        assert_eq!(square.to_model([0.0, 0.0]), [-200.0, 200.0]);
        assert_eq!(square.to_model([1.0, 1.0]), [200.0, -200.0]);
        assert_eq!(square.to_model([0.25, 0.75]), [-100.0, -100.0]);
    }

    #[test]
    fn every_sheet_spans_the_readers_box_exactly() {
        for sheet in sheets() {
            let frame = KernelFrame::of(&sheet);
            let model: Vec<Point> = sheet.outline().iter().map(|&p| frame.to_model(p)).collect();
            let [x0, y0, x1, y1] = convex::bounding_box(&model);
            assert_eq!([x0, y0, y1], [-200.0, -200.0, 200.0], "{sheet:?}");
            let [sx0, sy0, sx1, sy1] = convex::bounding_box(sheet.outline());
            let aspect = (sx1 - sx0) / (sy1 - sy0);
            assert!(((x1 + 200.0) / 400.0 - aspect).abs() < 1e-12, "{sheet:?}");
        }
    }

    /// The reader's re-placement maps every converted coordinate to itself,
    /// and the inverse recovers the sheet point.
    #[test]
    fn converted_points_are_fixed_by_the_readers_rounding() {
        let mut rng = Rng::new(7);
        for sheet in sheets() {
            let frame = KernelFrame::of(&sheet);
            let [x0, y0, x1, y1] = convex::bounding_box(sheet.outline());
            for _ in 0..20_000 {
                let p = [
                    x0 + rng.next_f64() * (x1 - x0),
                    y0 + rng.next_f64() * (y1 - y0),
                ];
                let m = frame.to_model(p);
                assert_eq!(m.map(on_reader_grid), m, "{p:?}");
                let back = frame.to_sheet(m);
                assert!(
                    (back[0] - p[0]).abs() < 1e-14 && (back[1] - p[1]).abs() < 1e-14,
                    "{p:?} -> {m:?} -> {back:?}"
                );
            }
        }
    }

    /// Without the rounding, a plain map misses: the claim the rounding exists
    /// for.
    #[test]
    fn the_plain_frame_map_is_not_fixed() {
        let mut rng = Rng::new(11);
        let moved = (0..10_000)
            .filter(|_| {
                let [_, y] = KernelFrame::PAPER.unit_to_model([rng.next_f64(), rng.next_f64()]);
                on_reader_grid(y) != y
            })
            .count();
        assert!(moved > 1_000, "{moved}");
    }

    #[test]
    fn rounding_off_the_sheet_is_put_back_on_its_box() {
        let frame = KernelFrame::of(&Sheet::square());
        assert_eq!(frame.to_model([-1e-15, 1.0 + 1e-15]), [-200.0, -200.0]);
        assert_eq!(frame.to_model([0.5, -1e-15]), [0.0, 200.0]);
    }

    #[test]
    fn kinds_map_to_colours_and_hints() {
        let (a, b) = (KernelPoint::new(0.0, 0.0), KernelPoint::new(1.0, 0.0));
        let cases = [
            (CreaseKind::Border, LineColor::Black0, None),
            (CreaseKind::Folded(Letter::Mountain), LineColor::Red1, None),
            (CreaseKind::Folded(Letter::Valley), LineColor::Blue2, None),
            (
                CreaseKind::Flat(Letter::Mountain),
                LineColor::None,
                Some(FoldDirection::Mountain),
            ),
            (
                CreaseKind::Flat(Letter::Valley),
                LineColor::None,
                Some(FoldDirection::Valley),
            ),
        ];
        for (kind, color, hint) in cases {
            let s = kernel_segment(a, b, kind);
            assert_eq!((s.color, s.fold_direction_hint), (color, hint), "{kind:?}");
            assert_eq!(s.fold_magnitude, None, "{kind:?}: a classic crease");
        }
    }
}
