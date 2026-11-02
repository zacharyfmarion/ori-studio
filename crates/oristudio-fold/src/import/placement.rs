//! Finding the sheet (plan D16 steps 2–3): the border segments chained into
//! one closed loop by `oristudio_geometry::outline`, the match against the
//! sequence's sheet, and the map from the input's coordinates into the unit
//! sheet frame and back.
//!
//! Two maps, by shape:
//!
//! - **A rectangle onto a rectangle** (or adopted as one) is placed in the
//!   frame the outline code chooses, turned a quarter when the sequence's
//!   rectangle is the other way up, each side scaled exactly onto the
//!   sheet's ([`Map::Frame`], V0's map, unchanged).
//! - **Any other sheet** — a pattern whose border is a regular or any other
//!   convex polygon, or a sequence whose sheet is one — is placed by its
//!   corners ([`Map::Outline`]): the turn, scale and shift that put every
//!   corner of the border within the tolerance of the sheet's, the smallest
//!   such turn when the sheet's symmetry allows several. An empty sequence
//!   adopts the border's polygon as Import starting sheet reads it
//!   ([`starting_sheet`]).
//!
//! # Orientation
//!
//! The crease pattern's front is the sheet's front. The outline code reads
//! Oriedita's y-down model space and maps it to the y-up unit frame keeping
//! the picture as drawn (`Frame`), so model input goes straight in; y-up
//! input is mirrored into model space first, and the frame mirrors it back.
//! The outline map reads the picture as drawn, y-up, directly. Either way the
//! map into the sheet is a rotation, translation and scale: no letter
//! changes.

use oristudio_geometry::outline::{self, RefusalReason};
use oristudio_geometry::{Frame, convex};

use super::{CreasePatternInput, ImportKind, ImportRefusal, ImportSpace, UnsupportedShape};
use crate::numerics::TOL;
use crate::sheet::{Sheet, SheetShape};

type Point = [f64; 2];

/// The input's coordinates against the sheet's.
#[derive(Debug, Clone)]
pub(super) struct Placement {
    /// The input is y-up: mirror it into the y-down model space the frame
    /// reads.
    flip_y: bool,
    map: Map,
}

/// How the pattern, as drawn, lands on the sheet.
#[derive(Debug, Clone)]
enum Map {
    /// A rectangle onto a rectangle: the outline code's frame.
    Frame(FrameMap),
    /// Any other sheet: fitted by its corners.
    Outline(OutlineMap),
}

/// A rectangle's frame, a quarter turn and an exact scale per side.
#[derive(Debug, Clone)]
struct FrameMap {
    frame: Frame,
    /// The pattern's height in the unit frame, before any turn.
    found_height: f64,
    /// The pattern was turned a quarter counter-clockwise to fit the
    /// sequence's rectangle.
    quarter_turn: bool,
    /// Per axis, the factor (within the tolerance of 1) that puts the
    /// pattern's sides exactly on the sheet's.
    scale: [f64; 2],
    /// The sheet's width and height.
    sides: [f64; 2],
}

/// A similarity of the picture as drawn (y-up) onto the sheet: `p ↦ factor ·
/// p + shift` read as complex numbers, so `factor` turns by its angle and
/// scales by its length. Never a mirror: the front stays the front.
#[derive(Debug, Clone)]
struct OutlineMap {
    factor: Point,
    shift: Point,
    /// The sheet's corners: a point mapped within the tolerance of one is
    /// exactly on it.
    corners: Vec<Point>,
}

/// The sheet a pattern lands on, and how.
pub(super) struct Recovered {
    pub(super) placement: Placement,
    pub(super) sheet: Sheet,
    pub(super) shape: SheetShape,
}

/// The input's border segments chained into loops, in model space (y-down,
/// as the outline code reads it): what a sheet is found from.
fn border_loops(input: &CreasePatternInput) -> Result<Vec<outline::BorderLoop>, ImportRefusal> {
    let flip_y = input.space == ImportSpace::Sheet;
    let to_model = |p: Point| if flip_y { [p[0], -p[1]] } else { p };
    let segments: Vec<[f64; 4]> = input
        .segments
        .iter()
        .map(|s| {
            let ([x1, y1], [x2, y2]) = (to_model(s.from), to_model(s.to));
            [x1, y1, x2, y2]
        })
        .collect();
    let border: Vec<u32> = input
        .segments
        .iter()
        .enumerate()
        .filter(|(_, s)| s.kind == ImportKind::Border)
        .filter_map(|(i, _)| u32::try_from(i).ok())
        .collect();
    let points: Vec<Point> = border
        .iter()
        .flat_map(|&i| {
            let [x1, y1, x2, y2] = segments[i as usize];
            [[x1, y1], [x2, y2]]
        })
        .collect();
    let [x0, y0, x1, y1] = convex::bounding_box(&points);
    let scale = (x1 - x0).max(y1 - y0);
    if !(scale.is_finite() && scale > 0.0) {
        return Err(ImportRefusal::NoBorder);
    }
    Ok(outline::detect_border_loops(&segments, &border, scale).loops)
}

/// The input's one border loop.
fn border_loop(input: &CreasePatternInput) -> Result<outline::BorderLoop, ImportRefusal> {
    let loops = border_loops(input)?;
    let count = loops.len();
    let mut loops = loops.into_iter();
    match (loops.next(), loops.next()) {
        (Some(border_loop), None) => Ok(border_loop),
        _ => Err(ImportRefusal::OutlineLoops { count }),
    }
}

/// Model-space corners as the picture is drawn: y-up.
fn drawn(corners: &[Point]) -> Vec<Point> {
    corners.iter().map(|&[x, y]| [x, -y]).collect()
}

/// A drawn outline in the unit sheet frame: its bounding box at the origin
/// and its longer side 1. None when it has no extent.
fn unit_polygon(drawn: &[Point]) -> Option<Vec<Point>> {
    let [x0, y0, x1, y1] = convex::bounding_box(drawn);
    let longer = (x1 - x0).max(y1 - y0);
    (longer.is_finite() && longer > 0.0).then(|| {
        drawn
            .iter()
            .map(|&[x, y]| [(x - x0) / longer, (y - y0) / longer])
            .collect()
    })
}

/// The sheet a pattern's border outlines, whatever its shape, as a sequence
/// would start from it: a square or a rectangle in the frame the outline
/// code chooses for a rectangular loop (as an import into an empty sequence
/// adopts one), any other outline as its corners — collinear vertices
/// dropped — in the unit sheet frame, y-up as the pattern is drawn, its
/// bounding box at the origin and its longer side 1. Only the border is
/// read: the creases are not. Whether a polygon is a sheet Fold folds
/// (convex, no side too short) is [`Sheet::polygon`]'s to say.
pub(super) fn starting_sheet(input: &CreasePatternInput) -> Result<SheetShape, ImportRefusal> {
    let flip_y = input.space == ImportSpace::Sheet;
    match border_loop(input)?.sheet {
        Ok(rect) => {
            let rf = rect.frame.rf_rect();
            Ok(if (rf.width - rf.height).abs() <= TOL {
                SheetShape::Square
            } else {
                SheetShape::Rectangle {
                    width: rf.width,
                    height: rf.height,
                }
            })
        }
        Err(RefusalReason::NonRectangular { vertices }) => Ok(SheetShape::Polygon {
            points: unit_polygon(&drawn(&vertices)).ok_or(ImportRefusal::NoBorder)?,
        }),
        Err(reason) => Err(ImportRefusal::OutlineInvalid {
            reason: unflip(reason, flip_y),
        }),
    }
}

/// Recover the sheet from the border, and match it against `sequence`'s
/// sheet, or adopt it when there is none.
pub(super) fn recover(
    input: &CreasePatternInput,
    sequence: Option<&Sheet>,
) -> Result<Recovered, ImportRefusal> {
    let flip_y = input.space == ImportSpace::Sheet;
    let border_loop = border_loop(input)?;
    // The rectangle a rectangular border lands on in V0's frame: the
    // sequence's when it is one, or the border's own for an empty sequence.
    let rectangle = match sequence {
        None => Some(None),
        Some(sheet) => rectangle_sides(sheet).map(|sides| Some((sheet, sides))),
    };
    let (frame, rectangle) = match (border_loop.sheet, rectangle) {
        (Ok(rect), Some(rectangle)) => (rect.frame, rectangle),
        (Ok(_) | Err(RefusalReason::NonRectangular { .. }), _) => {
            return by_corners(&border_loop.corners, flip_y, sequence);
        }
        (Err(reason), _) => {
            return Err(ImportRefusal::OutlineInvalid {
                reason: unflip(reason, flip_y),
            });
        }
    };
    let rf = frame.rf_rect();
    let found_sides = [rf.width, rf.height];
    let (sheet, shape, quarter_turn, sides) = match rectangle {
        None => {
            let (sheet, shape) = if (found_sides[0] - found_sides[1]).abs() <= TOL {
                (Sheet::square(), SheetShape::Square)
            } else {
                let sheet = Sheet::rectangle(found_sides[0], found_sides[1])
                    .map_err(|_| ImportRefusal::NoBorder)?;
                (
                    sheet,
                    SheetShape::Rectangle {
                        width: found_sides[0],
                        height: found_sides[1],
                    },
                )
            };
            let sides = rectangle_sides(&sheet).unwrap_or(found_sides);
            (sheet, shape, false, sides)
        }
        Some((sheet, sides)) => {
            let near =
                |a: [f64; 2], b: [f64; 2]| (a[0] - b[0]).abs() <= TOL && (a[1] - b[1]).abs() <= TOL;
            let quarter_turn = if near(found_sides, sides) {
                false
            } else if near([found_sides[1], found_sides[0]], sides) {
                true
            } else {
                return Err(ImportRefusal::ShapeMismatch {
                    expected: sides,
                    found: found_sides,
                });
            };
            let shape = if (sides[0] - sides[1]).abs() <= TOL {
                SheetShape::Square
            } else {
                SheetShape::Rectangle {
                    width: sides[0],
                    height: sides[1],
                }
            };
            (sheet.clone(), shape, quarter_turn, sides)
        }
    };
    let turned = if quarter_turn {
        [found_sides[1], found_sides[0]]
    } else {
        found_sides
    };
    Ok(Recovered {
        placement: Placement {
            flip_y,
            map: Map::Frame(FrameMap {
                frame,
                found_height: found_sides[1],
                quarter_turn,
                scale: [sides[0] / turned[0], sides[1] / turned[1]],
                sides,
            }),
        },
        sheet,
        shape,
    })
}

/// A border that is no rectangle, or a sequence's sheet that is none: the
/// pattern's corners (model space, collinear vertices dropped) fitted onto
/// the sheet's, or adopted as the sheet by an empty sequence.
fn by_corners(
    corners: &[Point],
    flip_y: bool,
    sequence: Option<&Sheet>,
) -> Result<Recovered, ImportRefusal> {
    // Mirroring into model space is its own inverse.
    let to_input = |p: Point| if flip_y { [p[0], -p[1]] } else { p };
    let found: Vec<Point> = corners.iter().copied().map(to_input).collect();
    let drawn = drawn(corners);
    // The sheet the border is, as Import starting sheet reads it: refused
    // when Fold folds no such sheet, whatever the sequence's.
    let own = unit_polygon(&drawn)
        .and_then(|points| Sheet::polygon(points).ok())
        .ok_or_else(|| ImportRefusal::ShapeUnsupported {
            which: UnsupportedShape::Pattern {
                corners: found.clone(),
            },
        })?;
    let sheet = sequence.cloned().unwrap_or(own);
    let map = OutlineMap::fit(&drawn, &sheet).ok_or_else(|| ImportRefusal::OutlineMismatch {
        expected_corners: sheet.outline().to_vec(),
        found_corners: found,
    })?;
    Ok(Recovered {
        placement: Placement {
            flip_y,
            map: Map::Outline(map),
        },
        shape: SheetShape::Polygon {
            points: sheet.outline().to_vec(),
        },
        sheet,
    })
}

impl Placement {
    pub(super) fn quarter_turn(&self) -> bool {
        match &self.map {
            Map::Frame(map) => map.quarter_turn,
            Map::Outline(map) => (map.angle() - std::f64::consts::FRAC_PI_2).abs() <= TOL,
        }
    }

    /// An input point in sheet coordinates; within the tolerance of a side
    /// of a rectangle, or of a corner of any other sheet, exactly on it.
    pub(super) fn to_sheet(&self, p: Point) -> Point {
        match &self.map {
            Map::Frame(map) => map.to_sheet(if self.flip_y { [p[0], -p[1]] } else { p }),
            Map::Outline(map) => map.to_sheet(if self.flip_y { p } else { [p[0], -p[1]] }),
        }
    }

    /// A sheet point in the input's coordinates.
    pub(super) fn to_input(&self, p: Point) -> Point {
        let mirror = match &self.map {
            Map::Frame(_) => self.flip_y,
            Map::Outline(_) => !self.flip_y,
        };
        let q = match &self.map {
            Map::Frame(map) => map.to_model(p),
            Map::Outline(map) => map.to_drawn(p),
        };
        if mirror { [q[0], -q[1]] } else { q }
    }
}

impl FrameMap {
    /// A model point in sheet coordinates.
    fn to_sheet(&self, model: Point) -> Point {
        let unit = self.frame.model_to_unit(model);
        let turned = if self.quarter_turn {
            [self.found_height - unit[1], unit[0]]
        } else {
            unit
        };
        let snap = |v: f64, side: f64| {
            if v.abs() <= TOL {
                0.0
            } else if (v - side).abs() <= TOL {
                side
            } else {
                v
            }
        };
        [
            snap(turned[0] * self.scale[0], self.sides[0]),
            snap(turned[1] * self.scale[1], self.sides[1]),
        ]
    }

    /// A sheet point in model space.
    fn to_model(&self, p: Point) -> Point {
        let turned = [p[0] / self.scale[0], p[1] / self.scale[1]];
        let unit = if self.quarter_turn {
            [turned[1], self.found_height - turned[0]]
        } else {
            turned
        };
        self.frame.unit_to_model(unit)
    }
}

impl OutlineMap {
    /// The similarity that puts the corners of `drawn` (the border as drawn,
    /// either orientation) within the tolerance of the sheet's, pairing them
    /// in turn; of several (a symmetric sheet), the one that turns least,
    /// counter-clockwise on a tie. None when no pairing fits: a different
    /// number of corners, or another shape.
    ///
    /// Each pairing's similarity is the least-squares one, from sums taken in
    /// the sheet's corner order, so corners that are the sheet's already map
    /// through exactly the identity: the state's own crease pattern lands on
    /// its own sheet without a bit moved.
    fn fit(drawn: &[Point], sheet: &Sheet) -> Option<OutlineMap> {
        let corners = outline::simplify_corners(sheet.outline(), TOL);
        let mut found = drawn.to_vec();
        if convex::signed_area(&found) < 0.0 {
            found.reverse();
        }
        let n = corners.len();
        if found.len() != n {
            return None;
        }
        let mut best: Option<(f64, OutlineMap)> = None;
        for k in 0..n {
            let pairs: Vec<(Point, Point)> =
                (0..n).map(|i| (found[(i + k) % n], corners[i])).collect();
            let Some((factor, shift)) = similarity(&pairs) else {
                continue;
            };
            let map = OutlineMap {
                factor,
                shift,
                corners: corners.clone(),
            };
            let fits = pairs.iter().all(|&(p, c)| {
                let q = map.apply(p);
                (q[0] - c[0]).hypot(q[1] - c[1]) <= TOL
            });
            if !fits {
                continue;
            }
            let angle = map.angle();
            let better = best.as_ref().is_none_or(|(least, _)| {
                let (a, b) = (angle.abs(), least.abs());
                a < b - TOL || (a <= b + TOL && angle > *least)
            });
            if better {
                best = Some((angle, map));
            }
        }
        best.map(|(_, map)| map)
    }

    /// The turn, radians counter-clockwise, in (−π, π].
    fn angle(&self) -> f64 {
        self.factor[1].atan2(self.factor[0])
    }

    fn apply(&self, [x, y]: Point) -> Point {
        let [re, im] = self.factor;
        [
            re * x - im * y + self.shift[0],
            im * x + re * y + self.shift[1],
        ]
    }

    /// A drawn point in sheet coordinates; within the tolerance of a corner,
    /// exactly on it.
    fn to_sheet(&self, p: Point) -> Point {
        let q = self.apply(p);
        self.corners
            .iter()
            .copied()
            .find(|c| (q[0] - c[0]).hypot(q[1] - c[1]) <= TOL)
            .unwrap_or(q)
    }

    /// A sheet point as drawn.
    fn to_drawn(&self, q: Point) -> Point {
        let [re, im] = self.factor;
        let length = re * re + im * im;
        let [dx, dy] = [q[0] - self.shift[0], q[1] - self.shift[1]];
        [(re * dx + im * dy) / length, (re * dy - im * dx) / length]
    }
}

/// The least-squares similarity `p ↦ factor · p + shift` (complex) taking
/// each pair's first point to its second; None when the first points have no
/// extent or the answer is not finite.
fn similarity(pairs: &[(Point, Point)]) -> Option<(Point, Point)> {
    let n = pairs.len() as f64;
    let mean = |pick: fn(&(Point, Point)) -> Point| {
        let [x, y] = pairs
            .iter()
            .map(pick)
            .fold([0.0, 0.0], |[x, y], p| [x + p[0], y + p[1]]);
        [x / n, y / n]
    };
    let (from, to) = (mean(|pair| pair.0), mean(|pair| pair.1));
    let (mut spread, mut re, mut im) = (0.0, 0.0, 0.0);
    for &(p, q) in pairs {
        let [px, py] = [p[0] - from[0], p[1] - from[1]];
        let [qx, qy] = [q[0] - to[0], q[1] - to[1]];
        spread += px * px + py * py;
        re += qx * px + qy * py;
        im += qy * px - qx * py;
    }
    if !(spread.is_finite() && spread > 0.0) {
        return None;
    }
    let factor = [re / spread, im / spread];
    let shift = [
        to[0] - (factor[0] * from[0] - factor[1] * from[1]),
        to[1] - (factor[1] * from[0] + factor[0] * from[1]),
    ];
    (factor.iter().chain(&shift).all(|c| c.is_finite()) && factor != [0.0, 0.0])
        .then_some((factor, shift))
}

/// The sides of a sheet that is the axis-aligned rectangle of its bounding
/// box: four corners and the box's area. Every square and rectangle sheet
/// is; a regular polygon or another outline is not.
fn rectangle_sides(sheet: &Sheet) -> Option<[f64; 2]> {
    let outline = sheet.outline();
    let [x0, y0, x1, y1] = convex::bounding_box(outline);
    let (w, h) = (x1 - x0, y1 - y0);
    (outline.len() == 4 && (sheet.area() - w * h).abs() <= TOL).then_some([w, h])
}

/// A refusal's vertices back in y-up input coordinates.
fn unflip(reason: RefusalReason, flip_y: bool) -> RefusalReason {
    if !flip_y {
        return reason;
    }
    let flip = |v: Vec<Point>| v.into_iter().map(|p| [p[0], -p[1]]).collect();
    match reason {
        RefusalReason::NonRectangular { vertices } => RefusalReason::NonRectangular {
            vertices: flip(vertices),
        },
        RefusalReason::OpenOutline { vertices } => RefusalReason::OpenOutline {
            vertices: flip(vertices),
        },
        RefusalReason::NonSimpleOutline { vertices } => RefusalReason::NonSimpleOutline {
            vertices: flip(vertices),
        },
        RefusalReason::DegenerateOutline { vertices } => RefusalReason::DegenerateOutline {
            vertices: flip(vertices),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::ImportSegment;
    use crate::refusal::FoldRefusal;

    fn outline(space: ImportSpace, corners: &[Point]) -> CreasePatternInput {
        let n = corners.len();
        CreasePatternInput {
            space,
            segments: (0..n)
                .map(|i| ImportSegment {
                    from: corners[i],
                    to: corners[(i + 1) % n],
                    kind: ImportKind::Border,
                })
                .collect(),
        }
    }

    fn close(a: Point, b: Point) -> bool {
        (a[0] - b[0]).abs() < 1e-12 && (a[1] - b[1]).abs() < 1e-12
    }

    fn recovered(input: &CreasePatternInput, sequence: Option<&Sheet>) -> Recovered {
        recover(input, sequence).unwrap_or_else(|e| panic!("{e}"))
    }

    #[test]
    fn oriedita_model_space_keeps_the_picture() {
        // Oriedita's default paper, y-down: its on-screen lower left is
        // (-200, 200).
        let input = outline(
            ImportSpace::Model,
            &[
                [-200.0, -200.0],
                [200.0, -200.0],
                [200.0, 200.0],
                [-200.0, 200.0],
            ],
        );
        let r = recovered(&input, None);
        assert_eq!(r.shape, SheetShape::Square);
        assert!(close(r.placement.to_sheet([-200.0, 200.0]), [0.0, 0.0]));
        assert!(close(r.placement.to_sheet([200.0, -200.0]), [1.0, 1.0]));
        // A point to the upper left on screen is upper left on the sheet.
        assert!(close(r.placement.to_sheet([-100.0, -100.0]), [0.25, 0.75]));
        assert!(close(r.placement.to_input([0.25, 0.75]), [-100.0, -100.0]));
    }

    #[test]
    fn y_up_input_is_placed_without_a_mirror() {
        let input = outline(
            ImportSpace::Sheet,
            &[[10.0, 10.0], [12.0, 10.0], [12.0, 11.0], [10.0, 11.0]],
        );
        let r = recovered(&input, None);
        assert_eq!(
            r.shape,
            SheetShape::Rectangle {
                width: 1.0,
                height: 0.5
            }
        );
        assert!(close(r.placement.to_sheet([10.0, 10.0]), [0.0, 0.0]));
        assert!(close(r.placement.to_sheet([11.5, 10.75]), [0.75, 0.375]));
        assert!(close(r.placement.to_input([0.75, 0.375]), [11.5, 10.75]));
    }

    #[test]
    fn a_rectangle_turns_a_quarter_to_fit_the_sequence() {
        let wide = outline(
            ImportSpace::Sheet,
            &[[0.0, 0.0], [2.0, 0.0], [2.0, 1.0], [0.0, 1.0]],
        );
        let tall = Sheet::rectangle(1.0, 2.0).unwrap_or_else(|e| panic!("{e}"));
        let r = recovered(&wide, Some(&tall));
        assert!(r.placement.quarter_turn());
        // Counter-clockwise: the pattern's lower right corner goes to the
        // sheet's upper right.
        assert!(close(r.placement.to_sheet([2.0, 0.0]), [0.5, 1.0]));
        assert!(close(r.placement.to_sheet([0.0, 0.0]), [0.5, 0.0]));
        assert!(close(r.placement.to_input([0.5, 1.0]), [2.0, 0.0]));
        assert!(close(r.placement.to_input([0.1, 0.3]), [0.6, 0.8]));
        assert_eq!(r.sheet, tall);
    }

    #[test]
    fn shapes_that_do_not_fit_are_refused() {
        let square = outline(
            ImportSpace::Sheet,
            &[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        );
        let a4 = Sheet::rectangle(1.0, 2f64.sqrt()).unwrap_or_else(|e| panic!("{e}"));
        assert!(matches!(
            recover(&square, Some(&a4)),
            Err(ImportRefusal::ShapeMismatch { .. })
        ));
        // A square is no hexagon, at any turn or scale.
        let hexagon = Sheet::regular(6).unwrap_or_else(|e| panic!("{e}"));
        match recover(&square, Some(&hexagon)).map(|_| ()) {
            Err(ImportRefusal::OutlineMismatch {
                expected_corners,
                found_corners,
            }) => {
                assert_eq!(expected_corners, hexagon.outline());
                assert_eq!(found_corners.len(), 4);
            }
            other => panic!("{other:?}"),
        }
        // A quadrilateral that is no rectangle, onto a square.
        let kite = outline(
            ImportSpace::Sheet,
            &[[0.0, 0.0], [1.0, 0.0], [1.2, 1.0], [0.0, 1.0]],
        );
        assert!(matches!(
            recover(&kite, Some(&Sheet::square())),
            Err(ImportRefusal::OutlineMismatch { .. })
        ));
        // A border that bends inward is no sheet, whatever the sequence's.
        let ell = outline(
            ImportSpace::Sheet,
            &[
                [0.0, 0.0],
                [2.0, 0.0],
                [2.0, 1.0],
                [1.0, 1.0],
                [1.0, 2.0],
                [0.0, 2.0],
            ],
        );
        for sequence in [None, Some(&hexagon)] {
            match recover(&ell, sequence).map(|_| ()) {
                Err(ImportRefusal::ShapeUnsupported {
                    which: UnsupportedShape::Pattern { corners },
                }) => {
                    assert_eq!(corners.len(), 6);
                    assert!(corners.iter().any(|&c| close(c, [1.0, 1.0])));
                }
                other => panic!("{other:?}"),
            }
        }
        let open = CreasePatternInput {
            space: ImportSpace::Sheet,
            segments: square.segments[..3].to_vec(),
        };
        assert!(matches!(
            recover(&open, None),
            Err(ImportRefusal::OutlineInvalid {
                reason: RefusalReason::OpenOutline { .. }
            })
        ));
        let mut two = square.clone();
        two.segments.extend(
            outline(
                ImportSpace::Sheet,
                &[[3.0, 0.0], [4.0, 0.0], [4.0, 1.0], [3.0, 1.0]],
            )
            .segments,
        );
        assert_eq!(
            recover(&two, None).map(|_| ()).err(),
            Some(ImportRefusal::OutlineLoops { count: 2 })
        );
        let none = CreasePatternInput {
            space: ImportSpace::Sheet,
            segments: Vec::new(),
        };
        assert_eq!(
            recover(&none, None).map(|_| ()).err(),
            Some(ImportRefusal::NoBorder)
        );
    }

    #[test]
    fn a_starting_sheet_is_the_border_whatever_its_shape() {
        // A rectangle, as the import adopts one; a square turned 45° is still the square.
        let wide = outline(
            ImportSpace::Sheet,
            &[[0.0, 0.0], [2.0, 0.0], [2.0, 1.0], [0.0, 1.0]],
        );
        assert_eq!(
            starting_sheet(&wide),
            Ok(SheetShape::Rectangle {
                width: 1.0,
                height: 0.5
            })
        );
        let diamond = outline(
            ImportSpace::Sheet,
            &[[1.0, 0.0], [2.0, 1.0], [1.0, 2.0], [0.0, 1.0]],
        );
        assert_eq!(starting_sheet(&diamond), Ok(SheetShape::Square));
        // A hexagon, in Oriedita's y-down model space: its corners in the
        // unit frame, the picture as drawn (its flat top stays at the top).
        let h = 3f64.sqrt() / 2.0;
        let hexagon = outline(
            ImportSpace::Model,
            &[
                [-1.0, 0.0],
                [-0.5, -h],
                [0.5, -h],
                [1.0, 0.0],
                [0.5, h],
                [-0.5, h],
            ],
        );
        let Ok(SheetShape::Polygon { points }) = starting_sheet(&hexagon) else {
            panic!("a hexagon is a polygon sheet");
        };
        assert_eq!(points.len(), 6);
        assert!(points.iter().any(|&p| close(p, [0.25, 2.0 * h / 2.0])));
        assert!(points.iter().any(|&p| close(p, [0.0, h / 2.0])));
        // A vertex along a side is no corner.
        let mut split = outline(
            ImportSpace::Sheet,
            &[[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [1.0, 1.0]],
        );
        split.segments.truncate(4);
        let Ok(SheetShape::Polygon { points }) = starting_sheet(&split) else {
            panic!("a triangle is a polygon sheet");
        };
        assert_eq!(points.len(), 3);
        // Two loops are no one sheet.
        let mut two = wide.clone();
        two.segments.extend(
            outline(
                ImportSpace::Sheet,
                &[[3.0, 0.0], [4.0, 0.0], [4.0, 1.0], [3.0, 1.0]],
            )
            .segments,
        );
        assert_eq!(
            starting_sheet(&two),
            Err(ImportRefusal::OutlineLoops { count: 2 })
        );
    }

    #[test]
    fn a_starting_sheet_is_one_the_engine_folds_and_ignores_the_creases() {
        // An L: a loop, but no sheet the engine folds.
        let ell = outline(
            ImportSpace::Sheet,
            &[
                [0.0, 0.0],
                [2.0, 0.0],
                [2.0, 1.0],
                [1.0, 1.0],
                [1.0, 2.0],
                [0.0, 2.0],
            ],
        );
        assert_eq!(
            crate::import::starting_sheet(&ell),
            Ok(Err(FoldRefusal::SheetNotConvex))
        );
        // A crease no fold could make — off the paper, alone — is never read.
        let mut creased = outline(
            ImportSpace::Sheet,
            &[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        );
        creased.segments.push(ImportSegment {
            from: [0.2, 0.2],
            to: [5.0, 0.3],
            kind: ImportKind::Mountain,
        });
        assert_eq!(
            crate::import::starting_sheet(&creased),
            Ok(Ok(SheetShape::Square))
        );
        // The hexagon's outline comes back counter-clockwise, as the sheet stores it.
        let h = 3f64.sqrt() / 2.0;
        let clockwise = outline(
            ImportSpace::Sheet,
            &[
                [-1.0, 0.0],
                [-0.5, h],
                [0.5, h],
                [1.0, 0.0],
                [0.5, -h],
                [-0.5, -h],
            ],
        );
        let Ok(Ok(SheetShape::Polygon { points })) = crate::import::starting_sheet(&clockwise)
        else {
            panic!("a hexagon is a polygon sheet");
        };
        assert!(convex::signed_area(&points) > 0.0);
    }

    /// `p` turned by `degrees` counter-clockwise about `centre`.
    fn turned(p: Point, centre: Point, degrees: f64) -> Point {
        let (s, c) = degrees.to_radians().sin_cos();
        let [dx, dy] = [p[0] - centre[0], p[1] - centre[1]];
        [centre[0] + c * dx - s * dy, centre[1] + s * dx + c * dy]
    }

    fn near(a: Point, b: Point) -> bool {
        (a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9
    }

    #[test]
    fn a_pattern_on_its_own_polygon_sheet_maps_through_the_identity() {
        // What `CreasePatternInput::of_state` writes: the sheet's own
        // coordinates, its border split where creases meet it.
        for sides in 3..=8 {
            let sheet = Sheet::regular(sides).unwrap_or_else(|e| panic!("{e}"));
            let corners = sheet.outline().to_vec();
            let mut input = outline(ImportSpace::Sheet, &corners);
            let [a, b] = [corners[0], corners[1]];
            let mid = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
            input.segments[0].to = mid;
            input.segments.push(ImportSegment {
                from: mid,
                to: b,
                kind: ImportKind::Border,
            });
            let r = recovered(&input, Some(&sheet));
            assert_eq!(r.sheet, sheet, "{sides}");
            assert_eq!(
                r.shape,
                SheetShape::Polygon {
                    points: corners.clone()
                }
            );
            assert!(!r.placement.quarter_turn());
            for p in corners
                .iter()
                .copied()
                .chain([mid, [0.3, 0.41], [0.123, 0.456]])
            {
                assert_eq!(r.placement.to_sheet(p), p, "{sides}: {p:?}");
                assert_eq!(r.placement.to_input(p), p, "{sides}: {p:?}");
            }
        }
    }

    #[test]
    fn a_turned_and_scaled_polygon_turns_back_the_least_way() {
        // A hexagon drawn in Oriedita's y-down model space, 300 units across,
        // turned 20° on screen: it turns back by 20°, the least of the six
        // fits, and lands on the sheet's corners exactly.
        let hexagon = Sheet::regular(6).unwrap_or_else(|e| panic!("{e}"));
        let centre = [0.5, 0.5];
        let to_model = |p: Point| {
            let [x, y] = turned(p, centre, 20.0);
            [300.0 * x - 40.0, 70.0 - 300.0 * y]
        };
        let drawn: Vec<Point> = hexagon.outline().iter().copied().map(to_model).collect();
        let r = recovered(&outline(ImportSpace::Model, &drawn), Some(&hexagon));
        assert_eq!(r.sheet, hexagon);
        for (&c, &d) in hexagon.outline().iter().zip(&drawn) {
            assert_eq!(r.placement.to_sheet(d), c);
        }
        for p in [[0.3, 0.41], [0.7, 0.2], [0.5, 0.95]] {
            assert!(near(r.placement.to_sheet(to_model(p)), p), "{p:?}");
            assert!(near(r.placement.to_input(p), to_model(p)), "{p:?}");
        }

        // A pentagon turned half its symmetry (36°) fits turned 36° either
        // way: it goes on counter-clockwise, to 72°, which is the sheet.
        let pentagon = Sheet::regular(5).unwrap_or_else(|e| panic!("{e}"));
        let [x0, y0, x1, y1] = convex::bounding_box(pentagon.outline());
        let centre = [(x0 + x1) / 2.0, (y0 + y1) / 2.0];
        let centroid = convex::centroid(pentagon.outline()).unwrap_or(centre);
        let drawn: Vec<Point> = pentagon
            .outline()
            .iter()
            .map(|&p| turned(p, centroid, 36.0))
            .collect();
        let r = recovered(&outline(ImportSpace::Sheet, &drawn), Some(&pentagon));
        for p in [[0.3, 0.41], [0.6, 0.3]] {
            let at = r.placement.to_sheet(turned(p, centroid, 36.0));
            assert!(near(at, turned(p, centroid, 72.0)), "{p:?}: {at:?}");
        }
    }

    #[test]
    fn a_square_onto_a_diamond_turns_an_eighth() {
        // The square sheet set on its corner (a regular 4-gon) is no
        // axis-aligned rectangle: an axis-aligned square fits it turned 45°
        // either way, and goes counter-clockwise.
        let square = outline(
            ImportSpace::Sheet,
            &[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        );
        let diamond = Sheet::regular(4).unwrap_or_else(|e| panic!("{e}"));
        let r = recovered(&square, Some(&diamond));
        assert_eq!(r.sheet, diamond);
        assert!(!r.placement.quarter_turn());
        // The bottom edge's midpoint turns counter-clockwise to the lower
        // right side's.
        let [bottom, right] = [diamond.outline()[0], diamond.outline()[1]];
        let lower_right = [(bottom[0] + right[0]) / 2.0, (bottom[1] + right[1]) / 2.0];
        assert!(near(r.placement.to_sheet([0.5, 0.0]), lower_right));
    }

    #[test]
    fn an_empty_sequence_adopts_a_polygon_as_the_starting_sheet_reads_it() {
        let h = 3f64.sqrt() / 2.0;
        let hexagon = outline(
            ImportSpace::Model,
            &[
                [-100.0, 0.0],
                [-50.0, -100.0 * h],
                [50.0, -100.0 * h],
                [100.0, 0.0],
                [50.0, 100.0 * h],
                [-50.0, 100.0 * h],
            ],
        );
        let Ok(Ok(shape)) = crate::import::starting_sheet(&hexagon) else {
            panic!("a hexagon is a sheet");
        };
        let r = recovered(&hexagon, None);
        assert_eq!(r.shape, shape);
        assert_eq!(Ok(r.sheet.clone()), Sheet::new(&shape));
        // Not turned: the left corner stays at the left, the flat top on top.
        assert_eq!(r.placement.to_sheet([-100.0, 0.0]), [0.0, h / 2.0]);
        assert!(near(r.placement.to_sheet([0.0, 0.0]), [0.5, h / 2.0]));
        assert!(near(r.placement.to_sheet([0.0, -100.0 * h]), [0.5, h]));
        assert!(near(r.placement.to_input([0.5, h]), [0.0, -100.0 * h]));
    }
}
