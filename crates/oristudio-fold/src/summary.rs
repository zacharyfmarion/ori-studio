//! Per-step summaries (plan D14): what the Step pane and the crease-pattern
//! pane say about a step.
//!
//! - **Counts**: the crease pattern's M, V and F edges, front-relative like
//!   every stored letter, so on a sheet started back-up they still count the
//!   front's letters. They count edges: a crease a later fold split is two.
//! - **The crease-pattern diff** between a parent and a child state, by
//!   geometry rather than by edge id (a split crease's halves get new ids):
//!   each of the child's creases is matched to the parent's crease through its
//!   midpoint. One with no parent crease was *added* (a precrease's creases
//!   are added flat); one whose folded or remembered letter changed was *reversed*;
//!   folded to flat was *unfolded*; flat to folded was *refolded*, with the
//!   letter it remembered. Lists hold the child's edge ids, in order. The
//!   crease marks a partial precrease made are counted apart
//!   (`marks_added`): they are no edges.
//! - **Layers**: the cross-section's display-layer depth along the fold line
//!   in the parent ([`crate::fold::CrossSection::layers`]), along a partial
//!   precrease's extent only; none for a step that folds nothing (a
//!   turn-over, a rotation).

use serde::Serialize;

use crate::fold::{CrossSection, Folded, Refold};
use crate::numerics::TOL;
use crate::pattern::{CreaseKind, EdgeId, Letter};
use crate::refusal::Refused;
use crate::state::State;

type Point = [f64; 2];

/// A crease pattern's folded and unfolded edges, front-relative.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub struct CreaseCounts {
    pub mountain: usize,
    pub valley: usize,
    pub flat: usize,
}

/// How a child's crease pattern differs from its parent's.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct CreaseDiff {
    pub added: Vec<EdgeId>,
    pub reversed: Vec<EdgeId>,
    pub unfolded: Vec<EdgeId>,
    pub refolded: Vec<Refold>,
    /// The crease marks the step made (a partial precrease's: "adds 2 pinch
    /// marks"), counted apart from the edges; left out of the wire when 0.
    #[serde(skip_serializing_if = "is_zero")]
    pub marks_added: usize,
}

fn is_zero(n: &usize) -> bool {
    *n == 0
}

impl CreaseDiff {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty()
            && self.reversed.is_empty()
            && self.unfolded.is_empty()
            && self.refolded.is_empty()
            && self.marks_added == 0
    }
}

/// One step's summary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StepSummary {
    /// The child's counts.
    pub counts: CreaseCounts,
    pub diff: CreaseDiff,
    /// The display layers the fold went through; none for a view change.
    pub layers: Option<usize>,
}

impl StepSummary {
    /// The summary of the step from `parent` to `child`, given its layers.
    pub fn new(parent: &State, child: &State, layers: Option<usize>) -> StepSummary {
        StepSummary {
            counts: child.crease_counts(),
            diff: parent.crease_diff(child),
            layers,
        }
    }
}

impl State {
    pub fn crease_counts(&self) -> CreaseCounts {
        let mut counts = CreaseCounts::default();
        for crease in self.creases() {
            match crease.kind {
                CreaseKind::Folded(Letter::Mountain) => counts.mountain += 1,
                CreaseKind::Folded(Letter::Valley) => counts.valley += 1,
                CreaseKind::Flat(_) => counts.flat += 1,
                CreaseKind::Border => {}
            }
        }
        counts
    }

    /// How `child`'s crease pattern differs from this one's (see the module
    /// docs).
    pub fn crease_diff(&self, child: &State) -> CreaseDiff {
        let mut diff = CreaseDiff::default();
        for crease in child.creases() {
            if crease.kind == CreaseKind::Border {
                continue;
            }
            let [a, b] = crease
                .vertices
                .map(|v| child.vertices().get(v.0 as usize).copied());
            let (Some(a), Some(b)) = (a, b) else {
                continue;
            };
            let middle = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
            let Some(before) = self.crease_at(middle) else {
                diff.added.push(crease.id);
                continue;
            };
            match (before.kind, crease.kind) {
                (CreaseKind::Folded(was), CreaseKind::Folded(now))
                | (CreaseKind::Flat(was), CreaseKind::Flat(now))
                    if was != now =>
                {
                    diff.reversed.push(crease.id);
                }
                (CreaseKind::Folded(_), CreaseKind::Flat(_)) => diff.unfolded.push(crease.id),
                (CreaseKind::Flat(remembered), CreaseKind::Folded(letter)) => {
                    diff.refolded.push(Refold {
                        edge: crease.id,
                        remembered,
                        letter,
                    });
                }
                _ => {}
            }
        }
        diff.marks_added = child
            .crease_marks()
            .iter()
            .filter(|m| m.made_at > self.step())
            .count();
        diff
    }
}

impl Folded {
    /// This fold's summary: `parent` is the state it folded, whose
    /// cross-section along the line folded along gives the layers — along a
    /// partial precrease's extent only.
    pub fn summary(&self, parent: &State) -> Result<StepSummary, Refused> {
        let analysis = &self.report.analysis;
        let section = parent.cross_section(&analysis.line, analysis.side)?;
        let layers = match self.extent {
            Some(extent) => layers_within(parent, &section, extent),
            None => section.layers,
        };
        Ok(StepSummary::new(parent, &self.state, Some(layers)))
    }
}

/// The most rows one interval of `section` stacks within `extent` (model
/// points on its line): a partial precrease's "Layers".
fn layers_within(parent: &State, section: &CrossSection, extent: [Point; 2]) -> usize {
    let to_scene = parent.view().transform();
    let from: Point = section.from.into();
    let to: Point = section.to.into();
    let length = (to[0] - from[0]).hypot(to[1] - from[1]);
    if length == 0.0 {
        return section.layers;
    }
    let along = |p: Point| {
        let p = to_scene.apply(p);
        ((p[0] - from[0]) * (to[0] - from[0]) + (p[1] - from[1]) * (to[1] - from[1])) / length
    };
    let (a, b) = (along(extent[0]), along(extent[1]));
    let (lo, hi) = (a.min(b), a.max(b));
    section
        .intervals
        .iter()
        .filter(|i| i.end > lo + TOL && i.start < hi - TOL)
        .map(|i| i.rows.len())
        .max()
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fold::PlainFold;
    use crate::refusal::Side;
    use crate::sheet::Sheet;
    use crate::view::{Direction, StartSide};
    use oristudio_geometry::Line;

    fn flat() -> State {
        State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"))
    }

    fn x_eq(c: f64) -> Line {
        Line::new([1.0, 0.0], c).unwrap_or_else(|| unreachable!())
    }

    fn y_eq(c: f64) -> Line {
        Line::new([0.0, 1.0], c).unwrap_or_else(|| unreachable!())
    }

    /// Every layer on the positive side of `line`.
    fn fold(state: &State, line: Line, direction: Direction) -> Folded {
        state
            .fold(&PlainFold::new(line, Side::Positive, direction))
            .unwrap_or_else(|e| panic!("{e}"))
    }

    #[test]
    fn a_book_fold_adds_one_valley_through_one_layer() {
        let parent = flat();
        let folded = fold(&parent, x_eq(0.5), Direction::Valley);
        let summary = folded.summary(&parent).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(
            summary.counts,
            CreaseCounts {
                mountain: 0,
                valley: 1,
                flat: 0
            }
        );
        assert_eq!(summary.diff.added, folded.report.created);
        assert!(summary.diff.unfolded.is_empty() && summary.diff.reversed.is_empty());
        assert_eq!(summary.layers, Some(1));
    }

    #[test]
    fn folding_through_two_layers_counts_both_and_the_split_halves() {
        let book = fold(&flat(), x_eq(0.5), Direction::Valley).state;
        let folded = fold(&book, y_eq(0.5), Direction::Valley);
        let summary = folded.summary(&book).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(summary.layers, Some(2));
        // Two new chords alternating with the layers' flip, and the book
        // fold's valley split in two.
        assert_eq!(
            summary.counts,
            CreaseCounts {
                mountain: 1,
                valley: 3,
                flat: 0
            }
        );
        assert_eq!(summary.diff.added.len(), 2);
        assert!(summary.diff.refolded.is_empty());
    }

    #[test]
    fn a_precrease_adds_flat_creases_and_a_refold_reports_them() {
        let parent = flat();
        let pre = parent
            .precrease(&PlainFold::new(
                x_eq(0.5),
                Side::Positive,
                Direction::Valley,
            ))
            .unwrap_or_else(|e| panic!("{e}"));
        let summary = pre.summary(&parent).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(summary.counts.flat, 1);
        assert_eq!(summary.diff.added.len(), 1);
        assert_eq!(summary.layers, Some(1));

        let refold = fold(&pre.state, x_eq(0.5), Direction::Mountain);
        let summary = refold.summary(&pre.state).unwrap_or_else(|e| panic!("{e}"));
        assert!(summary.diff.added.is_empty());
        assert_eq!(summary.diff.refolded.len(), 1);
        let r = summary.diff.refolded[0];
        assert_eq!((r.remembered, r.letter), (Letter::Valley, Letter::Mountain));
        assert_eq!(summary.counts.mountain, 1);

        // And unfolding it again: the right half, underneath now, turns back
        // away from the viewer.
        let line = refold
            .state
            .crease_line(r.edge)
            .unwrap_or_else(|| unreachable!());
        let unfold = refold
            .state
            .fold(
                &PlainFold::new(line, Side::Negative, Direction::Mountain).with_seed(
                    crate::fold::Seed::Flaps {
                        at: vec![[0.75, 0.5]],
                    },
                ),
            )
            .unwrap_or_else(|e| panic!("{e}"));
        let diff = refold.state.crease_diff(&unfold.state);
        assert_eq!(diff.unfolded, vec![r.edge]);
    }

    #[test]
    fn a_view_change_changes_no_crease() {
        let book = fold(&flat(), x_eq(0.5), Direction::Valley).state;
        let summary = StepSummary::new(&book, &book.turn_over(), None);
        assert!(summary.diff.is_empty());
        assert_eq!(summary.counts, book.crease_counts());
        assert_eq!(summary.layers, None);
    }
}
