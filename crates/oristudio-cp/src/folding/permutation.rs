use super::combination::{CombinationGenerator, CombinationInferenceFailure};
use super::{
    AdditionalEstimationError, EquivalenceCondition, EquivalenceConditionSet, FaceOrder,
    FoldGraphError, FoldSetupError, HierarchyTable, InitialHierarchy, InitialHierarchyError,
    SubFace, SubFaceConfiguration, apply_quadruple_condition, apply_triple_condition,
    run_additional_estimation, run_additional_estimation_fast,
};
use std::collections::{HashMap, HashSet};

/// Oriedita's own switch point: past this many permutations,
/// `SubFace.possible_overlapping_search` stops brute-forcing the permutation
/// space and hands over to [`CombinationGenerator`].
const COMBINATION_GENERATOR_THRESHOLD: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermutationError {
    InvalidDigit {
        digit: usize,
        num_digits: usize,
    },
    /// The user stopped the fold. See [`crate::cancel`].
    Cancelled,
}

impl From<crate::cancel::Cancelled> for PermutationError {
    fn from(_: crate::cancel::Cancelled) -> Self {
        Self::Cancelled
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermutationSnapshot {
    pub changed_digit: usize,
    pub count: usize,
    pub permutation: Vec<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubFaceSearchError {
    Permutation(PermutationError),
    /// The user stopped the fold. See [`crate::cancel`].
    Cancelled,
}

impl From<crate::cancel::Cancelled> for SubFaceSearchError {
    fn from(_: crate::cancel::Cancelled) -> Self {
        Self::Cancelled
    }
}

impl SubFaceSearchError {
    pub fn is_cancelled(&self) -> bool {
        matches!(
            self,
            Self::Cancelled | Self::Permutation(PermutationError::Cancelled)
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubFacePriority {
    pub ordered_subface_indices: Vec<usize>,
    pub valid_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerOverlapSearch {
    pub found: bool,
    pub hierarchy: InitialHierarchy,
    pub priority: SubFacePriority,
    pub subface_total: usize,
}

#[derive(Debug, Clone)]
struct WorkerSearchEntry {
    subface_index: usize,
    search: SubFacePermutationSearch,
    swap_counter: usize,
}

/// Port of the generic base `SwappingAlgorithm<T>`.
///
/// Upstream parameterises over the element type and keys `visited`/`history` by
/// object identity. Here the elements are stable ids and `order` is the
/// permutation of them being swapped, so the id *is* the identity. `history`
/// stores the visited prefix exactly rather than upstream's `Arrays.hashCode`,
/// which can only make the loop-breaking trigger less often, never more.
#[derive(Debug, Clone, Default)]
pub struct SwappingAlgorithm {
    high: usize,
    history: HashSet<Vec<usize>>,
    visited: HashSet<usize>,
}

impl SwappingAlgorithm {
    /// Records a dead-end. Port of `SwappingAlgorithm.record`.
    pub(super) fn record(&mut self, index: usize) {
        self.high = index;
    }

    fn visit(&mut self, item: usize) {
        self.visited.insert(item);
    }

    fn visited_count(&self) -> usize {
        self.visited.len()
    }

    /// Port of `SwappingAlgorithm.process`. Returns the position the dead-ended
    /// element was moved to, or `None` when no swap happened — the two paths that
    /// return early are exactly the ones where upstream never reaches its
    /// `onAfterProcess` hook.
    pub(super) fn process<SwapOver>(
        &mut self,
        order: &mut [usize],
        max: usize,
        on_swap_over: &mut SwapOver,
    ) -> Option<usize>
    where
        SwapOver: FnMut(usize),
    {
        if self.high < 2 {
            return None;
        }

        let mut hash = order_prefix(order, self.high);
        if self.history.contains(&hash) {
            // Introduce an unvisited element to break the loop.
            let reverse_result = self.reverse_swap(order, 1, self.high, max, 1, on_swap_over);
            if reverse_result == self.high {
                return None;
            }
            self.high = reverse_result;
            hash = order_prefix(order, self.high);
        }
        self.history.insert(hash);

        let low = self.high / 2;
        swap_order(order, self.high, low, on_swap_over);
        self.high = 0;
        Some(low)
    }

    fn reverse_swap<SwapOver>(
        &mut self,
        order: &mut [usize],
        index: usize,
        mut high: usize,
        max: usize,
        mut remaining: usize,
        on_swap_over: &mut SwapOver,
    ) -> usize
    where
        SwapOver: FnMut(usize),
    {
        let mut i = index + 1;
        while i <= max && remaining > 0 {
            let Some(item) = order.get(i.saturating_sub(1)).copied() else {
                break;
            };
            if !self.visited.contains(&item) {
                self.visited.insert(item);
                swap_order(order, i, index, on_swap_over);
                high += 1;
                remaining -= 1;
            }
            i += 1;
        }
        high
    }
}

/// Port of `SubFaceSwappingAlgorithm`: the base algorithm plus the subface
/// `onAfterProcess` / `onSwapOver` hooks and `shouldEstimate`.
#[derive(Debug, Clone, Default)]
pub struct SubFaceSwapper {
    base: SwappingAlgorithm,
    last_low: usize,
}

impl SubFaceSwapper {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&mut self, index: usize) {
        self.base.record(index);
    }

    pub fn visit(&mut self, item: usize) {
        self.base.visit(item);
    }

    pub fn visited_count(&self) -> usize {
        self.base.visited_count()
    }

    pub fn should_estimate(&mut self, index: usize) -> bool {
        if self.last_low == 0 {
            return true;
        }
        if index == self.last_low {
            self.last_low = 0;
            return true;
        }
        false
    }

    pub fn process(&mut self, order: &mut [usize], max: usize, swap_counters: &[usize]) {
        self.process_with_callbacks(
            order,
            max,
            |item| swap_counters.get(item).copied().unwrap_or(0),
            |_| {},
        );
    }

    fn process_with_callbacks<Counter, SwapOver>(
        &mut self,
        order: &mut [usize],
        max: usize,
        mut swap_counter: Counter,
        mut on_swap_over: SwapOver,
    ) where
        Counter: FnMut(usize) -> usize,
        SwapOver: FnMut(usize),
    {
        let Some(low) = self.base.process(order, max, &mut on_swap_over) else {
            return;
        };

        // SubFaceSwappingAlgorithm.onAfterProcess
        self.last_low = low;
        let reverse_count = order
            .get(low.saturating_sub(1))
            .map(|item| swap_counter(*item))
            .unwrap_or(0)
            .saturating_sub(1);
        self.base
            .reverse_swap(order, low, low, max, reverse_count, &mut on_swap_over);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerOverlapSearchError {
    SubFace(SubFaceSearchError),
    AdditionalEstimation(AdditionalEstimationError),
    Setup(FoldSetupError),
    FinalAdditionalEstimationRequired {
        valid_count: usize,
        reduced_subface_count: usize,
    },
    /// The user stopped the fold. See [`crate::cancel`].
    Cancelled,
}

impl From<crate::cancel::Cancelled> for WorkerOverlapSearchError {
    fn from(_: crate::cancel::Cancelled) -> Self {
        Self::Cancelled
    }
}

impl WorkerOverlapSearchError {
    /// Whether this is the user stopping, at any depth.
    ///
    /// The `AdditionalEstimation` arm is why this cannot be a `matches!`:
    /// `From<FoldingEstimateError> for EngineError` maps that arm through a
    /// wildcard to `"fold_contradiction"`, so a cancel nested inside it has to
    /// be visible from here.
    pub fn is_cancelled(&self) -> bool {
        match self {
            Self::Cancelled => true,
            Self::SubFace(subface) => subface.is_cancelled(),
            Self::AdditionalEstimation(estimation) => estimation.is_cancelled(),
            Self::Setup(setup) => setup.is_cancelled(),
            Self::FinalAdditionalEstimationRequired { .. } => false,
        }
    }
}

impl From<SubFaceSearchError> for WorkerOverlapSearchError {
    fn from(error: SubFaceSearchError) -> Self {
        Self::SubFace(error)
    }
}

impl From<PermutationError> for WorkerOverlapSearchError {
    fn from(error: PermutationError) -> Self {
        Self::SubFace(SubFaceSearchError::Permutation(error))
    }
}

impl From<AdditionalEstimationError> for WorkerOverlapSearchError {
    fn from(error: AdditionalEstimationError) -> Self {
        Self::AdditionalEstimation(error)
    }
}

impl From<FoldSetupError> for WorkerOverlapSearchError {
    fn from(error: FoldSetupError) -> Self {
        Self::Setup(error)
    }
}

impl From<FoldGraphError> for WorkerOverlapSearchError {
    fn from(error: FoldGraphError) -> Self {
        Self::Setup(FoldSetupError::FoldGraph(error))
    }
}

impl From<InitialHierarchyError> for WorkerOverlapSearchError {
    fn from(error: InitialHierarchyError) -> Self {
        Self::Setup(FoldSetupError::InitialHierarchy(error))
    }
}

pub fn prioritize_subfaces(
    subfaces: &[SubFace],
    reduced_subface_indices: &[usize],
    hierarchy: &InitialHierarchy,
) -> SubFacePriority {
    let reduced_count = reduced_subface_indices.len();
    let mut new_info_count = vec![0usize; reduced_count];
    let mut processed = vec![false; reduced_count];
    let mut observers = HashMap::<(usize, usize), Vec<usize>>::new();
    let mut pair_states = PairStateTable::from_hierarchy(hierarchy);

    for (reduced_index, subface_index) in reduced_subface_indices.iter().enumerate() {
        let Some(subface) = subfaces.get(*subface_index) else {
            continue;
        };
        for i in 0..subface.face_ids.len().saturating_sub(1) {
            for j in (i + 1)..subface.face_ids.len() {
                let pair = pair_key(subface.face_ids[i], subface.face_ids[j]);
                if pair_states.get(pair) == PairState::Empty {
                    observers.entry(pair).or_default().push(reduced_index);
                    new_info_count[reduced_index] += 1;
                }
            }
        }
    }

    let mut ordered_subface_indices = Vec::with_capacity(reduced_count);
    let mut valid_count = 0usize;
    for _ in 0..reduced_count {
        let (selected, max_new_info) = max_priority_subface(
            subfaces,
            reduced_subface_indices,
            &new_info_count,
            &processed,
        );
        ordered_subface_indices.push(reduced_subface_indices[selected]);
        if max_new_info > 0 {
            valid_count += 1;
        }
        processed[selected] = true;

        let Some(subface) = subfaces.get(reduced_subface_indices[selected]) else {
            continue;
        };
        for i in 0..subface.face_ids.len().saturating_sub(1) {
            for j in (i + 1)..subface.face_ids.len() {
                let pair = pair_key(subface.face_ids[i], subface.face_ids[j]);
                if pair_states.get(pair) == PairState::Empty {
                    pair_states.set(pair, PairState::Unknown);
                    if let Some(observers) = observers.get(&pair) {
                        for observer in observers {
                            new_info_count[*observer] = new_info_count[*observer].saturating_sub(1);
                        }
                    }
                }
            }
        }
    }

    SubFacePriority {
        ordered_subface_indices,
        valid_count,
    }
}

pub fn possible_overlap_search_for_subfaces(
    subfaces: &[SubFace],
    reduced_subface_indices: &[usize],
    hierarchy: &InitialHierarchy,
    conditions: Option<&EquivalenceConditionSet>,
) -> Result<WorkerOverlapSearch, WorkerOverlapSearchError> {
    possible_overlap_search_for_subfaces_impl(
        subfaces,
        reduced_subface_indices,
        hierarchy,
        conditions,
        false,
    )
}

pub fn possible_overlap_search_for_subfaces_with_swap(
    subfaces: &[SubFace],
    reduced_subface_indices: &[usize],
    hierarchy: &InitialHierarchy,
    conditions: Option<&EquivalenceConditionSet>,
) -> Result<WorkerOverlapSearch, WorkerOverlapSearchError> {
    possible_overlap_search_for_subfaces_impl(
        subfaces,
        reduced_subface_indices,
        hierarchy,
        conditions,
        true,
    )
}

fn possible_overlap_search_for_subfaces_impl(
    subfaces: &[SubFace],
    reduced_subface_indices: &[usize],
    hierarchy: &InitialHierarchy,
    conditions: Option<&EquivalenceConditionSet>,
    swap: bool,
) -> Result<WorkerOverlapSearch, WorkerOverlapSearchError> {
    let mut enumerator = WorkerOverlapEnumerator::from_subfaces(
        subfaces,
        reduced_subface_indices,
        hierarchy,
        conditions,
    )?;
    enumerator.possible_overlapping_search(swap)
}

#[doc(hidden)]
pub fn possible_overlap_search_for_ordered_subfaces(
    subfaces: &[SubFace],
    valid_count: usize,
    hierarchy: &InitialHierarchy,
    conditions: Option<&EquivalenceConditionSet>,
    swap: bool,
) -> Result<WorkerOverlapSearch, WorkerOverlapSearchError> {
    let ordered_subface_indices = (0..subfaces.len()).collect::<Vec<_>>();
    let mut enumerator = WorkerOverlapEnumerator::from_ordered_subfaces(
        subfaces,
        &ordered_subface_indices,
        valid_count,
        hierarchy,
        conditions,
    )?;
    enumerator.possible_overlapping_search(swap)
}

/// Stateful port of Oriedita `FoldedFigure_Worker` overlap enumeration.
///
/// Oriedita preserves each SubFace permutation generator between
/// `possible_overlapping_search(...)` calls and advances the valid prefix with
/// `next(SubFace_valid_number)` after each discovered solution. This type owns
/// that same mutable search state so command-layer APIs can implement
/// `ORDER_6`, `foldAnother`, and batch enumeration without replaying from the
/// beginning.
#[derive(Debug, Clone)]
pub struct WorkerOverlapEnumerator {
    entries: Vec<WorkerSearchEntry>,
    order: Vec<usize>,
    valid_count: usize,
    subface_total: usize,
    hierarchy: InitialHierarchy,
    conditions: Option<EquivalenceConditionSet>,
}

impl WorkerOverlapEnumerator {
    pub fn from_subfaces(
        subfaces: &[SubFace],
        reduced_subface_indices: &[usize],
        hierarchy: &InitialHierarchy,
        conditions: Option<&EquivalenceConditionSet>,
    ) -> Result<Self, WorkerOverlapSearchError> {
        let priority = prioritize_subfaces(subfaces, reduced_subface_indices, hierarchy);
        let mut enumerator = Self::from_ordered_subfaces(
            subfaces,
            &priority.ordered_subface_indices,
            priority.valid_count,
            hierarchy,
            conditions,
        )?;
        enumerator.subface_total = subfaces.len();
        Ok(enumerator)
    }

    pub fn from_ordered_subfaces(
        subfaces: &[SubFace],
        ordered_subface_indices: &[usize],
        initial_valid_count: usize,
        hierarchy: &InitialHierarchy,
        conditions: Option<&EquivalenceConditionSet>,
    ) -> Result<Self, WorkerOverlapSearchError> {
        let mut valid_count = initial_valid_count.min(ordered_subface_indices.len());
        let mut entries = Vec::with_capacity(ordered_subface_indices.len());
        for subface_index in ordered_subface_indices {
            // Site 8. `set_guide_map` below is ~10ms per subface on a large
            // model, and this loop runs once per subface at setup.
            crate::cancel::check()?;
            let Some(subface) = subfaces.get(*subface_index) else {
                continue;
            };
            let mut search = SubFacePermutationSearch::new(subface.face_ids.clone());
            if entries.len() < valid_count {
                search.set_guide_map(hierarchy, conditions)?;
            }
            entries.push(WorkerSearchEntry {
                subface_index: *subface_index,
                search,
                swap_counter: 0,
            });
        }
        valid_count = valid_count.min(entries.len());
        Ok(Self {
            order: (0..entries.len()).collect(),
            entries,
            valid_count,
            subface_total: ordered_subface_indices.len(),
            hierarchy: hierarchy.clone(),
            conditions: conditions.cloned(),
        })
    }

    pub fn valid_count(&self) -> usize {
        self.valid_count
    }

    pub fn priority(&self) -> SubFacePriority {
        current_priority(self.valid_count, &self.entries, &self.order)
    }

    pub fn current_ordered_subfaces(&self, count: usize) -> Vec<(usize, Vec<usize>)> {
        self.order
            .iter()
            .take(count.min(self.order.len()))
            .filter_map(|entry_index| {
                self.entries
                    .get(*entry_index)
                    .map(|entry| (entry.subface_index, entry.search.current_ordering()))
            })
            .collect()
    }

    pub fn next(&mut self, subface_count: usize) -> Result<usize, PermutationError> {
        advance_subface_permutations(
            &mut self.entries,
            &self.order,
            subface_count,
            self.valid_count,
        )
    }

    pub fn possible_overlapping_search(
        &mut self,
        swap: bool,
    ) -> Result<WorkerOverlapSearch, WorkerOverlapSearchError> {
        crate::fold_profiling::record_sizes(
            self.hierarchy.faces_total as u64,
            self.subface_total as u64,
            self.valid_count as u64,
            self.hierarchy.relations.len() as u64,
        );
        let mut swapper = SubFaceSwapper::new();
        let mut realtime_additional_estimation = swap;
        let mut last_table = HierarchyTable::from_initial(&self.hierarchy);
        let mut changed_subface = 1usize;
        let conditions = self.conditions.clone();
        let conditions = conditions.as_ref();
        while changed_subface != 0 {
            crate::fold_profiling::bump_outer_iter();
            match inconsistent_subface_request(
                &mut self.entries,
                &self.order,
                self.valid_count,
                &self.hierarchy,
                conditions,
                swap.then_some(&mut swapper),
                &mut realtime_additional_estimation,
            )? {
                WorkerSearchStep::Consistent(table) => {
                    let mut table = table;
                    if let Err(failure) = run_final_additional_estimation(
                        &mut table,
                        &self.entries,
                        &self.order,
                        self.valid_count,
                        conditions,
                    ) {
                        // Matched before the recovery below, which promotes a
                        // subface and keeps searching: a cancel must stop, not be
                        // converted into more work.
                        let error_position = match failure {
                            FinalAdditionalEstimationFailure::Cancelled => {
                                return Err(crate::cancel::Cancelled.into());
                            }
                            FinalAdditionalEstimationFailure::Contradiction { error_position } => {
                                error_position
                            }
                        };
                        let mut recovered_missing_subface = false;
                        if let Some(error_position) = error_position
                            && self.valid_count < self.order.len()
                        {
                            recovered_missing_subface = true;
                            self.valid_count += 1;
                            let new_position = self.valid_count - 1;
                            let error_position = error_position - 1;
                            if error_position < self.order.len() {
                                self.order.swap(new_position, error_position);
                            }
                            let entry_index = self.order[new_position];
                            self.entries[entry_index]
                                .search
                                .set_guide_map(&self.hierarchy, conditions)?;
                            if swap {
                                swapper.record(self.valid_count);
                            }
                        }
                        last_table = if recovered_missing_subface {
                            HierarchyTable::from_initial(&self.hierarchy)
                        } else {
                            table
                        };
                        changed_subface = self.next(self.valid_count.saturating_sub(1))?;
                        if swap {
                            self.process_swapper(&mut swapper);
                        }
                        continue;
                    }
                    return Ok(WorkerOverlapSearch {
                        found: true,
                        hierarchy: table.into_initial_hierarchy(self.hierarchy.faces_total),
                        priority: self.priority(),
                        subface_total: self.subface_total,
                    });
                }
                WorkerSearchStep::Inconsistent { subface_id, table } => {
                    last_table = table;
                    changed_subface = self.next(subface_id - 1)?;
                    if swap {
                        self.process_swapper(&mut swapper);
                    }
                }
                WorkerSearchStep::RetryWithoutRealtimeAdditionalEstimation => {}
            }
        }

        Ok(WorkerOverlapSearch {
            found: false,
            hierarchy: last_table.into_initial_hierarchy(self.hierarchy.faces_total),
            priority: self.priority(),
            subface_total: self.subface_total,
        })
    }

    fn process_swapper(&mut self, swapper: &mut SubFaceSwapper) {
        let counters = self
            .entries
            .iter()
            .map(|entry| entry.swap_counter)
            .collect::<Vec<_>>();
        swapper.process_with_callbacks(
            &mut self.order,
            self.valid_count,
            |item| counters.get(item).copied().unwrap_or(0),
            |item| self.entries[item].search.clear_temp_guide(),
        );
    }
}

fn run_final_additional_estimation(
    table: &mut HierarchyTable,
    entries: &[WorkerSearchEntry],
    order: &[usize],
    completed_subfaces: usize,
    conditions: Option<&EquivalenceConditionSet>,
) -> Result<(), FinalAdditionalEstimationFailure> {
    let configuration = subface_configuration_from_entries(entries, order, entries.len());
    let empty_conditions = empty_conditions();
    let conditions = conditions.unwrap_or(&empty_conditions);
    loop {
        let mut changes = 0usize;
        changes += infer_final_subface_transitivity(table, &configuration, completed_subfaces)?;
        for condition in &conditions.triple_conditions {
            changes += apply_triple_condition(table, *condition).map_err(|_| {
                FinalAdditionalEstimationFailure::Contradiction {
                    error_position: None,
                }
            })?;
        }
        for condition in &conditions.quadruple_conditions {
            changes += apply_quadruple_condition(table, *condition).map_err(|_| {
                FinalAdditionalEstimationFailure::Contradiction {
                    error_position: None,
                }
            })?;
        }
        if changes == 0 {
            return Ok(());
        }
    }
}

/// Why the final additional-estimation pass did not complete.
///
/// An enum rather than a bare `error_position` because its caller *recovers*
/// from failure — promoting a subface and continuing the search. A cancel
/// reaching that recovery would be silently converted into more searching, so
/// the two have to be distinguishable at the type level.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FinalAdditionalEstimationFailure {
    /// The pass found the hierarchy inconsistent. `error_position` is the
    /// 1-based position the caller promotes, when it knows one.
    Contradiction {
        error_position: Option<usize>,
    },
    Cancelled,
}

impl From<crate::cancel::Cancelled> for FinalAdditionalEstimationFailure {
    fn from(_: crate::cancel::Cancelled) -> Self {
        Self::Cancelled
    }
}

fn infer_final_subface_transitivity(
    table: &mut HierarchyTable,
    subfaces: &SubFaceConfiguration,
    completed_subfaces: usize,
) -> Result<usize, FinalAdditionalEstimationFailure> {
    let mut changes = 0usize;
    for (position, subface_index) in subfaces
        .reduced_subface_indices
        .iter()
        .enumerate()
        .skip(completed_subfaces)
    {
        let Some(subface) = subfaces.subfaces.get(*subface_index) else {
            continue;
        };
        for upper in &subface.face_ids {
            // Site 7. `face_ids` reaches ~250, so the two loops below are a k^2
            // sweep per `upper` — a poll here bounds the gap without paying one
            // per face triple.
            crate::cancel::check()?;
            for middle in &subface.face_ids {
                if table.get(*upper, *middle) != Some(FaceOrder::Above) {
                    continue;
                }
                for lower in &subface.face_ids {
                    if table.get(*middle, *lower) == Some(FaceOrder::Above) {
                        changes +=
                            usize::from(table.infer_above(*upper, *lower).map_err(|_| {
                                FinalAdditionalEstimationFailure::Contradiction {
                                    error_position: Some(position + 1),
                                }
                            })?);
                    }
                }
            }
        }
    }
    Ok(changes)
}

fn run_realtime_additional_estimation(
    table: &mut HierarchyTable,
    entries: &[WorkerSearchEntry],
    order: &[usize],
    valid_count: usize,
    conditions: Option<&EquivalenceConditionSet>,
) -> Result<(), AdditionalEstimationError> {
    crate::fold_profiling::bump_realtime_estimation();
    let configuration = subface_configuration_from_entries(entries, order, valid_count);
    let empty_conditions = empty_conditions();
    let conditions = conditions.unwrap_or(&empty_conditions);
    run_additional_estimation(
        table,
        &configuration,
        &conditions.triple_conditions,
        &conditions.quadruple_conditions,
    )
}

fn run_fast_realtime_additional_estimation(
    table: &mut HierarchyTable,
    entries: &[WorkerSearchEntry],
    order: &[usize],
    valid_count: usize,
    conditions: Option<&EquivalenceConditionSet>,
) -> Result<(), AdditionalEstimationError> {
    crate::fold_profiling::bump_fast_realtime_estimation();
    let configuration = subface_configuration_from_entries(entries, order, valid_count);
    let empty_conditions = empty_conditions();
    let conditions = conditions.unwrap_or(&empty_conditions);
    run_additional_estimation_fast(
        table,
        &configuration,
        &conditions.triple_conditions,
        &conditions.quadruple_conditions,
    )
}

fn subface_configuration_from_entries(
    entries: &[WorkerSearchEntry],
    order: &[usize],
    count: usize,
) -> SubFaceConfiguration {
    let subfaces = order
        .iter()
        .take(count)
        .filter_map(|entry_index| entries.get(*entry_index))
        .map(|entry| SubFace {
            face_ids: entry.search.face_ids.clone(),
        })
        .collect::<Vec<_>>();
    let face_id_count_max = subfaces
        .iter()
        .map(|subface| subface.face_ids.len())
        .max()
        .unwrap_or(0);
    SubFaceConfiguration {
        reduced_subface_indices: (0..subfaces.len()).collect(),
        subfaces,
        face_id_count_max,
    }
}

fn current_priority(
    valid_count: usize,
    entries: &[WorkerSearchEntry],
    order: &[usize],
) -> SubFacePriority {
    SubFacePriority {
        ordered_subface_indices: order
            .iter()
            .filter_map(|entry_index| entries.get(*entry_index))
            .map(|entry| entry.subface_index)
            .collect(),
        valid_count,
    }
}

fn empty_conditions() -> EquivalenceConditionSet {
    EquivalenceConditionSet {
        triple_conditions: Vec::new(),
        quadruple_conditions: Vec::new(),
    }
}

impl From<PermutationError> for SubFaceSearchError {
    fn from(error: PermutationError) -> Self {
        Self::Permutation(error)
    }
}

#[derive(Debug, Clone)]
pub struct SubFacePermutationSearch {
    face_ids: Vec<usize>,
    face_id_map: HashMap<usize, usize>,
    generator: ChainPermutationGenerator,
    triple_conditions: HashMap<usize, Vec<EquivalenceCondition>>,
    quadruple_conditions: Vec<EquivalenceCondition>,
    /// Oriedita `SubFace.cg`: the excess-permutation accelerator, created once
    /// the generator passes 2000 permutations and retired by
    /// [`Self::clear_temp_guide`] / [`Self::reset_permutation_generator`].
    combination: Option<CombinationGenerator>,
    /// Oriedita `SubFace.cgTotal`: permutations counted before each generator
    /// reset the accelerator drives, so the reported total keeps accumulating.
    combination_total: usize,
}

impl SubFacePermutationSearch {
    pub fn new(face_ids: Vec<usize>) -> Self {
        let face_count = face_ids.len();
        Self {
            face_ids,
            face_id_map: HashMap::new(),
            generator: ChainPermutationGenerator::new(face_count),
            triple_conditions: HashMap::new(),
            quadruple_conditions: Vec::new(),
            combination: None,
            combination_total: 0,
        }
    }

    pub fn face_ids(&self) -> &[usize] {
        &self.face_ids
    }

    /// Oriedita `SubFace.getPermutationCount()`.
    pub fn permutation_count(&self) -> usize {
        self.combination_total + self.generator.count()
    }

    pub fn current_ordering(&self) -> Vec<usize> {
        (1..=self.face_ids.len())
            .filter_map(|position| {
                let local_index = self.generator.permutation_at(position)?;
                local_index
                    .checked_sub(1)
                    .and_then(|index| self.face_ids.get(index))
                    .copied()
            })
            .collect()
    }

    /// Oriedita `SubFace.next(int k)`: advance the permutation generator, and
    /// when it runs out with the accelerator active, let the accelerator supply
    /// the next batch of permutations instead of reporting exhaustion.
    pub fn next(&mut self, digit: usize) -> Result<usize, PermutationError> {
        let changed = self.generator.next(digit)?;
        if changed == 0 && self.combination.is_some() {
            self.combination_total += self.generator.count();
            self.generator.reset();
            return self.run_combination_generator();
        }
        Ok(changed)
    }

    /// Oriedita `SubFace.resetPermutationGenerator()`.
    pub fn reset_permutation_generator(&mut self) {
        if self.face_ids.is_empty() {
            return;
        }
        self.combination = None;
        self.combination_total = 0;
        self.generator.reset();
    }

    /// Oriedita `SubFace.clearTempGuide()`. Retiring the accelerator as well is
    /// upstream-flagged as "very important": its guides are temporary ones, so
    /// clearing them without retiring it would leave it believing they still
    /// constrain the generator.
    pub fn clear_temp_guide(&mut self) {
        self.generator.clear_temp_guide();
        self.combination = None;
    }

    /// Oriedita `SubFace.possible_overlapping_search()`.
    pub fn possible_overlapping_search(
        &mut self,
        hierarchy: &InitialHierarchy,
    ) -> Result<bool, SubFaceSearchError> {
        let table = HierarchyTable::from_initial(hierarchy);
        self.possible_overlapping_search_with_table(&table)
    }

    fn possible_overlapping_search_with_table(
        &mut self,
        table: &HierarchyTable,
    ) -> Result<bool, SubFaceSearchError> {
        let mut changed = 1usize;
        let mut polled = 0u32;
        while changed != 0 {
            // Site 5. One iteration tests a single permutation, so the stride
            // keeps the poll well under a percent of the loop's own cost.
            crate::check_every!(polled, 6);
            // Past this many permutations, brute force is losing: the guides have
            // stopped pruning and almost nothing the generator produces will pass
            // the equivalence-condition checks. Switch to searching the conditions
            // themselves.
            if self.generator.count() > COMBINATION_GENERATOR_THRESHOLD
                && self.combination.is_none()
            {
                match CombinationGenerator::new(
                    &self.face_ids,
                    &self.face_id_map,
                    &self.equivalence_conditions(),
                    &self.u_equivalence_conditions(),
                    table,
                ) {
                    Ok(combination) => {
                        self.combination = Some(combination);
                        if self.run_combination_generator()? == 0 {
                            return Ok(false);
                        }
                    }
                    // A cancel here must NOT become `Ok(false)`: that value means
                    // "no stacking of this subface exists", so absorbing it would
                    // report a fabricated algorithmic verdict for a fold the user
                    // merely stopped.
                    Err(CombinationInferenceFailure::Cancelled) => {
                        return Err(crate::cancel::Cancelled.into());
                    }
                    // The subface's known relations already contradict each other,
                    // so no stacking of it exists.
                    Err(CombinationInferenceFailure::Contradiction { .. }) => return Ok(false),
                }
            }

            let inconsistent_digit = self.inconsistent_digits_request(table)?;
            if inconsistent_digit == 1000 {
                return Ok(true);
            }
            changed = self.next(inconsistent_digit)?;
        }
        Ok(false)
    }

    /// Oriedita `SubFace.runCombinationGenerator()`: keep asking the accelerator
    /// for combinations until one of them admits a permutation, or until it has
    /// no combinations left (0).
    fn run_combination_generator(&mut self) -> Result<usize, PermutationError> {
        loop {
            // Site 6. `CombinationGenerator::process` returns `bool`, where
            // `false` means "no combinations left" — so its own body must not be
            // made fallible, or a cancel becomes that answer. The checkpoint
            // lives here instead, in the caller that already returns `Result`.
            crate::cancel::check()?;
            let Some(combination) = self.combination.as_mut() else {
                return Ok(0);
            };
            if !combination.process() {
                return Ok(0);
            }
            let digit = combination.add_guide_and_check(&mut self.generator)?;
            if digit == 0 {
                return Ok(1);
            }
            let changed = self.generator.next(digit)?;
            if changed != 0 {
                return Ok(changed);
            }
            self.generator.reset();
        }
    }

    /// Oriedita `SubFace.getEquivalenceConditions()`: this subface's 3ECs,
    /// ordered by where their `a` face sits in the subface's face list.
    fn equivalence_conditions(&self) -> Vec<EquivalenceCondition> {
        self.face_ids
            .iter()
            .filter_map(|face_id| self.triple_conditions.get(face_id))
            .flatten()
            .copied()
            .collect()
    }

    /// Oriedita `SubFace.getUEquivalenceConditions()`: this subface's 4ECs,
    /// sorted by `(a, b, c, d)`. Upstream sorts the list in place on first use;
    /// the only reader that depends on the order is the combination generator,
    /// and the penetration check folds a minimum, so sorting a copy here is
    /// equivalent.
    fn u_equivalence_conditions(&self) -> Vec<EquivalenceCondition> {
        let mut conditions = self.quadruple_conditions.clone();
        conditions.sort_by_key(|condition| (condition.a, condition.b, condition.c, condition.d));
        conditions
    }

    fn enter_stacking_into(
        &self,
        table: &mut HierarchyTable,
    ) -> Result<(), AdditionalEstimationError> {
        let ordering = self.current_ordering();
        for i in 0..ordering.len().saturating_sub(1) {
            for j in (i + 1)..ordering.len() {
                table.infer_above(ordering[i], ordering[j])?;
            }
        }
        Ok(())
    }

    /// Oriedita `SubFace.setGuideMap()`: derive permutation guides from the
    /// known face hierarchy, retain equivalence conditions that are local to
    /// this subface, and initialize the generator.
    pub fn set_guide_map(
        &mut self,
        hierarchy: &InitialHierarchy,
        conditions: Option<&EquivalenceConditionSet>,
    ) -> Result<(), PermutationError> {
        let face_count = self.face_ids.len();
        self.face_id_map.clear();
        for (index, face_id) in self.face_ids.iter().enumerate() {
            self.face_id_map.insert(*face_id, index + 1);
        }

        self.generator = ChainPermutationGenerator::new(face_count);
        // Upstream reuses the generator built in `setNumDigits` and only ever
        // calls this before the subface has searched anything, so its `cg` is
        // always null here. Rebuilding the generator makes that implicit state
        // explicit: an accelerator holding guides for the old generator would be
        // stale.
        self.combination = None;
        self.combination_total = 0;
        let table = HierarchyTable::from_initial(hierarchy);
        for face_index in 1..=face_count {
            let mut upper_face_ids = Vec::new();
            let mut upper_face_enabled = Vec::new();

            for i in 1..=face_count {
                if table.get(self.face_ids[i - 1], self.face_ids[face_index - 1])
                    == Some(FaceOrder::Above)
                {
                    upper_face_ids.push(i);
                    upper_face_enabled.push(true);
                }
            }

            for i in 0..upper_face_ids.len().saturating_sub(1) {
                for j in 0..upper_face_ids.len() {
                    if table.get(
                        self.face_ids[upper_face_ids[i] - 1],
                        self.face_ids[upper_face_ids[j] - 1],
                    ) == Some(FaceOrder::Above)
                    {
                        upper_face_enabled[i] = false;
                        break;
                    }
                }
            }

            for (i, upper_face_id) in upper_face_ids.iter().enumerate() {
                if upper_face_enabled[i] {
                    self.generator.add_guide(*upper_face_id, face_index)?;
                }
            }
        }

        self.triple_conditions.clear();
        self.quadruple_conditions.clear();
        if let Some(conditions) = conditions {
            for condition in &conditions.triple_conditions {
                if self.fast_contains(*condition) {
                    self.triple_conditions
                        .entry(condition.a)
                        .or_default()
                        .push(*condition);
                }
            }
            for condition in &conditions.quadruple_conditions {
                if self.fast_contains(*condition) {
                    self.quadruple_conditions.push(*condition);
                }
            }
        }

        self.generator.initialize();
        Ok(())
    }

    fn fast_contains(&self, condition: EquivalenceCondition) -> bool {
        self.face_id_map.contains_key(&condition.a)
            && self.face_id_map.contains_key(&condition.b)
            && self.face_id_map.contains_key(&condition.c)
            && self.face_id_map.contains_key(&condition.d)
    }

    fn inconsistent_digits_request(
        &mut self,
        hierarchy: &HierarchyTable,
    ) -> Result<usize, PermutationError> {
        let min = self.overlapping_inconsistent_digits_request(hierarchy)?;
        // Skipping the penetration checks while the accelerator is active is
        // upstream's own speed-up, and is what makes the switch worth making: the
        // accelerator only ever offers permutations that already satisfy every
        // equivalence condition, so re-checking them here would find nothing.
        if self.combination.is_some() {
            return Ok(min);
        }
        let min = self.penetration_inconsistent_digits_request(min);
        Ok(self.u_penetration_inconsistent_digits_request(min))
    }

    fn overlapping_inconsistent_digits_request(
        &mut self,
        hierarchy: &HierarchyTable,
    ) -> Result<usize, PermutationError> {
        let face_count = self.face_ids.len();
        for i in 1..face_count {
            for j in ((i + 1)..=face_count).rev() {
                let Some(first_local) = self.generator.permutation_at(i) else {
                    continue;
                };
                let Some(second_local) = self.generator.permutation_at(j) else {
                    continue;
                };
                let Some(first_face) = first_local
                    .checked_sub(1)
                    .and_then(|index| self.face_ids.get(index))
                    .copied()
                else {
                    continue;
                };
                let Some(second_face) = second_local
                    .checked_sub(1)
                    .and_then(|index| self.face_ids.get(index))
                    .copied()
                else {
                    continue;
                };
                if hierarchy.get(first_face, second_face) == Some(FaceOrder::Below) {
                    self.generator.add_guide(second_local, first_local)?;
                    return Ok(i);
                }
            }
        }
        Ok(1000)
    }

    fn penetration_inconsistent_digits_request(&self, min: usize) -> usize {
        for i in 1..=self.face_ids.len() {
            if i >= min {
                break;
            }
            let Some(local) = self.generator.permutation_at(i) else {
                continue;
            };
            let Some(face_id) = local
                .checked_sub(1)
                .and_then(|index| self.face_ids.get(index))
            else {
                continue;
            };
            let Some(conditions) = self.triple_conditions.get(face_id) else {
                continue;
            };
            for condition in conditions {
                if self.penetration_condition_digit(*condition, i) < min {
                    return i;
                }
            }
        }
        min
    }

    fn penetration_condition_digit(&self, condition: EquivalenceCondition, digit: usize) -> usize {
        let Some(first) = self.face_id_to_permutation_digit(condition.b) else {
            return 1000;
        };
        let Some(second) = self.face_id_to_permutation_digit(condition.d) else {
            return 1000;
        };
        if first < digit && digit < second {
            digit
        } else {
            1000
        }
    }

    fn u_penetration_inconsistent_digits_request(&self, mut min: usize) -> usize {
        for condition in &self.quadruple_conditions {
            min = self.u_penetration_condition_digit(*condition, min);
        }
        min
    }

    fn u_penetration_condition_digit(&self, condition: EquivalenceCondition, min: usize) -> usize {
        let Some(a) = self.face_id_to_permutation_digit(condition.a) else {
            return min;
        };
        let Some(b) = self.face_id_to_permutation_digit(condition.b) else {
            return min;
        };
        let Some(c) = self.face_id_to_permutation_digit(condition.c) else {
            return min;
        };
        let Some(d) = self.face_id_to_permutation_digit(condition.d) else {
            return min;
        };

        if b < min && a < c && c < b && b < d {
            return b;
        }
        if d < min && c < a && a < d && d < b {
            return d;
        }
        min
    }

    fn face_id_to_permutation_digit(&self, face_id: usize) -> Option<usize> {
        let local = self.face_id_map.get(&face_id)?;
        self.generator.locate(*local)
    }
}

enum WorkerSearchStep {
    Consistent(HierarchyTable),
    Inconsistent {
        subface_id: usize,
        table: HierarchyTable,
    },
    RetryWithoutRealtimeAdditionalEstimation,
}

fn inconsistent_subface_request(
    entries: &mut [WorkerSearchEntry],
    order: &[usize],
    valid_count: usize,
    hierarchy: &InitialHierarchy,
    conditions: Option<&EquivalenceConditionSet>,
    mut swapper: Option<&mut SubFaceSwapper>,
    realtime_additional_estimation: &mut bool,
) -> Result<WorkerSearchStep, WorkerOverlapSearchError> {
    crate::fold_profiling::bump_inconsistent_request();
    let mut table = HierarchyTable::from_initial(hierarchy);
    for index in 0..valid_count {
        let Some(entry_index) = order.get(index).copied() else {
            continue;
        };
        if let Some(swapper) = swapper.as_mut() {
            swapper.visit(entry_index);
        }
        let Some(entry) = entries.get_mut(entry_index) else {
            continue;
        };
        if !entry
            .search
            .possible_overlapping_search_with_table(&table)?
        {
            if let Some(swapper) = swapper.as_mut() {
                swapper.record(index + 1);
            }
            if index + 1 > valid_count / 2 || entry.swap_counter > 0 {
                entry.swap_counter = entry.swap_counter.saturating_add(1);
            }
            return Ok(WorkerSearchStep::Inconsistent {
                subface_id: index + 1,
                table,
            });
        }
        entry.swap_counter = 0;
        entry.search.enter_stacking_into(&mut table)?;
        if *realtime_additional_estimation {
            let should_estimate = swapper
                .as_mut()
                .is_none_or(|swapper| swapper.should_estimate(index + 1));
            let success = if should_estimate && (index + 1) <= (valid_count as f64).sqrt() as usize
            {
                run_realtime_additional_estimation(
                    &mut table,
                    entries,
                    order,
                    valid_count,
                    conditions,
                )
            } else if (index + 1) % (3 + (index + 1) * (index + 1) / 6400) == 0 {
                run_fast_realtime_additional_estimation(
                    &mut table,
                    entries,
                    order,
                    valid_count,
                    conditions,
                )
            } else {
                Ok(())
            };
            // A cancel is not a reason to give up on realtime estimation — it is
            // a reason to stop. Tested before the domain handling below, which
            // would otherwise swallow the two per-outer-iteration checkpoints
            // *and* permanently disable the AEA for the rest of the search.
            if let Err(error) = &success
                && error.is_cancelled()
            {
                return Err(WorkerOverlapSearchError::from(*error));
            }
            if success.is_err() {
                *realtime_additional_estimation = false;
                return Ok(WorkerSearchStep::RetryWithoutRealtimeAdditionalEstimation);
            }
        }
    }
    Ok(WorkerSearchStep::Consistent(table))
}

fn advance_subface_permutations(
    entries: &mut [WorkerSearchEntry],
    order: &[usize],
    subface_count: usize,
    active_count: usize,
) -> Result<usize, PermutationError> {
    crate::fold_profiling::bump_perm_advance();
    let active_count = active_count.min(order.len());
    let subface_count = subface_count.min(active_count);
    for entry_index in order.iter().take(active_count).skip(subface_count) {
        entries[*entry_index].search.reset_permutation_generator();
    }

    let mut advanced = 0usize;
    let mut subface_id = subface_count;
    for index in (0..subface_count).rev() {
        let entry_index = order[index];
        let digit_count = entries[entry_index].search.face_ids.len();
        advanced = entries[entry_index].search.next(digit_count)?;
        subface_id = index + 1;
        if advanced != 0 {
            break;
        }
    }
    if advanced == 0 { Ok(0) } else { Ok(subface_id) }
}

/// Oriedita `ChainPermutationGenerator`, including persistent and temporary
/// pair guides plus top/bottom face constraints.
#[derive(Debug, Clone)]
pub struct ChainPermutationGenerator {
    count: usize,
    num_digits: usize,
    digits: Vec<usize>,
    map: Vec<usize>,
    top_indices: Option<HashSet<usize>>,
    bottom_indices: Option<HashSet<usize>>,
    swap_history: Vec<i32>,
    pair_guide: PairGuide,
    init_permutation: Vec<usize>,
    save_history: Vec<Vec<i32>>,
    is_locked: Vec<bool>,
    lock_count: usize,
    lock_remain: usize,
    saved: bool,
    restored: bool,
    looped: bool,
}

impl ChainPermutationGenerator {
    pub fn new(num_digits: usize) -> Self {
        Self {
            count: 0,
            num_digits,
            digits: vec![0; num_digits + 1],
            map: vec![0; num_digits + 1],
            top_indices: None,
            bottom_indices: None,
            swap_history: vec![0; num_digits + 1],
            pair_guide: PairGuide::new(num_digits),
            init_permutation: vec![0; num_digits + 1],
            save_history: vec![vec![0; num_digits + 1]; 3],
            is_locked: vec![false; num_digits + 1],
            lock_count: 0,
            lock_remain: 0,
            saved: false,
            restored: false,
            looped: false,
        }
    }

    pub fn count(&self) -> usize {
        self.count
    }

    pub fn num_digits(&self) -> usize {
        self.num_digits
    }

    pub fn locate(&self, digit: usize) -> Option<usize> {
        self.map.get(digit).copied()
    }

    pub fn permutation_at(&self, digit: usize) -> Option<usize> {
        self.digits.get(digit).copied()
    }

    pub fn current_permutation(&self) -> Vec<usize> {
        if self.num_digits == 0 {
            return Vec::new();
        }
        self.digits[1..=self.num_digits].to_vec()
    }

    pub fn snapshot(&self, changed_digit: usize) -> PermutationSnapshot {
        PermutationSnapshot {
            changed_digit,
            count: self.count,
            permutation: self.current_permutation(),
        }
    }

    pub fn add_guide(
        &mut self,
        upper_face_index: usize,
        face_index: usize,
    ) -> Result<(), PermutationError> {
        self.check_digit(upper_face_index)?;
        self.check_digit(face_index)?;
        self.pair_guide.add(upper_face_index, face_index);
        Ok(())
    }

    pub fn clear_temp_guide(&mut self) {
        self.pair_guide.clear_temp_guide(self.count != 0);
    }

    pub fn set_top_indices<I>(&mut self, top_indices: I) -> Result<(), PermutationError>
    where
        I: IntoIterator<Item = usize>,
    {
        self.top_indices = Self::validated_index_set(top_indices, self.num_digits)?;
        Ok(())
    }

    pub fn set_bottom_indices<I>(&mut self, bottom_indices: I) -> Result<(), PermutationError>
    where
        I: IntoIterator<Item = usize>,
    {
        self.bottom_indices = Self::validated_index_set(bottom_indices, self.num_digits)?;
        Ok(())
    }

    /// Lock the persistent guide graph and reset to the first valid
    /// permutation. This mirrors Oriedita's `initialize()`.
    pub fn initialize(&mut self) {
        self.is_locked.fill(false);
        if let Some(lock) = self.pair_guide.lock() {
            self.lock_count = lock[0];
            for digit in lock.iter().take(self.lock_count + 1).skip(1) {
                if let Some(is_locked) = self.is_locked.get_mut(*digit) {
                    *is_locked = true;
                }
            }

            let mut j = 1usize;
            for i in 1..=self.num_digits.saturating_sub(self.lock_count) {
                while j <= self.num_digits && self.is_locked[j] {
                    j += 1;
                }
                if j <= self.num_digits {
                    self.init_permutation[i] = j;
                    j += 1;
                }
            }
            for (i, digit) in lock.iter().enumerate().take(self.lock_count + 1).skip(1) {
                self.init_permutation[i + self.num_digits - self.lock_count] = *digit;
            }

            if let Some(last_locked) = lock.get(self.lock_count)
                && let Some(is_locked) = self.is_locked.get_mut(*last_locked)
            {
                *is_locked = false;
            }
        } else {
            self.lock_count = 1;
            for i in 1..=self.num_digits {
                self.init_permutation[i] = i;
            }
        }

        self.reset();
    }

    /// Return to the first valid permutation.
    pub fn reset(&mut self) {
        self.count = 0;
        self.lock_remain = self.lock_count;
        for i in 1..=self.num_digits {
            self.digits[i] = self.init_permutation[i];
            self.map[self.digits[i]] = i;
            if self.saved {
                self.save_history[2][i] = self.save_history[1][i];
                self.swap_history[i] = self.save_history[2][i] - 1;
            } else {
                self.swap_history[i] = i as i32 - 1;
            }
        }
        if self.saved {
            self.restored = true;
        }
        self.pair_guide.reset();
        self.next_core(1);
    }

    /// Advance the generator, returning the lowest digit changed. A return
    /// value of 0 means there is no later valid permutation.
    pub fn next(&mut self, digit: usize) -> Result<usize, PermutationError> {
        self.check_digit(digit)?;
        let result = self.next_core(digit);
        if result == 0 {
            let old_count = self.count;
            self.reset();
            self.count = old_count;
            if self.restored {
                self.looped = true;
                self.saved = false;
                self.restored = false;
                return Ok(1);
            }
            return Ok(0);
        }
        if self.looped {
            let mut i = 1usize;
            while i < self.num_digits && self.swap_history[i] == self.save_history[2][i] {
                i += 1;
            }
            if self.swap_history[i] > self.save_history[2][i] {
                self.looped = false;
                return Ok(0);
            }
        } else if self.count >= 600 && self.count.is_multiple_of(200) {
            if self.count == 800 {
                self.saved = true;
            }
            for i in 1..=self.num_digits {
                if self.count >= 800 {
                    self.save_history[1][i] = self.save_history[0][i];
                }
                self.save_history[0][i] = self.swap_history[i];
            }
        }
        Ok(result)
    }

    fn next_core(&mut self, mut digit: usize) -> usize {
        let mut cur_index = 1usize;

        if self.count > 0 {
            cur_index = self.num_digits;
            self.pair_guide.retract(self.digits[cur_index]);

            loop {
                self.swap_history[cur_index] = cur_index as i32 - 1;
                if cur_index == 0 {
                    break;
                }
                cur_index -= 1;
                self.retract(cur_index);
                if cur_index <= digit {
                    break;
                }
            }
        }

        while cur_index < self.num_digits {
            let mut swap_index = self.swap_history[cur_index];
            let mut cur_digit = 0usize;
            let max_index = self.num_digits.saturating_sub(self.lock_remain) + 1;

            loop {
                swap_index += 1;
                if swap_index < 0 || swap_index as usize > max_index {
                    break;
                }
                cur_digit = self.digits[swap_index as usize];
                if !self.pair_guide.is_not_ready(cur_digit)
                    && self.fits_constraint(cur_index, cur_digit)
                {
                    break;
                }
            }

            if swap_index < 0 || swap_index as usize > max_index {
                if self.swap_history[cur_index] == cur_index as i32 - 1
                    && !self.is_constraint_dead_end(cur_index)
                {
                    return 0;
                }

                self.swap_history[cur_index] = cur_index as i32 - 1;
                if cur_index <= 1 {
                    return 0;
                }
                cur_index -= 1;
                self.retract(cur_index);
                if cur_index < digit {
                    digit = cur_index;
                }
                continue;
            }

            let swap_index = swap_index as usize;
            if swap_index != cur_index {
                self.digits[swap_index] = self.digits[cur_index];
                self.digits[cur_index] = cur_digit;
            }
            self.swap_history[cur_index] = swap_index as i32;
            self.map[cur_digit] = cur_index;
            if self.is_locked[cur_digit] {
                self.lock_remain = self.lock_remain.saturating_sub(1);
            }
            self.pair_guide.confirm(cur_digit);

            cur_index += 1;
        }

        if self.num_digits > 0 {
            self.map[self.digits[self.num_digits]] = self.num_digits;
        }
        self.count += 1;
        digit
    }

    fn retract(&mut self, index: usize) {
        let swap_index = self.swap_history[index];
        let cur_digit = self.digits[index];
        if swap_index != index as i32 && swap_index >= 0 {
            let swap_index = swap_index as usize;
            self.digits[index] = self.digits[swap_index];
            self.digits[swap_index] = cur_digit;
        }
        self.map[cur_digit] = 0;
        if self.is_locked[cur_digit] {
            self.lock_remain += 1;
        }
        self.pair_guide.retract(cur_digit);
    }

    fn is_constraint_dead_end(&self, cur_index: usize) -> bool {
        if cur_index == 1
            && self
                .top_indices
                .as_ref()
                .is_some_and(|indices| !indices.is_empty())
        {
            return true;
        }
        cur_index == self.num_digits.saturating_sub(1)
            && self
                .bottom_indices
                .as_ref()
                .is_some_and(|indices| !indices.is_empty())
    }

    fn fits_constraint(&self, cur_index: usize, cur_digit: usize) -> bool {
        if self.num_digits == 0
            || (cur_index != 1 && cur_index != self.num_digits.saturating_sub(1))
        {
            return true;
        }
        if cur_index == 1 {
            self.top_indices
                .as_ref()
                .is_none_or(|indices| indices.contains(&cur_digit))
        } else {
            let other_digit = if cur_digit == self.digits[self.num_digits] {
                self.digits[self.num_digits - 1]
            } else {
                self.digits[self.num_digits]
            };
            self.bottom_indices
                .as_ref()
                .is_none_or(|indices| indices.contains(&other_digit))
        }
    }

    fn check_digit(&self, digit: usize) -> Result<(), PermutationError> {
        if (1..=self.num_digits).contains(&digit) {
            Ok(())
        } else {
            Err(PermutationError::InvalidDigit {
                digit,
                num_digits: self.num_digits,
            })
        }
    }

    fn validated_index_set<I>(
        indices: I,
        num_digits: usize,
    ) -> Result<Option<HashSet<usize>>, PermutationError>
    where
        I: IntoIterator<Item = usize>,
    {
        let mut set = HashSet::new();
        for digit in indices {
            if !(1..=num_digits).contains(&digit) {
                return Err(PermutationError::InvalidDigit { digit, num_digits });
            }
            set.insert(digit);
        }
        Ok((!set.is_empty()).then_some(set))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PairState {
    Empty,
    Unknown,
    Above,
    Below,
}

struct PairStateTable {
    states: HashMap<(usize, usize), PairState>,
}

impl PairStateTable {
    fn from_hierarchy(hierarchy: &InitialHierarchy) -> Self {
        let mut table = Self {
            states: HashMap::new(),
        };
        for relation in &hierarchy.relations {
            table.set(
                pair_key(relation.upper_face, relation.lower_face),
                if relation.upper_face < relation.lower_face {
                    PairState::Above
                } else {
                    PairState::Below
                },
            );
        }
        table
    }

    fn get(&self, pair: (usize, usize)) -> PairState {
        self.states.get(&pair).copied().unwrap_or(PairState::Empty)
    }

    fn set(&mut self, pair: (usize, usize), state: PairState) {
        self.states.insert(pair, state);
    }
}

fn max_priority_subface(
    subfaces: &[SubFace],
    reduced_subface_indices: &[usize],
    new_info_count: &[usize],
    processed: &[bool],
) -> (usize, usize) {
    let mut max_new_info = 0usize;
    let mut found = 0usize;
    for index in 0..new_info_count.len() {
        if processed[index] {
            continue;
        }
        let found_face_count = reduced_subface_indices
            .get(found)
            .and_then(|subface_index| subfaces.get(*subface_index))
            .map(|subface| subface.face_ids.len())
            .unwrap_or(0);
        let face_count = reduced_subface_indices
            .get(index)
            .and_then(|subface_index| subfaces.get(*subface_index))
            .map(|subface| subface.face_ids.len())
            .unwrap_or(0);
        if new_info_count[index] > max_new_info
            || (new_info_count[index] == max_new_info && face_count > found_face_count)
        {
            max_new_info = new_info_count[index];
            found = index;
        }
    }
    (found, max_new_info)
}

fn pair_key(first: usize, second: usize) -> (usize, usize) {
    if first <= second {
        (first, second)
    } else {
        (second, first)
    }
}

fn order_prefix(order: &[usize], high: usize) -> Vec<usize> {
    order.iter().take(high).copied().collect()
}

fn swap_order<SwapOver>(order: &mut [usize], high: usize, low: usize, on_swap_over: &mut SwapOver)
where
    SwapOver: FnMut(usize),
{
    if high == 0 || low == 0 || high > order.len() || low > order.len() || high <= low {
        return;
    }
    let temp = order[high - 1];
    for index in (low..high).rev() {
        order[index] = order[index - 1];
        on_swap_over(order[index]);
    }
    order[low - 1] = temp;
}

#[derive(Debug, Clone)]
struct PairGuide {
    num_digits: usize,
    entries: Vec<usize>,
    guide: Vec<usize>,
    goal: Vec<i16>,
    score: Vec<i16>,
    locked: bool,
    added: bool,
    init_goal: Vec<i16>,
    init_guide: Vec<usize>,
    init_entries: usize,
    is_source: Vec<bool>,
}

impl PairGuide {
    const MASK: usize = (1 << 16) - 1;

    fn new(num_digits: usize) -> Self {
        Self {
            num_digits,
            entries: vec![0],
            guide: vec![0; num_digits + 1],
            goal: vec![0; num_digits + 1],
            score: vec![0; num_digits + 1],
            locked: false,
            added: false,
            init_goal: vec![0; num_digits + 1],
            init_guide: vec![0; num_digits + 1],
            init_entries: 0,
            is_source: vec![false; num_digits + 1],
        }
    }

    fn reset(&mut self) {
        for i in 1..=self.num_digits {
            self.score[i] = 0;
        }
        self.clear_temp_guide(false);
    }

    fn clear_temp_guide(&mut self, match_score: bool) {
        if self.added {
            for i in 1..=self.num_digits {
                self.guide[i] = self.init_guide[i];
                self.goal[i] = self.init_goal[i];
                if match_score {
                    self.score[i] = self.init_goal[i];
                }
            }
            self.entries.truncate(self.init_entries);
            self.added = false;
        }
    }

    fn confirm(&mut self, cur_digit: usize) {
        let mut pos = self.guide[cur_digit];
        while pos != 0 {
            let entry = self.entries[pos];
            self.score[entry & Self::MASK] += 1;
            pos = entry >> 16;
        }
    }

    fn retract(&mut self, cur_digit: usize) {
        let mut pos = self.guide[cur_digit];
        while pos != 0 {
            let entry = self.entries[pos];
            self.score[entry & Self::MASK] -= 1;
            pos = entry >> 16;
        }
    }

    fn lock(&mut self) -> Option<Vec<usize>> {
        self.locked = true;
        self.init_entries = self.entries.len();
        for i in 1..=self.num_digits {
            self.init_goal[i] = self.goal[i];
            self.init_guide[i] = self.guide[i];
        }

        // The memoized longest-path returns exactly what the original Oriedita
        // DFS (`longest_source_path_reference`) does; that equivalence is covered
        // by the unit tests plus the folding oracle tests, rather than a runtime
        // cross-check (which would run the slow reference on every fold).
        self.longest_source_path()
    }

    /// Longest source→sink path in the guide DAG, computed in O(V+E).
    ///
    /// Oriedita's `DFS` re-explores a node every time it is reached at a greater
    /// depth, which is super-linear on deep guide graphs. But a node's best
    /// continuation (`best_child`) and the length below it (`best_len`) depend
    /// only on its subtree, not on the depth it is reached at — so they memoize.
    /// The winner is the lowest-index source achieving the global maximum length,
    /// and each step follows the first child (in guide-list order) that maximizes
    /// the remaining length. This reproduces the reference DFS's exact path (see
    /// `longest_source_path_reference` and the `debug_assert` in `lock`).
    fn longest_source_path(&self) -> Option<Vec<usize>> {
        let n = self.num_digits;
        // best_len[id] == 0 means "not yet computed" (a real length is >= 1).
        let mut best_len = vec![0usize; n + 1];
        let mut best_child = vec![0usize; n + 1];
        // 0 = unvisited, 1 = on the current stack (cycle guard), 2 = done.
        let mut state = vec![0u8; n + 1];
        for id in 1..=n {
            if state[id] == 0 {
                self.compute_best(id, &mut best_len, &mut best_child, &mut state);
            }
        }

        // Lowest-index source achieving the global maximum length (strict `>`
        // keeps the first one). Indexes several parallel arrays by node id.
        let mut winner = 0usize;
        let mut max_len = 0usize;
        #[allow(clippy::needless_range_loop)]
        for id in 1..=n {
            if self.is_source[id] && best_len[id] > max_len {
                max_len = best_len[id];
                winner = id;
            }
        }
        if winner == 0 {
            return None;
        }

        let mut path = vec![0usize; n + 1];
        path[0] = max_len;
        let mut cursor = winner;
        for step in path.iter_mut().take(max_len + 1).skip(1) {
            *step = cursor;
            cursor = best_child[cursor];
        }
        Some(path)
    }

    /// Memoized post-order: `best_len[id] = 1 + max_child_len`, `best_child[id] =`
    /// the first child (guide-list order) achieving that max. Iterates children
    /// in the same order as the reference DFS so ties resolve identically. The
    /// `state` cycle guard is defensive — the guide graph is the acyclic "above"
    /// partial order in practice.
    fn compute_best(
        &self,
        id: usize,
        best_len: &mut [usize],
        best_child: &mut [usize],
        state: &mut [u8],
    ) -> usize {
        if state[id] == 2 {
            return best_len[id];
        }
        if state[id] == 1 {
            // Back-edge (should not happen on a DAG): treat as a non-extending leaf.
            return 0;
        }
        state[id] = 1;
        let mut max_child = 0usize;
        let mut chosen = 0usize;
        let mut pos = self.guide[id];
        while pos != 0 {
            let entry = self.entries[pos];
            let child = entry & Self::MASK;
            let child_len = self.compute_best(child, best_len, best_child, state);
            if child_len > max_child {
                max_child = child_len;
                chosen = child;
            }
            pos = entry >> 16;
        }
        best_len[id] = 1 + max_child;
        best_child[id] = chosen;
        state[id] = 2;
        best_len[id]
    }

    /// The original Oriedita `PairGuide.lock`/`DFS`, kept as the correctness
    /// oracle for [`Self::longest_source_path`]. Uses local scratch so it has no
    /// persistent side effects. Debug-only (drives the `debug_assert` in `lock`).
    #[cfg(test)]
    fn longest_source_path_reference(&self) -> Option<Vec<usize>> {
        let n = self.num_digits;
        let mut path = vec![0usize; n + 1];
        let mut visited = vec![0usize; n + 1];
        let mut result = None;
        let mut max = 0usize;
        for i in 1..=n {
            if self.is_source[i] {
                self.dfs_reference(i, 1, &mut path, &mut visited);
                if path[0] > max {
                    max = path[0];
                    result = Some(path.clone());
                    path.fill(0);
                }
            }
        }
        result
    }

    #[cfg(test)]
    fn dfs_reference(
        &self,
        id: usize,
        depth: usize,
        path: &mut [usize],
        visited: &mut [usize],
    ) -> bool {
        if visited[id] > depth {
            return false;
        }
        visited[id] = depth;

        if self.guide[id] == 0 && depth > path[0] {
            path[0] = depth;
            path[depth] = id;
            return true;
        }

        let mut pos = self.guide[id];
        let mut found = false;
        while pos != 0 {
            let entry = self.entries[pos];
            if self.dfs_reference(entry & Self::MASK, depth + 1, path, visited) {
                found = true;
            }
            pos = entry >> 16;
        }
        if found {
            path[depth] = id;
        }
        found
    }

    fn is_not_ready(&self, cur_digit: usize) -> bool {
        self.score[cur_digit] < self.goal[cur_digit]
    }

    fn add(&mut self, upper_face_index: usize, face_index: usize) {
        let next = self.guide[upper_face_index];
        self.entries.push(face_index | (next << 16));
        self.guide[upper_face_index] = self.entries.len() - 1;
        self.goal[face_index] += 1;

        if self.locked {
            self.added = true;
            self.score[face_index] += 1;
        } else {
            self.is_source[upper_face_index] = true;
            self.is_source[face_index] = false;
        }
    }
}

#[cfg(test)]
mod combination_generator_tests {
    use super::*;

    fn triple(a: usize, b: usize, d: usize) -> EquivalenceCondition {
        EquivalenceCondition { a, b, c: a, d }
    }

    /// The six orderings of the faces `{0, 1, 2}`, each forbidden by one 3EC.
    fn forbidden_orderings() -> Vec<EquivalenceCondition> {
        vec![
            triple(0, 1, 2),
            triple(0, 2, 1),
            triple(1, 2, 0),
            triple(1, 0, 2),
            triple(2, 0, 1),
            triple(2, 1, 0),
        ]
    }

    fn search(
        face_count: usize,
        triples: Vec<EquivalenceCondition>,
    ) -> (bool, SubFacePermutationSearch) {
        let hierarchy = InitialHierarchy {
            faces_total: face_count,
            relations: Vec::new(),
        };
        let conditions = EquivalenceConditionSet {
            triple_conditions: triples,
            quadruple_conditions: Vec::new(),
        };
        let mut search = SubFacePermutationSearch::new((0..face_count).collect());
        search
            .set_guide_map(&hierarchy, Some(&conditions))
            .expect("guide map");
        let found = search
            .possible_overlapping_search(&hierarchy)
            .expect("overlap search");
        (found, search)
    }

    /// The values here were taken from Oriedita itself, via the
    /// `subface-overlap-search-summary` oracle. They pin the accelerator for a
    /// plain `cargo test` with no Java available — without them, the only cover
    /// for this path would be an oracle suite that skips silently.
    ///
    /// Forbidding every ordering of `{0, 1, 2}` leaves the subface unstackable,
    /// so the search runs out of permutations, switches at 2001, and the
    /// accelerator confirms there is nothing to find.
    #[test]
    fn an_unstackable_subface_is_settled_by_the_accelerator() {
        let (found, search) = search(9, forbidden_orderings());
        assert!(!found);
        assert_eq!(search.permutation_count(), 2001);
    }

    /// Leaving one ordering open, the accelerator has to find it and hand it
    /// back to the permutation generator as guides.
    #[test]
    fn the_accelerator_recovers_the_one_surviving_stacking() {
        let mut triples = forbidden_orderings();
        triples.pop();
        let (found, search) = search(9, triples);
        assert!(found);
        assert_eq!(search.permutation_count(), 2002);
        assert_eq!(search.current_ordering(), vec![1, 2, 0, 3, 4, 5, 6, 7, 8]);
    }

    /// Below the switch point nothing changes: the same subface with one fewer
    /// face is settled by the permutation generator alone.
    #[test]
    fn an_easier_subface_never_reaches_the_accelerator() {
        let mut triples = forbidden_orderings();
        triples.pop();
        let (found, search) = search(8, triples);
        assert!(found);
        assert_eq!(search.permutation_count(), 654);
        assert_eq!(search.current_ordering(), vec![1, 2, 0, 3, 4, 5, 6, 7]);
    }
}

#[cfg(test)]
mod pair_guide_tests {
    use super::PairGuide;

    fn guide(num_digits: usize, edges: &[(usize, usize)]) -> PairGuide {
        let mut g = PairGuide::new(num_digits);
        for &(upper, lower) in edges {
            g.add(upper, lower);
        }
        g
    }

    /// The memoized O(V+E) longest-path must return exactly what the original
    /// Oriedita DFS (`longest_source_path_reference`) does — including on graphs
    /// with re-converging paths (where the reference re-explores nodes) and
    /// multiple sources. This replaces the former per-fold runtime cross-check.
    #[test]
    fn memoized_longest_path_matches_reference_dfs() {
        let cases: &[(usize, &[(usize, usize)])] = &[
            (1, &[]),
            (3, &[(1, 2), (2, 3)]),                         // simple chain
            (4, &[(1, 2), (1, 3), (2, 4), (3, 4)]),         // diamond (re-convergence)
            (5, &[(1, 2), (2, 3), (3, 4), (4, 5), (1, 5)]), // long path + shortcut
            (6, &[(1, 2), (1, 3), (2, 4), (3, 4), (4, 5), (4, 6), (5, 6)]),
            (5, &[(1, 3), (2, 3), (3, 4), (3, 5)]), // multiple sources
        ];
        for (num_digits, edges) in cases {
            let g = guide(*num_digits, edges);
            assert_eq!(
                g.longest_source_path(),
                g.longest_source_path_reference(),
                "memoized vs reference mismatch: {num_digits} digits, edges {edges:?}"
            );
        }
    }
}
