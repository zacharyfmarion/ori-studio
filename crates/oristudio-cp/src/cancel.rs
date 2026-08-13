//! Cooperative cancellation for the fold.
//!
//! A fold is one long synchronous call. On web it occupies the CP worker's only
//! thread, on desktop a `spawn_blocking` thread holding the session mutex, so
//! nothing can interrupt it from outside — Rust has no way to stop a thread, and
//! a queued message is not read until the call it is meant to stop has returned.
//! The only mechanism that works is the one Oriedita uses: the running code asks,
//! periodically, whether it should stop.
//!
//! Upstream asks with `Thread.interrupted()`, which **consumes** the flag. That
//! is a defect there: `FoldedFigure_Worker.java:216` calls `SubFace.setGuideMap`
//! on the search thread, and `SubFace.java:389/429/439/445` merely `return` on
//! the interrupt — so a cancel landing inside the guide map is swallowed, the map
//! is left half-built, and the search carries on believing it is complete. This
//! module exposes only [`check`], never a taking variant, so that failure mode is
//! unrepresentable here.

use std::cell::{Cell, RefCell};
use std::num::NonZeroU32;
use std::sync::Arc;

/// Where a checkpoint reads "which run has the user asked to stop".
///
/// Implemented once per transport: a `SharedArrayBuffer` slot on web, an
/// `AtomicU32` on desktop, a constant in tests. `0` means "no run".
///
/// The `Send + Sync` bound is conditional because only the native rayon bridge
/// ([`crate::folding`]'s `flat_map_conditions`) moves a source across threads.
/// Requiring it unconditionally would force `unsafe impl`s in the wasm bridge to
/// satisfy a bound nothing on that target uses.
#[cfg(all(feature = "parallel", not(target_arch = "wasm32")))]
pub trait CancelSource: Send + Sync {
    fn cancelled_run(&self) -> u32;
}

/// Same trait without the thread bounds. See the `parallel` variant above.
#[cfg(not(all(feature = "parallel", not(target_arch = "wasm32"))))]
pub trait CancelSource {
    fn cancelled_run(&self) -> u32;
}

/// The fold was stopped by the user.
///
/// Deliberately its own type rather than a variant of an existing error: a
/// cancel is not an algorithmic outcome, and the whole hazard this module guards
/// against is it being conflated with one. See the `Cancelled` arms on the fold
/// error enums, and `is_cancelled` on each.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cancelled;

impl std::fmt::Display for Cancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "the fold was cancelled")
    }
}

impl std::error::Error for Cancelled {}

/// Identifies one cancellable fold.
///
/// Non-zero by construction, so there is no "default" run and no `Default` impl
/// to forget — an unbound or zero-initialised id would otherwise be *cancelled
/// from birth* under the exact-match rule in [`check`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunId(NonZeroU32);

impl RunId {
    /// Work the user cannot address: the 3D rehydrate on project load, the
    /// export-dialog fold. Bridges never issue it, so it can never match a
    /// cancel request and such a fold simply runs to completion.
    pub const BACKGROUND: RunId = RunId(NonZeroU32::MAX);

    pub fn new(value: u32) -> Option<Self> {
        NonZeroU32::new(value).map(Self)
    }

    pub fn get(self) -> u32 {
        self.0.get()
    }
}

/// A source plus the run it is being read on behalf of.
#[derive(Clone)]
pub struct CancelHandle {
    source: Arc<dyn CancelSource>,
    run_id: RunId,
}

impl CancelHandle {
    pub fn new(source: Arc<dyn CancelSource>, run_id: RunId) -> Self {
        Self { source, run_id }
    }

    pub fn run_id(&self) -> RunId {
        self.run_id
    }
}

impl std::fmt::Debug for CancelHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CancelHandle")
            .field("run_id", &self.run_id.get())
            .finish_non_exhaustive()
    }
}

thread_local! {
    /// Split from `SOURCE` so the hot path is one scalar read with no move and
    /// no window in which a reentrant `check()` could observe "not bound". The
    /// wasm source calls out to JS, so reentrancy is not hypothetical.
    /// `0` means unbound.
    static RUN_ID: Cell<u32> = const { Cell::new(0) };
    /// `RefCell` rather than `Cell::take`: shared borrows nest freely, and the
    /// only `borrow_mut` is in `bind` / `Drop`, neither of which calls `check`.
    static SOURCE: RefCell<Option<Arc<dyn CancelSource>>> = const { RefCell::new(None) };
}

/// The call every checkpoint makes.
///
/// One `Cell` read when nothing is bound — which is every oracle test, every
/// CLI caller, and every fold the user cannot address.
///
/// **Exact match, not a watermark.** Comparing `cancelled >= run_id` would
/// cancel every concurrently-live run with a lower id, so a user's Stop would
/// silently kill an in-flight background rehydrate.
#[inline]
pub fn check() -> Result<(), Cancelled> {
    let run_id = RUN_ID.get();
    if run_id == 0 {
        return Ok(());
    }
    SOURCE.with(|slot| match slot.borrow().as_ref() {
        Some(source) if source.cancelled_run() == run_id => Err(Cancelled),
        _ => Ok(()),
    })
}

/// Poll every `1 << $bits` iterations of the enclosing loop.
///
/// Only for loop bodies too cheap to pay a [`check`] each time — anything over
/// roughly a microsecond should call `check()?` flat. `$counter` is a `u32` the
/// caller owns, so the stride is per-loop rather than global.
#[macro_export]
macro_rules! check_every {
    ($counter:ident, $bits:expr) => {{
        $counter = $counter.wrapping_add(1);
        if $counter & ((1u32 << $bits) - 1) == 0 {
            $crate::cancel::check()?;
        }
    }};
}

/// Installs a binding for as long as the guard lives, restoring whatever was
/// bound before.
///
/// RAII rather than a bare setter so no entry point can leak a binding into a
/// later fold, and a nested bind cannot orphan the outer one.
///
/// `bind(None)` is also how a `pub` operation states "a plain call of this is
/// never cancellable" — see `operations::arrangement::divide_intersections`.
#[must_use = "the binding ends immediately if the guard is dropped"]
pub struct CancelGuard {
    previous_run_id: u32,
    previous_source: Option<Arc<dyn CancelSource>>,
}

pub fn bind(handle: Option<CancelHandle>) -> CancelGuard {
    let (next_run_id, next_source) = match handle {
        Some(handle) => (handle.run_id.get(), Some(handle.source)),
        None => (0, None),
    };
    let previous_run_id = RUN_ID.replace(next_run_id);
    let previous_source = SOURCE.with(|slot| slot.replace(next_source));
    CancelGuard {
        previous_run_id,
        previous_source,
    }
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        RUN_ID.set(self.previous_run_id);
        SOURCE.with(|slot| *slot.borrow_mut() = self.previous_source.take());
    }
}

/// The binding on *this* thread, so it can be carried across a thread boundary.
///
/// The only legitimate reader outside [`check`]. Two callers: the rayon bridge
/// in [`crate::folding`], which re-installs it on each worker, and
/// `FoldingEstimateSession::transactional`, which uses "is anything bound" to
/// skip the snapshot entirely for unbound callers.
pub fn current() -> Option<CancelHandle> {
    let run_id = RunId::new(RUN_ID.get())?;
    SOURCE.with(|slot| {
        slot.borrow()
            .as_ref()
            .map(|source| CancelHandle::new(Arc::clone(source), run_id))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cancels one specific run, so the exact-match rule can be exercised.
    struct CancelOne(u32);

    impl CancelSource for CancelOne {
        fn cancelled_run(&self) -> u32 {
            self.0
        }
    }

    /// Cancels after `n` reads, for driving a real search to a checkpoint
    /// without needing an input slow enough for a human to interrupt.
    ///
    /// Atomic rather than `Cell` so it satisfies the `Send + Sync` bound the
    /// `parallel` build puts on [`CancelSource`] honestly, instead of with an
    /// `unsafe impl` that would be untrue the moment it crossed the rayon
    /// bridge.
    struct CancelAfter {
        run: u32,
        remaining: std::sync::atomic::AtomicU32,
    }

    impl CancelAfter {
        fn new(run: u32, reads: u32) -> Self {
            Self {
                run,
                remaining: std::sync::atomic::AtomicU32::new(reads),
            }
        }
    }

    impl CancelSource for CancelAfter {
        fn cancelled_run(&self) -> u32 {
            use std::sync::atomic::Ordering;
            let previous = self
                .remaining
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                    Some(remaining.saturating_sub(1))
                })
                .unwrap_or(0);
            if previous == 0 { self.run } else { 0 }
        }
    }

    fn handle(source: impl CancelSource + 'static, run: u32) -> CancelHandle {
        CancelHandle::new(Arc::new(source), RunId::new(run).expect("non-zero run"))
    }

    #[test]
    fn an_unbound_check_is_inert() {
        assert_eq!(check(), Ok(()));
    }

    #[test]
    fn a_cancel_for_this_run_stops_it() {
        let _bound = bind(Some(handle(CancelOne(7), 7)));
        assert_eq!(check(), Err(Cancelled));
    }

    /// The watermark bug an earlier draft had: a Stop on run 7 must not kill a
    /// concurrently-live run 8, nor a lower-numbered background run.
    #[test]
    fn a_cancel_for_another_run_does_not_stop_this_one() {
        for live in [6u32, 8, RunId::BACKGROUND.get()] {
            let _bound = bind(Some(handle(CancelOne(7), live)));
            assert_eq!(check(), Ok(()), "run {live} was cancelled by a stop on 7");
        }
    }

    /// `RunId` has no `Default` and cannot be zero, so "unbound" and "run 0"
    /// cannot be confused — under exact match a zero id would otherwise be
    /// cancelled from birth by an idle source.
    #[test]
    fn a_run_id_is_never_zero() {
        assert!(RunId::new(0).is_none());
        assert_eq!(RunId::new(1).map(RunId::get), Some(1));
        assert_eq!(RunId::BACKGROUND.get(), u32::MAX);
    }

    #[test]
    fn the_guard_restores_the_previous_binding() {
        assert_eq!(check(), Ok(()));
        {
            let _outer = bind(Some(handle(CancelOne(1), 1)));
            assert_eq!(check(), Err(Cancelled));
            {
                // A nested bind for a different run must not leak out.
                let _inner = bind(Some(handle(CancelOne(99), 2)));
                assert_eq!(check(), Ok(()));
            }
            assert_eq!(
                check(),
                Err(Cancelled),
                "the outer binding was not restored"
            );
        }
        assert_eq!(check(), Ok(()), "the binding leaked past its guard");
    }

    /// `bind(None)` is how a `pub` operation states that a plain call of it is
    /// not cancellable, so it has to actually mask an outer binding.
    #[test]
    fn binding_none_masks_an_outer_binding() {
        let _outer = bind(Some(handle(CancelOne(1), 1)));
        assert_eq!(check(), Err(Cancelled));
        {
            let _masked = bind(None);
            assert_eq!(check(), Ok(()));
        }
        assert_eq!(check(), Err(Cancelled));
    }

    #[test]
    fn current_reports_the_bound_run_and_nothing_when_unbound() {
        assert!(current().is_none());
        let _bound = bind(Some(handle(CancelOne(5), 5)));
        assert_eq!(current().map(|handle| handle.run_id().get()), Some(5));
    }

    /// The signal is a level, not an edge: reading it must not clear it. This is
    /// the Oriedita `Thread.interrupted()` defect, and `check` is the reason it
    /// cannot be reproduced here.
    #[test]
    fn checking_does_not_consume_the_signal() {
        let _bound = bind(Some(handle(CancelOne(3), 3)));
        for _ in 0..5 {
            assert_eq!(check(), Err(Cancelled));
        }
    }

    /// Returns the iteration the loop reached before unwinding, so the stride
    /// itself is asserted rather than just the fact that it eventually trips.
    fn count_iterations_until_cancelled(bits: u32) -> Result<u32, Cancelled> {
        let mut counter = 0u32;
        let mut reached = 0u32;
        for iteration in 0..10_000u32 {
            check_every!(counter, 4);
            reached = iteration;
            let _ = bits;
        }
        Ok(reached)
    }

    #[test]
    fn check_every_polls_on_the_stride_and_not_before() {
        // `1 << 4` is 16 iterations per poll. A source that is already cancelled
        // therefore trips on the 16th iteration, index 15 — proving both that it
        // polls and that it does not poll every time.
        let _bound = bind(Some(handle(CancelAfter::new(1, 0), 1)));
        assert_eq!(count_iterations_until_cancelled(4), Err(Cancelled));

        // 8 whole strides of grace, then the trip: the counter is the caller's,
        // so a fresh loop starts its stride from zero.
        let _unused = bind(Some(handle(CancelAfter::new(1, 8), 1)));
        assert_eq!(count_iterations_until_cancelled(4), Err(Cancelled));
    }

    /// An unbound loop must never pay more than the `Cell` read, and must run to
    /// completion — this is every oracle test and every CLI caller.
    #[test]
    fn check_every_is_inert_when_unbound() {
        assert_eq!(count_iterations_until_cancelled(4), Ok(9_999));
    }
}
