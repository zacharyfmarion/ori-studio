//! The checker: everything a layer order must satisfy on a view (research
//! §3.3), each failure naming its faces.
//!
//! - every overlapping pair ordered, and no other pair;
//! - no cycle among faces that share a cell (transitivity);
//! - every taco-taco, taco-tortilla and tortilla-tortilla constraint;
//! - every lettered folded edge's letter derived from the order: valley iff
//!   its front-up face lies below (Flat-Folder `solver.js:181-192`);
//! - hinges between faces of the right orientations (opposite across a fold,
//!   equal across a flat crease);
//! - no pair the tolerance cannot decide.
//!
//! A constraint over an absent or undetermined pair is not judged; the pair
//! itself is reported.

use std::collections::BTreeSet;

use serde::Serialize;

use crate::error::LayerOrderError;
use crate::order::{FacePair, LayerOrder};
use crate::problem::{Ambiguity, Constraint, ConstraintProblem};
use crate::table::PairTable;
use crate::view::{EdgeKind, FaceId, FoldedView, Letter};

/// One way an order fails on a view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum Violation {
    /// The faces overlap but the order does not have the pair.
    MissingPair { pair: FacePair },
    /// The faces overlap and the order has the pair, undetermined.
    UndeterminedPair { pair: FacePair },
    /// The order has a pair whose faces do not overlap.
    ExtraPair { pair: FacePair },
    /// `faces[0]` above `faces[1]` above `faces[2]` above `faces[0]`, where
    /// all three cover cell `cell`.
    CellCycle { faces: [FaceId; 3], cell: usize },
    /// See [`Constraint::TacoTaco`].
    TacoTaco { faces: [FaceId; 4] },
    /// See [`Constraint::TacoTortilla`].
    TacoTortilla { faces: [FaceId; 3] },
    /// See [`Constraint::TortillaTortilla`].
    TortillaTortilla { faces: [FaceId; 4] },
    /// A folded edge's letter disagrees with the order.
    LetterMismatch {
        edge: usize,
        faces: [FaceId; 2],
        letter: Letter,
        derived: Letter,
    },
    /// A folded edge between faces of one orientation, or a flat edge between
    /// faces of opposite orientations.
    HingeOrientation { edge: usize, faces: [FaceId; 2] },
    /// See [`Ambiguity`].
    AmbiguousOverlap { ambiguity: Ambiguity },
}

impl Violation {
    /// The faces the violation names.
    pub fn faces(&self) -> Vec<FaceId> {
        match self {
            Violation::MissingPair { pair }
            | Violation::UndeterminedPair { pair }
            | Violation::ExtraPair { pair } => pair.faces().to_vec(),
            Violation::CellCycle { faces, .. } | Violation::TacoTortilla { faces } => {
                faces.to_vec()
            }
            Violation::TacoTaco { faces } | Violation::TortillaTortilla { faces } => faces.to_vec(),
            Violation::LetterMismatch { faces, .. } | Violation::HingeOrientation { faces, .. } => {
                faces.to_vec()
            }
            Violation::AmbiguousOverlap { ambiguity } => ambiguity.pair.faces().to_vec(),
        }
    }

    fn from_constraint(constraint: Constraint) -> Violation {
        match constraint {
            Constraint::TacoTaco(faces) => Violation::TacoTaco { faces },
            Constraint::TacoTortilla(faces) => Violation::TacoTortilla { faces },
            Constraint::TortillaTortilla(faces) => Violation::TortillaTortilla { faces },
        }
    }
}

/// Everything wrong with an order, ascending; empty when it is valid.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct CheckReport {
    pub violations: Vec<Violation>,
}

impl CheckReport {
    pub fn is_valid(&self) -> bool {
        self.violations.is_empty()
    }

    /// Every face some violation names.
    pub fn faces(&self) -> BTreeSet<FaceId> {
        self.violations.iter().flat_map(Violation::faces).collect()
    }
}

/// Which part of a state to check.
#[derive(Debug, Clone, Copy)]
pub enum Scope<'a> {
    /// Everything.
    All,
    /// What names at least one of these faces: after an operation,
    /// [`ConstraintProblem::scope_for`] the faces it touched, which adds the
    /// faces of constraints that can be new without naming a touched face.
    Faces(&'a BTreeSet<FaceId>),
}

/// Check an order against a view, building the view's problem.
pub fn check(view: &FoldedView, order: &LayerOrder) -> CheckReport {
    let problem = ConstraintProblem::build(view);
    report(&problem, view, order, Scope::All)
}

/// Check an order against a view whose problem is already built; refused
/// when the problem was built from a view with other faces.
pub fn check_problem(
    problem: &ConstraintProblem,
    view: &FoldedView,
    order: &LayerOrder,
    scope: Scope<'_>,
) -> Result<CheckReport, LayerOrderError> {
    if !problem.is_for(view) {
        return Err(LayerOrderError::ProblemMismatch);
    }
    Ok(report(problem, view, order, scope))
}

/// A scope resolved against a view: membership by position for the view's
/// faces, which every loop below asks about many times over.
struct InScope<'a> {
    scope: Scope<'a>,
    view: &'a FoldedView,
    at: Vec<bool>,
}

impl<'a> InScope<'a> {
    fn new(scope: Scope<'a>, view: &'a FoldedView) -> InScope<'a> {
        let at = match scope {
            Scope::All => Vec::new(),
            Scope::Faces(set) => view.faces().iter().map(|f| set.contains(&f.id)).collect(),
        };
        InScope { scope, view, at }
    }

    /// Whether any of the view positions is in scope.
    fn includes_at(&self, positions: &[usize]) -> bool {
        matches!(self.scope, Scope::All) || positions.iter().any(|&p| self.at[p])
    }

    /// Whether any of the faces is in scope.
    fn includes(&self, faces: &[FaceId]) -> bool {
        match self.scope {
            Scope::All => true,
            Scope::Faces(set) => faces.iter().any(|&f| match self.view.index_of(f) {
                Some(p) => self.at[p],
                None => set.contains(&f),
            }),
        }
    }
}

fn report(
    problem: &ConstraintProblem,
    view: &FoldedView,
    order: &LayerOrder,
    scope: Scope<'_>,
) -> CheckReport {
    let mut violations = BTreeSet::new();
    let scope = InScope::new(scope, view);

    // Variables against the order's pairs, both ascending, in one merge.
    let mut variables = problem.variables().iter().copied().peekable();
    for (pair, lo_above) in order.pairs() {
        while let Some(v) = variables.next_if(|&v| v < pair) {
            if scope.includes(&v.faces()) {
                violations.insert(Violation::MissingPair { pair: v });
            }
        }
        let is_variable = variables.next_if_eq(&pair).is_some();
        if !scope.includes(&pair.faces()) {
            continue;
        }
        if !is_variable {
            violations.insert(Violation::ExtraPair { pair });
        } else if lo_above.is_none() {
            violations.insert(Violation::UndeterminedPair { pair });
        }
    }
    for v in variables {
        if scope.includes(&v.faces()) {
            violations.insert(Violation::MissingPair { pair: v });
        }
    }

    // The order as a table on view positions, for the cells and the
    // constraints; a face outside the view falls back to the order itself.
    let table = PairTable::of_order(view, order);
    cell_cycles(problem, &table, &scope, &mut violations);

    let above = |f: FaceId, g: FaceId| match (view.index_of(f), view.index_of(g)) {
        (Some(i), Some(j)) => match table.get(i, j) {
            1 => Some(true),
            -1 => Some(false),
            _ => None,
        },
        _ => order.above(f, g),
    };
    for constraint in problem.constraints() {
        if scope.includes(constraint.faces()) && constraint.holds_by(above) == Some(false) {
            violations.insert(Violation::from_constraint(*constraint));
        }
    }

    for (e, edge) in view.edges().iter().enumerate() {
        if !scope.includes(&edge.faces) {
            continue;
        }
        let [f, g] = edge.faces;
        let (Some(f_up), Some(g_up)) = (view.front_up(f), view.front_up(g)) else {
            continue;
        };
        let folded = matches!(edge.kind, EdgeKind::Folded(_));
        if folded == (f_up == g_up) {
            violations.insert(Violation::HingeOrientation {
                edge: e,
                faces: edge.faces,
            });
            continue;
        }
        if let EdgeKind::Folded(Some(letter)) = edge.kind
            && let Some(derived) = derived_letter(view, order, e)
            && derived != letter
        {
            violations.insert(Violation::LetterMismatch {
                edge: e,
                faces: edge.faces,
                letter,
                derived,
            });
        }
    }

    for &ambiguity in problem.ambiguities() {
        if scope.includes(&ambiguity.pair.faces()) {
            violations.insert(Violation::AmbiguousOverlap { ambiguity });
        }
    }

    CheckReport {
        violations: violations.into_iter().collect(),
    }
}

/// The letter the order gives folded edge `e`: valley iff its front-up face
/// lies below the other. `None` for a flat edge, an edge between faces of one
/// orientation, or an unordered pair.
pub fn derived_letter(view: &FoldedView, order: &LayerOrder, e: usize) -> Option<Letter> {
    let edge = view.edges().get(e)?;
    if edge.kind == EdgeKind::Flat {
        return None;
    }
    let [f, g] = edge.faces;
    let (f_up, g_up) = (view.front_up(f)?, view.front_up(g)?);
    if f_up == g_up {
        return None;
    }
    let (up, other) = if f_up { (f, g) } else { (g, f) };
    Some(if order.above(other, up)? {
        Letter::Valley
    } else {
        Letter::Mountain
    })
}

/// Cyclic triples among the faces of each cell, over the cells whose face
/// sets no other contains (every triple of a cell is one of theirs).
fn cell_cycles(
    problem: &ConstraintProblem,
    table: &PairTable<i8>,
    scope: &InScope<'_>,
    violations: &mut BTreeSet<Violation>,
) {
    let overlay = problem.overlay();
    let mut reported: BTreeSet<[FaceId; 3]> = BTreeSet::new();
    for &c in overlay.maximal_cells() {
        let faces = overlay.cells()[c].faces.as_slice();
        let at = overlay.positions(c);
        if faces.len() < 3 || !scope.includes_at(at) {
            continue;
        }
        let k = faces.len();
        // A complete order on the cell is acyclic iff the faces' counts of
        // faces below them are all different.
        let mut complete = true;
        let mut below = vec![0usize; k];
        for i in 0..k {
            for j in 0..k {
                match table.get(at[i], at[j]) {
                    1 => below[i] += 1,
                    0 if i != j => complete = false,
                    _ => {}
                }
            }
        }
        if complete {
            below.sort_unstable();
            if below.iter().enumerate().all(|(r, &n)| r == n) {
                continue;
            }
        }
        for i in 0..k {
            for j in i + 1..k {
                for l in j + 1..k {
                    let ij = table.get(at[i], at[j]);
                    if ij == 0 || table.get(at[j], at[l]) != ij || table.get(at[l], at[i]) != ij {
                        continue;
                    }
                    // i > j > l > i, or the reverse.
                    let cycle = if ij == 1 {
                        [faces[i], faces[j], faces[l]]
                    } else {
                        [faces[i], faces[l], faces[j]]
                    };
                    let triple = [faces[i], faces[j], faces[l]];
                    if scope.includes_at(&[at[i], at[j], at[l]]) && reported.insert(triple) {
                        violations.insert(Violation::CellCycle {
                            faces: rotate_least_first(cycle),
                            cell: c,
                        });
                    }
                }
            }
        }
    }
}

/// The same cycle starting from its least face.
fn rotate_least_first(cycle: [FaceId; 3]) -> [FaceId; 3] {
    let [a, b, c] = cycle;
    if a <= b && a <= c {
        [a, b, c]
    } else if b <= a && b <= c {
        [b, c, a]
    } else {
        [c, a, b]
    }
}
