//! Editable crease-pattern model carriers ported from Oriedita save/model data.

use crate::ORIEDITA_PAPER_SIZE;
use crate::canonical::CanonicalCreasePattern;
use crate::geometry::{
    ActiveState, Circle, Epsilon, FoldMagnitude, LineColor, LineSegment, Point, RgbColor,
};
use serde::{Deserialize, Serialize};
use std::fmt;
use treemaker_fold::Assignment;

/// Half the Oriedita paper, which is where the grid lattice is anchored
/// (upstream's `okx0`/`oky0`, and the bound `isWithinPaper` tests).
const ORIEDITA_PAPER_HALF: f64 = ORIEDITA_PAPER_SIZE / 2.0;

/// Widest lattice-index window a close-point search will scan. A real cell puts
/// this at 4 or so; anything larger came from a non-finite pointer.
const MAX_GRID_SCAN_SPAN: i64 = 64;

/// One-based Oriedita line identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct LineId(pub usize);

/// Zero-based circle identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct CircleId(pub usize);

/// Zero-based text identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct TextId(pub usize);

/// Zero-based point identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct PointId(pub usize);

/// Oriedita custom line type selector.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CustomLineType {
    Any = -1,
    Edge = 0,
    MountainAndValley = 1,
    Mountain = 2,
    Valley = 3,
    Aux = 4,
}

impl CustomLineType {
    pub const fn number(self) -> i32 {
        self as i32
    }

    pub const fn number_for_line_color(self) -> i32 {
        match self {
            Self::Any | Self::Edge => Self::Edge as i32,
            _ => self.number() - 1,
        }
    }

    pub const fn line_color(self) -> LineColor {
        match self {
            Self::Any | Self::Edge => LineColor::Black0,
            Self::MountainAndValley | Self::Mountain => LineColor::Red1,
            Self::Valley => LineColor::Blue2,
            Self::Aux => LineColor::Cyan3,
        }
    }

    pub const fn matches(self, line_color: LineColor) -> bool {
        match self {
            Self::Any => true,
            Self::Edge => matches!(line_color, LineColor::Black0),
            Self::MountainAndValley => matches!(line_color, LineColor::Red1 | LineColor::Blue2),
            Self::Mountain => matches!(line_color, LineColor::Red1),
            Self::Valley => matches!(line_color, LineColor::Blue2),
            Self::Aux => matches!(line_color, LineColor::Cyan3),
        }
    }

    pub fn from_number(number: i32) -> Result<Self, ModelError> {
        match number {
            -1 => Ok(Self::Any),
            0 => Ok(Self::Edge),
            1 => Ok(Self::MountainAndValley),
            2 => Ok(Self::Mountain),
            3 => Ok(Self::Valley),
            4 => Ok(Self::Aux),
            _ => Err(ModelError::UnknownCustomLineType(number)),
        }
    }
}

/// Grid display/storage state used in Oriedita FOLD extensions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub enum GridState {
    Hidden = 0,
    #[default]
    WithinPaper = 1,
    Full = 2,
}

impl GridState {
    pub const fn state(self) -> i32 {
        self as i32
    }

    pub fn from_state(state: i32) -> Result<Self, ModelError> {
        match state {
            0 => Ok(Self::Hidden),
            1 => Ok(Self::WithinPaper),
            2 => Ok(Self::Full),
            _ => Err(ModelError::UnknownGridState(state)),
        }
    }

    pub const fn advance(self) -> Self {
        match self {
            Self::Hidden => Self::WithinPaper,
            Self::WithinPaper => Self::Full,
            Self::Full => Self::Hidden,
        }
    }
}

impl fmt::Display for GridState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.state())
    }
}

/// Oriedita grid metadata that affects save files and FOLD extras.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GridMetadata {
    pub interval_grid_size: i32,
    pub grid_size: i32,
    pub grid_xa: f64,
    pub grid_xb: f64,
    pub grid_xc: f64,
    pub grid_ya: f64,
    pub grid_yb: f64,
    pub grid_yc: f64,
    pub grid_angle: f64,
    pub base_state: GridState,
    pub vertical_scale_position: i32,
    pub horizontal_scale_position: i32,
    pub draw_diagonal_gridlines: bool,
}

impl GridMetadata {
    pub fn reset() -> Self {
        Self::default()
    }

    pub fn set_grid_size(&mut self, grid_size: i32) {
        self.grid_size = grid_size.max(1);
    }

    pub fn set_interval_grid_size(&mut self, interval_grid_size: i32) {
        self.interval_grid_size = interval_grid_size.max(1);
    }

    pub fn set_grid_angle(&mut self, grid_angle: f64) {
        self.grid_angle = grid_angle.clamp(
            Epsilon::GRID_ANGLE_THRESHOLD,
            180.0 - Epsilon::GRID_ANGLE_THRESHOLD,
        );
    }

    pub fn apply_grid_x(&mut self, grid_xa: f64, grid_xb: f64, grid_xc: f64) {
        if validate_grid(grid_xa, grid_xb, grid_xc) {
            self.grid_xa = grid_xa;
            self.grid_xb = grid_xb;
            self.grid_xc = grid_xc;
        } else {
            self.reset_grid_x();
        }
    }

    pub fn apply_grid_y(&mut self, grid_ya: f64, grid_yb: f64, grid_yc: f64) {
        if validate_grid(grid_ya, grid_yb, grid_yc) {
            self.grid_ya = grid_ya;
            self.grid_yb = grid_yb;
            self.grid_yc = grid_yc;
        } else {
            self.reset_grid_y();
        }
    }

    pub fn determine_grid_x_length(self) -> f64 {
        self.grid_xa + self.grid_xb * self.grid_xc.sqrt()
    }

    pub fn determine_grid_y_length(self) -> f64 {
        self.grid_ya + self.grid_yb * self.grid_yc.sqrt()
    }

    pub fn reset_grid_x(&mut self) {
        self.grid_xa = 1.0;
        self.grid_xb = 0.0;
        self.grid_xc = 1.0;
    }

    pub fn reset_grid_y(&mut self) {
        self.grid_ya = 1.0;
        self.grid_yb = 0.0;
        self.grid_yc = 1.0;
    }

    pub fn change_horizontal_scale_position(&mut self) {
        let next = self.horizontal_scale_position + 1;
        self.horizontal_scale_position = if next >= self.interval_grid_size {
            0
        } else {
            next
        };
    }

    pub fn change_vertical_scale_position(&mut self) {
        let next = self.vertical_scale_position + 1;
        self.vertical_scale_position = if next >= self.interval_grid_size {
            0
        } else {
            next
        };
    }

    /// Oriedita `Grid.calculateGrid`: the unit cell this metadata describes.
    ///
    /// `None` when the cell is degenerate — a zero-length axis or two parallel
    /// axes have no lattice to search. Upstream cannot reach that state
    /// (`GridModel` validates the lengths and clamps the angle to 1..179), so
    /// there is no upstream behaviour to match; refusing is how a file that
    /// carries one anyway stays harmless.
    fn cell(self) -> Option<GridCell> {
        let grid_size = self.grid_size;
        if grid_size <= 0 {
            return None;
        }
        let grid_width = ORIEDITA_PAPER_SIZE / f64::from(grid_size);
        // Oriedita negates the configured angle when it stores it (`setGrid`).
        let radians = (-self.grid_angle).to_radians();
        let a = Point::new(grid_width * self.determine_grid_x_length(), 0.0);
        let b = Point::new(
            grid_width * self.determine_grid_y_length() * radians.cos(),
            grid_width * self.determine_grid_y_length() * radians.sin(),
        );
        if (a.x * b.y - b.x * a.y).abs() <= Epsilon::UNKNOWN_1EN6 {
            return None;
        }
        let origin = Point::new(-ORIEDITA_PAPER_HALF, ORIEDITA_PAPER_HALF);
        // The cell's two diagonals, longer first.
        let corner_to_corner = Point::new(0.0, 0.0).distance(Point::new(a.x + b.x, a.y + b.y));
        let across = a.distance(b);
        Some(GridCell {
            origin,
            a,
            b,
            diagonal_max: corner_to_corner.max(across),
        })
    }

    /// Oriedita `Grid.resetGrid`: a within-paper grid whose cell is not the unit
    /// square covers the whole plane instead. The paper bound only makes sense
    /// for the plain square grid it was written for.
    pub fn effective_base_state(self, state: GridState) -> GridState {
        if state != GridState::WithinPaper {
            return state;
        }
        let square = (self.determine_grid_x_length() - 1.0).abs() <= Epsilon::UNKNOWN_1EN6
            && (self.determine_grid_y_length() - 1.0).abs() <= Epsilon::UNKNOWN_1EN6
            && (self.grid_angle - 90.0).abs() <= Epsilon::UNKNOWN_1EN6;
        if square {
            GridState::WithinPaper
        } else {
            GridState::Full
        }
    }

    /// Oriedita `Grid.closestGridPoint`: the nearest lattice point to `point`
    /// under `state`, which the caller supplies so a UI snapping setting can
    /// suppress the grid without touching the document.
    ///
    /// Two upstream results are preserved deliberately. The search window is
    /// the cell's long diagonal, so a lattice point farther than that is not a
    /// candidate; and when nothing qualifies — only reachable outside the paper
    /// under [`GridState::WithinPaper`] — upstream's uninitialised `Point`
    /// falls out as the **origin**, not as "no answer". Callers gate the result
    /// on their selection distance, which is what makes that harmless.
    pub fn closest_grid_point(self, point: Point, state: GridState) -> Point {
        let state = self.effective_base_state(state);
        if state == GridState::Hidden || !point.x.is_finite() || !point.y.is_finite() {
            return Point::new(0.0, 0.0);
        }
        let Some(cell) = self.cell() else {
            return Point::new(0.0, 0.0);
        };

        let reach = cell.diagonal_max;
        let corners = [
            Point::new(point.x - reach, point.y - reach),
            Point::new(point.x - reach, point.y + reach),
            Point::new(point.x + reach, point.y + reach),
            Point::new(point.x + reach, point.y - reach),
        ];
        let indices = corners.map(|corner| cell.index_of(corner));
        let (a_min, a_max) = index_span(indices.map(|index| index.x));
        let (b_min, b_max) = index_span(indices.map(|index| index.y));
        // A window this wide means a pointer far outside any coordinate the
        // editor can reach, not a real search.
        if a_max.saturating_sub(a_min) > MAX_GRID_SCAN_SPAN
            || b_max.saturating_sub(b_min) > MAX_GRID_SCAN_SPAN
        {
            return Point::new(0.0, 0.0);
        }

        let mut closest = Point::new(0.0, 0.0);
        let mut closest_distance = reach;
        for i in a_min..=a_max {
            for j in b_min..=b_max {
                let candidate = cell.point_at(i, j);
                if state == GridState::WithinPaper && !within_paper(candidate) {
                    continue;
                }
                let distance = point.distance(candidate);
                if distance <= closest_distance {
                    closest_distance = distance;
                    closest = candidate;
                }
            }
        }
        closest
    }
}

/// Oriedita `Grid`'s derived unit cell: the lattice origin and its two edge
/// vectors, plus the long diagonal that bounds every search.
#[derive(Debug, Clone, Copy)]
struct GridCell {
    origin: Point,
    a: Point,
    b: Point,
    diagonal_max: f64,
}

impl GridCell {
    fn point_at(self, a_index: i64, b_index: i64) -> Point {
        let (i, j) = (a_index as f64, b_index as f64);
        Point::new(
            self.origin.x + self.a.x * i + self.b.x * j,
            self.origin.y + self.a.y * i + self.b.y * j,
        )
    }

    /// Oriedita `Grid.getPosition`: fractional lattice indices, by the inverse
    /// of the cell basis.
    fn index_of(self, point: Point) -> Point {
        let determinant = self.a.x * self.b.y - self.b.x * self.a.y;
        let x = point.x - self.origin.x;
        let y = point.y - self.origin.y;
        Point::new(
            (self.b.y * x - self.b.x * y) / determinant,
            (-self.a.y * x + self.a.x * y) / determinant,
        )
    }
}

fn index_span(values: [f64; 4]) -> (i64, i64) {
    let min = values.iter().copied().fold(f64::INFINITY, f64::min);
    let max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    (min.floor() as i64, max.ceil() as i64)
}

fn within_paper(point: Point) -> bool {
    let min = -ORIEDITA_PAPER_HALF - Epsilon::UNKNOWN_1EN6;
    let max = ORIEDITA_PAPER_HALF + Epsilon::UNKNOWN_1EN6;
    point.x >= min && point.x <= max && point.y >= min && point.y <= max
}

/// Which points a kernel-side snap may land on.
///
/// Oriedita gates its close-point search on grid *visibility* alone; Ori Studio
/// has a Snapping toggle as well, and the frontend collapses both into this so
/// the kernel and the canvas snap by one policy rather than two.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapCandidates {
    /// Grid state to search, [`GridState::Hidden`] for "no grid points".
    pub grid: GridState,
    /// Whether crease endpoints and circle centres are candidates.
    pub vertices: bool,
}

impl SnapCandidates {
    /// What upstream searches: every vertex, and the grid the document declares.
    pub fn upstream(grid: &GridMetadata) -> Self {
        Self {
            grid: grid.base_state,
            vertices: true,
        }
    }
}

/// How a kernel-side snap searches: how far it may reach, and what it may land
/// on. Upstream reads the reach from the camera (`getSelectionDistance`) and the
/// candidates from the grid state; both arrive from the caller here.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SnapPolicy {
    pub selection_distance: f64,
    pub candidates: SnapCandidates,
}

impl Default for GridMetadata {
    fn default() -> Self {
        Self {
            interval_grid_size: 4,
            grid_size: 8,
            grid_xa: 1.0,
            grid_xb: 0.0,
            grid_xc: 1.0,
            grid_ya: 1.0,
            grid_yb: 0.0,
            grid_yc: 1.0,
            grid_angle: 90.0,
            base_state: GridState::WithinPaper,
            vertical_scale_position: 0,
            horizontal_scale_position: 0,
            draw_diagonal_gridlines: false,
        }
    }
}

fn validate_grid(a: f64, b: f64, c: f64) -> bool {
    let grid_length = a + b * c.sqrt();
    grid_length >= 0.0 && grid_length.abs() >= Epsilon::UNKNOWN_1EN4
}

/// Oriedita text annotation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextElement {
    pub x: QuantizedFloat,
    pub y: QuantizedFloat,
    pub text: String,
}

impl TextElement {
    pub fn new(x: f64, y: f64, text: impl Into<String>) -> Self {
        Self {
            x: QuantizedFloat(x),
            y: QuantizedFloat(y),
            text: text.into(),
        }
    }

    pub fn position(&self) -> Point {
        Point::new(self.x.0, self.y.0)
    }
}

/// Float wrapper with Java-style exact equality semantics.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct QuantizedFloat(pub f64);

impl PartialEq for QuantizedFloat {
    fn eq(&self, other: &Self) -> bool {
        self.0.total_cmp(&other.0).is_eq()
    }
}

impl Eq for QuantizedFloat {}

/// Oriedita-compatible save/model carrier.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct CreasePatternModel {
    #[serde(default)]
    pub line_segments: Vec<LineSegment>,
    #[serde(default)]
    pub circles: Vec<Circle>,
    #[serde(default)]
    pub points: Vec<Point>,
    #[serde(default)]
    pub aux_line_segments: Vec<LineSegment>,
    #[serde(default)]
    pub texts: Vec<TextElement>,
    #[serde(default)]
    pub grid: GridMetadata,
    /// The active crease angle a drawing command gives the creases it creates.
    ///
    /// **Command-scoped, and not part of the model.** It is `None` at rest, set
    /// only by the guard in `execute_command` for the duration of one command,
    /// and read only by
    /// [`crate::operations::arrangement::add_line_segment_like_worker`]. Because
    /// it is always `None` outside a command, the derived `PartialEq` stays
    /// honest for parity comparisons and `#[serde(skip)]` costs nothing.
    ///
    /// `pub` like every other field, which costs nothing here: `execute_command`
    /// overwrites the pen before it dispatches, so a value set from outside is
    /// never observed by an operation. Keeping it public also keeps
    /// `..Default::default()` working for callers building a model literal, and
    /// keeps `share::v1`'s exhaustive destructure — the guard that stops a new
    /// model field being silently dropped from a share link — compiling, so the
    /// decision for this field is recorded there rather than hidden behind `..`.
    #[serde(skip)]
    pub pen_fold_magnitude: Option<FoldMagnitude>,
}

impl CreasePatternModel {
    pub fn total(&self) -> usize {
        self.line_segments.len()
    }

    pub fn is_empty(&self) -> bool {
        self.line_segments.is_empty()
            && self.circles.is_empty()
            && self.points.is_empty()
            && self.aux_line_segments.is_empty()
            && self.texts.is_empty()
    }

    pub fn line_ids(&self) -> impl Iterator<Item = LineId> + '_ {
        (1..=self.line_segments.len()).map(LineId)
    }

    pub fn circle_ids(&self) -> impl Iterator<Item = CircleId> + '_ {
        (0..self.circles.len()).map(CircleId)
    }

    pub fn text_ids(&self) -> impl Iterator<Item = TextId> + '_ {
        (0..self.texts.len()).map(TextId)
    }

    pub fn point_ids(&self) -> impl Iterator<Item = PointId> + '_ {
        (0..self.points.len()).map(PointId)
    }

    pub fn get_one_based(&self, index: usize) -> Option<&LineSegment> {
        index
            .checked_sub(1)
            .and_then(|zero_based| self.line_segments.get(zero_based))
    }

    pub fn get_one_based_mut(&mut self, index: usize) -> Option<&mut LineSegment> {
        index
            .checked_sub(1)
            .and_then(|zero_based| self.line_segments.get_mut(zero_based))
    }

    pub fn add_line(&mut self, a: Point, b: Point, color: LineColor) -> LineId {
        self.add_line_segment(LineSegment::with_color(a, b, color))
    }

    pub fn add_line_with_active(
        &mut self,
        a: Point,
        b: Point,
        color: LineColor,
        active: ActiveState,
    ) -> LineId {
        self.add_line_segment(LineSegment::with_color_and_active(a, b, color, active))
    }

    pub fn add_line_segment(&mut self, line_segment: LineSegment) -> LineId {
        self.line_segments.push(line_segment);
        LineId(self.line_segments.len())
    }

    pub fn add_aux_line_segment(&mut self, line_segment: LineSegment) {
        self.aux_line_segments.push(line_segment);
    }

    pub fn add_circle(&mut self, circle: Circle) -> CircleId {
        self.circles.push(circle);
        CircleId(self.circles.len() - 1)
    }

    pub fn add_point(&mut self, point: Point) -> PointId {
        self.points.push(point);
        PointId(self.points.len() - 1)
    }

    pub fn add_text(&mut self, text: TextElement) -> TextId {
        self.texts.push(text);
        TextId(self.texts.len() - 1)
    }

    pub fn delete_line_one_based(&mut self, index: usize) -> Option<LineSegment> {
        index
            .checked_sub(1)
            .filter(|zero_based| *zero_based < self.line_segments.len())
            .map(|zero_based| self.line_segments.remove(zero_based))
    }

    pub fn set_color_one_based(
        &mut self,
        index: usize,
        color: LineColor,
    ) -> Result<(), ModelError> {
        let segment = self
            .get_one_based_mut(index)
            .ok_or(ModelError::LineIndexOutOfBounds { index })?;
        *segment = segment.with_line_color(color);
        Ok(())
    }

    pub fn is_selection_empty(&self) -> bool {
        self.line_segments
            .iter()
            .all(|segment| segment.selected != 2)
    }

    pub fn fold_line_total_for_select_folding(&self) -> usize {
        self.line_segments
            .iter()
            .filter(|segment| segment.color.is_folding_line() && segment.selected == 2)
            .count()
    }

    pub fn save_for_select_folding(&self) -> LineSegmentSaveData {
        LineSegmentSaveData {
            line_segments: self
                .line_segments
                .iter()
                .filter(|segment| segment.color.is_folding_line() && segment.selected == 2)
                .cloned()
                .collect(),
            ..LineSegmentSaveData::default()
        }
    }

    pub fn set_save(&mut self, save: &LineSegmentSaveData) -> Option<String> {
        self.circles.clone_from(&save.circles);
        self.line_segments.clone_from(&save.line_segments);
        save.title.clone()
    }

    pub fn set_aux_save(&mut self, save: &LineSegmentSaveData) {
        self.aux_line_segments.clone_from(&save.aux_line_segments);
    }

    pub fn add_save(&mut self, save: &LineSegmentSaveData) {
        self.line_segments
            .extend(save.line_segments.iter().cloned());
        self.circles.extend(save.circles.iter().cloned());
        self.aux_line_segments
            .extend(save.aux_line_segments.iter().cloned());
        self.points.extend(save.points.iter().copied());
        self.texts.extend(save.texts.iter().cloned());
    }

    pub fn to_save(&self, title: Option<String>) -> LineSegmentSaveData {
        LineSegmentSaveData {
            title,
            line_segments: self.line_segments.clone(),
            circles: self.circles.clone(),
            aux_line_segments: self.aux_line_segments.clone(),
            points: self.points.clone(),
            texts: self.texts.clone(),
            grid: self.grid,
        }
    }

    pub fn can_save_as_cp(&self) -> bool {
        self.circles.is_empty() && self.aux_line_segments.is_empty() && self.texts.is_empty()
    }

    pub fn canonical(&self, tolerance: f64) -> CanonicalCreasePattern {
        CanonicalCreasePattern::from_model(None, self, tolerance)
    }
}

/// Save DTO matching Oriedita `LineSegmentSave`, `PointSave`, and `TextSave`
/// storage fields.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct LineSegmentSaveData {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default)]
    pub line_segments: Vec<LineSegment>,
    #[serde(default)]
    pub circles: Vec<Circle>,
    #[serde(default)]
    pub aux_line_segments: Vec<LineSegment>,
    #[serde(default)]
    pub points: Vec<Point>,
    #[serde(default)]
    pub texts: Vec<TextElement>,
    #[serde(default)]
    pub grid: GridMetadata,
}

impl LineSegmentSaveData {
    pub fn can_save_as_cp(&self) -> bool {
        self.circles.is_empty() && self.aux_line_segments.is_empty() && self.texts.is_empty()
    }
}

pub fn fold_assignment_for_line_color(line_color: LineColor) -> Assignment {
    match line_color {
        LineColor::Black0 => Assignment::Boundary,
        LineColor::Red1 => Assignment::Mountain,
        LineColor::Blue2 => Assignment::Valley,
        LineColor::Cyan3
        | LineColor::Orange4
        | LineColor::Magenta5
        | LineColor::Green6
        | LineColor::Yellow7
        | LineColor::Purple8
        | LineColor::Other9
        | LineColor::Grey10 => Assignment::Flat,
        _ => Assignment::Unassigned,
    }
}

pub fn line_color_for_fold_assignment(assignment: Assignment) -> LineColor {
    match assignment {
        Assignment::Boundary => LineColor::Black0,
        Assignment::Mountain => LineColor::Red1,
        Assignment::Valley => LineColor::Blue2,
        Assignment::Flat => LineColor::Cyan3,
        Assignment::Unassigned => LineColor::None,
        Assignment::Cut | Assignment::Join => LineColor::Black0,
    }
}

pub fn fold_angle_for_line_color(line_color: LineColor) -> f64 {
    match line_color {
        LineColor::Blue2 => 180.0,
        LineColor::Red1 => -180.0,
        _ => 0.0,
    }
}

/// Signed fold angle in degrees for a folding crease, or `None` when the segment
/// is not a crease at all (border, auxiliary, construction).
///
/// **This is the sanctioned way to ask what a crease does.** New code must not
/// match on [`LineColor`] to decide fold semantics — colour carries only the
/// direction, and a segment may also carry a magnitude. Following the FOLD
/// convention this repo already uses, mountain is negative and valley positive.
pub fn crease_fold_angle(segment: &LineSegment) -> Option<f64> {
    let magnitude = segment.fold_magnitude.map_or(180.0, FoldMagnitude::degrees);
    match segment.color {
        LineColor::Red1 => Some(-magnitude),
        LineColor::Blue2 => Some(magnitude),
        _ => None,
    }
}

/// Whether this segment is representable by Oriedita and the flat pipeline.
///
/// True for a full +/-180 crease, and trivially true for anything that is not a
/// crease (those carry no magnitude by construction). False only for a crease
/// that has been given an explicit non-180 angle — which is precisely the set
/// that blocks `.cp` export, blocks the 2D folded view, and routes a vertex to
/// the spatial check.
pub fn is_classic_crease(segment: &LineSegment) -> bool {
    segment.fold_magnitude.is_none_or(FoldMagnitude::is_full)
}

/// Whether any segment in the model carries an explicit non-180 fold angle.
///
/// The cheap syntactic scan behind export gating and the folded-form dialog;
/// needs no solver and no topology.
pub fn has_non_classic_creases(model: &CreasePatternModel) -> bool {
    has_non_classic_segments(&model.line_segments)
}

/// The same question over an arbitrary **slice** of segments.
///
/// This is the fold-routing predicate, and it must be the slice-taking one: a
/// selection scoped to the all-classic half of a mixed document folds flat, and
/// asking the document-wide question there sends it to the 3D folder instead.
/// The two deliberately disagree on exactly that input — see
/// `the_two_non_classic_predicates_disagree_on_a_scoped_selection`.
pub fn has_non_classic_segments(segments: &[LineSegment]) -> bool {
    segments.iter().any(|segment| !is_classic_crease(segment))
}

pub fn custom_color_hex(color: RgbColor) -> String {
    format!("{:02x}{:02x}{:02x}", color.red, color.green, color.blue)
}

pub fn custom_color_from_hex(hex: &str) -> Result<RgbColor, ModelError> {
    if hex.len() != 6 {
        return Err(ModelError::InvalidCustomColor(hex.to_owned()));
    }

    let red = u8::from_str_radix(&hex[0..2], 16)
        .map_err(|_| ModelError::InvalidCustomColor(hex.to_owned()))?;
    let green = u8::from_str_radix(&hex[2..4], 16)
        .map_err(|_| ModelError::InvalidCustomColor(hex.to_owned()))?;
    let blue = u8::from_str_radix(&hex[4..6], 16)
        .map_err(|_| ModelError::InvalidCustomColor(hex.to_owned()))?;

    Ok(RgbColor::new(red, green, blue))
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ModelError {
    #[error("line index {index} is out of bounds")]
    LineIndexOutOfBounds { index: usize },
    #[error("custom line type {0} is unknown")]
    UnknownCustomLineType(i32),
    #[error("grid state {0} is unknown")]
    UnknownGridState(i32),
    #[error("custom color {0:?} is not a six-digit RGB hex string")]
    InvalidCustomColor(String),
}
