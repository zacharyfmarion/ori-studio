//! The planner driver: one component in, a precrease sequence out.
//!
//! `Planner::new` applies the exactness policy (plan decision D8): an
//! **exact** component is planned as is; a **snappable** one is planned on
//! its snapped copy and the maximum displacement is reported; an
//! **off-lattice** one gets the closure only — every remaining line becomes
//! a finding, nothing approximate is ever folded; a **refused** sheet gets
//! a status and nothing else. From there the driver runs the closure,
//! the stuck search, and the presentation passes, all resumable and
//! budgeted through a caller-supplied clock, and answers `explain` for any
//! line.

use serde::{Deserialize, Serialize};

use crate::clock::{Clock, Deadline, default_clock};
use crate::closure::{CloseOutcome, Closure, FoldOutcome, FoldedLine, Target};
use crate::components::Component;
use crate::direction::{Direction, share_of};
use crate::drive::{self, DriverState, LastStep, PlanAction, PlanState, StopReason};
use crate::error::PrecreaseError;
use crate::exactness::ExactnessClass;
use crate::grid::{self, GridAlong};
use crate::line::Line;
use crate::marks::crease_runs;
use crate::merge::coalesce_lines;
use crate::order::{Placed, group, order, pattern};
use crate::pinch::{Extent, pinch_pass};
use crate::predicates::{Ref, Witness, full_facts, witnesses};
use crate::sequence::{
    Diagnostics, ExactnessSummary, FactsSummary, Finding, FindingReason, GridBound, GridRegion,
    GridStep, GridStepLine, GridSummary, Group, LineEntry, PointEntry, Sequence, Status, Step,
    StepKind, StepPress, Totals,
};
use crate::sheet::{EdgeSide, Sheet};
use crate::state::{DEFAULT_POINT_CAP, LineTag};
use crate::stuck::{StuckOptions, stuck_search};
use crate::tol::SNAP_RADIUS;

/// Planner knobs. The JSON form ([`PlannerOptionsJson`]) is what crosses the
/// wasm boundary; every field is optional there.
#[derive(Debug, Clone, Copy)]
pub struct PlannerOptions {
    pub point_cap: usize,
    pub stuck: StuckOptions,
    /// Per stuck event, milliseconds. The plan's working value was 2 s; the
    /// slowest search measured over the 31 components of `iguana_24.osf` —
    /// component 15, 588 segments merging to 95 lines — takes 1.92 s in
    /// release, so a 2 s cap would truncate a real search non-deterministically.
    /// 4 s is twice the measured worst case and still well inside the total.
    pub stuck_budget_ms: f64,
    /// Overall budget for `plan`, milliseconds (plan: 30 s default; the whole
    /// iguana canvas, all 31 components, plans in 3.3 s).
    pub total_budget_ms: f64,
    /// Whether the closure prefers targets whose creases have findable ends
    /// ([`Closure::set_prefer_findable_ends`]). Measurement scaffolding: the
    /// off state exists so the two orders can be compared on the corpus, and
    /// comes out once that comparison is recorded.
    pub prefer_findable_ends: bool,
    /// Whether a sweep folds first the targets the folder could sight on the
    /// paper as it stands ([`Closure::set_prefer_sightable`]), so the marks a
    /// fold needs are made by the pattern's own creases rather than by a
    /// press. On by default; the off state is the corpus comparison.
    pub prefer_sightable: bool,
    /// Whether a box- or hex-pleated design opens with its grid pleated
    /// before anything is sighted ([`crate::grid`]), and how much of it.
    /// Where needed by default: that is how such a design is precreased.
    pub precrease_grid: GridMode,
    /// Whether a CP step's crease is one run from reference to reference —
    /// the pattern's pieces joined, each end carried out to the nearest edge
    /// or crease the folder can find ([`crate::marks::reach`]) — or exactly
    /// the pattern's pieces. On by default: it is how a diagram instructs a
    /// fold. Off keeps the precrease to the pattern, lost ends and all, and
    /// is what the corpus measurement compares against.
    pub reach_references: bool,
    /// Whether a crease may end on blank paper at one end. On by default: a
    /// crease is anchored at one reference and carried to the second only
    /// when that costs no more crease than there already is, so a short
    /// crease may dangle at one end. Off, every crease runs from reference
    /// to reference, whatever crease past the pattern that takes
    /// ([`crate::marks::reach`]).
    pub allow_dangling_folds: bool,
    /// Whether the closure holds back a line whose crease, made as soon as
    /// the line can be constructed, would be carried past the pattern's
    /// ends by more than twice that crease's length, while a line still to come would
    /// put a reference at one of its ends ([`Closure::set_defer_far_anchors`]).
    /// On by default; off folds every line in the first round it can be.
    pub defer_far_anchors: bool,
    pub clock: Clock,
}

/// How much of a pleated design's grid the plan opens with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum GridMode {
    /// No grid step: every line is sighted, the grid's own included.
    Off,
    /// Every line of the grid, edge to edge, one pleat per family.
    Whole,
    /// The lines the pattern uses, at the resolution each part of the sheet
    /// needs — [`crate::grid`]'s levels and bands.
    #[default]
    WhereNeeded,
}

impl Default for PlannerOptions {
    fn default() -> Self {
        Self {
            point_cap: DEFAULT_POINT_CAP,
            stuck: StuckOptions::default(),
            stuck_budget_ms: 4000.0,
            total_budget_ms: 30_000.0,
            prefer_findable_ends: true,
            prefer_sightable: true,
            precrease_grid: GridMode::WhereNeeded,
            reach_references: true,
            allow_dangling_folds: true,
            defer_far_anchors: true,
            clock: default_clock(),
        }
    }
}

/// The JSON shape of the options: `{ point_cap, max_depth, depth3_threshold,
/// max_candidates, stuck_budget_ms, total_budget_ms, precrease_grid,
/// grid_where_needed, reach_references, allow_dangling_folds,
/// defer_far_anchors, prefer_sightable }`, all optional.
/// `precrease_grid` is
/// the toggle and `grid_where_needed` says how much of the grid a plan opens
/// with, so a caller that sends only the toggle still gets a grid.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PlannerOptionsJson {
    pub point_cap: Option<usize>,
    pub max_depth: Option<u8>,
    pub depth3_threshold: Option<usize>,
    pub max_candidates: Option<usize>,
    pub stuck_budget_ms: Option<f64>,
    pub total_budget_ms: Option<f64>,
    pub precrease_grid: Option<bool>,
    pub grid_where_needed: Option<bool>,
    pub reach_references: Option<bool>,
    pub allow_dangling_folds: Option<bool>,
    pub defer_far_anchors: Option<bool>,
    pub prefer_sightable: Option<bool>,
}

impl PlannerOptions {
    /// Options from their JSON form (an empty string means defaults).
    pub fn from_json(json: &str) -> Result<PlannerOptions, PrecreaseError> {
        let parsed: PlannerOptionsJson = if json.trim().is_empty() {
            PlannerOptionsJson::default()
        } else {
            serde_json::from_str(json).map_err(|e| PrecreaseError::InvalidOptions {
                reason: e.to_string(),
            })?
        };
        let mut opts = PlannerOptions::default();
        if let Some(cap) = parsed.point_cap {
            opts.point_cap = cap;
        }
        if let Some(d) = parsed.max_depth {
            opts.stuck.max_depth = d.clamp(1, 3);
        }
        if let Some(t) = parsed.depth3_threshold {
            opts.stuck.depth3_threshold = t;
        }
        if let Some(c) = parsed.max_candidates {
            opts.stuck.candidates.max_candidates = c.max(1);
        }
        if let Some(on) = parsed.reach_references {
            opts.reach_references = on;
        }
        if let Some(on) = parsed.allow_dangling_folds {
            opts.allow_dangling_folds = on;
        }
        if let Some(on) = parsed.defer_far_anchors {
            opts.defer_far_anchors = on;
        }
        if let Some(on) = parsed.prefer_sightable {
            opts.prefer_sightable = on;
        }
        opts.precrease_grid = match (
            parsed.precrease_grid.unwrap_or(true),
            parsed.grid_where_needed.unwrap_or(true),
        ) {
            (false, _) => GridMode::Off,
            (true, false) => GridMode::Whole,
            (true, true) => GridMode::WhereNeeded,
        };
        for (value, slot) in [
            (parsed.stuck_budget_ms, &mut opts.stuck_budget_ms),
            (parsed.total_budget_ms, &mut opts.total_budget_ms),
        ] {
            if let Some(v) = value {
                if !v.is_finite() || v < 0.0 {
                    return Err(PrecreaseError::InvalidOptions {
                        reason: "budgets must be finite and non-negative".to_string(),
                    });
                }
                *slot = v;
            }
        }
        Ok(opts)
    }
}

/// A remaining CP line as the TypeScript side needs it for a
/// ReferenceFinder query: canonical form plus two in-frame points.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RemainingLine {
    pub target: usize,
    pub line: Line,
    pub segment: [[f64; 2]; 2],
    pub cp_line_ids: Vec<u32>,
}

/// What one stuck event decided.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StuckSummary {
    pub aux: Vec<Line>,
    pub aux_folds: usize,
    pub visible_aux: usize,
    pub unlocked: usize,
    pub ease_sum: u32,
    pub depth_reached: u8,
    pub exhausted: bool,
    /// The chosen set finished the closure rather than only unsticking it.
    pub complete: bool,
    pub root_candidates: usize,
    pub candidates_evaluated: usize,
    pub closures_run: usize,
}

/// Everything known about one line, for the UI's "why".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Explanation {
    pub line: Line,
    pub folded: bool,
    /// State line id when folded.
    pub line_id: Option<usize>,
    pub tag: Option<LineTag>,
    pub round: Option<u32>,
    pub is_target: bool,
    pub remaining: bool,
    pub cp_line_ids: Vec<u32>,
    /// Recorded at fold time for a folded line; against the current state
    /// otherwise.
    pub witnesses: Vec<Witness>,
    pub chosen: Option<usize>,
    /// Facts against the current state.
    pub facts: FactsSummary,
}

/// The planner over one component.
#[derive(Debug, Clone)]
pub struct Planner {
    opts: PlannerOptions,
    component_id: u32,
    sheet: Option<Sheet>,
    closure: Option<Closure>,
    exactness: Option<ExactnessSummary>,
    off_lattice: bool,
    /// Targets folded by an approximation ([`Self::fold_approximation`]).
    approximations: u32,
    refused: bool,
    stuck_events: Vec<StuckSummary>,
    budget_hit: bool,
    point_cap_hit: bool,
    rf_lines_folded: u32,
    candidates_evaluated: u64,
    closures_run: u64,
    started_ms: f64,
    elapsed_ms: f64,
}

fn segment_of(sheet: &Sheet, line: &Line) -> Option<[[f64; 2]; 2]> {
    sheet.clip(line).map(|(a, b)| [a, b])
}

/// The grid's steps, numbered from 1: the pleats first, one per family, then
/// the band steps coarse to fine with the families interleaved — pleated from
/// the front, with no witness, before anything else is on the paper.
///
/// A step's own `line`, `line_id` and `segment` are its first line, so that
/// every step has one; the rest is in `grid`. The step carries every pattern
/// crease its lines contain, so the canvas's crease visibility reads it as it
/// reads any other.
fn grid_steps(closure: &Closure, sheet: &Sheet) -> Vec<Step> {
    let Some(grid) = closure.grid() else {
        return Vec::new();
    };
    let targets = closure.targets();
    // (family, step) in presentation order.
    let mut order: Vec<(usize, usize)> = Vec::new();
    for (fi, family) in grid.families.iter().enumerate() {
        order.extend(
            family
                .steps
                .iter()
                .enumerate()
                .filter(|(_, s)| s.pleat)
                .map(|(si, _)| (fi, si)),
        );
    }
    let mut bands: Vec<(u32, usize, usize)> = grid
        .families
        .iter()
        .enumerate()
        .flat_map(|(fi, family)| {
            family
                .steps
                .iter()
                .enumerate()
                .filter(|(_, s)| !s.pleat)
                .map(move |(si, s)| (s.level, fi, si))
        })
        .collect();
    bands.sort_by_key(|&(level, fi, si)| (level, fi, si));
    order.extend(bands.into_iter().map(|(_, fi, si)| (fi, si)));

    let folded_line = |fi: usize, li: usize| {
        closure
            .folded()
            .iter()
            .find(|f| f.grid.is_some_and(|g| g.family == fi && g.line == li))
    };
    order
        .iter()
        .enumerate()
        .filter_map(|(k, &(fi, si))| {
            let family = &grid.families[fi];
            let step = &family.steps[si];
            let lines: Vec<GridStepLine> = step
                .lines
                .iter()
                .filter_map(|&li| {
                    let gl = &family.lines[li];
                    let f = folded_line(fi, li)?;
                    let target = f.target.map(|t| &targets[t]);
                    Some(GridStepLine {
                        line_id: f.line_id,
                        line: f.line,
                        segment: segment_of(sheet, &f.line).unwrap_or([[0.0; 2]; 2]),
                        spans: gl.spans.clone(),
                        index: gl.index,
                        direction: gl.direction,
                        pattern_direction: gl.pattern_direction,
                        pattern_share: gl.pattern_share,
                        cp_line_ids: target.map(|t| t.cp_line_ids.clone()).unwrap_or_default(),
                        cp_spans: target.map(|t| t.spans.clone()).unwrap_or_default(),
                    })
                })
                .collect();
            let first = lines.first()?;
            // A bound of a family at its index: the sheet's edge at the
            // family's ends, else the family's line there when a step made
            // it, else a position across the sheet.
            let bound = |fi: usize, index: i32| -> GridBound {
                let family = &grid.families[fi];
                let cells = family.cells.unwrap_or(0) as i32;
                let vertical = family.normal[0].abs() >= family.normal[1].abs();
                let edge = if index <= 0 {
                    Some(if vertical {
                        EdgeSide::Left
                    } else {
                        EdgeSide::Bottom
                    })
                } else if index >= cells {
                    Some(if vertical {
                        EdgeSide::Right
                    } else {
                        EdgeSide::Top
                    })
                } else {
                    None
                };
                GridBound {
                    index,
                    fraction: if cells > 0 {
                        index as f64 / cells as f64
                    } else {
                        0.0
                    },
                    edge,
                    line_id: edge
                        .is_none()
                        .then(|| {
                            family
                                .lines
                                .iter()
                                .position(|l| l.index == index && l.made)
                                .and_then(|li| folded_line(fi, li))
                                .map(|f| f.line_id)
                        })
                        .flatten(),
                }
            };
            let along_bound = |along: GridAlong| -> GridBound {
                match along {
                    GridAlong::Edge(side) => GridBound {
                        index: 0,
                        fraction: match side {
                            EdgeSide::Left | EdgeSide::Bottom => 0.0,
                            EdgeSide::Right | EdgeSide::Top => 1.0,
                        },
                        edge: Some(side),
                        line_id: None,
                    },
                    GridAlong::Line { family: of, line } => {
                        bound(of, grid.families[of].lines[line].index)
                    }
                }
            };
            // Where along the step's first line's drawn chord a parameter on
            // the family's axis falls, as a share from `segment[0]`: read off
            // the geometry, since the chord may run either way.
            let share_of = |t: f64| -> f64 {
                let p = family.point_along(step.lines[0], t);
                let [a, b] = first.segment;
                let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
                let len2 = dx * dx + dy * dy;
                if len2 <= 0.0 {
                    0.0
                } else {
                    ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
                }
            };
            let regions: Vec<GridRegion> = step
                .bands
                .iter()
                .map(|b| GridRegion {
                    bounds: [bound(fi, b.lo), bound(fi, b.hi)],
                    lines: b.lines.len() as u32,
                    extent: b.extent.map(|(t0, t1)| {
                        let (r0, r1) = (share_of(t0), share_of(t1));
                        [r0.min(r1), r0.max(r1)]
                    }),
                    // Left to right, bottom to top — the way a sentence reads
                    // them, whichever way the family's axis runs.
                    along: b.along.map(|[lo, hi]| {
                        let (a, z) = (along_bound(lo), along_bound(hi));
                        if a.fraction <= z.fraction {
                            [a, z]
                        } else {
                            [z, a]
                        }
                    }),
                })
                .collect();
            Some(Step {
                id: k as u32 + 1,
                kind: StepKind::Grid,
                tag: LineTag::Grid,
                line: first.line,
                line_id: first.line_id,
                segment: first.segment,
                extent: Extent::Full,
                witnesses: Vec::new(),
                chosen: None,
                ease: 0,
                hard: false,
                err: 0.0,
                direction: Direction::Unassigned,
                direction_share: 0.0,
                side: crate::direction::Side::Front,
                unlocks: Vec::new(),
                cp_line_ids: lines.iter().flat_map(|l| l.cp_line_ids.clone()).collect(),
                cp_spans: lines.iter().flat_map(|l| l.cp_spans.clone()).collect(),
                visible: true,
                witnesses_complete: true,
                marks_exist: true,
                missing_marks: Vec::new(),
                hoisted: false,
                alignment: None,
                approximation: None,
                exact: true,
                pressed_on: Vec::new(),
                made: Vec::new(),
                press: None,
                also: None,
                impractical: false,
                grid: Some(GridStep {
                    kind: grid.kind,
                    family: fi,
                    n: grid.n,
                    normal: family.normal,
                    spacing: family.spacing,
                    // A pleat pleats into its finest level; a band step's
                    // lines are counted, and its level named, on the card.
                    cells: family
                        .cells
                        .map(|c| if step.pleat { step.level.min(c) } else { c }),
                    level: step.level,
                    pleat: step.pleat,
                    regions,
                    in_pattern: lines.iter().filter(|l| !l.cp_line_ids.is_empty()).count() as u32,
                    // Over the lines actually pleated: on the point cap a
                    // family can be short of its last lines.
                    reversed: lines
                        .iter()
                        .filter(|l| {
                            l.pattern_direction != Direction::Unassigned
                                && l.pattern_direction != l.direction
                        })
                        .count() as u32,
                    lines,
                }),
            })
        })
        .collect()
}

impl Planner {
    /// A planner over `component` (from `analyze`), applying the exactness
    /// policy. A refused component yields a planner whose status is
    /// `RefusedSheet` and whose every method is a no-op.
    pub fn new(component: &Component, opts: PlannerOptions) -> Planner {
        let started_ms = (opts.clock)();
        let mut planner = Planner {
            opts,
            component_id: component.id,
            sheet: None,
            closure: None,
            exactness: None,
            off_lattice: false,
            approximations: 0,
            refused: true,
            stuck_events: Vec::new(),
            budget_hit: false,
            point_cap_hit: false,
            rf_lines_folded: 0,
            candidates_evaluated: 0,
            closures_run: 0,
            started_ms,
            elapsed_ms: 0.0,
        };
        let (Some(frame), Some(exactness)) = (&component.frame, &component.exactness) else {
            return planner;
        };
        let sheet = Sheet::from_frame(frame);
        // The caller's segment numbering is sparse over a component, so index
        // back into the component's own parallel `unit_segments`.
        let mut unit_of_segment: std::collections::HashMap<u32, [f64; 4]> =
            std::collections::HashMap::with_capacity(component.segment_indices.len());
        for (i, &id) in component.segment_indices.iter().enumerate() {
            if let Some(&seg) = component.unit_segments.get(i) {
                unit_of_segment.insert(id, seg);
            }
        }
        let spans_of = |ids: &[u32]| -> Vec<[[f64; 2]; 2]> {
            ids.iter()
                .filter_map(|id| unit_of_segment.get(id))
                .map(|s| [[s[0], s[1]], [s[2], s[3]]])
                .collect()
        };
        // An off-lattice component is planned as drawn, and what it draws a
        // hair apart it means as one crease: see `coalesce_lines`. An exact
        // component's lines are on the lattice, and two of them that close
        // are two lines. A coalesced line's creases then get the snappable
        // path's treatment of their ends — an end a hair from the edge, or
        // from the crease it meets, is put on it — because the join projected
        // them onto a line a hair from where they were drawn.
        let coalesced;
        let merged_lines: &[crate::merge::MergedLine] =
            if exactness.class == ExactnessClass::OffLattice {
                coalesced = coalesce_lines(&sheet, &component.merged_lines, SNAP_RADIUS, |i| {
                    unit_of_segment
                        .get(&i)
                        .map(|s| [[s[0], s[1]], [s[2], s[3]]])
                });
                &coalesced
            } else {
                &component.merged_lines
            };
        let merged_line_set: Vec<Line> = merged_lines.iter().map(|ml| ml.line).collect();
        let targets: Vec<Target> =
            match exactness.class {
                ExactnessClass::Exact | ExactnessClass::OffLattice => merged_lines
                    .iter()
                    .map(|ml| {
                        let target = Target::new(
                            ml.line,
                            ml.segment_indices.iter().map(|&i| i + 1).collect(),
                            spans_of(&ml.segment_indices),
                            ml.mountain_length,
                            ml.valley_length,
                        );
                        if exactness.class == ExactnessClass::OffLattice {
                            target.with_spans_snapped(&sheet, &merged_line_set, SNAP_RADIUS)
                        } else {
                            target
                        }
                    })
                    .collect(),
                ExactnessClass::Snappable => {
                    let snapped_lines: Vec<Line> =
                        exactness.snapped.lines.iter().map(|sl| sl.line).collect();
                    exactness
                        .snapped
                        .lines
                        .iter()
                        .map(|sl| {
                            let (mountain, valley) =
                                sl.source_lines.iter().fold((0.0, 0.0), |(m, v), &li| {
                                    match component.merged_lines.get(li as usize) {
                                        Some(ml) => (m + ml.mountain_length, v + ml.valley_length),
                                        None => (m, v),
                                    }
                                });
                            Target::new(
                                sl.line,
                                sl.segment_indices.iter().map(|&i| i + 1).collect(),
                                spans_of(&sl.segment_indices),
                                mountain,
                                valley,
                            )
                            .with_spans_snapped(
                                &sheet,
                                &snapped_lines,
                                SNAP_RADIUS,
                            )
                        })
                        .collect()
                }
            };
        planner.exactness = Some(ExactnessSummary {
            class: exactness.class,
            family: exactness.family.clone(),
            max_displacement_unit: exactness.snapped.max_displacement_unit,
            max_displacement_model: exactness.snapped.max_displacement_model,
            off_lattice_lines: exactness.off_lattice_lines,
            off_lattice_vertices: exactness.off_lattice_vertices,
        });
        planner.off_lattice = exactness.class == ExactnessClass::OffLattice;
        planner.refused = false;
        let grid = match opts.precrease_grid {
            GridMode::Off => None,
            mode => grid::detect(&sheet, &targets, mode == GridMode::Whole),
        };
        let mut closure = Closure::new(sheet, targets, opts.point_cap);
        closure.set_prefer_findable_ends(opts.prefer_findable_ends);
        closure.set_reach_references(opts.reach_references);
        closure.set_allow_dangling_folds(opts.allow_dangling_folds);
        closure.set_defer_far_anchors(opts.defer_far_anchors);
        closure.set_prefer_sightable(opts.prefer_sightable);
        if let Some(grid) = grid {
            // The grid is a few hundred lines at most, far under the cap; if
            // it is not, the plan goes on without it and says the cap was hit.
            let result = closure.fold_grid(grid);
            let _ = planner.note_cap(result);
        }
        planner.closure = Some(closure);
        planner.sheet = Some(sheet);
        planner
    }

    /// A planner over the bare unit sheet and explicit target lines (tests,
    /// tools): treated as exact, and never pleated on a grid — bare lines
    /// carry no crease evidence, and what these callers want is the closure.
    pub fn from_lines(sheet: Sheet, lines: &[Line], opts: PlannerOptions) -> Planner {
        let started_ms = (opts.clock)();
        let targets = lines
            .iter()
            .enumerate()
            .map(|(i, l)| Target::unassigned(*l, vec![i as u32 + 1]))
            .collect();
        Planner {
            opts,
            component_id: 0,
            sheet: Some(sheet),
            closure: Some({
                let mut closure = Closure::new(sheet, targets, opts.point_cap);
                closure.set_prefer_findable_ends(opts.prefer_findable_ends);
                closure.set_reach_references(opts.reach_references);
                closure.set_allow_dangling_folds(opts.allow_dangling_folds);
                closure.set_defer_far_anchors(opts.defer_far_anchors);
                closure.set_prefer_sightable(opts.prefer_sightable);
                closure
            }),
            exactness: None,
            off_lattice: false,
            approximations: 0,
            refused: false,
            stuck_events: Vec::new(),
            budget_hit: false,
            point_cap_hit: false,
            rf_lines_folded: 0,
            candidates_evaluated: 0,
            closures_run: 0,
            started_ms,
            elapsed_ms: 0.0,
        }
    }

    fn tick(&mut self) {
        self.elapsed_ms = (self.opts.clock)() - self.started_ms;
    }

    fn closure(&self) -> Result<&Closure, PrecreaseError> {
        self.closure.as_ref().ok_or(PrecreaseError::RefusedSheet)
    }

    fn closure_mut(&mut self) -> Result<&mut Closure, PrecreaseError> {
        self.closure.as_mut().ok_or(PrecreaseError::RefusedSheet)
    }

    /// The component id.
    pub fn component_id(&self) -> u32 {
        self.component_id
    }

    /// The sheet, unless refused.
    pub fn sheet(&self) -> Option<&Sheet> {
        self.sheet.as_ref()
    }

    /// The closure, unless refused.
    pub fn closure_ref(&self) -> Option<&Closure> {
        self.closure.as_ref()
    }

    /// The options.
    pub fn options(&self) -> &PlannerOptions {
        &self.opts
    }

    /// The current status.
    pub fn status(&self) -> Status {
        match &self.closure {
            None => Status::RefusedSheet,
            Some(c) if c.is_complete() => Status::Complete,
            Some(_) if self.off_lattice => Status::PartialOffLattice,
            Some(_) => Status::PartialUnsolved,
        }
    }

    fn deadline(&self, budget_ms: f64) -> Deadline {
        Deadline::after(self.opts.clock, budget_ms)
    }

    fn note_cap(&mut self, result: Result<(), PrecreaseError>) -> Result<(), PrecreaseError> {
        if let Err(PrecreaseError::PointCap { .. }) = &result {
            self.point_cap_hit = true;
        }
        result
    }

    /// Run the closure for at most `budget_ms` (0 = unbounded). Resumable.
    pub fn close(&mut self, budget_ms: f64) -> Result<CloseOutcome, PrecreaseError> {
        let deadline = self.deadline(budget_ms);
        let outcome = self.closure_mut()?.close(&deadline);
        let outcome = match outcome {
            Ok(o) => o,
            Err(e) => {
                self.note_cap(Err(e.clone()))?;
                return Err(e);
            }
        };
        self.budget_hit |= outcome.budget_hit;
        self.tick();
        Ok(outcome)
    }

    /// The remaining CP lines with two in-frame points each.
    pub fn remaining(&self) -> Vec<RemainingLine> {
        let (Some(c), Some(sheet)) = (&self.closure, &self.sheet) else {
            return Vec::new();
        };
        c.remaining()
            .iter()
            .filter_map(|&t| {
                let target = &c.targets()[t];
                segment_of(sheet, &target.line).map(|segment| RemainingLine {
                    target: t,
                    line: target.line,
                    segment,
                    cp_line_ids: target.cp_line_ids.clone(),
                })
            })
            .collect()
    }

    /// Canonical keys of the remaining lines (same order as `remaining`).
    pub fn line_keys(&self) -> Vec<u64> {
        self.remaining().iter().map(|r| r.line.key()).collect()
    }

    /// Run the forward-first search from the current (stuck) state with the
    /// given maximum depth and budget, and **apply** the best auxiliary set
    /// found (folding it and re-closing). `None` when nothing was found.
    pub fn stuck_search(
        &mut self,
        max_depth: u8,
        budget_ms: f64,
    ) -> Result<Option<StuckSummary>, PrecreaseError> {
        let deadline = self.deadline(budget_ms);
        let mut opts = self.opts.stuck;
        opts.max_depth = max_depth.clamp(1, 3);
        let closure = self.closure()?.clone();
        if closure.is_complete() {
            return Ok(None);
        }
        let (result, stats) = match stuck_search(&closure, &opts, &deadline) {
            Ok(r) => r,
            Err(e) => {
                self.note_cap(Err(e.clone()))?;
                return Err(e);
            }
        };
        self.candidates_evaluated += stats.candidates_evaluated as u64;
        self.closures_run += stats.closures_run as u64;
        self.budget_hit |= !stats.exhausted;
        self.tick();
        let Some(result) = result else {
            self.stuck_events.push(StuckSummary {
                aux: Vec::new(),
                aux_folds: 0,
                visible_aux: 0,
                unlocked: 0,
                ease_sum: 0,
                depth_reached: stats.depth_reached,
                exhausted: stats.exhausted,
                complete: false,
                root_candidates: stats.root_candidates,
                candidates_evaluated: stats.candidates_evaluated,
                closures_run: stats.closures_run,
            });
            return Ok(None);
        };
        let summary = StuckSummary {
            aux: result.aux.clone(),
            aux_folds: result.score.aux_folds,
            visible_aux: result.score.visible_aux,
            unlocked: result.unlocked,
            ease_sum: result.score.ease_sum,
            depth_reached: stats.depth_reached,
            exhausted: stats.exhausted,
            complete: result.complete,
            root_candidates: stats.root_candidates,
            candidates_evaluated: stats.candidates_evaluated,
            closures_run: stats.closures_run,
        };
        self.closure = Some(result.closure);
        self.stuck_events.push(summary.clone());
        Ok(Some(summary))
    }

    /// Score externally supplied lines against the current state: for each,
    /// how many CP lines folding it alone would unlock, or `None` when it is
    /// not constructible from the current state.
    pub fn score(
        &self,
        lines: &[Line],
        budget_ms: f64,
    ) -> Result<Vec<Option<usize>>, PrecreaseError> {
        let deadline = self.deadline(budget_ms);
        crate::stuck::score_lines(self.closure()?, lines, &deadline)
    }

    /// Fold externally supplied lines in order, each only if some axiom
    /// application in the current state reproduces it, then re-close.
    pub fn fold(
        &mut self,
        lines: &[Line],
        tags: &[LineTag],
        budget_ms: f64,
    ) -> Result<Vec<FoldOutcome>, PrecreaseError> {
        if tags.len() != lines.len() {
            return Err(PrecreaseError::TagCountMismatch {
                lines: lines.len(),
                tags: tags.len(),
            });
        }
        let mut outcomes = Vec::with_capacity(lines.len());
        for (line, &tag) in lines.iter().zip(tags) {
            let tag = if tag == LineTag::Edge {
                LineTag::Aux
            } else {
                tag
            };
            let out = self.closure_mut()?.fold_line(*line, tag);
            let out = match out {
                Ok(o) => o,
                Err(e) => {
                    self.note_cap(Err(e.clone()))?;
                    return Err(e);
                }
            };
            if matches!(out, FoldOutcome::Folded { .. }) && tag == LineTag::RfAux {
                self.rf_lines_folded += 1;
            }
            outcomes.push(out);
        }
        self.close(budget_ms)?;
        Ok(outcomes)
    }

    /// Fold the remaining target equal to `target` by the closest
    /// construction there is — `constructed`, a line some axiom application
    /// in the current state reproduces, `err` from the target in sheet units
    /// — then re-close. See [`Closure::fold_approximation`].
    ///
    /// `NotConstructible` when `target` names no remaining target, or the
    /// state has no exact construction of `constructed`.
    pub fn fold_approximation(
        &mut self,
        target: &Line,
        constructed: &Line,
        err: f64,
        budget_ms: f64,
    ) -> Result<FoldOutcome, PrecreaseError> {
        let closure = self.closure_mut()?;
        let Some(t) = closure.target_of(target) else {
            return Ok(FoldOutcome::NotConstructible);
        };
        let out = match closure.fold_approximation(t, *constructed, err) {
            Ok(o) => o,
            Err(e) => {
                self.note_cap(Err(e.clone()))?;
                return Err(e);
            }
        };
        if matches!(out, FoldOutcome::Folded { .. }) {
            self.approximations += 1;
        }
        self.close(budget_ms)?;
        Ok(out)
    }

    /// What the plan itself says, for the shared rules in [`crate::drive`].
    pub fn plan_state(&self) -> PlanState {
        PlanState {
            refused: self.refused,
            complete: self.closure.as_ref().is_some_and(|c| c.is_complete()),
            point_cap_hit: self.point_cap_hit,
        }
    }

    /// What a driver should do next. See [`crate::drive`] for why the rules
    /// live there and the loop does not.
    pub fn next_action(&self, driver: DriverState) -> PlanAction {
        drive::next_action(self.plan_state(), driver)
    }

    /// Plan **without ReferenceFinder**: close, search, repeat, and stop when
    /// the search runs out of ideas.
    ///
    /// This is not how Ori Studio plans, and the name says so because the old
    /// one (`plan`) did not and cost a wrong measurement. The wasm bridge does
    /// not export this; the shipping driver is the browser's own loop, which has
    /// an arm this cannot have — when the search fails, it asks ReferenceFinder.
    /// So a plan produced here gives up one step earlier than the product's, and
    /// **any corpus number measured through it is a ceiling on defects, not a
    /// measurement of them.**
    ///
    /// It exists so tests, examples and benchmarks can plan a crease pattern
    /// without a browser. It runs the same rules
    /// ([`crate::drive::next_action`]) as the real driver, declaring
    /// `reference_finder: false` — so its one difference is a stated fact rather
    /// than a branch that silently is not there.
    pub fn plan_without_reference_finder(&mut self) -> Result<Status, PrecreaseError> {
        let total = self.deadline(self.opts.total_budget_ms);
        let mut driver = DriverState::default();
        loop {
            driver.out_of_time = total.expired();
            match self.next_action(driver) {
                PlanAction::Close => {
                    // To a fixpoint, or until a budgeted call stops advancing —
                    // the same thing the browser's `closeToFixpoint` does, minus
                    // the chunking, which is a UI concern and not a rule.
                    let stalled = loop {
                        let out = self.close(self.opts.total_budget_ms)?;
                        if out.fixpoint || out.remaining == 0 {
                            break false;
                        }
                        if out.folded == 0 {
                            break true;
                        }
                    };
                    driver.last = LastStep::Closed { stalled };
                }
                PlanAction::StuckSearch => {
                    let depth = self.opts.stuck.max_depth;
                    let budget = self.opts.stuck_budget_ms;
                    let found = self.stuck_search(depth, budget)?.is_some();
                    driver.last = LastStep::Searched { found };
                }
                // Unreachable: `reference_finder` is false for this driver, so
                // the rules stop instead. Answered rather than `unreachable!()`
                // so a future rule change cannot panic the headless path.
                PlanAction::AskReferenceFinder => {
                    driver.last = LastStep::AskedReferenceFinder { folded: false };
                }
                PlanAction::Approximate => {
                    driver.last = LastStep::Approximated { folded: false };
                }
                PlanAction::Stop { reason } => {
                    if reason == StopReason::Budget {
                        self.budget_hit = true;
                    }
                    break;
                }
            }
        }
        self.tick();
        Ok(self.status())
    }

    fn certification(&self) -> String {
        if self.stuck_events.is_empty() {
            return "best_found_to_depth_0".to_string();
        }
        if self.rf_lines_folded > 0
            || self.budget_hit
            || self.stuck_events.iter().any(|e| !e.exhausted)
        {
            return "heuristic".to_string();
        }
        let depth = self
            .stuck_events
            .iter()
            .map(|e| e.depth_reached)
            .max()
            .unwrap_or(0);
        format!("best_found_to_depth_{depth}")
    }

    fn diagnostics(&self) -> Diagnostics {
        let (points, lines, closure_stats) = match &self.closure {
            Some(c) => (
                c.state().point_count(),
                c.state().line_count(),
                c.stats().clone(),
            ),
            None => (0, 0, Default::default()),
        };
        Diagnostics {
            closure: closure_stats,
            stuck_events: self.stuck_events.len() as u32,
            candidates_evaluated: self.candidates_evaluated,
            closures_run: self.closures_run,
            points,
            lines,
            elapsed_ms: self.elapsed_ms,
            budget_hit: self.budget_hit,
            point_cap_hit: self.point_cap_hit,
            max_depth_searched: self
                .stuck_events
                .iter()
                .map(|e| e.depth_reached)
                .max()
                .unwrap_or(0),
            search_exhausted: self.stuck_events.iter().all(|e| e.exhausted),
            witnesses_incomplete_steps: self.closure.as_ref().map_or(0, |c| {
                c.folded().iter().filter(|f| !f.witnesses_complete).count() as u32
            }),
            rf_lines_folded: self.rf_lines_folded,
        }
    }

    /// How the exactness policy classified the component, once analysed.
    pub fn exactness(&self) -> Option<&ExactnessSummary> {
        self.exactness.as_ref()
    }

    /// Crease a band's line as far as a later step needs it, in the grid step
    /// itself. The ordering pass presses a line where a step sights a mark on
    /// it that its crease does not reach; on a grid line that press would be
    /// a card of its own saying to refold a pleat, where the folder could have
    /// creased that far in the first place. So the ordering is run, every
    /// press that landed on a grid line is folded into that line's extent —
    /// out to the nearest end the folder can find on the paper the grid left,
    /// a whole pleat line of another family or the edge — and the ordering
    /// is run again, until no press lands on the grid.
    fn settle_grid(&mut self, landmarks_first: bool) {
        for _ in 0..4 {
            let Some(closure) = &self.closure else {
                return;
            };
            let (Some(grid), Some(sheet)) = (closure.grid(), &self.sheet) else {
                return;
            };
            let placed = order(closure, landmarks_first);
            let folded = closure.folded();
            let mut extensions: Vec<(usize, [[f64; 2]; 2])> = Vec::new();
            for p in &placed {
                let Some(press) = &p.press else {
                    continue;
                };
                let f = &folded[p.folded];
                let Some(g) = f.grid else {
                    continue;
                };
                let family = &grid.families[g.family];
                let gl = &family.lines[g.line];
                if gl.spans.is_empty() {
                    continue;
                }
                let stops = grid::stops(sheet, grid, g.family);
                let axis = family.axis();
                let t = axis.parameter_of(press.at);
                let (mut lo, mut hi) = gl
                    .spans
                    .iter()
                    .flat_map(|[a, b]| [axis.parameter_of(*a), axis.parameter_of(*b)])
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), v| {
                        (lo.min(v), hi.max(v))
                    });
                if t < lo {
                    lo = stops
                        .iter()
                        .rev()
                        .find(|(s, _)| *s <= t + SNAP_RADIUS)
                        .map_or(t, |(s, _)| *s);
                }
                if t > hi {
                    hi = stops
                        .iter()
                        .find(|(s, _)| *s >= t - SNAP_RADIUS)
                        .map_or(t, |(s, _)| *s);
                }
                extensions.push((
                    f.line_id,
                    [
                        family.point_along(g.line, lo),
                        family.point_along(g.line, hi),
                    ],
                ));
            }
            if extensions.is_empty() {
                return;
            }
            let Some(closure) = self.closure.as_mut() else {
                return;
            };
            for (line_id, span) in extensions {
                closure.press_grid_line(line_id, span);
            }
        }
    }

    /// The plan in its wire shape.
    pub fn sequence(&mut self, landmarks_first: bool) -> Sequence {
        self.settle_grid(landmarks_first);
        let status = self.status();
        let (Some(closure), Some(sheet)) = (&self.closure, &self.sheet) else {
            return Sequence {
                status,
                certification: "heuristic".to_string(),
                sheet: Sheet::unit_square(),
                landmarks_first,
                grid: None,
                steps: Vec::new(),
                groups: Vec::new(),
                totals: Totals::default(),
                findings: Vec::new(),
                points: Vec::new(),
                lines: Vec::new(),
                exactness: self.exactness.clone(),
                diagnostics: self.diagnostics(),
            };
        };
        let placed: Vec<Placed> = order(closure, landmarks_first);
        let fold_order: Vec<usize> = placed.iter().map(|p| p.folded).collect();
        let folded = closure.folded();
        let presented: Vec<Option<&Witness>> = placed
            .iter()
            .map(|p| p.presented(&folded[p.folded]))
            .collect();
        let verdicts = pinch_pass(closure, &fold_order, &presented);
        let state = closure.state();

        // The grid comes first, one step per family, ahead of every placed
        // fold: it is on the paper before anything is sighted.
        let grid_steps = grid_steps(closure, sheet);
        let first_id = grid_steps.len() as u32 + 1;

        // Step id per state line id, for `unlocks` and `LineEntry::step`: the
        // step that MADE the line. A press refolds a line an earlier step made
        // and does not take its place here.
        let mut step_of_line: Vec<Option<u32>> = vec![None; state.line_count()];
        for g in &grid_steps {
            if let Some(grid) = &g.grid {
                for l in &grid.lines {
                    step_of_line[l.line_id] = Some(g.id);
                }
            }
        }
        for (k, p) in placed.iter().enumerate() {
            if p.press.is_none() {
                step_of_line[folded[p.folded].line_id] = Some(k as u32 + first_id);
            }
        }

        let mut steps: Vec<Step> = Vec::with_capacity(grid_steps.len() + placed.len());
        let mut referenced_points: Vec<usize> = Vec::new();
        // Which lines are on the paper exactly, as the steps go: the sheet's
        // edges, the grid, and every fold that is exact. A mark is exact when
        // two exact lines cross there; a fold is exact when its own
        // construction is and everything it sights from is. An
        // approximation's error is inherited by whatever is sighted from it,
        // and the card has to say so there too.
        let mut exact_lines: Vec<bool> = state
            .lines()
            .iter()
            .map(|l| matches!(l.tag, LineTag::Edge | LineTag::Grid))
            .collect();
        for g in &grid_steps {
            if let Some(grid) = &g.grid {
                for l in &grid.lines {
                    exact_lines[l.line_id] = true;
                }
            }
        }
        steps.extend(grid_steps);
        for (k, p) in placed.iter().enumerate() {
            let f: &FoldedLine = &folded[p.folded];
            // A press is the fold that made this line, done again for a little
            // more of it: same construction, same references, same motion, a
            // pinch for an extent. So it presents the making step's witness.
            // Reading that off the press itself made it look like a different
            // fold.
            let original = p.press.as_ref().and_then(|_| {
                placed
                    .iter()
                    .find(|q| q.folded == p.folded && q.press.is_none())
            });
            let presenting = original.unwrap_or(p);
            let chosen_index = presenting.chosen;
            // The recorded witnesses, plus the one the ordering pass found
            // against the paper when none of them was clean; `chosen`
            // indexes the whole.
            let witnesses: Vec<Witness> = f
                .witnesses
                .iter()
                .chain(presenting.found.as_ref())
                .cloned()
                .collect();
            let chosen = chosen_index.and_then(|c| witnesses.get(c)).cloned();
            let chosen = chosen.as_ref();
            // The card draws the mirror alignment's marks too, so they are
            // in the table beside the chosen witness's.
            for w in chosen.into_iter().chain(presenting.also.as_ref()) {
                for r in &w.inputs {
                    if r.is_point() && !referenced_points.contains(&r.id()) {
                        referenced_points.push(r.id());
                    }
                }
            }
            let verdict = &verdicts[k];
            let kind = if p.press.is_some() {
                StepKind::Press
            } else if f.tag == LineTag::Cp {
                StepKind::Cp
            } else {
                StepKind::Aux
            };
            let target = f.target.map(|t| &closure.targets()[t]);
            // A press realises nothing the pattern contains: its crease is the
            // cost of making a later step performable, and it must stay
            // countable as exactly that.
            let (cp_line_ids, cp_spans) = if p.press.is_some() {
                (Vec::new(), Vec::new())
            } else {
                (
                    target.map(|t| t.cp_line_ids.clone()).unwrap_or_default(),
                    target.map(|t| t.spans.clone()).unwrap_or_default(),
                )
            };
            let extent = match &p.press {
                Some(press) => Extent::Pinches {
                    spans: vec![press.span],
                },
                None => verdict.extent.clone(),
            };
            // The direction the fold is actually made in: toward the folder,
            // from whichever face is up — every fold is. A line with a firm
            // majority forced the side it is on, so the two agree. A weak
            // majority took whichever side was already up, and the share is
            // then the share of its length that side gets right. A press is
            // made from whichever face is up when its mark is needed — "fold
            // P onto Q" is a valley on the face it is said on; giving it the
            // making fold's direction instead drew a mountain under that
            // sentence. An auxiliary fold has no assignment in the pattern,
            // but it is a fold like any other while it is being made, and a
            // card that drew it in no direction read as a fold that was not
            // real.
            let majority = target.map_or(Direction::Unassigned, |t| t.direction);
            let direction = p.side.direction();
            let direction_share = share_of(
                majority,
                target.map_or(0.0, |t| t.direction_share),
                direction,
            );
            let exact_point = |id: usize| {
                state
                    .points()
                    .get(id)
                    .is_some_and(|pt| pt.lines.iter().filter(|&&l| exact_lines[l]).count() >= 2)
            };
            // A press is located by the crease it is sighted from, and is
            // only as exact as that crease.
            let exact = f.approximation.is_none()
                && chosen.is_none_or(|w| {
                    w.inputs.iter().all(|r| match r {
                        Ref::Line { id } => exact_lines[*id],
                        Ref::Point { id } => exact_point(*id),
                        Ref::Edge { .. } | Ref::Corner { .. } => true,
                    })
                })
                && p.press
                    .as_ref()
                    .and_then(|press| press.sighted_from)
                    .is_none_or(|l| exact_lines[l]);
            if p.press.is_none() {
                exact_lines[f.line_id] = exact;
            }
            steps.push(Step {
                id: k as u32 + first_id,
                kind,
                tag: f.tag,
                line: f.line,
                line_id: f.line_id,
                segment: segment_of(sheet, &f.line).unwrap_or([[0.0; 2]; 2]),
                extent,
                witnesses,
                chosen: chosen_index,
                ease: chosen.map_or(0, |w| w.ease),
                hard: chosen.is_some_and(|w| w.hard),
                err: chosen.map_or(0.0, |w| w.err),
                direction,
                direction_share,
                side: p.side,
                unlocks: Vec::new(),
                cp_line_ids,
                cp_spans,
                visible: p.press.is_none() && verdict.visible,
                witnesses_complete: f.witnesses_complete,
                marks_exist: p.marks_exist,
                missing_marks: p
                    .missing
                    .iter()
                    .filter_map(|&id| state.points().get(id).map(|pt| pt.p))
                    .collect(),
                hoisted: p.hoisted,
                alignment: p.alignment,
                approximation: f.approximation,
                exact,
                pressed_on: p.pressed_on.clone(),
                made: p.made.clone(),
                press: p.press.as_ref().map(|press| StepPress {
                    at: press.at,
                    point: press.point,
                    sighted_from: press.sighted_from,
                }),
                also: presenting.also.clone(),
                impractical: presenting.impractical,
                grid: None,
            });
        }

        // Unlocks: CP steps whose chosen witness uses an aux step's line or
        // a mark on it — or, for a grid step, any line of the family.
        for i in 0..steps.len() {
            let line_ids: Vec<usize> = match steps[i].kind {
                StepKind::Aux => vec![steps[i].line_id],
                StepKind::Grid => steps[i]
                    .grid
                    .as_ref()
                    .map(|g| g.lines.iter().map(|l| l.line_id).collect())
                    .unwrap_or_default(),
                _ => continue,
            };
            let mut unlocks: Vec<u32> = Vec::new();
            for later in &steps[(i + 1)..] {
                if later.kind != StepKind::Cp {
                    continue;
                }
                let Some(w) = later.chosen.map(|c| &later.witnesses[c]) else {
                    continue;
                };
                let uses = w.inputs.iter().any(|r| match r {
                    Ref::Edge { id, .. } | Ref::Line { id } => line_ids.contains(id),
                    Ref::Corner { id, .. } | Ref::Point { id } => state.points()[*id]
                        .lines
                        .iter()
                        .any(|l| line_ids.contains(l)),
                });
                if uses {
                    unlocks.push(later.id);
                }
            }
            steps[i].unlocks = unlocks;
        }

        // The grid's steps are their own groups: one family, one row.
        let groups: Vec<Group> = steps
            .iter()
            .take(first_id as usize - 1)
            .map(|s| Group {
                kind: StepKind::Grid,
                side: s.side,
                direction_angle: s.line.folded_angle_offset().0,
                axiom: 0,
                pattern: "grid".to_string(),
                step_ids: vec![s.id],
                count: 1,
            })
            .chain(group(closure, &placed, first_id))
            .collect();
        let _ = pattern(None);

        referenced_points.sort_unstable();
        let points: Vec<PointEntry> = referenced_points
            .iter()
            .map(|&id| {
                let sp = &state.points()[id];
                let mut lines = sp.lines.clone();
                lines.sort_unstable();
                PointEntry {
                    id,
                    p: sp.p,
                    lines,
                    on_boundary: sp.on_boundary,
                }
            })
            .collect();
        let lines: Vec<LineEntry> = state
            .lines()
            .iter()
            .enumerate()
            .map(|(id, l)| LineEntry {
                id,
                tag: l.tag,
                step: step_of_line[id],
            })
            .collect();

        let findings: Vec<Finding> = closure
            .remaining()
            .iter()
            .map(|&t| {
                let target = &closure.targets()[t];
                let facts = full_facts(state, &target.line);
                Finding {
                    line: target.line,
                    segment: segment_of(sheet, &target.line),
                    cp_line_ids: target.cp_line_ids.clone(),
                    reason: if self.off_lattice {
                        FindingReason::OffLattice
                    } else {
                        FindingReason::Unsolved
                    },
                    facts: summarize(&facts),
                }
            })
            .collect();

        let grid_lines: u32 = steps
            .iter()
            .filter_map(|s| s.grid.as_ref())
            .map(|g| g.lines.len() as u32)
            .sum();
        let grid_cp_lines: u32 = steps
            .iter()
            .filter_map(|s| s.grid.as_ref())
            .map(|g| g.in_pattern)
            .sum();
        // What the grid creases past the pattern: the chord of a line the
        // pattern lacks, and the rest of the chord of one it holds.
        let length_of = |runs: &[([f64; 2], [f64; 2])]| -> f64 {
            runs.iter()
                .map(|(a, b)| ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt())
                .sum()
        };
        let grid_unwanted_length: f64 = steps
            .iter()
            .filter_map(|s| s.grid.as_ref())
            .flat_map(|g| g.lines.iter())
            .map(|l| {
                let made = if l.spans.is_empty() {
                    length_of(&[(l.segment[0], l.segment[1])])
                } else {
                    length_of(&crease_runs(&l.line, &l.spans))
                };
                (made - length_of(&crease_runs(&l.line, &l.cp_spans))).max(0.0)
            })
            .sum();
        // What the CP steps crease past the pattern's own to be made from
        // reference to reference: the blank joined and the ends carried out.
        let reach_length: f64 = steps
            .iter()
            .filter(|s| s.kind == StepKind::Cp && !s.made.is_empty())
            .map(|s| {
                (length_of(&crease_runs(&s.line, &s.made))
                    - length_of(&crease_runs(&s.line, &s.cp_spans)))
                .max(0.0)
            })
            .sum();
        let cp_lines =
            steps.iter().filter(|s| s.kind == StepKind::Cp).count() as u32 + grid_cp_lines;
        let aux = steps.iter().filter(|s| s.kind == StepKind::Aux).count() as u32;
        let presses = steps.iter().filter(|s| s.kind == StepKind::Press).count() as u32;
        let visible_aux = steps
            .iter()
            .filter(|s| s.kind == StepKind::Aux && s.visible)
            .count() as u32;
        let free_lines = closure.free_targets().len() as u32;
        let unsolved = closure.remaining().len() as u32;
        let approximate = steps.iter().filter(|s| !s.exact).count() as u32;
        let totals = Totals {
            folds: cp_lines + aux + (grid_lines - grid_cp_lines),
            cp_lines,
            aux,
            visible_aux,
            grid_lines,
            grid_cp_lines,
            grid_unwanted_length,
            presses,
            reach_length,
            lower_bound: cp_lines + unsolved,
            free_lines,
            unsolved,
            approximate,
        };
        let grid = closure.grid().map(|g| GridSummary {
            kind: g.kind,
            n: g.n,
            families: g.families.len() as u32,
            steps: steps.iter().filter(|s| s.kind == StepKind::Grid).count() as u32,
            lines: grid_lines,
            cp_lines: grid_cp_lines,
        });

        Sequence {
            status,
            certification: self.certification(),
            sheet: *sheet,
            landmarks_first,
            grid,
            steps,
            groups,
            totals,
            findings,
            points,
            lines,
            exactness: self.exactness.clone(),
            diagnostics: self.diagnostics(),
        }
    }

    /// Everything known about `line`: its recorded witnesses when folded,
    /// otherwise its witnesses and facts against the current state.
    pub fn explain(&self, line: &Line) -> Explanation {
        let Some(closure) = &self.closure else {
            return Explanation {
                line: *line,
                folded: false,
                line_id: None,
                tag: None,
                round: None,
                is_target: false,
                remaining: false,
                cp_line_ids: Vec::new(),
                witnesses: Vec::new(),
                chosen: None,
                facts: FactsSummary::default(),
            };
        };
        let state = closure.state();
        let facts = full_facts(state, line);
        let target = closure.target_of(line);
        let remaining = target.is_some_and(|t| closure.remaining().contains(&t));
        let cp_line_ids = target
            .map(|t| closure.targets()[t].cp_line_ids.clone())
            .unwrap_or_default();
        match state
            .find_line(line)
            .and_then(|id| closure.folded_by_line_id(id))
        {
            Some(f) => Explanation {
                line: *line,
                folded: true,
                line_id: Some(f.line_id),
                tag: Some(f.tag),
                round: Some(f.round),
                is_target: target.is_some(),
                remaining: false,
                cp_line_ids,
                witnesses: f.witnesses.clone(),
                chosen: f.chosen,
                facts: summarize(&facts),
            },
            None => {
                let ws = witnesses(state, line, &facts);
                let chosen = crate::predicates::choose_for_card(&ws);
                Explanation {
                    line: *line,
                    folded: state.has_line(line),
                    line_id: state.find_line(line),
                    tag: state.find_line(line).map(|id| state.lines()[id].tag),
                    round: None,
                    is_target: target.is_some(),
                    remaining,
                    cp_line_ids,
                    witnesses: ws,
                    chosen,
                    facts: summarize(&facts),
                }
            }
        }
    }

    /// Two in-frame points of `line` for a ReferenceFinder line query (the
    /// planner unit frame *is* the ReferenceFinder frame; this is the seam).
    pub fn line_to_rf(&self, line: &Line) -> Option<[[f64; 2]; 2]> {
        self.sheet.as_ref().and_then(|s| segment_of(s, line))
    }

    /// A ReferenceFinder line (two points) as a canonical planner line.
    pub fn line_from_rf(&self, a: [f64; 2], b: [f64; 2]) -> Option<Line> {
        Line::from_points(a, b)
    }

    /// The stuck events so far.
    pub fn stuck_events(&self) -> &[StuckSummary] {
        &self.stuck_events
    }

    /// Whether the exactness policy turned planning off (off-lattice).
    pub fn is_off_lattice(&self) -> bool {
        self.off_lattice
    }
}

fn summarize(facts: &crate::predicates::Facts) -> FactsSummary {
    FactsSummary {
        points_on: facts.points_on.len(),
        perpendiculars: facts.perps.len(),
        o2_pairs: facts.o2_pairs.len(),
        o3_pairs: facts.o3_pairs.len(),
        landers: facts.landers.len(),
        landers_computed: facts.landers_computed,
    }
}

/// Whether a step's extent is a set of pinches.
pub fn is_pinched(step: &Step) -> bool {
    matches!(step.extent, Extent::Pinches { .. })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::frozen_clock;

    fn v(x: f64) -> Line {
        Line::new([1.0, 0.0], x).expect("line")
    }

    fn h(y: f64) -> Line {
        Line::new([0.0, 1.0], y).expect("line")
    }

    fn opts() -> PlannerOptions {
        PlannerOptions {
            clock: frozen_clock(),
            stuck_budget_ms: 0.0,
            total_budget_ms: 0.0,
            ..PlannerOptions::default()
        }
    }

    #[test]
    fn options_json_round_trip_and_validation() {
        let o = PlannerOptions::from_json("").expect("defaults");
        assert_eq!(o.point_cap, DEFAULT_POINT_CAP);
        let o =
            PlannerOptions::from_json(r#"{"max_depth": 3, "stuck_budget_ms": 10}"#).expect("parse");
        assert_eq!(o.stuck.max_depth, 3);
        assert_eq!(o.stuck_budget_ms, 10.0);
        assert!(PlannerOptions::from_json(r#"{"nope": 1}"#).is_err());
        assert!(PlannerOptions::from_json(r#"{"stuck_budget_ms": -1}"#).is_err());
    }

    #[test]
    fn a_grid_of_quarters_plans_without_auxiliary_folds() {
        let mut p = Planner::from_lines(
            Sheet::unit_square(),
            &[v(0.25), v(0.5), v(0.75), h(0.5), v(0.0)],
            opts(),
        );
        assert_eq!(
            p.plan_without_reference_finder().expect("plan"),
            Status::Complete
        );
        let seq = p.sequence(false);
        assert_eq!(seq.status, Status::Complete);
        assert_eq!(seq.totals.cp_lines, 4);
        assert_eq!(seq.totals.aux, 0);
        assert_eq!(seq.totals.free_lines, 1);
        assert_eq!(seq.totals.lower_bound, 4);
        assert_eq!(seq.certification, "best_found_to_depth_0");
        assert_eq!(seq.steps.len(), 4);
        assert!(seq.steps.iter().all(|s| s.extent == Extent::Full));
        assert!(seq.steps.iter().all(|s| s.cp_line_ids.len() == 1));
        assert_eq!(seq.steps[0].id, 1);
        assert!(!seq.groups.is_empty());
        // Lines table resolves state ids to steps; edges have none.
        assert!(seq.lines[..4].iter().all(|l| l.step.is_none()));
        assert!(seq.lines[4..].iter().all(|l| l.step.is_some()));
        // JSON serialises.
        let json = serde_json::to_string(&seq).expect("json");
        assert!(json.contains("\"status\":\"complete\""));
    }

    #[test]
    fn thirds_need_one_auxiliary_fold_and_it_is_pinched_or_visible() {
        let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("l");
        let anti = Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("l");
        let mut p = Planner::from_lines(
            Sheet::unit_square(),
            &[
                v(1.0 / 3.0),
                v(2.0 / 3.0),
                h(1.0 / 3.0),
                h(2.0 / 3.0),
                diag,
                anti,
            ],
            opts(),
        );
        assert_eq!(
            p.plan_without_reference_finder().expect("plan"),
            Status::Complete
        );
        let seq = p.sequence(false);
        assert_eq!(seq.totals.cp_lines, 6);
        assert!(
            seq.totals.aux >= 1 && seq.totals.aux <= 2,
            "{:?}",
            seq.totals
        );
        assert_eq!(seq.totals.folds, seq.totals.cp_lines + seq.totals.aux);
        assert!(seq.certification.starts_with("best_found_to_depth_"));
        let aux: Vec<&Step> = seq
            .steps
            .iter()
            .filter(|s| s.kind == StepKind::Aux)
            .collect();
        assert_eq!(aux.len() as u32, seq.totals.aux);
        for a in &aux {
            assert!(!a.unlocks.is_empty(), "{a:?}");
            assert!(a.visible || is_pinched(a));
        }
        assert_eq!(
            seq.totals.visible_aux as usize,
            aux.iter().filter(|a| a.visible).count()
        );
        // Explain a folded CP line and a fresh line.
        let e = p.explain(&v(1.0 / 3.0));
        assert!(e.folded && e.is_target && !e.remaining);
        assert!(!e.witnesses.is_empty());
        let e = p.explain(&v(0.2));
        assert!(!e.folded && !e.is_target);
        assert!(e.facts.landers_computed);
        // Landmarks-first hoists what certifies from the bare sheet.
        let lf = p.sequence(true);
        assert_eq!(lf.totals, seq.totals);
        assert!(lf.steps.iter().filter(|s| s.hoisted).count() <= aux.len());
    }

    #[test]
    fn an_unsolvable_line_is_a_finding() {
        // x = 1/7 with a depth-1 search and a candidate cap too small to
        // reach it: partial_unsolved with one finding.
        let mut o = opts();
        o.stuck.max_depth = 1;
        o.stuck.depth3_threshold = 0;
        o.stuck.candidates.max_candidates = 4;
        let mut p = Planner::from_lines(Sheet::unit_square(), &[v(1.0 / 7.0), v(0.5)], o);
        let status = p.plan_without_reference_finder().expect("plan");
        assert_eq!(status, Status::PartialUnsolved);
        let seq = p.sequence(false);
        assert_eq!(seq.findings.len(), 1);
        assert_eq!(seq.findings[0].reason, FindingReason::Unsolved);
        assert_eq!(seq.totals.unsolved, 1);
        assert_eq!(seq.totals.lower_bound, 2);
        assert!(seq.remaining_is_consistent());
    }

    impl Sequence {
        fn remaining_is_consistent(&self) -> bool {
            self.totals.cp_lines + self.totals.unsolved == self.totals.lower_bound
        }
    }
}
