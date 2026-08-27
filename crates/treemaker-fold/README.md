# treemaker-fold

Generic Rust data structures and helpers for the FOLD origami interchange
format.

This crate is intentionally independent from `treemaker-core`: it should remain
usable by other origami applications without depending on TreeMaker's GPL model
engine. TreeMaker-specific metadata belongs in downstream crates as `tm:*`
custom fields.

## What It Provides

- Serde types for common FOLD document fields.
- Assignment and fold-angle helpers.
- Basic structural validation.
- Edge/face adjacency construction.

License: `MIT OR Apache-2.0`.
