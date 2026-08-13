use crate::data::double_map::IntDoubleMap;
use crate::data::heap::BinaryHeap;
use crate::data::union_find::ListUnionFind;
use crate::error::{BpError, BpResult};
use crate::math::geometry::{Line, Point as ExactPoint, Rectangle};
use crate::model::{
    Configuration as ConfigurationModel, Corner, Junction, NodeId, Overlap,
    Partition as PartitionModel, Point, Repository as RepositoryModel, Strategy,
    Stretch as StretchModel,
};
use crate::shared::{
    QUADRANT_NUMBER, QuadrantCode, QuadrantDirection, SlashDirection, get_node_id, get_quadrant,
    make_quadrant_code, opposite,
};
use crate::sweep::{ArcPath, rr_intersection};
use crate::tree::BpTree;
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::btree_map::Entry;
use std::collections::{BTreeMap, BTreeSet};

pub mod contours;
pub mod generators;
pub mod graphics;
pub mod joiner;
pub mod pattern;
pub mod trace;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CornerType {
    Socket = 0,
    Internal = 1,
    Side = 2,
    Intersection = 3,
    Flap = 4,
    Coincide = 5,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LayoutJunction {
    Valid(ValidJunction),
    Invalid(InvalidJunction),
}

impl LayoutJunction {
    pub fn valid(&self) -> bool {
        matches!(self, Self::Valid(_))
    }

    pub fn a(&self) -> NodeId {
        match self {
            Self::Valid(junction) => junction.a,
            Self::Invalid(junction) => junction.a,
        }
    }

    pub fn b(&self) -> NodeId {
        match self {
            Self::Valid(junction) => junction.b,
            Self::Invalid(junction) => junction.b,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct InvalidJunction {
    pub a: NodeId,
    pub b: NodeId,
    pub processed: bool,
    dist: f64,
}

impl InvalidJunction {
    pub fn new(tree: &BpTree, a: NodeId, b: NodeId, distance: f64) -> BpResult<Self> {
        let a_node = tree_node(tree, a)?;
        let b_node = tree_node(tree, b)?;
        Ok(Self {
            a,
            b,
            processed: false,
            dist: distance - a_node.length - b_node.length,
        })
    }

    pub fn distance_after_flap_radii(&self) -> f64 {
        self.dist
    }

    pub fn get_polygon(&mut self, tree: &BpTree) -> BpResult<Vec<ArcPath>> {
        let a = tree_node(tree, self.a)?;
        let b = tree_node(tree, self.b)?;
        let mut result = rr_intersection(&[
            a.aabb.to_rounded_rect(0.0),
            b.aabb.to_rounded_rect(self.dist),
        ]);
        if self.dist > 0.0 {
            result.extend(rr_intersection(&[
                a.aabb.to_rounded_rect(self.dist),
                b.aabb.to_rounded_rect(0.0),
            ]));
        }
        self.processed = true;
        Ok(result)
    }
}

pub fn create_junction(
    tree: &BpTree,
    mut a: NodeId,
    mut b: NodeId,
    lca: NodeId,
) -> BpResult<LayoutJunction> {
    if a > b {
        std::mem::swap(&mut a, &mut b);
    }
    let distance = dist_from_lca(tree, a, b, lca)?;
    let a_node = tree_node(tree, a)?;
    let b_node = tree_node(tree, b)?;

    let [top1, right1, bottom1, left1] = a_node.aabb.to_values();
    let [top2, right2, bottom2, left2] = b_node.aabb.to_values();

    let x = left2 - right1;
    let y = bottom2 - top1;
    let sx = (left1 - right2).max(x);
    let sy = (bottom1 - top2).max(y);
    if sx <= 0.0 || sy <= 0.0 || sx * sx + sy * sy < distance * distance {
        return Ok(LayoutJunction::Invalid(InvalidJunction::new(
            tree, a, b, distance,
        )?));
    }

    let f = Point {
        x: js_sign(x),
        y: js_sign(y),
    };
    let dir = junction_direction(f, y);
    let tip = a_node.aabb.points[dir as usize];
    Ok(LayoutJunction::Valid(ValidJunction::new(
        tree,
        a,
        b,
        ValidJunctionData {
            lca,
            s: Point { x: sx, y: sy },
            o: Point {
                x: distance - sx,
                y: distance - sy,
            },
            f,
            dir,
            tip: Point { x: tip.x, y: tip.y },
        },
    )?))
}

pub struct Store<T> {
    generator: Box<dyn Iterator<Item = T>>,
    entries: Vec<T>,
    done: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CornerMap {
    pub corner: Corner,
    pub overlap_index: usize,
    pub anchor_index: QuadrantDirection,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayoutPartition {
    pub overlaps: Vec<Overlap>,
    pub corner_map: Vec<CornerMap>,
    strategy: Option<Strategy>,
}

impl LayoutPartition {
    pub fn new(data: PartitionModel) -> Self {
        let mut corner_map = Vec::new();
        for (overlap_index, overlap) in data.overlaps.iter().enumerate() {
            for (anchor_index, corner) in overlap.c.iter().enumerate() {
                corner_map.push(CornerMap {
                    corner: corner.clone(),
                    overlap_index,
                    anchor_index: quadrant_direction_from_u8(anchor_index as u8),
                });
            }
        }
        Self {
            overlaps: data.overlaps,
            corner_map,
            strategy: data.strategy,
        }
    }

    pub fn to_json(&self) -> PartitionModel {
        PartitionModel {
            overlaps: self.overlaps.clone(),
            strategy: self.strategy,
        }
    }

    pub fn constraints(&self) -> Vec<&CornerMap> {
        self.corner_map
            .iter()
            .filter(|map| {
                matches!(
                    corner_type(map.corner.corner_type),
                    Some(CornerType::Socket | CornerType::Internal | CornerType::Flap)
                )
            })
            .collect()
    }

    pub fn external_corner_maps(&self) -> Vec<&CornerMap> {
        self.corner_map
            .iter()
            .filter(|map| {
                matches!(
                    corner_type(map.corner.corner_type),
                    Some(CornerType::Side | CornerType::Intersection)
                )
            })
            .collect()
    }

    pub fn displacement_reference(&self) -> Option<&Corner> {
        self.overlaps
            .iter()
            .find(|overlap| {
                overlap
                    .c
                    .first()
                    .and_then(|corner| corner_type(corner.corner_type))
                    != Some(CornerType::Coincide)
            })
            .and_then(|overlap| overlap.c.first())
    }

    pub fn find_overlap_for_flap(&self, id: NodeId) -> Option<&Overlap> {
        self.overlaps.iter().find(|overlap| {
            overlap.c.iter().any(|corner| {
                corner_type(corner.corner_type) == Some(CornerType::Flap)
                    && corner.e == Some(i64::from(id))
            })
        })
    }

    pub fn exposed_overlap(
        &self,
        overlap_index: usize,
        overlaps: &[Overlap],
        parents: &[Junction],
    ) -> BpResult<Overlap> {
        let ov = self
            .overlaps
            .get(overlap_index)
            .ok_or_else(|| BpError::InvalidInput(format!("missing overlap {overlap_index}")))?;
        if overlaps.len() == 1 {
            return Ok(ov.clone());
        }

        let mut result = ov.clone();
        let parent = parent_junction(ov, parents)?;
        let mut shift = result.shift.unwrap_or(Point { x: 0.0, y: 0.0 });
        let mut skipped_self = false;
        for candidate in overlaps {
            if !skipped_self && candidate == ov {
                skipped_self = true;
                continue;
            }
            let p = parent_junction(candidate, parents)?;
            let w = result.ox + shift.x;
            let h = result.oy + shift.y;
            if corner_e(&p.c[0])? == corner_e(&parent.c[0])? {
                if p.ox < parent.ox {
                    let x = shift.x.max(p.ox);
                    shift = Point { x, y: shift.y };
                    result.ox = w - x;
                }
                if p.oy < parent.oy {
                    let y = shift.y.max(p.oy);
                    shift = Point { x: shift.x, y };
                    result.oy = h - y;
                }
            }
            if corner_e(&p.c[2])? == corner_e(&parent.c[2])? {
                if p.ox < parent.ox {
                    result.ox = parent.ox - p.ox.max(parent.ox - w) - shift.x;
                }
                if p.oy < parent.oy {
                    result.oy = parent.oy - p.oy.max(parent.oy - h) - shift.y;
                }
            }
        }
        result.shift = Some(shift);
        Ok(result)
    }

    pub fn external_connection_target(
        &self,
        point: Point,
        map: &CornerMap,
        partitions: &[LayoutPartition],
        repo: &LayoutRepository,
        tree: &BpTree,
        q: Option<QuadrantDirection>,
    ) -> BpResult<Option<Point>> {
        let [mut p1, mut p2] = self.external_connection_targets(map, partitions, repo, tree)?;
        if p1.x > p2.x {
            std::mem::swap(&mut p1, &mut p2);
        }
        if let Some(q) = q {
            if matches!(q, QuadrantDirection::Ur | QuadrantDirection::Lr) {
                Ok(Some(p1))
            } else {
                Ok(Some(p2))
            }
        } else if point.x <= p1.x {
            Ok(Some(p1))
        } else if point.x >= p2.x {
            Ok(Some(p2))
        } else {
            Ok(None)
        }
    }

    pub fn external_connection_targets(
        &self,
        map: &CornerMap,
        partitions: &[LayoutPartition],
        repo: &LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<[Point; 2]> {
        let overlap = self
            .overlaps
            .get(map.overlap_index)
            .ok_or_else(|| BpError::InvalidInput("external map overlap is missing".to_string()))?;
        let parent = parent_junction(overlap, &repo.junctions)?;
        let n1 = corner_node_id(parent, 0)?;
        let n2 = corner_node_id(parent, 2)?;
        let q1 = parent
            .c
            .first()
            .and_then(|corner| corner.q)
            .map(quadrant_direction_from_u8)
            .ok_or_else(|| {
                BpError::InvalidInput("parent first corner has no quadrant".to_string())
            })?;
        let q2 = parent
            .c
            .get(2)
            .and_then(|corner| corner.q)
            .map(quadrant_direction_from_u8)
            .ok_or_else(|| {
                BpError::InvalidInput("parent second corner has no quadrant".to_string())
            })?;
        let quad1 = repo
            .quadrants
            .get(&make_quadrant_code(n1, q1))
            .ok_or_else(|| BpError::InvalidInput("missing first external quadrant".to_string()))?;
        let quad2 = repo
            .quadrants
            .get(&make_quadrant_code(n2, q2))
            .ok_or_else(|| BpError::InvalidInput("missing second external quadrant".to_string()))?;
        let mut d1 = 0.0;
        let mut d2 = 0.0;
        let mut overlaps = self.overlaps.clone();

        if corner_type(map.corner.corner_type) == Some(CornerType::Intersection) {
            let oriented = overlap
                .c
                .first()
                .and_then(|corner| corner.e)
                .is_some_and(|e| e < 0);
            let n3 = map
                .corner
                .e
                .and_then(|id| NodeId::try_from(id).ok())
                .ok_or_else(|| {
                    BpError::InvalidInput("intersection corner has no flap id".to_string())
                })?;
            let mut node_set = repo.node_set.clone();
            let triple = node_set.dist_triple(tree, n1, n2, n3)?;
            if oriented {
                d2 = triple.d2 - tree_node(tree, n2)?.length;
            } else {
                d1 = triple.d1 - tree_node(tree, n1)?.length;
            }

            if self.find_overlap_for_flap(n3).is_none() {
                for partition in partitions {
                    if std::ptr::eq(partition, self) {
                        continue;
                    }
                    if let Some(overlap) = partition.find_overlap_for_flap(n3) {
                        overlaps.push(overlap.clone());
                    }
                }
            }
        }

        let exposed = self.exposed_overlap(map.overlap_index, &overlaps, &repo.junctions)?;
        Ok([
            quad1.overlap_corner(tree, &exposed, parent, map.anchor_index, d1)?,
            quad2.overlap_corner(tree, &exposed, parent, opposite(map.anchor_index), d2)?,
        ])
    }

    pub fn resolve_division(&self, map: &CornerMap, parents: &[Junction]) -> BpResult<[i64; 2]> {
        let ov = self
            .overlaps
            .get(map.overlap_index)
            .ok_or_else(|| BpError::InvalidInput("missing corner-map overlap".to_string()))?;
        let parent = parent_junction(ov, parents)?;
        let n1 = corner_e(&parent.c[0])?;
        let n2 = corner_e(&parent.c[2])?;
        let n3 = map.corner.e.ok_or_else(|| {
            BpError::InvalidInput("intersection corner has no target".to_string())
        })?;

        let [a, b] = ordered_i64_pair(n1, n3);
        let mut from_n1 = false;
        for junction in parents {
            if corner_e(&junction.c[0])? == a && corner_e(&junction.c[2])? == b {
                from_n1 = true;
                break;
            }
        }
        Ok(ordered_i64_pair(if from_n1 { n2 } else { n1 }, n3))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayoutConfiguration {
    pub partitions: Vec<LayoutPartition>,
    pub overlaps: Vec<Overlap>,
    pub overlap_map: BTreeMap<i64, [usize; 2]>,
    patterns: Vec<pattern::LayoutPattern>,
    pub single_mode: bool,
    raw_partitions: Option<Vec<PartitionModel>>,
    index: usize,
    /// The `JConfiguration` this was built from, when it carried patterns.
    ///
    /// Upstream captures it in the pattern generator it hands to the `Store`
    /// (`new Store(patternGenerator(this, config))`), so a restored prototype
    /// pattern is re-yielded first and the search then skips its duplicate.
    /// The port generates eagerly instead of through a `Store`, so it has to be
    /// kept to hand back to [`generators::pattern_generator_with_repo`].
    proto: Option<ConfigurationModel>,
    /// Whether [`Self::patterns`] is the complete list.
    ///
    /// Mirrors whether upstream's `Store` was drained: a configuration restored
    /// from a session repository arrives with `index` set and every pattern
    /// present (`$rest()`), while one restored from a file prototype has only
    /// that one pattern (`$next()`) and must still be searched.
    patterns_done: bool,
}

impl LayoutConfiguration {
    pub fn new(mut config: ConfigurationModel, single_mode: bool) -> Self {
        // Upstream's constructor drains the pattern store when the prototype
        // carries an index — a session repository, where every pattern was
        // stored — and otherwise takes only the first, leaving the search to
        // run later. `proto` is only interesting in that second case.
        let patterns_done = config.index.is_some();
        let proto = (!patterns_done
            && config
                .patterns
                .as_ref()
                .is_some_and(|patterns| !patterns.is_empty()))
        .then(|| config.clone());
        let patterns = config
            .patterns
            .take()
            .unwrap_or_default()
            .into_iter()
            .map(pattern::LayoutPattern::new_seeded)
            .collect::<Vec<_>>();
        let raw_partitions = if config.raw.unwrap_or(false) {
            let raw = config.partitions.clone();
            config.partitions = clean_up(config.partitions);
            Some(raw)
        } else {
            None
        };
        let partitions = config
            .partitions
            .into_iter()
            .map(LayoutPartition::new)
            .collect::<Vec<_>>();
        let mut overlaps = Vec::new();
        let mut overlap_map = BTreeMap::new();
        let mut key = -1;
        for (partition_index, partition) in partitions.iter().enumerate() {
            for (overlap_index, overlap) in partition.overlaps.iter().enumerate() {
                overlaps.push(overlap.clone());
                overlap_map.insert(key, [partition_index, overlap_index]);
                key -= 1;
            }
        }
        Self {
            partitions,
            overlaps,
            overlap_map,
            patterns,
            single_mode,
            raw_partitions,
            index: config.index.unwrap_or(0),
            proto,
            patterns_done,
        }
    }

    /// Whether [`Self::patterns`] is already the complete list.
    pub fn patterns_done(&self) -> bool {
        self.patterns_done
    }

    pub fn to_json(&self, session: bool) -> ConfigurationModel {
        ConfigurationModel {
            partitions: self
                .partitions
                .iter()
                .map(LayoutPartition::to_json)
                .collect(),
            raw: None,
            patterns: session.then(|| {
                self.patterns
                    .iter()
                    .map(pattern::LayoutPattern::to_json)
                    .collect()
            }),
            index: session.then_some(self.index),
        }
    }

    pub fn signature(&self) -> BpResult<String> {
        Ok(serde_json::to_string(&self.to_json(false))?)
    }

    pub fn raw_partitions(&self) -> Option<&[PartitionModel]> {
        self.raw_partitions.as_deref()
    }

    pub fn patterns(&self) -> &[pattern::LayoutPattern] {
        &self.patterns
    }

    pub fn index(&self) -> usize {
        self.index
    }

    pub fn set_index(&mut self, index: usize) {
        self.index = index;
    }

    pub fn pattern_count(&self) -> usize {
        self.patterns.len()
    }

    pub fn pattern(&self) -> Option<&pattern::LayoutPattern> {
        self.patterns.get(self.index)
    }

    pub fn generate_patterns(&mut self, junctions: &[Junction], factor: Point) -> BpResult<usize> {
        // The prototype goes back in so its pattern is re-yielded first and the
        // search skips the duplicate, as upstream's `patternGenerator` does.
        let proto = self.proto.clone();
        self.patterns = generators::pattern_generator(self, junctions, factor, proto.as_ref())?;
        self.index = 0;
        self.patterns_done = true;
        Ok(self.patterns.len())
    }

    pub fn generate_patterns_with_repo(
        &mut self,
        repo: &mut LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<usize> {
        let proto = self.proto.clone();
        self.patterns = generators::pattern_generator_with_repo(self, repo, tree, proto.as_ref())?;
        self.index = 0;
        self.patterns_done = true;
        Ok(self.patterns.len())
    }

    pub fn complete(&mut self) -> BpResult<()> {
        Err(BpError::UnsupportedOperation {
            upstream: "src/core/design/layout/generators/patternGenerator.ts",
            reason: "configuration completion requires repository context; use generate_patterns with explicit junction context",
        })
    }

    pub fn side_diagonals(
        &self,
        pattern: &pattern::LayoutPattern,
        repo: &LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<Vec<trace::SideDiagonal>> {
        let mut result = Vec::new();
        for (partition_index, partition) in self.partitions.iter().enumerate() {
            for map in &partition.corner_map {
                if corner_type(map.corner.corner_type) != Some(CornerType::Side) {
                    continue;
                }
                let corner = pattern
                    .devices()
                    .get(partition_index)
                    .ok_or_else(|| BpError::InvalidInput("missing side device".to_string()))?
                    .resolve_corner_map(map)?;
                let [p1, p2] =
                    partition.external_connection_targets(map, &self.partitions, repo, tree)?;
                let p1 = ExactPoint::from_numbers(p1.x, p1.y)?;
                let p2 = ExactPoint::from_numbers(p2.x, p2.y)?;
                let mut diagonal = Line::new(p1, p2);
                if diagonal.is_degenerated() {
                    diagonal = Line::new(diagonal.p1, corner.clone());
                }
                result.push(trace::SideDiagonal::new(diagonal, corner));
            }
        }
        Ok(result)
    }
}

pub fn clean_up(mut partitions: Vec<PartitionModel>) -> Vec<PartitionModel> {
    let mut id_map = BTreeMap::new();
    let mut overlap_index = 0;
    for partition in &mut partitions {
        for overlap in &mut partition.overlaps {
            if let Some(id) = overlap.id {
                id_map.insert(id, convert_index(overlap_index));
            }
            overlap.id = None;
            overlap_index += 1;
        }
    }

    for partition in &mut partitions {
        for overlap in &mut partition.overlaps {
            for corner in &mut overlap.c {
                if let Some(e) = corner.e
                    && e < 0
                    && let Some(converted) = id_map.get(&e)
                {
                    corner.e = Some(*converted);
                }
            }
        }
    }
    partitions
}

pub fn convert_index(index: usize) -> i64 {
    -(index as i64) - 1
}

/// The axis-aligned gap between the two flaps a valid junction joins, in layout
/// coordinates: `[min, max]`. This is the paper the stretch pattern has to
/// cover, so it is also the region to point a user at when no pattern exists.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct JunctionRect {
    pub min: Point,
    pub max: Point,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayoutRepository {
    pub stretch_id: String,
    pub signature: String,
    /// The flaps this repository spans, ascending. Identical by construction to
    /// the components of [`Self::stretch_id`] — both come from the same sorted
    /// junction endpoints (see `group_junctions` / `active_stretch_teams`).
    pub flap_ids: Vec<NodeId>,
    /// One entry per junction, in `junctions` order.
    pub junction_rects: Vec<JunctionRect>,
    pub f: Point,
    pub origin: Point,
    pub quadrants: BTreeMap<QuadrantCode, Quadrant>,
    pub directional_quadrants: [Vec<QuadrantCode>; QUADRANT_NUMBER],
    pub junctions: Vec<Junction>,
    pub opposite_map: BTreeMap<NodeId, Vec<NodeId>>,
    pub is_valid: bool,
    pub node_set: NodeSet,
    configurations: Vec<LayoutConfiguration>,
    configurations_done: bool,
    index: usize,
    stored_repo: Option<RepositoryModel>,
    /// The `configuration` + `pattern` prototype a saved file carries, held
    /// until the configurations are generated.
    ///
    /// Upstream passes the whole `JStretch` straight into `configGenerator`
    /// from the `Repository` constructor; the port generates lazily, in
    /// [`Self::init_with_tree`] / [`Self::complete_with_tree`], so it has to be
    /// kept. Never holds a `repo` — see [`Self::new`].
    proto: Option<StretchModel>,
}

impl LayoutRepository {
    pub fn new(
        tree: &BpTree,
        stretch_id: impl Into<String>,
        junctions: &[ValidJunction],
        prototype: Option<&StretchModel>,
    ) -> BpResult<Self> {
        let Some(first) = junctions.first() else {
            return Err(BpError::InvalidInput(
                "repository requires at least one junction".to_string(),
            ));
        };
        let stretch_id = stretch_id.into();
        let signature = get_structure_signature(junctions)?;
        let f = first.f;
        let origin = first.tip;
        let quadrant_result = create_quadrants(junctions, tree)?;
        let node_set = NodeSet::new(tree, junctions, &quadrant_result.map)?;
        let oriented_junctions = junctions
            .iter()
            .map(|junction| junction.to_oriented_json(f))
            .collect::<Vec<_>>();
        let flap_ids = junctions
            .iter()
            .flat_map(|junction| [junction.a, junction.b])
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let junction_rects = junctions
            .iter()
            .map(ValidJunction::rect)
            .collect::<Vec<_>>();
        // BP Studio keeps a live `Repository` per stretch and throws it away the
        // moment `getStructureSignature(junctions)` changes, rebuilding from
        // index 0 (`layout/stretch.ts#$update`). This port rebuilds from the
        // persisted JSON instead, so the equivalent check happens here: a stored
        // repository describes the junction structure it was generated for, and
        // reusing it under a different structure freezes the old configuration
        // set and rigidly translates its gadget onto the new geometry. An
        // absent signature is untrusted for the same reason.
        let stored_repo = prototype
            .and_then(|prototype| prototype.repo.as_ref())
            .filter(|repo| repo.signature.as_deref() == Some(signature.as_str()))
            .cloned();
        let configurations = stored_repo
            .as_ref()
            .map(|repo| {
                repo.configurations
                    .iter()
                    .cloned()
                    .map(|config| LayoutConfiguration::new(config, false))
                    .collect()
            })
            .unwrap_or_default();
        let configurations_done = stored_repo.is_some();
        let index = stored_repo.as_ref().map_or(0, |repo| repo.index);
        // The `configuration` + `pattern` half of the prototype — what a saved
        // file carries — has to survive until the configurations are generated,
        // which happens later in `init_with_tree` / `complete_with_tree`. The
        // `repo` half is deliberately dropped: it is either already expanded
        // into `configurations` above, or it failed the signature check and
        // must not sneak back in through the generator's short circuit.
        let proto = prototype
            .filter(|prototype| prototype.configuration.is_some() && prototype.pattern.is_some())
            .map(|prototype| StretchModel {
                id: prototype.id.clone(),
                configuration: prototype.configuration.clone(),
                pattern: prototype.pattern.clone(),
                repo: None,
            });
        let mut repository = Self {
            stretch_id,
            signature,
            flap_ids,
            junction_rects,
            f,
            origin,
            quadrants: quadrant_result.map,
            directional_quadrants: quadrant_result.directional,
            junctions: oriented_junctions,
            opposite_map: quadrant_result.opposite_map,
            is_valid: false,
            node_set,
            configurations,
            configurations_done,
            index,
            stored_repo,
            proto,
        };
        repository.is_valid = prototype
            .and_then(|prototype| prototype.pattern.as_ref())
            .is_some()
            || repository.check_validity(tree, junctions)?;
        Ok(repository)
    }

    pub fn direction(&self) -> SlashDirection {
        if self.f.x == self.f.y {
            SlashDirection::Fw
        } else {
            SlashDirection::Bw
        }
    }

    pub fn index(&self) -> usize {
        self.index
    }

    pub fn set_index(&mut self, index: usize) {
        self.index = index;
        if let Some(repo) = &mut self.stored_repo {
            repo.index = index;
        }
    }

    pub fn configuration_count(&self) -> Option<usize> {
        self.configurations_done
            .then_some(self.configurations.len())
    }

    pub fn to_json(&self) -> Option<RepositoryModel> {
        self.configurations_done.then(|| RepositoryModel {
            configurations: self
                .configurations
                .iter()
                .map(|config| config.to_json(true))
                .collect(),
            index: self.index,
            signature: Some(self.signature.clone()),
        })
    }

    pub fn configurations(&self) -> &[LayoutConfiguration] {
        &self.configurations
    }

    pub fn configuration(&self) -> Option<&LayoutConfiguration> {
        self.configurations.get(self.index)
    }

    pub fn configuration_mut(&mut self) -> Option<&mut LayoutConfiguration> {
        self.configurations.get_mut(self.index)
    }

    pub fn pattern(&self) -> Option<&pattern::LayoutPattern> {
        self.configuration().and_then(LayoutConfiguration::pattern)
    }

    pub fn move_selected_device(
        &mut self,
        device_index: usize,
        location: Point,
        tree: &BpTree,
    ) -> BpResult<Point> {
        let config_index = self.index;
        let config_snapshot = self
            .configurations
            .get(config_index)
            .cloned()
            .ok_or_else(|| {
                BpError::InvalidInput(format!("missing selected configuration {config_index}"))
            })?;
        let pattern_index = config_snapshot.index();
        let Some(mut positioned) = config_snapshot.pattern().cloned() else {
            return Err(BpError::InvalidInput(format!(
                "BP stretch {} has no selected pattern",
                self.stretch_id
            )));
        };
        positioned.apply_offset_factor(self.f);
        positioned.initialize_devices_with_repo(&config_snapshot, self, tree)?;
        let old_location =
            positioned.move_device(device_index, location, &config_snapshot, self, tree)?;
        let config = self.configurations.get_mut(config_index).ok_or_else(|| {
            BpError::InvalidInput(format!("missing selected configuration {config_index}"))
        })?;
        let slot = config.patterns.get_mut(pattern_index).ok_or_else(|| {
            BpError::InvalidInput(format!("missing selected pattern {pattern_index}"))
        })?;
        *slot = positioned;
        Ok(old_location)
    }

    pub fn set_pattern_index(&mut self, index: usize) -> BpResult<()> {
        let config_index = self.index;
        let config = self.configurations.get_mut(config_index).ok_or_else(|| {
            BpError::InvalidInput(format!("missing selected configuration {config_index}"))
        })?;
        config.set_index(index);
        Ok(())
    }

    pub fn initialize_selected_pattern_with_tree(&mut self, tree: &BpTree) -> BpResult<bool> {
        let config_index = self.index;
        let Some(config_snapshot) = self.configurations.get(config_index).cloned() else {
            return Ok(false);
        };
        let pattern_index = config_snapshot.index;
        let Some(mut positioned) = config_snapshot.pattern().cloned() else {
            return Ok(false);
        };
        positioned.apply_offset_factor(self.f);
        positioned.initialize_devices_with_repo(&config_snapshot, self, tree)?;
        let config = self.configurations.get_mut(config_index).ok_or_else(|| {
            BpError::InvalidInput(format!("missing selected configuration {config_index}"))
        })?;
        let slot = config.patterns.get_mut(pattern_index).ok_or_else(|| {
            BpError::InvalidInput(format!("missing selected pattern {pattern_index}"))
        })?;
        *slot = positioned;
        Ok(true)
    }

    pub fn init(&mut self) -> BpResult<()> {
        if !self.configurations.is_empty() {
            return Ok(());
        }
        let proto = self.proto.clone();
        self.configurations = generators::config_generator(self, proto.as_ref())?;
        Ok(())
    }

    pub fn init_with_tree(&mut self, tree: &BpTree) -> BpResult<()> {
        if !self.configurations.is_empty() {
            return Ok(());
        }
        let proto = self.proto.clone();
        self.configurations = generators::config_generator_with_repo(self, tree, proto.as_ref())?;
        Ok(())
    }

    pub fn complete(&mut self) -> BpResult<()> {
        if !self.configurations_done {
            if self.configurations.is_empty() {
                let proto = self.proto.clone();
                self.configurations = generators::config_generator(self, proto.as_ref())?;
            }
            self.configurations_done = true;
        }
        self.complete_configurations(|config, repo| {
            let junctions = repo.junctions.clone();
            config.generate_patterns(&junctions, repo.f).map(|_| ())
        })?;
        Ok(())
    }

    pub fn complete_with_tree(&mut self, tree: &BpTree) -> BpResult<()> {
        if !self.configurations_done {
            if self.configurations.is_empty() {
                let proto = self.proto.clone();
                self.configurations =
                    generators::config_generator_with_repo(self, tree, proto.as_ref())?;
            }
            self.configurations_done = true;
        }
        self.complete_configurations(|config, repo| {
            config.generate_patterns_with_repo(repo, tree).map(|_| ())
        })?;
        Ok(())
    }

    /// Mirror of upstream `Repository.$complete()`'s second half: after the
    /// configuration store is drained, every configuration drains its own
    /// pattern store (`config.$complete()`).
    ///
    /// Only a configuration restored from a file prototype is left incomplete —
    /// it holds just that one pattern until the search runs — so this is where
    /// the user's other options come back.
    fn complete_configurations(
        &mut self,
        mut generate: impl FnMut(&mut LayoutConfiguration, &mut Self) -> BpResult<()>,
    ) -> BpResult<()> {
        for index in 0..self.configurations.len() {
            if self.configurations[index].patterns_done() {
                continue;
            }
            let mut config = self.configurations[index].clone();
            generate(&mut config, self)?;
            self.configurations[index] = config;
        }
        Ok(())
    }

    pub fn try_update_origin(&mut self, origin: Point) -> bool {
        if self.origin == origin {
            return false;
        }
        self.origin = origin;
        true
    }

    pub fn get_max_intersection_distance(
        &mut self,
        tree: &BpTree,
        r1: &Junction,
        r2: &Junction,
        oriented: bool,
    ) -> BpResult<f64> {
        let q = if oriented { 2 } else { 0 };
        let n1 = corner_node_id(r1, q)?;
        let n2 = corner_node_id(r2, q)?;
        let n3 = corner_node_id(r1, 2 - q)?;
        Ok(self.node_set.dist_triple(tree, n1, n2, n3)?.d3)
    }

    fn check_validity(&mut self, tree: &BpTree, junctions: &[ValidJunction]) -> BpResult<bool> {
        if self.junctions.len() == 1 {
            return Ok(true);
        }
        for quadrants in &self.directional_quadrants {
            for code in quadrants {
                let Some(quadrant) = self.quadrants.get(code) else {
                    continue;
                };
                if !quadrant.check_validity(junctions, &mut self.node_set, tree)? {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StretchUpdate {
    pub repo_to_process: bool,
    pub node_set_changed: bool,
    pub reused_cached_repo: bool,
    pub replaced_repo: bool,
    pub cleared_pattern_contour: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayoutStretch {
    pub id: String,
    pub is_active: bool,
    pub repo: LayoutRepository,
    repo_cache: BTreeMap<String, LayoutRepository>,
}

impl LayoutStretch {
    pub fn new(
        tree: &BpTree,
        junctions: &[ValidJunction],
        prototype: &StretchModel,
    ) -> BpResult<Self> {
        let signature = get_structure_signature(junctions)?;
        let mut repo =
            LayoutRepository::new(tree, prototype.id.clone(), junctions, Some(prototype))?;
        repo.signature = signature;
        Ok(Self {
            id: prototype.id.clone(),
            is_active: true,
            repo,
            repo_cache: BTreeMap::new(),
        })
    }

    pub fn to_json(&self) -> StretchModel {
        StretchModel {
            id: self.id.clone(),
            configuration: None,
            pattern: None,
            repo: self.repo.to_json(),
        }
    }

    pub fn update(
        &mut self,
        tree: &BpTree,
        junctions: &[ValidJunction],
        prototype: &StretchModel,
        is_dragging: bool,
        length_changed: &BTreeSet<NodeId>,
    ) -> BpResult<StretchUpdate> {
        let signature = get_structure_signature(junctions)?;
        let origin = junctions
            .first()
            .map(|junction| junction.tip)
            .ok_or_else(|| {
                BpError::InvalidInput("stretch update requires junctions".to_string())
            })?;
        if signature == self.repo.signature {
            let old_set = self.repo.node_set.clone();
            self.repo.node_set = NodeSet::new(tree, junctions, &self.repo.quadrants)?;
            let updated = self.repo.try_update_origin(origin);
            let node_set_changed = old_set.compare(&self.repo.node_set, length_changed);
            let repo_to_process = !self.is_active || updated;
            if repo_to_process {
                self.is_active = true;
            }
            return Ok(StretchUpdate {
                repo_to_process,
                node_set_changed: !repo_to_process && node_set_changed,
                reused_cached_repo: false,
                replaced_repo: false,
                cleared_pattern_contour: false,
            });
        }

        let old_repo = self.repo.clone();
        self.is_active = true;
        if is_dragging {
            self.repo_cache.insert(old_repo.signature.clone(), old_repo);
            if let Some(mut new_repo) = self.repo_cache.remove(&signature) {
                new_repo.try_update_origin(origin);
                self.repo = new_repo;
                return Ok(StretchUpdate {
                    repo_to_process: true,
                    node_set_changed: false,
                    reused_cached_repo: true,
                    replaced_repo: true,
                    cleared_pattern_contour: true,
                });
            }
        }

        self.repo = LayoutRepository::new(tree, self.id.clone(), junctions, Some(prototype))?;
        Ok(StretchUpdate {
            repo_to_process: true,
            node_set_changed: false,
            reused_cached_repo: false,
            replaced_repo: true,
            cleared_pattern_contour: true,
        })
    }

    pub fn cleanup(&mut self) {
        self.repo_cache.clear();
    }

    pub fn cache_len(&self) -> usize {
        self.repo_cache.len()
    }

    pub fn complete(&mut self) -> BpResult<StretchModel> {
        self.repo.complete()?;
        Ok(self.to_json())
    }
}

impl<T> Store<T> {
    pub fn new(generator: impl Iterator<Item = T> + 'static) -> Self {
        Self {
            generator: Box::new(generator),
            entries: Vec::new(),
            done: false,
        }
    }

    pub fn done(&self) -> bool {
        self.done
    }

    pub fn completed_len(&self) -> Option<usize> {
        self.done.then_some(self.entries.len())
    }

    pub fn entries(&self) -> &[T] {
        &self.entries
    }

    pub fn next_entry(&mut self) -> Option<&T> {
        if self.done {
            return None;
        }
        match self.generator.next() {
            Some(value) => {
                self.entries.push(value);
                self.entries.last()
            }
            None => {
                self.done = true;
                None
            }
        }
    }

    pub fn rest(&mut self) {
        while !self.done {
            let _ = self.next_entry();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ValidJunctionData {
    pub lca: NodeId,
    pub s: Point,
    pub o: Point,
    pub f: Point,
    pub dir: QuadrantDirection,
    pub tip: Point,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ValidJunction {
    pub a: NodeId,
    pub b: NodeId,
    pub lca: NodeId,
    pub q1: QuadrantCode,
    pub q2: QuadrantCode,
    pub s: Point,
    pub o: Point,
    pub f: Point,
    pub tip: Point,
    geometrically_covered_by: Vec<usize>,
}

impl ValidJunction {
    pub fn new(tree: &BpTree, a: NodeId, b: NodeId, data: ValidJunctionData) -> BpResult<Self> {
        ensure_tree_node(tree, a)?;
        ensure_tree_node(tree, b)?;
        ensure_tree_node(tree, data.lca)?;
        Ok(Self {
            a,
            b,
            lca: data.lca,
            q1: make_quadrant_code(a, data.dir),
            q2: make_quadrant_code(b, opposite(data.dir)),
            s: data.s,
            o: data.o,
            f: data.f,
            tip: data.tip,
            geometrically_covered_by: Vec::new(),
        })
    }

    /// The gap rectangle between the two flaps. `tip` is the corner of flap `a`
    /// that faces `b` and `s` is the gap's size, so the opposite corner is
    /// `tip + f * s` — `f` carries the sign of each axis (see `create_junction`).
    pub fn rect(&self) -> JunctionRect {
        let other = Point {
            x: self.tip.x + self.f.x * self.s.x,
            y: self.tip.y + self.f.y * self.s.y,
        };
        JunctionRect {
            min: Point {
                x: self.tip.x.min(other.x),
                y: self.tip.y.min(other.y),
            },
            max: Point {
                x: self.tip.x.max(other.x),
                y: self.tip.y.max(other.y),
            },
        }
    }

    pub fn to_json(&self) -> Junction {
        Junction {
            c: vec![
                Corner {
                    corner_type: CornerType::Flap as u8,
                    e: Some(i64::from(self.a)),
                    q: Some(get_quadrant(self.q1) as u8),
                    dynamic: None,
                },
                Corner {
                    corner_type: CornerType::Side as u8,
                    e: None,
                    q: None,
                    dynamic: None,
                },
                Corner {
                    corner_type: CornerType::Flap as u8,
                    e: Some(i64::from(self.b)),
                    q: Some(get_quadrant(self.q2) as u8),
                    dynamic: None,
                },
                Corner {
                    corner_type: CornerType::Side as u8,
                    e: None,
                    q: None,
                    dynamic: None,
                },
            ],
            f: self.f,
            ox: self.o.x,
            oy: self.o.y,
            sx: self.s.x,
        }
    }

    pub fn oriented_ids(&self) -> [NodeId; 2] {
        if self.f.x > 0.0 {
            [self.a, self.b]
        } else {
            [self.b, self.a]
        }
    }

    pub fn is_covered(&self, junctions: &[ValidJunction]) -> bool {
        !self.covering_with(&covered_flags(junctions)).is_empty()
    }

    pub fn get_covering(&self, junctions: &[ValidJunction]) -> Vec<usize> {
        self.covering_with(&covered_flags(junctions))
    }

    /// Upstream `$getCovering`: the coverers that are not themselves covered.
    /// `covered` is `covered_flags` over the same slice the covering indices
    /// point into.
    fn covering_with(&self, covered: &[bool]) -> Vec<usize> {
        self.geometrically_covered_by
            .iter()
            .copied()
            .filter(|index| covered.get(*index).is_some_and(|covered| !covered))
            .collect()
    }

    pub fn involves(&self, id: NodeId) -> bool {
        self.a == id || self.b == id
    }

    pub fn set_geometrically_covered_by(&mut self, index: usize) {
        self.geometrically_covered_by.push(index);
    }

    pub fn reset_covering(&mut self) {
        self.geometrically_covered_by.clear();
    }

    pub fn is_closer_than(&self, that: &ValidJunction) -> bool {
        self.s.x < that.s.x || self.s.y < that.s.y
    }

    pub fn base_rectangle(&self, distance_to_a: f64) -> Rectangle {
        let x = self.tip.x + distance_to_a * self.f.x;
        let y = self.tip.y + distance_to_a * self.f.y;
        Rectangle::new((x, y), (x - self.o.x * self.f.x, y - self.o.y * self.f.y))
    }

    pub fn to_oriented_json(&self, f: Point) -> Junction {
        let mut result = self.to_json();
        if result.f.x != f.x {
            result.f = f;
            result.c.swap(0, 2);
        }
        result
    }
}

/// Upstream `ValidJunction.$isCovered` for every junction in `junctions`.
///
/// "Practical" covering is recursive: a junction is covered only by a coverer
/// that is not itself covered. Upstream memoizes the answer per junction
/// (`_isCovered`), so a coverer is resolved once and every later query reuses
/// that result. `in_progress` only breaks a covering cycle, which upstream
/// would recurse on forever; it must never suppress a repeat visit to an
/// already-resolved junction, or a coverer reached down one branch silently
/// stops covering on another.
pub fn covered_flags(junctions: &[ValidJunction]) -> Vec<bool> {
    let mut covered = vec![None; junctions.len()];
    let mut in_progress = vec![false; junctions.len()];
    for index in 0..junctions.len() {
        resolve_covered(junctions, index, &mut covered, &mut in_progress);
    }
    covered
        .into_iter()
        .map(|value| value.unwrap_or(false))
        .collect()
}

fn resolve_covered(
    junctions: &[ValidJunction],
    index: usize,
    covered: &mut [Option<bool>],
    in_progress: &mut [bool],
) -> bool {
    if let Some(value) = covered[index] {
        return value;
    }
    if in_progress[index] {
        return false;
    }
    in_progress[index] = true;
    let value = junctions[index]
        .geometrically_covered_by
        .iter()
        .copied()
        .any(|coverer| {
            coverer < junctions.len() && !resolve_covered(junctions, coverer, covered, in_progress)
        });
    in_progress[index] = false;
    covered[index] = Some(value);
    value
}

pub fn get_structure_signature(junctions: &[ValidJunction]) -> BpResult<String> {
    let json = junctions
        .iter()
        .map(ValidJunction::to_json)
        .map(serde_json::to_value)
        .collect::<Result<Vec<Value>, _>>()?;
    Ok(serde_json::to_string(&json)?)
}

#[derive(Debug, Clone, PartialEq)]
pub struct Quadrant {
    pub code: QuadrantCode,
    pub flap: NodeId,
    pub q: QuadrantDirection,
    pub f: Point,
    pub w: f64,
    pub o: Point,
    junctions: Vec<usize>,
}

impl Quadrant {
    fn new(
        code: QuadrantCode,
        junctions: Vec<usize>,
        all_junctions: &[ValidJunction],
        tree: &BpTree,
    ) -> BpResult<Self> {
        let flap = get_node_id(code);
        let q = get_quadrant(code);
        let f = get_factors(q);
        let mut o = Point { x: 0.0, y: 0.0 };
        for index in &junctions {
            let junction = all_junctions
                .get(*index)
                .ok_or_else(|| BpError::InvalidInput(format!("missing junction {index}")))?;
            o.x = o.x.max(junction.o.x);
            o.y = o.y.max(junction.o.y);
        }
        let point = quadrant_point(tree, flap, q)?;
        let w = point_weight(point, f);
        Ok(Self {
            code,
            flap,
            q,
            f,
            w,
            o,
            junctions,
        })
    }

    pub fn check_validity(
        &self,
        junctions: &[ValidJunction],
        node_set: &mut NodeSet,
        tree: &BpTree,
    ) -> BpResult<bool> {
        for i in 0..self.junctions.len() {
            let j1 = junctions
                .get(self.junctions[i])
                .ok_or_else(|| BpError::InvalidInput("missing quadrant junction".to_string()))?;
            for j in i + 1..self.junctions.len() {
                let j2 = junctions.get(self.junctions[j]).ok_or_else(|| {
                    BpError::InvalidInput("missing quadrant junction".to_string())
                })?;
                if one_is_contained_in_another(j1.o, j2.o) {
                    return Ok(false);
                }

                let offset = Point {
                    x: j1.o.x.min(j2.o.x),
                    y: j1.o.y.min(j2.o.y),
                };
                let n1 = self.opposite_id(j1);
                let n2 = self.opposite_id(j2);
                let r = node_set.dist_triple(tree, n1, n2, self.flap)?.d3;
                let dx = r - offset.x;
                let dy = r - offset.y;
                let delta_pt_dist = (dx * dx + dy * dy).sqrt();
                if delta_pt_dist < r {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }

    pub fn point(&self, tree: &BpTree) -> BpResult<Point> {
        quadrant_point(tree, self.flap, self.q)
    }

    pub fn corner(&self, tree: &BpTree, radius: f64) -> BpResult<Point> {
        let point = self.point(tree)?;
        Ok(Point {
            x: point.x + self.f.x * radius,
            y: point.y + self.f.y * radius,
        })
    }

    pub fn overlap_corner(
        &self,
        tree: &BpTree,
        overlap: &Overlap,
        junction: &Junction,
        q: QuadrantDirection,
        distance: f64,
    ) -> BpResult<Point> {
        let radius = tree_node(tree, self.flap)?.length + distance;
        let mut shift = overlap.shift.unwrap_or(Point { x: 0.0, y: 0.0 });
        if Some(i64::from(self.flap)) != junction.c.first().and_then(|corner| corner.e) {
            shift = Point {
                x: junction.ox - (overlap.ox + shift.x),
                y: junction.oy - (overlap.oy + shift.y),
            };
        }
        let point = self.point(tree)?;
        Ok(Point {
            x: point.x
                + self.f.x
                    * (radius
                        - if q == QuadrantDirection::Lr {
                            0.0
                        } else {
                            overlap.ox
                        }
                        - shift.x),
            y: point.y
                + self.f.y
                    * (radius
                        - if q == QuadrantDirection::Ul {
                            0.0
                        } else {
                            overlap.oy
                        }
                        - shift.y),
        })
    }

    pub fn start_end_points(&self, tree: &BpTree) -> BpResult<[Point; 2]> {
        let radius = tree_node(tree, self.flap)?.length;
        let point = self.point(tree)?;
        let mut result = [
            Point {
                x: point.x + self.f.x * radius,
                y: point.y + self.f.y * (radius - self.o.y),
            },
            Point {
                x: point.x + self.f.x * (radius - self.o.x),
                y: point.y + self.f.y * radius,
            },
        ];
        if self.q as u8 % 2 != SlashDirection::Fw as u8 {
            result.swap(0, 1);
        }
        Ok(result)
    }

    fn opposite_id(&self, junction: &ValidJunction) -> NodeId {
        if junction.a == self.flap {
            junction.b
        } else {
            junction.a
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CreateQuadrantResult {
    pub map: BTreeMap<QuadrantCode, Quadrant>,
    pub opposite_map: BTreeMap<NodeId, Vec<NodeId>>,
    pub directional: [Vec<QuadrantCode>; QUADRANT_NUMBER],
}

pub fn create_quadrants(
    junctions: &[ValidJunction],
    tree: &BpTree,
) -> BpResult<CreateQuadrantResult> {
    let mut opposite_map: BTreeMap<NodeId, Vec<NodeId>> = BTreeMap::new();
    let mut quadrant_codes: BTreeMap<QuadrantCode, Vec<usize>> = BTreeMap::new();

    for (index, junction) in junctions.iter().enumerate() {
        opposite_map.entry(junction.a).or_default().push(junction.b);
        opposite_map.entry(junction.b).or_default().push(junction.a);
        quadrant_codes.entry(junction.q1).or_default().push(index);
        quadrant_codes.entry(junction.q2).or_default().push(index);
    }

    let mut directional: [Vec<QuadrantCode>; QUADRANT_NUMBER] = std::array::from_fn(|_| Vec::new());
    let mut map = BTreeMap::new();
    for (code, relevant_junctions) in quadrant_codes {
        let quadrant = Quadrant::new(code, relevant_junctions, junctions, tree)?;
        directional[quadrant.q as usize].push(code);
        map.insert(code, quadrant);
    }
    for quadrants in &mut directional {
        quadrants.sort_by(|a, b| {
            let a = map.get(a).map(|quadrant| quadrant.w).unwrap_or_default();
            let b = map.get(b).map(|quadrant| quadrant.w).unwrap_or_default();
            a.partial_cmp(&b).unwrap_or(Ordering::Equal)
        });
    }

    Ok(CreateQuadrantResult {
        map,
        opposite_map,
        directional,
    })
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DistTriple {
    pub d1: f64,
    pub d2: f64,
    pub d3: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NodeSet {
    pub leaves: Vec<NodeId>,
    pub nodes: Vec<NodeId>,
    pub quadrant_coverage: BTreeMap<NodeId, Vec<QuadrantCode>>,
    lca_map: Option<IntDoubleMap<NodeId>>,
}

impl NodeSet {
    pub fn new(
        tree: &BpTree,
        junctions: &[ValidJunction],
        quadrants: &BTreeMap<QuadrantCode, Quadrant>,
    ) -> BpResult<Self> {
        let leaves = get_leaves(junctions);
        let mut heap = BinaryHeap::new(|a: &HeapNode, b: &HeapNode| {
            b.dist.partial_cmp(&a.dist).unwrap_or(Ordering::Equal)
        });
        let mut coverage: BTreeMap<NodeId, Vec<QuadrantCode>> = BTreeMap::new();
        let num_quadrants = quadrants.len();

        for id in &leaves {
            let node = tree_node(tree, *id)?;
            heap.insert(HeapNode {
                id: *id,
                dist: node.dist,
            });
            let mut covered = Vec::new();
            for q in 0..QUADRANT_NUMBER {
                let code = (*id << 2) | q as NodeId;
                if quadrants.contains_key(&code) {
                    covered.push(code);
                }
            }
            coverage.insert(*id, covered);
        }

        let mut nodes = Vec::new();
        let mut lca_map = (junctions.len() > 1).then(IntDoubleMap::new);
        while let Some(heap_node) = heap.pop() {
            let covered_quadrants = coverage
                .get(&heap_node.id)
                .cloned()
                .ok_or_else(|| BpError::InvalidInput("missing node coverage".to_string()))?;

            if covered_quadrants.len() == num_quadrants {
                coverage.remove(&heap_node.id);
                continue;
            }

            nodes.push(heap_node.id);
            let Some(parent) = tree_node(tree, heap_node.id)?.parent else {
                continue;
            };
            if let Entry::Vacant(entry) = coverage.entry(parent) {
                heap.insert(HeapNode {
                    id: parent,
                    dist: tree_node(tree, parent)?.dist,
                });
                entry.insert(Vec::new());
            }
            let parent_coverage = coverage
                .get_mut(&parent)
                .ok_or_else(|| BpError::InvalidInput("missing parent coverage".to_string()))?;
            if let Some(lca_map) = &mut lca_map
                && !parent_coverage.is_empty()
            {
                for a in parent_coverage.iter() {
                    for b in &covered_quadrants {
                        lca_map.set(get_node_id(*a) as usize, get_node_id(*b) as usize, parent)?;
                    }
                }
            }
            parent_coverage.extend(covered_quadrants);
        }

        nodes.sort_unstable();
        Ok(Self {
            leaves,
            nodes,
            quadrant_coverage: coverage,
            lca_map,
        })
    }

    pub fn dist_triple(
        &mut self,
        tree: &BpTree,
        i1: NodeId,
        i2: NodeId,
        i3: NodeId,
    ) -> BpResult<DistTriple> {
        let d12 = self.dist(tree, i1, i2)?;
        let d13 = self.dist(tree, i1, i3)?;
        let d23 = self.dist(tree, i2, i3)?;
        let total = (d12 + d13 + d23) / 2.0;
        Ok(DistTriple {
            d1: total - d23,
            d2: total - d13,
            d3: total - d12,
        })
    }

    pub fn compare(&self, that: &NodeSet, length_changed: &BTreeSet<NodeId>) -> bool {
        if that.nodes.len() != self.nodes.len() {
            return true;
        }
        for (a, b) in self.nodes.iter().zip(&that.nodes) {
            if a != b || length_changed.contains(a) {
                return true;
            }
        }
        false
    }

    fn dist(&mut self, tree: &BpTree, a: NodeId, b: NodeId) -> BpResult<f64> {
        let lca = self.lca(tree, a, b)?;
        let a = tree_node(tree, a)?;
        let b = tree_node(tree, b)?;
        let lca = tree_node(tree, lca)?;
        Ok(a.dist + b.dist - 2.0 * lca.dist)
    }

    fn lca(&mut self, tree: &BpTree, a: NodeId, b: NodeId) -> BpResult<NodeId> {
        let Some(lca_map) = &mut self.lca_map else {
            return tree_lca(tree, a, b);
        };
        if let Some(lca) = lca_map.get(a as usize, b as usize) {
            return Ok(*lca);
        }

        let a_leaf = self
            .quadrant_coverage
            .get(&a)
            .and_then(|coverage| coverage.first())
            .map(|code| get_node_id(*code))
            .ok_or_else(|| BpError::InvalidInput(format!("missing quadrant coverage for {a}")))?;
        let b_leaf = self
            .quadrant_coverage
            .get(&b)
            .and_then(|coverage| coverage.first())
            .map(|code| get_node_id(*code))
            .ok_or_else(|| BpError::InvalidInput(format!("missing quadrant coverage for {b}")))?;
        let lca = *lca_map
            .get(a_leaf as usize, b_leaf as usize)
            .ok_or_else(|| BpError::InvalidInput("missing cached lca".to_string()))?;
        lca_map.set(a as usize, b as usize, lca)?;
        Ok(lca)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StretchTeam {
    pub junctions: Vec<usize>,
    pub flaps: Vec<NodeId>,
}

pub fn group_junctions(junctions: &[ValidJunction]) -> BpResult<Vec<StretchTeam>> {
    let mut union_find = ListUnionFind::new(junctions.len() * 2);
    let mut quadrant_map = IntDoubleMap::new();
    for (index, junction) in junctions.iter().enumerate() {
        quadrant_map.set(junction.a as usize, junction.b as usize, index)?;
        union_find.union(junction.q1, junction.q2)?;
    }

    let groups = union_find.list();
    let mut result = Vec::new();
    for group in groups {
        let group_set = group.iter().copied().collect::<BTreeSet<_>>();
        let flaps = group
            .iter()
            .map(|code| get_node_id(*code))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let mut team_junctions = Vec::new();
        for i in 0..flaps.len() {
            for j in i + 1..flaps.len() {
                if let Some(index) = quadrant_map.get(flaps[i] as usize, flaps[j] as usize)
                    && junctions
                        .get(*index)
                        .is_some_and(|junction| group_set.contains(&junction.q1))
                {
                    team_junctions.push(*index);
                }
            }
        }
        result.push(StretchTeam {
            junctions: team_junctions,
            flaps,
        });
    }
    Ok(result)
}

pub fn uncovered_junction_indices(
    tree: &BpTree,
    junctions: &mut [ValidJunction],
) -> BpResult<Vec<usize>> {
    if junctions.len() == 1 {
        return Ok(vec![0]);
    }
    for i in 0..junctions.len() {
        for j in i + 1..junctions.len() {
            check_geometrical_covering(tree, junctions, i, j)?;
        }
    }
    let covered = covered_flags(junctions);
    Ok(covered
        .into_iter()
        .enumerate()
        .filter_map(|(index, covered)| (!covered).then_some(index))
        .collect())
}

fn check_geometrical_covering(
    tree: &BpTree,
    junctions: &mut [ValidJunction],
    mut i: usize,
    mut j: usize,
) -> BpResult<()> {
    let i_lca_dist = tree_node(tree, junctions[i].lca)?.dist;
    let j_lca_dist = tree_node(tree, junctions[j].lca)?.dist;
    if j_lca_dist > i_lca_dist {
        std::mem::swap(&mut i, &mut j);
    }
    let Some([n1, n2]) = path_intersection_distances(tree, &junctions[i], &junctions[j])? else {
        return Ok(());
    };
    let r1 = junctions[i].base_rectangle(n1);
    let r2 = junctions[j].base_rectangle(n2);
    let i_closer = junctions[i].is_closer_than(&junctions[j]);
    if r1.equals(&r2) {
        let [a1, b1] = junctions[i].oriented_ids();
        let [a2, b2] = junctions[j].oriented_ids();
        if a1 != a2 && b1 != b2 {
            return Ok(());
        }
        if i_closer {
            junctions[j].set_geometrically_covered_by(i);
        } else {
            junctions[i].set_geometrically_covered_by(j);
        }
    } else if i_closer && r1.contains(&r2) {
        junctions[j].set_geometrically_covered_by(i);
    } else if junctions[j].is_closer_than(&junctions[i]) && r2.contains(&r1) {
        junctions[i].set_geometrically_covered_by(j);
    }
    Ok(())
}

fn path_intersection_distances(
    tree: &BpTree,
    j1: &ValidJunction,
    j2: &ValidJunction,
) -> BpResult<Option<[f64; 2]>> {
    let p1 = j1.lca;
    let p2 = j2.lca;
    let p1_dist = tree_node(tree, p1)?.dist;
    let p2_dist = tree_node(tree, p2)?.dist;
    let j1_a_dist = tree_node(tree, j1.a)?.dist;
    let j2_a_dist = tree_node(tree, j2.a)?.dist;
    if p1 == p2 {
        return Ok(Some([j1_a_dist - p1_dist, j2_a_dist - p1_dist]));
    }
    if p1_dist == p2_dist {
        return Ok(None);
    }
    if is_ancestor(tree, p1, j2.a)? {
        return Ok(Some([j1_a_dist - p1_dist, j2_a_dist - p1_dist]));
    }
    if is_ancestor(tree, p1, j2.b)? {
        return Ok(Some([
            j1_a_dist - p1_dist,
            dist_from_lca(tree, j2.a, p1, p2)?,
        ]));
    }
    Ok(None)
}

fn is_ancestor(tree: &BpTree, ancestor: NodeId, mut node: NodeId) -> BpResult<bool> {
    let ancestor_dist = tree_node(tree, ancestor)?.dist;
    while tree_node(tree, node)?.dist > ancestor_dist {
        node = tree_node(tree, node)?
            .parent
            .ok_or_else(|| BpError::InvalidInput(format!("missing parent for node {node}")))?;
    }
    Ok(node == ancestor)
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct HeapNode {
    id: NodeId,
    dist: f64,
}

pub fn get_factors(q: QuadrantDirection) -> Point {
    Point {
        x: match q {
            QuadrantDirection::Ur | QuadrantDirection::Lr => 1.0,
            QuadrantDirection::Ul | QuadrantDirection::Ll => -1.0,
        },
        y: match q {
            QuadrantDirection::Ur | QuadrantDirection::Ul => 1.0,
            QuadrantDirection::Ll | QuadrantDirection::Lr => -1.0,
        },
    }
}

pub fn start_end_points(quadrants: &[Quadrant], tree: &BpTree) -> BpResult<[Point; 2]> {
    let Some(first) = quadrants.first() else {
        return Err(BpError::InvalidInput(
            "cannot compute start/end points without quadrants".to_string(),
        ));
    };
    let [mut start, mut end] = first.start_end_points(tree)?;
    let f = first.f;
    for quadrant in quadrants.iter().skip(1) {
        let [new_start, new_end] = quadrant.start_end_points(tree)?;
        if point_weight(new_start, f) < point_weight(start, f) {
            start = new_start;
        }
        if point_weight(new_end, f) > point_weight(end, f) {
            end = new_end;
        }
    }
    Ok([start, end])
}

pub fn one_is_contained_in_another(o1: Point, o2: Point) -> bool {
    o1.x <= o2.x && o1.y <= o2.y || o2.x <= o1.x && o2.y <= o1.y
}

fn point_weight(point: Point, f: Point) -> f64 {
    f.x * point.y - f.y * point.x
}

fn quadrant_point(tree: &BpTree, flap: NodeId, q: QuadrantDirection) -> BpResult<Point> {
    let point = tree_node(tree, flap)?.aabb.points[q as usize];
    Ok(Point {
        x: point.x,
        y: point.y,
    })
}

fn corner_node_id(junction: &Junction, index: usize) -> BpResult<NodeId> {
    junction
        .c
        .get(index)
        .and_then(|corner| corner.e)
        .and_then(|id| NodeId::try_from(id).ok())
        .ok_or_else(|| BpError::InvalidInput(format!("junction corner {index} has no node id")))
}

fn parent_junction<'a>(overlap: &Overlap, parents: &'a [Junction]) -> BpResult<&'a Junction> {
    parents
        .get(overlap.parent)
        .ok_or_else(|| BpError::InvalidInput(format!("missing parent junction {}", overlap.parent)))
}

fn corner_e(corner: &Corner) -> BpResult<i64> {
    corner
        .e
        .ok_or_else(|| BpError::InvalidInput("corner has no target".to_string()))
}

fn ordered_i64_pair(a: i64, b: i64) -> [i64; 2] {
    if a > b { [b, a] } else { [a, b] }
}

fn corner_type(value: u8) -> Option<CornerType> {
    match value {
        0 => Some(CornerType::Socket),
        1 => Some(CornerType::Internal),
        2 => Some(CornerType::Side),
        3 => Some(CornerType::Intersection),
        4 => Some(CornerType::Flap),
        5 => Some(CornerType::Coincide),
        _ => None,
    }
}

fn quadrant_direction_from_u8(value: u8) -> QuadrantDirection {
    match value {
        0 => QuadrantDirection::Ur,
        1 => QuadrantDirection::Ul,
        2 => QuadrantDirection::Ll,
        _ => QuadrantDirection::Lr,
    }
}

fn tree_node(tree: &BpTree, id: NodeId) -> BpResult<&crate::tree::TreeNode> {
    tree.node(id)
        .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {id}")))
}

fn dist_from_lca(tree: &BpTree, a: NodeId, b: NodeId, lca: NodeId) -> BpResult<f64> {
    let a = tree_node(tree, a)?;
    let b = tree_node(tree, b)?;
    let lca = tree_node(tree, lca)?;
    Ok(a.dist + b.dist - 2.0 * lca.dist)
}

fn ensure_tree_node(tree: &BpTree, id: NodeId) -> BpResult<()> {
    tree_node(tree, id).map(|_| ())
}

fn get_leaves(junctions: &[ValidJunction]) -> Vec<NodeId> {
    let mut leaf_set = BTreeSet::new();
    for junction in junctions {
        leaf_set.insert(junction.a);
        leaf_set.insert(junction.b);
    }
    leaf_set.into_iter().collect()
}

fn tree_lca(tree: &BpTree, a: NodeId, b: NodeId) -> BpResult<NodeId> {
    let mut ancestors = BTreeSet::new();
    let mut cursor = Some(a);
    while let Some(id) = cursor {
        ancestors.insert(id);
        cursor = tree_node(tree, id)?.parent;
    }

    cursor = Some(b);
    while let Some(id) = cursor {
        if ancestors.contains(&id) {
            return Ok(id);
        }
        cursor = tree_node(tree, id)?.parent;
    }
    Err(BpError::InvalidInput(format!(
        "missing lca for tree nodes {a} and {b}"
    )))
}

pub fn create_valid_junctions(tree: &BpTree) -> BpResult<Vec<ValidJunction>> {
    Ok(create_layout_junctions(tree)?
        .into_iter()
        .filter_map(|junction| match junction {
            LayoutJunction::Valid(junction) => Some(junction),
            LayoutJunction::Invalid(_) => None,
        })
        .collect())
}

pub fn active_layout_repositories(
    tree: &BpTree,
    prototypes: &[StretchModel],
) -> BpResult<Vec<LayoutRepository>> {
    let prototypes = prototypes
        .iter()
        .map(|prototype| (prototype.id.as_str(), prototype))
        .collect::<BTreeMap<_, _>>();
    let valid_junctions = create_valid_junctions(tree)?;
    let teams = active_stretch_teams(tree, &valid_junctions)?;
    teams
        .into_iter()
        .map(|(id, junctions)| {
            let fallback;
            let prototype = if let Some(prototype) = prototypes.get(id.as_str()) {
                *prototype
            } else {
                fallback = StretchModel {
                    id: id.clone(),
                    configuration: None,
                    pattern: None,
                    repo: None,
                };
                &fallback
            };
            LayoutRepository::new(tree, id, &junctions, Some(prototype))
        })
        .collect()
}

pub fn create_layout_junctions(tree: &BpTree) -> BpResult<Vec<LayoutJunction>> {
    let leaves = tree
        .nodes()
        .iter()
        .flatten()
        .filter(|node| node.is_leaf())
        .map(|node| node.id)
        .collect::<Vec<_>>();
    let mut result = Vec::new();
    for i in 0..leaves.len() {
        for j in i + 1..leaves.len() {
            let a = leaves[i];
            let b = leaves[j];
            let lca = tree_lca(tree, a, b)?;
            // BP Studio's junctionTask only forms a junction between two flaps
            // when their AABBs intersect once inflated by the tree distance
            // between them (context/aabb `$intersects`). Flaps with slack larger
            // than the tree distance form no junction at all — and therefore no
            // stretch or gadget device. Without this gate every leaf pair yields
            // a valid junction, producing spurious devices between distant flaps.
            let gap = dist_from_lca(tree, a, b, lca)?;
            let a_aabb = tree_node(tree, a)?.aabb.to_values();
            let b_aabb = tree_node(tree, b)?.aabb.to_values();
            if !aabb_intersects_within_gap(a_aabb, b_aabb, gap) {
                continue;
            }
            result.push(create_junction(tree, a, b, lca)?);
        }
    }
    Ok(result)
}

/// Mirror of BP Studio `AABB.$intersects`: the two AABBs, each inflated by `gap`
/// (the tree distance between the flaps), overlap on both axes. AABB values are
/// ordered `[top, right, bottom, left]`.
fn aabb_intersects_within_gap(a: [f64; 4], b: [f64; 4], gap: f64) -> bool {
    let [a_top, a_right, a_bottom, a_left] = a;
    let [b_top, b_right, b_bottom, b_left] = b;
    a_left - gap < b_right
        && a_right + gap > b_left
        && a_top + gap > b_bottom
        && a_bottom - gap < b_top
}

fn active_stretch_teams(
    tree: &BpTree,
    valid_junctions: &[ValidJunction],
) -> BpResult<Vec<(String, Vec<ValidJunction>)>> {
    let mut result = Vec::new();
    for team in group_junctions(valid_junctions)? {
        let mut team_junctions = team
            .junctions
            .iter()
            .filter_map(|index| valid_junctions.get(*index).cloned())
            .collect::<Vec<_>>();
        let uncovered = uncovered_junction_indices(tree, &mut team_junctions)?;
        if uncovered.is_empty() {
            continue;
        }
        if uncovered.len() == 1 {
            let junction = team_junctions[uncovered[0]].clone();
            let id = layout_stretch_id(&[junction.a, junction.b]);
            result.push((id, vec![junction]));
            continue;
        }
        let uncovered_junctions = uncovered
            .into_iter()
            .map(|index| team_junctions[index].clone())
            .collect::<Vec<_>>();
        for uncovered_team in group_junctions(&uncovered_junctions)? {
            let junctions = uncovered_team
                .junctions
                .iter()
                .filter_map(|index| uncovered_junctions.get(*index).cloned())
                .collect::<Vec<_>>();
            result.push((layout_stretch_id(&uncovered_team.flaps), junctions));
        }
    }
    Ok(result)
}

fn layout_stretch_id(flaps: &[u32]) -> String {
    flaps
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

fn js_sign(value: f64) -> f64 {
    if value > 0.0 {
        1.0
    } else if value < 0.0 {
        -1.0
    } else {
        0.0
    }
}

fn junction_direction(f: Point, y: f64) -> QuadrantDirection {
    let code = (if f.x == f.y { 0 } else { 1 }) + if y > 0.0 { 0 } else { 2 };
    match code {
        0 => QuadrantDirection::Ur,
        1 => QuadrantDirection::Ul,
        2 => QuadrantDirection::Ll,
        _ => QuadrantDirection::Lr,
    }
}
