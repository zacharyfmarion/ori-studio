use super::line_color::LineColor;
use super::point::Point;
use serde::{Deserialize, Serialize};

const DEFAULT_CUSTOMIZED_COLOR: RgbColor = RgbColor::new(100, 200, 200);

/// Simple RGB color used for Oriedita custom line/circle colors.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RgbColor {
    pub red: u8,
    pub green: u8,
    pub blue: u8,
}

impl RgbColor {
    pub const fn new(red: u8, green: u8, blue: u8) -> Self {
        Self { red, green, blue }
    }
}

/// Oriedita line segment active state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub enum ActiveState {
    #[default]
    Inactive0,
    ActiveA1,
    ActiveB2,
    ActiveBoth3,
}

/// `|rho|` for a folding crease, in units of 1e-7 degrees over
/// `0..=1_800_000_000`.
///
/// Only the *magnitude* lives here; the direction stays in [`LineColor`]
/// (`Red1` = mountain = negative, `Blue2` = valley = positive). Splitting the
/// concept this way makes a contradictory state — a mountain with a positive
/// angle — unrepresentable, and leaves every existing colour operation correct
/// without modification: `change_mv` swaps the colour and leaves the magnitude
/// alone, which negates rho, exactly as intended.
///
/// Unsigned `u32` rather than `f64` so [`LineSegment`] keeps its `Eq` derive and
/// undo/dedup compare exactly.
///
/// # Why 1e-7 degrees
///
/// The unit is a **serialised format commitment** (`.osf`, the compact
/// transport, the wasm bridge), so it is the one part of the tolerance story
/// that cannot be revised with a constant later.
///
/// Quantisation error composes around a vertex: a degree-`n` fan accumulates
/// roughly `n` half-ULPs of closure residual. At 1e-6 deg that is 2e-6 deg for
/// a degree-4 vertex and 8e-6 deg at degree 16 — *coarser than CAMV's own
/// 1e-6 deg bar*, which would put a future strict mode out of reach for
/// explicitly-angled creases. At 1e-7 deg those floors are 2e-7 and 8e-7,
/// comfortably under it.
///
/// 180 deg at 1e-7 is 1.8e9, still inside `u32` with 2.39x headroom, so the
/// extra decade costs nothing. Common construction angles (22.5, 45, 60, 90,
/// 120, 135) stay exactly representable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct FoldMagnitude(u32);

impl FoldMagnitude {
    /// Storage units per degree. See the type docs before changing this — it
    /// is a format commitment, not a tuning knob.
    pub const UNITS_PER_DEGREE: u32 = 10_000_000;
    pub const FLAT: Self = Self(0);
    pub const FULL: Self = Self(180 * Self::UNITS_PER_DEGREE);

    /// `None` when `degrees` is outside `0..=180` or not finite.
    pub fn from_degrees(degrees: f64) -> Option<Self> {
        if !degrees.is_finite() || !(0.0..=180.0).contains(&degrees) {
            return None;
        }
        Some(Self(
            (degrees * f64::from(Self::UNITS_PER_DEGREE)).round() as u32
        ))
    }

    pub fn degrees(self) -> f64 {
        f64::from(self.0) / f64::from(Self::UNITS_PER_DEGREE)
    }

    pub const fn is_full(self) -> bool {
        self.0 == Self::FULL.0
    }

    /// Sentinel for "classic" (`None`) on the compact transport. Out of the
    /// valid `0..=FULL` range, so it can never collide with a real magnitude.
    pub const TRANSPORT_CLASSIC: u32 = u32::MAX;

    pub const fn to_transport(value: Option<Self>) -> u32 {
        match value {
            Some(magnitude) => magnitude.0,
            None => Self::TRANSPORT_CLASSIC,
        }
    }

    /// Inverse of [`Self::to_transport`]. Anything out of range decodes to
    /// `None` rather than erroring — the transport is our own format on both
    /// ends, and a classic crease is the safe reading.
    pub const fn from_transport(value: u32) -> Option<Self> {
        if value > Self::FULL.0 {
            None
        } else {
            Some(Self(value))
        }
    }
}

/// Immutable Oriedita line segment carrier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineSegment {
    pub a: Point,
    pub b: Point,
    pub active: ActiveState,
    pub color: LineColor,
    pub selected: i32,
    pub customized: i32,
    pub customized_color: RgbColor,
    /// `None` is a *classic* crease: full +/-180 by colour, exactly as Oriedita
    /// stores it. Untouched Oriedita documents therefore round-trip
    /// byte-identically and route to the Oriedita check path.
    ///
    /// `None` is the **canonical** representation of 180 degrees. Setting 180 in
    /// the editor, or importing a FOLD that states 180, normalises to `None`, so
    /// `Some(FoldMagnitude::FULL)` should not occur in a stored document —
    /// "180 degrees" and "classic" are the same thing, and surfacing them as two
    /// states would be a distinction users cannot act on.
    ///
    /// Meaningful only for `Red1`/`Blue2`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fold_magnitude: Option<FoldMagnitude>,
}

impl LineSegment {
    pub const fn new(a: Point, b: Point) -> Self {
        Self::with_color(a, b, LineColor::Black0)
    }

    pub const fn with_color(a: Point, b: Point, color: LineColor) -> Self {
        Self::with_color_and_active(a, b, color, ActiveState::Inactive0)
    }

    pub const fn with_color_and_active(
        a: Point,
        b: Point,
        color: LineColor,
        active: ActiveState,
    ) -> Self {
        Self {
            a,
            b,
            active,
            color,
            selected: 0,
            customized: 0,
            customized_color: DEFAULT_CUSTOMIZED_COLOR,
            fold_magnitude: None,
        }
    }

    pub const fn from_coordinates(ax: f64, ay: f64, bx: f64, by: f64) -> Self {
        Self::new(Point::new(ax, ay), Point::new(bx, by))
    }

    pub fn with_coordinates(&self, a: Point, b: Point) -> Self {
        Self { a, b, ..*self }
    }

    pub fn with_swapped_coordinates(&self) -> Self {
        self.with_coordinates(self.b, self.a)
    }

    pub fn with_a(&self, a: Point) -> Self {
        Self { a, ..*self }
    }

    pub fn with_b(&self, b: Point) -> Self {
        Self { b, ..*self }
    }

    /// Set the line colour, clearing any fold magnitude the segment can no
    /// longer carry.
    ///
    /// This is the single enforcement point for the rule that magnitude is
    /// meaningful only on `Red1`/`Blue2`. Note it deliberately *keeps* the
    /// magnitude across a mountain/valley swap: `change_mv` goes Red1 <-> Blue2,
    /// which negates rho and leaves `|rho|` alone, which is exactly right.
    /// Turning a crease into an edge or auxiliary line drops it.
    pub fn with_line_color(&self, color: LineColor) -> Self {
        let fold_magnitude = match color {
            LineColor::Red1 | LineColor::Blue2 => self.fold_magnitude,
            _ => None,
        };
        Self {
            color,
            fold_magnitude,
            ..*self
        }
    }

    /// Set the fold magnitude, normalising 180 degrees to `None`.
    ///
    /// A no-op on lines that cannot carry one. See [`FoldMagnitude`] and the
    /// `fold_magnitude` field docs for why 180 is stored as `None`.
    pub fn with_fold_magnitude(&self, magnitude: Option<FoldMagnitude>) -> Self {
        if !matches!(self.color, LineColor::Red1 | LineColor::Blue2) {
            return self.clone();
        }
        Self {
            fold_magnitude: magnitude.filter(|value| !value.is_full()),
            ..*self
        }
    }

    pub fn with_active(&self, active: ActiveState) -> Self {
        Self { active, ..*self }
    }

    pub fn with_selected(&self, selected: i32) -> Self {
        Self { selected, ..*self }
    }

    pub fn with_customized_color(&self, customized_color: RgbColor) -> Self {
        Self {
            customized: 1,
            customized_color,
            ..*self
        }
    }

    pub fn determine_max_x(&self) -> i32 {
        (self.a.x.ceil() as i32).max(self.b.x.ceil() as i32)
    }

    pub fn determine_min_x(&self) -> i32 {
        (self.a.x.floor() as i32).min(self.b.x.floor() as i32)
    }

    pub fn determine_max_y(&self) -> i32 {
        (self.a.y.ceil() as i32).max(self.b.y.ceil() as i32)
    }

    pub fn determine_min_y(&self) -> i32 {
        (self.a.y.floor() as i32).min(self.b.y.floor() as i32)
    }

    pub fn determine_closest_endpoint(&self, p: Point) -> Point {
        if p.distance_squared(self.a) <= p.distance_squared(self.b) {
            self.a
        } else {
            self.b
        }
    }

    pub fn determine_furthest_endpoint(&self, p: Point) -> Point {
        if p.distance_squared(self.a) >= p.distance_squared(self.b) {
            self.a
        } else {
            self.b
        }
    }

    pub fn determine_length(&self) -> f64 {
        self.a.distance(self.b)
    }

    pub const fn determine_ax(&self) -> f64 {
        self.a.x
    }

    pub const fn determine_ay(&self) -> f64 {
        self.a.y
    }

    pub const fn determine_bx(&self) -> f64 {
        self.b.x
    }

    pub const fn determine_by(&self) -> f64 {
        self.b.y
    }

    pub fn determine_delta_x(&self) -> f64 {
        self.b.x - self.a.x
    }

    pub fn determine_delta_y(&self) -> f64 {
        self.b.y - self.a.y
    }
}

impl Default for LineSegment {
    fn default() -> Self {
        Self::new(Point::origin(), Point::origin())
    }
}

/// Oriedita segment intersection classification codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum Intersection {
    Error = -1,
    NoIntersection0 = 0,
    Intersects1 = 1,
    IntersectsAux2 = 2,
    IntersectsAux3 = 3,
    IntersectAtPoint4 = 4,
    IntersectAtPointS1_5 = 5,
    IntersectAtPointS2_6 = 6,
    IntersectsLShapeS1StartS2Start21 = 21,
    IntersectsLShapeS1StartS2End22 = 22,
    IntersectsLShapeS1EndS2Start23 = 23,
    IntersectsLShapeS1EndS2End24 = 24,
    IntersectsTShapeS1VerticalBar25 = 25,
    IntersectsTShapeS1VerticalBar26 = 26,
    IntersectsTShapeS2VerticalBar27 = 27,
    IntersectsTShapeS2VerticalBar28 = 28,
    ParallelEqual31 = 31,
    IntersectTA121 = 121,
    IntersectTB122 = 122,
    IntersectTA211 = 211,
    IntersectTB221 = 221,
    ParallelStartOfS1ContainsStartOfS2_321 = 321,
    ParallelStartOfS2ContainsStartOfS1_322 = 322,
    ParallelStartOfS1IntersectsStartOfS2_323 = 323,
    ParallelStartOfS1ContainsEndOfS2_331 = 331,
    ParallelEndOfS2ContainsStartOfS1_332 = 332,
    ParallelStartOfS1IntersectsEndOfS2_333 = 333,
    ParallelEndOfS1ContainsStartOfS2_341 = 341,
    ParallelStartOfS2ContainsEndOfS1_342 = 342,
    ParallelEndOfS1IntersectsStartOfS2_343 = 343,
    ParallelEndOfS1ContainsEndOfS2_351 = 351,
    ParallelEndOfS2ContainsEndOfS1_352 = 352,
    ParallelEndOfS1IntersectsEndOfS2_353 = 353,
    ParallelS1IncludesS2_361 = 361,
    ParallelS1IncludesS2_362 = 362,
    ParallelS2IncludesS1_363 = 363,
    ParallelS2IncludesS1_364 = 364,
    ParallelS1EndOverlapsS2Start371 = 371,
    ParallelS1EndOverlapsS2End372 = 372,
    ParallelS1StartOverlapsS2End373 = 373,
    ParallelS1StartOverlapsS2Start374 = 374,
}

impl Intersection {
    pub const fn state(self) -> i32 {
        self as i32
    }

    pub const fn is_endpoint_intersection(self) -> bool {
        self.state() >= 21 && self.state() <= 28
    }

    pub const fn is_intersection(self) -> bool {
        self.state() >= 1
    }

    pub const fn is_contained_inside(self) -> bool {
        self.state() >= 360
    }

    pub const fn is_overlapping(self) -> bool {
        self.state() >= 30
    }

    pub const fn is_segment_overlapping(self) -> bool {
        matches!(
            self,
            Self::ParallelEqual31
                | Self::ParallelStartOfS1ContainsStartOfS2_321
                | Self::ParallelStartOfS2ContainsStartOfS1_322
                | Self::ParallelStartOfS1ContainsEndOfS2_331
                | Self::ParallelEndOfS2ContainsStartOfS1_332
                | Self::ParallelEndOfS1ContainsStartOfS2_341
                | Self::ParallelStartOfS2ContainsEndOfS1_342
                | Self::ParallelEndOfS1ContainsEndOfS2_351
                | Self::ParallelEndOfS2ContainsEndOfS1_352
                | Self::ParallelS1IncludesS2_361
                | Self::ParallelS1IncludesS2_362
                | Self::ParallelS2IncludesS1_363
                | Self::ParallelS2IncludesS1_364
                | Self::ParallelS1EndOverlapsS2Start371
                | Self::ParallelS1EndOverlapsS2End372
                | Self::ParallelS1StartOverlapsS2End373
                | Self::ParallelS1StartOverlapsS2Start374
        )
    }
}

#[cfg(test)]
mod fold_magnitude_tests {
    use super::{FoldMagnitude, LineColor, LineSegment};

    /// R2 mitigation: a classic segment must serialise with no trace of the new
    /// field, so existing fixtures and Oriedita documents round-trip unchanged.
    #[test]
    fn classic_segment_serialises_without_the_new_field() {
        let segment = LineSegment::from_coordinates(0.0, 0.0, 1.0, 1.0);
        let json = serde_json::to_string(&segment).expect("serialise");
        assert!(
            !json.contains("fold_magnitude"),
            "classic segment leaked the field: {json}"
        );
    }

    #[test]
    fn legacy_json_round_trips_byte_identically() {
        let legacy = r#"{"a":{"x":0.0,"y":0.0},"b":{"x":1.0,"y":1.0},"active":"Inactive0","color":"Red1","selected":0,"customized":0,"customized_color":{"red":100,"green":200,"blue":200}}"#;
        let segment: LineSegment = serde_json::from_str(legacy).expect("deserialise legacy");
        assert_eq!(segment.fold_magnitude, None);
        assert_eq!(
            serde_json::to_string(&segment).expect("reserialise"),
            legacy
        );
    }

    #[test]
    fn magnitude_is_orthogonal_to_direction() {
        // The architecture's central claim: flipping M/V negates rho without
        // touching the magnitude, so existing colour operations stay correct.
        let ninety = FoldMagnitude::from_degrees(90.0).expect("in range");
        let mountain =
            LineSegment::from_coordinates(0.0, 0.0, 1.0, 0.0).with_line_color(LineColor::Red1);
        let mountain = LineSegment {
            fold_magnitude: Some(ninety),
            ..mountain
        };
        let valley = mountain.with_line_color(mountain.color.change_mv());

        assert_eq!(valley.color, LineColor::Blue2);
        assert_eq!(valley.fold_magnitude, mountain.fold_magnitude);
    }

    #[test]
    fn range_and_validation() {
        assert_eq!(FoldMagnitude::FULL.degrees(), 180.0);
        assert!(FoldMagnitude::FULL.is_full());
        assert_eq!(FoldMagnitude::from_degrees(-1.0), None);
        assert_eq!(FoldMagnitude::from_degrees(180.5), None);
        assert_eq!(FoldMagnitude::from_degrees(f64::NAN), None);
    }

    #[test]
    fn colour_setter_keeps_magnitude_across_mv_but_drops_it_off_creases() {
        let ninety = FoldMagnitude::from_degrees(90.0).expect("in range");
        let mountain = LineSegment::from_coordinates(0.0, 0.0, 1.0, 0.0)
            .with_line_color(LineColor::Red1)
            .with_fold_magnitude(Some(ninety));
        assert_eq!(mountain.fold_magnitude, Some(ninety));

        // Mountain <-> valley keeps |rho| and flips the sign via colour.
        let valley = mountain.with_line_color(LineColor::Blue2);
        assert_eq!(valley.fold_magnitude, Some(ninety));

        // Leaving the folding colours drops it, and coming back does not
        // resurrect it.
        let edge = mountain.with_line_color(LineColor::Black0);
        assert_eq!(edge.fold_magnitude, None);
        assert_eq!(
            edge.with_line_color(LineColor::Red1).fold_magnitude,
            None,
            "magnitude must not survive a round trip through a non-crease colour"
        );

        let aux = mountain.with_line_color(LineColor::Cyan3);
        assert_eq!(aux.fold_magnitude, None);
    }

    #[test]
    fn setting_180_normalises_to_none() {
        let crease = LineSegment::from_coordinates(0.0, 0.0, 1.0, 0.0)
            .with_line_color(LineColor::Blue2)
            .with_fold_magnitude(Some(FoldMagnitude::FULL));
        assert_eq!(
            crease.fold_magnitude, None,
            "180 degrees is classic; Some(FULL) must not reach storage"
        );
    }

    #[test]
    fn magnitude_is_a_no_op_on_non_folding_lines() {
        let ninety = FoldMagnitude::from_degrees(90.0).expect("in range");
        let edge = LineSegment::from_coordinates(0.0, 0.0, 1.0, 0.0)
            .with_line_color(LineColor::Black0)
            .with_fold_magnitude(Some(ninety));
        assert_eq!(edge.fold_magnitude, None);
    }

    /// The storage unit is a serialised format commitment — `.osf`, the compact
    /// transport, and the wasm bridge all carry it, so it cannot be revised with
    /// a constant the way the closure tolerance can. These assertions are the
    /// reasons behind the choice; breaking one means a format migration, not a
    /// tweak.
    #[test]
    fn storage_resolution_is_a_deliberate_format_commitment() {
        // 1. The full range fits u32 with headroom.
        assert!(u64::from(FoldMagnitude::FULL.0) < u64::from(u32::MAX));

        // 2. Resolution out-resolves CAMV's ~1e-6 deg bar even after
        //    quantisation error composes around a high-degree vertex. A
        //    degree-n fan accumulates roughly n half-ULPs.
        let ulp = 1.0 / f64::from(FoldMagnitude::UNITS_PER_DEGREE);
        let worst_case_degree_16 = 16.0 * 0.5 * ulp;
        assert!(
            worst_case_degree_16 < 1e-6,
            "degree-16 quantisation floor {worst_case_degree_16:e} exceeds the CAMV bar"
        );

        // 3. A value one ULP above flat is distinguishable from flat.
        assert_ne!(
            FoldMagnitude::from_degrees(ulp).expect("in range"),
            FoldMagnitude::FLAT
        );

        // 4. Common construction angles are exactly representable.
        for degrees in [22.5, 30.0, 45.0, 60.0, 90.0, 120.0, 135.0, 180.0] {
            let stored = FoldMagnitude::from_degrees(degrees).expect("in range");
            assert_eq!(stored.degrees(), degrees, "{degrees} is not exact");
        }
    }
}
