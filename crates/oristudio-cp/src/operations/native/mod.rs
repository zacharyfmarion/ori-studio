//! Ori Studio original crease-pattern operations. No upstream, no parity obligation.
//!
//! Everything else under `operations/` is a port, and its sibling module header
//! says so: *"Oriedita-compatible non-UI crease-pattern mutations."* A reader who
//! finds unfamiliar geometry in `generators.rs` is right to go looking for it in
//! `third_party/oriedita`, and right to treat a difference as a bug. Code in this
//! directory is the opposite: there is nothing upstream to compare it against, so
//! the porting rules in `PORTING.md` — read the reference first, preserve its
//! quirks, do not substitute a simpler algorithm — do not apply here.
//!
//! The path is the marker. An operation whose `target` starts with
//! `operations::native::` must be tagged [`crate::OperationOrigin::OriStudio`],
//! and a unit test in `lib.rs` fails if it is not.
//!
//! What this directory does *not* buy is a separate execution path. A native
//! operation is an ordinary operation that happens to have no upstream: it
//! dispatches, previews, and crosses the wasm bridge exactly like a ported one.

pub mod direction_hint;
pub mod fold_propagation;
pub mod square;
pub mod unassign;
