//! Oriedita-compatible crease-pattern diagnostic helpers.

use crate::geometry::{
    Epsilon, Intersection, LineColor, LineSegment, Point, angle, angle_between_0_360,
    angle_between_0_kmax, determine_line_segment_intersection_sweet_with_tolerances,
    determine_line_segment_intersection_with_precision,
    determine_line_segment_intersection_with_tolerances, equal_with_radius,
    find_intersection_segments, find_line_symmetry_line_segment,
};
use crate::model::CreasePatternModel;
use crate::operations::arrangement::divide_line_segment_with_new_lines;
use std::collections::HashMap;

const FIX_DATA_22_5_BYTES: &[u8] = include_bytes!("../resources/fix-precision/fixData_22_5.bin");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FlatFoldableBoundaryCheck {
    pub color: LineColor,
    pub suitable_intersections: bool,
    pub crossing_count: usize,
}

/// Which arithmetic the flat-foldability check evaluates Oriedita's algorithm
/// with.
///
/// The *algorithm* is identical either way — same crimp reduction, same tie
/// test, same `Epsilon::FLAT` everywhere. What differs is two evaluations that
/// are identities in exact arithmetic and are not identities in `f64`, and which
/// between them make the check's verdict depend on which way up the pattern is
/// drawn. See `implementation-plans/orientation-invariant-flat-foldability.md`.
///
/// Measured on `worked_but_has_errors.osf` under the six bit-exact coordinate
/// transforms — identity, the three 90° rotations, a mirror and a transpose,
/// which only permute and negate coordinates so no geometry changes at all:
///
/// | | violations across the six |
/// | --- | --- |
/// | [`OrieditaExact`](Self::OrieditaExact) | `[3, 3, 2, 3, 2, 5]` |
/// | [`Refined`](Self::Refined) | `[0, 0, 0, 0, 0, 0]` |
///
/// Under `OrieditaExact` the union of reported sites is 7 and the intersection
/// is **0**: not one reported violation survives every orientation, and every
/// one of them is a false positive — the worst true Kawasaki residual in that
/// file is 1.6e-7°, against a 1e-6° bar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CamvAngleArithmetic {
    /// Well-conditioned ray bearings, and the reduction shrinks its working
    /// range by the sector it actually collapsed. The default.
    #[default]
    Refined,
    /// Upstream's arithmetic reproduced verbatim, for oracle parity.
    OrieditaExact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlatFoldabilityRule {
    NumberOfFolds,
    Angles,
    Maekawa,
    BigLittleBig,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlatFoldabilityColor {
    NotEnoughMountain,
    NotEnoughValley,
    Equal,
    Correct,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BigLittleBigSegment {
    pub segment: LineSegment,
    pub violating: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlatFoldabilityViolation {
    pub point: Point,
    pub rule: FlatFoldabilityRule,
    pub color: FlatFoldabilityColor,
    pub big_little_big: Vec<BigLittleBigSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CamvCheckResult {
    pub violations: Vec<FlatFoldabilityViolation>,
    pub dirty: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FixInaccurateOptions {
    pub fix_precision: f64,
    pub use_bp: bool,
    pub use_22_5: bool,
}

impl Default for FixInaccurateOptions {
    fn default() -> Self {
        Self {
            fix_precision: 0.05,
            use_bp: true,
            use_22_5: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixInaccurateType {
    Bp,
    Pure22_5,
    Other,
    Empty,
}

impl FixInaccurateType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Bp => "BP",
            Self::Pure22_5 => "PURE_22_5",
            Self::Other => "OTHER",
            Self::Empty => "EMPTY",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct FixInaccurateResult {
    pub num_fixed_lines: usize,
    pub num_fixable_lines: usize,
    pub fixed_lines: Vec<LineSegment>,
    pub fix_type: FixInaccurateType,
    pub applied: bool,
    pub warning: bool,
}

impl FlatFoldabilityViolation {
    pub fn new(point: Point, rule: FlatFoldabilityRule, color: FlatFoldabilityColor) -> Self {
        Self {
            point,
            rule,
            color,
            big_little_big: Vec::new(),
        }
    }

    pub fn big_little_big(point: Point, big_little_big: Vec<BigLittleBigSegment>) -> Self {
        Self {
            point,
            rule: FlatFoldabilityRule::BigLittleBig,
            color: FlatFoldabilityColor::Correct,
            big_little_big,
        }
    }
}

impl FixInaccurateResult {
    fn empty() -> Self {
        Self {
            num_fixed_lines: 0,
            num_fixable_lines: 0,
            fixed_lines: Vec::new(),
            fix_type: FixInaccurateType::Empty,
            applied: false,
            warning: false,
        }
    }
}

/// Oriedita `Check1.apply`: collect non-auxiliary overlapping/contained line pairs.
pub fn check1(model: &CreasePatternModel) -> Vec<LineSegment> {
    let mut diagnostics = Vec::new();

    for i in 0..model.line_segments.len() {
        let si = &model.line_segments[i];
        if si.color == LineColor::Cyan3 {
            continue;
        }

        for sj in &model.line_segments[..i] {
            if sj.color == LineColor::Cyan3 {
                continue;
            }

            let intersection = determine_line_segment_intersection_with_tolerances(
                si,
                sj,
                Epsilon::UNKNOWN_0001,
                Epsilon::PARALLEL_FOR_FIX,
            );
            if check1_intersection_matches(intersection) || intersection.is_contained_inside() {
                diagnostics.push(si.clone());
                diagnostics.push(sj.clone());
            }
        }
    }

    diagnostics
}

/// Oriedita `Check2.apply`: collect non-auxiliary near-T intersection pairs.
pub fn check2(model: &CreasePatternModel) -> Vec<LineSegment> {
    let mut diagnostics = Vec::new();

    for i in 0..model.line_segments.len() {
        let si = &model.line_segments[i];
        if si.color == LineColor::Cyan3 {
            continue;
        }

        for sj in &model.line_segments[..i] {
            if sj.color == LineColor::Cyan3 {
                continue;
            }

            let intersection = determine_line_segment_intersection_sweet_with_tolerances(
                si,
                sj,
                Epsilon::UNKNOWN_0001,
                Epsilon::PARALLEL_FOR_FIX,
            );
            if matches!(
                intersection,
                Intersection::IntersectsTShapeS1VerticalBar25
                    | Intersection::IntersectsTShapeS1VerticalBar26
                    | Intersection::IntersectsTShapeS2VerticalBar27
                    | Intersection::IntersectsTShapeS2VerticalBar28
            ) {
                diagnostics.push(si.clone());
                diagnostics.push(sj.clone());
            }
        }
    }

    diagnostics
}

/// Oriedita `Check3.apply`: collect legacy vertex flat-foldability markers.
pub fn check3(model: &CreasePatternModel) -> Vec<LineSegment> {
    check3_with(model, CamvAngleArithmetic::default())
}

/// [`check3`] under a chosen arithmetic.
///
/// Check3 runs the *same* Fushimi reduction as Check4 against the same
/// `SortingBox`, with its own copy of both defects — the `acos` bearing and the
/// `2.0 * min_angle` subtraction. It gets the same treatment for the same
/// reason: leaving one of two implementations of one condition on the old
/// arithmetic is how they come to disagree with each other.
pub fn check3_with(
    model: &CreasePatternModel,
    arithmetic: CamvAngleArithmetic,
) -> Vec<LineSegment> {
    let mut diagnostics = Vec::new();
    for segment in &model.line_segments {
        if segment.color == LineColor::Cyan3 {
            continue;
        }

        check3_point(model, segment.a, arithmetic, &mut diagnostics);
        check3_point(model, segment.b, arithmetic, &mut diagnostics);
    }

    diagnostics
}

/// A ray's bearing in degrees, well-conditioned at every orientation.
///
/// [`crate::geometry::angle`] is `acos(x / length)`, transcribed statement for
/// statement from `OritaCalc.java:71-97` (the vendored tree contains no `atan`
/// at all). `acos` is ill-conditioned as its argument approaches ±1 — a
/// *near-horizontal* ray — because `dθ/dc = -1/sin θ`. Measured over 200k random
/// rays per band: 9.9e-7° of error at a bearing near 0°, 9.1e-7° near 180°, and
/// 2.8e-14° at 45° and 90°. Against a 1e-6° bar that is the whole margin.
///
/// `atan2` is uniformly conditioned, so this returns the same value everywhere
/// upstream's is accurate and a better one where it is not. It is deliberately
/// **local to this module** rather than a change to
/// [`crate::geometry::angle`]: that primitive has nineteen call sites outside
/// the foldability check and a test pinning its exact behaviour, and none of
/// them are what this is for.
fn refined_bearing(a: Point, b: Point) -> f64 {
    let x = b.x - a.x;
    let y = b.y - a.y;
    if x == 0.0 && y == 0.0 {
        // The sentinel upstream returns for a zero-length segment; callers
        // downstream sort on it and never arithmetic on it.
        return -10000.0;
    }
    let degrees = y.atan2(x).to_degrees();
    if degrees < 0.0 {
        degrees + 360.0
    } else {
        degrees
    }
}

/// The bearing feeding the fan, under the caller's chosen arithmetic.
fn fan_bearing(a: Point, b: Point, arithmetic: CamvAngleArithmetic) -> f64 {
    match arithmetic {
        CamvAngleArithmetic::Refined => refined_bearing(a, b),
        CamvAngleArithmetic::OrieditaExact => angle((a, b)),
    }
}

/// Oriedita `Check4.apply`: collect CAMV and big-little-big violations.
pub fn check4(model: &CreasePatternModel) -> Vec<FlatFoldabilityViolation> {
    check4_with(model, CamvAngleArithmetic::default())
}

/// [`check4`] under a chosen arithmetic. Oracle parity tests pass
/// [`CamvAngleArithmetic::OrieditaExact`]; everything else takes the default.
pub fn check4_with(
    model: &CreasePatternModel,
    arithmetic: CamvAngleArithmetic,
) -> Vec<FlatFoldabilityViolation> {
    point_line_map(model)
        .into_iter()
        .filter_map(|vertex| {
            find_flat_foldability_violation_with(vertex.point, &vertex.lines, arithmetic)
        })
        .collect()
}

/// Oriedita `CheckCAMVTask.run`: recompute Check4 violations and mark the canvas dirty.
pub fn check_camv_task(model: &CreasePatternModel) -> CamvCheckResult {
    check_camv_task_with(model, CamvAngleArithmetic::default())
}

/// [`check_camv_task`] under a chosen arithmetic.
pub fn check_camv_task_with(
    model: &CreasePatternModel,
    arithmetic: CamvAngleArithmetic,
) -> CamvCheckResult {
    CamvCheckResult {
        violations: check4_with(model, arithmetic),
        dirty: true,
    }
}

/// Oriedita `MouseHandlerCreaseFixInaccurate`: fix selected folding-line coordinates.
pub fn fix_inaccurate_for_indices(
    model: &mut CreasePatternModel,
    indices: &[usize],
    options: FixInaccurateOptions,
) -> FixInaccurateResult {
    let selected_lines = indices
        .iter()
        .filter_map(|index| model.line_segments.get(*index))
        .filter(|segment| segment.color.is_folding_line())
        .cloned()
        .collect::<Vec<_>>();

    if selected_lines.is_empty() {
        return FixInaccurateResult::empty();
    }

    let xform = fix_inaccurate_xform(&selected_lines);
    let transformed_lines = fix_inaccurate_do_xform(&selected_lines, xform);
    let to_fix = fix_inaccurate_coordinates(&transformed_lines);
    let mut result = fix_inaccurate_values(&to_fix, options);

    if result.fix_type == FixInaccurateType::Empty
        || result.num_fixable_lines == 0
        || result.fixed_values.is_empty()
    {
        return result.into_public(false, false, Vec::new());
    }

    result.fixed_values = fix_inaccurate_undo_xform_values(result.fixed_values, xform);
    let fixed_lines = fix_inaccurate_lines_from_values(&selected_lines, &result.fixed_values);
    let warning = result.fix_type == FixInaccurateType::Pure22_5
        && !xform.in_default_square
        && !xform.is_square;

    for (line, fixed_line) in selected_lines.iter().zip(fixed_lines.iter()) {
        if let Some(index) = model
            .line_segments
            .iter()
            .position(|candidate| candidate == line)
        {
            model.line_segments.remove(index);
        }
        model.add_line_segment(fixed_line.clone());
    }

    let added_count = fixed_lines.len();
    let added_end = model.line_segments.len();
    let original_end = added_end.saturating_sub(added_count);
    divide_line_segment_with_new_lines(model, original_end, added_end);

    result.into_public(true, warning, fixed_lines)
}

/// Oriedita `Check4.findFlatfoldabilityViolation` for one point and its incident lines.
pub fn find_flat_foldability_violation(
    point: Point,
    lines: &[LineSegment],
) -> Option<FlatFoldabilityViolation> {
    find_flat_foldability_violation_with(point, lines, CamvAngleArithmetic::default())
}

/// [`find_flat_foldability_violation`] under a chosen arithmetic.
pub fn find_flat_foldability_violation_with(
    point: Point,
    lines: &[LineSegment],
    arithmetic: CamvAngleArithmetic,
) -> Option<FlatFoldabilityViolation> {
    let mut red = 0usize;
    let mut blue = 0usize;
    let mut black = 0usize;
    let mut nbox = SortingBox::default();

    for segment in lines {
        match segment.color {
            LineColor::Red1 => red += 1,
            LineColor::Blue2 => blue += 1,
            LineColor::Black0 => black += 1,
            _ => {}
        }

        if segment.color.is_folding_line() {
            if point.distance(segment.a) < Epsilon::FLAT {
                nbox.add_by_weight(
                    segment.clone(),
                    fan_bearing(segment.a, segment.b, arithmetic),
                );
            } else if point.distance(segment.b) < Epsilon::FLAT {
                nbox.add_by_weight(
                    segment.clone(),
                    fan_bearing(segment.b, segment.a, arithmetic),
                );
            }
        }
    }

    if black != 0 && black != 2 {
        return Some(FlatFoldabilityViolation::new(
            point,
            FlatFoldabilityRule::NumberOfFolds,
            FlatFoldabilityColor::Unknown,
        ));
    }

    if black == 0 {
        let angle_or_lbl = find_flat_foldability_violation_inside(point, nbox, arithmetic);
        let mut rule = angle_or_lbl
            .as_ref()
            .map(|violation| violation.rule)
            .unwrap_or(FlatFoldabilityRule::None);

        if red.abs_diff(blue) != 2 {
            if matches!(
                rule,
                FlatFoldabilityRule::BigLittleBig | FlatFoldabilityRule::None
            ) {
                rule = FlatFoldabilityRule::Maekawa;
            }
            return Some(FlatFoldabilityViolation::new(
                point,
                rule,
                maekawa_color(red, blue),
            ));
        }

        if !matches!(
            rule,
            FlatFoldabilityRule::Maekawa | FlatFoldabilityRule::None
        ) {
            if blue == red {
                return Some(FlatFoldabilityViolation::new(
                    point,
                    rule,
                    FlatFoldabilityColor::Equal,
                ));
            }
            if rule == FlatFoldabilityRule::BigLittleBig {
                return angle_or_lbl;
            }
            return Some(FlatFoldabilityViolation::new(
                point,
                rule,
                FlatFoldabilityColor::Correct,
            ));
        }

        return None;
    }

    find_big_little_big_violation_on_sides(point, nbox)
}

/// Oriedita `FLAT_FOLDABLE_CHECK_63` result coloring once the boundary loop is resolved.
pub fn flat_foldable_boundary_check(
    model: &CreasePatternModel,
    boundary: &mut [LineSegment],
) -> FlatFoldableBoundaryCheck {
    let mut suitable_intersections = true;
    let mut ordered_crossings = Vec::new();

    for boundary_segment in boundary.iter() {
        let mut segment_crossings = Vec::<(f64, LineSegment)>::new();
        for segment in &model.line_segments {
            let intersection = determine_line_segment_intersection_with_precision(
                segment,
                boundary_segment,
                Epsilon::UNKNOWN_1EN4,
            );
            if intersection != Intersection::NoIntersection0
                && intersection != Intersection::Intersects1
            {
                suitable_intersections = false;
            }

            if intersection == Intersection::Intersects1 && segment.color.number() < 3 {
                segment_crossings.push((
                    boundary_segment
                        .a
                        .distance(find_intersection_segments(segment, boundary_segment)),
                    segment.clone(),
                ));
            }
        }

        segment_crossings.sort_by(|left, right| left.0.total_cmp(&right.0));
        ordered_crossings.extend(segment_crossings.into_iter().map(|(_, segment)| segment));
    }

    let color = if suitable_intersections {
        flat_foldable_boundary_color(&ordered_crossings)
    } else {
        LineColor::Yellow7
    };

    if suitable_intersections {
        for segment in boundary {
            *segment = segment.with_line_color(color);
        }
    }

    FlatFoldableBoundaryCheck {
        color,
        suitable_intersections,
        crossing_count: ordered_crossings.len(),
    }
}

fn check3_point(
    model: &CreasePatternModel,
    point: Point,
    arithmetic: CamvAngleArithmetic,
    diagnostics: &mut Vec<LineSegment>,
) {
    let tss = vertex_surrounding_line_count(model, point, Epsilon::UNKNOWN_1EN4, |_| true);
    let tss_red = vertex_surrounding_line_count(model, point, Epsilon::UNKNOWN_1EN4, |segment| {
        segment.color == LineColor::Red1
    });
    let tss_blue = vertex_surrounding_line_count(model, point, Epsilon::UNKNOWN_1EN4, |segment| {
        segment.color == LineColor::Blue2
    });
    let tss_black = vertex_surrounding_line_count(model, point, Epsilon::UNKNOWN_1EN4, |segment| {
        segment.color == LineColor::Black0
    });
    let tss_aux_live =
        vertex_surrounding_line_count(model, point, Epsilon::UNKNOWN_1EN4, |segment| {
            !segment.color.is_folding_line()
        });

    if tss_black != 0 && tss_black != 2 {
        diagnostics.push(LineSegment::new(point, point));
    }

    if tss_black == 0 {
        if tss - tss_aux_live == tss_red + tss_blue && tss_red.abs_diff(tss_blue) != 2 {
            diagnostics.push(LineSegment::new(point, point));
        }
        if !extended_fushimi_decide_inside_model(model, point, arithmetic) {
            diagnostics.push(LineSegment::new(point, point));
        }
    }

    if tss_black == 2 && !extended_fushimi_decide_sides_model(model, point, arithmetic) {
        diagnostics.push(LineSegment::new(point, point));
    }
}

#[derive(Debug, Clone)]
struct FixInaccurateRawResult {
    num_fixed_lines: usize,
    num_fixable_lines: usize,
    fixed_values: Vec<f64>,
    fix_type: FixInaccurateType,
}

impl FixInaccurateRawResult {
    fn empty() -> Self {
        Self {
            num_fixed_lines: 0,
            num_fixable_lines: 0,
            fixed_values: Vec::new(),
            fix_type: FixInaccurateType::Empty,
        }
    }

    fn into_public(
        self,
        applied: bool,
        warning: bool,
        fixed_lines: Vec<LineSegment>,
    ) -> FixInaccurateResult {
        FixInaccurateResult {
            num_fixed_lines: self.num_fixed_lines,
            num_fixable_lines: self.num_fixable_lines,
            fixed_lines,
            fix_type: self.fix_type,
            applied,
            warning,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct FixInaccurateXform {
    is_square: bool,
    in_default_square: bool,
    scale: f64,
    delta_x: f64,
    delta_y: f64,
}

fn fix_inaccurate_xform(lines: &[LineSegment]) -> FixInaccurateXform {
    let allowed_error = 0.001;
    let mut max_x = -f64::MAX;
    let mut max_y = -f64::MAX;
    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;

    for line in lines {
        min_x = min_x.min(line.a.x).min(line.b.x);
        max_x = max_x.max(line.a.x).max(line.b.x);
        min_y = min_y.min(line.a.y).min(line.b.y);
        max_y = max_y.max(line.a.y).max(line.b.y);
    }

    let is_square = ((min_y - max_y).abs() - (min_x - max_x).abs()).abs() < allowed_error;
    let in_default_square = min_x > -(200.0 + allowed_error)
        && min_y > -(200.0 + allowed_error)
        && max_x < 200.0 + allowed_error
        && max_y < 200.0 + allowed_error;
    let delta_x = min_x + (max_x - min_x).abs() / 2.0;
    let delta_y = min_y + (max_y - min_y).abs() / 2.0;
    let scale = 400.0 / (max_x - min_x).abs();

    FixInaccurateXform {
        is_square,
        in_default_square,
        scale,
        delta_x,
        delta_y,
    }
}

fn fix_inaccurate_do_xform(lines: &[LineSegment], xform: FixInaccurateXform) -> Vec<LineSegment> {
    lines
        .iter()
        .map(|line| {
            if xform.is_square && !xform.in_default_square {
                line.with_coordinates(
                    Point::new(
                        (line.a.x - xform.delta_x) * xform.scale,
                        (line.a.y - xform.delta_y) * xform.scale,
                    ),
                    Point::new(
                        (line.b.x - xform.delta_x) * xform.scale,
                        (line.b.y - xform.delta_y) * xform.scale,
                    ),
                )
            } else {
                line.clone()
            }
        })
        .collect()
}

fn fix_inaccurate_coordinates(lines: &[LineSegment]) -> Vec<f64> {
    let mut coordinates = Vec::with_capacity(lines.len() * 4);
    for line in lines {
        coordinates.push(line.a.x);
        coordinates.push(line.a.y);
        coordinates.push(line.b.x);
        coordinates.push(line.b.y);
    }
    coordinates
}

fn fix_inaccurate_values(to_fix: &[f64], options: FixInaccurateOptions) -> FixInaccurateRawResult {
    let mut results = Vec::new();

    if options.use_bp {
        results.push(fix_inaccurate_bp(to_fix));
        if results[0].num_fixable_lines as f64 > (to_fix.len() as f64 / 4.0 * 0.9) {
            return results.remove(0);
        }
    }

    if options.use_22_5 {
        let precision = options.fix_precision / 100.0;
        let fix_data = fix_inaccurate_data_22_5();
        results.push(fix_inaccurate_with_data(to_fix, precision, &fix_data));
    }

    let mut max_lines = 0usize;
    let mut return_result = FixInaccurateRawResult::empty();
    for result in results {
        if result.num_fixable_lines > max_lines {
            max_lines = result.num_fixable_lines;
            return_result = result;
        }
    }

    return_result
}

fn fix_inaccurate_bp(to_fix: &[f64]) -> FixInaccurateRawResult {
    let mut out_values = Vec::with_capacity(to_fix.len());
    let allowed_error = 0.00000000001;
    let base_precision = 0.0013;
    let grid_search_end_percent = 0.9;
    let necessary_improvement_grid = 1.15;

    let mut grid_size = 0.0;
    let mut precision = 0.0;
    let mut fixed_with_previous_best_grid = 0usize;
    let mut num_fixable_lines = 0usize;
    let mut end_grid_search = false;

    for grid_iteration in 1..=16 {
        num_fixable_lines = 0;
        let grid_size_search = match grid_iteration {
            1 => 1024.0,
            2 => 1536.0,
            3 => 1280.0,
            4 => 1792.0,
            5 => 1152.0,
            6 => 1408.0,
            7 => 1664.0,
            8 => 1920.0,
            9 => 1088.0,
            10 => 1216.0,
            11 => 1344.0,
            12 => 1472.0,
            13 => 1600.0,
            14 => 1728.0,
            15 => 1856.0,
            _ => 1984.0,
        };
        precision = (base_precision * grid_size_search) / 200.0;

        let mut is_line_fixed = false;
        for (i, value) in to_fix.iter().enumerate() {
            if i % 4 == 0 {
                is_line_fixed = false;
            }

            let current_value = value / 200.0 * grid_size_search;
            let nearest_int = current_value.round();
            if (current_value - nearest_int).abs() > precision {
                continue;
            }
            if !is_line_fixed {
                is_line_fixed = true;
                num_fixable_lines += 1;
            }
        }

        if (num_fixable_lines as f64)
            > (fixed_with_previous_best_grid as f64) * necessary_improvement_grid
        {
            grid_size = grid_size_search;
            fixed_with_previous_best_grid = num_fixable_lines;
        }

        if num_fixable_lines as f64 > (to_fix.len() as f64 / 4.0) * grid_search_end_percent {
            end_grid_search = true;
        }

        if end_grid_search {
            break;
        }
    }

    let mut is_line_fixed = false;
    let mut num_fixed_lines = 0usize;
    for (i, value) in to_fix.iter().enumerate() {
        if i % 4 == 0 {
            is_line_fixed = false;
        }

        let mut current_value = value / 200.0 * grid_size;
        let nearest_int = current_value.round();
        if (current_value - nearest_int).abs() < precision
            && (current_value - nearest_int).abs() > allowed_error
        {
            if !is_line_fixed {
                is_line_fixed = true;
                num_fixed_lines += 1;
            }
            current_value = nearest_int;
        }

        out_values.push(current_value * 200.0 / grid_size);
    }

    FixInaccurateRawResult {
        num_fixed_lines,
        num_fixable_lines,
        fixed_values: out_values,
        fix_type: FixInaccurateType::Bp,
    }
}

fn fix_inaccurate_with_data(
    input_values: &[f64],
    precision: f64,
    fix_data: &[f64],
) -> FixInaccurateRawResult {
    let mut out_values = Vec::with_capacity(input_values.len());
    let mut previous_fixed_positions = Vec::<f64>::new();
    let allowed_error = 0.00000000001;
    let mut is_line_fixed = false;
    let mut num_fixable_lines = 0usize;
    let mut num_fixed_lines = 0usize;

    for (i, value) in input_values.iter().enumerate() {
        if i % 4 == 0 {
            is_line_fixed = false;
        }

        let mut current_value = *value;
        let is_negative = current_value < 0.0;
        if is_negative {
            current_value *= -1.0;
        }

        let mut skip_slow = false;
        for fixed in &previous_fixed_positions {
            if (current_value - *fixed).abs() > precision {
                continue;
            }
            if (current_value - *fixed).abs() > allowed_error {
                current_value = *fixed;
                if !is_line_fixed {
                    is_line_fixed = true;
                    num_fixable_lines += 1;
                    num_fixed_lines += 1;
                    skip_slow = true;
                    break;
                }
            } else if !is_line_fixed {
                is_line_fixed = true;
                num_fixable_lines += 1;
                break;
            }
        }

        if !skip_slow {
            for fixed in fix_data {
                if (current_value - *fixed).abs() > precision {
                    continue;
                }
                if (current_value - *fixed).abs() > allowed_error {
                    current_value = *fixed;
                    previous_fixed_positions.push(*fixed);
                    if !is_line_fixed {
                        is_line_fixed = true;
                        num_fixable_lines += 1;
                        num_fixed_lines += 1;
                        break;
                    }
                } else if !is_line_fixed {
                    is_line_fixed = true;
                    num_fixable_lines += 1;
                    break;
                }
            }
        }

        if is_negative {
            current_value *= -1.0;
        }
        out_values.push(current_value);
    }

    FixInaccurateRawResult {
        num_fixed_lines,
        num_fixable_lines,
        fixed_values: out_values,
        fix_type: FixInaccurateType::Pure22_5,
    }
}

fn fix_inaccurate_undo_xform_values(values: Vec<f64>, xform: FixInaccurateXform) -> Vec<f64> {
    let allowed_error = 0.000000000001;
    if !xform.is_square || xform.in_default_square {
        return values;
    }

    values
        .into_iter()
        .enumerate()
        .map(|(i, value)| {
            let delta = if i % 2 == 0 {
                xform.delta_x
            } else {
                xform.delta_y
            };
            undo_xform_calc(value / xform.scale + delta, allowed_error)
        })
        .collect()
}

fn undo_xform_calc(position: f64, allowed_error: f64) -> f64 {
    let close = position.round();
    if (close - position).abs() < allowed_error {
        close
    } else {
        position
    }
}

fn fix_inaccurate_lines_from_values(templates: &[LineSegment], values: &[f64]) -> Vec<LineSegment> {
    templates
        .iter()
        .zip(values.chunks_exact(4))
        .map(|(line, coordinates)| {
            line.with_coordinates(
                Point::new(coordinates[0], coordinates[1]),
                Point::new(coordinates[2], coordinates[3]),
            )
        })
        .collect()
}

fn fix_inaccurate_data_22_5() -> Vec<f64> {
    FIX_DATA_22_5_BYTES
        .chunks_exact(8)
        .map(|chunk| {
            let mut bytes = [0u8; 8];
            bytes.copy_from_slice(chunk);
            f64::from_le_bytes(bytes)
        })
        .collect()
}

fn maekawa_color(red: usize, blue: usize) -> FlatFoldabilityColor {
    if blue == red {
        FlatFoldabilityColor::Equal
    } else if red.abs_diff(blue) > 2 {
        if blue > red {
            FlatFoldabilityColor::NotEnoughMountain
        } else {
            FlatFoldabilityColor::NotEnoughValley
        }
    } else if blue > red {
        FlatFoldabilityColor::NotEnoughValley
    } else {
        FlatFoldabilityColor::NotEnoughMountain
    }
}

fn find_flat_foldability_violation_inside(
    point: Point,
    mut nbox: SortingBox,
    arithmetic: CamvAngleArithmetic,
) -> Option<FlatFoldabilityViolation> {
    if nbox.total() % 2 == 1 {
        return Some(FlatFoldabilityViolation::new(
            point,
            FlatFoldabilityRule::NumberOfFolds,
            FlatFoldabilityColor::Unknown,
        ));
    }

    if nbox.total() == 2 {
        return match determine_line_segment_intersection_with_precision(
            nbox.value(1),
            nbox.value(2),
            Epsilon::FLAT,
        ) {
            Intersection::ParallelStartOfS1IntersectsStartOfS2_323
            | Intersection::ParallelStartOfS1IntersectsEndOfS2_333
            | Intersection::ParallelEndOfS1IntersectsEndOfS2_353
            | Intersection::ParallelEndOfS1IntersectsStartOfS2_343 => {
                if nbox.value(1).color != nbox.value(2).color {
                    Some(FlatFoldabilityViolation::new(
                        point,
                        FlatFoldabilityRule::Maekawa,
                        FlatFoldabilityColor::Unknown,
                    ))
                } else {
                    Some(FlatFoldabilityViolation::new(
                        point,
                        FlatFoldabilityRule::None,
                        FlatFoldabilityColor::Unknown,
                    ))
                }
            }
            _ => Some(FlatFoldabilityViolation::new(
                point,
                FlatFoldabilityRule::Angles,
                FlatFoldabilityColor::Unknown,
            )),
        };
    }

    if nbox.total() < 2 {
        return Some(FlatFoldabilityViolation::new(
            point,
            FlatFoldabilityRule::Angles,
            FlatFoldabilityColor::Unknown,
        ));
    }

    if !angularly_flatfoldable(&nbox) {
        return Some(FlatFoldabilityViolation::new(
            point,
            FlatFoldabilityRule::Angles,
            FlatFoldabilityColor::Unknown,
        ));
    }

    let mut max_angle = 360.0;
    let mut big_little_big = initial_big_little_big_segments(point, &nbox);

    while nbox.total() > 2 {
        let mut result = None;
        let mut min_angle = 10000.0;

        for k in 1..=nbox.total() {
            let next = if k + 1 > nbox.total() { 1 } else { k + 1 };
            let temp_angle = angle_between_0_kmax(
                angle_between_0_kmax(nbox.weight(next), max_angle)
                    - angle_between_0_kmax(nbox.weight(k), max_angle),
                max_angle,
            );
            if temp_angle < min_angle {
                min_angle = temp_angle;
            }
        }

        for _ in 1..=nbox.total() {
            let temp_angle = angle_between_0_kmax(nbox.weight(2) - nbox.weight(1), max_angle);
            if (temp_angle - min_angle).abs() < Epsilon::FLAT {
                if nbox.value(1).color != nbox.value(2).color {
                    let next_angle = nbox.weight(3);
                    let mut temp = SortingBox::default();
                    for weighted in nbox.iter() {
                        temp.add(WeightedLine {
                            weight: angle_between_0_kmax(weighted.weight - next_angle, max_angle),
                            segment: weighted.segment.clone(),
                        });
                    }

                    let mut reduced = SortingBox::default();
                    for weighted in temp.iter().skip(2) {
                        reduced.add(weighted.clone());
                    }

                    // Twice the sector actually collapsed, not twice the
                    // global minimum. Upstream writes `2.0 * min_angle`
                    // (`Check4.java:246`), and the two are the same number in
                    // exact arithmetic — the tie test above is what asserts it.
                    // But that test's window is `Epsilon::FLAT` **degrees**, and
                    // several sectors can sit inside it: on the vertex this was
                    // measured against, four lay within 8.2e-7 of each other, so
                    // four different pairs qualified and the sort order — which
                    // rotating the pattern changes — decided which one collapsed.
                    // 99.68% of that vertex's final residual came from this one
                    // substitution; 0.32% was real geometry.
                    //
                    // Subtracting the collapsed sector makes the final residual
                    // the Kawasaki alternating sum, and *any* legal merge
                    // preserves that exactly: replacing s(k-1), s(k), s(k+1) with
                    // s(k-1) - s(k) + s(k+1) leaves it unchanged. So the verdict
                    // stops depending on which pair was chosen — provably, rather
                    // than because no counter-example turned up.
                    max_angle -= 2.0
                        * match arithmetic {
                            CamvAngleArithmetic::Refined => temp_angle,
                            CamvAngleArithmetic::OrieditaExact => min_angle,
                        };
                    result = Some(reduced);
                    break;
                }

                mark_big_little_big(point, nbox.value(1), &mut big_little_big);
            }
            nbox.shift();
        }

        let next = result.unwrap_or_else(|| nbox.clone());
        if next.total() == nbox.total() {
            return Some(FlatFoldabilityViolation::big_little_big(
                point,
                big_little_big,
            ));
        }
        nbox = next;
    }

    let temp_angle = angle_between_0_kmax(
        angle_between_0_kmax(nbox.weight(1), max_angle)
            - angle_between_0_kmax(nbox.weight(2), max_angle),
        max_angle,
    );
    if (max_angle - temp_angle * 2.0).abs() < Epsilon::FLAT {
        None
    } else {
        Some(FlatFoldabilityViolation::new(
            point,
            FlatFoldabilityRule::Angles,
            FlatFoldabilityColor::Unknown,
        ))
    }
}

fn find_big_little_big_violation_on_sides(
    point: Point,
    mut nbox: SortingBox,
) -> Option<FlatFoldabilityViolation> {
    if nbox.total() < 2 {
        return Some(FlatFoldabilityViolation::new(
            point,
            FlatFoldabilityRule::Maekawa,
            FlatFoldabilityColor::Unknown,
        ));
    }

    if nbox.total() == 2 {
        if nbox.value(1).color != LineColor::Black0 || nbox.value(2).color != LineColor::Black0 {
            return Some(FlatFoldabilityViolation::new(
                point,
                FlatFoldabilityRule::Maekawa,
                FlatFoldabilityColor::Unknown,
            ));
        }
        return None;
    }

    let mut first = None;
    for i in 1..nbox.total() {
        if nbox.value(i).color == LineColor::Black0 && nbox.value(i + 1).color == LineColor::Black0
        {
            first = Some(i + 1);
        }
    }
    if nbox.value(nbox.total()).color == LineColor::Black0
        && nbox.value(1).color == LineColor::Black0
    {
        first = Some(1);
    }

    let Some(first) = first else {
        return Some(FlatFoldabilityViolation::new(
            point,
            FlatFoldabilityRule::Maekawa,
            FlatFoldabilityColor::Unknown,
        ));
    };

    for _ in 1..first {
        nbox.shift();
    }

    let base_angle = nbox.weight(1);
    let mut normalized = SortingBox::default();
    for weighted in nbox.iter() {
        normalized.add(WeightedLine {
            weight: angle_between_0_360(weighted.weight - base_angle),
            segment: weighted.segment.clone(),
        });
    }
    nbox = normalized;

    let mut big_little_big = initial_big_little_big_segments(point, &nbox);
    while nbox.total() > 2 {
        let next = big_little_big_single_step(&nbox, &mut big_little_big, point);
        if next.total() == nbox.total() {
            return Some(FlatFoldabilityViolation::big_little_big(
                point,
                big_little_big,
            ));
        }
        nbox = next;
    }

    None
}

fn big_little_big_single_step(
    nbox: &SortingBox,
    big_little_big: &mut Vec<BigLittleBigSegment>,
    point: Point,
) -> SortingBox {
    let mut min_angle = 10000.0;
    for k in 1..nbox.total() {
        let temp_angle = nbox.weight(k + 1) - nbox.weight(k);
        if temp_angle < min_angle {
            min_angle = temp_angle;
        }
    }

    let temp_angle = nbox.weight(2) - nbox.weight(1);
    if (temp_angle - min_angle).abs() < Epsilon::FLAT {
        let mut reduced = SortingBox::default();
        for weighted in nbox.iter().skip(1) {
            reduced.add(weighted.clone());
        }
        return reduced;
    }

    let temp_angle = nbox.weight(nbox.total()) - nbox.weight(nbox.total() - 1);
    if (temp_angle - min_angle).abs() < Epsilon::FLAT {
        let mut reduced = SortingBox::default();
        for weighted in nbox.iter().take(nbox.total() - 1) {
            reduced.add(weighted.clone());
        }
        return reduced;
    }

    for k in 2..=nbox.total().saturating_sub(2) {
        let temp_angle = nbox.weight(k + 1) - nbox.weight(k);
        if (temp_angle - min_angle).abs() < Epsilon::FLAT {
            if nbox.value(k).color != nbox.value(k + 1).color {
                let mut reduced = SortingBox::default();
                for weighted in nbox.iter().take(k - 1) {
                    reduced.add(weighted.clone());
                }
                for weighted in nbox.iter().skip(k + 1) {
                    reduced.add(WeightedLine {
                        weight: weighted.weight - 2.0 * min_angle,
                        segment: weighted.segment.clone(),
                    });
                }
                return reduced;
            }

            mark_big_little_big(point, nbox.value(k), big_little_big);
        }
    }

    nbox.clone()
}

fn angularly_flatfoldable(lines: &SortingBox) -> bool {
    let mut even = 0.0;
    let mut odd = 0.0;
    for k in 1..=lines.total() {
        if k % 2 == 0 {
            even += lines.weight(k) - lines.weight(k - 1);
        } else if k == 1 {
            odd += lines.weight(k) - (lines.weight(lines.total()) - 360.0);
        } else {
            odd += lines.weight(k) - lines.weight(k - 1);
        }
    }

    (even.abs() - odd.abs()).abs() < Epsilon::FLAT
}

fn initial_big_little_big_segments(point: Point, nbox: &SortingBox) -> Vec<BigLittleBigSegment> {
    nbox.iter()
        .map(|weighted| BigLittleBigSegment {
            segment: orient_big_little_big_segment(point, &weighted.segment),
            violating: false,
        })
        .collect()
}

fn mark_big_little_big(
    point: Point,
    segment: &LineSegment,
    big_little_big: &mut Vec<BigLittleBigSegment>,
) {
    let segment = orient_big_little_big_segment(point, segment);
    if let Some(entry) = big_little_big
        .iter_mut()
        .find(|entry| entry.segment == segment)
    {
        entry.violating = true;
    } else {
        big_little_big.push(BigLittleBigSegment {
            segment,
            violating: true,
        });
    }
}

fn orient_big_little_big_segment(point: Point, segment: &LineSegment) -> LineSegment {
    if segment.a.distance(point) > Epsilon::UNKNOWN_1EN6 {
        segment.with_swapped_coordinates()
    } else {
        segment.clone()
    }
}

/// One clustered vertex: where it is, the non-auxiliary segments incident to it,
/// and where each of those lives in the document.
///
/// `sources[i]` indexes `model.line_segments` for `lines[i]`. Parallel to
/// `lines` rather than zipped into it because [`find_flat_foldability_violation`]
/// consumes `lines` as a slice and is on the Oriedita-gated path: pairing them
/// would cost that path an allocation per vertex for a field it never reads.
///
/// The spatial half of `CheckCamv` needs the provenance, because a solved fold
/// angle has to be written back to a named crease — and because building its own
/// fan by re-scanning the document would cluster at its own epsilon and see a
/// *different* fan than the one being reported on.
pub(crate) struct VertexIncidence {
    pub point: Point,
    pub lines: Vec<LineSegment>,
    pub sources: Vec<usize>,
}

pub(crate) fn point_line_map(model: &CreasePatternModel) -> Vec<VertexIncidence> {
    let eps = Epsilon::UNKNOWN_1EN4;
    let eps_squared = eps * eps;
    let mut map = Vec::<VertexIncidence>::new();
    // Spatial hash keyed by eps-sized cells, so each endpoint is matched only
    // against the points in its 3x3 cell neighbourhood — O(edges) instead of the
    // old O(edges * vertices) linear scan (which hung CheckCamv for ~0.85s on a
    // 52k-edge document). Cell size == eps guarantees any two points within eps
    // share a cell or an adjacent one.
    let mut cells: HashMap<(i64, i64), Vec<usize>> = HashMap::new();

    for (index, segment) in model.line_segments.iter().enumerate() {
        if segment.color != LineColor::Cyan3 {
            point_line_map_process(
                &mut map,
                &mut cells,
                segment.a,
                segment,
                index,
                eps,
                eps_squared,
            );
            point_line_map_process(
                &mut map,
                &mut cells,
                segment.b,
                segment,
                index,
                eps,
                eps_squared,
            );
        }
    }

    map
}

fn point_cell(point: Point, eps: f64) -> (i64, i64) {
    (
        (point.x / eps).floor() as i64,
        (point.y / eps).floor() as i64,
    )
}

#[allow(clippy::too_many_arguments)]
fn point_line_map_process(
    map: &mut Vec<VertexIncidence>,
    cells: &mut HashMap<(i64, i64), Vec<usize>>,
    point: Point,
    segment: &LineSegment,
    source: usize,
    eps: f64,
    eps_squared: f64,
) {
    let (cx, cy) = point_cell(point, eps);
    // Take the lowest-index group within eps across the neighbourhood, which
    // reproduces the original `iter().find()` insertion-order "first match" exactly.
    let mut best: Option<usize> = None;
    for dx in -1..=1 {
        for dy in -1..=1 {
            if let Some(indices) = cells.get(&(cx + dx, cy + dy)) {
                for &index in indices {
                    if map[index].point.distance_squared(point) < eps_squared {
                        best = Some(best.map_or(index, |b| b.min(index)));
                    }
                }
            }
        }
    }

    if let Some(index) = best {
        map[index].lines.push(segment.clone());
        map[index].sources.push(source);
    } else {
        let index = map.len();
        map.push(VertexIncidence {
            point,
            lines: vec![segment.clone()],
            sources: vec![source],
        });
        cells.entry((cx, cy)).or_default().push(index);
    }
}

fn check1_intersection_matches(intersection: Intersection) -> bool {
    matches!(
        intersection,
        Intersection::ParallelEqual31
            | Intersection::ParallelStartOfS1ContainsStartOfS2_321
            | Intersection::ParallelStartOfS2ContainsStartOfS1_322
            | Intersection::ParallelStartOfS1ContainsEndOfS2_331
            | Intersection::ParallelEndOfS2ContainsStartOfS1_332
            | Intersection::ParallelEndOfS1ContainsStartOfS2_341
            | Intersection::ParallelStartOfS2ContainsEndOfS1_342
            | Intersection::ParallelEndOfS1ContainsEndOfS2_351
            | Intersection::ParallelEndOfS2ContainsEndOfS1_352
    )
}

fn vertex_surrounding_line_count(
    model: &CreasePatternModel,
    point: Point,
    radius: f64,
    predicate: impl Fn(&LineSegment) -> bool,
) -> usize {
    let q = closest_point(model, point);
    let radius_squared = radius * radius;

    model
        .line_segments
        .iter()
        .filter(|segment| {
            let endpoint = if q.distance_squared(segment.b) < q.distance_squared(segment.a) {
                segment.b
            } else {
                segment.a
            };
            q.distance_squared(endpoint) < radius_squared && predicate(segment)
        })
        .count()
}

fn extended_fushimi_decide_inside_model(
    model: &CreasePatternModel,
    point: Point,
    arithmetic: CamvAngleArithmetic,
) -> bool {
    let vertex = closest_point_of_fold_line(model, point);
    let nbox = vertex_sorting_box(model, vertex, arithmetic);
    extended_fushimi_decide_inside(nbox, arithmetic)
}

fn extended_fushimi_decide_inside(mut nbox: SortingBox, arithmetic: CamvAngleArithmetic) -> bool {
    if nbox.total() % 2 == 1 {
        return false;
    }
    if nbox.total() < 2 {
        return false;
    }

    if nbox.total() == 2 {
        if nbox.value(1).color != nbox.value(2).color {
            return false;
        }

        return matches!(
            determine_line_segment_intersection_with_precision(
                nbox.value(1),
                nbox.value(2),
                Epsilon::FLAT
            ),
            Intersection::ParallelStartOfS1IntersectsStartOfS2_323
                | Intersection::ParallelStartOfS1IntersectsEndOfS2_333
                | Intersection::ParallelEndOfS1IntersectsEndOfS2_353
                | Intersection::ParallelEndOfS1IntersectsStartOfS2_343
        );
    }

    let mut max_angle = 360.0;
    while nbox.total() > 2 {
        let mut result = None;
        let mut min_angle = 10000.0;

        for k in 1..=nbox.total() {
            let current = k;
            let next = if k + 1 > nbox.total() { 1 } else { k + 1 };
            let temp_angle = angle_between_0_kmax(
                angle_between_0_kmax(nbox.weight(next), max_angle)
                    - angle_between_0_kmax(nbox.weight(current), max_angle),
                max_angle,
            );
            if temp_angle < min_angle {
                min_angle = temp_angle;
            }
        }

        for _ in 1..=nbox.total() {
            let temp_angle = angle_between_0_kmax(nbox.weight(2) - nbox.weight(1), max_angle);
            if (temp_angle - min_angle).abs() < Epsilon::FLAT
                && nbox.value(1).color != nbox.value(2).color
            {
                let base_angle = nbox.weight(3);
                let mut temp = SortingBox::default();
                for weighted in nbox.iter() {
                    temp.add(WeightedLine {
                        weight: angle_between_0_kmax(weighted.weight - base_angle, max_angle),
                        segment: weighted.segment.clone(),
                    });
                }

                let mut reduced = SortingBox::default();
                for weighted in temp.iter().skip(2) {
                    reduced.add(weighted.clone());
                }

                // The Check4 twin of the same substitution; see the comment
                // there for why the collapsed sector is the right one.
                max_angle -= 2.0
                    * match arithmetic {
                        CamvAngleArithmetic::Refined => temp_angle,
                        CamvAngleArithmetic::OrieditaExact => min_angle,
                    };
                result = Some(reduced);
                break;
            }
            nbox.shift();
        }

        let next = result.unwrap_or_else(|| nbox.clone());
        if next.total() == nbox.total() {
            return false;
        }
        nbox = next;
    }

    let temp_angle = angle_between_0_kmax(
        angle_between_0_kmax(nbox.weight(1), max_angle)
            - angle_between_0_kmax(nbox.weight(2), max_angle),
        max_angle,
    );
    (max_angle - temp_angle * 2.0).abs() < Epsilon::FLAT
}

fn extended_fushimi_decide_sides_model(
    model: &CreasePatternModel,
    point: Point,
    arithmetic: CamvAngleArithmetic,
) -> bool {
    let vertex = closest_point_of_fold_line(model, point);
    let nbox = vertex_sorting_box(model, vertex, arithmetic);
    extended_fushimi_decide_sides(nbox, arithmetic)
}

fn extended_fushimi_decide_sides(mut nbox: SortingBox, arithmetic: CamvAngleArithmetic) -> bool {
    if nbox.total() < 2 {
        return false;
    }

    if nbox.total() == 2 {
        if nbox.value(1).color != LineColor::Black0 {
            return false;
        }
        return nbox.value(2).color == LineColor::Black0;
    }

    let mut first = None;
    for i in 1..nbox.total() {
        if nbox.value(i).color == LineColor::Black0 && nbox.value(i + 1).color == LineColor::Black0
        {
            first = Some(i + 1);
        }
    }
    if nbox.total() > 0
        && nbox.value(nbox.total()).color == LineColor::Black0
        && nbox.value(1).color == LineColor::Black0
    {
        first = Some(1);
    }

    let Some(first) = first else {
        return false;
    };

    for _ in 1..first {
        nbox.shift();
    }

    let base_angle = nbox.weight(1);
    let mut normalized = SortingBox::default();
    for weighted in nbox.iter() {
        normalized.add(WeightedLine {
            weight: angle_between_0_360(weighted.weight - base_angle),
            segment: weighted.segment.clone(),
        });
    }
    nbox = normalized;

    while nbox.total() > 2 {
        let next = extended_fushimi_determine_sides_theorem(&nbox);
        if next.total() == nbox.total() {
            return false;
        }
        nbox = next;
    }

    true
}

fn extended_fushimi_determine_sides_theorem(nbox: &SortingBox) -> SortingBox {
    let mut min_angle = 10000.0;
    for k in 1..nbox.total() {
        let temp_angle = nbox.weight(k + 1) - nbox.weight(k);
        if temp_angle < min_angle {
            min_angle = temp_angle;
        }
    }

    let temp_angle = nbox.weight(2) - nbox.weight(1);
    if (temp_angle - min_angle).abs() < Epsilon::FLAT {
        let mut reduced = SortingBox::default();
        for weighted in nbox.iter().skip(1) {
            reduced.add(weighted.clone());
        }
        return reduced;
    }

    let temp_angle = nbox.weight(nbox.total()) - nbox.weight(nbox.total() - 1);
    if (temp_angle - min_angle).abs() < Epsilon::FLAT {
        let mut reduced = SortingBox::default();
        for weighted in nbox.iter().take(nbox.total() - 1) {
            reduced.add(weighted.clone());
        }
        return reduced;
    }

    for k in 2..=nbox.total().saturating_sub(2) {
        let temp_angle = nbox.weight(k + 1) - nbox.weight(k);
        if (temp_angle - min_angle).abs() < Epsilon::FLAT
            && nbox.value(k).color != nbox.value(k + 1).color
        {
            let mut reduced = SortingBox::default();
            for weighted in nbox.iter().take(k - 1) {
                reduced.add(weighted.clone());
            }
            for weighted in nbox.iter().skip(k + 1) {
                reduced.add(WeightedLine {
                    weight: weighted.weight - 2.0 * min_angle,
                    segment: weighted.segment.clone(),
                });
            }
            return reduced;
        }
    }

    nbox.clone()
}

fn vertex_sorting_box(
    model: &CreasePatternModel,
    vertex: Point,
    arithmetic: CamvAngleArithmetic,
) -> SortingBox {
    let mut nbox = SortingBox::default();
    for segment in &model.line_segments {
        if segment.color.is_folding_line() {
            if vertex.distance(segment.a) < Epsilon::FLAT {
                nbox.add_by_weight(
                    segment.clone(),
                    fan_bearing(segment.a, segment.b, arithmetic),
                );
            } else if vertex.distance(segment.b) < Epsilon::FLAT {
                nbox.add_by_weight(
                    segment.clone(),
                    fan_bearing(segment.b, segment.a, arithmetic),
                );
            }
        }
    }
    nbox
}

fn closest_point(model: &CreasePatternModel, point: Point) -> Point {
    let mut closest = Point::new(100000.0, 100000.0);
    for segment in &model.line_segments {
        if point.distance_squared(segment.a) < point.distance_squared(closest) {
            closest = segment.a;
        }
        if point.distance_squared(segment.b) < point.distance_squared(closest) {
            closest = segment.b;
        }
    }
    closest
}

fn closest_point_of_fold_line(model: &CreasePatternModel, point: Point) -> Point {
    let mut closest = Point::new(100000.0, 100000.0);
    for segment in &model.line_segments {
        if segment.color.is_folding_line() {
            if point.distance_squared(segment.a) < point.distance_squared(closest) {
                closest = segment.a;
            }
            if point.distance_squared(segment.b) < point.distance_squared(closest) {
                closest = segment.b;
            }
        }
    }
    closest
}

#[derive(Debug, Clone)]
struct WeightedLine {
    segment: LineSegment,
    weight: f64,
}

#[derive(Debug, Clone, Default)]
struct SortingBox {
    values: Vec<WeightedLine>,
}

impl SortingBox {
    fn total(&self) -> usize {
        self.values.len()
    }

    fn add(&mut self, value: WeightedLine) {
        self.values.push(value);
    }

    fn add_by_weight(&mut self, segment: LineSegment, weight: f64) {
        let value = WeightedLine { segment, weight };
        for index in 0..self.values.len() {
            if value.weight < self.values[index].weight {
                self.values.insert(index, value);
                return;
            }
        }
        self.values.push(value);
    }

    fn shift(&mut self) {
        if !self.values.is_empty() {
            self.values.rotate_left(1);
        }
    }

    fn iter(&self) -> impl Iterator<Item = &WeightedLine> {
        self.values.iter()
    }

    fn value(&self, one_based: usize) -> &LineSegment {
        &self.values[one_based - 1].segment
    }

    fn weight(&self, one_based: usize) -> f64 {
        self.values[one_based - 1].weight
    }
}

fn flat_foldable_boundary_color(crossings: &[LineSegment]) -> LineColor {
    if !crossings.len().is_multiple_of(2) {
        return LineColor::Magenta5;
    }
    if crossings.is_empty() {
        return LineColor::Cyan3;
    }

    let mut moved = crossings[0].clone();
    for crossing in crossings.iter().skip(1) {
        moved = find_line_symmetry_line_segment(&moved, crossing);
    }

    if equal_with_radius(crossings[0].a, moved.a, Epsilon::UNKNOWN_1EN4)
        && equal_with_radius(crossings[0].b, moved.b, Epsilon::UNKNOWN_1EN4)
    {
        LineColor::Cyan3
    } else {
        LineColor::Magenta5
    }
}
