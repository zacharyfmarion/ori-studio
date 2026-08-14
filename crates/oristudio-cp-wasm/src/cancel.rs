//! The browser end of the fold cancel signal.
//!
//! A fold occupies the CP worker's only thread, so a `postMessage` asking it to
//! stop is not read until the fold it is meant to stop has already returned. The
//! only channel that reaches a blocked worker is memory both threads can see: the
//! main thread `Atomics.store`s the run id into a `SharedArrayBuffer` slot, and
//! the kernel's checkpoints read it here.
//!
//! The buffer is installed once per worker (`cp_set_cancel_buffer`), not per
//! fold, so a fold call carries only its run id.
//!
//! **The engine does not require this.** The module's own memory is unshared, so
//! it boots on a page without cross-origin isolation — where `SharedArrayBuffer`
//! does not exist and no buffer is ever installed. Every fold then binds nothing
//! and runs exactly as it did before this module existed; cancellation is
//! *unavailable*, never half-working. `foldCancellationAvailable()` on the web
//! side is what tells the UI which of the two it is looking at.

use js_sys::Int32Array;
use oristudio_cp::cancel::{CancelHandle, CancelSource, RunId};
use oristudio_cp::session::{CpSession, EngineError};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

/// Install the shared cancel buffer for this worker.
///
/// Called from the `oristudio-cp` connector on every connect, so a worker that
/// died and respawned comes back with cancellation working rather than with a
/// Stop button that silently does nothing.
#[wasm_bindgen]
pub fn cp_set_cancel_buffer(view: Int32Array) {
    source::install(view);
}

/// Run a fold with `run_id` bound, so the kernel's checkpoints can unwind.
///
/// One of only two places in the codebase that binds a cancel token (the other is
/// the desktop bridge), which is what keeps the ambient binding auditable. A
/// `run_id` of 0, or a page with no shared buffer, binds nothing and the fold is
/// uncancellable — the pre-existing behaviour.
pub fn with_fold<T>(
    run_id: u32,
    f: impl FnOnce(&mut CpSession) -> Result<T, EngineError>,
) -> Result<T, JsValue> {
    let handle = RunId::new(run_id)
        .zip(source::current())
        .map(|(run_id, source)| CancelHandle::new(source, run_id));
    let _bound = oristudio_cp::cancel::bind(handle);
    crate::with_session_mut(f)
}

/// Reading the slot, on the one target that has a JS engine to read it with.
///
/// `cargo test --workspace` also builds this crate for the host, where feature
/// unification hands `oristudio-cp` its `parallel` feature and `CancelSource`
/// therefore requires `Send + Sync` — which an `Int32Array` (a `JsValue` handle
/// into a JS heap that does not exist off-wasm) cannot honestly satisfy. Rather
/// than assert it with an `unsafe impl` that would be a lie the moment rayon
/// touched it, the source simply does not exist off-wasm and every fold there
/// binds nothing.
#[cfg(target_arch = "wasm32")]
mod source {
    use super::{Arc, CancelSource, Int32Array};
    use std::cell::RefCell;

    /// Slot 0 of the shared buffer holds the run the user asked to stop, matching
    /// `SLOT_CANCELLED_RUN` in `store/workspaceStore/foldCancellation.ts`.
    const SLOT_CANCELLED_RUN: u32 = 0;

    struct SabCancel(Int32Array);

    impl CancelSource for SabCancel {
        fn cancelled_run(&self) -> u32 {
            // `Atomics.load` rather than a plain index read: what we must observe
            // is the main thread's `Atomics.store`, and this says so instead of
            // leaning on typed-array read coherence.
            //
            // A failed read yields 0, which matches no live run — a broken bridge
            // must leave folds running, never cancel one nobody stopped.
            js_sys::Atomics::load(&self.0, SLOT_CANCELLED_RUN)
                .map(|value| value as u32)
                .unwrap_or(0)
        }
    }

    thread_local! {
        static SOURCE: RefCell<Option<Arc<dyn CancelSource>>> = const { RefCell::new(None) };
    }

    pub(super) fn install(view: Int32Array) {
        SOURCE.with(|slot| *slot.borrow_mut() = Some(Arc::new(SabCancel(view))));
    }

    pub(super) fn current() -> Option<Arc<dyn CancelSource>> {
        SOURCE.with(|slot| slot.borrow().clone())
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod source {
    use super::{Arc, CancelSource, Int32Array};

    pub(super) fn install(_view: Int32Array) {}

    pub(super) fn current() -> Option<Arc<dyn CancelSource>> {
        None
    }
}
