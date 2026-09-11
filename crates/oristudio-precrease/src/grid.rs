//! The grid a box- or hex-pleated design is precreased on.
//!
//! A box-pleated design is precreased the way every folder precreases one:
//! the whole grid first — every line of it, edge to edge, alternating mountain
//! and valley as a pleat does — and only then the diagonals and the rest,
//! which then have a grid crossing to be sighted from at every step. Folding
//! the grid line by line as the closure reaches each one, "fold P onto Q" with
//! a card apiece, is what the planner did before: a 32-grid was 62 cards
//! before the model started.
//!
//! [`detect`] reads a component's target lines and says which grid, if any,
//! they lie on. The answer is a set of **families** — parallel lines at one
//! spacing — with every line of each family that crosses the sheet, in the
//! direction the pleat gives it and with the target it realises where the
//! pattern has that line.
//!
//! # What counts as a grid
//!
//! Lines are sorted by the angle of their normal into twelve 15° buckets. Two
//! shapes are looked for:
//!
//! - **Box**: the vertical and horizontal families, `x = k·s` and `y = j·s`,
//!   square cells. A design is box-pleated when at least
//!   [`MIN_FAMILY_SHARE`] of its creased length lies on those two directions
//!   or the two 45° diagonals.
//! - **Hex**: the equilateral triangular grid — three families 60° apart with
//!   one perpendicular spacing `s`, one of them axis-aligned. The oblique
//!   families' offsets are multiples of `s` from a corner, or from half a
//!   cell up, which is where the lattice lands when it is anchored on an edge
//!   midpoint instead. A design is hex-pleated when [`MIN_FAMILY_SHARE`] of
//!   its creased length lies on the six hex directions (the three families and
//!   their perpendiculars, which are the model's own folds through the lattice
//!   points, as the 45° lines are on a box grid).
//!
//! The spacing is `w/N` or `h/N` for `N` in `MIN_GRID..=MAX_GRID`, and among
//! every candidate the one chosen scores highest on **lines the pattern has on
//! the grid, less [`FINENESS_COST`] per grid line** — so a finer grid is worth
//! it only when the pattern uses enough of it, and a stray line off the grid
//! does not double the grid to catch it. A family the pattern uses less than
//! [`MIN_FAMILY_USE`] of is left out: a pattern pleated one way is precreased
//! one way. The pattern must use at least [`MIN_GRID_USE`] of the grid it is
//! given, and at least [`MIN_GRID_LINES`] lines of it.
//!
//! # Direction
//!
//! Within a family the lines alternate mountain and valley by index, as a
//! pleat does, and the parity is the one that disagrees with the pattern's
//! own assignment over the least creased length. Grid lines the pattern does
//! not contain have no say. Which lines the pattern wants the other way is
//! reported, so the card can say so: they reverse as the model collapses.

use serde::{Deserialize, Serialize};

use crate::closure::Target;
use crate::direction::Direction;
use crate::line::Line;
use crate::sheet::Sheet;
use crate::tol::{SNAP_RADIUS, TOL};

/// The coarsest grid worth pleating as one: below this the closure folds the
/// halves and quarters in a round or two anyway.
pub const MIN_GRID: u32 = 4;
/// The finest grid looked for. A 64-grid is 126 lines on a box, 237 on a
/// hex; the state stays well under its point cap either way.
pub const MAX_GRID: u32 = 64;
/// The share of a design's creased length that must lie on the grid's own
/// directions (families and their diagonals) for the design to be pleated.
pub const MIN_FAMILY_SHARE: f64 = 0.75;
/// The share of the grid's lines the pattern must contain. A grid the design
/// barely touches is not the design's grid.
pub const MIN_GRID_USE: f64 = 0.3;
/// The share of a family's lines the pattern must contain for the family to
/// be pleated. A midline alone does not make thirty-one horizontal pleats
/// worth making.
pub const MIN_FAMILY_USE: f64 = 0.15;
/// The fewest pattern lines a grid must account for.
pub const MIN_GRID_LINES: usize = 6;
/// What each grid line costs against the pattern lines it catches, when one
/// grid is scored against another. At 0.1, doubling a 16-grid to catch one
/// stray 32nd loses; a 32-grid the pattern uses a third of wins.
pub const FINENESS_COST: f64 = 0.1;
/// How far a line's normal may be from a bucket's angle, radians. Well above
/// [`TOL`] so a raw off-lattice file's rounding still sorts its lines, and
/// far below 15°.
const ANGLE_SLACK: f64 = 1e-4;
/// How far a pattern line may sit from a grid line and still be that line:
/// the radius the exactness probe moves a line within. A design drawn a
/// hair off its own grid — an off-lattice file whose 32nds are at 0.25007 —
/// is still pleated on that grid; the line the pleat makes is the pattern's
/// own, so that everything after it closes against the pattern's geometry.
const GRID_MATCH: f64 = SNAP_RADIUS;

/// Which grid shape was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GridKind {
    /// Square cells: vertical and horizontal families.
    Box,
    /// Equilateral triangles: three families 60° apart.
    Hex,
}

/// One line of a grid family.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GridLine {
    /// Position in the family: the line is `n · p = phase + index · spacing`.
    pub index: i32,
    pub line: Line,
    /// The direction the pleat gives this line.
    pub direction: Direction,
    /// The target this line realises, when the pattern contains it.
    pub target: Option<usize>,
    /// The pattern's own direction for the line: `Unassigned` when the
    /// pattern does not contain it or assigns it nothing.
    pub pattern_direction: Direction,
    /// The share of the line's creased length `pattern_direction` covers,
    /// in `[0, 1]`; `0` when the pattern does not contain the line. Below 1
    /// the pattern creases the line both ways, whichever way it is pleated.
    pub pattern_share: f64,
}

/// A family of parallel grid lines.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GridFamily {
    /// The family's unit normal.
    pub normal: [f64; 2],
    /// Distance between adjacent lines.
    pub spacing: f64,
    /// Offset of index 0: `0` for a family anchored on an edge, `spacing / 2`
    /// for an oblique family of a lattice anchored half a cell in.
    pub phase: f64,
    /// How many strips the family cuts the sheet into, when that is a whole
    /// number: an axis-aligned family from one edge to the other, `N` for a
    /// spacing of `side / N`. `None` for an oblique family, or one whose
    /// spacing does not divide the side it crosses.
    pub cells: Option<u32>,
    /// Every line of the family that crosses the sheet, by ascending index.
    pub lines: Vec<GridLine>,
}

impl GridFamily {
    /// How many of this family's lines the pattern contains.
    pub fn in_pattern(&self) -> usize {
        self.lines.iter().filter(|l| l.target.is_some()).count()
    }

    /// How many of this family's lines the pattern wants the other way.
    pub fn reversed(&self) -> usize {
        self.lines
            .iter()
            .filter(|l| {
                l.pattern_direction != Direction::Unassigned && l.pattern_direction != l.direction
            })
            .count()
    }
}

/// The grid a design is precreased on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Grid {
    pub kind: GridKind,
    /// Cells across the sheet along the first family's normal — the width
    /// for a vertical family, the height for a horizontal one: the spacing
    /// is that side over `n`. For a hex grid on a rectangle, whose lattice is
    /// anchored on one edge and need not meet the opposite one on a line,
    /// the nearest whole number.
    pub n: u32,
    /// The families the pattern uses, axis-aligned first.
    pub families: Vec<GridFamily>,
}

impl Grid {
    /// Every line of every family.
    pub fn lines(&self) -> impl Iterator<Item = (usize, &GridLine)> {
        self.families
            .iter()
            .enumerate()
            .flat_map(|(f, family)| family.lines.iter().map(move |l| (f, l)))
    }

    /// How many lines the grid has.
    pub fn line_count(&self) -> usize {
        self.families.iter().map(|f| f.lines.len()).sum()
    }

    /// How many of them the pattern contains.
    pub fn in_pattern(&self) -> usize {
        self.families.iter().map(GridFamily::in_pattern).sum()
    }
}

/// A target as the detector sees it: which bucket its normal falls in, and
/// how much crease it carries.
struct Sorted {
    target: usize,
    bucket: Option<usize>,
    /// Creased length, or the chord's when the target carries no spans.
    weight: f64,
}

/// The twelve normals, bucket `b` at `b · 15°`.
fn bucket_normal(bucket: usize) -> [f64; 2] {
    let theta = bucket as f64 * std::f64::consts::PI / 12.0;
    [theta.cos(), theta.sin()]
}

fn length(span: &[[f64; 2]; 2]) -> f64 {
    ((span[0][0] - span[1][0]).powi(2) + (span[0][1] - span[1][1]).powi(2)).sqrt()
}

/// A target's creased length, or its chord's when it carries no spans.
fn weight_of(sheet: &Sheet, target: &Target) -> f64 {
    let spans: f64 = target.spans.iter().map(length).sum();
    if spans > 0.0 {
        return spans;
    }
    sheet
        .clip(&target.line)
        .map_or(0.0, |(a, b)| length(&[a, b]))
}

fn sort_targets(sheet: &Sheet, targets: &[Target]) -> Vec<Sorted> {
    targets
        .iter()
        .enumerate()
        .filter(|(_, t)| sheet.crosses(&t.line) && sheet.edge_of(&t.line).is_none())
        .map(|(i, t)| {
            let (theta, _) = t.line.folded_angle_offset();
            let step = std::f64::consts::PI / 12.0;
            let b = (theta / step).round();
            let bucket = ((theta - b * step).abs() <= ANGLE_SLACK)
                .then_some((b as i64).rem_euclid(12) as usize);
            Sorted {
                target: i,
                bucket,
                weight: weight_of(sheet, t),
            }
        })
        .collect()
}

/// A grid shape to try: which buckets are its families, which others are
/// its own diagonals, and which side its spacing divides.
struct Shape {
    kind: GridKind,
    families: &'static [usize],
    diagonals: &'static [usize],
    /// The oblique families may sit half a cell off the corner.
    oblique_phases: bool,
}

/// Vertical (0°) and horizontal (90°) families; 45° and 135° diagonals.
const BOX: Shape = Shape {
    kind: GridKind::Box,
    families: &[0, 6],
    diagonals: &[3, 9],
    oblique_phases: false,
};
/// Vertical lines with the two families 60° from them (normals at 60° and
/// 120°); the perpendiculars are the other three hex directions.
const HEX_VERTICAL: Shape = Shape {
    kind: GridKind::Hex,
    families: &[0, 4, 8],
    diagonals: &[2, 6, 10],
    oblique_phases: true,
};
/// Horizontal lines with the two families 60° from them.
const HEX_HORIZONTAL: Shape = Shape {
    kind: GridKind::Hex,
    families: &[6, 2, 10],
    diagonals: &[0, 4, 8],
    oblique_phases: true,
};

/// The lines of one family that cross the sheet, by ascending index, with no
/// direction or target yet.
fn family_lines(sheet: &Sheet, normal: [f64; 2], spacing: f64, phase: f64) -> Vec<(i32, Line)> {
    let corners = sheet.corners();
    let projected = corners.iter().map(|c| normal[0] * c[0] + normal[1] * c[1]);
    let lo = projected.clone().fold(f64::INFINITY, f64::min);
    let hi = projected.fold(f64::NEG_INFINITY, f64::max);
    let k_lo = ((lo - phase) / spacing).floor() as i32;
    let k_hi = ((hi - phase) / spacing).ceil() as i32;
    (k_lo..=k_hi)
        .filter_map(|k| {
            let line = Line::new(normal, phase + k as f64 * spacing)?;
            (sheet.crosses(&line) && sheet.edge_of(&line).is_none()).then_some((k, line))
        })
        .collect()
}

/// Which sorted targets lie on a family's lines: per line, the target within
/// [`GRID_MATCH`] of it, nearest first.
fn on_family(
    sorted: &[Sorted],
    bucket: usize,
    lines: &[(i32, Line)],
    targets: &[Target],
) -> Vec<Option<usize>> {
    lines
        .iter()
        .map(|(_, line)| {
            sorted
                .iter()
                .filter(|s| s.bucket == Some(bucket))
                .filter(|s| targets[s.target].line.approx_eq_within(line, GRID_MATCH))
                .min_by(|a, b| {
                    let gap = |s: &&Sorted| (targets[s.target].line.d.abs() - line.d.abs()).abs();
                    gap(a).total_cmp(&gap(b))
                })
                .map(|s| s.target)
        })
        .collect()
}

/// One candidate grid, scored.
struct Candidate {
    grid: Grid,
    score: f64,
}

fn evaluate(
    sheet: &Sheet,
    targets: &[Target],
    sorted: &[Sorted],
    shape: &Shape,
    spacing: f64,
) -> Option<Candidate> {
    // The oblique families share one phase: the lattice is anchored once.
    let phases: &[f64] = if shape.oblique_phases {
        &[0.0, 0.5]
    } else {
        &[0.0]
    };
    let mut best: Option<Candidate> = None;
    for &phase_cells in phases {
        let mut families: Vec<GridFamily> = Vec::new();
        for (fi, &bucket) in shape.families.iter().enumerate() {
            let normal = bucket_normal(bucket);
            let phase = if fi == 0 { 0.0 } else { phase_cells * spacing };
            let lines = family_lines(sheet, normal, spacing, phase);
            let on = on_family(sorted, bucket, &lines, targets);
            // The line the pleat makes where the pattern has one is the
            // pattern's own, so that what follows closes against the
            // pattern's geometry rather than a grid a hair away from it.
            let grid_lines: Vec<GridLine> = lines
                .into_iter()
                .zip(on)
                .map(|((index, line), target)| GridLine {
                    index,
                    line: target.map_or(line, |t| targets[t].line),
                    direction: Direction::Unassigned,
                    target,
                    pattern_direction: target
                        .map_or(Direction::Unassigned, |t| targets[t].direction),
                    pattern_share: target.map_or(0.0, |t| targets[t].direction_share),
                })
                .collect();
            families.push(GridFamily {
                normal,
                spacing,
                phase,
                cells: cells_of(sheet, normal, spacing, phase),
                lines: grid_lines,
            });
        }
        // A family the pattern barely uses is not pleated.
        families.retain(|f| f.in_pattern() as f64 >= MIN_FAMILY_USE * f.lines.len() as f64);
        if families.is_empty() {
            continue;
        }
        let used: usize = families.iter().map(GridFamily::in_pattern).sum();
        let total: usize = families.iter().map(|f| f.lines.len()).sum();
        if used < MIN_GRID_LINES || (used as f64) < MIN_GRID_USE * total as f64 {
            continue;
        }
        let score = used as f64 - FINENESS_COST * total as f64;
        if best.as_ref().is_none_or(|b| score > b.score) {
            // The spacing may have come from either side; the count the
            // grid is named by is along its axis family, whether or not
            // the pattern uses that family.
            let axis = bucket_normal(shape.families[0]);
            let n = (extent_along(sheet, axis) / spacing).round() as u32;
            best = Some(Candidate {
                grid: Grid {
                    kind: shape.kind,
                    n,
                    families,
                },
                score,
            });
        }
    }
    best
}

/// How far the sheet extends along `normal`: the width for a vertical
/// family, the height for a horizontal one, and the projected diagonal for
/// an oblique one.
fn extent_along(sheet: &Sheet, normal: [f64; 2]) -> f64 {
    normal[0].abs() * sheet.width + normal[1].abs() * sheet.height
}

/// How many strips a family cuts the sheet into, when the family runs from
/// one edge to the opposite one in whole cells: an axis-aligned family with
/// no phase whose spacing divides its side.
fn cells_of(sheet: &Sheet, normal: [f64; 2], spacing: f64, phase: f64) -> Option<u32> {
    let axis_aligned = normal[0].abs() < TOL || normal[1].abs() < TOL;
    if !axis_aligned || phase.abs() > TOL {
        return None;
    }
    let cells = extent_along(sheet, normal) / spacing;
    let whole = cells.round();
    ((cells - whole).abs() * spacing <= TOL).then_some(whole as u32)
}

/// Alternate each family mountain and valley by index, with the parity that
/// disagrees with the pattern over the least creased length.
fn assign_directions(grid: &mut Grid, targets: &[Target]) {
    for family in &mut grid.families {
        let cost = |parity: i32| -> f64 {
            family
                .lines
                .iter()
                .filter_map(|l| {
                    let t = &targets[l.target?];
                    let grid_dir = pleat_direction(l.index, parity);
                    let creased: f64 = t.spans.iter().map(length).sum();
                    Some(match t.direction {
                        Direction::Unassigned => 0.0,
                        d if d == grid_dir => creased * (1.0 - t.direction_share),
                        _ => creased * t.direction_share,
                    })
                })
                .sum()
        };
        // Ties go to a mountain first: the pleat is made from the front,
        // and the first crease of a pleat is the one at the edge. "First"
        // is the family's first line, whatever index it carries.
        let Some(first) = family.lines.first().map(|l| l.index) else {
            continue;
        };
        let mountain_first = first.rem_euclid(2);
        let other = 1 - mountain_first;
        let parity = if cost(other) < cost(mountain_first) {
            other
        } else {
            mountain_first
        };
        for line in &mut family.lines {
            line.direction = pleat_direction(line.index, parity);
        }
    }
}

fn pleat_direction(index: i32, parity: i32) -> Direction {
    if (index + parity).rem_euclid(2) == 0 {
        Direction::Mountain
    } else {
        Direction::Valley
    }
}

/// The grid `targets` are pleated on, if they are pleated at all.
pub fn detect(sheet: &Sheet, targets: &[Target]) -> Option<Grid> {
    let sorted = sort_targets(sheet, targets);
    let total_weight: f64 = sorted.iter().map(|s| s.weight).sum();
    if total_weight <= 0.0 {
        return None;
    }
    let mut best: Option<Candidate> = None;
    for shape in [&BOX, &HEX_VERTICAL, &HEX_HORIZONTAL] {
        let on_shape: f64 = sorted
            .iter()
            .filter(|s| {
                s.bucket
                    .is_some_and(|b| shape.families.contains(&b) || shape.diagonals.contains(&b))
            })
            .map(|s| s.weight)
            .sum();
        if on_shape < MIN_FAMILY_SHARE * total_weight {
            continue;
        }
        // Spacings from either side. The same spacing from both sides (a
        // square) is tried once.
        let mut spacings: Vec<f64> = Vec::new();
        for n in MIN_GRID..=MAX_GRID {
            for side in [sheet.width, sheet.height] {
                let s = side / n as f64;
                if !spacings.iter().any(|t| (t - s).abs() <= TOL) {
                    spacings.push(s);
                }
            }
        }
        for spacing in spacings {
            if let Some(c) = evaluate(sheet, targets, &sorted, shape, spacing)
                && best.as_ref().is_none_or(|b| c.score > b.score)
            {
                best = Some(c);
            }
        }
    }
    let mut grid = best?.grid;
    assign_directions(&mut grid, targets);
    Some(grid)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(x: f64) -> Line {
        Line::new([1.0, 0.0], x).expect("line")
    }

    fn h(y: f64) -> Line {
        Line::new([0.0, 1.0], y).expect("line")
    }

    /// A target with `m` of mountain and `v` of valley along its whole chord.
    fn target(sheet: &Sheet, line: Line, m: f64, v: f64) -> Target {
        let (a, b) = sheet.clip(&line).expect("on sheet");
        Target::new(line, vec![1], vec![[a, b]], m, v)
    }

    #[test]
    fn a_box_grid_is_found_with_its_diagonals_left_out() {
        let sheet = Sheet::unit_square();
        let mut lines: Vec<Target> = Vec::new();
        for k in 1..8 {
            let x = k as f64 / 8.0;
            lines.push(target(&sheet, v(x), 1.0, 0.0));
            lines.push(target(&sheet, h(x), 0.0, 1.0));
        }
        let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("l");
        lines.push(target(&sheet, diag, 1.0, 0.0));
        let grid = detect(&sheet, &lines).expect("a grid");
        assert_eq!(grid.kind, GridKind::Box);
        assert_eq!(grid.n, 8);
        assert_eq!(grid.families.len(), 2);
        assert_eq!(grid.line_count(), 14);
        assert_eq!(grid.in_pattern(), 14);
        // The diagonal is not a grid line.
        assert!(
            grid.lines()
                .all(|(_, l)| l.line.n[1].abs() < TOL || l.line.n[0].abs() < TOL)
        );
    }

    #[test]
    fn the_coarsest_grid_that_fits_wins_over_a_finer_one() {
        // Every 8th, plus one stray 32nd: the 8-grid catches 14 of 15 lines,
        // the 32-grid all 15 at four times the lines.
        let sheet = Sheet::unit_square();
        let mut lines: Vec<Target> = Vec::new();
        for k in 1..8 {
            let x = k as f64 / 8.0;
            lines.push(target(&sheet, v(x), 1.0, 0.0));
            lines.push(target(&sheet, h(x), 1.0, 0.0));
        }
        lines.push(target(&sheet, v(3.0 / 32.0), 1.0, 0.0));
        let grid = detect(&sheet, &lines).expect("a grid");
        assert_eq!(grid.n, 8);
        assert_eq!(grid.in_pattern(), 14);
    }

    #[test]
    fn a_finer_grid_the_pattern_uses_wins() {
        // Sixteenths, half of them: the 16-grid catches all 16, the 8-grid
        // only the even ones.
        let sheet = Sheet::unit_square();
        let mut lines: Vec<Target> = Vec::new();
        for k in (1..16).filter(|k| k % 2 == 1) {
            let x = k as f64 / 16.0;
            lines.push(target(&sheet, v(x), 1.0, 0.0));
            lines.push(target(&sheet, h(x), 1.0, 0.0));
        }
        let grid = detect(&sheet, &lines).expect("a grid");
        assert_eq!(grid.n, 16);
        assert_eq!(grid.in_pattern(), 16);
    }

    #[test]
    fn a_twenty_two_and_a_half_degree_design_is_not_pleated() {
        // Two midlines and the eight corner lines of a bird base.
        let sheet = Sheet::unit_square();
        let mut lines: Vec<Target> = vec![
            target(&sheet, v(0.5), 1.0, 0.0),
            target(&sheet, h(0.5), 1.0, 0.0),
        ];
        let t = (std::f64::consts::PI / 8.0).tan();
        for corner in sheet.corners() {
            for dir in [[t, 1.0], [1.0, t]] {
                let d = [
                    if corner[0] > 0.5 { -dir[0] } else { dir[0] },
                    if corner[1] > 0.5 { -dir[1] } else { dir[1] },
                ];
                let line = Line::from_point_direction(corner, d).expect("l");
                lines.push(target(&sheet, line, 1.0, 0.0));
            }
        }
        assert!(detect(&sheet, &lines).is_none());
    }

    #[test]
    fn a_hex_grid_is_found_from_its_three_families() {
        // A 16-column hex grid anchored at the corner: verticals at k/16 and
        // the two oblique families at multiples of 1/16 along their normals.
        let sheet = Sheet::unit_square();
        let s = 1.0 / 16.0;
        let mut lines: Vec<Target> = Vec::new();
        for k in 1..16 {
            lines.push(target(&sheet, v(k as f64 * s), 1.0, 0.0));
        }
        for bucket in [4usize, 8] {
            let n = bucket_normal(bucket);
            for k in 1..22 {
                if let Some(line) = Line::new(n, k as f64 * s)
                    && sheet.crosses(&line)
                {
                    lines.push(target(&sheet, line, 0.0, 1.0));
                }
            }
        }
        let grid = detect(&sheet, &lines).expect("a grid");
        assert_eq!(grid.kind, GridKind::Hex);
        assert_eq!(grid.n, 16);
        assert_eq!(grid.families.len(), 3);
        assert_eq!(grid.in_pattern(), lines.len());
        assert!(grid.families.iter().all(|f| f.phase == 0.0));
        // The verticals cut the sheet into 16 strips; an oblique family cuts
        // it into no whole number of anything.
        assert_eq!(grid.families[0].cells, Some(16));
        assert_eq!(grid.families[1].cells, None);
        assert_eq!(grid.families[2].cells, None);
    }

    #[test]
    fn a_hex_lattice_anchored_half_a_cell_in_is_found_with_its_phase() {
        let sheet = Sheet::unit_square();
        let s = 1.0 / 16.0;
        let mut lines: Vec<Target> = Vec::new();
        for k in 1..16 {
            lines.push(target(&sheet, v(k as f64 * s), 1.0, 0.0));
        }
        for bucket in [4usize, 8] {
            let n = bucket_normal(bucket);
            for k in 0..22 {
                if let Some(line) = Line::new(n, (k as f64 + 0.5) * s)
                    && sheet.crosses(&line)
                {
                    lines.push(target(&sheet, line, 0.0, 1.0));
                }
            }
        }
        let grid = detect(&sheet, &lines).expect("a grid");
        assert_eq!(grid.kind, GridKind::Hex);
        assert_eq!(grid.n, 16);
        assert_eq!(grid.in_pattern(), lines.len());
        assert!((grid.families[1].phase - s / 2.0).abs() < TOL);
        assert!((grid.families[2].phase - s / 2.0).abs() < TOL);
    }

    #[test]
    fn directions_alternate_with_the_parity_the_pattern_prefers() {
        // Verticals at 8ths: odd ones mountain, even ones valley, in the
        // pattern. The pleat should agree with every one of them.
        let sheet = Sheet::unit_square();
        let mut lines: Vec<Target> = Vec::new();
        for k in 1..8 {
            let x = k as f64 / 8.0;
            let (m, v_) = if k % 2 == 1 { (1.0, 0.0) } else { (0.0, 1.0) };
            lines.push(target(&sheet, v(x), m, v_));
            // Horizontals the other way round, weakly: 0.6 valley, 0.4 mountain
            // on the odd ones.
            let (hm, hv) = if k % 2 == 1 { (0.4, 0.6) } else { (0.6, 0.4) };
            lines.push(target(&sheet, h(x), hm, hv));
        }
        let grid = detect(&sheet, &lines).expect("a grid");
        let vertical = &grid.families[0];
        assert!(vertical.lines.iter().all(|l| {
            l.direction
                == if l.index % 2 == 1 {
                    Direction::Mountain
                } else {
                    Direction::Valley
                }
        }));
        assert_eq!(vertical.reversed(), 0);
        let horizontal = &grid.families[1];
        assert!(horizontal.lines.iter().all(|l| {
            l.direction
                == if l.index % 2 == 1 {
                    Direction::Valley
                } else {
                    Direction::Mountain
                }
        }));
        assert_eq!(horizontal.reversed(), 0);
    }

    #[test]
    fn a_rectangle_is_named_by_the_cells_along_its_first_family() {
        // A 2:1 sheet on 16ths of its width: the same spacing is 8ths of
        // its height, and the grid is a 16-grid whichever side produced it.
        let sheet = Sheet::new(1.0, 0.5).expect("sheet");
        let mut lines: Vec<Target> = Vec::new();
        for k in 1..16 {
            lines.push(target(&sheet, v(k as f64 / 16.0), 1.0, 0.0));
        }
        for j in 1..8 {
            lines.push(target(&sheet, h(j as f64 / 16.0), 1.0, 0.0));
        }
        let grid = detect(&sheet, &lines).expect("a grid");
        assert_eq!(grid.kind, GridKind::Box);
        assert_eq!(grid.n, 16);
        assert_eq!(grid.families[0].cells, Some(16));
        assert_eq!(grid.families[1].cells, Some(8));
        assert_eq!(grid.families[0].lines.len(), 15);
        assert_eq!(grid.families[1].lines.len(), 7);
    }

    #[test]
    fn a_tie_pleats_a_mountain_first() {
        // No direction evidence at all: the first line of each family is
        // a mountain, whatever index it carries.
        let sheet = Sheet::unit_square();
        let mut lines: Vec<Target> = Vec::new();
        for k in 1..8 {
            let x = k as f64 / 8.0;
            lines.push(target(&sheet, v(x), 0.0, 0.0));
            lines.push(target(&sheet, h(x), 0.0, 0.0));
        }
        let grid = detect(&sheet, &lines).expect("a grid");
        for family in &grid.families {
            assert_eq!(family.lines[0].direction, Direction::Mountain);
            assert_eq!(family.lines[1].direction, Direction::Valley);
        }
    }

    #[test]
    fn a_family_the_pattern_never_uses_is_left_out() {
        let sheet = Sheet::unit_square();
        let mut lines: Vec<Target> = Vec::new();
        for k in 1..16 {
            lines.push(target(&sheet, v(k as f64 / 16.0), 1.0, 0.0));
        }
        let grid = detect(&sheet, &lines).expect("a grid");
        assert_eq!(grid.kind, GridKind::Box);
        assert_eq!(grid.families.len(), 1);
        assert_eq!(grid.n, 16);
    }

    #[test]
    fn a_grid_the_pattern_barely_uses_is_no_grid() {
        // Three lines on a 64-grid and nothing else box-shaped.
        let sheet = Sheet::unit_square();
        let lines = vec![
            target(&sheet, v(1.0 / 64.0), 1.0, 0.0),
            target(&sheet, v(5.0 / 64.0), 1.0, 0.0),
            target(&sheet, h(7.0 / 64.0), 1.0, 0.0),
        ];
        assert!(detect(&sheet, &lines).is_none());
    }
}
