# ReferenceFinder Vendor Snapshot

This directory vendors the C++ core of Mu-Tsun Tsai's web build of Robert J. Lang's
ReferenceFinder, which Ori Studio compiles to WebAssembly with Emscripten and runs in a
Web Worker. It is **not** ported to Rust: the wasm is consumed as-is through its
stdin/stdout protocol (see `implementation-plans/reference-finder-integration.md`).

- Upstream: <https://github.com/MuTsunTsai/reference-finder> (C++ core derived from
  Lang's ReferenceFinder 4, <https://langorigami.com/article/referencefinder/>)
- Pinned commit: recorded in `upstream-sync.json` under `reference-finder`, which is the
  source of truth for every upstream pin. Deliberately not repeated here.
- License: GNU GPL, preserved in `LICENSE`. The file states "GNU GPL" and reproduces the
  version 2 text; `package.json` declares `GPL-2.0`. Lang's original distribution grants
  "version 2 or (at your option) any later version"; whether the fork's modifications carry
  the same grant is an open question with the maintainers — see `LICENSING.md`.

What is vendored: `src/core/**` (the engine and its Emscripten interop), `makefile` (the
authoritative compiler-flag list — never invoked directly; `scripts/build-reference-finder.mjs`
copies its flags), `package.json`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`,
`.clang-format`, `.clang-tidy`.

What is omitted on purpose: the React app (`src/app`), locales, icons, public assets,
`pnpm-lock.yaml`, the rsbuild/eslint/gulp configuration, and upstream's committed build
outputs `src/lib/ref.{js,wasm}` — those are rebuilt from `src/core` into the gitignored
`apps/web/src/generated/reference-finder/` by the build script, so no binary is tracked.

## Local changes

One, deliberately not upstreamed: upstream's app shows a single solution per query and does
not feel the cost; Ori Studio's precrease planner asks about every remaining line of a
component in one batch and does.

- **Score each basis reference once per query, with each line's paper clip precomputed**
  (`src/core/ReferenceFinder.cpp`, the block headed "Ori Studio patch";
  `src/core/class/refLine/refLine.{h,cpp}`, `RefLine::WorstCaseDistance`). Upstream's
  `FindBestLines` runs `partial_sort_copy` over all ~600k basis lines with a comparator
  that recomputes `DistanceTo(target)` for both operands of every comparison, and with
  `sLineWorstCaseError` set each `DistanceTo` clips both lines to the paper first — the
  constant target included. The patch keeps the same partial sort, over the same
  sequence, under the same rank-within-good-enough rule, but reads a distance computed
  once per reference (from clips computed once per database, by the same functions) and
  a cached `GetRank()`. Answers are bit-identical; a rank-6 line query drops from ~64 ms
  to ~5 ms (Node, steady state) and the first query after a build pays ~0.2 s once for
  the caches. Verified by `tools/reference-finder-oracle/equiv.mjs`, which compares full
  solution lists against upstream's committed artifact under every search setting the
  app uses and prints both modules' mean query time. Design record:
  `implementation-plans/reference-finder-line-search-patch.md`.

A re-vendor (see `.agents/skills/upstream-drift/references/reference-finder.md`) must
re-apply this patch on top of the new pin and re-run the oracle; the patch is confined to
the two search functions and one extracted helper so that rebase stays small. The
build script's development-only fallback fetches upstream's *unpatched* artifact — same
answers, upstream's speed — and CI never ships it.
