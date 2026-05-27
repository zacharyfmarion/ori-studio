//! FOLD export hooks for future compiler phases.
//!
//! Phase 2 intentionally preserves the legacy FOLD JSON in the no-op compiler
//! path. Later phases will move final FOLD construction here after topology
//! optimization and assignment solving.
