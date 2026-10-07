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

The browser build and the Tauri build share the same renderer code, so one
implementation covers both. A `runtime_surface` property/tag (`web` | `desktop`)
distinguishes them.

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

### Filtering yourself out

Analytics is anonymous, so there is no email to exclude and the stable id is
re-minted whenever storage is cleared. To keep your own use of the production
app out of the numbers, open it once with **`?internal=1`** on the URL
(`https://oristudio.dev/?internal=1`). `analytics/internalUser.ts` persists the
flag, strips the parameter, and from then on every event from that browser
carries `internal_user: true`. `?internal=0` clears it. Do it per browser
profile, and again after clearing site data. The desktop app has no address
bar; opt out of analytics in Settings ▸ Workspace ▸ Privacy there instead, or
set `oristudio:analytics-internal-user` to `true` in its web inspector.

On the PostHog side, the project setting *Filter out internal and test users*
is `internal_user is not set` (plus the developer's pre-flag device id, which is
how the history before the flag existed stays excluded), new insights default
to that filter, and every tile on the Product Overview and Crease-Pattern
Detection dashboards has it on. An insight built without it counts you.

Not the SDK's own mechanism, on purpose: posthog-js sets the person property
`$internal_or_test_user` for any page whose hostname is `localhost`, and the
macOS desktop app is served from `tauri://localhost`, so its default put every
Mac desktop user in the "test users" cohort. `initializePostHog` disables that
heuristic (`internal_or_test_user_hostname: null`); the cohort it fed is legacy
and must not be used as a filter.

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
`runtime_surface`, `display_mode`, `analytics_enabled`, `locale`,
`locale_source`, `paper_display_style` and `paper_export_style` — plus
`internal_user: true` on a device marked as a developer's own, and no
`internal_user` key at all on everyone else's (see "Filtering yourself out"
below).

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

**`paper_display_style` and `paper_export_style` are the paper style each person
runs**, on the same reasoning: the `paper *` events count who went looking for a
setting, and cannot say what everyone else draws with. Each is `default` or
`diagram` (a built-in, unedited), `custom` (a preset the person saved or
imported, unedited) or `unsaved` (edited since its preset was applied, or no
preset's at all) — never a preset's name. `paper_export_style` is `linked` while
exports follow the display style. Registered from the settings store once the
app has mounted, and again whenever either changes, so an event sent before
React mounts does not carry them.

| Event | Properties | Fires when |
| --- | --- | --- |
| `app opened` | — | App launch |
| `app error` | `error_domain`, `operation`, `source_component`, `handled`, `fingerprint` | An error boundary catches (`handled: true`), or an uncaught window error / unhandled rejection reaches `GlobalErrorReporter` (`handled: false`, `source_component` `global:error` / `global:unhandledrejection`). Deduped over 30s **per surface**. A cross-origin script's `Script error.` placeholder is dropped before it gets here — the browser has already stripped everything but that message, and the script is never ours |
| `dom mutated outside react` | `blocked_method` (`removeChild`/`insertBefore`) | The translated-DOM guard blocked a call React would otherwise have thrown on (`lib/translatedDomGuard.ts`) — an in-page translator has rewrapped React's text nodes. Once per session. A count, not an error: the guard is the fix, and the session is fine |
| `browser unsupported` | `capability` (`module_workers`) | The startup probe found the browser starts a classic worker where a module one was asked for, so no engine can run; the app is replaced with `UnsupportedBrowserNotice` |
| `analytics preference changed` | `enabled` | The privacy toggle changes |
| `app update checked` | `result` (`none`/`available`/`error`), `trigger` (`automatic`/`manual`) | Every completed desktop update check, including the ones that find nothing. The heartbeat: without it "the endpoint has been unreachable for a month" and "there was no release this month" look the same. An `error` here is always paired with an `app update failed` |
| `app update available` | `trigger`, `install_kind` (`app`/`nsis`/`appimage`/`other`), `delivery` (`automatic`/`notify`/`off`) | The manifest offered a version newer than the one running. `install_kind` is the bundle format this build was installed from; `other` is a Linux package install, which is offered a download link rather than an in-place update |
| `app update download started` | `trigger`, `install_kind` | The payload download began — on the app's own schedule under `automatic` delivery, or because the user asked |
| `app update downloaded` | `trigger`, `install_kind` | The payload is on disk and verified against the key compiled into the app; only now may the UI say "Relaunch to update" |
| `app update relaunched` | `install_kind`, `pending_ms_bucket` | "Relaunch to update" was pressed; the bucket is how long the offer sat before anyone acted on it. **Undercounts**: the installer exits the process before the batched event has left, so read adoption off `app update downloaded` and the next launch's `app_version` instead |
| `app update failed` | `stage` (`check`/`download`/`install`), `reason`, `install_kind`, `trigger` | A step failed. `reason` is a closed vocabulary: `dns`, `connect`, `tls`, `proxy` and `timeout` are transport causes the shell could name from the request's error chain, and `network` is a transport failure it could not; `http_status` (the endpoint answered but not with 2xx), `parse` (the body was not a manifest) and `no_platform_entry` (no entry for this build's platform) are the published manifest's fault and therefore fleet-wide; `signature` is a payload that did not verify — the one to alert on; `stale_manifest` is an offer below a version already seen; `unsupported` and `unknown` are the remainder. Never the error text |
| `app update dismissed` | `scope` (`skipped`/`session`/`revoked`) | An offered update stopped being shown: skipped for good, snoozed for this run, or dropped because the release was un-armed while it sat downloaded |
| `command invoked` | `command_id`, `command_group` | A menu / keyboard / palette action (recognized ids only; data suffixes stripped) |
| `cp tool used` | `operation`, `group` | A CP editor operation executes |
| `workspace viewed` | `workspace` | The active workspace changes. Design carries no `variant`: it holds tabs, so it has no single method to name |
| `settings section viewed` | `section` (`general`/`appearance`/`paper`/`shortcuts`/`workspace`) | A section of the Settings dialog is on show: the one it opens on, then each one picked. Fired from the dialog, so every way in counts — the toolbar's gear calls the store directly and never reaches `command invoked`, as File ▸ Settings and its shortcut do. Who saw Settings ▸ Paper is the denominator the `paper *` events are read against |
| `site page viewed` | `page` (`download` / `oriedita` / `faq`) | A content page of the site — `/download/` and its siblings — is opened. The pages exist to be found from a search result; this is how we learn whether they are |
| `landing cta clicked` | `cta` (`discord`/`github`/`scroll`/`start`) | A call to action on the landing page is followed. `start` is the phone's "Start creating" link to `/edit`, which takes the place of the desktop download a phone cannot run |
| `desktop download started` | `build` (a build id, or `releases-page`), `surface` (`landing`/`start-screen`/`toolbar`/`about`/`download-page`), on `releases-page` only `fallback_reason` (`no_platform`/`release_unresolved`) | A desktop installer link is followed. `releases-page` means no file was handed over: `no_platform` is a device with no desktop build to recommend (a tablet, an unrecognized host), which is the control working as designed; `release_unresolved` is the GitHub lookup not having answered, and only its share says the fetch is failing. Before 2026-09-29 the two were one number, and phones made it look like an outage |
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
| `symmetry pair changed` | `design_kind` (`box-pleat`/`explori`), `action` (`pair`/`pair_all`/`unpair`), `pair_count_bucket` | A mirror pairing was made or broken by hand — Pair with mirror, Pair all mirrored, or Unpair from mirror. These are toolbar and context-menu rows that call the store directly, so the `command invoked` chokepoint never sees them. Never which vertices: ids and positions are the user's design |
| `fold attempted` | `mode` (`flat`/`spatial`), `crease_count_bucket`, `non_classic_count_bucket` | `G`, or the Fold button, on a non-empty foldable selection. `mode` is decided from the **scoped** selection, before any dialog |
| `fold completed` | `mode`, `verdict` (`folded`/`no-solutions`/`contradiction`/`not-drawable`/`simulated`/`located`/`cancelled`/`halted`/`error`/`local-crossing`/`transversal-crossing`/`no-layer-order`), `solution_count_bucket`, `elapsed_ms_bucket`, optional `refusal`, optional `order_reason` | Every terminal branch of a fold, so it pairs one-to-one with `fold attempted`. `refusal` is the kernel's `Fold3dRefusal` code (ten values) and rides on the `simulated`/`located`/`cancelled` arms, which is how a refusal keeps its reason without a verdict of its own; `order_reason` is the `Fold3dOrderReason` code (eight values) on `no-layer-order`. `located` is the refusal dialog's offer to show the vertex it named being taken — the one value that says whether pointing at the diagnostic entry earned its place, and not a `cancelled`, because that user went to fix the pattern rather than giving up. `halted` is the user stopping a *running* fold, kept apart from `cancelled` (declining a dialog before any work happened) because the difference between the two is the whole point of measuring this. `elapsed_ms_bucket` is measured from the press, on its own ladder (up to an hour) rather than the shared duration one, and rides on every verdict — "how long people tolerate" is only readable against "how long folds take" |
| `fold solution cycled` | `direction` (`next`/`wrap`), `solution_count_bucket` | The one solution verb on a folded figure |
| `folded figure styled` | `option` (`display_style`/`side`/`front_color`/`back_color`/`line_color`/`shadow`), `mode` (`flat`/`spatial`) | A row of a folded figure's Style menu was used, from the toolbar or the context menu — both bind the same catalog, so one event covers both. Fired once per adjustment: a colour drag counts when it starts, never per pointer move. Never the colour itself: a paper colour is the user's work, and the question is which rows earn their place |
| `paper style changed` | `source` (`settings`/`simulator-view-controls`/`simulator`), `slot` (`display`/`export`), `field` (`paper.front`/`paper.back`/`edges`/`mountainFolds`/`valleyFolds`/`mountainDiagramCreases`/`valleyDiagramCreases`/`foldsAsEdges`/`auxCreases.visible`/`auxCreases.pen`/`arrows`/`erode`/`light`) | A field of the app-wide paper style was edited. `source` is where: Settings ▸ Paper, the Simulate options pane's Paper and Creases rows (docked, or in the touch View drawer — the name `view drawer opened` gives that pane), or the Simulate viewport's lighting key binding and context-menu row. Once per adjustment: a colour drag counts when it starts, never per pointer move. Never the value: a colour, a pen width or a light angle is the user's work. The question is which fields earn their rows, from where, and whether the export slot is ever set apart from display |
| `paper preset applied` | `slot` (`display`/`export`), `preset` (`default`/`diagram`/`custom`) | A whole preset was applied to a slot. `custom` stands for any preset the user saved or imported — never its name. A high `custom` share says the built-ins do not cover what people want |
| `paper preset unsaved changes` | `slot` (`display`/`export`), `choice` (`save`/`update`/`discard`/`cancel`) | A preset was picked in Settings ▸ Paper while the slot held edits no preset holds, and the user was asked what to do with them: keep them as a preset of their own first, write them into the saved preset they were made to (`update`), throw them away, or stay put. How often edits are discarded versus kept says whether the prompt earns its interruption |
| `paper preset updated` | `slot` (`display`/`export`) | A saved preset was overwritten with the slot's edits to it, from the Update beside Revert or the unsaved-changes prompt. Only a preset the user saved or imported — a built-in is never written to. Whether people refine a preset of their own or save a new one each time |
| `paper preset exported` | `slot` (`display`/`export`), `source` (`button`/`card`), `preset` (`default`/`diagram`/`custom`), `unsaved` | A preset was written to a `.json` file from Settings ▸ Paper: by Export… under the preset list (`button`), which writes the style the slot is showing, or by a card's own download icon (`card`). `unsaved` marks an Export… of a style no saved preset holds — edited since its preset was applied, or nobody's — which is named for the file there; it then counts as `custom`. Never the name. Button against card says whether the hover-only icon was ever how people found export. The file service's `file exported` fires for the same save |
| `paper preset saved` | `slot` (`display`/`export`) | The slot's style was kept as a preset of the person's own, from Save current as… or the save the unsaved-changes prompt leads to. Never the name. A name the store refuses (blank) saves nothing and counts nothing. Against `paper preset applied { preset: custom }`, whether the presets people make get used again |
| `paper preset imported` | `slot` (`display`/`export`), `succeeded`, on failure `reason` (`invalid-json`/`not-a-preset`) | A preset file was read in Settings ▸ Paper. A dismissed file picker read nothing and counts nothing. A read preset is added to the list; applying it then counts as `paper preset applied { preset: custom }`. `reason` is the parser's own code, never the file's contents or name |
| `paper export link changed` | `linked` | The export style was detached from the display style (`linked: false`, Detach) or set to follow it again (`linked: true`, Follow display). Whether anyone wants exports to look different from the screen at all; `paper_export_style` says how many run that way |
| `paper style overridden` | `surface` (`inline-simulation`/`folded-3d`/`folded-flat`), `field` (as above), `reset` | A document object — a folded figure or an inline simulation window — had a paper-style field pinned on it, or the pin cleared (`reset: true`) so it follows the app style again. From its Properties sheet or the folded Style menu. Per-object pins are the case the style's override design exists for; this is how often it happens at all |
| `paper export opened` | `surface` (`simulator`/`inline-simulation`/`folded-3d`/`folded-flat`/`references`), `scope` (`this`/`all`) | The export dialog opened on a paper surface's picture: the first step of the funnel whose last is `paper exported`. Its triggers are toolbar, context-menu and right-rail verbs the menu chokepoint does not see, so it is placed by hand. `scope` is what it opened on: the page on show, or — from References' *Export all steps…* — every step. Opened against exported says whether the dialog is a step people take or one they abandon |
| `paper export dismissed` | `surface` (as above), `scope` (`this`/`all`), `last_save` (`none`/`cancelled`/`failed`/`stopped`) | The reader closed the export dialog — its close or Cancel — without writing a file: the funnel's other ending, so every dialog the reader ends is one `paper exported` or one of these. `last_save` is how the last press of Export went: never pressed, the save dialog dismissed, the save failed, or the dialog closed while a ZIP's pages were still painting. A change of mind, told apart from something in the way |
| `paper export failed` | `surface` (as above), `format` (`svg`/`png`), `scope` (`this`/`all`) | A save from the export dialog threw. The dialog shows the message and stays open; this counts every failure — a retry that then succeeds included — and the error itself goes to Sentry (`surface: paper-export`). Never the message |
| `paper exported` | `surface` (`simulator`/`inline-simulation`/`folded-3d`/`folded-flat`/`references`), `format` (`svg`/`png`), `hidden_faces` (`kept`/`dropped`), `style` (`export-style`/`default`/`diagram`/`custom`), `background` (`transparent`/`colour`), `resolution` (`1x`/`2x`/`3x`/`4x`/`300`/`600`/`custom`, `none` for an SVG), `options_changed` (`yes`/`no`), `scope` (`this`/`all`), `page_count_bucket` (`<=5`/`<=10`/`<=25`/`>25`, for `all` only), `letters` and `highlights` (`shown`/`hidden`, for `references` only) | A paper surface's picture was saved as an image from the export dialog, through the shared painter — the page the dialog previewed. Every paper surface goes through it: References steps, folded figures (3D and flat), and simulations in the Simulate view and in inline windows. A folded figure saved before its picture could be repainted exports as it was drawn, and still reports its options as the dialog held them. `style` is the dialog's style picker: the Settings export slot, a built-in preset by id, or `custom` for any preset the user saved or imported — never its name. `hidden_faces` is the "Keep hidden faces" option (kept for a PNG, and for a surface with nothing buried), `resolution` the PNG density as the picker names it. `options_changed` is whether anything in the dialog was touched before saving, which says whether the dialog earns its step. `scope` is `all` for every step of a References sequence or candidate saved as one ZIP, with how many pages it held in buckets. `letters` and `highlights` are References' two diagram options — the names of the points a step refers to, and the accent over the lines it lines up — and are sent only for References, the one surface that offers them: whether people export steps bare for diagrams of their own. Never a colour, a size or a name. The file service's `file exported` fires for the same save |
| `folded figure orbited` | none | A 3D folded figure was turned by dragging it. Fired once per drag, on release, and only when the camera actually moved — never per pointer move, and never with an angle: a yaw/pitch pair is a measured value about someone's design |
| `folded figure zoomed` | none | A 3D folded figure's window was zoomed with the wheel. Fired once per burst, when the wheel goes quiet, on the same terms as the orbit — no zoom factor, for the same reason |
| `folded figure rehydrated` | `trigger` (`background`/`press`), `outcome` (`adopted`/`refused`) | A 3D figure reopened from a file was refolded so it can be turned again. Fired only when a fold was actually attempted — never for a figure the rules skip — and it is the only signal there is that this worked, because the whole process is deliberately invisible. `refused` means the refold did not reproduce the picture on screen, so it was discarded |
| `foldability checked` | `source` (`pre-fold`), `had_violations`, `violation_count_bucket` | The CAMV check a fold runs before folding |
| `fold warning shown` | `source` (`pre-fold`) | That check found violations and the warning was raised |
| `fold warning accepted` | `source`, `accepted`, `suppressed_future_warnings` | The user answered that warning |
| `fold simulation run` | `source` (`fold-3d-refused`/`fold-3d-no-layer-order`), `crease_count_bucket` | The simulator was opened instead of a 3D fold — because the fold was refused, or because a placed figure's layers could not be ordered |
| `cp detect image loaded` | `source` (`picker`/`drop`/`canvas-suggestion`), `paper_found` | An image reached the Detect dialog and was rectified. `paper_found` is whether the paper's outline was found automatically, which is the auto-crop's hit rate |
| `cp detect rights answered` | `accepted` | The rights gate between an image loading and Detect was answered: `true` is Continue, `false` is Back to the picker. A close at the gate is a `cp detect dismissed` at `confirm` instead, not a `false` here. No "shown" event — every `cp detect image loaded` shows it |
| `cp detect image scored` | `verdict` (`likely`/`unlikely`), `score_bucket` (`<0.5`/`0.5-0.8`/`0.8-0.9`/`0.9+`), `ms_bucket` | A reference image added to the Edit canvas was scored by the crease-pattern likelihood gate. The denominator for the offer below, and the field false-positive rate by proxy: read the acceptance rate per bucket. Nothing about the image itself |
| `cp detect suggested` | `score_bucket` | The "Looks like a crease pattern — Detect creases" pill was shown on an image |
| `cp detect suggestion accepted` | `score_bucket` | Detect pressed on the pill; the dialog then emits `cp detect image loaded` with `source: canvas-suggestion` |
| `cp detect suggestion dismissed` | `score_bucket`, `dismissals_bucket` (`1`/`2`/`>=3`) | × pressed on the pill. `dismissals_bucket` counts this session's dismissals, which is what decides whether the one-time "you can turn this off" toast showed |
| `cp detect started` | — | Image→CP detection begins |
| `cp detect dismissed` | `stage` (`upload`/`confirm`/`crop`/`detecting`/`review`) | The dialog was closed without importing, and where it stood. The funnel's drop-off, counted rather than inferred |
| `cp detect completed` | `succeeded`, on failure `reason` (`registry_unavailable`/`registry_invalid`/`download_failed`/`integrity`/`worker_lost`/`inference`), on success optional `execution_provider` (`webgpu`/`wasm`), `wasm_threads_bucket`, `session_create_ms_bucket`, `inference_ms_bucket`, `model_source` (`installed`/`downloaded`) | Detection finishes. The runtime facts ride only on success: which provider ran, how many wasm threads it had, how long the session took to build and the inference to run, and whether the model's bytes were already on the device — the spread across devices is the point of measuring |
| `cp detect imported` | `mode`, `outcome`, `repair_sites` (bucketed) | A detected CP is imported. `outcome` is how the pattern came out — the five solver endings under their own names (`solved`, `ambiguous`, `timeout`, `rejected`, `malformed`), plus `recognized` (not solved, because the topology was flagged) and `cancelled`. `ambiguous` is the one to watch: the solver kept its answer and the pattern got better, but not to the precision the foldability check holds, so it is an improvement rather than a success. `mode` is which button was pressed, and the two are separate on purpose: `reviewAndFix` with `outcome: solved` is a clean solve declined in favour of steering it by hand (pin, move, solve again in the document) |
| `cp detect cancelled` | `kind` (`region`/`detect-import`/`command`), `stage`, `duration_ms_bucket` | A running exact solve was stopped by the user. Deliberately not a verdict on `cp exact solve completed` — a stopped run reached none of the solver's endings, and counting it there would put it in the feature's failure rate |
| `cp detect model download failed` | `source` (`settings`/`update`), `code` (the model store's own code) | A download asked for by hand did not verify. A first run's failing download is a `cp detect completed` failure instead |
| `cp exact solve resolved` | `resolution` (`accepted`/`accepted-partial`/`retried`) | The Accept / Try again gate on a solved region was answered. A solve neither accepted nor retried — the region deleted, or the document edited under it — sends nothing, so "abandoned" is `cp exact solve completed` minus this event |
| `cp detect model downloaded` | `source` (`first-run`/`update`) | A detector model's bytes arrived and verified — on the first Detect of a device, or when an offered update was taken. The model id is deliberately not sent as a property; `cp detect completed`'s buckets already split by device, and the registry knows what was current when |
| `cp exact solve completed` | `verdict`, `stage`, `reason`, `duration_ms_bucket`, `moved_vertices_bucket` | An exact solve reached a verdict, however it ended. `reason` is one of the solver's own fixed tokens, never its prose; the blocker messages on a malformed input name the user's geometry and are never sent |
| `crease pattern shared` | `crease_count_bucket`, `had_title`, `had_author`, `folded_figure` (`none`/`export-style`/`default`/`diagram`/`custom`) | A share link is published. `folded_figure` is the style the card's folded figure was drawn in — the Settings export slot or a preset by kind, never its name — or `none` when the card shows no figure |
| `crease pattern exported` | `format` (`svg`/`png`), `folded_figure` (`none`/`export-style`/`default`/`diagram`/`custom`) | A crease pattern is saved as an image from its export dialog. `folded_figure` is the style the folded figure beside it was drawn in, or `none` without one: whether the figure is used, and whether its style picker earns its place. The menu chokepoint sees only the command; the file service's `file exported` fires too |
| `share link copied` | — | The share URL is copied |
| `share link opened` | `succeeded`, `source` | A shared link is opened |
| `community link opened` | `surface` (`toolbar`) | A link out to the community Discord is followed. The landing page's own Discord button is counted as `landing cta clicked` instead, so the two never double-count; this one exists because nothing in the workspace chrome dispatches through `handleMenuAction`, and whether an icon there is ever pressed is the only thing that says it earned its slot |
| `theme changed` | `theme` | The theme is changed |
| `locale changed` | `locale` | The language is changed |
| `oriedita shortcuts imported` | `mode`, `applied_count`, `skipped_count` | An Oriedita `.oriconfig` keymap is applied |
| `cp snap radius changed` | `snap_radius` (bucketed) | The crease-pattern snap radius is changed in Settings. Bucketed, never the number: it is a continuous per-user value, and the question it answers — tighter than the default, or more forgiving — is a bucket already. Fires only on an actual change, so the event existing already means the default was left |
| `cp wheel gesture changed` | `wheel_gesture` | What an unmodified scroll does on the crease-pattern canvas is changed in Settings. An enum of two, and it only fires on a deliberate switch, so the counts read as departures from the shipped default (`zoom`) rather than as a population split |
| `view drawer opened` | `workspace`, `pane` | The touch-only View drawer is opened, on the side pane `pane` names (`cp-view-controls`, `cp-properties`, `simulator-view-controls`, `references-view-controls`, or the Diagram's `diagram-step`, `diagram-page` or `diagram-layers`). It has no fine-pointer counterpart — the pane is docked there — so every one of these is a touch session going looking for the view options, which is the question undocking the pane raises. No menu action reaches it, so the `command invoked` chokepoint cannot see it |
| `canvas object property changed` | `object_kind` (`image`/`text`/`suppressionRegion`/`folded-figure`/`inline-simulation`), `property` (the field id, e.g. `opacity`, `displayStyle`, `check:kawasaki`) | A property of the selected canvas object was changed from the Properties pane — once per recorded change (a slider drag, a colour pick, a toggle), never per input event. The pane is the first surface editing every object kind through one renderer, so this is what says whether people edit there rather than on the floating toolbars and menus that still exist. Never a value, colour, angle or text |
| `cp tool picker opened` | — | The phone layout's tool sheet is opened. Phone-only, because that is the one layout with no tool rail, so every one of these is somebody who found the Tools pill that replaced it. `cp tool used` counts what was picked; this counts whether the surface was found at all |
| `cp tool favorited` | `action`, `favorited`, `source`, `favorite_count_bucket` | A CP tool is starred or un-starred. Fires in both directions on purpose: the question is whether the six shipped defaults were the right six, and a star-only event cannot see a default being *rejected* — the sharper signal, since the defaults arrive without anyone asking. `action` is a CP action id, an enum from the shipped catalogue and no more user content than `cp tool used`'s `operation` |
| `cp tool favorites reordered` | `source`, `moved_to_front`, `favorite_count_bucket` | A favorite is moved by long press and drag. Once per completed gesture, never from the store's move, which runs at pointer-move rate. Carries no `method`: the drag is the only route, so it would be a constant — a second surface offering a second way earns one back. The gesture has no visible affordance, so this count against `cp tool picker opened` is the only evidence anyone finds it. `moved_to_front` rather than the index, because "does anyone promote a tool to the thumb position" is the answerable question and a raw index across a variable-length list is not. The permutation itself is never sent |
| `reference target picked` | `target_kind` (`vertex`/`crease`) | A vertex or crease is clicked in the References workspace's view. The pick, not the answer: with `reference query completed` beside it the gap between the two is the worker failing or the pick landing outside a sheet. Nothing about *which* vertex or crease — a coordinate or a crease id is the user's geometry |
| `reference query completed` | `target_kind`, `outcome` (`exact`/`approximate`/`none`/`error`), `duration_bucket` | ReferenceFinder answered (or failed) a pick. `exact` means at least one construction lands on the target within 1e-9; `approximate` that only near ones came back at the user's opt-in tolerance; `none` an empty answer; `error` a worker, timeout or extractor failure. A run the user stops sends nothing — it reached no ending. `duration_bucket` is the shared ladder (to 10 s, the query timeout), measured from dispatch, so a first query's cold database build is inside it |
| `folding steps opened` | `target_kind` | A step list is shown for a target — the query returned at least one construction and the sidebar opened its steps. The funnel's last stage: picks that turned into something to read |
| `folding steps completed` | `target_kind` (`whole_cp`), `lines_bucket`, `aux_bucket`, `visible_aux_bucket`, `turn_overs_bucket`, `mixed_steps_bucket`, `duration_bucket`, `exactness_class` (`exact`/`snappable`/`off_lattice`), `grid_kind` (`box`/`hex`/`none`), `grid_lines_bucket`, `grid_steps_bucket`, `grid_unwanted_bucket`, `reach_bucket`, `dangling_folds` (`allowed`/`disallowed`), `symmetric_steps` (`merged`/`separate`), `cards_with_ways_bucket` | A whole-pattern breakdown produced a sequence. The three count buckets are the product question the feature exists to answer: a plan whose auxiliary count is zero is a design the closure handled alone, and a plan whose *visible* auxiliary count is above zero leaves marks on the finished model. `exactness_class` says which of D8's three the pattern was, so the off-lattice share of real designs is measurable rather than estimated from a corpus sweep. `turn_overs_bucket` is how many times the folder turns the paper over: the whole side-grouping schedule was chosen on that number (a median of 4 across 395 benchmark designs, against 28 for the unordered plan), so it is the one to watch in the field. `mixed_steps_bucket` is how many of the plan's lines the pattern creases both ways, which is the share of a real design the precrease sequence cannot state on its own. `grid_kind` is whether the plan opened with a precrease grid — `box`, `hex`, or `none` when the design is not pleated or the setting is off — and `grid_lines_bucket` how many lines that grid has over every family, so the share of real designs the grid-first opening applies to is measurable. `grid_steps_bucket` is how many grid steps there were (one pleat per family, or pleats plus band steps once the grid is made only where the pattern needs it) and `grid_unwanted_bucket` how much crease the grid put on lines where the pattern has none, in tenths of a sheet-length — the number a grid made only where needed exists to lower, so the setting's worth is measurable in the field. `reach_bucket` is how much crease the steps made past the pattern's own so that each fold ends at references — the pieces of a line joined, each crease anchored at an edge or a crease and finished to a second one when that is cheap — in tenths of a sheet-length; `dangling_folds` is the "Allow dangling folds" setting the plan was made under — off finishes every crease to its second reference whatever that costs — so the setting's price is measurable the same way; `symmetric_steps` is the "Merge symmetric steps" setting the plan was made under — on, two folds that mirror each other are one card — so the share of plans read that way is measurable; `cards_with_ways_bucket` is how many cards offer another way to fold them — against `references ways explored`, how often readers take up a choice they were given |
| `folding steps cancelled` | as above | The user pressed Stop during a breakdown. The counts are what had been reached, so a cancel and a completion are comparable — the ratio is whether the run is worth waiting for |
| `folding steps refused` | as above plus `refusal_reason` (`non_rectangular`/`point_cap`/`budget`/`too_many_approximations`/`error`) | The breakdown produced no sequence. `non_rectangular` is D10's refusal (a hexagonal or open outline), `point_cap` the 600,000-point ceiling, `budget` a run ceiling — which the sequence no longer sets, so this value is a driver that did — `too_many_approximations` a plan that stopped rather than fold more lines by references than a sequence can carry (a pattern off its lattice everywhere, typically one out of Detect CP from Image), and `error` a worker failure. This is the row that says whether the V1 model's limits bite in practice |
| `reference batch completed` | `lines_bucket`, `unreachable_bucket`, `duration_bucket` | A CP-wide analysis finished. `unreachable_bucket` is how many distinct lines the closure could **not** reach and ReferenceFinder was therefore asked about; against `lines_bucket` it is the direct measurement of the claim the whole cost model rests on — that the closure does almost all the work and a query is rare |
| `references plan restored` | `outcome` (`hit`/`planner_changed`/`settings_changed`/`sheet_changed`) | The References workspace looked in the plan cache for the sheet it was about to show and found an entry for it. The cache holds the plans saved with a project and the sheets planned this session, so a reopened project shows the plan the reader read instead of replanning it — a replan can come out different, since the planner stops on wall-clock budgets. `hit` is a plan shown without planning; the other values say which part of the entry's key no longer matched (a new release, a changed setting, or the sheet's creases or their numbering) and the sheet was planned again. Against `folding steps completed`, the share of sequences served from a file; nothing about the plan or the sheet |
| `references mode changed` | `mode` (`find`/`sequence`), `source` (`tab`/`lead`/`diagram`) | The reader switched the References workspace between finding one reference and reading the precreasing sequence. The workspace lands in Find and plans only when asked, so `sequence` counts how often the whole sequence is wanted at all, against picks in Find; `source` is whether the tab or the lead's line under it ("Or plan the whole precreasing sequence") was the way in, which says whether the second job is being found; `diagram` is a diagram step's Open in References landing on the mode its step came from |
| `references fold played` | `trigger` (`user`/`auto`), `direction` (`fold`/`unfold`), `step_kind` (`cp`/`aux`/`press`/`turn_over`/`reference`), `tab` (`find`/`sequence`), `way` (`recommended`/`alternative`, only on a card that offers other ways) | A card's animation was set moving in the References workspace: a flap swinging over onto the paper or back, a twin pair each in turn, the sheet turning over, or a step of a ReferenceFinder construction in the Find tab. `trigger` is whether the reader asked for it — the Play button, Space or the menu row — or the "Auto-play folds" setting did, so the animation's use can be told from the setting's; `direction` says whether the paper was folded or unfolded, and `step_kind` which kind of card it was. A pause is not counted, and a card with nothing to move (the finished pattern, a pleat) has nothing to play. `way` says whether the fold played was the planner's pick or a way the reader chose, so an alternative watched is told from one only glanced at |
| `references ways explored` | `tab` (`sequence`), `settled` (`recommended`/`alternative`), `from_kind`, `to_kind` (the planner's fold-kind codes, e.g. `O2:cp`), `decided_by` (`corner_to_corner`/`overlong`/`visible`/`precise`/`local`/`crossing`/`one_motion`/`ease`/`thin_flap`/`accuracy`/`plan`/`none`), `ways`, `viewed` (`2`–`4`), `step_kind` (`cp`/`aux`/`press`), `twin` (boolean) | The reader looked at the other ways to fold a card of the sequence and moved on: once per visit to a card on which they changed the way, sent as they leave it, and never again for the same card of the same plan unless they settle on a different way. `settled` is whether they kept the planner's pick after looking, `from_kind` the pick's kind of fold and `to_kind` the one they settled on, and `decided_by` the criterion of the planner's ranking the pick won on against it — the rule a trend of overrides says to revisit (`implementation-plans/references-step-ways.md`). Every event already carries `app_version`, so a change to the ranking reads release over release |
| `references fold autoplay changed` | `enabled` (`on`/`off`) | The "Auto-play folds" preference was switched in the References view pane. Off by default, so `on` counts readers who want the paper to move without asking |
| `references aux creases changed` | `shown` (`on`/`off`/`style`) | The "Show auxiliary creases" option was set in the References view pane. It follows the paper style until set, so `style` is a reset back to it; a high `off` share says the pattern's guide lines are clutter on a diagram rather than the existing creases they usually stand for |
| `references approximation warning shown` | `reason` (`inexact`/`too_many`), `inexact_steps_bucket`, `exactness_class` (`exact`/`snappable`/`off_lattice`) | The modal warning about approximated folds was shown — once per plan with a step that is not exact (`inexact`: folded by the closest construction there was, or sighted from one), or per plan that stopped rather than approximate more lines than a sequence can carry (`too_many`, the "Planning failed" wording; the same plan is a `folding steps refused` with `too_many_approximations`). A pattern out of Detect CP from Image that converged a hair off its lattice is the case it exists for, so against `folding steps completed` it is the share of sequences a reader has to verify by hand or cannot get at all; `exactness_class` says which class of pattern earned it. Nothing about the folds |
| `references step jumped` | `target_kind` (`crease`/`vertex`) | In Sequence mode a tap on a crease the build-up has made moved the strip to the step that made it. Whether the sheet is used as a way back through a long sequence |
| `diagram step added` | `source` (`empty`/`references`/`svg`/`raster`), `via` (`grid`/`references`/`drop`/`batch`) | A step was added to the diagram. `source` is what its picture came from — `empty` for a step added with nothing in it yet, `svg` / `raster` for an uploaded picture, `references` for a card pulled from the References browser — and `via` the control that added it: `grid` is the Diagram workspace's own (the header's Add step, the empty state, Insert before / after, Upload pictures… with one file), `batch` several files picked at once, `drop` files dropped on the Diagram, `references` the References browser. Which ways into the Diagram people use. Duplicating a step is not counted; it adds nothing new, and neither is a picture that fills a step already there. Never the instruction or the picture |
| `diagram turn added` | `kind` (`turn_over`/`rotate`), `via` (`add_menu`/`card_menu`/`references`/`empty_step`) | A turn added between two steps (D22): the model turned over or round, an entry in the order with no picture and no number. `via` is where it was made — `add_menu` the header's Add step ▾, `card_menu` a step's Insert Turn Over / Rotate After, `references` a turn-over card pulled from the References browser, `empty_step` an empty step made a turn in its place (D24: its card's Turn over or Rotate, or Make Turn Over / Make Rotate in its menu or the Step pane). Whether turns are made by hand or come with References' sequences. Never the step it follows |
| `diagram picture uploaded` | `format` (`svg`/`png`/`jpeg`/`webp`/`other`), `outcome` (`ok`/`flattened`/`too_large`/`rejected`/`unsupported`/`unreadable`), `size_bucket` (KB: `<=50`/`<=200`/`<=1000`/`<=5000`/`>5000`, or `unknown`), `count_bucket` (`<=1`/`<=5`/`<=20`/`<=50`/`>50`) | One file of an upload into the Diagram — picked, dropped, or Replace picture… — and what became of it. `flattened` was added, but sanitizing changed its look (flowed text, a linked image, styling it could not keep); the other non-`ok` outcomes were not added: past a size cap, an SVG the sanitizer refused, not a picture at all, or a bitmap that would not decode. Whether people's own drawings survive the sanitizer, and which tools' files do not. `size_bucket` is the file's own size, `unknown` for a desktop pick refused before it was read; `count_bucket` how many files the upload carried. Never the file's name or its contents |
| `diagram step opened` | `via` (`keyboard`/`double_click`/`card`/`command`/`pose_again`/`enlarge_arrow`), `mode` (`pose`/`annotate`) | A step opened in its detail view: Enter on a card or with the steps focused, a double-click on a card, the card's own Adjust pose or Annotate button (`card`), the step verb of that name in its context menu or the Step pane (`command`), Pose Again on a step folded part way in the simulator, whose picture only Pose captures (`pose_again`), or a double-click on an enlarge arrow in the Pages view, which opens the step its area is on in Annotate with the area selected (`enlarge_arrow`, Revision 2, since 2026-10-06); `mode` is the half it opened in. Whether the detail is used at all, which way in, and how often a step is opened straight to Annotate. Placed by hand: Enter goes through the Diagram's own shortcut scope, not the menu chokepoint |
| `diagram picture posed` | `action` (`rotate_left`/`rotate_right`/`flip`/`reset`, and for a linked step `show_crease_pattern`/`show_folded`/`show_simulated`/`turn_over`/`next_solution`/`previous_solution`/`view_top`/`view_front`/`view_iso`/`orbit`/`rotate_to`/`upright`/`simulate`/`spread_on`/`spread_off`/`spread_kind`/`spread_amount`/`spread_direction`/`spread_keep`/`spread_skew`/`spread_axis`/`paper_side`/`enlarge_off`; for a References step `turn_over`/`choose_way`/`reset`), `kind` (`svg`/`raster`/`crease_pattern`/`flat`/`3d`/`simulated`/`references`); for `turn_over`, `side` (`front`/`back`), the side of the paper the picture shows after it, and for `paper_side`, `side` (`front`/`back`), the side whose color the paper takes; for a spread verb that leaves the layers spread, `spread_kind` (`depth`/`affine`) and `spread_amount_bucket` (percent — of the model by depth, of the way back to the sheet affine: `<=2.5`/`<=7.5`/`<=12.5`/`>12.5`), and by depth `spread_direction` (`up_left`/`up`/`up_right`/`right`/`down_right`/`down`/`down_left`/`left`), or affine `spread_keep` (`top`/`bottom`), `spread_skew_bucket` (percent: `<=0`/`<=50`/`<=99`/`>99`) and `spread_axis_bucket` (degrees: `<=45`/`<=90`/`<=135`/`>135`) | A pose verb that changed a step's picture, from the step detail's toolbar or the Step pane: an uploaded picture turned, flipped or set upright again, a linked one shown as its crease pattern or folded, turned over, stepped to another layer order (`next_solution`) or back to the one before (`previous_solution`), a References step folded another of its card's ways (`choose_way`, D23), turned to an angle typed in the Step pane (`rotate_to`) or stood upright on a mirror axis (`upright`), looked at from a named side or an orbit of the 3D view, or brought to rest in Pose's live simulator at another fold % or camera (`simulate`, one per rest that changed the picture, including Pose again on a step out of date), a flat fold's layers spread apart (Phase 13: Spread Layers on or off, the other kind — by depth or affine, 13g — another amount, skew or axis — one per drag of a slider, not per move — another direction, or the other layer held still), or a step sent from References turned over (`kind` is how it shows its pattern after the verb). A step shown as its crease pattern has its paper put on the front's or the back's color by the Step pane's Front | Back, under Show as — in Pose or not — counted as `paper_side` with `kind` `crease_pattern`: whether a pattern is drawn on the paper's back color. Nothing else about the picture changes: no mirror, no other turn, its mountains and valleys as they are. On 2026-10-05 that row turned the pattern over instead — mirrored, mountains and valleys swapped — and was counted as `turn_over` with `kind` `crease_pattern`; `paper_side` replaced it on 2026-10-06, on an unreleased branch. `side` was added 2026-10-05; a `turn_over` before it has none. A new flat pose starts spread (13g) and is not counted as a spread verb. `enlarge_off` is Pose's Enlarged turned off (Revision 2, since 2026-10-06): the step shows its whole picture again; turning it on is counted by `diagram step enlarged` instead. Whether pictures arrive the wrong way round often enough to earn the tool, which ways of posing a fold are used, and whether spread layers are, of which kind, at which direction or axis and roughly how far. Never the pose itself, nor a spread's exact values |
| `diagram annotation added` | `tool` (`valley_arrow`/`mountain_arrow`/`fold_unfold_arrow`/`pleat_arrow`/`push_arrow`/`white_arrow`/`solid_arrow`/`valley_line`/`mountain_line`/`hidden_line`/`solid_line`/`label`/`circle`/`right_angle`/`angle_mark`/`angle_bisector`/`divisions`/`callout`/`close_up`/`enlarge`/`enlarge_frame`), `snap` (`snapped`/`free`/`off`/`nothing_near`/`none`); for `divisions` alone, `placed` (`drag`/`line`); for `solid_line` alone, `color` (`ink`/`reference`/`red`/`orange`/`green`/`blue`/`purple`/`custom`) | An annotation drawn on a step's picture in Annotate, by the tool that drew it: one per annotation, when the drag or click that makes it lands — the Angle Bisector's line and the equal-angle mark it adds count once, as `angle_bisector`, and a white arrow the Solid Arrow lays, filled with ink, counts as `solid_arrow`. `snap` is how it was put down: snapped to a point of the picture or another annotation (either end of a line or of the line equal divisions are dragged along, a right angle's corner — which a click in a right angle, or on the mark it shows set into one, always is — a circle, a callout's point, an equal-angle mark's vertex or the vertex of an angle bisected from three points), put down freely with ⌘ (Ctrl) held, with the Step pane's Snap switch off, with nothing near enough, or `none` for an arrow, a label, a close-up or an enlarge area (`enlarge` a circle, `enlarge_frame` a rounded rectangle: Revision 2's Enlarge tools, which these two values arrive with — no build sends them before those tools ship), which never snap (arrows snapped until 2026-10-05), and for an angle bisected between two lines and equal divisions put on a line with a click, which pick lines rather than points. `placed` says how equal divisions were laid (Revision 2): dragged from one end of a line to the other, or put on a line of the picture or a drawn one with a click, which divides it whole — whether the click earns its place. `solid_line` is a line drawn with the Line tool's Solid type (Shift+L, 17a, since 2026-10-07), and `color` the colour it was drawn in, by name: the style's ink (no colour of its own), References' magenta (`reference`), one of the five print colours, or one picked by hand (`custom`) — whether solid lines are drawn, and whether the palette covers what people want. Never the colour's value. A solid line the Angle Bisector draws counts as `angle_bisector`, with no `color`. Until 2026-10-05 `tool` was also `turn_over` or `rotate`, a sign put down on the picture: those tools left Annotate when a turn became a step between steps (`diagram turn added`). Whether Annotate is used, which marks diagrams are drawn with — `callout` says how often a step is marked "repeat behind", `close_up` how often an area is drawn again larger — and whether snapping helps. Placed by hand: drawing is a canvas gesture, not a menu action. Never where it is, nor a label's or a callout's words |
| `diagram step enlarged` | `via` (`toggle`/`seeded`/`update`), `placed` (`face`/`sheet`/`picture`), `anchor` (`auto`/`picked`/`none`), `shape` (`circle`/`rounded`), `picture` (`svg`/`raster`/`references`/`crease_pattern`/`flat`/`3d`/`simulated`) | A frame placed on an enlarged step (Revision 2, since 2026-10-06): one event per step a capture places one on — Pose's Enlarged turned on (`toggle`), a step made after an enlarged one starting enlarged (`seeded`), or each step Update Enlarged Steps places again (`update`: an Update that places five steps counts five). A step made with its picture after an enlarged one — each picture of an upload, each card pulled from References, since 2026-10-07 — counts `seeded` as it is made; an empty one (Add Step, Insert Step After) when its first picture lands the frame it was seeded with. A step with no picture yet that Pose's Enlarged turned on — a linked step not captured yet — places nothing until its first picture lands the frame, and counts `toggle` then (since 2026-10-07; before, it counted `seeded`), so turning Enlarged on is counted once either way. An empty step's first picture counts it once, on that step alone, in the session it was made or turned on: a duplicate of it, a picture given back after its own was removed, or a step saved and opened again before its first picture counts nothing (since 2026-10-07; before, each counted `seeded`). `placed` is how the frame was put there: through an anchor face of the paper (`face`), through a crease pattern's sheet (`sheet`), or copied in picture units where a step has no faces (`picture`); `anchor` the anchor it was placed by — the default rule's (`auto`), one picked in the Layers pane (`picked`), or `none` when copied in picture units; `shape` the frame's; `picture` what the enlarged step's picture is. A step added by Insert Step After that starts enlarged also counts `diagram step added` as any new step does; duplicating an enlarged step counts neither. Whether enlarged steps are made, how often their frames anchor to the paper, and whether a picked anchor is ever needed. Placed by hand: none of these verbs is a menu action. Never where a frame is, nor its size |
| `diagram enlargement changed` | `on` (`area`/`frame`), `setting` (`moved`/`shape`/`size`/`edge`/`anchor`/`deleted`), `value` (`circle`/`rounded`/`fill`/`fixed`/`cut`/`whole`/`auto`/`picked`; none for `moved` and `deleted`), `size_bucket` (`<=1.5`/`<=2`/`<=3`/`<=6`, for a fixed `size` only) | An enlarge area on its step, or an enlarged step's frame, changed by hand (Revision 2, since 2026-10-06): once per drop or commit — moved or resized by its grips on the Annotate canvas (`moved`), its Shape, Size (`fill`, or `fixed` with the Size bucketed), Edge or Anchor (`picked` by a click in the pick mode, `auto` when Reset puts it back to the default rule) in the Layers pane, or an area deleted. Which of the enlargement's controls are used, and how often the automatic placement needs a hand. Never a size, a place or a point on the paper |
| `diagram annotation flipped` | `kind` (the annotation's, as `diagram annotation added` spells it), `axis` (`horizontal`/`vertical`) | A mark turned over in place from the Layers pane's Flip row in Annotate: each flip that changes it. An arrow or a line about its middle, equal divisions about the middle of the line they measure, any other mark about its anchor. Flip (F) on a pleat arrow or equal divisions, which puts its Zs or its line on the other side, is not counted. Whether flipping is used, which way and on what. Never where it is |
| `diagram annotation recolored` | `kind` (the annotation's, as `diagram annotation added` spells it: `solid_line`), `color` (`ink`/`reference`/`red`/`orange`/`green`/`blue`/`purple`/`custom`) | A solid line's colour changed from the Layers pane's Color row in Annotate (17a, since 2026-10-07): once per change — a palette colour, or Ink — and once per pick of Custom…, however many colours the engine's picker moves through before it closes (the colour the pick first moved to is sent, `custom` unless it lands on a palette colour). A colour chosen beside the rail's Line Type for the next line is a preference, not counted here: the lines drawn in it are, by `diagram annotation added`'s `color`. Whether a line's colour is changed after it is drawn, and to what. Never the colour itself, nor where the line is |
| `diagram annotation behind` | `kind` (the annotation's, as `diagram annotation added` spells it: `valley_arrow`/`mountain_arrow`/`fold_unfold_arrow`/`pleat_arrow`/`valley_line`/`mountain_line`/`solid_line`/`circle`), `ends` (`tail`/`tip`/`both`/`whole`), `layers` (`1`/`2`/`3+`) | A mark put behind a flap for the first time, in the Layers pane of Annotate, on a flat fold (Phase 15e): once, when its first end goes behind — a later end, Under, or bringing it back in front are not counted again. `ends` is which ends it then has behind: its tail (a line's start), its tip (a line's end), both, or a circle's `whole` ring; `layers` how many lie over them, bucketed. Whether people mark what a flap hides, and on which marks. Never where it is, nor the picture |
| `diagram annotate snap changed` | `enabled` (`on`/`off`) | Annotate's Snap switch flipped in the Step pane (a preference, on by default): whether anyone turns snapping off, and back |
| `diagram arrow shaped` | `kind` (`valley_arrow`/`mountain_arrow`/`fold_unfold_arrow`/`white_arrow`), `gesture` (`drag_node`/`drag_handle`/`bend`/`add_node`/`node_type`/`delete_node`/`nudge`); for `fold_unfold_arrow` alone, `half` (`out`/`return`) | A fold arrow or a white arrow — a solid one too, as `white_arrow` — shaped by hand in Annotate's Edit Path for the first time: once, when the edit makes a fold arrow's arc a path, or a white arrow no longer the straight one it was laid as (a node added counts; moving an end of a straight one does not), never for the edits after — a Reset makes it an arc, or straight, again, and shaping it after that counts again. `gesture` is what did it: a node, a handle or the curve dragged on the canvas, a node added (a click on the curve or the Step pane's Add Node), a node made a corner or smooth (a double-click or the pane), a node deleted (Delete or the pane), or a node nudged with the arrow keys. A fold-and-unfold arrow's first edit writes both its halves, its outgoing path and its return as they were shown, and each is shaped on its own after; `half` is which that edit touched: the outgoing path (the tip, which ends both, included) or the return. `half` was added 2026-10-06, when `diagram arrow return shaped` (a return first made a path of its own, 2026-10-05, never on `main`) was retired: every first edit now writes the return. Whether arrows are shaped at all, which way in people find, and whether a return is the half reshaped first. Counted in one place (`applyAnnotationEdit`), whichever surface made the edit; picking Edit Path is not counted. Never the shape, its points or where it is |
| `diagram picture removed` | `kind` (`svg`/`raster`/`crease_pattern`/`flat`/`3d`/`simulated`/`references`) | A step's picture taken away with Remove picture — an upload, a link to the crease pattern with whatever it had captured, or a step sent from References; the step and its instruction stay |
| `diagram picture exported` | `format` (`svg`/`png`/`jpeg`) | A step's picture written to a file with Export picture…, the first half of the export, edit and replace round trip. The file service's `file exported` fires for the same save, but cannot tell this export from any other SVG or PNG. Never the file's name |
| `diagram picture captured` | `kind` (`crease_pattern`/`flat`/`3d`/`simulated`), `outcome` (`ok`/`no_layer_order`/`rasterized`/`refused`/`stopped`/`failed`), `via` (`link`/`relink`/`refresh`/`refresh_all`/`show_as`/`duplicate_as`) | A linked step's picture captured from the crease pattern: when a step is linked, relinked to another pattern, or refreshed — on its own, or one of the steps Refresh all captures (`refresh_all`, one event per step). `kind` is how it shows the pattern — the folder the creases need, not the one asked for. Whether linking is used, and how often folds fail, are refused or are stopped. Never the pattern, its geometry or the camera |
| `diagram step shown as` | `show_as` (`crease_pattern`/`folded`/`simulated`), `via` (`pane`/`picker`/`card`/`duplicate`) | A step linked to the crease pattern shown another way (D19), once it shows that way: from the Step pane's Show as row (`pane`), the pattern picker's (linking and choosing the way in one pick), the card's Show as menu (`card`), or Duplicate as, which copies the step shown the other way (a copy shown the same way is a plain duplicate, not counted). Whether the choice is found outside Pose, and which way people pick. Pose's own switch is counted by `diagram picture posed`, and a choice from the pane or a card while Pose is open only here. Never the pattern
| `diagram source opened` | `workspace` (`edit`/`references`) | A diagram step's Open in Edit (a linked pattern, framed on Edit's canvas) or Open in References (the sheet a References step came from). Whether the way back from a step to what it was made from is used. Never the pattern or the step |
| `diagram view switched` | `view` (`steps`/`pages`) | The Diagram switched between its step cards and its printed pages, by the tabs. Whether the pages — the layout the export prints — are looked at before exporting. Never what is on them |
| `diagram page setup changed` | `setting` (`size`/`orientation`/`margin`/`layout`/`columns`/`rows`/`path`/`path_width`/`path_color`/`first_page_side`/`title`/`page_numbers`/`first_page`/`style`/`han_style`; `path` is Show path, `path_width` and `path_color` the flow path's width and colour — set, or reset to the default — `first_page_side` is First page: Left or Right, `first_page` the first page number; until 2026-10-06 also `scale`, the Scale control's One scale or Fit each, retired when every diagram came to fit each), `style` (`default`/`diagram`/`export-style`/`custom`, for `style` only) | A setting in the Diagram's Page pane changed, one event per committed change — a colour once per pick, when the pick settles: 220 ms after the picker's last move, when the picker lets go of focus, or when its row goes, whichever is first; a pick that carries on after a pause is still one count and one undo step. Which page settings are used, never their values (never a width or a colour); the style is named as a built-in, the Settings export style, or `custom` for a saved preset — never the preset's name |
| `diagram exported` | `format` (`pdf`/`svg`/`zip`), `preset` (`home`/`print_shop`, for `pdf` only), for `zip` only: `file_type` (`svg`/`png`), `resolution` (`300`/`600`, `none` for an SVG), `number` and `text` (`shown`/`hidden`), `size` (`same`/`cropped`), `background` (`transparent`/`white`); `file_count_bucket` (`<=1`/`<=2`/`<=5`/`<=10`/`<=25`/`>25`), `step_count_bucket`, `empty_step_bucket` and `enlarged_step_bucket` (`<=0`/`<=1`/`<=5`/`<=20`/`>20`) | The diagram written out from its export dialog: one PDF of its pages — to print at home, or for a print shop with bleed, page boxes and crop marks — one SVG with every page on one sheet, in printed spreads (`svg`, since 2026-10-06; it has no options of its own, so it sends none), or a ZIP with a file for each step that has a picture, and how those were made: whether each carries its number and instruction, and whether every file is one size, so the steps line up, or cut to its drawing. `file_count_bucket` is the PDF's or the SVG's pages or the ZIP's files, `step_count_bucket` the diagram's steps, `empty_step_bucket` those with no picture, which print as blank space or are left out, and `enlarged_step_bucket` those enlarged — showing a window of their picture (Revision 2, since 2026-10-06) — whose enlarge arrows print on the pages and are left out of step files. Whether diagrams leave the app, and in which form. The file service's `file exported` fires for the same save. Never the title, a step or a size |
| `diagram references browser opened` | `into` (`after`/`end`/`fill`/`replace`) | The References browser opened in the Diagram's centre, and for where what it adds would go: after the selected step, at the end, into an empty step (its From References…), or in place of a References step's card (Replace from References…). What `diagram steps pulled from references` is read against: how often the browser is opened and left with nothing. Never a pattern or a card |
| `diagram steps pulled from references` | `mode` (`sequence`/`find`), `into` (`after`/`end`/`fill`/`replace`), `count_bucket` | Cards pulled from the References browser into the diagram as steps: from a planned pattern's sequence or the Find answer References has on screen, where they went, and how many. Whether the Diagram is where precreasing steps are chosen, and whether filling and replacing are found. Each new step also counts `diagram step added` (`references`); a step filled or replaced was there already and does not. Never a card, a line or a sentence |
| `references pattern opened` | `source` (`card`/`finding`) | A pattern's detail — the steps and the canvas — is opened from the References list on a phone. Phone-only: that is the one layout that shows the list and the detail one at a time, so every one of these is a phone session that got past the list to the folds, which is the question putting the list first raises. `source` is which press did it — a pattern's card, or a finding in the notes under the cards |
| `simulator pattern opened` | — | The simulator was opened from the Simulate list on a phone: a press on a pattern's card, for a document with more than one pattern (a single pattern has no list and opens straight on the simulator). Phone-only, like `references pattern opened` — every other layout shows the list and the simulator together — and with no `source`, since a card is the only press that opens it |
| `simulator tool selected` | `tool` (`orbit`/`pin`/`pull`), `source` (`rail`/`picker`/`shortcut`/`context-menu`/`escape`/`tool-window`) | The Simulate canvas's tool changed — from the rail, the phone's Tools sheet, its key, Escape back to Orbit, or the Pull window's *Pin faces* button, which is Pull's way to Pin when nothing is pinned. A press on the tool already in hand sends nothing. How often Escape is the source says whether people want out of Pin; how often `tool-window` is, whether people find Pin from Pull |
| `simulator tool picker opened` | — | The phone layout's Simulate tool sheet was opened: whether anyone finds the Tools pill that stands in for the rail there. Kept apart from `cp tool picker opened`, which is Edit's and compared across releases |
| `simulator pins edited` | `gesture` (`box`/`click`/`tap`), `mode` (`replace`/`add`/`toggle`), `depth` (`all-layers`/`visible`/`front`), `outcome` (`changed`/`unchanged`/`empty`), `pinned_count_bucket` (`<=0`/`<=1`/`<=5`/`<=20`/`<=100`/`<=500`/`>500`) | A Pin gesture finished — once per box or click, never per pointer move. `empty` means it found no faces (a plain one then empties the set, as Box Select does); the bucket is the set's size after. `depth` says whether "Select through all layers" is used. Never a face id, a coordinate or an exact count |
| `simulator pins cleared` | `source` (`tool-window`/`context-menu`/`shortcut`), `pinned_count_bucket` | An explicit Clear emptied a non-empty pin set; the bucket is the size before. A gesture that empties the set is `simulator pins edited` instead, so nothing is counted twice |
| `simulator tool option changed` | `tool` (`pin`), `option` (`through-layers`), `value` (`on`/`off`), `source` (`tool-window`/`context-menu`/`shortcut`) | A simulator tool's option changed. Generic over tool and option, so a later tool's options need no new event |
| `simulator pinned fold moved` | `direction` (`fold`/`unfold`), `pinned_count_bucket` | The fold target first moved, by a percent or more, after a pin edit — once per pin set. The feature's value question: do people fold and unfold around their pins, or pin and stop |
| `simulator solver recovered` | `action` (`reset`/`arrest`), `pinned` (`yes`/`no`) | The solver's blow-up guard acted: `reset` put a non-finite model back to flat, `arrest` drained runaway velocity. At most once per load per action. `pinned` says whether pins, which over-constrain the paper, are behind it. These were repaired silently before |
| `simulator model pulled` | `outcome` (`kept`/`cancelled`), `input` (`pointer`/`touch`), `pinned_count_bucket`, `moved_creases_bucket` (`<=0`/`<=1`/`<=5`/`<=20`/`<=100`/`<=500`/`>500`) | A Pull drag ended — once per drag, never per move. `kept` means the paper was let go and holds the pose; `cancelled` that the drag was abandoned (Escape, a second finger, a tool switch) and the paper put back. `moved_creases_bucket` is how many fold creases the pull turned by more than 2°, as the solver counts them, so a press let go where it was reads `<=0`. The Pull tool's value question: do people pull models open, and keep what they pull? Never a position, an angle or a crease id |
| `simulator pull refused` | `reason` (`no-pins`/`missed`/`pinned-face`) | A Pull press did not grip: nothing was pinned to pull against, the press was off the paper, or it was on a face whose corners are all pinned. `no-pins` against `simulator model pulled` says how often people try Pull before Pin, which is whether refusing it was right |
| `simulator pose released` | `source` (`fold-control`/`restart`/`tool-window`/`context-menu`/`shortcut`) | A pose a pull left ended and the paper sprang back to the fold: the fold control moved (play, scrub, step or jump), Restart, or *Spring back* asked for from the Pull window, the context menu or a key. Only a kept pose counts — a drag abandoned mid-way is `simulator model pulled` with `cancelled`. Whether people keep poses, and how they throw them away |

**Nothing about a folding sequence's geometry is sent.** Not a line, a normal,
an offset, a step's witnesses, a crease id, an axiom histogram, or the residual
of an approximation — the shape of a sequence is the shape of the design that
produced it, and a fold count on a distinctive pattern is close to a name. What
leaves the app is the bucketed counts above and the closed refusal vocabulary.

One exception, decided 2026-09-24: `references ways explored` names the *kind*
of fold on a card the reader explored — the planner's closed vocabulary of
axiom and reference kinds, `O2:cp` for a corner onto a mark — and which
criterion of the planner's ranking decided between two of them. That is
metadata about how the app folds one step, not the pattern: no reference, no
coordinate, no step number, no count over the plan by kind. It is what lets
the ranking be adjusted from what readers overrule.

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

### The Image→CP funnel

The detector's events are a funnel, and reading them in order is how "is
anyone using this, and does it work" gets answered:

1. `command invoked` with `action: file.detectCpImage` — the dialog opened.
2. `cp detect image loaded` — an image was chosen and rectified.
3. `cp detect rights answered` — the user confirmed they are entitled to the
   image (`accepted: true`), or went back to the picker (`false`). The gate is
   asked for every image, so a second image loaded in one session is a second
   pair of steps 2 and 3.
4. `cp detect started` — Detect was pressed. The first press on a device is
   also the model download; `cp detect model downloaded` with
   `source: first-run` marks it.
5. `cp detect completed` — `succeeded` and, on success, the runtime buckets;
   on failure, the `reason`. Success rate of the model run.
6. `cp detect imported` — the pattern was added, with `outcome` saying how far
   the solve got (`solved` is the clean ending; `ambiguous` improved the
   pattern without reaching the foldability check).
7. `cp exact solve completed` and `cp exact solve resolved` — for a pattern
   added with a solve region, whether the solve landed and whether the user
   kept it.

`cp detect dismissed` carries the stage at every exit before step 6, so the
drop-off between any two steps is a count. Nothing in the funnel carries the
image, the pattern, or the model id.

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
