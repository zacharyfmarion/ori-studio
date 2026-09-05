# ReferenceFinder parity oracle

Checks that the ReferenceFinder wasm we build from the vendored C++ core
(`scripts/build-reference-finder.mjs` → `apps/web/src/generated/reference-finder/`) answers
exactly like the artifact upstream committed at the pinned commit. Same role as the other
`tools/*-oracle` harnesses, but there is nothing to port here: both sides are the same
source, so the oracle guards the **build** (compiler version, flags, the Safari-floor
divergence) rather than a reimplementation.

## What it does

`equiv.mjs` loads each module under Node, builds the database described in `queries.json`
(rank 6 by default, upstream's default settings), runs every point and line query through
both, and compares the solution lists — `err`, `rank` and the complete `steps` JSON of every
solution, plus the final `{rank, lines, marks}` database summary. Any difference fails the
run with a per-solution diff. Byte identity of `ref.wasm` is deliberately *not* checked; a
different Emscripten produces different code and that is fine as long as the answers match.

The query set is eight points and three lines chosen to exercise exact hits (`1/2`, `1/3`),
irrationals (`1/√2`, the golden section), awkward decimals, a near-corner target and
lines at three slopes. Add cases by editing `queries.json`; both sides run the same file.

## Running it

```bash
node scripts/build-reference-finder.mjs                # our wasm (needs em++ 6.0.9)
node tools/reference-finder-oracle/equiv.mjs           # fetches upstream's artifact once
```

Without `--upstream`, the upstream `ref.js`/`ref.wasm` are downloaded from
`raw.githubusercontent.com` at the commit pinned in `scripts/reference-finder-emsdk.json`,
verified against the SHA-256 values recorded there, and cached in
`artifacts/reference-finder-upstream/` (gitignored). Options:

| Flag | Meaning |
| --- | --- |
| `--ours <dir>` | Directory holding our `ref.js` + `ref.wasm` (default `apps/web/src/generated/reference-finder`). |
| `--upstream <dir>` | Use an already-present upstream artifact instead of downloading. |
| `--queries <file>` | Alternative query set. |
| `--rank N` | Override the database rank (rank 6 takes about two seconds per side). |
| `--verbose` | Print every query's result, not only mismatches. |

The whole run is about five seconds, so it is cheap enough for the `web-client` CI job.

## How the driver works

Upstream builds with `-sENVIRONMENT=worker`, and emcc ≥ 6 glue refuses to start when it
can see Node's `process`. The driver installs a minimal worker-global shim (`self`,
`WorkerGlobalScope`, `location`), hides `process` for the synchronous prologue of the module
call, and hands the wasm bytes in through `instantiateWasm` so the glue never fetches. Input
is fed through the `Module.get()` hook the core awaits for every `ReadNumber()`; output is
collected from `print` until the `Ready` prompt. See `main.cpp` in the vendored source for the
number order. This is the same protocol the app's worker uses, so the oracle also serves as
a reference driver.

## What it does not check

- Performance, memory growth, or cancellation behaviour.
- The statistics command (`99`) and the IDBFS database persistence path (`useDatabase` is 0).
- Seeded marks/lines — the query set builds an unseeded database.
