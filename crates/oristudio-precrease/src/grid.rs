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
//! # Only where the pattern needs it
//!
//! The finest grid that holds every gridded crease is rarely the grid the
//! sheet is on everywhere: *Alebrijes* is a 64-grid in its centre and a
//! 16-grid nearly everywhere else, and pleating 64ths across the whole sheet
//! makes sixty creases the model never uses. So a family's lines sort into
//! **levels** by the halving they come from — for `cells = q · 2^a` the
//! levels are `q, 2q, …, cells`, and a level's own lines are the ones its
//! halving adds — and each level is either **pleated whole** or made only in
//! **bands**: runs of its lines the pattern holds, merged across a gap of
//! one, bounded by lines of the coarser levels the folder can see ("the
//! 32nds between the ¼ and ¾ lines"). Halving needs the parents, so a band
//! requires every coarser line inside it, and the half line exists wherever
//! anything finer does. A level is pleated whole when its bands hold
//! [`PLEAT_SHARE`] of its lines, or all but [`PLEAT_SLACK`] — a second step
//! to save two creases is a bad trade — and consecutive whole levels from
//! the coarsest collapse into the family's one pleat. A band step of fewer
//! than [`MIN_REGION_LINES`] lines is not a step: that level and every finer
//! one are left to the closure, which folds a stray line as it folds any.
//! An oblique family has no cells to halve and is pleated whole. See
//! `implementation-plans/precrease-grid-where-needed.md`.
//!
//! # Direction
//!
//! A pleat's lines alternate mountain and valley in order, as a pleat does,
//! and the parity is the one that disagrees with the pattern's own
//! assignment over the least creased length; grid lines the pattern does
//! not contain have no say, and which lines the pattern wants the other way
//! is reported, so the card can say so: they reverse as the model collapses.
//! A band step's lines are not adjacent on the sheet — a parent sits between
//! each pair — so alternation would name a rhythm with no physical meaning:
//! each takes the pattern's own direction, and a line the pattern lacks the
//! step's majority.

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
/// The share of a level's lines its bands must hold for the level to be
/// pleated whole rather than made in bands.
pub const PLEAT_SHARE: f64 = 0.75;
/// A level whose bands leave out no more than this many lines is pleated
/// whole: a band step to save two creases costs more than it saves.
pub const PLEAT_SLACK: usize = 2;
/// The fewest lines a band step may have. Below it the level's lines, and
/// every finer level's, are the closure's: "fold the edge onto the ¼ line"
/// is one card, and a better one than a pleat of one.
pub const MIN_REGION_LINES: usize = 3;
/// How many lines a band may skip over between two the pattern holds: one
/// unwanted crease against a second instruction.
pub const BAND_GAP: usize = 1;
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
    /// The halving level the line belongs to, as that level's cells across
    /// the side: the half line is level 2, the quarters 4, and so on; `0`
    /// for a family with no cells to halve.
    pub level: u32,
    /// Whether a step of the family makes this line. A line of a level made
    /// in bands that lies outside every band is not made, and the pattern's
    /// creases on it, if any, are the closure's.
    pub made: bool,
}

/// A band of one level's lines: a run the pattern holds, with the coarser
/// lines that bound it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GridBand {
    /// Indices of the family's lines bounding the band — lines of a coarser
    /// level, or the sheet's edge at index `0` or `cells`.
    pub lo: i32,
    pub hi: i32,
    /// Positions in [`GridFamily::lines`] of the band's lines, ascending.
    pub lines: Vec<usize>,
}

/// One step of a family: a level pleated whole, or made in bands.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GridFamilyStep {
    /// The finest level the step makes, as its cells across the side — a
    /// pleat of 16ths, or the 32nds. `0` for an oblique family's pleat.
    pub level: u32,
    /// Pleated edge to edge, every line of the level and of every coarser
    /// level, in one step.
    pub pleat: bool,
    /// The bands, when not a pleat.
    pub bands: Vec<GridBand>,
    /// Positions in [`GridFamily::lines`] of every line the step makes,
    /// ascending.
    pub lines: Vec<usize>,
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
    /// The steps that make the family's lines: its pleat first, then its
    /// band steps coarse to fine. Empty when nothing of the family is made.
    pub steps: Vec<GridFamilyStep>,
}

impl GridFamily {
    /// How many of this family's lines the pattern contains.
    pub fn in_pattern(&self) -> usize {
        self.lines.iter().filter(|l| l.target.is_some()).count()
    }

    /// How many of this family's lines its steps make.
    pub fn made(&self) -> usize {
        self.lines.iter().filter(|l| l.made).count()
    }

    /// How many of the lines its steps make the pattern wants the other way.
    pub fn reversed(&self) -> usize {
        self.lines
            .iter()
            .filter(|l| {
                l.made
                    && l.pattern_direction != Direction::Unassigned
                    && l.pattern_direction != l.direction
            })
            .count()
    }

    /// The step that makes the line at position `li`, if one does.
    pub fn step_of(&self, li: usize) -> Option<usize> {
        self.steps.iter().position(|s| s.lines.contains(&li))
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

    /// How many lines the grid's steps make.
    pub fn made(&self) -> usize {
        self.families.iter().map(GridFamily::made).sum()
    }

    /// How many steps the grid has, over every family.
    pub fn step_count(&self) -> usize {
        self.families.iter().map(|f| f.steps.len()).sum()
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
                    level: 0,
                    made: true,
                })
                .collect();
            families.push(GridFamily {
                normal,
                spacing,
                phase,
                cells: cells_of(sheet, normal, spacing, phase),
                lines: grid_lines,
                steps: Vec::new(),
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

/// The halving level of line `k` of a family of `cells` strips, as that
/// level's cells across the side: for `cells = q · 2^a`, the coarsest level
/// whose lines include `k`. The half line of a 16-family is level 2, its
/// quarters 4, an odd 16th 16; every line of a 13-family is level 13.
fn level_of(k: i32, cells: u32) -> u32 {
    let a = cells.trailing_zeros();
    let q = cells >> a;
    let v = k.unsigned_abs().trailing_zeros().min(a);
    q << (a - v)
}

/// The levels of a family of `cells` strips, coarsest first: the odd base
/// when there is one, then each halving.
fn level_chain(cells: u32) -> Vec<u32> {
    let a = cells.trailing_zeros();
    let q = cells >> a;
    let mut chain: Vec<u32> = Vec::new();
    if q > 1 {
        chain.push(q);
    }
    chain.extend((1..=a).map(|j| q << j));
    chain
}

/// Which lines a level makes, and which it requires of the coarser ones.
struct LevelPlan {
    level: u32,
    pleat: bool,
    bands: Vec<GridBand>,
    lines: Vec<usize>,
}

/// The steps of `family`, given which of its lines count as needed, with
/// the levels at chain position `cut` and beyond left out. Levels are read
/// finest first, because a band requires the coarser lines it is halved
/// between and those requirements flow one way. Returns the plans coarsest
/// first, or the chain position of the coarsest level too thin to be a step.
fn plan_levels(
    family: &GridFamily,
    cells: u32,
    chain: &[u32],
    cut: usize,
) -> Result<Vec<LevelPlan>, usize> {
    let mut required = vec![false; family.lines.len()];
    let mut plans: Vec<LevelPlan> = Vec::new();
    let mut thin: Option<usize> = None;
    for (ci, &level) in chain.iter().enumerate().take(cut).rev() {
        let unit = (cells / level) as i32;
        let positions: Vec<usize> = family
            .lines
            .iter()
            .enumerate()
            .filter(|(_, l)| l.level == level)
            .map(|(p, _)| p)
            .collect();
        let total = positions.len();
        if total == 0 {
            continue;
        }
        let needed: Vec<usize> = positions
            .iter()
            .enumerate()
            .filter(|&(_, &p)| family.lines[p].target.is_some() || required[p])
            .map(|(j, _)| j)
            .collect();
        if needed.is_empty() {
            continue;
        }
        // Runs of needed lines, merged across a gap of `BAND_GAP`.
        let mut runs: Vec<(usize, usize)> = Vec::new();
        for &j in &needed {
            match runs.last_mut() {
                Some(run) if j - run.1 <= BAND_GAP + 1 => run.1 = j,
                _ => runs.push((j, j)),
            }
        }
        let in_bands: usize = runs.iter().map(|(a, b)| b - a + 1).sum();
        let pleat = in_bands as f64 >= (PLEAT_SHARE * total as f64).ceil()
            || in_bands + PLEAT_SLACK >= total;
        let mut require = |lo: i32, hi: i32| {
            for (p, l) in family.lines.iter().enumerate() {
                if l.level < level && l.index >= lo && l.index <= hi {
                    required[p] = true;
                }
            }
        };
        if pleat {
            require(0, cells as i32);
            plans.push(LevelPlan {
                level,
                pleat: true,
                bands: Vec::new(),
                lines: positions,
            });
            continue;
        }
        if in_bands < MIN_REGION_LINES {
            thin = Some(ci);
            continue;
        }
        let bands: Vec<GridBand> = runs
            .iter()
            .map(|&(a, b)| {
                let lo = family.lines[positions[a]].index - unit;
                let hi = family.lines[positions[b]].index + unit;
                require(lo, hi);
                GridBand {
                    lo,
                    hi,
                    lines: positions[a..=b].to_vec(),
                }
            })
            .collect();
        plans.push(LevelPlan {
            level,
            pleat: false,
            lines: bands.iter().flat_map(|b| b.lines.iter().copied()).collect(),
            bands,
        });
    }
    if let Some(ci) = thin {
        return Err(ci);
    }
    plans.reverse();
    Ok(plans)
}

/// Decide each family's steps: its pleat, then its band steps coarse to
/// fine — see the module doc. A family with no cells to halve is one pleat,
/// and so is every family when the grid is wanted `whole`.
fn plan_steps(grid: &mut Grid, whole: bool) {
    for family in &mut grid.families {
        let Some(cells) = family.cells.filter(|_| !whole) else {
            for l in &mut family.lines {
                l.level = 0;
                l.made = true;
            }
            family.steps = vec![GridFamilyStep {
                level: family.cells.unwrap_or(0),
                pleat: true,
                bands: Vec::new(),
                lines: (0..family.lines.len()).collect(),
            }];
            continue;
        };
        for l in &mut family.lines {
            l.level = level_of(l.index, cells);
            l.made = false;
        }
        let chain = level_chain(cells);
        // A level too thin to be a step takes every finer level with it,
        // and what those required of the coarser ones goes too.
        let mut cut = chain.len();
        let plans = loop {
            match plan_levels(family, cells, &chain, cut) {
                Ok(plans) => break plans,
                Err(ci) => cut = ci,
            }
        };
        // Consecutive whole levels from the coarsest are one pleat.
        let mut steps: Vec<GridFamilyStep> = Vec::new();
        for plan in plans {
            match steps.last_mut() {
                Some(last) if last.pleat && plan.pleat => {
                    last.level = plan.level;
                    last.lines.extend(plan.lines);
                    last.lines.sort_unstable();
                }
                _ => steps.push(GridFamilyStep {
                    level: plan.level,
                    pleat: plan.pleat,
                    bands: plan.bands,
                    lines: plan.lines,
                }),
            }
        }
        for step in &steps {
            for &p in &step.lines {
                family.lines[p].made = true;
            }
        }
        family.steps = steps;
    }
    grid.families.retain(|f| !f.steps.is_empty());
}

/// A pleat alternates mountain and valley in order, with the parity that
/// disagrees with the pattern over the least creased length; a band step's
/// lines take the pattern's own direction, or the step's majority.
fn assign_directions(grid: &mut Grid, targets: &[Target]) {
    for family in &mut grid.families {
        for step in &family.steps {
            if step.pleat {
                let cost = |parity: usize| -> f64 {
                    step.lines
                        .iter()
                        .enumerate()
                        .filter_map(|(rank, &p)| {
                            let t = &targets[family.lines[p].target?];
                            let grid_dir = pleat_direction(rank, parity);
                            let creased: f64 = t.spans.iter().map(length).sum();
                            Some(match t.direction {
                                Direction::Unassigned => 0.0,
                                d if d == grid_dir => creased * (1.0 - t.direction_share),
                                _ => creased * t.direction_share,
                            })
                        })
                        .sum()
                };
                // Ties go to a mountain first: the pleat is made from the
                // front, and the first crease of a pleat is the one at the
                // edge.
                let parity = if cost(1) < cost(0) { 1 } else { 0 };
                for (rank, &p) in step.lines.iter().enumerate() {
                    family.lines[p].direction = pleat_direction(rank, parity);
                }
            } else {
                let mountains = step
                    .lines
                    .iter()
                    .filter(|&&p| family.lines[p].pattern_direction == Direction::Mountain)
                    .count();
                let valleys = step
                    .lines
                    .iter()
                    .filter(|&&p| family.lines[p].pattern_direction == Direction::Valley)
                    .count();
                let majority = if valleys > mountains {
                    Direction::Valley
                } else {
                    Direction::Mountain
                };
                for &p in &step.lines {
                    let line = &mut family.lines[p];
                    line.direction = match line.pattern_direction {
                        Direction::Unassigned => majority,
                        d => d,
                    };
                }
            }
        }
    }
}

fn pleat_direction(rank: usize, parity: usize) -> Direction {
    if (rank + parity).is_multiple_of(2) {
        Direction::Mountain
    } else {
        Direction::Valley
    }
}

/// The grid `targets` are pleated on, if they are pleated at all: every
/// family one pleat when `whole`, otherwise each made only where the pattern
/// needs it (the module doc).
pub fn detect(sheet: &Sheet, targets: &[Target], whole: bool) -> Option<Grid> {
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
    plan_steps(&mut grid, whole);
    if grid.families.is_empty() {
        return None;
    }
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
        let grid = detect(&sheet, &lines, false).expect("a grid");
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
        let grid = detect(&sheet, &lines, false).expect("a grid");
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
        let grid = detect(&sheet, &lines, false).expect("a grid");
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
        assert!(detect(&sheet, &lines, false).is_none());
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
        let grid = detect(&sheet, &lines, false).expect("a grid");
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
        let grid = detect(&sheet, &lines, false).expect("a grid");
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
        let grid = detect(&sheet, &lines, false).expect("a grid");
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
        let grid = detect(&sheet, &lines, false).expect("a grid");
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
        let grid = detect(&sheet, &lines, false).expect("a grid");
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
        let grid = detect(&sheet, &lines, false).expect("a grid");
        assert_eq!(grid.kind, GridKind::Box);
        assert_eq!(grid.families.len(), 1);
        assert_eq!(grid.n, 16);
    }

    /// Verticals and horizontals at every `k/n` in `axis`, plus the extra
    /// lines named, both ways.
    fn box_pattern(sheet: &Sheet, n: u32, axis: &[u32], extra: &[(u32, u32)]) -> Vec<Target> {
        let mut lines: Vec<Target> = Vec::new();
        for &k in axis {
            let x = k as f64 / n as f64;
            lines.push(target(sheet, v(x), 1.0, 0.0));
            lines.push(target(sheet, h(x), 0.0, 1.0));
        }
        for &(k, d) in extra {
            let x = k as f64 / d as f64;
            lines.push(target(sheet, v(x), 1.0, 0.0));
            lines.push(target(sheet, h(x), 0.0, 1.0));
        }
        lines
    }

    type StepShape = (u32, bool, Vec<(i32, i32, usize)>);

    fn steps_of(family: &GridFamily) -> Vec<StepShape> {
        family
            .steps
            .iter()
            .map(|s| {
                (
                    s.level,
                    s.pleat,
                    s.bands
                        .iter()
                        .map(|b| (b.lo, b.hi, b.lines.len()))
                        .collect(),
                )
            })
            .collect()
    }

    #[test]
    fn a_finer_level_the_pattern_uses_only_across_the_middle_is_a_band() {
        // Every 16th, and the 32nds between ¼ and ¾ only: pleat 16ths, then
        // the 32nds in one band between the ¼ and ¾ lines.
        let sheet = Sheet::unit_square();
        let axis: Vec<u32> = (1..16).collect();
        let odd: Vec<(u32, u32)> = (9..=23).step_by(2).map(|k| (k, 32)).collect();
        let lines = box_pattern(&sheet, 16, &axis, &odd);
        let grid = detect(&sheet, &lines, false).expect("a grid");
        assert_eq!(grid.n, 32);
        for family in &grid.families {
            assert_eq!(
                steps_of(family),
                vec![(16, true, vec![]), (32, false, vec![(8, 24, 8)])]
            );
            assert_eq!(family.made(), 23);
            assert_eq!(family.lines.len(), 31);
            // The pleat's lines are the even indices, alternating in order
            // from whichever way its first line goes; the band's are the
            // pattern's own, made the way it wants them.
            let pleat = &family.steps[0];
            let first = family.lines[pleat.lines[0]].direction;
            let other = if first == Direction::Mountain {
                Direction::Valley
            } else {
                Direction::Mountain
            };
            for (rank, &p) in pleat.lines.iter().enumerate() {
                assert_eq!(family.lines[p].index % 2, 0);
                assert_eq!(
                    family.lines[p].direction,
                    if rank % 2 == 0 { first } else { other }
                );
            }
            for &p in &family.steps[1].lines {
                let l = &family.lines[p];
                assert!(l.target.is_some());
                assert_eq!(l.direction, l.pattern_direction);
            }
            for l in family.lines.iter().filter(|l| !l.made) {
                assert!(l.target.is_none(), "an unmade line the pattern holds");
            }
        }
        assert_eq!(grid.step_count(), 4);
    }

    #[test]
    fn a_level_the_pattern_holds_most_of_is_pleated_whole() {
        // 8ths, and six of the eight 16ths: a second step to save two
        // creases is a bad trade, so the 16ths are pleated whole.
        let sheet = Sheet::unit_square();
        let axis: Vec<u32> = (1..8).collect();
        let odd: Vec<(u32, u32)> = [3, 5, 7, 9, 11, 13].iter().map(|&k| (k, 16)).collect();
        let lines = box_pattern(&sheet, 8, &axis, &odd);
        let grid = detect(&sheet, &lines, false).expect("a grid");
        assert_eq!(grid.n, 16);
        for family in &grid.families {
            assert_eq!(steps_of(family), vec![(16, true, vec![])]);
            assert_eq!(family.made(), 15);
        }
    }

    #[test]
    fn a_thin_band_is_left_to_the_closure_with_everything_finer() {
        // 8ths and two stray 16ths: two lines are not a step, so the 16ths
        // are the closure's and the family is a pleat of 8ths.
        let sheet = Sheet::unit_square();
        let axis: Vec<u32> = (1..8).collect();
        let lines = box_pattern(&sheet, 8, &axis, &[(3, 16), (11, 16)]);
        let grid = detect(&sheet, &lines, false).expect("a grid");
        assert_eq!(grid.n, 16);
        for family in &grid.families {
            assert_eq!(steps_of(family), vec![(8, true, vec![])]);
            assert_eq!(family.made(), 7);
            let stray: Vec<i32> = family
                .lines
                .iter()
                .filter(|l| !l.made && l.target.is_some())
                .map(|l| l.index)
                .collect();
            assert_eq!(stray, vec![3, 11]);
        }
    }

    #[test]
    fn the_half_line_is_made_wherever_anything_finer_is() {
        // The 8ths and four 16ths in a band, and no half line anywhere in
        // the pattern: halving needs its parents, so the quarters and the
        // half line are pleated though the pattern holds neither.
        let sheet = Sheet::unit_square();
        let odd: Vec<(u32, u32)> = [5, 7, 9, 11].iter().map(|&k| (k, 16)).collect();
        let lines = box_pattern(&sheet, 16, &[2, 6, 10, 14], &odd);
        let grid = detect(&sheet, &lines, false).expect("a grid");
        assert_eq!(grid.n, 16);
        for family in &grid.families {
            assert_eq!(
                steps_of(family),
                vec![(8, true, vec![]), (16, false, vec![(4, 12, 4)])]
            );
            assert!(
                family
                    .lines
                    .iter()
                    .any(|l| l.index == 8 && l.made && l.target.is_none()),
                "the half line is made for the halving"
            );
        }
    }

    #[test]
    fn an_odd_base_is_made_in_bands_too() {
        // 13ths on the left two thirds of a 26-grid: no halving made them,
        // so the band is bounded by positions rather than lines.
        let sheet = Sheet::unit_square();
        let extra: Vec<(u32, u32)> = (1..=8).map(|j| (j, 13)).collect();
        let lines = box_pattern(&sheet, 26, &[], &extra);
        let grid = detect(&sheet, &lines, false).expect("a grid");
        assert_eq!(grid.n, 13);
        for family in &grid.families {
            assert_eq!(steps_of(family), vec![(13, false, vec![(0, 9, 8)])]);
        }
    }

    #[test]
    fn a_whole_grid_is_one_pleat_per_family() {
        let sheet = Sheet::unit_square();
        let axis: Vec<u32> = (1..16).collect();
        let odd: Vec<(u32, u32)> = (9..=23).step_by(2).map(|k| (k, 32)).collect();
        let lines = box_pattern(&sheet, 16, &axis, &odd);
        let grid = detect(&sheet, &lines, true).expect("a grid");
        for family in &grid.families {
            assert_eq!(steps_of(family), vec![(32, true, vec![])]);
            assert_eq!(family.made(), 31);
        }
    }

    #[test]
    fn levels_come_from_the_halving() {
        assert_eq!(level_of(8, 16), 2);
        assert_eq!(level_of(4, 16), 4);
        assert_eq!(level_of(12, 16), 4);
        assert_eq!(level_of(6, 16), 8);
        assert_eq!(level_of(1, 16), 16);
        assert_eq!(level_of(8, 24), 3);
        assert_eq!(level_of(12, 24), 6);
        assert_eq!(level_of(6, 24), 12);
        assert_eq!(level_of(3, 24), 24);
        assert_eq!(level_of(5, 13), 13);
        assert_eq!(level_of(6, 26), 13);
        assert_eq!(level_of(7, 26), 26);
        assert_eq!(level_chain(16), vec![2, 4, 8, 16]);
        assert_eq!(level_chain(24), vec![3, 6, 12, 24]);
        assert_eq!(level_chain(13), vec![13]);
        assert_eq!(level_chain(26), vec![13, 26]);
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
        assert!(detect(&sheet, &lines, false).is_none());
    }
}
