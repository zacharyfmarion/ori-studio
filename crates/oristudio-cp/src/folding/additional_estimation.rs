//! Faithful port of Oriedita's incremental additional-estimation subsystem.
//!
//! Oriedita computes the transitive closure of the face "above/below" relation
//! per subface using G. F. Italiano's dynamic transitive-closure algorithm
//! (`origami.folding.algorithm.italiano.ItalianoAlgorithm` and its `Restorable`
//! / `Reactive` subclasses), driven by `AdditionalEstimationAlgorithm`. A newly
//! inferred relation propagates through a change-list in output-sensitive time
//! instead of a full `O(k^3)` rescan.
//!
//! This module ports those pieces to Rust. See
//! `implementation-plans/fold-additional-estimation-italiano-parity.md`.

use std::collections::VecDeque;

/// Incremental transitive closure over `1..=size` nodes (1-based, matching the
/// Java source). `reaches(i, j)` is true once `i > j` has been established, and
/// [`ItalianoClosure::add`] maintains the closure as edges are inserted.
///
/// Port of `ItalianoAlgorithm` + `RestorableItalianoAlgorithm` +
/// `ReactiveItalianoAlgorithm`. The reactive change-list is folded in directly:
/// [`ItalianoClosure::add`] appends every newly created reachability entry to an
/// internal buffer drained by [`ItalianoClosure::drain_changes`].
pub struct ItalianoClosure {
    size: usize,
    stride: usize,
    /// `matrix[i * stride + j]` is the spanning-tree node of `j` in `i`'s tree;
    /// non-zero implies `i > j`. `matrix[i][i]` is the tree root (`EMPTY_NODE`).
    ///
    /// A cell packs `firstChild << 17 | EMPTY_NODE | nextSibling` (both indices
    /// are 15-bit; a subface is assumed to stack < 32767 faces, matching the
    /// upstream comment).
    matrix: Vec<u32>,
    // `backup`/`save`/`restore` mirror `RestorableItalianoAlgorithm`; they are for
    // the pending persistent-AEA search integration (Stage B in the plan) and are
    // currently exercised only by unit tests.
    #[allow(dead_code)]
    backup: Vec<u32>,
    /// Newly created reachability entries, each encoded `(x << 16) | v` meaning
    /// node `x` now reaches node `v`. Mirrors `ReactiveItalianoAlgorithm`.
    changes: Vec<u32>,
    stack: VecDeque<u64>,
}

const MASK: u32 = (1 << 16) - 1;
const EMPTY_NODE: u32 = 1 << 16;
const NODE_MASK: u32 = (1 << 17) - 1;

/// Low 16 bits of a change entry (`ItalianoAlgorithm.mask`).
pub const CHANGE_MASK: u32 = MASK;

// A few methods (`reaches`, `drain_changes`, `clear_changes`, `save`, `restore`)
// faithfully mirror the upstream Restorable/Reactive API and are currently used
// only by unit tests or reserved for the Stage-B persistent-AEA search path.
#[allow(dead_code)]
impl ItalianoClosure {
    pub fn new(size: usize) -> Self {
        let stride = size + 1;
        let mut matrix = vec![0u32; stride * stride];
        for i in 1..=size {
            matrix[i * stride + i] = EMPTY_NODE;
        }
        Self {
            size,
            stride,
            matrix,
            backup: Vec::new(),
            changes: Vec::new(),
            stack: VecDeque::new(),
        }
    }

    #[inline]
    fn cell(&self, i: usize, j: usize) -> u32 {
        self.matrix[i * self.stride + j]
    }

    #[inline]
    fn set_cell(&mut self, i: usize, j: usize, value: u32) {
        self.matrix[i * self.stride + j] = value;
    }

    /// True if `i > j` is currently in the closure.
    #[inline]
    pub fn reaches(&self, i: usize, j: usize) -> bool {
        self.cell(i, j) != 0
    }

    /// Try to add `i > j`. Returns `false` (making no change) if `j > i` already
    /// holds, which the caller treats as a contradiction. Port of `tryAdd`.
    pub fn try_add(&mut self, i: usize, j: usize) -> bool {
        if self.cell(j, i) != 0 {
            return false;
        }
        self.add(i, j);
        true
    }

    /// Insert edge `i > j` and propagate the closure. Port of `add`.
    pub fn add(&mut self, i: usize, j: usize) {
        if self.cell(i, j) != 0 {
            return;
        }
        for x in 1..=self.size {
            if self.cell(x, i) != 0 && self.cell(x, j) == 0 {
                self.stack_meld(x, j, i, j);
            }
        }
        while let Some(r) = self.stack.pop_front() {
            let x = (r >> 48) as usize;
            let jj = ((r >> 32) & MASK as u64) as usize;
            let u = ((r >> 16) & MASK as u64) as usize;
            let v = (r & MASK as u64) as usize;
            self.meld(x, jj, u, v);
        }
    }

    /// Port of `ReactiveItalianoAlgorithm.meld` (records the change) composed
    /// with the base `ItalianoAlgorithm.meld`.
    fn meld(&mut self, x: usize, j: usize, u: usize, v: usize) {
        // Reactive: record that x now reaches v.
        self.changes.push(((x as u32) << 16) | v as u32);

        // create new node: v as a child slot under x, sibling = u's old first child
        let x_u = self.cell(x, u);
        self.set_cell(x, v, EMPTY_NODE | (x_u >> 17));
        // add node as child of matrix[x][u]
        self.set_cell(x, u, (x_u & NODE_MASK) | ((v as u32) << 17));

        // copy subtree of v from j's tree
        let mut w = (self.cell(j, v) >> 17) as usize;
        while w != 0 {
            if self.cell(x, w) == 0 {
                self.stack_meld(x, j, v, w);
            }
            w = (self.cell(j, w) & MASK) as usize;
        }
    }

    #[inline]
    fn stack_meld(&mut self, x: usize, j: usize, u: usize, v: usize) {
        self.stack
            .push_back(((x as u64) << 48) | ((j as u64) << 32) | ((u as u64) << 16) | v as u64);
    }

    /// Drain the reactive change-list, invoking `f(x, v)` for each newly created
    /// reachability `x > v` (node indices, 1-based within this closure).
    pub fn drain_changes(&mut self, mut f: impl FnMut(usize, usize)) {
        for entry in self.changes.drain(..) {
            f((entry >> 16) as usize, (entry & MASK) as usize);
        }
    }

    /// Discard any buffered changes without acting on them.
    pub fn clear_changes(&mut self) {
        self.changes.clear();
    }

    /// Take ownership of the buffered changes, leaving the buffer empty. Used by
    /// the AEA so it can promote transitive changes into the hierarchy without
    /// holding a borrow on this closure while it mutates sibling closures.
    pub fn take_changes(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.changes)
    }

    /// Port of `RestorableItalianoAlgorithm.save`.
    pub fn save(&mut self) {
        self.backup.clear();
        self.backup.extend_from_slice(&self.matrix);
    }

    /// Port of `RestorableItalianoAlgorithm.restore`.
    pub fn restore(&mut self) {
        if self.backup.len() == self.matrix.len() {
            self.matrix.copy_from_slice(&self.backup);
        }
    }
}

use super::{AdditionalEstimationError, EquivalenceCondition, FaceOrder, HierarchyTable};
use std::collections::{BTreeSet, HashMap};

/// Cap on relations inferred in a single inner pass before deferring the rest to
/// the next `do/while` iteration. Port of `AEA.MAX_NEW_RELATIONS` (a memory
/// guard; correctness is unaffected since the outer loop continues).
const MAX_NEW_RELATIONS: usize = 100_000;

/// Port of `PseudoListMatrix` used for `relationObservers`: for a pair `(i, j)`
/// with `i < j`, returns the subfaces that contain both faces `i` and `j` and
/// had an undetermined relation at initialization. Stored as `O(n)` per-face
/// sets; a query intersects `map_i[i]` with `map_j[j]`.
#[derive(Default)]
struct RelationObservers {
    map_i: HashMap<usize, BTreeSet<usize>>,
    map_j: HashMap<usize, BTreeSet<usize>>,
}

impl RelationObservers {
    fn add(&mut self, i: usize, j: usize, subface: usize) {
        self.map_i.entry(i).or_default().insert(subface);
        self.map_j.entry(j).or_default().insert(subface);
    }

    fn get(&self, i: usize, j: usize) -> Vec<usize> {
        match (self.map_i.get(&i), self.map_j.get(&j)) {
            (Some(si), Some(sj)) => si.intersection(sj).copied().collect(),
            _ => Vec::new(),
        }
    }
}

/// Rust port of `origami.folding.algorithm.AdditionalEstimationAlgorithm`.
///
/// Maintains a per-subface [`ItalianoClosure`] and infers all forced stacking
/// relations from the initial hierarchy, the triple ("3EC") penetration
/// conditions, and the quadruple ("4EC") conditions. Subfaces are 1-based
/// (index 0 unused) to match the upstream source.
pub(super) struct AdditionalEstimation {
    /// `subface_faces[s][i - 1]` is the global face id of local index `i`.
    subface_faces: Vec<Vec<usize>>,
    /// `subface_index[s][&global]` is the 1-based local index of a global face.
    subface_index: Vec<HashMap<usize, usize>>,
    /// Valid subface indices are `1..count`.
    count: usize,
    ia: Vec<Option<ItalianoClosure>>,
    observers: RelationObservers,
    new_relations: usize,
    remove_mode: bool,
    /// Subface index at which the last contradiction occurred (for the search's
    /// "promote subface to valid set" recovery). Mirrors `AEA.errorIndex`.
    pub error_index: usize,
}

impl AdditionalEstimation {
    /// Build from the reduced subfaces' global face-id lists (0-based input).
    pub fn new(reduced_subface_face_ids: Vec<Vec<usize>>) -> Self {
        let n = reduced_subface_face_ids.len();
        let count = n + 1;
        let mut subface_faces = Vec::with_capacity(count);
        let mut subface_index = Vec::with_capacity(count);
        // index 0 is unused (1-based subfaces)
        subface_faces.push(Vec::new());
        subface_index.push(HashMap::new());
        for faces in reduced_subface_face_ids {
            let mut map = HashMap::with_capacity(faces.len());
            for (local0, &global) in faces.iter().enumerate() {
                map.insert(global, local0 + 1);
            }
            subface_faces.push(faces);
            subface_index.push(map);
        }
        let ia = (0..count).map(|_| None).collect();
        Self {
            subface_faces,
            subface_index,
            count,
            ia,
            observers: RelationObservers::default(),
            new_relations: 0,
            remove_mode: false,
            error_index: 0,
        }
    }

    #[inline]
    fn face_id(&self, subface: usize, local: usize) -> usize {
        self.subface_faces[subface][local - 1]
    }

    /// Port of `initializeItalianoAlgorithm`: seed subface `s`'s closure with the
    /// currently-known `ABOVE` relations and register observers for the pairs
    /// still undetermined.
    fn initialize_italiano(&mut self, s: usize, table: &HierarchyTable) {
        let k = self.subface_faces[s].len();
        let mut ia = ItalianoClosure::new(k);
        for i in 1..=k {
            for j in 1..=k {
                let gi = self.face_id(s, i);
                let gj = self.face_id(s, j);
                if gi < gj && table.is_empty(gi, gj) {
                    self.observers.add(gi, gj, s);
                } else if table.get(gi, gj) == Some(FaceOrder::Above) {
                    ia.add(i, j);
                }
            }
        }
        self.ia[s] = Some(ia);
    }

    /// Port of `inferAbove`: record `i > j` and notify observing subfaces so
    /// their closures propagate. Returns whether a new relation was recorded.
    fn infer_above(
        &mut self,
        table: &mut HierarchyTable,
        i: usize,
        j: usize,
    ) -> Result<bool, AdditionalEstimationError> {
        if !table.is_empty(i, j) {
            return Ok(false);
        }
        table.set_above(i, j);
        let (lo, hi) = if i < j { (i, j) } else { (j, i) };
        for s in self.observers.get(lo, hi) {
            let li = self.subface_index[s][&i];
            let lj = self.subface_index[s][&j];
            if let Some(ia) = self.ia[s].as_mut()
                && !ia.try_add(li, lj)
            {
                return Err(AdditionalEstimationError::Contradiction {
                    upper_face: i,
                    lower_face: j,
                });
            }
        }
        Ok(true)
    }

    /// Port of `tryInferAbove`: fail if `j > i` already holds, else infer `i > j`.
    fn try_infer_above(
        &mut self,
        table: &mut HierarchyTable,
        i: usize,
        j: usize,
    ) -> Result<usize, AdditionalEstimationError> {
        if table.get(i, j) == Some(FaceOrder::Below) {
            return Err(AdditionalEstimationError::Contradiction {
                upper_face: i,
                lower_face: j,
            });
        }
        Ok(usize::from(self.infer_above(table, i, j)?))
    }

    /// Port of `checkTransitivity`: drain subface `s`'s change-list, promoting
    /// each newly reachable pair into the global hierarchy.
    fn check_transitivity(
        &mut self,
        table: &mut HierarchyTable,
        s: usize,
    ) -> Result<usize, AdditionalEstimationError> {
        let changes = self.ia[s]
            .as_mut()
            .map(|ia| ia.take_changes())
            .unwrap_or_default();
        let mut count = 0;
        for entry in changes {
            let x = (entry >> 16) as usize;
            let v = (entry & CHANGE_MASK) as usize;
            let gx = self.face_id(s, x);
            let gv = self.face_id(s, v);
            count += self.try_infer_above(table, gx, gv)?;
        }
        Ok(count)
    }

    /// Port of `checkTripleConstraint`. Returns `(new_relations, fired)`.
    fn check_triple(
        &mut self,
        table: &mut HierarchyTable,
        ec: EquivalenceCondition,
    ) -> Result<(usize, bool), AdditionalEstimationError> {
        let (a, b, d) = (ec.a, ec.b, ec.d);
        let mut changes = 0;
        let mut fired = false;
        if table.get(a, b) == Some(FaceOrder::Above) {
            fired = true;
            changes += self.try_infer_above(table, a, d)?;
        } else if table.get(a, b) == Some(FaceOrder::Below) {
            fired = true;
            changes += self.try_infer_above(table, d, a)?;
        } else if table.get(a, d) == Some(FaceOrder::Above) {
            fired = true;
            changes += self.try_infer_above(table, a, b)?;
        } else if table.get(a, d) == Some(FaceOrder::Below) {
            fired = true;
            changes += self.try_infer_above(table, b, a)?;
        }
        Ok((changes, fired))
    }

    /// Port of `checkQuadrupleConstraint`. Returns `(new_relations, fired)`.
    fn check_quad(
        &mut self,
        table: &mut HierarchyTable,
        ec: EquivalenceCondition,
    ) -> Result<(usize, bool), AdditionalEstimationError> {
        let (a, b, c, d) = (ec.a, ec.b, ec.c, ec.d);
        let mut changes = 0;
        let mut fired = false;
        let above = Some(FaceOrder::Above);
        let below = Some(FaceOrder::Below);

        if table.get(a, c) == above && table.get(b, d) == above {
            fired = true;
            changes += self.try_infer_above(table, a, d)? + self.try_infer_above(table, b, c)?;
        }
        if table.get(a, d) == above && table.get(b, c) == above {
            fired = true;
            changes += self.try_infer_above(table, a, c)? + self.try_infer_above(table, b, d)?;
        }
        if table.get(a, c) == below && table.get(b, d) == below {
            fired = true;
            changes += self.try_infer_above(table, d, a)? + self.try_infer_above(table, c, b)?;
        }
        if table.get(a, d) == below && table.get(b, c) == below {
            fired = true;
            changes += self.try_infer_above(table, c, a)? + self.try_infer_above(table, d, b)?;
        }
        if table.get(a, c) == above && table.get(c, b) == above {
            fired = true;
            changes += self.try_infer_above(table, a, d)? + self.try_infer_above(table, d, b)?;
        }
        if table.get(a, d) == above && table.get(d, b) == above {
            fired = true;
            changes += self.try_infer_above(table, a, c)? + self.try_infer_above(table, c, b)?;
        }
        if table.get(c, a) == above && table.get(a, d) == above {
            fired = true;
            changes += self.try_infer_above(table, c, b)? + self.try_infer_above(table, b, d)?;
        }
        if table.get(c, b) == above && table.get(b, d) == above {
            fired = true;
            changes += self.try_infer_above(table, c, a)? + self.try_infer_above(table, a, d)?;
        }
        Ok((changes, fired))
    }

    /// Run subface-transitivity for `completed+1..count`, initializing closures
    /// lazily. Shared by [`Self::run`] and [`Self::run_with_removal`].
    fn run_transitivity(
        &mut self,
        table: &mut HierarchyTable,
        completed: usize,
    ) -> Result<(), AdditionalEstimationError> {
        let mut s = completed + 1;
        while s < self.count && self.new_relations < MAX_NEW_RELATIONS {
            if self.ia[s].is_none() {
                self.initialize_italiano(s, table);
            }
            match self.check_transitivity(table, s) {
                Ok(changes) => self.new_relations += changes,
                Err(err) => {
                    self.error_index = s;
                    return Err(err);
                }
            }
            s += 1;
        }
        Ok(())
    }

    /// Port of `run` with `removeMode == false`: infer to a fixpoint over the
    /// (immutable) equivalence conditions. The final hierarchy is identical to a
    /// from-scratch closure, just computed incrementally.
    pub fn run(
        &mut self,
        table: &mut HierarchyTable,
        triple: &[EquivalenceCondition],
        quadruple: &[EquivalenceCondition],
        completed: usize,
    ) -> Result<(), AdditionalEstimationError> {
        loop {
            self.new_relations = 0;
            self.run_transitivity(table, completed)?;
            for &ec in triple {
                if self.new_relations >= MAX_NEW_RELATIONS {
                    break;
                }
                let (changes, _) = self.check_triple(table, ec)?;
                self.new_relations += changes;
            }
            for &ec in quadruple {
                if self.new_relations >= MAX_NEW_RELATIONS {
                    break;
                }
                let (changes, _) = self.check_quad(table, ec)?;
                self.new_relations += changes;
            }
            if self.new_relations == 0 {
                return Ok(());
            }
        }
    }

    /// Port of `run` with `removeMode == true`: same fixpoint, but every
    /// equivalence condition that fires is removed once satisfied, shrinking the
    /// sets for the search stage. The removed conditions are redundant (already
    /// implied by the closed hierarchy) so the folded result is unchanged.
    pub fn run_with_removal(
        &mut self,
        table: &mut HierarchyTable,
        triple: &mut Vec<EquivalenceCondition>,
        quadruple: &mut Vec<EquivalenceCondition>,
        completed: usize,
    ) -> Result<(), AdditionalEstimationError> {
        self.remove_mode = true;
        loop {
            self.new_relations = 0;
            self.run_transitivity(table, completed)?;
            retain_checked(triple, |ec| {
                if self.new_relations >= MAX_NEW_RELATIONS {
                    return Ok::<RetainOutcome, AdditionalEstimationError>(RetainOutcome::KeepUnprocessed);
                }
                let (changes, fired) = self.check_triple(table, *ec)?;
                self.new_relations += changes;
                Ok(if fired {
                    RetainOutcome::Remove
                } else {
                    RetainOutcome::Keep
                })
            })?;
            retain_checked(quadruple, |ec| {
                if self.new_relations >= MAX_NEW_RELATIONS {
                    return Ok::<RetainOutcome, AdditionalEstimationError>(RetainOutcome::KeepUnprocessed);
                }
                let (changes, fired) = self.check_quad(table, *ec)?;
                self.new_relations += changes;
                Ok(if fired {
                    RetainOutcome::Remove
                } else {
                    RetainOutcome::Keep
                })
            })?;
            if self.new_relations == 0 {
                return Ok(());
            }
        }
    }

    /// Port of `fastRun`: one transitivity flush + a single equivalence-condition
    /// pass (no fixpoint loop, no removal). Used by the realtime search path.
    pub fn fast_run(
        &mut self,
        table: &mut HierarchyTable,
        triple: &[EquivalenceCondition],
        quadruple: &[EquivalenceCondition],
    ) -> Result<(), AdditionalEstimationError> {
        self.new_relations = 0;
        for s in 1..self.count {
            if self.ia[s].is_none() {
                self.initialize_italiano(s, table);
            }
            self.new_relations += self.check_transitivity(table, s)?;
        }
        for &ec in triple {
            self.check_triple(table, ec)?;
        }
        for &ec in quadruple {
            self.check_quad(table, ec)?;
        }
        Ok(())
    }
}

/// Outcome for a single item in [`retain_checked`].
enum RetainOutcome {
    Keep,
    Remove,
    /// Stop processing; keep this and every remaining item as-is.
    KeepUnprocessed,
}

/// In-place retain that can fail and can stop early keeping the tail. Mirrors
/// the Java iterator's `it.remove()` with the `MAX_NEW_RELATIONS` early exit.
fn retain_checked<T: Copy, E>(
    items: &mut Vec<T>,
    mut decide: impl FnMut(&T) -> Result<RetainOutcome, E>,
) -> Result<(), E> {
    let mut write = 0;
    let mut read = 0;
    while read < items.len() {
        match decide(&items[read])? {
            RetainOutcome::Keep => {
                items[write] = items[read];
                write += 1;
                read += 1;
            }
            RetainOutcome::Remove => {
                read += 1;
            }
            RetainOutcome::KeepUnprocessed => break,
        }
    }
    while read < items.len() {
        items[write] = items[read];
        write += 1;
        read += 1;
    }
    items.truncate(write);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_edges_are_reachable() {
        let mut ia = ItalianoClosure::new(3);
        ia.add(1, 2);
        assert!(ia.reaches(1, 2));
        assert!(!ia.reaches(2, 1));
        assert!(!ia.reaches(1, 3));
    }

    #[test]
    fn transitivity_is_inferred_incrementally() {
        let mut ia = ItalianoClosure::new(4);
        ia.clear_changes();
        ia.add(1, 2);
        ia.add(2, 3);
        // 1 > 2 and 2 > 3 implies 1 > 3.
        assert!(ia.reaches(1, 3), "expected 1 > 3 by transitivity");
        ia.add(3, 4);
        assert!(ia.reaches(1, 4));
        assert!(ia.reaches(2, 4));
    }

    #[test]
    fn changes_report_new_reachabilities() {
        let mut ia = ItalianoClosure::new(3);
        ia.add(1, 2);
        ia.clear_changes();
        // Adding 2 > 3 should surface the transitive 1 > 3 as a change.
        ia.add(2, 3);
        let mut reported = Vec::new();
        ia.drain_changes(|x, v| reported.push((x, v)));
        assert!(
            reported.contains(&(1, 3)),
            "transitive 1>3 should be reported, got {reported:?}"
        );
    }

    #[test]
    fn try_add_detects_cycles() {
        let mut ia = ItalianoClosure::new(3);
        ia.add(1, 2);
        ia.add(2, 3);
        // 3 > 1 would contradict the existing 1 > 3.
        assert!(!ia.try_add(3, 1));
        // A consistent edge still succeeds.
        assert!(ia.try_add(1, 3) || ia.reaches(1, 3));
    }

    #[test]
    fn save_and_restore_round_trips() {
        let mut ia = ItalianoClosure::new(4);
        ia.add(1, 2);
        ia.save();
        ia.add(2, 3);
        assert!(ia.reaches(1, 3));
        ia.restore();
        assert!(ia.reaches(1, 2));
        assert!(!ia.reaches(2, 3), "restore should drop post-save edges");
        assert!(!ia.reaches(1, 3));
    }
}
