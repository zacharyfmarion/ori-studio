# CP detection in production: web, desktop, and mobile web

## Goal

Ship "Detect CP from Image" to real users on every surface Ori Studio has:

- **Web** (Cloudflare Pages, `oristudio.pages.dev`), with the model delivered
  reliably, cached after the first visit, and the feature switchable without a
  code change.
- **Desktop** (Tauri: macOS, Windows, Linux), faster than the web because
  inference and the solve run natively on the machine's own hardware — GPU or
  neural engine for the model, all cores for the rest — with the model inside
  the installer so nothing downloads.
- **Mobile web**, on the phones that can carry it, with a camera path and a
  crop step that works under a thumb, and an honest refusal on the phones that
  cannot.

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

Two ways past the 25 MiB cap. **A is recommended; B is worth measuring
because it also halves the download.**

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

### Phase 2 — Desktop: native inference and a native solve

The CP kernel already shows the shape: one worker API surface, two
implementations, picked in `engines/engineHost.ts`. Detection gets the same.

- **Ship the model in the installer.** `bundle.resources` carries
  `models/cp-detector/<id>/{manifest.json, model.onnx}`; the desktop build
  copies it from the location `current-model.json` names and verifies the
  sha. About 43 MiB on top of the DMG (or 21 MiB if Phase 0 validates fp16).
  No download, works offline, versioned with the app.
- **Native inference through the `ort` crate** (ONNX Runtime 1.2x) with the
  platform's execution provider: **CoreML on macOS** (Apple Silicon's GPU and
  neural engine), **DirectML on Windows**, and the CPU provider on all cores
  everywhere as the fallback. Expected order of magnitude on an M-series
  machine: hundreds of milliseconds per image against tens of seconds for
  single-threaded wasm today. The two risks are packaging and size: `ort`
  links prebuilt ONNX Runtime binaries (`download-binaries` at build time,
  or vendored static libraries), the macOS dylib must be signed and
  notarised inside the `.app`, Linux needs a glibc floor, and the runtime
  adds roughly 30–60 MB to each installer. **A spike settles this before
  anything else in the phase:** build one `cp_detect_recognize` command on
  all three release runners, notarise the macOS artifact, and time one image.
  If packaging proves ugly, `tract` (pure Rust, CPU with rayon, no GPU) is
  the fallback: no binary risk and still far faster than one wasm thread,
  but it leaves the GPU idle, which is the thing this phase exists to use.
- **Native everything else.** `oristudio-cp-detect` already holds rectify,
  decode, the solve input rebuild and the exact solver; the Tauri shell gains
  `cp_detect_*` commands over them, and `cpDetectNativeClient.ts` implements
  `CpDetectWorkerApi` the way `oristudioCpNativeClient.ts` implements the
  kernel's. The exact-solve session gets a native transport too. Stop needs a
  native path: today's Stop terminates a worker; natively it becomes a
  cancellation flag on `ExactSolveOptions` checked where the solver already
  checks its deadline, following `cp_fold_cancel`'s `AtomicU32` pattern.
- **Isolation headers on the custom protocol** via Tauri's
  `app.security.headers` (COOP/COEP), so any wasm worker that remains on
  desktop gets threads and `SharedArrayBuffer`. Cheap, and it removes the
  "desktop is the one-thread surface" trap for every other engine.
- **Threads beyond inference.** The solve is a single-threaded LM; after
  the Cuthill–McKee fix its cost is small, so parallelising the Jacobian is a
  later lever, not a blocker. Native alone is the 5× step.
- **CI.** `release.yml` builds all three platforms; the Windows job in
  `ci.yml` only tests file-format crates today and gains a check of the new
  crate. The desktop check (`check:desktop`) covers the shell.

### Phase 3 — Mobile web: minimal, honest, measured

Feasible on current phones, with limits that must be stated rather than
discovered:

- **Compute.** iOS Safari and Android Chrome honour COOP/COEP, so wasm gets
  threads; WebGPU exists on iOS 26 and recent Android Chrome and is worth
  trying first as on desktop. The unknown is memory: a 1024² UNet's
  activations on top of a 43 MiB model in a wasm heap. Measure on the iOS
  Simulator (real WebKit, reaches the dev server) and one real phone before
  promising anything.
- **The dialog under a thumb.** A capture button
  (`<input type="file" accept="image/*" capture="environment">`) beside
  Choose Image; crop handles with a 44 px hit area on coarse pointers, the
  loupe already there; the crop and review panes stacked rather than side by
  side below the phone media query; the download notice with the size and a
  confirmation on the first fetch.
- **Preflight decides.** No isolation and no WebGPU means one thread, so
  the dialog says "expect a minute" instead of hanging; under 4 GB reported
  memory it warns; a failed session creation says the phone cannot run the
  model and offers the desktop or web app instead.

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

### Acceptance

- No static file over 25 MiB in `apps/web/dist`; the deploy's smoke test
  proves the model is reachable from the deployed origin.
- Web, cold: first detection under 60 s on a 2020 laptop including the
  download; warm: under 15 s. Offline after the first download.
- Desktop, Apple Silicon: image to solved pattern under 5 s on the 22.5°
  corpus, with the GPU or neural engine reported as the active provider;
  never a download.
- Phone: either a detection with a stated expectation, or a refusal that
  names the reason; never a silent hang.

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
- `apps/tauri/src-tauri/` — `cp_detect_*` commands, a cancellation flag,
  `bundle.resources`, `app.security.headers`; a new crate for native
  inference (`crates/oristudio-cp-detect-native` or a module of the shell).
- `apps/web/src/engine/cpDetectNativeClient.ts`, `engines/engineHost.ts`,
  `engine/cpExactSolveSession.ts` — the native transport.
- `crates/oristudio-cp-compiler/src/exact_solve.rs` — a cancellation flag
  beside the deadline.
- `.github/workflows/release.yml`, `ci.yml` — runtime binaries, Windows
  check, notarisation of the added dylib.
- `RELEASE.md`, `README.md`, `docs/analytics.md`.

## Checklist

Phase 0 — model artifact
- [ ] Decide A (R2, fp32) or B (fp16 static); if B, run the box-pleat eval and
      the 563-CP benchmark on the fp16 export first and record the deltas.
- [ ] R2 bucket + Pages Function `/models/*` with immutable and CORP headers,
      preview binding, edge cache.
- [ ] `publish-model.mjs` driven by `current-model.json`, wired into
      `deploy-web.yml` (idempotent, sha-verified).
- [ ] App-side fetch with progress, sha256 verification, Cache API store,
      session from bytes; unit tests with a fake fetch and cache.

Phase 1 — web
- [ ] `cpDetect` feature id + `VITE_CP_DETECT` in both deploy workflows;
      manifest-driven availability sentence in the dialog.
- [ ] Preflight line (provider, threads, memory, cached?) before the first
      image.
- [ ] Telemetry properties and the wired `cpDetectCancelled`; Sentry surface.
- [ ] Models smoke test after deploy.

Phase 2 — desktop
- [ ] Packaging spike: one native recognize command with `ort` on the three
      release runners, notarised macOS artifact, one timed image; go/no-go on
      `ort` vs `tract`.
- [ ] Model in `bundle.resources`, sha-verified at build.
- [ ] `cp_detect_*` commands (rectify, recognize, decode, solve, rebuild),
      `cpDetectNativeClient.ts`, host selection on desktop.
- [ ] Native Stop: cancellation flag on `ExactSolveOptions`, checked at the
      deadline checkpoints; wired to the run registry.
- [ ] COOP/COEP via `app.security.headers`.
- [ ] Windows CI check of the new crate; release workflow builds and signs
      the runtime.

Phase 3 — mobile web
- [ ] Measure on the iOS Simulator and one real phone: session creation,
      inference time, peak memory; record which phones pass.
- [ ] Capture input, 44 px handles on coarse pointers, stacked panes under
      the phone query, download confirmation.
- [ ] Preflight refusals and expectations for the phone cases.

Phase 4 — rollout
- [ ] Preview with the flag; internal pass on real images.
- [ ] Prod deploy with the flag; watch the new events for a week.
- [ ] Desktop release with native detection; acceptance numbers recorded in
      this file's Outcome section.
- [ ] `RELEASE.md`, README, `docs/analytics.md`.
