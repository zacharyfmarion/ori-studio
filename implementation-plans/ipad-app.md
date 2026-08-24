# iPad App

## Goal

Put Ori Studio on an iPad, and decide in what form. This plan records the
feasibility research behind that decision, then sequences the work so that the
cheapest disqualifying questions get answered first.

Where this document states a number, it is measured unless marked as an
estimate. The adversarial verification pass overturned several first-round
findings — including a "CP detection cannot run on iPad" hard blocker that was
false — so **claims here reflect the corrected round, not the first one**.

Research method: 13 parallel investigations over this repo plus primary-source
web research, each adversarially verified by a second agent; plus direct
measurement — the app was built for `aarch64-apple-ios` and run on real iPad
simulators, and the existing web build was driven by touch on a simulated base
iPad.

## Verdict

**Feasible, and much closer than the codebase's own reputation suggests.** The
app already runs on an iPad today. What stands between here and a *good* iPad
app is one legal question and a bounded list of touch/layout defects — not an
architecture problem.

Three findings carry the decision:

1. **The engines are already portable.** All nine engine crates cross-compile
   to `aarch64-apple-ios` cleanly, first try, with **zero source changes**. No
   engine crate has a wasm-only, JS-only, or C/C++ dependency that blocks iOS;
   the `cfg` gates that exist are the right way round (`js-sys` under
   `cfg(target_arch = "wasm32")`, `rayon` under `cfg(not(wasm32))`).

2. **Tauri v2 iOS already works on this repo.** `cargo tauri ios init` +
   `cargo tauri ios build` produces an iPad app that boots and renders the real
   landing page, after **three mechanical changes** (see Phase 4). The generated
   Xcode project is iPad-correct out of the box: `TARGETED_DEVICE_FAMILY = "1,2"`,
   all four iPad orientations, and the `.osf` document type inherited from
   `tauri.conf.json`.

3. **The app is already operable by touch.** On a base iPad (A16) in portrait, in
   real WebKit, the full CP editor loads and I drew a crease with a finger — it
   snapped to both paper corners, the line count updated, and the live
   foldability checker fired. Menus open and work.

The one hard blocker is **licensing**, and it is narrow.

## The hard blocker: GPL vs the App Store

Apple's Minimum Terms force every App Store app into "a non-transferable license
to use the Licensed Application on any Apple-branded Products that the End-User
owns or controls." That is precisely the "further restriction" GPLv2 §6 forbids.
This is the clause that got VLC and GNU Go pulled in 2010–11, and it is still
there in 2026. A custom EULA does not escape it — non-transferability is a floor
Apple imposes on everyone.

Many GPL apps *do* ship on the App Store (Signal, Bitwarden, WordPress, iSH), but
every one shares a property Ori Studio lacks: **the publisher owns or controls
the copyright**, so nobody has standing to complain. Ori Studio is a distributor
of someone else's GPL work. Enforcement is triggered by a copyright holder
writing to Apple — and here there is exactly one such person, easily identified:
Robert J. Lang.

Two things make this tractable rather than fatal:

- **The shipped native binary already contains no GPL at all.**
  `cargo tree -p ori-studio` pulls only `oristudio-cp` and `treemaker-fold` —
  both `MIT OR Apache-2.0`. GPL reaches users through exactly **one lazily-loaded
  frontend chunk**, imported at a single line
  (`apps/web/src/workers/treemakerWorker.ts:19`; `grep -rn 'generated/treemaker'
  apps/web/src` returns one non-test hit). That is the entire GPL surface of the
  product.
- **The GPL surface is a leaf.** TreeMaker-derived code is **13,613 of 159,853
  Rust LOC (8.5%)**, in three crates — `treemaker-core`, `treemaker-cli`,
  `treemaker-wasm` — that **nothing else depends on**. `oristudio-cp` (the
  Oriedita CP kernel, "the bulk of the app's functionality") does not touch it.
  On the web side TreeMaker-specific code is ~6,877 of 204,528 LOC (3.4%), and
  it enters through one registry entry (`designKinds/registry.ts`), one
  connector (`engines/engineHost.ts`), and one worker
  (`workers/treemakerWorker.ts`).
- **Eleven crates inherit GPL by `license.workspace = true` with no GPL
  dependency edge — including `ori-studio` itself**, the shipped desktop binary.
  Single author, 2,725 commits. Re-declaring these is paperwork, not
  negotiation, and it should happen regardless of the iPad.
- **The ask is one person, not 230.** Lang appears to be sole copyright holder of
  the ported model code — the other two named TreeMaker developers did platform
  GUI ports, and only `tmModel` was ported. For the ALM optimizer he writes
  "Since I wrote the code myself, the code is fully distributable."

Three qualifiers on "the GPL is confined to three crates", which an audit will
hit and which I do not want to have understated:

- `crates/oristudio-bp/src/io/treemaker_import.rs` (292 lines) is a
  TreeMaker-*format* importer living inside the MIT-licensed `oristudio-bp`.
  Reading a file format is not the same as porting the model code, but this is
  the one file whose name contradicts the confinement claim and it should be
  looked at deliberately.
- `LICENSING.md`'s own table classifies `tests/fixtures` and `crates/*/testdata`
  as GPL-compatible TreeMaker fixture data. An MIT-only branch has to account for
  those too.
- **A Lang grant does not end the source-availability obligation.** If he grants
  an App Store exception rather than a relicense, the app still conveys GPL
  object code and every recipient is entitled to the corresponding source for
  that exact version. The bundle must carry `LICENSE.txt` and `NOTICE` —
  `bundle.resources` currently maps only `osf.icns`/`osf.ico`.

Separately: **ExplOri appears nowhere in `NOTICE` or `LICENSING.md`**, despite
being a registered third design kind (`designKinds/registry.ts:32`) with ten
modules and a Cloudflare Functions proxy. That is a licensing-documentation gap
independent of iPad.

**The highest-leverage action in this entire plan costs one email.** iSH's
`LICENSE.IOS` is a ready-made template: a covenant not to pursue violations
arising solely from the GPL/App-Store conflict, conditioned on continuing to
publish source and license text. That is a much smaller ask than relicensing.

Note the PWA path carries **none** of this — no Apple terms, no review, and it
can ship the full app including TreeMaker.

### Two licensing defects found on the way (worth fixing regardless)

- **`treemaker-sequence` has contradictory provenance — but it is not on the
  critical path.** `NOTICE` lists it as TreeMaker-derived; its `Cargo.toml`
  declares `MIT OR Apache-2.0`; its code imports only `treemaker-flatfold` and
  `treemaker-fold` and describes itself as original research. `LICENSING.md`'s
  GPL crate list omits it.

  What matters for the iPad: the crate is reachable **only through the GPL
  bridge**. `treemaker-wasm/src/lib.rs:19` is its sole consumer, exposing
  `sequence_plan_fold` / `sequence_analyze_fold` /
  `sequence_plan_fold_with_target`, which `workers/treemakerWorker.ts:15-17`
  wraps and `SequencePanel.tsx` renders. So **excluding the TreeMaker design kind
  removes `treemaker-sequence` along with it**, and the provenance question never
  has to be answered for an MIT-only build. It only becomes live if someone wants
  to *keep* folding-sequence in a TreeMaker-free build, which would mean
  re-homing those entry points onto a permissive bridge — its dependency graph
  already permits that. Fix `NOTICE` for tidiness, not as a gate.
- **The MIT-engine wasm bridges inherit GPL by default.** `oristudio-cp-wasm`,
  `oristudio-bp-wasm`, and `oristudio-cp-detect-wasm` all take
  `license.workspace = true` = GPL-2.0-or-later despite having **no dependency
  edge to any GPL code**. Git shows a single author across the repo, so
  re-declaring these is paperwork, not negotiation.

## What I measured on a real iPad

Base iPad (A16), portrait 820×1180pt, mobile Safari, dev build with all four
wasm bridges freshly built.

**Works unmodified:** landing page and 3D folded figure render (WebGL is fine);
the full CP editor loads — menu bar, tool rail, inspector, WebGL canvas with grid
and paper; **drawing a crease by touch works**, with snapping; the engine runs
(line count 4→5, foldability checker fired); menus open under touch.

**Broken, in severity order:**

1. **Pinch-to-zoom is missing *and destructive*.** A two-finger pinch did not
   zoom — it **drew a second crease** (5→6 lines, zoom stayed 39%). The user's
   instinctive first gesture silently corrupts their document.

   Root cause, confirmed in code: the CP canvas's only zoom inputs are **wheel
   events** (`resolveWheelGesture`, `wheelBurst`, `zoomUserCameraAt`), toolbar
   buttons, and bare `6`/`5` keyboard chords. A touchscreen produces none of
   them. The canvas calls `setPointerCapture(e.pointerId)` on the first pointer
   and has no second-pointer arbitration, so finger two starts a second draw.
   `react-zoom-pan-pinch` is wired into TreeEditor / BpPacking / DesignPanel but
   **not** the CP canvas. Repo-wide there are zero `touchstart`/`gesturestart`
   handlers.

2. **The base iPad in portrait is misclassified as a phone** — a speed bump, not
   a wall. `PHONE_MEDIA_QUERY = '(pointer: coarse) and (max-width: 820px)'` in
   `platform/mobileSurface.ts`, and a base iPad in portrait is *exactly* 820pt —
   `max-width: 820px` matches at 820. Observed: the CTA read "Open App
   (unoptimized on mobile)" rather than the normal entry.

   To be accurate about severity: there **is** a persisted one-tap escape hatch
   (`hasPhoneOverride()` / `setPhoneOverride(true)`, wired through
   `WelcomeRoute.tsx:96`), and `isWorkspaceBlocked()` is
   `isPhoneSurface() && !hasPhoneOverride()`. I tapped through it and the
   workspace opened normally. So the cost is a wrong first impression on the
   cheapest iPad — the app calls it a phone and warns it is unoptimized — not
   lost access. The module's own comment says tablets are meant to keep the app,
   so this is still an off-by-one against stated intent, and it is ~0.5 wk to
   fix. A 13" iPad Pro (1024pt) is unaffected.

3. **Hint strip collides with the foldability error banner** at this width.

4. **Touch targets ~24pt** against Apple's 44pt minimum (measured across the
   dimension work: pick targets are 12–29pt).

5. Menu items advertise `Cmd+N`/`Cmd+S` etc., meaningless without a keyboard.

**Found by code audit, not reachable in my session but equally concrete:**

- **Core CP verbs are bound to mouse buttons a finger cannot produce.**
  `CreasePatternWebglCanvas.tsx` `onPointerDown` (2748-2800) dispatches on
  `e.button === 2` for the universal erase gesture, `e.button === 1` for pan, and
  `e.metaKey` for pan. Touch always reports `button 0` with no modifiers, so
  those verbs are simply unreachable.
- **The existing narrow-viewport CSS is *anti*-touch.** `theme.css:6908-6929`
  (≤720px) shrinks the CP tool rail to 156px and its buttons to **32px**, and
  hides the rail header; `App.css:1026-1032` (≤680px) shrinks the workspace rail
  to 44px. The responsive layer that exists makes targets smaller exactly where
  fingers need them bigger.
- **iOS input auto-zoom is armed.** No control uses a ≥16px font
  (`.ui-control--sm/md/lg` are 0.75/0.85/0.95rem) and `index.html:5` sets no
  `maximum-scale`, so Safari zooms the page on every input focus — and with
  `body { overflow: hidden }` there is no clean way back.
- **No touch hygiene.** Zero repo-wide hits for `-webkit-tap-highlight-color` or
  `-webkit-touch-callout`. Every control flashes the default grey tap highlight,
  and long-press on any label raises the iOS selection callout.
- **`clamp_window_to_min` is registered on `WindowEvent::Resized` with no `cfg`
  gate** and reads `minWidth`/`minHeight` (900×640) from `tauri.conf.json`. On
  iPad every rotation and every Split View transition fires `Resized` below
  900pt, and the handler answers by calling `set_size`.
- **Binary IPC is a memory hazard.** `fileService.ts:478` receives
  `invoke<number[]>('read_binary_file')` and `:502` sends
  `Array.from(options.bytes)` — a `Uint8Array` marshalled as a JSON array of
  decimal numbers, roughly a **10–20× blowup** across the bridge.
- **No viewport meta hardening**: no `viewport-fit=cover`, and
  `env(safe-area-inset-*)` appears nowhere in `apps/web/src`.

### One architectural consequence worth stating plainly

*(Written before the Phase 4 widening landed. `isDesktopRuntime` is gone and the
surface is now `'web' | 'desktop' | 'ios'`; read the predicate below as "the app
is hosted by Tauri". The consequence itself is unchanged and deliberate — see
the `nativeCpEngine` row of `platform/capabilities.ts`.)*

**A Tauri iOS build satisfies `isDesktopRuntime()`** (it sets
`__TAURI_INTERNALS__`), so the entire frontend takes the *desktop* branch: the
native Rust CP engine (`oristudioCpNativeClient.ts`, 436 LOC, 40+ commands),
native fold cancellation, and **no CP wasm worker at all**.

This is the strongest argument for Tauri over the PWA, and it is free. Measured
on desktop: an **18 s browser wasm fold becomes ~1.5 s natively** with rayon,
byte-identical output — and `oristudio-cp` compiles for `aarch64-apple-ios`
*with* the `parallel` feature. An iPad on the Tauri path gets a roughly
order-of-magnitude faster fold than the same iPad running the PWA, plus a real
`cp_fold_cancel`.

The caveat: the iPad build then exercises a **different engine path than the
browser build**, so every `isDesktopRuntime()` branch needs auditing rather than
assuming — and the two paths need parity checking against each other.

## What turned out not to be a problem

Worth recording, because these are the fears that usually kill a project like
this:

- **App size.** All four wasm bridges total **~7.4 MB raw / ~3.5 MB gzipped**
  (`oristudio-cp` 2.14 MB, `oristudio-bp` 1.84 MB, `cp-detect` 2.20 MB,
  `treemaker` 1.21 MB). Not a constraint.
- **Engine memory.** 2.56 MiB of wasm linear memory for a 7,910-segment CP.
- **WebGL on iOS.** Verified on iPadOS 26.2 WebKit that every capability the app
  depends on is present: `EXT_color_buffer_float`, RGBA32F render targets, float
  `readPixels`, worker `OffscreenCanvas` WebGL2, `ANGLE_instanced_arrays`. The
  "iOS can't do GPGPU" worry is dead — the Origami Simulator can run.
- **CSS rigidity.** Only **4 of 5,305** declarations carry ≥200px min-widths;
  every modal is already `min(Npx, 100vw − gutter)`.
- **Pointer plumbing.** 78 `onPointerDown` vs 23 `onMouseDown`, and **zero**
  `onMouseMove`/`onMouseUp`. A `pointerType === 'touch' | 'pen'` long-press hook
  already exists for BP.
- **Platform seam.** `RuntimeSurface = 'web' | 'desktop'` with ~11 detection
  sites and 5 files importing `@tauri-apps`; `platform/features.ts` is a small
  record keyed by surface. Adding `'ios'` is a widening, not a rewrite. **Borne
  out:** the widening landed in Phase 4 and touched 13 files. One correction to
  the survey — `platform/features.ts` was *dead* (imported only by its own test),
  so it could not have carried the audit; it was replaced by
  `platform/capabilities.ts`, which is the same idea wired to real call sites and
  made exhaustive over the surface.
- **PWA storage eviction.** Home-screen web apps on iPadOS are **exempt** from
  ITP's seven-day script-writable-storage cap. The most-cited PWA objection does
  not apply.

- **iPad memory is not the phone-class ceiling it is usually assumed to be.** A
  WebKit engineer states on bug 268816 that an 8 GB iPad's WebContent process
  limit is "in the 4 GB+ range"; the binding constraint was the 2 GB typed-array
  Gigacage, since raised. The widely-cited 300–450 MB figures are from an
  **iPhone-only** table. The known macOS OOM on a 47 MB `.osf` was diagnosed in
  this repo as JSC heap behaviour under progressive accumulation, not an OS
  per-process cap — so "worse on iPad than on the Mac" has no measurement behind
  it. The risk is real; the usual stated reason for it is not.

- **CP detection is *not* blocked** — and this correction is worth money. An
  initial finding that `onnxruntime-web` cannot initialize on iPadOS was
  **refuted by direct measurement**: the probe ran on a booted iPad (A16) /
  iOS 26.2 in WebKit 605.1.15 with `crossOriginIsolated=false` and
  `SharedArrayBuffer===undefined`, and the shared 4 GiB `WebAssembly.Memory`
  allocation **succeeded**; the app's exact ORT factory then loaded with a live
  `_OrtInit`. WebKit permits shared wasm memory without exposing SAB.

  The real defect is narrower and is **ours**: this repo points at the JSEP ORT
  variant (`cpDetectWorker.ts:3-4`), which is the one broken on WebKit 26
  (400%+ CPU, runaway memory). ORT issue #26827 names the fix — point
  `ort.env.wasm.wasmPaths` at the non-JSEP `ort-wasm-simd-threaded.mjs`/`.wasm`.
  This repo already funnels that through one object at `cpDetectWorker.ts:116-119`,
  so it is a **2-line change that also halves the asset (23 MB → 13 MB)** and
  benefits the web build today. Keep the existing `webgpu → wasm` fallback:
  Safari does not expose `GPUAdapter.info.subgroupMinSize`, and a report of
  polyfilling it to force WebGPU caused a hard device restart.

One thing *is* genuinely impossible:

- **Catalyst / "Designed for iPad"** — both run iPad code on a Mac, not the
  reverse. Drop it.

### Mitigations already in the repo or the dependency tree

These deflate several estimates and should be used before anything is built:

- **The snap radius is already a user slider** with Oriedita's 2–100 bounds
  (`cpSnapRadiusSetting.ts:16-19`), and the hit radii scale with it. Defaulting
  it higher under `(pointer: coarse)` addresses much of the fingertip problem
  without touching the ratios that make the CP look right.
- **`@media (pointer: coarse)` already gates a BP packing d-pad**
  (`theme.css:7903`), and `useBpLongPressInspector.ts:39` already branches on
  `pointerType === 'touch' | 'pen'`. A coarse-pointer affordance pattern exists
  to extend — the app is not starting from zero.
- **`tauri-plugin-fs` 2.5.1 is already in `Cargo.lock`** and implements iOS
  security-scoped access end to end (automatic start/stop around each op). The
  iOS file layer is less bespoke than it looks.
- **`dockview` exposes `disableDnd?: boolean`**, right next to the
  `disableFloatingGroups` this repo already passes; `react-zoom-pan-pinch`
  exposes `panning.excluded`. Both are one-line answers to problems costed in
  weeks.
- **Playwright already ships WebKit and iPad device descriptors** and is already
  a devDependency, and `scripts/folded-grid-screenshot.mjs` already boots vite
  against a real browser. The "no way to test iPad behaviour" gap is smaller than
  it appears.
- **The Rust shell is already part-way to mobile**: `lib.rs:207` carries
  `#[cfg_attr(mobile, tauri::mobile_entry_point)]` and there are eight
  `target_os = "ios"` `cfg` arms already in the file.
- **The simulator already has a CPU fallback ladder** — `referenceSolver.ts`
  (763 LOC) implements the same `SolverBackend` interface, and
  `webglRenderSupported()` degrades to `'reference'`. A missing GL capability
  would be a performance regression, not a blocker.

The mirror image, and a real gap: **the CP canvas has no capability fallback at
all** (`desktop-platform-parity.md:98-100` — "WebGL2/regl with no capability
fallback"). The simulator has `capabilityProbe.ts`; the one canvas v1 must ship
does not.

## Options

Effort is engineer-weeks for one developer fluent in this codebase, working with
AI assistance. **These ranges are estimates**, and the per-dimension numbers in
the research overlap heavily — they must not be summed.

| Option | Effort | Risk | Verdict |
| --- | --- | --- | --- |
| **PWA / Add to Home Screen** | 1.5–3 (infra only) | low | **Ship first.** No Apple terms, no review, no GPL problem, ships the full app. Keeps cross-origin isolation the Tauri shell loses. Needs a manifest, icons, and a service worker (none exist today). |
| **Tauri v2 iOS** | 6–9 (delivery only) | medium | **The App Store answer.** Verified working. Keeps one shell, one frontend, and the native Rust engine path. Gated on licensing. |
| Capacitor / Cordova | 5–8 | medium | Strictly worse than Tauri: throws away `cp_engine.rs` (803 lines, 40+ commands) and the native client, and means maintaining two shells. |
| Native SwiftUI rewrite | **148–308 (2.8–5.9 years)** | very high | No. The FFI is the easy half (~2–3 weeks; 134 `#[wasm_bindgen]` exports). The cost is rewriting ~126k LOC of frontend and porting a GPGPU solver to Metal — and it re-opens **all four upstream parity contracts** (48–79 weeks of parity work alone). |
| **EU alternative marketplace** (AltStore PAL) | +~1 on top of Tauri iOS | medium | **The GPL-clean native route.** Distributing *on* someone else's marketplace has **no eligibility criteria** — no Dun & Bradstreet score, no letter of credit, no install minimum. Those gates apply only to *operating* a marketplace or to Web Distribution from your own site. Requires registering the marketplace in App Store Connect, adding its token, marking the app eligible, and passing notarization. Limited to EU reach. |
| Catalyst | n/a | n/a | Impossible. |

A real constraint on the Tauri path: **the generated iOS shell is almost entirely
Rust** — `gen/apple/Sources/` holds one `main.mm` that calls `ffi::start_app()`.
Anything iPad-native (UIDocumentBrowser, PencilKit hover, `UIKeyCommand`) must go
through Tauri/tao/wry or a Tauri plugin, not through a Swift layer you can just
extend. Also **measured**: the Tauri iOS webview does **not** get cross-origin
isolation even with COOP/COEP set (`crossOriginIsolated=false`,
`SharedArrayBuffer=undefined`), whereas the deployed PWA does.

## Total effort

**4–7 engineer-months** for one developer with AI assistance, to reach a good
iPad app on the App Store. That is the whole-project number and it is an
**estimate, not a commitment**. The per-dimension figures in the research overlap
heavily and must not be added together.

The phases below are sequenced so that most of that spend happens *after* the
cheap questions are answered. Phases 0–3 together are roughly 8–14 weeks and
produce a shipped iPad experience with no App Store dependency at all.

## Approach

Ship the PWA first, because it is nearly free, carries no licensing risk, and
forces exactly the touch work that every other path also needs. Use it to learn
whether anyone actually wants Ori Studio on an iPad **before** paying for App
Store distribution. Then decide on Tauri iOS with real usage data and, hopefully,
an answer from Lang.

Scope v1 as **CP editing + folded/3D viewing + reference photo**, on the MIT
Oriedita/BPS/Simulator kernels. Leave out the TreeMaker tree editor (GPL, and
`.tmd*` formats), CP detection (works, but a 13 MB runtime and a heavy model for
little v1 value), and free-form dockview panel dragging (dead under touch).

If Lang declines and cutting TreeMaker is unacceptable, **AltStore PAL is the
fallback native channel** — it takes the full GPL app to EU iPads with no Apple
EULA in the way.

The v1 shape is **Pencil-first for construction**: pick targets are 12–29pt and
CP geometry is genuinely too fine for a fingertip. Fingers get navigation,
selection, and the viewer; a Pencil gets precise construction.

## Affected Areas

- `apps/web/src/platform/` — `RuntimeSurface` widening to `'ios'`,
  `mobileSurface.ts` gate, `features.ts`, `fileService.ts`, `runtime.ts`
- `apps/web/src/cp-workspace/` — CP canvas gesture layer, pick radii, hover
  fallbacks, `CreasePatternWebglCanvas.tsx`
- `apps/web/src/components/panels/`, `WorkspaceShell.tsx`, `layoutStore.ts` —
  iPad layout, locked panes, touch target sizing
- `apps/web/src/keyboard/` — on-screen equivalents for modifier-only verbs
- `apps/web/index.html`, `apps/web/public/` — PWA manifest, icons, service worker
- `apps/tauri/src-tauri/` — `capabilities/default.json`, `lib.rs`, `Cargo.toml`,
  `tauri.conf.json` iOS section (Phase 3+)
- `LICENSING.md`, `NOTICE`, `crates/*/Cargo.toml` — license hygiene
- `.github/workflows/` — WebKit test lane, later an iOS build leg

## Checklist

### Phase 0 — Answer the disqualifying questions (days, ~1 week)

Nothing expensive should start until these are answered.

- [ ] **Email Robert J. Lang** asking for an App Store distribution exception,
      using iSH's `LICENSE.IOS` as the template. Zero engineering, longest
      wall-clock, and it changes the scope of everything downstream.
      One nuance for the wording: `tmModel` carries **no per-file copyright
      headers**, so sole authorship is not established by the artifact itself.
      Ask him to confirm he can grant across the whole ported `tmModel` surface,
      rather than assuming it.
- [ ] Decide v1 scope: Companion (view-only) vs Pencil CP studio.

**Owner's call, recorded:** dropping the TreeMaker design type is considered a
clean, low-risk excision, so the licensing blocker has an accepted fallback and
does not gate the engineering. `treemaker-sequence` rides along with it and its
provenance need not be resolved for the iPad path.

### Phase 1 — Fixes that stand alone (~1–2 weeks) — **LANDED**

Each of these is worth doing on its own merits, independent of any iPad decision.

Verified on a real base iPad (A16, portrait, mobile Safari) after the change:

| Before | After |
| --- | --- |
| Two-finger pinch **drew a spurious crease**; zoom stuck at 39% | Pinch **zooms 39% → 121%**; line count unchanged |
| — | One-finger draw still works (4 → 5 lines), snapping and foldability intact |
| Hint strip drawn **through** the foldability banner | Banner sits below the hint strip |

And on desktop (1280×720, real mouse input): drag-to-draw works, zoom unchanged,
layout unchanged, viewport toolbar present, **no console errors**. Full suite
374 files / 4426 tests green; `tsc --noEmit` and `eslint` clean;
`cargo check --workspace` clean.

- [x] Fix the 820px phone gate so iPads are never misclassified (`<` vs `<=`, or key
      off pointer + viewport differently). ~0.5 wk.
- [x] Fix `usesNativeAppMenu()` — it is `isDesktopRuntime() && isApplePlatform()`,
      and under Tauri iOS both are true, so the app would ship with **no menus at
      all**. Key off the OS, not merely "Apple". ~0.2 wk.
- [x] Fix the hint-strip / foldability-banner collision at narrow widths.
- [x] Re-declare `license` on the three MIT-engine wasm bridges; regenerate the
      `LICENSING.md` dependency inventory from the lockfile.
- [ ] Switch ORT off the JSEP variant — point `ort.env.wasm.wasmPaths` at
      `ort-wasm-simd-threaded.mjs`/`.wasm` (`cpDetectWorker.ts:116-119`). Fixes a
      real WebKit-26 defect (400%+ CPU, runaway memory) and halves the asset
      23 MB → 13 MB **on the web build today**. Keep the `webgpu → wasm`
      fallback. ~2 lines.
- [x] The 22.58 MiB ORT wasm ships in the **production** bundle today even though
      the feature is dev-gated — Vite emits the worker chunk regardless. That is
      dead weight on the live web app right now, and would be ~23 MB of dead
      weight in an `.ipa`. Split the chunk behind the same gate.
- [x] Reconcile the two competing `isApplePlatform()` implementations —
      `platform/runtime.ts:60` (platform + userAgent) vs `lib/platform.ts:13`
      (deprecated `navigator.platform` only).
- [x] Add `ExplOri` to `NOTICE`/`LICENSING.md`.

### Phase 2 — Make touch not broken (~4–8 weeks) — **MOSTLY LANDED**

Two items remain open: the portrait layout (see below) and the hover/tooltip
fallbacks, which were not attempted.

Re-verified on the base iPad after the touch pass: pinch still zooms
(37% → 121%, line count unchanged), the tool rail and inspector controls are
44pt, and the viewport toolbar is on screen instead of clipped.

One regression the CSS pass introduced and this pass fixed, which only device
testing caught: growing the number-field steppers to 44px made a field need
`44 + 4 + 44 + 4 + 44 = 140px`, but `.control-row`'s two columns each claimed an
80px floor and the steppers are `flex: 0 0 auto` — so the field was handed 112px
and the `+` button overflowed and clipped against the panel edge. Measured at
28px of overflow. The fix lets the *label* truncate instead, because a label that
is shortened can still be read and a control the finger cannot reach is gone.
The lesson worth keeping: a media-context audit proves a rule is scoped
correctly, and says nothing about whether the result fits.

The gesture layer lives in `apps/web/src/cp-workspace/gestures/` — pure pinch
geometry, the camera application, and a pointer-arbitration state machine, all
unit-tested away from the DOM. The canvas keeps the wiring, not the rules.

**A gesture that was built and then deliberately removed:** long-press-to-erase.
It gave touch a path to the `button === 2` verb, but the arming gate could not
tell a deliberate press apart from a hesitation, and the click-based tools commit
on `pointerdown` — so one tap could produce two document mutations, and pausing
mid-draw destroyed a crease. Two independent reviewers rated it a high-severity
defect. Erase on touch is a tool-rail selection (the Delete group), which is
honest, and no gesture on the canvas competes with pan/zoom. **Do not
reintroduce a long-press on the canvas.**

- [x] **Multi-touch arbitration + pinch/pan on the CP canvas.** The destructive
      pinch is the single worst defect. ~4 wk.
- [x] Give the mouse-button-bound verbs a touch path: `button === 2` (erase),
      `button === 1` / `metaKey` (pan). Touch only ever reports `button 0`.
- [x] Raise the default snap radius under `(pointer: coarse)` — cheapest
      meaningful win against the 12–29pt pick targets.
- [x] Fix the anti-touch narrow-viewport CSS (≤720px shrinks tool-rail buttons to
      32px; ≤680px shrinks the workspace rail to 44px).
- [x] Touch hygiene: `-webkit-tap-highlight-color`, `-webkit-touch-callout`,
      `user-select` on the 98 controls.
- [x] Prevent iOS input auto-zoom (≥16px control fonts, or a viewport policy) and
      add `viewport-fit=cover` + `env(safe-area-inset-*)`.
- [x] Touch target pass to 44pt across the tool rail and controls. ~3 wk.
- [x] Give the CP canvas a capability fallback — today it has none, unlike the
      simulator.
- [x] Portrait layout: stop starving the canvas. Done the way this entry called
      for — a layout that drops to one pane plus a drawer, not more CSS. Under
      `(pointer: coarse)` the View pane is no longer docked at all
      (`reconcileViewPanel` in `store/layoutStore.ts` removes it, and dockview
      takes the emptied group with it, so the canvas gets the 260px back), and
      `WorkspaceViewDrawer` reaches it from a pill floating over the canvas's
      top-right corner. Covers Edit and Simulate. **Design is deliberately out
      of scope**: its panes live in the active tab's own dock and persist into
      the `.osf`, so a pane-less layout written there would travel to other
      devices and other users.
      Measured on a base iPad in portrait: auto-fit zoom went 37% → 68%.

      The viewport toolbar is now a **single row** on touch, with the secondary
      verbs behind a `⋯` menu. Getting there turned up the actual cause of the
      ragged wrapping, which was not the 44pt targets everyone assumed: the bar
      is `position: absolute; left: 50%` with **no `right`**, so its shrink-to-fit
      available width is *containing block minus `left`* — half the pane. Its
      `max-width: calc(100% - …)` never bound, and `translateX(-50%)` re-centred
      the box so the cause was invisible. Measured: 247px used inside a 494px
      pane. No amount of trimming could have fixed that; the ceiling was the
      positioning. Under `(pointer: coarse)` the bar now uses
      `left: 0; right: 0; width: fit-content; margin-inline: auto`, which makes
      `max-width` actually bind and makes both-sides overflow structurally
      impossible. CP editor at 744pt went from 247×146 in three ragged rows to
      **382×50 in one**.

      Separators are now *derived* from group seams rather than authored, so an
      orphaned separator is not expressible — which is the bug class, not just
      the instance.

      One defect this shook out, found only on the device: the backdrop
      dismissed on `pointerdown`, which unmounts it inside the same commit and
      lets the browser retarget the rest of the tap to whatever is newly
      underneath. A backdrop tap over the tool rail closed the drawer *and*
      switched the active tool to Eraser — so the next canvas tap would delete a
      crease nobody aimed at. `preventDefault()` does not prevent this; it
      suppresses the compatibility mouse events, not `click`. Dismissing on
      `click` fixes it, because `click` only fires once the press has resolved
      against the backdrop. Pinned by a test.
- [ ] Tooltip/hover fallbacks — icon-only controls carry their only labels in
      hover tooltips, unreachable under touch.
- [x] Lock dockview panes and widen sashes (panel drag is dead under touch).
- [ ] On-screen equivalents for the modifier-only and keyboard-only verbs.

### Phase 3 — Ship the PWA (~1.5–3 weeks)

- [x] Web app manifest, icon set, `apple-touch-icon`, theme-color.
      Icons are generated from `apps/web/public/favicon.png` by
      `apps/web/scripts/gen-pwa-icons.sh`, which is committed so the PNGs are a
      recipe rather than opaque binaries. `index.html` also stops pointing the
      tab icon at that 1024px, 2.2 MB source.
- [x] Service worker (`apps/web/src/pwa/`), emitted by a ~60-line Vite plugin
      rather than `vite-plugin-pwa` — see the header of `sw.ts` for why a
      generated worker was the wrong trade here.

      **It does not precache, and the plan's wording above was wrong about
      that.** Measured on the real build, counting requests the server received
      on a first visit: an install-time precache re-downloaded **5.83 MB** in
      WebKit and **0 bytes** in Chromium, because a service-worker `fetch()` in
      WebKit 26.4 does not read the page's HTTP cache. Delaying the install six
      seconds changed nothing, so it is not a race. That put the entire cost on
      the platform this phase exists for, and bought nothing: registration
      happens on `load`, so a first visit has already fetched everything before
      the worker can claim it. The cache fills on the first *controlled* load
      instead — for free, from responses the page was fetching anyway.

      **With one exception, which "for free" could not cover:** the scripts
      passed to `new Worker()`. WebKit answers those out of the web process's own
      resource cache, without a network request and without a `fetch` event, so
      the worker never saw `oristudioCpWorker` and never stored it — a cache with
      every entry the editor needs bar the editor. Those five files are fetched
      explicitly now, on the first navigation the worker serves, which a first
      visit does not have: measured warm-on against warm-off, a first visit is
      byte-identical at 7,138,573 B with nothing fetched twice, and the second
      load carries the whole cost at **+187,754 B**.
- [x] Offline start and storage: verified in WebKit 26.4 (= Safari 26.4) by
      `scripts/webkit-pwa-check.mjs` — the editor boots offline with a live
      canvas and zero failed resource loads, still cross-origin isolated, at
      7.4 MB of a 1049 MB quota across 21 entries.
      `navigator.storage.persist()` exists and is called when running installed;
      it returns `false` in a headless context, and whether iPadOS grants it to a
      home-screen app is not observable from here.

      **The first version of this claim was measured through a hole.** The check
      went offline in the same page that had just filled the cache, and WebKit's
      in-process resource cache covered for the missing worker script — so the
      lane reported a working offline editor while a real relaunch would have got
      a rendered shell and a dead editor. Offline start now runs in a page that
      has never loaded the app, and the difference is not theoretical: against a
      build with the warm disabled it turns three checks red rather than one.
      Confirmed two further ways off the lane, both with the editor booting and
      zero console errors — after `Clear-Site-Data: "cache"` (Cache Storage and
      the registration survive it; 21 entries did), and with every asset served
      `no-store` start to finish, so nothing could have been in an HTTP or memory
      cache to begin with.
- [ ] **Install to a real iPad home screen** and confirm the icon, the
      standalone launch, and that `display_mode: standalone` shows up in
      PostHog. The only item left that no harness can stand in for.
- [x] Add a WebKit lane to CI — 22 checks, ~9s, in the `web-client` job. It
      catches the failures by construction: injecting the `new Response(body)`
      trap turns three checks red, un-bypassing `/s` turns two red, deleting
      `Cross-Origin-Opener-Policy` from `_headers` turns three red, and
      disabling the worker-script warm turns three red.

**Kill gate:** if nobody uses the PWA on an iPad, stop here. That is the cheap
answer to "does anyone want this", bought for ~3 weeks instead of ~6 months.
The measurement is the `display_mode` super property (`standalone` | `browser`)
on every PostHog event — a share of sessions, which an "installed" event could
never have given.

### Phase 4 — App Store via Tauri iOS (~12–20 weeks, gated on Phase 0)

- [x] The three mechanical build fixes, all **hard compile breaks**, not
      niceties:
      1. `capabilities/default.json` grants `updater:default` and
         `process:allow-restart` with no platform scoping — the `Cargo.toml`
         `cfg` guards are already there, but the capability manifest is not.
         `platforms` is a *per-capability* key, so the two moved to their own
         `capabilities/desktop.json` rather than gaining a field in place.
      2. `tauri-plugin-window-state` is an unconditional dependency, imported at
         `lib.rs:8` and registered at `:254`, but the crate's entire body is
         `#![cfg(not(any(target_os = "android", target_os = "ios")))]` — so on
         iOS the plugin resolves to nothing and the call fails to compile. Now a
         dependency under `cfg(not(any(android, ios)))`, the exact complement of
         the plugin's own gate and of `tauri-build`'s `cfg(desktop)` alias, so the
         dependency and its use site cannot drift apart.
      3. `apps/tauri/src-tauri/Cargo.toml` has **no `[lib]` section at all**, so
         the crate builds only an rlib while Tauri iOS links a static library.
         The v2 template ships
         `crate-type = ["staticlib", "cdylib", "rlib"]`.

      Verified: `cargo build --target aarch64-apple-ios -p ori-studio` succeeds
      with zero warnings and emits `libori_studio.a`, and a full
      `tauri ios build --debug --target aarch64-sim` produces a launchable
      `Ori Studio.app`.
- [x] Widen `RuntimeSurface` to include `'ios'` — and make the widening visible
      to the type system so the ~24 branch sites are audited, not guessed. Done
      by deleting `isDesktopRuntime` outright (which broke all nine of its call
      sites at once) and replacing the dead `platform/features.ts` with
      `platform/capabilities.ts` — a `Record<SurfaceCapability,
      Record<RuntimeSurface, boolean>>`, so a fourth surface is a compile error in
      every row rather than a silent inheritance. A guard test keeps bare
      `=== 'desktop'` out of everything but `platform/`, the same way
      `nativeMenuGating.test.ts` guards the menu predicate.
- [ ] iOS file layer: security-scoped URLs, `UIDocumentPicker`, and a decision on
      app-container vs Files.app documents. The four Rust file commands use bare
      `std::fs` and will not survive the sandbox. ~2–3 wk, most likely to slip.
- [ ] Autosave / session restore — iOS reaps backgrounded webviews and fires
      neither `unload` nor a reliable warning. Today work is lost silently.
- [x] Register the remaining 7 of 9 openable formats as UTTypes. In
      `tauri.ios.conf.json`, not the base config: `fileAssociations` also drives
      the *desktop* bundlers, and claiming `.fold`/`.cp`/`.bps`/`.tmd*` in Finder,
      Explorer and the Linux MIME database is a separate product decision — one
      the desktop open handler is not ready for either, since it filters
      `RunEvent::Opened` and argv down to `.osf`. Merge is RFC 7396, so the
      platform file *replaces* the array and lists all nine. Verified in the
      built bundle: nine extensions across seven `CFBundleDocumentTypes` and seven
      `UTExportedTypeDeclarations` entries.

      Two things an eventual document picker has to know. `.ori` already resolves
      to a *system* Olympus RAW type, which outranks a third-party exported
      declaration — so a filter built by mapping extension → `UTType` gets an
      *image* type for `.ori`, and building the filter from our own identifiers
      is what avoids that. And Tauri emits only `UTExportedTypeDeclarations`;
      seven of these are formats this app does not own, where
      `UTImportedTypeDeclarations` would be the correct key. Neither blocks
      anything today.
- [ ] Remove the self-updater on iOS; replace with App Store/TestFlight. Half
      done: nothing in the frontend can reach it any more (`selfUpdate` is false
      on `'ios'`, which removes the menu entry, the Settings section, the periodic
      check and the service calls), and the plugins were already `cfg`'d out of
      the iOS binary. What remains is the *replacement* — a TestFlight/App Store
      update path and whatever the UI should say instead.
- [ ] Privacy policy, nutrition labels, privacy manifest (PostHog + Sentry).
- [ ] TreeMaker excision behind a **build flag** (not a deletion) if Lang has not
      granted an exception — desktop keeps it, iPad drops it from one config,
      and it is reversible the day he replies. ~3–5 wk.
- [ ] Graceful failure opening `.osf` files containing TreeMaker designs.
- [x] `cfg`-gate `clamp_window_to_min` off iOS — otherwise every rotation and
      Split View transition fires `Resized` below 900pt and it calls `set_size`.
      Gated `cfg(desktop)` together with `tauri-plugin-window-state`, since both
      are the same claim: on mobile the window is the screen and neither its size
      nor its position is the app's to choose.
- [x] Fix `opened_osf_paths` (`lib.rs:57-67`): `url.to_file_path().ok()` discards
      the security-scoped `file://` URL and hands the frontend a bare path. The
      command and the `opened-files` event now carry `{ url, path }`; desktop
      behaviour is byte-identical and the URL survives for the iOS file layer to
      use. **Reading through the scope is still not implemented** — that is
      `startAccessingSecurityScopedResource`, and it belongs with the file-layer
      item above. This change stops the URL being thrown away before it gets
      there; it does not make an iPad open the file.
- [x] Replace the `number[]` binary IPC marshalling before it meets a large
      `.osf` on a tablet. Both directions now use Tauri's raw IPC body — a
      `tauri::ipc::Response` back, and a raw request body with the path
      percent-encoded in a header out, which is the arrangement
      `tauri-plugin-fs` uses.

      **The 10–20x in the first draft of this plan was wrong.** Measured on this
      repo's fixtures, `JSON.stringify({ bytes: Array.from(u8) })` costs **3.34x**
      on the 3.5 MB `iguana_24.osf`, **3.10x** on `box_90.osf` and **3.57x** on
      2 MiB of high-entropy bytes (the shape of a PNG export). 4x is the ceiling,
      at `"255,"` per byte — nothing can reach 10x. The cost is real but it is a
      constant factor plus a `JSON.stringify` of the whole payload (67 ms for
      2 MiB) and a multi-megabyte intermediate string on each side, not an
      order-of-magnitude blowup. This is a desktop cost today, not an iOS one.
- [x] Pin `@tauri-apps/cli` to `^2.11.0` — `apps/tauri/package.json:13` pinned
      `^2.0.0`, so a lockfile resolution below that could silently drop the
      `.osf` UTI. Note the *reason* given here does not survive checking: the
      CLI changelog puts `UTExportedTypeDeclarations` and `LSItemContentTypes`
      support in **2.9.0** (#14128), not 2.11.0, and 2.11.0's entries are about
      NSIS, Android and Wix. The pin is still right — 2.9.0 is a long way above
      `^2.0.0` — but pin it for 2.9.0's reason, and read `^2.11.0` as "the
      version this was verified on" rather than as the floor for the feature.
- [ ] Decide device family: iPad-only (`TARGETED_DEVICE_FAMILY = 2`) vs Universal.
      Universal requires iPhone screenshots and puts the app on a reviewer's
      iPhone — where the 820px phone gate would block it.
- [x] Ship `LICENSE.txt` + `NOTICE` in `bundle.resources` (GPL source-availability
      survives a Lang grant). Verified present at `Ori Studio.app/assets/` in the
      iOS bundle. **Nothing in the app surfaces them yet** — carrying the files is
      the obligation's floor, not the whole of it; see owner question 5.
- [x] `ITSAppUsesNonExemptEncryption` in Info.plist, or App Store Connect
      re-presents the export-compliance questionnaire on every upload. In
      `Info.ios.plist`, which Tauri auto-discovers beside `tauri.conf.json` for
      iOS only, so the macOS `Info.plist` is untouched. Verified `false` in the
      built bundle's plist.
- [ ] App Store Connect metadata: iPad screenshots at Apple's required sizes,
      description, keywords, category, support URL, age rating. None exists today.
- [ ] iOS CI leg: signing, App Store Connect API key, TestFlight upload. Note
      Apple has required builds against the **iOS 26 SDK since 2026-04-28**, which
      fixes the runner image at `macos-26` — a requirement, not a preference.
- [ ] Answer `LSSupportsOpeningDocumentsInPlace` / `UISupportsDocumentBrowser`.
      Xcode now warns on every build: *"The application supports opening files,
      but doesn't declare whether it supports opening them in place."* The warning
      only appeared once the document types above existed, and it is asking the
      app-container-vs-Files.app question directly — in place means editing the
      user's file where it lives, which is what needs the security scope. Answer
      it with the file layer, not before.
- [ ] Decide whether `apps/tauri/src-tauri/gen/apple/` is tracked. `tauri ios
      init` generates ~1 MB of Xcode project (`project.yml`, `.xcodeproj`,
      `Sources/`, `Podfile`, `LaunchScreen.storyboard`) plus build output. It is
      currently untracked and *not* in `.gitignore`, so `git status` will show it
      on any machine that has run an iOS build. Note the generated
      `ExportOptions.plist` is where signing settings land.

**Risks to budget for:** 43 open Tauri iOS issues, including #15367 (WKWebView
shrinks to half width after backgrounding — a hard usability bug for a design
tool). And Guideline 4.2 "minimum functionality" review risk for a webview app,
mitigated by the native integrations above plus good reviewer notes.

## Open questions for the owner

1. Has Lang ever been contacted about this port? The repo has no record, and
   everything downstream is contingency planning for a "no" that may never come.
2. ~~Is `treemaker-sequence` actually TreeMaker-derived?~~ **Answered as moot** —
   it is reachable only through the GPL bridge, so it is excluded along with the
   TreeMaker design kind. Worth fixing `NOTICE` for tidiness.
3. Is a Design workspace **without** TreeMaker a coherent product, or does the
   iPad become "the CP editor"? (Note this also drops the folding-sequence
   panel, which rides on the same bridge.)
4. Pencil-required for construction — acceptable for v1, or must fingers work?
5. Does the desktop Tauri build currently meet its GPL source-availability
   obligation (written offer / license text surfaced to users)? Worth confirming
   before adding a second distribution channel.
