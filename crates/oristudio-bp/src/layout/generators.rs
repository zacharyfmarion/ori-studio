use super::{CornerType, LayoutConfiguration, LayoutRepository, clean_up};
use crate::error::{BpError, BpResult};
use crate::layout::joiner::Joiner;
use crate::layout::pattern::{LayoutPattern, PatternDevice, PatternGadget, PatternPiece};
use crate::math::gops::{
    JsonAnchor, JsonGadget, JsonOverlap, JsonPiece, JsonPoint, generate as generate_gops,
};
use crate::math::kamiya::kamiya_half_integral;
use crate::model::{
    Anchor, Configuration as ConfigurationModel, Corner, Device, Gadget, Junction, NodeId, Overlap,
    Partition, Pattern as PatternModel, Piece, Point, Strategy, Stretch,
};
use crate::shared::{
    NEXT_QUADRANT_OFFSET, PREVIOUS_QUADRANT_OFFSET, QUADRANT_NUMBER, QuadrantCode,
    QuadrantDirection, get_node_id, get_quadrant, make_quadrant_code, opposite,
};

const MAX_RANK_PER_JOINT: usize = 9;
const RELAY_RANK: usize = 1;
const BASE_JOIN_RANK: usize = 4;
const STANDARD_JOIN_RANK: usize = 6;
const HALF_INTEGRAL_RANK: usize = 7;
const UNIVERSAL_RANK: usize = 8;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct JointItem {
    pub index: usize,
    pub split: bool,
    pub opposite_node_id: Option<NodeId>,
    pub configs: Vec<LayoutConfiguration>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SplitItem {
    pub overlap: Overlap,
    pub opposite_node_id: NodeId,
    pub split: Option<SplitInfo>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SplitInfo {
    pub remaining_partition: Partition,
    pub is_horizontal: bool,
}

#[derive(Debug, Clone, PartialEq)]
struct GeneralJoint {
    node_id: NodeId,
    items: Vec<JointItem>,
    max: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConfigGeneratorContext {
    single_mode: bool,
    junctions: Vec<Junction>,
    factor: Point,
    next_id: i64,
}

impl ConfigGeneratorContext {
    pub fn new(repo: &LayoutRepository) -> Self {
        Self::from_junctions_with_factor(repo.junctions.clone(), false, repo.f)
    }

    pub fn from_junctions(junctions: Vec<Junction>, single_mode: bool) -> Self {
        Self::from_junctions_with_factor(junctions, single_mode, Point { x: 1.0, y: 1.0 })
    }

    pub fn from_junctions_with_factor(
        junctions: Vec<Junction>,
        single_mode: bool,
        factor: Point,
    ) -> Self {
        Self {
            single_mode,
            junctions,
            factor,
            next_id: -1,
        }
    }

    pub fn single_mode(&self) -> bool {
        self.single_mode
    }

    pub fn junctions(&self) -> &[Junction] {
        &self.junctions
    }

    pub fn factor(&self) -> Point {
        self.factor
    }

    pub fn to_overlap(&mut self, junction: &Junction, parent_index: usize) -> Overlap {
        let id = self.next_id;
        self.next_id -= 1;
        Overlap {
            id: Some(id),
            c: junction.c.clone(),
            ox: junction.ox,
            oy: junction.oy,
            parent: parent_index,
            shift: None,
        }
    }

    pub fn cut(&mut self, junction: &Junction, index: usize, x: f64, y: f64) -> [Overlap; 2] {
        let mut o1 = self.to_overlap(junction, index);
        let mut o2 = self.to_overlap(junction, index);
        let o1_id = o1.id;
        let o2_id = o2.id;

        if x > 0.0 {
            o1.c[2] = corner(CornerType::Internal, o2_id, Some(3));
            o1.c[1] = corner(CornerType::Socket, o2_id, Some(0));
            o1.ox = x;
            o2.c[3] = corner(CornerType::Socket, o1_id, Some(2));
            o2.c[0] = corner(CornerType::Internal, o1_id, Some(1));
            o2.ox = junction.ox - x;
            o2.shift = Some(Point { x, y: 0.0 });
        } else {
            o1.c[2] = corner(CornerType::Internal, o2_id, Some(1));
            o1.c[3] = corner(CornerType::Socket, o2_id, Some(0));
            o1.oy = y;
            o2.c[1] = corner(CornerType::Socket, o1_id, Some(2));
            o2.c[0] = corner(CornerType::Internal, o1_id, Some(3));
            o2.oy = junction.oy - y;
            o2.shift = Some(Point { x: 0.0, y });
        }
        [o1, o2]
    }

    pub fn make(&self, partitions: Vec<Partition>, single: bool) -> LayoutConfiguration {
        if single && self.single_mode {
            LayoutConfiguration::new(
                ConfigurationModel {
                    partitions,
                    raw: Some(true),
                    patterns: None,
                    index: None,
                },
                true,
            )
        } else {
            LayoutConfiguration::new(
                ConfigurationModel {
                    partitions: clean_up(partitions),
                    raw: None,
                    patterns: None,
                    index: None,
                },
                false,
            )
        }
    }

    pub fn single_gadget(
        &mut self,
        index: usize,
        strategy: Option<Strategy>,
    ) -> Option<LayoutConfiguration> {
        let junction = self.junctions.get(index)?.clone();
        let overlap = self.to_overlap(&junction, index);
        Some(self.make(
            vec![Partition {
                overlaps: vec![overlap],
                strategy,
            }],
            true,
        ))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct GeneralConfigGeneratorContext {
    context: ConfigGeneratorContext,
    max_rank: usize,
    joints: Vec<GeneralJoint>,
}

impl GeneralConfigGeneratorContext {
    pub fn new(repo: &LayoutRepository) -> BpResult<Self> {
        let mut context = ConfigGeneratorContext::from_junctions_with_factor(
            repo.junctions.clone(),
            true,
            repo.f,
        );
        let junctions = context.junctions().to_vec();
        let mut junction_map = Vec::<(QuadrantCode, Vec<usize>)>::new();
        let mut configs = vec![Vec::<LayoutConfiguration>::new(); junctions.len()];
        for (index, junction) in junctions.iter().enumerate() {
            push_junction_index(
                &mut junction_map,
                junction_corner_code(junction, QuadrantDirection::Ur)?,
                index,
            );
            push_junction_index(
                &mut junction_map,
                junction_corner_code(junction, QuadrantDirection::Ll)?,
                index,
            );
            configs[index] = single_config_generator(&mut context, index, None)?;
        }

        let mut joints = Vec::new();
        let mut max_rank = 0;
        for (code, junction_indices) in junction_map {
            if junction_indices.len() <= 1 {
                continue;
            }
            let max = (junction_indices.len() - 1) * MAX_RANK_PER_JOINT;
            let node_id = get_node_id(code);
            let items = junction_indices
                .into_iter()
                .map(|index| {
                    let junction = &junctions[index];
                    let opposite_node_id = opposite_node_id(junction, node_id)?;
                    Ok(JointItem {
                        index,
                        split: configs[index]
                            .first()
                            .is_some_and(|config| config.partitions.len() > 1),
                        opposite_node_id: Some(opposite_node_id),
                        configs: configs[index].clone(),
                    })
                })
                .collect::<BpResult<Vec<_>>>()?;
            joints.push(GeneralJoint {
                node_id,
                items,
                max,
            });
            max_rank += max;
        }

        Ok(Self {
            context,
            max_rank,
            joints,
        })
    }

    pub fn max_rank(&self) -> usize {
        self.max_rank
    }

    pub fn check_preconditions(&self) -> bool {
        self.joints.len() == 1 && self.joints[0].items.len() == 2
    }

    pub fn rank_combinations(&self, target_rank: usize) -> Vec<Vec<usize>> {
        let mut result = Vec::new();
        self.rank_combinations_inner(target_rank, &mut Vec::new(), &mut result);
        result
    }

    pub fn search(&mut self, ranks: &[usize]) -> BpResult<Vec<LayoutConfiguration>> {
        let Some(joint) = self.joints.first().cloned() else {
            return Ok(Vec::new());
        };
        let rank = ranks.first().copied().unwrap_or(0);
        let mut result = Vec::new();

        if rank >= RELAY_RANK {
            result.extend(self.search_relay_configs(&joint, rank - RELAY_RANK)?);
        }

        let split_count = joint.items.iter().filter(|item| item.split).count();
        if split_count == 0 {
            let partitions =
                self.search_join_partitions(|this| this.items_to_overlaps(&joint.items), rank)?;
            for partition in partitions {
                result.push(self.context.make(vec![partition], false));
            }
        } else if rank >= split_count {
            result.extend(self.search_split_join(&joint, rank - split_count)?);
        }

        Ok(result)
    }

    fn rank_combinations_inner(
        &self,
        target_rank: usize,
        ranks: &mut Vec<usize>,
        result: &mut Vec<Vec<usize>>,
    ) {
        let depth = ranks.len();
        let Some(joint) = self.joints.get(depth) else {
            return;
        };
        if depth == self.joints.len() - 1 {
            if target_rank <= joint.max {
                let mut item = ranks.clone();
                item.push(target_rank);
                result.push(item);
            }
            return;
        }
        for rank in 0..=joint.max.min(target_rank) {
            ranks.push(rank);
            self.rank_combinations_inner(target_rank - rank, ranks, result);
            ranks.pop();
        }
    }

    fn search_relay_configs(
        &mut self,
        joint: &GeneralJoint,
        rank: usize,
    ) -> BpResult<Vec<LayoutConfiguration>> {
        let strategy = if rank == UNIVERSAL_RANK {
            Some(Strategy::Universal)
        } else if rank == HALF_INTEGRAL_RANK {
            Some(Strategy::HalfIntegral)
        } else if rank == 0 {
            None
        } else {
            return Ok(Vec::new());
        };
        let overlaps = self.items_to_overlaps(&joint.items)?;
        let [o1, o2]: [Overlap; 2] = overlaps
            .try_into()
            .map_err(|_| BpError::InvalidInput("relay search requires two overlaps".to_string()))?;
        Ok(search_relay(&joint.items, o1, o2, strategy, strategy)
            .into_iter()
            .map(|partitions| self.context.make(partitions, false))
            .collect())
    }

    fn search_join_partitions(
        &mut self,
        mut factory: impl FnMut(&mut Self) -> BpResult<Vec<Overlap>>,
        rank: usize,
    ) -> BpResult<Vec<Partition>> {
        let overlaps = factory(self)?;
        let mut result = self.search_join(overlaps, rank)?;
        if rank > 2 {
            let overlaps = factory(self)?;
            result.extend(self.search_relay_join(overlaps, rank - 1)?);
        }
        Ok(result)
    }

    fn search_join(&self, mut overlaps: Vec<Overlap>, rank: usize) -> BpResult<Vec<Partition>> {
        let strategy = resolve_join_rank(rank);
        if strategy.is_none() && rank != 2 {
            return Ok(Vec::new());
        }
        for index in 1..overlaps.len() {
            let oriented = overlaps[0].c[0].e == overlaps[index].c[0].e;
            join_overlaps(&self.context, &mut overlaps, 0, index, oriented, false)?;
        }
        Ok(vec![Partition { overlaps, strategy }])
    }

    fn search_relay_join(&self, overlaps: Vec<Overlap>, rank: usize) -> BpResult<Vec<Partition>> {
        let strategy = resolve_join_rank(rank);
        if strategy.is_none() && rank != 2 {
            return Ok(Vec::new());
        }
        let [o1, o2]: [Overlap; 2] = overlaps
            .try_into()
            .map_err(|_| BpError::InvalidInput("relay join requires two overlaps".to_string()))?;
        let oriented = o1.c[0].e == o2.c[0].e;
        let o1x = o2.ox > o1.ox;
        let x = if o1x { o1.ox } else { o2.ox };
        let y = if o1x { o2.oy } else { o1.oy };
        let mut result = Vec::new();

        let mut n = 1.0;
        while n < x {
            let mut overlaps = vec![o1.clone(), o2.clone()];
            let joined = join_overlaps(&self.context, &mut overlaps, 0, 1, oriented, !o1x)?;
            overlaps[joined].ox -= n;
            if oriented {
                overlaps[joined].shift = Some(Point { x: n, y: 0.0 });
            }
            result.push(Partition { overlaps, strategy });
            n += 1.0;
        }

        n = 1.0;
        while n < y {
            let mut overlaps = vec![o1.clone(), o2.clone()];
            let joined = join_overlaps(&self.context, &mut overlaps, 0, 1, oriented, o1x)?;
            overlaps[joined].oy -= n;
            if oriented {
                overlaps[joined].shift = Some(Point { x: 0.0, y: n });
            }
            result.push(Partition { overlaps, strategy });
            n += 1.0;
        }
        Ok(result)
    }

    fn search_split_join(
        &mut self,
        joint: &GeneralJoint,
        rank: usize,
    ) -> BpResult<Vec<LayoutConfiguration>> {
        let split_items = joint
            .items
            .iter()
            .map(|item| to_split_items(item, joint.node_id))
            .collect::<BpResult<Vec<_>>>()?;
        let mut result = Vec::new();
        for item1 in &split_items[0] {
            for item2 in &split_items[1] {
                if item1.split.as_ref().map(|split| split.is_horizontal)
                    == item2.split.as_ref().map(|split| split.is_horizontal)
                {
                    continue;
                }
                if cover(&item1.overlap, &item2.overlap) || cover(&item2.overlap, &item1.overlap) {
                    continue;
                }
                let joins = self.search_join_partitions(
                    |_this| Ok(vec![item1.overlap.clone(), item2.overlap.clone()]),
                    rank,
                )?;
                for mut join in joins {
                    let remain1 = get_exposed_part(item1, item2, &mut join)?;
                    let remain2 = get_exposed_part(item2, item1, &mut join)?;
                    let mut partitions = vec![join];
                    if let Some(remain) = remain1 {
                        partitions.push(remain);
                    }
                    if let Some(remain) = remain2 {
                        partitions.push(remain);
                    }
                    result.push(self.context.make(partitions, false));
                }
            }
        }
        Ok(result)
    }

    fn items_to_overlaps(&mut self, items: &[JointItem]) -> BpResult<Vec<Overlap>> {
        items
            .iter()
            .map(|item| {
                let junction = self
                    .context
                    .junctions()
                    .get(item.index)
                    .cloned()
                    .ok_or_else(|| {
                        BpError::InvalidInput("joint item index is missing".to_string())
                    })?;
                Ok(self.context.to_overlap(&junction, item.index))
            })
            .collect()
    }
}

pub fn single_config_generator(
    context: &mut ConfigGeneratorContext,
    index: usize,
    proto_signature: Option<&str>,
) -> BpResult<Vec<LayoutConfiguration>> {
    let mut result = Vec::new();
    for group in 0..4 {
        let candidates = match group {
            0 => context.single_gadget(index, None).into_iter().collect(),
            1 => double_relay(context, index)?,
            2 => context
                .single_gadget(index, Some(Strategy::HalfIntegral))
                .into_iter()
                .collect(),
            _ => context
                .single_gadget(index, Some(Strategy::Universal))
                .into_iter()
                .collect(),
        };

        let mut found = false;
        for mut config in candidates {
            match create_config_filter(&mut config, context, proto_signature)? {
                None => found = true,
                Some(true) => {
                    found = true;
                    result.push(config);
                }
                Some(false) => {}
            }
        }
        if found {
            return Ok(result);
        }
    }
    Ok(result)
}

pub fn create_config_filter(
    config: &mut LayoutConfiguration,
    context: &ConfigGeneratorContext,
    signature: Option<&str>,
) -> BpResult<Option<bool>> {
    // Not `patterns().is_empty()`: a configuration restored from a file
    // prototype arrives holding exactly that one pattern and still has to be
    // searched, or the user loses every other option for it.
    if !config.patterns_done() {
        config.generate_patterns(context.junctions(), context.factor())?;
    }
    if let Some(signature) = signature
        && config.signature()? == signature
    {
        return Ok(None);
    }
    Ok(Some(config.pattern().is_some()))
}

pub fn config_generator_search_unsupported() -> BpResult<()> {
    Err(BpError::UnsupportedOperation {
        upstream: "src/core/design/layout/generators/configGenerator.ts",
        reason: "configuration search requires pattern generation and ranking stages that are not ported yet",
    })
}

pub fn create_config_filter_with_repo(
    config: &mut LayoutConfiguration,
    repo: &mut LayoutRepository,
    tree: &crate::tree::BpTree,
    signature: Option<&str>,
) -> BpResult<Option<bool>> {
    if !config.patterns_done() {
        config.generate_patterns_with_repo(repo, tree)?;
    }
    if let Some(signature) = signature
        && config.signature()? == signature
    {
        return Ok(None);
    }
    Ok(Some(config.pattern().is_some()))
}

pub fn config_generator(
    repo: &LayoutRepository,
    prototype: Option<&Stretch>,
) -> BpResult<Vec<LayoutConfiguration>> {
    let mut result = Vec::new();
    let mut proto_signature = None;
    if let Some(prototype) = prototype {
        if let Some(stored) = &prototype.repo {
            return Ok(stored
                .configurations
                .iter()
                .cloned()
                .map(|config| LayoutConfiguration::new(config, false))
                .collect());
        }

        if let (Some(proto), Some(pattern)) = (&prototype.configuration, &prototype.pattern) {
            let config = LayoutConfiguration::new(
                ConfigurationModel {
                    partitions: proto.partitions.clone(),
                    raw: None,
                    patterns: Some(vec![pattern.clone()]),
                    index: None,
                },
                false,
            );
            if config.pattern().is_some() {
                proto_signature = Some(config.signature()?);
                result.push(config);
            }
        }
    }

    if !repo.is_valid {
        return Ok(result);
    }

    if repo.junctions.len() == 1 {
        let mut context = ConfigGeneratorContext::new(repo);
        result.extend(single_config_generator(
            &mut context,
            0,
            proto_signature.as_deref(),
        )?);
        return Ok(result);
    }

    Err(BpError::UnsupportedOperation {
        upstream: "src/core/design/layout/generators/generalConfigGenerator.ts",
        reason: "multi-junction configuration search has not been ported yet",
    })
}

pub fn config_generator_with_repo(
    repo: &mut LayoutRepository,
    tree: &crate::tree::BpTree,
    prototype: Option<&Stretch>,
) -> BpResult<Vec<LayoutConfiguration>> {
    let mut result = Vec::new();
    let mut proto_signature = None;
    if let Some(prototype) = prototype {
        if let Some(stored) = &prototype.repo {
            return Ok(stored
                .configurations
                .iter()
                .cloned()
                .map(|config| LayoutConfiguration::new(config, false))
                .collect());
        }

        if let (Some(proto), Some(pattern)) = (&prototype.configuration, &prototype.pattern) {
            let config = LayoutConfiguration::new(
                ConfigurationModel {
                    partitions: proto.partitions.clone(),
                    raw: None,
                    patterns: Some(vec![pattern.clone()]),
                    index: None,
                },
                false,
            );
            if config.pattern().is_some() {
                proto_signature = Some(config.signature()?);
                result.push(config);
            }
        }
    }

    if !repo.is_valid {
        return Ok(result);
    }

    if repo.junctions.len() == 1 {
        let mut context = ConfigGeneratorContext::new(repo);
        result.extend(single_config_generator(
            &mut context,
            0,
            proto_signature.as_deref(),
        )?);
        return Ok(result);
    }

    result.extend(general_config_generator(
        repo,
        tree,
        proto_signature.as_deref(),
    )?);
    Ok(result)
}

pub fn general_config_generator(
    repo: &mut LayoutRepository,
    tree: &crate::tree::BpTree,
    proto_signature: Option<&str>,
) -> BpResult<Vec<LayoutConfiguration>> {
    let mut context = GeneralConfigGeneratorContext::new(repo)?;
    if !context.check_preconditions() {
        return Ok(Vec::new());
    }

    for rank in 0..=context.max_rank() {
        let mut result = Vec::new();
        let mut found = false;
        for combination in context.rank_combinations(rank) {
            for mut config in context.search(&combination)? {
                match create_config_filter_with_repo(&mut config, repo, tree, proto_signature)? {
                    None => found = true,
                    Some(true) => {
                        found = true;
                        result.push(config);
                    }
                    Some(false) => {}
                }
            }
        }
        if found {
            return Ok(result);
        }
    }
    Ok(Vec::new())
}

fn double_relay(
    context: &mut ConfigGeneratorContext,
    index: usize,
) -> BpResult<Vec<LayoutConfiguration>> {
    let junction = context
        .junctions()
        .get(index)
        .cloned()
        .ok_or_else(|| BpError::InvalidInput(format!("missing junction {index}")))?;
    if (junction.ox * junction.oy) % 2.0 != 0.0 {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    if junction.ox < junction.oy {
        let mut y = 1.0;
        while y <= junction.oy / 2.0 {
            let overlaps = context.cut(&junction, index, 0.0, y);
            let mut config = make_double_relay_config(context, overlaps);
            if create_config_filter(&mut config, context, None)? == Some(true) {
                result.push(config);
                let overlaps = context.cut(&junction, index, 0.0, junction.oy - y);
                result.push(make_double_relay_config(context, overlaps));
            }
            y += 1.0;
        }
    } else {
        let mut x = 1.0;
        while x <= junction.ox / 2.0 {
            let overlaps = context.cut(&junction, index, x, 0.0);
            let mut config = make_double_relay_config(context, overlaps);
            if create_config_filter(&mut config, context, None)? == Some(true) {
                result.push(config);
                let overlaps = context.cut(&junction, index, junction.ox - x, 0.0);
                result.push(make_double_relay_config(context, overlaps));
            }
            x += 1.0;
        }
    }
    Ok(result)
}

fn make_double_relay_config(
    context: &ConfigGeneratorContext,
    overlaps: [Overlap; 2],
) -> LayoutConfiguration {
    context.make(
        overlaps
            .into_iter()
            .map(|overlap| Partition {
                overlaps: vec![overlap],
                strategy: None,
            })
            .collect(),
        true,
    )
}

pub fn pattern_generator(
    config: &LayoutConfiguration,
    junctions: &[Junction],
    factor: Point,
    proto: Option<&ConfigurationModel>,
) -> BpResult<Vec<LayoutPattern>> {
    let mut result = Vec::new();
    let mut proto_signature = None;
    if let Some(proto) = proto
        && let Some(patterns) = &proto.patterns
        && !patterns.is_empty()
    {
        if proto.index.is_some() {
            return Ok(patterns
                .iter()
                .cloned()
                .map(LayoutPattern::new_seeded)
                .collect());
        }

        let pattern = LayoutPattern::new_seeded(patterns[0].clone());
        if pattern.valid() {
            let devices = pattern.to_json().devices;
            proto_signature = Some(PatternDevice::signature(&devices)?);
            result.push(pattern);
        }
    }

    let device_sets = config
        .partitions
        .iter()
        .map(|partition| device_generator(&partition.to_json(), junctions))
        .collect::<BpResult<Vec<_>>>()?;
    let mut buffer = Vec::with_capacity(device_sets.len());
    recursive_device_generator(&device_sets, 0, &mut buffer, &mut |devices: &[Device]| {
        if let Some(signature) = proto_signature.as_deref()
            && PatternDevice::signature(devices)? == signature
        {
            proto_signature = None;
            return Ok(());
        }
        let pattern = LayoutPattern::new_positioned(
            PatternModel {
                devices: devices.to_vec(),
            },
            config,
            junctions,
            factor,
        )?;
        if pattern.valid() {
            result.push(pattern);
        }
        Ok(())
    })?;
    Ok(result)
}

pub fn pattern_generator_with_repo(
    config: &LayoutConfiguration,
    repo: &mut LayoutRepository,
    tree: &crate::tree::BpTree,
    proto: Option<&ConfigurationModel>,
) -> BpResult<Vec<LayoutPattern>> {
    let mut result = Vec::new();
    let mut proto_signature = None;
    if let Some(proto) = proto
        && let Some(patterns) = &proto.patterns
        && !patterns.is_empty()
    {
        if proto.index.is_some() {
            return Ok(patterns
                .iter()
                .cloned()
                .map(LayoutPattern::new_seeded)
                .collect());
        }

        let pattern = LayoutPattern::new_seeded(patterns[0].clone());
        if pattern.valid() {
            let devices = pattern.to_json().devices;
            proto_signature = Some(PatternDevice::signature(&devices)?);
            result.push(pattern);
        }
    }

    let partitions = config
        .partitions
        .iter()
        .map(|partition| partition.to_json())
        .collect::<Vec<_>>();
    let mut device_sets = Vec::with_capacity(partitions.len());
    for partition in &partitions {
        device_sets.push(device_generator_with_repo(partition, repo, tree)?);
    }
    let mut buffer = Vec::with_capacity(device_sets.len());
    recursive_device_generator(&device_sets, 0, &mut buffer, &mut |devices: &[Device]| {
        if let Some(signature) = proto_signature.as_deref()
            && PatternDevice::signature(devices)? == signature
        {
            proto_signature = None;
            return Ok(());
        }
        let pattern = LayoutPattern::new_positioned_with_repo(
            PatternModel {
                devices: devices.to_vec(),
            },
            config,
            repo,
            tree,
        )?;
        if pattern.valid() {
            result.push(pattern);
        }
        Ok(())
    })?;
    Ok(result)
}

pub fn device_generator(data: &Partition, junctions: &[Junction]) -> BpResult<Vec<Device>> {
    if data.overlaps.len() == 1 {
        let overlap = &data.overlaps[0];
        let sx = junctions
            .get(overlap.parent)
            .ok_or_else(|| BpError::InvalidInput("device overlap parent is missing".to_string()))?
            .sx;
        return single_overlap_devices(overlap, sx, data.strategy);
    }
    if data.overlaps.len() == 2 {
        return Err(BpError::UnsupportedOperation {
            upstream: "src/core/design/layout/generators/deviceGenerator.ts#joiner",
            reason: "joiner-backed device generation requires repository context; use device_generator_with_repo",
        });
    }
    Err(BpError::UpstreamGap {
        upstream: "src/core/design/layout/generators/deviceGenerator.ts#general-case",
        todo: "general device generation for more than two overlaps is TODO upstream",
    })
}

pub fn device_generator_with_repo(
    data: &Partition,
    repo: &mut LayoutRepository,
    tree: &crate::tree::BpTree,
) -> BpResult<Vec<Device>> {
    if data.overlaps.len() == 1 {
        let overlap = &data.overlaps[0];
        let sx = repo
            .junctions
            .get(overlap.parent)
            .ok_or_else(|| BpError::InvalidInput("device overlap parent is missing".to_string()))?
            .sx;
        return single_overlap_devices(overlap, sx, data.strategy);
    }
    if data.overlaps.len() == 2 {
        let Some(joiner) = Joiner::new(&data.overlaps, repo, tree)? else {
            return Ok(Vec::new());
        };
        return match data.strategy {
            Some(Strategy::StandardJoin) => joiner.standard_join(),
            Some(Strategy::BaseJoin) => joiner.base_join(),
            strategy => joiner.simple_join(strategy),
        };
    }
    Err(BpError::UpstreamGap {
        upstream: "src/core/design/layout/generators/deviceGenerator.ts#general-case",
        todo: "general device generation for more than two overlaps is TODO upstream",
    })
}

pub fn single_overlap_devices(
    overlap: &Overlap,
    sx: f64,
    strategy: Option<Strategy>,
) -> BpResult<Vec<Device>> {
    let ox = integer_dimension(overlap.ox, "overlap ox")?;
    let oy = integer_dimension(overlap.oy, "overlap oy")?;
    let mut devices = Vec::new();
    if strategy == Some(Strategy::HalfIntegral) {
        for gadget in kamiya_half_integral(&JsonOverlap { ox, oy }, sx) {
            devices.push(Device {
                gadgets: vec![model_gadget_from_json(gadget)],
                offset: None,
                add_ons: None,
            });
        }
    }
    if strategy == Some(Strategy::Universal) {
        for gadget in universal_gps(overlap, sx)? {
            devices.push(Device {
                gadgets: vec![gadget],
                offset: None,
                add_ons: None,
            });
        }
    } else {
        for piece in generate_gops(ox, oy, sx) {
            devices.push(Device {
                gadgets: vec![Gadget {
                    pieces: vec![model_piece_from_json(piece)],
                    offset: None,
                    anchors: None,
                }],
                offset: None,
                add_ons: None,
            });
        }
    }
    Ok(devices)
}

fn recursive_device_generator(
    device_sets: &[Vec<Device>],
    depth: usize,
    buffer: &mut Vec<Device>,
    callback: &mut impl FnMut(&[Device]) -> BpResult<()>,
) -> BpResult<()> {
    let Some(devices) = device_sets.get(depth) else {
        return Err(BpError::InvalidInput(
            "pattern generator requires at least one partition".to_string(),
        ));
    };
    for device in devices {
        buffer.push(device.clone());
        if depth + 1 < device_sets.len() {
            recursive_device_generator(device_sets, depth + 1, buffer, callback)?;
        } else {
            callback(buffer)?;
        }
        buffer.pop();
    }
    Ok(())
}

pub fn search_relay(
    items: &[JointItem],
    mut o1: Overlap,
    mut o2: Overlap,
    s1: Option<Strategy>,
    s2: Option<Strategy>,
) -> Vec<Vec<Partition>> {
    if items.len() < 2 {
        return Vec::new();
    }
    let oriented = o1.c[2].e == o2.c[2].e;
    if o1.ox > o2.ox {
        std::mem::swap(&mut o1, &mut o2);
    }

    let mut result = Vec::new();
    if !items[0].split {
        result.push(make_x_relay(o1.clone(), o2.clone(), oriented, s1, s2));
        if s1 != s2 {
            result.push(make_x_relay(o1.clone(), o2.clone(), oriented, s2, s1));
        }
    }
    if !items[1].split {
        result.push(make_y_relay(o1.clone(), o2.clone(), oriented, s1, s2));
        if s1 != s2 {
            result.push(make_y_relay(o1, o2, oriented, s2, s1));
        }
    }
    result
}

fn universal_gps(overlap: &Overlap, sx: f64) -> BpResult<Vec<Gadget>> {
    let base_ox = integer_dimension(overlap.ox, "overlap ox")?;
    let base_oy = integer_dimension(overlap.oy, "overlap oy")?;
    let half_area = (base_ox * base_oy) as f64 / 2.0;
    let min_scaled_span = base_oy as f64 + 2.0 * half_area.sqrt();
    if sx < min_scaled_span {
        // TODO: BP Studio's universal GPS loop has no no-fit guard; keep this
        // finite while oracle coverage decides how to classify the edge case.
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    let mut d = 2;
    let mut found = false;
    while !found {
        let ox = base_ox * d;
        let oy = base_oy * d;
        for piece in generate_gops(ox, oy, sx * f64::from(d as i32)) {
            let mut p1 = PatternPiece::new(model_piece_from_json(piece));
            p1.shrink(f64::from(d as i32));
            let mut p1 = p1.to_json();
            if p1.v.fract() != 0.0 {
                continue;
            }
            let mut p2 = Piece {
                ox: p1.ox,
                oy: p1.oy,
                u: p1.v,
                v: p1.u,
                detours: None,
                shift: None,
            };
            let pt1 = Point { x: 0.0, y: 0.0 };
            let pt2 = Point {
                x: p1.oy + p1.u + p1.v,
                y: p1.ox + p1.u + p1.v,
            };
            p1.detours = Some(vec![vec![pt1, pt2]]);
            p2.detours = Some(vec![vec![pt2, pt1]]);
            let x = p1.oy + p1.u + p1.v;
            let slack = x.ceil() - x;
            let mut gadget = PatternGadget::new(Gadget {
                pieces: vec![p1, p2],
                offset: None,
                anchors: None,
            });
            let mut reversed = gadget.reverse_gps()?;
            gadget.add_slack(QuadrantDirection::Ll, slack);
            reversed.add_slack(QuadrantDirection::Ur, slack);
            result.push(gadget.to_json());
            result.push(reversed.to_json());
            found = true;
        }
        d += 2;
    }
    Ok(result)
}

fn make_x_relay(
    mut o1: Overlap,
    mut o2: Overlap,
    oriented: bool,
    s1: Option<Strategy>,
    s2: Option<Strategy>,
) -> Vec<Partition> {
    o2.ox -= o1.ox;
    let [a, b, c, d] = relay_parameters(oriented);
    o2.c[c] = corner(CornerType::Internal, o1.id, Some(d as u8));
    o2.c[b] = corner(CornerType::Intersection, o1.c[a].e, None);
    o1.c[d] = corner(CornerType::Socket, o2.id, Some(c as u8));
    if !oriented {
        o2.shift = Some(Point { x: o1.ox, y: 0.0 });
    }
    vec![
        Partition {
            overlaps: vec![o1],
            strategy: s1,
        },
        Partition {
            overlaps: vec![o2],
            strategy: s2,
        },
    ]
}

fn make_y_relay(
    mut o1: Overlap,
    mut o2: Overlap,
    oriented: bool,
    s1: Option<Strategy>,
    s2: Option<Strategy>,
) -> Vec<Partition> {
    o1.oy -= o2.oy;
    let [a, b, c, d] = relay_parameters(oriented);
    o1.c[c] = corner(CornerType::Internal, o2.id, Some(b as u8));
    o1.c[d] = corner(CornerType::Intersection, o2.c[a].e, None);
    o2.c[b] = corner(CornerType::Socket, o1.id, Some(c as u8));
    if !oriented {
        o1.shift = Some(Point { x: 0.0, y: o2.oy });
    }
    vec![
        Partition {
            overlaps: vec![o1],
            strategy: s1,
        },
        Partition {
            overlaps: vec![o2],
            strategy: s2,
        },
    ]
}

fn relay_parameters(oriented: bool) -> [usize; 4] {
    if oriented { [0, 1, 2, 3] } else { [2, 3, 0, 1] }
}

pub fn cover(o1: &Overlap, o2: &Overlap) -> bool {
    o1.ox >= o2.ox && o1.oy >= o2.oy
}

pub fn to_split_items(item: &JointItem, node_id: NodeId) -> BpResult<Vec<SplitItem>> {
    let opposite_node_id = item
        .opposite_node_id
        .ok_or_else(|| BpError::InvalidInput("joint item has no opposite node id".to_string()))?;
    item.configs
        .iter()
        .map(|config| to_split_item(config, node_id, opposite_node_id))
        .collect()
}

pub fn get_exposed_part(
    item: &SplitItem,
    against: &SplitItem,
    join: &mut Partition,
) -> BpResult<Option<Partition>> {
    let Some(split) = &item.split else {
        return Ok(None);
    };
    let item_is_taller = item.overlap.oy > against.overlap.oy;
    let is_horizontal = split.is_horizontal;
    let splitting_on_outside = item_is_taller == is_horizontal;
    let mut result = split.remaining_partition.clone();
    if !splitting_on_outside {
        let remaining = result.overlaps.get_mut(0).ok_or_else(|| {
            BpError::InvalidInput("remaining split partition has no overlap".to_string())
        })?;
        if is_horizontal {
            remaining.ox -= against.overlap.ox;
        } else {
            remaining.oy -= against.overlap.oy;
        }

        if join.overlaps.len() < 2 {
            return Err(BpError::InvalidInput(
                "split join partition requires two overlaps".to_string(),
            ));
        }
        for i in 0..2 {
            for q in 0..crate::shared::QUADRANT_NUMBER {
                if join.overlaps[i].c[q].corner_type != CornerType::Intersection as u8 {
                    continue;
                }
                let overlap_is_self = join.overlaps[i].parent == item.overlap.parent;
                let socket_overlap_id = if overlap_is_self {
                    join.overlaps[i].id.ok_or_else(|| {
                        BpError::InvalidInput("join overlap has no id".to_string())
                    })?
                } else {
                    join.overlaps[1 - i].id.ok_or_else(|| {
                        BpError::InvalidInput("paired join overlap has no id".to_string())
                    })?
                };
                replace_intersection_corner(
                    remaining,
                    &mut join.overlaps[i],
                    q,
                    socket_overlap_id,
                    against.opposite_node_id,
                )?;
            }
        }
    }
    Ok(Some(result))
}

fn to_split_item(
    config: &LayoutConfiguration,
    node_id: NodeId,
    opposite_node_id: NodeId,
) -> BpResult<SplitItem> {
    let partitions = config.raw_partitions().ok_or_else(|| {
        BpError::InvalidInput("split item requires raw configuration partitions".to_string())
    })?;
    let overlaps =
        partitions
            .iter()
            .map(|partition| {
                partition.overlaps.first().cloned().ok_or_else(|| {
                    BpError::InvalidInput("raw partition has no overlap".to_string())
                })
            })
            .collect::<BpResult<Vec<_>>>()?;
    if partitions.len() == 1 {
        return Ok(SplitItem {
            overlap: overlaps[0].clone(),
            opposite_node_id,
            split: None,
        });
    }
    let is_horizontal = overlaps[0].ox == overlaps[1].ox;
    let selected = partitions
        .iter()
        .position(|partition| {
            partition.overlaps.first().is_some_and(|overlap| {
                overlap.c[0].e == Some(i64::from(node_id))
                    || overlap.c[2].e == Some(i64::from(node_id))
            })
        })
        .ok_or_else(|| BpError::InvalidInput("no split overlap touches joint node".to_string()))?;
    let remaining = (0..partitions.len())
        .find(|index| *index != selected)
        .ok_or_else(|| {
            BpError::InvalidInput("split configuration has no remaining partition".to_string())
        })?;
    Ok(SplitItem {
        overlap: partitions[selected].overlaps[0].clone(),
        opposite_node_id,
        split: Some(SplitInfo {
            remaining_partition: partitions[remaining].clone(),
            is_horizontal,
        }),
    })
}

fn replace_intersection_corner(
    from: &mut Overlap,
    to: &mut Overlap,
    q: usize,
    socket_overlap_id: i64,
    against_flap_id: NodeId,
) -> BpResult<()> {
    let overlap_is_self = Some(socket_overlap_id) == to.id;
    let q_source = if overlap_is_self {
        q
    } else {
        crate::shared::QUADRANT_NUMBER
            .checked_sub(q)
            .ok_or_else(|| BpError::InvalidInput("invalid quadrant index".to_string()))?
    };
    let target_e =
        to.c.get(q)
            .ok_or_else(|| BpError::InvalidInput("target corner index out of range".to_string()))?
            .e;
    let source = from
        .c
        .get_mut(q_source)
        .ok_or_else(|| BpError::InvalidInput("source corner index out of range".to_string()))?;
    source.corner_type = CornerType::Intersection as u8;
    source.e = if overlap_is_self {
        target_e
    } else {
        Some(i64::from(against_flap_id))
    };

    let target =
        to.c.get_mut(q)
            .ok_or_else(|| BpError::InvalidInput("target corner index out of range".to_string()))?;
    target.corner_type = CornerType::Socket as u8;
    target.e = from.id;
    for (index, corner) in from.c.iter_mut().enumerate() {
        if corner.corner_type == CornerType::Internal as u8 && corner.e == Some(socket_overlap_id) {
            target.q = Some(index as u8);
            corner.e = to.id;
            corner.q = Some(q as u8);
        }
    }
    Ok(())
}

fn integer_dimension(value: f64, name: &str) -> BpResult<i64> {
    if value.fract() == 0.0 {
        Ok(value as i64)
    } else {
        Err(BpError::InvalidInput(format!(
            "{name} must be integral for BP GOPS generation"
        )))
    }
}

fn model_piece_from_json(piece: JsonPiece) -> Piece {
    Piece {
        ox: piece.ox,
        oy: piece.oy,
        u: piece.u,
        v: piece.v,
        detours: piece.detours.map(|detours| {
            detours
                .into_iter()
                .map(|path| path.into_iter().map(model_point_from_json).collect())
                .collect()
        }),
        shift: piece.shift.map(model_point_from_json),
    }
}

fn model_gadget_from_json(gadget: JsonGadget) -> Gadget {
    Gadget {
        pieces: gadget
            .pieces
            .into_iter()
            .map(model_piece_from_json)
            .collect(),
        offset: gadget.offset.map(model_point_from_json),
        anchors: gadget.anchors.map(|anchors| {
            anchors
                .into_iter()
                .map(|anchor| anchor.map(model_anchor_from_json))
                .collect()
        }),
    }
}

fn model_anchor_from_json(anchor: JsonAnchor) -> Anchor {
    Anchor {
        slack: anchor.slack,
        location: anchor.location.map(model_point_from_json),
    }
}

fn model_point_from_json(point: JsonPoint) -> Point {
    Point {
        x: point.x,
        y: point.y,
    }
}

fn push_junction_index(
    map: &mut Vec<(QuadrantCode, Vec<usize>)>,
    code: QuadrantCode,
    index: usize,
) {
    if let Some((_, indices)) = map.iter_mut().find(|(item, _)| *item == code) {
        indices.push(index);
    } else {
        map.push((code, vec![index]));
    }
}

fn junction_corner_code(junction: &Junction, q: QuadrantDirection) -> BpResult<QuadrantCode> {
    let corner = junction
        .c
        .get(q as usize)
        .ok_or_else(|| BpError::InvalidInput("junction corner is missing".to_string()))?;
    let node_id = node_id_from_corner(corner)?;
    let quadrant = corner
        .q
        .map(|q| get_quadrant(u32::from(q)))
        .ok_or_else(|| BpError::InvalidInput("junction corner has no quadrant".to_string()))?;
    Ok(make_quadrant_code(node_id, quadrant))
}

fn node_id_from_corner(corner: &Corner) -> BpResult<NodeId> {
    let id = corner
        .e
        .ok_or_else(|| BpError::InvalidInput("corner has no node id".to_string()))?;
    NodeId::try_from(id).map_err(|_| BpError::InvalidInput(format!("invalid node id {id}")))
}

fn opposite_node_id(junction: &Junction, node_id: NodeId) -> BpResult<NodeId> {
    let first =
        node_id_from_corner(junction.c.first().ok_or_else(|| {
            BpError::InvalidInput("junction first corner is missing".to_string())
        })?)?;
    if first == node_id {
        node_id_from_corner(junction.c.get(2).ok_or_else(|| {
            BpError::InvalidInput("junction opposite corner is missing".to_string())
        })?)
    } else {
        Ok(first)
    }
}

fn resolve_join_rank(rank: usize) -> Option<Strategy> {
    if rank == 0 {
        Some(Strategy::Perfect)
    } else if rank == BASE_JOIN_RANK {
        Some(Strategy::BaseJoin)
    } else if rank == STANDARD_JOIN_RANK {
        Some(Strategy::StandardJoin)
    } else {
        None
    }
}

fn join_overlaps(
    context: &ConfigGeneratorContext,
    overlaps: &mut [Overlap],
    first: usize,
    second: usize,
    oriented: bool,
    reverse: bool,
) -> BpResult<usize> {
    let (first, second) = if reverse {
        (second, first)
    } else {
        (first, second)
    };
    let c = if oriented {
        QuadrantDirection::Ur
    } else {
        QuadrantDirection::Ll
    };
    let [o1, o2] = two_mut(overlaps, first, second)?;
    let offset = if o2.ox > o1.ox {
        PREVIOUS_QUADRANT_OFFSET
    } else {
        NEXT_QUADRANT_OFFSET
    };
    let q = (offset + c as usize) % QUADRANT_NUMBER;
    o2.c[c as usize] = corner(CornerType::Coincide, o1.id, Some(c as u8));
    let other = context
        .junctions()
        .get(o1.parent)
        .and_then(|junction| junction.c.get(opposite(c) as usize))
        .and_then(|corner| corner.e)
        .ok_or_else(|| {
            BpError::InvalidInput("join overlap opposite corner is missing".to_string())
        })?;
    o2.c[q] = corner(CornerType::Intersection, Some(other), None);
    o1.c[opposite(quadrant_direction_from_usize(q)?) as usize] =
        corner(CornerType::Coincide, o2.id, Some(q as u8));
    Ok(second)
}

fn two_mut<T>(items: &mut [T], a: usize, b: usize) -> BpResult<[&mut T; 2]> {
    if a == b || a >= items.len() || b >= items.len() {
        return Err(BpError::InvalidInput("invalid pair indices".to_string()));
    }
    if a < b {
        let (left, right) = items.split_at_mut(b);
        Ok([&mut left[a], &mut right[0]])
    } else {
        let (left, right) = items.split_at_mut(a);
        Ok([&mut right[0], &mut left[b]])
    }
}

fn quadrant_direction_from_usize(value: usize) -> BpResult<QuadrantDirection> {
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

fn corner(corner_type: CornerType, e: Option<i64>, q: Option<u8>) -> Corner {
    Corner {
        corner_type: corner_type as u8,
        e,
        q,
        dynamic: None,
    }
}
