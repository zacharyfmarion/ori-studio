# Analytics & privacy

Ori Studio uses [PostHog](https://posthog.com) for product analytics — to learn
which features get used, so we can decide what to improve. This document is the
**privacy contract**: what we collect, what we will never collect, and the
safeguards that keep it that way. It is the authoritative reference; the code
under `apps/web/src/analytics/` is the source of truth for the exact event set.

The browser build and the Tauri desktop build share the same renderer code, so
one implementation covers both. A `runtime_surface` property (`web` | `desktop`)
distinguishes them.

## Principles

- **Off by default in development.** Analytics initializes only when both
  `VITE_PUBLIC_POSTHOG_KEY` and `VITE_PUBLIC_POSTHOG_HOST` are present at build
  time. Local and PR-preview builds don't set them, so nothing is ever captured
  there. This "absence = disabled" firewall is deliberate — see
  `implementation-plans/posthog-analytics.md`.
- **Anonymous.** We `identify()` with a random UUID generated and stored only in
  this browser (`localStorage`, key `oristudio:analytics-id`). It is never
  derived from anything about the user. Opting out deletes it; opting back in
  mints a new one, so the two sessions are not linkable.
- **Opt-out, honored immediately.** Settings → Workspace → Privacy has a toggle
  (default on). Turning it off sends a final `analytics preference changed`
  event, then resets identity and stops all capture — including autocapture.
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
  `ph-no-capture` and never a property value.
- **Raw error messages or stack traces** — only a normalized, path-scrubbed
  fingerprint and a coarse domain.
- **Session replay / recordings and surveys** — disabled at init.

More generally, custom event properties are restricted to **enums and bucketed
numbers**. Raw strings from user content are never a property value.

## Safeguards

| Safeguard | Where |
| --- | --- |
| `mask_all_text` + `mask_all_element_attributes` on autocapture | `analytics/bootstrap.ts` init |
| Session recording + surveys disabled | `analytics/bootstrap.ts` init |
| `ph-no-capture` on the text editor + share-link URL | `cp-workspace/CpTextEditor.tsx`, `cp-workspace/share/ShareLinkModal.tsx` |
| Error fingerprints strip URLs / paths / filenames / numbers | `fingerprintError` in `analytics/bootstrap.ts` |
| Enum + bucketed properties only | `bucketCount` in `analytics/events.ts`; call-site discipline |
| Consent gating (no-op when off/absent) | `analytics/runtime.ts` |

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

## Tracked events

Every event also carries the super properties `app_version`, `app_commit`,
`runtime_surface`, and `analytics_enabled`.

| Event | Properties | Fires when |
| --- | --- | --- |
| `app opened` | — | App launch |
| `app error` | `error_domain`, `operation`, `source_component`, `handled`, `fingerprint` | An error boundary catches (deduped over 30s) |
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
| `fold attempted` | `mode` (`flat`/`spatial`), `crease_count_bucket`, `non_classic_count_bucket` | `G`, or the Fold button, on a non-empty foldable selection. `mode` is decided from the **scoped** selection, before any dialog |
| `fold completed` | `mode`, `verdict` (`folded`/`no-solutions`/`contradiction`/`not-drawable`/`simulated`/`cancelled`/`error`/`local-crossing`/`transversal-crossing`/`no-layer-order`), `solution_count_bucket`, optional `refusal`, optional `order_reason` | Every terminal branch of a fold, so it pairs one-to-one with `fold attempted`. `refusal` is the kernel's `Fold3dRefusal` code (ten values) and rides on the `simulated`/`cancelled` arms, which is how a refusal keeps its reason without a verdict of its own; `order_reason` is the `Fold3dOrderReason` code (eight values) on `no-layer-order` |
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
