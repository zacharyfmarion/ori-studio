# Flat-Folder Vendor Snapshot

This directory vendors the source files needed to run Jason Ku's Flat-Folder
implementation as a local JavaScript oracle.

- Upstream: <https://github.com/origamimagiro/flat-folder>
- Pinned commit: recorded in `upstream-sync.json` under `flat-folder`, which is
  the source of truth for every upstream pin. Deliberately not repeated here —
  two copies of a SHA are two copies to forget to update.
- License: MIT, preserved in `LICENSE`

Only source files and minimal project metadata are vendored. Large images and
the full upstream example corpus are intentionally omitted; this repository keeps
only a tiny redistributable fixture set under `tests/fixtures/flat-folder`.
