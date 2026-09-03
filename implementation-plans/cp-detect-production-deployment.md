# CP detection in production: web, desktop, and mobile web

## Goal

Ship "Detect CP from Image" to real users on every surface Ori Studio has:

- **Web** (Cloudflare Pages, `oristudio.pages.dev`), with the model delivered
  reliably, cached after the first visit, and the feature switchable without a
  code change.
- **Desktop** (Tauri: macOS, Windows, Linux), faster than the web because
  inference uses the machine's GPU and the solve runs natively on all cores,
  with the model downloaded on first use into a place the user can see and
  manage, not baked into the installer.
- **Models as a managed, versioned download** on both surfaces: one registry
  says which model is current, the app shows what it has, what it could
  update to, and what it would cost in megabytes, and lets the user remove
  it — the way Affinity manages its machine-learning models.
- **Mobile web: hidden for now.** The dialog's buttons do not fit a phone,
  and that is a design problem to solve on purpose later, not a runtime
  one. The entry point is hidden on phones so nobody meets a half-working
  flow.

Decided 2026-09-02 with Zach: R2-hosted fp32 for the model; desktop
downloads rather than bundles; a model manager with an update story; mobile
punted. Open: whether desktop ships the native ONNX Runtime for the GPU
(see Phase 2's sizes) or starts with the webview's own GPU path.

## Where things stand

Facts, measured or read, that the plan is built on.

| thing | today |
| --- | --- |
| Feature gate | `import.meta.env.DEV` in `menus/menuDefinition.ts` and `CP_DETECT_RUNTIME_AVAILABLE` in `workers/cpDetectWorker.ts`: dev builds only |
| Model | `cp-detector-v3`: 45.2 MB fp32 ONNX, 11.0 M parameters, opset 17, 4,113 nodes. Batch-statistics normalisation is exported as explicit `ReduceMean`/`Sub`/`Div`/`Sqrt` chains (626 `ReduceMean`), so it cannot fold into the convolutions and is not free to run in fp16 |
| Model delivery | Served from `/models/cp-detector-v3/` out of `apps/web/public`, which is gitignored; a CI build has no model at all. Cloudflare Pages caps a static file at 25 MiB, so the fp32 model **cannot** be a Pages asset — a deploy with it present fails |
| Model caching | None. ORT fetches the URL itself every session; only the HTTP cache stands between a user and a 43 MiB download per visit. No integrity check against the manifest's sha256 |
| Web runtime | onnxruntime-web 1.26, WebGPU first with wasm fallback, `graphOptimizationLevel: all`. wasm threads only when `crossOriginIsolated`: up to 4. COOP/COEP are set in `public/_headers` and preserved by the custom service worker (`src/pwa/sw.ts`), which caches nothing under `/models/` |
| Desktop runtime | The CP kernel is native (Tauri `cp_*` commands over `oristudio-cp` with `parallel`). Detection and the exact solve are still the wasm workers. The custom protocol sets no COOP/COEP, so `crossOriginIsolated` is false and ORT gets **one thread**; WebGPU in WKWebView is not guaranteed. Desktop is currently the slowest surface for detection |
| Exact solve | `workers/cpExactSolveWorker.ts` over the detect wasm bridge. Native is ~5× faster: ubu_2 takes 3 s native and ~20 s in the app. No deadline since Sept 2026; Stop is a worker terminate |
| Mobile web | A phone layout, coarse-pointer surfaces and a multi-touch canvas exist (`platform/phoneLayout.ts`, `pointerSurface.ts`). The detect dialog has no camera capture, untested handle sizes, and side-by-side panes |
| Sizes | wasm bridges 1.3–2.8 MiB each; `dist/assets` ≈ 12 MB; installers: DMG per architecture, NSIS, deb, AppImage |
| Telemetry | `cp detect started/completed/imported/cancelled` exist; analytics and Sentry are inlined only on the prod deploy, so nothing has ever been measured in the field |
| Model repo | `~/Documents/code/create-pattern-detector` with a venv carrying onnx 1.16 and onnxruntime 1.23 — enough to convert and re-evaluate a model without new tooling |

## Approach

Four phases. Phase 0 is a decision the rest depends on; Phases 1–3 are
independent of each other once it is made; Phase 4 is release engineering.

### Phase 0 — The model artifact and how it reaches the browser

**Decided: A, R2-hosted fp32.** B stays written down because it also
halves the download, and may be worth measuring later for phones.

**What it costs.** Cloudflare R2 (checked 2026-09-02): storage
$0.015/GB-month after a free 10 GB-month; reads (`GetObject`, Class B)
$0.36 per million after 10 million free a month; writes (Class A) $4.50 per
million after 1 million free; **egress is free**, including through
Workers. Twenty model versions are under a gigabyte, so storage rounds to
zero, and with the edge cache in front of the function R2 is read once per
Cloudflare location per model version, so reads round to zero too. The one
meter that moves is the Pages Function itself, billed as a Worker: the free
plan allows 100,000 requests a day with 10 ms of CPU each (a stream-through
is well under that); the paid plan is $5 a month for 10 million requests
and $0.30 per million after. A model fetch is one request per user per
version, so the feature stays inside the free plan until it has tens of
thousands of first-time users a day. The share-link function already draws
on the same allowance.

**A. Keep fp32; host it on R2 behind the site's own origin.** A bucket
`oristudio-models` (R2 is already in use for share thumbnails) with immutable
keys `cp-detector/<model_id>/model.onnx` and the manifest beside it. A Pages
Function at `/models/*` streams the object with
`Cache-Control: public, max-age=31536000, immutable` and
`Cross-Origin-Resource-Policy: same-origin` (the page is `require-corp`), and
puts it through the edge cache so R2 is read once per PoP. The preview
environment binds its own bucket, as the share buckets do. `deploy-web.yml`
gains an idempotent upload step driven by `scripts/cp-detect/current-model.json`
(sha-verified, skipped when the key exists), which decouples model releases
from code deploys.

**B. Convert to fp16 (≈21 MiB) and ship it as a static asset.** Under the
cap, and no function in the path. The risk is numerical: the explicit
batch-statistics reductions compute variances at inference time, and fp16
variances of activations lose digits. It must be measured, not assumed: run
the native box-pleat eval and the 563-CP benchmark against the fp16 export
and accept it only if the junction and line metrics hold. Int8 dynamic
quantisation (≈10.5 MiB, weights only) is a further option with the same
gate, plus an unknown: wasm int8 kernels may be slower than fp32.

Either way, three things change in the app:

- **The manifest is the unit of release.** `model.url` becomes absolute (or
  origin-relative to `/models/<id>/`), and `id`, `sha256` and `size_bytes`
  are what telemetry and the cache key carry.
- **The app fetches the bytes itself** — with progress from the response
  stream ("Downloading the detector, 43 MB, once"), verifies the sha256 with
  `crypto.subtle.digest`, stores the verified bytes in the Cache API
  (`caches.open('cp-detect-models')`, keyed by the immutable URL) and hands
  `InferenceSession.create` the bytes rather than the URL. Repeat visits are
  instant, offline works after the first download, and a truncated download
  fails loudly instead of as a cryptic ORT error. The service worker keeps
  leaving `/models/` alone; the app's own cache is the store.
- **Storage honesty.** Cache API quota is ample on desktop browsers and
  usually on phones, but eviction happens; the dialog says what it is about
  to download and never assumes the cache.

### Phase 1 — Web: un-gate behind a switch, with preflight and telemetry

- Replace both `import.meta.env.DEV` gates with one feature id, `cpDetect`,
  in `platform/features.ts`, enabled by a build-time `VITE_CP_DETECT=1` that
  `deploy-web.yml` and the PR-preview workflow set. Unsetting it and
  redeploying is the five-minute kill switch. Availability at runtime is
  additionally manifest-driven: if `/models/<id>/manifest.json` cannot be
  fetched, the menu item stays, and the dialog opens on a sentence that says
  the detector is unavailable and why, rather than a blank "Running model".
- **Preflight in the dialog, before the first image:** WebGPU or wasm,
  isolated or not (thread count), `navigator.deviceMemory`, and whether the
  model is already cached. From that, one line of expectation: "about ten
  seconds on this device" or "this device has no GPU and one thread; expect a
  minute", and the download notice.
- **Telemetry that can be read.** The existing events gain the runtime
  facts as enums and buckets: execution provider, thread count, session
  creation and inference time buckets, download time bucket, model id,
  outcome. `cpDetectCancelled` is wired to Stop. Worker failures go to
  Sentry through `reportError` with `surface: 'cp-detect'`. No image data,
  no geometry.
- **CI smoke.** `scripts/share-smoke.mjs` gets a sibling that asserts the
  deployed origin serves `/models/<current id>/manifest.json` with the right
  headers and the model's first byte, so a broken function or an unuploaded
  model fails the deploy rather than the first user.

### Phase 2 — Desktop: the GPU without bloating the installer, and a native solve

The CP kernel already shows the shape: one worker API surface, two
implementations, picked in `engines/engineHost.ts`. Detection gets the same.

**The model is downloaded, not bundled.** Desktop uses the same registry and
the same fetch-verify-store path as the web (Phase 5), except that the
bytes land in the app data directory (`~/Library/Application Support/…/models/<id>/`
and the platform equivalents) through a Tauri command, so a native runtime
can open them by path and the model manager can list and remove them.

**Using the GPU — three routes, sized honestly.** The question Zach asked
is the right one: hardware acceleration through ONNX Runtime means shipping
ONNX Runtime.

| route | what ships | where it accelerates | notes |
| --- | --- | --- | --- |
| 1. The webview's own GPU | nothing new (0 MB) | Windows via WebView2's WebGPU (Chromium); macOS 26+ via WebKit's WebGPU; older macOS and Linux fall back to wasm on 4 threads once COOP/COEP are set | The web runtime already tries WebGPU first. Desktop gets it for free the moment the custom protocol carries the isolation headers |
| 2. Native ONNX Runtime with CoreML / DirectML | `libonnxruntime` ≈ 20–25 MB on macOS arm64 (CoreML included), `onnxruntime.dll` ≈ 12–15 MB plus `DirectML.dll` ≈ 15–20 MB on Windows, ≈ 20 MB on Linux (CPU); a DMG compresses that to roughly half | GPU and neural engine on macOS, GPU on Windows, all cores on Linux | Best speed everywhere; costs the bytes, a signed and notarised dylib inside the app, and a glibc floor on Linux |
| 3. The operating system's own ML frameworks | 0 MB runtime | CoreML on macOS (neural engine), Windows ML on Windows | Needs a CoreML conversion of the model and Objective-C bridging on macOS, and a WinML path with an opset ceiling on Windows; the most work and two model formats to version |

**Order: route 1 first, route 2 by measurement.** Route 1 is a header and
a rebuild, and it lets a Windows machine use its GPU and a new Mac use its
GPU with the installer unchanged. Then measure one image on an M1, an Intel
Mac on macOS 15, a Windows laptop with an integrated GPU, and Linux. If the
older-Mac and Linux numbers are the ones that hurt, route 2 earns its bytes,
and a packaging spike settles it before the rest of the phase: build one
`cp_detect_recognize` command on all three release runners, notarise the
macOS artifact, time one image. `tract` (pure Rust, CPU with rayon, no GPU)
stays the fallback if that packaging proves ugly.

**Native everything else, regardless of route.** `oristudio-cp-detect`
already holds rectify, decode, the solve input rebuild and the exact solver;
the Tauri shell gains `cp_detect_*` commands over them, and
`cpDetectNativeClient.ts` implements `CpDetectWorkerApi` the way
`oristudioCpNativeClient.ts` implements the kernel's, with inference
delegated to whichever route is live. The exact-solve session gets a native
transport: ~5× faster than wasm, on all cores where the crate is parallel.
Stop needs a native path: today's Stop terminates a worker; natively it
becomes a cancellation flag on `ExactSolveOptions` checked where the solver
already checks its deadline, following `cp_fold_cancel`'s `AtomicU32`
pattern.

**Isolation headers on the custom protocol** via Tauri's
`app.security.headers` (COOP/COEP): route 1's enabler, and it removes the
"desktop is the one-thread surface" trap for every other wasm engine.

**CI.** `release.yml` builds all three platforms; the Windows job in
`ci.yml` only tests file-format crates today and gains a check of the new
commands. Route 2, if taken, adds the runtime download and signing steps.

### Phase 3 — Mobile web: hidden, deliberately

Punted with Zach: the dialog's buttons do not fit a phone, and a runtime
that works under a layout that does not is not a feature. The "Detect CP
from Image" entry point is hidden under the phone media query and coarse
pointers (`platform/phoneLayout.ts`, `pointerSurface.ts`), so a phone never
sees it. What a future phase would need is recorded so it is not
rediscovered: a capture input (`<input type="file" accept="image/*"
capture="environment">`), 44 px handles, stacked panes, a download
confirmation on cellular, and a memory measurement on the iOS Simulator and
one real phone before anything is promised — iOS Safari and Android Chrome
do honour COOP/COEP, so the compute side is plausible; the layout is the
work.

### Phase 4 — Release engineering and rollout

- **One pointer.** `scripts/cp-detect/current-model.json` stays the single
  source of truth; a `scripts/cp-detect/publish-model.mjs` uploads to R2 for
  the web, and the desktop build reads the same file to bundle. The model
  `id` travels in telemetry so a regression can be tied to a model.
- **Order.** PR preview with the flag → internal use on real images →
  prod deploy with the flag → desktop in the next tagged release, after the
  packaging spike. The kill switch is the flag; the model can be rolled back
  by pointing the manifest at the previous key, since keys are immutable.
- **Docs.** `RELEASE.md` gains the model publish step and the R2 secrets;
  the README mentions the feature once it is on; `docs/analytics.md` lists
  the new properties.

### Phase 5 — The model manager: versions, updates, removal

Both surfaces download, so both need the same story, and it has to answer
"what happens when I release a newer model".

- **A registry, not a URL.** One small JSON at a stable path,
  `/models/registry.json` (served by the same function from R2, cached
  briefly rather than immutably): a list of model families, and for each the
  `current` id plus every published version with `id`, `version`, `size`,
  `sha256`, `url`, `released`, and a one-line note. Model objects are
  immutable at versioned keys; only the registry moves. Publishing a model is
  `publish-model.mjs`: upload the object, append the version, move
  `current`. Rolling back is moving `current` back.
- **Local state.** What is downloaded, keyed by model id, with its size and
  sha — Cache API on the web, files under the app data directory on desktop
  through Tauri commands (`cp_detect_model_list/remove/path`). The app never
  trusts a stored model without its sha matching the registry entry.
- **Updates are offered, not forced.** When the dialog opens and the
  registry says `current` is newer than what is installed, the dialog shows
  one line — "A newer detector is available (v6, 43 MB)" with Download and
  Not now — and keeps working with the installed one. No download happens
  on cellular-class surprise; the user always sees the size first. A
  preference, off by default, makes updates download automatically on
  desktop. The previous version is kept until the new one has verified, then
  removed, so an interrupted update never leaves the user with nothing.
- **The manager UI**, in Preferences under a "Models" section: each model
  family as a row — name, installed version and size, status (not
  downloaded / downloaded / update available), and Download, Update, Remove.
  Removing is immediate and frees the bytes; the detect dialog then offers
  the download again on its next open. The same panel shows where desktop
  keeps the files.
- **Pinning.** A document does not pin a model: detection is a one-time
  import and its provenance (`cp_detector.source`, the model id in the
  report) already travels in the FOLD the import wrote, which is what a
  later "which model made this" question needs.

### Acceptance

- No static file over 25 MiB in `apps/web/dist`; the deploy's smoke test
  proves the model is reachable from the deployed origin.
- Web, cold: first detection under 60 s on a 2020 laptop including the
  download; warm: under 15 s. Offline after the first download.
- Desktop, Apple Silicon: image to solved pattern under 5 s on the 22.5°
  corpus, with the active provider reported; the model downloaded once and
  visible in the manager.
- Phone: the entry point is not shown.
- A newer published model appears as an offer within one dialog open, and
  removing a model frees its bytes and re-offers it.

## Affected Areas

- `apps/web/src/workers/cpDetectWorker.ts`, `lib/cpDetectInference.ts` —
  fetch-verify-cache of the model, progress, session from bytes, preflight
  facts in the runtime report.
- `apps/web/src/platform/features.ts`, `menus/menuDefinition.ts`,
  `components/CpDetectImportModal.tsx` (+ CSS) — the feature id, preflight
  and download UI, phone layout, capture input, handle sizes.
- `apps/web/functions/models/[[path]].ts`, `apps/web/wrangler.toml`,
  `.github/workflows/deploy-web.yml`, `deploy-pr-preview.yml`,
  `scripts/cp-detect/publish-model.mjs`, a models smoke script — delivery.
- `apps/web/src/analytics/events.ts`, `monitoring/` — properties and
  error surface.
- `apps/tauri/src-tauri/` — `cp_detect_*` commands, model file commands
  (list, remove, path), a cancellation flag, `app.security.headers`; if
  route 2 is taken, a crate for native inference.
- A Preferences "Models" section and the registry client
  (`lib/cpDetectModels.ts`), shared by the dialog's update offer.
- `apps/web/src/engine/cpDetectNativeClient.ts`, `engines/engineHost.ts`,
  `engine/cpExactSolveSession.ts` — the native transport.
- `crates/oristudio-cp-compiler/src/exact_solve.rs` — a cancellation flag
  beside the deadline.
- `.github/workflows/release.yml`, `ci.yml` — runtime binaries, Windows
  check, notarisation of the added dylib.
- `RELEASE.md`, `README.md`, `docs/analytics.md`.

## Checklist

Phase 0 — model artifact (decided: R2-hosted fp32)
- [x] R2 bucket + Pages Function `/models/*` with immutable and CORP headers,
      preview binding, edge cache; `registry.json` served with a short cache.
- [x] `publish-model.mjs` driven by `current-model.json`: upload, append the
      version, move `current`; wired into `deploy-web.yml` (idempotent,
      sha-verified).
- [x] App-side fetch with progress, sha256 verification, store, session from
      bytes; unit tests with a fake fetch and store.

Phase 1 — web
- [x] `cpDetect` feature id + `VITE_CP_DETECT` in both deploy workflows;
      registry-driven availability sentence in the dialog.
- [x] Preflight line (provider, threads, memory, installed model) before the
      first image.
- [x] Telemetry properties and the wired `cpDetectCancelled`; Sentry surface.
- [x] Models smoke test after deploy.

Phase 2 — desktop
- [x] COOP/COEP via `app.security.headers`; confirm `crossOriginIsolated` and
      the thread count in the desktop shell.
- [x] Route 1 shipped (isolation headers); route 2 measured on an M-series Mac,
      numbers below. An Intel Mac, a Windows laptop and Linux remain to measure.
- [x] Route 2 taken (Zach: "probably worth it"): `ort` statically linked, CoreML on
      macOS, CPU elsewhere. Still owed: the three release runners building it
      and a notarised macOS artifact.
- [x] Model download into app data through Tauri commands; the native client
      reads it by path.
- [x] `cp_detect_*` commands (rectify, recognize, decode, solve, rebuild),
      `cpDetectNativeClient.ts`, host selection on desktop.
- [x] Native Stop: cancellation flag on `ExactSolveOptions`, checked at the
      deadline checkpoints; wired to the run registry.
- [ ] Windows CI check of the new commands.

Phase 3 — mobile web
- [x] Hide the entry point under the phone media query and coarse pointers;
      a test that a phone-shaped session never sees it.

Phase 4 — rollout
- [ ] Preview with the flag; internal pass on real images.
- [ ] Prod deploy with the flag; watch the new events for a week.
- [ ] Desktop release with native detection (numbers so far in the Outcome
      section; the release runners have not built with `ort` yet). The
      Desktop Build workflow now sets `VITE_CP_DETECT=1` — it did not before,
      so a desktop build would have shipped without the feature — and takes a
      `model_origin` input for a tester build of an unmerged branch.
- [x] `RELEASE.md` (including "Testing the detector before merging"), README,
      `docs/analytics.md`.
- [x] The funnel's missing events: `cp detect image loaded`, `cp detect
      dismissed` (with the stage), a `reason` on a failed `cp detect
      completed`, `cp detect model download failed`, and `cp exact solve
      resolved`, which was defined but never sent.
- [x] `env.webgpu.powerPreference` removed: deprecated in onnxruntime-web
      1.26 and a no-op there; the replacement (a caller-made device) fails to
      build a session in that version, measured, so the runtime picks its own
      adapter. Recorded in `workers/cpDetectWorker.ts`.

Phase 5 — model manager
- [x] Registry schema and client; the dialog's "newer detector available"
      offer with size, Download and Not now.
- [x] Local model state on web (Cache API) and desktop (app data via Tauri),
      sha-checked on every use.
- [x] Preferences ▸ Models: rows with version, size, status, Download,
      Update, Remove; desktop shows the folder.
- [x] Update keeps the previous version until the new one verifies.
- [ ] Optional desktop preference for automatic model updates, off by default.

## Outcome so far (2026-09-02)

- **Web delivery is live in code**: the current model is at
  `oristudio-models/cp-detector/<id>/model.onnx`, `registry.json` points at it
  as version 1, and `/models/*` serves both. First Detect on a device downloads
  once (45 MB, progress shown, sha256 verified) and the Cache API keeps it.
- **Native probe on an M-series Mac (10 cores)**, real model, 1024² input:
  CPU on all cores 1.8 s per image, session 0.19 s; CoreML 0.42–0.61 s per
  image after a one-time 17 s compile (the model cache directory keeps it).
  Static link adds ~26 MB to the binary. The ORT binaries download failed
  behind this machine's proxy (`native-tls: record overflow`) and succeeded
  with `HTTPS_PROXY` unset.
- **Desktop native path verified in a running Tauri window** (the dev shell
  pointed at a self-test page, results posted to the dev server): the real
  WKWebView reports a desktop surface, `crossOriginIsolated: true`, WebGPU
  present; the model downloaded through the page and landed in app data over
  the raw IPC; CoreML built the session in 18.6 s the first time and 2.3 s
  once its cache directory held the compiled model; recognition took 3.2 s
  cold and 0.83 s warm end to end (model run ≈ 0.55–0.65 s, decode ≈ 0.3 s),
  and read the synthetic sheet correctly (9 vertices, 16 lines); the native
  solve returned in 6 ms with the pinned polish in its termination. The Stop
  path fired after the solve had already finished, so it rests on its unit
  tests until a long solve is tried in the window.
- **Not done**: desktop route-2 numbers on Intel, Windows and Linux; the
  release runners building with `ort`; the automatic-update preference on
  desktop; DirectML on Windows.
