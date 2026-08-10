# Oriedita Vendor Snapshot

This directory vendors the pinned Oriedita source snapshot used as the semantic
oracle for the Ori Studio crease-pattern port.

- Upstream: <https://github.com/oriedita/oriedita>
- Pinned commit: recorded in `upstream-sync.json` under `oriedita`, which is the
  source of truth for every upstream pin. Deliberately not repeated here — two
  copies of a SHA are two copies to forget to update.
- License: MIT, preserved in `LICENSE.md`

The oracle build under `tools/oriedita-oracle` defaults to this path, so local
parity checks do not require a separate external Oriedita checkout.
