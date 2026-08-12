# Welcome Landing Page

## Goal

Turn `/welcome` into a page with two registers:

- **On a desktop browser and on the Tauri desktop shell**, the first viewport is
  exactly the start screen it is today — hero, three start actions, footer
  toggle. Scrolling down reveals a lean marketing landing page describing what
  Ori Studio is.
- **On a phone**, there is no start screen at all. The page is the landing page,
  led by a notice that Ori Studio is desktop-only for now, with a quiet "open it
  anyway" link for anyone who insists. A phone can never land in a workspace,
  even by deep link, and never pays for the wasm engine download.

Nothing about the desktop start screen's behaviour changes: `StartScreen`'s props
and semantics are untouched, and its existing tests should pass unmodified.

Decisions taken up front (asked and answered before planning):

| Decision | Choice |
| --- | --- |
| Landing content depth | Six sections, with per-feature detail |
| What counts as "mobile" | Phones only: `(pointer: coarse) and (max-width: 820px)` |
| Escape hatch | Yes — a quiet "open it anyway" link, persisted |
| Translations | English only until the copy is locked |

### Two claims the page must not make

Both were in the first draft and both were wrong. They are recorded here because
each is the kind of thing that reads as a feature list and ships as a lie:

- **There is no desktop download.** The desktop build is not released. The "Get
  it" section is about the browser, and the CTA is the Discord.
- **There is no crease-pattern detection from an image.** "Detect CP from
  Image…" is behind `import.meta.env.DEV` in `menus/menuDefinition.ts`, so it
  exists in dev builds only.

`WelcomeLanding.test.tsx` asserts against both, so re-adding either by accident
fails the suite rather than the reader.

## Approach

### 1. One place that decides "is this a phone"

New `apps/web/src/platform/mobileSurface.ts`, beside the existing
`platform/runtime.ts` and `platform/features.ts`:

```ts
export const PHONE_MEDIA_QUERY = '(pointer: coarse) and (max-width: 820px)';

export function isPhoneSurface(): boolean;      // sync, for router loaders
export function useIsPhoneSurface(): boolean;   // subscribes to matchMedia
export function hasPhoneOverride(): boolean;
export function setPhoneOverride(value: boolean): void;
```

Three rules the module owns, so no caller re-derives them:

- **Tauri is never a phone.** `getRuntimeSurface() === 'desktop'` short-circuits
  to `false` before any media query runs. The desktop shell uses a memory router
  and has no address bar; a gate misfiring there would be unrecoverable.
- **The override wins.** Read through `lib/storage.ts` (add
  `STORAGE_KEYS.phoneOverride` to the registry — per the repo's one-storage-module
  rule, never a bare `localStorage` call).
- **`matchMedia` may be absent.** jsdom and any non-browser host get `false`.

Pointer-coarse *and* a phone-width viewport, rather than width alone, so a
desktop user who drags their window narrow still gets the working app — they just
get the landing page's single-column layout underneath it.

**CSS keys off a data attribute, not a duplicated query.** `WelcomeRoute` sets
`data-surface="phone"` on its root element and the stylesheet targets
`[data-surface='phone']`. The breakpoint then lives in exactly one place (the TS
constant) instead of drifting between a stylesheet and a module.

### 2. Routing: a phone cannot reach a workspace

Three edits in `apps/web/src/routing/appRouter.tsx`:

- `startupHomePath()` returns `WELCOME_PATH` when `isPhoneSurface()` and no
  override, ignoring the `showWelcomeOnStartup` preference. A phone that
  previously turned the welcome screen off must not boot into `/edit`.
- The `WorkspaceShell` parent route gains a `loader` that redirects to
  `WELCOME_PATH` under the same condition — one guard covering `/design`,
  `/edit`, `/simulate` and the legacy Design sub-paths.
- `ShareRoute` (`/s`, `/s/:shareId`) redirects to `WELCOME_PATH` on a phone
  rather than importing a payload into a workspace nobody can see.

The file currently carries a comment stating there is **deliberately no guard** on
the workspace routes. That comment is right about what it covers and must be
amended rather than deleted: this new guard is a device-capability gate, not the
document-provisioning guard the comment argues against. Every workspace still
self-provisions, and a deep link on a real desktop is still always honored.

`useWelcomeDiscardGuard` needs no change. It blocks navigation *to* `/welcome`
when the project is dirty; on a phone the engine never initializes and no
document ever exists, so nothing is dirty.

### 3. A phone never downloads the engine

`App.tsx` calls `void initEngine()` unconditionally on mount, which pulls in the
CP and TreeMaker wasm bridges. Gate it on `!isPhoneSurface() || hasPhoneOverride()`.
This is the single largest win for phone load time and the reason the gate is a
module rather than a media query in a stylesheet.

Consequence to handle: the store's `status` stays `'loading_engine'` forever on a
phone. Nothing on the phone path reads it (`StartScreen` is not rendered), but
`WelcomeRoute`'s mount effect currently writes `status: engineReady ? 'ready' :
'loading_engine'` — leave the effect's other resets in place and skip the status
write on the phone path so no future reader inherits a lie.

### 4. Making the desktop page scroll

Today `.app-layout--start` is `height: 100vh; overflow: hidden` and `.start-screen`
is a centered grid with `overflow: auto` — a fixed pane with nowhere to put
anything below the fold.

- A new `.welcome-page` **inside** `.app-layout--start` is the scroll container,
  and holds the first screenful plus the landing.
- `.start-screen` becomes that first screenful: `min-height: 100dvh`, a flex
  column with `justify-content: safe center`. `dvh` because a mobile browser's
  collapsing URL bar makes `vh` taller than what is visible; `safe` because plain
  centering pushes the top of over-tall content above the scroll origin, where
  nothing can reach it.
- `.welcome-landing` and its sections stack below.
- A scroll affordance (chevron + a short label) sits at the bottom of the first
  viewport and hides once the page moves.
- `StartScreen`'s root becomes a `div` and `.welcome-page` takes the `main`
  landmark, since the start screen is now one section of a longer page.

Two things the first draft of this plan got wrong, both found while building:

- **The scroll container cannot be `.app-layout--start` itself.**
  `.file-drop-overlay` is absolutely positioned against it, so scrolling it
  stretches the dashed border to the height of the whole document and centers its
  label somewhere off screen. Hence the extra `.welcome-page` element.
- **The affordance uses a scroll listener, not an `IntersectionObserver` on a
  sentinel.** The question it asks is "is this scrolled to the top", which is
  `scrollTop < 24` — one passive listener, against an observer plus a sentinel
  element that exists only to be observed.

Scope the change to `--start`. `.app-layout` itself must stay `100vh` /
`overflow: hidden` or every workspace layout breaks.

Landing styles go in `apps/web/src/components/landing/WelcomeLanding.css`,
following the existing component-level stylesheet pattern (`MenuBar.css`,
`CpDetectImportModal.css`). The first-screenful rules stay in `App.css`, which
already owns `.start-screen`, and are shared with `.welcome-notice` through one
grouped selector so the page's two heads cannot drift apart.

### 5. Components

```
apps/web/src/components/landing/
  WelcomeLanding.tsx        # the four sections; shared by both registers
  LandingSection.tsx        # section shell (eyebrow / heading / body / media)
  DesktopOnlyNotice.tsx     # phone-only message + "open it anyway"
  WelcomeLanding.css
  WelcomeLanding.test.tsx
  DesktopOnlyNotice.test.tsx
```

`WelcomeRoute.tsx` stays a composition site and gets no new behaviour beyond the
branch:

- **desktop** — `<StartScreen …/>` then `<WelcomeLanding/>`, inside the existing
  file-drop region.
- **phone** — `<DesktopOnlyNotice/>` then `<WelcomeLanding/>`, with
  `useFileDropTarget` and `FileDropOverlay` not mounted (a phone has nothing to
  drop) and the "show welcome on startup" toggle absent (it controls a route a
  phone can never take).

### 6. The six sections

Drawn from the launch announcement, in the order someone deciding about this
would ask:

1. **What it is** — free, open source, runs entirely in the browser with nothing
   to install; the editor is a port of Oriedita, so it should feel familiar right
   away. Carries the beta note rather than letting the reader assume otherwise.
2. **Crease patterns** — the Oriedita port, then the four things worth naming
   individually: non-180° creases, first-class images and text, foldability
   checks, and share links.
3. **Design** — the tabbed workspace and its three methods: TreeMaker, Box
   Pleating Studio, and ExplOri (Brandon Wong's searchable 22.5° archive).
4. **Simulate** — inline simulation beside the pattern you are drawing.
5. **Built on the tools you already use** — the four upstreams, the interchange
   formats, and the commitment to import/export interoperability, stated with the
   caveat that interoperability is not the same as exact feature parity.
   Acknowledgements point at Help › About rather than being duplicated here.
6. **Get started** — the browser is the whole setup. CTAs are the Discord and
   the repository; `constants/release.ts` owns both URLs.

**Layout.** Sections alternate rather than stacking everything: 1 is `split`
(copy beside the overview), 2 and 3 are carousels, 4 is `split-reverse` (image
left), 5 and 6 are stacked. `split-reverse` flips with `order`, not DOM position,
so reading and tab order still reach the heading first.

**The carousels** are the ARIA tabs pattern, not a slideshow — the feature list
stays visible, so a reader can see everything on offer and jump to what they came
for. They do **not** auto-advance: each panel carries a paragraph, and moving it
mid-sentence on a schedule the reader did not choose is the thing WCAG 2.2.2 is
about. Arrow keys in both orientations (the list is a column when wide, a row
when narrow), Home/End, and one tab stop for the whole list.

**Screenshots.** `LandingFigure` slots, two files each in `public/landing/`
(`<name>-light.png` / `<name>-dark.png`), 16:9, chosen from the *app's* theme
rather than `prefers-color-scheme` — the theme is a preference set in the app and
can differ from the one the OS reports. Nine figures: `overview`, `simulate`,
`edit-{angles,media,foldability,share}`, `design-{treemaker,bp,explori}`.

Until a file exists the frame renders a labelled placeholder naming the path it
wants, and holds 16:9 in every state so the page does not reflow as screenshots
arrive. They can be added one at a time; a missing one costs nothing but its own
placeholder.

### 7. i18n — deferred on purpose

The copy is still being settled, so the landing page is **English only** for now
and there is no `public/locales/*/landing.json` at all. The inline `t('landing:…',
'English')` defaults are the single copy of that text.

That is the point: the first pass translated 25 keys into eight locales, and the
rewrite invalidated all of them. Worse, a stale English catalog is *loaded at
runtime and overrides the inline defaults*, so the page silently kept rendering
the old copy — including the desktop download that had just been removed.

Turning translation on is a two-line change plus the usual loop:

- `apps/web/src/i18n/locales.ts` → add `'landing'` to `I18N_NAMESPACES`.
- `apps/web/scripts/i18n/_shared.mjs` → add `'landing'` to `PARSER_NAMESPACES`.
- Then `i18n:extract` → translate all eight → `i18n:stamp` → `i18n:check`.

Both files carry a note saying so. Budget roughly 45 keys × 8 locales.

`assertInSync()` reads the namespace list back out of `locales.ts`, so keeping
those two lists identical is enforced rather than remembered.

`I18N_NAMESPACES` is passed to i18next's `ns`, so `landing.json` is fetched at
init on every surface, including inside a workspace. At a few KB that is fine; if
it ever matters, the alternative is to drop it from the eager list and let
`useTranslation('landing')` load it on demand.

Then the standard loop: `npm run i18n:extract` → translate the eight target
locales → `npm run i18n:stamp` → `npm run i18n:check`.

### 8. Analytics

Per AGENTS.md, a new user-facing surface ships with the event that tells us
whether it gets used. None of this dispatches through `handleMenuAction`, so all
of it is hand-placed `track(...)`, fired from the view components (not from store
subscriptions).

Add to `ANALYTICS_EVENTS` in `analytics/events.ts`:

| Event | Properties |
| --- | --- |
| `landing viewed` | `surface: 'phone' \| 'desktop'` |
| `landing section viewed` | `section: 'workspaces' \| 'compatibility' \| 'get-it'` — first time each scrolls in |
| `landing cta clicked` | `cta: 'download-desktop' \| 'github' \| 'scroll'` |
| `mobile block shown` | — |
| `mobile block bypassed` | — |

`mobile block bypassed` is the one that earns its keep: it says how many people
want this on a phone badly enough to force it.

New `analytics/useLandingViewedEvent.ts`, mirroring the existing
`useWorkspaceViewedEvent.ts`. Enum property values only, no raw content — the
landing page has no user data, so this stays trivially inside the privacy
contract.

### 9. Meta

`/` client-redirects to `/welcome`, so the landing page becomes the effective
homepage and `index.html`'s existing `<link rel="canonical" href=".../">` stays
correct.

Update `index.html`'s `description` and `og:description`. Both currently say
"turning tree structures into crease patterns", which describes the TreeMaker
port — one tool in the app — rather than the product, whose bulk is
Oriedita-derived CP editing. Align them with the section-1 copy.

Out of scope, worth knowing: this is a client-rendered SPA, so a crawler that
does not execute JS sees an empty root. If landing-page SEO becomes a goal,
prerendering `/welcome` is its own piece of work.

## Affected Areas

**New**

- `apps/web/src/platform/mobileSurface.ts` (+ `.test.ts`)
- `apps/web/src/components/landing/` — `WelcomeLanding.tsx`,
  `LandingSection.tsx`, `DesktopOnlyNotice.tsx`, `WelcomeLanding.css`, tests
- `apps/web/src/analytics/useLandingViewedEvent.ts`
- `apps/web/public/locales/*/landing.json` (9 files, generated)

**Modified**

- `apps/web/src/routing/WelcomeRoute.tsx` — the phone/desktop branch
- `apps/web/src/routing/appRouter.tsx` — `startupHomePath`, the `WorkspaceShell`
  loader guard, the amended no-guard comment
- `apps/web/src/routing/ShareRoute.tsx` — phone redirect
- `apps/web/src/App.tsx` — skip `initEngine` on a phone
- `apps/web/src/App.css` — `.start-screen` / `.app-layout--start` scroll layout
- `apps/web/src/lib/storage.ts` — `STORAGE_KEYS.phoneOverride`
- `apps/web/src/constants/release.ts` — `RELEASES_URL`
- `apps/web/src/analytics/events.ts`, `analytics/index.ts` — event names + enums
- `apps/web/src/i18n/locales.ts`, `apps/web/scripts/i18n/_shared.mjs` — the
  `landing` namespace
- `apps/web/index.html` — description / `og:description`
- `apps/web/src/routing/appRouter.test.ts` — phone cases

**Untouched**

- Every Rust crate. No engine change, so no `cargo` run and **no wasm rebuild** —
  the tracked `apps/web/src/generated/oristudio-{cp,bp}-wasm/` artifacts stay as
  they are.
- `apps/tauri` — the desktop shell short-circuits to "not a phone" and needs no
  edit.
- `StartScreen.tsx` and its test — props and behaviour unchanged.

## Checklist

### Phase 1 — surface detection and gating

- [x] `platform/mobileSurface.ts` with the Tauri short-circuit, the override, and
      the `matchMedia`-absent fallback
- [x] `STORAGE_KEYS.phoneOverride` in the storage registry
- [x] `mobileSurface.test.ts` — phone matches; Tauri host always false; override
      wins; listener is removed on unsubscribe
- [x] `startupHomePath()` forces `/welcome` on a phone regardless of the
      preference
- [x] `WorkspaceShell` loader guard + `ShareRoute` phone redirect; amend the
      no-guard comment to say why this one is different
- [x] `App.tsx` skips `initEngine()` on a phone; `WelcomeRoute` skips the status
      write on that path
- [x] `appRouter.test.ts` covers: phone + preference-off → `/welcome`; workspace
      loader redirects; override lets it through; desktop unaffected

### Phase 2 — desktop scroll

- [x] `.welcome-page` scroll container inside `.app-layout--start`, with
      `.start-screen` as a `min-height: 100dvh` first screenful
- [x] Scroll affordance at the bottom of the first viewport, hidden once scrolled
- [x] Confirm no workspace layout regressed (`.app-layout` still clipped at
      `100vh`)

### Phase 3 — landing content

- [x] `LandingSection.tsx` shell
- [x] `WelcomeLanding.tsx` with the six sections
- [x] `LandingFigure.tsx` — themed screenshot slots with a naming placeholder
- [x] `DISCORD_URL` in `constants/release.ts`; CTAs link through it
- [x] `WelcomeLanding.css`
- [x] `WelcomeLanding.test.tsx` — sections render, CTAs point at the right URLs,
      and neither retired claim (desktop download, CP-from-image) can come back
- [x] `LandingFeatureCarousel.tsx` + tests — tabs pattern, arrow/Home/End keys,
      one tab stop, no autoplay
- [ ] **For the author.** Drop screenshots into `apps/web/public/landing/`, each
      as `-light.png` and `-dark.png` at 16:9: `overview`, `simulate`,
      `edit-angles`, `edit-media`, `edit-foldability`, `edit-share`,
      `design-treemaker`, `design-bp`, `design-explori`

### Phase 4 — phone register

- [x] `DesktopOnlyNotice.tsx` with the message and the "open it anyway" link
- [x] `WelcomeRoute` phone branch: notice + landing, no `StartScreen`, no drop
      target, no startup toggle
- [x] `data-surface="phone"` drives the single-column CSS
- [x] `DesktopOnlyNotice.test.tsx` — message renders; bypass sets the override

### Phase 5 — instrumentation and meta

- [x] Events + enums in `analytics/events.ts`, re-exported from `analytics/index.ts`
- [x] `useLandingViewedEvent.ts`; section-viewed observer; CTA and bypass events
- [x] `index.html` description / `og:description`

### Phase 6 — i18n (deferred until the copy is locked)

- [x] English authored inline; no landing catalog on disk, so nothing can go
      stale and override it
- [x] `landing` kept out of both namespace lists, each with a note saying how to
      turn translation on
- [x] `npm run i18n:check` passes
- [ ] **Blocked on the copy.** Register `landing` in `locales.ts` and
      `_shared.mjs`, then `i18n:extract` → translate all 8 → `i18n:stamp` →
      `i18n:check`

### Phase 7 — validation

- [x] `npx tsc --noEmit` and `npx vitest run` from `apps/web` (invoked directly —
      the npm wrappers regenerate wasm nondeterministically)
- [x] `npm run lint:web`
- [x] `npm run i18n:check`
- [x] Browser check, desktop width: first viewport identical to today; scroll
      reveals the four sections; workspaces still reachable
- [x] Browser check, phone emulation: landing only, notice present, `/edit`
      redirects to `/welcome`, no wasm request in the network panel
- [x] Browser check: bypass link → app loads, and the choice survives a reload
- [x] `npm run build:web` (production bundle; `dist/.gitkeep` survives the build)
- [x] `npm run check:desktop`
- [ ] **Not done — for the author.** Tauri desktop (`npm run dev:desktop`): start
      screen unchanged, no gate. The gate itself is covered by
      `mobileSurface.test.ts` ("is false in the Tauri shell whatever the viewport
      reports") and the shell renders the same `StartScreen` as the browser, so
      this is a visual confirmation rather than an open risk.
