# ReferenceFinder

Robert J. Lang's ReferenceFinder — the C++ core of Mu-Tsun Tsai's web build,
extended by Tsai and Omri Shavit (Emscripten build, JSON output, database
persistence, axiom priorities, scoring, seeding).

| | |
| --- | --- |
| Repo | `https://github.com/MuTsunTsai/reference-finder` |
| Branch | `main` |
| Our code | none — **not a port**; `scripts/build-reference-finder.mjs` compiles the vendored C++ to wasm |
| Vendored at | `third_party/reference-finder/` (curated subset: `src/core/**`, `makefile`, `LICENSE`, `package.json`, README/CONTRIBUTING/CHANGELOG, clang configs) |
| Manifest key | `reference-finder` |
| Oracle | `tools/reference-finder-oracle` — a **build-equivalence** oracle, not a parity oracle |

## A local patch rides on top of the pin

`third_party/reference-finder` is upstream's pinned commit **plus** the search
patch listed under `local_patches` in the manifest (`src/core/ReferenceFinder.cpp`
and `src/core/class/refLine/refLine.{h,cpp}`; README.treemaker.md, "Local
changes"). A re-vendor therefore has one step the other upstreams do not: update
the vendored files to the new pin, re-apply the patch (it is confined to the two
`FindBest*` functions and one extracted helper), rebuild, and run the oracle —
identical answers under every search setting in `queries.json` is the whole
claim the patch makes. An upstream change to `FindBestMarks`, `FindBestLines`,
`CompareRankAndError`, `RefLine::DistanceTo` or `Paper::ClipLine` is a `PORT`
finding *for the patch* even when it would otherwise be `SKIP-REFACTOR`.

## This upstream is different: nothing is ported

Every other reference file asks "does a change here need re-implementing in our
code?" That question has no answer for ReferenceFinder, because the shipped
`apps/web/src/generated/reference-finder/ref.wasm` *is* upstream's C++,
compiled by us and run in a Web Worker as a black box over its console protocol
(numbers on stdin, JSON lines on stdout). So the buckets read slightly
differently here:

| Bucket | Meaning for ReferenceFinder |
| --- | --- |
| `PORT` | We should re-vendor: the change alters results, the stdout contract, or the build recipe. The "porting work" is a re-vendor + rebuild + oracle run + client adjustment. |
| `SKIP-REFACTOR` | No semantic change; picked up for free at the next re-vendor |
| `SKIP-UNPORTED` | Touches only the omitted React app, locales, icons, or build tooling we do not use |
| `SKIP-UI` | Same as above — everything under `src/app` |

A `PORT` finding here is cheaper than elsewhere (no transcription) but has a
second consumer: the TypeScript client that encodes stdin and decodes stdout.
Any contract change lands on it.

## Watch paths

```
src/core/
makefile
package.json
```

`package.json` is watched for two reasons: its `version` feeds `RFVersion.h`
(and so the banner on stdout line 1), and its `license` field is the only place
the fork states a GPL version — a change there is a licensing event, not a build
event. See `LICENSING.md`, "ReferenceFinder".

## Port map

There is none in the usual sense. The one mapping worth recording is
`makefile` → `scripts/build-reference-finder.mjs`: the script copies the
makefile's flags with a comment citing the line. It must be re-read on every
makefile change.

## Highest risk, in order

1. **Compiler and link flags in `makefile`.** `CXXFLAGS`/`LDFLAGS` are copied,
   not consumed: `-O3 -flto`, `-sASYNCIFY=1`, `-sEXPORTED_RUNTIME_METHODS=wasmMemory`,
   `-sENVIRONMENT=worker`, `-sINITIAL_MEMORY`/`-sMAXIMUM_MEMORY`/`-sALLOW_MEMORY_GROWTH`,
   `-lidbfs.js`, `-sEXPORT_ES6`, `-sMIN_SAFARI_VERSION` (ours is raised to
   `150000`; emcc ≥ 6 rejects upstream's `120000`). A flag added or removed
   upstream and not mirrored is invisible until a browser fails — `PORT`, and
   re-run the equivalence oracle.
2. **The stdout contract** — the strings and keys the client parses:
   - `src/core/main.cpp`: the `Ready` sentinel; the two banner lines; the
     progress objects (`total`, `progress`, `done`) and the
     `{"rank": …, "lines": …, "marks": …}` database line; the `case` numbers of
     the query switch (1 = mark, 2 = line, …).
   - `src/core/class/jsonStreamDgmr.cpp`: the `diagrams` array and the diagram
     element `type` codes 0–4 with their fields (`pt`, `from`, `to`, `center`,
     `radius`, `ccw`, `width`, `height`, `text`, `style`).
   - `src/core/class/refBase.cpp`: `steps`, and each step's `key` / `score`;
     the distance/rank fields written by `PutDistanceAndRank`.
   - `src/core/json/`: the serializer itself (number formatting, escaping).
   Any renamed or reordered key is `PORT` at the highest priority — the wasm
   still builds and the client silently reads `undefined`.
3. **The stdin contract** — the numeric read order in `readDbSettings`,
   `readExistingPointsAndLines`, and `readSearchSettings` (`main.cpp`). A new
   setting inserted mid-sequence shifts every later value. `PORT`.
4. **Tolerances and search constants.** `src/core/global/global.h` `EPS`
   (`1.0e-12`, point equality and parallelism); `global.cpp` defaults for
   `sMinAspectRatio` (`0.100`) and `sMinAngleSine` (`0.342`); anything in
   `src/core/math/` (`xypt`, `xyline`, `xyrect`, `paper`); the database
   optimizer in `src/core/database/optimizer.cpp` and `chebyshev.hpp`, and the
   binary database stream format (`binaryInputStream.hpp` /
   `binaryOutputStream.hpp`, which also decides whether a user's cached IndexedDB
   database is still readable). `PORT`, unconditionally, as everywhere — and the
   planner's adopted constants (see `implementation-plans/reference-finder-integration.md`,
   D3 tier 1) must be checked against the new values.
5. **`src/core/RFVersion.h`.** Version macros synced from `package.json` by
   upstream's gulp task; the vendored `makefile` rule that regenerates it shells
   out to `pnpm gulp` and is never run here, so the vendored header must match
   the vendored `package.json` by hand at re-vendor time. It only changes stdout
   line 1, but a client that sniffs the banner would notice.

## Re-vendoring and the equivalence oracle

A re-vendor is the only way a `PORT` finding reaches the product:

1. Update the curated subset in `third_party/reference-finder/` file by file
   (never copy the whole tree — the React app and `src/lib/ref.{js,wasm}` stay
   out), update `README.treemaker.md` if the subset changed, and move
   `vendored_commit` in `upstream-sync.json`.
2. Rebuild: `npm --workspace @treemaker/web run build:reference-finder-wasm`
   (or `node scripts/build-reference-finder.mjs`, `--node` for the Node link
   the tests use). Update the SHA-256 values the fallback fetch verifies, which
   live beside the pinned commit in the build script.
3. Run the equivalence oracle, `tools/reference-finder-oracle` (`equiv.mjs`
   with its query-set file). It drives our from-source wasm and upstream's
   committed `src/lib/ref.{js,wasm}` at the same commit over the same queries
   and expects identical solutions. It runs as a `web-client` CI step on every
   upstream bump; a mismatch means our flags or toolchain diverged from
   upstream's, not that "the port is wrong".
4. Re-capture the client's replay fixtures if the stdout contract moved.

## Expected volume

Modest and bursty: the core was largely rewritten for the web build in 2024,
with steady follow-ups through 2025 and a `v4.8.x` series in 2026. Most core
commits are `SKIP-REFACTOR` or `SKIP-UI` (the app is far more active than the
core); the ones that matter cluster around release tags. Read the diff, not the
version bump.

## Licensing note

The fork's `LICENSE` says "GNU GPL" over the version 2 text and `package.json`
says `GPL-2.0`; Lang's original is v2-or-later. Whether the Tsai/Shavit
modifications are or-later is an open question with the maintainers. A drift
check that sees either file change should say so in its report rather than
bucketing it — it is a licensing decision for the maintainer, not drift.
