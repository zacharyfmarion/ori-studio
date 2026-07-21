//! Opt-in, low-overhead counters for diagnosing fold-estimation performance.
//!
//! Everything here compiles to no-ops unless the `fold-profiling` feature is
//! enabled, so production builds pay nothing. Counters are deliberately
//! *coarse* — incremented once per search node / table rebuild, never inside
//! the innermost per-face-pair lookups — so enabling the feature does not
//! meaningfully perturb the relative timing we are trying to measure.

/// Snapshot of the fold-estimation counters. Fields are always present (they
/// read back zero when the feature is disabled) so callers compile regardless.
#[derive(Debug, Clone, Copy, Default)]
pub struct FoldProfilingSnapshot {
    /// Iterations of the outer `while changed_subface != 0` search loop.
    pub outer_iters: u64,
    /// Calls to `inconsistent_subface_request` (one per outer iteration).
    pub inconsistent_requests: u64,
    /// Times the whole hierarchy table was rebuilt via `HierarchyTable::from_initial`.
    pub table_from_initial: u64,
    /// Calls to `advance_subface_permutations` (the backtracking odometer).
    pub perm_advances: u64,
    /// Calls to the full realtime additional-estimation pass.
    pub realtime_estimations: u64,
    /// Calls to the cheaper "fast" realtime additional-estimation pass.
    pub fast_realtime_estimations: u64,
    /// Faces in the crease pattern (recorded once per search).
    pub faces_total: u64,
    /// Subfaces considered (recorded once per search).
    pub subface_total: u64,
    /// Subfaces the search actually permutes (`valid_count`).
    pub valid_count: u64,
    /// Initial hierarchy relations re-inserted on every `from_initial` rebuild.
    pub initial_relations: u64,
    /// Internal fixpoint passes across all `run_additional_estimation` calls.
    pub additional_estimation_passes: u64,
    /// Triple equivalence conditions scanned per additional-estimation pass.
    pub triple_conditions: u64,
    /// Quadruple equivalence conditions scanned per additional-estimation pass.
    pub quadruple_conditions: u64,
    /// Largest face count among the reduced subfaces (drives the `k^3` transitivity loop).
    pub max_subface_faces: u64,
}

impl core::fmt::Display for FoldProfilingSnapshot {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(
            f,
            "faces={} subfaces={} valid={} initial_relations={} max_subface_faces={} | outer_iters={} inconsistent_requests={} table_from_initial={} perm_advances={} realtime={} fast_realtime={} | add_est_passes={} triple_cond={} quad_cond={}",
            self.faces_total,
            self.subface_total,
            self.valid_count,
            self.initial_relations,
            self.max_subface_faces,
            self.outer_iters,
            self.inconsistent_requests,
            self.table_from_initial,
            self.perm_advances,
            self.realtime_estimations,
            self.fast_realtime_estimations,
            self.additional_estimation_passes,
            self.triple_conditions,
            self.quadruple_conditions,
        )
    }
}

#[cfg(feature = "fold-profiling")]
mod imp {
    use super::FoldProfilingSnapshot;
    use std::cell::Cell;

    #[derive(Default)]
    struct Counters {
        outer_iters: Cell<u64>,
        inconsistent_requests: Cell<u64>,
        table_from_initial: Cell<u64>,
        perm_advances: Cell<u64>,
        realtime_estimations: Cell<u64>,
        fast_realtime_estimations: Cell<u64>,
        faces_total: Cell<u64>,
        subface_total: Cell<u64>,
        valid_count: Cell<u64>,
        initial_relations: Cell<u64>,
        additional_estimation_passes: Cell<u64>,
        triple_conditions: Cell<u64>,
        quadruple_conditions: Cell<u64>,
        max_subface_faces: Cell<u64>,
    }

    thread_local! {
        static COUNTERS: Counters = Counters::default();
    }

    #[inline]
    fn bump(pick: impl Fn(&Counters) -> &Cell<u64>) {
        COUNTERS.with(|c| {
            let cell = pick(c);
            cell.set(cell.get().saturating_add(1));
        });
    }

    #[inline]
    fn set_max(pick: impl Fn(&Counters) -> &Cell<u64>, value: u64) {
        COUNTERS.with(|c| {
            let cell = pick(c);
            if value > cell.get() {
                cell.set(value);
            }
        });
    }

    pub fn reset() {
        COUNTERS.with(|c| {
            c.outer_iters.set(0);
            c.inconsistent_requests.set(0);
            c.table_from_initial.set(0);
            c.perm_advances.set(0);
            c.realtime_estimations.set(0);
            c.fast_realtime_estimations.set(0);
            c.faces_total.set(0);
            c.subface_total.set(0);
            c.valid_count.set(0);
            c.initial_relations.set(0);
            c.additional_estimation_passes.set(0);
            c.triple_conditions.set(0);
            c.quadruple_conditions.set(0);
            c.max_subface_faces.set(0);
        });
    }

    pub fn bump_outer_iter() {
        bump(|c| &c.outer_iters);
    }
    pub fn bump_inconsistent_request() {
        bump(|c| &c.inconsistent_requests);
    }
    pub fn bump_table_from_initial() {
        bump(|c| &c.table_from_initial);
    }
    pub fn bump_perm_advance() {
        bump(|c| &c.perm_advances);
    }
    pub fn bump_realtime_estimation() {
        bump(|c| &c.realtime_estimations);
    }
    pub fn bump_fast_realtime_estimation() {
        bump(|c| &c.fast_realtime_estimations);
    }
    pub fn bump_additional_estimation_pass() {
        bump(|c| &c.additional_estimation_passes);
    }

    pub fn record_sizes(faces: u64, subfaces: u64, valid: u64, initial_relations: u64) {
        set_max(|c| &c.faces_total, faces);
        set_max(|c| &c.subface_total, subfaces);
        set_max(|c| &c.valid_count, valid);
        set_max(|c| &c.initial_relations, initial_relations);
    }

    pub fn record_estimation_inputs(triple: u64, quadruple: u64, max_subface_faces: u64) {
        set_max(|c| &c.triple_conditions, triple);
        set_max(|c| &c.quadruple_conditions, quadruple);
        set_max(|c| &c.max_subface_faces, max_subface_faces);
    }

    pub fn snapshot() -> FoldProfilingSnapshot {
        COUNTERS.with(|c| FoldProfilingSnapshot {
            outer_iters: c.outer_iters.get(),
            inconsistent_requests: c.inconsistent_requests.get(),
            table_from_initial: c.table_from_initial.get(),
            perm_advances: c.perm_advances.get(),
            realtime_estimations: c.realtime_estimations.get(),
            fast_realtime_estimations: c.fast_realtime_estimations.get(),
            faces_total: c.faces_total.get(),
            subface_total: c.subface_total.get(),
            valid_count: c.valid_count.get(),
            initial_relations: c.initial_relations.get(),
            additional_estimation_passes: c.additional_estimation_passes.get(),
            triple_conditions: c.triple_conditions.get(),
            quadruple_conditions: c.quadruple_conditions.get(),
            max_subface_faces: c.max_subface_faces.get(),
        })
    }
}

// No-op fallbacks so instrumented call sites compile with zero cost when the
// feature is disabled.
#[cfg(not(feature = "fold-profiling"))]
mod imp {
    use super::FoldProfilingSnapshot;

    #[inline(always)]
    pub fn reset() {}
    #[inline(always)]
    pub fn bump_outer_iter() {}
    #[inline(always)]
    pub fn bump_inconsistent_request() {}
    #[inline(always)]
    pub fn bump_table_from_initial() {}
    #[inline(always)]
    pub fn bump_perm_advance() {}
    #[inline(always)]
    pub fn bump_realtime_estimation() {}
    #[inline(always)]
    pub fn bump_fast_realtime_estimation() {}
    #[inline(always)]
    pub fn bump_additional_estimation_pass() {}
    #[inline(always)]
    pub fn record_sizes(_faces: u64, _subfaces: u64, _valid: u64, _initial_relations: u64) {}
    #[inline(always)]
    pub fn record_estimation_inputs(_triple: u64, _quadruple: u64, _max_subface_faces: u64) {}
    #[inline(always)]
    pub fn snapshot() -> FoldProfilingSnapshot {
        FoldProfilingSnapshot::default()
    }
}

pub use imp::{
    bump_additional_estimation_pass, bump_fast_realtime_estimation, bump_inconsistent_request,
    bump_outer_iter, bump_perm_advance, bump_realtime_estimation, bump_table_from_initial,
    record_estimation_inputs, record_sizes, reset, snapshot,
};
