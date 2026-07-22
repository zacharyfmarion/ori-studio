# Desktop Native CP Engine Migration

## Goal

On **desktop (Tauri)**, run the Ori Studio crease-pattern (CP) engine as **native
compiled Rust** invoked through Tauri commands, instead of the WebAssembly build
that the desktop webview currently loads. The **web build stays on wasm,
unchanged.** This:

- Removes the ~3× wasm runtime penalty (iguana fold ~18s wasm → ~5s native).
- Unlocks **`rayon`** to parallelize the fold's condition-generation across cores
  (the same parallelization Oriedita does), targeting **~1–2s — at or below
  Oriedita** on desktop.
- Requires none of the browser wasm-threading infrastructure (no
  SharedArrayBuffer / COOP-COEP).

Scope is the **`oristudio-cp` engine only** (the Oriedita port). The other wasm
engines (`treemaker`, `oristudio-bp`, `oristudio-cp-detect`) stay on wasm for now
— the same pattern can be applied later if desired.

## Why this is tractable (the seams already exist)

Research findings (see the three surfaces below):

1. **Frontend dispatch seam already exists.** `apps/web/src/platform/runtime.ts`
   exposes `getRuntimeSurface(): 'web' | 'desktop'`, and
   `apps/web/src/platform/fileService.ts` is the canonical
   interface + `createFileService(surface)` factory pattern. The CP engine has a
   single factory — `getOristudioCpClient()` in
   `store/workspaceStore/oristudioCpRuntime.ts` — returning
   `Remote<OristudioCpWorkerApi>`. The store only ever sees the **interface**
   (`OristudioCpWorkerApi`, ~32 async methods), never the worker. Branch that one
   factory on `getRuntimeSurface()` and return a native `invoke`-backed object on
   desktop.

2. **The wasm bridge is 33 functions**, almost all thin serde-in/serde-out
   wrappers over `oristudio_cp` types that already derive `Serialize`/
   `Deserialize`. State is two `thread_local!` slot arenas (`DOCUMENTS`,
   `FOLDED_FIGURES`) keyed by opaque `u32` handles. The frontend treats handles as
   opaque numbers, so the wire contract is preservable byte-for-byte.

3. **Tauri v2 shell is greenfield for engine code.** `apps/tauri/src-tauri`
   (crate `ori-studio`) has 6 fs/platform commands and the established
   `#[tauri::command]` + `generate_handler!` + `.manage(State)` patterns, but **no
   dependency on any engine crate yet**. Custom `invoke` commands need no new
   capability.

## The wasm surface to port (33 functions → native commands)

Grouped by concern (all in `crates/oristudio-cp-wasm/src/lib.rs`):

- **Document load/construct (6, allocate handles):** `load_cp`, `load_fold`,
  `load_fold_file`, `load_ori`, `load_orh`, `load_document`.
- **Document lifecycle/read (6):** `restore_document`, `document_snapshot`,
  `document_geometry`, `restore_from_compact`, `document_summary`, `free_document`.
- **Editing (6):** `execute_cp_command`, `preview_cp_command`,
  `insert_line_segments`, `replace_line_segments`, `deselect_all`, `import_add`.
- **Export (5):** `export_cp`, `export_fold`, `export_fold_file`, `export_ori`,
  `export_orh`.
- **Folding (9):** `folded_figure_fold`, `folded_figure_fold_selected`,
  `folded_figure_snapshot`, `folded_figure_render_snapshot`,
  `folded_figure_set_model`, `folded_figure_duplicate`,
  `folded_figure_fold_another`, `folded_figure_fold_to_case`, `free_folded_figure`.
- **Metadata (1):** `cp_operation_descriptors`.

Only **two** have genuinely wasm-shaped signatures: `document_geometry` /
`restore_from_compact` use hand-built `Float64Array`/`Int32Array`/`Uint8Array`
objects with Comlink zero-copy `transfer()`. Everything else is serde.

## Architecture

### Rust: extract a shared session store (avoid duplicating 33 bodies)

The wasm bridge currently mixes three things: (a) the handle-store arenas, (b)
JsValue marshaling, (c) the operation bodies. Extract (a)+(c) into a reusable,
UI-agnostic **`CpSession`** store (new module in `oristudio-cp`, or a small
`oristudio-cp-session` crate):

```
struct CpSession { documents: Slab<CreasePatternDocument>, folded: Slab<FoldedFigure> }
impl CpSession { fn load_cp(&mut self, ..) -> Result<u32, EngineError>; ... } // 33 methods, owned serde types
```

Then both bridges become thin:

- **`oristudio-cp-wasm`** = `thread_local!<CpSession>` + JsValue wrappers (its
  behavior is unchanged; existing `tests/node.rs` + the web app guard it).
- **Tauri** = `State<Mutex<CpSession>>` + `#[tauri::command]` wrappers (Tauri
  auto-serdes args/returns).

Option B (faster to start, worse long-term): skip the extraction and reimplement
the 33 bodies directly as Tauri commands. Recommend **Option A** — one home for
the logic, and the wasm refactor is low-risk (thin wrappers, guarded by tests).

Handle model: use `slab`/generation-tagged handles natively to close the current
stale-handle-reuse gap (freed `u32` can alias a new object). Optional; the wasm
arena has the same gap today.

### The binary geometry-transport wrinkle (the one real engineering task)

`document_geometry` returns `CompactGeometry` (10 `Vec<f64/i32/u8>` arrays) — the
hot render path fetched after every edit. Over wasm+Comlink it is zero-copy
`transfer()`d. Over Tauri IPC, serializing it as JSON (numbers→text) would be slow
and bloated for large docs and would regress the ~140ms→4ms win.

Fix: add a single-buffer codec `CompactGeometry::to_bytes()/from_bytes()`
(length-prefixed concat) and return the bytes from the native command via Tauri
v2 `tauri::ipc::Response` (frontend receives an `ArrayBuffer`); decode on the main
thread into the same typed arrays `decodeCpGeometryToSnapshot` already consumes.
`restore_from_compact` takes the bytes the same way (raw `invoke` body). This
keeps the desktop hot path binary and fast.

### Frontend: native backend behind the existing interface

- Add `createOristudioCpNativeClient(): OristudioCpWorkerApi` — an object whose
  ~32 methods `invoke('oristudio_cp_*', args)` the Tauri commands (mirroring
  `platform/fileService.ts`'s `TauriFileService`). `documentGeometry` /
  `restoreFromCompact` use the raw-bytes path.
- Branch `getOristudioCpClient()` on `getRuntimeSurface()`: `'desktop'` → native
  client, `'web'` → today's Comlink-wrapped worker. Everything downstream
  (`oristudioCpRuntime.ts` exported functions, `creasePatternSlice.ts`) is
  unchanged.
- Preserve the error contract: native commands return an error serializing to
  `{ code, message }` so `oristudioCpError()` works unchanged.

### Rayon-parallel fold (feature-gated, native only)

- Add a `parallel` cargo feature to `oristudio-cp` pulling in `rayon`; the Tauri
  build enables it, the wasm build never does (wasm has no threads).
- Parallelize the two hot spots (both are already embarrassingly parallel in our
  architecture — we generate all candidates, *then* run AEA serially):
  1. `equivalence_condition_candidates_from_parts`: `par_iter` the triple loop
     (over folded lines) and the quad loop; each item independently produces
     conditions → collect. No shared mutation. This is the ~5s that becomes
     ~5s/Ncores.
  2. `from_subfaces` / `set_guide_map`: `par_iter` over valid subfaces (each guide
     map is independent).
- The `removeMode` AEA stays serial (already ~16ms). Feature-gate so the wasm path
  keeps today's sequential loops.
- Run the fold command async / `spawn_blocking` so a multi-second fold never
  blocks the IPC thread.

## Cross-platform parity enforcement (CI)

`CpSession` is a concrete shared struct (the operation bodies live once), but the
two bridges are still separate function lists — sharing `CpSession` guarantees
identical *behavior*, not that both bridges *expose* each method. A **command
manifest** is the contract, and all four surfaces (wasm export, Tauri command,
web worker method, desktop native method) are checked against it. Requirement:
adding a function for web must fail CI until it exists for desktop.

1. **Frontend web ↔ desktop — compile-time (hard error).** Both clients are typed
   against one shared interface (`Remote<OristudioCpWorkerApi>`, or an explicit
   `OristudioCpEngineClient`). `getOristudioCpClient()` returns that interface;
   the desktop native client is declared to implement it. Adding a method to the
   interface breaks `npm run typecheck:web` (already a CI job) until desktop
   implements it. This is the primary guarantee.
2. **Rust wasm ↔ native command sets — `cargo test`.** A single
   `CP_ENGINE_COMMAND_NAMES` manifest in the shared crate. A test asserts the
   `oristudio-cp-wasm` export set and the Tauri `generate_handler!` set each equal
   the manifest. (Use `inventory`/a small macro so the lists are collected from
   the actual `#[wasm_bindgen]`/`#[tauri::command]` fns, not hand-maintained — so
   the test proves the fn exists, not just that a list matches.)
3. **Native-client invoke seam — TS test.** The native client calls
   `invoke('oristudio_cp_<name>')`; that string isn't compile-checked. A test
   asserts the native client's invoke-names match the manifest, closing the one
   non-compile-checked gap.

Stronger (optional) alternative: generate both Rust bridge wrappers from the
manifest via a macro so parity is by construction; the two geometry-transport
commands need a hand-written escape hatch. Start with manifest + tests.

## Affected Areas

- `crates/oristudio-cp/` — new `CpSession` store module; `parallel` feature +
  `rayon`; `CompactGeometry` binary codec.
- `crates/oristudio-cp-wasm/src/lib.rs` — rewrite as thin wrappers over
  `CpSession` (behavior unchanged).
- `apps/tauri/src-tauri/` — add `oristudio-cp` dep; ~33 `#[tauri::command]`s;
  `manage(Mutex<CpSession>)`; register in `generate_handler!`; the `parallel`
  feature on.
- `apps/web/src/store/workspaceStore/oristudioCpRuntime.ts` — native client +
  factory branch. `apps/web/src/engine/oristudioCpGeometry.ts` — decode-from-bytes
  path.
- `apps/web/src/platform/` — optional: a `createOristudioCpEngineClient(surface)`
  factory mirroring `fileService`.

## Risks / watch-items

1. **Binary geometry transport** — the main new code; get the byte layout + Tauri
   `Response`/raw-body wiring right, else the desktop edit path regresses.
2. **Serialization parity** — `serde-wasm-bindgen` (Comlink) vs `serde_json`
   (Tauri IPC) can differ on enum/`Option` shapes. Round-trip-test the DTOs;
   the TS types in `engine/oristudioCpTypes.ts` are the contract.
3. **IPC latency on the hot edit path** — `invoke` round-trip per edit vs Comlink
   postMessage; expected comparable, but measure `execute_cp_command` +
   `document_geometry` on desktop.
4. **Async/threading** — fold must be async / `spawn_blocking`; rayon pool inside
   a Tauri command is fine but confirm no runtime conflict.
5. **State locality** — the whole CP engine state must live in ONE place per
   platform (native on desktop). That's why we migrate the entire CP surface as a
   unit, not just the fold (fold reads a document handle).
6. **Build/dev** — Tauri crate now compiles `oristudio-cp`; `check:desktop` and
   `dev:desktop` get slower first build. No web impact.

## Phasing

- **Phase 0 — Prep:** add `oristudio-cp` to the Tauri crate; a `platform_ping`-style
  end-to-end native call returning e.g. `cp_operation_descriptors` to prove the
  invoke path + serde round-trip. Small.
- **Phase 1 — Shared `CpSession`:** extract store + 33 bodies; rewire
  `oristudio-cp-wasm` as thin wrappers; green existing wasm/web. Medium.
- **Phase 2 — Native commands:** ~33 `#[tauri::command]`s + managed state +
  registration + error contract. Medium (mechanical).
- **Phase 3 — Binary geometry codec + native frontend client + factory dispatch.**
  Medium; includes the one tricky transport piece.
- **Phase 4 — Rayon parallel fold** (feature-gated). Small–medium.
- **Phase 5 — Validation:** native-vs-wasm parity harness (fold the corpus both
  ways, compare snapshots/fingerprints), desktop smoke test (open/edit/fold/
  export/undo), perf measurement vs Oriedita. Medium.

## Checklist

- [x] Phase 0: Tauri depends on `oristudio-cp`; `cp_operation_descriptors` round-trips (commit 49492d66)
- [x] Phase 1: `CpSession` store extracted (1a 37add649); `oristudio-cp-wasm` = thin wrappers (1b 78a7606b); wasm-pack + web tests green
- [x] Phase 2: 33 native commands + `Mutex<CpSession>` state + `EngineError` contract + parity test (f6a8e26c)
- [x] Phase 3: native frontend client + `getOristudioCpClient` surface dispatch; `CompactGeometry` camelCase serde (JSON transport) (43635449)
- [x] Phase 4: `parallel` feature + `rayon` in condition-gen (native-only guard); iguana 5.6s → ~1.5s, byte-identical (251d4a06)
- [x] Parity: shared `CP_ENGINE_COMMANDS` manifest; compile-time web↔desktop via `OristudioCpWorkerApi`; `cargo test` native-set==manifest
- [ ] Phase 5: desktop smoke test (user, in-app); binary geometry codec is a deferred optimization (JSON path works now)

## Outcome

Fold on `slow_fold_iguana.ori` (850 faces): browser wasm ~18s → **native desktop
~1.5s** (rayon), beating Oriedita's ~4s, with the fold output byte-identical
(fingerprint `cases=1 relations=120825`). All engine work is shared through
`CpSession`; the wasm/web path is unchanged. Remaining: the compact-geometry IPC
path uses JSON (functional); a single-buffer binary codec is a follow-up
optimization if the desktop edit path feels heavy on large documents.
