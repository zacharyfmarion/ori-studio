use crate::error::{BpError, BpResult};
use crate::model::{GridType, Point, Sheet};
use crate::shared::{Direction, MAX_SHEET_SIZE, MIN_DIAG_SIZE, MIN_RECT_SIZE, QUADRANT_NUMBER};

pub type Path = Vec<Point>;
pub type GridLine = [Point; 2];
pub type TransformationMatrix = [f64; 6];

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Dimension {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GridResize {
    pub old: Dimension,
    pub new: Dimension,
    pub shift: Option<Point>,
    pub flush_history: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SheetTransform {
    pub grid: BpGrid,
    pub matrix: TransformationMatrix,
    pub resize: GridResize,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BpGrid {
    Rectangular(RectangularGrid),
    Diagonal(DiagonalGrid),
}

impl BpGrid {
    pub fn new(sheet: Sheet) -> Self {
        match sheet.grid_type {
            GridType::Rectangular => {
                Self::Rectangular(RectangularGrid::new(sheet.width, sheet.height))
            }
            GridType::Diagonal => Self::Diagonal(DiagonalGrid::new(sheet.width, sheet.height)),
        }
    }

    pub fn to_sheet(&self) -> Sheet {
        match self {
            Self::Rectangular(grid) => grid.to_sheet(),
            Self::Diagonal(grid) => grid.to_sheet(),
        }
    }

    pub fn diameter(&self) -> f64 {
        match self {
            Self::Rectangular(grid) => grid.diameter(),
            Self::Diagonal(grid) => grid.diameter(),
        }
    }

    pub fn constrain(&self, point: Point) -> Point {
        match self {
            Self::Rectangular(grid) => grid.constrain(point),
            Self::Diagonal(grid) => grid.constrain(point),
        }
    }

    pub fn contains(&self, point: Point) -> bool {
        match self {
            Self::Rectangular(grid) => grid.contains(point),
            Self::Diagonal(grid) => grid.contains(point),
        }
    }

    pub fn can_subdivide(&self) -> bool {
        match self {
            Self::Rectangular(grid) => grid.can_subdivide(),
            Self::Diagonal(grid) => grid.can_subdivide(),
        }
    }

    /// Whether the grid dimensions themselves permit halving (even, and staying
    /// at or above the minimum size). The full un-subdivide guard also requires
    /// every flap to sit on an even grid line — see [`unsubdivide_sheet`].
    pub fn can_unsubdivide(&self) -> bool {
        match self {
            Self::Rectangular(grid) => grid.can_unsubdivide(),
            Self::Diagonal(grid) => grid.can_unsubdivide(),
        }
    }

    pub fn resize_center(&self) -> Point {
        match self {
            Self::Rectangular(grid) => grid.resize_center(),
            Self::Diagonal(grid) => grid.resize_center(),
        }
    }

    pub fn center(&self) -> Point {
        match self {
            Self::Rectangular(grid) => grid.center(),
            Self::Diagonal(grid) => grid.center(),
        }
    }

    pub fn set_dimension(&mut self, width: f64, height: f64) -> BpResult<GridResize> {
        match self {
            Self::Rectangular(grid) => Ok(grid.set_dimension(width, height)),
            Self::Diagonal(grid) => grid.set_dimension(width, height),
        }
    }

    pub fn label_direction(&self, x: f64, y: f64) -> Direction {
        match self {
            Self::Rectangular(grid) => grid.label_direction(x, y),
            Self::Diagonal(grid) => grid.label_direction(x, y),
        }
    }

    pub fn border_path(&self) -> Path {
        match self {
            Self::Rectangular(grid) => grid.border_path(),
            Self::Diagonal(grid) => grid.border_path(),
        }
    }

    pub fn grid_lines(&self) -> Vec<GridLine> {
        match self {
            Self::Rectangular(grid) => grid.grid_lines(),
            Self::Diagonal(grid) => grid.grid_lines(),
        }
    }

    pub fn transform_matrix(&self, size: f64, reorient: bool) -> TransformationMatrix {
        match self {
            Self::Rectangular(grid) => grid.transform_matrix(size, reorient),
            Self::Diagonal(grid) => grid.transform_matrix(size, reorient),
        }
    }

    pub fn offset(&self) -> Point {
        match self {
            Self::Rectangular(grid) => grid.offset(),
            Self::Diagonal(grid) => grid.offset(),
        }
    }

    pub fn render_width(&self) -> f64 {
        match self {
            Self::Rectangular(grid) => grid.render_width(),
            Self::Diagonal(grid) => grid.render_width(),
        }
    }

    pub fn render_height(&self) -> f64 {
        match self {
            Self::Rectangular(grid) => grid.render_height(),
            Self::Diagonal(grid) => grid.render_height(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RectangularGrid {
    width: f64,
    height: f64,
    test_width: f64,
    test_height: f64,
}

impl RectangularGrid {
    pub const DEFAULT_SIZE: f64 = 16.0;

    pub fn new(width: f64, height: f64) -> Self {
        Self {
            width,
            height,
            test_width: width,
            test_height: height,
        }
    }

    pub fn default_grid() -> Self {
        Self::new(Self::DEFAULT_SIZE, Self::DEFAULT_SIZE)
    }

    pub fn width(&self) -> f64 {
        self.width
    }

    pub fn height(&self) -> f64 {
        self.height
    }

    pub fn diameter(&self) -> f64 {
        self.width.max(self.height)
    }

    pub fn to_sheet(&self) -> Sheet {
        Sheet {
            grid_type: GridType::Rectangular,
            width: self.width,
            height: self.height,
        }
    }

    pub fn can_subdivide(&self) -> bool {
        self.width * 2.0 <= MAX_SHEET_SIZE as f64 && self.height * 2.0 <= MAX_SHEET_SIZE as f64
    }

    pub fn can_unsubdivide(&self) -> bool {
        is_even(self.width)
            && is_even(self.height)
            && self.width / 2.0 >= MIN_RECT_SIZE as f64
            && self.height / 2.0 >= MIN_RECT_SIZE as f64
    }

    pub fn resize_center(&self) -> Point {
        Point { x: 0.0, y: 0.0 }
    }

    pub fn center(&self) -> Point {
        Point {
            x: self.width / 2.0,
            y: self.height / 2.0,
        }
    }

    pub fn set_dimension(&mut self, width: f64, height: f64) -> GridResize {
        let old = self.dimension();
        self.test_width = width;
        self.width = width;
        self.test_height = height;
        self.height = height;
        GridResize {
            old,
            new: self.dimension(),
            shift: None,
            flush_history: false,
        }
    }

    pub fn set_width_checked(&mut self, width: f64, anchors: &[Point]) -> Option<GridResize> {
        let old_value = self.width;
        if !(MIN_RECT_SIZE as f64..=MAX_SHEET_SIZE as f64).contains(&width) || old_value == width {
            return None;
        }
        self.test_width = width;
        let mut shift = None;
        let mut flush_history = true;
        if width < old_value {
            let (min, max) = x_span(anchors);
            if max - min > width {
                self.test_width = old_value;
                return None;
            }
            if max > width {
                shift = Some(Point {
                    x: width - max,
                    y: 0.0,
                });
                flush_history = false;
            }
        }
        self.width = width;
        Some(GridResize {
            old: Dimension {
                width: old_value,
                height: self.height,
            },
            new: self.dimension(),
            shift,
            flush_history,
        })
    }

    pub fn set_height_checked(&mut self, height: f64, anchors: &[Point]) -> Option<GridResize> {
        let old_value = self.height;
        if !(MIN_RECT_SIZE as f64..=MAX_SHEET_SIZE as f64).contains(&height) || old_value == height
        {
            return None;
        }
        self.test_height = height;
        let mut shift = None;
        let mut flush_history = true;
        if height < old_value {
            let (min, max) = y_span(anchors);
            if max - min > height {
                self.test_height = old_value;
                return None;
            }
            if max > height {
                shift = Some(Point {
                    x: 0.0,
                    y: height - max,
                });
                flush_history = false;
            }
        }
        self.height = height;
        Some(GridResize {
            old: Dimension {
                width: self.width,
                height: old_value,
            },
            new: self.dimension(),
            shift,
            flush_history,
        })
    }

    pub fn fix_dimension(dimension: &mut Dimension) {
        if dimension.height < MIN_RECT_SIZE as f64 {
            dimension.height = MIN_RECT_SIZE as f64;
        }
        if dimension.width < MIN_RECT_SIZE as f64 {
            dimension.width = MIN_RECT_SIZE as f64;
        }
    }

    pub fn constrain(&self, point: Point) -> Point {
        rectangular_constrain(self.width, self.height, point)
    }

    pub fn contains(&self, point: Point) -> bool {
        0.0 <= point.x
            && point.x <= self.test_width
            && 0.0 <= point.y
            && point.y <= self.test_height
    }

    pub fn label_direction(&self, x: f64, y: f64) -> Direction {
        if x == 0.0 {
            if y == 0.0 {
                return Direction::Ll;
            }
            if y == self.height {
                return Direction::Ul;
            }
            return Direction::L;
        }
        if x == self.width {
            if y == 0.0 {
                return Direction::Lr;
            }
            if y == self.height {
                return Direction::Ur;
            }
            return Direction::R;
        }
        if y == self.height {
            return Direction::T;
        }
        Direction::B
    }

    pub fn border_path(&self) -> Path {
        vec![
            Point { x: 0.0, y: 0.0 },
            Point {
                x: self.width,
                y: 0.0,
            },
            Point {
                x: self.width,
                y: self.height,
            },
            Point {
                x: 0.0,
                y: self.height,
            },
        ]
    }

    pub fn grid_lines(&self) -> Vec<GridLine> {
        let mut lines = Vec::new();
        let mut i = 1.0;
        while i < self.height {
            lines.push([
                Point { x: 0.0, y: i },
                Point {
                    x: self.width,
                    y: i,
                },
            ]);
            i += 1.0;
        }
        i = 1.0;
        while i < self.width {
            lines.push([
                Point { x: i, y: 0.0 },
                Point {
                    x: i,
                    y: self.height,
                },
            ]);
            i += 1.0;
        }
        lines
    }

    pub fn transform_matrix(&self, size: f64, _reorient: bool) -> TransformationMatrix {
        let max = self.width.max(self.height);
        let scale = size / max;
        [
            scale,
            0.0,
            0.0,
            -scale,
            -scale * self.width / 2.0,
            scale * self.height / 2.0,
        ]
    }

    pub fn offset(&self) -> Point {
        Point { x: 0.0, y: 0.0 }
    }

    pub fn render_height(&self) -> f64 {
        self.height
    }

    pub fn render_width(&self) -> f64 {
        self.width
    }

    fn dimension(&self) -> Dimension {
        Dimension {
            width: self.width,
            height: self.height,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DiagonalGrid {
    size: f64,
    test_size: f64,
    test_shift: Option<Point>,
}

impl DiagonalGrid {
    pub const DEFAULT_SIZE: f64 = 16.0;

    pub fn new(width: f64, height: f64) -> Self {
        let size = ((width + height) / 2.0).round();
        Self {
            size,
            test_size: size,
            test_shift: None,
        }
    }

    pub fn new_fitted(width: f64, height: f64, anchors: &[Point]) -> (Self, Option<Point>) {
        let mut grid = Self::new(width, height);
        let shift = grid.initial_fit(anchors);
        (grid, shift)
    }

    pub fn default_grid() -> Self {
        Self::new(Self::DEFAULT_SIZE, Self::DEFAULT_SIZE)
    }

    pub fn size(&self) -> f64 {
        self.size
    }

    pub fn diameter(&self) -> f64 {
        self.size
    }

    pub fn to_sheet(&self) -> Sheet {
        Sheet {
            grid_type: GridType::Diagonal,
            width: self.size,
            height: self.size,
        }
    }

    pub fn can_subdivide(&self) -> bool {
        self.size * 2.0 <= MAX_SHEET_SIZE as f64
    }

    pub fn can_unsubdivide(&self) -> bool {
        is_even(self.size) && self.size / 2.0 >= MIN_DIAG_SIZE as f64
    }

    pub fn resize_center(&self) -> Point {
        self.center()
    }

    pub fn center(&self) -> Point {
        Point {
            x: self.size / 2.0,
            y: self.size / 2.0,
        }
    }

    pub fn set_dimension(&mut self, width: f64, height: f64) -> BpResult<GridResize> {
        if width != height {
            return Err(BpError::InvalidInput(
                "Dimension mismatch for diagonal grid.".to_string(),
            ));
        }
        let old = self.dimension();
        self.test_size = width;
        self.size = width;
        Ok(GridResize {
            old,
            new: self.dimension(),
            shift: None,
            flush_history: false,
        })
    }

    pub fn set_size_checked(&mut self, size: f64, anchors: &[Point]) -> Option<GridResize> {
        if !(MIN_DIAG_SIZE as f64..=MAX_SHEET_SIZE as f64).contains(&size) {
            return None;
        }
        let old_value = self.size;
        self.test_size = size;
        let offset = if size % 2.0 != 0.0 {
            ((size - old_value) / 2.0).floor()
        } else {
            ((size - old_value) / 2.0).ceil()
        };
        self.test_shift = Some(Point {
            x: offset,
            y: offset,
        });
        if size < old_value && !self.test_fit(anchors) {
            let range = ((old_value - size) / 2.0).ceil() as i32;
            if !self.try_shift(range, anchors) {
                self.test_size = self.size;
                self.test_shift = None;
                return None;
            }
        }

        let shift = self.apply_offset();
        self.size = size;
        Some(GridResize {
            old: Dimension {
                width: old_value,
                height: old_value,
            },
            new: self.dimension(),
            shift,
            flush_history: shift.is_none(),
        })
    }

    pub fn fix_dimension(dimension: &mut Dimension) {
        if dimension.height < MIN_DIAG_SIZE as f64 {
            dimension.height = MIN_DIAG_SIZE as f64;
        }
        if dimension.width < MIN_DIAG_SIZE as f64 {
            dimension.width = MIN_DIAG_SIZE as f64;
        }
    }

    pub fn constrain(&self, point: Point) -> Point {
        diagonal_constrain(self.size, self.size, point)
    }

    pub fn contains(&self, mut point: Point) -> bool {
        let size = self.test_size;
        let h = size % 2.0;
        let f = (size - h) / 2.0;
        let c = (size + h) / 2.0;
        if let Some(shift) = self.test_shift {
            point.x += shift.x;
            point.y += shift.y;
        }
        point.x + point.y >= f
            && point.y - point.x <= c
            && point.x - point.y <= c
            && point.x + point.y <= c + size
    }

    pub fn label_direction(&self, x: f64, y: f64) -> Direction {
        let shift = self.size % 2.0;
        let size = self.size + shift;
        let half = size / 2.0;
        if shift == 0.0 {
            if x == 0.0 && y == half {
                return Direction::L;
            }
            if x == half && y == 0.0 {
                return Direction::B;
            }
            if x == half && y == size {
                return Direction::T;
            }
            if x == size && y == half {
                return Direction::R;
            }
        }
        if x + y == half - shift {
            return Direction::Ll;
        }
        if x + y == half * 3.0 - shift {
            return Direction::Ur;
        }
        if x - y == half {
            return Direction::Lr;
        }
        if y - x == half {
            return Direction::Ul;
        }
        Direction::B
    }

    pub fn border_path(&self) -> Path {
        let mut full = self.render_height();
        let mut half = full / 2.0;
        let shift = self.size % 2.0 / 2.0;
        full -= shift;
        half -= shift;
        vec![
            Point { x: half, y: -shift },
            Point { x: full, y: half },
            Point { x: half, y: full },
            Point { x: -shift, y: half },
        ]
    }

    pub fn grid_lines(&self) -> Vec<GridLine> {
        let mut lines = Vec::new();
        let shift = self.size % 2.0;
        let mut i = 1.0 - shift;
        while i < self.size + shift {
            let offset = (i - self.size / 2.0).abs() - shift / 2.0;
            lines.push([
                Point { x: offset, y: i },
                Point {
                    x: self.size - offset,
                    y: i,
                },
            ]);
            lines.push([
                Point { x: i, y: offset },
                Point {
                    x: i,
                    y: self.size - offset,
                },
            ]);
            i += 1.0;
        }
        lines
    }

    pub fn transform_matrix(&self, size: f64, reorient: bool) -> TransformationMatrix {
        let full = self.render_width();
        let scale = size / full;
        let shift = self.size % 2.0 / 2.0;
        if reorient {
            let offset = full - 2.0 * shift;
            [scale, scale, scale, -scale, -scale * offset, 0.0]
        } else {
            let offset = full / 2.0 - shift;
            [scale, 0.0, 0.0, -scale, -scale * offset, scale * offset]
        }
    }

    pub fn offset(&self) -> Point {
        let shift = self.size % 2.0 / 2.0;
        Point {
            x: -shift,
            y: -shift,
        }
    }

    pub fn render_height(&self) -> f64 {
        self.size + self.size % 2.0
    }

    pub fn render_width(&self) -> f64 {
        self.size + self.size % 2.0
    }

    fn dimension(&self) -> Dimension {
        Dimension {
            width: self.size,
            height: self.size,
        }
    }

    fn initial_fit(&mut self, anchors: &[Point]) -> Option<Point> {
        if self.test_fit(anchors) {
            return None;
        }
        let [xpy_min, xpy_max, ymx_min, ymx_max] = diagonal_span(anchors);
        self.test_size = ((xpy_max - xpy_min).max(ymx_max - ymx_min) / 2.0).ceil();
        let a = (xpy_max + xpy_min) / 2.0;
        let b = (ymx_max + ymx_min) / 2.0;
        let x = ((self.test_size - a + b) / 2.0).round();
        let y = ((self.test_size - a - b) / 2.0).round();
        self.test_shift = Some(Point { x, y });
        while !self.test_fit(anchors) {
            self.test_size += 1.0;
            if self.test_size % 2.0 == 0.0
                && let Some(shift) = &mut self.test_shift
            {
                shift.x += 1.0;
                shift.y += 1.0;
            }
        }
        self.size = self.test_size;
        self.apply_offset()
    }

    fn test_fit(&self, anchors: &[Point]) -> bool {
        anchors.iter().all(|point| self.contains(*point))
    }

    fn apply_offset(&mut self) -> Option<Point> {
        let result = self
            .test_shift
            .filter(|shift| shift.x != 0.0 || shift.y != 0.0);
        self.test_shift = None;
        result
    }

    fn try_shift(&mut self, range: i32, anchors: &[Point]) -> bool {
        for r in 1..=range {
            for point in chebyshev(r) {
                self.test_shift = Some(point);
                if self.test_fit(anchors) {
                    return true;
                }
            }
        }
        false
    }
}

pub fn constrain_vertex(
    constrain: impl Fn(Point) -> Point,
    location: Point,
    vector: Point,
) -> Point {
    fix_vector(constrain, location, vector)
}

pub fn constrain_flap(
    constrain: impl Fn(Point) -> Point + Copy,
    location: Point,
    width: f64,
    height: f64,
    vector: Point,
) -> Point {
    let zero_width = width == 0.0;
    let zero_height = height == 0.0;
    if zero_width && zero_height {
        fix_vector(constrain, location, vector)
    } else if zero_width || zero_height {
        let vector = fix_vector(constrain, location, vector);
        let point = if zero_width {
            Point {
                x: location.x,
                y: location.y + height,
            }
        } else {
            Point {
                x: location.x + width,
                y: location.y,
            }
        };
        fix_vector(constrain, point, vector)
    } else {
        let mut data = get_dots(location, width, height)
            .into_iter()
            .map(|point| {
                let fix = fix_vector(constrain, point, vector);
                let dx = fix.x - vector.x;
                let dy = fix.y - vector.y;
                let distance = dx * dx + dy * dy;
                (distance, point, fix)
            })
            .filter(|(distance, _, _)| *distance > 0.0)
            .collect::<Vec<_>>();
        data.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        if data.len() <= 1 {
            return vector;
        }
        let mut result = data[1].2;
        if let Some((_, point, _)) = data.get(2) {
            result = fix_vector(constrain, *point, result);
        }
        if let Some((_, point, _)) = data.get(3) {
            result = fix_vector(constrain, *point, result);
        }
        result
    }
}

pub fn get_dots(location: Point, width: f64, height: f64) -> [Point; 4] {
    [
        Point {
            x: location.x + width,
            y: location.y + height,
        },
        Point {
            x: location.x,
            y: location.y + height,
        },
        location,
        Point {
            x: location.x + width,
            y: location.y,
        },
    ]
}

pub fn rectangular_constrain(width: f64, height: f64, point: Point) -> Point {
    Point {
        x: point.x.clamp(0.0, width),
        y: point.y.clamp(0.0, height),
    }
}

pub fn diagonal_constrain(width: f64, _height: f64, mut point: Point) -> Point {
    let size = width;
    let h = size % 2.0;
    let f = (size - h) / 2.0;
    let c = (size + h) / 2.0;

    if point.x + point.y < f {
        let d = f - point.x - point.y;
        point.x += (d / 2.0).floor();
        point.y += (d / 2.0).ceil();
    }
    if point.y - point.x > c {
        let d = point.y - point.x - c;
        point.x += (d / 2.0).floor();
        point.y -= (d / 2.0).ceil();
    }
    if point.x - point.y > c {
        let d = point.x - point.y - c;
        point.x -= (d / 2.0).floor();
        point.y += (d / 2.0).ceil();
    }
    if point.x + point.y > c + size {
        let d = point.x + point.y - c - size;
        point.x -= (d / 2.0).floor();
        point.y -= (d / 2.0).ceil();
    }
    if point.x < 0.0 {
        point.x = 0.0;
    }
    if point.x > size {
        point.x = size;
    }
    point
}

pub fn get_relative_point(point: Point, from: &BpGrid, to: &BpGrid) -> Point {
    let x_factor = to.render_width() / from.render_width();
    let y_factor = to.render_height() / from.render_height();
    to.constrain(round_point(Point {
        x: point.x * x_factor,
        y: point.y * y_factor,
    }))
}

pub fn subdivide_sheet(grid: BpGrid) -> BpResult<Option<SheetTransform>> {
    if !grid.can_subdivide() {
        return Ok(None);
    }
    let old_center = grid.resize_center();
    let mut next_grid = grid;
    let resize = next_grid.set_dimension(grid.render_width() * 2.0, grid.render_height() * 2.0)?;
    let new_center = next_grid.resize_center();
    Ok(Some(SheetTransform {
        grid: next_grid,
        matrix: [
            2.0,
            0.0,
            0.0,
            2.0,
            new_center.x - 2.0 * old_center.x,
            new_center.y - 2.0 * old_center.y,
        ],
        resize,
    }))
}

/// Halve the grid (inverse of [`subdivide_sheet`]). Refuses — returning
/// `Ok(None)` — when the dimensions can't halve cleanly ([`BpGrid::can_unsubdivide`])
/// or any flap dot would land on a half-cell after halving, so the coarser grid
/// stays exact. `anchors` are the flap dots (see `layout_flap_anchors`).
pub fn unsubdivide_sheet(grid: BpGrid, anchors: &[Point]) -> BpResult<Option<SheetTransform>> {
    if !grid.can_unsubdivide() {
        return Ok(None);
    }
    let old_center = grid.resize_center();
    let mut next_grid = grid;
    let resize = next_grid.set_dimension(grid.render_width() / 2.0, grid.render_height() / 2.0)?;
    let new_center = next_grid.resize_center();
    let matrix = [
        0.5,
        0.0,
        0.0,
        0.5,
        new_center.x - 0.5 * old_center.x,
        new_center.y - 0.5 * old_center.y,
    ];
    let lands_on_grid = anchors.iter().all(|point| {
        let x = matrix[0] * point.x + matrix[4];
        let y = matrix[3] * point.y + matrix[5];
        is_integer(x) && is_integer(y)
    });
    if !lands_on_grid {
        return Ok(None);
    }
    Ok(Some(SheetTransform {
        grid: next_grid,
        matrix,
        resize,
    }))
}

pub fn rotate_sheet(grid: BpGrid, by: f64) -> BpResult<SheetTransform> {
    let old_center = grid.center();
    let sheet = grid.to_sheet();
    let mut next_grid = grid;
    let resize = next_grid.set_dimension(sheet.height, sheet.width)?;
    let new_center = next_grid.center();
    Ok(SheetTransform {
        grid: next_grid,
        matrix: [
            0.0,
            by,
            -by,
            0.0,
            new_center.x - by * old_center.y,
            new_center.y + by * old_center.x,
        ],
        resize,
    })
}

pub fn flip_sheet(grid: &BpGrid, horizontal: bool) -> TransformationMatrix {
    let center = grid.center();
    if horizontal {
        [-1.0, 0.0, 0.0, 1.0, 2.0 * center.x, 0.0]
    } else {
        [1.0, 0.0, 0.0, -1.0, 0.0, 2.0 * center.y]
    }
}

pub fn image_dimension(grid: &BpGrid, scale: f64, margin: f64) -> Dimension {
    let offset = grid.offset();
    Dimension {
        width: (grid.render_width() + offset.x * 2.0) * scale + margin * 2.0,
        height: (grid.render_height() + offset.y * 2.0) * scale + margin * 2.0,
    }
}

/// Grid coordinates are whole numbers; this tolerance absorbs float error when
/// testing integrality/parity after a halving transform.
const GRID_COORD_EPSILON: f64 = 1e-9;

fn is_integer(value: f64) -> bool {
    (value - value.round()).abs() < GRID_COORD_EPSILON
}

fn is_even(value: f64) -> bool {
    is_integer(value) && (value.round() as i64) % 2 == 0
}

fn fix_vector(constrain: impl Fn(Point) -> Point, point: Point, vector: Point) -> Point {
    let target = Point {
        x: point.x + vector.x,
        y: point.y + vector.y,
    };
    let fix = constrain(target);
    Point {
        x: fix.x - point.x,
        y: fix.y - point.y,
    }
}

fn x_span(anchors: &[Point]) -> (f64, f64) {
    if anchors.is_empty() {
        return (f64::INFINITY, f64::NEG_INFINITY);
    }
    anchors
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(min, max), point| {
            (min.min(point.x), max.max(point.x))
        })
}

fn y_span(anchors: &[Point]) -> (f64, f64) {
    if anchors.is_empty() {
        return (f64::INFINITY, f64::NEG_INFINITY);
    }
    anchors
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(min, max), point| {
            (min.min(point.y), max.max(point.y))
        })
}

fn diagonal_span(anchors: &[Point]) -> [f64; 4] {
    let mut xpy_min = f64::INFINITY;
    let mut xpy_max = f64::NEG_INFINITY;
    let mut ymx_min = f64::INFINITY;
    let mut ymx_max = f64::NEG_INFINITY;
    for point in anchors {
        let xpy = point.x + point.y;
        let ymx = point.y - point.x;
        xpy_min = xpy_min.min(xpy);
        xpy_max = xpy_max.max(xpy);
        ymx_min = ymx_min.min(ymx);
        ymx_max = ymx_max.max(ymx);
    }
    [xpy_min, xpy_max, ymx_min, ymx_max]
}

fn chebyshev(radius: i32) -> Vec<Point> {
    let mut result = Vec::new();
    for i in 0..QUADRANT_NUMBER {
        for j in 0..2 * radius {
            let f = if i % 2 == 1 { 1.0 } else { -1.0 };
            let j = f64::from(j - radius);
            let radius = f64::from(radius);
            result.push(if i < 2 {
                Point {
                    x: f * j,
                    y: f * radius,
                }
            } else {
                Point {
                    x: f * radius,
                    y: f * -j,
                }
            });
        }
    }
    result
}

fn round_point(point: Point) -> Point {
    Point {
        x: point.x.round(),
        y: point.y.round(),
    }
}
