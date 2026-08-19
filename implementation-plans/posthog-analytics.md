# PostHog Analytics

## Goal

Instrument Ori Studio (this repo's `apps/web`, running on both the Cloudflare
Pages web deploy and the Tauri desktop shell) with privacy-hardened PostHog
product analytics, at parity with the reference implementation in
`openscad-studio`. We want to answer questions like "how many people build a
crease pattern", "which export formats are used", "how far does the image→CP
funnel get", "web vs desktop split", "which workspaces get used" — without ever
capturing user model geometry, file contents, filenames, or paths.

Parity here means *architectural* parity (central typed wrapper, consent gating,
anonymous stable id, dev/prod firewall by env absence, bucketed cardinality)
plus an event taxonomy adapted to Ori Studio's feature surfaces (tree design, CP
editing, folding/simulation, box-pleating, image CP detection, multi-format file
I/O). Ori Studio has **no AI, no OpenSCAD code, no sharing, no customizer**, so
those event families from the reference are dropped.

**Privacy scope is deliberately lighter than the reference.** openscad-studio's
two-layer scrubber exists mainly to defend against AI-prompt/code/API-key
leakage, none of which Ori Studio has. The only genuinely-sensitive user content
here is **text-tool annotation text**, **filenames/paths**, and **imported image
data**. We protect those at the source rather than porting the regex fortress:
global text/attribute masking for autocapture, targeted `ph-no-capture` on the
specific surfaces, and the discipline that our own events carry only enums and
bucketed numbers — never raw user strings. A tiny optional `before_send` stays
as a lightweight net (strip path-looking autocapture URL props), not the
reference's depth-3 sensitive-key machinery.

Non-goals: session recording, surveys, feature flags, A/B experiments, groups,
person-property `$set`, server-side (`posthog-node`) capture, Rust/Tauri-side
telemetry. All analytics is renderer-side JS, identical code path for web and
desktop.

## Approach

Port the openscad-studio architecture, which is the proven design:

- A `posthog-js` singleton `init()`-ed at module load **before** React renders.
  *(As built: we use `posthog-js` only and wrap the singleton in our own
  `AnalyticsRuntimeProvider` — no `@posthog/react`/`usePostHog`, since every
  call routes through our `useAnalytics()` context. Fewer deps, same shape.)*
- A central, dependency-injected **analytics runtime** (`AnalyticsRuntimeProvider`
  + `useAnalytics()` hook + module-level `runtimeAnalytics` singleton for
  non-React callers). Every event funnels through one `track()` wrapper that
  (a) no-ops when consent is off or the client is absent, (b) merges super
  properties, (c) dedupes errors on a 30s window. (Property hygiene is enforced
  by event discipline — enums + bucketed numbers only — not a scrub step.)
- **Consent-first**: default ON, but a Settings toggle + reactive `useLayoutEffect`
  sync that opt-in/`identify` or `reset`/opt-out live. Anonymous stable UUID in
  localStorage; `reset()` + clear on opt-out.
- **Targeted privacy** (see Goal): global `mask_all_text` /
  `mask_all_element_attributes` for autocapture, `ph-no-capture` on the
  text-tool editor / filename inputs / image previews, custom events restricted
  to enums + bucketed numbers, and an optional few-line `before_send` net. No
  sensitive-key regex, no depth-3 recursion, no double-scrub.
- **Dev/prod firewall by absence**: init reads `VITE_PUBLIC_POSTHOG_KEY` /
  `VITE_PUBLIC_POSTHOG_HOST`; if either is missing, PostHog silently never
  initializes. Keys live only in deploy/CI env, never in a committed `.env`, so
  local dev never pollutes prod.
- **Two dispatch chokepoints, not one** (verified at origin/main tip): user
  intent funnels through *two* seams, and instrumenting only the first misses the
  entire CP editor. (1) `handleMenuAction(id)` in
  `apps/web/src/commands/menuActions.ts:670` — 86 static `MENU_ACTION_IDS` plus a
  data-driven `file.openExample:<id>` prefix path — covers menu bar / keyboard /
  command palette. (2) `executeOristudioCpCommand(...)` over the ~95-operation
  `apps/web/src/lib/oristudioCpCommands.ts` registry (+ the CP tool-arm state
  machine) — covers every canvas CP tool. Wrap both with one coarse event each
  (`command invoked` / `cp tool used`), then layer a smaller set of hand-placed
  high-signal domain events on top.

Ori Studio specifics that shape the port:

- Runtime surface (`web` | `desktop`) already exists via
  `apps/web/src/platform/runtime.ts` → `getRuntimeSurface()`. Use it as the
  `runtime_surface` super property; no separate Tauri telemetry.
- Storage follows the `oristudio:` namespace + `STORAGE_KEYS` registry in
  `apps/web/src/lib/storage.ts`. The opt-out preference and the stable-id key
  go through that module.
- **i18n is a hard gate**: every new user-facing string (the settings toggle
  label/description) must be `t('ns:key', 'English default')` and run through
  `npm run i18n:extract` + translated to all 8 locales, or CI fails. This is the
  main non-obvious cost of the Settings-UI phase.
- Pageviews: web uses `createBrowserRouter`, desktop uses `createMemoryRouter`.
  `capture_pageview: true` works for web URL changes; for meaningful screen
  names we also emit an explicit `workspace viewed` event off the existing
  workspace↔URL sync (`routing/workspaceUrlSync.ts` / `currentPath()`), since
  memory-router pageviews are less useful.

## Affected Areas

- `apps/web/package.json` — add `posthog-js` (only; no `@posthog/react`).
- `apps/web/src/analytics/` (new) — `bootstrap.ts`, `runtime.tsx`,
  `stableId.ts`, `events.ts` (taxonomy types), `index.ts` (barrel), `__tests__/`.
  (No `sanitize.ts` — privacy is masking + `ph-no-capture` + event discipline.
  No `bootstrapPolicy.ts` — gating lives in the runtime singleton's no-op.)
- `apps/web/src/main.tsx` — init PostHog before render, wrap `<RouterProvider>`
  in `<PostHogProvider>` + `<AnalyticsRuntimeProvider>`.
- `apps/web/src/App.tsx` — fire `app opened`, wire `ErrorBoundary`→`trackError`,
  emit lifecycle/workspace events, mount consent-sync effect.
- `apps/web/src/commands/menuActions.ts:670` — wrap `handleMenuAction` to emit
  `command invoked` (86 ids + `file.openExample:<id>` prefix).
- `apps/web/src/lib/oristudioCpCommands.ts` / `executeOristudioCpCommand` — the
  ~95-operation CP-tool seam; wrap to emit `cp tool used`.
- `apps/web/src/lib/storage.ts` — add `analytics-opt-out` + `analytics-id` keys
  (registry now has 13 keys; same `readBoolean`/`writeBoolean` pattern).
- `apps/web/src/store/settingsStore.ts` — `analyticsEnabled` field + setter
  (copy the existing `foldWarningEnabled` toggle, not just `showWelcomeOnStartup`).
- `apps/web/src/components/SettingsModal.tsx` — privacy toggle in `GeneralTab`
  (or a new Privacy tab) + i18n strings.
- Domain event call sites: `projectSlice` (build CP, optimizers), `platform/
  fileService.ts` (open/save/export), `creasePatternSlice` (foldability checks),
  `oristudioBpSlice` + `BpOptimizerModal`, `CreaseExportDialog`, image-CP-detect
  modal/pipeline (`CpDetectImportModal`), the `/s` share flow
  (`cp-workspace/share/`), and the `simulator/` slice + export.
- Sensitive DOM surfaces — add `ph-no-capture` (CP text annotations / Lexical,
  any filename inputs, image-import previews, share-link input).
- `apps/web/src/vite-env.d.ts` (exists) — extend the `ImportMetaEnv` interface
  (don't create; note `vite.config.ts` now has a `define` block for
  `__APP_COMMIT__` — VITE_ vars still flow via `import.meta.env`, no plugin).
- `.github/workflows/deploy-web.yml` — `env:` on the build step for the two
  `VITE_` vars (prod deploy only; previews stay unset).
- `docs/analytics.md` (new) — the privacy contract.
- `AGENTS.md` — standing discipline that new user-facing features ship with an
  analytics event (added under "Common patterns → Analytics" + GUI-work step 5).

## Phases

### Phase 0 — Provisioning (out-of-band, no code)
Create a **new** PostHog project for Ori Studio in the PostHog dashboard —
separate from openscad-studio's "Default project" (id 342123), which already
ingests its events. Project creation is dashboard-only (not exposed by the MCP).
One project covers both surfaces; `runtime_surface` distinguishes web/desktop.
Capture the project API key (`phc_…`, publishable/write-only — safe to ship in
the client bundle) and the ingestion host (`https://us.i.posthog.com`, US region).

Env wiring is **at the GitHub Actions build step**, not Cloudflare Pages
settings: the web app is built by `npm run build:web` inside the
`deploy-web.yml` runner and `wrangler pages deploy` only uploads the static
`apps/web/dist`, so `import.meta.env.VITE_*` is inlined in CI. Both are exposed
as `env:` on the "Build web app" step of `deploy-web.yml` only:
`VITE_PUBLIC_POSTHOG_KEY` from a repo Actions secret of exactly that name, and
`VITE_PUBLIC_POSTHOG_HOST` as a literal — it is a public URL that ships in the
bundle regardless, and holding it in a secret only adds a way to get the name
wrong. **Leave `deploy-pr-preview.yml` unset** so PR previews stay
analytics-free (absence = disabled = the dev/prod firewall).

The firewall's blind spot is that a *production* build with an empty var looks
identical to a correct one — it deploys green and captures nothing. The first
prod deploy shipped exactly that way, because the secret was created as
`VITE_POSTHOG_HOST` while the workflow read `VITE_PUBLIC_POSTHOG_HOST`; GitHub
resolves a missing secret to the empty string, so Vite inlined
`VITE_PUBLIC_POSTHOG_HOST:""` and Rollup dropped the whole `client.init(...)`
call as unreachable. `scripts/verify-analytics-build.mjs` now greps the built
bundle for both values and fails the deploy if either is absent or empty.
Desktop (Tauri release build) needs the same two vars in its build workflow when
we want desktop analytics. **Do not** commit keys.

### Phase 1 — Core analytics runtime (no events yet)
Stand up the plumbing so nothing captures until later phases add events, but the
consent/init/scrub machinery is fully in place and unit-tested.

- `posthog-js` installed (singleton only; no `@posthog/react`).
- `analytics/bootstrap.ts`: `initializePostHog(client, options, env)` with the
  exact hardened config — `defaults`, `autocapture`, `capture_pageview: true`,
  `capture_pageleave/dead_clicks/rageclick: false`, `disable_session_recording`,
  `disable_surveys`, `mask_all_text`, `mask_all_element_attributes`,
  `person_profiles: 'identified_only'`. Guard on key+host; return `false` +
  `console.info` in DEV when absent. Include a small `before_send` net only if it
  earns its keep (see below).
- `analytics/stableId.ts`: anonymous UUID via `crypto.randomUUID()` in
  `storageKey(STORAGE_KEYS.analyticsId)`; get-or-create + clear.
- Privacy: rely on `mask_all_text` / `mask_all_element_attributes` (set in the
  init config above) + `ph-no-capture` (Phase 2) + event discipline. **No**
  `sanitize.ts` regex module. *(As built: the optional `before_send` URL net was
  skipped — neither surface exposes a filesystem path in the URL; web is an
  `https` origin and Tauri serves via a custom protocol, not `file://`. The one
  place a path could leak, an error message, is scrubbed in `fingerprintError`
  instead.)*
- `analytics/runtime.tsx`: `AnalyticsRuntimeProvider`, `useAnalytics()`,
  `AnalyticsApi` (`track` / `trackError` / `setAnalyticsEnabled`), module-level
  `runtimeAnalytics` singleton + `trackAnalyticsEvent`/`trackAnalyticsError`
  escape hatches, super-property merge, error dedupe (30s window) + domain
  inference + fingerprint, `bucketCount` helper.
- `analytics/events.ts`: TS union types for enum property values (see taxonomy).
- Super properties: `app_version`, `runtime_surface`, `has_file_system`,
  `has_native_menu`, `analytics_enabled`. (Drop the AI-specific `has_api_key`;
  add origami-relevant ones as needed.)
- Wire `<PostHogProvider>` + `<AnalyticsRuntimeProvider>` into `main.tsx`.
- Consent state: `settingsStore.analyticsEnabled` (default true) reading/writing
  `STORAGE_KEYS.analyticsOptOut`; reactive `useLayoutEffect` consent sync.
- Tests: port `bootstrap.test.ts` / `runtime.test.ts` (init gating, consent
  opt-in/out, dedupe, no-op-when-disabled).

### Phase 2 — Bootstrap + settings UI + consent
- Fire `app opened` after platform init resolves, gated by consent + client-ready.
- `ErrorBoundary` → `trackAnalyticsError` (`error_domain: 'runtime'`, fingerprint,
  handled).
- Settings toggle in `SettingsModal.tsx` `GeneralTab`:
  checkbox bound to `analyticsEnabled`, calling
  `setAnalyticsEnabled(v, { capturePreferenceChange: true })` → fires
  `analytics preference changed` then opt-in/`identify` or `reset`/opt-out.
  Add i18n strings + run `i18n:extract` + translate 8 locales.
- `ph-no-capture` on the obvious sensitive surfaces (CP text annotation Lexical
  editor, any filename input, image-import preview thumbnails).

### Phase 3 — Both command chokepoints + navigation
- Wrap `handleMenuAction(id)` (`commands/menuActions.ts:670`) to emit
  `command invoked` `{ command_id, command_group }`. Split the id on `.`/`:` to
  derive a coarse `command_group` (file/edit/cp/view/optimize/…) and strip
  data-driven payload suffixes (e.g. `file.openExample:<id>` → keep the prefix,
  bucket or drop the id). Verify no filename/path leaks into `command_id`.
- Wrap `executeOristudioCpCommand(...)` (`lib/oristudioCpCommands.ts`) to emit
  `cp tool used` `{ operation, group }` over the ~95 CP-tool operations — this is
  the CP editor's own dispatch seam and is invisible to `handleMenuAction`.
  Capture the **tool variant mode** as a property where present (e.g.
  `lengthen-color` → `lengthenColorMode`, `divide-mode` → `divideMode`), since
  the bare operation id under-describes the merged tools. Consider also a
  lightweight `cp tool armed` at the tool-arm state machine if we want
  arm→commit funnels; skip if `cp tool used` (commit) is enough.
- `workspace viewed` `{ workspace, variant }` off the workspace↔URL sync
  (`routing/workspaceUrlSync.ts`), covering design/edit/simulate + the design
  **variant** dimension (nux / treemaker / box-pleat) — a new dimension the plain
  `WorkspaceId` doesn't carry. Also cover the `/s` share route. Useful "screen"
  signal on both browser and memory routers.
- Cardinality guard: bucket/hash all data-driven suffixes (`openExample:<id>`,
  per-segment export ids, share ids) — never emit the raw id.

### Phase 4 — High-signal domain events
Hand-placed events for the moments the command chokepoint can't cleanly express
or where we want structured, bucketed properties. All counts bucketed; no
geometry, names, or contents.

- **Design / TreeMaker**: `crease pattern built` `{ node_count_bucket,
  had_conditions }` (the tree→CP core moment); `optimizer run`
  `{ kind: 'scale'|'edges'|'strain', duration_ms_bucket, succeeded }`.
- **File I/O** (`platform/fileService.ts`): `project opened`
  `{ source: 'file'|'example'|'new'|'drop' }` (welcome/canvas drag-and-drop is a
  real path now); `project saved` `{ format }`; `file exported` `{ format }` via
  `CreaseExportDialog` where format ∈ osf/tm5/tm4/cp/fold/bps/ori/orh/svg/png,
  plus its structured options bucketed to booleans (`include_folded_figure`,
  `per_segment`, `theme`). Never the filename.
- **CP editor**: `foldability checked` `{ check, passed }`; `foldability fix
  applied` `{ fix }`; `fold angles solved` `{ committed }` (the new
  Solve-Fold-Angles review/commit flow, `cp-workspace/foldAngleSolve/`).
- **Design method (NUX)**: `design method chosen`
  `{ method: 'treemaker'|'box-pleat' }` from the chooser a design tab starts on.
- **Design tabs**: `design tab opened` `{ source, open_count_bucket }`;
  `design tab closed` `{ kind, touched, open_count_bucket }`;
  `design tab reordered` / `design tab activated` `{ open_count_bucket }`;
  `design tab renamed` with **no properties at all** — the new name is
  user-authored text, in the same class as a filename. The count is bucketed on a
  tighter ladder than element counts (`[1, 2, 3, 5, 10]`), because the question is
  "does anyone open more than one, and how many".
  `workspace viewed` correspondingly stopped carrying a Design `variant`: a
  workspace holding a circle-packed design beside a box-pleat one has no single
  method, and reporting one would be a lie a funnel then gets built on.
- **Box-pleating**: `bp design action` `{ action }` (author/symmetry/pack);
  `bp optimizer run` `{ succeeded, duration_ms_bucket }` (`BpOptimizerModal`) —
  coarse, no coordinates.
- **Image → CP funnel** (`CpDetectImportModal` / `cpDetectInference`): the
  experimental high-value funnel — `cp detect started`, `cp detect completed`
  `{ duration_ms_bucket, line_count_bucket }`, `cp detect imported` /
  `cp detect cancelled`. No image data, no source filename.
- **Simulation** (`simulator/` slice): `fold simulation run` `{ trigger }`;
  `folded form exported` `{ format: 'fold'|'obj'|'stl' }`; `fold warning shown` /
  `fold warning accepted`.
- **Sharing** (`/s` route, `cp-workspace/share/`): `crease pattern shared`,
  `share link opened` `{ had_source }`. Share id hashed, never raw; URL never in
  a property.
- **Preferences**: `theme changed` `{ theme }`, `locale changed` `{ locale }`.

### Phase 5 — Docs, dev/prod firewall, CI, verification
- `docs/analytics.md`: the privacy contract — scope, full tracked-event table,
  the explicit **never-tracked** list (model geometry/coordinates, node/edge
  data, file contents, filenames, absolute paths, raw stack traces, session
  replay), safeguards, consent/storage, maintenance rules. Ground truth is code.
- `vite-env.d.ts` `ImportMetaEnv` augmentation for the two vars.
- Confirm the absence-firewall: a local build with unset vars logs the DEV
  disable notice and never calls PostHog (network-verify in the preview browser).
- CI/deploy: `VITE_` vars as `env:` on the `deploy-web.yml` build step (prod
  only; previews left unset so they don't emit prod events).
- Verify in the browser preview: prod-ish build with keys → `app opened`,
  `workspace viewed`, `command invoked`, a `file exported` all land in PostHog
  with correct `runtime_surface`; opt-out stops capture and resets identity;
  network shows no PII in payloads; `ph-no-capture` surfaces are masked.

## Checklist

Phase 0 — Provisioning
- [ ] New PostHog project created for Ori Studio (not openscad-studio's 342123); key + host obtained *(manual — dashboard; MCP can't create projects)*
- [x] `VITE_PUBLIC_POSTHOG_KEY` added as a repo Actions secret *(manual — repo settings)*
- [x] `deploy-web.yml` build step exposes both via `env:` (prod only; previews left unset) — host is a literal, not a secret
- [x] `scripts/verify-analytics-build.mjs` fails the deploy if either value is missing from the built bundle
- [ ] Stale `VITE_POSTHOG_HOST` secret deleted from repo settings *(manual — no longer read by any workflow)*

Phase 1 — Core runtime
- [x] `posthog-js` added to `apps/web/package.json` (singleton only)
- [x] `analytics/bootstrap.ts` (hardened init + key/host guard + error helpers)
- [x] `analytics/stableId.ts` (anonymous UUID in `oristudio:` storage)
- [x] masking config; no `before_send` net (unneeded); no `sanitize.ts`
- [x] `analytics/runtime.tsx` (provider, hook, singleton, error dedupe)
- [x] `analytics/events.ts` (taxonomy types + `bucketCount`) + `index.ts` barrel
- [x] super properties incl. `runtime_surface` from `getRuntimeSurface()`
- [x] `main.tsx` provider wiring (init before render)
- [x] `settingsStore.analyticsEnabled` + `STORAGE_KEYS` entries
- [x] reactive consent-sync effect
- [x] unit tests (init gating, consent, dedupe, no-op-when-disabled) — 21 pass
- [x] `tsc --noEmit` / `eslint` / `vitest` on the analytics surface green

Phase 2 — Bootstrap + settings + consent
- [x] `app opened` via a tested `useAppOpenedEvent` hook (module-guarded vs StrictMode), runtime-gated
- [x] shared `ErrorBoundary.componentDidCatch` → `trackAnalyticsError` (covers app/router/panels/overlays via `surface`)
- [x] Settings → General → Privacy toggle + `analytics preference changed`
- [x] i18n strings extracted + translated (8 locales) + stamped, `i18n:check` green
- [x] `ph-no-capture` on `CpTextEditor` content + `ShareLinkModal` URL (detect modal is canvas, covered by masking)

Phase 3 — Both chokepoints + nav
- [x] `handleMenuAction` wrapped → `command invoked` (recognized ids only; suffix stripped)
- [x] store `executeOristudioCpCommand` wrapped → `cp tool used` `{ operation, group }` (variant is already in the resolved operation id, so no separate mode prop)
- [x] `workspace viewed` via a tested `useWorkspaceViewedEvent` hook in `WorkspaceRoute` (the view component — idiomatic home; keyed on workspace+variant), incl. Design variant (`/s` is captured by `share link opened`, not as a workspace)
- [x] cardinality guard: `command_id` strips `:` suffix; `cp` operation ids are a fixed enum

Phase 4 — Domain events
- [x] `crease pattern built` `{ node_count_bucket, had_conditions }`; `optimizer run` `{ kind, succeeded, feasible }`
- [x] `project opened` `{ source: file|example|new }`; `project saved` `{ format: osf }`; `file exported` `{ format }` via a fileService decorator (covers every format, menu- and dialog-driven, on success)
- [x] `design method chosen` `{ method }` (NUX chooser)
- [x] image→CP funnel: `cp detect started` / `cp detect completed { succeeded }` / `cp detect imported` (cancel inferred from funnel drop-off)
- [x] `crease pattern shared` `{ crease_count_bucket }` / `share link opened` `{ succeeded }`
- [x] `theme changed` `{ theme }` / `locale changed` `{ locale }`
- [~] Deferred with rationale: `foldability checked/fixed` and `fold angles solved` are already captured as `cp tool used` (operations `Check1..4`/`Fix1/2`/`VertexSolveFoldAngles`); simulator use is captured by `workspace viewed { simulate }` and folded exports by `file exported { obj|stl|fold }`; `bp optimizer run`/`bp design action` — the layout optimizer opens via `command invoked (bp.optimize.layout)`, explicit run/outcome event deferred

Phase 5 — Docs, firewall, CI, verify
- [x] `AGENTS.md` analytics discipline ("new features ship with an event")
- [x] `docs/analytics.md` privacy contract (scope, event table, never-collect list, safeguards)
- [x] `vite-env.d.ts` augmentation (done in Phase 1)
- [x] absence-firewall verified in the preview: DEV console logs "PostHog disabled", zero PostHog network requests
- [x] CI/deploy env wired (`deploy-web.yml`, Phase 0)
- [x] browser verification: app loads clean, no console errors, Privacy toggle renders (Settings → General → Privacy)
- [ ] live event-flow + opt-out-resets-identity verification — needs a real key, so blocked on Phase 0 provisioning (analytics is correctly disabled locally without one)
