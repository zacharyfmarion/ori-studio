use super::{
    CornerMap as LayoutCornerMap, CornerType, LayoutConfiguration, LayoutPartition,
    LayoutRepository,
};
use crate::error::{BpError, BpResult};
use crate::layout::trace::Ridge;
use crate::math::BpFraction;
use crate::math::geometry::{
    Line, PathPoint, Point as ExactPoint, RationalPath, Vector as ExactVector, join_paths,
    shift_path, to_lines,
};
use crate::model::{
    AddOn as AddOnModel, Anchor, Corner, Device as DeviceModel, Gadget as GadgetModel, Junction,
    NodeId, Overlap, Path as JsonPath, Pattern as PatternModel, Piece as PieceModel,
    Point as JsonPoint,
};
use crate::shared::{QUADRANT_NUMBER, QuadrantDirection, make_per_quadrant, opposite};
use crate::sweep::overlap_test;
use crate::tree::BpTree;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegionShape {
    pub contour: RationalPath,
    pub ridges: Vec<Line>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnchorMap {
    pub point: ExactPoint,
    pub piece_index: Option<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PatternPiece {
    data: PieceModel,
    offset: JsonPoint,
}

impl PatternPiece {
    pub fn new(data: PieceModel) -> Self {
        Self {
            data,
            offset: JsonPoint { x: 0.0, y: 0.0 },
        }
    }

    pub fn to_json(&self) -> PieceModel {
        self.data.clone()
    }

    pub fn offset(&self) -> JsonPoint {
        self.offset
    }

    pub fn set_offset(&mut self, offset: JsonPoint) {
        if same_json_point(self.offset, offset) {
            return;
        }
        self.offset = offset;
    }

    pub fn sx(&self) -> f64 {
        self.data.oy + self.data.u + self.data.v
    }

    pub fn sy(&self) -> f64 {
        self.data.ox + self.data.u + self.data.v
    }

    pub fn reverse(&mut self, tx: f64, ty: f64) {
        let sx = self.sx();
        let sy = self.sy();
        let shift = self.data.shift.unwrap_or(JsonPoint { x: 0.0, y: 0.0 });
        self.data.shift = Some(JsonPoint {
            x: tx - sx - shift.x,
            y: ty - sy - shift.y,
        });
        self.data.detours = self.data.detours.take().map(|detours| {
            detours
                .into_iter()
                .map(|detour| {
                    detour
                        .into_iter()
                        .map(|point| JsonPoint {
                            x: sx - point.x,
                            y: sy - point.y,
                        })
                        .collect()
                })
                .collect()
        });
    }

    pub fn shrink(&mut self, by: f64) -> &mut Self {
        self.data.ox /= by;
        self.data.oy /= by;
        self.data.u /= by;
        self.data.v /= by;
        self
    }

    pub fn add_detour(&mut self, detour: JsonPath) {
        let detour = deduplicate_json_path(&detour);
        if detour.len() == 1 {
            return;
        }
        self.data.detours.get_or_insert_with(Vec::new).push(detour);
    }

    pub fn clear_detour(&mut self) {
        if self
            .data
            .detours
            .as_ref()
            .is_some_and(|detours| !detours.is_empty())
        {
            self.data.detours = None;
        }
    }

    pub fn anchors(&self) -> BpResult<[Option<ExactPoint>; QUADRANT_NUMBER]> {
        let (contour, _) = self.labeled_shape()?;
        let points = self.points()?;
        Ok([
            Some(points[0].clone()),
            find_original_point(&contour, 1),
            Some(points[2].clone()),
            find_original_point(&contour, 3),
        ])
    }

    pub fn direction(&self) -> BpResult<ExactVector> {
        ExactVector::from_numbers(
            self.data.oy * (self.data.ox + self.data.u),
            self.data.ox * (self.data.oy + self.data.v),
        )
    }

    pub fn shape(&self) -> BpResult<RegionShape> {
        let (contour, ridges) = self.labeled_shape()?;
        Ok(RegionShape {
            contour: contour.into_iter().map(|point| point.point).collect(),
            ridges,
        })
    }

    pub fn original_contour(&self) -> BpResult<RationalPath> {
        Ok(base_points(&self.data, &ExactVector::ZERO)?.to_vec())
    }

    pub fn axis_parallels(&self) -> BpResult<Vec<Line>> {
        axis_parallels(&self.shape()?, &self.direction()?)
    }

    fn points(&self) -> BpResult<[ExactPoint; QUADRANT_NUMBER]> {
        base_points(&self.data, &self.shift()?)
    }

    fn shift(&self) -> BpResult<ExactVector> {
        let shift = self.data.shift.unwrap_or(JsonPoint { x: 0.0, y: 0.0 });
        ExactVector::from_numbers(shift.x + self.offset.x, shift.y + self.offset.y)
    }

    fn labeled_shape(&self) -> BpResult<(Vec<LabeledPoint>, Vec<Line>)> {
        let mut contour = self
            .points()?
            .into_iter()
            .enumerate()
            .map(|(index, point)| LabeledPoint {
                point,
                original_index: Some(index),
            })
            .collect::<Vec<_>>();
        let mut ridges = to_lines(&labeled_points(&contour));
        if let Some(detours) = &self.data.detours {
            for detour in detours {
                self.process_detour(&mut ridges, &mut contour, detour)?;
            }
        }
        Ok((contour, ridges))
    }

    fn process_detour(
        &self,
        ridges: &mut Vec<Line>,
        contour: &mut Vec<LabeledPoint>,
        detour: &[JsonPoint],
    ) -> BpResult<()> {
        if detour.len() < 2 {
            return Ok(());
        }
        let shift = self.shift()?;
        let detour = detour
            .iter()
            .map(|point| exact_point(*point).map(|point| point.add_vector(&shift)))
            .collect::<BpResult<Vec<_>>>()?;
        let start = &detour[0];
        let end = &detour[detour.len() - 1];

        let mut detour_lines = Vec::new();
        for i in 0..detour.len() - 1 {
            detour_lines.push(Line::new(detour[i].clone(), detour[i + 1].clone()));
        }

        let len = ridges.len();
        for i in 0..len {
            let starts_on_endpoint = ridges[i].p1.equals(start);
            if !starts_on_endpoint && !ridges[i].contains(start, true) {
                continue;
            }

            for j in 1..len {
                let k = (j + i) % len;
                if !ridges[k].p1.equals(end) && !ridges[k].contains(end, true) {
                    continue;
                }

                let tail = if k < i { len - i } else { j + 1 };
                let head = j + 1 - tail;
                let mut points = detour
                    .iter()
                    .cloned()
                    .map(|point| LabeledPoint {
                        point,
                        original_index: None,
                    })
                    .collect::<Vec<_>>();
                let mut lines = detour_lines.clone();
                lines.push(Line::new(end.clone(), ridges[k].p2.clone()));
                if !starts_on_endpoint {
                    points.insert(0, contour[i].clone());
                    lines.insert(0, Line::new(ridges[i].p1.clone(), start.clone()));
                }
                contour.splice(i..i + tail, points);
                ridges.splice(i..i + tail, lines);
                if head > 0 {
                    contour.drain(0..head);
                    ridges.drain(0..head);
                }
                return Ok(());
            }
            return Err(BpError::InvalidInput(
                "detour endpoint does not reconnect to piece contour".to_string(),
            ));
        }
        Err(BpError::InvalidInput(
            "detour start is not on piece contour".to_string(),
        ))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PatternAddOn {
    data: AddOnModel,
}

impl PatternAddOn {
    pub fn new(data: AddOnModel) -> Self {
        Self { data }
    }

    pub fn to_json(&self) -> AddOnModel {
        self.data.clone()
    }

    pub fn shape(&self) -> BpResult<RegionShape> {
        let contour = self
            .data
            .contour
            .iter()
            .map(|point| exact_point(*point))
            .collect::<BpResult<Vec<_>>>()?;
        let ridges = to_lines(&contour);
        Ok(RegionShape { contour, ridges })
    }

    pub fn direction(&self) -> BpResult<ExactVector> {
        exact_vector(self.data.dir)?.reduce_to_int()
    }

    pub fn axis_parallels(&self) -> BpResult<Vec<Line>> {
        axis_parallels(&self.shape()?, &self.direction()?)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PatternGadget {
    pieces: Vec<PatternPiece>,
    offset: Option<JsonPoint>,
    anchors: Option<Vec<Option<Anchor>>>,
}

impl PatternGadget {
    pub fn new(data: GadgetModel) -> Self {
        let offset = data.offset;
        let mut pieces = data
            .pieces
            .into_iter()
            .map(PatternPiece::new)
            .collect::<Vec<_>>();
        if let Some(offset) = offset {
            for piece in &mut pieces {
                piece.set_offset(offset);
            }
        }
        Self {
            pieces,
            offset,
            anchors: data.anchors,
        }
    }

    pub fn to_json(&self) -> GadgetModel {
        GadgetModel {
            pieces: self.pieces.iter().map(PatternPiece::to_json).collect(),
            offset: self.offset,
            anchors: self.anchors.clone(),
        }
    }

    pub fn pieces(&self) -> &[PatternPiece] {
        &self.pieces
    }

    pub fn anchors_json(&self) -> Option<&[Option<Anchor>]> {
        self.anchors.as_deref()
    }

    pub fn anchor_map(&self) -> BpResult<[AnchorMap; QUADRANT_NUMBER]> {
        make_per_quadrant(|q| self.anchor_for(q))
            .into_iter()
            .collect::<BpResult<Vec<_>>>()?
            .try_into()
            .map_err(|_| BpError::InvalidInput("invalid quadrant anchor count".to_string()))
    }

    pub fn width_span(&self) -> BpResult<f64> {
        let anchors = self.anchor_map()?;
        Ok(anchors[2].point.x.value().ceil() - anchors[0].point.x.value().floor())
    }

    pub fn height_span(&self) -> BpResult<f64> {
        let anchors = self.anchor_map()?;
        Ok(anchors[2].point.y.value().ceil() - anchors[0].point.y.value().floor())
    }

    pub fn slack(&self, q: QuadrantDirection) -> f64 {
        self.anchors
            .as_ref()
            .and_then(|anchors| anchors.get(q as usize))
            .and_then(Option::as_ref)
            .and_then(|anchor| anchor.slack)
            .unwrap_or(0.0)
    }

    pub fn slacks(&self) -> [f64; QUADRANT_NUMBER] {
        make_per_quadrant(|q| self.slack(q))
    }

    pub fn contour(&self) -> BpResult<RationalPath> {
        let Some(first) = self.pieces.first() else {
            return Err(BpError::InvalidInput("gadget has no pieces".to_string()));
        };
        let mut contour = first.shape()?.contour;
        for piece in self.pieces.iter().skip(1) {
            contour = join_paths(&contour, &piece.shape()?.contour);
        }
        Ok(contour)
    }

    pub fn rx(&self, q1: QuadrantDirection, q2: QuadrantDirection) -> BpResult<f64> {
        let anchors = self.anchor_map()?;
        Ok(
            (anchors[q1 as usize].point.x.value() - anchors[q2 as usize].point.x.value())
                .abs()
                .ceil(),
        )
    }

    pub fn reverse_gps(&self) -> BpResult<Self> {
        if self.pieces.len() < 2 {
            return Err(BpError::InvalidInput(
                "reverse GPS requires at least two pieces".to_string(),
            ));
        }
        let mut gadget = Self::new(self.to_json());
        let sx = gadget
            .pieces
            .iter()
            .take(2)
            .map(PatternPiece::sx)
            .fold(f64::NEG_INFINITY, f64::max)
            .ceil();
        let sy = gadget
            .pieces
            .iter()
            .take(2)
            .map(PatternPiece::sy)
            .fold(f64::NEG_INFINITY, f64::max)
            .ceil();
        for piece in gadget.pieces.iter_mut().take(2) {
            piece.reverse(sx, sy);
        }
        Ok(gadget)
    }

    pub fn add_slack(&mut self, q: QuadrantDirection, slack: f64) -> &mut Self {
        if slack != 0.0 {
            let q = q as usize;
            let anchors = self.anchors.get_or_insert_with(Vec::new);
            if anchors.len() <= q {
                anchors.resize_with(q + 1, || None);
            }
            let anchor = anchors[q].get_or_insert(Anchor {
                slack: None,
                location: None,
            });
            anchor.slack = Some(anchor.slack.unwrap_or(0.0) + slack);
        }
        self
    }

    pub fn setup_connection_slack(
        &mut self,
        target: &Self,
        q1: QuadrantDirection,
        q2: QuadrantDirection,
    ) -> BpResult<()> {
        let target_contour = target.contour()?;
        let f = if q1 == QuadrantDirection::Ur { 1 } else { -1 };
        let step = ExactVector::from_integers(f, f);
        let slack = BpFraction::from_number(self.slack(q1))?;
        let target_anchor = &target.anchor_map()?[q2 as usize].point;
        let target_vector = point_as_vector(target_anchor);
        let v = add_vectors(&target_vector, &step.scale(&slack));
        let self_anchor = &self.anchor_map()?[QuadrantDirection::Ll as usize].point;
        let c0_shift = if q1 == QuadrantDirection::Ur {
            v
        } else {
            add_vectors(&v, &point_as_vector(self_anchor).negated())
        };
        let mut shifted = shift_path(&self.contour()?, &c0_shift);

        let mut slack_steps = 0.0;
        let target_path = exact_path_to_path_points(&target_contour);
        while overlap_test(&[exact_path_to_path_points(&shifted), target_path.clone()]) {
            shifted = shift_path(&shifted, &step);
            slack_steps += 1.0;
        }
        self.add_slack(q1, slack_steps);
        Ok(())
    }

    pub fn intersects(&self, point: &ExactPoint, vector: &ExactVector) -> BpResult<bool> {
        for line in to_lines(&self.contour()?) {
            if let Some(intersection) = line.intersection(point, vector, true, false)
                && !intersection.equals(point)
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn simplify(gadget: &mut GadgetModel) {
        if gadget
            .offset
            .is_some_and(|offset| offset.x == 0.0 && offset.y == 0.0)
        {
            gadget.offset = None;
        }
        gadget.anchors = None;
    }

    fn anchor_for(&self, q: QuadrantDirection) -> BpResult<AnchorMap> {
        if let Some(location) = self
            .anchors
            .as_ref()
            .and_then(|anchors| anchors.get(q as usize))
            .and_then(Option::as_ref)
            .and_then(|anchor| anchor.location)
        {
            let mut point = exact_point(location)?;
            if let Some(offset) = self.offset {
                point = point.add_vector(&exact_vector(offset)?);
            }
            return Ok(AnchorMap {
                point,
                piece_index: None,
            });
        }

        if self.pieces.len() == 1 {
            let anchors = self.pieces[0].anchors()?;
            let point = anchors[q as usize]
                .clone()
                .ok_or_else(|| BpError::InvalidInput(format!("piece has no anchor {}", q as u8)))?;
            return Ok(AnchorMap {
                point,
                piece_index: Some(0),
            });
        }

        for (index, piece) in self.pieces.iter().enumerate() {
            if let Some(point) = piece.anchors()?[q as usize].clone() {
                return Ok(AnchorMap {
                    point,
                    piece_index: Some(index),
                });
            }
        }

        Err(BpError::InvalidInput(format!(
            "gadget has no anchor {}",
            q as u8
        )))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PatternDevice {
    gadgets: Vec<PatternGadget>,
    add_ons: Vec<PatternAddOn>,
    offset: f64,
    location: JsonPoint,
    anchors: Option<Vec<[ExactPoint; QUADRANT_NUMBER]>>,
    original_displacement: Option<ExactVector>,
    delta: Option<ExactVector>,
}

impl PatternDevice {
    pub fn new(data: DeviceModel) -> Self {
        let offset = data.offset.unwrap_or(0.0);
        Self {
            gadgets: data.gadgets.into_iter().map(PatternGadget::new).collect(),
            add_ons: data
                .add_ons
                .unwrap_or_default()
                .into_iter()
                .map(PatternAddOn::new)
                .collect(),
            offset,
            location: JsonPoint {
                x: offset,
                y: offset,
            },
            anchors: None,
            original_displacement: None,
            delta: None,
        }
    }

    pub fn to_json(&self) -> DeviceModel {
        DeviceModel {
            gadgets: self.gadgets.iter().map(PatternGadget::to_json).collect(),
            offset: Some(self.offset),
            add_ons: (!self.add_ons.is_empty())
                .then(|| self.add_ons.iter().map(PatternAddOn::to_json).collect()),
        }
    }

    pub fn gadgets(&self) -> &[PatternGadget] {
        &self.gadgets
    }

    pub fn add_ons(&self) -> &[PatternAddOn] {
        &self.add_ons
    }

    pub fn offset(&self) -> f64 {
        self.offset
    }

    pub fn location(&self) -> JsonPoint {
        self.location
    }

    pub fn initialized(&self) -> bool {
        self.original_displacement.is_some()
    }

    pub fn transformed_anchors(&self) -> Option<&[[ExactPoint; QUADRANT_NUMBER]]> {
        self.anchors.as_deref()
    }

    pub fn set_offset_shell(&mut self, offset: f64, factor: JsonPoint) {
        self.offset = offset;
        self.location = JsonPoint {
            x: offset * factor.x,
            y: offset * factor.y,
        };
    }

    pub fn move_to_location(
        &mut self,
        location: JsonPoint,
        origin: JsonPoint,
        factor: JsonPoint,
        current_displacement: &ExactVector,
    ) -> BpResult<()> {
        if !location.x.is_finite() || !location.y.is_finite() {
            return Err(BpError::InvalidInput(format!(
                "device location must be finite: {}, {}",
                location.x, location.y
            )));
        }
        let original_displacement = self.original_displacement.as_ref().ok_or_else(|| {
            BpError::InvalidInput("device move requires initialization".to_string())
        })?;
        let dx = current_displacement.x.value() - original_displacement.x.value();
        self.location = location;
        self.offset = (location.x - dx) * factor.x;
        self.update_position(origin, factor)
    }

    pub fn resolve_corner_map(&self, map: &LayoutCornerMap) -> BpResult<ExactPoint> {
        self.anchor_at(map.overlap_index, map.anchor_index)
    }

    pub fn axis_parallels_local(&self) -> BpResult<Vec<Line>> {
        let mut result = Vec::new();
        for region in self.regions() {
            result.extend(region.axis_parallels()?);
        }
        Ok(result)
    }

    pub fn contours_local(&self) -> BpResult<Vec<JsonPath>> {
        self.regions()
            .into_iter()
            .map(|region| {
                region
                    .shape()
                    .map(|shape| shape.contour.iter().map(exact_point_to_json).collect())
            })
            .collect()
    }

    pub fn axis_parallels_transformed(&self, factor: JsonPoint) -> BpResult<Vec<Line>> {
        let mut result = Vec::new();
        for line in self.axis_parallels_local()? {
            result.push(self.transform_line(&line, factor)?);
        }
        Ok(result)
    }

    pub fn contours_transformed(&self, factor: JsonPoint) -> BpResult<Vec<JsonPath>> {
        self.regions()
            .into_iter()
            .map(|region| {
                region.shape().and_then(|shape| {
                    shape
                        .contour
                        .iter()
                        .map(|point| {
                            self.transform_point(point, factor)
                                .map(|point| exact_point_to_json(&point))
                        })
                        .collect()
                })
            })
            .collect()
    }

    pub fn inner_ridges_local(&self) -> BpResult<Vec<Line>> {
        let regions = self.regions();
        let mut result = Vec::new();
        for (index, region) in regions.iter().enumerate() {
            let direction = region.direction()?;
            let mut lines = Vec::new();
            for (other_index, other) in regions.iter().enumerate() {
                if index == other_index {
                    continue;
                }
                let other_direction = other.direction()?;
                if !other_direction.parallel(&direction) {
                    continue;
                }
                for line in other.shape()?.ridges {
                    if !line.perpendicular(&other_direction) {
                        lines.push(line);
                    }
                }
            }
            result.extend(Line::subtract(&region.shape()?.ridges, &lines));
        }
        Ok(Line::distinct(result))
    }

    pub fn draw_ridges(&self) -> BpResult<Vec<Line>> {
        Err(BpError::UnsupportedOperation {
            upstream: "src/core/design/layout/pattern/device.ts#$drawRidges",
            reason: "device ridge drawing needs positioned pattern/configuration wiring",
        })
    }

    pub fn signature(devices: &[DeviceModel]) -> BpResult<String> {
        let mut devices = devices.to_vec();
        for device in &mut devices {
            for gadget in &mut device.gadgets {
                PatternGadget::simplify(gadget);
            }
            device.offset = None;
        }
        Ok(serde_json::to_string(&devices)?)
    }

    fn regions(&self) -> Vec<PatternRegion<'_>> {
        let mut regions = Vec::new();
        for gadget in &self.gadgets {
            for piece in gadget.pieces() {
                regions.push(PatternRegion::Piece(piece));
            }
        }
        for add_on in &self.add_ons {
            regions.push(PatternRegion::AddOn(add_on));
        }
        regions
    }

    fn initialize(
        &mut self,
        original_displacement: ExactVector,
        origin: JsonPoint,
        factor: JsonPoint,
    ) -> BpResult<()> {
        self.original_displacement = Some(original_displacement);
        self.update_position(origin, factor)
    }

    fn update_position(&mut self, origin: JsonPoint, factor: JsonPoint) -> BpResult<()> {
        let original_displacement = self.original_displacement.as_ref().ok_or_else(|| {
            BpError::InvalidInput("device position update requires initialization".to_string())
        })?;
        let origin = exact_point(origin)?.add_vector(original_displacement);
        let delta = add_vectors(&point_as_vector(&origin), &exact_vector(self.location)?);
        let mut anchors = Vec::new();
        for gadget in &self.gadgets {
            let anchor_map = gadget.anchor_map()?;
            let transformed = anchor_map
                .iter()
                .map(|anchor| transform_point_with_factor(&anchor.point, factor, &delta))
                .collect::<BpResult<Vec<_>>>()?
                .try_into()
                .map_err(|_| {
                    BpError::InvalidInput("invalid transformed anchor count".to_string())
                })?;
            anchors.push(transformed);
        }
        self.delta = Some(delta);
        self.anchors = Some(anchors);
        Ok(())
    }

    fn anchor_at(&self, overlap_index: usize, q: QuadrantDirection) -> BpResult<ExactPoint> {
        self.anchors
            .as_ref()
            .and_then(|anchors| anchors.get(overlap_index))
            .map(|anchors| anchors[q as usize].clone())
            .ok_or_else(|| BpError::InvalidInput("device anchor is not initialized".to_string()))
    }

    fn transform_point(&self, point: &ExactPoint, factor: JsonPoint) -> BpResult<ExactPoint> {
        transform_point_with_factor(point, factor, self.delta()?)
    }

    fn transform_line(&self, line: &Line, factor: JsonPoint) -> BpResult<Line> {
        transform_line_with_factor(line, factor, self.delta()?)
    }

    fn delta(&self) -> BpResult<&ExactVector> {
        self.delta
            .as_ref()
            .ok_or_else(|| BpError::InvalidInput("device delta is not initialized".to_string()))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayoutPattern {
    devices: Vec<PatternDevice>,
    valid: bool,
    origin_dirty: bool,
}

impl LayoutPattern {
    pub fn new_seeded(data: PatternModel) -> Self {
        Self {
            devices: data.devices.into_iter().map(PatternDevice::new).collect(),
            valid: true,
            origin_dirty: false,
        }
    }

    pub fn new_positioned(
        data: PatternModel,
        config: &LayoutConfiguration,
        junctions: &[Junction],
        factor: JsonPoint,
    ) -> BpResult<Self> {
        let mut pattern = Self {
            devices: data.devices.into_iter().map(PatternDevice::new).collect(),
            valid: false,
            origin_dirty: false,
        };
        pattern.apply_offset_factor(factor);
        pattern.valid = pattern.position(config, junctions, factor)?;
        Ok(pattern)
    }

    pub fn new_positioned_with_repo(
        data: PatternModel,
        config: &LayoutConfiguration,
        repo: &mut LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<Self> {
        let mut pattern = Self {
            devices: data.devices.into_iter().map(PatternDevice::new).collect(),
            valid: false,
            origin_dirty: false,
        };
        pattern.apply_offset_factor(repo.f);
        pattern.valid = pattern.position_with_repo(config, repo, tree)?;
        if pattern.valid {
            pattern.initialize_devices_with_repo(config, repo, tree)?;
        }
        Ok(pattern)
    }

    pub fn new_unpositioned(_data: PatternModel) -> BpResult<Self> {
        Err(BpError::UnsupportedOperation {
            upstream: "src/core/design/layout/pattern/pattern.ts#_position",
            reason: "unpositioned pattern construction requires configuration and repository context",
        })
    }

    pub fn to_json(&self) -> PatternModel {
        PatternModel {
            devices: self.devices.iter().map(PatternDevice::to_json).collect(),
        }
    }

    pub fn devices(&self) -> &[PatternDevice] {
        &self.devices
    }

    pub fn gadgets(&self) -> Vec<&PatternGadget> {
        self.devices
            .iter()
            .flat_map(|device| device.gadgets())
            .collect()
    }

    pub fn valid(&self) -> bool {
        self.valid
    }

    pub fn origin_dirty(&self) -> bool {
        self.origin_dirty
    }

    pub fn mark_origin_dirty(&mut self) {
        self.origin_dirty = true;
    }

    pub fn apply_offset_factor(&mut self, factor: JsonPoint) {
        for device in &mut self.devices {
            device.set_offset_shell(device.offset(), factor);
        }
    }

    pub fn try_update_origin_shell(&mut self) -> bool {
        if !self.origin_dirty {
            return false;
        }
        self.origin_dirty = false;
        true
    }

    pub fn initialize_devices_with_repo(
        &mut self,
        config: &LayoutConfiguration,
        repo: &LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<()> {
        if self.devices.len() != config.partitions.len() {
            return Err(BpError::InvalidInput(
                "pattern device count does not match configuration partitions".to_string(),
            ));
        }

        let mut remaining = (0..self.devices.len()).collect::<BTreeSet<_>>();
        while !remaining.is_empty() {
            let before = remaining.len();
            let indices = remaining.iter().copied().collect::<Vec<_>>();
            for device_index in indices {
                let partition = config
                    .partitions
                    .get(device_index)
                    .ok_or_else(|| BpError::InvalidInput("missing device partition".to_string()))?;
                let connection = partition.displacement_reference().ok_or_else(|| {
                    BpError::InvalidInput("device has no displacement reference".to_string())
                })?;
                if !self.connection_target_ready(config, connection)? {
                    continue;
                }
                let target = self.connection_target(config, connection, tree)?;
                let origin = exact_point(repo.origin)?;
                let original_displacement = target.sub_point(&origin);
                self.devices
                    .get_mut(device_index)
                    .ok_or_else(|| BpError::InvalidInput("missing device".to_string()))?
                    .initialize(original_displacement, repo.origin, repo.f)?;
                remaining.remove(&device_index);
            }
            if remaining.len() == before {
                return Err(BpError::InvalidInput(
                    "device initialization dependencies could not be resolved".to_string(),
                ));
            }
        }
        Ok(())
    }

    pub fn connection_target(
        &self,
        config: &LayoutConfiguration,
        connection: &Corner,
        tree: &BpTree,
    ) -> BpResult<ExactPoint> {
        let target = connection
            .e
            .ok_or_else(|| BpError::InvalidInput("connection has no target".to_string()))?;
        let q = connection
            .q
            .map(quadrant_direction_from_u8)
            .ok_or_else(|| BpError::InvalidInput("connection has no quadrant".to_string()))??;
        if target >= 0 {
            let id = NodeId::try_from(target)
                .map_err(|_| BpError::InvalidInput(format!("invalid node id {target}")))?;
            let point = tree
                .node(id)
                .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {id}")))?
                .aabb
                .points[q as usize];
            return ExactPoint::from_numbers(point.x, point.y);
        }

        let [device_index, overlap_index] = overlap_lookup(config, target)?;
        self.devices
            .get(device_index)
            .ok_or_else(|| BpError::InvalidInput("connection device is missing".to_string()))?
            .anchor_at(overlap_index, q)
    }

    pub fn connection_ridges(
        &self,
        device_index: usize,
        config: &LayoutConfiguration,
        internal_only: bool,
        tree: &BpTree,
    ) -> BpResult<Vec<Ridge>> {
        let device = self.device(device_index)?;
        let partition = config_partition(config, device_index)?;
        let mut result = Vec::new();
        for (overlap_index, overlap) in partition.overlaps.iter().enumerate() {
            for (q, corner) in overlap.c.iter().enumerate() {
                let corner_type = pattern_corner_type(corner.corner_type)?;
                if corner_type == CornerType::Internal
                    || corner_type == CornerType::Flap && !internal_only
                {
                    let q = quadrant_direction_from_index(q)?;
                    result.push(Ridge::new(Line::new(
                        device.anchor_at(overlap_index, q)?,
                        self.connection_target(config, corner, tree)?,
                    )));
                }
            }
        }
        Ok(result)
    }

    pub fn raw_ridges(
        &self,
        device_index: usize,
        config: &LayoutConfiguration,
        repo: &LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<Vec<Ridge>> {
        let device = self.device(device_index)?;
        let mut result = Vec::new();
        for line in device.inner_ridges_local()? {
            result.push(Ridge::new(device.transform_line(&line, repo.f)?));
        }
        result.extend(self.outer_ridges(device_index, config, repo, tree)?);
        Ok(result)
    }

    pub fn trace_ridges(
        &self,
        device_index: usize,
        config: &LayoutConfiguration,
        repo: &LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<Vec<Ridge>> {
        Ok(self
            .ridges(device_index, config, repo, tree)?
            .into_iter()
            .filter(|ridge| ridge.corner_type != Some(CornerType::Side))
            .collect())
    }

    pub fn draw_ridges(
        &self,
        device_index: usize,
        config: &LayoutConfiguration,
        repo: &LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<Vec<Line>> {
        let device = self.device(device_index)?;
        let partition = config_partition(config, device_index)?;
        let mut result = self
            .ridges(device_index, config, repo, tree)?
            .into_iter()
            .filter(|ridge| ridge.corner_type != Some(CornerType::Intersection))
            .map(|ridge| ridge.line)
            .collect::<Vec<_>>();
        for map in partition.external_corner_maps() {
            if pattern_corner_type(map.corner.corner_type)? != CornerType::Intersection {
                continue;
            }
            let from = device.resolve_corner_map(map)?;
            if let Some(to) = partition.external_connection_target(
                exact_point_to_json(&from),
                map,
                &config.partitions,
                repo,
                tree,
                None,
            )? {
                result.push(Line::new(from, exact_point(to)?));
            }
        }
        Ok(result)
    }

    pub fn axis_parallels(
        &self,
        device_index: usize,
        repo: &LayoutRepository,
    ) -> BpResult<Vec<Line>> {
        self.device(device_index)?
            .axis_parallels_transformed(repo.f)
    }

    pub fn contours(
        &self,
        device_index: usize,
        repo: &LayoutRepository,
    ) -> BpResult<Vec<JsonPath>> {
        self.device(device_index)?.contours_transformed(repo.f)
    }

    pub fn move_device(
        &mut self,
        device_index: usize,
        location: JsonPoint,
        config: &LayoutConfiguration,
        repo: &LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<JsonPoint> {
        let old_location = self.device(device_index)?.location();
        let partition = config_partition(config, device_index)?;
        let connection = partition.displacement_reference().ok_or_else(|| {
            BpError::InvalidInput("device has no displacement reference".to_string())
        })?;
        let origin = exact_point(repo.origin)?;
        let target = self.connection_target(config, connection, tree)?;
        let current_displacement = target.sub_point(&origin);
        self.devices
            .get_mut(device_index)
            .ok_or_else(|| BpError::InvalidInput(format!("missing device {device_index}")))?
            .move_to_location(location, repo.origin, repo.f, &current_displacement)?;
        Ok(old_location)
    }

    pub fn dragging_range(
        &self,
        device_index: usize,
        config: &LayoutConfiguration,
        repo: &LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<[f64; 2]> {
        let device = self.device(device_index)?;
        let partition = config_partition(config, device_index)?;
        let mut result = [f64::NEG_INFINITY, f64::INFINITY];
        for map in partition.constraints() {
            let corner_type = pattern_corner_type(map.corner.corner_type)?;
            let is_out = corner_type != CornerType::Socket;
            let q = if is_out {
                map.anchor_index
            } else {
                map.corner
                    .q
                    .map(quadrant_direction_from_u8)
                    .ok_or_else(|| {
                        BpError::InvalidInput("socket constraint has no quadrant".to_string())
                    })??
            };
            let f = repo.f.x
                * if q == QuadrantDirection::Ur {
                    -1.0
                } else {
                    1.0
                };
            let target = self.connection_target(config, &map.corner, tree)?;
            let from = device.resolve_corner_map(map)?;
            let self_slack = device
                .gadgets
                .get(map.overlap_index)
                .ok_or_else(|| BpError::InvalidInput("constraint gadget is missing".to_string()))?
                .slack(map.anchor_index);
            let target_slack = if let Some(e) = map.corner.e
                && e < 0
            {
                let q = map
                    .corner
                    .q
                    .map(quadrant_direction_from_u8)
                    .ok_or_else(|| {
                        BpError::InvalidInput("target slack corner has no quadrant".to_string())
                    })??;
                self.gadget(overlap_index_from_code(Some(e))?)?.slack(q)
            } else {
                0.0
            };
            let slack = if is_out && corner_type != CornerType::Internal {
                self_slack
            } else {
                target_slack + self_slack
            };
            let bound = target.x.value() - from.x.value() - slack * f;
            if f > 0.0 && result[1] > bound {
                result[1] = bound;
            } else if f < 0.0 && result[0] < bound {
                result[0] = bound;
            }
        }
        Ok(result)
    }

    fn position(
        &mut self,
        config: &LayoutConfiguration,
        junctions: &[Junction],
        factor: JsonPoint,
    ) -> BpResult<bool> {
        let slack_map = self.setup_positioning_slack(config)?;
        if !self.check_junctions(config, junctions, &slack_map)? {
            return Ok(false);
        }

        if config.single_mode || junctions.len() == 1 {
            return self.position_single_junction(config, junctions, factor);
        }
        if junctions.len() == 2 {
            return Err(BpError::UnsupportedOperation {
                upstream: "src/core/design/layout/pattern/positioners/twoJunctionPositioner.ts",
                reason: "two-junction relay and split-join positioners have not been ported yet",
            });
        }
        Ok(false)
    }

    fn position_with_repo(
        &mut self,
        config: &LayoutConfiguration,
        repo: &mut LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<bool> {
        let junctions = repo.junctions.clone();
        let factor = repo.f;
        let slack_map = self.setup_positioning_slack(config)?;
        if !self.check_junctions(config, &junctions, &slack_map)? {
            return Ok(false);
        }

        if config.single_mode || junctions.len() == 1 {
            return self.position_single_junction(config, &junctions, factor);
        }
        if junctions.len() == 2 {
            return self.position_two_junction(config, &junctions, factor, &slack_map, repo, tree);
        }
        Ok(false)
    }

    fn setup_positioning_slack(
        &mut self,
        config: &LayoutConfiguration,
    ) -> BpResult<BTreeMap<(usize, usize), f64>> {
        let mut slack_map = BTreeMap::new();
        for (index, overlap) in config.overlaps.iter().enumerate() {
            for q in 0..QUADRANT_NUMBER {
                let Some(corner) = overlap.c.get(q) else {
                    return Err(BpError::InvalidInput(
                        "overlap has fewer than four corners".to_string(),
                    ));
                };
                if corner.corner_type != CornerType::Internal as u8 {
                    continue;
                }
                let target_index = overlap_index_from_code(corner.e)?;
                let target_overlap = config.overlaps.get(target_index).ok_or_else(|| {
                    BpError::InvalidInput(format!("missing target overlap {target_index}"))
                })?;
                if q > 2 {
                    return Err(BpError::InvalidInput(
                        "internal corner is not a tip corner".to_string(),
                    ));
                }
                let opposite_index = 2 - q;
                let opposite_corner = target_overlap.c.get(opposite_index).ok_or_else(|| {
                    BpError::InvalidInput("target overlap has no opposite corner".to_string())
                })?;
                let id = overlap_id_from_index(index);
                let mutual = opposite_corner.corner_type == CornerType::Internal as u8
                    && opposite_corner.e == Some(id);
                let q1 = quadrant_direction_from_index(q)?;
                let q2 = quadrant_direction_from_u8(corner.q.ok_or_else(|| {
                    BpError::InvalidInput("internal corner has no quadrant".to_string())
                })?)?;
                if !mutual {
                    let target = self.gadget(target_index)?.clone();
                    self.gadget_mut(index)?
                        .setup_connection_slack(&target, q1, q2)?;
                } else {
                    let g1 = self.gadget(index)?;
                    let g2 = self.gadget(target_index)?;
                    let tx1 = g1.width_span()? + g2.rx(q1, q2)?;
                    let tx2 = g2.width_span()?
                        + g1.rx(quadrant_direction_from_index(opposite_index)?, opposite(q2))?;
                    if tx2 > tx1 {
                        slack_map.insert((index, q1 as usize), tx2 - tx1);
                    }
                }
            }
        }
        Ok(slack_map)
    }

    fn check_junctions(
        &self,
        config: &LayoutConfiguration,
        junctions: &[Junction],
        slack_map: &BTreeMap<(usize, usize), f64>,
    ) -> BpResult<bool> {
        if junctions.len() == 1 && self.flat_gadget_count() == 1 {
            return Ok(true);
        }

        let mut span_cache = BTreeMap::new();
        if config.single_mode {
            let index = config
                .overlaps
                .first()
                .ok_or_else(|| BpError::InvalidInput("configuration has no overlaps".to_string()))?
                .parent;
            return self.check_junction(config, junctions, slack_map, &mut span_cache, index);
        }

        for index in 0..junctions.len() {
            if !self.check_junction(config, junctions, slack_map, &mut span_cache, index)? {
                return Ok(false);
            }
        }
        Ok(true)
    }

    fn check_junction(
        &self,
        config: &LayoutConfiguration,
        junctions: &[Junction],
        slack_map: &BTreeMap<(usize, usize), f64>,
        span_cache: &mut BTreeMap<(usize, usize), f64>,
        index: usize,
    ) -> BpResult<bool> {
        let junction = junctions.get(index).ok_or_else(|| {
            BpError::InvalidInput(format!("missing positioning junction {index}"))
        })?;
        let mut max_span = 0.0;
        for (overlap_index, overlap) in config.overlaps.iter().enumerate() {
            if overlap.parent != index {
                continue;
            }
            let result = self.gadget(overlap_index)?.width_span()?
                + self.get_span(
                    config,
                    slack_map,
                    span_cache,
                    overlap_index,
                    QuadrantDirection::Ur,
                )?
                + self.get_span(
                    config,
                    slack_map,
                    span_cache,
                    overlap_index,
                    QuadrantDirection::Ll,
                )?;
            if result > max_span {
                max_span = result;
            }
        }
        Ok(junction.sx >= max_span)
    }

    fn get_span(
        &self,
        config: &LayoutConfiguration,
        slack_map: &BTreeMap<(usize, usize), f64>,
        span_cache: &mut BTreeMap<(usize, usize), f64>,
        index: usize,
        q: QuadrantDirection,
    ) -> BpResult<f64> {
        if let Some(span) = span_cache.get(&(index, q as usize)) {
            return Ok(*span);
        }

        let mut result = 0.0;
        if let Some(next) = self.next_span_index(config.overlaps.get(index), q)? {
            let corner = config
                .overlaps
                .get(index)
                .and_then(|overlap| overlap.c.get(q as usize))
                .ok_or_else(|| BpError::InvalidInput("span corner is missing".to_string()))?;
            if corner.corner_type == CornerType::Internal as u8 {
                let target_q = quadrant_direction_from_u8(corner.q.ok_or_else(|| {
                    BpError::InvalidInput("internal span corner has no quadrant".to_string())
                })?)?;
                result += self.gadget(next)?.rx(q, target_q)?
                    + self.connection_slack(config, slack_map, index, q)?;
            }
            result += self.get_span(config, slack_map, span_cache, next, q)?;
        }
        span_cache.insert((index, q as usize), result);
        Ok(result)
    }

    fn next_span_index(
        &self,
        overlap: Option<&Overlap>,
        q: QuadrantDirection,
    ) -> BpResult<Option<usize>> {
        let Some(overlap) = overlap else {
            return Err(BpError::InvalidInput("missing span overlap".to_string()));
        };
        let corner = overlap
            .c
            .get(q as usize)
            .ok_or_else(|| BpError::InvalidInput("span corner is missing".to_string()))?;
        if corner.corner_type == CornerType::Flap as u8 {
            return Ok(None);
        }
        Ok(Some(overlap_index_from_code(corner.e)?))
    }

    fn connection_slack(
        &self,
        config: &LayoutConfiguration,
        slack_map: &BTreeMap<(usize, usize), f64>,
        index: usize,
        q: QuadrantDirection,
    ) -> BpResult<f64> {
        if let Some(slack) = slack_map.get(&(index, q as usize)) {
            return Ok(*slack);
        }
        let _ = config
            .overlaps
            .get(index)
            .and_then(|overlap| overlap.c.get(q as usize))
            .ok_or_else(|| BpError::InvalidInput("slack corner is missing".to_string()))?;
        Ok(self.gadget(index)?.slack(q).floor())
    }

    fn position_single_junction(
        &mut self,
        config: &LayoutConfiguration,
        junctions: &[Junction],
        factor: JsonPoint,
    ) -> BpResult<bool> {
        if self.devices.is_empty() {
            return Err(BpError::InvalidInput(
                "single-junction pattern has no devices".to_string(),
            ));
        }
        let overlap = config
            .partitions
            .first()
            .and_then(|partition| partition.overlaps.first())
            .ok_or_else(|| BpError::InvalidInput("first partition has no overlap".to_string()))?;
        let sx = junctions
            .get(overlap.parent)
            .ok_or_else(|| BpError::InvalidInput("missing overlap parent junction".to_string()))?
            .sx;

        if self.devices.len() == 1 {
            let width = self
                .devices
                .first()
                .and_then(|device| device.gadgets.first())
                .ok_or_else(|| BpError::InvalidInput("device has no gadget".to_string()))?
                .width_span()?;
            self.devices[0].set_offset_shell(((sx - width) / 2.0).floor(), factor);
            return Ok(true);
        }

        if self.devices.len() == 2 {
            let q = config
                .partitions
                .get(1)
                .and_then(|partition| partition.overlaps.first())
                .and_then(|overlap| overlap.c.first())
                .and_then(|corner| corner.q)
                .ok_or_else(|| {
                    BpError::InvalidInput("second overlap first corner has no quadrant".to_string())
                })
                .and_then(quadrant_direction_from_u8)?;
            let g1 = self
                .devices
                .first()
                .and_then(|device| device.gadgets.first())
                .ok_or_else(|| BpError::InvalidInput("first device has no gadget".to_string()))?;
            let g2 = self
                .devices
                .get(1)
                .and_then(|device| device.gadgets.first())
                .ok_or_else(|| BpError::InvalidInput("second device has no gadget".to_string()))?;
            let tx = g2.width_span()? + g1.rx(q, QuadrantDirection::Ur)?;
            self.devices[1].set_offset_shell(sx - tx, factor);
            return Ok(true);
        }

        Err(BpError::UpstreamGap {
            upstream: "src/core/design/layout/pattern/positioners/singleJunctionPositioner.ts#todo-four-or-more-devices",
            todo: "single junction patterns that are integral but require four or more devices",
        })
    }

    fn position_two_junction(
        &mut self,
        config: &LayoutConfiguration,
        junctions: &[Junction],
        factor: JsonPoint,
        slack_map: &BTreeMap<(usize, usize), f64>,
        repo: &mut LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<bool> {
        let mut span_cache = BTreeMap::new();
        if self.devices.len() == 1 {
            self.push_join_device_towards_joint(
                config,
                junctions,
                factor,
                slack_map,
                &mut span_cache,
                0,
            )?;
            return Ok(true);
        }
        if self.devices.len() == 2 && config.overlaps.len() == 2 {
            return self.make_two_device_relay_pattern(
                config,
                factor,
                slack_map,
                &mut span_cache,
                repo,
                tree,
            );
        }
        self.make_split_join_pattern(config, junctions, factor, slack_map, &mut span_cache)
    }

    fn make_two_device_relay_pattern(
        &mut self,
        config: &LayoutConfiguration,
        factor: JsonPoint,
        slack_map: &BTreeMap<(usize, usize), f64>,
        span_cache: &mut BTreeMap<(usize, usize), f64>,
        repo: &mut LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<bool> {
        let junctions = repo.junctions.clone();
        let mut g1_index = 0usize;
        let mut g2_index = 1usize;
        let mut o1_index = 0usize;
        let mut o2_index = 1usize;
        let o2 = config
            .overlaps
            .get(o2_index)
            .ok_or_else(|| BpError::InvalidInput("missing relay overlap".to_string()))?;
        let reversed = corner_e_nonnegative(o2, QuadrantDirection::Ur)?
            && corner_e_nonnegative(o2, QuadrantDirection::Ll)?;
        if reversed {
            std::mem::swap(&mut g1_index, &mut g2_index);
            std::mem::swap(&mut o1_index, &mut o2_index);
        }

        let o1 = config
            .overlaps
            .get(o1_index)
            .ok_or_else(|| BpError::InvalidInput("missing first relay overlap".to_string()))?;
        let o2 = config
            .overlaps
            .get(o2_index)
            .ok_or_else(|| BpError::InvalidInput("missing second relay overlap".to_string()))?;
        let j1 = junctions
            .get(o1.parent)
            .ok_or_else(|| BpError::InvalidInput("missing first relay junction".to_string()))?;
        let j2 = junctions
            .get(o2.parent)
            .ok_or_else(|| BpError::InvalidInput("missing second relay junction".to_string()))?;
        let oriented = corner_e_value(o2, QuadrantDirection::Ur)? < 0;
        let delta = self.relative_delta(repo, tree, j1, j2, g1_index)?;
        let vector = if oriented {
            quadrant_vector(QuadrantDirection::Ur)
        } else {
            quadrant_vector(QuadrantDirection::Ll)
        };
        if self.gadget(g1_index)?.intersects(&delta, &vector)? {
            return Ok(false);
        }

        let slack_q = if oriented {
            QuadrantDirection::Ur
        } else {
            QuadrantDirection::Ll
        };
        let slack = self.gadget(g2_index)?.slack(slack_q).floor();
        let mut offsets = if oriented {
            [0.0, slack]
        } else {
            [
                j1.sx - self.gadget(g1_index)?.width_span()?,
                j2.sx
                    - self.span_without_immediate_slack(
                        config,
                        slack_map,
                        span_cache,
                        g2_index,
                        QuadrantDirection::Ll,
                    )?
                    - self.gadget(g2_index)?.width_span()?
                    - slack,
            ]
        };
        if reversed {
            offsets.reverse();
        }
        for (index, offset) in offsets.into_iter().enumerate() {
            self.devices
                .get_mut(index)
                .ok_or_else(|| BpError::InvalidInput("missing relay device".to_string()))?
                .set_offset_shell(offset, factor);
        }
        Ok(true)
    }

    fn make_split_join_pattern(
        &mut self,
        config: &LayoutConfiguration,
        junctions: &[Junction],
        factor: JsonPoint,
        slack_map: &BTreeMap<(usize, usize), f64>,
        span_cache: &mut BTreeMap<(usize, usize), f64>,
    ) -> BpResult<bool> {
        let mut non_join = Vec::new();
        for device_index in 0..self.devices.len() {
            if self.devices[device_index].gadgets.len() > 1 {
                self.push_join_device_towards_joint(
                    config,
                    junctions,
                    factor,
                    slack_map,
                    span_cache,
                    device_index,
                )?;
            } else {
                non_join.push(device_index);
            }
        }

        for device_index in non_join {
            let overlap = config
                .partitions
                .get(device_index)
                .and_then(|partition| partition.overlaps.first())
                .ok_or_else(|| {
                    BpError::InvalidInput("non-join device has no overlap".to_string())
                })?;
            let junction = junctions
                .get(overlap.parent)
                .ok_or_else(|| BpError::InvalidInput("non-join junction is missing".to_string()))?;
            let q_out = if corner_e_value(overlap, QuadrantDirection::Ur)? < 0 {
                QuadrantDirection::Ur
            } else {
                QuadrantDirection::Ll
            };
            let corner = overlap
                .c
                .get(q_out as usize)
                .ok_or_else(|| BpError::InvalidInput("non-join corner is missing".to_string()))?;
            let gadget_index = flat_gadget_index_for_partition(config, device_index, 0)?;
            let target_index = overlap_index_from_code(corner.e)?;
            let q = quadrant_direction_from_u8(corner.q.ok_or_else(|| {
                BpError::InvalidInput("non-join corner has no quadrant".to_string())
            })?)?;
            let target_corner = config
                .overlaps
                .get(target_index)
                .and_then(|overlap| overlap.c.get(q as usize))
                .ok_or_else(|| BpError::InvalidInput("target corner is missing".to_string()))?;
            let gadget = self.gadget(gadget_index)?;
            let mut offset = junction.sx
                - self.span_without_immediate_slack(
                    config,
                    slack_map,
                    span_cache,
                    gadget_index,
                    q_out,
                )?
                - gadget.width_span()?;
            if target_corner.corner_type == CornerType::Socket as u8 {
                offset += self.gadget(target_index)?.slack(q);
            }
            if offset < gadget.slack(q_out) {
                return Ok(false);
            }
            if q_out == QuadrantDirection::Ur {
                self.devices
                    .get_mut(device_index)
                    .ok_or_else(|| BpError::InvalidInput("missing non-join device".to_string()))?
                    .set_offset_shell(offset, factor);
            }
        }
        Ok(true)
    }

    fn push_join_device_towards_joint(
        &mut self,
        config: &LayoutConfiguration,
        junctions: &[Junction],
        factor: JsonPoint,
        slack_map: &BTreeMap<(usize, usize), f64>,
        span_cache: &mut BTreeMap<(usize, usize), f64>,
        device_index: usize,
    ) -> BpResult<()> {
        if self
            .devices
            .get(device_index)
            .ok_or_else(|| BpError::InvalidInput("missing join device".to_string()))?
            .gadgets
            .len()
            <= 1
        {
            return Ok(());
        }
        let partition = config
            .partitions
            .get(device_index)
            .ok_or_else(|| BpError::InvalidInput("join device partition is missing".to_string()))?;
        let o1 = partition.overlaps.first().ok_or_else(|| {
            BpError::InvalidInput("join device first overlap is missing".to_string())
        })?;
        let o2 = partition.overlaps.get(1).ok_or_else(|| {
            BpError::InvalidInput("join device second overlap is missing".to_string())
        })?;
        let j1 = junctions.get(o1.parent).ok_or_else(|| {
            BpError::InvalidInput("join device first junction is missing".to_string())
        })?;
        let j2 = junctions.get(o2.parent).ok_or_else(|| {
            BpError::InvalidInput("join device second junction is missing".to_string())
        })?;
        let oriented =
            j1.c.first().and_then(|corner| corner.e) == j2.c.first().and_then(|corner| corner.e);
        if !oriented {
            let gadget_index = flat_gadget_index_for_partition(config, device_index, 0)?;
            let offset = j1.sx
                - self.span_without_immediate_slack(
                    config,
                    slack_map,
                    span_cache,
                    gadget_index,
                    QuadrantDirection::Ur,
                )?
                - self.gadget(gadget_index)?.width_span()?;
            self.devices
                .get_mut(device_index)
                .ok_or_else(|| BpError::InvalidInput("missing join device".to_string()))?
                .set_offset_shell(offset, factor);
        }
        Ok(())
    }

    fn span_without_immediate_slack(
        &self,
        config: &LayoutConfiguration,
        slack_map: &BTreeMap<(usize, usize), f64>,
        span_cache: &mut BTreeMap<(usize, usize), f64>,
        index: usize,
        q: QuadrantDirection,
    ) -> BpResult<f64> {
        Ok(self.get_span(config, slack_map, span_cache, index, q)?
            - self.connection_slack(config, slack_map, index, q)?)
    }

    fn relative_delta(
        &self,
        repo: &mut LayoutRepository,
        tree: &BpTree,
        j1: &Junction,
        j2: &Junction,
        gadget_index: usize,
    ) -> BpResult<ExactPoint> {
        let oriented =
            j1.c.first().and_then(|corner| corner.e) == j2.c.first().and_then(|corner| corner.e);
        let distance = repo.get_max_intersection_distance(tree, j1, j2, oriented)?;
        let (wide, tall) = if j2.ox > j1.ox { (j2, j1) } else { (j1, j2) };
        let mut point = JsonPoint {
            x: distance - wide.ox,
            y: distance - tall.oy,
        };
        if !oriented {
            let gadget = self.gadget(gadget_index)?;
            point = JsonPoint {
                x: gadget.width_span()? - point.x,
                y: gadget.height_span()? - point.y,
            };
        }
        exact_point(point)
    }

    fn flat_gadget_count(&self) -> usize {
        self.devices.iter().map(|device| device.gadgets.len()).sum()
    }

    fn gadget(&self, flat_index: usize) -> BpResult<&PatternGadget> {
        let mut remaining = flat_index;
        for device in &self.devices {
            if remaining < device.gadgets.len() {
                return Ok(&device.gadgets[remaining]);
            }
            remaining -= device.gadgets.len();
        }
        Err(BpError::InvalidInput(format!(
            "missing gadget {flat_index}"
        )))
    }

    fn gadget_mut(&mut self, flat_index: usize) -> BpResult<&mut PatternGadget> {
        let mut remaining = flat_index;
        for device in &mut self.devices {
            if remaining < device.gadgets.len() {
                return Ok(&mut device.gadgets[remaining]);
            }
            remaining -= device.gadgets.len();
        }
        Err(BpError::InvalidInput(format!(
            "missing gadget {flat_index}"
        )))
    }

    fn connection_target_ready(
        &self,
        config: &LayoutConfiguration,
        connection: &Corner,
    ) -> BpResult<bool> {
        let Some(target) = connection.e else {
            return Ok(false);
        };
        if target >= 0 {
            return Ok(true);
        }
        let [device_index, _] = overlap_lookup(config, target)?;
        Ok(self
            .devices
            .get(device_index)
            .is_some_and(PatternDevice::initialized))
    }

    fn outer_ridges(
        &self,
        device_index: usize,
        config: &LayoutConfiguration,
        repo: &LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<Vec<Ridge>> {
        let device = self.device(device_index)?;
        let partition = config_partition(config, device_index)?;
        let mut result = self.connection_ridges(device_index, config, false, tree)?;
        for map in partition.external_corner_maps() {
            let from = device.resolve_corner_map(map)?;
            let direction = self.resolve_corner_direction(&map.corner, repo)?;
            if let Some(to) = partition.external_connection_target(
                exact_point_to_json(&from),
                map,
                &config.partitions,
                repo,
                tree,
                direction,
            )? {
                let corner_type = pattern_corner_type(map.corner.corner_type)?;
                let division = if corner_type == CornerType::Intersection {
                    Some(resolve_division_nodes(
                        partition.resolve_division(map, &repo.junctions)?,
                    )?)
                } else {
                    None
                };
                result.push(Ridge::with_type(
                    Line::new(from, exact_point(to)?),
                    corner_type,
                    division,
                ));
            }
        }
        Ok(result)
    }

    fn ridges(
        &self,
        device_index: usize,
        config: &LayoutConfiguration,
        repo: &LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<Vec<Ridge>> {
        let raw = self.raw_ridges(device_index, config, repo, tree)?;
        let mut neighbor_ridges = Vec::new();
        for neighbor_index in self.neighbor_indices(device_index, config)? {
            neighbor_ridges.extend(
                self.raw_ridges(neighbor_index, config, repo, tree)?
                    .into_iter()
                    .map(|ridge| ridge.line),
            );
        }
        Ok(subtract_ridges(raw, &neighbor_ridges))
    }

    fn neighbor_indices(
        &self,
        device_index: usize,
        config: &LayoutConfiguration,
    ) -> BpResult<Vec<usize>> {
        let partition = config_partition(config, device_index)?;
        let mut result = BTreeSet::new();
        for overlap in &partition.overlaps {
            for corner in &overlap.c {
                let corner_type = pattern_corner_type(corner.corner_type)?;
                if matches!(corner_type, CornerType::Socket | CornerType::Internal) {
                    let target = corner.e.ok_or_else(|| {
                        BpError::InvalidInput("neighbor corner has no target".to_string())
                    })?;
                    let [target_device, _] = overlap_lookup(config, target)?;
                    result.insert(target_device);
                }
            }
        }
        Ok(result.into_iter().collect())
    }

    fn resolve_corner_direction(
        &self,
        corner: &Corner,
        repo: &LayoutRepository,
    ) -> BpResult<Option<QuadrantDirection>> {
        if pattern_corner_type(corner.corner_type)? != CornerType::Intersection {
            return Ok(None);
        }
        let Some(target) = corner.e.and_then(|id| NodeId::try_from(id).ok()) else {
            return Ok(None);
        };
        Ok(repo
            .quadrants
            .keys()
            .find(|code| crate::shared::get_node_id(**code) == target)
            .map(|code| crate::shared::get_quadrant(*code)))
    }

    fn device(&self, device_index: usize) -> BpResult<&PatternDevice> {
        self.devices
            .get(device_index)
            .ok_or_else(|| BpError::InvalidInput(format!("missing device {device_index}")))
    }
}

pub fn axis_parallels(shape: &RegionShape, direction: &ExactVector) -> BpResult<Vec<Line>> {
    let reference = shape
        .contour
        .iter()
        .find(|point| point.is_integral())
        .ok_or_else(|| {
            BpError::InvalidInput("region has no integral reference point".to_string())
        })?;
    let step = direction.rotate90().normalize()?;
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    for point in &shape.contour {
        let units = point.sub_point(reference).dot(&step);
        if units > max {
            max = units;
        }
        if units < min {
            min = units;
        }
    }

    let mut result = Vec::new();
    for i in min.ceil() as i64..=max.floor() as i64 {
        let point = reference.add_vector(&step.scale(&BpFraction::from_integer(i)));
        let mut intersections = Vec::<ExactPoint>::new();
        for ridge in &shape.ridges {
            if let Some(intersection) = ridge.intersection(&point, direction, false, false)
                && intersections
                    .first()
                    .is_none_or(|first| !intersection.equals(first))
            {
                intersections.push(intersection);
            }
            if intersections.len() == 2 {
                result.push(Line::new(
                    intersections[0].clone(),
                    intersections[1].clone(),
                ));
                break;
            }
        }
    }
    Ok(result)
}

#[derive(Debug, Clone, Copy)]
enum PatternRegion<'a> {
    Piece(&'a PatternPiece),
    AddOn(&'a PatternAddOn),
}

impl PatternRegion<'_> {
    fn shape(&self) -> BpResult<RegionShape> {
        match self {
            Self::Piece(piece) => piece.shape(),
            Self::AddOn(add_on) => add_on.shape(),
        }
    }

    fn direction(&self) -> BpResult<ExactVector> {
        match self {
            Self::Piece(piece) => piece.direction(),
            Self::AddOn(add_on) => add_on.direction(),
        }
    }

    fn axis_parallels(&self) -> BpResult<Vec<Line>> {
        match self {
            Self::Piece(piece) => piece.axis_parallels(),
            Self::AddOn(add_on) => add_on.axis_parallels(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LabeledPoint {
    point: ExactPoint,
    original_index: Option<usize>,
}

fn base_points(data: &PieceModel, shift: &ExactVector) -> BpResult<[ExactPoint; QUADRANT_NUMBER]> {
    Ok([
        exact_point(JsonPoint { x: 0.0, y: 0.0 })?.add_vector(shift),
        exact_point(JsonPoint {
            x: data.u,
            y: data.ox + data.u,
        })?
        .add_vector(shift),
        exact_point(JsonPoint {
            x: data.oy + data.u + data.v,
            y: data.ox + data.u + data.v,
        })?
        .add_vector(shift),
        exact_point(JsonPoint {
            x: data.oy + data.v,
            y: data.v,
        })?
        .add_vector(shift),
    ])
}

fn find_original_point(contour: &[LabeledPoint], index: usize) -> Option<ExactPoint> {
    contour
        .iter()
        .find(|point| point.original_index == Some(index))
        .map(|point| point.point.clone())
}

fn labeled_points(points: &[LabeledPoint]) -> RationalPath {
    points.iter().map(|point| point.point.clone()).collect()
}

fn exact_point(point: JsonPoint) -> BpResult<ExactPoint> {
    ExactPoint::from_numbers(point.x, point.y)
}

fn exact_vector(point: JsonPoint) -> BpResult<ExactVector> {
    ExactVector::from_numbers(point.x, point.y)
}

fn point_as_vector(point: &ExactPoint) -> ExactVector {
    point.sub_point(&ExactPoint::ZERO)
}

fn add_vectors(a: &ExactVector, b: &ExactVector) -> ExactVector {
    ExactVector::new(a.x.add(&b.x), a.y.add(&b.y))
}

fn exact_path_to_path_points(path: &[ExactPoint]) -> Vec<PathPoint> {
    path.iter()
        .map(|point| {
            let (x, y) = point.value();
            PathPoint { x, y }
        })
        .collect()
}

fn exact_point_to_json(point: &ExactPoint) -> JsonPoint {
    let (x, y) = point.value();
    JsonPoint { x, y }
}

fn same_json_point(a: JsonPoint, b: JsonPoint) -> bool {
    a.x == b.x && a.y == b.y
}

fn transform_point_with_factor(
    point: &ExactPoint,
    factor: JsonPoint,
    delta: &ExactVector,
) -> BpResult<ExactPoint> {
    Ok(point
        .transform(exact_factor(factor.x)?, exact_factor(factor.y)?)
        .add_vector(delta))
}

fn transform_line_with_factor(
    line: &Line,
    factor: JsonPoint,
    delta: &ExactVector,
) -> BpResult<Line> {
    Ok(line
        .transform(exact_factor(factor.x)?, exact_factor(factor.y)?)
        .add(delta))
}

fn exact_factor(value: f64) -> BpResult<i64> {
    if value == 1.0 {
        Ok(1)
    } else if value == -1.0 {
        Ok(-1)
    } else {
        Err(BpError::InvalidInput(format!(
            "invalid pattern transform factor {value}"
        )))
    }
}

fn subtract_ridges(ridges: Vec<Ridge>, subtraction: &[Line]) -> Vec<Ridge> {
    let mut result = Vec::new();
    for ridge in ridges {
        let original = ridge.line.clone();
        let corner_type = ridge.corner_type;
        let division = ridge.division;
        for line in Line::subtract(std::slice::from_ref(&original), subtraction) {
            if line.equals(&original) {
                result.push(Ridge {
                    line,
                    corner_type,
                    division,
                });
            } else {
                result.push(Ridge::new(line));
            }
        }
    }
    result
}

fn config_partition(
    config: &LayoutConfiguration,
    device_index: usize,
) -> BpResult<&LayoutPartition> {
    config
        .partitions
        .get(device_index)
        .ok_or_else(|| BpError::InvalidInput(format!("missing partition {device_index}")))
}

fn overlap_lookup(config: &LayoutConfiguration, code: i64) -> BpResult<[usize; 2]> {
    config
        .overlap_map
        .get(&code)
        .copied()
        .ok_or_else(|| BpError::InvalidInput(format!("missing overlap reference {code}")))
}

fn resolve_division_nodes(division: [i64; 2]) -> BpResult<[NodeId; 2]> {
    Ok([
        NodeId::try_from(division[0])
            .map_err(|_| BpError::InvalidInput("invalid division node".to_string()))?,
        NodeId::try_from(division[1])
            .map_err(|_| BpError::InvalidInput("invalid division node".to_string()))?,
    ])
}

fn pattern_corner_type(value: u8) -> BpResult<CornerType> {
    match value {
        0 => Ok(CornerType::Socket),
        1 => Ok(CornerType::Internal),
        2 => Ok(CornerType::Side),
        3 => Ok(CornerType::Intersection),
        4 => Ok(CornerType::Flap),
        5 => Ok(CornerType::Coincide),
        _ => Err(BpError::InvalidInput(format!(
            "invalid corner type {value}"
        ))),
    }
}

fn overlap_id_from_index(index: usize) -> i64 {
    -(index as i64) - 1
}

fn overlap_index_from_code(code: Option<i64>) -> BpResult<usize> {
    let code = code.ok_or_else(|| BpError::InvalidInput("corner has no target".to_string()))?;
    let index = -code - 1;
    usize::try_from(index)
        .map_err(|_| BpError::InvalidInput(format!("invalid overlap reference {code}")))
}

fn flat_gadget_index_for_partition(
    config: &LayoutConfiguration,
    partition_index: usize,
    local_index: usize,
) -> BpResult<usize> {
    let mut result = 0;
    for (index, partition) in config.partitions.iter().enumerate() {
        if index == partition_index {
            if local_index < partition.overlaps.len() {
                return Ok(result + local_index);
            }
            return Err(BpError::InvalidInput(format!(
                "partition {partition_index} has no local overlap {local_index}"
            )));
        }
        result += partition.overlaps.len();
    }
    Err(BpError::InvalidInput(format!(
        "missing partition {partition_index}"
    )))
}

fn corner_e_value(overlap: &Overlap, q: QuadrantDirection) -> BpResult<i64> {
    overlap
        .c
        .get(q as usize)
        .and_then(|corner| corner.e)
        .ok_or_else(|| BpError::InvalidInput("corner has no target".to_string()))
}

fn corner_e_nonnegative(overlap: &Overlap, q: QuadrantDirection) -> BpResult<bool> {
    Ok(corner_e_value(overlap, q)? >= 0)
}

fn quadrant_vector(q: QuadrantDirection) -> ExactVector {
    match q {
        QuadrantDirection::Ur => ExactVector::from_integers(1, 1),
        QuadrantDirection::Ul => ExactVector::from_integers(-1, 1),
        QuadrantDirection::Ll => ExactVector::from_integers(-1, -1),
        QuadrantDirection::Lr => ExactVector::from_integers(1, -1),
    }
}

fn quadrant_direction_from_u8(value: u8) -> BpResult<QuadrantDirection> {
    quadrant_direction_from_index(value as usize)
}

fn quadrant_direction_from_index(value: usize) -> BpResult<QuadrantDirection> {
    match value {
        0 => Ok(QuadrantDirection::Ur),
        1 => Ok(QuadrantDirection::Ul),
        2 => Ok(QuadrantDirection::Ll),
        3 => Ok(QuadrantDirection::Lr),
        _ => Err(BpError::InvalidInput(format!(
            "invalid quadrant direction {value}"
        ))),
    }
}

fn deduplicate_json_path(path: &[JsonPoint]) -> JsonPath {
    let len = path.len();
    let mut result = Vec::with_capacity(len);
    for i in 0..len {
        let j = if i == 0 { len - 1 } else { i - 1 };
        if !same_json_point(path[j], path[i]) {
            result.push(path[i]);
        }
    }
    result
}
