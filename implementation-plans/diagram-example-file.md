# Diagram: an example to open from the empty state

## Goal

Give someone who opens the Diagram workspace for the first time something
finished to look at. The empty state (no diagram, or no steps) offers to open
an example crane — a crease pattern and a full diagram with a title block —
and links the video walkthrough beside it.

Opening the example is opening a file: it goes through the same path as File ›
Open and a dropped file, so the unsaved-changes warning, replacing the project
and the `project opened` event all happen as they would for any `.osf`. The one
difference is where it lands: the Diagram workspace, showing the example's
diagram, rather than Edit (where an `.osf` holding a crease pattern lands).

## Approach

- **The asset.** The crane is `apps/web/public/examples/Crane.osf`: the file
  Zach supplied (`crane_with_titel.osf`) with its names changed and nothing
  else. A project's name is the title inside it, not its file's name, and that
  title was "Untitled CP" — so the title (in the workspace, the crease pattern
  and its kernel snapshot and FOLD frames) is "Crane", and the source filename
  it recorded is `Crane.osf`. Seven lines differ; every crease, step and page
  is as it came. Served as a static file and fetched on demand. The service
  worker routes nothing under `/examples/` (it falls through to `bypass`), and
  its precache and warm lists are built from `assets/` only, so it is never
  cached ahead of a click; a test pins that. Pages types `.osf` as Yamaha's
  Open Score Format and sends it uncompressed (3.4 MB on the PR preview), so
  `public/_headers` serves `/examples/*` as `application/json`: 130 KB brotli.
- **The open.** `diagram/example/diagramExample.ts` fetches the asset, wraps
  it as a `File` named `Crane.osf`, and hands it to `openProject` through
  `createDroppedFileService` — exactly what a drop does. `openProject` asks
  before discarding unsaved work, so a fetch that fails never asks. A fetch
  that fails (offline, the asset not cached by the browser) reports through
  the store's `error`, the toast every refused open uses.
- **Landing.** `openProject` gains a `landing` option: a caller that knows the
  surface the file is for names it, and the open lands there instead of where
  `landingWorkspace` would put it. Applied in `applyLandingWorkspace`, so there
  is one transition (no flash of Edit, no extra history entry).
- **Analytics.** `openProject` gains a `source` option so the example counts
  as `project opened` `source: example` (the value the TreeMaker examples
  already send), not as a file open. One hand-placed event, `diagram example
  opened`, with `outcome` (`opened`/`cancelled`/`failed`/`unavailable`), says
  whether the button is used and how often it fails. `diagram tutorial opened`
  counts the walkthrough link (no shared external-link event exists; the
  Discord one is Discord's).
- **The walkthrough.** A `ButtonLink` with `target="_blank"`, the mechanism
  every other external link in the app uses (ExplOri's Open in ExplOri, the
  toolbar's Discord link, About's acknowledgements).
- **Web and desktop.** The asset is in `public/`, so it ships in the desktop
  bundle whatever the button does; the button is shown on both.

## Affected Areas

- `apps/web/public/examples/Crane.osf` (new asset)
- `apps/web/src/diagram/example/` (new: the open, its hook, tests)
- `apps/web/src/components/diagram/DiagramEmptyState.tsx` and its module
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts`, `types.ts`
  (`openProject` options)
- `apps/web/src/analytics/` (two events), `docs/analytics.md`
- `apps/web/src/pwa/swRoutes.test.ts` (the example is never cached)
- `apps/web/public/_headers` (the example served as JSON, so compressed)
- `apps/web/public/locales/*/panels.json`, `errors.json`

## Checklist

- [x] Copy the example into `public/examples/` and check it reads on main
- [x] `openProject` options: `landing`, `source`
- [x] The open: fetch, wrap, hand to `openProject`, report a failed fetch
- [x] The empty state: the example button and the walkthrough link
- [x] Analytics events and their `docs/analytics.md` rows
- [x] i18n in all nine catalogs
- [x] Tests: the open path (clean, unsaved changes, cancel, fetch failure), the
      button and link, the asset reads cleanly, the service worker leaves it
- [x] Lint, typecheck, vitest, i18n:check, build:web
- [x] Browser check and screenshots
- [x] Draft PR (#451)
