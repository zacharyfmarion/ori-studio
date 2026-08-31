use crate::geometry::{
    Epsilon, LineColor, LineSegment, Point, Polygon, angle, equal, find_line_symmetry_point,
};
use crate::model::CreasePatternModel;
use std::collections::{BTreeMap, BTreeSet, HashMap};

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct GraphLine {
    pub begin: usize,
    pub end: usize,
    pub color: LineColor,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FoldGraph {
    pub segments: Vec<LineSegment>,
    pub points: Vec<Point>,
    pub lines: Vec<GraphLine>,
    pub faces: Vec<Vec<usize>>,
    pub include_faces: bool,
    /// Per line, the lowest and highest face index having that line on its
    /// border — Oriedita's `lineInFaceBorder_min` / `_max` arrays, built once by
    /// `PointSet.findLineInFaceBorder()`
    /// (`third_party/oriedita/.../crease_pattern/PointSet.java:454-490`) and
    /// read through `lineInFaceBorder_min_lookup` (`:494`).
    ///
    /// Derived purely from `lines` and `faces`, and only ever written by
    /// [`FoldGraph::calculate_faces`], which is the sole writer of `faces`
    /// (`:251`). Empty whenever `faces` is, so an uncalculated graph answers
    /// `None` for every line exactly as the scan it replaces did.
    line_face_borders: Vec<Option<(usize, usize)>>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FacePositions {
    pub starting_face: usize,
    pub face_position: Vec<usize>,
    pub next_face: Vec<Option<usize>>,
    pub associated_line: Vec<Option<usize>>,
}

/// A fold graph the spanning walk cannot describe.
///
/// **Ori Studio native — no Oriedita counterpart.** Upstream's
/// `WireFrame_Worker.getFacePositions()` has no exit for this at all: its
/// `while (remaining_facesTotal > 0)` loop keeps re-scanning an empty frontier
/// until the thread is interrupted. We already diverged by breaking out of the
/// loop; that traded a hang for a *wrong answer*, because every face the walk
/// never reached keeps `associated_line: None`, and [`FoldGraph::fold_movement`]
/// then returns those faces' points unmoved — an unfolded slab inside an
/// otherwise folded figure, with no error anywhere. See PORTING.md.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FoldGraphError {
    /// The dual graph of faces is not connected: no walk from the starting face
    /// reaches `unreached` of them.
    ///
    /// The Euler gate in [`FoldGraph::calculate_faces`] catches the small cases
    /// (two disjoint squares score `euler == 2` and are rejected outright), but
    /// its tolerance is `0.005 * faces.len()`, so from ~200 faces up a
    /// disconnected line set passes the gate and reaches the walk.
    DisconnectedFaces { reached: usize, unreached: usize },
    /// The user stopped the fold part-way through the walk.
    ///
    /// Distinct from every other arm on purpose: this one is not a statement
    /// about the crease pattern, and `From<FoldingEstimateError> for EngineError`
    /// must not classify it as one. See [`crate::cancel`].
    Cancelled,
}

impl From<crate::cancel::Cancelled> for FoldGraphError {
    fn from(_: crate::cancel::Cancelled) -> Self {
        Self::Cancelled
    }
}

impl std::fmt::Display for FoldGraphError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => write!(f, "the fold was cancelled"),
            Self::DisconnectedFaces { reached, unreached } => write!(
                f,
                "the fold graph is disconnected: the walk reached {reached} faces \
                 and could not reach {unreached}"
            ),
        }
    }
}

impl std::error::Error for FoldGraphError {}

impl FoldGraph {
    pub(crate) fn from_model_for_export(model: &CreasePatternModel) -> Self {
        let segments = if model.line_segments.is_empty() {
            vec![LineSegment::with_color(
                Point::new(0.0, 0.0),
                Point::new(0.0, 0.0),
                LineColor::Black0,
            )]
        } else {
            model.line_segments.clone()
        };
        let mut graph = Self::from_sheet_segments(&segments);
        if !graph.include_faces {
            graph.calculate_faces_per_component();
        }
        graph
    }

    /// Faces for a document holding several disconnected crease patterns.
    ///
    /// **Ori Studio native — a deliberate divergence, in the exporter only.**
    /// Upstream's `FoldExporter.toFoldSave` writes faces only when
    /// `calculateFaces()` returns true, and that ends in the Euler gate
    /// (`PointSet.java:428-441`), whose comment reads any non-1 as rounding
    /// damage. But `F - E + V == 1` counts the bounded faces of *one* connected
    /// arrangement — k components score k — so a document holding two crease
    /// patterns scores 2, and its faces never reach the file.
    ///
    /// Note what upstream does **not** do, because it is easy to overstate this
    /// gate: it does not refuse the document, and Oriedita's canvas holds
    /// disjoint patterns perfectly well. `calculateFaces` returns early on that
    /// path with `faces[]` and `numFaces` intact — it skips only
    /// `findLineInFaceBorder()` — and `WireFrame_Worker.setLineSegmentSet`
    /// (`:213`) calls it while discarding the boolean. The faces exist; the gate
    /// is a trust signal that exactly one caller acts on, and that caller is the
    /// FOLD exporter. What upstream *cannot* do with several patterns is fold
    /// them: `getFacePositions` walks a dual graph it assumes is connected.
    ///
    /// So run the same gate once per component instead of once per document.
    /// Each component is a single connected arrangement, which is what the gate
    /// assumes, and [`Self::calculate_faces`] is called unmodified — this
    /// composes around the port rather than editing it, exactly as
    /// `folding3d::cells` already does. Nothing here runs for a
    /// single-component document, so the folding paths and the FOLD-export
    /// oracle see byte-identical output. See PORTING.md.
    ///
    /// All-or-nothing: one component failing its own gate refuses the whole
    /// document. A partial face set would break the contract every caller
    /// actually relies on — that a present `faces_vertices` means the
    /// arrangement was judged trustworthy, not merely that some of it was.
    fn calculate_faces_per_component(&mut self) {
        let components = self.line_components();
        // One component already had its verdict, and it was no.
        if components.len() < 2 {
            return;
        }

        let mut faces = Vec::<Vec<usize>>::new();
        for component in &components {
            let segments: Vec<LineSegment> = component
                .iter()
                .filter_map(|&line| self.segments.get(line).cloned())
                .collect();
            let part = Self::from_sheet_segments(&segments);
            if !part.include_faces {
                return;
            }
            let to_global = self.local_points_of(component);
            for face in &part.faces {
                faces.push(
                    face.iter()
                        .filter_map(|&point| to_global.get(point).copied())
                        .collect(),
                );
            }
        }

        let mut incidence = vec![Vec::<usize>::new(); self.points.len()];
        for (index, face) in faces.iter().enumerate() {
            for &point in face {
                if let Some(entries) = incidence.get_mut(point) {
                    entries.push(index);
                }
            }
        }

        self.faces = faces;
        self.include_faces = true;
        self.line_face_borders = self.line_face_borders_from_incidence(&incidence);
    }

    /// This graph's point ids for a component's sub-graph, indexed by the id
    /// that sub-graph gave them.
    ///
    /// Derived by replay rather than by looking the coordinates up again.
    /// [`Self::from_segments`] assigns ids in order of first appearance while
    /// walking `segment.a` then `segment.b`, so doing the same walk over the
    /// component's lines — which already carry *this* graph's ids — reproduces
    /// that numbering exactly. Two vertex merges that disagreed would corrupt
    /// the faces silently, and this cannot disagree because it is not a second
    /// merge.
    ///
    /// Restricting to a subsequence also preserves the relative order of any
    /// two points, which is what keeps the merge's lowest-id-wins tie-break
    /// picking the same representative in both graphs.
    fn local_points_of(&self, component: &[usize]) -> Vec<usize> {
        let mut to_global = Vec::new();
        let mut seen = HashMap::new();
        for &line_index in component {
            let Some(line) = self.lines.get(line_index) else {
                continue;
            };
            for global in [line.begin, line.end] {
                seen.entry(global).or_insert_with(|| {
                    to_global.push(global);
                    to_global.len() - 1
                });
            }
        }
        to_global
    }

    /// Line indices grouped into sets that share no endpoint, keyed by the
    /// group's representative so the order is deterministic.
    ///
    /// Endpoints are compared through this graph's own vertex merge, so
    /// "shares an endpoint" means what the arrangement thinks it means.
    pub(crate) fn line_components(&self) -> Vec<Vec<usize>> {
        let mut parent: Vec<usize> = (0..self.points.len()).collect();
        for line in &self.lines {
            let (a, b) = (root(&mut parent, line.begin), root(&mut parent, line.end));
            if a != b {
                parent[a.max(b)] = a.min(b);
            }
        }
        let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for (index, line) in self.lines.iter().enumerate() {
            groups
                .entry(root(&mut parent, line.begin))
                .or_default()
                .push(index);
        }
        groups.into_values().collect()
    }

    /// The arrangement of a **sheet** — segments the user drew, where a bounded
    /// region enclosed by border is a hole in the paper rather than paper.
    ///
    /// Opt-in, and deliberately not the default. Several arrangements in this
    /// crate are *derived* rather than drawn: `folding3d::cells` synthesises one
    /// per plane with every segment coloured `Black0` because colour is
    /// meaningless there, and the flat folder builds one over the folded image's
    /// subfaces. Their bounded regions are cells and subfaces, not paper, and
    /// dropping the enclosed ones silently removes real work — measured, an
    /// unconditional filter turned `spikes_small` from `Folded` into
    /// `NoLayerOrder { OverlapWithoutCell }`.
    ///
    /// So the sheet path names itself. A site that should use this and does not
    /// keeps today's behaviour (a hole folded as paper, which is a loud parity
    /// abort); a derived site that used it by accident would lose cells quietly.
    /// Opting in is the direction whose mistakes are visible.
    pub(crate) fn from_sheet_segments(segments: &[LineSegment]) -> Self {
        let mut graph = Self::from_segments(segments, true);
        if graph.include_faces {
            graph.drop_hole_faces();
        }
        graph
    }

    pub(crate) fn from_segments(segments: &[LineSegment], calculate_faces: bool) -> Self {
        let mut points = VertexIndex::with_capacity(segments.len() * 2);
        let mut lines = Vec::with_capacity(segments.len());
        for segment in segments {
            let begin = points.index_of(segment.a);
            let end = points.index_of(segment.b);
            lines.push(GraphLine {
                begin,
                end,
                color: segment.color,
            });
        }

        let mut graph = Self {
            segments: segments.to_vec(),
            points: points.into_points(),
            lines,
            faces: Vec::new(),
            include_faces: false,
            line_face_borders: Vec::new(),
        };

        if calculate_faces {
            graph.include_faces = graph.calculate_faces();
        }

        graph
    }

    pub(crate) fn edges_vertices(&self) -> Vec<[usize; 2]> {
        self.lines
            .iter()
            .map(|line| [line.begin, line.end])
            .collect()
    }

    pub(crate) fn faces_edges(&self) -> Vec<Vec<usize>> {
        self.faces
            .iter()
            .map(|face| self.face_edges(face))
            .collect()
    }

    /// The lowest and highest face index carrying `line_index` on its border.
    ///
    /// An array read. It used to be a scan over every face, run from inside the
    /// equivalence-condition loops (`folding.rs:4210`, `:4243`, `:4253`), which
    /// made condition generation `O(lines x candidates x faces)` — the dominant
    /// cost of a large fold. Upstream never paid it: `PointSet` precomputes the
    /// same answer once and looks it up (`PointSet.java:454-494`).
    pub(crate) fn line_face_border(&self, line_index: usize) -> Option<(usize, usize)> {
        self.line_face_borders.get(line_index).copied().flatten()
    }

    pub(crate) fn folded_points(&self, positions: &FacePositions) -> Vec<Point> {
        let mut folded = self.points.clone();
        for (point_index, target) in folded.iter_mut().enumerate() {
            let mut x = 0.0;
            let mut y = 0.0;
            let mut total = 0usize;
            for face_index in self.faces_containing_point(point_index) {
                let moved = self.fold_movement(point_index, face_index, positions);
                x += moved.x;
                y += moved.y;
                total += 1;
            }

            if total == 0 {
                *target = Point::new(f64::NAN, f64::NAN);
            } else {
                *target = Point::new(x / total as f64, y / total as f64);
            }
        }
        folded
    }

    /// Oriedita `WireFrame_Worker.getFacePositions()`: the spanning walk over the
    /// dual graph of faces, recording each face's depth, its parent, and the
    /// crease it folds across.
    ///
    /// Fallible where upstream is not — see [`FoldGraphError`].
    pub(crate) fn face_positions(
        &self,
        starting_face: i32,
    ) -> Result<FacePositions, FoldGraphError> {
        let starting_face = self.resolve_starting_face(starting_face);
        let mut face_position = vec![0; self.faces.len()];
        let mut next_face = vec![None; self.faces.len()];
        let mut associated_line = vec![None; self.faces.len()];

        if self.faces.is_empty() {
            return Ok(FacePositions {
                starting_face,
                face_position,
                next_face,
                associated_line,
            });
        }

        face_position[starting_face] = 1;
        let mut remaining_faces = self.faces.len().saturating_sub(1);
        let mut depth = 1usize;
        let mut current_round = BTreeSet::new();
        current_round.insert(starting_face);

        while remaining_faces > 0 {
            let mut next_round = BTreeSet::new();
            for face in &current_round {
                // Site 10. The body below is a scan over every face, so one
                // round is F*k work — poll per face in the round, not per round.
                crate::cancel::check()?;
                for candidate in 0..self.faces.len() {
                    if face_position[candidate] != 0 {
                        continue;
                    }
                    if let Some(line) = self.find_adjacent_line(*face, candidate) {
                        next_round.insert(candidate);
                        face_position[candidate] = depth + 1;
                        next_face[candidate] = Some(*face);
                        associated_line[candidate] = Some(line);
                        remaining_faces -= 1;
                    }
                }
            }

            if next_round.is_empty() {
                // Nothing new is reachable and faces remain. Upstream would spin
                // here forever; breaking out would hand back an unfolded slab.
                return Err(FoldGraphError::DisconnectedFaces {
                    reached: self.faces.len() - remaining_faces,
                    unreached: remaining_faces,
                });
            }

            current_round = next_round;
            depth += 1;
        }

        Ok(FacePositions {
            starting_face,
            face_position,
            next_face,
            associated_line,
        })
    }

    fn calculate_faces(&mut self) -> bool {
        let point_linking = self.point_linking();
        let mut face_point_map = vec![Vec::<usize>::new(); self.points.len()];
        let mut faces = Vec::<Vec<usize>>::new();

        for line in &self.lines {
            let begin = line.begin;
            let end = line.end;

            let forward = self.face_request(begin, end, &point_linking);
            if self.should_add_face(&forward, begin, &faces, &face_point_map) {
                add_face(forward, &mut faces, &mut face_point_map);
            }

            let reverse = self.face_request(end, begin, &point_linking);
            if self.should_add_face(&reverse, begin, &faces, &face_point_map) {
                add_face(reverse, &mut faces, &mut face_point_map);
            }
        }

        let euler = faces.len() as isize - self.lines.len() as isize + self.points.len() as isize;
        let include_faces = euler == 1 || (euler - 1).abs() as f64 <= 0.005 * faces.len() as f64;
        // Divergence, predating this line's current form: upstream keeps the
        // faces here. `PointSet.calculateFaces` returns early with `faces[]` and
        // `numFaces` intact, skipping only `findLineInFaceBorder()`, so a caller
        // that ignores the boolean — `WireFrame_Worker.setLineSegmentSet` does —
        // still gets them. Clearing them makes the gate a refusal rather than the
        // signal it is upstream. Left as-is because every current consumer treats
        // a false verdict as "no faces" anyway, but it is not parity.
        self.faces = if include_faces { faces } else { Vec::new() };
        self.line_face_borders = if include_faces {
            self.line_face_borders_from_incidence(&face_point_map)
        } else {
            Vec::new()
        };
        include_faces
    }

    /// Drop the traced faces that are holes in the sheet rather than paper.
    ///
    /// `calculate_faces` traces every positively-oriented bounded region — the
    /// only filter is `face_area(..) > 0.0`, which discards exactly one region,
    /// the unbounded face. That is faithful to Oriedita
    /// (`PointSet.isNonDegenerated`), whose sheet is always a disk, and it means
    /// a hole comes back **filled**. Its border segments then carry two traced
    /// faces each, so `line_face_border` reports them as joins,
    /// `initial_hierarchy_from_graph` reads them as creases, and the parity seed
    /// aborts on the odd cycle the hole face makes in the dual graph — blaming
    /// whichever crease the walk reached first. See
    /// `research/2026-08-31-holes-in-the-folding-pipeline.md`.
    ///
    /// The rule is Flat-Folder's, which this repo already ports for the other
    /// flat solver (`treemaker-flatfold`'s `normalize_fold`, from
    /// `third_party/flat-folder/src/io.js:277`): **a face whose every edge is a
    /// boundary edge is a hole.**
    ///
    /// # The added clause, and why it is not optional
    ///
    /// Upstream is safe with the bare rule because its input is FOLD, where `B`
    /// means paper boundary by definition and an interior divider would be `F`
    /// or `U`. Here `Black0` is a primary palette colour users draw with, and
    /// FOLD `C` (cut) and `J` (join) both import onto it as well. Under the bare
    /// rule a plain square split in half by one interior `Black0` line has *two*
    /// all-border faces and loses both — upstream's only guard is
    /// `FV.length > 1`, which does not stop that.
    ///
    /// So a ring edge must also **have a face on the other side**. That is
    /// `checks_spatial::interior_border_segments`' own predicate — a border
    /// segment with paper on both sides — lifted from one segment to a whole
    /// ring. A hole is enclosed by construction; each half of a divided square
    /// carries outer-boundary edges, which belong to one traced face because the
    /// unbounded face is never traced.
    ///
    /// Never removes *every* face: an all-`Black0` grid is a genuinely ambiguous
    /// document, and answering it with an empty arrangement is worse than
    /// answering it the way we do today.
    ///
    /// **After the Euler gate, never before.** `F - E + V == 1` counts every
    /// bounded region, and on paper with `h` holes the holes are exactly the `h`
    /// faces that make the arithmetic come out right — a subdivided annulus has
    /// `V - E + F_paper == 0`. Dropping them first would move the target to
    /// `1 - h`, which the 0.005 slack cannot absorb below ~200 faces, and the
    /// gate would refuse every holed sheet.
    fn drop_hole_faces(&mut self) {
        if self.faces.len() < 2 {
            return;
        }

        // A vertex pair is a border iff *every* line drawn on it is `Black0`. A
        // crease drawn over a border is a degenerate document either way, and
        // this is the reading that declines to drop rather than the one that
        // drops on a coincidence.
        let mut border_pair: HashMap<(usize, usize), bool> = HashMap::new();
        for line in &self.lines {
            let key = (line.begin.min(line.end), line.begin.max(line.end));
            let is_border = line.color == LineColor::Black0;
            border_pair
                .entry(key)
                .and_modify(|all| *all &= is_border)
                .or_insert(is_border);
        }

        let mut ring_faces: HashMap<(usize, usize), usize> = HashMap::new();
        for face in &self.faces {
            for index in 0..face.len() {
                let (a, b) = (face[index], face[(index + 1) % face.len()]);
                *ring_faces.entry((a.min(b), a.max(b))).or_default() += 1;
            }
        }

        let is_hole = |face: &Vec<usize>| {
            !face.is_empty()
                && (0..face.len()).all(|index| {
                    let (a, b) = (face[index], face[(index + 1) % face.len()]);
                    let key = (a.min(b), a.max(b));
                    border_pair.get(&key) == Some(&true)
                        && ring_faces.get(&key).copied().unwrap_or(0) >= 2
                })
        };

        let holes = self.faces.iter().filter(|face| is_hole(face)).count();
        if holes == 0 || holes == self.faces.len() {
            return;
        }

        self.faces.retain(|face| !is_hole(face));
        // Face ids shifted, so the line/face index has to be rebuilt from the
        // reduced set rather than patched.
        let mut incidence = vec![Vec::<usize>::new(); self.points.len()];
        for (index, face) in self.faces.iter().enumerate() {
            for &point in face {
                if let Some(entries) = incidence.get_mut(point) {
                    entries.push(index);
                }
            }
        }
        self.line_face_borders = self.line_face_borders_from_incidence(&incidence);
    }

    /// Oriedita `PointSet.findLineInFaceBorder()`: resolve every line's border
    /// faces in one pass, consulting only the faces incident to that line's
    /// `begin` point instead of all of them.
    ///
    /// `incidence[point]` is the face list [`Self::calculate_faces`] already
    /// accumulates while building the faces, so the index this needs costs
    /// nothing extra. Narrowing the scan to `begin` loses no answer: a face
    /// carrying the line on its border contains both of its endpoints, so it is
    /// always in that bucket — the same reasoning that lets upstream walk only
    /// `head[lines[i].getBegin()]` (`PointSet.java:474`).
    fn line_face_borders_from_incidence(
        &self,
        incidence: &[Vec<usize>],
    ) -> Vec<Option<(usize, usize)>> {
        self.lines
            .iter()
            .map(|line| {
                let mut min = usize::MAX;
                let mut max = 0usize;
                let mut found = false;
                for &face_index in incidence.get(line.begin)? {
                    let Some(face) = self.faces.get(face_index) else {
                        continue;
                    };
                    if face_contains_line(face, line.begin, line.end) {
                        min = min.min(face_index);
                        max = max.max(face_index);
                        found = true;
                    }
                }
                found.then_some((min, max))
            })
            .collect()
    }

    fn point_linking(&self) -> Vec<Vec<usize>> {
        let mut point_linking = vec![Vec::<usize>::new(); self.points.len()];
        for line in &self.lines {
            if line.begin < point_linking.len() && line.end < point_linking.len() {
                point_linking[line.begin].push(line.end);
                point_linking[line.end].push(line.begin);
            }
        }
        point_linking
    }

    fn face_request(&self, start: usize, end: usize, point_linking: &[Vec<usize>]) -> Vec<usize> {
        if start >= self.points.len() || end >= self.points.len() {
            return Vec::new();
        }

        let mut face = vec![start, end];
        let mut next = self.r_point(start, end, point_linking);
        let mut added_after_seed = false;

        loop {
            let Some(next_point) = next else {
                if added_after_seed {
                    // Oriedita `Face` stores a sentinel point id 0; after at
                    // least one added vertex, falling off a dangling branch
                    // still returns the partial face because that sentinel is
                    // "contained".
                    align_face(&mut face);
                    return face;
                }
                return Vec::new();
            };
            if face.contains(&next_point) {
                align_face(&mut face);
                return face;
            }

            face.push(next_point);
            added_after_seed = true;
            let count = face.len();
            next = self.r_point(face[count - 2], face[count - 1], point_linking);
        }
    }

    fn r_point(
        &self,
        previous: usize,
        current: usize,
        point_linking: &[Vec<usize>],
    ) -> Option<usize> {
        let linked_points = point_linking.get(current)?;
        if !point_linking
            .get(previous)
            .is_some_and(|linked| linked.contains(&current))
        {
            return None;
        }

        let mut result = None;
        let mut best_angle = 876.0;
        for candidate in linked_points {
            if *candidate == previous {
                continue;
            }
            let candidate_angle = angle((
                self.points[current],
                self.points[previous],
                self.points[current],
                self.points[*candidate],
            ));
            if candidate_angle <= best_angle {
                result = Some(*candidate);
                best_angle = candidate_angle;
            }
        }

        result
    }

    fn should_add_face(
        &self,
        face: &[usize],
        begin: usize,
        faces: &[Vec<usize>],
        face_point_map: &[Vec<usize>],
    ) -> bool {
        if face.is_empty()
            || face_area(face, &self.points) <= 0.0
            || face_point_map
                .get(begin)
                .is_some_and(|existing| existing.iter().any(|index| faces[*index] == face))
        {
            return false;
        }

        true
    }

    fn face_edges(&self, face: &[usize]) -> Vec<usize> {
        if face.is_empty() {
            return Vec::new();
        }

        let mut face_edges = Vec::with_capacity(face.len());
        let first = face[0];
        let last = face[face.len() - 1];
        face_edges.push(self.find_edge(first, last).unwrap_or(usize::MAX));
        for index in 1..face.len() {
            face_edges.push(
                self.find_edge(face[index], face[index - 1])
                    .unwrap_or(usize::MAX),
            );
        }
        face_edges
    }

    fn find_edge(&self, a: usize, b: usize) -> Option<usize> {
        self.lines.iter().position(|line| {
            (line.begin == a && line.end == b) || (line.begin == b && line.end == a)
        })
    }

    fn find_adjacent_line(&self, face: usize, other: usize) -> Option<usize> {
        let face_points = self.faces.get(face)?;
        let other_points = self.faces.get(other)?;
        for index in 0..face_points.len() {
            let a = face_points[index];
            let b = face_points[(index + 1) % face_points.len()];
            for other_index in 0..other_points.len() {
                let other_a = other_points[other_index];
                let other_b = other_points[(other_index + 1) % other_points.len()];
                if ((a == other_a && b == other_b) || (a == other_b && b == other_a))
                    && let Some(line) = self.find_edge(a, b)
                {
                    return Some(line);
                }
            }
        }
        None
    }

    fn resolve_starting_face(&self, starting_face: i32) -> usize {
        if self.faces.is_empty() {
            return 0;
        }

        if starting_face > self.faces.len() as i32 {
            return self.faces.len() - 1;
        }
        if starting_face >= 1 {
            return starting_face as usize - 1;
        }

        self.inside_face(Point::new(0.0, 0.0)).unwrap_or_default()
    }

    fn inside_face(&self, point: Point) -> Option<usize> {
        for (index, face) in self.faces.iter().enumerate() {
            let polygon = Polygon::new(face.iter().map(|point| self.points[*point]).collect());
            match polygon.inside(point) {
                crate::geometry::PolygonIntersection::Inside => return Some(index),
                crate::geometry::PolygonIntersection::Border => return None,
                _ => {}
            }
        }
        None
    }

    fn faces_containing_point(&self, point: usize) -> impl Iterator<Item = usize> + '_ {
        self.faces
            .iter()
            .enumerate()
            .filter_map(move |(index, face)| face.contains(&point).then_some(index))
    }

    /// One face's own image of a point, before [`Self::folded_points`] averages
    /// it away.
    ///
    /// `pub(crate)` so [`crate::folding3d`] can be diffed against it face by
    /// face. That comparison is the only cross-check the 3D placement has
    /// against code someone else wrote — a half-turn about an in-sheet axis
    /// restricted to the sheet plane *is* this reflection — and it has to be
    /// made here rather than against `folded_points`, whose averaging is a
    /// different answer on any document the placement is not path-independent
    /// on.
    pub(crate) fn fold_movement(
        &self,
        point: usize,
        face: usize,
        positions: &FacePositions,
    ) -> Point {
        let mut p = self.points[point];
        let mut destination_face = face;
        while destination_face != positions.starting_face {
            let Some(line_index) = positions.associated_line[destination_face] else {
                break;
            };
            let line = self.lines[line_index];
            p = find_line_symmetry_point(self.points[line.begin], self.points[line.end], p);
            let Some(next_face) = positions.next_face[destination_face] else {
                break;
            };
            destination_face = next_face;
        }
        p
    }
}

fn face_contains_line(face: &[usize], begin: usize, end: usize) -> bool {
    if face.is_empty() {
        return false;
    }

    for index in 0..face.len() {
        let a = face[index];
        let b = face[(index + 1) % face.len()];
        if (a == begin && b == end) || (a == end && b == begin) {
            return true;
        }
    }

    false
}

/// Side of one bucket in [`VertexIndex`], in paper units.
///
/// Four times [`Epsilon::POINT`], so a candidate within the merge radius is
/// never more than one bucket away on either axis and the `-1..=1` sweep below
/// is exhaustive with three decimal orders of slack against the rounding in
/// `coordinate / CELL`.
const VERTEX_BUCKET: f64 = Epsilon::POINT * 4.0;

/// The arrangement's point set, plus a uniform grid over it.
///
/// **An index, not a change of rule.** [`Self::index_of`] returns the same
/// answer as the linear `points.iter().position(|p| equal(*p, point))` it
/// replaces — the *lowest* index within [`Epsilon::POINT`] of `point`, and a
/// fresh index when there is none — because the bucket sweep is a superset of
/// the candidates and the minimum is taken over it. `points_dedup_exactly_as_a_linear_scan_does`
/// asserts that against the scan itself.
///
/// It exists because the scan is quadratic and every arrangement pays it.
/// `CheckCamv` runs on the 120 ms debounced post-edit path and, on a document
/// carrying a non-classic crease, reaches `interior_border_segments`, which
/// builds a full arrangement: measured on the corpus's 9,162-segment
/// `ALL-combined.fold`, that one build was 42 ms of a 53 ms check against 5.5 ms
/// for Oriedita's `check4` alone. The work is wanted; paying `O(n^2)` for it is
/// not.
struct VertexIndex {
    points: Vec<Point>,
    buckets: HashMap<(i64, i64), Vec<usize>>,
}

impl VertexIndex {
    fn with_capacity(capacity: usize) -> Self {
        Self {
            points: Vec::with_capacity(capacity),
            buckets: HashMap::with_capacity(capacity),
        }
    }

    /// Bucket coordinates. A non-finite coordinate saturates, which is harmless:
    /// `equal` is false against a NaN either way, so such a point is pushed as
    /// its own vertex exactly as the linear scan pushed it.
    fn bucket(point: Point) -> (i64, i64) {
        (
            (point.x / VERTEX_BUCKET).floor() as i64,
            (point.y / VERTEX_BUCKET).floor() as i64,
        )
    }

    fn index_of(&mut self, point: Point) -> usize {
        let (bx, by) = Self::bucket(point);
        let mut found: Option<usize> = None;
        for dx in -1..=1 {
            for dy in -1..=1 {
                // Saturating, because a coordinate far enough out (or not finite
                // at all) saturates the cast. Such points then share one bucket
                // and are separated by `equal` as they always were.
                let neighbour = (bx.saturating_add(dx), by.saturating_add(dy));
                let Some(bucket) = self.buckets.get(&neighbour) else {
                    continue;
                };
                for &candidate in bucket {
                    if equal(self.points[candidate], point) {
                        found = Some(found.map_or(candidate, |best| best.min(candidate)));
                    }
                }
            }
        }
        if let Some(index) = found {
            return index;
        }

        let index = self.points.len();
        self.points.push(point);
        self.buckets.entry((bx, by)).or_default().push(index);
        index
    }

    fn into_points(self) -> Vec<Point> {
        self.points
    }
}

/// Rotate the ring so its lowest point id comes first.
///
/// The `remove(0)`/`push` loop this replaces stopped after the smallest `k` with
/// `face[k] == minimum`, which is exactly `position`, and cost `O(n^2)` getting
/// there. Duplicate ids do not separate the two forms: both stop at the first
/// slot holding the minimum.
/// Union-find root with path halving, for [`FoldGraph::line_components`] and
/// the face-level unions in `folding3d::cells`.
pub(crate) fn root(parent: &mut [usize], mut node: usize) -> usize {
    while parent[node] != node {
        parent[node] = parent[parent[node]];
        node = parent[node];
    }
    node
}

fn align_face(face: &mut [usize]) {
    let Some(minimum) = face.iter().copied().min() else {
        return;
    };
    let Some(at) = face.iter().position(|point| *point == minimum) else {
        return;
    };
    face.rotate_left(at);
}

fn add_face(face: Vec<usize>, faces: &mut Vec<Vec<usize>>, face_point_map: &mut [Vec<usize>]) {
    let face_index = faces.len();
    for point in &face {
        if let Some(entries) = face_point_map.get_mut(*point) {
            entries.push(face_index);
        }
    }
    faces.push(face);
}

fn face_area(face: &[usize], points: &[Point]) -> f64 {
    let vertices = face
        .iter()
        .filter_map(|index| points.get(*index).copied())
        .collect::<Vec<_>>();
    Polygon::new(vertices).calculate_area()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::LineColor;

    /// The all-faces scan [`FoldGraph::line_face_border`] replaces, kept as the
    /// reference the cache is checked against.
    fn scanned_line_face_border(graph: &FoldGraph, line_index: usize) -> Option<(usize, usize)> {
        let line = graph.lines.get(line_index)?;
        let mut min = usize::MAX;
        let mut max = 0usize;
        let mut found = false;
        for (face_index, face) in graph.faces.iter().enumerate() {
            if face_contains_line(face, line.begin, line.end) {
                min = min.min(face_index);
                max = max.max(face_index);
                found = true;
            }
        }
        found.then_some((min, max))
    }

    fn assert_line_face_borders_match_scan(segments: &[LineSegment]) {
        let graph = FoldGraph::from_segments(segments, true);
        // Guard the guard: a graph whose faces were rejected answers `None`
        // everywhere, which would make the comparison below vacuous.
        assert!(graph.include_faces, "fixture produced no faces");
        assert!(!graph.faces.is_empty(), "fixture produced no faces");
        for line_index in 0..graph.lines.len() {
            assert_eq!(
                graph.line_face_border(line_index),
                scanned_line_face_border(&graph, line_index),
                "line {line_index} disagrees with the all-faces scan"
            );
        }
    }

    /// An `n` x `n` grid emitted one cell edge at a time.
    ///
    /// Full-length crossing lines would not do: `from_segments` takes its points
    /// from segment *endpoints*, so undivided crossings contribute no vertex and
    /// the graph comes back with no faces at all. Callers in `folding.rs` reach
    /// the graph only after `divide_intersections`; this is the same shape.
    ///
    /// Border on the perimeter and creases inside, because that is what a sheet
    /// is. An all-`Black0` grid — which this used to be — is a document in which
    /// every interior cell is enclosed by border on all four sides, so
    /// [`FoldGraph::without_hole_faces`] reads the interior as holes and the
    /// fixture quietly shrinks from `n²` faces to its perimeter ring. That
    /// ambiguity is real and covered by its own test below; it has no business
    /// thinning the arrangement these tests are about.
    fn grid_segments(n: usize) -> Vec<LineSegment> {
        let step = 400.0 / n as f64;
        let at = |i: usize| i as f64 * step;
        let color = |i: usize| {
            if i == 0 || i == n {
                LineColor::Black0
            } else {
                LineColor::Blue2
            }
        };
        let mut segments = Vec::new();
        for i in 0..=n {
            for j in 0..n {
                segments.push(LineSegment::with_color(
                    Point::new(at(i), at(j)),
                    Point::new(at(i), at(j + 1)),
                    color(i),
                ));
                segments.push(LineSegment::with_color(
                    Point::new(at(j), at(i)),
                    Point::new(at(j + 1), at(i)),
                    color(i),
                ));
            }
        }
        segments
    }

    /// A square sheet with a rectangular hole cut out of it, and one crease from
    /// the hole to the outer boundary so the paper region is simply connected.
    fn holed_sheet() -> Vec<LineSegment> {
        let border = |ax: f64, ay: f64, bx: f64, by: f64| {
            LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), LineColor::Black0)
        };
        let mut segments = vec![
            border(-200.0, -200.0, 50.0, -200.0),
            border(50.0, -200.0, 200.0, -200.0),
            border(200.0, -200.0, 200.0, 200.0),
            border(200.0, 200.0, 50.0, 200.0),
            border(50.0, 200.0, -200.0, 200.0),
            border(-200.0, 200.0, -200.0, -200.0),
            border(50.0, -50.0, 100.0, -50.0),
            border(100.0, -50.0, 100.0, 50.0),
            border(100.0, 50.0, 50.0, 50.0),
            border(50.0, 50.0, 50.0, -50.0),
        ];
        for (ax, ay, bx, by) in [(50.0, -200.0, 50.0, -50.0), (50.0, 50.0, 50.0, 200.0)] {
            segments.push(LineSegment::with_color(
                Point::new(ax, ay),
                Point::new(bx, by),
                LineColor::Blue2,
            ));
        }
        segments
    }

    /// The reported bug: the hole was traced as paper, so its border segments
    /// carried two faces each and read as creases.
    #[test]
    fn a_hole_in_the_sheet_is_not_traced_as_paper() {
        let graph = FoldGraph::from_sheet_segments(&holed_sheet());
        assert!(graph.include_faces, "the arrangement traces");
        assert_eq!(
            graph.faces.len(),
            2,
            "two paper faces either side of the fold line, and no filled hole"
        );

        // The point of dropping it: every border segment now belongs to one
        // traced face, so `initial_hierarchy_from_graph` skips them all.
        for (index, line) in graph.lines.iter().enumerate() {
            if line.color != LineColor::Black0 {
                continue;
            }
            let border = graph.line_face_border(index);
            assert!(
                border.is_none_or(|(first, second)| first == second),
                "border line {index} still looks like a join: {border:?}"
            );
        }
    }

    /// The clause this repo adds to Flat-Folder's rule. Both halves of a divided
    /// square have every edge in `Black0`, and upstream's unclaused filter — its
    /// only guard is `FV.length > 1` — would drop both and leave nothing.
    #[test]
    fn a_square_split_by_an_interior_border_keeps_both_halves() {
        let border = |ax: f64, ay: f64, bx: f64, by: f64| {
            LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), LineColor::Black0)
        };
        let segments = vec![
            border(0.0, 0.0, 100.0, 0.0),
            border(100.0, 0.0, 200.0, 0.0),
            border(200.0, 0.0, 200.0, 200.0),
            border(200.0, 200.0, 100.0, 200.0),
            border(100.0, 200.0, 0.0, 200.0),
            border(0.0, 200.0, 0.0, 0.0),
            border(100.0, 0.0, 100.0, 200.0),
        ];

        let graph = FoldGraph::from_sheet_segments(&segments);
        assert_eq!(
            graph.faces.len(),
            2,
            "neither half is enclosed — each carries outer-boundary edges"
        );
    }

    /// A document drawn entirely in border colour is genuinely ambiguous: every
    /// interior cell is enclosed by border on all four sides, and nothing local
    /// distinguishes "hole" from "separate piece".
    ///
    /// Pinned rather than defended. What the filter must **not** do is answer it
    /// with an empty arrangement, which is what upstream's unclaused rule does
    /// and what would turn a fold into a silent no-op.
    #[test]
    fn an_all_border_grid_keeps_its_perimeter_ring() {
        let step = 100.0;
        let at = |i: usize| i as f64 * step;
        let mut segments = Vec::new();
        for i in 0..=3 {
            for j in 0..3 {
                segments.push(LineSegment::with_color(
                    Point::new(at(i), at(j)),
                    Point::new(at(i), at(j + 1)),
                    LineColor::Black0,
                ));
                segments.push(LineSegment::with_color(
                    Point::new(at(j), at(i)),
                    Point::new(at(j + 1), at(i)),
                    LineColor::Black0,
                ));
            }
        }

        let graph = FoldGraph::from_sheet_segments(&segments);
        assert_eq!(
            graph.faces.len(),
            8,
            "the one enclosed cell is read as a hole; the perimeter ring is not"
        );
        assert!(!graph.faces.is_empty(), "never every face");
    }

    /// A document with no border lines at all — the common case — must be
    /// untouched. No face can be all-border, so the filter is a no-op.
    #[test]
    fn a_document_with_no_border_lines_is_untouched() {
        let creases: Vec<LineSegment> = grid_segments(4)
            .into_iter()
            .map(|segment| segment.with_line_color(LineColor::Blue2))
            .collect();
        let graph = FoldGraph::from_sheet_segments(&creases);
        assert_eq!(graph.faces.len(), 16);
    }

    /// The cache is only a faster way to compute the scan, so it must agree with
    /// it line for line — including the `None`s, which are what the callers in
    /// `folding.rs` branch on.
    #[test]
    fn line_face_border_matches_the_all_faces_scan() {
        assert_line_face_borders_match_scan(&grid_segments(1));
        assert_line_face_borders_match_scan(&grid_segments(4));
        assert_line_face_borders_match_scan(&grid_segments(9));
    }

    /// A graph built without faces has no borders to report, and must say so
    /// rather than index into an empty cache.
    #[test]
    fn line_face_border_is_empty_without_faces() {
        let graph = FoldGraph::from_segments(&grid_segments(2), false);
        assert!(graph.faces.is_empty());
        for line_index in 0..graph.lines.len() {
            assert_eq!(graph.line_face_border(line_index), None);
        }
        assert_eq!(graph.line_face_border(usize::MAX), None);
    }

    /// The linear scan [`VertexIndex`] replaces, kept as the reference.
    fn scanned_points(segments: &[LineSegment]) -> Vec<Point> {
        let mut points: Vec<Point> = Vec::new();
        let mut push = |point: Point| {
            if points
                .iter()
                .position(|candidate| equal(*candidate, point))
                .is_none()
            {
                points.push(point);
            }
        };
        for segment in segments {
            push(segment.a);
            push(segment.b);
        }
        points
    }

    /// Deterministic points clustered around the merge radius.
    ///
    /// The interesting inputs are not "far apart" or "identical" — both forms
    /// agree trivially on those. They are points a hair either side of
    /// `Epsilon::POINT` from each other, and points that straddle a bucket
    /// boundary, which is the only place a grid can differ from a scan.
    fn near_coincident_segments() -> Vec<LineSegment> {
        let mut state: u64 = 0x2545_F491_4F6C_DD1D;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 11) as f64 / (1u64 << 53) as f64
        };
        // Snap onto a lattice whose pitch is the merge radius, then jitter by up
        // to twice it: every pair is within a bucket or two of a merge decision.
        let pitch = Epsilon::POINT;
        let mut segments = Vec::new();
        for _ in 0..600 {
            let mut point = || {
                let cell_x = (next() * 12.0).floor();
                let cell_y = (next() * 12.0).floor();
                Point::new(
                    cell_x * pitch + (next() - 0.5) * 2.0 * pitch,
                    cell_y * pitch + (next() - 0.5) * 2.0 * pitch,
                )
            };
            segments.push(LineSegment::with_color(point(), point(), LineColor::Red1));
        }
        segments
    }

    #[test]
    fn points_dedup_exactly_as_a_linear_scan_does() {
        let segments = near_coincident_segments();
        let graph = FoldGraph::from_segments(&segments, false);
        assert_eq!(
            graph.points,
            scanned_points(&segments),
            "the grid must return the same vertex, in the same order, as the scan"
        );
        assert!(
            graph.points.len() > 60,
            "the generator has to actually merge some and keep others; got {}",
            graph.points.len()
        );
    }

    /// The whole arrangement, not just the point list: a differing vertex id
    /// would move every face.
    #[test]
    fn the_arrangement_is_unchanged_on_a_grid_with_shared_vertices() {
        let mut segments = Vec::new();
        for i in 0..=8 {
            let t = f64::from(i) * 25.0;
            segments.push(LineSegment::with_color(
                Point::new(t, 0.0),
                Point::new(t, 200.0),
                LineColor::Red1,
            ));
            segments.push(LineSegment::with_color(
                Point::new(0.0, t),
                Point::new(200.0, t),
                LineColor::Blue2,
            ));
        }
        let graph = FoldGraph::from_segments(&segments, true);
        assert_eq!(graph.points, scanned_points(&segments));
        assert_eq!(
            graph.lines.len(),
            segments.len(),
            "one graph line per segment, in order"
        );
    }

    /// `align_face` rotates to the first slot holding the minimum, duplicates or
    /// not — the property the `remove(0)` loop had.
    #[test]
    fn a_face_ring_is_rotated_to_its_lowest_point_id() {
        let mut ring = vec![7, 3, 9, 3, 5];
        align_face(&mut ring);
        assert_eq!(ring, vec![3, 9, 3, 5, 7]);

        let mut already = vec![1, 4, 2];
        align_face(&mut already);
        assert_eq!(already, vec![1, 4, 2]);

        let mut empty: Vec<usize> = Vec::new();
        align_face(&mut empty);
        assert!(empty.is_empty());
    }
}
