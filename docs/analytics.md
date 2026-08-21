# Analytics & privacy

Ori Studio sends two kinds of telemetry, and this document is the **privacy
contract** for both: what we collect, what we will never collect, and the
safeguards that keep it that way.

- **[PostHog](https://posthog.com) — product analytics.** Which features get
  used, so we can decide what to improve. Code under
  `apps/web/src/analytics/`, which is the source of truth for the exact event
  set.
- **[Sentry](https://sentry.io) — crash reporting.** Where the app broke, so we
  can fix it. Code under `apps/web/src/monitoring/`. Errors only: no tracing, no
  profiling, no session replay.

**One switch governs both.** Settings → General → Privacy is a single toggle;
opting out of usage analytics also stops crash reports.

The browser build and the Tauri builds share the same renderer code, so one
implementation covers all of them. A `runtime_surface` property/tag (`web` |
`desktop` | `ios`) distinguishes them. `ios` is a Tauri build on iPadOS/iOS: it
has the same IPC bridge as `desktop` and none of the window chrome, so it is a
third value rather than a flavour of the second.

## Principles

- **Off by default in development.** Analytics initializes only when both
  `VITE_PUBLIC_POSTHOG_KEY` and `VITE_PUBLIC_POSTHOG_HOST` are present at build
  time; Sentry only when `VITE_PUBLIC_SENTRY_DSN` is. Local and PR-preview
  builds don't set them, so nothing is ever captured there. This "absence =
  disabled" firewall is deliberate — see
  `implementation-plans/posthog-analytics.md`.
- **Anonymous.** We `identify()` with a random UUID generated and stored only in
  this browser (`localStorage`, key `oristudio:analytics-id`). It is never
  derived from anything about the user. Opting out deletes it; opting back in
  mints a new one, so the two sessions are not linkable. Sentry uses the *same*
  id as its `user.id`, so a crash and a session are correlatable without either
  system knowing who the user is.
- **Opt-out, honored immediately.** Settings → General → Privacy has a toggle
  (default on). Turning it off sends a final `analytics preference changed`
  event, then resets identity and stops all capture — including autocapture. For
  Sentry it flips the `beforeSend` gate to drop every event, clears the identity,
  and clears the breadcrumb buffer so activity from before the opt-out cannot
  ride along on a later report.
- **No product behavior depends on analytics.** Every event is a no-op when
  disabled or uninitialized; nothing is gated on it.

## What we never collect

This is the hard line. None of the following is ever sent, by any event or by
autocapture:

- **Text-tool / annotation text** — anything the user types onto a crease
  pattern (the Lexical editor is marked `ph-no-capture`, and global
  `mask_all_text` masks autocapture besides).
- **Filenames and file paths** — not on open, save, or export. Exports report a
  `format` (the extension kind), never the name. Error fingerprints strip
  path- and filename-shaped tokens.
- **Geometry, coordinates, measured values, node/edge data** — no crease
  positions, tree structure, angles, lengths, or counts beyond coarse buckets.
- **Image data** — the CP-from-image flow never sends the source image; it
  renders to a `<canvas>`, which autocapture cannot read.
- **Share-link URLs** — the URL encodes the pattern geometry, so it is
  `ph-no-capture` and never a property value. Sentry reduces every URL it would
  send to origin + path, dropping the query and hash; `blob:` and `data:` URLs
  collapse to just the scheme, since either can inline a whole image.
- **Raw error messages** — PostHog gets only a normalized, path-scrubbed
  fingerprint and a coarse domain. Sentry gets the exception *type* and a
  message run through the same redaction, so a message reads `cannot open
  <file>` rather than naming the model.
- **Session replay / recordings and surveys** — disabled at init in PostHog;
  never installed in Sentry.

**Stack traces are the one exception, and they are sent — to Sentry only.** This
is the deliberate trade the crash reporting exists to make: a stack frame names
*our* function, module and line, not the user's work, and without it a crash
report says only that something broke somewhere. The rule the code enforces is
**stack frames are ours, free text is theirs** — frames travel intact, anything a
message or breadcrumb interpolated is redacted. If a message ever needs to be
readable, add the specific fact as a bounded tag rather than loosening the
redaction.

More generally, custom event properties are restricted to **enums and bucketed
numbers**. Raw strings from user content are never a property value.

## Safeguards

| Safeguard | Where |
| --- | --- |
| `mask_all_text` + `mask_all_element_attributes` on autocapture | `analytics/bootstrap.ts` init |
| Session recording + surveys disabled | `analytics/bootstrap.ts` init |
| `ph-no-capture` on the text editor + share-link URL | `cp-workspace/CpTextEditor.tsx`, `cp-workspace/share/ShareLinkModal.tsx` |
| Redaction of URLs / paths / filenames / quoted text / numbers | `redactSensitiveText` in `lib/redact.ts` — one implementation, shared |
| Error fingerprints built from that redaction | `fingerprintError` in `analytics/bootstrap.ts` |
| Enum + bucketed properties only | `bucketCount` in `analytics/events.ts`; call-site discipline |
| Consent gating (no-op when off/absent) | `analytics/runtime.tsx` |
| Every Sentry event scrubbed before send | `scrubEvent` / `scrubBreadcrumb` in `monitoring/scrub.ts` |
| Sentry consent gate (`beforeSend` returns null when off) | `isMonitoringConsented` in `monitoring/runtime.tsx` |
| `sendDefaultPii: false`, no tracing, no replay | `monitoring/bootstrap.ts` init |
| `BrowserSession` integration removed | `monitoring/bootstrap.ts` — session pings bypass `beforeSend`, so consent could not stop them |
| `sendClientReports: false` | `monitoring/bootstrap.ts` — drop-count reports are still traffic from an opted-out user |

## How it's wired

All analytics goes through the central layer — **never call `posthog.capture`
directly**:

- `useAnalytics()` for components; `track(...)` / `trackAnalyticsError(...)` for
  non-React callers (a module-level singleton set by the provider).
- Two low-effort chokepoints cover most usage automatically: `handleMenuAction`
  (`command invoked`) for menu/keyboard/palette actions, and the store
  `executeOristudioCpCommand` (`cp tool used`) for CP editor tools. Actions that
  flow through these do **not** get a second hand-placed event.

**Folding is the documented exception**, and it is worth knowing why so nobody
"deduplicates" it later: `G` reaches neither chokepoint. `handleCpShortcutAction`
recognizes the fold chord and calls the store action directly, *before*
`handleCpToolAction` runs, so there is no `cp tool used`; and the toolbar button
calls the same store action, so there is no `command invoked` either. Every
`fold *` event is hand-placed for that reason.

## Crash reporting (Sentry)

Project `ori-studio` in the `zachary-marion` org. All of it goes through
`apps/web/src/monitoring/` — **never import `@sentry/react` directly.**

**What reaches Sentry.** Unhandled errors and promise rejections, via Sentry's
own global handlers; plus every error an `ErrorBoundary` catches, reported
explicitly from the one boundary implementation. Those two are not redundant:
a boundary catch is invisible to the global handlers precisely because the
boundary did its job, so without the explicit report the app's *contained*
crashes — the ones a user actually survives and keeps using — would never be
seen.

The same boundary also fires PostHog's `app error`. That is deliberate, and not
double-counting: PostHog answers *how often, and does it correlate with
anything*; Sentry answers *where*.

**Every event carries** the `release` (`ori-studio@<version>+<commit>`, matching
the "Copy details" build string in the error fallback) and the tags
`runtime_surface`, `app_version`, `app_commit`, and `surface` (the boundary's
stable id, e.g. `panel:crease-pattern`). Boundary reports also carry the React
component stack.

**Sourcemaps.** Production stacks are un-minified, via `@sentry/vite-plugin` in
`apps/web/vite.config.ts`. Three things about that setup are load-bearing:

- **The release name is the join key.** Sentry symbolicates only when the release
  an event reports matches the release the maps were uploaded under, so
  `vite.config.ts` computes `ori-studio@<version>+<commit>` once and stamps it
  into both the upload and the bundle (via `__SENTRY_RELEASE__`). Don't
  reintroduce a second copy of that format string.
- **`SENTRY_AUTH_TOKEN` gates generation, not just upload.** Without it no maps
  are emitted at all. That is what stops a PR-preview build from publishing a
  readable copy of the source to its public URL — Cloudflare Pages serves
  whatever is in `dist`. The plugin also deletes the maps after uploading, which
  it does even when the upload fails.
- **Upload failure fails the build**, via an `errorHandler` that rethrows. The
  default logs a 401 and exits 0, which would deploy green with every production
  stack minified and nothing to indicate why.

**Known gap:** this covers the main thread only. Errors inside the CP, BP,
detector and simulator workers are not captured — each worker would need its own
SDK instance. Worth doing if worker crashes turn out to matter; not done here.

**Adding a report.** Only for errors you deliberately swallow and want to see:

```ts
import { reportError } from '../monitoring';

reportError(error, { surface: 'panel:crease-pattern', handled: true });
```

Don't reach for it after a `captureException`-shaped thought — unhandled errors
are already covered, and a `try`/`catch` that recovers cleanly is usually not a
crash. If you want *frequency*, that is a PostHog event, not a Sentry one.

## Tracked events

Every event also carries the super properties `app_version`, `app_commit`,
`runtime_surface`, `display_mode`, `analytics_enabled`, `locale`, and
`locale_source`.

**`display_mode`** is `standalone` or `browser` — whether the session came off a
home screen (the installed PWA) or out of a browser tab. It is a super property
and not an event on purpose: the question is what *share* of sessions are
installed, which is the kill gate for the iPad PWA phase, and an "installed"
event could only ever count people who installed while instrumented.

**`locale` is the language the app is running in** — one of the nine codes in
`SUPPORTED_LOCALES` — and `locale_source` is `system` or `pinned`, i.e. whether
the person chose it or is following their OS. Two things it is deliberately not:

- Not the `locale changed` event. That fires when someone goes looking for the
  language switcher, which is a handful of people; it cannot tell you what
  language everyone else is reading.
- Not PostHog's automatic `$browser_language`. That is what the browser asked
  for, *before* `normalizeLocale` maps it onto a language we ship — an `it-IT`
  browser reads as Italian there while the app in front of that person is in
  English. Both are worth keeping: the gap between them is demand for a locale
  we don't have yet.

| Event | Properties | Fires when |
| --- | --- | --- |
| `app opened` | — | App launch |
| `app error` | `error_domain`, `operation`, `source_component`, `handled`, `fingerprint` | An error boundary catches (`handled: true`), or an uncaught window error / unhandled rejection reaches `GlobalErrorReporter` (`handled: false`, `source_component` `global:error` / `global:unhandledrejection`). Deduped over 30s **per surface** |
| `analytics preference changed` | `enabled` | The privacy toggle changes |
| `command invoked` | `command_id`, `command_group` | A menu / keyboard / palette action (recognized ids only; data suffixes stripped) |
| `cp tool used` | `operation`, `group` | A CP editor operation executes |
| `workspace viewed` | `workspace` | The active workspace changes. Design carries no `variant`: it holds tabs, so it has no single method to name |
| `crease pattern built` | `node_count_bucket`, `had_conditions` | A tree is compiled to a CP |
| `optimizer run` | `kind`, `succeeded`, `feasible` | A TreeMaker optimizer runs |
| `project opened` | `source` (`file`/`example`/`new`) | A project is opened/created |
| `project saved` | `format` (`osf`) | A project is saved |
| `file exported` | `format` | An export writes a file |
| `design method chosen` | `method` (`treemaker`/`box-pleat`) | The NUX design chooser |
| `design tab opened` | `source` (`strip`/`duplicate`/`file`/`replace-last`), `open_count_bucket` | A design tab is created |
| `design tab closed` | `kind`, `touched`, `open_count_bucket` | A design tab is closed |
| `design tab renamed` | — | A design tab is renamed. **No properties**: the new name is user-authored text |
| `design tab reordered` | `open_count_bucket` | A design tab is dragged or moved to a new position |
| `design tab activated` | `open_count_bucket` | The user switches to another design tab |
| `bp pattern not found` | `stretch_count_bucket`, `max_flap_count_bucket`, `configuration_reach` (`none`/`partial`/`all`) | A BP packing shows flap overlaps with no crease pattern. Stretch ids are flap ids joined with commas, so they are a local change key only and are never sent |
| `bp flap resized` | `handle` (`edge`/`corner`), `radius_changed` | A flap was resized by dragging one of its handles. Fired once per gesture, on release, and only when something actually moved — never per pointer sample. No sizes: a flap's width, height and radius are measured values about someone's design. `radius_changed` says whether the rule that prefers the radius actually fired, which is the only thing worth knowing about it |
| `fold attempted` | `mode` (`flat`/`spatial`), `crease_count_bucket`, `non_classic_count_bucket` | `G`, or the Fold button, on a non-empty foldable selection. `mode` is decided from the **scoped** selection, before any dialog |
| `fold completed` | `mode`, `verdict` (`folded`/`no-solutions`/`contradiction`/`not-drawable`/`simulated`/`cancelled`/`halted`/`error`/`local-crossing`/`transversal-crossing`/`no-layer-order`), `solution_count_bucket`, `elapsed_ms_bucket`, optional `refusal`, optional `order_reason` | Every terminal branch of a fold, so it pairs one-to-one with `fold attempted`. `refusal` is the kernel's `Fold3dRefusal` code (ten values) and rides on the `simulated`/`cancelled` arms, which is how a refusal keeps its reason without a verdict of its own; `order_reason` is the `Fold3dOrderReason` code (eight values) on `no-layer-order`. `halted` is the user stopping a *running* fold, kept apart from `cancelled` (declining a dialog before any work happened) because the difference between the two is the whole point of measuring this. `elapsed_ms_bucket` is measured from the press, on its own ladder (up to an hour) rather than the shared duration one, and rides on every verdict — "how long people tolerate" is only readable against "how long folds take" |
| `fold solution cycled` | `direction` (`next`/`wrap`), `solution_count_bucket` | The one solution verb on a folded figure |
| `folded figure orbited` | none | A 3D folded figure was turned by dragging it. Fired once per drag, on release, and only when the camera actually moved — never per pointer move, and never with an angle: a yaw/pitch pair is a measured value about someone's design |
| `folded figure zoomed` | none | A 3D folded figure's window was zoomed with the wheel. Fired once per burst, when the wheel goes quiet, on the same terms as the orbit — no zoom factor, for the same reason |
| `folded figure rehydrated` | `trigger` (`background`/`press`), `outcome` (`adopted`/`refused`) | A 3D figure reopened from a file was refolded so it can be turned again. Fired only when a fold was actually attempted — never for a figure the rules skip — and it is the only signal there is that this worked, because the whole process is deliberately invisible. `refused` means the refold did not reproduce the picture on screen, so it was discarded |
| `foldability checked` | `source` (`pre-fold`), `had_violations`, `violation_count_bucket` | The CAMV check a fold runs before folding |
| `fold warning shown` | `source` (`pre-fold`) | That check found violations and the warning was raised |
| `fold warning accepted` | `source`, `accepted`, `suppressed_future_warnings` | The user answered that warning |
| `fold simulation run` | `source` (`fold-3d-refused`/`fold-3d-no-layer-order`), `crease_count_bucket` | The simulator was opened instead of a 3D fold — because the fold was refused, or because a placed figure's layers could not be ordered |
| `cp detect started` | — | Image→CP detection begins |
| `cp detect completed` | `succeeded` | Detection finishes |
| `cp detect imported` | — | A detected CP is imported |
| `crease pattern shared` | `crease_count_bucket`, `had_title`, `had_author` | A share link is published |
| `share link copied` | — | The share URL is copied |
| `share link opened` | `succeeded`, `source` | A shared link is opened |
| `theme changed` | `theme` | The theme is changed |
| `locale changed` | `locale` | The language is changed |
| `oriedita shortcuts imported` | `mode`, `applied_count`, `skipped_count` | An Oriedita `.oriconfig` keymap is applied |
| `cp snap radius changed` | `snap_radius` (bucketed) | The crease-pattern snap radius is changed in Settings. Bucketed, never the number: it is a continuous per-user value, and the question it answers — tighter than the default, or more forgiving — is a bucket already. Fires only on an actual change, so the event existing already means the default was left |
| `cp wheel gesture changed` | `wheel_gesture` | What an unmodified scroll does on the crease-pattern canvas is changed in Settings. An enum of two, and it only fires on a deliberate switch, so the counts read as departures from the shipped default (`zoom`) rather than as a population split |
| `view drawer opened` | `workspace` | The touch-only View drawer is opened. It has no fine-pointer counterpart — the pane is docked there — so every one of these is a touch session going looking for the view options, which is the question undocking the pane raises. No menu action reaches it, so the `command invoked` chokepoint cannot see it |

**Nothing about a 3D fold's geometry is sent.** Not the closure residual, the
loop gap, the plane separation, the crossing points, or any face, line, plane or
component index — all of them are measurements of the user's own design, and
several would identify a distinctive one outright. What leaves the app is the
bounded refusal and order-reason codes, and counts already bucketed.

**Nor is the viewpoint.** Yaw, pitch and zoom describe how somebody is looking at
their own model, which is the same class of thing as its geometry: a continuous
measurement, unbucketable without inventing a scale, and identifying in
aggregate. That is why `folded figure orbited` and `folded figure zoomed` carry
no properties at all. The useful question — *does anyone turn these figures?* —
is answered by the event existing; where they turned it to is not ours.

## Maintenance rules

- **New user-facing features ship with an event** (see AGENTS.md → Common
  patterns → Analytics). If the action dispatches through `MENU_ACTION_ID` or a
  CP operation, it is already covered — don't double-count. Otherwise add a
  hand-placed `track(...)`.
- Event names: lowercase, space-separated. Property keys: `snake_case`. Property
  values: enums and bucketed numbers only.
- Never send raw user content. When in doubt, bucket it or leave it out.
- Keep this table and the never-collect list current with the code.
- **Redaction has one implementation** (`lib/redact.ts`), shared by the
  fingerprint and the Sentry scrubber. If you need different behavior, add an
  option there rather than writing a second near-copy — the two must never
  disagree about what counts as user content.
- **Sentry tags are enums too.** A tag value is as visible as a property value;
  the same "no raw user content" rule applies.
