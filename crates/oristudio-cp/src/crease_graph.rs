//! The crease graph: interned endpoints, and the connected components over them.
//!
//! **Ori Studio original.** Two creases are in the same component when they
//! share an endpoint, and a *component* is one of the separate patterns a user
//! has laid out on a single sheet of canvas. That grouping is what
//! [`crate::operations::native::fold_propagation`] scopes a click to.
//!
//! # Borders join, auxiliary lines do not
//!
//! A border ([`LineColor::Black0`]) participates. Each pattern on a canvas
//! carries its own closed border, and that border is precisely what makes its
//! creases one group rather than several — dropping borders would shatter a
//! pattern into whatever islands its creases happen to form.
//!
//! An auxiliary line ([`LineColor::Cyan3`]) does **not** participate, and this
//! is forced rather than chosen: every other function that decides what is at a
//! vertex already skips it — [`crate::solve_k::solve_fan_at`],
//! [`crate::checks_spatial::incident_lines_at`], `checks::point_line_map`,
//! `checks_spatial::ThroughLineIndex::build`. An auxiliary line is a
//! construction guide carrying no fold angle; if it joined components, one guide
//! drawn across a canvas would merge every pattern it crosses.
//!
//! # Tolerance
//!
//! [`Epsilon::UNKNOWN_1EN6`], because a component is a claim about the graph
//! **the solver actually sees**, and [`crate::solve_k::solve_fan_at`] decides
//! incidence at that epsilon. `checks::point_line_map` and all of
//! `checks_spatial` cluster a hundred times looser, at
//! [`Epsilon::UNKNOWN_1EN4`]; clustering there would merge vertices the fan
//! treats as distinct, so a click on one pattern could scope in a crease from
//! another whose endpoint is 1e-7 away.
//!
//! # Cost
//!
//! One `O(E)` pass. The endpoint interning is the eps-cell spatial hash
//! `checks::point_line_map` uses — cell size equal to the epsilon, so any two
//! points within it share a cell or an adjacent one, and taking the *lowest*
//! matching index reproduces an insertion-order linear scan's "first match"
//! exactly. That equivalence is what lets this replace propagation's own
//! quadratic endpoint dedupe without moving a single answer.

use std::collections::HashMap;

use crate::geometry::{Epsilon, LineColor, Point, determine_line_segment_distance};
use crate::model::CreasePatternModel;

/// Endpoints interned to distinct vertices, and the components they form.
pub(crate) struct EndpointGraph {
    /// Distinct vertices, in the order their first endpoint was seen — the same
    /// order propagation's old linear dedupe produced.
    points: Vec<Point>,
    /// Cell -> the indices of the points that *created* that cell, for lookups.
    cells: HashMap<(i64, i64), Vec<usize>>,
    /// Per document line index: its two interned endpoints, or `None` for a
    /// segment that is not part of the crease graph (an auxiliary line).
    ends: Vec<Option<[usize; 2]>>,
    /// Per interned point: its component id, dense from zero.
    component_of_point: Vec<usize>,
}

impl EndpointGraph {
    /// The clustering tolerance. See the module docs on why it is this one.
    const EPS: f64 = Epsilon::UNKNOWN_1EN6;

    pub(crate) fn build(model: &CreasePatternModel) -> Self {
        let eps_squared = Self::EPS * Self::EPS;
        let mut points: Vec<Point> = Vec::new();
        let mut cells: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        let mut parent: Vec<usize> = Vec::new();
        let mut ends: Vec<Option<[usize; 2]>> = Vec::with_capacity(model.line_segments.len());

        for segment in &model.line_segments {
            if segment.color == LineColor::Cyan3 {
                ends.push(None);
                continue;
            }
            let a = intern(
                &mut points,
                &mut cells,
                &mut parent,
                segment.a,
                Self::EPS,
                eps_squared,
            );
            let b = intern(
                &mut points,
                &mut cells,
                &mut parent,
                segment.b,
                Self::EPS,
                eps_squared,
            );
            union(&mut parent, a, b);
            ends.push(Some([a, b]));
        }

        // Compress the union-find roots into dense ids, labelled in the order
        // their first point appeared, so a component id is stable for a given
        // document rather than an artefact of which endpoint won a union.
        let mut label = vec![usize::MAX; points.len()];
        let mut component_of_point = Vec::with_capacity(points.len());
        let mut component_count = 0;
        for index in 0..points.len() {
            let root = find(&mut parent, index);
            if label[root] == usize::MAX {
                label[root] = component_count;
                component_count += 1;
            }
            component_of_point.push(label[root]);
        }

        debug_assert!(component_count <= component_of_point.len());
        Self {
            points,
            cells,
            ends,
            component_of_point,
        }
    }

    /// Every distinct vertex, in first-seen order.
    pub(crate) fn vertices(&self) -> &[Point] {
        &self.points
    }

    /// The interned endpoints of one document line, or `None` when the line is
    /// not part of the crease graph.
    pub(crate) fn ends_of(&self, index: usize) -> Option<[usize; 2]> {
        self.ends.get(index).copied().flatten()
    }

    pub(crate) fn point(&self, vertex: usize) -> Point {
        self.points[vertex]
    }

    pub(crate) fn vertex_count(&self) -> usize {
        self.points.len()
    }

    #[cfg(test)]
    pub(crate) fn component_count(&self) -> usize {
        self.component_of_point
            .iter()
            .copied()
            .max()
            .map_or(0, |highest| highest + 1)
    }

    /// The vertex at `point`, at the solver's tolerance.
    pub(crate) fn vertex_at(&self, point: Point) -> Option<usize> {
        let eps_squared = Self::EPS * Self::EPS;
        let (cx, cy) = point_cell(point, Self::EPS);
        let mut best: Option<usize> = None;
        for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(indices) = self.cells.get(&(cx + dx, cy + dy)) {
                    for &index in indices {
                        if self.points[index].distance_squared(point) < eps_squared {
                            best = Some(best.map_or(index, |have: usize| have.min(index)));
                        }
                    }
                }
            }
        }
        best
    }

    /// Which pattern the user clicked on.
    ///
    /// A vertex first, because the propagation tool snaps its seed to a point
    /// and that is the common case. Otherwise the nearest **crease** within
    /// `radius` — nearest crease rather than nearest vertex because clicking
    /// mid-way along a long crease is a legitimate way to say "this pattern",
    /// and because an unbounded nearest-vertex search would silently pick a
    /// pattern on the far side of the canvas, which is a quieter spelling of the
    /// bug this scoping exists to fix.
    pub(crate) fn component_at(
        &self,
        model: &CreasePatternModel,
        point: Point,
        radius: f64,
    ) -> Option<usize> {
        if let Some(vertex) = self.vertex_at(point) {
            return Some(self.component_of_point[vertex]);
        }
        let mut best: Option<(f64, usize)> = None;
        for (index, segment) in model.line_segments.iter().enumerate() {
            let Some([a, _]) = self.ends_of(index) else {
                continue;
            };
            let distance = determine_line_segment_distance(point, segment);
            if distance > radius {
                continue;
            }
            if best.is_none_or(|(have, _)| distance < have) {
                best = Some((distance, self.component_of_point[a]));
            }
        }
        best.map(|(_, component)| component)
    }

    /// Every document line index in one component.
    pub(crate) fn creases_in(&self, component: usize) -> Vec<usize> {
        self.ends
            .iter()
            .enumerate()
            .filter_map(|(index, ends)| {
                let [a, _] = (*ends)?;
                (self.component_of_point[a] == component).then_some(index)
            })
            .collect()
    }

    /// Every vertex in one component, in first-seen order.
    pub(crate) fn points_in(&self, component: usize) -> Vec<Point> {
        self.points
            .iter()
            .enumerate()
            .filter(|(index, _)| self.component_of_point[*index] == component)
            .map(|(_, point)| *point)
            .collect()
    }
}

fn point_cell(point: Point, eps: f64) -> (i64, i64) {
    (
        (point.x / eps).floor() as i64,
        (point.y / eps).floor() as i64,
    )
}

/// Fold `point` into the vertex set, returning its id.
///
/// Only a point that *creates* a vertex is added to its cell, which is what
/// makes the "lowest matching index" tie-break identical to a linear scan's
/// first match. `checks::point_line_map_process` is the same routine.
fn intern(
    points: &mut Vec<Point>,
    cells: &mut HashMap<(i64, i64), Vec<usize>>,
    parent: &mut Vec<usize>,
    point: Point,
    eps: f64,
    eps_squared: f64,
) -> usize {
    let (cx, cy) = point_cell(point, eps);
    let mut best: Option<usize> = None;
    for dx in -1..=1 {
        for dy in -1..=1 {
            if let Some(indices) = cells.get(&(cx + dx, cy + dy)) {
                for &index in indices {
                    if points[index].distance_squared(point) < eps_squared {
                        best = Some(best.map_or(index, |have: usize| have.min(index)));
                    }
                }
            }
        }
    }
    if let Some(index) = best {
        return index;
    }
    let index = points.len();
    points.push(point);
    parent.push(index);
    cells.entry((cx, cy)).or_default().push(index);
    index
}

fn find(parent: &mut [usize], mut node: usize) -> usize {
    while parent[node] != node {
        parent[node] = parent[parent[node]];
        node = parent[node];
    }
    node
}

fn union(parent: &mut [usize], left: usize, right: usize) {
    let left = find(parent, left);
    let right = find(parent, right);
    if left != right {
        parent[right.max(left)] = right.min(left);
    }
}

#[cfg(test)]
mod tests {
    use super::EndpointGraph;
    use crate::geometry::{Epsilon, LineColor, LineSegment, Point};
    use crate::model::CreasePatternModel;

    fn model_of(segments: Vec<LineSegment>) -> CreasePatternModel {
        CreasePatternModel {
            line_segments: segments,
            ..Default::default()
        }
    }

    fn square(origin: Point, size: f64, color: LineColor) -> Vec<LineSegment> {
        let corners = [
            Point::new(origin.x, origin.y),
            Point::new(origin.x + size, origin.y),
            Point::new(origin.x + size, origin.y + size),
            Point::new(origin.x, origin.y + size),
        ];
        (0..4)
            .map(|index| {
                LineSegment::new(corners[index], corners[(index + 1) % 4]).with_line_color(color)
            })
            .collect()
    }

    /// The grouping the whole feature rests on: two patterns on one canvas are
    /// two components.
    #[test]
    fn two_disjoint_patterns_are_two_components() {
        let mut segments = square(Point::new(0.0, 0.0), 10.0, LineColor::Black0);
        segments.extend(square(Point::new(100.0, 0.0), 10.0, LineColor::Black0));
        let graph = EndpointGraph::build(&model_of(segments));
        assert_eq!(graph.component_count(), 2);
        assert_eq!(graph.creases_in(0).len(), 4);
        assert_eq!(graph.creases_in(1).len(), 4);
    }

    /// A border joins. Each pattern's closed border is exactly what makes its
    /// creases one group, so an "optimisation" that filtered components down to
    /// foldable creases would shatter every pattern into islands.
    #[test]
    fn a_border_joins_a_component() {
        let mut segments = square(Point::new(0.0, 0.0), 10.0, LineColor::Black0);
        // Two crease stubs that touch the border and nothing else.
        segments.push(
            LineSegment::new(Point::new(0.0, 0.0), Point::new(2.0, 1.0))
                .with_line_color(LineColor::Red1),
        );
        segments.push(
            LineSegment::new(Point::new(10.0, 10.0), Point::new(8.0, 9.0))
                .with_line_color(LineColor::Blue2),
        );
        let graph = EndpointGraph::build(&model_of(segments));
        assert_eq!(
            graph.component_count(),
            1,
            "the border is what connects the two stubs"
        );
    }

    /// An auxiliary line is a construction guide, not a crease, so one drawn
    /// across the canvas must not merge the patterns it crosses.
    #[test]
    fn an_auxiliary_line_does_not_join_two_components() {
        let mut segments = square(Point::new(0.0, 0.0), 10.0, LineColor::Black0);
        segments.extend(square(Point::new(100.0, 0.0), 10.0, LineColor::Black0));
        segments.push(
            LineSegment::new(Point::new(0.0, 0.0), Point::new(100.0, 0.0))
                .with_line_color(LineColor::Cyan3),
        );
        let graph = EndpointGraph::build(&model_of(segments));
        assert_eq!(graph.component_count(), 2);
        assert_eq!(
            graph.ends_of(8),
            None,
            "an auxiliary line is not in the crease graph at all"
        );
    }

    /// The tolerance is the solver's, not the checker's hundred-times-looser
    /// one. Two endpoints a nanometre apart are one vertex; two a hundred times
    /// the epsilon apart are two.
    #[test]
    fn two_coincident_vertices_are_one_vertex_at_the_solver_epsilon() {
        let near = Epsilon::UNKNOWN_1EN6 / 100.0;
        let far = Epsilon::UNKNOWN_1EN6 * 100.0;

        let joined = model_of(vec![
            LineSegment::new(Point::new(0.0, 0.0), Point::new(1.0, 0.0)),
            LineSegment::new(Point::new(1.0 + near, 0.0), Point::new(2.0, 0.0)),
        ]);
        assert_eq!(EndpointGraph::build(&joined).component_count(), 1);

        let split = model_of(vec![
            LineSegment::new(Point::new(0.0, 0.0), Point::new(1.0, 0.0)),
            LineSegment::new(Point::new(1.0 + far, 0.0), Point::new(2.0, 0.0)),
        ]);
        assert_eq!(EndpointGraph::build(&split).component_count(), 2);
    }

    /// A click resolves to the pattern under it — by vertex when it snapped to
    /// one, by nearest crease when it did not, and to nothing when it landed in
    /// empty canvas.
    #[test]
    fn a_click_resolves_to_the_pattern_under_it() {
        let mut segments = square(Point::new(0.0, 0.0), 10.0, LineColor::Black0);
        segments.extend(square(Point::new(100.0, 0.0), 10.0, LineColor::Black0));
        let model = model_of(segments);
        let graph = EndpointGraph::build(&model);

        assert_eq!(
            graph.component_at(&model, Point::new(0.0, 0.0), 1.0),
            Some(0)
        );
        assert_eq!(
            graph.component_at(&model, Point::new(105.0, 0.2), 1.0),
            Some(1),
            "a click near a crease of the second pattern belongs to it"
        );
        assert_eq!(
            graph.component_at(&model, Point::new(50.0, 50.0), 1.0),
            None,
            "empty canvas names no pattern"
        );
    }

    /// The dedupe this replaces produced first-seen order, and the fixpoint is
    /// built on those representative points.
    #[test]
    fn vertices_come_back_deduped_in_first_seen_order() {
        let segments = square(Point::new(0.0, 0.0), 10.0, LineColor::Black0);
        let graph = EndpointGraph::build(&model_of(segments));
        assert_eq!(graph.vertex_count(), 4);
        assert_eq!(graph.vertices()[0], Point::new(0.0, 0.0));
        assert_eq!(graph.vertices()[1], Point::new(10.0, 0.0));
    }
}
