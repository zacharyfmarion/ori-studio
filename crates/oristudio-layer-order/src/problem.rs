//! The layer-order constraint problem of a folded view, in the facewise model
//! of Akitaya, Demaine & Ku, "Computing Flat-Folded States" (OSME 2024;
//! research §2.1, r1-theory §3), re-derived here from the face images:
//!
//! - **Variables:** the face pairs whose images overlap by more than [`TOL`]
//!   (separating-axis penetration): the [`Overlay`]'s pairs.
//! - **Taco-taco:** two folded creases along one line, with all four faces on
//!   one side: the two pairs nest or stack, never interleave.
//! - **Taco-tortilla:** a folded crease through a face's interior, or along
//!   a flat crease whose face on the taco's side is that face: the face is not
//!   between the crease's two faces.
//! - **Tortilla-tortilla:** a flat crease through a face's interior: the face
//!   lies on one side of both its faces; two flat creases along one line: the
//!   two faces on each side are stacked the same way.
//! - **Transitivity** is not listed: it is derived from the cells of the
//!   [`Overlay`] (three faces sharing a cell are not cyclic), as Flat-Folder's
//!   search derives it from its own cells.
//!
//! Each constraint is stored once, as the face tuple Flat-Folder's
//! `constraints.js` uses for its type, so a search adapter passes it on as it
//! is; [`Buckets`] lists, per variable, the constraints that involve it.
//!
//! # Ambiguity
//!
//! Overlap is decided at one tolerance, but by three tests: penetration for
//! variables, carving for cells, and edge geometry for constraints. Where they
//! disagree about a pair, the state has an overlap within the tolerance band,
//! and the pair is reported as an [`Ambiguity`] rather than resolved one way.
//! A constraint that needs a non-overlapping pair is left out; a search must
//! refuse a problem with ambiguities (a cell pair that is no variable would
//! be a transitivity triple over a missing variable).
//!
//! # After an operation
//!
//! [`ConstraintProblem::rebuild`] does the geometric work only where a
//! touched face is involved: pairs and constraints of untouched faces keep
//! their verdicts, and the overlay keeps the cells of every face that neither
//! was touched nor overlaps a touched face ([`Overlay::rebuild`]). What is
//! left is linear in the problem's size: merging the kept and new parts and
//! indexing them again.

use std::collections::BTreeSet;

use oristudio_geometry::convex;
use oristudio_geometry::tol::TOL;
use serde::{Deserialize, Serialize};

use crate::error::LayerOrderError;
use crate::order::{FacePair, LayerOrder};
use crate::overlay::Overlay;
use crate::shape::Shape;
use crate::table::{IdSet, PairTable};
use crate::view::{EdgeKind, FaceId, FoldedView};

/// The three constraint families listed per variable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConstraintKind {
    TacoTaco,
    TacoTortilla,
    TortillaTortilla,
}

/// One constraint, as Flat-Folder's face tuple for its type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Constraint {
    /// `[a, b, c, d]`: the folded creases a–b and c–d run along one line with
    /// all four faces on one side, so the pairs {a, b} and {c, d} nest or
    /// stack. Pairs, in Flat-Folder's order: (a, b) (c, d) (c, b) (a, d)
    /// (a, c) (b, d).
    TacoTaco([FaceId; 4]),
    /// `[a, b, c]`: c is not between the faces a and b of a folded crease.
    /// Pairs: (a, c) (c, b).
    TacoTortilla([FaceId; 3]),
    /// `[a, b, c, d]`: a lies above c iff b lies above d, for the faces a, b
    /// of a flat crease and c, d on their sides (c = d for one face the crease
    /// passes through). Pairs: (a, c) (b, d).
    TortillaTortilla([FaceId; 4]),
}

impl Constraint {
    pub fn kind(&self) -> ConstraintKind {
        match self {
            Constraint::TacoTaco(_) => ConstraintKind::TacoTaco,
            Constraint::TacoTortilla(_) => ConstraintKind::TacoTortilla,
            Constraint::TortillaTortilla(_) => ConstraintKind::TortillaTortilla,
        }
    }

    /// The face tuple.
    pub fn faces(&self) -> &[FaceId] {
        match self {
            Constraint::TacoTaco(f) | Constraint::TortillaTortilla(f) => f,
            Constraint::TacoTortilla(f) => f,
        }
    }

    /// The pairs the constraint relates, in Flat-Folder's order for its type
    /// (see each variant), each `[first, second]`.
    pub fn ordered_pairs(&self) -> Vec<[FaceId; 2]> {
        let (pairs, len) = self.pair_array();
        pairs[..len].to_vec()
    }

    /// [`Constraint::ordered_pairs`] without allocating: the first `len`.
    fn pair_array(&self) -> ([[FaceId; 2]; 6], usize) {
        match *self {
            Constraint::TacoTaco([a, b, c, d]) => {
                ([[a, b], [c, d], [c, b], [a, d], [a, c], [b, d]], 6)
            }
            Constraint::TacoTortilla([a, b, c]) => {
                ([[a, c], [c, b], [a, a], [a, a], [a, a], [a, a]], 2)
            }
            Constraint::TortillaTortilla([a, b, c, d]) => {
                ([[a, c], [b, d], [a, a], [a, a], [a, a], [a, a]], 2)
            }
        }
    }

    /// Whether the order satisfies the constraint; `None` when a pair it
    /// needs is absent or undetermined.
    pub fn holds(&self, order: &LayerOrder) -> Option<bool> {
        self.holds_by(|f, g| order.above(f, g))
    }

    /// [`Constraint::holds`] over any `above`.
    pub(crate) fn holds_by(&self, above: impl Fn(FaceId, FaceId) -> Option<bool>) -> Option<bool> {
        match *self {
            Constraint::TacoTaco(faces) => {
                let mut rank = [0usize; 4];
                for i in 0..4 {
                    for j in 0..4 {
                        if i != j && above(faces[i], faces[j])? {
                            rank[i] += 1;
                        }
                    }
                }
                Some(taco_taco_holds(rank))
            }
            Constraint::TacoTortilla([a, b, c]) => Some(above(c, a)? == above(c, b)?),
            Constraint::TortillaTortilla([a, b, c, d]) => Some(above(a, c)? == above(b, d)?),
        }
    }

    /// One form per constraint: the least of the tuples that state it.
    fn canonical(self) -> Constraint {
        match self {
            Constraint::TacoTaco([a, b, c, d]) => {
                let (ab, cd) = (sorted2(a, b), sorted2(c, d));
                let [x, y] = if ab <= cd { [ab, cd] } else { [cd, ab] };
                Constraint::TacoTaco([x[0], x[1], y[0], y[1]])
            }
            Constraint::TacoTortilla([a, b, c]) => {
                let [a, b] = sorted2(a, b);
                Constraint::TacoTortilla([a, b, c])
            }
            Constraint::TortillaTortilla([a, b, c, d]) => {
                let forms = [[a, b, c, d], [b, a, d, c], [c, d, a, b], [d, c, b, a]];
                let least = forms.into_iter().min().unwrap_or([a, b, c, d]);
                Constraint::TortillaTortilla(least)
            }
        }
    }
}

/// Taco-taco from the faces' ranks (how many of the other three each lies
/// above): the four must be stacked (ranks 0..3, which for four faces is
/// exactly acyclic) with {a, b} and {c, d} not interleaved. This is
/// Flat-Folder's table of 16 valid assignments.
fn taco_taco_holds(rank: [usize; 4]) -> bool {
    let mut seen = [false; 4];
    for r in rank {
        if r > 3 || seen[r] {
            return false;
        }
        seen[r] = true;
    }
    let (lo1, hi1) = (rank[0].min(rank[1]), rank[0].max(rank[1]));
    let (lo2, hi2) = (rank[2].min(rank[3]), rank[2].max(rank[3]));
    !((lo1 < lo2 && lo2 < hi1 && hi1 < hi2) || (lo2 < lo1 && lo1 < hi2 && hi2 < hi1))
}

fn sorted2(a: FaceId, b: FaceId) -> [FaceId; 2] {
    if a <= b { [a, b] } else { [b, a] }
}

/// The constraints that involve one variable, as indices into
/// [`ConstraintProblem::constraints`], ascending.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Buckets {
    pub taco_taco: Vec<usize>,
    pub taco_tortilla: Vec<usize>,
    pub tortilla_tortilla: Vec<usize>,
}

impl Buckets {
    pub fn get(&self, kind: ConstraintKind) -> &[usize] {
        match kind {
            ConstraintKind::TacoTaco => &self.taco_taco,
            ConstraintKind::TacoTortilla => &self.taco_tortilla,
            ConstraintKind::TortillaTortilla => &self.tortilla_tortilla,
        }
    }

    fn push(&mut self, kind: ConstraintKind, constraint: usize) {
        match kind {
            ConstraintKind::TacoTaco => self.taco_taco.push(constraint),
            ConstraintKind::TacoTortilla => self.taco_tortilla.push(constraint),
            ConstraintKind::TortillaTortilla => self.tortilla_tortilla.push(constraint),
        }
    }
}

/// The most [`StackDepth::triples`] a bounded build takes
/// ([`ConstraintProblem::build_within`]): one stack 417 layers deep, or
/// several shallower ones.
///
/// Completing and replaying an order grows with the triples, whatever the
/// face count. Chosen so that a step this admits replays in about 3 s in the
/// browser: through the built bridge in Node (`import_cp`, then
/// `import_pick`, which lands the step as every replay of its `cp-jump`
/// does), of the 471 real designs of the cpoogle corpus that import, the 463
/// under this cap — up to 11.3 million triples, and the fixtures' 850-face
/// iguana at 10.2 million — replay in at most 2.7 s and open in at most
/// 5.6 s; the first two over it, at 12.6 and 12.8 million, replay in
/// 3.3–3.8 s. Of the other 6 over it, two at 18–19 million replay in 2.9
/// and 8.7 s, and four at 51–80 million in 36–57 s natively (the bridge
/// takes 1.1–1.4 times as long as native). It was 4,000,000 before the
/// solver's rework, when the
/// designs between the two replayed in 2.4–7.0 s
/// (`implementation-plans/fold-solver-performance.md` has the tables). A
/// count, not a clock, so a saved step is refused, or not, alike on every
/// machine; raising it never refuses a step that was admitted.
pub const MAX_STACKED_TRIPLES: u64 = 12_000_000;

/// How deeply a view's layers stack: what completing and checking its order
/// cost, where its face count does not say.
///
/// Every three faces that overlap one another are a transitivity constraint
/// the order must keep — in the cells the three share, which the search
/// visits over and over — so the search's work grows with
/// [`StackDepth::triples`]: a stack `d` layers deep has `d(d-1)(d-2)/6` of
/// them however few faces the view has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct StackDepth {
    /// The most faces covering one cell: the deepest stack.
    pub deepest: usize,
    /// The triples of faces that overlap one another pairwise.
    pub triples: u64,
}

impl StackDepth {
    /// How deeply `view`, whose overlay is `overlay`, stacks.
    pub fn of(view: &FoldedView, overlay: &Overlay) -> StackDepth {
        let deepest = overlay
            .cells()
            .iter()
            .map(|c| c.faces.len())
            .max()
            .unwrap_or(0);
        StackDepth {
            deepest,
            triples: overlapping_triples(view, overlay.pairs()),
        }
    }

    /// Refused when there are more triples than `limit`.
    fn within(self, limit: u64) -> Result<(), LayerOrderError> {
        if self.triples > limit {
            return Err(LayerOrderError::StackedTooDeep {
                deepest: self.deepest,
                triples: self.triples,
                limit,
            });
        }
        Ok(())
    }
}

/// The triples of the view's faces among `pairs` that overlap one another
/// pairwise: the triangles of the graph the pairs make, each counted once,
/// by bitsets over view positions (`n²/8` bytes, 2 MB at
/// [`crate::view::MAX_FACES`]).
fn overlapping_triples(view: &FoldedView, pairs: &[FacePair]) -> u64 {
    let n = view.faces().len();
    let words = n.div_ceil(64);
    let mut adjacent = vec![0u64; n * words];
    let mut edges = Vec::with_capacity(pairs.len());
    for pair in pairs {
        if let (Some(a), Some(b)) = (view.index_of(pair.lo()), view.index_of(pair.hi()))
            && a != b
        {
            let (i, j) = (a.min(b), a.max(b));
            adjacent[i * words + j / 64] |= 1 << (j % 64);
            adjacent[j * words + i / 64] |= 1 << (i % 64);
            edges.push((i, j));
        }
    }
    let mut triples = 0u64;
    for (i, j) in edges {
        // The third faces past `j`, so each triple is counted at its two
        // smallest positions only.
        let (first, below) = (j / 64, (j % 64) as u32 + 1);
        for w in first..words {
            let mut common = adjacent[i * words + w] & adjacent[j * words + w];
            if w == first {
                common &= u64::MAX.checked_shl(below).unwrap_or(0);
            }
            triples += u64::from(common.count_ones());
        }
    }
    triples
}

/// A pair the tolerance cannot decide (see the module docs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Ambiguity {
    pub pair: FacePair,
    pub cause: AmbiguityCause,
}

/// Which two tests disagree about an [`Ambiguity`]'s pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AmbiguityCause {
    /// The faces share a cell but overlap by at most [`TOL`].
    SharedCell,
    /// The faces overlap by more than [`TOL`] but share no cell.
    NoSharedCell,
    /// A folded edge joins the faces, which overlap by at most [`TOL`].
    FoldedEdge { edge: usize },
    /// The edges call for this constraint, which needs the pair, and the
    /// faces overlap by at most [`TOL`]. The constraint is left out.
    Constraint(Constraint),
}

/// Variables, constraints and cells of one view.
#[derive(Debug, Clone, PartialEq)]
pub struct ConstraintProblem {
    /// The view's faces, in its order: the positions the overlay records.
    faces: Vec<FaceId>,
    constraints: Vec<Constraint>,
    buckets: Vec<Buckets>,
    /// Its pairs are the variables.
    overlay: Overlay,
    ambiguities: Vec<Ambiguity>,
    /// Each taco-tortilla a folded and a flat crease made, kept or dropped,
    /// with the flat crease's face that the tuple does not name: it depends
    /// on that face too, which a rebuild must know.
    hidden: Vec<(Constraint, FaceId)>,
}

/// The constraints a build found, and those a missing pair kept out. Runs
/// after every variable is known.
struct Found<'v> {
    view: &'v FoldedView,
    /// Whether a pair of view positions is a variable.
    is_variable: PairTable<bool>,
    constraints: Vec<Constraint>,
    dropped: Vec<(Constraint, FacePair)>,
    hidden: Vec<(Constraint, FaceId)>,
}

impl<'v> Found<'v> {
    fn new(view: &'v FoldedView, variables: &[FacePair]) -> Found<'v> {
        let mut is_variable = PairTable::new(view.faces().len());
        for pair in variables {
            if let (Some(i), Some(j)) = (view.index_of(pair.lo()), view.index_of(pair.hi())) {
                is_variable.set(i, j, true);
                is_variable.set(j, i, true);
            }
        }
        Found {
            view,
            is_variable,
            constraints: Vec::new(),
            dropped: Vec::new(),
            hidden: Vec::new(),
        }
    }

    /// Record a generated constraint, or the first pair that keeps it out,
    /// with the face it depends on but does not name.
    fn add_made(&mut self, made: Option<(Constraint, Option<FaceId>)>) {
        let Some((constraint, hidden)) = made else {
            return;
        };
        let constraint = constraint.canonical();
        if let Some(x) = hidden {
            self.hidden.push((constraint, x));
        }
        self.add(Some(constraint));
    }

    /// Record a generated constraint, or the first pair that keeps it out.
    fn add(&mut self, constraint: Option<Constraint>) {
        let Some(constraint) = constraint else {
            return;
        };
        let constraint = constraint.canonical();
        let (pairs, len) = constraint.pair_array();
        let missing = pairs[..len].iter().find_map(|&[x, y]| {
            let pair = FacePair::new(x, y)?;
            let (i, j) = (self.view.index_of(x), self.view.index_of(y));
            let known = matches!((i, j), (Some(i), Some(j)) if self.is_variable.get(i, j));
            (!known).then_some(pair)
        });
        match missing {
            Some(pair) => self.dropped.push((constraint, pair)),
            None => self.constraints.push(constraint),
        }
    }
}

impl ConstraintProblem {
    /// Build everything from the view.
    pub fn build(view: &FoldedView) -> ConstraintProblem {
        let shapes = Shape::of_view(view);
        let overlay = Overlay::build_from(view, &shapes);
        ConstraintProblem::built(view, &shapes, overlay)
    }

    /// [`ConstraintProblem::build`], refused once the overlay shows more
    /// [`StackDepth::triples`] than `limit`, before a constraint is enumerated
    /// or an order searched for ([`MAX_STACKED_TRIPLES`] is the engine's).
    /// The count is the state's own, so a state is refused, or not, the same
    /// way every time it is built.
    pub fn build_within(
        view: &FoldedView,
        limit: u64,
    ) -> Result<ConstraintProblem, LayerOrderError> {
        let shapes = Shape::of_view(view);
        let overlay = Overlay::build_from(view, &shapes);
        StackDepth::of(view, &overlay).within(limit)?;
        Ok(ConstraintProblem::built(view, &shapes, overlay))
    }

    /// The constraints of `view` over its overlay, enumerated in full.
    fn built(view: &FoldedView, shapes: &[Shape<'_>], overlay: Overlay) -> ConstraintProblem {
        let mut found = Found::new(view, overlay.pairs());
        let segments = segments(view);
        let (n, edges) = (shapes.len(), segments.len());
        for e in 0..edges {
            for h in 0..n {
                found.add(edge_face(view, shapes, &segments, e, h));
            }
            for e2 in e + 1..edges {
                found.add_made(edge_edge(view, &segments, e, e2));
            }
        }
        ConstraintProblem::assemble(view, overlay, found)
    }

    /// The problem of `view`, a later state of this problem's view, reusing
    /// everything that involves only untouched faces.
    ///
    /// A face is untouched when its image, its orientation and every edge it
    /// shares with another untouched face are unchanged. Faces new to the view
    /// or gone from it count as touched. The result equals
    /// [`ConstraintProblem::build`] of `view`; the overlay is rebuilt with
    /// [`Overlay::rebuild`], so the same holds of its cells.
    pub fn rebuild(&self, view: &FoldedView, touched: &BTreeSet<FaceId>) -> ConstraintProblem {
        let shapes = Shape::of_view(view);
        let touched = self.overlay.touched_in(view, touched);
        let overlay = self.overlay.rebuild_from(view, &shapes, &touched);
        self.rebuilt(view, &shapes, &touched, overlay)
    }

    /// [`ConstraintProblem::rebuild`], refused as
    /// [`ConstraintProblem::build_within`] refuses: the rebuilt overlay is
    /// the one a build makes, so the verdict is a build's.
    pub fn rebuild_within(
        &self,
        view: &FoldedView,
        touched: &BTreeSet<FaceId>,
        limit: u64,
    ) -> Result<ConstraintProblem, LayerOrderError> {
        let shapes = Shape::of_view(view);
        let touched = self.overlay.touched_in(view, touched);
        let overlay = self.overlay.rebuild_from(view, &shapes, &touched);
        StackDepth::of(view, &overlay).within(limit)?;
        Ok(self.rebuilt(view, &shapes, &touched, overlay))
    }

    /// The rest of a rebuild, over its overlay; `touched` holds the new and
    /// gone faces.
    fn rebuilt(
        &self,
        view: &FoldedView,
        shapes: &[Shape<'_>],
        touched: &BTreeSet<FaceId>,
        overlay: Overlay,
    ) -> ConstraintProblem {
        // A taco-tortilla depends on the face across its flat crease, which
        // its tuple does not name: where that face was touched, its named
        // face is made again as if it had been.
        let reach = reach(&self.hidden, touched);
        let reach = IdSet::new(&reach);
        let untouched = |faces: &[FaceId]| !reach.any(faces);
        let mut found = Found::new(view, overlay.pairs());
        found.constraints = self
            .constraints
            .iter()
            .filter(|c| untouched(c.faces()))
            .copied()
            .collect();
        found.dropped = self
            .ambiguities
            .iter()
            .filter_map(|a| match a.cause {
                AmbiguityCause::Constraint(c) if untouched(c.faces()) => Some((c, a.pair)),
                _ => None,
            })
            .collect();
        found.hidden = self
            .hidden
            .iter()
            .filter(|(c, x)| untouched(c.faces()) && !reach.contains(*x))
            .copied()
            .collect();

        // An edge of a reached face against every face, any other edge
        // against the reached faces; then the reached faces' edges against
        // every edge.
        let n = shapes.len();
        let reached: Vec<usize> = (0..n).filter(|&h| reach.contains(shapes[h].id)).collect();
        let all_faces: Vec<usize> = (0..n).collect();
        let segments = segments(view);
        let reached_edge: Vec<bool> = view.edges().iter().map(|e| reach.any(&e.faces)).collect();
        for (e, &edge_reached) in reached_edge.iter().enumerate() {
            let faces = if edge_reached { &all_faces } else { &reached };
            for &h in faces {
                found.add(edge_face(view, shapes, &segments, e, h));
            }
        }
        for e in (0..reached_edge.len()).filter(|&e| reached_edge[e]) {
            for (e2, &other_reached) in reached_edge.iter().enumerate() {
                if e2 != e && (e2 > e || !other_reached) {
                    found.add_made(edge_edge(view, &segments, e, e2));
                }
            }
        }
        ConstraintProblem::assemble(view, overlay, found)
    }

    /// Index the constraints by variable and find the ambiguities. Every
    /// constraint relates variables only: generation checked the new ones, and
    /// a kept one relates untouched pairs, which kept their verdicts.
    fn assemble(view: &FoldedView, overlay: Overlay, found: Found<'_>) -> ConstraintProblem {
        let Found {
            mut constraints,
            mut dropped,
            mut hidden,
            ..
        } = found;
        constraints.sort_unstable();
        constraints.dedup();
        dropped.sort_unstable();
        dropped.dedup();
        hidden.sort_unstable();
        hidden.dedup();
        let n = view.faces().len();
        let variables = overlay.pairs();
        // Per pair of view positions, its variable's index.
        let mut index: PairTable<u32> = PairTable::filled(n, u32::MAX);
        for (v, pair) in variables.iter().enumerate() {
            if let (Some(i), Some(j)) = (view.index_of(pair.lo()), view.index_of(pair.hi())) {
                index.set(i, j, v as u32);
                index.set(j, i, v as u32);
            }
        }
        let variable_of = |x: FaceId, y: FaceId| match (view.index_of(x), view.index_of(y)) {
            (Some(i), Some(j)) if i != j => Some(index.get(i, j)).filter(|&v| v != u32::MAX),
            _ => None,
        };

        let mut buckets = vec![Buckets::default(); variables.len()];
        for (k, c) in constraints.iter().enumerate() {
            let (pairs, len) = c.pair_array();
            let mut seen = [u32::MAX; 6];
            for (s, &[x, y]) in pairs[..len].iter().enumerate() {
                if let Some(v) = variable_of(x, y)
                    && !seen[..s].contains(&v)
                {
                    seen[s] = v;
                    buckets[v as usize].push(c.kind(), k);
                }
            }
        }

        let mut ambiguities: Vec<Ambiguity> = dropped
            .iter()
            .map(|&(c, pair)| Ambiguity {
                pair,
                cause: AmbiguityCause::Constraint(c),
            })
            .collect();
        // Pairs that share a cell: every cell's pairs are those of a maximal
        // one.
        let faces = view.faces();
        let mut shared = PairTable::new(n);
        for &c in overlay.maximal_cells() {
            let cell = overlay.positions(c);
            for (k, &i) in cell.iter().enumerate() {
                for &j in &cell[k + 1..] {
                    shared.set(i, j, true);
                    if index.get(i, j) == u32::MAX
                        && let Some(pair) = FacePair::new(faces[i].id, faces[j].id)
                    {
                        ambiguities.push(Ambiguity {
                            pair,
                            cause: AmbiguityCause::SharedCell,
                        });
                    }
                }
            }
        }
        for pair in variables {
            if let (Some(i), Some(j)) = (view.index_of(pair.lo()), view.index_of(pair.hi()))
                && !shared.get(i, j)
                && !shared.get(j, i)
            {
                ambiguities.push(Ambiguity {
                    pair: *pair,
                    cause: AmbiguityCause::NoSharedCell,
                });
            }
        }
        for (e, edge) in view.edges().iter().enumerate() {
            if let (EdgeKind::Folded(_), Some(pair)) =
                (edge.kind, FacePair::new(edge.faces[0], edge.faces[1]))
                && variable_of(pair.lo(), pair.hi()).is_none()
            {
                ambiguities.push(Ambiguity {
                    pair,
                    cause: AmbiguityCause::FoldedEdge { edge: e },
                });
            }
        }
        ambiguities.sort_unstable();
        ambiguities.dedup();

        ConstraintProblem {
            faces: faces.iter().map(|f| f.id).collect(),
            constraints,
            buckets,
            overlay,
            ambiguities,
            hidden,
        }
    }

    /// The faces a check of this problem must judge after an operation that
    /// touched `touched` (as [`ConstraintProblem::rebuild`] takes them): those
    /// faces, and the named face of every taco-tortilla whose flat crease's
    /// other face was touched.
    ///
    /// A taco-tortilla along a flat crease depends on both of the crease's
    /// faces but names only one, so it can be new although no face it names
    /// was touched: unfolding a crease along a folded crease's line makes one
    /// over the faces on the far side. A [`crate::Scope::Faces`] check over
    /// the touched faces alone would not judge it; over these it does.
    pub fn scope_for(&self, touched: &BTreeSet<FaceId>) -> BTreeSet<FaceId> {
        reach(&self.hidden, touched)
    }

    /// Whether this is the problem of `view`'s faces, in its order (a check
    /// against another view would read the wrong cells).
    pub fn is_for(&self, view: &FoldedView) -> bool {
        self.faces.len() == view.faces().len()
            && self
                .faces
                .iter()
                .zip(view.faces())
                .all(|(id, face)| *id == face.id)
    }

    /// How deeply `view`'s layers stack, by this problem's overlay: what
    /// [`ConstraintProblem::build_within`] weighs.
    pub fn stack_depth(&self, view: &FoldedView) -> StackDepth {
        StackDepth::of(view, &self.overlay)
    }

    /// The overlapping pairs, ascending.
    pub fn variables(&self) -> &[FacePair] {
        self.overlay.pairs()
    }

    /// A pair's position in [`ConstraintProblem::variables`].
    pub fn variable(&self, pair: FacePair) -> Option<usize> {
        self.variables().binary_search(&pair).ok()
    }

    pub fn is_variable(&self, a: FaceId, b: FaceId) -> bool {
        FacePair::new(a, b).is_some_and(|p| self.variable(p).is_some())
    }

    /// Every constraint once, ascending.
    pub fn constraints(&self) -> &[Constraint] {
        &self.constraints
    }

    /// The constraints involving variable `v`.
    pub fn buckets(&self, v: usize) -> Option<&Buckets> {
        self.buckets.get(v)
    }

    pub fn overlay(&self) -> &Overlay {
        &self.overlay
    }

    /// The undecidable pairs, ascending; empty for a state the tolerance
    /// decides everywhere.
    pub fn ambiguities(&self) -> &[Ambiguity] {
        &self.ambiguities
    }
}

/// `touched`, and the named face of each taco-tortilla in `hidden` whose
/// unnamed face was touched.
fn reach(hidden: &[(Constraint, FaceId)], touched: &BTreeSet<FaceId>) -> BTreeSet<FaceId> {
    let mut reach = touched.clone();
    for (c, x) in hidden {
        if let Constraint::TacoTortilla([_, _, h]) = *c
            && touched.contains(x)
        {
            reach.insert(h);
        }
    }
    reach
}

/// What the edge tests need of each edge segment, computed once per build.
struct Segment {
    bbox: [f64; 4],
    length: f64,
    /// Left of `segment[0] → segment[1]`; none for a segment too short to
    /// have a direction (the view refuses those).
    line: Option<convex::HalfPlane>,
}

fn segments(view: &FoldedView) -> Vec<Segment> {
    view.edges()
        .iter()
        .map(|e| {
            let [p, q] = e.segment;
            Segment {
                bbox: convex::bounding_box(&e.segment),
                length: (q[0] - p[0]).hypot(q[1] - p[1]),
                line: convex::HalfPlane::left_of(p, q),
            }
        })
        .collect()
}

/// The constraint edge `e` makes with face `h` when it passes through h's
/// interior (by more than [`TOL`], for longer than `TOL`).
fn edge_face(
    view: &FoldedView,
    shapes: &[Shape<'_>],
    segments: &[Segment],
    e: usize,
    h: usize,
) -> Option<Constraint> {
    let edge = &view.edges()[e];
    let face = &shapes[h];
    let [a, b] = edge.faces;
    if face.id == a || face.id == b {
        return None;
    }
    let [p, q] = edge.segment;
    if !convex::boxes_overlap(&segments[e].bbox, &face.bbox, 0.0)
        || face.segment_length_inside(p, q, TOL) <= TOL
    {
        return None;
    }
    Some(match edge.kind {
        EdgeKind::Folded(_) => Constraint::TacoTortilla([a, b, face.id]),
        EdgeKind::Flat => Constraint::TortillaTortilla([a, b, face.id, face.id]),
    })
}

/// The constraint two edges make when they run along one line and overlap
/// for longer than [`TOL`]. A taco-tortilla comes with the flat crease's
/// other face, which it depends on but does not name.
fn edge_edge(
    view: &FoldedView,
    segments: &[Segment],
    e1: usize,
    e2: usize,
) -> Option<(Constraint, Option<FaceId>)> {
    if !convex::boxes_overlap(&segments[e1].bbox, &segments[e2].bbox, TOL) {
        return None;
    }
    let edges = view.edges();
    // Measure along the longer segment's line.
    let (r, o, r_left, o_left, reference) = if segments[e1].length >= segments[e2].length {
        (
            &edges[e1],
            &edges[e2],
            view.edge_left(e1),
            view.edge_left(e2),
            &segments[e1],
        )
    } else {
        (
            &edges[e2],
            &edges[e1],
            view.edge_left(e2),
            view.edge_left(e1),
            &segments[e2],
        )
    };
    let [p, q] = r.segment;
    let line = reference.line?;
    if o.segment
        .iter()
        .any(|&x| line.signed_distance(x).abs() > TOL)
    {
        return None;
    }
    let dir = [q[0] - p[0], q[1] - p[1]];
    let length = reference.length;
    let along = |x: [f64; 2]| ((x[0] - p[0]) * dir[0] + (x[1] - p[1]) * dir[1]) / length;
    let (u, v) = (along(o.segment[0]), along(o.segment[1]));
    if u.max(v).min(length) - u.min(v).max(0.0) <= TOL {
        return None;
    }
    // Sides relative to the reference direction.
    let same_way = along(o.segment[1]) >= along(o.segment[0]);
    let o_left = if same_way {
        o_left
    } else {
        [!o_left[0], !o_left[1]]
    };
    let ([a, b], [c, d]) = (r.faces, o.faces);
    // Edges join two faces each, so the four are distinct when the second
    // pair shares no face with the first.
    let distinct = c != a && c != b && d != a && d != b;
    match (r.kind, o.kind) {
        (EdgeKind::Folded(_), EdgeKind::Folded(_)) => (r_left[0] == o_left[0] && distinct)
            .then_some((Constraint::TacoTaco([a, b, c, d]), None)),
        (EdgeKind::Flat, EdgeKind::Flat) => {
            // c' shares a's side, d' shares b's.
            let (c, d) = if o_left[0] == r_left[0] {
                (c, d)
            } else {
                (d, c)
            };
            distinct.then_some((Constraint::TortillaTortilla([a, b, c, d]), None))
        }
        (EdgeKind::Folded(_), EdgeKind::Flat) => {
            let (h, x) = if o_left[0] == r_left[0] {
                (c, d)
            } else {
                (d, c)
            };
            (h != a && h != b).then_some((Constraint::TacoTortilla([a, b, h]), Some(x)))
        }
        (EdgeKind::Flat, EdgeKind::Folded(_)) => {
            let (h, x) = if r_left[0] == o_left[0] {
                (a, b)
            } else {
                (b, a)
            };
            (h != c && h != d).then_some((Constraint::TacoTortilla([c, d, h]), Some(x)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(id: u32) -> FaceId {
        FaceId(id)
    }

    /// Faces with these ids and `[x0, x1] × [0, 1]` images, alternately
    /// front-up, and no edges.
    fn strips(faces: &[(u32, f64, f64)]) -> FoldedView {
        use crate::view::Face;
        let faces = faces
            .iter()
            .map(|&(id, x0, x1)| Face {
                id: f(id),
                polygon: vec![[x0, 0.0], [x1, 0.0], [x1, 1.0], [x0, 1.0]],
                front_up: id.is_multiple_of(2),
            })
            .collect();
        FoldedView::new(faces, Vec::new()).unwrap_or_else(|e| panic!("{e}"))
    }

    /// `d` coincident unit squares, ids from `first`, at `x`.
    fn stack(first: u32, d: u32, x: f64) -> Vec<(u32, f64, f64)> {
        (first..first + d).map(|id| (id, x, x + 1.0)).collect()
    }

    fn choose3(d: u64) -> u64 {
        d * (d - 1) * (d - 2) / 6
    }

    #[test]
    fn the_stack_depth_counts_every_three_faces_that_overlap_one_another() {
        let depth = |faces: &[(u32, f64, f64)]| {
            let view = strips(faces);
            ConstraintProblem::build(&view).stack_depth(&view)
        };
        assert_eq!(
            depth(&stack(0, 5, 0.0)),
            StackDepth {
                deepest: 5,
                triples: 10
            }
        );
        // Two stacks apart: their triples add, the deepest is the deeper.
        let mut two = stack(0, 4, 0.0);
        two.extend(stack(10, 6, 5.0));
        assert_eq!(
            depth(&two),
            StackDepth {
                deepest: 6,
                triples: 4 + 20
            }
        );
        // A row where each face overlaps only the next: pairs, no triple.
        let row = [(0, 0.0, 1.0), (1, 0.5, 1.5), (2, 1.0, 2.0), (3, 1.5, 2.5)];
        assert_eq!(
            depth(&row),
            StackDepth {
                deepest: 2,
                triples: 0
            }
        );
        // Past one 64-bit word of positions, with ids out of order: a stack
        // of 130, and a face over half of it.
        let mut deep: Vec<(u32, f64, f64)> = stack(0, 130, 0.0).into_iter().rev().collect();
        deep.push((500, 0.5, 1.5));
        assert_eq!(
            depth(&deep),
            StackDepth {
                deepest: 131,
                triples: choose3(131)
            }
        );
    }

    #[test]
    fn a_bounded_build_takes_a_stack_up_to_its_limit_and_no_more() {
        let view = strips(&stack(0, 70, 0.0));
        let at = choose3(70);
        let built = ConstraintProblem::build_within(&view, at);
        assert_eq!(built.as_ref().ok(), Some(&ConstraintProblem::build(&view)));
        let over = LayerOrderError::StackedTooDeep {
            deepest: 70,
            triples: at,
            limit: at - 1,
        };
        assert_eq!(
            ConstraintProblem::build_within(&view, at - 1).err(),
            Some(over.clone())
        );

        // A rebuild weighs the state it lands, as a build would: one face
        // more on the stack goes over a limit the stack was at.
        let previous = ConstraintProblem::build(&strips(&stack(0, 69, 0.0)));
        let touched = BTreeSet::from([f(69)]);
        let at69 = choose3(69);
        let rebuilt = previous.rebuild_within(&view, &touched, at);
        assert_eq!(
            rebuilt.as_ref().ok(),
            Some(&ConstraintProblem::build(&view))
        );
        assert_eq!(
            previous.rebuild_within(&view, &touched, at69).err(),
            Some(LayerOrderError::StackedTooDeep {
                deepest: 70,
                triples: at,
                limit: at69,
            })
        );
        assert_eq!(MAX_STACKED_TRIPLES, 12_000_000);
    }

    /// Every one of the 64 assignments of a taco-taco's six pairs, valid iff
    /// it is in Flat-Folder's table (`third_party/flat-folder/src/constraints.js`,
    /// `CON.valid[0]`; '1' means the pair's first face is above its second).
    #[test]
    fn taco_taco_matches_flat_folders_table() {
        let table = [
            "111112", "111121", "111222", "112111", "121112", "121222", "122111", "122212",
            "211121", "211222", "212111", "212221", "221222", "222111", "222212", "222221",
        ];
        let constraint = Constraint::TacoTaco([f(0), f(1), f(2), f(3)]);
        let mut valid = 0;
        for bits in 0..64u32 {
            let mut order = LayerOrder::new();
            let mut key = String::new();
            for (k, [x, y]) in constraint.ordered_pairs().into_iter().enumerate() {
                let first_above = bits >> k & 1 == 1;
                key.push(if first_above { '1' } else { '2' });
                let (upper, lower) = if first_above { (x, y) } else { (y, x) };
                assert!(order.set_above(upper, lower).is_ok());
            }
            let holds = constraint.holds(&order) == Some(true);
            assert_eq!(holds, table.contains(&key.as_str()), "{key}");
            valid += usize::from(holds);
        }
        assert_eq!(valid, 16);
    }

    #[test]
    fn taco_tortilla_and_tortilla_tortilla_hold() {
        let mut order = LayerOrder::new();
        for (upper, lower) in [(2, 0), (2, 1), (0, 1)] {
            assert!(order.set_above(f(upper), f(lower)).is_ok());
        }
        // 2 above both 0 and 1: not between them.
        assert_eq!(
            Constraint::TacoTortilla([f(0), f(1), f(2)]).holds(&order),
            Some(true)
        );
        // 0 is between 2 and 1.
        assert_eq!(
            Constraint::TacoTortilla([f(2), f(1), f(0)]).holds(&order),
            Some(false)
        );
        // 1 is below both 0 and 2; 0 is between 1 and 2.
        assert_eq!(
            Constraint::TortillaTortilla([f(0), f(2), f(1), f(1)]).holds(&order),
            Some(true)
        );
        assert_eq!(
            Constraint::TortillaTortilla([f(1), f(2), f(0), f(0)]).holds(&order),
            Some(false)
        );
        assert_eq!(
            Constraint::TacoTortilla([f(0), f(1), f(7)]).holds(&order),
            None
        );
    }

    #[test]
    fn canonical_forms_identify_equivalent_tuples() {
        let tt = |a, b, c, d| Constraint::TacoTaco([f(a), f(b), f(c), f(d)]).canonical();
        assert_eq!(tt(3, 2, 1, 0), tt(0, 1, 2, 3));
        assert_eq!(
            tt(3, 2, 1, 0),
            Constraint::TacoTaco([f(0), f(1), f(2), f(3)])
        );
        assert_ne!(tt(0, 2, 1, 3), tt(0, 1, 2, 3));
        let tr = |a, b, c, d| Constraint::TortillaTortilla([f(a), f(b), f(c), f(d)]).canonical();
        assert_eq!(tr(1, 0, 3, 2), tr(0, 1, 2, 3));
        assert_eq!(tr(2, 3, 0, 1), tr(0, 1, 2, 3));
        assert_ne!(tr(0, 1, 3, 2), tr(0, 1, 2, 3));
        let tk = |a, b, c| Constraint::TacoTortilla([f(a), f(b), f(c)]).canonical();
        assert_eq!(tk(1, 0, 2), tk(0, 1, 2));
        assert_ne!(tk(0, 2, 1), tk(0, 1, 2));
    }

    /// A taco-tortilla from a fold along a precrease's line names the
    /// precrease's face on the taco's side, not the one across it; dropping
    /// that one must drop the constraint (a rebuild that kept every
    /// constraint of untouched faces once kept it).
    #[test]
    fn a_rebuild_drops_a_taco_tortilla_whose_flat_crease_went() {
        use crate::view::{Edge, Face};
        let square = |x: f64| vec![[x, 0.0], [x + 1.0, 0.0], [x + 1.0, 1.0], [x, 1.0]];
        let face = |id, x| Face {
            id: f(id),
            polygon: square(x),
            front_up: id != 1,
        };
        let line = [[1.0, 0.0], [1.0, 1.0]];
        let fold = Edge {
            faces: [f(0), f(1)],
            segment: line,
            kind: EdgeKind::Folded(None),
        };
        let precrease = Edge {
            faces: [f(2), f(3)],
            segment: line,
            kind: EdgeKind::Flat,
        };
        let before = FoldedView::new(
            vec![face(0, 0.0), face(1, 0.0), face(2, 0.0), face(3, 1.0)],
            vec![fold.clone(), precrease],
        )
        .unwrap_or_else(|e| panic!("{e}"));
        let problem = ConstraintProblem::build(&before);
        let made = Constraint::TacoTortilla([f(0), f(1), f(2)]);
        assert_eq!(problem.constraints(), &[made]);
        assert_eq!(problem.hidden, vec![(made, f(3))]);

        let after = FoldedView::new(vec![face(0, 0.0), face(1, 0.0), face(2, 0.0)], vec![fold])
            .unwrap_or_else(|e| panic!("{e}"));
        let rebuilt = problem.rebuild(&after, &BTreeSet::new());
        assert!(rebuilt.constraints().is_empty());
        assert_eq!(rebuilt, ConstraintProblem::build(&after));
    }

    /// Unfolding one of two folded creases along a line makes a
    /// taco-tortilla over the other crease's faces and the unfolded crease's
    /// face on their side, none of which the unfold touched: the scope must
    /// reach it through the face across the flat crease.
    #[test]
    fn the_scope_of_an_unfold_reaches_the_taco_tortilla_it_makes() {
        use crate::check::{Scope, Violation, check_problem};
        use crate::view::{Edge, Face};
        let square = |x: f64| vec![[x, 0.0], [x + 1.0, 0.0], [x + 1.0, 1.0], [x, 1.0]];
        let face = |id, x, front_up| Face {
            id: f(id),
            polygon: square(x),
            front_up,
        };
        let line = [[1.0, 0.0], [1.0, 1.0]];
        let edge = |a, b, kind| Edge {
            faces: [f(a), f(b)],
            segment: line,
            kind,
        };
        let folded = EdgeKind::Folded(None);
        let before = FoldedView::new(
            vec![
                face(0, 0.0, true),
                face(1, 0.0, false),
                face(2, 0.0, true),
                face(3, 0.0, false),
            ],
            vec![edge(0, 1, folded), edge(2, 3, folded)],
        )
        .unwrap_or_else(|e| panic!("{e}"));
        let problem = ConstraintProblem::build(&before);
        assert_eq!(
            problem.constraints(),
            &[Constraint::TacoTaco([f(0), f(1), f(2), f(3)])]
        );

        // 3 unfolds across the line; 0, 1 and 2 stay where they were.
        let after = FoldedView::new(
            vec![
                face(0, 0.0, true),
                face(1, 0.0, false),
                face(2, 0.0, true),
                face(3, 1.0, true),
            ],
            vec![edge(0, 1, folded), edge(2, 3, EdgeKind::Flat)],
        )
        .unwrap_or_else(|e| panic!("{e}"));
        let touched = BTreeSet::from([f(3)]);
        let rebuilt = problem.rebuild(&after, &touched);
        assert_eq!(rebuilt, ConstraintProblem::build(&after));
        let made = Constraint::TacoTortilla([f(0), f(1), f(2)]);
        assert_eq!(rebuilt.constraints(), &[made]);
        assert_eq!(rebuilt.scope_for(&touched), BTreeSet::from([f(2), f(3)]));

        // 2 between the taco's faces: the touched faces alone miss it.
        let mut order = LayerOrder::new();
        for (upper, lower) in [(0, 2), (2, 1), (0, 1)] {
            assert!(order.set_above(f(upper), f(lower)).is_ok());
        }
        let scoped = |scope: &BTreeSet<FaceId>| {
            check_problem(&rebuilt, &after, &order, Scope::Faces(scope))
                .unwrap_or_else(|e| panic!("{e}"))
                .violations
        };
        assert!(scoped(&touched).is_empty());
        assert_eq!(
            scoped(&rebuilt.scope_for(&touched)),
            [Violation::TacoTortilla {
                faces: [f(0), f(1), f(2)]
            }]
        );
    }
}
