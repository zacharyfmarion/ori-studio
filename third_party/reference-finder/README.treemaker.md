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

Local changes: none.
