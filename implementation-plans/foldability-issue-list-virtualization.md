# Showing every foldability issue

## Goal

The diagnostic HUD lists at most 12 issues. A crease pattern with 21 errors shows
12; one with 2,000 shows 12. Nothing tells the user the list was cut, so the HUD
reads as a complete account of a pattern when it is a sample of it.

Show **every** entry, virtualized, and keep the HUD cheap enough at thousands of
entries that expanding it is not a decision the user has to think about.

Three things follow from doing that honestly, and they are in scope because
uncapping the list is what makes each of them visible:

1. The list and the canvas do not agree on which entries exist (see *The two
   entry sets* below). At 12 rows the disagreement is usually hidden by the cap.
2. The header counts errors; the list shows errors **and** warnings. "21
   Foldability Errors" over 25 rows is a contradiction the cap currently masks.
3. Clicking a canvas marker activates an entry whose row may not be mounted once
   the list is windowed. Today every row is mounted, so this has never mattered.

Out of scope, deliberately: sorting, grouping, filtering, and next/prev-issue
shortcuts. They are the right follow-up for a 2,000-entry list, but each is a
product decision about *how* to navigate issues, and none of them is needed to
stop lying about how many there are. Noted at the end as follow-ups.

## What is actually there today

Read before changing anything — several of these contradict the obvious guess.

**The cap is one call.** `CreasePatternPanel.tsx:2784`:

```tsx
{diagnosticHudEntries.slice(0, 12).map((entry) => (
```

**The kernel does not cap.** `flat_foldability_diagnostics`
(`crates/oristudio-cp/src/lib.rs:2706`) maps *every* violation to a
`CommandDiagnostic`, and `spatial_closure_diagnostics` extends that. So all
entries already cross the wasm boundary, already sit in the store, and already
build WebGL marker, stroke, wedge, and hit geometry for the canvas overlay
(`CreasePatternPanel.tsx:1397`). **No Rust change is needed and none should be
made.** The list is the only place truncating, which is why this is a frontend
plan.

That also bounds what this change can claim: the O(n) work over all entries —
the geometry builders, `visibleCpDiagnosticEntries`, the hit array the canvas
scans on click — is *pre-existing* and runs today at full entry count whether or
not the HUD is expanded. Virtualizing the list does not make those cheaper. It
makes the list stop adding to them.

**The scroll container already exists.** `.cp-diagnostic-hud__list` in
`theme.css:2722` is already `max-height: min(320px, calc(100vh - 170px));
overflow: auto`. The HUD's outer box does not grow with the entry count, so
uncapping changes no layout — only how many children that box holds.

**Scrolling the HUD cannot zoom the canvas.** The wheel listener is bound on the
canvas element itself (`CreasePatternWebglCanvas.tsx:2838`), not on a shared
ancestor, and the HUD is a sibling. So a wheel over the HUD never reaches it.
This is a thing to *verify*, not to fix — no `stopPropagation` should be added.

**Entry ids are positional.** `format!("{kind}-{}", index + 1)` (`lib.rs:2729`)
gives `CheckCamv-1`, `CheckCamv-2`, … keyed by iteration order, not by vertex.
After an edit re-runs CAMV, `CheckCamv-7` is very likely a different vertex.
That is fine within one render — they are unique, so they are valid React keys —
but it means the active-entry id does not survive a recompute meaningfully, and
that keys churn wholesale when the entry list shifts. Both are pre-existing.
Neither is worth fixing here; both are worth knowing before debugging a
"why did the whole list remount" question later.

### The two entry sets

There are two derivations of "which diagnostics exist", and they disagree.

`visibleCpDiagnosticEntries` (`diagnostics/visibleEntries.ts`) — what the
**canvas** draws and what the **store** searches when framing an activated
diagnostic (`cpDiagnosticFocus.ts:29`) — *concatenates* the CAMV overlay with a
check command's own findings.

`diagnosticHudEntries` (`CreasePatternPanel.tsx:1448`) — what the **list**
renders — picks **one** of them:

```
camvIssuesVisible && camv has issues  →  camv entries only
!camvIssuesVisible && last was CheckCamv  →  none
otherwise  →  last command's entries
```

So with the CAMV overlay on *and* a Check1 result present, the canvas draws both
sets and the list shows only the CAMV half. Click one of the Check1 markers: the
store activates it and frames it, and the list has no row to highlight.

`visibleEntries.ts`'s own doc comment already states the intent —

> Returned as one list because everything downstream — markers, the HUD list,
> what a jump-to-diagnostic can reach — asks the same question

— so `diagnosticHudEntries` is drift from a rule the codebase already wrote
down. Uncapping is the right moment to delete it.

## Approach

### Phase 0 — Move the HUD out of the panel

Not optional, and it comes first.

`CreasePatternPanel.tsx` is at 2,939 counted lines against a `PANEL_MAX_LINES`
of 800, held by an explicit `OVERSIZED_PANELS` entry in
`apps/web/eslint.config.js`. Adding a virtualizer, a measurement ref, a
scroll-to-active effect, and a memoized row component to it would trip the lint
rule — and, per AGENTS.md, the honest reading of that rule here is *move the
behavior*, not *raise the number*. A windowed list with its own scroll state is
exactly the "state, a ref, an effect" the panel-components table sends
elsewhere.

Two new files, following `hooks/useViewportSurface.ts` and
`folded/foldedFigureActions.ts` as the shape to copy:

- **`cp-workspace/diagnostics/CpDiagnosticHud.tsx`** — the whole HUD:
  summary button, expand state, the windowed list, the row. Presentation and
  local UI state only.
- **`cp-workspace/diagnostics/useCpDiagnosticList.ts`** — the store bindings:
  the entry list, the active id, the setter, `camvIssuesVisible`. Subscribes
  narrowly so an unrelated store write cannot re-render the HUD.

The panel keeps a mount and the props that are genuinely the panel's
(`diagnosticStatus`, which it already computes for other reasons — or that moves
too, if it turns out to have no other reader).

Lower the `OVERSIZED_PANELS` entry for `CreasePatternPanel.tsx` by whatever comes
out. Do not raise it.

### Phase 1 — One entry set

Delete `diagnosticHudEntries` (`CreasePatternPanel.tsx:1448`). The HUD reads the
same `visibleCpDiagnosticEntries` result the canvas and the store framing read.

Consequence worth stating: with the CAMV overlay on and a check-command result
present, the list now shows both, so the row count can exceed what the header
counted. Which leads directly to:

### Phase 2 — Make the header agree with the list

`diagnosticHudStatus` (`diagnostics/hudStatus.ts:77`) counts `severity ===
'error'` for the label but the list renders every severity. Uncapped, "21
Foldability Errors" can sit above 25 rows.

The fix is in `hudStatus.ts`, which is already the tested home for exactly this
class of presentation rule (its doc comment records two prior subtitle bugs).
Preferred: keep the headline as the error count — it is the number that matters
and the tone is driven by it — and let the list carry the rest, with the counts
reconciled in the list's `aria-label` and, if warnings are present, a secondary
count in the header. Whichever way it goes, pin it with a test in
`hudStatus.test.ts`; the point is that the two numbers stop being derived from
different sets by accident.

### Phase 3 — Virtualize

Add `@tanstack/react-virtual`. Measured cost, so the decision is on record:
**6.7 KB brotli / 7.3 KB gzip** (23.8 KB minified, react external, tree-shaken),
against a 249 KB brotli JS chunk and a ~766 KB brotli critical path — +2.7% of
the chunk, +0.9% of the path. React 19 is a declared peer.

Dynamic row heights, deliberately. Messages wrap today, and the eight shipped
locales run longer than English — de and ru especially — so a fixed row height
would mean clamping every row to an ellipsis in exactly the languages that most
need the words. `useVirtualizer`'s `measureElement` handles this with a
ResizeObserver on mounted rows only.

```
useVirtualizer({
  count: entries.length,
  getScrollElement: () => listRef.current,
  estimateSize: () => ROW_ESTIMATE,   // ~29px: 7px padding ×2 + 0.72rem × 1.25 + 1px rule
  getItemKey: (index) => entries[index].id,
  overscan: 8,
})
```

Rows render absolutely positioned inside a spacer of `getTotalSize()`, each with
`ref={virtualizer.measureElement}` and `data-index`.

**Three consequences that are easy to miss:**

1. **The row separator breaks.** `.cp-diagnostic-hud__row + .cp-diagnostic-hud__row`
   (`theme.css:2749`) is an adjacent-sibling rule; under absolute positioning
   the visual order no longer matches sibling order and the first visible row
   loses its rule inconsistently. Move it to a `border-bottom` on the row, with
   the last one handled by the container's overflow.
2. **The virtualizer must not run while collapsed.** The list already only
   mounts when `diagnosticHudExpanded` — keep that, and keep the virtualizer
   inside the mounted subtree so a collapsed HUD costs nothing at all.
3. **`estimateSize` is load-bearing for the scrollbar.** Get it close, or fast
   scrolling into unmeasured regions visibly shifts the thumb. Derive it from
   the CSS rather than a magic number, and pin it with a comment naming the
   source.

### Phase 4 — Keep the per-row work small

With ~20 rows mounted this is cheap by construction, but the two things that
would silently undo that:

- **Extract `CpDiagnosticHudRow` and `memo` it.** Otherwise every scroll tick
  re-renders every mounted row, and each one re-runs `cpDiagnosticEntryMessage`
  and `cpDiagnosticMarkerStyle`.
- **Do not build a closure per row.** `onClick={() => handleSelect(entry.id)}`
  allocates a new function per row per render and defeats the memo. Put
  `data-diagnostic-id` on the row and handle the click once on the list
  container.

`cpDiagnosticEntryMessage` and `cpDiagnosticMarkerStyle` then run for mounted
rows only — which is the actual win, since at 2,000 entries the capped list was
never the cost; an *uncapped* unwindowed list would have been.

### Phase 5 — Reveal the active entry

Activating a diagnostic already frames the canvas (`cpDiagnosticFocus.ts`). Once
windowed, its row may not exist in the DOM, so the list must scroll to it:
`scrollToIndex(index, { align: 'auto' })` in an effect keyed on the **active id**
alone.

Keyed on the id, not on the entry or the index — `cpDiagnosticFocus.ts`'s own
comment records the bug from getting this wrong on the camera side, where
keying on a derived object replayed the jump every time the list was re-derived
and threw the user back to an issue they had scrolled away from. Same failure
mode, same fix: the id changing is the event.

Do not scroll when the activation came from clicking the row itself — it is
already in view, and `align: 'auto'` mostly covers this, but the guard is worth
being explicit about.

## Affected Areas

| File | Change |
| --- | --- |
| `apps/web/src/cp-workspace/diagnostics/CpDiagnosticHud.tsx` | **New.** The HUD, windowed list, memoized row. |
| `apps/web/src/cp-workspace/diagnostics/useCpDiagnosticList.ts` | **New.** Narrow store bindings for the HUD. |
| `apps/web/src/components/panels/CreasePatternPanel.tsx` | Delete the HUD JSX (2756–2800) and `diagnosticHudEntries` (1448–1459); mount `<CpDiagnosticHud />`. |
| `apps/web/src/cp-workspace/diagnostics/hudStatus.ts` | Header/list count reconciliation. |
| `apps/web/src/styles/theme.css` | Row separator → `border-bottom`; spacer + absolute row positioning under `.cp-diagnostic-hud__list`. |
| `apps/web/eslint.config.js` | Lower the `CreasePatternPanel.tsx` `OVERSIZED_PANELS` number. |
| `apps/web/package.json` | `+ @tanstack/react-virtual` |
| `crates/**` | **None.** The kernel already returns every entry. |

Localization: new strings (an empty state, any warning count in the header) go
through `t('<ns>:<key>', 'English default')`, then `npm run i18n:extract`,
translations for all 8 locales, `npm run i18n:stamp`, `npm run i18n:check`.
CI gates this.

## Performance budget

State the target so the change can be checked rather than asserted:

- Expanding the HUD on a 2,000-entry pattern mounts ~20 rows, not 2,000.
- Scrolling the list holds 60fps with no long task over 16ms.
- Collapsed, the HUD costs one memoized status derivation and nothing else.
- The main JS chunk grows by ≤8 KB brotli.

Two things that will mislead if ignored — both learned the hard way in this repo:

- **Profile a production build with DevTools closed.** A dev build has misled on
  CP canvas perf more than once; React's dev-mode double-render and the
  profiler's own overhead both land squarely on a scroll path.
- **The automated browser pane cannot verify this.** It runs with
  `visibilityState = 'hidden'` and zero `requestAnimationFrame`, so scroll
  smoothness and the WebGL canvas underneath are not observable there. Store
  actions and DOM assertions do work. Scroll-feel verification is a browser
  checklist item, not something a tool run can close.

## Testing

- `visibleEntries.test.ts` — a case pinning that the HUD and the canvas see the
  same entry set when a check command result and the CAMV overlay coexist. This
  is the regression Phase 1 fixes; it should fail before the change.
- `hudStatus.test.ts` — the header/list count rule from Phase 2.
- New `CpDiagnosticHud.test.tsx` — renders N entries, asserts a bounded number
  of rows in the DOM and that the last entry is reachable; asserts
  activating an off-screen entry scrolls to it. jsdom reports zero-size
  elements, so drive the virtualizer with an explicit scroll-element rect stub
  rather than asserting exact pixel offsets.
- `npx tsc --noEmit` and `vitest` directly, not `npm run typecheck:web` — the
  npm scripts regenerate tracked `generated/**` wasm bindings nondeterministically.
- `npm run lint:web` — confirms the panel's lowered cap holds.

## Follow-ups (not this change)

- Sorting, severity grouping with sticky headers, and a type filter. A flat
  2,000-row list is complete but not navigable; this is what makes it usable.
- Next/prev-issue keyboard shortcuts, registered in `keyboard/` per AGENTS.md —
  never a `keydown` listener on the HUD.
- Stable, non-positional diagnostic ids from the kernel, so an active entry
  survives a CAMV recompute.

## Checklist

- [x] Phase 0 — extract `CpDiagnosticHud.tsx` + `useCpDiagnosticList.ts`; panel
      mounts it; lower `OVERSIZED_PANELS` (2939 → 2674)
- [x] Phase 1 — delete `diagnosticHudEntries`; HUD reads
      `visibleCpDiagnosticEntries`; failing-first test
- [x] Phase 2 — reconcile the header count with the list; test in
      `hudStatus.test.ts`
- [x] Phase 3 — add `@tanstack/react-virtual`; dynamic-height windowed list;
      remove `.slice(0, 12)`; separator off the entry index
- [x] Phase 4 — memoized row; delegated click; no per-row closures
- [x] Phase 5 — `scrollToIndex` on active-id change, keyed on the id alone
- [x] i18n — extract, translate 8 locales, stamp, `i18n:check` passes
- [x] `CpDiagnosticHud.test.tsx` covering bounded row count + reachability
- [x] `npx tsc --noEmit`, `vitest` (1852 tests), `eslint` — all clean
- [ ] Browser checklist for Zach (prod build, DevTools closed):
      - [ ] Large CP: HUD expands without a stall; scrolling is smooth to the end
      - [ ] Wheel over the HUD scrolls the list and does **not** zoom the canvas
      - [ ] Clicking a canvas marker scrolls its row into view and highlights it
      - [ ] Toggling "Foldability issues" off/on does not throw the list back to
            a previous position
      - [ ] Header count and list contents agree

## Notes from implementation

Three things the plan did not anticipate:

- **React Compiler declines to memoize any component using `useVirtualizer`**,
  and says so as a lint warning. That makes Phase 4 load-bearing rather than
  belt-and-braces: nothing else memoizes this component, so the row's `memo` and
  the delegated click are what keep a scroll frame from re-rendering every
  mounted row. The warning is suppressed at the call with that reasoning.
- **`contain: strict` would have collapsed the scroll container** — size
  containment computes the box as if it had no contents. It is `layout paint`.
- **The panel's width had been broken all along, and windowing exposed it.**
  `.cp-diagnostic-hud` asked for `width: min(420px, calc(100% - var(--space-8)))`
  against a spacing scale that stops at `--space-6`. An undefined custom property
  with no fallback invalidates the whole declaration, so `width` and `max-width`
  were both dropped and the 420px cap had never applied — the panel was
  shrink-to-fit, sized by the in-flow rows. Absolutely positioned rows contribute
  no intrinsic width, so it collapsed to its headline. Fixed, and
  `styles/themeTokens.test.ts` now fails on any undefined token reference;
  it found nine more dropped declarations across five other tokens, baselined.
- **jsdom has no layout, in four separate ways** that all had to be stood in for
  before `scrollToIndex` could be tested: `scrollTo` is absent, the `scrollTop`
  setter is a no-op reading back 0, and `scrollHeight`/`clientHeight` are 0 —
  the last of which made the virtualizer clamp every scroll target to
  `scrollHeight - clientHeight`, i.e. to 0, while otherwise looking like it
  worked.

A lever left on the table: `@tanstack/react-virtual` 3.14 has
`directDomUpdates`, which writes row transforms straight to the DOM during
scroll and re-renders React only when the visible *range* changes. Not taken —
with ~27 memoized rows mounted the React path is already cheap, and it is a
less-travelled code path that would fight the inline `transform` style. Worth
revisiting only if profiling shows the scroll path is actually hot.
