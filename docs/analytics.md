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
| `workspace viewed` | `workspace`, `variant` | The active workspace (or Design variant) changes |
| `crease pattern built` | `node_count_bucket`, `had_conditions` | A tree is compiled to a CP |
| `optimizer run` | `kind`, `succeeded`, `feasible` | A TreeMaker optimizer runs |
| `project opened` | `source` (`file`/`example`/`new`) | A project is opened/created |
| `project saved` | `format` (`osf`) | A project is saved |
| `file exported` | `format` | An export writes a file |
| `design method chosen` | `method` (`treemaker`/`box-pleat`) | The NUX design chooser |
| `cp detect started` | — | Image→CP detection begins |
| `cp detect completed` | `succeeded` | Detection finishes |
| `cp detect imported` | — | A detected CP is imported |
| `crease pattern shared` | `crease_count_bucket`, `had_title`, `had_author` | A share link is published |
| `share link copied` | — | The share URL is copied |
| `share link opened` | `succeeded`, `source` | A shared link is opened |
| `theme changed` | `theme` | The theme is changed |
| `locale changed` | `locale` | The language is changed |

## Maintenance rules

- **New user-facing features ship with an event** (see AGENTS.md → Common
  patterns → Analytics). If the action dispatches through `MENU_ACTION_ID` or a
  CP operation, it is already covered — don't double-count. Otherwise add a
  hand-placed `track(...)`.
- Event names: lowercase, space-separated. Property keys: `snake_case`. Property
  values: enums and bucketed numbers only.
- Never send raw user content. When in doubt, bucket it or leave it out.
- Keep this table and the never-collect list current with the code.
