use crate::geometry::{
    Circle, Epsilon, LineColor, LineSegment, ParallelJudgement, Point, StraightLine, bisection,
    find_intersection_segments, is_line_segment_parallel_with_precision, line_segment_rotate,
};
use crate::io::Result;
use crate::io::fold::import_fold_json;
use crate::model::CreasePatternModel;
use crate::operations::arrangement::add_line_segment_like_worker;
use crate::operations::native::pinned::PinnedPoints;
use crate::operations::transform::transform_segments_by_points;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DefaultMolecule {
    Blintz,
    FishBase,
    DoveBase,
    BirdBase,
    FrogBase,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct VoronoiState {
    pub line_segments: Vec<VoronoiLineSegment>,
    pub lines_around_new_point: Vec<VoronoiLineSegment>,
    pub seed_points: Vec<Point>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VoronoiLineSegment {
    pub voronoi_a: usize,
    pub voronoi_b: usize,
    pub line_segment: LineSegment,
    pub selected: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VoronoiApplyResult {
    pub lines_added: usize,
    pub circles_added: usize,
}

impl VoronoiState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn reset(&mut self) {
        self.line_segments.clear();
        self.lines_around_new_point.clear();
        self.seed_points.clear();
    }
}

impl VoronoiLineSegment {
    pub fn new(line_segment: LineSegment) -> Self {
        Self {
            voronoi_a: 0,
            voronoi_b: 0,
            line_segment,
            selected: 0,
        }
    }

    pub fn with_a(&self, a: Point) -> Self {
        Self {
            voronoi_a: self.voronoi_a,
            voronoi_b: self.voronoi_b,
            line_segment: self.line_segment.with_a(a),
            selected: 0,
        }
    }

    pub fn with_b(&self, b: Point) -> Self {
        Self {
            voronoi_a: self.voronoi_a,
            voronoi_b: self.voronoi_b,
            line_segment: self.line_segment.with_b(b),
            selected: 0,
        }
    }
}

/// Oriedita `POLYGON_SET_NO_CORNERS_29` after both polygon points are resolved.
pub fn regular_polygon_no_corners(
    model: &mut CreasePatternModel,
    p1: Point,
    p2: Point,
    corners: usize,
    color: LineColor,
) -> usize {
    let mut added = 0;
    let mut seed = LineSegment::with_color(p1, p2, color);
    add_line_segment_like_worker(model, &seed);
    added += 1;

    if corners < 2 {
        return added;
    }

    let rotation = (corners as f64 - 2.0) * 180.0 / corners as f64;
    for _ in 2..=corners {
        let rotated = line_segment_rotate(&seed, rotation);
        seed = LineSegment::with_color(rotated.b, rotated.a, color);
        add_line_segment_like_worker(model, &seed);
        added += 1;
    }

    added
}

pub fn regular_polygon(
    model: &mut CreasePatternModel,
    p1: Point,
    p2: Point,
    corners: usize,
    color: LineColor,
) -> usize {
    regular_polygon_no_corners(model, p1, p2, corners, color)
}

/// Oriedita `VORONOI_CREATE_62` press handler with identity-camera semantics.
pub fn voronoi_press(
    model: &CreasePatternModel,
    state: &mut VoronoiState,
    point: Point,
    selection_distance: f64,
) {
    let closest_point = closest_voronoi_point(model, point);
    let selected_point = if point.distance(closest_point) < selection_distance {
        closest_point
    } else {
        point
    };

    let mut overlapping_seed_point_index = None;
    for (index, seed_point) in state.seed_points.iter().enumerate() {
        if seed_point.distance(selected_point) <= selection_distance {
            overlapping_seed_point_index = Some(index);
        }
    }

    if let Some(overlapping_seed_point_index) = overlapping_seed_point_index {
        voronoi_remove_seed(state, overlapping_seed_point_index);
    } else {
        state.seed_points.push(selected_point);
        voronoi_02(state);
    }
}

/// Oriedita `VORONOI_CREATE_62.apply`: commit preview lines and seed circles, then reset state.
pub fn voronoi_apply(
    model: &mut CreasePatternModel,
    state: &mut VoronoiState,
    color: LineColor,
) -> VoronoiApplyResult {
    let lines = state.line_segments.clone();
    let seed_points = state.seed_points.clone();
    let mut lines_added = 0;
    for line in lines {
        add_line_segment_like_worker(model, &line.line_segment.with_line_color(color));
        lines_added += 1;
    }

    let mut circles_added = 0;
    for seed_point in seed_points {
        model.add_circle(Circle::new(
            seed_point.x,
            seed_point.y,
            5.0,
            LineColor::Cyan3,
        ));
        circles_added += 1;
    }

    state.reset();
    VoronoiApplyResult {
        lines_added,
        circles_added,
    }
}

pub fn default_molecule(
    model: &mut CreasePatternModel,
    molecule: DefaultMolecule,
    p1: Point,
    p2: Point,
    color: LineColor,
) -> Result<usize> {
    if distance_too_small(p1, p2) {
        return Ok(0);
    }

    let mut template = import_fold_json(molecule.fold_json())?;
    let starting_circles: Vec<_> = template
        .circles
        .iter()
        .copied()
        .filter(|circle| circle.r > Epsilon::UNKNOWN_1EN6)
        .collect();
    if starting_circles.len() < 2 {
        return Ok(0);
    }

    // No pinned set: this places a *template* the generator is about to add, so
    // there is no existing vertex to hold — the same reason the copy transforms
    // take none.
    transform_segments_by_points(
        &mut template.line_segments,
        starting_circles[0].determine_center(),
        starting_circles[1].determine_center(),
        p1,
        p2,
        PinnedPoints::none(),
    );

    let mut added = 0;
    for segment in template
        .line_segments
        .iter()
        .filter(|segment| segment.determine_length() > Epsilon::UNKNOWN_1EN6)
    {
        add_line_segment_like_worker(model, &segment.with_line_color(color));
        added += 1;
    }

    Ok(added)
}

fn voronoi_remove_seed(state: &mut VoronoiState, overlapping_seed_point_index: usize) {
    if state.seed_points.is_empty() {
        return;
    }

    let last_index = state.seed_points.len() - 1;
    state
        .seed_points
        .swap(overlapping_seed_point_index, last_index);
    for line in &mut state.line_segments {
        if line.voronoi_a == overlapping_seed_point_index {
            line.voronoi_a = last_index;
        } else if line.voronoi_a == last_index {
            line.voronoi_a = overlapping_seed_point_index;
        }

        if line.voronoi_b == overlapping_seed_point_index {
            line.voronoi_b = last_index;
        } else if line.voronoi_b == last_index {
            line.voronoi_b = overlapping_seed_point_index;
        }
    }
    state.seed_points.pop();

    let removed_index = state.seed_points.len();
    let mut replacement_lines = Vec::new();
    for line in &mut state.line_segments {
        line.selected = 0;
    }

    let line_count = state.line_segments.len();
    for index in 0..line_count {
        if state.line_segments[index].voronoi_a == removed_index {
            state.line_segments[index].selected = 2;
            let neighbor = state.line_segments[index].voronoi_b;
            select_voronoi_neighbor_lines(state, neighbor);
            senb_boro_1p_motome(state, neighbor);
            push_unique_voronoi_lines(&mut replacement_lines, &state.lines_around_new_point);
        } else if state.line_segments[index].voronoi_b == removed_index {
            state.line_segments[index].selected = 2;
            let neighbor = state.line_segments[index].voronoi_a;
            select_voronoi_neighbor_lines(state, neighbor);
            senb_boro_1p_motome(state, neighbor);
            push_unique_voronoi_lines(&mut replacement_lines, &state.lines_around_new_point);
        }
    }

    state.line_segments.retain(|line| line.selected != 2);
    state.line_segments.extend(replacement_lines);
}

fn select_voronoi_neighbor_lines(state: &mut VoronoiState, neighbor: usize) {
    for line in &mut state.line_segments {
        if line.voronoi_a == neighbor || line.voronoi_b == neighbor {
            line.selected = 2;
        }
    }
}

fn push_unique_voronoi_lines(target: &mut Vec<VoronoiLineSegment>, source: &[VoronoiLineSegment]) {
    for line in source {
        let already_present = target.iter().any(|existing| {
            (line.voronoi_a == existing.voronoi_a && line.voronoi_b == existing.voronoi_b)
                || (line.voronoi_b == existing.voronoi_a && line.voronoi_a == existing.voronoi_b)
        });
        if !already_present {
            target.push(line.clone());
        }
    }
}

fn voronoi_02(state: &mut VoronoiState) {
    let new_seed_point_index = state.seed_points.len() - 1;
    senb_boro_1p_motome(state, new_seed_point_index);
    for line in &mut state.line_segments {
        line.selected = 0;
    }

    for ia in 0..state.lines_around_new_point.len().saturating_sub(1) {
        for ib in ia + 1..state.lines_around_new_point.len() {
            let s_begin = state.lines_around_new_point[ia].clone();
            let s_end = state.lines_around_new_point[ib].clone();
            let t_begin = StraightLine::from_segment(&s_begin.line_segment);

            let mut i_begin = s_begin.voronoi_a;
            let mut i_end = s_end.voronoi_a;
            if i_begin > i_end {
                std::mem::swap(&mut i_begin, &mut i_end);
            }

            for existing in &mut state.line_segments {
                let mut existing_low = existing.voronoi_a;
                let mut existing_high = existing.voronoi_b;
                if existing_low > existing_high {
                    std::mem::swap(&mut existing_low, &mut existing_high);
                }

                if existing_low == i_begin && existing_high == i_end {
                    let intersection =
                        find_intersection_segments(&s_begin.line_segment, &existing.line_segment);
                    let new_seed = state.seed_points[new_seed_point_index];
                    if t_begin.same_side(new_seed, existing.line_segment.a) >= 0
                        && t_begin.same_side(new_seed, existing.line_segment.b) >= 0
                    {
                        existing.selected = 2;
                    }

                    if t_begin.same_side(new_seed, existing.line_segment.a) == -1
                        && t_begin.same_side(new_seed, existing.line_segment.b) == 1
                    {
                        *existing = existing.with_b(intersection);
                    }

                    if t_begin.same_side(new_seed, existing.line_segment.a) == 1
                        && t_begin.same_side(new_seed, existing.line_segment.b) == -1
                    {
                        *existing = existing.with_a(intersection);
                    }
                }
            }
        }
    }

    state.line_segments.retain(|line| line.selected != 2);
    state
        .line_segments
        .extend(state.lines_around_new_point.iter().cloned());
}

fn senb_boro_1p_motome(state: &mut VoronoiState, new_seed_point_index: usize) {
    state.lines_around_new_point.clear();

    for seed_index in 0..state.seed_points.len() {
        if seed_index == new_seed_point_index {
            continue;
        }

        let mut add_line = VoronoiLineSegment::new(bisection(
            state.seed_points[seed_index],
            state.seed_points[new_seed_point_index],
            1000.0,
        ));
        if seed_index < new_seed_point_index {
            add_line.voronoi_a = seed_index;
            add_line.voronoi_b = new_seed_point_index;
        } else {
            add_line.voronoi_a = new_seed_point_index;
            add_line.voronoi_b = seed_index;
        }
        voronoi_02_01(state, new_seed_point_index, add_line);
    }
}

fn voronoi_02_01(
    state: &mut VoronoiState,
    new_seed_point_index: usize,
    mut add_line: VoronoiLineSegment,
) {
    let add_straight_line = StraightLine::from_segment(&add_line.line_segment);

    for index in (0..state.lines_around_new_point.len()).rev() {
        let mut existing_line = state.lines_around_new_point[index].clone();
        let existing_straight_line = StraightLine::from_segment(&existing_line.line_segment);
        let parallel = is_line_segment_parallel_with_precision(
            add_straight_line,
            existing_straight_line,
            Epsilon::UNKNOWN_1EN4,
        );

        let seed = state.seed_points[new_seed_point_index];
        if parallel == ParallelJudgement::ParallelEqual {
            return;
        }
        if parallel == ParallelJudgement::ParallelNotEqual {
            if add_straight_line.same_side(seed, existing_line.line_segment.a) == -1 {
                state.lines_around_new_point.remove(index);
            } else if existing_straight_line.same_side(seed, add_line.line_segment.a) == -1 {
                return;
            }
        } else if parallel == ParallelJudgement::NotParallel {
            let intersection =
                find_intersection_segments(&add_line.line_segment, &existing_line.line_segment);

            if add_straight_line.same_side(seed, existing_line.line_segment.a) <= 0
                && add_straight_line.same_side(seed, existing_line.line_segment.b) <= 0
            {
                state.lines_around_new_point.remove(index);
            } else if add_straight_line.same_side(seed, existing_line.line_segment.a) == 1
                && add_straight_line.same_side(seed, existing_line.line_segment.b) == -1
            {
                existing_line = existing_line.with_b(intersection);
                if existing_line.line_segment.determine_length() < Epsilon::UNKNOWN_1EN7 {
                    state.lines_around_new_point.remove(index);
                } else {
                    state.lines_around_new_point[index] = existing_line;
                }
            } else if add_straight_line.same_side(seed, existing_line.line_segment.a) == -1
                && add_straight_line.same_side(seed, existing_line.line_segment.b) == 1
            {
                existing_line = existing_line.with_a(intersection);
                if existing_line.line_segment.determine_length() < Epsilon::UNKNOWN_1EN7 {
                    state.lines_around_new_point.remove(index);
                } else {
                    state.lines_around_new_point[index] = existing_line;
                }
            }

            if existing_straight_line.same_side(seed, add_line.line_segment.a) <= 0
                && existing_straight_line.same_side(seed, add_line.line_segment.b) <= 0
            {
                return;
            } else if existing_straight_line.same_side(seed, add_line.line_segment.a) == 1
                && existing_straight_line.same_side(seed, add_line.line_segment.b) == -1
            {
                add_line = add_line.with_b(intersection);
                if add_line.line_segment.determine_length() < Epsilon::UNKNOWN_1EN7 {
                    return;
                }
            } else if existing_straight_line.same_side(seed, add_line.line_segment.a) == -1
                && existing_straight_line.same_side(seed, add_line.line_segment.b) == 1
            {
                add_line = add_line.with_a(intersection);
                if add_line.line_segment.determine_length() < Epsilon::UNKNOWN_1EN7 {
                    return;
                }
            }
        }
    }

    state.lines_around_new_point.push(add_line);
}

fn closest_voronoi_point(model: &CreasePatternModel, point: Point) -> Point {
    let mut closest = Point::new(100_000.0, 100_000.0);
    for segment in &model.line_segments {
        for endpoint in [segment.a, segment.b] {
            if point.distance_squared(endpoint) < point.distance_squared(closest) {
                closest = endpoint;
            }
        }
    }
    for circle in &model.circles {
        let center = circle.determine_center();
        if point.distance_squared(center) < point.distance_squared(closest) {
            closest = center;
        }
    }
    closest
}

fn distance_too_small(p1: Point, p2: Point) -> bool {
    p1.distance(p2) < Epsilon::UNKNOWN_1EN6
}

impl DefaultMolecule {
    fn fold_json(self) -> &'static str {
        match self {
            Self::Blintz => include_str!("../../resources/default-molecules/blintz.fold"),
            Self::FishBase => include_str!("../../resources/default-molecules/fish_base.fold"),
            Self::DoveBase => include_str!("../../resources/default-molecules/dove_base.fold"),
            Self::BirdBase => include_str!("../../resources/default-molecules/bird_base.fold"),
            Self::FrogBase => include_str!("../../resources/default-molecules/frog_base.fold"),
        }
    }
}
