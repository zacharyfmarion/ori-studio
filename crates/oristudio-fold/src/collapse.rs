//! Collapse (`implementation-plans/fold-collapse-existing-creases.md`): the
//! state folded again along creases it already has.
//!
//! A Collapse names some of its parent's creases and what each becomes —
//! a mountain, a valley, or open (flat) — and lands whatever those letters
//! fold to. It draws no line: every crease it names is one the parent has,
//! a folded crease or a flat one, an edge of the face graph or a crease mark
//! beside it. A line the parent does not have comes from a Precrease step
//! before the Collapse.
//!
//! It is Import CP of a crease pattern derived in place
//! ([`crate::import`]): the parent's own crease pattern
//! ([`CreasePatternInput::of_state`]) with the named creases' letters
//! changed, imported after the parent ([`ImportTarget::After`]), so the
//! assignment folds flat the way an import does, its orders are an import's
//! ‹ n of m ›, and it lands where a saved Import CP of the same pattern would
//! land after the same parent: the view kept, the root continued.
//!
//! **What a step stores** is only what it changes ([`CollapseCrease`], each
//! by its sheet ends, never by an id that renumbers) and the order chosen,
//! by witnesses ([`WitnessOrder`], the step's `orderJson`): every replay
//! derives the pattern from the parent again, so an earlier step that
//! changes is followed rather than overwritten.
//!
//! - **Naming a crease.** A stored stretch names the parts of the parent's
//!   creases and crease marks that lie along it; it must be covered, end to
//!   end, by those. One that leaves a gap (a line the parent does not have,
//!   or the border), or that names a crease two ways, is refused
//!   (`collapse_crease_missing`, `collapse_crease_twice`). A stretch may end
//!   inside a crease where another line meets it — crease marks that end on
//!   a diagonal let the diagonal fold one way on each side — and the crease
//!   is cut there; a cut nothing meets does not fold flat, and the vertex
//!   check below refuses it.
//! - **What a crease becomes.** Mountain and Valley fold it with that letter;
//!   Open leaves it flat, remembering the letter it had. A crease mark folded
//!   becomes a crease of the face graph, as Import CP makes one of a folded
//!   segment: it must then run from crease to crease.
//! - **Flat at every vertex.** Before anything is derived, every inside
//!   vertex the folded creases meet at is checked against Maekawa's and
//!   Kawasaki's theorems, so an assignment that cannot fold flat is refused
//!   at the vertex that breaks it (`collapse_not_flat_at_vertex`), not as a
//!   face somewhere downstream.
//! - **Made at.** A crease the Collapse leaves as it was keeps the step its
//!   parent's was made at; one it changes, and one a crease mark became, is
//!   the Collapse's own. So the step's instruction is what it changed.
//!
//! **Ori Studio original work**, not a port: Import CP's pattern, faces and
//! completion, with the pattern derived from the state.

use oristudio_geometry::convex;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::complete::CompletionLimits;
use crate::import::{
    CreasePatternInput, ImportKind, ImportRefusal, ImportSegment, ImportSpace, ImportTarget,
    ImportedPattern,
};
use crate::numerics::TOL;
use crate::pattern::{CreaseKind, Letter};
use crate::state::State;
use crate::witness::{Broken, WitnessOrder};

type Point = [f64; 2];

/// What a crease becomes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CollapseTo {
    Mountain,
    Valley,
    /// Flat, remembering the letter it had.
    Open,
}

impl CollapseTo {
    fn letter(self) -> Option<Letter> {
        match self {
            CollapseTo::Mountain => Some(Letter::Mountain),
            CollapseTo::Valley => Some(Letter::Valley),
            CollapseTo::Open => None,
        }
    }
}

/// One stretch of the parent's creases and what it becomes: `a` and `b` in
/// sheet coordinates (see the module docs).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CollapseCrease {
    pub a: Point,
    pub b: Point,
    pub to: CollapseTo,
}

/// Which theorem a vertex breaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VertexRule {
    /// Mountains and valleys at an inside vertex differ by other than two.
    Maekawa,
    /// The alternate angles between the folded creases do not sum to a half
    /// turn.
    Kawasaki,
}

/// What a Collapse refuses before its pattern is imported. Points are sheet
/// points.
#[derive(Debug, Clone, PartialEq, Serialize, Error)]
#[serde(tag = "code")]
pub enum CollapseRefusal {
    /// Nothing named.
    #[serde(rename = "collapse_empty")]
    #[error("the collapse names no crease")]
    Empty,
    #[serde(rename = "collapse_not_finite")]
    #[error("crease {index} has a coordinate that is not finite")]
    NotFinite { index: usize },
    /// A stretch that is not the parent's creases end to end: a gap, or an
    /// end inside a crease. `point` is where.
    #[serde(rename = "collapse_crease_missing")]
    #[error("crease {index} is not the state's creases at {point:?}")]
    CreaseMissing { index: usize, point: Point },
    /// Two stretches name one crease two ways.
    #[serde(rename = "collapse_crease_twice")]
    #[error("crease {index} names a crease another names otherwise, at {point:?}")]
    CreaseTwice { index: usize, point: Point },
    /// The folded creases at an inside vertex cannot fold flat.
    #[serde(rename = "collapse_not_flat_at_vertex")]
    #[error("the creases at {point:?} break {rule:?}")]
    NotFlatAtVertex { rule: VertexRule, point: Point },
}

impl CollapseRefusal {
    pub fn code(&self) -> &'static str {
        match self {
            CollapseRefusal::Empty => "collapse_empty",
            CollapseRefusal::NotFinite { .. } => "collapse_not_finite",
            CollapseRefusal::CreaseMissing { .. } => "collapse_crease_missing",
            CollapseRefusal::CreaseTwice { .. } => "collapse_crease_twice",
            CollapseRefusal::NotFlatAtVertex { .. } => "collapse_not_flat_at_vertex",
        }
    }
}

/// Why a Collapse does not land: its own refusal, or the import's.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum CollapseError {
    #[error(transparent)]
    Refused(CollapseRefusal),
    #[error(transparent)]
    Import(ImportRefusal),
}

impl From<CollapseRefusal> for CollapseError {
    fn from(refusal: CollapseRefusal) -> CollapseError {
        CollapseError::Refused(refusal)
    }
}

impl From<ImportRefusal> for CollapseError {
    fn from(refusal: ImportRefusal) -> CollapseError {
        CollapseError::Import(refusal)
    }
}

/// A Collapse's pattern after its parent, checked up to its layer order:
/// the import, and the stretches it was named by, as a step stores them.
#[derive(Debug, Clone)]
pub struct Collapsing {
    pattern: ImportedPattern,
    creases: Vec<CollapseCrease>,
}

impl Collapsing {
    /// The parent's crease pattern with `creases` changed, imported after
    /// it (see the module docs).
    pub fn new(parent: &State, creases: &[CollapseCrease]) -> Result<Collapsing, CollapseError> {
        if creases.is_empty() {
            return Err(CollapseRefusal::Empty.into());
        }
        if let Some(index) = creases
            .iter()
            .position(|c| c.a.iter().chain(&c.b).any(|v| !v.is_finite()))
        {
            return Err(CollapseRefusal::NotFinite { index }.into());
        }
        let stored = canonical(creases);
        let input = derived_input(parent, &stored)?;
        check_vertices(parent, &input)?;
        let mut pattern = ImportedPattern::new(&input, ImportTarget::After(parent))?;
        let step = parent.step() + 1;
        pattern.retime(|a, b, kind| {
            let middle = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
            match parent.crease_at(middle) {
                Some(before) if before.kind == kind => before.made_at,
                _ => step,
            }
        });
        Ok(Collapsing {
            pattern,
            creases: stored,
        })
    }

    /// The import the pattern is: its summary, its orders, its states.
    pub fn pattern(&self) -> &ImportedPattern {
        &self.pattern
    }

    /// The stretches as a step stores them: merged where one continues
    /// another with the same letter, in a fixed order.
    pub fn creases(&self) -> &[CollapseCrease] {
        &self.creases
    }

    /// Replay a stored order (plan D6): its witnesses and the letters must
    /// decide one order.
    pub fn replay(
        &self,
        stored: &WitnessOrder,
        limits: &CompletionLimits,
    ) -> Result<State, Broken> {
        self.pattern.replay(stored, limits)
    }
}

/// The state a stored Collapse lands after `parent`.
pub fn collapse(
    parent: &State,
    creases: &[CollapseCrease],
    stored: &WitnessOrder,
    limits: &CompletionLimits,
) -> Result<Result<State, Broken>, CollapseError> {
    Ok(Collapsing::new(parent, creases)?.replay(stored, limits))
}

// ---------------------------------------------------------------------------
// The stretches

/// A stretch's line: its start, unit direction and length.
struct Along {
    a: Point,
    d: Point,
    length: f64,
}

impl Along {
    fn of(a: Point, b: Point) -> Option<Along> {
        let length = (b[0] - a[0]).hypot(b[1] - a[1]);
        (length > TOL).then(|| Along {
            a,
            d: [(b[0] - a[0]) / length, (b[1] - a[1]) / length],
            length,
        })
    }

    fn off(&self, p: Point) -> f64 {
        ((p[0] - self.a[0]) * self.d[1] - (p[1] - self.a[1]) * self.d[0]).abs()
    }

    fn t(&self, p: Point) -> f64 {
        (p[0] - self.a[0]) * self.d[0] + (p[1] - self.a[1]) * self.d[1]
    }

    fn at(&self, t: f64) -> Point {
        [self.a[0] + self.d[0] * t, self.a[1] + self.d[1] * t]
    }

    /// Where a segment lies along the line, ascending; none off it.
    fn span(&self, p: Point, q: Point) -> Option<[f64; 2]> {
        if self.off(p) > TOL || self.off(q) > TOL {
            return None;
        }
        let (tp, tq) = (self.t(p), self.t(q));
        Some([tp.min(tq), tp.max(tq)])
    }
}

/// The stretches merged where one continues another along one line with the
/// same letter, each running from its lower end, sorted: one order for one
/// set of picks, whatever order they were picked in.
fn canonical(creases: &[CollapseCrease]) -> Vec<CollapseCrease> {
    let lower = |c: &CollapseCrease| {
        let swap = c.a[0] > c.b[0] + TOL || ((c.a[0] - c.b[0]).abs() <= TOL && c.a[1] > c.b[1]);
        if swap {
            CollapseCrease {
                a: c.b,
                b: c.a,
                to: c.to,
            }
        } else {
            *c
        }
    };
    let mut out: Vec<CollapseCrease> = creases.iter().map(lower).collect();
    let mut merged = true;
    while merged {
        merged = false;
        'search: for i in 0..out.len() {
            for j in i + 1..out.len() {
                if out[i].to != out[j].to {
                    continue;
                }
                let Some(line) = Along::of(out[i].a, out[i].b) else {
                    continue;
                };
                let Some([s, e]) = line.span(out[j].a, out[j].b) else {
                    continue;
                };
                // Touching or overlapping along the line.
                if s > line.length + TOL || e < -TOL {
                    continue;
                }
                // The ends furthest apart along the line, as they were named:
                // a merge never moves a point.
                let ends = [out[i].a, out[i].b, out[j].a, out[j].b];
                let along = |p: &Point| line.t(*p);
                let first = ends
                    .iter()
                    .min_by(|p, q| along(p).total_cmp(&along(q)))
                    .copied()
                    .unwrap_or(out[i].a);
                let last = ends
                    .iter()
                    .max_by(|p, q| along(p).total_cmp(&along(q)))
                    .copied()
                    .unwrap_or(out[i].b);
                out[i] = lower(&CollapseCrease {
                    a: first,
                    b: last,
                    to: out[i].to,
                });
                out.remove(j);
                merged = true;
                break 'search;
            }
        }
    }
    out.sort_by(|p, q| {
        p.a[0]
            .total_cmp(&q.a[0])
            .then(p.a[1].total_cmp(&q.a[1]))
            .then(p.b[0].total_cmp(&q.b[0]))
            .then(p.b[1].total_cmp(&q.b[1]))
    });
    out
}

/// The parent's crease pattern as Import CP reads a state back
/// ([`CreasePatternInput::of_state`]), with every stretch's creases
/// changed: the edges along it in place — an edge a stretch ends inside is
/// cut there, where another line of the parent meets it, its two pieces
/// changed apart — and the parts of crease marks it folds as folded segments
/// of their own (the marks stay; the creases own the stretch they share).
fn derived_input(
    parent: &State,
    creases: &[CollapseCrease],
) -> Result<CreasePatternInput, CollapseRefusal> {
    let edges: Vec<(Point, Point, CreaseKind)> = parent
        .creases()
        .iter()
        .map(|c| {
            let [a, b] = c.vertices.map(|v| parent.vertices()[v.index()]);
            (a, b, c.kind)
        })
        .collect();
    let marks = parent.crease_marks();
    // Per edge, the parts of it the stretches name, along the edge from its
    // first end, and what each becomes.
    let mut named: Vec<Vec<([f64; 2], CollapseTo)>> = vec![Vec::new(); edges.len()];
    let mut folded_marks: Vec<ImportSegment> = Vec::new();
    for (index, crease) in creases.iter().enumerate() {
        let Some(line) = Along::of(crease.a, crease.b) else {
            return Err(CollapseRefusal::CreaseMissing {
                index,
                point: crease.a,
            });
        };
        let mut covered: Vec<[f64; 2]> = Vec::new();
        for (k, &(a, b, kind)) in edges.iter().enumerate() {
            let Some([s, e]) = line.span(a, b) else {
                continue;
            };
            let (lo, hi) = (s.max(0.0), e.min(line.length));
            if hi - lo <= TOL {
                continue;
            }
            // The border is no crease.
            if kind == CreaseKind::Border {
                return Err(CollapseRefusal::CreaseMissing {
                    index,
                    point: line.at((lo + hi) / 2.0),
                });
            }
            let Some(edge) = Along::of(a, b) else {
                continue;
            };
            let (u, v) = (edge.t(line.at(lo)), edge.t(line.at(hi)));
            let part = [u.min(v).max(0.0), u.max(v).min(edge.length)];
            if named[k]
                .iter()
                .any(|(p, to)| *to != crease.to && p[0] < part[1] - TOL && part[0] < p[1] - TOL)
            {
                return Err(CollapseRefusal::CreaseTwice {
                    index,
                    point: line.at((lo + hi) / 2.0),
                });
            }
            named[k].push((part, crease.to));
            covered.push([lo, hi]);
        }
        for mark in marks {
            let Some([s, e]) = line.span(mark.a, mark.b) else {
                continue;
            };
            let (lo, hi) = (s.max(0.0), e.min(line.length));
            if hi - lo <= TOL {
                continue;
            }
            covered.push([lo, hi]);
            if let Some(letter) = crease.to.letter() {
                folded_marks.push(ImportSegment {
                    from: line.at(lo),
                    to: line.at(hi),
                    kind: folded(letter),
                });
            }
        }
        if let Some(gap) = first_gap(&mut covered, line.length) {
            return Err(CollapseRefusal::CreaseMissing {
                index,
                point: line.at(gap),
            });
        }
    }
    let of_state = CreasePatternInput::of_state(parent);
    let mut segments: Vec<ImportSegment> = Vec::with_capacity(of_state.segments.len());
    // `of_state` lists the edges first, in id order, then the marks.
    for (k, segment) in of_state.segments.into_iter().enumerate() {
        let parts = named.get(k).map(Vec::as_slice).unwrap_or_default();
        let edge = Along::of(segment.from, segment.to);
        let (Some(edge), false) = (edge, parts.is_empty()) else {
            segments.push(segment);
            continue;
        };
        // Cut at every end a stretch has inside the edge; each piece is what
        // the stretch over it makes it, or what it was.
        let mut cuts: Vec<f64> = vec![0.0, edge.length];
        for &(part, _) in parts {
            cuts.extend(part.iter().filter(|&&t| t > TOL && t < edge.length - TOL));
        }
        cuts.sort_by(f64::total_cmp);
        cuts.dedup_by(|p, q| (*p - *q).abs() <= TOL);
        for pair in cuts.windows(2) {
            let (lo, hi) = (pair[0], pair[1]);
            let middle = (lo + hi) / 2.0;
            let kind = parts
                .iter()
                .find(|(part, _)| part[0] < middle && middle < part[1])
                .map_or(segment.kind, |&(_, to)| changed(segment.kind, to));
            segments.push(ImportSegment {
                from: edge.at(lo),
                to: edge.at(hi),
                kind,
            });
        }
    }
    segments.extend(folded_marks);
    Ok(CreasePatternInput {
        space: ImportSpace::Sheet,
        segments,
    })
}

/// What a crease of `kind` becomes: folded with the letter given, or, open,
/// flat remembering the letter it had.
fn changed(kind: ImportKind, to: CollapseTo) -> ImportKind {
    match (to.letter(), kind) {
        (Some(letter), _) => folded(letter),
        (None, ImportKind::Mountain) => ImportKind::Unassigned {
            hint: Some(Letter::Mountain),
        },
        (None, ImportKind::Valley) => ImportKind::Unassigned {
            hint: Some(Letter::Valley),
        },
        (None, kind) => kind,
    }
}

fn folded(letter: Letter) -> ImportKind {
    match letter {
        Letter::Mountain => ImportKind::Mountain,
        Letter::Valley => ImportKind::Valley,
    }
}

/// The first point of `[0, length]` no span covers, by more than the
/// tolerance; none when they cover it end to end.
fn first_gap(spans: &mut [[f64; 2]], length: f64) -> Option<f64> {
    spans.sort_by(|p, q| p[0].total_cmp(&q[0]));
    let mut reached = 0.0_f64;
    for &[lo, hi] in spans.iter() {
        if lo > reached + TOL {
            return Some(reached);
        }
        reached = reached.max(hi);
    }
    (reached < length - TOL).then_some(reached)
}

// ---------------------------------------------------------------------------
// Flat at every vertex

/// A folded crease leaving a vertex: its direction and letter.
struct Ray {
    angle: f64,
    letter: Letter,
}

/// Refuse the first inside vertex whose folded creases break Maekawa's or
/// Kawasaki's theorem. The vertices are the ends of every folded segment of
/// the derived pattern and where two of them cross; at each, a segment
/// ending there leaves it once and one passing through it twice.
fn check_vertices(parent: &State, input: &CreasePatternInput) -> Result<(), CollapseRefusal> {
    let segments: Vec<(Point, Point, Letter)> = input
        .segments
        .iter()
        .filter_map(|s| match s.kind {
            ImportKind::Mountain => Some((s.from, s.to, Letter::Mountain)),
            ImportKind::Valley => Some((s.from, s.to, Letter::Valley)),
            _ => None,
        })
        .collect();
    let mut points: Vec<Point> = Vec::new();
    let push = |p: Point, points: &mut Vec<Point>| {
        if !points
            .iter()
            .any(|q| (q[0] - p[0]).hypot(q[1] - p[1]) <= TOL)
        {
            points.push(p);
        }
    };
    for &(a, b, _) in &segments {
        push(a, &mut points);
        push(b, &mut points);
    }
    for (i, &(a, b, _)) in segments.iter().enumerate() {
        for &(c, d, _) in &segments[i + 1..] {
            if let Some(p) = crossing(a, b, c, d) {
                push(p, &mut points);
            }
        }
    }
    let outline = parent.sheet().outline();
    points.sort_by(|p, q| p[0].total_cmp(&q[0]).then(p[1].total_cmp(&q[1])));
    for p in points {
        // Only an inside vertex: one on the sheet's edge folds any way.
        if !convex::contains_point(outline, p, TOL) {
            continue;
        }
        let mut rays: Vec<Ray> = Vec::new();
        for &(a, b, letter) in &segments {
            let Some(line) = Along::of(a, b) else {
                continue;
            };
            if line.off(p) > TOL {
                continue;
            }
            let t = line.t(p);
            if t < -TOL || t > line.length + TOL {
                continue;
            }
            let toward = |q: Point| Ray {
                angle: (q[1] - p[1]).atan2(q[0] - p[0]),
                letter,
            };
            if t > TOL {
                rays.push(toward(a));
            }
            if t < line.length - TOL {
                rays.push(toward(b));
            }
        }
        if rays.is_empty() {
            continue;
        }
        let mountains = rays.iter().filter(|r| r.letter == Letter::Mountain).count();
        let valleys = rays.len() - mountains;
        if mountains.abs_diff(valleys) != 2 {
            return Err(CollapseRefusal::NotFlatAtVertex {
                rule: VertexRule::Maekawa,
                point: p,
            });
        }
        rays.sort_by(|r, s| r.angle.total_cmp(&s.angle));
        let tau = std::f64::consts::TAU;
        let alternate: f64 = (0..rays.len())
            .map(|k| {
                let next = rays[(k + 1) % rays.len()].angle;
                let sector = (next - rays[k].angle).rem_euclid(tau);
                if k % 2 == 0 { sector } else { -sector }
            })
            .sum();
        if alternate.abs() > ANGLE_TOL {
            return Err(CollapseRefusal::NotFlatAtVertex {
                rule: VertexRule::Kawasaki,
                point: p,
            });
        }
    }
    Ok(())
}

/// How far the alternate angles may sum from zero, in radians: a crease
/// pattern exact to [`TOL`] in a unit sheet is exact to far better.
const ANGLE_TOL: f64 = 1e-6;

/// Where two segments cross strictly inside both; none for parallel ones,
/// and where either ends (an end is a vertex already).
fn crossing(a: Point, b: Point, c: Point, d: Point) -> Option<Point> {
    let r = [b[0] - a[0], b[1] - a[1]];
    let s = [d[0] - c[0], d[1] - c[1]];
    let denom = r[0] * s[1] - r[1] * s[0];
    let scale = r[0].hypot(r[1]) * s[0].hypot(s[1]);
    if scale == 0.0 || denom.abs() <= 1e-12 * scale {
        return None;
    }
    let q = [c[0] - a[0], c[1] - a[1]];
    let t = (q[0] * s[1] - q[1] * s[0]) / denom;
    let u = (q[0] * r[1] - q[1] * r[0]) / denom;
    let (lr, ls) = (r[0].hypot(r[1]), s[0].hypot(s[1]));
    let inside = |v: f64, length: f64| v * length > TOL && (1.0 - v) * length > TOL;
    (inside(t, lr) && inside(u, ls)).then(|| [a[0] + r[0] * t, a[1] + r[1] * t])
}
